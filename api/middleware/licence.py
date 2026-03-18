import hashlib
import hmac as hmac_mod
import json
import logging
import os
import platform
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from api.config import settings

logger = logging.getLogger("vantax.licence")

# In-memory licence cache
_cache: dict = {
    "response": None,
    "expires_at": 0.0,
}

_last_checked_at: Optional[float] = None
_consecutive_failures: int = 0
_first_failure_at: Optional[float] = None

CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours
FAILURE_CUTOFF_SECONDS = 48 * 60 * 60  # 48 hours


def _get_machine_fingerprint() -> str:
    hostname = platform.node()
    # Get a stable machine identifier — hostname + UUID from /etc/machine-id or similar
    try:
        mac = hex(uuid.getnode())
    except Exception:
        mac = "unknown"
    raw = f"{hostname}:{mac}"
    return hashlib.sha256(raw.encode()).hexdigest()


def get_cached_licence() -> dict:
    """Return the cached licence data for the health endpoint.

    Returns a dict with licence details or a 'not_yet_checked' status
    if no cache exists.
    """
    cached = _cache.get("response")
    if cached is None:
        return {"valid": None, "status": "not_yet_checked"}

    result: dict = {
        "valid": cached.get("valid"),
        "modules": cached.get("modules", []),
        "expires_at": cached.get("expiresAt"),
        "last_checked": (
            datetime.fromtimestamp(_last_checked_at, tz=timezone.utc).isoformat()
            if _last_checked_at
            else None
        ),
    }

    expires_at = cached.get("expiresAt")
    if expires_at:
        try:
            exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            now_dt = datetime.now(timezone.utc)
            days = (exp_dt - now_dt).days
            result["days_remaining"] = days
        except (ValueError, TypeError):
            result["days_remaining"] = None
    else:
        result["days_remaining"] = None

    if not cached.get("valid"):
        result["reason"] = cached.get("reason")

    return result


def _read_offline_licence() -> dict | None:
    """Read licence from a local JSON file for air-gapped deployments.

    Requires LICENCE_MODE=offline. Validates HMAC-SHA256 signature using LICENCE_SECRET.
    After 48h of consecutive validation failures: refuse new analysis jobs,
    keep dashboard and existing data accessible.
    """
    global _consecutive_failures, _first_failure_at

    licence_mode = os.getenv("LICENCE_MODE", "online")
    if licence_mode != "offline":
        # Legacy support: fall back to checking licence_file directly
        if not settings.licence_file:
            return None
        licence_path = settings.licence_file
    else:
        licence_path = os.getenv("LICENCE_FILE_PATH", "/etc/vantax/licence.json")
        if not settings.licence_file:
            licence_path = licence_path  # use LICENCE_FILE_PATH
        else:
            licence_path = settings.licence_file  # prefer settings if set

    try:
        with open(licence_path, "r") as f:
            data = json.load(f)

        # HMAC signature verification
        licence_secret = os.getenv("LICENCE_SECRET", "")
        if licence_secret and "signature" in data and "payload" in data:
            # New format: {payload: {...}, signature: "<hmac_sha256_hex>"}
            payload = data["payload"]
            expected = hmac_mod.new(
                licence_secret.encode(),
                json.dumps(payload, sort_keys=True).encode(),
                hashlib.sha256,
            ).hexdigest()
            if data["signature"] != expected:
                logger.warning("Offline licence HMAC signature mismatch")
                _consecutive_failures += 1
                if _first_failure_at is None:
                    _first_failure_at = time.time()
                return {"valid": False, "reason": "invalid_signature"}
        elif licence_secret and "signature" not in data:
            # Secret is set but file has no signature — legacy format, treat as payload
            payload = data
        else:
            # No secret configured — trust the file as-is (legacy behavior)
            payload = data.get("payload", data)

        # Reset failure counter on successful read
        _consecutive_failures = 0
        _first_failure_at = None

        # Check expiry locally
        expires_at = payload.get("expiresAt", "")
        if expires_at:
            exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if exp_dt < datetime.now(timezone.utc):
                return {"valid": False, "reason": "expired"}

        return {
            "valid": payload.get("active", True),
            "modules": payload.get("modules", []),
            "tenantId": payload.get("tenantId", ""),
            "expiresAt": expires_at,
        }
    except FileNotFoundError:
        logger.warning(f"Offline licence file not found: {licence_path}")
        _consecutive_failures += 1
        if _first_failure_at is None:
            _first_failure_at = time.time()
        return None
    except Exception as e:
        logger.warning(f"Failed to read offline licence file: {e}")
        _consecutive_failures += 1
        if _first_failure_at is None:
            _first_failure_at = time.time()
        return None


def is_licence_degraded() -> bool:
    """Check if offline licence failures have exceeded the 48h cutoff.

    After 48h of consecutive failures: refuse new analysis jobs,
    keep dashboard and existing data accessible.
    """
    if _first_failure_at is None or _consecutive_failures == 0:
        return False
    return (time.time() - _first_failure_at) > FAILURE_CUTOFF_SECONDS


async def _validate_licence() -> dict | None:
    """Call the licence server or read offline file. Returns the response dict or None on failure."""
    global _last_checked_at
    _last_checked_at = time.time()

    # Offline mode: skip network call entirely
    licence_mode = os.getenv("LICENCE_MODE", "online")
    if licence_mode == "offline":
        return _read_offline_licence()

    # Check offline licence file first (legacy support)
    offline = _read_offline_licence()
    if offline is not None:
        return offline

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.licence_server_url}/validate",
                json={
                    "licenceKey": settings.licence_key,
                    "machineFingerprint": _get_machine_fingerprint(),
                },
            )
            return resp.json()
    except Exception as e:
        logger.warning(f"Licence server unreachable: {e}")
        return None


# Feature flag route mapping — routes requiring specific licence features
FEATURE_ROUTE_MAP: dict[str, str] = {
    # ── Existing Phase A-G routes ─────────────────────────────────────────
    "/api/v1/cleaning": "cleaning",
    "/api/v1/exceptions": "exceptions",
    "/api/v1/analytics": "analytics",
    "/api/v1/nlp": "nlp",
    "/api/v1/contracts": "contracts",
    "/api/v1/notifications": "notifications",
    # ── New Phase H-O MDM routes (require 'mdm' licence feature) ──────────
    "/api/v1/systems": "mdm",
    "/api/v1/sync": "mdm",
    "/api/v1/master-records": "mdm",
    "/api/v1/stewardship": "mdm",
    "/api/v1/glossary": "mdm",
    "/api/v1/relationships": "mdm",
    "/api/v1/match-rules": "mdm",
    "/api/v1/mdm-metrics": "mdm",
    # ── AI-specific routes (require 'ai_features' licence feature) ────────
    "/api/v1/ai": "ai_features",
}


def _check_feature_gate(path: str, licensed_features: list[str]) -> JSONResponse | None:
    """Return a 402 response if the route requires a feature not in the licence."""
    if "*" in licensed_features:
        return None
    for route_prefix, feature in FEATURE_ROUTE_MAP.items():
        if path.startswith(route_prefix):
            if feature not in licensed_features:
                return JSONResponse(
                    {
                        "error": "feature_not_licenced",
                        "feature": feature,
                        "upgrade_url": "https://portal.vantax.co.za/upgrade",
                    },
                    status_code=402,
                )
            break
    return None


class LicenceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only check /api/v1/* routes
        if not request.url.path.startswith("/api/v1"):
            return await call_next(request)

        # Dev mode — skip validation if no licence key and AUTH_MODE=local
        if not settings.licence_key and settings.auth_mode == "local":
            request.state.licensed_modules = ["*"]
            request.state.licensed_features = ["*"]
            return await call_next(request)

        # Check in-memory cache
        now = time.time()
        if _cache["response"] and _cache["expires_at"] > now:
            cached = _cache["response"]
            if cached.get("valid"):
                request.state.licensed_modules = cached.get("modules", [])
                request.state.licensed_features = cached.get("features", [])
                # Check feature gate
                feature_block = _check_feature_gate(
                    request.url.path, cached.get("features", [])
                )
                if feature_block:
                    return feature_block
                return await call_next(request)
            else:
                return JSONResponse(
                    {"error": "licence_invalid", "reason": cached.get("reason")},
                    status_code=402,
                )

        # Cache miss — call licence server
        result = await _validate_licence()

        if result is None:
            # Licence server unreachable — graceful degradation
            logger.warning("Licence server unreachable — allowing request through")
            request.state.licensed_modules = ["*"]
            request.state.licensed_features = ["*"]
            return await call_next(request)

        # Cache the result
        _cache["response"] = result
        _cache["expires_at"] = now + CACHE_TTL_SECONDS

        if result.get("valid"):
            request.state.licensed_modules = result.get("modules", [])
            request.state.licensed_features = result.get("features", [])
            # Check feature gate
            feature_block = _check_feature_gate(
                request.url.path, result.get("features", [])
            )
            if feature_block:
                return feature_block
            return await call_next(request)
        else:
            return JSONResponse(
                {"error": "licence_invalid", "reason": result.get("reason")},
                status_code=402,
            )

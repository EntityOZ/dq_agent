import hashlib
import json
import logging
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

CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours


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
    """Read licence from a local JSON file for air-gapped deployments."""
    if not settings.licence_file:
        return None
    try:
        with open(settings.licence_file, "r") as f:
            data = json.load(f)
        # Check expiry locally
        expires_at = data.get("expiresAt", "")
        if expires_at:
            exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if exp_dt < datetime.now(timezone.utc):
                return {"valid": False, "reason": "expired"}
        return {
            "valid": data.get("valid", True),
            "modules": data.get("modules", []),
            "tenantId": data.get("tenantId", ""),
            "expiresAt": expires_at,
        }
    except Exception as e:
        logger.warning(f"Failed to read offline licence file: {e}")
        return None


async def _validate_licence() -> dict | None:
    """Call the licence server or read offline file. Returns the response dict or None on failure."""
    global _last_checked_at
    _last_checked_at = time.time()

    # Check offline licence file first
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


class LicenceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only check /api/v1/* routes
        if not request.url.path.startswith("/api/v1"):
            return await call_next(request)

        # Dev mode — skip validation if no licence key and AUTH_MODE=local
        if not settings.licence_key and settings.auth_mode == "local":
            request.state.licensed_modules = ["*"]
            return await call_next(request)

        # Check in-memory cache
        now = time.time()
        if _cache["response"] and _cache["expires_at"] > now:
            cached = _cache["response"]
            if cached.get("valid"):
                request.state.licensed_modules = cached.get("modules", [])
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
            return await call_next(request)

        # Cache the result
        _cache["response"] = result
        _cache["expires_at"] = now + CACHE_TTL_SECONDS

        if result.get("valid"):
            request.state.licensed_modules = result.get("modules", [])
            return await call_next(request)
        else:
            return JSONResponse(
                {"error": "licence_invalid", "reason": result.get("reason")},
                status_code=402,
            )

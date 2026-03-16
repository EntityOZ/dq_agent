import hashlib
import logging
import platform
import time
import uuid

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


async def _validate_licence() -> dict | None:
    """Call the licence server. Returns the response dict or None on failure."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                settings.licence_server_url,
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

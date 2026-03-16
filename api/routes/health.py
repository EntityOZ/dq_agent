from datetime import datetime, timezone

from fastapi import APIRouter

from api.config import settings
from api.middleware.licence import get_cached_licence

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    # Check LLM connectivity
    llm_connected = False
    try:
        if settings.llm_provider == "ollama":
            import httpx

            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{settings.ollama_base_url}/api/tags")
                llm_connected = resp.status_code == 200
        else:
            # For cloud providers, assume connected if key is set
            llm_connected = bool(
                settings.ollama_api_key or settings.anthropic_api_key
            )
    except Exception:
        llm_connected = False

    return {
        "status": "ok",
        "version": "1.0.0",
        "llm_provider": settings.llm_provider,
        "llm_connected": llm_connected,
        "licence": get_cached_licence(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

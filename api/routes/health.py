from datetime import datetime, timezone

from fastapi import APIRouter

from api.config import settings

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "version": "1.0.0",
        "llm_provider": settings.llm_provider,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

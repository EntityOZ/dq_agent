import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import settings
from api.routes.health import router as health_router

logger = logging.getLogger("vantax")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Vantax API starting")
    logger.info(f"LLM_PROVIDER: {settings.llm_provider}")
    logger.info(f"LICENCE_KEY: {'set' if settings.licence_key else 'not set'}")

    # Test LLM connection
    try:
        from llm.provider import test_llm_connection

        if test_llm_connection():
            logger.info("LLM connection: OK")
        else:
            logger.warning("LLM connection: FAILED — check LLM_PROVIDER config")
    except Exception as e:
        logger.warning(f"LLM connection: FAILED — {e}")

    # Ensure MinIO buckets exist
    try:
        from api.services.storage import ensure_buckets

        ensure_buckets()
        logger.info("MinIO buckets: OK")
    except Exception as e:
        logger.warning(f"MinIO bucket init failed: {e}")

    yield


app = FastAPI(title="Vantax API", version="1.0.0", lifespan=lifespan)

# CORS — allow frontend origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://frontend:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Licence middleware — checks /api/v1/* routes
from api.middleware.licence import LicenceMiddleware

app.add_middleware(LicenceMiddleware)

# Register routers
app.include_router(health_router)

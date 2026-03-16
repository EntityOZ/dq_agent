import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import settings
from api.routes.health import router as health_router
from api.routes.upload import router as upload_router
from api.routes.versions import router as versions_router
from api.routes.findings import router as findings_router
from api.routes.analyse import router as analyse_router
from api.routes.reports import router as reports_router

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

    # Ensure dev tenant exists (local dev mode only)
    if settings.auth_mode == "local":
        try:
            from sqlalchemy import text
            from api.deps import engine, async_session_factory

            async with async_session_factory() as session:
                result = await session.execute(
                    text("SELECT id FROM tenants WHERE id = '00000000-0000-0000-0000-000000000001'")
                )
                if not result.scalar():
                    await session.execute(
                        text(
                            "INSERT INTO tenants (id, name, licensed_modules) "
                            "VALUES ('00000000-0000-0000-0000-000000000001', 'Dev Tenant', "
                            "ARRAY['business_partner', 'material_master', 'fi_gl'])"
                        )
                    )
                    await session.commit()
                    logger.info("Dev tenant created")
                else:
                    logger.info("Dev tenant exists")
        except Exception as e:
            logger.warning(f"Dev tenant init failed: {e}")

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
app.include_router(upload_router)
app.include_router(versions_router)
app.include_router(findings_router)
app.include_router(analyse_router)
app.include_router(reports_router)

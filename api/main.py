import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import settings
from api.routes.health import router as health_router
from api.routes.upload import router as upload_router
from api.routes.upload_match import router as upload_match_router
from api.routes.versions import router as versions_router
from api.routes.findings import router as findings_router
from api.routes.analyse import router as analyse_router
from api.routes.reports import router as reports_router
from api.routes.settings import router as settings_router
from api.routes.connect import router as connect_router
from api.routes.writeback import router as writeback_router
from api.routes.cleaning import router as cleaning_router
from api.routes.exceptions import router as exceptions_router
from api.routes.analytics import router as analytics_router
from api.routes.contracts import router as contracts_router
from api.routes.notifications import router as notifications_router
from api.routes.users import router as users_router
from api.routes.systems import router as systems_router
from api.routes.master_records import router as master_records_router
from api.routes.ai_feedback import router as ai_feedback_router
from api.routes.match_rules import router as match_rules_router
from api.routes.glossary import router as glossary_router
from api.routes.relationships import router as relationships_router
from api.routes.stewardship import router as stewardship_router
from api.routes.mdm_metrics import router as mdm_metrics_router
from api.routes.sync_trigger import router as sync_trigger_router

logger = logging.getLogger("meridian")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Meridian API starting")
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


app = FastAPI(title="Meridian API", version="1.0.0", lifespan=lifespan)

# Security headers middleware
from starlette.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        if "server" in response.headers:
            del response.headers["server"]
        return response

app.add_middleware(SecurityHeadersMiddleware)

# CORS — origins configurable via MERIDIAN_CORS_ORIGINS (comma-separated)
_raw_origins = os.getenv(
    "MERIDIAN_CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://frontend:3000",
)
_cors_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
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
app.include_router(upload_match_router)
app.include_router(versions_router)
app.include_router(findings_router)
app.include_router(analyse_router)
app.include_router(reports_router)
app.include_router(settings_router)
app.include_router(connect_router)
app.include_router(writeback_router)
app.include_router(cleaning_router)
app.include_router(exceptions_router)
app.include_router(analytics_router)
app.include_router(contracts_router)
app.include_router(notifications_router)
app.include_router(users_router)
app.include_router(systems_router)
app.include_router(master_records_router)
app.include_router(ai_feedback_router)
app.include_router(match_rules_router)
app.include_router(glossary_router)
app.include_router(relationships_router)
app.include_router(stewardship_router)
app.include_router(mdm_metrics_router)
app.include_router(sync_trigger_router)

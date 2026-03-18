import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from api.config import settings
from api.routes.health import router as health_router
from api.routes.upload import router as upload_router
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

    # Initialise Sentry with SAP data scrubber (only when SENTRY_DSN is set)
    if settings.sentry_dsn:
        try:
            import sentry_sdk

            _SCRUB_KEYS = {
                "df", "dataframe", "record_data", "record_data_before",
                "record_data_after", "prompt", "content", "wa", "data_rows",
                "parquet", "payload", "password", "passwd", "secret",
            }

            def _scrub_event(event, hint):
                """Strip SAP data from Sentry payloads before dispatch."""
                def _scrub(obj, depth=0):
                    if depth > 10:
                        return "[DEPTH_LIMIT]"
                    if isinstance(obj, dict):
                        return {
                            k: "[REDACTED]" if k.lower() in _SCRUB_KEYS else _scrub(v, depth + 1)
                            for k, v in obj.items()
                        }
                    if isinstance(obj, (list, tuple)):
                        return [_scrub(i, depth + 1) for i in obj[:20]]
                    if isinstance(obj, str) and len(obj) > 500:
                        return obj[:500] + "...[TRUNCATED]"
                    return obj

                return _scrub(event)

            sentry_sdk.init(
                dsn=settings.sentry_dsn,
                before_send=_scrub_event,
                traces_sample_rate=0.0,
            )
            logger.info("Sentry initialised with SAP data scrubber")
        except Exception as e:
            logger.warning(f"Sentry init failed: {e}")

    yield


# Disable interactive docs in production (prevents API schema reconnaissance)
_docs_url = "/docs" if settings.auth_mode == "local" else None
_openapi_url = "/openapi.json" if settings.auth_mode == "local" else None

app = FastAPI(
    title="Vantax API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=_docs_url,
    openapi_url=_openapi_url,
    redoc_url=None,
)


# ── Global exception handler — never leak stack traces to API callers ─────────


@app.exception_handler(Exception)
async def _global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        f"Unhandled exception on {request.method} {request.url.path}", exc_info=True
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "detail": "An unexpected error occurred. Check server logs.",
        },
    )


# ── Security response headers ────────────────────────────────────────────────


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        if rid := request.headers.get("X-Request-ID"):
            response.headers["X-Request-ID"] = rid
        response.headers.pop("server", None)
        return response


app.add_middleware(SecurityHeadersMiddleware)

# CORS — tightened methods and headers to what the frontend actually uses
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://frontend:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID", "X-Tenant-ID", "Accept"],
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

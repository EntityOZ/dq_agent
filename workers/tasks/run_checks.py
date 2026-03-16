import logging
import time

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

logger = logging.getLogger("vantax.worker")


def _get_sync_session() -> Session:
    import os

    url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
    # Ensure sync driver
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    engine = create_engine(url)
    return Session(engine)


@celery_app.task(bind=True, name="workers.tasks.run_checks.run_checks")
def run_checks(self, version_id: str, tenant_id: str, parquet_path: str):
    """Stub task for Phase 1. Phase 2 will implement full check execution."""
    logger.info(f"run_checks received: version_id={version_id}, tenant_id={tenant_id}")

    session = _get_sync_session()
    try:
        # Set RLS context
        session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))

        # Update status to running
        session.execute(
            text(
                "UPDATE analysis_versions SET status = 'running' "
                "WHERE id = :vid AND tenant_id = :tid"
            ),
            {"vid": version_id, "tid": tenant_id},
        )
        session.commit()

        # Simulate work
        time.sleep(2)

        # Update status to complete
        session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
        session.execute(
            text(
                "UPDATE analysis_versions SET status = 'complete' "
                "WHERE id = :vid AND tenant_id = :tid"
            ),
            {"vid": version_id, "tid": tenant_id},
        )
        session.commit()
    finally:
        session.close()

    logger.info(f"run_checks complete: version_id={version_id}")
    return {"version_id": version_id, "status": "complete"}

import io
import json
import logging
import traceback

import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

logger = logging.getLogger("vantax.worker")


def _get_sync_engine():
    import os

    url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return create_engine(url)


def _get_minio_client():
    import os
    from minio import Minio

    return Minio(
        endpoint=os.getenv("MINIO_ENDPOINT", "minio:9000"),
        access_key=os.getenv("MINIO_ACCESS_KEY", "vantax"),
        secret_key=os.getenv("MINIO_SECRET_KEY", ""),
        secure=False,
    )


@celery_app.task(bind=True, name="workers.tasks.run_checks.run_checks")
def run_checks(self, version_id: str, tenant_id: str, parquet_path: str):
    """Execute the full check suite against a dataset."""
    logger.info(f"run_checks started: version_id={version_id}, tenant_id={tenant_id}")

    engine = _get_sync_engine()

    with Session(engine) as session:
        # Step 1: Set RLS context
        session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))

        # Check idempotency — if already complete, skip
        result = session.execute(
            text("SELECT status FROM analysis_versions WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        row = result.fetchone()
        if row and row[0] == "complete":
            logger.info(f"Version {version_id} already complete, skipping")
            return {"version_id": version_id, "status": "complete"}

        # Step 2: Update status to running
        session.execute(
            text("UPDATE analysis_versions SET status = 'running' WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        session.commit()

    try:
        # Step 3: Download parquet from MinIO
        minio_client = _get_minio_client()
        import os
        bucket = os.getenv("MINIO_BUCKET_UPLOADS", "vantax-uploads")
        response = minio_client.get_object(bucket, parquet_path)
        parquet_bytes = response.read()
        response.close()
        response.release_conn()

        # Step 4: Load into DataFrame
        df = pd.read_parquet(io.BytesIO(parquet_bytes))
        logger.info(f"Loaded DataFrame: {len(df)} rows, {len(df.columns)} columns")

        # Step 5: Get modules from version metadata
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
            result = session.execute(
                text("SELECT metadata FROM analysis_versions WHERE id = :vid"),
                {"vid": version_id},
            )
            row = result.fetchone()
            metadata = row[0] if row else {}
            modules = metadata.get("modules", [])

        # Step 6: Run checks for each module
        from checks.runner import run_checks as execute_checks

        all_results = []
        for module_name in modules:
            logger.info(f"Running checks for module: {module_name}")
            results = execute_checks(module_name, df, tenant_id)
            all_results.extend(results)

        logger.info(f"Total check results: {len(all_results)}")

        # Step 7-8: Score all modules
        from api.services.scoring import score_all_modules

        dqs_results = score_all_modules(all_results)
        dqs_summary = {mod: result.model_dump() for mod, result in dqs_results.items()}

        # Step 9: Insert findings into Postgres
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))

            for check_result in all_results:
                session.execute(
                    text("""
                        INSERT INTO findings (
                            id, version_id, tenant_id, module, check_id, severity,
                            dimension, affected_count, total_count, pass_rate, details
                        ) VALUES (
                            gen_random_uuid(), :version_id, :tenant_id, :module, :check_id,
                            :severity, :dimension, :affected_count, :total_count, :pass_rate,
                            CAST(:details AS jsonb)
                        )
                    """),
                    {
                        "version_id": version_id,
                        "tenant_id": tenant_id,
                        "module": check_result.module,
                        "check_id": check_result.check_id,
                        "severity": check_result.severity,
                        "dimension": check_result.dimension,
                        "affected_count": check_result.affected_count,
                        "total_count": check_result.total_count,
                        "pass_rate": check_result.pass_rate,
                        "details": json.dumps(check_result.details) if check_result.details else "{}",
                    },
                )

            # Step 10: Update version with DQS summary
            session.execute(
                text("""
                    UPDATE analysis_versions
                    SET status = 'complete', dqs_summary = CAST(:summary AS jsonb)
                    WHERE id = :vid AND tenant_id = :tid
                """),
                {
                    "vid": version_id,
                    "tid": tenant_id,
                    "summary": json.dumps(dqs_summary),
                },
            )
            session.commit()

        logger.info(f"run_checks complete: version_id={version_id}, findings={len(all_results)}")

        # Enqueue agent pipeline
        from workers.tasks.run_agents import run_agents
        run_agents.delay(version_id, tenant_id)
        logger.info(f"Enqueued run_agents for version_id={version_id}")

        return {"version_id": version_id, "status": "complete", "findings_count": len(all_results)}

    except Exception as e:
        # Step 12: On failure, update status
        logger.error(f"run_checks failed: {traceback.format_exc()}")
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
            session.execute(
                text("UPDATE analysis_versions SET status = 'failed' WHERE id = :vid AND tenant_id = :tid"),
                {"vid": version_id, "tid": tenant_id},
            )
            session.commit()
        raise

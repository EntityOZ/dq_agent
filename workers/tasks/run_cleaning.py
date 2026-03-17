"""Celery task: run cleaning detection after check suite completes.

Enqueued by run_checks.py after checks complete successfully.
A cleaning failure must never affect the analysis result stored in findings.
"""

import io
import json
import logging
import traceback

import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

logger = logging.getLogger("vantax.worker.cleaning")


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


@celery_app.task(bind=True, name="workers.tasks.run_cleaning.run_cleaning")
def run_cleaning(self, version_id: str, tenant_id: str, object_type: str, parquet_path: str):
    """Detect cleaning candidates for a completed analysis run."""
    logger.info(f"run_cleaning started: version_id={version_id}, object_type={object_type}")

    try:
        # Load parquet from MinIO
        import os
        minio_client = _get_minio_client()
        bucket = os.getenv("MINIO_BUCKET_UPLOADS", "vantax-uploads")
        response = minio_client.get_object(bucket, parquet_path)
        parquet_bytes = response.read()
        response.close()
        response.release_conn()

        df = pd.read_parquet(io.BytesIO(parquet_bytes))
        logger.info(f"Loaded DataFrame for cleaning: {len(df)} rows")

        # Run cleaning detection
        from api.services.cleaning_engine import CleaningEngine
        engine = CleaningEngine()
        candidates = engine.detect_candidates(df, object_type, version_id, tenant_id)

        if not candidates:
            logger.info(f"run_cleaning complete: version_id={version_id}, candidates=0")
            return {"version_id": version_id, "candidates": 0}

        # Bulk insert into cleaning_queue
        db_engine = _get_sync_engine()
        with Session(db_engine) as session:
            session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))

            for c in candidates:
                # Separate dedup candidates
                if c.get("category") == "dedup" and c.get("merge_preview"):
                    # Insert into dedup_candidates
                    keys = c["record_key"].split("|")
                    key_a = keys[0] if len(keys) > 0 else ""
                    key_b = keys[1] if len(keys) > 1 else ""
                    session.execute(
                        text("""
                            INSERT INTO dedup_candidates (
                                id, tenant_id, object_type, record_key_a, record_key_b,
                                match_score, match_method, match_fields, status
                            ) VALUES (
                                gen_random_uuid(), :tid, :ot, :ka, :kb,
                                :score, :method, CAST(:fields AS jsonb), 'pending'
                            )
                        """),
                        {
                            "tid": tenant_id,
                            "ot": c["object_type"],
                            "ka": key_a,
                            "kb": key_b,
                            "score": c["confidence"],
                            "method": c.get("match_method", "fuzzy"),
                            "fields": json.dumps(c.get("match_fields", {})),
                        },
                    )

                # Insert all candidates into cleaning_queue
                session.execute(
                    text("""
                        INSERT INTO cleaning_queue (
                            id, tenant_id, rule_id, object_type, status, confidence,
                            record_key, record_data_before, record_data_after,
                            merge_preview, priority, version_id
                        ) VALUES (
                            gen_random_uuid(), :tid, :rid, :ot, 'detected', :conf,
                            :rk, CAST(:before AS jsonb), CAST(:after AS jsonb),
                            CAST(:mp AS jsonb), :pri, :vid
                        )
                    """),
                    {
                        "tid": tenant_id,
                        "rid": c.get("rule_id"),
                        "ot": c["object_type"],
                        "conf": c["confidence"],
                        "rk": c["record_key"],
                        "before": json.dumps(c.get("record_data_before") or {}),
                        "after": json.dumps(c.get("record_data_after") or {}),
                        "mp": json.dumps(c.get("merge_preview") or {}),
                        "pri": c.get("priority", 50),
                        "vid": version_id,
                    },
                )

            session.commit()

        # Create notification for cleaning candidates
        try:
            from api.services.notifications import create_notification_sync
            with Session(db_engine) as notif_session:
                notif_session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
                create_notification_sync(
                    tenant_id=tenant_id,
                    user_id=None,
                    type="cleaning",
                    title=f"{len(candidates)} cleaning items need review",
                    body=f"Cleaning detection found {len(candidates)} candidates for {object_type}.",
                    link="/cleaning",
                    session=notif_session,
                )
                notif_session.commit()
        except Exception as e:
            logger.warning(f"Failed to create cleaning notification (non-fatal): {e}")

        logger.info(f"run_cleaning complete: version_id={version_id}, candidates={len(candidates)}")
        return {"version_id": version_id, "candidates": len(candidates)}

    except Exception as e:
        # Cleaning failure must never affect analysis results
        logger.error(f"run_cleaning failed (non-fatal): {traceback.format_exc()}")
        return {"version_id": version_id, "candidates": 0, "error": str(e)}

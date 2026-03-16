"""Celery task: run the LangGraph agent pipeline after check engine completes.

Sets RLS context, calls run_graph(), updates findings with remediation text,
and enqueues PDF generation on success.
"""

import asyncio
import json
import logging
import traceback
import uuid

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

logger = logging.getLogger("vantax.worker.agents")


def _get_sync_engine():
    import os
    url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return create_engine(url)


def _run_async(coro):
    """Run an async function from synchronous Celery context."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, name="workers.tasks.run_agents.run_agents")
def run_agents(self, version_id: str, tenant_id: str):
    """Execute the full LangGraph agent pipeline."""
    logger.info(f"run_agents started: version_id={version_id}, tenant_id={tenant_id}")

    engine = _get_sync_engine()

    # Set status to agents_running
    with Session(engine) as session:
        session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))

        # Idempotency check
        result = session.execute(
            text("SELECT status FROM analysis_versions WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        row = result.fetchone()
        if row and row[0] == "agents_complete":
            logger.info(f"Version {version_id} agents already complete, skipping")
            return {"version_id": version_id, "status": "agents_complete"}

        session.execute(
            text("UPDATE analysis_versions SET status = 'agents_running' WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        session.commit()

    try:
        from agents.orchestrator import run_graph

        final_state = _run_async(run_graph(version_id, tenant_id))

        if final_state.get("error"):
            logger.error(f"Agent pipeline error: {final_state['error']}")
            with Session(engine) as session:
                session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
                session.execute(
                    text("UPDATE analysis_versions SET status = 'agents_failed' WHERE id = :vid AND tenant_id = :tid"),
                    {"vid": version_id, "tid": tenant_id},
                )
                session.commit()
            return {"version_id": version_id, "status": "agents_failed", "error": final_state["error"]}

        # Update findings with remediation text from cross-finding analysis
        remediations = final_state.get("remediations", {})
        logger.info(f"Processing remediation output: {type(remediations)}")

        if remediations and isinstance(remediations, dict):
            effort_estimates = remediations.get("effort_estimates", [])
            fix_sequence = remediations.get("fix_sequence", [])

            # Build per-check_id remediation text from effort estimates and sequencing
            with Session(engine) as session:
                session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))

                total_updated = 0
                for estimate in effort_estimates:
                    check_id = estimate.get("check_id")
                    if not check_id:
                        continue

                    # Build remediation text from cross-finding analysis
                    parts = []
                    complexity = estimate.get("fix_complexity", "")
                    hours = estimate.get("estimated_person_hours", "")
                    basis = estimate.get("estimation_basis", "")
                    if hours:
                        parts.append(f"Estimated effort: {hours} person-hours ({complexity} complexity)")
                    if basis:
                        parts.append(f"Basis: {basis}")

                    # Add sequence position
                    seq = next(
                        (s for s in fix_sequence if s.get("check_id") == check_id),
                        None,
                    )
                    if seq:
                        parts.append(f"Fix priority: #{seq.get('sequence', '?')} — {seq.get('reason', '')}")

                    remediation_text = "\n".join(parts)

                    result = session.execute(
                        text("""
                            UPDATE findings SET remediation_text = :rem_text
                            WHERE version_id = :vid AND tenant_id = :tid AND check_id = :cid
                        """),
                        {
                            "vid": version_id,
                            "tid": tenant_id,
                            "cid": check_id,
                            "rem_text": remediation_text,
                        },
                    )
                    total_updated += result.rowcount

                session.commit()

            logger.info(f"Updated {total_updated} findings with remediation text")

        # Update status to agents_complete
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
            session.execute(
                text("UPDATE analysis_versions SET status = 'agents_complete' WHERE id = :vid AND tenant_id = :tid"),
                {"vid": version_id, "tid": tenant_id},
            )
            session.commit()

        # Enqueue PDF generation
        from workers.tasks.generate_pdf import generate_pdf
        generate_pdf.delay(version_id, tenant_id)

        # Enqueue notification check for critical findings
        from workers.tasks.send_notifications import send_notification
        send_notification.delay(version_id, tenant_id, "critical_found")

        logger.info(f"run_agents complete: version_id={version_id}")
        return {"version_id": version_id, "status": "agents_complete"}

    except Exception as e:
        logger.error(f"run_agents failed: {traceback.format_exc()}")
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
            session.execute(
                text("UPDATE analysis_versions SET status = 'agents_failed' WHERE id = :vid AND tenant_id = :tid"),
                {"vid": version_id, "tid": tenant_id},
            )
            session.commit()
        raise

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

        # Update findings with remediation text
        remediations = final_state.get("remediations", [])
        if remediations:
            with Session(engine) as session:
                session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
                for rem in remediations:
                    check_id = rem.get("check_id")
                    fix_steps = rem.get("fix_steps", [])
                    sap_tx = rem.get("sap_transaction", "")
                    effort = rem.get("estimated_effort", "")
                    remediation_text = "\n".join(fix_steps)
                    if sap_tx:
                        remediation_text += f"\nSAP Transaction: {sap_tx}"
                    if effort:
                        remediation_text += f"\nEstimated Effort: {effort}"

                    session.execute(
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
                session.commit()

            logger.info(f"Updated {len(remediations)} findings with remediation text")

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

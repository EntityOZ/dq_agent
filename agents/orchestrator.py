"""LangGraph orchestrator — wires four sub-agents into a StateGraph.

Graph: analyst → remediation → readiness → report → END
Each node checks for errors and routes to END if state["error"] is set.
"""

import json
import logging

from langgraph.graph import END, StateGraph
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.ext.asyncio import async_sessionmaker

from agents.analyst import analyst_node
from agents.readiness import readiness_node
from agents.remediation import remediation_node
from agents.report_agent import report_node
from agents.state import AgentState
from api.config import settings

logger = logging.getLogger("vantax.agents.orchestrator")


def _should_continue(state: AgentState) -> str:
    """Conditional edge: route to END if error is set."""
    if state.get("error"):
        return "end"
    return "continue"


# Build the graph once at module level
_graph_builder = StateGraph(AgentState)

_graph_builder.add_node("analyst", analyst_node)
_graph_builder.add_node("remediation", remediation_node)
_graph_builder.add_node("readiness", readiness_node)
_graph_builder.add_node("report", report_node)

_graph_builder.set_entry_point("analyst")

_graph_builder.add_conditional_edges("analyst", _should_continue, {"continue": "remediation", "end": END})
_graph_builder.add_conditional_edges("remediation", _should_continue, {"continue": "readiness", "end": END})
_graph_builder.add_conditional_edges("readiness", _should_continue, {"continue": "report", "end": END})
_graph_builder.add_conditional_edges("report", _should_continue, {"continue": END, "end": END})

graph = _graph_builder.compile()


async def run_graph(version_id: str, tenant_id: str) -> AgentState:
    """Load data from Postgres and invoke the full agent pipeline.

    Returns the final AgentState with all fields populated.
    """
    engine = create_async_engine(settings.database_url, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        await db.execute(text(f"SET app.tenant_id = '{tenant_id}'"))

        # Load version
        result = await db.execute(
            text("SELECT dqs_summary, metadata, status FROM analysis_versions WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        row = result.fetchone()
        if not row:
            raise ValueError(f"Version {version_id} not found for tenant {tenant_id}")

        dqs_summary = row[0] or {}
        metadata = row[1] or {}
        modules = metadata.get("modules", [])

        # Load findings — summaries only, never raw data
        findings_result = await db.execute(
            text("""
                SELECT check_id, module, severity, dimension,
                       affected_count, total_count, pass_rate,
                       details->>'message' as message
                FROM findings
                WHERE version_id = :vid AND tenant_id = :tid
            """),
            {"vid": version_id, "tid": tenant_id},
        )
        findings_rows = findings_result.fetchall()

    await engine.dispose()

    findings_summary = []
    for r in findings_rows:
        findings_summary.append({
            "check_id": r[0],
            "module": r[1],
            "severity": r[2],
            "dimension": r[3],
            "affected_count": r[4],
            "total_count": r[5],
            "pass_rate": float(r[6]) if r[6] is not None else 0.0,
            "message": r[7] or "",
        })

    # Build DQS scores dict for state
    dqs_scores = {}
    for mod, scores in dqs_summary.items():
        if isinstance(scores, dict):
            dqs_scores[mod] = {
                "composite_score": scores.get("composite_score", 0.0),
                "dimension_scores": scores.get("dimension_scores", {}),
                "critical_count": scores.get("critical_count", 0),
                "capped": scores.get("capped", False),
            }

    initial_state: AgentState = {
        "version_id": version_id,
        "tenant_id": tenant_id,
        "module_names": modules,
        "findings_summary": findings_summary,
        "dqs_scores": dqs_scores,
        "root_causes": [],
        "remediations": [],
        "readiness_scores": {},
        "report": None,
        "error": None,
    }

    logger.info(f"Running agent graph for version={version_id}, modules={modules}, findings={len(findings_summary)}")

    final_state = await graph.ainvoke(initial_state)

    # Store report to Postgres
    if final_state.get("report") and not final_state.get("error"):
        report_engine = create_async_engine(settings.database_url, echo=False)
        report_session_factory = async_sessionmaker(report_engine, expire_on_commit=False)

        async with report_session_factory() as db:
            await db.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
            await db.execute(
                text("""
                    INSERT INTO reports (id, version_id, tenant_id, report_json, generated_at)
                    VALUES (gen_random_uuid(), :vid, :tid, CAST(:report AS jsonb), now())
                    ON CONFLICT DO NOTHING
                """),
                {
                    "vid": version_id,
                    "tid": tenant_id,
                    "report": json.dumps(final_state["report"]),
                },
            )
            await db.commit()

        await report_engine.dispose()
        logger.info(f"Report stored for version={version_id}")

    return final_state

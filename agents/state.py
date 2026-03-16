"""AgentState — shared state object for the LangGraph agent pipeline.

Every sub-agent reads from and writes to this TypedDict.
findings_summary contains ONLY aggregated summaries — never raw SAP data.
"""

from typing import TypedDict


class AgentState(TypedDict):
    # Identifiers — set before graph entry
    version_id: str
    tenant_id: str
    module_names: list[str]

    # Populated by the orchestrator before entering the graph
    findings_summary: list[dict]
    # Each dict: {check_id, module, severity, dimension, affected_count,
    #             total_count, pass_rate, message}
    # NEVER include raw row data. Summaries only.

    dqs_scores: dict
    # {module: {composite_score, dimension_scores, critical_count, capped}}

    # Populated by analyst_agent
    root_causes: list[dict]
    # Each dict: {module, finding_ids: list[str], root_cause: str,
    #             business_impact: str, sap_context: str}

    # Populated by remediation_agent
    remediations: list[dict]
    # Each dict: {check_id, module, severity, fix_steps: list[str],
    #             sap_transaction: str, estimated_effort: str}

    # Populated by readiness_agent
    readiness_scores: dict
    # {module: {score: float, status: "go"|"no-go"|"conditional",
    #           blockers: list[str], conditions: list[str]}}

    # Populated by report_agent
    report: dict | None
    # The fully assembled report JSON

    # Set by any node on non-recoverable error
    error: str | None

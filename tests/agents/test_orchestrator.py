"""Tests for the LangGraph orchestrator graph."""

import json
from unittest.mock import MagicMock, patch, AsyncMock

import pytest

from agents.state import AgentState


def _make_initial_state():
    return {
        "version_id": "v1",
        "tenant_id": "t1",
        "module_names": ["business_partner"],
        "findings_summary": [
            {
                "check_id": "BP001",
                "module": "business_partner",
                "severity": "critical",
                "dimension": "completeness",
                "affected_count": 150,
                "total_count": 1000,
                "pass_rate": 85.0,
                "message": "BP type is mandatory",
            }
        ],
        "dqs_scores": {
            "business_partner": {
                "composite_score": 72.4,
                "critical_count": 1,
                "dimension_scores": {"completeness": 85.0},
                "capped": True,
            }
        },
        "root_causes": [],
        "remediations": [],
        "readiness_scores": {},
        "report": None,
        "error": None,
    }


VALID_ROOT_CAUSES = json.dumps({
    "root_causes": [
        {
            "module": "business_partner",
            "finding_ids": ["BP001"],
            "root_cause": "Missing BU_TYPE during migration",
            "business_impact": "Blocks S/4HANA conversion",
            "sap_context": "Transaction BP, table BUT000",
        }
    ]
})

VALID_REMEDIATIONS = json.dumps({
    "remediations": [
        {
            "check_id": "BP001",
            "module": "business_partner",
            "severity": "critical",
            "fix_steps": ["1. Run transaction BP."],
            "sap_transaction": "BP",
            "estimated_effort": "2 person-days",
        }
    ]
})

VALID_READINESS = json.dumps({
    "module": "business_partner",
    "blockers": ["BP type missing blocks conversion."],
    "conditions": ["Resolve email completeness."],
})

EXEC_SUMMARY = "Assessment shows conditional readiness. Critical BP data gaps must be resolved before migration."


@patch("agents.report_agent.get_llm")
@patch("agents.readiness.get_llm")
@patch("agents.remediation.get_llm")
@patch("agents.analyst.get_llm")
def test_graph_full_run(mock_analyst_llm, mock_rem_llm, mock_ready_llm, mock_report_llm):
    """Full mock of all four sub-agents — graph runs to END, state is complete."""
    # Configure mocks
    for mock_fn, response in [
        (mock_analyst_llm, VALID_ROOT_CAUSES),
        (mock_rem_llm, VALID_REMEDIATIONS),
        (mock_ready_llm, VALID_READINESS),
        (mock_report_llm, EXEC_SUMMARY),
    ]:
        mock_llm = MagicMock()
        mock_llm.invoke.return_value = MagicMock(content=response)
        mock_fn.return_value = mock_llm

    from agents.orchestrator import graph

    initial = _make_initial_state()
    final = graph.invoke(initial)

    assert final.get("error") is None
    assert len(final.get("root_causes", [])) > 0
    assert len(final.get("remediations", [])) > 0
    assert final.get("readiness_scores", {}).get("business_partner") is not None
    assert final.get("report") is not None
    assert final["report"]["migration_readiness"]["overall_status"] in ("go", "no-go", "conditional")


@patch("agents.analyst.get_llm")
def test_graph_analyst_error_routes_to_end(mock_analyst_llm):
    """Analyst sets error → graph routes to END, remediation not called."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content="not json")
    mock_analyst_llm.return_value = mock_llm

    from agents.orchestrator import graph

    initial = _make_initial_state()
    final = graph.invoke(initial)

    assert final.get("error") is not None
    assert "invalid JSON" in final["error"]
    # Remediation should not have been called — remediations stays empty
    assert final.get("remediations") == []
    assert final.get("report") is None

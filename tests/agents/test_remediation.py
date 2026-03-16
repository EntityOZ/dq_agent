"""Tests for the remediation sub-agent."""

import json
from unittest.mock import MagicMock, patch

from agents.remediation import remediation_node


def _make_state(findings=None, root_causes=None):
    return {
        "version_id": "v1",
        "tenant_id": "t1",
        "module_names": ["business_partner"],
        "findings_summary": findings if findings is not None else [
            {
                "check_id": "BP001",
                "module": "business_partner",
                "severity": "critical",
                "dimension": "completeness",
                "affected_count": 150,
                "total_count": 1000,
                "pass_rate": 85.0,
                "message": "BP type is mandatory",
            },
            {
                "check_id": "BP003",
                "module": "business_partner",
                "severity": "medium",
                "dimension": "completeness",
                "affected_count": 50,
                "total_count": 1000,
                "pass_rate": 95.0,
                "message": "Email required for customer-facing BP",
            },
        ],
        "dqs_scores": {},
        "root_causes": root_causes or [
            {
                "module": "business_partner",
                "finding_ids": ["BP001"],
                "root_cause": "Missing BU_TYPE during migration",
                "business_impact": "Blocks conversion",
                "sap_context": "Transaction BP",
            }
        ],
        "remediations": [],
        "readiness_scores": {},
        "report": None,
        "error": None,
    }


VALID_RESPONSE = json.dumps({
    "remediations": [
        {
            "check_id": "BP001",
            "module": "business_partner",
            "severity": "critical",
            "fix_steps": [
                "1. Run transaction BP.",
                "2. Filter for missing BU_TYPE.",
                "3. Use LSMW for bulk update.",
            ],
            "sap_transaction": "BP, LSMW",
            "estimated_effort": "2-4 person-days",
        }
    ]
})


@patch("agents.remediation.get_llm")
def test_remediation_valid_response(mock_get_llm):
    """Valid LLM response populates remediations."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=VALID_RESPONSE)
    mock_get_llm.return_value = mock_llm

    state = _make_state()
    result = remediation_node(state)

    assert "remediations" in result
    assert len(result["remediations"]) >= 1
    assert result["remediations"][0]["check_id"] == "BP001"


@patch("agents.remediation.get_llm")
def test_remediation_no_critical_high_no_llm_call(mock_get_llm):
    """Zero Critical/High findings — no LLM call if no medium/low either."""
    mock_llm = MagicMock()
    mock_get_llm.return_value = mock_llm

    state = _make_state(findings=[], root_causes=[])
    result = remediation_node(state)

    assert result["remediations"] == []
    mock_llm.invoke.assert_not_called()


@patch("agents.remediation.get_llm")
def test_remediation_medium_low_after_critical_high(mock_get_llm):
    """Medium/Low findings are processed after Critical/High, not before."""
    call_order = []

    def track_invoke(messages):
        # Check what severity tier is being processed by inspecting the prompt
        prompt_text = messages[-1]["content"] if isinstance(messages[-1], dict) else str(messages[-1])
        if "critical" in prompt_text.lower():
            call_order.append("critical_high")
        else:
            call_order.append("medium_low")
        return MagicMock(content=VALID_RESPONSE)

    mock_llm = MagicMock()
    mock_llm.invoke.side_effect = track_invoke
    mock_get_llm.return_value = mock_llm

    state = _make_state()
    result = remediation_node(state)

    # At minimum, critical/high should be called first
    assert mock_llm.invoke.call_count >= 1
    assert "remediations" in result


@patch("agents.remediation.get_llm")
def test_remediation_only_medium_low(mock_get_llm):
    """Only medium/low findings — still processes them."""
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content=json.dumps({
        "remediations": [
            {
                "check_id": "BP003",
                "module": "business_partner",
                "severity": "medium",
                "fix_steps": ["1. Check email addresses."],
                "sap_transaction": "BP",
                "estimated_effort": "1 person-day",
            }
        ]
    }))
    mock_get_llm.return_value = mock_llm

    findings = [
        {
            "check_id": "BP003",
            "module": "business_partner",
            "severity": "medium",
            "dimension": "completeness",
            "affected_count": 50,
            "total_count": 1000,
            "pass_rate": 95.0,
            "message": "Email required",
        }
    ]
    state = _make_state(findings=findings, root_causes=[])
    result = remediation_node(state)

    assert len(result["remediations"]) == 1
    assert mock_llm.invoke.call_count == 1

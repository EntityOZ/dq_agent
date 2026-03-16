"""Remediation sub-agent — generates SAP-specific fix steps per finding.

Processes Critical and High severity findings first, then Medium and Low.
Each severity tier is handled in a separate LLM call for focus.
"""

import json
import logging

from jinja2 import Template

from agents.prompts import REMEDIATION_SYSTEM, REMEDIATION_USER_TEMPLATE
from agents.state import AgentState
from llm.provider import get_llm

logger = logging.getLogger("vantax.agents.remediation")


def _render_user_prompt(findings: list[dict], root_causes: list[dict]) -> str:
    template = Template(REMEDIATION_USER_TEMPLATE)
    return template.render(
        findings_json=json.dumps(findings, indent=2),
        root_causes_json=json.dumps(root_causes, indent=2),
    )


def _parse_response(content: str) -> list[dict] | None:
    """Parse LLM response JSON. Returns None on failure."""
    try:
        text = content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        data = json.loads(text)
        return data.get("remediations", [])
    except (json.JSONDecodeError, AttributeError):
        return None


def _get_findings_by_severity(findings: list[dict], severities: list[str]) -> list[dict]:
    """Filter findings by severity levels."""
    return [f for f in findings if f.get("severity") in severities]


def _get_relevant_root_causes(root_causes: list[dict], finding_ids: set[str]) -> list[dict]:
    """Get root causes that reference any of the given finding IDs."""
    relevant = []
    for rc in root_causes:
        if set(rc.get("finding_ids", [])) & finding_ids:
            relevant.append(rc)
    return relevant


def _call_llm_for_tier(
    llm, findings: list[dict], root_causes: list[dict]
) -> tuple[list[dict] | None, str | None]:
    """Call LLM for a single severity tier. Returns (remediations, error)."""
    if not findings:
        return [], None

    user_prompt = _render_user_prompt(findings, root_causes)
    messages = [
        {"role": "system", "content": REMEDIATION_SYSTEM},
        {"role": "user", "content": user_prompt},
    ]

    try:
        response = llm.invoke(messages)
        remediations = _parse_response(response.content)

        if remediations is None:
            # Retry once
            logger.warning("Remediation: invalid JSON on first attempt, retrying")
            retry_messages = messages + [
                {"role": "assistant", "content": response.content},
                {"role": "user", "content": "Your response was not valid JSON. Please respond with ONLY valid JSON matching the schema. No markdown, no explanation."},
            ]
            response = llm.invoke(retry_messages)
            remediations = _parse_response(response.content)

            if remediations is None:
                return None, "Remediation agent failed: LLM returned invalid JSON after retry"

        return remediations, None

    except Exception as e:
        logger.error(f"Remediation LLM call failed: {e}")
        return None, f"Remediation agent failed: {e}"


def remediation_node(state: AgentState) -> dict:
    """LangGraph node: generate remediation steps by severity tier."""
    findings = state.get("findings_summary", [])
    root_causes = state.get("root_causes", [])

    # Process Critical and High first
    crit_high = _get_findings_by_severity(findings, ["critical", "high"])

    if not crit_high:
        # No Critical/High — check Medium/Low
        med_low = _get_findings_by_severity(findings, ["medium", "low", "warning"])
        if not med_low:
            return {"remediations": []}

        llm = get_llm()
        finding_ids = {f["check_id"] for f in med_low}
        relevant_rc = _get_relevant_root_causes(root_causes, finding_ids)
        remediations, error = _call_llm_for_tier(llm, med_low, relevant_rc)
        if error:
            return {"error": error}
        return {"remediations": remediations or []}

    llm = get_llm()

    # Tier 1: Critical and High
    crit_high_ids = {f["check_id"] for f in crit_high}
    relevant_rc = _get_relevant_root_causes(root_causes, crit_high_ids)
    remediations_tier1, error = _call_llm_for_tier(llm, crit_high, relevant_rc)
    if error:
        return {"error": error}

    all_remediations = list(remediations_tier1 or [])

    # Tier 2: Medium and Low — only after Critical/High are done
    med_low = _get_findings_by_severity(findings, ["medium", "low", "warning"])
    if med_low:
        med_low_ids = {f["check_id"] for f in med_low}
        relevant_rc_ml = _get_relevant_root_causes(root_causes, med_low_ids)
        remediations_tier2, error = _call_llm_for_tier(llm, med_low, relevant_rc_ml)
        if error:
            # Log but don't fail — Critical/High already processed
            logger.warning(f"Medium/Low remediation failed: {error}")
        else:
            all_remediations.extend(remediations_tier2 or [])

    # Normalise check_ids to match what was in the input findings
    input_ids = {f["check_id"] for f in findings}
    for rem in all_remediations:
        if rem.get("check_id") not in input_ids:
            normalised = rem["check_id"].replace("-", "").replace("_", "").upper()
            match = next(
                (cid for cid in input_ids
                 if cid.replace("-", "").replace("_", "").upper() == normalised),
                None,
            )
            if match:
                logger.info(f"Normalised check_id '{rem['check_id']}' -> '{match}'")
                rem["check_id"] = match
            else:
                logger.warning(f"Could not match check_id: {rem['check_id']}")

    logger.info(f"Remediation: generated {len(all_remediations)} remediations")
    return {"remediations": all_remediations}

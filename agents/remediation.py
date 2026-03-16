"""Remediation sub-agent — cross-finding analysis, effort estimation, sequencing.

Per-field fix instructions are now generated deterministically by the fix generator.
This agent focuses on patterns across findings, realistic effort estimates, fix
sequencing, and flagging cases where deterministic fixes may not apply.
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


def _parse_response(content: str) -> dict | None:
    """Parse LLM response JSON. Returns None on failure."""
    try:
        text = content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        data = json.loads(text)
        # Validate expected keys exist
        if not isinstance(data, dict):
            return None
        return data
    except (json.JSONDecodeError, AttributeError):
        return None


def _call_llm(
    llm, findings: list[dict], root_causes: list[dict]
) -> tuple[dict | None, str | None]:
    """Call LLM for cross-finding analysis. Returns (result_dict, error)."""
    if not findings:
        return {
            "cross_finding_patterns": [],
            "effort_estimates": [],
            "fix_sequence": [],
            "flags": [],
        }, None

    user_prompt = _render_user_prompt(findings, root_causes)
    messages = [
        {"role": "system", "content": REMEDIATION_SYSTEM},
        {"role": "user", "content": user_prompt},
    ]

    try:
        response = llm.invoke(messages)
        result = _parse_response(response.content)

        if result is None:
            # Retry once
            logger.warning("Remediation: invalid JSON on first attempt, retrying")
            retry_messages = messages + [
                {"role": "assistant", "content": response.content},
                {"role": "user", "content": "Your response was not valid JSON. Please respond with ONLY valid JSON matching the schema. No markdown, no explanation."},
            ]
            response = llm.invoke(retry_messages)
            result = _parse_response(response.content)

            if result is None:
                return None, "Remediation agent failed: LLM returned invalid JSON after retry"

        return result, None

    except Exception as e:
        logger.error(f"Remediation LLM call failed: {e}")
        return None, f"Remediation agent failed: {e}"


def remediation_node(state: AgentState) -> dict:
    """LangGraph node: cross-finding analysis, effort estimation, sequencing."""
    findings = state.get("findings_summary", [])
    root_causes = state.get("root_causes", [])

    if not findings:
        return {"remediations": {
            "cross_finding_patterns": [],
            "effort_estimates": [],
            "fix_sequence": [],
            "flags": [],
        }}

    llm = get_llm()
    result, error = _call_llm(llm, findings, root_causes)

    if error:
        return {"error": error}

    # Normalise check_ids in effort_estimates and fix_sequence
    input_ids = {f["check_id"] for f in findings}
    for section_key in ("effort_estimates", "fix_sequence", "flags"):
        for item in result.get(section_key, []):
            cid = item.get("check_id", "")
            if cid and cid not in input_ids:
                normalised = cid.replace("-", "").replace("_", "").upper()
                match = next(
                    (iid for iid in input_ids
                     if iid.replace("-", "").replace("_", "").upper() == normalised),
                    None,
                )
                if match:
                    logger.info(f"Normalised check_id '{cid}' -> '{match}'")
                    item["check_id"] = match
                else:
                    logger.warning(f"Could not match check_id: {cid}")

    logger.info(
        f"Remediation: {len(result.get('cross_finding_patterns', []))} patterns, "
        f"{len(result.get('effort_estimates', []))} estimates, "
        f"{len(result.get('fix_sequence', []))} sequence items"
    )
    return {"remediations": result}

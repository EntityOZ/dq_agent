"""NLP query service — intent classification, data retrieval, answer synthesis.

Uses the existing get_llm() provider. Never passes raw SAP record data to the LLM —
only aggregated statistics and finding summaries.
"""

import json
import logging
import re
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from llm.provider import get_llm

logger = logging.getLogger("vantax.nlp")

INTENT_SYSTEM_PROMPT = (
    "You are a data quality assistant for SAP systems. "
    "Classify the user question into one of these intents: "
    "findings_query, cleaning_query, exception_query, analytics_query, module_status, general. "
    "Also extract any filters mentioned (module name, severity, date range, status). "
    'Respond in JSON only: {"intent": "...", "filters": {"module": null, "severity": null, '
    '"date_from": null, "date_to": null, "status": null}, '
    '"answer_type": "table|chart|summary"}'
)

ANSWER_SYSTEM_PROMPT = (
    "You are Vantax, a data quality assistant for SAP systems. "
    "Given the retrieved data context below, answer the user's question conversationally "
    "in 2-3 sentences maximum. Be specific with numbers. "
    "If the data includes a list, also output a structured JSON array under the key 'data'. "
    "Respond in JSON: {\"answer\": \"...\", \"data\": [...] or null, \"chart_type\": \"bar|line|pie\" or null}"
)

MAX_RETRIEVE = 50


def _strip_json_fences(text_str: str) -> str:
    """Remove markdown code fences from LLM output."""
    cleaned = re.sub(r"^```(?:json)?\s*\n?", "", text_str.strip())
    cleaned = re.sub(r"\n?```\s*$", "", cleaned)
    return cleaned.strip()


def _safe_parse_json(text_str: str) -> dict:
    """Parse JSON from LLM output, stripping fences if needed."""
    try:
        return json.loads(_strip_json_fences(text_str))
    except json.JSONDecodeError:
        return {}


async def _classify_intent(question: str) -> dict:
    """Step 1: Classify user intent and extract filters."""
    llm = get_llm()
    from langchain_core.messages import SystemMessage, HumanMessage

    response = llm.invoke([
        SystemMessage(content=INTENT_SYSTEM_PROMPT),
        HumanMessage(content=question),
    ])
    parsed = _safe_parse_json(response.content)
    return {
        "intent": parsed.get("intent", "general"),
        "filters": parsed.get("filters", {}),
        "answer_type": parsed.get("answer_type", "summary"),
    }


async def _retrieve_findings(
    db: AsyncSession, tenant_id: str, filters: dict
) -> list[dict]:
    """Retrieve finding summaries (never raw record data)."""
    conditions = ["f.tenant_id = :tid"]
    params: dict = {"tid": tenant_id}

    if filters.get("module"):
        conditions.append("f.module = :module")
        params["module"] = filters["module"]
    if filters.get("severity"):
        conditions.append("f.severity = :severity")
        params["severity"] = filters["severity"]

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT f.id, f.module, f.check_id, f.severity, f.dimension,
                   f.affected_count, f.total_count, f.pass_rate,
                   f.details->>'message' as message, f.created_at
            FROM findings f
            JOIN analysis_versions v ON f.version_id = v.id
            WHERE {where}
            ORDER BY f.created_at DESC
            LIMIT :lim
        """),
        {**params, "lim": MAX_RETRIEVE},
    )
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_cleaning(
    db: AsyncSession, tenant_id: str, filters: dict
) -> list[dict]:
    """Retrieve cleaning queue summaries (no raw record_data_before/after)."""
    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": tenant_id}

    if filters.get("status"):
        conditions.append("status = :status")
        params["status"] = filters["status"]

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT id, object_type, status, confidence, record_key,
                   priority, detected_at, applied_at
            FROM cleaning_queue
            WHERE {where}
            ORDER BY detected_at DESC
            LIMIT :lim
        """),
        {**params, "lim": MAX_RETRIEVE},
    )
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_exceptions(
    db: AsyncSession, tenant_id: str, filters: dict
) -> list[dict]:
    """Retrieve exception summaries."""
    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": tenant_id}

    if filters.get("severity"):
        conditions.append("severity = :severity")
        params["severity"] = filters["severity"]
    if filters.get("status"):
        conditions.append("status = :status")
        params["status"] = filters["status"]

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT id, type, category, severity, status, title, description,
                   estimated_impact_zar, escalation_tier, sla_deadline, created_at
            FROM exceptions
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT :lim
        """),
        {**params, "lim": MAX_RETRIEVE},
    )
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_analytics(
    db: AsyncSession, tenant_id: str, filters: dict
) -> list[dict]:
    """Retrieve DQS history and module status."""
    result = await db.execute(
        text("""
            SELECT module_id, dqs_score, completeness, accuracy, consistency,
                   timeliness, uniqueness, validity, finding_count, recorded_at
            FROM dqs_history
            WHERE tenant_id = :tid
            ORDER BY recorded_at DESC
            LIMIT :lim
        """),
        {"tid": tenant_id, "lim": MAX_RETRIEVE},
    )
    return [dict(r._mapping) for r in result.fetchall()]


async def _retrieve_module_status(
    db: AsyncSession, tenant_id: str, filters: dict
) -> list[dict]:
    """Retrieve latest DQS per module from the most recent version."""
    result = await db.execute(
        text("""
            SELECT DISTINCT ON (module_id) module_id, dqs_score,
                   completeness, accuracy, consistency, timeliness,
                   uniqueness, validity, finding_count, recorded_at
            FROM dqs_history
            WHERE tenant_id = :tid
            ORDER BY module_id, recorded_at DESC
        """),
        {"tid": tenant_id},
    )
    return [dict(r._mapping) for r in result.fetchall()]


_RETRIEVERS = {
    "findings_query": _retrieve_findings,
    "cleaning_query": _retrieve_cleaning,
    "exception_query": _retrieve_exceptions,
    "analytics_query": _retrieve_analytics,
    "module_status": _retrieve_module_status,
    "general": _retrieve_findings,
}


async def _synthesise_answer(
    question: str, intent: str, data: list[dict], answer_type: str
) -> dict:
    """Step 3: LLM synthesises a conversational answer from retrieved data."""
    llm = get_llm()
    from langchain_core.messages import SystemMessage, HumanMessage

    # Serialise data — convert non-serialisable types
    safe_data = []
    for row in data[:20]:  # Cap context to 20 rows for LLM
        safe_row = {}
        for k, v in row.items():
            if hasattr(v, "isoformat"):
                safe_row[k] = v.isoformat()
            elif isinstance(v, (int, float, str, bool, type(None))):
                safe_row[k] = v
            else:
                safe_row[k] = str(v)
        safe_data.append(safe_row)

    context = (
        f"Intent: {intent}\n"
        f"Answer type requested: {answer_type}\n"
        f"Retrieved {len(data)} records. Sample:\n"
        f"{json.dumps(safe_data[:10], indent=2, default=str)}"
    )

    response = llm.invoke([
        SystemMessage(content=ANSWER_SYSTEM_PROMPT),
        HumanMessage(content=f"Data context:\n{context}\n\nUser question: {question}"),
    ])

    parsed = _safe_parse_json(response.content)
    return {
        "answer": parsed.get("answer", response.content[:500]),
        "data": parsed.get("data"),
        "chart_type": parsed.get("chart_type"),
    }


async def process_query(
    question: str, tenant_context: dict, db: AsyncSession
) -> dict:
    """Main NLP query pipeline: classify → retrieve → synthesise.

    Args:
        question: Natural language question from the user.
        tenant_context: Must contain 'tenant_id'.
        db: Active async database session with RLS already set.

    Returns:
        {answer: str, sources: [{type, id, relevance}], data?: list, chart_type?: str}
    """
    tenant_id = str(tenant_context["tenant_id"])

    # Step 1 — Intent classification
    classification = await _classify_intent(question)
    intent = classification["intent"]
    filters = classification["filters"]
    answer_type = classification["answer_type"]

    logger.info(f"NLP query: intent={intent}, filters={filters}, answer_type={answer_type}")

    # Step 2 — Data retrieval
    retriever = _RETRIEVERS.get(intent, _retrieve_findings)
    data = await retriever(db, tenant_id, filters)

    # Build sources list
    sources = []
    for row in data[:10]:
        source_type = intent.replace("_query", "").replace("_status", "")
        sources.append({
            "type": source_type,
            "id": str(row.get("id", "")),
            "relevance": "direct",
        })

    # Step 3 — Answer synthesis
    synthesis = await _synthesise_answer(question, intent, data, answer_type)

    return {
        "answer": synthesis["answer"],
        "sources": sources,
        "data": synthesis.get("data"),
        "chart_type": synthesis.get("chart_type"),
    }

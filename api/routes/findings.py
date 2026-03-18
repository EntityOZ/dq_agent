import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from db.schema import Finding, Report

router = APIRouter(prefix="/api/v1", tags=["findings"])
logger = logging.getLogger("vantax.findings")


@router.get("/findings")
async def list_findings(
    version_id: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    dimension: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = '{tenant.id}'"))

    filters_applied: dict = {}
    base = select(Finding).where(Finding.tenant_id == tenant.id)

    if version_id:
        vid = uuid.UUID(version_id)
        base = base.where(Finding.version_id == vid)
        filters_applied["version_id"] = version_id

    if module:
        base = base.where(Finding.module == module)
        filters_applied["module"] = module
    if severity:
        base = base.where(Finding.severity == severity)
        filters_applied["severity"] = severity
    if dimension:
        base = base.where(Finding.dimension == dimension)
        filters_applied["dimension"] = dimension

    # Get total count
    count_stmt = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_stmt)).scalar() or 0

    # Get paginated results — worst findings first
    severity_order = case(
        (Finding.severity == "critical", 1),
        (Finding.severity == "high", 2),
        (Finding.severity == "medium", 3),
        (Finding.severity == "low", 4),
        else_=5,
    )
    stmt = base.order_by(severity_order, Finding.pass_rate.asc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    findings = result.scalars().all()

    return {
        "findings": [
            {
                "id": str(f.id),
                "module": f.module,
                "check_id": f.check_id,
                "severity": f.severity,
                "dimension": f.dimension,
                "affected_count": f.affected_count,
                "total_count": f.total_count,
                "pass_rate": float(f.pass_rate) if f.pass_rate is not None else None,
                "details": f.details or {},
                "remediation_text": f.remediation_text,
                "rule_context": f.rule_context,
                "value_fix_map": f.value_fix_map,
                "record_fixes": f.record_fixes,
                "created_at": f.created_at.isoformat() if f.created_at else None,
            }
            for f in findings
        ],
        "total": total,
        "filters_applied": filters_applied,
    }


@router.get("/findings/{finding_id}/report-context")
async def get_finding_report_context(
    finding_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Return report-level context for a single finding (cross-finding patterns,
    effort estimates, fix sequencing) extracted from the report JSON."""
    await db.execute(text(f"SET app.tenant_id = '{tenant.id}'"))
    fid = uuid.UUID(finding_id)

    # Get the finding
    result = await db.execute(
        select(Finding).where(Finding.id == fid, Finding.tenant_id == tenant.id)
    )
    finding = result.scalar_one_or_none()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")

    # Get the report for this version
    report_result = await db.execute(
        select(Report).where(
            Report.version_id == finding.version_id,
            Report.tenant_id == tenant.id,
        )
    )
    report = report_result.scalar_one_or_none()
    report_json = report.report_json if report else None

    # Extract context relevant to this finding's check_id
    report_context = None
    if report_json:
        check_id = finding.check_id
        remediations = report_json.get("remediations", {})

        # Extract cross_finding_patterns that include this check_id
        cross_patterns = [
            p for p in remediations.get("cross_finding_patterns", [])
            if check_id in p.get("affected_check_ids", [])
        ]

        # Extract effort estimate for this check_id
        effort_estimate = next(
            (e for e in remediations.get("effort_estimates", [])
             if e.get("check_id") == check_id),
            None,
        )

        # Extract fix sequence position for this check_id
        fix_sequence = next(
            (s for s in remediations.get("fix_sequence", [])
             if s.get("check_id") == check_id),
            None,
        )

        # Extract flags for this check_id
        flags = [
            f for f in remediations.get("flags", [])
            if f.get("check_id") == check_id
        ]

        report_context = {
            "cross_finding_patterns": cross_patterns,
            "effort_estimate": effort_estimate,
            "fix_sequence": fix_sequence,
            "flags": flags,
            "executive_summary": report_json.get("executive_summary"),
        }

    return {
        "finding_id": str(finding.id),
        "check_id": finding.check_id,
        "module": finding.module,
        "report_context": report_context,
    }

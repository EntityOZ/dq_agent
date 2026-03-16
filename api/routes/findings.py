import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from db.schema import Finding

router = APIRouter(prefix="/api/v1", tags=["findings"])
logger = logging.getLogger("vantax.findings")


@router.get("/findings")
async def list_findings(
    version_id: str = Query(...),
    module: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    dimension: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = '{tenant.id}'"))
    vid = uuid.UUID(version_id)

    filters_applied = {"version_id": version_id}
    base = select(Finding).where(
        Finding.tenant_id == tenant.id,
        Finding.version_id == vid,
    )

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

    # Get paginated results
    stmt = base.offset(offset).limit(limit)
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
                "details": f.details,
                "remediation_text": f.remediation_text,
                "created_at": f.created_at.isoformat() if f.created_at else None,
            }
            for f in findings
        ],
        "total": total,
        "filters_applied": filters_applied,
    }

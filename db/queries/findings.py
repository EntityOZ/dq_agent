import uuid
from typing import Optional

from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.schema import Finding


class FindingCreate(BaseModel):
    module: str
    check_id: str
    severity: str
    dimension: str
    affected_count: int
    total_count: int
    pass_rate: float | None = None
    details: dict | None = None
    remediation_text: str | None = None


async def bulk_insert_findings(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    version_id: uuid.UUID,
    findings: list[FindingCreate],
) -> int:
    await db.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
    db_findings = [
        Finding(
            tenant_id=tenant_id,
            version_id=version_id,
            module=f.module,
            check_id=f.check_id,
            severity=f.severity,
            dimension=f.dimension,
            affected_count=f.affected_count,
            total_count=f.total_count,
            pass_rate=f.pass_rate,
            details=f.details,
            remediation_text=f.remediation_text,
        )
        for f in findings
    ]
    db.add_all(db_findings)
    await db.commit()
    return len(db_findings)


async def get_findings(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    version_id: uuid.UUID,
    severity: Optional[str] = None,
    module: Optional[str] = None,
) -> list[Finding]:
    await db.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
    stmt = select(Finding).where(
        Finding.tenant_id == tenant_id,
        Finding.version_id == version_id,
    )
    if severity:
        stmt = stmt.where(Finding.severity == severity)
    if module:
        stmt = stmt.where(Finding.module == module)
    result = await db.execute(stmt)
    return list(result.scalars().all())

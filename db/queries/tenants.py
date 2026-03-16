import uuid
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.schema import Tenant


async def get_tenant_by_id(db: AsyncSession, tenant_id: uuid.UUID) -> Optional[Tenant]:
    await db.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    return result.scalar_one_or_none()


async def create_tenant(
    db: AsyncSession, name: str, licensed_modules: list[str]
) -> Tenant:
    tenant = Tenant(name=name, licensed_modules=licensed_modules)
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)
    return tenant

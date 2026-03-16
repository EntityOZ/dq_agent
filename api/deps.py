import uuid
from typing import AsyncGenerator

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.config import settings

engine = create_async_engine(settings.database_url, echo=False)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session


class Tenant:
    def __init__(self, id: uuid.UUID, name: str, licensed_modules: list[str]):
        self.id = id
        self.name = name
        self.licensed_modules = licensed_modules


# Hardcoded dev tenant for AUTH_MODE=local
_DEV_TENANT = Tenant(
    id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
    name="Dev Tenant",
    licensed_modules=["business_partner", "material_master", "fi_gl"],
)


async def get_tenant(request: Request) -> Tenant:
    if settings.auth_mode == "local":
        return _DEV_TENANT

    # Phase 4 will implement JWT extraction via Clerk
    # For now, return dev tenant as fallback
    return _DEV_TENANT

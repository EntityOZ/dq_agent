"""Routes for report download."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.storage import download_file
from api.config import settings
from db.schema import Report

router = APIRouter(prefix="/api/v1", tags=["reports"])
logger = logging.getLogger("vantax.reports")


@router.get("/reports/{version_id}/download")
async def download_report(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Stream the PDF report from MinIO."""
    await db.execute(text(f"SET app.tenant_id = '{tenant.id}'"))
    vid = uuid.UUID(version_id)

    result = await db.execute(
        select(Report).where(
            Report.tenant_id == tenant.id,
            Report.version_id == vid,
        )
    )
    report = result.scalar_one_or_none()

    if not report or not report.pdf_path:
        raise HTTPException(status_code=404, detail="PDF report not found for this version")

    try:
        bucket = settings.minio_bucket_reports
        pdf_bytes = download_file(bucket, report.pdf_path)
    except Exception as e:
        logger.error(f"Failed to download PDF from MinIO: {e}")
        raise HTTPException(status_code=404, detail="PDF file not found in storage")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="vantax_dq_report_{version_id}.pdf"'
        },
    )

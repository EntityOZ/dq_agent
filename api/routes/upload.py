import io
import logging
import uuid

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.deps import Tenant, get_db, get_tenant
from api.services.column_mapper import apply_column_mapping, get_required_fields
from api.services.storage import upload_file as minio_upload

router = APIRouter(prefix="/api/v1", tags=["upload"])
logger = logging.getLogger("vantax.upload")

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    module: str = Form(...),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Upload a CSV or Excel file for analysis."""
    # Step 1-2: Validate file size and MIME type
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=422, detail={"error": "file_too_large", "detail": f"Max file size is 100MB"})

    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in ("csv", "xlsx", "xls"):
        content_type = file.content_type or ""
        if "csv" not in content_type and "excel" not in content_type and "spreadsheet" not in content_type:
            raise HTTPException(status_code=422, detail={"error": "invalid_file_type", "detail": "Only CSV and Excel files are supported"})

    # Step 3: Store raw file in MinIO
    file_id = str(uuid.uuid4())
    object_name = f"uploads/{tenant.id}/{file_id}.{ext}"
    minio_upload(settings.minio_bucket_uploads, object_name, content, file.content_type or "application/octet-stream")
    logger.info(f"Stored raw file: {object_name}")

    # Step 4: Read into DataFrame
    try:
        if ext == "csv":
            try:
                df = pd.read_csv(io.BytesIO(content), encoding="utf-8")
            except UnicodeDecodeError:
                df = pd.read_csv(io.BytesIO(content), encoding="latin-1")
        elif ext in ("xlsx", "xls"):
            df = pd.read_excel(io.BytesIO(content))
        else:
            raise ValueError(f"Unsupported file extension: {ext}")
    except Exception as e:
        raise HTTPException(status_code=422, detail={"error": "unparseable_file", "detail": str(e)})

    # Step 5: Apply column mapping
    df = apply_column_mapping(df, module)

    # Step 6: Validate required columns
    required_fields = get_required_fields(module)
    if required_fields:
        present = set(df.columns)
        missing = []
        for field in required_fields:
            # Accept either "TABLE.FIELD" or just "FIELD"
            short_name = field.split(".")[-1] if "." in field else field
            if field not in present and short_name not in present:
                missing.append(field)
        if missing:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "missing_required_columns",
                    "missing_columns": sorted(missing),
                    "available_columns": sorted(list(present)),
                },
            )

    # Step 7: Store cleaned parquet to MinIO
    parquet_buffer = io.BytesIO()
    df.to_parquet(parquet_buffer, index=False)
    parquet_bytes = parquet_buffer.getvalue()
    parquet_path = f"staging/{tenant.id}/{file_id}.parquet"
    minio_upload(settings.minio_bucket_uploads, parquet_path, parquet_bytes, "application/octet-stream")
    logger.info(f"Stored parquet: {parquet_path}")

    # Step 8: Create analysis_versions record
    from db.queries.versions import create_version

    metadata = {
        "file_name": filename,
        "row_count": len(df),
        "columns": list(df.columns),
        "modules": [module],
        "parquet_path": parquet_path,
    }
    version = await create_version(db, tenant.id, metadata)
    logger.info(f"Created version: {version.id}")

    # Step 9: Enqueue Celery task
    from workers.tasks.run_checks import run_checks

    job = run_checks.delay(str(version.id), str(tenant.id), parquet_path)
    logger.info(f"Enqueued run_checks: job_id={job.id}")

    # Step 10: Return immediately
    return {
        "version_id": str(version.id),
        "job_id": job.id,
        "status": "pending",
    }

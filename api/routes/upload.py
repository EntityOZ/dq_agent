import io
import logging
import re
import uuid

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.deps import Tenant, get_db, get_tenant
from api.services.column_mapper import apply_column_mapping, get_required_fields
from api.services.storage import upload_file as minio_upload

router = APIRouter(prefix="/api/v1", tags=["upload"])
logger = logging.getLogger("meridian.upload")

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB
_CHUNK_SIZE = 8 * 1024  # 8 KB


class UploadResponse(BaseModel):
    version_id: str
    job_id: str
    status: str


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    module: str = Form(...),
    column_mapping: str = Form(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Upload a CSV or Excel file for analysis."""
    # Step 1-2: Read in chunks — abort early if file exceeds MAX_FILE_SIZE (OOM prevention)
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=422,
                detail={"error": "file_too_large", "detail": "Max file size is 100 MB"},
            )
        chunks.append(chunk)
    content = b"".join(chunks)

    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in ("csv", "xlsx", "xls"):
        content_type = file.content_type or ""
        if "csv" not in content_type and "excel" not in content_type and "spreadsheet" not in content_type:
            raise HTTPException(status_code=422, detail={"error": "invalid_file_type", "detail": "Only CSV and Excel files are supported"})

    # Validate magic bytes before parsing (prevents binary-as-CSV attacks)
    _validate_magic_bytes(content, ext)

    # Step 3: Store raw file in MinIO
    file_id = str(uuid.uuid4())
    object_name = f"uploads/{tenant.id}/{file_id}.{ext}"
    minio_upload(settings.minio_bucket_uploads, object_name, content, file.content_type or "application/octet-stream")
    logger.debug(f"Stored raw file: {object_name}")

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
            raise HTTPException(422, {"error": "invalid_file_type", "detail": "Unsupported extension"})
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"File parse failed for tenant {tenant.id}: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=422,
            detail={"error": "unparseable_file", "detail": "File could not be parsed. Ensure it is a valid CSV or Excel file."},
        )

    # Sanitise formula injection characters in string cells
    df = _sanitise_formula_injection(df)

    # Step 5a: Apply custom AI-detected column mapping (if provided)
    if column_mapping:
        try:
            import json as _json
            custom_map = _json.loads(column_mapping)
            if isinstance(custom_map, dict):
                rename_map = {src: tgt for src, tgt in custom_map.items() if src in df.columns}
                if rename_map:
                    df = df.rename(columns=rename_map)
                    logger.info(f"Applied {len(rename_map)} custom column mappings")
        except (ValueError, TypeError) as e:
            logger.warning(f"Invalid column_mapping JSON: {e}")

    # Step 5b: Apply standard column mapping (handles any remaining aliases)
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
    logger.debug(f"Stored parquet: {parquet_path}")

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

    logger.info(f"Upload complete: version={version.id}")

    # Step 10: Return immediately
    return UploadResponse(
        version_id=str(version.id),
        job_id=job.id,
        status="pending",
    )


# ── Security helpers ──────────────────────────────────────────────────────────

_FORMULA_PREFIX = re.compile(r"^[=+\-@]")


def _validate_magic_bytes(content: bytes, ext: str) -> None:
    """Verify file content matches declared extension via magic bytes."""
    if ext == "csv":
        if b"\x00" in content[:512]:
            raise HTTPException(
                422,
                {"error": "invalid_file_type", "detail": "File contains binary data — not a valid CSV"},
            )
    elif ext == "xlsx":
        if not content[:4] == b"PK\x03\x04":
            raise HTTPException(
                422,
                {"error": "invalid_file_type", "detail": "File is not a valid XLSX (ZIP) file"},
            )
    elif ext == "xls":
        if not content[:8] == b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1":
            raise HTTPException(
                422,
                {"error": "invalid_file_type", "detail": "File is not a valid XLS (OLE2) file"},
            )


def _sanitise_formula_injection(df: pd.DataFrame) -> pd.DataFrame:
    """Prefix formula-injection chars (=, +, -, @) with single quote in string cells."""
    injections_found = 0
    for col in df.select_dtypes(include="object").columns:
        mask = df[col].astype(str).str.match(_FORMULA_PREFIX)
        if mask.any():
            injections_found += mask.sum()
            df.loc[mask, col] = "'" + df.loc[mask, col].astype(str)
    if injections_found:
        logger.warning(f"Formula injection sanitised in {injections_found} cells")
    return df

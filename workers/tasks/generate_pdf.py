"""Celery task: generate PDF report from report JSON using WeasyPrint.

Loads report from Postgres, renders Jinja2 template, converts to PDF,
stores in MinIO, and updates the reports table with pdf_path.
"""

import io
import json
import logging
import os
import traceback

from jinja2 import Environment, FileSystemLoader
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

logger = logging.getLogger("vantax.worker.pdf")

# Template directory — resolve from project root
TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "templates")


def _get_sync_engine():
    url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return create_engine(url)


def _get_minio_client():
    from minio import Minio

    return Minio(
        endpoint=os.getenv("MINIO_ENDPOINT", "minio:9000"),
        access_key=os.getenv("MINIO_ACCESS_KEY", "vantax"),
        secret_key=os.getenv("MINIO_SECRET_KEY", ""),
        secure=False,
    )


@celery_app.task(bind=True, name="workers.tasks.generate_pdf.generate_pdf")
def generate_pdf(self, version_id: str, tenant_id: str):
    """Generate a PDF report and store it in MinIO."""
    logger.info(f"generate_pdf started: version_id={version_id}")

    engine = _get_sync_engine()

    try:
        # Step 1: Load report JSON from Postgres
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
            result = session.execute(
                text("SELECT report_json FROM reports WHERE version_id = :vid AND tenant_id = :tid ORDER BY generated_at DESC LIMIT 1"),
                {"vid": version_id, "tid": tenant_id},
            )
            row = result.fetchone()

        if not row or not row[0]:
            logger.warning(f"No report found for version {version_id}")
            return {"version_id": version_id, "status": "no_report"}

        report_json = row[0]

        # Step 2: Render HTML template with Jinja2
        env = Environment(loader=FileSystemLoader(TEMPLATE_DIR))
        template = env.get_template("executive_report.html")
        html_content = template.render(report=report_json)

        # Step 3: Convert to PDF using WeasyPrint
        from weasyprint import HTML

        pdf_bytes = HTML(
            string=html_content,
            base_url=TEMPLATE_DIR,
        ).write_pdf()

        # Step 4: Store PDF in MinIO
        bucket = os.getenv("MINIO_BUCKET_REPORTS", "vantax-reports")
        object_path = f"reports/{tenant_id}/{version_id}.pdf"

        minio_client = _get_minio_client()
        minio_client.put_object(
            bucket,
            object_path,
            io.BytesIO(pdf_bytes),
            length=len(pdf_bytes),
            content_type="application/pdf",
        )

        # Step 5: Update reports table with pdf_path
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
            session.execute(
                text("UPDATE reports SET pdf_path = :path WHERE version_id = :vid AND tenant_id = :tid"),
                {"path": object_path, "vid": version_id, "tid": tenant_id},
            )
            session.commit()

        logger.info(f"generate_pdf complete: {object_path} ({len(pdf_bytes)} bytes)")
        return {"version_id": version_id, "status": "complete", "pdf_path": object_path}

    except Exception as e:
        logger.error(f"generate_pdf failed: {traceback.format_exc()}")
        raise

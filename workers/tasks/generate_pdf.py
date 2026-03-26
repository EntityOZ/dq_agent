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

logger = logging.getLogger("meridian.worker.pdf")

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
        access_key=os.getenv("MINIO_ACCESS_KEY", "meridian"),
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

        # Step 1b: Load Phase A–G data for extended report sections
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))

            # Cleaning summary
            cleaning = session.execute(text("""
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
                       SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
                       SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) as applied
                FROM cleaning_queue
                WHERE version_id = :vid AND tenant_id = :tid
            """), {"vid": version_id, "tid": tenant_id}).fetchone()

            # Dedup summary (no version_id column on this table)
            dedup = session.execute(text("""
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
                       SUM(CASE WHEN status='merged' THEN 1 ELSE 0 END) as merged
                FROM dedup_candidates
                WHERE tenant_id = :tid
            """), {"tid": tenant_id}).fetchone()

            # Exceptions summary
            exceptions = session.execute(text("""
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END) as critical,
                       SUM(CASE WHEN severity='high' THEN 1 ELSE 0 END) as high,
                       SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open_count
                FROM exceptions
                WHERE tenant_id = :tid
            """), {"tid": tenant_id}).fetchone()

            # Financial impact
            impact = session.execute(text("""
                SELECT SUM(annual_risk_zar) as total_risk,
                       SUM(mitigated_zar) as total_avoidance,
                       COUNT(*) as record_count
                FROM impact_records
                WHERE version_id = :vid AND tenant_id = :tid
            """), {"vid": version_id, "tid": tenant_id}).fetchone()

            # Contracts summary
            contracts = session.execute(text("""
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
                       SUM(CASE WHEN status='breached' THEN 1 ELSE 0 END) as breached
                FROM contracts
                WHERE tenant_id = :tid
            """), {"tid": tenant_id}).fetchone()

            # DQS trend — last 10 runs
            dqs_trend = session.execute(text("""
                SELECT recorded_at, dqs_score, module_id
                FROM dqs_history
                WHERE tenant_id = :tid
                ORDER BY recorded_at DESC
                LIMIT 10
            """), {"tid": tenant_id}).fetchall()

            # Glossary terms — top 30 by linked rules count (Phase K)
            glossary_result = session.execute(text("""
                SELECT gt.sap_table, gt.sap_field, gt.business_name, gt.business_definition,
                       gt.mandatory_for_s4hana, COUNT(gtr.id) as rule_count
                FROM glossary_terms gt
                LEFT JOIN glossary_term_rules gtr ON gtr.term_id = gt.id AND gtr.tenant_id = gt.tenant_id
                WHERE gt.tenant_id = :tid
                GROUP BY gt.id
                ORDER BY rule_count DESC
                LIMIT 30
            """), {"tid": tenant_id})
            glossary_terms = [
                {"sap_table": r[0], "sap_field": r[1], "business_name": r[2],
                 "business_definition": r[3], "mandatory": r[4], "rule_count": r[5]}
                for r in glossary_result.fetchall()
            ]

            # MDM Health Score (Phase N) — omit section if table is empty or no rows
            mdm_snapshot = None
            try:
                mdm_result = session.execute(text("""
                    SELECT mdm_health_score, golden_record_coverage_pct,
                           avg_match_confidence, steward_sla_compliance_pct,
                           source_consistency_pct, ai_projected_score, ai_narrative
                    FROM mdm_metrics
                    WHERE tenant_id = :tid
                    ORDER BY snapshot_date DESC LIMIT 1
                """), {"tid": tenant_id})
                row = mdm_result.fetchone()
                if row:
                    mdm_snapshot = dict(row._mapping)
            except Exception as e:
                logger.warning(f"MDM metrics query failed for PDF: {e}")

            # Golden Record Summary (Phase I) — omit section if table is empty
            golden_summary = []
            try:
                gr_result = session.execute(text("""
                    SELECT domain, status, COUNT(*) as record_count
                    FROM master_records
                    WHERE tenant_id = :tid
                    GROUP BY domain, status
                    ORDER BY domain, status
                """), {"tid": tenant_id})
                golden_summary = [dict(r._mapping) for r in gr_result.fetchall()]
            except Exception as e:
                logger.warning(f"Golden records query failed for PDF: {e}")

        # Step 2: Render HTML template with Jinja2
        env = Environment(loader=FileSystemLoader(TEMPLATE_DIR))
        template = env.get_template("executive_report.html")
        html_content = template.render(
            report=report_json,
            cleaning=cleaning._asdict() if cleaning else {},
            dedup=dedup._asdict() if dedup else {},
            exceptions=exceptions._asdict() if exceptions else {},
            impact=impact._asdict() if impact else {},
            contracts=contracts._asdict() if contracts else {},
            dqs_trend=[{"recorded_at": str(r[0]), "dqs_score": float(r[1]) if r[1] else 0, "module_id": r[2]} for r in dqs_trend] if dqs_trend else [],
            glossary_terms=glossary_terms if glossary_terms else [],
            mdm_snapshot=mdm_snapshot,
            golden_summary=golden_summary,
        )

        # Step 3: Convert to PDF using WeasyPrint
        from weasyprint import HTML

        pdf_bytes = HTML(
            string=html_content,
            base_url=TEMPLATE_DIR,
        ).write_pdf()

        # Step 4: Store PDF in MinIO
        bucket = os.getenv("MINIO_BUCKET_REPORTS", "meridian-reports")
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

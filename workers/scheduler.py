"""Celery beat schedule — 5-trigger pipeline.

Triggers (all times SAST = UTC+2):
  1. daily_analysis    — 02:00 SAST (00:00 UTC) daily
  2. weekly_cleaning   — 03:00 SAST (01:00 UTC) Monday
  3. monthly_report    — 04:00 SAST (02:00 UTC) 1st of month
  4. daily_digest      — 06:00 SAST (04:00 UTC) daily
  5. weekly_archive    — 00:00 SAST (22:00 UTC Saturday) Sunday
"""

import gzip
import json
import logging
import os
from datetime import datetime, timedelta, timezone

from celery.schedules import crontab
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

logger = logging.getLogger("vantax.scheduler")

SAST = timezone(timedelta(hours=2))


def _get_sync_engine():
    url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return create_engine(url)


def _get_redis():
    import redis
    return redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))


def _get_tenants(session: Session) -> list[dict]:
    result = session.execute(text("SELECT id, name, licensed_modules, dqs_weights FROM tenants"))
    return [dict(r._mapping) for r in result.fetchall()]


def _set_rls(session: Session, tenant_id: str) -> None:
    session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))


# ── Trigger 1: daily_analysis — 02:00 SAST ──────────────────────────────────


@celery_app.task(name="workers.scheduler.daily_analysis")
def daily_analysis():
    """Re-run checks on latest data for each tenant, update DQS history and cache."""
    logger.info("Trigger 1: daily_analysis starting")
    engine = _get_sync_engine()

    with Session(engine) as session:
        tenants = _get_tenants(session)

    for tenant in tenants:
        tid = str(tenant["id"])
        try:
            with Session(engine) as session:
                _set_rls(session, tid)

                # Get latest complete version
                result = session.execute(
                    text("""
                        SELECT id, run_at, dqs_summary
                        FROM analysis_versions
                        WHERE tenant_id = :tid AND status IN ('complete', 'agents_complete')
                        ORDER BY run_at DESC LIMIT 1
                    """),
                    {"tid": tid},
                )
                row = result.fetchone()
                if not row:
                    logger.info(f"  tenant={tid}: no complete version, skipping")
                    continue

                version = dict(row._mapping)
                version_id = str(version["id"])
                today = datetime.now(SAST).date()

                run_date = version["run_at"]
                if hasattr(run_date, "date"):
                    run_date = run_date.date()
                if run_date >= today:
                    logger.info(f"  tenant={tid}: already ran today, skipping")
                    continue

                # Enqueue run_checks
                from workers.tasks.run_checks import run_checks
                run_checks.delay(version_id, tid)
                logger.info(f"  tenant={tid}: enqueued run_checks for version={version_id}")

                # Insert dqs_history record from latest dqs_summary
                dqs_summary = version.get("dqs_summary")
                if dqs_summary and isinstance(dqs_summary, dict):
                    for module, scores in dqs_summary.items():
                        if not isinstance(scores, dict):
                            continue
                        dim = scores.get("dimension_scores", scores)
                        session.execute(
                            text("""
                                INSERT INTO dqs_history (id, tenant_id, version_id, module,
                                    composite_score, completeness, accuracy, consistency,
                                    timeliness, uniqueness, validity, recorded_at)
                                VALUES (gen_random_uuid(), :tid, :vid, :mod,
                                    :comp, :compl, :acc, :cons, :tim, :uniq, :val, now())
                                ON CONFLICT DO NOTHING
                            """),
                            {
                                "tid": tid, "vid": version_id, "mod": module,
                                "comp": scores.get("composite_score", 0),
                                "compl": dim.get("completeness", 0),
                                "acc": dim.get("accuracy", 0),
                                "cons": dim.get("consistency", 0),
                                "tim": dim.get("timeliness", 0),
                                "uniq": dim.get("uniqueness", 0),
                                "val": dim.get("validity", 0),
                            },
                        )
                    session.commit()

                # Cache dashboard summary in Redis
                try:
                    r = _get_redis()
                    cache_key = f"dashboard:{tid}"
                    r.setex(cache_key, 300, json.dumps({
                        "version_id": version_id,
                        "dqs_summary": dqs_summary if isinstance(dqs_summary, dict) else {},
                        "cached_at": datetime.now(timezone.utc).isoformat(),
                    }))
                except Exception as e:
                    logger.warning(f"  tenant={tid}: Redis cache failed: {e}")

        except Exception as e:
            logger.error(f"  tenant={tid}: daily_analysis failed: {e}", exc_info=True)


# ── Trigger 2: weekly_cleaning_batch — 03:00 SAST Monday ────────────────────


@celery_app.task(name="workers.scheduler.weekly_cleaning_batch")
def weekly_cleaning_batch():
    """Auto-approve auto items, apply standardisations, materialise metrics."""
    logger.info("Trigger 2: weekly_cleaning_batch starting")
    engine = _get_sync_engine()

    with Session(engine) as session:
        tenants = _get_tenants(session)

    for tenant in tenants:
        tid = str(tenant["id"])
        try:
            with Session(engine) as session:
                _set_rls(session, tid)

                # 1. Auto-approve detected items where rule automation_level=auto
                result = session.execute(
                    text("""
                        UPDATE cleaning_queue cq
                        SET status = 'approved', approved_by = 'scheduler'
                        WHERE cq.tenant_id = :tid
                          AND cq.status = 'detected'
                          AND EXISTS (
                              SELECT 1 FROM cleaning_rules cr
                              WHERE cr.id = cq.rule_id AND cr.automation_level = 'auto'
                          )
                        RETURNING cq.id
                    """),
                    {"tid": tid},
                )
                auto_approved = len(result.fetchall())
                logger.info(f"  tenant={tid}: auto-approved {auto_approved} items")

                # 2. Auto-apply approved standardisation items
                result = session.execute(
                    text("""
                        UPDATE cleaning_queue cq
                        SET status = 'applied', applied_at = now(),
                            rollback_deadline = now() + interval '72 hours'
                        WHERE cq.tenant_id = :tid
                          AND cq.status = 'approved'
                          AND EXISTS (
                              SELECT 1 FROM cleaning_rules cr
                              WHERE cr.id = cq.rule_id AND cr.category = 'standardisation'
                          )
                        RETURNING cq.id
                    """),
                    {"tid": tid},
                )
                auto_applied = len(result.fetchall())
                logger.info(f"  tenant={tid}: auto-applied {auto_applied} standardisation items")

                # 3. Materialise cleaning_metrics for the week
                today = datetime.now(SAST).date().isoformat()
                for obj_type in ["customer", "vendor", "material", "equipment", "employee", "financial"]:
                    counts = {}
                    for st in ["detected", "recommended", "approved", "rejected", "applied", "verified", "rolled_back"]:
                        cnt_result = session.execute(
                            text("""
                                SELECT COUNT(*) FROM cleaning_queue
                                WHERE tenant_id = :tid AND object_type = :ot AND status = :st
                            """),
                            {"tid": tid, "ot": obj_type, "st": st},
                        )
                        counts[st] = cnt_result.scalar() or 0

                    session.execute(
                        text("""
                            INSERT INTO cleaning_metrics (id, tenant_id, period, period_type, object_type,
                                detected, recommended, approved, rejected, applied, verified,
                                rolled_back, auto_approved, created_at)
                            VALUES (gen_random_uuid(), :tid, :period, 'weekly', :ot,
                                :detected, :recommended, :approved, :rejected, :applied, :verified,
                                :rolled_back, :auto_approved, now())
                            ON CONFLICT DO NOTHING
                        """),
                        {
                            "tid": tid, "period": today, "ot": obj_type,
                            **counts, "auto_approved": auto_approved,
                        },
                    )

                # 4. Rollup steward_metrics for the week
                session.execute(
                    text("""
                        INSERT INTO steward_metrics (id, tenant_id, user_id, period, period_type,
                            items_processed, items_approved, items_rejected, total_review_hours,
                            dqs_impact, created_at)
                        SELECT gen_random_uuid(), :tid, COALESCE(approved_by, 'system'),
                            :period, 'weekly',
                            COUNT(*),
                            COUNT(*) FILTER (WHERE status = 'approved' OR status = 'applied'),
                            COUNT(*) FILTER (WHERE status = 'rejected'),
                            0, 0, now()
                        FROM cleaning_queue
                        WHERE tenant_id = :tid
                          AND detected_at >= now() - interval '7 days'
                        GROUP BY COALESCE(approved_by, 'system')
                        ON CONFLICT DO NOTHING
                    """),
                    {"tid": tid, "period": today},
                )

                # 5. Generate weekly summary in MinIO
                summary_result = session.execute(
                    text("""
                        SELECT
                            COUNT(*) FILTER (WHERE status = 'detected') as findings,
                            COUNT(*) FILTER (WHERE status IN ('approved', 'applied')) as cleaned,
                            COUNT(*) FILTER (WHERE status = 'rejected') as rejected
                        FROM cleaning_queue
                        WHERE tenant_id = :tid AND detected_at >= now() - interval '7 days'
                    """),
                    {"tid": tid},
                )
                summary_row = summary_result.fetchone()
                if summary_row:
                    summary = dict(summary_row._mapping)
                    try:
                        from api.services.storage import get_storage
                        storage = get_storage()
                        storage.put_object(
                            f"reports/{tid}/weekly_summary_{today}.json",
                            json.dumps(summary).encode(),
                        )
                    except Exception as e:
                        logger.warning(f"  tenant={tid}: MinIO weekly summary write failed: {e}")

                session.commit()

        except Exception as e:
            logger.error(f"  tenant={tid}: weekly_cleaning_batch failed: {e}", exc_info=True)


# ── Trigger 3: monthly_report — 04:00 SAST 1st of month ─────────────────────


@celery_app.task(name="workers.scheduler.monthly_report")
def monthly_report():
    """Generate PDF, calculate cost avoidance and exception billing."""
    logger.info("Trigger 3: monthly_report starting")
    engine = _get_sync_engine()

    with Session(engine) as session:
        tenants = _get_tenants(session)

    for tenant in tenants:
        tid = str(tenant["id"])
        try:
            with Session(engine) as session:
                _set_rls(session, tid)

                # Get latest complete version
                result = session.execute(
                    text("""
                        SELECT id FROM analysis_versions
                        WHERE tenant_id = :tid AND status IN ('complete', 'agents_complete')
                        ORDER BY run_at DESC LIMIT 1
                    """),
                    {"tid": tid},
                )
                version_row = result.fetchone()
                if not version_row:
                    continue

                version_id = str(version_row[0])

                # 1. Enqueue PDF generation
                from workers.tasks.generate_pdf import generate_pdf
                generate_pdf.delay(version_id, tid)
                logger.info(f"  tenant={tid}: enqueued generate_pdf for version={version_id}")

                # 2. Calculate cost_avoidance for previous month
                now = datetime.now(SAST)
                prev_month = (now.replace(day=1) - timedelta(days=1))
                period = prev_month.strftime("%Y-%m")

                # Sum mitigated ZAR from impact_records
                impact_result = session.execute(
                    text("""
                        SELECT COALESCE(SUM(
                            CASE WHEN mitigated_zar IS NOT NULL THEN mitigated_zar ELSE 0 END
                        ), 0) as total_mitigated
                        FROM impact_records
                        WHERE tenant_id = :tid
                          AND created_at >= date_trunc('month', :prev_date::date)
                          AND created_at < date_trunc('month', :curr_date::date)
                    """),
                    {"tid": tid, "prev_date": prev_month.isoformat(), "curr_date": now.isoformat()},
                )
                mitigated = impact_result.scalar() or 0
                subscription_cost = 8500  # Default R8,500/month

                session.execute(
                    text("""
                        INSERT INTO cost_avoidance (id, tenant_id, period, period_type,
                            subscription_cost_zar, risk_mitigated_zar, exceptions_value_zar,
                            cleaning_value_zar, cumulative_roi_multiple, created_at)
                        VALUES (gen_random_uuid(), :tid, :period, 'monthly',
                            :sub, :mitigated, 0, 0,
                            CASE WHEN :sub > 0 THEN :mitigated / :sub ELSE 0 END,
                            now())
                        ON CONFLICT DO NOTHING
                    """),
                    {"tid": tid, "period": period, "sub": subscription_cost, "mitigated": mitigated},
                )

                # 3. Generate exception billing
                try:
                    from api.services.exception_engine import ExceptionBillingCalculator
                    billing_calc = ExceptionBillingCalculator(session, tid)
                    billing = billing_calc.calculate_billing(period)
                    if billing:
                        session.execute(
                            text("""
                                INSERT INTO exception_billing (id, tenant_id, period,
                                    tier1_count, tier2_count, tier3_count, tier4_count,
                                    tier1_amount, tier2_amount, tier3_amount, tier4_amount,
                                    base_fee, total_amount, created_at)
                                VALUES (gen_random_uuid(), :tid, :period,
                                    :t1c, :t2c, :t3c, :t4c,
                                    :t1a, :t2a, :t3a, :t4a,
                                    :bf, :total, now())
                                ON CONFLICT DO NOTHING
                            """),
                            {
                                "tid": tid, "period": period,
                                "t1c": billing.get("tier1_count", 0),
                                "t2c": billing.get("tier2_count", 0),
                                "t3c": billing.get("tier3_count", 0),
                                "t4c": billing.get("tier4_count", 0),
                                "t1a": billing.get("tier1_amount", 0),
                                "t2a": billing.get("tier2_amount", 0),
                                "t3a": billing.get("tier3_amount", 0),
                                "t4a": billing.get("tier4_amount", 0),
                                "bf": billing.get("base_fee", 0),
                                "total": billing.get("total_amount", 0),
                            },
                        )
                except Exception as e:
                    logger.warning(f"  tenant={tid}: exception billing failed: {e}")

                session.commit()

        except Exception as e:
            logger.error(f"  tenant={tid}: monthly_report failed: {e}", exc_info=True)


# ── Trigger 4: daily_digest — 06:00 SAST ────────────────────────────────────


@celery_app.task(name="workers.scheduler.daily_digest")
def daily_digest():
    """Generate daily digest with findings, cleaning, exceptions, and predictions."""
    logger.info("Trigger 4: daily_digest starting")
    engine = _get_sync_engine()

    with Session(engine) as session:
        tenants = _get_tenants(session)

    for tenant in tenants:
        tid = str(tenant["id"])
        try:
            with Session(engine) as session:
                _set_rls(session, tid)

                # 1. Load items created in last 24h
                findings_result = session.execute(
                    text("""
                        SELECT COUNT(*) FROM findings
                        WHERE tenant_id = :tid AND created_at >= now() - interval '24 hours'
                    """),
                    {"tid": tid},
                )
                new_findings = findings_result.scalar() or 0

                cleaning_result = session.execute(
                    text("""
                        SELECT COUNT(*) FROM cleaning_queue
                        WHERE tenant_id = :tid AND detected_at >= now() - interval '24 hours'
                    """),
                    {"tid": tid},
                )
                new_cleaning = cleaning_result.scalar() or 0

                exception_result = session.execute(
                    text("""
                        SELECT COUNT(*) FROM exceptions
                        WHERE tenant_id = :tid AND created_at >= now() - interval '24 hours'
                    """),
                    {"tid": tid},
                )
                new_exceptions = exception_result.scalar() or 0

                # 2. Predictive early warnings if enough history
                early_warnings: list[dict] = []
                history_count_result = session.execute(
                    text("SELECT COUNT(DISTINCT recorded_at::date) FROM dqs_history WHERE tenant_id = :tid"),
                    {"tid": tid},
                )
                history_points = history_count_result.scalar() or 0

                if history_points >= 3:
                    try:
                        from api.services.analytics_engine import PredictiveAnalytics
                        pa = PredictiveAnalytics(session, tid)
                        predictions = pa.predict_all()
                        early_warnings = predictions.get("early_warnings", [])
                    except Exception as e:
                        logger.warning(f"  tenant={tid}: predictive analytics failed: {e}")

                # 3. Generate next-best actions
                next_actions: list[dict] = []
                try:
                    from api.services.analytics_engine import PrescriptiveAnalytics
                    presc = PrescriptiveAnalytics(session, tid)
                    actions = presc.get_next_best_actions()
                    next_actions = actions[:5] if actions else []
                except Exception as e:
                    logger.warning(f"  tenant={tid}: prescriptive analytics failed: {e}")

                # 4. Create notification records (skip if table doesn't exist)
                try:
                    session.execute(
                        text("""
                            INSERT INTO notifications (id, tenant_id, type, title, body, metadata, created_at)
                            VALUES (gen_random_uuid(), :tid, 'daily_digest', 'Daily Digest',
                                :body, :meta, now())
                        """),
                        {
                            "tid": tid,
                            "body": f"{new_findings} new findings, {new_cleaning} cleaning items, {new_exceptions} exceptions",
                            "meta": json.dumps({
                                "findings": new_findings,
                                "cleaning": new_cleaning,
                                "exceptions": new_exceptions,
                                "early_warnings": early_warnings,
                                "next_actions": next_actions,
                            }),
                        },
                    )
                    session.commit()
                except Exception:
                    session.rollback()
                    logger.debug(f"  tenant={tid}: notifications table not yet available")

                # 5. Send email if configured
                resend_key = os.getenv("RESEND_API_KEY")
                if resend_key and (new_findings > 0 or new_cleaning > 0 or new_exceptions > 0):
                    try:
                        from workers.tasks.send_notifications import send_notification

                        # Get latest version for notification context
                        ver_result = session.execute(
                            text("""
                                SELECT id FROM analysis_versions
                                WHERE tenant_id = :tid AND status IN ('complete', 'agents_complete')
                                ORDER BY run_at DESC LIMIT 1
                            """),
                            {"tid": tid},
                        )
                        ver_row = ver_result.fetchone()
                        if ver_row:
                            send_notification.delay(str(ver_row[0]), tid, "scheduled_daily")
                    except Exception as e:
                        logger.warning(f"  tenant={tid}: digest notification failed: {e}")

                logger.info(
                    f"  tenant={tid}: digest — {new_findings} findings, "
                    f"{new_cleaning} cleaning, {new_exceptions} exceptions"
                )

        except Exception as e:
            logger.error(f"  tenant={tid}: daily_digest failed: {e}", exc_info=True)


# ── Trigger 5: weekly_archive — 00:00 SAST Sunday ───────────────────────────


@celery_app.task(name="workers.scheduler.weekly_archive")
def weekly_archive():
    """Archive old findings, prune Redis, escalate overdue exceptions."""
    logger.info("Trigger 5: weekly_archive starting")
    engine = _get_sync_engine()

    with Session(engine) as session:
        tenants = _get_tenants(session)

    for tenant in tenants:
        tid = str(tenant["id"])
        try:
            with Session(engine) as session:
                _set_rls(session, tid)

                # 1. Load findings older than 90 days
                result = session.execute(
                    text("""
                        SELECT id, version_id, module, check_id, severity, dimension,
                               affected_count, total_count, pass_rate, details,
                               remediation_text, created_at
                        FROM findings
                        WHERE tenant_id = :tid AND created_at < now() - interval '90 days'
                    """),
                    {"tid": tid},
                )
                old_findings = [dict(r._mapping) for r in result.fetchall()]

                if old_findings:
                    # 2. Serialize to compressed JSON and store in MinIO
                    now = datetime.now(SAST)
                    archive_key = f"archive/{tid}/{now.strftime('%Y-%m')}.json.gz"

                    # Serialize with date handling
                    def _default(obj):
                        if hasattr(obj, "isoformat"):
                            return obj.isoformat()
                        return str(obj)

                    archive_json = json.dumps(old_findings, default=_default)
                    compressed = gzip.compress(archive_json.encode())

                    minio_ok = False
                    try:
                        from api.services.storage import get_storage
                        storage = get_storage()
                        storage.put_object(archive_key, compressed)
                        minio_ok = True
                        logger.info(f"  tenant={tid}: archived {len(old_findings)} findings to {archive_key}")
                    except Exception as e:
                        logger.error(f"  tenant={tid}: MinIO archive write failed: {e}")

                    # 3. Delete only after confirming MinIO write succeeded
                    if minio_ok:
                        finding_ids = [str(f["id"]) for f in old_findings]
                        # Delete in batches of 500
                        for i in range(0, len(finding_ids), 500):
                            batch = finding_ids[i:i + 500]
                            placeholders = ",".join(f"'{fid}'" for fid in batch)
                            session.execute(
                                text(f"DELETE FROM findings WHERE tenant_id = :tid AND id IN ({placeholders})"),
                                {"tid": tid},
                            )
                        session.commit()
                        logger.info(f"  tenant={tid}: deleted {len(old_findings)} archived findings from Postgres")

                # 4. Prune Redis cache keys older than 7 days
                try:
                    r = _get_redis()
                    cursor = 0
                    prefix = f"dashboard:{tid}"
                    while True:
                        cursor, keys = r.scan(cursor, match=f"{prefix}*", count=100)
                        for key in keys:
                            ttl = r.ttl(key)
                            if ttl == -1:  # No expiry set — clean up
                                r.delete(key)
                        if cursor == 0:
                            break
                except Exception as e:
                    logger.warning(f"  tenant={tid}: Redis prune failed: {e}")

                # 5. Escalate overdue exceptions
                try:
                    from api.services.exception_engine import ExceptionEngine
                    exc_engine = ExceptionEngine(session, tid)
                    exc_engine.calculate_escalation()
                    session.commit()
                    logger.info(f"  tenant={tid}: exception escalation complete")
                except Exception as e:
                    logger.warning(f"  tenant={tid}: exception escalation failed: {e}")

        except Exception as e:
            logger.error(f"  tenant={tid}: weekly_archive failed: {e}", exc_info=True)


# ── Beat schedule configuration ──────────────────────────────────────────────

celery_app.conf.beat_schedule = {
    "daily-analysis-02am": {
        "task": "workers.scheduler.daily_analysis",
        "schedule": crontab(hour=0, minute=0),  # 00:00 UTC = 02:00 SAST
    },
    "weekly-cleaning-monday-03am": {
        "task": "workers.scheduler.weekly_cleaning_batch",
        "schedule": crontab(hour=1, minute=0, day_of_week=1),  # 01:00 UTC Monday = 03:00 SAST
    },
    "monthly-report-1st-04am": {
        "task": "workers.scheduler.monthly_report",
        "schedule": crontab(hour=2, minute=0, day_of_month=1),  # 02:00 UTC 1st = 04:00 SAST
    },
    "daily-digest-06am": {
        "task": "workers.scheduler.daily_digest",
        "schedule": crontab(hour=4, minute=0),  # 04:00 UTC = 06:00 SAST
    },
    "weekly-archive-sunday-midnight": {
        "task": "workers.scheduler.weekly_archive",
        "schedule": crontab(hour=22, minute=0, day_of_week=6),  # 22:00 UTC Saturday = 00:00 SAST Sunday
    },
}

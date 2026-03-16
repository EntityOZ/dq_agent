"""Celery beat schedule for automated notification delivery.

Schedules:
  - Daily digest: 07:00 Africa/Johannesburg every day
  - Weekly summary: 07:00 Africa/Johannesburg every Monday
  - Monthly report: 07:00 Africa/Johannesburg on the 1st of each month
"""

import logging
import os

from celery.schedules import crontab
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app

logger = logging.getLogger("vantax.scheduler")


def _get_sync_engine():
    url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return create_engine(url)


@celery_app.task(name="workers.scheduler.dispatch_scheduled_notifications")
def dispatch_scheduled_notifications(trigger: str):
    """Find all tenants with the given schedule enabled and enqueue notifications."""
    logger.info(f"Dispatching scheduled notifications: trigger={trigger}")

    engine = _get_sync_engine()
    with Session(engine) as session:
        # Find tenants with notification config enabled for this trigger
        schedule_key = {
            "scheduled_daily": "daily_digest",
            "scheduled_weekly": "weekly_summary",
            "scheduled_monthly": "monthly_report",
        }.get(trigger, "")

        if not schedule_key:
            logger.warning(f"Unknown trigger: {trigger}")
            return

        result = session.execute(
            text("""
                SELECT t.id, av.id as version_id
                FROM tenants t
                JOIN LATERAL (
                    SELECT id FROM analysis_versions
                    WHERE tenant_id = t.id AND status = 'agents_complete'
                    ORDER BY run_at DESC LIMIT 1
                ) av ON true
                WHERE t.dqs_weights->'notification_config'->>:key = 'true'
            """),
            {"key": schedule_key},
        )

        rows = result.fetchall()
        if not rows:
            logger.info(f"No tenants with {schedule_key} enabled")
            return

        from workers.tasks.send_notifications import send_notification

        for tenant_id, version_id in rows:
            send_notification.delay(str(version_id), str(tenant_id), trigger)
            logger.info(f"Enqueued {trigger} notification for tenant={tenant_id}")


# Beat schedule configuration
celery_app.conf.beat_schedule = {
    "daily-digest-07am": {
        "task": "workers.scheduler.dispatch_scheduled_notifications",
        "schedule": crontab(hour=7, minute=0),  # 07:00 Africa/Johannesburg (timezone set in celery_app)
        "args": ("scheduled_daily",),
    },
    "weekly-summary-monday-07am": {
        "task": "workers.scheduler.dispatch_scheduled_notifications",
        "schedule": crontab(hour=7, minute=0, day_of_week=1),  # Monday 07:00
        "args": ("scheduled_weekly",),
    },
    "monthly-report-1st-07am": {
        "task": "workers.scheduler.dispatch_scheduled_notifications",
        "schedule": crontab(hour=7, minute=0, day_of_month=1),  # 1st of month 07:00
        "args": ("scheduled_monthly",),
    },
}

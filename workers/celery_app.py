import os

from celery import Celery

broker_url = os.getenv("REDIS_URL", "redis://redis:6379/0")

celery_app = Celery(
    "vantax",
    broker=broker_url,
    backend=broker_url,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Africa/Johannesburg",
    enable_utc=True,
    task_always_eager=False,
    task_track_started=True,
    worker_prefetch_multiplier=1,
)

# Auto-discover tasks in workers/tasks/
celery_app.autodiscover_tasks(["workers.tasks"])

# Explicit imports for task registration
import workers.tasks.run_checks  # noqa: F401, E402

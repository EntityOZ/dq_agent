# Vantax — Phase 1 Kickoff Prompt

> Paste this prompt into Claude Code at the start of the first session.
> Ensure CLAUDE.md is in the project root before running.

---

```
Read CLAUDE.md in full before doing anything else. When you have finished reading it,
confirm you understand the two-zone architecture and the data boundary rule, then tell
me the three things the customer container stack is NOT allowed to do.

Once confirmed, we are starting Phase 1 — Foundation. Your goal by the end of this
phase is a fully running Docker Compose stack where every service starts healthy and
we can prove end-to-end connectivity before a single line of business logic is written.

Work through these tasks in order. Complete and verify each one before moving to the next.
Do not skip ahead.

---

TASK 1 — Repo scaffold

Create the full project folder structure exactly as specified in CLAUDE.md. Create every
folder and add a .gitkeep where the folder would otherwise be empty. Create the following
files with their correct content:

- .gitignore — Python, Node, Docker, .env, __pycache__, .DS_Store
- .env.example — every variable from the Environment Variables section of CLAUDE.md,
  with blank values and the inline comments from that section preserved exactly
- README.md — project name, one-paragraph description, prerequisites, and a quickstart
  that says: clone repo → copy .env.example to .env → fill in values → run install.sh

---

TASK 2 — Docker Compose stack

Create docker-compose.yml using the structure in CLAUDE.md. Add the following that are
not in the CLAUDE.md snippet but are required for a working stack:

- Healthchecks on every service (api, worker, db, redis, minio, llm)
- A shared network called meridian-net
- restart: unless-stopped on all services except llm (GPU services should not auto-restart
  as the GPU may not be available on startup in all environments)
- db healthcheck: pg_isready -U meridian
- redis healthcheck: redis-cli ping
- minio healthcheck: curl -f http://localhost:9000/minio/health/live
- api healthcheck: curl -f http://localhost:8000/health
- llm healthcheck: curl -f http://localhost:11434/api/tags

Create docker-compose.dev.yml that overrides LLM_PROVIDER to ollama_cloud and removes
the llm service entirely (Ollama Cloud is remote — no local GPU needed in dev).

---

TASK 3 — FastAPI skeleton

Create api/main.py, api/config.py, and api/deps.py.

config.py must read every environment variable from .env.example using Pydantic Settings.
Group them into logical sections matching the .env.example comments (LLM, Database, Redis,
MinIO, Licence, Notifications, Auth, Observability).

main.py must:
- Create the FastAPI app with title "Meridian API", version "1.0.0"
- Register the health router
- Add CORS middleware allowing the frontend origin from config
- On startup: log "Meridian API starting", log the LLM_PROVIDER value, log whether
  LICENCE_KEY is set (do not log the key value itself)

deps.py must provide:
- get_db() — yields a SQLAlchemy async session
- get_tenant() — extracts tenant_id from the request JWT and returns a Tenant object.
  For now, stub this to return a hardcoded dev tenant if AUTH_MODE=local

Create api/routes/health.py with GET /health returning:
{
  "status": "ok",
  "version": "1.0.0",
  "llm_provider": "<value of LLM_PROVIDER>",
  "timestamp": "<ISO timestamp>"
}

---

TASK 4 — Postgres schema and migrations

Set up Alembic for migrations. Create the initial migration that produces exactly the
tables specified in the Database Schema section of CLAUDE.md:

- tenants
- analysis_versions
- findings

Add the Row Level Security policies from CLAUDE.md on analysis_versions and findings.
Add an index on findings(tenant_id, version_id) and findings(tenant_id, module, severity).

Create db/queries/tenants.py with:
- get_tenant_by_id(db, tenant_id) → Tenant | None
- create_tenant(db, name, licensed_modules) → Tenant

Create db/queries/versions.py with:
- create_version(db, tenant_id, metadata) → AnalysisVersion
- get_version(db, tenant_id, version_id) → AnalysisVersion | None
- update_version_status(db, tenant_id, version_id, status) → AnalysisVersion

Create db/queries/findings.py with:
- bulk_insert_findings(db, tenant_id, version_id, findings: list[FindingCreate]) → int
- get_findings(db, tenant_id, version_id, severity=None, module=None) → list[Finding]

All query functions must set the Postgres RLS context variable before executing:
  await db.execute(text(f"SET app.tenant_id = '{tenant_id}'"))

---

TASK 5 — Celery setup

Create workers/celery_app.py. Configure Celery with:
- Broker: Redis URL from config
- Result backend: Redis URL from config
- Task serializer: json
- Accept content: ["json"]
- Timezone: Africa/Johannesburg
- Enable UTC: True
- Task always eager: False (never True — eager mode hides real async bugs)

Create workers/tasks/run_checks.py with a stub task:
@celery_app.task(bind=True, name="workers.tasks.run_checks.run_checks")
def run_checks(self, version_id: str, tenant_id: str, parquet_path: str):
    # Phase 2 will implement this fully
    # For now: log receipt, update version status to "running", wait 2 seconds,
    # update status to "complete", return {"version_id": version_id, "status": "complete"}

The task must set the RLS context on its own DB session before any query.

---

TASK 6 — LLM provider

Create llm/provider.py exactly as written in CLAUDE.md. No modifications.

Add a test function at the bottom:
def test_llm_connection() -> bool:
    """Call this on startup to verify the LLM is reachable. Returns True if ok."""
    try:
        llm = get_llm()
        response = llm.invoke("Reply with only the word READY.")
        return "READY" in response.content.upper()
    except Exception as e:
        logger.warning(f"LLM connection test failed: {e}")
        return False

Call test_llm_connection() in api/main.py on startup. Log "LLM connection: OK" or
"LLM connection: FAILED — check LLM_PROVIDER config" but do not raise — the API should
start even if the LLM is temporarily unreachable.

---

TASK 7 — MinIO initialisation

Create a startup utility at api/services/storage.py with:
- get_minio_client() → Minio client from config
- ensure_buckets() → creates MINIO_BUCKET_UPLOADS and MINIO_BUCKET_REPORTS if they
  do not exist. Called on API startup.
- upload_file(bucket, object_name, data: bytes, content_type) → str (returns object URL)
- download_file(bucket, object_name) → bytes
- delete_file(bucket, object_name) → None

Call ensure_buckets() in main.py on startup after the LLM connection test.

---

TASK 8 — Licence middleware

Create api/middleware/licence.py.

On every request to /api/v1/* (not /health):
1. Read LICENCE_KEY from config
2. If LICENCE_KEY is not set and AUTH_MODE=local, skip validation (dev mode)
3. If LICENCE_KEY is set, check an in-memory cache first (cache TTL = 6 hours)
4. If cache miss, POST to LICENCE_SERVER_URL with {licenceKey, machineFingerprint}
5. machineFingerprint = SHA256 hash of the machine's hostname + MAC address
6. If response is {valid: false}, return HTTP 402 with {"error": "licence_invalid"}
7. If LICENCE_SERVER_URL is unreachable, log a warning and allow the request through
   (graceful degradation — do not take down a customer environment over a network blip)
8. Cache the validated response with its modules list for 6 hours

Add request.state.licensed_modules = [...] so route handlers can check entitlements.

---

TASK 9 — scripts/install.sh

Create scripts/install.sh. It must:

1. Check prerequisites: Docker >= 24, Docker Compose >= 2.20, curl, git
2. Check .env exists — if not, copy .env.example and exit with instructions to fill it in
3. Pull all Docker images: docker compose pull
4. Run database migrations: docker compose run --rm api alembic upgrade head
5. Start all services: docker compose up -d
6. Wait for all healthchecks to pass (poll every 5s, timeout 120s)
7. If LLM_PROVIDER=ollama, pull the configured model:
   docker compose exec llm ollama pull ${OLLAMA_MODEL:-llama3.1:70b}
8. Run a connectivity test: curl -s http://localhost:8000/health and verify status=ok
9. Print a success message with the dashboard URL: http://localhost:3000

Create scripts/healthcheck.sh that runs step 8 only — used for monitoring.

---

TASK 10 — Verify the stack

After completing Tasks 1–9, run the stack in dev mode and verify:

  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

Check each of these and confirm they pass:

[ ] docker compose ps shows all services as healthy (or starting for llm)
[ ] curl http://localhost:8000/health returns {"status":"ok",...}
[ ] Alembic migrations ran without error
[ ] Redis is reachable from the api container:
    docker compose exec api python -c "import redis; r=redis.from_url('redis://redis:6379/0'); print(r.ping())"
[ ] Postgres tenants table exists and RLS is enabled:
    docker compose exec db psql -U vantax -c "\d findings"
[ ] MinIO buckets exist:
    docker compose exec api python -c "from api.services.storage import ensure_buckets; ensure_buckets()"
[ ] LLM connection test log line appears in api logs

Report the result of each check. If any fail, fix them before declaring Phase 1 complete.

---

When all 10 tasks are complete and all checks pass, tell me:
1. What is running and confirmed healthy
2. The exact command to bring up the dev stack fresh on a new machine
3. What the first task in Phase 2 will be

Do not start Phase 2 in this session. Phase 1 is complete when the stack is healthy.
```

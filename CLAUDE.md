# Vantax SAP Data Quality Agent — Claude Code Instructions

You are building **Vantax**, a customer-deployed SAP Data Quality Agent. This file is your
complete briefing. Read it fully at the start of every session before touching any code.

---

## What you are building

Vantax analyses SAP data quality across 29 modules and 254 predefined validation checks. It
runs entirely inside the customer's own environment — on-premises or in their cloud VPC. SAP
data, findings, and reports never leave their boundary. You are the engineer responsible for
making this work correctly, reliably, and safely.

The product ships as a Docker Compose stack (and optionally a Kubernetes Helm chart). A separate
Cloudflare control plane handles licencing, billing, and the marketing site — but contains
zero SAP data.

---

## Architecture — know this before writing a line of code

### Two zones, hard boundary between them

**Zone 1 — Cloudflare (your infra, no SAP data)**
- `dqagent.vantax.co.za` — marketing site on Cloudflare Pages
- `portal.dqagent.vantax.co.za` — Vantax portal on Cloudflare Pages (Next.js, licence mgmt, billing)
- `licence.dqagent.vantax.co.za` — licence server on Cloudflare Workers + KV
- Stripe handles billing — annual licence fees, per-module add-ons, enterprise tiers in ZAR

**Zone 2 — Customer container stack (their infra, all SAP data)**
- FastAPI + LangGraph — API server and agent orchestration
- Celery + Redis — background job workers (check execution, PDF generation)
- Postgres — tenants, versions, findings, module config, DQS scores
- Ollama — local LLM server (Llama 3.1 70B default, swappable)
- MinIO — S3-compatible local file store (CSV uploads, PDF reports)
- Next.js dashboard — served locally, no Vercel
- WeasyPrint + Jinja2 — PDF generation inside Celery workers

### The only outbound calls from the customer stack
1. Licence ping to `licence.dqagent.vantax.co.za` — key + machine fingerprint only, no data payload
2. Image pull from GHCR — only when customer explicitly runs `update.sh`

Everything else is internal. The LLM never sees raw SAP data — only aggregated findings JSON.

---

## Project structure

```
vantax/
├── CLAUDE.md                        ← this file
├── docker-compose.yml               ← production customer stack
├── docker-compose.dev.yml           ← dev overrides (Ollama Cloud mode)
├── .env.example                     ← all config vars documented
├── .env                             ← secrets (gitignored, never commit)
│
├── api/                             ← FastAPI application
│   ├── main.py                      ← app entrypoint, router registration
│   ├── config.py                    ← settings from env vars
│   ├── deps.py                      ← shared FastAPI dependencies
│   ├── middleware/
│   │   ├── tenant.py                ← extract tenant_id from JWT, set Postgres context
│   │   └── licence.py               ← validate module entitlements per request
│   ├── routes/
│   │   ├── upload.py                ← POST /api/v1/upload (CSV/Excel ingestion)
│   │   ├── analyse.py               ← POST /api/v1/analyse (trigger analysis run)
│   │   ├── versions.py              ← GET /api/v1/versions, /compare
│   │   ├── findings.py              ← GET /api/v1/findings (drill-down)
│   │   ├── reports.py               ← GET /api/v1/reports (PDF download)
│   │   └── health.py                ← GET /health (used by Docker healthcheck)
│   └── services/
│       ├── scoring.py               ← DQS formula and dimension calculations
│       └── column_mapper.py         ← normalise uploaded column names per module
│
├── agents/                          ← LangGraph agent definitions
│   ├── orchestrator.py              ← main LangGraph graph — routes to sub-agents
│   ├── analyst.py                   ← root cause reasoning sub-agent
│   ├── remediation.py               ← SAP-specific fix suggestion sub-agent
│   ├── report_agent.py              ← assembles findings into report structure
│   └── readiness.py                 ← migration go/no-go scoring sub-agent
│
├── llm/
│   └── provider.py                  ← swappable LLM — reads LLM_PROVIDER env var
│
├── workers/                         ← Celery tasks
│   ├── celery_app.py                ← Celery app config, broker = Redis
│   ├── tasks/
│   │   ├── run_checks.py            ← execute check suite against a dataset
│   │   ├── generate_pdf.py          ← render Jinja2 → WeasyPrint → MinIO
│   │   └── send_notifications.py    ← email (Resend) + Teams webhook
│   └── scheduler.py                 ← cron job definitions (daily/weekly digest)
│
├── checks/                          ← deterministic check engine
│   ├── runner.py                    ← loads YAML rules, dispatches to check classes
│   ├── base.py                      ← CheckResult dataclass, base Check class
│   ├── types/                       ← check class implementations
│   │   ├── null_check.py
│   │   ├── domain_value_check.py
│   │   ├── regex_check.py
│   │   ├── cross_field_check.py
│   │   ├── referential_check.py
│   │   └── freshness_check.py
│   └── rules/                       ← 254 YAML rule definitions
│       ├── successfactors/
│       │   ├── employee_central.yaml
│       │   ├── compensation.yaml
│       │   ├── payroll_integration.yaml
│       │   └── ...                  ← 6 more SF modules
│       ├── ecc/
│       │   ├── business_partner.yaml
│       │   ├── material_master.yaml
│       │   ├── fi_gl.yaml
│       │   └── ...                  ← 8 more ECC modules
│       └── warehouse/
│           ├── ewms_stock.yaml
│           └── ...                  ← 8 more warehouse modules
│
├── db/
│   ├── schema.py                    ← Drizzle-style schema definitions (SQLAlchemy)
│   ├── migrations/                  ← Alembic migration files
│   └── queries/                     ← typed query functions per domain
│       ├── tenants.py
│       ├── versions.py
│       └── findings.py
│
├── templates/                       ← Jinja2 report templates
│   ├── executive_report.html
│   ├── detailed_findings.html
│   └── assets/
│       └── report.css
│
├── frontend/                        ← Next.js 15 dashboard (served locally)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                 ← executive dashboard
│   │   ├── modules/                 ← module heatmap views
│   │   ├── findings/                ← drill-down to individual checks
│   │   ├── versions/                ← comparison and trend views
│   │   └── reports/                 ← PDF download and scheduling
│   └── ...
│
├── cloudflare/                      ← Cloudflare control plane (separate deploy)
│   ├── licence-worker/
│   │   ├── src/index.ts             ← Workers licence validation logic
│   │   └── wrangler.toml
│   └── portal/                      ← Vantax portal (Next.js on Pages)
│       └── ...
│
├── helm/                            ← Kubernetes Helm chart
│   └── vantax/
│       ├── Chart.yaml
│       ├── values.yaml
│       └── templates/
│
└── scripts/
    ├── install.sh                   ← first-time setup
    ├── update.sh                    ← pull new image, run migrations
    └── healthcheck.sh               ← validate all services running
```

---

## Core principles — follow these without exception

**Deterministic before probabilistic.** Every number in the report comes from a Python check
function, not an LLM. The check engine runs against data using pure logic. The LLM only
receives aggregated findings JSON and reasons about what they mean.

**The LLM never sees raw SAP data.** Raw table data stays in Postgres and MinIO.
The orchestrator passes only structured finding summaries to the LLM. If you ever find yourself
passing raw row data to an LLM call, stop and restructure.

**Tenant isolation is non-negotiable.** Every database query must include a `tenant_id` filter.
Postgres Row Level Security enforces this at the DB layer — but application code must also
set the RLS context variable before every query session. Never skip this.

**Check logic lives in YAML + Python, not in prompts.** If a new validation rule is needed,
it goes into a YAML file and a check class. Not into a system prompt.

**One failing check must not block other checks.** The runner catches exceptions per check and
records a failed result. An entire module analysis must complete even if individual checks error.

---

## Database schema — know the key tables

```sql
-- Multi-tenancy root
tenants (
  id uuid PK,
  name text,
  licensed_modules text[],         -- e.g. ['business_partner', 'material_master']
  dqs_weights jsonb,               -- overrides default DAMA DMBOK weights
  alert_thresholds jsonb,
  stripe_customer_id text,
  created_at timestamptz
)

-- Every analysis run is a snapshot
analysis_versions (
  id uuid PK,
  tenant_id uuid FK → tenants,
  run_at timestamptz,
  label text,                      -- user annotation e.g. "post-cleanup"
  dqs_summary jsonb,               -- {module: {dimension: score}} per module
  metadata jsonb,                  -- file name, row count, modules run
  status text                      -- pending | running | complete | failed
)

-- Individual check results
findings (
  id uuid PK,
  version_id uuid FK → analysis_versions,
  tenant_id uuid FK → tenants,
  module text,                     -- e.g. 'business_partner'
  check_id text,                   -- e.g. 'BP001'
  severity text,                   -- critical | high | medium | low
  dimension text,                  -- completeness | accuracy | consistency | ...
  affected_count int,
  total_count int,
  pass_rate numeric,
  details jsonb,                   -- sample failing records, check-specific context
  remediation_text text,           -- LLM-generated SAP-specific fix guidance
  created_at timestamptz
)

-- RLS policy on every data table
CREATE POLICY tenant_isolation ON findings
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

Always run `SET app.tenant_id = '<uuid>'` before any query in a session. The middleware
in `api/middleware/tenant.py` does this automatically from the JWT — but Celery workers
must do it explicitly at the start of each task.

---

## DQS scoring formula

This is the DAMA DMBOK composite score. Implement it exactly as specified.

```
DQS = (Completeness × 0.25) + (Accuracy × 0.25) + (Consistency × 0.20)
    + (Timeliness × 0.10) + (Uniqueness × 0.10) + (Validity × 0.10)
```

- Each dimension score = (passing checks in dimension) / (total checks in dimension) × 100
- A single Critical-severity failure caps the module DQS at 85 regardless of the weighted score
- Two or more Critical failures cap at 70
- Weights are configurable per tenant — read from `tenants.dqs_weights`, fall back to defaults
- Scores are stored in `analysis_versions.dqs_summary` as a nested JSON object

Implement this in `api/services/scoring.py`. It must be pure Python with no LLM involvement.

---

## The swappable LLM — implement exactly this pattern

```python
# llm/provider.py

from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_ollama import ChatOllama
import os

def get_llm():
    provider = os.getenv("LLM_PROVIDER", "ollama")

    if provider == "ollama":
        # Fully local — default for production customer deployments
        return ChatOllama(
            base_url=os.getenv("OLLAMA_BASE_URL", "http://llm:11434"),
            model=os.getenv("OLLAMA_MODEL", "llama3.1:70b"),
            temperature=0.1,
        )

    if provider == "ollama_cloud":
        # Ollama Cloud API — use dev key for local dev and CI
        return ChatOpenAI(
            base_url="https://api.ollama.com/v1",
            api_key=os.getenv("OLLAMA_API_KEY"),
            model=os.getenv("OLLAMA_MODEL", "llama3.1:70b"),
            temperature=0.1,
        )

    if provider == "anthropic":
        # For customers who have approved external API usage
        return ChatAnthropic(
            model="claude-sonnet-4-6",
            api_key=os.getenv("ANTHROPIC_API_KEY"),
            temperature=0.1,
        )

    raise ValueError(f"Unknown LLM_PROVIDER: {provider}")
```

Import `get_llm()` wherever an LLM instance is needed. Never hardcode a provider anywhere else.

---

## Check engine — YAML rule format

Every check is defined in YAML. The runner loads these dynamically. A check YAML entry looks like:

```yaml
# checks/rules/ecc/business_partner.yaml
module: business_partner
target_state: S4HANA_2023
rules:
  - id: BP001
    field: BUT000.BU_TYPE
    check_class: null_check
    severity: critical
    dimension: completeness
    message: "BP type is mandatory in S/4HANA — missing value blocks migration"

  - id: BP002
    field: BUT000.PARTNER
    check_class: regex_check
    pattern: "^[0-9]{10}$"
    severity: critical
    dimension: validity
    message: "BP number must be 10-digit numeric for S/4HANA conversion"

  - id: BP003
    field: ADR6.SMTP_ADDR
    check_class: domain_value_check
    allowed_values: null
    format: email
    severity: warning
    dimension: completeness
    message: "Email required for customer-facing BP in target state"
```

The runner in `checks/runner.py` loads the YAML for the requested modules, instantiates the
appropriate check class, runs it against the dataframe, and returns a list of `CheckResult`
objects. Exceptions per check are caught and logged — they do not propagate.

---

## LangGraph agent flow

The orchestrator graph runs after the check engine completes. It receives a findings JSON
payload and routes through sub-agents. Build the graph in `agents/orchestrator.py`.

```
findings_json
    │
    ▼
[analyst_agent]          ← reasons about root causes from findings
    │
    ▼
[remediation_agent]      ← generates SAP-specific fix steps per critical/high finding
    │
    ▼
[readiness_agent]        ← scores migration readiness per SAP object (go/no-go)
    │
    ▼
[report_agent]           ← assembles everything into structured report JSON
    │
    ▼
report_json → stored in Postgres → triggers PDF generation Celery task
```

Each sub-agent gets only what it needs. The analyst gets findings summaries. The remediation
agent gets the analyst's root cause output plus the original findings. The report agent gets
all prior outputs. Pass context forward explicitly — do not re-query the database inside agents.

---

## Ingestion pipeline — CSV/Excel upload

This is the primary data path. Build it in `api/routes/upload.py`.

1. Accept multipart file upload (CSV or Excel)
2. Validate file size (max 100MB) and MIME type
3. Store raw file in MinIO under `uploads/{tenant_id}/{uuid}.{ext}`
4. Read into pandas DataFrame
5. Apply column mapping from `checks/rules/{module}/column_map.yaml`
6. Validate required columns are present — return 422 with missing columns if not
7. Store cleaned parquet to MinIO under `staging/{tenant_id}/{uuid}.parquet`
8. Create `analysis_versions` record with status `pending`
9. Enqueue `run_checks` Celery task with version_id and parquet path
10. Return `{version_id, job_id, status: "pending"}` immediately

The Celery task then runs the check suite, updates the version record, and triggers the
LangGraph orchestrator. The frontend polls `GET /api/v1/versions/{id}` for status.

---

## Cloudflare licence server — implement this exactly

```typescript
// cloudflare/licence-worker/src/index.ts

interface Env {
  LICENCE_KV: KVNamespace;
  LICENCE_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const { licenceKey, machineFingerprint } = await request.json() as {
      licenceKey: string;
      machineFingerprint: string;
    };

    // KV key: licence:{key} → JSON {modules, expiresAt, tenantId, active}
    const record = await env.LICENCE_KV.get(`licence:${licenceKey}`, "json") as {
      modules: string[];
      expiresAt: string;
      tenantId: string;
      active: boolean;
    } | null;

    if (!record || !record.active) {
      return Response.json({ valid: false, reason: "invalid_key" }, { status: 403 });
    }

    if (new Date(record.expiresAt) < new Date()) {
      return Response.json({ valid: false, reason: "expired" }, { status: 403 });
    }

    // Log the ping — timestamp and fingerprint only, no SAP data
    await env.LICENCE_KV.put(
      `ping:${licenceKey}`,
      JSON.stringify({ lastSeen: new Date().toISOString(), machineFingerprint }),
      { expirationTtl: 90 * 24 * 60 * 60 }
    );

    return Response.json({
      valid: true,
      modules: record.modules,
      tenantId: record.tenantId,
      expiresAt: record.expiresAt,
    });
  }
};
```

The customer container calls this on startup and every 24 hours. If the call fails (network
error or invalid key), the container logs a warning and continues — do not hard-fail on licence
check errors to avoid taking down a customer's environment over a transient network issue.
After 48 hours of consecutive failures, start refusing new analysis jobs but keep the dashboard
and existing data accessible.

---

## Docker Compose — key services

```yaml
# docker-compose.yml (structure — fill in full config)
services:
  api:
    image: ghcr.io/nxt-biz/vantax-api:latest
    environment:
      - LLM_PROVIDER=ollama
      - OLLAMA_BASE_URL=http://llm:11434
      - DATABASE_URL=postgresql://vantax:${DB_PASSWORD}@db:5432/vantax
      - REDIS_URL=redis://redis:6379/0
      - MINIO_ENDPOINT=minio:9000
      - LICENCE_KEY=${LICENCE_KEY}
      - LICENCE_SERVER_URL=https://licence.dqagent.vantax.co.za
    depends_on: [db, redis, minio, llm]
    ports: ["8000:8000"]

  worker:
    image: ghcr.io/nxt-biz/vantax-api:latest   # same image, different command
    command: celery -A workers.celery_app worker --loglevel=info --concurrency=4
    environment: *api-env                        # inherit from api service
    depends_on: [db, redis, minio, llm]

  frontend:
    image: ghcr.io/nxt-biz/vantax-frontend:latest
    ports: ["3000:3000"]
    environment:
      - NEXT_PUBLIC_API_URL=http://api:8000

  db:
    image: postgres:16-alpine
    volumes: [postgres_data:/var/lib/postgresql/data]
    environment:
      - POSTGRES_DB=vantax
      - POSTGRES_PASSWORD=${DB_PASSWORD}

  redis:
    image: redis:7-alpine
    volumes: [redis_data:/data]

  llm:
    image: ollama/ollama:latest
    volumes: [ollama_models:/root/.ollama]
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    volumes: [minio_data:/data]
    environment:
      - MINIO_ROOT_USER=vantax
      - MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}

volumes:
  postgres_data:
  redis_data:
  ollama_models:
  minio_data:
```

---

## Environment variables — full reference

```bash
# LLM — choose one mode
LLM_PROVIDER=ollama                          # ollama | ollama_cloud | anthropic
OLLAMA_BASE_URL=http://llm:11434             # internal Docker service address
OLLAMA_MODEL=llama3.1:70b
OLLAMA_API_KEY=                              # only needed for ollama_cloud
ANTHROPIC_API_KEY=                           # only needed for anthropic

# Database
DATABASE_URL=postgresql://vantax:password@db:5432/vantax

# Redis
REDIS_URL=redis://redis:6379/0

# MinIO
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=vantax
MINIO_SECRET_KEY=
MINIO_BUCKET_UPLOADS=vantax-uploads
MINIO_BUCKET_REPORTS=vantax-reports

# Licence
LICENCE_KEY=                                 # issued by Vantax portal
LICENCE_SERVER_URL=https://licence.dqagent.vantax.co.za

# Notifications
RESEND_API_KEY=                              # or configure SMTP_HOST for air-gapped
TEAMS_WEBHOOK_URL=                           # optional — per tenant config

# Auth
CLERK_SECRET_KEY=                            # or set AUTH_MODE=local for air-gapped

# Observability
SENTRY_DSN=                                  # optional
```

---

## SAP module priority order — build in this sequence

Build Phase 2 (check engine) starting with the three highest-value modules. Do not skip ahead.

| Priority | Module | Reason |
|---|---|---|
| 1 | Business Partner (ECC) | Most critical for S/4HANA migration — BP001-BP020 rules |
| 2 | Material Master (ECC) | Highest volume, most migration-blocking issues |
| 3 | GL Accounts (FI) | Required for base package commercial offering |
| 4 | Employee Central (SF) | Highest SuccessFactors demand |
| 5 | AP/AR (FI) | Completes the core finance picture |
| 6–29 | Remaining modules | In order of customer demand — track via Vantax portal |

---

## Build phases — work in this order

**Phase 1 — Foundation (3 weeks)**
Stand up the full Docker Compose stack locally. FastAPI skeleton with health endpoint.
Postgres schema with RLS policies and Alembic migrations. Celery + Redis wired up.
MinIO buckets created on startup. Ollama pulling the model. All services healthy.
Do not write check logic yet. Prove the stack works end to end first.

**Phase 2 — Check engine (5 weeks)**
CSV upload pipeline. Column mapping YAML schema. Three core module rule files (BP,
Material Master, GL). All check class types implemented. Runner loading YAML and
dispatching correctly. DQS scoring service. Findings stored to Postgres. No LLM yet.
By end of Phase 2 you should be able to upload a CSV, run checks, and see findings in the DB.

**Phase 3 — LangGraph agents (4 weeks)**
Swappable LLM provider. Orchestrator graph wired through all four sub-agents. Remediation
text stored against findings. Readiness scoring per SAP object. Report JSON assembled.
WeasyPrint PDF template for the executive report. PDF stored to MinIO.

**Phase 4 — Dashboard (4 weeks)**
Next.js frontend. Executive DQS dashboard with trend sparklines. Module heatmap.
Findings drill-down. Version comparison view. PDF download. Clerk auth with org-level tenancy.
Notification settings (email, Teams webhook).

**Phase 5 — Cloudflare control plane (2 weeks)**
Workers licence server + KV store. Wrangler deployment. Vantax portal on Pages.
Stripe integration with webhook module gating. GHCR image publishing via GitHub Actions.
Install, update, and healthcheck scripts. Customer deployment bundle packaged.

**Phase 6 — Module expansion (ongoing)**
Remaining 26 SAP modules in priority order. PyRFC live connector. Kubernetes Helm chart.
Air-gapped deployment mode (offline licence, local SMTP relay).

---

## Coding standards

- Python 3.12. Type hints on every function signature. Pydantic models for all API request and
  response bodies.
- FastAPI dependency injection for database sessions, tenant context, and auth.
- All database access through the query functions in `db/queries/` — no raw SQL in routes
  or agents.
- Celery tasks must be idempotent. A task run twice with the same inputs must produce the same
  result without creating duplicate records.
- Every check class must inherit from `checks/base.py:BaseCheck` and return a `CheckResult`.
  Exceptions inside a check are caught by the runner — never let them propagate.
- Frontend: Next.js 15 App Router, TypeScript strict mode, Tailwind v4, shadcn/ui components.
  No `any` types. All API calls through typed fetch wrappers in `frontend/lib/api/`.
- Commit messages: `phase-N: short description` — e.g. `phase-2: add BP null check rule`.

---

## What success looks like at the end of Phase 5

A customer can:
1. Run `./scripts/install.sh` on their server and have the full stack running within 30 minutes
2. Upload a CSV export from SAP transaction SE16
3. See a DQS score per module within 10 minutes of upload
4. Read LLM-generated remediation guidance specific to SAP — not generic advice
5. Download a branded PDF executive report
6. Configure a daily email digest of findings
7. The Vantax portal shows their licence status and allows module add-ons via Stripe

At no point does any SAP data leave their server.

---

## If you are uncertain

Stop. State the uncertainty. Ask before proceeding. Do not guess at schema names, module IDs,
or SAP field names. Do not invent check logic — derive it from the YAML rule definitions.
Do not pass raw data to the LLM. When in doubt, the answer is almost always: put it in a
deterministic Python function, not a prompt.

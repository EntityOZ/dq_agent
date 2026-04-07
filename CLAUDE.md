# Meridian Platform — Claude Code Instructions

You are building **Meridian**, a customer-deployed SAP Data Quality and Master Data Management platform. Read this file fully at the start of every session before touching any code.

---

## What you are building

Meridian analyses SAP data quality across 29 modules and 254+ predefined validation checks. It ships as a customer-hosted Docker Compose stack — SAP data, findings, and reports never leave the customer's own environment.

The product also includes a full MDM platform: golden records, match & merge, business glossary, stewardship workbench, cleaning engine, exception management, analytics, NLP query interface, data contracts, SAP sync engine, and a governance dashboard.

The **Config Intelligence Engine** reverse-engineers live SAP configuration from transactional data alone — no SPRO access, no RFC calls. It has 3 layers: Config Discovery (extract config inventory), Process Detection (match business process signatures), and Alignment Validation (find misalignment between config and processes).

A centralised Cloudflare control plane (**Meridian HQ**) handles licencing, billing, and admin — it never touches SAP data.

---

## Architecture — know this before writing a line of code

```
┌─────────────────────────────────────────────────────────┐
│                   CLOUDFLARE (Your infra)                │
│                                                          │
│  ┌──────────────────────┐  ┌──────────────────────────┐  │
│  │   Meridian HQ        │  │   Licence Worker         │  │
│  │   (Admin Portal)     │  │   (API)                  │  │
│  │                      │  │                          │  │
│  │  • Tenant CRUD       │  │  POST /api/licence/      │  │
│  │  • Module toggles    │  │       validate           │  │
│  │  • Rules engine      │  │                          │  │
│  │  • LLM tier config   │  │  Returns: licence        │  │
│  │  • Field mappings    │  │  manifest + rules +      │  │
│  │  • Stripe billing    │  │  field mappings          │  │
│  │  • Analytics dash    │  │                          │  │
│  │                      │  │  Cloudflare D1 database  │  │
│  │  Auth: CF Access     │  │                          │  │
│  │  Domain:             │  │  Domain:                 │  │
│  │  meridian-hq.        │  │  licence.meridian.       │  │
│  │  vantax.co.za        │  │  vantax.co.za            │  │
│  └──────────────────────┘  └─────────┬────────────────┘  │
│                                      │                   │
└──────────────────────────────────────┼───────────────────┘
                                       │ Licence validation
                                       │ (key + manifest only,
                                       │  NO customer data)
┌──────────────────────────────────────┼───────────────────┐
│              CUSTOMER ENVIRONMENT     │                   │
│                                      ▼                   │
│  ┌──────────────────────────────────────────────────┐    │
│  │   Customer Meridian Deployment                    │    │
│  │                                                   │    │
│  │  ┌─────────┐ ┌─────────┐ ┌────────┐ ┌────────┐  │    │
│  │  │ Next.js │ │ FastAPI │ │Postgres│ │ Celery │  │    │
│  │  │Frontend │ │ Backend │ │  + RLS │ │Workers │  │    │
│  │  └─────────┘ └─────────┘ └────────┘ └────────┘  │    │
│  │  ┌─────────┐ ┌─────────┐                         │    │
│  │  │ Ollama  │ │ MinIO   │  (Tier 2 only)           │    │
│  │  └─────────┘ └─────────┘                         │    │
│  │                                                   │    │
│  │  All SAP data stays HERE — never leaves           │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### Two zones, hard boundary

**Zone 1 — Cloudflare (Meridian infra, no SAP data)**
- `meridian-hq.vantax.co.za` — Admin portal (Clerk auth, Stripe billing)
- `licence.meridian.vantax.co.za` — Licence worker (Cloudflare D1)

**Zone 2 — Customer stack (their infra, all SAP data)**
- FastAPI + LangGraph — API and agent orchestration
- Celery + Redis — background workers
- Postgres — all customer data (RLS enforced)
- Ollama — local LLM (Tier 2 only)
- MinIO — S3-compatible file store
- Next.js — dashboard (27 page routes)

### The only outbound calls from the customer stack
1. Licence ping to `licence.meridian.vantax.co.za` every 6 hours — key + machine fingerprint only
2. Image pull from Docker Hub — only when customer explicitly runs `update.sh`

Air-gapped customers use offline JWT tokens and pre-loaded Docker images — zero outbound calls.

---

## Project structure

```
meridian/
├── CLAUDE.md                        ← this file
├── DEPLOYMENT.md                    ← admin operations guide
├── docker-compose.yml               ← production (pre-built images from Docker Hub)
├── docker-compose.dev.yml           ← dev overrides (build from source, hot reload)
├── .env.example                     ← all config vars documented
├── .env                             ← secrets (gitignored)
│
├── docker/                          ← production Dockerfiles (IP-protected builds)
│   ├── Dockerfile.api.prod          ← multi-stage: compiles .pyc, strips source
│   ├── Dockerfile.worker.prod       ← same build, Celery entrypoint
│   ├── Dockerfile.frontend.prod     ← Next.js standalone, no source in image
│   ├── Dockerfile.nginx             ← custom nginx reverse proxy image
│   ├── Dockerfile.ollama            ← pre-baked Ollama model (Tier 2)
│   ├── nginx/
│   │   ├── nginx.conf               ← global nginx config (worker tuning, gzip)
│   │   └── meridian.conf            ← reverse proxy site config (API/frontend routing, HTTPS)
│   ├── docker-compose.customer.yml  ← customer template (pre-built images)
│   └── docker-compose.customer.ollama.yml ← Tier 2 Ollama overlay
│
├── .github/
│   └── workflows/
│       ├── build-push.yml           ← dev: build + push to GHCR on push to main
│       ├── release.yml              ← prod: build + push to Docker Hub on version tags
│       ├── test.yml                 ← run tests on every push/PR
│       └── deploy-cloudflare.yml   ← deploy licence worker + HQ portal
│
├── api/                             ← FastAPI application
│   ├── main.py
│   ├── config.py
│   ├── deps.py
│   ├── models/
│   │   └── config_intelligence.py   ← dataclass models for config intelligence engine
│   ├── middleware/
│   │   ├── tenant.py                ← JWT → tenant_id → Postgres RLS context
│   │   └── licence.py               ← module entitlement enforcement
│   ├── routes/                      ← all API endpoints
│   └── services/
│       ├── licence_service.py       ← online/offline licence strategies
│       ├── config_intelligence/     ← Config Intelligence Engine (3-layer)
│       │   ├── discovery.py         ← Layer 1: config discovery from transactional data
│       │   ├── process_detector.py  ← Layer 2: 7 business process signature detection
│       │   ├── alignment_validator.py ← Layer 3: 8 alignment check categories + CHS + root cause
│       │   ├── drift_detector.py    ← config drift between runs (added/removed/modified)
│       │   ├── engine.py            ← orchestrator chaining all 3 layers
│       │   ├── persistence.py       ← save/load analysis runs to PostgreSQL
│       │   └── serializers.py       ← dataclass → Pydantic response converters
│       └── ...                      ← scoring, cleaning, NLP, export, etc.
│
├── llm/
│   └── provider.py                  ← swappable LLM (ollama|ollama_cloud|anthropic|azure_openai|custom)
│
├── agents/                          ← LangGraph agents
├── workers/                         ← Celery tasks
├── checks/                          ← deterministic check engine + YAML rules
├── db/                              ← SQLAlchemy schema + Alembic migrations
├── sap/                             ← pluggable SAP connector (rfc|ctypes|odata|mock)
├── frontend/                        ← Next.js 15 dashboard (standalone output)
│   ├── app/                         ← 27 page routes (App Router)
│   ├── lib/api/                     ← 18 typed fetch wrapper modules
│   └── components/                  ← shadcn/ui + charts
│
├── cloudflare/
│   ├── licence-worker/              ← Cloudflare Worker (D1 database)
│   │   └── src/index.ts             ← validate + admin + offline token endpoints
│   └── portal/                      ← Meridian HQ (Next.js on Cloudflare Pages)
│       └── app/
│           ├── admin/               ← admin dashboard, tenant CRUD, rules, field mappings
│           └── api/admin/           ← proxy routes → licence worker
│
├── scripts/
│   ├── meridian-deploy.sh           ← interactive installer (licence, Docker, SSL, admin)
│   ├── install.sh                   ← first-time customer setup
│   ├── update.sh                    ← pull new images, run migrations
│   ├── healthcheck.sh               ← validate all services
│   ├── backup.sh                    ← database backup
│   ├── package-deployment.sh        ← generate IP-protected customer bundle
│   └── export-images.sh             ← export images for air-gapped deployments
│
├── helm/                            ← Kubernetes Helm chart
└── tests/                           ← test suite (28 files)
```

---

## Core principles

**Deterministic before probabilistic.** Every number in the report comes from a Python check function, not an LLM. The LLM only receives aggregated findings JSON.

**The LLM never sees raw SAP data.** Raw table data stays in Postgres and MinIO. Agents receive only structured finding summaries.

**Tenant isolation is non-negotiable.** Every query must include `tenant_id`. Postgres RLS enforces this — but application code must also call `SET app.tenant_id = '<uuid>'` before every session. Never skip this.

**Check logic lives in YAML + Python.** New validation rules go into YAML files and check classes — not prompts.

**One failing check must not block other checks.** The runner catches exceptions per check.

**AI is always the fallback, never the primary.** Deterministic rules run first. AI only engages when deterministic logic cannot resolve the decision.

**IP protection.** Production images are built from `docker/Dockerfile.*.prod`. Python source is compiled to `.pyc` and stripped. Next.js standalone output contains no source. Customers never receive source code.

---

## LLM tiers — three deployment models

| Tier | Provider | What ships to customer |
|------|---------|----------------------|
| **Tier 1** | Cloud API | No Ollama. `LLM_PROVIDER=anthropic` or `azure_openai` + API key |
| **Tier 2** | Bundled Ollama | `meridianplatform/ollama:qwen3.5:9b-instruct` pre-baked image |
| **Tier 3** | BYOLLM | No Ollama. `LLM_PROVIDER=custom` + customer's own endpoint URL |

### LLM provider abstraction (`llm/provider.py`)

```python
# Providers: ollama | ollama_cloud | anthropic | azure_openai | custom
# Selected by LLM_PROVIDER env var

def get_llm() -> ChatModel:              # raises ValueError for unknown provider
def get_llm_safe() -> ChatModel | None:  # returns None instead of raising (graceful degradation)
def test_llm_connection() -> bool

AI_UNAVAILABLE_MSG = "AI features are temporarily unavailable..."
```

Use `get_llm_safe()` in features that should degrade gracefully. Use `get_llm()` where misconfiguration should fail loudly at startup.

---

## Licence system

### Online mode (default)
- Customer backend calls `POST /api/licence/validate` every 6 hours
- Response: full manifest (modules, menu items, features, rules, field_mappings, llm_config)
- 7-day grace period on 402 response
- After 2 hours of consecutive failures: new analysis jobs blocked, dashboard stays accessible

### Offline mode (air-gapped)
- `MERIDIAN_LICENCE_MODE=offline` + `MERIDIAN_LICENCE_TOKEN=<jwt>`
- JWT is RS256-signed by Meridian HQ private key (`OFFLINE_JWT_PRIVATE_KEY` Worker secret)
- Backend verifies with public key baked into the Docker image
- Token expiry enforced via JWT `exp` claim
- Generate in Meridian HQ: Tenant Detail → "Generate Offline Token"
- Worker endpoint: `POST /api/admin/tenants/:id/offline-token`

### Licence service (`api/services/licence_service.py`)
```python
from api.services.licence_service import get_licence_service

svc = get_licence_service()
manifest = svc.validate()            # immediate validation + cache update
manifest = svc.get_cached()          # last cached manifest
allowed  = svc.is_analysis_allowed() # True if valid or within grace
```

---

## IP protection

### Production build pipeline
1. `git tag v1.2.0 && git push origin v1.2.0`
2. GitHub Actions `.github/workflows/release.yml` builds from `docker/Dockerfile.*.prod`
3. Pushes to `meridianplatform/{api,frontend,worker}:{v1.2.0,latest}` (Docker Hub, private)

### What makes images IP-protected
- **Python**: compiled to `.pyc` with `compileall -b`, all `.py` source deleted
- **Next.js**: standalone build only — no `.tsx`/`.ts` source, no `node_modules`
- **Docker**: multi-stage builds — build stage (with source) not in final image layers

---

## Customer deployment

### Packaging a customer bundle
```bash
./scripts/package-deployment.sh \
  --tier 2 \
  --customer acme-corp \
  --licence-key MRDX-XXXX-XXXX-XXXX \
  --version v1.2.0 \
  --model qwen3.5:9b-instruct \
  --domain https://meridian.acme.com
```

Output: `deployments/acme-corp/` — pre-built images only, no source code.

### Air-gapped
```bash
./scripts/export-images.sh v1.2.0 --tier 2 --model qwen3-5-9b-instruct
# On server: docker load < meridian-v1.2.0.tar.gz && docker compose up -d
```

---

## The pluggable SAP connector

All SAP connectivity goes through `sap/`. Never import `pyrfc` directly outside `sap/rfc.py`.

```python
from sap import get_connector
from sap.base import SAPConnectionParams, SAPConnectorError

with get_connector() as conn:
    conn.connect(params)
    df = conn.read_table("BUT000", ["PARTNER", "BU_TYPE"])
```

Backends: `SAP_CONNECTOR=rfc|ctypes|odata|mock`

---

## DQS scoring formula

```
DQS = (Completeness × 0.25) + (Accuracy × 0.25) + (Consistency × 0.20)
    + (Timeliness × 0.10) + (Uniqueness × 0.10) + (Validity × 0.10)
```

- One Critical failure caps DQS at 85; two+ caps at 70
- Weights configurable per tenant — pure Python, no LLM

---

## Database schema — key tables

```sql
-- Licence (synced from HQ on each validation)
licence_cache (id, tenant_id, manifest_json, validated_at, expires_at)
rules (id, tenant_id, module, category, severity, conditions, enabled)
field_mappings (id, tenant_id, module, standard_field, customer_field)

-- Core analysis
tenants (id, name, licensed_modules[], dqs_weights, stripe_customer_id)
analysis_versions (id, tenant_id, run_at, dqs_summary, status)
findings (id, version_id, tenant_id, module, severity, dimension, ...)

-- MDM
master_records (id, tenant_id, domain, golden_fields, confidence, status)
match_scores (id, tenant_id, candidate_a_key, candidate_b_key, total_score)
glossary_terms (id, tenant_id, sap_table, sap_field, business_definition)
stewardship_queue (id, tenant_id, item_type, priority, sla_hours, ai_recommendation)

-- Config Intelligence
config_inventory (id, tenant_id, run_id, module, element_type, element_value, transaction_count, status)
config_processes (id, tenant_id, run_id, process_id, process_name, status, completeness_score)
config_process_steps (id, process_id, step_number, step_name, detected, volume)
config_alignment_findings (id, tenant_id, run_id, check_id, module, category, severity, title, affected_elements)
config_health_scores (id, tenant_id, run_id, module, chs_score, critical_count, high_count)
config_drift_log (id, tenant_id, run_id, module, element_type, element_value, change_type)

-- RBAC + Audit
users (id, tenant_id, clerk_user_id, email, role, permissions)
llm_audit_log (id, service_name, prompt_hash, token_count, latency_ms)
```

RLS policy on every data table — always set `app.tenant_id` before queries.

---

## LangGraph agent flow

```
findings_json → analyst → remediation → readiness → report_agent → report_json
```

Each agent receives only what it needs. Raw SAP data never enters the agent graph. State in `agents/state.py`, prompts in `agents/prompts.py`.

---

## Frontend design system — light glassmorphism

- **Fonts**: Geist (sans) + Geist Mono via `next/font/google`
- **Primary**: `#0D5639` (Meridian forest green)
- **Background**: `#F7F8FA` + gradient mesh orbs
- **Glass cards**: `rgba(255,255,255,0.70)`, `backdrop-filter: blur(16px)`, border `rgba(0,0,0,0.08)`
- **Classes**: `.vx-card`, `.vx-glass`, `.vx-glass-elevated`, `.vx-glow`, `.vx-mesh-bg`
- Never use dark backgrounds. Use CSS custom property tokens.

---

## RBAC roles

| Role | Permissions |
|------|------------|
| admin | Full access including user management, settings, write-back |
| steward | Stewardship queue, cleaning approval, glossary editing |
| analyst | Read-only analysis, findings, reports, NLP |
| viewer | Dashboard and findings read-only |

---

## SAP module coverage — all 29 modules

| Category | Modules | Rules |
|----------|---------|-------|
| ECC (12) | business_partner, material_master, fi_gl, accounts_payable, accounts_receivable, asset_accounting, mm_purchasing, plant_maintenance, production_planning, sd_customer_master, sd_sales_orders | ~80 |
| SuccessFactors (10) | employee_central, compensation, benefits, payroll_integration, performance_goals, succession_planning, recruiting_onboarding, learning_management, time_attendance | ~50 |
| Warehouse (9) | ewms_stock, ewms_transfer_orders, batch_management, mdg_master_data, grc_compliance, fleet_management, transport_management, wm_interface, cross_system_integration | ~55 |

---

## Coding standards

- Python 3.12. Type hints on every function. Pydantic models for all API request/response bodies.
- FastAPI DI for db sessions, tenant context, auth.
- All DB access through `db/queries/` — no raw SQL in routes or agents.
- Celery tasks must be idempotent (ON CONFLICT on all INSERTs).
- Every check class inherits from `checks/base.py:BaseCheck`, returns `CheckResult`.
- Frontend: Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn/ui. No `any` types.
- API calls through typed wrappers in `frontend/lib/api/`.

### Security standards
- No stack traces to callers — global exception handler returns safe 500.
- RFC WHERE clauses through `validate_rfc_where()` — ABAP keywords blocked.
- Uploads: 8 KB chunk reads, 100 MB limit, magic byte validation, formula injection sanitisation.
- NLP filter values through `sanitise_nlp_filters()` allowlist before SQL.
- Rate limiting via Redis INCR + EXPIRE (graceful degradation if Redis unreachable).

---

## Environment variables — full reference

```bash
# Licence
MERIDIAN_LICENCE_MODE=online             # online | offline
MERIDIAN_LICENCE_KEY=                    # issued by Meridian HQ (online)
MERIDIAN_LICENCE_TOKEN=                  # signed JWT (offline only)
MERIDIAN_LICENCE_SERVER_URL=https://licence.meridian.vantax.co.za/api/licence/validate
MERIDIAN_OFFLINE_PUBLIC_KEY=             # RSA public key (baked into prod images)
MERIDIAN_CORS_ORIGINS=http://localhost:3000

# LLM
LLM_PROVIDER=ollama              # ollama | ollama_cloud | anthropic | azure_openai | custom
OLLAMA_BASE_URL=http://llm:11434
OLLAMA_MODEL=qwen3.5:9b-instruct
OLLAMA_API_KEY=                  # ollama_cloud only
ANTHROPIC_API_KEY=               # anthropic only
ANTHROPIC_MODEL=claude-sonnet-4-6
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-08-01-preview
CUSTOM_LLM_BASE_URL=
CUSTOM_LLM_API_KEY=
CUSTOM_LLM_MODEL=

# Database
DATABASE_URL=postgresql+asyncpg://meridian:password@db:5432/meridian
DATABASE_URL_SYNC=postgresql://meridian:password@db:5432/meridian
DB_PASSWORD=password

# Redis
REDIS_URL=redis://redis:6379/0

# MinIO
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=meridian
MINIO_PASSWORD=minioadmin
MINIO_BUCKET_UPLOADS=meridian-uploads
MINIO_BUCKET_REPORTS=meridian-reports

# SAP
SAP_CONNECTOR=rfc
CREDENTIAL_MASTER_KEY=

# Auth
AUTH_MODE=local
CLERK_SECRET_KEY=

# Notifications
RESEND_API_KEY=
TEAMS_WEBHOOK_URL=

# Observability
SENTRY_DSN=
```

---

## Build phases — complete history

| Phase | Description | Status |
|-------|-------------|--------|
| 1–5 | Foundation, check engine, agents, dashboard, Cloudflare | Done |
| 6a–6c | All 29 SAP modules | Done |
| 6d | PyRFC, K8s, air-gap, write-back | Done |
| A–N | Cleaning, exceptions, analytics, NLP, export, RBAC, MDM (golden records through governance) | Done |
| O | Sync-first navigation redesign | Done |
| ui/new-design | Light glassmorphism redesign | Done |
| P1–P3 | End-to-end integration passes | Done |
| abstract-sap-connector | Pluggable SAP connector | Done |
| fixes | 29-module cleaning coverage, export/writeback fixes | Done |
| review/full-code-review | Security audit | Done |
| phase-3a | Meridian HQ admin portal, D1 migration, licence enforcement | Done |
| phase-3b | IP protection, CI/CD, offline licence, LLM tiers, deployment tooling | Done |
| config-intelligence-p1 | Config Intelligence Engine Phase 1 — DB migration, models, Config Discovery (10 SAP modules) | Done |
| config-intelligence-p2 | Config Intelligence Engine Phase 2 — Process Detection (7 processes), Alignment Validation (8 categories), CHS, root cause bridge, drift detection, orchestrator | Done |
| **config-intelligence-p3** | **Config Intelligence Engine Phase 3 — 13 FastAPI endpoints, Pydantic schemas, DB persistence layer, serializers** | **Done** |

---

## Development setup

```bash
git clone https://github.com/luketempleman/meridian.git && cd meridian
cp .env.example .env
# edit .env — set LLM_PROVIDER=ollama_cloud for dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
docker compose exec api alembic upgrade head
```

---

## Commit convention

`phase-N: short description` — e.g. `phase-3b: IP protection and deployment tooling`

---

## If you are uncertain

Stop. State the uncertainty. Ask before proceeding. Do not guess at schema names, module IDs, or SAP field names. Do not invent check logic. Do not pass raw data to the LLM. When in doubt: put it in a deterministic Python function, not a prompt.

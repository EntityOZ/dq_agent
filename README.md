# Vantax — SAP Data Quality Agent

Vantax is a customer-deployed SAP Data Quality and Master Data Management platform. It analyses data quality across **29 SAP modules** with **254+ predefined validation checks**, manages golden records with AI-assisted survivorship, and provides a full MDM governance layer — all running entirely inside the customer's own environment.

SAP data, findings, and reports **never leave the customer boundary**.

## Key Features

### Data Quality Engine
- **254+ deterministic validation rules** across ECC, SuccessFactors, and Warehouse modules
- **DAMA DMBOK scoring** — composite DQS with 6 dimensions (completeness, accuracy, consistency, timeliness, uniqueness, validity)
- **LangGraph AI agents** — root cause analysis, SAP-specific remediation, migration readiness scoring
- **PDF executive reports** — branded, with DQS heatmap, findings, remediation, MDM health sections

### Master Data Management
- **Golden records** — AI-assisted survivorship (deterministic first, LLM fallback for conflicts)
- **Match & merge engine** — field-level weighted scoring with AI semantic matching
- **Business glossary** — SAP field catalog with AI-enriched definitions and steward assignments
- **Stewardship workbench** — Kanban queue with AI triage, SLA tracking, and performance metrics
- **Data contracts** — schema, quality, freshness, and volume compliance monitoring

### Data Governance
- **Cleaning engine** — 5-category detection (dedup, standardisation, enrichment, validation, lifecycle) across all 29 modules with Excel export
- **Exception management** — rule-based detection, 4-tier SLA, Kanban board, impact estimation (ZAR)
- **Analytics** — predictive DQS forecasting, prescriptive actions, impact analysis, cost avoidance ROI
- **NLP query interface** — "Ask Vantax" natural language search across all findings and MDM data
- **Data lineage** — table-to-field dependency mapping and sync source attribution
- **Relationship graph** — cross-domain SAP relationships with AI impact scoring

### Config Intelligence
- **Config Discovery** — reverse-engineers live SAP configuration from transactional data alone (no SPRO, no RFC)
- **10 module coverage** — FI, MM, SD, PM, PP, Integration, HR, SuccessFactors, Concur, eWMS with ~100 field-to-config-element mappings
- **SAP version detection** — automatic S/4HANA vs ECC identification from field presence
- **Number range analysis** — FI document number utilisation estimation and fiscal period detection
- **Config drift tracking** — detect added, removed, and modified config elements between analysis runs
- **Configuration Health Score (CHS)** — per-module health scoring with severity breakdown

### SAP Integration
- **CSV/Excel upload** — SE16 exports with automatic column mapping
- **Pluggable SAP connector** — abstraction layer supporting PyRFC (default), ctypes, OData, or custom backends via `SAP_CONNECTOR` env var
- **Sync engine** — scheduled data extraction with AI anomaly detection and quality scoring
- **Write-back** — push corrections back to SAP for all 11 ECC modules via BAPI (SF uses OData)

### Platform
- **Multi-tenancy** — PostgreSQL Row Level Security, Clerk auth with RBAC (admin, steward, analyst, viewer)
- **Swappable LLM** — Ollama local (default), Ollama Cloud (dev), Anthropic Claude (customer-approved)
- **Licence gating** — per-module entitlements, Stripe billing (ZAR), air-gapped offline mode
- **Notifications** — email (Resend), Teams webhook, in-app notification centre
- **5-trigger scheduler** — daily digest, weekly summary, on upload, on sync, on exception

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Zone 1 — Cloudflare (no SAP data)                  │
│  ┌──────────────┐ ┌─────────┐ ┌──────────────────┐  │
│  │ Marketing    │ │ Licence │ │ Portal + Stripe  │  │
│  │ Pages        │ │ Worker  │ │ Pages + Webhook  │  │
│  └──────────────┘ └─────────┘ └──────────────────┘  │
└─────────────────────────────────────────────────────┘
              │ licence ping only (no data)
              ▼
┌─────────────────────────────────────────────────────┐
│  Zone 2 — Customer Environment (all SAP data)       │
│  ┌─────────┐ ┌────────┐ ┌──────┐ ┌──────┐ ┌─────┐  │
│  │ FastAPI │ │ Celery │ │ PG16 │ │Redis │ │MinIO│  │
│  │ + Lang  │ │ Worker │ │ +RLS │ │     │ │     │  │
│  │ Graph   │ │ ×4     │ │      │ │     │ │     │  │
│  └─────────┘ └────────┘ └──────┘ └──────┘ └─────┘  │
│  ┌──────────────┐ ┌────────────────────────────┐    │
│  │ Next.js 15   │ │ Ollama (local LLM)         │    │
│  │ Dashboard    │ │ Llama 3.1 70B (swappable)  │    │
│  └──────────────┘ └────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

## Prerequisites

- Docker >= 24.0
- Docker Compose >= 2.20
- curl
- git
- (Optional) NVIDIA GPU + drivers for local Ollama

## Quickstart

1. Clone the repository:
   ```bash
   git clone <repo-url> && cd vantax
   ```

2. Copy the environment file and fill in your values:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your configuration:
   - `DB_PASSWORD` — PostgreSQL password
   - `MINIO_SECRET_KEY` — MinIO password
   - `LICENCE_KEY` — issued from the Meridian HQ
   - `LLM_PROVIDER` — `ollama` (default), `ollama_cloud` (dev), or `anthropic`
   - `SAP_CONNECTOR` — `rfc` (default), `ctypes`, `odata`, or `mock` (see [docs/sap-connector.md](docs/sap-connector.md))

4. Run the install script:
   ```bash
   ./scripts/install.sh
   ```

5. Access the services:
   - Dashboard: http://localhost:3000
   - API: http://localhost:8000
   - API docs: http://localhost:8000/docs (local dev mode only; disabled in production)
   - MinIO console: http://localhost:9001

## SAP Module Coverage

| Category | Modules | Rules |
|---|---|---|
| **ECC** | Business Partner, Material Master, GL Accounts, AP, AR, Asset Accounting, MM Purchasing, Plant Maintenance, Production Planning, SD Customer, SD Sales Orders | ~80 |
| **SuccessFactors** | Employee Central, Compensation, Benefits, Payroll, Performance Goals, Succession Planning, Recruiting & Onboarding, Learning Management, Time & Attendance | ~50 |
| **Warehouse** | eWMS Stock, eWMS Transfer Orders, Batch Management, MDG, GRC Compliance, Fleet Management, Transport Management, WM Interface, Cross-System Integration | ~55 |

**Total: 29 modules, 254+ validation rules**

## Technology Stack

| Component | Technology |
|---|---|
| API | FastAPI (Python 3.12) + LangGraph |
| Background jobs | Celery + Redis |
| Database | PostgreSQL 16 + Alembic migrations |
| Object storage | MinIO (S3-compatible) |
| Local LLM | Ollama (Llama 3.1 70B default) |
| Frontend | Next.js 15, TypeScript, Tailwind v4, shadcn/ui |
| PDF reports | WeasyPrint + Jinja2 |
| Auth | Clerk (or local mode for air-gapped) |
| Licence server | Cloudflare Workers + KV |
| Portal | Next.js on Cloudflare Pages |
| Billing | Stripe (ZAR) |
| SAP connector | Pluggable (`sap/`) — PyRFC, ctypes, OData, mock |
| Container | Docker Compose / Kubernetes Helm chart |

## Development

### Dev mode (no GPU required)

```bash
# Uses Ollama Cloud API instead of local Ollama
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Set `LLM_PROVIDER=ollama_cloud` and provide `OLLAMA_API_KEY` in `.env`.

### Running tests

```bash
pytest tests/ -v
```

### Database migrations

```bash
alembic upgrade head          # apply all migrations
alembic revision --autogenerate -m "description"  # create new migration
```

### Updating

```bash
./scripts/update.sh           # pulls new images, runs migrations
```

## Deployment Options

### Docker Compose (recommended)
Standard deployment for single-server installations. See `docker-compose.yml`.

### Kubernetes Helm Chart
For enterprise deployments. See `helm/vantax/`.

### Air-Gapped Mode
Set `LICENCE_FILE` path for offline licence validation, `AUTH_MODE=local` for local auth,
and configure `SMTP_HOST` for email relay. No outbound internet required.

## Security

- **No SAP data leaves the customer boundary** — LLM runs locally, all storage is internal
- **PostgreSQL Row Level Security** — tenant isolation enforced at the database layer
- **Encrypted credentials** — SAP system passwords stored with versioned encryption keys
- **RBAC** — four roles (admin, steward, analyst, viewer) with granular permissions
- **LLM audit log** — every AI call logged with prompt hash, token count, and latency
- **PII masking** — configurable field masking in logs and reports
- **ABAP injection prevention** — RFC WHERE clause validated against strict allowlist
- **Upload hardening** — chunked reads (OOM prevention), magic byte validation, formula injection sanitisation
- **NLP filter sanitisation** — LLM-extracted filter values validated against known-safe allowlists
- **Global exception handler** — stack traces never leaked to API callers
- **Production lockdown** — /docs and /openapi.json disabled, security response headers enforced
- **Sentry data scrubber** — SAP fields, DataFrames, prompts stripped from error payloads before dispatch
- **Celery idempotency** — all INSERT statements use ON CONFLICT guards to prevent duplicate records on retry
- **Redis-backed rate limiting** — persists across API restarts (RFC connection endpoint)

## Licence

Commercial software. Licence keys issued via the [Meridian HQ](https://portal.meridian.vantax.co.za).

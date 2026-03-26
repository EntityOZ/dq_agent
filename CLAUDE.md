# Vantax SAP Data Quality Agent — Claude Code Instructions

You are building **Vantax**, a customer-deployed SAP Data Quality Agent. This file is your
complete briefing. Read it fully at the start of every session before touching any code.

---

## What you are building

Vantax analyses SAP data quality across 29 modules and 254+ predefined validation checks. It
runs entirely inside the customer's own environment — on-premises or in their cloud VPC. SAP
data, findings, and reports never leave their boundary. You are the engineer responsible for
making this work correctly, reliably, and safely.

The product ships as a Docker Compose stack (and optionally a Kubernetes Helm chart). A separate
Cloudflare control plane handles licencing, billing, and the marketing site — but contains
zero SAP data.

Beyond data quality checks, Vantax now includes a full **Master Data Management (MDM)** platform:
golden records with AI survivorship, match & merge engine, business glossary, stewardship
workbench, data cleaning engine, exception management, analytics, NLP query interface, data
contracts, SAP sync engine, and a governance dashboard.

---

## Architecture — know this before writing a line of code

### Two zones, hard boundary between them

**Zone 1 — Cloudflare (your infra, no SAP data)**
- `meridian.vantax.co.za` — marketing site on Cloudflare Pages
- `portal.meridian.vantax.co.za` — Meridian HQ on Cloudflare Pages (Next.js, licence mgmt, billing)
- `licence.meridian.vantax.co.za` — licence server on Cloudflare Workers + KV
- Stripe handles billing — annual licence fees, per-module add-ons, enterprise tiers in ZAR

**Zone 2 — Customer container stack (their infra, all SAP data)**
- FastAPI + LangGraph — API server and agent orchestration
- Celery + Redis — background job workers (check execution, PDF generation, cleaning, sync, AI tasks)
- Postgres — tenants, versions, findings, golden records, match scores, glossary, stewardship, contracts, MDM metrics
- Ollama — local LLM server (Llama 3.1 70B default, swappable)
- MinIO — S3-compatible local file store (CSV uploads, PDF reports, staging parquet)
- Next.js dashboard — served locally, no Vercel (27 page routes), light glassmorphism UI
- WeasyPrint + Jinja2 — PDF generation inside Celery workers

### The only outbound calls from the customer stack
1. Licence ping to `licence.meridian.vantax.co.za` — key + machine fingerprint only, no data payload
2. Image pull from GHCR — only when customer explicitly runs `update.sh`

Everything else is internal. The LLM never sees raw SAP data — only aggregated findings JSON
and structured summaries for AI-assisted features (survivorship, triage, enrichment).

---

## Project structure

```
vantax/
├── CLAUDE.md                        ← this file
├── docker-compose.yml               ← production customer stack
├── docker-compose.dev.yml           ← dev overrides (Ollama Cloud mode)
├── .env.example                     ← all config vars documented
├── .env                             ← secrets (gitignored, never commit)
├── Dockerfile / Dockerfile.api      ← container images
├── alembic.ini                      ← database migration config
│
├── sap/                             ← pluggable SAP connector abstraction
│   ├── __init__.py                  ← get_connector() factory (SAP_CONNECTOR env var)
│   ├── base.py                      ← SAPConnector ABC, SAPConnectionParams, BAPICall, SAPConnectorError
│   └── rfc.py                       ← RFCConnector (pyrfc wrapper, deferred import)
│
├── api/                             ← FastAPI application
│   ├── main.py                      ← app entrypoint, router registration
│   ├── config.py                    ← settings from env vars
│   ├── deps.py                      ← shared FastAPI dependencies
│   ├── middleware/
│   │   ├── tenant.py                ← extract tenant_id from JWT, set Postgres RLS context
│   │   └── licence.py               ← validate module entitlements per request
│   ├── routes/
│   │   ├── upload.py                ← POST /api/v1/upload (CSV/Excel ingestion)
│   │   ├── analyse.py               ← POST /api/v1/analyse (trigger analysis run)
│   │   ├── versions.py              ← GET /api/v1/versions, /compare
│   │   ├── findings.py              ← GET /api/v1/findings (drill-down)
│   │   ├── reports.py               ← GET /api/v1/reports (PDF download)
│   │   ├── health.py                ← GET /health (used by Docker healthcheck)
│   │   ├── cleaning.py              ← cleaning queue (standardisation, enrichment, dedup)
│   │   ├── exceptions.py            ← exception/issue management (Kanban, SLA tiers)
│   │   ├── analytics.py             ← predictive, prescriptive, impact, operational analytics
│   │   ├── contracts.py             ← data contract compliance (schema, quality, freshness)
│   │   ├── nlp.py                   ← NLP query interface ("Ask Vantax")
│   │   ├── master_records.py        ← golden record CRUD, promotion, conflict resolution
│   │   ├── match_rules.py           ← match rule configuration (field weights, thresholds)
│   │   ├── glossary.py              ← business glossary (SAP field definitions)
│   │   ├── relationships.py         ← cross-domain SAP relationships
│   │   ├── stewardship.py           ← stewardship queue (AI triage, SLA tracking)
│   │   ├── mdm_metrics.py           ← MDM health dashboard metrics
│   │   ├── systems.py               ← SAP system config (RFC hostname, credentials)
│   │   ├── connect.py               ← SAP live extraction via sap/ connector abstraction
│   │   ├── writeback.py             ← write corrections back to SAP via sap/ connector
│   │   ├── ai_feedback.py           ← steward corrections for AI training
│   │   ├── settings.py              ← tenant settings (DQS weights, thresholds)
│   │   ├── users.py                 ← user management (Clerk integration, RBAC)
│   │   └── notifications.py         ← notification centre events
│   └── services/
│       ├── scoring.py               ← DQS formula and dimension calculations
│       ├── column_mapper.py         ← normalise uploaded column names per module
│       ├── storage.py               ← MinIO bucket management
│       ├── standardisers.py         ← SA-specific standardisers (phone, postal, company)
│       ├── cleaning_engine.py       ← 5-category cleaning detection across all 29 modules
│       ├── exception_engine.py      ← rule evaluation, auto-detection, SLA, escalation
│       ├── analytics_engine.py      ← predictive, prescriptive, impact, operational
│       ├── nlp_service.py           ← intent classification, data retrieval, answer synthesis
│       ├── lineage_service.py       ← data lineage mapping (29 module prefixes)
│       ├── export_engine.py         ← export cleaned data (CSV, Excel, LSMW, BAPI, IDoc, SF CSV)
│       ├── golden_record_engine.py  ← survivorship logic (deterministic + AI fallback)
│       ├── survivorship.py          ← deterministic rules (most_recent, trusted_source, majority_vote)
│       ├── ai_survivorship.py       ← LLM-assisted field winner selection
│       ├── match_engine.py          ← record pair matching (blocking, scoring)
│       ├── ai_semantic_matcher.py   ← LLM semantic similarity for match scoring
│       ├── relationship_discovery.py ← cross-domain SAP relationships (17 RFC link maps)
│       ├── ai_impact_scorer.py      ← LLM-scored impact of relationships/changes
│       ├── ai_glossary_enricher.py  ← LLM expansion of glossary definitions
│       ├── mdm_scoring.py           ← MDM health score calculation
│       ├── credential_store.py      ← encrypted password storage for SAP systems
│       ├── rbac.py                  ← role-based access control (analyst, steward, admin)
│       ├── notifications.py         ← Resend email + Teams webhook dispatch
│       └── utils/
│           ├── llm_logger.py        ← LLM call audit logging
│           └── pii_fields.py        ← PII field masking for logs/reports
│
├── agents/                          ← LangGraph agent definitions
│   ├── state.py                     ← AgentState dataclass (message/state schema)
│   ├── prompts.py                   ← centralised system prompts for all sub-agents
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
│   ├── scheduler.py                 ← 5-trigger cron jobs (daily, weekly, on_release, on_sync, on_exception)
│   └── tasks/
│       ├── run_checks.py            ← execute check suite against a dataset
│       ├── run_agents.py            ← invoke LangGraph orchestrator
│       ├── generate_pdf.py          ← render Jinja2 → WeasyPrint → MinIO
│       ├── send_notifications.py    ← email (Resend) + Teams webhook
│       ├── run_cleaning.py          ← execute cleaning rules (dedup, standardisation)
│       ├── run_exception_scan.py    ← rule-based exception detection and triage
│       ├── run_sync.py              ← SAP sync via sap/ connector (extract, match, survivorship, write back)
│       ├── ai_sync_quality.py       ← AI scoring of sync batch quality
│       ├── ai_health_narrative.py   ← LLM narrative for MDM health dashboard
│       ├── ai_triage.py             ← AI-assisted exception/cleaning triage
│       ├── populate_stewardship_queue.py ← queue population from findings/cleaning/exceptions
│       ├── snapshot_mdm_metrics.py  ← daily MDM metric snapshot
│       └── rule_proposal_task.py    ← AI learning: propose new rules from steward corrections
│
├── checks/                          ← deterministic check engine
│   ├── runner.py                    ← loads YAML rules, dispatches to check classes
│   ├── base.py                      ← CheckResult dataclass, base Check class
│   ├── fix_generator.py             ← deterministic fix suggestions from check failures
│   ├── types/                       ← check class implementations
│   │   ├── null_check.py
│   │   ├── domain_value_check.py
│   │   ├── regex_check.py
│   │   ├── cross_field_check.py
│   │   ├── referential_check.py
│   │   └── freshness_check.py
│   └── rules/                       ← 254+ YAML rule definitions across 29 modules
│       ├── ecc/                     ← 12 ECC modules (~80 rules)
│       │   ├── business_partner.yaml
│       │   ├── material_master.yaml
│       │   ├── fi_gl.yaml
│       │   ├── accounts_payable.yaml
│       │   ├── accounts_receivable.yaml
│       │   ├── asset_accounting.yaml
│       │   ├── mm_purchasing.yaml
│       │   ├── plant_maintenance.yaml
│       │   ├── production_planning.yaml
│       │   ├── sd_customer_master.yaml
│       │   ├── sd_sales_orders.yaml
│       │   └── column_map.yaml
│       ├── successfactors/          ← 10 SF modules (~50 rules)
│       │   ├── employee_central.yaml
│       │   ├── compensation.yaml
│       │   ├── benefits.yaml
│       │   ├── payroll_integration.yaml
│       │   ├── performance_goals.yaml
│       │   ├── succession_planning.yaml
│       │   ├── recruiting_onboarding.yaml
│       │   ├── learning_management.yaml
│       │   ├── time_attendance.yaml
│       │   └── column_map.yaml
│       └── warehouse/               ← 11 WM modules (~55 rules)
│           ├── ewms_stock.yaml
│           ├── ewms_transfer_orders.yaml
│           ├── batch_management.yaml
│           ├── mdg_master_data.yaml
│           ├── grc_compliance.yaml
│           ├── fleet_management.yaml
│           ├── transport_management.yaml
│           ├── wm_interface.yaml
│           ├── cross_system_integration.yaml
│           └── column_map.yaml
│
├── db/
│   ├── schema.py                    ← SQLAlchemy ORM schema (40+ tables)
│   ├── migrations/                  ← 22 Alembic migration files
│   │   └── versions/
│   │       ├── 001_initial_schema.py
│   │       ├── ...
│   │       └── 022_stewardship_queue_unique.py
│   ├── queries/                     ← typed query functions per domain
│   │   ├── tenants.py
│   │   ├── versions.py
│   │   ├── findings.py
│   │   └── reports.py
│   └── populate_glossary.py         ← seed data for SAP business glossary
│
├── templates/                       ← Jinja2 report templates
│   ├── executive_report.html        ← PDF template (DQS, heatmap, findings, MDM, golden records)
│   └── assets/
│       └── report.css
│
├── frontend/                        ← Next.js 15 dashboard (served locally, 27 page routes)
│   ├── app/
│   │   ├── layout.tsx               ← root layout
│   │   ├── (dashboard)/
│   │   │   ├── page.tsx             ← executive DQS dashboard
│   │   │   ├── upload/              ← CSV/Excel upload
│   │   │   ├── versions/            ← analysis history & trends
│   │   │   ├── findings/            ← drill-down by module/severity
│   │   │   ├── reports/             ← PDF download & scheduling
│   │   │   ├── golden-records/      ← golden record inventory & detail
│   │   │   ├── stewardship/         ← stewardship workbench & SLA metrics
│   │   │   ├── glossary/            ← business glossary & term detail
│   │   │   ├── dedup/               ← deduplication candidates
│   │   │   ├── match-rules/         ← match rule configuration
│   │   │   ├── cleaning/            ← cleaning queue
│   │   │   ├── exceptions/          ← exception Kanban board
│   │   │   ├── analytics/           ← predictive, prescriptive, impact, operational
│   │   │   ├── contracts/           ← data contract compliance
│   │   │   ├── notifications/       ← notification centre
│   │   │   ├── settings/            ← tenant settings
│   │   │   ├── systems/             ← SAP system connections
│   │   │   ├── sync/                ← MDM sync profiles & runs
│   │   │   ├── nlp/                 ← "Ask Vantax" NLP interface
│   │   │   ├── ai/rules/            ← AI-proposed validation rules
│   │   │   ├── relationships/       ← cross-domain SAP relationships
│   │   │   └── users/               ← user management & RBAC
│   │   ├── sign-in/                 ← Clerk authentication
│   │   ├── sign-up/                 ← Clerk registration
│   │   └── licence-error/           ← licence validation failure
│   ├── lib/api/                     ← 18 typed fetch wrapper modules
│   ├── lib/format.ts               ← score/severity/passRate color utilities (light palette)
│   ├── components/ui/              ← shadcn/ui components (light glass-themed)
│   └── components/charts/          ← Recharts components (light-bg deepened palette)
│
├── cloudflare/                      ← Cloudflare control plane (separate deploy)
│   ├── licence-worker/
│   │   ├── src/index.ts             ← Workers licence validation logic
│   │   ├── src/index.test.ts        ← test suite
│   │   ├── wrangler.toml
│   │   └── vitest.config.ts
│   └── portal/                      ← Meridian HQ (Next.js on Pages)
│       ├── app/
│       │   ├── page.tsx             ← marketing landing
│       │   ├── dashboard/           ← org overview
│       │   ├── billing/             ← Stripe module add-ons
│       │   └── api/webhooks/stripe/ ← Stripe webhook handler
│       ├── lib/
│       │   ├── licence.ts           ← licence key generation/validation
│       │   └── stripe.ts            ← Stripe API client
│       └── scripts/setup-stripe.ts  ← Stripe product/price setup
│
├── helm/                            ← Kubernetes Helm chart
│   └── vantax/
│       ├── Chart.yaml
│       ├── values.yaml
│       └── templates/
│
├── tests/                           ← test suite (28 files)
│   ├── agents/                      ← orchestrator, analyst, remediation, report, readiness
│   ├── checks/                      ← runner, base, check types, all module rules
│   ├── services/                    ← scoring
│   ├── fixtures/                    ← synthetic SAP data generators
│   ├── test_full_pipeline.py        ← end-to-end integration test
│   ├── test_pyrfc_connector.py
│   ├── test_cleaning_engine.py
│   ├── test_export_engine.py
│   ├── test_standardisers.py
│   ├── test_stewardship_workbench.py
│   ├── test_licence_gating.py
│   └── test_phase_o_nav_redesign.py
│
├── scripts/
│   ├── install.sh                   ← first-time setup
│   ├── update.sh                    ← pull new image, run migrations
│   └── healthcheck.sh               ← validate all services running
│
├── docs/                            ← documentation
└── release/                         ← version releases
```

---

## Core principles — follow these without exception

**Deterministic before probabilistic.** Every number in the report comes from a Python check
function, not an LLM. The check engine runs against data using pure logic. The LLM only
receives aggregated findings JSON and reasons about what they mean.

**The LLM never sees raw SAP data.** Raw table data stays in Postgres and MinIO.
The orchestrator passes only structured finding summaries to the LLM. AI-assisted features
(survivorship, triage, enrichment) receive only aggregated/anonymised context — never raw rows.

**Tenant isolation is non-negotiable.** Every database query must include a `tenant_id` filter.
Postgres Row Level Security enforces this at the DB layer — but application code must also
set the RLS context variable before every query session. Never skip this.

**Check logic lives in YAML + Python, not in prompts.** If a new validation rule is needed,
it goes into a YAML file and a check class. Not into a system prompt.

**One failing check must not block other checks.** The runner catches exceptions per check and
records a failed result. An entire module analysis must complete even if individual checks error.

**AI is always the fallback, never the primary.** Deterministic rules run first. AI-assisted
features (survivorship, match scoring, triage) only engage when deterministic logic cannot
resolve the decision. Every AI recommendation is logged in `llm_audit_log`.

---

## Database schema — key tables

The schema has grown to 40+ tables across 22 migrations. Key table groups:

### Core analysis

```sql
tenants (id, name, licensed_modules[], dqs_weights, alert_thresholds, stripe_customer_id)
analysis_versions (id, tenant_id, run_at, label, dqs_summary, metadata, status)
findings (id, version_id, tenant_id, module, check_id, severity, dimension,
          affected_count, total_count, pass_rate, details, remediation_text)
reports (id, tenant_id, version_id, report_json, pdf_path, generated_at)
```

### Cleaning & deduplication

```sql
cleaning_rules (id, tenant_id, object_type, category, rule_definition)
cleaning_queue (id, tenant_id, record_key, status, survivor_key, merge_preview)
cleaning_audit (id, tenant_id, action, actor_id, data_before, data_after)
dedup_candidates (id, tenant_id, match_score, match_method, status)
```

### Exception management

```sql
exceptions (id, tenant_id, type, severity, title, estimated_impact_zar,
            sla_deadline, assigned_to, status)
exception_rules (id, tenant_id, condition, auto_assign_to, is_active)
exception_billing (id, tenant_id, tier1-4 counts/amounts, stripe_invoice_id)
```

### Analytics & contracts

```sql
dqs_history (id, tenant_id, module_id, dimension scores, recorded_at)
impact_records (id, tenant_id, category, annual_risk_zar, mitigated_zar)
cost_avoidance (id, tenant_id, subscription_cost, risk_mitigated, cumulative_roi_multiple)
contracts (id, tenant_id, schema_contract, quality_contract, freshness_contract, volume_contract)
contract_compliance_history (id, tenant_id, actual vs contract values, violations)
```

### Master Data Management

```sql
master_records (id, tenant_id, domain, sap_object_key, golden_fields,
                source_contributions, overall_confidence, status)
master_record_history (id, change_type, previous_fields, new_fields, ai_was_involved)
survivorship_rules (id, tenant_id, domain, field, rule_type, trusted_sources[], weight, ai_inferred)
match_rules (id, tenant_id, domain, field, match_type, weight, threshold, active)
match_scores (id, tenant_id, candidate_a_key, candidate_b_key, total_score,
              field_scores, ai_semantic_score, auto_action)
glossary_terms (id, tenant_id, sap_table, sap_field, technical_name, business_name,
                business_definition, data_steward_id, mandatory_for_s4hana)
stewardship_queue (id, tenant_id, item_type, source_id, domain, priority,
                   assigned_to, status, sla_hours, ai_recommendation, ai_confidence)
```

### SAP integration & governance

```sql
sap_systems (id, tenant_id, host, client, sysnr, environment, is_active)
sync_profiles (id, tenant_id, domain, tables[], schedule_cron, ai_anomaly_baseline)
sync_runs (id, tenant_id, rows_extracted, findings_delta, golden_records_updated,
           ai_quality_score, anomaly_flags)
relationship_types (id, from_table, to_table, relationship_type)
record_relationships (id, tenant_id, from_domain, to_domain, ai_confidence, impact_score)
mdm_metrics (id, tenant_id, snapshot_date, domain, golden_record_count,
             golden_record_coverage_pct, mdm_health_score, ai_narrative)
```

### RBAC & audit

```sql
users (id, tenant_id, clerk_user_id, email, role, permissions)
notifications (id, tenant_id, type, title, body, is_read)
ai_feedback_log (id, tenant_id, queue_item_id, ai_recommendation, steward_decision)
ai_proposed_rules (id, tenant_id, proposed_rule, rationale, status)
llm_audit_log (id, service_name, model_version, prompt_hash, token_count, latency_ms)
```

RLS policy on every data table:
```sql
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

Always run `SET app.tenant_id = '<uuid>'` before any query in a session. The middleware
in `api/middleware/tenant.py` does this automatically from the JWT — but Celery workers
must do it explicitly at the start of each task.

---

## DQS scoring formula

This is the DAMA DMBOK composite score. Implemented in `api/services/scoring.py`.

```
DQS = (Completeness × 0.25) + (Accuracy × 0.25) + (Consistency × 0.20)
    + (Timeliness × 0.10) + (Uniqueness × 0.10) + (Validity × 0.10)
```

- Each dimension score = (passing checks in dimension) / (total checks in dimension) × 100
- A single Critical-severity failure caps the module DQS at 85 regardless of the weighted score
- Two or more Critical failures cap at 70
- Weights are configurable per tenant — read from `tenants.dqs_weights`, fall back to defaults
- Scores are stored in `analysis_versions.dqs_summary` as a nested JSON object

Pure Python with no LLM involvement.

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
        return ChatOllama(
            base_url=os.getenv("OLLAMA_BASE_URL", "http://llm:11434"),
            model=os.getenv("OLLAMA_MODEL", "llama3.1:70b"),
            temperature=0.1,
        )

    if provider == "ollama_cloud":
        return ChatOpenAI(
            base_url="https://api.ollama.com/v1",
            api_key=os.getenv("OLLAMA_API_KEY"),
            model=os.getenv("OLLAMA_MODEL", "llama3.1:70b"),
            temperature=0.1,
        )

    if provider == "anthropic":
        return ChatAnthropic(
            model="claude-sonnet-4-6",
            api_key=os.getenv("ANTHROPIC_API_KEY"),
            temperature=0.1,
        )

    raise ValueError(f"Unknown LLM_PROVIDER: {provider}")
```

Import `get_llm()` wherever an LLM instance is needed. Never hardcode a provider anywhere else.

---

## The pluggable SAP connector — implement exactly this pattern

All SAP connectivity goes through `sap/`. No production code outside `sap/` may import
`pyrfc`, `pyodata`, or `ctypes` directly. The backend is selected via `SAP_CONNECTOR` env var.

```python
# Usage in any route or worker:
from sap import get_connector
from sap.base import SAPConnectionParams, SAPConnectorError, BAPICall

params = SAPConnectionParams(host=..., client=..., sysnr=..., user=..., password=...)
try:
    with get_connector() as conn:
        conn.connect(params)
        df = conn.read_table("BUT000", ["PARTNER", "BU_TYPE"])
except SAPConnectorError as e:
    ...  # message is already password-safe
```

Available backends (controlled by `SAP_CONNECTOR` env var, default `rfc`):

| Value | Implementation | Notes |
|---|---|---|
| `rfc` | `sap/rfc.py` → `RFCConnector` | PyRFC / SAP NW RFC SDK (default, current) |
| `ctypes` | `sap/ctypes_rfc.py` | Direct ctypes bindings (future) |
| `odata` | `sap/odata.py` | OData V2/V4 via pyodata (future) |
| `mock` | `sap/mock.py` | In-memory mock for testing (future) |

Key rules:
- **Always use as a context manager** (`with get_connector() as conn:`) to guarantee `close()`.
- **Never import pyrfc outside `sap/rfc.py`**. The import is deferred to `connect()` so the
  module loads even without SAP NW RFC SDK installed.
- **`SAPConnectorError` messages are password-safe** — the connector masks passwords internally.
  Callers should still mask passwords in any additional error messages they construct.
- Adding a new backend: create `sap/<backend>.py` implementing `SAPConnector`, add an `elif`
  branch in `sap/__init__.py`. No other files need changes.

All four SAP-touching files use this abstraction:
- `api/routes/connect.py` — live RFC extraction endpoint
- `api/routes/systems.py` — test connection endpoint
- `api/routes/writeback.py` — BAPI write-back execution
- `workers/tasks/run_sync.py` — scheduled sync extraction

---

## Check engine — YAML rule format

Every check is defined in YAML. The runner loads these dynamically.

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
```

The runner in `checks/runner.py` loads the YAML for the requested modules, instantiates the
appropriate check class, runs it against the dataframe, and returns a list of `CheckResult`
objects. Exceptions per check are caught and logged — they do not propagate.

Six check types: `null_check`, `domain_value_check`, `regex_check`, `cross_field_check`,
`referential_check`, `freshness_check`.

---

## LangGraph agent flow

The orchestrator graph runs after the check engine completes. It receives a findings JSON
payload and routes through sub-agents.

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

Each sub-agent gets only what it needs. Pass context forward explicitly — do not re-query
the database inside agents. State schema defined in `agents/state.py`, prompts centralised
in `agents/prompts.py`.

---

## AI-assisted features — where the LLM is used

Beyond the core agent flow, the LLM powers several MDM features. In every case, deterministic
logic runs first; the LLM is a fallback or enrichment layer:

| Feature | Service | When LLM engages |
|---|---|---|
| Survivorship | `ai_survivorship.py` | When deterministic rules cannot resolve a field conflict |
| Semantic matching | `ai_semantic_matcher.py` | Pair-wise similarity scoring for fuzzy match candidates |
| Impact scoring | `ai_impact_scorer.py` | Scoring business impact of relationships/changes |
| Glossary enrichment | `ai_glossary_enricher.py` | Auto-filling definition, why_it_matters, sap_impact |
| Exception triage | `ai_triage.py` (worker) | Priority assignment and recommended action |
| Health narrative | `ai_health_narrative.py` (worker) | Daily MDM health summary in natural language |
| Sync quality | `ai_sync_quality.py` (worker) | Anomaly detection on sync batch data |
| Rule proposals | `rule_proposal_task.py` (worker) | Learning new rules from steward correction patterns |

Every LLM call is logged in `llm_audit_log` with prompt hash, token count, and latency.

---

## Ingestion pipeline — CSV/Excel upload

Primary data path, built in `api/routes/upload.py`:

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

## Cleaning engine — 5-category detection across all 29 modules

After checks complete, `run_cleaning` is enqueued automatically. The `CleaningEngine` in
`api/services/cleaning_engine.py` runs five deterministic detection categories:

1. **Duplicates** — exact primary-key dedup (all modules) + O(n^2) fuzzy matching on name,
   email, tax, bank columns (first 500 rows, Levenshtein/Soundex/Jaccard)
2. **Standardisation** — applies SA-specific standardisers (phone, country code, title case,
   legal suffix, UOM, material descriptions) with module-specific mappings
3. **Enrichment gaps** — flags missing fields per module (e.g. currency defaults to ZAR,
   country defaults to ZA, missing payment terms, descriptions, emails)
4. **Validation errors** — SA ID Luhn check, VAT format, bank branch codes, currency code
   validation, negative amount detection (dynamic — any module with an amount column)
5. **Lifecycle issues** — dormant records (>24 months), blocked archival candidates,
   terminated employees with active status, batch expiry

**Column detection uses SAP-prefixed names.** The `_find_col()` function strips SAP table
prefixes (`BUT000.NAME_ORG1` → matches `name_org1`) so detection works with both mapped
and raw SAP column names. Every module has either explicit detection rules or falls back to
generic country/currency/description gap checks.

Results are inserted into `cleaning_queue` (all categories) and `dedup_candidates` (dedup
category only). After insertion, `populate_stewardship_queue` is enqueued immediately so
stewards see items without waiting for the 15-minute scheduler.

---

## Export engine — 6 formats, all 29 modules

The `ExportEngine` in `api/services/export_engine.py` generates cleaned data exports.
`SAP_EXPORT_FIELDS` contains field mappings for all 29 modules (33 entries including
generic object types like `customer`, `vendor`).

| Format | Extension | Content-Type | Notes |
|---|---|---|---|
| `csv` | .csv | text/csv | SAP field headers (KUNNR, NAME1, etc.) |
| `xlsx` | .xlsx | application/vnd.openxmlformats... | Excel via openpyxl, auto-sized columns |
| `lsmw` | .txt | text/plain | Tab-delimited transaction recording format |
| `bapi` | .json | application/json | BAPI call structure for direct execution |
| `idoc` | .json | application/json | IDoc segment structure (EDI_DC40 + E1segment) |
| `sf_csv` | .csv | text/csv | SuccessFactors OData field names |

Export endpoint: `GET /api/v1/cleaning/export/{format}?status=applied&object_type=...`

---

## Write-back BAPI mapping — all 11 ECC modules

The `BAPI_MAP` in `api/routes/writeback.py` maps all ECC modules to their SAP BAPI function:

| Module | BAPI |
|---|---|
| business_partner | BAPI_BUPA_CENTRAL_DATA_SET |
| material_master | BAPI_MATERIAL_SAVEDATA |
| fi_gl | BAPI_GL_ACCOUNT_CREATE |
| accounts_payable | BAPI_VENDOR_CHANGEFROMDATA |
| accounts_receivable | BAPI_CUSTOMER_CHANGEFROMDATA1 |
| asset_accounting | BAPI_FIXEDASSET_CHANGE |
| mm_purchasing | BAPI_PO_CHANGE |
| plant_maintenance | BAPI_EQUI_CHANGE |
| production_planning | BAPI_PRODORD_CHANGE |
| sd_customer_master | BAPI_CUSTOMER_CHANGEFROMDATA1 |
| sd_sales_orders | BAPI_SALESORDER_CHANGE |

SuccessFactors modules use OData APIs (not RFC BAPIs) and are excluded intentionally.

---

## Relationship discovery — 17 RFC link maps

The `DOMAIN_LINK_MAPS` in `api/services/relationship_discovery.py` maps SAP link tables
for cross-domain relationship discovery via RFC. Covers all ECC modules and warehouse
modules that have RFC-accessible link tables. SuccessFactors modules use OData APIs and
are excluded. `cross_system_integration` and `grc_compliance` are audit/control modules
without deterministic link tables.

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

The customer container calls this on startup and every 24 hours. If the call fails,
the container logs a warning and continues. After 48 hours of consecutive failures,
refuse new analysis jobs but keep the dashboard and existing data accessible.

---

## Docker Compose — key services

```yaml
services:
  api:        # FastAPI (port 8000)
  worker:     # Celery (same image, different command, concurrency=4)
  frontend:   # Next.js (port 3000)
  db:         # PostgreSQL 16 (async + sync connections)
  redis:      # Job broker (port 6379)
  minio:      # S3-compatible storage (port 9000 API, 9001 console)
  # llm:      # Ollama — disabled in compose, uses host.docker.internal
```

Dev mode (`docker-compose.dev.yml`) uses Ollama Cloud API — no local GPU required.

---

## Environment variables — full reference

```bash
# SAP connector
SAP_CONNECTOR=rfc                            # rfc | ctypes | odata | mock

# LLM — choose one mode
LLM_PROVIDER=ollama                          # ollama | ollama_cloud | anthropic
OLLAMA_BASE_URL=http://llm:11434
OLLAMA_MODEL=llama3.1:70b
OLLAMA_API_KEY=                              # only for ollama_cloud
ANTHROPIC_API_KEY=                           # only for anthropic

# Database
DATABASE_URL=postgresql+asyncpg://vantax:password@db:5432/vantax
DATABASE_URL_SYNC=postgresql://vantax:password@db:5432/vantax

# Redis
REDIS_URL=redis://redis:6379/0

# MinIO
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=vantax
MINIO_SECRET_KEY=
MINIO_BUCKET_UPLOADS=meridian-uploads
MINIO_BUCKET_REPORTS=meridian-reports

# Licence
LICENCE_KEY=                                 # issued by Meridian HQ
LICENCE_SERVER_URL=https://licence.meridian.vantax.co.za
LICENCE_FILE=                                # alternative: offline licence (air-gapped)

# Notifications
RESEND_API_KEY=                              # or configure SMTP_HOST for air-gapped
TEAMS_WEBHOOK_URL=                           # optional

# Auth
CLERK_SECRET_KEY=                            # or set AUTH_MODE=local for air-gapped

# Observability
SENTRY_DSN=                                  # optional
```

---

## SAP module coverage — all 29 modules implemented

| Category | Modules | Rules |
|---|---|---|
| ECC | business_partner, material_master, fi_gl, accounts_payable, accounts_receivable, asset_accounting, mm_purchasing, plant_maintenance, production_planning, sd_customer_master, sd_sales_orders (12) | ~80 |
| SuccessFactors | employee_central, compensation, benefits, payroll_integration, performance_goals, succession_planning, recruiting_onboarding, learning_management, time_attendance (10) | ~50 |
| Warehouse | ewms_stock, ewms_transfer_orders, batch_management, mdg_master_data, grc_compliance, fleet_management, transport_management, wm_interface, cross_system_integration (11) | ~55 |

All modules include enriched rule files with column mappings.

---

## Build phases — completed and current

### Completed phases

| Phase | Description | Status |
|---|---|---|
| 1–5 | Foundation, check engine, agents, dashboard, Cloudflare | Done |
| 6a | SuccessFactors modules (9 modules, 57 rules) | Done |
| 6b | Remaining ECC modules (8 modules, 74 rules) | Done |
| 6c | Warehouse, fleet, integration modules (9 modules, 65 rules) | Done |
| 6d | PyRFC live connector, K8s hardening, air-gap mode, write-back | Done |
| A | Cleaning engine, dedup, SA standardisers, workbench UI | Done |
| B | Exception management, SAP monitors, Kanban UI | Done |
| C | Predictive, prescriptive, impact, operational analytics | Done |
| D | NLP query interface, data lineage, data contracts | Done |
| E | SAP export formats, full 5-trigger scheduler | Done |
| F | RBAC roles, notification centre, user management | Done |
| G | Exception billing, feature flags, portal enhancements | Done |
| H | SAP sync engine, AI foundation, RBAC extended | Done |
| I | Golden record store and AI survivorship | Done |
| J | Match and merge engine with AI semantic scoring | Done |
| K | Business glossary with AI enrichment | Done |
| L | Stewardship workbench with AI triage | Done |
| M | SAP domain relationship graph with AI impact scoring | Done |
| N | MDM governance dashboard and AI health narrative | Done |
| O | Sync-first navigation redesign (final UI phase) | Done |

### UI redesign

| Branch | Description | Status |
|---|---|---|
| ui/new-design | Light glassmorphism redesign — Geist font, glass cards, mesh bg, deepened palette (~48 files) | Done |
| fixed-UI-Issues | Light glass token flip, font consistency (text-[12px]→text-xs), sidebar scroll fix, color deepening for light bg | Done |

### Integration branches (connecting features end-to-end)

| Branch | Description | Status |
|---|---|---|
| P1 | NLP MDM intents, cleaning→golden link, scheduler AI scoring | Done |
| P2 | Exceptions→stewardship, analytics MDM, contracts golden, licence gating | Done |
| P3 | PDF report MDM Health and Golden Record sections | Done |

### Refactoring

| Branch | Description | Status |
|---|---|---|
| abstract-sap-connector-layer | Pluggable SAP connector abstraction (`sap/` package) — decouples pyrfc from production code | Done |
| fixes | Cleaning engine full 29-module detection, Excel export, export/writeback/relationship/lineage coverage for all modules, stewardship queue wiring | Done |

### Security review

| Branch | Description | Status |
|---|---|---|
| review/full-code-review | Full security and quality audit — 19 findings across 4 severity levels | Done |

---

## Coding standards

- Python 3.12. Type hints on every function signature. Pydantic models for all API request and
  response bodies.
- FastAPI dependency injection for database sessions, tenant context, and auth.
- All database access through the query functions in `db/queries/` — no raw SQL in routes
  or agents.
- Celery tasks must be idempotent. A task run twice with the same inputs must produce the same
  result without creating duplicate records. All INSERT statements must include ON CONFLICT
  clauses using the table's natural key.
- Every check class must inherit from `checks/base.py:BaseCheck` and return a `CheckResult`.
  Exceptions inside a check are caught by the runner — never let them propagate.
- Frontend: Next.js 15 App Router, TypeScript strict mode, Tailwind v4, shadcn/ui components.
  No `any` types. All API calls through typed fetch wrappers in `frontend/lib/api/`.
- Frontend typography: **Geist** (sans) and **Geist Mono** (code) via `next/font/google`.
  `--font-display` is aliased to `--font-sans` (both Geist). No other fonts.
- Frontend theme: **Light glassmorphism** — see "Design system" section below.
  Never introduce dark-mode hex colors (#0F1117 as bg, #E8ECF4 as text, etc.).
  Use CSS custom property tokens (`--primary`, `--foreground`, etc.) or Tailwind semantic
  classes (`text-foreground`, `bg-primary`, `border-black/[0.08]`).
- SAP connectivity: all SAP calls go through `sap/get_connector()`. Never import `pyrfc`,
  `pyodata`, or `ctypes` directly in `api/`, `workers/`, or `agents/`. Always use the
  connector as a context manager (`with get_connector() as conn:`).
- Commit messages: `phase-N: short description` — e.g. `phase-a: cleaning engine`.
  Integration branches: `integration/pN: short description`.

### Frontend design system — light glassmorphism

The UI uses a light glassmorphism aesthetic (Linear/Stripe/Vercel-quality). All design tokens
are defined in `frontend/app/globals.css` under `:root`. Key design decisions:

**Base palette:**
- Background: `#F7F8FA` with subtle gradient mesh orbs (teal, indigo, warm orange)
- Cards: `rgba(255,255,255,0.70)` with `backdrop-filter: blur(16px)`, border `rgba(0,0,0,0.08)`
- Primary accent: `#00D4AA` (vibrant teal-green with glow effects)
- Foreground text: `#1A1F36`, muted: `#6B7280`, secondary: `#4A5568`
- Destructive: `#EF4444`

**Glass tokens (custom properties):**
```css
--glass-bg: rgba(255,255,255,0.70);
--glass-bg-hover: rgba(255,255,255,0.85);
--glass-border: rgba(0,0,0,0.08);
--glass-border-hover: rgba(0,0,0,0.14);
--glass-blur: 16px;
```

**Chart palette (deepened for light bg):**
- Chart-1: `#00D4AA` (primary teal-green)
- Chart-2: `#FF8C42` (warm orange)
- Chart-3: `#16A34A` (deeper green)
- Chart-4: `#6366F1` (deeper indigo)
- Chart-5: `#EF4444` (deeper red)

**Severity colors:** Critical `#DC2626`, High `#EA580C`, Medium `#D97706`, Low `#00D4AA`

**Glass utility classes** (defined in globals.css):
- `.vx-card` — standard glass card (blur, border, shadow, hover effect)
- `.vx-glass` — generic glass surface
- `.vx-glass-elevated` — popover/dialog glass (brighter, more blur)
- `.vx-glow` — primary glow shadow
- `.vx-glass-pill` — active nav pill (primary tint)
- `.vx-glass-shimmer` — hover shimmer animation
- `.vx-mesh-bg` — gradient mesh background (applied to dashboard root)

**Mobile performance:** `backdrop-filter` is disabled below 768px via media query.
Solid white fallback backgrounds are used instead.

**When adding new pages or components:**
1. Use semantic Tailwind classes (`bg-card`, `text-foreground`, `border-border`) over hardcoded hex
2. For surfaces: `bg-white/[0.70]` with `border border-black/[0.08]`
3. For hover states: `hover:bg-black/[0.03]` or `hover:bg-black/[0.04]`
4. For overlays/dialogs: use `.vx-glass-elevated` pattern or `bg-[rgba(255,255,255,0.92)] backdrop-blur-2xl`
5. Chart tooltips: glass elevated style on light bg, readable
6. Never use dark backgrounds (#0F1117, rgba(20,22,30,*)), or the old teal (#0695A8)

### Security standards

- **No stack traces to callers.** The global exception handler in `api/main.py` catches all
  unhandled exceptions and returns a generic 500. Never use `detail=str(e)` from internal
  exceptions — log server-side, return a safe message to the caller.
- **RFC WHERE clause validation.** Any user-supplied WHERE clause for RFC_READ_TABLE must pass
  through `validate_rfc_where()` in `api/routes/connect.py`. Only simple field comparisons
  are permitted. ABAP keywords (SELECT, EXEC, CALL, FUNCTION, SUBMIT) are blocked.
- **Upload security.** File uploads are read in chunks (8 KB) with early abort at 100 MB to
  prevent OOM. Magic bytes are validated before parsing. Formula injection characters
  (=, +, -, @) are sanitised in string cells before storage.
- **NLP filter sanitisation.** All filter values extracted from LLM output in the NLP service
  must pass through `sanitise_nlp_filters()` which validates against known-safe allowlists
  before any value reaches a SQL condition.
- **SQL column whitelists.** Dynamic UPDATE statements must iterate over an explicit
  `ALLOWED_UPDATE_FIELDS` dict mapping body field names to SQL column names. Never use
  `getattr(body, user_input)` to build column names.
- **Rate limiting via Redis.** Rate limits must use Redis INCR + EXPIRE, not in-memory dicts.
  If Redis is unreachable, degrade gracefully (allow the request, log warning).
- **Sentry scrubber.** If SENTRY_DSN is configured, Sentry is initialised with a `before_send`
  hook that strips SAP data fields, DataFrames, prompts, and passwords from all events.
- **Production hardening.** When AUTH_MODE is not `local`, /docs, /openapi.json, and /redoc
  are disabled. Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
  are added to all responses. CORS is restricted to specific methods and headers.
- **Sensitive data in logs.** File paths and SAP table names must use DEBUG level, not INFO.
  Operation completion summaries (version ID, row counts) may use INFO.

---

## What success looks like

A customer can:
1. Run `./scripts/install.sh` on their server and have the full stack running within 30 minutes
2. Upload a CSV export from SAP transaction SE16 or connect live via the SAP connector (PyRFC, OData, or custom backend)
3. See a DQS score per module within 10 minutes of upload
4. Read LLM-generated remediation guidance specific to SAP — not generic advice
5. Download a branded PDF executive report (with MDM health and golden record sections)
6. Review cleaning candidates (dedup, standardisation, validation, enrichment, lifecycle) detected automatically after upload across any of the 29 modules
7. Approve, apply, and export cleaned data as Excel (.xlsx), CSV, LSMW, BAPI JSON, or IDoc
8. Manage golden records with AI-assisted survivorship and conflict resolution
9. Run match & merge with AI semantic scoring for fuzzy dedup
10. Use the NLP "Ask Vantax" interface to query findings in natural language
11. Monitor data contracts for schema, quality, freshness, and volume compliance
12. Track stewardship SLAs and exception resolution on Kanban boards
13. View MDM governance metrics with AI-generated health narratives
14. Configure daily/weekly email digests and Teams webhook notifications
15. Manage users with RBAC (admin, steward, analyst, viewer roles)
16. Write back corrections to SAP for all 11 ECC modules via BAPI
17. The Meridian HQ shows their licence status and allows module add-ons via Stripe

At no point does any SAP data leave their server.

---

## If you are uncertain

Stop. State the uncertainty. Ask before proceeding. Do not guess at schema names, module IDs,
or SAP field names. Do not invent check logic — derive it from the YAML rule definitions.
Do not pass raw data to the LLM. When in doubt, the answer is almost always: put it in a
deterministic Python function, not a prompt.

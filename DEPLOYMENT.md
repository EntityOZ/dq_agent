# Meridian Platform — Admin Deployment Guide

**Audience**: Meridian admin team only. Not for customers.

---

## Section 1 — Meridian HQ Deployment (Cloudflare)

### Prerequisites
- Cloudflare account with `vantax.co.za` domain
- Clerk account (for admin auth on HQ portal)
- Stripe account (for licence billing)
- Wrangler CLI: `npm install -g wrangler && wrangler login`

### DNS Setup
```
meridian-hq.vantax.co.za      → Cloudflare Pages (HQ portal)
licence.meridian.vantax.co.za  → Cloudflare Worker (licence API)
```

### Cloudflare D1 Setup
```bash
cd cloudflare/licence-worker

# Create D1 database
wrangler d1 create meridian-licence

# Run migrations
wrangler d1 execute meridian-licence --file=schema.sql

# Update wrangler.toml with the database_id from above
```

### Secrets to configure in Cloudflare dashboard (Worker)
| Secret | Value |
|--------|-------|
| `LICENCE_ADMIN_SECRET` | Random string — also set in portal env |
| `OFFLINE_JWT_PRIVATE_KEY` | RSA PKCS#8 PEM private key (generate below) |

**Generate RSA key pair for offline token signing:**
```bash
# Generate private key (keep secret — store in Cloudflare Worker secrets)
openssl genrsa -out meridian-offline-private.pem 2048

# Extract public key (embed in production Docker images via MERIDIAN_OFFLINE_PUBLIC_KEY)
openssl rsa -in meridian-offline-private.pem -pubout -out meridian-offline-public.pem

# Set as Worker secret
wrangler secret put OFFLINE_JWT_PRIVATE_KEY < meridian-offline-private.pem
```

### Deploy Licence Worker
```bash
cd cloudflare/licence-worker
npm install
wrangler deploy
```

### Deploy HQ Portal (Cloudflare Pages)
```bash
cd cloudflare/portal
npm install

# Set environment variables in Cloudflare Pages dashboard:
# NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
# CLERK_SECRET_KEY
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
# STRIPE_SECRET_KEY
# STRIPE_WEBHOOK_SECRET
# LICENCE_WORKER_URL=https://licence.meridian.vantax.co.za
# LICENCE_ADMIN_SECRET=<same as Worker secret>

# Deploy
npx wrangler pages deploy .next/standalone --project-name=meridian-hq
# Or connect via GitHub auto-deploy in Cloudflare Pages dashboard
```

### Post-Deployment Verification
```bash
# Check licence worker
curl https://licence.meridian.vantax.co.za/api/licence/heartbeat

# Check admin analytics (requires admin secret)
curl -H "X-Admin-Secret: <secret>" \
  https://licence.meridian.vantax.co.za/api/admin/analytics

# Open HQ portal
open https://meridian-hq.vantax.co.za
```

---

## Section 2 — Customer Deployment Packaging

### Decision Checklist Before Packaging

Before running the packaging script, confirm:

1. **Customer name** and primary contact email
2. **Licence tier**: Starter (ECC only) | Professional (ECC + SF) | Enterprise (all 29 modules)
3. **Which SAP modules to enable** — use tier presets in Meridian HQ
4. **LLM tier**:
   - Tier 1 (Cloud): customer needs outbound internet + API key
   - Tier 2 (Bundled): customer needs extra RAM/disk; optionally GPU
   - Tier 3 (BYOLLM): customer has their own LLM endpoint
5. **Tier 2 model**: `qwen2.5:14b-q4_K_M` (default) or `qwen2.5:7b-q5_K_M` (smaller)
6. **Field mapping mode**: HQ-managed (default) or customer self-service
7. **Customer domain/IP** for CORS: `https://meridian.customer.com`
8. **Licence expiry date** — set in Meridian HQ before generating key
9. **Air-gapped**: does the server have outbound internet access?
10. **Offline licence**: required if air-gapped

### Step-by-Step: Create Tenant and Generate Licence Key

1. Open Meridian HQ: https://meridian-hq.vantax.co.za/admin/tenants/new
2. Fill in company name, contact email, tier, expiry date
3. Enable/disable SAP modules using tier preset buttons
4. Configure LLM tier in "LLM Configuration" section
5. Enable feature toggles as appropriate
6. Click **Save** — licence key (`MRDX-XXXX-XXXX-XXXX`) is displayed once
7. Copy the key — it won't be shown again (only masked suffix is stored)
8. If air-gapped: click **Generate Offline Token** → set expiry → copy or download `.env` snippet

### Run Packaging Script

```bash
# Online (internet-connected customer):
./scripts/package-deployment.sh \
  --tier 2 \
  --customer acme-corp \
  --licence-key MRDX-XXXX-XXXX-XXXX \
  --version v1.2.0 \
  --model qwen2.5:14b-q4_K_M \
  --domain https://meridian.acme.com

# Offline / air-gapped (includes image export):
./scripts/package-deployment.sh \
  --tier 2 \
  --customer secure-bank \
  --offline \
  --offline-token eyJhbGci... \
  --version v1.2.0 \
  --air-gapped

# Tier 1 (cloud LLM):
./scripts/package-deployment.sh \
  --tier 1 \
  --customer startup-co \
  --licence-key MRDX-XXXX-XXXX-XXXX \
  --version v1.2.0 \
  --domain https://meridian.startup.co

# GPU-enabled Tier 2:
./scripts/package-deployment.sh \
  --tier 2 \
  --customer big-enterprise \
  --licence-key MRDX-XXXX-XXXX-XXXX \
  --version v1.2.0 \
  --gpu
```

### What the Script Outputs

`deployments/<customer>/`:
```
docker-compose.yml          ← pre-built images only, NO source code
.env                        ← pre-configured, customer fills in SAP details
README-DEPLOYMENT.md        ← tailored setup guide for the customer
docker-compose.ollama.yml   ← Tier 2 only
meridian-<version>.tar.gz   ← air-gapped only: all Docker images
```

### Customer Handoff

Send the entire `deployments/<customer>/` directory to the customer. If air-gapped, also include the `.tar.gz` file.

The customer needs to:
1. Fill in SAP connection details in `.env`
2. Run `docker compose up -d` (or with Ollama overlay for Tier 2)
3. Run `docker compose exec api alembic upgrade head`

---

## Section 3 — Customer System Requirements

| Tier | CPU | RAM | Disk | GPU |
|------|-----|-----|------|-----|
| Tier 1 (Cloud LLM) | 4 vCPU | 8 GB | 50 GB | Not required |
| Tier 2 (CPU Ollama) | 4 vCPU | 16 GB | 80 GB | Not required |
| Tier 2 (GPU Ollama) | 4 vCPU | 16 GB | 80 GB | NVIDIA 12 GB+ VRAM |
| Tier 3 (BYOLLM) | 4 vCPU | 8 GB | 50 GB | Not required |

OS: Ubuntu 22.04 LTS or RHEL 8+ recommended. Docker Engine 24+ required.

---

## Section 4 — Ongoing Operations

### Update a Customer's Licence
1. Open Meridian HQ → Tenant Detail
2. Modify expiry date, add/remove modules, or change tier
3. Click **Save** — changes take effect on customer's next validation (within 6 hours)
4. For immediate effect: ask customer to restart API container (triggers immediate revalidation)

### Add/Remove SAP Modules
1. Meridian HQ → Tenant Detail → SAP Modules
2. Toggle modules on/off
3. Save → customer backend picks up on next 6-hour validation ping

### Update Rules
1. Meridian HQ → Rules Engine
2. Create/edit/disable rules
3. Rules are automatically included in the next licence validation response
4. No customer action needed — rules sync automatically

### Change a Customer's LLM Tier
1. Update LLM tier in Meridian HQ → Tenant Detail → LLM Configuration
2. Repackage deployment bundle with new tier: `./scripts/package-deployment.sh --tier <new>`
3. Ship updated bundle to customer — they update `.env` and restart

### Rotate a Customer's Licence Key
1. Meridian HQ → Tenant Detail → "Regenerate Key"
2. Copy the new key immediately — not shown again
3. Send new key to customer — they update `MERIDIAN_LICENCE_KEY` in `.env` and restart API

### Generate a Replacement Offline Token
1. Meridian HQ → Tenant Detail → "Generate Offline Token"
2. Set new expiry, generate
3. Customer updates `MERIDIAN_LICENCE_TOKEN` in `.env` and restarts API

### Suspend / Reactivate a Customer
- **Suspend**: Meridian HQ → Tenant Detail → Status → "Suspended" → Save
  - Customer backend will fail validation on next ping → after 2 hours, new analysis jobs blocked
- **Reactivate**: Change status back to "Active" → Save
  - Takes effect on next 6-hour ping or restart

### Monitor Customer Deployments
```bash
# Check heartbeats (last seen timestamps)
curl -H "X-Admin-Secret: <secret>" \
  https://licence.meridian.vantax.co.za/api/admin/tenants \
  | jq '.[] | {name: .company_name, last_ping: .last_ping}'

# Overall HQ analytics
curl -H "X-Admin-Secret: <secret>" \
  https://licence.meridian.vantax.co.za/api/admin/analytics
```

---

## Section 5 — Building and Releasing New Versions

### Tag a Release
```bash
git checkout main && git pull
git tag v1.2.0
git push origin v1.2.0
```

GitHub Actions (`release.yml`) will automatically:
1. Build `api`, `frontend`, `worker` images using `docker/Dockerfile.*.prod`
2. Push to Docker Hub `meridianplatform/{api,frontend,worker}:{v1.2.0,latest}`
3. Re-tag to GHCR for internal access

### Build Ollama Image (when model changes)
```bash
# Trigger manually in GitHub Actions → release.yml → "Run workflow"
# Set build_ollama=true and ollama_model=qwen2.5:14b-q4_K_M
```

Or build locally:
```bash
docker build \
  -f docker/Dockerfile.ollama \
  --build-arg MODEL_NAME=qwen2.5:14b-q4_K_M \
  -t meridianplatform/ollama:qwen2-5-14b-q4-K-M .
docker push meridianplatform/ollama:qwen2-5-14b-q4-K-M
```

### Required GitHub Secrets
| Secret | Description |
|--------|-------------|
| `DOCKERHUB_USERNAME` | Docker Hub username for `meridianplatform` org |
| `DOCKERHUB_TOKEN` | Docker Hub access token (not password) |

---

## Section 6 — Architecture Decisions Log

**Why customer-hosted + centralised HQ**
Data sovereignty requirements mean SAP data must never leave the customer's environment. The HQ handles only licence management (no SAP data) and is entirely separate infrastructure.

**Why Cloudflare**
Edge performance for the licence API (low latency for customer validation pings globally). D1 is SQLite-backed — simple, no infra to manage for licence data. Workers are zero-trust by default.

**Why RLS for tenant isolation**
A single customer deployment may serve multiple tenants (e.g. a group with multiple SAP instances). RLS enforced at the DB layer is defence in depth — application-level bugs cannot leak cross-tenant data.

**Why DB-backed rules (not YAML)**
YAML rules require a code deployment to change. DB-backed rules allow Meridian admins to disable/modify rules for specific customers without touching code. Rules are delivered via the licence manifest, keeping the control plane in HQ.

**Why dual-mode field mapping**
HQ-managed mappings give Meridian control over the customer experience. Self-service mode (for technically capable customers) allows them to map their custom SAP field names without involving Meridian support.

**Why three LLM tiers**
- Tier 1: customers with existing cloud API agreements or data residency that permits cloud API calls
- Tier 2: customers who need fully offline AI (manufacturing, government, regulated industries)
- Tier 3: customers with existing LLM infrastructure (large enterprises with internal AI platforms)

**Why Stripe on HQ only**
Billing is a licence management concern, not a data-processing concern. Keeping Stripe entirely on the Cloudflare side (no customer data) means billing flows cannot accidentally expose SAP data.

**Why Clerk on HQ + local auth on backend**
Separation of control plane (HQ, Clerk-authenticated) and data plane (customer backend, local auth). The customer backend never needs to call external auth services — important for air-gapped deployments.

**Why compiled Python (.pyc) for IP protection**
`.pyc` bytecode is significantly harder to reverse-engineer than Python source. Combined with multi-stage Docker builds (source stage not in final image), this provides practical IP protection for the check engine logic and agent prompts.

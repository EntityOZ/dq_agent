#!/usr/bin/env bash
# =========================================================
# Meridian — Customer Deployment Packaging Script
#
# Generates a deployment bundle for a customer containing:
#   - docker-compose.yml  (pre-built images, NO source code)
#   - .env               (pre-configured with customer values)
#   - README-DEPLOYMENT.md
#   - docker-compose.ollama.yml  (Tier 2 only)
#   - meridian-images.tar.gz     (--air-gapped only)
#
# Usage:
#   ./scripts/package-deployment.sh \
#     --tier <1|2|3> \
#     --customer <name> \
#     --licence-key <MRDX-XXXX-XXXX-XXXX> \
#     --version <v1.0.0> \
#     [--model <model-tag>] \
#     [--domain <customer-domain>] \
#     [--offline] \
#     [--offline-token <jwt>] \
#     [--gpu] \
#     [--air-gapped]
# =========================================================
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
TIER=1
CUSTOMER=""
LICENCE_KEY=""
VERSION="latest"
MODEL="qwen2.5:14b-q4_K_M"
MODEL_TAG="qwen2-5-14b-q4-K-M"
DOMAIN=""
OFFLINE=false
OFFLINE_TOKEN=""
GPU=false
AIR_GAPPED=false
ORG="meridianplatform"

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --tier)         TIER="$2";          shift 2 ;;
    --customer)     CUSTOMER="$2";      shift 2 ;;
    --licence-key)  LICENCE_KEY="$2";   shift 2 ;;
    --version)      VERSION="$2";       shift 2 ;;
    --model)        MODEL="$2";         MODEL_TAG=$(echo "$2" | tr ':' '-' | tr '.' '-'); shift 2 ;;
    --domain)       DOMAIN="$2";        shift 2 ;;
    --offline)      OFFLINE=true;       shift ;;
    --offline-token) OFFLINE_TOKEN="$2"; shift 2 ;;
    --gpu)          GPU=true;           shift ;;
    --air-gapped)   AIR_GAPPED=true;    shift ;;
    *)              echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ── Validation ────────────────────────────────────────────────────────────────
if [[ -z "$CUSTOMER" ]]; then
  echo "Error: --customer is required" >&2; exit 1
fi
if [[ -z "$LICENCE_KEY" && "$OFFLINE" == "false" ]]; then
  echo "Error: --licence-key is required (or use --offline + --offline-token)" >&2; exit 1
fi
if [[ "$OFFLINE" == "true" && -z "$OFFLINE_TOKEN" ]]; then
  echo "Error: --offline-token is required with --offline" >&2; exit 1
fi

OUT_DIR="deployments/${CUSTOMER}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo ""
echo "  Packaging Meridian ${VERSION} for: ${CUSTOMER}"
echo "  Tier: ${TIER} | Offline: ${OFFLINE} | Air-gapped: ${AIR_GAPPED}"
echo ""

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

# ── Generate docker-compose.yml ───────────────────────────────────────────────
sed -e "s|{{VERSION}}|${VERSION}|g" \
    -e "s|{{CUSTOMER_NAME}}|${CUSTOMER}|g" \
    -e "s|{{TIER}}|Tier ${TIER}|g" \
    "${ROOT_DIR}/docker/docker-compose.customer.yml" \
    > "${OUT_DIR}/docker-compose.yml"

# ── Generate Tier 2 Ollama overlay ───────────────────────────────────────────
if [[ "$TIER" == "2" ]]; then
  sed -e "s|{{MODEL_TAG}}|${MODEL_TAG}|g" \
      "${ROOT_DIR}/docker/docker-compose.customer.ollama.yml" \
      > "${OUT_DIR}/docker-compose.ollama.yml"

  if [[ "$GPU" == "true" ]]; then
    # Uncomment the GPU deploy section
    sed -i 's|    # deploy:|    deploy:|g;
            s|    #   resources:|      resources:|g;
            s|    #     reservations:|        reservations:|g;
            s|    #       devices:|          devices:|g;
            s|    #         - driver: nvidia|            - driver: nvidia|g;
            s|    #           count: all|              count: all|g;
            s|    #           capabilities: \[gpu\]|              capabilities: [gpu]|g' \
      "${OUT_DIR}/docker-compose.ollama.yml"
  fi
fi

# ── Generate .env ─────────────────────────────────────────────────────────────
DB_PASS=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-z0-9' | head -c 16)
MINIO_PASS=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-z0-9' | head -c 16)

CORS_VALUE="${DOMAIN:-http://localhost:3000}"
if [[ -n "$DOMAIN" ]]; then
  CORS_VALUE="${DOMAIN},http://localhost:3000"
fi

# Licence config
if [[ "$OFFLINE" == "true" ]]; then
  LICENCE_MODE="offline"
  LICENCE_KEY_LINE=""
  LICENCE_TOKEN_LINE="MERIDIAN_LICENCE_TOKEN=${OFFLINE_TOKEN}"
else
  LICENCE_MODE="online"
  LICENCE_KEY_LINE="MERIDIAN_LICENCE_KEY=${LICENCE_KEY}"
  LICENCE_TOKEN_LINE=""
fi

# LLM config by tier
case "$TIER" in
  1)
    LLM_SECTION="LLM_PROVIDER=anthropic
# Set your Anthropic API key:
ANTHROPIC_API_KEY=
# Or use Azure OpenAI:
# LLM_PROVIDER=azure_openai
# AZURE_OPENAI_ENDPOINT=
# AZURE_OPENAI_API_KEY=
# AZURE_OPENAI_DEPLOYMENT=gpt-4o"
    ;;
  2)
    LLM_SECTION="LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=${MODEL}"
    ;;
  3)
    LLM_SECTION="LLM_PROVIDER=custom
# Set your BYOLLM endpoint:
CUSTOM_LLM_BASE_URL=
CUSTOM_LLM_API_KEY=
CUSTOM_LLM_MODEL="
    ;;
esac

cat > "${OUT_DIR}/.env" <<ENV
# =========================================================
# Meridian Platform — ${CUSTOMER} Configuration
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Version:   ${VERSION}
# Tier:      Tier ${TIER}
# =========================================================

# ── Licence ───────────────────────────────────────────────
MERIDIAN_LICENCE_MODE=${LICENCE_MODE}
${LICENCE_KEY_LINE}
${LICENCE_TOKEN_LINE}
MERIDIAN_LICENCE_SERVER_URL=https://licence.meridian.vantax.co.za/api/licence/validate

# ── CORS (set to your frontend domain) ───────────────────
MERIDIAN_CORS_ORIGINS=${CORS_VALUE}

# ── LLM (Tier ${TIER}) ────────────────────────────────────
${LLM_SECTION}

# ── Database ──────────────────────────────────────────────
DB_PASSWORD=${DB_PASS}
DATABASE_URL=postgresql+asyncpg://meridian:${DB_PASS}@db:5432/meridian
DATABASE_URL_SYNC=postgresql://meridian:${DB_PASS}@db:5432/meridian

# ── Redis ─────────────────────────────────────────────────
REDIS_URL=redis://redis:6379/0

# ── MinIO (object storage) ────────────────────────────────
MINIO_ACCESS_KEY=meridian
MINIO_PASSWORD=${MINIO_PASS}
MINIO_BUCKET_UPLOADS=meridian-uploads
MINIO_BUCKET_REPORTS=meridian-reports

# ── Auth ──────────────────────────────────────────────────
AUTH_MODE=local
NEXT_PUBLIC_AUTH_MODE=local

# ── SAP Connection ────────────────────────────────────────
# Fill in your SAP system credentials:
SAP_CONNECTOR=rfc
CREDENTIAL_MASTER_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)

# ── Notifications (optional) ─────────────────────────────
RESEND_API_KEY=
TEAMS_WEBHOOK_URL=

# ── Observability (optional) ─────────────────────────────
SENTRY_DSN=
ENV

# Remove empty lines from optional sections
sed -i '/^MERIDIAN_LICENCE_KEY=$/ { /^$/d }' "${OUT_DIR}/.env" 2>/dev/null || true
sed -i '/^MERIDIAN_LICENCE_TOKEN=$/ { /^$/d }' "${OUT_DIR}/.env" 2>/dev/null || true

# ── Generate README-DEPLOYMENT.md ────────────────────────────────────────────
if [[ "$TIER" == "2" ]]; then
  START_CMD="docker compose -f docker-compose.yml -f docker-compose.ollama.yml up -d"
  UPDATE_CMD="docker compose -f docker-compose.yml -f docker-compose.ollama.yml pull && ${START_CMD}"
else
  START_CMD="docker compose up -d"
  UPDATE_CMD="docker compose pull && docker compose up -d"
fi

if [[ "$AIR_GAPPED" == "true" ]]; then
  LOAD_NOTE="
## 2. Load Docker Images (Air-gapped)

Transfer \`meridian-${VERSION}.tar.gz\` to the server and load it:
\`\`\`bash
docker load < meridian-${VERSION}.tar.gz
\`\`\`
"
else
  LOAD_NOTE="
## 2. Pull Docker Images

Meridian will pull images automatically when you start the stack.
Ensure the server can reach Docker Hub (hub.docker.com).
"
fi

cat > "${OUT_DIR}/README-DEPLOYMENT.md" <<README
# Meridian Platform — Deployment Guide

**Customer**: ${CUSTOMER}
**Version**: ${VERSION}
**Tier**: Tier ${TIER}$([ "$TIER" == "2" ] && echo " — Bundled Ollama (${MODEL})" || echo "")
**Generated**: $(date -u +"%Y-%m-%d")

---

## Prerequisites

$(case "$TIER" in
  1|3) echo "- 4 vCPUs, 8 GB RAM, 50 GB disk" ;;
  2)   echo "- 4 vCPUs, 16 GB RAM, 80 GB disk"
       [[ "$GPU" == "true" ]] && echo "- NVIDIA GPU with 12 GB+ VRAM (CUDA drivers installed)" ;;
esac)
- Docker Engine 24+ and Docker Compose 2.20+
- Outbound HTTPS access (for licence validation)$([ "$OFFLINE" == "true" ] && echo " — **not required** (offline mode)" || echo "")

Install Docker:
\`\`\`bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker \$USER && newgrp docker
\`\`\`
${LOAD_NOTE}
## 3. Configure .env

Open \`.env\` and fill in any required values marked with a comment.
$([ "$TIER" == "1" ] && echo "**Required**: set \`ANTHROPIC_API_KEY\` (or Azure OpenAI variables)." || echo "")
SAP connection details must be entered before running a sync.

## 4. Start Meridian

\`\`\`bash
${START_CMD}
\`\`\`

## 5. Run Database Migrations

\`\`\`bash
docker compose exec api alembic upgrade head
\`\`\`

## 6. Verify Health

\`\`\`bash
curl http://localhost:8000/health
\`\`\`

Open the dashboard: **http://localhost:3000**

## Updating

\`\`\`bash
${UPDATE_CMD}
docker compose exec api alembic upgrade head
\`\`\`

## Support

Contact Meridian support: support@meridian.vantax.co.za
README

# ── Air-gapped: export images ────────────────────────────────────────────────
if [[ "$AIR_GAPPED" == "true" ]]; then
  echo "  Pulling and exporting Docker images (this may take a while)..."
  bash "${SCRIPT_DIR}/export-images.sh" "${VERSION}" $([ "$TIER" == "2" ] && echo "--tier 2 --model ${MODEL_TAG}" || echo "")
  if [[ -f "meridian-${VERSION}.tar.gz" ]]; then
    mv "meridian-${VERSION}.tar.gz" "${OUT_DIR}/"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "  Deployment bundle created: ${OUT_DIR}/"
echo ""
echo "  Files:"
ls -1 "${OUT_DIR}/"
echo ""
echo "  Ship the entire '${CUSTOMER}/' directory to the customer."
echo "  They run: ${START_CMD}"
echo ""

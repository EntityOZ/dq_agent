#!/usr/bin/env bash
# =========================================================
# Meridian Platform — Customer Installation Script
# 
# Interactive setup for on-premise Meridian deployment.
# This script will:
#   1. Prompt for your licence key
#   2. Validate access to private Docker images
#   3. Configure environment
#   4. Start the platform
# =========================================================
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*"; exit 1; }
step()  { echo -e "\n${CYAN}${BOLD}▶${NC} ${BOLD}$*${NC}\n"; }

# ── Banner ────────────────────────────────────────────────────────────────────
clear
echo -e "${CYAN}"
cat << "EOF"
╔══════════════════════════════════════════════╗
║                                              ║
║        MERIDIAN PLATFORM INSTALLER           ║
║        SAP Data Quality & MDM Platform       ║
║                                              ║
║        © 2026 Vantax. All rights reserved.   ║
║                                              ║
╚══════════════════════════════════════════════╝
EOF
echo -e "${NC}\n"

# ── Prerequisites Check ───────────────────────────────────────────────────────
step "1. Checking Prerequisites"

# Docker
if ! command -v docker &>/dev/null; then
    error "Docker is not installed. Please install Docker Engine 24.0+ from https://docs.docker.com/engine/install/"
fi
DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0.0.0")
DOCKER_MAJOR=$(echo "$DOCKER_VERSION" | cut -d. -f1)
if [ "$DOCKER_MAJOR" -lt 24 ]; then
    error "Docker version 24.0+ required (found $DOCKER_VERSION)"
fi
info "Docker $DOCKER_VERSION detected"

# Docker Compose
if ! docker compose version &>/dev/null; then
    error "Docker Compose is not available. Upgrade Docker to include Compose V2."
fi
COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || echo "0.0.0")
info "Docker Compose $COMPOSE_VERSION detected"

# Disk space (minimum 20GB)
FREE_DISK_GB=$(df -BG . 2>/dev/null | tail -1 | awk '{print $4}' | sed 's/G//' || echo "0")
if [ "$FREE_DISK_GB" -lt 20 ]; then
    warn "Less than 20GB free disk space detected. Meridian requires significant storage for models and data."
fi

# RAM (minimum 8GB recommended)
if [[ -f /proc/meminfo ]]; then
    TOTAL_RAM_GB=$(($(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024))
    if [ "$TOTAL_RAM_GB" -lt 8 ]; then
        warn "Less than 8GB RAM detected. Performance may be impacted. 16GB+ recommended for local LLM."
    fi
fi

# curl
if ! command -v curl &>/dev/null; then
    error "curl is required but not installed"
fi

echo ""

# ── Licence Key Input ─────────────────────────────────────────────────────────
step "2. Licence Activation"

echo "Enter your Meridian licence key provided by Vantax."
echo "Format: MRDX-XXXX-XXXX-XXXX"
echo ""

read -p "Licence Key: " LICENCE_KEY
LICENCE_KEY=$(echo "$LICENCE_KEY" | tr -d ' ' | tr '[:lower:]' '[:upper:]')

# Basic format validation
if [[ ! "$LICENCE_KEY" =~ ^MRDX-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$ ]]; then
    error "Invalid licence key format. Expected: MRDX-XXXX-XXXX-XXXX"
fi

echo ""
info "Licence key accepted: ${LICENCE_KEY:0:9}****-****-${LICENCE_KEY: -4}"

# ── Validate Licence ──────────────────────────────────────────────────────────
step "3. Validating Licence"

LICENCE_SERVER="https://meridian-licence-worker.reshigan-085.workers.dev/api/licence/validate"
echo "Contacting licence server..."

VALIDATION_RESPONSE=$(curl -s -X POST "$LICENCE_SERVER" \
    -H "Content-Type: application/json" \
    -d "{\"licence_key\":\"$LICENCE_KEY\",\"machine_fingerprint\":\"$(hostname)\"}" \
    -w "\n%{http_code}" || echo -e "\n000")

HTTP_CODE=$(echo "$VALIDATION_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$VALIDATION_RESPONSE" | head -n-1)

if [[ "$HTTP_CODE" == "200" ]]; then
    COMPANY_NAME=$(echo "$RESPONSE_BODY" | grep -o '"company_name":"[^"]*"' | cut -d'"' -f4 || echo "Unknown")
    TIER=$(echo "$RESPONSE_BODY" | grep -o '"tier":"[^"]*"' | cut -d'"' -f4 || echo "starter")
    EXPIRY=$(echo "$RESPONSE_BODY" | grep -o '"expiry_date":"[^"]*"' | cut -d'"' -f4 || echo "Unknown")
    
    info "Licence validated successfully"
    echo ""
    echo "  Company:      ${COMPANY_NAME}"
    echo "  Tier:         ${TIER}"
    echo "  Expires:      ${EXPIRY}"
    echo ""
elif [[ "$HTTP_CODE" == "403" ]]; then
    REASON=$(echo "$RESPONSE_BODY" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4 || echo "invalid_key")
    error "Licence validation failed: $REASON"
elif [[ "$HTTP_CODE" == "402" ]]; then
    warn "Licence has expired but is in grace period. Please contact support to renew."
    echo ""
else
    error "Unable to validate licence. Check your internet connection and try again."
fi

# ── GitHub Container Registry Authentication ──────────────────────────────────
step "4. GitHub Container Registry Authentication"

echo "Meridian images are hosted on private GitHub Container Registry."
echo "You'll need a GitHub account with access granted by Vantax."
echo ""
echo "If you don't have access yet, contact support@vantax.co.za with:"
echo "  - Your licence key"
echo "  - Your GitHub username"
echo ""
echo "To create a Personal Access Token:"
echo "  1. Go to: https://github.com/settings/tokens"
echo "  2. Click 'Generate new token (classic)'"
echo "  3. Select scope: 'read:packages'"
echo "  4. Copy the token"
echo ""

read -p "GitHub Username: " GITHUB_USERNAME
read -sp "GitHub Personal Access Token: " GITHUB_TOKEN
echo ""

if ! echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USERNAME" --password-stdin 2>/dev/null; then
    error "GitHub authentication failed. Ensure you have access to Meridian packages. Contact support@vantax.co.za"
fi

info "GitHub Container Registry authenticated successfully"

# ── Configuration ─────────────────────────────────────────────────────────────
step "5. Environment Configuration"

# Generate secure passwords
DB_PASSWORD=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)
MINIO_PASSWORD=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)
SECRET_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 64)

# Create .env file
cat > .env << EOF
# =========================================================
# Meridian Platform — Customer Configuration
# Generated: $(date)
# Licence: ${LICENCE_KEY:0:9}****-****-${LICENCE_KEY: -4}
# =========================================================

# ── Licence ──────────────────────────────────────────────
MERIDIAN_LICENCE_MODE=online
MERIDIAN_LICENCE_KEY=${LICENCE_KEY}
MERIDIAN_LICENCE_SERVER_URL=https://meridian-licence-worker.reshigan-085.workers.dev/api/licence/validate

# ── LLM Configuration (Tier ${TIER}) ─────────────────────
# Default: bundled Ollama (Tier 2)
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://llm:11434
OLLAMA_MODEL=qwen3.5:9b-instruct

# For Cloud API (Tier 1), uncomment and configure:
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=your-api-key-here
# ANTHROPIC_MODEL=claude-sonnet-4-6

# ── Database ─────────────────────────────────────────────
DB_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgresql+asyncpg://meridian:\${DB_PASSWORD}@db:5432/meridian
DATABASE_URL_SYNC=postgresql://meridian:\${DB_PASSWORD}@db:5432/meridian

# ── Redis ────────────────────────────────────────────────
REDIS_URL=redis://redis:6379/0

# ── MinIO (S3-compatible storage) ────────────────────────
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=meridian
MINIO_PASSWORD=${MINIO_PASSWORD}
MINIO_BUCKET_UPLOADS=meridian-uploads
MINIO_BUCKET_REPORTS=meridian-reports

# ── SAP Connector ────────────────────────────────────────
SAP_CONNECTOR=rfc
CREDENTIAL_MASTER_KEY=${SECRET_KEY}

# ── Authentication ───────────────────────────────────────
AUTH_MODE=local
JWT_SECRET=${SECRET_KEY}

# ── CORS ─────────────────────────────────────────────────
MERIDIAN_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# ── Observability (Optional) ─────────────────────────────
# SENTRY_DSN=
# RESEND_API_KEY=
# TEAMS_WEBHOOK_URL=

EOF

info "Configuration file created: .env"
info "Database password: ********** (stored in .env)"
info "MinIO password: ********** (stored in .env)"

# ── Pull Images ───────────────────────────────────────────────────────────────
step "6. Downloading Meridian Images"

VERSION="latest"
echo "Pulling Meridian images from GHCR (this may take several minutes)..."

IMAGES=(
    "ghcr.io/luketempleman/meridian-api:${VERSION}"
    "ghcr.io/luketempleman/meridian-frontend:${VERSION}"
    "ghcr.io/luketempleman/meridian-worker:${VERSION}"
)

# Add Ollama for Tier 2
if [[ "$TIER" == "professional" ]] || [[ "$TIER" == "enterprise" ]]; then
    IMAGES+=("ghcr.io/entityoz/meridian-ollama:qwen3-5-9b-instruct")
fi

for IMAGE in "${IMAGES[@]}"; do
    echo -n "  → Pulling ${IMAGE}..."
    if docker pull "$IMAGE" &>/dev/null; then
        echo -e " ${GREEN}✓${NC}"
    else
        echo -e " ${RED}✗${NC}"
        error "Failed to pull ${IMAGE}. Check your internet connection and Docker Hub access."
    fi
done

info "All images downloaded successfully"

# ── Start Services ────────────────────────────────────────────────────────────
step "7. Starting Meridian Platform"

echo "Starting all services..."

# Determine which compose files to use
COMPOSE_CMD="docker compose"
if [[ "$TIER" == "professional" ]] || [[ "$TIER" == "enterprise" ]]; then
    # Use Ollama overlay
    if [[ -f docker-compose.ollama.yml ]]; then
        COMPOSE_CMD="docker compose -f docker-compose.yml -f docker-compose.ollama.yml"
    fi
fi

$COMPOSE_CMD up -d

echo ""
info "Services starting in the background..."
echo ""
echo "Waiting for health checks..."
sleep 10

# Check API health
for i in {1..30}; do
    if curl -sf http://localhost:8000/health &>/dev/null; then
        info "API is healthy"
        break
    fi
    if [ $i -eq 30 ]; then
        warn "API health check timed out. Check logs: docker compose logs api"
    fi
    sleep 2
done

# ── Run Database Migrations ───────────────────────────────────────────────────
step "8. Initializing Database"

echo "Running database migrations..."
if docker compose exec -T api alembic upgrade head &>/dev/null; then
    info "Database schema initialized"
else
    warn "Migration failed. This may be OK on first install. Check logs if startup fails."
fi

# ── Success ───────────────────────────────────────────────────────────────────
step "Installation Complete! 🎉"

echo -e "${GREEN}${BOLD}"
cat << "EOF"
┌─────────────────────────────────────────────┐
│  Meridian is now running!                   │
└─────────────────────────────────────────────┘
EOF
echo -e "${NC}"

echo "Access the platform:"
echo ""
echo "  🌐 Web Interface:    http://localhost:3000"
echo "  🔧 API Docs:         http://localhost:8000/docs"
echo ""
echo "Useful commands:"
echo ""
echo "  View logs:           docker compose logs -f"
echo "  Stop platform:       docker compose stop"
echo "  Restart platform:    docker compose restart"
echo "  Check status:        docker compose ps"
echo ""
echo "Support:"
echo "  📧 Email:            support@vantax.co.za"
echo "  📚 Documentation:    https://docs.meridian.vantax.co.za"
echo ""

info "Installation log saved to: meridian-install.log"
echo ""

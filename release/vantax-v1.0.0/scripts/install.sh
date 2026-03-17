#!/usr/bin/env bash
set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ─── 1. Banner ───────────────────────────────────────────────────────────────

echo -e "${CYAN}"
echo "╔═══════════════════════════════════╗"
echo "║   VANTAX SAP Data Quality Agent   ║"
echo "║   Installation Script v1.0        ║"
echo "╚═══════════════════════════════════╝"
echo -e "${NC}"

# ─── 2. Check prerequisites ─────────────────────────────────────────────────

info "Checking prerequisites..."

command -v docker  >/dev/null 2>&1 || error "Docker is not installed"
command -v curl    >/dev/null 2>&1 || error "curl is not installed"

# Docker version check (>= 24)
DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0.0.0")
DOCKER_MAJOR=$(echo "$DOCKER_VERSION" | cut -d. -f1)
if [ "$DOCKER_MAJOR" -lt 24 ]; then
    error "Docker >= 24.0.0 required (found $DOCKER_VERSION)"
fi
info "Docker $DOCKER_VERSION ✓"

# Docker Compose version check (>= 2.20)
COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || echo "0.0.0")
COMPOSE_MAJOR=$(echo "$COMPOSE_VERSION" | cut -d. -f1)
COMPOSE_MINOR=$(echo "$COMPOSE_VERSION" | cut -d. -f2)
if [ "$COMPOSE_MAJOR" -lt 2 ] || { [ "$COMPOSE_MAJOR" -eq 2 ] && [ "$COMPOSE_MINOR" -lt 20 ]; }; then
    error "Docker Compose >= 2.20.0 required (found $COMPOSE_VERSION)"
fi
info "Docker Compose $COMPOSE_VERSION ✓"

# Disk space check (>= 20GB free)
FREE_DISK_KB=$(df -k . 2>/dev/null | tail -1 | awk '{print $4}')
if [ -n "$FREE_DISK_KB" ] && [ "$FREE_DISK_KB" -lt 20971520 ]; then
    warn "Less than 20GB free disk space. Model weights and data require significant storage."
fi

# RAM check (>= 8GB)
TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
if [ "$TOTAL_RAM_KB" -gt 0 ] && [ "$TOTAL_RAM_KB" -lt 8388608 ]; then
    warn "Less than 8GB RAM detected. Recommended minimum is 8GB (16GB+ for local LLM)."
fi

# ─── 3. Check .env ──────────────────────────────────────────────────────────

if [ ! -f .env ]; then
    warn ".env file not found — copying from .env.example"
    cp .env.example .env
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Created .env from template. Edit it now and re-run this script."
    echo ""
    echo "  Required values: DB_PASSWORD, MINIO_PASSWORD, LICENCE_KEY"
    echo ""
    echo "    ./scripts/install.sh"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi
info ".env file found ✓"

# Source .env for variable access
set -a
source .env
set +a

# ─── 4. Validate required .env values ───────────────────────────────────────

MISSING_VARS=""
[ -z "${DB_PASSWORD:-}" ] && MISSING_VARS="$MISSING_VARS DB_PASSWORD"
[ -z "${MINIO_PASSWORD:-}" ] && MISSING_VARS="$MISSING_VARS MINIO_PASSWORD"
[ -z "${LICENCE_KEY:-}" ] && MISSING_VARS="$MISSING_VARS LICENCE_KEY"

if [ -n "$MISSING_VARS" ]; then
    error "Required .env values are empty:$MISSING_VARS\n  Edit .env and re-run this script."
fi
info "Required .env values present ✓"

# ─── 5. Validate licence key ────────────────────────────────────────────────

info "Validating licence key..."
LICENCE_URL="${LICENCE_SERVER_URL:-https://licence.dqagent.vantax.co.za}"
LICENCE_RESPONSE=$(curl -s -m 15 -X POST "${LICENCE_URL}/validate" \
    -H "Content-Type: application/json" \
    -d "{\"licenceKey\": \"${LICENCE_KEY}\", \"machineFingerprint\": \"$(hostname)\"}" \
    2>/dev/null || echo "")

if echo "$LICENCE_RESPONSE" | grep -q '"valid":true'; then
    LICENCE_MODULES=$(echo "$LICENCE_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(', '.join(d.get('modules',[])))" 2>/dev/null || echo "unknown")
    LICENCE_EXPIRES=$(echo "$LICENCE_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('expiresAt','unknown'))" 2>/dev/null || echo "unknown")
    info "Licence valid ✓ — modules: $LICENCE_MODULES"
else
    warn "Licence key invalid or cannot reach licence server."
    warn "Check your LICENCE_KEY in .env or visit portal.dqagent.vantax.co.za"
    warn "Continuing anyway — the system will run in degraded mode."
fi

# ─── 6. Pull images ─────────────────────────────────────────────────────────

info "Pulling Docker images..."
if ! docker compose pull; then
    error "Failed to pull Docker images. Check your internet connection and GHCR access."
fi
info "Images pulled ✓"

# ─── 7. Run database migrations ─────────────────────────────────────────────

info "Starting database..."
docker compose up -d db
sleep 5

info "Running database migrations..."
if ! docker compose run --rm api alembic upgrade head; then
    error "Database migration failed. Check DB_PASSWORD and database connectivity."
fi
info "Migrations complete ✓"

# ─── 8. Start all services ──────────────────────────────────────────────────

info "Starting all services..."
docker compose up -d

# ─── 9. Wait for healthchecks ───────────────────────────────────────────────

info "Waiting for services to become healthy..."
TIMEOUT=120
INTERVAL=5
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
    UNHEALTHY=$(docker compose ps --format json 2>/dev/null | \
        python3 -c "
import sys, json
unhealthy = []
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    svc = json.loads(line)
    name = svc.get('Service', svc.get('Name', ''))
    health = svc.get('Health', '')
    state = svc.get('State', '')
    if 'llm' in name.lower():
        continue
    if state != 'running' or (health and health != 'healthy'):
        unhealthy.append(name)
if unhealthy:
    print(','.join(unhealthy))
" 2>/dev/null || echo "checking")

    if [ -z "$UNHEALTHY" ]; then
        info "All services healthy ✓"
        break
    fi

    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
    printf "."
done
echo ""

if [ $ELAPSED -ge $TIMEOUT ]; then
    warn "Timeout waiting for services. Some may still be starting."
    warn "Unhealthy services: $UNHEALTHY"
    warn "Check logs: docker compose logs"
fi

# ─── 10. Pull Ollama model (if applicable) ──────────────────────────────────

LLM_PROVIDER="${LLM_PROVIDER:-ollama}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.1:70b}"

if [ "$LLM_PROVIDER" = "ollama" ]; then
    info "Pulling Ollama model: ${OLLAMA_MODEL}..."
    info "This may take 30-60 minutes for large models."
    docker compose exec llm ollama pull "${OLLAMA_MODEL}" || \
        warn "Failed to pull model — you may need to pull it manually"
fi

# ─── 11. Create initial tenant ──────────────────────────────────────────────

info "Checking for existing tenants..."
docker compose exec api python -c "
from db.queries.tenants import create_initial_tenant
create_initial_tenant()
" 2>/dev/null || warn "Initial tenant creation skipped"

# ─── 12. Final health check ────────────────────────────────────────────────

info "Running final health check..."
HEALTH_RESPONSE=$(curl -s http://localhost:8000/health 2>/dev/null || echo "")

if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    info "API health check passed ✓"
else
    warn "API health check did not return ok — check logs: docker compose logs api"
fi

# ─── 13. Success ─────────────────────────────────────────────────────────────

LICENCE_STATUS=$(echo "$HEALTH_RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    l = d.get('licence', {})
    valid = l.get('valid')
    days = l.get('days_remaining')
    if valid:
        print(f'Valid — {days} days remaining')
    elif valid is None:
        print('Not yet checked')
    else:
        print('Invalid')
except:
    print('Unknown')
" 2>/dev/null || echo "Unknown")

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  ✓ Vantax is running!"
echo ""
echo "  Dashboard:   http://localhost:3000"
echo "  API:         http://localhost:8000"
echo "  API Health:  http://localhost:8000/health"
echo "  Licence:     $LICENCE_STATUS"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

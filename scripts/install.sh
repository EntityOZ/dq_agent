#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ─── 1. Check prerequisites ───────────────────────────────────────────────────

info "Checking prerequisites..."

command -v docker  >/dev/null 2>&1 || error "Docker is not installed"
command -v curl    >/dev/null 2>&1 || error "curl is not installed"
command -v git     >/dev/null 2>&1 || error "git is not installed"

# Docker version check (>= 24)
DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0.0.0")
DOCKER_MAJOR=$(echo "$DOCKER_VERSION" | cut -d. -f1)
if [ "$DOCKER_MAJOR" -lt 24 ]; then
    error "Docker >= 24 required (found $DOCKER_VERSION)"
fi
info "Docker $DOCKER_VERSION ✓"

# Docker Compose version check (>= 2.20)
COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || echo "0.0.0")
COMPOSE_MAJOR=$(echo "$COMPOSE_VERSION" | cut -d. -f1)
COMPOSE_MINOR=$(echo "$COMPOSE_VERSION" | cut -d. -f2)
if [ "$COMPOSE_MAJOR" -lt 2 ] || { [ "$COMPOSE_MAJOR" -eq 2 ] && [ "$COMPOSE_MINOR" -lt 20 ]; }; then
    error "Docker Compose >= 2.20 required (found $COMPOSE_VERSION)"
fi
info "Docker Compose $COMPOSE_VERSION ✓"

# ─── 2. Check .env ────────────────────────────────────────────────────────────

if [ ! -f .env ]; then
    warn ".env file not found — copying from .env.example"
    cp .env.example .env
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Please edit .env with your configuration values, then re-run:"
    echo "    ./scripts/install.sh"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
fi
info ".env file found ✓"

# ─── 3. Pull images ───────────────────────────────────────────────────────────

info "Pulling Docker images..."
docker compose pull --ignore-pull-failures 2>/dev/null || true

# ─── 4. Build local images ────────────────────────────────────────────────────

info "Building local images..."
docker compose build

# ─── 5. Run database migrations ───────────────────────────────────────────────

info "Starting database..."
docker compose up -d db
sleep 5  # Wait for Postgres to be ready

info "Running database migrations..."
docker compose run --rm api alembic upgrade head

# ─── 6. Start all services ────────────────────────────────────────────────────

info "Starting all services..."
docker compose up -d

# ─── 7. Wait for healthchecks ─────────────────────────────────────────────────

info "Waiting for services to become healthy..."
TIMEOUT=120
INTERVAL=5
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
    # Check if all non-llm services are healthy
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
    # Skip llm service
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
    warn "Waiting... ($ELAPSED/${TIMEOUT}s) — unhealthy: $UNHEALTHY"
done

if [ $ELAPSED -ge $TIMEOUT ]; then
    warn "Timeout waiting for all services — some may still be starting"
fi

# ─── 8. Pull Ollama model (if applicable) ─────────────────────────────────────

LLM_PROVIDER=$(grep -E '^LLM_PROVIDER=' .env 2>/dev/null | cut -d= -f2 || echo "ollama")
OLLAMA_MODEL=$(grep -E '^OLLAMA_MODEL=' .env 2>/dev/null | cut -d= -f2 || echo "llama3.1:70b")

if [ "$LLM_PROVIDER" = "ollama" ]; then
    info "Pulling Ollama model: ${OLLAMA_MODEL}..."
    docker compose exec llm ollama pull "${OLLAMA_MODEL}" || warn "Failed to pull model — you may need to pull it manually"
fi

# ─── 9. Connectivity test ─────────────────────────────────────────────────────

info "Running connectivity test..."
HEALTH_RESPONSE=$(curl -s http://localhost:8000/health 2>/dev/null || echo "")
if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    info "API health check passed ✓"
else
    warn "API health check did not return ok — check logs with: docker compose logs api"
fi

# ─── 10. Done ──────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Vantax is running!"
echo ""
echo "  Dashboard:   http://localhost:3000"
echo "  API:         http://localhost:8000"
echo "  API Health:  http://localhost:8000/health"
echo "  MinIO UI:    http://localhost:9001"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

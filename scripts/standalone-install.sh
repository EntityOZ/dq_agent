#!/usr/bin/env bash
# =========================================================
# Meridian Platform — One-Script Installer
# 
# This script handles complete installation:
#   • Licence validation
#   • Image download
#   • Configuration generation
#   • Service deployment
#
# Requirements: Docker 24.0+, internet connection
# =========================================================
set -euo pipefail

# ── Colors ────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*"; exit 1; }
step()  { echo -e "\n${CYAN}${BOLD}━━━ $* ━━━${NC}\n"; }

# ── Banner ────────────────────────────────────────────────
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

# ── Prerequisites ─────────────────────────────────────────
step "Prerequisites Check"

command -v docker &>/dev/null || error "Docker not installed. Get it from: https://docs.docker.com/engine/install/"
command -v curl &>/dev/null || error "curl not installed"

DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0.0.0")
DOCKER_MAJOR=$(echo "$DOCKER_VERSION" | cut -d. -f1)
[ "$DOCKER_MAJOR" -lt 24 ] && error "Docker 24.0+ required (found $DOCKER_VERSION)"

info "Docker $DOCKER_VERSION detected"
info "Docker Compose available"

# ── Licence Key ───────────────────────────────────────────
step "Licence Activation"

echo "Enter your Meridian licence key (provided by Vantax):"
read -p "Licence Key: " LICENCE_KEY
LICENCE_KEY=$(echo "$LICENCE_KEY" | tr -d ' ' | tr '[:lower:]' '[:upper:]')

[[ ! "$LICENCE_KEY" =~ ^MRDX-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$ ]] && \
    error "Invalid licence key format. Expected: MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX"

info "Licence key: ${LICENCE_KEY:0:9}****-****"

# ── Validate Licence ──────────────────────────────────────
step "Validating Licence"

LICENCE_SERVER="https://meridian-licence-worker.reshigan-085.workers.dev/api/licence/validate"
echo "Contacting licence server..."

VALIDATION=$(curl -s -X POST "$LICENCE_SERVER" \
    -H "Content-Type: application/json" \
    -d "{\"licenceKey\":\"$LICENCE_KEY\",\"machineFingerprint\":\"$(hostname)\"}" \
    -w "\n%{http_code}")

HTTP_CODE=$(echo "$VALIDATION" | tail -n1)
BODY=$(echo "$VALIDATION" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
    REASON=$(echo "$BODY" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    error "Licence validation failed: $REASON (HTTP $HTTP_CODE)"
fi

COMPANY=$(echo "$BODY" | grep -o '"company_name":"[^"]*"' | cut -d'"' -f4 || echo "Unknown")
TIER=$(echo "$BODY" | grep -o '"tier":"[^"]*"' | cut -d'"' -f4 || echo "starter")
EXPIRY=$(echo "$BODY" | grep -o '"expiry_date":"[^"]*"' | cut -d'"' -f4 || echo "Unknown")

info "Licence valid"
echo "  Company:  $COMPANY"
echo "  Tier:     $TIER"
echo "  Expires:  $EXPIRY"

# ── Configuration ─────────────────────────────────────────
step "Generating Configuration"

DB_PASS=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)
MINIO_PASS=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)
SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 64)

cat > .env << EOF
# Meridian Platform Configuration
# Generated: $(date)
# Licence: ${LICENCE_KEY:0:9}****-****

MERIDIAN_LICENCE_MODE=online
MERIDIAN_LICENCE_KEY=$LICENCE_KEY
MERIDIAN_LICENCE_SERVER_URL=https://meridian-licence-worker.reshigan-085.workers.dev/api/licence/validate

LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=qwen2.5:3b

DB_PASSWORD=$DB_PASS
DATABASE_URL=postgresql+asyncpg://meridian:$DB_PASS@db:5432/meridian
DATABASE_URL_SYNC=postgresql://meridian:$DB_PASS@db:5432/meridian

REDIS_URL=redis://redis:6379/0

MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=meridian
MINIO_PASSWORD=$MINIO_PASS
MINIO_BUCKET_UPLOADS=meridian-uploads
MINIO_BUCKET_REPORTS=meridian-reports

SAP_CONNECTOR=rfc
CREDENTIAL_MASTER_KEY=$SECRET

AUTH_MODE=local
NEXT_PUBLIC_AUTH_MODE=local
JWT_SECRET=$SECRET

# Clerk dummy keys (required by frontend build, not used in local auth mode)
CLERK_SECRET_KEY=sk_test_bG9jYWwtYXV0aC1tb2RlLWR1bW15c2VjcmV0a2V5
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_bG9jYWwtYXV0aC1tb2RlLWR1bW15a2V5

MERIDIAN_CORS_ORIGINS=http://localhost:3000
EOF

info "Configuration saved to .env"

# ── Docker Compose File ───────────────────────────────────
step "Creating Deployment Configuration"

cat > docker-compose.yml << 'COMPOSE_EOF'
version: "3.9"

networks:
  meridian-net:
    driver: bridge

volumes:
  db_data:
  redis_data:
  minio_data:
  ollama_data:

services:
  db:
    image: postgres:16-alpine
    container_name: meridian-db
    environment:
      POSTGRES_USER: meridian
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: meridian
    volumes:
      - db_data:/var/lib/postgresql/data
    networks:
      - meridian-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U meridian"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: meridian-redis
    volumes:
      - redis_data:/data
    networks:
      - meridian-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  minio:
    image: minio/minio:latest
    container_name: meridian-minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD}
    volumes:
      - minio_data:/data
    networks:
      - meridian-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

  ollama:
    image: ghcr.io/luketempleman/meridian-ollama:latest
    container_name: meridian-ollama
    volumes:
      - ollama_data:/root/.ollama
    networks:
      - meridian-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:11434/api/version"]
      interval: 30s
      timeout: 10s
      retries: 3

  api:
    image: ghcr.io/luketempleman/meridian-api:latest
    container_name: meridian-api
    env_file: .env
    ports:
      - "8000:8000"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - meridian-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    image: ghcr.io/luketempleman/meridian-worker:latest
    container_name: meridian-worker
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - meridian-net
    restart: unless-stopped

  beat:
    image: ghcr.io/luketempleman/meridian-worker:latest
    container_name: meridian-beat
    command: ["celery", "-A", "workers.celery_app", "beat", "--loglevel=info"]
    env_file: .env
    depends_on:
      - redis
    networks:
      - meridian-net
    restart: unless-stopped

  frontend:
    image: ghcr.io/luketempleman/meridian-frontend:latest
    container_name: meridian-frontend
    env_file: .env
    ports:
      - "3000:3000"
    depends_on:
      - api
    networks:
      - meridian-net
    restart: unless-stopped
COMPOSE_EOF

info "Docker Compose configuration created"

# ── Pull Images ───────────────────────────────────────────
step "Downloading Images"

echo "Pulling Meridian images (this may take several minutes)..."

docker compose pull || error "Failed to pull images. Check GHCR access."

info "All images downloaded"

# ── Start Services ────────────────────────────────────────
step "Starting Services"

# Check for existing deployment
if docker ps -a --format '{{.Names}}' | grep -q "^meridian-"; then
    warn "Existing Meridian containers detected"
    echo "Stopping and removing old deployment..."
    docker compose down -v 2>/dev/null || true
    docker rm -f $(docker ps -aq -f "name=meridian-" 2>/dev/null) 2>/dev/null || true
    info "Old deployment cleaned up"
fi

echo "Starting database and Redis..."
docker compose up -d db redis

echo "Waiting for database to be ready..."
for i in {1..30}; do
    if docker compose exec -T db pg_isready -U meridian &>/dev/null; then
        info "Database ready"
        break
    fi
    [ $i -eq 30 ] && error "Database failed to start. Check: docker compose logs db"
    sleep 2
done

echo "Running database migrations..."
docker compose run --rm -T api alembic upgrade head || error "Migration failed"
info "Database initialized"

echo "Starting all services..."
docker compose up -d

info "All services started"

# ── Health Checks ─────────────────────────────────────────
step "Verifying Deployment"

echo "Waiting for API..."
for i in {1..60}; do
    if curl -sf http://localhost:8000/health &>/dev/null; then
        info "API online at http://localhost:8000"
        break
    fi
    [ $i -eq 60 ] && warn "API health check timed out. Check: docker compose logs api"
    sleep 2
done

echo "Waiting for frontend..."
for i in {1..30}; do
    STATUS=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
    if [ "$STATUS" = "200" ] || [ "$STATUS" = "307" ]; then
        info "Frontend online at http://localhost:3000"
        break
    fi
    [ $i -eq 30 ] && warn "Frontend not responding yet. It may still be starting."
    sleep 2
done

# ── Admin User ────────────────────────────────────────────
step "Admin Account Setup"

echo "Create your first admin user:"
echo ""

read -p "Admin Email: " ADMIN_EMAIL
while [ -z "$ADMIN_EMAIL" ]; do
    echo -e "${RED}Email required${NC}"
    read -p "Admin Email: " ADMIN_EMAIL
done

read -p "Admin Name [$ADMIN_EMAIL]: " ADMIN_NAME
ADMIN_NAME="${ADMIN_NAME:-$ADMIN_EMAIL}"

while true; do
    read -sp "Admin Password (min 8 chars): " ADMIN_PASS
    echo ""
    [ ${#ADMIN_PASS} -ge 8 ] && break
    echo -e "${RED}Password must be at least 8 characters${NC}"
done

echo ""
info "Creating admin user..."

# Create user via API
CREATE_RESPONSE=$(curl -sf -X POST http://localhost:8000/api/users \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"name\":\"$ADMIN_NAME\",\"password\":\"$ADMIN_PASS\",\"role\":\"admin\"}" 2>/dev/null || echo "")

if echo "$CREATE_RESPONSE" | grep -q "\"email\""; then
    info "Admin user created: $ADMIN_EMAIL"
else
    warn "Could not create user via API. You can create it after login."
fi

# ── Summary ───────────────────────────────────────────────
step "Installation Complete!"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BOLD}✓ Meridian is running!${NC}"
echo ""
echo "  Dashboard:   ${CYAN}http://localhost:3000${NC}"
echo "  API:         http://localhost:8000"
echo "  Login:       $ADMIN_EMAIL"
echo ""
echo "  Licence:     ${LICENCE_KEY:0:9}****-****"
echo "  Tier:        $TIER"
echo "  Expires:     $EXPIRY"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Useful commands:"
echo "  View logs:    docker compose logs -f"
echo "  Stop:         docker compose stop"
echo "  Restart:      docker compose restart"
echo "  Update:       docker compose pull && docker compose up -d"
echo ""
echo "For support: support@vantax.co.za"
echo ""

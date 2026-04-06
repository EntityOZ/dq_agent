#!/usr/bin/env bash
# =========================================================
# Meridian Platform — One-Script Installer
#
# Builds images from source, configures, and starts all
# services. Run this from the Meridian project root.
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
command -v curl &>/dev/null   || error "curl not installed"

DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0.0.0")
DOCKER_MAJOR=$(echo "$DOCKER_VERSION" | cut -d. -f1)
[ "$DOCKER_MAJOR" -lt 24 ] && error "Docker 24.0+ required (found $DOCKER_VERSION)"
info "Docker $DOCKER_VERSION detected"

# Must run from project root — Dockerfile.api and frontend/ must exist
[ ! -f "Dockerfile.api" ] && error "Run this script from the Meridian project root (Dockerfile.api not found here: $(pwd))"
[ ! -d "frontend" ]       && error "Run this script from the Meridian project root (frontend/ directory not found here: $(pwd))"
info "Running from project root: $(pwd)"

# ── Licence Key ───────────────────────────────────────────
step "Licence Activation"

echo "Enter your Meridian licence key (provided by Vantax):"
read -p "Licence Key: " LICENCE_KEY
LICENCE_KEY=$(echo "$LICENCE_KEY" | tr -d ' ' | tr '[:lower:]' '[:upper:]')

[[ ! "$LICENCE_KEY" =~ ^MRDX-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$ ]] && \
    error "Invalid licence key format. Expected: MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX"

info "Licence key format valid"

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

# Licence — config.py reads LICENCE_MODE, LICENCE_KEY, LICENCE_SERVER_URL (no MERIDIAN_ prefix)
LICENCE_MODE=online
LICENCE_KEY=$LICENCE_KEY
LICENCE_SERVER_URL=$LICENCE_SERVER

# LLM — qwen2.5:3b is pulled at startup (~2 GB, fast to run on CPU)
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=qwen2.5:3b

# Database
DB_PASSWORD=$DB_PASS
DATABASE_URL=postgresql+asyncpg://meridian:$DB_PASS@db:5432/meridian
DATABASE_URL_SYNC=postgresql://meridian:$DB_PASS@db:5432/meridian

# Redis
REDIS_URL=redis://redis:6379/0

# MinIO
# MINIO_PASSWORD  → used by the MinIO container (MINIO_ROOT_PASSWORD)
# MINIO_SECRET_KEY → used by the API to connect to MinIO (config.py: minio_secret_key)
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=meridian
MINIO_PASSWORD=$MINIO_PASS
MINIO_SECRET_KEY=$MINIO_PASS
MINIO_BUCKET_UPLOADS=meridian-uploads
MINIO_BUCKET_REPORTS=meridian-reports

# SAP — mock mode for standalone installs (configure real connector after setup)
SAP_CONNECTOR=mock
CREDENTIAL_MASTER_KEY=$SECRET

# Auth
AUTH_MODE=local
NEXT_PUBLIC_AUTH_MODE=local

# CORS — config.py reads CORS_ORIGINS (no MERIDIAN_ prefix)
CORS_ORIGINS=http://localhost:3000

# Clerk dummy keys — required for frontend build; not used in local auth mode
CLERK_SECRET_KEY=sk_test_bG9jYWwtYXV0aC1tb2RlLWR1bW15c2VjcmV0a2V5
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_bG9jYWwtYXV0aC1tb2RlLWR1bW15a2V5
EOF

info "Configuration saved to .env"

# ── Docker Compose File ───────────────────────────────────
step "Creating Deployment Configuration"

# Write to docker-compose.standalone.yml to avoid overwriting the dev compose file
COMPOSE_FILE="docker-compose.standalone.yml"

cat > "$COMPOSE_FILE" << 'COMPOSE_EOF'
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

  # Standard Ollama image — model is pulled at first startup (see "Downloading AI Model" step)
  ollama:
    image: ollama/ollama:latest
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
      retries: 5

  api:
    build:
      context: .
      dockerfile: Dockerfile.api
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
    build:
      context: .
      dockerfile: Dockerfile.api
    container_name: meridian-worker
    command: ["celery", "-A", "workers.celery_app", "worker", "--loglevel=info", "--concurrency=4"]
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
    build:
      context: .
      dockerfile: Dockerfile.api
    container_name: meridian-beat
    command: ["celery", "-A", "workers.celery_app", "beat", "--loglevel=info"]
    env_file: .env
    depends_on:
      - redis
    networks:
      - meridian-net
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_AUTH_MODE: local
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk_test_bG9jYWwtYXV0aC1tb2RlLWR1bW15a2V5
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

info "$COMPOSE_FILE created"

# ── Build Images ──────────────────────────────────────────
step "Building Images (from source)"

echo "Building API, worker, and frontend images..."
echo "This takes 5–15 minutes on first run."
echo ""

docker compose -f "$COMPOSE_FILE" build --parallel \
    || error "Image build failed. Fix the error above and re-run."

info "All images built successfully"

# ── Start Infrastructure ──────────────────────────────────
step "Starting Services"

# Remove any stale Meridian containers
if docker ps -a --format '{{.Names}}' | grep -q "^meridian-"; then
    warn "Existing Meridian containers found — removing..."
    docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
    docker rm -f $(docker ps -aq -f "name=meridian-" 2>/dev/null) 2>/dev/null || true
    info "Old deployment removed"
fi

echo "Starting database and Redis..."
docker compose -f "$COMPOSE_FILE" up -d db redis

echo "Waiting for database..."
for i in {1..30}; do
    if docker compose -f "$COMPOSE_FILE" exec -T db pg_isready -U meridian &>/dev/null; then
        info "Database ready"
        break
    fi
    [ $i -eq 30 ] && error "Database failed to start. Run: docker compose -f $COMPOSE_FILE logs db"
    sleep 2
done

# ── Migrations ────────────────────────────────────────────
echo "Running database migrations..."
docker compose -f "$COMPOSE_FILE" run --rm -T api alembic upgrade head \
    || error "Migration failed. Run: docker compose -f $COMPOSE_FILE logs"
info "Migrations complete"

# ── Seed Dev Tenant ───────────────────────────────────────
# Local auth (auth.py + deps.py) uses the hardcoded UUID below.
# No migration creates this row, so we insert it here.
echo "Seeding initial tenant..."
docker compose -f "$COMPOSE_FILE" run --rm -T api python -c "
import os, sys
sys.path.insert(0, '/app')
from sqlalchemy import create_engine, text
engine = create_engine(os.environ['DATABASE_URL_SYNC'])
with engine.connect() as conn:
    conn.execute(text('''
        INSERT INTO tenants (id, name, licensed_modules, created_at)
        VALUES (
            '00000000-0000-0000-0000-000000000001',
            'Default',
            ARRAY['business_partner','material_master','fi_gl'],
            now()
        )
        ON CONFLICT (id) DO NOTHING
    '''))
    conn.commit()
print('Tenant ready')
" || warn "Tenant seed skipped (may already exist)"
info "Tenant seeded"

# ── Start All Services ────────────────────────────────────
echo "Starting all services..."
docker compose -f "$COMPOSE_FILE" up -d
info "All services started"

# ── Pull Ollama Model ─────────────────────────────────────
step "Downloading AI Model"

echo "Waiting for Ollama to be ready..."
for i in {1..30}; do
    if docker compose -f "$COMPOSE_FILE" exec -T ollama curl -sf http://localhost:11434/api/version &>/dev/null; then
        info "Ollama ready"
        break
    fi
    [ $i -eq 30 ] && { warn "Ollama not ready — skipping model pull. Pull manually later."; break; }
    sleep 3
done

echo "Pulling qwen2.5:3b (~2 GB)..."
docker compose -f "$COMPOSE_FILE" exec -T ollama ollama pull qwen2.5:3b \
    && info "AI model ready" \
    || warn "Model pull failed. Pull manually: docker compose -f $COMPOSE_FILE exec ollama ollama pull qwen2.5:3b"

# ── Health Checks ─────────────────────────────────────────
step "Verifying Deployment"

echo "Waiting for API..."
for i in {1..60}; do
    if curl -sf http://localhost:8000/health &>/dev/null; then
        info "API online at http://localhost:8000"
        break
    fi
    [ $i -eq 60 ] && warn "API health check timed out. Check: docker compose -f $COMPOSE_FILE logs api"
    sleep 2
done

echo "Waiting for frontend..."
for i in {1..30}; do
    STATUS=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
    if [ "$STATUS" = "200" ] || [ "$STATUS" = "307" ]; then
        info "Frontend online at http://localhost:3000"
        break
    fi
    [ $i -eq 30 ] && warn "Frontend not responding yet — it may still be starting up."
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

# Insert admin via the API container — hashes password with Argon2, respects RLS
docker compose -f "$COMPOSE_FILE" exec -T \
    -e ADMIN_EMAIL="$ADMIN_EMAIL" \
    -e ADMIN_NAME="$ADMIN_NAME" \
    -e ADMIN_PASS="$ADMIN_PASS" \
    api python -c "
import os, uuid, sys
sys.path.insert(0, '/app')
from api.services.local_auth import hash_password
from sqlalchemy import create_engine, text

TENANT_ID = '00000000-0000-0000-0000-000000000001'
engine = create_engine(os.environ['DATABASE_URL_SYNC'])
email = os.environ['ADMIN_EMAIL']
name  = os.environ.get('ADMIN_NAME', email)
pw    = hash_password(os.environ['ADMIN_PASS'])
uid   = str(uuid.uuid4())

with engine.connect() as conn:
    conn.execute(text(f\"SET app.tenant_id = '{TENANT_ID}'\"))
    existing = conn.execute(
        text('SELECT id FROM users WHERE email = :email AND tenant_id = :tid'),
        {'email': email, 'tid': TENANT_ID}
    ).fetchone()
    if existing:
        print(f'User {email} already exists — skipping')
    else:
        conn.execute(text('''
            INSERT INTO users (id, tenant_id, email, name, role, password_hash, is_active, created_at)
            VALUES (:id, :tid, :email, :name, 'admin', :pw, true, now())
        '''), {'id': uid, 'tid': TENANT_ID, 'email': email, 'name': name, 'pw': pw})
        conn.commit()
        print(f'Admin user created: {email}')
" \
    && info "Admin user created: $ADMIN_EMAIL" \
    || warn "Admin creation failed — create the user from the dashboard after login."

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
echo "  View logs:    docker compose -f $COMPOSE_FILE logs -f"
echo "  Stop:         docker compose -f $COMPOSE_FILE stop"
echo "  Restart:      docker compose -f $COMPOSE_FILE restart"
echo "  Rebuild:      docker compose -f $COMPOSE_FILE build && docker compose -f $COMPOSE_FILE up -d"
echo ""
echo "For support: support@vantax.co.za"
echo ""

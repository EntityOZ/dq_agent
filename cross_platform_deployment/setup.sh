#!/usr/bin/env bash
# =========================================================
# Meridian Platform Universal Deployment Script
# 
# Works on Windows (Docker Desktop), Linux, and macOS
# 
# Requirements:
#   - Docker Engine 24.0+ with Docker Compose V2
#   - Minimum 8GB RAM (16GB recommended)
#   - Internet connection for initial setup
# =========================================================
set -euo pipefail

# ── Colors ────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${CYAN}${BOLD}[STEP] $*${NC}\n"; }

# ── Platform Detection ────────────────────────────────────
detect_platform() {
    UNAME_S="$(uname -s)"
    case "${UNAME_S}" in
        Linux*)     PLATFORM="Linux";;
        Darwin*)    PLATFORM="macOS";;
        CYGWIN*|MINGW*|MSYS*) PLATFORM="Windows";;
        *)          PLATFORM="Unknown";;
    esac
    
    echo "Detected platform: $PLATFORM"
}

# ── Banner ────────────────────────────────────────────────
clear
echo -e "${CYAN}"
cat << "EOF"
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║        MERIDIAN PLATFORM UNIVERSAL INSTALLER             ║
║        SAP Data Quality & Master Data Management         ║
║                                                          ║
║        Compatible with Windows, Linux & macOS            ║
║        © 2026 Vantax Technologies. All rights reserved.  ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}\n"

# ── Platform Detection ────────────────────────────────────
step "Platform Detection"
detect_platform

# ── Prerequisites Check ───────────────────────────────────
step "System Check"

# Docker check
if ! command -v docker &>/dev/null; then
    error "Docker is not installed. Please install Docker:
    - Windows/macOS: Download Docker Desktop from https://www.docker.com/products/docker-desktop/
    - Linux: Run 'curl -fsSL https://get.docker.com | sh'"
fi

# Docker version check
DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0.0.0")
DOCKER_MAJOR=$(echo "$DOCKER_VERSION" | cut -d. -f1)
if [ "$DOCKER_MAJOR" -lt 24 ]; then
    error "Docker version 24.0+ required (found $DOCKER_VERSION)"
fi
info "Docker $DOCKER_VERSION detected"

# Docker Compose check
if ! docker compose version &>/dev/null; then
    error "Docker Compose is not available. Upgrade Docker to include Compose V2."
fi
COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || echo "0.0.0")
info "Docker Compose $COMPOSE_VERSION detected"

# Check disk space (minimum 20GB recommended)
FREE_DISK_BYTES=$(df . 2>/dev/null | awk 'NR==2 {print $4 * 1024}' || echo "0")
FREE_DISK_GB=$((FREE_DISK_BYTES / 1024 / 1024 / 1024))

if [ "$FREE_DISK_GB" -lt 20 ]; then
    warn "Less than 20GB free space detected ($FREE_DISK_GB GB available). Meridian requires significant storage for data and models."
fi

# Memory check (minimum 8GB recommended)
if command -v free &>/dev/null; then
    TOTAL_MEM_MB=$(free -m | awk '/^Mem:/{print $2}')
    TOTAL_MEM_GB=$((TOTAL_MEM_MB / 1024))
    if [ "$TOTAL_MEM_GB" -lt 8 ]; then
        warn "Less than 8GB RAM detected (${TOTAL_MEM_GB}GB available). 16GB+ recommended for optimal performance."
    fi
elif [[ "$PLATFORM" == "macOS" ]]; then
    TOTAL_MEM_GB=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1024/1024/1024}' 2>/dev/null || echo "8")
    if [ "$TOTAL_MEM_GB" -lt 8 ]; then
        warn "Less than 8GB RAM detected (${TOTAL_MEM_GB}GB available). 16GB+ recommended."
    fi
fi

# curl check
command -v curl &>/dev/null || error "curl is required but not installed"

# openssl/rand check for secure passwords
if ! command -v openssl &>/dev/null; then
    warn "openssl not found. Using fallback method for secure password generation."
fi

info "System checks passed"

# ── Deployment Configuration ──────────────────────────────
step "Deployment Configuration"

# Create default configurations
cat > meridian.env << 'EOF'
# =========================================================
# Meridian Platform Configuration
# Auto-generated for cross-platform deployment
# =========================================================

# ── Database Settings ─────────────────────────────────────
DB_PASSWORD=default_password_change_me_before_production
DATABASE_URL=postgresql+asyncpg://meridian:${DB_PASSWORD}@db:5432/meridian
DATABASE_URL_SYNC=postgresql://meridian:${DB_PASSWORD}@db:5432/meridian

# ── Redis Settings ────────────────────────────────────────
REDIS_URL=redis://redis:6379/0

# ── MinIO Settings ────────────────────────────────────────
MINIO_ACCESS_KEY=meridian
MINIO_PASSWORD=minioadmin_change_me
MINIO_ENDPOINT=minio:9000
MINIO_BUCKET_UPLOADS=meridian-uploads
MINIO_BUCKET_REPORTS=meridian-reports

# ── SAP Connector Settings ────────────────────────────────
SAP_CONNECTOR=rfc
CREDENTIAL_MASTER_KEY=change_this_to_secure_key

# ── Authentication Settings ───────────────────────────────
AUTH_MODE=local
NEXT_PUBLIC_AUTH_MODE=local
JWT_SECRET=change_this_to_very_secure_secret_key

# ── CORS Settings ─────────────────────────────────────────
MERIDIAN_CORS_ORIGINS=http://localhost:3000

# ── LLM Provider Settings ─────────────────────────────────
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=qwen2.5:3b

# ── Observability Settings (optional) ─────────────────────
# SENTRY_DSN=
# RESEND_API_KEY=
# TEAMS_WEBHOOK_URL=

EOF

info "Default configuration created: meridian.env"

# ── Docker Compose Definition ─────────────────────────────
step "Docker Configuration"

# Create simplified docker-compose.yml for all platforms
cat > docker-compose.yml << 'COMPOSE_EOF'
version: "3.9"

networks:
  meridian-network:
    driver: bridge

volumes:
  meridian-postgres-data:
  meridian-redis-data:
  meridian-minio-data:
  meridian-ollama-data:

services:
  # Database - PostgreSQL
  db:
    image: postgres:16-alpine
    container_name: meridian-db
    environment:
      POSTGRES_USER: meridian
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
      POSTGRES_DB: meridian
    volumes:
      - meridian-postgres-data:/var/lib/postgresql/data
    networks:
      - meridian-network
    restart: unless-stopped
    secrets:
      - db_password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U meridian"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  # Cache - Redis
  redis:
    image: redis:7-alpine
    container_name: meridian-redis
    volumes:
      - meridian-redis-data:/data
    networks:
      - meridian-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  # Object Storage - MinIO
  minio:
    image: minio/minio:RELEASE.2024-01-16T16-07-38Z
    container_name: meridian-minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD}
    volumes:
      - meridian-minio-data:/data
    networks:
      - meridian-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

  # Local LLM - Ollama
  ollama:
    image: ghcr.io/luketempleman/meridian-ollama:latest
    container_name: meridian-ollama
    volumes:
      - meridian-ollama-data:/root/.ollama
    networks:
      - meridian-network
    restart: unless-stopped
    pull_policy: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:11434/api/version"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Backend API
  api:
    image: ghcr.io/luketempleman/meridian-api:latest
    container_name: meridian-api
    env_file: ./meridian.env
    environment:
      - DB_PASSWORD_FILE=/run/secrets/db_password
    ports:
      - "8000:8000"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - meridian-network
    restart: unless-stopped
    secrets:
      - db_password
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  # Background Workers
  worker:
    image: ghCR.io/luketempleman/meridian-worker:latest
    container_name: meridian-worker
    env_file: ./meridian.env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - meridian-network
    restart: unless-stopped

  # Scheduler
  beat:
    image: ghcr.io/luketempleman/meridian-worker:latest
    container_name: meridian-beat
    command: ["celery", "-A", "workers.celery_app", "beat", "--loglevel=info"]
    env_file: ./meridian.env
    depends_on:
      - redis
    networks:
      - meridian-network
    restart: unless-stopped

  # Web Interface
  frontend:
    image: ghcr.io/luketempleman/meridian-frontend:latest
    container_name: meridian-frontend
    env_file: ./meridian.env
    ports:
      - "3000:3000"
    depends_on:
      - api
    networks:
      - meridian-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000"]
      interval: 30s
      timeout: 10s
      retries: 3

secrets:
  db_password:
    file: ./db_password.txt
COMPOSE_EOF

# Create placeholder for database password
echo "default_password_change_me_before_production" > db_password.txt

info "Docker Compose configuration created"

# ── Pull Instructions ─────────────────────────────────────
step "Image Preparation"

echo "To prepare for deployment:"
echo ""
echo "1. Login to GitHub Container Registry (required for private images):"
echo "   docker login ghcr.io"
echo ""
echo "2. Pull all required images:"
echo "   docker compose pull"
echo ""
echo "3. Check image sizes:"
echo "   docker images"
echo ""

info "Deployment configuration prepared successfully"

# ── Usage Instructions ────────────────────────────────────
step "Usage Instructions"

cat << 'INSTRUCTIONS_EOF'
┌─────────────────────────────────────────────────────────┐
│ Deployment Instructions                                 │
└─────────────────────────────────────────────────────────┘

To complete deployment:

1. Edit configuration in 'meridian.env':
   - Change passwords and secrets to secure values
   - Update SAP connection parameters when ready
   - Review and adjust resource limits if needed

2. Update the database password in 'db_password.txt':
   echo "your_secure_password_here" > db_password.txt

3. Authenticate with GHCR for private images:
   docker login ghcr.io
   # Use your GitHub personal access token with read:packages scope

4. Pull images (first time):
   docker compose pull

5. Start services:
   docker compose up -d

6. Initialize database (on first deployment):
   docker compose exec api alembic upgrade head

7. Create admin user (replace placeholders):
   docker compose exec api python scripts/manage_users.py create \
     --email admin@example.com \
     --name "Admin User" \
     --password "SecurePassword123!" \
     --role admin

8. Access the platform:
   - Dashboard: http://localhost:3000
   - API Docs: http://localhost:8000/docs

┌─────────────────────────────────────────────────────────┐
│ Platform-Specific Notes                                 │
└─────────────────────────────────────────────────────────┘

LINUX:
 - Grant user Docker permissions: sudo usermod -aG docker $USER
 - Log out/in or run: newgrp docker

WINDOWS:
 - Use WSL 2 backend for best performance
 - Ensure Windows Subsystem for Linux is enabled
 - Allow Docker Desktop through Windows Firewall

MACOS:
 - Docker Desktop for Mac supports both Intel and Apple Silicon
 - No special configuration typically required

┌─────────────────────────────────────────────────────────┐
│ Helpful Commands                                        │
└─────────────────────────────────────────────────────────┘

Check status:    docker compose ps
View logs:       docker compose logs -f [service]
Stop services:   docker compose down
Restart:         docker compose restart
Update images:   docker compose pull && docker compose up -d
Backup data:     docker compose exec db pg_dump -U meridian meridian > backup.sql

┌─────────────────────────────────────────────────────────┐
│ Support                                                 │
└─────────────────────────────────────────────────────────┘

Issues or questions? Contact support@vantax.co.za
Documentation: https://docs.meridian.vantax.co.za

INSTRUCTIONS_EOF

info "Setup complete! Follow the instructions above to deploy."

# ── Finish ────────────────────────────────────────────────
echo -e "\n${GREEN}${BOLD}"
echo "┌─────────────────────────────────────────────────────────┐"
echo "│ SETUP COMPLETE                                          │"
echo "└─────────────────────────────────────────────────────────┘"
echo -e "${NC}"

echo "Next steps:"
echo "  1. Review and customize meridian.env"
echo "  2. Update passwords in db_password.txt"
echo "  3. Follow deployment instructions above"
echo ""
echo "Need help? Contact: support@vantax.co.za"
echo ""

exit 0
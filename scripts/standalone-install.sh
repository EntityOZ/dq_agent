#!/usr/bin/env bash
# =========================================================
# Meridian Platform — Enterprise Installer
#
# Usage:
#   sudo bash standalone-install.sh
#
# Traffic architecture after install:
#   Browser → Nginx (443) → Next.js :3000 → FastAPI :8000
#
# The browser NEVER talks to port 8000 directly.
# Next.js proxies /api/* to FastAPI on the Docker network.
# No CORS issues. No IP hardcoding. Works on any domain or IP.
#
# Requirements: Ubuntu 20.04+ or Debian 11+, internet access
# =========================================================
set -euo pipefail

# ── Constants ─────────────────────────────────────────────
MERIDIAN_DIR="/opt/meridian"
NGINX_CONF="/etc/nginx/sites-available/meridian"
SYSTEMD_UNIT="/etc/systemd/system/meridian.service"
LICENCE_SERVER="https://meridian-licence-worker.reshigan-085.workers.dev/api/licence"
GHCR_PREFIX="ghcr.io/luketempleman/meridian"
OLLAMA_MODEL="qwen2.5:3b"

# ── Colors ────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${CYAN}${BOLD}━━━ $* ━━━${NC}\n"; }

# ── Must run as root ──────────────────────────────────────
[ "$EUID" -ne 0 ] && error "Please run as root:  sudo bash $0"

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
echo -e "${NC}"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 1 — System prerequisites
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
step "1/10  System Check"

OS_ID=$(grep -oP '(?<=^ID=).+' /etc/os-release 2>/dev/null | tr -d '"' || echo "unknown")
OS_VER=$(grep -oP '(?<=^VERSION_ID=).+' /etc/os-release 2>/dev/null | tr -d '"' || echo "0")
info "OS: $OS_ID $OS_VER"

[[ "$OS_ID" != "ubuntu" && "$OS_ID" != "debian" ]] && \
    warn "Tested on Ubuntu/Debian. Proceeding anyway."

# Ensure base utilities
apt-get install -y -q curl openssl 2>/dev/null || true

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 2 — Docker
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
step "2/10  Docker"

if command -v docker &>/dev/null; then
    DOCKER_VER=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "installed")
    info "Docker $DOCKER_VER already installed"
else
    warn "Docker not found — installing via get.docker.com..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    info "Docker installed and started"
fi

if ! docker compose version &>/dev/null; then
    apt-get install -y -q docker-compose-plugin
fi
info "Docker Compose ready"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 3 — Nginx
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
step "3/10  Nginx"

if ! command -v nginx &>/dev/null; then
    apt-get update -q
    apt-get install -y -q nginx
    systemctl enable nginx
    info "Nginx installed"
else
    info "Nginx already installed"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 4 — Questions (all upfront, then no more interaction)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
step "4/10  Configuration"

# Handle reinstall
if [ -f "$MERIDIAN_DIR/.env" ]; then
    warn "Existing installation found at $MERIDIAN_DIR"
    if [ -t 0 ]; then
        read -p "Reinstall and regenerate all secrets? [y/N]: " REINSTALL
        [[ ! "$REINSTALL" =~ ^[Yy] ]] && {
            echo ""
            info "To update images only, run:"
            echo "  cd $MERIDIAN_DIR && docker compose pull && docker compose up -d"
            exit 0
        }
    fi
fi

mkdir -p "$MERIDIAN_DIR"

echo ""
echo "  Enter the address where Meridian will be reached."
echo "  • Domain:  meridian.yourcompany.com  (SSL via Let's Encrypt)"
echo "  • IP:      16.28.29.123              (self-signed SSL)"
echo ""

if [ -t 0 ]; then
    read -p "  Domain or IP: " SERVER_ADDRESS
else
    SERVER_ADDRESS="${SERVER_ADDRESS:-localhost}"
fi
SERVER_ADDRESS=$(echo "$SERVER_ADDRESS" | tr -d '[:space:]')
[ -z "$SERVER_ADDRESS" ] && error "Server address is required."

# Domain vs IP
if [[ "$SERVER_ADDRESS" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    IS_DOMAIN=false
else
    IS_DOMAIN=true
fi

echo ""
if [ -t 0 ]; then
    read -p "  Licence Key (MRDX-...): " LICENCE_KEY
else
    LICENCE_KEY="${LICENCE_KEY:-}"
fi
LICENCE_KEY=$(echo "$LICENCE_KEY" | tr -d ' ' | tr '[:lower:]' '[:upper:]')
[[ ! "$LICENCE_KEY" =~ ^MRDX-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$ ]] && \
    error "Invalid licence key format. Expected: MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX"

echo ""
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_NAME="${ADMIN_NAME:-}"
ADMIN_PASS="${ADMIN_PASSWORD:-}"

if [ -z "$ADMIN_EMAIL" ] && [ -t 0 ]; then
    read -p "  Admin Email: " ADMIN_EMAIL
    while [ -z "$ADMIN_EMAIL" ]; do
        echo -e "  ${RED}Email required${NC}"
        read -p "  Admin Email: " ADMIN_EMAIL
    done
    read -p "  Admin Name [$ADMIN_EMAIL]: " ADMIN_NAME
    ADMIN_NAME="${ADMIN_NAME:-$ADMIN_EMAIL}"
    while true; do
        read -sp "  Admin Password (min 8 chars): " ADMIN_PASS
        echo ""
        [ ${#ADMIN_PASS} -ge 8 ] && break
        echo -e "  ${RED}Password must be at least 8 characters${NC}"
    done
elif [ -z "$ADMIN_EMAIL" ]; then
    warn "ADMIN_EMAIL not set — skipping admin creation."
    ADMIN_EMAIL="SKIP"
fi

echo ""
info "Address:  $SERVER_ADDRESS"
info "Licence:  ${LICENCE_KEY:0:9}****"
[ "$ADMIN_EMAIL" != "SKIP" ] && info "Admin:    $ADMIN_EMAIL"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 5 — Validate licence
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
step "5/10  Licence Validation"

echo "Contacting licence server..."
VALIDATION=$(curl -s --max-time 15 -X POST "${LICENCE_SERVER}/validate" \
    -H "Content-Type: application/json" \
    -d "{\"licenceKey\":\"${LICENCE_KEY}\",\"machineFingerprint\":\"$(hostname)\"}" \
    -w "\n%{http_code}" 2>/dev/null || echo -e "\n000")

HTTP_CODE=$(echo "$VALIDATION" | tail -n1)
BODY=$(echo "$VALIDATION" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
    REASON=$(echo "$BODY" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4 || echo "server unreachable")
    error "Licence validation failed (HTTP $HTTP_CODE): $REASON"
fi

COMPANY=$(echo "$BODY" | grep -o '"company_name":"[^"]*"' | cut -d'"' -f4 || echo "Unknown")
TIER=$(echo "$BODY" | grep -o '"tier":"[^"]*"' | cut -d'"' -f4 || echo "starter")
EXPIRY=$(echo "$BODY" | grep -o '"expiry_date":"[^"]*"' | cut -d'"' -f4 || echo "Unknown")

info "Licence valid"
echo "  Company:  $COMPANY"
echo "  Tier:     $TIER"
echo "  Expires:  $EXPIRY"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 6 — Generate config
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
step "6/10  Generating Configuration"

DB_PASS=$(openssl rand -hex 16)
MINIO_PASS=$(openssl rand -hex 16)
SECRET=$(openssl rand -hex 32)

cat > "$MERIDIAN_DIR/.env" << EOF
# Meridian Platform Configuration
# Generated: $(date)
# Company:  ${COMPANY}
# Licence:  ${LICENCE_KEY:0:9}****-****

# ── Licence ───────────────────────────────────────────────
LICENCE_MODE=online
LICENCE_KEY=${LICENCE_KEY}
LICENCE_SERVER_URL=${LICENCE_SERVER}

# ── LLM ───────────────────────────────────────────────────
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=${OLLAMA_MODEL}

# ── Database ──────────────────────────────────────────────
DB_PASSWORD=${DB_PASS}
DATABASE_URL=postgresql+asyncpg://meridian:${DB_PASS}@db:5432/meridian
DATABASE_URL_SYNC=postgresql://meridian:${DB_PASS}@db:5432/meridian

# ── Redis ─────────────────────────────────────────────────
REDIS_URL=redis://redis:6379/0

# ── MinIO ─────────────────────────────────────────────────
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=meridian
MINIO_PASSWORD=${MINIO_PASS}
MINIO_SECRET_KEY=${MINIO_PASS}
MINIO_BUCKET_UPLOADS=meridian-uploads
MINIO_BUCKET_REPORTS=meridian-reports

# ── SAP ───────────────────────────────────────────────────
SAP_CONNECTOR=mock
CREDENTIAL_MASTER_KEY=${SECRET}

# ── Auth ──────────────────────────────────────────────────
AUTH_MODE=local

# ── CORS ──────────────────────────────────────────────────
# Browser never hits the API directly — Next.js proxies /api/* internally.
# Only Next.js container and localhost health checks reach port 8000.
CORS_ORIGINS=http://localhost:3000,http://frontend:3000
EOF

chmod 600 "$MERIDIAN_DIR/.env"
info "Configuration written to $MERIDIAN_DIR/.env"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 7 — Write docker-compose.yml
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
step "7/10  Docker Compose"

cat > "$MERIDIAN_DIR/docker-compose.yml" << 'COMPOSE_EOF'
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
    image: ollama/ollama:latest
    container_name: meridian-ollama
    volumes:
      - ollama_data:/root/.ollama
    networks:
      - meridian-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "ollama", "list"]
      interval: 30s
      timeout: 10s
      retries: 5

  # Pulls the AI model once. No-op on subsequent starts if model exists in volume.
  ollama-init:
    image: ollama/ollama:latest
    container_name: meridian-ollama-init
    volumes:
      - ollama_data:/root/.ollama
    networks:
      - meridian-net
    environment:
      - OLLAMA_HOST=http://ollama:11434
    depends_on:
      ollama:
        condition: service_healthy
    entrypoint: ["ollama", "pull", "qwen2.5:3b"]
    restart: "no"

  api:
    image: ghcr.io/luketempleman/meridian-api:latest
    platform: linux/amd64
    container_name: meridian-api
    env_file: .env
    ports:
      - "127.0.0.1:8000:8000"
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
    platform: linux/amd64
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
    image: ghcr.io/luketempleman/meridian-worker:latest
    platform: linux/amd64
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
    platform: linux/amd64
    container_name: meridian-frontend
    env_file: .env
    environment:
      # Server-side only. Next.js rewrites /api/* to this URL on the Docker network.
      # The browser never sees this — it just calls relative /api/* URLs.
      - INTERNAL_API_URL=http://api:8000
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      api:
        condition: service_healthy
    networks:
      - meridian-net
    restart: unless-stopped
COMPOSE_EOF

info "docker-compose.yml written"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 8 — Nginx + SSL
#
# Nginx proxies ALL traffic to Next.js on port 3000.
# Next.js handles /api/* internally (server-side rewrite to FastAPI).
# No split proxy needed — simpler and more correct.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
step "8/10  Nginx & SSL"

# SSL: Let's Encrypt for domains, self-signed for IPs
if [ "$IS_DOMAIN" = true ]; then
    # Install certbot
    if ! command -v certbot &>/dev/null; then
        apt-get install -y -q certbot python3-certbot-nginx 2>/dev/null || \
        { snap install --classic certbot 2>/dev/null && ln -sf /snap/bin/certbot /usr/bin/certbot 2>/dev/null; } || true
    fi

    # Write HTTP-only config first so certbot can validate
    cat > "$NGINX_CONF" << NGINX_HTTP_EOF
server {
    listen 80;
    server_name ${SERVER_ADDRESS};
    client_max_body_size 200M;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX_HTTP_EOF

    ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/meridian
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx

    if command -v certbot &>/dev/null; then
        certbot --nginx \
            -d "$SERVER_ADDRESS" \
            --non-interactive \
            --agree-tos \
            --email "support@vantax.co.za" \
            --redirect \
            && info "SSL certificate issued for $SERVER_ADDRESS" \
            || warn "Certbot failed — running on HTTP. Add SSL later: sudo certbot --nginx -d $SERVER_ADDRESS"
        PROTOCOL="https"
    else
        warn "Certbot not available — running on HTTP"
        PROTOCOL="http"
    fi

else
    # IP address — self-signed certificate
    mkdir -p /etc/nginx/ssl/meridian
    openssl req -x509 -nodes -days 3650 \
        -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/meridian/privkey.pem \
        -out    /etc/nginx/ssl/meridian/fullchain.pem \
        -subj   "/C=ZA/O=Meridian/CN=${SERVER_ADDRESS}" \
        2>/dev/null
    info "Self-signed SSL certificate generated (10-year validity)"

    cat > "$NGINX_CONF" << NGINX_SSL_EOF
# HTTP → HTTPS redirect
server {
    listen 80;
    server_name ${SERVER_ADDRESS};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${SERVER_ADDRESS};

    ssl_certificate     /etc/nginx/ssl/meridian/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/meridian/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;

    add_header X-Frame-Options    "SAMEORIGIN"  always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy    "no-referrer-when-downgrade" always;

    # Allow large SAP file uploads
    client_max_body_size 200M;

    # All traffic → Next.js.
    # Next.js server rewrites /api/* → FastAPI internally (Docker DNS).
    # The browser never talks to port 8000.
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
NGINX_SSL_EOF

    ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/meridian
    rm -f /etc/nginx/sites-enabled/default
    nginx -t || error "Nginx config test failed. Check $NGINX_CONF"
    systemctl reload nginx
    info "Nginx configured with self-signed SSL"
    PROTOCOL="https"
fi

FINAL_URL="${PROTOCOL}://${SERVER_ADDRESS}"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 9 — Systemd service
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
step "9/10  System Service"

cat > "$SYSTEMD_UNIT" << SYSTEMD_EOF
[Unit]
Description=Meridian Platform (SAP Data Quality & MDM)
Documentation=https://meridian.vantax.co.za/docs
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${MERIDIAN_DIR}
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose stop
TimeoutStartSec=300
TimeoutStopSec=60
Restart=no

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

systemctl daemon-reload
systemctl enable meridian
info "Systemd service installed — Meridian will start automatically on reboot"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STEP 10 — Start everything
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
step "10/10  Starting Meridian"

cd "$MERIDIAN_DIR"

# Tear down any stale deployment
docker compose down --remove-orphans 2>/dev/null || true

# Pull all images from GHCR
echo "Pulling images (this may take a few minutes)..."
docker compose pull || error "Failed to pull images. Check GHCR package visibility and internet access."
info "Images downloaded"

# Start infrastructure
echo "Starting database and Redis..."
docker compose up -d db redis

echo "Waiting for database..."
for i in {1..30}; do
    docker compose exec -T db pg_isready -U meridian &>/dev/null && { info "Database ready"; break; }
    [ $i -eq 30 ] && error "Database failed to start. Check: docker compose logs db"
    sleep 2
done

# Run migrations
echo "Running database migrations..."
docker compose run --rm -T api alembic upgrade head \
    || error "Migrations failed. Check: docker compose logs"
info "Migrations complete"

# Start all services
echo "Starting all services..."
docker compose up -d
info "All services started"

# Wait for API
echo "Waiting for API to be ready..."
for i in {1..60}; do
    curl -sf http://localhost:8000/health &>/dev/null && { info "API is healthy"; break; }
    [ $i -eq 60 ] && warn "API health check timed out. Check: docker compose logs api"
    sleep 3
done

# Give the startup event (tenant seeding, jwt_secret generation) a moment
sleep 5

# ── Create admin user ──────────────────────────────────────
if [ "$ADMIN_EMAIL" != "SKIP" ] && [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASS:-}" ]; then
    echo "Creating admin user..."
    ADMIN_RESULT=$(docker compose exec -T api \
        python scripts/manage_users.py create \
        --email "$ADMIN_EMAIL" \
        --name "${ADMIN_NAME:-$ADMIN_EMAIL}" \
        --password "$ADMIN_PASS" \
        --role admin 2>&1 </dev/null) || true

    if echo "$ADMIN_RESULT" | grep -qi "created\|already exists"; then
        info "Admin user ready: $ADMIN_EMAIL"
    else
        warn "Admin creation: $ADMIN_RESULT"
        warn "Create manually: docker compose -f $MERIDIAN_DIR/docker-compose.yml exec api python scripts/manage_users.py create --email $ADMIN_EMAIL --password <pass> --role admin"
    fi
fi

# ── AI model (background, wait for it) ────────────────────
echo ""
echo "Waiting for AI model (${OLLAMA_MODEL}) to download..."
echo "This may take several minutes on first install (~2 GB)."
echo ""

for i in {1..120}; do
    STATE=$(docker inspect --format '{{.State.Status}}' meridian-ollama-init 2>/dev/null || echo "missing")
    EXIT_CODE=$(docker inspect --format '{{.State.ExitCode}}' meridian-ollama-init 2>/dev/null || echo "-1")

    if [ "$STATE" = "exited" ] && [ "$EXIT_CODE" = "0" ]; then
        info "AI model ${OLLAMA_MODEL} ready"
        break
    elif [ "$STATE" = "exited" ] && [ "$EXIT_CODE" != "0" ]; then
        warn "Model pull failed. Check: docker compose logs ollama-init"
        warn "Retry later: docker compose -f $MERIDIAN_DIR/docker-compose.yml exec ollama ollama pull ${OLLAMA_MODEL}"
        break
    fi

    # Progress every 30 seconds
    (( i % 6 == 0 )) && echo "  Downloading... (~$((i * 5))s elapsed)"
    sleep 5
done

# ── Final health check ─────────────────────────────────────
echo ""
API_OK=false
FRONTEND_OK=false

curl -sf http://localhost:8000/health &>/dev/null && API_OK=true
STATUS_CODE=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
[[ "$STATUS_CODE" =~ ^(200|307|308)$ ]] && FRONTEND_OK=true

[ "$API_OK" = true ]      && info "API:      healthy" || warn "API:      not responding — check: docker compose logs api"
[ "$FRONTEND_OK" = true ] && info "Frontend: healthy" || warn "Frontend: not responding — check: docker compose logs frontend"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Done
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BOLD}✓ Meridian is running!${NC}"
echo ""
echo "  Dashboard:  ${CYAN}${FINAL_URL}${NC}"
[ "$ADMIN_EMAIL" != "SKIP" ] && echo "  Login:      $ADMIN_EMAIL"
echo ""
echo "  Company:    $COMPANY"
echo "  Tier:       $TIER"
echo "  Expires:    $EXPIRY"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Manage Meridian:"
echo "  Status:   sudo systemctl status meridian"
echo "  Logs:     docker compose -f $MERIDIAN_DIR/docker-compose.yml logs -f"
echo "  Restart:  sudo systemctl restart meridian"
echo "  Update:   cd $MERIDIAN_DIR && docker compose pull && docker compose up -d"
echo ""
echo "  Config:   $MERIDIAN_DIR/.env"
echo "  Nginx:    $NGINX_CONF"
echo ""
echo "Support:    support@vantax.co.za"
echo ""

#!/usr/bin/env bash
# =========================================================
# Meridian Platform Update Script
# 
# Updates to the latest versions of all services
# =========================================================

set -euo pipefail

echo "🔄 Updating Meridian Platform..."

# Check if Docker Compose is available
if ! command -v docker compose &>/dev/null; then
    echo "❌ Docker Compose not found. Please install Docker with Compose V2 support."
    exit 1
fi

echo "🔗 Checking Docker registry authentication..."
if ! docker login ghcr.io &>/dev/null; then
    echo "⚠️  Not logged into GHCR. You may need to authenticate to pull private images."
    echo "💡 Run: docker login ghcr.io"
fi

echo ""
echo "⬇️  Pulling latest images..."
docker compose pull

echo ""
echo "🛑 Stopping current services..."
docker compose down

echo ""
echo "🚀 Starting updated services..."
docker compose up -d

echo ""
echo "⚙️  Running database migrations (if any)..."
docker compose exec api alembic upgrade head || echo "⚠️  Migration skipped or failed - this might be normal"

echo ""
echo "🧪 Checking service status..."
sleep 5
docker compose ps

echo ""
echo "✅ Update process completed!"
echo "🔍 Run './scripts/healthcheck.sh' to verify services are healthy"
echo "📝 Check logs with: docker compose logs -f"
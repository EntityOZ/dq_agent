#!/usr/bin/env bash
# =========================================================
# Meridian Platform Health Check Script
# 
# Runs basic health checks on all services
# =========================================================

set -euo pipefail

echo "🧪 Running Meridian Platform Health Checks..."

# Check if compose project is running
if ! docker compose ps --format json >/dev/null 2>&1; then
    echo "❌ Docker Compose not available or project not initialized"
    exit 1
fi

# Check container status
echo "🔍 Checking container statuses..."
SERVICES_RUNNING=$(docker compose ps --filter status=running --format json | wc -l | tr -d ' ')
SERVICES_TOTAL=$(docker compose ps --format json | wc -l | tr -d ' ')

if [ "$SERVICES_RUNNING" -eq "$SERVICES_TOTAL" ] && [ "$SERVICES_TOTAL" -gt 0 ]; then
    echo "✅ All $SERVICES_TOTAL services running"
else
    echo "⚠️  $SERVICES_RUNNING/$SERVICES_TOTAL services running"
    echo "📝 Details:"
    docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
fi

# Check API health
echo ""
echo "🔍 Checking API health..."
if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    echo "✅ API healthy"
    
    # Get API version/info if available
    API_INFO=$(curl -sf http://localhost:8000/health 2>/dev/null | head -c 200)
    echo "ℹ️  API Status: $API_INFO"
else
    echo "❌ API not responding at http://localhost:8000/health"
fi

# Check Frontend
echo ""
echo "🔍 Checking Frontend health..."
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000")
if [ "$FRONTEND_STATUS" = "200" ] || [ "$FRONTEND_STATUS" = "307" ]; then
    echo "✅ Frontend accessible (HTTP $FRONTEND_STATUS)"
else
    echo "⚠️  Frontend response: HTTP $FRONTEND_STATUS"
fi

# Check Database
echo ""
echo "🔍 Checking Database health..."
if docker compose exec -T db pg_isready -U meridian >/dev/null 2>&1; then
    echo "✅ Database ready"
    
    # Show DB stats
    DB_SIZE=$(docker compose exec -T db psql -U meridian -c "SELECT pg_size_pretty(pg_database_size('meridian'));" -t 2>/dev/null | tr -d ' ')
    echo "📊 Database size: $DB_SIZE"
else
    echo "❌ Database connection failed"
fi

# Check Redis
echo ""
echo "🔍 Checking Redis health..."
if docker compose exec -T redis redis-cli ping >/dev/null 2>&1; then
    echo "✅ Redis responsive"
else
    echo "❌ Redis not responding"
fi

# Summary
echo ""
echo "📋 Health Check Summary Completed"
echo "🎯 To view service logs: docker compose logs -f"
echo "🔁 To restart services: docker compose restart"
#!/usr/bin/env bash
# =========================================================
# Meridian Platform Backup Script
# 
# Creates backups of database and configuration files
# =========================================================

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="meridian_backup_${TIMESTAMP}"

echo "💾 Creating Meridian Platform Backup..."

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Database backup
echo "🗄️  Backing up database..."
if docker compose exec -T db pg_dump -U meridian meridian > "${BACKUP_DIR}/${BACKUP_NAME}_database.sql"; then
    DB_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_NAME}_database.sql" | cut -f1)
    echo "✅ Database backup created (${DB_SIZE})"
else
    echo "❌ Database backup failed"
fi

# Configuration backup
echo "⚙️  Backing up configuration..."
cp meridian.env "${BACKUP_DIR}/${BACKUP_NAME}_config.env" 2>/dev/null || echo "⚠️  meridian.env not found"
cp db_password.txt "${BACKUP_DIR}/${BACKUP_NAME}_db_password.txt" 2>/dev/null || echo "⚠️  db_password.txt not found"

echo "📄 Configuration backed up"

# Docker volumes info (for reference)
echo "📦 Docker volume information:"
docker volume ls | grep meridian > "${BACKUP_DIR}/${BACKUP_NAME}_volumes.txt" 2>/dev/null || echo "⚠️  No Meridian volumes found"

echo "📊 Volume list saved"

echo ""
echo "✅ Backup completed!"
echo "📁 Backup location: ${BACKUP_DIR}/${BACKUP_NAME}*"
echo ""
echo "💡 To restore database later:"
echo "   cat ${BACKUP_DIR}/${BACKUP_NAME}_database.sql | docker compose exec -T db psql -U meridian meridian"
echo ""
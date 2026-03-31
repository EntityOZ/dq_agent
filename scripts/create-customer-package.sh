#!/usr/bin/env bash
# =========================================================
# Create Customer Deployment Package
#
# Generates a ready-to-ship tarball containing:
#   - docker-compose.yml (using pre-built images)
#   - customer-install.sh (interactive installer)
#   - README.md (deployment guide)
#   - .env.example (configuration template)
#
# Output: meridian-deployment-<version>.tar.gz
#
# Usage:
#   ./scripts/create-customer-package.sh [version]
#   ./scripts/create-customer-package.sh v1.2.0
# =========================================================
set -euo pipefail

VERSION="${1:-latest}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PKG_DIR="${ROOT_DIR}/build/customer-package"
OUTPUT_FILE="${ROOT_DIR}/meridian-deployment-${VERSION}.tar.gz"

echo "================================================"
echo "Creating Meridian Deployment Package"
echo "Version: ${VERSION}"
echo "================================================"
echo ""

# Clean and create package directory
rm -rf "${PKG_DIR}"
mkdir -p "${PKG_DIR}/scripts"

# Copy docker-compose files
echo "→ Adding docker-compose.yml..."
cp "${ROOT_DIR}/docker/docker-compose.customer.yml" "${PKG_DIR}/docker-compose.yml"
sed -i.bak "s|{{VERSION}}|${VERSION}|g" "${PKG_DIR}/docker-compose.yml"
sed -i.bak "s|{{CUSTOMER_NAME}}|[To be configured]|g" "${PKG_DIR}/docker-compose.yml"
sed -i.bak "s|{{TIER}}|[To be configured]|g" "${PKG_DIR}/docker-compose.yml"
rm "${PKG_DIR}/docker-compose.yml.bak"

echo "→ Adding docker-compose.ollama.yml..."
cp "${ROOT_DIR}/docker/docker-compose.customer.ollama.yml" "${PKG_DIR}/docker-compose.ollama.yml"

# Copy installer script
echo "→ Adding installation script..."
cp "${ROOT_DIR}/scripts/customer-install.sh" "${PKG_DIR}/scripts/customer-install.sh"
chmod +x "${PKG_DIR}/scripts/customer-install.sh"

# Copy documentation as README
echo "→ Adding README..."
cp "${ROOT_DIR}/docs/customer-deployment.md" "${PKG_DIR}/README.md"

# Copy .env.example
echo "→ Adding .env.example..."
cp "${ROOT_DIR}/.env.example" "${PKG_DIR}/.env.example"

# Create a quick start file
cat > "${PKG_DIR}/QUICKSTART.txt" << 'EOF'
╔══════════════════════════════════════════════╗
║  MERIDIAN PLATFORM — QUICK START             ║
╚══════════════════════════════════════════════╝

1. Prerequisites:
   • Docker Engine 24.0+
   • 8GB RAM minimum (16GB+ recommended)
   • 20GB free disk space

2. Run the installer:
   ./scripts/customer-install.sh

3. Follow the prompts:
   • Enter your licence key (provided by Vantax)
   • Enter Docker Hub credentials
   • Wait for installation to complete

4. Access Meridian:
   • Dashboard: http://localhost:3000
   • API Docs:  http://localhost:8000/docs

5. Need help?
   • Read: README.md
   • Email: support@vantax.co.za
   • Docs: https://docs.meridian.vantax.co.za

EOF

# Create checksum
echo "→ Generating checksums..."
(cd "${PKG_DIR}" && find . -type f -exec sha256sum {} \; > checksums.txt)

# Create tarball
echo "→ Creating tarball..."
(cd "${ROOT_DIR}/build" && tar czf "${OUTPUT_FILE}" customer-package/)

# Get file size
SIZE=$(du -h "${OUTPUT_FILE}" | cut -f1)

echo ""
echo "✓ Package created successfully!"
echo ""
echo "  File: $(basename ${OUTPUT_FILE})"
echo "  Size: ${SIZE}"
echo "  Path: ${OUTPUT_FILE}"
echo ""
echo "To distribute to customer:"
echo "  scp ${OUTPUT_FILE} customer@server:/tmp/"
echo ""
echo "Customer installation:"
echo "  tar -xzf meridian-deployment-${VERSION}.tar.gz"
echo "  cd customer-package"
echo "  ./scripts/customer-install.sh"
echo ""

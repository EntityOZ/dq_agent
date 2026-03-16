#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-1.0.0}"
RELEASE_DIR="release/vantax-v${VERSION}"

echo "Packaging Vantax v${VERSION} release..."

# Clean previous release
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# Copy production compose file
cp docker-compose.yml "$RELEASE_DIR/"

# Copy env template
cp .env.example "$RELEASE_DIR/"

# Copy scripts
mkdir -p "$RELEASE_DIR/scripts"
cp scripts/install.sh "$RELEASE_DIR/scripts/"
cp scripts/update.sh "$RELEASE_DIR/scripts/"
cp scripts/healthcheck.sh "$RELEASE_DIR/scripts/"
cp scripts/backup.sh "$RELEASE_DIR/scripts/"
chmod +x "$RELEASE_DIR/scripts/"*.sh

# Copy documentation
mkdir -p "$RELEASE_DIR/docs"
cp docs/*.md "$RELEASE_DIR/docs/"

# Copy Helm chart
if [ -d "helm/vantax" ]; then
    cp -r helm "$RELEASE_DIR/"
fi

# Create tarball
cd release
tar -czf "vantax-v${VERSION}.tar.gz" "vantax-v${VERSION}/"
cd ..

echo ""
echo "Release package created:"
echo "  Directory: ${RELEASE_DIR}/"
echo "  Archive:   release/vantax-v${VERSION}.tar.gz"
echo ""
echo "Contents:"
tar -tzf "release/vantax-v${VERSION}.tar.gz" | sort

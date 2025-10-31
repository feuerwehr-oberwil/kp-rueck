#!/bin/bash
set -e

# Download and setup offline map tiles for Basel-Landschaft region
# Usage: ./scripts/download-tiles.sh

TILES_FILE="basel-landschaft.mbtiles"
CONTAINER_NAME="kprueck-tileserver-dev"
# Using Geofabrik free OSM data - updated daily
DOWNLOAD_URL="https://download.geofabrik.de/europe/switzerland-latest.osm.pbf"
OSM_FILE="switzerland-latest.osm.pbf"

echo "═══════════════════════════════════════════════"
echo " KP Rück - Offline Map Tiles Setup"
echo "═══════════════════════════════════════════════"
echo ""
echo "This script will download FREE OpenStreetMap data from Geofabrik"
echo "and generate offline map tiles for the Basel-Landschaft region."
echo ""
echo "Source: Geofabrik (https://geofabrik.de) - 100% Free & Legal"
echo "Expected download size: ~500 MB OSM data"
echo "This may take 5-15 minutes depending on your connection."
echo ""

# Check prerequisites
echo "[1/6] Checking prerequisites..."
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker not found. Please install Docker first."
    exit 1
fi
echo "✓ Docker found"

# Check for tilemaker
if ! command -v tilemaker &> /dev/null; then
    echo "⚠️  Warning: tilemaker not found."
    echo ""
    echo "Tilemaker is needed to convert OSM data to MBTiles."
    echo "Install it with:"
    echo "  macOS:  brew install tilemaker"
    echo "  Linux:  sudo apt-get install tilemaker"
    echo ""
    echo "Alternatively, you can manually download pre-generated MBTiles from:"
    echo "  https://download.geofabrik.de/europe/switzerland.html"
    echo ""
    exit 1
fi
echo "✓ tilemaker found"

# Check if tile server container exists
if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "⚠️  Warning: Tile server container not found."
    echo "   Please run 'make dev' first to start all services."
    exit 1
fi
echo "✓ Tile server container found"
echo ""

# Download OSM data
echo "[2/6] Downloading OSM data from Geofabrik..."
echo "Source: $DOWNLOAD_URL"
echo ""

# Create temp directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

# Check if we should use wget or curl
if command -v wget &> /dev/null; then
    echo "Downloading with wget..."
    wget -O "$OSM_FILE" "$DOWNLOAD_URL" || {
        echo ""
        echo "❌ Download failed!"
        echo ""
        echo "Please check your internet connection or try again later."
        echo "Geofabrik is a reliable free source for OSM data."
        echo ""
        rm -rf "$TEMP_DIR"
        exit 1
    }
elif command -v curl &> /dev/null; then
    echo "Downloading with curl..."
    curl -L -o "$OSM_FILE" "$DOWNLOAD_URL" || {
        echo ""
        echo "❌ Download failed!"
        echo ""
        echo "Please check your internet connection or try again later."
        echo "Geofabrik is a reliable free source for OSM data."
        echo ""
        rm -rf "$TEMP_DIR"
        exit 1
    }
else
    echo "❌ Error: Neither wget nor curl found. Please install one of them."
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo "✓ OSM data downloaded successfully"
echo ""

# Generate MBTiles from OSM data
echo "[3/6] Generating MBTiles for Basel-Landschaft region..."
echo "This may take 5-10 minutes depending on your system..."
echo ""

tilemaker --input "$OSM_FILE" \
          --output "$TILES_FILE" \
          --bbox 7.4,47.4,7.9,47.7 \
          --process /usr/local/share/tilemaker/resources/process-openmaptiles.lua \
          --config /usr/local/share/tilemaker/resources/config-openmaptiles.json || {
    echo ""
    echo "❌ Error: MBTiles generation failed!"
    echo ""
    echo "This could be due to:"
    echo "1. Insufficient disk space"
    echo "2. Corrupted download"
    echo "3. Missing tilemaker resources"
    echo ""
    echo "Try downloading pre-generated MBTiles manually:"
    echo "See OFFLINE_MAPS.md for alternative methods"
    echo ""
    rm -rf "$TEMP_DIR"
    exit 1
}

echo "✓ MBTiles generated successfully"
echo ""

# Verify file exists and has reasonable size
FILE_SIZE=$(stat -f%z "$TILES_FILE" 2>/dev/null || stat -c%s "$TILES_FILE" 2>/dev/null)
if [ "$FILE_SIZE" -lt 1000000 ]; then
    echo "❌ Error: Generated file seems too small (${FILE_SIZE} bytes)"
    echo "   Expected at least 1 MB. The generation may have failed."
    rm -rf "$TEMP_DIR"
    exit 1
fi
echo "✓ File size verified: $(numfmt --to=iec-i --suffix=B $FILE_SIZE 2>/dev/null || echo "${FILE_SIZE} bytes")"
echo ""

# Copy to Docker volume
echo "[4/6] Installing tiles to Docker volume..."
docker cp "$TILES_FILE" "${CONTAINER_NAME}:/data/${TILES_FILE}" || {
    echo "❌ Error: Failed to copy tiles to Docker container"
    rm -rf "$TEMP_DIR"
    exit 1
}
echo "✓ Tiles installed successfully"
echo ""

# Clean up temp directory
rm -rf "$TEMP_DIR"
echo "✓ Temporary files cleaned up"
echo ""

# Restart tile server
echo "[5/6] Restarting tile server..."
docker restart "$CONTAINER_NAME" > /dev/null
echo "✓ Tile server restarted"
echo ""

# Wait for tile server to be ready
echo "[6/6] Waiting for tile server to be ready..."
MAX_ATTEMPTS=30
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo "✓ Tile server is ready"
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
        echo "⚠️  Warning: Tile server didn't respond within 30 seconds"
        echo "   It may still be starting up. Check with: make tiles-status"
        break
    fi
    sleep 1
done
echo ""

# Success message
echo "═══════════════════════════════════════════════"
echo "✅ Offline map tiles installed successfully!"
echo "═══════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "1. Open http://localhost:8080 to view tile server"
echo "2. Go to Settings → Map Mode and select 'Offline'"
echo "3. Navigate to Map view to test offline tiles"
echo ""
echo "Data source: OpenStreetMap via Geofabrik (100% free)"
echo "Update frequency: Daily updates available from Geofabrik"
echo ""
echo "For troubleshooting, see OFFLINE_MAPS.md"
echo ""

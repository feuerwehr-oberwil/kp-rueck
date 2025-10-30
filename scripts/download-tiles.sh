#!/bin/bash
set -e

# Download and setup offline map tiles for Basel-Landschaft region
# Usage: ./scripts/download-tiles.sh

TILES_FILE="basel-landschaft.mbtiles"
CONTAINER_NAME="kprueck-tileserver-dev"
DOWNLOAD_URL="https://data.maptiler.com/downloads/europe/switzerland/basel-landschaft.mbtiles"

echo "═══════════════════════════════════════════════"
echo " KP Rück - Offline Map Tiles Setup"
echo "═══════════════════════════════════════════════"
echo ""
echo "This script will download and install offline map tiles"
echo "for the Basel-Landschaft region."
echo ""
echo "Expected download size: ~1-2 GB"
echo "This may take 5-15 minutes depending on your connection."
echo ""

# Check prerequisites
echo "[1/5] Checking prerequisites..."
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker not found. Please install Docker first."
    exit 1
fi
echo "✓ Docker found"

# Check if tile server container exists
if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "⚠️  Warning: Tile server container not found."
    echo "   Please run 'make dev' first to start all services."
    exit 1
fi
echo "✓ Tile server container found"
echo ""

# Download tiles
echo "[2/5] Downloading tiles..."
echo "Note: If this URL doesn't work, please see OFFLINE_MAPS.md for alternative download options."
echo ""

# Create temp directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

# Check if we should use wget or curl
if command -v wget &> /dev/null; then
    echo "Downloading with wget..."
    wget -O "$TILES_FILE" "$DOWNLOAD_URL" || {
        echo ""
        echo "❌ Download failed!"
        echo ""
        echo "Alternative options:"
        echo "1. Download manually from https://openmaptiles.com/"
        echo "2. See OFFLINE_MAPS.md for detailed instructions"
        echo "3. Download from Geofabrik: https://download.geofabrik.de/europe/switzerland.html"
        echo ""
        rm -rf "$TEMP_DIR"
        exit 1
    }
elif command -v curl &> /dev/null; then
    echo "Downloading with curl..."
    curl -L -o "$TILES_FILE" "$DOWNLOAD_URL" || {
        echo ""
        echo "❌ Download failed!"
        echo ""
        echo "Alternative options:"
        echo "1. Download manually from https://openmaptiles.com/"
        echo "2. See OFFLINE_MAPS.md for detailed instructions"
        echo "3. Download from Geofabrik: https://download.geofabrik.de/europe/switzerland.html"
        echo ""
        rm -rf "$TEMP_DIR"
        exit 1
    }
else
    echo "❌ Error: Neither wget nor curl found. Please install one of them."
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo "✓ Tiles downloaded successfully"
echo ""

# Verify file exists and has reasonable size
FILE_SIZE=$(stat -f%z "$TILES_FILE" 2>/dev/null || stat -c%s "$TILES_FILE" 2>/dev/null)
if [ "$FILE_SIZE" -lt 1000000 ]; then
    echo "❌ Error: Downloaded file seems too small (${FILE_SIZE} bytes)"
    echo "   Expected at least 1 MB. The download may have failed."
    rm -rf "$TEMP_DIR"
    exit 1
fi
echo "✓ File size verified: $(numfmt --to=iec-i --suffix=B $FILE_SIZE 2>/dev/null || echo "${FILE_SIZE} bytes")"
echo ""

# Copy to Docker volume
echo "[3/5] Installing tiles to Docker volume..."
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
echo "[4/5] Restarting tile server..."
docker restart "$CONTAINER_NAME" > /dev/null
echo "✓ Tile server restarted"
echo ""

# Wait for tile server to be ready
echo "[5/5] Waiting for tile server to be ready..."
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
echo "For troubleshooting, see OFFLINE_MAPS.md"
echo ""

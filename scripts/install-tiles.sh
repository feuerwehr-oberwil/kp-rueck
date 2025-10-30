#!/bin/bash
set -e

# Install pre-downloaded tiles to TileServer
# Usage: ./scripts/install-tiles.sh <path-to-mbtiles-file>

CONTAINER_NAME="kprueck-tileserver-dev"
TILES_FILE="basel-landschaft.mbtiles"

echo "═══════════════════════════════════════════════"
echo " KP Rück - Install Offline Map Tiles"
echo "═══════════════════════════════════════════════"
echo ""

# Check if file path was provided
if [ $# -eq 0 ]; then
    echo "Usage: ./scripts/install-tiles.sh <path-to-mbtiles-file>"
    echo ""
    echo "Example:"
    echo "  ./scripts/install-tiles.sh ~/Downloads/switzerland.mbtiles"
    echo "  ./scripts/install-tiles.sh ~/Downloads/basel-landschaft.mbtiles"
    echo ""
    echo "Get free MBTiles from:"
    echo "  https://download.geofabrik.de/europe/switzerland.html"
    echo "  https://openmaptiles.com/downloads/planet/ (free for small regions)"
    echo ""
    exit 1
fi

SOURCE_FILE="$1"

# Check if source file exists
if [ ! -f "$SOURCE_FILE" ]; then
    echo "❌ Error: File not found: $SOURCE_FILE"
    exit 1
fi

echo "Source file: $SOURCE_FILE"
FILE_SIZE=$(stat -f%z "$SOURCE_FILE" 2>/dev/null || stat -c%s "$SOURCE_FILE" 2>/dev/null)
echo "File size: $(numfmt --to=iec-i --suffix=B $FILE_SIZE 2>/dev/null || echo "${FILE_SIZE} bytes")"
echo ""

# Check if Docker is running
if ! docker ps &> /dev/null; then
    echo "❌ Error: Docker is not running. Please start Docker first."
    exit 1
fi

# Check if tile server container exists
if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "❌ Error: Tile server container not found."
    echo "   Please run 'make dev' first to start all services."
    exit 1
fi

echo "[1/3] Copying tiles to Docker volume..."
docker cp "$SOURCE_FILE" "${CONTAINER_NAME}:/data/${TILES_FILE}" || {
    echo "❌ Error: Failed to copy tiles to Docker container"
    exit 1
}
echo "✓ Tiles copied successfully"
echo ""

echo "[2/3] Restarting tile server..."
docker restart "$CONTAINER_NAME" > /dev/null
echo "✓ Tile server restarted"
echo ""

echo "[3/3] Waiting for tile server to be ready..."
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
echo "1. Open http://localhost:8080 to verify tiles are loaded"
echo "2. Go to Settings → Map Mode and select 'Offline'"
echo "3. Navigate to Map view to test offline tiles"
echo ""
echo "To check status: make tiles-status"
echo ""

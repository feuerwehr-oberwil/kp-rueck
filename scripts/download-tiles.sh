#!/bin/bash
set -e

# Download and generate offline map tiles for YOUR station's area.
#
# Usage: ./scripts/download-tiles.sh
#
# The defaults below cover Basel-Landschaft, because that is where the first
# station running KP Rück sits. A station anywhere else overrides them with
# environment variables rather than editing this file — the geography is
# configuration, not source:
#
#   TILES_REGION   Human-readable label, used only in the output.
#   TILES_BOUNDS   minLon,minLat,maxLon,maxLat — the area actually rendered.
#                  Find yours at https://boundingbox.klokantech.com/ (CSV format).
#   TILES_AREA     planetiler's area name for the auxiliary data it fetches;
#                  keep it consistent with the extract below.
#   TILES_PBF_URL  Any Geofabrik extract: https://download.geofabrik.de/
#
# Example — a station in Upper Bavaria:
#
#   TILES_REGION="Oberbayern" \
#   TILES_BOUNDS=11.0,47.7,12.3,48.4 \
#   TILES_AREA=oberbayern \
#   TILES_PBF_URL=https://download.geofabrik.de/europe/germany/bayern/oberbayern-latest.osm.pbf \
#     ./scripts/download-tiles.sh
#
# TILES_NAME is deliberately NOT part of that list. It is the filename the
# tileserver looks for, so changing it means changing it in the container too
# (scripts/init-tileserver.sh reads the same variable) — and an existing
# deployment already has tiles on its volume under the default name. Leave it
# alone unless you are setting up a new stack and want the file to say what it
# holds; then set it in both places.

TILES_REGION="${TILES_REGION:-Basel-Landschaft}"
TILES_BOUNDS="${TILES_BOUNDS:-7.4,47.4,7.9,47.7}"
TILES_AREA="${TILES_AREA:-switzerland}"
TILES_PBF_URL="${TILES_PBF_URL:-https://download.geofabrik.de/europe/switzerland-latest.osm.pbf}"
TILES_NAME="${TILES_NAME:-basel-landschaft}"

TILES_FILE="${TILES_NAME}.mbtiles"
CONTAINER_NAME="${TILES_CONTAINER:-kprueck-tileserver-dev}"
DOWNLOAD_URL="$TILES_PBF_URL"
OSM_FILE="$(basename "$TILES_PBF_URL")"

echo "═══════════════════════════════════════════════"
echo " KP Rück - Offline Map Tiles Setup"
echo "═══════════════════════════════════════════════"
echo ""
echo "This script will download FREE OpenStreetMap data from Geofabrik"
echo "and generate offline map tiles for: $TILES_REGION"
echo "Bounds: $TILES_BOUNDS"
echo ""
echo "Not your area? Set TILES_REGION / TILES_BOUNDS / TILES_AREA / TILES_PBF_URL"
echo "— see the header of this script, or docs/OFFLINE_MAPS.md."
echo ""
echo "Source: Geofabrik (https://geofabrik.de) - 100% Free & Legal"
echo "Expected download size: ~500 MB OSM data"
echo "Conversion uses Docker (planetiler) - no local tools needed"
echo "This may take 5-15 minutes depending on your connection and system."
echo ""

# Check prerequisites
echo "[1/7] Checking prerequisites..."
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker not found. Please install Docker first."
    exit 1
fi
echo "✓ Docker found"

# Check if tile server container exists
if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "⚠️  Warning: Tile server container not found."
    echo "   Please run 'just dev' first to start all services."
    exit 1
fi
echo "✓ Tile server container found"
echo ""

# Create temp directory
echo "[2/7] Setting up temporary workspace..."
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"
echo "✓ Workspace created: $TEMP_DIR"
echo ""

# Download OSM data
echo "[3/7] Downloading OSM data from Geofabrik..."
echo "Source: $DOWNLOAD_URL"
echo ""

# Check if we should use wget or curl
if command -v wget &> /dev/null; then
    echo "Downloading with wget..."
    wget --progress=bar:force -O "$OSM_FILE" "$DOWNLOAD_URL" || {
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
    curl -L --progress-bar -o "$OSM_FILE" "$DOWNLOAD_URL" || {
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

# Generate MBTiles from OSM data using planetiler in Docker
echo "[4/7] Generating MBTiles for $TILES_REGION..."
echo "Using planetiler (Docker-based, no local installation needed)"
echo "This may take 5-15 minutes depending on your system..."
echo ""

# Run planetiler in Docker to convert OSM to MBTiles
docker run --rm \
  -v "$TEMP_DIR:/data" \
  ghcr.io/onthegomap/planetiler:latest \
  --download \
  --area="$TILES_AREA" \
  --bounds="$TILES_BOUNDS" \
  --output=/data/"$TILES_FILE" \
  --osm-path=/data/"$OSM_FILE" \
  --nodemap-type=array \
  --storage=mmap || {
    echo ""
    echo "❌ Error: MBTiles generation failed!"
    echo ""
    echo "This could be due to:"
    echo "1. Insufficient disk space (~2 GB needed temporarily)"
    echo "2. Insufficient RAM (4 GB recommended)"
    echo "3. Corrupted download"
    echo ""
    echo "You can try downloading pre-generated tiles manually."
    echo "See docs/OFFLINE_MAPS.md for alternative methods."
    echo ""
    rm -rf "$TEMP_DIR"
    exit 1
}

echo "✓ MBTiles generated successfully"
echo ""

# Verify file exists and has reasonable size
echo "[5/7] Verifying generated tiles..."
FILE_SIZE=$(stat -f%z "$TILES_FILE" 2>/dev/null || stat -c%s "$TILES_FILE" 2>/dev/null || echo "0")
if [ "$FILE_SIZE" -lt 1000000 ]; then
    echo "❌ Error: Generated file seems too small (${FILE_SIZE} bytes)"
    echo "   Expected at least 1 MB. The generation may have failed."
    rm -rf "$TEMP_DIR"
    exit 1
fi

# Format file size for display
if command -v numfmt &> /dev/null; then
    SIZE_DISPLAY=$(numfmt --to=iec-i --suffix=B $FILE_SIZE)
else
    SIZE_DISPLAY="${FILE_SIZE} bytes"
fi
echo "✓ File size verified: $SIZE_DISPLAY"
echo ""

# Copy to Docker volume
echo "[6/7] Installing tiles to Docker volume..."
docker cp "$TILES_FILE" "${CONTAINER_NAME}:/data/${TILES_FILE}" || {
    echo "❌ Error: Failed to copy tiles to Docker container"
    echo "   Make sure the tile server container is running: docker ps"
    rm -rf "$TEMP_DIR"
    exit 1
}
echo "✓ Tiles installed successfully"
echo ""

# Clean up temp directory
echo "Cleaning up temporary files..."
rm -rf "$TEMP_DIR"
echo "✓ Temporary files cleaned up"
echo ""

# Restart tile server
echo "[7/7] Restarting tile server..."
docker restart "$CONTAINER_NAME" > /dev/null
echo "✓ Tile server restarted"
echo ""

# Wait for tile server to be ready
echo "Waiting for tile server to be ready..."
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
        echo "   It may still be starting up. Check with: just tiles-status"
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# Success message
echo "═══════════════════════════════════════════════"
echo "✅ Offline map tiles installed successfully!"
echo "═══════════════════════════════════════════════"
echo ""
echo "Tile size: $SIZE_DISPLAY"
echo "Coverage: $TILES_REGION ($TILES_BOUNDS, zoom 0-17)"
echo ""
echo "Next steps:"
echo "1. Open http://localhost:8080 to view tile server"
echo "2. Go to Settings → Map Mode and select 'Offline'"
echo "3. Navigate to Map view to test offline tiles"
echo ""
echo "Data source: OpenStreetMap via Geofabrik (100% free)"
echo "Update frequency: Daily updates available from Geofabrik"
echo ""
echo "For troubleshooting, run: just tiles-status"
echo "For documentation, see: docs/OFFLINE_MAPS.md"
echo ""

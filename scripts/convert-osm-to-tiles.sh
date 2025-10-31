#!/bin/bash
set -e

# Convert OSM PBF to MBTiles using Docker (no local tools needed)
# Usage: ./scripts/convert-osm-to-tiles.sh <path-to-pbf-file>

echo "═══════════════════════════════════════════════"
echo " KP Rück - Convert OSM to MBTiles"
echo "═══════════════════════════════════════════════"
echo ""

# Check if file path was provided
if [ $# -eq 0 ]; then
    echo "Usage: ./scripts/convert-osm-to-tiles.sh <path-to-pbf-file>"
    echo ""
    echo "Example:"
    echo "  ./scripts/convert-osm-to-tiles.sh ~/Downloads/switzerland-251029.osm.pbf"
    echo ""
    exit 1
fi

SOURCE_FILE="$1"
BASENAME=$(basename "$SOURCE_FILE" .osm.pbf)
OUTPUT_FILE="${BASENAME}.mbtiles"

# Check if source file exists
if [ ! -f "$SOURCE_FILE" ]; then
    echo "❌ Error: File not found: $SOURCE_FILE"
    exit 1
fi

echo "Source file: $SOURCE_FILE"
FILE_SIZE=$(stat -f%z "$SOURCE_FILE" 2>/dev/null || stat -c%s "$SOURCE_FILE" 2>/dev/null)
echo "File size: $(numfmt --to=iec-i --suffix=B $FILE_SIZE 2>/dev/null || echo "${FILE_SIZE} bytes")"
echo ""

# Get absolute paths
SOURCE_DIR=$(cd "$(dirname "$SOURCE_FILE")" && pwd)
SOURCE_NAME=$(basename "$SOURCE_FILE")

echo "Converting OSM PBF to MBTiles using Docker..."
echo "This will take 10-20 minutes for Switzerland data..."
echo ""
echo "[1/2] Running tilemaker in Docker..."

# Use tilemaker Docker image (no local installation needed)
# Get absolute path for Docker volume mount
ABS_SOURCE_DIR=$(cd "$SOURCE_DIR" && pwd)

docker run --rm \
  -v "$ABS_SOURCE_DIR:/data" \
  ghcr.io/systemed/tilemaker:master \
  --input "/data/$SOURCE_NAME" \
  --output "/data/$OUTPUT_FILE" \
  --bbox 7.4,47.4,7.9,47.7

if [ ! -f "$SOURCE_DIR/$OUTPUT_FILE" ]; then
    echo "❌ Error: Conversion failed - output file not created"
    exit 1
fi

echo "✓ Conversion complete!"
echo ""
echo "Output file: $SOURCE_DIR/$OUTPUT_FILE"
OUTPUT_SIZE=$(stat -f%z "$SOURCE_DIR/$OUTPUT_FILE" 2>/dev/null || stat -c%s "$SOURCE_DIR/$OUTPUT_FILE" 2>/dev/null)
echo "Output size: $(numfmt --to=iec-i --suffix=B $OUTPUT_SIZE 2>/dev/null || echo "${OUTPUT_SIZE} bytes")"
echo ""

echo "[2/2] Installing tiles..."
./scripts/install-tiles.sh "$SOURCE_DIR/$OUTPUT_FILE"

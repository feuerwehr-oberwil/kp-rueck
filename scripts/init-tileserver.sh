#!/bin/sh
set -e

# Initialize TileServer GL, creating a minimal working MBTiles file if none exists.
# For full-resolution tiles, run: just tiles-download
#
# TILES_NAME must match what scripts/download-tiles.sh writes. It defaults to the
# region the first station covers; a new stack that renames it has to set the same
# value in both places, and an existing deployment should leave it alone — its tiles
# are already on the volume under the default name.

TILES_NAME="${TILES_NAME:-basel-landschaft}"
TILES_FILE="/data/${TILES_NAME}.mbtiles"
TILES_BOUNDS="${TILES_BOUNDS:-7.4,47.4,7.9,47.7}"
TILES_CENTER="${TILES_CENTER:-7.65,47.55,12}"

echo "========================================="
echo "TileServer GL Initialization"
echo "========================================="

# Check if tiles already exist
if [ -f "$TILES_FILE" ]; then
    echo "✓ Tiles found: ${TILES_NAME}.mbtiles"
else
    echo "⚠️  No tiles found. Creating minimal bootstrap MBTiles..."
    echo ""
    echo "This creates a minimal valid MBTiles database for TileServer GL."
    echo "The map will show online OSM tiles until you download offline tiles."
    echo ""
    echo "To download full offline tiles, run:"
    echo "  just tiles-download"
    echo ""

    # Create minimal but valid MBTiles database using sqlite3
    # This satisfies TileServer GL's requirements but contains no actual tile data
    sqlite3 "$TILES_FILE" <<SQL
-- Create required MBTiles schema
CREATE TABLE metadata (name text, value text);
CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);
CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);

-- Add required metadata for TileServer GL
INSERT INTO metadata VALUES ('name', '${TILES_NAME}');
INSERT INTO metadata VALUES ('type', 'baselayer');
INSERT INTO metadata VALUES ('version', '1.0');
INSERT INTO metadata VALUES ('description', 'Bootstrap MBTiles - Download full tiles with: just tiles-download');
INSERT INTO metadata VALUES ('format', 'png');
INSERT INTO metadata VALUES ('minzoom', '0');
INSERT INTO metadata VALUES ('maxzoom', '17');
INSERT INTO metadata VALUES ('bounds', '${TILES_BOUNDS}');
INSERT INTO metadata VALUES ('center', '${TILES_CENTER}');
INSERT INTO metadata VALUES ('attribution', '© OpenStreetMap contributors');
SQL

    echo "✓ Bootstrap MBTiles created successfully"
    echo ""
    echo "╔════════════════════════════════════════════════╗"
    echo "║  IMPORTANT: Offline maps not yet downloaded   ║"
    echo "╠════════════════════════════════════════════════╣"
    echo "║  The map will use online OSM tiles by default ║"
    echo "║                                                ║"
    echo "║  To enable full offline capability:            ║"
    echo "║    1. Run: just tiles-download                 ║"
    echo "║    2. Wait for download (~1-2 GB)              ║"
    echo "║    3. Tiles auto-load on restart               ║"
    echo "╚════════════════════════════════════════════════╝"
    echo ""
fi

echo "========================================="
echo "Starting TileServer GL..."
echo "========================================="
echo ""

# Start TileServer GL - it will auto-detect MBTiles in /data
# Pass through to original entrypoint without config file
exec /usr/src/app/docker-entrypoint.sh

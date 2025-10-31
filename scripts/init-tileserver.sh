#!/bin/sh
set -e

# Initialize TileServer GL with minimal Basel-Landschaft tiles
# This creates a minimal working MBTiles file if none exists
# For full-resolution tiles, run: make tiles-download

TILES_FILE="/data/basel-landschaft.mbtiles"

echo "========================================="
echo "TileServer GL Initialization"
echo "========================================="

# Check if tiles already exist
if [ -f "$TILES_FILE" ]; then
    echo "✓ Tiles found: basel-landschaft.mbtiles"
else
    echo "⚠️  No tiles found. Creating minimal bootstrap MBTiles..."
    echo ""
    echo "This creates a minimal valid MBTiles database for TileServer GL."
    echo "The map will show online OSM tiles until you download offline tiles."
    echo ""
    echo "To download full offline tiles, run:"
    echo "  make tiles-download"
    echo ""

    # Create minimal but valid MBTiles database using sqlite3
    # This satisfies TileServer GL's requirements but contains no actual tile data
    sqlite3 "$TILES_FILE" <<'SQL'
-- Create required MBTiles schema
CREATE TABLE metadata (name text, value text);
CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);
CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);

-- Add required metadata for TileServer GL
INSERT INTO metadata VALUES ('name', 'basel-landschaft');
INSERT INTO metadata VALUES ('type', 'baselayer');
INSERT INTO metadata VALUES ('version', '1.0');
INSERT INTO metadata VALUES ('description', 'Bootstrap MBTiles - Download full tiles with: make tiles-download');
INSERT INTO metadata VALUES ('format', 'png');
INSERT INTO metadata VALUES ('minzoom', '0');
INSERT INTO metadata VALUES ('maxzoom', '17');
INSERT INTO metadata VALUES ('bounds', '7.4,47.4,7.9,47.7');
INSERT INTO metadata VALUES ('center', '7.65,47.55,12');
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
    echo "║    1. Run: make tiles-download                 ║"
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

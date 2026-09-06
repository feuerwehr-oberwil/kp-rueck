#!/bin/sh
set -e

# Initialize TileServer GL, creating a minimal working MBTiles file if none exists.
# For full-resolution tiles, run: just tiles-download
#
# TILES_NAME must match what scripts/download-tiles.sh writes. It defaults to the
# region the first station covers; a new stack that renames it has to set the same
# value in both places, and an existing deployment should leave it alone – its tiles
# are already on the volume under the default name.
#
# TILES_PUBLIC_URL is what makes the vector style survive a reverse proxy. TileServer GL
# writes its own address into every style.json it serves – the vector source URL, the glyph
# and the sprite path – and it derives that address from the request's Host header, which
# knows nothing about a path prefix. Behind the production Caddy (`handle_path /tiles/*`
# strips the prefix before the tileserver sees the request) those self-references come back
# as `https://station/styles/...` and the map loads nothing. `--public_url` replaces them
# with a prefix of our choosing; a ROOT-RELATIVE one (`/tiles/`) keeps the published image
# generic, because the browser resolves it against whatever host it is already talking to.
#
# Leave it empty – the dev stack does – and the tileserver is reached directly on :8080,
# where the host-derived absolute URLs are exactly right.
#
# One thing a root-relative prefix costs the client: MapLibre fetches vector TILES from a
# worker created off a blob URL, and a blob URL is no base for resolving `/tiles/…` – the
# fetch throws before it leaves the browser. Style, TileJSON and glyphs are fetched from the
# main thread and resolve fine. So the map has to hand MapLibre a `transformRequest` that
# prefixes `location.origin` onto root-relative URLs (frontend/components/map/base-map.tsx).
# Measured against tileserver-gl v4.10.0 + maplibre-gl 4.7, 2026-08-25.

TILES_NAME="${TILES_NAME:-basel-landschaft}"
TILES_FILE="/data/${TILES_NAME}.mbtiles"
TILES_BOUNDS="${TILES_BOUNDS:-7.4,47.4,7.9,47.7}"
TILES_CENTER="${TILES_CENTER:-7.65,47.55,12}"
TILES_PUBLIC_URL="${TILES_PUBLIC_URL:-}"

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
if [ -n "$TILES_PUBLIC_URL" ]; then
    echo "Serving style self-references under: ${TILES_PUBLIC_URL}"
fi
echo ""

# Start TileServer GL - it will auto-detect MBTiles in /data
# Pass through to original entrypoint without config file
if [ -n "$TILES_PUBLIC_URL" ]; then
    exec /usr/src/app/docker-entrypoint.sh --public_url "$TILES_PUBLIC_URL"
else
    exec /usr/src/app/docker-entrypoint.sh
fi

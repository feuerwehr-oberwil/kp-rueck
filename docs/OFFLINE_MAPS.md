# Offline Map Tiles Setup Guide

This guide explains the offline map tiles functionality in KP Rück. The system provides **automatic offline map capability** for emergency operations when internet connectivity is unavailable.

## Overview

The system uses a self-hosted [TileServer GL](https://github.com/maptiler/tileserver-gl) instance to serve map tiles locally. The defaults cover the Basel-Landschaft region (Switzerland) because that is where the first station running KP Rück sits — **any region** works, from free OpenStreetMap data, without touching the code. See [Using Custom Regions](#using-custom-regions).

**Zoom Levels**: 0-17 (building-level detail)
**Tile Format**: MBTiles (single-file SQLite database)
**Data Source**: [Geofabrik](https://download.geofabrik.de/) OpenStreetMap extracts (free)

## Quick Start

### Automatic Setup (Default)

The tile server starts automatically with minimal bootstrap tiles:

```bash
just dev
```

That's it! The system will:
1. Auto-create minimal valid MBTiles on first startup
2. Start TileServer GL on port 8080
3. Use online OpenStreetMap tiles by default
4. Automatically fall back to offline tiles if online fails

**No pre-setup required** -- the tile server is ready out of the box.

### Full Offline Capability (Optional)

For complete offline operation with full-resolution tiles:

```bash
# Download full offline tiles (defaults to the Basel-Landschaft region)
just tiles-download

# Restart tile server to load new tiles
just tiles-restart

# Set map mode to 'Offline' in Settings
```

This provides full offline map capability without any online dependency.

> **Using a different region?** See [Using Custom Regions](#using-custom-regions) below.

## Map Modes

The application provides three map modes (configurable in Settings):

### Auto Mode (Recommended for Local Development)
- Uses online OpenStreetMap tiles by default
- **Automatically falls back** to offline tiles if online fails
- Best for normal operations with internet connectivity
- Seamlessly handles connectivity issues
- **Note**: Only works when tile server is running (local Docker setup)

### Online Mode (Default for Production/Railway)
- Always uses OpenStreetMap tiles
- Requires internet connectivity
- No fallback to offline tiles
- **Recommended for Railway deployments** (no tile server available)

### Offline Mode (Local Development Only)
- Always uses local tile server
- Works completely offline
- Requires full offline tiles (via `just tiles-download`)
- **Only available in local Docker setup** (not on Railway)

## How It Works

### Bootstrap Tiles (Automatic)

On first startup, the system creates a minimal but valid MBTiles file:
- **Size**: ~100 KB (nearly empty)
- **Purpose**: Satisfies TileServer GL requirements
- **Behavior**: Map uses online OSM tiles, tile server ready for upgrades
- **Created by**: `scripts/init-tileserver.sh` automatically

### Full Offline Tiles (Optional)

The `just tiles-download` command downloads and generates complete tiles:
- **Source**: Geofabrik OSM extracts (100% free, legal)
- **Tool**: Planetiler (runs in Docker, no local installation needed)
- **Coverage**: whatever `TILES_BOUNDS` covers (default: Basel-Landschaft), zoom 0-17
- **Size**: ~12 MB MBTiles (vector tiles, very efficient!)
- **Data**: Complete street-level detail for offline use
- **Update frequency**: Every 3-6 months recommended
- **Process**: Downloads ~500 MB OSM data, converts to MBTiles, installs automatically

## Verifying Tiles Are Working

### Check Tile Server Status

```bash
# Check if tile server is running
just tiles-status

# Or manually:
curl http://localhost:8080/health
```

Expected response: `{"status":"ok"}`

### View Tile Server UI

Open in browser: http://localhost:8080/

You should see:
- TileServer GL interface
- "basel-landschaft" data source listed
- Preview map with tiles

### Test Tile Access

```bash
# Get a sample tile (zoom 10, Basel area)
curl http://localhost:8080/data/basel-landschaft/10/533/357.pbf

# Should return binary data (PBF format)
```

### Test in Application

1. Start the application: `just dev`
2. Go to Settings → Map Mode
3. Select "Offline" mode
4. Navigate to Map view
5. Verify tiles load correctly

## Tile Server Endpoints

The tile server provides the following endpoints:

### Raster Tiles (for Leaflet)
```
http://localhost:8080/styles/basic/{z}/{x}/{y}.png
```

### Vector Tiles (PBF)
```
http://localhost:8080/data/basel-landschaft/{z}/{x}/{y}.pbf
```

### Health Check
```
http://localhost:8080/health
```

### Tile JSON (metadata)
```
http://localhost:8080/data/basel-landschaft.json
```

## Updating Tiles

Tiles should be updated periodically to include new streets, buildings, and map changes.

**Recommended Update Frequency**: Every 3-6 months

**Update Process**:

1. Download new MBTiles file (following Option 1 or 2 above)
2. Backup current tiles:
   ```bash
   docker exec kprueck-tileserver-dev cp /data/basel-landschaft.mbtiles /data/basel-landschaft.mbtiles.backup
   ```
3. Copy new tiles:
   ```bash
   docker cp basel-landschaft.mbtiles kprueck-tileserver-dev:/data/basel-landschaft.mbtiles
   ```
4. Restart tile server:
   ```bash
   just tiles-restart
   ```
5. Verify new tiles work

## Troubleshooting

### Tile Server Not Starting

**Check logs**:
```bash
docker logs kprueck-tileserver-dev
```

**Common issues**:
- Port conflict: Ensure port 8080 is not in use by another service
- Docker volume permission issues: Try `just clean && just dev`
- Init script error: Check logs for sqlite3 or file system errors

**Note**: MBTiles and config are auto-created on startup, so missing files are not an issue.

### Tiles Not Loading in Application

**Check frontend console** for errors:
- Network errors: Tile server may not be running
- 404 errors: MBTiles file may be missing or misnamed
- Tile coordinate errors: Zoom level may be out of range (0-17)

**Verify tile server is accessible**:
```bash
curl http://localhost:8080/health
```

**Check map mode setting**:
- Go to Settings → Map Mode
- Ensure mode is set to "Auto" or "Offline"

### Tiles Load Slowly

**Possible causes**:
- Large MBTiles file (>2GB): Consider reducing zoom levels
- Docker resource limits: Increase Docker memory allocation
- Disk I/O: Ensure Docker volume is on fast storage (SSD recommended)

**Optimization**:
```bash
# Increase Docker memory limit (Docker Desktop)
# Settings → Resources → Memory → 4GB or more
```

### Tiles Show Wrong Area

**Verify bounding box**:
```bash
# Check tile metadata
curl http://localhost:8080/data/basel-landschaft.json | jq .bounds
```

Expected bounds (Basel-Landschaft):
```json
[7.4, 47.4, 7.9, 47.7]
```

## Advanced Configuration

### Custom Config

The tile server config is auto-generated by `scripts/init-tileserver.sh`. To customize:

1. Let the init script create the base config on first run
2. Modify `/data/config.json` inside the container:
   ```bash
   docker exec -it kprueck-tileserver-dev vi /data/config.json
   ```
3. Restart: `just tiles-restart`

### Custom Styles

Add custom map styles to the config:

```json
{
  "styles": {
    "custom": {
      "style": "/data/custom-style.json"
    }
  }
}
```

### Multiple Regions

Add additional MBTiles files for other regions:

1. Copy MBTiles into container:
   ```bash
   docker cp switzerland.mbtiles kprueck-tileserver-dev:/data/switzerland.mbtiles
   ```

2. Update config to include new data source:
   ```json
   {
     "data": {
       "basel-landschaft": {
         "mbtiles": "basel-landschaft.mbtiles"
       },
       "switzerland": {
         "mbtiles": "switzerland.mbtiles"
       }
     }
   }
   ```

3. Restart tile server: `just tiles-restart`

**Note**: The frontend uses a single data source, the one named by `TILES_NAME`.

### Performance Tuning

**Increase cache size** (add to docker-compose environment):
```yaml
environment:
  - TILESERVER_PORT=8080
  - TILESERVER_CACHE=512  # MB
```

**Use SSD storage** for Docker volumes:
```yaml
volumes:
  tileserver-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /path/to/fast/ssd/storage
```

## Storage Requirements

| Zoom Levels | Coverage | Approximate Size |
|-------------|----------|------------------|
| 0-10        | Basel-Landschaft | ~50 MB |
| 0-14        | Basel-Landschaft | ~300 MB |
| 0-17        | Basel-Landschaft | ~1-2 GB |
| 0-17        | All Switzerland  | ~10-15 GB |

**Recommendation**: Use zoom 0-17 for a single canton or district (~1-2 GB) for the best balance of detail and storage.

## Backup and Disaster Recovery

### Backup Tiles

```bash
# Backup to local filesystem
docker cp kprueck-tileserver-dev:/data/basel-landschaft.mbtiles ./backups/tiles-$(date +%Y%m%d).mbtiles
```

### Restore Tiles

```bash
# Restore from backup
docker cp ./backups/tiles-20250101.mbtiles kprueck-tileserver-dev:/data/basel-landschaft.mbtiles
just tiles-restart
```

### Include in Regular Backups

Add to `scripts/backup.sh`:
```bash
# Backup offline map tiles
docker cp kprueck-tileserver:/data/basel-landschaft.mbtiles "$BACKUP_DIR/tiles.mbtiles"
```

## Technical Details

### Bootstrap Process

The `scripts/init-tileserver.sh` script runs on container startup and:

1. **Checks for existing tiles**: If `${TILES_NAME}.mbtiles` exists, skips creation
2. **Creates minimal MBTiles**: Uses sqlite3 to create valid MBTiles schema:
   - `metadata` table with required fields (name, type, version, format, bounds, etc.)
   - `tiles` table with proper schema (zoom_level, tile_column, tile_row, tile_data)
   - Unique index on tile coordinates
3. **Generates config**: Creates `/data/config.json` with TileServer GL settings
4. **Starts TileServer GL**: Launches server on port 8080

**Why minimal tiles?**
- TileServer GL requires valid MBTiles with metadata to start
- Empty database satisfies server requirements (~100 KB)
- Allows map to use online tiles while server is ready for upgrades
- No multi-gigabyte download required for basic functionality

### Upgrade to Full Offline

When you run `just tiles-download`:
1. Downloads the OSM extract from Geofabrik (`TILES_PBF_URL`, ~500 MB for Switzerland)
2. Runs Planetiler in Docker to convert OSM → MBTiles
3. Generates vector tiles for the configured bounds (`TILES_BOUNDS`, zoom 0-17)
4. Copies MBTiles to tile server container (~12 MB final size)
5. Restarts tile server, which auto-creates `basic-preview` style
6. TileServer GL renders vector tiles as raster PNGs on-the-fly
7. Map can now work fully offline with complete street detail

**Note**: Vector tiles + server-side rendering = smaller storage, better quality!

## Production Deployment (Railway)

**Important**: The offline tile server is **only available in local Docker development**.

### Railway Configuration

Railway deployments **do not include** the tile server container because:
- Tile server requires persistent storage (~12 MB+ per region)
- Adds deployment complexity and cost
- Online OpenStreetMap tiles are reliable and free
- Most production use cases have internet connectivity

### Settings for Railway

The application automatically uses **"online" mode** on Railway by default:
- No tile server connection attempted
- All maps use OpenStreetMap tiles
- No offline fallback (not needed in production)
- Clean, simple deployment

### If You Need Offline Maps in Production

If your production deployment requires offline maps:
1. Use a managed tile hosting service (e.g., Maptiler, Mapbox)
2. Deploy TileServer GL separately with persistent volume
3. Update frontend `NEXT_PUBLIC_TILE_URL` environment variable
4. Consider costs: hosting + storage + bandwidth

For most use cases, online OpenStreetMap tiles are sufficient.

## Using Custom Regions

The defaults cover Basel-Landschaft, because that is where the first station running KP Rück
sits. **Your region is configuration, not a code change** — set four environment variables and
run the same script. (Earlier versions of this page told you to edit `scripts/download-tiles.sh`
and named variables the script never had. Sorry.)

### Step 1: Find your extract on Geofabrik

Browse [download.geofabrik.de](https://download.geofabrik.de/) and take the **smallest** extract
that covers your area — a smaller extract means a much faster conversion. For example:

- Germany / Upper Bavaria: `https://download.geofabrik.de/europe/germany/bayern/oberbayern-latest.osm.pbf`
- Austria: `https://download.geofabrik.de/europe/austria-latest.osm.pbf`
- France / Alsace: `https://download.geofabrik.de/europe/france/alsace-latest.osm.pbf`

### Step 2: Find your bounding box

[boundingbox.klokantech.com](https://boundingbox.klokantech.com/) — draw a box around your
operational area and copy the **CSV** output (`minLon,minLat,maxLon,maxLat`). Be generous at the
edges; an incident just outside the box has no offline map.

### Step 3: Generate and install

```bash
TILES_REGION="Oberbayern" \
TILES_BOUNDS=11.0,47.7,12.3,48.4 \
TILES_AREA=oberbayern \
TILES_PBF_URL=https://download.geofabrik.de/europe/germany/bayern/oberbayern-latest.osm.pbf \
  just tiles-download

just tiles-restart
```

| Variable | What it does |
| --- | --- |
| `TILES_REGION` | Label shown in the script's output and in `just tiles-status`. Cosmetic. |
| `TILES_BOUNDS` | The area actually rendered, `minLon,minLat,maxLon,maxLat`. This is the one that matters. |
| `TILES_AREA` | planetiler's area name for the auxiliary data it fetches. Keep it consistent with the extract. |
| `TILES_PBF_URL` | The Geofabrik extract from step 1. |

Put them in your shell profile or a small wrapper script so a later tile refresh reproduces the
same coverage — nothing on the server remembers what you passed.

### The filename is a separate decision

`TILES_NAME` (default `basel-landschaft`) is the name of the `.mbtiles` file on the tileserver
volume, not part of the geography above. Three places must agree on it:
`scripts/download-tiles.sh`, `scripts/install-tiles.sh`, and `scripts/init-tileserver.sh` — all
three read the same variable, and the tileserver container needs it in its environment too.

**An existing deployment should leave it alone.** Its tiles are already on the volume under the
default name, and renaming means the init script finds nothing and quietly writes a bootstrap
file instead — a map that looks like it works and has no tiles in it. Only worth setting on a
fresh stack, if you would rather the file said what it holds.

### Size Estimates by Region

| Region | OSM Extract | MBTiles (zoom 0-17) |
|--------|-------------|---------------------|
| Basel-Landschaft (canton) | ~500 MB | ~12 MB |
| Switzerland (country) | ~1.5 GB | ~500 MB |
| Bavaria (state) | ~2 GB | ~800 MB |
| All of Germany | ~4 GB | ~3 GB |

> **Tip:** Vector tiles are very space-efficient. Even large regions produce manageable MBTiles files.

---

## Resources

- [TileServer GL Documentation](https://tileserver.readthedocs.io/)
- [Geofabrik OSM Downloads](https://download.geofabrik.de/) -- free OSM data by region
- [MBTiles Specification](https://github.com/mapbox/mbtiles-spec)
- [OpenStreetMap](https://www.openstreetmap.org/)
- [Planetiler](https://github.com/onthegomap/planetiler) -- fast OSM-to-MBTiles converter

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review tile server logs: `docker logs kprueck-tileserver-dev`
3. Verify tile server status: `just tiles-status`
4. Open an issue on GitHub with logs and error messages

# Offline Map Tiles Setup Guide

This guide explains the offline map tiles functionality in the KP Rück system. The system provides **automatic offline map capability** for emergency operations when internet connectivity is unavailable.

## Overview

The system uses a self-hosted TileServer GL instance that provides map tiles for the Basel-Landschaft region. The map **automatically works with minimal setup** and falls back to offline tiles when online connectivity fails.

**Coverage**: Basel-Landschaft region (Switzerland)
**Zoom Levels**: 0-17 (building-level detail)
**Tile Format**: MBTiles (single-file SQLite database)
**Full Offline Size**: ~1-2 GB (optional download)

## Quick Start

### Automatic Setup (Default)

The tile server starts automatically with minimal bootstrap tiles:

```bash
make dev
```

That's it! The system will:
1. ✅ Auto-create minimal valid MBTiles on first startup
2. ✅ Start TileServer GL on port 8080
3. ✅ Use online OpenStreetMap tiles by default
4. ✅ Automatically fall back to offline if online tiles fail

**No pre-setup required** - the tile server is ready out-of-the-box.

### Full Offline Capability (Optional)

For complete offline operation with full-resolution tiles (~1-2 GB):

```bash
# Download full offline tiles
make tiles-download

# Restart tile server to load new tiles
make restart-tileserver

# Set map mode to 'Offline' in Settings
```

This provides full offline map capability without any online dependency.

## Map Modes

The application provides three map modes (configurable in Settings):

### Auto Mode (Recommended)
- Uses online OpenStreetMap tiles by default
- **Automatically falls back** to offline tiles if online fails
- Best for normal operations with internet connectivity
- Seamlessly handles connectivity issues

### Online Mode
- Always uses OpenStreetMap tiles
- Requires internet connectivity
- No fallback to offline tiles

### Offline Mode
- Always uses local tile server
- Works completely offline
- Requires full offline tiles (via `make tiles-download`)

## How It Works

### Bootstrap Tiles (Automatic)

On first startup, the system creates a minimal but valid MBTiles file:
- **Size**: ~100 KB (nearly empty)
- **Purpose**: Satisfies TileServer GL requirements
- **Behavior**: Map uses online OSM tiles, tile server ready for upgrades
- **Created by**: `scripts/init-tileserver.sh` automatically

### Full Offline Tiles (Optional)

The `make tiles-download` command downloads complete tiles:
- **Source**: Geofabrik OSM extracts (100% free, legal)
- **Coverage**: Basel-Landschaft region, zoom 0-17
- **Size**: ~1-2 GB
- **Data**: Complete street-level detail for offline use
- **Update frequency**: Every 3-6 months recommended

## Verifying Tiles Are Working

### Check Tile Server Status

```bash
# Check if tile server is running
make tiles-status

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

1. Start the KP Rück application: `make dev`
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
   make restart-tileserver
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
- Docker volume permission issues: Try `make clean && make dev`
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
3. Restart: `make restart-tileserver`

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

3. Restart tile server: `make restart-tileserver`

**Note**: Frontend currently only uses `basel-landschaft` data source.

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

**Recommendation**: Use zoom 0-17 for Basel-Landschaft (~1-2 GB) for best balance of detail and storage.

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
make restart-tileserver
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

1. **Checks for existing tiles**: If `basel-landschaft.mbtiles` exists, skips creation
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

When you run `make tiles-download`:
1. `scripts/download-tiles.sh` downloads full OSM extract from Geofabrik
2. Converts to MBTiles with proper zoom levels and bounding box
3. Replaces minimal bootstrap tiles with full dataset
4. Restarts tile server to load new tiles
5. Map can now work fully offline

## Resources

- [TileServer GL Documentation](https://tileserver.readthedocs.io/)
- [Geofabrik OSM Downloads](https://download.geofabrik.de/) (free OSM data source)
- [MBTiles Specification](https://github.com/mapbox/mbtiles-spec)
- [OpenStreetMap](https://www.openstreetmap.org/)

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review tile server logs: `docker logs kprueck-tileserver-dev`
3. Open an issue on GitHub with logs and error messages

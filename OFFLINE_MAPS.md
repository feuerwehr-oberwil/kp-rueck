# Offline Map Tiles Setup Guide

This guide explains how to set up offline map tiles for the KP Rück system to enable map functionality when internet connectivity is unavailable.

## Overview

The system uses a self-hosted TileServer GL instance to serve OpenStreetMap tiles for the Basel-Landschaft region. The map automatically falls back to these offline tiles when online OpenStreetMap servers are unavailable.

**Coverage**: Basel-Landschaft region (Switzerland)
**Zoom Levels**: 0-17 (building-level detail)
**Tile Format**: MBTiles (single-file SQLite database)
**Expected Size**: ~1-2 GB

## Quick Start

1. Download Basel-Landschaft MBTiles file (see options below)
2. Place file in Docker volume
3. Restart tile server
4. Verify tiles are working

## Option 1: Download Pre-Generated Tiles (Recommended)

### From OpenMapTiles

**Step 1**: Visit [OpenMapTiles](https://openmaptiles.com/)
- Create a free account
- Go to "Downloads" section
- Select "Switzerland" region
- Choose zoom levels: 0-17
- Select "OpenStreetMap" style
- Download the `.mbtiles` file

**Step 2**: Rename and place the file
```bash
# Rename the downloaded file
mv switzerland.mbtiles basel-landschaft.mbtiles

# Copy to Docker volume
docker cp basel-landschaft.mbtiles kprueck-tileserver-dev:/data/basel-landschaft.mbtiles
```

**Step 3**: Restart the tile server
```bash
make restart-tileserver
```

### From Geofabrik (Alternative)

**Step 1**: Download Basel-Stadt extract
```bash
# Download the extract
wget https://download.geofabrik.de/europe/switzerland/basel-stadt-latest.osm.pbf
```

**Step 2**: Convert to MBTiles using tilemaker
```bash
# Install tilemaker (macOS)
brew install tilemaker

# Convert to MBTiles
tilemaker --input basel-stadt-latest.osm.pbf \
          --output basel-landschaft.mbtiles \
          --process resources/process-openmaptiles.lua \
          --config resources/config-openmaptiles.json \
          --bbox 7.4,47.4,7.9,47.7
```

**Step 3**: Copy to Docker volume
```bash
docker cp basel-landschaft.mbtiles kprueck-tileserver-dev:/data/basel-landschaft.mbtiles
```

**Step 4**: Restart the tile server
```bash
make restart-tileserver
```

## Option 2: Use Tile Download Script

We provide a helper script that automates the download and setup process.

```bash
# Run the tile download script
./scripts/download-tiles.sh basel-landschaft
```

This script will:
1. Check prerequisites (Docker)
2. Download tile data from a public source
3. Place tiles in the correct Docker volume
4. Restart the tile server
5. Verify tiles are accessible

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
- MBTiles file missing: Ensure `basel-landschaft.mbtiles` exists in `/data` volume
- Config file error: Verify `tileserver-config.json` is valid JSON
- Port conflict: Ensure port 8080 is not in use

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

### Custom Styles

Edit `tileserver-config.json` to add custom map styles:

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

Update frontend to switch between regions as needed.

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

## Resources

- [TileServer GL Documentation](https://tileserver.readthedocs.io/)
- [OpenMapTiles](https://openmaptiles.com/)
- [Geofabrik Downloads](https://download.geofabrik.de/)
- [MBTiles Specification](https://github.com/mapbox/mbtiles-spec)
- [Tilemaker](https://github.com/systemed/tilemaker)

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review tile server logs: `docker logs kprueck-tileserver-dev`
3. Open an issue on GitHub with logs and error messages

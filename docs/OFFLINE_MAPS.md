# Offline Map Tiles Setup Guide

This guide explains the offline map tiles functionality in KP Rück. The system provides **automatic offline map capability** for emergency operations when internet connectivity is unavailable.

## Overview

The system uses a self-hosted [TileServer GL](https://github.com/maptiler/tileserver-gl) instance to serve map tiles locally. The defaults cover the Basel-Landschaft region (Switzerland) because that is where the first station running KP Rück sits – **any region** works, from free OpenStreetMap data, without touching the code. See [Using Custom Regions](#using-custom-regions).

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

### Auto Mode (Recommended)
- Uses online OpenStreetMap tiles by default
- **Automatically falls back** to offline tiles if online fails
- Best for normal operations with internet connectivity
- Seamlessly handles connectivity issues
- **Note**: The fallback only has somewhere to go when a tile server is running – both Docker
  stacks ship one, Railway does not

### Online Mode
- Always uses OpenStreetMap tiles
- Requires internet connectivity
- No fallback to offline tiles
- **The only option on Railway** (no tile server there)

### Offline Mode
- Always uses the local tile server
- Works completely offline
- Requires full offline tiles (via `just tiles-download`)
- Available on **both Docker stacks** – development and the Docker Compose production stack.
  Not on Railway.

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

### Which stack are you on?

Two stacks, two addresses – and every command in this section depends on which one you are
standing in front of. The **development** stack publishes the tile server directly on port 8080.
The **production** compose stack publishes no tile server port at all: Caddy is the single
origin, and it proxies `/tiles` to the tile server. So on a station box `localhost:8080` is
Caddy, not the tile server, and a command copied out of a development guide answers with the
wrong thing or nothing at all.

| | Development (`just dev`) | Production (`docker compose up -d`) |
|---|---|---|
| Health check | `http://localhost:8080/health` | `http://localhost:${HTTP_PORT:-8080}/tiles/health` |
| Tile server UI | `http://localhost:8080/` | `http://localhost:${HTTP_PORT:-8080}/tiles/` |
| Raster tiles | `http://localhost:8080/styles/basic-preview/512/{z}/{x}/{y}.png` | `http://localhost:${HTTP_PORT:-8080}/tiles/styles/basic-preview/512/{z}/{x}/{y}.png` |
| Vector tiles | `http://localhost:8080/data/basel-landschaft/{z}/{x}/{y}.pbf` | `http://localhost:${HTTP_PORT:-8080}/tiles/data/basel-landschaft/{z}/{x}/{y}.pbf` |
| Tile JSON | `http://localhost:8080/data/basel-landschaft.json` | `http://localhost:${HTTP_PORT:-8080}/tiles/data/basel-landschaft.json` |
| Container name | `kprueck-tileserver-dev` | `kp-rueck-tileserver-1` |

`HTTP_PORT` is what you set in `.env` (default 8080); with a `DOMAIN` set, the same paths work
over HTTPS on your hostname. `basel-landschaft` is `TILES_NAME` – substitute yours if you
changed it.

The rest of this page writes the address as `$BASE` and the container as `$TILESERVER`. Set both
once and everything afterwards works on either stack:

```bash
# The tile server container, whatever the stack called it
# (dev: kprueck-tileserver-dev, production: kp-rueck-tileserver-1)
TILESERVER=$(docker ps --format '{{.Names}}' | grep -E '^kp-?rueck[-_].*tileserver' | head -1)

# The address it answers on – try the dev port first, then production through Caddy
BASE=$(curl -sf http://localhost:8080/health > /dev/null && echo "http://localhost:8080" \
  || echo "http://localhost:${HTTP_PORT:-8080}/tiles")
```

This is the same detection `just tiles-status`, `scripts/download-tiles.sh` and
`scripts/install-tiles.sh` do for you. Those two scripts also honour `TILES_CONTAINER=<name>` if
your container is named something else entirely; here, just set `TILESERVER` by hand.

### Check Tile Server Status

```bash
# Detects the container and probes both addresses for you
just tiles-status

# Or by hand, with $BASE from above:
curl "$BASE/health"
```

Expected response: `{"status":"ok"}`

### View Tile Server UI

Open `$BASE` in a browser – http://localhost:8080/ on the development stack,
`http://localhost:${HTTP_PORT:-8080}/tiles/` on production.

You should see:
- TileServer GL interface
- "basel-landschaft" data source listed
- Preview map with tiles

### Test Tile Access

```bash
# Get a sample tile (zoom 10, Basel area)
curl "$BASE/data/basel-landschaft/10/533/357.pbf"

# Should return binary data (PBF format)
```

### Test in Application

1. Start the application (`just dev`, or `docker compose up -d` on a station)
2. Go to Settings → Map Mode
3. Select "Offline" mode
4. Navigate to Map view
5. Verify tiles load correctly

**One caveat when testing on the box itself**: the app derives the tile address from the address
you browse it at (`getTileBaseUrl` in `frontend/lib/env.ts`). Anything other than `localhost` or
`127.0.0.1` uses `/tiles` on its own origin, which is exactly what production serves. Open a
production stack by its hostname or LAN IP – at `http://localhost:8080` the map looks for the
tile server on the development port and finds Caddy instead.

## Tile Server Endpoints

The tile server provides the following endpoints. Paths are relative to `$BASE` – see
[Which stack are you on?](#which-stack-are-you-on) for what that is on your deployment.

### Raster Tiles (for Leaflet)
```
$BASE/styles/basic-preview/512/{z}/{x}/{y}.png
```

This is the one the map actually requests (`frontend/lib/hooks/use-map-mode.ts`).

### Vector Tiles (PBF)
```
$BASE/data/basel-landschaft/{z}/{x}/{y}.pbf
```

### Health Check
```
$BASE/health
```

### Tile JSON (metadata)
```
$BASE/data/basel-landschaft.json
```

## Updating Tiles

Tiles should be updated periodically to include new streets, buildings, and map changes.

**Recommended Update Frequency**: Every 3-6 months

**Update Process**:

1. Download new MBTiles file (following Option 1 or 2 above)
2. Backup current tiles:
   ```bash
   docker exec "$TILESERVER" cp /data/basel-landschaft.mbtiles /data/basel-landschaft.mbtiles.backup
   ```
3. Copy new tiles:
   ```bash
   docker cp basel-landschaft.mbtiles "$TILESERVER":/data/basel-landschaft.mbtiles
   ```
   Or let the script do steps 1–4 for you: `./scripts/install-tiles.sh <file>` finds the
   container itself.
4. Restart tile server:
   ```bash
   just tiles-restart
   ```
5. Verify new tiles work

## Troubleshooting

### Tile Server Not Starting

**Check logs**:
```bash
docker logs "$TILESERVER"
```

**Common issues**:
- Port conflict: on the development stack, ensure port 8080 is not in use by another service.
  Production publishes no tile server port, so the port to check there is `HTTP_PORT` (Caddy).
- Docker volume permission issues: on the development stack, `just dev-clean && just dev`.
  (`dev-clean` deletes the dev database and photos and asks first – it is not the station's
  board it touches, but read the prompt before you type `delete`.)
- Init script error: Check logs for sqlite3 or file system errors

**Note**: MBTiles and config are auto-created on startup, so missing files are not an issue.

### Tiles Not Loading in Application

**Check frontend console** for errors:
- Network errors: Tile server may not be running
- 404 errors: MBTiles file may be missing or misnamed
- Tile coordinate errors: Zoom level may be out of range (0-17)

**Verify tile server is accessible**:
```bash
curl "$BASE/health"
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
curl "$BASE/data/basel-landschaft.json" | jq .bounds
```

Expected bounds (Basel-Landschaft):
```json
[7.4, 47.4, 7.9, 47.7]
```

## Advanced Configuration

### Custom Config

There is no config file by default. `scripts/init-tileserver.sh` creates the MBTiles if it is
missing and then hands over to TileServer GL with no config at all, which makes it auto-detect
every `.mbtiles` in `/data` – which is why adding a region below needs no config edit.

> **Advanced, and ephemeral.** You *can* write a `/data/config.json` inside the running
> container:
>
> ```bash
> docker exec -it "$TILESERVER" vi /data/config.json   # lost on the next recreate
> ```
>
> but the next `docker compose up -d` that recreates the container replaces it – and after an
> update ("`docker compose pull && docker compose up -d`") that is exactly what happens. It is
> fine for trying something out, never as the way your station is configured. The durable path
> is the image: put the config next to `scripts/init-tileserver.sh`, copy it in from
> `tileserver/Dockerfile`, and build. A station that is not building its own images should not
> need this at all.

### Custom Styles

If you do keep a config (see the note above), custom map styles go in it:

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
   docker cp switzerland.mbtiles "$TILESERVER":/data/switzerland.mbtiles
   ```

2. Restart tile server: `just tiles-restart`

No config edit needed – with no config file, TileServer GL picks up every `.mbtiles` it finds in
`/data` and serves it under its filename.

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

**These are *vector* tiles, generated with planetiler – an order of magnitude smaller than the
raster tiles people expect.** The default region (Basel-Landschaft, zoom 0-17) produces a
**~12 MB** `.mbtiles` file. A whole country is in the low gigabytes, not the tens.

| Coverage (zoom 0-17) | Approximate size |
|----------------------|------------------|
| A district / canton (default: Basel-Landschaft) | **~12 MB** (measured) |
| All of Switzerland | low single-digit GB (estimate) |

**The generation is the expensive part, not the result.** `scripts/download-tiles.sh`
downloads ~500 MB of OSM data, needs ~2 GB of temporary disk and recommends 4 GB of RAM. On a
small station box, run the script on a laptop instead and copy the finished file in – see
[`DEPLOYMENT.md`](DEPLOYMENT.md) §0.

## Backup and Disaster Recovery

### Backup Tiles

```bash
# Backup to local filesystem
docker cp "$TILESERVER":/data/basel-landschaft.mbtiles ./backups/tiles-$(date +%Y%m%d).mbtiles
```

### Restore Tiles

```bash
# Restore from backup
./scripts/install-tiles.sh ./backups/tiles-20250101.mbtiles

# Or by hand:
docker cp ./backups/tiles-20250101.mbtiles "$TILESERVER":/data/basel-landschaft.mbtiles
just tiles-restart
```

### Not part of the nightly backup, on purpose

`scripts/backup.sh` covers the database and the photo volume and deliberately stops there: it
runs as a sidecar with no access to the docker socket, and tiles are *reproducible* – the same
`.mbtiles` comes back from `just tiles-download`, or from the copy on the laptop that generated
it. Keep that copy somewhere off the box and a lost tile volume costs one `install-tiles.sh`,
not an Einsatz.

## Technical Details

### Bootstrap Process

The `scripts/init-tileserver.sh` script runs on container startup and:

1. **Checks for existing tiles**: If `${TILES_NAME}.mbtiles` exists, skips creation
2. **Creates minimal MBTiles**: Uses sqlite3 to create valid MBTiles schema:
   - `metadata` table with required fields (name, type, version, format, bounds, etc.)
   - `tiles` table with proper schema (zoom_level, tile_column, tile_row, tile_data)
   - Unique index on tile coordinates
3. **Starts TileServer GL**: Hands over to the image's own entrypoint with no config file, so
   the server auto-detects whatever `.mbtiles` sits in `/data` and listens on port 8080

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

## Railway has no tile server – the Compose stack does

There are two supported deployments, and they differ on exactly this point.

**Docker Compose (the reference production stack) ships the tile server.** `docker-compose.yml`
runs `tileserver` as a first-class service on the `tiles` volume, and `deploy/Caddyfile` routes
`/tiles` to it on the same origin as everything else. Offline maps therefore work in production:
run `just tiles-download` (or copy an `.mbtiles` in with `scripts/install-tiles.sh`) against the
running stack, exactly as in development. Only the addresses differ – see
[Which stack are you on?](#which-stack-are-you-on).

If a station is picking between the two paths, this is one of the reasons to pick Compose: it is
the deployment that still shows a map when the internet is gone.

**Railway does not ship the tile server.** No tileserver service, no persistent tile volume, so
there is nothing for the app to fall back to:
- All maps use online OpenStreetMap tiles
- Map Mode should stay on "Online" (or "Auto", which then never finds a fallback)
- That is a deliberate trade: Railway means nobody has to look after a box, at the cost of the
  offline map

### If you need offline maps on Railway

1. Run the Docker Compose stack instead – it already has this, and it is the shorter path
2. Or use a managed tile host (Maptiler, Mapbox), or deploy TileServer GL separately with a
   persistent volume, and budget hosting + storage + bandwidth

> **Not** by setting `NEXT_PUBLIC_TILE_URL` on the running deployment. Every `NEXT_PUBLIC_*`
> value is inlined into the JavaScript at **build** time, and the published frontend image is
> built without station-specific ones on purpose – setting it on a deployment does nothing at
> all. Pointing the browser at a different tile host means rebuilding the image yourself, which
> a station should not be doing. The reason `/tiles` on the app's own origin is the supported
> route is precisely that it needs no rebuild.

## Using Custom Regions

The defaults cover Basel-Landschaft, because that is where the first station running KP Rück
sits. **Your region is configuration, not a code change** – set four environment variables and
run the same script. (Earlier versions of this page told you to edit `scripts/download-tiles.sh`
and named variables the script never had. Sorry.)

### Step 1: Find your extract on Geofabrik

Browse [download.geofabrik.de](https://download.geofabrik.de/) and take the **smallest** extract
that covers your area – a smaller extract means a much faster conversion. For example:

- Germany / Upper Bavaria: `https://download.geofabrik.de/europe/germany/bayern/oberbayern-latest.osm.pbf`
- Austria: `https://download.geofabrik.de/europe/austria-latest.osm.pbf`
- France / Alsace: `https://download.geofabrik.de/europe/france/alsace-latest.osm.pbf`

### Step 2: Find your bounding box

[boundingbox.klokantech.com](https://boundingbox.klokantech.com/) – draw a box around your
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
same coverage – nothing on the server remembers what you passed.

> **They do not belong in `.env`, and this is the one thing worth being pedantic about.**
> `scripts/download-tiles.sh` reads them from the shell it is started in; it only reaches into
> `.env` for `DOMAIN` and `HTTP_PORT`, so that its readiness probe at the end knows where to
> look. Set `TILES_BOUNDS` in `.env` and nothing errors – the next `just tiles-download` simply
> spends fifteen minutes generating Basel-Landschaft, and you find out when the map is blank
> outside a canton you do not serve. `.env.example` documents the four for exactly this reason:
> so the station that goes looking finds them, and finds them with this caveat attached.

### The filename is a separate decision

`TILES_NAME` (default `basel-landschaft`) is the name of the `.mbtiles` file on the tileserver
volume, not part of the geography above. Three places must agree on it:
`scripts/download-tiles.sh`, `scripts/install-tiles.sh`, and `scripts/init-tileserver.sh` – all
three read the same variable, and the tileserver container needs it in its environment too.

This one **is** an `.env` variable, unlike the four above: `docker-compose.yml` passes it into
the tileserver container from there, and `just doctor` / `just tiles-status` read it from the
same file to tell real tiles apart from the bootstrap placeholder. It is documented in
`.env.example`, commented out at its default.

**An existing deployment should leave it alone.** Its tiles are already on the volume under the
default name, and renaming means the init script finds nothing and quietly writes a bootstrap
file instead – a map that looks like it works and has no tiles in it. Only worth setting on a
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
2. Review tile server logs: `docker logs "$TILESERVER"` (see [Which stack are you on?](#which-stack-are-you-on))
3. Verify tile server status: `just tiles-status`
4. Open an issue on GitHub with logs and error messages

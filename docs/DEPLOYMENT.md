# Deployment (self-hosting)

How to run KP Rück on your own machine – a station VPS, a box in the Gerätehaus, anything with
Docker. For the managed-PaaS route see [`RAILWAY.md`](RAILWAY.md); this guide covers the
docker-compose stack, which is the path published releases are built for.

Nothing here requires a build toolchain: the stack pulls published images from GHCR.

## 0. What machine do I need

Less than people expect. KP Rück is one station's board, not a multi-tenant service: a handful
of concurrent operators, a database measured in tens of megabytes, and no video, no analytics,
no search cluster.

| | Minimum | Recommended |
| --- | --- | --- |
| CPU | 2 cores, x86-64 or arm64 | 4 cores |
| RAM | **2 GB** | **4 GB** (8 GB if you generate map tiles on this machine, or run KP Front alongside) |
| Disk | 32 GB **SSD** | 128 GB SSD |
| Network | wired Ethernet | wired Ethernet + a UPS |
| OS | anything with Docker Engine + Compose v2 | Debian 12/13 |

**Both architectures are published.** Every image (`backend`, `frontend`, `tileserver`,
`print-agent`) is built for `linux/amd64` **and** `linux/arm64`, so a mini PC, a retired
laptop, an ARM VPS or a Raspberry Pi 5 all work. 32-bit ARM (armv7, e.g. Raspberry Pi 3 or a
Pi 4 running a 32-bit OS) is **not** built and will not run — if you use a Pi, install a
64-bit OS.

### Where the numbers come from

Measured on a running stack (resident memory per container):

| Service | Memory |
| --- | --- |
| `backend` (FastAPI/uvicorn) | ~200 MB |
| `db` (postgres:16-alpine) | ~130 MB |
| `tileserver` | ~75 MB |
| `frontend` (Next.js, `next start`) | ~300 MB |
| `caddy` | ~30 MB |

That is well under 1 GB in total, which is why 2 GB is a real minimum rather than an
optimistic one — the rest is headroom and page cache, and Postgres benefits from the cache
more than from anything else you could spend the RAM on.

Disk, likewise, is dominated by things that do not grow:

- container images: budget **5 GB**
- database: **61 MB** on a seeded install; incidents and personnel are text rows, so this
  grows slowly enough to ignore for years
- map tiles: **~12 MB** for a canton-sized region — these are *vector* tiles, not images
- **photos are the only thing that really grows** (Reko photos, see
  [`PHOTO_STORAGE.md`](PHOTO_STORAGE.md)); size this from how your station actually uses them

### The one peak: generating map tiles

`scripts/download-tiles.sh` is the only step that wants a real machine — roughly **500 MB of
OSM data downloaded, ~2 GB of temporary disk, and 4 GB of RAM recommended**. The *result* is
a ~12 MB file.

So on a small box, do not build tiles on the box. Run the script on a laptop and copy the
finished `.mbtiles` into the tileserver volume (see [`OFFLINE_MAPS.md`](OFFLINE_MAPS.md)).
Tiles are optional in any case; without them the map uses online OpenStreetMap.

### Storage endurance matters more than storage speed

Use an SSD — SATA, NVMe or eMMC. **Do not run the system on a microSD card or a USB stick.**
Postgres writes continuously even on an idle board (WAL, autovacuum, checkpoints), and flash
without wear levelling worth the name fails by silent corruption rather than by stopping,
which is the worst failure mode for the machine your command post depends on. This is the
single most common way a cheap self-hosted box dies, and it is entirely avoidable.

If the machine sits in the Gerätehaus, put it on a **UPS** together with the switch and access
point. Without one, a power blip takes the board with it — see
[`AUSFALL_SOP.md`](AUSFALL_SOP.md), which treats the station box as the single point it all
hangs on.

### Two applications on one host

KP Front is roughly half this footprint (one image serving a static SPA plus its API, and its
own Postgres). Both stacks on one machine fit comfortably in 4 GB and are more comfortable in
8 GB — but they collide on ports and environment-variable names, so read
[`RUNNING-BOTH.md`](RUNNING-BOTH.md) before you start.

### What it does not need

No Kubernetes, no cluster, no load balancer, no GPU, no Redis, no object storage, no CDN. One
station, one box, one `docker compose up`. If you are sizing this like a web service, you are
sizing it wrong.

## 1. What runs

| Service | Image | Role |
| --- | --- | --- |
| `db` | `postgres:16-alpine` | The database. Bundled. To use a managed Postgres you must edit `docker-compose.yml` — the backend's `DATABASE_URL` is composed there from the `POSTGRES_*` values, so setting `DATABASE_URL` in `.env` has no effect. |
| `backend` | `ghcr.io/feuerwehr-oberwil/kp-rueck-backend` | FastAPI: API, WebSocket board updates, integrations. Runs migrations and seeding on boot. |
| `frontend` | `ghcr.io/feuerwehr-oberwil/kp-rueck-frontend` | The Next.js dashboard. |
| `tileserver` | `ghcr.io/feuerwehr-oberwil/kp-rueck-tileserver` | Offline map tiles (see [`OFFLINE_MAPS.md`](OFFLINE_MAPS.md)). |
| `caddy` | `caddy:2-alpine` | The single origin in front of everything, with automatic HTTPS. |
| `print-agent` | `ghcr.io/feuerwehr-oberwil/kp-print-agent` | Optional thermal printer relay (`--profile printing`), also built for arm64 so it runs on a Pi. |

**Everything is served through one origin.** Caddy routes `/socket.io` and `/api` to the
backend, `/tiles` to the tileserver, and everything else to the frontend. That is what keeps
the published frontend image generic – the browser only ever talks to its own host, so no
station's URL is baked into the image at build time. Cross-origin requests are therefore not part of normal operation — but `CORS_ORIGINS` must still match the URL the browser actually uses, or the API refuses the browser's calls (see [`SETUP.md`](SETUP.md) §7).

## 2. Quick start

```bash
# 1. Get the compose file + templates (a tagged release is the safe choice, not main)
git clone https://github.com/feuerwehr-oberwil/kp-rueck.git && cd kp-rueck
git checkout "$(git tag -l 'v*' --sort=-v:refname | head -n1)"   # newest release; pick an older tag if you prefer

# 2. Configure
cp .env.example .env
#    Required (all five – compose refuses to start if any is unset OR empty):
#      POSTGRES_PASSWORD, SECRET_KEY, AUTH_SECRET_KEY, ADMIN_SEED_PASSWORD, VIEWER_PASSWORD
#      SECRET_KEY / AUTH_SECRET_KEY: openssl rand -hex 32  (KEEP THEM STABLE)
#      ADMIN_SEED_PASSWORD: at least 12 characters – this is your first login
#      VIEWER_PASSWORD:     at least 12 characters – the read-only/kiosk login
#    For HTTPS: set DOMAIN to a hostname whose A/AAAA record points here, and
#    CORS_ORIGINS to https://<that domain>.

# 3. Start
docker compose up -d           # add --profile printing if you use the thermal printer

# 4. Log in as `admin` with ADMIN_SEED_PASSWORD, then change it.
```

On a LAN with no domain, leave `DOMAIN` empty: Caddy serves plain HTTP on `HTTP_PORT`
(default 8080), `CORS_ORIGINS` should be `http://<host>:8080`, and you **must** also set
`AUTH_COOKIE_SECURE=false`. Browsers refuse to send a `Secure` cookie over plain HTTP, so
without it the login cookie is silently dropped and signing in fails with no visible error.
Only do this on a network you trust – never on an internet-facing deployment.

**Production hardening is automatic** under compose: the stack sets `ENVIRONMENT=production`,
which makes the secrets mandatory (no per-restart `SECRET_KEY`), forbids the development auth
bypass, keeps sample incidents off the board, and refuses to seed a shared `editor` login.
Real editors come from SSO or are created by the admin.

## 3. Which version am I running?

`KP_RUECK_TAG` in `.env` selects the images. All four services share one tag – a station runs a
matched set, never a mix.

| Value | Follows | For |
| --- | --- | --- |
| `X.Y.Z` (a full version) | nothing – exactly this build | production stations that update deliberately |
| `X.Y` (a series) | patch releases in that series | stations that want fixes but not features |
| `latest` (default) | every release | evaluation, demo instances |

Which versions exist is the [releases page](https://github.com/feuerwehr-oberwil/kp-rueck/releases);
`latest` is the newest *release*, never `main`.

## 4. Updating

```bash
docker compose pull
docker compose up -d
```
Pinned to a version? Edit `KP_RUECK_TAG` first, then run the two commands. Release notes:
<https://github.com/feuerwehr-oberwil/kp-rueck/releases>.

**What the version number tells you** (full table at the top of [`../CHANGELOG.md`](../CHANGELOG.md)):
a **PATCH** bump is fixes only and always safe; a **MINOR** bump adds features and migrates
automatically; a **MAJOR** bump needs you to read the notes first, because something requires
operator action.

- Database migrations run **automatically on boot** (`start.sh` → `alembic upgrade head`).
- **Rollback:** set `KP_RUECK_TAG` to the previous version and re-run the two commands.
  Migrations are kept backward-safe within a minor series.
- **Postgres major upgrades** (e.g. 16→17) are *not* automatic – a 16 data volume won't be read
  by a 17 server. Stay on `postgres:16` for the life of the volume; to move majors, take a dump,
  start a fresh volume on the new major, and restore.

## 5. Building from source instead

For contributors or a patched fork: comment out the `image:` line on the service in
`docker-compose.yml`, uncomment the `build:` block underneath it, and use
`docker compose up -d --build`. For day-to-day development use the hot-reload stack instead –
`just dev` (`docker-compose.dev.yml`).

## 6. Backups

Back up **two** things together, from the same moment:

```bash
./scripts/backup.sh /var/backups/kp-rueck        # or: just backup
```

That writes `db-<stamp>.sql.gz` and `photos-<stamp>.tar.gz` and keeps the newest 14 of each
(`BACKUP_KEEP` to change that). Daily from cron on the docker host:

```cron
30 3 * * * cd /opt/kp-rueck && ./scripts/backup.sh /var/backups/kp-rueck >> /var/log/kp-rueck-backup.log 2>&1
```

Both halves matter. The database holds the operational record; the `photos` volume holds Reko
photos, which are **not** in the database. A dump without the volume restores a complete record
pointing at missing images.

Keep `SECRET_KEY` and `AUTH_SECRET_KEY` with the backup – restoring a database with different
secrets logs everyone out and invalidates issued tokens.

### 6.1 Restore

Restoring replaces everything. Do it on a **fresh stack** first – see the drill below.

```bash
# 1. Stop the app, leave the database running (it is the thing being restored INTO).
docker compose stop backend frontend

# 2. Drop and recreate the database, so the restore starts from nothing rather than
#    merging into whatever is there.
docker compose exec -T db psql -U kprueck -d postgres \
  -c "DROP DATABASE IF EXISTS kprueck;" -c "CREATE DATABASE kprueck OWNER kprueck;"

# 3. Restore the dump.
gunzip -c db-2026-07-29-033000.sql.gz | docker compose exec -T db psql -U kprueck -d kprueck

# 4. Restore the photos into the volume, through the backend container that mounts it.
docker compose start backend
docker compose exec -T backend sh -c 'rm -rf /mnt/data/photos/* && tar xzf - -C /mnt/data/photos' \
  < photos-2026-07-29-033000.tar.gz

# 5. Bring everything back up. Migrations run on boot, so a dump from an OLDER version is
#    upgraded automatically; a dump from a NEWER version is not — match or exceed its tag.
docker compose up -d
```

Then check: log in, open an incident that had photos, and confirm the images load.

### 6.2 The drill

Do this **once before you go live**, and after any change to how you back up:

1. Copy a real backup pair onto a machine that is not the station's server.
2. `git clone` the repository there, `cp .env.example .env`, and fill in the five secrets –
   including the **same** `SECRET_KEY` and `AUTH_SECRET_KEY` as the backup.
3. `docker compose up -d`, wait for it to come up, then run the restore above.
4. Log in and check the board, one incident with photos, and the Einsatztagebuch export.
5. `docker compose down -v` to throw the test stack away.

If step 4 shows what you expect, the backup is real. Until you have done it once, it is a
guess – which is the only reason this section exists at a length nobody wants to read.

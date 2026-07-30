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

- Database migrations run **automatically on boot** (`start.sh` → `alembic upgrade head`), and a
  **snapshot is taken first** whenever there is actually a migration pending: `pg_dump -Fc` into
  the `premigration` volume (`/mnt/data/backups` in the container), newest 5 kept. It is
  deliberately best-effort — if it cannot be written the boot logs `WARNING: … migrating anyway,
  with no way back` and continues, because a board that is down is worse than a migration without
  a snapshot. Watch for that line in `docker compose logs backend` after an update. Turn it off
  with `PREMIGRATION_BACKUP=false`; it is not a substitute for §6 and holds no photos.
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

Turn the nightly backup on. It is off by default only because it writes to a path on **your**
host and nobody else can pick that path for you:

```bash
# In .env — where the files land, and when
BACKUP_HOST_DIR=/var/backups/kp-rueck
BACKUP_AT=03:30

docker compose --profile backup up -d
```

That starts a small sidecar which, every night, writes **two** files from the same moment into
`$BACKUP_HOST_DIR/daily/`:

```
daily/db-2026-07-30-033000.dump        # pg_dump -Fc, verified readable
daily/photos-2026-07-30-033000.tar.gz  # the Reko photo volume
weekly/db-2026-W31.dump                # first backup of the ISO week, hardlinked
last-backup.json                       # what happened, machine-readable
```

Both halves matter. The database holds the operational record; the `photos` volume holds Reko
photos, which are **not** in the database. A dump without the volume restores a complete record
pointing at missing images.

**Retention: 14 daily, 8 weekly** (`BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY`). Two series
because they answer two different questions. Fourteen dailies is "undo last night" with enough
slack for a brigade that has no daily operator — damage done at a Saturday exercise can go
unnoticed until the drill after next. Eight weeklies (~2 months) is "someone imported the wrong
roster five weeks ago": quiet damage that is noticed when a report gets written, not when it
happens. Weeklies are hardlinks, so they cost nothing until the daily beneath them is pruned.
The dumps are small — single-digit MB for a station — so the photos decide your disk usage.

**It is loud when it cannot do its job.** A backup script that can silently do nothing is worse
than none, so every run either produces two verified files or leaves evidence: a `BACKUP-FAILED`
marker in the directory, a `"status": "failed"` in `last-backup.json` naming the stage, and a
failing container healthcheck. Which means the honest check is one command:

```bash
docker compose ps backup          # "healthy" = last night's backup ran and succeeded
cat /var/backups/kp-rueck/last-backup.json
```

`unhealthy` means the last backup failed **or** is more than 26 hours old. Look at
`docker compose logs backup` — the common causes are a full disk, a backup directory the
container cannot write to, and a Postgres client older than the server (see below).

Take one out of band, before an update you are not sure about:

```bash
just backup /var/backups/kp-rueck
```

**Off the box.** Everything above is still on the machine whose failure is the reason you are
reading this section. Copy `$BACKUP_HOST_DIR` somewhere else — a NAS mount, `rsync` to another
host, a bucket, an external disk that lives in a different room. The files are plain and self
contained; nothing about the restore below needs the tool you used to move them. If you encrypt
them, keep the passphrase somewhere that is *not* only on this box.

Keep `SECRET_KEY` and `AUTH_SECRET_KEY` with the backup – restoring a database with different
secrets logs everyone out and invalidates issued tokens.

**Postgres client version.** `pg_dump` refuses to dump a server newer than itself ("aborting
because of server version mismatch"), so the backup runs from `BACKUP_PG_IMAGE`, which defaults
to the same major as the `db` service. If you ever move the database to a newer major, move that
variable in the same change. The script checks the two versions before it does anything and
fails with the exact remedy rather than an obscure error.

**One known limit, named rather than fixed:** the dump and the photo tarball are taken seconds
apart. A photo uploaded in between yields a database row whose file is not in the tarball. It is
rare, it heals with the next night's backup, and the alternative — stopping the stack every
night — costs a brigade more than it returns.

### 6.1 Restore

Restoring replaces everything. Do it on a **fresh stack** first – see the drill below.

```bash
# 1. Stop the app, leave the database running (it is the thing being restored INTO).
docker compose stop backend frontend

# 2. Drop and recreate the database, so the restore starts from nothing rather than
#    merging into whatever is there. (restore.sh refuses a database that still has tables —
#    this line is deliberately typed by a human.)
docker compose exec -T db psql -U kprueck -d postgres \
  -c "DROP DATABASE IF EXISTS kprueck;" -c "CREATE DATABASE kprueck OWNER kprueck;"

# 3. Restore the dump. Checks the archive is readable and the server is not older than the
#    dump's client before it writes anything.
just restore /var/backups/kp-rueck/daily/db-2026-07-30-033000.dump

# 4. Restore the photos into the volume, through the backend container that mounts it writable
#    (the backup sidecar mounts it read-only on purpose).
docker compose start backend
docker compose exec -T backend sh -c 'rm -rf /mnt/data/photos/* && tar xzf - -C /mnt/data/photos' \
  < /var/backups/kp-rueck/daily/photos-2026-07-30-033000.tar.gz

# 5. Bring everything back up. Migrations run on boot, so a dump from an OLDER version is
#    upgraded automatically; a dump from a NEWER version is not — match or exceed its tag.
docker compose up -d
```

Then check: log in, open an incident that had photos, and confirm the images load.

**Without this repository, on someone else's machine.** The restore must not depend on our
tooling — you may have the files and a borrowed laptop and nothing else. `-Fc` dumps are read by
stock `pg_restore`:

```bash
createdb kprueck
pg_restore --dbname kprueck --no-owner --no-privileges db-2026-07-30-033000.dump
tar xzf photos-2026-07-30-033000.tar.gz -C /wherever/photos
```

The client must be at least as new as the server you restore into. The quickest way to get a
matching one without installing anything:

```bash
docker run --rm -v "$PWD:/b" -e PGPASSWORD=… postgres:17-alpine \
  pg_restore -h HOST -U kprueck -d kprueck --no-owner --no-privileges /b/db-…dump
```

Because this is a dump and not a copied data directory, it restores across architectures and
operating systems — a macOS or WSL laptop standing in for the station's Linux server is the
case this is built for. Do not "optimise" the backup into a volume snapshot; that would take the
capability away.

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

For step 4 by eye plus a number: `scripts/db-fingerprint.sh` prints an exact row count for every
table, a few real values and the schema revision. Run it against the station and against the
restored copy and `diff` the two – identical output means identical data, which "the restore
finished without errors" does not.

**What CI already does for you, and what it cannot.** The `restore-drill` workflow runs this
whole cycle every Monday – seed, dump with the real `scripts/backup.sh`, restore into a fresh
empty database, diff the fingerprints, and check the restored database still migrates forward.
So the *file format and the procedure* are continuously proven. What it cannot touch is your
box: volumes, permissions, disk space, the real photo files, and whether the copy that left the
building is actually readable. That is what this drill is for, and why it stays half-yearly work
for a human.

---

## 7. Knowing it broke before you need it

Everything above is a check you have to remember to run. That is the gap: without the five
minutes in this section, the way a station discovers the system is down is an operator opening
the board during an Einsatz. Discovery is entirely reactive, and the one moment it fails is the
one moment nobody has a spare hand.

The backend already publishes what a monitor needs. `/health` runs a real `SELECT 1` against
the database and answers **503** when it cannot (`backend/app/api/health.py`), and Caddy already
exposes it on your domain. Nothing needs building — only pointing at.

**Set this up once.** Any free uptime service will do (Uptime Kuma if you self-host, or a hosted
one — the choice matters far less than having one):

```
URL:       https://<your domain>/health
Interval:  5 minutes
Healthy:   HTTP 200
Alert:     after 2 consecutive failures, to a phone that is not in the server room
```

Two consecutive failures rather than one: a single miss during a reboot or an update is normal,
and a monitor that cries wolf gets muted, at which point you are back where you started.

**What this catches:** the backend process dead or crash-looping, Postgres unreachable, Caddy
down, the host down, an expired certificate, a broken DNS record. In other words most of the
ways the whole thing stops.

**What it does not catch** — worth knowing, so it is not trusted for more than it is:

| Not covered | Check instead |
|---|---|
| Backups failing | `docker compose ps backup` (§6) — a separate signal, deliberately |
| Disk filling up | Nothing yet, and a full disk stops Postgres writing. Watch it. |
| Print agent dead / printer offline | The board's own print status (`docs/PRINT_AGENT.md`) |
| Tile server down | Map only; the board is unaffected |

### The caveat that matters on a station box

An external monitor answers *"can the internet reach this?"* — which on a compose deployment is
**not** the same question as *"does the board work in the station."* That stack is deliberately
built to survive an uplink outage: if your internet drops, the board, the map and the printer
keep working on the LAN, and the monitor will alert anyway. The alert is not wrong, it is
answering a different question. Read it as "the outside world lost us", then check the board
locally before assuming an outage.

The mirror image also holds: a station on a LAN-only deployment, with no public domain, cannot
be watched from outside at all. There, run the monitor **inside** the network — Uptime Kuma on
any always-on box on the same LAN, pointed at the stack's local address. That gives a real
answer for the deployment where an external check has none.

On Railway the distinction collapses: no internet means no application at all, so the external
check and the real question are the same thing.

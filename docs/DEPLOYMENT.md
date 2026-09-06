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
Pi 4 running a 32-bit OS) is **not** built and will not run – if you use a Pi, install a
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
optimistic one – the rest is headroom and page cache, and Postgres benefits from the cache
more than from anything else you could spend the RAM on.

Disk, likewise, is dominated by things that do not grow:

- container images: budget **5 GB**
- database: **61 MB** on a seeded install; incidents and personnel are text rows, so this
  grows slowly enough to ignore for years
- map tiles: **~12 MB** for a canton-sized region – these are *vector* tiles, not images
- **photos are the only thing that really grows** (Reko photos, see
  [`PHOTO_STORAGE.md`](PHOTO_STORAGE.md)); size this from how your station actually uses them

### The one peak: generating map tiles

`scripts/download-tiles.sh` is the only step that wants a real machine – roughly **500 MB of
OSM data downloaded, ~2 GB of temporary disk, and 4 GB of RAM recommended**. The *result* is
a ~12 MB file.

So on a small box, do not build tiles on the box. Run the script on a laptop and copy the
finished `.mbtiles` into the tileserver volume (see [`OFFLINE_MAPS.md`](OFFLINE_MAPS.md)).
Tiles are optional in any case; without them the map uses online OpenStreetMap.

### Storage endurance matters more than storage speed

Use an SSD – SATA, NVMe or eMMC. **Do not run the system on a microSD card or a USB stick.**
Postgres writes continuously even on an idle board (WAL, autovacuum, checkpoints), and flash
without wear levelling worth the name fails by silent corruption rather than by stopping,
which is the worst failure mode for the machine your command post depends on. This is the
single most common way a cheap self-hosted box dies, and it is entirely avoidable.

If the machine sits in the Gerätehaus, put it on a **UPS** together with the switch and access
point. Without one, a power blip takes the board with it – see
[`AUSFALL_SOP.md`](AUSFALL_SOP.md), which treats the station box as the single point it all
hangs on.

### Two applications on one host

KP Front is roughly half this footprint (one image serving a static SPA plus its API, and its
own Postgres). Both stacks on one machine fit comfortably in 4 GB and are more comfortable in
8 GB – but they collide on ports and environment-variable names, so read
[`RUNNING-BOTH.md`](RUNNING-BOTH.md) before you start.

### What it does not need

No Kubernetes, no cluster, no load balancer, no GPU, no Redis, no object storage, no CDN. One
station, one box, one `docker compose up`. If you are sizing this like a web service, you are
sizing it wrong.

## 1. What runs

| Service | Image | Role |
| --- | --- | --- |
| `db` | `postgres:16-alpine` | The database. Bundled. To use a managed Postgres you must edit `docker-compose.yml` – the backend's `DATABASE_URL` is composed there from the `POSTGRES_*` values, so setting `DATABASE_URL` in `.env` has no effect. |
| `backend` | `ghcr.io/feuerwehr-oberwil/kp-rueck-backend` | FastAPI: API, WebSocket board updates, integrations. Runs migrations and seeding on boot. |
| `frontend` | `ghcr.io/feuerwehr-oberwil/kp-rueck-frontend` | The Next.js dashboard. |
| `tileserver` | `ghcr.io/feuerwehr-oberwil/kp-rueck-tileserver` | Offline map tiles (see [`OFFLINE_MAPS.md`](OFFLINE_MAPS.md)). |
| `caddy` | `caddy:2-alpine` | The single origin in front of everything, with automatic HTTPS. |
| `print-agent` | `ghcr.io/feuerwehr-oberwil/kp-print-agent` | Optional thermal printer relay – add `printing` to `COMPOSE_PROFILES` in `.env`. Also built for arm64 so it runs on a Pi. |

**Everything is served through one origin.** Caddy routes `/socket.io` and `/api` to the
backend, `/tiles` to the tileserver, and everything else to the frontend. That is what keeps
the published frontend image generic – the browser only ever talks to its own host, so no
station's URL is baked into the image at build time. Cross-origin requests are therefore not part of normal operation – but `CORS_ORIGINS` must still match the URL the browser actually uses, or the API refuses the browser's calls (see [`SETUP.md`](SETUP.md) §7).

### Address lookup

The backend handles address suggestions and reverse lookup for logged-in board users and
claimed field devices. Configure it in `.env` for Compose, or in the backend service's
environment on a managed host:

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEOCODING_PROVIDER` | `swisstopo` | Swiss locations via `api3.geo.admin.ch`; `disabled` turns these lookups off; `nominatim` selects the service below. |
| `GEOCODING_NOMINATIM_URL` | empty | With `nominatim`, the base URL of a service you operate or one whose usage terms permit this application. |

Use a base URL such as `https://geocoder.example.ch`, without `/search`, `/reverse`, embedded
credentials, query parameters or a fragment. The public `nominatim.openstreetmap.org` service
is rejected, and the backend does not follow redirects. Apply environment changes by recreating
the backend during your normal maintenance window. No frontend rebuild is required.

The provider receives search text or coordinates and the backend's public IP address; browser
login and field credentials stay at your backend. Lookups share a small request budget across
workers and a five-minute cache per worker. When lookup is busy, unavailable or disabled,
operators can still enter an address or coordinates and place a point on the map. Online map
tiles are a separate setting. See [privacy](../PRIVACY.md#online-services-and-integrations).

## 2. Quick start

```bash
# 1. Clone it, and KEEP the clone – docker-compose.yml mounts ./deploy/Caddyfile and ./scripts
#    out of it. A tagged release is the safe choice, not main.
git clone https://github.com/feuerwehr-oberwil/kp-rueck.git && cd kp-rueck
git checkout vX.Y.Z   # choose a published release from the releases page; replace X.Y.Z

# 2. Configure. `just init` asks three questions (two passwords, do you have a domain) and
#    writes a complete .env – secrets generated, DOMAIN/HTTP_PORT/CORS_ORIGINS derived.
just init

# 3. Start. `just up` waits for the backend to answer and prints the URL.
just up                        # = docker compose up -d, then waits and prints the URL
                               # Printing? Add it to COMPOSE_PROFILES in .env
                               # (backup,printing) – NOT with --profile on the command
                               # line, which replaces the list and drops the backup
                               # sidecar. See docs/PRINT_AGENT.md.

# 4. Check it, then log in as `admin` with ADMIN_SEED_PASSWORD and change it.
just doctor
```

By hand instead of `just init`: `cp .env.example .env` and fill in the five values compose
refuses to start without – `POSTGRES_PASSWORD`, `SECRET_KEY`, `AUTH_SECRET_KEY` (both
`openssl rand -hex 32`, both **stable forever**), `ADMIN_SEED_PASSWORD` and `VIEWER_PASSWORD`
(≥12 characters each). Then the three networking lines: for HTTPS, `DOMAIN` = a hostname whose
A/AAAA record points here, `HTTP_PORT=80`, `CORS_ORIGINS=https://<that domain>`.

**The first boot takes two to three minutes** – image pulls, migrations and seeding all run
before the backend answers anything, which is why its healthcheck has a 90-second grace period.
`just up` waits it out and prints progress; later starts are quick.

On a LAN with no domain, leave `DOMAIN` empty: Caddy serves plain HTTP on `HTTP_PORT`
(default 8080) and `CORS_ORIGINS` should be `http://<host>:8080`. You do **not** need to set
`AUTH_COOKIE_SECURE` – the backend reads that same origin, sees plain `http://`, and sends the
login cookie without the `Secure` flag that browsers would otherwise refuse to return. It logs a
warning saying so, which is correct: this is only acceptable on a network you trust, never on an
internet-facing deployment.

**Production hardening is automatic** under compose: the stack sets `ENVIRONMENT=production`,
which makes the secrets mandatory (no per-restart `SECRET_KEY`), forbids the development auth
bypass, keeps sample incidents off the board, and refuses to seed a shared `editor` login.
Real editors come from SSO or are created by the admin.

## 3. Which version am I running?

`KP_RUECK_TAG=X.Y.Z` in `.env` selects the exact version of all four application images.
Fresh launchers and `just init` derive that pin from the complete release's
`frontend/package.json`; `.env.example` carries the same version. The launchers refuse a missing,
moving (`latest` or `X.Y`), or mismatched pin. Normal starts reuse cached images and download only
missing ones. They do not upgrade the installation.

Choose a **published release** from the [releases page](https://github.com/feuerwehr-oberwil/kp-rueck/releases).
A tag or `main` source ZIP alone is not proof that its image builds have finished. Moving tags
remain available in the registry for technical use, but do not keep local Compose/deploy files
in sync and are not the station launcher update path.

## 4. Updating

An upgrade consists of the **complete release files plus all matching images**, with a verified
backup first. Never update images alone while keeping old Compose, Caddy or scripts files.

1. Read the target release notes and choose a published `X.Y.Z`. Schedule downtime, stop new
   operational writes, and take and verify a database **and photos** backup (§6). Keep a private
   copy of `.env` and the complete old release for recovery.
2. Preserve the **existing installation directory and Compose project identity**. Docker volume
   names depend on that project. Do not start the newly unzipped version in a differently named
   folder. Keep any existing `COMPOSE_PROJECT_NAME` or explicit `-p` choice unchanged; a deployment
   using `-p` must continue using that same option rather than switching to a plain launcher.
3. Install all files from the target release into that existing directory, including
   `docker-compose.yml`, `deploy/`, `scripts/` and `frontend/package.json`. Keep `.env`, backups,
   local data and operator configuration. Review custom Compose overrides against the new release.
   For a Git checkout, fetch tags and explicitly `git checkout vX.Y.Z` after preserving local
   customizations. Do not use `git pull` on `main` as an operational upgrade.
4. Edit **only** `KP_RUECK_TAG=X.Y.Z` in the existing `.env` to match the target release. Keep its
   secrets and other settings; do not replace it with `.env.example` or regenerate it. Ensure an
   exported `KP_RUECK_TAG` does not override this pin if using Compose directly.
5. Download the complete image set before restarting: `docker compose pull` from that directory.
   If it fails, resolve the download first; do not start a partly available upgrade. Then run
   `docker compose up -d --pull never --no-build` (or the matching launcher after a successful
   pull). Verify health, login, an incident with photos, board updates and printing if enabled.

**Existing installation with `latest`, `X.Y`, or no pin:** the launcher stops without changing
`.env` or the running stack. First identify the actual running application version (the image label
`org.opencontainers.image.version` on each running application container) and obtain that complete published
release. Set its exact `KP_RUECK_TAG` to keep running it, or deliberately follow the upgrade steps
above for a newer release. Never replace a moving tag with the version from an arbitrary source
folder: that could downgrade a newer database. Rollback after a migration requires the restore
procedure below. This read-only command lists names, image references and release labels without
needing Compose to parse the old `.env`:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Label "org.opencontainers.image.version"}}'
```

**What the version number tells you** (full table at the top of [`../CHANGELOG.md`](../CHANGELOG.md)):
a **PATCH** bump contains fixes; a **MINOR** bump adds features and migrates automatically;
a **MAJOR** bump requires operator action. Read the release notes and take a verified backup
before any operational upgrade; version numbering is not a recovery guarantee.

**One-time security reset:** when upgrading from a release without versioned credentials,
operators must sign in again, field devices must re-enter the Feld-Code and select a person,
and existing Reko form links must be replaced. Printed field poster links still work. The
migration preserves accounts, reports, photos and claim history; no signing-secret rotation
is required. Routine restarts and later upgrades do not repeat the reset.

- Database migrations run **automatically on boot** (`start.sh` → `alembic upgrade head`). A
  nonempty database with pending migrations requires a readable `pg_dump -Fc` snapshot in the
  `premigration` volume (`/mnt/data/backups`), newest 5 kept. Failure to determine the revision,
  write the dump or verify the archive **stops the boot before migrating**. Fix the cause and
  retry; a restart already at the known head and a fresh empty database need no snapshot.
  `PREMIGRATION_BACKUP=false` is an explicit technical-operator override after arranging another
  verified backup. The snapshot contains no photos and does not replace §6.
- **Rollback after a migration needs a matching database restore.** Changing only the image tag
  is insufficient: an older image cannot resolve a revision introduced by a newer image, even
  when that migration only added columns. Use the procedure below.
- **Postgres major upgrades** (e.g. 16→17) are *not* automatic – a 16 data volume won't be read
  by a 17 server. Stay on `postgres:16` for the life of the volume; to move majors, take a dump,
  start a fresh volume on the new major, and restore.

### 4.1 Recovering the previous release

Before upgrading, stop application writers and take a database **and photo** backup (§6), then
keep the previous complete release folder and a protected copy of its `.env`. Record the exact
image version and database revision alongside that backup. Leave the PostgreSQL major version
unchanged during an application upgrade.

If the new release cannot be used:

1. Stop `backend`, `frontend`, `backup` and `print-agent`. Keep the database running. Preserve
   the failed release's database and photos separately if they contain writes you need later.
2. Select the previous release's **deployment files and exact image tag**. Keep the same Compose
   project name, database/photo volumes and original secrets; a new folder name otherwise
   selects different default volumes.
3. Follow §6.1 to restore the matching pre-upgrade database and photo pair while the application
   stays stopped. The old database revision must belong to that previous release's migration
   tree. Do not start the old backend against the newer database or guess an Alembic downgrade.
4. Start that complete release and verify login, one incident with photos, board updates and an
   export before returning to operational use.

**Restoring discards writes made after the chosen backup**, including incidents, assignments,
reports and photo changes. Reconcile any needed later records from the separately preserved copy
with a technical operator. The automatic pre-migration database dump alone has no matching photo
snapshot and is not a complete rollback backup.

Release publication first builds all exact-version images, then promotes moving tags. Promotion
across separate image repositories is **not atomic**; a registry failure can interrupt it. Use
the exact version of a completed GitHub Release for a matched installation.

## 5. Building from source instead

For contributors, a patched fork, or verifying a fix that has no release yet, add the build
override – it does not change anything else about the stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Everything else – Caddy, the volumes, the profiles, the whole of `.env` – is the production
stack unchanged, so what you are testing differs from a real deployment only in where the
images came from. Leave the override off again and the next `up -d` goes back to the published
images.

(This used to be "comment out `image:` and uncomment `build:`" in `docker-compose.yml`. That
works, but it means editing a tracked file to change how you run it, which then sits in
`git status` until you remember to undo it – usually the moment you next try to pull an update.)

For day-to-day development use the hot-reload stack instead – `just dev`
(`docker-compose.dev.yml`).

## 6. Backups

**The nightly backup is already on.** `.env.example` ships `COMPOSE_PROFILES=backup` uncommented,
so the sidecar was created by your first `docker compose up -d` and has been running since. This
section used to open by telling you to switch it on with `docker compose --profile backup up -d`;
that command changes nothing, and "I ran it, so backups are on" was exactly the wrong thing to
have believed.

What is *not* decided for you is **where the files land**, and the default is the dangerous half:
`BACKUP_HOST_DIR` falls back to `./backups`, inside the checkout, on the same disk as the
database. That disk is the one whose failure this whole section exists for. Change it:

```bash
# In .env – where the files land, and when
BACKUP_HOST_DIR=/var/backups/kp-rueck   # anywhere but this checkout – and ideally a path that
                                        # is a mount point for a second disk or a NAS share
BACKUP_AT=03:30

docker compose up -d                    # recreates the sidecar on the new path
docker compose ps backup                # it should be there, and it should be healthy
```

If `docker compose ps backup` prints no row at all, the profile is not active – `COMPOSE_PROFILES`
has been dropped from `.env`, or you are running compose from another directory. That is the only
backup failure with no signal behind it, because a container that does not exist cannot go
unhealthy.

The sidecar, every night, writes **two** files from the same moment into
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
slack for a brigade that has no daily operator – damage done at a Saturday exercise can go
unnoticed until the drill after next. Eight weeklies (~2 months) is "someone imported the wrong
roster five weeks ago": quiet damage that is noticed when a report gets written, not when it
happens. Weeklies are hardlinks, so they cost nothing until the daily beneath them is pruned.
The dumps are small – single-digit MB for a station – so the photos decide your disk usage.

**It is loud when it cannot do its job.** A backup script that can silently do nothing is worse
than none, so every run either produces two verified files or leaves evidence: a `BACKUP-FAILED`
marker in the directory, a `"status": "failed"` in `last-backup.json` naming the stage, and a
failing container healthcheck. Which means the honest check is one command:

```bash
docker compose ps backup          # "healthy" = last night's backup ran and succeeded
cat /var/backups/kp-rueck/last-backup.json
```

`unhealthy` means the last backup failed **or** is more than 26 hours old. Look at
`docker compose logs backup` – the common causes are a full disk, a backup directory the
container cannot write to, and a Postgres client older than the server (see below).

Take one out of band, before an update you are not sure about:

```bash
just backup /var/backups/kp-rueck
```

**Off the box.** Everything above is still on the machine whose failure is the reason you are
reading this section. Copy `$BACKUP_HOST_DIR` somewhere else – a NAS mount, `rsync` to another
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
rare, it heals with the next night's backup, and the alternative – stopping the stack every
night – costs a brigade more than it returns.

### 6.1 Restore

Restoring replaces everything. Do it on a **fresh stack** first – see the drill below.

```bash
# 1. Stop application writers and background jobs; keep only the database running.
docker compose stop backend frontend backup print-agent

# 2. Drop and recreate the database, so the restore starts from nothing rather than
#    merging into whatever is there. (restore.sh refuses a database that still has tables –
#    this line is deliberately typed by a human.)
docker compose exec -T db psql -U kprueck -d postgres \
  -c "DROP DATABASE IF EXISTS kprueck;" -c "CREATE DATABASE kprueck OWNER kprueck;"

# 3. Restore the dump. Checks the archive is readable and the server is not older than the
#    dump's client before it writes anything.
just restore /var/backups/kp-rueck/daily/db-2026-07-30-033000.dump

# 4. Restore photos using a one-off shell, WITHOUT starting migrations or the application.
#    The backup sidecar mounts this volume read-only, so use the backend image's mount.
docker compose run --rm -T --no-deps --entrypoint sh backend \
  -ec 'stage=$(mktemp -d /mnt/data/photos/.restore.XXXXXX)
    mkdir "$stage/new" "$stage/previous"
    tar xzf - -C "$stage/new"
    # Extraction (including its disk-space demand) must finish before moving originals.
    # Keep originals until all same-filesystem moves succeed; never copy over them.
    find /mnt/data/photos -mindepth 1 -maxdepth 1 ! -path "$stage" \
      -exec mv -t "$stage/previous" -- {} +
    find "$stage/new" -mindepth 1 -maxdepth 1 \
      -exec mv -t /mnt/data/photos -- {} +
    rm -rf -- "$stage"' \
  < /var/backups/kp-rueck/daily/photos-2026-07-30-033000.tar.gz

# 5. Bring everything back up. Migrations run on boot, so a dump from an OLDER version is
#    upgraded automatically; a dump from a NEWER version is not – match or exceed its tag.
docker compose up -d
```

If the photo step fails, **do not restart the application**. Keep the `.restore.*` directory: original files remain either in their original location or under its `previous/` directory. Resolve the failure or restore into a fresh volume before continuing. A failed restore must not be treated as a completed one.

Then check: log in, open an incident that had photos, and confirm the images load.

**Without this repository, on someone else's machine.** The restore must not depend on our
tooling – you may have the files and a borrowed laptop and nothing else. `-Fc` dumps are read by
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
operating systems – a macOS or WSL laptop standing in for the station's Linux server is the
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

For a repeatable **synthetic** recovery check on a development machine with PostgreSQL tools,
run `bash scripts/check-recovery.sh`. It creates its own temporary PostgreSQL cluster on a
private Unix socket (no TCP listener), uses the real backup/restore scripts, applies a newer
schema and later writes, then checks the old revision, original rows and photo bytes after
restoration. It neither reads a deployment `.env` nor contacts an existing database. This
checks the recovery mechanism, not compatibility of a particular pair of application images.

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
exposes it on your domain. Nothing needs building – only pointing at.

**Set this up once.** Any free uptime service will do (Uptime Kuma if you self-host, or a hosted
one – the choice matters far less than having one):

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

**What it does not catch** – worth knowing, so it is not trusted for more than it is:

| Not covered | Check instead |
|---|---|
| Backups failing | `docker compose ps backup` (§6) – a separate signal, deliberately |
| Disk filling up | Nothing yet, and a full disk stops Postgres writing. Watch it. |
| Print agent dead / printer offline | The board's own print status (`docs/PRINT_AGENT.md`) |
| Tile server down | Map only; the board is unaffected |

### The caveat that matters on a station box

An external monitor answers *"can the internet reach this?"* – which on a compose deployment is
**not** the same question as *"does the board work in the station."* That stack is deliberately
built to survive an uplink outage: if your internet drops, the board, the map and the printer
keep working on the LAN, and the monitor will alert anyway. The alert is not wrong, it is
answering a different question. Read it as "the outside world lost us", then check the board
locally before assuming an outage.

The mirror image also holds: a station on a LAN-only deployment, with no public domain, cannot
be watched from outside at all. There, run the monitor **inside** the network – Uptime Kuma on
any always-on box on the same LAN, pointed at the stack's local address. That gives a real
answer for the deployment where an external check has none.

On Railway the distinction collapses: no internet means no application at all, so the external
check and the real question are the same thing.

---

## 8. What the system stores about people who are not members

Almost everything in the database is about the brigade: the roster, who was assigned where,
which vehicle went out. Two things are not, and an operator should know about them before a
storm rather than after one.

**The Melder.** An incident carries a `contact` – the name and phone number of whoever reported
it. That has always been there, it comes from the dispatch, and it is what the board dials back.

**The Eigentümer-/Halterblock of the Schadenplatz-Rapport.** New with `/feld`. When a crew fills
its rapport at a Schadenplatz it can record the name, street, town and – where a vehicle is
involved – the plate and model of the **owner**: a private person who is not a member and never
agreed to anything. This is the paper `fahrzeugrapport.pdf` block, digitised; it exists because
the invoice that gets written weeks later needs it.

The lifecycle is deliberately the simplest one that can be explained in a sentence:

- It **lives with the incident and dies with it.** Deleting the Ereignis (or the incident)
  deletes the owner data with it. There is no separate retention sweep and no configurable
  number of days, because a second rule is a rule somebody has to remember.
- It is **included in the exports** – the event report PDF and the Kostenpflicht sheet – which
  is what those exports are for. Treat those files the way the station already treats the filled
  paper slips.
- The station's existing practice for the paper slips governs. The app does not invent a second
  one.

**The `/feld` QR plus the Feld-Code reaches this data.** Scanning the poster gets a code prompt;
entering the four digits and picking your own name binds the device to that person, and from
then on it sees – and files – the rapports of the Schadenplätze that *this* person is assigned
to, owner block included. That is the same exposure the paper slips have (a filled slip on a
table is readable by whoever walks past), but it travels further, so:

- take the posters down when the Ereignis is closed, the way the check-in posters already come
  down;
- the Einsatzzettel carries the same token **and prints the code under its QR** – a QR without
  its code strands whoever scans it – so **slips get collected at the end of an Ereignis**
  rather than left in vehicles;
- **Neuer Code** (Links & QR sheet) makes every link and slip in circulation useless to anybody
  who has not already unlocked, without disturbing the phones already in the field;
  **Alle Geräte abmelden** is the separate, harder brake for a lost phone;
- the token expires by itself after 30 days.

**One thing the code does not gate**, so it is not reported as a bug later: anybody holding a
valid `/feld` credential can *create* a Schadenplatz and put themselves on it – that is what
«Neue Meldung» is for, and it is how a crew standing in front of a fallen tree gets it onto the
board. It reaches the board flagged as coming from the field, with the reporter's name on the
audit row. The mitigation is the code rotating per Ereignis, not a permission.

Neither the token nor the owner block is written to the application log or to telemetry, and a
test asserts it – the failure worth preventing is somebody adding a debug line during a storm.

---

## 9. Troubleshooting

Indexed by **what you can see**, because that is the only thing you have when something is wrong.
Nobody arrives here knowing that their problem is a CORS origin.

Three commands answer most of it, and it is worth running them in this order:

```bash
just doctor                    # one screen: containers, /health, tiles, last backup, running tag
docker compose ps              # every service Up, backend "(healthy)"
docker compose logs backend    # or caddy / frontend / backup – the errors are not cryptic
```

**One thing to know before the table**, because it explains half the confusing symptoms: the
services start in a chain. Caddy waits for the frontend to be healthy, the frontend waits for the
backend, the backend waits for the database. Caddy is the only service that publishes a port. So
**a backend that will not start means no port is open at all**, and what you see in the browser is
"connection refused" – a network-shaped symptom for a configuration-shaped cause. When in doubt,
`docker compose ps` before anything else.

| What you see | Almost always | What to do |
| --- | --- | --- |
| **Login takes the password, then drops you straight back on the login form.** No error, no "wrong password". | The browser is refusing to store or return the login cookie, because the cookie is marked `Secure` and the page is plain `http://`. | This is now worked out for you from `CORS_ORIGINS`, so the residual case is a hand-set override: look for `AUTH_COOKIE_SECURE=true` in `.env` on a deployment served over plain HTTP, and blank it. The other version of this is `CORS_ORIGINS=https://…` while browsers actually use `http://…` – the inference believes `CORS_ORIGINS`, so fix that instead. A third: `CORS_ORIGINS` holding **several** comma-separated origins with mixed schemes – one `https://` entry anywhere in the list re-arms `Secure` for everybody, which is how a station that adds a new domain alongside its old LAN address locks out the LAN address. Restart the backend after any of these; `docker compose logs backend` prints the decision and where it came from on every boot. |
| **Login says "Zu viele fehlgeschlagene Anmeldeversuche".** | Not a misconfiguration. Five failed attempts on one *username* locks that username for five minutes. | Wait it out, or reset the password from another admin session. Counting is per username, not per IP, exactly so one command post behind one NAT cannot lock itself out. |
| **The board loads and looks right, but everything you click fails or spins forever.** | `CORS_ORIGINS` is not the URL in the address bar. The backend refuses the browser's calls; the page itself was served by Caddy and knows nothing about it. | Make them identical, character for character: scheme included, port included, **no trailing slash**. `http://192.168.1.50:8080` and `http://192.168.1.50:8080/` are not the same string, and neither is `https://kp.example.ch` when people type `http://`. Then `docker compose up -d`. |
| **`https://your.domain` refuses the connection, or the certificate never appears.** | Caddy could not complete the ACME challenge. | `docker compose logs caddy` and read the ACME lines. The usual causes, in order: the A/AAAA record does not point here yet (DNS takes its time); port 443 is not reachable from the internet; **`HTTP_PORT` is still `8080`**, so nothing on this host listens on port 80 and the HTTP-01 challenge has nothing to answer on. With a domain, set `HTTP_PORT=80`. |
| **A bare, empty 404 page when you browse to the host's IP address.** | Nothing is broken. With `DOMAIN` set, Caddy answers **only** for that hostname and gives everything else an empty 404. | Use the domain. If DNS has not propagated yet, put a line in your laptop's `hosts` file (`<host-ip> kp.example.ch`) and carry on. Do not "fix" this by clearing `DOMAIN` – you would drop TLS to work around a wait. |
| **`docker compose ps` shows `backend` restarting in a loop.** | A required secret is missing, empty or too weak. Production refuses to start rather than run half-secured. | `docker compose logs backend` names the variable in the first few lines. Common: `AUTH_SECRET_KEY` shorter than 32 characters or containing a giveaway word like `changeme`/`secret`/`test`; `ADMIN_SEED_PASSWORD` or, on a first boot, `VIEWER_PASSWORD` under 12 characters (later, a too-short `VIEWER_PASSWORD` only logs a line and leaves the viewer account as it was); `DEPLOYMENT_ROLE` misspelt (only `production` and `staging` are accepted, and an unrecognised value aborts on purpose rather than being guessed as production). |
| **`docker compose up -d` exits immediately with `set POSTGRES_PASSWORD in .env`.** | Compose found no `.env` – usually because you are in the wrong directory, or the file is still called `.env.example`. | Run it from the repository root, where `.env` and `docker-compose.yml` sit together. `just init` writes the file if you never did. |
| **Caddy will not start; the log mentions the Caddyfile being a directory.** | You copied `docker-compose.yml` out of the repository instead of keeping the clone. Docker created an empty *directory* at the bind-mount path. | Keep the whole clone and run compose from inside it – `./deploy/Caddyfile` and `./scripts` are both mounted from it (§2). |
| **The board comes up completely empty – no vehicles, no personnel, no material.** | Correct behaviour, not a broken install. A production deployment seeds accounts, settings and alarm templates, and no resources at all. | Import your roster and fleet: [`SETUP.md` §3](SETUP.md). |
| **After an update or a restart, everybody is logged out.** | `SECRET_KEY` or `AUTH_SECRET_KEY` changed. They sign sessions and tokens; a new value invalidates every one of them. | Put the old values back if you still have them. Then keep both **with your backups**, not with your code – a restore with different secrets does the same thing (§6). |
| **The map is grey or blank when the internet is down.** | Offline tiles are not there. Either they were never generated, or they were generated for the wrong region, or the file is under a different `TILES_NAME` than the tileserver looks for. | `just tiles-status` says which of the three it is: "only minimal bootstrap tiles" means no real data. Then [`OFFLINE_MAPS.md`](OFFLINE_MAPS.md). The default region is Basel-Landschaft, which is almost certainly not yours; `TILES_NAME` must be the same value for generating, installing and serving, so do not rename it on an existing volume. |
| **The map is blank *with* internet too.** | The tileserver is not the problem – the board is. | Check `docker compose ps tileserver`, then the browser's console. Note that map mode (`auto` / `online` / `offline`) is a setting in the app, not an environment variable. |
| **The board updates, but only every few seconds and never instantly.** | The WebSocket is not connecting; the client has silently fallen back to ~5s polling. Nothing is lost, it is just slow. | Fine to live with in the short term. If you put another proxy in front of Caddy, it has to pass WebSocket upgrades on `/socket.io`. `WS_REQUIRE_AUTH=true` (the default) also rejects sockets with no valid login cookie – which is the previous row's problem wearing a different hat. |
| **Printing does nothing; the board says the agent is not there.** | The two ends of the shared secret do not match, or the agent cannot reach the backend. | `PRINT_AGENT_TOKEN` (backend) and `AGENT_TOKEN` (agent) are one value; the endpoints are fail-closed and answer `403` when it is unset or wrong. The agent runs on the **host** network, so `PRINT_AGENT_BACKEND_URL` cannot be a compose service name – use the deployment's URL or `http://localhost:<HTTP_PORT>`. [`PRINT_AGENT.md`](PRINT_AGENT.md). |
| **`docker compose ps backup` shows nothing at all.** | The `backup` profile is not active, so the sidecar was never created – and a container that does not exist cannot report itself unhealthy. This is the only backup failure with no signal. | Check that `COMPOSE_PROFILES=backup` is still in `.env`, and that you are running compose from the directory that holds it (§6). |
| **`docker compose ps backup` shows `unhealthy`.** | The last backup failed or is more than 26 hours old. Not "has never run": the sidecar takes one immediately on start, so this state on a fresh install means a real failure, not a wait. | `cat $BACKUP_HOST_DIR/last-backup.json` names the stage that broke, and `docker compose logs backup` shows it. Usual causes: the disk is full, the backup directory is not writable by the container, or `BACKUP_PG_IMAGE` is an older Postgres major than the `db` service (§6). |
| **Microsoft sign-in works, but those users cannot change anything.** | `SSO_EDITOR_ALLOWLIST` is empty, so everyone from your tenant is provisioned as a viewer. | Set it to the comma-separated e-mail addresses that should get editor rights, and restart the backend. It is an explicit grant on purpose: any member of the tenant can reach that login. |
| **An Excel import deleted the whole roster.** | The import ran in `Ersetzen` mode, which empties the tables the workbook has a sheet for before inserting. The preview does not yet display the deletion figures, so a calm-looking preview is not evidence that nothing was going to be deleted. | Restore from last night's backup (§6.1). For adding people to an existing roster the mode is `Anhängen`. Before any future `Ersetzen`, export first (**Einstellungen → Daten → Export**) – same workbook shape, so it is also the undo: [`SETUP.md` §3](SETUP.md). |
| **The board is fine locally, but your uptime monitor keeps alerting.** | On a compose deployment those are two different questions. The stack is built to survive an uplink outage; an external monitor cannot see it during one. | The alert is not wrong, it is answering "can the internet reach this?". Check the board locally before assuming an outage – §7 has the long version, including where to put a monitor on a LAN-only install. |

Still stuck? Open an [issue](https://github.com/feuerwehr-oberwil/kp-rueck/issues) with the output
of `just doctor` and the last fifty lines of `docker compose logs backend`. A setup that fails in
a way this table does not cover is a bug in this table.

# Deployment (self-hosting)

How to run KP Rück on your own machine – a station VPS, a box in the Gerätehaus, anything with
Docker. For the managed-PaaS route see [`RAILWAY.md`](RAILWAY.md); this guide covers the
docker-compose stack, which is the path published releases are built for.

Nothing here requires a build toolchain: the stack pulls published images from GHCR.

## 1. What runs

| Service | Image | Role |
| --- | --- | --- |
| `db` | `postgres:16-alpine` | The database. Bundled; or point `DATABASE_URL` at a managed Postgres and drop the service. |
| `backend` | `ghcr.io/feuerwehr-oberwil/kp-rueck-backend` | FastAPI: API, WebSocket board updates, integrations. Runs migrations and seeding on boot. |
| `frontend` | `ghcr.io/feuerwehr-oberwil/kp-rueck-frontend` | The Next.js dashboard. |
| `tileserver` | `ghcr.io/feuerwehr-oberwil/kp-rueck-tileserver` | Offline map tiles (see [`OFFLINE_MAPS.md`](OFFLINE_MAPS.md)). |
| `caddy` | `caddy:2-alpine` | The single origin in front of everything, with automatic HTTPS. |
| `print-agent` | `ghcr.io/feuerwehr-oberwil/kp-rueck-print-agent` | Optional thermal printer relay (`--profile printing`), also built for arm64 so it runs on a Pi. |

**Everything is served through one origin.** Caddy routes `/socket.io` and `/api` to the
backend, `/tiles` to the tileserver, and everything else to the frontend. That is what keeps
the published frontend image generic – the browser only ever talks to its own host, so no
station's URL is baked into the image at build time. It also means there is no CORS surface.

## 2. Quick start

```bash
# 1. Get the compose file + templates (a tagged release is the safe choice, not main)
git clone https://github.com/feuerwehr-oberwil/kp-rueck.git && cd kp-rueck
git checkout "$(git tag -l 'v*' --sort=-v:refname | head -n1)"   # newest release; pick an older tag if you prefer

# 2. Configure
cp .env.example .env
#    Required: POSTGRES_PASSWORD, SECRET_KEY, AUTH_SECRET_KEY, ADMIN_SEED_PASSWORD
#      SECRET_KEY / AUTH_SECRET_KEY: openssl rand -hex 32  (KEEP THEM STABLE)
#      ADMIN_SEED_PASSWORD: at least 12 characters – this is your first login
#    For HTTPS: set DOMAIN to a hostname whose A/AAAA record points here, and
#    PUBLIC_URL to https://<that domain>.

# 3. Start
docker compose up -d           # add --profile printing if you use the thermal printer

# 4. Log in as `admin` with ADMIN_SEED_PASSWORD, then change it.
```

On a LAN with no domain, leave `DOMAIN` empty: Caddy serves plain HTTP on `HTTP_PORT`
(default 8080), `PUBLIC_URL` should be `http://<host>:8080`, and you **must** also set
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
docker compose exec -T db pg_dump -U kprueck kprueck | gzip > kprueck-$(date +%F).sql.gz
docker run --rm -v kp-rueck_photos:/data -v "$PWD:/out" alpine \
  tar czf /out/photos-$(date +%F).tar.gz -C /data .
```

The database holds the operational record; the `photos` volume holds Reko photos, which are not
in the database. A dump without the volume restores a board with missing images.

Keep `SECRET_KEY` and `AUTH_SECRET_KEY` with the backup – restoring a database with different
secrets logs everyone out and invalidates issued tokens.

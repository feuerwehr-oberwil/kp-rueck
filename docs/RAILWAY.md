# Railway Deployment Guide

> [!IMPORTANT]
> **Both deployment paths are supported.** Railway (this guide) and the docker-compose stack
> in **[`DEPLOYMENT.md`](DEPLOYMENT.md)** run the same images from the same releases — pick by
> who runs the server, not by which is "real". Railway means somebody else keeps the machine
> alive; compose on a box in the Gerätehaus means the board survives an internet outage. A
> station that does not want a server to look after should take Railway. Either way, start at
> **[`SETUP.md`](SETUP.md)** for the station-level setup that follows deployment.

Railway runs KP Rück as **three services** — PostgreSQL, backend, frontend — built from the
Dockerfiles in this repository. Most of this guide applies to any Docker-capable PaaS; the
parts that are genuinely Railway-specific are marked.

---

## 1. Decide this before you click anything

Two choices are hard to change later. Read this section first; it is the difference between a
board that updates live and one that quietly lags five seconds behind.

### 1.1 Service names decide whether real-time sync works

Railway has **no shared reverse proxy** in front of your services: the frontend and the backend
are two separate hostnames. HTTP requests are fine — the frontend proxies them server-side
through its own `/backend-api` route. **WebSockets cannot use that proxy**, because Next.js API
routes handle HTTP, not socket upgrades.

So the browser has to address the backend directly, and it does so **by naming convention**
(`frontend/lib/env.ts`, `getWsUrl()`): it takes the frontend's hostname, appends `-api` to the
first label, and connects there.

| Frontend public domain | Backend public domain it will look for |
| --- | --- |
| `kp-rueck.up.railway.app` | `kp-rueck-api.up.railway.app` |
| `feuerwehr-musterhausen.up.railway.app` | `feuerwehr-musterhausen-api.up.railway.app` |

**Set both domains explicitly** under each service's Settings → Networking → Public Networking,
rather than accepting whatever Railway generates. If the backend domain does not match the
pattern, nothing errors visibly — the socket simply never connects and the board falls back to
polling every 5 seconds (`POLLING_BASE_INTERVAL`, `operations-context.tsx`). Everything still
works; it just stops feeling live, and you will not be told why.

### 1.2 Custom domains break the convention

If you put a custom domain on the frontend (`kp.feuerwehr-musterhausen.ch`), the `-api` rule no
longer applies — it is keyed on `.up.railway.app` — and the browser falls back to same-origin,
where there is no Socket.IO listener. **Result: permanent polling fallback.**

**The fix is one variable: set `NEXT_PUBLIC_WS_URL` on the frontend service** to the backend's
WebSocket URL, scheme included:

```
NEXT_PUBLIC_WS_URL=wss://kp-api.feuerwehr-musterhausen.ch
```

`frontend/Dockerfile` declares it as a build `ARG`, and Railway passes service variables into
Dockerfile builds — so it is inlined when the image is built. **Changing it requires a
redeploy**, not just a restart, because like every `NEXT_PUBLIC_*` value it is baked in at
build time rather than read at runtime.

> Why this one is safe to bake in when `NEXT_PUBLIC_API_URL` is not: it names only the socket
> endpoint. HTTP traffic still goes through `/backend-api` on the app's own origin, so session
> cookies stay first-party and mobile logins keep working. `NEXT_PUBLIC_API_URL` is what moves
> HTTP off-origin, and that is what breaks them.

Alternatively, **keep the frontend on `*.up.railway.app`** and follow the `-api` convention from
§1.1 — a custom domain on the *backend* alone changes nothing, since the browser only derives
the socket host from the frontend's hostname. Put a custom domain on the backend and set
`NEXT_PUBLIC_WS_URL` to match, and both work together.

---

## 2. Prerequisites

- A Railway account: <https://railway.app>
- This repository on GitHub (Railway deploys from a repo, not from GHCR images)
- Optional: the CLI, `npm install -g @railway/cli`
- Two secrets generated up front — you will paste them in a minute:

  ```bash
  openssl rand -hex 32   # AUTH_SECRET_KEY
  openssl rand -hex 32   # SECRET_KEY
  ```

  Keep both **stable forever**. `AUTH_SECRET_KEY` signs login tokens; changing it logs
  everyone out mid-operation.

---

## 3. Setup

### 3.1 Create the project and database

1. <https://railway.app/new> → **Deploy from GitHub repo** → select your `kp-rueck` fork.
2. In the project, **New → Database → PostgreSQL**. Railway provisions it and exposes
   `${{Postgres.DATABASE_URL}}` as a reference you can use from other services.

### 3.2 Backend service

1. **New → GitHub Repo →** `kp-rueck`, then in Settings:
   - **Root Directory**: `/backend`
   - Build and start command come from [`backend/railway.json`](../backend/railway.json)
     (Dockerfile build, `./start.sh`, healthcheck on `/health`). You do not need to type them.

2. **Attach a volume** — Settings → Volumes → New Volume, mount path **`/mnt/data`**, 5 GB or
   more. Reko photos live here; without a volume they land in ephemeral container storage and
   vanish on the next deploy.

   > The backend container runs as **root**, so Railway's root-owned volume mounts are not a
   > problem here. (KP Front is different — it runs as uid 10001 and needs `RAILWAY_RUN_UID=0`.
   > Do not copy that setting into this project; it is not needed.)

3. **Variables:**

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   SECRET_KEY=<openssl rand -hex 32>
   AUTH_SECRET_KEY=<openssl rand -hex 32>
   ADMIN_SEED_PASSWORD=<at least 12 characters>
   VIEWER_PASSWORD=<at least 12 characters>
   PHOTOS_DIR=/mnt/data/photos
   CORS_ORIGINS=https://<your-frontend-domain>
   ```

   `CORS_ORIGINS` you will only know after step 3.3 — set it then, or set it now if you already
   fixed the frontend domain in §1.1.

4. Deploy. `start.sh` runs `alembic upgrade head` on every boot, then seeds on first run.

### 3.3 Frontend service

1. **New → GitHub Repo →** `kp-rueck`, Settings → **Root Directory**: `/frontend`.
   [`frontend/railway.json`](../frontend/railway.json) supplies the rest (`node server.js`).

2. **Variables — one, usually:**

   ```
   API_URL=https://<your-backend-domain>
   ```

   `API_URL` is read **at runtime** by the server-side `/backend-api` proxy route.

   Add `NEXT_PUBLIC_WS_URL=wss://<your-backend-domain>` **only** if the frontend runs on a
   custom domain — see §1.2 for why, and note it is inlined at build time.

   > [!WARNING]
   > **Do not set `NEXT_PUBLIC_API_URL`.** It is inlined at *build* time and makes the browser
   > call the backend origin directly, which turns the session cookie into a third-party
   > cookie. Safari blocks those, so **mobile logins fail with "Sitzung abgelaufen"** while
   > desktop keeps working. This is not hypothetical — it is exactly how the public demo broke,
   > and deleting the variable is what fixed it. Leave it unset and the browser talks to
   > `/backend-api` on its own origin, keeping the cookie first-party.

3. Set the public domains for both services now, per §1.1.

4. Go back to the backend and set `CORS_ORIGINS` to the frontend's URL, exactly — scheme
   included, no trailing slash.

### 3.4 First login

Open the frontend URL and log in as **`admin`** with your `ADMIN_SEED_PASSWORD`. Change it
immediately, then continue with [`SETUP.md`](SETUP.md) for roster, fleet and integrations.

A **`viewer`** account also exists, using `VIEWER_PASSWORD` — that is the read-only login for
wall displays and kiosk screens.

There is **no shared `editor` account in production.** It is created only outside production
(`backend/app/seed.py`); editors get individual accounts. `EDITOR_PASSWORD` is ignored here —
if you find it in an older deployment of yours, it is doing nothing.

---

## 4. Production mode is automatic on Railway

You do **not** need to set `ENVIRONMENT=production`. Railway injects `RAILWAY_ENVIRONMENT` and
friends, and `backend/app/environment.py` treats any of them as production. Setting
`ENVIRONMENT=production` explicitly is harmless and slightly clearer.

What production mode changes — all of it fail-closed:

- **Secrets are mandatory and must be strong.** A missing `SECRET_KEY`, or one containing
  `change_this`, `secret`, `password`, `test`, `demo`, `openssl_rand`, aborts startup instead of
  falling back to a generated value. Minimum 32 characters.
- **`AUTH_BYPASS_AUTH_DEV=true` refuses to start.** There is no way to disable auth here.
- **No sample data at all** — no demo incidents, and no sample fleet, roster, materials or
  training locations. The board starts genuinely empty.
- **No shared editor login** (see above).
- **Secure cookies by default.** `AUTH_COOKIE_SECURE=false` exists as an escape hatch for a
  plain-HTTP LAN, which does not apply to Railway. Do not set it.

If the backend crash-loops on the first deploy, read the logs before changing anything: it is
almost always one of these refusing a weak or missing value, and the message names the variable.

---

## 5. Environment variables

### Backend

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Railway reference, not a literal string. Railway hands out a `postgresql://` URL and the backend rewrites it to `postgresql+asyncpg://` itself (`config.py`), so paste it through unchanged |
| `SECRET_KEY` | 32-byte hex | Signs check-in, Reko, viewer and alarm-intake tokens. **Required.** |
| `AUTH_SECRET_KEY` | 32-byte hex | Signs login/refresh JWTs. **Required. Keep stable** — changing it logs everyone out |
| `ADMIN_SEED_PASSWORD` | 12+ characters | The initial `admin` login, created on first seed. **Required** |
| `VIEWER_PASSWORD` | 12+ characters | The read-only `viewer` login. **Required** |
| `PHOTOS_DIR` | `/mnt/data/photos` | Must point inside the mounted volume |
| `CORS_ORIGINS` | `https://<frontend>` | The frontend's exact origin |
| `PORT` | `8000` | Railway sets this automatically |

Optional, per integration: `DIVERA_ACCESS_KEY`, `TRACCAR_*`, `PRINT_AGENT_TOKEN`. See
[`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md) and [`PRINT_AGENT.md`](PRINT_AGENT.md).

### Frontend

| Variable | Value | Notes |
|---|---|---|
| `API_URL` | `https://<backend>` | Read at **runtime** by the `/backend-api` proxy |
| `NEXT_PUBLIC_WS_URL` | `wss://<backend>` | **Only** with a custom frontend domain (§1.2). Inlined at build time — changing it needs a redeploy |
| `PORT` | `3000` | Railway sets this automatically |

> `NEXT_PUBLIC_API_URL` must stay **unset** — see the warning in §3.3. The published frontend
> image is deliberately built without it for the same reason.

---

## 6. What you give up compared to docker-compose

Worth knowing before you commit, not after.

| | docker-compose | Railway |
|---|---|---|
| **Internet outage** | Board and printing keep working on the LAN | Everything is unreachable |
| **Offline map tiles** | Yes, tileserver behind `/tiles` | **No** — see below |
| **Real-time sync** | Always (single origin routes `/socket.io`) | Only with the `-api` naming convention (§1.1) |
| **Origins** | One, via Caddy | Two hostnames |
| **Machine upkeep** | Yours | Railway's |
| **Cost** | Hardware once | Monthly |

**Offline tiles do not work on Railway.** There is no reverse proxy to route `/tiles` to a
tileserver, which is where the browser looks on any deployed origin. The map falls back to
online OpenStreetMap, which is fine until the connection you are already relying on for the
whole deployment goes away. If offline maps matter to you — and for a fire station they usually
do — that is an argument for the compose path.

**The print agent still runs on your premises** either way. It is a pull agent: it sits on the
station LAN next to the printer and polls the backend, so it works against a Railway backend
without any inbound firewall rule. Point `BACKEND_URL` at your backend's public URL. See
[`PRINT_AGENT.md`](PRINT_AGENT.md).

---

## 7. Do not run more than one replica

`numReplicas: 1` in both `railway.json` files is deliberate. Two backend replicas break the
application in two ways that are hard to diagnose:

- **WebSocket rooms are in-process.** `socketio.AsyncServer` is configured without a message
  queue, so a broadcast from replica A never reaches a browser connected to replica B. Half
  your operators stop seeing updates.
- **Background jobs would run twice.** Audit cleanup, the fallback print job, the sync
  scheduler and telemetry flush all run in-process — duplicated thermal prints, duplicated
  sync.

KP Rück is single-tenant by design: one station, one deployment, one instance. Scale the
container's CPU and memory if you need to, never the replica count.

---

## 8. Updating

Railway redeploys on push to your default branch. Because `start.sh` runs
`alembic upgrade head` on boot, schema migrations apply automatically — the same behaviour as
the compose path.

Read [`CHANGELOG.md`](../CHANGELOG.md) before updating: MAJOR means operator action is
required, MINOR means new features and automatic migrations, PATCH means fixes.

To roll back, redeploy an earlier deployment from the Railway dashboard. **A database dump from
a newer version will not restore into an older one** — migrations only run forwards.

---

## 9. Backups

Railway's managed PostgreSQL provides automatic backups and point-in-time recovery — that
covers the database. **It does not cover your photo volume.** Reko photos live on the
`/mnt/data` volume and are not part of a database backup.

Pull a dump and the photos periodically:

```bash
railway link                                                    # select the project
railway run bash -c 'pg_dump "$DATABASE_URL"' > kprueck-$(date +%F).sql
```

The inner command must be **single-quoted**: `railway run` injects the variables into the
process it starts, so `$DATABASE_URL` has to survive your local shell unexpanded.

Verify a restore occasionally rather than assuming it works — a backup nobody has restored is
a hypothesis. [`DEPLOYMENT.md`](DEPLOYMENT.md) §6.1 has the restore procedure, and it applies
here too.

---

## 10. Resetting the database

Only for a deployment with nothing worth keeping — this destroys all data.

**Dashboard:** PostgreSQL service → Data → Reset Database, then redeploy the backend.

**CLI:**

```bash
railway link
railway run psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
```

Then redeploy the backend: `start.sh` recreates the tables via Alembic and re-seeds.

---

## 11. Troubleshooting

**The board only updates every few seconds.**
The WebSocket is not connecting and it has fallen back to polling. On `*.up.railway.app`, check
the backend's public domain against §1.1 — it must be the frontend's first hostname label plus
`-api`. On a custom frontend domain, set `NEXT_PUBLIC_WS_URL` (§1.2) and **redeploy**, since it
is baked in at build time.

**Mobile login fails with "Sitzung abgelaufen", desktop works.**
`NEXT_PUBLIC_API_URL` is set on the frontend service. Delete it and redeploy — it must be
rebuilt without the variable, since it is inlined at build time.

**Backend crash-loops on first deploy.**
Read the logs. Production refuses weak or missing secrets by design, and the error names the
variable. See §4.

**Frontend cannot reach the backend.**
Verify `API_URL` is set on the frontend, that `CORS_ORIGINS` on the backend exactly matches the
frontend origin (scheme, no trailing slash), and that the backend healthcheck at `/health` is
green.

**Photos disappear after a deploy.**
The volume is missing or `PHOTOS_DIR` does not point inside it. Backend startup logs should
show `Photo storage directory: /mnt/data/photos`. See [`PHOTO_STORAGE.md`](PHOTO_STORAGE.md).

---

## 12. Storage sizing

Photos are the only thing that grows meaningfully. After compression a photo is roughly 200 KB,
and a Reko report holds up to 20 of them:

| Reports | Photo storage |
|---|---|
| 100 | ~400 MB |
| 1,000 | ~4 GB |
| 10,000 | ~40 GB |

The database itself stays small — incidents and personnel are text rows.

---

## 13. Checklist

- [ ] Frontend and backend public domains follow the `<name>` / `<name>-api` convention (§1.1)
- [ ] Backend: `SECRET_KEY`, `AUTH_SECRET_KEY`, `ADMIN_SEED_PASSWORD`, `VIEWER_PASSWORD` set and strong
- [ ] Backend: `DATABASE_URL` uses the `${{Postgres.DATABASE_URL}}` reference
- [ ] Backend: volume mounted at `/mnt/data` and `PHOTOS_DIR=/mnt/data/photos`
- [ ] Backend: `CORS_ORIGINS` matches the frontend origin exactly
- [ ] Frontend: `API_URL` set, `NEXT_PUBLIC_API_URL` **not** set
- [ ] Startup logs show `Photos directory ready: /mnt/data/photos`
- [ ] Logged in as `admin` and changed the seeded password
- [ ] Board updates instantly with two browsers open (proves the WebSocket, not polling)
- [ ] Replica count left at 1 (§7)
- [ ] A database dump has been pulled *and* restored once
- [ ] Continue with [`SETUP.md`](SETUP.md)

---

## Support

- Railway docs: <https://docs.railway.app>
- KP Rück issues: <https://github.com/feuerwehr-oberwil/kp-rueck/issues>

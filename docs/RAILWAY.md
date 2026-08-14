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

## 1. How the two services find each other

Railway has **no shared reverse proxy** in front of your services: the frontend and the backend
are two separate hostnames. Read this section first — it is short, and it is the difference
between a board that updates live and one that quietly lags five seconds behind.

### 1.1 One variable does it: `API_URL`

HTTP is easy — the frontend proxies it server-side through its own `/backend-api` route.
**WebSockets cannot use that proxy**, because Next.js API routes handle HTTP, not socket
upgrades, so the browser has to address the backend directly.

It learns that address from **`API_URL` on the frontend service**, the same runtime variable
the HTTP proxy already uses: the server passes it to the page, and `getWsUrl()`
(`frontend/lib/env.ts`) prefers it over everything else. Set `API_URL` to your backend's public
URL and real-time sync works — on a generated domain, on a custom domain, on any host.

So the whole requirement is:

- **frontend:** `API_URL=https://<your-backend-domain>`
- **backend:** `CORS_ORIGINS=https://<your-frontend-domain>` — exact origin, scheme included,
  no trailing slash.

Both are read at **runtime**. Changing either takes a restart, not a rebuild.

### 1.2 Domain names are tidiness, not a requirement

If the browser is told nothing, it still guesses, and the guess is the old naming convention:
frontend `kp-rueck.up.railway.app` → backend `kp-rueck-api.up.railway.app`, and same-origin for
anything else.

| Frontend public domain | Backend domain guessed if `API_URL` is missing |
| --- | --- |
| `kp-rueck.up.railway.app` | `kp-rueck-api.up.railway.app` |
| `kp.feuerwehr-musterhausen.ch` | *(same origin — nothing listens there)* |

That fallback is why the `<name>` / `<name>-api` convention is worth keeping: it reads well and
it makes the examples in this guide true. It is **no longer load-bearing**. With `API_URL` set,
name the domains whatever you like, custom domains included.

> **`NEXT_PUBLIC_WS_URL` is an override almost nobody needs.** It still works, it is still a
> build `ARG` in `frontend/Dockerfile`, and it is still inlined at build time — so changing it
> needs a redeploy, and it ties an image to one station. `API_URL` supersedes it. Set it only if
> your socket endpoint is genuinely somewhere other than `API_URL`.

> **A custom domain on the *backend* works too, and needs nothing extra.** It used to need a
> rebuild: the frontend's Content-Security-Policy was written into the image at build time, and
> its `connect-src` knew only the app's own origin, `localhost` and `*.railway.app` — so the
> browser aimed the socket at `wss://kp-api.example.ch` correctly and then refused to open it.
> The policy is now assembled per request in `frontend/middleware.ts`, from the same runtime
> `API_URL`, so whatever you set in §1.1 is also what the browser is allowed to talk to. Set the
> variable, restart the frontend; there is nothing to rebuild and no second variable.

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
   fixed the frontend domain in §1.2.

4. Deploy. `start.sh` runs `alembic upgrade head` on every boot, then seeds on first run.

   > **The first deploy is the slow one.** It applies every migration to an empty database and
   > then seeds, and uvicorn only binds a port afterwards — so Railway sees nothing to health-
   > check for a while. `healthcheckTimeout` is set to 300 s in
   > [`backend/railway.json`](../backend/railway.json) for exactly this reason. Later deploys
   > are fast, because the migrations are no-ops. If a first deploy does time out, redeploying
   > usually succeeds: the schema is already migrated by then.

### 3.3 Frontend service

1. **New → GitHub Repo →** `kp-rueck`, Settings → **Root Directory**: `/frontend`.
   [`frontend/railway.json`](../frontend/railway.json) supplies the rest (`node server.js`).

2. **Variables — one, usually:**

   ```
   API_URL=https://<your-backend-domain>
   ```

   `API_URL` is read **at runtime**, both by the server-side `/backend-api` proxy route and by
   the page that tells the browser where to open its WebSocket (§1.1). It is the only frontend
   variable a normal deployment needs.

   > [!WARNING]
   > **Do not set `NEXT_PUBLIC_API_URL`.** It is inlined at *build* time and makes the browser
   > call the backend origin directly, which turns the session cookie into a third-party
   > cookie. Safari blocks those, so **mobile logins fail with "Sitzung abgelaufen"** while
   > desktop keeps working. This is not hypothetical — it is exactly how the public demo broke,
   > and deleting the variable is what fixed it. Leave it unset and the browser talks to
   > `/backend-api` on its own origin, keeping the cookie first-party.

3. Set the public domains for both services now (Settings → Networking → Public Networking),
   so you have the exact origins for `API_URL` and `CORS_ORIGINS`. Any names work — see §1.2.

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
| `SECRET_KEY` | 32-byte hex | Signs every public token: check-in, Reko, viewer, alarm-intake and `/feld`. **Required. Keep stable** — changing it invalidates every printed QR and poster |
| `AUTH_SECRET_KEY` | 32-byte hex | Signs login/refresh JWTs. **Required. Keep stable** — changing it logs everyone out |
| `ADMIN_SEED_PASSWORD` | 12+ characters | The initial `admin` login, created on first seed. **Required** |
| `VIEWER_PASSWORD` | 12+ characters | The read-only `viewer` login. **Required** |
| `PHOTOS_DIR` | `/mnt/data/photos` | Must point inside the mounted volume |
| `CORS_ORIGINS` | `https://<frontend>` | The frontend's exact origin |
| `PORT` | `8000` | Railway sets this automatically |
| `DEPLOYMENT_ROLE` | `production` (default) or `staging` | What this instance may do to the outside world. Leave it unset on the real deployment; see §5.1 |

Optional, per integration: `DIVERA_ACCESS_KEY`, `TRACCAR_*`, `PRINT_AGENT_TOKEN`. See
[`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md) and [`PRINT_AGENT.md`](PRINT_AGENT.md).

`HEALTHCHECK_PING_URL` is worth setting on any deployment somebody depends on: a 60 s job GETs
it, so an external monitor (healthchecks.io or any cron monitor) alerts when the pings *stop*.
That covers the failure an uptime probe of `/health` misses — a container stopped with nothing
replacing it, or a wedged event loop. Point it at a check with a 1 min period and a few minutes
of grace. Empty = no job; a failed ping is logged and swallowed, so a monitoring outage can
never take the board down with it. Same variable and cadence in KP Front.

### Frontend

| Variable | Value | Notes |
|---|---|---|
| `API_URL` | `https://<backend>` | Read at **runtime** — by the `/backend-api` proxy *and* as the WebSocket origin handed to the browser (§1.1). **Required** |
| `NEXT_PUBLIC_WS_URL` | `wss://<backend>` | Optional override, needed by almost nobody since `API_URL` supersedes it (§1.2). Inlined at build time — changing it needs a redeploy |
| `PORT` | `3000` | Railway sets this automatically |

> `NEXT_PUBLIC_API_URL` must stay **unset** — see the warning in §3.3. The published frontend
> image is deliberately built without it for the same reason.

### 5.1 A second instance to test on: `DEPLOYMENT_ROLE`

A useful way to try a change before it reaches the people on call is a second instance, running
the same images, ideally on a copy of the real database — because a copy is the only thing that
reproduces the data you actually have.

The problem with that copy is that it brings the switches with it. Two settings live in the
database and both point outward:

| Setting | What it does | In a copy |
|---|---|---|
| `alerting.enabled` | master switch for outbound alerting (Ausalarmierung) | arrives already on |
| `railway_database_url` | where the sync scheduler pushes local changes | arrives pointing at the instance you copied FROM |

Turning them off by hand does not hold: the next copy overwrites them, and anyone tidying the
settings page re-arms them. So the lock lives in the environment instead, where a database dump
cannot reach it:

```
DEPLOYMENT_ROLE=staging
```

What it changes — and this is the complete list:

1. **Outbound alerting is refused.** Every send goes through one seam, and that seam raises
   instead of calling the provider — regardless of `alerting.enabled`. The API answers **403**
   with a German sentence naming the reason, and the buttons in the UI are visibly disabled
   with the same reason. Never a silent success.
2. **Sync is refused.** `railway_database_url` reads as empty everywhere, and the periodic sync
   job is not started. The test instance cannot write into the one it was copied from.
3. **A permanent band** at the top of every page, including the login screen, reading
   *Staging – Übungssystem*. The cheapest of the three, and the one that catches the most
   common mistake — the wrong browser tab at 02:00.
4. **`GET /api/integrations`** reports `deployment.role`, `deployment.blocked_domains` and a
   per-domain `blocked` / `blocked_reason`, so the lock is visible to an API caller too. The
   small public version is `GET /api/deployment`.

Deliberately **not** blocked, because they are the point of having the instance: printing,
Traccar/GPS reads, inbound alarms, and everything else. Nothing else in the application behaves
differently — the whole idea is that the second instance rehearses the real one.

Notes:

- **Unset or empty means `production`**, which blocks nothing. That is the case every existing
  deployment is in, and it keeps working with no variable change.
- **`production` and `staging` are the only recognised values**; case and surrounding whitespace
  are ignored, so `Staging` and ` staging ` both work.
- **Any other value refuses to start.** `DEPLOYMENT_ROLE=stagging` aborts the boot with an error
  naming the value it got and the values it accepts. This is deliberate: an unset variable means
  nobody made a claim, so the safe default applies — but a *set* one means somebody intended
  something specific, and if we cannot tell what, the one reading we must not quietly pick is the
  one that lifts every lock. You meet that failure as a failed deploy, which costs minutes; the
  alternative is a test instance that can alarm the station, which costs a callout.
- There is no value that *unlocks* anything. Whatever you put in this variable you get exactly
  one of three outcomes: ordinary production behaviour, more refusals, or no process at all.
- This is a separate axis from `ENVIRONMENT` (§4). A test instance on Railway is still a
  *production* environment in the hardening sense — mandatory secrets, no auth bypass, no sample
  data — and that is intended: what gets tested should be the path that runs live.
- Give the test instance **its own** `SECRET_KEY` and `AUTH_SECRET_KEY`, and its own webhook
  secrets, so a link copied from one does not work against the other.
- A copy of a real database is real personal data at a second address, not a test fixture. Give
  the instance the same access restrictions as the original, refresh the copy rather than letting
  it age, and do not enable a shared demo login on it.

---

## 6. What you give up compared to docker-compose

Worth knowing before you commit, not after.

| | docker-compose | Railway |
|---|---|---|
| **Internet outage** | Board and printing keep working on the LAN | Everything is unreachable |
| **Offline map tiles** | Yes, tileserver behind `/tiles` | **No** — see below |
| **Real-time sync** | Always (single origin routes `/socket.io`) | Yes, with `API_URL` set (§1.1) |
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

### 8.1 Rolling back code leaves the database ahead — and the app will not start

This one has bitten this project, so it is written down rather than learned twice.

`start.sh` runs `alembic upgrade head` on every boot. If a newer version ever ran — even for a
single deploy, even by accident — its migrations are already applied and `alembic_version`
holds a revision id that **the older code does not contain**. Roll the code back and the boot
fails with `Can't locate revision identified by '<id>'`; `set -e` ends the container, the
health check never passes, and the service serves 502 while the dashboard cheerfully reports
the last good deployment as "Online".

The symptom looks like a broken rollback. It is a database that is ahead of its code.

**Recovering, in order:**

1. Find the older code's head revision — the one migration file in that version whose id is
   nobody's `down_revision`.
2. Decide which way to go:
   - **Forward** (usually right): redeploy the newer version. The database already matches it.
   - **Back**: run the *newer* version's `alembic downgrade <older-head>` against the database.
     Use the migrations' own `downgrade()` functions; do not hand-write `DROP`s. You need a
     checkout of the newer code to do this, because the older one does not contain the files.
3. `alembic stamp` is the emergency lever, not the fix: it changes the version pointer without
   touching the schema, so the database and the pointer disagree afterwards. If you use it to
   get a service up, write down that the schema is still ahead — the next real upgrade will try
   to create objects that already exist and fail.

**Prevention:** never let a deployment target a branch that carries migrations the running
version does not have. That includes "just to see if it builds".

### 8.2 Two Railway settings that do not behave the way they read

- **`railway.json` beats the dashboard.** A value committed in `deploy` cannot be changed in the
  UI — the file is reapplied on every deploy. To differ per environment, use the schema's
  top-level `environments` key instead of editing the dashboard:

  ```json
  {
    "deploy": { "sleepApplication": false },
    "environments": {
      "staging": { "deploy": { "sleepApplication": true } }
    }
  }
  ```

- **The deploy branch is per environment — but only the dashboard can set it.** Two
  environments of the same project can genuinely watch different branches (verified: staging on
  `develop`, production on `main`, at the same time). The CLI cannot get you there, and it fails
  in two different ways:

  | Command | What it does |
  | --- | --- |
  | `railway service source connect --branch X --environment Y` | Accepts `--environment` and **ignores** it. A service has one id across every environment, and this writes the branch on the *service* — so pointing staging at another branch **also repoints production**, which then deploys and migrates. |
  | `railway environment edit --service-config <svc> source.branch X` | Environment-scoped by name, but observed to apply **nothing at all** and report no error. |

  So: set it in the dashboard, and read the result back before trusting it
  (`railway environment config --environment <name> --json`, look for `source.branch`). To
  deploy a specific state without touching any branch setting, `railway up --service <s>
  --environment <e>` uploads the working tree and cannot affect another environment.

  General rule for a shared service: before changing anything, establish whether the setting is
  per environment or per service, and **verify afterwards** — a CLI flag being accepted is not
  evidence that it did anything.

---

## 9. Backups

**Railway is not the same problem as Compose, and this section says plainly what you do and do
not get.** There is no cron container to lean on and no host filesystem outside the volume, so
the scheduled sidecar from [`DEPLOYMENT.md` §6](DEPLOYMENT.md#6-backups) **does not exist here**.
What you have instead is three things, two automatic and one not:

**1. The database — covered, by Railway.** Managed PostgreSQL takes automatic backups with
point-in-time recovery. Check the retention on your plan in the database service's *Backups*
tab; do not assume it is what you want. This is a genuinely good backup and it is the reason
this page does not try to rebuild one.

**2. Before every migration — covered, by us.** The backend takes a `pg_dump -Fc` snapshot on
boot whenever a migration is pending, into `/mnt/data/backups` on the volume, newest 5 kept.
That is the gap Railway's nightly cannot close: a deploy that migrates live data at 14:20 and
goes wrong is not helped by a backup from 03:00. Watch the deploy log for the line naming the
snapshot file — or for `WARNING: pre-migration snapshot FAILED`, which means the migration below
it ran with no way back.

**3. The photos — NOT covered by anything automatic.** Reko photos live on the `/mnt/data`
volume. They are not in the database, so Railway's database backup does not contain them, and
Railway's volume backups (where offered) are not something this project can schedule for you. A
database restored without them is a complete operational record pointing at missing images.

So: **put a recurring reminder in the calendar** — monthly is a reasonable pace for a station,
and after any big Einsatz with Reko photos. From a machine with `railway` and a Postgres client
at least as new as the server (17.x today; `pg_dump` 15 will refuse outright with "server
version mismatch"):

```bash
railway link                                                    # select the project

# Database, custom format — same file the compose path produces.
railway run bash -c 'pg_dump -Fc --no-owner --no-privileges "$DATABASE_URL"' > kprueck-$(date +%F).dump
pg_restore --list kprueck-$(date +%F).dump | head    # prove it is readable BEFORE you trust it

# Photos, from the volume, through the backend service.
railway ssh --service backend 'tar czf - -C /mnt/data/photos .' > photos-$(date +%F).tar.gz
```

The inner command must be **single-quoted**: `railway run` injects the variables into the
process it starts, so `$DATABASE_URL` has to survive your local shell unexpanded.

No matching client to hand? Borrow one:

```bash
railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL   # host/port/password
docker run --rm postgres:17-alpine pg_dump -Fc "postgresql://…" > kprueck-$(date +%F).dump
```

**What is honestly not achievable here.** A scheduled, unattended backup of *both* halves,
inside the Railway project, with retention this project controls. It would need either a cron
service on the paid tier running the same script against `DATABASE_URL` and a shared volume, or
an external machine that pulls on a timer — and an external machine that pulls is exactly what a
Railway deployment was chosen to avoid. If your station cannot rely on a monthly manual pull,
that is a real argument for the Compose path, not something to paper over.

Verify a restore occasionally rather than assuming it works — a backup nobody has restored is a
hypothesis. [`DEPLOYMENT.md`](DEPLOYMENT.md) §6.1 has the restore procedure and it applies here
too; restore into a scratch database (a local `postgres:17` container is enough), not into
production.

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
The WebSocket is not connecting and it has fallen back to polling. Check, in this order:
`API_URL` is set on the frontend service and names the backend's **public** origin (a
`*.railway.internal` address or a bare service name is deliberately ignored — the browser
cannot reach it); the frontend has been **restarted** since you set it; `CORS_ORIGINS` on the
backend matches the frontend origin exactly. All three are runtime values, so a **restart** is
enough — the Content-Security-Policy follows `API_URL` per request and no longer needs a
rebuild to allow a custom backend domain.

**Mobile login fails with "Sitzung abgelaufen", desktop works.**
`NEXT_PUBLIC_API_URL` is set on the frontend service. Delete it — and then **force a rebuild**,
because two things that look like they would work do not:

```bash
railway variable delete NEXT_PUBLIC_API_URL --service frontend
railway redeploy --service frontend --from-source --yes    # NOT plain redeploy
```

Deleting the variable triggers no deploy on its own, and a plain `railway redeploy` re-deploys
the existing *build artifact* with the old value still baked in. Only `--from-source` pulls the
commit and rebuilds. Because the value only matters at build time, every check short of the
rebuild — page loads, health, even the CSP header — comes back green while nothing has actually
changed. Confirm it took by fetching the page and grepping the `/_next/static/chunks/*.js` for
your backend host: zero hits means the inlining is gone.

Nothing else depends on the variable: the socket takes its address from `API_URL`, and so does
the Content-Security-Policy.

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

- [ ] Frontend: `API_URL` points at the backend's public origin (§1.1) — this is what makes
      real-time sync work; the `<name>` / `<name>-api` domain convention is only tidiness (§1.2)
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

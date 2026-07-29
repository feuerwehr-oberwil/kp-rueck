# SETUP – from nothing to a board your command post can run on

This is the **ordered path**, written for someone setting KP Rück up for their own fire station
for the first time. It links to the reference docs rather than repeating them:
[`DEPLOYMENT.md`](DEPLOYMENT.md) is the infrastructure reference,
[`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md) covers alarm intake, and
[`AUSFALL_SOP.md`](AUSFALL_SOP.md) is the paper fallback you should read before you rely on any
of this.

Budget roughly **half a day** for steps 1–3 and a **second session** for the roster and fleet.
After step 3 the board is usable with hand-entered resources.

---

## 0. Before you start

Have these in hand. Every one of them is something people go looking for halfway through.

| You need | Notes |
| --- | --- |
| A Docker host | One station's board is not demanding. Disk grows with Reko photos and offline map tiles – the tiles are the big item, budget for them if you use them. |
| A domain (recommended) | An `A`/`AAAA` record pointing at the host. Set `DOMAIN` and Caddy gets a certificate automatically. Without one you run plain HTTP on a trusted LAN – see the gotchas in §7. |
| Your station's resources | Personnel, vehicles, materials. Bulk-loaded from an Excel template in step 3 – you do not have to type them in. |
| Optional: a Divera 24/7 access key | Only for alarms, outbound alerting and roster sync. Everything works without it. |
| Optional: a thermal printer | For dispatch slips and QR walk-in slips. Runs as a separate agent, added in step 5. |

**One decision worth making now:** KP Rück is single-tenant. One deployment serves one station.
Several stations means several deployments, not one instance with a switch.

---

## 1. Get it running

**Two ways, pick one.** Everything from §2 onward is the same either way — this is the only
step that differs.

| | Who it suits |
| --- | --- |
| **Docker Compose on your own box** (below) | You have, or want, a machine in the Gerätehaus. The board and the printer keep working through an internet outage, and offline map tiles are available. |
| **Railway**, a managed platform — [`RAILWAY.md`](RAILWAY.md) | You would rather not look after a server at all. Same images, same releases. No offline tiles, and read its §1 before naming the services. |

If you chose Railway, follow that guide now and rejoin at §2 below.

### Docker Compose

```bash
git clone https://github.com/feuerwehr-oberwil/kp-rueck.git
cd kp-rueck
git checkout "$(git tag -l 'v*' --sort=-v:refname | head -n1)"   # newest release, not main – see §6
cp .env.example .env
```

You only need the clone for `docker-compose.yml` and `.env.example` – the stack itself runs from
published images and never builds from this source.

> **If you print, set `PRINT_AGENT_TOKEN` before you expose the stack** (step 5 covers the agent
> itself). On releases that predate the fail-closed fix – check the `Security` section of
> [`CHANGELOG.md`](../CHANGELOG.md) for the version you picked – the four print-agent endpoints
> accept *any* request while the token is unset, which on a public host means anyone can read the
> printer configuration and claim print jobs. Setting the token closes that on every version.

Fill in the five required values. All of them matter and none has a safe default:

```bash
POSTGRES_PASSWORD=…          # any strong value
SECRET_KEY=…                 # openssl rand -hex 32  – KEEP STABLE
AUTH_SECRET_KEY=…            # openssl rand -hex 32  – KEEP STABLE, signs logins
ADMIN_SEED_PASSWORD=…        # ≥12 chars – this is your first login
VIEWER_PASSWORD=…            # ≥12 chars – the read-only account for wall displays and guests
```

Then the networking, which is where first-time setups usually go wrong:

```bash
DOMAIN=kp.example.ch                 # empty = plain HTTP on HTTP_PORT
CORS_ORIGINS=https://kp.example.ch   # MUST match how browsers actually reach it – this is the
                                     # allowed CORS origin. On a LAN: http://<host>:<HTTP_PORT>
AUTH_COOKIE_SECURE=                  # set to false ONLY if you serve plain HTTP – see §7
```

> `CORS_ORIGINS` was called `PUBLIC_URL` until 0.2. The old name still works, so an existing
> installation needs no change – but rename it when you next touch the file. KP Front has a
> `PUBLIC_URL` that means something unrelated, so copying one `.env` across as a starting point
> broke CORS with no error message. If you run both, read
> [`RUNNING-BOTH.md`](RUNNING-BOTH.md) before you start the second stack.

Start it:

```bash
docker compose up -d
```

All four images (backend, frontend, tileserver, print-agent) share one `KP_RUECK_TAG` and are
released together – a station runs the set, not a mix. Migrations run on boot.

## 2. Take over the seeded accounts

Log in as **`admin`** with your `ADMIN_SEED_PASSWORD`, then:

1. **Change that password.** It was in a file on disk before it was a login.
2. Create the accounts your crew will actually use. Roles are **Editor** (full CRUD) and
   **Viewer** (read-only).
3. Check that the **viewer** account works – it is what wall displays and guests use, and it is
   easy to leave untested until the evening you need it.

The shared `editor` convenience login is a development thing and is never seeded in production.

## 3. Load your station's resources

**A production deployment starts with an empty board** – no vehicles, no personnel, no
materials. That is deliberate: seeding a fictional station's fleet and roster would mean your
first real act was deleting somebody else's data, and a restored backup would put it back. The
board fills up here. (A `just dev` machine still comes up with sample resources; that is a
development fixture, not something a real deployment inherits.)

You do not type in a roster. There is an Excel round-trip:

1. Download the import template from the admin surface (`GET /api/admin/import/template`).
2. Fill in personnel, vehicles, and materials.
3. Upload it as a **preview** first – it tells you what it parsed and what it would change.
4. Then execute the import.

Preview before execute, always. It is the only cheap moment to notice that a column was
misread.

Then set your station's identity – branding, groups, special functions – through the settings
surface. Vehicles and personnel can also be created and edited individually afterwards; the
Excel path is for the bulk of it.

## 4. Offline map tiles (do this before you need them)

> **Docker Compose only.** Offline tiles need a reverse proxy routing `/tiles` to the
> tileserver, which a Railway deployment does not have — there the map uses online OSM and
> goes blank without an uplink. If that matters to your station, it is the strongest argument
> for running your own box.

The board's map works from public OSM tiles, but a command post that loses its uplink loses its
map with it. The bundled tileserver fixes that:

```bash
just tiles-download          # pulls the region's tiles into the tileserver volume
just tiles-status            # confirm they landed
```

**The defaults cover Basel-Landschaft**, which is almost certainly not your area. Your region is
four environment variables, not a code change:

```bash
TILES_REGION="Oberbayern" \
TILES_BOUNDS=11.0,47.7,12.3,48.4 \
TILES_AREA=oberbayern \
TILES_PBF_URL=https://download.geofabrik.de/europe/germany/bayern/oberbayern-latest.osm.pbf \
  just tiles-download
```

Find your bounding box at [boundingbox.klokantech.com](https://boundingbox.klokantech.com/) (CSV
output) and your extract at [download.geofabrik.de](https://download.geofabrik.de/). Be generous
at the edges – an incident just outside the box has no offline map.

This is a large download and a large volume. Do it on a quiet afternoon, not during setup of the
first live event. See [`OFFLINE_MAPS.md`](OFFLINE_MAPS.md).

## 5. Connect what you have (all optional)

Every integration is proxied by the backend and optional; `GET /api/integrations` reports which
are live, and the UI adapts rather than hard-coding vendors.

- **Divera 24/7** – `DIVERA_ACCESS_KEY` covers inbound alarms, outbound alerting
  (Ausalarmierung), and roster sync. From Divera: Administration › Settings › Interfaces › API.
- **Any other dispatch system** – `POST /api/alarms` works with no vendor account. Set its shared
  secret in `.env`, where it **wins over the database value** – this is the scriptable way to
  provision a deployment:
  ```bash
  ALARM_WEBHOOK_SECRET=$(openssl rand -hex 24)
  ```
  Leave it blank and the old behaviour stands: one is generated into the database on first boot
  and has to be read back out with
  ```sql
  SELECT value FROM settings WHERE key = 'alarm_webhook_secret';
  ```
  Running KP Front too? Generate a **separate** secret for each – see
  [`RUNNING-BOTH.md`](RUNNING-BOTH.md). See [`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md).
- **Traccar** – vehicle GPS with status automation and distance labels on the map.
- **Microsoft Entra ID** – set the four `MICROSOFT_*` values for SSO. This is the only external
  identity provider today; without it, local accounts are the path.

  **Also set `SSO_EDITOR_ALLOWLIST`,** or nobody who signs in with Microsoft can change
  anything. *Any* member of your tenant can reach the login, so write access is an explicit
  grant rather than something membership confers: comma-separated e-mail addresses get
  `role=editor` on first login, everyone else is provisioned as a viewer.

  ```bash
  SSO_EDITOR_ALLOWLIST=hans.muster@example.ch,anna.beispiel@example.ch
  ```
- **Thermal printer** – `PRINT_AGENT_TOKEN` plus the `printing` compose profile. The token is
  required, not optional: the agent endpoints are fail-closed and answer `403` without it. The
  agent runs on the host network, so `PRINT_AGENT_BACKEND_URL` cannot use a service name. See
  [`PRINT_AGENT.md`](PRINT_AGENT.md).

## 6. Backups, retention and version pinning

Follow [`DEPLOYMENT.md` §6](DEPLOYMENT.md) for the database and photo-store backup, and **do one
restore into a fresh stack before you go live**. An operational record is only provably
recoverable once you have actually recovered it.

**Decide your audit retention now, not after an incident.** The audit log is what backs an
after-action report months later. `AUDIT_RETENTION_DAYS` defaults to `0`, which means keep
everything — the right default for a record, and the reason it is not a number we picked for
you. If your canton or your own policy says to prune, set the number of days:

```bash
AUDIT_RETENTION_DAYS=0      # keep everything (default)
AUDIT_RETENTION_DAYS=3650   # e.g. a ten-year policy
```

> Earlier releases defaulted to **90 days** and swept silently – the `Changed` entry in
> [`CHANGELOG.md`](../CHANGELOG.md) names the release this flipped in. If you have been running
> one of those, the trail for anything older than 90 days is already gone — worth knowing before
> someone asks you for it.

Pin your version while you are here — **on Compose**; a Railway deployment builds from a branch
of your fork instead, so there you pin by choosing what you merge into it. A full version
(`KP_RUECK_TAG=X.Y.Z`) follows nothing, the
series (`X.Y`) follows patch fixes, `latest` follows everything. A station that updates
deliberately wants one of the first two; which versions exist is the
[releases page](https://github.com/feuerwehr-oberwil/kp-rueck/releases). What a bump costs you is
the table at the top of [`CHANGELOG.md`](../CHANGELOG.md).

---

## 7. The things that bite

Ordered by how often they catch people.

1. **`CORS_ORIGINS` must match how browsers actually reach the deployment.** It is the allowed
   CORS origin. Get it wrong and the frontend loads but every API call fails – which looks like a
   broken app, not a config typo. (It was called `PUBLIC_URL` in earlier releases; that name
   still works as a fallback, and means something different in KP Front.)
2. **`SECRET_KEY` and `AUTH_SECRET_KEY` must never change.** Rotating either logs everyone out.
   Back them up with your secrets, not with your code.
3. **Plain HTTP on a LAN needs `AUTH_COOKIE_SECURE=false`.** Otherwise the browser drops the
   login cookie and sign-in fails with no visible error.
4. **The alarm webhook secret is in `.env` *or* the database.** `.env` wins; blank means one was
   generated into the `settings` table on first boot and you have to `SELECT` it back out.
5. **All four images move together.** Don't pin them individually; one `KP_RUECK_TAG` for the set.
6. **Offline tiles are big, slow to fetch, and default to the wrong region.** Set `TILES_BOUNDS`
   for your area (§4). Not something to start the evening of an event.
7. **Your board starts empty.** Not a broken install – production seeds no resources (§3).

## 8. Before you rely on it in the field

Not a formality – this is the list that separates "it's installed" from "we can run an event on
it".

- [ ] The seeded admin password is changed and real accounts exist.
- [ ] The **viewer** account has been tested on the screen you will actually project.
- [ ] Resources imported and sane: personnel, vehicles, materials all appear on the board.
- [ ] Run a full **training event** end to end: incidents in, resources assigned, a Reko form with
      a photo from a phone, an after-action PDF out. Training mode uses the same UI on the same
      database, filtered by a flag, so this costs you nothing and pollutes nothing. A production
      deployment ships no training *locations* – drop pins on your own map, or add the addresses
      you want to exercise.
- [ ] Print a **paper Lageblatt** and read [`AUSFALL_SOP.md`](AUSFALL_SOP.md) with the people who
      would have to use it. The fallback only works if it was rehearsed before the outage.
- [ ] Offline tiles downloaded **for your region**, and the map confirmed working with the uplink
      pulled. Check the coverage at the edges of your area, not just at the station.
- [ ] One restore drill from backup into a fresh stack.

## 9. Where to go next

- [`DEPLOYMENT.md`](DEPLOYMENT.md) – updating, rollback, backups, troubleshooting.
- [`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md) – the provider-neutral webhook.
- [`AUSFALL_SOP.md`](AUSFALL_SOP.md) – what you do when the software is not available.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) – how the pieces fit together, and why.

Stuck, or something here was wrong for your station? Open an
[issue](https://github.com/feuerwehr-oberwil/kp-rueck/issues) – setup friction is a bug report we
want.

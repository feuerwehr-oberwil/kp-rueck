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
| Four things installed on it | **Docker Engine + Compose v2**, **`git`** (you clone this repository and keep the clone – §1 says why), **`just`** ([casey/just](https://github.com/casey/just), a single binary; every command in this guide that starts `just …` needs it) and **`openssl`**, which is already on any Linux or macOS box and is only used to generate secrets. |
| A domain (recommended) | An `A`/`AAAA` record pointing at the host. Set `DOMAIN` and Caddy gets a certificate automatically. Without one you run plain HTTP on a trusted LAN – see the gotchas in §7. |
| Your station's resources | Personnel, vehicles, materials. Bulk-loaded from an Excel template in step 3 – you do not have to type them in. |
| Optional: a Divera 24/7 access key | Only for alarms, outbound alerting and roster sync. Everything works without it. |
| Optional: a thermal printer | For dispatch slips and QR walk-in slips. Runs as a separate agent, added in step 5. |

**One decision worth making now:** KP Rück is single-tenant. One deployment serves one station.
Several stations means several deployments, not one instance with a switch.

---

## 1. Get it running

**Two ways, pick one.** Everything from §2 onward is the same either way – this is the only
step that differs.

| | Who it suits |
| --- | --- |
| **Docker Compose on your own box** (below) | You have, or want, a machine in the Gerätehaus. The board and the printer keep working through an internet outage, and offline map tiles are available. |
| **Railway**, a managed platform – [`RAILWAY.md`](RAILWAY.md) | You would rather not look after a server at all. Same code, same releases – but Railway **builds from a branch of your fork** instead of running the published images, so there is no `KP_RUECK_TAG` to pin: you pin by choosing what you merge. No offline tiles, and read its §1 before naming the services. |

If you chose Railway, follow that guide now and rejoin at §2 below.

### Docker Compose

```bash
git clone https://github.com/feuerwehr-oberwil/kp-rueck.git
cd kp-rueck
git checkout "$(git tag -l 'v*' --sort=-v:refname | head -n1)"   # newest release, not main – see §6
```

**Keep the whole clone, and run every command from inside it.** This used to say you only needed
`docker-compose.yml` and `.env.example`, which was wrong in a way that costs an evening:
`docker-compose.yml` also mounts `./deploy/Caddyfile` into Caddy and `./scripts` into the backup
sidecar. Download just the two files and Docker helpfully creates an empty *directory* where the
Caddyfile should be, Caddy refuses to start – and because Caddy is the only service that
publishes a port, **nothing is reachable at all**. The error talks about Caddy, not about a file
you never copied. The stack still never *builds* from this source; it just reads two paths out
of it.

Now write your `.env`:

```bash
just init
```

Three decisions – an admin password, a viewer password, and how the board is reached – and it
writes a complete `.env`: `SECRET_KEY`, `AUTH_SECRET_KEY` and `POSTGRES_PASSWORD` generated for
you, and `DOMAIN` / `HTTP_PORT` / `CORS_ORIGINS` derived from your answer about the domain. It
refuses to overwrite an existing `.env`, so it is safe to run twice. Five hand-edits into a long
file is where typos happen, and a typo in `CORS_ORIGINS` produces a board that loads and then
fails at everything.

> **Printing?** Set `PRINT_AGENT_TOKEN` in `.env` now – step 5 sets up the agent itself. From
> **0.2.0** the print-agent endpoints are fail-closed and answer `403` without it. On **0.1.x**
> they accept *any* request while the token is unset, so on a public host anyone could read the
> printer configuration and claim print jobs. Setting the token is right on every version.

<details>
<summary><strong>By hand instead</strong> (no <code>just</code>, or you want to see every line)</summary>

`cp .env.example .env` and fill in the five required values – none has a safe default:

```bash
POSTGRES_PASSWORD=…          # any strong value
SECRET_KEY=…                 # openssl rand -hex 32  – KEEP STABLE
AUTH_SECRET_KEY=…            # openssl rand -hex 32  – KEEP STABLE, signs logins
ADMIN_SEED_PASSWORD=…        # ≥12 chars – this is your first login
VIEWER_PASSWORD=…            # ≥12 chars – the read-only account for wall displays and guests
```

Then the three networking lines, which is where first-time setups usually go wrong. With a
domain:

```bash
DOMAIN=kp.example.ch
HTTP_PORT=80                         # not 8080: with a domain, port 80 has to be published
CORS_ORIGINS=https://kp.example.ch   # MUST match how browsers actually reach it
```

On a LAN with no domain:

```bash
DOMAIN=
HTTP_PORT=8080
CORS_ORIGINS=http://192.168.1.50:8080   # this host's address and HTTP_PORT, no trailing slash
```

`CORS_ORIGINS` is the URL browsers actually type. Get it wrong and the frontend loads while every
request behind it fails – which looks like a broken app, not a config typo. You do **not** need to
touch `AUTH_COOKIE_SECURE`: the backend reads this same value and, seeing a plain `http://`
origin, sends the login cookie without the `Secure` flag on its own.

</details>

> `CORS_ORIGINS` was called `PUBLIC_URL` until 0.2. The old name still works, so an existing
> installation needs no change – but rename it when you next touch the file. KP Front has a
> `PUBLIC_URL` that means something unrelated, so copying one `.env` across as a starting point
> broke CORS with no error message. If you run both, read
> [`RUNNING-BOTH.md`](RUNNING-BOTH.md) before you start the second stack.

### Start it, and check that it started

```bash
just up          # = docker compose up -d, then waits for the backend and prints your URL
```

**The first boot takes two to three minutes**, and `just up` prints a dot every few seconds so
you can tell it apart from a hang. It is not stuck: the backend pulls its image, runs the
database migrations and seeds the accounts before it answers anything at all – which is why the
compose healthcheck gives it 90 seconds of grace before it even starts asking. Every later start
is quick.

All four images (backend, frontend, tileserver, print-agent) share one `KP_RUECK_TAG` and are
released together – a station runs the set, not a mix.

Then confirm it, rather than assuming:

```bash
just doctor              # containers, /health, tiles, last backup, running tag – one screen
docker compose ps        # the raw version: every service should be Up, backend "(healthy)"

# and the endpoint itself – LAN deployment:
curl http://localhost:8080/health
# with a domain (Caddy answers only for that hostname, so localhost would 404):
curl https://kp.example.ch/health
# → {"status":"healthy","disk":{…}}
```

`curl` is the honest test, because it takes your browser's cache and cookies out of the picture.

**Now open the board.** The address depends on the answer you gave `just init`:

| Your setup | Open |
| --- | --- |
| A domain (`DOMAIN=kp.example.ch`) | `https://kp.example.ch` – Caddy fetches the certificate on the first request, so the very first load can take a few seconds |
| LAN, no domain | `http://<this host's IP>:<HTTP_PORT>`, e.g. `http://192.168.1.50:8080` – the same URL you put in `CORS_ORIGINS` |

You should get a login form. If you get anything else – a blank tab, a bare 404, "connection
refused" – do not start over: [`DEPLOYMENT.md` §9](DEPLOYMENT.md#9-troubleshooting) is indexed by
exactly what you are looking at.

## 2. Take over the seeded accounts

Log in as **`admin`** with your `ADMIN_SEED_PASSWORD`, then:

1. **Change that password.** It was in a file on disk before it was a login. It lives in
   **Einstellungen → Konfiguration → Benutzer**: find your own row, use **Passwort zurücksetzen**,
   type the new one.

   There is no "change my own password" page, and you are not missing it – it does not exist.
   Every password change in KP Rück is an admin resetting somebody's password, including their
   own (`POST /api/users/{user_id}/reset-password`). Which means the **Benutzer** tab is
   admin-only, and an editor who wants a new password has to ask you.
2. Create the accounts your crew will actually use, in the same place. Roles are **Editor** (full
   CRUD) and **Viewer** (read-only).
3. Check that the **viewer** account works – it is what wall displays and guests use, and it is
   easy to leave untested until the evening you need it.

**The viewer password is the one exception, and it bites much later.** `ADMIN_SEED_PASSWORD`
applies exactly once, when the database is created; after that the app owns it. `VIEWER_PASSWORD`
is different: the backend re-applies it from `.env` on **every boot**. So a viewer password you
change in the user list looks fine, works all evening, and silently reverts to the `.env` value at
the next restart or update – which is how a wall display stops logging in weeks later, for no
reason anybody can connect to anything. **Rotate the viewer password in `.env` and restart**, not
in the app. (It is built that way on purpose: the kiosk account is the one a station most easily
loses the password to, and a way back in that does not involve SQL is worth this asymmetry.)

Two accounts in that list will look wrong, and both are fine:

- **`editor` is absent.** The shared `editor` convenience login is a development thing and is
  never seeded in production – real editors come from SSO or from the account you just created.
- **`dev-user` is present**, as "Development User", role admin, id `00000000-…-000000000000`. It
  is a placeholder row that exists so the development auth bypass has something for its
  foreign keys to point at, and it is created unconditionally by the seed, production included.
  Its password hash is empty and the login endpoint rejects an empty hash before it checks
  anything, so **it cannot be logged into**, and on a production deployment nothing ever acts as
  it – the bypass that would use it is refused outright when `ENVIRONMENT=production`. Leave it;
  deactivating it is harmless if you prefer a tidy list. Permanent deletion is also safe on a
  production stack (nothing references it there), but it buys you nothing.

## 3. Load your station's resources

**A production deployment starts with an empty board** – no vehicles, no personnel, no
materials, no training locations. That is deliberate: seeding a fictional station's fleet and
roster would mean your first real act was deleting somebody else's data, and a restored backup
would put it back. What the first boot *does* create is configuration, not data: your `admin` and
`viewer` accounts, the default settings row (polling interval, map mode, a placeholder station
name and coordinates you will overwrite below), the generated alarm-webhook secret, the
`dev-user` placeholder from §2, and the library of Alarm-/Einsatzstichwort templates the training
generator draws on. So a curious operator running `SELECT count(*)` will find rows – just none
that claim to be your station's people or vehicles. (A `just dev` machine still comes up with
sample resources and sample incidents; that is a development fixture, not something a real
deployment inherits.)

You do not type in a roster. There is an Excel round-trip, and it lives at
**Einstellungen → Daten → Import/Export**:

1. **Vorlage herunterladen** – the empty workbook, with the right sheets, headers and a few
   example rows (`GET /api/admin/import/template`). The examples are labelled
   `BEISPIEL – Zeile löschen` in the first column and are **ignored on import**, so you can
   delete them or type your roster underneath them and leave them there; either way they never
   reach the board. (They used to import, which is how a station ended up with Max Mustermann
   on the roster.)
2. Fill in personnel, vehicles and materials. Format rules below – read them once, they are
   short.
3. **Datei auswählen**, then pick a mode under **Import-Modus wählen** (next heading), then
   **Vorschau anzeigen** (`POST /api/admin/import/preview`).
4. Read the preview. Then **Jetzt importieren** (`POST /api/admin/import/execute`).

All four are **editor** rights, not admin – the tab is hidden from viewers and shown to any
editor. (This guide used to call it "the admin surface"; it never was.)

<details>
<summary><strong>Driving it from a script instead</strong> (provisioning a station unattended)</summary>

Everything in this guide can be done from a shell. The one thing worth writing down, because it
costs an unexplainable error otherwise: **the login endpoint is form-encoded, not JSON.** Posting
JSON gets you `422 {"loc":["body","username"],"msg":"Field required"}`, which reads like the
field is missing when it is the encoding that is wrong.

```bash
BASE=http://localhost:8080          # your CORS_ORIGINS
curl -sc jar -X POST "$BASE/api/auth/login" \
     -d "username=admin&password=$ADMIN_SEED_PASSWORD"      # -d, not --json

# the session cookie in `jar` then carries every later call
curl -sb jar "$BASE/api/admin/import/template" -o template.xlsx
curl -sb jar -X POST "$BASE/api/admin/import/preview" \
     -F "file=@roster.xlsx" -F "mode=append"
```

Collection routes need their **trailing slash** – `/api/personnel` answers `307`, and a redirected
POST arrives without its body, so a scripted write silently does nothing and looks like it worked.

The full contract is [`docs/openapi.json`](openapi.json), committed and regenerated on every
release. It is the reference to use: Swagger UI is disabled on a production deployment.

</details>

### The two modes, and the one that eats your roster

| Mode | What it does |
| --- | --- |
| **Ersetzen** (`replace`) | Empties the tables your workbook has a sheet for, then inserts the workbook. A sheet you left out is not touched – it is refused, see below. |
| **Anhängen** (`append`) | Keeps everything that is there and adds the workbook's rows on top. |

`Ersetzen` is the right mode exactly once: today, filling an empty board. **The second use is
where it hurts.** Next year you add two recruits, put two rows in a sheet, upload it – and if the
mode is still `Ersetzen` you have just deleted eighteen people, five vehicles and twenty-six
material items and replaced them with two rows. It has happened. For "two recruits" the mode is
**Anhängen**; there is no mode that updates existing rows by name, so corrections to people who
already exist are made in the UI, one at a time.

> There used to be a third mode, `merge`, documented as "update existing by name, add new". It
> never did that – it ran exactly the same deletions as `replace`. It is now rejected with an
> error naming `replace` and `append` and what each does, rather than kept as a name that means
> the opposite of what it says. If you have a script posting `mode=merge`, change it to `append`.
>
> While you are in there: **the mode is mandatory**. There is no default any more – a request
> that omits it is rejected rather than quietly running `Ersetzen`. The UI always sends one, so
> this only concerns scripts posting to the endpoint directly.

**`Ersetzen` is refused outright while resources are still assigned on a running incident.** You
get *«Import im Modus 'replace' abgelehnt: N aktive Zuteilung(en) …»* and nothing is deleted.
Release those resources or close the incidents first, or import with **Anhängen**. Assignments
that were already released do not block the import – they are history – but they are still
counted in the preview, because after an `Ersetzen` they too point at people and vehicles that no
longer exist.

**Read the preview rather than clicking past it.** It shows the first ten rows of each sheet as
the importer understood them, and how many rows it parsed in total. That catches a misread
column, which is what it is for.

> **What it does not yet show is what `Ersetzen` would delete.** The backend computes those
> figures – personnel, vehicles, materials, and the incident assignments that would be left
> pointing at resources which no longer exist – and returns them, but the screen does not
> display them yet. So the preview looking calm is not evidence that nothing is about to be
> deleted.
>
> Until it does: **before you ever run `Ersetzen` on a board that already has data, export
> first** – **Einstellungen → Daten → Export** – and keep that file. It is the same workbook
> shape, so it is also the thing you re-import to undo a mistake.

Two refusals do protect you, and they are real rather than advisory – see the two paragraphs
above: `Ersetzen` is rejected while resources are still assigned on a running incident, and
rejected when the workbook leaves out a sheet whose table has rows. What gets through is the
quiet case: replacing an 18-person roster with two rows on a board with nothing running.

### What the workbook does and does not enforce

The workbook carries exactly one piece of cleverness, and it is worth knowing: **rows whose name
starts with `BEISPIEL – Zeile löschen` are dropped on import**, matched ignoring case and
surrounding spaces. That is the whole of it. Otherwise the template is a plain workbook: no
instructions sheet, no drop-downs, no cell validation. Excel
will let you type anything. The importer checks the file on upload and refuses the whole thing
rather than importing half of it – and it tells you where: *«Excel-Datei konnte nicht verarbeitet
werden: Vehicles Zeile 7 – ungültiger Status 'einsatzbereit'. Erlaubt: available, unavailable.»*
Sheet, row and the offending value. Fix that cell and upload again.

**Sheet names and header rows must match exactly** – `Personnel`, `Vehicles`, `Materials`, with
the template's English column names in the template's order. Rename a column and the upload is
rejected.

**A missing sheet and an empty sheet mean opposite things**, and `Ersetzen` treats them that way:

- **Sheet left out entirely** – refused, if that table currently has rows. You get an error
  naming the missing sheets and how many rows were at stake. This is the one that used to be
  silent: a workbook containing only `Personnel` deleted the fleet and the material inventory
  and put nothing back, and reported success.
- **Sheet present with only its header row** – accepted, and it empties that table. That is the
  deliberate way to clear something, which is why the two cases cannot be collapsed into one.

> **The sharp edge, now that the example rows are skipped.** A sheet whose only rows are the
> untouched examples counts as **empty**, not missing – the examples are dropped, and what is
> left is a present sheet with nothing in it. So downloading the template, filling in only
> `Vehicles`, and importing with **Ersetzen** clears your personnel and material tables. It no
> longer adds two fictional firefighters, but it does not leave those tables alone either. Fill
> every sheet, or use **Anhängen**.

If you only want to touch one of the three, either use **Anhängen**, or export first
(**Daten → Export**) and edit the full workbook so the other two sheets carry their current
contents.

| Sheet | Column | Required | Legal values |
| --- | --- | --- | --- |
| `Personnel` | `name` | yes | free text |
| | `role` | no | **free text** – see below |
| | `status` | no | `available` or `unavailable`; blank becomes `unavailable` |
| `Vehicles` | `name` | yes | free text |
| | `type` | yes | **free text** – `TLF`, `DLK`, `MTW`, `KDO`, `VRW`, `RW`, `Anhänger` are the usual ones, but nothing enforces them |
| | `display_order` | yes | a whole number – it is the left-to-right order on the board |
| | `status` | yes | `available` or `unavailable` |
| | `radio_call_sign` | yes | free text, e.g. `Florian 1` |
| `Materials` | `name` | yes | free text |
| | `type` | yes | **free text** – the functional group, e.g. `Tauchpumpen` |
| | `location` | yes | **free text** – where it is stowed, e.g. `TLF`, `Pio` |
| | `description` | no | free text |

**The three that say "free text" really are free text**, and that is good news rather than an
admission: `role`, vehicle `type` and material `type`/`location` are stored as you write them, so
`Atemschutzgeräteträger` is a legal role and so is `Maschinist Pumpe 2`. Nothing will reject it
weeks later and no filter will quietly fail to match it – the board groups and filters on the
strings you supplied. The one thing to get right is **spelling them the same way every time**:
`Maschinist` and `maschinist` are two different groups. The two `status` columns are the real
enums, and they are the only two.

### Then set your station's identity

Branding, groups and special functions are settings, not imports. **Three of them are not
optional**, because the seed fills them with a placeholder station that is not yours:

| Setting key | What the seed leaves there | What it decides |
| --- | --- | --- |
| `firestation_name` | `Feuerwehr Musterstadt` | The label on your station's own marker on the map |
| `firestation_latitude` | `47.5596` | Where that marker sits, where the map centres when no incident has coordinates yet, and which area address search is biased towards |
| `firestation_longitude` | `7.5886` | – |

Those coordinates are a generic point in the Basel area, and they are not only cosmetic. **The
map centres on them** whenever the board has no located incident on it – i.e. every time you open
it before an event – and the address search sorts its results by distance from them, so typing a
street name offers you streets near the wrong town first. Nothing *looks* broken; the addresses
you eventually pick are still right. That is exactly why this is a day-one job rather than
something you notice mid-event.

Empty is no better than placeheld: if the three are ever blank – a hand-edited database, or a
read-only display opened by token, which does not fetch settings at all – the map falls back to
coordinates hard-coded in `frontend/components/map-view.tsx`, in Oberwil BL, the station this was
written for. Same problem, different wrong town. **Every station has to set these**; there is no
default that is right for anybody but us.

Find your station's coordinates by right-clicking it in Google Maps, or on
[openstreetmap.org](https://www.openstreetmap.org/) (right-click → *Show address*); decimal
degrees, WGS84, latitude first. Four decimals is about ten metres, which is plenty.

The neighbouring settings – **Einsatzgebiet (Ort)**, **Funkrufname**, **Karten-Modus**,
**Kartenstil** – are already under **Einstellungen → Konfiguration → Allgemein**, and the
`Einsatzgebiet` is worth filling in at the same time: it is what shortens addresses on the board.

<!-- TODO: replace the paragraph below with the real path once the station-identity control
     ships (Einstellungen → Konfiguration → …). Not present in
     frontend/app/settings/page.tsx as of 2026-08-16. -->

> **The three station-identity fields are the ones with no control yet.** One is being built.
> Until it lands they are ordinary settings keys over the API – `PATCH
> /api/settings/firestation_name` and the same for the two coordinates, editor rights, one call
> each. They have been writable that way since **0.4.0**; what has been missing is somewhere to
> click. Earlier versions of this guide claimed they were already on the settings page. They
> were not, and this is where that gets said out loud.

Vehicles and personnel can also be created and edited individually afterwards; the Excel path is
for the bulk of it, and for the yearly tidy-up.

## 4. Offline map tiles (do this before you need them)

> **Docker Compose only.** Offline tiles need a reverse proxy routing `/tiles` to the
> tileserver, which a Railway deployment does not have – there the map uses online OSM and
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

**Those four go on the command line, not into `.env`.** `scripts/download-tiles.sh` reads the
shell it was started from, and nothing on the server remembers what you passed – so put the block
above in a small wrapper script or your shell profile, and a tile refresh in two years
reproduces the same coverage instead of quietly rendering Basel-Landschaft again.

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
  Leave it blank and one is generated into the database on first boot instead. An **admin** can
  then read it back – or replace it – without a database shell:
  `GET /api/settings/alarm-webhook-secret` shows the current value and says whether it comes
  from `env` or the `database`, and `POST /api/settings/alarm-webhook-secret/rotate` issues a
  new one. Rotation is **refused with a `409` while `ALARM_WEBHOOK_SECRET` is set in `.env`**,
  because the env value wins: rotating would change a value nobody reads, and you would hand
  your dispatcher a secret that rejects every alarm. Change a pinned secret in `.env` and
  restart the backend.

  <!-- TODO: name the settings page location once the reveal/rotate control ships
       (Einstellungen → …). It is not on the page as of 2026-08-16. -->

  Reading it straight out of the database still works and is the fallback for a deployment whose
  UI you cannot reach; it is no longer the documented route. Running KP Front too? Generate a
  **separate** secret for each – see [`RUNNING-BOTH.md`](RUNNING-BOTH.md). Full detail:
  [`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md).
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
- **Thermal printer** – three lines in `.env`, then `just up`:
  ```bash
  COMPOSE_PROFILES=backup,printing   # ADD to the list – see the warning below
  PRINT_AGENT_TOKEN=…                # openssl rand -hex 24. Required, not optional: the agent
                                     # endpoints are fail-closed and answer 403 without it.
  PRINT_AGENT_BACKEND_URL=…          # the SAME URL as CORS_ORIGINS
  ```
  ```bash
  just up
  docker compose ps print-agent      # Up
  docker compose logs print-agent    # job-poll lines = the token matched
  ```
  > **Do not use `docker compose --profile printing up -d`.** Compose reads `COMPOSE_PROFILES`
  > as the *default value* of `--profile`, so passing the flag **replaces** the list instead of
  > adding to it – it switches the `backup` profile off. The sidecar is then never created, and
  > a container that does not exist cannot report itself unhealthy, which is the one backup
  > failure with no signal at all. Edit the list in `.env` instead.

  `PRINT_AGENT_BACKEND_URL` has its own trap: the agent runs on the host network, so it cannot
  use a Docker service name – and Caddy routes by hostname, so `http://localhost:8080` on a
  deployment with a `DOMAIN` arrives with `Host: localhost`, matches no site, and returns a 404
  that reads exactly like a wrong token. Use the same URL you put in `CORS_ORIGINS`.
  See [`PRINT_AGENT.md`](PRINT_AGENT.md).

## 6. Backups, retention and version pinning

**The nightly backup is already running.** `.env.example` ships `COMPOSE_PROFILES=backup`, so the
sidecar came up with your very first `docker compose up -d` and has been dumping since. This
guide used to tell you to switch it on with `docker compose --profile backup up -d`; that command
is a no-op, and the reassurance it gave was the wrong kind.

**What you must change is where the files go.** `BACKUP_HOST_DIR` defaults to `./backups` – inside
this checkout, on the same disk as the database. A copy of the database on the disk that killed
the database is not a backup, it is a second victim. One line in `.env`, then restart the sidecar:

```bash
BACKUP_HOST_DIR=/var/backups/kp-rueck     # anywhere but this checkout – ideally a mount point
                                          # for a second disk or a NAS share
BACKUP_AT=03:30

docker compose up -d                       # picks up the new path
docker compose ps backup                   # "healthy" = a backup has run and was verified
```

**You do not have to wait until 03:30 to find out whether this works.** The sidecar takes one
backup immediately on start (`BACKUP_ON_START`, default on) precisely so that a wrong path, a
full disk or an unwritable directory fails now rather than silently at the first time of asking.
So `docker compose ps backup` should reach `healthy` within a minute or two of the restart above
– if it does not, `cat $BACKUP_HOST_DIR/last-backup.json` names the stage that broke. `just
backup` takes another one by hand whenever you want, which is the thing to do before an update.

`docker compose ps backup` printing nothing at all is the one answer to worry about: it means the
profile is not active, i.e. `COMPOSE_PROFILES=backup` got lost out of `.env`. A container that
does not exist cannot report itself unhealthy, so that is the one failure mode with no signal.

What you get is a verified Postgres dump plus the Reko photo volume every night, keeping 14
dailies and 8 weeklies. It says so out loud when it fails – `docker compose ps` shows the
service `unhealthy`, and `last-backup.json` in the backup directory names the stage that broke.
[`DEPLOYMENT.md` §6](DEPLOYMENT.md#6-backups) has the details, including the retention reasoning
and the client/server version trap.

Then do the two things the backup is worthless without:

1. **Copy it off this box.** Everything above lives on the machine whose death is the reason
   backups exist. A NAS mount, an `rsync` to another host, a bucket, a disk in another room –
   any of them, but one of them.
2. **Restore it once, before you go live** ([`DEPLOYMENT.md` §6.2](DEPLOYMENT.md)). An
   operational record is only provably recoverable once you have actually recovered it.

**Decide your audit retention now, not after an incident.** The audit log is what backs an
after-action report months later. `AUDIT_RETENTION_DAYS` defaults to `0`, which means keep
everything – the right default for a record, and the reason it is not a number we picked for
you. If your canton or your own policy says to prune, set the number of days:

```bash
AUDIT_RETENTION_DAYS=0      # keep everything (default)
AUDIT_RETENTION_DAYS=3650   # e.g. a ten-year policy
```

> Releases before **0.2.0** defaulted to **90 days** and swept silently. If you have been running
> 0.1.x, the trail for anything older than 90 days is already gone – worth knowing before someone
> asks you for it.

Pin your version while you are here – **on Compose**; a Railway deployment builds from a branch
of your fork instead, so there you pin by choosing what you merge into it. A full version
(`KP_RUECK_TAG=X.Y.Z`) follows nothing, the
series (`X.Y`) follows patch fixes, `latest` follows everything. A station that updates
deliberately wants one of the first two; which versions exist is the
[releases page](https://github.com/feuerwehr-oberwil/kp-rueck/releases). What a bump costs you is
the table at the top of [`CHANGELOG.md`](../CHANGELOG.md).

---

## 7. The things that bite

Ordered by how often they catch people. When you are staring at a symptom rather than reading
ahead, go to [`DEPLOYMENT.md` §9](DEPLOYMENT.md#9-troubleshooting) instead – it is the same
material indexed by what you can see.

1. **`CORS_ORIGINS` must match how browsers actually reach the deployment.** It is the allowed
   CORS origin. Get it wrong and the frontend loads but every API call fails – which looks like a
   broken app, not a config typo. (It was called `PUBLIC_URL` in earlier releases; that name
   still works as a fallback, and means something different in KP Front.)
2. **`SECRET_KEY` and `AUTH_SECRET_KEY` must never change.** Rotating either logs everyone out.
   Back them up with your secrets, not with your code.
3. **Leave `AUTH_COOKIE_SECURE` blank.** Login cookies are `Secure`, and a browser refuses to
   send a `Secure` cookie over plain `http://` – which used to make a LAN install unloggable-in
   out of the box, with no error anywhere, until you found `AUTH_COOKIE_SECURE=false` in this
   list. The backend now works it out from `CORS_ORIGINS`: a plain-`http://` origin means the
   cookie goes out without the flag, and the boot log says so. The variable is still there as an
   override in either direction; the only way it bites now is setting it *by hand* to the wrong
   value. If you copied `AUTH_COOKIE_SECURE=true` out of an old guide and serve plain HTTP,
   blank it.
4. **The alarm webhook secret is in `.env` *or* the database.** `.env` wins; blank means one was
   generated into the `settings` table on first boot, and an admin can read or rotate it in the
   app (§5). Because `.env` wins, rotating while it is set there is refused with a `409` rather
   than reported as done.
5. **Your map opens where the settings say your station is.** The seed writes a placeholder
   (`Feuerwehr Musterstadt`, 47.5596 / 7.5886), so an unset board opens on somebody else's canton
   and biases every address search there. Overwrite `firestation_name` and the two coordinates
   with yours (§3).
6. **All four images move together.** Don't pin them individually; one `KP_RUECK_TAG` for the set.
7. **Offline tiles are big, slow to fetch, and default to the wrong region.** Set `TILES_BOUNDS`
   for your area (§4) – on the `just tiles-download` command line, not in `.env`; that script
   reads the shell it is started from. Not something to start the evening of an event.
8. **Your board starts empty.** Not a broken install – production seeds no resources (§3).
9. **A printed Einsatzzettel is a working credential.** Its second QR opens `/feld` for that
   Schadenplatz, using the Ereignis token – so a slip left in a vehicle stays valid until that
   token expires (30 days), the same exposure as the poster on the wall. Collect the slips at the
   end of an Ereignis, the way the check-in and `/feld` posters already come down.

## 8. Before you rely on it in the field

Not a formality – this is the list that separates "it's installed" from "we can run an event on
it".

- [ ] The seeded admin password is changed and real accounts exist.
- [ ] The **viewer** account has been tested on the screen you will actually project.
- [ ] Resources imported and sane: personnel, vehicles, materials all appear on the board.
- [ ] **The station on the map is yours**, not `Feuerwehr Musterstadt` – open the map view and
      check the marker and where it opens (§3).
- [ ] If a dispatch system sends you alarms: the shared secret is one **you** chose in `.env`, or
      one an admin has read out of the app – not one nobody has ever looked at (§5).
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

- [`DEPLOYMENT.md`](DEPLOYMENT.md) – updating, rollback, backups, and
  [§9 troubleshooting](DEPLOYMENT.md#9-troubleshooting), indexed by the symptom you can see.
- [`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md) – the provider-neutral webhook.
- [`AUSFALL_SOP.md`](AUSFALL_SOP.md) – what you do when the software is not available.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) – how the pieces fit together, and why.

Stuck, or something here was wrong for your station? Open an
[issue](https://github.com/feuerwehr-oberwil/kp-rueck/issues) – setup friction is a bug report we
want.

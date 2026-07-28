# Changelog

All notable changes to KP Rück are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**What the version number means for a deployment** – KP Rück is a self-hosted app, not a
library, so the number answers one question: *how much attention does this update need?*

| Bump | What it means for you |
| --- | --- |
| **MAJOR** | Operator action required – a breaking config change, a migration that can't be rolled back, a new mandatory env var, a Postgres major. Read the notes before updating. |
| **MINOR** | New features. Migrations run automatically on boot; `docker compose pull && docker compose up -d` is enough. |
| **PATCH** | Fixes only. Always safe to take. |

All four images (backend, frontend, tileserver, print-agent) are released **together** under one
version – a station runs the set, not a mix. Prod and the demo deploy continuously from `main`,
so every published image has already been carrying live operations at Feuerwehr Oberwil before
it was tagged.

**Why still 0.x?** Because exactly one fire station runs this in production, and a 1.0 claims
more than that. It becomes **1.0 when a second station is running it in the field** – not when
the feature list feels complete. Until then, read 0.x as *"not yet proven anywhere but
Oberwil"*, **not** as *"we may break things without warning"*: the table above holds today and
will keep holding.

`0.1.0` is the initial published release; the running history before it is in the git log.

## [Unreleased]

A round of Auftrag and viewer work, all of it from one afternoon of testing on the demo by an
officer who does not build the thing. Everything below is running in production at Feuerwehr
Oberwil.

### Added
- **An Auftrag is handed out once, not once per stop.** A route with four stops produced four
  radio announcements, each reading out the same crew — so the Einsatzleiter read the same
  Mannschaft aloud four times. The first stop to reach «Disponiert» *is* the Auftragsvergabe and
  now gets the full announcement (crew and vehicles first, then the numbered list of stops, with
  Reko dangers and Nachbarhilfe collected at the end and named with their address). Every later
  stop gets the short continuation: «Auftrag ‹Sturmholz Oberwil› weiter mit Stop 3:
  Mühlemattstrasse 12.»

  If the route picks up crew, a vehicle or material in the meantime, the full announcement is due
  again — whoever just joined has never heard the Auftrag. Completed stops drop out of the list
  but **keep their number**, so «Stop 3» means the same address for the whole life of the
  Auftrag; a list that renumbers itself is a trap over the radio.

  There is deliberately **no new button**: the Disponiert dialog stays the trigger and only the
  text differs, because the app can tell which case it is and the operator should not have to.
  What was last announced is stored **on the Auftrag, server-side** (timestamp plus a digest of
  the crew/vehicles/material) rather than in the browser — two devices, a wall screen and a
  reload mid-Einsatz all have to agree on what has already been said.

  > **No action required.** The migration adding the four `incident_groups` columns runs on boot.
  > Until it has, an announcement simply cannot be recorded, and every stop falls back to the
  > full text — the harmless direction.
- **«Durchsage wiederholen» per Auftrag.** Radio traffic gets lost and asking for a repeat is
  normal. Each Auftrag in the slide-up now repeats its last announcement word for word (card,
  ⋮ menu, right-click) — no reopening a stop dialog for the wording, and the repeat is not
  counted as a new announcement.
- **The Reko photos are visible where the Reko result is read.** Photos uploaded through the Reko
  form only ever existed *inside* the Reko form — the one surface the command post never opens.
  The incident detail (including the `/display` views) shows them under «Reko-Ergebnis», together
  with the Lagetext, which was missing for the same reason. A picture of the damage is the most
  useful part of a Reko report. The images stay behind the login; a share-link view receives no
  filenames at all.
- **Every section of the display views folds away.** Board columns (including the share-link
  board), the incident status groups, the Funktionen under Personal and the categories under
  Material. A larger Feuerwehr otherwise only scrolls.

  Open is the default — nothing hides from someone who has just walked up to the screen — with
  ABGESCHLOSSEN as the one exception, as before. A **folded header keeps its count and its
  state**: a red dot as soon as an incident in that section is past the board's own warning
  threshold, and for Personal and Material how many are still free. Folding is hiding, and at 3am
  nothing important may hide itself. The fold is remembered per device, like the other display
  settings.
- **A closed incident can still be made a stop, but never silently.** Attaching an already
  completed incident to an Auftrag went through without a word, so a route showed a stop nobody
  was going to drive to. There is now a confirmation naming *which* of the selected incidents are
  closed — it warns, it does not forbid, because a Wiederaufnahme or a second visit to the same
  address is a real case and a ban would just produce a duplicate incident. It sits on the action
  rather than the screen, so it covers all three routes in: the stop picker, «An Auftrag
  verteilen» and dragging a card onto a route.

### Fixed
- **An Auftrag wears its own colour everywhere on the map.** Two places disagreed. The route drew
  its line and its numbered stop pins with a private indigo fallback whenever the Auftrag had no
  colour set, while the board chip, the marker colouring and the legend had long resolved that
  same case through `colorAccent` — so two colourless Aufträge were one colour on the line and
  two different ones everywhere else. And while routes are drawn, a stop now also carries its
  route's colour as a *marker*: the numbered pin on top already did, the marker underneath stayed
  the priority fill, which on `/display/map` — routes on by default, colouring on «Priorität» —
  made every stop of every route read as the same static red. It is only a fallback; a
  deliberately chosen «Färben nach» dimension still wins, and the legend now lists the routes by
  name instead of continuing to claim «Priorität».
- **Neighbouring map labels no longer print over each other.** Two incidents a few metres apart
  wrote their addresses on top of one another — worst with the Aufträge layer on, where the
  numbered route pin lands on the same spot. A colliding label now steps down until it is clear;
  nothing is dropped, because at 3am the address you cannot see is the one you were looking for.
  Collisions are computed in screen pixels at the current zoom, so the same two incidents collide
  zoomed out and not zoomed in, and the order is stable so a map always resolves the same way.
  The marker and label under the pointer also come to the front, which the shared tooltip layer
  previously left to DOM order.
- **The stop-picker map keeps its labels inside the frame, and explains its colours.** Labels now
  open towards the middle of the map instead of over the border (which clips), the map fits with
  more padding so no marker sits against the edge, and a legend says what red, a route colour and
  grey mean. Toggling Liste ⇄ Karte still does not resize the dialog.
- **Verbrauchsmaterial is never double-booked.** Unlimited stock has no count, so the fact that
  the Absperrband is already lying on another incident says nothing about this one – yet the
  assignment dialog flagged it amber and asked «Doppelbelegung?» before it would tick. Both are
  gone for anything marked unlimited: it selects straight away and counts along with the group
  tick, exactly like a free item. Limited material is unchanged – one Tauchpumpe assigned is
  still one Tauchpumpe away, and taking it off another incident still asks first.
- **The status display names every incident a material is on, not the last one.** The lookup kept
  one incident per material, so a consumable running on three showed «→» and one address – a
  precise-looking claim that happened to be wrong. It now collects all of them: one incident still
  reads as its address and jumps there on click, several read as «3 Einsätze» and are deliberately
  not clickable, because there is no single incident to open. Consumables also wear their ∞ in the
  status column now, so a green dot next to «3 Einsätze» reads as the rule it is instead of a bug.
- **Unlimited material is marked as such in the viewer's incident detail.** It was listed
  correctly – it just looked like every other item, in the incident's own materials and in the
  Auftrag roll-up. Both now carry the same ∞ the board and the Materialverwaltung use, on all
  three read-only displays (status, board, map).

## [0.2.0] – 2026-07-26

### Security
- **Live updates now require a login.** The Socket.IO connection accepted anyone: only the
  admin room was role-gated, so anything able to reach `/socket.io` could join the operations
  room and receive live incident broadcasts — addresses, crew assignments — without
  authenticating. The strict-mode flag existed but shipped off ("Phase 1"). It is now on.

  The CORS origin whitelist was never the control here, which is the part worth internalising:
  CORS is enforced by browsers, and a script that omits `Origin` is not a browser.

  > **No action for a normal deployment.** Nothing legitimate connects anonymously — the app
  > sends its session cookie, the `/display/*` screens require a login, and the public
  > share-link board polls over HTTP rather than using the socket. If some client of yours
  > genuinely cannot log in, set `WS_REQUIRE_AUTH=false`; the board falls back to ~5s polling
  > rather than going blank.
- **Four security-relevant settings are documented for the first time.** A control nobody can
  find is not a control. `SSO_EDITOR_ALLOWLIST` (without it, *every* Entra ID sign-in is a
  viewer — any tenant member can reach the login, so editor is an explicit grant),
  `WS_REQUIRE_AUTH`, `MASTER_TOKEN` (bypasses login entirely for scripted configuration; empty
  by default, and not attributed to a user in the audit trail if you enable it), and the
  `LOGIN_*` throttle knobs the previous release already advertised as tunable. All now in
  [`.env.example`](.env.example), [`SECURITY.md`](SECURITY.md) and
  [`docs/SETUP.md`](docs/SETUP.md).
- **The security scanner was skipping a file.** Bandit is a blocking CI gate, but it ran on
  Python 3.11 against a 3.12 codebase, could not parse `app/crud/base.py`, and silently
  excluded it — noted in output that is easy to scroll past. Pinned to the project's Python; it
  now reports `Files skipped (0)`.
- **The print-agent endpoints are fail-closed.** They used to accept *any* request when
  `PRINT_AGENT_TOKEN` was unset – on the assumption that the agent only ever reaches the backend
  across a trusted LAN. The same image also runs on a public host, where "unset" quietly meant
  anyone could read the printer config, list pending jobs, claim them, and mark them done. The
  four agent endpoints now answer `403` with no token configured, matching how alarm intake has
  always behaved. `.env.example` already described this behaviour; the code now matches it.

  > **Operator action** if you print: set `PRINT_AGENT_TOKEN` on the backend *and* `AGENT_TOKEN`
  > on the agent, then restart both. Printing stops until you do – including on a LAN-only
  > install, where the token was previously optional. Deployments that don't print need nothing.

### Added
- **Offline map tiles work for your region, not just ours.** The tile pipeline was wired to one
  Swiss canton: the download URL, the bounding box and the region label were all literals in
  `scripts/download-tiles.sh`, so a station anywhere else could not follow the documented
  `just tiles-download` at all — it had to fork the script. Four environment variables now drive
  it, and `docs/OFFLINE_MAPS.md` explains how to find your own values:

  ```bash
  TILES_REGION="Oberbayern" \
  TILES_BOUNDS=11.0,47.7,12.3,48.4 \
  TILES_AREA=oberbayern \
  TILES_PBF_URL=https://download.geofabrik.de/europe/germany/bayern/oberbayern-latest.osm.pbf \
    just tiles-download
  ```

  > **No action required.** The defaults are the previous values, so an existing deployment
  > behaves exactly as before. `TILES_NAME` (the file on the tileserver volume) is deliberately
  > separate and should be left alone on a deployment that already has tiles — renaming it makes
  > the init script write an empty bootstrap file instead of finding them, which looks like a
  > working map with nothing in it.
- **`docs/openapi.json` is committed** — the full API contract (158 routes, request and response
  shapes) readable without booting the stack. Anyone writing an adapter for a dispatch system
  against `POST /api/alarms`, or a print agent against the job queue, previously had to stand up
  Postgres and the backend just to see a payload. `just openapi` regenerates it, and a test fails
  if it drifts from the code.
- **More of the gate that stands behind a published image.** Secret scanning (gitleaks) and
  CodeQL static analysis now run here as they already did for KP Front, and CI runs a small
  Playwright subset on every pull request — logging in, creating an event and an incident, and
  alarm intake — where before it ran no click-through at all. The full suite runs nightly. None
  of this changes the software; it changes how much a release has been checked before it reaches
  you.
- **arm64 images.** All four images build for `linux/arm64` as well as `linux/amd64`, so an ARM
  host (Hetzner CAX, Oracle Ampere, a Raspberry Pi) can run the whole stack – previously only the
  print agent could.
- **Opt-in error reporting, off by default.** When something breaks, a deployment *may* forward a
  sanitised crash report – but only after switching it on in the admin area. Off means a NULL
  setting, which is exactly what every existing installation updates into, and consent is a
  deployment decision rather than a device preference: the fire service is the controller, not
  whoever is holding the tablet.

  What can leave the building is built field by field in `app/telemetry/scrub.py` – nothing is
  passed through or spread, so a field nobody wrote a line for cannot leak. Free text is scrubbed
  as well, because the value is usually *in* the message: paths, e-mails, phone numbers, IPs,
  coordinates, UUIDs, tokens, street names with house numbers, and the full user agent reduced to
  a coarse label so it can't fingerprint. Every payload is logged on your own server before it is
  sent and kept verbatim in `telemetry_outbox`, so you can audit it with a `SELECT` instead of
  taking our word for it. `KP_TELEMETRY_ENABLED=0` overrides every switch in the UI.
  See [`PRIVACY.md`](PRIVACY.md).

  > The scrubber and envelope are byte-identical copies of KP Front's, held in step by a checksum
  > test in both repositories – a rule tightened in one app and not the other would mean one of
  > them quietly forwards what the other removes.
- **[`docs/RUNNING-BOTH.md`](docs/RUNNING-BOTH.md)** for stations running KP Front *and* KP Rück
  on one host: the three places two otherwise-independent stacks collide, the traps around each,
  and a mapping table for the variables the two projects name differently. `.env.example` links
  to it, and the file is kept identical in both repositories.
- **One print agent for both systems.** A station running both used to need two agents on the
  same box — two services, two secrets, two install methods, two log streams — to reach the same
  printer room. The agent now lives at [`tools/print-agent/`](tools/print-agent/) and speaks
  **both** protocols: KP Rück's (structured JSON → ESC/POS thermal) and KP Front's (opaque PDF →
  CUPS/A4 laser). Give it a `backends` list and run one service.

  Neither backend changed and neither wire protocol changed. The core is stdlib-only, so the
  bare-Pi install with no venv keeps working; `python-escpos`/`pillow` are now an optional extra
  needed only for the thermal output.

  > **No action required.** The environment variables the previous agent used are read exactly
  > as before, so an existing `--profile printing` deployment keeps working untouched. The image
  > is published under the neutral name `ghcr.io/feuerwehr-oberwil/kp-print-agent`; the old
  > `kp-rueck-print-agent` name is **also** published this release, so nothing breaks on update.
  > Migrating from two agents to one: **stop the old ones first** — two agents polling one queue
  > both claim jobs, and each job then prints once, from whichever asked first.

### Changed
- **The audit log is no longer deleted after 90 days.** `AUDIT_RETENTION_DAYS` now defaults to
  `0`, meaning keep everything. It defaulted to 90 and a background job swept silently, which
  sat badly next to this project's own claim of "defensible records" and an "append-only audit
  log": a deployment older than three months had already lost the trail for its earliest
  operations, and nothing anywhere said so. With retention off the sweeper does not start at
  all. A public demo still caps at 7 days.

  > **Check this if you have been running 0.1.x.** Anything older than 90 days is already gone
  > — worth knowing *before* somebody asks you for it. And if you were relying on the sweep to
  > bound table growth, set `AUDIT_RETENTION_DAYS=90` back explicitly. `docs/SETUP.md` §6 has
  > the reasoning.
- **Node 24 instead of Node 20.** The frontend image was built on a runtime that reached
  end-of-life on 2026-04-30, so any Node vulnerability disclosed after that date was one nobody
  would ever patch for it. Node 24 is supported to 2028-04-30. Dependabot now watches base
  images too — that gap existed because npm, pip and GitHub Actions were watched and the one
  dependency a station actually *runs* was not.
- **A fresh production deployment now starts with an empty board.** It used to be seeded with a
  fictional station: five vehicles (Omega 1–5), 57 firefighters, a full material catalogue, and
  thirteen training locations on real streets in one specific Swiss municipality. Sample
  *incidents* were already withheld from production; the resources they referred to were not. So
  the first act of setting KP Rück up for your own station was deleting somebody else's data off
  the board — and a restored backup put it back. Accounts and settings are still seeded; the
  station's own resources come in through the Excel import (`docs/SETUP.md` §3).

  > **No action for an existing deployment** — seeding only runs on a database with no users, so
  > yours has long since skipped it and your data is untouched. This changes what a *new* install
  > and a *restore into a fresh stack* look like. Note the restore drill in `docs/SETUP.md` §6
  > now starts from a genuinely empty board, which is the point.
  >
  > A `just dev` machine still comes up with the sample board. It is a development fixture, and
  > it is no longer something a real deployment inherits.
- **Address search biases towards your station, not towards Basel-Landschaft.** It matched the
  `home_city` setting against a hardcoded list of sixteen municipalities and fell back to a fixed
  Basel-region box for anything unrecognised — so every station outside that list had its address
  lookups quietly weighted towards a region it is nowhere near. The bias now comes from the
  `firestation_latitude` / `firestation_longitude` settings you already configure, and with no
  coordinates set the search stays unweighted rather than pointing somewhere wrong. Nominatim's
  country restriction is still Switzerland by default and can be overridden with a
  `geocoder_country_codes` setting, so a deployment across the border is a setting rather than a
  patch.

  > **Worth checking** if your address search has felt off: set the station's coordinates in the
  > settings surface.
- **`PUBLIC_URL` is now `CORS_ORIGINS`.** The variable was always passed to the backend as
  `CORS_ORIGINS`; the old name collided with KP Front's `PUBLIC_URL`, which means something else
  there (the base for absolute links in outbound webhooks). Copying one `.env` into the other
  therefore broke CORS with no error message anywhere. The new name is what the backend actually
  reads.

  > **No action required.** `PUBLIC_URL` is still accepted as a deprecated fallback; rename it
  > when you next touch the file.

### Fixed
- **`docs/SETUP.md` no longer teaches a configuration that does not exist.** The page a new
  station reads first still used `PUBLIC_URL` (renamed `CORS_ORIGINS` in this release), still
  said the alarm webhook secret could only be read out of the database, and still told you to
  check out and pin `v0.1.0` — the release whose print-agent endpoints accept any request when no
  token is set. It also promised a resource import without mentioning that the board now starts
  empty, so "empty" would have read as "broken".
- **The `training_locations` table no longer defaults new rows into one municipality.**
  `postal_code` defaulted to `4104` and `city` to `Oberwil` at the database level. Every writer
  already supplies both, so the defaults could only ever fire as a wrong answer. Existing rows
  are untouched.
- **Two stacks on one host no longer fight over port 443.** Caddy had it hard-coded, and KP
  Front's Caddy wants it too – so the second stack simply failed to start. The HTTPS host port is
  now `HTTPS_PORT`, matching the existing `HTTP_PORT`. Note it must be moved even when an outer
  reverse proxy never touches it, because this stack's Caddy publishes unconditionally: unlike KP
  Front's, it is deliberately *not* behind a compose profile, since nothing else here publishes a
  port at all. It is also not a way to run a second automatic-HTTPS setup – certificate issuance
  needs port 80 or 443 reachable from outside.
- **Assigning to a missing incident no longer 500s, and a missing resource no longer creates an
  orphan.** `POST /api/incidents/{id}/assign` with an incident id that no longer exists died on a
  foreign-key violation — a 500 for what is plainly a stale id. Worse, the *resource* was never
  checked at all: assigning a personnel id that does not exist returned 200 and stored the
  assignment anyway, leaving a row pointing at nothing and no error to explain it. Both are now
  404, matching the neighbouring endpoints.
- **The alarm webhook secret can be set from `.env`.** It could previously only be read back out
  of the database after first boot
  (`SELECT value FROM settings WHERE key = 'alarm_webhook_secret';`) – the one setup step that
  could not be scripted. `ALARM_WEBHOOK_SECRET` now wins over the stored value, so a deployment
  can be provisioned entirely from the file. Left blank, the previous behaviour is unchanged.
- **The generic alarm intake reserves the same `source` slugs as KP Front.** Both now reject the
  union of the two lists, so a station feeding one dispatch system into both apps can't pick a
  name that one accepts and the other rejects — a trap that only surfaced on the second
  integration.
- Dependency updates across the frontend, and the GitHub Actions used by CI.
- **The app can no longer get stuck in a state only a browser reset would clear.** A sweep for
  crashes and dead ends turned up several, all of which needed something no screen offered:
  - A corrupt value in browser storage crashed the app on **every** load. The read happened in a
    provider above every error boundary, so it produced an untranslated "Application error" with
    no way out – and because the bad value was saved, reloading (or restarting the browser)
    reproduced it. There is now a last-resort error screen with a **"Lokale Daten zurücksetzen"**
    action, and all storage reads validate what they find instead of trusting it.
  - On an installation served over plain **HTTP from a LAN address**, creating an Auftrag or
    assigning a resource to one silently did nothing: the browser only provides the id generator
    the code used over HTTPS or on localhost. The dialog's create button then stayed dead until
    the page was reloaded.
  - Visiting **Check-in** or the **Reko-Dashboard** and navigating back killed live updates for
    the rest of the session. Those pages closed a connection the whole app shares. Data kept
    flowing via background polling, so nothing looked wrong.
  - When the live connection gave up for good, the "Verbindung verloren" banner only reported it.
    It now has a **"Neu verbinden"** button; previously the sole cure was a page reload.
- **Wall displays recover on their own.** An error on an unattended `/display/*` screen used to
  leave a dead page with a button nobody was there to press. Displays now reload themselves after
  15s, then 30s, then 60s – backing off so a broken deploy can't turn every screen in the station
  into a retry loop against the backend. Applies to crashes in the page and in the app shell.
- **A shared command-post IP no longer locks out the crew.** Login was capped at 3 attempts per
  minute per IP and counted *successful* logins, so a few operators signing in together from
  behind the same NAT locked everyone out with nothing to do but wait. Brute-force protection is
  now per-username and counts only *failures* (5 → 5 minute lockout, cleared by a correct
  password), which is stricter against an attacker while honest operators can't exhaust each
  other's budget. Tunable via `LOGIN_RATE_LIMIT_PER_IP`, `LOGIN_MAX_FAILED_ATTEMPTS`,
  `LOGIN_FAILED_LOCKOUT_SECONDS` and `LOGIN_FAILED_WINDOW_SECONDS`.
- Development stack: the host and the backend container no longer share one `.venv`. Running
  `uv run` (or `just db migrate`) on the host used to recreate the virtualenv under the
  container's feet, flooding the reloader until the backend stopped responding and had to be
  restarted by hand.

## [0.1.0] – 2026-07-25

The first tagged release, and the first with **published container images**: self-hosting is a
`docker compose up -d` against `ghcr.io/feuerwehr-oberwil/kp-rueck-*` – no build toolchain on the
server. Everything below has been running in production; this is the point where it becomes
something another station can pin.

### Added
- **Published images on GHCR**, one per service and all released under the same version:
  `kp-rueck-backend`, `kp-rueck-frontend`, `kp-rueck-tileserver` and `kp-rueck-print-agent`
  (the print agent also for arm64, so it runs on a Raspberry Pi at the command post). CI builds,
  boots and smoke-tests the whole stack before a tag publishes. `docker-compose.yml` is now a
  **production** stack that pulls those images and puts the frontend and backend behind one
  origin; the hot-reload development stack stays in `docker-compose.dev.yml`. See
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
- Aufträge (multi-stop group routing): batch several incidents into an ordered **route** for one
  squad to work through during a Flächenlage (storm/mass-incident wave). An Auftrag is a lightweight
  container over real incidents (`incident_groups` table + `incidents.group_id`/`group_position`),
  so each stop keeps its own status/reko/print/GPS. Build routes in the **Aufträge** footer sheet
  (inline create, drag cards in, derived `offen/läuft/erledigt` checklist, `+ Stop`) or the
  **Routen-Editor** modal / `/map` **Routenplanung** mode (click-to-add, drag-reorder, client-side
  nearest-neighbor optimize). Assign a squad once and **"auf alle Stops übernehmen"** – with a
  **`Squad` vs `Nur Fahrzeug` (Pendeldienst)** mode so a shuttle shares only the vehicle while crew
  stays per-incident. Routes draw as colored numbered polylines on the map, and GPS arrival
  auto-advance gains a nearest-single-match guard so clustered stops don't double-fire.
  See [`docs/plans/12-auftrag-multi-stop-routing.md`](docs/plans/12-auftrag-multi-stop-routing.md).
- Provider-neutral alarm intake: a generic `POST /api/alarms` webhook accepts alarms from **any**
  dispatch or alarm system – shared-secret auth, `(source, source_id)` idempotency, auto-attach
  to the active event, and fail-closed when no secret is configured. The native Divera adapter
  (`POST /api/divera/webhook`) and the token-gated phone/walk-in intake form feed the same pool.
  See [`docs/ALARM-INTEGRATIONS.md`](docs/ALARM-INTEGRATIONS.md).
- Integration capability registry: `GET /api/integrations` reports which provider is configured
  per area (alarm in, Ausalarmierung, personnel sync, vehicle GPS). The frontend renders provider
  names from this response instead of hard-coding them, and the generic webhook and intake form
  are always available.
- Provider-neutral outbound alerting (Ausalarmierung): a pluggable `send_alarm(...)` seam
  (`backend/app/services/alerting/`) with a `personnel_external_identities` table keying each
  person's identity per provider – a new provider is a module plus a registry entry.
- German i18n layer: `next-intl` infrastructure (cookie locale, `frontend/messages/de.json`
  catalog, outside-React helper) with UI, toast, and API-error strings extracted from hardcoded
  German – the groundwork for additional locales.
- GPS-driven status automation: silent-arrival (Rule A) and confirm-release (Rule B) rules move
  incidents by vehicle position (`backend/app/services/gps_automation.py`), running in training
  events too. Dwell is decoupled from fix freshness so parked trackers can still trigger.
- After-action PDF report and unified export: Einsatztagebuch, Reaktionszeiten, and Lageblatt
  chapters via `services/pdf_report_service.py`, exposed on the events page and user menu.
- Undo incident deletion: `POST /api/incidents/{id}/restore` with a "Rückgängig" toast.
- Persisted Kanban card order: `Incident.position` + `/incidents/reorder`, eliminating the
  drag snap-back flicker and making within-column reordering real.
- Ausfallsicherheit (paper fallback): a printable Lageblatt PDF, automatic thermal board
  snapshots, an outage SOP ([`docs/AUSFALL_SOP.md`](docs/AUSFALL_SOP.md)), and a startup
  checklist task.
- Reliability hardening for the public demo: audit-log retention sweep
  (`background/audit_cleanup.py`), a global exception handler with request IDs
  (`middleware/request_id.py`), endpoint hardening (admin-gated demo reset, `PRINT_AGENT_TOKEN`,
  WebSocket room auth), and per-session demo sandbox events (`POST /api/demo/sandbox`).
- Training mode depth: auto-generated incidents wired live, Divera intake drills, escalation
  injects, adjustable sim tempo, one-tap Rückfahrt, and simulated GPS drives from the
  Übungssteuerung – all isolated by the `training_flag`.
- QR walk-in print jobs and a generic `qr_code` job type for the thermal print agent.

### Changed
- The board sync path was reworked for robustness: serialized reorders, drag-aware reloads, WS
  recovery, single-commit status operations, and stale-reload discarding – debounced edits are no
  longer lost on tab close, and newer local changes are never clobbered by a late reload.
- Alembic is the single source of schema truth: `create_all` was dropped from boot, so the schema
  only ever changes through a migration.
- Onboarding resolved without a welcome card: shortcut discoverability is the ⌘K command palette
  (also `?`); the 409 conflict copy was softened to "Von anderer Person geändert".
- Blocking photo and Excel work moved off the event loop; driver reassignment and vehicle moves
  are now atomic.

### Fixed
- **Self-hosting outside Railway now actually works.** KP Rück had only ever been deployed to
  Railway, and that was baked into paths that looked platform-neutral. Found by building the
  images and booting the stack end to end:
  - The API proxy forced every redirect target to `https://` (a Railway-edge workaround), so
    against a plain-HTTP backend it attempted TLS on a cleartext port – and since the proxy
    appends a trailing slash, FastAPI's redirect made that the common path: `/backend-api/*`
    returned 502 for everything.
  - The live board never connected: the WebSocket URL applied Railway's
    `X.up.railway.app → X-api.up.railway.app` convention to *any* hostname with three or more
    labels, pointing at a host that doesn't exist. It now uses the deployment's own origin
    (and keeps `ws://` on a plain-HTTP LAN instead of forcing `wss://`).
  - Login was impossible on a trusted-LAN install: `Secure` cookies were forced on in
    production, and browsers drop those over plain HTTP, so signing in failed with no visible
    error. `AUTH_COOKIE_SECURE=false` is now a deliberate opt-out; unset still means secure.
  - Offline map tiles were requested from a hard-coded `localhost:8080`, which no browser on a
    deployment can reach; they now come from `/tiles` on the same origin.
  - The photo volume is mounted where the image actually prepares it, and the frontend health
    probe uses `127.0.0.1` instead of `localhost`, which resolves to IPv6 first while Next
    binds IPv4 only.
- The Divera webhook auto-attach never fails the ACK, and the member sync now counts created
  personnel correctly.
- `/incidents/sync-version` is no longer shadowed by the `/{incident_id}` route.
- A submitted Reko report can no longer silently revert to draft; users are informed whenever an
  action fails instead of a silent revert.
- Lost print jobs are requeued instead of being dropped forever.
- The shared editor account is no longer seeded in production.

_For the full running history before the first release, see the git log._

[Unreleased]: https://github.com/feuerwehr-oberwil/kp-rueck/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/feuerwehr-oberwil/kp-rueck/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/feuerwehr-oberwil/kp-rueck/releases/tag/v0.1.0

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

### Security
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
- **arm64 images.** All four images build for `linux/arm64` as well as `linux/amd64`, so an ARM
  host (Hetzner CAX, Oracle Ampere, a Raspberry Pi) can run the whole stack – previously only the
  print agent could.

### Fixed
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

[Unreleased]: https://github.com/feuerwehr-oberwil/kp-rueck/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/feuerwehr-oberwil/kp-rueck/releases/tag/v0.1.0

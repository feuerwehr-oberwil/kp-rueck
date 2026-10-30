# Documentation

This folder holds KP Rück's longer-form documentation – the slower-moving "why" and "how"
behind the app. The product intent and quick start live in the [root README](../README.md); the
feature history lives in [`../CHANGELOG.md`](../CHANGELOG.md).

Every doc here describes shipped behaviour; one that drifts from the code is a bug.

## Day 2 – the recurring operator tasks

| Task | Compose (self-hosted) | Railway |
| --- | --- | --- |
| Update to a new release | [`DEPLOYMENT.md` §4](DEPLOYMENT.md#4-updating) | [`RAILWAY.md` §8](RAILWAY.md#8-updating) |
| Restore a backup | [`DEPLOYMENT.md` §6.1](DEPLOYMENT.md#61-restore) | [`RAILWAY.md` §9](RAILWAY.md#9-backups) |
| Refresh the offline map tiles | [`OFFLINE_MAPS.md` – Updating Tiles](OFFLINE_MAPS.md#updating-tiles) | no tile server ([why](OFFLINE_MAPS.md#railway-has-no-tile-server--the-compose-stack-does)) |

## Foundations

| Doc | What it is |
| --- | --- |
| [`SETUP.md`](SETUP.md) | **Start here for a new station.** The ordered path from an empty Docker host to a board you can run an event on: boot, take over the seeded accounts, bulk-load resources, offline tiles, integrations, backups – plus the gotchas that catch people and a pre-field checklist. Links to the reference docs below rather than repeating them. |
| [`../deploy/`](../deploy/) | **Double-click launchers.** `Start KP Rück.command` (macOS) and `Start-KP-Rueck.bat` / `start-kp-rueck.ps1` (Windows): check for Docker (starting or offering to install it), write a `.env` of generated secrets plus LAN defaults, pull the published images, start the stack and open the browser. The terminal-free front door onto the same compose stack [`DEPLOYMENT.md`](DEPLOYMENT.md) documents – `just init` remains the scripted equivalent. |
| `/setup` (in-app) | **Browser first-run setup.** A board booted without seeded passwords starts *unclaimed*: the first visit lands on `/setup`, creates the admin account and names the station, and from then on the route refuses everyone – no password ever has to live in a file. On an internet-facing board (a `DOMAIN`, Railway, or https) it also asks for a one-time **Einrichtungscode** from the backend log. `ADMIN_SEED_PASSWORD` in `.env` still pre-claims the board for scripted installs. Walked through in [`SETUP.md`](SETUP.md) («Der schnellste Weg»); the API half is `backend/app/api/setup.py`. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System overview: how the Next.js frontend, FastAPI service, PostgreSQL, and external integrations fit together, plus the real-time sync model, the incident lifecycle (including merge and «Trennen»), and the token/role model. |
| [`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md) | Provider-neutral alarm intake: the generic `POST /api/alarms` webhook (auth, idempotency, auto-attach, fail-closed), the Divera and FireHub adapters and the phone/walk-in form, Divera's Rückmeldungen («Anrückend») and `divera.response_classification`, and the `GET /api/integrations` capability registry. A personnel file another system publishes is [`ROSTER-SNAPSHOT.md`](ROSTER-SNAPSHOT.md). The intake payload itself is pinned separately by [`alarm-intake-conformance.json`](alarm-intake-conformance.json) – the cases KP Front and this app must answer identically, plus the ones they legitimately answer differently, so a station running both can build its dispatch integration once. |
| [`ROSTER-SNAPSHOT.md`](ROSTER-SNAPSHOT.md) | Reading the roster from a **file the station publishes** (`ROSTER_SNAPSHOT_SOURCE`: an https address or a path), against the versioned contract [`roster-snapshot.schema.json`](roster-snapshot.schema.json) with a per-run report in [`roster-snapshot-outcome.schema.json`](roster-snapshot-outcome.schema.json): how people are matched (snapshot key, then a listed identity such as Divera's, then a unique name – existing links never rewritten), what «deactivated» means here (unavailable + a mark, never an operator's own status), the deactivation hold and its release, the status under Einstellungen › Integrationen, and `scripts/roster_snapshot_from_csv.py` for a station with nothing but a spreadsheet ([`roster-snapshot.example.csv`](roster-snapshot.example.csv)). The roster is normally read through a **station index** (`STATION_INDEX_SOURCE` → `index.json` listing the station's data files by kind with sha256 checksums, written by `scripts/station_index_build.py`; `vehicles`/`groups`/`keywords` reserved) – contract in [`station-index.schema.json`](station-index.schema.json), sample in [`station-index.example.json`](station-index.example.json). The reading rules are byte-identical with KP Front's. |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Self-hosting guide: the docker-compose stack built from published GHCR images, the single-origin Caddy layout, `KP_RUECK_TAG` version pinning, updating/rollback, and backups – plus the outbound services (address lookup, the weather layer and `WEATHER_ENABLED`) and the optional [passwordless local login](DEPLOYMENT.md#10-passwordless-local-login-the-stations-own-machine) for the one machine the stack runs on. |
| [`RUNNING-BOTH.md`](RUNNING-BOTH.md) | For stations running KP Front *and* KP Rück on one host: the three places two independent stacks collide – host ports (only one can own 443), `PUBLIC_URL` meaning something different in each, and per-deployment alarm secrets (one alarm body is accepted by both). |
| [`RAILWAY.md`](RAILWAY.md) | Railway service layout, environment variables, secrets, and the `start.sh` boot/migration flow. A **supported** path alongside [`DEPLOYMENT.md`](DEPLOYMENT.md) – same code, same releases – built from a branch of your fork rather than pulled as tagged images, so you pin by what you merge; choose by who runs the server. |
| [`OFFLINE_MAPS.md`](OFFLINE_MAPS.md) | Offline map tiles for **your** region: TileServer GL setup, MBTiles, and the auto / online / offline fallback modes. The region is configuration, not code – Basel-Landschaft is only the default bounding box, because that is where the first station sits. Any OpenStreetMap extract works. |
| [`PRINT_AGENT.md`](PRINT_AGENT.md) | The print agent and the transport-neutral job queue: dispatch slips, board snapshots, QR walk-in slips, the four agent endpoints, and how to write a custom agent for any printer. |
| [`PHOTO_STORAGE.md`](PHOTO_STORAGE.md) | How Reko, Feld and Rapport photos are stored on the persistent volume, served, backed up, and pooled for training scenarios. |
| [`STANDBY.md`](STANDBY.md) | **A standby box for a hosted board.** A compose stack that mirrors the Railway database live and one way (logical replication, photos included), look-only under a permanent band until an editor takes the running Ereignis offline there – which then stops syncing for good while everything else keeps mirroring. Covers the one-time setup on the hosted database (`wal_level`, publication, replication login), the box's `.env`, following the hosted board commit for commit (`scripts/standby-follow.sh`), what it reports, the day itself, and `--reset` afterwards. |
| [`AUSFALL_SOP.md`](AUSFALL_SOP.md) | Outage / paper-fallback standard operating procedure: Lageblatt PDF, automatic thermal snapshots, and what to do when the network or backend is down. |
| [`FAT_EVENT_PERF.md`](FAT_EVENT_PERF.md) | **Does a large or long Ereignis make the board worse?** `just fat-perf [real long large extreme]` plays a synthetic Ereignis, calibrated against real user actions from prod's audit log, into a throwaway stack with simulated devices following it. It then opens the board and the map on a CPU-throttled browser. Measurements, not gates; compare against the recorded run. Run it when you change the board load, the sync path or anything that runs per card. |
| [`VISUAL_TESTS.md`](VISUAL_TESTS.md) | **Screenshot regression tests.** Nine frozen screens (board, phone, `/feld`, map, wall, settings) rendered from a production build against a seed pinned to one instant, compared with committed PNGs in the CI job `visual`. How determinism is achieved, how to read a red run, and how to accept a deliberate change (baselines from CI only – never to turn the check green). |
| [`DESIGN.md`](DESIGN.md) | **Design context for the UI**: who uses KP Rück and on what device, brand personality, colour roles, type and corners, the design principles. The short, must-follow UI rules stay in [`../CLAUDE.md`](../CLAUDE.md). |
| [`openapi.json`](openapi.json) | The committed OpenAPI contract – every route, request and response shape, readable without booting the stack. Regenerate with `just openapi`; a pytest fails when it drifts from the code. |

## Elsewhere in the repository

| Doc | What it is |
| --- | --- |
| [In-app help](../frontend/public/content/help/index.md) ([fr](../frontend/public/content/help/index.fr.md)) | **The operator manual** – the only one. Served in the app (user menu, ⌘K, `G H`); one Markdown file per language. |
| [`tools/print-agent/README.md`](../tools/print-agent/README.md) | The reference print agent (published image `kp-print-agent`): configuring and running it against an 80 mm ESC/POS printer. The queue and protocol are [`PRINT_AGENT.md`](PRINT_AGENT.md). |
| [`shared/README.md`](../shared/README.md) | The files shared with KP Front by copy, and the step-by-step for changing one. |
| [`../CLAUDE.md`](../CLAUDE.md) | Working rules for coding agents (and a fast read for humans): commands, conventions, the UI decisions. |

## Not in this repository

Internal working documents – point-in-time audits, design critiques, **feature and hardening
plans**, QA protocols run against a live instance – stay local and are not published. They are
snapshots of a moment, they go stale fast, and a half-finished register of "things we were
worried about in March" is a worse answer to "is this software any good?" than the
[CHANGELOG](../CHANGELOG.md), the [known limitations](../README.md#known-limitations), and the
[open issues](https://github.com/feuerwehr-oberwil/kp-rueck/issues) – all of which are current.

Per-station deployment data (rosters, branding, credentials) is never in this repository either.

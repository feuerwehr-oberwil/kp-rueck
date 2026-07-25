# KP Rück

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Live Demo](https://img.shields.io/badge/Demo-live-brightgreen)](https://demo.kp-rueck.ch)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688)](https://fastapi.tiangolo.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.12+-blue)](https://www.python.org/)

**Tactical operations board for the rear command post (KP Rück).** KP Rück replaces the
physical magnet board used to track personnel, vehicles, materials, and incidents during an
operation — a shared Kanban board, an incident map, resource assignments, and a defensible
record, all live across every connected device.

One operator runs it from the command post on a tablet or large screen; viewers follow along
read-only. KP Rück owns its own incident state, map, audit trail, and exports — integrations
(Divera, Traccar, a thermal printer) add data but are not required to operate it.

Originally developed by [Feuerwehr Oberwil BL](https://www.feuerwehroberwil.ch/) and designed
to be adaptable for any fire department.

> **Note:** This entire project was vibe coded — an experiment in how far you can take
> AI-assisted development and how much you can trust the result in a real-world operational
> setting.

| Operations Board | Interactive Map |
|:---:|:---:|
| ![Dashboard](docs/images/dashboard.png) | ![Map View](docs/images/map-view.png) |

## Try the demo

**[Try the live demo](https://demo.kp-rueck.ch)** — no account needed, just pick a
role and go. The demo seeds a realistic board and resets on a schedule; each visitor gets an
isolated training sandbox.

## Why KP Rück

KP Rück grew out of a Swiss Milizfeuerwehr command post. It is built around **one station, one
event, one operator at the board**, not scaled down from a dispatch center.

- **Replaces the magnet board.** The same spatial mental model — columns for status, cards for
  incidents, magnets for crew and vehicles — but live, shared, and self-documenting.
- **Made for the command post.** Dense, calm, dark-mode-first, keyboard-fast on a desktop and
  touch-ready on a tablet. Status and priority read at a glance.
- **Provider-neutral intake.** Any dispatch or alarm system can open incidents through one
  generic webhook; Divera, a phone form, and a QR walk-in slip are adapters on top of it.
- **Training that mirrors reality.** A full training mode with auto-generated incidents and
  simulated GPS drives runs on the same database, filtered by a flag — never mixed with live
  work.
- **Keeps working when the network doesn't.** Offline map tiles, a paper Lageblatt fallback,
  automatic thermal snapshots, and a documented outage SOP.
- **Defensible records.** An append-only audit log and an after-action PDF (Einsatztagebuch,
  Reaktionszeiten) back every operation.
- **Open and self-hostable.** One AGPL-licensed deployment per station, no per-seat licence.

## Highlights

- **Board:** drag-and-drop Kanban with persisted card order and real-time sync (WebSocket, with
  a polling fallback).
- **Map:** Leaflet incident markers, optional [Traccar](https://www.traccar.org/) vehicle GPS
  with GPS-driven status automation, distance labels, and offline tiles.
- **Resources:** personnel, vehicles, and materials with assignment conflict warnings.
- **Alarm intake:** provider-neutral `POST /api/alarms`, a native Divera adapter, a token-gated
  phone/walk-in form, and a capability registry the UI reads instead of hard-coding providers.
- **Reconnaissance:** Reko forms with photo upload from mobile devices.
- **Training:** isolated scenarios, auto-generated incidents, adjustable sim tempo, and
  simulated GPS drives.
- **Printing:** a standalone thermal print agent (ESC/POS over the network) for dispatch slips
  and QR walk-in slips.
- **Resilience:** paper Lageblatt PDF, automatic thermal board snapshots, and an outage SOP.
- **Reporting:** after-action PDF report and Excel import/export.
- **Access:** Editor (full CRUD) and Viewer (read-only) roles, a German (next-intl) UI, dark
  mode, a ⌘K command palette with keyboard shortcuts, and a built-in help page.

See [`CHANGELOG.md`](CHANGELOG.md) for the feature history.

## Status

KP Rück is in operational use at Feuerwehr Oberwil and under active development. Each
single-tenant deployment supplies its own branding, fleet, personnel roster, and integration
credentials. The UI ships in German (Swiss firefighting terminology); a next-intl layer is in
place, so additional locales are a tractable contribution.

## Quick Start

```bash
git clone https://github.com/feuerwehr-oberwil/kp-rueck.git
cd kp-rueck
just dev    # or: docker compose -f docker-compose.dev.yml up --build
```

This starts the frontend (`:3000`), backend (`:8000`), database, and tile server. The database
is auto-seeded on first run; admin credentials are printed to the terminal.

> **Prerequisites:** Docker and Docker Compose. Optionally
> [just](https://github.com/casey/just) for the shorthand commands. For local development
> without Docker, see [backend/README.md](backend/README.md).

## Architecture & key decisions

A Next.js frontend talks to a single FastAPI service that owns the database, the photo store,
and every outbound integration — one deployment per station. Full diagrams and rationale live in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```mermaid
flowchart TB
  subgraph CLIENT["Browser — command post & mobile"]
    UI["Kanban board · Map · Reko<br/>Next.js 15 + React 19"]
  end
  subgraph DEP["Deployment — one per station (single-tenant)"]
    API["FastAPI<br/>REST + Socket.IO · auth · audit · exports"]
    DB[("PostgreSQL")]
    FILES[("Photo storage")]
    API --- DB
    API --- FILES
  end
  subgraph EXT["External (backend-proxied)"]
    DIV["Divera 24/7<br/>alarm in/out · roster"]
    TRC["Traccar<br/>vehicle GPS"]
    HOOK["Any dispatch system<br/>POST /api/alarms"]
  end
  AGENT["Print agent<br/>ESC/POS thermal"]
  TILES["Map tiles<br/>OSM · offline TileServer GL"]
  UI <-->|"/api/* · WebSocket"| API
  API <--> DIV
  TRC --> API
  HOOK --> API
  AGENT -->|"pulls jobs"| API
  UI -. "tiles direct to browser" .-> TILES
```

**Deliberate tradeoffs:**

- **Single-tenant:** one station per deployment keeps ownership and isolation simple.
- **Training vs. live:** the same database, separated by a `training_flag`, so drills use the
  real UI without polluting live data.
- **Provider-neutral integrations:** alarm intake and outbound alerting (Ausalarmierung) sit
  behind provider seams — adding a service is a module, not a rewrite — and every integration
  reports through `GET /api/integrations`. Personnel sync and vehicle GPS currently have one
  provider each (Divera, Traccar); they follow the same pattern and can be generalised if a
  station needs a different one.
- **Append-only audit:** operational history is corrected with new events, not rewritten.
- **Alembic is the only schema truth:** migrations run on boot; the app never creates tables
  implicitly.

## Integrations

Every external service is proxied by the backend (the browser never calls a third party) and is
**optional** — the app runs fully without any of them. Which providers are active is reported at
`GET /api/integrations`, so the UI adapts instead of hard-coding vendors. Secrets are
environment-only; the database stores selection and behaviour, never credentials.

| Connector | Direction | Works with today | Adding another |
|-----------|-----------|------------------|----------------|
| **Alarm intake** | in | **Any** dispatch system via the open `POST /api/alarms` webhook; a native [Divera 24/7](https://www.divera247.com/) adapter; a token-gated phone/walk-in form | Already open — POST the documented JSON, no code needed. See [docs/ALARM-INTEGRATIONS.md](docs/ALARM-INTEGRATIONS.md) |
| **Outbound alerting** (Ausalarmierung) | out | Divera 24/7 | Implement one `AlarmProvider` adapter in `backend/app/services/alerting/` |
| **Personnel roster sync** | in | Divera 24/7 | A Divera-specific convenience; synced identities are stored provider-neutrally (`personnel_external_identities`), so a second source can be added |
| **Vehicle GPS** | in | [Traccar](https://www.traccar.org/) | Currently Traccar-specific — no abstraction yet. It can be generalised the same way as the alarm connectors if a station uses a different tracker |
| **Printing** | out | Any network/CUPS printer via a pull-based agent (reference agent: ESC/POS thermal) | Point a custom agent at the four print endpoints. See [docs/PRINT_AGENT.md](docs/PRINT_AGENT.md) |

New connectors are welcome contributions — the alarm and alerting seams are the model to copy.

## Project Structure

```text
kp-rueck/
├── frontend/                 # Next.js 15 (App Router)
│   ├── app/                  # Pages: dashboard, map, settings, help
│   ├── components/           # React components + shadcn/ui
│   ├── messages/             # next-intl catalog (de.json)
│   └── lib/                  # API client, contexts, utilities
├── backend/                  # FastAPI
│   ├── app/api/              # Route handlers
│   ├── app/services/         # Business logic (Divera, Traccar, alerting, GPS, PDF)
│   ├── app/models.py         # SQLAlchemy models
│   └── alembic/              # Database migrations
├── print-agent/              # Standalone thermal printer agent
├── tileserver/               # Offline map tile server
├── docker-compose.dev.yml    # Development setup
└── justfile                  # Task runner (run `just` for all commands)
```

## Deployment

Runs on any Docker host, from **published images** – no build toolchain on the server:

```bash
cp .env.example .env          # POSTGRES_PASSWORD, SECRET_KEY, AUTH_SECRET_KEY, ADMIN_SEED_PASSWORD
docker compose up -d          # pulls ghcr.io/feuerwehr-oberwil/kp-rueck-*, migrates on boot
```

Everything is served through one origin (Caddy in front of frontend, backend and tileserver),
with automatic HTTPS when you set `DOMAIN`. Updating is
`docker compose pull && docker compose up -d`; pin a version with `KP_RUECK_TAG` in `.env` and
follow the [releases](https://github.com/feuerwehr-oberwil/kp-rueck/releases) –
[CHANGELOG.md](CHANGELOG.md) explains what a MAJOR/MINOR/PATCH bump means for a deployment.

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full self-hosting guide, or
**[docs/RAILWAY.md](docs/RAILWAY.md)** for the managed-PaaS route.

## Documentation

Start with the [documentation index](docs/README.md). Highlights:

| Document | Description |
|----------|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and deployment diagrams |
| [docs/ALARM-INTEGRATIONS.md](docs/ALARM-INTEGRATIONS.md) | Provider-neutral alarm webhook and integration registry |
| [docs/RAILWAY.md](docs/RAILWAY.md) | Railway deployment guide |
| [docs/PRINT_AGENT.md](docs/PRINT_AGENT.md) | Thermal printer and print agent |
| [docs/OFFLINE_MAPS.md](docs/OFFLINE_MAPS.md) | Offline map tiles setup |
| [docs/AUSFALL_SOP.md](docs/AUSFALL_SOP.md) | Outage / paper-fallback standard operating procedure |
| [backend/README.md](backend/README.md) | Backend API and configuration reference |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |

## Related project

KP Rück runs the **rear** command post — the resource board. If you're looking for **frontline**
Einsatzführung — a shared Lagekarte, tactical symbols, Atemschutz (SCBA) tracking, and object
plans — see its companion **[KP Front](https://github.com/feuerwehr-oberwil/kp-front)**
([live demo](https://demo.kp-front.ch)).

The two grew out of the same brigade and share a design language, but they are **completely
independent** codebases and deployments — neither requires the other. They can *optionally* hand
alarms to each other through the same generic `POST /api/alarms` webhook, and nothing more.

## Contributing

Contributions are welcome: bug fixes, integrations, translations, or ideas. See
**[CONTRIBUTING.md](CONTRIBUTING.md)** for guidelines.

## License

[AGPL-3.0-or-later](LICENSE) — free to use, modify, and deploy. Modified versions served over a
network must share their source under the same license.

Copyright © 2026 Bastian Eichenberger.

## Acknowledgments

- **[Feuerwehr Oberwil BL](https://www.feuerwehroberwil.ch/)** — original development and
  real-world testing
- [shadcn/ui](https://ui.shadcn.com/), [OpenStreetMap](https://www.openstreetmap.org/),
  [TileServer GL](https://github.com/maptiler/tileserver-gl),
  [Planetiler](https://github.com/onthegomap/planetiler)

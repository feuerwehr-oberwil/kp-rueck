# KP Rück

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Live Demo](https://img.shields.io/badge/Demo-live-brightgreen)](https://demo.kp-rueck.app)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688)](https://fastapi.tiangolo.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.12+-blue)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED)](https://docs.docker.com/compose/)

A tactical operations dashboard for firefighting command posts. Digital replacement for the physical magnet board system used to track personnel, vehicles, materials, and incidents during emergency operations.

Originally developed by [Feuerwehr Oberwil BL](https://www.feuerwehroberwil.ch/) (a volunteer fire department in Basel-Landschaft, Switzerland) and designed to be fully adaptable for any fire department.

> **Note:** This entire project was vibe coded -- an experiment in how far you can take AI-assisted development and how much you can trust the result in a real-world operational setting.

| Operations Board | Interactive Map |
|:---:|:---:|
| ![Dashboard](docs/images/dashboard.png) | ![Map View](docs/images/map-view.png) |

---

## Live Demo

Try KP Rück without installing anything: **[demo.kp-rueck.app](https://demo.kp-rueck.app)**

The demo comes pre-loaded with a realistic flood scenario ("Hochwasser Oberwil") including ~20 personnel, 5 vehicles, 15+ materials, and 6 incidents across all workflow stages. Log in with one click and explore the full interface.

| | |
|---|---|
| **Editor login** | `demo-editor` / `demo123` -- full CRUD, drag-and-drop, create incidents |
| **Viewer login** | `demo-viewer` / `demo123` -- read-only view, same as field tablets |
| **Resets** | Every 2 hours all data returns to the seed state |

> Hardware integrations (thermal printer, GPS tracking, Divera alerting) are not available in the demo since they require physical devices or external services.

---

## Why KP Rück?

Many fire departments manage operations using physical magnet boards -- moving tokens around to track which personnel and vehicles are assigned to which incidents. This works, but it has real limitations:

- Only visible to whoever is standing at the board
- No history or audit trail
- Easy to lose track during multi-incident scenarios
- Cannot be updated remotely from the field

**KP Rück** digitizes this workflow while keeping the familiar Kanban-style interface that commanders already know. It runs on any device with a browser, syncs in real time, and adds features like maps, training mode, and thermal printer support on top.

> **What does "KP Rück" mean?**
> KP = *Kommandoposten* (Command Post), Rück = *Rückwärtiger Dienst* (Rear Services).
> In Swiss firefighting, the KP Rück is the coordination hub behind the front lines -- exactly what this software is.

---

## Features

### Operations Board
- **Kanban-style drag-and-drop** incident management with status columns
- **Real-time sync** across multiple devices (configurable polling interval)
- **Workflow stages**: Incoming -> Reconnaissance -> Dispatched -> Completed -> Archived
- **Resource conflict warnings** when personnel or vehicles are double-assigned

### Resource Management
- Track **personnel** with configurable ranks and role tags (e.g. driver, heights specialist)
- Manage **vehicles** and **materials/equipment** with assignment tracking
- Drag resources from sidebars directly onto incident cards
- **Excel import/export** for bulk data management

### Interactive Map
- Leaflet-based map with incident markers and live status
- Optional **GPS vehicle tracking** via [Traccar](https://www.traccar.org/) integration
- **Offline map tiles** for areas without reliable internet (self-hosted TileServer GL)

### Field Operations
- **Reconnaissance (Reko) forms** with photo upload from mobile devices
- Mobile-friendly responsive interface for field teams
- QR code for quick access to the viewer mode

### Training Mode
- Completely **separate training scenarios** from live operations
- Auto-generate realistic training incidents from configurable templates
- Same interface, isolated data -- train without affecting real operations

### Integrations
- **[Divera 24/7](https://www.divera247.com/)** alarm webhook + polling support
- **[Traccar](https://www.traccar.org/)** GPS vehicle tracking
- **Thermal printer** support for dispatch slips (ESC/POS over network)

### Other
- **Dark mode** with system/manual toggle
- **Audit log** for all changes with search and export
- **Role-based access**: Editor (full CRUD) and Viewer (read-only)
- **Keyboard shortcuts** for power users (60+ shortcuts)
- Built-in **help page** with full documentation

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| **Backend** | FastAPI (Python 3.12+), SQLAlchemy 2.0 (fully async) |
| **Database** | PostgreSQL 16 |
| **Maps** | Leaflet + OpenStreetMap (+ optional offline TileServer GL) |
| **Deployment** | Docker Compose (local), Railway / any Docker host (production) |
| **Package Managers** | pnpm (frontend), uv (backend) |

---

## Quick Start

### Prerequisites

- **Docker** and **Docker Compose** (recommended)
- Or for local development: Node.js 20+, [pnpm](https://pnpm.io/), Python 3.12+, [uv](https://docs.astral.sh/uv/), PostgreSQL 16
- Optional: [just](https://github.com/casey/just) command runner

### Option A: Docker (recommended)

```bash
git clone https://github.com/feuerwehr-oberwil/kp-rueck.git
cd kp-rueck

# Start all services with hot reload
just dev
# or without just:
docker compose -f docker-compose.dev.yml up --build
```

This starts **four services** automatically:

| Service | URL | Purpose |
|---------|-----|---------|
| Frontend | http://localhost:3000 | Next.js application |
| Backend | http://localhost:8000 | FastAPI + auto-seeded database |
| API Docs | http://localhost:8000/docs | Interactive Swagger UI |
| Tile Server | http://localhost:8080 | Offline map tiles (optional) |

### Option B: Local Development (no Docker for app)

You still need PostgreSQL running. The easiest way is to start just the database via Docker:

```bash
just db         # starts PostgreSQL on port 5433
```

Then, in **two separate terminals**:

**Terminal 1 -- Backend:**
```bash
cd backend
uv sync                              # install dependencies
cp .env.example .env                 # configure (defaults work for local dev)
uv run alembic upgrade head          # run database migrations
uv run python -m app.seed            # seed demo data
uv run uvicorn app.main:app --reload # start on port 8000
```

**Terminal 2 -- Frontend:**
```bash
cd frontend
pnpm install                         # install dependencies
cp .env.local.example .env.local     # configure API URL
pnpm dev                             # start on port 3000
```

### First Login

After seeding, the admin credentials are printed to the terminal. In development mode, a random password is generated on first run. Look for output like:

```
Admin user created: admin / <generated-password>
```

---

## Customizing for Your Department

KP Rück is designed to work for **any fire department** out of the box. Here's how to make it yours:

### 1. Quick Setup (via UI)

After starting the application, go to **Settings** and configure:

| Setting | What it does |
|---------|-------------|
| Station Name | Your department's display name |
| Location | Firestation coordinates (used as map center) |
| Home City | Default city for new incidents |
| Map Mode | Online, offline, or auto-fallback |
| Printer | IP/port for thermal ESC/POS printer |

### 2. Import Your Data

Use the **Settings > Import/Export** page to bulk-import via Excel:

- **Personnel** -- names, ranks, role tags (driver, specialist, etc.)
- **Vehicles** -- designation, type, status
- **Materials** -- name, quantity, storage location

Download the Excel templates from the import page, fill them in, and upload.

### 3. Custom Seed Data (optional)

For automated deployments or CI, you can create a custom seed file:

```bash
# Copy the demo seed as a starting point
cp backend/app/seed.py backend/app/seed_yourdepartment.py
```

Edit the file with your personnel, vehicles, materials, and geographic coordinates.

### 4. Training Mode Configuration

Training mode generates realistic practice incidents within a geographic area. Configure the bounding box in your seed file or via the training settings to match your department's coverage area.

---

## Configuration Reference

### Environment Variables

All configuration is done via environment variables. Copy the `.env.example` files to get started.

#### Backend (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://...` | PostgreSQL connection string |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed frontend origins (comma-separated) |
| `SECRET_KEY` | *(auto-generated)* | JWT signing key. **Set explicitly in production.** |
| `ADMIN_SEED_PASSWORD` | *(auto-generated)* | Initial admin password. Set for reproducible deployments. |
| `PHOTOS_DIR` | `data/photos` | Directory for Reko photo uploads |
| `MAX_PHOTO_SIZE_MB` | `10` | Maximum photo upload size |

**Optional integrations:**

| Variable | Default | Description |
|----------|---------|-------------|
| `DIVERA_ACCESS_KEY` | *(empty)* | Divera 24/7 API key. Empty = disabled. |
| `DIVERA_POLL_INTERVAL_SECONDS` | `30` | Divera polling frequency |
| `TRACCAR_URL` | *(empty)* | Traccar GPS server URL. Empty = disabled. |
| `TRACCAR_EMAIL` | | Traccar login credentials |
| `TRACCAR_PASSWORD` | | |
| `MASTER_TOKEN` | *(empty)* | API token for remote config (e.g. print agent). Empty = disabled. |

**Advanced:**

| Variable | Default | Description |
|----------|---------|-------------|
| `DEMO_MODE` | `false` | Enable demo mode (disables user management, training, bulk import) |
| `RAILWAY_URL` | *(empty)* | Enable local-to-cloud sync mode |
| `AUTH_BYPASS_DEV` | `false` | Skip authentication in development |
| `AUTH_ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | JWT token lifetime |

#### Frontend (`frontend/.env.local`)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend API URL |

### Database Settings (via UI)

These settings are stored in the database and configurable through the Settings page:

| Setting | Default | Description |
|---------|---------|-------------|
| `firestation_name` | Demo Fire Department | Organization display name |
| `firestation_latitude` / `longitude` | 47.56 / 7.59 | Map center coordinates |
| `home_city` | Demo City, Switzerland | Default location for incidents |
| `polling_interval_ms` | 5000 | Frontend sync interval (milliseconds) |
| `training_mode` | false | Enable training mode |
| `auto_archive_timeout_hours` | 24 | Auto-archive completed incidents after N hours |
| `map_mode` | online | Map tile source: `auto`, `online`, or `offline` |
| `printer_enabled` | false | Enable thermal printer integration |
| `printer_ip` / `printer_port` | | Network printer address |
| `alarm_webhook_secret` | | Secret for Divera webhook authentication |

---

## Project Structure

```
kp-rueck/
├── frontend/                  # Next.js 15 application
│   ├── app/                   # App Router pages (dashboard, map, settings, help)
│   ├── components/            # React components + shadcn/ui
│   ├── lib/                   # API client, contexts, utilities
│   └── public/content/        # Help page content (Markdown)
├── backend/                   # FastAPI application
│   ├── app/
│   │   ├── api/               # API route handlers
│   │   ├── services/          # Business logic (Divera, Traccar, sync)
│   │   ├── models.py          # SQLAlchemy database models
│   │   ├── schemas.py         # Pydantic request/response schemas
│   │   └── seed.py            # Demo data seeder
│   └── alembic/               # Database migrations
├── print-agent/               # Thermal printer agent (standalone)
│   ├── agent.py               # Polling loop
│   ├── printer.py             # ESC/POS network printer driver
│   └── formatters.py          # Print layout formatters
├── tileserver/                # Offline map tile server (Dockerfile)
├── docker-compose.yml         # Production setup
├── docker-compose.dev.yml     # Development with hot reload
└── justfile                   # Task runner commands (run `just` to see all)
```

---

## Development Commands

All common tasks are available via [just](https://github.com/casey/just). Run `just` to see the full list.

| Command | Description |
|---------|-------------|
| `just dev` | Start all services with Docker (hot reload) |
| `just be` | Run backend locally (database in Docker) |
| `just fe` | Run frontend locally |
| `just db` | Database management (`shell`, `seed`, `migrate`, `status`, ...) |
| `just test` | Run E2E tests (Playwright) |
| `just test-ui` | Playwright interactive UI mode |
| `just lint` | Lint frontend + backend |
| `just fmt` | Format backend code (ruff) |
| `just tiles-download` | Download full offline map tiles |
| `just tiles-status` | Check tile server status |
| `just printer` | Start thermal print agent (also: `dry`, `stop`, `status`, `logs`) |
| `just clean` | Stop services and remove volumes |

---

## Deployment

KP Rück runs on any platform that supports Docker. The repository includes configuration for [Railway](https://railway.app/), but you can deploy to any Docker host, VPS, or cloud provider.

See **[docs/RAILWAY.md](docs/RAILWAY.md)** for step-by-step Railway deployment instructions.

### Production Checklist

- [ ] Set a strong `SECRET_KEY` (generate with `openssl rand -hex 32`)
- [ ] Set `ADMIN_SEED_PASSWORD` for the initial admin account
- [ ] Configure `DATABASE_URL` for your production database
- [ ] Set `CORS_ORIGINS` to your frontend domain
- [ ] Configure photo storage with persistent volume (`PHOTOS_DIR`)
- [ ] Set up custom domain with SSL
- [ ] Enable monitoring and alerts

### Optional Production Features

- [ ] Connect **Divera 24/7** for automatic alarm import (`DIVERA_ACCESS_KEY`)
- [ ] Connect **Traccar** for GPS vehicle tracking (`TRACCAR_URL`)
- [ ] Set up **thermal printer** for dispatch slips (via print agent or settings page)
- [ ] Enable **offline map tiles** for field reliability (see [docs/OFFLINE_MAPS.md](docs/OFFLINE_MAPS.md))
- [ ] Configure **training mode** templates for your geographic area

---

## Thermal Printer (Optional)

KP Rück supports ESC/POS thermal printers for printing dispatch slips and board snapshots. This is useful for command posts that need physical records.

**Supported printers:** Any ESC/POS compatible network printer (tested with Epson TM-T20, 58mm paper width).

**Setup options:**
1. **Print agent** -- standalone Python service that polls the backend for print jobs. Designed to run on a Raspberry Pi or similar device near the printer.
2. **Direct from UI** -- configure printer IP/port in Settings and trigger prints from the dashboard.

```bash
# Test locally without a real printer
just printer dry

# Run with a real printer
just printer
```

See the `print-agent/` directory for configuration details.

---

## Offline Maps (Optional)

For operations in areas with unreliable internet, KP Rück includes a self-hosted tile server that provides offline map capability.

- Auto-starts with `just dev` (minimal bootstrap tiles)
- Download full offline tiles with `just tiles-download` (~12 MB for Basel-Landschaft)
- Easily adaptable to any region using [Geofabrik](https://download.geofabrik.de/) OSM extracts
- Three modes: **Auto** (online with offline fallback), **Online**, **Offline**

See **[docs/OFFLINE_MAPS.md](docs/OFFLINE_MAPS.md)** for the full setup guide including custom regions.

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, components, and deployment diagrams |
| [docs/RAILWAY.md](docs/RAILWAY.md) | Railway deployment guide |
| [docs/OFFLINE_MAPS.md](docs/OFFLINE_MAPS.md) | Offline map tiles setup |
| [docs/PRINT_AGENT.md](docs/PRINT_AGENT.md) | Thermal printer & print agent setup |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |
| [backend/README.md](backend/README.md) | Backend API documentation |

---

## Terminology

The UI uses Swiss-German firefighting terminology. Here's a quick reference:

| German | English | Context |
|--------|---------|---------|
| Einsatz | Incident / Operation | A single event being managed |
| Eingegangen | Incoming | New incident, not yet assessed |
| Reko | Reconnaissance | Field assessment in progress |
| Disponiert | Dispatched | Resources assigned and en route |
| Abschluss | Completed | Incident resolved |
| Archiv | Archive | Historical record |
| Offiziere | Officers | Highest rank group |
| Wachtmeister | Sergeants | Second rank group |
| Korporal | Corporals | Third rank group |
| Mannschaft | Firefighters | General personnel |
| Magazin | Equipment storage | Where materials are kept |
| Fahrzeuge | Vehicles | Apparatus / trucks |
| Einsatzzettel | Dispatch slip | Printed incident summary |

> **Note:** The interface is currently in German. Translations/i18n support is a welcome contribution!

---

## Contributing

Contributions are welcome! Whether it's a bug fix, a new integration, or a translation -- we'd love your help.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for guidelines.

**Ideas for contributions:**
- Translations / i18n support
- Integrations with other alerting platforms (Alamos, BORS, etc.)
- CAD system connectors
- PDF report generation
- WebSocket support for real-time updates
- Mobile app (React Native / PWA)

---

## License

AGPL-3.0 -- see [LICENSE](LICENSE) for details.

You're free to use, modify, and deploy this software. If you deploy a modified version (including as a web service), you must make your source code available under the same license.

## Acknowledgments

- **[Feuerwehr Oberwil BL](https://www.feuerwehroberwil.ch/)** -- Original development and real-world testing
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Maps powered by [OpenStreetMap](https://www.openstreetmap.org/)
- Offline tiles via [TileServer GL](https://github.com/maptiler/tileserver-gl) and [Planetiler](https://github.com/onthegomap/planetiler)

---

**Questions or issues?** Open an [issue](https://github.com/feuerwehr-oberwil/kp-rueck/issues) on GitHub.

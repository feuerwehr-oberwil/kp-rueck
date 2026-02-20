# KP Rück

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Live Demo](https://img.shields.io/badge/Demo-live-brightgreen)](https://demo.kp-rueck.app)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688)](https://fastapi.tiangolo.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.12+-blue)](https://www.python.org/)

Tactical operations dashboard for firefighting command posts. Replaces the physical magnet board used to track personnel, vehicles, materials, and incidents during emergency operations.

Originally developed by [Feuerwehr Oberwil BL](https://www.feuerwehroberwil.ch/) and designed to be adaptable for any fire department.

> **Note:** This entire project was vibe coded — an experiment in how far you can take AI-assisted development and how much you can trust the result in a real-world operational setting.

| Operations Board | Interactive Map |
|:---:|:---:|
| ![Dashboard](docs/images/dashboard.png) | ![Map View](docs/images/map-view.png) |

**Try it now: [demo.kp-rueck.app](https://demo.kp-rueck.app)** · log in as `demo-editor` / `demo123`

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Kanban board** with drag-and-drop incident management and real-time sync
- **Interactive map** with incident markers, optional GPS vehicle tracking ([Traccar](https://www.traccar.org/)), and offline tiles
- **Resource tracking** for personnel, vehicles, and materials with conflict warnings
- **Field reconnaissance** forms with photo upload from mobile devices
- **Training mode** with isolated scenarios and auto-generated incidents
- **Alarm integration** with [Divera 24/7](https://www.divera247.com/) webhook and polling
- **Thermal printer** support for dispatch slips (ESC/POS over network)
- **Excel import/export** for bulk data management
- **Role-based access** with Editor (full CRUD) and Viewer (read-only) roles
- **Dark mode**, 60+ keyboard shortcuts, audit log, and a built-in help page

## Quick Start

```bash
git clone https://github.com/feuerwehr-oberwil/kp-rueck.git
cd kp-rueck
just dev    # or: docker compose -f docker-compose.dev.yml up --build
```

This starts the frontend (`:3000`), backend (`:8000`), database, and tile server. The database is auto-seeded on first run; admin credentials are printed to the terminal.

> **Prerequisites:** Docker and Docker Compose. Optionally [just](https://github.com/casey/just) for the shorthand commands. For local development without Docker, see [backend/README.md](backend/README.md).

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| Backend | FastAPI (Python 3.12+), SQLAlchemy 2.0 (async), Alembic |
| Database | PostgreSQL 16 |
| Maps | Leaflet + OpenStreetMap, optional offline TileServer GL |
| Infrastructure | Docker Compose, pnpm, uv |

## Project Structure

```
kp-rueck/
├── frontend/                 # Next.js 15 (App Router)
│   ├── app/                  # Pages: dashboard, map, settings, help
│   ├── components/           # React components + shadcn/ui
│   └── lib/                  # API client, contexts, utilities
├── backend/                  # FastAPI
│   ├── app/api/              # Route handlers
│   ├── app/services/         # Business logic (Divera, Traccar, sync)
│   ├── app/models.py         # SQLAlchemy models
│   └── alembic/              # Database migrations
├── print-agent/              # Standalone thermal printer agent
├── tileserver/               # Offline map tile server
├── docker-compose.dev.yml    # Development setup
└── justfile                  # Task runner (run `just` for all commands)
```

## Deployment

Runs on any Docker host. The repo includes configuration for [Railway](https://railway.app/), but works on any platform.

**Minimum production setup:**
1. Set `SECRET_KEY` (`openssl rand -hex 32`)
2. Set `DATABASE_URL` for your PostgreSQL instance
3. Set `CORS_ORIGINS` to your frontend domain
4. Configure a persistent volume for photo uploads

See **[docs/RAILWAY.md](docs/RAILWAY.md)** for a step-by-step guide.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and deployment diagrams |
| [docs/RAILWAY.md](docs/RAILWAY.md) | Railway deployment guide |
| [docs/OFFLINE_MAPS.md](docs/OFFLINE_MAPS.md) | Offline map tiles setup |
| [docs/PRINT_AGENT.md](docs/PRINT_AGENT.md) | Thermal printer and print agent |
| [backend/README.md](backend/README.md) | Backend API and configuration reference |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |

> The UI is in German (Swiss firefighting terminology). Translations and i18n support are a welcome contribution.

## Contributing

Contributions are welcome: bug fixes, integrations, translations, or ideas. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for guidelines.

## License

[AGPL-3.0](LICENSE) — free to use, modify, and deploy. Modified versions served over a network must share their source under the same license.

## Acknowledgments

- **[Feuerwehr Oberwil BL](https://www.feuerwehroberwil.ch/)** — original development and real-world testing
- [shadcn/ui](https://ui.shadcn.com/), [OpenStreetMap](https://www.openstreetmap.org/), [TileServer GL](https://github.com/maptiler/tileserver-gl), [Planetiler](https://github.com/onthegomap/planetiler)

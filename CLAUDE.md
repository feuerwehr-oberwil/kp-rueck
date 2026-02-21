# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Quick Start (Docker - Recommended)

```bash
# Development mode with hot reload
just dev

# Database management
just db seed       # Seed with initial data
just db migrate    # Run pending migrations

# Offline map tiles (optional)
just tiles-download  # Download and install tiles (~12 MB)
just tiles-status    # Check tile server status

# Stop everything
just stop

# Clean up (removes volumes)
just clean
```

### Local Development (Without Docker)

**Backend:**
```bash
cd backend
uv sync                              # Install dependencies
uv run python -m app.seed            # Create tables + seed data
uv run uvicorn app.main:app --reload # Start dev server (port 8000)
uv run ruff check .                  # Lint
uv run ruff format .                 # Format
```

**Frontend:**
```bash
cd frontend
pnpm install                         # Install dependencies
pnpm dev                             # Start dev server (port 3000)
pnpm build                           # Build for production
pnpm lint                            # Lint
pnpm test                            # Run Playwright tests
pnpm test:ui                         # Playwright UI mode
```

**Database:**
```bash
# Database commands (just db help for all options)
just db shell                  # PostgreSQL shell
just db migrate                # Upgrade to latest
just db status                 # Show current revision
just db history                # Show migration history
just db new "message"          # Create new migration
```

### Testing

**Quick Start (justfile):**
```bash
# Run all tests (backend + E2E, ensure services are running first)
just test

# Run E2E tests in interactive UI mode
just test-ui
```

**Direct Commands:**
```bash
# Backend
cd backend && uv run pytest

# Frontend E2E tests
cd frontend && pnpm test                    # Run all tests
cd frontend && pnpm test:ui                 # Interactive UI mode
cd frontend && pnpm test tests/e2e/01-auth/ # Run specific test suite
cd frontend && pnpm exec playwright test --headed  # Visible browser
```

**Test Infrastructure:**
- Framework: Playwright with TypeScript
- Architecture: Page Object Model + Custom Fixtures
- Test Data: Factory pattern + API helpers
- Location: `frontend/tests/`

## Architecture Overview

**Stack:**
- **Frontend**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS 4
- **Backend**: FastAPI (async Python) + SQLAlchemy 2.0 (async ORM)
- **Database**: PostgreSQL 16
- **Map Tiles**: TileServer GL (self-hosted offline tiles for Basel-Landschaft)
- **Package Managers**: pnpm (frontend), uv (backend)
- **Deployment**: Docker containers via Railway
- **Local Development**: Docker Compose with hot reload

**Application Purpose:**
Tactical firefighting operations dashboard for managing personnel, materials, and incidents. Digital replacement for physical magnet board system used in command posts (KP Rück).

**Key Features:**
- Kanban-style operations board with drag-and-drop status management
- Interactive map view with operation locations (Leaflet + OpenStreetMap)
- Real-time data sync via polling (≤5s interval, no WebSockets in MVP)
- Personnel, vehicle, and material resource tracking
- Training mode vs. live operations (same database, filtered by flag)
- Field reconnaissance (Reko) forms with photo upload
- Editor (full CRUD) vs. Viewer (read-only) roles

## Project Structure

```
kp-rueck/
├── frontend/
│   ├── app/
│   │   ├── page.tsx                 # Main Kanban dashboard
│   │   ├── map/page.tsx             # Map view
│   │   └── layout.tsx               # Root layout with providers
│   ├── components/
│   │   ├── ui/                      # shadcn/ui components
│   │   └── map-view.tsx             # Leaflet map integration
│   └── lib/
│       ├── contexts/                # React contexts
│       │   └── operations-context.tsx  # State management + API sync
│       ├── api-client.ts            # Backend API client
│       └── env.ts                   # Environment variable handling
├── backend/
│   └── app/
│       ├── main.py                  # FastAPI app with lifespan events
│       ├── config.py                # Pydantic settings management
│       ├── database.py              # Async SQLAlchemy configuration
│       ├── models.py                # Database models
│       ├── schemas.py               # Pydantic request/response schemas
│       ├── crud.py                  # Async CRUD operations
│       ├── seed.py                  # Database seeding script
│       └── api/routes.py            # API endpoints
├── docker-compose.yml               # Production setup
├── docker-compose.dev.yml           # Development with hot reload
└── justfile                         # Common development tasks (use `just` command)
```

## Key Architectural Patterns

### Backend (FastAPI)

- **Async everywhere**: All database operations use `async/await` with `AsyncSession`
- **Dependency injection**: Settings and database sessions injected via FastAPI dependencies
- **Pydantic for validation**: Request/response schemas and settings management
- **Lifespan events**: Modern FastAPI lifecycle management (not deprecated startup/shutdown)
- **SQLAlchemy 2.0**: New mapped column syntax with async engine
- **Type hints**: Full type safety throughout the codebase
- **uv package manager**: Fast, modern Python dependency management

### Frontend (Next.js)

- **App Router**: Next.js 15 app directory structure (not pages)
- **Server Components**: Default to server components where possible
- **Client Components**: Use `"use client"` for interactivity (contexts, hooks, event handlers)
- **API Integration**: Centralized API client in `lib/api-client.ts`
- **State Management**: React Context for global state (`operations-context.tsx`)
- **UI Components**: shadcn/ui components in `components/ui/`
- **Polling sync**: Client polls backend every ~5s for updates (configurable)

### Database Schema (Key Tables)

- **incidents**: Fire/rescue incidents with location, crew, materials, status, training flag
- **personnel**: Firefighters with roles and availability status
- **vehicles**: Fire apparatus (TLF, DLK, MTW) with type and status
- **materials**: Equipment/resources with availability and location
- **incident_assignments**: Many-to-many resource assignments to incidents
- **reko_reports**: Field reconnaissance reports linked to incidents
- **status_transitions**: Audit trail of incident workflow changes
- **audit_log**: Comprehensive action logging
- **users**: User accounts with roles (editor/viewer)
- **settings**: System configuration key-value store

### API Endpoints

Incidents: `/api/incidents` (GET, POST, PUT, DELETE)
Personnel: `/api/personnel` (GET, POST, PUT)
Vehicles: `/api/vehicles` (GET, POST, PUT)
Materials: `/api/materials` (GET, POST, PUT)

Full docs: http://localhost:8000/docs (Swagger UI)

## Environment Variables

**Backend** (`.env`):
```env
DATABASE_URL=postgresql+asyncpg://kprueck:kprueck@localhost:5433/kprueck
CORS_ORIGINS=http://localhost:3000
API_V1_PREFIX=/api
```

**Frontend** (`.env.local`):
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Deployment

**Railway (Production):**
- Three services: PostgreSQL, Backend, Frontend
- See `docs/RAILWAY.md` for deployment guide
- Backend uses `start.sh` script for initialization
- Frontend uses production Next.js build

**Docker Compose (Local):**
- `docker-compose.yml`: Production mode
- `docker-compose.dev.yml`: Development with hot reload and volume mounts

## Offline Map Tiles

The system includes optional offline map tile support for Basel-Landschaft region to enable map functionality when internet connectivity is unavailable.

**Architecture:**
- **Tile Server**: TileServer GL running on port 8080
- **Coverage**: Basel-Landschaft region, zoom levels 0-17
- **Storage**: MBTiles format (~1-2 GB), stored in Docker volume
- **Behavior**:
  - **Auto mode** (default): Try online OSM tiles first, fall back to offline on failure
  - **Online mode**: Always use online OSM tiles
  - **Offline mode**: Always use local tiles

**Setup:**
```bash
# Download and install tiles (~12 MB, takes 5-15 minutes)
just tiles-download

# Check status
just tiles-status

# View tile server UI
open http://localhost:8080
```

**Frontend Integration:**
- Map mode setting in Settings page (`auto` | `online` | `offline`)
- Automatic fallback from online to offline tiles on network error
- User preference stored in database settings
- Status indicator shows current mode in map view

**Tile Server Endpoints:**
- Health: `http://localhost:8080/health`
- Tiles: `http://localhost:8080/styles/basic/{z}/{x}/{y}.png`
- UI: `http://localhost:8080`

**Documentation:**
- Setup guide: `docs/OFFLINE_MAPS.md`
- Configuration: `tileserver-config.json`
- Download script: `scripts/download-tiles.sh`

**Note:** Offline tiles are optional. If not installed, map will work in online-only mode using OpenStreetMap tiles.

## Development Best Practices

- **Never create new files when editing suffices** - always prefer editing existing files
- **Backend follows FastAPI best practices**: async operations, proper DI, type hints
- **Frontend uses Next.js 15 patterns**: App Router, Server Components by default
- **State management**: Centralized in React Context with API sync
- **Polling over WebSockets**: Keep it simple in MVP (WebSockets are future enhancement)
- **Training vs Live**: Same database, filtered by `training_flag` on incidents
- **Resource conflicts**: UI warns when assigning already-assigned personnel/vehicles/materials

## Important Files & Documentation

- `ARCHITECTURE.md` - System architecture and technical design
- `README.md` - Setup instructions and feature overview
- `docs/RAILWAY.md` - Railway deployment guide
- `CONFIGURATION_SETTINGS.md` - System configuration and settings management
- `docs/OFFLINE_MAPS.md` - Offline map tiles setup and troubleshooting guide
- `justfile` - Quick reference for common commands (run `just` to see all)
- `backend/README.md` - Backend-specific setup and API docs
- `frontend/package.json` - Frontend scripts and dependencies

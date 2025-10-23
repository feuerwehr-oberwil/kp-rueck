# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Worktree & Git Workflow

**IMPORTANT**: This repository is a git worktree. When making commits:
1. Always check that everything is up to date first: `git pull --rebase`
2. After committing, push changes to main: `git push origin main`
3. Never leave commits unpushed - the worktree setup requires pushing to main immediately

## Common Development Commands

### Quick Start (Docker - Recommended)

```bash
# Development mode with hot reload
make dev

# Initialize and seed database
make init-db
make seed-db

# View logs
make logs
make logs-backend  # Backend only

# Stop everything
make stop

# Clean up (removes volumes)
make clean
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
# Access PostgreSQL shell
docker-compose exec postgres psql -U kprueck -d kprueck
# OR via Makefile
make shell-db
```

### Testing

```bash
# Backend (when implemented)
cd backend && uv run pytest

# Frontend
cd frontend && pnpm test
```

## Architecture Overview

**Stack:**
- **Frontend**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS 4
- **Backend**: FastAPI (async Python) + SQLAlchemy 2.0 (async ORM)
- **Database**: PostgreSQL 16
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
└── Makefile                         # Common development tasks
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

- **operations**: Fire operations with location, crew, materials, status, training flag
- **personnel**: Firefighters with roles and availability status
- **materials**: Equipment/resources with availability and location
- **incident_assignments**: Many-to-many resource assignments to operations
- **reko_reports**: Field reconnaissance reports linked to incidents
- **status_transitions**: Audit trail of operation workflow changes
- **audit_log**: Comprehensive action logging

### API Endpoints

Operations: `/api/operations` (GET, POST, PUT, DELETE)
Personnel: `/api/personnel` (GET, POST, PUT)
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
- See `RAILWAY.md` for deployment guide
- Backend uses `start.sh` script for initialization
- Frontend uses production Next.js build

**Docker Compose (Local):**
- `docker-compose.yml`: Production mode
- `docker-compose.dev.yml`: Development with hot reload and volume mounts

## Development Best Practices

- **Never create new files when editing suffices** - always prefer editing existing files
- **Backend follows FastAPI best practices**: async operations, proper DI, type hints
- **Frontend uses Next.js 15 patterns**: App Router, Server Components by default
- **State management**: Centralized in React Context with API sync
- **Polling over WebSockets**: Keep it simple in MVP (WebSockets are future enhancement)
- **Training vs Live**: Same database, filtered by `training_flag` on operations
- **Resource conflicts**: UI warns when assigning already-assigned personnel/vehicles/materials

## Important Files & Documentation

- `DESIGN_DOC.md` - Complete system requirements and architecture specification
- `README.md` - Setup instructions and feature overview
- `RAILWAY.md` - Railway deployment guide
- `Makefile` - Quick reference for common commands
- `backend/README.md` - Backend-specific setup and API docs
- `frontend/package.json` - Frontend scripts and dependencies

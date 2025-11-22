# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Worktree & Git Workflow

**IMPORTANT**: This repository is a git worktree. When making commits:
1. Always check that everything is up to date first: `git pull --rebase`
2. **Test thoroughly before committing**: Run builds, tests, and verify functionality works as expected
3. Once everything is tested and you're confident it works, create a commit and push to main
4. After committing, push changes to main: `git push origin main`
5. Never leave commits unpushed - the worktree setup requires pushing to main immediately

**Testing Checklist Before Commit:**
- Frontend: `cd frontend && pnpm build` (verify no compilation errors)
- Backend: `cd backend && uv run uvicorn app.main:app` (verify server starts)
- Run any relevant tests: `pnpm test` or `uv run pytest`
- Manually test the feature in the browser/application if applicable

## Common Development Commands

### Quick Start (Docker - Recommended)

```bash
# Development mode with hot reload
make dev

# Initialize and seed database
make init-db
make seed-db

# Offline map tiles (optional)
make tiles-setup    # Download and install tiles (~1-2 GB)
make tiles-status   # Check tile server status
make tiles-help     # Show offline maps help

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

**Quick Start (Makefile):**
```bash
# Run all E2E tests (ensure services are running first)
make test

# Run authentication tests only (7 tests)
make test-auth

# Run tests in interactive UI mode
make test-ui

# Run tests in headed mode (visible browser)
make test-headed

# Show last test report
make test-report
```

**Direct Commands:**
```bash
# Backend (when implemented)
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
- See: `E2E_TESTING_PLAN.md` for comprehensive test strategy

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
- See `RAILWAY.md` for deployment guide
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
# Download and install tiles (~1-2 GB, takes 5-15 minutes)
make tiles-setup

# Check status
make tiles-status

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
- Setup guide: `OFFLINE_MAPS.md`
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

## Common Pitfalls & Lessons Learned

### Database Schema Changes Require Multi-Layer Updates

**Issue**: When refactoring database models (e.g., renaming `Operation` → `Incident`, changing `int` IDs → `UUID`), it's easy to forget that changes must propagate through ALL application layers.

**What Happened (2025-10-23)**:
- Updated `models.py` with new schema (Operation → Incident, int → UUID)
- Created Alembic migrations successfully
- **Forgot to update** `schemas.py`, `crud.py`, and `routes.py`
- Railway deployment failed with: `AttributeError: module 'app.models' has no attribute 'Operation'`

**Root Cause**:
The API layer (routes.py, crud.py) was still importing and referencing the old `Operation` model that no longer existed in models.py.

**Required Changes Checklist**:
When changing database models, update ALL of these layers in order:
1. ✅ `models.py` - Database models (SQLAlchemy)
2. ✅ `alembic/versions/*.py` - Database migrations
3. ✅ `schemas.py` - Pydantic request/response schemas
4. ✅ `crud.py` - CRUD operations using the models
5. ✅ `api/routes.py` - API endpoints using schemas and CRUD
6. ⚠️ `tests/` - Update test fixtures and test data
7. ⚠️ Frontend - Update API client and TypeScript types

**Prevention**:
- Before pushing schema changes, search codebase for references to old model names
- Run tests locally before deploying (`uv run pytest`)
- Test the server locally (`uv run uvicorn app.main:app`)
- Consider using IDE find/replace to catch all references

**Example Commands**:
```bash
# Search for stale references before committing
grep -r "Operation" backend/app/  # Should only find in comments/docs
grep -r "operation_id" backend/app/  # Check for old parameter names

# Test locally before deploying
cd backend
uv run pytest  # Run all tests
uv run uvicorn app.main:app  # Start server and check logs
```

### FastAPI Trailing Slash 307 Redirects

**Issue**: Frontend API calls fail with "Load failed" and backend logs show `307 Temporary Redirect` errors.

**What Happened (2025-10-24)**:
- Backend FastAPI route defined with trailing slash: `@router.get("/", ...)` on `APIRouter(prefix="/settings")`
- This creates endpoint: `/api/settings/` (with trailing slash)
- Frontend API client called: `/api/settings` (without trailing slash)
- FastAPI automatically redirects `/api/settings` → `/api/settings/` with HTTP 307
- Frontend fetch fails because it doesn't follow the redirect properly

**Root Cause**:
FastAPI enforces strict trailing slash matching. When a route is defined with a trailing slash, requests without the trailing slash will receive a 307 redirect to add it. This causes issues with authenticated requests because cookies may not be forwarded correctly on redirect.

**Solution**:
Always match trailing slashes between frontend API calls and backend route definitions:
- **Option 1** (Recommended): Add trailing slash to frontend calls: `/api/settings/`
- **Option 2**: Remove trailing slash from backend routes (change `@router.get("/")` to `@router.get("")`)

**Prevention**:
- When adding new API endpoints, verify trailing slash consistency
- Test API calls in browser DevTools Network tab to catch 307 redirects
- Check backend logs for 307 responses - they indicate trailing slash mismatches

**Example**:
```typescript
// ❌ Wrong - missing trailing slash
async getAllSettings() {
  return this.request('/api/settings')  // Returns 307 redirect
}

// ✅ Correct - includes trailing slash
async getAllSettings() {
  return this.request('/api/settings/')  // Works correctly
}
```

**Related Files**:
- Frontend API calls: `frontend/lib/api-client.ts`
- Backend routes: `backend/app/api/*.py` (router definitions)

### Database Enum Values Must Match Schema Definitions

**Issue**: Backend fails with `ResponseValidationError` when returning data that doesn't match Pydantic enum definitions.

**What Happened (2025-10-24)**:
- Database contained old seed data with English enum values (`'fire'`, `'other'`, `'technical'`)
- Pydantic schemas expected German enum values (`'brandbekaempfung'`, `'strassenrettung'`, etc.)
- FastAPI validation failed when trying to serialize incidents with old values
- Error: `ResponseValidationError: Input should be 'brandbekaempfung', 'elementarereignis', ...`

**Root Cause**:
Database data was seeded with old enum values that no longer match the current schema definitions. When enum values change in `models.py` and `schemas.py`, existing database records must be migrated or reset.

**Solution**:
Reset and re-seed the database to use correct enum values.

**Local Development**:
```bash
make clean  # Remove containers and volumes
make dev    # Restart with fresh database (auto-seeds)
```

**Railway Production**:
See `RAILWAY.md` → "Database Reset (If Needed)" section for instructions on resetting Railway database.

**Prevention**:
- When changing enum values in models, create an Alembic migration to update existing data
- Alternatively, document that database reset is required after enum changes
- Ensure seed script (`app/seed.py`) always uses values that match schema enums
- Test API endpoints after schema changes to catch validation errors early

**Example Migration for Enum Changes**:
```python
# alembic/versions/xxx_update_incident_types.py
def upgrade():
    # Update existing values to new enum values
    op.execute("UPDATE incidents SET type = 'brandbekaempfung' WHERE type = 'fire'")
    op.execute("UPDATE incidents SET type = 'strassenrettung' WHERE type = 'technical'")
    # ... etc
```

**Related Files**:
- Schema definitions: `backend/app/schemas.py` (Pydantic enums)
- Model constraints: `backend/app/models.py` (database CHECK constraints)
- Seed script: `backend/app/seed.py` (must use matching values)

## Important Files & Documentation

- `ARCHITECTURE.md` - System architecture and technical design
- `README.md` - Setup instructions and feature overview
- `RAILWAY.md` - Railway deployment guide
- `CONFIGURATION_SETTINGS.md` - System configuration and settings management
- `OFFLINE_MAPS.md` - Offline map tiles setup and troubleshooting guide
- `Makefile` - Quick reference for common commands
- `backend/README.md` - Backend-specific setup and API docs
- `frontend/package.json` - Frontend scripts and dependencies
- Ensure commits are always! pushed to the main branch otherwise other worktrees don't have access
- Always commit to origin main
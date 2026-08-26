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

# Mirror a real deployment into the dev stack (zero-config setup; source is any
# Postgres URL, or 'railway' for the linked project). --config = settings/inventory
# only, no Einsätze. The replaced dev DB is dumped to ./backups/ first, and the
# dev logins (admin/kp-dev-password, editor, viewer) are re-seeded afterwards.
just dev-sync railway
just dev-sync postgres://user:pass@host:5432/db --config

# Offline map tiles (optional)
just tiles-download  # Download and install tiles (~12 MB)
just tiles-status    # Check tile server status

# Stop everything
just dev-stop

# Clean up (DELETES the dev database and photos – asks first)
just dev-clean
```

The `dev-` prefix is deliberate. `just up` / `just down` / `just doctor` / `just init` are the
**station operator's** verbs and act on the production stack; `dev-stop` / `dev-clean` are ours.
They used to be called `stop` and `clean`, which meant an operator who had installed `just` for
the offline-tiles step could take their own board down with a recipe described as "stop all
services".

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
pnpm test                            # Run Vitest unit tests
pnpm test:watch                      # Vitest watch mode
pnpm test:e2e                        # Run Playwright E2E tests
pnpm test:e2e:ui                     # Playwright UI mode
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
# Run all tests (backend + frontend unit + E2E, ensure services are running first)
just test

# Run E2E tests in interactive UI mode
just test-ui
```

**Direct Commands:**
```bash
# Backend
cd backend && uv run pytest

# Frontend unit tests (Vitest)
cd frontend && pnpm test                       # Run all unit tests
cd frontend && pnpm test:watch                 # Watch mode

# Frontend E2E tests (Playwright)
cd frontend && pnpm test:e2e                   # Run all E2E tests
cd frontend && pnpm test:e2e:ui                # Interactive UI mode
cd frontend && pnpm test:e2e tests/e2e/01-auth/ # Run specific test suite
cd frontend && pnpm exec playwright test --headed  # Visible browser
```

**Test Infrastructure:**
- Unit tests: Vitest + React Testing Library + jsdom (config: `vitest.config.ts`, setup: `vitest.setup.ts`). Files: `**/*.{test,spec}.{ts,tsx}` outside `tests/`.
- E2E: Playwright with TypeScript, Page Object Model + Custom Fixtures, Factory pattern + API helpers, located in `frontend/tests/`.

## Architecture Overview

**Stack:**
- **Frontend**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS 4
- **Backend**: FastAPI (async Python) + SQLAlchemy 2.0 (async ORM)
- **Database**: PostgreSQL 16
- **Map Tiles**: TileServer GL (self-hosted offline tiles; region set by `TILES_BOUNDS`, default Basel-Landschaft)
- **Package Managers**: pnpm (frontend), uv (backend)
- **Deployment**: two supported paths on the same images – Docker Compose from published GHCR images, or Railway (`docs/RAILWAY.md`). Pick by who runs the server: compose survives an internet outage, Railway means nobody has to look after a box.
- **Local Development**: Docker Compose with hot reload

**Application Purpose:**
Tactical firefighting operations dashboard for managing personnel, materials, and incidents. Digital replacement for physical magnet board system used in command posts (KP Rück).

**Key Features:**
- Kanban-style operations board with drag-and-drop status management
- Interactive map view with operation locations (Leaflet + OpenStreetMap)
- Real-time data sync via WebSockets (Socket.IO) with polling fallback (~5s interval)
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
- **Client Components in practice**: **all 22 pages under `app/` are `'use client'`** – this is
  the reality, not an aspiration to fix. The root layout mounts 30 providers (auth, operations,
  event, WebSocket, theme, i18n, …), and the board is a live, interactive surface: there is no
  meaningful server-rendered page here. Do not "restore" server components on a page as a
  cleanup; it will fail on the first context hook. Server components remain fine for genuinely
  static leaf components that touch no context.
- **API Integration**: Centralized API client in `lib/api-client.ts`
- **State Management**: React Context for global state (`operations-context.tsx`)
- **UI Components**: shadcn/ui components in `components/ui/`
- **WebSocket + polling sync**: Socket.IO pushes incident, driver, and assignment updates from `backend/app/websocket_manager.py`; client polls every ~5s as a fallback when the socket is down or for entities not yet wired to WS events

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

**The trailing slash on the collection routes is not decorative.** `/api/personnel` (no slash)
answers **307** to `/api/personnel/`, and a redirected POST does not carry its body – so a
scripted write silently does nothing and looks like a success. Write the slash:

Incidents: `/api/incidents/` (GET, POST, PUT, DELETE)
Personnel: `/api/personnel/` (GET, POST, PUT)
Vehicles: `/api/vehicles/` (GET, POST, PUT)
Materials: `/api/materials/` (GET, POST, PUT)
Alarm intake: `/api/alarms` (POST) – provider-neutral webhook, any dispatch system; Divera adapter at `/api/divera/webhook`
Integrations: `/api/integrations` (GET) – capability registry (which provider is configured per domain)

Full docs: [`docs/openapi.json`](docs/openapi.json) – the committed contract, regenerated
with `just openapi` (a pytest fails when it drifts). Live Swagger UI while the backend
runs: http://localhost:8000/docs

**Integration seams** (provider-neutral, see `docs/ALARM-INTEGRATIONS.md`):
- Inbound alarms funnel through `services/divera_intake.py` (shared inference/auto-attach); the pool table carries `source`/`source_id` provenance, incidents carry `source`/`source_ref`.
- Outbound alerting (Ausalarmierung) goes through the `AlarmProvider` protocol in `services/alerting/` (Divera = first adapter).
- Personnel provider identity lives in `personnel_external_identities` (`personnel.divera_user_id` is a deprecated dual-write, removable next release).
- Printing: transport-neutral job queue + pull agent (`docs/PRINT_AGENT.md`).

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
CARTO_API_KEY=<CARTO browser API key>
```

`NEXT_PUBLIC_*` is inlined at BUILD time, so it is a development convenience only – published
images are built without it. At runtime the server-side proxy route reads `API_URL`, and the
browser falls back to same-origin paths (`/backend-api`, `/tiles`); see `frontend/lib/env.ts`.
A runtime `CARTO_API_KEY` is handed to the browser so CARTO raster requests can include their
required `?key=` query parameter; it is never baked into the shared image.
A deployment `.env` for the compose stack is documented in `.env.example` / `docs/DEPLOYMENT.md`.

## Deployment

**Docker Compose (the production path):**
- `docker-compose.yml`: the PRODUCTION stack. Pulls published GHCR images
  (`kp-rueck-{backend,frontend,tileserver}` + `kp-print-agent`, pinned by `KP_RUECK_TAG`) and puts
  Caddy in front as a single origin: `/socket.io` + `/api` → backend, `/tiles` → tileserver,
  everything else → frontend. Sets `ENVIRONMENT=production`, which is what turns on mandatory
  secrets, no auth bypass, and no sample data at all – not just no sample incidents, but no fleet,
  roster, materials or training locations either (`backend/app/environment.py`,
  `backend/app/seed.py`; production is NOT Railway-only any more). Building from source is the commented-out path on each service.
- `docker-compose.dev.yml`: development with hot reload and volume mounts (`just dev`).
- See `docs/DEPLOYMENT.md`.

**Releases are for other stations, not for us.** A `v*` tag exists so a self-hoster can pull a
known set of images; the number answers *what does this update cost the operator* – PATCH =
fixes, MINOR = features + automatic migrations, MAJOR = operator action required (table at the
top of `CHANGELOG.md`). Cutting one: `just changelog` (git-cliff draft) → curate into
`[Unreleased]` → `just release X.Y.Z` (bumps all four packages; a pytest fails if they drift) →
`just release-tag X.Y.Z` → `git push --follow-tags`, which runs the CI gate and publishes the
four images plus a GitHub Release whose body is the committed CHANGELOG section. **The frontend
image is built WITHOUT `NEXT_PUBLIC_API_URL` on purpose** – baking a URL in would tie the image
to one station; the browser calls `/backend-api` on its own origin and Next forwards to the
runtime `API_URL`. Same reasoning for map tiles (`getTileBaseUrl` → `/tiles`).

## Offline Map Tiles

The system includes optional offline map tile support so the map keeps working when internet connectivity is unavailable. The defaults cover Basel-Landschaft; any region works via environment variables.

**Architecture:**
- **Tile Server**: TileServer GL running on port 8080
- **Coverage**: whatever `TILES_BOUNDS` covers (default Basel-Landschaft), zoom levels 0-17
- **Storage**: MBTiles format, stored in Docker volume. **~12 MB** for the default region – these are *vector* tiles, not raster. Generating them is the expensive part (~500 MB OSM download, ~2 GB temp disk, 4 GB RAM), which is why a small station box should have the file built elsewhere and copied in (`docs/DEPLOYMENT.md` §0).
- **Behavior**:
  - **Auto mode** (default): Try online OSM tiles first, fall back to offline on failure
  - **Online mode**: Always use online OSM tiles
  - **Offline mode**: Always use local tiles

**Setup:**
```bash
# Download and install tiles (~12 MB, takes 5-15 minutes).
# Region is configuration, not code: TILES_REGION / TILES_BOUNDS / TILES_AREA /
# TILES_PBF_URL, defaulting to Basel-Landschaft. TILES_NAME (the on-disk filename)
# is shared by all three tile scripts – don't rename it on an existing volume.
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
- Tiles: `http://localhost:8080/styles/basic-preview/512/{z}/{x}/{y}.png` (what the app requests –
  see `getTileBaseUrl()` in `frontend/lib/env.ts` and `use-map-mode.ts`)
- UI: `http://localhost:8080`

Those two URLs are the **dev** stack, where the tileserver publishes its own port. The production
compose stack publishes no tileserver port at all – Caddy routes `/tiles` to it, so the same
checks are `http://<host>:${HTTP_PORT}/tiles/…`. `docs/OFFLINE_MAPS.md` has both columns.

**Documentation:**
- Setup guide: `docs/OFFLINE_MAPS.md`
- Configuration: there is **no** config file. `scripts/init-tileserver.sh` creates the MBTiles and
  hands over to the TileServer GL entrypoint with no config, which auto-detects `/data/*.mbtiles`.
  (This line used to name a `tileserver-config.json` that does not exist in the repo.)
- Download script: `scripts/download-tiles.sh`

**Note:** Offline tiles are optional. If not installed, map will work in online-only mode using OpenStreetMap tiles.

## Development Best Practices

- **Never create new files when editing suffices** - always prefer editing existing files
- **Backend follows FastAPI best practices**: async operations, proper DI, type hints
- **Frontend uses Next.js 15 patterns**: App Router; every page is a client component (see above)
- **State management**: Centralized in React Context with API sync
- **Real-time updates via WebSockets** (Socket.IO server in `backend/app/websocket_manager.py`, client in `frontend/lib/websocket-client.ts`). Polling remains as a fallback path. Originally polling-only in MVP; WebSockets were added in commit `b67360d` for live driver/assignment updates.
- **Training vs Live**: Same database, filtered by `training_flag` on incidents
- **i18n**: German is canonical (`messages/de.json`); `fr`/`it` are deep-partial overlays
  merged over German (`lib/i18n-messages.ts`) – missing keys fall back to the German string.
  The language picker in Settings offers a locale only when its overlay covers **every** German
  leaf (`coversGerman` → `AVAILABLE_LOCALES`) – not "has some translations": one missing key
  hides the language entirely. So **`de.json` and `fr.json` must stay leaf-for-leaf equal**
  (currently 3006 each); adding a German key without the French one silently drops French out
  of the picker. Today: **`de` + `fr` ship, `it` is still `{}`**. Locale is per-device via the
  `NEXT_LOCALE` cookie. The in-app help is a separate per-language Markdown file
  (`frontend/public/content/help/index.md`, `index.fr.md`), not part of the catalogues.
  Backend output (API error details, PDFs, exports, thermal print) is German-only for now.
- **Resource conflicts**: UI warns when assigning already-assigned personnel/vehicles/materials

## Important Files & Documentation

- `README.md` - Product overview, quick start, and architecture summary
- `CHANGELOG.md` - Feature history (Keep a Changelog format)
- `docs/README.md` - Documentation index (start here for all docs)
- `docs/ARCHITECTURE.md` - System architecture and technical design
- `docs/ALARM-INTEGRATIONS.md` - Provider-neutral alarm webhook + integration registry
- `docs/DEPLOYMENT.md` - Self-hosting guide (the reference deployment path)
- `docs/SETUP.md` - Ordered first-time setup for a new station
- `docs/RUNNING-BOTH.md` - Running KP Front and KP Rück on one host
- `docs/RAILWAY.md` - Railway deployment guide (a supported path, not legacy). **`NEXT_PUBLIC_API_URL` must stay unset there** – it is build-time inlined and breaks mobile logins via third-party cookies; the frontend uses runtime `API_URL` through its own-origin `/backend-api` proxy.
- `docs/OFFLINE_MAPS.md` - Offline map tiles setup and troubleshooting guide
- `justfile` - Quick reference for common commands (run `just` to see all)
- `backend/README.md` - Backend-specific setup and API docs
- `frontend/package.json` - Frontend scripts and dependencies

## Design Context

### Users
Firefighting command post operators (KP Rück) managing active incidents in high-stress environments. They coordinate personnel, vehicles, and materials in real-time from a command post – **on a desktop with mouse and keyboard**. Speed, clarity, and zero-confusion are critical. This tool replaces a physical magnet board, so spatial familiarity and at-a-glance readability matter.

**Tablets are KP Front's brief, not this one.** Do not size KP Rück's UI around touch targets; a phone is used for *viewing* (and for spawning training incidents), never for running the board. Sizing decisions follow from this – see the button size scale in `frontend/components/ui/button.tsx`.

### Brand Personality
**Reliable, Clear, Calm.** The interface should feel like a trusted instrument – professional, dependable, and composed under pressure. It communicates competence without being flashy. Swiss precision meets emergency readiness.

### Emotional Goals
- **Calm confidence** – Users feel in control and assured; reduce stress, not add to it
- **Structured clarity** – Everything has a place; operators should feel organized and never lost
- **Empowered efficiency** – Every interaction should feel productive; minimize friction

### Aesthetic Direction
- **Visual tone**: Clean, information-dense, dark-mode-first. Inspired by Linear and Trello – minimal chrome, excellent information hierarchy, smooth interactions. Borrows density and seriousness from military C2 and dispatch systems but wrapped in modern, approachable UI patterns.
- **Typography**: Geist (sans) – clean, professional, highly legible at small sizes
- **Color**: Warm red primary (fire service identity), blue accent, warm grays. Status colors carry meaning and must be consistent.
- **Anti-references**: Avoid playful/consumer aesthetics (Slack, Figma), gamification, decorative illustrations, or anything that undermines the seriousness of the operational context.

### Design Principles
1. **Clarity over decoration** – Every pixel should serve a purpose. Prioritize legibility, hierarchy, and scannability. No ornamental elements.
2. **Calm under pressure** – The UI must remain composed during high-stress moments. Avoid visual noise, unnecessary motion, or attention-competing elements. Reserve animation for meaningful state changes.
3. **Density with order** – Pack information tightly but with clear structure. Use consistent spacing, alignment, and grouping so operators can scan fast without feeling overwhelmed.
4. **Instant comprehension** – Status, priority, and assignments must be understood at a glance. Use color, position, and iconography systematically – never rely on color alone.
5. **Keyboard-fast, mouse-precise** – The board is operated from a desktop: power-user shortcuts, dense targets, no touch compromises. The phone layout is read-only enough that it can stay generous without holding the desktop back.

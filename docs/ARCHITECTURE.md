# Architecture Overview

This document describes the components that make up KP Ruck, how they communicate, and the different ways the system can be deployed.

---

## System Overview

```mermaid
graph TB
    subgraph clients["Clients (Browser)"]
        dashboard["Dashboard<br/><small>Kanban Board</small>"]
        mapview["Map View<br/><small>Leaflet + OSM</small>"]
        settings["Settings<br/><small>Configuration UI</small>"]
        public["Public Pages<br/><small>Check-In / Viewer / Reko</small>"]
    end

    subgraph frontend["Frontend — Next.js 15"]
        app["App Router<br/><small>React 19 + TypeScript</small>"]
        contexts["Context Providers<br/><small>Operations, Personnel,<br/>Materials, Auth, Events</small>"]
        ws_client["Socket.IO Client<br/><small>Real-time sync</small>"]
        api_client["API Client<br/><small>HTTP + polling fallback</small>"]
    end

    subgraph backend["Backend — FastAPI"]
        routes["API Routes<br/><small>/api/*</small>"]
        ws_server["Socket.IO Server<br/><small>WebSocket broadcast</small>"]
        services["Services<br/><small>Divera, Sync, Training,<br/>Photos, Export</small>"]
        crud["CRUD Layer<br/><small>Async SQLAlchemy 2.0</small>"]
        middleware["Middleware<br/><small>CORS, Audit, Security,<br/>Rate Limiting</small>"]
    end

    subgraph data["Data Layer"]
        postgres[("PostgreSQL 16<br/><small>Primary database</small>")]
        photos["Photo Storage<br/><small>Disk / Volume</small>"]
    end

    subgraph optional["Optional Services"]
        tileserver["TileServer GL<br/><small>Offline map tiles</small>"]
        print_agent["Print Agent<br/><small>Python on Raspberry Pi</small>"]
        printer["Thermal Printer<br/><small>ESC/POS over network</small>"]
    end

    subgraph external["External Services"]
        divera["Divera 24/7<br/><small>Alarm webhooks + polling</small>"]
        traccar["Traccar<br/><small>GPS vehicle tracking</small>"]
        osm["OpenStreetMap<br/><small>Online map tiles</small>"]
    end

    clients --> app
    app --> contexts
    contexts --> ws_client
    contexts --> api_client
    ws_client <-->|WebSocket| ws_server
    api_client -->|HTTP| routes
    mapview -.->|tiles| tileserver
    mapview -.->|tiles| osm

    routes --> middleware
    middleware --> crud
    routes --> services
    services --> crud
    crud --> postgres
    services --> photos

    ws_server -->|broadcast| ws_client

    divera -.->|webhook| routes
    services -.->|poll| divera
    services -.->|poll| traccar

    print_agent -->|poll /api/print| routes
    print_agent --> printer
```

---

## Component Details

### Frontend (Next.js 15)

| Component | Responsibility |
|-----------|---------------|
| **App Router** | Page routing, server/client component split, layouts |
| **Operations Context** | Core state: incidents, assignments, drag-and-drop, optimistic updates |
| **Personnel Context** | Personnel list, check-in status, availability tracking |
| **Materials Context** | Material inventory, location-based grouping |
| **Auth Context** | JWT tokens, role checks (editor/viewer/admin) |
| **Event Context** | Event selection (training vs live), event metadata |
| **Socket.IO Client** | WebSocket connection with auto-reconnect, polling fallback |
| **API Client** | Centralized HTTP client, error handling, conflict detection (409) |

### Backend (FastAPI)

| Component | Responsibility |
|-----------|---------------|
| **API Routes** | 28 route modules covering incidents, resources, print, integrations, admin |
| **Middleware Stack** | CORS, audit logging, security headers, rate limiting |
| **CRUD Layer** | Async database operations with eager loading (prevents N+1 queries) |
| **WebSocket Manager** | Socket.IO server, room-based broadcasting per event |
| **Services** | Business logic: Divera polling, sync, training auto-generation, photo storage, exports |
| **Auth / Tokens** | JWT generation, validation, blocklist, role-based access |

### Database (PostgreSQL 16)

```mermaid
erDiagram
    events ||--o{ incidents : contains
    events ||--o{ incident_special_functions : has
    incidents ||--o{ incident_assignments : has
    incidents ||--o{ status_transitions : tracks
    incidents ||--o{ reko_reports : has
    incident_assignments }o--|| personnel : assigns
    incident_assignments }o--|| vehicles : assigns
    incident_assignments }o--|| materials : assigns
    incident_special_functions }o--|| personnel : assigns

    events {
        uuid id PK
        string name
        boolean training_flag
        boolean auto_attach_divera
        timestamp created_at
    }
    incidents {
        uuid id PK
        uuid event_id FK
        string status
        string type
        string title
        string location
        text description
        timestamp created_at
    }
    personnel {
        uuid id PK
        string name
        string rank
        string tags
        boolean checked_in
    }
    vehicles {
        uuid id PK
        string name
        string type
        string status
    }
    materials {
        uuid id PK
        string name
        string location
        string status
    }
    incident_assignments {
        uuid id PK
        uuid incident_id FK
        string resource_type
        uuid resource_id
    }
```

**Additional tables** (not shown): `users`, `settings`, `audit_log`, `divera_emergencies`, `token_blocklist`, `incident_special_functions`, `reko_reports`, `status_transitions`

### Print Agent (Standalone Python)

| Component | Responsibility |
|-----------|---------------|
| **agent.py** | Polling loop with adaptive intervals (idle: 60s, active: 5s) |
| **printer.py** | ESC/POS network printer driver (58mm thermal paper) |
| **formatters.py** | Print layout: assignment slips, board snapshots |

---

## Deployment Architectures

KP Ruck supports three deployment modes depending on the use case.

### Local Development (Docker Compose)

For development with hot reload. All services run in containers on a single machine.

```mermaid
graph LR
    subgraph docker["Docker Compose (docker-compose.dev.yml)"]
        fe["Frontend<br/><small>:3000</small>"]
        be["Backend<br/><small>:8000</small>"]
        db[("PostgreSQL<br/><small>:5433</small>")]
        tiles["TileServer GL<br/><small>:8080</small>"]
    end

    browser["Browser"] --> fe
    fe -->|HTTP + WS| be
    be --> db
    browser -.->|map tiles| tiles

    style docker fill:#f0f9ff,stroke:#0284c7
```

| Service | Container | Port | Notes |
|---------|-----------|------|-------|
| PostgreSQL | `kprueck-db-dev` | 5433 | Persistent volume, auto-healthcheck |
| Backend | `kprueck-backend-dev` | 8000 | Hot reload via `start-dev.sh`, auth bypass available |
| Frontend | `kprueck-frontend-dev` | 3000 | `pnpm dev` with volume mounts |
| TileServer | `kprueck-tileserver-dev` | 8080 | Auto-creates bootstrap tiles on first run |
| Print Agent | *(optional, profile=printing)* | host network | Requires physical printer on LAN |

### Cloud Production (Railway)

For internet-facing deployments. Three services on Railway, no tile server.

```mermaid
graph LR
    subgraph railway["Railway"]
        fe_prod["Frontend<br/><small>HTTPS</small>"]
        be_prod["Backend<br/><small>HTTPS</small>"]
        db_prod[("PostgreSQL<br/><small>Managed</small>")]
        vol["Volume<br/><small>/mnt/data</small>"]
    end

    internet["Internet<br/>Users"] --> fe_prod
    fe_prod -->|HTTPS| be_prod
    be_prod --> db_prod
    be_prod --> vol

    divera["Divera 24/7"] -.->|webhook| be_prod
    traccar["Traccar"] -.->|API| be_prod

    style railway fill:#fdf4ff,stroke:#a855f7
```

| Service | Configuration | Notes |
|---------|--------------|-------|
| PostgreSQL | Railway managed | Auto-backups, `DATABASE_URL` injected |
| Backend | `start.sh` + Dockerfile | `SECRET_KEY` required, Swagger docs disabled |
| Frontend | `node server.js` | Production build, `NEXT_PUBLIC_API_URL` set |
| Volume | `/mnt/data` | Persistent photo storage (Reko reports) |

Maps use **online-only** OpenStreetMap tiles (no tile server on Railway).

### Command Post (Offline-capable)

For field deployments at a physical command post. Runs on a local machine with an optional Raspberry Pi for thermal printing.

```mermaid
graph TB
    subgraph cp["Command Post (Local Network)"]
        subgraph mac["Server (Mac / PC)"]
            fe_local["Frontend<br/><small>:3000</small>"]
            be_local["Backend<br/><small>:8000</small>"]
            db_local[("PostgreSQL<br/><small>:5433</small>")]
            tiles_local["TileServer GL<br/><small>:8080</small>"]
        end
        subgraph pi["Raspberry Pi"]
            agent["Print Agent<br/><small>systemd service</small>"]
        end
        printer_hw["Thermal Printer<br/><small>ESC/POS :9100</small>"]
    end

    tablets["Tablets / Laptops<br/><small>on same LAN</small>"] --> fe_local
    fe_local --> be_local
    be_local --> db_local
    tablets -.->|map tiles| tiles_local

    agent -->|poll /api/print| be_local
    agent -->|ESC/POS| printer_hw

    style cp fill:#f0fdf4,stroke:#16a34a
    style pi fill:#fefce8,stroke:#ca8a04
```

| Component | Location | Notes |
|-----------|----------|-------|
| Backend + DB + Frontend | Local machine | `just dev` or native install |
| TileServer GL | Local machine | Pre-downloaded offline tiles for the region |
| Print Agent | Raspberry Pi | Connected via LAN, polls backend for print jobs |
| Thermal Printer | Network printer | ESC/POS protocol, 58mm paper (e.g. Epson TM-T20) |
| Clients | Any device on LAN | Tablets, laptops, phones -- browser only |

Works **fully offline** once tiles are downloaded and no external integrations are needed.

---

## Communication Patterns

### Real-time Sync

All clients stay in sync via WebSocket with a polling fallback:

```mermaid
sequenceDiagram
    participant U as User A (Browser)
    participant F as Frontend
    participant B as Backend
    participant WS as Socket.IO
    participant O as Other Clients

    U->>F: Drag personnel onto incident
    F->>F: Optimistic UI update
    F->>B: POST /api/assignments
    B->>B: Create assignment in DB
    B->>WS: Broadcast "assignment_update"
    WS->>O: Push update to all clients
    O->>O: Reload data from API
    B-->>F: 201 Created

    Note over F,O: If WebSocket disconnects:
    F->>B: GET /api/incidents (every 5-10s)
    B-->>F: Full incident list
    F->>F: Diff and update UI
```

### Print Flow

```mermaid
sequenceDiagram
    participant U as User (Dashboard)
    participant B as Backend
    participant A as Print Agent (Pi)
    participant P as Thermal Printer

    U->>B: Click "Print" → POST /api/print/jobs
    B->>B: Queue job in database

    loop Every 5s (active) / 60s (idle)
        A->>B: GET /api/print/jobs/pending
        B-->>A: Job list
    end

    A->>B: PATCH /api/print/jobs/{id}/claim
    A->>A: Format print layout
    A->>P: Send ESC/POS commands
    P-->>A: Print complete
    A->>B: PATCH /api/print/jobs/{id}/complete
```

### Divera Alarm Import

```mermaid
sequenceDiagram
    participant D as Divera 24/7
    participant B as Backend
    participant WS as Socket.IO
    participant C as All Clients

    alt Webhook (preferred)
        D->>B: POST /api/divera/webhook
        B->>B: Store in divera_emergencies
        B->>WS: Broadcast new alarm
        WS->>C: Show alarm notification
    else Polling (fallback)
        loop Every 30s (when clients connected)
            B->>D: GET /api/v2/alarms
            D-->>B: Alarm list
            B->>B: Check for new alarms
            B->>WS: Broadcast if new
        end
    end

    C->>B: User clicks "Create Incident"
    B->>B: Convert alarm → incident
```

---

## Incident Lifecycle

An incident progresses through these stages:

```mermaid
stateDiagram-v2
    [*] --> Eingegangen: New incident created
    Eingegangen --> Reko: Reconnaissance assigned
    Eingegangen --> Disponiert: Resources dispatched
    Reko --> Disponiert: Assessment complete
    Disponiert --> Abschluss: Incident resolved
    Abschluss --> Archiv: Auto-archive (24h)
    Archiv --> [*]

    note right of Eingegangen: Incoming — not yet assessed
    note right of Reko: Field recon in progress
    note right of Disponiert: Crew and vehicles en route
    note right of Abschluss: Completed — resources released
    note right of Archiv: Historical record
```

At each transition:
- A `status_transition` record is created (audit trail)
- WebSocket broadcasts the change to all connected clients
- Moving to **Abschluss** automatically releases all assigned personnel, vehicles, and materials

---

## Authentication & Roles

```mermaid
graph LR
    subgraph auth["Authentication Methods"]
        jwt["JWT Token<br/><small>Login form → 24h token</small>"]
        master["Master Token<br/><small>ENV var for remote config</small>"]
        public_token["Public Tokens<br/><small>Check-In / Viewer / Reko</small>"]
    end

    subgraph roles["Access Levels"]
        admin["Admin<br/><small>User mgmt + all editor perms</small>"]
        editor["Editor<br/><small>Full CRUD on incidents,<br/>resources, settings</small>"]
        viewer["Viewer<br/><small>Read-only board view</small>"]
        checkin["Check-In<br/><small>Personnel self-service</small>"]
    end

    jwt --> admin
    jwt --> editor
    master --> editor
    public_token --> viewer
    public_token --> checkin
```

| Token Type | How Obtained | Expiry | Access |
|------------|-------------|--------|--------|
| JWT (access) | Login form | 24 hours | Full editor or admin |
| Master Token | Environment variable | Never | Editor-level API access |
| Viewer Token | Generated in UI (QR code) | Long-lived | Read-only board |
| Check-In Token | Generated in UI (QR code) | Long-lived | Personnel check-in form only |
| Reko Token | Generated in UI (QR code) | Long-lived | View assigned Reko forms |

---

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Real-time sync** | Socket.IO + polling fallback | WebSocket for speed, polling for reliability in unstable field networks |
| **Database** | PostgreSQL | Robust, widely supported, async driver available (asyncpg) |
| **ORM** | SQLAlchemy 2.0 async | Type-safe, eager loading, migration support via Alembic |
| **Frontend framework** | Next.js 15 App Router | Server components by default, great DX, React 19 features |
| **State management** | React Context | Sufficient for this scale, no external state library needed |
| **UI components** | shadcn/ui + Tailwind CSS 4 | Composable, accessible, easy to customize |
| **Map tiles** | Leaflet + self-hosted TileServer GL | Offline-capable, free OSM data, no vendor lock-in |
| **Thermal printing** | Separate agent (Python) | Decoupled from web server, runs on dedicated hardware (Pi) |
| **Package managers** | pnpm + uv | Fast, disk-efficient, modern |
| **Auth** | JWT (stateless) + token blocklist | Simple, works across deployments, no session store needed |

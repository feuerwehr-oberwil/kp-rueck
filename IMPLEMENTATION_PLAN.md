# KP Rück – Implementation Plan

Version: 1.0
Date: 2025-10-23
Based on: DESIGN_DOC.md v1.0

---

## Table of Contents

1. [Overview](#overview)
2. [Key Architectural Decisions](#key-architectural-decisions)
3. [Updated Data Model](#updated-data-model)
4. [Implementation Phases](#implementation-phases)
5. [API Structure](#api-structure)
6. [Testing Strategy](#testing-strategy)
7. [Deployment Strategy](#deployment-strategy)
8. [Risks & Mitigations](#risks--mitigations)
9. [Timeline](#timeline)

---

## Overview

This implementation plan translates the DESIGN_DOC.md requirements into actionable development phases for the KP Rück Digital Einsatz-Board system.

**Target MVP Delivery**: November 2025
**Production Ready**: March 2026

---

## Key Architectural Decisions

### Authentication
- **JWT-based authentication** with short-lived access tokens (15 min) and refresh tokens
- Session management via httpOnly cookies
- Role-based access control (Editor / Viewer)
- Database-seeded users (no self-registration)

### Real-time Updates
- **Polling-based synchronization** (no WebSockets)
- User-configurable polling interval (default: 5 seconds)
- Optimistic UI updates with conflict notifications
- Last-write-wins conflict resolution

### Data Synchronization
- **One-way Railway → Local DB sync**
- Automated pg_dump every 5 minutes to local Docker deployment
- Health check endpoint to detect Railway outages
- Manual failover switch (never concurrent editing on both deployments)

### File Storage
- **Filesystem-based photo storage** (not database)
- Docker volume mounts for persistence
- Automatic image compression on upload (shared format: JPEG)
- Served via FastAPI static file endpoints

### Integration Strategy
- **Primary**: Alarm server webhook (immediate incident creation)
- **Secondary**: DIVERA API polling (March 2026 phase)
- Dummy notification system ("would send to DIVERA" messages)

### Audit Logging
- **Comprehensive audit log** for all actions (not just status transitions)
- Separate `status_transitions` table remains for specific incident workflow tracking
- JSON change tracking for before/after states

---

## Updated Data Model

### Schema Overview

```sql
-- ============================================
-- USERS & AUTHENTICATION
-- ============================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('editor', 'viewer')),
    created_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP
);

-- ============================================
-- MASTER LISTS
-- ============================================

CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL, -- e.g., 'TLF', 'DLK', 'MTW'
    status VARCHAR(20) NOT NULL CHECK (status IN ('available', 'assigned', 'maintenance')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE personnel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    role VARCHAR(50), -- e.g., 'Gruppenführer', 'Maschinist', 'Atemschutz'
    availability VARCHAR(20) NOT NULL CHECK (availability IN ('available', 'assigned', 'unavailable')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50), -- e.g., 'Stromerzeuger', 'Pumpe', 'Beleuchtung'
    status VARCHAR(20) NOT NULL CHECK (status IN ('available', 'assigned', 'maintenance')),
    location VARCHAR(255), -- e.g., 'TLF 1', 'Lager Raum 3', 'MTW 2'
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- INCIDENTS
-- ============================================

CREATE TABLE incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- predefined: 'fire', 'medical', 'technical', 'hazmat', 'other'
    priority VARCHAR(20) NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    location_address TEXT,
    location_lat DECIMAL(10, 8),
    location_lng DECIMAL(11, 8),
    status VARCHAR(50) NOT NULL DEFAULT 'eingegangen',
    -- Status values: 'eingegangen', 'reko', 'disponiert', 'einsatz', 'einsatz_beendet', 'abschluss'
    training_flag BOOLEAN DEFAULT FALSE,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    completed_at TIMESTAMP,

    CONSTRAINT valid_location CHECK (
        (location_lat IS NULL AND location_lng IS NULL) OR
        (location_lat IS NOT NULL AND location_lng IS NOT NULL)
    )
);

-- ============================================
-- ASSIGNMENTS (Many-to-Many Junction)
-- ============================================

CREATE TABLE incident_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    resource_type VARCHAR(20) NOT NULL CHECK (resource_type IN ('personnel', 'vehicle', 'material')),
    resource_id UUID NOT NULL, -- references vehicles.id, personnel.id, or materials.id
    assigned_at TIMESTAMP DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id),
    unassigned_at TIMESTAMP,

    UNIQUE (incident_id, resource_type, resource_id, unassigned_at) -- prevent duplicate active assignments
);

CREATE INDEX idx_assignments_incident ON incident_assignments(incident_id);
CREATE INDEX idx_assignments_resource ON incident_assignments(resource_type, resource_id);

-- ============================================
-- REKO FIELD REPORTS
-- ============================================

CREATE TABLE reko_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL, -- reusable token for form type
    submitted_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Form fields
    is_relevant BOOLEAN, -- "Einsatz relevant?"
    dangers_json JSONB, -- structured danger assessment
    effort_json JSONB, -- effort estimation (personnel, equipment)
    power_supply VARCHAR(50), -- dropdown: 'available', 'unavailable', 'emergency_needed'
    photos_json JSONB, -- array of photo filenames
    summary_text TEXT,
    additional_notes TEXT,

    -- Metadata
    submitted_by_token VARCHAR(255), -- track which responder submitted
    is_draft BOOLEAN DEFAULT FALSE -- allow resumable forms
);

CREATE INDEX idx_reko_incident ON reko_reports(incident_id);
CREATE INDEX idx_reko_token ON reko_reports(token);

-- ============================================
-- AUDIT LOGGING
-- ============================================

CREATE TABLE status_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    from_status VARCHAR(50) NOT NULL,
    to_status VARCHAR(50) NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW(),
    user_id UUID REFERENCES users(id),
    notes TEXT
);

CREATE INDEX idx_transitions_incident ON status_transitions(incident_id);

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action_type VARCHAR(50) NOT NULL, -- 'create', 'update', 'delete', 'assign', 'unassign', 'login', etc.
    resource_type VARCHAR(50) NOT NULL, -- 'incident', 'vehicle', 'personnel', 'material', 'user'
    resource_id UUID,
    changes_json JSONB, -- before/after state for updates
    timestamp TIMESTAMP DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);

-- ============================================
-- SETTINGS & CONFIGURATION
-- ============================================

CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

-- Default settings
INSERT INTO settings (key, value) VALUES
    ('polling_interval_ms', '5000'),
    ('training_mode', 'false'),
    ('auto_archive_timeout_hours', '24'),
    ('notification_enabled', 'false'),
    ('alarm_webhook_secret', 'CHANGE_ME');
```

### Data Model Notes

1. **Many-to-Many Assignments**:
   - `incident_assignments` junction table tracks all resource assignments
   - UI shows warnings when resources are double-booked
   - `unassigned_at` allows historical tracking

2. **Materials Location Field**:
   - Free text to specify vehicle or storage room
   - Example: "TLF 1", "Lager Raum 3", "MTW 2"

3. **Incident Type & Priority**:
   - Predefined enums for consistency
   - Type: fire, medical, technical, hazmat, other
   - Priority: low, medium, high, critical

4. **Reko Reports**:
   - Separate table, editable after submission
   - JSON fields for structured checklist data
   - Token-based access (no login required)

5. **Training Flag**:
   - Lives on incident record (not separate tables)
   - Same database, filtered by flag

---

## Implementation Phases

### Phase 1: Core Infrastructure (Weeks 1-2)

#### Backend Setup
- [ ] Initialize FastAPI project structure
  - Project layout: `app/`, `tests/`, `alembic/`
  - Core modules: `models/`, `schemas/`, `routes/`, `services/`, `auth/`
- [ ] Configure PostgreSQL connection with SQLAlchemy 2.0
- [ ] Set up Alembic for database migrations
- [ ] Implement all database tables from schema
- [ ] Create database seeders for initial users

#### Authentication System
- [ ] JWT token generation and validation (PyJWT)
- [ ] Login endpoint (`POST /api/v1/auth/login`)
- [ ] Token refresh endpoint (`POST /api/v1/auth/refresh`)
- [ ] Logout endpoint (`POST /api/v1/auth/logout`)
- [ ] Role-based middleware decorators (`@require_role('editor')`)
- [ ] Password hashing with bcrypt

#### Base API Endpoints
- [ ] Health check (`GET /api/v1/health`)
- [ ] Version info (`GET /api/v1/version`)
- [ ] CRUD for vehicles (`/api/v1/vehicles/*`)
- [ ] CRUD for personnel (`/api/v1/personnel/*`)
- [ ] CRUD for materials (`/api/v1/materials/*`)
- [ ] Settings management (`/api/v1/settings/*`)

#### Audit Logging
- [ ] Audit log middleware for all requests
- [ ] Helper functions for logging actions
- [ ] Audit log query endpoints (`GET /api/v1/audit/*`)

#### Docker & Local Development
- [ ] Dockerfile for backend
- [ ] docker-compose.yml (backend + postgres + volumes)
- [ ] Environment configuration (.env files)
- [ ] Local development setup documentation

#### Frontend Setup
- [ ] Initialize Next.js 15 project with App Router
- [ ] Configure TypeScript strict mode
- [ ] Set up Tailwind CSS + shadcn/ui components
- [ ] Configure API client (fetch wrapper with auth)
- [ ] Create auth context and JWT storage
- [ ] Login page and protected route wrapper

**Deliverable**: Running backend API + authenticated frontend shell

---

### Phase 2: Incident Management & Kanban (Weeks 3-4)

#### Backend: Incident Operations
- [ ] Incident CRUD endpoints
  - `POST /api/v1/incidents` (create)
  - `GET /api/v1/incidents` (list with filters)
  - `GET /api/v1/incidents/{id}` (detail)
  - `PATCH /api/v1/incidents/{id}` (update)
  - `DELETE /api/v1/incidents/{id}` (soft delete)
- [ ] Status transition endpoint
  - `POST /api/v1/incidents/{id}/status` (move between columns)
  - Automatic `status_transitions` logging
- [ ] Assignment endpoints
  - `POST /api/v1/incidents/{id}/assign` (assign resource)
  - `POST /api/v1/incidents/{id}/unassign` (release resource)
  - Conflict detection (warn if resource already assigned)
- [ ] Sync endpoint for polling
  - `GET /api/v1/sync?since={timestamp}` (returns changes since last poll)
  - Includes incidents, assignments, status changes

#### Frontend: Kanban Board
- [ ] Kanban column layout (6 columns per DESIGN_DOC)
- [ ] Drag-and-drop implementation (dnd-kit or react-beautiful-dnd)
- [ ] Incident card component
  - Vehicle/crew summary badges
  - Location snippet
  - Timestamps
  - Priority color coding
- [ ] Quick create modal
  - Minimal required fields (title, type, priority, location)
  - Auto-geocoding for addresses (Nominatim API)
- [ ] Edit incident modal
  - Full incident details
  - Assignment interface
- [ ] Polling hook
  - Configurable interval from settings
  - Optimistic updates with rollback
  - Background sync status indicator

#### Master List Management UI
- [ ] Vehicle list view + CRUD
- [ ] Personnel list view + CRUD
- [ ] Materials list view + CRUD
- [ ] Availability indicators
- [ ] Search and filter

#### Conflict Detection & Warnings
- [ ] UI warnings for double-booked resources
- [ ] Visual indicators on cards showing assignments
- [ ] "Release on completion" automatic workflow

**Deliverable**: Functional Kanban board with drag-and-drop incident management

---

### Phase 3: Map Integration (Week 5)

#### Backend: Geocoding & Location
- [ ] Geocoding service wrapper (Nominatim/OpenStreetMap)
- [ ] Location validation on incident creation
- [ ] Endpoint for map data: `GET /api/v1/incidents/map`
  - Returns active incidents with coordinates
  - Grouped by status for marker styling

#### Frontend: Map View
- [ ] Leaflet.js integration
- [ ] OpenStreetMap tile layer
- [ ] Incident markers
  - Color-coded by status
  - Click to show incident popup
  - Icon customization by type
- [ ] Map/Kanban tab switcher
- [ ] Handle incidents without valid location
  - Show in warning list at top
  - Highlight missing location in card

#### Location Handling
- [ ] Address autocomplete on create modal
- [ ] Manual lat/lng entry option
- [ ] "Location not found" indicator

**Deliverable**: Integrated map view showing all active incidents

---

### Phase 4: Reko Field Input System (Week 6)

#### Backend: Reko Forms
- [ ] Token generation for form types
- [ ] Reko form endpoints
  - `GET /api/v1/reko?id={incident_id}&token={token}` (load form)
  - `POST /api/v1/reko` (submit/update report)
  - `GET /api/v1/reko/{report_id}` (view existing report)
- [ ] Photo upload endpoint
  - `POST /api/v1/reko/{report_id}/photos`
  - Image compression (Pillow library)
  - Filesystem storage with UUID filenames
  - Return photo URLs
- [ ] Photo serving
  - `GET /api/v1/photos/{filename}`
  - Static file serving from Docker volume

#### Frontend: Reko Form Page
- [ ] Standalone `/reko` page (no auth required)
- [ ] Token validation on load
- [ ] 4-section form structure:
  1. Basic confirmation (Is incident relevant? Yes/No)
  2. Key details (Dangers, Effort, Power supply - dropdowns + notes)
  3. Photo upload (camera + gallery, multiple files)
  4. Summary comment box
- [ ] Draft save functionality (auto-save on field change)
- [ ] Resume capability (reload draft on revisit)
- [ ] Edit after submission
- [ ] Mobile-optimized UI

#### Incident Card Integration
- [ ] Expandable "Reko Report" section on incident cards
- [ ] Display structured data from reko_reports
- [ ] Photo gallery viewer
- [ ] Link to edit form

**Deliverable**: Functional field input system for reconnaissance teams

---

### Phase 5: Alarm Server Integration (Week 7)

#### Webhook API
- [ ] Alarm webhook endpoint
  - `POST /api/v1/alarms/webhook`
  - Bearer token authentication (shared secret)
  - Payload validation (schema below)
- [ ] Auto-create incident from alarm data
- [ ] Map alarm fields to incident schema
- [ ] Dummy notification trigger
  - Log: "Would send DIVERA notification to: {personnel_ids}"
  - Prepare for real integration

#### Webhook Payload Schema

```json
{
  "alarm_id": "string (unique identifier from alarm server)",
  "timestamp": "ISO8601 datetime",
  "type": "fire | medical | technical | hazmat | other",
  "priority": "low | medium | high | critical",
  "location": {
    "address": "string (full address)",
    "lat": 47.123456,
    "lng": 7.654321
  },
  "description": "string (alarm text)",
  "source": "divera | sms | manual"
}
```

#### Response Format

```json
{
  "status": "success | error",
  "incident_id": "uuid (created incident)",
  "message": "string (optional error message)"
}
```

#### Testing
- [ ] Webhook endpoint tests
- [ ] Sample alarm payloads for testing
- [ ] Integration test with mock alarm server
- [ ] Documentation for alarm server configuration

**Deliverable**: Alarm webhook integration ready for production

---

### Phase 6: Production Readiness (Weeks 8-9)

#### Railway Deployment
- [ ] Dockerfile optimization (multi-stage build)
- [ ] Railway.toml configuration
- [ ] Environment variable setup
  - Database URL
  - JWT secret
  - Alarm webhook secret
- [ ] GitHub Actions CI/CD pipeline
  - Build and test on push
  - Deploy to Railway on main branch
  - Tag releases

#### Database Management
- [ ] Automated daily backups
  - pg_dump to Railway volume or S3
  - Retention policy (30 days)
- [ ] Backup restore script
- [ ] Migration strategy documentation

#### Local Docker Deployment
- [ ] Production-ready docker-compose.yml
- [ ] DB sync script
  - Cron job: download Railway DB every 5 minutes
  - `pg_restore` to local PostgreSQL
  - Health check before sync
- [ ] Volume mounts for persistence
  - PostgreSQL data
  - Photo storage
  - DB dumps
- [ ] Failover documentation
  - Health check monitoring
  - Manual switch procedure
  - Clear "LOCAL MODE" indicator in UI

#### UI Polish & Features
- [ ] Filter panel
  - By status
  - By vehicle
  - By personnel
  - By date range
- [ ] Incident timers
  - Show elapsed time since creation
  - Notification after configurable threshold
- [ ] Training mode
  - Toggle in settings
  - Visual indicator (banner, card badges)
  - Filter to show/hide training incidents
- [ ] Archive/search
  - List completed incidents
  - Search by date, vehicle, crew
  - Export to CSV
- [ ] Mobile viewer layout
  - Simplified incident list
  - Read-only mode
  - Status badges
  - Refresh button

#### Settings UI
- [ ] Polling interval configuration
- [ ] Training mode toggle
- [ ] Auto-archive timeout
- [ ] Notification preferences
- [ ] User management (for editors)

#### Performance Optimization
- [ ] Database indexing review
- [ ] API response caching (where appropriate)
- [ ] Frontend code splitting
- [ ] Image lazy loading

**Deliverable**: Production-ready system deployed to Railway + local fallback

---

### Phase 7: Testing & Quality Assurance (Throughout + Week 10)

#### Backend Testing (pytest)
- [ ] Unit tests for models
- [ ] Unit tests for services
- [ ] API endpoint integration tests
- [ ] Authentication flow tests
- [ ] Audit logging tests
- [ ] Target: 80% code coverage

#### Frontend Testing
- [ ] Component tests (Vitest + React Testing Library)
- [ ] Auth flow tests
- [ ] Polling hook tests
- [ ] Drag-and-drop interaction tests
- [ ] Target: 70% component coverage

#### End-to-End Testing (Playwright)
- [ ] Critical user flows:
  1. Login → Create incident → Drag to completion
  2. Assign resources → Detect conflicts
  3. Submit Reko form → View on card
  4. Alarm webhook → Auto-create incident
  5. Training mode toggle → Filter incidents
- [ ] Mobile viewer flow
- [ ] Map view interaction
- [ ] Archive and export

#### Performance Testing
- [ ] Load test with 50 concurrent viewers
- [ ] Polling performance under load
- [ ] Database query performance
- [ ] Target: <200ms API response time

#### Manual Testing
- [ ] User acceptance testing with fire department
- [ ] Edge case scenarios
- [ ] Accessibility review (keyboard navigation, screen readers)
- [ ] Cross-browser testing (Chrome, Firefox, Safari)
- [ ] Mobile device testing (iOS, Android)

#### Documentation
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Deployment guide
- [ ] User manual (Editor and Viewer)
- [ ] Troubleshooting guide
- [ ] Development setup guide

**Deliverable**: Thoroughly tested MVP ready for November 2025 deployment

---

## API Structure

### Authentication Endpoints

```
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
```

### Master Lists

```
GET    /api/v1/vehicles
POST   /api/v1/vehicles
GET    /api/v1/vehicles/{id}
PATCH  /api/v1/vehicles/{id}
DELETE /api/v1/vehicles/{id}

GET    /api/v1/personnel
POST   /api/v1/personnel
GET    /api/v1/personnel/{id}
PATCH  /api/v1/personnel/{id}
DELETE /api/v1/personnel/{id}

GET    /api/v1/materials
POST   /api/v1/materials
GET    /api/v1/materials/{id}
PATCH  /api/v1/materials/{id}
DELETE /api/v1/materials/{id}
```

### Incidents

```
GET    /api/v1/incidents              # List with filters (status, training_flag, date_range)
POST   /api/v1/incidents              # Create new
GET    /api/v1/incidents/{id}         # Get detail
PATCH  /api/v1/incidents/{id}         # Update fields
DELETE /api/v1/incidents/{id}         # Soft delete (move to archive)

POST   /api/v1/incidents/{id}/status  # Change status (drag-and-drop)
POST   /api/v1/incidents/{id}/assign  # Assign resource
POST   /api/v1/incidents/{id}/unassign # Release resource

GET    /api/v1/incidents/map          # Map view data
GET    /api/v1/incidents/export       # CSV export
```

### Reko Forms

```
GET    /api/v1/reko?id={incident_id}&token={token}  # Load form (with existing draft)
POST   /api/v1/reko                                  # Submit/update report
GET    /api/v1/reko/{report_id}                      # View report
POST   /api/v1/reko/{report_id}/photos               # Upload photo
GET    /api/v1/photos/{filename}                     # Serve photo
```

### Alarm Integration

```
POST   /api/v1/alarms/webhook         # Receive alarm from external server
```

### System

```
GET    /api/v1/health                 # Health check
GET    /api/v1/version                # Version info
GET    /api/v1/sync?since={timestamp} # Polling sync endpoint

GET    /api/v1/settings               # Get all settings
PATCH  /api/v1/settings/{key}         # Update setting

GET    /api/v1/audit                  # Audit log (with filters)
```

---

## Testing Strategy

### Test Coverage Targets

| Layer | Tool | Target Coverage | Priority Tests |
|-------|------|-----------------|----------------|
| Backend Models | pytest | 90% | All CRUD operations, validations |
| Backend API | pytest | 80% | All endpoints, auth flows |
| Frontend Components | Vitest | 70% | UI components, hooks |
| E2E Critical Flows | Playwright | 100% | 5-10 key user journeys |
| Performance | k6 or Artillery | N/A | 50 concurrent users |

### Testing Pyramid

```
       /\
      /E2E\         5-10 Playwright tests (critical flows)
     /------\
    / Integ \       30-50 API integration tests (pytest)
   /----------\
  /   Unit     \    100+ unit tests (models, services, components)
 /--------------\
```

### Key Test Scenarios

1. **Happy Path**: Login → Create incident → Assign resources → Move through workflow → Complete
2. **Conflict Detection**: Assign same vehicle to two incidents → Show warning → Allow override
3. **Reko Form**: Submit form with photos → View on incident card → Edit and update
4. **Alarm Webhook**: External alarm → Auto-create incident → Assign based on rules
5. **Training Mode**: Toggle training → Create training incident → Filter view → Purge
6. **Polling**: Multiple viewers → Editor makes change → All viewers update within 5s
7. **Failover**: Railway health check fails → Warning shown → Switch to local Docker
8. **Edge Cases**: Missing location → Invalid token → Expired JWT → Concurrent edits

### Test Data Management

- Seed database with realistic test data (vehicles, personnel, materials)
- Factories for generating test incidents (pytest-factory-boy)
- Snapshot testing for API responses
- Mock external services (geocoding, alarm server)

---

## Deployment Strategy

### Railway (Primary Cloud Deployment)

#### Infrastructure
- **Web service**: FastAPI backend + Next.js frontend (single container)
- **Database**: Railway PostgreSQL addon
- **Volumes**: Photo storage (persistent volume)
- **Environment**: Production

#### CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/deploy.yml

name: Deploy to Railway

on:
  push:
    branches: [main]
  release:
    types: [published]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - Checkout code
      - Run backend tests (pytest)
      - Run frontend tests (Vitest)
      - Run E2E tests (Playwright)

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - Build Docker image
      - Tag with git SHA and version
      - Push to Railway

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - Deploy to Railway
      - Run database migrations
      - Health check verification
      - Notify on failure
```

#### Backup Strategy
- Daily automated pg_dump (Railway cron or GitHub Action)
- Store backups in Railway volume or external S3
- 30-day retention policy
- Monthly full backup to external storage

### Local Docker (Emergency Fallback)

#### Infrastructure
- **docker-compose.yml**: Backend + PostgreSQL + Nginx (optional)
- **Volumes**: Database data, photos, DB dumps
- **Network**: Host network or bridge (for LAN access)

#### DB Sync Script

```bash
#!/bin/bash
# sync-railway-db.sh

RAILWAY_DB_URL="postgresql://..."
LOCAL_DB_URL="postgresql://localhost/kp_rueck"

# Health check
curl -f https://kp-rueck.railway.app/api/v1/health || exit 1

# Dump Railway DB
pg_dump $RAILWAY_DB_URL > /backups/railway_$(date +%Y%m%d_%H%M%S).sql

# Restore to local
psql $LOCAL_DB_URL < /backups/railway_*.sql

echo "Sync complete at $(date)"
```

#### Cron Setup
```cron
*/5 * * * * /app/scripts/sync-railway-db.sh
```

#### Failover Procedure

1. **Detection**: Health check endpoint fails or Railway shows downtime
2. **Warning**: UI shows "Railway unreachable - switch to local mode?"
3. **Switch**: User clicks "Switch to Local"
   - Frontend points to local API URL
   - Local Docker already has latest DB (from last sync)
4. **Operate**: Continue on local deployment (no dual editing)
5. **Restore**: When Railway is back, push local DB back to Railway

### Version Tracking

- **Git tags**: Semantic versioning (v1.0.0, v1.1.0, etc.)
- **CHANGELOG.md**: Human-readable release notes
- **VERSION file**: Single source of truth for current version
- **API version header**: All responses include `X-API-Version`

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Railway downtime during active ops | Low | Critical | Local Docker fallback with 5-min DB sync |
| JWT complexity introduces auth bugs | Medium | High | Use proven library (PyJWT), comprehensive tests |
| Photo storage grows unbounded | Medium | Medium | Retention policy (1 year), compression |
| Assignment conflicts cause confusion | High | Medium | Clear UI warnings, allow override with confirmation |
| Polling creates high DB load | Low | Medium | Optimize sync endpoint, consider caching |
| Geocoding API rate limits | Low | Low | Cache results, fallback to manual lat/lng |
| Multi-editor concurrent updates | Medium | Medium | Optimistic locking with conflict notifications |
| DB sync fails during failover | Low | High | Manual backup procedure, last-known-good restore |
| Training incidents mixed with live | Medium | Critical | Clear visual indicators, separate flag filtering |
| Test coverage insufficient | Medium | High | Enforce coverage thresholds in CI/CD |

---

## Timeline

### 10-Week MVP Development Plan

| Week | Phase | Key Deliverables |
|------|-------|------------------|
| 1-2 | Core Infrastructure | Backend API, Auth, Database, Docker, Frontend shell |
| 3-4 | Kanban Board | Incident CRUD, Drag-and-drop, Polling, Master lists |
| 5 | Map Integration | Leaflet map, Geocoding, Location validation |
| 6 | Reko Forms | Field input system, Photo upload, Token validation |
| 7 | Alarm Integration | Webhook API, Auto-create incidents |
| 8-9 | Production Ready | Railway deploy, DB backups, UI polish, Settings |
| 10 | Testing & QA | E2E tests, Performance testing, User acceptance |

### Milestones

- **End of Week 2**: Authenticated API + Frontend
- **End of Week 4**: Working Kanban board with drag-and-drop
- **End of Week 7**: All core features complete
- **End of Week 9**: Deployed to Railway + Local Docker
- **End of Week 10**: **MVP READY** (November 2025 target)

### March 2026 Enhancements (Post-MVP)

- Real DIVERA API integration (replace dummy notifications)
- Advanced filters and search
- Dashboard KPIs (response times, incident counts)
- Offline-first PWA capabilities
- Mobile app (React Native) - if needed
- Automated tests for all workflows
- Performance optimizations based on real usage

---

## Next Steps After Plan Approval

1. **Update DESIGN_DOC.md** with all clarifications from this plan
2. **Create project structure**:
   ```
   backend/
     app/
       models/
       routes/
       services/
       auth/
     tests/
     alembic/
   frontend/
     app/
     components/
     hooks/
     lib/
   docker-compose.yml
   ```
3. **Initialize repositories** (if separate) or monorepo structure
4. **Set up Railway project** and provision PostgreSQL
5. **Create initial database migration** with all tables
6. **Implement JWT authentication** as first feature
7. **Weekly progress reviews** and adjustments

---

## Appendix: Technology Stack Summary

| Component | Technology | Justification |
|-----------|------------|---------------|
| Frontend | Next.js 15 + TypeScript | SSR, App Router, type safety |
| UI Library | Tailwind CSS + shadcn/ui | Rapid development, accessible components |
| Backend | FastAPI + Python 3.12 | Fast, async, excellent docs, type hints |
| Database | PostgreSQL 16 | ACID compliance, JSONB support, reliability |
| ORM | SQLAlchemy 2.0 | Mature, well-documented, async support |
| Auth | JWT (PyJWT) | Stateless, mobile-friendly, industry standard |
| Map | Leaflet.js + OpenStreetMap | Free, flexible, offline capable |
| Testing | pytest + Vitest + Playwright | Comprehensive coverage, fast, reliable |
| Deployment | Docker + Railway | Easy scaling, managed DB, CI/CD integration |
| CI/CD | GitHub Actions | Integrated with repo, free for public repos |

---

**Document Status**: Ready for Review
**Next Review Date**: After Phase 1 completion (Week 2)
**Maintained By**: Development Team

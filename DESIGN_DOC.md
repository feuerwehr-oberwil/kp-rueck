# KP Rück – Digital Einsatz-Board

Version: 1.1
Date: 2025-10-23
Prepared for: Demo Fire Department

## 1\. Overview

The KP Rück – Digital Einsatz-Board replaces the existing physical magnet board system used in the Demo Fire Department command post (KP Rück).

Its goal is to **digitally mirror the speed, clarity, and simplicity** of the analog system used for coordinating simultaneous small emergencies.

The application provides:

* A **Kanban-style status board** for incident tracking and assignment  
* A **map view** for situational awareness  
* Support for both **editor control stations** (command post) and **mobile viewers** (crew)  
* **Integration with DIVERA 24/7** for automated alerts and reminders

The system must remain **fast, stable, and operable under pressure**, prioritizing reliability and usability over advanced features.

## 2\. Background & Motivation

Today, coordination for smaller or parallel emergencies happens via a physical board and WhatsApp communication.

While reliable, this analog approach has key limitations:

* Limited visibility for off-site personnel  
* Manual data transfer and duplication (e.g., whatsapp photos)  
* Difficulty in aggregating post-operation data  
* Limited overview if system not used to its full potential

The **digital board** preserves the clarity of the current process while enabling real-time updates, visibility for all members, and easier data retention for analysis or training.

## 3\. Goals & Non-Goals

### Goals

* Replicate the analog KP Rück workflow digitally  
* Maintain \<5 s data latency between editors and viewers  
* Provide Kanban \+ Map interfaces (switchable/tabbed)  
* Enable training simulation for exercises  
* Maintain operation even with limited connectivity (LAN/offline ready)

### Non-Goals

* Multi-station or centralized user management (handled via separate deployments)  
* Complex analytics or AI-based dispatch recommendations (may come later)  
* Full offline synchronization (“pure” LAN/offline mode only)

## 4\. Requirements

### 4.1 Core Functionality

* Dual-view layout: **Kanban board** \+ **Map view** (tabbed or multi-screen)
* Kanban columns: *Eingegangen*, *Reko*, *Disponiert / Unterwegs*, *Einsatz*, *Einsatz beendet / Rückfahrt*, *Abschluss / Archiv*
* Cards show: vehicle \+ crew \+ materials summary, location snippet, timestamps, status color, priority
* Drag-and-drop card movement updates status \+ map marker
* **Incident creation**: quick entry form (minimal required fields: title, type, priority, location)
* **Manual archiving** with notifications/reminders (no automatic status transitions)
* **Mobile viewer mode**: simplified list of active incidents (read-only)

### 4.2 Backend & Data Model

* **Containerized FastAPI backend** (monolith, REST-based)
* **PostgreSQL database** (vehicles, personnel, materials, incidents, assignments, reko reports)
* **Polling-based sync** (≤ 5 s, user-configurable interval) - no WebSockets in MVP
* **Comprehensive audit log** of all actions (create/edit/move/assign/etc.)
* **JWT authentication** (Editor / Viewer roles, session-based with httpOnly cookies)
* **Backup / restore** mechanism (daily automated pg_dump, 30-day retention)
* **Master lists** for vehicles, personnel, and materials (with location tracking)

### 4.3 Integrations

* **Alarm Server Webhook** (primary integration, MVP)
  * Receives alarms from existing alarm server that converts SMS to DIVERA format
  * Auto-creates incident cards from incoming alarms
  * Webhook endpoint with shared secret authentication
* **DIVERA 24/7 API** (March 2026, production ready phase)
  * Poll DIVERA for latest emergencies and sync to board
  * Send detailed emergency info back to DIVERA (assigned personnel, materials)
  * Target specific personnel with notifications
  * Dummy "would send to DIVERA" messages in MVP
* **Leaflet \+ OpenStreetMap** for map view with geocoding (Nominatim)
* **Photo storage** via filesystem (Docker volumes) with automatic compression

### 4.4 UI / UX

* Clean card layout with large readable fonts and clear color coding  
* Large-screen & touch-monitor support (responsive layout)  
* Tabbed Kanban / Map views  
* Filter & control panel (by status, vehicle, crew, area)  
* Mobile UI: simplified incident list sorted by urgency or time

### 4.5 Reliability, Deployment & Infrastructure

* **Railway hosting** for primary cloud deployment
* **Local Docker runner** for emergency fallback (LAN/offline use)
* **One-way DB sync**: Railway → Local every 5 minutes (automated pg_dump + restore)
* **No dual editing**: Railway OR Local active at any time, manual failover switch
* **Health check endpoint**: detect Railway outages, show warning in UI
* **GitHub Actions CI/CD**: automated testing, build Docker images, deploy to Railway
* **Short-polling sync** (≤ 5 s, user-configurable interval) for state updates
* **TLS & hardened container image** with security best practices
* **Daily database snapshots** with 30-day retention
* Downtime tolerance in "peace time" but **no downtime tolerated during active operations**

### 4.6 Security & Data Protection

* Role-based authentication (Editor / Viewer)  
* Encrypted connections (HTTPS / TLS)  
* Minimal personal data (names only, no contact info)  
* Basic logging for auth and state changes

### 4.7 Reporting & Post-Operation Analysis

* Export incident logs (CSV / PDF)  
* Basic search (by date, vehicle, crew, status)  
* Simple dashboard metrics (later): incident counts, response times

### 4.8 Training Mode

* Same database for live and training incidents (filtered by `training_flag`)
* Each incident marked as training or live at creation (default: live)
* Training incidents handled identically to live incidents in workflow
* All users (including mobile viewers) can see training incidents
* Clear visual indicators (banner, card badges, color coding) for training mode
* Manual deletion of training incidents when no longer needed (minimal auto-purging)
* Filter option to show/hide training incidents

### 4.9 FU Pleasantries / Workflow Helpers

* Auto-assign importance, location, incident type based on alarm text (via alarm webhook)
* Auto-release people or vehicles once an incident is completed (optional workflow)
* Quick-assign last used crew/vehicle (e.g. "just continue with the next emergency")
* Incident timer badge and **notification reminders** after configurable time (no auto-archiving)
* **No automatic status transitions** - all manual via drag-and-drop (only reminders/notifications)
* Conflict warnings when assigning already-assigned resources (allow override)
* Startup checklist and info for first-time users

###  4.10 Field Input (Reko Forms)

* Allow fast, structured field input aligned with our *Reko checklist*
* Keep compatibility with existing WhatsApp use
* Allow photos, free text, and quick yes/no answers
* Minimal training needed for non-technical users
* **Reusable token-based access** (no login) - one token per responder type/form
* **Forms are fully editable** after submission - can update answers, add photos, revise notes
* **Draft saving and resume capability** - auto-save on field changes, resume on revisit
* A lightweight mobile web form linked to each incident, accessible via QR code or link
  * Reko receives their assigned Meldezettel → clicks or scans link `/reko?id=INC123&token=abc`
  * Sees a simple checklist-based form with 4 short sections:
    * **Basic confirmation** (Einsatz relevant? \[Yes/No\])
    * **Key details** (Gefahren, Aufwand, Stromversorgung, etc. — 3–5 dropdowns \+ notes)
    * **Optional photos upload** (directly from camera with automatic compression)
    * **Summary comment box**
  * Submit → automatically attaches a "Reko Report" to the incident card on the board, visible in an expandable section
  * Report stored in separate `reko_reports` table with full edit history
* Offline fallback: intercom and manual update in the KP Rück

## 5\. Architecture Overview

### 5.1 Tech Stack

| Layer | Technology |
| ----- | ----- |
| Frontend | Next.js (React \+ TypeScript) |
| Backend | FastAPI (Python, REST API) |
| Database | PostgreSQL |
| Map | Leaflet / OpenLayers \+ OpenStreetMap |
| Deployment | Docker containers via Railway \+ local Docker runner |
| CI/CD | GitHub Actions (build \+ deploy) |

### 

### 5.2 Architecture Notes

* **Monolithic** design keeps simplicity; services separated logically inside one codebase
* **Simple polling model** (≤ 5 s, user-configurable) - **NO WebSockets in MVP** (may add later if needed)
* **JWT authentication** with short-lived access tokens (15 min) + refresh tokens in httpOnly cookies
* **Editor \+ Viewer roles** determined at login via JWT claims; same backend
* **Optimistic UI updates** with last-write-wins conflict resolution and notifications
* **Local runner** allows instant LAN fallback with automated Railway DB sync (every 5 min)
* **One-way sync only** - Railway → Local, never concurrent editing
* Daily backups automated through CI/CD job (30-day retention)

## 6\. Data Model

| Table | Purpose | Key Fields |
| ----- | ----- | ----- |
| **users** | Authentication, roles | id, username, password\_hash, role (editor/viewer), last\_login |
| **vehicles** | Vehicle master list | id, name, type, status (available/assigned/maintenance) |
| **personnel** | Crew database | id, name, role, availability (available/assigned/unavailable) |
| **materials** | Materials/equipment | id, name, type, status, location (vehicle or storage room) |
| **incidents** | Incident tracking | id, title, type (predefined), priority (predefined), location\_address, location\_lat, location\_lng, status, training\_flag, created\_by, completed\_at |
| **incident\_assignments** | Many-to-many assignments | id, incident\_id, resource\_type (personnel/vehicle/material), resource\_id, assigned\_at, assigned\_by, unassigned\_at |
| **reko\_reports** | Field reconnaissance reports | id, incident\_id, token, is\_relevant, dangers\_json, effort\_json, power\_supply, photos\_json, summary\_text, is\_draft, submitted\_at, updated\_at |
| **status\_transitions** | Incident workflow audit | incident\_id, from\_status, to\_status, timestamp, user\_id, notes |
| **audit\_log** | Comprehensive action log | id, user\_id, action\_type, resource\_type, resource\_id, changes\_json, timestamp, ip\_address |
| **settings** | System configuration | key, value, updated\_at, updated\_by |

**Notes:**
- **Many-to-many assignments** tracked via `incident_assignments` with conflict warnings in UI
- **Training flag** on incidents (not separate tables) - same database, filtered by flag
- **Predefined enums**: incident type (fire/medical/technical/hazmat/other), priority (low/medium/high/critical)
- **JSONB fields** for structured but flexible data (reko reports, audit changes)
- **Soft deletes** for incidents (moved to archive, not hard deleted)

## 

## 7\. System Components

* **Frontend App** (Next.js): Kanban & Map views, polling client  
* **Backend API** (FastAPI): endpoints for CRUD, authentication, sync, training mode  
* **Database Layer** (PostgreSQL): persistent storage  
* **CI/CD & Runner**: GitHub Actions pipelines for Railway \+ local deployment  
* **Monitoring**: basic uptime \+ error logging (Sentry or Railway logs)

## 8\. User Roles

| Role | Permissions | Devices |
| ----- | ----- | ----- |
| **Editor** | Full CRUD, drag/drop, training toggle, export | Desktop / Touch screen |
| **Mobile Viewer** | Read-only, live updates, optional notifications | Smartphone / Tablet |

## 9\. UI / UX Design

### 9.1 User Flow

1. Editor logs in  
2. Chooses *Live* or *Training* mode  
3. Creates new incident (location, priority)  
4. Card appears in *Eingegangen*  
5. Editor drags through workflow columns  
6. Editor adds crew, vehicle, material  
7. Mobile Viewers see updates within seconds  
8. Incident auto-moves to archive after completion

### 9.2 Screens

* **Login**  
* **Dashboard (Tabbed)** – Kanban / Map  
* **Incident Modal** – create/edit  
* **Settings** – personnel, vehicles, training controls  
* **Mobile Viewer** – incident list view  
* **Reko form** – simple input form with quicksave and resumability

## 10\. Operational Considerations

* **Deployment environments:** staging / production  
* **Rollback:** via GitHub Actions deployment version tags  
* **Monitoring:** uptime \+ error logs (Railway \+ Sentry)  
* **Backups:** daily snapshots; manual restore possible  
* **Local fallback:** offline Docker container for LAN ops

## 11\. Security

* HTTPS/TLS enforced  
* Local admin password rotation policy  
* No external personal data stored  
* Limited open ports (80/443 only)  
* All secrets managed via Railway environment variables

## 12\. Performance & Scalability

* Designed for ≤ 3 active editors, max \~50 viewers  
* Polling frequency: ≤ 5 s  
* Response time target: \< 200 ms per API call  
* Database: single node PostgreSQL, daily backup  
* Optional vertical scaling on Railway if needed

## 13\. Testing Strategy

* Unit tests for backend models & routes  
* Integration tests for key workflows (create, move, complete incident)  
* UI smoke tests using Playwright  
* Manual end-to-end testing during exercises

## 14\. Failure Scenarios & Recovery

| Scenario | Mitigation |
| ----- | ----- |
| Cloud outage | Switch to local Docker runner |
| DB corruption | Restore from latest backup |
| Network issues | Cached local state (read-only) |
| Editor crash | Reconnect restores last state |

## 15\. Risks & Mitigations

| Risk | Mitigation |
| ----- | ----- |
| Railway downtime during active ops | Local Docker fallback with automated 5-min DB sync |
| Slow sync under load | Optimize polling endpoint, add caching, consider WebSockets only if necessary |
| Data inconsistency (multi-editor) | Optimistic locking with conflict notifications, last-write-wins |
| JWT implementation complexity | Use proven library (PyJWT), comprehensive test coverage, short-lived tokens |
| Photo storage growth unbounded | Retention policy (1 year), automatic compression, monitoring |
| Assignment conflicts causing confusion | Clear UI warnings, allow informed override, track in audit log |
| DB sync failure during failover | Manual backup procedure, health check monitoring, last-known-good restore |
| Training/live incidents mixed | Strong visual indicators, separate filtering, training flag validation |
| Missing analytics | Comprehensive audit log from day 1, status transitions table |

## 16\. Future Work / Nice-to-Haves (Post-MVP)

* Real-time WebSocket updates (only if polling proves insufficient)
* Offline-first mode (PWA with service workers)
* Role-based permissions beyond Editor / Viewer (e.g., Administrator, Coordinator)
* Automatic DIVERA → WhatsApp bridge for broader notifications
* Map clustering for high incident volume
* Dashboard KPIs and analytics (mean response time, incident heatmaps, resource utilization)
* Mobile native app (React Native) if web version proves insufficient
* AI-assisted incident classification and resource suggestion
* Video/audio attachments for Reko reports
* Integration with other emergency services (police, ambulance coordination)

## 17\. Timeline

* MVP  
  * core UI, functional backend, Railway deploy, auth  
  * Target: Nov 2025 to test usefulness  
* Production Ready  
  * DIVERA, backup, filters, training mode  
  * Target: March 2026 for FU training  
* Long term  
  * offline mode, dashboards, audit logs  
  * Target: Summer 2026 for potential real world scenarios


# Online Demo Release Plan

**Status**: Live at [demo.kp-rueck.app](https://demo.kp-rueck.app)
**Last updated**: 2026-02-20

## Overview

Hosted online demo at `demo.kp-rueck.app` for:
- **Other fire departments** evaluating KP Ruck for their own command posts
- **General public** exploring the system via GitHub or a landing page

The demo is self-service with a pre-loaded realistic scenario so visitors immediately see a populated Kanban board, but can also create/modify their own data.

---

## Target Audience

| Audience | What they want to see |
|----------|----------------------|
| Fire departments (KP teams) | Realistic Kanban workflow, drag-and-drop, Reko forms, map view, personnel management |
| General public / developers | Feature overview, UI quality, responsiveness, architecture |

---

## Demo Features

### User Experience

| Feature | Demo Behavior |
|---------|---------------|
| Login | Pre-filled demo credentials, one-click login |
| All CRUD operations | Fully functional |
| Drag-and-drop kanban | Fully functional |
| Map view | Works with OpenStreetMap tiles (online mode) |
| Photo upload (Reko) | Functional but cleared on reset |
| Training mode | Functional (auto-generated emergencies) |
| Notifications | Functional |
| WebSocket / live updates | Functional |

### Disabled / Not Available in Demo

| Feature | Reason | UI Behavior |
|---------|--------|-------------|
| Thermal printer | No printer hardware in demo env | Settings page shows "Drucker nicht verfügbar im Demo-Modus" |
| Divera 24/7 integration | No access key, don't mock | Settings shows "Divera nicht konfiguriert" (same as unconfigured prod) |
| Traccar GPS | No Traccar server | Map shows vehicles without GPS positions (same as unconfigured prod) |
| Sync (Railway ↔ Local) | Single-instance demo | Not visible to user |

These features are simply not configured (empty env vars), which is the same behavior as a fresh production install without those integrations.

### Demo Accounts

| Username | Password | Role | Use case |
|----------|----------|------|----------|
| `demo-editor` | `demo123` | Editor (full CRUD) | Full experience for evaluators |
| `demo-viewer` | `demo123` | Viewer (read-only) | Showcases viewer role |

### Pre-loaded Scenario

The demo seeds with a realistic **Hochwasser Oberwil** event containing:

| Data | Details |
|------|---------|
| Event | 1 active "Hochwasser Oberwil" event |
| Incidents | 5-6 incidents across all statuses (eingegangen → abschluss) |
| Personnel | ~20 anonymized firefighters with various roles and check-in status |
| Vehicles | 4-5 vehicles (TLF, DLK, MTW, etc.) with assignments |
| Materials | 10+ materials across different locations |
| Assignments | Some incidents fully staffed, others awaiting resources |
| Reko report | 1-2 submitted Reko reports with sample photos |
| Notifications | A few unread notifications (overdue, missing location, etc.) |

This ensures first-time visitors see a **populated, realistic board** immediately after login.

### Reset Behavior

- **Frequency**: Every 2 hours
- **What resets**: Database returns to seed state, uploaded photos deleted
- **User notification**: Persistent banner at top shows "Demo wird in X Minuten zurückgesetzt"
- **Post-reset**: Auto-refresh, user stays logged in

---

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           demo.kp-rueck.app             │
                    └────────────────┬────────────────────────┘
                                     │
              ┌──────────────────────┴───────────────────────┐
              │                                              │
    ┌─────────▼─────────┐                      ┌─────────────▼─────────────┐
    │    Frontend       │                      │      Backend              │
    │   (Railway)       │◄────────────────────►│     (Railway)             │
    │   - Demo banner   │                      │   - DEMO_MODE=true        │
    │   - Reset timer   │                      │   - Rate limiting         │
    │   - Pre-fill login│                      │   - Reset scheduler       │
    └───────────────────┘                      │   - Abuse limits          │
                                               └─────────────┬─────────────┘
                                                             │
                                               ┌─────────────▼─────────────┐
                                               │     PostgreSQL            │
                                               │   - Resets every 2 hours  │
                                               └───────────────────────────┘
```

Separate Railway project, completely isolated from production.

---

## Implementation Phases

### Phase 1: Backend Demo Mode

**Goal**: Backend behaves normally but with demo-specific constraints.

1. **Config**: Add `DEMO_MODE=true` env var, checked via `settings.demo_mode` property
2. **Demo seed script**: `app/seed_demo.py` — creates the pre-loaded scenario (anonymized names, realistic data)
3. **Reset scheduler**: Background task that runs every 2 hours:
   - Truncate all tables (except users)
   - Re-run demo seed
   - Clear photo uploads directory
   - Log reset to stdout
4. **Demo status endpoint**: `GET /api/demo/status` → `{ "demo": true, "next_reset": "2026-01-15T14:00:00Z", "seconds_until_reset": 3420 }`
5. **Rate limiting**: Tighten per-IP limits in demo mode (already have slowapi)
6. **Abuse limits**: Max 30 incidents, 15 photo uploads per reset period
7. **Disable sensitive endpoints**: Block user creation/deletion, password changes in demo mode

**Files to modify**:
- `backend/app/config.py` — add `demo_mode: bool = False`
- `backend/app/seed_demo.py` — new file, demo-specific seed data
- `backend/app/background.py` — add reset scheduler
- `backend/app/api/health.py` — add `/api/demo/status` endpoint

### Phase 2: Frontend Demo Mode

**Goal**: UI shows demo context and streamlines login.

1. **Demo banner**: Sticky top banner showing reset countdown (`DemoBanner` component)
   - Yellow background, "Demo-Modus — wird in X Minuten zurückgesetzt"
   - Dismiss-able but reappears after page reload
2. **Login page**: Pre-fill credentials, show "Demo-Modus" badge
   - Two big buttons: "Als Editor einloggen" / "Als Betrachter einloggen"
3. **Auto-refresh**: After reset timer hits 0, show "Demo wird zurückgesetzt..." overlay, then reload page
4. **Feature disabled hints**: Where printer/Divera/GPS settings appear, show info text explaining they're not available in demo

**Files to modify**:
- `frontend/components/demo-banner.tsx` — new component
- `frontend/app/login/page.tsx` — demo mode login UI
- `frontend/lib/api-client.ts` — add `getDemoStatus()` method

### Phase 3: Demo Seed Data

**Goal**: Realistic, anonymized Swiss firefighting scenario.

Create `backend/app/seed_demo.py`:

```python
# Personnel (anonymized, Swiss-style names)
DEMO_PERSONNEL = [
    {"name": "Müller P.", "role": "Of", "availability": "available"},
    {"name": "Schneider T.", "role": "Wm", "availability": "available"},
    {"name": "Weber M.", "role": "Kpl", "availability": "available"},
    # ... ~20 total, mix of roles and availability
]

# Incidents across all statuses
DEMO_INCIDENTS = [
    {
        "title": "Wasserschaden Keller",
        "type": "elementarereignis",
        "status": "einsatz",
        "priority": "high",
        "location_address": "Hauptstrasse 45, 4104 Oberwil",
        "description": "Wasser im Keller nach Starkregen, ca. 20cm Wasserstand",
        "contact": "Hr. Beispiel, 079 123 45 67",
    },
    # ... 5-6 incidents in various statuses
]
```

Use real Oberwil addresses (public data) with fake names and contact info.

### Phase 4: Deployment

1. Create **separate Railway project** `kp-rueck-demo`
2. Services: PostgreSQL + Backend + Frontend (same Docker images)
3. Environment variables:
   ```
   DEMO_MODE=true
   DEMO_RESET_HOURS=2
   SECRET_KEY=<generated>
   ADMIN_SEED_PASSWORD=<generated>
   DATABASE_URL=<railway-postgres>
   CORS_ORIGINS=https://demo.kp-rueck.app
   SEED_DATABASE=true
   ```
4. Custom domain: `demo.kp-rueck.app` (Cloudflare DNS)
5. Cloudflare proxy for DDoS protection

### Phase 5: Documentation & Landing

1. Update `README.md` with "Try the Demo" section and link
2. Add demo link to GitHub repo description
3. Optional: Simple landing page at `demo.kp-rueck.app` before login

---

## Cost Estimate (Railway)

| Resource | Cost/Month |
|----------|------------|
| Backend (Hobby) | $5 |
| PostgreSQL (Hobby) | $5 |
| Frontend (same project) | $0 (shared) |
| Cloudflare (Free) | $0 |
| **Total** | **~$10/month** |

---

## Security & Abuse Prevention

| Measure | Details |
|---------|---------|
| Rate limiting | 60 requests/minute per IP (existing slowapi) |
| Data limits | Max 30 incidents, 15 photo uploads per reset |
| File size | 1 MB limit in demo (vs 10 MB in prod) |
| No sensitive data | All names/contacts are fake |
| No real integrations | Divera/Traccar/Printer simply not configured |
| Reset clears all | Including uploaded files |
| Separate environment | Isolated Railway project, different DB |
| No user management | Cannot create/delete users, change passwords |
| Read-only secrets | SECRET_KEY, ADMIN_SEED_PASSWORD not exposed |

---

## Implementation Checklist

- [x] Add `demo_mode` to `Settings` class
- [x] Create `seed_demo.py` with realistic scenario data
- [x] Implement reset scheduler (truncate + re-seed every 2h)
- [x] Add `GET /api/demo/status` endpoint
- [x] Add abuse limits (incident/photo caps in demo mode)
- [x] Block user management endpoints in demo mode
- [x] Create `DemoBanner` frontend component
- [x] Modify login page for demo mode (pre-filled credentials)
- [x] Add auto-refresh after reset
- [x] Create Railway demo project and deploy
- [x] Set up `demo.kp-rueck.app` domain
- [x] Update README with demo link
- [x] Test full reset cycle end-to-end

---

## Future Enhancements

1. Guided tour / interactive walkthrough (e.g. Shepherd.js)
2. Multiple pre-built scenarios (Hochwasser, Grossbrand, Übung)
3. Feedback collection widget ("Was gefällt Ihnen?")
4. Usage analytics (anonymous, how far users explore)
5. QR code for demo link (for presentations)

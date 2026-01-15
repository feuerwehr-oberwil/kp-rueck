# Online Demo Release Plan

Last updated: 2025-01-12

## Overview

This plan outlines how to create a hosted online demo at `demo.kp-rueck.app` (or similar) that:
- Allows users to explore the full application
- Resets to clean state periodically (every 1-4 hours)
- Uses anonymized sample data
- Mocks external integrations (Traccar GPS)
- Requires no signup (pre-configured demo accounts)

---

## Demo Features

### User Experience

| Feature | Demo Behavior |
|---------|---------------|
| Login | Pre-filled demo credentials, one-click login |
| All CRUD operations | Fully functional (create, edit, delete) |
| Drag-and-drop kanban | Fully functional |
| Map view | Works with OpenStreetMap tiles |
| GPS tracking | Mocked vehicle positions (simulated movement) |
| Photo upload | Functional but cleared on reset |
| Settings | Viewable but reset on refresh |

### Demo Accounts

| Username | Password | Role | Purpose |
|----------|----------|------|---------|
| `demo-editor` | `demo123` | Editor | Full access demo |
| `demo-viewer` | `demo123` | Viewer | Read-only demo |

### Reset Behavior

- **Frequency**: Every 2 hours
- **What resets**: Database returns to seed state, uploaded photos deleted
- **User notification**: Banner shows "Demo resets in X minutes"
- **During reset**: 30-second maintenance page, then auto-refresh

---

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           demo.kp-rueck.app             │
                    │              (Cloudflare)               │
                    └────────────────┬────────────────────────┘
                                     │
              ┌──────────────────────┴───────────────────────┐
              │                                              │
    ┌─────────▼─────────┐                      ┌─────────────▼─────────────┐
    │    Frontend       │                      │      Backend              │
    │   (Vercel/Railway)│                      │     (Railway)             │
    │                   │◄────────────────────►│                           │
    │   - Demo banner   │   API calls          │   - DEMO_MODE=true        │
    │   - Reset timer   │                      │   - Mock Traccar          │
    │   - Pre-fill login│                      │   - Rate limiting         │
    └───────────────────┘                      │   - Reset scheduler       │
                                               └─────────────┬─────────────┘
                                                             │
                                               ┌─────────────▼─────────────┐
                                               │     PostgreSQL            │
                                               │      (Railway)            │
                                               │                           │
                                               │   - Resets every 2 hours  │
                                               │   - Demo seed data        │
                                               └───────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Backend Demo Mode (~4 hours)

#### 1.1 Add Demo Configuration

**File**: `backend/app/config.py`

```python
class Settings(BaseSettings):
    # Existing settings...

    # Demo mode settings
    demo_mode: bool = Field(default=False, env="DEMO_MODE")
    demo_reset_interval_hours: int = Field(default=2, env="DEMO_RESET_HOURS")
    demo_rate_limit_per_minute: int = Field(default=60, env="DEMO_RATE_LIMIT")

    @property
    def is_demo(self) -> bool:
        return self.demo_mode
```

#### 1.2 Create Mock Traccar Client

**File**: `backend/app/services/mock_traccar.py`

```python
import random
import math
from datetime import datetime
from typing import Dict, List

class MockTraccarClient:
    """Returns simulated GPS positions for demo mode."""

    # Demo vehicle routes (circular paths around demo location)
    DEMO_CENTER = (46.2044, 6.1432)  # Geneva

    def __init__(self):
        self.vehicle_angles: Dict[str, float] = {}

    async def get_vehicle_positions(self, vehicle_ids: List[str]) -> List[dict]:
        positions = []
        for vid in vehicle_ids:
            # Each vehicle moves in a circle around center
            if vid not in self.vehicle_angles:
                self.vehicle_angles[vid] = random.uniform(0, 2 * math.pi)

            # Move slightly each call
            self.vehicle_angles[vid] += 0.1
            radius = 0.01 + random.uniform(-0.002, 0.002)

            lat = self.DEMO_CENTER[0] + radius * math.sin(self.vehicle_angles[vid])
            lng = self.DEMO_CENTER[1] + radius * math.cos(self.vehicle_angles[vid])

            positions.append({
                "deviceId": vid,
                "latitude": lat,
                "longitude": lng,
                "speed": random.randint(0, 60),
                "course": int(math.degrees(self.vehicle_angles[vid])) % 360,
                "timestamp": datetime.utcnow().isoformat(),
            })

        return positions
```

#### 1.3 Update Traccar API to Use Mock

**File**: `backend/app/api/traccar.py`

```python
from app.config import settings
from app.services.mock_traccar import MockTraccarClient

# Initialize appropriate client
if settings.is_demo:
    traccar_client = MockTraccarClient()
else:
    traccar_client = TraccarClient(...)

@router.get("/positions")
async def get_positions(...):
    if settings.is_demo:
        return await traccar_client.get_vehicle_positions(vehicle_ids)
    # ... existing real implementation
```

#### 1.4 Create Database Reset Scheduler

**File**: `backend/app/background/demo_reset.py`

```python
import asyncio
from datetime import datetime, timedelta
from app.config import settings
from app.database import async_session_maker
from app.seed import seed_demo_data

_reset_task: Optional[asyncio.Task] = None
_next_reset: Optional[datetime] = None

async def reset_database():
    """Reset database to demo seed state."""
    global _next_reset

    logger.info("Starting demo database reset...")

    async with async_session_maker() as db:
        # Clear all data
        await db.execute(text("TRUNCATE incidents, personnel, vehicles, materials, events CASCADE"))
        await db.commit()

        # Re-seed with demo data
        await seed_demo_data(db)
        await db.commit()

    # Clear uploaded photos
    photo_dir = Path(settings.photos_dir)
    if photo_dir.exists():
        shutil.rmtree(photo_dir)
        photo_dir.mkdir(parents=True)

    _next_reset = datetime.utcnow() + timedelta(hours=settings.demo_reset_interval_hours)
    logger.info(f"Demo reset complete. Next reset at {_next_reset}")

async def demo_reset_loop():
    """Background loop that resets demo every N hours."""
    global _next_reset

    while True:
        await asyncio.sleep(settings.demo_reset_interval_hours * 3600)
        await reset_database()

def start_demo_reset_scheduler():
    global _reset_task, _next_reset
    if settings.is_demo:
        _next_reset = datetime.utcnow() + timedelta(hours=settings.demo_reset_interval_hours)
        _reset_task = asyncio.create_task(demo_reset_loop())
        logger.info(f"Demo reset scheduler started. First reset at {_next_reset}")

def get_next_reset_time() -> Optional[datetime]:
    return _next_reset
```

#### 1.5 Add Demo Status Endpoint

**File**: `backend/app/api/demo.py`

```python
from fastapi import APIRouter
from app.config import settings
from app.background.demo_reset import get_next_reset_time

router = APIRouter(prefix="/api/demo", tags=["demo"])

@router.get("/status")
async def demo_status():
    """Get demo mode status and next reset time."""
    if not settings.is_demo:
        return {"demo_mode": False}

    next_reset = get_next_reset_time()
    return {
        "demo_mode": True,
        "next_reset": next_reset.isoformat() if next_reset else None,
        "reset_interval_hours": settings.demo_reset_interval_hours,
    }
```

#### 1.6 Add Rate Limiting for Demo

**File**: `backend/app/middleware/demo_rate_limit.py`

```python
from slowapi import Limiter
from slowapi.util import get_remote_address
from app.config import settings

limiter = Limiter(key_func=get_remote_address)

def get_demo_rate_limit():
    if settings.is_demo:
        return f"{settings.demo_rate_limit_per_minute}/minute"
    return "1000/minute"  # Effectively no limit in production
```

---

### Phase 2: Frontend Demo Mode (~3 hours)

#### 2.1 Add Demo Banner Component

**File**: `frontend/components/demo-banner.tsx`

```typescript
'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'

export function DemoBanner() {
  const [nextReset, setNextReset] = useState<Date | null>(null)
  const [timeLeft, setTimeLeft] = useState<string>('')

  useEffect(() => {
    async function fetchDemoStatus() {
      try {
        const status = await apiClient.getDemoStatus()
        if (status.demo_mode && status.next_reset) {
          setNextReset(new Date(status.next_reset))
        }
      } catch (e) {
        // Not in demo mode or error
      }
    }
    fetchDemoStatus()
    const interval = setInterval(fetchDemoStatus, 60000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!nextReset) return

    const timer = setInterval(() => {
      const now = new Date()
      const diff = nextReset.getTime() - now.getTime()

      if (diff <= 0) {
        setTimeLeft('Resetting...')
        // Reload page after reset
        setTimeout(() => window.location.reload(), 5000)
        return
      }

      const hours = Math.floor(diff / 3600000)
      const minutes = Math.floor((diff % 3600000) / 60000)
      setTimeLeft(`${hours}h ${minutes}m`)
    }, 1000)

    return () => clearInterval(timer)
  }, [nextReset])

  if (!nextReset) return null

  return (
    <div className="bg-amber-500 text-black px-4 py-2 text-center text-sm font-medium">
      <span className="mr-2">🎭</span>
      Demo Mode - Data resets in {timeLeft}
      <a
        href="https://github.com/yourusername/kp-rueck"
        className="ml-4 underline"
        target="_blank"
      >
        View Source
      </a>
    </div>
  )
}
```

#### 2.2 Add to Layout

**File**: `frontend/app/layout.tsx`

```typescript
import { DemoBanner } from '@/components/demo-banner'

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>
        <DemoBanner />
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
```

#### 2.3 Pre-fill Login for Demo

**File**: `frontend/app/login/page.tsx`

```typescript
export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    async function checkDemo() {
      try {
        const status = await apiClient.getDemoStatus()
        if (status.demo_mode) {
          setIsDemo(true)
          setUsername('demo-editor')
          setPassword('demo123')
        }
      } catch {}
    }
    checkDemo()
  }, [])

  return (
    <form>
      {isDemo && (
        <div className="mb-4 p-3 bg-blue-100 rounded text-sm">
          <strong>Demo Mode</strong><br/>
          Use pre-filled credentials or try:
          <ul className="list-disc ml-4 mt-1">
            <li>demo-editor / demo123 (full access)</li>
            <li>demo-viewer / demo123 (read-only)</li>
          </ul>
        </div>
      )}
      {/* ... rest of form ... */}
    </form>
  )
}
```

---

### Phase 3: Anonymize Seed Data (~1 hour)

#### 3.1 Create Demo Seed Script

**File**: `backend/app/seed_demo.py`

```python
"""Demo-specific seed data with anonymized content."""

DEMO_SETTINGS = [
    ("firestation_name", "Demo Fire Department"),
    ("firestation_city", "Demo City"),
    ("firestation_latitude", "46.2044"),  # Geneva
    ("firestation_longitude", "6.1432"),
]

DEMO_PERSONNEL = [
    # Officers
    {"name": "Officer Alpha", "role": "Offiziere", "rank": "Kommandant"},
    {"name": "Officer Beta", "role": "Offiziere", "rank": "Hauptmann"},
    # Sergeants
    {"name": "Sergeant 1", "role": "Wachtmeister", "rank": "Wachtmeister"},
    {"name": "Sergeant 2", "role": "Wachtmeister", "rank": "Wachtmeister"},
    # Corporals
    {"name": "Corporal 1", "role": "Korporal", "rank": "Korporal"},
    {"name": "Corporal 2", "role": "Korporal", "rank": "Korporal"},
    # Firefighters
    *[{"name": f"Firefighter {i}", "role": "Mannschaft", "rank": "Soldat"}
      for i in range(1, 20)],
]

DEMO_VEHICLES = [
    {"name": "Engine 1", "type": "TLF", "callsign": "Demo-1"},
    {"name": "Ladder 1", "type": "Drehleiter", "callsign": "Demo-2"},
    {"name": "Rescue 1", "type": "Rettungsfahrzeug", "callsign": "Demo-3"},
    {"name": "Command 1", "type": "Kommandofahrzeug", "callsign": "Demo-4"},
    {"name": "Utility 1", "type": "Mannschaftstransporter", "callsign": "Demo-5"},
]

DEMO_INCIDENTS = [
    {
        "title": "Structure Fire - Main Street",
        "type": "brandbekaempfung",
        "location": "123 Main Street, Demo City",
        "status": "in_arbeit",
    },
    {
        "title": "Vehicle Accident - Highway",
        "type": "strassenrettung",
        "location": "Highway A1, Demo City",
        "status": "anfahrt",
    },
    {
        "title": "Flooding - Downtown",
        "type": "elementarereignis",
        "location": "Downtown Area, Demo City",
        "status": "bereit",
    },
    # ... more incidents
]

async def seed_demo_data(db: AsyncSession):
    """Seed database with demo data."""
    # Create demo users
    await create_user(db, "demo-editor", "demo123", "editor")
    await create_user(db, "demo-viewer", "demo123", "viewer")

    # Create settings
    for key, value in DEMO_SETTINGS:
        await create_setting(db, key, value)

    # Create resources
    for p in DEMO_PERSONNEL:
        await create_personnel(db, **p)

    for v in DEMO_VEHICLES:
        await create_vehicle(db, **v)

    # Create event and incidents
    event = await create_event(db, name="Demo Operations", training=False)

    for incident in DEMO_INCIDENTS:
        await create_incident(db, event_id=event.id, **incident)
```

---

### Phase 4: Deployment (~2 hours)

#### 4.1 Railway Demo Environment

Create separate Railway project for demo:

```bash
# Create new Railway project
railway init --name kp-rueck-demo

# Add PostgreSQL
railway add --plugin postgresql

# Set environment variables
railway variables set DEMO_MODE=true
railway variables set DEMO_RESET_HOURS=2
railway variables set DEMO_RATE_LIMIT=60
railway variables set AUTH_BYPASS_DEV=false  # Use demo accounts, not bypass
railway variables set SECRET_KEY=$(openssl rand -hex 32)
```

#### 4.2 Demo Environment File

**File**: `backend/.env.demo`

```env
# Demo environment configuration
DEMO_MODE=true
DEMO_RESET_HOURS=2
DEMO_RATE_LIMIT=60

# Database (set by Railway)
DATABASE_URL=postgresql+asyncpg://...

# Security
SECRET_KEY=<auto-generated>
AUTH_BYPASS_DEV=false

# Disable real integrations
TRACCAR_URL=  # Empty = use mock
RAILWAY_URL=  # Empty = disable sync
```

#### 4.3 Custom Domain Setup

1. Add custom domain in Railway: `demo.kp-rueck.app`
2. Configure DNS CNAME to Railway
3. Enable Cloudflare proxy for DDoS protection

---

### Phase 5: Documentation (~1 hour)

#### 5.1 Demo Landing Page

Add `/demo` route that explains:
- What the demo does
- Feature highlights
- That it resets every 2 hours
- Links to GitHub, documentation
- "Try Demo" button → `/login`

#### 5.2 README Demo Section

```markdown
## Try the Demo

Experience KP Rück without installation:

🔗 **[demo.kp-rueck.app](https://demo.kp-rueck.app)**

- **Editor access**: `demo-editor` / `demo123`
- **Viewer access**: `demo-viewer` / `demo123`

> Note: Demo data resets every 2 hours. Your changes will not persist.

### What's Included
- Full Kanban operations board
- Interactive map with simulated vehicle positions
- Resource management (personnel, vehicles, materials)
- Drag-and-drop incident workflow
- Role-based access control demo
```

---

## Estimated Effort

| Phase | Task | Hours |
|-------|------|-------|
| 1 | Backend demo mode | 4 |
| 2 | Frontend demo mode | 3 |
| 3 | Anonymize seed data | 1 |
| 4 | Deployment setup | 2 |
| 5 | Documentation | 1 |
| **Total** | | **11 hours** |

---

## Cost Estimate (Railway)

| Resource | Cost/Month |
|----------|------------|
| Backend (Hobby) | $5 |
| PostgreSQL (Hobby) | $5 |
| Frontend (Vercel Free) | $0 |
| **Total** | **~$10/month** |

---

## Security Considerations

### Demo-Specific Protections

1. **Rate Limiting**: 60 requests/minute per IP
2. **No Sensitive Data**: All data is fake/anonymized
3. **No Real Integrations**: Traccar mocked, no Railway sync
4. **Reset Clears Everything**: Including any uploaded files
5. **Separate Environment**: Completely isolated from production

### Abuse Prevention

```python
# Additional demo protections
MAX_INCIDENTS_PER_RESET = 50  # Prevent spam creation
MAX_PHOTOS_PER_RESET = 20     # Limit uploads
MAX_FILE_SIZE_DEMO = 1_000_000  # 1MB limit in demo
```

---

## Monitoring

### Key Metrics to Track

- Request rate per IP
- Database reset success/failure
- Memory usage over time
- Error rate
- User session duration

### Alerts

- Reset failure → Slack/email notification
- High error rate → Investigation
- Memory spike → Potential abuse

---

## Future Enhancements

1. **Guided Tour**: Interactive walkthrough for new users
2. **Sample Scenarios**: Pre-built incident scenarios to demo
3. **Feature Flags**: Toggle experimental features in demo
4. **Feedback Widget**: Collect user feedback directly
5. **Analytics**: Track feature usage to inform development

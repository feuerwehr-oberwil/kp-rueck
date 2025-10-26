# Task 14.1: Divera GPS Integration & Templates

**Priority:** P4 (Future - Optional enhancement)
**Complexity:** High
**Estimated Effort:** 10-15 hours
**Dependencies:** None
**Status:** Specification Complete - Not Implemented

---

## 1. Overview

Integrate with Divera 24/7 alerting system to automatically pull GPS coordinates, personnel availability, and alarm data. Enable one-click incident creation from Divera alarms and sync personnel status bidirectionally.

### Business Value
- Faster incident creation from real alarms
- Real-time GPS tracking of responding units
- Automatic personnel availability sync
- Reduced manual data entry
- Improved situational awareness
- Better integration with existing fire service workflow

### User Stories

**As a dispatcher**, I want:
- Incidents auto-created from Divera alarms
- GPS coordinates automatically populated
- Responding personnel automatically assigned
- Vehicle locations shown on map in real-time

**As a commander**, I want:
- See which personnel are en route (via Divera GPS)
- Know ETA of responding units
- View alarm details from Divera
- Export operations data back to Divera

**As a firefighter**, I want:
- My availability status synced from Divera app
- Automatic assignment when I respond to alarm
- My GPS location visible to command post

---

## 2. Technical Specification

### 2.1 Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│               Divera GPS Integration Architecture             │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────┐         ┌──────────────┐                    │
│  │   Divera    │         │   KP Rück    │                    │
│  │   24/7 API  │ ◄─────► │   Backend    │                    │
│  └─────────────┘         └──────────────┘                    │
│        │                        │                             │
│        │ Webhooks               │ Polling                     │
│        ▼                        ▼                             │
│  ┌─────────────┐         ┌──────────────┐                    │
│  │ Alarm Data  │         │  Personnel   │                    │
│  │ GPS Coords  │         │  Vehicles    │                    │
│  │ Personnel   │         │  Incidents   │                    │
│  └─────────────┘         └──────────────┘                    │
│                                                                │
│  Data Flow:                                                    │
│  1. Divera alarm → Webhook → Auto-create incident            │
│  2. Personnel respond in Divera → Sync availability           │
│  3. GPS tracking → Update vehicle/personnel locations         │
│  4. Incident updates → Push back to Divera (optional)         │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Divera API Integration

**Divera API Documentation**: https://www.divera247.com/api.html

#### Authentication

```python
# backend/app/config.py

class Settings(BaseSettings):
    # Existing settings...

    # Divera API credentials
    divera_api_key: str | None = None
    divera_access_token: str | None = None
    divera_webhook_secret: str | None = None

    # Divera sync settings
    divera_sync_enabled: bool = False
    divera_sync_interval: int = 60  # seconds
    divera_auto_create_incidents: bool = True
```

#### API Client

```python
# backend/app/integrations/divera_client.py

import httpx
from datetime import datetime
from typing import Any
from app.config import settings
import logging

logger = logging.getLogger(__name__)

class DiveraAPIError(Exception):
    """Divera API error."""
    pass

class DiveraClient:
    """Client for Divera 24/7 API."""

    BASE_URL = "https://www.divera247.com/api/v2"

    def __init__(self):
        self.api_key = settings.divera_api_key
        self.access_token = settings.divera_access_token

        if not self.api_key or not self.access_token:
            raise DiveraAPIError("Divera API credentials not configured")

    async def _request(
        self,
        method: str,
        endpoint: str,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Make authenticated request to Divera API."""
        url = f"{self.BASE_URL}/{endpoint}"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.request(
                    method=method,
                    url=url,
                    headers=headers,
                    params={"accesskey": self.api_key, **(params or {})},
                    json=json,
                    timeout=30.0,
                )
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError as e:
                logger.error(f"Divera API request failed: {e}")
                raise DiveraAPIError(f"API request failed: {e}")

    async def get_current_alarm(self) -> dict[str, Any] | None:
        """Get current active alarm."""
        data = await self._request("GET", "alarm")

        if data.get("success") and data.get("data", {}).get("items"):
            # Return most recent alarm
            alarms = data["data"]["items"]
            return alarms[0] if alarms else None
        return None

    async def get_alarm_details(self, alarm_id: int) -> dict[str, Any]:
        """Get detailed information about specific alarm."""
        data = await self._request("GET", f"alarm/{alarm_id}")

        if data.get("success"):
            return data.get("data", {})
        raise DiveraAPIError(f"Failed to fetch alarm {alarm_id}")

    async def get_personnel_status(self) -> list[dict[str, Any]]:
        """Get personnel availability status."""
        data = await self._request("GET", "users/status")

        if data.get("success"):
            return data.get("data", {}).get("items", [])
        return []

    async def get_vehicle_positions(self) -> list[dict[str, Any]]:
        """Get GPS positions of vehicles."""
        data = await self._request("GET", "vehicles/positions")

        if data.get("success"):
            return data.get("data", {}).get("items", [])
        return []

    async def update_incident_status(
        self,
        alarm_id: int,
        status: str,
        notes: str | None = None,
    ) -> bool:
        """Update incident status in Divera (push back)."""
        payload = {
            "status": status,
        }
        if notes:
            payload["notes"] = notes

        data = await self._request("POST", f"alarm/{alarm_id}/status", json=payload)
        return data.get("success", False)
```

#### Data Models

```python
# backend/app/models.py

# Add to existing models.py

class DiveraSync(Base):
    """Track Divera alarm sync status."""
    __tablename__ = "divera_syncs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    divera_alarm_id: Mapped[int] = mapped_column(unique=True, index=True)
    incident_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("incidents.id"), nullable=True)

    alarm_data: Mapped[dict] = mapped_column(JSON)  # Raw Divera alarm data
    synced_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    last_updated: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)

    sync_status: Mapped[str] = mapped_column(String(50))  # pending, synced, error
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    incident: Mapped["Incident"] = relationship(back_populates="divera_sync")

# Update Incident model
class Incident(Base):
    # ... existing fields ...

    divera_alarm_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    divera_sync: Mapped["DiveraSync"] = relationship(back_populates="incident", uselist=False)

# Update Personnel model
class Personnel(Base):
    # ... existing fields ...

    divera_user_id: Mapped[int | None] = mapped_column(nullable=True, index=True)
    last_divera_sync: Mapped[datetime | None] = mapped_column(nullable=True)
```

#### Schemas

```python
# backend/app/schemas.py

class DiveraAlarmData(BaseModel):
    """Divera alarm data."""
    alarm_id: int
    title: str
    address: str | None = None
    lat: float | None = None
    lng: float | None = None
    alarm_time: datetime
    keyword: str | None = None  # e.g., "B3 - Wohnhaus"
    responding_units: list[str] = []
    responding_personnel: list[int] = []  # Divera user IDs

class DiveraIncidentCreate(BaseModel):
    """Create incident from Divera alarm."""
    divera_alarm_id: int
    auto_assign_personnel: bool = True
    training_flag: bool = False

class DiveraPersonnelStatus(BaseModel):
    """Personnel status from Divera."""
    divera_user_id: int
    name: str
    status: int  # 1=available, 2=not available, 3=responding
    last_update: datetime
    gps_lat: float | None = None
    gps_lng: float | None = None

class DiveraSyncStatus(BaseModel):
    """Divera sync status."""
    enabled: bool
    last_sync: datetime | None
    alarms_synced: int
    personnel_synced: int
    errors: list[str] = []
```

### 2.3 Webhook Integration

```python
# backend/app/api/divera_webhooks.py

from fastapi import APIRouter, Request, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
import hmac
import hashlib
import logging

from .. import schemas, crud
from ..database import get_db
from ..config import settings
from ..integrations.divera_client import DiveraClient

router = APIRouter(prefix="/divera", tags=["divera"])
logger = logging.getLogger(__name__)

def verify_webhook_signature(payload: bytes, signature: str) -> bool:
    """Verify Divera webhook signature."""
    if not settings.divera_webhook_secret:
        logger.warning("Webhook secret not configured, skipping verification")
        return True

    expected = hmac.new(
        settings.divera_webhook_secret.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, signature)

@router.post("/webhook/alarm")
async def handle_alarm_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Handle incoming Divera alarm webhooks.

    Divera sends webhook when:
    - New alarm is created
    - Personnel respond to alarm
    - Alarm status changes
    """
    # Verify signature
    signature = request.headers.get("X-Divera-Signature", "")
    payload = await request.body()

    if not verify_webhook_signature(payload, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # Parse alarm data
    data = await request.json()
    alarm_id = data.get("alarm_id")

    if not alarm_id:
        raise HTTPException(status_code=400, detail="Missing alarm_id")

    logger.info(f"Received Divera alarm webhook: {alarm_id}")

    # Check if already synced
    existing = await crud.get_divera_sync_by_alarm_id(db, alarm_id)
    if existing:
        logger.info(f"Alarm {alarm_id} already synced, updating...")
        # Update existing incident
        await crud.update_divera_sync(db, existing.id, data)
        return {"success": True, "action": "updated"}

    # Auto-create incident if enabled
    if settings.divera_auto_create_incidents:
        try:
            client = DiveraClient()
            alarm_details = await client.get_alarm_details(alarm_id)

            # Create incident from alarm
            incident = await crud.create_incident_from_divera(
                db=db,
                alarm_data=alarm_details,
                auto_assign=True,
            )

            logger.info(f"Created incident {incident.id} from Divera alarm {alarm_id}")
            return {
                "success": True,
                "action": "created",
                "incident_id": str(incident.id),
            }
        except Exception as e:
            logger.error(f"Failed to create incident from alarm {alarm_id}: {e}")
            # Log error but don't fail webhook
            await crud.create_divera_sync(
                db=db,
                alarm_id=alarm_id,
                alarm_data=data,
                status="error",
                error_message=str(e),
            )
            return {"success": False, "error": str(e)}

    return {"success": True, "action": "skipped"}

@router.post("/webhook/status")
async def handle_status_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Handle personnel status updates from Divera.

    Updates personnel availability when they change status in Divera app.
    """
    signature = request.headers.get("X-Divera-Signature", "")
    payload = await request.body()

    if not verify_webhook_signature(payload, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    data = await request.json()
    divera_user_id = data.get("user_id")
    status = data.get("status")

    if not divera_user_id or status is None:
        raise HTTPException(status_code=400, detail="Missing user_id or status")

    # Find personnel by Divera ID
    personnel = await crud.get_personnel_by_divera_id(db, divera_user_id)
    if not personnel:
        logger.warning(f"Personnel with Divera ID {divera_user_id} not found")
        return {"success": False, "error": "Personnel not found"}

    # Map Divera status to our status
    status_map = {
        1: "verfuegbar",
        2: "nicht_verfuegbar",
        3: "verfuegbar",  # Responding = available
    }

    new_status = status_map.get(status, "nicht_verfuegbar")

    # Update personnel
    await crud.update_personnel_status(
        db=db,
        personnel_id=personnel.id,
        status=new_status,
    )

    logger.info(f"Updated personnel {personnel.name} status to {new_status} from Divera")

    return {"success": True}
```

### 2.4 Background Sync Service

```python
# backend/app/services/divera_sync.py

import asyncio
import logging
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession

from ..integrations.divera_client import DiveraClient, DiveraAPIError
from .. import crud
from ..database import AsyncSessionLocal
from ..config import settings

logger = logging.getLogger(__name__)

class DiveraSyncService:
    """Background service for syncing with Divera."""

    def __init__(self):
        self.client = DiveraClient()
        self.running = False

    async def start(self):
        """Start background sync loop."""
        if not settings.divera_sync_enabled:
            logger.info("Divera sync is disabled")
            return

        self.running = True
        logger.info("Starting Divera sync service...")

        while self.running:
            try:
                await self._sync_iteration()
            except Exception as e:
                logger.error(f"Divera sync iteration failed: {e}")

            # Wait before next sync
            await asyncio.sleep(settings.divera_sync_interval)

    async def stop(self):
        """Stop background sync loop."""
        logger.info("Stopping Divera sync service...")
        self.running = False

    async def _sync_iteration(self):
        """Single sync iteration."""
        async with AsyncSessionLocal() as db:
            # Sync personnel status
            await self._sync_personnel_status(db)

            # Sync vehicle positions
            await self._sync_vehicle_positions(db)

            # Check for new alarms
            await self._check_new_alarms(db)

            await db.commit()

    async def _sync_personnel_status(self, db: AsyncSession):
        """Sync personnel availability from Divera."""
        try:
            statuses = await self.client.get_personnel_status()

            for status_data in statuses:
                divera_user_id = status_data.get("user_id")
                if not divera_user_id:
                    continue

                personnel = await crud.get_personnel_by_divera_id(db, divera_user_id)
                if not personnel:
                    continue

                # Map Divera status codes
                divera_status = status_data.get("status", 2)
                status_map = {
                    1: "verfuegbar",
                    2: "nicht_verfuegbar",
                    3: "verfuegbar",
                }
                new_status = status_map.get(divera_status, "nicht_verfuegbar")

                # Update if changed
                if personnel.availability_status != new_status:
                    await crud.update_personnel_status(
                        db=db,
                        personnel_id=personnel.id,
                        status=new_status,
                    )
                    logger.info(f"Synced {personnel.name} status: {new_status}")

                # Update last sync time
                personnel.last_divera_sync = datetime.utcnow()

            logger.debug(f"Synced {len(statuses)} personnel statuses from Divera")

        except DiveraAPIError as e:
            logger.error(f"Failed to sync personnel status: {e}")

    async def _sync_vehicle_positions(self, db: AsyncSession):
        """Sync vehicle GPS positions from Divera."""
        try:
            positions = await self.client.get_vehicle_positions()

            for pos_data in positions:
                # This would require extending Vehicle model with GPS fields
                # and implementing GPS tracking feature
                pass

            logger.debug(f"Synced {len(positions)} vehicle positions from Divera")

        except DiveraAPIError as e:
            logger.error(f"Failed to sync vehicle positions: {e}")

    async def _check_new_alarms(self, db: AsyncSession):
        """Check for new alarms in Divera."""
        try:
            alarm = await self.client.get_current_alarm()

            if not alarm:
                return

            alarm_id = alarm.get("id")

            # Check if already synced
            existing = await crud.get_divera_sync_by_alarm_id(db, alarm_id)
            if existing:
                return

            # Auto-create incident if enabled
            if settings.divera_auto_create_incidents:
                logger.info(f"New Divera alarm detected: {alarm_id}")

                incident = await crud.create_incident_from_divera(
                    db=db,
                    alarm_data=alarm,
                    auto_assign=True,
                )

                logger.info(f"Created incident {incident.id} from Divera alarm {alarm_id}")

        except DiveraAPIError as e:
            logger.error(f"Failed to check new alarms: {e}")
```

### 2.5 CRUD Operations

```python
# backend/app/crud.py

# Add to existing crud.py

async def get_divera_sync_by_alarm_id(
    db: AsyncSession,
    alarm_id: int,
) -> models.DiveraSync | None:
    """Get Divera sync record by alarm ID."""
    result = await db.execute(
        select(models.DiveraSync).where(models.DiveraSync.divera_alarm_id == alarm_id)
    )
    return result.scalar_one_or_none()

async def create_divera_sync(
    db: AsyncSession,
    alarm_id: int,
    alarm_data: dict,
    status: str = "pending",
    error_message: str | None = None,
) -> models.DiveraSync:
    """Create Divera sync record."""
    sync = models.DiveraSync(
        divera_alarm_id=alarm_id,
        alarm_data=alarm_data,
        sync_status=status,
        error_message=error_message,
    )
    db.add(sync)
    await db.commit()
    await db.refresh(sync)
    return sync

async def create_incident_from_divera(
    db: AsyncSession,
    alarm_data: dict,
    auto_assign: bool = True,
) -> models.Incident:
    """Create incident from Divera alarm data."""
    # Parse Divera alarm
    alarm_id = alarm_data.get("id")
    title = alarm_data.get("title", "Divera Alarm")
    address = alarm_data.get("address")
    lat = alarm_data.get("lat")
    lng = alarm_data.get("lng")
    keyword = alarm_data.get("keyword", "")

    # Determine incident type from keyword
    type_map = {
        "B": "brandbekaempfung",
        "THL": "strassenrettung",
        "ABC": "elementarereignis",
    }
    incident_type = "sonstiges"
    for prefix, itype in type_map.items():
        if keyword.startswith(prefix):
            incident_type = itype
            break

    # Create incident
    incident = models.Incident(
        title=title,
        type=incident_type,
        status="eingehend",
        location=address or "",
        lat=lat,
        lng=lng,
        alarm_time=datetime.utcnow(),
        divera_alarm_id=alarm_id,
        training_flag=False,
    )
    db.add(incident)
    await db.flush()

    # Auto-assign responding personnel
    if auto_assign and alarm_data.get("responding_personnel"):
        for divera_user_id in alarm_data["responding_personnel"]:
            personnel = await get_personnel_by_divera_id(db, divera_user_id)
            if personnel:
                # Create assignment
                assignment = models.Assignment(
                    incident_id=incident.id,
                    resource_type="personnel",
                    resource_id=personnel.id,
                )
                db.add(assignment)

    # Create Divera sync record
    sync = models.DiveraSync(
        divera_alarm_id=alarm_id,
        incident_id=incident.id,
        alarm_data=alarm_data,
        sync_status="synced",
    )
    db.add(sync)

    await db.commit()
    await db.refresh(incident)
    return incident

async def get_personnel_by_divera_id(
    db: AsyncSession,
    divera_user_id: int,
) -> models.Personnel | None:
    """Get personnel by Divera user ID."""
    result = await db.execute(
        select(models.Personnel).where(models.Personnel.divera_user_id == divera_user_id)
    )
    return result.scalar_one_or_none()
```

### 2.6 API Endpoints

```python
# backend/app/api/divera.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas, crud
from ..database import get_db
from ..dependencies import CurrentEditor
from ..integrations.divera_client import DiveraClient, DiveraAPIError

router = APIRouter(prefix="/divera", tags=["divera"])

@router.get("/status", response_model=schemas.DiveraSyncStatus)
async def get_divera_sync_status(
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Get Divera sync status (editors only)."""
    # Get sync statistics
    from sqlalchemy import func, select
    from ..models import DiveraSync, Personnel

    # Count synced alarms
    alarms_result = await db.execute(
        select(func.count()).select_from(DiveraSync)
    )
    alarms_synced = alarms_result.scalar() or 0

    # Count personnel with Divera IDs
    personnel_result = await db.execute(
        select(func.count()).select_from(Personnel).where(
            Personnel.divera_user_id.is_not(None)
        )
    )
    personnel_synced = personnel_result.scalar() or 0

    # Get recent errors
    errors_result = await db.execute(
        select(DiveraSync.error_message)
        .where(DiveraSync.sync_status == "error")
        .order_by(DiveraSync.synced_at.desc())
        .limit(5)
    )
    errors = [e for e in errors_result.scalars() if e]

    # Get last successful sync
    last_sync_result = await db.execute(
        select(DiveraSync.synced_at)
        .where(DiveraSync.sync_status == "synced")
        .order_by(DiveraSync.synced_at.desc())
        .limit(1)
    )
    last_sync = last_sync_result.scalar_one_or_none()

    return schemas.DiveraSyncStatus(
        enabled=settings.divera_sync_enabled,
        last_sync=last_sync,
        alarms_synced=alarms_synced,
        personnel_synced=personnel_synced,
        errors=errors,
    )

@router.post("/incidents/create-from-alarm", response_model=schemas.Incident)
async def create_incident_from_alarm(
    data: schemas.DiveraIncidentCreate,
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Manually create incident from Divera alarm (editors only)."""
    # Check if already synced
    existing = await crud.get_divera_sync_by_alarm_id(db, data.divera_alarm_id)
    if existing and existing.incident_id:
        raise HTTPException(
            status_code=400,
            detail=f"Incident already created for alarm {data.divera_alarm_id}",
        )

    try:
        # Fetch alarm details from Divera
        client = DiveraClient()
        alarm_data = await client.get_alarm_details(data.divera_alarm_id)

        # Override training flag if specified
        if data.training_flag:
            alarm_data["training_flag"] = True

        # Create incident
        incident = await crud.create_incident_from_divera(
            db=db,
            alarm_data=alarm_data,
            auto_assign=data.auto_assign_personnel,
        )

        return incident

    except DiveraAPIError as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/personnel/sync")
async def sync_personnel_from_divera(
    current_user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger personnel status sync (editors only)."""
    try:
        client = DiveraClient()
        statuses = await client.get_personnel_status()

        updated_count = 0
        for status_data in statuses:
            divera_user_id = status_data.get("user_id")
            if not divera_user_id:
                continue

            personnel = await crud.get_personnel_by_divera_id(db, divera_user_id)
            if not personnel:
                continue

            # Map status
            divera_status = status_data.get("status", 2)
            status_map = {1: "verfuegbar", 2: "nicht_verfuegbar", 3: "verfuegbar"}
            new_status = status_map.get(divera_status, "nicht_verfuegbar")

            if personnel.availability_status != new_status:
                await crud.update_personnel_status(
                    db=db,
                    personnel_id=personnel.id,
                    status=new_status,
                )
                updated_count += 1

        await db.commit()

        return {
            "success": True,
            "total": len(statuses),
            "updated": updated_count,
        }

    except DiveraAPIError as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### 2.7 Frontend Integration

```typescript
// frontend/lib/api-client.ts

export interface ApiDiveraAlarmData {
  alarm_id: number
  title: string
  address: string | null
  lat: number | null
  lng: number | null
  alarm_time: string
  keyword: string | null
  responding_units: string[]
  responding_personnel: number[]
}

export interface ApiDiveraSyncStatus {
  enabled: boolean
  last_sync: string | null
  alarms_synced: number
  personnel_synced: number
  errors: string[]
}

class ApiClient {
  // ... existing methods ...

  // Divera integration
  async getDiveraSyncStatus(): Promise<ApiDiveraSyncStatus> {
    return this.request('/api/divera/status/')
  }

  async createIncidentFromDiveraAlarm(
    alarm_id: number,
    auto_assign_personnel: boolean = true,
    training_flag: boolean = false,
  ): Promise<ApiIncident> {
    return this.request('/api/divera/incidents/create-from-alarm/', {
      method: 'POST',
      body: JSON.stringify({
        divera_alarm_id: alarm_id,
        auto_assign_personnel,
        training_flag,
      }),
    })
  }

  async syncPersonnelFromDivera(): Promise<{ success: boolean; total: number; updated: number }> {
    return this.request('/api/divera/personnel/sync/', {
      method: 'POST',
    })
  }
}
```

```typescript
// frontend/components/divera/divera-sync-status.tsx

'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { apiClient, type ApiDiveraSyncStatus } from '@/lib/api-client'

export function DiveraSyncStatus() {
  const [status, setStatus] = useState<ApiDiveraSyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)

  const loadStatus = async () => {
    try {
      const data = await apiClient.getDiveraSyncStatus()
      setStatus(data)
    } catch (error) {
      console.error('Failed to load Divera status:', error)
    }
  }

  useEffect(() => {
    loadStatus()
    const interval = setInterval(loadStatus, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [])

  const handleSyncPersonnel = async () => {
    setSyncing(true)
    try {
      const result = await apiClient.syncPersonnelFromDivera()
      alert(`Synced ${result.updated} of ${result.total} personnel`)
      await loadStatus()
    } catch (error) {
      alert('Sync failed: ' + error)
    } finally {
      setSyncing(false)
    }
  }

  if (!status) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {status.enabled ? (
            <CheckCircle className="h-5 w-5 text-green-500" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500" />
          )}
          Divera 24/7 Integration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Last Sync</div>
            <div>{status.last_sync ? new Date(status.last_sync).toLocaleString() : 'Never'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Alarms Synced</div>
            <div>{status.alarms_synced}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Personnel Synced</div>
            <div>{status.personnel_synced}</div>
          </div>
        </div>

        {status.errors.length > 0 && (
          <div className="text-sm text-red-500">
            <div className="font-semibold">Recent Errors:</div>
            <ul className="list-disc pl-4">
              {status.errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <Button
          onClick={handleSyncPersonnel}
          disabled={syncing || !status.enabled}
          size="sm"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          Sync Personnel Now
        </Button>
      </CardContent>
    </Card>
  )
}
```

---

## 3. Implementation Checklist

### Phase 1: Backend Foundation (3-4 hours)
- [ ] Add Divera API credentials to settings
- [ ] Create DiveraClient for API communication
- [ ] Add divera_sync and personnel foreign keys to models
- [ ] Create Alembic migration for new fields
- [ ] Implement CRUD operations for Divera sync

### Phase 2: Webhook Integration (2-3 hours)
- [ ] Create webhook endpoints for alarms and status
- [ ] Implement webhook signature verification
- [ ] Add auto-create incident logic
- [ ] Test webhook with Divera test events

### Phase 3: Background Sync (2-3 hours)
- [ ] Create DiveraSyncService
- [ ] Implement personnel status sync
- [ ] Implement vehicle position sync
- [ ] Add background task to FastAPI lifespan
- [ ] Test sync loop

### Phase 4: API Endpoints (1-2 hours)
- [ ] Create Divera status endpoint
- [ ] Create manual incident creation endpoint
- [ ] Create manual personnel sync endpoint
- [ ] Add editor-only authorization

### Phase 5: Frontend Integration (2-3 hours)
- [ ] Add Divera sync status widget
- [ ] Create manual sync UI
- [ ] Add Divera alarm ID to incident details
- [ ] Show sync errors in UI
- [ ] Test end-to-end workflow

---

## 4. Testing Strategy

### 4.1 API Client Testing
```python
# tests/test_divera_client.py

import pytest
from app.integrations.divera_client import DiveraClient

@pytest.mark.asyncio
async def test_get_current_alarm():
    client = DiveraClient()
    alarm = await client.get_current_alarm()
    assert alarm is None or isinstance(alarm, dict)

@pytest.mark.asyncio
async def test_get_personnel_status():
    client = DiveraClient()
    statuses = await client.get_personnel_status()
    assert isinstance(statuses, list)
```

### 4.2 Webhook Testing
- Test with Divera webhook simulator
- Verify signature validation
- Test auto-incident creation
- Test duplicate alarm handling

### 4.3 Integration Testing
- Create test alarm in Divera
- Verify incident auto-created
- Verify personnel assigned
- Check sync status updated

---

## 5. Configuration Guide

### 5.1 Divera API Setup

1. **Get API Credentials**:
   - Log in to Divera 24/7 admin panel
   - Navigate to Settings → API
   - Generate API key and access token
   - Copy webhook secret

2. **Configure Backend**:
```bash
# backend/.env
DIVERA_API_KEY=your_api_key_here
DIVERA_ACCESS_TOKEN=your_access_token_here
DIVERA_WEBHOOK_SECRET=your_webhook_secret_here
DIVERA_SYNC_ENABLED=true
DIVERA_SYNC_INTERVAL=60
DIVERA_AUTO_CREATE_INCIDENTS=true
```

3. **Configure Webhooks in Divera**:
   - Webhook URL: `https://your-domain.com/api/divera/webhook/alarm`
   - Events: Alarm created, Alarm updated
   - Webhook URL: `https://your-domain.com/api/divera/webhook/status`
   - Events: User status changed

### 5.2 Personnel Mapping

Link personnel to Divera users:

```sql
-- Update personnel with Divera user IDs
UPDATE personnel SET divera_user_id = 12345 WHERE name = 'Max Mustermann';
```

Or via import template:
```csv
name,role,divera_user_id
Max Mustermann,Kommandant,12345
```

---

## 6. Future Enhancements

### 6.1 Real-time GPS Tracking
- Show vehicle positions on map in real-time
- ETA calculation based on GPS
- Route optimization suggestions

### 6.2 Two-way Sync
- Push incident updates back to Divera
- Sync status changes bidirectionally
- Export operation reports to Divera

### 6.3 Advanced Automation
- Auto-assign vehicles based on Divera dispatch
- Smart personnel suggestions based on availability
- Automatic resource conflict resolution

### 6.4 Analytics
- Response time analysis (Divera alarm → on scene)
- Personnel response rate tracking
- Incident statistics by Divera keyword

---

## Acceptance Criteria

✅ **Must Have:**
- [ ] Divera API client successfully authenticates
- [ ] Webhooks create incidents automatically
- [ ] Personnel status syncs from Divera
- [ ] Manual sync button works in UI
- [ ] Sync status visible to editors
- [ ] Webhook signature validation

🎯 **Should Have:**
- [ ] Background sync runs every 60 seconds
- [ ] Personnel auto-assigned from Divera alarm
- [ ] GPS coordinates pulled from alarm
- [ ] Sync errors logged and displayed
- [ ] Duplicate alarm detection

💡 **Nice to Have:**
- [ ] Real-time vehicle GPS tracking
- [ ] Two-way sync (push updates to Divera)
- [ ] ETA calculation
- [ ] Response analytics dashboard

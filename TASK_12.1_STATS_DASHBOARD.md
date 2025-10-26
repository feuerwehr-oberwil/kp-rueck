# Task 12.1: Quick Stats Dashboard Widget

**Priority:** P3 (Nice to Have - Enhances situational awareness)
**Complexity:** Low-Medium
**Estimated Effort:** 2-4 hours
**Dependencies:** None
**Status:** Specification Complete - Not Implemented

---

## 1. Overview

Add a quick statistics widget to the main dashboard showing real-time metrics for active incidents, available resources, and personnel status. Provides commanders with instant situational awareness without requiring navigation through multiple views.

### Business Value
- Instant overview of operational capacity
- Quick resource availability assessment
- Personnel readiness visibility
- Improved decision-making with real-time metrics

### User Stories
1. **As a commander**, I want to see active incident count at a glance so I know current workload
2. **As an operator**, I want to see available resources so I can quickly assign to new incidents
3. **As a viewer**, I want to see personnel check-in status so I know staffing levels
4. **As an admin**, I want to see event statistics so I can track operational metrics

---

## 2. Technical Specification

### 2.1 Dashboard Widget Layout

```
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard Stats Widget                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│  │    🔴     │  │    👥      │  │    🚒      │           │
│  │  Active    │  │  Personnel │  │  Vehicles  │           │
│  │ Incidents  │  │            │  │            │           │
│  │            │  │  12 / 25   │  │   4 / 8    │           │
│  │     3      │  │  checked   │  │ available  │           │
│  │            │  │     in     │  │            │           │
│  └────────────┘  └────────────┘  └────────────┘           │
│                                                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│  │    🔧     │  │    ⏱️      │  │    📊      │           │
│  │ Materials  │  │  Avg Time  │  │  Today's   │           │
│  │            │  │  to Reko   │  │  Activity  │           │
│  │  23 / 45   │  │            │  │            │           │
│  │ available  │  │   4.2 min  │  │  7 total   │           │
│  │            │  │            │  │  incidents │           │
│  └────────────┘  └────────────┘  └────────────┘           │
│                                                               │
│  Last updated: 14:35:42 • Auto-refresh: ON                  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Statistics Metrics

```typescript
interface DashboardStats {
  // Incidents
  active_incidents: number;
  incidents_by_status: Record<IncidentStatus, number>;
  incidents_today: number;
  average_duration_minutes: number;

  // Personnel
  total_personnel: number;
  checked_in_count: number;
  assigned_count: number;
  available_count: number;

  // Vehicles
  total_vehicles: number;
  available_vehicles: number;
  assigned_vehicles: number;
  maintenance_vehicles: number;

  // Materials
  total_materials: number;
  available_materials: number;
  assigned_materials: number;

  // Performance metrics
  avg_time_to_reko_minutes: number;
  avg_time_to_disposition_minutes: number;
  avg_total_duration_minutes: number;

  // Metadata
  event_id: string;
  event_name: string;
  calculated_at: string;
}
```

### 2.3 Backend Implementation

**File: `backend/app/api/stats.py`**

```python
"""Dashboard statistics API endpoints."""

from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from uuid import UUID

from ..auth.dependencies import CurrentUser
from ..database import get_db
from ..models import (
    Incident,
    Personnel,
    Vehicle,
    Material,
    Assignment,
    StatusTransition,
    Event,
)
from .. import schemas

router = APIRouter(prefix="/stats", tags=["stats"])

@router.get("/dashboard")
async def get_dashboard_stats(
    current_user: CurrentUser,
    event_id: Optional[UUID] = Query(None, description="Filter by event"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get comprehensive dashboard statistics.

    Returns real-time metrics for incidents, resources, and performance.
    """
    # Get event context
    event = None
    if event_id:
        result = await db.execute(select(Event).where(Event.id == event_id))
        event = result.scalar_one_or_none()

    # === INCIDENT STATS ===

    # Active incidents (not in terminal status)
    active_statuses = ["eingegangen", "reko", "disponiert", "einsatz"]
    active_query = select(func.count(Incident.id)).where(
        Incident.status.in_(active_statuses)
    )
    if event_id:
        active_query = active_query.where(Incident.event_id == event_id)

    result = await db.execute(active_query)
    active_incidents = result.scalar() or 0

    # Incidents by status
    incidents_by_status = {}
    for status in schemas.IncidentStatus:
        query = select(func.count(Incident.id)).where(
            Incident.status == status.value
        )
        if event_id:
            query = query.where(Incident.event_id == event_id)

        result = await db.execute(query)
        incidents_by_status[status.value] = result.scalar() or 0

    # Incidents created today
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_query = select(func.count(Incident.id)).where(
        Incident.created_at >= today_start
    )
    if event_id:
        today_query = today_query.where(Incident.event_id == event_id)

    result = await db.execute(today_query)
    incidents_today = result.scalar() or 0

    # === PERSONNEL STATS ===

    # Total personnel
    personnel_query = select(func.count(Personnel.id))
    result = await db.execute(personnel_query)
    total_personnel = result.scalar() or 0

    # Checked in
    checked_in_query = select(func.count(Personnel.id)).where(
        Personnel.checked_in == True
    )
    result = await db.execute(checked_in_query)
    checked_in_count = result.scalar() or 0

    # Currently assigned (have active assignments)
    assigned_personnel_query = select(func.count(func.distinct(Assignment.resource_id))).where(
        and_(
            Assignment.resource_type == "personnel",
            Assignment.unassigned_at.is_(None),
        )
    )
    if event_id:
        # Filter assignments by incidents in this event
        assigned_personnel_query = assigned_personnel_query.join(
            Incident, Incident.id == Assignment.incident_id
        ).where(Incident.event_id == event_id)

    result = await db.execute(assigned_personnel_query)
    assigned_personnel = result.scalar() or 0

    available_personnel = checked_in_count - assigned_personnel

    # === VEHICLE STATS ===

    # Total vehicles
    vehicle_query = select(func.count(Vehicle.id))
    result = await db.execute(vehicle_query)
    total_vehicles = result.scalar() or 0

    # Available vehicles
    available_vehicle_query = select(func.count(Vehicle.id)).where(
        Vehicle.status == "available"
    )
    result = await db.execute(available_vehicle_query)
    available_vehicles = result.scalar() or 0

    # Assigned vehicles
    assigned_vehicle_query = select(func.count(func.distinct(Assignment.resource_id))).where(
        and_(
            Assignment.resource_type == "vehicle",
            Assignment.unassigned_at.is_(None),
        )
    )
    if event_id:
        assigned_vehicle_query = assigned_vehicle_query.join(
            Incident, Incident.id == Assignment.incident_id
        ).where(Incident.event_id == event_id)

    result = await db.execute(assigned_vehicle_query)
    assigned_vehicles = result.scalar() or 0

    # Maintenance vehicles
    maintenance_query = select(func.count(Vehicle.id)).where(
        Vehicle.status == "maintenance"
    )
    result = await db.execute(maintenance_query)
    maintenance_vehicles = result.scalar() or 0

    # === MATERIAL STATS ===

    # Total materials
    material_query = select(func.count(Material.id))
    result = await db.execute(material_query)
    total_materials = result.scalar() or 0

    # Available materials
    available_material_query = select(func.count(Material.id)).where(
        Material.status == "available"
    )
    result = await db.execute(available_material_query)
    available_materials = result.scalar() or 0

    # Assigned materials
    assigned_material_query = select(func.count(func.distinct(Assignment.resource_id))).where(
        and_(
            Assignment.resource_type == "material",
            Assignment.unassigned_at.is_(None),
        )
    )
    if event_id:
        assigned_material_query = assigned_material_query.join(
            Incident, Incident.id == Assignment.incident_id
        ).where(Incident.event_id == event_id)

    result = await db.execute(assigned_material_query)
    assigned_materials = result.scalar() or 0

    # === PERFORMANCE METRICS ===

    # Average time to reko (eingegangen → reko)
    avg_time_to_reko = await _calculate_avg_status_transition_time(
        db, "eingegangen", "reko", event_id
    )

    # Average time to disposition (reko → disponiert)
    avg_time_to_disposition = await _calculate_avg_status_transition_time(
        db, "reko", "disponiert", event_id
    )

    # Average total duration (created → completed)
    avg_duration_query = select(
        func.avg(
            func.extract('epoch', Incident.completed_at - Incident.created_at) / 60
        )
    ).where(Incident.completed_at.isnot(None))
    if event_id:
        avg_duration_query = avg_duration_query.where(Incident.event_id == event_id)

    result = await db.execute(avg_duration_query)
    avg_total_duration = result.scalar() or 0

    # Return comprehensive stats
    return {
        # Incidents
        "active_incidents": active_incidents,
        "incidents_by_status": incidents_by_status,
        "incidents_today": incidents_today,
        "average_duration_minutes": round(avg_total_duration, 1),

        # Personnel
        "total_personnel": total_personnel,
        "checked_in_count": checked_in_count,
        "assigned_count": assigned_personnel,
        "available_count": available_personnel,

        # Vehicles
        "total_vehicles": total_vehicles,
        "available_vehicles": available_vehicles,
        "assigned_vehicles": assigned_vehicles,
        "maintenance_vehicles": maintenance_vehicles,

        # Materials
        "total_materials": total_materials,
        "available_materials": available_materials,
        "assigned_materials": assigned_materials,

        # Performance
        "avg_time_to_reko_minutes": round(avg_time_to_reko, 1),
        "avg_time_to_disposition_minutes": round(avg_time_to_disposition, 1),
        "avg_total_duration_minutes": round(avg_total_duration, 1),

        # Metadata
        "event_id": str(event_id) if event_id else None,
        "event_name": event.name if event else None,
        "calculated_at": datetime.utcnow().isoformat(),
    }


async def _calculate_avg_status_transition_time(
    db: AsyncSession,
    from_status: str,
    to_status: str,
    event_id: Optional[UUID],
) -> float:
    """
    Calculate average time between two status transitions.

    Returns average time in minutes.
    """
    # Get all status transitions matching criteria
    query = select(StatusTransition).where(
        and_(
            StatusTransition.from_status == from_status,
            StatusTransition.to_status == to_status,
        )
    )

    if event_id:
        query = query.join(Incident).where(Incident.event_id == event_id)

    result = await db.execute(query)
    transitions = result.scalars().all()

    if not transitions:
        return 0.0

    # For each incident, find the "from" transition and calculate time delta
    total_seconds = 0
    count = 0

    for transition in transitions:
        incident_id = transition.incident_id

        # Get the previous status transition (from_status)
        prev_query = select(StatusTransition).where(
            and_(
                StatusTransition.incident_id == incident_id,
                StatusTransition.to_status == from_status,
                StatusTransition.timestamp < transition.timestamp,
            )
        ).order_by(StatusTransition.timestamp.desc()).limit(1)

        prev_result = await db.execute(prev_query)
        prev_transition = prev_result.scalar_one_or_none()

        if prev_transition:
            delta = (transition.timestamp - prev_transition.timestamp).total_seconds()
            total_seconds += delta
            count += 1

    if count == 0:
        return 0.0

    return total_seconds / count / 60  # Convert to minutes
```

### 2.4 Frontend Implementation

**File: `frontend/components/dashboard-stats.tsx`**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { useEvent } from '@/lib/contexts/event-context';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { AlertCircle, Users, Truck, Wrench, Clock, TrendingUp } from 'lucide-react';

interface DashboardStats {
  active_incidents: number;
  incidents_today: number;
  total_personnel: number;
  checked_in_count: number;
  assigned_count: number;
  available_count: number;
  total_vehicles: number;
  available_vehicles: number;
  total_materials: number;
  available_materials: number;
  avg_time_to_reko_minutes: number;
  calculated_at: string;
}

export function DashboardStats() {
  const { selectedEvent } = useEvent();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch stats on mount and every 10 seconds
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await apiClient.getDashboardStats(selectedEvent?.id);
        setStats(data);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000); // Refresh every 10s

    return () => clearInterval(interval);
  }, [selectedEvent]);

  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="p-6 animate-pulse">
            <div className="h-16 bg-muted rounded" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Active Incidents */}
        <StatCard
          icon={<AlertCircle className="h-6 w-6" />}
          label="Aktive Einsätze"
          value={stats.active_incidents}
          color="red"
        />

        {/* Personnel */}
        <StatCard
          icon={<Users className="h-6 w-6" />}
          label="Personal"
          value={`${stats.checked_in_count} / ${stats.total_personnel}`}
          subtitle="eingecheckt"
          color="blue"
        />

        {/* Vehicles */}
        <StatCard
          icon={<Truck className="h-6 w-6" />}
          label="Fahrzeuge"
          value={`${stats.available_vehicles} / ${stats.total_vehicles}`}
          subtitle="verfügbar"
          color="green"
        />

        {/* Materials */}
        <StatCard
          icon={<Wrench className="h-6 w-6" />}
          label="Material"
          value={`${stats.available_materials} / ${stats.total_materials}`}
          subtitle="verfügbar"
          color="yellow"
        />

        {/* Avg Time to Reko */}
        <StatCard
          icon={<Clock className="h-6 w-6" />}
          label="Ø Zeit Reko"
          value={`${stats.avg_time_to_reko_minutes.toFixed(1)} min`}
          color="purple"
        />

        {/* Today's Activity */}
        <StatCard
          icon={<TrendingUp className="h-6 w-6" />}
          label="Heute"
          value={stats.incidents_today}
          subtitle="Einsätze"
          color="indigo"
        />
      </div>

      {/* Last updated timestamp */}
      <div className="text-xs text-muted-foreground text-right">
        Aktualisiert: {new Date(stats.calculated_at).toLocaleTimeString('de-DE')}
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
  color: 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'indigo';
}

function StatCard({ icon, label, value, subtitle, color }: StatCardProps) {
  const colorClasses = {
    red: 'text-red-600 bg-red-50',
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    yellow: 'text-yellow-600 bg-yellow-50',
    purple: 'text-purple-600 bg-purple-50',
    indigo: 'text-indigo-600 bg-indigo-50',
  };

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </Card>
  );
}
```

**Add to main dashboard page:**

```typescript
// frontend/app/page.tsx

import { DashboardStats } from '@/components/dashboard-stats';

export default function DashboardPage() {
  return (
    <div>
      <DashboardStats />
      {/* Rest of dashboard content */}
    </div>
  );
}
```

---

## 3. Implementation Checklist

### Phase 1: Backend (1-2 hours)
- [ ] Create `backend/app/api/stats.py`
- [ ] Implement `get_dashboard_stats()` endpoint
- [ ] Add helper functions for time calculations
- [ ] Register stats router in `main.py`
- [ ] Test stats calculations with sample data

### Phase 2: Frontend (1-2 hours)
- [ ] Create `frontend/components/dashboard-stats.tsx`
- [ ] Add `getDashboardStats()` to API client
- [ ] Implement StatCard component
- [ ] Add auto-refresh every 10 seconds
- [ ] Add to main dashboard page

---

## 4. Future Enhancements

### 4.1 Trend Charts
Add sparkline charts showing trends over time:

```typescript
<SparklineChart
  data={last24HoursIncidents}
  label="24h Einsätze"
/>
```

### 4.2 Drill-Down
Click stat cards to filter/navigate:

```typescript
<StatCard
  onClick={() => router.push('/incidents?status=active')}
  clickable
/>
```

### 4.3 Custom Metrics
Allow admins to configure which metrics to display.

---

## Acceptance Criteria

✅ **Must Have:**
- [ ] Display active incidents count
- [ ] Display personnel check-in status
- [ ] Display vehicle availability
- [ ] Display material availability
- [ ] Auto-refresh every 10 seconds
- [ ] Calculate based on selected event

🎯 **Should Have:**
- [ ] Average response time metrics
- [ ] Today's incident count
- [ ] Color-coded stat cards
- [ ] Loading skeleton states

💡 **Nice to Have:**
- [ ] Trend sparklines
- [ ] Clickable stats for drill-down
- [ ] Historical comparison
- [ ] Customizable metrics

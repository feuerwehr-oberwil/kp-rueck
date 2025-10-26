# Remaining Task Specifications - Detailed Outlines

**Date**: 2025-10-26
**Status**: Ready for full implementation specification
**Note**: These are detailed outlines. Each can be expanded to full specification format like Task 9.1 upon request.

---

## Task 10.1: Bidirectional Railway ↔ Local Sync

**Phase**: 10 - Reliability & Sync
**Priority**: P2
**Estimated Time**: 16-20 hours
**Complexity**: High

### Overview
Implement bidirectional synchronization between Railway (production) and Local (Docker) deployments. Enables seamless failover to local instance during Railway outages with manual sync back when Railway recovers.

### Key Requirements (from questionnaire)
- **Sync Interval**: Time-based every 2 minutes (configurable in settings)
- **Event-based Sync**: Additional sync on incident/event creation (even if time interval not reached)
- **Sync Direction**:
  - Normally: Railway → Local (one-way, periodic)
  - During outage: Local becomes source of truth
  - On recovery: Manual sync Local → Railway (with confirmation notification)
- **Conflict Resolution**: Last-write-wins by timestamp; if timestamps within 5 seconds, Local wins
- **Data Scope**: Incidents, Personnel, Vehicles, Materials, Settings (NO photos, NO audit logs)
- **UI Indicators**:
  - Sync status badge (green=synced, yellow=syncing, red=offline)
  - Sync direction arrows (↓ from Railway, ↑ to Railway)
  - Last sync timestamp
  - Warnings when data stale (>5 min since last sync)
- **Recovery Flow**: When Railway comes back → Show notification "Railway is back online, sync now?" → User clicks to push Local changes

### Implementation Components

#### 1. Backend - Sync Service
**File**: `backend/app/services/sync_service.py`

```python
"""Bidirectional sync service for Railway ↔ Local."""

class SyncService:
    async def check_railway_health() -> bool:
        """Check if Railway is reachable."""

    async def sync_from_railway(db: AsyncSession) -> SyncResult:
        """Pull changes from Railway to Local."""
        # Compare updated_at timestamps
        # Download newer records
        # Update local database

    async def sync_to_railway(db: AsyncSession) -> SyncResult:
        """Push Local changes to Railway."""
        # Compare updated_at timestamps
        # Conflict resolution (last-write-wins with 5s buffer for Local)
        # Upload newer records

    async def get_sync_delta(source_url, last_sync_time) -> Delta:
        """Get records changed since last sync."""

    async def apply_delta(db, delta, conflict_strategy) -> ApplyResult:
        """Apply delta with conflict resolution."""
```

#### 2. Database Schema Addition
```sql
-- Add updated_at to all syncable tables (if not exists)
ALTER TABLE incidents ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE personnel ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE vehicles ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE materials ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE settings ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();

-- Sync tracking table
CREATE TABLE sync_log (
    id UUID PRIMARY KEY,
    sync_direction VARCHAR(10), -- 'from_railway', 'to_railway'
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    status VARCHAR(20), -- 'success', 'failed', 'partial'
    records_synced JSONB, -- {"incidents": 5, "personnel": 2, ...}
    errors JSONB
);
```

#### 3. Backend - API Endpoints
**File**: `backend/app/api/sync.py`

```python
@router.post("/sync/from-railway")
async def sync_from_railway_endpoint():
    """Trigger manual sync FROM Railway."""

@router.post("/sync/to-railway")
async def sync_to_railway_endpoint():
    """Trigger manual sync TO Railway (recovery)."""

@router.get("/sync/status")
async def get_sync_status():
    """Get current sync status."""
    return {
        "last_sync": "2025-10-26T14:23:00Z",
        "direction": "from_railway",
        "railway_healthy": True,
        "is_syncing": False,
        "records_pending": 0
    }
```

#### 4. Background Sync Task
**File**: `backend/app/background/sync_scheduler.py`

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler

async def scheduled_sync():
    """Run periodic sync from Railway."""
    if await check_railway_health():
        await sync_from_railway(db)

scheduler = AsyncIOScheduler()
scheduler.add_job(
    scheduled_sync,
    'interval',
    minutes=2,  # From settings
    id='railway_sync'
)
```

#### 5. Frontend - Sync Status Indicator
**File**: `frontend/components/sync-status.tsx`

```typescript
export function SyncStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  // Poll /api/sync/status every 10s

  return (
    <div className="flex items-center gap-2">
      {status?.is_syncing && <Loader className="animate-spin" />}
      {!status?.railway_healthy && <AlertTriangle className="text-red-500" />}

      <span className="text-sm">
        {status?.direction === 'from_railway' ? '↓' : '↑'}
        Sync: {formatDistanceToNow(status?.last_sync)}
      </span>

      {!status?.railway_healthy && (
        <Button size="sm" onClick={handleSyncToRailway}>
          Sync to Railway
        </Button>
      )}
    </div>
  );
}
```

#### 6. Event-Based Sync Hook
**File**: `frontend/lib/hooks/use-auto-sync.tsx`

```typescript
// Trigger sync when creating incidents/events
export function useAutoSync() {
  const triggerSync = async () => {
    await fetch('/api/sync/trigger-immediate', { method: 'POST' });
  };

  return { triggerSync };
}
```

### Testing Requirements
- Sync delta detection works correctly
- Conflict resolution with 5s timestamp buffer
- Railway health check detects outages
- Manual sync to Railway after recovery
- UI updates during sync operations
- Event-based sync triggers on incident creation

### Acceptance Criteria
- [ ] Sync runs every 2 minutes (configurable)
- [ ] Event-based sync on incident/event creation
- [ ] Sync direction indicator shows ↓/↑
- [ ] Last sync timestamp visible in UI
- [ ] Railway health check every 30s
- [ ] Notification on Railway recovery
- [ ] Manual "Sync to Railway" button works
- [ ] Conflict resolution: last-write-wins + 5s buffer for Local
- [ ] Syncs: incidents, personnel, vehicles, materials, settings
- [ ] Does NOT sync: photos, audit logs
- [ ] Warning shown if data stale (>5 min)
- [ ] Audit log records all sync operations

---

## Task 11.1: Dashboard Notification System

**Phase**: 11 - Operations Enhancement
**Priority**: P3
**Estimated Time**: 14-18 hours
**Complexity**: Medium-High

### Overview
Comprehensive notification system for alerting editors about time-based delays, resource constraints, and data quality issues. Includes configurable thresholds for Training vs Live modes, toast notifications, sidebar panel, and audio alerts for critical issues.

### Key Requirements (from questionnaire)

#### Alert Types & Thresholds

**Time-Based Alerts** (separate for Training/Live):
| Alert Type | Live Threshold | Training Threshold |
|------------|----------------|-------------------|
| Card in "Eingegangen" | 60 min | 90 min |
| Card in "Reko" | 60 min | 90 min |
| Card in "Disponiert/Unterwegs" | 20 min | 30 min |
| Card in "Einsatz" | 2 hours | 3 hours |
| Card in "Einsatz beendet/Rückfahrt" | 20 min | 30 min |
| Card not archived after completion | 1 hour | 2 hours |

**Resource Alerts**:
- All personnel assigned (none available)
- Critical materials depleted (below threshold per material type)
- Personnel assigned >4 hours (fatigue warning)

**Data Quality Alerts**:
- Incident missing geocoded location
- Incident missing assigned personnel (only in "Einsatz" status)
- Incident missing assigned vehicle (only in "Disponiert" status)

**Event Alerts**:
- Event approaching data size limits (5GB database OR 5GB photos)

#### UI/UX
- **Toast Notifications**: Bottom-right corner for new alerts
- **Notification Sidebar**: macOS-style panel with historical list
- **Audio Alerts**: For critical severity only
- **Persistence**:
  - Critical alerts: Manual dismiss only
  - Warning/Info: Auto-dismiss normal toasts, but keep in history
- **Grouping**: Individual notifications (no grouping)

#### Severity Levels
- **Critical**: No more resources available (red, audio alert)
- **Warning**: Time overdue (yellow, toast)
- **Info**: Everything else (blue, badge)

### Implementation Components

#### 1. Backend - Notification Service
**File**: `backend/app/services/notification_service.py`

```python
"""Notification evaluation and management."""

async def evaluate_notifications(db: AsyncSession, event_id: UUID) -> list[Notification]:
    """Evaluate all notification rules for current event."""
    notifications = []

    # Time-based checks
    incidents = await get_active_incidents(db, event_id)
    settings = await get_notification_settings(db)
    is_training = await is_training_event(db, event_id)

    for incident in incidents:
        duration_in_status = now() - incident.status_updated_at
        threshold = settings.get_threshold(incident.status, is_training)

        if duration_in_status > threshold:
            notifications.append(Notification(
                type="time_overdue",
                severity="warning",
                incident_id=incident.id,
                message=f"{incident.title} in {incident.status} for {duration_in_status}",
            ))

    # Resource checks
    available_personnel = await count_available_personnel(db)
    if available_personnel == 0:
        notifications.append(Notification(
            type="no_personnel",
            severity="critical",
            message="Kein Personal mehr verfügbar",
        ))

    # ... more checks

    return notifications
```

#### 2. Backend - Settings Schema
```python
class NotificationSettings(BaseModel):
    """Notification threshold settings."""
    # Time thresholds (in minutes/hours)
    live_eingegangen_min: int = 60
    live_reko_min: int = 60
    live_disponiert_min: int = 20
    live_einsatz_hours: int = 2
    live_rueckfahrt_min: int = 20
    live_archive_hours: int = 1

    training_eingegangen_min: int = 90
    training_reko_min: int = 90
    training_disponiert_min: int = 30
    training_einsatz_hours: int = 3
    training_rueckfahrt_min: int = 30
    training_archive_hours: int = 2

    # Resource thresholds
    fatigue_hours: int = 4
    material_depletion_threshold: dict[str, int] = {
        "Atemschutz": 2,
        "Schläuche": 5,
        # ... per type
    }

    # Event size limits
    database_size_limit_gb: int = 5
    photo_size_limit_gb: int = 5

    # Enabled alerts (can toggle individual types)
    enabled_time_alerts: bool = True
    enabled_resource_alerts: bool = True
    enabled_data_quality_alerts: bool = True
    enabled_event_alerts: bool = True
```

#### 3. Backend - API Endpoints
**File**: `backend/app/api/notifications.py`

```python
@router.get("/notifications", response_model=list[Notification])
async def get_current_notifications():
    """Get all active notifications for current event."""

@router.post("/notifications/{notification_id}/dismiss")
async def dismiss_notification():
    """Mark notification as dismissed."""

@router.get("/notifications/settings", response_model=NotificationSettings)
async def get_notification_settings():
    """Get current notification threshold settings."""

@router.patch("/notifications/settings")
async def update_notification_settings():
    """Update notification thresholds (Editor only)."""
```

#### 4. Frontend - Notification Context
**File**: `frontend/lib/contexts/notification-context.tsx`

```typescript
interface Notification {
  id: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  incident_id?: string;
  created_at: Date;
  dismissed: boolean;
}

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Poll for notifications every 10s
  useEffect(() => {
    const interval = setInterval(async () => {
      const newNotifications = await fetchNotifications();

      // Play audio for new critical notifications
      const newCritical = newNotifications.filter(n =>
        n.severity === 'critical' && !notifications.find(old => old.id === n.id)
      );
      if (newCritical.length > 0) {
        audioRef.current?.play();
      }

      setNotifications(newNotifications);
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, dismissNotification }}>
      {children}
      <audio ref={audioRef} src="/alerts/critical.mp3" />
    </NotificationContext.Provider>
  );
}
```

#### 5. Frontend - Toast Notifications
**File**: `frontend/components/notifications/notification-toasts.tsx`

```typescript
// Using sonner or react-hot-toast
export function NotificationToasts() {
  const { notifications } = useNotifications();

  useEffect(() => {
    notifications
      .filter(n => !n.dismissed)
      .forEach(notification => {
        if (notification.severity === 'critical') {
          toast.error(notification.message, { duration: Infinity });
        } else if (notification.severity === 'warning') {
          toast.warning(notification.message, { duration: 5000 });
        } else {
          toast.info(notification.message, { duration: 3000 });
        }
      });
  }, [notifications]);

  return <Toaster position="bottom-right" />;
}
```

#### 6. Frontend - Notification Sidebar
**File**: `frontend/components/notifications/notification-sidebar.tsx`

```typescript
// macOS-style sliding panel
export function NotificationSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const { notifications, dismissNotification } = useNotifications();

  const activeNotifications = notifications.filter(n => !n.dismissed);
  const historicalNotifications = notifications.filter(n => n.dismissed);

  return (
    <>
      <Button onClick={() => setIsOpen(true)} className="relative">
        <Bell className="w-5 h-5" />
        {activeNotifications.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs">
            {activeNotifications.length}
          </span>
        )}
      </Button>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="right" className="w-96">
          <h2>Benachrichtigungen</h2>

          <div className="space-y-4">
            <div>
              <h3>Aktiv</h3>
              {activeNotifications.map(n => (
                <NotificationCard key={n.id} notification={n} onDismiss={dismissNotification} />
              ))}
            </div>

            <div>
              <h3>Verlauf</h3>
              {historicalNotifications.slice(0, 20).map(n => (
                <NotificationCard key={n.id} notification={n} />
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
```

#### 7. Frontend - Settings UI
**File**: `frontend/app/settings/page.tsx` (add section)

```typescript
// Add to settings page
<Card>
  <h2>Benachrichtigungseinstellungen</h2>

  <Tabs value={mode} onValueChange={setMode}>
    <TabsList>
      <TabsTrigger value="live">Live-Modus</TabsTrigger>
      <TabsTrigger value="training">Training-Modus</TabsTrigger>
    </TabsList>

    <TabsContent value="live">
      <div className="space-y-4">
        <div>
          <Label>Eingegangen (Minuten)</Label>
          <Input type="number" value={settings.live_eingegangen_min} />
        </div>
        {/* ... more threshold inputs */}
      </div>
    </TabsContent>

    <TabsContent value="training">
      {/* Same structure with training_* fields */}
    </TabsContent>
  </Tabs>

  <div className="mt-6">
    <Label>Materialbestand-Schwellenwerte</Label>
    {/* Per-type thresholds */}
  </div>
</Card>
```

### Testing Requirements
- Time-based alerts trigger at correct thresholds
- Training vs Live thresholds work separately
- Critical alerts play audio
- Toast auto-dismiss works for warnings/info
- Sidebar shows active + historical notifications
- Settings page updates thresholds correctly
- Material depletion alerts with per-type thresholds

### Acceptance Criteria
- [ ] Time-based alerts with separate Training/Live thresholds
- [ ] Resource alerts (personnel, materials, fatigue)
- [ ] Data quality alerts (location, assignments)
- [ ] Event size limit alerts (5GB database/photos)
- [ ] Toast notifications (bottom-right, severity-based duration)
- [ ] Notification sidebar (macOS-style, active + history)
- [ ] Audio alerts for critical severity
- [ ] Configurable thresholds in settings (Editor-only)
- [ ] Individual notifications (no grouping)
- [ ] Severity levels: Critical (red, audio), Warning (yellow), Info (blue)
- [ ] Manual dismiss for critical, auto-dismiss for others
- [ ] Poll for new notifications every 10s

---

## Task 11.2: Incident Export for Legal/Paper Trail

**Phase**: 11 - Operations Enhancement
**Priority**: P4
**Estimated Time**: 12-16 hours
**Complexity**: Medium

### Overview
Export complete event data to PDF/A and Excel formats for legal compliance and archival. Includes all incidents, timelines, assignments, Reko reports, photos (as ZIP), and audit logs. 5-year retention requirement with PDF/A format for long-term preservation.

### Key Requirements (from questionnaire)
- **Export Formats**: PDF/A (archival) + Excel
- **Export Scope**: Full event (all incidents together, not individual)
- **Export Trigger**: Dedicated "Export" button on event overview page
- **PDF Structure**:
  - Page 1: Cover page with event metadata
  - Page 2-3: Summary table of all incidents
  - Page 4+: Individual incident detailed pages
- **Included Data**:
  - Basic incident fields
  - Timeline (created, status transitions, completed)
  - Assignments (personnel, vehicles, materials) with timestamps
  - Reko reports (if exists)
  - Photos (separate ZIP file)
  - Audit log entries
- **PDF Features**:
  - Signature lines for commander approval
  - Export date and exported-by user
  - No logo/header (keep simple)
- **Legal**: 5-year retention, PDF/A format, no digital signature needed

### Implementation Components

#### 1. Backend - Export Service
**File**: `backend/app/services/export_service.py`

```python
"""Event export service for legal compliance."""
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, Paragraph, PageBreak
from reportlab.lib.styles import getSampleStyleSheet
import openpyxl
from datetime import datetime
import zipfile

async def export_event_pdf(db: AsyncSession, event_id: UUID, user_id: UUID) -> BytesIO:
    """
    Export event to PDF/A format.

    Structure:
    - Cover page with event metadata
    - Summary table of all incidents
    - Individual incident detail pages
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4)
    story = []
    styles = getSampleStyleSheet()

    # Get event data
    event = await get_event(db, event_id)
    incidents = await get_incidents_for_event(db, event_id)

    # Cover Page
    story.append(Paragraph(f"Einsatzbericht: {event.name}", styles['Title']))
    story.append(Paragraph(f"Datum: {event.created_at.strftime('%d.%m.%Y')}", styles['Normal']))
    story.append(Paragraph(f"Anzahl Einsätze: {len(incidents)}", styles['Normal']))
    story.append(Paragraph(f"Exportiert von: {user.name}", styles['Normal']))
    story.append(Paragraph(f"Exportiert am: {datetime.now().strftime('%d.%m.%Y %H:%M')}", styles['Normal']))
    story.append(PageBreak())

    # Summary Table
    story.append(Paragraph("Übersicht aller Einsätze", styles['Heading1']))
    table_data = [["Nr", "Titel", "Typ", "Priorität", "Status", "Erstellt", "Abgeschlossen"]]
    for i, inc in enumerate(incidents, 1):
        table_data.append([
            str(i),
            inc.title,
            inc.type,
            inc.priority,
            inc.status,
            inc.created_at.strftime('%H:%M'),
            inc.completed_at.strftime('%H:%M') if inc.completed_at else '-'
        ])
    table = Table(table_data)
    story.append(table)
    story.append(PageBreak())

    # Individual Incident Pages
    for incident in incidents:
        story.append(Paragraph(f"Einsatz: {incident.title}", styles['Heading1']))

        # Basic Info
        story.append(Paragraph("Grundinformationen", styles['Heading2']))
        story.append(Paragraph(f"Typ: {incident.type}", styles['Normal']))
        story.append(Paragraph(f"Priorität: {incident.priority}", styles['Normal']))
        story.append(Paragraph(f"Adresse: {incident.location_address}", styles['Normal']))

        # Timeline
        story.append(Paragraph("Zeitverlauf", styles['Heading2']))
        transitions = await get_status_transitions(db, incident.id)
        for transition in transitions:
            story.append(Paragraph(
                f"{transition.timestamp.strftime('%H:%M')} - {transition.from_status} → {transition.to_status}",
                styles['Normal']
            ))

        # Assignments
        story.append(Paragraph("Zugewiesene Ressourcen", styles['Heading2']))
        assignments = await get_assignments(db, incident.id)
        for assignment in assignments:
            story.append(Paragraph(
                f"{assignment.resource_type}: {assignment.resource_name} (ab {assignment.assigned_at.strftime('%H:%M')})",
                styles['Normal']
            ))

        # Reko Report
        reko = await get_reko_report(db, incident.id)
        if reko:
            story.append(Paragraph("Reko-Bericht", styles['Heading2']))
            story.append(Paragraph(f"Relevanz: {reko.is_relevant}", styles['Normal']))
            story.append(Paragraph(f"Zusammenfassung: {reko.summary_text}", styles['Normal']))

        # Audit Log
        story.append(Paragraph("Änderungsprotokoll", styles['Heading2']))
        audit_entries = await get_audit_log(db, resource_id=incident.id)
        for entry in audit_entries:
            story.append(Paragraph(
                f"{entry.timestamp.strftime('%H:%M')} - {entry.user.name}: {entry.action_type}",
                styles['Normal']
            ))

        story.append(PageBreak())

    # Signature Page
    story.append(Paragraph("Unterschriften", styles['Heading1']))
    story.append(Paragraph("", styles['Normal']))
    story.append(Paragraph("", styles['Normal']))
    story.append(Paragraph("_" * 40, styles['Normal']))
    story.append(Paragraph("Einsatzleiter", styles['Normal']))

    doc.build(story)
    buffer.seek(0)
    return buffer

async def export_event_excel(db: AsyncSession, event_id: UUID) -> BytesIO:
    """Export event to Excel format (same data as PDF)."""
    wb = Workbook()
    wb.remove(wb.active)

    # Event Overview sheet
    ws_overview = wb.create_sheet("Übersicht")
    # ... similar structure to PDF

    # Incidents sheet
    ws_incidents = wb.create_sheet("Einsätze")
    # ... detailed incident data

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer

async def export_event_photos(db: AsyncSession, event_id: UUID) -> BytesIO:
    """Create ZIP file with all photos from event incidents."""
    buffer = BytesIO()

    with zipfile.ZipFile(buffer, 'w') as zf:
        incidents = await get_incidents_for_event(db, event_id)

        for incident in incidents:
            reko = await get_reko_report(db, incident.id)
            if reko and reko.photos_json:
                for photo in reko.photos_json:
                    photo_path = f"photos/{photo['filename']}"
                    if os.path.exists(photo_path):
                        zf.write(photo_path, arcname=f"{incident.title}/{photo['filename']}")

    buffer.seek(0)
    return buffer
```

#### 2. Backend - API Endpoints
**File**: `backend/app/api/exports.py`

```python
@router.post("/events/{event_id}/export")
async def export_event(
    event_id: UUID,
    current_user: CurrentEditor = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """
    Export complete event as PDF + Excel + Photos ZIP.
    Returns a single ZIP file containing all three.
    """
    # Generate exports
    pdf_buffer = await export_event_pdf(db, event_id, current_user.id)
    excel_buffer = await export_event_excel(db, event_id)
    photos_buffer = await export_event_photos(db, event_id)

    # Combine into single ZIP
    combined_buffer = BytesIO()
    with zipfile.ZipFile(combined_buffer, 'w') as zf:
        zf.writestr("bericht.pdf", pdf_buffer.getvalue())
        zf.writestr("daten.xlsx", excel_buffer.getvalue())
        zf.writestr("fotos.zip", photos_buffer.getvalue())

    combined_buffer.seek(0)

    # Audit log
    await log_action(db, current_user.id, "export", "event", event_id, {})
    await db.commit()

    event = await get_event(db, event_id)
    filename = f"export_{event.name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"

    return StreamingResponse(
        combined_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
```

#### 3. Frontend - Export Button
**File**: `frontend/app/events/page.tsx` (add to event overview)

```typescript
function EventExportButton({ eventId }: { eventId: string }) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await fetch(`/api/events/${eventId}/export`, {
        method: 'POST',
        credentials: 'include',
      });

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `event_export_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('Export erfolgreich heruntergeladen');
    } catch (error) {
      toast.error('Export fehlgeschlagen');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button onClick={handleExport} disabled={exporting}>
      <Download className="w-4 h-4 mr-2" />
      {exporting ? 'Exportiere...' : 'Event exportieren'}
    </Button>
  );
}
```

### Testing Requirements
- PDF generation includes all sections
- PDF/A format validation
- Excel export contains same data as PDF
- Photos ZIP includes all Reko photos
- Combined ZIP contains all three files
- Signature lines appear on last page
- Export metadata (date, user) correct
- Audit log records export

### Acceptance Criteria
- [ ] Export formats: PDF/A + Excel + Photos ZIP
- [ ] Export scope: Full event (all incidents)
- [ ] PDF structure: Cover → Summary table → Individual pages
- [ ] Includes: Basic fields, timeline, assignments, Reko, audit log
- [ ] Photos in separate ZIP file
- [ ] Signature lines for commander
- [ ] Export metadata (date, exported-by user)
- [ ] PDF/A format for 5-year retention
- [ ] Export button on event overview page
- [ ] Audit log records all exports
- [ ] Editor-only access

---

## Task 12.1: Quick Stats Dashboard Widget

**Phase**: 12 - Quality & Performance
**Priority**: P5 (Additional Feature)
**Estimated Time**: 4-6 hours
**Complexity**: Low

### Overview
Display real-time statistics widget on events page showing active incidents count by status, personnel availability, average incident duration, and resource utilization percentage.

### Key Requirements
- Display on events page (below event selector)
- Metrics:
  - Active incidents count by status
  - Personnel availability (X/Y available)
  - Average incident duration
  - Resource utilization percentage
- Updates automatically (uses polling context)

### Implementation Components

#### 1. Backend - Stats API
**File**: `backend/app/api/stats.py`

```python
@router.get("/events/{event_id}/stats", response_model=EventStats)
async def get_event_stats(event_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get real-time stats for event."""
    incidents = await get_active_incidents(db, event_id)

    # Count by status
    status_counts = {}
    for status in INCIDENT_STATUSES:
        status_counts[status] = len([i for i in incidents if i.status == status])

    # Personnel availability
    all_personnel = await db.execute(select(Personnel))
    personnel = all_personnel.scalars().all()
    available = len([p for p in personnel if p.availability_status == "available"])
    total = len(personnel)

    # Average duration (eingegangen → abgeschlossen)
    completed = [i for i in incidents if i.completed_at]
    if completed:
        durations = [(i.completed_at - i.created_at).total_seconds() for i in completed]
        avg_duration_sec = sum(durations) / len(durations)
    else:
        avg_duration_sec = 0

    # Resource utilization
    assigned_personnel = len([p for p in personnel if p.availability_status == "assigned"])
    utilization = (assigned_personnel / total * 100) if total > 0 else 0

    return {
        "status_counts": status_counts,
        "personnel_available": available,
        "personnel_total": total,
        "avg_duration_minutes": int(avg_duration_sec / 60),
        "resource_utilization_percent": round(utilization, 1),
    }
```

#### 2. Frontend - Stats Widget
**File**: `frontend/components/stats-widget.tsx`

```typescript
export function StatsWidget({ eventId }: { eventId: string }) {
  const [stats, setStats] = useState<EventStats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      const response = await fetch(`/api/events/${eventId}/stats`);
      const data = await response.json();
      setStats(data);
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000); // Update every 10s

    return () => clearInterval(interval);
  }, [eventId]);

  if (!stats) return null;

  return (
    <Card className="p-4">
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Aktive Einsätze"
          value={Object.values(stats.status_counts).reduce((a, b) => a + b, 0)}
          icon={<Activity />}
        />
        <StatCard
          label="Personal verfügbar"
          value={`${stats.personnel_available}/${stats.personnel_total}`}
          icon={<Users />}
        />
        <StatCard
          label="Ø Dauer"
          value={`${stats.avg_duration_minutes} min`}
          icon={<Clock />}
        />
        <StatCard
          label="Auslastung"
          value={`${stats.resource_utilization_percent}%`}
          icon={<TrendingUp />}
        />
      </div>

      <div className="mt-4">
        <h4 className="text-sm font-medium mb-2">Status-Verteilung</h4>
        <div className="flex gap-2">
          {Object.entries(stats.status_counts).map(([status, count]) => (
            <Badge key={status} variant="outline">
              {status}: {count}
            </Badge>
          ))}
        </div>
      </div>
    </Card>
  );
}
```

### Acceptance Criteria
- [ ] Displays on events page
- [ ] Shows active incidents by status
- [ ] Shows personnel availability (X/Y)
- [ ] Shows average incident duration
- [ ] Shows resource utilization %
- [ ] Updates every 10 seconds
- [ ] Clean, compact design

---

Due to length constraints, I'll create the remaining 3 task specifications (12.2, 13.1, 14.1) in separate files. Would you like me to continue with those now, or would you prefer to review what I've created so far?

**Summary of what's been outlined so far**:
- ✅ Task 9.1: Excel Import/Export (FULL SPEC)
- ✅ Task 10.1: Bidirectional Sync (DETAILED OUTLINE)
- ✅ Task 11.1: Notification System (DETAILED OUTLINE)
- ✅ Task 11.2: Incident Export (DETAILED OUTLINE)
- ✅ Task 12.1: Stats Dashboard (DETAILED OUTLINE)

**Remaining**:
- Task 12.2: Codebase Review & Performance
- Task 13.1: Help Documentation
- Task 14.1: Divera GPS Template (Future)

Should I continue creating those 3 remaining task outlines?

## Task 12.2: Codebase Review & Performance Optimization

**Phase**: 12 - Quality & Performance
**Priority**: P5
**Estimated Time**: 10-12 hours
**Complexity**: Medium

### Overview
Comprehensive codebase review focusing on performance bottlenecks, code quality/technical debt, missing error handling, and mobile responsiveness gaps. Implements improvements across frontend and backend based on identified issues.

### Key Requirements (from questionnaire)
**Focus Areas (Priority Order)**:
1. Performance bottlenecks
2. Code quality/technical debt
3. Missing error handling
4. Mobile responsiveness gaps

**NOT in scope** (per questionnaire):
- Security vulnerabilities (not a priority)
- Accessibility (a11y) issues (not a priority)

### Review Checklist

#### 1. Performance Bottlenecks
**Backend**:
- [ ] Database query optimization (N+1 queries, missing indexes)
- [ ] API response times (target <200ms)
- [ ] Polling endpoint efficiency
- [ ] Unnecessary data fetching
- [ ] Database connection pooling

**Frontend**:
- [ ] React rendering performance (unnecessary re-renders)
- [ ] Bundle size optimization
- [ ] Image optimization
- [ ] Code splitting effectiveness
- [ ] Polling efficiency (avoid duplicate requests)

#### 2. Code Quality / Technical Debt
- [ ] Duplicate code removal
- [ ] Inconsistent naming conventions
- [ ] Missing type annotations (TypeScript/Python)
- [ ] Dead code elimination
- [ ] Component/function size (break down large functions)
- [ ] Inconsistent error handling patterns

#### 3. Missing Error Handling
**Backend**:
- [ ] Database transaction rollbacks
- [ ] API endpoint error responses (proper HTTP status codes)
- [ ] Validation error messages
- [ ] External API failures (geocoding, webhooks)
- [ ] File operation errors

**Frontend**:
- [ ] API call error handling
- [ ] Form validation errors
- [ ] Network failure recovery
- [ ] Toast/user-facing error messages
- [ ] Loading/error states

#### 4. Mobile Responsiveness Gaps
- [ ] Kanban board on mobile (<768px)
- [ ] Map view touch interactions
- [ ] Modal/dialog sizing on small screens
- [ ] Form layouts on mobile
- [ ] Navigation on mobile
- [ ] Touch target sizes (min 44x44px)

### Implementation Plan

#### Phase 1: Analysis (2-3 hours)
1. Run performance profiling:
   - Frontend: React DevTools Profiler
   - Backend: Python profiler on API endpoints
   - Database: `EXPLAIN ANALYZE` on slow queries
2. Code quality analysis:
   - Run linters (ruff, eslint) with strict mode
   - Identify duplicate code patterns
   - List TODO/FIXME comments
3. Error handling audit:
   - List all try/catch blocks
   - Check API endpoints for error responses
   - Review form validation
4. Mobile testing:
   - Test on real devices (iOS/Android)
   - Browser DevTools responsive mode
   - Note all layout issues

#### Phase 2: Performance Optimization (4-5 hours)

**Backend Optimizations**:
```python
# File: backend/app/api/incidents.py

# BEFORE: N+1 query problem
@router.get("/incidents")
async def get_incidents(event_id: UUID):
    incidents = await db.execute(select(Incident).where(Incident.event_id == event_id))
    for inc in incidents:
        inc.assignments = await get_assignments(inc.id)  # N+1!

# AFTER: Eager loading
@router.get("/incidents")
async def get_incidents(event_id: UUID):
    incidents = await db.execute(
        select(Incident)
        .options(selectinload(Incident.assignments))  # Load in single query
        .where(Incident.event_id == event_id)
    )
```

**Add Database Indexes**:
```sql
-- Migration: add_performance_indexes
CREATE INDEX idx_incidents_event_id ON incidents(event_id);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_assignments_incident_id ON incident_assignments(incident_id);
CREATE INDEX idx_personnel_availability ON personnel(availability_status);
```

**Frontend Optimizations**:
```typescript
// File: frontend/components/kanban/kanban-board.tsx

// BEFORE: Re-renders entire board on any incident change
export function KanbanBoard() {
  const { incidents } = useIncidents();
  
  return (
    <div>
      {STATUSES.map(status => (
        <StatusColumn key={status} incidents={incidents.filter(i => i.status === status)} />
      ))}
    </div>
  );
}

// AFTER: Memoize columns to prevent unnecessary re-renders
export function KanbanBoard() {
  const { incidents } = useIncidents();
  
  return (
    <div>
      {STATUSES.map(status => (
        <MemoizedStatusColumn 
          key={status} 
          incidents={incidents.filter(i => i.status === status)} 
        />
      ))}
    </div>
  );
}

const MemoizedStatusColumn = React.memo(StatusColumn);
```

#### Phase 3: Error Handling Improvements (2-3 hours)

**Backend Error Handling**:
```python
# File: backend/app/api/common.py

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

class APIException(HTTPException):
    """Base API exception with logging."""
    def __init__(self, status_code: int, detail: str, log_error: bool = True):
        super().__init__(status_code=status_code, detail=detail)
        if log_error:
            logger.error(f"API Error {status_code}: {detail}")

# Use in endpoints:
@router.post("/incidents")
async def create_incident(incident: IncidentCreate, db: AsyncSession):
    try:
        new_incident = Incident(**incident.dict())
        db.add(new_incident)
        await db.commit()
        return new_incident
    except IntegrityError as e:
        await db.rollback()
        raise APIException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incident with this ID already exists"
        )
    except SQLAlchemyError as e:
        await db.rollback()
        raise APIException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error occurred"
        )
```

**Frontend Error Handling**:
```typescript
// File: frontend/lib/api-client.ts

class APIClient {
  private async request<T>(
    endpoint: string, 
    options?: RequestInit
  ): Promise<T> {
    try {
      const response = await fetch(endpoint, options);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new APIError(
          response.status,
          error.detail || 'Request failed'
        );
      }

      return response.json();
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      // Network error
      throw new APIError(0, 'Network error - check your connection');
    }
  }
}

// Use in components:
const handleCreate = async () => {
  try {
    await apiClient.createIncident(data);
    toast.success('Incident created');
  } catch (error) {
    if (error instanceof APIError) {
      toast.error(error.message);
    } else {
      toast.error('An unexpected error occurred');
    }
  }
};
```

#### Phase 4: Mobile Responsiveness (2-3 hours)

**Responsive Kanban Board**:
```typescript
// File: frontend/components/kanban/kanban-board.tsx

export function KanbanBoard() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (isMobile) {
    return <MobileKanbanList />; // Vertical list view
  }

  return <DesktopKanbanBoard />; // Horizontal columns
}
```

**Mobile-Optimized Styles**:
```css
/* File: frontend/app/globals.css */

/* Ensure touch targets are 44x44px minimum */
.btn, .card-action {
  min-height: 44px;
  min-width: 44px;
}

/* Responsive grid */
.kanban-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1rem;
}

@media (max-width: 768px) {
  .kanban-grid {
    grid-template-columns: 1fr;
  }

  .incident-card {
    font-size: 16px; /* Prevent iOS zoom on input focus */
  }
}
```

### Deliverables

1. **Performance Report**:
   - Before/after benchmark metrics
   - Database query optimization summary
   - Frontend bundle size reduction
   - API response time improvements

2. **Code Quality Improvements**:
   - Refactored large functions
   - Removed duplicate code
   - Consistent naming conventions
   - Type safety improvements

3. **Error Handling Audit**:
   - All endpoints have try/catch
   - User-friendly error messages
   - Proper HTTP status codes
   - Error logging

4. **Mobile Responsiveness**:
   - All pages work on 375px width
   - Touch targets >= 44x44px
   - No horizontal scrolling
   - Tested on real devices

### Acceptance Criteria
- [ ] API response times <200ms (95th percentile)
- [ ] No N+1 queries in critical paths
- [ ] Database indexes added for common queries
- [ ] Frontend bundle size <500KB (gzipped)
- [ ] All API endpoints have error handling
- [ ] User-facing error messages for all failures
- [ ] All pages responsive on mobile (<768px)
- [ ] Touch targets minimum 44x44px
- [ ] No TypeScript `any` types (use strict mode)
- [ ] Linters pass with no warnings
- [ ] Performance report documented

---

## Task 13.1: Comprehensive Help Documentation

**Phase**: 13 - Documentation
**Priority**: P6 (Lowest)
**Estimated Time**: 10-12 hours
**Complexity**: Low-Medium

### Overview
Create comprehensive in-app help documentation accessible via `/help` page. Covers getting started, incident workflow, feature guides, best practices, keyboard shortcuts, and event management. German language only, with screenshots, searchable content, and downloadable PDF option.

### Key Requirements (from questionnaire)
- **Topics**: Getting started, workflow explanation, feature guides, best practices, keyboard shortcuts, event management
- **Audience**: Primarily editors (command post operators)
- **Format**: Dedicated `/help` page (replaces current ? button), downloadable as PDF
- **Content Type**: Screenshots, searchable wiki-style organization
- **Language**: German only
- **Storage**: Markdown files in repo (version-controlled)
- **Assumptions**: No firefighting context explanations (users know terminology)

### Content Structure

```
/help
├── Getting Started
│   ├── First Login
│   ├── Interface Overview
│   └── Creating Your First Incident
├── Incident Workflow
│   ├── Status Columns Explained
│   ├── Moving Cards Between Statuses
│   └── When to Archive
├── Features
│   ├── Event Management
│   │   ├── Creating Events
│   │   ├── Switching Between Events
│   │   └── Archiving Events
│   ├── Kanban Board
│   │   ├── Drag and Drop
│   │   ├── Quick Actions
│   │   └── Filtering
│   ├── Map View
│   │   ├── Location Markers
│   │   └── Map Controls
│   ├── Reko Forms
│   │   ├── QR Code Access
│   │   ├── Filling Out Forms
│   │   └── Viewing Submitted Reports
│   └── Personnel Check-In
│       ├── QR Code Generation
│       └── Viewing Check-In Status
├── Best Practices
│   ├── When to Create New Events
│   ├── Assigning Resources Efficiently
│   ├── Handling Multiple Simultaneous Incidents
│   └── End-of-Event Cleanup
└── Keyboard Shortcuts
    ├── Navigation
    ├── Quick Actions
    └── Search
```

### Implementation Components

#### 1. Markdown Content Files
**Directory**: `frontend/content/help/`

**File**: `frontend/content/help/getting-started.md`
```markdown
# Erste Schritte

## Erster Login

1. Öffnen Sie die KP Rück Anwendung im Browser
2. Melden Sie sich mit Ihren Zugangsdaten an
3. Wählen Sie Ihre Rolle (Editor oder Viewer)

## Oberfläche Übersicht

Die Hauptoberfläche besteht aus:

- **Kanban-Board**: Zentrale Ansicht aller Einsätze
- **Karte**: Geografische Übersicht der Einsatzorte
- **Seitenleiste**: Navigation und Einstellungen

![Interface Overview](/help/images/interface-overview.png)

## Ersten Einsatz erstellen

1. Klicken Sie auf "Neuer Einsatz" (+ Symbol)
2. Geben Sie die Einsatzdetails ein:
   - Titel (z.B. "Wohnungsbrand Hauptstrasse 12")
   - Typ (Brandbekämpfung, Strassenrettung, etc.)
   - Priorität (Normal, Hoch, Kritisch)
   - Adresse
3. Klicken Sie "Erstellen"

Der Einsatz erscheint nun in der Spalte "Eingegangen".
```

**File**: `frontend/content/help/workflow.md`
```markdown
# Einsatz-Workflow

## Spalten-Erklärung

### 1. Eingegangen
Neu gemeldete Einsätze, die noch nicht bearbeitet wurden.

**Typische Verweildauer**: <1 Stunde

### 2. Reko
Einsätze, bei denen eine Erkundung (Reko) durchgeführt wird.

**Aktion**: Reko-Team vor Ort sammelt Informationen

### 3. Disponiert / Unterwegs
Ressourcen sind zugewiesen und auf dem Weg zum Einsatzort.

**Benötigte Zuweisungen**: 
- Mindestens 1 Fahrzeug
- Mindestens 1 Person

### 4. Einsatz
Aktive Einsatzphase vor Ort.

**Überwachung**: Achten Sie auf die Einsatzdauer (>2 Stunden = Warnung)

### 5. Einsatz beendet / Rückfahrt
Einsatz abgeschlossen, Rückkehr zur Basis.

### 6. Abschluss / Archiv
Vollständig abgeschlossene Einsätze.

**Aktion**: Einsatz kann exportiert und gelöscht werden.

## Karten verschieben

Ziehen Sie Einsatzkarten mit der Maus zwischen Spalten, um den Status zu ändern.

**Tastaturkürzel**: 
- `→` Rechtspfeil: Status vorwärts
- `←` Linkspfeil: Status rückwärts

## Wann archivieren?

Archivieren Sie einen Einsatz, wenn:
- ✅ Alle Ressourcen zurück sind
- ✅ Reko-Bericht vollständig
- ✅ Dokumentation abgeschlossen
```

#### 2. Help Page Component
**File**: `frontend/app/help/page.tsx`

```typescript
'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Search, Download, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const HELP_TOPICS = [
  { id: 'getting-started', title: 'Erste Schritte', category: 'Einführung' },
  { id: 'workflow', title: 'Einsatz-Workflow', category: 'Einführung' },
  { id: 'event-management', title: 'Event-Verwaltung', category: 'Features' },
  { id: 'kanban', title: 'Kanban-Board', category: 'Features' },
  { id: 'map', title: 'Kartenansicht', category: 'Features' },
  { id: 'reko-forms', title: 'Reko-Formulare', category: 'Features' },
  { id: 'check-in', title: 'Personal Check-In', category: 'Features' },
  { id: 'best-practices', title: 'Best Practices', category: 'Anleitungen' },
  { id: 'keyboard-shortcuts', title: 'Tastaturkürzel', category: 'Referenz' },
];

export default function HelpPage() {
  const [selectedTopic, setSelectedTopic] = useState('getting-started');
  const [searchQuery, setSearchQuery] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    // Load markdown content
    fetch(`/help/content/${selectedTopic}.md`)
      .then(res => res.text())
      .then(setContent);
  }, [selectedTopic]);

  const filteredTopics = HELP_TOPICS.filter(topic =>
    topic.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDownloadPDF = async () => {
    // Convert all help content to PDF
    const response = await fetch('/api/help/export-pdf', {
      method: 'POST',
      credentials: 'include',
    });

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kprueck-hilfe.pdf';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Hilfe & Dokumentation</h1>
        <Button onClick={handleDownloadPDF} variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Als PDF herunterladen
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Sidebar Navigation */}
        <div className="col-span-3">
          <div className="mb-4">
            <Input
              type="search"
              placeholder="Hilfe durchsuchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              icon={<Search />}
            />
          </div>

          <nav className="space-y-1">
            {Object.entries(
              filteredTopics.reduce((acc, topic) => {
                if (!acc[topic.category]) acc[topic.category] = [];
                acc[topic.category].push(topic);
                return acc;
              }, {} as Record<string, typeof HELP_TOPICS>)
            ).map(([category, topics]) => (
              <div key={category} className="mb-4">
                <h3 className="text-sm font-semibold text-gray-500 mb-2">
                  {category}
                </h3>
                {topics.map(topic => (
                  <button
                    key={topic.id}
                    onClick={() => setSelectedTopic(topic.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between ${
                      selectedTopic === topic.id
                        ? 'bg-blue-100 text-blue-900 font-medium'
                        : 'hover:bg-gray-100'
                    }`}
                  >
                    {topic.title}
                    {selectedTopic === topic.id && (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>

        {/* Content Area */}
        <div className="col-span-9">
          <div className="prose prose-blue max-w-none">
            <ReactMarkdown
              components={{
                img: ({ src, alt }) => (
                  <img src={src} alt={alt} className="rounded-lg shadow-md" />
                ),
                code: ({ children }) => (
                  <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                    {children}
                  </code>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
```

#### 3. PDF Export Backend
**File**: `backend/app/api/help.py`

```python
@router.post("/help/export-pdf")
async def export_help_pdf(current_user: CurrentUser = Depends()):
    """Export all help documentation as PDF."""
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, PageBreak
    from reportlab.lib.styles import getSampleStyleSheet
    from markdown import markdown

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4)
    story = []
    styles = getSampleStyleSheet()

    help_dir = Path("frontend/content/help")

    for md_file in sorted(help_dir.glob("*.md")):
        with open(md_file, 'r', encoding='utf-8') as f:
            md_content = f.read()

        # Convert markdown to HTML, then to PDF paragraphs
        html_content = markdown(md_content)
        # ... convert HTML to reportlab elements
        story.append(PageBreak())

    doc.build(story)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=kprueck-hilfe.pdf"}
    )
```

### Content Creation Checklist
- [ ] Getting started guide (with screenshots)
- [ ] Workflow explanation (6 status columns)
- [ ] Event management guide
- [ ] Kanban board features
- [ ] Map view usage
- [ ] Reko forms guide
- [ ] Check-in system guide
- [ ] Best practices document
- [ ] Complete keyboard shortcuts reference
- [ ] All screenshots captured and optimized

### Acceptance Criteria
- [ ] `/help` page accessible from navigation
- [ ] All topics covered (9 main sections)
- [ ] Search functionality works
- [ ] Screenshots included (min 10 images)
- [ ] PDF export generates complete documentation
- [ ] Markdown content version-controlled in repo
- [ ] German language throughout
- [ ] No firefighting terminology explanations
- [ ] Mobile-responsive layout
- [ ] Navigation between topics smooth

---

## Task 14.1: Divera GPS Vehicle Tracking (Future Template)

**Phase**: 14 - Future Enhancements
**Priority**: Future (Post-MVP)
**Estimated Time**: 20-24 hours
**Complexity**: High
**Status**: Template only - implement when Divera rollout complete

### Overview
Integrate with Divera 24/7 API to pull real-time GPS locations of vehicles and display them on the map. Shows vehicle movement, status updates, and location history. **This is a template for future implementation** - not part of current roadmap.

### Prerequisites
- Divera 24/7 subscription with GPS tracking enabled
- Vehicles running Divera app with GPS permissions
- Divera API access credentials
- Divera API documentation available

### Key Requirements
- Real-time vehicle location updates on map
- Vehicle status sync (en route, on scene, returning, available)
- Location history trail (optional)
- Integration with existing incident assignments
- Fallback to manual status if GPS unavailable

### Implementation Approach (High-Level)

#### 1. Divera API Integration
```python
# File: backend/app/services/divera_gps_service.py

class DiveraGPSService:
    async def get_vehicle_locations(self) -> list[VehicleLocation]:
        """Poll Divera API for current vehicle GPS locations."""
        # GET /api/v2/vehicles/locations
        # Returns list of {vehicle_id, lat, lng, timestamp, status}

    async def sync_vehicle_status(self, vehicle_id: str) -> VehicleStatus:
        """Sync vehicle operational status from Divera."""
        # GET /api/v2/vehicles/{id}/status
        # Updates: en_route, on_scene, returning, available

    async def get_location_history(
        self, 
        vehicle_id: str, 
        start_time: datetime, 
        end_time: datetime
    ) -> list[GPSPoint]:
        """Fetch historical GPS trail for vehicle."""
        # For post-incident analysis
```

#### 2. Database Schema
```sql
-- Vehicle GPS location history
CREATE TABLE vehicle_gps_log (
    id UUID PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    timestamp TIMESTAMP,
    speed_kmh DECIMAL(5, 2),
    heading INTEGER,  -- 0-359 degrees
    source VARCHAR(20),  -- 'divera', 'manual'
    INDEX idx_vehicle_timestamp (vehicle_id, timestamp)
);
```

#### 3. Frontend Map Integration
```typescript
// File: frontend/components/map/vehicle-markers.tsx

export function VehicleMarkers() {
  const [vehicleLocations, setVehicleLocations] = useState<VehicleLocation[]>([]);

  useEffect(() => {
    // Poll for vehicle locations every 10s
    const interval = setInterval(async () => {
      const locations = await fetch('/api/vehicles/gps').then(r => r.json());
      setVehicleLocations(locations);
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {vehicleLocations.map(vehicle => (
        <Marker
          key={vehicle.id}
          position={[vehicle.lat, vehicle.lng]}
          icon={getVehicleIcon(vehicle.type, vehicle.status)}
        >
          <Popup>
            <strong>{vehicle.name}</strong><br />
            Status: {vehicle.status}<br />
            Zuletzt: {formatDistanceToNow(vehicle.timestamp)}
          </Popup>
        </Marker>
      ))}
    </>
  );
}
```

### Notes for Future Implementation
1. **Obtain Divera API credentials** before starting
2. **Test API in sandbox environment** first
3. **Verify GPS accuracy** requirements (10m precision sufficient?)
4. **Consider battery impact** of frequent GPS updates
5. **Fallback to manual status** if Divera unavailable
6. **Privacy considerations** - log GPS only during active incidents

### Placeholder Implementation
For now, add a **settings toggle** "Divera GPS (coming soon)" to prepare the UI.

### Acceptance Criteria (When Implemented)
- [ ] Vehicle locations update every 10-30 seconds
- [ ] Map shows moving markers for active vehicles
- [ ] Vehicle status synced with Divera
- [ ] Location history viewable post-incident
- [ ] Graceful degradation if Divera offline
- [ ] Privacy: GPS only logged during active assignments
- [ ] Performance: Map handles 10+ moving vehicles smoothly

---

## Summary

All 8 task specifications are now complete:

1. ✅ **Task 9.1**: Excel Import/Export System (FULL SPEC)
2. ✅ **Task 10.1**: Bidirectional Railway ↔ Local Sync (DETAILED OUTLINE)
3. ✅ **Task 11.1**: Dashboard Notification System (DETAILED OUTLINE)
4. ✅ **Task 11.2**: Incident Export for Legal Trail (DETAILED OUTLINE)
5. ✅ **Task 12.1**: Quick Stats Dashboard Widget (DETAILED OUTLINE)
6. ✅ **Task 12.2**: Codebase Review & Performance Optimization (DETAILED OUTLINE)
7. ✅ **Task 13.1**: Comprehensive Help Documentation (DETAILED OUTLINE)
8. ✅ **Task 14.1**: Divera GPS Vehicle Tracking (FUTURE TEMPLATE)

**Total Estimated Time**: 78-100 hours core features + 20-24h future (Divera GPS)

**Recommended Implementation Order**:
1. Task 9.1: Excel Import/Export (Priority 1)
2. Task 10.1: Bidirectional Sync (Priority 2)
3. Task 11.1: Notifications (Priority 3)
4. Task 11.2: Export (Priority 4)
5. Task 12.1: Stats + Task 12.2: Review (Priority 5)
6. Task 13.1: Documentation (Priority 6)
7. Task 14.1: Divera GPS (Future, when ready)

**Next Steps**:
- Review all task specifications
- Begin implementation with Task 9.1
- Track progress using TodoWrite tool
- Create git worktrees for parallel development if desired


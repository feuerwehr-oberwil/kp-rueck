# Incident Management Frontend Implementation

This document describes the frontend implementation for Task 2.1: Incident CRUD & Status Management.

## Overview

The incident management system replaces the old "operations" terminology with a new "incidents" schema that includes:
- UUID-based identifiers
- Status workflow tracking
- Training mode support
- Optimistic locking for concurrent updates
- Comprehensive status transition history

## Architecture

### 1. API Client (`lib/api-client.ts`)

New types and methods for incident management:

**Types:**
- `IncidentType`: Enum of incident categories (brandbekaempfung, technische_hilfeleistung, etc.)
- `IncidentPriority`: Low, medium, high, critical
- `IncidentStatus`: eingegangen, reko, disponiert, einsatz, einsatz_beendet, abschluss
- `ApiIncident`: Backend incident representation
- `ApiStatusTransition`: Status change history

**API Methods:**
```typescript
// Get all incidents with optional filters
getIncidents(params?: {
  training_only?: boolean
  status?: IncidentStatus
  skip?: number
  limit?: number
}): Promise<ApiIncident[]>

// Get single incident by ID
getIncident(id: string): Promise<ApiIncident>

// Create new incident
createIncident(data: ApiIncidentCreate): Promise<ApiIncident>

// Update incident with optimistic locking
updateIncident(
  id: string,
  data: ApiIncidentUpdate,
  expectedUpdatedAt?: string
): Promise<ApiIncident>

// Update incident status (creates status transition record)
updateIncidentStatus(
  id: string,
  fromStatus: IncidentStatus,
  toStatus: IncidentStatus,
  notes?: string
): Promise<ApiIncident>

// Get status transition history
getIncidentStatusHistory(id: string): Promise<ApiStatusTransition[]>

// Delete incident
deleteIncident(id: string): Promise<void>
```

### 2. TypeScript Types (`lib/types/incidents.ts`)

Frontend types with convenience helpers:

```typescript
// Main incident type with parsed dates and numbers
interface Incident {
  id: string // UUID
  title: string
  type: IncidentType
  priority: IncidentPriority
  location_address: string | null
  location_lat: number | null
  location_lng: number | null
  status: IncidentStatus
  training_flag: boolean
  description: string | null
  created_at: Date
  updated_at: Date
  created_by: string | null
  completed_at: Date | null
}

// Human-readable labels
INCIDENT_TYPE_LABELS: Record<IncidentType, string>
PRIORITY_LABELS: Record<IncidentPriority, string>
STATUS_LABELS: Record<IncidentStatus, string>

// Kanban column configuration
KANBAN_COLUMNS: Array<{
  id: string
  title: string
  status: IncidentStatus[]
  color: string
}>
```

### 3. React Context (`lib/contexts/incidents-context.tsx`)

State management for incidents with automatic API synchronization:

```typescript
const {
  // Data
  incidents,
  personnel,
  materials,
  isLoading,
  error,
  trainingMode,

  // Incident CRUD
  createIncident,
  updateIncident,
  deleteIncident,
  refreshIncidents,

  // Status management
  updateIncidentStatus,
  getStatusHistory,

  // Training mode toggle
  setTrainingMode,
} = useIncidents()
```

**Key Features:**
- Automatic loading from API on mount
- Training mode filtering
- Optimistic locking support with conflict detection
- Error handling and loading states
- Type-safe API conversion

### 4. React Components

#### IncidentCard (`components/incidents/incident-card.tsx`)

Displays a single incident in the Kanban view:

```tsx
<IncidentCard
  incident={incident}
  columnColor="bg-zinc-800/50"
  onEdit={() => handleEdit(incident)}
  isHighlighted={highlightedId === incident.id}
  isDraggable={true}
/>
```

**Features:**
- Training mode indicator
- Priority badge with color coding
- Time since creation
- Location display
- Edit and map view buttons
- Drag-and-drop support (with @atlaskit/pragmatic-drag-and-drop)

#### IncidentForm (`components/incidents/incident-form.tsx`)

Modal form for creating and editing incidents:

```tsx
<IncidentForm
  open={formOpen}
  onOpenChange={setFormOpen}
  incident={selectedIncident}
  mode="create" // or "edit"
/>
```

**Features:**
- Create and edit modes
- Training mode awareness
- Location input with lat/lng fields
- All incident type and priority options
- Form validation
- Automatic saving to backend

#### IncidentsKanban (`components/incidents/incidents-kanban.tsx`)

Full Kanban board view for incident management:

```tsx
<IncidentsKanban />
```

**Features:**
- 6-column Kanban layout (eingegangen → abschluss)
- Training mode toggle
- Live/Übungsmodus switching
- Create new incident button
- Refresh incidents
- Error display
- Responsive layout

## Usage Examples

### Basic Page Setup

```tsx
"use client"

import { IncidentsKanban } from "@/components/incidents/incidents-kanban"

export default function IncidentsPage() {
  return <IncidentsKanban />
}
```

### Custom Integration

```tsx
"use client"

import { useIncidents } from "@/lib/contexts/incidents-context"
import { IncidentCard } from "@/components/incidents/incident-card"
import { IncidentForm } from "@/components/incidents/incident-form"

export default function CustomIncidentsView() {
  const { incidents, createIncident, updateIncident, trainingMode } = useIncidents()
  const [formOpen, setFormOpen] = useState(false)

  // Get only active incidents
  const activeIncidents = incidents.filter(
    (inc) => inc.status === 'einsatz'
  )

  return (
    <div>
      <h1>Aktive Einsätze</h1>

      <button onClick={() => setFormOpen(true)}>
        Neuer Einsatz
      </button>

      <div className="grid grid-cols-3 gap-4">
        {activeIncidents.map((incident) => (
          <IncidentCard
            key={incident.id}
            incident={incident}
            onEdit={() => handleEdit(incident)}
          />
        ))}
      </div>

      <IncidentForm
        open={formOpen}
        onOpenChange={setFormOpen}
        mode="create"
      />
    </div>
  )
}
```

### Status Updates

```tsx
const { updateIncidentStatus } = useIncidents()

// Move incident to next status
await updateIncidentStatus(
  incidentId,
  'disponiert', // from
  'einsatz',    // to
  'Mannschaft vor Ort eingetroffen' // optional notes
)
```

### Training Mode

```tsx
const { trainingMode, setTrainingMode, incidents } = useIncidents()

// Toggle training mode
<button onClick={() => setTrainingMode(!trainingMode)}>
  {trainingMode ? 'Übungsmodus' : 'Live-Modus'}
</button>

// All incidents automatically filter based on training mode
// When trainingMode = true, only incidents with training_flag = true are shown
```

## Key Differences from Operations

| Feature | Old (Operations) | New (Incidents) |
|---------|------------------|-----------------|
| ID Type | Integer | UUID string |
| Location | Single string field | Separate address, lat, lng fields |
| Type | `incidentType` string | `type` enum with predefined values |
| Status Values | incoming, ready, enroute, etc. | eingegangen, reko, disponiert, etc. |
| Training Support | None | `training_flag` boolean field |
| Optimistic Locking | None | `updated_at` timestamp check |
| Status History | None | Full `status_transitions` table |

## Status Workflow

```
eingegangen → reko → disponiert → einsatz → einsatz_beendet → abschluss
```

Each status change:
1. Updates the incident's `status` field
2. Creates a `status_transitions` record
3. Logs to `audit_log`
4. Sets `completed_at` when status reaches `abschluss`

## Optimistic Locking

The system supports optimistic locking to prevent concurrent modification conflicts:

```tsx
try {
  await updateIncident(incidentId, {
    title: "Updated title"
  })
} catch (error) {
  // If error contains '409', a conflict was detected
  // The context automatically refreshes the incident data
  if (error.message.includes('409')) {
    alert('Einsatz wurde bereits geändert. Bitte aktualisieren.')
  }
}
```

The `updated_at` timestamp is automatically sent with updates and checked by the backend.

## Integration with Layout

The `IncidentsProvider` is added to `app/layout.tsx` alongside the existing `OperationsProvider`:

```tsx
<AuthProvider>
  <IncidentsProvider>
    <OperationsProvider>
      {children}
    </OperationsProvider>
  </IncidentsProvider>
</AuthProvider>
```

This allows both systems to coexist during migration.

## Future Enhancements

- [ ] Drag-and-drop status updates (move cards between columns)
- [ ] Real-time updates via WebSocket/polling
- [ ] Personnel and material assignment to incidents
- [ ] Reko (reconnaissance) form integration
- [ ] Map view integration with incident locations
- [ ] Status history timeline visualization
- [ ] Advanced filtering and search
- [ ] Export to PDF/print functionality

## Testing

The implementation includes frontend development server running at http://localhost:3000.

To test:

1. Start backend: `cd backend && uv run uvicorn app.main:app --reload`
2. Start frontend: `cd frontend && pnpm dev`
3. Navigate to a page using `<IncidentsKanban />` component
4. Test CRUD operations, status updates, and training mode toggle

## Backend Endpoints

The frontend expects these endpoints (as defined in Task 2.1):

- `GET /api/incidents` - List incidents
- `GET /api/incidents/{id}` - Get single incident
- `POST /api/incidents` - Create incident
- `PATCH /api/incidents/{id}` - Update incident
- `POST /api/incidents/{id}/status` - Update status
- `GET /api/incidents/{id}/history` - Get status history
- `DELETE /api/incidents/{id}` - Delete incident

## Files Created

```
frontend/
├── lib/
│   ├── api-client.ts (updated)
│   ├── types/
│   │   └── incidents.ts (new)
│   └── contexts/
│       └── incidents-context.tsx (new)
├── components/
│   └── incidents/
│       ├── incident-card.tsx (new)
│       ├── incident-form.tsx (new)
│       └── incidents-kanban.tsx (new)
└── app/
    └── layout.tsx (updated)
```

## Notes

- The old `operations-context.tsx` and related components remain unchanged for backwards compatibility
- Both systems can coexist during gradual migration
- All new code follows Next.js 15 App Router patterns
- Uses shadcn/ui components for consistent styling
- Fully TypeScript type-safe
- Ready for backend integration once Task 2.1 backend is deployed

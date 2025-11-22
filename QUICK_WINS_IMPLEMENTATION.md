# Quick Wins Implementation Guide - Sprint 2

This document provides the necessary changes to integrate all four quick wins into the main Kanban page.

## Files Modified

1. **frontend/components/kanban/draggable-operation.tsx** - COMPLETED
   - Added ResourceStatusBadge component with status icons
   - Added [+] buttons for click-to-assign functionality
   - Shows checkmark/X icons for resource status

2. **frontend/components/kanban/shortcuts-modal.tsx** - COMPLETED
   - Reorganized into categories with icons
   - Added pro tip callout
   - Better visual hierarchy

3. **frontend/components/kanban/droppable-column.tsx** - COMPLETED
   - Added `onAssignResource` prop support

4. **frontend/components/kanban/resource-assignment-dialog.tsx** - CREATED
   - New dialog component for click-to-assign resources
   - Search functionality
   - Toggle assignment with single click

## Changes Needed in frontend/app/page.tsx

### 1. Add Import for UserCheck Icon

```typescript
// Line 10 - Update imports to add UserCheck
import { Search, Plus, Clock, Package, QrCode, Copy, Check, Sparkles, Menu, ClipboardCheck, Truck, UserCheck } from 'lucide-react'
```

### 2. Add Import for ResourceAssignmentDialog

```typescript
// Add after line 33
import { ResourceAssignmentDialog } from "@/components/kanban/resource-assignment-dialog"
```

### 3. Add State Variables (after line 115)

```typescript
  // Resource assignment dialog state
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false)
  const [assignmentResourceType, setAssignmentResourceType] = useState<'crew' | 'vehicles' | 'materials' | null>(null)
  const [assignmentOperationId, setAssignmentOperationId] = useState<string | null>(null)

  // Check-in stats state
  const [checkInStats, setCheckInStats] = useState<{ total: number; checkedIn: number } | null>(null)
```

### 4. Add Check-In Stats Loading Effect (after line 205)

```typescript
  // Load check-in stats
  useEffect(() => {
    const loadCheckInStats = async () => {
      if (!selectedEvent) return

      try {
        const allPersonnel = await apiClient.getAllPersonnel({ event_id: selectedEvent.id })
        const checkedIn = allPersonnel.filter(p => p.checked_in).length
        setCheckInStats({ total: allPersonnel.length, checkedIn })
      } catch (error) {
        console.error('Failed to load check-in stats:', error)
      }
    }

    loadCheckInStats()
    // Refresh stats every 30 seconds
    const interval = setInterval(loadCheckInStats, 30000)
    return () => clearInterval(interval)
  }, [selectedEvent])
```

### 5. Add Resource Assignment Handler (after line 595)

```typescript
  // Handle resource assignment dialog
  const handleOpenAssignmentDialog = (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string) => {
    setAssignmentResourceType(resourceType)
    setAssignmentOperationId(operationId)
    setAssignmentDialogOpen(true)
  }

  // Get assigned resources for selected operation
  const getAssignedResourcesForOperation = (operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) {
      return {
        assignedPersonnel: [],
        assignedVehicles: [],
        assignedMaterials: []
      }
    }

    return {
      assignedPersonnel: operation.crew,
      assignedVehicles: operation.vehicles,
      assignedMaterials: operation.materials
    }
  }

  const assignedResources = assignmentOperationId
    ? getAssignedResourcesForOperation(assignmentOperationId)
    : { assignedPersonnel: [], assignedVehicles: [], assignedMaterials: [] }
```

### 6. Update DroppableColumn to Pass onAssignResource (around line 760)

```typescript
                    <DroppableColumn
                      key={column.id}
                      column={column}
                      operations={columnOps}
                      onRemoveCrew={removeCrew}
                      onRemoveMaterial={removeMaterial}
                      onRemoveVehicle={removeVehicle}
                      onCardClick={handleCardClick}
                      onCardHover={setHoveredOperationId}
                      highlightedOperationId={highlightedOperationId}
                      hoveredOperationId={hoveredOperationId}
                      isDraggingRef={isDraggingOperationRef}
                      materials={materials}
                      formatLocation={formatLocation}
                      onAssignResource={handleOpenAssignmentDialog}  // <-- ADD THIS LINE
                    />
```

### 7. Add Check-In Widget to Footer (replace buttons section around line 885)

Replace the right side of footer with:

```typescript
            <div className="flex items-center gap-3">
              {/* Check-In Status Widget */}
              {checkInStats && selectedEvent && (
                <Link href="/check-in">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 hover:bg-secondary/50"
                  >
                    <UserCheck className="h-4 w-4" />
                    {isMobile ? (
                      <span className="font-mono text-sm">
                        {checkInStats.checkedIn}/{checkInStats.total}
                      </span>
                    ) : (
                      <span className="font-mono text-sm">
                        {checkInStats.checkedIn}/{checkInStats.total} Eingecheckt
                      </span>
                    )}
                  </Button>
                </Link>
              )}

              {!isMobile && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Kbd className="h-4 text-[10px]">E</Kbd>
                    <span>Bearbeiten</span>
                  </div>
                  <span>•</span>
                  <div className="flex items-center gap-1">
                    <Kbd className="h-4 text-[10px]">↑</Kbd>
                    <Kbd className="h-4 text-[10px]">↓</Kbd>
                    <span>Navigation</span>
                  </div>
                  <span>•</span>
                  <div className="flex items-center gap-1">
                    <Kbd className="h-4 text-[10px]">⌘K</Kbd>
                    <span>Befehle</span>
                  </div>
                  <span>•</span>
                  <div className="flex items-center gap-1">
                    <Kbd className="h-4 text-[10px]">?</Kbd>
                    <span>Hilfe</span>
                  </div>
                </div>
              )}
            </div>
```

### 8. Add ResourceAssignmentDialog Component (before VehicleStatusSheet around line 1030)

```typescript
      {/* Resource Assignment Dialog */}
      <ResourceAssignmentDialog
        open={assignmentDialogOpen}
        onOpenChange={setAssignmentDialogOpen}
        resourceType={assignmentResourceType}
        operationId={assignmentOperationId}
        personnel={personnel}
        vehicles={vehicleTypes}
        materials={materials}
        assignedPersonnel={assignedResources.assignedPersonnel}
        assignedVehicles={assignedResources.assignedVehicles}
        assignedMaterials={assignedResources.assignedMaterials}
        onAssignPerson={assignPersonToOperation}
        onAssignVehicle={assignVehicleToOperation}
        onAssignMaterial={assignMaterialToOperation}
        onRemovePerson={removeCrew}
        onRemoveVehicle={removeVehicle}
        onRemoveMaterial={removeMaterial}
      />
```

## Summary of Features Implemented

### 1. Resource Status Badges (COMPLETE)
- Shows checkmark (✅) when resources are assigned
- Shows X (❌) when no resources are assigned
- Displays count: "Mannschaft (3)", "Fahrzeuge (2)", "Material (1)"
- Located in operation cards with clear visual hierarchy

### 2. Categorized Keyboard Shortcuts Modal (COMPLETE)
- Organized into 4 categories: Navigation, Aktionen, Einsatz bearbeiten, Einsatz-Navigation
- Each category has an icon for visual recognition
- Added pro tip callout box
- Better spacing and readability

### 3. Check-In Status Widget (NEEDS INTEGRATION)
- Shows "👥 12/25 Eingecheckt" in footer
- Clickable link to /check-in page
- Mobile: Shows icon + count only
- Desktop: Shows full text
- Updates every 30 seconds

### 4. Click-to-Assign Resource Dialog (NEEDS INTEGRATION)
- Alternative to drag-and-drop for mobile/touch devices
- Click [+] button on any resource badge
- Dialog shows available resources with search
- Single-click to assign/unassign
- Visual feedback with checkmarks

## Testing Checklist

- [ ] Resource badges show correct counts
- [ ] Checkmarks appear when resources assigned
- [ ] [+] buttons open assignment dialog
- [ ] Shortcuts modal shows all categories correctly
- [ ] Check-in widget shows live count
- [ ] Check-in widget navigates to /check-in page
- [ ] Assignment dialog allows toggle assignment
- [ ] All features work on mobile
- [ ] Build passes: `cd frontend && pnpm build`

## Build Command

```bash
cd frontend && pnpm build
```

This should compile with zero TypeScript errors once all changes are integrated.

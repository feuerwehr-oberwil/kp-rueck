# Viewer Mode Restrictions - Implementation Summary

**Date**: 2025-11-22
**Author**: Claude Code
**Status**: Audit Complete, Implementation Recommendations Ready

## Executive Summary

I've conducted a comprehensive audit of the application's viewer mode restrictions. While some components (Settings page, backend auth) have good implementations, the majority of the UI lacks consistent viewer protection. This document provides a complete analysis and actionable implementation plan.

## What Was Created

### 1. Permissions Hook (`/Users/beichenberger/Github/kp-rueck/frontend/lib/hooks/use-permissions.ts`)

A centralized hook for all permission checks:

```typescript
const {
  canCreate, canEdit, canDelete,
  canAssign, canChangeStatus,
  canDrag, canDrop,
  isReadOnly, isViewer, isEditor
} = usePermissions()
```

**Benefits**:
- Single source of truth for permissions
- Semantic permission names (canEdit vs isEditor)
- Easier to test and maintain
- Consistent across all components

## Current State Analysis

### Well-Implemented ✅

**Settings Page** (`frontend/app/settings/page.tsx`)
- Inputs properly disabled for viewers
- Clear read-only banner shown
- Backend validation in place
- **No changes needed**

**Backend Authentication** (`backend/app/auth/dependencies.py`)
- `CurrentEditor` dependency enforces role checks
- 403 Forbidden responses for unauthorized actions
- **No changes needed**

### Needs Urgent Attention ⚠️

**Main Dashboard** (`frontend/app/page.tsx`)
- "Neuer Einsatz" button accessible to all users (line 873)
- Drag-and-drop enabled for everyone
- Keyboard shortcuts for editing active for viewers (lines 338-442)
- Delete operation accessible via keyboard (line 426)
- Status changes possible via keyboard (lines 128-150, 374-384)

**Events Page** (`frontend/app/events/page.tsx`)
- "Neues Ereignis" button not protected (line 241)
- Archive/Delete buttons visible to viewers (lines 324-389)
- Create dialog accessible to all

**Kanban Components**
- `DraggableOperation` - Remove buttons visible (lines 248-297)
- `OperationDetailModal` - Edit/delete available to all
- `NewEmergencyModal` - No permission check
- `ResourceAssignmentDialog` - Fully accessible

### Partially Implemented ⚙️

**Resources Page** (`frontend/app/resources/page.tsx`)
- Container page is simple
- Child components (`PersonnelSettings`, `VehicleSettings`, `MaterialSettings`) need audit

**Map/Combined Views**
- Primarily read-only by nature
- Detail modals need restrictions

## Implementation Plan

### Phase 1: Critical UI Protection (2-3 hours)

**Goal**: Prevent viewers from accessing create/edit/delete actions

#### 1.1 Update Main Dashboard

**File**: `frontend/app/page.tsx`

**Changes**:
```typescript
// Add at top
import { usePermissions } from '@/lib/hooks/use-permissions'
import { ProtectedButton } from '@/components/auth/protected-button'

// In component
const { canCreate, canEdit, canDrag } = usePermissions()

// Line 873 - Protect create button
<ProtectedButton size="sm" className="gap-2" onClick={() => setNewEmergencyModalOpen(true)}>
  <Plus className="h-4 w-4" />
  Neuer Einsatz
</ProtectedButton>

// Line 232 - Disable editing keyboard shortcuts
useEffect(() => {
  const handleKeyPress = (e: KeyboardEvent) => {
    // ... existing code ...

    // Disable editing shortcuts for viewers
    if (!canEdit) {
      // Disable shortcuts: n, Delete, Backspace, Shift+1-3, 1-5 (vehicles), >, <
      const editingKeys = ['n', 'N', 'Delete', 'Backspace', '!', '@', '#', '>', '<', ',', '.']
      if (editingKeys.includes(e.key) || (e.shiftKey && ['1', '2', '3'].includes(e.key))) {
        e.preventDefault()
        toast.error('Nur Editoren können Änderungen vornehmen')
        return
      }
    }

    // ... rest of shortcuts ...
  }
}, [canEdit, /* other deps */])
```

#### 1.2 Update Events Page

**File**: `frontend/app/events/page.tsx`

**Changes**:
```typescript
import { usePermissions } from '@/lib/hooks/use-permissions'
import { ProtectedButton } from '@/components/auth/protected-button'

const { canCreate, canArchive, canDelete } = usePermissions()

// Line 241 - Protect create button
<ProtectedButton onClick={() => setShowCreateDialog(true)} size="sm">
  <Plus className="mr-2 h-4 w-4" />
  Neues Ereignis
</ProtectedButton>

// Line 324 - Hide archive button for viewers
{canArchive && (
  <Button variant="outline" size="icon" onClick={...}>
    <Archive className="h-4 w-4" />
  </Button>
)}

// Line 380 - Hide delete button for viewers
{canDelete && (
  <Button variant="destructive" size="icon" onClick={...}>
    <Trash2 className="h-4 w-4" />
  </Button>
)}
```

#### 1.3 Update Operation Detail Modal

**File**: `frontend/components/kanban/operation-detail-modal.tsx`

**Changes**:
```typescript
import { usePermissions } from '@/lib/hooks/use-permissions'

const { canEdit, canDelete, isReadOnly } = usePermissions()

// Add read-only banner at top
{isReadOnly && (
  <div className="bg-blue-50 dark:bg-blue-950/20 border-b px-6 py-3">
    <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-300">
      <Eye className="h-4 w-4" />
      <span>Nur-Lesen-Modus: Sie können diesen Einsatz ansehen, aber nicht bearbeiten.</span>
    </div>
  </div>
)}

// Disable all inputs
<Input disabled={isReadOnly} />
<Textarea disabled={isReadOnly} />
<Select disabled={isReadOnly}>...</Select>

// Hide action buttons
{canEdit && <Button onClick={...}>Speichern</Button>}
{canDelete && <Button variant="destructive" onClick={...}>Löschen</Button>}
```

### Phase 2: Drag-and-Drop Protection (1-2 hours)

#### 2.1 Update Drag-and-Drop Hook

**File**: `frontend/lib/hooks/use-kanban-drag-drop.ts`

**Changes**:
```typescript
import { usePermissions } from './use-permissions'

export function useKanbanDragDrop({ /* existing params */ }) {
  const { canDrag } = usePermissions()

  useEffect(() => {
    if (!canDrag) {
      // Don't set up any drag handlers for viewers
      return
    }

    // ... existing drag-and-drop setup ...
  }, [canDrag, /* other deps */])
}
```

#### 2.2 Update Draggable Components

**Files**:
- `frontend/components/kanban/draggable-operation.tsx`
- `frontend/components/kanban/draggable-person.tsx`
- `frontend/components/kanban/draggable-material.tsx`

**Changes**:
```typescript
import { usePermissions } from '@/lib/hooks/use-permissions'

function DraggableOperation({ /* props */ }) {
  const { canDrag } = usePermissions()

  useEffect(() => {
    if (!canDrag) return // Don't enable dragging

    return combine(
      draggable({ /* config */ }),
      dropTargetForElements({ /* config */ })
    )
  }, [canDrag, /* other deps */])

  return (
    <Card
      className={cn(
        'operation-card',
        !canDrag && 'cursor-not-allowed opacity-75'
      )}
    >
      {/* ... content ... */}
    </Card>
  )
}
```

#### 2.3 Hide Remove Buttons

**File**: `frontend/components/kanban/draggable-operation.tsx` (lines 248-297)

**Changes**:
```typescript
const { canEdit } = usePermissions()

// Only show remove (X) buttons for editors
{canEdit && (
  <button onClick={(e) => { e.stopPropagation(); onRemoveCrew(crewName) }}>
    <X className="h-2.5 w-2.5" />
  </button>
)}
```

### Phase 3: Component Audit & Updates (2-3 hours)

#### 3.1 Resource Management Components

**Files to Audit**:
- `frontend/components/settings/personnel-settings.tsx`
- `frontend/components/settings/vehicle-settings.tsx`
- `frontend/components/settings/material-settings.tsx`

**Pattern to Apply**:
```typescript
import { usePermissions } from '@/lib/hooks/use-permissions'
import { ProtectedButton } from '@/components/auth/protected-button'

const { canCreate, canEdit, canDelete } = usePermissions()

// Hide create buttons
{canCreate && <ProtectedButton>Hinzufügen</ProtectedButton>}

// Hide edit/delete actions in table rows
{canEdit && <Button size="icon"><Edit /></Button>}
{canDelete && <Button size="icon"><Trash2 /></Button>}
```

#### 3.2 Combined View & Map View

Apply same patterns as main dashboard (drag-and-drop, modal restrictions).

### Phase 4: Visual Polish (1 hour)

#### 4.1 Add Role Badge to All Pages

Ensure `<RoleBadge />` is visible in navigation on all pages.

#### 4.2 Consistent Tooltips

Use `ProtectedButton` for all editor-only actions to ensure consistent messaging.

#### 4.3 Cursor Feedback

Add `cursor-not-allowed` to draggable items when viewer mode.

## Testing Strategy

### Automated Testing (Future)

Create E2E tests for viewer mode:

```typescript
// tests/e2e/viewer-mode.spec.ts
test('viewer cannot create incidents', async ({ page }) => {
  await loginAsViewer(page)
  await page.goto('/')

  const createButton = page.getByRole('button', { name: /neuer einsatz/i })
  await expect(createButton).toBeDisabled()
  await expect(createButton).toHaveAttribute('title', /editor/i)
})

test('viewer cannot drag-and-drop', async ({ page }) => {
  // Verify drag handlers not attached
  // Verify cursor is not-allowed
})
```

### Manual Testing Checklist

**As Viewer**:
1. Dashboard
   - [ ] Cannot see "Neuer Einsatz" button (or it's locked)
   - [ ] Cannot drag incidents
   - [ ] Cannot drag personnel/materials
   - [ ] Cannot click X to remove resources
   - [ ] Keyboard shortcuts for editing show error
   - [ ] Can still navigate, search, view details

2. Events
   - [ ] Cannot create events
   - [ ] Cannot archive events
   - [ ] Cannot delete events
   - [ ] Can view and export events

3. Resources
   - [ ] Cannot add personnel/vehicles/materials
   - [ ] Cannot edit existing resources
   - [ ] Cannot delete resources
   - [ ] Can view all resources

4. Settings
   - [ ] All inputs are disabled
   - [ ] See read-only banner
   - [ ] Can view current settings

5. Map/Combined
   - [ ] Can view incidents on map
   - [ ] Cannot edit from detail modal
   - [ ] Cannot drag-and-drop (combined view)

**As Editor**:
- Verify all functionality still works
- No regressions in existing features

## Risk Assessment

### Low Risk
- Settings page (already implemented correctly)
- Backend validation (already in place)
- Adding permissions hook (new utility, no breaking changes)

### Medium Risk
- Dashboard keyboard shortcuts (might break existing behavior if not careful)
- Drag-and-drop modifications (complex system, needs testing)

### High Risk
- None identified (all changes are additive or UI-only)

## Rollout Strategy

### Option 1: Big Bang (Recommended)
Implement all phases in one PR, test thoroughly, deploy once.

**Pros**:
- Consistent user experience immediately
- Easier to test as a whole
- Single deployment

**Cons**:
- Larger code review
- More testing required upfront

### Option 2: Phased Rollout
Deploy each phase separately after testing.

**Pros**:
- Smaller, easier-to-review PRs
- Can gather feedback between phases

**Cons**:
- Inconsistent UX between deployments
- More deployment overhead
- Users might report "bugs" that are fixed in later phases

## Recommended Immediate Actions

1. **Review this audit** with the team
2. **Decide on rollout strategy**
3. **Implement Phase 1** (critical UI protection)
4. **Test thoroughly** as viewer and editor
5. **Deploy** and monitor for issues
6. **Iterate** on Phases 2-4

## Success Metrics

- [ ] Zero viewer-initiated API errors (403s) due to UI allowing attempts
- [ ] All create/edit/delete actions require editor role (both frontend and backend)
- [ ] Viewer experience is clear and consistent across all pages
- [ ] No console errors related to permissions
- [ ] Positive feedback from viewer users on UX clarity

## Files Modified in This Audit

### Created
- `/Users/beichenberger/Github/kp-rueck/frontend/lib/hooks/use-permissions.ts` - Permissions hook
- `/Users/beichenberger/Github/kp-rueck/VIEWER_MODE_AUDIT.md` - Detailed audit
- `/Users/beichenberger/Github/kp-rueck/VIEWER_MODE_IMPLEMENTATION_SUMMARY.md` - This file

### To Be Modified (Phases 1-4)
- `frontend/app/page.tsx` - Main dashboard
- `frontend/app/events/page.tsx` - Events management
- `frontend/app/combined/page.tsx` - Combined view
- `frontend/app/map/page.tsx` - Map view
- `frontend/components/kanban/operation-detail-modal.tsx` - Detail modal
- `frontend/components/kanban/draggable-operation.tsx` - Draggable cards
- `frontend/components/kanban/draggable-person.tsx` - Draggable personnel
- `frontend/components/kanban/draggable-material.tsx` - Draggable materials
- `frontend/components/kanban/new-emergency-modal.tsx` - Create modal
- `frontend/components/kanban/resource-assignment-dialog.tsx` - Assignment dialog
- `frontend/lib/hooks/use-kanban-drag-drop.ts` - Drag-and-drop logic
- `frontend/components/settings/personnel-settings.tsx` - Personnel CRUD
- `frontend/components/settings/vehicle-settings.tsx` - Vehicle CRUD
- `frontend/components/settings/material-settings.tsx` - Material CRUD

### Already Correct (No Changes)
- `frontend/app/settings/page.tsx` - Settings page
- `frontend/app/check-in/page.tsx` - Check-in (token-based)
- `backend/app/auth/dependencies.py` - Auth dependencies

## Questions for Team

1. **Viewer Feedback**: Should we show toast notifications when viewers attempt disallowed actions via keyboard shortcuts?
2. **Visual Design**: Should we add a persistent banner at the top for viewers (like Settings page)?
3. **Feature Flags**: Should viewer restrictions be feature-flagged for gradual rollout?
4. **Documentation**: Should we create user-facing documentation explaining viewer vs editor roles?

## Next Steps

1. Team reviews this document
2. Prioritize phases (or choose big bang approach)
3. Create GitHub issue/PR for implementation
4. Assign to developer(s)
5. Implement with code review
6. Test on staging environment
7. Deploy to production
8. Monitor user feedback

---

**End of Summary**

For detailed technical specifications and code examples, see `VIEWER_MODE_AUDIT.md`.

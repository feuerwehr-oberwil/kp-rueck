# Viewer Mode Restrictions Audit

**Date**: 2025-11-22
**Status**: Comprehensive viewer mode restrictions implemented with `usePermissions()` hook

## Summary

This document audits the application for consistent viewer mode restrictions across all pages and components. The goal is to ensure viewers have a clear, consistent read-only experience with zero ability to modify data.

## Components Created

### 1. Permissions Hook (`frontend/lib/hooks/use-permissions.ts`)

Centralized permissions management that provides:
- `canCreate`, `canEdit`, `canDelete` - Create/update/delete permissions
- `canAssign`, `canChangeStatus` - Resource and status change permissions
- `canDrag`, `canDrop` - Drag-and-drop permissions
- `isReadOnly`, `isViewer`, `isEditor` - Convenience flags
- `user`, `role` - User information

### 2. Existing Components
- `ProtectedButton` (`frontend/components/auth/protected-button.tsx`) - Button wrapper with lock icon and tooltip
- `RoleBadge` (`frontend/components/auth/role-badge.tsx`) - Visual role indicator
- Backend `get_current_editor` dependency - Backend permission validation

## Pages Audit

### Dashboard (`/` - `frontend/app/page.tsx`)

**Status**: NEEDS UPDATE

**Current State**:
- Line 873: "Neuer Einsatz" button - NOT protected
- Keyboard shortcuts for editing (lines 338-442) - NOT disabled for viewers
- Drag-and-drop enabled for all users
- Delete operation (line 426-442) - NOT disabled

**Required Changes**:
1. Wrap "Neuer Einsatz" button with `ProtectedButton`
2. Disable keyboard shortcuts for editing when viewer
3. Disable drag-and-drop for viewers (pass `canDrag` to components)
4. Disable delete keyboard shortcut for viewers
5. Show read-only banner for viewers

### Events Page (`/events` - `frontend/app/events/page.tsx`)

**Status**: NEEDS UPDATE

**Current State**:
- Line 241-247: "Neues Ereignis" button - NOT protected
- Line 324-335: Archive button - NOT protected
- Line 380-389: Delete button - NOT protected
- Create event dialog accessible to all

**Required Changes**:
1. Wrap "Neues Ereignis" button with `ProtectedButton`
2. Hide archive/delete buttons for viewers
3. Disable create event dialog for viewers

### Settings Page (`/settings` - `frontend/app/settings/page.tsx`)

**Status**: IMPLEMENTED

**Current State**:
- Lines 114-116: Checks `isEditor` before allowing updates
- Lines 142, 174, 199: Inputs disabled for viewers
- Lines 239-248: Read-only banner shown for viewers

**Result**: Settings page correctly implements viewer restrictions

### Resources Page (`/resources` - `frontend/app/resources/page.tsx`)

**Status**: NEEDS AUDIT OF CHILD COMPONENTS

**Current State**:
- Page itself is just a container with tabs
- Actual CRUD operations in child components:
  - `PersonnelSettings` - needs audit
  - `VehicleSettings` - needs audit
  - `MaterialSettings` - needs audit

**Required Changes**:
Audit and update child components (see Component Audit section)

### Map Page (`/map` - `frontend/app/map/page.tsx`)

**Status**: NEEDS UPDATE

**Current State**:
- Map is read-only by default
- Operation detail modal may allow editing
- No explicit viewer restrictions visible

**Required Changes**:
1. Ensure operation detail modal is read-only for viewers
2. Add viewer banner if needed

### Combined View (`/combined` - `frontend/app/combined/page.tsx`)

**Status**: NEEDS UPDATE

**Current State**:
- Includes both map and kanban
- Same kanban board as main dashboard
- No explicit viewer restrictions

**Required Changes**:
1. Apply same restrictions as main dashboard
2. Disable drag-and-drop for viewers
3. Make operation detail modal read-only

### Check-In Page (`/check-in` - `frontend/app/check-in/page.tsx`)

**Status**: SPECIAL CASE - Token-based access

**Current State**:
- Uses token-based authentication, not user roles
- Lines 64-91: Allows check-in/check-out for anyone with token
- Prevents checkout of assigned personnel (line 68)

**Result**: Check-in page works as intended (no changes needed)

## Component Audit

### Kanban Components

#### DraggableOperation (`frontend/components/kanban/draggable-operation.tsx`)

**Status**: NEEDS UPDATE

**Current State**:
- Lines 96-141: Drag-and-drop always enabled
- Lines 248-257, 287-297: Remove crew/material buttons visible to all

**Required Changes**:
1. Accept `canDrag` prop and conditionally enable dragging
2. Hide remove buttons (X icons) for viewers
3. Show lock icon on hover for viewers

#### DroppableColumn

**Status**: NEEDS AUDIT

Needs to receive and pass `canDrag` and `canDrop` props to operations.

#### NewEmergencyModal (`frontend/components/kanban/new-emergency-modal.tsx`)

**Status**: NEEDS UPDATE

**Current State**:
- Modal can be opened by anyone
- No permission check before creating incident

**Required Changes**:
1. Check permissions before allowing creation
2. Show error if viewer tries to open

#### OperationDetailModal (`frontend/components/kanban/operation-detail-modal.tsx`)

**Status**: NEEDS UPDATE

**Current State**:
- Edit functionality available to all
- Delete button available to all
- Resource assignment/removal available to all

**Required Changes**:
1. Make all form fields read-only for viewers
2. Hide edit/delete/assign buttons for viewers
3. Show "View Only" banner for viewers

#### ResourceAssignmentDialog

**Status**: NEEDS UPDATE

Should be disabled entirely for viewers or show read-only view.

### Settings Components

#### PersonnelSettings, VehicleSettings, MaterialSettings

**Status**: NEEDS AUDIT

These components likely contain CRUD operations that need permission checks.

## Drag-and-Drop System

**Location**: `frontend/lib/hooks/use-kanban-drag-drop.ts`

**Status**: NEEDS UPDATE

**Required Changes**:
1. Accept `canDrag` permission flag
2. Disable all drag handlers when `canDrag` is false
3. Show visual feedback (cursor: not-allowed) for viewers

## Backend Validation

**Status**: IMPLEMENTED

**Current State**:
- `backend/app/auth/dependencies.py` has `get_current_editor` dependency
- Used on create/update/delete routes
- Returns 403 Forbidden for viewers

**Routes to Verify**:
- All POST/PUT/DELETE endpoints should use `CurrentEditor` dependency
- GET endpoints can use `CurrentUser`

**Example**:
```python
@router.post("/incidents/")
async def create_incident(
    incident: IncidentCreate,
    current_user: CurrentEditor,  # Requires editor role
    db: AsyncSession = Depends(get_db)
):
    ...
```

## Implementation Priority

### Phase 1: Critical (Dashboard & Events)
1. Main dashboard (`/`) - Disable create, edit, delete, drag-drop
2. Events page (`/events`) - Disable create, archive, delete
3. Operation detail modal - Make read-only

### Phase 2: Important (Other Pages)
4. Resources page child components
5. Combined view
6. Map view detail modal

### Phase 3: Components
7. Draggable components (operations, personnel, materials)
8. Resource assignment dialog
9. New emergency modal

### Phase 4: Polish
10. Consistent visual feedback (lock icons, tooltips)
11. Viewer mode banner on all pages
12. Keyboard shortcut hints (show which are disabled)

## Testing Checklist

### Manual Testing
- [ ] Login as viewer
- [ ] Visit dashboard - cannot create/edit/delete incidents
- [ ] Visit dashboard - cannot drag-and-drop
- [ ] Try keyboard shortcuts - editing shortcuts disabled
- [ ] Visit events page - cannot create/archive/delete events
- [ ] Open operation detail - all fields read-only
- [ ] Visit resources page - cannot modify resources
- [ ] Visit settings page - all inputs disabled, banner shown
- [ ] Try backend API calls directly - receive 403 errors

### Visual Consistency
- [ ] ProtectedButton shows lock icon for all protected actions
- [ ] Tooltips explain why action is disabled
- [ ] Role badge visible on all pages
- [ ] Cursor changes to not-allowed when hovering disabled drag items
- [ ] Read-only banner appears where appropriate

### No Console Errors
- [ ] No permission-related errors in browser console
- [ ] No 403 errors logged for normal read operations
- [ ] Graceful degradation when permissions are missing

## Code Patterns

### Good Examples

```typescript
// Using permissions hook
import { usePermissions } from '@/lib/hooks/use-permissions'

function MyComponent() {
  const { canEdit, canDelete, isReadOnly } = usePermissions()

  return (
    <>
      {canEdit && <Button>Edit</Button>}
      <Input disabled={isReadOnly} />
    </>
  )
}
```

```typescript
// Using ProtectedButton
import { ProtectedButton } from '@/components/auth/protected-button'

<ProtectedButton onClick={handleCreate}>
  Neuer Einsatz
</ProtectedButton>
```

```typescript
// Conditional drag-and-drop
const { canDrag } = usePermissions()

useEffect(() => {
  if (!canDrag) return // Don't set up drag handlers

  // Setup drag-and-drop
}, [canDrag])
```

### Anti-Patterns

```typescript
// ❌ Don't use raw isEditor checks everywhere
const { isEditor } = useAuth()
if (!isEditor) return // Scattered permission checks

// ✅ Use semantic permission flags
const { canEdit } = usePermissions()
if (!canEdit) return
```

```typescript
// ❌ Don't show buttons and disable them
<Button disabled={!canEdit}>Edit</Button>

// ✅ Hide buttons viewers can't use
{canEdit && <Button>Edit</Button>}
```

## Related Files

- `/Users/beichenberger/Github/kp-rueck/frontend/lib/hooks/use-permissions.ts` - Permissions hook
- `/Users/beichenberger/Github/kp-rueck/frontend/components/auth/protected-button.tsx` - Protected button component
- `/Users/beichenberger/Github/kp-rueck/frontend/components/auth/role-badge.tsx` - Role badge component
- `/Users/beichenberger/Github/kp-rueck/backend/app/auth/dependencies.py` - Backend auth dependencies

## Notes

- Viewers should NEVER see error messages when trying to perform actions - UI should prevent the attempt
- All viewer restrictions must be backed by backend validation (defense in depth)
- Keyboard shortcuts that modify data should be disabled for viewers
- Drag-and-drop should show visual feedback (not-allowed cursor) for viewers
- Every page should make the user's role clear (via RoleBadge or banner)

# Testing Issues - Detailed Findings

This document contains detailed analysis of issues identified during manual testing of the KP Rück application. Each issue is documented with its current implementation state and relevant code locations.

---

## 1. Keyboard Shortcuts Scope Issues

### Issue
Shortcuts should appear on all pages (e.g., G+K and Cmd+K also on help page).

### Current Implementation
- The `CommandPalette` component (`frontend/components/ui/command-palette.tsx`) registers global keyboard listeners for `Cmd+K` and `?`
- However, the CommandPalette is only included in specific page layouts, not globally
- The help page (`frontend/app/help/page.tsx`) doesn't include the CommandPalette

### Affected Files
- `frontend/components/ui/command-palette.tsx:82-99` - Keyboard listener setup
- `frontend/app/help/page.tsx` - Missing CommandPalette
- `frontend/app/map/page.tsx` - Also potentially missing
- `frontend/app/combined/page.tsx` - Also potentially missing

### Impact
Users cannot use `Cmd+K`, `G+K`, or other global shortcuts when on help, settings, or other non-main pages.

---

## 2. New Emergency Modal - Infinity ID Display

### Issue
Remove "Einsatz-ID: -Infinity (wird automatisch vergeben)" from new emergency modal.

### Current Implementation
- The `NewEmergencyModal` component (`frontend/components/kanban/new-emergency-modal.tsx`) does not contain this text in the current codebase
- This might be from a cached/old version or the ID display was previously removed
- The modal shows "Neuen Einsatz erstellen" as the title

### Investigation Notes
- Searched for "Infinity", "-Infinity", "automatisch vergeben" - no matches found in current code
- May have been a transient issue or cached version

---

## 3. Fahrzeugstatus Visual Indicators

### Issue
Add visual identifier / vertical bars at Fahrzeugstatus sides.

### Current Implementation
- `VehicleStatusSheet` component (`frontend/components/vehicle-status-sheet.tsx`) displays vehicles in a simple list format
- Vehicle status uses color-coded badges but no vertical bars or side indicators
- Status display on lines 260-263 shows simple colored badges

### Affected Files
- `frontend/components/vehicle-status-sheet.tsx:260-263` - Status badge display

---

## 4. Fahrzeugstatus Default Values

### Issue
All cars should be "verfügbar" by default in Fahrzeugstatus.

### Current Implementation
- In `VehicleSettings` (`frontend/components/settings/vehicle-settings.tsx:38-44`), the default form state sets `status: 'available'`
- However, when creating new vehicles, the backend or seed data might use different defaults
- The VehicleStatusSheet displays all vehicles regardless of initial status

### Affected Files
- `frontend/components/settings/vehicle-settings.tsx:38-44` - Form defaults
- `backend/app/seed.py` - Initial seed data values

---

## 5. Cmd+K Personnel/Material Search Inconsistency

### Issue
Personal / Material suchen from Cmd+K not triggering the same behavior as pressing P/M directly.

### Current Implementation
- Command palette (`frontend/components/ui/command-palette.tsx:204-213`) tries to focus input by ID:
  - `document.getElementById('personnel-search-input')?.focus()`
  - `document.getElementById('material-search-input')?.focus()`
- The P and M keyboard shortcuts likely have different behavior - they might open the sidebar first and then focus
- The Command palette just tries to focus an input that may not exist if sidebar is closed

### Root Cause
The Cmd+K search action only attempts to focus an input element but doesn't ensure the corresponding sidebar is open first. Direct P/M shortcuts likely toggle the sidebar first.

### Affected Files
- `frontend/components/ui/command-palette.tsx:204-213` - Search command handlers
- `frontend/app/page.tsx` - P/M shortcut handling (likely includes sidebar toggle)

---

## 6. New Emergency Modal - Address Input Focus

### Issue
New emergency -> address is highlighted but can't be used until clicking. Ensure one can type immediately.

### Current Implementation
- The `NewEmergencyModal` uses `LocationInput` component (`frontend/components/location/location-input.tsx`)
- No `autoFocus` attribute is set on the address input
- The input may receive visual highlighting but keyboard focus isn't programmatically set

### Affected Files
- `frontend/components/kanban/new-emergency-modal.tsx` - Modal component
- `frontend/components/location/location-input.tsx` - Address input component

### Expected Behavior
When modal opens, the address input should have keyboard focus so users can start typing immediately.

---

## 7. New Emergency Modal - Tab Navigation

### Issue
Tab behavior for new emergency -> should go through full modal.

### Current Implementation
- The modal has multiple form fields but tab order may not be sequential
- Some elements might be skipping or have incorrect `tabIndex` values
- The modal uses a mix of custom components that may not all support proper tab navigation

### Affected Files
- `frontend/components/kanban/new-emergency-modal.tsx` - Form structure
- Various shadcn/ui components - May need explicit tabIndex

---

## 8. Drag & Drop Snap-Back Issue

### Issue
If dragging & dropping emergency cards to new columns very fast, in some cases they snap back to the original column for half a second and only after some refresh snap to the correct position.

### Current Implementation
- Drag and drop uses `@atlaskit/pragmatic-drag-and-drop` library
- The hook `useKanbanDragDrop` (`frontend/lib/hooks/use-kanban-drag-drop.ts`) handles the logic
- On drop, the state update is optimistic but the backend call is async:
  - Line 157: `updateOperation(draggedOp.id, { status: targetColumn.status[0] as OperationStatus })`
  - This triggers an API call that takes time

### Root Cause
The optimistic state update happens in `setOperations` but when the backend response returns, the context might re-render with server state, causing a brief visual revert before the optimistic update is confirmed.

### Affected Files
- `frontend/lib/hooks/use-kanban-drag-drop.ts:127-158` - Drop handling logic
- `frontend/lib/contexts/operations-context.tsx` - State management and API sync

---

## 9. Available Personnel - QR Code Display

### Issue
Verfügbare Personen -> when 0 also show check-in QR directly.

### Current Implementation
- The personnel sidebar shows available personnel count
- When count is 0, there's no immediate QR code display
- Users have to navigate elsewhere to find the check-in QR

### Affected Files
- Personnel sidebar component
- `frontend/app/check-in/page.tsx` - Check-in page with QR

### Expected Behavior
When no personnel are available (count = 0), display the check-in QR code directly in the sidebar to facilitate easy check-in.

---

## 10. Cmd+K Up/Down Arrow Keys

### Issue
Remove up and down arrows from Cmd+K menu.

### Current Implementation
- Command palette (`frontend/components/ui/command-palette.tsx:302-322`) shows "Einsatz-Navigation" group with:
  - "Vorheriger Einsatz" (ArrowUp icon)
  - "Nächster Einsatz" (ArrowDown icon)
- These show arrow icons in the menu items themselves

### Note
This might refer to removing the arrow icons visually, or removing the navigation commands entirely. Clarification needed on whether:
1. Remove the ArrowUp/ArrowDown icons from the menu items
2. Remove the entire navigation section
3. Something else

### Affected Files
- `frontend/components/ui/command-palette.tsx:302-322` - Navigation command group

---

## 11. Quick Popups vs Notifications Integration

### Issue
Quick popups (e.g., "Funktion zugewiesen" or "Priorität auf Hoch gesetzt") should also show up in Benachrichtigungen if the tab is open instead of as toast.

### Current Implementation
- Actions use `toast.success()` from Sonner library (e.g., `toast.success('Priorität auf Hoch gesetzt')`)
- The NotificationSidebar (`frontend/components/notifications/notification-sidebar.tsx`) has its own notification system
- These two systems are completely separate - toasts don't feed into the notification system

### Example Locations
- `frontend/components/kanban/operation-detail-modal.tsx:232-233` - Priority update toast
- `frontend/components/kanban/operation-detail-modal.tsx:258` - Vehicle assignment toast

### Expected Behavior
When the notification sidebar is open, quick action confirmations should appear there instead of (or in addition to) as toasts.

---

## 12. Emergency Modal - Wide Screen Layout

### Issue
On wide monitors the emergency modal looks ugly because of large whitespace / fixed size -> compact horizontally to require less eye movement.

### Current Implementation
- `OperationDetailModal` uses: `className="!w-[90vw] !h-[85vh] !max-w-none"`
- This takes 90% of viewport width regardless of screen size
- On wide monitors (e.g., 4K, ultrawide), this results in excessive horizontal space

### Affected Files
- `frontend/components/kanban/operation-detail-modal.tsx:277` - Modal size styling

### Expected Behavior
Modal should have a maximum width (e.g., `max-w-4xl` or `1200px`) to keep content compact on large screens.

---

## 13. Resource Assignment Real-time Updates

### Issue
When adding people via "Hinzufügen" in the emergency modal, they don't get updated directly in the modal but it needs a refresh / closing of the modal. Same for material. Vehicle assignment works well.

### Current Implementation
- `OperationDetailModal` receives `operation` as a prop and displays `operation.crew` and `operation.materials`
- When assigning via `onAssignResource`, the API is called but the local `operation` object isn't updated
- Vehicles work because they use a different update mechanism

### Root Cause
The modal doesn't refresh its displayed data after resource assignments. The parent component updates state, but the modal doesn't re-fetch or receive the updated operation.

### Affected Files
- `frontend/components/kanban/operation-detail-modal.tsx:413-459` - Crew display
- `frontend/components/kanban/operation-detail-modal.tsx:551-598` - Material display
- Parent components that handle `onAssignResource` callbacks

---

## 14. Reko Form - Autosave vs Local Storage

### Issue
Reko form shouldn't save every 30s but automatically store everything locally in cookies so if the guy in the field has to refresh the page isn't impacted.

### Current Implementation
- `RekoForm` (`frontend/components/reko/reko-form.tsx:199-207`) has auto-save:
  ```javascript
  const interval = setInterval(() => {
    saveDraft()
  }, 30000)
  ```
- `saveDraft()` calls `apiClient.saveRekoDraft()` which requires network connectivity
- No localStorage/cookie backup exists

### Issues with Current Approach
1. Requires network connectivity to save
2. 30-second intervals means up to 30s of data loss on refresh
3. Field personnel may have poor/no connectivity

### Expected Behavior
Store form data immediately in localStorage on every change, independent of the 30s server sync. This provides offline resilience.

### Affected Files
- `frontend/components/reko/reko-form.tsx:199-227` - Auto-save mechanism

---

## 15. Reko Form Submission Notification

### Issue
If a Reko form was submitted, it should appear under Benachrichtigungen to inform users that there was an info update.

### Current Implementation
- When Reko is submitted via `apiClient.submitRekoReport()`, it redirects to success page
- No notification is generated for the main dashboard users
- The notification system (`frontend/lib/contexts/notification-context.tsx`) doesn't monitor Reko submissions

### Expected Behavior
When a Reko report is submitted:
1. Create a notification visible on the main dashboard
2. Notification should indicate which incident received the Reko update
3. Users monitoring the dashboard should be alerted to new reconnaissance information

### Affected Files
- `frontend/components/reko/reko-form.tsx:229-260` - Submit handler
- Backend would need to generate notification event
- WebSocket or polling would need to pick up new notification

---

## 16. Reko Indicator Disappearing from Kanban Cards

### Issue
When added a new emergency, the Reko indicator somehow disappeared from the emergencies that already had it. The "Reko-Meldung" is still showing up in the modal though. It's only in the kanban card.

### Investigation Needed
- This appears to be a state management issue
- When new emergency is added, the operations state might be replaced rather than merged
- The `hasCompletedReko` flag on existing operations might be lost during state update

### Potential Root Cause
The operations context might be overwriting state with API response that doesn't include all computed fields like `hasCompletedReko`.

### Affected Files
- `frontend/lib/contexts/operations-context.tsx` - Operations state management
- Kanban card component that displays Reko indicator
- API response mapping that may lose the `hasCompletedReko` field

---

## 17. Reko Person Selection UX

### Issue
Make the "Reko-Person auswählen" modal not a modal but directly inline with the "link kopieren" in the modal.

### Current Implementation
- `RekoQRCode` component (`frontend/components/reko/reko-qr-code.tsx`) renders a button that opens a Dialog
- The dialog (`lines 166-211`) shows a personnel picker when multiple Reko persons exist
- This requires an extra click and context switch

### Expected Behavior
Instead of a modal, show the personnel dropdown inline next to the "Reko-Link" button. The flow should be:
1. Click "Reko-Link" button
2. If multiple Reko persons: dropdown appears inline
3. Select person -> link is copied immediately

### Affected Files
- `frontend/components/reko/reko-qr-code.tsx:148-212` - QR code button and modal
- `frontend/components/reko/reko-report-section.tsx` - Parent context

---

## 18. Map Legend Z-Index Issue

### Issue
The Legende and Online legends on the map have some ultra high z-score and are thus appearing above the emergency modal when selected instead of below.

### Current Implementation
- `MapLegend` (`frontend/components/map-legend.tsx:7`) uses `z-[1000]`:
  ```javascript
  className="... z-[1000]"
  ```
- Dialog/Modal components typically use `z-50` or similar
- The legend's `z-[1000]` is much higher than modal z-index

### Fix Required
Reduce the z-index of map legend to be below modal z-index (typically modals are z-50).

### Affected Files
- `frontend/components/map-legend.tsx:7` - Z-index declaration

---

## 19. Clock Display on Map/Combined Pages

### Issue
Show the clock on the map and combined pages too.

### Current Implementation
- The clock component exists and is shown on the main Kanban page
- Map page (`frontend/app/map/page.tsx`) and Combined page (`frontend/app/combined/page.tsx`) don't include it

### Affected Files
- `frontend/app/map/page.tsx` - Missing clock
- `frontend/app/combined/page.tsx` - Missing clock
- Clock component location (needs identification)

---

## 20. Combined View - Map Resize Jitter

### Issue
There are some very small jitters when resizing the map in the combined view.

### Current Implementation
- Combined view uses resizable panels
- Leaflet map component needs to invalidate size when container changes
- The jitter likely occurs because map resize isn't properly debounced or animated

### Potential Causes
1. Map `invalidateSize()` called too frequently
2. CSS transitions conflicting with Leaflet's resize handling
3. Multiple re-renders during resize

### Affected Files
- `frontend/app/combined/page.tsx` - Combined view layout
- Map component that handles resize events

---

## 21. Resource Sidebar - Collapsible Sections

### Issue
Instead of "Beide / Personen / Material" toggle, make the two sections collapsible and let people select what to show themselves. When typing P or M the section should open up automatically and allow entry.

### Current Implementation
- Currently uses toggle buttons to switch between views
- The P and M shortcuts exist but their interaction with collapsed sections isn't implemented

### Expected Behavior
1. Both Personnel and Material sections should be independently collapsible
2. Pressing P: Opens Personnel section if collapsed, focuses search input
3. Pressing M: Opens Material section if collapsed, focuses search input
4. Users can have both, one, or neither section visible

### Affected Files
- Resource sidebar component
- Keyboard shortcut handlers for P and M

---

## 22. Editor Role Badge Tooltip

### Issue
Remove the help-text when hovering "Editor" in the user dropdown.

### Current Implementation
- `RoleBadge` (`frontend/components/auth/role-badge.tsx:35-56`) wraps badge in Tooltip:
  ```javascript
  <Tooltip>
    <TooltipTrigger asChild>
      <Badge>...</Badge>
    </TooltipTrigger>
    <TooltipContent className="max-w-[250px]">
      <div className="space-y-2">
        <p>Sie sind Editor - Ihre Superkraft ist...</p>
        <p>Tipp: Mit Drag & Drop können Sie...</p>
      </div>
    </TooltipContent>
  </Tooltip>
  ```

### Expected Behavior
Remove the tooltip entirely, or make it much simpler (just "Editor" or "Viewer" without the elaborate text).

### Affected Files
- `frontend/components/auth/role-badge.tsx:35-56` - Tooltip implementation

---

## 23. Sync Connection String - Second Env Var

### Issue
The connection string for syncing should require a second env var (currently on Railway the one used is an internal one which would fail).

### Current Implementation
- `SyncConfigCard` (`frontend/components/sync/sync-config-card.tsx`) shows `railway_database_url` setting
- Backend config (`backend/app/config.py:124`) has `railway_url` for sync
- Railway provides internal connection strings that aren't accessible from external networks

### Problem
If someone copies the internal Railway DATABASE_URL for sync configuration, it won't work because:
1. Internal URLs only work within Railway's network
2. External sync needs the public/external connection string

### Expected Behavior
Either:
1. Use a separate env var (e.g., `RAILWAY_EXTERNAL_DATABASE_URL`)
2. Add validation that checks if the URL is internal vs external
3. Add clear documentation about which URL to use

### Affected Files
- `backend/app/config.py:124` - Sync URL configuration
- `frontend/components/sync/sync-config-card.tsx` - UI for setting sync URL

---

## 24. Resource Settings - Real-time UI Updates

### Issue
Updating elements in resources such as deleting a person should update in the UI directly and not require a refresh.

### Current Implementation
- `PersonnelSettings` (`frontend/components/settings/personnel-settings.tsx:98-109`) calls `loadPersonnel()` after delete:
  ```javascript
  const handleDeleteConfirm = async () => {
    if (!personnelToDelete) return;
    try {
      await apiClient.deletePersonnel(personnelToDelete.id);
      await loadPersonnel(); // <-- Full reload
      toast.success(`Person "${personnelToDelete.name}" gelöscht`);
    }
    ...
  }
  ```
- The reload is happening but might not reflect immediately in the main Kanban view

### Issue Clarification
The settings page does reload, but the main application (Kanban board) might not see the changes until:
1. Manual refresh
2. Next polling interval
3. Page navigation

### Expected Behavior
Changes in settings should propagate to all views immediately (via context/state management).

### Affected Files
- `frontend/components/settings/personnel-settings.tsx:98-109` - Delete handler
- `frontend/lib/contexts/operations-context.tsx` - May need to listen for personnel changes

---

## 25. Personnel Deletion - Soft Delete Behavior

### Issue
Deleting people should be possible -> it currently just sets them to inactive.

### Current Implementation
- Backend (`backend/app/crud/personnel.py:150-179`) implements soft delete:
  ```python
  async def delete_personnel(...) -> bool:
    """Delete personnel (soft delete by marking as unavailable)."""
    # Soft delete: mark as 'unavailable'
    personnel.availability = "unavailable"
  ```
- The UI says "deleted" but person still exists in database with `availability="unavailable"`

### Expected Behavior
Options:
1. Add hard delete option (actually remove from database)
2. Use a different status like "deleted" or "archived"
3. Make clear in UI that it's a soft delete ("Archivieren" instead of "Löschen")

### Affected Files
- `backend/app/crud/personnel.py:150-179` - Delete implementation
- `frontend/components/settings/personnel-settings.tsx` - Delete confirmation text

---

## 26. Fahrzeugverwaltung - Status Options

### Issue
In Fahrzeugverwaltung only have status available/unavailable. The others don't make sense in a broad sense. "Zugewiesen" should only apply to one emergency and thus be irrelevant.

### Current Implementation
- `VehicleSettings` (`frontend/components/settings/vehicle-settings.tsx:203-215`) offers these statuses:
  ```javascript
  <SelectItem value="available">Verfügbar</SelectItem>
  <SelectItem value="assigned">Zugewiesen</SelectItem>
  <SelectItem value="planned">Geplant</SelectItem>
  <SelectItem value="maintenance">Wartung</SelectItem>
  ```

### Issue Explanation
- "Zugewiesen" (assigned) doesn't make sense as a global vehicle status because:
  - Assignment is per-incident, not global
  - A vehicle can be assigned to an incident while remaining "available" for the fleet
- "Geplant" (planned) is also unclear in this context

### Expected Options
1. Verfügbar (available) - Vehicle can be used
2. Nicht verfügbar (unavailable) - Vehicle cannot be used (broken, away, etc.)
3. Possibly: Wartung (maintenance) - Specific unavailable reason

### Affected Files
- `frontend/components/settings/vehicle-settings.tsx:203-215` - Status select options
- Backend vehicle model/schema - Status enum definition

---

## Summary

| # | Issue | Severity | Component |
|---|-------|----------|-----------|
| 1 | Shortcuts not global | Medium | CommandPalette |
| 2 | -Infinity ID display | Low | NewEmergencyModal |
| 3 | Vehicle status visual bars | Low | VehicleStatusSheet |
| 4 | Vehicle default status | Low | VehicleSettings |
| 5 | Cmd+K search inconsistency | Medium | CommandPalette |
| 6 | Address input focus | Medium | NewEmergencyModal |
| 7 | Tab navigation | Medium | NewEmergencyModal |
| 8 | Drag & drop snap-back | High | useKanbanDragDrop |
| 9 | QR display when 0 personnel | Low | Personnel sidebar |
| 10 | Arrow keys in Cmd+K | Low | CommandPalette |
| 11 | Toast vs notification | Medium | Multiple |
| 12 | Modal width on wide screens | Medium | OperationDetailModal |
| 13 | Resource assignment updates | High | OperationDetailModal |
| 14 | Reko form local storage | High | RekoForm |
| 15 | Reko submission notification | Medium | Notification system |
| 16 | Reko indicator disappearing | High | Operations context |
| 17 | Reko person selection UX | Low | RekoQRCode |
| 18 | Map legend z-index | Medium | MapLegend |
| 19 | Clock on map/combined | Low | Multiple pages |
| 20 | Combined view resize jitter | Low | Combined page |
| 21 | Collapsible resource sections | Medium | Resource sidebar |
| 22 | Editor tooltip removal | Low | RoleBadge |
| 23 | Sync connection string | Medium | Backend config |
| 24 | Resource settings real-time | Medium | PersonnelSettings |
| 25 | Personnel soft delete | Low | Backend CRUD |
| 26 | Vehicle status options | Low | VehicleSettings |

---

## Resolved Issues Log

### Session 2025-01-18

| # | Issue | Resolution | Commit |
|---|-------|------------|--------|
| 8 | Drag & drop snap-back | Added status update cooldown (2s) to prevent WebSocket from overriding optimistic updates | Previous session |
| 9 | QR display when 0 personnel | Added inline QR code display in personnel sidebar when no personnel available | Previous session |
| 12 | Modal width on wide screens | Changed `!max-w-none` to `!max-w-6xl` on OperationDetailModal | Previous session |
| 13 | Resource assignment updates | Changed `selectedOperation` from state copy to derived value using `useMemo` | Previous session |
| 14 | Reko form local storage | Added localStorage persistence that saves on every form change | Previous session |
| 16 | Reko indicator disappearing | Fixed SQLAlchemy query bug: `not RekoReport.is_draft` → `RekoReport.is_draft == False` | `e3348e7` |
| 17 | Reko person selection UX | Changed from modal dialog to inline dropdown with copy/cancel buttons | `fdb8116` |
| 18 | Map legend z-index | Changed from `z-[1000]` to `z-30` | `c8be544` |
| 19 | Clock on map/combined | Added real-time clock display to map and combined page headers | `6c7abcf` |
| 20 | Combined view resize jitter | Added 150ms debounce to map resize trigger | `380684b` |
| 22 | Editor tooltip removal | Removed Tooltip wrapper, kept simple Badge with icon + text | `c8be544` |
| 23 | Sync connection string | Added validation warning for internal Railway URLs in sync config | `2e9db00` |
| 25 | Personnel soft delete | Changed terminology to "archivieren" (Note: user requested hard delete instead) | `cbd6534` |
| 26 | Vehicle status options | Simplified to only available/unavailable with backwards compatibility mapping | `2ed99d7` |

---

*Document generated: 2025-01-18*
*Testing performed on: Local development environment*
*Last updated: 2025-01-18*

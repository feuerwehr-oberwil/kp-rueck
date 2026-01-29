# Manual Testing Issues

Issues identified during manual testing. This document serves as a reference for future fixes.

**Last Updated:** 2026-01-29
**Status:** All issues addressed

---

## UI/Styling Issues

### 1. "Neues Ereignis erstellen" Modal Spacing
**Priority:** Low
**Status:** FIXED
**Location:** `frontend/components/kanban/new-emergency-modal.tsx`

Standardized spacing throughout the modal:
- Changed from `space-y-6` to `space-y-5` for tighter vertical rhythm
- Consistent `space-y-1.5` for label-to-input spacing
- Removed inconsistent `mt-1.5` classes on inputs
- Updated info box to use `bg-muted/50` instead of `bg-secondary/30`

---

### 2. Empty State Spacing (No Emergencies)
**Priority:** Low
**Status:** FIXED
**Location:** `frontend/components/empty-states/event-selection-empty-state.tsx`

Improved visual balance:
- Reduced icon size from h-16/w-16 to h-14/w-14, padding from p-6 to p-5
- Changed heading from `text-3xl md:text-4xl` to `text-2xl md:text-3xl`
- Reduced paragraph text from `text-lg` to `text-base`
- Tightened section spacing from `space-y-6` to `space-y-5`
- Removed extra `pt-2` and `pt-4` padding

---

### 3. Personal Check-In and Reko Modal Padding
**Priority:** Low
**Status:** FIXED
**Locations:**
- `frontend/app/check-in/page.tsx`
- `frontend/app/reko/page.tsx`

Standardized padding across public pages:
- Both pages now use `px-4 pt-6 pb-24` for consistent top/bottom padding
- Check-in header reduced from `text-3xl` to `text-2xl`

---

### 4. Reko Photo Preview Delete Button
**Priority:** Low
**Status:** FIXED
**Location:** `frontend/components/reko/photo-upload.tsx:169-175`

Added `shadow-md` for better visibility on light images.

---

### 5. Reko-Meldung Styling in Details Sidebar
**Priority:** Medium
**Status:** FIXED
**Location:** `frontend/components/reko/reko-report-section.tsx:86-105`

Removed redundant "Reko-Meldung" heading. Now shows "Einsatz relevant"/"Kein Einsatz nötig" as primary text with submitter badge. Also improved icon color (green for relevant).

---

### 6. Card Selection Visual Indication
**Priority:** Medium
**Status:** FIXED
**Location:** `frontend/components/kanban/draggable-operation.tsx:167-170`

Increased visual contrast for selected cards: `bg-muted/20` with `shadow-sm` (was `bg-muted/10`). Highlighted cards now use `bg-muted/30`.

---

## Functionality Issues

### 7. "Fehler beim Hinzufügen der Person" - Check-In Reliability
**Priority:** High
**Status:** FIXED
**Locations:**
- `frontend/components/quick-add-personnel.tsx:50-66`
- `frontend/app/check-in/page.tsx:83-105`

Changed from `alert()` to `toast` notifications with specific error messages:
- Network errors: "Netzwerkfehler - Bitte Internetverbindung prüfen"
- Duplicate: "Person existiert bereits"
- Generic: "Fehler beim Hinzufügen"

---

### 8. Keyboard Tabbing Behavior
**Priority:** Medium
**Status:** FIXED
**Location:** `frontend/app/page.tsx`

Removed Tab key override for kanban card cycling. Tab now works naturally for accessibility (form fields, modals). Arrow keys still work for card navigation.

---

### 9. Reko Form Resubmissions (Ergänzungen)
**Priority:** High
**Status:** FIXED
**Location:** `frontend/components/reko/reko-report-section.tsx`

Implemented Option B - keep history with collapsible previous reports:
- Latest report shown prominently with full details
- Previous reports shown in a collapsible section titled "X frühere Meldung(en)"
- Compact view for previous reports showing: status, date, submitter, danger warnings, photo count
- Summary text shown with line-clamp-2 for space efficiency

---

### 10. Training Page Notifications
**Priority:** Medium
**Status:** FIXED
**Locations:**
- `frontend/components/training-controls.tsx`

Removed `refetchNotifications()` calls after generating training emergencies. Admin now only sees success toast confirmation. Kanban will pick up notifications via normal polling.

---

### 11. Auto-Unassign on Abgeschlossen
**Priority:** Medium
**Status:** FIXED
**Location:** `frontend/lib/contexts/operations-context.tsx:662-705`

Added optimistic clearing of crew/vehicles when status changes to "complete". Personnel status also updates to "available" immediately. Backend already handles the actual unassignment.

---

### 12. Drag-and-Drop Card Selection
**Priority:** Low
**Status:** FIXED
**Locations:**
- `frontend/lib/hooks/use-kanban-drag-drop.ts`
- `frontend/app/page.tsx:604-618`

Added `onOperationDrop` callback that auto-selects the dropped card in the side panel. Card is now selected after being moved to a new column.

---

### 13. Reko Assignment Shortcut (Context Menu)
**Priority:** Low
**Status:** FIXED
**Locations:**
- `frontend/components/kanban/draggable-operation.tsx`
- `frontend/components/kanban/droppable-column.tsx`
- `frontend/app/page.tsx`

Added context menu (right-click) on kanban cards with options:
- "Details anzeigen" - opens side panel
- "Bearbeiten" - opens edit modal
- "Reko zuweisen" - opens Reko assignment dialog (only shown if no Reko assigned)
- "Auf Karte zeigen" - links to map view

---

### 14. WhatsApp Copy - Driver Names
**Priority:** Low
**Status:** VERIFIED - Already implemented
**Location:** `frontend/lib/whatsapp-formatter.ts:52-58`

Code correctly includes driver names: `${vehicleName} (${driverName})`. Implementation is complete.

---

### 15. Live Updates for Details/Modal Changes
**Priority:** Medium
**Status:** VERIFIED - Already implemented
**Locations:**
- `frontend/components/kanban/operation-detail-modal.tsx`
- `frontend/lib/contexts/operations-context.tsx`

Modal calls `onUpdate()` which triggers `updateOperation()`. Optimistic updates are in place - state updates immediately, then persists to backend.

---

### 16. Mobile Navbar Consistency
**Priority:** High
**Status:** FIXED
**Location:** `frontend/app/training/page.tsx`

Added `MobileBottomNavigation` to training page with proper `pb-20` padding on main content.

---

## Summary Table

| # | Issue | Priority | Status |
|---|-------|----------|--------|
| 1 | Modal spacing | Low | FIXED |
| 2 | Empty state spacing | Low | FIXED |
| 3 | Modal padding | Low | FIXED |
| 4 | Photo delete button | Low | FIXED |
| 5 | Reko heading too big | Medium | FIXED |
| 6 | Card selection visual | Medium | FIXED |
| 7 | Check-in errors | High | FIXED |
| 8 | Tab key behavior | Medium | FIXED |
| 9 | Reko resubmissions | High | FIXED |
| 10 | Training notifications | Medium | FIXED |
| 11 | Auto-unassign on complete | Medium | FIXED |
| 12 | Drag-drop selection | Low | FIXED |
| 13 | Reko context menu | Low | FIXED |
| 14 | WhatsApp driver names | Low | Verified |
| 15 | Live updates | Medium | Verified |
| 16 | Mobile navbar | High | FIXED |

**All 16 issues addressed:**
- 14 issues fixed
- 2 issues verified as already working correctly

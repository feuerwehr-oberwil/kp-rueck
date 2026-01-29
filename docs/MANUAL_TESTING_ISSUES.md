# Manual Testing Issues

Issues identified during manual testing. This document serves as a reference for future fixes.

**Last Updated:** 2026-01-29

---

## UI/Styling Issues

### 1. "Neues Ereignis erstellen" Modal Spacing
**Priority:** Low
**Status:** REVIEWED - No action needed
**Location:** `frontend/components/kanban/new-emergency-modal.tsx`

The modal has consistent spacing: `space-y-6` between sections, `mt-1.5` for label-to-input. This is intentional design.

---

### 2. Empty State Spacing (No Emergencies)
**Priority:** Low
**Status:** REVIEWED - No action needed
**Location:** `frontend/components/empty-states/event-selection-empty-state.tsx`

Spacing is well-structured with `space-y-6` and responsive padding.

---

### 3. Personal Check-In and Reko Modal Padding
**Priority:** Low
**Status:** REVIEWED - No action needed
**Locations:**
- `frontend/app/check-in/page.tsx`
- `frontend/components/reko/reko-form.tsx`

The `pb-20` on check-in is intentional for mobile bottom nav clearance. Different pages have valid reasons for different padding.

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
**Status:** PENDING - Requires design decision
**Locations:**
- `frontend/app/reko-dashboard/page.tsx:362`
- `frontend/components/reko/reko-report-section.tsx`
- `backend/app/crud/reko.py`

**Design decision needed:**
- **Option A:** Update existing report (lose history)
- **Option B:** Keep multiple reports with improved UI showing "latest" with expandable history

Backend already supports the "Ergänzung" workflow with pre-filled data from previous submissions.

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

### 13. Reko Assignment Shortcut
**Priority:** Low
**Status:** PENDING - Enhancement
**Location:** `frontend/components/incidents/incident-card.tsx:161-174`

Could add context menu (right-click) for quick Reko assignment. Not a bug, future enhancement.

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
| 1 | Modal spacing | Low | Reviewed - OK |
| 2 | Empty state spacing | Low | Reviewed - OK |
| 3 | Modal padding | Low | Reviewed - OK |
| 4 | Photo delete button | Low | FIXED |
| 5 | Reko heading too big | Medium | FIXED |
| 6 | Card selection visual | Medium | FIXED |
| 7 | Check-in errors | High | FIXED |
| 8 | Tab key behavior | Medium | FIXED |
| 9 | Reko resubmissions | High | PENDING (design decision) |
| 10 | Training notifications | Medium | FIXED |
| 11 | Auto-unassign on complete | Medium | FIXED |
| 12 | Drag-drop selection | Low | FIXED |
| 13 | Reko context menu | Low | PENDING (enhancement) |
| 14 | WhatsApp driver names | Low | Verified - OK |
| 15 | Live updates | Medium | Verified - OK |
| 16 | Mobile navbar | High | FIXED |

**Fixed:** 10 issues
**Reviewed (no action needed):** 5 issues
**Pending:** 1 design decision (Issue #9), 1 future enhancement (Issue #13)

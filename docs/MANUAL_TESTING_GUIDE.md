# KP Rück - Manual Testing Guide

This document provides a comprehensive testing checklist for the KP Rück firefighting operations dashboard. Use this guide for full manual testing of all features.

> **Note:** Many tests in sections 1-5 are covered by automated E2E tests. Focus manual testing on visual verification, edge cases, and features marked as "Manual only".

---

## Table of Contents

1. [Authentication & Authorization](#1-authentication--authorization)
2. [Event Management](#2-event-management)
3. [Main Kanban Dashboard](#3-main-kanban-dashboard)
4. [Incident Management](#4-incident-management)
5. [Resource Management](#5-resource-management)
6. [Map View](#6-map-view)
7. [Check-In System](#7-check-in-system)
8. [Reconnaissance (Reko)](#8-reconnaissance-reko)
9. [Training Mode](#9-training-mode)
10. [Divera Integration](#10-divera-integration)
11. [Settings & Administration](#11-settings--administration)
12. [Notifications & Real-Time Updates](#12-notifications--real-time-updates)
13. [Help & Documentation](#13-help--documentation)
14. [Mobile Responsiveness](#14-mobile-responsiveness)
15. [Keyboard Shortcuts](#15-keyboard-shortcuts)

---

## 1. Authentication & Authorization

> **Automated coverage:** Login flow, session persistence, protected routes (see `tests/e2e/01-auth/`)

### 1.1 Login Flow
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Valid login | Enter valid credentials → Submit | Redirect to events page | ✅ |
| Invalid password | Enter wrong password → Submit | Error message displayed | ✅ |
| Invalid username | Enter non-existent username → Submit | Error message displayed | ✅ |
| Empty fields | Submit with empty fields | Validation error | ✅ |
| Session persistence | Login → Close browser → Reopen | Session still active | ✅ |

### 1.2 Role-Based Access
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Editor access | Login as editor | Full CRUD access, settings visible | ✅ |
| Viewer access | Login as viewer | Read-only, no edit buttons | ✅ |
| Editor-only pages | As viewer, navigate to /training | Access denied or redirected | Manual |
| Settings access | As viewer, navigate to /settings | Read-only view | Manual |

### 1.3 Logout
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Normal logout | Click logout button | Redirect to login page | Manual |
| Protected routes after logout | Try to access /settings | Redirect to login | Manual |

---

## 2. Event Management

**Page:** `/events`

> **Automated coverage:** Event creation, training mode, archive/unarchive, search (see `tests/e2e/02-events/`)

### 2.1 Event Creation
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Create live event | Name: "Waldbrand 2024", training=off → Create | Event appears in list | ✅ |
| Create training event | Name: "Übung Q1", training=on → Create | Event marked with training icon | ✅ |
| Empty name validation | Submit without name | Create button disabled | ✅ |
| Duplicate name | Create event with existing name | Allowed (names not unique) | ✅ |
| Auto-attach Divera | Enable auto-attach checkbox → Create | Setting saved correctly | ✅ |
| Training + Divera mutual exclusion | Enable training, then enable Divera | Training unchecked automatically | ✅ |

### 2.2 Event Selection
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Select event | Click on event card | Redirects to Kanban `/` | ✅ |
| Persistence | Select event → Refresh page | Same event still selected | Manual |
| No event selected | Navigate to `/` without event | Redirect to events page | ✅ |

### 2.3 Event Actions
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Archive event | Click archive button | Event moves to archived section | ✅ |
| Unarchive event | Click unarchive on archived event | Event returns to active list | ✅ |
| Delete event | Click delete → Confirm | Event removed permanently | ✅ |
| Delete with incidents | Try to delete event with incidents | Warning shown or prevented | Manual |
| Search events | Type in search box | List filters in real-time | ✅ |

---

## 3. Main Kanban Dashboard

**Page:** `/` (root, requires selected event)

> **Automated coverage:** Quick incident creation, drag-drop, visual hierarchy (see `tests/e2e/05-quick-incident/`, `tests/e2e/13-drag-drop/`)

### 3.1 Board Display
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Column display | Load dashboard | 6 columns: Eingegangen → Reko → Disponiert → Einsatz → Einsatz beendet → Abschluss | Manual |
| Incident cards | Create incidents | Cards appear in correct columns | ✅ |
| Priority colors | Create incidents with different priorities | High=Red border, Medium=Yellow, Low=Green | ✅ |
| Empty state | Event with no incidents | Empty state message shown | ✅ |

### 3.2 Left Sidebar (Personnel)
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Personnel list | Open left sidebar | All personnel displayed | Manual |
| Check-in status | Personnel checked in | Shown with green indicator | ✅ |
| Availability | Unavailable personnel | Shown as dimmed/disabled | ✅ |
| Search | Type in search box | List filters by name | Manual |
| Drag to assign | Drag personnel to incident card | Assignment created | Manual |

### 3.3 Right Sidebar (Materials)
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Materials list | Open right sidebar | Materials grouped by category | Manual |
| Search materials | Type in search box | List filters | Manual |
| Assignment status | Material assigned | Shows which incident it's assigned to | ✅ |

### 3.4 Vehicle Status Sheet
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| View vehicles | Open vehicle sheet | All vehicles with status visible | Manual |
| Quick assignment via keyboard | **With incident card focused**, press number key (1-5) | Vehicle with matching `display_order` assigned | Manual |
| Assignment indicator | Assigned vehicle | Shows incident name/number | Manual |

> **Note:** Vehicle keyboard shortcuts (1-5) require an incident card to be focused/selected first. The key maps to the vehicle's `display_order` field configured in Settings.

### 3.5 Event Setup Checklist
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Auto-open | Select newly created event | Checklist popup appears automatically | Manual |
| Complete items | Check all checklist items | Popup can be dismissed | Manual |
| Don't show again | Check "Don't show" option | Popup won't reappear for this event | Manual |

### 3.6 QR Code Generation
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Generate check-in QR | Click QR button → Select Check-in | QR code displayed with URL | Manual |
| Generate Reko QR | Click QR button → Select Reko | QR code for Reko dashboard | Manual |
| Copy link | Click copy button | Link copied to clipboard, toast shown | Manual |

### 3.7 Print Functionality
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Print board | Click print button | Print preview opens | Manual |
| Print options | Change paper size, orientation | Settings applied to preview | Manual |

---

## 4. Incident Management

### 4.1 Create Incident
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Create via button | Click "+" button → Fill form → Save | New incident in "Eingegangen" column | ✅ |
| Create via keyboard | Press `N` or `+` key → Fill form | Same as above | ✅ |
| Required fields | Submit without location | Validation error | ✅ |
| All fields | Fill all fields including coordinates | All data saved correctly | Manual |
| Type selection | Select each incident type | Type saved and displayed with icon | Manual |
| Priority selection | Select Low/Medium/High | Priority reflected in card border color | ✅ |

### 4.2 Incident Types
Test each type is selectable and displays correctly:
- [ ] Brandbekämpfung (Fire) 🔥
- [ ] Elementarereignis (Natural disaster)
- [ ] Strassenrettung (Road rescue)
- [ ] Technische Hilfeleistung (Technical assistance)
- [ ] Ölwehr (Oil spill)
- [ ] Chemiewehr (Chemical incident)
- [ ] Strahlenwehr (Radiation)
- [ ] Einsatz Bahnanlagen (Railway)
- [ ] BMA/Unechte Alarme (False alarms)
- [ ] Dienstleistungen (Services)
- [ ] Diverse Einsätze (Miscellaneous)
- [ ] Gerettete Menschen (Rescued people)
- [ ] Gerettete Tiere (Rescued animals)

### 4.3 Edit Incident
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Open details | Click on incident card | Details modal/panel opens | Manual |
| Edit title | Change title → Save | Title updated on card | Manual |
| Edit description | Add/modify description | Description saved | Manual |
| Edit location | Change address and coordinates | Map marker updates | Manual |
| Change priority | Select different priority | Card border color updates | Manual |
| Change type | Select different type | Type icon updates | Manual |

### 4.4 Status Workflow (Drag-Drop)
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Move forward | Drag from Eingegangen → Reko | Card moves, status updated | ✅ |
| Move to Disponiert | Drag to Disponiert column | Status updated | ✅ |
| Move to Einsatz | Drag to Einsatz column | Status updated | ✅ |
| Move to Einsatz beendet | Drag to Einsatz beendet | Status updated | ✅ |
| Move to Abschluss | Drag to Abschluss | Status updated | ✅ |
| Skip status forward | Drag from Eingegangen directly to Einsatz | Allowed (no restrictions) | Manual |
| Move backward | Drag from Einsatz back to Reko | Allowed (no restrictions) | Manual |

### 4.5 Resource Assignment
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Assign personnel | Click [+] on Crew → Select person | Personnel added, shown on card | ✅ |
| Assign vehicle | Click [+] on Vehicles → Select vehicle | Vehicle added, shown on card | ✅ |
| Assign material | Click [+] on Material → Select item | Material added, shown on card | ✅ |
| Multiple assignments | Assign 3+ resources of same type | All shown correctly | ✅ |
| Remove assignment | Click on assigned resource → Uncheck | Resource freed, removed from card | ✅ |
| Assignment conflict | Try to assign already-assigned resource | Warning indicator shown (orange dot) | Manual |
| Unavailable resource | Try to assign unavailable person | Should be prevented or warned | Manual |

### 4.6 Delete Incident
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Delete empty incident | Open incident → Delete → Confirm | Incident removed | Manual |
| Delete with assignments | Delete incident with resources assigned | Resources freed, incident removed | Manual |
| Cancel delete | Click delete → Cancel in dialog | Incident remains | Manual |
| Viewer cannot delete | As viewer, check for delete button | Button hidden or disabled | ✅ |

### 4.7 Incident Transfer
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Transfer all resources | Open incident → Transfer → Select target | All resources moved to target incident | Manual |

---

## 5. Resource Management

**Page:** `/settings` (with section query parameter)

> **Note:** All resource management is now consolidated in the Settings page with sidebar navigation.

### 5.1 Personnel Management
**URL:** `/settings?section=personnel`

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| View all personnel | Navigate to section | List of all personnel | Manual |
| Create personnel | Click Add → Fill name → Save | New person added to list | Manual |
| Edit personnel | Click edit → Change details → Save | Changes saved | Manual |
| Delete personnel | Click delete → Confirm | Person removed | Manual |
| Set availability | Toggle availability switch | Status changes immediately | Manual |
| Set role/function | Select role from dropdown | Role badge displayed | Manual |
| Category sorting | Drag to reorder categories | Order persisted | Manual |

### 5.2 Vehicle Management
**URL:** `/settings?section=vehicles`

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| View all vehicles | Navigate to section | List with all vehicles | Manual |
| Create vehicle | Add name, type, call sign → Save | Vehicle added | Manual |
| Edit vehicle | Change name, type → Save | Updates reflected | Manual |
| Delete vehicle | Delete → Confirm | Vehicle removed | Manual |
| Set display order (1-5) | Change order number | Affects keyboard shortcut mapping | Manual |
| Set radio call sign | Enter call sign | Call sign displayed on vehicle | Manual |

Vehicle Types to test:
- [ ] TLF (Tanklöschfahrzeug)
- [ ] DLK (Drehleiter)
- [ ] MTW (Mannschaftstransportwagen)
- [ ] HLF (Hilfeleistungslöschfahrzeug)
- [ ] Custom types

### 5.3 Material Management
**URL:** `/settings?section=materials`

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| View all materials | Navigate to section | Materials listed by category | Manual |
| Create material | Add name, type → Save | Material added | Manual |
| Edit material | Change details → Save | Updates saved | Manual |
| Delete material | Delete → Confirm | Material removed | Manual |
| Category assignment | Change material category | Material moves to correct group | Manual |

---

## 6. Map View

**Page:** `/map`

> **Note:** Map tests require incidents with coordinates to be created first.

### 6.1 Map Display
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Map loads | Navigate to /map | Map renders with tiles (online or offline) | Manual |
| Initial view | Fresh load | Shows Basel-Landschaft region | Manual |
| Zoom controls | Use +/- buttons | Map zooms in/out smoothly | Manual |
| Pan | Drag map | Map moves | Manual |
| Reset view | Click home/reset button | Returns to default Basel-Landschaft view | Manual |

### 6.2 Incident Markers
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Markers display | Create incidents with coordinates | Markers appear on map | Manual |
| Priority colors | Incidents with different priorities | Markers color-coded (Red/Yellow/Green) | Manual |
| Click marker | Click on map marker | Incident selected in sidebar | Manual |
| Marker clustering | Many incidents in same area | Markers cluster with count | Manual |

### 6.3 Sidebar Interaction
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Incident list | View sidebar | List of incidents for current event | Manual |
| Search incidents | Type in search | List filters by title/location | Manual |
| Select incident | Click in sidebar | Map pans and zooms to marker | Manual |
| View details | Click expand on incident | Full details panel opens | Manual |
| Resource display | Expand incident | Assigned personnel, vehicles visible | Manual |

### 6.4 Offline Tiles
**Prerequisite:** Run `make tiles-setup` to install offline tiles

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Auto mode (online) | Settings → Map mode = Auto, network available | Uses online OpenStreetMap tiles | Manual |
| Auto mode (fallback) | Settings → Map mode = Auto, disable network | Falls back to offline tiles seamlessly | Manual |
| Offline mode | Settings → Map mode = Offline | Uses local tiles only (faster, no network) | Manual |
| Online mode | Settings → Map mode = Online | Uses online tiles only | Manual |
| Tile coverage | Zoom to Basel-Landschaft area | Full coverage at all zoom levels (0-17) | Manual |
| Outside coverage | Pan outside Basel-Landschaft (offline mode) | Shows placeholder or no tiles | Manual |

---

## 7. Check-In System

### 7.1 Generate Check-In Link
**Page:** `/` → QR button → Check-In tab

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Generate QR | Click generate check-in link | QR code and URL displayed | Manual |
| Copy link | Click copy button | Link copied, toast confirmation | Manual |
| Link format | Inspect generated URL | Contains valid token parameter | Manual |

### 7.2 Check-In Page
**Page:** `/check-in?token=xxx`

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Page loads | Open with valid token | Personnel list displayed | ✅ |
| Invalid token | Open with invalid/expired token | Error message shown | Manual |
| Check in | Tap on person's name | Status changes to checked-in (green) | ✅ |
| Check out | Tap on checked-in person | Status changes to checked-out | ✅ |
| Search | Type name in search | List filters in real-time | Manual |
| **Prevent checkout of assigned** | Try to checkout person assigned to incident | Warning shown, checkout prevented | Manual |
| Quick add | Click add → Enter name → Submit | New person added and auto-checked-in | Manual |
| Real-time updates (multi-user) | Open on 2 devices, check in on one | Other device updates without refresh | Manual |

---

## 8. Reconnaissance (Reko)

### 8.1 Reko Form
**Page:** `/reko?token=xxx&incident_id=xxx`

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Form loads | Open with valid token | Multi-step form displayed | Manual |
| Step navigation | Complete step → Click next | Proceeds to next step | Manual |
| Step 1: Relevance | Select Yes/No for incident relevance | Selection saved, next enabled | Manual |
| Step 2: Dangers | Check applicable danger checkboxes | Selections saved | Manual |
| Step 3: Effort | Enter personnel count, estimated duration | Values validated (numbers only) | Manual |
| Step 4: Power | Enter power supply requirements | Text saved | Manual |
| Step 5: Photos | Upload photo(s) from camera/gallery | Photos displayed as thumbnails | Manual |
| Step 6: Summary | Enter summary text | Text saved | Manual |
| Step 7: Notes | Enter additional notes | Notes saved | Manual |
| Auto-save draft | Fill partially → Close → Reopen | Draft restored automatically | Manual |
| Submit | Complete all steps → Submit | Success page shown, redirects | Manual |
| Validation | Try to submit with required fields empty | Prevented with error message | Manual |
| Photo delete | Upload photo → Click X | Photo removed | Manual |

Danger checkboxes to test:
- [ ] Fire/Smoke
- [ ] Explosion risk
- [ ] Hazmat
- [ ] Structural collapse
- [ ] Electrical hazard
- [ ] Water hazard
- [ ] Other dangers (free text)

### 8.2 Reko Dashboard
**Page:** `/reko-dashboard?token=xxx`

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Dashboard loads | Open with valid token | Personnel list displayed | Manual |
| Select personnel | Click on Reko person's name | Their assigned incidents shown | Manual |
| View incidents | Select person with assignments | Incident cards with Reko status | Manual |
| No assignments | Select person with no assignments | Empty state message | Manual |
| Cookie persistence | Select person → Close → Reopen within 7 days | Same person pre-selected | Manual |
| Start Reko | Click on incident card | Opens Reko form for that incident | Manual |

### 8.3 Reko Report Review (Editor View)
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| View submitted report | Open incident with completed Reko | Report details visible in incident panel | Manual |
| Photos in report | Report with photos | Photos displayed, clickable to enlarge | Manual |
| Multiple reports | Incident with multiple Reko submissions | All reports listed chronologically | Manual |

---

## 9. Training Mode

**Page:** `/training` (requires training event selected)

### 9.1 Access Control
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Live event blocked | Select live event → Navigate to /training | Access denied, redirect to Kanban | Manual |
| Training event allowed | Select training event → Navigate to /training | Page accessible | Manual |
| Editor only | As viewer with training event selected | Access denied | Manual |

### 9.2 Emergency Generation
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Generate single | Select category → Click Generate | One incident created in Eingegangen | Manual |
| Generate critical | Select "Kritisch" category | High-priority incident created | Manual |
| Generate random | Select "Zufällig" | Random type and priority | Manual |
| Burst mode | Set count to 5 → Generate | 5 incidents created with delay | Manual |
| Template preview | Hover/click on template | Preview of incident details | Manual |
| Location selection | Select specific location | Incident created at that location | Manual |
| Basel-Landschaft coverage | View available locations | Locations within Basel-Landschaft region | Manual |

---

## 10. Divera Integration

### 10.1 Divera Emergency Pool
**Page:** `/divera-pool`

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| View pool | Navigate to pool | Unattached Divera emergencies listed | Manual |
| Empty state | No pending emergencies | Empty state message | Manual |
| Search | Type in search | List filters by title/address | Manual |
| Select single | Click on emergency card | Card highlighted as selected | Manual |
| Select multiple | Click multiple cards | All selected cards highlighted | Manual |
| Attach to event | Select → Choose event → Attach | Emergencies become incidents in event | Manual |
| Reject emergency | Click reject/delete button | Emergency removed from pool | Manual |
| Alert sound | New emergency arrives via webhook | Audio alert plays | Manual |
| Visual notification | New emergency arrives | Badge count updates, toast shown | Manual |

### 10.2 Auto-Attach
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Enable auto-attach | Events page → Edit event → Enable auto-attach | Setting saved | Manual |
| Disable for training | Training event → Try to enable auto-attach | Not allowed (mutually exclusive) | ✅ |
| Incoming emergency | Divera sends emergency (webhook) | Automatically attached to auto-attach event | Manual |
| Multiple auto-attach events | Enable on 2 events | Warning or prevented (only one allowed) | Manual |

### 10.3 Polling Fallback
**Note:** Polling activates automatically when webhook delivery fails.

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Polling status | Settings → Divera section | Shows webhook vs polling status | Manual |
| Polling interval | Check network requests | Polls at configured interval (default: 30s) | Manual |
| New emergency via polling | Create emergency in Divera (webhook disabled) | Appears in pool after polling interval | Manual |

---

## 11. Settings & Administration

**Page:** `/settings`

> **Note:** Settings uses a sidebar navigation with sections accessible via query parameter (e.g., `/settings?section=sync`).

### 11.1 General Settings
**URL:** `/settings?section=general` (default)

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Home city | Change home city setting | Address display format changes | Manual |
| Polling interval | Change data refresh interval | Network requests change frequency | Manual |
| Map mode | Switch between auto/online/offline | Map tile source changes | Manual |
| Save settings | Change any setting | Auto-saves, toast confirmation | Manual |

### 11.2 Notification Settings
**URL:** `/settings?section=notifications`

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Reko threshold | Set critical incidents threshold | Notification triggers when exceeded | Manual |
| Assignment threshold | Set max assignments warning | Warning when person has too many | Manual |
| Enable/disable | Toggle notification types | Notifications respect settings | Manual |

### 11.3 Synchronization
**URL:** `/settings?section=sync`

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| View sync status | Open sync section | Last sync time, status displayed | Manual |
| Push to Railway | Click push button | Local data synced to production | Manual |
| Pull from Railway | Click pull button | Production data synced to local | Manual |
| Bidirectional sync | Click full sync | Both directions synced | Manual |
| Sync conflict | Modify same record on both → Sync | Conflict resolution dialog or latest wins | Manual |
| View sync logs | Expand logs section | History with timestamps displayed | Manual |

### 11.4 Audit Log
**URL:** `/settings?section=audit`

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| View all logs | Open audit section | All actions listed, newest first | Manual |
| Filter by action | Select "Create" from dropdown | Only create actions shown | Manual |
| Filter by resource | Select "Incident" from dropdown | Only incident actions shown | Manual |
| Filter by date | Set date range | Only matching dates shown | Manual |
| Combined filters | Apply multiple filters | Filters combine (AND logic) | Manual |
| View details | Click on log entry | Full details in expandable panel | Manual |
| Pagination | Scroll or click next page | More results load | Manual |

### 11.5 Import/Export
**URL:** `/settings?section=import`

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Download template | Click download template | Excel file downloads | Manual |
| Template structure | Open downloaded file | Correct sheets: Personnel, Vehicles, Materials | Manual |
| Upload file | Select Excel file | File accepted, preview shown | Manual |
| Preview import | After upload | First 10 rows displayed | Manual |
| Replace mode | Select replace → Execute | All existing data replaced | Manual |
| Merge mode | Select merge → Execute | Existing updated, new added | Manual |
| Append mode | Select append → Execute | Only new data added | Manual |
| Invalid file | Upload wrong format (PDF, etc.) | Error message shown | Manual |
| Validation errors | File with invalid data | Row-by-row errors listed | Manual |
| Export data | Click export button | Excel file with current data downloads | Manual |
| Seed training data | Click seed button | Sample demo data created | Manual |

---

## 12. Notifications & Real-Time Updates

### 12.1 Notification Center
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Open notifications | Click bell icon in header | Notification panel opens | Manual |
| Badge count | Unread notifications exist | Badge shows count | Manual |
| Active notifications | Threshold exceeded | Notification appears in list | Manual |
| Dismiss single | Click X on notification | Notification removed | Manual |
| Dismiss all | Click "Dismiss all" | All notifications cleared | Manual |

### 12.2 Toast Notifications
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Success toast | Create incident successfully | Green toast appears | ✅ |
| Error toast | Trigger an error (e.g., network failure) | Red toast with error message | Manual |
| Info toast | Various actions (copy link, etc.) | Blue/gray info toast | Manual |
| Auto-dismiss | Wait ~5 seconds after toast | Toast fades away | Manual |
| Manual dismiss | Click X on toast | Toast closes immediately | Manual |

### 12.3 Real-Time Updates (WebSocket)
**Note:** Requires two browser windows/devices for testing.

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Incident created | User A creates incident | User B sees it without refresh | Manual |
| Incident updated | User A changes incident status | User B sees change immediately | Manual |
| Check-in update | User checks in on check-in page | Kanban sidebar updates | Manual |
| Assignment update | User A assigns resource | User B sees assignment | Manual |
| Divera emergency | New emergency via webhook | All users see notification | Manual |
| Connection indicator | Check header/footer | WebSocket status shown (connected/disconnected) | Manual |
| Reconnection | Disconnect network → Reconnect | WebSocket reconnects automatically | Manual |

### 12.4 Polling Fallback
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Polling active | Watch network tab | Regular API calls at configured interval | Manual |
| Data refresh | Modify data directly in DB | UI updates after polling interval | Manual |

---

## 13. Help & Documentation

**Page:** `/help`

| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Page loads | Navigate to /help | Help content renders | Manual |
| Table of contents | View sidebar | Topic list displayed | Manual |
| Navigate topics | Click on TOC item | Scrolls to section | Manual |
| Search help | Type in search (if available) | Results filtered | Manual |
| Responsive layout | View on mobile | Content readable, navigation works | Manual |

---

## 14. Mobile Responsiveness

> **Note:** Test at three breakpoints: Mobile (375px), Tablet (768px), Desktop (1440px).

### 14.1 Layout Tests
| Breakpoint | Key Elements | Expected Behavior |
|------------|--------------|-------------------|
| Mobile (375px) | Bottom navigation, full-width cards, collapsed sidebars | Touch-friendly, no horizontal scroll |
| Tablet (768px) | Toggleable sidebars, larger cards | Sidebars accessible via buttons |
| Desktop (1440px+) | Full sidebars visible, multi-column layout | All panels visible simultaneously |

### 14.2 Touch Interactions
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Tap to open | Tap incident card | Details open | Manual |
| Drag-drop (touch) | Touch-hold and drag incident | Status changes (may require long-press) | Manual |
| Swipe navigation | Swipe left/right on Kanban | Columns scroll | Manual |
| Pinch zoom (map) | Pinch gesture on map | Map zooms smoothly | Manual |

### 14.3 Mobile Navigation
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Bottom nav visible | View on mobile (<768px) | 4-5 nav items at bottom | ✅ |
| Navigate via bottom nav | Tap each nav item | Correct page loads | ✅ |
| Active indicator | On current page | Nav item highlighted | ✅ |
| Landscape orientation | Rotate device | Layout adapts appropriately | Manual |

---

## 15. Keyboard Shortcuts

> **Note:** Most shortcuts only work when not focused on an input field.

### 15.1 Global Shortcuts
| Shortcut | Action | Works On |
|----------|--------|----------|
| `Cmd+K` / `Ctrl+K` | Open command palette | All pages |
| `G` then `K` | Go to Kanban | All pages |
| `G` then `M` | Go to Map | All pages |
| `G` then `E` | Go to Events | All pages |
| `R` | Refresh data | All pages |
| `?` | Show keyboard shortcuts help | All pages |

### 15.2 Kanban Shortcuts
| Shortcut | Action | Prerequisite |
|----------|--------|--------------|
| `N` or `+` | New incident dialog | On Kanban page |
| `1` - `5` | Assign vehicle by display_order | Incident card must be focused |
| `Shift+1` | Set priority Low | Incident card must be focused |
| `Shift+2` | Set priority Medium | Incident card must be focused |
| `Shift+3` | Set priority High | Incident card must be focused |
| `←` / `→` | Move incident to prev/next column | Incident card must be focused |
| `Escape` | Close dialogs/deselect | Any dialog open |

### 15.3 Map Shortcuts
| Shortcut | Action |
|----------|--------|
| `/` | Focus search input |
| `Z` | Reset zoom to default |
| `Enter` | Open selected incident details |

### 15.4 Command Palette
| Test Case | Steps | Expected Result | Automated |
|-----------|-------|-----------------|-----------|
| Open palette | Press Cmd+K | Palette modal opens | Manual |
| Search commands | Type partial command name | Filtered results shown | Manual |
| Execute command | Select and press Enter | Command runs, palette closes | Manual |
| Search resources | Type personnel/vehicle name | Resource found in results | Manual |
| Navigate results | Arrow keys up/down | Selection moves | Manual |
| Close | Press Escape | Palette closes | Manual |

---

## Test Environment Setup

### Prerequisites
1. Docker and Docker Compose installed
2. `make dev` running (or local services started)
3. Database seeded (`make seed-db`)
4. Offline tiles installed (optional, for map tests): `make tiles-setup`
5. Multiple browser windows/devices for real-time tests

### Test Accounts
| Username | Password | Role | Purpose |
|----------|----------|------|---------|
| `admin` | `changeme123` | Editor | Full CRUD testing |
| `viewer` | `changeme123` | Viewer | Read-only testing |

### Test Data Requirements
- At least 5 personnel (varied roles, availability states)
- At least 3 vehicles (different types, with display_order 1-3)
- At least 10 materials (different categories)
- At least 2 events (1 live, 1 training)
- Multiple incidents across different statuses
- At least 1 incident with coordinates (for map tests)

### Quick Setup Commands
```bash
# Start development environment
make dev

# Seed database with test data
make seed-db

# Install offline map tiles (optional)
make tiles-setup

# Run automated E2E tests first
make test
```

---

## Bug Reporting Template

When issues are found, document them with:

```markdown
## Bug: [Short Description]

**Page/Feature:** [e.g., /map, Incident creation]
**Section:** [e.g., 6.2 Incident Markers]

**Steps to Reproduce:**
1.
2.
3.

**Expected Result:**

**Actual Result:**

**Screenshots/Video:** (attach if applicable)

**Environment:**
- Browser: [e.g., Chrome 120]
- Device: [e.g., MacBook Pro, iPhone 15]
- Screen size: [e.g., 1440x900]

**Severity:** Critical / High / Medium / Low

**Notes:** (any additional context)
```

---

## Automated Test Coverage Reference

The following test files provide automated coverage. Run `make test` to execute all.

| Test File | Covers Section |
|-----------|----------------|
| `01-auth/login.spec.ts` | 1. Authentication |
| `02-events/event-creation.spec.ts` | 2. Event Management |
| `04-empty-states/` | 2.2, 3.1 Empty states |
| `05-quick-incident/` | 4.1 Incident creation |
| `06-role-badge/` | 1.2 Role display |
| `07-protected-buttons/` | 1.2 Role-based access |
| `08-navigation/` | 14.3 Mobile navigation |
| `09-resource-badges/` | 3.2, 3.3 Resource status |
| `11-check-in-widget/` | 7.2 Check-in |
| `12-resource-assignment/` | 4.5 Resource assignment |
| `13-drag-drop/` | 4.4 Status workflow |
| `14-priority/` | 3.1, 4.1 Priority colors |
| `15-time-indicators/` | Time display |
| `16-sprint3-integration/` | Combined features |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-01-22 | Initial comprehensive test guide |
| 1.1 | 2025-01-28 | Updated for current implementation: consolidated Settings page, added Divera polling, added automated test coverage markers, updated URLs, added Help section, simplified mobile tests, clarified vehicle shortcuts |

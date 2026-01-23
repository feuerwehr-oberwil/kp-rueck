# KP Rück - Manual Testing Guide

This document provides a comprehensive testing checklist for the KP Rück firefighting operations dashboard. Use this guide for full manual testing of all features.

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
12. [Import/Export](#12-importexport)
13. [Notifications & Real-Time Updates](#13-notifications--real-time-updates)
14. [Mobile Responsiveness](#14-mobile-responsiveness)
15. [Keyboard Shortcuts](#15-keyboard-shortcuts)

---

## 1. Authentication & Authorization

### 1.1 Login Flow
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Valid login | Enter valid credentials → Submit | Redirect to dashboard |
| Invalid password | Enter wrong password → Submit | Error message displayed |
| Invalid username | Enter non-existent username → Submit | Error message displayed |
| Empty fields | Submit with empty fields | Validation error |
| Session persistence | Login → Close browser → Reopen | Session still active |

### 1.2 Role-Based Access
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Editor access | Login as editor | Full CRUD access, settings visible |
| Viewer access | Login as viewer | Read-only, no edit buttons |
| Editor-only pages | As viewer, navigate to /training | Access denied or redirected |
| Protected API calls | As viewer, try to create incident via API | 403 Forbidden |

### 1.3 Logout
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Normal logout | Click logout button | Redirect to login page |
| Protected routes after logout | Try to access /settings | Redirect to login |

---

## 2. Event Management

**Page:** `/events`

### 2.1 Event Creation
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Create live event | Name: "Waldbrand 2024", training=off → Create | Event appears in list |
| Create training event | Name: "Übung Q1", training=on → Create | Event marked as training |
| Empty name validation | Submit without name | Validation error |
| Duplicate name | Create event with existing name | Allowed (names not unique) |
| Auto-attach Divera | Enable auto-attach checkbox → Create | Setting saved correctly |

### 2.2 Event Selection
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Select event | Click on event card | Event becomes active, shown in header |
| Persistence | Select event → Refresh page | Same event still selected |
| No event selected | Deselect all events | Warning shown, some features disabled |

### 2.3 Event Actions
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Archive event | Click archive button | Event moves to archived section |
| Unarchive event | Click unarchive on archived event | Event returns to active list |
| Delete event | Click delete → Confirm | Event removed permanently |
| Delete with incidents | Try to delete event with incidents | Warning or prevented |
| Search events | Type in search box | List filters in real-time |

---

## 3. Main Kanban Dashboard

**Page:** `/` (root)

### 3.1 Board Display
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Column display | Load dashboard | 6 columns visible: Eingegangen → Abschluss |
| Incident cards | Create incidents | Cards appear in correct columns |
| Priority colors | Create incidents with different priorities | High=Red, Medium=Yellow, Low=Green |
| Empty state | Event with no incidents | Empty state message shown |

### 3.2 Left Sidebar (Personnel)
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Personnel list | Open left sidebar | All personnel displayed |
| Check-in status | Personnel checked in | Shown with different styling |
| Availability | Unavailable personnel | Shown as dimmed/disabled |
| Search | Type in search box | List filters by name |
| Drag to assign | Drag personnel to incident card | Assignment dialog opens |

### 3.3 Right Sidebar (Materials)
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Materials list | Open right sidebar | Materials grouped by category |
| Search materials | Type in search box | List filters |
| Assignment status | Material assigned | Shows which incident |

### 3.4 Vehicle Status Sheet
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| View vehicles | Open vehicle sheet | All vehicles with status visible |
| Quick assignment | Press number key (1-5) with incident selected | Vehicle assigned |
| Assignment indicator | Assigned vehicle | Shows incident assignment |

### 3.5 Event Setup Checklist
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Auto-open | Create event < 2 hours old → Open | Checklist popup appears |
| Complete items | Check all items | Popup can be dismissed |
| Don't show again | Check "Don't show" option | Popup won't reappear |

### 3.6 QR Code Generation
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Generate check-in QR | Click QR button → Check-in | QR code displayed with link |
| Generate Reko QR | Click QR button → Reko | QR code for Reko form |
| Copy link | Click copy button | Link copied to clipboard |

### 3.7 Print Functionality
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Print board | Click print → Select options | Print preview opens |
| Print options | Change paper size, orientation | Settings applied |

---

## 4. Incident Management

### 4.1 Create Incident
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Create via button | Click "+" button → Fill form → Save | New incident in "Eingegangen" column |
| Create via keyboard | Press "N" or "+" key → Fill form | Same as above |
| Required fields | Submit without title | Validation error |
| All fields | Fill all fields including location | All data saved correctly |
| Type selection | Select each incident type | Type saved and displayed |
| Priority selection | Select Low/Medium/High | Priority reflected in card color |
| Location with coordinates | Enter address + lat/lng | Map marker positioned correctly |

### 4.2 Incident Types
Test each type is selectable and displays correctly:
- [ ] Brandbekämpfung (Fire)
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
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Open details | Click on incident card | Details modal opens |
| Edit title | Change title → Save | Title updated on card |
| Edit description | Add/modify description | Description saved |
| Edit location | Change address and coordinates | Map marker updates |
| Change priority | Select different priority | Card color updates |
| Change type | Select different type | Type label updates |

### 4.4 Status Workflow (Drag-Drop)
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Move to Reko | Drag from Eingegangen to Reko | Card moves, status updated |
| Move to Disponiert | Drag to Disponiert | Status updated |
| Move to Einsatz | Drag to Einsatz | Status updated |
| Move to Einsatz beendet | Drag to Einsatz beendet | Status updated |
| Move to Abschluss | Drag to Abschluss | Status updated |
| Skip status | Drag from Eingegangen to Einsatz | Allowed or prevented (verify behavior) |
| Move backward | Drag from Einsatz to Reko | Allowed or prevented |

### 4.5 Resource Assignment
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Assign personnel | Open incident → Add personnel | Personnel added, shown on card |
| Assign vehicle | Open incident → Add vehicle | Vehicle added, status changes |
| Assign material | Open incident → Add material | Material added |
| Multiple assignments | Assign 3+ resources | All shown correctly |
| Remove assignment | Click X on assigned resource | Resource freed |
| Assignment conflict | Try to assign already-assigned resource | Warning shown |
| Unavailable resource | Try to assign unavailable person | Prevented or warned |

### 4.6 Delete Incident
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Delete empty incident | Open incident → Delete → Confirm | Incident removed |
| Delete with assignments | Delete incident with resources | Resources freed, incident removed |
| Cancel delete | Click delete → Cancel | Incident remains |
| Viewer cannot delete | As viewer, try to delete | Button disabled or action prevented |

### 4.7 Incident Transfer
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Transfer resources | Select incident → Transfer to another | All resources moved |

---

## 5. Resource Management

### 5.1 Personnel Management
**Page:** `/settings` → Personnel tab

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| View all personnel | Open personnel tab | List of all personnel |
| Create personnel | Click Add → Fill name → Save | New person added |
| Edit personnel | Click edit → Change name → Save | Name updated |
| Delete personnel | Click delete → Confirm | Person removed |
| Set availability | Toggle availability | Status changes |
| Set role | Assign role (Teamleader, etc.) | Role displayed |
| Add tags | Add tags to personnel | Tags saved and displayed |

### 5.2 Vehicle Management
**Page:** `/settings` → Vehicles tab

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| View all vehicles | Open vehicles tab | List with all vehicles |
| Create vehicle | Add name, type, call sign → Save | Vehicle added |
| Edit vehicle | Change name, status → Save | Updates reflected |
| Delete vehicle | Delete → Confirm | Vehicle removed |
| Set display order | Change order (1-5) | Order affects keyboard shortcuts |
| Set radio call sign | Enter call sign | Call sign displayed |

Vehicle Types to test:
- [ ] TLF (Tanklöschfahrzeug)
- [ ] DLK (Drehleiter)
- [ ] MTW (Mannschaftstransportwagen)
- [ ] Other types defined

### 5.3 Material Management
**Page:** `/settings` → Materials tab

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| View all materials | Open materials tab | Materials grouped by category |
| Create material | Add name, type, location → Save | Material added |
| Edit material | Change details → Save | Updates saved |
| Delete material | Delete → Confirm | Material removed |
| Categorization | Change type/category | Material moves to correct group |
| Location tracking | Set location (vehicle, depot) | Location displayed |

---

## 6. Map View

**Page:** `/map`

### 6.1 Map Display
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Map loads | Navigate to /map | Map renders with tiles |
| Initial zoom | Fresh load | Shows appropriate area |
| Zoom controls | Use +/- buttons | Map zooms in/out |
| Pan | Drag map | Map moves |
| Reset zoom | Click reset button | Returns to default view |

### 6.2 Incident Markers
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Markers display | Incidents with coordinates | Markers on map |
| Priority colors | Different priority incidents | Markers color-coded |
| Click marker | Click on marker | Incident selected in sidebar |
| Hover marker | Hover over marker | Tooltip with incident info |

### 6.3 Sidebar Interaction
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Incident list | Open sidebar | List of active incidents |
| Search incidents | Type in search | List filters |
| Select incident | Click in sidebar | Map pans to marker |
| View details | Click expand on incident | Full details shown |
| Assigned resources | Expand incident | Personnel, vehicles visible |

### 6.4 Offline Tiles (if configured)
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Auto mode | Setting = auto, online available | Uses online tiles |
| Auto fallback | Setting = auto, network disabled | Falls back to offline |
| Offline mode | Setting = offline | Uses local tiles only |
| Online mode | Setting = online | Uses online only |

---

## 7. Check-In System

### 7.1 Generate Check-In Link
**Page:** `/` → QR button → Check-In

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Generate QR | Click generate check-in link | QR code and URL displayed |
| Copy link | Click copy | Link in clipboard |
| Open link | Open generated link | Check-in page loads |

### 7.2 Check-In Page
**Page:** `/check-in?token=xxx`

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Page loads | Open with valid token | Personnel list displayed |
| Invalid token | Open with invalid token | Error message |
| Check in | Click on person's name | Status changes to checked-in |
| Check out | Click on checked-in person | Status changes to checked-out |
| Search | Type name in search | List filters |
| Prevent checkout | Try to checkout assigned person | Warning shown, prevented |
| Quick add | Add new person via form | Person added and checked in |
| Real-time updates | Another user checks in | List updates automatically |

---

## 8. Reconnaissance (Reko)

### 8.1 Reko Form
**Page:** `/reko?token=xxx&incident_id=xxx`

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Form loads | Open with valid token | Multi-step form displayed |
| Step 1: Relevance | Select Yes/No | Proceeds to next step |
| Step 2: Dangers | Check applicable dangers | Selections saved |
| Step 3: Effort | Enter personnel count, duration | Values validated |
| Step 4: Power | Enter power supply info | Text saved |
| Step 5: Photos | Upload photo(s) | Photos displayed |
| Step 6: Summary | Enter summary text | Text saved |
| Step 7: Notes | Enter additional notes | Notes saved |
| Auto-save | Fill partially → Close → Reopen | Draft restored |
| Submit | Complete all steps → Submit | Success page shown |
| Validation | Try to submit incomplete | Prevented with message |
| Photo delete | Upload photo → Delete | Photo removed |

Danger checkboxes to test:
- [ ] Fire/Smoke
- [ ] Explosion risk
- [ ] Hazmat
- [ ] Structural collapse
- [ ] Electrical hazard
- [ ] Other dangers

### 8.2 Reko Dashboard
**Page:** `/reko-dashboard?token=xxx`

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Dashboard loads | Open with valid token | Personnel list displayed |
| Select personnel | Click on Reko person | Their assignments shown |
| View incidents | Select person with assignments | Incident cards displayed |
| No assignments | Person with no assignments | Empty state message |
| Cookie persistence | Close → Reopen within 7 days | Last selected person remembered |
| Sort personnel | Click sort option | List reorders |

### 8.3 Reko Report Review (Editor)
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| View submitted report | Open incident with Reko report | Report details visible |
| Photos in report | Report with photos | Photos displayed |
| Multiple reports | Incident with multiple reports | All listed |

---

## 9. Training Mode

**Page:** `/training` (only for training events)

### 9.1 Access Control
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Live event | Select live event → Go to /training | Access denied |
| Training event | Select training event → Go to /training | Page accessible |
| Editor only | As viewer with training event | Access denied |

### 9.2 Emergency Generation
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Generate normal | Select "Normal" category → Generate | Normal-priority incident created |
| Generate critical | Select "Critical" category → Generate | High-priority incident created |
| Generate random | Select "Random" → Generate | Random type/priority incident |
| Burst mode | Set count to 5 → Generate | 5 incidents created |
| Template selection | View available templates | Templates listed |
| Location selection | View/select locations | Basel-Landschaft locations available |

---

## 10. Divera Integration

### 10.1 Divera Emergency Pool
**Page:** `/divera-pool`

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| View pool | Navigate to pool | Unattached emergencies listed |
| Search | Type in search | List filters |
| Select single | Click on emergency | Selected for attachment |
| Select multiple | Select several emergencies | All selected |
| Attach to event | Select → Choose event → Attach | Emergencies become incidents |
| Reject emergency | Delete/reject emergency | Removed from pool |
| Alert sound | New emergency arrives (webhook) | Sound plays, notification shown |

### 10.2 Auto-Attach
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Enable auto-attach | Edit event → Enable auto-attach | Setting saved |
| Incoming emergency | Divera sends emergency | Automatically attached to event |

---

## 11. Settings & Administration

**Page:** `/settings`

### 11.1 General Settings
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Home city | Change home city | Address formatting affected |
| Polling interval | Change interval | Data refresh rate changes |
| Map mode | Switch online/offline/auto | Map tile source changes |

### 11.2 Notification Settings
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Reko threshold | Set critical threshold | Notifications trigger at threshold |
| Assignment threshold | Set count | Warning when exceeded |

### 11.3 Synchronization
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| View sync status | Open sync tab | Current status displayed |
| Push to Railway | Click push | Data synced to production |
| Pull from Railway | Click pull | Data synced from production |
| Bidirectional sync | Click full sync | Both directions synced |
| View sync logs | Open logs | History displayed |

### 11.4 Audit Log
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| View all logs | Open audit tab | All actions listed |
| Filter by action | Select "Create" filter | Only create actions shown |
| Filter by resource | Select "Incident" filter | Only incident actions shown |
| Filter by date | Set date range | Only matching dates shown |
| View details | Click on log entry | Full details shown |

---

## 12. Import/Export

**Page:** `/settings` → Import/Export tab

### 12.1 Template Download
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Download template | Click download template | Excel file downloads |
| Template structure | Open downloaded file | Correct sheets and columns |

### 12.2 Import
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Upload file | Select Excel file | File accepted |
| Preview import | After upload | First 10 rows shown |
| Replace mode | Select replace → Execute | All existing data replaced |
| Merge mode | Select merge → Execute | Existing updated, new added |
| Append mode | Select append → Execute | New data added only |
| Invalid file | Upload wrong format | Error message |
| Validation errors | File with invalid data | Errors listed |

### 12.3 Export
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Export data | Click export | Excel file downloads |
| Export contents | Open exported file | Current data present |

### 12.4 Seed Training Data
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Seed data | Click seed training data | Sample data created |

---

## 13. Notifications & Real-Time Updates

### 13.1 Notification Center
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| View notifications | Click notification icon | Panel opens |
| Active notifications | Threshold exceeded | Notification appears |
| Dismiss | Click dismiss on notification | Notification removed |
| Threshold trigger | Exceed configured threshold | Notification created |

### 13.2 Toast Notifications
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Success toast | Create incident | Green success toast |
| Error toast | Cause an error | Red error toast |
| Info toast | Various actions | Info toast appears |
| Auto-dismiss | Wait after toast | Toast disappears |

### 13.3 Real-Time Updates (WebSocket)
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Incident created elsewhere | Another user creates incident | Appears without refresh |
| Check-in update | User checks in | List updates |
| Assignment update | Resource assigned | Both users see change |
| Divera emergency | New emergency via webhook | Notification and update |

### 13.4 Polling Updates
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Data refresh | Wait for polling interval | Data updates |
| Polling indicator | Watch network | Regular API calls |

---

## 14. Mobile Responsiveness

### 14.1 Layout Tests
| Test Case | Device/Width | Expected Result |
|-----------|--------------|-----------------|
| Phone portrait | 375px | Bottom nav, full-width cards |
| Phone landscape | 667px | Adjusted layout |
| Tablet portrait | 768px | Sidebar toggleable |
| Tablet landscape | 1024px | Full sidebar visible |
| Desktop | 1440px+ | Full layout with all panels |

### 14.2 Touch Interactions
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Tap to open | Tap incident card | Details open |
| Drag-drop (mobile) | Touch-drag incident | Status changes |
| Swipe sidebar | Swipe from edge | Sidebar opens |
| Pinch zoom (map) | Pinch on map | Map zooms |

### 14.3 Mobile Navigation
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Bottom nav | View on mobile | 4 nav items visible |
| Navigate pages | Tap each nav item | Page changes |
| Active indicator | On current page | Nav item highlighted |

---

## 15. Keyboard Shortcuts

### 15.1 Global Shortcuts
| Shortcut | Action | Test |
|----------|--------|------|
| `Cmd+K` / `Ctrl+K` | Open command palette | [ ] Works |
| `G` then `K` | Go to Kanban | [ ] Works |
| `G` then `M` | Go to Map | [ ] Works |
| `G` then `E` | Go to Events | [ ] Works |
| `R` | Refresh data | [ ] Works |

### 15.2 Kanban Shortcuts
| Shortcut | Action | Test |
|----------|--------|------|
| `N` or `+` | New incident | [ ] Works |
| `1-5` | Assign vehicle by order | [ ] Works |
| `Shift+1` | Priority Low | [ ] Works |
| `Shift+2` | Priority Medium | [ ] Works |
| `Shift+3` | Priority High | [ ] Works |
| Arrow keys | Navigate columns | [ ] Works |

### 15.3 Map Shortcuts
| Shortcut | Action | Test |
|----------|--------|------|
| `/` | Focus search | [ ] Works |
| `Z` | Reset zoom | [ ] Works |
| `E` / `Enter` | Open details | [ ] Works |

### 15.4 Command Palette
| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Open palette | Press Cmd+K | Palette opens |
| Search commands | Type partial command | Filtered results |
| Execute command | Select and Enter | Command runs |
| Search resources | Type personnel name | Personnel found |
| Close | Press Escape | Palette closes |

---

## Test Environment Setup

### Prerequisites
1. Docker and Docker Compose installed
2. `make dev` running (or local services)
3. Database seeded (`make seed-db`)
4. Editor and Viewer test accounts created
5. Multiple browser windows for real-time tests

### Test Accounts
| Username | Role | Purpose |
|----------|------|---------|
| `admin` | Editor | Full CRUD testing |
| `viewer` | Viewer | Read-only testing |

### Test Data
- At least 5 personnel (varied roles, availability)
- At least 3 vehicles (different types)
- At least 10 materials (different categories)
- At least 2 events (1 live, 1 training)
- Multiple incidents across different statuses

---

## Bug Reporting Template

When issues are found, document them with:

```markdown
## Bug: [Short Description]

**Page/Feature:**
**Steps to Reproduce:**
1.
2.
3.

**Expected Result:**

**Actual Result:**

**Screenshots:** (if applicable)

**Browser/Device:**
**Severity:** Critical / High / Medium / Low
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-01-22 | Initial comprehensive test guide |

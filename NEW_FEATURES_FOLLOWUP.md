# New Features Follow-Up Questions

**Date**: 2025-10-26
**Status**: Awaiting Answers
**Purpose**: Clarify remaining details before creating task specifications

---

## Feature 1: Bidirectional Sync - Behavior Clarification

### Q1a. Railway Recovery Scenario
When Railway comes back online after an outage and local changes were made:

- [ ] **Automatic**: Local instance detects Railway is up and auto-syncs changes TO Railway
- [ ] **Manual**: User must click "Sync to Railway" button
- [x] **Hybrid**: Show notification "Railway is back online, sync now?" with button

**Your choice**: [ YOUR ANSWER ]

---

### Q1b. Sync Direction Indicator
Should the UI show which direction sync is happening?
- Example: "↓ Syncing from Railway" vs "↑ Syncing to Railway"

- [x] Yes, show direction arrows/text
- [ ] No, just show "Syncing..." (simpler)

**Your choice**: [ YOUR ANSWER ]

---

### Q1c. Local Instance Startup
You mentioned local instance is "running on the computer somewhere." How should it start?

- [ ] Auto-start on system boot (systemd/launchd service) - always running in background
- [x] User manually starts when needed (docker-compose up)
- [x] Local instance embedded in desktop app (future consideration)

**Your choice**: [ YOUR ANSWER ]

**Additional notes**:
```
[ Any thoughts on local instance management? ]
```

---

## Feature 2: Notification System - Configuration Details

### Q2a. Training vs Live Alert Thresholds
You mentioned "two columns with time thresholds." Please clarify:

- [x] **Separate threshold values**
  - Example: Eingegangen alert at 60 min for Live, 120 min for Training
  - Same alert types, different durations

- [ ] **Completely different alert types**
  - Live mode has certain alerts, Training mode has different ones

- [ ] **Same thresholds, different severity**
  - Training alerts are "Info" level, Live alerts are "Warning/Critical"

**Your choice**: [ YOUR ANSWER ]

**Example threshold table** (fill in if option 1):
```
| Alert Type              | Live Threshold | Training Threshold |
|-------------------------|----------------|--------------------|
| Card in "Eingegangen"   | 60 min         | ___ min            |
| Card in "Reko"          | 60 min         | ___ min            |
| Card in "Disponiert"    | 20 min         | ___ min            |
| Card in "Einsatz"       | 2 hours        | ___ hours          |
| Card in "Rückfahrt"     | 20 min         | ___ min            |
| Card not archived       | 1 hour         | ___ hours          |
```

---

### Q2b. Critical Materials Depleted
What defines "depleted" for critical materials alert?

- [ ] Quantity reaches zero (none left)
- [x] Quantity below X threshold (specify: <settings by type> items remaining)
- [ ] Only specific materials flagged as "critical" in database
- [ ] All of the above (configurable per material)

**Your choice**: [ YOUR ANSWER ]

**Additional notes**:
```
[ Should materials have a "minimum quantity" field in database? ]
```

---

### Q2c. Event Data Size Limit
What triggers "Event approaching data size limits" alert?

- [ ] Number of incidents (threshold: _____ incidents)
- [x] Database size (threshold: 5 GB)
- [x] Photo storage size (threshold: 5 GB)
- [ ] Not needed - remove this alert
- [ ] Other: [ YOUR ANSWER ]

**Your choice**: [ YOUR ANSWER ]

---

## Feature 3: CSV/Excel Import - Column Definitions

### Q3a. Personnel Columns

Please mark each column as **Required (R)** or **Optional (O)**:

```
[R] name                    - R/O?
[O] role                    - R/O? (Examples: Fahrer, Maschinist, Atemschutz, Gruppenführer, etc.)
[O] divera_alarm_id         - R/O?
[O] phone_number            - R/O?
[O] availability_status     - R/O? (Default: "not-available" if not provided)
```

**Additional columns you want**:
```
[ YOUR ANSWER - list any other columns ]
```

**Default values** (if optional fields are empty):
```
role: [ default value? or leave empty? ] empty since some people have no special role
availability_status: "not-available"
divera_alarm_id: [ leave empty or N/A? ] empty
phone_number: [ leave empty ] empty
```

---

### Q3b. Vehicles Columns

Please mark each column as **Required (R)** or **Optional (O)**:

```
[R] name                    - R/O?
[R] type                    - R/O? (Enum: TLF, DLK, MTW, KDO, etc.)
[R] display_order           - R/O? (For sorting in UI: 1, 2, 3...)
[R] status                  - R/O? (Default: "available")
[ ] capacity                - remove
[ ] license_plate           - remove
[R] radio_call_sign         - R/O? (e.g., "Florian Oberwil 1")
```

**Additional columns you want**:
```
[ YOUR ANSWER - list any other columns ]
```

**Default values**:
```
status: "available"
display_order: [ auto-increment? or required? ]
capacity: [ leave empty or default? ]
```

---

### Q3c. Materials Columns

You said "quantity as duplicate entries" - confirming structure:

**Example CSV**:
```
name,type,location
Atemschutzgerät,Atemschutz,TLF 1
Atemschutzgerät,Atemschutz,TLF 1
Atemschutzgerät,Atemschutz,TLF 2
Schlauch C-52,Schläuche,TLF 1
```
= 2x Atemschutzgerät on TLF 1, 1x on TLF 2, 1x Schlauch on TLF 1

**Columns** - mark as **Required (R)** or **Optional (O)**:
```
[R] name                    - R/O?
[R] type                    - R/O? (Enum: Atemschutz, Schläuche, Werkzeug, etc.)
[R] location                - R/O? (Vehicle name or storage room)
[O] description             - R/O? (Additional details)
```

**Additional columns you want**:
```
[ YOUR ANSWER ]
```

**Is this structure correct?**
- [x] Yes, duplicate rows = multiple items
- [ ] No, I want: [ YOUR ALTERNATIVE STRUCTURE ]

---

### Q3d. Export Sanitization Options

You checked both "include all fields" AND "sanitized version (no PII)". How should this work?

- [ ] **Two export buttons**: "Export Full" and "Export Sanitized (no PII)"
- [ ] **Checkbox on export dialog**: ☐ Remove PII (phone numbers, Divera IDs)
- [ ] **Always export both**: Single click exports two files (full.xlsx + sanitized.xlsx)
- [x] **Other**: only export all fields which also include PII - i misclicked

**Your choice**: [ YOUR ANSWER ]

---

## Feature 4: Incident Export - Final Details

### Q4a. Assigned Resources Clarification

In Q28 you said NO "Assigned resources history" but in Q30 you said YES "Assignments with timestamps".

**I assume you want**:
- [x] YES - Include assignments (who/what was assigned and when)
- [ ] NO - Don't include assignments

**Format in export**:
```
Example:
Personnel: Max Mustermann (assigned 14:23), Anna Schmidt (assigned 14:25)
Vehicles: TLF 1 (assigned 14:20)
Materials: 2x Atemschutzgerät (assigned 14:23)

OR

Timeline view:
14:20 - TLF 1 assigned
14:23 - Max Mustermann assigned
14:23 - 2x Atemschutzgerät assigned
14:25 - Anna Schmidt assigned
```

**Preferred format**: [ YOUR ANSWER ]

---

### Q4b. PDF Layout Preferences

For the event export PDF, which structure?

- [x] **Cover page → Summary table → Individual incident pages**
  - Page 1: Event metadata (name, date, incident count)
  - Page 2-3: Table of all incidents (summary)
  - Page 4+: Each incident detailed report on separate page

- [ ] **Single long document with sections**
  - Event Overview section
  - Incident List section (table)
  - Detailed Reports section (all incidents one after another)

- [ ] **Separate PDFs per incident + 1 summary PDF**
  - event_summary.pdf (overview + table)
  - incident_001.pdf, incident_002.pdf, etc.
  - All zipped together

- [ ] **Other**: [ YOUR STRUCTURE PREFERENCE ]

**Your choice**: [ YOUR ANSWER ]

**Additional PDF requirements**:
```
[ Font size preferences? Logo placement? Page numbering? Footer text? ]
```

---

## Feature 6: Vehicle Tracking - Approach Selection

You mentioned "vehicle tracking would be amaaaazin but check/discuss feasibility."

### Option Comparison

**Option 1: Basic Status Tracking** ⭐ RECOMMENDED
- Vehicles manually update status in app: "En Route", "On Scene", "Returning", "Available"
- No GPS tracking, just workflow status
- Status visible on incident cards and map (static location from incident address)
- **Pros**: Simple, works offline, no external dependencies
- **Cons**: Manual updates required, no real-time location
- **Estimated time**: 8-10 hours
- **Implementation**: Add status field to vehicles, update UI to show status badges

**Option 2: GPS Tracking via Divera**
- Integrate with Divera API to pull vehicle locations
- Display moving markers on map in real-time
- Requires Divera subscription with GPS tracking enabled
- **Pros**: Real GPS tracking, minimal extra work if Divera supports it
- **Cons**: Requires Divera, internet connection, API complexity
- **Estimated time**: 20-24 hours
- **Question**: Does your Divera subscription include GPS tracking? Do vehicles have Divera app running on tablets/phones?

**Option 3: Custom GPS Tracking**
- Mobile app or GPS device in vehicle sends coordinates to backend
- Store location history in database
- Display tracks on map
- **Pros**: Full control, works offline (with local sync)
- **Cons**: Very complex, requires hardware/mobile app, overkill for your needs
- **Estimated time**: 40-60 hours
- **Not recommended** for your use case

### Your Decision

**Which option do you prefer?**
- [ ] Option 1: Basic Status Tracking (manual status updates)
- [x] Option 2: GPS via Divera (if available - please confirm you have access)
- [ ] Option 3: Custom GPS (not recommended)
- [ ] Skip for now - add in post-MVP phase

**Your choice**: just add a template task to add it at a later phase. divera is getting rolled out but ignore it for now

**If Option 2** (Divera GPS):
```
Do you have Divera GPS tracking enabled? [ Yes/No ]
Do vehicles run Divera app? [ Yes/No ]
Can you share Divera API docs link? [ URL or "will provide" ]
```

---

## Suggested Additional Features

Based on your workflow, these might be useful. Mark YES/NO/MAYBE for each:

### 1. Bulk Incident Actions
```
[ ] Select multiple incidents → Bulk archive
[ ] Select multiple incidents → Bulk export
[ ] Select multiple incidents → Bulk assign to vehicle/personnel
```
**Your answer**: NO

**Estimated time if YES**: 6-8 hours

---

### 2. Incident Templates
```
[ ] Save common incident configurations as templates
[ ] One-click create incident from template (pre-filled type, priority, typical assignments)
[ ] Useful for recurring scenarios or training
```
**Your answer**: No, minimal time required to create one anyway

**Example templates you'd want**:
```
[ e.g., "Wohnungsbrand" template, "Verkehrsunfall" template, "Ölspur" template, etc. ]
```

**Estimated time if YES**: 8-10 hours

---

### 3. Quick Stats Dashboard Widget
```
[x] Show on events page:
  - Active incidents count by status
  - Personnel availability count (X/Y available)
  - Average incident duration
  - Resource utilization percentage
```
**Your answer**: [ YES / NO / MAYBE - add to future phase ]

**Estimated time if YES**: 4-6 hours

---

### 4. Dark Mode / Theme Toggle
```
[ ] Dark mode option (easier on eyes during night operations)
[ ] Theme persists per user
```
**Your answer**: No, everything is dark already

**Estimated time if YES**: 6-8 hours

---

### 5. Mobile App Optimization
```
[ ] PWA (installable web app) for mobile
[ ] Offline mode for mobile viewers
[ ] Push notifications to mobile devices
```
**Your answer**: no

**Estimated time if YES**: 16-20 hours

---

## Implementation Timeline Confirmation

Based on your priority rankings, here's the proposed order:

**Phase 9: Data Management & Import** (Week 11)
- **9.1**: CSV/Excel Import System (Priority 1) - 12-16 hours

**Phase 10: Reliability & Sync** (Week 12)
- **10.1**: Bidirectional Railway ↔ Local Sync (Priority 2) - 16-20 hours

**Phase 11: Operations Enhancement** (Week 13-14)
- **11.1**: Dashboard Notification System (Priority 3) - 14-18 hours
- **11.2**: Incident Export for Legal Trail (Priority 4) - 12-16 hours

**Phase 12: Code Quality & Performance** (Week 15)
- **12.1**: Codebase Review & Performance Optimization (Priority 5) - 10-12 hours
- **12.2**: Vehicle Status Tracking (if included) - 8-10 hours

**Phase 13: Documentation** (Week 16)
- **13.1**: Comprehensive Help Documentation (Priority 6) - 10-12 hours

**Total**: ~82-104 hours across 6 weeks

**Additional features** (if you choose YES above):
- Bulk actions: +6-8 hours
- Templates: +8-10 hours
- Stats dashboard: +4-6 hours
- Dark mode: +6-8 hours
- Mobile PWA: +16-20 hours

**Does this timeline work for you?**
- [x] Yes, looks good
- [ ] Adjust: [ YOUR SUGGESTIONS ]

**Can you work on these in parallel with other tasks?**
- [x] Yes, I'll work on multiple tasks simultaneously
- [ ] No, prefer one task at a time
- [ ] Mix: [ YOUR PREFERENCE ]

---

## Final Checks

### Task Format Preference

For the detailed task specifications I'll create, do you want:

- [x] **Same format as existing tasks** (1.1, 6.2, etc.) - detailed steps, code examples, acceptance criteria
- [ ] **Condensed format** - key points only, less verbose
- [ ] **Mix**: Detailed for complex tasks, condensed for simple ones

**Your preference**: [ YOUR ANSWER ]

---

### Questions for Me

**Any questions or concerns before I start creating the task specifications?**
```
[ YOUR QUESTIONS/CONCERNS ]
```

---

## Ready to Proceed

Once you've answered the questions above, let me know and I'll create comprehensive task specifications for each feature in the `tasks/` directory.

**Checklist before proceeding**:
- [x] Feature 1 sync behavior clarified (Q1a, Q1b, Q1c)
- [x] Feature 2 notification settings defined (Q2a, Q2b, Q2c)
- [x] Feature 3 column definitions complete (Q3a, Q3b, Q3c, Q3d)
- [x] Feature 4 export format confirmed (Q4a, Q4b)
- [x] Feature 6 vehicle tracking approach selected
- [x] Additional features marked YES/NO/MAYBE
- [x] Timeline approved

**Save this file and let me know when ready!** 🚀

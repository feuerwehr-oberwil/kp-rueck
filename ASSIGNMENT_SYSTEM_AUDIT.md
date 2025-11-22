# Assignment System Audit & Pre-Planning/Next-Up Enhancement Analysis

**Date:** 2025-01-17
**Purpose:** Evaluate current assignment system and explore pre-planning and next-up functionality for tactical firefighting operations

---

## Executive Summary

The current assignment system is well-architected with a solid foundation for resource tracking. It already includes infrastructure for "planned" assignments (vehicles and materials), but this capability is **not actively used**. The system lacks:

1. **Pre-planning capability** - All assignments are immediate; no way to reserve resources for upcoming incidents
2. **Crew cohesion tracking** - Personnel are assigned individually with no grouping mechanism
3. **Next-up queue** - No system to designate crews as "ready for next emergency"
4. **Status consistency** - Vehicles/materials support "planned" status, but personnel do not

---

## Current System Architecture

### 1. Assignment Model

**Core Table: `incident_assignments`**
- Junction table connecting incidents to resources (personnel, vehicles, materials)
- Tracks assignment history with `assigned_at` and `unassigned_at` timestamps
- Soft deletion pattern preserves audit trail
- Supports concurrent assignments with conflict detection (allows override)

**Resource Types:**
- **Personnel** - Individual firefighters
- **Vehicles** - Fire apparatus (TLF, DLK, MTW, etc.)
- **Materials** - Equipment and resources

### 2. Resource Status System

**Vehicles & Materials:**
```
Status: available | assigned | planned | maintenance
```
✅ **Already supports "planned" status** - infrastructure exists but unused

**Personnel:**
```
Availability: available | assigned | unavailable
```
❌ **Missing "planned" status** - only binary available/unavailable

### 3. Assignment Workflow

**Current Flow:**
1. User assigns resource to incident
2. System creates `IncidentAssignment` record
3. Resource status updated to "assigned"
4. Frontend shows resource as unavailable for other incidents
5. On incident completion, resources auto-released to "available"

**Key Behaviors:**
- Conflict detection warns but allows override
- Personnel and vehicles auto-released when incident reaches "abschluss" status
- Materials kept assigned (may be left on site)
- All assignments are immediate - no delayed/planned assignments

### 4. Event-Scoped Assignments

**Important Design Decision:**
- Check-in system is **event-specific** (`event_attendance` table)
- Only checked-in personnel for an event appear in assignment pools
- Special functions (drivers, reko, magazin) are event-scoped
- Assignments are event-scoped through incident relationships

This creates clean separation between simultaneous training and live events.

---

## Identified Gaps & Opportunities

### Gap 1: No Pre-Planning Capability

**Current State:**
- All assignments are immediate and active
- No way to reserve resources for anticipated incidents
- "Planned" status exists in database but unused

**Business Impact:**
- Dispatchers cannot plan ahead for incoming alerts
- No visibility into resource allocation before confirmation
- Difficult to coordinate complex multi-incident scenarios

**Use Case Example:**
> Dispatcher receives preliminary alert about potential structure fire. Wants to pre-assign TLF 1 and 5 personnel to the incident while awaiting confirmation, without taking them offline for other emergencies.

### Gap 2: No Crew Grouping/Cohesion

**Current State:**
- Personnel assigned individually
- No concept of "crews" that work together
- No memory of which personnel typically operate as a unit

**Business Impact:**
- Repetitive assignment of same crew members
- Risk of splitting effective teams
- Difficult to track crew dynamics and training

**Use Case Example:**
> Crew of 5 firefighters just completed a rescue operation. They should stay together and be assigned as a unit to the next emergency, rather than being split across multiple incidents.

### Gap 3: No Next-Up Queue System

**Current State:**
- When incident completes, resources return to "available" pool
- No priority or readiness indication
- No differentiation between "just available" and "ready to deploy"

**Business Impact:**
- Unclear which crews are fresh vs. fatigued
- No systematic rotation of personnel
- Manual tracking of who's "up next"

**Use Case Example:**
> After completing an incident, a crew is marked as "next-up" with priority 1. When a new emergency arrives, they are automatically suggested or assigned as the first response team.

### Gap 4: Status Inconsistency

**Current State:**
- Vehicles/Materials: 4 statuses including "planned"
- Personnel: 3 statuses without "planned"
- Inconsistent data model across resource types

**Business Impact:**
- Cannot pre-plan personnel assignments
- Asymmetric feature parity
- Confusing mental model for users

---

## Proposed Enhancement Strategies

### Strategy 1: Enable "Planned" Assignments (Quick Win)

**Concept:**
Activate the existing "planned" status infrastructure for lightweight pre-planning.

**Changes Required:**
- Add "planned" to personnel availability constraint
- Update assignment logic to support planned mode
- Add UI toggle: "Assign Now" vs "Plan Assignment"
- Visual distinction (e.g., dotted border) for planned resources

**Benefits:**
- Minimal database changes
- Leverages existing infrastructure
- Immediate value for dispatchers
- Foundation for advanced features

**Challenges:**
- Need clear UI/UX for mode switching
- Conflict handling (can planned resource be immediately assigned elsewhere?)
- Workflow for converting planned → assigned

### Strategy 2: Implement Crew Grouping

**Concept:**
Allow grouping of personnel into reusable crews that can be assigned as units.

**Changes Required:**
- New `crew_groups` table with event scope
- Link assignments to crew groups
- Bulk assignment API for entire crew
- UI for creating/managing/assigning crews

**Benefits:**
- Maintains crew cohesion
- One-click assignment of entire team
- Enables crew-level analytics and tracking
- Supports training and team development

**Challenges:**
- Crews may change composition between events
- What happens when one crew member is unavailable?
- Should crews persist across events or be event-specific?

### Strategy 3: Next-Up Queue with Priority

**Concept:**
After incident completion, mark crews as "next-up" with priority levels for systematic rotation.

**Changes Required:**
- Add `next_up_priority` and `next_up_since` fields to personnel
- Queue management endpoints (mark next-up, clear next-up)
- UI widget showing next-up queue
- Optional: Auto-suggest next-up crew for new incidents

**Benefits:**
- Fair rotation of personnel
- Clear visibility into who's ready
- Reduces dispatcher cognitive load
- Supports fatigue management

**Challenges:**
- Priority system design (manual vs automatic)
- Queue expiration (how long is someone "next-up"?)
- Integration with crew grouping
- What if next-up crew is partially unavailable?

### Strategy 4: Multi-Mode Assignment System

**Concept:**
Support multiple assignment modes: Immediate, Planned, Next-Up, Standby.

**Changes Required:**
- Add `assignment_mode` metadata to assignments
- Enhanced conflict detection aware of modes
- Complex UI for mode selection
- Business rules for mode transitions

**Benefits:**
- Maximum flexibility
- Supports diverse operational scenarios
- Future-proof architecture

**Challenges:**
- Significant complexity increase
- Steep learning curve for users
- Potential for confusion
- Maintenance burden

---

## Recommended Implementation Path

### Phase 1: Foundation (Planned Status)
**Goal:** Enable basic pre-planning

**Scope:**
1. Add "planned" to personnel availability
2. UI toggle for immediate vs planned assignments
3. Visual distinction for planned resources
4. Simple conversion planned → assigned

**Effort:** Low (1-2 days)
**Value:** High (immediate dispatcher benefit)
**Risk:** Low (minimal changes)

---

### Phase 2: Crew Grouping (Optional)
**Goal:** Support crew cohesion

**Scope:**
1. Crew groups table (event-scoped)
2. Bulk assignment API
3. Crew management UI
4. Crew assignment widget

**Effort:** Medium (3-5 days)
**Value:** High (operational efficiency)
**Risk:** Medium (data modeling decisions)

**Decision Point:** Do crews persist across events or reset per event?

---

### Phase 3: Next-Up Queue (Optional)
**Goal:** Systematic crew rotation

**Scope:**
1. Next-up tracking fields
2. Queue management API
3. Next-up display widget
4. Auto-suggest integration

**Effort:** Medium (3-4 days)
**Value:** Medium (nice-to-have for larger operations)
**Risk:** Low (additive feature)

**Decision Point:** Manual priority assignment vs automatic rotation?

---

## Finalized Decisions (Phase 1: Planned Assignments)

**Decision Date:** 2025-01-17
**Updated:** 2025-01-17 (refined based on detailed UI/UX/architecture review)
**Scope:** Phase 1a - Minimal viable implementation for user testing

### 1. Planning Scope - Status-Based Rules

**Planning is ONLY allowed in first two Kanban columns:**
- ✅ **Column 1 "einsatz"** - Planning enabled
- ✅ **Column 2 "disponiert"** - Planning enabled
- ❌ **Column 3+ "unterwegs", "vor ort", etc.** - Planning disabled (assignments only)

**Auto-Conversion Logic:**
- When incident moves from columns 1-2 → column 3+, all "planned" resources automatically convert to "assigned"
- Once in column 3+, resources cannot be set to "planned" status
- This ensures planned resources become active assignments when incident becomes active

**Rationale:** Planning makes sense only in early dispatch/preparation phase. Once crews are en route, assignments are definitive.

### 2. UI/UX - Planning Mode Toggle

**Planning Mode State:**
- **Database Persistence:** `planning_mode` boolean field added to `incidents` table
- **Persistence Behavior:** Survives page reloads, stored in database
- **Auto-Disable:** When incident moves to column 3+, `planning_mode` set to `FALSE` in database
- **UI Visibility:** Toggle removed/hidden from UI for incidents in columns 3+

**In-Modal Toggle:**
- Planning toggle button visible in incident modal ONLY when incident is in columns 1-2
- Toggle enables "planning mode" for the incident
- When planning mode is active, subsequent assignments to that incident are created as "planned" instead of "assigned"
- Visual indicator shows incident is in planning mode (same style as REKO badge, positioned next to it)

**Toggle Behavior:**
- **When toggled OFF:** All existing planned assignments **convert to "assigned"** status
- **After toggle OFF:** Subsequent assignments are created as "assigned" (immediate)

**Keyboard Shortcut:**
- **Shortcut:** `Shift+P` (hover over incident card + press)
- **Behavior:** Toggles planning mode for the hovered incident
- **Also works:** When incident modal is open (applies to open incident)
- **Scope:** Only functions for incidents in columns 1-2

**Rationale:** Simple toggle mechanism that clearly indicates assignment intent. Keyboard shortcut enables rapid mode switching without opening modal. Database persistence ensures state survives page reloads and syncs across clients via WebSocket.

### 3. Resource Assignment Rules

**Multiple Planned Assignments Allowed:**
- Personnel/vehicles/materials can be "planned" for multiple incidents simultaneously
- **Condition:** All incidents must be in columns 1-2 (planning phase)
- Once any incident moves to column 3+, those resources become "assigned" and cannot be planned elsewhere

**Example Workflow:**
1. Person A planned for Incident X (column 1)
2. Person A also planned for Incident Y (column 1) ✅ Allowed
3. Incident X moves to "unterwegs" (column 3)
4. Person A now "assigned" to Incident X
5. Person A cannot be planned for Incident Z ❌ Blocked (already assigned)

**Rationale:** In planning phase, multiple scenarios can be prepared. Once incident activates, resources are committed.

### 4. Conflict Detection & Prevention

**Scenario 1: Person A assigned to Incident X, user tries to plan for Incident Y**

- **If Incident Y in columns 1-2:** ✅ Allow with warning
  - Warning: "Person A is currently assigned to Incident X. Planning for Incident Y anyway?"
  - Allows planning for future scenarios while person is on active incident

- **If Incident Y in columns 3+:** ❌ Block completely
  - Error: "Person A is already assigned to Incident X and cannot be assigned to another active incident."

**Scenario 2: Person A planned for Incident X, user tries to plan for Incident Y**

- **Both incidents in columns 1-2:** ✅ Allow without warning
  - Person A can be planned for multiple incidents in planning phase

- **Incident Y in columns 3+:** ❌ Block
  - Error: "Person A is planned for Incident X. Cannot assign to active incident."

**Rationale:** Planning is flexible and non-committal. Assigned status is exclusive and blocks conflicts.

### 5. Transfer Planned Assignments

**Feature:** Bulk transfer of all planned resources from one incident to another

**Location & Visibility:**
- **Always visible** in incident card footer menu
- **Disabled** (grayed out) when incident has zero planned assignments
- **Enabled** when incident has 1+ planned assignments

**Interaction Flow:**
- Click "Transfer Planned" button
- Opens **searchable dropdown** (CMD+K style interface)
- **Flat list** of all other incidents (no grouping by column)
- Select target incident → instant transfer
- **Toast confirmation:** "3 resources transferred to Incident X"

**Conflict Handling:**
- **Target in columns 3+:** Show confirmation dialog before auto-converting planned → assigned
  - Example: "Transferring to active incident will immediately assign 5 resources. Continue?"
- **Resource already assigned elsewhere:** **Block transfer** with warning dialog
  - Example: "Person X is already assigned to Incident Z and cannot be transferred."

**Status Logic:**
- **Source in columns 1-2, Target in columns 1-2:** Transfer as "planned" ✅
- **Source in columns 1-2, Target in columns 3+:** Auto-convert to "assigned" (with confirmation) ✅
- **Allows transfer to any incident** (system handles status conversion automatically)

**Rationale:** Always-visible button improves discoverability. Searchable dropdown enables quick selection from many incidents. Conflict handling prevents invalid states while maintaining user control.

### 6. Visual Distinction

**Planned Resource Indicator:**
- **Icon:** Calendar emoji (📅)
- **Color:** Blue hue (similar to existing REKO badge pattern)
- **Badge:** Icon-only, no text label, **no tooltip**
- **Placement:** On resource cards in assignment lists

**Planning Mode Indicator:**
- Visual indicator on incident card when planning mode is active
- **Same style as REKO badge**, positioned next to it
- Helps dispatchers remember that assignments will be planned, not immediate

**Resource Click/Navigation Priority:**
- All clicks on resources (personnel/vehicles/materials) navigate to **assigned** incident location
- **Ignore planned assignments** for navigation purposes
- Planned assignments only visible in assignment lists, not used for primary actions

**Rationale:** Clear visual feedback without cluttering UI. Consistent with existing REKO badge pattern. Icon-only keeps UI clean. Navigation priority ensures users always go to active incidents, not tentative plans.

### 7. Cleanup & Lifecycle

**Manual Cleanup:**
- Planned assignments persist until explicitly removed by user
- Removal UX: Same as removing assigned resources (**X button**)
- No special confirmation dialog for removal

**Auto-Conversion to Assigned:**
- **Timing:** Happens **instantly after WebSocket confirmation** (not optimistic)
- **Trigger:** When incident moves from columns 1-2 → column 3+
- **User Feedback:** **Toast notification** - "5 resources activated for Incident X"
- **Blocking:** If ANY planned resource is already on active emergency, **prevent drag** and show warning
  - Example: "Person X is already on active Incident Z and cannot be activated"
  - Incident **stays in original column** (drag canceled)

**Confirmation Dialog for Auto-Conversion:**
- **Always shown** when dragging from columns 1-2 → columns 3+
- Message: "This incident has 5 planned assignments. Moving to [Column Name] will activate all assignments."
- **"Don't ask again" checkbox:**
  - Preference stored in **session storage** (not persistent across browser close)
  - **Resets** on new event or cache clear
  - Per-user, per-session preference

**Auto-Release:**
- When incident reaches "abschluss" (completed), assigned → available
- Follows existing auto-release behavior (personnel/vehicles released, materials kept)

**Incident Deletion with Planned Assignments:**
- Show confirmation: "This incident has X planned assignments. Delete anyway?"
- On confirm: Delete incident and **auto-release** planned resources to "available"

**Planning Mode on Completed Incidents:**
- Planning toggle **hidden** for incidents in "abschluss" status
- Planning state can only exist in columns 1-2

**Lifecycle Flow:**
```
planned (columns 1-2)
  → assigned (column 3+, auto-convert on status change with confirmation)
  → available (on incident completion, existing behavior)
```

**Rationale:** Simple lifecycle with minimal automatic cleanup. Confirmation dialog prevents accidental activation. Session-scoped "don't ask again" balances safety with efficiency for experienced users.

### 8. Event Isolation

**Requirement:** Events must be completely separate - actions in Event A do not affect Event B

**Current Implementation:**
- ✅ Incidents filtered by `event_id` in all API endpoints
- ✅ Personnel check-ins are event-specific (`event_attendance` table)
- ✅ Special functions (drivers, reko, magazin) are event-scoped
- ✅ Frontend scopes all data fetching to selected event

**Critical Gap Found:**
- ❌ **Assignment conflict detection does NOT filter by event** (`backend/app/crud/assignments.py:36-45`)
- Current behavior: Person X assigned in Event A shows as conflicted when planning for Event B
- **Impact:** Violates event isolation requirement

**Required Fix Before Implementation:**
```python
# Current (BROKEN):
existing = await db.execute(
    select(IncidentAssignment).where(
        and_(
            IncidentAssignment.resource_type == resource_type,
            IncidentAssignment.resource_id == resource_id,
            IncidentAssignment.unassigned_at.is_(None),
            # Missing event_id filter!
        )
    )
)

# Fixed (EVENT-SCOPED):
# First, get event_id from incident
incident_result = await db.execute(
    select(Incident.event_id).where(Incident.id == incident_id)
)
event_id = incident_result.scalar_one()

# Check conflicts ONLY within the same event
existing = await db.execute(
    select(IncidentAssignment)
    .join(Incident, Incident.id == IncidentAssignment.incident_id)
    .where(
        and_(
            IncidentAssignment.resource_type == resource_type,
            IncidentAssignment.resource_id == resource_id,
            IncidentAssignment.unassigned_at.is_(None),
            Incident.event_id == event_id,  # ← ADD THIS
        )
    )
)
```

**Also Affects:**
- `check_resource_conflicts()` function (line 241-259) must also filter by event_id

**Expected Behavior After Fix:**
- Person X can be **planned** for Incident A (Event 1) AND Incident B (Event 2) simultaneously ✅
- Person X can be **assigned** to Incident A (Event 1) AND **planned** for Incident B (Event 2) ✅
- Conflict detection only checks incidents **within the same event**

### 9. Audit Logging

**All planning actions must be logged to `audit_log` table:**
- ✅ Planning mode enabled/disabled for incident
- ✅ Resource planned for incident
- ✅ Resource auto-converted from planned → assigned
- ✅ Planned assignments transferred between incidents

**Audit Log Fields:**
- `action_type`: "planning_mode_enabled", "planning_mode_disabled", "assignment_planned", "assignments_activated", "assignments_transferred"
- `resource_type`: "incident", "assignment"
- `resource_id`: Incident or assignment ID
- `changes_json`: Relevant details (resource IDs, counts, source/target incidents)

### 10. WebSocket Real-Time Updates

**New Event Types:**

**Planning Mode Changed:**
```json
{
  "event": "planning_mode_changed",
  "data": {
    "incident_id": "uuid",
    "planning_mode": true,
    "event_id": "uuid"
  }
}
```

**Assignment Planned:**
```json
{
  "event": "assignment_planned",
  "data": {
    "assignment_id": "uuid",
    "incident_id": "uuid",
    "resource_id": "uuid",
    "resource_type": "personnel" | "vehicle" | "material",
    "event_id": "uuid"
  }
}
```

**Assignments Activated (Auto-Conversion):**
```json
{
  "event": "assignments_activated",
  "data": {
    "incident_id": "uuid",
    "assignment_ids": ["uuid", "uuid", ...],
    "count": 5,
    "event_id": "uuid"
  }
}
```

**Assignments Transferred:**
```json
{
  "event": "assignments_transferred",
  "data": {
    "source_incident_id": "uuid",
    "target_incident_id": "uuid",
    "assignment_ids": ["uuid", ...],
    "count": 3,
    "event_id": "uuid"
  }
}
```

**Broadcasting Requirements:**
- Planning mode state must be included in incident payloads
- All connected clients in the same event receive updates
- Auto-conversion triggers `assignments_activated` broadcast
- Frontend updates planning mode indicator in real-time

### 11. Mobile/Tablet Support

**Keyboard Shortcut:**
- **Not available** on mobile/tablet devices
- No touch gesture equivalent (no long-press or swipe)

**Planning Toggle:**
- **Only accessible** via button in incident modal footer
- Button works on all devices (desktop, tablet, mobile)

**Rationale:** Desktop-first feature. Touch devices use button-only interface.

### 12. Out of Scope (Phase 1)

The following features are explicitly **NOT included** in Phase 1 testing:

- ❌ Crew grouping
- ❌ Next-up queue
- ❌ Auto-timeout of planned assignments
- ❌ Planning analytics/reporting
- ❌ Planned assignment notifications
- ❌ Tooltip explanations for planning badges

**Rationale:** Keep initial implementation minimal for user testing. Add features based on real-world feedback.

---

## Open Questions (Future Phases)

### Phase 2: Crew Grouping (If Needed)
- Should crews persist across events or be recreated each time?
- Can personnel belong to multiple crews in same event?
- What's the fallback if a crew member is unavailable?

### Phase 3: Next-Up Queue (If Needed)
- Manual priority assignment or automatic FIFO queue?
- How long does "next-up" status last? (timeout mechanism?)
- Should next-up integrate with crew grouping or be separate?

---

## Success Metrics

If implemented, measure:
1. **Time to assign resources** - Should decrease with crew grouping
2. **Planning accuracy** - How often planned assignments become actual assignments
3. **Crew rotation fairness** - Distribution of assignments across personnel
4. **User adoption** - Percentage of assignments using planned/next-up features
5. **Conflict frequency** - Number of resource conflicts before/after

---

## Next Steps

1. **Discuss open questions** with operational stakeholders
2. **Validate use cases** against real incident scenarios
3. **Decide on implementation scope** (Phase 1 only, or include Phase 2/3?)
4. **Review UI/UX mockups** for planned assignments
5. **Create detailed technical spec** for approved phases

---

## Technical Notes

### Database Schema Changes

**Required Migrations:**
```sql
-- Add planning_mode to incidents table
ALTER TABLE incidents ADD COLUMN planning_mode BOOLEAN DEFAULT FALSE;

-- Add 'planned' to personnel availability enum
ALTER TABLE personnel DROP CONSTRAINT valid_personnel_availability;
ALTER TABLE personnel ADD CONSTRAINT valid_personnel_availability
  CHECK (availability IN ('available', 'assigned', 'unavailable', 'planned'));
```

**No Changes Needed:**
- Vehicles already have "planned" status in CHECK constraint
- Materials already have "planned" status in CHECK constraint

### Database Constraints
- Event-scoped queries already efficient (indexed on event_id)
- `IncidentAssignment` has composite index on (resource_type, resource_id) for conflict checks

### Frontend Considerations
- Operations context already tracks assignments with Maps for O(1) lookup
- WebSocket updates support real-time sync across clients
- Auto-conversion happens **after WebSocket confirmation** (not optimistic)
- Polling fallback exists if WebSocket unavailable

### Session Storage for User Preferences
- "Don't ask again" for auto-conversion confirmation stored in `sessionStorage`
- Key: `planning_confirmation_dismissed` (scoped to current event)
- Cleared when:
  - Browser tab closed
  - User switches to different event
  - Cache cleared
  - New event created

### Backward Compatibility
- Phase 1 changes are backward compatible (additive)
- Existing incidents without `planning_mode` field default to `FALSE`
- Existing assignments continue to work (no status migration needed)
- Phase 2/3 require new tables but don't modify existing schema

---

## Appendix: Key Files

**Backend:**
- `backend/app/models.py` - Database models (IncidentAssignment, Personnel, Vehicle, Material, Incident)
- `backend/app/schemas.py` - API request/response schemas
- `backend/app/crud/assignments.py` - Assignment business logic **⚠️ REQUIRES EVENT-SCOPING FIX**
- `backend/app/crud/incidents.py` - Incident management (auto-release on completion)
- `backend/app/api/incidents.py` - Incident API endpoints

**Frontend:**
- `frontend/lib/contexts/operations-context.tsx` - State management and API sync
- `frontend/components/vehicle-status-sheet.tsx` - Vehicle assignment UI
- `frontend/app/page.tsx` - Main Kanban dashboard

**Critical Files Requiring Changes:**
1. **`backend/app/crud/assignments.py`** - Add event_id filtering to conflict detection (lines 36-45, 241-259)
2. **`backend/app/models.py`** - Add `planning_mode` field to `Incident` model
3. **`backend/app/schemas.py`** - Add planning-related request/response schemas
4. **`frontend/lib/contexts/operations-context.tsx`** - Add planning mode state management
5. **Alembic migration** - Create migration for database schema changes

---

## Implementation Checklist

**Phase 1 Implementation Tasks:**

### Backend
- [ ] Fix event-scoped conflict detection in `assign_resource()` and `check_resource_conflicts()`
- [ ] Create Alembic migration for `planning_mode` and personnel availability
- [ ] Add `planning_mode` field to `Incident` model
- [ ] Add planning mode toggle endpoint: `PATCH /incidents/{id}/planning-mode`
- [ ] Add transfer endpoint: `POST /incidents/{id}/transfer-planned`
- [ ] Update assignment logic to support planned status
- [ ] Implement auto-conversion on status change to columns 3+
- [ ] Add audit logging for all planning actions
- [ ] Add WebSocket events: `planning_mode_changed`, `assignment_planned`, `assignments_activated`, `assignments_transferred`

### Frontend
- [ ] Add planning mode toggle button to incident modal (styled like REKO badge)
- [ ] Add `Shift+P` keyboard shortcut handler (hover + modal support)
- [ ] Add "Transfer Planned" button to incident card footer (always visible, conditionally disabled)
- [ ] Create searchable transfer dropdown (CMD+K style)
- [ ] Add 📅 calendar badge for planned resources (blue theme, icon-only)
- [ ] Implement confirmation dialog for auto-conversion with "Don't ask again" checkbox
- [ ] Add session storage handling for confirmation preferences
- [ ] Update resource click navigation to prioritize assigned over planned
- [ ] Add toast notifications for transfer and auto-conversion
- [ ] Add blocking logic for drag when planned resources conflict

### Testing
- [ ] Test event isolation (Person X planned in Event A + Event B simultaneously)
- [ ] Test auto-conversion on column 3+ move
- [ ] Test conflict blocking when planned resource is on active emergency
- [ ] Test transfer with auto-conversion confirmation
- [ ] Test transfer blocking when conflicts exist
- [ ] Verify session storage "don't ask again" behavior
- [ ] Test planning mode persistence across page reloads
- [ ] Test WebSocket real-time updates across multiple clients
- [ ] Test mobile: planning button visible, no keyboard shortcut
- [ ] Test incident deletion with planned assignments

### Documentation
- [ ] Update ASSIGNMENT_SYSTEM_AUDIT.md (completed)
- [ ] Add user-facing documentation for planning feature
- [ ] Update API documentation (Swagger)

**Estimated Effort:** 1-2 days (as per original audit document)

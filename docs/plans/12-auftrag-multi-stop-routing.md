# Plan 12 — Aufträge: multi-stop group routing (Flächenlage batching)

**Priority:** P2 (post-publication feature)
**Scope:** Backend + frontend + map.
**Estimated size:** ~750 LOC + tests. Three phases:
- **Phase 1 (backend):** `incident_groups` table + `incidents.group_id`/`group_position`, CRUD, API, WS, migration. Independently shippable.
- **Phase 2 (frontend):** Aufträge sheet (checklist), Routen-Editor modal (map-first build + reorder + nearest-neighbor optimize), drag-to-assign/transfer resources onto routes & stops, squad vs. `vehicle_only` (shuttle) mode + copy-picker, board chips, plus the small GPS nearest-single-match guard.
- **Phase 3 (map):** read-only numbered polyline on `/map` **plus** an opt-in Routenplanung edit mode (build/reorder routes on the big map). Clean follow-on reusing Phase 2 components.

## Goal

During a **Flächenlage** (storm / mass-incident wave — many small jobs: fallen
trees, flooded cellars) the operator can group several incidents into an ordered
**Auftrag** (route) and hand it to one squad (a vehicle + a few people) to work
through: "geh dorthin, dann dorthin, dann dorthin." The squad is assigned across all
stops in one action, and the ordered route is drawn on the map as a numbered
polyline.

An Auftrag is **built and grown live**, not frozen before dispatch: the operator
seeds a route with the stops known so far, hands it to the squad, and keeps
**appending stops as new incidents come in** during the wave. The order is a
suggestion the operator can re-shuffle (or auto-optimize) at any time — including
after the squad is already working it.

An Auftrag is a **lightweight ordered container over real incidents** — not a new
kind of job. Each stop stays a first-class Incident with its own
status/reko/priority/print/GPS. This maximizes reuse of the existing board, map,
assignment, and print machinery.

## Design decisions (final — do not change)

These were confirmed by the requester (2026-07-21). Do not re-litigate.

1. **Stops are real incidents (Option A).** An Auftrag groups existing
   `incidents` rows into an order. No new "stop"/"task" entity, no second thing on
   the map. The only new table is the group itself.
2. **Primary use case: storm / mass-incident batching.** Routes are built **live**
   from incoming incidents (drag existing cards into an Auftrag, or add a stop via
   a streamlined create). Reusable **templates are out of scope** for this plan
   (see Out of scope). Training works for free — stops are incidents, so
   `training_flag`/event scoping already applies.
3. **The Auftrag IS a checklist — no lifecycle of its own.** It has no status
   column and no state machine. Its "state" is purely the derived roll-up of its
   stops' incident statuses: each stop is a checklist item that reads
   `offen` / `läuft` / `erledigt` straight from that incident's status
   (`erledigt` = `einsatz_beendet`/`abschluss`), and the header shows `2/6 erledigt`.
   Ordering (`group_position`) is a **suggestion** — the squad may work stops in any
   order; completing one does not auto-advance another. Incident status stays
   any→any as today.
4. **Map-first editing in a modal (Phase 2) AND a routing-plan mode on `/map`
   (Phase 3).** Building a route by clicking/reordering on a map is more intuitive
   than a plain list, so Phase 2 ships a dedicated **Routen-Editor modal** with an
   embedded map (add stop by clicking, drag markers/list to reorder, one-click
   nearest-neighbor optimize). Phase 3 brings the **same editing** to the full-screen
   `/map` page as an opt-in **"Routenplanung"** mode (not just a read-only polyline) —
   same shared components, more screen real estate. A plain ordered list remains the
   keyboard/touch-fast fallback in both.
5. **Resourcing is per-incident, drag-first, with two modes.** Assignments stay
   per-incident (reuses conflict detection, board rendering, GPS lines, print slips
   unchanged). Resources reach a route by **drag-and-drop** — drop a vehicle/person/
   material onto an Auftrag row or onto a stop card (in the sheet or the Routen-Editor)
   → it assigns, routing through the existing vehicle-conflict / `transfer_assignments`
   path when it's already committed elsewhere. Then **"auf alle Stops übernehmen"**
   copies down the route, honoring the Auftrag's **mode**:
   - **`squad`** (default): the vehicle **and** its crew move together — copy vehicle
     + personnel + material to every stop.
   - **`vehicle_only`** (shuttle / Pendeldienst): only the **vehicle's** route is
     shared across stops; **personnel are assigned to individual incidents
     independently** and are *not* copied. Because assignments are already
     per-incident, this needs no new plumbing — just a resource-type filter on the
     copy action + a mode flag that sets its default and labels the header
     ("TLF 1 · Pendeldienst" vs "TLF 1 · 3 Pers").
   The copy action is a small picker (Fahrzeug / Personen / Material checkboxes)
   pre-set from the mode, so either behavior is one confirm. A group-level
   single-source assignment (one assignment row shared by all stops) is still **not**
   built here (Out of scope).
6. **GPS arrival auto-advance is reused, not rebuilt.** The existing Rule A
   (`disponiert → einsatz` on arrival) already fires per stop for free; the route
   feature adds one small guard so clustered stops don't double-advance. See the
   dedicated section below.

**Naming:** the German user-facing term is **Auftrag** (plural **Aufträge**).
Internally the entity/table is `incident_group` to avoid overloading "Auftrag" in
code and to sit naturally next to `incidents`. Avoid the names `Group`/`Gruppe`
(collides with `MaterialGroup` and the tactical "Gruppe" unit) and `Route` (only a
lucide icon today).

## User walkthrough (operator's view)

A storm-night scenario, click by click. Three UX calls (marked ⚑) were resolved to
the recommended default; they're cheap to flip.

**⚑ Entry:** a new **"Aufträge"** button in the footer bar (next to
Check-in/Fahrzeuge/Druck), matching the footer-sheet pattern.
**⚑ Create:** inline (name field + color swatch), no modal — storm speed.
**⚑ Squad:** assign one stop via the existing `ResourceAssignmentDialog`, then
"copy to all" — reuses the known dialog, no second assignment surface.

0. **Storm starts (existing).** Calls arrive; the board fills with `eingegangen`
   cards. Six small jobs, two squads. This is the moment the feature is for.
1. **Open the sheet.** Tap footer **"Aufträge"** → bottom sheet slides up
   (`activeFooterSheet = 'auftraege'`), empty but for `[+ Neuer Auftrag]`.
2. **Create the route.** Click `[+ Neuer Auftrag]` → an inline row appears: name
   field (prefilled `Auftrag 1`) + color swatch. Type "Sturm-Route West", pick a
   color, Enter → empty collapsible row `▾ ● Sturm-Route West — kein Squad — 0/0`.
3. **Add stops (three ways).** (a) **Drag** an existing board card onto the route row
   → card stays on the board but gains an `● West · 1` chip; sheet shows `0/1`.
   Repeat for four jobs. (b) `[+ Stop]` → the New-Emergency modal, pre-tagged to the
   route, for a job not yet on the board. (c) Click the map in the Routen-Editor
   (step 5).
4. **Assign the squad once.** `[Squad zuweisen]` → existing `ResourceAssignmentDialog`
   scoped to stop 1; pick TLF 1 + 3 people (existing driver prompt if needed). The
   button becomes `[Squad auf alle übernehmen]` → one click copies the squad to
   stops 2–4; toast "Squad auf 3 weitere Stops übernommen". Header now
   `TLF 1 · 3 Pers`; all four cards show the crew + chip.
5. **Order it (the intuitive part).** `[🗺 Routen-Editor]` → modal with numbered pins
   ①②③④ + connecting line on the map, ordered list on the right. Drag a list row (or a
   pin) to reorder — the map renumbers live. Or `[⟲ Reihenfolge optimieren]` with
   "Start ab: Magazin" → nearest-neighbor re-sort, preview, `[Übernehmen]`. Click
   empty map → drops a pin, reverse-geocodes, opens New-Emergency prefilled → appends
   as a stop.
6. **Dispatch & work it (mostly existing).** As cards move to `disponiert`/`einsatz`
   — by drag or by GPS — the checklist mirrors it live: `○ offen → ◔ läuft →
   ✓ erledigt`, counter climbs. GPS: as the tracker enters each stop's radius and
   dwells, that stop auto-advances `disponiert → einsatz` (or the existing arrival
   prompt) — the operator watches the checklist tick over hands-free.
7. **Route grows mid-storm.** Two more trees reported → drag the two new cards onto
   the route (append as stops 5–6, `2/6`), click `[Squad auf alle übernehmen]` again
   (already-assigned stops report "bereits zugewiesen"), optionally re-optimize.
8. **Close out.** Each finished stop shows `✓ erledigt` (operator or the field
   "Einsatz beendet" report). At `6/6`, `[⋯] → Auftrag löschen`; confirmation notes
   "Die 6 Einsätze bleiben auf dem Board." Route + chips vanish; incidents stay in
   their columns for the record.

**Assigning by drag (any step above).** Instead of the dialog, the operator can drag
a vehicle/person/material chip straight from the board or the Fahrzeuge/Check-in sheet
**onto an Auftrag row** (assigns to the whole route, mode-aware) or **onto a single
stop** (just that one). If the vehicle is busy elsewhere, the familiar
"verschieben vs. behalten" prompt handles the transfer — same as on the board today.

**Variant — Pendeldienst / shuttle (`vehicle_only` mode).** The operator flips the
route's header toggle to **`Nur Fahrzeug`**. Now "auf alle übernehmen" copies **only
TLF 1** down the stops — the vehicle's shuttle run. **People are assigned to
individual incidents independently**: the operator drags 2 people onto stop 1 (they
work there), a different 2 onto stop 3, and leaves stop 2 crewless because the vehicle
is only passing through. The header reads `TLF 1 · Pendeldienst`; the checklist and
map still track the vehicle's route, but personnel live on whichever stop they're
actually working — never auto-copied.

## Data model

### New table `incident_groups` (`backend/app/models.py`, next to `Incident` ~L322)

Mirror the `Incident` conventions (UUID PK, event scope, soft delete, `position`):

- `id: Mapped[UUID]` PK `default=uuid4`
- `event_id: Mapped[UUID]` FK `events.id` `ondelete="CASCADE"`, `nullable=False`, indexed
- `name: Mapped[str]` `String(255)`, `nullable=False`
- `color: Mapped[str | None]` `String(20)`, `nullable=True` — hex/token for map+board tint
- `mode: Mapped[str]` `String(20)`, `nullable=False`, `default="squad"`, `server_default="squad"` — `squad` (vehicle+crew move together) or `vehicle_only` (shuttle: only the vehicle's route is shared, crew assigned per-incident). Drives the copy-picker default + header label. Add a `CheckConstraint("mode IN ('squad', 'vehicle_only')", name="valid_group_mode")`.
- `notes: Mapped[str | None]` `Text`, `nullable=True`
- `position: Mapped[int]` `Integer`, `nullable=False`, `default=0`, `server_default="0"` — order among Aufträge in the event (mirrors `Incident.position`)
- `created_at` / `updated_at` timestamptz (copy the `Incident` pattern)
- `created_by: Mapped[UUID | None]` FK `users.id`
- `deleted_at: Mapped[datetime | None]` — soft delete (mirror `Incident.deleted_at`)
- Relationships: `event`, `creator` (User), `incidents` (the member stops, **`viewonly` list ordered by `group_position`** — the FK lives on `incidents`, see below; do **not** cascade-delete incidents when a group is deleted)
- Add to `Event`: `incident_groups` relationship with `cascade="all, delete-orphan"` (mirror `Event.incidents` ~L239) so deleting an event cleans up its groups.
- Index: `Index("idx_incident_groups_event_position", "event_id", "position")`

### Two new columns on `incidents` (`backend/app/models.py` Incident, ~L359 near `position`)

- `group_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("incident_groups.id", ondelete="SET NULL"), nullable=True, index=True)`
  — `SET NULL` so deleting an Auftrag leaves its stops on the board, ungrouped.
- `group_position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")`
  — order of the stop within its Auftrag (mirrors `position` exactly).
- Index: `Index("idx_incidents_group_position", "group_id", "group_position")`
  (partial-ish; fine as a plain composite index).

### Migration

`just db new "add incident_groups and incident.group_id"` →
`backend/alembic/versions/<hash>_add_incident_groups.py` (follow the existing
`b4d1e0a7c9f2_add_incident_position.py` style: `create_table` + two `add_column`
with `server_default="0"`/nullable, and the indexes). Production applies it on boot
via `start.sh` (`alembic upgrade head`).

## Schemas (`backend/app/schemas/`)

New `backend/app/schemas/groups.py` (register in `schemas/__init__.py` like the
others):

- `IncidentGroupBase`: `name` (non-empty, ≤200 validator), `color: str | None`, `mode: Literal["squad", "vehicle_only"] = "squad"`, `notes: str | None` (≤2000)
- `IncidentGroupCreate(IncidentGroupBase)`: `event_id: UUID`
- `IncidentGroupUpdate`: all optional (partial PATCH — includes `mode` toggle)
- `IncidentGroupResponse(IncidentGroupBase)`: `id, event_id, position, created_at, updated_at, created_by`, plus derived read fields:
  - `stop_ids: list[UUID]` — member incident ids in `group_position` order
  - `progress: GroupProgress` where `GroupProgress { total: int, done: int }` (`done` = stops in `einsatz_beendet`/`abschluss`)
- `IncidentGroupReorder`: `event_id: UUID` + `ordered_ids: list[UUID]` — reorder Aufträge (verbatim copy of `IncidentReorder`, `schemas/incidents.py:171-175`)
- `GroupStopsReorder`: `ordered_ids: list[UUID]` — reorder stops within one group
- `AddStopsRequest`: `incident_ids: list[UUID]` — attach existing incidents as stops
- `CopySquadRequest`: `source_incident_id: UUID` + `resource_types: list[Literal["vehicle","personnel","material"]] | None = None` — copy the source stop's active assignments to all siblings, filtered to `resource_types`. `None` → derive from the group's `mode` (`squad` = all three; `vehicle_only` = `["vehicle"]`).

Extend existing incident schemas (`schemas/incidents.py`):
- `IncidentBase`/`IncidentCreate`: add optional `group_id: UUID | None = None` so the streamlined "add stop" can create an incident already attached.
- `IncidentUpdate`: add `group_id: UUID | None` (allow attach/detach via normal PATCH).
- `IncidentResponse`: add `group_id: UUID | None` and `group_position: int = 0`.

## CRUD (`backend/app/crud/`)

New `backend/app/crud/groups.py`:
- `create_group`, `update_group`, `list_groups_by_event` (exclude `deleted_at`, order by `position`; batch-load member incidents ordered by `group_position` and compute `progress`), `soft_delete_group` (set `deleted_at`; **null out `group_id` on member incidents** in the same txn so they stay on the board).
- `reorder_groups(event_id, ordered_ids)` — clone `reorder_incidents` (`crud/incidents.py:583-624`): load groups by `event_id` + `id IN ordered_ids`, `enumerate` → `position = index`, ignore unknown ids, commit if changed.
- `reorder_group_stops(group_id, ordered_ids)` — same pattern on `incidents.group_position`, scoped to `group_id`.
- `add_stops_to_group(group_id, incident_ids)` — set `group_id` and append `group_position = current_max + 1 + i` for each; verify each incident is in the group's event.
- `remove_stop_from_group(incident_id)` — set `group_id = None` (leave status/board untouched).
- `copy_squad_to_stops(group_id, source_incident_id, resource_types=None)` — resolve `resource_types` from the group's `mode` when `None` (`squad` → all three; `vehicle_only` → `["vehicle"]`); read active assignments of the source incident (`get_incident_assignments`, `crud/assignments.py:184-196`), **filter to `resource_types`**; for every **other** stop in the group, call the existing `assign_resource` (`crud/assignments.py:15-95`) per resource, **swallowing the "already active on this incident" `ValueError`** (idempotent) and honoring its existing cross-incident conflict behavior (allow with the same UI warning path). Single audit summary. Return `{copied: int, skipped: int}`. In `vehicle_only` mode this copies only the vehicle down the route; personnel/material stay whatever each stop was assigned independently.

Extend `create_incident` (`crud/incidents.py:194-237`): if `group_id` is set, compute
`group_position = max(existing in group) + 1`. Extend `update_incident`
(`crud/incidents.py:283-398`) to accept `group_id` changes (attach/detach; when
attaching, stamp `group_position` to end).

Extend `get_incidents` select to hydrate `group_id`/`group_position` (they're plain
columns, so `IncidentResponse` picks them up automatically once added).

## API (`backend/app/api/groups.py`, mount in `main.py` like other routers)

`router = APIRouter(prefix="/incident-groups", tags=["incident-groups"])`:
- `GET /incident-groups/?event_id=<uuid>` — `CurrentUser`; list with `stop_ids` + `progress`.
- `POST /incident-groups/` — `CurrentEditor`; verify event exists; WS `group_update` action `create`.
- `PATCH /incident-groups/{group_id}` — `CurrentEditor`; rename/color/notes; WS `group_update` `update`.
- `DELETE /incident-groups/{group_id}` — `CurrentEditor`; soft delete; WS `group_update` `delete` **and** an incident refresh signal (stops changed `group_id`).
- `POST /incident-groups/reorder` — `CurrentEditor`; `IncidentGroupReorder`; 204; WS `group_update` `reorder` with `{event_id, ordered_ids}` (mirror `POST /incidents/reorder`, `api/incidents.py:252-275`).
- `POST /incident-groups/{group_id}/stops/reorder` — `CurrentEditor`; `GroupStopsReorder`; 204; WS.
- `POST /incident-groups/{group_id}/stops` — `CurrentEditor`; `AddStopsRequest`; WS + incident refresh.
- `DELETE /incident-groups/{group_id}/stops/{incident_id}` — `CurrentEditor`; detach; WS + incident refresh.
- `POST /incident-groups/{group_id}/copy-squad` — `CurrentEditor`; `CopySquadRequest`; returns `{copied, skipped}`; WS assignment refresh (assignments changed on multiple incidents).

Rate limit: reuse the default limiter; add `RateLimits.GROUP_WRITE` only if
mutation volume warrants (unlikely). Adding a stop via streamlined create just uses
the existing `POST /incidents/` (now accepting `group_id`).

**Sync version:** extend the `GET /incidents/sync-version` hash (`api/incidents.py:96-142`)
to fold in `incident_groups` (max `updated_at` + count) so the 5 s polling fallback
notices group changes even if a `group_update` WS event is missed.

## WebSocket (`backend/app/websocket_manager.py`)

Add a `group_update` broadcast helper mirroring the incident broadcast. Emit on all
group mutations above with `{action, group_id, event_id, ...}`. Membership/stop
changes additionally rely on the existing `incident_update` path (a stop's
`group_id` changing is an incident update).

## Frontend

### Types + api-client

- `frontend/lib/api/types/groups.ts`: `ApiIncidentGroup { id, event_id, name, color, notes, position, stop_ids, progress: { total, done } }`.
- `frontend/lib/types/` client `IncidentGroup` (camelCase, dates as needed).
- Add `group_id: string | null`, `group_position: number` to `ApiIncident`
  (`frontend/lib/api/types/incidents.ts:33-78`) and to the client `Operation`
  (`operations-context.tsx:45-80`), populated in `apiIncidentToOperation`
  (`operations-context.tsx:339-386`).
- Add `mode: "squad" | "vehicle_only"` to `ApiIncidentGroup` and the client `IncidentGroup`.
- `frontend/lib/api-client.ts` (next to `reorderIncidents` at :430): `getIncidentGroups(eventId)`, `createIncidentGroup`, `updateIncidentGroup`, `deleteIncidentGroup`, `reorderIncidentGroups(eventId, orderedIds)`, `reorderGroupStops(groupId, orderedIds)`, `addStopsToGroup(groupId, incidentIds)`, `removeStopFromGroup(groupId, incidentId)`, `copyGroupSquad(groupId, sourceIncidentId, resourceTypes?)`.
- Resources reach a route via existing endpoints — no new assign API. Dragging a resource onto a route/stop calls `apiClient.assignResource(stopIncidentId, {...})`; a resource already committed elsewhere routes through the **existing** vehicle-conflict prompt / `transferAssignments` (`api-client.ts:473`) path unchanged.

### State — new `groups-context.tsx` (do NOT bloat operations-context)

Follow the **`materials-context.tsx` precedent** (separate context re-exposed via
providers). Holds `groups`, `isLoaded`, CRUD mutators with optimistic update +
rollback, subscribes to the `group_update` WS event and folds into the existing
subscription block (`operations-context.tsx:858-871` is the model), and uses the
same 5 s `getSyncVersion` fallback. `operations-context` stays the source of truth
for the stops themselves (their `group_id` already rides `incident_update`).

### Aufträge panel (Phase 2 — the always-visible list)

Add `'auftraege'` to the `activeFooterSheet` union (see project memory "Footer
Sheet Pattern"; `'checkin' | 'reko' | 'viewer' | 'alarm' | 'vehicles' | 'print' | 'thermo' | null`).
New `frontend/components/kanban/auftraege-sheet.tsx`. This is the roster of routes;
the actual route *building* happens in the Routen-Editor modal (next section).

Layout — each Auftrag is a collapsible row showing its squad and derived progress;
expanding reveals the ordered checklist:

```
┌─ AUFTRÄGE ─────────────────────────────── [+ Neuer Auftrag] ─┐
│                                                              │
│ ▾ ● Sturm-Route West      TLF 1 · 3 Pers      3/6 erledigt   │
│     1. ✓ Baum Hauptstr. 12          erledigt   [Karte] [⋯]   │
│     2. ✓ Baum Feldweg 3             erledigt                 │
│     3. ◔ Keller Ringstr. 8          läuft                    │
│     4. ○ Baum Schulweg 5            offen                    │
│     5. ○ Ast Bahnhofstr. 2          offen                    │
│     6. ○ Keller Gartenweg 9         offen                    │
│     ─────────────────────────────────────────────────────   │
│     [+ Stop] [🗺 Routen-Editor] [Squad auf alle übernehmen]  │
│                                                              │
│ ▸ ● Sturm-Route Ost       MTW · 2 Pers        0/4 erledigt   │
│ ▸ ○ (ohne Squad)          —                   1/3 erledigt   │
└──────────────────────────────────────────────────────────── ┘
```

- **Checklist item state** comes straight from each stop's incident status:
  `✓ erledigt` (`einsatz_beendet`/`abschluss`), `◔ läuft` (`einsatz`), `○ offen`
  (everything before). No new state stored — this is decision #3 made visible.
- **Progress badge** `3/6 erledigt` = derived `progress.done`/`progress.total`.
- **`[Karte]`** on a stop pans the (already-open, or opens the) Routen-Editor to
  that marker. **`[⋯]`** = Stop entfernen / Als erledigt markieren (jumps the
  incident status) / Details öffnen (existing `OperationDetailModal`).
- **Add stops** three ways: (a) **`[+ Stop]`** → streamlined create (reuse
  `NewEmergencyModal` prepopulating `group_id`); (b) **drag an existing kanban card**
  onto the Auftrag row — add a `group-stop` drop target handled in
  `lib/hooks/use-kanban-drag-drop.ts` (`onDrop`, :65-222) → `addStopsToGroup`;
  (c) inside the Routen-Editor by clicking the map (next section).
- **Reorder** stops by dragging within the expanded checklist (pragmatic-dnd) →
  `reorderGroupStops`.
- **Drag resources onto a route or a stop.** The same pragmatic-dnd payload types the
  board already emits — `driver-vehicle`, `person`, `material`, `material-group` — get
  two new drop targets: the **Auftrag row header** and each **stop checklist row**.
  Dropping on a *stop row* assigns to that one incident; dropping on the *header*
  assigns to the route's designated source stop **and** immediately runs the copy so
  it lands on every stop (mode-aware). Both go through the existing
  `assign*ToOperation` mutators, so the existing **vehicle-conflict "verschieben vs.
  behalten"** prompt and the driver prompt fire exactly as on the board — that *is*
  the "transfer" affordance (drag a vehicle off another incident/route onto this one →
  prompt → move). Handled in the same `onDrop` switch (:65-222).
- **Mode toggle.** The Auftrag header carries a small segmented control
  **`[Squad | Nur Fahrzeug]`** (`mode` = `squad` / `vehicle_only`). It sets the header
  label (`TLF 1 · 3 Pers` vs `TLF 1 · Pendeldienst`) and the copy default. Toggling is
  a `updateIncidentGroup({ mode })` PATCH; it does **not** retroactively unassign — it
  only changes what the next "übernehmen" copies.
- **Copy to all stops.** `[… auf alle übernehmen]` opens a tiny picker prefilled from
  `mode` — checkboxes **`☑ Fahrzeug ☑ Personen ☑ Material`** (shuttle preset:
  only `Fahrzeug`). Confirm → `copyGroupSquad(groupId, sourceIncidentId, resourceTypes)`;
  result toast (`sonner`): `"Auf 5 Stops übernommen · 1 bereits zugewiesen"`.

Example flow (storm): operator opens the sheet, `[+ Neuer Auftrag]` → names
"Sturm-Route West", picks a color. Four calls already sit on the board as
`eingegangen` cards → drags them onto the row (or opens the Routen-Editor and clicks
them on the map). Assigns TLF 1 + 3 people to stop 1, clicks "Squad auf alle
übernehmen". Ten minutes later two more trees are reported → the operator drags those
two new cards onto the same row; they append at positions 5–6 and inherit the squad
on the next "übernehmen" (or are picked up individually).

### Routen-Editor modal (Phase 2 — map-first building)

New `frontend/components/kanban/routen-editor-modal.tsx`. A focused dialog for one
Auftrag that makes ordering intuitive — a map beside the ordered list, kept in sync:

```
┌─ Routen-Editor · Sturm-Route West ───────────────────── [✕] ┐
│ ┌───────────────────────┐  Reihenfolge                      │
│ │        [map]          │  ⠿ 1. Baum Hauptstr. 12    ✓       │
│ │     ②      ③          │  ⠿ 2. Baum Feldweg 3       ✓       │
│ │   ①    ┌─④            │  ⠿ 3. Keller Ringstr. 8    ◔       │
│ │    \___/   ⑤          │  ⠿ 4. Baum Schulweg 5      ○       │
│ │        ⑥              │  ⠿ 5. Ast Bahnhofstr. 2    ○       │
│ │  ★ Start (Magazin)    │  ⠿ 6. Keller Gartenweg 9   ○       │
│ └───────────────────────┘                                   │
│ Start ab: [Magazin ▾]      [⟲ Reihenfolge optimieren]       │
│ Klick auf Karte = Stop hinzufügen        [Fertig]           │
└──────────────────────────────────────────────────────────── ┘
```

- **Reuse the Leaflet stack** already in `map-view.tsx` (react-leaflet). Render the
  group's stops as **numbered markers** in `group_position` order + a solid
  `<Polyline>` (same component as Phase 3, `group-routes.tsx`).
- **Click-to-add:** a map click with a pending "Stop hinzufügen" mode drops a marker,
  reverse-geocodes via the existing `LocationInput` geocoder, and opens the
  streamlined create prefilled with those coords + `group_id`.
- **Reorder** by dragging list rows (`⠿` handle) *or* dragging markers into a new
  slot; both persist via `reorderGroupStops`. Map and list stay in sync from the
  same `groups-context` state.
- **Drag resources onto the modal's stop rows** (and onto a marker) to assign — the
  modal renders the same available-resources rail the board uses (or accepts drags
  from the Fahrzeuge/Check-in sheets), reusing the board drop payloads +
  vehicle-conflict/driver prompts. This makes assigning a vehicle to "the next few
  stops" a direct drag onto those rows.
- **`[⟲ Reihenfolge optimieren]`** — client-side greedy **nearest-neighbor** over the
  located stops from a chosen **start** (`Start ab:` = Magazin/Feuerwehrhaus home
  coords, or the squad's live vehicle GPS position if available, or "erster Stop").
  Uses the same haversine already in `assignment-lines.tsx`; presents the reordered
  sequence for the operator to accept → persists via `reorderGroupStops`. It's a
  suggestion, never automatic. Stops without coords sink to the end, order preserved.
- Non-map fallback: the right-hand ordered list alone is fully functional for
  touch/keyboard (Design Principle 5) — the map is the intuitive layer, not a
  requirement.

### Board integration

- On member cards (`components/kanban/draggable-operation.tsx`) show a small colored
  **Auftrag chip** — a dot in `group.color` + short name + sequence, e.g.
  `● West · 3/6`. Clicking it opens the Aufträge sheet scrolled to that route.
- Optional highlight/filter "nur dieser Auftrag" from the panel (dim non-members).
- No new column type; stops live in their normal status columns and drag/behave
  exactly as today.

### Map (`/map` page, Phase 3 — display + Routenplanung mode)

New `frontend/components/map/group-routes.tsx` (shared with the Routen-Editor),
mirroring `components/map/assignment-lines.tsx` (its `<Polyline>` usage at :190-206):
- For each group with ≥2 located stops, draw a `<Polyline>` through the stops in
  `group_position` order, colored by `group.color` (solid, distinct from the
  animated red GPS ant-trail).
- Number the member markers by sequence: extend `createIncidentIcon`
  (`map-view.tsx:40-110`) to accept an optional sequence badge when an incident is
  part of a group and the route layer is on.
- A map control toggle "Aufträge anzeigen" (mirror existing status-filter toggles in
  `map-view.tsx`). Off by default.
- **Routenplanung mode (opt-in edit on the big map).** A toolbar button switches
  `/map` into planning: pick/create an Auftrag from a dropdown, then get the *same*
  editing the modal offers but full-screen — click empty map to add a stop
  (geocode → attach), click existing incident markers to add them to the route, drag
  markers to reorder (`reorderGroupStops`), and "Reihenfolge optimieren". It reuses
  the modal's logic (extract the shared bits into a `useRoutePlanning` hook /
  `group-routes.tsx` so the modal and `/map` don't duplicate). Editor-only; viewers
  see the read-only polyline. This is the "easy routing plan for the map view."
- Optional: connect the live vehicle GPS position to the group's **current** stop
  (first non-`abschluss`/`einsatz_beendet` in order) — reuse the `AssignmentLines`
  matching logic. Nice-to-have; ship the static polyline first.

## GPS arrival auto-advance (reuse existing Rule A)

**Verified against `backend/app/services/gps_automation.py` (2026-07-21).** Arrival
auto-advance for route stops already works *for free* — but with one caveat this
plan must guard, and one gap that stays out of scope.

**What already works.** The automation tick (`run_automation_tick`,
`gps_automation.py:271`, driven by the Traccar poller `traccar_poller.py:104-113`)
loads **every** active vehicle assignment and evaluates each incident independently
(`gps_automation.py:294-320`, loop at `:326`). A stop's debounce is keyed
`(incident_id, vehicle_id)` with a one-shot latch (`:336`, `:243`). So a squad
assigned to N route stops already gets, per stop, Rule A firing
`disponiert → einsatz` in silent mode (`_fire_arrival`, `:500-507`) or a
`gps_arrival_prompt` in the default mode — using the tuned 200 m radius / 2-fix /
10 s-dwell / 10 km/h-gate / 180 s-freshness thresholds (see project memory
`gps-automation-tuning`). For **well-separated** stops this already sequences
correctly as an emergent effect (the latch stops re-fires; the vehicle only sits
inside one 200 m geofence at a time).

**The caveat this plan fixes — clustered-stop double-fire.** Because every in-radius
incident fires independently, two route stops within ~200 m of each other (common in
a dense village) **both** advance from a single location — and in default mode emit
two simultaneous confirm prompts with no "which stop" cue. Small, contained fix in
`run_automation_tick`: when a vehicle has **multiple** assigned stops within the
arrival radius on the same tick, advance/prompt only the **single nearest** one
(compute min haversine among that vehicle's in-radius targets; skip the rest this
tick). This is a few lines around the existing per-target loop, gated so it only
changes behavior when a vehicle genuinely has >1 in-radius stop — no change for the
existing single-incident case. Add a test for it (below).

**Explicitly NOT built here — departure-close.** Rule A only moves
`disponiert → einsatz`; nothing moves `einsatz → einsatz_beendet` when the vehicle
*leaves* a stop for the next one. Auto-closing a stop on departure needs new
departure-detection logic and risks closing a stop the squad hasn't finished. The
operator (or the existing field-complete "Einsatz beendet" report /
`field_complete_reported_at`) closes stops. Out of scope — see below.

**No hard ordering gate.** We deliberately do **not** add "stop N+1 can't fire before
N" — decision #3 says order is a suggestion, and the nearest-single-match guard above
already prevents the pathological double-fire without imposing sequence rigidity.

## Test plan

### Backend — `backend/tests/test_crud/test_groups.py` + `backend/tests/test_api/test_groups.py`

Use `db_session`, `editor_client`, `client`, `test_event`, `test_incident` fixtures
(`backend/tests/conftest.py`).
1. **CRUD:** create/list/update/soft-delete a group; list excludes soft-deleted; `stop_ids` returned in `group_position` order; `progress` counts `einsatz_beendet`+`abschluss` as done.
2. **Delete leaves stops:** soft-deleting a group nulls `group_id` on its stops; the incidents still list on the board (not deleted).
3. **Reorder groups & stops:** `enumerate` positions persist; unknown/stale ids ignored; cross-event ids rejected.
4. **Add/remove stops:** attaching stamps `group_position` at the end; cross-event incident rejected; removing nulls `group_id` without touching status.
5. **copy-squad:** source stop with vehicle+2 personnel → all siblings get them; re-running is idempotent (already-active `ValueError` swallowed → `skipped`); cross-incident conflict path behaves like `assign_resource` (allowed, warned), not a hard 500.
5b. **copy-squad mode / filter:** `mode="vehicle_only"` (or `resource_types=["vehicle"]`) copies **only the vehicle** to siblings; personnel already assigned to individual stops are untouched and no personnel are copied. Explicit `resource_types` overrides the mode default.
6. **Streamlined create:** `POST /incidents/` with `group_id` attaches and sets `group_position`; without `group_id` behaves as today.
7. **Auth:** viewer (`client`) gets 403 on every mutation; 200 on GETs.
8. **sync-version:** creating/renaming a group changes the `/incidents/sync-version` hash.

### Backend — GPS guard, `backend/tests/test_services/test_gps_automation.py` (extend)

9. **Clustered-stop nearest-single-match:** one vehicle assigned to two
   `disponiert` stops **both within** `arrival_radius_m` of a single position →
   only the **nearer** stop fires (silent mode: exactly one `disponiert → einsatz`;
   default mode: exactly one `gps_arrival_prompt`). Regression guard for the double-
   fire. Also assert the single-in-radius case is unchanged (existing tests stay
   green).

### Frontend

- **Unit (Vitest + RTL):** `auftraege-sheet.test.tsx` — mock the api-client group
  methods: create group; add/remove stop; reorder updates order; "copy to all"
  calls `copyGroupSquad` and toasts the result; checklist items render
  `offen/läuft/erledigt` from stop status and progress renders `done/total`.
  `routen-editor-modal.test.tsx` — reorder via list persists (`reorderGroupStops`);
  **"Reihenfolge optimieren"** with a fixed start point and stub coords produces the
  expected greedy nearest-neighbor order and stops-without-coords sink last; **dropping
  a vehicle payload on a stop row** calls `assignResource` for that incident.
  `groups-context.test.ts` — optimistic add + rollback on API error; `group_update`
  WS event folds in. Mode toggle: switching to `Nur Fahrzeug` sets the copy picker
  default to vehicle-only and relabels the header.
- **E2E (`frontend/tests/e2e/`):** one spec — create an Auftrag, drag two existing
  cards in, reorder them, drag a vehicle onto the route + "copy to all," assert both
  cards show the Auftrag chip and both carry the vehicle; then a `vehicle_only` spec —
  flip to `Nur Fahrzeug`, "copy to all," assert siblings get the vehicle but **not**
  the source stop's personnel. Skip the map polyline + optimize (visual / covered in
  unit).

## Acceptance criteria

- [ ] Backend + frontend suites green; `ruff check`/`ruff format`, `pnpm lint`, `tsc --noEmit` clean.
- [ ] Migration applies cleanly on a seeded DB and is reversible (`downgrade`).
- [ ] Manual (storm flow): create "Sturm-Route West," add 4 incoming incidents as stops, reorder, assign TLF + 3 personnel to the first stop, "Squad auf alle übernehmen" → all 4 cards show the squad and the Auftrag chip; then append 2 late-reported incidents to the same route → they land at positions 5–6; deleting the Auftrag leaves all 6 incidents on the board ungrouped.
- [ ] Routen-Editor: click the map to add a stop (geocoded + attached), drag list rows to reorder, "Reihenfolge optimieren" from Magazin reorders by nearest-neighbor and persists on accept; the ordered checklist mirrors each stop's incident status.
- [ ] Drag-transfer: drag a vehicle from the board/Fahrzeuge sheet onto an Auftrag row → assigns to the route; if it's on another incident, the "verschieben vs. behalten" prompt appears; dropping on a single stop assigns only that stop.
- [ ] Shuttle mode: flip an Auftrag to `Nur Fahrzeug`, "auf alle übernehmen" copies only the vehicle; assign 2 people to stop 1 and 2 others to stop 3 independently → they stay put, header reads `TLF 1 · Pendeldienst`.
- [ ] Map Routenplanung: on `/map`, enter planning mode, click to add a stop, click an existing marker to add it, drag markers to reorder, optimize — all persist; viewers see only the read-only polyline.
- [ ] Map: toggling "Aufträge anzeigen" draws a numbered polyline through the stops in order, colored per Auftrag; toggling off removes it; live GPS ant-trail unaffected.
- [ ] GPS: a squad driving a route with well-separated stops auto-advances each `disponiert → einsatz` on arrival (silent mode); two stops within ~200 m advance only the nearer one (no double-fire).
- [ ] Demo mode: feature usable (it's per-event operational data, not shared config) — no `DemoLock` needed; verify it respects the per-session sandbox event scoping.
- [ ] German copy throughout (Swiss "ss"); add strings to `de.json`/`fr.json` if plan 06 has landed.

## Out of scope (explicit)

- **Reusable route templates** (save an Auftrag as a reusable pattern, activate
  later). Natural follow-up; would need persistence separate from live events.
- **Strict sequential mode** (one active stop, auto-advance on completion) — decided
  against; order is a suggestion.
- **Group-level single-source assignment** (squad assigned once to the Auftrag,
  stops inherit) — v1 uses per-incident + copy-to-all to avoid touching conflict
  detection, board rendering, and print slips.
- **GPS departure-close** (auto-moving a stop `einsatz → einsatz_beendet` when the
  vehicle leaves for the next stop) — needs new departure detection and risks
  premature closes. Arrival auto-advance *is* in scope (reuses Rule A + the
  nearest-single-match guard; see the GPS section). Stops are closed by the operator
  or the field-complete report.
- **Strict sequential / hard ordering gate** (stop N+1 can't fire before N) — decided
  against; order is a suggestion.
- **External routing engine / road-distance optimization** — "Reihenfolge
  optimieren" is an in-scope *client-side greedy nearest-neighbor* over
  straight-line (haversine) distance from a chosen start; no OSRM/Valhalla, no
  turn-by-turn, no road network.
- **A dedicated Auftrag status/lifecycle** — the Auftrag is a checklist; progress is
  derived from member incidents; it has no status column of its own.

# Plan 13 - Reko material requests and guided allocation

**Status:** Proposed, product decisions confirmed 2026-07-23
**Priority:** P2 future major feature; implement before Plan 11 if both are still open
**Scope:** Backend + frontend + training + material catalog migration
**Estimated size:** Large, multi-phase change. Do not implement as one unreviewed PR.

## Goal

Allow the Reko person to recommend material through the public Reko form without
making dispatch decisions or needing to know current stock. After the report is
submitted, KP sees the recommendation in the incident detail, resolves it to exact
physical material from the available locations/vehicles, and creates normal incident
assignments through one fast, atomic confirmation.

The intended workflow is:

1. Reko selects a specific material kind, for example `Tauchpumpe Gr.`, and enters a
   quantity.
2. Reko does not see physical copies, locations, source vehicles, availability, or
   current assignments.
3. Draft/autosave data remains private. Final submission activates the current
   material demand for the incident.
4. KP sees requested, assigned, substituted, and missing quantities in the existing
   incident detail/Reko report section.
5. A request-focused picker groups matching physical copies by `location`; KP chooses
   the exact copies and may explicitly choose alternatives.
6. One confirmation atomically creates the normal incident assignments and links them
   to the request. A concurrent conflict rejects the entire selected batch.
7. The request remains informational. KP may ignore it without acknowledging,
   dismissing, or explaining it.

This plan deliberately separates three concepts:

- **Demand:** what Reko thinks is needed.
- **Allocation:** which exact material KP chooses to fulfil that demand.
- **Assignment:** the existing operational record that reserves the physical material
  for an incident.

## Current state (verified 2026-07-23)

### Reko

- `EffortEstimation` already contains `vehicles_needed: list[str]` and
  `equipment_needed: list[str]` in `backend/app/schemas/reko.py`, persisted inside
  `RekoReport.effort_json` (`backend/app/models.py`). These are unvalidated strings,
  not inventory references.
- The frontend type carries both arrays, but the Reko form only renders personnel and
  duration controls (`frontend/components/reko/reko-form.tsx`, effort section). Normal
  users cannot populate the material arrays.
- A full Reko report and WhatsApp formatter can display those strings, but the board
  summary, notification, assignment slip, and operations state discard them.
- Drafts autosave locally and to the server. A report becomes operational only when
  submitted, but current submission side effects use several commits and are not
  fully idempotent.
- Training auto-fill calls `generate_effort()` in
  `backend/app/services/training_simulation_data.py`; it always returns empty vehicle
  and equipment arrays.

### Material catalog

- One `Material` row is one physical assignable copy with a UUID. Duplicate rows are
  intentional inventory, not accidental duplicates.
- `Material.name` is the specific kind/variant (`Tauchpumpe Gr.`), `Material.type` is a
  broad free-text grouping (`Tauchpumpen`), and `Material.location` is a free-text
  source (`TLF`, `Pio`, `MoWa`, `Magazin`, etc.).
- There is no first-class material-kind entity, quantity, stock unit, capability
  taxonomy, vehicle FK, or custody model.
- Materials on vehicles are associated only through `location`; assigning a vehicle
  neither assigns nor transports its material.
- The productive seed (`backend/app/seed.py`) primarily contains pumps, wet vacuums,
  saws, generators, one voltage tester, and three trailer/pump records.
- The demo seed (`backend/app/seed_demo.py`) additionally contains lighting, a cutting
  tool, oil-control material, and cordoning material. Those are examples only and
  must not become required productive inventory.

### Assignments and conflicts

- Direct incident assignments use `IncidentAssignment`; Auftrag resources use the
  separate `IncidentGroupAssignment` table.
- The backend rejects an exact duplicate on the same target but currently permits the
  same physical material on different incidents. Frontend filtering is the main
  double-booking prevention and is race-prone.
- Material assignment is performed one request at a time from the current frontend
  dialog. A multi-item confirmation is not atomic.
- Completion keeps materials assigned until KP decides whether each returns or stays
  on scene. Unassignment does not change `Material.location`.
- Existing incident transfer means moving assignments between incidents; it does not
  model loading, delivery, custody, or a vehicle loadout.

### Training isolation

- Events own incidents, Reko reports, and assignments, but materials are a shared
  master catalog.
- Frontend availability is effectively derived inside the selected event. Other parts
  of the backend sometimes treat assignments globally, so the invariant is currently
  inconsistent.
- The approved target is shared catalog data with independent occupancy per event,
  including separate training events.
- A clean demo reset does not seed the normal emergency-template/location pool. This
  does not block auto-Reko for an existing demo incident, but it can block generation
  of new training incidents and should be corrected in the training phase.

## Design decisions (final - do not re-litigate)

These decisions were confirmed with the requester on 2026-07-23.

1. **Specific kind plus quantity.** A normal Reko request names a specific material
   kind, not a physical copy and not only a broad type. Example: `Tauchpumpe Gr. x2`.
2. **KP chooses the source.** When copies exist on several vehicles/locations, KP
   chooses the exact UUIDs in a request-focused picker grouped by location.
3. **No Reko capacity check.** Reko demand is independent of current stock and may
   exceed availability. This is intentional because capacity may be free later.
4. **Final submission only.** Draft/autosave changes do not surface to KP. A submitted
   report updates the operational demand.
5. **Supplemental reports express current total demand.** They replace/reconcile the
   current quantities rather than adding another independent order.
6. **One current request per incident.** Preserve change/allocation history, but do not
   make KP reconcile multiple overlapping report requests.
7. **Existing exact assignments count automatically.** Matching material already on
   the incident satisfies demand up to the requested quantity.
8. **Explicit substitutions are allowed.** Exact matches are the default. KP can show
   alternatives and deliberately link another kind as a substitution. Unrelated
   material can always be assigned through the normal picker without counting.
9. **No dismissal workflow.** Unhandled demand remains visible as report information.
   There is no acknowledgement, reason, cancellation button, board task, or queue.
10. **Unassignment reopens demand while active.** If a linked assignment is removed
    before incident closure, its quantity becomes missing again.
11. **Preserve state at closure.** Completion snapshots request fulfillment. Returning
    material after closure must not make a completed incident appear short again.
12. **Incident-detail visibility only.** Show full controls and counts in incident
    detail/Reko report. Do not add Kanban-card badges or a global demand queue.
13. **Atomic selected batch.** KP may intentionally assign only part of a request, but
    every item selected in one confirmation succeeds or none do. A race returns `409`,
    refreshes availability, and preserves the picker context.
14. **One booking per event.** A physical non-consumable material can have only one
    active incident/Auftrag reservation inside an event. Separate events, including
    separate live events, can independently use the same master item.
15. **Training uses the full shared catalog with event-local occupancy.** It does not
    reserve or mutate live-event allocations.
16. **Vehicles and material remain independent.** A source vehicle is context only.
    Assigning material does not require or assign its carrying vehicle.
17. **Material only.** Structured vehicle requests are not included in this release.
18. **Consumables are advisory only.** A consumable can appear as `benötigt`, without
    quantity, fulfillment count, reservation, or request-assignment action.
19. **Standard capabilities plus custom types.** Material kinds retain custom names and
    free/custom types. Optional fixed capability tags drive training and substitution
    suggestions. OSS installations can add arbitrary kinds/types/capabilities.
20. **Automatic training is deliberately sparse.** Generate only clearly relevant
    tracked material. Most fire, BMA, rescue, chemical, animal, and ordinary technical
    scenarios correctly produce no material request.

## Target data model

Names below are recommended; adjust only for established repository naming conventions.

### `material_kinds`

Promote repeated names into a stable catalog identity:

- `id: UUID` primary key
- `name: str` - specific display name, for example `Tauchpumpe Gr.`
- `type: str` - custom/broad grouping, for example `Tauchpumpen`
- `consumable: bool` - kind-level request semantics
- `active: bool` - retire without breaking history
- timestamps

Add required `materials.material_kind_id`. A physical material keeps fields that
belong to the copy: location, status, group, description/asset notes, and timestamps.
After migration, kind name/type/consumable must have one source of truth; do not keep
independent writable duplicates on every physical row.

The material API may continue returning flattened `name`, `type`, and `consumable`
fields derived from the kind to minimize frontend churn, but writes must target the
kind or copy intentionally.

### `material_capabilities` and join table

Use a table rather than an enum so OSS installations can add capabilities:

- `id: UUID`
- `key: str` unique, stable machine key
- `label: str`
- `is_system: bool`
- `active: bool`
- timestamps

Join through `material_kind_capabilities(material_kind_id, capability_id)`.

Seed system capabilities:

| Key | Current examples | Training use |
| --- | --- | --- |
| `wet_vacuum` | Wassersauger | Shallow indoor water |
| `normal_pump` | Tauchpumpe Kl., Tauchpumpe S-Kl. | Moderate pumping |
| `large_pump` | Tauchpumpe Gr., Tauchpumpe S-Gr. | Larger flooding |
| `motor_pump` | MS-Zivil, MS-Porsche | Underpass/major inundation |
| `chainsaw` | Motorsäge variants | Fallen trees/branches |
| `temporary_power` | Generator | Conditional emergency power |
| `voltage_testing` | Spannungsprüfer | Conditional electrical danger |
| `oil_barrier` | Ölsperre | Oil threatening water/drains |
| `oil_absorbent` | Ölbindemittel | Advisory only |
| `cordoning` | Triopan / Absperrband | Advisory only |
| `lighting` | Lichtmast, Flutlichtstrahler | Optional demo/custom use |
| `cutting_tool` | Trennschleifer | No automatic baseline profile |

`Anhänger-Zivil` receives no training capability. Custom capabilities can group custom
material for human selection; automatic profiles reference only known system keys
unless an administrator explicitly maps/configures more later.

### Current incident demand

`incident_material_requests`:

- `id: UUID`
- `event_id: UUID` FK, indexed
- `incident_id: UUID` FK, unique
- `latest_reko_report_id: UUID` FK
- `closed_at: datetime | None`
- timestamps

`incident_material_request_lines`:

- `id: UUID`
- `request_id: UUID` FK
- `material_kind_id: UUID | None` FK (`SET NULL` only if hard deletion remains possible)
- `name_snapshot: str`
- `requested_quantity: int | None` - positive for assignable material; `NULL` for an
  advisory consumable
- `is_advisory: bool`
- `active: bool` - whether the kind is part of the latest submitted total demand
- `updated_by_report_id: UUID` FK
- `fulfilled_quantity_at_close: int | None`
- timestamps

Add a unique constraint on `(request_id, material_kind_id)`. Keep lines omitted by the
latest submitted total as `active=false` rather than hard-deleting them. Operational
responses can omit inactive lines while audit/export retains them.

`material_request_allocations`:

- `id: UUID`
- `request_line_id: UUID` FK
- `incident_assignment_id: UUID` FK
- `is_substitution: bool`
- `allocated_by: UUID | None` FK
- `allocated_at`

Allocation history remains when an assignment is unassigned. Active fulfillment is
derived from linked assignments whose `unassigned_at IS NULL`, except after closure,
when `fulfilled_quantity_at_close` is authoritative.

### Authoritative per-event reservation

Direct and Auftrag assignments live in separate tables, so neither table can enforce
cross-table uniqueness alone. Add `material_event_reservations`:

- `id: UUID`
- `event_id: UUID` FK
- `material_id: UUID` FK
- `owner_type: str` (`incident_assignment` or `group_assignment`)
- `owner_id: UUID`
- `reserved_at`
- `released_at: datetime | None`

Add a partial unique index on `(event_id, material_id) WHERE released_at IS NULL`.
Every direct assignment, Auftrag assignment, unassignment, completion decision, and
transfer involving material must create/release/update this row in the same transaction
as the assignment. Do not rely on a check-then-insert query without the unique index.

## Reko payload and submission lifecycle

Replace the dormant free-string equipment list with structured draft data:

```json
{
  "materials_needed": [
    {
      "material_kind_id": "uuid",
      "name": "Tauchpumpe Gr.",
      "quantity": 2,
      "advisory": false
    },
    {
      "material_kind_id": "uuid",
      "name": "Ölbindemittel",
      "quantity": null,
      "advisory": true
    }
  ]
}
```

The ID is authoritative for current catalog behavior; the name snapshot preserves what
the Reko person saw. Server validation must ensure the kind exists and that advisory
semantics agree with `MaterialKind.consumable`.

On every draft save, update only the report JSON. On explicit final submission:

1. Lock/load the incident, report, and current request.
2. Make report finalization idempotent.
3. Reconcile one request line per selected kind to the new current total.
4. Set omitted previous lines to `active=false`.
5. Preserve allocations and history; never auto-unassign after a reduction.
6. Auto-link existing active exact-kind incident assignments up to the requested
   quantity, oldest assignment first for deterministic results.
7. Apply the existing Reko status transition, danger priority adjustment,
   notification, and request reconciliation in one transaction.
8. Broadcast incident/Reko/assignment changes only after commit.

Editing a submitted report must not silently change demand. Only an explicit submit or
supplemental submit action runs reconciliation.

## API changes

### Token-scoped Reko catalog

Add a token-validated endpoint, for example:

```http
GET /api/reko/material-kinds?incident_id=...&token=...
```

Return active kind ID, name, type, advisory/consumable flag, and capabilities needed for
grouping. Do not expose physical UUIDs, locations, stock counts, availability, source
vehicles, or assignments to the public Reko client.

### Request detail

Add an authenticated incident-scoped read endpoint or extend the full Reko report
response with:

- current request lines;
- requested quantity;
- active fulfilled quantity;
- missing quantity;
- exact versus substituted allocations;
- closure snapshot state;
- matching physical candidate summary for editors only.

Viewers may read. Only editor/admin roles may allocate.

### Atomic allocation

Add an editor-only endpoint, for example:

```http
POST /api/incidents/{incident_id}/material-request/allocate
```

Body:

```json
{
  "selections": [
    {
      "request_line_id": "uuid",
      "material_id": "uuid",
      "substitution": false
    }
  ]
}
```

In one transaction it must:

- validate incident/event/request ownership;
- reject advisory lines;
- validate every physical material and kind;
- require explicit `substitution=true` when capabilities/kinds do not exactly match;
- acquire all per-event reservations in deterministic material-ID order;
- create normal `IncidentAssignment` rows;
- create allocation links;
- reject the full selected batch on any conflict;
- return refreshed request and assignment state.

Return `409` with conflicting material IDs when a reservation was acquired elsewhere.
The frontend refreshes candidates but keeps the request-focused picker open.

### Existing assignment paths

All current material assignment endpoints and Auftrag paths must use the same
reservation service. When a normal direct assignment exactly matches an outstanding
line, auto-link it until that line is fulfilled. Extra material remains a normal,
unlinked assignment. Alternatives only count through an explicit allocation/linking
operation.

## Frontend UX

### Reko form

Add a touch-friendly section to the existing effort assessment:

- search/browse material kinds, grouped by custom `type`;
- select a specific kind;
- quantity stepper for non-consumables;
- `benötigt` toggle/row without quantity for advisory consumables;
- prevent duplicate lines for the same kind;
- show no availability, location, source vehicle, or conflict information;
- include the data in existing local storage and 30-second server autosave;
- restore drafts using the same freshness rule as the rest of the form.

### Incident detail

Extend `frontend/components/reko/reko-report-section.tsx` rather than adding another
global surface. Example:

```text
Materialbedarf

Tauchpumpe Gr.       1 / 2 zugewiesen
Wassersauger         1 / 1 zugewiesen
Motorsäge Gr.        1 / 1 Ersatz zugewiesen
Ölbindemittel        benötigt
```

Provide `Material auswählen` for editors when at least one assignable line exists.
Do not add dismiss/acknowledge controls, card badges, or a demand queue.

### Request-focused picker

- One section per requested line.
- Exact matching physical copies first, grouped and sorted by `location` and existing
  `location_sort_order`.
- Already linked assignments displayed as fulfilled.
- Same-event reserved items visible but disabled, with enough context for KP to
  understand the shortage.
- `Andere Materialien anzeigen` reveals explicit alternatives. Kinds sharing a
  standard capability are suggested first; all other material remains reachable.
- KP may select fewer than the missing quantity and create a partial fulfillment.
- One confirmation calls the atomic allocation endpoint.
- A `409` identifies the conflict, refreshes data, preserves context, and requires a
  new confirmation. Do not silently choose replacements.

The existing full material picker remains unchanged for unrelated additions.

### Combined material settings list

Keep the user-approved single combined list rather than introducing separate "Kinds"
and "Inventory" tabs:

- every row remains a physical copy with its location/status;
- create/edit can reuse an existing kind or create one inline;
- kind name/type/consumable edits apply to all copies using that kind;
- confirm edits that affect multiple copies;
- capability tags are edited on the shared kind;
- deleting/retiring a kind with history is prohibited or becomes `active=false`;
- import/export keeps readable names/types and resolves/creates kinds during import.

## Automatic training profiles

Profiles reference stable system capability keys, not Oberwil-specific names. At
runtime, resolve the capability to a local active material kind. Prefer a configured
or deterministic local representative; all same-capability kinds remain suggested
alternatives. If no kind provides the capability, omit that request without failing
the simulated report.

Capacity never limits generated demand.

### Confirmed baseline

| Scenario | Generated demand |
| --- | --- |
| Small/shallow cellar water | `wet_vacuum` x1 |
| Substantially flooded cellar | `wet_vacuum` x2 + `normal_pump` or `large_pump` x1 |
| Small flooded garage | `large_pump` x1 |
| Full underpass/major inundation | `motor_pump` x1; fallback `large_pump` x2-3 |
| Fallen tree/large branch | `chainsaw` x1 |
| Storm roof/facade without tree | No physical material; advisory `cordoning` only when falling-object, collapse, or public-access danger is generated |
| Oil in cellar/on road | Advisory `oil_absorbent`, no quantity |
| Oil threatening drain/water | Advisory `oil_absorbent` plus `oil_barrier` x1 if available |
| Ruptured water main | Apply the flooding profile only when meaningful accumulation is generated |
| Any scenario with emergency/unavailable power | Add `temporary_power` x1 |
| Any scenario with generated electrical danger | Add `voltage_testing` x1 |
| Fire/BMA/rescue/chemical/animal/wasp/ordinary technical | Normally no material request |

Do not automatically request `cutting_tool`. Demo-only lighting may be added only for
an explicitly dark/night scenario; do not sprinkle lighting randomly.

Profiles should use the existing resolved subcategory from
`_resolve_summary_pool(type, title, description)` and, where needed, title/description
severity keywords. Fix known resolver ambiguities (E-bike order, garden-house aliases)
before relying on those subcategories for material generation.

Add exhaustive tests that every authored emergency-template title/message variation
resolves to the expected scenario family, not only the current Elementar templates.

## Implementation phases

### Phase 0 - Prerequisites and data audit

1. Query real databases for non-empty legacy `equipment_needed`, inconsistent
   name/type/consumable duplicates, and same-event active material double-bookings.
2. Produce a migration report; never silently release an active assignment.
3. Make final Reko submission transactionally safe and idempotent, including the
   actual final submission timestamp and post-commit broadcasts.
4. Fix material create/update persistence and base `unavailable` versus assigned-state
   reconciliation before the new picker depends on it.

### Phase 1 - Catalog and capabilities

1. Add `material_kinds`, capabilities, join table, and `materials.material_kind_id`.
2. Migrate distinct existing names into kinds, detecting conflicting type/consumable
   values for manual review.
3. Seed system capabilities and map the known productive/demo examples.
4. Update material CRUD, schemas, contexts, settings UI, seeders, demo reset, and
   Excel import/export.
5. Keep API responses flattened where useful, but remove duplicate writable truth.

This phase supersedes Plan 11's proposed managed free-string material type vocabulary.
If Plan 11 remains open, implement its thresholds against kind/type identity after
this phase rather than adding a competing rename mechanism first.

### Phase 2 - Per-event material reservations

1. Add and backfill `material_event_reservations` for conflict-free active assignments.
2. Route direct incident, Auftrag, removal, completion, and transfer material paths
   through one reservation service.
3. Add the partial unique index and translate conflicts to consistent HTTP `409`.
4. Include direct and Auftrag occupancy in reads, WebSocket refreshes, and polling
   sync-version changes.

### Phase 3 - Structured Reko demand backend

1. Add request/line/allocation tables and schemas.
2. Add token-scoped material-kind catalog access.
3. Extend draft report payload validation.
4. Reconcile current demand only on explicit final/supplemental submission.
5. Auto-link existing exact assignments.
6. Add closure snapshots and export/audit records.
7. Add atomic allocation endpoint and automatic exact-link behavior to normal direct
   assignments.

### Phase 4 - Reko and KP frontend

1. Add the Reko material selector, advisory rows, quantity controls, and autosave.
2. Extend report/detail state and live refresh.
3. Add fulfillment display and the request-focused picker.
4. Handle partial selections, substitutions, disabled conflicts, and atomic `409`
   refresh behavior.
5. Verify desktop and mobile touch behavior; do not add board-level demand UI.

### Phase 5 - Training and demo

1. Add capability-based curated profiles to training simulation data.
2. Ensure the auto-Reko endpoint uses the exact same final submission pipeline.
3. Add known productive/demo capability mappings without requiring demo-only kinds.
4. Fix full-template subcategory classification tests and known keyword ordering gaps.
5. Ensure clean demo reset has the template/location data needed for training incident
   generation, or explicitly seed a demo-safe pool.
6. Generate a representative sample batch for operational review; tune probabilities,
   not the confirmed workflow semantics.

### Phase 6 - Reporting, documentation, and rollout

1. Include demand, exact allocations, substitutions, advisory needs, and closure
   snapshots in event export/audit output.
2. Add material needs to Lageblatt/WhatsApp/assignment slips only where operationally
   useful; preserve the distinction between requested and assigned.
3. Update architecture, help, database-schema, demo, and training documentation.
4. Roll out behind migrations with a preflight report and monitor conflict rates.

## Migration strategy

### Material kinds

Group existing rows by normalized name, but preserve the exact chosen display spelling.
Do not automatically merge case/spacing variants when their type or consumable value
differs; report them for manual resolution.

Known seed mappings:

- `Tauchpumpe Gr.` and `Tauchpumpe S-Gr.` -> `large_pump`
- `Tauchpumpe Kl.` and `Tauchpumpe S-Kl.` -> `normal_pump`
- `MS-Zivil` and `MS-Porsche` -> `motor_pump`
- `Anhänger-Zivil` -> no system capability
- all `Wassersauger` variants -> `wet_vacuum`
- all `Motorsäge` variants -> `chainsaw`
- `Rettsäge` -> no default system capability; an administrator may map it explicitly
- `Generator` -> `temporary_power`
- `Spannungsprüfer` -> `voltage_testing`
- demo-only kinds map to their named optional capabilities

Do not infer capabilities for arbitrary OSS data solely from names. Existing local seed
mappings can be explicit; other installations receive an admin review step.

### Legacy Reko strings

Before migration, measure non-empty `equipment_needed` data. For exact catalog matches,
convert to a quantity-one snapshot in migration/export history. Preserve unmatched
legacy strings as historical report text; do not create fake catalog kinds silently.
New runtime code writes only structured requests.

### Existing assignment conflicts

Backfill reservations only after detecting same-event duplicates across both assignment
tables. Block migration/deployment with a clear conflict report or require explicit
operator resolution. Never pick a winner and unassign operational material automatically.

## Acceptance criteria

- Reko can select a specific non-consumable kind and quantity without seeing stock or
  locations.
- Reko can mark a consumable as needed without quantity or fulfillment mechanics.
- Draft changes remain private; explicit final/supplemental submission updates one
  current incident demand.
- A supplemental report represents current total demand and never auto-unassigns
  excess material.
- Incident detail shows exact, substituted, fulfilled, and missing quantities plus
  advisory needs; no board badge/queue exists.
- KP can choose exact copies grouped by location and atomically assign a partial or
  complete selected batch.
- A race rejects the entire selected batch with `409`; no hidden partial success or
  automatic replacement occurs.
- Existing exact incident assignments count automatically; unrelated extra material
  remains assignable and unlinked.
- Explicit alternatives count as substitutions and are labelled.
- Removing a linked assignment reopens demand while active; closure freezes the final
  fulfillment display.
- A physical non-consumable has at most one active reservation per event across direct
  incidents and Aufträge.
- Separate events can independently reserve the same master item; training never
  blocks live occupancy.
- Vehicle assignment and material assignment remain independent.
- Automatic training profiles resolve through standard capabilities, work with custom
  OSS catalogs, skip absent capabilities safely, and do not over-request material.
- Productive and demo seeds migrate successfully; demo-only material is optional.
- Viewer/public-token/editor authorization remains correctly separated.
- Audit/export can distinguish request, allocation, substitution, assignment,
  unassignment, and closure snapshot.

## Required tests

### Backend

- kind migration with duplicate copies across and within locations;
- conflicting duplicate name/type/consumable migration report;
- capability mapping and custom capabilities;
- token-scoped safe catalog response and cross-incident token rejection;
- draft versus final request activation and submission idempotency;
- supplemental increase, decrease, removal, and over-fulfilled state;
- existing exact assignment auto-linking and explicit substitution;
- advisory consumable validation;
- partial allocation and full atomic rollback on conflict;
- same-event direct/direct, direct/Auftrag, and Auftrag/Auftrag exclusivity;
- independent reservations in separate live/training events;
- unassignment reopens active demand and closure snapshot remains stable;
- transfer/completion reservation behavior;
- curated profile resolution for every scenario family and absent capability;
- exhaustive authored-template classification combinations;
- demo reset/training generation integration.

### Frontend

- Reko material search, quantity controls, advisory rows, duplicate prevention, and
  draft restore;
- no stock/location leakage to the public form;
- incident-detail fulfillment/substitution/advisory rendering;
- request-focused grouping by location and disabled occupied copies;
- partial selection and explicit alternatives;
- `409` refresh preserving picker context;
- viewer read-only behavior;
- mobile touch layout.

### E2E

1. Generate Reko link, select material, autosave, and confirm KP sees nothing yet.
2. Submit report and confirm demand appears in incident detail.
3. Allocate exact copies from two locations and confirm normal assignments exist.
4. Create a shortage, assign a substitution, and verify labels/counts.
5. Remove a linked assignment before closure and verify shortage reopens.
6. Close the incident, return material, and verify the closure snapshot remains.
7. Run auto-Reko in two training events and a live event, verifying independent
   occupancy and realistic sparse profiles.

## Verification commands

```bash
cd backend && uv run pytest
cd backend && uv run ruff check .
cd backend && uv run ruff format --check .
cd frontend && pnpm test
cd frontend && pnpm lint
cd frontend && pnpm exec tsc --noEmit
```

Run relevant Playwright suites against `just dev`; do not run `pnpm build` while the
development server is active.

## Out of scope

- Structured vehicle requests
- Automatically assigning a vehicle with its loadout
- Requiring the source vehicle to be assigned
- Physical custody states such as loaded, dispatched, delivered, returned, or left on
  scene
- Stock units or decrementing consumable quantities
- Fulfilling advisory consumables through material assignments
- Automatic source selection or replacement after a race
- Request acknowledgement, dismissal, cancellation reasons, SLA, or demand queue
- Kanban-card material-demand badges
- Global physical exclusivity across separate events
- Automatically inventing missing fire/rescue/chemical material kinds
- Making demo-only material mandatory in productive/OSS catalogs

## Interaction with other plans

- **Plan 11:** this plan supersedes its managed free-string identity approach for
  material kinds/types. If this plan runs first, implement Plan 11 thresholds against
  the normalized kind/type model and keep `location` on physical copies. Do not build
  a second coordinated string-rename system.
- **Plan 12:** reservations must include Auftrag-owned material. Request allocation
  creates direct incident assignments; route-level fulfillment is not added here.
- **Plan 06:** implement i18n after this plan so it includes the new Reko, request,
  capability, substitution, and shortage strings.

## Remaining review

No blocking product decision remains. After implementation, generate a representative
sample of automatic Reko reports and perform one operational content review to tune
scenario probabilities/severity classification. Do not use that review to broaden the
feature into custody, vehicle loadouts, consumable stock, or a global task queue.

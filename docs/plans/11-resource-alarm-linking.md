# Plan 11 — Material Depletion Thresholds: co-located & dual-dimension

**Priority:** P2 (post-publication feature)
**Scope:** Backend + frontend. Material thresholds only (vehicles/outbound are out — see end).
**Estimated size:** ≈ 150 LOC + tests; no DB migration (settings are JSON).

> **Plan 13 compatibility (approved 2026-07-23):** Plan 13 introduces normalized
> material kinds and capability tags and is now ordered before this plan. If Plan 13
> is implemented first, its catalog model supersedes this plan's managed free-string
> identity and coordinated type-rename decisions. Keep physical-copy location
> thresholds, implement type/kind thresholds against the normalized catalog, and do
> not create a second competing type vocabulary. If this plan is implemented first,
> Plan 13 must migrate its strings and threshold keys into the normalized model.

## Goal

Make a material category and its depletion warning feel like **one connected thing**,
not a string typed on one page and a threshold configured on another. After this
plan an operator manages the threshold **on the Material page**, thresholds can be
set on **both** the location dimension (how much is on TLF / Pio / Depot) **and** the
material-type dimension (do we still have enough Tauchpumpen overall), and the
category values materials/thresholds share are a **managed vocabulary** rather than
free-typed random strings — while staying plain strings so import/export round-trips
cleanly (product decision, 2026-07-21).

Nav cross-links between the two screens already shipped (commit `b99378d`); this plan
is the coupling behind them.

## Current state (verified — file references)

- **Storage:** `NotificationSettings.material_depletion_threshold: dict[str, int]`
  — `backend/app/schemas/notifications.py:76`. Flat map, `-1` = disabled.
- **Dimension:** keyed by **`Material.location`** (e.g. `"TLF"`, `"Pio"`, `"Depot"`),
  NOT `Material.type`, despite the misleadingly named `materialType` UI variable —
  code comment is explicit at
  `frontend/components/notifications/notification-settings.tsx:31`.
- **Consumer:** `backend/app/services/notification_service.py:315` iterates the map,
  counts `Material` where `location == key`, `status == 'available'`, not in an active
  `IncidentAssignment`, warns when count `< threshold`.
- **Editor UI:** "Materialbestand-Schwellenwerte" block —
  `notification-settings.tsx:436-489` (inside the `notifications` section).
- **Material page:** `frontend/components/settings/material-settings.tsx` — list /
  groups / sort tabs. `location` and `type` are **free-text inputs** in the create/
  edit dialog (`locationPlaceholder`, `typePlaceholder`); nothing constrains them to a
  known set, so values can drift ("TLF" vs "TLF 1").

## Design decisions (final — do not re-litigate)

1. **Dual-dimension thresholds.** Two independent maps, both optional, `-1` disables:
   - `material_depletion_threshold_by_location: dict[str, int]`  ← existing data
   - `material_depletion_threshold_by_type: dict[str, int]`       ← new
   Keep `material_depletion_threshold` as a deprecated **read-alias** for the location
   map for one release (mirrors the `divera_user_id` dual-write pattern); new code
   writes the explicit fields. On read, if `_by_location` is empty and the legacy key
   is not, copy legacy → `_by_location`.
2. **Values stay strings** (identity = the human-readable name), so CSV/JSON
   import/export round-trips without ID resolution. **No new tables, no migration.**
3. **But strings become a managed shared vocabulary, not free typing.** Two concrete
   ties (both required):
   - The material create/edit dialog picks `location` and `type` from the **existing
     distinct values** (combobox / `datalist` with free-add), so new materials
     converge on the vocabulary instead of drifting.
   - A **coordinated rename**: renaming a category updates `Material.location`/`.type`
     across all matching materials **and** renames the matching threshold key in the
     settings, atomically — so a rename can never silently orphan a live threshold.
4. **Editing lives on the Material page; notifications keeps a read-only summary.**
   One source of truth, co-located with the materials. The `notifications` section
   shows a compact read-only list (category → threshold, or "keine") plus the existing
   cross-link — not a second editor.
5. **Overlapping warnings fire both, clearly labelled.** If a shortage trips both a
   location and a type threshold, emit both (message names the dimension, e.g.
   *"Standort TLF: nur noch 1 verfügbar"* vs *"Typ Tauchpumpen: nur noch 2 verfügbar"*).
6. **Demo mode:** threshold editing + rename are shared state → inside `<DemoLock>`
   (Material component already receives `demoMode`). The read-only summary stays visible.

## Data model changes

`backend/app/schemas/notifications.py`:

```python
# Resource thresholds
fatigue_hours: int = 4
material_depletion_threshold: dict[str, int] = {}            # deprecated location alias
material_depletion_threshold_by_location: dict[str, int] = {}
material_depletion_threshold_by_type: dict[str, int] = {}
```

- Settings persist as a JSON blob in the `settings` table — **no Alembic migration**;
  new keys default to `{}`. Add read-time legacy→`_by_location` normalisation.
- `notification_service.py`: split the single loop into a location loop (unchanged
  query) and a type loop (`Material.type == key`, same available/assigned filtering);
  message carries the dimension.
- **Rename endpoint:** `POST /api/materials/categories/rename`
  `{ dimension: "location"|"type", from: str, to: str }` — updates all matching
  `Material` rows and the corresponding threshold key in one transaction. Editor-gated.

## Implementation steps

### Phase 1 — Backend
1. Schema: two maps + deprecated alias + read normalisation (`schemas/notifications.py`,
   settings loader).
2. Service: dual-dimension loops with dimension in the message (`notification_service.py`).
3. Rename endpoint + CRUD helper (`api/materials.py`, `crud.py`).
4. Tests (`backend/tests/`): (a) legacy value still warns via `_by_location`;
   (b) a `_by_type` threshold warns on type depletion; (c) `-1` disables each dimension
   independently; (d) assigned materials excluded from both counts; (e) rename moves
   both the materials and the threshold key, no orphan.

### Phase 2 — Frontend
5. **Material page — threshold editor.** New "Schwellenwerte" sub-section/tab in
   `material-settings.tsx`: two groups (by location, by type) derived from
   `apiClient.getAllMaterials()`, each row = checkbox (enable) + number input writing
   `_by_location` / `_by_type`. Inside `<DemoLock active={demoMode}>`.
6. **Material dialog — vocabulary combobox.** `location`/`type` inputs become
   comboboxes backed by existing distinct values (free-add allowed).
7. **Category rename affordance** on the Material page (per category) → the rename
   endpoint, with a confirm.
8. **Notifications section → read-only summary** + keep `materialThresholdsManageLink`.
9. i18n (German, Swiss "ss") for the type group, summary, dimension label, rename.
10. Verify: `pnpm lint` + `pnpm exec tsc --noEmit`; `uv run pytest` + `ruff`. Manually:
    set a type threshold, deplete the type, confirm the labelled alert; rename a
    category and confirm its threshold follows.

## Acceptance criteria

- A category can have a threshold **by location and/or by type**, edited **on the
  Material page**; each dimension warns correctly and is labelled.
- Existing location thresholds keep working with no operator action, no migration.
- Material location/type are chosen from the existing vocabulary (free-add), and a
  **rename moves the threshold with it** — no silent orphans.
- Import/export still sees plain human-readable strings.
- Notifications shows a read-only summary + working cross-link; no second editor.
- Threshold editing + rename locked in demo; summary stays visible.

## Out of scope (decided 2026-07-21)

- **Vehicle alarms.** Vehicle state is already surfaced through the existing modal
  popups (status sheet, driver prompt), so no vehicle threshold/alarm is needed.
- **Outbound Ausalarmierung addressed by vehicle.** #4 was about depletion warnings,
  not alerting — dropped.
- **Full entity promotion (category tables + FK IDs).** Rejected in favour of managed
  strings so import/export stays plain-text. The rename operation gives the "tied
  together" benefit without IDs.
- Per-individual-material thresholds (dimension is category-level).
- Alembic migration (settings are JSON in the `settings` table).
- Removing the deprecated `material_depletion_threshold` alias (next release).

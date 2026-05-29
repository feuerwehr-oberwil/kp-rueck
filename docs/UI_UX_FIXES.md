# UI/UX Fixes

Audit performed 2026-03-30. Status reconciled 2026-05-29.

---

## ✅ Done

### 1. Optimistic updates don't revert on failure
- **Shipped 2026-05-28** (commit `f749076`): `removeCrew` / `removeMaterial` / `removeVehicle` now snapshot operation + personnel/material status before mutating and restore both on `.catch()`. `removeReko` already had the pattern; pattern kept consistent across all four.

### 2. Race conditions in assignment cooldown
- **Shipped 2026-05-28** (commit `ce3a275`): replaced the silent drop with a `pendingReplayRef` flag. Updates landing during cooldown set the flag; the next cooldown clear triggers a single coalesced `loadData(false)`. Polling follows the same path. Cooldown clears route through `clearAssignmentCooldown` / `clearStatusUpdateCooldown` helpers. Pure decision logic extracted to `lib/sync-cooldown.ts` with 9 unit tests (commit `68b6a85`).

### 3. Silent `createOperation` failure
- **Shipped 2026-05-28** (commit `f749076`): the API path was actually after-success (not optimistic), so no revert needed — just added the missing error toast.

### 4. No stale data indicator
- **Shipped 2026-05-28** (commit `9dd6218`): `<StaleDataBanner />` mounted in the root layout shows when WS is disconnected/errored AND last successful operations load is >15s old. Pure visibility logic in `lib/stale-data.ts` (7 tests) + component test (4 cases).

### 5. Display pages have hardcoded unresponsive grids
- **Shipped 2026-05-27** (commit `6d6f655`): `display/status` switched to `grid-cols-2 md:grid-cols-3 xl:grid-cols-4`. `display/board` still uses `grid-cols-6` intentionally (wall screens always have the resolution).

### 6. Missing error boundaries
- **Shipped 2026-05-29** (commit `48f3aa5` + `8f430e5`): added `error.tsx` to viewer, check-in, training, reko, reko-dashboard, divera-pool, display/board, display/map, display/status. Shared `RouteError` component in `components/route-error.tsx` so a future copy/style change is one edit.

### 10. Settings have no input validation
- **Shipped 2026-05-28** (commit `27feeab`, with A3 in AUDIT_2026_05_27.md): per-form zod schemas in `lib/schemas/` enforce required fields + length caps. Inline `<FormMessage>` errors via shadcn `Form`. Validates client-side before submit.

### 11. No unsaved changes warning in settings
- **Shipped 2026-05-28** (commit `27feeab`): shared `useUnsavedChangesWarning` hook + `UnsavedChangesDialog` intercept close-while-dirty in all 3 settings forms; also wires `beforeunload` for tab close / refresh.

### 13. Hardcoded hex colors across map components
- **Shipped 2026-05-29** (commit `0bb4d79`): consolidated `#ef4444 / #eab308 / #22c55e / #3b82f6` into `lib/map-colors.ts` (`MAP_COLORS` + `PRIORITY_MARKER_COLORS`). Constants mirror the existing CSS tokens (`--destructive` / `--warning` / `--success` / `--info`); JS constants needed because the colors live inside Leaflet's SVG-string `divIcon` templates where CSS `var()` doesn't resolve. Zero raw hex remaining outside the tokens module.

### 15. Inconsistent error handling — silent failures
- **Shipped 2026-05-29** (commit `0a61a18`): `PersonnelContext` + `MaterialsContext` now toast on load failure (dedup'd via ref to one toast per outage, reset on next success). `console.error` retained for devtools.

### 17. No confirmation for data import "replace" mode
- **Shipped 2026-05-29** (commit `1e15db8`): "Jetzt importieren" in `replace` mode now goes through a Radix `AlertDialog` that summarises the import counts and explicitly warns the action can't be undone. `append` mode unaffected.

### 18. Drag-and-drop has no error feedback
- **Shipped 2026-05-28** (commit `135a9cb` in pre-session range): `operations-context.updateOperation` status-failure branch now calls `refreshOperations()` to snap the card back to server state and toasts "Status nicht geändert".

### 19. Focus management gaps in modals
- **Shipped 2026-05-29** (commit `e864cdc`): `DriverAssignmentDialog` search input now has `autoFocus`. `NewEmergencyModal` already had `autoFocus` on its first field. Radix Dialog's focus-trap handles the rest.

---

## ☐ Still open

### 8. Root `loading.tsx` returns null
- Blank screen during initial load. Tied to a wider standardisation question — see #14.

### 9. Map has no keyboard navigation
- Markers aren't tabbable, no arrow-key panning, `MapContainer` lacks `role="region"` / `aria-label`. Strategic 🟢 in AUDIT (D8).

### 14. Inconsistent loading patterns
- Spinner / text / null / skeleton across the app — no unified approach. Includes #8. Needs a product decision on the canonical pattern before mechanical replacement.

---

## Deferred

| # | Issue | Reason |
|---|-------|--------|
| 7 | Touch targets too small (12-16px icons) | Polish pass |
| 12 | Color-only status indicators (no text/icon alt) | Mostly addressed by D2 priority icon+label; remaining cases are polish |
| 16 | Mobile sheets lack drag handle | Polish pass |
| 20 | Map retry button has no loading state | Minor UX |
| — | No `line-clamp` on card descriptions | Minor layout |
| — | z-index inconsistency (`z-[70]`) | Minor styling |
| — | Badge interactive variant too small (32px) | Polish pass |
| — | Print view map has no legend | Print-specific |
| — | Fixed marker sizes / no clustering | Map enhancement |
| — | Missing tooltips for truncated text | Polish pass |

# Feedback Implementation Plan (2026-03-19)

Status tracking for post-testing-session feedback implementation.

## Phase 1: Priority System Overhaul ✅
- [x] 1.1 Divera default priority → low (was medium)
- [x] 1.2 Training default priority → low for non-critical (was medium)
- [x] 1.3 High-prio glow/pulse animation on kanban cards
- [x] 1.4 Reko danger flags → auto-bump priority low → medium

## Phase 2: Kanban Board Restructure ✅
- [x] 2.1 New status `reko_done` (between reko and disponiert) — model, schema, types, migration
- [x] 2.2 Auto-transition reko → reko_done on reko form submit
- [x] 2.3 "Reko abgeschlossen" column UI on kanban board
- [x] 2.4 Collapsible "Abgeschlossen" column (collapsed by default, drop works collapsed, localStorage persist)
- [x] 2.5 Disponiert transition popup (WhatsApp copy, print, radio help text, dismiss)

## Phase 3: Notification Improvements ✅
- [x] 3.1 Clickable notifications → scroll to + open incident on kanban
- [x] 3.2 Better notification text format (address as primary identifier, clear status change)
- [x] 3.3 Reko notification cleanup (danger flags, personnel count, duration, consistent format)

## Phase 4: Reko & Detail Display Polish ✅
- [x] 4.3 Selected incident indicator — prominent ring/outline on active card

## Phase 5: Small Fixes & Features ✅
- [x] 5.1 Persist Meldungen toggle (localStorage)
- [x] 5.2 Map search hint "/" → "S"
- [x] 5.3 System theme default (dark → system)
- [x] 5.4 Add "Brandgefahr" to reko danger options
- [x] 5.5 Nachbarschaftshilfe comment field (nachbarhilfe_note)

## Phase 6: Vehicle-Person Drag Behavior ✅
- [x] 6.1 Driver drag = vehicle drag (drag payload represents vehicle)
- [x] 6.2 Block person-only drop for drivers (handled by type change)
- [x] 6.3 Visual drag hint (blue ring when dragging driver-vehicle)

## Phase 7: Reko Reassignment (Nice-to-have) ✅
- [x] 7.1 "Transfer Rekos" button on reko personnel in side panel
- [x] 7.2 Target person picker dialog
- [x] 7.3 Backend bulk reassign endpoint

## Phase 8: Performance & Snappiness ✅
- [x] 8.2 Smarter polling (version/hash check, skip if unchanged)
- [x] 8.3 WebSocket connection indicator (green/amber/red dot in footer)
- [x] 8.4 Reduce reko polling overhead (interval 3s → 10s)
- [x] 8.5 React rendering optimization (DroppableColumn memo comparison)

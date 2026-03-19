# Feedback Implementation Plan (2026-03-19)

Status tracking for post-testing-session feedback implementation.

## Phase 1: Priority System Overhaul
- [ ] 1.1 Divera default priority → low (was medium)
- [ ] 1.2 Training default priority → low for non-critical (was medium)
- [ ] 1.3 High-prio glow/pulse animation on kanban cards
- [ ] 1.4 Reko danger flags → auto-bump priority low → medium

## Phase 2: Kanban Board Restructure
- [ ] 2.1 New status `reko_done` (between reko and disponiert) — model, schema, types, migration
- [ ] 2.2 Auto-transition reko → reko_done on reko form submit
- [ ] 2.3 "Reko abgeschlossen" column UI on kanban board
- [ ] 2.4 Collapsible "Abgeschlossen" column (collapsed by default, drop works collapsed, localStorage persist)
- [ ] 2.5 Disponiert transition popup (WhatsApp copy, print, radio help text, dismiss)

## Phase 3: Notification Improvements
- [ ] 3.1 Clickable notifications → scroll to + open incident on kanban
- [ ] 3.2 Better notification text format (address as primary identifier, clear status change)
- [ ] 3.3 Reko notification cleanup (danger flags, personnel count, duration, consistent format)

## Phase 4: Reko & Detail Display Polish
- [ ] 4.1 Reko summary on kanban cards — standardized "X Pers. · ~Yh" format
- [ ] 4.2 Reko results section in side panel (dangers, personnel, duration, summary)
- [ ] 4.3 Selected incident indicator — prominent ring/outline on active card

## Phase 5: Small Fixes & Features
- [ ] 5.1 Persist Meldungen toggle (localStorage)
- [ ] 5.2 Map search hint "/" → "S"
- [ ] 5.3 System theme default (dark → system)
- [ ] 5.4 Add "Brandgefahr" to reko danger options
- [ ] 5.5 Nachbarschaftshilfe comment field (nachbarhilfe_note)

## Phase 6: Vehicle-Person Drag Behavior
- [ ] 6.1 Driver drag = vehicle drag (drag payload represents vehicle)
- [ ] 6.2 Block person-only drop for drivers
- [ ] 6.3 Visual drag preview (vehicle icon + name when dragging driver)

## Phase 7: Reko Reassignment (Nice-to-have)
- [ ] 7.1 "Transfer Rekos" button on reko personnel
- [ ] 7.2 Target person picker dialog
- [ ] 7.3 Backend bulk reassign endpoint

## Phase 8: Performance & Snappiness
- [ ] 8.1 Optimistic UI for all mutations (instant update, revert on failure)
- [ ] 8.2 Smarter polling (version/hash check, skip if unchanged)
- [ ] 8.3 WebSocket reliability (reconnect backoff, connection indicator, auto-recovery)
- [ ] 8.4 Reduce reko polling overhead (batch N+1 into single call)
- [ ] 8.5 React rendering optimization (memoization audit)

# i18n Phase 1 — Resume Status (2026-07-19)

Branch `feat/i18n` in worktree `.claude/worktrees/i18n`. Plan: `docs/plans/06-i18n.md` (Phase 1, German-only extraction).

## Interrupted by Claude monthly spend limit

Eight parallel extraction agents ran; two finished and were committed cleanly,
six were cut off mid-verification. Their part catalogs were all recovered and
**every key from all 8 areas is already merged into `frontend/messages/de.json`**.
The WIP commit after this file contains the six unverified areas' code edits.

## Completed + committed (verified, tsc clean at the time)

- `f8034b7` infra: next-intl, cookie locale, provider, helpers
- `e7ce707` toasts/contexts/api-client (`notifications.*`, `errors.api.*`)
- `c810eb5` login/nav/common/error pages (216 keys)

## In the WIP commit (edits applied, NOT verified — tsc/lint/tests not run)

| Area | Files | Namespaces |
|---|---|---|
| kanban | app/page.tsx, components/kanban/**, lib/kanban-utils.ts, lib/types/incidents.ts | kanban |
| incidents | components/incidents/**, driver/vehicle/gps prompts, components/mobile/**, lib/status-labels.ts, lib/incident-types.ts, lib/api/types/vehicles.ts | incidents |
| settings | app/settings/page.tsx, components/settings/** | settings |
| print/training/sync | components/print/**, training-*, components/sync/**, notification-settings, event-setup-checklist, lib/checklist-tasks.ts | print, training, sync, checklist, notifications.settings |
| map/events/display | app/map, components/map*, location/*, app/events, app/display/**, app/viewer/*, app/help | map, events, display, viewer, help |
| reko/divera/intake | app/reko*, components/reko/**, app/divera-pool, components/divera/**, app/alarm, app/check-in, lib/api/types/divera.ts | reko, divera, intake |

## Remaining work to finish Phase 1

1. `cd frontend && pnpm exec tsc --noEmit` — fix errors in the six WIP areas
   (likely a few half-applied edits at the exact cutoff point).
2. Missing-key sweep: grep the six areas' files for `t('` / `useTranslations(`
   keys and confirm each exists in `messages/de.json` (agents wrote part files
   before final self-checks; a few call sites may reference keys never written —
   add the German string to de.json in that case).
3. Leftover-German sweep: `grep -rnE 'ä|ö|ü|Ä|Ö|Ü' app components --include='*.tsx'`
   minus known intentional leftovers (print/WhatsApp/Divera OUTPUT content stays
   German by decision; brand names; domain values).
4. Known follow-ups from finished agents:
   - `lib/hooks/use-reko-notifications.tsx` — unassigned file, duplicates danger-type
     labels; reuse `notifications.operations.dangerTypes.*`.
   - `stats-widget.tsx` renders labels from `STATUS_LABELS` in `lib/types/incidents.ts`
     — confirm the kanban/incidents agents translated those render sites.
   - `connection-status.tsx` had pre-existing ENGLISH strings — keyed as-is under
     `common.connectionStatus.*` (copy bug to fix separately).
5. Tests (plan §Test plan): `test-utils/render-with-intl.tsx` wrapper around
   NextIntlClientProvider + de.json; migrate failing RTL tests; add
   `lib/i18n.test.ts` (no empty values, ICU placeholder sanity); run
   `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`.
6. Run `pre-commit run --all-files` once (per-area commits used --no-verify).
7. Squash/keep the WIP commit as desired; delete this file before merge to main.

Extraction conventions used by all agents: see the spec copied below this repo at
the session scratchpad, summarized: `useTranslations('<ns>')` in client components,
`getTranslations` in server components, `translateOutsideReact('full.key')` from
`@/lib/i18n-messages` outside React (never at module scope); ICU placeholders;
DB/domain values never translated; printed/WhatsApp/Divera output content stays German.

# i18n Phase 1 — COMPLETE (2026-07-19)

Branch `feat/i18n` in worktree `.claude/worktrees/i18n`. Plan: `docs/plans/06-i18n.md`.
Phase 1 = German-only extraction, zero intended visual change. **Done.**

## What shipped

- **Infrastructure:** `next-intl` (v4), cookie-based locale (`NEXT_LOCALE`, default `de`,
  no URL routing), provider in `app/layout.tsx`, server request config in
  `i18n/request.ts`, plugin in `next.config.mjs`.
- **Helpers:** `lib/i18n-messages.ts` (`translateOutsideReact`, `getActiveLocale`,
  `loadMessages` with de fallback), `lib/date-locale.ts` (`getDateFnsLocale`).
  `getIncidentTypeLabel`/`getOperationStatusLabel` made locale-aware.
- **Catalog:** `messages/de.json`, 20 namespaces, German = source of truth.
  A key missing in another locale falls back to `de` (no crash, no console spam).
- **Extraction:** every user-facing German UI string across ~120 files replaced
  with `t()` / `getTranslations` / `translateOutsideReact`. Domain/DB status,
  type and priority *values* stay untranslated; only their display *labels* are.
- **Tests:** `test-utils/render-with-intl.tsx` wrapper; `lib/i18n.test.ts` catalog
  sanity (no empty values, balanced ICU braces); provider-dependent RTL tests
  migrated. Suite green: 27 files / 157 tests.

## Verification (all green)

- `pnpm exec tsc --noEmit` — 0 errors.
- `pnpm test` — 157/157.
- `pnpm lint` — 0 errors (248 pre-existing warnings, unrelated).
- `pre-commit run --all-files` — all hooks pass (backend ruff hooks skip: not on host).
- German-word sweep (`scratchpad/german-sweep.js`, catches non-umlaut German too):
  remaining hits are all JSX comments, TS type names (`Person[]`/`Material[]`), or
  the documented carve-outs below.
- Runtime smoke on a worktree dev server: `/login` (client provider) and the 404
  page (server `getTranslations`) both render German, no `MISSING_MESSAGE`/`IntlError`.

## Intentional carve-outs (stay German by design)

- Printed output: `components/print/print-view.tsx`, `components/print/printable-map.tsx`,
  and the QR-label `title`/`subtitle` sent to `queueQRCodePrint` in
  `components/event-setup-checklist.tsx` (they are print content, never on screen).
- WhatsApp message bodies (`lib/whatsapp-formatter.ts`) and Divera outbound message
  bodies in `components/divera/divera-send-dialog.tsx` (dialog chrome IS translated).
- Training/demo prefill content: the dummy-summary arrays in
  `components/reko/reko-form.tsx` (same rule as seeded incident titles = data).
- Brand "KP Rück", transliteration/slug regexes, `console.*`, comments.
- `components/assignment-selector.tsx` is pre-existing **English** UI (Personnel/
  Vehicle/Material) — no German to extract; left as-is (separate copy concern).

## Not done here (later phases / follow-ups)

- `fr.json` + French (Phase 2), language switcher (Phase 3), `it.json`.
- Backend strings stay German (explicit non-goal).
- `components/connection-status.tsx` had pre-existing **English** strings; keyed
  as-is under `common.connectionStatus.*` — a copy bug for a translator, not i18n.

## Before merging to main

- History includes one `WIP(i18n): … cut off by spend limit` commit (all later
  verified); squash the `feat/i18n` commits if you want clean per-area history.
- Delete this file.

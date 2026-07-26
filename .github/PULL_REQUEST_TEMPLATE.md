## What & why

<!-- What does this change, and why? Link any related issue. -->

## Checklist

- [ ] Focused, coherent change (no unrelated edits)
- [ ] Ran `cd frontend && pnpm lint && pnpm test` and `cd backend && uv run pytest`
- [ ] E2E where it matters: `cd frontend && pnpm test:e2e` (needs `just dev`). CI runs only the
      `@smoke` subset — after touching auth, the board or alarm intake, run the full suite
- [ ] Followed the conventions in `CONTRIBUTING.md` / `CLAUDE.md` (edit in place, German domain
      language, `next-intl` messages rather than hard-coded strings)
- [ ] Nothing station-specific added: no roster, no fleet, no addresses, no one region's
      coordinates baked into code or defaults
- [ ] Schema change ships with an Alembic migration, and `just db migrate` runs clean
- [ ] No private/station data or secrets committed
- [ ] New files are compatible with AGPL-3.0-or-later

## Operator impact

<!--
Does an operator have to DO anything to take this update? A new required env var, a manual
migration step, a behaviour change they'd notice on the board? If yes, say so here — it becomes
the CHANGELOG entry and decides whether the next release is a MAJOR. "None" is a fine answer.
-->

## Screenshots

<!-- For UI changes, add before/after screenshots. -->

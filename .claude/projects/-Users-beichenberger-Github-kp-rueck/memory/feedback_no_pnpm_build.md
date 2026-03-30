---
name: No pnpm build during dev
description: Don't run pnpm build while dev server is running — it kills the dev server
type: feedback
---

Don't run `pnpm build` to verify changes — it disrupts the running dev server and forces a restart.

**Why:** Build process conflicts with the dev server process, requiring manual restart.

**How to apply:** Use `pnpm lint` or `cd frontend && npx tsc --noEmit` for type checking instead. Only build if explicitly asked.

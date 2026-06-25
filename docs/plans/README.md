# Implementation Plans — Pre-Publication Hardening & Features

Context: KP Rück will be featured in "118" (Swiss firefighting newspaper). Expect a
traffic spike on the public demo instance (Railway, `DEMO_MODE=true`). These plans
close reliability gaps and improve the first-visit experience, plus three feature
plans (i18n, PDF reports, undo).

Each plan is self-contained and written so it can be implemented independently by a
single agent/developer without re-reading this README. Read the **whole plan**
before starting; each contains exact file references, design decisions (already
made — do not re-litigate), implementation steps, and a test plan.

## Plans, priority order

| # | Plan | Priority | Scope | Depends on |
|---|------|----------|-------|------------|
| 01 | [Audit log retention](01-audit-log-retention.md) | **P0 — before publication** | Backend | — |
| 02 | [Global exception handler + request IDs](02-global-exception-handler.md) | **P0 — before publication** | Backend | — |
| 03 | [Endpoint hardening (demo reset, print agent, WebSocket)](03-endpoint-hardening.md) | **P0 — before publication** | Backend + small frontend | — |
| 04 | [Per-session demo sandbox events](04-per-session-demo-events.md) | **P0 — before publication** | Backend + frontend | 03 (demo reset part) recommended first |
| 05 | [Onboarding: welcome card, shortcut legend, conflict copy](05-onboarding-welcome-help.md) | **P1 — before publication if possible** | Frontend | — |
| 06 | [i18n (German + French)](06-i18n.md) | P2 — post-publication | Frontend | Do **after** 05 (05 adds strings) |
| 07 | [PDF after-action report](07-pdf-after-action-report.md) | P2 — post-publication | Backend + frontend | — |
| 08 | [Undo incident deletion](08-undo-incident-delete.md) | P2 — post-publication | Backend + frontend | — |
| 09 | [Emergency plans integration (generic provider, SchlüHü first)](09-emergency-plans-integration.md) | P2 — post-publication | Backend + frontend | — |
| 10 | [GPS-driven status automation (ruleset only)](10-gps-status-automation.md) | P3 — needs review before build | Backend | — |

## Shared conventions (apply to every plan)

- **Dev workflow:** never run `pnpm build` while the dev server is running — use
  `pnpm lint` and `pnpm exec tsc --noEmit` for frontend verification instead.
- **Backend checks:** `cd backend && uv run pytest` and `uv run ruff check . && uv run ruff format .`
  must pass before a plan is considered done.
- **Frontend checks:** `cd frontend && pnpm test` (Vitest) and `pnpm lint` must pass.
  E2E (`pnpm test:e2e`) requires backend + frontend running (`just dev`).
- **Migrations:** schema changes go through Alembic: `just db new "message"`, then
  `just db migrate`. Production runs `alembic upgrade head` on boot via `start.sh`.
- **UI language:** all user-facing copy is **German** (Swiss German conventions:
  "ss" instead of "ß", e.g. "Schliessen" not "Schließen") — until plan 06 lands.
- **Toasts:** use `import { toast } from "sonner"` (see
  `frontend/components/notifications/notification-toasts.tsx:92-96` for the
  action-button pattern).
- **Rate limits:** add a constant to the `RateLimits` class in
  `backend/app/middleware/rate_limit.py:62-84` and decorate the endpoint with
  `@limiter.limit(RateLimits.X)`. The endpoint signature must include
  `request: Request` for slowapi to work.
- **Settings (server-side key-value):** add defaults to `DEFAULT_SETTINGS` in
  `backend/app/services/settings.py:18-35`; `initialize_default_settings()` runs at
  startup and creates missing keys automatically.
- **Tests:** backend tests live under `backend/tests/` mirroring the module layout
  (`test_api/`, `test_background/`, `test_middleware/`, …) and use the fixtures from
  `backend/tests/conftest.py` (`db_session`, `client`, `editor_client`,
  `test_event`, `test_incident`, …). Rate limiting is globally disabled in tests by
  a conftest fixture. Frontend unit tests sit next to the source
  (`*.test.ts(x)`, Vitest + React Testing Library); E2E tests live in
  `frontend/tests/e2e/` using the fixtures in `frontend/tests/fixtures/auth.fixture.ts`,
  page objects in `frontend/tests/pages/`, and factories in `frontend/tests/data/factories.ts`.

## Pre-publication launch checklist (no plan needed, do manually)

1. Run a 10-minute load test against the demo instance (e.g. `k6` or `hey`):
   mixed GET `/api/incidents/?event_id=…`, demo login, a few PUTs. Watch Railway
   logs for `Audit pool timeout` warnings (audit pool is only 5+5 connections,
   `backend/app/database.py:34-43`) and 5xx rates.
2. Verify `DEMO_RESET_HOURS` is set appropriately for launch week (consider `1`).
3. Verify rate limits are active in production (`RateLimits.DEMO_DEFAULT = 60/minute`).
4. Confirm the demo seed shows a full, realistic board (see plan 04, step 6).
5. Snapshot the Railway Postgres before the article goes live.

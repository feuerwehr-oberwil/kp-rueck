# Implementation Plans – Hardening & Features

Context: KP Rück was featured in "118" (Swiss firefighting newspaper); the public
demo instance (Railway, `DEMO_MODE=true`) sees traffic spikes. The pre-publication
reliability work is **shipped** – what remains are post-launch features and polish.

Each plan is self-contained and written so it can be implemented independently by a
single agent/developer without re-reading this README. Read the **whole plan**
before starting; each contains exact file references, design decisions (already
made – do not re-litigate), implementation steps, and a test plan.

## Shipped (plan files removed – work is in git + committed)

- **Audit log retention** – `backend/app/background/audit_cleanup.py`
- **Global exception handler + request IDs** – `backend/app/middleware/request_id.py`
- **Endpoint hardening** (demo-reset admin-gate, `PRINT_AGENT_TOKEN`, WS room auth) –
  `print_agent_token` / `ws_require_auth` in `config.py`
- **Per-session demo sandbox events** – `POST /api/demo/sandbox` (`api/health.py`)
- **GPS status automation** (Rule A silent arrival, Rule B confirm-release) –
  `backend/app/services/gps_automation.py`
- **Undo incident deletion** – `POST /api/incidents/{id}/restore` + "Rückgängig" toast
- **PDF after-action report + unified export** – `services/pdf_report_service.py`,
  `GET /api/exports/events/{id}/report`, events-page + UserMenu export menus
- **Aufträge: multi-stop group routing (plan 12)** – group several incidents into one
  ordered route for a squad, the storm case. `frontend/components/map/routenplanung-panel.tsx`,
  `frontend/lib/hooks/use-route-planning.ts`, `incident_groups` (+ the `last_announced_*`
  columns that make the Funkdurchsage happen once per route, not once per stop). Shipped in
  0.3.0 and running at Oberwil.
- **Onboarding (plan 05) – resolved, no welcome card.** The welcome card was
  dropped (added nothing for daily operators). Shortcut discoverability is the
  existing **⌘K command palette** (also opens with `?`) – no separate legend. The
  409 conflict copy was already softened ("Von anderer Person geändert").

## Remaining plans, priority order

| Order | # | Plan | Scope | Why here | Depends on |
|-------|---|------|-------|----------|------------|
| 1 | 09 | [Emergency plans integration (generic provider, SchlüHü first)](09-emergency-plans-integration.md) | Backend + frontend | Largest (~500 LOC), high field value, external dependency – a proper feature effort | – |
| 2 | 13 | [Reko material requests and guided allocation](13-reko-material-requests.md) | Backend + frontend + training + migration | Large operational feature: structured Reko demand, normalized material kinds/capabilities, exact KP allocation, per-event exclusivity, and curated training profiles. Reservations must also cover Auftrag-owned material (plan 12, shipped) | – |
| 3 | 11 | [Material depletion thresholds: co-located & dual-dimension](11-resource-alarm-linking.md) | Backend + frontend | Dual-dimension material thresholds; adapt to Plan 13's normalized kind/type model instead of creating a competing managed-string identity | 13 phase 1 |
| 4 | 16 | [Training alarm intake: who is training, who gets which alarm](16-training-alarm-intake.md) | Backend + frontend + training | The Übungssteuerung "Alarmeingang" controls were **removed on 2026-07-28** (unused, and no recipient model). The dormant backend comes back only once "who is taking part in the exercise" is explicit state – otherwise a real training alarm texts the whole brigade | – |
| 5 | 06 | [i18n: actually translate](06-i18n.md) | Frontend | The machinery is **done** – next-intl, the `NEXT_LOCALE` cookie, deep-partial overlays merged over German, and a picker that only offers locales with real content. `fr.json` and `it.json` are still `{}`. What remains is translation work, not engineering; do it **last** so it absorbs the strings from 09/11/13 in one pass | 09, 11, 13 |

### Engineering debt (no deadline, pick up between features)

| # | Plan | Why here |
|---|------|----------|
| 14 | [Typing debt: widen the blocking mypy subset](14-typing-debt.md) | mypy blocks on `auth`/`middleware`/`schemas`/`services/alerting` and is advisory for the rest (532 findings, and drifting up — new untyped code keeps landing in the advisory zone). Progress = moving one package into the blocking list, at zero. Three patterns explain most of the tree – read those before starting. |
| 15 | [Make the E2E suite fast enough for CI](15-e2e-in-ci.md) | Phases 2–3 have landed: the `@smoke` subset runs on every PR and `e2e-nightly.yml` runs the full suite. Still open: phase 1 (measure what is actually slow and flaky), making the smoke job a **required** check on main, and phase 4 (widen). |

## Shared conventions (apply to every plan)

- **Dev workflow:** never run `pnpm build` while the dev server is running – use
  `pnpm lint` and `pnpm exec tsc --noEmit` for frontend verification instead.
- **Backend checks:** `cd backend && uv run pytest` and `uv run ruff check . && uv run ruff format .`
  must pass before a plan is considered done.
- **Frontend checks:** `cd frontend && pnpm test` (Vitest) and `pnpm lint` must pass.
  E2E (`pnpm test:e2e`) requires backend + frontend running (`just dev`).
- **Migrations:** schema changes go through Alembic: `just db new "message"`, then
  `just db migrate`. Production runs `alembic upgrade head` on boot via `start.sh`.
- **UI language:** all user-facing copy is **German** (Swiss German conventions:
  "ss" instead of "ß", e.g. "Schliessen" not "Schließen") – until plan 06 lands.
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

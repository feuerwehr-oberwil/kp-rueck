# Development

Commands, tests, environment and releases for people and agents who change KP Rück. The short
version every task needs is [`../AGENTS.md`](../AGENTS.md); this page holds the rest.

## Commands

```bash
just dev            # dev stack with hot reload (Docker)
just db seed        # seed initial data
just db migrate     # run pending migrations   (just db help: shell, status, history, new "msg")
just dev-stop       # stop the dev stack (docker-compose.dev.yml only)
just dev-clean      # DELETES the dev database and dev tiles – asks first
just tiles-download # optional offline map tiles; just tiles-status checks them

# Mirror a real deployment into the dev stack (source: any Postgres URL, or 'railway' for the
# linked project). --config = settings/inventory only, no Einsätze. The replaced dev DB is dumped
# to ./backups/ first; the dev logins (admin/kp-dev-password, editor, viewer) are re-seeded.
just dev-sync railway
just dev-sync postgres://user:pass@host:5432/db --config
```

The `dev-` prefix is deliberate: which recipes act on production is in
[`../AGENTS.md`](../AGENTS.md) «Production and development». Their old names were `stop` and `clean`. With those names, an operator who had installed `just`
for the offline-tiles step was one command away from taking their own board down, with a recipe
described as "stop all services".

Without Docker:

```bash
cd backend && uv sync && uv run python -m app.seeds   # tables + seed data
cd backend && uv run uvicorn app.main:app --reload   # API on :8000 (Swagger at /docs)
cd backend && uv run ruff check . && uv run ruff format .
cd frontend && pnpm install && pnpm dev              # app on :3000
cd frontend && pnpm lint                             # ratchet per rule on warnings AND eslint-disable comments: eslint-ratchet.json
cd frontend && pnpm build
just hooks                                           # once per clone: every push runs `just ci-static` first
```

## Tests

```bash
just test                                       # backend + frontend unit + E2E (services running)
just test-ui                                    # E2E in Playwright UI mode
just smoke tests/e2e/01-auth/login.spec.ts      # one spec (or a --grep text) on a throwaway stack, own ports
cd backend && uv run pytest
cd frontend && pnpm test                        # Vitest (pnpm test:watch)
cd frontend && pnpm test:e2e                    # Playwright (pnpm test:e2e:ui)
cd frontend && pnpm test:e2e tests/e2e/01-auth/ # one suite; add --headed via `pnpm exec playwright test`
```

- Unit tests: Vitest + React Testing Library + jsdom (config: `vitest.config.ts`, setup: `vitest.setup.ts`). Files: `**/*.{test,spec}.{ts,tsx}` outside `tests/`, plus `scripts/**/*.test.mjs`.
- E2E: Playwright with TypeScript, Page Object Model + Custom Fixtures, Factory pattern + API helpers, in `frontend/tests/`.
- Visual regression: `just visual` – frozen screens (`frontend/tests/visual/*.visual.ts`,
  own config `playwright.visual.config.ts`). A production build renders them against
  `app.seeds.visual` (the demo storm evening at one fixed instant; the browser clock frozen at the
  same instant, basemap tiles stubbed flat). The run compares them with the PNGs in
  `tests/visual/__screenshots__/`. CI job `visual` is a required check since 2026-10-10.
  Baselines come from CI only (`visual-baselines.yml` → `just visual-accept <run-id>`). A local
  run is a look, not a verdict. **Never accept a baseline to turn the check green.** Accept one
  only for a deliberate visual change, in its own commit with the reason. If a change makes
  something on one of those screens depend on the time or the server clock, pin it in the
  seed/fixture, not with a mask. `docs/VISUAL_TESTS.md`.

## Environment and deployment

- Variables: `.env.example` (deployment), `backend/.env.example`, `frontend/.env.local.example`.
  Self-hosting is `docs/DEPLOYMENT.md`, Railway is `docs/RAILWAY.md`: two supported paths on the
  same images. Pick by who runs the server. Compose survives an internet outage; Railway means
  nobody has to look after a box.
- **`NEXT_PUBLIC_*` is inlined at BUILD time**, so it is a development convenience only.
  Published images are built without it. On Railway, `NEXT_PUBLIC_API_URL` must stay unset (it
  breaks mobile logins via third-party cookies). At runtime the server-side proxy route reads
  `API_URL`, and the browser falls back to same-origin paths (`/backend-api`, `/tiles`); see
  `frontend/lib/env.ts`. The server hands a runtime `CARTO_API_KEY` to the browser, so CARTO
  raster requests can include their required `?key=` query parameter. It is never baked into the
  image.
- `docker-compose.yml` is the PRODUCTION stack (GHCR images pinned by `KP_RUECK_TAG`, Caddy as
  the single origin: `/socket.io` + `/api` → backend, `/tiles` → tileserver, the rest →
  frontend). `docker-compose.dev.yml` is `just dev`. `docker-compose.yml` sets `ENVIRONMENT=production`. That
  turns on mandatory secrets, no auth bypass, and no sample data at all: no sample incidents, and
  no fleet, roster, materials or training locations either (`backend/app/environment.py`,
  `backend/app/seeds/boot.py`). Production is not Railway-only.
- Offline tiles: `docs/OFFLINE_MAPS.md`. The region is configuration (`TILES_REGION` /
  `TILES_BOUNDS` / `TILES_AREA` / `TILES_PBF_URL`, default Basel-Landschaft). All three tile
  scripts share `TILES_NAME` (the on-disk filename). Do not rename it on an existing volume.
  There is no tileserver config file: `scripts/init-tileserver.sh` hands over to TileServer GL,
  which auto-detects `/data/*.mbtiles`. The generated data goes to zoom 14 (planetiler's default;
  the script passes no `--maxzoom`). Closer zooms overzoom. The dev stack publishes the tileserver
  on :8080. The production stack publishes no tileserver port (Caddy routes `/tiles`).

**The frontend image is built WITHOUT `NEXT_PUBLIC_API_URL` on purpose**: a baked-in URL ties
the image to one station. The browser calls `/backend-api` on its own origin, and Next forwards
to the runtime `API_URL`. The same reasoning applies to map tiles (`getTileBaseUrl` → `/tiles`).

## Releases

**Releases are for other stations, not for us.** A `v*` tag exists so a self-hoster can pull a
known set of images. The number answers *what does this update cost the operator*: PATCH =
fixes, MINOR = features + automatic migrations, MAJOR = operator action required (table at the
top of `CHANGELOG.md`). To cut one:

1. `just changelog` (git-cliff draft).
2. Curate the draft into `[Unreleased]`.
3. `just release X.Y.Z` (bumps all four packages; a pytest fails if they drift).
4. `just release-tag X.Y.Z`.
5. `git push --follow-tags`. This runs the CI gate and publishes the four images plus a GitHub
   Release whose body is the committed CHANGELOG section.

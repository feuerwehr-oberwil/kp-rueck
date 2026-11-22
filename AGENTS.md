# AGENTS.md

KP Rück is the tactical operations board of a fire-service command post: a digital magnet board
for incidents (Einsätze), personnel, vehicles and materials. The operator runs it from a desktop;
phones view. [`docs/README.md`](docs/README.md) indexes every doc. If you would answer a setup,
deployment, tiles or architecture question from memory, read it first.

## Read before you change

| You change | Read first |
| --- | --- |
| Save state, sync, a free-text incident field, «Synchronisiert» | [`frontend/lib/field-save.ts`](frontend/lib/field-save.ts) (header) and [`docs/FRONTEND.md`](docs/FRONTEND.md) «Synchronisiert» |
| A file listed in `shared/MANIFEST.json` | [`shared/README.md`](shared/README.md) – see «Shared with KP Front» below |
| UI: layout, colour, type, copy on screen | [`docs/DESIGN.md`](docs/DESIGN.md) «UI rules», then the section of [`docs/FRONTEND.md`](docs/FRONTEND.md) you touch |
| Anything under `frontend/` | [`docs/FRONTEND.md`](docs/FRONTEND.md): Next.js facts, phone layout, overflow, i18n, the shared patterns |
| Anything under `backend/`, an API route | [`docs/BACKEND.md`](docs/BACKEND.md): commit rule, row-lock order, trailing slash, integration seams |
| Deployment, env vars, images, a release | [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) «Environment and deployment» / «Releases», then [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (Compose) or [`docs/RAILWAY.md`](docs/RAILWAY.md) |
| One of the nine visual screens | [`docs/VISUAL_TESTS.md`](docs/VISUAL_TESTS.md) |

## Commands

```bash
just dev            # dev stack with hot reload (Docker)
just db seed        # seed initial data
just db migrate     # run pending migrations   (just db help: shell, status, history, new "msg")
just dev-stop       # stop the dev stack (docker-compose.dev.yml only)
just dev-clean      # DELETES the dev database and dev tiles – asks first
just check          # format, lint, types, shared files – no stack needed
just ci-static      # frontend build + just check: what the pre-push hook runs
just hooks          # once per clone: every push runs `just ci-static` first
just test           # backend + frontend unit + E2E (services running)

cd backend && uv run pytest tests/<file>.py     # one backend file
cd frontend && pnpm test                        # Vitest
cd frontend && pnpm test:e2e tests/e2e/01-auth/ # one E2E suite
```

More commands, the path without Docker and the test layout: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Required PR checks

Branch protection on `main` (22.11.2026) requires these CI jobs: Backend Tests, Backend Lint &
Format, Frontend Type Check, Frontend Lint, Frontend Unit Tests, Frontend Build, Images (build +
boot + smoke), E2E (@smoke), Visual (screenshots), Shared files match KP Front. The other CI jobs
(secrets, security scans, mypy, print agent) fail red too: fix them before you ask for review.
The DCO job needs a `Signed-off-by` line on every non-merge commit: commit with `git commit -s`.

- `just ci-static` covers lint, format, types, the build and the shared files before a push.
- A pytest fails when `docs/openapi.json` drifts from the code. Run `just openapi` after an API
  change.
- Visual baselines come from CI only. Accept one only for a deliberate visual change, in its
  own commit with the reason. **Never accept a baseline to turn the check green.**
- **A correction becomes a check.** When the owner corrects a change and a lint rule
  (`frontend/scripts/eslint-kp.mjs`, or an error in `frontend/eslint.config.mjs`), a test or a
  type can hold it, build that check in the same PR and name the correction in the PR body.
  Prose comes last: the module's header, or a line here only for what every change must know.

## Production and development

The `dev-` prefix is deliberate. `just up` / `just down` / `just doctor` / `just init` are the
**station operator's** verbs and act on the production stack (`docker-compose.yml`, project
`kp-rueck`). So do `just backup` and `just restore`. The recipes for development:

- `dev`, `dev-stop`, `dev-clean` and `just db start|shell|seed` act on
  `docker-compose.dev.yml` (project `kp-rueck-dev`) only. `dev-stop` and `dev-clean` also clear
  the dev containers (`dev-clean`: and dev volumes) left from before that project name.
- `just be` and `just db migrate|up|down|status|new` run on the host against the backend's
  `DATABASE_URL`. An exported variable wins over `backend/.env` (whose example is the dev
  database on port 5433). Check the value before you run them. `just db history` reads only
  the local migration files.
- `just dev-sync <source>` READS a real deployment into the dev stack. `railway` is the linked
  Railway project, so it reads live data. Run it only when the owner asks for it.
- `just staging-up` / `just staging-down` start and stop the shared Railway staging environment.
  Run them only when the owner asks for it.
- `docker-compose.yml` sets `ENVIRONMENT=production`: mandatory secrets, no auth bypass, no
  sample data (`backend/app/environment.py`).

## Shared with KP Front

Some files are shared with KP Front by copy. `shared/MANIFEST.json` lists each one (path per
repo, owner, sha256). To change one:

1. Edit it in the owner (kp-front) first.
2. Copy it byte for byte.
3. Run `python3 scripts/check_shared.py --update` in both repos.
4. Push both PRs on branches with the SAME name. The required CI check «Shared files match KP
   Front» compares against kp-front's branch of that name.
5. Merge the owner first.

Never re-record a hash on one side to turn the check green. Step by step:
[`shared/README.md`](shared/README.md).

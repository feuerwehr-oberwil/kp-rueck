# KP Rück Backend

FastAPI service for the KP Rück operations dashboard. It owns the database, the photo store,
the WebSocket board updates, and every outbound integration — one deployment per station.

For running a station, start at [`../docs/SETUP.md`](../docs/SETUP.md); this file is for
working *on* the backend.

## Stack

- **FastAPI** — async Python web framework
- **SQLAlchemy 2.0** — async ORM (`AsyncSession` everywhere)
- **PostgreSQL 16**
- **Pydantic / pydantic-settings** — request/response schemas and configuration
- **Alembic** — migrations
- **uv** — package manager. Python **3.12+**

## Running it

The normal path is the whole stack from the repository root — it starts Postgres for you and
reloads on save:

```bash
just dev              # http://localhost:8000, docs at /docs
```

To run only the backend on the host, with the database still in Docker:

```bash
just be               # starts the dev Postgres, then uvicorn on :8000
```

Or by hand, from this directory:

```bash
uv sync
cp .env.example .env                    # see the file itself for what each value does
docker compose -f ../docker-compose.dev.yml up -d postgres
uv run alembic upgrade head             # create the schema — seeding does NOT do this
uv run python -m app.seed               # optional: reference data
uv run uvicorn app.main:app --reload
```

`alembic upgrade head` before `app.seed` is not optional: the seed script deliberately does
not `create_all`, so development and production build the schema the same way.

## Layout

```
app/
├── main.py              # app factory, lifespan, router registration
├── config.py            # pydantic-settings Settings (the .env contract)
├── environment.py       # is_production_environment() — what turns on the hard rules
├── database.py          # async engine, session factory, Base
├── models.py            # SQLAlchemy models (single module)
├── api/                 # 33 routers, one per resource — mounted in main.py
├── crud/                # query layer, one module per resource
├── schemas/             # Pydantic request/response models, one module per resource
├── services/            # domain logic (alerting, notifications, PDF, Divera intake, …)
├── auth/                # JWT, cookies, dependencies, token blocklist, throttling
├── middleware/          # audit, rate limit, request id
├── background/          # scheduled jobs
├── telemetry/           # opt-in crash reporting (vendored, shared with kp-front)
└── seed*.py             # seed.py (reference data), seed_training.py, seed_demo.py
```

Note that `crud` and `schemas` are **packages**, not single modules, and routes live under
`api/` rather than in one `routes.py`.

## API

The committed contract is [`../docs/openapi.json`](../docs/openapi.json); regenerate it with
`just openapi` in the same change that adds or renames a route — a pytest fails when it drifts.

Interactive docs are at `/docs` and `/redoc` **in development only** — both are disabled when
`ENVIRONMENT=production`.

The main resources are `/api/incidents`, `/api/events`, `/api/personnel`, `/api/vehicles`,
`/api/materials`, `/api/assignments`, `/api/reko`, `/api/print`, `/api/alarms`. Paths are
plural and sit under `API_V1_PREFIX` (default `/api`). There is no `/api/operations` — an
Einsatz is an `incident`, and an `event` is the Lage that contains several of them.

## Tests

```bash
uv run pytest                 # needs a Postgres test database
uv run pytest -k auth         # one area
uv run pytest -n 4            # the same suite in parallel, ~3x faster
```

`TEST_DATABASE_URL` selects the database (default
`postgresql+asyncpg://kprueck:kprueck@localhost:5433/kprueck_test`). The suite drops and
recreates the schema once per session, so point it at a scratch database, never a real one.
It is the ONE place a database URL is configured — every test derives from it, including the
migration-drift test, so moving the port moves the whole suite.

**Parallel runs** (`-n`, pytest-xdist) give each worker **its own database** — `kprueck_test_gw0`,
`kprueck_test_gw1`, … — created from the configured one at session start and dropped at the end.
Sharing a single database between concurrent workers is how a reliable suite becomes a flaky one,
and a flaky suite is worse than a slow one. `-n` stays opt-in: plain `uv run pytest` still uses the
single configured database and needs no extra privileges. The user does need `CREATEDB` for `-n`.

Avoid `-n auto` — it picks one worker per core, and past ~4 the suite is waiting on Postgres
round-trips rather than on CPU, so the extra workers only add contention. See the measurements in
`.github/workflows/ci.yml` next to the flag.

`tests/test_database/test_migration_drift.py` asserts that the migrations and the models agree by
building a second scratch database (`kprueck_test_drift`, likewise per worker) purely from Alembic.

## Lint, format, types

```bash
uv run ruff check .           # blocking in CI, currently at zero
uv run ruff format .
uv run mypy app               # a named subset is blocking; the whole tree is advisory
```

Every entry in the ruff `ignore` list in `pyproject.toml` carries a written reason — read it
before adding another. The mypy split, and which packages are already at zero, is documented at
the top of [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Migrations

```bash
just db new "add x to y"      # autogenerate a revision
just db migrate               # upgrade to head
just db status                # current revision
```

Migrations run automatically on boot in production (`start.sh` → `alembic upgrade head`).

## Configuration

`app/config.py` is the contract and `.env.example` documents each value. In production
(`ENVIRONMENT=production`) the secrets become mandatory, the development auth bypass is
refused, sample data is never seeded, and shared `editor` accounts are refused — see
[`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

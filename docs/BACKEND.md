# Backend conventions

Rules for code under `backend/`. [`../AGENTS.md`](../AGENTS.md) points here before a backend
change; the architecture behind them is [`ARCHITECTURE.md`](ARCHITECTURE.md).

Five rules in [`FRONTEND.md`](FRONTEND.md) bind backend code too. Read the one you touch:

- Backend output is German-only, except notifications and the `/feld` errors (stable `code`,
  `CodedHTTPException`): «i18n».
- Every notification row comes from `services/notification_params.py` (`type` + `params` + the
  German `message`): «Notification text».
- An undo is a new write that must still be valid now (409 on a change, `expected_ids` under the
  Auftrag lock): «Undo never restores a snapshot blindly».
- A new free-text incident field joins `IncidentTextField` (`text_base`, 409 `text_conflict`):
  «Synchronisiert».
- A duration the backend writes (`duration_de`) uses the board's notation (`12'`, `1h 23'`):
  «Durations go through `lib/duration.ts`».

## Conventions

- `async`/`await` everywhere. Sessions are an injected `AsyncSession`. Settings are Pydantic and
  injected too.
- Put lifecycle code in the `lifespan` context (`tests/test_lifespan_only.py` fails on `on_event`).
- SQLAlchemy 2.0 mapped-column syntax; full type hints.
- **CRUD and services flush, the request commits** (once, before the response – `commit_request`).
  Send anything that a board or another session reacts to after the commit: `after_commit(db, …)`
  or a background task. Every other explicit commit has a comment beside it that says why. The
  rule lives above `get_db` in `backend/app/database.py`.
- **Row locks in one order**: Aufträge (by id) → Einsätze (by id) → the resource row. The helpers
  and the reasoning are in `backend/app/crud/locking.py`. A new writer that locks must use the
  helpers, or it deadlocks against completion/reorder. New assignments go through
  `ensure_assignable`.


## API endpoints

**The trailing slash on the collection routes is not decorative.** `/api/personnel` (no slash)
answers **307** to `/api/personnel/`. A redirected POST does not carry its body, so a scripted
write silently does nothing and looks like a success. Write the slash:

Incidents: `/api/incidents/` (GET, POST, PUT, DELETE)
Personnel: `/api/personnel/` (GET, POST, PUT)
Vehicles: `/api/vehicles/` (GET, POST, PUT)
Materials: `/api/materials/` (GET, POST, PUT)
Alarm intake: `/api/alarms` (POST) – provider-neutral webhook, any dispatch system; Divera adapter at `/api/divera/webhook`
Integrations: `/api/integrations` (GET) – capability registry (which provider is configured per domain)

Full docs: [`openapi.json`](openapi.json) – the committed contract. To regenerate it, run
`just openapi` (a pytest fails when it drifts). Live Swagger UI while the backend runs:
http://localhost:8000/docs

**Integration seams** (provider-neutral, see [`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md)):
- Inbound alarms funnel through `services/divera_intake.py` (shared inference/auto-attach). The pool table carries `source`/`source_id` provenance; incidents carry `source`/`source_ref`.
- Outbound alerting (Ausalarmierung) goes through the `AlarmProvider` protocol in `services/alerting/` (Divera = first adapter).
- `services/roster_snapshot_sync.py` reads a published roster file (`STATION_INDEX_SOURCE` → `index.json`, fallback `ROSTER_SNAPSHOT_SOURCE`; [`ROSTER-SNAPSHOT.md`](ROSTER-SNAPSHOT.md)). The contracts and the reading rules (`app/roster_snapshot.py`, `app/roster_snapshot_ingest.py`, `app/station_index.py`, `scripts/roster_snapshot_from_csv.py`, `scripts/station_index_build.py`) are byte-identical with kp-front. Edit them THERE first. They are listed in `shared/MANIFEST.json` (see [`../AGENTS.md`](../AGENTS.md#shared-with-kp-front) «Shared with KP Front»).
- Personnel provider identity lives in `personnel_external_identities` – the only place where a person's provider-side id exists. Migration `b7c2e5a1d4f8` dropped the deprecated `personnel.divera_user_id` dual-write. The personnel API exposes only a `divera_linked` boolean.
- Printing: transport-neutral job queue + pull agent ([`PRINT_AGENT.md`](PRINT_AGENT.md)).

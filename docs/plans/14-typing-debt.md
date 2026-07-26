# 14 – Typing debt: widen the blocking mypy subset

**Status:** open, low priority, no deadline. This is a plan for *paying down*, not a bug.

## Where things stand

`mypy app --ignore-missing-imports` reports **526 errors in 59 files** (was ~705). CI runs
mypy twice (`.github/workflows/ci.yml`, job `backend-typecheck`):

- **Blocking**, at zero and must stay there:
  `app/auth`, `app/middleware`, `app/schemas`, `app/services/alerting`,
  `app/crud`, `app/background`, `app/websocket_manager.py`, `app/models.py`, `app/traccar.py`
- **Advisory** (`continue-on-error: true`): the whole tree, as a report

The split exists because one gate over everything could only ever be advisory, and an advisory
gate is one nobody reads. Before this split the single step carried the comment *"TODO: make
blocking once type errors are fixed"* – a promise nothing was moving toward.

**The unit of progress is moving one package from the advisory step into the blocking one.**
Don't widen the blocking list without getting that package to zero first, and don't add a
package-wide `# type: ignore` to make it fit.

## What is left, by package

| Package | Errors | Character |
| --- | ---: | --- |
| `app/api` | 318 | Mostly missing annotations on route handlers |
| `app/services` | 203 | Mixed: annotations plus genuine `arg-type` mismatches |
| `app/seed_training`, `app/seed_demo`, `app/seed` | 41 | Seed scripts, lowest value |
| `app/telemetry` | 14 | **Deliberately excluded – see below** |
| `app/main` | 6 | Startup/shutdown callables, one real Starlette signature mismatch |

By error code the remainder is still dominated by annotation debt rather than defects:
`no-untyped-def` 253, `type-arg` 97, `attr-defined` 51, `arg-type` 47.

## Three patterns account for most of it

Recognising these first will save re-deriving them per file:

1. **One `result` variable reused across differently-shaped `select()`s.** mypy pins the type
   from the first assignment, so every later use reports nonsense – `"UUID" has no attribute
   `"name"`, `"Personnel" has no attribute "status"`. **Nothing is wrong at runtime.** Fix by
   giving each query its own variable. Worth doing early: these messages look exactly like a
   real defect would, so they train the reader to dismiss the real one. (All occurrences in
   `app/crud` are cleared; expect the same shape in `app/api` and `app/services`.)
2. **SQLAlchemy generic gaps.** Both are now solved centrally, so reuse the solutions rather
   than re-deriving them: `Result[Any]` has no `rowcount` (that lives on `CursorResult`) →
   `app.database.execute_dml()`; `type[Base]` has no `id` → `ModelProtocol` in
   `app/crud/base.py`, used as the `TypeVar` bound. Neither needs an ignore per call site.
3. **Bare `dict` / `list` / `set` / `asyncio.Task`.** Purely mechanical: add the parameters.
   This is `type-arg`, 97 left, and the cheapest volume to clear.

## `app/telemetry` is excluded on purpose

`scrub.py`, `envelope.py`, `outbox.py` and `forwarder.py` are **vendored byte-identical with
kp-front** and pinned by checksum (`backend/tests/test_telemetry_vendored.py`). Editing them
means the protocol in that test's docstring: change both repositories, run both suites, update
both hashes in one change.

Its 14 errors are all annotation-only (`dict` without parameters, one `dict[str, str]` that
legitimately also holds a bool). Doing that dance for cosmetic annotations on the code that
decides what leaves the building is a bad trade: the sanitiser's guarantees come from its 39
absence-based tests and the checksum, and mypy adds nothing there. Fold it in only when those
files are being changed for a real reason anyway.

## Suggested order

1. ~~`app/traccar` and `app/background`~~ – **done**, both blocking.
2. ~~`app/crud`~~ – **done**, blocking. Fixed patterns 1 and 2 once, which also removed a
   chunk of the noise that used to show up in `api`/`services`.
3. ~~`app/websocket_manager` and `app/models`~~ – **done**, both blocking.
4. `app/api` (318) – large but repetitive; can be done per router.
5. `app/services` (203) – last, because it contains the genuine mismatches worth thinking about.
6. Seed scripts – or never; they run once, by hand, and a failure is loud and immediate.

After each step: move that path into the blocking mypy step in `ci.yml`, in the same change.

## What the first four steps actually turned up

Worth recording, because it calibrates what to expect from the rest: of ~184 findings cleared,
**two were real defects and one was dead code**. The rest were annotation debt or mypy
describing a variable-reuse artefact.

- `except Exception: pass` in `photo_storage` wrapped the `HTTPException` that the MIME check
  raises to reject a file — `HTTPException` **is** an `Exception`, so nothing was ever rejected
  there. (Found via ruff's `S110`, in the same pass.)
- The audit middleware's fire-and-forget `create_task` kept no strong reference, so an audit
  entry could be lost to garbage collection mid-flight.
- `func.count(...).label("count")` collides with `tuple.count` on a `Row`. **Verified at runtime
  that SQLAlchemy resolves the label correctly** — this one was NOT a bug, but the label was
  renamed to `incident_count` because no checker can model it and the shadow misleads a reader.

Pattern 1 (reused variable) was by far the biggest source of scary-looking-but-harmless
findings: `result`, `resource`, `incident`, `report` and `layers` each held two different
shapes in one function.

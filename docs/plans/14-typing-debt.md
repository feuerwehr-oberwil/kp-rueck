# 14 – Typing debt: widen the blocking mypy subset

**Status:** open, low priority, no deadline. This is a plan for *paying down*, not a bug.

## Where things stand

`mypy app --ignore-missing-imports` reports **~705 errors in 78 files**. CI runs mypy twice
(`.github/workflows/ci.yml`, job `backend-typecheck`):

- **Blocking**, at zero and must stay there:
  `app/auth`, `app/middleware`, `app/schemas`, `app/services/alerting`
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
| `app/api` | 288 | Mostly missing annotations on route handlers |
| `app/services` | 182 | Mixed: annotations plus genuine `arg-type` mismatches |
| `app/websocket_manager` | 61 | Generics (`dict`, `set` without parameters) |
| `app/crud` | 55 | Two recurring library-typing patterns, see below |
| `app/background` | 36 | `asyncio.Task` without a parameter, annotations |
| `app/seed_training`, `app/seed_demo`, `app/seed` | 33 | Seed scripts, lowest value |
| `app/main` | 17 | Startup/shutdown callables, one real Starlette signature mismatch |
| `app/models` | 16 | SQLAlchemy declarative attributes |
| `app/telemetry` | 14 | **Deliberately excluded – see below** |
| `app/traccar` | 3 | Small, easy win |

By error code, the tree is dominated by annotation debt rather than defects:
`no-untyped-def` 330, `type-arg` 155, `attr-defined` 88, `no-untyped-call` 50, `arg-type` 48.

## Three patterns account for most of it

Recognising these first will save re-deriving them per file:

1. **One `result` variable reused across differently-shaped `select()`s.** mypy pins the type
   from the first assignment, so every later use reports nonsense – e.g. in
   `app/crud/print_jobs.py`, `"UUID" has no attribute "name"` and
   `Argument 2 … has incompatible type "PrintJob"; expected "Incident"`. **Nothing is wrong at
   runtime.** Fix by giving each query its own variable. Worth doing early: these messages look
   exactly like a real defect would, so they train the reader to dismiss the real one.
2. **SQLAlchemy generic gaps.** `Result[Any]` has no `rowcount` (it lives on `CursorResult`),
   and `ModelType`/`type[Base]` has no `id` in the generic CRUD base. Needs a `Protocol` with an
   `id` attribute as the `TypeVar` bound, not an ignore per call site.
3. **Bare `dict` / `list` / `set` / `asyncio.Task`.** Purely mechanical: add the parameters.
   This is `type-arg`, 155 of them, and the cheapest volume to clear.

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

1. `app/traccar` (3) and `app/background` (36) – small, self-contained, prove the workflow.
2. `app/crud` (55) – fixes pattern 1 and 2 once, which also removes noise from `api`/`services`.
3. `app/websocket_manager` (61) and `app/models` (16) – mechanical.
4. `app/api` (288) – large but repetitive; can be done per router.
5. `app/services` (182) – last, because it contains the genuine mismatches worth thinking about.
6. Seed scripts – or never; they run once, by hand, and a failure is loud and immediate.

After each step: move that path into the blocking mypy step in `ci.yml`, in the same change.

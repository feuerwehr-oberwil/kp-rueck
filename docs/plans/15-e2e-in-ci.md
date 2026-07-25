# 15 – Make the E2E suite fast enough for CI

**Status:** open, no deadline. The suite works; it is too slow and too flaky to gate on.

## Where things stand

`frontend/tests/e2e/` holds roughly **300 Playwright tests**. The CI job exists but is disabled:

```yaml
# .github/workflows/ci.yml
e2e-tests:
  if: false  # Disabled - run locally
```

The reason in the workflow comment is honest – ~25 minutes per run, and flaky enough that a red
result stopped meaning anything. Until this plan lands, the suite is a **local** tool and
`CONTRIBUTING.md` says so: run it before a release and after touching auth, the board, or alarm
intake. Nothing else in CI covers a full click-through.

Worth knowing: **kp-front runs Playwright as a blocking CI job.** The two repositories are not
at parity here, so don't infer one repo's coverage from the other.

## Goal

A **blocking** smoke subset on every pull request, in **under five minutes**, plus the full
suite on a schedule. Not "the whole suite, faster" – that is a bigger job with a worse ratio.

## Plan

### Phase 1 – find out what is actually slow and what is actually flaky

Do this before changing anything; the assumption that it is evenly slow is untested.

- Run with `--reporter=json` and sort by duration. Expect a small number of specs to dominate.
- Run the suite ~5× against an unchanged tree and record which specs fail intermittently. A
  test that fails without a code change is not evidence about the code, and every one of them
  has to be either fixed or quarantined before any of this can block a merge.
- Common causes here, in likely order: waiting on a fixed timeout instead of a condition,
  tests sharing one database and racing, and the Socket.IO connection settling after assertions
  already ran.

### Phase 2 – tag a smoke subset

Pick the paths where a break is both plausible and expensive, and tag them
`@smoke` (`test.describe('…', { tag: '@smoke' })`):

- log in, land on the board, see an event
- create an incident and see it appear
- alarm intake: `POST /api/alarms` → incident visible on the board
- the print-agent claim cycle, if it can run without a printer
- one `/display/*` wall-display route renders

Target: **under 25 specs**, no known flake among them.

### Phase 3 – wire it up

- PR job: `pnpm exec playwright test --grep @smoke`, **blocking**, replacing `if: false`.
- Scheduled job: full suite nightly (`on: schedule`), non-blocking, reporting to wherever a
  failure will actually be seen. A nightly nobody reads is the same problem in a new costume.
- Keep the Postgres service container and fixtures the existing job already defines – that part
  works and does not need rewriting.

### Phase 4 – widen

Move specs into `@smoke` as they prove stable. The rule that matters: **a test that flakes gets
fixed or quarantined the same day**, never left red. One tolerated flake and the gate is
decorative again – the same failure mode this repository just cleared out of its mypy and
bandit steps.

## Definition of done

- Smoke subset blocking on PRs, wall-clock under five minutes.
- Full suite scheduled, with a route for the result to reach a person.
- `if: false` gone from `ci.yml`, and the note in `CONTRIBUTING.md` updated to match.

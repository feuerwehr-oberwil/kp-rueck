# 15 – Make the E2E suite fast enough for CI

**Status:** phases 2 and 3 shipped; **phase 1 was skipped and still owes work**, phase 4 is
ongoing.

What exists now: eight `@smoke`-tagged specs run per pull request (`e2e-smoke` in `ci.yml`), and
the full suite runs nightly (`e2e-nightly.yml`, a failure opens an issue). The subset is **not**
in the required-checks list on main yet — see phase 1.

What is still open, and it is the part this plan opened with: **nobody has measured which specs
are actually slow and which are actually flaky.** The eight were chosen by reading them, not by
running them repeatedly, so "no known flake among them" is an assumption. Until it has been
tested, the job reports rather than blocks.

## Where things stand

`frontend/tests/e2e/` holds roughly **300 Playwright tests**. Eight of them carry a `@smoke`
tag and run per pull request; the rest run nightly.

The job was `if: false` until 2026-07-26 for an honest reason – ~25 minutes per run, and flaky
enough that a red result stopped meaning anything. The cost of that was total: CI covered no
click-through at all. Switching on a subset buys back the paths where a break is both plausible
and expensive without putting the flake in front of a merge.

Two things were found while wiring it up, both worth knowing:

- The old disabled job **never set `ADMIN_SEED_PASSWORD`**, so the seed minted a random
  development password and every spec would have failed at the login screen. It could not have
  been un-disabled as it stood.
- The `@smoke` set deliberately excludes `login.spec.ts`'s invalid-credentials test: the spec
  itself documents that repeated runs trip the per-username failure throttle, which surfaces
  identically to a wrong password. That is a guaranteed flake in a gate.

Worth knowing: **kp-front runs its full Playwright smoke as a blocking CI job.** The two
repositories are still not at parity here, so don't infer one repo's coverage from the other.

## Goal

A **blocking** smoke subset on every pull request, in **under five minutes**, plus the full
suite on a schedule. Not "the whole suite, faster" – that is a bigger job with a worse ratio.

## Plan

### Phase 1 – find out what is actually slow and what is actually flaky — **STILL OPEN**

This was meant to come first and did not. It is now the only thing between the smoke job and
being a required check, so it is the next piece of work, not an optional refinement.

- Run with `--reporter=json` and sort by duration. Expect a small number of specs to dominate.
- Run the suite ~5× against an unchanged tree and record which specs fail intermittently. A
  test that fails without a code change is not evidence about the code, and every one of them
  has to be either fixed or quarantined before any of this can block a merge.
- Common causes here, in likely order: waiting on a fixed timeout instead of a condition,
  tests sharing one database and racing, and the Socket.IO connection settling after assertions
  already ran.

### Phase 2 – tag a smoke subset — **DONE**

Pick the paths where a break is both plausible and expensive, and tag them
`@smoke` (`test.describe('…', { tag: '@smoke' })`):

- log in, land on the board, see an event
- create an incident and see it appear
- alarm intake: `POST /api/alarms` → incident visible on the board
- the print-agent claim cycle, if it can run without a printer
- one `/display/*` wall-display route renders

Target: **under 25 specs**, no known flake among them.

### Phase 3 – wire it up — **DONE**, except for the branch-protection switch

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

- [x] `if: false` gone from `ci.yml`, and the note in `CONTRIBUTING.md` updated to match.
- [x] Full suite scheduled, with a route for the result to reach a person (nightly → an issue).
- [x] Smoke subset runs on PRs.
- [ ] **Phase 1 done**: durations measured, ~5 repeat runs recorded, every intermittent spec in
      the subset fixed or untagged.
- [ ] Wall-clock for the subset measured and confirmed under five minutes.
- [ ] `E2E (@smoke)` added to the required checks on `main` — the last step, and only after the
      two above.

# VERIFICATION – what still has to be run against a real environment

**Status:** open checklist, written 2026-07-26. Delete this file once everything below is
ticked; it describes one batch of changes, not a standing process.

The work on the `claude/app-publishing-readiness-jjnmm9` branches was developed in an
environment with **no Docker, no PostgreSQL and no browser stack**. Everything that could be
checked without those was checked and is listed under [What was verified](#what-was-verified).
Everything that could not is here, in the order it is cheapest to find out something is wrong.

Two of the changes alter runtime behaviour operators depend on — WebSocket authentication and
audit-log retention — so each has an explicit rollback next to it. Neither needs a code change
to undo.

---

## 0. Before you start

```bash
git fetch origin
git checkout claude/app-publishing-readiness-jjnmm9   # in BOTH repos
```

Budget about **an hour** for §1–§4 and a separate evening for §5 (the full E2E suite) and §6
(the restore drill).

---

## 1. The gates that just need a machine (~15 min)

These are the ordinary CI gates. They failed nowhere here, but the Postgres-backed half never
ran at all.

```bash
# kp-rueck
cd backend && uv sync --dev
docker compose -f ../docker-compose.dev.yml up -d postgres
uv run pytest -q                      # the whole suite, ~700 tests
uv run pytest --cov=app --cov-fail-under=35 -q

cd ../frontend && pnpm install --frozen-lockfile
pnpm exec tsc --noEmit && pnpm lint && pnpm test
```

- [ ] Backend suite green, coverage floor met.
- [ ] Frontend typecheck, lint (0 errors) and 267 unit tests green.

**Pay attention to `tests/test_background/test_audit_cleanup.py`.** Its 13 tests are the ones
most likely to surprise you: retention now defaults to off, four of them were changed to opt
into pruning via a new `pruning_enabled` fixture, and four are new. They need Postgres, so
none of them has ever executed.

- [ ] `uv run pytest tests/test_background/test_audit_cleanup.py -v` — 13 passed.

## 2. The Node 24 image build (~15 min)

Both repos moved off Node 20 (end-of-life 2026-04-30). The **container build was never run** —
`pnpm build` and the unit tests passed on Node 22 here, which is good evidence and not proof.
Alpine and slim base images occasionally need a rebuilt native module.

```bash
# kp-rueck
docker build -t kp-rueck-frontend:node24-check ./frontend
# kp-front
docker build -t kp-front:node24-check .
```

- [ ] Both images build.
- [ ] kp-rueck: `docker compose up -d --wait` brings the stack up and `curl -fsS
      http://localhost:8080/` renders.

If a build fails on a native dependency, the fix is almost always a rebuild rather than a
revert; try Node 22 (`node:22-alpine` / `node:22-slim`) before going back to 20, which is not a
safe place to sit.

## 3. WebSocket authentication — the behaviour change to watch (~20 min)

`WS_REQUIRE_AUTH` now defaults to **on**. Previously anything that could reach `/socket.io`
could join the operations room and receive live incident broadcasts without logging in.

The evidence that this is safe is strong but indirect: the client sends `withCredentials`, the
`/display/*` pages gate on `isAuthenticated`, the public share-link board polls over HTTP
instead of using the socket, and even `POST /api/demo/sandbox` requires an authenticated user.
None of that was confirmed **against a running stack**.

Check each of these with the stack up, and watch the backend log for
`Rejected unauthenticated WebSocket connect`:

- [ ] Log in as an editor. Move a card; a second browser window sees it move **without a 5s
      delay**. (A delay means the socket was rejected and polling is carrying it — the board
      still works, which is exactly why this can hide.)
- [ ] Log in as the **viewer** account on the screen you actually project. Same test.
- [ ] Open `/display/board` and `/display/status` on that screen. Both live-update.
- [ ] Open a public share link (`/display/board?token=…`) in a private window. It still
      updates — this one is *expected* to poll, so confirm it is not broken rather than fast.
- [ ] Prove the control works: `curl -i 'http://localhost:8080/socket.io/?EIO=4&transport=polling'`
      with no cookie should not yield a usable session.
- [ ] If you run the demo instance, check a fresh visitor still gets a live board.

**Rollback**, no code change and no redeploy of a different image:

```bash
# .env
WS_REQUIRE_AUTH=false
docker compose up -d
```

Tell us if you need it — a client that legitimately cannot authenticate is a design gap worth
knowing about, not just your problem.

## 4. Audit retention (~5 min)

`AUDIT_RETENTION_DAYS` now defaults to `0` = keep everything. It was 90, and the sweep ran
silently.

- [ ] Decide your number. `0` (keep) is the default; set days if a policy says to prune.
- [ ] Restart and confirm the log line: `Audit retention disabled (AUDIT_RETENTION_DAYS=0) -
      keeping the full audit trail`, or the scheduler line naming your retention.
- [ ] Check what you have left. If you have been running 0.1.x, anything older than 90 days is
      already gone:
      ```sql
      SELECT min(timestamp), max(timestamp), count(*) FROM audit_log;
      ```
      Worth knowing before somebody asks you for it.

**Rollback:** `AUDIT_RETENTION_DAYS=90`.

> Table growth is the trade. One station's audit log is small, but it is now unbounded by
> default — if `SELECT pg_size_pretty(pg_total_relation_size('audit_log'));` ever looks wrong
> to you, set a number rather than assuming it will level off.

## 5. The E2E suite, and promoting the smoke gate (~1 evening)

CI now runs eight `@smoke`-tagged specs per pull request. **They have never been executed** —
they were chosen by reading the specs, not by running them, so "no known flake" is an
assumption. This is why the job is deliberately *not* in the required-checks list.

This is [`plans/15-e2e-in-ci.md`](plans/15-e2e-in-ci.md) phase 1, which was skipped:

```bash
just dev                    # stack up
cd frontend
pnpm exec playwright test --grep @smoke --reporter=list   # x5, same tree
pnpm test:e2e                                             # the full 301 specs
```

- [ ] Smoke subset green **five times running** on an unchanged tree.
- [ ] Wall clock under five minutes.
- [ ] Any spec that flaked is fixed or untagged the same day.
- [ ] Then, and only then: add **`E2E (@smoke)`** to the required checks on `main`.
- [ ] Full suite run once, so the nightly does not open its first issue on a pre-existing
      failure and teach everyone to ignore it.

Note the E2E CI job never set `ADMIN_SEED_PASSWORD` before, so it could not have passed as it
stood; that is fixed, but it means the job has no history of ever having been green.

- [ ] `pnpm screenshots` still works (it moved behind its own config, out of the test suite).

## 6. The release, and the drill (~1 evening)

`v0.2.0` is **prepared but not tagged** — deliberately, because pushing the tag publishes four
GHCR images and a GitHub Release.

- [ ] Read the `[0.2.0]` section of [`../CHANGELOG.md`](../CHANGELOG.md) as a station commander
      deciding whether to update tonight. Two entries carry an operator note (WebSocket auth,
      audit retention); make sure you agree with both.
- [ ] Everything in §1–§5 green.
- [ ] `just release-tag 0.2.0 && git push --follow-tags`
- [ ] Watch the release CI gate — the **Images** job is the first real test of the Node 24
      build in the published artefact.
- [ ] Do a restore drill into a fresh stack ([`SETUP.md`](SETUP.md) §6). The seed change means
      a restored production database now comes up with **no sample resources**, which is the
      point — but you should see it once rather than discover it during an incident.

## 7. Housekeeping only you can do

- [ ] Add `E2E (@smoke)` to branch protection (after §5).
- [ ] Confirm CodeQL runs — it is gated on the repository being public, so it is a silent no-op
      on a private fork.
- [ ] Check the first dependabot Docker PRs land and are sane.
- [ ] `docs/plans/` publishes the internal roadmap in a repo whose own docs index says internal
      working documents stay out. Not a bug; a decision nobody has made on purpose.

---

## What was verified

So you know where the line is. All of this was run and green:

| | kp-rueck | kp-front |
| --- | --- | --- |
| ruff format + check | ✅ 299 files | ✅ |
| mypy blocking subset | ✅ 32 files, 0 errors | n/a |
| bandit (pinned to 3.12) | ✅ 0 findings, 0 files skipped | n/a |
| gitleaks over the tracked tree | ✅ 0 leaks | ✅ (pre-existing job) |
| Frontend `tsc --noEmit` | ✅ | ✅ |
| ESLint | ✅ 0 errors | ✅ 0 errors |
| Frontend unit tests | ✅ 267 | ✅ 997 |
| Production frontend build | ✅ `next build` | ✅ `vite build` |
| DB-free pytest | ✅ 67 (websocket, seed, environment, scheduler) | ✅ 4 (openapi, version) |
| OpenAPI drift test | ✅ | ✅ |
| Playwright `--list` | ✅ 301 specs, 8 `@smoke` | n/a |

Not run anywhere: the Postgres-backed pytest suites, any Playwright execution, any Docker
build, and the compose stack smoke.

/**
 * Credentials the local dev stack seeds, in one place.
 *
 * These must match `docker-compose.dev.yml`, which passes them to the backend as
 * `ADMIN_SEED_PASSWORD` / `VIEWER_PASSWORD`. They existed as literals in three separate
 * spec files before, and the literal was `changeme123` — **eleven characters**, which
 * `get_admin_password()` in `backend/app/seed.py` rejects (it requires at least 12). So the
 * default could never have been the seeded password: without `ADMIN_SEED_PASSWORD` set the
 * seed mints a *random* one and prints it once, every login times out, and after a few
 * attempts the per-username throttle locks the account for 300 seconds. A whole suite run
 * then reports ~200 failures that mean nothing. `docs/plans/15-e2e-in-ci.md` records the same
 * trap being hit once before, in CI.
 *
 * CI overrides all of these via `TEST_USERNAME` / `TEST_PASSWORD` / `VIEWER_PASSWORD`
 * (see `.github/workflows/ci.yml`), so changing a default here does not touch the gate.
 */

/** Must stay >= 12 characters, or the backend seed refuses to start. */
export const DEV_ADMIN_USERNAME = process.env.TEST_USERNAME || 'admin'
export const DEV_ADMIN_PASSWORD = process.env.TEST_PASSWORD || 'kp-dev-password'

/** The seeded read-only account, for viewer-role specs. */
export const DEV_VIEWER_USERNAME = 'viewer'
export const DEV_VIEWER_PASSWORD = process.env.VIEWER_PASSWORD || 'viewer'

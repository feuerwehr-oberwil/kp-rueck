#!/usr/bin/env bash
# Screenshot regression tests: `just visual [playwright args …]` — docs/VISUAL_TESTS.md.
#
# Brings up a THROWAWAY stack, runs frontend/tests/visual against it, and takes it down again:
#   1. the production frontend build (`next build`, standalone server — no dev overlay, no
#      compile-on-demand);
#   2. an empty Postgres, migrated and filled by `python -m app.seed_visual` (the demo storm
#      evening pinned to one instant), never the dev database;
#   3. the backend on its own port, then `playwright test --config playwright.visual.config.ts`.
# CI runs exactly this script (the `visual` job in ci.yml and visual-baselines.yml).
#
# Extra arguments go to Playwright: `just visual --update-snapshots=all`, `just visual board`.
# A LOCAL run is a look, not a verdict: baselines are rendered on CI's Linux Chromium, and a
# laptop's fonts/GPU rasterise differently (docs/VISUAL_TESTS.md § Running it locally).
#
# Knobs: VISUAL_SKIP_BUILD=1 (reuse frontend/.next), VISUAL_DATABASE_URL (use this EMPTY
# database instead of a container — CI's service), VISUAL_API_PORT / VISUAL_WEB_PORT /
# VISUAL_PG_PORT. Chromium's system libraries missing (WSL without sudo)? Point
# LD_LIBRARY_PATH at them.
set -euo pipefail
cd "$(dirname "$0")/.."

api_port=${VISUAL_API_PORT:-8312}
web_port=${VISUAL_WEB_PORT:-3312}
pg_port=${VISUAL_PG_PORT:-55312}
pg=kp-rueck-visual-$$
log=$(mktemp -d)
api_pid=
web_pid=
# throwaway credentials for a database that dies with the run (the seed wants ≥ 12 characters)
password=visual-not-a-secret # gitleaks:allow

stop_group() {
  # each server runs in its own process group (setsid below): `uv run` does not pass a TERM on
  local pid=$1
  [ -n "$pid" ] || return 0
  kill -- -"$pid" 2>/dev/null || true
  while kill -0 -- -"$pid" 2>/dev/null; do sleep 0.2; done
}
cleanup() {
  stop_group "$web_pid"
  stop_group "$api_pid"
  [ -n "${VISUAL_DATABASE_URL:-}" ] || docker rm -f "$pg" >/dev/null 2>&1 || true
  rm -rf "$log"
}
trap cleanup EXIT

for port in "$api_port" "$web_port"; do
  if curl -s "localhost:${port}" >/dev/null 2>&1; then echo "port ${port} is already taken (set VISUAL_API_PORT / VISUAL_WEB_PORT)" >&2; exit 1; fi
done

# The browser talks to the backend directly (NEXT_PUBLIC_API_URL), the split-origin shape the
# E2E jobs use; the standalone server needs its static files beside it.
if [ "${VISUAL_SKIP_BUILD:-}" != 1 ]; then
  echo "building the frontend (production) …"
  (cd frontend && NEXT_PUBLIC_API_URL="http://localhost:${api_port}" pnpm build >"$log/build.log" 2>&1) || { tail -40 "$log/build.log" >&2; exit 1; }
fi
rm -rf frontend/.next/standalone/.next/static frontend/.next/standalone/public
cp -r frontend/.next/static frontend/.next/standalone/.next/
cp -r frontend/public frontend/.next/standalone/

if [ -n "${VISUAL_DATABASE_URL:-}" ]; then
  db_url=$VISUAL_DATABASE_URL
else
  db_url="postgresql+asyncpg://kprueck:kprueck@localhost:${pg_port}/kprueck"
  # -alpine, as docker-compose.yml runs in production — and it is not a detail: the image's
  # collation decides where «Ölsperre» sorts in a list the backend orders by name (after
  # «Wassersauger» here, between «Motorsäge» and «Tauchpumpe» on the Debian image).
  docker run -d --name "$pg" -e POSTGRES_USER=kprueck -e POSTGRES_PASSWORD=kprueck -e POSTGRES_DB=kprueck \
    -p "${pg_port}:5432" postgres:16-alpine >/dev/null
  until docker exec "$pg" pg_isready -U kprueck -q 2>/dev/null; do sleep 1; done
  sleep 1
fi
(cd backend && DATABASE_URL=$db_url uv run alembic upgrade head >"$log/migrate.log" 2>&1) || { tail -20 "$log/migrate.log" >&2; exit 1; }
(cd backend && DATABASE_URL=$db_url ADMIN_SEED_PASSWORD=$password VIEWER_PASSWORD=$password \
  uv run python -m app.seed_visual >"$log/seed.log" 2>&1) || { tail -20 "$log/seed.log" >&2; exit 1; }

(cd backend && DATABASE_URL=$db_url CORS_ORIGINS="http://localhost:${web_port}" \
  exec setsid uv run uvicorn app.main:app --port "$api_port" --log-level warning >"$log/api.log" 2>&1) &
api_pid=$!
(cd frontend/.next/standalone && PORT=$web_port HOSTNAME=127.0.0.1 API_URL="http://localhost:${api_port}" \
  exec setsid node server.js >"$log/web.log" 2>&1) &
web_pid=$!
for _ in $(seq 60); do curl -sf "localhost:${api_port}/health" >/dev/null && break; sleep 1; done
for _ in $(seq 60); do curl -sf -o /dev/null "localhost:${web_port}/login" && break; sleep 1; done

set +e
(cd frontend && E2E_BASE_URL="http://localhost:${web_port}" API_BASE_URL="http://localhost:${api_port}" \
  TEST_USERNAME=admin TEST_PASSWORD=$password \
  pnpm exec playwright test --config playwright.visual.config.ts "$@")
rc=$?
set -e
if [ "$rc" != 0 ]; then
  echo "✗ visual: playwright exit ${rc}; backend log tail:" >&2
  tail -20 "$log/api.log" >&2
fi
exit "$rc"

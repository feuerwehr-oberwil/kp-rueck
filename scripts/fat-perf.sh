#!/usr/bin/env bash
# Measure how a large / long Ereignis behaves: `just fat-perf [preset …]` (default: real large).
#
# Per preset, on a THROWAWAY stack (never the dev database): a fresh Postgres container, the
# backend on its own port, and the production frontend build (`next build`, standalone server,
# no dev mode). Then frontend/tests/perf/fat-event.perf.ts plays the Ereignis in, action by
# action, with every simulated board following over the socket, and opens it on a throttled
# Chromium. Everything is torn down afterwards. Presets: frontend/test-utils/fat-event.ts.
#
# Knobs: FAT_CPU (throttle, default 4), FAT_STEADY (seconds of real-peak load, default 60),
# FAT_SKIP_BUILD=1 (reuse frontend/.next), FAT_API_PORT / FAT_WEB_PORT / FAT_PG_PORT.
# Chromium's system libraries missing (WSL without sudo)? Point LD_LIBRARY_PATH at them.
set -euo pipefail
cd "$(dirname "$0")/.."

presets=("$@")
[ ${#presets[@]} -gt 0 ] || presets=(real large)
api_port=${FAT_API_PORT:-8311}
web_port=${FAT_WEB_PORT:-3311}
pg_port=${FAT_PG_PORT:-55311}
pg=kp-rueck-fat-perf-$$
log=$(mktemp -d)
api_pid=
web_pid=
# throwaway credentials for a database that dies with the run (the seed wants ≥ 12 characters)
password=fat-perf-not-a-secret # gitleaks:allow

stop_group() {
  # each server runs in its own process group (setsid below): `uv run` and `pnpm` do not pass a
  # TERM on, and a survivor would answer the next preset from the previous database
  local pid=$1
  [ -n "$pid" ] || return 0
  kill -- -"$pid" 2>/dev/null || true
  while kill -0 -- -"$pid" 2>/dev/null; do sleep 0.2; done
}
cleanup() {
  stop_group "$web_pid"; web_pid=
  stop_group "$api_pid"; api_pid=
  docker rm -f "$pg" >/dev/null 2>&1 || true
}
trap 'cleanup; rm -rf "$log"' EXIT

for port in "$api_port" "$web_port"; do
  if curl -s "localhost:${port}" >/dev/null 2>&1; then echo "port ${port} is already taken (set FAT_API_PORT / FAT_WEB_PORT)" >&2; exit 1; fi
done

# One production build serves every preset. The browser talks to the backend directly, the same
# split-origin shape the nightly E2E uses; the standalone server needs its static files beside it.
if [ "${FAT_SKIP_BUILD:-}" != 1 ]; then
  echo "building the frontend (production) …"
  (cd frontend && NEXT_PUBLIC_API_URL="http://localhost:${api_port}" pnpm build >"$log/build.log" 2>&1) || { tail -40 "$log/build.log" >&2; exit 1; }
  cp -r frontend/.next/static frontend/.next/standalone/.next/
  cp -r frontend/public frontend/.next/standalone/
fi

# a throwaway key per run: production mode refuses to start without a strong one
secret_key=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
status=0
db_url="postgresql+asyncpg://kprueck:kprueck@localhost:${pg_port}/kprueck"
for preset in "${presets[@]}"; do
  cleanup
  docker run -d --name "$pg" -e POSTGRES_USER=kprueck -e POSTGRES_PASSWORD=kprueck -e POSTGRES_DB=kprueck \
    -p "${pg_port}:5432" postgres:16-alpine >/dev/null
  until docker exec "$pg" pg_isready -U kprueck -q 2>/dev/null; do sleep 1; done
  sleep 1
  (cd backend && DATABASE_URL=$db_url uv run alembic upgrade head >"$log/migrate.log" 2>&1) || { tail -20 "$log/migrate.log" >&2; exit 1; }
  # the dev seed: admin login plus the fixture roster the generator tops up
  (cd backend && DATABASE_URL=$db_url ADMIN_SEED_PASSWORD=$password VIEWER_PASSWORD=$password \
    uv run python -m app.seed >"$log/seed.log" 2>&1) || { tail -20 "$log/seed.log" >&2; exit 1; }

  # production mode, as prod runs (start.sh: one uvicorn worker): it also silences the
  # per-packet Socket.IO logging, which would otherwise be a measurable share of the CPU here
  (cd backend && DATABASE_URL=$db_url CORS_ORIGINS="http://localhost:${web_port}" \
    ENVIRONMENT=production SECRET_KEY="$secret_key" AUTH_SECRET_KEY="$secret_key" \
    exec setsid uv run uvicorn app.main:app --port "$api_port" --log-level warning >"$log/api.log" 2>&1) &
  api_pid=$!
  (cd frontend/.next/standalone && PORT=$web_port HOSTNAME=127.0.0.1 API_URL="http://localhost:${api_port}" \
    exec setsid node server.js >"$log/web.log" 2>&1) &
  web_pid=$!
  until curl -sf "localhost:${api_port}/health" >/dev/null; do sleep 1; done
  until curl -sf -o /dev/null "localhost:${web_port}/login"; do sleep 1; done

  # a failed preset does not stop the others, but it does fail the recipe
  set +e
  (cd frontend && FAT_PRESET=$preset E2E_BASE_URL="http://localhost:${web_port}" API_BASE_URL="http://localhost:${api_port}" \
    TEST_USERNAME=admin TEST_PASSWORD=$password \
    pnpm exec playwright test --project=perf --reporter=line) | grep -v '^\s*$'
  rc=${PIPESTATUS[0]}
  set -e
  if [ "$rc" != 0 ]; then
    echo "✗ ${preset}: the measurement failed (playwright exit ${rc}); backend log tail:" >&2
    tail -20 "$log/api.log" >&2
    status=1
  fi
  printf 'database size          %s after the run\n\n' \
    "$(docker exec "$pg" psql -U kprueck -tAc "select pg_size_pretty(pg_database_size('kprueck'))")"
done
exit "$status"

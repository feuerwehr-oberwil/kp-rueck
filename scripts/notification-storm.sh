#!/usr/bin/env bash
# Open an Ereignis that holds hundreds of notifications: `just notification-storm [count]`
# (default 563, the owner's Test Einsatz on 16.11.2026).
#
# On a THROWAWAY stack (never the dev database), like scripts/fat-perf.sh: a fresh Postgres
# container, the backend on its own port, the production frontend build. Then
# frontend/tests/perf/notification-storm.perf.ts writes the notifications into that database and
# opens the board on a throttled Chromium. Torn down afterwards.
#
# Knobs: STORM_CPU (throttle, default 4), STORM_INCIDENTS (cards, default 120), STORM_KINDS
# (only these notification types, comma-separated), STORM_PROFILE (seconds of CPU profile),
# STORM_SKIP_BUILD=1 (reuse frontend/.next), STORM_API_PORT / STORM_WEB_PORT / STORM_PG_PORT.
set -euo pipefail
cd "$(dirname "$0")/.."

count=${1:-563}
api_port=${STORM_API_PORT:-8312}
web_port=${STORM_WEB_PORT:-3312}
pg_port=${STORM_PG_PORT:-55312}
pg=kp-rueck-notification-storm-$$
log=$(mktemp -d)
api_pid=
web_pid=
password=storm-perf-not-a-secret # gitleaks:allow

stop_group() {
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
  if curl -s "localhost:${port}" >/dev/null 2>&1; then echo "port ${port} is already taken" >&2; exit 1; fi
done

if [ "${STORM_SKIP_BUILD:-}" != 1 ]; then
  echo "building the frontend (production) …"
  (cd frontend && NEXT_PUBLIC_API_URL="http://localhost:${api_port}" pnpm build >"$log/build.log" 2>&1) || { tail -40 "$log/build.log" >&2; exit 1; }
  cp -r frontend/.next/static frontend/.next/standalone/.next/
  cp -r frontend/public frontend/.next/standalone/
fi

secret_key=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
db_url="postgresql+asyncpg://kprueck:kprueck@localhost:${pg_port}/kprueck"
docker run -d --name "$pg" -e POSTGRES_USER=kprueck -e POSTGRES_PASSWORD=kprueck -e POSTGRES_DB=kprueck \
  -p "${pg_port}:5432" postgres:16-alpine >/dev/null
until docker exec "$pg" pg_isready -U kprueck -q 2>/dev/null; do sleep 1; done
sleep 1
(cd backend && DATABASE_URL=$db_url uv run alembic upgrade head >"$log/migrate.log" 2>&1) || { tail -20 "$log/migrate.log" >&2; exit 1; }
(cd backend && DEMO_MODE=false DATABASE_URL=$db_url ADMIN_SEED_PASSWORD=$password VIEWER_PASSWORD=$password \
  uv run python -m app.seed >"$log/seed.log" 2>&1) || { tail -20 "$log/seed.log" >&2; exit 1; }

(cd backend && DEMO_MODE=false DATABASE_URL=$db_url CORS_ORIGINS="http://localhost:${web_port}" \
  ENVIRONMENT=production SECRET_KEY="$secret_key" AUTH_SECRET_KEY="$secret_key" \
  exec setsid uv run uvicorn app.main:app --port "$api_port" --log-level warning >"$log/api.log" 2>&1) &
api_pid=$!
(cd frontend/.next/standalone && PORT=$web_port HOSTNAME=127.0.0.1 API_URL="http://localhost:${api_port}" \
  exec setsid node server.js >"$log/web.log" 2>&1) &
web_pid=$!
until curl -sf "localhost:${api_port}/health" >/dev/null; do sleep 1; done
until curl -sf -o /dev/null "localhost:${web_port}/login"; do sleep 1; done

(cd frontend && STORM_NOTIFICATIONS=$count STORM_PG_CONTAINER=$pg \
  E2E_BASE_URL="http://localhost:${web_port}" API_BASE_URL="http://localhost:${api_port}" \
  TEST_USERNAME=admin TEST_PASSWORD=$password \
  pnpm exec playwright test tests/perf/notification-storm.perf.ts --project=perf --reporter=line) | grep -v '^\s*$' \
  || { echo "✗ the measurement failed; backend log tail:" >&2; tail -20 "$log/api.log" >&2; exit 1; }

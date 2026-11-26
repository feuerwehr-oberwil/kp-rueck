#!/usr/bin/env bash
# One E2E spec against a THROWAWAY stack: `just smoke [spec file | grep] [playwright args …]`.
#
# The fast loop for one browser test. It brings up its own stack on its own ports, runs
# Playwright once, keeps a trace of a failure and takes the stack down again:
#   1. an empty Postgres container (never the dev database), migrated and seeded the way the
#      CI job «E2E (@smoke)» does it (`alembic upgrade head`, `python -m app.seeds` with the
#      CI password, no ENVIRONMENT=production – the specs need the dev fixture board);
#   2. the backend and `pnpm dev` on their own ports, split-origin like CI
#      (NEXT_PUBLIC_API_URL → the backend);
#   3. `playwright test` with CI's two retries and `--trace retain-on-failure`. A cold dev
#      server can still miss a spec's first wait; a retry that passes reports the spec «flaky».
#
# Which tests:
#   just smoke                                   # the CI set: --grep @smoke, minus @quarantine
#   just smoke tests/e2e/01-auth/login.spec.ts   # one spec file (path from frontend/ or the repo)
#   just smoke "intake-flagged alarm"            # anything else is a --grep
# Extra arguments go to Playwright after the first: `just smoke tests/e2e/01-auth --headed`.
#
# Every process runs with a CLEAN environment (`env -i`, only PATH/HOME/LD_LIBRARY_PATH kept)
# and the Python ones from an empty working directory, so neither an exported DATABASE_URL nor
# backend/.env (DEMO_MODE, provider tokens, a remote database) reaches this stack.
#
# On a failure or a flaky pass the run keeps frontend/test-results/smoke/ (traces: `pnpm exec
# playwright show-trace <file>`) plus the backend, frontend, migration and seed logs, and prints
# the path. A clean pass removes it.
# Knobs: SMOKE_API_PORT / SMOKE_WEB_PORT / SMOKE_PG_PORT. Run it in a worktree that is not
# also running `pnpm dev` on the host: both would write frontend/.next.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD

api_port=${SMOKE_API_PORT:-8412}
web_port=${SMOKE_WEB_PORT:-3412}
pg_port=${SMOKE_PG_PORT:-55412}
pg=kp-rueck-smoke-$$
pg_id=
db_url="postgresql+asyncpg://kprueck:kprueck@127.0.0.1:${pg_port}/kprueck"  # the loopback port Docker publishes
# CI's E2E_PASSWORD (ci.yml): a throwaway login for a database that dies with the run
password=e2e-ci-password-not-a-secret # gitleaks:allow
# e2e-nightly.yml's print agent token: the print-outcome spec claims jobs as the agent
print_token=e2e-print-agent-token-not-a-secret # gitleaks:allow
out=$root/frontend/test-results/smoke
work=$(mktemp -d)
api_pid=
web_pid=

clean_env=(env -i "PATH=$PATH" "HOME=$HOME")
[ -n "${LD_LIBRARY_PATH:-}" ] && clean_env+=("LD_LIBRARY_PATH=$LD_LIBRARY_PATH")
# The backend's Python, from an empty working directory (no .env there) – see the header.
py=("${clean_env[@]}" "DATABASE_URL=$db_url" "PYTHONPATH=$root/backend" uv run --project "$root/backend")

stop_group() {
  # each server runs in its own process group (setsid below): `uv run` does not pass a TERM on
  local pid=$1
  [ -n "$pid" ] || return 0
  kill -- -"$pid" 2>/dev/null || true
  for _ in $(seq 50); do kill -0 -- -"$pid" 2>/dev/null || return 0; sleep 0.2; done
  kill -KILL -- -"$pid" 2>/dev/null || true
}
cleanup() {
  stop_group "$web_pid"
  stop_group "$api_pid"
  # Only the container this run created, with its anonymous data volume.
  [ -z "$pg_id" ] || docker rm -fv "$pg_id" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT TERM  # so an interrupted run still takes its stack down

for port in "$api_port" "$web_port" "$pg_port"; do
  if (echo >"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    echo "port ${port} is already taken (set SMOKE_API_PORT / SMOKE_WEB_PORT / SMOKE_PG_PORT)" >&2
    exit 1
  fi
done

# Which tests: no argument (or only Playwright options) = the CI set; a path = that spec;
# anything else = a grep.
select=(--grep @smoke --grep-invert @quarantine)
if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
  target=$1
  shift
  if [ -e "frontend/$target" ]; then select=("$target")
  elif [ -e "$target" ]; then select=("${target#frontend/}")
  else select=(--grep "$target")
  fi
fi

rm -rf "$out"
mkdir -p "$out"
logs=$out/logs
mkdir -p "$logs"

echo "→ Postgres on :${pg_port} (container ${pg})"
# The image CI's E2E (@smoke) service runs: the image's collation decides sort order.
# Created first, started second: cleanup knows the ID even if the start fails. Loopback only –
# the credentials are fixed.
pg_id=$(docker create --name "$pg" -e POSTGRES_USER=kprueck -e POSTGRES_PASSWORD=kprueck -e POSTGRES_DB=kprueck \
  -p "127.0.0.1:${pg_port}:5432" mirror.gcr.io/library/postgres:16)
docker start "$pg_id" >/dev/null
# Over TCP: during initdb the image runs a temporary server on the Unix socket only.
for _ in $(seq 60); do docker exec "$pg_id" pg_isready -h 127.0.0.1 -U kprueck -q 2>/dev/null && break; sleep 1; done
docker exec "$pg_id" pg_isready -h 127.0.0.1 -U kprueck -q || { echo "✗ Postgres did not start" >&2; docker logs --tail 20 "$pg_id" >&2; exit 1; }

echo "→ migrate + seed"
(cd "$work" && "${py[@]}" alembic -c "$root/backend/alembic.ini" upgrade head >"$logs/migrate.log" 2>&1) \
  || { tail -20 "$logs/migrate.log" >&2; exit 1; }
(cd "$work" && "${py[@]}" env "ADMIN_SEED_PASSWORD=$password" "VIEWER_PASSWORD=$password" \
  python -m app.seeds >"$logs/seed.log" 2>&1) || { tail -20 "$logs/seed.log" >&2; exit 1; }

echo "→ backend on :${api_port}, frontend (pnpm dev) on :${web_port}"
(cd "$work" && exec setsid "${py[@]}" env "CORS_ORIGINS=http://localhost:${web_port}" \
  "PRINT_AGENT_TOKEN=$print_token" uvicorn app.main:app --port "$api_port" --log-level warning >"$logs/api.log" 2>&1) &
api_pid=$!
(cd frontend && exec setsid "${clean_env[@]}" "NEXT_PUBLIC_API_URL=http://localhost:${api_port}" \
  "API_URL=http://localhost:${api_port}" pnpm dev --hostname 127.0.0.1 --port "$web_port" >"$logs/web.log" 2>&1) &
web_pid=$!
# Every probe has its own timeout, so a server that accepts and never answers cannot hang the run.
for _ in $(seq 60); do curl -sf --max-time 5 "localhost:${api_port}/health" >/dev/null && break; sleep 1; done
curl -sf --max-time 5 "localhost:${api_port}/health" >/dev/null || { echo "✗ backend did not answer" >&2; tail -20 "$logs/api.log" >&2; exit 1; }
# The first request compiles the page in dev mode – give it time.
for _ in $(seq 60); do curl -sf --max-time 30 -o /dev/null "localhost:${web_port}/login" && break; sleep 1; done
curl -sf --max-time 30 -o /dev/null "localhost:${web_port}/login" || { echo "✗ frontend did not answer" >&2; tail -20 "$logs/web.log" >&2; exit 1; }
# Compile the main routes before the clock starts: a cold `/` takes ~20 s in dev mode, longer
# than a spec's 10 s wait for the board after login (CI hides that with two retries).
echo "→ compiling the main routes"
for route in /build-info / /events /map /settings /feld; do
  curl -s -o /dev/null --max-time 180 "localhost:${web_port}${route}" || true
done

echo "→ playwright ${select[*]} $*"
set +e
(cd frontend && "${clean_env[@]}" \
  "E2E_BASE_URL=http://localhost:${web_port}" "API_BASE_URL=http://localhost:${api_port}" \
  "NEXT_PUBLIC_API_URL=http://localhost:${api_port}" \
  TEST_USERNAME=admin "TEST_PASSWORD=$password" "VIEWER_PASSWORD=$password" \
  "PRINT_AGENT_TOKEN=$print_token" pnpm exec playwright test --project chromium --retries 2 --trace retain-on-failure --output "$out/results" \
  --reporter list "${select[@]}" "$@")
rc=$?
set -e
traces=$(find "$out/results" -name trace.zip 2>/dev/null || true)
if [ "$rc" = 0 ] && [ -z "$traces" ]; then
  rm -rf "$out"
  echo "✓ smoke: passed"
elif [ "$rc" = 0 ]; then
  echo "~ smoke: passed after a retry (flaky). Traces of the failed attempts kept in ${out}" >&2
  echo "$traces" | sed 's|^|   pnpm exec playwright show-trace |' >&2
else
  echo "✗ smoke: playwright exit ${rc}. Traces and logs kept in ${out}" >&2
  echo "$traces" | sed 's|^|   pnpm exec playwright show-trace |' >&2
  tail -20 "$logs/api.log" >&2
fi
exit "$rc"

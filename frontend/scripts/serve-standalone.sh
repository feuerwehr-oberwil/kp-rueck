#!/usr/bin/env bash
# Serve the production bundle that ci.yml's frontend-build job packs (next-standalone.tgz), for
# the browser jobs that run against it: unpack it, put the static files beside the server,
# start `node server.js` in the background and wait until it answers.
# Run from frontend/: `bash scripts/serve-standalone.sh <port> <api-url>`. The log is next-server.log.
set -euo pipefail
port=$1
api=$2
tar -xzf next-standalone.tgz
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/
(cd .next/standalone && PORT=$port HOSTNAME=127.0.0.1 API_URL=$api nohup node server.js >../../next-server.log 2>&1 &)
for _ in $(seq 60); do
  curl -sf -o /dev/null "localhost:${port}/login" && exit 0
  sleep 1
done
echo "the frontend did not answer on :${port}" >&2
tail -40 next-server.log >&2
exit 1

#!/usr/bin/env bash
set -euo pipefail

PIDFILE="/tmp/watcher.pid"
LOCKFILE="/tmp/watcher.lock"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

exec 9>"$LOCKFILE"
if ! flock -n 9; then
  echo "Already running (lock held). Exiting."
  exit 1
fi

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Already running (pid $(cat "$PIDFILE")). Exiting."
  exit 1
fi

echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

cd "$ROOT_DIR"
bun run build
while true; do
  bun --env-file=.env bin/server.ts
  echo "[$(date '+%T')] Server exited (code $?), restarting in 2s…"
  sleep 2
done

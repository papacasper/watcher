#!/usr/bin/env bash
set -euo pipefail

bun run build:binary
tmp_home="$(mktemp -d)"
port="$((45000 + RANDOM % 10000))"
pid=""
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  rm -rf "$tmp_home"
}
trap cleanup EXIT

HOME="$tmp_home" HOST=127.0.0.1 PORT="$port" ./dist/watcher >/tmp/watcher-smoke.log 2>&1 &
pid="$!"
for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:$port/api/setup" | grep -q '"configured":false'; then
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    cat /tmp/watcher-smoke.log
    exit 1
  fi
  sleep 0.25
done
cat /tmp/watcher-smoke.log
exit 1

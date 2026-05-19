#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Load defaults from .env.local if present (never committed — add to .gitignore)
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$ROOT_DIR/.env.local"; set +a
fi

REMOTE="${WATCHER_REMOTE:-}"
REMOTE_DIR="${WATCHER_REMOTE_DIR:-}"
SSH_OPTS=(-F /dev/null)
RSYNC_EXCLUDES=(
  --exclude ".env"
  --exclude ".claude/"
  --exclude ".codex"
  --exclude ".venv/"
  --exclude "node_modules/"
  --exclude "dist/"
)

log() {
  printf '[%(%H:%M:%S)T] %s\n' -1 "$*"
}

require_deploy_target() {
  if [[ -z "$REMOTE" || -z "$REMOTE_DIR" ]]; then
    cat >&2 <<'EOF'
Set WATCHER_REMOTE and WATCHER_REMOTE_DIR before syncing.

Example:
  WATCHER_REMOTE=user@100.x.y.z WATCHER_REMOTE_DIR=/home/user/dev/watcher bin/sync-remote.sh --once
EOF
    exit 1
  fi
}

sync_once() {
  rsync -az --delete \
    -e "ssh -F /dev/null" \
    "${RSYNC_EXCLUDES[@]}" \
    "$ROOT_DIR/" "$REMOTE:$REMOTE_DIR/"
}

remote_build() {
  ssh "${SSH_OPTS[@]}" "$REMOTE" \
    "cd '$REMOTE_DIR' && export PATH=\"\$HOME/.bun/bin:\$PATH\" && bun run build"
}

remote_restart() {
  ssh "${SSH_OPTS[@]}" "$REMOTE" "systemctl --user restart watcher"
}

changed_paths_require_restart() {
  local changed="$1"
  grep -Eq '(^|/)(bin|src|package\.json|bun\.lock|tsconfig\.json)(/|$)' <<<"$changed"
}

run_update() {
  local changed="${1:-}"
  log "Syncing to $REMOTE:$REMOTE_DIR"
  sync_once
  log "Building remote frontend bundle"
  remote_build
  if [[ -z "$changed" ]] || changed_paths_require_restart "$changed"; then
    log "Restarting remote watcher"
    remote_restart || true
  fi
  log "Remote watcher is up to date"
}

if [[ "${1:-}" == "--once" ]]; then
  require_deploy_target
  run_update
  exit 0
fi

require_deploy_target

command -v inotifywait >/dev/null || {
  echo "inotifywait is required for watch mode" >&2
  exit 1
}

run_update
log "Watching $ROOT_DIR for changes"

while true; do
  changed="$(
    inotifywait -r -q -e close_write,create,delete,move \
      --exclude '(^|/)(\.env|\.claude|\.codex|\.venv|node_modules|dist)(/|$)' \
      --format '%w%f' "$ROOT_DIR" |
    sed "s#^$ROOT_DIR/##"
  )"

  sleep 0.5
  while extra="$(
    timeout 1 inotifywait -r -q -e close_write,create,delete,move \
      --exclude '(^|/)(\.env|\.claude|\.codex|\.venv|node_modules|dist)(/|$)' \
      --format '%w%f' "$ROOT_DIR" 2>/dev/null |
    sed "s#^$ROOT_DIR/##"
  )"; do
    [[ -n "$extra" ]] && changed+=$'\n'"$extra"
  done

  run_update "$changed"
done

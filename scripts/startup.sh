#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${AGENT_OFFICE_DATA_DIR:-$HOME/.agent-office}"
PROJECTS_DIR="${AGENT_OFFICE_PROJECTS_DIR:-${PROJECTS_DIR:-$HOME/Projects}}"
PORT="${AGENT_OFFICE_PORT:-3333}"
UI_DIST_INDEX="$ROOT_DIR/ui/dist/index.html"
CONFIG_PATH="$DATA_DIR/config.json"

log() {
  printf '[startup] %s\n' "$*"
}

fail() {
  printf '[startup] %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

needs_ui_build() {
  if [[ ! -f "$UI_DIST_INDEX" ]]; then
    return 0
  fi

  if find "$ROOT_DIR/ui/src" "$ROOT_DIR/ui/public" "$ROOT_DIR/ui/index.html" "$ROOT_DIR/ui/package.json" -type f -newer "$UI_DIST_INDEX" | read -r _; then
    return 0
  fi

  return 1
}

require_command node
require_command npm

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  fail "Dependencies are missing. Run 'npm install' in $ROOT_DIR first."
fi

if [[ ! -d "$ROOT_DIR/ui/node_modules" ]]; then
  fail "UI dependencies are missing. Run 'npm install' in $ROOT_DIR/ui first."
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  log "Initializing data directory at $DATA_DIR"
  node "$ROOT_DIR/bin/agent-office.js" init --data-dir "$DATA_DIR" --projects-dir "$PROJECTS_DIR"
fi

if needs_ui_build; then
  log "Building UI bundle"
  npm run build:ui --prefix "$ROOT_DIR"
fi

log "Starting agent-office on http://127.0.0.1:$PORT"
exec node "$ROOT_DIR/bin/agent-office.js" start --data-dir "$DATA_DIR" --port "$PORT" "$@"

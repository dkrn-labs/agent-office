#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${AGENT_OFFICE_DATA_DIR:-$HOME/.agent-office}"
PROJECTS_DIR="${AGENT_OFFICE_PROJECTS_DIR:-${PROJECTS_DIR:-$HOME/Projects}}"
BACKEND_PORT="${AGENT_OFFICE_BACKEND_PORT:-3334}"
FRONTEND_PORT="${AGENT_OFFICE_FRONTEND_PORT:-5173}"
CONFIG_PATH="$DATA_DIR/config.json"

backend_pid=""
frontend_pid=""

log() {
  printf '[dev-start] %s\n' "$*"
}

fail() {
  printf '[dev-start] %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

cleanup() {
  local exit_code=$?

  if [[ -n "$frontend_pid" ]] && kill -0 "$frontend_pid" >/dev/null 2>&1; then
    kill "$frontend_pid" >/dev/null 2>&1 || true
  fi

  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" >/dev/null 2>&1; then
    kill "$backend_pid" >/dev/null 2>&1 || true
  fi

  wait >/dev/null 2>&1 || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

wait_for_child() {
  while true; do
    if [[ -n "$backend_pid" ]] && ! kill -0 "$backend_pid" >/dev/null 2>&1; then
      wait "$backend_pid"
      return $?
    fi

    if [[ -n "$frontend_pid" ]] && ! kill -0 "$frontend_pid" >/dev/null 2>&1; then
      wait "$frontend_pid"
      return $?
    fi

    sleep 1
  done
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

log "Starting backend on http://127.0.0.1:$BACKEND_PORT"
node "$ROOT_DIR/bin/agent-office.js" start --data-dir "$DATA_DIR" --port "$BACKEND_PORT" "$@" &
backend_pid=$!

log "Starting frontend on http://127.0.0.1:$FRONTEND_PORT"
(
  cd "$ROOT_DIR/ui"
  AGENT_OFFICE_BACKEND_PORT="$BACKEND_PORT" npm run dev -- --host 127.0.0.1 --port "$FRONTEND_PORT"
) &
frontend_pid=$!

log "Dev environment ready"
log "Frontend: http://127.0.0.1:$FRONTEND_PORT"
log "Backend:  http://127.0.0.1:$BACKEND_PORT"

wait_for_child

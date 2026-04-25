#!/usr/bin/env bash
# seed-synth.sh — create synthetic projects + seeded history for the P0 test matrix.
#
# Creates ~/Projects/_synth/synth_{frontend,backend,debug,review,devops}, each
# with: a small file tree matching its persona's domain regex, a 3+ commit git
# history with classify-able commit messages, and 3 pre-loaded history
# observations of the expected type so persona-filtering has signal.
#
# Idempotent: re-runs are no-ops unless --reset is passed.
#
# Usage:
#   scripts/seed-synth.sh            # create-if-missing
#   scripts/seed-synth.sh --reset    # wipe and recreate

set -euo pipefail

RESET=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    -h|--help)
      sed -n '2,15p' "$0"; exit 0 ;;
  esac
done

ROOT="${HOME}/Projects/_synth"
DB="${HOME}/.agent-office/agent-office.db"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
NOW_EPOCH="$(date -u +%s)"

if [ "$RESET" = "1" ]; then
  echo "[seed-synth] --reset: removing $ROOT and synth_* DB rows"
  rm -rf "$ROOT"
  if [ -f "$DB" ]; then
    sqlite3 "$DB" "DELETE FROM history_observation WHERE project_id IN (SELECT project_id FROM project WHERE name LIKE 'synth_%');"
    sqlite3 "$DB" "DELETE FROM history_summary WHERE history_session_id IN (SELECT history_session_id FROM history_session WHERE project_id IN (SELECT project_id FROM project WHERE name LIKE 'synth_%'));" 2>/dev/null || true
    sqlite3 "$DB" "DELETE FROM history_session WHERE project_id IN (SELECT project_id FROM project WHERE name LIKE 'synth_%');"
    sqlite3 "$DB" "DELETE FROM project WHERE name LIKE 'synth_%';"
  fi
fi

mkdir -p "$ROOT"

# ─── helpers ────────────────────────────────────────────────────────────────

git_commit() {
  # $1 = msg
  git -c user.email='synth@agent-office.local' -c user.name='synth' \
      commit --quiet --no-gpg-sign --allow-empty-message -m "$1" || true
}

mkproject() {
  local name="$1"
  local dir="$ROOT/$name"
  if [ -d "$dir/.git" ]; then
    echo "[seed-synth] $name: already exists (skip)"
    return 1   # already exists
  fi
  mkdir -p "$dir"
  git -C "$dir" init --quiet -b main
  return 0
}

db_insert_project() {
  # echoes the project_id
  local path="$1" name="$2" stack="$3"
  local pid
  pid=$(sqlite3 "$DB" "SELECT project_id FROM project WHERE path = '$path';" 2>/dev/null || true)
  if [ -n "$pid" ]; then echo "$pid"; return; fi
  sqlite3 "$DB" "INSERT INTO project (path, name, tech_stack, active) VALUES ('$path', '$name', '$stack', 1);"
  sqlite3 "$DB" "SELECT project_id FROM project WHERE path = '$path';"
}

db_insert_session() {
  # echoes the history_session_id; args: project_id, providerId, startedIso
  local proj_id="$1" provider="$2" started="$3"
  sqlite3 "$DB" "INSERT INTO history_session (project_id, provider_id, started_at, ended_at, status, source, created_at, updated_at) VALUES ($proj_id, '$provider', '$started', '$started', 'completed', 'synth-seed', '$NOW_ISO', '$NOW_ISO');"
  sqlite3 "$DB" "SELECT last_insert_rowid();"
}

db_insert_obs() {
  # args: session_id, project_id, providerId, type, title, files_modified_json
  local sid="$1" pid="$2" provider="$3" type="$4" title="$5" filesmod="$6"
  sqlite3 "$DB" "INSERT INTO history_observation
    (history_session_id, project_id, provider_id, type, title, files_read, files_modified, created_at, created_at_epoch, relevance_count, confidence)
   VALUES
    ($sid, $pid, '$provider', '$type', '$title', '[]', '$filesmod', '$NOW_ISO', $NOW_EPOCH, 1, 1.0);"
}

# ─── synth_frontend ─────────────────────────────────────────────────────────

if mkproject "synth_frontend"; then
  cd "$ROOT/synth_frontend"
  cat > package.json <<'JSON'
{ "name": "synth_frontend", "version": "0.0.1", "type": "module", "dependencies": { "react": "^19.0.0" } }
JSON
  mkdir -p ui
  cat > ui/App.jsx <<'JSX'
export default function App() { return <h1>synth</h1>; }
JSX
  cat > ui/styles.css <<'CSS'
body { margin: 0; font-family: ui-monospace; }
CSS
  git add -A; git_commit "feat: initial frontend scaffold"
  echo "/* tweak */" >> ui/styles.css
  git add -A; git_commit "fix: padding regression on h1"
  cat > ui/Header.jsx <<'JSX'
export function Header({ title }) { return <header><h1>{title}</h1></header>; }
JSX
  git add -A; git_commit "refactor: extract Header from App"

  PID=$(db_insert_project "$ROOT/synth_frontend" "synth_frontend" '["react"]')
  for i in 1 2 3; do
    SID=$(db_insert_session "$PID" "claude-code" "$NOW_ISO")
    case "$i" in
      1) db_insert_obs "$SID" "$PID" "claude-code" "feature" "Add Header component" '["ui/Header.jsx"]' ;;
      2) db_insert_obs "$SID" "$PID" "claude-code" "bugfix"  "Fix h1 padding regression" '["ui/styles.css"]' ;;
      3) db_insert_obs "$SID" "$PID" "claude-code" "refactor" "Extract Header from App" '["ui/App.jsx","ui/Header.jsx"]' ;;
    esac
  done
  echo "[seed-synth] synth_frontend: project=$PID, +3 observations"
fi

# ─── synth_backend ──────────────────────────────────────────────────────────

if mkproject "synth_backend"; then
  cd "$ROOT/synth_backend"
  cat > package.json <<'JSON'
{ "name": "synth_backend", "version": "0.0.1", "type": "module", "dependencies": { "fastify": "^5.0.0" } }
JSON
  mkdir -p src/api src/db
  cat > src/api/server.js <<'JS'
import Fastify from 'fastify';
const app = Fastify();
app.get('/api/notes', async () => ({ notes: [] }));
app.listen({ port: 3000 });
JS
  cat > src/db/schema.sql <<'SQL'
CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
SQL
  git add -A; git_commit "feat: scaffold notes API"
  cat > src/api/share.js <<'JS'
export function makeShareToken(len = 16) {
  return Math.random().toString(36).slice(2, 2 + len);
}
JS
  git add -A; git_commit "feat: add share token helper"
  echo "-- index" >> src/db/schema.sql
  git add -A; git_commit "refactor: tighten schema with index hint"

  PID=$(db_insert_project "$ROOT/synth_backend" "synth_backend" '["fastify","sqlite"]')
  for i in 1 2 3; do
    SID=$(db_insert_session "$PID" "claude-code" "$NOW_ISO")
    case "$i" in
      1) db_insert_obs "$SID" "$PID" "claude-code" "feature"  "Notes API scaffold" '["src/api/server.js","src/db/schema.sql"]' ;;
      2) db_insert_obs "$SID" "$PID" "claude-code" "feature"  "Share token helper" '["src/api/share.js"]' ;;
      3) db_insert_obs "$SID" "$PID" "claude-code" "refactor" "Schema index hint" '["src/db/schema.sql"]' ;;
    esac
  done
  echo "[seed-synth] synth_backend: project=$PID, +3 observations"
fi

# ─── synth_debug ────────────────────────────────────────────────────────────

if mkproject "synth_debug"; then
  cd "$ROOT/synth_debug"
  mkdir -p src test
  cat > package.json <<'JSON'
{ "name": "synth_debug", "version": "0.0.1", "type": "module" }
JSON
  cat > src/handler.js <<'JS'
export function handle(message) {
  // BUG: returns undefined on empty input — fix in upcoming commit
  if (!message) return undefined;
  return message.toUpperCase();
}
JS
  cat > test/repro.test.js <<'JS'
import { handle } from '../src/handler.js';
import test from 'node:test';
import assert from 'node:assert/strict';
test('returns string for empty input', () => {
  assert.equal(typeof handle(''), 'string');
});
JS
  cat > BUG.md <<'MD'
# BUG: handle() returns undefined on empty input
Repro: handle('') → undefined. Expected '' (empty string).
MD
  git add -A; git_commit "feat: handler scaffold"
  git add -A; git_commit "fix: handle returns '' for empty input not undefined"
  cat > src/handler.js <<'JS'
export function handle(message) {
  if (typeof message !== 'string') return '';
  return message.toUpperCase();
}
JS
  git add -A; git_commit "fix: tighten input type guard for handle"

  PID=$(db_insert_project "$ROOT/synth_debug" "synth_debug" '["node"]')
  for i in 1 2 3; do
    SID=$(db_insert_session "$PID" "claude-code" "$NOW_ISO")
    case "$i" in
      1) db_insert_obs "$SID" "$PID" "claude-code" "bugfix" "Empty-input regression in handle()" '["src/handler.js","test/repro.test.js"]' ;;
      2) db_insert_obs "$SID" "$PID" "claude-code" "bugfix" "Tighten type guard"          '["src/handler.js"]' ;;
      3) db_insert_obs "$SID" "$PID" "claude-code" "discovery" "Handler returns undefined on empty"   '["src/handler.js"]' ;;
    esac
  done
  echo "[seed-synth] synth_debug: project=$PID, +3 observations"
fi

# ─── synth_review ───────────────────────────────────────────────────────────

if mkproject "synth_review"; then
  cd "$ROOT/synth_review"
  mkdir -p src
  cat > package.json <<'JSON'
{ "name": "synth_review", "version": "0.0.1", "type": "module" }
JSON
  cat > src/old.js <<'JS'
export function processOrder(o) {
  if (!o) return null;
  if (!o.id) return null;
  if (!o.items) return null;
  return { id: o.id, total: o.items.reduce((a, b) => a + b.price, 0) };
}
JS
  git add -A; git_commit "feat: order processor scaffold"
  cat > src/refactored.js <<'JS'
const isValid = (o) => o && o.id && Array.isArray(o.items);
const total = (items) => items.reduce((a, b) => a + b.price, 0);
export const processOrder = (o) => (isValid(o) ? { id: o.id, total: total(o.items) } : null);
JS
  cat > REFACTOR.md <<'MD'
# Order processor refactor
Decided to extract `isValid` and `total` helpers. Smaller, easier to test.
MD
  git add -A; git_commit "refactor: extract isValid and total helpers from processOrder"
  rm -f src/old.js
  git add -A; git_commit "chore: remove old processOrder implementation"

  PID=$(db_insert_project "$ROOT/synth_review" "synth_review" '["node"]')
  for i in 1 2 3; do
    SID=$(db_insert_session "$PID" "claude-code" "$NOW_ISO")
    case "$i" in
      1) db_insert_obs "$SID" "$PID" "claude-code" "refactor" "Extract isValid + total helpers" '["src/refactored.js","src/old.js"]' ;;
      2) db_insert_obs "$SID" "$PID" "claude-code" "decision" "Chose helper extraction over inline guards" '[]' ;;
      3) db_insert_obs "$SID" "$PID" "claude-code" "refactor" "Remove old impl" '["src/old.js"]' ;;
    esac
  done
  echo "[seed-synth] synth_review: project=$PID, +3 observations"
fi

# ─── synth_devops ───────────────────────────────────────────────────────────

if mkproject "synth_devops"; then
  cd "$ROOT/synth_devops"
  mkdir -p .github/workflows deploy
  cat > Dockerfile <<'DOCKER'
FROM node:22-alpine
WORKDIR /app
COPY . .
CMD ["node", "server.js"]
DOCKER
  cat > .github/workflows/ci.yml <<'YML'
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "tests would run here"
YML
  cat > deploy/script.sh <<'SH'
#!/usr/bin/env bash
docker build -t synth/devops .
SH
  chmod +x deploy/script.sh
  cat > package.json <<'JSON'
{ "name": "synth_devops", "version": "0.0.1" }
JSON
  git add -A; git_commit "feat: docker + ci scaffold"
  cat >> .github/workflows/ci.yml <<'YML'
      - run: npm test
YML
  git add -A; git_commit "feat: wire npm test into ci"
  cat > deploy/script.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
docker build -t synth/devops .
docker push synth/devops:latest
SH
  git add -A; git_commit "refactor: harden deploy script with set -euo pipefail"

  PID=$(db_insert_project "$ROOT/synth_devops" "synth_devops" '["docker","ci"]')
  for i in 1 2 3; do
    SID=$(db_insert_session "$PID" "claude-code" "$NOW_ISO")
    case "$i" in
      1) db_insert_obs "$SID" "$PID" "claude-code" "feature"  "Docker + CI scaffold" '["Dockerfile",".github/workflows/ci.yml","deploy/script.sh"]' ;;
      2) db_insert_obs "$SID" "$PID" "claude-code" "feature"  "npm test in CI"      '[".github/workflows/ci.yml"]' ;;
      3) db_insert_obs "$SID" "$PID" "claude-code" "refactor" "Harden deploy script" '["deploy/script.sh"]' ;;
    esac
  done
  echo "[seed-synth] synth_devops: project=$PID, +3 observations"
fi

echo
echo "[seed-synth] done. summary:"
sqlite3 "$DB" "SELECT name, COUNT(o.history_observation_id) AS observations FROM project p LEFT JOIN history_observation o ON o.project_id = p.project_id WHERE p.name LIKE 'synth_%' GROUP BY p.project_id;"

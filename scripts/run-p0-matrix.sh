#!/usr/bin/env bash
# run-p0-matrix.sh — execute P0 test matrix: 3 providers × 5 synth projects.
#
# Captures a baseline session id, runs each (provider, project) cell with a
# non-interactive prompt, then verifies F1-F4 queries against the new rows.

set -euo pipefail

DB="${HOME}/.agent-office/agent-office.db"
ROOT="${HOME}/Projects/_synth"
LOG="${HOME}/.agent-office/logs/p0-matrix.log"
mkdir -p "$(dirname "$LOG")"

BASELINE_ID=$(sqlite3 "$DB" "SELECT COALESCE(MAX(history_session_id), 0) FROM history_session;")
START_ISO=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
echo "[matrix] start: baseline_id=$BASELINE_ID start_iso=$START_ISO"
echo "$START_ISO matrix-start baseline=$BASELINE_ID" >> "$LOG"

declare -a CELLS=(
  "claude:frontend:Read ui/App.jsx and tell me in one sentence what component it exports."
  "claude:backend:Read src/api/server.js and tell me in one sentence what HTTP route is defined."
  "claude:debug:Read test/repro.test.js and tell me in one sentence what bug the test checks for."
  "claude:review:Read src/refactored.js and tell me in one sentence what helpers it defines."
  "claude:devops:Read .github/workflows/ci.yml and tell me in one sentence what events trigger the workflow."
  "codex:frontend:Read ui/App.jsx and answer in one sentence what component it exports."
  "codex:backend:Read src/api/server.js and answer in one sentence what HTTP route is defined."
  "codex:debug:Read test/repro.test.js and answer in one sentence what bug it checks for."
  "codex:review:Read src/refactored.js and answer in one sentence what helpers are defined."
  "codex:devops:Read .github/workflows/ci.yml and answer in one sentence what events trigger it."
  "gemini:frontend:Read ui/App.jsx and answer in one sentence what component it exports."
  "gemini:backend:Read src/api/server.js and answer in one sentence what HTTP route is defined."
  "gemini:debug:Read test/repro.test.js and answer in one sentence what bug it checks for."
  "gemini:review:Read src/refactored.js and answer in one sentence what helpers are defined."
  "gemini:devops:Read .github/workflows/ci.yml and answer in one sentence what events trigger it."
)

run_cell() {
  local provider="$1" domain="$2" prompt="$3"
  local proj="$ROOT/synth_$domain"
  local started rc out_lines
  echo
  echo "[matrix] $provider × synth_$domain"
  if [ ! -d "$proj" ]; then echo "  SKIP (project missing)"; return; fi
  cd "$proj"
  started=$(date -u +%s)
  case "$provider" in
    claude)
      out_lines=$(claude -p "$prompt" --output-format text 2>&1 | tail -3 || true)
      rc=$?
      ;;
    codex)
      out_lines=$(codex exec "$prompt" 2>&1 | tail -3 || true)
      rc=$?
      ;;
    gemini)
      out_lines=$(gemini -p "$prompt" --output-format text 2>&1 | tail -3 || true)
      rc=$?
      ;;
    *)
      echo "  unknown provider: $provider"; return ;;
  esac
  local dur=$(( $(date -u +%s) - started ))
  # Give the hook a moment to fire (provider-history-hook is async-ish)
  sleep 2
  echo "  (${dur}s, rc=$rc) — output tail: $(echo "$out_lines" | tr '\n' ' ' | cut -c1-160)"
  echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) cell $provider $domain rc=$rc dur=${dur}s" >> "$LOG"
}

for spec in "${CELLS[@]}"; do
  IFS=':' read -r provider domain prompt <<< "$spec"
  run_cell "$provider" "$domain" "$prompt" || true
done

echo
echo "[matrix] all cells dispatched. waiting 5s for any in-flight hook posts…"
sleep 5

# ─── F1-F4 verification ─────────────────────────────────────────────────────

echo
echo "=== F1 · per-provider session counts (created since matrix start) ==="
sqlite3 -column -header "$DB" "
  SELECT provider_id, COUNT(*) AS sessions
    FROM history_session
   WHERE history_session_id > $BASELINE_ID
     AND created_at >= '$START_ISO'
   GROUP BY provider_id;"

echo
echo "=== F2 · null-rates on critical fields ==="
sqlite3 -column -header "$DB" "
  SELECT provider_id,
         SUM(CASE WHEN model       IS NULL THEN 1 ELSE 0 END) AS null_model,
         SUM(CASE WHEN started_at  IS NULL THEN 1 ELSE 0 END) AS null_started,
         SUM(CASE WHEN ended_at    IS NULL THEN 1 ELSE 0 END) AS null_ended,
         COUNT(*) AS total
    FROM history_session
   WHERE history_session_id > $BASELINE_ID
     AND created_at >= '$START_ISO'
   GROUP BY provider_id;"

echo
echo "=== F3 · observations per session (avg) ==="
sqlite3 -column -header "$DB" "
  SELECT s.provider_id, AVG(c) AS avg_obs, MIN(c) AS min_obs, MAX(c) AS max_obs
    FROM (SELECT s.provider_id, s.history_session_id, COUNT(o.history_observation_id) AS c
            FROM history_session s
            LEFT JOIN history_observation o ON o.history_session_id = s.history_session_id
           WHERE s.history_session_id > $BASELINE_ID
             AND s.created_at >= '$START_ISO'
           GROUP BY s.history_session_id) s
   GROUP BY s.provider_id;"

echo
echo "=== F4 · orphan rows (status != 'completed') ==="
sqlite3 -column -header "$DB" "
  SELECT provider_id, COUNT(*) AS orphans
    FROM history_session
   WHERE history_session_id > $BASELINE_ID
     AND created_at >= '$START_ISO'
     AND status != 'completed'
   GROUP BY provider_id;"

echo
echo "=== bonus · type distribution from new observations ==="
sqlite3 -column -header "$DB" "
  SELECT type, COUNT(*) AS n
    FROM history_observation
   WHERE history_session_id IN (
     SELECT history_session_id FROM history_session
      WHERE history_session_id > $BASELINE_ID AND created_at >= '$START_ISO')
   GROUP BY type
   ORDER BY n DESC;"

echo
echo "[matrix] log: $LOG"

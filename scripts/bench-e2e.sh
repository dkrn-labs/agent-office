#!/usr/bin/env bash
# End-to-end benchmark: same task, three context variants, real Claude Code.
#
# Prereqs:
#   1. `claude` CLI on your PATH and logged in.
#   2. Contexts exported:  node scripts/export-bench-contexts.mjs lens
#   3. Task prompt written:  echo "<your task>" > bench/e2e/task.md
#
# Usage:  bash scripts/bench-e2e.sh
#
# Runs three one-shot sessions (`claude -p`) — no context, raw memory, brief —
# and prints input/output token counts + wall-time per variant so you can
# eyeball whether the brief matches raw-memory quality at a fraction of the cost.

set -euo pipefail

cd "$(dirname "$0")/.."

TASK_FILE="bench/e2e/task.md"
RAW_FILE="bench/e2e/raw.md"
BRIEF_FILE="bench/e2e/brief.md"
OUT_DIR="bench/e2e/runs"

command -v claude >/dev/null || { echo "claude CLI not found on PATH"; exit 1; }
[ -f "$TASK_FILE" ]  || { echo "Missing $TASK_FILE — write your task prompt there"; exit 1; }
[ -f "$RAW_FILE" ]   || { echo "Missing $RAW_FILE — run scripts/export-bench-contexts.mjs first"; exit 1; }
[ -f "$BRIEF_FILE" ] || { echo "Missing $BRIEF_FILE — run scripts/export-bench-contexts.mjs first"; exit 1; }

mkdir -p "$OUT_DIR"
TASK=$(cat "$TASK_FILE")

run_variant() {
  local name="$1"
  local context_file="$2"
  local out="$OUT_DIR/$name.json"

  local prompt
  if [ -z "$context_file" ]; then
    prompt="$TASK"
  else
    prompt="$(cat "$context_file")

# Task
$TASK"
  fi

  echo "─── $name ───"
  local start=$(date +%s)
  # --output-format json gives a single JSON object with `usage` + `result`.
  printf '%s' "$prompt" | claude -p --output-format json > "$out" 2>/dev/null || true
  local end=$(date +%s)
  local elapsed=$((end - start))

  # Extract token usage + a short preview of the answer.
  if [ -s "$out" ]; then
    python3 - "$out" "$elapsed" <<'PY'
import json, sys
path, elapsed = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
# With --output-format json, data is either a dict (result) or a list (stream).
if isinstance(data, list):
    data = next((e for e in data if e.get('type') == 'result'), data[-1] if data else {})
usage = data.get('usage') or {}
inp = usage.get('input_tokens', 0)
out = usage.get('output_tokens', 0)
cache_r = usage.get('cache_read_input_tokens', 0)
cache_w = usage.get('cache_creation_input_tokens', 0)
cost = data.get('total_cost_usd', 0)
turns = data.get('num_turns', '?')
answer = data.get('result') or ''
preview = ' '.join((answer or '').strip().splitlines()[:3])[:220]
print(f"  input:    {inp}   output: {out}   turns: {turns}")
print(f"  cache:    read={cache_r}  write={cache_w}")
print(f"  cost:     ${cost:.4f}   elapsed: {elapsed}s")
print(f"  preview:  {preview}…")
PY
  else
    echo "  (no output — claude CLI may have errored; check $out)"
  fi
  echo
}

run_variant "no-context"  ""
run_variant "raw-memory"  "$RAW_FILE"
run_variant "brief"       "$BRIEF_FILE"

echo "Raw JSON per run in: $OUT_DIR/"

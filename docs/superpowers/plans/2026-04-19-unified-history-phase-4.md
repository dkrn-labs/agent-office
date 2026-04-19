# Unified History — Phase 4: `history_session_metrics`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Give `history_session` a canonical home for telemetry (tokens,
cost, commits, diff, outcome) via a sibling `history_session_metrics` table
keyed 1:1 on `history_session_id`. Backfill from legacy `session`. Mirror
every telemetry watcher event into the new table going forward. Update the
list/detail endpoints to read telemetry from the metrics table primarily.

**Architecture:** New table + migration (006). Legacy `session` writes keep
happening — Phase 5 removes them. Telemetry watcher handlers in `server.js`
resolve `(providerId, providerSessionId) → history_session_id` and
upsert metrics alongside the existing `repo.updateSession(...)` call. The
`listHistorySessionsPage` join swaps from `session` → `history_session_metrics`.

**Tech Stack:** Node 20 ESM, `better-sqlite3`, `node:test`.

**Note on Codex:** Codex CLI now emits token/cost metrics at session close
(enabled in the user's CLI config). Treat Codex symmetrically with Claude/
Gemini — no special-casing.

**Out of scope:** Phase 5 (`session` deprecation); Codex-specific UI copy
updates ("trustworthy total-token telemetry only" note).

---

## Task 1: Migration 006 — create + backfill

**Files:**
- Create: `src/db/migrations/006-history-session-metrics.js`

- [ ] Create table:

```sql
CREATE TABLE IF NOT EXISTS history_session_metrics (
  history_session_id  INTEGER PRIMARY KEY REFERENCES history_session(history_session_id) ON DELETE CASCADE,
  tokens_in           INTEGER NOT NULL DEFAULT 0,
  tokens_out          INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read   INTEGER NOT NULL DEFAULT 0,
  tokens_cache_write  INTEGER NOT NULL DEFAULT 0,
  cost_usd            REAL,
  commits_produced    INTEGER NOT NULL DEFAULT 0,
  diff_exists         INTEGER,
  outcome             TEXT,
  error               TEXT,
  last_model          TEXT,
  recorded_at         TEXT NOT NULL
);
```

- [ ] Backfill: `INSERT INTO history_session_metrics SELECT ... FROM session s
      JOIN history_session hs ON hs.provider_id = s.provider_id AND
      hs.provider_session_id = s.provider_session_id AND hs.provider_session_id IS NOT NULL`.

## Task 2: Repo methods

- [ ] `upsertHistorySessionMetrics(historySessionId, fields)` — INSERT ON CONFLICT UPDATE with `COALESCE` guards so partial payloads don't clobber prior values.
- [ ] `getHistorySessionMetrics(historySessionId)`.
- [ ] `findHistorySessionIdByProvider(providerId, providerSessionId)` — helper for the watcher path (we already have `getHistorySessionByProvider`; just return the id).

## Task 3: Wire telemetry watcher in `server.js`

- [ ] After each `repo.updateSession(...)` call in the three watcher handlers
      (`session:update`, `session:expired`, and the existing idle/ended paths), resolve the history_session id and mirror the telemetry.
- [ ] If no matching `history_session` exists, log and skip (the hook will
      upsert shortly — Phase 1 guarantee).

## Task 4: List/detail endpoints use metrics table

- [ ] `listHistorySessionsPage`: replace the LEFT JOIN on `session` with a
      LEFT JOIN on `history_session_metrics hsm ON hsm.history_session_id = hs.history_session_id`. Drop the provider-key join.
- [ ] `getHistorySessionWithContext`: same swap.
- [ ] Row mapper reads `hsm.*` instead of `s.*`.

## Task 5: Tests

- [ ] `test/db/history-session-metrics.test.js` — upsert, partial-upsert preserves fields, cascade delete.
- [ ] `test/db/migration-006-backfill.test.js` — insert paired session/history_session rows pre-migration, run migration, assert metrics populated.
- [ ] Extend `test/api/history-sessions.test.js` to assert telemetry surfaces via the metrics table.

## Task 6: Roadmap update

- [ ] Mark Phase 4 ✅ in `unified-history-roadmap.md`.

# Unified History — Phase 5a: Shim stats onto `history_session*`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Switch the telemetry aggregator and portfolio-stats readers from
the legacy `session` table to `history_session` + `history_session_metrics`,
without breaking the legacy write path. The `session` table stays intact as
a compatibility shim (launcher still writes; watcher still updates). This is
the non-destructive half of Phase 5 — verifiable in the UI before anything
is dropped.

**Architecture:** Add history-session-backed variants of the four stat
queries (`countHistorySessionsSince`, `sumHistoryTokensSince`,
`sumHistoryCommitsSince`, `getHistoryPulseBucketsSince`) and swap the
callers. Shapes are preserved so dashboard tiles render identically.

**Out of scope:** Phase 5b — stopping launcher writes to `session`, rerouting
watcher events, retiring `/api/sessions*`, dropping the table and
`createSession` / `updateSession` / `listSessionsPage` / `getSessionDetail` /
`listActiveSessions` methods.

---

## Task 1: Repo stat methods

**Files:** `src/db/repository.js`

- [ ] `countHistorySessionsSince(iso)` → count `history_session` rows with
      `started_at >= ?`.
- [ ] `sumHistoryTokensSince(iso)` → sum of `tokens_in+tokens_out+cache_read+cache_write`
      from `history_session_metrics` JOIN `history_session` on
      `hs.started_at >= ?`.
- [ ] `sumHistoryCommitsSince(iso)` → sum of `commits_produced` from
      `history_session_metrics` JOIN `history_session` on `hs.ended_at >= ?`.
- [ ] `getHistoryPulseBucketsSince(iso)` → hour-bucketed token sum using
      `COALESCE(hs.ended_at, hs.started_at)` as the timestamp.

## Task 2: Swap callers

**Files:**
- `src/telemetry/session-aggregator.js`
- `src/stats/portfolio-stats.js`

- [ ] Aggregator's `getTodayStats` and `getPulseBuckets` call the
      `history*` variants.
- [ ] Portfolio stats' `sessionCount` / `tokenTotal` call the `history*`
      variants.

## Task 3: Tests

**Files:** `test/db/history-stats.test.js` (new)

- [ ] Create a fixture with `history_session_metrics` populated; assert each
      stat method returns the expected sum/count.
- [ ] Sanity: ensure the method returns `0` (not `null`) for empty ranges.

## Task 4: Roadmap

- [ ] Mark Phase 5a ✅ and add a Phase 5b row in the roadmap.

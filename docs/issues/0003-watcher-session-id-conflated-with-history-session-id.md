# Issue #0003 — Watcher's `sessionId` is conflated with `history_session.id` in `mirrorMetrics`

**Status:** Fixed (this commit)
**Opened:** 2026-04-26
**Severity:** Medium (silent in single-session test setups, breaks the moment a fresh DB has divergent legacy/history sequences)
**Area:** `src/api/server.js`, `src/agents/launcher.js`, `src/telemetry/jsonl-watcher.js`

## Summary

`mirrorMetrics` in `src/api/server.js` calls
`repo.upsertHistorySessionMetrics(targetId, fields)` where `targetId`
defaults to `payload.sessionId` from the watcher snapshot. But
`payload.sessionId` is the **legacy `session.id`** the launcher passes
to `watcher.registerLaunch({ sessionId })` — *not* a
`history_session.id`. The two tables have independent
auto-increment sequences, so they only happen to align when both have
exactly one row each at launch time. As soon as the sequences diverge
(any unattended-only history row, any pre-existing legacy session,
etc.), `upsertHistorySessionMetrics` violates the FK on
`history_session_metrics.history_session_id` and throws
`SQLITE_CONSTRAINT_FOREIGNKEY`.

## How it surfaced

`test/api/sessions.test.js`, `test/integration/telemetry-flow.test.js`
created a legacy session, called `registerLaunch`, then called
`ingestUsage` — which fired `session:update` and ran `mirrorMetrics`
against a `history_session.id` that didn't exist. FK error in the
`before` hook cancelled every test in the file.

## Fix

1. `watcher.registerLaunch({ sessionId, historySessionId, ... })` now
   accepts an optional `historySessionId` and stores it on the live
   session record.
2. The watcher snapshot exposes `historySessionId` on every entry.
3. `mirrorMetrics` prefers `payload.historySessionId` over
   `payload.sessionId` for the FK target. Falls back to the
   provider-session lookup (existing path) when neither is present.
4. The launcher passes both ids to `registerLaunch` so production gets
   correct mirroring.
5. Tests pass `historySessionId` explicitly when they call
   `registerLaunch` directly.

## Open follow-ups (not blocking close)

- The two-table model (`session` + `history_session`) is a known P1→P5
  transitional shape. Long-term we collapse to `history_session` only
  (implementation-plan.md §P5). When that lands, this whole class of
  bug goes away — but until then, every code path that crosses the two
  tables needs the explicit id-disambiguation this fix introduces.

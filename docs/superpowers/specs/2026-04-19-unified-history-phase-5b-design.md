# Unified History — Phase 5b: Retire the legacy `session` table (design)

**Status:** Approved 2026-04-19. Ships as two PRs.

**Context:** Phase 5a (commit `deee0bc`) swapped aggregator + portfolio-stats readers onto `history_session` + `history_session_metrics`. The legacy `session` table is now a write-only shim. Phase 5b removes it — no backwards compatibility, no archive table.

---

## PR1 — Stop writes, delete reads (non-destructive)

The `session` table remains on disk, but nothing in the codebase reads or writes it.

### Changes

1. **Launcher** (`src/agents/launcher.js:273-280`)
   Remove `repo.createSession(...)` and the follow-up `repo.updateSession(id, { lastModel })`. The Phase 2 `historyStore.createLaunch(...)` call already carries persona, project, source, and system prompt.

2. **Server watcher-event handlers** (`src/api/server.js:180, 257`)
   Remove both `repo.updateSession(payload.sessionId, {...})` calls. Telemetry already lands on `history_session_metrics` via Phase 4's mirror.

3. **API routes**
   Delete `src/api/routes/sessions.js` entirely and unregister it in `src/api/server.js`.

4. **UI callers**
   Delete legacy `/api/sessions*` usage in `ui/src/stores/office-store.js`, `ui/src/lib/ws-client.js`, `ui/src/lib/session-status.js`. History UI already consumes `/api/history/sessions` from Phase 3. No compatibility shim.

5. **Repo methods** (`src/db/repository.js`)
   Delete prepared statements at lines 444-513 and the exported methods `createSession`, `updateSession`, `listSessionsPage`, `getSessionDetail`, `listActiveSessions` (lines 572-651 + exports at 1543-1548).

6. **Tests — delete or rewrite**
   - `test/api/sessions.test.js` — delete.
   - `test/db/repository.test.js:375-410` — delete the `createSession`/`updateSession` blocks.
   - `test/db/database.test.js:160-190` — delete legacy-session assertions.
   - `test/db/history-session-metrics.test.js:105-120` — delete the legacy-session setup block (keep history_session-only coverage).
   - `test/telemetry/session-aggregator.test.js` — rewrite to seed `history_session` + `history_session_metrics` instead of `session`.
   - `test/api/portfolio.test.js:70-76` + `test/stats/portfolio-stats.test.js:49-55` — rewrite fixtures to use history tables.

### Exit criteria

- `grep -r "repo\.createSession\|listSessionsPage\|/api/sessions" src ui` returns zero matches.
- Full `npm test` suite green.
- Manual verification: launch a session in each provider (Claude launcher, Claude native terminal, Gemini, Codex). Each produces a `history_session` row with correct `persona_id`, `source`, and mirrored metrics. Nothing writes to `session`.

---

## PR2 — Drop the table

1. **New migration `007-drop-session.js`** — `DROP TABLE IF EXISTS session;` Drop any session-only indexes along with it. Historical migrations 001 and 002 stay intact (already applied in prod DBs).

2. **Tests**
   - Remove any remaining `CREATE TABLE session` or `INSERT INTO session` from `test/db/database.test.js` and any fixture file.
   - Add a migration test asserting the `session` table is absent after migrations run on a fresh DB.

### Exit criteria

- `sqlite3 <db> "SELECT name FROM sqlite_master WHERE type='table' AND name='session'"` returns empty.
- Migrations run cleanly on a fresh DB and on a prod-shape DB (session table → dropped).
- Full suite green.
- Roadmap (`docs/superpowers/plans/unified-history-roadmap.md`) Phase 5b row flipped to ✅.

---

## Cross-phase invariants preserved

- All session-history write paths go through `historyStore` (Phase 2 contract).
- `history_session.source` write-once; `persona_id` launcher-authoritative.
- Dashboards/aggregator read exclusively from `history_session*` (Phase 5a contract).

## Non-goals

- No archive/export of the legacy `session` rows — they are redundant with `history_session` + `history_session_metrics`, and the user has accepted irreversible drop.
- No deprecation shim or backwards-compat window.

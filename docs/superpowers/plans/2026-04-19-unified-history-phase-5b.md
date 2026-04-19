# Unified History — Phase 5b: Retire the legacy `session` table

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy `session` table and all code that reads/writes it, leaving `history_session` + `history_session_metrics` as the single source of truth.

**Architecture:** Two PRs. **PR1** is non-destructive: introduce `historyStore.getDetail()` as a drop-in for `repo.getSessionDetail`, port every caller (launcher, `server.js` event handlers, `mirrorMetrics`), delete the four legacy repo methods + their prepared statements, delete `src/api/routes/sessions.js`, delete UI callers, update tests. Table remains untouched. **PR2** adds migration `007-drop-session.js` that executes `DROP TABLE session;` and removes any remaining fixture code that creates it.

**Tech Stack:** Node.js, better-sqlite3, Express, node:test runner, Vite/React UI.

**Spec:** `docs/superpowers/specs/2026-04-19-unified-history-phase-5b-design.md`

---

## PR1 — Stop writes & delete readers

### Task 1: Add `historyStore.getDetail()`

**Files:**
- Modify: `src/history/project-history.js`
- Test: `test/history/get-detail.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `test/history/get-detail.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../helpers/test-context.js';

test('historyStore.getDetail returns enriched shape matching legacy getSessionDetail', (t) => {
  const ctx = createTestContext();
  t.after(() => ctx.cleanup());
  const { repo, projectHistory } = ctx;

  const projectId = repo.upsertProject({ name: 'demo', path: '/tmp/demo' });
  const personaId = repo.upsertPersona({ label: 'engineer', domain: 'code' });
  const startedAt = new Date().toISOString();

  const { historySessionId } = projectHistory.createLaunch({
    projectId,
    personaId,
    providerId: 'claude-code',
    startedAt,
    model: 'claude-opus-4-7',
    systemPrompt: 'sp',
  });

  repo.upsertHistorySessionMetrics(historySessionId, {
    tokensIn: 10,
    tokensOut: 20,
    tokensCacheRead: 5,
    tokensCacheWrite: 2,
    costUsd: 0.05,
    lastModel: 'claude-opus-4-7',
  });

  const detail = projectHistory.getDetail(historySessionId);

  assert.equal(detail.sessionId, historySessionId);
  assert.equal(detail.providerId, 'claude-code');
  assert.equal(detail.projectId, projectId);
  assert.equal(detail.personaId, personaId);
  assert.equal(detail.projectName, 'demo');
  assert.equal(detail.projectPath, '/tmp/demo');
  assert.equal(detail.personaLabel, 'engineer');
  assert.equal(detail.personaDomain, 'code');
  assert.equal(detail.startedAt, startedAt);
  assert.equal(detail.tokensIn, 10);
  assert.equal(detail.tokensOut, 20);
  assert.equal(detail.tokensCacheRead, 5);
  assert.equal(detail.tokensCacheWrite, 2);
  assert.equal(detail.totalTokens, 37);
  assert.equal(detail.costUsd, 0.05);
  assert.equal(detail.lastModel, 'claude-opus-4-7');
});

test('historyStore.getDetail returns null for unknown id', (t) => {
  const ctx = createTestContext();
  t.after(() => ctx.cleanup());
  assert.equal(ctx.projectHistory.getDetail(99999), null);
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm test -- --test-name-pattern="getDetail"`
Expected: FAIL — `projectHistory.getDetail is not a function`.

- [ ] **Step 3: Add a repo helper `getHistorySessionDetail(id)`**

Add to `src/db/repository.js` (near the other history_session statements). Prepared statement:

```js
getHistorySessionDetail: db.prepare(`
  SELECT
    hs.history_session_id AS sessionId,
    hs.project_id         AS projectId,
    hs.persona_id         AS personaId,
    hs.provider_id        AS providerId,
    hs.provider_session_id AS providerSessionId,
    hs.started_at         AS startedAt,
    hs.ended_at           AS endedAt,
    hs.status             AS status,
    hs.source             AS source,
    hs.system_prompt      AS systemPrompt,
    hs.last_model         AS lastModel,
    p.name                AS projectName,
    p.path                AS projectPath,
    pe.label              AS personaLabel,
    pe.domain             AS personaDomain,
    COALESCE(m.tokens_in, 0)          AS tokensIn,
    COALESCE(m.tokens_out, 0)         AS tokensOut,
    COALESCE(m.tokens_cache_read, 0)  AS tokensCacheRead,
    COALESCE(m.tokens_cache_write, 0) AS tokensCacheWrite,
    (COALESCE(m.tokens_in,0)+COALESCE(m.tokens_out,0)+COALESCE(m.tokens_cache_read,0)+COALESCE(m.tokens_cache_write,0)) AS totalTokens,
    m.cost_usd            AS costUsd,
    m.commits_produced    AS commitsProduced,
    m.diff_exists         AS diffExists,
    m.outcome             AS outcome,
    m.error               AS error
  FROM history_session hs
  LEFT JOIN project p ON p.project_id = hs.project_id
  LEFT JOIN persona pe ON pe.persona_id = hs.persona_id
  LEFT JOIN history_session_metrics m ON m.history_session_id = hs.history_session_id
  WHERE hs.history_session_id = ?
`),
```

Export a method:

```js
function getHistorySessionDetail(id) {
  return stmts.getHistorySessionDetail.get(id) ?? null;
}
```

and add `getHistorySessionDetail,` to the returned object.

- [ ] **Step 4: Wire `getDetail` into `projectHistory`**

In `src/history/project-history.js`, inside `createProjectHistoryStore`, add before the return:

```js
function getDetail(historySessionId) {
  if (historySessionId == null) return null;
  return repo.getHistorySessionDetail(Number(historySessionId));
}
```

Add `getDetail,` to the returned object.

- [ ] **Step 5: Run tests**

Run: `npm test -- --test-name-pattern="getDetail"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/repository.js src/history/project-history.js test/history/get-detail.test.js
git commit -m "feat(history): add historyStore.getDetail for unified session lookup"
```

---

### Task 2: Rewrite `mirrorMetrics` helper

**Files:**
- Modify: `src/api/server.js:152-170`

Post-Phase 5, tracker `sessionId` equals `history_session_id` for both launcher and unattended paths — the legacy-session fallback is dead weight.

- [ ] **Step 1: Replace the helper**

Replace the current `mirrorMetrics` (search for `const mirrorMetrics = (providerId, providerSessionId, legacySessionId, fields) =>`) with:

```js
const mirrorMetrics = (providerId, providerSessionId, historySessionId, fields) => {
  let targetId = historySessionId ?? null;
  if (!targetId) {
    targetId = repo.findHistorySessionIdByProvider(providerId, providerSessionId);
  }
  if (!targetId) return;
  repo.upsertHistorySessionMetrics(targetId, fields);
};
```

- [ ] **Step 2: Run full suite**

Run: `npm test`
Expected: any failures are downstream callers (next tasks) — mirrorMetrics-only tests, if any, must pass. Note failures; don't fix yet.

- [ ] **Step 3: Commit (after Task 3 — do not commit yet)**

Defer commit until event handlers are rewritten (Task 3).

---

### Task 3: Rewrite watcher event handlers

**Files:**
- Modify: `src/api/server.js:180-300` (the three `watcher?.on(...)` handlers)

- [ ] **Step 1: Rewrite `session:update`**

Replace the entire `watcher?.on('session:update', ...)` block with:

```js
watcher?.on('session:update', (payload) => {
  const costUsd = computeCostUsd({
    model: payload.lastModel,
    tokensIn: payload.totals.tokensIn,
    tokensOut: payload.totals.tokensOut,
    cacheRead: payload.totals.cacheRead,
    cacheWrite: payload.totals.cacheWrite,
  });

  const detail = projectHistory.getDetail(payload.sessionId);
  mirrorMetrics(detail?.providerId ?? payload.providerId ?? null, payload.providerSessionId, payload.sessionId, {
    tokensIn: payload.totals.tokensIn,
    tokensOut: payload.totals.tokensOut,
    tokensCacheRead: payload.totals.cacheRead,
    tokensCacheWrite: payload.totals.cacheWrite,
    costUsd,
    lastModel: payload.lastModel,
  });

  bus.emit(SESSION_UPDATE, {
    sessionId: payload.sessionId,
    providerSessionId: payload.providerSessionId,
    providerId: detail?.providerId ?? null,
    personaId: payload.personaId ?? detail?.personaId ?? null,
    projectId: payload.projectId ?? detail?.projectId ?? null,
    startedAt: detail?.startedAt ?? null,
    lastActivity: payload.lastActivity,
    lastModel: payload.lastModel,
    projectName: detail?.projectName ?? null,
    projectPath: detail?.projectPath ?? payload.projectPath ?? null,
    personaLabel: detail?.personaLabel ?? null,
    personaDomain: detail?.personaDomain ?? null,
    totals: {
      tokensIn: payload.totals.tokensIn,
      tokensOut: payload.totals.tokensOut,
      cacheRead: payload.totals.cacheRead,
      cacheWrite: payload.totals.cacheWrite,
      total: payload.totals.total,
      costUsd,
    },
  });
});
```

- [ ] **Step 2: Rewrite `session:idle`**

Replace with:

```js
watcher?.on('session:idle', async (payload) => {
  const detail = projectHistory.getDetail(payload.sessionId);
  bus.emit(SESSION_IDLE, {
    ...payload,
    providerId: detail?.providerId ?? null,
    startedAt: detail?.startedAt ?? null,
    projectName: detail?.projectName ?? null,
    projectPath: detail?.projectPath ?? payload.projectPath ?? null,
    personaLabel: detail?.personaLabel ?? null,
    personaDomain: detail?.personaDomain ?? null,
    lastModel: detail?.lastModel ?? null,
    totals: {
      tokensIn: detail?.tokensIn ?? 0,
      tokensOut: detail?.tokensOut ?? 0,
      cacheRead: detail?.tokensCacheRead ?? 0,
      cacheWrite: detail?.tokensCacheWrite ?? 0,
      total: detail?.totalTokens ?? 0,
      costUsd: detail?.costUsd ?? null,
    },
  });
});
```

- [ ] **Step 3: Rewrite `session:expired`**

Replace with:

```js
watcher?.on('session:expired', async (payload) => {
  const endedAt = new Date().toISOString();
  const detailBefore = projectHistory.getDetail(payload.sessionId);
  const startedAt = detailBefore?.startedAt ?? payload.startedAt ?? endedAt;
  const inferred = await inferOutcome({
    projectPath: payload.projectPath ?? detailBefore?.projectPath ?? null,
    startedAt,
    endedAt,
  });

  if (detailBefore) {
    repo.updateHistorySession(payload.sessionId, { endedAt, status: 'completed' });
    repo.upsertHistorySessionMetrics(payload.sessionId, {
      commitsProduced: inferred.signals?.commitsProduced ?? null,
      diffExists: inferred.signals?.diffExists ?? null,
      outcome: inferred.outcome,
    });
  }

  const detail = detailBefore ? projectHistory.getDetail(payload.sessionId) : null;
  const resolvedProviderId = detail?.providerId ?? payload.providerId ?? null;
  const resolvedProviderSessionId = payload.providerSessionId ?? detail?.providerSessionId ?? null;
  mirrorMetrics(resolvedProviderId, resolvedProviderSessionId, payload.sessionId, {
    commitsProduced: inferred.signals?.commitsProduced ?? null,
    diffExists: inferred.signals?.diffExists ?? null,
    outcome: inferred.outcome,
  });

  bus.emit(SESSION_ENDED, {
    sessionId: payload.sessionId,
    providerId: resolvedProviderId,
    providerSessionId: resolvedProviderSessionId,
    personaId: detail?.personaId ?? null,
    projectId: detail?.projectId ?? null,
    projectName: detail?.projectName ?? null,
    projectPath: detail?.projectPath ?? payload.projectPath ?? null,
    personaLabel: detail?.personaLabel ?? null,
    personaDomain: detail?.personaDomain ?? null,
    startedAt,
    endedAt,
    outcome: inferred.outcome,
    commitsProduced: inferred.signals?.commitsProduced ?? null,
    diffExists: inferred.signals?.diffExists ?? null,
    totals: {
      tokensIn: detail?.tokensIn ?? 0,
      tokensOut: detail?.tokensOut ?? 0,
      cacheRead: detail?.tokensCacheRead ?? 0,
      cacheWrite: detail?.tokensCacheWrite ?? 0,
      total: detail?.totalTokens ?? 0,
      costUsd: detail?.costUsd ?? null,
    },
  });
});
```

Note: this assumes `repo.updateHistorySession(id, { endedAt, status })` exists. If not, add a minimal implementation mirroring the prepared statements already used by `historyStore.ingest`. Grep `src/db/repository.js` for `updateHistorySession` — if absent, add it before proceeding.

- [ ] **Step 4: Run test suite**

Run: `npm test`
Expected: test/integration/telemetry-flow.test.js and friends still pass, or surface the exact names of failing tests to adapt in Task 6.

- [ ] **Step 5: Commit (Tasks 2 + 3 together)**

```bash
git add src/api/server.js
git commit -m "refactor(history): route watcher event handlers through historyStore.getDetail"
```

---

### Task 4: Stop launcher writes to `session`

**Files:**
- Modify: `src/agents/launcher.js:270-345`

- [ ] **Step 1: Delete the legacy session write block**

In `prepareLaunch`, remove these lines (around lines 271-280):

```js
// 6. Create session record
const startedAt = new Date().toISOString();
const sessionId = repo.createSession({
  projectId,
  personaId,
  providerId: launchTarget.providerId,
  startedAt,
  systemPrompt,
});
repo.updateSession(Number(sessionId), { lastModel: launchTarget.model });
```

Replace with just:

```js
// 6. Create history_session (single source of truth)
const startedAt = new Date().toISOString();
```

- [ ] **Step 2: Use historySessionId everywhere the old `sessionId` was used**

Further down in `prepareLaunch`, the tracker registration at `launcher.js:~342` looks like `watcher?.registerLaunch?.({ sessionId, ... })`. Change `sessionId` to `historySessionId` in the registration payload. Also update the function's return value and any downstream consumers — search the file for all remaining references to the variable `sessionId` and replace with `historySessionId`.

Run: `grep -n "sessionId" src/agents/launcher.js` — every remaining reference must refer to `historySessionId`.

- [ ] **Step 3: Update `prepareLaunch` JSDoc**

The return type doc (around line 263) currently says `Promise<{ sessionId: number, ... }>`. Change the property name to `historySessionId`.

- [ ] **Step 4: Update launcher callers**

```bash
grep -rn "prepareLaunch\|launcher\.prepareLaunch" src test
```

For every caller, rename `sessionId` → `historySessionId` in destructuring. Primary callers: `src/api/routes/office.js` and `test/agents/launcher.test.js`.

- [ ] **Step 5: Run launcher tests**

Run: `node --test test/agents/launcher.test.js test/integration/launcher-to-hook.test.js`
Expected: PASS. If tests assert legacy `session` row creation, rewrite them to assert `history_session` instead.

- [ ] **Step 6: Commit**

```bash
git add src/agents/launcher.js src/api/routes/office.js test/agents/launcher.test.js test/integration/launcher-to-hook.test.js
git commit -m "refactor(launcher): drop legacy session write; register tracker with historySessionId"
```

---

### Task 5: Delete `/api/sessions*` routes

**Files:**
- Delete: `src/api/routes/sessions.js`
- Modify: `src/api/server.js` (remove import + `app.use(sessionRoutes(...))`)

- [ ] **Step 1: Remove the import and mount**

In `src/api/server.js`:
- Delete line `import { sessionRoutes } from './routes/sessions.js';`
- Delete the corresponding `app.use(sessionRoutes({ repo, watcher, aggregator }));` line (grep for it).

- [ ] **Step 2: Delete the file**

```bash
git rm src/api/routes/sessions.js
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --test-reporter=spec 2>&1 | head -100`
Expected: `test/api/sessions.test.js` fails (handled next).

- [ ] **Step 4: Delete legacy session API test**

```bash
git rm test/api/sessions.test.js
```

- [ ] **Step 5: Run tests again**

Run: `npm test`
Expected: no references to `/api/sessions*` from any test. If any survive (e.g., portfolio.test.js), note them for Task 7.

- [ ] **Step 6: Commit**

```bash
git add src/api/server.js
git commit -m "feat(api): remove legacy /api/sessions routes"
```

---

### Task 6: Delete UI legacy callers

**Files:**
- Modify: `ui/src/stores/office-store.js`
- Modify: `ui/src/lib/ws-client.js`
- Modify: `ui/src/lib/session-status.js`

- [ ] **Step 1: Inventory UI calls**

```bash
grep -n "/api/sessions\|api/sessions" ui/src
```

- [ ] **Step 2: For each hit, decide: port to `/api/history/sessions*` or delete**

Phase 3 already introduced the history-backed list endpoint. If the call is:
- `/api/sessions/active` or `/api/sessions` (list) — migrate to the history equivalent or delete if already dead.
- `/api/sessions/:id` (detail) — delete if unused, or point to history detail route if one exists.
- `/api/sessions/stats` or `/api/sessions/pulse` — the aggregator already returns equivalent shapes; if a UI tile calls these, confirm a history-backed endpoint exists, else add a thin wrapper in `src/api/routes/history.js` that returns `aggregator.getTodayStats()` / `aggregator.getPulseBuckets()`.

Apply edits per-file. Do not keep a compatibility shim — the user approved hard removal.

- [ ] **Step 3: Build UI**

```bash
cd ui && npm run build
```
Expected: PASS.

- [ ] **Step 4: Smoke-run**

```bash
npm run dev &  # in root
```
Open the UI, load HistoryView, portfolio dashboard tiles. Confirm no console errors about `/api/sessions`. Kill dev server.

- [ ] **Step 5: Commit**

```bash
git add ui/src
git commit -m "feat(ui): drop /api/sessions callers; read exclusively from history endpoints"
```

---

### Task 7: Delete legacy repo methods + prepared statements

**Files:**
- Modify: `src/db/repository.js`

- [ ] **Step 1: Delete functions**

Remove `function createSession`, `function updateSession`, `function listSessionsPage`, `function getSessionDetail`, and `function listActiveSessions` (lines ~572-651) along with their entries in the returned object (lines ~1543-1548).

- [ ] **Step 2: Delete prepared statements**

Remove the prepared statements in `src/db/repository.js` that target `session` (the `insert`, `getById`, `getByIdWithJoins`, `listPage`, `listActive`, `update`, `countSince`, `sumTokensSince`, `sumCommitsSince`, `pulseSince` — lines ~444-513). Keep any that are history_session oriented.

Also remove `repo.getSession` if it exists (grep for it first).

- [ ] **Step 3: Grep gate**

```bash
grep -rn "repo\.createSession\|repo\.updateSession\|repo\.listSessionsPage\|repo\.getSessionDetail\|repo\.listActiveSessions\|repo\.getSession\b" src test
```
Expected: zero matches.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: any remaining failures point at the last tests to port (Task 8). Proceed only if failures are in the test files listed there.

- [ ] **Step 5: Commit**

```bash
git add src/db/repository.js
git commit -m "refactor(repo): delete legacy session methods and prepared statements"
```

---

### Task 8: Port/delete remaining legacy-session tests

**Files to edit:**
- `test/db/repository.test.js:375-410` — delete the `createSession returns a numeric id` and `updateSession updates fields` tests.
- `test/db/database.test.js:~160-190` — delete the `INSERT INTO session` assertions.
- `test/db/history-session-metrics.test.js:105-120` — delete the legacy session setup block (the test that creates `ctx.repo.createSession` then `updateSession`); the history-session path of the same test file stays.
- `test/telemetry/session-aggregator.test.js` — rewrite fixtures to seed `history_session` + `history_session_metrics` instead of legacy session.
- `test/api/portfolio.test.js:70-76` — rewrite fixture to use `projectHistory.createLaunch` + `repo.upsertHistorySessionMetrics`.
- `test/stats/portfolio-stats.test.js:49-55` — same rewrite as portfolio.test.js.

- [ ] **Step 1: Delete the obsolete tests**

```bash
# Open each file and delete the specified blocks. Verify removal:
grep -n "createSession\|updateSession\|FROM session\|INSERT INTO session\|INTO session" test
```

Any surviving match either (a) is a test to port, or (b) references `history_session` (keep).

- [ ] **Step 2: Port aggregator test**

In `test/telemetry/session-aggregator.test.js`, replace each `repo.createSession({...})` + `repo.updateSession(id, {...})` pair with:

```js
const { historySessionId } = projectHistory.createLaunch({
  projectId, personaId, providerId: 'claude-code', startedAt: now, model: 'claude-opus-4-7', systemPrompt: '',
});
repo.upsertHistorySessionMetrics(historySessionId, {
  tokensIn, tokensOut, tokensCacheRead, tokensCacheWrite, costUsd, lastModel,
});
```

Ensure the test's `ctx` (or helper) exposes `projectHistory`; if not, use `createProjectHistoryStore(repo)` inline.

- [ ] **Step 3: Port portfolio tests**

Apply the same substitution pattern in `test/api/portfolio.test.js` and `test/stats/portfolio-stats.test.js`.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Grep gate (final)**

```bash
grep -rn "repo\.createSession\|listSessionsPage\|/api/sessions\b" src ui test
```
Expected: zero matches.

- [ ] **Step 6: Commit**

```bash
git add test
git commit -m "test(history): port legacy-session fixtures to history_session*"
```

---

### Task 9: Manual verification

- [ ] **Step 1: Verify launchers**

Start the app (`npm run dev`). Launch sessions:
1. Claude via agent-office launcher.
2. Claude in a native terminal inside a tracked project.
3. Gemini via native terminal.
4. Codex via native terminal.

- [ ] **Step 2: Verify DB**

```bash
sqlite3 <db-path> \
  "SELECT source, persona_id, provider_id, status FROM history_session ORDER BY history_session_id DESC LIMIT 8;"
```
Expected: new rows with correct source (`launcher` vs `telemetry-watcher`), persona for launcher rows, provider metrics flowing.

- [ ] **Step 3: Verify no writes to session**

```bash
sqlite3 <db-path> "SELECT MAX(session_id), MAX(started_at) FROM session;"
```
Expected: values unchanged from before the test run.

- [ ] **Step 4: Verify UI**

- HistoryView lists all new sessions for the project.
- Portfolio tiles (sessions count, tokens, commits, pulse chart) render correctly.
- No console errors referencing `/api/sessions`.

- [ ] **Step 5: Tag the roadmap**

Edit `docs/superpowers/plans/unified-history-roadmap.md`: add a Phase 5b row to the status table with status ⏳ → 🚧 (in-progress until PR2).

Commit: `docs(history): mark Phase 5b PR1 shipped in roadmap`

---

### Task 10: Open PR1

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin <branch>
gh pr create --title "Unified History Phase 5b (PR1): stop writes & delete readers for legacy session table" --body "$(cat <<'EOF'
## Summary
- Delete legacy `/api/sessions*` routes and UI callers.
- Launcher + watcher event handlers now read/write history_session only.
- Remove `createSession` / `updateSession` / `listSessionsPage` / `getSessionDetail` / `listActiveSessions` repo methods.
- Introduce `historyStore.getDetail(id)` as the unified enrichment helper.
- `session` table remains on disk (dropped in PR2 after soak).

## Test plan
- [ ] `npm test` green
- [ ] Manual launcher session in Claude/Gemini/Codex + native terminal
- [ ] HistoryView renders all new sessions; portfolio tiles render correctly
- [ ] `sqlite3 ... "SELECT MAX(session_id) FROM session"` does not change during the test run

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR2 — Drop the `session` table

### Task 11: Write migration 007

**Files:**
- Create: `src/db/migrations/007-drop-session.js`

- [ ] **Step 1: Create the migration**

```js
export function up(db) {
  db.exec(`DROP TABLE IF EXISTS session;`);
}

export function down(db) {
  // Intentionally not reversible — session table is retired.
}
```

Register the migration in the migration runner. Grep for `006-history-session-metrics` to find the registry file (likely `src/db/migrations/index.js` or similar), and add `007-drop-session.js` in the same pattern.

- [ ] **Step 2: Run migrations on a fresh DB**

```bash
rm -f /tmp/agent-office-test.db
AGENT_OFFICE_DB=/tmp/agent-office-test.db npm run migrate
sqlite3 /tmp/agent-office-test.db "SELECT name FROM sqlite_master WHERE type='table' AND name='session';"
```
Expected: empty result.

- [ ] **Step 3: Run migrations on a prod-shape DB**

Copy the active DB to a scratch path and run migrations against it:

```bash
cp ~/.agent-office/db.sqlite /tmp/agent-office-prod-like.db
AGENT_OFFICE_DB=/tmp/agent-office-prod-like.db npm run migrate
sqlite3 /tmp/agent-office-prod-like.db "SELECT name FROM sqlite_master WHERE type='table' AND name='session';"
```
Expected: empty.

- [ ] **Step 4: Write a migration test**

Create `test/db/migrations/drop-session.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../../helpers/test-context.js';

test('migration 007 drops the session table', (t) => {
  const ctx = createTestContext();
  t.after(() => ctx.cleanup());
  const row = ctx.db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='session'`
  ).get();
  assert.equal(row, undefined);
});
```

- [ ] **Step 5: Run test**

Run: `node --test test/db/migrations/drop-session.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/007-drop-session.js test/db/migrations/drop-session.test.js src/db/migrations/index.js
git commit -m "feat(db): migration 007 drops legacy session table"
```

---

### Task 12: Strip remaining fixture code that creates `session`

- [ ] **Step 1: Grep**

```bash
grep -rn "CREATE TABLE session\|INSERT INTO session" test src
```

- [ ] **Step 2: For each match, delete**

Most likely in `test/db/database.test.js` and any schema snapshot fixtures. Delete the offending blocks (not whole tests — only the legacy-session bits).

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add test
git commit -m "test(db): remove legacy session table fixtures"
```

---

### Task 13: Update roadmap

- [ ] **Step 1: Flip Phase 5b to ✅**

Edit `docs/superpowers/plans/unified-history-roadmap.md`:
- Change Phase 5b row to `✅ Shipped` with this plan file path.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/unified-history-roadmap.md
git commit -m "docs(history): mark Phase 5b shipped"
```

---

### Task 14: Open PR2

- [ ] **Step 1: Push and open PR**

```bash
git push
gh pr create --title "Unified History Phase 5b (PR2): drop legacy session table" --body "$(cat <<'EOF'
## Summary
- Migration 007 executes `DROP TABLE session`.
- Strip remaining fixture references.
- Roadmap updated.

Depends on PR1 having been merged and soaked in production.

## Test plan
- [ ] `npm test` green
- [ ] Migration runs cleanly on fresh DB and on prod-shape DB
- [ ] `sqlite3 <db> "SELECT name FROM sqlite_master WHERE name='session'"` empty post-migration

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Cross-phase invariants (unchanged)

- `history_session.source` is write-once; launcher > hook.
- `persona_id` launcher-authoritative.
- All session-history writes flow through `historyStore`.
- Dashboards read only from `history_session*`.

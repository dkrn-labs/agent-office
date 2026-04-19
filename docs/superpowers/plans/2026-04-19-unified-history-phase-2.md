# Unified History — Phase 2: Single Ingest Path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the launcher's `history_session` pre-create through a new
`historyStore.createLaunch()` helper so every `history_session` write (launcher
and hook) flows through one module. No behavior change — this is scaffolding
for Phase 3's list endpoint and Phase 4's telemetry columns.

**Architecture:** Add `createLaunch({ ... })` to the store returned by
`createProjectHistoryStore` in `src/history/project-history.js`. It wraps
`repo.createHistorySession` with `source='launcher'` and `status='in-progress'`
defaults, returns `{ historySessionId }`, and logs a warning on failure (same
behavior as the current inline block). Launcher calls it in place of the
inline `repo.createHistorySession(...)` try/catch.

**Tech Stack:** Node 20 ESM, `better-sqlite3`, `node:test`.

**Out of scope:** API routes, UI, telemetry columns, legacy `session` table.

---

## File Structure

**Modify:**
- `src/history/project-history.js` — add `createLaunch` to the returned store.
- `src/agents/launcher.js` — replace inline `repo.createHistorySession` block
  with `projectHistory.createLaunch(...)`.

**Create:**
- `test/history/create-launch.test.js` — unit test for the helper.

---

## Task 1: Add `historyStore.createLaunch()`

**Files:**
- Modify: `src/history/project-history.js` (the returned object near line 265)
- Test: `test/history/create-launch.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `test/history/create-launch.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createProjectHistoryStore } from '../../src/history/project-history.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-createlaunch-'));
  const dbPath = join(dir, 'test.db');
  const db = openDatabase(dbPath);
  runMigrations(db);
  const repo = createRepository(db);
  const store = createProjectHistoryStore(repo, { db, brief: { enabled: false } });
  const project = repo.createProject({ path: '/tmp/p2', name: 'p2', techStack: [] });
  const personaId = repo.createPersona({ label: 'Eng', domain: 'software' });
  return { dir, db, repo, store, projectId: Number(project.id ?? project), personaId: Number(personaId) };
}

function cleanup({ dir, db }) {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

describe('historyStore.createLaunch', () => {
  it('creates a history_session tagged source=launcher with persona', () => {
    const ctx = setup();
    try {
      const { historySessionId } = ctx.store.createLaunch({
        projectId: ctx.projectId,
        personaId: ctx.personaId,
        providerId: 'claude-code',
        startedAt: new Date().toISOString(),
        model: 'claude-opus-4-7',
        systemPrompt: 'system',
      });

      assert.equal(typeof historySessionId, 'number');
      const row = ctx.repo.getHistorySession(historySessionId);
      assert.equal(row.projectId, ctx.projectId);
      assert.equal(row.personaId, ctx.personaId);
      assert.equal(row.providerId, 'claude-code');
      assert.equal(row.source, 'launcher');
      assert.equal(row.status, 'in-progress');
      assert.equal(row.model, 'claude-opus-4-7');
    } finally {
      cleanup(ctx);
    }
  });

  it('returns { historySessionId: null } and does not throw on failure', () => {
    const ctx = setup();
    try {
      // invalid projectId — FK should fail, helper must swallow and return null
      const result = ctx.store.createLaunch({
        projectId: 999999,
        personaId: ctx.personaId,
        providerId: 'claude-code',
        startedAt: new Date().toISOString(),
      });
      assert.equal(result.historySessionId, null);
    } finally {
      cleanup(ctx);
    }
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx node --test test/history/create-launch.test.js`
Expected: FAIL with `store.createLaunch is not a function`.

- [ ] **Step 3: Add `createLaunch` to the store**

In `src/history/project-history.js`, inside `createProjectHistoryStore`, add
before the `return {` block:

```javascript
  function createLaunch({
    projectId,
    personaId = null,
    providerId,
    providerSessionId = null,
    startedAt = new Date().toISOString(),
    status = 'in-progress',
    model = null,
    systemPrompt = null,
    source = 'launcher',
  }) {
    if (!projectId) throw new Error('projectId is required');
    if (!providerId) throw new Error('providerId is required');
    try {
      const id = repo.createHistorySession({
        projectId,
        personaId,
        providerId,
        providerSessionId,
        startedAt,
        status,
        model,
        systemPrompt,
        source,
      });
      return { historySessionId: Number(id) };
    } catch (err) {
      console.warn('[history] createLaunch failed:', err.message);
      return { historySessionId: null };
    }
  }
```

Then add `createLaunch,` to the returned object.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx node --test test/history/create-launch.test.js`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/history/project-history.js test/history/create-launch.test.js
git commit -m "feat(history): add historyStore.createLaunch helper"
```

---

## Task 2: Launcher uses `projectHistory.createLaunch()`

**Files:**
- Modify: `src/agents/launcher.js` (lines ~281–299 — the inline pre-create block)

- [ ] **Step 1: Replace the inline block**

Replace:

```javascript
    let historySessionId = null;
    if (projectHistory && typeof repo.createHistorySession === 'function') {
      try {
        const inserted = repo.createHistorySession({
          projectId,
          personaId,
          providerId: launchTarget.providerId,
          providerSessionId: null,
          startedAt,
          status: 'in-progress',
          model: launchTarget.model,
          systemPrompt,
          source: 'launcher',
        });
        historySessionId = Number(inserted);
      } catch (err) {
        console.warn('[launcher] pre-create history_session failed:', err.message);
      }
    }
```

with:

```javascript
    let historySessionId = null;
    if (projectHistory && typeof projectHistory.createLaunch === 'function') {
      const created = projectHistory.createLaunch({
        projectId,
        personaId,
        providerId: launchTarget.providerId,
        startedAt,
        model: launchTarget.model,
        systemPrompt,
      });
      historySessionId = created.historySessionId;
    }
```

- [ ] **Step 2: Run the existing Phase 1 launcher test**

Run: `npx node --test test/agents/launcher-history-session.test.js`
Expected: PASS (3/3) — behavior is unchanged.

- [ ] **Step 3: Run the full history test directory**

Run: `npx node --test test/history/`
Expected: all green, including the new `create-launch.test.js` and the
existing `ingest-upsert.test.js`.

- [ ] **Step 4: Commit**

```bash
git add src/agents/launcher.js
git commit -m "refactor(launcher): route history_session pre-create through historyStore.createLaunch"
```

---

## Task 3: Verify no direct callers remain

- [ ] **Step 1: Grep for holdouts**

Run: `rg "repo\.createHistorySession" src`
Expected: exactly one match — `src/db/repository.js` (the definition) and one
in `src/history/project-history.js` (inside `ingest()` and the new
`createLaunch`). No matches in `src/agents/`.

If any stray direct caller exists outside the history store, move it behind
`createLaunch` or `ingest` before closing the phase.

---

## Self-Review Notes

- Pure refactor — semantics preserved: same fields, same warning log behavior,
  same null-on-failure contract.
- Contract doc (`unified-history-roadmap.md`) must be updated to mark Phase 2
  ✅ before declaring done.

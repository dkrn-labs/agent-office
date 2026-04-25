# Unified History — Phase 1: Launcher-Owned `history_session`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app launcher the authoritative creator of a `history_session` row (with `persona_id` + `source='launcher'`), and have the provider hook upsert into that row instead of creating a duplicate. This fixes persona tagging by construction and de-duplicates app-launched sessions between the two parallel tables.

**Architecture:** Launcher inserts a `history_session` row ahead of the terminal spawn, exports its id to the child process via `AGENT_OFFICE_HISTORY_SESSION_ID`, the provider hook reads that env var and forwards it in the ingest payload, and `historyStore.ingest()` merges observations into the pre-created row (keyed on `historySessionId`) rather than creating a new one.

**Tech Stack:** Node 20 ESM, `better-sqlite3`, Express, `node:test`.

**Out of scope for this phase:** UI HistoryView switch to `history_session` (Phase 3), telemetry-column migration (Phase 4), deprecation of the legacy `session` table (Phase 5). Those will ship as separate plans after this lands.

---

## File Structure

**Modify:**
- `src/agents/launcher.js` — add `historySessionId` creation in `prepareLaunch`; pass to `buildLaunchBashScript` and `spawnItermTab`; return in launch context.
- `src/history/project-history.js` — teach `ingest()` to upsert by `historySessionId` when provided.
- `src/history/hook-bridge.js` — propagate `opts.historySessionId` into every payload.
- `scripts/provider-history-hook.js` — read `AGENT_OFFICE_HISTORY_SESSION_ID` from env and hand it to `buildHistoryIngestPayload` via `opts`.
- `src/api/routes/history.js` — accept `historySessionId` on `POST /api/history/ingest`.

**Create:**
- `test/history/ingest-upsert.test.js` — unit tests for upsert-by-id behavior.
- `test/agents/launcher-history-session.test.js` — verifies launcher pre-creates a `history_session` with persona tagged and exposes `historySessionId` in the context.

**No migration needed.** The `history_session` schema already carries `source` and `persona_id`.

---

## Task 1: `historyStore.ingest()` upserts by `historySessionId`

**Files:**
- Modify: `src/history/project-history.js` (the `ingest` function, lines ~114–210)
- Test: `test/history/ingest-upsert.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `test/history/ingest-upsert.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDatabase } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createProjectHistoryStore } from '../../src/history/project-history.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-ingest-'));
  const dbPath = join(dir, 'test.db');
  const db = createDatabase(dbPath);
  const repo = createRepository(db);
  const store = createProjectHistoryStore(repo, { db, brief: { enabled: false } });
  const projectId = repo.upsertProject({ path: '/tmp/p', name: 'p', techStack: [] });
  const personaId = repo.createPersona({ label: 'Eng', domain: 'software' });
  return { dir, db, repo, store, projectId, personaId };
}

function cleanup({ dir, db }) {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

describe('historyStore.ingest upsert by historySessionId', () => {
  it('merges observations into the pre-created history_session row', () => {
    const ctx = setup();
    const { repo, store, projectId, personaId } = ctx;
    try {
      const preId = repo.createHistorySession({
        projectId,
        personaId,
        providerId: 'claude-code',
        providerSessionId: null,
        status: 'in-progress',
        source: 'launcher',
      });

      const result = store.ingest({
        projectId,
        historySessionId: preId,
        providerId: 'claude-code',
        providerSessionId: 'claude-abc',
        status: 'completed',
        summary: { summaryKind: 'turn', completed: 'done', createdAt: new Date().toISOString() },
        observations: [
          {
            type: 'change',
            title: 'edit',
            narrative: 'edited file',
            createdAt: new Date().toISOString(),
          },
        ],
      });

      assert.equal(result.historySession.id, preId);
      const row = repo.getHistorySession(preId);
      assert.equal(row.personaId, personaId);
      assert.equal(row.providerSessionId, 'claude-abc');
      assert.equal(row.status, 'completed');
      assert.equal(row.source, 'launcher');
      const obs = repo.listHistoryObservations({ projectId, limit: 10 });
      assert.equal(obs.length, 1);
      assert.equal(obs[0].historySessionId, preId);
    } finally {
      cleanup(ctx);
    }
  });

  it('falls back to provider-session lookup when no historySessionId is given', () => {
    const ctx = setup();
    const { store, repo, projectId } = ctx;
    try {
      const first = store.ingest({
        projectId,
        providerId: 'claude-code',
        providerSessionId: 'claude-xyz',
        summary: { summaryKind: 'turn', completed: 'one', createdAt: new Date().toISOString() },
        observations: [],
      });
      const second = store.ingest({
        projectId,
        providerId: 'claude-code',
        providerSessionId: 'claude-xyz',
        summary: { summaryKind: 'turn', completed: 'two', createdAt: new Date().toISOString() },
        observations: [],
      });
      assert.equal(first.historySession.id, second.historySession.id);
    } finally {
      cleanup(ctx);
    }
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node --test test/history/ingest-upsert.test.js`
Expected: FAIL — current `ingest()` does not accept `historySessionId`, so the merged row assertion fails (the pre-created row is ignored and a new one is created).

- [ ] **Step 3: Teach `ingest()` to honor `historySessionId`**

In `src/history/project-history.js`, change the `ingest({...})` function signature to also accept `historySessionId`, and make the session lookup prefer it:

Replace the existing `ingest` function block (the section from `function ingest({` through the `let historySession` assignment) with:

```javascript
  function ingest({
    projectId,
    projectPath,
    historySessionId,
    personaId,
    providerId,
    providerSessionId,
    startedAt,
    endedAt,
    status,
    model,
    systemPrompt,
    source,
    summary,
    observations = [],
  }) {
    if (!providerId) throw new Error('providerId is required');
    if (!projectId && !projectPath) throw new Error('projectId or projectPath is required');

    const project = projectId != null ? repo.getProject(Number(projectId)) : repo.getProjectByPath(projectPath);
    if (!project) throw new Error('Project not found');

    let historySession = null;
    if (historySessionId != null) {
      historySession = repo.getHistorySession(Number(historySessionId));
      if (historySession && historySession.projectId !== project.id) {
        throw new Error('historySessionId belongs to a different project');
      }
    }
    if (!historySession && providerSessionId != null) {
      historySession = repo.getHistorySessionByProvider(providerId, providerSessionId);
    }
```

Then, in the same function, extend the existing `repo.updateHistorySession(historySession.id, {...})` call to also pass `providerSessionId` so the pre-created row gets the provider's real session id on first hook fire:

```javascript
    } else {
      repo.updateHistorySession(historySession.id, {
        personaId: personaId != null ? Number(personaId) : historySession.personaId,
        providerSessionId: providerSessionId ?? historySession.providerSessionId,
        startedAt: startedAt ?? historySession.startedAt,
        endedAt,
        status,
        model,
        systemPrompt,
        source,
      });
      historySession = repo.getHistorySession(historySession.id);
    }
```

- [ ] **Step 4: Extend `repo.updateHistorySession` to persist `providerSessionId`**

In `src/db/repository.js` around line 860:

```javascript
  function updateHistorySession(id, fields) {
    historySessionStmts.update.run({
      id,
      personaId: fields.personaId ?? null,
      providerSessionId: fields.providerSessionId ?? null,
      startedAt: fields.startedAt ?? null,
      endedAt: fields.endedAt ?? null,
      status: fields.status ?? null,
      model: fields.model ?? null,
      systemPrompt: fields.systemPrompt ?? null,
      source: fields.source ?? null,
      updatedAt: fields.updatedAt ?? new Date().toISOString(),
    });
  }
```

And in the prepared statement for `historySessionStmts.update` (search for the existing `UPDATE history_session SET` prepare), add `provider_session_id = COALESCE(@providerSessionId, provider_session_id)` to the SET list. Preserve existing COALESCE patterns on other fields so null inputs don't clobber non-null stored values.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --test test/history/ingest-upsert.test.js`
Expected: PASS (2/2).

- [ ] **Step 6: Run the existing history test suite to confirm no regressions**

Run: `node --test test/history/`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add test/history/ingest-upsert.test.js src/history/project-history.js src/db/repository.js
git commit -m "feat(history): ingest() upserts by historySessionId

Accepts a pre-created history_session id and merges into it instead
of creating a duplicate. Falls back to provider-session lookup when
id is not given. Unblocks launcher-owned session rows."
```

---

## Task 2: API route forwards `historySessionId`

**Files:**
- Modify: `src/api/routes/history.js` (`POST /api/history/ingest` handler)
- Test: extend `test/api/*` if a history route test exists, or add a small test in `test/history/ingest-upsert.test.js` hitting the route

- [ ] **Step 1: Update the route handler to pass through `historySessionId`**

In `src/api/routes/history.js` inside the `POST /api/history/ingest` handler, extend the `historyStore.ingest({...})` call to include:

```javascript
      const result = historyStore.ingest({
        projectId: payload.projectId,
        projectPath: payload.projectPath,
        historySessionId: payload.historySessionId,
        personaId: payload.personaId,
        providerId: payload.providerId,
        providerSessionId: payload.providerSessionId,
        startedAt: payload.startedAt,
        endedAt: payload.endedAt,
        status: payload.status,
        model: payload.model,
        systemPrompt: payload.systemPrompt,
        source: payload.source,
        summary: payload.summary,
        observations: Array.isArray(payload.observations) ? payload.observations : [],
      });
```

- [ ] **Step 2: Commit**

```bash
git add src/api/routes/history.js
git commit -m "feat(api): /api/history/ingest accepts historySessionId"
```

---

## Task 3: `hook-bridge` propagates `historySessionId`

**Files:**
- Modify: `src/history/hook-bridge.js` (three `build*Payload` functions)
- Test: extend `test/history/hook-bridge.test.js`

- [ ] **Step 1: Add a failing test asserting historySessionId passes through**

Append to `test/history/hook-bridge.test.js`:

```javascript
  it('propagates opts.historySessionId into the payload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-hook-bridge-'));
    const transcriptPath = join(dir, 'claude.jsonl');
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      })}\n`,
      'utf8',
    );
    const payload = buildHistoryIngestPayload(
      'claude-code',
      {
        session_id: 'claude-x',
        cwd: '/tmp/project',
        hook_event_name: 'Stop',
        transcript_path: transcriptPath,
        last_assistant_message: 'done',
      },
      { historySessionId: 4242 },
    );
    assert.equal(payload.historySessionId, 4242);
    rmSync(dir, { recursive: true, force: true });
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `node --test test/history/hook-bridge.test.js`
Expected: FAIL (`payload.historySessionId` is undefined).

- [ ] **Step 3: Thread the field through each builder**

In `src/history/hook-bridge.js`, add this helper near the top, below `trimText`:

```javascript
function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}
```

Then in each of `buildClaudePayload`, `buildGeminiPayload`, `buildCodexPayload`, add `historySessionId: toInt(opts.historySessionId) ?? null` to the returned object. Example for the Claude builder return:

```javascript
  return {
    projectPath,
    providerId: 'claude-code',
    providerSessionId: trimText(input.session_id),
    historySessionId: toInt(opts.historySessionId) ?? null,
    model: trimText(input.model) ?? null,
    status: 'completed',
    summary: { /* unchanged */ },
    observations: enrichment.observations,
  };
```

Apply the same `historySessionId` line to the Gemini and Codex returns.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node --test test/history/hook-bridge.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/history/hook-bridge.js test/history/hook-bridge.test.js
git commit -m "feat(hook-bridge): propagate historySessionId from opts into payload"
```

---

## Task 4: Hook script reads env and forwards to payload

**Files:**
- Modify: `scripts/provider-history-hook.js`

- [ ] **Step 1: Read the env var and pass to the builder**

In `scripts/provider-history-hook.js`, replace the `buildHistoryIngestPayload` call in `main()` with:

```javascript
  const historySessionIdEnv = Number(process.env.AGENT_OFFICE_HISTORY_SESSION_ID);
  const historySessionId = Number.isInteger(historySessionIdEnv) && historySessionIdEnv > 0
    ? historySessionIdEnv
    : null;

  const payload = buildHistoryIngestPayload(args.provider, input, {
    cwd: process.cwd(),
    historySessionId,
  });
```

- [ ] **Step 2: Smoke test locally**

Run (simulating a Claude Stop hook with a stale transcript path — should 400 or no-op gracefully):

```bash
AGENT_OFFICE_HISTORY_SESSION_ID=99999 \
  echo '{"session_id":"x","cwd":"/tmp","hook_event_name":"Stop","transcript_path":"/nonexistent","last_assistant_message":"hi"}' \
  | node scripts/provider-history-hook.js --provider claude-code --api-base http://127.0.0.1:0
```

Expected: exits with `{}` on stdout, an error on stderr about the unreachable API. No crash. (We're only verifying the env wiring doesn't throw.)

- [ ] **Step 3: Commit**

```bash
git add scripts/provider-history-hook.js
git commit -m "feat(hook): read AGENT_OFFICE_HISTORY_SESSION_ID from env and forward"
```

---

## Task 5: Launcher pre-creates `history_session` and exports env var

**Files:**
- Modify: `src/agents/launcher.js` — `prepareLaunch`, `buildLaunchBashScript`, `spawnItermTab`
- Test: `test/agents/launcher-history-session.test.js` (new)

- [ ] **Step 1: Extend `buildLaunchBashScript` to export the env var**

In `src/agents/launcher.js`, change the signature and body:

```javascript
export function buildLaunchBashScript({
  projectPath,
  scriptPath,
  promptPath,
  providerId,
  model,
  historySessionId = null,
}) {
  const q = JSON.stringify;
  const launchTarget = resolveLaunchTarget(providerId, model);
  let command = `exec claude --model ${q(launchTarget.model)} --append-system-prompt "$PROMPT"`;
  if (launchTarget.providerId === 'codex') {
    command = `exec codex --model ${q(launchTarget.model)} "$PROMPT"`;
  } else if (launchTarget.providerId === 'gemini-cli') {
    command = `exec gemini --model ${q(launchTarget.model)} --prompt-interactive "$PROMPT"`;
  }

  const exportLine = historySessionId != null
    ? `export AGENT_OFFICE_HISTORY_SESSION_ID=${Number(historySessionId)}\n`
    : '';

  return `#!/bin/bash
cd ${q(projectPath)} || exit 1
clear
${exportLine}PROMPT="$(cat ${q(promptPath)})"
rm -f ${q(promptPath)} ${q(scriptPath)}
${command}
`;
}
```

- [ ] **Step 2: Extend `spawnItermTab` to forward `historySessionId`**

```javascript
export async function spawnItermTab({
  projectPath,
  systemPrompt,
  providerId,
  model,
  historySessionId = null,
}) {
  // ...existing body...
  const bash = buildLaunchBashScript({
    projectPath,
    scriptPath,
    promptPath,
    providerId,
    model,
    historySessionId,
  });
  // ...rest unchanged...
}
```

- [ ] **Step 3: Pre-create the `history_session` in `prepareLaunch`**

Inside `prepareLaunch`, immediately after the existing `repo.createSession({...})` block, add:

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

And include `historySessionId` in the return value:

```javascript
    return {
      sessionId: Number(sessionId),
      historySessionId,
      projectPath: project.path,
      systemPrompt,
      skills: resolvedSkills,
      memories,
      brief,
      startedAt,
      launchTarget,
      providerId: launchTarget.providerId,
      model: launchTarget.model,
    };
```

- [ ] **Step 4: Pass `historySessionId` through `launch()` to `spawnItermTab`**

In `launch()`:

```javascript
    if (!dryRun) {
      await spawnItermTab({
        projectPath: ctx.projectPath,
        systemPrompt: ctx.systemPrompt,
        providerId: ctx.providerId,
        model: ctx.model,
        historySessionId: ctx.historySessionId,
      });
    }
```

- [ ] **Step 5: Write the launcher test**

Create `test/agents/launcher-history-session.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDatabase } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createEventBus } from '../../src/core/event-bus.js';
import { createSkillResolver } from '../../src/agents/skill-resolver.js';
import { createLauncher, buildLaunchBashScript } from '../../src/agents/launcher.js';
import { createProjectHistoryStore } from '../../src/history/project-history.js';

describe('launcher pre-creates a history_session', () => {
  it('creates a launcher-sourced row with persona tagged and returns its id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-launcher-hist-'));
    const db = createDatabase(join(dir, 'test.db'));
    const repo = createRepository(db);
    const bus = createEventBus();
    const resolver = createSkillResolver({ repo, skillRoots: [] });
    const projectHistory = createProjectHistoryStore(repo, { db, brief: { enabled: false } });

    const projectId = repo.upsertProject({ path: dir, name: 'p', techStack: [] });
    const personaId = repo.createPersona({ label: 'Eng', domain: 'software' });

    const launcher = createLauncher({
      repo,
      bus,
      resolver,
      projectHistory,
      dryRun: true,
    });

    const ctx = await launcher.launch(personaId, projectId);
    assert.ok(Number.isInteger(ctx.historySessionId), 'historySessionId is an integer');
    const row = repo.getHistorySession(ctx.historySessionId);
    assert.equal(row.personaId, personaId);
    assert.equal(row.source, 'launcher');
    assert.equal(row.status, 'in-progress');
    assert.equal(row.providerSessionId, null);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('buildLaunchBashScript emits the env export when id is provided', () => {
    const bash = buildLaunchBashScript({
      projectPath: '/tmp/x',
      scriptPath: '/tmp/s.sh',
      promptPath: '/tmp/p.txt',
      providerId: 'claude-code',
      model: 'claude-sonnet-4-6',
      historySessionId: 77,
    });
    assert.match(bash, /export AGENT_OFFICE_HISTORY_SESSION_ID=77/);
  });

  it('buildLaunchBashScript omits the export when id is null', () => {
    const bash = buildLaunchBashScript({
      projectPath: '/tmp/x',
      scriptPath: '/tmp/s.sh',
      promptPath: '/tmp/p.txt',
      providerId: 'claude-code',
      model: 'claude-sonnet-4-6',
      historySessionId: null,
    });
    assert.doesNotMatch(bash, /AGENT_OFFICE_HISTORY_SESSION_ID/);
  });
});
```

- [ ] **Step 6: Run the launcher test suite**

Run: `node --test test/agents/`
Expected: all green, including new file.

- [ ] **Step 7: Commit**

```bash
git add src/agents/launcher.js test/agents/launcher-history-session.test.js
git commit -m "feat(launcher): pre-create history_session and export id to child shell

Launcher now inserts a history_session row with persona_id tagged and
source='launcher' before spawning the terminal, and exports
AGENT_OFFICE_HISTORY_SESSION_ID to the shell. The provider hook picks
this up and upserts into the same row instead of creating a duplicate."
```

---

## Task 6: End-to-end integration test

**Files:**
- Create: `test/integration/launcher-to-hook.test.js`

- [ ] **Step 1: Write the integration test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDatabase } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createProjectHistoryStore } from '../../src/history/project-history.js';
import { buildHistoryIngestPayload } from '../../src/history/hook-bridge.js';

describe('launcher → hook round trip', () => {
  it('hook upserts observations into the launcher-created row', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-office-roundtrip-'));
    const db = createDatabase(join(dir, 'test.db'));
    const repo = createRepository(db);
    const store = createProjectHistoryStore(repo, { db, brief: { enabled: false } });
    const projectPath = dir;
    const projectId = repo.upsertProject({ path: projectPath, name: 'p', techStack: [] });
    const personaId = repo.createPersona({ label: 'Eng', domain: 'software' });

    const preId = repo.createHistorySession({
      projectId,
      personaId,
      providerId: 'claude-code',
      providerSessionId: null,
      status: 'in-progress',
      source: 'launcher',
    });

    const transcriptPath = join(dir, 't.jsonl');
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'all done' }] },
      })}\n`,
      'utf8',
    );

    const payload = buildHistoryIngestPayload(
      'claude-code',
      {
        session_id: 'claude-session-aaa',
        cwd: projectPath,
        hook_event_name: 'Stop',
        transcript_path: transcriptPath,
        last_assistant_message: 'all done',
      },
      { historySessionId: preId },
    );
    assert.equal(payload.historySessionId, preId);

    const result = store.ingest({
      projectId,
      historySessionId: payload.historySessionId,
      providerId: payload.providerId,
      providerSessionId: payload.providerSessionId,
      summary: payload.summary,
      observations: payload.observations,
    });

    assert.equal(result.historySession.id, preId);
    const row = repo.getHistorySession(preId);
    assert.equal(row.personaId, personaId);
    assert.equal(row.providerSessionId, 'claude-session-aaa');

    const rowsForProject = repo.listHistorySessions
      ? repo.listHistorySessions({ projectId })
      : null;
    if (rowsForProject) {
      assert.equal(rowsForProject.length, 1, 'no duplicate row was created');
    }

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/integration/launcher-to-hook.test.js`
Expected: PASS.

- [ ] **Step 3: Run the whole suite**

Run: `node --test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add test/integration/launcher-to-hook.test.js
git commit -m "test: integration round-trip from launcher pre-create to hook upsert"
```

---

## Task 7: Manual verification on this machine

- [ ] **Step 1: Launch a session from the agent-office UI**

Open the app, launch a persona on the `agent-office` project. Let the session run for a turn or two, then exit Claude.

- [ ] **Step 2: Verify one merged row exists**

```bash
sqlite3 ~/.agent-office/agent-office.db "
  SELECT history_session_id, persona_id, source, provider_session_id, status
  FROM history_session
  WHERE project_id = 4
  ORDER BY history_session_id DESC LIMIT 3;
"
```

Expected: the newest row has `source='launcher'`, `persona_id` filled, `provider_session_id` set (populated by the hook), `status='completed'`. Not two rows for the same launch.

- [ ] **Step 3: Verify terminal-launched sessions still ingest as unassigned**

From a plain terminal (no app), run `claude` inside the project, exit. Then:

```bash
sqlite3 ~/.agent-office/agent-office.db "
  SELECT history_session_id, persona_id, source
  FROM history_session
  WHERE project_id = 4 ORDER BY history_session_id DESC LIMIT 1;
"
```

Expected: a row with `source='provider-hook'`, `persona_id IS NULL` — the Phase 3 "Unassigned" bucket target.

---

## Follow-up phases (separate plans)

Each of these will get its own plan file once Phase 1 lands. Listed here only so the overall trajectory is legible:

- **Phase 2 — Ingest writes through API only.** Move launcher's direct `repo.createHistorySession` call behind a `historyStore.createLaunch()` helper so there's one ingest path. Minor refactor, no behavior change.
- **Phase 3 — HistoryView reads `history_session`.** New `GET /api/history/sessions` list route (paginated, with persona/project/source filters and an "Unassigned" bucket for `persona_id IS NULL`). UI swaps data source in `ui/src/dashboard/HistoryView.jsx` + `ui/src/stores/office-store.js`.
- **Phase 4 — Telemetry columns.** Migrate `tokensIn/Out`, `tokensCacheRead/Write`, `costUsd`, `commitsProduced`, `diffExists`, `outcome`, `error` from `session` onto `history_session` (or a sibling `history_session_metrics` table). Backfill from existing `session` rows. Point aggregator/stats at the new home.
- **Phase 5 — Deprecate `session`.** Read-only shim for one release (legacy endpoints keep working), then drop the table and the `createSession`/`updateSession`/`listSessionsPage` repo methods.

---

## Self-Review Notes

- Every spec concern from the preceding conversation is covered: persona tagging by construction (Task 5), hook upsert into launcher row (Tasks 1+3+4), no duplicate `history_session` rows for app launches (Tasks 1+5+6), terminal-launch rows still land with null persona (Task 7 step 3, which is the ramp for Phase 3).
- No TODOs, no "similar to", no un-shown code.
- Method names used in later tasks (`updateHistorySession` with `providerSessionId`, `historyStore.ingest` with `historySessionId`, `buildLaunchBashScript({ historySessionId })`) match their definitions in earlier tasks.
- UI work is intentionally deferred to Phase 3 — this plan deliberately does not touch `ui/src/*`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createSkillResolver } from '../../src/agents/skill-resolver.js';
import { createEventBus } from '../../src/core/event-bus.js';
import { createLauncher, buildLaunchBashScript } from '../../src/agents/launcher.js';
import { createProjectHistoryStore } from '../../src/history/project-history.js';

let dir;
let db;
let repo;
let bus;
let resolver;
let launcher;
let projectHistory;
let projectId;
let personaId;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-launcher-hs-test-'));
  db = openDatabase(join(dir, 'test.db'));
  await runMigrations(db);
  repo = createRepository(db);
  bus = createEventBus();
  resolver = createSkillResolver(repo, { localSkillInventory: [] });
  projectHistory = createProjectHistoryStore(repo, { db, brief: { enabled: false } });
  launcher = createLauncher({
    repo,
    bus,
    resolver,
    projectHistory,
    dryRun: true,
  });

  projectId = Number(
    repo.createProject({
      path: '/tmp/test-project-hs',
      name: 'HS Test Project',
      techStack: ['node'],
    }),
  );

  personaId = Number(
    repo.createPersona({
      label: 'Backend Dev',
      domain: 'backend',
      secondaryDomains: [],
      systemPromptTemplate: 'You are working on {{project}}.',
      source: 'built-in',
    }),
  );
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Launcher pre-creates history_session with persona tag', () => {
  it('launch() returns a historySessionId and the row matches persona/source/status', async () => {
    const ctx = await launcher.launch(personaId, projectId);
    assert.equal(typeof ctx.historySessionId, 'number');
    assert.ok(Number.isInteger(ctx.historySessionId));

    const row = repo.getHistorySession(ctx.historySessionId);
    assert.ok(row, 'history_session row should exist');
    assert.equal(Number(row.personaId), personaId);
    assert.equal(row.source, 'launcher');
    assert.equal(row.status, 'in-progress');
    assert.equal(row.providerSessionId, null);
  });
});

describe('buildLaunchBashScript export line', () => {
  it('emits the export line when historySessionId is provided', () => {
    const bash = buildLaunchBashScript({
      projectPath: '/tmp/x',
      scriptPath: '/tmp/launch.sh',
      promptPath: '/tmp/prompt.txt',
      historySessionId: 77,
    });
    assert.ok(
      bash.includes('export AGENT_OFFICE_HISTORY_SESSION_ID=77'),
      `expected export line in bash script, got:\n${bash}`,
    );
  });

  it('omits the export line when historySessionId is null', () => {
    const bash = buildLaunchBashScript({
      projectPath: '/tmp/x',
      scriptPath: '/tmp/launch.sh',
      promptPath: '/tmp/prompt.txt',
      historySessionId: null,
    });
    assert.ok(
      !bash.includes('AGENT_OFFICE_HISTORY_SESSION_ID'),
      `expected no export line in bash script, got:\n${bash}`,
    );
  });
});

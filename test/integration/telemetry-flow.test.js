import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { createApp } from '../../src/api/server.js';
import { createRepository } from '../../src/db/repository.js';
import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createEventBus } from '../../src/core/event-bus.js';
import { loadConfig } from '../../src/core/config.js';
import { SESSION_ENDED, SESSION_IDLE, SESSION_UPDATE } from '../../src/core/events.js';

const execFile = promisify(execFileCallback);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFor(check, timeoutMs = 3_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const result = await check();
        if (result) {
          clearInterval(timer);
          resolve(result);
          return;
        }
      } catch {
        // keep polling
      }

      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('timed out waiting for condition'));
      }
    }, 20);
  });
}

describe('telemetry flow', () => {
  let tempRoot;
  let configDir;
  let projectPath;
  let oldHome;
  let db;
  let repo;
  let bus;
  let app;
  let projectId;
  let personaId;

  before(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'agent-office-telemetry-flow-'));
    configDir = join(tempRoot, '.agent-office');
    projectPath = join(tempRoot, 'project-alpha');
    oldHome = process.env.HOME;
    process.env.HOME = tempRoot;

    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(projectPath, 'README.md'), '# project alpha\n');
    writeFileSync(join(projectPath, 'feature.js'), 'export const feature = "ready";\n');

    await execFile('git', ['init'], { cwd: projectPath });
    await execFile('git', ['config', 'user.name', 'Agent Office Tests'], { cwd: projectPath });
    await execFile('git', ['config', 'user.email', 'tests@example.com'], { cwd: projectPath });
    await execFile('git', ['add', '.'], { cwd: projectPath });
    await execFile('git', ['commit', '-m', 'initial'], {
      cwd: projectPath,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z',
      },
    });

    db = openDatabase(':memory:');
    await runMigrations(db);
    repo = createRepository(db);
    bus = createEventBus();

    projectId = Number(
      repo.createProject({
        path: projectPath,
        name: 'project-alpha',
        techStack: ['node', 'react'],
      }),
    );
    personaId = Number(
      repo.createPersona({
        label: 'Frontend Dev',
        domain: 'frontend',
        secondaryDomains: ['review'],
        systemPromptTemplate:
          'You are working on {{project}}. Stack: {{techStack}}.\n\nSkills:\n{{skills}}\n\nMemories:\n{{memories}}',
        source: 'test',
      }),
    );
    repo.createSkill({
      name: 'React Component Patterns',
      domain: 'frontend',
      applicableStacks: ['react'],
      content: 'Prefer function components with hooks.',
      source: 'test',
    });

    app = createApp({
      repo,
      bus,
      config: loadConfig(configDir),
      configDir,
      db,
      dryRun: true,
      telemetry: true,
      telemetryIdleMs: 75,
      telemetryExpiryMs: 120,
      startTelemetryWatcher: false,
      // P5-C2 — disable the operator-grace deferral so SESSION_ENDED
      // fires synchronously (the test asserts `ended.length === 1`
      // within waitFor's default window).
      settings: { ...(await import('../../src/core/settings.js')).getDefaultSettings(), outcomePrompt: { enabled: false, gracePeriodMs: 0 } },
    });

    assert.ok(app.locals.launcher, 'createApp should expose the launcher for integration tests');
    assert.ok(app.locals.telemetry?.watcher, 'telemetry watcher should be available');
    await delay(25);
  });

  after(async () => {
    await app?.locals.stopTelemetry?.();
    db?.close?.();
    process.env.HOME = oldHome;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('propagates launch -> usage -> idle classification -> persisted telemetry', async () => {
    const updates = [];
    const idles = [];
    const ended = [];
    bus.on(SESSION_UPDATE, (payload) => updates.push(payload));
    bus.on(SESSION_IDLE, (payload) => idles.push(payload));
    bus.on(SESSION_ENDED, (payload) => ended.push(payload));

    const ctx = await app.locals.launcher.launch(personaId, projectId);
    assert.equal(typeof ctx.sessionId, 'number');

    const live = app.locals.telemetry.watcher.ingestUsage('provider-session-1', projectPath, {
      providerSessionId: 'provider-session-1',
      cwd: projectPath,
      // The tracker rejects usage records whose timestamp is older than
      // expiryMs. Anchor to "now" so the suite doesn't rot once the
      // hardcoded date ages out (issue #0001).
      timestamp: new Date().toISOString(),
      model: 'claude-sonnet-4-6',
      tokensIn: 120,
      tokensOut: 80,
      cacheRead: 10,
      cacheWrite: 5,
    });

    assert.equal(live.sessionId, ctx.sessionId);
    assert.equal(live.totals.total, 215);

    await waitFor(() => updates.length === 1);
    assert.equal(updates[0].projectName, 'project-alpha');
    assert.equal(updates[0].projectPath, projectPath);
    assert.equal(updates[0].personaLabel, 'Frontend Dev');
    assert.equal(updates[0].personaDomain, 'frontend');
    const sessionAfterUpdate = repo.getSessionDetail(ctx.sessionId);
    assert.equal(sessionAfterUpdate.providerSessionId, 'provider-session-1');
    assert.equal(sessionAfterUpdate.lastModel, 'claude-sonnet-4-6');
    assert.equal(sessionAfterUpdate.totalTokens, 215);
    assert.equal(sessionAfterUpdate.outcome, 'unknown');

    writeFileSync(join(projectPath, 'feature.js'), 'export const feature = "changed";\n');

    await waitFor(() => idles.length === 1);
    assert.equal(idles.length, 1);
    assert.equal(idles[0].projectName, 'project-alpha');
    assert.equal(idles[0].projectPath, projectPath);
    assert.equal(idles[0].personaLabel, 'Frontend Dev');
    assert.equal(idles[0].lastModel, 'claude-sonnet-4-6');

    assert.equal(app.locals.telemetry.watcher.snapshot().length, 1);
    assert.equal(app.locals.telemetry.watcher.snapshot()[0].working, false);

    await waitFor(() => ended.length === 1);
    assert.equal(ended[0].sessionId, ctx.sessionId);
    assert.equal(ended[0].outcome, 'partial');
    assert.equal(ended[0].projectPath, projectPath);
    assert.equal(ended[0].personaDomain, 'frontend');
    assert.equal(ended[0].lastModel, 'claude-sonnet-4-6');
    assert.equal(ended[0].totals.total, 215);

    const detail = repo.getSessionDetail(ctx.sessionId);
    assert.equal(detail.providerSessionId, 'provider-session-1');
    assert.equal(detail.lastModel, 'claude-sonnet-4-6');
    assert.equal(detail.tokensIn, 120);
    assert.equal(detail.tokensOut, 80);
    assert.equal(detail.tokensCacheRead, 10);
    assert.equal(detail.tokensCacheWrite, 5);
    assert.equal(detail.totalTokens, 215);
    assert.equal(detail.outcome, 'partial');
    assert.equal(detail.diffExists, true);
    assert.equal(detail.commitsProduced, 0);
    assert.equal(Math.round(detail.costUsd * 100000000) / 100000000, 0.00158175);

    assert.deepEqual(app.locals.telemetry.watcher.snapshot(), []);

    const stats = app.locals.telemetry.aggregator.getTodayStats();
    assert.equal(stats.sessionsToday >= 1, true);
    assert.equal(stats.activeSessions, 0);
    assert.equal(stats.allTimeTokens, 215);

    const pulseBuckets = app.locals.telemetry.aggregator.getPulseBuckets();
    assert.equal(pulseBuckets.length, 6);
    assert.equal(pulseBuckets.some((bucket) => bucket.tokens >= 215), true);
  });
});

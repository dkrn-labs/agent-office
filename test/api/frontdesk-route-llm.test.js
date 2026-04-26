import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/api/server.js';
import { createRepository } from '../../src/db/repository.js';
import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createEventBus } from '../../src/core/event-bus.js';
import { loadConfig } from '../../src/core/config.js';
import { getDefaultSettings } from '../../src/core/settings.js';

async function postJson(base, path, payload) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

async function bootApp({ frontdeskLLM, settings }) {
  const configDir = mkdtempSync(join(tmpdir(), 'ao-fd-llm-'));
  const projectsDir = join(configDir, 'projects');
  mkdirSync(projectsDir, { recursive: true });
  const db = openDatabase(':memory:');
  await runMigrations(db);
  const repo = createRepository(db);
  repo.createPersona({ label: 'Backend', domain: 'backend', secondaryDomains: [], skillIds: [], source: 'test' });
  repo.createPersona({ label: 'Debug',   domain: 'debug',   secondaryDomains: [], skillIds: [], source: 'test' });
  const bus = createEventBus();
  const config = { ...loadConfig(configDir), projectsDir };
  const app = createApp({ repo, bus, config, configDir, settings, frontdeskLLM });
  await app.ready();
  const httpServer = app.server;
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = httpServer.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    app, httpServer, repo, configDir,
    cleanup: () =>
      new Promise((resolve, reject) => {
        app?.locals?.stopTelemetry?.();
        httpServer.close((err) => {
          rmSync(configDir, { recursive: true, force: true });
          if (err) reject(err); else resolve();
        });
      }),
  };
}

describe('POST /api/frontdesk/route — P2 LLM stage', () => {
  it('returns meta.stage = rules-only when frontdesk.llm.enabled is false', async () => {
    const ctx = await bootApp({
      settings: getDefaultSettings(), // enabled: false by default
      frontdeskLLM: async () => { throw new Error('should not be called'); },
    });
    try {
      const { status, body } = await postJson(ctx.base, '/api/frontdesk/route', { task: 'fix the login crash' });
      assert.equal(status, 200);
      assert.equal(body.meta.stage, 'rules-only');
      assert.equal(body.meta.fallback, null);
      assert.equal(body.data.proposal, undefined);
    } finally {
      await ctx.cleanup();
    }
  });

  it('returns meta.stage = rules+llm and a proposal when enabled, and logs the decision', async () => {
    const settings = getDefaultSettings();
    settings.frontdesk.llm.enabled = true;

    const fakeProposal = {
      persona: 'Debug',
      provider: 'claude-code',
      model: 'claude-opus-4-7',
      taskType: 'iterative',
      estimatedDuration: '5-30min',
      complexity: 6,
      history_picks: [],
      skills_picks: [],
      reasoning: 'Bug verbs route to Debug; complexity warrants Opus.',
      fallback_if_blocked: null,
    };

    const ctx = await bootApp({
      settings,
      frontdeskLLM: async () => ({ proposal: fakeProposal, meta: { usedLLM: true, fallback: null } }),
    });
    try {
      const { status, body } = await postJson(ctx.base, '/api/frontdesk/route', { task: 'fix the login crash' });
      assert.equal(status, 200);
      assert.equal(body.meta.stage, 'rules+llm');
      assert.equal(body.meta.fallback, null);
      assert.equal(body.data.proposal.persona, 'Debug');
      assert.match(body.data.proposal.reasoning, /Bug verbs/);

      const rows = ctx.repo.listFrontdeskDecisions({ limit: 5 });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].llmOutput.persona, 'Debug');
    } finally {
      await ctx.cleanup();
    }
  });

  it('surfaces meta.fallback when the LLM falls back to rules-only', async () => {
    const settings = getDefaultSettings();
    settings.frontdesk.llm.enabled = true;

    const fallbackProposal = {
      persona: 'Backend',
      provider: 'claude-code',
      model: '',
      taskType: 'iterative',
      estimatedDuration: '5-30min',
      complexity: 5,
      history_picks: [],
      skills_picks: [],
      reasoning: 'fallback',
      fallback_if_blocked: null,
    };

    const ctx = await bootApp({
      settings,
      frontdeskLLM: async () => ({ proposal: fallbackProposal, meta: { usedLLM: true, fallback: 'schema' } }),
    });
    try {
      const { body } = await postJson(ctx.base, '/api/frontdesk/route', { task: 'task' });
      assert.equal(body.meta.stage, 'rules+llm');
      assert.equal(body.meta.fallback, 'schema');
    } finally {
      await ctx.cleanup();
    }
  });
});

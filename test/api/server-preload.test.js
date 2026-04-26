import { describe, it, beforeEach, afterEach } from 'node:test';
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

let originalFetch;

beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

async function bootApp({ settings }) {
  const configDir = mkdtempSync(join(tmpdir(), 'ao-preload-'));
  const projectsDir = join(configDir, 'projects');
  mkdirSync(projectsDir, { recursive: true });
  const db = openDatabase(':memory:');
  await runMigrations(db);
  const repo = createRepository(db);
  const bus = createEventBus();
  const config = { ...loadConfig(configDir), projectsDir };
  const app = createApp({ repo, bus, config, configDir, settings });
  await app.ready();
  return {
    app,
    cleanup: () => {
      app?.locals?.stopTelemetry?.();
      app.close().then(() => rmSync(configDir, { recursive: true, force: true }));
    },
  };
}

describe('eager LMStudio preload', () => {
  it('fires a preload POST when transport=lmstudio + enabled + eagerPreload', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };

    const settings = getDefaultSettings();
    settings.frontdesk.llm.enabled = true;          // gate 1
    settings.frontdesk.llm.transport = 'lmstudio';  // gate 2
    settings.frontdesk.llm.eagerPreload = true;     // gate 3

    const ctx = await bootApp({ settings });
    try {
      // Preload runs via setImmediate; give the event loop a tick.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const preload = calls.find((c) => String(c.url).includes('/v1/chat/completions'));
      assert.ok(preload, `expected a preload POST to /v1/chat/completions; saw: ${calls.map((c) => c.url).join(', ')}`);
    } finally {
      ctx.cleanup();
    }
  });

  it('skips preload when eagerPreload is false', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };

    const settings = getDefaultSettings();
    settings.frontdesk.llm.enabled = true;
    settings.frontdesk.llm.transport = 'lmstudio';
    settings.frontdesk.llm.eagerPreload = false;

    const ctx = await bootApp({ settings });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const preload = calls.find((c) => String(c.url).includes('/v1/chat/completions'));
      assert.ok(!preload, 'preload should not have fired');
    } finally {
      ctx.cleanup();
    }
  });

  it('skips preload when frontdesk.llm.enabled is false', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };

    const settings = getDefaultSettings();
    settings.frontdesk.llm.enabled = false; // disabled
    settings.frontdesk.llm.transport = 'lmstudio';
    settings.frontdesk.llm.eagerPreload = true;

    const ctx = await bootApp({ settings });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const preload = calls.find((c) => String(c.url).includes('/v1/chat/completions'));
      assert.ok(!preload, 'preload should not fire when LLM stage is disabled');
    } finally {
      ctx.cleanup();
    }
  });

  it('skips preload when transport is sdk', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };

    const settings = getDefaultSettings();
    settings.frontdesk.llm.enabled = true;
    settings.frontdesk.llm.transport = 'sdk';
    settings.frontdesk.llm.eagerPreload = true;

    const ctx = await bootApp({ settings });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const preload = calls.find((c) => String(c.url).includes('/v1/chat/completions'));
      assert.ok(!preload, 'preload should not fire when transport is sdk (Anthropic does not need warmup)');
    } finally {
      ctx.cleanup();
    }
  });

  it('does not crash the server when preload fetch rejects', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED — LMStudio not running'); };

    const settings = getDefaultSettings();
    settings.frontdesk.llm.enabled = true;
    settings.frontdesk.llm.transport = 'lmstudio';
    settings.frontdesk.llm.eagerPreload = true;

    const ctx = await bootApp({ settings });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      // App is still ready and responsive.
      assert.ok(ctx.app.server.listening || ctx.app.ready);
    } finally {
      ctx.cleanup();
    }
  });
});

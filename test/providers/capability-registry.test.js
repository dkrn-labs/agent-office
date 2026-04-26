import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { discoverCapabilities } from '../../src/providers/capability-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(__dirname, '..', '..');

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'ao-cap-'));
  return {
    dataDir,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

function fakeDetector({ found = {}, version = {} } = {}) {
  return async (binary) => ({
    found: !!found[binary],
    path: found[binary] ?? null,
    version: version[binary] ?? null,
  });
}

describe('discoverCapabilities', () => {
  it('loads packaged defaults when no user file exists', async () => {
    const ctx = setup();
    try {
      const caps = await discoverCapabilities({
        dataDir: ctx.dataDir,
        packageDir: PACKAGE_DIR,
        detectBinary: fakeDetector(),
      });
      assert.equal(caps.schemaVersion, 1);
      assert.ok(caps.providers['claude-code']);
      assert.ok(caps.providers.codex);
      assert.ok(caps.providers['gemini-cli']);
      assert.ok(caps.providers.lmstudio);
      assert.equal(caps.providers['claude-code'].models[0].id, 'claude-opus-4-7');
    } finally {
      ctx.cleanup();
    }
  });

  it('annotates each provider with installed=true/false based on the detector', async () => {
    const ctx = setup();
    try {
      const caps = await discoverCapabilities({
        dataDir: ctx.dataDir,
        packageDir: PACKAGE_DIR,
        detectBinary: fakeDetector({
          found: { claude: '/usr/local/bin/claude', lms: '/opt/homebrew/bin/lms' },
          version: { claude: '4.7.1', lms: '0.3.2' },
        }),
      });
      assert.equal(caps.providers['claude-code'].installed, true);
      assert.equal(caps.providers['claude-code'].installedVersion, '4.7.1');
      assert.equal(caps.providers.lmstudio.installed, true);
      assert.equal(caps.providers.codex.installed, false);
      assert.equal(caps.providers['gemini-cli'].installed, false);
    } finally {
      ctx.cleanup();
    }
  });

  it('deep-merges user overrides on top of defaults', async () => {
    const ctx = setup();
    try {
      writeFileSync(join(ctx.dataDir, 'provider-capabilities.json'), JSON.stringify({
        providers: {
          lmstudio: {
            models: [{
              id: 'google/gemma-4-e4b',
              strengths: ['custom user-tweaked strength'],
            }],
          },
        },
      }));
      const caps = await discoverCapabilities({
        dataDir: ctx.dataDir,
        packageDir: PACKAGE_DIR,
        detectBinary: fakeDetector(),
      });
      assert.equal(caps.providers.lmstudio.models[0].strengths[0], 'custom user-tweaked strength');
      // Defaults preserved for other providers.
      assert.equal(caps.providers['claude-code'].models[0].id, 'claude-opus-4-7');
    } finally {
      ctx.cleanup();
    }
  });

  it('persists the merged snapshot back to the user file', async () => {
    const ctx = setup();
    try {
      await discoverCapabilities({
        dataDir: ctx.dataDir,
        packageDir: PACKAGE_DIR,
        detectBinary: fakeDetector(),
      });
      const userPath = join(ctx.dataDir, 'provider-capabilities.json');
      assert.ok(existsSync(userPath));
      const written = JSON.parse(readFileSync(userPath, 'utf8'));
      assert.equal(written.schemaVersion, 1);
      assert.ok(written.providers['claude-code']);
    } finally {
      ctx.cleanup();
    }
  });

  it('warns when lastVerifiedAt is older than 14 days', async () => {
    const ctx = setup();
    const original = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      writeFileSync(join(ctx.dataDir, 'provider-capabilities.json'), JSON.stringify({
        lastVerifiedAt: '2025-01-01T00:00:00Z',
      }));
      await discoverCapabilities({
        dataDir: ctx.dataDir,
        packageDir: PACKAGE_DIR,
        detectBinary: fakeDetector(),
      });
      assert.ok(warnings.some((w) => w.includes('verified') && w.includes('day')),
        `expected stale-warning, got: ${warnings.join(' | ')}`);
    } finally {
      console.warn = original;
      ctx.cleanup();
    }
  });

  it('does not emit stale-warning when defaults are recent', async () => {
    const ctx = setup();
    const original = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      // No user file → uses packaged defaults whose lastVerifiedAt is fresh.
      await discoverCapabilities({
        dataDir: ctx.dataDir,
        packageDir: PACKAGE_DIR,
        detectBinary: fakeDetector(),
      });
      assert.ok(!warnings.some((w) => w.includes('verified')),
        `unexpected stale-warning: ${warnings.join(' | ')}`);
    } finally {
      console.warn = original;
      ctx.cleanup();
    }
  });
});

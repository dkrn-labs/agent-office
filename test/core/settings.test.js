import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getDefaultSettings,
  loadSettings,
  saveSettings,
  enabledProviderIds,
} from '../../src/core/settings.js';

describe('settings.json (P1-11)', () => {
  it('returns defaults when the file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-settings-'));
    try {
      const s = loadSettings(dir);
      assert.equal(s.core.port, 3334);
      assert.equal(s.user.dailyDollarCap, null);
      assert.equal(s.frontdesk.llm.enabled, false);
      assert.equal(s.providers['claude-code'].enabled, true);
      assert.equal(s.providers.codex.enabled, true);
      assert.equal(s.providers['gemini-cli'].enabled, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deep-merges file overrides onto defaults (other keys preserved)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-settings-'));
    try {
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({
        core: { port: 4444 },
        providers: { codex: { enabled: false } },
      }));
      const s = loadSettings(dir);
      assert.equal(s.core.port, 4444);
      assert.equal(s.providers.codex.enabled, false);
      // Defaults preserved for keys the file doesn't mention.
      assert.equal(s.providers['claude-code'].enabled, true);
      assert.equal(s.providers['gemini-cli'].enabled, true);
      assert.equal(s.frontdesk.llm.enabled, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to defaults on a malformed settings file (does not throw)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-settings-'));
    try {
      writeFileSync(join(dir, 'settings.json'), '{ this is not json');
      const s = loadSettings(dir);
      assert.equal(s.core.port, 3334);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('saveSettings round-trips', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-settings-'));
    try {
      const original = getDefaultSettings();
      original.user.dailyDollarCap = 12.5;
      original.frontdesk.llm.enabled = true;
      saveSettings(original, dir);
      const reloaded = loadSettings(dir);
      assert.equal(reloaded.user.dailyDollarCap, 12.5);
      assert.equal(reloaded.frontdesk.llm.enabled, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enabledProviderIds filters by providers[id].enabled', () => {
    const s = getDefaultSettings();
    s.providers.codex.enabled = false;
    const ids = enabledProviderIds(s);
    assert.equal(ids.has('claude-code'), true);
    assert.equal(ids.has('codex'), false);
    assert.equal(ids.has('gemini-cli'), true);
  });
});

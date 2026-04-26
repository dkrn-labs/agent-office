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
      assert.equal(s.frontdesk.llm.model, 'claude-haiku-4-5');
      assert.equal(s.frontdesk.llm.transport, 'lmstudio');
      assert.equal(s.frontdesk.llm.lmstudio.model, 'google/gemma-4-e4b');
      assert.equal(s.frontdesk.llm.lmstudio.host, 'http://localhost:1234');
      assert.equal(s.frontdesk.llm.lmstudio.contextLength, 8192);
      assert.equal(s.frontdesk.llm.eagerPreload, true);
      assert.equal(s.providers['claude-code'].enabled, true);
      assert.equal(s.providers.codex.enabled, true);
      assert.equal(s.providers['gemini-cli'].enabled, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves frontdesk.llm.model when the file overrides only enabled (P2-4)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao-settings-'));
    try {
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({
        frontdesk: { llm: { enabled: true } },
      }));
      const s = loadSettings(dir);
      assert.equal(s.frontdesk.llm.enabled, true);
      assert.equal(s.frontdesk.llm.model, 'claude-haiku-4-5');
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

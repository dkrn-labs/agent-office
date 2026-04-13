import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { getDefault, loadConfig, saveConfig } from '../../src/core/config.js';

describe('config', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'agent-office-config-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getDefault()', () => {
    it('returns version 1', () => {
      assert.equal(getDefault().version, 1);
    });

    it('returns projectsDir based on os.homedir()', () => {
      assert.equal(getDefault().projectsDir, join(os.homedir(), 'Projects'));
    });

    it('returns port 3333', () => {
      assert.equal(getDefault().port, 3333);
    });

    it('returns expected garden sub-keys', () => {
      const { garden } = getDefault();
      assert.equal(garden.memorySchedule, '0 2 * * 0');
      assert.equal(garden.claudeMdSchedule, '0 3 * * 0');
      assert.equal(garden.defaultMaxTokens, 200000);
      assert.equal(garden.requireApproval, true);
    });

    it('returns empty personaPrompts', () => {
      assert.deepEqual(getDefault().personaPrompts, {});
    });
  });

  describe('loadConfig()', () => {
    it('returns defaults when no file exists', () => {
      const emptyDir = mkdtempSync(join(os.tmpdir(), 'agent-office-nofile-'));
      try {
        const config = loadConfig(emptyDir);
        assert.deepEqual(config, getDefault());
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('save then load roundtrip preserves all values', () => {
      const config = getDefault();
      config.port = 4444;
      config.personaPrompts = { engineer: 'Be concise.' };
      saveConfig(config, tmpDir);

      const loaded = loadConfig(tmpDir);
      assert.equal(loaded.port, 4444);
      assert.deepEqual(loaded.personaPrompts, { engineer: 'Be concise.' });
      assert.equal(loaded.version, 1);
      assert.equal(loaded.garden.defaultMaxTokens, 200000);
    });

    it('merges garden overrides with defaults', () => {
      const partialDir = mkdtempSync(join(os.tmpdir(), 'agent-office-partial-'));
      try {
        saveConfig({ garden: { requireApproval: false } }, partialDir);
        const loaded = loadConfig(partialDir);
        assert.equal(loaded.garden.requireApproval, false);
        // other garden keys come from defaults
        assert.equal(loaded.garden.defaultMaxTokens, 200000);
      } finally {
        rmSync(partialDir, { recursive: true, force: true });
      }
    });
  });

  describe('saveConfig()', () => {
    it('creates nested directories if they do not exist', () => {
      const deepDir = join(tmpDir, 'a', 'b', 'c');
      assert.equal(existsSync(deepDir), false);
      saveConfig(getDefault(), deepDir);
      assert.equal(existsSync(join(deepDir, 'config.json')), true);
    });

    it('writes valid JSON', () => {
      const outDir = mkdtempSync(join(os.tmpdir(), 'agent-office-json-'));
      try {
        const config = getDefault();
        saveConfig(config, outDir);
        const raw = readFileSync(join(outDir, 'config.json'), 'utf8');
        assert.doesNotThrow(() => JSON.parse(raw));
        assert.deepEqual(JSON.parse(raw), config);
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    });
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');
const Database = require('better-sqlite3');

const CLI = new URL('../bin/agent-office.js', import.meta.url).pathname;

/** Run the CLI with the given args; returns trimmed stdout. */
function run(args, opts = {}) {
  return execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env },
    ...opts,
  }).trim();
}

describe('agent-office CLI', () => {
  // ── --version ──────────────────────────────────────────────────────────────

  it('--version prints the package version', () => {
    const out = run(['--version']);
    assert.equal(out, version);
  });

  // ── --help ─────────────────────────────────────────────────────────────────

  it('--help shows usage with init, start, and doctor commands', () => {
    const out = run(['--help']);
    assert.match(out, /init/);
    assert.match(out, /start/);
    assert.match(out, /doctor/);
    assert.match(out, /Usage/i);
  });

  // ── init ───────────────────────────────────────────────────────────────────

  describe('init command', () => {
    let tmpDir;

    before(() => {
      tmpDir = mkdtempSync(join(os.tmpdir(), 'agent-office-cli-test-'));
    });

    after(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates config.json and agent-office.db in the specified data dir', () => {
      const dataDir = join(tmpDir, 'data');

      run(['init', '--data-dir', dataDir, '--projects-dir', tmpDir]);

      const configPath = join(dataDir, 'config.json');
      const dbPath = join(dataDir, 'agent-office.db');

      assert.ok(existsSync(configPath), `config.json not found at ${configPath}`);
      assert.ok(existsSync(dbPath), `agent-office.db not found at ${dbPath}`);
    });

    it('config.json contains the overridden projectsDir', () => {
      const dataDir = join(tmpDir, 'data2');

      run(['init', '--data-dir', dataDir, '--projects-dir', tmpDir]);

      const configPath = join(dataDir, 'config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      assert.equal(config.projectsDir, tmpDir);
    });

    it('init seeds built-in personas into the database', () => {
      const dataDir = join(tmpDir, 'data3');

      run(['init', '--data-dir', dataDir, '--projects-dir', tmpDir]);

      const dbPath = join(dataDir, 'agent-office.db');
      const db = new Database(dbPath, { readonly: true });
      const { count } = db.prepare('SELECT COUNT(*) AS count FROM persona').get();
      db.close();

      assert.ok(count > 0, `Expected at least 1 persona in DB, got ${count}`);
    });
  });

  describe('doctor command', () => {
    let tmpDir;

    before(() => {
      tmpDir = mkdtempSync(join(os.tmpdir(), 'agent-office-doctor-test-'));
    });

    after(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('reports missing init state and exits non-zero when config is absent', () => {
      let stdout = '';
      let status = 0;
      try {
        stdout = run(['doctor', '--data-dir', tmpDir]);
      } catch (err) {
        stdout = err.stdout?.toString?.() ?? '';
        status = err.status ?? 1;
      }

      assert.notEqual(status, 0);
      assert.match(stdout, /agent-office doctor/);
      assert.match(stdout, /Config initialized/);
      assert.match(stdout, /Next step: run 'agent-office init/);
    });
  });
});

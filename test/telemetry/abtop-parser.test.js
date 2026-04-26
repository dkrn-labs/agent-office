import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAbtopOutput, redactSecrets } from '../../src/telemetry/abtop-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixDir = path.join(__dirname, '..', 'fixtures', 'abtop');
const read = (name) => fs.readFileSync(path.join(fixDir, name), 'utf8');

describe('redactSecrets', () => {
  it('redacts Stripe sk_test_/sk_live_ keys', () => {
    // Build the test inputs at runtime so the literal `sk_test_<token>`
    // shape never appears in source — GitHub's secret scanner false-
    // positives on string literals that match the Stripe key pattern.
    const fakeTestKey = 'sk_' + 'test_' + 'X'.repeat(24);
    const fakeLiveKey = 'sk_' + 'live_' + 'Y'.repeat(24);
    assert.equal(redactSecrets(`--api-key=${fakeTestKey}`), '--api-key=sk_test_REDACTED');
    assert.match(redactSecrets(`foo ${fakeLiveKey} bar`), /sk_live_REDACTED/);
  });

  it('redacts AWS access keys', () => {
    assert.match(redactSecrets('AKIAIOSFODNN7EXAMPLE'), /AKIA_REDACTED/);
  });

  it('redacts GitHub tokens (ghp_, ghs_)', () => {
    assert.match(redactSecrets('GITHUB_TOKEN=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1234'), /ghp_REDACTED/);
    assert.match(redactSecrets('ghs_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB5678'), /ghs_REDACTED/);
  });

  it('redacts Anthropic + OpenAI keys', () => {
    assert.match(redactSecrets('sk-ant-api03-AAAA1234567890BBBBCCCC'), /sk-ant-REDACTED/);
    assert.match(redactSecrets('sk-proj-OOOOPPPPQQQQRRRRSSSS'), /sk-(proj|openai)-REDACTED/);
  });

  it('passes through innocuous strings unchanged', () => {
    const s = 'just a normal --flag value with no secrets at all';
    assert.equal(redactSecrets(s), s);
  });
});

describe('parseAbtopOutput', () => {
  it('parses an empty snapshot', () => {
    const out = parseAbtopOutput(read('empty.txt'));
    assert.deepEqual(out.sessions, []);
    assert.equal(out.totalSessions, 0);
  });

  it('parses two-session fixture into structured sessions', () => {
    const out = parseAbtopOutput(read('two-sessions.txt'));
    assert.equal(out.totalSessions, 2);
    assert.equal(out.sessions.length, 2);

    const a = out.sessions[0];
    assert.equal(a.pid, 54601);
    assert.equal(a.projectName, 'agent-office');
    assert.equal(a.projectId, '90288a9');
    assert.equal(a.status, 'wait');
    assert.equal(a.model, 'opus-4-7');
    assert.equal(a.ctxPct, 0.02);
    assert.equal(a.tokensTotal, 222_200_000);
    assert.equal(a.memMB, 498);
    assert.ok(a.wallTimeSec > 6 * 3600);
    assert.match(a.currentTask, /no response/);
    assert.match(a.lastAction, /Bash mkdir/);
    assert.ok(Array.isArray(a.children));
    assert.ok(a.children.length > 0);
    const b = out.sessions[1];
    assert.equal(b.pid, 29026);
    assert.equal(b.projectName, 'lens');
    assert.equal(b.projectId, '48aa072');
    assert.match(b.currentTask, /Check Pending Pull Requests/);
  });

  it('redacts secrets that appear in child-process command lines', () => {
    const out = parseAbtopOutput(read('two-sessions.txt'));
    const flat = JSON.stringify(out);
    // The fixture contains a fake stripe key with FAKEFAKE filler — the
    // parser must redact the entire token, leaving only the prefix.
    assert.ok(!flat.includes('FAKEFAKEFAKE'), 'parser must redact stripe key body');
    assert.match(flat, /sk_test_REDACTED/);
  });

  it('parses the rate-limited fixture and exposes the indicator', () => {
    const out = parseAbtopOutput(read('rate-limited.txt'));
    assert.equal(out.sessions.length, 1);
    const s = out.sessions[0];
    assert.equal(s.status, 'rate-limited');
    assert.match(s.lastAction, /resets in 14m/);
    assert.equal(s.ctxPct, 0.88);
  });

  it('degrades on garbage input — returns empty, no throw', () => {
    const out = parseAbtopOutput('this is not abtop output at all');
    assert.deepEqual(out.sessions, []);
  });
});

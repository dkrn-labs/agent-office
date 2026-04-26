import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { runLmstudio } from '../../src/frontdesk/transport-lmstudio.js';

function fakeCandidates() {
  return {
    personas: [{ id: 1, label: 'Backend' }, { id: 2, label: 'Debug' }],
    providers: [{ id: 'claude-code', kind: 'cloud' }, { id: 'lmstudio', kind: 'local' }],
    constraints: { mustBeLocal: false },
    rulesApplied: ['B'],
  };
}

function fakeState() {
  return {
    personas: [
      { id: 1, label: 'Backend', domain: 'backend', secondaryDomains: [] },
      { id: 2, label: 'Debug', domain: 'debug', secondaryDomains: [] },
    ],
    skills: [{ id: 'tdd', label: 'TDD', description: 'Test-driven' }],
    activeSessions: [],
    prefs: {},
  };
}

function makeFetch(response) {
  return async (url, opts) => ({
    ok: typeof response === 'string' || response.ok !== false,
    status: response.status ?? 200,
    json: async () => typeof response === 'string'
      ? { choices: [{ message: { content: response } }] }
      : response,
    text: async () => typeof response === 'string' ? response : JSON.stringify(response),
  });
}

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

describe('runLmstudio — happy path', () => {
  it('returns a parsed proposal with meta.transport=lmstudio', async () => {
    const valid = {
      persona: 'Debug',
      provider: 'claude-code',
      model: 'claude-opus-4-7',
      taskType: 'iterative',
      estimatedDuration: '5-30min',
      complexity: 6,
      history_picks: [],
      skills_picks: ['tdd'],
      reasoning: 'Bug verbs → Debug.',
      fallback_if_blocked: null,
    };
    globalThis.fetch = makeFetch({
      choices: [{ message: { content: JSON.stringify(valid) } }],
      usage: { prompt_tokens: 600, completion_tokens: 100 },
    });

    const out = await runLmstudio({
      host: 'http://localhost:1234',
      model: 'google/gemma-4-e4b',
      state: fakeState(),
      task: 'fix login crash',
      candidates: fakeCandidates(),
    });

    assert.equal(out.meta.fallback, null);
    assert.equal(out.meta.transport, 'lmstudio');
    assert.equal(out.proposal.persona, 'Debug');
  });
});

describe('runLmstudio — schema fallback', () => {
  it('falls back when JSON is malformed', async () => {
    globalThis.fetch = makeFetch({
      choices: [{ message: { content: 'not json {{{' } }],
    });
    const out = await runLmstudio({
      host: 'http://localhost:1234',
      model: 'google/gemma-4-e4b',
      state: fakeState(),
      task: 'task',
      candidates: fakeCandidates(),
    });
    assert.equal(out.meta.fallback, 'schema');
    assert.equal(out.meta.transport, 'lmstudio');
    assert.equal(out.proposal.persona, 'Backend');
  });

  it('falls back when JSON parses but fails Zod validation', async () => {
    globalThis.fetch = makeFetch({
      choices: [{ message: { content: JSON.stringify({ persona: 'Backend', provider: 'claude-code' }) } }],
    });
    const out = await runLmstudio({
      host: 'http://localhost:1234',
      model: 'google/gemma-4-e4b',
      state: fakeState(),
      task: 'task',
      candidates: fakeCandidates(),
    });
    assert.equal(out.meta.fallback, 'schema');
    assert.equal(out.proposal.persona, 'Backend');
  });
});

describe('runLmstudio — error fallback', () => {
  it('returns error fallback on fetch rejection without throwing', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const out = await runLmstudio({
      host: 'http://localhost:1234',
      model: 'google/gemma-4-e4b',
      state: fakeState(),
      task: 'task',
      candidates: fakeCandidates(),
    });
    assert.equal(out.meta.fallback, 'error');
    assert.equal(out.meta.transport, 'lmstudio');
    assert.match(out.meta.errorMessage, /ECONNREFUSED/);
    assert.equal(out.proposal.persona, 'Backend');
  });

  it('returns error fallback on non-OK HTTP status', async () => {
    globalThis.fetch = makeFetch({ ok: false, status: 503, error: 'service unavailable' });
    const out = await runLmstudio({
      host: 'http://localhost:1234',
      model: 'google/gemma-4-e4b',
      state: fakeState(),
      task: 'task',
      candidates: fakeCandidates(),
    });
    assert.equal(out.meta.fallback, 'error');
    assert.match(out.meta.errorMessage, /503/);
  });
});

describe('runLmstudio — request shape', () => {
  it('hits /v1/chat/completions with json_schema response_format and temperature 0', async () => {
    let captured = null;
    globalThis.fetch = async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            persona: 'Backend', provider: 'claude-code', model: 'm',
            taskType: 'oneshot', estimatedDuration: '<5min', complexity: 1,
            history_picks: [], skills_picks: [], reasoning: 'r',
          }) } }],
        }),
        text: async () => '',
      };
    };

    await runLmstudio({
      host: 'http://localhost:1234',
      model: 'google/gemma-4-e4b',
      state: fakeState(),
      task: 'TEST_TASK_MARKER_xyz',
      candidates: fakeCandidates(),
    });

    assert.match(captured.url, /\/v1\/chat\/completions$/);
    const body = JSON.parse(captured.opts.body);
    assert.equal(body.model, 'google/gemma-4-e4b');
    assert.equal(body.temperature, 0);
    assert.equal(body.response_format.type, 'json_schema');
    assert.ok(body.response_format.json_schema?.schema?.required?.includes('persona'));
    // System block must be present (even flattened) — task TEXT must
    // live in the user turn so the prefix stays cacheable.
    assert.ok(body.messages[0].role === 'system');
    assert.ok(!body.messages[0].content.includes('TEST_TASK_MARKER_xyz'));
    assert.ok(body.messages[1].content.includes('TEST_TASK_MARKER_xyz'));
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runLLM } from '../../src/frontdesk/llm.js';

function fakeCandidates() {
  return {
    personas: [{ id: 1, label: 'Backend' }, { id: 2, label: 'Debug' }],
    providers: [{ id: 'claude-code', kind: 'cloud' }],
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

function clientReturning(payload) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
        usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 80 },
      }),
    },
  };
}

function clientThrowing(err) {
  return {
    messages: {
      create: async () => { throw err; },
    },
  };
}

describe('runLLM — happy path', () => {
  it('returns the parsed proposal when the schema validates', async () => {
    const valid = {
      persona: 'Debug',
      provider: 'claude-code',
      model: 'claude-opus-4-7',
      taskType: 'iterative',
      estimatedDuration: '5-30min',
      complexity: 6,
      history_picks: [],
      skills_picks: ['tdd'],
      reasoning: 'Bug language → Debug persona; complexity warrants Opus.',
      fallback_if_blocked: null,
    };

    const out = await runLLM({
      client: clientReturning(valid),
      model: 'claude-haiku-4-5',
      state: fakeState(),
      task: 'fix login crash',
      candidates: fakeCandidates(),
    });

    assert.equal(out.meta.fallback, null);
    assert.equal(out.meta.usedLLM, true);
    assert.equal(out.proposal.persona, 'Debug');
    assert.equal(out.proposal.reasoning, valid.reasoning);
  });
});

describe('runLLM — schema fallback', () => {
  it('returns rules-only fallback when the JSON is malformed', async () => {
    const out = await runLLM({
      client: clientReturning('not json {{{'),
      model: 'claude-haiku-4-5',
      state: fakeState(),
      task: 'fix login crash',
      candidates: fakeCandidates(),
    });
    assert.equal(out.meta.fallback, 'schema');
    assert.equal(out.meta.usedLLM, true);
    assert.equal(out.proposal.persona, 'Backend'); // first candidate
    assert.equal(out.proposal.provider, 'claude-code');
    assert.match(out.proposal.reasoning, /fallback/i);
  });

  it('returns rules-only fallback when JSON parses but fails Zod validation', async () => {
    const invalid = {
      persona: 'Backend',
      provider: 'claude-code',
      // missing required fields (model, taskType, etc.)
    };
    const out = await runLLM({
      client: clientReturning(invalid),
      model: 'claude-haiku-4-5',
      state: fakeState(),
      task: 'task',
      candidates: fakeCandidates(),
    });
    assert.equal(out.meta.fallback, 'schema');
    assert.equal(out.proposal.persona, 'Backend');
  });
});

describe('runLLM — error fallback', () => {
  it('returns rules-only fallback on SDK/network errors without throwing', async () => {
    const out = await runLLM({
      client: clientThrowing(new Error('network down')),
      model: 'claude-haiku-4-5',
      state: fakeState(),
      task: 'fix login crash',
      candidates: fakeCandidates(),
    });
    assert.equal(out.meta.fallback, 'error');
    assert.equal(out.meta.errorMessage, 'network down');
    assert.equal(out.proposal.persona, 'Backend');
  });

  it('falls back when candidates are empty (cannot pick anything)', async () => {
    const out = await runLLM({
      client: clientReturning({ persona: 'Whatever' }),
      model: 'claude-haiku-4-5',
      state: fakeState(),
      task: 'task',
      candidates: { personas: [], providers: [], constraints: {}, rulesApplied: [] },
    });
    // Either schema fallback (because persona isn't in candidates) or empty
    // proposal — both acceptable, but we must not throw.
    assert.ok(out.meta.fallback);
    assert.ok(out.proposal);
  });
});

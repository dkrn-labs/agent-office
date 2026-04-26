import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt } from '../../src/frontdesk/prompt.js';

function fixtureState() {
  return {
    personas: [
      { id: 1, label: 'Backend', domain: 'backend', secondaryDomains: ['api'], systemPromptTemplate: 'You write backend code.' },
      { id: 2, label: 'Debug',   domain: 'debug',   secondaryDomains: [],      systemPromptTemplate: 'You hunt bugs.' },
    ],
    skills: [
      { id: 'tdd',     label: 'TDD',     description: 'Test-driven development discipline' },
      { id: 'systematic-debug', label: 'Systematic debug', description: 'Methodical bug investigation' },
    ],
    activeSessions: [],
    prefs: { privacyMode: 'open' },
  };
}

function fixtureCandidates() {
  return {
    personas: [{ id: 2, label: 'Debug' }, { id: 1, label: 'Backend' }],
    providers: [{ id: 'claude-code', kind: 'cloud' }],
    constraints: { mustBeLocal: false },
    rulesApplied: ['R8', 'B'],
  };
}

describe('frontdesk prompt builder', () => {
  it('returns { system, messages } with cache_control on the static blocks', () => {
    const out = buildPrompt({
      state: fixtureState(),
      task: 'fix the auth crash on login',
      candidates: fixtureCandidates(),
    });

    assert.ok(Array.isArray(out.system), 'system must be an array of blocks for cache_control');
    assert.ok(out.system.length >= 4, 'expected at least: system, persona catalog, skill catalog, rule summary');

    // The last static block must carry cache_control: ephemeral so the
    // Anthropic SDK caches the prefix.
    const cached = out.system.filter((b) => b.cache_control?.type === 'ephemeral');
    assert.ok(cached.length >= 1, 'at least one block must be cache-marked');

    // messages: a single user turn with the dynamic suffix.
    assert.equal(out.messages.length, 1);
    assert.equal(out.messages[0].role, 'user');
    assert.match(JSON.stringify(out.messages[0].content), /fix the auth crash on login/);
  });

  it('persona catalog block lists every persona with its domain', () => {
    const out = buildPrompt({
      state: fixtureState(),
      task: 't',
      candidates: fixtureCandidates(),
    });
    const flat = JSON.stringify(out.system);
    assert.match(flat, /Backend/);
    assert.match(flat, /Debug/);
    assert.match(flat, /backend/);
    assert.match(flat, /debug/);
  });

  it('skill catalog block lists every skill id and description', () => {
    const out = buildPrompt({
      state: fixtureState(),
      task: 't',
      candidates: fixtureCandidates(),
    });
    const flat = JSON.stringify(out.system);
    assert.match(flat, /tdd/);
    assert.match(flat, /Test-driven development/);
    assert.match(flat, /systematic-debug/);
  });

  it('rule chain summary names every rule id from the candidates trace', () => {
    const out = buildPrompt({
      state: fixtureState(),
      task: 't',
      candidates: fixtureCandidates(),
    });
    const flat = JSON.stringify(out.system);
    assert.match(flat, /R8/);
    assert.match(flat, /B\b/);
  });

  it('dynamic suffix carries the task text and rule trace, system block does not embed the task', () => {
    const out = buildPrompt({
      state: fixtureState(),
      task: 'refactor history store',
      candidates: fixtureCandidates(),
    });
    const sysFlat = JSON.stringify(out.system);
    const userFlat = JSON.stringify(out.messages[0].content);

    // Task text must live in the user turn so the system prefix stays cacheable.
    assert.ok(!sysFlat.includes('refactor history store'), 'task text must not bleed into the cached system prefix');
    assert.match(userFlat, /refactor history store/);
    assert.match(userFlat, /R8/);
  });

  it('does not leak environment variables or API keys', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-DO-NOT-LEAK';
    try {
      const out = buildPrompt({
        state: fixtureState(),
        task: 'test',
        candidates: fixtureCandidates(),
      });
      const flat = JSON.stringify(out);
      assert.ok(!flat.includes('sk-test-DO-NOT-LEAK'), 'prompt must not include process.env values');
      assert.ok(!flat.includes('ANTHROPIC_API_KEY'), 'prompt must not name secret env vars');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('tolerates an empty rule trace and an empty skill catalog', () => {
    const state = { ...fixtureState(), skills: [] };
    const candidates = { ...fixtureCandidates(), rulesApplied: [] };
    const out = buildPrompt({ state, task: 't', candidates });
    assert.ok(out.system.length >= 3);
    assert.equal(out.messages.length, 1);
  });
});

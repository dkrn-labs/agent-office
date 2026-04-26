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
    // P2 Task 13 — system / persona / skill / provider / rule summary = 5 blocks.
    assert.ok(out.system.length >= 5, 'expected at least: system, persona catalog, skill catalog, provider catalog, rule summary');

    // The last static block must carry cache_control: ephemeral so the
    // Anthropic SDK caches the prefix.
    const cached = out.system.filter((b) => b.cache_control?.type === 'ephemeral');
    assert.ok(cached.length >= 1, 'at least one block must be cache-marked');

    // messages: a single user turn with the dynamic suffix.
    assert.equal(out.messages.length, 1);
    assert.equal(out.messages[0].role, 'user');
    assert.match(JSON.stringify(out.messages[0].content), /fix the auth crash on login/);
  });

  it('renders enriched provider blocks when providerCapabilities is supplied (P2 Task 13)', () => {
    const providerCapabilities = {
      providers: {
        'claude-code': {
          label: 'Claude Code',
          kind: 'cloud',
          installed: true,
          models: [{
            id: 'claude-opus-4-7',
            default: true,
            costTier: '$$$',
            strengths: ['multi-file refactors', 'concurrency bugs'],
            weaknesses: ['highest cost'],
          }],
        },
        lmstudio: {
          label: 'Local',
          kind: 'local',
          installed: true,
          models: [{
            id: 'google/gemma-4-e4b',
            default: true,
            costTier: 'free',
            strengths: ['mechanical edits', 'commits'],
          }],
        },
      },
    };
    const out = buildPrompt({
      state: { ...fixtureState(), providerCapabilities },
      task: 'rename foo to bar',
      candidates: {
        ...fixtureCandidates(),
        providers: [
          { id: 'claude-code', kind: 'cloud' },
          { id: 'lmstudio', kind: 'local' },
        ],
      },
    });
    const flat = JSON.stringify(out.system);
    assert.match(flat, /multi-file refactors/);
    assert.match(flat, /mechanical edits/);
    assert.match(flat, /costTier=\$\$\$/);
    assert.match(flat, /costTier=free/);
    assert.match(flat, /installed/);
  });

  it('emits the vendor-selection criteria block in the system prompt', () => {
    const out = buildPrompt({
      state: fixtureState(),
      task: 't',
      candidates: fixtureCandidates(),
    });
    const sys = JSON.stringify(out.system);
    assert.match(sys, /Vendor selection criteria/i);
    assert.match(sys, /local/i);
    assert.match(sys, /costTier/i);
  });

  it('falls back to a minimal provider listing when capabilities are missing (back-compat)', () => {
    const out = buildPrompt({
      state: fixtureState(),         // no providerCapabilities
      task: 't',
      candidates: fixtureCandidates(),
    });
    // Block exists but doesn't fail when there's no registry data.
    const flat = JSON.stringify(out.system);
    assert.match(flat, /Provider catalog/);
    assert.match(flat, /claude-code/);
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

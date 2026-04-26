import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runRules } from '../../src/frontdesk/runner.js';

function baseState(overrides = {}) {
  return {
    personas: [],
    projects: [],
    activeSessions: [],
    skills: [],
    prefs: {},
    signals: {},
    ...overrides,
  };
}

function baseCandidates(overrides = {}) {
  return {
    personas: [
      { id: 1, label: 'Backend', domain: 'backend', secondaryDomains: [] },
      { id: 2, label: 'Debug',   domain: 'debug',   secondaryDomains: [] },
      { id: 3, label: 'Frontend', domain: 'frontend', secondaryDomains: [] },
    ],
    providers: [
      { id: 'claude-code', kind: 'cloud', model: 'claude-opus-4-7' },
      { id: 'ollama-aider', kind: 'local', model: 'llama3.1:70b' },
    ],
    history: [],
    constraints: {},
    rulesApplied: [],
    ...overrides,
  };
}

describe('R9 — debug-verb bias', () => {
  it('puts the debug persona first when the task contains debug verbs', () => {
    const out = runRules(baseState(), 'fix the login crash', baseCandidates());
    assert.equal(out.personas[0].label, 'Debug');
    assert.ok(out.rulesApplied.includes('R9') || out.rulesApplied.some((id) => id.startsWith('B-debug')));
  });

  it('does not reorder when the task has no debug verbs', () => {
    const out = runRules(baseState(), 'add a navbar component', baseCandidates());
    assert.equal(out.personas[0].label, 'Backend'); // original order preserved
  });
});

describe('R10 — short mechanical task → oneshot tag, prefer cheap/local', () => {
  it('tags taskType=oneshot for short rename/format/comment tasks', () => {
    const out = runRules(baseState(), 'rename foo to bar', baseCandidates());
    assert.equal(out.constraints?.taskType, 'oneshot');
    assert.ok(out.rulesApplied.includes('R10'));
  });

  it('does not tag oneshot for long tasks even with mechanical verbs', () => {
    const long = 'rename foo to bar across the entire codebase including all imports, tests, and documentation while preserving the public API and updating the changelog';
    const out = runRules(baseState(), long, baseCandidates());
    assert.notEqual(out.constraints?.taskType, 'oneshot');
  });
});

describe('R11 — long-running task tag', () => {
  it('tags taskType=long-running on "across the codebase" phrasing', () => {
    const out = runRules(baseState(), 'audit error handling across the codebase', baseCandidates());
    assert.equal(out.constraints?.taskType, 'long-running');
    assert.ok(out.rulesApplied.includes('R11'));
  });

  it('tags long-running on >500-char tasks', () => {
    const big = 'a'.repeat(520);
    const out = runRules(baseState(), big, baseCandidates());
    assert.equal(out.constraints?.taskType, 'long-running');
  });

  it('tags long-running on "refactor X to Y" pattern', () => {
    const out = runRules(baseState(), 'refactor the database layer to use drizzle', baseCandidates());
    assert.equal(out.constraints?.taskType, 'long-running');
  });
});

describe('R12 — cross-project cache penalty', () => {
  it('marks cacheMiss=true when prefs.currentProjectId differs from the task project', () => {
    const state = baseState({
      projects: [
        { id: 10, name: 'gridlands' },
        { id: 11, name: 'kasboek-ai' },
      ],
      prefs: { currentProjectId: 10 },
    });
    const out = runRules(state, 'add a flow to kasboek-ai', baseCandidates());
    assert.equal(out.constraints?.cacheMiss, true);
    assert.ok(out.rulesApplied.includes('R12'));
  });

  it('does nothing when prefs.currentProjectId is unset', () => {
    const out = runRules(baseState(), 'add a flow to kasboek-ai', baseCandidates());
    assert.notEqual(out.constraints?.cacheMiss, true);
    assert.ok(!out.rulesApplied.includes('R12'));
  });
});

describe('R15 — drop history candidates with score < 0.4', () => {
  it('removes low-score history entries from the candidate set', () => {
    const cands = baseCandidates({
      history: [
        { id: 1, score: 0.2, summary: 'old' },
        { id: 2, score: 0.7, summary: 'good' },
        { id: 3, score: 0.39, summary: 'borderline' },
      ],
    });
    const out = runRules(baseState(), 'task', cands);
    assert.deepEqual(out.history.map((h) => h.id), [2]);
    assert.ok(out.rulesApplied.includes('R15'));
  });

  it('is a no-op when all history scores meet the bar', () => {
    const cands = baseCandidates({
      history: [{ id: 1, score: 0.9 }, { id: 2, score: 0.5 }],
    });
    const out = runRules(baseState(), 'task', cands);
    assert.equal(out.history.length, 2);
    assert.ok(!out.rulesApplied.includes('R15'));
  });
});

describe('R16 — trim history when prefill > 12k tokens', () => {
  it('drops lowest-score entries until the total fits under the cap', () => {
    const cands = baseCandidates({
      history: [
        { id: 1, score: 0.9, tokens: 6000 },
        { id: 2, score: 0.6, tokens: 5000 },
        { id: 3, score: 0.5, tokens: 4000 },
        { id: 4, score: 0.45, tokens: 3000 },
      ],
    });
    const out = runRules(baseState(), 'task', cands);
    const total = out.history.reduce((acc, h) => acc + (h.tokens ?? 0), 0);
    assert.ok(total <= 12000, `expected total ≤ 12000, got ${total}`);
    // Highest-score entry must survive the trim.
    assert.ok(out.history.some((h) => h.id === 1));
    assert.ok(out.rulesApplied.includes('R16'));
  });

  it('does not touch history when the total is under the cap', () => {
    const cands = baseCandidates({
      history: [{ id: 1, score: 0.9, tokens: 4000 }, { id: 2, score: 0.6, tokens: 3000 }],
    });
    const out = runRules(baseState(), 'task', cands);
    assert.equal(out.history.length, 2);
    assert.ok(!out.rulesApplied.includes('R16'));
  });
});

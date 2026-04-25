import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  approxTokens,
  computeOptimized,
  computeBaseline,
  buildLaunchBudgetRow,
  rollupSavings,
} from '../../src/context-budget/index.js';

describe('approxTokens', () => {
  it('returns 0 for empty / null / undefined', () => {
    assert.equal(approxTokens(''), 0);
    assert.equal(approxTokens(null), 0);
    assert.equal(approxTokens(undefined), 0);
  });

  it('rounds chars/4 up', () => {
    assert.equal(approxTokens('abcd'), 1);
    assert.equal(approxTokens('abcde'), 2);
    assert.equal(approxTokens('a'.repeat(100)), 25);
  });
});

describe('computeOptimized + computeBaseline', () => {
  const sysPrompt = 'You are a debug specialist. Be concise.';

  const optimized = {
    systemPrompt: sysPrompt,
    skills: [{ body: 'systematic debugging skill body…'.repeat(10) }],
    personaObservations: [{ narrative: 'fixed gemini hook race' }],
    memories: [],
  };

  const baseline = {
    systemPrompt: sysPrompt,
    allSkills: [
      { body: 'systematic debugging skill body…'.repeat(10) },
      { body: 'tdd skill body'.repeat(50) },
      { body: 'irrelevant skill body'.repeat(40) },
    ],
    allObservations: Array.from({ length: 50 }, () => ({ narrative: 'lorem ipsum dolor sit amet'.repeat(2) })),
    allMemories: [{ body: 'project memory chunk' }, { body: 'another memory' }],
  };

  it('optimized totals match its inputs', () => {
    const r = computeOptimized(optimized);
    assert.ok(r.persona > 0);
    assert.ok(r.skills > 0);
    assert.ok(r.history > 0);
    assert.equal(r.memory, 0);
    assert.equal(r.total, r.persona + r.skills + r.history + r.memory);
  });

  it('baseline > optimized (the whole point)', () => {
    const opt = computeOptimized(optimized);
    const base = computeBaseline(baseline);
    assert.ok(base.total > opt.total, 'baseline must be larger than optimized');
  });

  it('handles empty inputs gracefully', () => {
    const r = computeOptimized({ systemPrompt: '' });
    assert.deepEqual(r, { persona: 0, skills: 0, history: 0, memory: 0, total: 0 });
  });
});

describe('buildLaunchBudgetRow', () => {
  it('produces the persistable row shape', () => {
    const row = buildLaunchBudgetRow({
      providerId: 'claude-code',
      model: 'sonnet',
      optimized: { systemPrompt: 'short', skills: [], personaObservations: [], memories: [] },
      baseline: { systemPrompt: 'short', allSkills: [{ body: 'x'.repeat(400) }], allObservations: [], allMemories: [] },
      cost: { dollars: 0.12 },
    });
    assert.equal(row.providerId, 'claude-code');
    assert.equal(row.model, 'sonnet');
    assert.ok(row.baselineTokens > row.optimizedTokens);
    assert.equal(row.costDollars, 0.12);
    assert.ok(row.optimizedBreakdown);
    assert.ok(row.baselineBreakdown);
  });
});

describe('rollupSavings', () => {
  const rows = [
    { baselineTokens: 30000, optimizedTokens: 8000, costDollars: 0.10, outcome: 'accepted' },
    { baselineTokens: 25000, optimizedTokens: 7000, costDollars: 0.08, outcome: 'partial' },
    { baselineTokens: 20000, optimizedTokens: 6000, costDollars: 0.05, outcome: 'rejected' }, // excluded
    { baselineTokens: 15000, optimizedTokens: 4000, costDollars: 0.04, outcome: null },        // included (no outcome yet)
  ];

  it('excludes rejected from credit', () => {
    const r = rollupSavings(rows);
    assert.equal(r.sessions, 3, 'rejected row excluded');
    assert.equal(r.baselineTokens, 30000 + 25000 + 15000);
    assert.equal(r.optimizedTokens, 8000 + 7000 + 4000);
  });

  it('savedTokens = baseline - optimized, savedPct rounded', () => {
    const r = rollupSavings(rows);
    assert.equal(r.savedTokens, r.baselineTokens - r.optimizedTokens);
    assert.equal(r.savedPct, Math.round((r.savedTokens / r.baselineTokens) * 100));
  });

  it('handles empty input', () => {
    const r = rollupSavings([]);
    assert.equal(r.sessions, 0);
    assert.equal(r.savedTokens, 0);
    assert.equal(r.savedPct, 0);
  });

  it('handles all-rejected input gracefully', () => {
    const r = rollupSavings([{ baselineTokens: 10, optimizedTokens: 5, outcome: 'rejected' }]);
    assert.equal(r.sessions, 0);
    assert.equal(r.savedPct, 0);
  });
});

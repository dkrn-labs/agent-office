import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildFewShotBlock, FEWSHOT_SOFT_TOKEN_CAP } from '../../src/frontdesk/few-shot.js';

function decision({ task, persona, provider, reasoning }) {
  return {
    taskHash: 'h',
    rulesApplied: ['R8'],
    llmInput: { task },
    llmOutput: { persona, provider, reasoning },
    outcome: 'accepted',
    createdAtEpoch: 1_700_000_000,
  };
}

describe('buildFewShotBlock', () => {
  it('returns empty string for empty input', () => {
    assert.equal(buildFewShotBlock([]), '');
    assert.equal(buildFewShotBlock(null), '');
  });

  it('renders the documented header + one section per decision', () => {
    const out = buildFewShotBlock([
      decision({ task: 'fix login crash', persona: 'Debug', provider: 'claude-code', reasoning: 'bug verbs → debug' }),
      decision({ task: 'rename foo to bar', persona: 'Backend', provider: 'lmstudio', reasoning: 'mechanical → local free' }),
    ]);
    assert.match(out, /^# Recent picks the operator accepted/m);
    assert.match(out, /Task: fix login crash/);
    assert.match(out, /Pick: persona=Debug, provider=claude-code/);
    assert.match(out, /Why: bug verbs → debug/);
    assert.match(out, /Task: rename foo to bar/);
    // Sections separated by --- so the LLM can see the boundary.
    assert.ok(out.split(/^---$/m).length >= 2);
  });

  it('truncates long task text at ~120 chars', () => {
    const long = 'a'.repeat(500);
    const out = buildFewShotBlock([
      decision({ task: long, persona: 'Backend', provider: 'claude-code', reasoning: 'r' }),
    ]);
    // The task line should not contain the full 500-char string.
    const taskLine = out.split('\n').find((l) => l.startsWith('Task:'));
    assert.ok(taskLine.length <= 200, `task line too long: ${taskLine.length}`);
  });

  it('truncates long reasoning at ~200 chars', () => {
    const long = 'r'.repeat(500);
    const out = buildFewShotBlock([
      decision({ task: 't', persona: 'Backend', provider: 'claude-code', reasoning: long }),
    ]);
    const whyLine = out.split('\n').find((l) => l.startsWith('Why:'));
    assert.ok(whyLine.length <= 280, `why line too long: ${whyLine.length}`);
  });

  it('drops decisions with malformed llmOutput rather than crashing', () => {
    const out = buildFewShotBlock([
      { llmInput: { task: 't1' }, llmOutput: null },
      decision({ task: 't2', persona: 'Backend', provider: 'codex', reasoning: 'r' }),
    ]);
    assert.match(out, /Task: t2/);
    assert.ok(!out.includes('Task: t1'));
  });

  it('respects the soft token cap (chars/4 estimate)', () => {
    const decisions = Array.from({ length: 50 }, (_, i) =>
      decision({ task: `task ${i} ${'x'.repeat(80)}`, persona: 'Backend', provider: 'codex', reasoning: 'r'.repeat(150) }));
    const out = buildFewShotBlock(decisions);
    assert.ok(out.length / 4 <= FEWSHOT_SOFT_TOKEN_CAP, `block estimate ${Math.ceil(out.length / 4)} tokens > ${FEWSHOT_SOFT_TOKEN_CAP} cap`);
  });
});

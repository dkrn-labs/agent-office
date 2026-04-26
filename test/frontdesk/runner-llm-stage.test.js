import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { route } from '../../src/frontdesk/runner.js';

function fakeRepo() {
  return {
    listPersonas: () => ([
      { id: 1, label: 'Backend', domain: 'backend', secondaryDomains: [] },
      { id: 2, label: 'Debug',   domain: 'debug',   secondaryDomains: [] },
    ]),
    listProjects: () => ([]),
    listSkills: () => ([]),
  };
}

describe('runner — LLM stage gating', () => {
  it('skips LLM when prefs.frontdesk.llm.enabled is false (default)', async () => {
    let llmCalled = false;
    let logCalled = false;

    const out = await route({
      repo: fakeRepo(),
      prefs: { frontdesk: { llm: { enabled: false } } },
      runLLM: async () => { llmCalled = true; return null; },
      decisionLog: { record: () => { logCalled = true; return 1; } },
    }, { task: 'fix login crash' });

    assert.equal(llmCalled, false);
    assert.equal(logCalled, false);
    assert.equal(out.meta?.stage ?? 'rules-only', 'rules-only');
    assert.ok(out.candidates);
  });

  it('runs LLM and logs the decision when enabled', async () => {
    let llmCalled = false;
    const recorded = [];

    const fakeProposal = {
      persona: 'Debug',
      provider: 'claude-code',
      model: 'claude-opus-4-7',
      taskType: 'iterative',
      estimatedDuration: '5-30min',
      complexity: 6,
      history_picks: [],
      skills_picks: [],
      reasoning: 'bug verbs → debug persona',
      fallback_if_blocked: null,
    };

    const out = await route({
      repo: fakeRepo(),
      prefs: { frontdesk: { llm: { enabled: true } } },
      runLLM: async ({ task, candidates }) => {
        llmCalled = true;
        return { proposal: fakeProposal, meta: { usedLLM: true, fallback: null } };
      },
      decisionLog: { record: (entry) => { recorded.push(entry); return recorded.length; } },
    }, { task: 'fix login crash' });

    assert.equal(llmCalled, true);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].task, 'fix login crash');
    assert.deepEqual(recorded[0].llmOutput, fakeProposal);
    assert.equal(out.meta?.stage, 'rules+llm');
    assert.equal(out.proposal.persona, 'Debug');
    assert.equal(out.proposal.reasoning, 'bug verbs → debug persona');
  });

  it('still logs the decision when LLM falls back to schema/error', async () => {
    const recorded = [];
    const fallbackProposal = {
      persona: 'Backend',
      provider: 'claude-code',
      model: '',
      taskType: 'iterative',
      estimatedDuration: '5-30min',
      complexity: 5,
      history_picks: [],
      skills_picks: [],
      reasoning: 'fallback',
      fallback_if_blocked: null,
    };
    const out = await route({
      repo: fakeRepo(),
      prefs: { frontdesk: { llm: { enabled: true } } },
      runLLM: async () => ({ proposal: fallbackProposal, meta: { usedLLM: true, fallback: 'schema' } }),
      decisionLog: { record: (entry) => { recorded.push(entry); return recorded.length; } },
    }, { task: 'task' });

    assert.equal(recorded.length, 1);
    assert.equal(out.meta.stage, 'rules+llm');
    assert.equal(out.meta.fallback, 'schema');
    assert.equal(out.proposal.persona, 'Backend');
  });

  it('survives a missing decisionLog (no-op log)', async () => {
    const out = await route({
      repo: fakeRepo(),
      prefs: { frontdesk: { llm: { enabled: true } } },
      runLLM: async () => ({
        proposal: { persona: 'Backend', provider: 'claude-code', model: '', taskType: 'oneshot', estimatedDuration: '<5min', complexity: 1, history_picks: [], skills_picks: [], reasoning: 'r' },
        meta: { usedLLM: true, fallback: null },
      }),
      // no decisionLog
    }, { task: 'rename foo to bar' });

    assert.equal(out.meta.stage, 'rules+llm');
  });
});

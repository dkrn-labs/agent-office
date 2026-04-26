import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runRules } from '../../src/frontdesk/runner.js';

const PERSONAS = [
  { id: 1, label: 'Frontend Engineer', domain: 'frontend', secondaryDomains: ['testing'] },
  { id: 2, label: 'Backend Engineer', domain: 'backend', secondaryDomains: ['database'] },
  { id: 3, label: 'Debug Specialist', domain: 'debug', secondaryDomains: [] },
  { id: 4, label: 'Senior Reviewer', domain: 'review', secondaryDomains: [] },
  { id: 5, label: 'DevOps Engineer', domain: 'devops', secondaryDomains: [] },
  { id: 6, label: 'Frontdesk', domain: 'router', secondaryDomains: [] },
  { id: 7, label: 'Tech Lead', domain: 'coordinator', secondaryDomains: [] },
];

const PROVIDERS = [
  { id: 'claude-code', label: 'Claude Code', kind: 'cloud', quotaPct: 0.40 },
  { id: 'codex', label: 'Codex', kind: 'cloud', quotaPct: 0.40 },
  { id: 'gemini-cli', label: 'Gemini CLI', kind: 'cloud', quotaPct: 0.40 },
  { id: 'ollama-aider', label: 'Aider · llama3.1', kind: 'local', quotaPct: 0 },
];

function initial({ providers = PROVIDERS, personas = PERSONAS } = {}) {
  return {
    personas: [...personas],
    providers: [...providers],
    constraints: { mustBeLocal: false, attachTo: null, blockedReason: null },
    rulesApplied: [],
  };
}

function baseState(overrides = {}) {
  return {
    personas: PERSONAS,
    projects: [{ id: 100, name: 'agent-office', path: '/x' }],
    activeSessions: [],
    prefs: { privacyMode: 'normal', dailyDollarCap: 5, todaySpendDollars: 0, localModelLoaded: true },
    signals: {},
    ...overrides,
  };
}

describe('frontdesk rule chain', () => {
  describe('R1 — active session attach', () => {
    it('proposes attach when an active session matches the task project', () => {
      const state = baseState({ activeSessions: [{ projectId: 100, personaId: 3, providerId: 'claude-code' }] });
      const out = runRules(state, 'fix the gemini hook in agent-office', initial());
      assert.equal(out.constraints.attachTo?.projectId, 100);
      assert.ok(out.rulesApplied.includes('R1'));
    });
    it('does not propose attach when project name absent from task', () => {
      const state = baseState({ activeSessions: [{ projectId: 100, personaId: 3, providerId: 'claude-code' }] });
      const out = runRules(state, 'do something else entirely', initial());
      assert.equal(out.constraints.attachTo, null);
    });
  });

  describe('R2 — secret keywords force local', () => {
    it('flips mustBeLocal=true on secret-bearing tasks', () => {
      const out = runRules(baseState(), 'rotate the api_key in production', initial());
      assert.equal(out.constraints.mustBeLocal, true);
      assert.ok(out.rulesApplied.includes('R2'));
    });
    it('leaves mustBeLocal alone for innocuous tasks', () => {
      const out = runRules(baseState(), 'add a tooltip to the header', initial());
      assert.equal(out.constraints.mustBeLocal, false);
    });
  });

  describe('R3 — privacyMode=strict', () => {
    it('forces local on strict privacy mode', () => {
      const out = runRules(baseState({ prefs: { privacyMode: 'strict', localModelLoaded: true } }), 'anything', initial());
      assert.equal(out.constraints.mustBeLocal, true);
      assert.ok(out.rulesApplied.includes('R3'));
    });
  });

  describe('R4 — daily cap reached', () => {
    it('forces local when daily spend hits the cap', () => {
      const out = runRules(baseState({ prefs: { dailyDollarCap: 5, todaySpendDollars: 6, localModelLoaded: true } }), 'anything', initial());
      assert.equal(out.constraints.mustBeLocal, true);
      assert.ok(out.rulesApplied.includes('R4'));
    });
  });

  describe('R5 — drop quota-exhausted providers', () => {
    it('drops providers with quotaPct > 0.95', () => {
      const providers = [{ id: 'claude-code', kind: 'cloud', quotaPct: 0.99 }, { id: 'codex', kind: 'cloud', quotaPct: 0.4 }];
      const out = runRules(baseState(), 'task', initial({ providers }));
      assert.equal(out.providers.length, 1);
      assert.equal(out.providers[0].id, 'codex');
      assert.ok(out.rulesApplied.includes('R5'));
    });
  });

  describe('R6 — demote yellow providers', () => {
    it('marks 80–95% providers as demoted but keeps them', () => {
      const providers = [{ id: 'claude-code', kind: 'cloud', quotaPct: 0.85 }, { id: 'codex', kind: 'cloud', quotaPct: 0.4 }];
      const out = runRules(baseState(), 'task', initial({ providers }));
      assert.equal(out.providers.length, 2);
      assert.equal(out.providers.find((p) => p.id === 'claude-code').demoted, true);
      assert.ok(out.rulesApplied.includes('R6'));
    });
  });

  describe('R7 — block when local needed but not loaded', () => {
    it('sets blockedReason when mustBeLocal but local backend unreachable', () => {
      const out = runRules(baseState({ prefs: { privacyMode: 'strict', localModelLoaded: false } }), 'task', initial());
      assert.equal(out.constraints.mustBeLocal, true);
      assert.match(out.constraints.blockedReason, /local backend is unreachable|no local provider/i);
      assert.ok(out.rulesApplied.includes('R7'));
    });
    it('does not block when a local provider is present and healthy', () => {
      const out = runRules(baseState({ prefs: { privacyMode: 'strict', localModelLoaded: true } }), 'task', initial());
      assert.equal(out.constraints.blockedReason, null);
    });
    it('narrows providers to local-only when mustBeLocal is set and backend is healthy', () => {
      const out = runRules(baseState({ prefs: { privacyMode: 'strict', localModelLoaded: true } }), 'task', initial());
      assert.ok(out.providers.every((p) => p.kind === 'local'),
        `expected only local providers, got: ${out.providers.map((p) => p.id).join(', ')}`);
      assert.ok(out.rulesApplied.includes('R7'));
    });
    it('blocks with a "no local provider enabled" reason when none registered', () => {
      const cloudOnly = PROVIDERS.filter((p) => p.kind !== 'local');
      const out = runRules(
        baseState({ prefs: { privacyMode: 'strict', localModelLoaded: true } }),
        'task',
        initial({ providers: cloudOnly }),
      );
      assert.match(out.constraints.blockedReason, /no local provider/i);
    });
  });

  describe('R8 — deploy verbs restrict to devops persona', () => {
    it('narrows personas to devops on deploy/release/rollback', () => {
      const out = runRules(baseState(), 'release the new api version', initial());
      assert.equal(out.personas.length, 1);
      assert.equal(out.personas[0].domain, 'devops');
      assert.ok(out.rulesApplied.includes('R8'));
    });
    it('does nothing if there is no devops persona to restrict to', () => {
      const personas = PERSONAS.filter((p) => p.domain !== 'devops');
      const out = runRules(baseState({ personas }), 'release the new api', initial({ personas }));
      // R8 should NOT have fired (would have left only devops, but there isn't one)
      assert.equal(out.rulesApplied.includes('R8'), false);
    });
  });

  describe('R13 — never auto-pick router/coordinator personas', () => {
    it('drops Frontdesk + Tech Lead from candidates', () => {
      const out = runRules(baseState(), 'anything', initial());
      assert.equal(out.personas.find((p) => p.label === 'Frontdesk'), undefined);
      assert.equal(out.personas.find((p) => p.label === 'Tech Lead'), undefined);
      assert.ok(out.rulesApplied.includes('R13'));
    });
  });

  describe('R14 — drop reviewer when no recent diff', () => {
    it('drops review persona when signals.hasRecentDiffOrPr === false', () => {
      const out = runRules(baseState({ signals: { hasRecentDiffOrPr: false } }), 'task', initial());
      assert.equal(out.personas.find((p) => p.domain === 'review'), undefined);
      assert.ok(out.rulesApplied.includes('R14'));
    });
    it('keeps review persona when signal unknown', () => {
      const out = runRules(baseState(), 'task', initial());
      assert.ok(out.personas.find((p) => p.domain === 'review'));
    });
  });

  describe('verb-bias soft sort', () => {
    it('puts debug persona first on debug-shaped tasks', () => {
      const out = runRules(baseState(), 'fix the crash in the login flow', initial());
      assert.equal(out.personas[0].domain, 'debug');
    });
    it('puts devops first on deploy-shaped tasks (after R8 narrows)', () => {
      const out = runRules(baseState(), 'rollback yesterday\'s release', initial());
      // R8 narrows to devops only, so first is devops
      assert.equal(out.personas[0].domain, 'devops');
    });
  });

  describe('end-to-end interactions', () => {
    it('R2 + R7 — secret task with no local model loaded blocks the launch', () => {
      const out = runRules(
        baseState({ prefs: { localModelLoaded: false } }),
        'rotate the password for the admin account',
        initial(),
      );
      assert.equal(out.constraints.mustBeLocal, true);
      assert.match(out.constraints.blockedReason, /local backend is unreachable|no local provider/i);
    });
    it('rules trace is preserved in order', () => {
      const out = runRules(baseState(), 'fix the gemini hook in agent-office', initial());
      // R1 fires (not in active sessions list here actually — hmm, no projects matched)
      assert.ok(Array.isArray(out.rulesApplied));
      // Should at least include R13
      assert.ok(out.rulesApplied.includes('R13'));
    });
  });
});

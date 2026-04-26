import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import aiderLocal from '../../src/providers/aider-local.js';

describe('aider-local adapter', () => {
  it('is a kind=local adapter that points at LMStudio by default', () => {
    assert.equal(aiderLocal.id, 'aider-local');
    assert.equal(aiderLocal.kind, 'local');
    assert.equal(aiderLocal.bin, 'aider');
    assert.ok(aiderLocal.defaultModel.startsWith('openai/'));
  });

  it('passes adapter validation', async () => {
    const { assertValidAdapter } = await import('../../src/providers/types.js');
    assert.doesNotThrow(() => assertValidAdapter(aiderLocal));
  });

  it('cost reports $0 with cloudEquivalent estimated against claude-sonnet pricing', () => {
    const out = aiderLocal.cost({ input: 1000, output: 200 }, 'openai/google/gemma-4-e4b');
    assert.equal(out.dollars, 0);
    assert.ok(out.cloudEquivalent > 0, 'cloudEquivalent should be a positive estimate');
  });

  it('spawn sets OPENAI_API_BASE / OPENAI_API_KEY for LMStudio routing', () => {
    const recipe = aiderLocal.spawn({
      projectPath: '/p',
      systemPrompt: 's',
      historySessionId: 7,
      lmstudioHost: 'http://localhost:1234',
    });
    assert.equal(recipe.cwd, '/p');
    assert.equal(recipe.env.OPENAI_API_BASE, 'http://localhost:1234/v1');
    assert.ok(recipe.env.OPENAI_API_KEY);
    assert.equal(recipe.env.AGENT_OFFICE_HISTORY_SESSION_ID, '7');
    assert.ok(recipe.argv.includes('--no-auto-commits'));
    assert.ok(recipe.argv.includes('--yes-always'));
    assert.ok(recipe.argv[0] === 'aider');
  });

  it('spawn falls back to defaultModel when ctx.model is missing', () => {
    const r = aiderLocal.spawn({ projectPath: '/p', systemPrompt: 's' });
    const modelArgIdx = r.argv.indexOf('--model');
    assert.ok(modelArgIdx >= 0);
    assert.equal(r.argv[modelArgIdx + 1], aiderLocal.defaultModel);
  });

  it('telemetry.sample reads launch_budget through repo', () => {
    const repo = { getLaunchBudgetForSession: () => ({ tokensInOptimized: 1000, tokensOutOptimized: 200, costDollars: 0 }) };
    const out = aiderLocal.telemetry.sample(1, { repo });
    assert.equal(out.inputTokens, 1000);
    assert.equal(out.outputTokens, 200);
    assert.equal(out.costDollars, 0);
  });

  it('quota returns null (local has no rate quota)', async () => {
    assert.equal(await aiderLocal.quota(), null);
  });
});

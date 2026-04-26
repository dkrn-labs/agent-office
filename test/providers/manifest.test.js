import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertValidAdapter } from '../../src/providers/types.js';
import { getAdapter, listAdapters, DEFAULT_PROVIDER_ID, listProvidersForUi } from '../../src/providers/manifest.js';

describe('ProviderAdapter manifest', () => {
  it('registers all three core providers', () => {
    const ids = listAdapters().map((a) => a.id);
    assert.ok(ids.includes('claude-code'));
    assert.ok(ids.includes('codex'));
    assert.ok(ids.includes('gemini-cli'));
  });

  it('every registered adapter passes assertValidAdapter', () => {
    for (const a of listAdapters()) {
      assert.doesNotThrow(() => assertValidAdapter(a), `${a.id} failed validation`);
    }
  });

  it('getAdapter returns the requested adapter when known', () => {
    assert.equal(getAdapter('codex').id, 'codex');
    assert.equal(getAdapter('gemini-cli').id, 'gemini-cli');
  });

  it('getAdapter falls back to default when id is unknown', () => {
    assert.equal(getAdapter('does-not-exist').id, DEFAULT_PROVIDER_ID);
    assert.equal(getAdapter(null).id, DEFAULT_PROVIDER_ID);
    assert.equal(getAdapter(undefined).id, DEFAULT_PROVIDER_ID);
  });

  it('default provider is claude-code', () => {
    assert.equal(DEFAULT_PROVIDER_ID, 'claude-code');
  });

  it('listProvidersForUi shape matches legacy listLaunchProviders', () => {
    const list = listProvidersForUi();
    assert.equal(list.length, 4);
    for (const p of list) {
      assert.equal(typeof p.id, 'string');
      assert.equal(typeof p.label, 'string');
      assert.equal(typeof p.command, 'string');
      assert.equal(typeof p.defaultModel, 'string');
      assert.ok(Array.isArray(p.models) && p.models.length > 0);
    }
  });
});

describe('ProviderAdapter spawn', () => {
  it('claude-code recipe uses --append-system-prompt with $PROMPT placeholder', () => {
    const recipe = getAdapter('claude-code').spawn({
      projectPath: '/tmp/x', systemPrompt: '', model: 'sonnet', historySessionId: 7,
    });
    assert.deepEqual(recipe.argv, ['claude', '--model', 'sonnet', '--append-system-prompt', '$PROMPT']);
    assert.equal(recipe.promptDelivery, 'flag');
    assert.equal(recipe.env.AGENT_OFFICE_HISTORY_SESSION_ID, '7');
    assert.equal(recipe.cwd, '/tmp/x');
  });

  it('codex recipe places $PROMPT as positional', () => {
    const recipe = getAdapter('codex').spawn({
      projectPath: '/tmp/y', systemPrompt: '', model: 'gpt-5.4', historySessionId: 11,
    });
    assert.deepEqual(recipe.argv, ['codex', '--model', 'gpt-5.4', '$PROMPT']);
  });

  it('gemini-cli recipe uses --prompt-interactive', () => {
    const recipe = getAdapter('gemini-cli').spawn({
      projectPath: '/tmp/z', systemPrompt: '', model: 'gemini-2.5-flash',
    });
    assert.deepEqual(recipe.argv, ['gemini', '--model', 'gemini-2.5-flash', '--prompt-interactive', '$PROMPT']);
    assert.equal(recipe.env.AGENT_OFFICE_HISTORY_SESSION_ID, undefined);
  });

  it('falls back to defaultModel when ctx.model is missing', () => {
    const claude = getAdapter('claude-code').spawn({ projectPath: '/tmp', systemPrompt: '' });
    assert.equal(claude.argv[2], 'sonnet');
  });
});

describe('ProviderAdapter cost', () => {
  it('claude-code cost uses pricing module for known models', () => {
    const out = getAdapter('claude-code').cost({ input: 1_000_000, output: 1_000_000 }, 'sonnet');
    // sonnet: $3/M in + $15/M out = $18 total
    assert.equal(Math.round(out.dollars * 100) / 100, 18.0);
  });

  it('cost returns 0 for unknown models rather than throwing', () => {
    assert.equal(getAdapter('codex').cost({ input: 1000, output: 1000 }, 'unknown-model').dollars, 0);
  });
});

describe('assertValidAdapter', () => {
  it('throws on missing required field', () => {
    assert.throws(() => assertValidAdapter({ id: 'x', label: 'X' }), /missing required field/);
  });
  it('throws on bad kind', () => {
    assert.throws(
      () => assertValidAdapter({
        id: 'x', label: 'X', kind: 'mystery', bin: 'x', defaultModel: 'm',
        capabilities: {}, modelCatalog: [{}], spawn: () => {}, cost: () => ({ dollars: 0 }),
      }),
      /kind must be/,
    );
  });
});

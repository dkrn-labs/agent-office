/**
 * P3-9 — adapter contract matrix.
 *
 * For every registered ProviderAdapter, walk the four contract methods
 * the rest of the codebase consumes — spawn, cost, telemetry.sample,
 * parseTranscript — and assert their return shapes are equivalent
 * across providers. Plus three outcomes per provider (accepted, partial,
 * rejected) for the savings rollup. (4 providers × 3 outcomes = 12
 * shape cells + the 3 per-adapter contract probes = 15.) The point is
 * not coverage of every code path; it's that no `if (provider === '…')`
 * branches survive outside `src/providers/`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { listAdapters, getAdapter } from '../../src/providers/manifest.js';
import { rollupSavings } from '../../src/context-budget/index.js';

const OUTCOMES = ['accepted', 'partial', 'rejected'];

function fakeUsage() {
  return { input: 1200, output: 240, cacheRead: 0, cacheWrite: 0 };
}

function fakeRepo() {
  return {
    getLaunchBudgetForSession: () => ({
      tokensInOptimized: 1000, tokensOutOptimized: 200, costDollars: 0.012,
    }),
  };
}

describe('P3 matrix — adapter contract symmetry', () => {
  for (const adapter of listAdapters()) {
    describe(`provider: ${adapter.id} (${adapter.kind})`, () => {
      it('spawn returns a SpawnRecipe with argv/env/cwd', () => {
        const recipe = adapter.spawn({
          projectPath: '/tmp/proj',
          systemPrompt: 'p',
          historySessionId: 1,
        });
        assert.ok(Array.isArray(recipe.argv) && recipe.argv.length > 0);
        assert.equal(typeof recipe.env, 'object');
        assert.equal(recipe.cwd, '/tmp/proj');
        assert.ok(['flag', 'file', 'stdin'].includes(recipe.promptDelivery));
        assert.equal(recipe.env.AGENT_OFFICE_HISTORY_SESSION_ID, '1');
      });

      it('cost returns { dollars } (and cloudEquivalent for local)', () => {
        const out = adapter.cost(fakeUsage(), adapter.defaultModel);
        assert.equal(typeof out.dollars, 'number');
        if (adapter.kind === 'local') {
          assert.equal(out.dollars, 0);
          assert.ok(typeof out.cloudEquivalent === 'number' && out.cloudEquivalent > 0);
        }
      });

      if (typeof adapter.telemetry?.sample === 'function') {
        it('telemetry.sample returns { inputTokens, outputTokens, costDollars } via repo', () => {
          const out = adapter.telemetry.sample(7, { repo: fakeRepo() });
          assert.equal(typeof out.inputTokens, 'number');
          assert.equal(typeof out.outputTokens, 'number');
          assert.equal(typeof out.costDollars, 'number');
        });
      }

      if (typeof adapter.parseTranscript === 'function') {
        it('parseTranscript returns [] for missing path (no throw)', () => {
          assert.deepEqual(adapter.parseTranscript('/nonexistent/path'), []);
        });
      }

      for (const outcome of OUTCOMES) {
        it(`savings rollup for ${adapter.id} respects outcome=${outcome}`, () => {
          const row = {
            providerId: adapter.id,
            baselineTokens: 30000,
            optimizedTokens: 8000,
            costDollars: adapter.kind === 'local' ? 0 : 0.10,
            cloudEquivalentDollars: adapter.kind === 'local' ? 0.05 : null,
            outcome,
          };
          const rollup = rollupSavings([row]);
          if (outcome === 'rejected') {
            assert.equal(rollup.sessions, 0, 'rejected rows are excluded from rollup');
          } else {
            assert.equal(rollup.sessions, 1);
            assert.equal(rollup.savedTokens, 30000 - 8000);
          }
        });
      }
    });
  }

  it('cross-cutting: every adapter is reachable via getAdapter(id)', () => {
    for (const a of listAdapters()) {
      assert.equal(getAdapter(a.id).id, a.id);
    }
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_PRICING, computeCostUsd } from '../../src/telemetry/pricing.js';

describe('MODEL_PRICING', () => {
  it('has entries for current Claude models', () => {
    assert.ok(MODEL_PRICING['claude-opus-4-6']);
    assert.ok(MODEL_PRICING['claude-sonnet-4-6']);
    assert.ok(MODEL_PRICING['claude-haiku-4-5']);
  });
});

describe('computeCostUsd', () => {
  it('computes cost for sonnet usage', () => {
    // Sonnet 4.6 rates: $3/M input, $15/M output, $0.30/M cache read, $3.75/M cache write
    const cost = computeCostUsd({
      model: 'claude-sonnet-4-6',
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      cacheRead: 0,
      cacheWrite: 0,
    });
    assert.equal(cost, 18); // 3 + 15
  });

  it('returns null for unknown model', () => {
    assert.equal(
      computeCostUsd({ model: 'made-up', tokensIn: 1000, tokensOut: 1000 }),
      null,
    );
  });

  it('handles zero tokens (just started session)', () => {
    assert.equal(
      computeCostUsd({ model: 'claude-sonnet-4-6', tokensIn: 0, tokensOut: 0 }),
      0,
    );
  });

  it('handles cache read/write tokens', () => {
    const cost = computeCostUsd({
      model: 'claude-sonnet-4-6',
      tokensIn: 0,
      tokensOut: 0,
      cacheRead: 10_000_000,   // $0.30/M × 10 = $3
      cacheWrite: 1_000_000,   // $3.75/M × 1 = $3.75
    });
    assert.equal(Math.round(cost * 100) / 100, 6.75);
  });
});

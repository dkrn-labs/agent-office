import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatForContext,
  formatMemorySection,
} from '../../src/memory/memory-injector.js';

describe('formatForContext()', () => {
  it('returns no-memories message for empty array', () => {
    assert.equal(formatForContext([]), '(No project memories available)');
  });

  it('formats a single memory correctly', () => {
    const memories = [
      { domain: 'frontend', type: 'convention', content: 'Use Radix UI for accessible components' },
    ];
    const result = formatForContext(memories);
    assert.equal(result, '### frontend\n- [convention] Use Radix UI for accessible components');
  });

  it('groups memories by domain with headers', () => {
    const memories = [
      { domain: 'frontend', type: 'convention', content: 'Use Radix UI for accessible components' },
      { domain: 'general', type: 'decision', content: 'Deploy preview branches to Vercel staging' },
    ];
    const result = formatForContext(memories);
    assert.ok(result.includes('### frontend'));
    assert.ok(result.includes('### general'));
    assert.ok(result.indexOf('### frontend') < result.indexOf('### general'));
  });

  it('handles multiple types within a domain', () => {
    const memories = [
      { domain: 'frontend', type: 'convention', content: 'Use Radix UI for accessible components' },
      { domain: 'frontend', type: 'gotcha', content: 'Vitest, not Jest — switched in sprint 14' },
    ];
    const result = formatForContext(memories);
    // Only one header for the domain
    assert.equal((result.match(/### frontend/g) ?? []).length, 1);
    assert.ok(result.includes('- [convention] Use Radix UI for accessible components'));
    assert.ok(result.includes('- [gotcha] Vitest, not Jest — switched in sprint 14'));
  });

  it('handles special characters in content (quotes and embedded newlines)', () => {
    const memories = [
      {
        domain: 'general',
        type: 'note',
        content: 'He said "always escape" and it\'s true\neven across lines',
      },
    ];
    const result = formatForContext(memories);
    assert.ok(result.includes('"always escape"'));
    assert.ok(result.includes("it's true"));
    // The newline inside the content value passes through as-is
    assert.ok(result.includes('\neven across lines'));
  });
});

describe('formatMemorySection()', () => {
  it('includes count in header for non-empty array', () => {
    const memories = [
      { domain: 'frontend', type: 'convention', content: 'Use Radix UI for accessible components' },
      { domain: 'frontend', type: 'gotcha', content: 'Vitest, not Jest — switched in sprint 14' },
      { domain: 'general', type: 'decision', content: 'Deploy preview branches to Vercel staging' },
    ];
    const result = formatMemorySection(memories);
    assert.ok(result.startsWith('## Project Memory (3 entries)'));
    assert.ok(result.includes('### frontend'));
    assert.ok(result.includes('### general'));
  });

  it('works with empty array and shows 0 entries', () => {
    const result = formatMemorySection([]);
    assert.ok(result.startsWith('## Project Memory (0 entries)'));
    assert.ok(result.includes('(No project memories available)'));
  });
});

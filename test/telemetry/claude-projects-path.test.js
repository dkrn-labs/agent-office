import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeProjectPath,
  decodeProjectPath,
  defaultClaudeProjectsRoot,
} from '../../src/telemetry/claude-projects-path.js';

describe('encodeProjectPath', () => {
  it('replaces slashes with dashes, strips leading slash', () => {
    assert.equal(encodeProjectPath('/Users/alice/web'), 'Users-alice-web');
  });
  it('handles trailing slash', () => {
    assert.equal(encodeProjectPath('/Users/alice/web/'), 'Users-alice-web');
  });
});

describe('decodeProjectPath', () => {
  it('inverse of encode — reproduces absolute path', () => {
    assert.equal(decodeProjectPath('Users-alice-web'), '/Users/alice/web');
  });
});

describe('defaultClaudeProjectsRoot', () => {
  it('returns ~/.claude/projects under HOME', () => {
    const old = process.env.HOME;
    process.env.HOME = '/tmp/fake-home';
    try {
      assert.equal(defaultClaudeProjectsRoot(), '/tmp/fake-home/.claude/projects');
    } finally {
      process.env.HOME = old;
    }
  });
});

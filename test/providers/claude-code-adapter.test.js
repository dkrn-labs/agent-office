import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createClaudeCodeAdapter } from '../../src/providers/claude-code-adapter.js';

describe('claude-code-adapter', () => {
  const adapter = createClaudeCodeAdapter();

  it('id is "claude-code"', () => {
    assert.equal(adapter.id, 'claude-code');
  });

  it('implements required interface methods', () => {
    assert.equal(typeof adapter.buildLaunchCommand, 'function');
    assert.equal(typeof adapter.getSessionLogPattern, 'function');
  });

  describe('buildLaunchCommand', () => {
    const ctx = {
      projectPath: '/Users/dev/my-project',
      systemPrompt: 'You are a helpful assistant.',
    };
    const cmd = adapter.buildLaunchCommand(ctx);

    it('returns an object with executable, args, and cwd', () => {
      assert.ok(Object.hasOwn(cmd, 'executable'), 'missing executable');
      assert.ok(Object.hasOwn(cmd, 'args'), 'missing args');
      assert.ok(Object.hasOwn(cmd, 'cwd'), 'missing cwd');
    });

    it('executable is "claude"', () => {
      assert.equal(cmd.executable, 'claude');
    });

    it('args include --system-prompt', () => {
      assert.ok(
        cmd.args.includes('--system-prompt'),
        `expected args to include --system-prompt, got: ${JSON.stringify(cmd.args)}`
      );
    });

    it('cwd is the projectPath from context', () => {
      assert.equal(cmd.cwd, ctx.projectPath);
    });
  });

  describe('getSessionLogPattern', () => {
    const projectPath = '/Users/dev/my-project';
    const pattern = adapter.getSessionLogPattern(projectPath);

    it('returned pattern contains .jsonl', () => {
      assert.ok(
        pattern.includes('.jsonl'),
        `expected pattern to contain .jsonl, got: ${pattern}`
      );
    });

    it('returned pattern uses os.homedir()', () => {
      assert.ok(
        pattern.startsWith(os.homedir()),
        `expected pattern to start with homedir (${os.homedir()}), got: ${pattern}`
      );
    });
  });
});

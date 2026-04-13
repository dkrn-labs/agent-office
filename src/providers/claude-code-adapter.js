import os from 'node:os';
import path from 'node:path';

/**
 * Create a ProviderAdapter for Claude Code.
 *
 * @returns {import('./provider-interface.js').ProviderAdapter}
 */
export function createClaudeCodeAdapter() {
  return {
    id: 'claude-code',

    /**
     * @param {import('./provider-interface.js').LaunchContext} ctx
     * @returns {import('./provider-interface.js').LaunchCommand}
     */
    buildLaunchCommand(ctx) {
      return {
        executable: 'claude',
        args: ['--system-prompt', ctx.systemPrompt],
        cwd: ctx.projectPath,
      };
    },

    /**
     * Returns a glob pattern for the JSONL session logs Claude Code writes under
     * ~/.claude/projects/<encoded-path>/*.jsonl, where the encoded path is the
     * project path with every '/' replaced by '-'.
     *
     * @param {string} projectPath
     * @returns {string}
     */
    getSessionLogPattern(projectPath) {
      const encoded = projectPath.replace(/\//g, '-');
      return path.join(os.homedir(), '.claude', 'projects', encoded, '*.jsonl');
    },
  };
}

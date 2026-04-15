/**
 * Utilities for mapping between absolute project paths and the directory
 * names Claude Code uses under ~/.claude/projects/<encoded>.
 */

export function encodeProjectPath(absolutePath) {
  // Claude Code replaces every / with - and drops the leading one.
  return absolutePath.replace(/\/+$/, '').replace(/^\//, '').replace(/\//g, '-');
}

export function decodeProjectPath(encoded) {
  return '/' + encoded.replace(/-/g, '/');
}

export function defaultClaudeProjectsRoot() {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return `${home}/.claude/projects`;
}

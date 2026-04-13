/**
 * Provider adapter interface definitions.
 *
 * @module provider-interface
 */

/**
 * Context passed to a provider when launching an agent session.
 *
 * @typedef {Object} LaunchContext
 * @property {string} projectPath - Absolute path to the project directory.
 * @property {string} systemPrompt - System prompt to inject into the session.
 */

/**
 * The resolved command that the launcher will exec.
 *
 * @typedef {Object} LaunchCommand
 * @property {string} executable - The binary to run (e.g. 'claude').
 * @property {string[]} args - Arguments to pass to the executable.
 * @property {string} cwd - Working directory for the process.
 * @property {Object} [env] - Optional environment variable overrides.
 */

/**
 * A provider adapter encapsulates everything needed to launch and observe
 * one flavour of AI coding agent (e.g. Claude Code, Cursor, etc.).
 *
 * @typedef {Object} ProviderAdapter
 * @property {string} id - Unique identifier for this provider (e.g. 'claude-code').
 * @property {function(LaunchContext): LaunchCommand} buildLaunchCommand
 *   Build the executable + args needed to start a session for the given context.
 * @property {function(string): string} getSessionLogPattern
 *   Return a glob pattern for the session log files produced by this provider,
 *   given the project path. Used by the telemetry watcher.
 */

/**
 * Launcher — orchestrates persona + project context assembly and session creation
 * before handing off to a terminal for execution.
 *
 * Usage:
 *   import { createLauncher } from './launcher.js';
 *   const launcher = createLauncher({ repo, bus, resolver, dryRun: false });
 *   const ctx = await launcher.launch(personaId, projectId);
 *
 * @param {{ repo: ReturnType<import('../db/repository.js').createRepository>, bus: ReturnType<import('../core/event-bus.js').createEventBus>, resolver: ReturnType<import('./skill-resolver.js').createSkillResolver>, dryRun?: boolean }} opts
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { SESSION_STARTED } from '../core/events.js';
import { createMemoryEngine } from '../memory/memory-engine.js';
import { formatForContext } from '../memory/memory-injector.js';

const execAsync = promisify(exec);

/**
 * Build the AppleScript that opens a new iTerm2 tab in the given project dir
 * and runs `claude --system-prompt <prompt>`.
 *
 * Exposed separately for unit testing without shelling out to osascript.
 *
 * @param {{ projectPath: string, systemPrompt: string }} opts
 * @returns {string} AppleScript source
 */
export function buildItermScript({ projectPath, systemPrompt }) {
  // AppleScript string escaping: backslashes and double quotes.
  const escape = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  // Pass the system prompt through a single-quoted shell arg so iTerm's
  // `write text` doesn't interpret its contents. Single quotes survive the
  // AppleScript escape above.
  const shellPrompt = "'" + systemPrompt.replace(/'/g, `'\\''`) + "'";
  const cmd = `cd ${JSON.stringify(projectPath)} && clear && claude --system-prompt ${shellPrompt}`;
  return `
tell application "iTerm"
  activate
  tell current window
    create tab with default profile
    tell current session
      write text "${escape(cmd)}"
    end tell
  end tell
end tell
`.trim();
}

/**
 * Spawn Claude Code in a new iTerm2 tab. macOS-only; throws on other platforms.
 *
 * @param {{ projectPath: string, systemPrompt: string }} opts
 */
export async function spawnItermTab({ projectPath, systemPrompt }) {
  if (process.platform !== 'darwin') {
    throw new Error(`Terminal spawn not supported on ${process.platform} yet`);
  }
  const script = buildItermScript({ projectPath, systemPrompt });
  await execAsync(`osascript -e ${JSON.stringify(script)}`);
}

export function createLauncher({ repo, bus, resolver, dryRun = false, memoryEngine: memoryEngineOpt } = {}) {
  const memoryEngine = memoryEngineOpt ?? createMemoryEngine(repo);
  /**
   * Assemble all context for a launch without spawning a terminal.
   *
   * @param {number} personaId
   * @param {number} projectId
   * @returns {Promise<{ sessionId: number, projectPath: string, systemPrompt: string, skills: object[], memories: object[] }>}
   */
  async function prepareLaunch(personaId, projectId) {
    // 1. Load persona
    const persona = repo.getPersona(personaId);
    if (!persona) throw new Error(`Persona not found: ${personaId}`);

    // 2. Load project
    const project = repo.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    // 3. Resolve skills
    const skills = resolver.resolve(persona, project);

    // 4. Query memories for relevant domains via memory engine
    const memories = memoryEngine.queryForPersona(projectId, persona);

    // 5. Hydrate system prompt template
    const template = persona.systemPromptTemplate ?? '';
    const systemPrompt = template
      .replace('{{project}}', project.name ?? '')
      .replace('{{techStack}}', (project.techStack ?? []).join(', '))
      .replace('{{skills}}', skills.map((s) => s.content).join('\n\n'))
      .replace('{{memories}}', formatForContext(memories));

    // 6. Create session record
    const sessionId = repo.createSession({ projectId, personaId });

    // 7. Emit SESSION_STARTED
    bus.emit(SESSION_STARTED, { sessionId: Number(sessionId), projectId, personaId });

    return {
      sessionId: Number(sessionId),
      projectPath: project.path,
      systemPrompt,
      skills,
      memories,
    };
  }

  /**
   * Prepare launch context and (when not in dryRun mode) spawn the terminal.
   *
   * @param {number} personaId
   * @param {number} projectId
   * @returns {Promise<{ sessionId: number, projectPath: string, systemPrompt: string, skills: object[], memories: object[] }>}
   */
  async function launch(personaId, projectId) {
    const ctx = await prepareLaunch(personaId, projectId);

    if (!dryRun) {
      await spawnItermTab({
        projectPath: ctx.projectPath,
        systemPrompt: ctx.systemPrompt,
      });
    }

    return ctx;
  }

  return { prepareLaunch, launch };
}

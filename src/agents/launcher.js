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
import { filterObservationsForPersona } from '../memory/persona-filter.js';

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

function buildClaudeMemSection(last, personaObs, persona) {
  const parts = [];
  if (last) {
    const summary = last.completed ?? last.title ?? '';
    const nextBit = last.nextSteps ? ` Next: ${last.nextSteps}.` : '';
    parts.push(`## Last Session\n${summary}.${nextBit}`);
  }
  if (personaObs.length > 0) {
    const bullets = personaObs
      .map((o) => {
        const files = o.filesModified.slice(0, 3).join(', ');
        const filesPart = files ? ` (${files})` : '';
        return `- ${o.title}${o.subtitle ? ` — ${o.subtitle}` : ''}${filesPart}`;
      })
      .join('\n');
    parts.push(`## Recent Work as ${persona.label}\n${bullets}`);
  }
  return parts.join('\n\n');
}

export function createLauncher({
  repo,
  bus,
  resolver,
  dryRun = false,
  memoryEngine: memoryEngineOpt,
  claudeMem = null,
} = {}) {
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

    // 4b. Pull claude-mem context (last session + persona-filtered observations)
    let claudeMemSection = '';
    if (claudeMem) {
      const last = claudeMem.getLastSession(project.name);
      const allObs = claudeMem.getObservations(project.name, { limit: 50 });
      const personaObs = filterObservationsForPersona(allObs, persona, { limit: 10 });
      claudeMemSection = buildClaudeMemSection(last, personaObs, persona);
    }

    // 5. Hydrate system prompt template
    const template = persona.systemPromptTemplate ?? '';
    const baseSystemPrompt = template
      .replace('{{project}}', project.name ?? '')
      .replace('{{techStack}}', (project.techStack ?? []).join(', '))
      .replace('{{skills}}', skills.map((s) => s.content).join('\n\n'))
      .replace('{{memories}}', formatForContext(memories));
    const systemPrompt = claudeMemSection
      ? `${claudeMemSection}\n\n${baseSystemPrompt}`
      : baseSystemPrompt;

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

  async function preview(personaId, projectId) {
    const persona = repo.getPersona(personaId);
    if (!persona) throw new Error(`Persona not found: ${personaId}`);
    const project = repo.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const skills = resolver.resolve(persona, project);
    const memories = memoryEngine.queryForPersona(projectId, persona);

    let lastSession = null;
    let personaObservations = [];
    if (claudeMem) {
      lastSession = claudeMem.getLastSession(project.name);
      const allObs = claudeMem.getObservations(project.name, { limit: 50 });
      personaObservations = filterObservationsForPersona(allObs, persona, { limit: 10 });
    }

    return {
      persona: { id: persona.id, label: persona.label, domain: persona.domain },
      project: { id: project.id, name: project.name, path: project.path, techStack: project.techStack ?? [] },
      skills: skills.map((s) => ({ id: s.id, name: s.name, domain: s.domain })),
      memories: memories.map((m) => ({ id: m.id, domain: m.domain, content: m.content })),
      lastSession,
      personaObservations,
    };
  }

  return { prepareLaunch, launch, preview };
}

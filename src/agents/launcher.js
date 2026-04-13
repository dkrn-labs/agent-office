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

import { SESSION_STARTED } from '../core/events.js';

export function createLauncher({ repo, bus, resolver, dryRun = false }) {
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

    // 4. Query memories for relevant domains
    const domains = [
      persona.domain,
      ...(persona.secondaryDomains ?? []),
      'general',
    ];
    const memories = repo.listMemories({ projectId, domains });

    // 5. Hydrate system prompt template
    const template = persona.systemPromptTemplate ?? '';
    const systemPrompt = template
      .replace('{{project}}', project.name ?? '')
      .replace('{{techStack}}', (project.techStack ?? []).join(', '))
      .replace('{{skills}}', skills.map((s) => s.content).join('\n\n'))
      .replace(
        '{{memories}}',
        memories.map((m) => `[${m.domain}/${m.type}] ${m.content}`).join('\n'),
      );

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
      // Terminal spawn would go here; log intent for now.
      console.log(
        `[launcher] Would spawn terminal for session ${ctx.sessionId} at ${ctx.projectPath}`,
      );
    }

    return ctx;
  }

  return { prepareLaunch, launch };
}

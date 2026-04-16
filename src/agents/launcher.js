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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SESSION_STARTED } from '../core/events.js';
import { createMemoryEngine } from '../memory/memory-engine.js';
import { formatForContext } from '../memory/memory-injector.js';
import { filterObservationsForPersona } from '../memory/persona-filter.js';
import { listLaunchProviders, resolveLaunchTarget } from './provider-catalog.js';

const execFileAsync = promisify(execFile);

/**
 * Detect which terminal app to use on macOS. Preference: iTerm > iTerm2 >
 * Terminal.app. Returns the AppleScript application name.
 *
 * @returns {'iTerm' | 'iTerm2' | 'Terminal'}
 */
export function detectTerminal() {
  if (existsSync('/Applications/iTerm.app')) return 'iTerm';
  if (existsSync('/Applications/iTerm2.app')) return 'iTerm2';
  return 'Terminal';
}

/**
 * Build a self-contained bash script that cds to the project, runs Claude with
 * the system prompt loaded from a sibling file, and self-deletes both files.
 *
 * Embedding the prompt in a sibling file (instead of inline) sidesteps every
 * shell/AppleScript escaping problem: the prompt may contain newlines, double
 * quotes, single quotes, backslashes — none reach the shell parser.
 *
 * @param {{ projectPath: string, scriptPath: string, promptPath: string, providerId?: string, model?: string }} opts
 * @returns {string} bash source
 */
export function buildLaunchBashScript({ projectPath, scriptPath, promptPath, providerId, model }) {
  const q = JSON.stringify; // safe shell-quoting via JSON for paths
  const launchTarget = resolveLaunchTarget(providerId, model);
  let command = `exec claude --model ${q(launchTarget.model)} --append-system-prompt "$PROMPT"`;
  if (launchTarget.providerId === 'codex') {
    command = `exec codex --model ${q(launchTarget.model)} "$PROMPT"`;
  } else if (launchTarget.providerId === 'gemini-cli') {
    command = `exec gemini --model ${q(launchTarget.model)} --prompt-interactive "$PROMPT"`;
  }

  return `#!/bin/bash
cd ${q(projectPath)} || exit 1
clear
PROMPT="$(cat ${q(promptPath)})"
rm -f ${q(promptPath)} ${q(scriptPath)}
${command}
`;
}

/**
 * Build the AppleScript that opens a new terminal window/tab and runs the
 * given script. Supports iTerm, iTerm2, and macOS Terminal.app.
 *
 * @param {{ scriptPath: string, terminal?: 'iTerm' | 'iTerm2' | 'Terminal' }} opts
 * @returns {string} AppleScript source
 */
export function buildItermScript({ scriptPath, terminal = 'Terminal' }) {
  // AppleScript string escape: backslash and double quote.
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const cmd = `bash "${esc(scriptPath)}"`;

  if (terminal === 'Terminal') {
    // Terminal.app: `do script` opens a new window (or tab with keystroke) and runs the command
    return `tell application "Terminal"
  activate
  do script "${esc(cmd)}"
end tell`;
  }

  // iTerm / iTerm2: richer AppleScript with tab support
  return `tell application "${terminal}"
  activate
  if (count of windows) is 0 then
    set newWin to (create window with default profile)
    tell current session of newWin
      write text "${esc(cmd)}"
    end tell
  else
    tell current window
      create tab with default profile
      tell current session
        write text "${esc(cmd)}"
      end tell
    end tell
  end if
end tell`;
}

/**
 * Spawn Claude Code in a new iTerm2 tab. macOS-only; throws on other platforms.
 *
 * Writes the system prompt and a launcher script to /tmp, then asks iTerm to
 * run the script. The script self-deletes after launching Claude, so nothing
 * persists in /tmp.
 *
 * @param {{ projectPath: string, systemPrompt: string, providerId?: string, model?: string }} opts
 */
export async function spawnItermTab({ projectPath, systemPrompt, providerId, model }) {
  if (process.platform !== 'darwin') {
    throw new Error(`Terminal spawn not supported on ${process.platform} yet`);
  }
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const promptPath = join(tmpdir(), `agent-office-prompt-${stamp}.txt`);
  const scriptPath = join(tmpdir(), `agent-office-launch-${stamp}.sh`);
  await writeFile(promptPath, systemPrompt, 'utf8');
  const bash = buildLaunchBashScript({
    projectPath,
    scriptPath,
    promptPath,
    providerId,
    model,
  });
  await writeFile(scriptPath, bash, { mode: 0o755, encoding: 'utf8' });
  const terminal = detectTerminal();
  const script = buildItermScript({ scriptPath, terminal });
  // Use execFile (no shell) so multi-line AppleScript reaches osascript
  // intact. exec('osascript -e "..."') goes through the shell which mangles
  // newlines and quotes.
  await execFileAsync('osascript', ['-e', script]);
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

function buildFallbackSystemPrompt(persona, project, resolvedSkills, memories) {
  const personaLabel = persona?.label ?? 'Software Engineer';
  const personaDomain = persona?.domain ?? 'general';
  const stackText = (project?.techStack ?? []).join(', ') || 'unknown';
  const skillsText =
    resolvedSkills.length > 0
      ? resolvedSkills.map((skill) => `- ${skill.name}: ${skill.preview ?? ''}`).join('\n')
      : '- No resolved skills.';

  return [
    `You are ${personaLabel} working on ${project?.name ?? 'this project'}.`,
    `Primary domain: ${personaDomain}.`,
    `Tech stack: ${stackText}.`,
    '',
    'Available skills:',
    skillsText,
    '',
    'Relevant memories:',
    formatForContext(memories),
  ].join('\n');
}

export function createLauncher({
  repo,
  bus,
  resolver,
  dryRun = false,
  memoryEngine: memoryEngineOpt,
  projectHistory = null,
  claudeMem = null,
  watcher = null,
  skillRoots = [],
} = {}) {
  const memoryEngine = memoryEngineOpt ?? createMemoryEngine(repo);

  async function buildLaunchContext(personaId, projectId, options = {}) {
    const persona = repo.getPersona(personaId);
    if (!persona) throw new Error(`Persona not found: ${personaId}`);

    const project = repo.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const inventory = resolver.inventoryForLaunch(persona, project);
    const resolvedSkills = inventory.resolved.map((skill) => ({
      id: skill.id,
      name: skill.name,
      domain: skill.domain,
      source: skill.source,
      injectionMode: 'full',
      applicableStacks: skill.applicableStacks ?? [],
      preview: skill.content,
      reasons: skill.reasons ?? [],
    }));
    const memories = memoryEngine.queryForPersona(projectId, persona);

    let claudeMemSection = '';
    let lastSession = null;
    let personaObservations = [];
    if (projectHistory) {
      const history = projectHistory.getLaunchHistory(project.id, persona);
      lastSession = history.lastSession;
      personaObservations = history.personaObservations;
      claudeMemSection = history.section;
    }
    if (!claudeMemSection && claudeMem) {
      lastSession = claudeMem.getLastSession(project.name);
      const allObs = claudeMem.getObservations(project.name, { limit: 50 });
      personaObservations = filterObservationsForPersona(allObs, persona, { limit: 10 });
      claudeMemSection = buildClaudeMemSection(lastSession, personaObservations, persona);
    }

    const template = persona.systemPromptTemplate?.trim() ?? '';
    const baseSystemPrompt = template
      ? template
          .replace('{{project}}', project.name ?? '')
          .replace('{{techStack}}', (project.techStack ?? []).join(', '))
          .replace('{{skills}}', resolvedSkills.map((s) => s.preview).join('\n\n'))
          .replace('{{memories}}', formatForContext(memories))
      : buildFallbackSystemPrompt(persona, project, resolvedSkills, memories);
    const systemPrompt = claudeMemSection
      ? `${claudeMemSection}\n\n${baseSystemPrompt}`
      : baseSystemPrompt;

    const launchTarget = resolveLaunchTarget(options.providerId, options.model);

    return {
      persona,
      project,
      resolvedSkills,
      memories,
      lastSession,
      personaObservations,
      systemPrompt,
      launchTarget,
      installedSkills: inventory.installed,
      recommendedSkills: inventory.recommended,
    };
  }
  /**
   * Assemble all context for a launch without spawning a terminal.
   *
   * @param {number} personaId
   * @param {number} projectId
   * @returns {Promise<{ sessionId: number, projectPath: string, systemPrompt: string, skills: object[], memories: object[] }>}
   */
  async function prepareLaunch(personaId, projectId, options = {}) {
    const { persona, project, systemPrompt, resolvedSkills, memories, launchTarget } = await buildLaunchContext(
      personaId,
      projectId,
      options,
    );

    // 6. Create session record
    const startedAt = new Date().toISOString();
    const sessionId = repo.createSession({
      projectId,
      personaId,
      providerId: launchTarget.providerId,
      startedAt,
      systemPrompt,
    });
    repo.updateSession(Number(sessionId), { lastModel: launchTarget.model });

    // 7. Emit SESSION_STARTED
    bus.emit(SESSION_STARTED, {
      sessionId: Number(sessionId),
      projectId,
      personaId,
      startedAt,
      projectName: project.name,
      projectPath: project.path,
      personaLabel: persona.label,
      personaDomain: persona.domain,
      providerId: launchTarget.providerId,
      lastModel: launchTarget.model,
    });

    return {
      sessionId: Number(sessionId),
      projectPath: project.path,
      systemPrompt,
      skills: resolvedSkills,
      memories,
      startedAt,
      launchTarget,
      providerId: launchTarget.providerId,
      model: launchTarget.model,
    };
  }

  /**
   * Prepare launch context and (when not in dryRun mode) spawn the terminal.
   *
   * @param {number} personaId
   * @param {number} projectId
   * @returns {Promise<{ sessionId: number, projectPath: string, systemPrompt: string, skills: object[], memories: object[] }>}
   */
  async function launch(personaId, projectId, options = {}) {
    const ctx = await prepareLaunch(personaId, projectId, options);

    watcher?.registerLaunch?.({
      projectPath: ctx.projectPath,
      sessionId: ctx.sessionId,
      personaId,
      projectId,
      launchedAt: ctx.startedAt,
      providerId: ctx.providerId,
    });

    if (!dryRun) {
      await spawnItermTab({
        projectPath: ctx.projectPath,
        systemPrompt: ctx.systemPrompt,
        providerId: ctx.providerId,
        model: ctx.model,
      });
    }

    return ctx;
  }

  async function preview(personaId, projectId, options = {}) {
    const {
      persona,
      project,
      resolvedSkills,
      memories,
      lastSession,
      personaObservations,
      systemPrompt,
      launchTarget,
      installedSkills,
      recommendedSkills,
    } = await buildLaunchContext(personaId, projectId, options);

    return {
      persona: { id: persona.id, label: persona.label, domain: persona.domain },
      project: { id: project.id, name: project.name, path: project.path, techStack: project.techStack ?? [] },
      systemPrompt,
      launchTarget,
      availableProviders: listLaunchProviders(),
      skillRoots,
      resolvedSkills,
      installedSkills,
      recommendedSkills,
      injectionStrategy: {
        defaultMode: 'full',
        note: 'Phase 5.1 keeps launch behavior unchanged while exposing the exact injected prompt.',
      },
      skills: resolvedSkills.map((s) => ({ id: s.id, name: s.name, domain: s.domain })),
      memories: memories.map((m) => ({ id: m.id, domain: m.domain, content: m.content })),
      lastSession,
      personaObservations,
    };
  }

  return { prepareLaunch, launch, preview };
}

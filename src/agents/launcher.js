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
 * @param {{ projectPath: string, scriptPath: string, promptPath: string }} opts
 * @returns {string} bash source
 */
export function buildLaunchBashScript({ projectPath, scriptPath, promptPath }) {
  const q = JSON.stringify; // safe shell-quoting via JSON for paths
  return `#!/bin/bash
cd ${q(projectPath)} || exit 1
clear
PROMPT="$(cat ${q(promptPath)})"
rm -f ${q(promptPath)} ${q(scriptPath)}
exec claude --append-system-prompt "$PROMPT"
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
 * @param {{ projectPath: string, systemPrompt: string }} opts
 */
export async function spawnItermTab({ projectPath, systemPrompt }) {
  if (process.platform !== 'darwin') {
    throw new Error(`Terminal spawn not supported on ${process.platform} yet`);
  }
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const promptPath = join(tmpdir(), `agent-office-prompt-${stamp}.txt`);
  const scriptPath = join(tmpdir(), `agent-office-launch-${stamp}.sh`);
  await writeFile(promptPath, systemPrompt, 'utf8');
  const bash = buildLaunchBashScript({ projectPath, scriptPath, promptPath });
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

export function createLauncher({
  repo,
  bus,
  resolver,
  dryRun = false,
  memoryEngine: memoryEngineOpt,
  claudeMem = null,
  watcher = null,
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
    const startedAt = new Date().toISOString();
    const sessionId = repo.createSession({
      projectId,
      personaId,
      startedAt,
      systemPrompt,
    });

    // 7. Emit SESSION_STARTED
    bus.emit(SESSION_STARTED, {
      sessionId: Number(sessionId),
      projectId,
      personaId,
      startedAt,
    });

    return {
      sessionId: Number(sessionId),
      projectPath: project.path,
      systemPrompt,
      skills,
      memories,
      startedAt,
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

    watcher?.registerLaunch?.({
      projectPath: ctx.projectPath,
      sessionId: ctx.sessionId,
      personaId,
      projectId,
      launchedAt: ctx.startedAt,
    });

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

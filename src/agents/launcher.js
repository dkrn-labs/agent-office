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
import { listLaunchProviders, resolveLaunchTarget } from './provider-catalog.js';
import { getAdapter } from '../providers/manifest.js';
import { buildLaunchBudgetRow } from '../context-budget/index.js';

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
export function buildLaunchBashScript({
  projectPath,
  scriptPath,
  promptPath,
  providerId,
  model,
  historySessionId = null,
}) {
  const q = JSON.stringify; // safe shell-quoting via JSON for paths
  const adapter = getAdapter(providerId);
  const recipe = adapter.spawn({
    projectPath,
    systemPrompt: '',           // injected via $PROMPT shell var below
    model,
    historySessionId,
  });
  // Render argv to a shell command. Binary name and --flags are bare; the
  // $PROMPT placeholder is shell-quoted; everything else (model, values)
  // gets JSON-quoted for safety.
  const argv = recipe.argv
    .map((a, i) => {
      if (a === '$PROMPT') return '"$PROMPT"';
      if (i === 0) return a;             // binary name
      if (a.startsWith('-')) return a;   // CLI flag
      return q(a);                        // value (model id, path, etc.)
    })
    .join(' ');
  const command = `exec ${argv}`;

  // Hook bridge env vars (incl. AGENT_OFFICE_HISTORY_SESSION_ID). Bare
  // tokens unquoted; everything else JSON-quoted.
  const SAFE_VAL = /^[a-zA-Z0-9_./-]+$/;
  const envLines = Object.entries(recipe.env)
    .map(([k, v]) => {
      const s = String(v);
      return `export ${k}=${SAFE_VAL.test(s) ? s : q(s)}\n`;
    })
    .join('');

  return `#!/bin/bash
cd ${q(recipe.cwd)} || exit 1
clear
${envLines}PROMPT="$(cat ${q(promptPath)})"
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
    // Terminal.app: if a window is already open, create a tab in the front
    // window and run there; otherwise fall back to the default new-window
    // behavior.
    return `tell application "Terminal"
  set terminalHasWindow to (count of windows) > 0
  activate
  if terminalHasWindow then
    tell application "System Events" to keystroke "t" using command down
    delay 0.1
    do script "${esc(cmd)}" in selected tab of front window
  else
    do script "${esc(cmd)}"
  end if
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
export async function spawnItermTab({
  projectPath,
  systemPrompt,
  providerId,
  model,
  historySessionId = null,
}) {
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
    historySessionId,
  });
  await writeFile(scriptPath, bash, { mode: 0o755, encoding: 'utf8' });
  const terminal = detectTerminal();
  const script = buildItermScript({ scriptPath, terminal });
  // Use execFile (no shell) so multi-line AppleScript reaches osascript
  // intact. exec('osascript -e "..."') goes through the shell which mangles
  // newlines and quotes.
  await execFileAsync('osascript', ['-e', script]);
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

    let historySection = '';
    let lastSession = null;
    let personaObservations = [];
    let brief = null;
    if (projectHistory) {
      const history = await projectHistory.getLaunchHistory(project.id, persona, {
        overrideObservationIds: Array.isArray(options.selectedObservationIds)
          ? options.selectedObservationIds
          : null,
        customInstructions: options.customInstructions ?? null,
      });
      lastSession = history.lastSession;
      personaObservations = history.personaObservations;
      historySection = history.section;
      brief = history.brief ?? null;
    }

    const template = persona.systemPromptTemplate?.trim() ?? '';
    const baseSystemPrompt = template
      ? template
          .replace('{{project}}', project.name ?? '')
          .replace('{{techStack}}', (project.techStack ?? []).join(', '))
          .replace('{{skills}}', resolvedSkills.map((s) => s.preview).join('\n\n'))
          .replace('{{memories}}', formatForContext(memories))
      : buildFallbackSystemPrompt(persona, project, resolvedSkills, memories);
    const systemPrompt = historySection
      ? `${historySection}\n\n${baseSystemPrompt}`
      : baseSystemPrompt;

    const launchTarget = resolveLaunchTarget(options.providerId, options.model);

    return {
      persona,
      project,
      resolvedSkills,
      memories,
      lastSession,
      personaObservations,
      brief,
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
    const { persona, project, systemPrompt, resolvedSkills, memories, launchTarget, brief, personaObservations, installedSkills } = await buildLaunchContext(
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

    let historySessionId = null;
    if (projectHistory && typeof projectHistory.createLaunch === 'function') {
      const created = projectHistory.createLaunch({
        projectId,
        personaId,
        providerId: launchTarget.providerId,
        startedAt,
        model: launchTarget.model,
        systemPrompt,
      });
      historySessionId = created.historySessionId;
    }

    // P1-4 — persist baseline vs optimized token counts so the savings pill
    // has real data. Best-effort: never block a launch on this.
    if (historySessionId != null && typeof repo.upsertLaunchBudget === 'function') {
      try {
        const allObservations = typeof repo.listHistoryObservations === 'function'
          ? repo.listHistoryObservations({ projectId, limit: 50 })
          : [];
        const personaTemplate = persona.systemPromptTemplate ?? '';
        const budget = buildLaunchBudgetRow({
          providerId: launchTarget.providerId,
          model: launchTarget.model,
          optimized: {
            systemPrompt: personaTemplate,
            skills: resolvedSkills.map((s) => ({ body: s.preview ?? '' })),
            personaObservations,
            memories,
          },
          baseline: {
            systemPrompt: personaTemplate,
            allSkills: (installedSkills ?? []).map((s) => ({ body: s.content ?? s.preview ?? '' })),
            allObservations,
            allMemories: memories,
          },
          cost: null,
        });
        repo.upsertLaunchBudget({
          historySessionId,
          providerId: budget.providerId,
          model: budget.model,
          baselineTokens: budget.baselineTokens,
          optimizedTokens: budget.optimizedTokens,
          baselineBreakdown: budget.baselineBreakdown,
          optimizedBreakdown: budget.optimizedBreakdown,
          costDollars: budget.costDollars,
          cloudEquivalentDollars: budget.cloudEquivalentDollars,
          createdAtEpoch: Math.floor(Date.now() / 1000),
        });
      } catch (err) {
        console.warn('[launcher] launch_budget persist failed:', err.message);
      }
    }

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
      brief: brief
        ? {
            enabled: brief.enabled,
            usedTokens: brief.usedTokens,
            budgetTokens: brief.budgetTokens,
            sourceCount: brief.sourceCount,
          }
        : null,
    });

    return {
      sessionId: Number(sessionId),
      historySessionId,
      projectPath: project.path,
      systemPrompt,
      skills: resolvedSkills,
      memories,
      brief,
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
        historySessionId: ctx.historySessionId,
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
      brief,
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
      brief,
    };
  }

  /**
   * Return the candidate observations the launch wizard's Step 3 renders as
   * checkboxes, plus the IDs the auto-brief would default-select.
   */
  async function memoryCandidates(personaId, projectId, { limit = 10 } = {}) {
    const persona = repo.getPersona(personaId);
    if (!persona) throw new Error(`Persona not found: ${personaId}`);
    const project = repo.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const history = projectHistory
      ? await projectHistory.getLaunchHistory(project.id, persona, {
          personaObservationLimit: limit,
        })
      : { personaObservations: [], brief: null };

    return {
      candidates: history.personaObservations.map((o) => ({
        id: o.id,
        type: o.type,
        title: o.title,
        subtitle: o.subtitle,
        providerId: o.providerId,
        filesModified: o.filesModified ?? [],
        createdAt: o.createdAt,
      })),
      defaultSelectedIds: history.brief?.observationIds ?? [],
      lastSession: history.lastSession,
    };
  }

  return { prepareLaunch, launch, preview, memoryCandidates };
}

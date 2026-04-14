import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createSkillResolver } from '../../src/agents/skill-resolver.js';
import { createEventBus } from '../../src/core/event-bus.js';
import { SESSION_STARTED } from '../../src/core/events.js';
import { detectTerminal } from '../../src/agents/terminal-detector.js';
import { createLauncher } from '../../src/agents/launcher.js';
import { createMemoryEngine } from '../../src/memory/memory-engine.js';

// ── Shared setup ─────────────────────────────────────────────────────────────

let db;
let dir;
let repo;
let resolver;
let bus;
let launcher;

// Fixtures
let projectId;
let personaId;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-launcher-test-'));
  db = openDatabase(join(dir, 'test.db'));
  await runMigrations(db);
  repo = createRepository(db);
  resolver = createSkillResolver(repo);
  bus = createEventBus();
  launcher = createLauncher({ repo, bus, resolver, dryRun: true });

  // Seed a project
  projectId = Number(
    repo.createProject({
      path: '/tmp/test-project',
      name: 'Test Project',
      techStack: ['node', 'react'],
    }),
  );

  // Seed a persona with a system prompt template
  personaId = Number(
    repo.createPersona({
      label: 'Frontend Dev',
      domain: 'frontend',
      secondaryDomains: ['review'],
      systemPromptTemplate:
        'You are working on {{project}}. Stack: {{techStack}}.\n\nSkills:\n{{skills}}\n\nMemories:\n{{memories}}',
      source: 'built-in',
    }),
  );

  // Seed a matching skill
  repo.createSkill({
    name: 'React Component Patterns',
    domain: 'frontend',
    applicableStacks: ['react'],
    content: 'Prefer function components with hooks.',
    source: 'built-in',
  });
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('detectTerminal', () => {
  it('returns a known terminal type string', () => {
    const known = new Set(['iterm', 'terminal-app', 'kitty', 'wezterm', 'generic']);
    const result = detectTerminal();
    assert.ok(known.has(result), `expected a known terminal type, got "${result}"`);
  });
});

describe('Launcher.prepareLaunch', () => {
  it('builds context with a hydrated system prompt containing the project name', async () => {
    const ctx = await launcher.prepareLaunch(personaId, projectId);
    assert.ok(
      ctx.systemPrompt.includes('Test Project'),
      'system prompt should contain the project name',
    );
  });

  it('creates a session record accessible via repo.getSession', async () => {
    const ctx = await launcher.prepareLaunch(personaId, projectId);
    const session = repo.getSession(ctx.sessionId);
    assert.ok(session, 'session should exist in the database');
    assert.equal(Number(session.projectId), projectId);
    assert.equal(Number(session.personaId), personaId);
  });

  it('emits SESSION_STARTED event with sessionId, projectId, personaId', async () => {
    let captured = null;
    const unsub = bus.on(SESSION_STARTED, (data) => {
      captured = data;
    });

    const ctx = await launcher.prepareLaunch(personaId, projectId);
    unsub();

    assert.ok(captured !== null, 'SESSION_STARTED should have been emitted');
    assert.equal(captured.sessionId, ctx.sessionId);
    assert.equal(captured.projectId, projectId);
    assert.equal(captured.personaId, personaId);
  });

  it('returns a skills array', async () => {
    const ctx = await launcher.prepareLaunch(personaId, projectId);
    assert.ok(Array.isArray(ctx.skills), 'skills should be an array');
    assert.ok(ctx.skills.length > 0, 'skills array should contain at least one resolved skill');
    const names = ctx.skills.map((s) => s.name);
    assert.ok(names.includes('React Component Patterns'), 'should include the seeded skill');
  });

  it('returns a memories array including memories added to the project', async () => {
    // Add a memory for this project before calling prepareLaunch
    repo.createMemory({
      projectId,
      domain: 'frontend',
      type: 'pattern',
      content: 'Always lazy-load heavy components.',
      sourcePersonaId: null,
    });

    const ctx = await launcher.prepareLaunch(personaId, projectId);
    assert.ok(Array.isArray(ctx.memories), 'memories should be an array');
    const contents = ctx.memories.map((m) => m.content);
    assert.ok(
      contents.includes('Always lazy-load heavy components.'),
      'should include the memory that was added to the project',
    );
  });

  it('domain-filters memories: only domains matching the persona appear in memories', async () => {
    // Seed memories in different domains for the project
    repo.createMemory({
      projectId,
      domain: 'backend',
      type: 'note',
      content: 'Backend-only memory that should be excluded.',
      sourcePersonaId: null,
    });
    repo.createMemory({
      projectId,
      domain: 'general',
      type: 'note',
      content: 'General memory always included.',
      sourcePersonaId: null,
    });
    repo.createMemory({
      projectId,
      domain: 'frontend',
      type: 'note',
      content: 'Frontend memory that should be included.',
      sourcePersonaId: null,
    });

    // The frontend persona has domain 'frontend' and secondaryDomains ['review']
    const ctx = await launcher.prepareLaunch(personaId, projectId);
    const domains = ctx.memories.map((m) => m.domain);

    assert.ok(
      !domains.includes('backend'),
      'backend domain memories should not appear for a frontend persona',
    );
    assert.ok(
      domains.includes('frontend') || domains.includes('general'),
      'frontend/general domain memories should be present',
    );
  });

  it('formatForContext output appears in the systemPrompt', async () => {
    // Seed a memory so formatForContext produces non-empty output
    repo.createMemory({
      projectId,
      domain: 'frontend',
      type: 'tip',
      content: 'Use CSS modules for scoped styles.',
      sourcePersonaId: null,
    });

    const ctx = await launcher.prepareLaunch(personaId, projectId);

    // formatForContext produces markdown sections like "### frontend"
    assert.ok(
      ctx.systemPrompt.includes('### frontend'),
      'systemPrompt should contain formatForContext markdown heading',
    );
    assert.ok(
      ctx.systemPrompt.includes('Use CSS modules for scoped styles.'),
      'systemPrompt should contain memory content from formatForContext',
    );
  });
});

// ── buildItermScript tests ───────────────────────────────────────────────────

import { buildItermScript } from '../../src/agents/launcher.js';

describe('buildItermScript()', () => {
  it('produces AppleScript that cds and runs claude with system prompt', () => {
    const script = buildItermScript({
      projectPath: '/Users/alice/Projects/web',
      systemPrompt: 'You are a Frontend Engineer.',
    });
    assert.ok(script.includes('tell application "iTerm"'));
    assert.ok(script.includes('create tab with default profile'));
    // AppleScript escape turns " into \" — so the cd quotes appear as \" in the script.
    assert.ok(script.includes(String.raw`cd \"/Users/alice/Projects/web\"`));
    assert.ok(script.includes('claude --system-prompt'));
    assert.ok(script.includes('You are a Frontend Engineer.'));
  });

  it('escapes double quotes and backslashes in project paths', () => {
    const script = buildItermScript({
      projectPath: '/tmp/weird "path"',
      systemPrompt: 'hello',
    });
    // JSON.stringify turns " into \" (one backslash + quote).
    // The AppleScript escape step then doubles each backslash and escapes
    // each remaining quote → \\\" in the final string (3 backslashes + quote).
    assert.ok(
      script.includes(String.raw`\\\"path\\\"`),
      `expected triple-escaped quotes, got: ${script}`,
    );
  });

  it('escapes single quotes in the system prompt via shell quoting', () => {
    const script = buildItermScript({
      projectPath: '/tmp/p',
      systemPrompt: "it's a test",
    });
    // Shell single-quote escape: ' becomes '\''. AppleScript then doubles the
    // backslash, yielding '\\''  in the final script.
    assert.ok(
      script.includes(String.raw`it'\\''s a test`),
      `expected shell-escaped single quote, got: ${script}`,
    );
  });
});

describe('createLauncher with claudeMem adapter', () => {
  it('prepends last-session summary and persona observations to systemPrompt', async () => {
    const claudeMem = {
      getLastSession: (name) => ({
        title: `Last work on ${name}`,
        completed: 'Shipped Phase 4.5',
        nextSteps: 'Do Phase 5',
        at: '2026-04-13',
      }),
      getObservations: () => [
        {
          id: 1,
          title: 'Fixed click handler',
          subtitle: 'coord transform',
          narrative: 'details',
          type: 'bugfix',
          filesModified: ['ui/src/office/OfficeCanvas.jsx'],
          createdAt: '2026-04-13',
        },
      ],
      close: () => {},
    };
    const launcherWithMem = createLauncher({ repo, bus, resolver, dryRun: true, claudeMem });
    const ctx = await launcherWithMem.prepareLaunch(personaId, projectId);

    assert.match(ctx.systemPrompt, /## Last Session/);
    assert.match(ctx.systemPrompt, /Shipped Phase 4\.5/);
    assert.match(ctx.systemPrompt, /## Recent Work as Frontend/);
    assert.match(ctx.systemPrompt, /Fixed click handler/);
  });

  it('gracefully handles null claudeMem (no adapter)', async () => {
    const ctx = await launcher.prepareLaunch(personaId, projectId);
    assert.ok(!ctx.systemPrompt.includes('## Last Session'));
    assert.ok(!ctx.systemPrompt.includes('## Recent Work as'));
  });
});

describe('launcher.preview()', () => {
  it('returns context without creating a session or emitting events', async () => {
    let emitted = false;
    const unsubscribe = bus.on(SESSION_STARTED, () => { emitted = true; });

    const result = await launcher.preview(personaId, projectId);
    unsubscribe();

    assert.equal(emitted, false, 'preview must NOT emit SESSION_STARTED');
    assert.ok(result.persona, 'returns persona');
    assert.ok(result.project, 'returns project');
    assert.ok(Array.isArray(result.skills), 'returns skills array');
    assert.ok(Array.isArray(result.memories), 'returns memories array');
    assert.ok('lastSession' in result, 'returns lastSession field');
    assert.ok(Array.isArray(result.personaObservations), 'returns personaObservations array');
  });

  it('throws Persona not found for unknown persona', async () => {
    await assert.rejects(
      () => launcher.preview(999999, projectId),
      /Persona not found/,
    );
  });
});

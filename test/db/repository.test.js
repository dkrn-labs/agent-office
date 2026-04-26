import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';

// ── Shared setup ─────────────────────────────────────────────────────────────

let db;
let dir;
let repo;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-repo-test-'));
  db = openDatabase(join(dir, 'test.db'));
  await runMigrations(db);
  repo = createRepository(db);
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── Projects ─────────────────────────────────────────────────────────────────

describe('Projects', () => {
  let projectId;

  it('createProject returns a numeric id', () => {
    projectId = repo.createProject({
      path: '/test/my-app',
      name: 'my-app',
      techStack: ['node', 'react'],
      gitRemote: 'git@github.com:user/my-app.git',
      defaultBranch: 'main',
    });
    assert.ok(typeof projectId === 'number' || typeof projectId === 'bigint');
    assert.ok(Number(projectId) > 0);
  });

  it('getProject returns the created project with parsed JSON fields', () => {
    const project = repo.getProject(projectId);
    assert.ok(project);
    assert.equal(project.id, Number(projectId));
    assert.equal(project.path, '/test/my-app');
    assert.equal(project.name, 'my-app');
    assert.deepEqual(project.techStack, ['node', 'react']);
    assert.equal(project.gitRemote, 'git@github.com:user/my-app.git');
    assert.equal(project.defaultBranch, 'main');
    assert.equal(project.active, true);
  });

  it('getProject returns null for unknown id', () => {
    const project = repo.getProject(999999);
    assert.equal(project, null);
  });

  it('getProjectByPath returns the matching project', () => {
    const project = repo.getProjectByPath('/test/my-app');
    assert.ok(project);
    assert.equal(project.name, 'my-app');
  });

  it('resolveProjectByPath returns the nearest registered parent project', () => {
    const project = repo.resolveProjectByPath('/test/my-app/src/api/server.js');
    assert.ok(project);
    assert.equal(project.name, 'my-app');
  });

  it('resolveProjectByPath prefers the longest matching project path', () => {
    repo.createProject({ path: '/test/my-app/packages/plugin', name: 'plugin' });
    const project = repo.resolveProjectByPath('/test/my-app/packages/plugin/src/index.js');
    assert.ok(project);
    assert.equal(project.name, 'plugin');
  });

  it('listProjects returns all projects', () => {
    // Create a second project to ensure list works.
    repo.createProject({ path: '/test/other-app', name: 'other-app' });
    const projects = repo.listProjects();
    assert.ok(projects.length >= 2);
    const names = projects.map((p) => p.name);
    assert.ok(names.includes('my-app'));
    assert.ok(names.includes('other-app'));
  });

  it('listProjects with active:true filters inactive projects', () => {
    // Create and then deactivate a project.
    const inactiveId = repo.createProject({
      path: '/test/inactive-app',
      name: 'inactive-app',
    });
    repo.updateProject(inactiveId, { active: false });

    const activeProjects = repo.listProjects({ active: true });
    const names = activeProjects.map((p) => p.name);
    assert.ok(!names.includes('inactive-app'), 'inactive project should be excluded');
    assert.ok(names.includes('my-app'), 'active project should be included');
  });

  it('updateProject updates fields', () => {
    repo.updateProject(projectId, {
      name: 'my-app-updated',
      defaultBranch: 'develop',
    });
    const project = repo.getProject(projectId);
    assert.equal(project.name, 'my-app-updated');
    assert.equal(project.defaultBranch, 'develop');
    // Other fields unchanged
    assert.equal(project.path, '/test/my-app');
    assert.deepEqual(project.techStack, ['node', 'react']);
  });

  it('deleteProject removes the row', () => {
    const tempId = repo.createProject({
      path: '/test/temp-project',
      name: 'temp-project',
    });
    assert.ok(repo.getProject(tempId));
    repo.deleteProject(tempId);
    assert.equal(repo.getProject(tempId), null);
  });
});

// ── Personas ─────────────────────────────────────────────────────────────────

describe('Personas', () => {
  let personaId;

  it('createPersona returns a numeric id', () => {
    personaId = repo.createPersona({
      label: 'Frontend Dev',
      domain: 'frontend',
      secondaryDomains: ['ui', 'css'],
      characterSprite: 'frontend_dev',
      skillIds: [1, 2, 3],
      systemPromptTemplate: 'You are a frontend expert.',
      source: 'built-in',
    });
    assert.ok(Number(personaId) > 0);
  });

  it('getPersona returns the created persona with parsed JSON fields', () => {
    const persona = repo.getPersona(personaId);
    assert.ok(persona);
    assert.equal(persona.id, Number(personaId));
    assert.equal(persona.label, 'Frontend Dev');
    assert.equal(persona.domain, 'frontend');
    assert.deepEqual(persona.secondaryDomains, ['ui', 'css']);
    assert.equal(persona.characterSprite, 'frontend_dev');
    assert.deepEqual(persona.skillIds, [1, 2, 3]);
    assert.equal(persona.systemPromptTemplate, 'You are a frontend expert.');
    assert.equal(persona.source, 'built-in');
  });

  it('getPersona returns null for unknown id', () => {
    assert.equal(repo.getPersona(999999), null);
  });

  it('listPersonas returns all personas', () => {
    repo.createPersona({
      label: 'Backend Dev',
      domain: 'backend',
      secondaryDomains: [],
      skillIds: [],
      source: 'built-in',
    });
    const personas = repo.listPersonas();
    assert.ok(personas.length >= 2);
    const labels = personas.map((p) => p.label);
    assert.ok(labels.includes('Frontend Dev'));
    assert.ok(labels.includes('Backend Dev'));
  });
});

// ── Skills ────────────────────────────────────────────────────────────────────

describe('Skills', () => {
  let skillId;

  it('createSkill returns a numeric id', () => {
    skillId = repo.createSkill({
      name: 'React Hooks',
      domain: 'frontend',
      applicableStacks: ['react', 'next'],
      content: 'Use useState and useEffect for state management.',
      source: 'built-in',
    });
    assert.ok(Number(skillId) > 0);
  });

  it('getSkill returns the created skill with parsed JSON fields', () => {
    const skill = repo.getSkill(skillId);
    assert.ok(skill);
    assert.equal(skill.id, Number(skillId));
    assert.equal(skill.name, 'React Hooks');
    assert.equal(skill.domain, 'frontend');
    assert.deepEqual(skill.applicableStacks, ['react', 'next']);
    assert.equal(skill.content, 'Use useState and useEffect for state management.');
    assert.equal(skill.source, 'built-in');
  });

  it('getSkill returns null for unknown id', () => {
    assert.equal(repo.getSkill(999999), null);
  });
});

// ── Memories ─────────────────────────────────────────────────────────────────

describe('Memories', () => {
  let projectId;
  let personaId;
  let memoryId;

  before(() => {
    projectId = repo.createProject({
      path: '/test/memory-project',
      name: 'memory-project',
    });
    personaId = repo.createPersona({
      label: 'Memory Persona',
      domain: 'testing',
      secondaryDomains: [],
      skillIds: [],
      source: 'test',
    });
  });

  it('createMemory returns a numeric id', () => {
    memoryId = repo.createMemory({
      projectId,
      domain: 'frontend',
      type: 'pattern',
      content: 'Uses React with TypeScript',
      sourcePersonaId: personaId,
    });
    assert.ok(Number(memoryId) > 0);
  });

  it('getMemory returns the created memory', () => {
    const memory = repo.getMemory(memoryId);
    assert.ok(memory);
    assert.equal(memory.id, Number(memoryId));
    assert.equal(memory.projectId, Number(projectId));
    assert.equal(memory.domain, 'frontend');
    assert.equal(memory.type, 'pattern');
    assert.equal(memory.content, 'Uses React with TypeScript');
    assert.equal(memory.status, 'active');
    assert.equal(memory.sourcePersonaId, Number(personaId));
  });

  it('getMemory returns null for unknown id', () => {
    assert.equal(repo.getMemory(999999), null);
  });

  it('listMemories with domain filter returns only matching domains', () => {
    // Create memories in different domains.
    repo.createMemory({ projectId, domain: 'backend', type: 'fact', content: 'Uses Express' });
    repo.createMemory({ projectId, domain: 'devops', type: 'fact', content: 'Uses Docker' });

    const filtered = repo.listMemories({ projectId, domains: ['frontend', 'backend'] });
    const domains = filtered.map((m) => m.domain);
    assert.ok(domains.every((d) => ['frontend', 'backend'].includes(d)));
    assert.ok(domains.includes('frontend'));
    assert.ok(domains.includes('backend'));
    assert.ok(!domains.includes('devops'), 'devops domain should be excluded');
  });

  it('listMemories with projectId filter scopes to that project', () => {
    const otherProjectId = repo.createProject({
      path: '/test/other-memory-project',
      name: 'other-memory-project',
    });
    repo.createMemory({
      projectId: otherProjectId,
      domain: 'frontend',
      type: 'pattern',
      content: 'Other project memory',
    });

    const memories = repo.listMemories({ projectId });
    const ids = memories.map((m) => m.projectId);
    assert.ok(ids.every((id) => id === Number(projectId)));
  });

  it('listMemories with status filter returns only matching status', () => {
    // Archive one memory.
    repo.updateMemory(memoryId, { status: 'archived' });

    const activeMemories = repo.listMemories({ projectId, status: 'active' });
    const archivedMemories = repo.listMemories({ projectId, status: 'archived' });

    assert.ok(activeMemories.every((m) => m.status === 'active'));
    assert.ok(archivedMemories.some((m) => m.id === Number(memoryId)));
  });
});

// ── Project History ──────────────────────────────────────────────────────────

describe('Project history', () => {
  let projectId;
  let historySessionId;

  before(() => {
    projectId = repo.createProject({
      path: '/test/history-project',
      name: 'history-project',
    });
  });

  it('creates and looks up a history session by provider id', () => {
    historySessionId = repo.createHistorySession({
      projectId,
      providerId: 'gemini-cli',
      providerSessionId: 'session-123',
      startedAt: '2026-04-16T10:00:00.000Z',
      endedAt: '2026-04-16T10:30:00.000Z',
      status: 'completed',
      model: 'gemini-2.5-flash',
    });
    const session = repo.getHistorySessionByProvider('gemini-cli', 'session-123');
    assert.ok(session);
    assert.equal(session.id, Number(historySessionId));
    assert.equal(session.projectId, Number(projectId));
    assert.equal(session.model, 'gemini-2.5-flash');
  });

  it('stores summaries and observations with parsed JSON fields', () => {
    repo.createHistorySummary({
      historySessionId,
      projectId,
      providerId: 'gemini-cli',
      completed: 'Implemented provider-neutral history.',
      nextSteps: 'Wire hooks.',
      filesRead: ['src/api/server.js'],
      filesEdited: ['src/db/repository.js'],
      createdAt: '2026-04-16T10:31:00.000Z',
    });
    repo.createHistoryObservation({
      historySessionId,
      projectId,
      providerId: 'gemini-cli',
      type: 'feature',
      title: 'Added ingestion route',
      filesModified: ['src/api/routes/history.js'],
      facts: ['Uses provider-neutral history tables'],
      createdAt: '2026-04-16T10:32:00.000Z',
    });

    const summaries = repo.listHistorySummaries({ projectId, limit: 5 });
    const observations = repo.listHistoryObservations({ projectId, limit: 5 });

    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].completed, 'Implemented provider-neutral history.');
    assert.deepEqual(summaries[0].filesEdited, ['src/db/repository.js']);

    assert.equal(observations.length, 1);
    assert.equal(observations[0].title, 'Added ingestion route');
    assert.deepEqual(observations[0].filesModified, ['src/api/routes/history.js']);
    assert.deepEqual(observations[0].facts, ['Uses provider-neutral history tables']);
  });
});

// ── Sessions ─────────────────────────────────────────────────────────────────

describe('Sessions', () => {
  let projectId;
  let personaId;

  before(() => {
    projectId = repo.createProject({
      path: '/test/session-project',
      name: 'session-project',
    });
    personaId = repo.createPersona({
      label: 'Session Persona',
      domain: 'testing',
      secondaryDomains: [],
      skillIds: [],
      source: 'test',
    });
  });

  it('createSession returns a numeric id', () => {
    const sessionId = repo.createSession({ projectId, personaId });
    assert.ok(Number(sessionId) > 0);
  });

  it('getSession returns the created session with defaults', () => {
    const sessionId = repo.createSession({
      projectId,
      personaId,
      providerId: 'claude-code',
    });
    const session = repo.getSession(sessionId);
    assert.ok(session);
    assert.equal(session.id, Number(sessionId));
    assert.equal(session.projectId, Number(projectId));
    assert.equal(session.personaId, Number(personaId));
    assert.equal(session.providerId, 'claude-code');
    assert.equal(session.tokensIn, 0);
    assert.equal(session.tokensOut, 0);
    assert.equal(session.outcome, 'unknown');
  });

  it('getSession returns null for unknown id', () => {
    assert.equal(repo.getSession(999999), null);
  });

  it('updateSession updates fields', () => {
    const sessionId = repo.createSession({ projectId, personaId });
    repo.updateSession(sessionId, {
      outcome: 'success',
      tokensIn: 1000,
      tokensOut: 500,
    });
    const session = repo.getSession(sessionId);
    assert.equal(session.outcome, 'success');
    assert.equal(session.tokensIn, 1000);
    assert.equal(session.tokensOut, 500);
  });
});

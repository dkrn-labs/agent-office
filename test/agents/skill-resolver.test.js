import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createSkillResolver } from '../../src/agents/skill-resolver.js';

// ── Shared setup ─────────────────────────────────────────────────────────────

let db;
let dir;
let repo;
let resolver;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-skill-resolver-test-'));
  db = openDatabase(join(dir, 'test.db'));
  await runMigrations(db);
  repo = createRepository(db);
  resolver = createSkillResolver(repo);
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePersona(domain) {
  return { domain, secondaryDomains: [] };
}

function makeProject(techStack) {
  return { techStack };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SkillResolver.resolve', () => {
  it('returns skills matching persona domain and project stack', () => {
    repo.createSkill({
      name: 'React Hook Patterns',
      domain: 'frontend',
      applicableStacks: ['react'],
      content: 'Use custom hooks to encapsulate logic.',
      source: 'built-in',
    });

    const skills = resolver.resolve(makePersona('frontend'), makeProject(['react']));
    const names = skills.map((s) => s.name);
    assert.ok(names.includes('React Hook Patterns'), 'should include matching skill');
  });

  it('includes "general" domain skills regardless of persona domain', () => {
    repo.createSkill({
      name: 'Universal Git Guide',
      domain: 'general',
      applicableStacks: [],
      content: 'Commit early, commit often.',
      source: 'built-in',
    });

    const backendSkills = resolver.resolve(makePersona('backend'), makeProject(['express']));
    const frontendSkills = resolver.resolve(makePersona('frontend'), makeProject(['react']));

    assert.ok(
      backendSkills.some((s) => s.name === 'Universal Git Guide'),
      'backend persona should see general skills',
    );
    assert.ok(
      frontendSkills.some((s) => s.name === 'Universal Git Guide'),
      'frontend persona should see general skills',
    );
  });

  it('includes universal skills (empty applicableStacks) for any tech stack', () => {
    repo.createSkill({
      name: 'Review Checklist',
      domain: 'review',
      applicableStacks: [],
      content: 'Check for missing error handling.',
      source: 'built-in',
    });

    const skills = resolver.resolve(makePersona('review'), makeProject(['rust']));
    assert.ok(
      skills.some((s) => s.name === 'Review Checklist'),
      'universal skill should appear regardless of tech stack',
    );
  });

  it('user-defined skills override built-in skills with the same name', () => {
    const sharedName = 'Shared Skill Override';

    repo.createSkill({
      name: sharedName,
      domain: 'backend',
      applicableStacks: [],
      content: 'Built-in version.',
      source: 'built-in',
    });
    repo.createSkill({
      name: sharedName,
      domain: 'backend',
      applicableStacks: [],
      content: 'User version.',
      source: 'user',
    });

    const skills = resolver.resolve(makePersona('backend'), makeProject([]));
    const matching = skills.filter((s) => s.name === sharedName);

    assert.equal(matching.length, 1, 'should have exactly one skill with the shared name');
    assert.equal(matching[0].source, 'user', 'user-defined skill should win over built-in');
    assert.equal(matching[0].content, 'User version.');
  });

  it('caps results at 20 skills', () => {
    // Insert enough skills to exceed the cap
    for (let i = 0; i < 25; i++) {
      repo.createSkill({
        name: `Cap Test Skill ${i}`,
        domain: 'devops',
        applicableStacks: [],
        content: `Skill content ${i}.`,
        source: 'built-in',
      });
    }

    const skills = resolver.resolve(makePersona('devops'), makeProject([]));
    assert.ok(skills.length <= 20, `expected at most 20 skills, got ${skills.length}`);
  });

  it('does not return skills from unrelated domains', () => {
    repo.createSkill({
      name: 'Database Indexing Guide',
      domain: 'database',
      applicableStacks: [],
      content: 'Index your foreign keys.',
      source: 'built-in',
    });

    const skills = resolver.resolve(makePersona('frontend'), makeProject(['react']));
    assert.ok(
      !skills.some((s) => s.domain === 'database'),
      'frontend persona should not see database-domain skills',
    );
  });

  it('returns an empty array when no skills match', async () => {
    // Use a completely isolated DB to guarantee an empty skill table
    const isoDir = mkdtempSync(join(tmpdir(), 'agent-office-empty-test-'));
    let isoDb;
    try {
      isoDb = openDatabase(join(isoDir, 'empty.db'));
      await runMigrations(isoDb);
      const isoRepo = createRepository(isoDb);
      const isoResolver = createSkillResolver(isoRepo);

      const skills = isoResolver.resolve(
        makePersona('ml-ops'),
        makeProject(['tensorflow', 'kubernetes']),
      );
      assert.equal(skills.length, 0, 'should return empty array when nothing matches');
    } finally {
      isoDb?.close();
      rmSync(isoDir, { recursive: true, force: true });
    }
  });
});

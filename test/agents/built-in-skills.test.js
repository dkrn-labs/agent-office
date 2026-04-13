import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { BUILT_IN_SKILLS, seedBuiltInSkills } from '../../src/agents/built-in-skills.js';

// ── Shared DB setup ───────────────────────────────────────────────────────────

let db;
let dir;
let repo;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-built-in-skills-test-'));
  db = openDatabase(join(dir, 'test.db'));
  await runMigrations(db);
  repo = createRepository(db);
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── BUILT_IN_SKILLS array ────────────────────────────────────────────────────

describe('BUILT_IN_SKILLS array', () => {
  it('exports at least 15 skills', () => {
    assert.ok(
      Array.isArray(BUILT_IN_SKILLS),
      'BUILT_IN_SKILLS should be an array',
    );
    assert.ok(
      BUILT_IN_SKILLS.length >= 15,
      `expected at least 15 skills, got ${BUILT_IN_SKILLS.length}`,
    );
  });

  it('every skill has a non-empty name string', () => {
    for (const skill of BUILT_IN_SKILLS) {
      assert.equal(typeof skill.name, 'string', `skill name should be a string: ${JSON.stringify(skill)}`);
      assert.ok(skill.name.length > 0, 'skill name should not be empty');
    }
  });

  it('every skill has a non-empty domain string', () => {
    for (const skill of BUILT_IN_SKILLS) {
      assert.equal(typeof skill.domain, 'string', `domain should be a string for skill "${skill.name}"`);
      assert.ok(skill.domain.length > 0, `domain should not be empty for skill "${skill.name}"`);
    }
  });

  it('every skill has an applicableStacks array', () => {
    for (const skill of BUILT_IN_SKILLS) {
      assert.ok(
        Array.isArray(skill.applicableStacks),
        `applicableStacks should be an array for skill "${skill.name}"`,
      );
    }
  });

  it('every skill has a non-empty content string', () => {
    for (const skill of BUILT_IN_SKILLS) {
      assert.equal(typeof skill.content, 'string', `content should be a string for skill "${skill.name}"`);
      assert.ok(skill.content.length > 0, `content should not be empty for skill "${skill.name}"`);
    }
  });

  it('every skill has source set to "built-in"', () => {
    for (const skill of BUILT_IN_SKILLS) {
      assert.equal(skill.source, 'built-in', `source should be "built-in" for skill "${skill.name}"`);
    }
  });

  it('all skill names are unique', () => {
    const names = BUILT_IN_SKILLS.map((s) => s.name);
    const unique = new Set(names);
    assert.equal(unique.size, names.length, 'duplicate skill names detected');
  });

  it('content is 3-8 lines per skill', () => {
    for (const skill of BUILT_IN_SKILLS) {
      const lines = skill.content.trim().split('\n').filter((l) => l.trim().length > 0);
      assert.ok(
        lines.length >= 3 && lines.length <= 8,
        `skill "${skill.name}" has ${lines.length} lines; expected 3-8`,
      );
    }
  });

  it('includes expected domains', () => {
    const domains = new Set(BUILT_IN_SKILLS.map((s) => s.domain));
    for (const expected of ['frontend', 'backend', 'general', 'testing', 'review', 'devops', 'debug']) {
      assert.ok(domains.has(expected), `expected domain "${expected}" not found`);
    }
  });

  it('includes skills for required stacks', () => {
    const allStacks = new Set(BUILT_IN_SKILLS.flatMap((s) => s.applicableStacks));
    for (const stack of ['react', 'typescript', 'tailwind', 'vite', 'express', 'fastify', 'flask', 'django', 'vitest', 'jest']) {
      assert.ok(allStacks.has(stack), `expected a skill for stack "${stack}"`);
    }
  });

  it('includes universal skills (empty applicableStacks)', () => {
    const universalSkills = BUILT_IN_SKILLS.filter((s) => s.applicableStacks.length === 0);
    assert.ok(
      universalSkills.length >= 3,
      `expected at least 3 universal skills, got ${universalSkills.length}`,
    );
  });
});

// ── seedBuiltInSkills ─────────────────────────────────────────────────────────

describe('seedBuiltInSkills(repo)', () => {
  it('inserts all built-in skills into an empty database', async () => {
    const result = await seedBuiltInSkills(repo);
    assert.equal(
      result.inserted,
      BUILT_IN_SKILLS.length,
      `expected ${BUILT_IN_SKILLS.length} insertions`,
    );
    assert.equal(result.skipped, 0, 'expected 0 skipped on first run');
  });

  it('listSkills returns all seeded skills', () => {
    const skills = repo.listSkills();
    assert.ok(
      skills.length >= BUILT_IN_SKILLS.length,
      `expected at least ${BUILT_IN_SKILLS.length} skills in DB, got ${skills.length}`,
    );
  });

  it('each skill in DB has required fields populated', () => {
    const skills = repo.listSkills();
    for (const skill of skills) {
      assert.ok(typeof skill.id === 'number' || typeof skill.id === 'bigint', 'id should be numeric');
      assert.equal(typeof skill.name, 'string');
      assert.ok(skill.name.length > 0);
      assert.equal(typeof skill.domain, 'string');
      assert.ok(skill.domain.length > 0);
      assert.ok(Array.isArray(skill.applicableStacks), 'applicableStacks should be parsed array');
      assert.equal(typeof skill.content, 'string');
      assert.ok(skill.content.length > 0);
      assert.equal(skill.source, 'built-in');
    }
  });

  it('is idempotent — calling seed again skips all existing skills', async () => {
    const before = repo.listSkills().length;
    const result = await seedBuiltInSkills(repo);
    const after = repo.listSkills().length;

    assert.equal(result.inserted, 0, 'should insert 0 on second run');
    assert.equal(result.skipped, BUILT_IN_SKILLS.length, `should skip all ${BUILT_IN_SKILLS.length}`);
    assert.equal(after, before, 'skill count should not change on second run');
  });

  it('calling seed a third time is still idempotent', async () => {
    const before = repo.listSkills().length;
    const result = await seedBuiltInSkills(repo);
    const after = repo.listSkills().length;

    assert.equal(result.inserted, 0);
    assert.equal(after, before);
  });
});

// ── Individual skill presence ─────────────────────────────────────────────────

describe('Required skills present in DB by name', () => {
  let skillsByName;

  before(() => {
    const skills = repo.listSkills();
    skillsByName = new Map(skills.map((s) => [s.name, s]));
  });

  const requiredNames = [
    'React Component Patterns',
    'TypeScript Strict Mode',
    'Tailwind CSS Conventions',
    'Vite Configuration',
    'Express API Patterns',
    'Fastify API Patterns',
    'Flask API Patterns',
    'Django Development Patterns',
    'Database Patterns (Prisma / Drizzle)',
    'Vitest Testing',
    'Jest Testing',
    'Git Workflow',
    'Code Review Checklist',
    'Deployment Practices',
    'Debugging Methodology',
  ];

  for (const name of requiredNames) {
    it(`skill "${name}" exists in DB`, () => {
      assert.ok(skillsByName.has(name), `skill "${name}" not found in DB`);
    });
  }
});

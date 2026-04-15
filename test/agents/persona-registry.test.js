import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createPersonaRegistry } from '../../src/agents/persona-registry.js';
import { BUILT_IN_PERSONAS } from '../../src/agents/built-in-personas.js';

// ── Shared setup ─────────────────────────────────────────────────────────────

let db;
let dir;
let repo;
let registry;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agent-office-registry-test-'));
  db = openDatabase(join(dir, 'test.db'));
  await runMigrations(db);
  repo = createRepository(db);
  registry = createPersonaRegistry(repo);
});

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── seedBuiltIns ─────────────────────────────────────────────────────────────

describe('PersonaRegistry.seedBuiltIns', () => {
  it('creates exactly 5 personas on first seed', async () => {
    await registry.seedBuiltIns();
    const personas = registry.listPersonas();
    assert.equal(personas.length, 5);
  });

  it('is idempotent — second call does not duplicate personas', async () => {
    await registry.seedBuiltIns();
    const personas = registry.listPersonas();
    assert.equal(personas.length, 5);
  });

  it('backfills missing built-in prompt templates on existing personas', async () => {
    const frontend = registry.listPersonas().find((persona) => persona.label === 'Frontend Engineer');
    assert.ok(frontend, 'expected Frontend Engineer to exist');

    repo.updatePersona(frontend.id, {
      systemPromptTemplate: null,
    });

    await registry.seedBuiltIns();

    const repaired = registry.getPersona(frontend.id);
    assert.equal(typeof repaired.systemPromptTemplate, 'string');
    assert.ok(repaired.systemPromptTemplate.includes('{{project}}'));
  });

  it('each persona has the correct primary domain', () => {
    const personas = registry.listPersonas();
    const domainsByLabel = Object.fromEntries(personas.map((p) => [p.label, p.domain]));

    assert.equal(domainsByLabel['Frontend Engineer'], 'frontend');
    assert.equal(domainsByLabel['Backend Engineer'], 'backend');
    assert.equal(domainsByLabel['Debug Specialist'], 'debug');
    assert.equal(domainsByLabel['Senior Code Reviewer'], 'review');
    assert.equal(domainsByLabel['DevOps Engineer'], 'devops');
  });

  it('each persona has at least one secondary domain', () => {
    const personas = registry.listPersonas();
    for (const persona of personas) {
      assert.ok(
        Array.isArray(persona.secondaryDomains) && persona.secondaryDomains.length > 0,
        `${persona.label} must have secondaryDomains`,
      );
    }
  });

  it('secondary domains match the built-in definitions', () => {
    const personas = registry.listPersonas();
    const builtInByLabel = Object.fromEntries(BUILT_IN_PERSONAS.map((p) => [p.label, p]));

    for (const persona of personas) {
      const expected = builtInByLabel[persona.label];
      assert.ok(expected, `No built-in definition found for "${persona.label}"`);
      assert.deepEqual(
        persona.secondaryDomains.slice().sort(),
        expected.secondaryDomains.slice().sort(),
        `${persona.label} secondaryDomains mismatch`,
      );
    }
  });

  it('each persona has a systemPromptTemplate with all required placeholders', () => {
    const placeholders = ['{{project}}', '{{techStack}}', '{{skills}}', '{{memories}}'];
    const personas = registry.listPersonas();

    for (const persona of personas) {
      assert.ok(
        typeof persona.systemPromptTemplate === 'string' &&
          persona.systemPromptTemplate.length > 0,
        `${persona.label} must have a systemPromptTemplate string`,
      );
      for (const placeholder of placeholders) {
        assert.ok(
          persona.systemPromptTemplate.includes(placeholder),
          `${persona.label} systemPromptTemplate missing placeholder "${placeholder}"`,
        );
      }
    }
  });

  it('each persona has source "built-in"', () => {
    const personas = registry.listPersonas();
    for (const persona of personas) {
      assert.equal(persona.source, 'built-in', `${persona.label} source must be "built-in"`);
    }
  });
});

// ── getPersona ────────────────────────────────────────────────────────────────

describe('PersonaRegistry.getPersona', () => {
  it('returns the correct persona by id', () => {
    const all = registry.listPersonas();
    const first = all[0];
    const fetched = registry.getPersona(first.id);
    assert.ok(fetched, 'getPersona should return an object');
    assert.equal(fetched.id, first.id);
    assert.equal(fetched.label, first.label);
    assert.equal(fetched.domain, first.domain);
  });

  it('returns null for an unknown id', () => {
    const result = registry.getPersona(999999);
    assert.equal(result, null);
  });
});

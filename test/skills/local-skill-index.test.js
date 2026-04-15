import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanLocalSkills } from '../../src/skills/local-skill-index.js';

describe('scanLocalSkills', () => {
  let rootDir;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'agent-office-local-skills-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('discovers immediate child skill directories with SKILL.md metadata', () => {
    const skillDir = join(rootDir, 'react-auditor');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '# React Auditor\n\nChecks React component quality.\n\nMore details here.\n',
      'utf8',
    );

    const skills = scanLocalSkills([rootDir]);

    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'React Auditor');
    assert.equal(skills[0].description, 'Checks React component quality.');
    assert.equal(skills[0].source, 'local');
  });

  it('ignores directories without SKILL.md', () => {
    mkdirSync(join(rootDir, 'empty-dir'), { recursive: true });

    const skills = scanLocalSkills([rootDir]);

    assert.deepEqual(skills, []);
  });
});

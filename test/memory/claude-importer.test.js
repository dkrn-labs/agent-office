import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import {
  importFromClaudeProjects,
  decodeProjectPath,
  parseFrontmatter,
} from '../../src/memory/claude-importer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return mkdtempSync(join(os.tmpdir(), 'agent-office-claude-importer-test-'));
}

/** Write a file, creating intermediate dirs as needed. */
function writeFile(dir, relPath, content) {
  const full = join(dir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

/** Build a fresh in-memory repo backed by a real SQLite file in tmpDir. */
function makeRepo(tmpDir) {
  const dbPath = join(tmpDir, 'test.db');
  const db = openDatabase(dbPath);
  // runMigrations is async but wraps synchronous SQLite calls — await it.
  return { db, repo: null, dbPath };
}

/** Encode a project path the same way Claude Code does: replace / with -. */
function encodeProjectPath(projectPath) {
  return projectPath.replace(/\//g, '-');
}

/**
 * Create a mock Claude projects directory with the given structure.
 * projects is an array of:
 *   { projectPath: '/some/path', memories: [{ filename, content }] }
 */
function buildClaudeDir(baseDir, projects) {
  const claudeDir = join(baseDir, '.claude', 'projects');
  mkdirSync(claudeDir, { recursive: true });

  for (const { projectPath, memories } of projects) {
    const encoded = encodeProjectPath(projectPath);
    const memDir = join(claudeDir, encoded, 'memory');
    mkdirSync(memDir, { recursive: true });

    for (const { filename, content } of memories) {
      writeFileSync(join(memDir, filename), content, 'utf8');
    }
  }

  return claudeDir;
}

// ---------------------------------------------------------------------------
// Unit tests for helpers (no DB needed)
// ---------------------------------------------------------------------------

describe('decodeProjectPath()', () => {
  // Claude encodes by replacing every `/` with `-`, so ALL hyphens in the
  // encoded string map back to slashes.  Paths with hyphens in folder names
  // are ambiguous — tests use hyphen-free folder names to avoid that.

  it('converts leading hyphen to slash', () => {
    assert.equal(decodeProjectPath('-Users-dev-myapp'), '/Users/dev/myapp');
  });

  it('handles nested paths', () => {
    assert.equal(
      decodeProjectPath('-Users-dehakuran-Projects-agentoffice'),
      '/Users/dehakuran/Projects/agentoffice',
    );
  });

  it('returns empty string for empty input', () => {
    assert.equal(decodeProjectPath(''), '');
  });
});

describe('parseFrontmatter()', () => {
  it('extracts name, description, type from frontmatter', () => {
    const md = `---
name: my-memory
description: A useful note
type: convention
---

The content here.`;
    const { frontmatter, body } = parseFrontmatter(md);
    assert.equal(frontmatter.name, 'my-memory');
    assert.equal(frontmatter.description, 'A useful note');
    assert.equal(frontmatter.type, 'convention');
    assert.equal(body.trim(), 'The content here.');
  });

  it('returns empty frontmatter when no --- markers', () => {
    const md = 'Just plain text.';
    const { frontmatter, body } = parseFrontmatter(md);
    assert.deepEqual(frontmatter, {});
    assert.equal(body, 'Just plain text.');
  });

  it('returns empty frontmatter when opening --- is missing', () => {
    const md = 'name: foo\n---\ncontent';
    const { frontmatter, body } = parseFrontmatter(md);
    assert.deepEqual(frontmatter, {});
  });

  it('handles frontmatter with no closing ---', () => {
    const md = '---\nname: foo\ncontent';
    const { frontmatter, body } = parseFrontmatter(md);
    assert.deepEqual(frontmatter, {});
    assert.equal(body, md);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — each test gets its own isolated DB + Claude dir
// ---------------------------------------------------------------------------

/**
 * Set up a fresh in-memory SQLite repo + a dedicated tmp dir for one test.
 * Returns { repo, db, tmpDir, claudeDir } and an async teardown function.
 */
async function setupTest() {
  const tmpDir = makeTmpDir();
  const db = openDatabase(join(tmpDir, 'test.db'));
  await runMigrations(db);
  const repo = createRepository(db);
  const claudeDir = join(tmpDir, 'claude-projects');
  mkdirSync(claudeDir, { recursive: true });
  return {
    repo,
    db,
    tmpDir,
    claudeDir,
    teardown() {
      db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe('importFromClaudeProjects()', () => {
  // ── Test 1: basic import ──────────────────────────────────────────────────

  it('imports memories from mock Claude directory', async () => {
    const { repo, db, tmpDir, claudeDir, teardown } = await setupTest();
    try {
      const projectPath = '/Users/dev/alpha';
      const projectId = repo.createProject({ path: projectPath, name: 'alpha' });

      const builtDir = buildClaudeDir(tmpDir, [
        {
          projectPath,
          memories: [
            {
              filename: 'note1.md',
              content: `---\nname: note1\ntype: convention\n---\nAlways use pnpm.`,
            },
            {
              filename: 'note2.md',
              content: `---\nname: note2\ntype: user\n---\nPrefer functional components.`,
            },
          ],
        },
      ]);

      const result = await importFromClaudeProjects(repo, builtDir);

      assert.equal(result.imported, 2);
      assert.equal(result.skipped, 0);
      assert.deepEqual(result.projects, [projectPath]);

      const memories = repo.listMemories({ projectId: Number(projectId) });
      assert.equal(memories.length, 2);
      assert.ok(memories.some((m) => m.content === 'Always use pnpm.'));
      assert.ok(memories.some((m) => m.content === 'Prefer functional components.'));
    } finally {
      teardown();
    }
  });

  // ── Test 2: encoded path matching ────────────────────────────────────────

  it('matches encoded directory name to project path', async () => {
    const { repo, db, tmpDir, teardown } = await setupTest();
    try {
      // Use a path without hyphens in folder names to avoid encode ambiguity.
      const projectPath = '/Users/dehakuran/Projects/beta';
      const projectId = repo.createProject({ path: projectPath, name: 'beta' });

      const builtDir = buildClaudeDir(tmpDir, [
        {
          projectPath,
          memories: [
            {
              filename: 'tip.md',
              content: `---\nname: tip\ntype: convention\n---\nRun tests before push.`,
            },
          ],
        },
      ]);

      const result = await importFromClaudeProjects(repo, builtDir);

      assert.equal(result.imported, 1);
      const memories = repo.listMemories({ projectId: Number(projectId) });
      assert.ok(memories.some((m) => m.content === 'Run tests before push.'));
    } finally {
      teardown();
    }
  });

  // ── Test 3: files without frontmatter are handled gracefully ─────────────

  it('handles files without frontmatter gracefully', async () => {
    const { repo, db, tmpDir, teardown } = await setupTest();
    try {
      const projectPath = '/Users/dev/gamma';
      const projectId = repo.createProject({ path: projectPath, name: 'gamma' });

      const builtDir = buildClaudeDir(tmpDir, [
        {
          projectPath,
          memories: [
            {
              filename: 'plain.md',
              content: 'No frontmatter here, just plain text.',
            },
          ],
        },
      ]);

      const result = await importFromClaudeProjects(repo, builtDir);

      assert.equal(result.imported, 1);
      assert.equal(result.skipped, 0);

      const memories = repo.listMemories({ projectId: Number(projectId) });
      assert.ok(
        memories.some((m) => m.content === 'No frontmatter here, just plain text.'),
      );
      // type should default to 'convention'
      const mem = memories.find((m) => m.content === 'No frontmatter here, just plain text.');
      assert.equal(mem.type, 'convention');
    } finally {
      teardown();
    }
  });

  // ── Test 4: skips duplicates on re-import ─────────────────────────────────

  it('skips duplicates on re-import', async () => {
    const { repo, db, tmpDir, teardown } = await setupTest();
    try {
      const projectPath = '/Users/dev/delta';
      repo.createProject({ path: projectPath, name: 'delta' });

      const builtDir = buildClaudeDir(tmpDir, [
        {
          projectPath,
          memories: [
            {
              filename: 'dup.md',
              content: `---\nname: dup\ntype: convention\n---\nDon't repeat yourself.`,
            },
          ],
        },
      ]);

      const first = await importFromClaudeProjects(repo, builtDir);
      assert.equal(first.imported, 1);
      assert.equal(first.skipped, 0);

      const second = await importFromClaudeProjects(repo, builtDir);
      assert.equal(second.imported, 0);
      assert.equal(second.skipped, 1);
    } finally {
      teardown();
    }
  });

  // ── Test 5: correct imported/skipped counts ───────────────────────────────

  it('returns correct imported and skipped counts', async () => {
    const { repo, db, tmpDir, teardown } = await setupTest();
    try {
      const projectPath = '/Users/dev/epsilon';
      const projectId = repo.createProject({ path: projectPath, name: 'epsilon' });

      const builtDir = buildClaudeDir(tmpDir, [
        {
          projectPath,
          memories: [
            {
              filename: 'a.md',
              content: `---\nname: a\ntype: convention\n---\nContent A`,
            },
            {
              filename: 'b.md',
              content: `---\nname: b\ntype: user\n---\nContent B`,
            },
            {
              filename: 'c.md',
              content: `---\nname: c\ntype: convention\n---\nContent C`,
            },
          ],
        },
      ]);

      // Pre-populate one memory so it gets skipped.
      repo.createMemory({
        projectId: Number(projectId),
        domain: 'general',
        type: 'convention',
        content: 'Content A',
      });

      const result = await importFromClaudeProjects(repo, builtDir);

      assert.equal(result.imported, 2);
      assert.equal(result.skipped, 1);
      assert.deepEqual(result.projects, [projectPath]);
    } finally {
      teardown();
    }
  });

  // ── Test 6: empty memory directory ───────────────────────────────────────

  it('handles an empty memory directory', async () => {
    const { repo, db, tmpDir, teardown } = await setupTest();
    try {
      const projectPath = '/Users/dev/zeta';
      repo.createProject({ path: projectPath, name: 'zeta' });

      const builtDir = buildClaudeDir(tmpDir, [
        { projectPath, memories: [] },
      ]);

      const result = await importFromClaudeProjects(repo, builtDir);

      assert.equal(result.imported, 0);
      assert.equal(result.skipped, 0);
      assert.deepEqual(result.projects, []);
    } finally {
      teardown();
    }
  });

  // ── Test 7: claudeDir doesn't exist ──────────────────────────────────────

  it('returns empty result when claudeDir does not exist', async () => {
    const { repo, db, tmpDir, teardown } = await setupTest();
    try {
      const nonExistent = join(tmpDir, 'no-such-dir', '.claude', 'projects');

      const result = await importFromClaudeProjects(repo, nonExistent);

      assert.equal(result.imported, 0);
      assert.equal(result.skipped, 0);
      assert.deepEqual(result.projects, []);
    } finally {
      teardown();
    }
  });

  // ── Test 8: unknown encoded paths are silently skipped ───────────────────

  it('silently skips subdirs that do not match any known project', async () => {
    const { repo, db, tmpDir, teardown } = await setupTest();
    try {
      const builtDir = buildClaudeDir(tmpDir, [
        {
          projectPath: '/Users/dev/unknownproject',
          memories: [
            { filename: 'note.md', content: `---\ntype: user\n---\nSome note.` },
          ],
        },
      ]);

      // Do NOT register /Users/dev/unknownproject in the repo.
      const result = await importFromClaudeProjects(repo, builtDir);

      assert.equal(result.imported, 0);
      assert.equal(result.skipped, 0);
      assert.deepEqual(result.projects, []);
    } finally {
      teardown();
    }
  });
});

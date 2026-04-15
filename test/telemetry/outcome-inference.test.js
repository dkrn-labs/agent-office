import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { inferOutcome } from '../../src/telemetry/outcome-inference.js';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitEnv(cwd, env, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
}

/** Initialise a repo with the seed commit backdated 30 seconds in the past. */
function initRepo(dir) {
  const pastDate = new Date(Date.now() - 30_000).toISOString();
  const dateEnv = { GIT_AUTHOR_DATE: pastDate, GIT_COMMITTER_DATE: pastDate };
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'user.name',  'tester');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'initial.txt'), 'seed\n');
  git(dir, 'add', '.');
  gitEnv(dir, dateEnv, 'commit', '-q', '-m', 'seed');
}

let repo;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'outcome-test-'));
  initRepo(repo);
});
after(() => { /* tmp dirs cleaned per-test below */ });

describe('inferOutcome', () => {
  it('returns unknown when .git is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-git-'));
    try {
      const result = await inferOutcome({
        projectPath: dir,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        endedAt:   new Date().toISOString(),
      });
      assert.equal(result.outcome, 'unknown');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('classifies as accepted when commits are produced in window', async () => {
    // seed commit is 30s in the past; startedAt is 10s ago — seed is excluded
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    writeFileSync(join(repo, 'new.txt'), 'work\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'feature work');

    const result = await inferOutcome({
      projectPath: repo,
      startedAt,
      endedAt: new Date().toISOString(),
    });
    assert.equal(result.outcome, 'accepted');
    assert.equal(result.signals.commitsProduced, 1);
  });

  it('classifies as partial when diff exists but no commits', async () => {
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    writeFileSync(join(repo, 'initial.txt'), 'edited\n');  // uncommitted change

    const result = await inferOutcome({
      projectPath: repo,
      startedAt,
      endedAt: new Date().toISOString(),
    });
    assert.equal(result.outcome, 'partial');
    assert.equal(result.signals.diffExists, true);
    assert.equal(result.signals.commitsProduced, 0);
  });

  it('classifies as rejected when a stash push occurred in window', async () => {
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    writeFileSync(join(repo, 'initial.txt'), 'throwaway\n');
    git(repo, 'stash', 'push', '-m', 'test-stash');

    const result = await inferOutcome({
      projectPath: repo,
      startedAt,
      endedAt: new Date().toISOString(),
    });
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.signals.stashOrReset, true);
  });

  it('classifies as unknown when nothing happened', async () => {
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    const result = await inferOutcome({
      projectPath: repo,
      startedAt,
      endedAt: new Date().toISOString(),
    });
    assert.equal(result.outcome, 'unknown');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { openDatabase, runMigrations } from '../../src/db/database.js';
import { createRepository } from '../../src/db/repository.js';
import { createPortfolioStatsService } from '../../src/stats/portfolio-stats.js';

function git(cwd, args, env = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      ...env,
    },
  });
}

// Time-relative assertions need time-relative fixtures. Pinning these to a
// hardcoded date causes the suite to silently rot once `today` rolls past
// the chosen day (issue #0001). Use a "now"-anchored helper so commits and
// session timestamps always land inside the rolling windows the assertions
// check, regardless of when the suite runs.
function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe('createPortfolioStatsService', () => {
  it('scans repos and stores window snapshots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-office-portfolio-'));
    const repoDir = join(root, 'repo-a');
    mkdirSync(repoDir, { recursive: true });
    git(repoDir, ['init']);
    writeFileSync(join(repoDir, 'a.txt'), 'hello\n', 'utf8');
    git(repoDir, ['add', '.']);
    const commitIso = nowIso(-60 * 60 * 1000); // 1h ago — safely inside the today window
    git(repoDir, ['commit', '-m', 'init'], {
      GIT_AUTHOR_DATE: commitIso,
      GIT_COMMITTER_DATE: commitIso,
    });

    const db = openDatabase(':memory:');
    await runMigrations(db);
    const repo = createRepository(db);
    const projectId = Number(repo.createProject({ path: repoDir, name: 'repo-a' }));
    const personaId = Number(repo.createPersona({
      label: 'Backend',
      domain: 'backend',
      secondaryDomains: [],
      skillIds: [],
      source: 'test',
    }));
    const sessionStart = nowIso(-30 * 60 * 1000); // 30m ago
    const sessionEnd   = nowIso(-20 * 60 * 1000); // 20m ago
    const sessionId = repo.createSession({
      projectId,
      personaId,
      startedAt: sessionStart,
      systemPrompt: 'prompt',
    });
    repo.updateSession(sessionId, {
      endedAt: sessionEnd,
      tokensIn: 1_000_000,
      tokensOut: 500_000,
      commitsProduced: 1,
    });
    const historySessionId = Number(repo.createHistorySession({
      projectId,
      personaId,
      providerId: 'claude-code',
      providerSessionId: 'pf-test-a',
      startedAt: sessionStart,
      endedAt: sessionEnd,
      status: 'completed',
      source: 'launcher',
    }));
    repo.upsertHistorySessionMetrics(historySessionId, {
      tokensIn: 1_000_000,
      tokensOut: 500_000,
      commitsProduced: 1,
    });

    const service = createPortfolioStatsService({ repo, projectsDir: root, ttlMs: 0 });
    const stats = await service.getAll({ force: true });

    assert.equal(stats.today.repoCount, 1);
    assert.equal(stats.today.commitCount, 1);
    assert.equal(stats.today.fileCount, 1);
    assert.equal(stats.today.sessionCount, 1);
    assert.equal(stats.today.tokenTotal, 1_500_000);

    const cached = repo.getPortfolioStatsSnapshot('today');
    assert.ok(cached);
    assert.equal(cached.commitCount, 1);

    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('skips a git wrapper at the projects root and scans child repos', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-office-portfolio-root-'));
    git(root, ['init']);

    const repoA = join(root, 'repo-a');
    const repoB = join(root, 'group', 'repo-b');
    mkdirSync(repoA, { recursive: true });
    mkdirSync(repoB, { recursive: true });

    const commitA = nowIso(-2 * 60 * 60 * 1000); // 2h ago
    const commitB = nowIso(-1 * 60 * 60 * 1000); // 1h ago

    git(repoA, ['init']);
    writeFileSync(join(repoA, 'a.txt'), 'hello\n', 'utf8');
    git(repoA, ['add', '.']);
    git(repoA, ['commit', '-m', 'init-a'], {
      GIT_AUTHOR_DATE: commitA,
      GIT_COMMITTER_DATE: commitA,
    });

    git(repoB, ['init']);
    writeFileSync(join(repoB, 'b.txt'), 'world\n', 'utf8');
    git(repoB, ['add', '.']);
    git(repoB, ['commit', '-m', 'init-b'], {
      GIT_AUTHOR_DATE: commitB,
      GIT_COMMITTER_DATE: commitB,
    });

    const db = openDatabase(':memory:');
    await runMigrations(db);
    const repo = createRepository(db);
    const service = createPortfolioStatsService({ repo, projectsDir: root, ttlMs: 0 });

    const stats = await service.getAll({ force: true });

    assert.equal(stats.today.repoCount, 2);
    assert.equal(stats.today.commitCount, 2);
    assert.equal(stats.today.fileCount, 2);

    db.close();
    rmSync(root, { recursive: true, force: true });
  });
});

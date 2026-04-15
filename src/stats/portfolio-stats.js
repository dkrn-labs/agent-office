import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_SCAN_DEPTH = 4;
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
]);

const WINDOW_DEFS = {
  today: {
    start(now = new Date()) {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    },
  },
  '7d': {
    start(now = new Date()) {
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    },
  },
  '30d': {
    start(now = new Date()) {
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    },
  },
};

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findGitRepos(rootDir, depth = 0, found = []) {
  if (depth > MAX_SCAN_DEPTH) return found;

  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return found;
  }

  const hasGitDir = entries.some((entry) => entry.name === '.git');
  if (hasGitDir) {
    if (depth > 0) {
      found.push(rootDir);
      return found;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    await findGitRepos(join(rootDir, entry.name), depth + 1, found);
  }
  return found;
}

async function runGit(repoPath, args) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
      maxBuffer: 1024 * 1024 * 16,
    });
    return stdout.trimEnd();
  } catch {
    return '';
  }
}

async function collectRepoStats(repoPath, sinceIso) {
  const sinceArg = `--since=${sinceIso}`;
  const [commitCountRaw, filesRaw] = await Promise.all([
    runGit(repoPath, ['rev-list', '--count', 'HEAD', sinceArg]),
    runGit(repoPath, ['log', sinceArg, '--name-only', '--pretty=format:']),
  ]);

  const commitCount = Number(commitCountRaw.trim() || 0);
  const files = new Set(
    filesRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );

  return {
    repoPath,
    commitCount,
    fileCount: files.size,
  };
}

export function createPortfolioStatsService({ repo, projectsDir, ttlMs = 10 * 60 * 1000 } = {}) {
  async function computeWindow(window, now = new Date()) {
    const def = WINDOW_DEFS[window];
    if (!def) throw new Error(`Unknown portfolio stats window: ${window}`);
    const since = def.start(now).toISOString();
    const repoPaths = await findGitRepos(projectsDir);
    const repoStats = await Promise.all(repoPaths.map((repoPath) => collectRepoStats(repoPath, since)));
    const computedAt = now.toISOString();

    const snapshot = {
      window,
      computedAt,
      repoCount: repoPaths.length,
      commitCount: repoStats.reduce((sum, item) => sum + item.commitCount, 0),
      fileCount: repoStats.reduce((sum, item) => sum + item.fileCount, 0),
      sessionCount: repo.countSessionsSince(since),
      tokenTotal: repo.sumTokensSince(since),
    };
    repo.upsertPortfolioStatsSnapshot(snapshot);
    return snapshot;
  }

  async function getWindow(window, { force = false } = {}) {
    const cached = repo.getPortfolioStatsSnapshot(window);
    if (!force && cached?.computedAt) {
      const ageMs = Date.now() - new Date(cached.computedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs < ttlMs) return cached;
    }
    return computeWindow(window);
  }

  async function getAll({ force = false } = {}) {
    const entries = await Promise.all(
      Object.keys(WINDOW_DEFS).map(async (window) => [window, await getWindow(window, { force })]),
    );
    return Object.fromEntries(entries);
  }

  return {
    getWindow,
    getAll,
  };
}

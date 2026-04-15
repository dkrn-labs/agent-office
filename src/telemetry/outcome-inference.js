import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const GIT_LOG_MAX = 100;

/**
 * Classify a session outcome based on git signals.
 *
 * @param {{ projectPath: string, startedAt: string, endedAt: string }} args
 * @returns {Promise<{
 *   outcome: 'accepted' | 'partial' | 'rejected' | 'unknown',
 *   signals: { commitsProduced: number, diffExists: boolean, stashOrReset: boolean }
 * }>}
 */
export async function inferOutcome({ projectPath, startedAt, endedAt }) {
  if (!existsSync(join(projectPath, '.git'))) {
    return { outcome: 'unknown', signals: {} };
  }

  const [commits, diffExists, stashOrReset] = await Promise.all([
    countCommits(projectPath, startedAt, endedAt),
    hasUncommittedDiff(projectPath),
    hasStashOrReset(projectPath, startedAt),
  ]);

  const signals = { commitsProduced: commits, diffExists, stashOrReset };

  if (stashOrReset)  return { outcome: 'rejected', signals };
  if (commits > 0)   return { outcome: 'accepted', signals };
  if (diffExists)    return { outcome: 'partial',  signals };
  return { outcome: 'unknown', signals };
}

async function countCommits(projectPath, startedAt, endedAt) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', `--since=${startedAt}`, `--until=${endedAt}`, `--max-count=${GIT_LOG_MAX}`, '--all', '--format=%H'],
      { cwd: projectPath },
    );
    return stdout.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function hasUncommittedDiff(projectPath) {
  try {
    await execFileAsync('git', ['diff', '--quiet'], { cwd: projectPath });
    await execFileAsync('git', ['diff', '--cached', '--quiet'], { cwd: projectPath });
    return false;
  } catch {
    return true;  // non-zero exit = diff exists
  }
}

async function hasStashOrReset(projectPath, startedAt) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['reflog', `--since=${startedAt}`],
      { cwd: projectPath },
    );
    return /\bstash\b|reset: moving to HEAD/.test(stdout);
  } catch {
    return false;
  }
}

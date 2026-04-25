import { createLogger } from '../core/logger.js';
import { scanDirectory } from '../skills/project-scanner.js';

const log = createLogger('project-sync');

/**
 * Keeps DB-backed projects roughly in sync with the configured projectsDir.
 * Sync is TTL-gated so list endpoints can safely call it.
 *
 * @param {{
 *   repo: ReturnType<import('../db/repository.js').createRepository>,
 *   projectsDir: string,
 *   ttlMs?: number,
 * }} options
 */
export function createProjectSyncService({ repo, projectsDir, ttlMs = 0 } = {}) {
  let lastSyncedAt = 0;
  let inFlight = null;

  async function syncNow(reason = 'manual') {
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const startedAt = Date.now();
      const scanned = scanDirectory(projectsDir);
      const seenPaths = new Set(scanned.map((project) => project.path));
      const existing = repo.listProjects();

      let created = 0;
      let updated = 0;
      let reactivated = 0;
      let deactivated = 0;

      for (const project of scanned) {
        const existingProject = repo.getProjectByPath(project.path);
        if (!existingProject) {
          repo.createProject({
            path: project.path,
            name: project.name,
            techStack: project.techStack,
          });
          created += 1;
          continue;
        }

        const fields = {};
        if (existingProject.name !== project.name) fields.name = project.name;
        if (JSON.stringify(existingProject.techStack ?? []) !== JSON.stringify(project.techStack ?? [])) {
          fields.techStack = project.techStack;
        }
        if (existingProject.active === false) {
          fields.active = true;
          reactivated += 1;
        }
        if (Object.keys(fields).length > 0) {
          repo.updateProject(existingProject.id, fields);
          updated += 1;
        }
      }

      for (const project of existing) {
        if (project.active !== false && !seenPaths.has(project.path)) {
          repo.updateProject(project.id, { active: false });
          deactivated += 1;
        }
      }

      lastSyncedAt = Date.now();
      log.info('project sync complete', {
        reason,
        projectsDir,
        scanned: scanned.length,
        created,
        updated,
        reactivated,
        deactivated,
        durationMs: lastSyncedAt - startedAt,
      });
    })();

    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }

  async function syncIfStale(reason = 'list-request') {
    if (ttlMs <= 0) {
      await syncNow(reason);
      return;
    }
    const ageMs = Date.now() - lastSyncedAt;
    if (lastSyncedAt > 0 && ageMs < ttlMs) {
      log.debug('project sync skipped', { reason, ageMs, ttlMs });
      return;
    }
    await syncNow(reason);
  }

  return {
    syncNow,
    syncIfStale,
  };
}

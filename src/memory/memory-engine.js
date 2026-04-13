/**
 * Memory Engine — high-level interface over the repository memory layer.
 *
 * Usage:
 *   import { createMemoryEngine } from './memory-engine.js';
 *   const engine = createMemoryEngine(repo);
 *
 * @param {ReturnType<import('../db/repository.js').createRepository>} repo
 */
export function createMemoryEngine(repo) {
  /**
   * Return active memories relevant to a persona for a given project.
   * Includes the persona's primary domain, any secondary domains, and the
   * 'general' domain. Only memories with status 'active' are returned.
   *
   * @param {number} projectId
   * @param {{ domain: string, secondaryDomains?: string[] }} persona
   * @returns {object[]} Memory[]
   */
  function queryForPersona(projectId, persona) {
    const domains = [
      persona.domain,
      ...(persona.secondaryDomains ?? []),
      'general',
    ];
    return repo.listMemories({ projectId, domains, status: 'active' });
  }

  /**
   * Create a new memory record.
   *
   * @param {{ projectId: number, domain: string, type: string, content: string, sourcePersonaId?: number }} fields
   * @returns {number} memory_id
   * @throws {Error} if any required field is missing
   */
  function create({ projectId, domain, type, content, sourcePersonaId } = {}) {
    if (projectId == null) throw new Error('create: projectId is required');
    if (!domain) throw new Error('create: domain is required');
    if (!type) throw new Error('create: type is required');
    if (!content) throw new Error('create: content is required');

    return repo.createMemory({ projectId, domain, type, content, sourcePersonaId });
  }

  /**
   * Update arbitrary fields on an existing memory.
   *
   * @param {number} memoryId
   * @param {object} fields  Subset of memory fields (camelCase).
   * @returns {void}
   */
  function update(memoryId, fields) {
    repo.updateMemory(memoryId, fields);
  }

  /**
   * Archive a memory with an optional staleness signal explaining why.
   *
   * @param {number} memoryId
   * @param {string} [signal]  Human-readable reason for archiving.
   * @returns {void}
   */
  function archive(memoryId, signal) {
    repo.updateMemory(memoryId, { status: 'archived', stalenessSignal: signal });
  }

  /**
   * Mark a memory as verified: bump verification_count by 1 and set
   * last_verified_at to the current ISO timestamp.
   *
   * @param {number} memoryId
   * @returns {void}
   */
  function verify(memoryId) {
    const memory = repo.getMemory(memoryId);
    if (!memory) throw new Error(`verify: memory ${memoryId} not found`);

    repo.updateMemory(memoryId, {
      verificationCount: (memory.verificationCount ?? 0) + 1,
      lastVerifiedAt: new Date().toISOString(),
    });
  }

  /**
   * Return all memories for a project regardless of domain or status.
   *
   * @param {number} projectId
   * @returns {object[]} Memory[]
   */
  function getProjectMemories(projectId) {
    return repo.listMemories({ projectId });
  }

  /**
   * Return a summary of memory counts broken down by status.
   *
   * @param {number} projectId
   * @returns {{ total: number, active: number, stale: number, archived: number }}
   */
  function getStats(projectId) {
    const memories = repo.listMemories({ projectId });
    const stats = { total: memories.length, active: 0, stale: 0, archived: 0 };
    for (const m of memories) {
      if (m.status === 'active') stats.active++;
      else if (m.status === 'stale') stats.stale++;
      else if (m.status === 'archived') stats.archived++;
    }
    return stats;
  }

  return {
    queryForPersona,
    create,
    update,
    archive,
    verify,
    getProjectMemories,
    getStats,
  };
}

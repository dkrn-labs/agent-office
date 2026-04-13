/**
 * Persona Registry — wraps the repository with seed logic for built-in personas.
 *
 * Usage:
 *   import { createPersonaRegistry } from './persona-registry.js';
 *   const registry = createPersonaRegistry(repo);
 *   await registry.seedBuiltIns();
 *
 * @param {ReturnType<import('../db/repository.js').createRepository>} repo
 */

import { BUILT_IN_PERSONAS } from './built-in-personas.js';

export function createPersonaRegistry(repo) {
  /**
   * Insert each built-in persona if a persona with the same label does not
   * already exist (idempotent — safe to call on every startup).
   *
   * @returns {Promise<void>}
   */
  async function seedBuiltIns() {
    const existing = repo.listPersonas();
    const existingLabels = new Set(existing.map((p) => p.label));

    for (const persona of BUILT_IN_PERSONAS) {
      if (!existingLabels.has(persona.label)) {
        repo.createPersona(persona);
      }
    }
  }

  /**
   * List all personas (delegates to repo).
   * @returns {object[]}
   */
  function listPersonas() {
    return repo.listPersonas();
  }

  /**
   * Get a single persona by id (delegates to repo).
   * @param {number} id
   * @returns {object|null}
   */
  function getPersona(id) {
    return repo.getPersona(id);
  }

  return { seedBuiltIns, listPersonas, getPersona };
}

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
    const existingByLabel = new Map(existing.map((p) => [p.label, p]));

    for (const persona of BUILT_IN_PERSONAS) {
      const current = existingByLabel.get(persona.label);
      if (!current) {
        repo.createPersona(persona);
        continue;
      }

      const patch = {};
      if (!current.domain && persona.domain) patch.domain = persona.domain;
      if ((!current.secondaryDomains || current.secondaryDomains.length === 0) && persona.secondaryDomains) {
        patch.secondaryDomains = persona.secondaryDomains;
      }
      if (!current.characterSprite && persona.characterSprite) patch.characterSprite = persona.characterSprite;
      if ((!current.skillIds || current.skillIds.length === 0) && persona.skillIds) patch.skillIds = persona.skillIds;
      if (!current.systemPromptTemplate && persona.systemPromptTemplate) {
        patch.systemPromptTemplate = persona.systemPromptTemplate;
      }
      if (!current.source && persona.source) patch.source = persona.source;

      if (Object.keys(patch).length > 0) {
        repo.updatePersona(current.id, patch);
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

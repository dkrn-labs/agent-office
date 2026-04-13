/**
 * Skill Resolver — selects and ranks skills for a given persona + project.
 *
 * Algorithm (spec section 3.3):
 *   1. Get all skills from DB
 *   2. Stack filter: keep skills where applicableStacks is empty (universal)
 *      OR any element of applicableStacks is in project.techStack
 *   3. Domain filter: keep skills where domain IN (persona.domain, 'general')
 *   4. Dedup by name: if user-defined and built-in share the same name,
 *      keep user-defined only
 *   5. Sort: user source first, then by lastUsedAt DESC (nulls last)
 *   6. Cap at 20
 *
 * Note: secondaryDomains are NOT used here — only primary domain + 'general'.
 *
 * @param {ReturnType<import('../db/repository.js').createRepository>} db
 */
export function createSkillResolver(db) {
  /**
   * Resolve applicable skills for a persona working on a project.
   *
   * @param {{ domain: string, secondaryDomains?: string[] }} persona
   * @param {{ techStack: string[] }} project
   * @returns {object[]} Skill[]
   */
  function resolve(persona, project) {
    const allSkills = db.listSkills();
    const techStackSet = new Set(project.techStack ?? []);
    const allowedDomains = new Set([persona.domain, 'general']);

    // Step 2: Stack filter
    const stackFiltered = allSkills.filter((skill) => {
      const stacks = skill.applicableStacks ?? [];
      return stacks.length === 0 || stacks.some((s) => techStackSet.has(s));
    });

    // Step 3: Domain filter
    const domainFiltered = stackFiltered.filter((skill) =>
      allowedDomains.has(skill.domain),
    );

    // Step 4: Dedup by name — user-defined wins over built-in
    const byName = new Map();
    for (const skill of domainFiltered) {
      if (!byName.has(skill.name)) {
        byName.set(skill.name, skill);
      } else {
        const existing = byName.get(skill.name);
        // Replace if the new entry is user-defined and existing is not
        if (skill.source === 'user' && existing.source !== 'user') {
          byName.set(skill.name, skill);
        }
      }
    }

    // Step 5: Sort — user source first, then by lastUsedAt DESC (nulls last)
    const deduped = Array.from(byName.values());
    deduped.sort((a, b) => {
      // Primary: user before built-in
      const aIsUser = a.source === 'user' ? 0 : 1;
      const bIsUser = b.source === 'user' ? 0 : 1;
      if (aIsUser !== bIsUser) return aIsUser - bIsUser;

      // Secondary: lastUsedAt DESC, nulls last
      if (a.lastUsedAt === b.lastUsedAt) return 0;
      if (a.lastUsedAt === null) return 1;
      if (b.lastUsedAt === null) return -1;
      return b.lastUsedAt < a.lastUsedAt ? -1 : 1;
    });

    // Step 6: Cap at 20
    return deduped.slice(0, 20);
  }

  return { resolve };
}

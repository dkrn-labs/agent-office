function dedupeSkills(skills) {
  const precedence = { user: 0, local: 1, builtin: 2, 'built-in': 2 };
  const byName = new Map();

  for (const skill of skills) {
    const existing = byName.get(skill.name);
    if (!existing) {
      byName.set(skill.name, skill);
      continue;
    }
    const existingRank = precedence[existing.source] ?? 99;
    const nextRank = precedence[skill.source] ?? 99;
    if (nextRank < existingRank) {
      byName.set(skill.name, skill);
    }
  }

  return Array.from(byName.values());
}

function sortSkills(a, b) {
  const aIsUser = a.source === 'user' ? 0 : 1;
  const bIsUser = b.source === 'user' ? 0 : 1;
  if (aIsUser !== bIsUser) return aIsUser - bIsUser;
  if (a.lastUsedAt === b.lastUsedAt) return a.name.localeCompare(b.name);
  if (a.lastUsedAt === null) return 1;
  if (b.lastUsedAt === null) return -1;
  return b.lastUsedAt < a.lastUsedAt ? -1 : 1;
}

function keywordMatch(skill, project) {
  const haystack = [
    skill.name,
    skill.description,
    skill.path,
    ...(skill.applicableStacks ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (project.techStack ?? []).filter((tech) => haystack.includes(String(tech).toLowerCase()));
}

function explainSkill(skill, persona, project) {
  const reasons = [];
  if (skill.domain === persona.domain) {
    reasons.push({ type: 'persona-domain', label: `${persona.domain} persona match` });
  } else if (skill.domain === 'general') {
    reasons.push({ type: 'general-domain', label: 'general-purpose skill' });
  }

  const matchingStacks = (skill.applicableStacks ?? []).filter((stack) =>
    (project.techStack ?? []).includes(stack),
  );
  if (matchingStacks.length > 0) {
    reasons.push({ type: 'project-stack', label: `matches ${matchingStacks.join(', ')}` });
  }

  const keywordStacks = keywordMatch(skill, project).filter((stack) =>
    !matchingStacks.includes(stack),
  );
  if (keywordStacks.length > 0) {
    reasons.push({ type: 'project-context', label: `suggested by ${keywordStacks.join(', ')}` });
  }

  return reasons;
}

/**
 * @param {ReturnType<import('../db/repository.js').createRepository>} db
 * @param {{ localSkillInventory?: object[] }} [options]
 */
export function createSkillResolver(db, { localSkillInventory = [] } = {}) {
  function listInstalledSkills() {
    return dedupeSkills([...db.listSkills(), ...localSkillInventory]).sort(sortSkills);
  }

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
    const deduped = dedupeSkills(domainFiltered);

    // Step 5: Sort — user source first, then by lastUsedAt DESC (nulls last)
    deduped.sort(sortSkills);

    // Step 6: Cap at 20
    return deduped.slice(0, 20);
  }

  function inventoryForLaunch(persona, project) {
    const resolved = resolve(persona, project).map((skill) => ({
      ...skill,
      reasons: explainSkill(skill, persona, project),
    }));
    const resolvedNames = new Set(resolved.map((skill) => skill.name));
    const installed = listInstalledSkills();
    const recommended = installed
      .filter((skill) => !resolvedNames.has(skill.name))
      .map((skill) => ({ ...skill, reasons: explainSkill(skill, persona, project) }))
      .filter((skill) =>
        skill.reasons.some((reason) => reason.type !== 'general-domain'),
      )
      .sort((a, b) => b.reasons.length - a.reasons.length || a.name.localeCompare(b.name))
      .slice(0, 6);

    return {
      installed,
      resolved,
      recommended,
    };
  }

  return { resolve, listInstalledSkills, inventoryForLaunch };
}

/**
 * Filter observations from claude-mem to those most relevant to a given persona.
 *
 * Heuristics by persona.domain:
 *   frontend → filesModified match /(^|\/)ui\/|\.jsx$|\.tsx$|\.css$/
 *   backend  → filesModified match /(^|\/)(src|api|db)\// AND NOT /(^|\/)ui\//
 *   debug    → type === 'bugfix'
 *   review   → type === 'refactor'
 *   devops   → filesModified match /docker|\.ya?ml$|\.github\/|ci\/|deploy/i
 *
 * @param {Array<{ id:number, type:string, filesModified:string[], createdAt:string }>} observations
 * @param {{ domain: string }} persona
 * @param {{ limit?: number }} [options]
 * @returns {Array<typeof observations[number]>}
 */
export function filterObservationsForPersona(observations, persona, { limit = 10 } = {}) {
  const predicate = predicateFor(persona.domain);
  if (!predicate) return [];
  return observations
    .filter(predicate)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, limit);
}

function predicateFor(domain) {
  switch (domain) {
    case 'frontend':
      return (o) => o.filesModified.some((f) => /(^|\/)ui\/|\.jsx$|\.tsx$|\.css$/.test(f));
    case 'backend':
      return (o) =>
        o.filesModified.some((f) => /(^|\/)(src|api|db)\//.test(f)) &&
        !o.filesModified.some((f) => /(^|\/)ui\//.test(f));
    case 'debug':
      return (o) => o.type === 'bugfix';
    case 'review':
      return (o) => o.type === 'refactor';
    case 'devops':
      return (o) => o.filesModified.some((f) => /docker|\.ya?ml$|\.github\/|ci\/|deploy/i.test(f));
    default:
      return null;
  }
}

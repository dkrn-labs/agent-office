/**
 * Filter observations to those most relevant to a given persona.
 *
 * Combines path-based and type-based heuristics. Type taxonomy adopted
 * from claude-mem (https://github.com/thedotmack/claude-mem) plus
 * `refactor`. Classification happens at ingest time in
 * src/history/classify-observation.js.
 *
 * @param {Array<{ id:number, type:string, filesModified:string[], filesRead?:string[], createdAt:string }>} observations
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

const FRONTEND_PATH = /(^|\/)ui\/|\.jsx$|\.tsx$|\.css$|\.scss$|\.svelte$|\.vue$/;
const BACKEND_PATH = /(^|\/)(src|api|server|db|migrations?)\//;
const UI_PATH = /(^|\/)ui\//;
const DEVOPS_PATH = /(?:dockerfile|docker-compose|\.ya?ml$|\.github\/|ci\/|deploy|terraform|\.tf$|k8s|kubernetes)/i;

const FRONTEND_TYPES = new Set(['feature', 'change', 'refactor', 'bugfix']);
const BACKEND_TYPES = new Set(['feature', 'change', 'refactor', 'bugfix', 'decision']);
const DEBUG_TYPES = new Set(['bugfix', 'discovery']);
const REVIEW_TYPES = new Set(['refactor', 'decision', 'security_alert', 'security_note']);
const DEVOPS_TYPES = new Set(['change', 'feature', 'refactor', 'security_alert', 'security_note', 'decision']);

function predicateFor(domain) {
  switch (domain) {
    case 'frontend':
      return (o) =>
        o.filesModified.some((f) => FRONTEND_PATH.test(f)) &&
        FRONTEND_TYPES.has(o.type);
    case 'backend':
      return (o) =>
        o.filesModified.some((f) => BACKEND_PATH.test(f)) &&
        !o.filesModified.some((f) => UI_PATH.test(f)) &&
        BACKEND_TYPES.has(o.type);
    case 'debug':
      return (o) => DEBUG_TYPES.has(o.type);
    case 'review':
      return (o) => REVIEW_TYPES.has(o.type);
    case 'devops':
      return (o) =>
        o.filesModified.some((f) => DEVOPS_PATH.test(f)) &&
        DEVOPS_TYPES.has(o.type);
    default:
      return null;
  }
}

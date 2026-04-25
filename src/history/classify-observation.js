/**
 * Observation classifier — assigns a `type` to a history observation.
 *
 * Adopts the claude-mem taxonomy
 * (https://github.com/thedotmack/claude-mem) plus `refactor`:
 *
 *   bugfix · feature · refactor · decision · discovery
 *   security_alert · security_note · change (fallback) · summary (fallback)
 *
 * Heuristics evaluated in order; first match wins. Pure function.
 */

const RX_TEST_FILE = /(?:^|\/)(?:tests?|__tests__|spec|specs)\/|\.(?:test|spec)\.[a-z0-9]+$/i;
const RX_BUGFIX_VERB = /\b(bug|fix(ed|es|ing)?|crash(ed)?|error|traceback|regression|broken|repro(duce|duction)?)\b/i;
const RX_FEATURE_VERB = /\b(add(ed|ing)?|introduc(e|ed|ing)|implement(ed|ing|s)?|new\s+(feature|component|endpoint|page|route))\b/i;
const RX_REFACTOR_VERB = /\b(refactor(ed|ing|s)?|rename(d|s)?|extract(ed|ing|s)?|split(ting)?|consolidat(e|ed|ing)|reorganiz(e|ed|ing)|move(d|s)?\s+(into|to))\b/i;
const RX_DECISION_VERB = /\b(decid(ed|e|ing)|chose|chosen|pick(ed)?|opted|selected|rejected|going\s+with|went\s+with)\b/i;
const RX_DISCOVERY_VERB = /\b(found that|turns out|actually|discovered|realiz(ed|e)|noticed|surfaced)\b/i;
const RX_SECURITY_FILE = /(?:^|\/)\.env(\.|$)|secrets|credentials?|\.pem$|\.key$/i;
const RX_SECURITY_TOPIC = /\b(password|api[\s_-]?key|secret|access[\s_-]?token|csrf|xss|sql\s+injection|sanitiz(e|ed|ing)|escape\s+(html|user)|leaked|hardcoded\s+(key|token|secret))\b/i;
const RX_SECURITY_VULN = /\b(vulnerab(le|ility|ilities)|cve-|exposed|exfiltrat(e|ed|ion)|attack(ed|s)?|exploit(ed|s)?)\b/i;

const RX_COMMIT_FIX = /^\s*(fix|bug|bugfix|hotfix)\s*[:(]/i;
const RX_COMMIT_FEAT = /^\s*(feat|feature|add)\s*[:(]/i;
const RX_COMMIT_REFACTOR = /^\s*(refactor|chore|cleanup|rename)\s*[:(]/i;

function any(re, ...sources) {
  for (const s of sources) {
    if (typeof s === 'string' && re.test(s)) return true;
  }
  return false;
}

function hasTestPaired(filesModified) {
  if (!Array.isArray(filesModified) || filesModified.length < 2) return false;
  const tests = filesModified.filter((f) => RX_TEST_FILE.test(f));
  const nonTests = filesModified.filter((f) => !RX_TEST_FILE.test(f));
  return tests.length > 0 && nonTests.length > 0;
}

/**
 * Classify a single observation's type.
 *
 * @param {{
 *   filesModified?: string[],
 *   filesRead?: string[],
 *   summary?: string,
 *   completed?: string,
 *   commitMessage?: string,
 *   toolCalls?: Array<{ name?: string }>,
 * }} input
 * @returns {string} one of: bugfix, feature, refactor, decision, discovery,
 *                  security_alert, security_note, change, summary
 */
export function classifyObservation(input = {}) {
  const filesModified = Array.isArray(input.filesModified) ? input.filesModified : [];
  const filesRead = Array.isArray(input.filesRead) ? input.filesRead : [];
  const summary = typeof input.summary === 'string' ? input.summary : '';
  const completed = typeof input.completed === 'string' ? input.completed : '';
  const commit = typeof input.commitMessage === 'string' ? input.commitMessage : '';
  const text = `${summary}\n${completed}`;

  // 1. security_alert — concrete vulnerability touching sensitive files / topics
  const touchesSecretFile = filesModified.some((f) => RX_SECURITY_FILE.test(f));
  if (
    touchesSecretFile ||
    (any(RX_SECURITY_TOPIC, text) && any(RX_SECURITY_VULN, text))
  ) {
    return 'security_alert';
  }

  // 2. security_note — security-adjacent topic but no vulnerability framing
  if (any(RX_SECURITY_TOPIC, text)) {
    return 'security_note';
  }

  // 3. bugfix
  if (
    RX_COMMIT_FIX.test(commit) ||
    hasTestPaired(filesModified) ||
    any(RX_BUGFIX_VERB, text)
  ) {
    return 'bugfix';
  }

  // 4. refactor — must come before feature so "rename + add" leans refactor
  if (
    RX_COMMIT_REFACTOR.test(commit) ||
    any(RX_REFACTOR_VERB, text)
  ) {
    return 'refactor';
  }

  // 5. feature
  if (
    RX_COMMIT_FEAT.test(commit) ||
    any(RX_FEATURE_VERB, text)
  ) {
    return 'feature';
  }

  // 6. decision — design discussion w/o code change
  if (
    any(RX_DECISION_VERB, text) &&
    filesModified.length === 0
  ) {
    return 'decision';
  }

  // 7. discovery — read-heavy turn with discovery verbs
  if (
    filesRead.length > 0 &&
    filesModified.length === 0 &&
    any(RX_DISCOVERY_VERB, text)
  ) {
    return 'discovery';
  }

  // Fallbacks
  if (filesModified.length > 0) return 'change';
  return 'summary';
}

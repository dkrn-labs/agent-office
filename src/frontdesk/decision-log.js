import { createHash } from 'node:crypto';

/**
 * Stable sha256 hex of a task string. The hash never leaves the local DB,
 * but using a hash (rather than the raw text) means the table is safe to
 * snapshot for support/debugging without leaking the operator's prompts.
 *
 * @param {string} task
 * @returns {string}
 */
export function hashTask(task) {
  return createHash('sha256').update(String(task ?? ''), 'utf8').digest('hex');
}

/**
 * Append-only writer for `frontdesk_decision` rows. Wraps the repo so the
 * runner can stay I/O-free and tests can inject a fake.
 *
 * @param {{ repo: { recordFrontdeskDecision: Function } }} deps
 */
export function createDecisionLog({ repo }) {
  if (!repo || typeof repo.recordFrontdeskDecision !== 'function') {
    throw new Error('createDecisionLog requires a repo with recordFrontdeskDecision');
  }

  /**
   * @param {{
   *   task: string,
   *   rulesApplied?: string[],
   *   llmInput?: object|null,
   *   llmOutput?: object|null,
   *   userAccepted?: object|null,
   *   outcome?: string|null,
   * }} entry
   * @returns {number} inserted row id
   */
  function record(entry) {
    return repo.recordFrontdeskDecision({
      taskHash: hashTask(entry.task),
      rulesApplied: entry.rulesApplied ?? [],
      llmInput: entry.llmInput ?? null,
      llmOutput: entry.llmOutput ?? null,
      userAccepted: entry.userAccepted ?? null,
      outcome: entry.outcome ?? null,
    });
  }

  return { record };
}

/**
 * P5-D — pure builder for the frontdesk few-shot prompt block.
 *
 * Renders accepted decisions from the last N days into a compact block
 * the LLM stage gets in its cached system prefix. Aggressive truncation:
 * the block has to stay under a 1k-token soft cap or it'll start
 * displacing other cached blocks (persona catalog, skill catalog,
 * provider catalog, vendor selection criteria).
 *
 * Format (matches the docstring in the P5 plan):
 *
 *   # Recent picks the operator accepted (last 7 days)
 *
 *   Task: <truncated to ~120 chars>
 *   Pick: persona=<label>, provider=<id>
 *   Why: <reasoning, truncated to ~200 chars>
 *   ---
 *   ...
 */

const TASK_MAX_CHARS = 120;
const REASON_MAX_CHARS = 200;
export const FEWSHOT_SOFT_TOKEN_CAP = 1000; // chars/4 estimate

function truncate(s, max) {
  if (typeof s !== 'string') return '';
  const cleaned = s.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/**
 * @param {Array<{
 *   llmInput?: { task?: string },
 *   llmOutput?: { persona?: string, provider?: string, reasoning?: string },
 * }>} decisions
 * @returns {string}
 */
export function buildFewShotBlock(decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) return '';

  const sections = [];
  let runningChars = 0;
  const header = '# Recent picks the operator accepted (last 7 days)';
  runningChars += header.length + 2;

  for (const d of decisions) {
    const task = truncate(d?.llmInput?.task ?? '', TASK_MAX_CHARS);
    const persona = d?.llmOutput?.persona;
    const provider = d?.llmOutput?.provider;
    const reasoning = truncate(d?.llmOutput?.reasoning ?? '', REASON_MAX_CHARS);
    if (!task || !persona || !provider) continue;

    const section = [
      `Task: ${task}`,
      `Pick: persona=${persona}, provider=${provider}`,
      reasoning ? `Why: ${reasoning}` : null,
    ].filter(Boolean).join('\n');
    const sep = sections.length > 0 ? '\n---\n' : '';

    // Soft token cap — chars/4 estimate. Stop adding sections once
    // we'd cross it; the LLM keeps whatever fit.
    if ((runningChars + sep.length + section.length) / 4 > FEWSHOT_SOFT_TOKEN_CAP) break;

    if (sep) sections.push('---');
    sections.push(section);
    runningChars += sep.length + section.length;
  }

  if (sections.length === 0) return '';
  return [header, '', ...sections].join('\n');
}

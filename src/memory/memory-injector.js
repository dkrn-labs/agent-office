/**
 * Memory Injector — formats project memories for injection into agent context.
 */

/**
 * Format an array of memory objects into a markdown string grouped by domain.
 *
 * Each memory object is expected to have:
 *   { domain: string, type: string, content: string }
 *
 * @param {Array<{domain: string, type: string, content: string}>} memories
 * @returns {string}
 */
export function formatForContext(memories) {
  if (!memories || memories.length === 0) {
    return '(No project memories available)';
  }

  // Group by domain, preserving insertion order of first occurrence.
  const groups = new Map();
  for (const memory of memories) {
    const domain = memory.domain ?? 'general';
    if (!groups.has(domain)) {
      groups.set(domain, []);
    }
    groups.get(domain).push(memory);
  }

  const sections = [];
  for (const [domain, items] of groups) {
    const lines = [`### ${domain}`];
    for (const item of items) {
      lines.push(`- [${item.type}] ${item.content}`);
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

/**
 * Wrap formatForContext output with a count header.
 *
 * @param {Array<{domain: string, type: string, content: string}>} memories
 * @returns {string}
 */
export function formatMemorySection(memories) {
  const count = memories ? memories.length : 0;
  const body = formatForContext(memories);
  return `## Project Memory (${count} ${count === 1 ? 'entry' : 'entries'})\n\n${body}`;
}

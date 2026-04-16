import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function trimText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function basename(path) {
  const normalized = trimText(path);
  if (!normalized) return null;
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function looksLikePath(value) {
  return typeof value === 'string' && /[/.]/.test(value);
}

function pullPathsFromValue(value, target) {
  if (Array.isArray(value)) {
    for (const item of value) pullPathsFromValue(item, target);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && looksLikePath(entry) && /(path|file|cwd)/i.test(key)) {
      target.push(entry);
    } else if (entry && typeof entry === 'object') {
      pullPathsFromValue(entry, target);
    }
  }
}

function extractNextSteps(text) {
  const source = trimText(text);
  if (!source) return null;

  const headingMatch = source.match(/next steps?:\s*([\s\S]{0,400})/i);
  if (headingMatch) {
    const firstLine = headingMatch[1]
      .split('\n')
      .map((line) => line.replace(/^[-*]\s*/, '').trim())
      .find(Boolean);
    if (firstLine) return firstLine;
  }

  const sentenceMatch = source.match(/\b(next|remaining|follow[- ]up)\b[^.?!]{0,180}[.?!]/i);
  return trimText(sentenceMatch?.[0]?.replace(/\s+/g, ' ')) ?? null;
}

function extractCompleted(text) {
  const source = trimText(text);
  if (!source) return null;
  const firstParagraph = source.split('\n\n').find((paragraph) => paragraph.trim()) ?? source;
  return trimText(firstParagraph.replace(/\s+/g, ' ').slice(0, 600));
}

function buildObservation({ providerId, completed, nextSteps, filesRead, filesModified, createdAt }) {
  if (!completed && filesRead.length === 0 && filesModified.length === 0) return [];
  return [
    {
      type: filesModified.length > 0 ? 'change' : 'summary',
      title:
        completed?.split(/[.?!]/)[0]?.slice(0, 120) ??
        (filesModified[0] ? `Updated ${basename(filesModified[0])}` : 'Completed agent turn'),
      subtitle: nextSteps ? `Next: ${nextSteps}` : null,
      narrative: completed,
      filesRead,
      filesModified,
      facts: unique([nextSteps].filter(Boolean)),
      concepts: [providerId, filesModified.length > 0 ? 'edited-files' : 'completed-turn'],
      createdAt,
      relevanceCount: filesModified.length + filesRead.length,
    },
  ];
}

function parseClaudeToolUse(contentItem) {
  if (contentItem?.type !== 'tool_use') return null;
  const input = contentItem.input ?? {};
  const toolName = contentItem.name ?? '';
  const filePath = trimText(input.file_path);

  if (['Write', 'Edit', 'MultiEdit'].includes(toolName) && filePath) {
    return { filesModified: [filePath], filesRead: [] };
  }
  if (['Read'].includes(toolName) && filePath) {
    return { filesModified: [], filesRead: [filePath] };
  }
  if (['Grep', 'Glob', 'LS'].includes(toolName)) {
    const paths = [];
    pullPathsFromValue(input, paths);
    return { filesModified: [], filesRead: paths };
  }
  return null;
}

function extractClaudeFiles(transcriptPath) {
  if (!trimText(transcriptPath)) return { filesRead: [], filesModified: [] };
  let lines;
  try {
    lines = readFileSync(transcriptPath, 'utf8')
      .split('\n')
      .filter(Boolean);
  } catch {
    return { filesRead: [], filesModified: [] };
  }

  const filesRead = [];
  const filesModified = [];
  let seenAssistantEvent = false;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[index]);
    } catch {
      continue;
    }
    if (entry?.type === 'user' && seenAssistantEvent) break;
    if (entry?.type !== 'assistant') continue;
    seenAssistantEvent = true;
    const content = Array.isArray(entry?.message?.content) ? entry.message.content : [];
    for (const item of content) {
      const extracted = parseClaudeToolUse(item);
      if (!extracted) continue;
      filesRead.push(...extracted.filesRead);
      filesModified.push(...extracted.filesModified);
    }
  }

  return {
    filesRead: unique(filesRead),
    filesModified: unique(filesModified),
  };
}

function parseGeminiToolCall(toolCall) {
  const toolName = toolCall?.name ?? '';
  const args = toolCall?.args ?? {};
  const filePath =
    trimText(args.file_path) ??
    trimText(args.path) ??
    trimText(args.target_file) ??
    trimText(args.absolute_path);

  if (/(write|edit|replace|patch|create)/i.test(toolName) && filePath) {
    return { filesModified: [filePath], filesRead: [] };
  }
  if (/(read|view|open)/i.test(toolName) && filePath) {
    return { filesModified: [], filesRead: [filePath] };
  }

  const paths = [];
  pullPathsFromValue(args, paths);
  return { filesModified: [], filesRead: paths };
}

function extractPathsFromExecCommand(command) {
  if (typeof command !== 'string') return [];
  const matches = command.match(/(?:\/[\w.\-@]+)+/g) ?? [];
  return unique(matches);
}

function tryParseEmbeddedJson(line) {
  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(line.slice(start, end + 1));
  } catch {
    return null;
  }
}

function extractCodexThreadFiles({ logsDbPath, stateDbPath, cwd }) {
  if (!trimText(logsDbPath) || !trimText(stateDbPath) || !trimText(cwd)) {
    return { filesRead: [], filesModified: [] };
  }

  let stateDb;
  let logsDb;
  try {
    stateDb = new Database(stateDbPath, { readonly: true, fileMustExist: true });
    logsDb = new Database(logsDbPath, { readonly: true, fileMustExist: true });

    const thread = stateDb
      .prepare(`
        SELECT id
        FROM threads
        WHERE cwd = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `)
      .get(cwd);
    if (!thread?.id) return { filesRead: [], filesModified: [] };

    const rows = logsDb
      .prepare(`
        SELECT feedback_log_body
        FROM logs
        WHERE thread_id = ?
        ORDER BY ts DESC, ts_nanos DESC, id DESC
        LIMIT 40
      `)
      .all(thread.id);

    const filesRead = [];
    const filesModified = [];

    for (const row of rows) {
      const body = row?.feedback_log_body;
      if (typeof body !== 'string' || !body.includes('ToolCall: exec_command')) continue;
      const parsed = tryParseEmbeddedJson(body);
      const cmd = parsed?.cmd ?? '';
      const paths = extractPathsFromExecCommand(cmd);
      if (paths.length === 0) continue;

      if (/\b(sed|cat|rg|grep|find|ls|sqlite3)\b/.test(cmd)) {
        filesRead.push(...paths);
      } else {
        filesModified.push(...paths);
      }
    }

    return {
      filesRead: unique(filesRead.filter((path) => path !== stateDbPath && path !== logsDbPath)),
      filesModified: unique(filesModified.filter((path) => path !== stateDbPath && path !== logsDbPath)),
    };
  } catch {
    return { filesRead: [], filesModified: [] };
  } finally {
    logsDb?.close?.();
    stateDb?.close?.();
  }
}

function extractGeminiFiles(transcriptPath) {
  if (!trimText(transcriptPath)) return { filesRead: [], filesModified: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(transcriptPath, 'utf8'));
  } catch {
    return { filesRead: [], filesModified: [] };
  }

  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const filesRead = [];
  const filesModified = [];
  let seenGemini = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === 'user' && seenGemini) break;
    if (message?.type !== 'gemini') continue;
    seenGemini = true;
    const toolCalls = Array.isArray(message?.toolCalls) ? message.toolCalls : [];
    for (const toolCall of toolCalls) {
      const extracted = parseGeminiToolCall(toolCall);
      filesRead.push(...extracted.filesRead);
      filesModified.push(...extracted.filesModified);
    }
  }

  return {
    filesRead: unique(filesRead),
    filesModified: unique(filesModified),
  };
}

export function enrichClaudeTurn({ transcriptPath, responseText, createdAt, providerId = 'claude-code' }) {
  const files = extractClaudeFiles(transcriptPath);
  const completed = extractCompleted(responseText);
  const nextSteps = extractNextSteps(responseText);
  return {
    completed,
    nextSteps,
    filesRead: files.filesRead,
    filesEdited: files.filesModified,
    observations: buildObservation({
      providerId,
      completed,
      nextSteps,
      filesRead: files.filesRead,
      filesModified: files.filesModified,
      createdAt,
    }),
  };
}

export function enrichGeminiTurn({ transcriptPath, responseText, createdAt, providerId = 'gemini-cli' }) {
  const files = extractGeminiFiles(transcriptPath);
  const completed = extractCompleted(responseText);
  const nextSteps = extractNextSteps(responseText);
  return {
    completed,
    nextSteps,
    filesRead: files.filesRead,
    filesEdited: files.filesModified,
    observations: buildObservation({
      providerId,
      completed,
      nextSteps,
      filesRead: files.filesRead,
      filesModified: files.filesModified,
      createdAt,
    }),
  };
}

export function enrichCodexTurn({
  logsDbPath,
  stateDbPath,
  cwd,
  responseText,
  createdAt,
  providerId = 'codex',
}) {
  const files = extractCodexThreadFiles({ logsDbPath, stateDbPath, cwd });
  const completed = extractCompleted(responseText);
  const nextSteps = extractNextSteps(responseText);
  return {
    completed,
    nextSteps,
    filesRead: files.filesRead,
    filesEdited: files.filesModified,
    observations: buildObservation({
      providerId,
      completed,
      nextSteps,
      filesRead: files.filesRead,
      filesModified: files.filesModified,
      createdAt,
    }),
  };
}

export { extractNextSteps };

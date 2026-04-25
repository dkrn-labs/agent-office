import { readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { classifyObservation } from './classify-observation.js';

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

function looksLikeInjectedPrompt(text) {
  if (typeof text !== 'string') return false;
  return (
    text.startsWith('## Last Session') ||
    /\bYou are a\b/.test(text) ||
    /\bTech stack:\b/.test(text) ||
    /\bAvailable skills:\b/.test(text)
  );
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

function buildObservation({ providerId, completed, nextSteps, filesRead, filesModified, createdAt, commitMessage }) {
  if (!completed && filesRead.length === 0 && filesModified.length === 0) return [];
  const type = classifyObservation({
    filesModified,
    filesRead,
    summary: completed,
    completed,
    commitMessage,
  });
  return [
    {
      type,
      title:
        completed?.split(/[.?!]/)[0]?.slice(0, 120) ??
        (filesModified[0] ? `Updated ${basename(filesModified[0])}` : 'Completed agent turn'),
      subtitle: nextSteps ? `Next: ${nextSteps}` : null,
      narrative: completed,
      filesRead,
      filesModified,
      facts: unique([nextSteps].filter(Boolean)),
      concepts: [providerId, type],
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

function tokenizeShellCommand(command) {
  if (typeof command !== 'string') return [];
  return command.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
}

function normalizeShellToken(token) {
  if (typeof token !== 'string') return null;
  const normalized = token.replace(/^['"]|['"]$/g, '').trim();
  return normalized || null;
}

function looksLikeRelativePathToken(token) {
  if (typeof token !== 'string') return false;
  if (token.startsWith('-') || token.startsWith('$')) return false;
  if (token.includes('://') || token.includes(':')) return false;
  if (/[*?<>|=]/.test(token)) return false;
  if (/^\d+(?:,\d+)?p?$/.test(token)) return false;
  return token.includes('/') || /[.][a-z0-9]+$/i.test(token);
}

function extractPathsFromExecCommand(command, cwd) {
  if (typeof command !== 'string') return [];
  const absoluteMatches = [];
  const relativeMatches = [];
  const workdir = trimText(cwd);
  for (const rawToken of tokenizeShellCommand(command)) {
    const token = normalizeShellToken(rawToken);
    if (!token) continue;
    if (token.startsWith('/')) {
      absoluteMatches.push(token);
      continue;
    }
    if (!looksLikeRelativePathToken(token) || !workdir) continue;
    relativeMatches.push(path.resolve(workdir, token));
  }
  return unique([...absoluteMatches, ...relativeMatches]);
}

function extractPathsFromPatchBody(body) {
  if (typeof body !== 'string') return [];
  const matches = [...body.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)];
  return unique(matches.map((match) => trimText(match[1])).filter(Boolean));
}

function parseTurnIdFromBody(body) {
  if (typeof body !== 'string') return null;
  const match = body.match(/\bturn\.id=([^}\s]+)/i);
  return trimText(match?.[1]) ?? null;
}

function parseSubmissionIdFromBody(body) {
  if (typeof body !== 'string') return null;
  const match = body.match(/\bsubmission\.id=([^}\s]+)/i);
  return trimText(match?.[1]) ?? null;
}

function parseThreadIdFromBody(body) {
  if (typeof body !== 'string') return null;
  const match = body.match(/\bthread_id=([^}\s:]+)/i);
  return trimText(match?.[1]) ?? trimText(body.match(/\bthread\.id=([^}\s:]+)/i)?.[1]) ?? null;
}

function bodyMatchesCodexEventId(body, eventId) {
  if (typeof body !== 'string' || !trimText(eventId)) return false;
  return parseTurnIdFromBody(body) === eventId || parseSubmissionIdFromBody(body) === eventId;
}

function parseCodexToolCallJson(body, marker) {
  if (typeof body !== 'string' || typeof marker !== 'string') return null;
  const markerIndex = body.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = body.indexOf('{', markerIndex + marker.length);
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function looksLikeReadCommand(cmd) {
  return /\b(sed|cat|rg|grep|find|ls|sqlite3|head|tail|wc|git\s+show|git\s+diff)\b/.test(cmd);
}

function summarizeCodexActivity({ filesRead, filesModified }) {
  if (filesModified.length > 0) {
    const files = filesModified.slice(0, 3).map((path) => basename(path)).filter(Boolean);
    const label = files.join(', ');
    const suffix = filesModified.length > 3 ? ` and ${filesModified.length - 3} more files` : '';
    return `Updated ${label}${suffix}.`;
  }
  if (filesRead.length > 0) {
    const files = filesRead.slice(0, 3).map((path) => basename(path)).filter(Boolean);
    const label = files.join(', ');
    const suffix = filesRead.length > 3 ? ` and ${filesRead.length - 3} more files` : '';
    return `Investigated ${label}${suffix}.`;
  }
  return null;
}

function findCodexThreadForTurn(logsDb, turnId) {
  if (!logsDb || !trimText(turnId)) return null;
  const rows = logsDb
    .prepare(`
      SELECT thread_id, feedback_log_body
      FROM logs
      WHERE feedback_log_body LIKE ?
        AND thread_id IS NOT NULL
      ORDER BY ts DESC, ts_nanos DESC, id DESC
      LIMIT 50
    `)
    .all(`%${turnId}%`);
  for (const row of rows) {
    if (!bodyMatchesCodexEventId(row?.feedback_log_body, turnId)) continue;
    return trimText(row?.thread_id) ?? null;
  }
  return null;
}

function extractCodexTurnActivity({ logsDbPath, stateDbPath, cwd, turnId }) {
  if (!trimText(logsDbPath) || !trimText(stateDbPath) || !trimText(cwd)) {
    return { filesRead: [], filesModified: [], threadId: null };
  }

  let stateDb;
  let logsDb;
  try {
    stateDb = new Database(stateDbPath, { readonly: true, fileMustExist: true });
    logsDb = new Database(logsDbPath, { readonly: true, fileMustExist: true });

    const threadIdFromTurn = findCodexThreadForTurn(logsDb, turnId);
    const thread = threadIdFromTurn
      ? stateDb
          .prepare(`
            SELECT id
            FROM threads
            WHERE id = ?
            LIMIT 1
          `)
          .get(threadIdFromTurn)
      : stateDb
          .prepare(`
            SELECT id
            FROM threads
            WHERE cwd = ?
            ORDER BY updated_at DESC
            LIMIT 1
          `)
          .get(cwd);
    if (!thread?.id) return { filesRead: [], filesModified: [], threadId: null };

    const rows = turnId
      ? logsDb
          .prepare(`
            SELECT feedback_log_body
            FROM logs
            WHERE thread_id = ?
              AND feedback_log_body LIKE ?
            ORDER BY ts DESC, ts_nanos DESC, id DESC
            LIMIT 200
          `)
          .all(thread.id, `%${turnId}%`)
      : logsDb
          .prepare(`
            SELECT feedback_log_body
            FROM logs
            WHERE thread_id = ?
            ORDER BY ts DESC, ts_nanos DESC, id DESC
            LIMIT 80
          `)
          .all(thread.id);

    const filesRead = [];
    const filesModified = [];
    let matchedTurn = false;

    for (const row of rows) {
      const body = row?.feedback_log_body;
      if (typeof body !== 'string') continue;
      const matchedEventId = turnId ? bodyMatchesCodexEventId(body, turnId) : false;
      if (turnId && !matchedEventId) continue;
      if (matchedEventId) matchedTurn = true;

      if (body.includes('ToolCall: exec_command')) {
        const parsed = parseCodexToolCallJson(body, 'ToolCall: exec_command');
        const cmd = parsed?.cmd ?? '';
        const paths = extractPathsFromExecCommand(cmd, parsed?.workdir ?? cwd);
        if (paths.length === 0) continue;

        if (looksLikeReadCommand(cmd)) {
          filesRead.push(...paths);
        } else {
          filesModified.push(...paths);
        }
        continue;
      }

      if (body.includes('ToolCall: apply_patch')) {
        filesModified.push(...extractPathsFromPatchBody(body));
      }
    }

    return {
      filesRead: unique(filesRead.filter((path) => path !== stateDbPath && path !== logsDbPath)),
      filesModified: unique(filesModified.filter((path) => path !== stateDbPath && path !== logsDbPath)),
      threadId: matchedTurn || !turnId ? thread.id : null,
    };
  } catch {
    return { filesRead: [], filesModified: [], threadId: null };
  } finally {
    logsDb?.close?.();
    stateDb?.close?.();
  }
}

function loadCodexThreadContext({ stateDbPath, threadId, cwd }) {
  if (!trimText(stateDbPath)) return { request: null, threadTitle: null };

  let stateDb;
  try {
    stateDb = new Database(stateDbPath, { readonly: true, fileMustExist: true });
    let thread = null;
    if (threadId) {
      thread = stateDb
        .prepare(`
          SELECT first_user_message, title
          FROM threads
          WHERE id = ?
          LIMIT 1
        `)
        .get(threadId);
    }
    if (!thread && trimText(cwd)) {
      thread = stateDb
        .prepare(`
          SELECT first_user_message, title
          FROM threads
          WHERE cwd = ?
          ORDER BY updated_at DESC
          LIMIT 1
        `)
        .get(cwd);
    }
    return {
      request: looksLikeInjectedPrompt(thread?.first_user_message)
        ? null
        : (trimText(thread?.first_user_message) ?? null),
      threadTitle: looksLikeInjectedPrompt(thread?.title) ? null : (trimText(thread?.title) ?? null),
    };
  } catch {
    return { request: null, threadTitle: null };
  } finally {
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
  turnId,
  responseText,
  createdAt,
  providerId = 'codex',
}) {
  const activity = extractCodexTurnActivity({ logsDbPath, stateDbPath, cwd, turnId });
  const thread = loadCodexThreadContext({ stateDbPath, threadId: activity.threadId, cwd });
  const completed =
    extractCompleted(responseText) ??
    summarizeCodexActivity({
      filesRead: activity.filesRead,
      filesModified: activity.filesModified,
    }) ??
    (thread.threadTitle ? `Worked on ${thread.threadTitle}.` : null);
  const nextSteps = extractNextSteps(responseText);
  return {
    // P1-3 — expose the resolved Codex thread id so the hook payload can use
    // it as `providerSessionId`. Codex emits a turn_id per `notify` event but
    // the watcher polls `state_5.sqlite threads.id` (a thread spans many
    // turns). Without this plumbing, every turn produced a distinct
    // history_session row that never merged with the watcher's row.
    threadId: activity.threadId ?? null,
    request: thread.request,
    completed,
    nextSteps,
    filesRead: activity.filesRead,
    filesEdited: activity.filesModified,
    observations: buildObservation({
      providerId,
      completed,
      nextSteps,
      filesRead: activity.filesRead,
      filesModified: activity.filesModified,
      createdAt,
    }),
  };
}

export { extractNextSteps };

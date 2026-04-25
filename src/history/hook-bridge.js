import { enrichClaudeTurn, enrichGeminiTurn, enrichCodexTurn } from './transcript-extractors.js';

function trimText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function toIsoNow() {
  return new Date().toISOString();
}

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function buildClaudePayload(input, opts = {}) {
  const projectPath = trimText(input.cwd) ?? trimText(process.env.CLAUDE_PROJECT_DIR) ?? opts.cwd ?? null;
  const createdAt = trimText(input.timestamp) ?? toIsoNow();
  const enrichment = enrichClaudeTurn({
    transcriptPath: trimText(input.transcript_path),
    responseText: trimText(input.last_assistant_message),
    createdAt,
  });
  const completed = enrichment.completed;
  if (!projectPath || !completed) return null;

  return {
    projectPath,
    providerId: 'claude-code',
    providerSessionId: trimText(input.session_id),
    historySessionId: toInt(opts.historySessionId) ?? null,
    model: trimText(input.model) ?? null,
    startedAt: createdAt,
    endedAt: createdAt,
    status: 'completed',
    summary: {
      summaryKind: 'turn',
      completed,
      nextSteps: enrichment.nextSteps,
      filesRead: enrichment.filesRead,
      filesEdited: enrichment.filesEdited,
      notes: `Claude hook event: ${trimText(input.hook_event_name) ?? 'Stop'}`,
      createdAt,
    },
    observations: enrichment.observations,
  };
}

function buildGeminiPayload(input, opts = {}) {
  const projectPath =
    trimText(input.cwd) ?? trimText(process.env.GEMINI_PROJECT_DIR) ?? opts.cwd ?? null;
  const createdAt = trimText(input.timestamp) ?? toIsoNow();
  const enrichment = enrichGeminiTurn({
    transcriptPath: trimText(input.transcript_path),
    responseText: trimText(input.prompt_response),
    createdAt,
  });
  const completed = enrichment.completed;
  if (!projectPath || !completed) return null;

  return {
    projectPath,
    providerId: 'gemini-cli',
    providerSessionId: trimText(input.session_id),
    historySessionId: toInt(opts.historySessionId) ?? null,
    model: trimText(input.model) ?? null,
    startedAt: createdAt,
    endedAt: createdAt,
    status: 'completed',
    summary: {
      summaryKind: 'turn',
      request: trimText(input.prompt),
      completed,
      nextSteps: enrichment.nextSteps,
      filesRead: enrichment.filesRead,
      filesEdited: enrichment.filesEdited,
      notes: `Gemini hook event: ${trimText(input.hook_event_name) ?? 'AfterAgent'}`,
      createdAt,
    },
    observations: enrichment.observations,
  };
}

function buildCodexPayload(input, opts = {}) {
  const projectPath = trimText(opts.cwd) ?? trimText(process.cwd()) ?? null;
  const createdAt = toIsoNow();
  const fallbackMessage = trimText(input.message);
  const enrichment = enrichCodexTurn({
    logsDbPath: trimText(process.env.CODEX_LOGS_DB_PATH) ?? `${process.env.HOME ?? ''}/.codex/logs_2.sqlite`,
    stateDbPath: trimText(process.env.CODEX_STATE_DB_PATH) ?? `${process.env.HOME ?? ''}/.codex/state_5.sqlite`,
    cwd: projectPath,
    turnId: trimText(input.session_id) ?? trimText(input.turn_id) ?? trimText(input['turn-id']),
    responseText: fallbackMessage,
    createdAt,
  });
  const completed = enrichment.completed ?? fallbackMessage ?? 'Codex turn completed.';
  if (!projectPath) return null;

  return {
    projectPath,
    providerId: 'codex',
    providerSessionId: trimText(input.session_id) ?? trimText(input.turn_id) ?? trimText(input['turn-id']),
    historySessionId: toInt(opts.historySessionId) ?? null,
    model: trimText(input.model) ?? null,
    startedAt: createdAt,
    endedAt: createdAt,
    status: 'completed',
    summary: {
      summaryKind: 'turn',
      request: enrichment.request,
      completed,
      nextSteps: enrichment.nextSteps,
      filesRead: enrichment.filesRead,
      filesEdited: enrichment.filesEdited,
      notes: `Codex notify event: ${trimText(input.type) ?? 'agent-turn-complete'}`,
      createdAt,
    },
    observations: enrichment.observations,
  };
}

export function buildHistoryIngestPayload(provider, input, opts = {}) {
  switch (provider) {
    case 'claude-code':
      return buildClaudePayload(input, opts);
    case 'gemini-cli':
      return buildGeminiPayload(input, opts);
    case 'codex':
      return buildCodexPayload(input, opts);
    default:
      return null;
  }
}

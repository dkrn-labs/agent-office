import { create } from 'zustand';
import { fetchJSON, postJSON, fetchJSONWithQuery } from '../lib/api.js';

const PROJECT_PREFS_KEY = 'agent-office-project-prefs-v1';
const MAX_RECENT_PROJECTS = 8;

function readProjectPrefs() {
  if (typeof window === 'undefined') {
    return { pinnedProjectIds: [], recentProjectIds: [] };
  }
  try {
    const raw = window.localStorage.getItem(PROJECT_PREFS_KEY);
    if (!raw) return { pinnedProjectIds: [], recentProjectIds: [] };
    const parsed = JSON.parse(raw);
    return {
      pinnedProjectIds: Array.isArray(parsed?.pinnedProjectIds) ? parsed.pinnedProjectIds : [],
      recentProjectIds: Array.isArray(parsed?.recentProjectIds) ? parsed.recentProjectIds : [],
    };
  } catch {
    return { pinnedProjectIds: [], recentProjectIds: [] };
  }
}

function persistProjectPrefs(state) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      PROJECT_PREFS_KEY,
      JSON.stringify({
        pinnedProjectIds: state.pinnedProjectIds ?? [],
        recentProjectIds: state.recentProjectIds ?? [],
      }),
    );
  } catch {
    // Ignore persistence failures.
  }
}

function mergeRecentProjectIds(existingIds = [], incomingIds = []) {
  const next = [];
  for (const projectId of [...incomingIds, ...existingIds]) {
    if (projectId == null || next.includes(projectId)) continue;
    next.push(projectId);
    if (next.length >= MAX_RECENT_PROJECTS) break;
  }
  return next;
}

function normalizeSession(payload, existing = {}, fallbackWorking = false) {
  const totals = payload?.totals ?? existing.totals ?? {
    tokensIn: payload?.tokensIn ?? 0,
    tokensOut: payload?.tokensOut ?? 0,
    cacheRead: payload?.tokensCacheRead ?? 0,
    cacheWrite: payload?.tokensCacheWrite ?? 0,
    total:
      payload?.totalTokens ??
      (payload?.tokensIn ?? 0) +
        (payload?.tokensOut ?? 0) +
        (payload?.tokensCacheRead ?? 0) +
        (payload?.tokensCacheWrite ?? 0),
    costUsd: payload?.costUsd ?? null,
  };

  return {
    ...existing,
    sessionId: payload?.sessionId ?? payload?.id ?? existing.sessionId ?? null,
    providerId: payload?.providerId ?? existing.providerId ?? null,
    providerSessionId: payload?.providerSessionId ?? existing.providerSessionId ?? null,
    projectId: payload?.projectId ?? existing.projectId ?? null,
    projectName: payload?.projectName ?? existing.projectName ?? null,
    projectPath: payload?.projectPath ?? existing.projectPath ?? null,
    personaId: payload?.personaId ?? existing.personaId ?? null,
    personaLabel: payload?.personaLabel ?? existing.personaLabel ?? null,
    personaDomain: payload?.personaDomain ?? existing.personaDomain ?? null,
    startedAt: payload?.startedAt ?? existing.startedAt ?? null,
    endedAt: payload?.endedAt ?? existing.endedAt ?? null,
    lastActivity:
      payload?.lastActivity ?? payload?.endedAt ?? payload?.startedAt ?? existing.lastActivity ?? null,
    lastModel: payload?.lastModel ?? existing.lastModel ?? null,
    totals,
    outcome: payload?.outcome ?? existing.outcome ?? null,
    working: payload?.working ?? existing.working ?? fallbackWorking,
  };
}

/**
 * Central store for the Agent Office panel.
 *
 * State shape:
 *   personas        — array from GET /api/personas
 *   projects        — array from GET /api/projects/active
 *   sessions        — { [personaId]: { sessionId, totals, lastActivity, working } }
 *   selectedPersona — personaId string or null
 *   pickerOpen      — boolean
 *   connected       — WebSocket connected flag
 */
export const useOfficeStore = create((set, get) => ({
  ...readProjectPrefs(),

  // ── state ──────────────────────────────────────────────────────────────────
  personas: [],
  projects: [],
  sessions: {},
  selectedPersona: null,
  pickerOpen: false,
  connected: false,
  activeView: 'office',
  activityStats: null,
  portfolioStats: null,
  portfolioWindow: 'today',
  pulseBuckets: [],
  recentSessions: [],
  terrainSessions: [],
  historyPage: null,
  historyLoading: false,
  selectedHistorySessionId: null,
  historyDetail: null,
  historyDetailLoading: false,
  resumingSessionId: null,
  historyFilters: {
    personaId: null,
    projectId: null,
    outcome: null,
  },

  // Preview flow (Phase 4.6)
  previewOpen:    false,     // true when showing the preview card
  previewLoading: false,
  previewData:    null,      // server response from /api/office/preview
  previewError:   null,
  previewProject: null,      // the project the user clicked (for display while loading)

  // ── async actions ───────────────────────────────────────────────────────────

  async fetchPersonas() {
    const personas = await fetchJSON('/api/personas');
    set({ personas });
  },

  async fetchProjects() {
    const projects = await fetchJSON('/api/projects/active');
    set((state) => {
      const activeProjectIds = new Set(projects.map((project) => project.id));
      const nextState = {
        projects,
        pinnedProjectIds: state.pinnedProjectIds.filter((projectId) => activeProjectIds.has(projectId)),
        recentProjectIds: state.recentProjectIds.filter((projectId) => activeProjectIds.has(projectId)),
      };
      persistProjectPrefs(nextState);
      return nextState;
    });
  },

  async fetchActiveSessions() {
    const activeSessions = await fetchJSON('/api/sessions/active');
    const sessions = {};
    for (const session of activeSessions) {
      if (session.personaId == null) continue;
      sessions[session.personaId] = normalizeSession(session, {}, true);
    }
    set({ sessions });
  },

  async fetchActivityStats() {
    const activityStats = await fetchJSON('/api/sessions/stats');
    set({ activityStats });
  },

  async fetchPortfolioStats(refresh = false) {
    const portfolioStats = await fetchJSONWithQuery('/api/portfolio/stats', {
      refresh: refresh ? 1 : null,
    });
    set({ portfolioStats });
  },

  async fetchPulse() {
    const pulseBuckets = await fetchJSON('/api/sessions/pulse');
    set({ pulseBuckets });
  },

  async fetchRecentSessions() {
    const page = await fetchJSONWithQuery('/api/sessions', { page: 1, pageSize: 5 });
    set((state) => {
      const nextState = {
        recentSessions: page.items ?? [],
        recentProjectIds: mergeRecentProjectIds(
          state.recentProjectIds,
          (page.items ?? []).map((session) => session.projectId),
        ),
      };
      persistProjectPrefs({ ...state, ...nextState });
      return nextState;
    });
  },

  async fetchTerrainSessions() {
    const page = await fetchJSONWithQuery('/api/sessions', { page: 1, pageSize: 12 });
    set({ terrainSessions: page.items ?? [] });
  },

  async fetchHistory(page = 1) {
    set({ historyLoading: true });
    try {
      const filters = get().historyFilters;
      const historyPage = await fetchJSONWithQuery('/api/sessions', {
        page,
        pageSize: 20,
        personaId: filters.personaId,
        projectId: filters.projectId,
        outcome: filters.outcome,
      });
      set({ historyPage, historyLoading: false });
    } catch (err) {
      set({ historyLoading: false });
      throw err;
    }
  },

  async fetchHistorySessionDetail(sessionId) {
    set({
      selectedHistorySessionId: sessionId,
      historyDetailLoading: true,
    });
    try {
      const historyDetail = await fetchJSON(`/api/sessions/${sessionId}`);
      set({
        selectedHistorySessionId: sessionId,
        historyDetail,
        historyDetailLoading: false,
      });
      return historyDetail;
    } catch (err) {
      set({
        historyDetailLoading: false,
      });
      throw err;
    }
  },

  setActiveView(activeView) {
    set({ activeView });
    if (activeView === 'history' && !get().historyPage) {
      void get().fetchHistory(1);
    }
  },

  setPortfolioWindow(portfolioWindow) {
    set({ portfolioWindow });
  },

  setHistoryFilters(nextFilters) {
    const historyFilters = { ...get().historyFilters, ...nextFilters };
    set({
      historyFilters,
      selectedHistorySessionId: null,
      historyDetail: null,
      historyDetailLoading: false,
    });
    void get().fetchHistory(1);
  },

  openHistorySession(sessionId) {
    set({ activeView: 'history' });
    if (!get().historyPage) {
      void get().fetchHistory(1);
    }
    void get().fetchHistorySessionDetail(sessionId);
  },

  closeHistorySession() {
    set({
      selectedHistorySessionId: null,
      historyDetail: null,
      historyDetailLoading: false,
    });
  },

  async previewLaunch(personaId, project, launchConfig = {}) {
    set({
      previewOpen:    true,
      previewLoading: true,
      previewError:   null,
      previewData:    null,
      previewProject: project,
    });
    try {
      const data = await fetchJSONWithQuery('/api/office/preview', {
        personaId,
        projectId: project.id,
        providerId: launchConfig.providerId,
        model: launchConfig.model,
      });
      set({ previewData: data, previewLoading: false });
    } catch (err) {
      set({ previewError: err.message ?? 'Failed to load preview', previewLoading: false });
    }
  },

  closePreview() {
    set({
      previewOpen:    false,
      previewLoading: false,
      previewData:    null,
      previewError:   null,
      previewProject: null,
    });
  },

  async launchAgent(personaId, projectId, launchConfig = {}) {
    const result = await postJSON('/api/office/launch', {
      personaId,
      projectId,
      providerId: launchConfig.providerId,
      model: launchConfig.model,
    });
    set((state) => {
      const nextState = {
        recentProjectIds: mergeRecentProjectIds(state.recentProjectIds, [projectId]),
      };
      persistProjectPrefs({ ...state, ...nextState });
      return nextState;
    });
    return result;
  },

  async resumeSession(session) {
    if (!session?.personaId || !session?.projectId) {
      throw new Error('Session is missing persona or project information');
    }

    const sessionId = session.id ?? session.sessionId ?? null;
    set({ resumingSessionId: sessionId });
    try {
      return await get().launchAgent(session.personaId, session.projectId, {
        providerId: session.providerId ?? undefined,
        model: session.lastModel ?? undefined,
      });
    } finally {
      set({ resumingSessionId: null });
    }
  },

  // ── picker actions ──────────────────────────────────────────────────────────

  markProjectUsed(projectId) {
    set((state) => {
      const nextState = {
        recentProjectIds: mergeRecentProjectIds(state.recentProjectIds, [projectId]),
      };
      persistProjectPrefs({ ...state, ...nextState });
      return nextState;
    });
  },

  togglePinnedProject(projectId) {
    set((state) => {
      const nextState = {
        pinnedProjectIds: state.pinnedProjectIds.includes(projectId)
          ? state.pinnedProjectIds.filter((id) => id !== projectId)
          : [projectId, ...state.pinnedProjectIds],
      };
      persistProjectPrefs({ ...state, ...nextState });
      return nextState;
    });
  },

  openPicker(personaId) {
    set({ selectedPersona: personaId, pickerOpen: true });
  },

  closePicker() {
    set({ selectedPersona: null, pickerOpen: false });
  },

  // ── WebSocket event handlers ────────────────────────────────────────────────

  onSessionStarted(payload) {
    const { personaId, sessionId } = payload;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [personaId]: normalizeSession(
          { ...payload, sessionId, working: true },
          state.sessions[personaId],
          true,
        ),
      },
    }));
  },

  onSessionUpdate(payload) {
    const { personaId } = payload;
    set((state) => {
      const existing = state.sessions[personaId] ?? {};
      return {
        sessions: {
          ...state.sessions,
          [personaId]: normalizeSession(
            { ...payload, working: true },
            existing,
            true,
          ),
        },
      };
    });
  },

  onSessionEnded(payload) {
    const { personaId } = payload;
    set((state) => {
      const existing = state.sessions[personaId] ?? {};
      return {
        sessions: {
          ...state.sessions,
          [personaId]: normalizeSession(
            { ...payload, working: false },
            existing,
            false,
          ),
        },
      };
    });
    set((state) => {
      const nextState = {
        recentProjectIds: mergeRecentProjectIds(state.recentProjectIds, [payload.projectId]),
        recentSessions: [
          {
            id: payload.sessionId,
            sessionId: payload.sessionId,
            personaId: payload.personaId,
            projectId: payload.projectId,
            providerId: payload.providerId ?? null,
            personaLabel: payload.personaLabel ?? null,
            projectName: payload.projectName ?? null,
            lastModel: payload.lastModel ?? null,
            outcome: payload.outcome,
            endedAt: payload.endedAt,
            totalTokens: payload.totals?.total ?? 0,
            costUsd: payload.totals?.costUsd ?? null,
          },
          ...state.recentSessions.filter((session) => session.sessionId !== payload.sessionId),
        ].slice(0, 5),
        terrainSessions: [
          {
            id: payload.sessionId,
            sessionId: payload.sessionId,
            personaId: payload.personaId,
            projectId: payload.projectId,
            providerId: payload.providerId ?? null,
            personaLabel: payload.personaLabel ?? null,
            projectName: payload.projectName ?? null,
            lastModel: payload.lastModel ?? null,
            outcome: payload.outcome,
            endedAt: payload.endedAt,
            totalTokens: payload.totals?.total ?? 0,
            costUsd: payload.totals?.costUsd ?? null,
            commitsProduced: payload.outcomeSignals?.commitsProduced ?? 0,
          },
          ...state.terrainSessions.filter((session) => session.sessionId !== payload.sessionId),
        ].slice(0, 12),
      };
      persistProjectPrefs({ ...state, ...nextState });
      return nextState;
    });
    if (get().selectedHistorySessionId === payload.sessionId) {
      void get().fetchHistorySessionDetail(payload.sessionId);
    }
    if (get().historyPage) {
      void get().fetchHistory(get().historyPage.page ?? 1);
    }
  },

  onSessionIdle(payload) {
    const { personaId } = payload;
    set((state) => {
      const existing = state.sessions[personaId] ?? {};
      return {
        sessions: {
          ...state.sessions,
          [personaId]: normalizeSession(
            { ...payload, working: false },
            existing,
            false,
          ),
        },
      };
    });
  },

  onActivityTick(payload) {
    set({
      activityStats: payload.stats,
      pulseBuckets: payload.pulseBuckets,
    });
  },

  // ── connectivity ────────────────────────────────────────────────────────────

  setConnected(bool) {
    set({ connected: bool });
  },
}));

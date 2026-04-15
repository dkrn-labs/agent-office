import { create } from 'zustand';
import { fetchJSON, postJSON, fetchJSONWithQuery } from '../lib/api.js';

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
  // ── state ──────────────────────────────────────────────────────────────────
  personas: [],
  projects: [],
  sessions: {},
  selectedPersona: null,
  pickerOpen: false,
  connected: false,
  activeView: 'office',
  activityStats: null,
  pulseBuckets: [],
  recentSessions: [],
  terrainSessions: [],
  historyPage: null,
  historyLoading: false,
  selectedHistorySessionId: null,
  historyDetail: null,
  historyDetailLoading: false,
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
    set({ projects });
  },

  async fetchActiveSessions() {
    const activeSessions = await fetchJSON('/api/sessions/active');
    const sessions = {};
    for (const session of activeSessions) {
      if (session.personaId == null) continue;
      sessions[session.personaId] = {
        sessionId: session.sessionId ?? session.id,
        totals:
          session.totals ?? {
            tokensIn: session.tokensIn ?? 0,
            tokensOut: session.tokensOut ?? 0,
            cacheRead: session.tokensCacheRead ?? 0,
            cacheWrite: session.tokensCacheWrite ?? 0,
            total: session.totalTokens ?? 0,
            costUsd: session.costUsd ?? null,
          },
        lastActivity: session.lastActivity ?? session.startedAt ?? Date.now(),
        working: true,
      };
    }
    set({ sessions });
  },

  async fetchActivityStats() {
    const activityStats = await fetchJSON('/api/sessions/stats');
    set({ activityStats });
  },

  async fetchPulse() {
    const pulseBuckets = await fetchJSON('/api/sessions/pulse');
    set({ pulseBuckets });
  },

  async fetchRecentSessions() {
    const page = await fetchJSONWithQuery('/api/sessions', { page: 1, pageSize: 5 });
    set({ recentSessions: page.items ?? [] });
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

  async previewLaunch(personaId, project) {
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

  async launchAgent(personaId, projectId) {
    const result = await postJSON('/api/office/launch', { personaId, projectId });
    // result contains { sessionId }
    return result;
  },

  // ── picker actions ──────────────────────────────────────────────────────────

  openPicker(personaId) {
    set({ selectedPersona: personaId, pickerOpen: true });
  },

  closePicker() {
    set({ selectedPersona: null, pickerOpen: false });
  },

  // ── WebSocket event handlers ────────────────────────────────────────────────

  onSessionStarted(payload) {
    // payload: { personaId, sessionId, projectPath, ... }
    const { personaId, sessionId } = payload;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [personaId]: {
          sessionId,
          totals: payload.totals ?? { tokensIn: 0, tokensOut: 0, total: 0, costUsd: null },
          lastActivity: payload.startedAt ?? Date.now(),
          working: true,
        },
      },
    }));
  },

  onSessionUpdate(payload) {
    // payload: { personaId, sessionId, totals, ... }
    const { personaId } = payload;
    set((state) => {
      const existing = state.sessions[personaId] ?? {};
      return {
        sessions: {
          ...state.sessions,
          [personaId]: {
            ...existing,
            sessionId: payload.sessionId ?? existing.sessionId,
            totals: payload.totals ?? existing.totals,
            lastActivity: payload.lastActivity ?? Date.now(),
            working: true,
          },
        },
      };
    });
  },

  onSessionEnded(payload) {
    // payload: { personaId, sessionId, totals, ... }
    const { personaId } = payload;
    set((state) => {
      const existing = state.sessions[personaId] ?? {};
      return {
        sessions: {
          ...state.sessions,
          [personaId]: {
            ...existing,
            sessionId: payload.sessionId ?? existing.sessionId,
            totals: payload.totals ?? existing.totals,
            lastActivity: payload.endedAt ?? existing.lastActivity ?? Date.now(),
            working: false,
          },
        },
      };
    });
    set((state) => ({
      recentSessions: [
        {
          id: payload.sessionId,
          sessionId: payload.sessionId,
          personaId: payload.personaId,
          projectId: payload.projectId,
          personaLabel: payload.personaLabel ?? null,
          projectName: payload.projectName ?? null,
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
          personaLabel: payload.personaLabel ?? null,
          projectName: payload.projectName ?? null,
          outcome: payload.outcome,
          endedAt: payload.endedAt,
          totalTokens: payload.totals?.total ?? 0,
          costUsd: payload.totals?.costUsd ?? null,
          commitsProduced: payload.outcomeSignals?.commitsProduced ?? 0,
        },
        ...state.terrainSessions.filter((session) => session.sessionId !== payload.sessionId),
      ].slice(0, 12),
    }));
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
          [personaId]: {
            ...existing,
            working: false,
          },
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

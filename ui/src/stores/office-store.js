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
          totals: payload.totals ?? { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
          lastActivity: payload.timestamp ?? Date.now(),
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
            lastActivity: payload.timestamp ?? Date.now(),
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
            lastActivity: payload.timestamp ?? Date.now(),
            working: false,
          },
        },
      };
    });
  },

  // ── connectivity ────────────────────────────────────────────────────────────

  setConnected(bool) {
    set({ connected: bool });
  },
}));

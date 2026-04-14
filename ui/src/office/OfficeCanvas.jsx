import { useEffect, useRef, useCallback, useState } from 'react';
import { useOfficeStore } from '../stores/office-store.js';
import { loadAllAssets } from './assetLoader.ts';
import { OfficeState } from './engine/officeState.ts';
import { renderFrame } from './engine/renderer.ts';
import { startGameLoop } from './engine/gameLoop.ts';
import { deserializeLayout } from './layout/layoutSerializer.ts';

const ASSET_PATHS = {
  characters: '/assets/characters',
  floors: '/assets/floors',
  walls: '/assets/walls',
  furnitureManifest: '/assets/furniture-manifest.json',
  furniture: '/assets/furniture',
};

const BOSS_JOKES = [
  'The boss is in a meeting',
  'The boss is thinking about synergies',
  'The boss is optimizing the org chart',
  'The boss is attending a leadership summit',
  'The boss is drafting a vision statement',
  'The boss is considering a pivot',
];

const BOSS_AGENT_ID = 0;

// Persona-to-agent mapping. Persona IDs come from the backend API (1-5).
const PERSONA_AGENT_MAP = [
  { personaId: 1, agentId: 1, palette: 0 },
  { personaId: 2, agentId: 2, palette: 1 },
  { personaId: 3, agentId: 3, palette: 2 },
  { personaId: 4, agentId: 4, palette: 3 },
  { personaId: 5, agentId: 5, palette: 4 },
];

export default function OfficeCanvas() {
  const canvasRef = useRef(null);
  const officeRef = useRef(null);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(2); // start zoomed in for pixel-art visibility
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);

  const openPicker = useOfficeStore((s) => s.openPicker);
  const sessions = useOfficeStore((s) => s.sessions);

  // ─── Initialize engine ────────────────────────────────────────────
  useEffect(() => {
    let stopLoop = null;
    let cancelled = false;

    async function init() {
      try {
        await loadAllAssets(ASSET_PATHS, 6);
      } catch (err) {
        console.error('[OfficeCanvas] Asset loading failed:', err);
        return;
      }

      if (cancelled) return;

      const res = await fetch('/assets/default-layout.json');
      const layoutText = await res.text();
      const layout = deserializeLayout(layoutText);
      if (!layout) {
        console.error('[OfficeCanvas] Failed to deserialize layout');
        return;
      }

      const office = new OfficeState(layout);
      officeRef.current = office;

      for (const { agentId, palette } of PERSONA_AGENT_MAP) {
        office.addAgent(agentId, palette, 0, undefined, true);
      }
      office.addAgent(BOSS_AGENT_ID, 5, 0, undefined, true);

      const canvas = canvasRef.current;
      if (!canvas) return;

      stopLoop = startGameLoop(canvas, {
        update: (dt) => office.update(dt),
        render: (ctx) => {
          renderFrame(
            ctx,
            canvas.width,
            canvas.height,
            office.tileMap,
            office.furniture,
            office.getCharacters(),
            zoomRef.current,
            panRef.current.x,
            panRef.current.y,
            {
              selectedAgentId: office.selectedAgentId,
              hoveredAgentId: office.hoveredAgentId,
              hoveredTile: office.hoveredTile,
              seats: office.seats,
              characters: office.characters,
            },
            undefined,
            office.layout.tileColors,
            office.layout.cols,
            office.layout.rows,
          );
        },
      });

      setLoaded(true);
    }

    init().catch(console.error);

    return () => {
      cancelled = true;
      stopLoop?.();
    };
  }, []);

  // ─── Sync session state → engine ──────────────────────────────────
  useEffect(() => {
    const office = officeRef.current;
    if (!office) return;
    for (const { personaId, agentId } of PERSONA_AGENT_MAP) {
      const session = sessions[personaId];
      const isWorking = session?.working ?? false;
      office.setAgentActive(agentId, isWorking);
    }
  }, [sessions]);

  // ─── Canvas DPR-aware resize ──────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = parent.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  // ─── Click handler ────────────────────────────────────────────────
  const handleClick = useCallback((e) => {
    const office = officeRef.current;
    if (!office || isPanningRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const x = (e.clientX - rect.left) * dpr;
    const y = (e.clientY - rect.top) * dpr;

    const worldX = (x - canvas.width / 2) / zoomRef.current - panRef.current.x;
    const worldY = (y - canvas.height / 2) / zoomRef.current - panRef.current.y;

    const agentId = office.getCharacterAt(worldX, worldY);
    if (agentId === null) return;

    if (agentId === BOSS_AGENT_ID) {
      const joke = BOSS_JOKES[Math.floor(Math.random() * BOSS_JOKES.length)];
      setToast(joke);
      setTimeout(() => setToast(null), 2500);
      return;
    }

    const mapping = PERSONA_AGENT_MAP.find((m) => m.agentId === agentId);
    if (mapping) openPicker(mapping.personaId);
  }, [openPicker]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomRef.current = Math.max(0.5, Math.min(4, zoomRef.current * delta));
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button === 1) {
      e.preventDefault();
      isPanningRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (isPanningRef.current) {
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      panRef.current.x += dx / zoomRef.current;
      panRef.current.y += dy / zoomRef.current;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    // Delay clearing so the subsequent click event sees we were panning
    setTimeout(() => { isPanningRef.current = false; }, 0);
  }, []);

  return (
    <div className="office-canvas-container">
      <canvas
        ref={canvasRef}
        className="office-canvas"
        onClick={handleClick}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      {!loaded && (
        <div className="office-loading">Loading office...</div>
      )}
      {toast && (
        <div className="office-toast">{toast}</div>
      )}
    </div>
  );
}

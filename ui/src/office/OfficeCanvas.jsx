import { useEffect, useRef, useCallback, useState } from 'react';
import { useOfficeStore } from '../stores/office-store.js';
import { loadAllAssets } from './assetLoader.ts';
import { OfficeState } from './engine/officeState.ts';
import { renderFrame } from './engine/renderer.ts';
import { startGameLoop } from './engine/gameLoop.ts';
import { deserializeLayout } from './layout/layoutSerializer.ts';
import TokenBadge from './TokenBadge.jsx';

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
// Maps persona API ids → engine agent ids + character palette + zone seat.
// Palette index corresponds to char_N.png (Frontend persona uses char_1.png → palette 1).
// seatId must match a chair's `uid` in default-layout.json — see scripts/build-default-layout.js.
const PERSONA_AGENT_MAP = [
  { personaId: 1, agentId: 1, palette: 1, seatId: 'frontend_chair' },
  { personaId: 2, agentId: 2, palette: 2, seatId: 'backend_chair' },
  { personaId: 3, agentId: 3, palette: 3, seatId: 'debug_chair' },
  { personaId: 4, agentId: 4, palette: 4, seatId: 'reviewer_chair' },
  { personaId: 5, agentId: 5, palette: 5, seatId: 'devops_chair' },
];

// Zone labels — placed at the horizontal center of each zone's top edge (in tile coords).
// Colors match the domain color scheme used elsewhere in the UI.
const ZONE_LABELS = [
  { name: 'BOSS',     col: 4,  row: 0,  color: '#fbbf24' },
  { name: 'BREAK',    col: 20, row: 0,  color: '#86efac' },
  { name: 'FRONTEND', col: 4,  row: 7,  color: '#60a5fa' },
  { name: 'BACKEND',  col: 12, row: 7,  color: '#34d399' },
  { name: 'DEBUG',    col: 20, row: 7,  color: '#fb923c' },
  { name: 'DEVOPS',   col: 6,  row: 13, color: '#f472b6' },
  { name: 'REVIEWER', col: 20, row: 13, color: '#a78bfa' },
];

const TILE_SIZE = 16;

function drawZoneLabels(ctx, canvasWidth, canvasHeight, zoom, panX, panY, cols, rows) {
  const mapW = cols * TILE_SIZE * zoom;
  const mapH = rows * TILE_SIZE * zoom;
  const offsetX = Math.floor((canvasWidth - mapW) / 2) + Math.round(panX);
  const offsetY = Math.floor((canvasHeight - mapH) / 2) + Math.round(panY);

  ctx.save();
  ctx.font = `bold ${10 * zoom}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (const label of ZONE_LABELS) {
    const screenX = offsetX + label.col * TILE_SIZE * zoom;
    const screenY = offsetY + label.row * TILE_SIZE * zoom + 2 * zoom;

    // Dark background pill behind text for readability
    const textW = ctx.measureText(label.name).width;
    const padX = 4 * zoom;
    const padY = 2 * zoom;
    ctx.fillStyle = 'rgba(10, 10, 20, 0.75)';
    ctx.fillRect(
      screenX - textW / 2 - padX,
      screenY - padY,
      textW + padX * 2,
      10 * zoom + padY * 2,
    );

    ctx.fillStyle = label.color;
    ctx.fillText(label.name, screenX, screenY);
  }
  ctx.restore();
}

export default function OfficeCanvas() {
  const canvasRef = useRef(null);
  const officeRef = useRef(null);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(2); // start zoomed in for pixel-art visibility
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [badgePositions, setBadgePositions] = useState([]);

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

      for (const { agentId, palette, seatId } of PERSONA_AGENT_MAP) {
        office.addAgent(agentId, palette, 0, seatId, true);
      }
      // Boss sits in the Boss Corner and wanders from there.
      office.addAgent(BOSS_AGENT_ID, 0, 0, 'boss_chair', true);

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
          drawZoneLabels(
            ctx,
            canvas.width,
            canvas.height,
            zoomRef.current,
            panRef.current.x,
            panRef.current.y,
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

  useEffect(() => {
    let frame = 0;

    function projectBadges() {
      const office = officeRef.current;
      const canvas = canvasRef.current;
      if (office && canvas) {
        const rect = canvas.getBoundingClientRect();
        const zoom = zoomRef.current;
        const mapW = office.layout.cols * TILE_SIZE * zoom;
        const mapH = office.layout.rows * TILE_SIZE * zoom;
        const offsetX = Math.floor((canvas.width - mapW) / 2) + Math.round(panRef.current.x);
        const offsetY = Math.floor((canvas.height - mapH) / 2) + Math.round(panRef.current.y);
        const next = PERSONA_AGENT_MAP.map(({ personaId, agentId }) => {
          const session = sessions[personaId];
          if (!session || !session.totals) return null;
          const character = office.getCharacters().find((item) => item.id === agentId);
          if (!character) return null;
          const left = rect.left + ((offsetX + character.x * zoom) / canvas.width) * rect.width;
          const top = rect.top + ((offsetY + (character.y - 28) * zoom) / canvas.height) * rect.height;
          return {
            personaId,
            left: left - rect.left,
            top: top - rect.top,
            totals: session.totals,
            working: session.working,
          };
        }).filter(Boolean);
        setBadgePositions(next);
      }
      frame = requestAnimationFrame(projectBadges);
    }

    frame = requestAnimationFrame(projectBadges);
    return () => cancelAnimationFrame(frame);
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

    // Match the renderer's coordinate transform:
    //   offsetX = (canvasW - mapW) / 2 + panX  (map is centered in viewport + pan)
    //   screenX = offsetX + worldX * zoom
    // So: worldX = (screenX - offsetX) / zoom
    const zoom = zoomRef.current;
    const mapW = office.layout.cols * TILE_SIZE * zoom;
    const mapH = office.layout.rows * TILE_SIZE * zoom;
    const offsetX = Math.floor((canvas.width - mapW) / 2) + Math.round(panRef.current.x);
    const offsetY = Math.floor((canvas.height - mapH) / 2) + Math.round(panRef.current.y);
    const worldX = (x - offsetX) / zoom;
    const worldY = (y - offsetY) / zoom;

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
      <div className="office-badge-layer">
        {badgePositions.map((badge) => (
          <div
            key={badge.personaId}
            className="office-badge-anchor"
            style={{ left: `${badge.left}px`, top: `${badge.top}px` }}
          >
            <TokenBadge totals={badge.totals} working={badge.working} />
          </div>
        ))}
      </div>
      {!loaded && (
        <div className="office-loading">Loading office...</div>
      )}
      {toast && (
        <div className="office-toast">{toast}</div>
      )}
    </div>
  );
}

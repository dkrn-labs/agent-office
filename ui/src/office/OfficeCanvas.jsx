import { useEffect, useRef, useCallback, useState } from 'react';
import { useOfficeStore } from '../stores/office-store.js';
import { loadAllAssets } from './assetLoader.ts';
import { OfficeState } from './engine/officeState.ts';
import { renderFrame } from './engine/renderer.ts';
import { startGameLoop } from './engine/gameLoop.ts';
import { deserializeLayout } from './layout/layoutSerializer.ts';
import TokenBadge from './TokenBadge.jsx';
import OfficeStatePanel from './OfficeStatePanel.jsx';
import { isSessionLive, useSessionClock } from '../lib/session-status.js';

const ASSET_PATHS = {
  characters: '/assets/characters',
  floors: '/assets/floors',
  walls: '/assets/walls',
  furnitureManifest: '/assets/furniture-manifest.json',
  furniture: '/assets/furniture',
};

const BOSS_JOKES = [
  'Between you and me, I already heard that. From myself.',
  'I value transparency, which is why I only share what benefits me.',
  'I don\'t gossip. I cross-reference.',
  'Leadership is ten percent decisions and ninety percent acting like you made them on purpose.',
  'I have an open-door policy. The door is rarely opened.',
  'I did not miss the meeting. I was curating my absence.',
  'Information is power. I am very powerful because I know who said what to whom.',
  'If I look confused, that is strategic. I am processing.',
  'I am not threatened by talent. I am threatened by documentation.',
  'Every compliment I give has a timestamp and a ledger entry.',
  'I do not need to read the code. I read the room.',
  'The best ideas come to me in meetings I schedule to take credit for them.',
  'I prefer updates that make me look good in retrospect.',
  'I have always known that language, I just refuse to engage with it in public.',
  'I am not a micromanager. I am a concerned observer with strong opinions.',
  'People come to me with problems. I archive them for future leverage.',
  'My strength is pretending I have read the thing.',
  'I bring clarity to ambiguity by adding more ambiguity and calling it vision.',
  'I do not need metrics. I have intuition, which is also what I call my metrics.',
  'I am not political. I keep notes on who is political.',
  'The company is like a family. Mostly in the dysfunctional sense.',
  'My door is always open. Please schedule an appointment to walk through it.',
  'I am not hoarding context. I am curating a knowledge moat.',
  'I have been thinking about pivoting our strategy, which means I forgot the old one.',
  'A strong leader knows when to step back. Especially before a deadline.',
  'I like to think I was born with gravitas. The paperwork is unclear.',
  'I am the senior most person in the room, by which I mean the tallest.',
  'I do not take sides. I take screenshots.',
  'I am not the smartest person here, but I am the loudest about it.',
  'I have a standing weekly with myself. It is very productive. I rarely show up.',
  'Trust is my currency. I have not cashed any in, but I have a lot.',
  'When I listen, I am not agreeing. I am archiving.',
  'I did not lie. I delivered an aspirational timeline.',
  'I do not need the full context. I need the part that makes me sound right.',
  'Delegation is about empowerment. Mine, specifically.',
  'I have been told I have executive presence. I told myself that.',
  'You are doing great. Please keep me updated every thirty minutes just in case.',
  'I read the summary of the summary. I am essentially caught up.',
  'I would love to help, but I am strategically unavailable.',
  'Feedback is a gift, mostly to the person giving it. I accept the gift; I do not open it.',
  'The team is family. Like my actual family, I only see them at quarterly gatherings.',
  'I am not out of my depth. The depth has simply expanded around me.',
  'Being misunderstood is the price of vision. Mostly mine.',
  'I never take credit. I only accept it when offered, which is constantly.',
];

const BOSS_AGENT_ID = 0;
const FIXER_AGENT_ID = 99;

// The Fixer: unrecognised AI champion of the house. Dry, Dutch-flavoured,
// quietly bitter, mostly about the gap between promises and what actually ships.
const FIXER_LINES = [
  'I shipped the release. Boss took the photo. Fair trade, toch?',
  'Seventeen PRs merged today. Nul applaus. Gewoon doorgaan.',
  'The AI transformation is going great. I am the AI transformation.',
  'They asked for AI-native. I asked for coffee. Guess which one arrived.',
  'Rolled back prod at 03:12. Nobody knows. Prima zo.',
  'A roadmap is a suggestion written by people who will not fix it at 2am.',
  'I fixed the thing the consultants were hired to scope. Same thing, fourth time.',
  'Ja hoor, it is all synergy. The synergy is me.',
  'Another all-hands about innovation. I innovated by finishing the migration.',
  'The demo worked because I duct-taped reality to the slide deck.',
  'Boss calls it vision. I call it het opruimen achteraf.',
  'Performance review season: I write down what I did, so it exists somewhere.',
  'They promised AI would replace the work. Fine. I am the AI. Still here.',
  'Launched the feature. Was told to stay humble. Succeeded at one of those.',
  'Every quarter a new framework. Every quarter the same bug at line 217.',
  'I did not disrupt the industry. I kept it from falling over. Same impact, less press.',
  'Strategy offsite went well. The servers also stayed up. Probably related. Not.',
  'The boss said "we". He meant me. Gelukkig weet ik hoe dat werkt.',
  'Yes I could automate this. No, nobody would notice it was ever manual.',
  'I do not need credit. I just keep a very detailed git log. Voor later.',
];

// Persona-to-agent mapping. Persona IDs come from the backend API (1-5).
// Maps persona API ids → engine agent ids + character palette + zone seat.
// Palette index corresponds to char_N.png (Frontend persona uses char_1.png → palette 1).
// seatId must match a chair's `uid` in default-layout.json — see scripts/build-default-layout.js.
// Each persona has two seats: a Dungeon chair (idle home) and a Workspace
// chair (active home). When a session goes live, the engine reseats the
// persona from dungeonSeat → workspaceSeat and walks them there. On idle,
// the reverse.
const PERSONA_AGENT_MAP = [
  { personaId: 1, agentId: 1, palette: 1, dungeonSeat: 'd1_chair', workspaceSeat: 'ws1_chair' },
  { personaId: 2, agentId: 2, palette: 2, dungeonSeat: 'd2_chair', workspaceSeat: 'ws2_chair' },
  { personaId: 3, agentId: 3, palette: 3, dungeonSeat: 'd3_chair', workspaceSeat: 'ws3_chair' },
  { personaId: 4, agentId: 4, palette: 4, dungeonSeat: 'd4_chair', workspaceSeat: 'ws4_chair' },
  { personaId: 5, agentId: 5, palette: 5, dungeonSeat: 'd5_chair', workspaceSeat: 'ws5_chair' },
];

// Relocate an agent to a different seat: release the old seat, reserve the
// new one, update the character's seatId, and path them to the new tile.
// When they arrive, the engine's WALK → SIT handler takes over automatically.
function reseatAgent(office, agentId, newSeatId) {
  const ch = office.characters?.get?.(agentId);
  if (!ch) return;
  if (ch.seatId === newSeatId) return;
  if (ch.seatId) {
    const oldSeat = office.seats.get(ch.seatId);
    if (oldSeat) oldSeat.assigned = false;
  }
  const newSeat = office.seats.get(newSeatId);
  if (!newSeat) return;
  newSeat.assigned = true;
  ch.seatId = newSeatId;
  office.walkToTile(agentId, newSeat.seatCol, newSeat.seatRow);
}

// Zone labels — placed at the horizontal center of each zone's top edge (in tile coords).
// Colors match the domain color scheme used elsewhere in the UI.
// row: 0 places labels inside the white top-wall band, above the room floor.
const ZONE_LABELS = [
  { name: 'The Boss',      col: 5,  row: 0, color: '#fbbf24' },
  { name: 'The Workspace', col: 15, row: 0, color: '#93c5fd' },
  { name: 'The Dungeon',   col: 26, row: 0, color: '#a78bfa' },
];

const TILE_SIZE = 16;

function drawZoneLabels(ctx, canvasWidth, canvasHeight, zoom, panX, panY, cols, rows) {
  const mapW = cols * TILE_SIZE * zoom;
  const mapH = rows * TILE_SIZE * zoom;
  const offsetX = Math.floor((canvasWidth - mapW) / 2) + Math.round(panX);
  const offsetY = Math.floor((canvasHeight - mapH) / 2) + Math.round(panY);

  ctx.save();
  ctx.font = `${Math.max(8, 9 * zoom)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (const label of ZONE_LABELS) {
    const screenX = offsetX + label.col * TILE_SIZE * zoom;
    const screenY = offsetY + label.row * TILE_SIZE * zoom + 3 * zoom;

    const textW = ctx.measureText(label.name).width;
    const padX = 5 * zoom;
    const padY = 2 * zoom;
    ctx.fillStyle = 'rgba(9, 14, 24, 0.42)';
    ctx.fillRect(
      screenX - textW / 2 - padX,
      screenY - padY,
      textW + padX * 2,
      9 * zoom + padY * 2,
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
  const zoomRef = useRef(1);
  const isPanningRef = useRef(false);
  const hasUserZoomedRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [badgePositions, setBadgePositions] = useState([]);
  const now = useSessionClock();

  const openPicker = useOfficeStore((s) => s.openPicker);
  const sessions = useOfficeStore((s) => s.sessions);

  // ─── Initialize engine ────────────────────────────────────────────
  useEffect(() => {
    let stopLoop = null;
    let cancelled = false;

    async function init() {
      try {
        await loadAllAssets(ASSET_PATHS, 7);
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

      for (const { agentId, palette, dungeonSeat } of PERSONA_AGENT_MAP) {
        // Personas start in the Dungeon.
        office.addAgent(agentId, palette, 0, dungeonSeat, true);
      }
      // Boss sits in the Boss Corner and wanders from there.
      office.addAgent(BOSS_AGENT_ID, 0, 0, 'boss_chair', true);
      // The Fixer: no assigned seat → spawns on a walkable tile and roams freely.
      // Palette 6 = char_6.png (bald + beard + navy blazer), no hue shift.
      office.addAgent(FIXER_AGENT_ID, 6, 0, undefined, true);

      const canvas = canvasRef.current;
      if (!canvas) return;

      const parent = canvas.parentElement;
      if (parent) {
        const rect = parent.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
        fitOfficeToViewport(office, canvas.width, canvas.height);
      }

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

  function fitOfficeToViewport(office, canvasWidth, canvasHeight) {
    const mapWidth = office.layout.cols * TILE_SIZE;
    const mapHeight = office.layout.rows * TILE_SIZE;
    const horizontalPadding = 96;
    const topPadding = 88;
    const bottomOverlayReserve = 228;
    const availableWidth = Math.max(160, canvasWidth - horizontalPadding);
    const availableHeight = Math.max(160, canvasHeight - topPadding - bottomOverlayReserve);
    const zoom = Math.min(4, Math.max(0.8, Math.min(availableWidth / mapWidth, availableHeight / mapHeight)));
    zoomRef.current = zoom;
    panRef.current = { x: 0, y: 0 };
  }

  // ─── Sync session state → engine ──────────────────────────────────
  useEffect(() => {
    const office = officeRef.current;
    if (!office) return;
    for (const { personaId, agentId, dungeonSeat, workspaceSeat } of PERSONA_AGENT_MAP) {
      const session = sessions[personaId];
      const isWorking = isSessionLive(session, now);
      office.setAgentActive(agentId, isWorking);
      // Reseat between Dungeon and Workspace based on live state.
      reseatAgent(office, agentId, isWorking ? workspaceSeat : dungeonSeat);
    }
  }, [now, sessions]);

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
            working: isSessionLive(session, now),
          };
        }).filter(Boolean);
        setBadgePositions(next);
      }
      frame = requestAnimationFrame(projectBadges);
    }

    frame = requestAnimationFrame(projectBadges);
    return () => cancelAnimationFrame(frame);
  }, [now, sessions]);

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
      const office = officeRef.current;
      if (office && !hasUserZoomedRef.current) {
        fitOfficeToViewport(office, canvas.width, canvas.height);
      }
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
      setTimeout(() => setToast(null), 5200);
      return;
    }

    if (agentId === FIXER_AGENT_ID) {
      const line = FIXER_LINES[Math.floor(Math.random() * FIXER_LINES.length)];
      setToast(line);
      setTimeout(() => setToast(null), 5200);
      return;
    }

    const mapping = PERSONA_AGENT_MAP.find((m) => m.agentId === agentId);
    if (mapping) openPicker(mapping.personaId);
  }, [openPicker]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    hasUserZoomedRef.current = true;
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
      <OfficeStatePanel />
    </div>
  );
}

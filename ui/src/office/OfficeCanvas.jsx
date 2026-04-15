import { useEffect, useRef, useCallback, useState } from 'react';
import { useOfficeStore } from '../stores/office-store.js';
import { loadAllAssets } from './assetLoader.ts';
import { OfficeState } from './engine/officeState.ts';
import { renderFrame } from './engine/renderer.ts';
import { startGameLoop } from './engine/gameLoop.ts';
import { deserializeLayout } from './layout/layoutSerializer.ts';
import TokenBadge from './TokenBadge.jsx';
import OfficeStatePanel from './OfficeStatePanel.jsx';

const ASSET_PATHS = {
  characters: '/assets/characters',
  floors: '/assets/floors',
  walls: '/assets/walls',
  furnitureManifest: '/assets/furniture-manifest.json',
  furniture: '/assets/furniture',
};

const BOSS_JOKES = [
  'I do not panic. I pre-announce confidence very loudly.',
  'This office needs less hesitation and more signature energy.',
  'I am not micromanaging. I am detail-inspiring.',
  'Today we are circling back on excellence, which I invented.',
  'If leadership had a face, it would be making this exact expression.',
  'I have three priorities: morale, momentum, and being seen near a whiteboard.',
  'We are not behind. We are in an aggressive pre-finish phase.',
  'Sometimes the vision is unclear because it is too advanced for the room.',
  'I called this meeting with myself and it went incredibly well.',
  'A great manager delegates. An iconic manager narrates the delegating.',
  'I am greenlighting initiative at a very premium level.',
  'The team wants clarity. I want a cinematic reveal. We are compromising.',
  'This quarter is about results, optics, and premium follow-through.',
  'I do not need more data. I need more people agreeing with the data I like.',
  'There is no problem here that cannot be improved by a stronger kickoff.',
  'I believe in people, especially when they are doing exactly what I pictured.',
  'We are not overcomplicating it. We are adding strategic layers.',
  'Innovation means saying yes before the spreadsheet feels ready.',
  'I am giving this project my full managerial aura.',
  'The roadmap is simple: confidence first, details immediately after.',
  'Leadership is ninety percent timing and ten percent standing near the coffee.',
  'I want bold execution with a tasteful amount of plausible deniability.',
  'This is not a detour. This is an executive shortcut.',
  'We are moving from discussion to action-adjacent excellence.',
  'My management style is supportive, visionary, and occasionally theatrical.',
  'The strategy is working. People can tell because I keep saying that.',
  'I delegate outcomes and personally retain the credit-facing responsibilities.',
  'My calendar is full because leadership is difficult to reschedule.',
  'I was going to help, but then I remembered oversight is also work.',
  'Let us not rush into doing things before we align on being seen doing things.',
  'I bring calm to chaos by adding a meeting to it.',
  'I do not avoid details. I simply respect them from a healthy distance.',
  'This is a high-performance environment with a medium-performance follow-up rhythm.',
  'I trust this team completely, which is why I keep checking if they are worthy of it.',
  'The deliverable is simple: something brilliant, fast, and mostly effortless for me.',
  'I believe in accountability, especially downstream.',
  'We are all rowing in the same direction, and I am definitely near the front of the photo.',
  'Please do not confuse my absence from the work with my presence in the vision.',
  'I already solved this conceptually, which is the hardest part.',
  'I am creating space for the team to shine by not crowding them with competence.',
  'Success has many parents. I am preparing the adoption paperwork now.',
  'This initiative needs ownership, urgency, and somebody else to take the first pass.',
  'My door is always open in the metaphorical sense that matters least.',
  'I am not out of touch. I am operating at a less interruptible altitude.',
  'This office runs on trust, caffeine, and my occasional drive-by encouragement.',
  'The best ideas arrive when I am nowhere near the implementation.',
  'I need everyone to lean in while I lean back strategically.',
  'If you need support, I can absolutely endorse your struggle from nearby.',
  'I have empowered the team by becoming less available on purpose.',
  'We should not ask who dropped the ball. We should ask who can recover it quietly.',
  'Momentum is strong. I can tell because people keep looking stressed in productive ways.',
  'I did not miss the deadline. I reframed it as an evolving target.',
  'Let us turn this confusion into alignment and then into a recap of my alignment.',
  'I like to keep expectations high and specifics negotiable.',
  'This requires decisive leadership, which I am happy to schedule for later today.',
  'I am deeply hands-on in a directional, non-contact format.',
  'We are all accountable here, but some of us are more keynote-accountable.',
  'I do not overpromise. I under-explain with confidence.',
  'The team craves authenticity, so I am workshopping a more authentic executive tone.',
  'Every fire is also an opportunity to demonstrate composure from the hallway.',
  'I am hearing your concerns and translating them into a stronger speech for myself.',
  'This plan has one flaw: it needs results too soon.',
  'I am very proud of the culture we have built around tolerating ambiguity.',
  'If leadership were easy, anyone could stand here nodding like this.',
  'I do my best thinking after asking other people for an update.',
  'The problem is not execution. The problem is that execution keeps asking questions.',
  'My role is to keep the big picture big.',
  'I have a bias for action as long as someone else opens the document first.',
  'We need fewer blockers and more belief in my instinctive timeline.',
  'I am not stalling. I am preserving optionality.',
  'A great team anticipates needs. A great manager phrases them like revelations.',
  'I would rather over-communicate confidence than under-communicate authority.',
  'Please treat this as top priority unless another top priority appears.',
  'I do not chase perfection. I commission it.',
  'Today is about execution, ownership, and my deeply valuable commentary on both.',
  'This office is humming, and I assume I am the melody.',
  'I prefer lightweight process, by which I mean process that feels heavy for other people.',
  'It is important that we move quickly once I feel emotionally aligned with the timeline.',
  'I will not be in the trenches, but I will absolutely visit them for optics.',
  'I am less concerned with blame and more concerned with elegant blame placement.',
  'The team has my full support in the sense that I support having a team.',
  'Leadership means saying the obvious in a tone that costs more.',
  'This quarter I want sharper thinking, cleaner execution, and better appreciation of my pep talks.',
  'I am not a bottleneck. I am a premium checkpoint.',
  'My note-taking strategy is to remember how I felt about the meeting.',
  'I am available for escalations, applause, and selective clarification.',
  'I keep morale high by reminding people this could be under worse management.',
  'The workload is intense, but so is my belief in assigning it confidently.',
  'We need to work smarter, harder, and more invisibly around leadership bottlenecks.',
  'This is not politics. This is relationship-aware decision architecture.',
  'I do not interrupt progress. I simply insist on being updated during it.',
  'There is a lot of talent in this room, and I am doing a great job standing among it.',
  'I am committed to transparency right after I finalize the preferred version of events.',
  'My management style is equal parts support, pressure, and surprising hallway monologues.',
  'I value initiative, especially when it confirms a direction I hinted at afterward.',
  'The team seems tired, which usually means I have inspired urgency.',
  'I am big on feedback, mostly the kind that recognizes hidden executive labor.',
  'This office needs decisive action and a tasteful amount of dramatic pause.',
  'I cannot do everything myself, which is why I have all of you.',
  'The numbers matter, but the narrative around the numbers is where leaders earn their scarves.',
  'I would jump in, but then who would maintain the strategic atmosphere?',
  'My silence should never be mistaken for inattention when it could be mistaken for gravitas.',
  'If this were easy, I would have delegated it sooner.',
  'The task is straightforward. The difficulty is preserving my confidence while it unfolds.',
  'I like lean teams, thick margins, and updates that begin with the phrase good news.',
  'I want innovation, but please keep it compatible with how I already described it upstairs.',
  'Nothing motivates a team like visible belief and invisible contribution.',
  'I am not chasing perfection. I am outsourcing it to people with lower chair heights.',
  'We need urgency without panic, speed without sloppiness, and outcomes without bothering me hourly.',
  'The ideal workflow is everyone taking initiative in the exact order I imagined privately.',
  'I can feel this project turning around, mainly because I just entered the room.',
  'This is what leadership looks like: composed, optimistic, and slightly under-briefed.',
  'I do not love surprises unless I am the one summarizing them afterward.',
  'Please keep me looped in at the confidence level, not the implementation level.',
  'A lesser manager would interfere. I prefer to hover conceptually.',
  'The team keeps asking for priorities, and I keep generously providing new ones.',
  'My contribution today will be strategic visibility and at least one memorable sentence.',
  'I am not resistant to change. I simply prefer when change has already validated me.',
  'We are close enough to success that I can begin sounding inevitable about it.',
  'This office does not need heroes. It needs disciplined professionals and one charismatic narrator.',
  'I would like a solution that is bold, elegant, and ready before questions begin.',
  'I am excellent at unlocking people by placing pressure directly beside them.',
  'I did not disappear. I was in a leadership pocket.',
  'Some managers manage people. I manage momentum, perception, and coffee-adjacent authority.',
  'What I need from this team is less friction and more quietly astonishing delivery.',
  'I am happy to empower ownership, provided the ownership reports back attractively.',
  'This whole situation is manageable if we stop reacting to it and start packaging it better.',
  'Please know that while you were doing the work, I was carrying the burden of context.',
  'We are not improvising. We are operating from a fluidly premium framework.',
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
  const zoomRef = useRef(1);
  const isPanningRef = useRef(false);
  const hasUserZoomedRef = useRef(false);
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

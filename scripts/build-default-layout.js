#!/usr/bin/env node
// Generates the 36x20, three-room office layout.
//
// Rooms (left → right):
//   Boss      cols 1-9   — executive suite; the Boss stays put and makes speeches.
//   Workspace cols 11-24 — productive floor; personas sit here when live.
//   Dungeon   cols 26-34 — cyber-themed holding room; personas wait here when idle.
//
// Walls at col 10 and 25 with a 2-tile doorway gap at rows 9-10 so agents can
// walk Dungeon → Workspace (or vice versa) when their session state changes.
//
// Run: node scripts/build-default-layout.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLS = 32;
const ROWS = 20;

const WALL = 0;
const FLOOR_1 = 1; // corridor / doorway
const FLOOR_2 = 2; // accent rug
const FLOOR_3 = 3; // boss (warm, executive)
const FLOOR_5 = 5; // workspace (bright, office)
const FLOOR_6 = 6; // dungeon (dim, cyber)

const layoutRevision = 5;

const C = {
  corridor:     { h: 30,  s: 4,   b: 0,   c: 0 },
  boss:         { h: 35,  s: 18,  b: 2,   c: 0 },
  bossRug:      { h: 42,  s: 40,  b: -8,  c: 4 },
  workspace:    { h: 205, s: 10,  b: 2,   c: 0 },
  wsRug1:       { h: 210, s: 30,  b: -6,  c: 2 }, // frontend / blue
  wsRug2:       { h: 150, s: 30,  b: -6,  c: 2 }, // backend / green
  wsRug3:       { h: 30,  s: 30,  b: -4,  c: 2 }, // debug / orange
  wsRug4:       { h: 275, s: 28,  b: -6,  c: 2 }, // review / violet
  wsRug5:       { h: 225, s: 28,  b: -8,  c: 2 }, // devops / indigo
  dungeon:      { h: 260, s: 18,  b: -28, c: 8 }, // deep purple-black
  dungeonRug1:  { h: 185, s: 48,  b: -6,  c: 6 }, // neon cyan
  dungeonRug2:  { h: 320, s: 48,  b: -8,  c: 6 }, // neon magenta
  dungeonRug3:  { h: 120, s: 44,  b: -10, c: 6 }, // neon green
  dungeonRug4:  { h: 45,  s: 48,  b: -8,  c: 6 }, // neon amber
  dungeonRug5:  { h: 280, s: 44,  b: -8,  c: 6 }, // neon purple
};

const tiles = Array.from({ length: COLS * ROWS }, () => FLOOR_1);
const tileColors = Array.from({ length: COLS * ROWS }, () => C.corridor);

function idx(col, row) { return row * COLS + col; }

function setTile(col, row, tile, color) {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
  const i = idx(col, row);
  tiles[i] = tile;
  tileColors[i] = color;
}

function rect(c0, c1, r0, r1, tile, color) {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) continue;
      setTile(c, r, tile, color);
    }
  }
}

// Perimeter walls.
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) {
      setTile(c, r, WALL, null);
    }
  }
}

// ── Room floors ────────────────────────────────────────────────
rect(1, 9,   1, 18, FLOOR_3, C.boss);       // Boss    (cols 1-9)
rect(11, 20, 1, 18, FLOOR_5, C.workspace);  // Workspace (cols 11-20)
rect(22, 30, 1, 18, FLOOR_6, C.dungeon);    // Dungeon (cols 22-30)

// ── Inner walls between rooms (cols 10, 21) with doorway ──────
for (let r = 1; r <= 18; r++) {
  if (r === 9 || r === 10) continue; // doorway gap
  setTile(10, r, WALL, null);
  setTile(21, r, WALL, null);
}
setTile(10, 9,  FLOOR_1, C.corridor);
setTile(10, 10, FLOOR_1, C.corridor);
setTile(21, 9,  FLOOR_1, C.corridor);
setTile(21, 10, FLOOR_1, C.corridor);

// ── Accent rugs ───────────────────────────────────────────────
function rug(c0, c1, r0, r1, color) {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) setTile(c, r, FLOOR_2, color);
  }
}
// Boss — big prestige rug in front of the desk
rug(2, 6, 6, 9, C.bossRug);

// Workspace — small rug under each persona's desk (3 top, 2 lower)
rug(12, 13, 4, 5, C.wsRug1);   // frontend  top-left
rug(15, 16, 4, 5, C.wsRug2);   // backend   top-mid
rug(18, 19, 4, 5, C.wsRug3);   // debug     top-right
rug(12, 13, 12, 13, C.wsRug4); // review    lower-left
rug(18, 19, 12, 13, C.wsRug5); // devops    lower-right

// Dungeon — neon accent under each holding cell (cols 22-30)
rug(23, 24, 2, 3, C.dungeonRug1);
rug(26, 27, 2, 3, C.dungeonRug2);
rug(23, 24, 7, 8, C.dungeonRug3);
rug(26, 27, 12, 13, C.dungeonRug4);
rug(23, 24, 14, 15, C.dungeonRug5);

// ── Furniture ─────────────────────────────────────────────────
// Seat uids must match PERSONA_AGENT_MAP in OfficeCanvas.jsx. Each persona
// gets TWO seats: one in the Dungeon (idle home) and one in the Workspace
// (productive home). The engine reseats them on live/idle transition.
const furniture = [
  // ── Boss room ────────────────────────────────────────────────
  { uid: 'boss_desk',          type: 'TABLE_FRONT',           col: 3, row: 3 },
  { uid: 'boss_chair',         type: 'CUSHIONED_CHAIR_FRONT', col: 4, row: 7 },
  { uid: 'boss_bookshelf_1',   type: 'DOUBLE_BOOKSHELF',      col: 1, row: 1 },
  { uid: 'boss_bookshelf_2',   type: 'DOUBLE_BOOKSHELF',      col: 7, row: 1 },
  { uid: 'boss_painting',      type: 'LARGE_PAINTING',        col: 4, row: 11 },
  { uid: 'boss_clock',         type: 'CLOCK',                 col: 9, row: 1 },
  { uid: 'boss_hanging_plant', type: 'HANGING_PLANT',         col: 8, row: 3 },
  { uid: 'boss_pot',           type: 'POT',                   col: 1, row: 9 },
  // Visitor seating — where underlings get summoned
  { uid: 'boss_sofa',          type: 'SOFA_FRONT',            col: 2, row: 13 },
  { uid: 'boss_coffee_table',  type: 'COFFEE_TABLE',          col: 2, row: 16 },
  { uid: 'boss_coffee',        type: 'COFFEE',                col: 3, row: 16 },
  { uid: 'boss_side_table',    type: 'SMALL_TABLE_SIDE',      col: 7, row: 14 },
  { uid: 'boss_bench',         type: 'CUSHIONED_BENCH',       col: 6, row: 16 },
  { uid: 'boss_plant_1',       type: 'LARGE_PLANT',           col: 8, row: 15 },

  // ── Workspace (cols 11-20) — 5 desks: 3 top, 2 lower ─────────
  { uid: 'ws1_desk',  type: 'DESK_FRONT',         col: 12, row: 3 },
  { uid: 'ws1_chair', type: 'WOODEN_CHAIR_FRONT', col: 13, row: 5 },
  { uid: 'ws1_pc',    type: 'PC_FRONT_ON_1',      col: 13, row: 3 },

  { uid: 'ws2_desk',  type: 'DESK_FRONT',         col: 15, row: 3 },
  { uid: 'ws2_chair', type: 'WOODEN_CHAIR_FRONT', col: 16, row: 5 },
  { uid: 'ws2_pc',    type: 'PC_FRONT_ON_2',      col: 16, row: 3 },

  { uid: 'ws3_desk',  type: 'DESK_FRONT',         col: 18, row: 3 },
  { uid: 'ws3_chair', type: 'WOODEN_CHAIR_FRONT', col: 19, row: 5 },
  { uid: 'ws3_pc',    type: 'PC_FRONT_ON_3',      col: 19, row: 3 },

  { uid: 'ws4_desk',  type: 'DESK_FRONT',         col: 12, row: 11 },
  { uid: 'ws4_chair', type: 'WOODEN_CHAIR_FRONT', col: 13, row: 13 },
  { uid: 'ws4_pc',    type: 'PC_FRONT_ON_1',      col: 13, row: 11 },

  { uid: 'ws5_desk',  type: 'DESK_FRONT',         col: 18, row: 11 },
  { uid: 'ws5_chair', type: 'WOODEN_CHAIR_FRONT', col: 19, row: 13 },
  { uid: 'ws5_pc',    type: 'PC_FRONT_ON_2',      col: 19, row: 11 },

  // Workspace dressing
  { uid: 'ws_whiteboard', type: 'WHITEBOARD',       col: 11, row: 11 },
  { uid: 'ws_bookshelf',  type: 'BOOKSHELF',        col: 16, row: 11 },
  { uid: 'ws_bin',        type: 'BIN',              col: 11, row: 16 },
  { uid: 'ws_coffee',     type: 'COFFEE',           col: 16, row: 16 },
  { uid: 'ws_plant_1',    type: 'PLANT_2',          col: 20, row: 15 },
  { uid: 'ws_bench',      type: 'WOODEN_BENCH',     col: 15, row: 16 },

  // ── Dungeon (cols 22-30) — 5 cells + server rack ─────────────
  { uid: 'd1_desk',  type: 'DESK_FRONT',         col: 23, row: 1 },
  { uid: 'd1_chair', type: 'WOODEN_CHAIR_FRONT', col: 24, row: 3 },
  { uid: 'd1_pc',    type: 'PC_FRONT_ON_3',      col: 24, row: 1 },

  { uid: 'd2_desk',  type: 'DESK_FRONT',         col: 26, row: 1 },
  { uid: 'd2_chair', type: 'WOODEN_CHAIR_FRONT', col: 27, row: 3 },
  { uid: 'd2_pc',    type: 'PC_FRONT_ON_2',      col: 27, row: 1 },

  { uid: 'd3_desk',  type: 'DESK_FRONT',         col: 23, row: 6 },
  { uid: 'd3_chair', type: 'WOODEN_CHAIR_FRONT', col: 24, row: 8 },
  { uid: 'd3_pc',    type: 'PC_FRONT_ON_1',      col: 24, row: 6 },

  { uid: 'd4_desk',  type: 'DESK_FRONT',         col: 26, row: 12 },
  { uid: 'd4_chair', type: 'WOODEN_CHAIR_FRONT', col: 27, row: 14 },
  { uid: 'd4_pc',    type: 'PC_FRONT_ON_3',      col: 27, row: 12 },

  { uid: 'd5_desk',  type: 'DESK_FRONT',         col: 23, row: 12 },
  { uid: 'd5_chair', type: 'WOODEN_CHAIR_FRONT', col: 24, row: 14 },
  { uid: 'd5_pc',    type: 'PC_FRONT_ON_2',      col: 24, row: 12 },

  // Dungeon dressing — server racks along back wall
  { uid: 'dungeon_rack_1', type: 'DOUBLE_BOOKSHELF', col: 29, row: 6 },
  { uid: 'dungeon_rack_2', type: 'DOUBLE_BOOKSHELF', col: 29, row: 10 },
  { uid: 'dungeon_rack_3', type: 'DOUBLE_BOOKSHELF', col: 29, row: 14 },
  { uid: 'dungeon_bin',    type: 'BIN',              col: 22, row: 16 },
  { uid: 'dungeon_cactus', type: 'CACTUS',           col: 30, row: 16 },
];

const layout = {
  version: 1,
  layoutRevision,
  cols: COLS,
  rows: ROWS,
  tiles,
  tileColors,
  furniture,
};

const outPath = path.join(__dirname, '..', 'ui', 'public', 'assets', 'default-layout.json');
fs.writeFileSync(outPath, JSON.stringify(layout, null, 2));

console.log(`Wrote ${outPath}`);
console.log(`  ${COLS}x${ROWS} grid, ${tiles.length} tiles, ${furniture.length} furniture items`);

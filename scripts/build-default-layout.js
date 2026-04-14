#!/usr/bin/env node
// Generates the default 25x20 office layout with 7 themed zones.
// Run: node scripts/build-default-layout.js
// Output: ui/public/assets/default-layout.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLS = 25;
const ROWS = 20;

// TileType values (from engine types.ts)
const WALL = 0;
const FLOOR_1 = 1;

// Zones: [name, colStart, colEnd, rowStart, rowEnd, floorType, color]
const ZONES = [
  ['boss',     1,  7, 1, 5, 3, { h: 280, s: 20, b: -10, c: 0 }],
  ['break',   17, 23, 1, 5, 4, { h: 120, s: 25, b: -5,  c: 0 }],
  ['frontend', 1,  7, 8, 12, 5, { h: 210, s: 25, b: -5,  c: 0 }],
  ['backend',  9, 15, 8, 12, 2, { h: 150, s: 20, b: -5,  c: 0 }],
  ['debug',   17, 23, 8, 12, 6, { h: 30,  s: 30, b: -5,  c: 0 }],
  ['devops',   1, 11, 14, 18, 7, { h: 240, s: 15, b: -20, c: 0 }],
  ['reviewer', 17, 23, 14, 18, 8, { h: 270, s: 20, b: -5, c: 0 }],
];

function inZone(col, row, [, c0, c1, r0, r1]) {
  return col >= c0 && col <= c1 && row >= r0 && row <= r1;
}

function zoneFor(col, row) {
  for (const z of ZONES) if (inZone(col, row, z)) return z;
  return null;
}

// Build tiles and tileColors arrays
const tiles = [];
const tileColors = [];

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    // Perimeter = wall
    if (row === 0 || row === ROWS - 1 || col === 0 || col === COLS - 1) {
      tiles.push(WALL);
      tileColors.push(null);
      continue;
    }
    const z = zoneFor(col, row);
    if (z) {
      const [, , , , , floorType, color] = z;
      tiles.push(floorType);
      tileColors.push(color);
    } else {
      // Corridors: default floor, no color
      tiles.push(FLOOR_1);
      tileColors.push(null);
    }
  }
}

// Furniture placements (per design)
const furniture = [
  // Boss Corner — TABLE_FRONT is 3x4 (cols 2-4, rows 2-5), chair must be south of it
  { uid: 'boss_desk',     type: 'TABLE_FRONT',           col: 2, row: 1 },
  { uid: 'boss_chair',    type: 'CUSHIONED_CHAIR_FRONT', col: 3, row: 5 },
  { uid: 'boss_painting', type: 'LARGE_PAINTING',        col: 5, row: 1 },
  { uid: 'boss_pot',      type: 'POT',                   col: 6, row: 3 },

  // Break Area
  { uid: 'break_sofa',        type: 'SOFA_FRONT',   col: 18, row: 2 },
  { uid: 'break_table',       type: 'COFFEE_TABLE', col: 18, row: 3 },
  { uid: 'break_large_plant', type: 'LARGE_PLANT',  col: 21, row: 2 },
  { uid: 'break_plant',       type: 'PLANT',        col: 17, row: 4 },
  { uid: 'break_coffee',      type: 'COFFEE',       col: 20, row: 3 },

  // Frontend zone
  { uid: 'frontend_desk',      type: 'DESK_FRONT',         col: 2, row: 9 },
  { uid: 'frontend_chair',     type: 'WOODEN_CHAIR_FRONT', col: 3, row: 11 },
  { uid: 'frontend_pc',        type: 'PC_FRONT_ON_1',      col: 3, row: 9 },
  { uid: 'frontend_bookshelf', type: 'BOOKSHELF',          col: 5, row: 8 },
  { uid: 'frontend_plant',     type: 'PLANT_2',            col: 6, row: 10 },

  // Backend zone
  { uid: 'backend_desk',   type: 'DESK_FRONT',         col: 10, row: 9 },
  { uid: 'backend_chair',  type: 'WOODEN_CHAIR_FRONT', col: 11, row: 11 },
  { uid: 'backend_pc_1',   type: 'PC_FRONT_ON_1',      col: 11, row: 9 },
  { uid: 'backend_pc_2',   type: 'PC_FRONT_ON_2',      col: 13, row: 9 },
  { uid: 'backend_coffee', type: 'COFFEE',             col: 14, row: 10 },

  // Debug Den
  { uid: 'debug_desk',  type: 'DESK_FRONT',         col: 18, row: 9 },
  { uid: 'debug_chair', type: 'WOODEN_CHAIR_FRONT', col: 19, row: 11 },
  { uid: 'debug_pc_1',  type: 'PC_FRONT_ON_1',      col: 19, row: 9 },
  { uid: 'debug_pc_2',  type: 'PC_FRONT_ON_2',      col: 21, row: 9 },
  { uid: 'debug_pc_3',  type: 'PC_FRONT_ON_3',      col: 22, row: 11 },
  { uid: 'debug_bin',   type: 'BIN',                col: 17, row: 12 },

  // DevOps Dark Corner — shifted up 1 row so the south wall cap doesn't cover
  // the seated character (wall sprite extends 16px above its tile row).
  { uid: 'devops_desk',   type: 'DESK_FRONT',         col: 2, row: 14 },
  { uid: 'devops_chair',  type: 'WOODEN_CHAIR_FRONT', col: 3, row: 16 },
  { uid: 'devops_pc_1',   type: 'PC_FRONT_ON_1',      col: 3, row: 14 },
  { uid: 'devops_pc_2',   type: 'PC_FRONT_ON_2',      col: 5, row: 14 },
  { uid: 'devops_rack_1', type: 'DOUBLE_BOOKSHELF',   col: 8, row: 14 },
  { uid: 'devops_rack_2', type: 'DOUBLE_BOOKSHELF',   col: 10, row: 14 },

  // Reviewer's Study
  { uid: 'reviewer_desk',    type: 'DESK_FRONT',         col: 18, row: 14 },
  { uid: 'reviewer_chair',   type: 'WOODEN_CHAIR_FRONT', col: 19, row: 16 },
  { uid: 'reviewer_pc',      type: 'PC_FRONT_ON_1',      col: 19, row: 14 },
  { uid: 'reviewer_shelf_1', type: 'DOUBLE_BOOKSHELF',   col: 21, row: 14 },
  { uid: 'reviewer_shelf_2', type: 'BOOKSHELF',          col: 22, row: 17 },
  { uid: 'reviewer_cactus',  type: 'CACTUS',             col: 17, row: 15 },
];

const layout = {
  version: 1,
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

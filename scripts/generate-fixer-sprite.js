#!/usr/bin/env node
// Generates ui/public/assets/characters/char_6.png — the Fixer.
// Sprite sheet is 112×96 (7 frames × 16w) × (3 directions × 32h).
// Rows: 0 = down (frontal), 1 = up (back), 2 = right (profile).
// Frames: 0 = idle; 1-6 = walk cycle (two-step alternation).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Palette ────────────────────────────────────────────────────
// Map single-character tokens to RGBA tuples.
const PAL = {
  ' ': [0, 0, 0, 0],         // transparent
  '.': [22, 20, 24, 255],    // outline
  's': [234, 194, 153, 255], // skin mid
  'h': [208, 163, 122, 255], // skin shadow
  'l': [248, 217, 181, 255], // skin highlight
  'b': [46, 30, 20, 255],    // beard
  'B': [28, 18, 12, 255],    // beard shadow
  'e': [10, 8, 6, 255],      // eye
  'n': [31, 58, 107, 255],   // navy blazer
  'N': [22, 42, 82, 255],    // navy shadow
  'L': [60, 92, 146, 255],   // navy highlight
  'w': [232, 236, 241, 255], // shirt white
  'W': [196, 202, 212, 255], // shirt shadow
  'p': [36, 40, 51, 255],    // pants
  'P': [22, 26, 36, 255],    // pants shadow
  'k': [18, 20, 26, 255],    // shoe
};

// ── Sprite definitions (16w × 32h each) ────────────────────────
// Each variant is a 32-line array of 16-character strings.

// DOWN — frontal. Bald round head, visible eyes + beard, navy blazer w/ shirt V.
const DOWN_BASE = [
  '                ',
  '                ',
  '                ',
  '                ',
  '     ......     ',
  '    .llsshl.    ',
  '    lssssshl    ',
  '    lssssshl    ',
  '    lsesseshl   ',
  '    .lssssh.    ',
  '    .bBssBb.    ',
  '     .bBBb.     ',
  '      .ss.      ',
  '     nLnwnLn    ',
  '    .nLwwwLn.   ',
  '    .nnnwnnn.   ',
  '    .nnnwnnn.   ',
  '    .nnnwnnn.   ',
  '    .nnnnnnn.   ',
  '    .nnnnnnn.   ',
  '    .nnnnnnn.   ',
  '    .nnnnnnn.   ',
  '    .pppnppp.   ',
  '    .pppPppp.   ',
  '    .ppp ppp.   ',
  '    .ppp ppp.   ',
  '    .Ppp pPp.   ',
  '    .Ppp pPp.   ',
  '    .kkp pkk.   ',
  '    .kk. .kk.   ',
  '                ',
  '                ',
];

// UP — back of head. Bald skin dome, no face, same body shape.
const UP_BASE = [
  '                ',
  '                ',
  '                ',
  '                ',
  '     ......     ',
  '    .lssssh.    ',
  '    lssssshh    ',
  '    lssssshh    ',
  '    lssssshh    ',
  '    .lssssh.    ',
  '    .sssssh.    ',
  '     .ssss.     ',
  '      .ss.      ',
  '     nnnnnnn    ',
  '    .nLnnnLn.   ',
  '    .nnnnnnn.   ',
  '    .nnnnnnn.   ',
  '    .nnnnnnn.   ',
  '    .nnnnnnn.   ',
  '    .nnnnnnn.   ',
  '    .nnnnnnn.   ',
  '    .nnnnnnn.   ',
  '    .pppnppp.   ',
  '    .pppPppp.   ',
  '    .ppp ppp.   ',
  '    .ppp ppp.   ',
  '    .Ppp pPp.   ',
  '    .Ppp pPp.   ',
  '    .kkp pkk.   ',
  '    .kk. .kk.   ',
  '                ',
  '                ',
];

// RIGHT — profile. Head faces right: eye on right side, beard along jawline.
const RIGHT_BASE = [
  '                ',
  '                ',
  '                ',
  '                ',
  '     .....      ',
  '    .lsshl.     ',
  '    .ssshl.     ',
  '    .ssshl.     ',
  '    .ssehl.     ',
  '    .ssssh.     ',
  '    .BbssB.     ',
  '     .Bbb.      ',
  '      .ss.      ',
  '     .nnLn.     ',
  '    .nnLwnn.    ',
  '    .nnwnn..    ',
  '    .nnwnn.     ',
  '    .nnwnn.     ',
  '    .nnnnn.     ',
  '    .nnnnn.     ',
  '    .nnnnn.     ',
  '    .nnnnn.     ',
  '    .nnppp.     ',
  '    .ppppp.     ',
  '    .ppppp.     ',
  '    .Pppp..     ',
  '    .Pppp.      ',
  '    .Pppp.      ',
  '    .kkkk.      ',
  '    .kk...      ',
  '                ',
  '                ',
];

// ── Walk-cycle variants ────────────────────────────────────────
// Shift the feet/legs to simulate a step. Rows 24-29 are legs; 28-29 are shoes.
function stepLeft(base) {
  // Forward-left step: left leg (cols 4-6) lifted (shorter), right leg (cols 9-11) planted.
  const out = base.slice();
  out[28] = '    .kkp pkk.   ';
  out[29] = '    .kk.  kk.   ';
  // Shorten left leg by moving its shoe up one row and leaving a skin-colored gap.
  return out;
}
function stepRight(base) {
  const out = base.slice();
  out[28] = '    .kkp pkk.   ';
  out[29] = '    .kk  .kk.   ';
  return out;
}
function stepLeftProfile(base) {
  const out = base.slice();
  out[28] = '    .kkkk.      ';
  out[29] = '    .k  k..     ';
  return out;
}
function stepRightProfile(base) {
  const out = base.slice();
  out[28] = '    .kkk..      ';
  out[29] = '    .k kk..     ';
  return out;
}

// Seven frames: idle, then 6 walk (alternating L/R three times).
const DOWN_FRAMES  = [DOWN_BASE,  stepLeft(DOWN_BASE),  DOWN_BASE,
                      stepRight(DOWN_BASE), stepLeft(DOWN_BASE), DOWN_BASE, stepRight(DOWN_BASE)];
const UP_FRAMES    = [UP_BASE,    stepLeft(UP_BASE),    UP_BASE,
                      stepRight(UP_BASE),   stepLeft(UP_BASE),   UP_BASE,   stepRight(UP_BASE)];
const RIGHT_FRAMES = [RIGHT_BASE, stepLeftProfile(RIGHT_BASE), RIGHT_BASE,
                      stepRightProfile(RIGHT_BASE), stepLeftProfile(RIGHT_BASE), RIGHT_BASE, stepRightProfile(RIGHT_BASE)];

// ── Composite 112×96 RGBA buffer ───────────────────────────────
const W = 112;
const H = 96;
const pixels = Buffer.alloc(W * H * 4, 0);

function paintFrame(frame, gridRow, gridCol) {
  const x0 = gridCol * 16;
  const y0 = gridRow * 32;
  for (let y = 0; y < 32; y++) {
    const row = frame[y];
    for (let x = 0; x < 16; x++) {
      const ch = row[x];
      const rgba = PAL[ch];
      if (!rgba || rgba[3] === 0) continue;
      const idx = ((y0 + y) * W + (x0 + x)) * 4;
      pixels[idx]     = rgba[0];
      pixels[idx + 1] = rgba[1];
      pixels[idx + 2] = rgba[2];
      pixels[idx + 3] = rgba[3];
    }
  }
}

for (let f = 0; f < 7; f++) paintFrame(DOWN_FRAMES[f],  0, f);
for (let f = 0; f < 7; f++) paintFrame(UP_FRAMES[f],    1, f);
for (let f = 0; f < 7; f++) paintFrame(RIGHT_FRAMES[f], 2, f);

// ── Minimal PNG encoder ────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const filtered = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + stride)] = 0;
    rgba.copy(filtered, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(filtered);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outPath = path.join(__dirname, '..', 'ui', 'public', 'assets', 'characters', 'char_6.png');
fs.writeFileSync(outPath, encodePNG(W, H, pixels));
console.log(`Wrote ${outPath} (${W}x${H})`);

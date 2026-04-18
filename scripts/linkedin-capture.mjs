#!/usr/bin/env node
// Capture LinkedIn post assets from the running agent-office UI.
//
// Prerequisites:
//   - Backend + UI running (e.g. `npm run startup` or `bash scripts/dev-start.sh`).
//   - Default URL: http://localhost:5173  (override with AGENT_OFFICE_URL).
//
// Output (linkedin/):
//   - slide1-fixer.png      1080x1350 vertical  hero shot + speech bubble
//   - slide2-annotated.png  1200x675  horizontal annotated office
//   - slide3-zoom.png       1080x1080 square zoomed bay
//   - slide4-text.png       1080x1350 vertical  caption card
//   - office.webm           raw recording
//   - office.mp4            12s loop (if ffmpeg present)
//   - office.gif            12s loop 15fps (if ffmpeg present)
//
// Run: node scripts/linkedin-capture.mjs

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(ROOT, '..', 'linkedin');
const URL = process.env.AGENT_OFFICE_URL ?? 'http://localhost:5173';
const RECORD_SECONDS = 12;

const FIXER_LINE =
  '"I shipped the release.\nBoss took the photo.\nFair trade, toch?"';

const CAPTION_TITLE = 'I gave my AI agents an office.';
const CAPTION_BODY =
  'One "boss" who only gives speeches.\n' +
  'One "Fixer" who quietly keeps the lights on.\n' +
  'Eleven specialists who actually ship.\n\n' +
  'The AI transformation, as it really works.';

fs.mkdirSync(OUT, { recursive: true });

function hasFfmpeg() {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

async function waitForReady(page) {
  await page.waitForSelector('canvas.office-canvas', { timeout: 20_000 });
  await page.waitForFunction(
    () => !document.querySelector('.office-loading'),
    { timeout: 30_000 },
  );
  // Give the engine a second to paint a few frames + agents to spawn.
  await page.waitForTimeout(1500);
}

async function canvasBBox(page) {
  const canvas = page.locator('canvas.office-canvas');
  return await canvas.boundingBox();
}

// ── Slide 1: Fixer hero with speech bubble ─────────────────────
async function captureSlide1(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await waitForReady(page);

  // Hide the sidebars + bottom panel so the canvas is the whole frame.
  await page.addStyleTag({ content: `
    .sidebar, .dashboard-header, .office-state-panel { display: none !important; }
    .dashboard-body { grid-template-columns: 1fr !important; }
    .dashboard-center { padding: 0 !important; }
    .office-canvas-container { height: 100vh !important; }
  `});
  await page.waitForTimeout(800);

  // Speech bubble overlay anchored top-center.
  await page.evaluate((line) => {
    const el = document.createElement('div');
    el.id = '__bubble';
    el.textContent = line;
    Object.assign(el.style, {
      position: 'fixed',
      top: '7%',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#fef3c7',
      color: '#1f2937',
      font: 'bold 36px ui-monospace, Menlo, monospace',
      whiteSpace: 'pre',
      padding: '28px 36px',
      borderRadius: '18px',
      border: '3px solid #1f2937',
      boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
      zIndex: 9999,
      maxWidth: '80%',
      textAlign: 'center',
      lineHeight: '1.35',
    });
    document.body.appendChild(el);

    const tag = document.createElement('div');
    tag.textContent = '— the Fixer';
    Object.assign(tag.style, {
      position: 'fixed',
      top: 'calc(7% + 180px)',
      left: '50%',
      transform: 'translateX(-50%)',
      color: '#fbbf24',
      font: '600 22px ui-sans-serif, system-ui',
      zIndex: 9999,
      letterSpacing: '0.12em',
    });
    document.body.appendChild(tag);
  }, FIXER_LINE);

  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'slide1-fixer.png') });
  await ctx.close();
  console.log('  ✓ slide1-fixer.png');
}

// ── Slide 2: Annotated office ──────────────────────────────────
async function captureSlide2(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await waitForReady(page);

  // Hide sidebars so the office fills the frame.
  await page.addStyleTag({ content: `
    .sidebar, .dashboard-header, .office-state-panel { display: none !important; }
    .dashboard-body { grid-template-columns: 1fr !important; }
    .dashboard-center { padding: 0 !important; }
    .office-canvas-container { height: 100vh !important; }
  `});
  await page.waitForTimeout(800);

  // SVG overlay with arrows + labels pointing at real features.
  await page.evaluate(() => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1400 900');
    Object.assign(svg.style, {
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: 9999,
    });
    // Annotation positions target the final 1200x675 clip (x:100-1300, y:112-787).
    // Boxes stay inside with a 20px safety margin.
    svg.innerHTML = `
      <defs>
        <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#fbbf24"/>
        </marker>
      </defs>
      <g font-family="ui-monospace, Menlo, monospace" font-size="22" font-weight="700" fill="#fef3c7">
        <rect x="160" y="180" rx="8" width="320" height="48" fill="#1f2937" stroke="#fbbf24" stroke-width="2"/>
        <text x="178" y="212">Boss · speeches only</text>
        <path d="M 320 232 Q 340 250 390 280" stroke="#fbbf24" stroke-width="4" fill="none" marker-end="url(#a)"/>

        <rect x="920" y="440" rx="8" width="340" height="48" fill="#1f2937" stroke="#fbbf24" stroke-width="2"/>
        <text x="938" y="472">The Fixer · actually ships</text>
        <path d="M 920 464 Q 820 450 720 440" stroke="#fbbf24" stroke-width="4" fill="none" marker-end="url(#a)"/>

        <rect x="420" y="740" rx="8" width="560" height="48" fill="#1f2937" stroke="#fbbf24" stroke-width="2"/>
        <text x="438" y="772">13 rooms · one AI persona each</text>
        <path d="M 700 740 Q 700 680 700 620" stroke="#fbbf24" stroke-width="4" fill="none" marker-end="url(#a)"/>
      </g>
    `;
    document.body.appendChild(svg);
  });

  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'slide2-annotated.png'), clip: { x: 100, y: 112, width: 1200, height: 675 } });
  await ctx.close();
  console.log('  ✓ slide2-annotated.png');
}

// ── Slide 3: Zoomed bay ────────────────────────────────────────
async function captureSlide3(browser) {
  // Render the office at a large viewport so individual rooms are big, then
  // crop a square slice covering Studio + Debug (the dev rooms with characters).
  const ctx = await browser.newContext({ viewport: { width: 2000, height: 1400 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await waitForReady(page);

  await page.addStyleTag({ content: `
    .sidebar, .dashboard-header, .office-state-panel { display: none !important; }
    .dashboard-body { grid-template-columns: 1fr !important; }
    .dashboard-center { padding: 0 !important; }
    .office-canvas-container { height: 100vh !important; }
  `});
  await page.waitForTimeout(800);

  const canvas = await page.locator('canvas.office-canvas');
  const box = await canvas.boundingBox();
  // The engine centers the 40x26 tile map in the canvas with padding. Office
  // aspect ≈ 40:26 (1.54). Use 70% of the canvas height, preserve office
  // aspect, and slide the clip left so it frames Studio + Debug (bays A+B).
  const officeH = Math.min(box.height * 0.72, box.width * 0.72 * 26 / 40);
  const officeW = officeH * 40 / 26;
  const officeLeft = box.x + (box.width - officeW) / 2;
  const officeTop  = box.y + (box.height - officeH) / 2;
  // Square crop, half the office width, shifted left so bays A+B fill it.
  const cropSide = Math.round(officeH * 0.92);
  const clip = {
    x: Math.max(0, Math.round(officeLeft + officeW * 0.03)),
    y: Math.max(0, Math.round(officeTop + officeH * 0.04)),
    width: cropSide,
    height: cropSide,
  };
  await page.screenshot({ path: path.join(OUT, 'slide3-zoom.png'), clip });
  await ctx.close();
  console.log('  ✓ slide3-zoom.png');
}

// ── Slide 4: Typography caption card ───────────────────────────
async function captureSlide4(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const html = `
    <!doctype html>
    <html><head><meta charset="utf-8"/>
    <style>
      html, body { margin: 0; height: 100%; }
      body {
        background: radial-gradient(1200px 1200px at 30% 20%, #1a2238 0%, #080c16 70%);
        color: #e2e8f0;
        font-family: ui-sans-serif, system-ui, -apple-system, 'Helvetica Neue', sans-serif;
        display: flex; flex-direction: column; justify-content: center;
        padding: 80px 72px;
        box-sizing: border-box;
      }
      .brand { color: #fbbf24; letter-spacing: 0.3em; font-size: 22px; font-weight: 700; margin-bottom: 28px; }
      .title {
        font-size: 72px; font-weight: 800; line-height: 1.05; margin: 0 0 40px 0;
        letter-spacing: -0.02em;
      }
      .body {
        font-size: 30px; line-height: 1.5; color: #cbd5e1; white-space: pre-line;
      }
      .sig { margin-top: 56px; color: #94a3b8; font-size: 22px; letter-spacing: 0.08em; }
    </style></head>
    <body>
      <div class="brand">DKCC · AGENT OFFICE</div>
      <h1 class="title">${CAPTION_TITLE}</h1>
      <div class="body">${CAPTION_BODY.replace(/\n/g, '<br/>')}</div>
      <div class="sig">Built in the open · more in the thread</div>
    </body></html>
  `;
  await page.setContent(html);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'slide4-text.png') });
  await ctx.close();
  console.log('  ✓ slide4-text.png');
}

// ── Video: 12s recording of the office ─────────────────────────
async function captureVideo(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await waitForReady(page);

  await page.addStyleTag({ content: `
    .sidebar, .dashboard-header, .office-state-panel { display: none !important; }
    .dashboard-body { grid-template-columns: 1fr !important; }
    .dashboard-center { padding: 0 !important; }
    .office-canvas-container { height: 100vh !important; }
  `});

  await page.waitForTimeout(RECORD_SECONDS * 1000);
  await page.close();
  await ctx.close();

  // Rename the generated webm to something predictable.
  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm'));
  if (files.length > 0) {
    const latest = files
      .map((f) => ({ f, t: fs.statSync(path.join(OUT, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0].f;
    const dest = path.join(OUT, 'office.webm');
    if (latest !== 'office.webm') fs.renameSync(path.join(OUT, latest), dest);
    console.log('  ✓ office.webm');

    if (hasFfmpeg()) {
      console.log('  · transcoding with ffmpeg…');
      execSync(
        `ffmpeg -y -i "${dest}" -movflags +faststart -pix_fmt yuv420p -vf "scale=1280:720" "${path.join(OUT, 'office.mp4')}"`,
        { stdio: 'ignore' },
      );
      console.log('  ✓ office.mp4');
      execSync(
        `ffmpeg -y -i "${dest}" -vf "fps=15,scale=900:-1:flags=lanczos" -loop 0 "${path.join(OUT, 'office.gif')}"`,
        { stdio: 'ignore' },
      );
      console.log('  ✓ office.gif');
    } else {
      console.log('  · ffmpeg not found; skipping mp4/gif conversion');
    }
  }
}

// ── Main ───────────────────────────────────────────────────────
(async () => {
  console.log(`Capturing from ${URL} → ${OUT}`);
  let browser;
  try {
    browser = await chromium.launch();
    // Quick reachability check.
    const probe = await browser.newContext();
    const pp = await probe.newPage();
    try {
      await pp.goto(URL, { timeout: 8_000 });
    } catch (err) {
      console.error(`\n[✗] Cannot reach ${URL}. Is the UI running?`);
      console.error('    Start it with: npm run dev:ui  (or bash scripts/dev-start.sh)\n');
      await probe.close();
      await browser.close();
      process.exit(1);
    }
    await probe.close();

    await captureSlide1(browser);
    await captureSlide2(browser);
    await captureSlide3(browser);
    await captureSlide4(browser);
    await captureVideo(browser);

    console.log(`\nDone. Assets in: ${OUT}`);
  } finally {
    if (browser) await browser.close();
  }
})();

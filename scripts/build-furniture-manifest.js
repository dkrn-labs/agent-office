#!/usr/bin/env node
/**
 * build-furniture-manifest.js
 *
 * Scans ui/public/assets/furniture/<GROUP>/ directories, reads each
 * manifest.json, flattens group/rotation manifests into individual asset
 * entries, and writes a consolidated ui/public/assets/furniture-manifest.json.
 *
 * Usage:
 *   node scripts/build-furniture-manifest.js
 *
 * Run from the repo root (agent-office/.worktrees/phase-4.5/).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FURNITURE_DIR = path.join(REPO_ROOT, 'ui', 'public', 'assets', 'furniture');
const OUT_FILE = path.join(REPO_ROOT, 'ui', 'public', 'assets', 'furniture-manifest.json');

/** Desk/chair/table IDs that should be flagged as isDesk */
const DESK_IDS = new Set([
  'DESK_FRONT',
  'DESK_SIDE',
  'SMALL_TABLE_FRONT',
  'SMALL_TABLE_SIDE',
  'COFFEE_TABLE',
  'TABLE_FRONT',
]);

/**
 * Recursively flatten a manifest node into individual asset entries.
 *
 * @param {object} node          The manifest or member node to process
 * @param {string} groupDir      Directory containing the group's PNGs
 * @param {string|undefined} parentGroupId  Rotation/state group id (inherited from parent)
 * @param {string|undefined} parentOrientation
 * @param {string|undefined} animationGroup
 * @param {string|undefined} rotationScheme
 * @returns {object[]}           Flat array of asset entry objects
 */
function flattenNode(
  node,
  groupDir,
  parentGroupId,
  parentOrientation,
  animationGroup,
  rotationScheme,
) {
  const results = [];

  if (node.type === 'asset') {
    // Leaf asset entry
    const file = node.file ?? `${node.id}.png`;
    results.push({
      id: node.id,
      label: buildLabel(node, parentGroupId),
      category: node.category ?? guessCategory(node.id),
      file: `${path.basename(groupDir)}/${file}`,
      width: node.width,
      height: node.height,
      footprintW: node.footprintW,
      footprintH: node.footprintH,
      isDesk: DESK_IDS.has(node.id),
      ...(parentGroupId ? { groupId: parentGroupId } : {}),
      ...(node.orientation ?? parentOrientation
        ? { orientation: node.orientation ?? parentOrientation }
        : {}),
      ...(node.state ? { state: node.state } : {}),
      ...(node.canPlaceOnSurfaces ? { canPlaceOnSurfaces: true } : {}),
      ...(typeof node.backgroundTiles === 'number' && node.backgroundTiles > 0
        ? { backgroundTiles: node.backgroundTiles }
        : {}),
      ...(node.canPlaceOnWalls ? { canPlaceOnWalls: true } : {}),
      ...(node.mirrorSide ? { mirrorSide: true } : {}),
      ...(rotationScheme ? { rotationScheme } : {}),
      ...(animationGroup ? { animationGroup } : {}),
      ...(typeof node.frame === 'number' ? { frame: node.frame } : {}),
    });
  } else if (node.type === 'group') {
    const groupType = node.groupType; // 'rotation' | 'state' | 'animation'

    // Determine identifiers to propagate
    const thisGroupId =
      groupType === 'rotation'
        ? (parentGroupId ?? node.id ?? path.basename(groupDir))
        : parentGroupId;
    const thisAnimGroup =
      groupType === 'animation'
        ? (animationGroup ?? `${parentGroupId ?? ''}_ANIM`)
        : animationGroup;
    const thisRotScheme =
      groupType === 'rotation'
        ? (node.rotationScheme ?? rotationScheme)
        : rotationScheme;
    const thisOrientation = node.orientation ?? parentOrientation;

    // Annotate frame index for animation groups
    let frameIndex = 0;
    for (const member of node.members ?? []) {
      const memberAnimGroup = groupType === 'animation' ? thisAnimGroup : animationGroup;
      const subResults = flattenNode(
        member,
        groupDir,
        thisGroupId,
        thisOrientation,
        memberAnimGroup,
        thisRotScheme,
      );
      // Assign frame numbers for animation groups
      if (groupType === 'animation') {
        for (const r of subResults) {
          r.frame = frameIndex++;
        }
      }
      results.push(...subResults);
    }
  }

  return results;
}

/**
 * Build a human-readable label for a flat asset entry.
 * Group members get " - Orientation" / " - State" suffixes.
 */
function buildLabel(node, groupId) {
  // Try to derive a base name from the id: 'DESK_FRONT' → 'Desk'
  const base = groupId
    ? titleCase(groupId.replace(/_/g, ' '))
    : titleCase(node.id.replace(/_/g, ' '));
  const parts = [base];
  if (node.orientation) parts.push(titleCase(node.orientation));
  if (node.state) parts.push(titleCase(node.state));
  return parts.join(' - ');
}

/** Convert 'SOME_WORD' to 'Some Word' */
function titleCase(str) {
  return str
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Guess furniture category from asset id string */
function guessCategory(id) {
  const s = id.toUpperCase();
  if (s.includes('DESK') || s.includes('TABLE')) return 'desks';
  if (s.includes('CHAIR') || s.includes('SOFA') || s.includes('BENCH')) return 'chairs';
  if (s.includes('BOOKSHELF') || s.includes('SHELF')) return 'storage';
  if (s.includes('PC') || s.includes('MONITOR') || s.includes('SERVER')) return 'electronics';
  if (
    s.includes('PLANT') ||
    s.includes('CACTUS') ||
    s.includes('POT') ||
    s.includes('PAINTING') ||
    s.includes('CLOCK') ||
    s.includes('WHITEBOARD')
  )
    return 'wall';
  return 'misc';
}

// ── Main ──────────────────────────────────────────────────────────

const groups = fs
  .readdirSync(FURNITURE_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const allItems = [];

for (const groupName of groups) {
  const groupDir = path.join(FURNITURE_DIR, groupName);
  const manifestPath = path.join(groupDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.warn(`[warn] No manifest.json in ${groupName} — skipping`);
    continue;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Attach the groupDir-level metadata that may be on the root node
  if (manifest.type === 'asset') {
    // Simple single-asset group
    const file = manifest.file ?? `${manifest.id}.png`;
    allItems.push({
      id: manifest.id,
      label: titleCase(manifest.name ?? manifest.id.replace(/_/g, ' ')),
      category: manifest.category ?? guessCategory(manifest.id),
      file: `${groupName}/${file}`,
      width: manifest.width,
      height: manifest.height,
      footprintW: manifest.footprintW,
      footprintH: manifest.footprintH,
      isDesk: DESK_IDS.has(manifest.id),
      ...(manifest.canPlaceOnSurfaces ? { canPlaceOnSurfaces: true } : {}),
      ...(typeof manifest.backgroundTiles === 'number' && manifest.backgroundTiles > 0
        ? { backgroundTiles: manifest.backgroundTiles }
        : {}),
      ...(manifest.canPlaceOnWalls ? { canPlaceOnWalls: true } : {}),
    });
  } else if (manifest.type === 'group') {
    const groupId = manifest.id;
    const rotationScheme = manifest.rotationScheme ?? undefined;
    for (const member of manifest.members ?? []) {
      const flat = flattenNode(
        member,
        groupDir,
        groupId,
        undefined,
        undefined,
        rotationScheme,
      );
      // Propagate root-level metadata to each flat asset
      for (const item of flat) {
        if (!item.category) item.category = manifest.category ?? guessCategory(item.id);
        if (manifest.canPlaceOnSurfaces) item.canPlaceOnSurfaces = true;
        if (manifest.backgroundTiles) item.backgroundTiles = manifest.backgroundTiles;
        if (manifest.canPlaceOnWalls) item.canPlaceOnWalls = true;
        // Fix label: use manifest name as base
        if (manifest.name) {
          const base = manifest.name;
          const parts = [base];
          if (item.orientation) parts.push(titleCase(item.orientation));
          if (item.state) parts.push(titleCase(item.state));
          item.label = parts.join(' - ');
        }
      }
      allItems.push(...flat);
    }
  }
}

const output = { items: allItems };
fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
console.log(`[build-furniture-manifest] Wrote ${allItems.length} asset entries to ${OUT_FILE}`);

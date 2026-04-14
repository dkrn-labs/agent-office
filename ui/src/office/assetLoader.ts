/**
 * Browser-based asset loader.
 *
 * Decodes PNG sprite sheets into SpriteData (string[][] of hex colors)
 * using the Canvas API and feeds them into the engine's global state setters.
 */

import { PNG_ALPHA_THRESHOLD } from './constants.js';
import type { SpriteData } from './types.js';
import type { LoadedCharacterData } from './sprites/spriteData.js';
import { setCharacterTemplates } from './sprites/spriteData.js';
import { setFloorSprites } from './floorTiles.js';
import { setWallSprites } from './wallTiles.js';
import { buildDynamicCatalog } from './layout/furnitureCatalog.js';
import type { LoadedAssetData } from './layout/furnitureCatalog.js';

// ── Asset URL configuration ──────────────────────────────────────

export interface AssetPaths {
  /** Base URL for character PNGs (e.g. '/assets/characters') */
  characters: string;
  /** Base URL for floor tile PNGs (e.g. '/assets/floors') */
  floors: string;
  /** Base URL for wall tile PNGs (e.g. '/assets/walls') */
  walls: string;
  /** Base URL for furniture PNGs (e.g. '/assets/furniture') */
  furniture: string;
  /** URL to the consolidated furniture manifest JSON */
  furnitureManifest: string;
}

// ── PNG / Canvas primitives ──────────────────────────────────────

/** Load an image from a URL, resolving when fully decoded. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/** Draw an image to a temporary offscreen canvas and return its ImageData. */
export function imageToPixels(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Convert RGBA channel values to a hex color string.
 * - alpha < PNG_ALPHA_THRESHOLD → '' (transparent)
 * - alpha < 255                 → '#RRGGBBAA'
 * - otherwise                   → '#RRGGBB'
 */
export function rgbaToHex(r: number, g: number, b: number, a: number): string {
  if (a < PNG_ALPHA_THRESHOLD) return '';
  const rh = r.toString(16).padStart(2, '0');
  const gh = g.toString(16).padStart(2, '0');
  const bh = b.toString(16).padStart(2, '0');
  if (a < 255) {
    const ah = a.toString(16).padStart(2, '0');
    return `#${rh}${gh}${bh}${ah}`;
  }
  return `#${rh}${gh}${bh}`;
}

/**
 * Extract a rectangular region from ImageData as SpriteData.
 * @param imageData  Full image pixel data
 * @param sx         Source x (left edge of region)
 * @param sy         Source y (top edge of region)
 * @param sw         Region width in pixels
 * @param sh         Region height in pixels
 */
export function extractSprite(
  imageData: ImageData,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): SpriteData {
  const { data, width } = imageData;
  const rows: string[][] = [];
  for (let row = 0; row < sh; row++) {
    const cols: string[] = [];
    for (let col = 0; col < sw; col++) {
      const idx = ((sy + row) * width + (sx + col)) * 4;
      cols.push(rgbaToHex(data[idx]!, data[idx + 1]!, data[idx + 2]!, data[idx + 3]!));
    }
    rows.push(cols);
  }
  return rows;
}

// ── Character sprites ────────────────────────────────────────────

/**
 * Character PNGs are 112×96: 3 direction rows (down, up, right) × 7 frames each.
 * Frame size: 16×32.
 *
 * Row 0 = down, Row 1 = up, Row 2 = right.
 * Frames 0-6 per row.
 */
const CHAR_FRAME_W = 16;
const CHAR_FRAME_H = 32;
const CHAR_FRAMES_PER_ROW = 7;

const CHAR_DIR_ROWS: Record<keyof LoadedCharacterData, number> = {
  down: 0,
  up: 1,
  right: 2,
};

async function loadCharacter(src: string): Promise<LoadedCharacterData> {
  const img = await loadImage(src);
  const imageData = imageToPixels(img);

  const extractRow = (rowIndex: number): SpriteData[] => {
    const frames: SpriteData[] = [];
    for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
      frames.push(
        extractSprite(
          imageData,
          f * CHAR_FRAME_W,
          rowIndex * CHAR_FRAME_H,
          CHAR_FRAME_W,
          CHAR_FRAME_H,
        ),
      );
    }
    return frames;
  };

  return {
    down: extractRow(CHAR_DIR_ROWS.down),
    up: extractRow(CHAR_DIR_ROWS.up),
    right: extractRow(CHAR_DIR_ROWS.right),
  };
}

/**
 * Load character sprite sheets char_0.png … char_(count-1).png.
 * Returns only the successfully loaded characters.
 */
async function loadCharacters(
  basePath: string,
  count: number,
): Promise<LoadedCharacterData[]> {
  const promises: Promise<LoadedCharacterData | null>[] = [];
  for (let i = 0; i < count; i++) {
    const src = `${basePath}/char_${i}.png`;
    promises.push(loadCharacter(src).catch(() => null));
  }
  const results = await Promise.all(promises);
  return results.filter((r): r is LoadedCharacterData => r !== null);
}

// ── Floor tiles ──────────────────────────────────────────────────

/**
 * Load floor_0.png through floor_9.png (16×16 grayscale tiles).
 * Stops trying after the first consecutive failure.
 */
async function loadFloorTiles(basePath: string): Promise<SpriteData[]> {
  const sprites: SpriteData[] = [];
  for (let i = 0; i <= 9; i++) {
    try {
      const img = await loadImage(`${basePath}/floor_${i}.png`);
      const imageData = imageToPixels(img);
      sprites.push(extractSprite(imageData, 0, 0, imageData.width, imageData.height));
    } catch {
      // Stop on first failure — indices are contiguous
      break;
    }
  }
  return sprites;
}

// ── Wall tiles ───────────────────────────────────────────────────

/**
 * Wall PNGs are 64×128 grids of 4 columns × 4 rows = 16 wall pieces (16×32 each).
 * Each piece corresponds to a 4-bit bitmask (0-15): N=1, E=2, S=4, W=8.
 */
const WALL_PIECE_W = 16;
const WALL_PIECE_H = 32;
const WALL_PIECES_PER_ROW = 4;
const WALL_PIECES_TOTAL = 16;

async function loadWallSet(src: string): Promise<SpriteData[]> {
  const img = await loadImage(src);
  const imageData = imageToPixels(img);
  const pieces: SpriteData[] = [];
  for (let i = 0; i < WALL_PIECES_TOTAL; i++) {
    const col = i % WALL_PIECES_PER_ROW;
    const row = Math.floor(i / WALL_PIECES_PER_ROW);
    pieces.push(
      extractSprite(
        imageData,
        col * WALL_PIECE_W,
        row * WALL_PIECE_H,
        WALL_PIECE_W,
        WALL_PIECE_H,
      ),
    );
  }
  return pieces;
}

/**
 * Load wall_0.png, wall_1.png, … until a fetch fails.
 * Returns an array of wall sets; each set has 16 pieces indexed by bitmask.
 */
async function loadWallSets(basePath: string): Promise<SpriteData[][]> {
  const sets: SpriteData[][] = [];
  for (let i = 0; i <= 9; i++) {
    try {
      const pieces = await loadWallSet(`${basePath}/wall_${i}.png`);
      sets.push(pieces);
    } catch {
      break;
    }
  }
  return sets;
}

// ── Furniture manifest & sprites ─────────────────────────────────

/** Shape of each entry in the furniture-manifest.json */
interface ManifestEntry {
  id: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  groupId?: string;
  orientation?: string;
  state?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  canPlaceOnWalls?: boolean;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

/** Shape of the consolidated furniture-manifest.json */
interface FurnitureManifest {
  items: ManifestEntry[];
}

async function loadFurnitureSprites(
  basePath: string,
  manifestUrl: string,
): Promise<LoadedAssetData> {
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch furniture manifest: ${manifestUrl} (${response.status})`);
  }
  const manifest: FurnitureManifest = await response.json() as FurnitureManifest;

  // Load all sprite PNGs in parallel
  const spriteEntries = await Promise.all(
    manifest.items.map(async (item) => {
      try {
        // item.file is relative to the group directory under basePath
        const src = `${basePath}/${item.file}`;
        const img = await loadImage(src);
        const imageData = imageToPixels(img);
        const sprite = extractSprite(imageData, 0, 0, imageData.width, imageData.height);
        return { id: item.id, sprite };
      } catch {
        console.warn(`[assetLoader] Could not load furniture sprite for ${item.id}`);
        return null;
      }
    }),
  );

  const sprites: Record<string, SpriteData> = {};
  for (const entry of spriteEntries) {
    if (entry) sprites[entry.id] = entry.sprite;
  }

  const catalog: LoadedAssetData['catalog'] = manifest.items
    .filter((item) => sprites[item.id] !== undefined)
    .map((item) => ({
      id: item.id,
      label: item.label,
      category: item.category,
      width: item.width,
      height: item.height,
      footprintW: item.footprintW,
      footprintH: item.footprintH,
      isDesk: item.isDesk,
      ...(item.groupId !== undefined ? { groupId: item.groupId } : {}),
      ...(item.orientation !== undefined ? { orientation: item.orientation } : {}),
      ...(item.state !== undefined ? { state: item.state } : {}),
      ...(item.canPlaceOnSurfaces ? { canPlaceOnSurfaces: true } : {}),
      ...(item.backgroundTiles !== undefined && item.backgroundTiles > 0
        ? { backgroundTiles: item.backgroundTiles }
        : {}),
      ...(item.canPlaceOnWalls ? { canPlaceOnWalls: true } : {}),
      ...(item.mirrorSide ? { mirrorSide: true } : {}),
      ...(item.rotationScheme !== undefined ? { rotationScheme: item.rotationScheme } : {}),
      ...(item.animationGroup !== undefined ? { animationGroup: item.animationGroup } : {}),
      ...(item.frame !== undefined ? { frame: item.frame } : {}),
    }));

  return { catalog, sprites };
}

// ── Main entry ───────────────────────────────────────────────────

/**
 * Load all assets in parallel and feed them into the engine's global state.
 *
 * Call this once during app startup, before first render.
 */
export async function loadAllAssets(
  paths: AssetPaths,
  characterCount = 6,
): Promise<void> {
  const [characters, floors, walls, furniture] = await Promise.all([
    loadCharacters(paths.characters, characterCount),
    loadFloorTiles(paths.floors),
    loadWallSets(paths.walls),
    loadFurnitureSprites(paths.furniture, paths.furnitureManifest).catch((err) => {
      console.warn('[assetLoader] Furniture failed to load:', err);
      return null;
    }),
  ]);

  if (characters.length > 0) {
    setCharacterTemplates(characters);
    console.log(`[assetLoader] Loaded ${characters.length} character(s)`);
  } else {
    console.warn('[assetLoader] No character sprites loaded — using placeholder');
  }

  if (floors.length > 0) {
    setFloorSprites(floors);
    console.log(`[assetLoader] Loaded ${floors.length} floor tile(s)`);
  } else {
    console.warn('[assetLoader] No floor tiles loaded — using fallback solid tile');
  }

  if (walls.length > 0) {
    setWallSprites(walls);
    console.log(`[assetLoader] Loaded ${walls.length} wall set(s)`);
  } else {
    console.warn('[assetLoader] No wall tiles loaded');
  }

  if (furniture) {
    const ok = buildDynamicCatalog(furniture);
    if (!ok) {
      console.warn('[assetLoader] buildDynamicCatalog returned false — catalog may be empty');
    }
  }
}

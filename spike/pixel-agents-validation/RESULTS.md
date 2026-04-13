# pixel-agents Validation Spike

**Repo:** https://github.com/pablodelucca/pixel-agents  
**Date:** 2026-04-13  
**Analyst:** Claude (sonnet-4-6)  
**Source:** `spike/pixel-agents-source/` (shallow clone, `--depth 1`)

---

## Go / No-Go Decision

**GO** — with caveats on custom sprites and a clear integration path.

The library is a well-architected, production-quality VS Code extension. Its rendering engine, character FSM, and asset pipeline are directly reusable once the VS Code shell is stripped. The single friction point is that custom per-persona sprites require following a strict PNG layout (112×96, 3 directions × 7 frames); any standard pixel-art tool can produce this.

---

## Question-by-Question Answers

### 1. Can we use custom sprite sheets for each persona character?

**PASS — with a defined spec to follow.**

The asset loader (`src/assetLoader.ts: loadExternalCharacterSprites`) scans `assets/characters/char_N.png` files from *any external directory*. The extension explicitly supports an `externalAssetDirectories` config key. Each PNG must be **112 × 96 pixels**: 3 direction rows (down, up, right) × 7 animation frames of 16 × 32 pixels each.

Frame layout per row:
- Frames 0-2: walk cycle (3 keyframes; frame 1 is reused as frame 3)
- Frames 3-4: typing animation (2 frames)
- Frames 5-6: reading animation (2 frames)

Left-facing sprites are derived at runtime by horizontally flipping the `right` row — no separate left sheet is needed. Hue-shift variants are auto-generated from the same source.

**Key files:**
- `src/assetLoader.ts` — `loadExternalCharacterSprites()`, `decodeCharacterPng()`
- `shared/assets/constants.ts` — `CHAR_FRAME_W=16`, `CHAR_FRAME_H=32`, `CHAR_FRAMES_PER_ROW=7`, `CHAR_COUNT=6`
- `shared/assets/pngDecoder.ts` — `decodeCharacterPng(buffer)`
- `webview-ui/src/office/sprites/spriteData.ts` — `setCharacterTemplates()`, `getCharacterSprites()`

---

### 2. Can we trigger state transitions programmatically (idle → walking → typing → reading)?

**PASS — fully supported via `OfficeState` API.**

The `OfficeState` class (`webview-ui/src/office/engine/officeState.ts`) exposes clean imperative methods that cause immediate or FSM-driven state changes:

| Method | Effect |
|---|---|
| `setAgentActive(id, true)` | Causes idle/wandering character to pathfind back to seat and enter `TYPE` state |
| `setAgentActive(id, false)` | Character stands up from desk and begins wandering (`IDLE` → `WALK` → `IDLE` loop) |
| `setAgentTool(id, 'Read')` | Switches typing animation to reading animation (checked via `READING_TOOLS` Set) |
| `setAgentTool(id, null)` | Reverts to typing animation |
| `walkToTile(id, col, row)` | Immediately sets `WALK` state with A* pathfinding to given tile |
| `sendToSeat(id)` | Pathfinds to assigned seat and sits (`TYPE` state on arrival) |
| `addAgent(id)` | Spawns character with matrix "spawn" effect, starts in `TYPE` |
| `removeAgent(id)` | Triggers matrix "despawn" effect then removes character |

The three states (`IDLE`, `WALK`, `TYPE`) map naturally to our scenarios:
- **idle** → `IDLE` (character not at desk, wandering or paused)
- **walking** → `WALK` (pathfinding in progress)
- **typing** → `TYPE` with `currentTool` not in `READING_TOOLS`
- **reading** → `TYPE` with `currentTool` in `READING_TOOLS` (`'Read'`, `'Grep'`, `'Glob'`, `'WebFetch'`, `'WebSearch'`)

**Key files:**
- `webview-ui/src/office/engine/officeState.ts` — `OfficeState` class, all mutator methods
- `webview-ui/src/office/engine/characters.ts` — `updateCharacter()` FSM, `getCharacterSprite()`
- `webview-ui/src/office/types.ts` — `CharacterState` enum, `Character` interface

---

### 3. Can external events (like WebSocket messages) drive character animation changes?

**PASS — the existing wiring pattern is exactly what we need.**

The extension → webview message protocol (`webview-ui/src/hooks/useExtensionMessages.ts`) already demonstrates the pattern: `window.addEventListener('message', handler)` receives typed messages from the host and calls `OfficeState` methods directly.

The full list of messages the library handles today that would map 1:1 to our WebSocket events:

| Existing message type | Maps to our WS event | `OfficeState` call |
|---|---|---|
| `agentToolStart` | `session-update` (tool use) | `setAgentActive(id, true)`, `setAgentTool(id, toolName)` |
| `agentToolsClear` | `session-idle` | `setAgentTool(id, null)` |
| `agentStatus: 'waiting'` | idle timeout | `setAgentActive(id, false)`, `showWaitingBubble(id)` |
| `agentStatus: 'active'` | session-update | `setAgentActive(id, true)` |
| `agentCreated` | launch event | `addAgent(id)` |
| `agentClosed` | session end | `removeAgent(id)` |

For our DKCC integration, we would replace the `vscode.postMessage` / `window.addEventListener` channel with our existing dashboard WebSocket (`{panel:'office-session'}` messages). The `useExtensionMessages` hook can either be adapted or replaced with a thin `useWebSocketMessages` hook that calls the same `OfficeState` API.

**Key files:**
- `webview-ui/src/hooks/useExtensionMessages.ts` — full message handler (use as template)
- `webview-ui/src/office/engine/officeState.ts` — `setAgentActive()`, `setAgentTool()`, `showPermissionBubble()`, `showWaitingBubble()`

---

### 4. Does it include a layout editor for customizing the office floor plan?

**PASS — full-featured tile-based editor included.**

A complete in-app layout editor is built into the webview (`webview-ui/src/office/editor/`). Features confirmed from source:

- **Tile painting:** paint floor tiles (9 floor types) and wall tiles with color picker
- **Furniture placement:** drag-and-drop from a catalog; manifests in `assets/furniture/<name>/manifest.json`
- **Furniture rotation/mirroring:** rotate button on selected item; `mirrorSide` for left/right variants
- **Undo/redo stack** (capped at `UNDO_STACK_MAX_SIZE`)
- **Grid expand:** "ghost border" lets you click outside the current grid to grow it in any direction
- **Void tiles:** tiles can be marked VOID (transparent), enabling non-rectangular rooms
- **Layout save/load:** JSON format (`OfficeLayout`, version: 1) saved via `saveLayout` message; importable/exportable as files
- **External layout sync:** `watchLayoutFile()` syncs across VS Code windows

The layout format is simple JSON (`OfficeLayout` interface in `types.ts`): `{ version:1, cols, rows, tiles: TileType[], furniture: PlacedFurniture[], tileColors }`.

**Key files:**
- `webview-ui/src/office/editor/` — `EditorState`, `EditorToolbar`, `editorActions.ts`
- `webview-ui/src/office/layout/layoutSerializer.ts` — `serializeLayout()`, `deserializeLayout()`, `OfficeLayout` type
- `webview-ui/src/office/layout/furnitureCatalog.ts` — catalog management
- `webview-ui/public/assets/default-layout-1.json` — default layout JSON (use as starting point)

---

### 5. How does it perform with 5-10 simultaneous animated characters?

**PASS — architecture is designed for this scale.**

Performance assessment from code review:

**Rendering pipeline:**
- Single `<canvas>` with Canvas 2D API; `requestAnimationFrame` game loop (`gameLoop.ts`)
- `imageSmoothingEnabled = false` (pixelart-correct)
- `SpriteData` is a `string[][]` of hex color values — converted to `ImageData` and cached as `OffscreenCanvas` objects via `spriteCache.ts` (`getCachedSprite(sprite, zoom)`)
- Characters are z-sorted each frame (simple array sort), then drawn in one pass with `drawImage` calls on pre-rasterized `OffscreenCanvas` bitmaps
- Each `Character` object is ~20 primitive fields — negligible memory per character

**Scalability:**
- Sprite cache is keyed by `(spriteData, zoom)` — same palette + same state = one cached bitmap, shared across all frames
- With 10 characters, worst case is ~10 `drawImage` calls per frame (most sharing cached bitmaps) — well within 60 fps budget
- The A* pathfinder (`tileMap.ts`) runs per character on state change (not every frame)
- Sub-agents are supported (`addSubagent()`), meaning the system was tested with more characters than base agents
- No DOM elements per character — pure canvas

**No explicit benchmarks in source,** but the architecture (OffscreenCanvas caching + single-pass z-sort) is a well-established pattern that handles 20-50 sprites at 60fps without issue at these sprite sizes (16×32 px).

**Potential concern:** `SpriteData` as `string[][]` is verbose in memory (hex strings). Initial rasterization of all palettes × hue-shifts could take a few ms on startup. At 10 characters this is imperceptible; at 50+ it might be felt once. For our 5-10 persona use case this is a non-issue.

---

## Integration Path for DKCC Agent Office

The library is a VS Code extension. To integrate its rendering engine into DKCC:

1. **Copy only the webview modules** — `webview-ui/src/office/` is pure TypeScript with no VS Code dependency. The engine (`engine/`), layout (`layout/`), sprites (`sprites/`), and types (`types.ts`) are fully standalone.

2. **Replace `useExtensionMessages`** with a custom `useWebSocketMessages` hook that connects to the existing DKCC dashboard WebSocket and calls the same `OfficeState` API methods.

3. **Strip `vscodeApi.ts`** — all `vscode.postMessage` calls in the hook are for saving state back to the extension host. In DKCC these become REST calls or are dropped.

4. **Keep the asset pipeline** — the `shared/assets/pngDecoder.ts` PNG-to-SpriteData converter can run in Node.js (server-side) or be adapted for the browser with a canvas-based fallback.

5. **Custom character sprites** — create `assets/characters/char_N.png` files (112×96, one per persona) following the 3-row × 7-frame spec.

6. **Layout** — use the bundled `default-layout-1.json` as a starting point; the in-app editor can customize it and save to a local JSON file.

---

## Concerns and Limitations

| Concern | Severity | Notes |
|---|---|---|
| **VS Code wrapper must be stripped** | Low | The engine modules have zero VS Code deps; only the extension host wiring needs replacing |
| **Sprite sheet format is strict** | Low | 112×96 PNG, 3 directions × 7 frames at 16×32; any pixel art editor can produce this |
| **React dependency** | Medium | The webview uses React 19 + hooks. DKCC is vanilla JS. Options: (a) adopt React for the office panel only, (b) extract just the canvas engine classes and wire manually |
| **SpriteData format is string[][] not ImageBitmap** | Low | Verbose but works; the `spriteCache.ts` layer handles the conversion transparently |
| **No built-in WebSocket support** | Low | Expected — trivial to add by adapting `useExtensionMessages` |
| **TypeScript-only source** | Low | Requires a build step (Vite); DKCC has no build step today. Either add one for this panel or transpile the engine classes separately |
| **No "reading" sprites in current DKCC characters** | Low | Existing `*_sit_16x16.png` sprites would need frames 5-6 added, or the READING_TOOLS set cleared |

---

## Key Files Reference

| Purpose | File |
|---|---|
| Character FSM + state update | `webview-ui/src/office/engine/characters.ts` |
| Scene state (add/remove/mutate agents) | `webview-ui/src/office/engine/officeState.ts` |
| Canvas renderer (renderFrame) | `webview-ui/src/office/engine/renderer.ts` |
| Game loop (requestAnimationFrame) | `webview-ui/src/office/engine/gameLoop.ts` |
| Sprite resolution + hue-shift cache | `webview-ui/src/office/sprites/spriteData.ts` |
| Sprite rasterization cache | `webview-ui/src/office/sprites/spriteCache.ts` |
| Layout data types | `webview-ui/src/office/types.ts` |
| Layout JSON serialization | `webview-ui/src/office/layout/layoutSerializer.ts` |
| Furniture catalog | `webview-ui/src/office/layout/furnitureCatalog.ts` |
| A* pathfinder | `webview-ui/src/office/layout/tileMap.ts` |
| Extension ↔ webview message protocol (adapt for WS) | `webview-ui/src/hooks/useExtensionMessages.ts` |
| External character sprite loader | `src/assetLoader.ts` — `loadExternalCharacterSprites()` |
| Character PNG decoder | `shared/assets/pngDecoder.ts` — `decodeCharacterPng()` |
| Character sprite sheet spec | `shared/assets/constants.ts` — `CHAR_FRAME_W/H`, `CHAR_FRAMES_PER_ROW` |
| Default office layout | `webview-ui/public/assets/default-layout-1.json` |

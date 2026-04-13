/**
 * Character — a persona character sitting at a desk with pixel-art sprite.
 *
 * Sprite sheets are 112x96px = 7 frames x 3 rows (front/left/right),
 * each frame 16x32px. We use CSS background-position stepping to animate.
 *
 * Props:
 *   persona   — { personaId, label, domain, characterSprite, ... }
 *   session   — { totals, working } or undefined
 *   onSelect  — (persona) => void, called when character is clicked
 */
import { useState, useEffect } from 'react';
import TokenBadge from './TokenBadge.jsx';

const DOMAIN_COLORS = {
  frontend: '#60a5fa',
  backend:  '#34d399',
  debug:    '#fb923c',
  review:   '#a78bfa',
  devops:   '#f472b6',
};

const DEFAULT_COLOR = '#94a3b8';

// Sprite sheet layout: 7 columns x 3 rows, each frame 16x32
const FRAME_W = 16;
const FRAME_H = 32;
const TOTAL_FRAMES = 7;
const SCALE = 3; // render at 3x for visibility (48x96 on screen)

// Map persona characterSprite to sprite sheet file
// char_1 through char_5 assigned to personas, char_0 as fallback
const SPRITE_MAP = {
  char_1: '/assets/characters/char_1.png',
  char_2: '/assets/characters/char_2.png',
  char_3: '/assets/characters/char_3.png',
  char_4: '/assets/characters/char_4.png',
  char_5: '/assets/characters/char_5.png',
};
const FALLBACK_SPRITE = '/assets/characters/char_0.png';

function getSpriteUrl(characterSprite) {
  return SPRITE_MAP[characterSprite] ?? FALLBACK_SPRITE;
}

function getColor(domain) {
  return DOMAIN_COLORS[domain?.toLowerCase()] ?? DEFAULT_COLOR;
}

export default function Character({ persona, session, onSelect }) {
  const working = session?.working ?? false;
  const color = getColor(persona?.domain);
  const spriteUrl = getSpriteUrl(persona?.characterSprite);

  // Animate through sprite frames
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    // Idle: slow animation (500ms per frame, only first 4 frames)
    // Working: fast animation (200ms per frame, all 7 frames)
    const speed = working ? 200 : 500;
    const maxFrames = working ? TOTAL_FRAMES : 4;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % maxFrames);
    }, speed);
    return () => clearInterval(interval);
  }, [working]);

  // Row 0 = front-facing (looking at camera)
  const row = 0;
  const bgX = -(frame * FRAME_W * SCALE);
  const bgY = -(row * FRAME_H * SCALE);

  return (
    <div
      className="character-wrapper"
      onClick={() => onSelect?.(persona)}
      title={persona?.label}
    >
      {/* Token badge floats above the avatar */}
      <TokenBadge totals={session?.totals} working={working} />

      {/* Pixel-art sprite */}
      <div
        className={`character-sprite ${working ? 'character-sprite--working' : ''}`}
        style={{
          width: FRAME_W * SCALE,
          height: FRAME_H * SCALE,
          backgroundImage: `url(${spriteUrl})`,
          backgroundSize: `${112 * SCALE}px ${96 * SCALE}px`,
          backgroundPosition: `${bgX}px ${bgY}px`,
          imageRendering: 'pixelated',
          '--char-color': color,
        }}
      />

      {/* Domain color indicator dot */}
      <div
        className="character-domain-dot"
        style={{ backgroundColor: color }}
      />

      {/* Name label */}
      <span className="character-name">{persona?.label ?? 'Unknown'}</span>
    </div>
  );
}

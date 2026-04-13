/**
 * Character — a persona character sitting at a desk.
 *
 * Props:
 *   persona   — { id, name, domain, ... }
 *   session   — { totals, working } or undefined
 *   onSelect  — (persona) => void, called when character is clicked
 */
import TokenBadge from './TokenBadge.jsx';

const DOMAIN_COLORS = {
  frontend: '#60a5fa',
  backend:  '#34d399',
  debug:    '#fb923c',
  review:   '#a78bfa',
  devops:   '#f472b6',
};

const DEFAULT_COLOR = '#94a3b8';

function getColor(domain) {
  return DOMAIN_COLORS[domain?.toLowerCase()] ?? DEFAULT_COLOR;
}

function getInitial(name) {
  return (name ?? '?').charAt(0).toUpperCase();
}

export default function Character({ persona, session, onSelect }) {
  const color = getColor(persona?.domain);
  const initial = getInitial(persona?.name);
  const working = session?.working ?? false;

  return (
    <div
      className="character-wrapper"
      onClick={() => onSelect?.(persona)}
      title={persona?.name}
    >
      {/* Token badge floats above the avatar */}
      <TokenBadge totals={session?.totals} working={working} />

      {/* Avatar */}
      <div
        className={['character-avatar', working ? 'character-avatar--working' : 'character-avatar--idle'].join(' ')}
        style={{ '--char-color': color }}
      >
        <span className="character-initial">{initial}</span>
      </div>

      {/* Name label */}
      <span className="character-name">{persona?.name ?? 'Unknown'}</span>
    </div>
  );
}

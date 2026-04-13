/**
 * OfficeScene — main office panel.
 *
 * Renders a dark office background with desks placed at fixed percentage
 * positions. Each occupied desk shows a Character; empty desks show a
 * placeholder. Personas come from useOfficeStore.
 */
import { useOfficeStore } from '../stores/office-store.js';
import Character from './Character.jsx';

/** Desk positions as % of the scene container (left / top). */
const DESK_POSITIONS = [
  { x: 15, y: 30, label: 'Desk 1' },
  { x: 45, y: 30, label: 'Desk 2' },
  { x: 75, y: 30, label: 'Desk 3' },
  { x: 15, y: 65, label: 'Desk 4' },
  { x: 45, y: 65, label: 'Desk 5' },
];

export default function OfficeScene() {
  const personas  = useOfficeStore((s) => s.personas);
  const sessions  = useOfficeStore((s) => s.sessions);
  const openPicker = useOfficeStore((s) => s.openPicker);

  function handleSelect(persona) {
    openPicker(persona.personaId);
  }

  return (
    <div className="office-scene">
      {/* Ambient room elements */}
      <div className="office-ceiling-lights">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="office-light" />
        ))}
      </div>

      {/* Desks */}
      {DESK_POSITIONS.map((desk, idx) => {
        const persona = personas[idx] ?? null;
        const session = persona ? sessions[persona.personaId] : undefined;

        return (
          <div
            key={desk.label}
            className="office-desk-slot"
            style={{ left: `${desk.x}%`, top: `${desk.y}%` }}
          >
            {/* Desk surface */}
            <div className="office-desk">
              <div className="office-monitor" />
              <div className="office-monitor-screen" />
              <div className="office-keyboard" />
            </div>

            {/* Character or empty placeholder */}
            {persona ? (
              <Character
                persona={persona}
                session={session}
                onSelect={handleSelect}
              />
            ) : (
              <div className="office-empty-seat" title={desk.label} />
            )}
          </div>
        );
      })}

      {/* Floor grid overlay */}
      <div className="office-floor-grid" aria-hidden="true" />
    </div>
  );
}

import { useOfficeStore } from '../stores/office-store.js';

const TABS = ['EVOLVE', 'RESEARCH', 'SKILLS', 'HELP', 'CREATE'];

export default function LeftSidebar() {
  const projects = useOfficeStore((s) => s.projects);

  return (
    <aside className="sidebar sidebar--left">
      <div className="sidebar-section">
        <h3 className="sidebar-label">Projects</h3>
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.id} className="project-item">
              {p.name || (p.path ? p.path.split('/').pop() : 'unnamed')}
            </li>
          ))}
        </ul>
        <button className="sidebar-link">ALL PROJECTS ›</button>
      </div>

      <div className="sidebar-section">
        <div className="tab-bar">
          {TABS.map((tab) => (
            <button
              key={tab}
              className={`tab-button ${tab === 'SKILLS' ? 'tab-button--active' : ''}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-section sidebar-section--grow">
        <div className="checklist">
          <div className="checklist-item">☐ Continue where I left off</div>
          <div className="checklist-item">☐ Plan before building</div>
          <div className="checklist-item">☐ Ship and deploy</div>
          <div className="checklist-item">☐ Debug systematically</div>
          <div className="checklist-item">☐ Review my code</div>
          <div className="checklist-item">☐ Refactor this</div>
        </div>
      </div>
    </aside>
  );
}

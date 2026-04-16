import { useOfficeStore } from '../stores/office-store.js';
import { isSessionLive, useSessionClock } from '../lib/session-status.js';

const TABS = ['EVOLVE', 'RESEARCH', 'SKILLS', 'HELP', 'CREATE'];

export default function LeftSidebar() {
  const projects = useOfficeStore((s) => s.projects);
  const personas = useOfficeStore((s) => s.personas);
  const sessions = useOfficeStore((s) => s.sessions);
  const pinnedProjectIds = useOfficeStore((s) => s.pinnedProjectIds);
  const recentProjectIds = useOfficeStore((s) => s.recentProjectIds);
  const activeView = useOfficeStore((s) => s.activeView);
  const setActiveView = useOfficeStore((s) => s.setActiveView);
  const now = useSessionClock();

  const pinnedProjects = pinnedProjectIds
    .map((projectId) => projects.find((project) => project.id === projectId))
    .filter(Boolean)
    .slice(0, 4);
  const recentProjects = recentProjectIds
    .filter((projectId) => !pinnedProjectIds.includes(projectId))
    .map((projectId) => projects.find((project) => project.id === projectId))
    .filter(Boolean)
    .slice(0, 4);
  const activeCount = Object.values(sessions).filter((session) => isSessionLive(session, now)).length;

  function tabView(tab) {
    if (tab === 'SKILLS') return 'office';
    if (tab === 'HISTORY') return 'history';
    return 'coming-soon';
  }

  function isTabActive(tab) {
    return activeView === tabView(tab);
  }

  return (
    <aside className="sidebar sidebar--left">
      <div className="sidebar-section">
        <h3 className="sidebar-label">Launch Flow</h3>
        <div className="checklist">
          <div className="checklist-item">1. Click an agent in the office</div>
          <div className="checklist-item">2. Pick an active, pinned, or recent project</div>
          <div className="checklist-item">3. Inspect prompt and skills before launch</div>
        </div>
        <div className="metric-card mt-3">
          <span className="metric-label">Active desks</span>
          <span className="metric-value">{activeCount}</span>
        </div>
        <p className="mt-3 text-[11px] text-gray-500">
          {personas.length > 0
            ? `Office has ${personas.length} personas ready to launch.`
            : 'No personas loaded yet.'}
        </p>
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-label">Pinned Projects</h3>
        {pinnedProjects.length === 0 ? (
          <p className="text-[11px] text-gray-500">
            Pin projects from the picker to keep your usual repos near the top.
          </p>
        ) : (
          <ul className="project-list">
            {pinnedProjects.map((project) => (
              <li key={project.id} className="project-item">
                {project.name || (project.path ? project.path.split('/').pop() : 'unnamed')}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sidebar-section">
        <h3 className="sidebar-label">Recent Projects</h3>
        {recentProjects.length === 0 ? (
          <p className="text-[11px] text-gray-500">
            Recent launches and completed sessions will appear here automatically.
          </p>
        ) : (
          <ul className="project-list">
            {recentProjects.map((project) => (
              <li key={project.id} className="project-item">
                {project.name || (project.path ? project.path.split('/').pop() : 'unnamed')}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sidebar-section">
        <div className="tab-bar">
          {['SKILLS', 'HISTORY', ...TABS.filter((tab) => tab !== 'SKILLS')].map((tab) => (
            <button
              key={tab}
              className={`tab-button ${isTabActive(tab) ? 'tab-button--active' : ''}`}
              onClick={() => setActiveView(tabView(tab))}
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

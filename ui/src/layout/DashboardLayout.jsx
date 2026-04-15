import Header from './Header.jsx';
import LeftSidebar from './LeftSidebar.jsx';
import RightSidebar from './RightSidebar.jsx';
import { useOfficeStore } from '../stores/office-store.js';
import HistoryView from '../dashboard/HistoryView.jsx';

export default function DashboardLayout({ children }) {
  const activeView = useOfficeStore((s) => s.activeView);

  return (
    <div className="dashboard">
      <Header />
      <div className="dashboard-body">
        <LeftSidebar />
        <main className="dashboard-center">
          {activeView === 'history' ? (
            <HistoryView />
          ) : activeView === 'coming-soon' ? (
            <div className="panel-placeholder panel-placeholder--tall">Coming soon</div>
          ) : (
            children
          )}
        </main>
        <RightSidebar />
      </div>
    </div>
  );
}

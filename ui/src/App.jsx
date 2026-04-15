import { useEffect, useRef } from 'react';
import { useOfficeStore } from './stores/office-store.js';
import { createWsClient } from './lib/ws-client.js';
import DashboardLayout from './layout/DashboardLayout.jsx';
import OfficeCanvas from './office/OfficeCanvas.jsx';
import ProjectPicker from './office/ProjectPicker.jsx';
import LaunchPreview from './office/LaunchPreview.jsx';

export default function App() {
  const fetchPersonas = useOfficeStore((s) => s.fetchPersonas);
  const fetchProjects = useOfficeStore((s) => s.fetchProjects);
  const fetchActiveSessions = useOfficeStore((s) => s.fetchActiveSessions);
  const fetchPortfolioStats = useOfficeStore((s) => s.fetchPortfolioStats);
  const fetchRecentSessions = useOfficeStore((s) => s.fetchRecentSessions);
  const wsClientRef = useRef(null);

  useEffect(() => {
    fetchPersonas();
    fetchProjects();
    fetchActiveSessions();
    fetchPortfolioStats();
    fetchRecentSessions();
    wsClientRef.current = createWsClient(useOfficeStore);
    return () => wsClientRef.current?.close();
  }, [
    fetchPersonas,
    fetchProjects,
    fetchActiveSessions,
    fetchPortfolioStats,
    fetchRecentSessions,
  ]);

  return (
    <>
      <DashboardLayout>
        <OfficeCanvas />
      </DashboardLayout>
      <ProjectPicker />
      <LaunchPreview />
    </>
  );
}

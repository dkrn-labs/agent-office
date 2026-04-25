import { useEffect, useRef } from 'react';
import { useOfficeStore } from './stores/office-store.js';
import { createWsClient } from './lib/ws-client.js';
import DashboardLayout from './layout/DashboardLayout.jsx';
import OfficeCanvas from './office/OfficeCanvas.jsx';
import LaunchWizard from './office/LaunchWizard.jsx';
import LightV2 from './mockups/LightV2.jsx';

export default function App() {
  // P1-8 — v2 is now the default; classic office is reachable at /legacy.
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    const isLegacy = path.startsWith('/legacy');
    if (!isLegacy) return <LightV2 />;
  }

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
      <LaunchWizard />
    </>
  );
}

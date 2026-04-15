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
  const fetchActivityStats = useOfficeStore((s) => s.fetchActivityStats);
  const fetchPulse = useOfficeStore((s) => s.fetchPulse);
  const fetchRecentSessions = useOfficeStore((s) => s.fetchRecentSessions);
  const fetchTerrainSessions = useOfficeStore((s) => s.fetchTerrainSessions);
  const wsClientRef = useRef(null);

  useEffect(() => {
    fetchPersonas();
    fetchProjects();
    fetchActiveSessions();
    fetchActivityStats();
    fetchPulse();
    fetchRecentSessions();
    fetchTerrainSessions();
    wsClientRef.current = createWsClient(useOfficeStore);
    return () => wsClientRef.current?.close();
  }, [
    fetchPersonas,
    fetchProjects,
    fetchActiveSessions,
    fetchActivityStats,
    fetchPulse,
    fetchRecentSessions,
    fetchTerrainSessions,
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

import { useEffect, useRef } from 'react';
import { useOfficeStore } from './stores/office-store.js';
import { createWsClient } from './lib/ws-client.js';
import DashboardLayout from './layout/DashboardLayout.jsx';
import OfficeCanvas from './office/OfficeCanvas.jsx';
import ProjectPicker from './office/ProjectPicker.jsx';

export default function App() {
  const fetchPersonas = useOfficeStore((s) => s.fetchPersonas);
  const fetchProjects = useOfficeStore((s) => s.fetchProjects);
  const wsClientRef = useRef(null);

  useEffect(() => {
    fetchPersonas();
    fetchProjects();
    wsClientRef.current = createWsClient(useOfficeStore);
    return () => wsClientRef.current?.close();
  }, [fetchPersonas, fetchProjects]);

  return (
    <>
      <DashboardLayout>
        <OfficeCanvas />
      </DashboardLayout>
      <ProjectPicker />
    </>
  );
}

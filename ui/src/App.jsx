import { useEffect, useRef } from 'react';
import { useOfficeStore } from './stores/office-store.js';
import { createWsClient } from './lib/ws-client.js';
import OfficeScene from './office/OfficeScene.jsx';
import ProjectPicker from './office/ProjectPicker.jsx';

export default function App() {
  const fetchPersonas = useOfficeStore((s) => s.fetchPersonas);
  const fetchProjects = useOfficeStore((s) => s.fetchProjects);
  const connected     = useOfficeStore((s) => s.connected);
  const wsClientRef   = useRef(null);

  useEffect(() => {
    // Load initial data
    fetchPersonas();
    fetchProjects();

    // Connect WebSocket
    wsClientRef.current = createWsClient(useOfficeStore);

    return () => {
      wsClientRef.current?.close();
    };
  }, [fetchPersonas, fetchProjects]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-800 px-6 py-4 shrink-0">
        <h1 className="text-xl font-bold tracking-tight">Agent Office</h1>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              connected ? 'bg-green-400' : 'bg-red-500'
            }`}
            title={connected ? 'Connected' : 'Disconnected'}
          />
          <span className="text-xs text-gray-400">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <OfficeScene />
      </main>

      {/* Project picker modal — renders itself when store.pickerOpen is true */}
      <ProjectPicker />
    </div>
  );
}

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backendPort = process.env.AGENT_OFFICE_BACKEND_PORT ?? '3334';
const httpTarget = `http://127.0.0.1:${backendPort}`;
const wsTarget = `ws://127.0.0.1:${backendPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': httpTarget,
      '/ws': { target: wsTarget, ws: true },
    },
  },
  build: { outDir: 'dist' },
});

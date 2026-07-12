import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: `npm run dev` proxies /api to the orchestrator server on :8787.
// Prod: `npm run build` → dist/, which server.ts serves statically (same origin, no proxy).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787' } },
  },
});

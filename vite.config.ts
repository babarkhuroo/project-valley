import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiMiddleware } from './server/api.ts';
import { createBackend } from './server/backend.ts';
import type { LiveHub } from './server/live.ts';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** JSON files in server/data by default; set DATABASE_URL to develop against Postgres. */
async function createApi(dev: boolean) {
  const backend = await createBackend({ dataDir: path.resolve(projectRoot, 'server/data'), databaseUrl: process.env.DATABASE_URL });
  return { middleware: createApiMiddleware(backend.saves, backend.valleys, { dev, auth: backend.auth }), hub: backend.hub };
}

/** Routes WebSocket upgrades for /api/live to the hub (Vite's own HMR socket is left alone). */
function liveUpgrades(httpServer: { on(event: 'upgrade', fn: (req: IncomingMessage, socket: Duplex) => void): unknown } | null, hub: LiveHub): void {
  httpServer?.on('upgrade', (req, socket) => {
    if (req.url?.startsWith('/api/live')) void hub.handleUpgrade(req, socket);
  });
}

/** Mounts the persistence API into the Vite dev server so `npm run dev` is all you need. */
function valleyApi(): Plugin {
  return {
    name: 'valley-api',
    async configureServer(server) {
      // Dev-only routes (Valley time skips) exist only on the dev server.
      const api = await createApi(true);
      server.middlewares.use(api.middleware);
      liveUpgrades(server.httpServer, api.hub);
    },
    async configurePreviewServer(server) {
      const api = await createApi(false);
      server.middlewares.use(api.middleware);
      liveUpgrades(server.httpServer, api.hub);
    },
  };
}

export default defineConfig({
  plugins: [react(), valleyApi()],
  server: { port: 5173 },
  build: {
    // three.js alone is ~580 kB minified (≈146 kB gzipped); the game code is far smaller.
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      output: {
        // Vendor code changes far less often than game code; keep it in its own cacheable chunks.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|zustand)/ },
          ],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiMiddleware } from './server/api.ts';
import { FileSaveStore, FileValleyStore } from './server/saveStore.ts';
import { ValleyService } from './server/valleyService.ts';
import { AuthService, FileAuthStore } from './server/auth.ts';
import { LiveHub } from './server/live.ts';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function createApi(dev: boolean) {
  const saves = new FileSaveStore(path.resolve(projectRoot, 'server/data/saves'));
  const valleys = new ValleyService(new FileValleyStore(path.resolve(projectRoot, 'server/data')));
  const auth = new AuthService(new FileAuthStore(path.resolve(projectRoot, 'server/data/auth.json')));
  const hub = new LiveHub(valleys, auth);
  return { middleware: createApiMiddleware(saves, valleys, { dev, auth }), hub };
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
    configureServer(server) {
      // Dev-only routes (Valley time skips) exist only on the dev server.
      const api = createApi(true);
      server.middlewares.use(api.middleware);
      liveUpgrades(server.httpServer, api.hub);
    },
    configurePreviewServer(server) {
      const api = createApi(false);
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

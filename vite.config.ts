import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiMiddleware } from './server/api.ts';
import { FileSaveStore, FileValleyStore } from './server/saveStore.ts';
import { ValleyService } from './server/valleyService.ts';
import { AuthService, FileAuthStore } from './server/auth.ts';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function createApi(dev: boolean) {
  const saves = new FileSaveStore(path.resolve(projectRoot, 'server/data/saves'));
  const valleys = new ValleyService(new FileValleyStore(path.resolve(projectRoot, 'server/data')));
  const auth = new AuthService(new FileAuthStore(path.resolve(projectRoot, 'server/data/auth.json')));
  return createApiMiddleware(saves, valleys, { dev, auth });
}

/** Mounts the persistence API into the Vite dev server so `npm run dev` is all you need. */
function valleyApi(): Plugin {
  return {
    name: 'valley-api',
    configureServer(server) {
      // Dev-only routes (Valley time skips) exist only on the dev server.
      server.middlewares.use(createApi(true));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApi(false));
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

import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiMiddleware } from './api.ts';
import { createBackend } from './backend.ts';

/**
 * Production server: serves the built client from /dist plus the persistence API.
 * With DATABASE_URL set it uses Postgres and any number of these processes can run
 * side by side (behind a load balancer); without it, JSON files in server/data.
 */
const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(root, '../dist');
const port = Number(process.env.PORT ?? 8080);
const backend = await createBackend({ dataDir: path.resolve(root, 'data'), databaseUrl: process.env.DATABASE_URL });
const { hub } = backend;
const api = createApiMiddleware(backend.saves, backend.valleys, { auth: backend.auth, playtest: backend.playtest, adminToken: process.env.ADMIN_TOKEN || undefined });

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  void api(req, res, async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const requested = path.normalize(path.join(distDir, decodeURIComponent(url.pathname)));
    const file = requested.startsWith(distDir) ? requested : path.join(distDir, 'index.html');
    try {
      const stat = await fs.stat(file);
      const target = stat.isDirectory() ? path.join(file, 'index.html') : file;
      res.setHeader('Content-Type', MIME[path.extname(target)] ?? 'application/octet-stream');
      res.end(await fs.readFile(target));
    } catch {
      res.setHeader('Content-Type', MIME['.html']);
      res.end(await fs.readFile(path.join(distDir, 'index.html')));
    }
  });
})
  .on('upgrade', (req, socket) => {
    if (req.url?.startsWith('/api/live')) void hub.handleUpgrade(req, socket);
    else socket.destroy();
  })
  .listen(port, () => {
    console.log(`Project Valley server listening on http://localhost:${port} (${backend.kind} storage)`);
  });

// Close sockets, the bus and the database cleanly so a rolling restart drops nothing mid-write.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    void backend.close().finally(() => process.exit(0));
  });
}

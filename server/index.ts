import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiMiddleware } from './api.ts';
import { FileSaveStore, FileValleyStore } from './saveStore.ts';
import { ValleyService } from './valleyService.ts';
import { AuthService, FileAuthStore } from './auth.ts';

/** Production server: serves the built client from /dist plus the persistence API. */
const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(root, '../dist');
const port = Number(process.env.PORT ?? 8080);
const api = createApiMiddleware(new FileSaveStore(path.resolve(root, 'data/saves')), new ValleyService(new FileValleyStore(path.resolve(root, 'data'))), {
  auth: new AuthService(new FileAuthStore(path.resolve(root, 'data/auth.json'))),
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
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
}).listen(port, () => {
  console.log(`Project Valley server listening on http://localhost:${port}`);
});

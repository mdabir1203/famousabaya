// Minimal HTTP server that mimics server.js's /updates/<channel>/<file>
// static handler. Used only for testing the Electron launcher's auto-update
// flow end-to-end without spinning up the full factory server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIRROR_ROOT = path.join(ROOT, 'data', 'lan-update-mirror');
const PORT = Number(process.env.TEST_MIRROR_PORT || 3111);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/updates\/(stable|beta)\/(.+)$/);
  if (!m) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const filePath = path.join(MIRROR_ROOT, m[1], m[2]);
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const ct = ext === '.yml' || ext === '.yaml' ? 'text/yaml; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (_) {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[test-mirror] listening http://127.0.0.1:' + PORT + '/updates/<channel>/<file>');
});

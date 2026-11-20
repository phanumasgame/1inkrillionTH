import { createServer } from 'node:http';
import fs from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import suggestionsHandler from '../api/suggestions.js';
import telemetryHandler from '../api/telemetry.js';
import healthHandler from '../api/health.js';

for (const envFile of ['.env.local', '.env']) {
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile(envFile); } catch {}
  }
}

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const routes = new Set(['/', '/daily', '/unlimited', '/unlimited/classic']);
const apiRoutes = new Map([
  ['/api/suggestions', suggestionsHandler],
  ['/api/telemetry', telemetryHandler],
  ['/api/health', healthHandler],
]);

function adaptRes(res) {
  let code = 200;
  res.status = statusCode => { code = statusCode; return res; };
  res.json = payload => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(code);
    res.end(JSON.stringify(payload));
  };
  res.send = payload => {
    res.writeHead(code);
    res.end(payload);
  };
  return res;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (apiRoutes.has(pathname)) {
      req.query = Object.fromEntries(url.searchParams.entries());
      return await apiRoutes.get(pathname)(req, adaptRes(res));
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end();
    }
    const relative = routes.has(pathname) ? 'index.html' : pathname.replace(/^\/+/, '');
    if (relative.split(/[\\/]/).some(segment => segment.startsWith('.'))) {
      res.writeHead(404); return res.end('Not found');
    }
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep) && target !== path.join(root, 'index.html')) {
      res.writeHead(403); return res.end('Forbidden');
    }
    const info = await stat(target);
    if (!info.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const content = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});
server.listen(port, host, () => {
  process.stdout.write('Krillion TH is ready at http://' + host + ':' + port + '\n');
});
server.on('error', error => {
  process.stderr.write(error.code === 'EADDRINUSE' ? 'Port ' + port + ' is in use. Set PORT to choose another.\n' : error.message + '\n');
  process.exitCode = 1;
});

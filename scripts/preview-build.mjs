import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = path.join(project, 'dist');
const config = JSON.parse(await readFile(path.join(project, 'vercel.json'), 'utf8'));
const rewrites = new Map(config.rewrites.map(rule => [rule.source, rule.destination]));
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || '127.0.0.1';
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.webp':'image/webp', '.ttf':'font/ttf',
  '.txt':'text/plain; charset=utf-8', '.md':'text/plain; charset=utf-8' };

try { await stat(path.join(output, 'index.html')); }
catch { console.error('No build found. Run npm run build first.'); process.exit(1); }

const server = createServer(async (request, response) => {
  try {
    if (!['GET','HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow:'GET, HEAD' }); return response.end();
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const rewritten = rewrites.get(pathname) || pathname;
    const relative = rewritten === '/' ? 'index.html' : rewritten.replace(/^\/+/, '');
    if (relative.split(/[\\/]/).some(segment => segment.startsWith('.'))) {
      response.writeHead(404); return response.end('Not found');
    }
    const target = path.resolve(output, relative);
    if (!target.startsWith(output + path.sep)) { response.writeHead(403); return response.end('Forbidden'); }
    if (!(await stat(target)).isFile()) { response.writeHead(404); return response.end('Not found'); }
    const content = await readFile(target);
    response.writeHead(200, { 'Content-Type':types[path.extname(target)] || 'application/octet-stream',
      'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'same-origin' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(port, host, () => console.log('Static build preview at http://' + host + ':' + port));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });

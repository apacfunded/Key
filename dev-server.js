// Local preview: serves public/ and runs the API routes the way Vercel does. Run: node dev-server.js
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const mod = await import('./api/' + url.pathname.slice(5).replace(/[^a-z]/g, '') + '.js');
      const chunks = []; for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const out = await (mod[req.method] ? mod[req.method](request) : new Response('Not allowed', { status: 405 }));
      res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(Buffer.from(await out.arrayBuffer())); return;
    }
    const file = path.join('public', path.normalize(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith('public')) throw 0;
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(process.env.PORT || 3000, () => console.log('key running on http://localhost:' + (process.env.PORT || 3000)));

/* ------------------------------------------------------------------ *
 * server.js - local dev server for "Out of Order - Chain, Race, Recover".
 *
 *   /                 -> static files from ./public
 *   /api/mealdb/*     -> proxied to the assignment API (same path)
 *
 * The proxy adds no delay of its own: every endpoint keeps the delay the
 * API applies (2000 / 1000 / 500 / 300 / 200 ms). No dependencies - run
 * it with `node server.js` (Node 18+ for the built-in fetch).
 * ------------------------------------------------------------------ */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 5173;
const UPSTREAM = 'https://api-hub-50046202742.development.catalystappsail.in';
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/* headers worth passing back to the browser so the Network panel shows them */
const FORWARD = ['content-type', 'cache-control', 'etag', 'last-modified', 'x-delay-ms', 'x-upstream-cache'];

async function proxy(req, res) {
  const started = performance.now();
  const target = UPSTREAM + req.url;
  try {
    const upstream = await fetch(target, { headers: { accept: req.headers.accept || '*/*' } });
    const body = Buffer.from(await upstream.arrayBuffer());

    const headers = { 'x-proxied-from': target };
    for (const name of FORWARD) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    res.writeHead(upstream.status, headers);
    res.end(body);
    console.log(`proxy ${upstream.status} ${req.url} ${Math.round(performance.now() - started)} ms`);
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { name: 'ProxyError', message: `upstream unreachable: ${err.message}` } }));
    console.log(`proxy 502 ${req.url} ${err.message}`);
  }
}

async function serveStatic(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const file = join(PUBLIC_DIR, rel === '' ? 'index.html' : rel);

  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
}

http
  .createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (req.url.startsWith('/api/mealdb/')) return proxy(req, res);
    return serveStatic(req, res);
  })
  .listen(PORT, () => {
    console.log(`Out of Order demo  ->  http://localhost:${PORT}/`);
    console.log(`  broken version     http://localhost:${PORT}/?mode=broken`);
    console.log(`  corrected version  http://localhost:${PORT}/?mode=corrected`);
    console.log(`  /api/mealdb/* proxied to ${UPSTREAM}/api/mealdb/*`);
  });

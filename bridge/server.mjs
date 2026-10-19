// Production server: one HTTP port for everything the browser client needs
// once the Vite dev server is gone (the Docker image, docs/DEPLOY.md).
//
//   /               the classic client (client/dist/classic.html); no other
//                   page of the build is served
//   /bridge?port=N  the WebSocket <-> TCP relay to newserv (bridge.mjs does
//                   the same on its own port in development)
//   /keys/*.nsk     newserv's BB key files
//   /newserv-text/  newserv's bb-v4 unitxt (item names that match its ItemPMT)
//   /newserv-maps/  newserv's bb-v4 set data (entity ids, data/clientfiles.ts)
//   /psobb-data/    the PSOBB client data folder, if one is mounted
//                   (PSOBB_DATA); without it the page asks for the folder
//
// Env: PORT (default 8080), DIST, NEWSERV_SYSTEM, PSOBB_DATA, TARGET_HOST
// (default 127.0.0.1), ALLOWED_PORTS (as bridge.mjs).

import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import { extname, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';

const here = import.meta.dirname;
const PORT = Number(process.env.PORT ?? 8080);
const DIST = resolve(process.env.DIST ?? resolve(here, '../client/dist'));
const SYSTEM = resolve(process.env.NEWSERV_SYSTEM ?? resolve(here, '../vendor/newserv/system'));
const DATA = process.env.PSOBB_DATA ? resolve(process.env.PSOBB_DATA) : null;
const TARGET_HOST = process.env.TARGET_HOST ?? '127.0.0.1';
const ALLOWED_PORTS = new Set(
  (process.env.ALLOWED_PORTS ?? '12000,12001,12002,12003,12004,12005,12006,12007,12008').split(',').map((p) => Number(p.trim())),
);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// A file under `root`, or null when the path leaves it or does not exist.
function inside(root, rel) {
  const target = resolve(root, rel);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return existsSync(target) && statSync(target).isFile() ? target : null;
}

function send(res, file, type) {
  res.writeHead(200, { 'Content-Type': type ?? TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

function notFound(res, code = 404) {
  res.writeHead(code);
  res.end();
}

// name -> [directory, allowed name pattern]
const NEWSERV_FILES = {
  '/keys/': [resolve(SYSTEM, 'blueburst/keys'), /^[a-z0-9]+\.nsk$/],
  '/newserv-text/': [resolve(SYSTEM, 'text-sets/bb-v4'), /^unitxt_[a-z]+\.prs$/],
  '/newserv-maps/': [resolve(SYSTEM, 'maps/bb-v4'), /^(map_[a-z0-9_]+\.(dat|evt)|SetDataTable[A-Za-z]*\.rel)$/],
};

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res, 405);
  const url = new URL(req.url ?? '/', 'http://server');
  const path = decodeURIComponent(url.pathname);

  for (const [prefix, [dir, pattern]] of Object.entries(NEWSERV_FILES)) {
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    const file = pattern.test(name) ? inside(dir, name) : null;
    return file ? send(res, file, 'application/octet-stream') : notFound(res);
  }

  if (path.startsWith('/psobb-data')) {
    if (!DATA || !existsSync(DATA)) return notFound(res);
    const list = url.searchParams.get('list');
    if (list !== null) {
      const dir = resolve(DATA, list);
      if (dir !== DATA && !dir.startsWith(DATA + sep)) return notFound(res, 403);
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => statSync(resolve(dir, f)).isFile()) : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(files.sort()));
    }
    const file = inside(DATA, path.slice('/psobb-data/'.length));
    return file ? send(res, file, 'application/octet-stream') : notFound(res);
  }

  // Only the classic client is public: "/" opens it, and the development
  // pages (index.html, models.html) are not served even if a build has them.
  if (path === '/' || path === '/classic' || path === '/classic.html') return send(res, resolve(DIST, 'classic.html'));
  if (path.endsWith('.html')) return notFound(res);
  const file = inside(DIST, path.slice(1));
  return file ? send(res, file) : notFound(res);
});

// The relay: the same byte pipe as bridge.mjs, on the HTTP port.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://server');
  if (url.pathname !== '/bridge' && url.pathname !== '/bridge/') return socket.destroy();
  const port = Number(url.searchParams.get('port'));
  if (!ALLOWED_PORTS.has(port)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => relay(ws, port));
});

function relay(ws, port) {
  const tcp = net.connect({ host: TARGET_HOST, port });
  tcp.setNoDelay(true);
  const pending = [];
  tcp.on('connect', () => {
    for (const chunk of pending) tcp.write(chunk);
    pending.length = 0;
  });
  tcp.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
  });
  tcp.on('close', () => ws.close());
  tcp.on('error', () => ws.close(1011, 'upstream error'));
  ws.on('message', (data) => {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (tcp.connecting) pending.push(chunk);
    else tcp.write(chunk);
  });
  ws.on('close', () => tcp.destroy());
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`PSOBB.web on :${PORT} (client ${DIST}, newserv system ${SYSTEM}, data ${DATA ?? 'none'}, relay to ${TARGET_HOST})`);
});

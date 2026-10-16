// WebSocket <-> TCP relay between the browser client and newserv.
//
// Browsers cannot open raw TCP sockets, and PSO BB speaks raw TCP. Each
// WebSocket connection is piped byte-for-byte to one TCP connection on the
// newserv host. Encryption stays end-to-end between browser and newserv; the
// bridge never parses or rewrites packets.
//
// The client chooses the port with ?port=N (BB redirects between ports with
// command 0x19), so only ports in ALLOWED_PORTS are accepted. Without that
// allowlist this would be an open TCP proxy.
//
// Env: BRIDGE_PORT (default 8080), TARGET_HOST (default 127.0.0.1),
//      ALLOWED_PORTS (default "12000,12001,12002,12003,12004,12005,12006,12007,12008").

import net from 'node:net';
import { WebSocketServer } from 'ws';

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 8080);
const TARGET_HOST = process.env.TARGET_HOST ?? '127.0.0.1';
const ALLOWED_PORTS = new Set(
  (process.env.ALLOWED_PORTS ?? '12000,12001,12002,12003,12004,12005,12006,12007,12008')
    .split(',')
    .map((p) => Number(p.trim())),
);

const wss = new WebSocketServer({ host: '127.0.0.1', port: BRIDGE_PORT });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://bridge');
  const port = Number(url.searchParams.get('port'));
  if (!ALLOWED_PORTS.has(port)) {
    ws.close(1008, `port ${port} not allowed`);
    return;
  }

  const tag = `[${req.socket.remotePort} -> ${TARGET_HOST}:${port}]`;
  const tcp = net.connect({ host: TARGET_HOST, port });
  tcp.setNoDelay(true);
  const pending = [];
  console.log(`${tag} open`);

  tcp.on('connect', () => {
    for (const chunk of pending) tcp.write(chunk);
    pending.length = 0;
  });
  tcp.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
  });
  tcp.on('close', () => ws.close());
  tcp.on('error', (err) => {
    console.log(`${tag} tcp error: ${err.message}`);
    ws.close(1011, 'upstream error');
  });

  ws.on('message', (data) => {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (tcp.connecting) pending.push(chunk);
    else tcp.write(chunk);
  });
  ws.on('close', () => {
    console.log(`${tag} closed`);
    tcp.destroy();
  });
});

console.log(`bridge listening on ws://127.0.0.1:${BRIDGE_PORT}, target ${TARGET_HOST} ports [${[...ALLOWED_PORTS].join(', ')}]`);

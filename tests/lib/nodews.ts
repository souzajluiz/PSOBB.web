// WebSocket transport for Node tests (mirrors client/src/net/wstransport.ts).
import { WebSocket } from '../../bridge/node_modules/ws/wrapper.mjs';
import type { Transport } from '../../client/src/net/bbconnection.ts';

export function nodeBridge(port: number, base = 'ws://127.0.0.1:8080'): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/?port=${port}`);
    ws.binaryType = 'nodebuffer';
    const early: Uint8Array[] = [];
    let handler: ((d: Uint8Array) => void) | null = null;
    const t: Transport = {
      send: (d) => ws.send(d),
      close: () => ws.close(),
      get onData() {
        return handler ?? ((d: Uint8Array) => void early.push(d));
      },
      set onData(fn) {
        handler = fn;
        for (const d of early.splice(0)) fn(d);
      },
      onClose: () => {},
    };
    ws.on('message', (d: Buffer) => t.onData(new Uint8Array(d)));
    ws.on('close', () => t.onClose());
    ws.on('open', () => resolve(t));
    ws.on('error', reject);
  });
}

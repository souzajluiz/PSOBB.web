// Browser WebSocket transport to the bridge (bridge/bridge.mjs).

import type { Transport } from './bbconnection.ts';
import { SERVER_ORIGIN } from './server.ts';

// ?bridge= overrides it. The dev server runs bridge.mjs on its own port; a
// build is served by bridge/server.mjs, which relays at /bridge on its own
// origin (the Docker image, docs/DEPLOY.md). The native app has no origin of
// its own: it relays through VITE_SERVER_ORIGIN.
export function bridgeUrl(): string {
  const given = new URLSearchParams(location.search).get('bridge');
  if (given) return given;
  if (import.meta.env?.DEV) return 'ws://127.0.0.1:8080';
  if (SERVER_ORIGIN) return `${SERVER_ORIGIN.replace(/^http/, 'ws')}/bridge`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bridge`;
}

export function connectBridge(port: number, base = bridgeUrl()): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/?port=${port}`);
    ws.binaryType = 'arraybuffer';
    // Data can arrive before BBConnection installs its handler; queue it until then.
    const early: Uint8Array[] = [];
    let handler: ((d: Uint8Array) => void) | null = null;
    const t: Transport = {
      // A send on a closing / closed socket is dropped (the lobby ping, every 900 frames, kept
      // throwing "WebSocket is already in CLOSING or CLOSED state"); onClose has already told the owner.
      send: (d) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(d);
      },
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
    ws.onmessage = (e) => t.onData(new Uint8Array(e.data as ArrayBuffer));
    ws.onclose = () => t.onClose();
    ws.onopen = () => resolve(t);
    ws.onerror = () => reject(new Error(`cannot reach bridge at ${base} (port ${port})`));
  });
}

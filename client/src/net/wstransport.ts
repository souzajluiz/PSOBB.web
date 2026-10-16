// Browser WebSocket transport to the bridge (bridge/bridge.mjs).

import type { Transport } from './bbconnection.ts';

export function bridgeUrl(): string {
  return new URLSearchParams(location.search).get('bridge') ?? 'ws://127.0.0.1:8080';
}

export function connectBridge(port: number, base = bridgeUrl()): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/?port=${port}`);
    ws.binaryType = 'arraybuffer';
    // Data can arrive before BBConnection installs its handler; queue it until then.
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
    ws.onmessage = (e) => t.onData(new Uint8Array(e.data as ArrayBuffer));
    ws.onclose = () => t.onClose();
    ws.onopen = () => resolve(t);
    ws.onerror = () => reject(new Error(`cannot reach bridge at ${base} (port ${port})`));
  });
}

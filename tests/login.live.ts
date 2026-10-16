// Live login against a running newserv, through the WebSocket bridge.
// Requires: newserv on 127.0.0.1:12000 and `npm start` in web/bridge.
// Run: node web/tests/login.live.ts [username] [password]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WebSocket } from '../bridge/node_modules/ws/wrapper.mjs';
import { BBConnection, type Transport } from '../client/src/net/bbconnection.ts';

const ROOT = resolve(import.meta.dirname, '..');
const nsk = new Uint8Array(readFileSync(join(ROOT, 'vendor/newserv/system/blueburst/keys/default.nsk')));
const [username = 'webtest', password = 'webtest'] = process.argv.slice(2);

function wsTransport(url: string): Promise<Transport> {
  return new Promise((resolveT, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'nodebuffer';
    // Data can arrive before BBConnection installs its handler; queue it until then.
    const early: Uint8Array[] = [];
    let handler: ((d: Uint8Array) => void) | null = null;
    const t: Transport = {
      send: (d) => ws.send(d),
      close: () => ws.close(),
      get onData() {
        return handler ?? ((d: Uint8Array) => early.push(d));
      },
      set onData(fn) {
        handler = fn;
        for (const d of early.splice(0)) fn(d);
      },
      onClose: () => {},
    };
    ws.on('message', (d: Buffer) => {
      try {
        t.onData(new Uint8Array(d));
      } catch (e) {
        console.error('receive failed:', e);
        process.exit(1);
      }
    });
    ws.on('close', () => t.onClose());
    ws.on('open', () => resolveT(t));
    ws.on('error', reject);
  });
}

const conn = new BBConnection(await wsTransport('ws://127.0.0.1:8080/?port=12000'), nsk);
conn.onCommand = (c) => console.log(`<- ${c.command.toString(16).padStart(2, '0')} flag=${c.flag} size=${c.data.length}`);

const init = await conn.waitFor(0x03, 0x9b);
console.log(`server init ok (${new TextDecoder().decode(init.data.subarray(0, 0x40)).replace(/\0.*/, '')})`);
conn.sendLogin({ username, password });
const result = await conn.waitFor(0xe6, 0x1a, 0xd5);
if (result.command !== 0xe6) {
  console.log('FAIL login rejected');
  process.exit(1);
}
const dv = new DataView(result.data.buffer, result.data.byteOffset);
console.log(`PASS login: error_code=${dv.getUint32(0, true)} guild_card=${dv.getUint32(8, true)} security_token=${dv.getUint32(12, true).toString(16)}`);
conn.close();
process.exit(dv.getUint32(0, true) === 0 ? 0 : 1);

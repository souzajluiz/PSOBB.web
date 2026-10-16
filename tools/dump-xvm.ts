// Dumps every texture of .xvm / PRS-compressed .prs texture archives to PNG files.
// Output stays local: never commit the PNGs (SEGA assets).
// Run: node web/tools/dump-xvm.ts <out-dir> <file relative to data/> [...]
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { parseXvm } from '../client/src/formats/xvm.ts';
const OUT = process.argv[2]; const DATA = (process.env.PSOBB_DATA ?? process.env.HOME + '/Downloads/psobb-client/data') + '/';
function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const f of process.argv.slice(3)) {
  let d = new Uint8Array(readFileSync(DATA + f));
  if (f.endsWith('.prs')) d = prsDecompress(d);
  const tex = parseXvm(d);
  tex.forEach((t) => writeFileSync(`${OUT}/${f.replace(/\W/g, '_')}_${t.index}_${t.width}x${t.height}_f${t.format}.png`, png(t.width, t.height, t.rgba)));
  console.log(f, tex.length, tex.map((t) => `${t.width}x${t.height}/${t.format}`).join(' '));
}

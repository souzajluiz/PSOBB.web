// Pixel difference of two PNG directories (tools/perfprobe.mjs --out): per image the average
// absolute channel difference (0..255), the share of pixels that differ by more than 8 in some
// channel, and the largest difference. Writes <name>.diff.png (x8 amplified) next to B when --diff is set.
//   node tools/imgdiff.mjs before/ after/ [--diff]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

function decode(buf) {
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('8-bit non-interlaced only'); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x], a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let r = v;
      if (f === 1) r = v + a; else if (f === 2) r = v + b; else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[x] = r & 255;
    }
    for (let x = 0; x < w; x++) { out[(y * w + x) * 4] = cur[x * bpp]; out[(y * w + x) * 4 + 1] = cur[x * bpp + 1]; out[(y * w + x) * 4 + 2] = cur[x * bpp + 2]; out[(y * w + x) * 4 + 3] = bpp === 4 ? cur[x * bpp + 3] : 255; }
    cur.copy(prev);
  }
  return { w, h, data: out };
}
function crc(buf) { let c, crcv = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crcv ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcv = (crcv >>> 8) ^ c; } return (crcv ^ 0xffffffff) >>> 0; }
function encode(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'ascii'); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const [a, b] = process.argv.slice(2);
for (const f of readdirSync(a).filter((n) => n.endsWith('.png') && !n.includes('.diff'))) {
  const A = decode(readFileSync(join(a, f))), B = decode(readFileSync(join(b, f)));
  if (A.w !== B.w || A.h !== B.h) { console.log(f, 'size differs'); continue; }
  let sum = 0, bad = 0, max = 0; const d = Buffer.alloc(A.w * A.h * 4);
  for (let i = 0; i < A.w * A.h; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) { const v = Math.abs(A.data[i * 4 + c] - B.data[i * 4 + c]); sum += v; m = Math.max(m, v); d[i * 4 + c] = Math.min(255, v * 8); }
    d[i * 4 + 3] = 255; if (m > 8) bad++; max = Math.max(max, m);
  }
  console.log(`${f}: mean abs diff ${(sum / (A.w * A.h * 3)).toFixed(4)}, pixels >8: ${((100 * bad) / (A.w * A.h)).toFixed(3)}%, max ${max}`);
  if (process.argv.includes('--diff')) writeFileSync(join(b, f.replace('.png', '.diff.png')), encode(A.w, A.h, d));
}

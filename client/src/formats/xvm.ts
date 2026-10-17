// XVM texture archives (Xbox Ninja textures, used by PSOBB on PC).
// Layout surveyed across every data/scene/*.xvm of the Ephinea client.
//
// XVMH: char magic[4], u32 header_size (chunk data size), u32 count, ...
// XVRT chunk: char magic[4], u32 size (bytes after this field),
//   +0x08 u32 flags (bit 0 = mipmaps, bit 1 = alpha), +0x0C u32 format,
//   +0x10 u32 global index, +0x14 u16 width, +0x16 u16 height,
//   +0x18 u32 data size, pixel data at +0x40 (top mip first).
// Formats: 2 = R5G6B5, 3 = A1R5G5B5 (or A4R4G4B4 without the alpha flag?),
//   6 = DXT1, 7 = DXT3. Uncompressed formats are Xbox-swizzled.

export interface XvrTexture {
  index: number;
  width: number;
  height: number;
  format: number;
  flags: number;
  rgba: Uint8Array; // decoded top mip level, width*height*4
}

export function parseXvm(data: Uint8Array): XvrTexture[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (o: number) => String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3]);
  if (tag(0) !== 'XVMH') throw new Error('not an XVM file');
  const out: XvrTexture[] = [];
  let o = dv.getUint32(4, true) + 8;
  while (o + 0x40 <= data.length && tag(o) === 'XVRT') {
    out.push(readXvrt(data, dv, o, out.length));
    o += 8 + dv.getUint32(o + 4, true);
  }
  return out;
}

// A lone XVRT chunk, as stored one per entry in the player texture archives
// (pl?tex.afs).
export function parseXvr(data: Uint8Array, index = 0): XvrTexture {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 0x40 || String.fromCharCode(data[0], data[1], data[2], data[3]) !== 'XVRT') {
    throw new Error('not an XVR texture');
  }
  return readXvrt(data, dv, 0, index);
}

function readXvrt(data: Uint8Array, dv: DataView, o: number, index: number): XvrTexture {
  const size = dv.getUint32(o + 4, true);
  const flags = dv.getUint32(o + 8, true);
  const format = dv.getUint32(o + 0x0c, true);
  const width = dv.getUint16(o + 0x14, true);
  const height = dv.getUint16(o + 0x16, true);
  const pixels = data.subarray(o + 0x40, o + 8 + size);
  return { index, width, height, format, flags, rgba: decodeXvr(pixels, width, height, format, flags) };
}

function decodeXvr(src: Uint8Array, w: number, h: number, format: number, flags: number): Uint8Array {
  switch (format) {
    case 6: return decodeDxt(src, w, h, false);
    case 7: return decodeDxt(src, w, h, true);
    case 2: return decode16(src, w, h, (v, out, i) => rgb565(v, out, i));
    case 3: return decode16(src, w, h, flags & 2 ? argb1555 : argb4444);
    default: return checker(w, h);
  }
}

function rgb565(v: number, out: Uint8Array, i: number): void {
  out[i] = ((v >> 11) & 0x1f) * 255 / 31;
  out[i + 1] = ((v >> 5) & 0x3f) * 255 / 63;
  out[i + 2] = (v & 0x1f) * 255 / 31;
  out[i + 3] = 255;
}

function argb1555(v: number, out: Uint8Array, i: number): void {
  out[i] = ((v >> 10) & 0x1f) * 255 / 31;
  out[i + 1] = ((v >> 5) & 0x1f) * 255 / 31;
  out[i + 2] = (v & 0x1f) * 255 / 31;
  out[i + 3] = v & 0x8000 ? 255 : 0;
}

function argb4444(v: number, out: Uint8Array, i: number): void {
  out[i] = ((v >> 8) & 0xf) * 17;
  out[i + 1] = ((v >> 4) & 0xf) * 17;
  out[i + 2] = (v & 0xf) * 17;
  out[i + 3] = ((v >> 12) & 0xf) * 17;
}

// Xbox swizzle: texel (x, y) lives at the Morton-interleaved index of x and y.
function swizzledIndex(x: number, y: number, w: number, h: number): number {
  let index = 0;
  let bit = 1;
  for (let mask = 1; mask < w || mask < h; mask <<= 1) {
    if (mask < w) {
      index |= ((x & mask) ? bit : 0);
      bit <<= 1;
    }
    if (mask < h) {
      index |= ((y & mask) ? bit : 0);
      bit <<= 1;
    }
  }
  return index;
}

function decode16(src: Uint8Array, w: number, h: number, px: (v: number, out: Uint8Array, i: number) => void): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = swizzledIndex(x, y, w, h) * 2;
      if (s + 1 >= src.length) continue;
      px(src[s] | (src[s + 1] << 8), out, (y * w + x) * 4);
    }
  }
  return out;
}

function decodeDxt(src: Uint8Array, w: number, h: number, dxt3: boolean): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const blockSize = dxt3 ? 16 : 8;
  const bw = Math.max(1, (w + 3) >> 2);
  const bh = Math.max(1, (h + 3) >> 2);
  const pal = new Uint8Array(16);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let o = (by * bw + bx) * blockSize;
      if (o + blockSize > src.length) return out;
      const alphaOff = o;
      if (dxt3) o += 8;
      const c0 = src[o] | (src[o + 1] << 8);
      const c1 = src[o + 2] | (src[o + 3] << 8);
      rgb565(c0, pal, 0);
      rgb565(c1, pal, 4);
      if (c0 > c1 || dxt3) {
        for (let k = 0; k < 3; k++) {
          pal[8 + k] = (2 * pal[k] + pal[4 + k]) / 3;
          pal[12 + k] = (pal[k] + 2 * pal[4 + k]) / 3;
        }
        pal[11] = pal[15] = 255;
      } else {
        for (let k = 0; k < 3; k++) {
          pal[8 + k] = (pal[k] + pal[4 + k]) / 2;
          pal[12 + k] = 0;
        }
        pal[11] = 255;
        pal[15] = 0; // transparent black
      }
      const bits = src[o + 4] | (src[o + 5] << 8) | (src[o + 6] << 16) | (src[o + 7] << 24);
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= w || y >= h) continue;
          const t = py * 4 + px;
          const c = ((bits >>> (t * 2)) & 3) * 4;
          const i = (y * w + x) * 4;
          out[i] = pal[c];
          out[i + 1] = pal[c + 1];
          out[i + 2] = pal[c + 2];
          if (dxt3) {
            const a = (src[alphaOff + (t >> 1)] >> ((t & 1) * 4)) & 0xf;
            out[i + 3] = a * 17;
          } else {
            out[i + 3] = pal[c + 3];
          }
        }
      }
    }
  }
  return out;
}

function checker(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = ((x >> 3) ^ (y >> 3)) & 1;
      out.set(on ? [255, 0, 255, 255] : [32, 32, 32, 255], (y * w + x) * 4);
    }
  }
  return out;
}

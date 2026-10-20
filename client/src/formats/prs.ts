// PRS (LZ77 variant used across PSO) decompressor.
// Ported from newserv src/Compression.cc (prs_decompress_with_meta), MIT license.

// maxSize (optional) bounds the output: a PRS stream can expand about 100x, so
// code that reads untrusted input (the admin panel's quest upload) passes one.
export function prsDecompress(src: Uint8Array, maxSize = Infinity): Uint8Array {
  let out = new Uint8Array(Math.max(src.length * 8, 0x1000));
  let outPos = 0;
  let pos = 0;
  let bits = 0;

  const byte = (): number => {
    if (pos >= src.length) throw new Error('PRS: unexpected end of input');
    return src[pos++];
  };
  const ctrl = (): number => {
    if (!(bits & 0x100)) bits = 0xff00 | byte();
    const ret = bits & 1;
    bits >>= 1;
    return ret;
  };
  const put = (v: number): void => {
    if (outPos >= maxSize) throw new Error('PRS: output too large');
    if (outPos === out.length) {
      const grown = new Uint8Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[outPos++] = v;
  };

  while (pos < src.length) {
    if (ctrl()) {
      put(byte());
      continue;
    }
    let offset: number;
    let count: number;
    if (ctrl()) {
      const a = byte() | (byte() << 8);
      offset = (a >> 3) | ~0x1fff;
      if (offset === ~0x1fff) break;
      count = a & 7 ? (a & 7) + 2 : byte() + 1;
    } else {
      count = ctrl() << 1;
      count = (count | ctrl()) + 2;
      offset = byte() | ~0xff;
    }
    const readOffset = outPos + offset;
    if (readOffset < 0) throw new Error('PRS: backreference before start of output');
    for (let z = 0; z < count; z++) put(out[readOffset + z]);
  }
  return out.slice(0, outPos);
}

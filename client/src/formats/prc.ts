// PRC: PRS data encrypted with the PSO V2 stream cipher, used for the entries
// of RelChunk (.rlc) archives such as plymotiondata.rlc.
// Ported from newserv src/PSOEncryption.cc (PSOV2Encryption, decrypt_pr2_data), MIT license.
//
// Layout (little-endian on PC): u32 decompressed_size, u32 seed, then the PRS
// stream XORed with the V2 key stream (one u32 key per 4 bytes, the last
// partial word XORed with the low bytes of one more key).

import { prsDecompress } from './prs.ts';

const STREAM_LENGTH = 0x38;

export class PsoV2Cipher {
  private stream = new Uint32Array(STREAM_LENGTH + 1);
  private offset = STREAM_LENGTH;

  constructor(seed: number) {
    const s = this.stream;
    let a = 1;
    let b = seed >>> 0;
    s[0x37] = b;
    for (let vi = 0x15; vi <= 0x36 * 0x15; vi += 0x15) {
      s[vi % 0x37] = a;
      const c = (b - a) >>> 0;
      b = a;
      a = c;
    }
    for (let i = 0; i < 5; i++) this.update();
  }

  private update(): void {
    const s = this.stream;
    for (let z = 1; z < 0x19; z++) s[z] = s[z] - s[z + 0x1f];
    for (let z = 0x19; z < 0x38; z++) s[z] = s[z] - s[z - 0x18];
    this.offset = 1;
  }

  next(): number {
    if (this.offset === STREAM_LENGTH) this.update();
    return this.stream[this.offset++];
  }

  // XORs `data` in place (little-endian words).
  apply(data: Uint8Array): void {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const words = data.length >> 2;
    for (let i = 0; i < words; i++) dv.setUint32(i * 4, dv.getUint32(i * 4, true) ^ this.next(), true);
    const rest = data.length & 3;
    if (rest) {
      const k = this.next();
      for (let j = 0; j < rest; j++) data[words * 4 + j] ^= (k >>> (8 * j)) & 0xff;
    }
  }
}

export function prcDecompress(src: Uint8Array): Uint8Array {
  if (src.length < 8) throw new Error('PRC: not enough data for the header');
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const size = dv.getUint32(0, true);
  const body = src.slice(8);
  new PsoV2Cipher(dv.getUint32(4, true)).apply(body);
  const out = prsDecompress(body);
  if (out.length !== size) throw new Error(`PRC: decompressed ${out.length} bytes, header says ${size}`);
  return out;
}

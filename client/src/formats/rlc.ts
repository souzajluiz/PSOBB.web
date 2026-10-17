// RelChunk archive (.rlc), e.g. plymotiondata.rlc (in data.gsl).
//
// Header (big-endian, unlike the entries):
//   0x00 char magic[0x10] = "RelChunkVer0.20\0"
//   0x10 u32 count, u32 table_offset (0x20), u32 data_offset, u32 0
//   table: count x { u32 offset, u32 size }, each entry 0x20-aligned.
// Each entry is a PRC blob (formats/prc.ts) that decompresses to a REL file.

import { prcDecompress } from './prc.ts';

const MAGIC = 'RelChunkVer0.20';

export class RlcArchive {
  readonly data: Uint8Array;
  readonly entries: Array<{ offset: number; size: number }> = [];
  private cache = new Map<number, Uint8Array>();

  constructor(data: Uint8Array) {
    this.data = data;
    let magic = '';
    for (let i = 0; i < MAGIC.length; i++) magic += String.fromCharCode(data[i]);
    if (magic !== MAGIC) throw new Error(`not a RelChunk archive (magic "${magic}")`);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const count = dv.getUint32(0x10, false);
    const table = dv.getUint32(0x14, false);
    for (let i = 0; i < count; i++) {
      const offset = dv.getUint32(table + i * 8, false);
      const size = dv.getUint32(table + i * 8 + 4, false);
      if (offset + size > data.length) throw new Error(`RLC entry ${i} out of range`);
      this.entries.push({ offset, size });
    }
  }

  get count(): number {
    return this.entries.length;
  }

  // Decompressed entry (a REL file).
  get(index: number): Uint8Array {
    let d = this.cache.get(index);
    if (!d) {
      const e = this.entries[index];
      if (!e) throw new Error(`RLC entry ${index} out of range (${this.entries.length})`);
      d = prcDecompress(this.data.subarray(e.offset, e.offset + e.size));
      this.cache.set(index, d);
    }
    return d;
  }
}

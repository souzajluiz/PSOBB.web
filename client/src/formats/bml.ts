// BML archives (PSO model/motion bundles, e.g. plAnj.bml, bm_ene_*.bml).
// Layout from newserv src/BMLArchive.cc (MIT license), checked against the
// Ephinea client's .bml files.
//
// Header (0x40): u32 unknown, u32 num_entries, u32 unknown (0x150 in every
//   PC file seen), u8 unknown[0x34].
// Entries (0x40 each, right after the header):
//   +0x00 char filename[0x20]
//   +0x20 u32 compressed_size
//   +0x24 u32 unknown
//   +0x28 u32 decompressed_size
//   +0x2C u32 compressed_texture_size   (PRS-compressed XVM; 0 if none)
//   +0x30 u32 decompressed_texture_size
//   +0x34 u8  unknown[0x0C]
// Data starts at the next 0x800 boundary after the table. Each file is
// PRS-compressed and followed by its optional texture archive. Blob alignment
// differs between files: the player archives (pl?nj.bml) pad every blob to
// 0x800, while e.g. bm_ene_*.bml use 0x20 (the value newserv uses).

import { prsDecompress } from './prs.ts';

export interface BmlEntry {
  name: string;
  offset: number;
  size: number;
  decompressedSize: number;
  textureOffset: number;
  textureSize: number;
  decompressedTextureSize: number;
}

export class BmlArchive {
  readonly entries: BmlEntry[] = [];
  private byName = new Map<string, BmlEntry>();
  private data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const count = dv.getUint32(4, true);
    if (count > 0x1000 || 0x40 + count * 0x40 > data.length) throw new Error(`bad BML entry count ${count}`);
    const dec = new TextDecoder('ascii');
    const records: Omit<BmlEntry, 'offset' | 'textureOffset'>[] = [];
    for (let i = 0; i < count; i++) {
      const e = 0x40 + i * 0x40;
      const raw = data.subarray(e, e + 0x20);
      const end = raw.indexOf(0);
      records.push({
        name: dec.decode(raw.subarray(0, end < 0 ? 0x20 : end)),
        size: dv.getUint32(e + 0x20, true),
        decompressedSize: dv.getUint32(e + 0x28, true),
        textureSize: dv.getUint32(e + 0x2c, true),
        decompressedTextureSize: dv.getUint32(e + 0x30, true),
      });
    }
    // The alignment is not stored anywhere we know of: use 0x800 when the
    // whole archive fits with it, else 0x20.
    const layout = (align: number): BmlEntry[] | null => {
      const out: BmlEntry[] = [];
      const up = (v: number) => (v + align - 1) & ~(align - 1);
      let offset = (0x40 + count * 0x40 + 0x7ff) & ~0x7ff;
      for (const r of records) {
        if (offset + r.size > data.length) return null;
        const textureOffset = up(offset + r.size);
        if (r.textureSize && textureOffset + r.textureSize > data.length) return null;
        out.push({ ...r, offset, textureOffset });
        offset = up(textureOffset + r.textureSize);
      }
      return out;
    };
    const entries = layout(0x800) ?? layout(0x20);
    if (!entries) throw new Error('BML entries extend beyond end of data');
    for (const entry of entries) {
      this.entries.push(entry);
      this.byName.set(entry.name.toLowerCase(), entry);
    }
  }

  has(name: string): boolean {
    return this.byName.has(name.toLowerCase());
  }

  // Decompressed file contents.
  get(name: string): Uint8Array {
    const e = this.byName.get(name.toLowerCase());
    if (!e) throw new Error(`BML does not contain file: ${name}`);
    return prsDecompress(this.data.subarray(e.offset, e.offset + e.size));
  }

  // Decompressed texture archive (XVM) attached to a file, or null.
  getTextures(name: string): Uint8Array | null {
    const e = this.byName.get(name.toLowerCase());
    if (!e) throw new Error(`BML does not contain file: ${name}`);
    if (!e.textureSize) return null;
    return prsDecompress(this.data.subarray(e.textureOffset, e.textureOffset + e.textureSize));
  }
}

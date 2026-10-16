// GSL and AFS archive readers.
// Layouts from newserv src/GSLArchive.cc and src/AFSArchive.cc, MIT license.

export interface ArchiveEntry {
  offset: number;
  size: number;
}

// GSL: table of 0x30-byte entries {char name[0x20]; u32 page; u32 size; u64 unused},
// terminated by an empty name. Data offsets are in 0x800-byte pages.
export class GSLArchive {
  readonly entries = new Map<string, ArchiveEntry>();
  private data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const dec = new TextDecoder('ascii');
    let minDataOffset = Infinity;
    for (let pos = 0; pos + 0x30 <= data.length && pos < minDataOffset; pos += 0x30) {
      const nameBytes = data.subarray(pos, pos + 0x20);
      const end = nameBytes.indexOf(0);
      const name = dec.decode(nameBytes.subarray(0, end < 0 ? 0x20 : end));
      if (!name) break;
      const offset = dv.getUint32(pos + 0x20, true) * 0x800;
      const size = dv.getUint32(pos + 0x24, true);
      if (offset + size > data.length) throw new Error(`GSL entry ${name} extends beyond end of data`);
      this.entries.set(name, { offset, size });
      minDataOffset = Math.min(minDataOffset, offset);
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  get(name: string): Uint8Array {
    const e = this.entries.get(name);
    if (!e) throw new Error(`GSL does not contain file: ${name}`);
    return this.data.subarray(e.offset, e.offset + e.size);
  }
}

// AFS: 'AFS\0', u32 count, then {u32 offset; u32 size} per file.
export class AFSArchive {
  readonly entries: ArchiveEntry[] = [];
  private data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (dv.getUint32(0, false) !== 0x41465300) throw new Error('file is not an AFS archive');
    const count = dv.getUint32(4, true);
    for (let i = 0; i < count; i++) {
      this.entries.push({ offset: dv.getUint32(8 + i * 8, true), size: dv.getUint32(12 + i * 8, true) });
    }
  }

  get(index: number): Uint8Array {
    const e = this.entries[index];
    if (!e || e.offset + e.size > this.data.length) throw new Error(`bad AFS entry ${index}`);
    return this.data.subarray(e.offset, e.offset + e.size);
  }
}

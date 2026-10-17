// REL container used by PSO for maps, models and tables.
// Footer layout from newserv src/CommonFileFormats.hh (RELFileFooterT), MIT license.
//
// The last 0x20 bytes are a footer: u32 relocations_offset, u32 num_relocations,
// u32 unused[2], u32 root_offset, u32 unused[3]. Pointers inside the file are
// offsets from the start of the file (the game adds the load address), so they
// can be followed directly without applying relocations.

export class RelFile {
  readonly data: Uint8Array;
  readonly dv: DataView;
  readonly root: number;

  // `root` given: no footer is read (e.g. the body of an NJCM / NMDM chunk,
  // whose pointers are offsets from the start of the chunk body).
  constructor(data: Uint8Array, root?: number) {
    this.data = data;
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (root !== undefined) {
      this.root = root;
      return;
    }
    if (data.length < 0x20) throw new Error('REL file too small');
    this.root = this.u32(data.length - 0x10);
    if (this.root >= data.length) throw new Error(`REL root offset ${this.root} out of range`);
  }

  // Body of the first IFF chunk with this tag in a Ninja file (.nj/.xj/.njm), or null.
  static chunk(data: Uint8Array, tag: string): RelFile | null {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let o = 0; o + 8 <= data.length; ) {
      const t = String.fromCharCode(data[o], data[o + 1], data[o + 2], data[o + 3]);
      const size = dv.getUint32(o + 4, true);
      if (o + 8 + size > data.length) throw new Error(`Ninja chunk ${t} extends beyond end of file`);
      if (t === tag) return new RelFile(data.subarray(o + 8, o + 8 + size), 0);
      o += 8 + size;
    }
    return null;
  }

  u8(o: number): number {
    return this.data[o];
  }
  u16(o: number): number {
    return this.dv.getUint16(o, true);
  }
  u32(o: number): number {
    return this.dv.getUint32(o, true);
  }
  i32(o: number): number {
    return this.dv.getInt32(o, true);
  }
  f32(o: number): number {
    return this.dv.getFloat32(o, true);
  }

  cstring(o: number, max = 0x40): string {
    let s = '';
    for (let i = 0; i < max && this.data[o + i]; i++) s += String.fromCharCode(this.data[o + i]);
    return s;
  }

  // Validates a pointer read from the file; 0 means null.
  ptr(o: number): number {
    const p = this.u32(o);
    if (p !== 0 && p >= this.data.length) throw new Error(`REL pointer 0x${p.toString(16)} at 0x${o.toString(16)} out of range`);
    return p;
  }
}

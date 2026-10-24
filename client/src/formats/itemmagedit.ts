// ItemMagEdit.prs: the MAG model tables (the parts of each MAG type and the colours).
//
// PsoBB.exe reads the file as a REL root (ptr_item_mag_edit_obj, the TParamFile of
// the ItemMagEdit load at dump 432860..433030). The root is at footer - 0x10; the
// root's first word points at the per-type part table (maybe_item_mag_edit_data):
// 12 bytes per MAG type, two 6-byte parts; a part's first byte is its motion record
// (itemmagmotion.dat, formats/itemmagmotion.ts), 0xff for no part (InitializeMagModel_005d8351
// tests it, dump 430170). The root's +0x10 points at the colour table: 18 colours of
// 16 bytes, (a, r, g, b) as floats (copied to the model's colour at +0xcc..+0xd8).
// The root's +0x14 is the evolution table (net/magfeed.ts parseMagEvolution).
//
// The part table is 0x360 bytes after its start at 0x3a0 and ends at the file's end, so a
// type past the table has no part (ASSUMED: the exe would read past the table there).

import { prsDecompress } from './prs.ts';

export const MAG_PART_NONE = 0xff;
export const MAG_PARTS_PER_TYPE = 2;
export const MAG_PART_ROW = 12;
export const MAG_COLOURS = 18; // the exe clamps the colour index to 0x11 (mag_set_color)

export interface MagPart {
  record: number; // motion record index (itemmagmotion.dat)
}

export interface MagEdit {
  types: number; // MAG types the part table covers
  // parts[type][k]: the part k of a type, or null for none.
  parts(type: number): (MagPart | null)[];
  // The colour (a, r, g, b) of a colour index (0..17), or null past the table.
  colour(index: number): [number, number, number, number] | null;
}

export function parseMagEdit(file: Uint8Array, compressed = true): MagEdit {
  const d = compressed ? prsDecompress(file) : file;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const root = dv.getUint32(d.length - 0x10, true);
  const partTable = dv.getUint32(root, true);
  const colourTable = dv.getUint32(root + 0x10, true);
  const types = Math.max(0, Math.floor((d.length - partTable) / MAG_PART_ROW));
  return {
    types,
    parts(type: number) {
      const out: (MagPart | null)[] = [];
      for (let k = 0; k < MAG_PARTS_PER_TYPE; k++) {
        const at = partTable + type * MAG_PART_ROW + k * 6;
        const record = type >= 0 && type < types && at < d.length ? d[at] : MAG_PART_NONE;
        out.push(record === MAG_PART_NONE ? null : { record });
      }
      return out;
    },
    colour(index: number) {
      if (index < 0 || index >= MAG_COLOURS) return null;
      const at = colourTable + index * 16;
      if (at + 16 > d.length) return null;
      return [dv.getFloat32(at, true), dv.getFloat32(at + 4, true), dv.getFloat32(at + 8, true), dv.getFloat32(at + 12, true)];
    },
  };
}

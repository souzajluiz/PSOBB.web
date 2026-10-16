// Map render geometry (map_*n.rel), format "fmt2".
// Header layout from the original-psobb-client-source decomp (headers/assets.h,
// map loader step 5-8), field meanings checked against map_city00_00n.rel.
//
// Root: char magic[4] ("fmt2"), u32, u16 section_count @+8, ..., u32 sections @+0x10,
//   u32 texture_list (NJTL) @+0x14
// Section (0x34): i32 id, f32 pos[3], i32 rot[3] (BAMS), f32 radius,
//   u32 static_entries, u32 animated_entries, u32 static_count, u32 animated_count, u32 flags
// Static entry (0x10): u32 object, u32, u32, u32 flags
// Animated entry (0x20): u32 object, ... (motion data; rendered in bind pose for now)
// NJTL: u32 entries, u32 count; entry (0xC): u32 name, u32 attr, u32 texaddr

import { RelFile } from './rel.ts';
import { parseNjObject, type NjObject } from './xj.ts';

export interface MapSection {
  id: number;
  position: [number, number, number];
  rotation: [number, number, number]; // radians
  radius: number;
  objects: NjObject[];
}

export interface MapGeometry {
  magic: string;
  sections: MapSection[];
  textureNames: string[];
  // Entries that could not be parsed as NJS_OBJECT trees. Some Episode 2 maps
  // (jungle, seabed) have entries with flags 0x10224 that point at a different
  // record type; their meaning is still unknown, so they are skipped.
  skippedEntries: Array<{ section: number; entry: number; flags: number; error: string }>;
}

const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

export function parseMapNRel(data: Uint8Array): MapGeometry {
  const rel = new RelFile(data);
  const r = rel.root;
  const magic = rel.cstring(r, 4);
  if (magic !== 'fmt2') throw new Error(`unsupported n.rel format "${magic}"`);
  const count = rel.u16(r + 8);
  const sectionsPtr = rel.ptr(r + 0x10);
  const texListPtr = rel.ptr(r + 0x14);

  const sections: MapSection[] = [];
  const skippedEntries: MapGeometry['skippedEntries'] = [];
  for (let i = 0; i < count; i++) {
    const s = sectionsPtr + i * 0x34;
    const objects: NjObject[] = [];
    const readEntries = (table: number, n: number, stride: number, flagsOffset: number) => {
      for (let k = 0; k < n; k++) {
        const e = table + k * stride;
        const obj = rel.ptr(e);
        if (!obj) continue;
        try {
          objects.push(parseNjObject(rel, obj));
        } catch (err) {
          skippedEntries.push({ section: i, entry: k, flags: rel.u32(e + flagsOffset), error: (err as Error).message });
        }
      }
    };
    readEntries(rel.ptr(s + 0x20), rel.u32(s + 0x28), 0x10, 0x0c);
    readEntries(rel.ptr(s + 0x24), rel.u32(s + 0x2c), 0x20, 0x1c);
    sections.push({
      id: rel.i32(s),
      position: [rel.f32(s + 4), rel.f32(s + 8), rel.f32(s + 0x0c)],
      rotation: [rel.i32(s + 0x10) * BAMS_TO_RAD, rel.i32(s + 0x14) * BAMS_TO_RAD, rel.i32(s + 0x18) * BAMS_TO_RAD],
      radius: rel.f32(s + 0x1c),
      objects,
    });
  }

  const textureNames: string[] = [];
  if (texListPtr) {
    const entries = rel.ptr(texListPtr);
    const n = rel.u32(texListPtr + 4);
    for (let i = 0; i < n; i++) {
      const name = rel.ptr(entries + i * 0xc);
      textureNames.push(name ? rel.cstring(name, 0x20) : '');
    }
  }
  return { magic, sections, textureNames, skippedEntries };
}

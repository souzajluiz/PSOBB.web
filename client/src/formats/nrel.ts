// Map render geometry (map_*n.rel), format "fmt2".
// Header layout from the original-psobb-client-source decomp (headers/assets.h,
// map loader step 5-8); entry flags from the client's map draw loop
// (map_nrel_process_chunk_static_meshes and its animated twin). Field meanings
// checked against every scene/map_*n.rel of the Ephinea client.
//
// Root: char magic[4] ("fmt2"), u32, u16 section_count @+8, ..., u32 sections @+0x10,
//   u32 texture_list (NJTL) @+0x14
// Section (0x34): i32 id, f32 pos[3], i32 rot[3] (BAMS), f32 radius,
//   u32 static_entries, u32 animated_entries, u32 static_count, u32 animated_count, u32 flags
// Static entry (0x10): u32 object, u32 effect (flag 0x20), u32 texture_anim (flag 0x40), u32 flags
// Animated entry (0x20): u32 object, u32 motion (NJS_MOTION), u32, f32 frame,
//   f32 frame_step, u32 effect (flag 0x20), u32 texture_anim (flag 0x40), u32 flags
// Indirect object (flag 0x200, 0x10): u32 object, u32 ind_tex (runtime), f32 (runtime),
//   i16 ind_id (row of map_*i.bin), u8, u8
// NJTL: u32 entries, u32 count; entry (0xC): u32 name, u32 attr, u32 texaddr

import { RelFile } from './rel.ts';
import { parseNjObject, type NjObject } from './xj.ts';
import { parseNjMotion, type NjMotion } from './njmotion.ts';

// Entry flags (static entry +0x0C, animated entry +0x1C).
export const ENTRY_NO_FOG = 0x1; // fog disabled while drawing
export const ENTRY_SHADOW = 0x10; // receives the projected player shadow
export const ENTRY_EFFECT = 0x20; // `effect` points at a 0x18-byte UV/effect slot
export const ENTRY_TEXTURE_ANIM = 0x40; // `texture_anim` points at a .tam-driven record
export const ENTRY_GC_EFFECT = 0x80; // indirect object drawn with a GameCube-only effect (plain on PC)
export const ENTRY_REFLECTION_ONLY = 0x100; // drawn only into the planar-reflection texture
export const ENTRY_INDIRECT = 0x200; // `object` points at an indirect-object record
export const ENTRY_GC_ONLY = 0x400; // indirect object the PC client never draws
export const ENTRY_VISIBLE = 0x10000; // runtime culling bit (set in the file for always-on entries)

export interface MapEffectSlot {
  id: number; // u16 @0
  texture: number; // u16 @2
  scroll: [number, number]; // f32 @4, @8 (accumulated)
  speed: [number, number]; // f32 @0xC, @0x10 (per frame)
}

export interface MapTextureAnim {
  animationId: number; // i16 @0, matches a .tam animation id
  textureIndex: number; // i16 @4, current frame's texture
  frameCounter: number; // i16 @6
  frameDelay: number; // i32 @8
}

export interface MapEntry {
  animated: boolean;
  index: number; // index in the section's static or animated table
  flags: number;
  object: NjObject;
  // False when the PC client never draws the entry in the normal camera pass
  // (ENTRY_REFLECTION_ONLY, ENTRY_INDIRECT + ENTRY_GC_ONLY, animated without motion).
  rendered: boolean;
  // ENTRY_INDIRECT: id looked up in map_*i.bin (indirect-texture distortion parameters).
  indirectId: number | null;
  effect: MapEffectSlot | null;
  textureAnim: MapTextureAnim | null;
  // Animated entries only.
  motion: NjMotion | null;
  frameStep: number; // frames advanced per tick (the client overwrites it per map at load)
}

export interface MapSection {
  id: number;
  position: [number, number, number];
  rotation: [number, number, number]; // radians; the client applies them with the ZXY order (Y, then X, then Z)
  radius: number;
  objects: NjObject[]; // the rendered entries' objects, in table order (static, then animated)
  entries: MapEntry[]; // every entry, rendered or not
}

export interface MapGeometry {
  magic: string;
  sections: MapSection[];
  textureNames: string[];
  // Entries whose object could not be parsed. Expected to stay empty.
  skippedEntries: Array<{ section: number; entry: number; flags: number; error: string }>;
}

const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

function countNodes(o: NjObject): number {
  return o.children.reduce((n, c) => n + countNodes(c), 1);
}

// Mirrors the client's draw-loop tests for the normal camera pass.
function isRendered(flags: number, animated: boolean, motion: number): boolean {
  if (flags & ENTRY_REFLECTION_ONLY) return false;
  if (animated && !motion) return false; // the animated loop requires a motion
  // Indirect objects: 0x80 -> drawn (its GameCube hook is a no-op on PC),
  // otherwise 0x400 -> only the GameCube hook runs, nothing is drawn.
  if (flags & ENTRY_INDIRECT && !(flags & ENTRY_GC_EFFECT) && flags & ENTRY_GC_ONLY) return false;
  return true;
}

function readEffect(rel: RelFile, p: number): MapEffectSlot {
  return {
    id: rel.u16(p),
    texture: rel.u16(p + 2),
    scroll: [rel.f32(p + 4), rel.f32(p + 8)],
    speed: [rel.f32(p + 0x0c), rel.f32(p + 0x10)],
  };
}

function readTextureAnim(rel: RelFile, p: number): MapTextureAnim {
  return {
    animationId: rel.dv.getInt16(p, true),
    textureIndex: rel.dv.getInt16(p + 4, true),
    frameCounter: rel.dv.getInt16(p + 6, true),
    frameDelay: rel.i32(p + 8),
  };
}

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
    const entries: MapEntry[] = [];
    const readEntries = (table: number, n: number, animated: boolean) => {
      const stride = animated ? 0x20 : 0x10;
      const extra = animated ? 0x14 : 0x04; // effect, texture_anim, flags follow
      for (let k = 0; k < n; k++) {
        const e = table + k * stride;
        const flags = rel.u32(e + extra + 8);
        let obj = rel.ptr(e);
        if (!obj) continue;
        try {
          let indirectId: number | null = null;
          if (flags & ENTRY_INDIRECT) {
            indirectId = rel.dv.getInt16(obj + 0x0c, true);
            obj = rel.ptr(obj);
          }
          const object = parseNjObject(rel, obj);
          const effectPtr = flags & ENTRY_EFFECT ? rel.ptr(e + extra) : 0;
          const animPtr = flags & ENTRY_TEXTURE_ANIM ? rel.ptr(e + extra + 4) : 0;
          const motionPtr = animated ? rel.ptr(e + 4) : 0;
          entries.push({
            animated,
            index: k,
            flags,
            object,
            rendered: isRendered(flags, animated, motionPtr),
            indirectId,
            effect: flags & ENTRY_EFFECT ? readEffect(rel, effectPtr) : null,
            textureAnim: animPtr ? readTextureAnim(rel, animPtr) : null,
            motion: motionPtr ? parseNjMotion(rel, motionPtr, countNodes(object)) : null,
            frameStep: animated ? rel.f32(e + 0x10) : 0,
          });
        } catch (err) {
          skippedEntries.push({ section: i, entry: k, flags, error: (err as Error).message });
        }
      }
    };
    readEntries(rel.ptr(s + 0x20), rel.u32(s + 0x28), false);
    readEntries(rel.ptr(s + 0x24), rel.u32(s + 0x2c), true);
    sections.push({
      id: rel.i32(s),
      position: [rel.f32(s + 4), rel.f32(s + 8), rel.f32(s + 0x0c)],
      rotation: [rel.i32(s + 0x10) * BAMS_TO_RAD, rel.i32(s + 0x14) * BAMS_TO_RAD, rel.i32(s + 0x18) * BAMS_TO_RAD],
      radius: rel.f32(s + 0x1c),
      objects: entries.filter((e) => e.rendered).map((e) => e.object),
      entries,
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

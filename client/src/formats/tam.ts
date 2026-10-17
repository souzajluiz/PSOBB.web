// Map texture animation file (map_<area>[_<layout>].tam), big-endian.
//
// Decompiled from PsoBB.exe (Ephinea 1.25.13):
//   load      FUN_0080a4c8 / FUN_008073f4 -> buffer DAT_00aafc6c
//   byteswap  FUN_00807828 (the file is stored big-endian)
//   apply     FUN_0080ab60, per map section entry:
//     entry flag 0x20 (effect slot): the first type-1 block row whose id equals the
//       slot id is copied into the slot (20 bytes) and a UV-scroll effect is created
//       for that texture (FUN_0066f58c; it forces wrap addressing via FUN_0081a55c).
//     entry flag 0x40 (texture animation): the type-2 block whose id equals the
//       animation id drives the texture as a list of (texture, frames) steps.
//   UV scroll  FUN_0066f804: offsets accumulate as shorts, wrapped to +-255, and are
//     divided by 256.0 (0x00939fc0) to texture units.
//
// Layout: blocks {u16 type, u16 size (bytes after this header)} until type 0xFFFF.
//   type & 1: u16 count, u16 pad, count x {u16 id, u16 texture, f32 scroll_u,
//             f32 scroll_v, f32 speed_u, f32 speed_v}   (scroll/speed in 1/256 units)
//   type & 2: u16 id, u16 count, count x {i16 texture, i16 frames} (frames -1 = hold)

export interface TamScroll {
  id: number;
  texture: number;
  scroll: [number, number];
  speed: [number, number];
}

export interface TamSwap {
  id: number;
  steps: Array<{ texture: number; frames: number }>;
}

export interface TamFile {
  scrolls: TamScroll[];
  swaps: TamSwap[];
}

export const TAM_UNITS = 256;

export function parseTam(data: Uint8Array): TamFile {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: TamFile = { scrolls: [], swaps: [] };
  let o = 0;
  while (o + 4 <= data.length) {
    const type = dv.getUint16(o, false);
    if (type === 0xffff) break;
    const size = dv.getUint16(o + 2, false);
    if (type & 1) {
      const n = dv.getUint16(o + 4, false);
      for (let i = 0; i < n; i++) {
        const e = o + 8 + i * 20;
        if (e + 20 > data.length) break;
        out.scrolls.push({
          id: dv.getUint16(e, false),
          texture: dv.getUint16(e + 2, false),
          scroll: [dv.getFloat32(e + 4, false), dv.getFloat32(e + 8, false)],
          speed: [dv.getFloat32(e + 12, false), dv.getFloat32(e + 16, false)],
        });
      }
    } else if (type & 2) {
      const id = dv.getUint16(o + 4, false);
      const n = dv.getUint16(o + 6, false);
      const steps: TamSwap['steps'] = [];
      for (let i = 0; i < n && o + 8 + i * 4 + 4 <= data.length; i++) {
        steps.push({ texture: dv.getInt16(o + 8 + i * 4, false), frames: dv.getInt16(o + 10 + i * 4, false) });
      }
      out.swaps.push({ id, steps });
    } else {
      break; // the client stops at an unknown block type too
    }
    o += 4 + size;
  }
  return out;
}

// "map_city00_00n.rel" -> "map_city00_00.tam"
export function tamFileFor(nrel: string): string {
  return nrel.replace(/n\.rel$/, '.tam');
}

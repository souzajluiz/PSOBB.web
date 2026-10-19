// Minimap rooms of a map (map_<area>[_<layout>]r.rel), the data the radar and
// the Area Map draw (classic/minimap.ts, render/minimap.ts).
//
// PsoBB.exe (Ephinea 1.25.13): load_minimap_data (0x00805a9c area) builds the
// name from the map's asset prefix + "r.rel" (s_r_rel), loads it as a REL
// (load_rel_asset) and keeps the root in minimap_current_map_data.
//
// Root (minimap_data, 0x10): u32 rooms, u32 njtl (a texture list, null in
// every Ephinea file), u32 room_count, u32 0.
// Room (minimap_room_data, 0x28):
//   +0x00 i16 room index (the map section id; mark_minimap_room_as_discovered
//         and Minimap_MarkRoomDiscovered_00805400 look rooms up by it)
//   +0x02 u16 flags: 1 undiscovered (set on every room at the first load of a
//         floor), 2 kept hidden until a TObjRaderCol reveals it, 4 use the
//         second mesh of the container for the discovery centre (no file
//         sets it)
//   +0x04 f32 x, y, z
//   +0x10 i32 rotation x, y, z (BAMS; matrix_rotation_euler: z, then y,
//         then x pre-multiplied, i.e. the vertex turns about X, then Y, then Z)
//   +0x1c f32 alpha (runtime: the fade-in after discovery)
//   +0x20 f32 discovery radius (equal to the mesh radius in the files)
//   +0x24 u32 mesh container {u32 unknown, u32 mesh}
// The mesh is an NJS_CNK_MODEL (vlist, plist, centre, radius) drawn with
// draw_vertex_list (DrawMinimapMesh_0082e6cc): flat floor plates (vertex type
// 41, strips type 64, one material: diffuse 0xffffffff, ambient 0xff7f7f7f).

import { parseNjcmModel, type NjcmModel } from './njcm.ts';
import { RelFile } from './rel.ts';

export const ROOM_UNDISCOVERED = 1;
export const ROOM_HIDDEN = 2;
export const ROOM_ALT_MESH = 4;

export type Vec3 = readonly [number, number, number];

export interface MinimapRoom {
  index: number; // section id
  flags: number; // as stored in the file
  position: Vec3;
  rotation: Vec3; // BAMS
  radius: number; // discovery radius
  model: NjcmModel;
}

export interface MinimapData {
  rooms: MinimapRoom[];
  textured: boolean; // njtl present (never in the Ephinea data)
}

const ROOM_SIZE = 0x28;

export function parseMinimapRel(data: Uint8Array): MinimapData {
  const r = new RelFile(data);
  const roomsAt = r.ptr(r.root);
  const textured = r.u32(r.root + 4) !== 0;
  const count = r.u32(r.root + 8);
  if (count > 0x400 || (count && (!roomsAt || roomsAt + count * ROOM_SIZE > data.length))) throw new Error(`minimap: bad room count ${count}`);
  const rooms: MinimapRoom[] = [];
  for (let i = 0; i < count; i++) {
    const o = roomsAt + i * ROOM_SIZE;
    const container = r.ptr(o + 0x24);
    const mesh = container ? r.ptr(container + 4) : 0;
    if (!mesh) throw new Error(`minimap: room ${i} has no mesh`);
    rooms.push({
      index: r.dv.getInt16(o, true),
      flags: r.u16(o + 2),
      position: [r.f32(o + 4), r.f32(o + 8), r.f32(o + 0xc)],
      rotation: [r.i32(o + 0x10), r.i32(o + 0x14), r.i32(o + 0x18)],
      radius: r.f32(o + 0x20),
      model: parseNjcmModel(data, mesh),
    });
  }
  return { rooms, textured };
}

// "map_forest01n.rel" -> "map_forest01r.rel" (the asset prefix + "r.rel").
export function minimapFileFor(nrel: string): string | null {
  return /n\.rel$/.test(nrel) ? nrel.replace(/n\.rel$/, 'r.rel') : null;
}

// Triangles (xyz per corner, in model space) of a chunk model's strips: the
// vertex chunks fill a shared buffer by index, the strips index it. The
// minimap draws without culling, so the winding is not kept.
export function modelTriangles(model: NjcmModel): Float32Array {
  const buffer = new Map<number, [number, number, number]>();
  for (const v of model.vertices) {
    for (let i = 0; i < v.indices.length; i++) {
      buffer.set(v.indices[i], [v.positions[i * 3], v.positions[i * 3 + 1], v.positions[i * 3 + 2]]);
    }
  }
  const out: number[] = [];
  for (const op of model.polys) {
    if (op.op !== 'strips') continue;
    for (const s of op.strips) {
      for (let i = 2; i < s.indices.length; i++) {
        const a = buffer.get(s.indices[i - 2]);
        const b = buffer.get(s.indices[i - 1]);
        const c = buffer.get(s.indices[i]);
        if (!a || !b || !c) continue;
        out.push(...a, ...b, ...c);
      }
    }
  }
  return new Float32Array(out);
}

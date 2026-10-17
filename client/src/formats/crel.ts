// Map collision geometry (`map_*c.rel`).
//
// Layout recovered from the client's collision loader (copy_map_collision_data,
// unknown_geometry_raycast, line_segment_intersects_triangle in the matching
// decompilation) and checked against every c.rel in Ephinea's data/scene.
//
// REL root (footer root_offset) -> u32 pointer to an array of mesh containers
// (0x18 bytes each), terminated by an entry whose mesh pointer is 0:
//   00 u32 mesh       -> mesh header
//   04 f32 x, y, z    bounding circle center (only x/z are used for culling)
//   10 f32 radius     bounding circle radius in the XZ plane
//   14 u32 flags      node flags; a query skips the mesh unless (flags & query) != 0.
//                     0x40000000 = excluded from ground queries (get_ground).
// Mesh header (0x10):
//   00 u32 vertex_count (the client never reads it; it matches the vertex array)
//   04 u32 vertices   -> f32[3] per vertex, world space
//   08 u32 face_count
//   0C u32 faces      -> face[face_count]
// Face (0x24):
//   00 u16 v0, v1, v2 vertex indices
//   06 u16 flags      surface flags (see CollisionFlag)
//   08 f32 nx, ny, nz unit normal (faces are one-sided: walls block from the front)
//   14 f32 x, y, z    bounding circle center
//   20 f32 radius     bounding circle radius (XZ)

import { RelFile } from './rel.ts';

// Face flag bits as the client tests them.
export const CollisionFlag = {
  // Ground surfaces. A ground query with mask M accepts faces with (flags & M & 0xFFE1) != 0;
  // bits 0x02/0x04/0x08/0x10 only mark the special ground types below.
  FLOOR: 0x0001,
  SHALLOW_WATER: 0x0002,
  DEEP_WATER: 0x0004,
  FOOTPRINTS: 0x0008,
  GRASS: 0x0010,
} as const;

// Masks the client passes for common queries.
export const GROUND_QUERY_MASK = 0x16ef; // unknown_get_ground_info(pos, 0x16ef): ground under objects/effects
export const PLAYER_GROUND_MASK = 0x005f; // play_footstep_effects: get_ground(pos, 0x5f) -> floor bits 0x41
export const PLAYER_WALL_MASK = 0x28a0; // player wall rays (unknown_player_touching_wall_maybe)
export const NODE_NO_GROUND = 0x40000000;

export interface CollisionFace {
  a: number;
  b: number;
  c: number;
  flags: number;
  normal: [number, number, number];
  center: [number, number, number];
  radius: number;
}

export interface CollisionMesh {
  center: [number, number, number];
  radius: number;
  flags: number;
  vertices: Float32Array; // x, y, z per vertex
  faces: CollisionFace[];
}

export interface MapCollision {
  meshes: CollisionMesh[];
}

const MAX_MESHES = 512; // map_collision_data holds 512 slots

export function parseMapCRel(data: Uint8Array): MapCollision {
  const rel = new RelFile(data);
  let entry = rel.ptr(rel.root);
  const meshes: CollisionMesh[] = [];
  if (entry === 0) return { meshes };
  for (; meshes.length < MAX_MESHES; entry += 0x18) {
    if (entry + 0x18 > data.length) throw new Error(`c.rel container 0x${entry.toString(16)} out of range`);
    const meshPtr = rel.ptr(entry);
    if (meshPtr === 0) break;
    const vertexCount = rel.u32(meshPtr);
    const vptr = rel.ptr(meshPtr + 4);
    const faceCount = rel.u32(meshPtr + 8);
    const fptr = rel.ptr(meshPtr + 0x0c);
    if (fptr + faceCount * 0x24 > data.length) throw new Error(`c.rel faces at 0x${fptr.toString(16)} out of range`);

    const faces: CollisionFace[] = [];
    let maxIndex = -1;
    for (let i = 0; i < faceCount; i++) {
      const f = fptr + i * 0x24;
      const face: CollisionFace = {
        a: rel.u16(f),
        b: rel.u16(f + 2),
        c: rel.u16(f + 4),
        flags: rel.u16(f + 6),
        normal: [rel.f32(f + 8), rel.f32(f + 0x0c), rel.f32(f + 0x10)],
        center: [rel.f32(f + 0x14), rel.f32(f + 0x18), rel.f32(f + 0x1c)],
        radius: rel.f32(f + 0x20),
      };
      maxIndex = Math.max(maxIndex, face.a, face.b, face.c);
      faces.push(face);
    }
    // The vertex count field is not trusted by the client; size the array by what the faces use.
    const nverts = Math.max(vertexCount, maxIndex + 1);
    if (vptr + nverts * 12 > data.length) throw new Error(`c.rel vertices at 0x${vptr.toString(16)} out of range`);
    const vertices = new Float32Array(nverts * 3);
    for (let i = 0; i < nverts * 3; i++) vertices[i] = rel.f32(vptr + i * 4);

    meshes.push({
      center: [rel.f32(entry + 4), rel.f32(entry + 8), rel.f32(entry + 0x0c)],
      radius: rel.f32(entry + 0x10),
      flags: rel.u32(entry + 0x14),
      vertices,
      faces,
    });
  }
  return { meshes };
}

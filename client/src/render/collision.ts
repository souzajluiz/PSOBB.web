// Map collision queries over a parsed c.rel, following the original client:
//  - groundHeight() is unknown_geometry_raycast (the downward ground probe used
//    by get_ground / unknown_get_ground_info);
//  - segmentHit() is line_segment_intersects_triangle (one-sided faces);
//  - move() is a simplified unknown_player_touching_wall_maybe: one ray along
//    the motion (stop when running nearly head-on into a wall, otherwise slide),
//    then 8 radial rays around the new position to push out of walls.
// `obstacles` holds the collision boxes of the field objects that block the
// player: closed doors, containers and jungle rocks (collectFieldSolids). The
// client keeps them in the object's box array (InitEnemyCollisionBoxes_007b9a88,
// bit 0 of the flag word at +0x18 enables a box: the door's is set while it is
// closed by FUN_007b52c4 and cleared when it opens by FUN_007b52ec). The pair
// test is CheckTwoHitboxCollision_007b5e40 (boxPairActive); the player's box is
// a sphere of PLAYER_RADIUS (sphere-vs-box and sphere-vs-sphere, XZ). A box
// blocks only when the step moves toward its centre (IsPlayerAboutToCollide_00694198).
// `bodies` holds the round hitboxes of other characters (NPCs) that the
// mover cannot walk into, with the client's rule (see bodyBlocks).
// Constants were read from PsoBB.exe (.rdata) at the addresses the decomp uses.
// Pure math, no three.js, so it runs in Node tests.

import {
  NODE_NO_GROUND,
  PLAYER_GROUND_MASK,
  PLAYER_WALL_MASK,
  type CollisionFace,
  type CollisionMesh,
  type MapCollision,
} from '../formats/crel.ts';

// unknown_geometry_raycast
const GROUND_NORMAL_Y_MIN = -1e-4; // faces with ny below this are never ground
const GROUND_EDGE_EPS = 1e-5; // 2D point-in-triangle edge tolerance
const GROUND_RAY_SCALE = -10000; // probe ray length (downward)
const GROUND_MAX_T = 2.0; // accept hits with t < 2, i.e. up to 20000 units below
// line_segment_intersects_triangle
const SEG_PARALLEL_EPS = -1e-5;
const SEG_FRONT_EPS = 1e-5;
// unknown_player_touching_wall_maybe
export const WALL_RAY_HEIGHT = 5; // rays are cast this far above the feet
const WALL_HEAD_ON_DOT = -0.87; // dot(dir, wall normal) at or below this stops the player
// The player's hitbox (SinowberillChallengePlayer_InitializeSpawnData_00695f28
// fills the box at player+0x758 and hands it to ConstructEntityHitbox_007b9ccc):
// radius +0x764 = 5.0 for every class; only its height changes per class
// (LoadPlayerEntityBattleParams_006960e4: y = stats +0x10 * g_HitboxZScaleFactor).
// The wall rays of unknown_player_touching_wall_maybe use this radius.
export const PLAYER_RADIUS = 5;
export const STEP_UP = 10; // ground probe starts this far above the feet (client: bloodstain_z_offset)

export interface GroundHit {
  y: number;
  normal: [number, number, number];
  flags: number;
}

export interface SegmentHit {
  point: [number, number, number];
  normal: [number, number, number];
  t: number;
  flags: number;
}

// The flag word (+0x18) of a field object's box as its table holds it (the
// door and rock boxes 0x10003, the containers 0x38003; see objectmodels.ts).
// The player's box is PLAYER_BOX_FLAGS.
export const OBJECT_BOX_FLAGS = 0x10003;
// SinowberillChallengePlayer_InitializeSpawnData_00695f28 (0x00695f28) writes the
// player's flag word at +0x770: 0x200b for class 1 (+0x8fc == 0), 0x2003 (+0x8fc
// set), 0x604b / 0x6043 for class 3, 0x16043 for class 6 (ASSUMED: class 1 is the
// normal player). Both class-1 words pass every field object's table.
export const PLAYER_BOX_FLAGS = 0x200b;

// CheckTwoHitboxCollision_007b5e40 (0x007b5e40), the flag gate before any shape
// test: both boxes enabled (bit 0 = 1), they share bit 1 or bit 2, and no pair of
// "exclusive" bits crosses between them: (8, 0x2000), (0x10, 0x4000), (0x20, 0x8000),
// (0x40, 0x10000), (0x80, 0x40000). Bit 0x100 is not part of the pair gate: the
// step test refuses a box that has it (IsPlayerAboutToCollide_00694198).
export function boxPairActive(a: number, b: number): boolean {
  if (!(a & b & 1)) return false;
  if (!(a & b & 6)) return false;
  for (const [x, y] of [
    [0x8, 0x2000],
    [0x10, 0x4000],
    [0x20, 0x8000],
    [0x40, 0x10000],
    [0x80, 0x40000],
  ] as const) {
    if (a & x && b & y) return false;
    if (b & x && a & y) return false;
  }
  return true;
}

// A blocking object box in world space: a box of half extents (halfX, halfZ)
// rotated by `yaw` around its center, between yMin and yMax. A sphere (sphere)
// has radius halfX and no orientation; the test is in XZ.
export interface Obstacle {
  key: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  halfX: number;
  halfZ: number;
  height: number; // the client's boxes are +-50 around the box center
  sphere?: boolean; // type 0 (CONTAINER_SPHERE, the jungle rock): halfX is the radius
  flags?: number; // the box's flag word (+0x18); OBJECT_BOX_FLAGS when absent
  ex?: number; // the entity's origin (CheckPlayerCollisionWithEntities' 100-unit filter)
  ez?: number;
}

// CheckPlayerCollisionWithEntities_007b62a0 takes an entity only when its origin is
// within this squared XZ distance of the player (0x0097e3bc = 10000).
export const PLAYER_COLLISION_RANGE_SQ = 10000;

// A round hitbox in XZ (collision_box with unk2 = 0: CheckTwoHitboxCollision
// _007b5e40 hands both boxes to CheckSphereOverlap_0083dbd4 with y = 0, so
// only the XZ distance against the sum of the radii counts).
export interface Body {
  x: number;
  z: number;
  radius: number;
}

// The step response of EnemyHandleCollisionStepUp_007b7704 for a mover that
// went from (px, pz) to (x, z) facing `heading` (BAMS) and now overlaps
// `body`: when it moved at all (squared distance >= 1e-10, 0x0097e39c) and the
// body's center lies within 90 degrees of the heading (b_minus_a(angle to the
// body, heading) < 0x4000 or >= 0xc000), the move is refused. Players (entity
// index < 0x1000) go back to (px, pz); enemies / NPCs sidestep instead (see
// npcwander.ts).
export function bodyBlocks(px: number, pz: number, x: number, z: number, heading: number, radius: number, body: Body): boolean {
  const ox = x - body.x, oz = z - body.z;
  const r = radius + body.radius;
  if (ox * ox + oz * oz >= r * r) return false; // CheckSphereOverlap: dist < r1 + r2
  const mx = x - px, mz = z - pz;
  if (mx * mx + mz * mz < 1e-10) return false;
  return bodyInFront(px, pz, heading, body);
}

// The body's center is within 90 degrees of `heading` seen from (px, pz).
export function bodyInFront(px: number, pz: number, heading: number, body: Body): boolean {
  const a = Math.trunc((Math.atan2(body.x - px, body.z - pz) * 0x10000) / (Math.PI * 2));
  const d = (a - heading) & 0xffff;
  return d < 0x4000 || d >= 0xc000;
}

export interface MoveResult {
  x: number;
  y: number;
  z: number;
  blocked: boolean; // motion was stopped or altered by a wall or missing floor
}

export class CollisionWorld {
  readonly meshes: CollisionMesh[];
  // Object boxes that block movement (set per frame by FieldObjects).
  obstacles: Obstacle[] = [];
  // Character hitboxes that block the player (set per frame by NpcLayer).
  bodies: Body[] = [];

  constructor(collision: MapCollision) {
    this.meshes = collision.meshes;
  }

  get faceCount(): number {
    return this.meshes.reduce((n, m) => n + m.faces.length, 0);
  }

  // Height of the ground under (x, z) as the client finds it: among faces that
  // contain the point in XZ, face up, and have at least one vertex at or below
  // fromY, the highest one wins (it may be slightly above fromY on slopes/steps).
  groundHit(x: number, z: number, fromY: number, mask = PLAYER_GROUND_MASK): GroundHit | null {
    let bestT = GROUND_MAX_T;
    let best: GroundHit | null = null;
    const faceMask = mask & 0xffe1;
    for (const m of this.meshes) {
      if (!(m.flags & mask) || m.flags & NODE_NO_GROUND) continue;
      const mdx = m.center[0] - x, mdz = m.center[2] - z;
      if (mdx * mdx + mdz * mdz > m.radius * m.radius) continue;
      const v = m.vertices;
      for (const f of m.faces) {
        if (!(f.flags & faceMask)) continue;
        const fdx = f.center[0] - x, fdz = f.center[2] - z;
        if (fdx * fdx + fdz * fdz > f.radius * f.radius) continue;
        const ny = f.normal[1];
        if (ny < GROUND_NORMAL_Y_MIN || Math.abs(ny) < 1e-9) continue;
        const a = f.a * 3, b = f.b * 3, c = f.c * 3;
        if (v[a + 1] > fromY && v[b + 1] > fromY && v[c + 1] > fromY) continue;
        const dxa = v[a] - x, dza = v[a + 2] - z;
        const dxb = v[b] - x, dzb = v[b + 2] - z;
        if (dza * dxb - dxa * dzb < GROUND_EDGE_EPS) continue;
        const dxc = v[c] - x, dzc = v[c + 2] - z;
        if (-dxb * dzc + dzb * dxc < GROUND_EDGE_EPS) continue;
        if (-dza * dxc + dzc * dxa < GROUND_EDGE_EPS) continue;
        // Plane height at (x, z).
        const y = v[a + 1] + (dxa * f.normal[0] + dza * f.normal[2]) / ny;
        const t = (y - fromY) / GROUND_RAY_SCALE;
        if (t < bestT) {
          bestT = t;
          best = { y, normal: f.normal, flags: f.flags };
        }
      }
    }
    return best;
  }

  groundHeight(x: number, z: number, fromY: number, mask = PLAYER_GROUND_MASK): number | null {
    return this.groundHit(x, z, fromY, mask)?.y ?? null;
  }

  // First front-facing face crossed by the segment from -> to (smallest t).
  segmentHit(from: [number, number, number], to: [number, number, number], mask = PLAYER_WALL_MASK): SegmentHit | null {
    const d: [number, number, number] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const len = Math.hypot(d[0], d[2]);
    let best: SegmentHit | null = null;
    for (const m of this.meshes) {
      if (!(m.flags & mask)) continue;
      // Distance from the mesh circle center to the segment, in XZ.
      if (segmentPointDistSq(from, d, m.center) > m.radius * m.radius) continue;
      for (const f of m.faces) {
        if (!(f.flags & mask)) continue;
        const fdx = f.center[0] - from[0], fdz = f.center[2] - from[2];
        const reach = f.radius + len;
        if (fdx * fdx + fdz * fdz > reach * reach) continue;
        const t = intersectFace(f, m.vertices, from, d);
        if (t !== null && (!best || t < best.t)) {
          best = { point: [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t], normal: f.normal, t, flags: f.flags };
        }
      }
    }
    return best;
  }

  // Moves a character standing at (x, y, z) by (dx, dz), sliding along walls,
  // keeping `radius` away from them and following the ground. With
  // `bodies` (default) the move is refused when it runs into a body ahead
  // (bodyBlocks; the heading is the direction of the motion).
  move(x: number, y: number, z: number, dx: number, dz: number, radius = PLAYER_RADIUS, bodies = true): MoveResult {
    const stay: MoveResult = { x, y, z, blocked: true };
    let len = Math.hypot(dx, dz);
    if (len < 1e-6) return { x, y, z, blocked: false };
    let blocked = false;
    const ry = y + WALL_RAY_HEIGHT;

    // 1. Ray along the motion, |v| + radius long.
    let dirX = dx / len, dirZ = dz / len;
    const reach = len + radius;
    const hit = this.segmentHit([x, ry, z], [x + dirX * reach, ry, z + dirZ * reach]);
    if (hit) {
      const [nx, nz] = flatNormal(hit.normal);
      const dot = dirX * nx + dirZ * nz;
      if (dot <= WALL_HEAD_ON_DOT) return stay;
      // Slide: drop the component of the motion that goes into the wall.
      const into = dx * nx + dz * nz;
      dx -= into * nx;
      dz -= into * nz;
      len = Math.hypot(dx, dz);
      if (len < 1e-6) return stay;
      dirX = dx / len;
      dirZ = dz / len;
      blocked = true;
      const again = this.segmentHit([x, ry, z], [x + dirX * (len + radius), ry, z + dirZ * (len + radius)]);
      if (again) return stay;
    }

    // 2. Eight radial rays around the new position push it out of nearby walls.
    let nxp = x + dx, nzp = z + dz;
    for (let pass = 0; pass < 2; pass++) {
      const push = this.radialPush(nxp, ry, nzp, radius);
      if (!push) break;
      nxp += push[0];
      nzp += push[1];
      blocked = true;
      if (pass === 1 && this.radialPush(nxp, ry, nzp, radius)) return stay;
    }

    // 2b. Object boxes (doors, containers, rocks) block the new position.
    if (this.blockedBy(nxp, y, nzp, radius, [dx, dz])) return stay;
    // 2c. Character hitboxes (NPCs) ahead refuse the move.
    if (bodies && this.bodies.length) {
      const heading = Math.trunc((Math.atan2(dx, dz) * 0x10000) / (Math.PI * 2)) & 0xffff;
      for (const b of this.bodies) if (bodyBlocks(x, z, nxp, nzp, heading, radius, b)) return stay;
    }

    // 3. Ground under the new position; no floor means the move is refused.
    const ny = this.groundHeight(nxp, nzp, y + STEP_UP);
    if (ny === null) return stay;
    return { x: nxp, y: ny, z: nzp, blocked };
  }

  // The blocking object box that (x, y, z) with `radius` overlaps, or null.
  // Without `step` the overlap alone counts; with it (the player's step, dx/dz)
  // only a box whose centre lies ahead of the new position counts
  // (IsPlayerAboutToCollide_00694198: dot(new position - centre, velocity) < 0).
  blockedBy(x: number, y: number, z: number, radius = PLAYER_RADIUS, step?: readonly [number, number]): Obstacle | null {
    for (const o of this.obstacles) {
      const flags = o.flags ?? OBJECT_BOX_FLAGS;
      if (!boxPairActive(flags, PLAYER_BOX_FLAGS)) continue;
      if (flags & 0x100) continue; // the step test passes a box with this bit (IsPlayerAboutToCollide)
      if (o.ex !== undefined && o.ez !== undefined) {
        const fx = o.ex - x, fz = o.ez - z;
        if (fx * fx + fz * fz >= PLAYER_COLLISION_RANGE_SQ) continue;
      }
      if (y + WALL_RAY_HEIGHT < o.y - o.height || y > o.y + o.height) continue;
      const dx = x - o.x, dz = z - o.z;
      if (o.sphere) {
        const r = o.halfX + radius;
        if (dx * dx + dz * dz >= r * r) continue;
      } else {
        const c = Math.cos(-o.yaw), s = Math.sin(-o.yaw);
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        // sphere against the rotated rectangle: the nearest point lies within the radius
        const ex = lx - Math.max(-o.halfX, Math.min(o.halfX, lx));
        const ez = lz - Math.max(-o.halfZ, Math.min(o.halfZ, lz));
        if (ex * ex + ez * ez >= radius * radius) continue;
      }
      if (step && dx * step[0] + dz * step[1] >= 0) continue;
      return o;
    }
    return null;
  }

  // Deepest wall penetration among 8 rays of length `radius`, as an XZ push vector.
  private radialPush(x: number, y: number, z: number, radius: number): [number, number] | null {
    let best: [number, number] | null = null;
    let bestDepth = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const ex = x + Math.sin(a) * radius, ez = z + Math.cos(a) * radius;
      const hit = this.segmentHit([x, y, z], [ex, y, ez]);
      if (!hit) continue;
      const [nx, nz] = flatNormal(hit.normal);
      const depth = Math.abs((ex - hit.point[0]) * nx + (ez - hit.point[2]) * nz);
      if (depth > bestDepth) {
        bestDepth = depth;
        best = [nx * (depth + 0.01), nz * (depth + 0.01)];
      }
    }
    return best;
  }
}

function flatNormal(n: [number, number, number]): [number, number] {
  const l = Math.hypot(n[0], n[2]) || 1;
  return [n[0] / l, n[2] / l];
}

function segmentPointDistSq(from: [number, number, number], d: [number, number, number], p: [number, number, number]): number {
  const px = p[0] - from[0], pz = p[2] - from[2];
  const dd = d[0] * d[0] + d[2] * d[2];
  let t = dd > 0 ? (px * d[0] + pz * d[2]) / dd : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = px - d[0] * t, qz = pz - d[2] * t;
  return qx * qx + qz * qz;
}

// Segment from + d*t, t in [0, 1], against one face; only hits the front side.
function intersectFace(f: CollisionFace, v: Float32Array, from: [number, number, number], d: [number, number, number]): number | null {
  const [nx, ny, nz] = f.normal;
  const dn = d[0] * nx + d[1] * ny + d[2] * nz;
  if (dn >= SEG_PARALLEL_EPS) return null;
  const a = f.a * 3, b = f.b * 3, c = f.c * 3;
  const s = (from[0] - v[a]) * nx + (from[1] - v[a + 1]) * ny + (from[2] - v[a + 2]) * nz;
  if (s <= SEG_FRONT_EPS) return null;
  const t = s / -dn;
  if (t > 1 || t < 0) return null;
  const px = from[0] + d[0] * t, py = from[1] + d[1] * t, pz = from[2] + d[2] * t;
  const ax = px - v[a], ay = py - v[a + 1], az = pz - v[a + 2];
  const bx = px - v[b], by = py - v[b + 1], bz = pz - v[b + 2];
  const cx = px - v[c], cy = py - v[c + 1], cz = pz - v[c + 2];
  // (P-A) x (P-B), (P-B) x (P-C), (P-C) x (P-A) must all point along the normal.
  if ((ay * bz - az * by) * nx + (az * bx - ax * bz) * ny + (ax * by - ay * bx) * nz < 0) return null;
  if ((by * cz - bz * cy) * nx + (bz * cx - bx * cz) * ny + (bx * cy - by * cx) * nz < 0) return null;
  if ((cy * az - cz * ay) * nx + (cz * ax - cx * az) * ny + (cx * ay - cy * ax) * nz < 0) return null;
  return t;
}

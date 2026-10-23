// The spot search of the local player's item drop (PsoBB.exe 1.25.13).
//
// 0x0068d878 (named ChallengePlayer_UseItem_0068d878 in the dump) sends the
// 6x2C hold {900 frames, particle 0, x, z, radius^2 0} at the player (not when
// the player's +0x32c is 2; ASSUMED never 2 here) and calls
// HandleItemAcquisition_006a43b8, which builds a drop object (ctor 006a40c0,
// ring 1 through 006a6e00). The object's update (vtable slot 1, 006a4820) runs
// the search FUN_006a44fc once per game frame, one spot per call. When a spot
// is found it sends 6x2A there (FUN_0068f090) and then 6x2D, the hold release
// (DisablePlayerMovement_00685514). When the search runs out nothing is sent
// and the hold runs down on its own.
//
// Ring r (the object's +0x1d) has 4r spots on a circle of radius 6r
// (006a6e00: count = 4r at +0x1f, radius = r * 6.0 at +0x34, step 0x10000 / 4r
// BAMS at +0x2c, the first angle is the player's heading (+0x28) at +0x30).
// A spot is rejected when:
//   - it has no ground (FUN_00780630, mask 0x41): the next spot;
//   - a wall lies between the player's eye and the spot (FUN_0077fffc, mask
//     -1): the next spot. The eye is the ground under the player probed from
//     y + 10 (FUN_007b4c58, 0x0097e3e4), or the player's own y, plus 6.
// The spot's y is the ground + 6 (0x0093db84): the 6x2A carries it.
//
// Then the body test (FUN_006a44fc after the wall test, 0x006a4780..0x006a4850):
// the spot is a sphere of radius 3 (0x009cba5c = 3.0, flags 0x31f03) in the
// list g_pItemGroundCheckData (0x009cba38, count 1). It is tested against every
// entity g_EntityArray[PlayerEntityCount + NumEntities .. Total) (0x00aad720,
// globals 0x00aae164 / 0x00aae168 / 0x00aae16c), i.e. the objects that are
// neither players (indices below PlayerEntityCount) nor enemies, that have a
// collision list (+0xa4) and no flag 0x800 (+0x30), with the xz distance to the
// spot (vec3_xz_distance_sq, FUN_007a9180) below 10000 (0x0093db88). FUN_007b5318
// then rejects the spot on any overlap: the sphere against each box of the
// entity (FUN_0083d2fc, the box's +-50 faces); both centres are handed over
// with y = 0 (the 0x0083d2fc / 0x0083dbd4 calls pass 0 as y), so the test is
// in XZ. The port has no entity list: `bodies` is the object boxes that block
// the player (render/collision.ts `obstacles`, the closed doors), ASSUMED to be
// the same set.
// ASSUMED: sin for x and cos for z (the tables 0x0098b560 / 0x0098c560).
// ASSUMED: the box's rotation is its yaw, as render/collision.ts `blockedBy`.
// Quirk kept on purpose: the search checks `ring < 6` before it steps the ring,
// so the first spot of ring 6 is tried and then the search fails.

export const DROP_RING_STEP = 6; // 0x0093db68
export const DROP_GROUND_OFFSET = 6; // 0x0093db84
export const DROP_EYE_PROBE = 10; // 0x0097e3e4
export const DROP_EYE_HEIGHT = 6; // 0x0093db84 again, applied to the eye point
export const DROP_HOLD_FRAMES = 900; // 6x2C from 0x0068d878
export const DROP_SPOT_RADIUS = 3; // 0x009cba5c, set by the search each time
export const DROP_BODY_RANGE_SQ = 10000; // 0x0093db88 (compared with the squared xz distance)
const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

export interface DropPoint {
  x: number;
  y: number;
  z: number;
}

export type DropStep = { status: 'searching' } | { status: 'found'; at: DropPoint } | { status: 'failed' };

// A box of an entity that blocks a drop: its centre in XZ, its yaw, and its
// half extents (the exe's collision_box: unk1 = halfX, radius = halfZ).
export interface DropBody {
  x: number;
  z: number;
  yaw: number;
  halfX: number;
  halfZ: number;
  sphere?: boolean; // a type 0 entity: halfX is its radius (XZ circle)
}

export interface DropSearchOptions {
  // The ground under (x, z), probed from fromY; null when there is none.
  ground: (x: number, z: number, fromY: number) => number | null;
  // True when a wall lies on the segment (cast_ray_at_map_collision_geometry).
  wallBlocks: (from: DropPoint, to: DropPoint) => boolean;
  // The entities' boxes the spot must stay clear of (FUN_007b5318); none when absent.
  bodies?: (() => readonly DropBody[]) | undefined;
}

// FUN_007b5318 for the spot sphere against one box, in XZ: the nearest point
// of the rotated rectangle to the spot's centre lies within the spot radius.
// A sphere body (FUN_0083dbd4) overlaps when the centres are closer than the
// two radii.
export function spotHitsBody(spot: DropPoint, b: DropBody): boolean {
  const dx = spot.x - b.x;
  const dz = spot.z - b.z;
  if (b.sphere) {
    const r = DROP_SPOT_RADIUS + b.halfX;
    return dx * dx + dz * dz < r * r;
  }
  const c = Math.cos(-b.yaw);
  const s = Math.sin(-b.yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const nx = Math.max(-b.halfX, Math.min(b.halfX, lx));
  const nz = Math.max(-b.halfZ, Math.min(b.halfZ, lz));
  const ex = lx - nx;
  const ez = lz - nz;
  return ex * ex + ez * ez < DROP_SPOT_RADIUS * DROP_SPOT_RADIUS;
}

export class DropSearch {
  private from: DropPoint;
  private base: number; // +0x28: the player's heading, BAMS
  private ring = 1; // +0x1d
  private index = 0; // +0x1e
  private count = 4; // +0x1f
  private step = 0; // +0x2c, BAMS
  private radius = 0; // +0x34
  private angle = 0; // +0x30, BAMS
  private opts: DropSearchOptions;

  constructor(from: DropPoint & { angle: number }, opts: DropSearchOptions) {
    this.from = { x: from.x, y: from.y, z: from.z };
    this.base = Math.round(from.angle / BAMS_TO_RAD) & 0xffff;
    this.opts = opts;
    this.setup();
  }

  // 006a6e00 for the current ring.
  private setup(): void {
    this.index = 0;
    this.count = this.ring * 4;
    this.step = Math.floor(0x10000 / this.count);
    this.radius = this.ring * DROP_RING_STEP;
    this.angle = this.base;
  }

  // One spot (FUN_006a44fc). Call once per game frame until it is not 'searching'.
  search(): DropStep {
    if (this.ring >= 6) {
      this.ring = 1;
      this.setup();
      return { status: 'failed' };
    }
    if (this.index >= this.count) {
      this.ring++;
      this.setup();
    }
    const a = this.angle * BAMS_TO_RAD;
    const x = this.from.x + this.radius * Math.sin(a);
    const z = this.from.z + this.radius * Math.cos(a);
    const g = this.opts.ground(x, z, this.from.y);
    if (g === null) return this.reject();
    const at = { x, y: g + DROP_GROUND_OFFSET, z };
    if (this.opts.wallBlocks(this.eye(), at)) return this.reject();
    if (this.bodyUnder(at)) return this.reject();
    return { status: 'found', at };
  }

  // FUN_006a44fc's loop over the object entities (see the header).
  private bodyUnder(at: DropPoint): boolean {
    for (const b of this.opts.bodies?.() ?? []) {
      const dx = at.x - b.x;
      const dz = at.z - b.z;
      if (dx * dx + dz * dz >= DROP_BODY_RANGE_SQ) continue;
      if (spotHitsBody(at, b)) return true;
    }
    return false;
  }

  private reject(): DropStep {
    this.angle += this.step;
    this.index++;
    return { status: 'searching' };
  }

  // FUN_007b4c58 on the player, then +6.
  private eye(): DropPoint {
    const g = this.opts.ground(this.from.x, this.from.z, this.from.y + DROP_EYE_PROBE);
    return { x: this.from.x, y: (g ?? this.from.y) + DROP_EYE_HEIGHT, z: this.from.z };
  }
}

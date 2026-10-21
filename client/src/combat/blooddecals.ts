// The ground "pools" the enemies leave when they die (PsoBB.exe, Ephinea
// 1.25.13 VAs): the dump calls them debris / drop entities (CreateEntity_00578148
// and ten siblings); they are a textured quad on the floor with the three
// 64 x 64 splat textures of bm_ene_common_all.bml (entry 0 purple, 1 green, 2
// red; the dark enemies leave the purple ones).
//
// Eleven creators, one per (texture, size):
//   InitializeEntity_00577a2c (base vtable 0x00b06bc0, update 0x00577760,
//     render 0x00577884) is the growing pool: texture 2 (red) from
//     0x00578148 (size 25), 0x005781d8 (15), 0x00578268 (2.5), 0x005782f8
//     (7.5); texture 1 (green) from 0x00578388 (25), 0x00578418 (15),
//     0x005784a8 (2.5), 0x00578538 (7.5);
//   EntityConstructor_0057791c (vtable 0x00b06bd0, update 0x00578078) is the
//     fade-in pool, texture 0 (purple): 0x005785c8 (25), 0x00578658 (15),
//     0x005786e8 (7.5).
// Each takes the point and a delay in frames (param 7).
//
// Construction (0x00577a2c): the ground below point + 5 up (the downward map
// ray with mask 0x16ef) gives the centre; no ground, or a ground normal
// whose pitch is outside 0x3000..0x5000 BAMS (more than 22.5 degrees from
// level), and the entity ends at once. The centre is the hit point lifted by
// rand * 0.5 + 0.213456. The quad is irregular: two perpendicular unit axes A
// and B on the ground, spun by a random angle, and the corners are
//   c0 = B f + A f', c1 = B f - A f', c2 = -B f + A f', c3 = -B f - A f'
// with a fresh pair (f, f') = rand * 1.2 + 0.35 for each corner (10 rand
// calls: the lift, the spin, then 4 pairs). A pool of size above 5 pulls a
// corner in (x 0.2) when the ground under its far point is missing or more
// than 3 below the pool.
// The counter +0xc4 starts at delay * -0.2 and gains 0.2 a frame.
//   Growing pool (update 0x00577760): while the counter is not above the
//     size it gains 0.2 and, once above 0, the corners are centre + dir *
//     counter. It never ends by itself.
//   Fade-in pool (update 0x00578078): the corners are set once at the full
//     size; once the counter is above 0 the alpha (+0xc8) gains 0.05 a frame
//     up to 1 and goes into the vertex colours (alpha << 24 | 0xffffff).
// Render (0x00577884): only with the counter above 0 and the point within
// sqrt(22500) = 150 units of the camera on the ground plane; the four
// vertices are drawn as a strip with the uv (0,0) (0,1) (1,0) (1,1).
//
// ASSUMED: the pools stay until the floor changes (nothing in the entity ends
// it), capped here at POOL_LIMIT; a sloped but allowed floor keeps a flat
// quad; the draw flag `g_IsRenderingActive != _DAT_009bedd8` is always true.
// ASSUMED: the green creators' texture 1 (their argument is the dump's
// `&g_ChallengeListWindowFlag`, a mis-resolved name, so the index is by pattern).
// The creators' sizes (25 / 15 / 2.5 / 7.5), the fade-in variant and the growth
// and fade updates (0x00577760, 0x00578078) and the constants are checked
// against the exe in the salvage pass; the ground probe and the 10-rand
// construction are not.

const f = Math.fround;

export type PoolTexture = 0 | 1 | 2;

export interface PoolSpec {
  /** The creator function's VA. */
  readonly creator: number;
  /** Entry of the bm_ene_common_all.bml texture list: 0 purple, 1 green, 2 red. */
  readonly texture: PoolTexture;
  /** Largest reach of a corner (the `size` parameter). */
  readonly size: number;
  /** The fade-in variant (EntityConstructor_0057791c) instead of the growing one. */
  readonly fade: boolean;
}

const pool = (creator: number, texture: PoolTexture, size: number, fade: boolean): PoolSpec => ({ creator, texture, size, fade });

export const POOLS = {
  red25: pool(0x00578148, 2, 25, false),
  red15: pool(0x005781d8, 2, 15, false),
  red2_5: pool(0x00578268, 2, 2.5, false),
  red7_5: pool(0x005782f8, 2, 7.5, false),
  green25: pool(0x00578388, 1, 25, false),
  green15: pool(0x00578418, 1, 15, false),
  green2_5: pool(0x005784a8, 1, 2.5, false),
  green7_5: pool(0x00578538, 1, 7.5, false),
  purple25: pool(0x005785c8, 0, 25, true),
  purple15: pool(0x00578658, 0, 15, true),
  purple7_5: pool(0x005786e8, 0, 7.5, true),
} as const satisfies Record<string, PoolSpec>;

export type PoolId = keyof typeof POOLS;

export const POOL_GROW = f(0.2); // DAT_00927320: the counter's step
export const POOL_DELAY_STEP = f(-0.2); // DAT_00927310: delay * this is the first counter
export const POOL_FADE_STEP = f(0.05); // DAT_009272d4
export const POOL_LIFT = f(0.21345600485801697); // DAT_009272e4
export const POOL_LIFT_RAND = f(0.5); // DAT_009272fc
export const POOL_FACTOR_BASE = f(0.35); // DAT_009272f4
export const POOL_FACTOR_RANGE = f(1.2); // DAT_009272f0
export const POOL_PULL = f(0.2); // DAT_009272e8
export const POOL_PULL_MIN_SIZE = 5; // DAT_00927304
export const POOL_PULL_DROP = -3; // DAT_009272ec
export const POOL_GROUND_UP = 5; // the ground probe starts 5 above the point
export const POOL_CULL_DISTANCE_SQ = 22500; // DAT_00927318
/** The tilt the entity accepts: |pitch - 0x4000| <= 0x1000 BAMS = 22.5 degrees. */
export const POOL_MAX_SLOPE = Math.tan(Math.PI / 8);
/** ASSUMED cap of live pools in the port (the exe has none). */
export const POOL_LIMIT = 64;

export const POOL_UV: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
];

/** A ground slope (rise over run) the entity accepts. */
export function slopeAllowed(slope: number): boolean {
  return slope <= POOL_MAX_SLOPE;
}

/** The ground the pool probes: the surface under a point, or null (no ground). */
export type GroundProbe = (x: number, z: number, fromY: number) => number | null;

export class BloodPool {
  readonly spec: PoolSpec;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The four corner directions (x, y, z each; y stays 0 on a level floor). */
  readonly dirs = new Float32Array(12);
  /** +0xc4: the delay counter that becomes the growth. */
  t: number;
  /** +0xc8: the fade-in alpha. */
  alpha = 0;
  /** The floor refused the pool (no ground / too steep): it ends at once. */
  readonly dead: boolean;

  /**
   * `at` is the creator's point, `delay` its frames; `ground` probes the map
   * (`slope` is the floor's rise over run there, null when unknown) and `rand`
   * is the client's rand() / 32768.
   */
  constructor(spec: PoolSpec, delay: number, at: { x: number; y: number; z: number }, ground: GroundProbe, slope: number | null, rand: () => number) {
    this.spec = spec;
    this.t = f(delay * POOL_DELAY_STEP);
    const gy = ground(at.x, at.z, at.y + POOL_GROUND_UP);
    this.x = at.x;
    this.z = at.z;
    if (gy === null || (slope !== null && !slopeAllowed(slope))) {
      this.y = at.y;
      this.dead = true;
      return;
    }
    this.dead = false;
    this.y = f(f(f(rand() * POOL_LIFT_RAND) + gy) + POOL_LIFT);
    // The spin about the floor normal: A = (sin a, 0, cos a), B = (-cos a, 0, sin a) on a level floor.
    const a = rand() * Math.PI * 2;
    const ax = Math.sin(a), az = Math.cos(a);
    const bx = -Math.cos(a), bz = Math.sin(a);
    for (let k = 0; k < 4; k++) {
      // c0 = B fb + A fa, c1 = B fb - A fa, c2 = -B fb + A fa, c3 = -B fb - A fa;
      // fa (the factor of A) is the first rand of the pair.
      const fa = f(f(rand() * POOL_FACTOR_RANGE) + POOL_FACTOR_BASE);
      const fb = f(f(rand() * POOL_FACTOR_RANGE) + POOL_FACTOR_BASE);
      const sb = k < 2 ? 1 : -1;
      const sa = k % 2 === 0 ? 1 : -1;
      this.dirs[k * 3] = f(bx * sb * fb) + f(ax * sa * fa);
      this.dirs[k * 3 + 1] = 0;
      this.dirs[k * 3 + 2] = f(bz * sb * fb) + f(az * sa * fa);
    }
    // The far corners that would hang over nothing are pulled in.
    if (spec.size > POOL_PULL_MIN_SIZE) {
      for (let k = 0; k < 4; k++) {
        const px = this.x + this.dirs[k * 3] * spec.size;
        const pz = this.z + this.dirs[k * 3 + 2] * spec.size;
        const g = ground(px, pz, this.y + POOL_GROUND_UP);
        if (g === null || g - this.y < POOL_PULL_DROP) {
          this.dirs[k * 3] = f(this.dirs[k * 3] * POOL_PULL);
          this.dirs[k * 3 + 2] = f(this.dirs[k * 3 + 2] * POOL_PULL);
        }
      }
    }
  }

  /** One update (every game frame). */
  tick(): void {
    if (this.dead) return;
    if (this.spec.fade) {
      if (this.t <= this.spec.size) this.t = f(this.t + POOL_GROW);
      if (this.t > 0 && this.alpha < 1) this.alpha = Math.min(1, f(this.alpha + POOL_FADE_STEP));
    } else if (this.t <= this.spec.size) {
      this.t = f(this.t + POOL_GROW);
    }
  }

  /** The render test: the counter is above 0 (the camera test is the caller's). */
  get visible(): boolean {
    return !this.dead && this.t > 0;
  }

  /** What the corner directions are scaled by: the counter while growing, the size once for the fade-in. */
  get reach(): number {
    return this.spec.fade ? this.spec.size : this.t;
  }

  /** The vertex alpha (1 for the growing pool). */
  get opacity(): number {
    return this.spec.fade ? this.alpha : 1;
  }

  /** Corner k (0..3) of the strip. */
  corner(k: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    const r = this.reach;
    out[0] = this.x + this.dirs[k * 3] * r;
    out[1] = this.y;
    out[2] = this.z + this.dirs[k * 3 + 2] * r;
    return out;
  }

  /** The camera test of the render: on the ground plane, within 150 units. */
  near(cx: number, cz: number): boolean {
    const dx = this.x - cx, dz = this.z - cz;
    return dx * dx + dz * dz < POOL_CULL_DISTANCE_SQ;
  }
}

// Goran / Pyro Goran / Goran Detonator (vtable 0x00b0af40): the warp that the
// Booma substrate brain (combat/enemyai.ts EnemyAi) does not have.
//
// Exe states (vtable slots +0x154 + 4 * state, dispatcher 0x0052b78c):
//   3  0x005acdb8 (goran_wandering_warp_chance): each tick the chase target is
//      checked for a warp; when none fires it calls the Booma's chase handler
//      0x0052afe4 (war cry, then chase). The war cry is inside that handler, so
//      the warp roll runs in the port's notice state too.
//   10 0x005acb78 (wrapper, runs the body 0x005acb8c only when +0x32e == 10): the
//      leap. Set by hit_goran_enemy_with_projectile (0x005acb10), which the warp
//      calls with the flank point.
//   11 0x005ae3cc is not a state: it is the weapon-trail updater of animations
//      3 and 4 (slot +0x180, reached by no dispatcher), not ported.
//
// The warp (state 3, objdump 0x005acdb8..0x005ad026, VERIFIED constants):
//   a. the enemy is not frozen and is in state 3 (0x005acae8: state not 0, 8, 10)
//      and has a target (GetTargetableNPC, the chase target here);
//   b. roll < (50 + initdata_param3) * 0.01 (0x0092a7d8 = 50, 0x0092a7c8 = 0.01;
//      the roll is the random float 0x007751b0, drawn only when a. holds);
//   c. the squared XZ distance d2 to the target is in [minDist^2, 180^2]
//      (AttackData[17 + subtype].distanceX, 0x0092a7c4 = 32400);
//   d. the target's heading and the bearing of the target from the enemy differ
//      by at most round(iparam1 * 65536 / 360) BAMS (iparam1 = MovementData
//      [17 + subtype].iparam1; 0x0092a7c0 = 65536, 0x0092a7bc = 360).
// Then the flank point (flankPoint below; the dump's arithmetic, asm of the
// rotation and the scale branch checked): the offset (target - enemy) turned 90
// degrees (+) or 270 degrees (-) by the sign of the heading difference, scaled by
// flankDist^2 / d2 when d2 is under flankDist^2 (AttackData[20 + subtype].distanceX);
// the point is the target plus that vector. The launch (0x005acb10) replaces the
// chase tick of that frame.
//
// The leap (state 10, 0x005acb8c, VERIFIED control flow, dump for the arithmetic):
//   sub 0: the counter (iparam2) is set and the 0x3b0 timer runs (its step is not
//          traced: ASSUMED one tick, then sub 1).
//   sub 1: face the target (the heading is set straight, no turn rate); move with
//          the launch velocity at fparam6 units per tick (ASSUMED: vtable +0x4c,
//          the projectile step, not traced); land when the squared distance to the
//          target is under fparam6 (dump: `fStack_10 < field5_0x14`) or the counter
//          runs out.
//   sub 2: the landing (EnemyUpdateCollisionWrapper: the body box against the
//          players). ASSUMED: one tick with one contact hit when the target is in
//          reach, then the chase again. The exe never writes +0x32e here, so the exit
//          is ASSUMED.
//
// Rows are the BattleParamEntry rows of the subtype (get_battleparams_*: the
// subtype's enum is 17 / 18 / 19 Goran, Pyro, Detonator in the dump's init_goran_
// subtypes_global_config). Read from BattleParamEntry_ep4_on.dat (Normal): movement
// 17..19 fparam6 3, 6.5, 7.5; iparam1 10, 45, 45; iparam2 6, 6, 8; attack 17..19
// distanceX 13, 15, 32; attack 20..22 distanceX 48, 48, 140.
//
// Not reproduced: the search gate before the roll (vtable +0x44, 0x007713a4, not
// traced: ASSUMED always passes), the flight's hit flag 0x200000 and the portal
// fade of the 0x3b0 timer (the Dimenian's timer object, 0x00512404), the lock-on
// retarget (SorcererAcquireTarget).

import { EnemyAi, BAMS_TO_RAD, ATTACK_DAMAGE_MULT, ATTACK_KNOCKBACK, type AiFrame, type AiTarget } from './enemyai.ts';
import type { EnemyAttackData, EnemyMovementData } from '../formats/battleparams.ts';

// The per-subtype rows the warp reads (BattleParams via render/combat.ts).
export interface GoranWarpRow {
  speed: number; // MovementData fparam6: the launch speed and the landing distance^2
  toleranceDeg: number; // MovementData iparam1: the heading tolerance in degrees
  counter: number; // MovementData iparam2: the leap's tick counter
  minDist: number; // AttackData[17 + subtype].distanceX: the warp's minimum distance
  flankDist: number; // AttackData[20 + subtype].distanceX: the flank's scale distance
}

export const GORAN_WARP = {
  basePercent: 50, // goran_detonator_base_warp_percent (0x0092a7d8)
  percentScale: 0.01, // g_GoranWarpPercentScaleFactor (0x0092a7c8)
  maxDistSq: 32400, // g_GoranWarpDistanceSquaredThreshold (0x0092a7c4), 180^2
  bamsPerTurn: 65536,
  degreesPerTurn: 360,
} as const;

// round(iparam1 * 65536 / 360): the heading tolerance in BAMS (0x0092a7c0, 0x0092a7bc).
export function warpToleranceBams(toleranceDeg: number): number {
  return Math.round((toleranceDeg * GORAN_WARP.bamsPerTurn) / GORAN_WARP.degreesPerTurn);
}

// (50 + initdata_param3) * 0.01: the chance of the roll (0x0092a7d8, 0x0092a7c8).
export function warpChance(initdata3: number): number {
  return (GORAN_WARP.basePercent + initdata3) * GORAN_WARP.percentScale;
}

// An angle in BAMS, as the exe's integer headings (atan2 * 65536 / 2pi, ROUND).
const toBams = (rad: number): number => Math.round(rad / BAMS_TO_RAD) & 0xffff;

// The absolute difference of two BAMS headings (integer_angle_abs_difference).
export function bamsDifference(a: number, b: number): number {
  const d = Math.abs(((a - b) & 0xffff));
  return d > 0x8000 ? 0x10000 - d : d;
}

// The flank point of a warp (the dump's goran_wandering_warp_chance block): the
// vector v = target - enemy (ASSUMED sign) is turned by +90 deg (0x4000) when the
// heading difference (target heading - bearing of v) is not negative and by -90 deg
// (0xc000) when it is, then scaled by flankDist^2 / d2 while d2 < flankDist^2; the
// point is the target plus the scaled vector. The rotation is the NJ
// matrix_rotation_y: x' = x cos + z sin, z' = z cos - x sin (ASSUMED convention).
export function flankPoint(target: AiTarget, self: { x: number; z: number }, flankDist: number): { x: number; z: number } {
  const vx = target.x - self.x;
  const vz = target.z - self.z;
  const d2 = vx * vx + vz * vz;
  const bearing = Math.atan2(vx, vz);
  const diff = Math.atan2(Math.sin((target.angle ?? 0) - bearing), Math.cos((target.angle ?? 0) - bearing));
  const sign = diff < 0 ? -1 : 1;
  const rot = sign * (Math.PI / 2);
  let rx = vx * Math.cos(rot) + vz * Math.sin(rot);
  let rz = vz * Math.cos(rot) - vx * Math.sin(rot);
  const m2 = flankDist * flankDist;
  if (d2 < m2 && d2 > 0) {
    const s = m2 / d2;
    rx *= s;
    rz *= s;
  }
  return { x: target.x + rx, z: target.z + rz };
}

type Phase = 'charge' | 'fly' | 'land';

// The Goran brain: the Booma substrate (EnemyAi) plus the warp roll of state 3 and
// the leap (state 10). The warp is off when `warp` is null (no BattleParams rows).
// Only 'notice' and 'chase' roll (state 3); the leap owns 'warp' until it lands.
export class GoranAi extends EnemyAi {
  private readonly warp: GoranWarpRow | null;
  private readonly initdata3: number;
  private readonly rng: () => number;
  private readonly reachAndRadius: number;
  private flight: { phase: Phase; dx: number; dz: number; counter: number } | null = null;

  constructor(
    opts: ConstructorParameters<typeof EnemyAi>[0] & {
      warp: GoranWarpRow | null;
      initdata3: number;
      rng: () => number;
      attack: EnemyAttackData | null;
    },
  ) {
    super(opts);
    this.warp = opts.warp;
    this.initdata3 = opts.initdata3;
    this.rng = opts.rng;
    this.reachAndRadius = (opts.attack && opts.attack.distanceX > 0 ? opts.attack.distanceX : 0) + opts.radius;
  }

  get inLeap(): boolean {
    return this.flight !== null;
  }

  override tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    if (this.state === 'dead') return super.tick(targets, animationEnded);
    if (this.flight) return this.tickLeap(targets);
    if ((this.state === 'notice' || this.state === 'chase') && this.warp) {
      const target = this.targetId === null ? undefined : targets.find((t) => t.clientId === this.targetId && !t.dead);
      if (target && this.warpFires(target)) {
        this.startLeap(target);
        return this.frame();
      }
    }
    return super.tick(targets, animationEnded);
  }

  // The gate of state 3, in the exe's order (the roll only after target and gate a.).
  private warpFires(target: AiTarget): boolean {
    const row = this.warp!;
    if (this.rng() >= warpChance(this.initdata3)) return false;
    const vx = target.x - this.x;
    const vz = target.z - this.z;
    const d2 = vx * vx + vz * vz;
    if (d2 < row.minDist * row.minDist || d2 > GORAN_WARP.maxDistSq) return false;
    const bearing = toBams(Math.atan2(vx, vz));
    const heading = toBams(target.angle ?? 0);
    return bamsDifference(heading, bearing) <= warpToleranceBams(row.toleranceDeg);
  }

  // hit_goran_enemy_with_projectile (0x005acb10): the flank point, the launch
  // direction, the leap's state 10 and sub-state 0.
  private startLeap(target: AiTarget): void {
    const row = this.warp!;
    const dest = flankPoint(target, this, row.flankDist);
    const dx = dest.x - this.x;
    const dz = dest.z - this.z;
    const len = Math.hypot(dx, dz) || 1;
    this.flight = { phase: 'charge', dx: dx / len, dz: dz / len, counter: row.counter };
    this.state = 'warp';
    this.targetId = target.clientId;
  }

  // The state 10 body (0x005acb8c) per tick.
  private tickLeap(targets: readonly AiTarget[]): AiFrame {
    const out = this.frame();
    const f = this.flight!;
    const row = this.warp!;
    const target = this.targetId === null ? undefined : targets.find((t) => t.clientId === this.targetId && !t.dead);
    if (f.phase === 'charge') {
      // Sub 0: the counter is loaded and the timer runs (one tick, ASSUMED).
      f.counter = row.counter;
      f.phase = 'fly';
      return out;
    }
    if (f.phase === 'fly') {
      if (target) this.angle = Math.atan2(target.x - this.x, target.z - this.z);
      this.x += f.dx * row.speed;
      this.z += f.dz * row.speed;
      let land = false;
      if (target) {
        const d2 = (target.x - this.x) ** 2 + (target.z - this.z) ** 2;
        land = d2 < row.speed;
      }
      f.counter -= 1;
      if (land || f.counter < 0) {
        f.counter = 0;
        f.phase = 'land';
      }
      out.x = this.x;
      out.z = this.z;
      out.angle = this.angle;
      return out;
    }
    // Sub 2: the landing contact (ASSUMED one contact hit in reach), then the chase.
    if (target && Math.hypot(target.x - this.x, target.z - this.z) <= this.reachAndRadius) {
      out.hit = { clientId: target.clientId, knockback: ATTACK_KNOCKBACK, mult: ATTACK_DAMAGE_MULT };
    }
    this.flight = null;
    this.state = 'chase';
    this.chaseTicks = 0;
    out.x = this.x;
    out.z = this.z;
    out.angle = this.angle;
    return out;
  }

  private frame(): AiFrame {
    return { motion: null, x: this.x, z: this.z, angle: this.angle, hit: null };
  }

  override onDamage(clientId: number): void {
    // The leap goes on through a hit (ASSUMED: the flinch does not end the sub-states).
    if (this.flight) {
      this.targetId = clientId;
      return;
    }
    super.onDamage(clientId);
  }

  override resume(): ReturnType<EnemyAi['resume']> {
    if (this.flight) return this.state;
    return super.resume();
  }

  override kill(): void {
    this.flight = null;
    super.kill();
  }
}

// The warp row of one subtype: `movement` is MovementData[17 + subtype] and the two
// distances are AttackData[17 + subtype].distanceX and AttackData[20 + subtype].distanceX
// (render/combat.ts reads them; null when the table is not loaded).
export function goranWarpRow(movement: EnemyMovementData | null, minDist: number | undefined, flankDist: number | undefined): GoranWarpRow | null {
  if (!movement || minDist === undefined || flankDist === undefined) return null;
  return {
    speed: movement.fparam6,
    toleranceDeg: movement.iparam[0],
    counter: movement.iparam[1],
    minDist,
    flankDist,
  };
}

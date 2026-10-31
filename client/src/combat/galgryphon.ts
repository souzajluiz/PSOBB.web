// The Gal Gryphon's minion throw (PsoBB.exe, Ephinea 1.25.13, addresses are VAs).
//
// The thrown object is the 0x70-byte launcher CreateGalgryphonMinion_004aa808
// (dump 228848). The Gryphon makes it in the S7 handler (HandleOlgaMinionAction_004a1678,
// dump 223944; the docs call it S7, docs/bosses/galgryphon-states-a.md) at the
// animation time 20.5 (sub-phase 1, the "shot / beam" state), not at 22.0: the 22.0
// event of HandleGalgryhonState_004a5eec (dump 225636, S31 kakuin / beam) makes a
// 0x130-byte particle ring (CreateGalgryphonMinion_004aabd8, dump 229084), with no
// minion in it. Both dump names are from the Ghidra pass; the state numbers are the
// docs' ProcessState table (0x009a7e40).
//
// The launcher (UpdateGalgryphonMinionEffect_004aa968, dump 228908) flies a quadratic
// Bezier curve, then creates the homing minion Effect (galgryphonminion.ts) and ends.
// The attack dispatch DispatchGalGryphonAttackEffect_004a8690 (dump 227054) only builds
// the parameters of DispatchSinowberillAttackEffect_0051fc9c; it is not an update.
//
// The S7 handler that calls throw() is galgryphonstatesa.ts (s7), reached from the
// brain (galgryphonai.ts) wired in render/combat.ts. Not ported here: the launcher's
// particles and sounds (0x3ad, the frustum particle sets), and the attack
// effect's area hit (0x0051fc9c). ASSUMED items are marked below.

import type { Icon } from '../classic/minimap.ts';
import type { GroundFn } from './techfire.ts';
import { GalgryphonMinionEffect, type GalgryphonPlayer } from './galgryphonminion.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const GALMINION_LAUNCH = {
  // 0x00904468 (exe, tools/exedata.py: 0.07): the distance from the launch point to the
  // target scales the flight's frame count (CreateGalgryphonMinion_004aa808).
  durationScale: 0.07,
  // The frame count is ROUND(scale * distance); a count below 31 (0x1f) becomes 30 (0x1e).
  minDuration: 30,
  // The target's point is lifted to 5.0 (0x40a00000) for the curve's last control point.
  apexY: 5,
} as const;

export const GALMINION_LAUNCH_STATE = { init: 0, fly: 1, effect: 2, done: 3 } as const;

/**
 * The Bezier point of the three control points at t (InterpolateMinionEffectPosition_007be6b8,
 * dump 806436, called with order 3 and the flag 0). ASSUMED: the flag-0 branch is the
 * Bernstein sum C(2, i) t^i (1 - t)^(2 - i) P_i; the decompile's float chain is not read
 * term by term. t may exceed 1 (the exe's last tick does: timer = duration + 1).
 */
export function minionBezier(p: readonly [Vec3, Vec3, Vec3], t: number): Vec3 {
  const u = 1 - t;
  const b0 = u * u;
  const b1 = 2 * u * t;
  const b2 = t * t;
  return {
    x: b0 * p[0].x + b1 * p[1].x + b2 * p[2].x,
    y: b0 * p[0].y + b1 * p[1].y + b2 * p[2].y,
    z: b0 * p[0].z + b1 * p[1].z + b2 * p[2].z,
  };
}

/** The launcher's frame count for a launch point and a target point (the target's y is 0 in the exe). */
export function minionFlightFrames(origin: Vec3, target: { x: number; z: number }): number {
  const dx = origin.x - target.x;
  const dy = origin.y;
  const dz = origin.z - target.z;
  const n = Math.round(GALMINION_LAUNCH.durationScale * Math.hypot(dx, dy, dz));
  return n < 31 ? GALMINION_LAUNCH.minDuration : n;
}

export class GalgryphonMinionLauncher {
  /** +0x1c */
  state: number = GALMINION_LAUNCH_STATE.init;
  /** +0x20 */
  timer = 0;
  /** +0x24: the flight's frame count. */
  readonly duration: number;
  /** +0x28: the target player's slot (0xffff = none). */
  readonly slot: number;
  /** +0x40 / +0x50 / +0x60: the control points (origin, origin + offset, the target lifted to apexY). */
  readonly points: [Vec3, Vec3, Vec3];
  /** +0x2c: the current position. */
  pos: Vec3;
  /** +0x8: the dead bit, set once the Effect is created. */
  dead = false;

  private constructor(points: [Vec3, Vec3, Vec3], duration: number, slot: number) {
    this.points = points;
    this.duration = duration;
    this.slot = slot;
    this.pos = { ...points[0] };
  }

  /**
   * CreateGalgryphonMinion_004aa808: origin = this+0x44c, offset = the (150 sin, -(h - c) / 2, 150 cos)
   * vector (the caller's local_38), target = (+0x39c, 0, +0x3a4). Control point 1 is origin + offset,
   * control point 2 is the target with y = apexY.
   */
  static create(origin: Vec3, offset: Vec3, target: { x: number; z: number }, slot: number): GalgryphonMinionLauncher {
    const points: [Vec3, Vec3, Vec3] = [
      { ...origin },
      { x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + offset.z },
      { x: target.x, y: GALMINION_LAUNCH.apexY, z: target.z },
    ];
    return new GalgryphonMinionLauncher(points, minionFlightFrames(origin, target), slot);
  }

  /**
   * One tick of UpdateGalgryphonMinionEffect_004aa968. Returns the minion Effect on the tick it is
   * made (state 2), else null. ASSUMED: the Effect is updated from the next tick on.
   */
  update(ground: GroundFn): GalgryphonMinionEffect | null {
    if (this.dead) return null;
    // State 0 only leaves to fly; the exe falls through into the fly code on the same tick
    // (UpdateGalgryphonMinionEffect_004aa968: je 0x4aaae6 sets 1 and jmp 0x4aaa4d, the state-1 code).
    if (this.state === GALMINION_LAUNCH_STATE.init) this.state = GALMINION_LAUNCH_STATE.fly;
    if (this.state === GALMINION_LAUNCH_STATE.fly) {
      // The position is sampled first (t = timer / duration), then the end test, then the timer
      // goes up: the tick after the duration ends samples t > 1 and is the one that ends.
      this.pos = minionBezier(this.points, this.timer / this.duration);
      if (this.duration < this.timer) {
        this.timer = 0;
        this.state = GALMINION_LAUNCH_STATE.effect;
        return null;
      }
      this.timer++;
      return null;
    }
    if (this.state === GALMINION_LAUNCH_STATE.effect) {
      // The exe's sound 0x3ad and particles are not ported.
      const effect = GalgryphonMinionEffect.create(ground, this.pos.x, this.pos.z, this.slot);
      this.state = GALMINION_LAUNCH_STATE.done;
      this.dead = true;
      return effect;
    }
    return null;
  }
}

/**
 * The minions in flight and the minion Effects of one Gal Gryphon fight. The brain's S7 handler
 * (galgryphonstatesa.ts) calls throw() once per S7 run; render/combat.ts owns the manager.
 */
export class GalgryphonMinionManager {
  private launchers: GalgryphonMinionLauncher[] = [];
  private effects: GalgryphonMinionEffect[] = [];

  /** Whether any launcher or Effect is alive (the caller skips the tick when not). */
  get active(): boolean {
    return this.launchers.length > 0 || this.effects.length > 0;
  }

  /** The launcher made by the S7 handler at its animation time 20.5 (origin = this+0x44c). */
  throw(origin: Vec3, offset: Vec3, target: { x: number; z: number }, slot: number): GalgryphonMinionLauncher {
    const l = GalgryphonMinionLauncher.create(origin, offset, target, slot);
    this.launchers.push(l);
    return l;
  }

  /** One game tick: the launchers (which make the Effects), then the Effects (which home on the party). */
  update(players: readonly GalgryphonPlayer[], ground: GroundFn, attack?: (at: Vec3) => void): void {
    const made: GalgryphonMinionEffect[] = [];
    for (const l of this.launchers) {
      const e = l.update(ground);
      if (e) made.push(e);
    }
    this.launchers = this.launchers.filter((l) => !l.dead);
    for (const e of this.effects) e.update(players, attack);
    this.effects = this.effects.filter((e) => !e.dead);
    this.effects.push(...made);
  }

  /** The forced 1.5 icons of the Effects (the Effects draw them in state 1). */
  minimapIcons(): Icon[] {
    const out: Icon[] = [];
    for (const e of this.effects) out.push(...e.minimapIcons());
    return out;
  }

  clear(): void {
    this.launchers = [];
    this.effects = [];
  }
}

/**
 * The parameters DispatchGalGryphonAttackEffect_004a8690 passes to DispatchSinowberillAttackEffect_0051fc9c
 * (dump 227054): {g_GalgryphonBaseEffectIntensity, the speed of animation row 2 (field2_0x8), 15.0,
 * 10.0, uint32 0x00903990 (= 1)}. The value of the intensity global has no writer in the dump
 * (ASSUMED: the caller passes it; the area hit it feeds is not ported).
 */
export function galgryphonAttackParams(intensity: number, speed: number): [number, number, number, number, number] {
  return [intensity, speed, 15, 10, 1];
}

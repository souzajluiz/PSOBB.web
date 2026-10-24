// The Gal Gryphon's hook bodies (PsoBB.exe, Ephinea 1.25.13, addresses are VAs), as pure
// functions. They are the GalgryphonFxB hooks of galgryphonstatesb.ts, made testable: each
// function takes its inputs (the ground probe's answer, the random value, the points) and
// returns what the exe would do (an effect, a sound, a burst, a point list), so the brain
// that wires them into render/combat.ts can call them with its own world.
//
// Sources: the Ephinea Ghidra dump (reverse/refsrc/original-psobb-client-source/src/
// Psobb.exe-05112026.c, "dump N" below is a line there) for the shape and the calls; the
// disassembly (objdump of PsoBB.exe) for the operands and the rounding; tools/exedata.py
// for the constants. The dump's function names are not all right (see the premise notes).
//
// Premise corrections (the brief said otherwise; the exe says this):
//  - 0x004a47a8 is NOT an attack dispatch. It is a threshold dispatch (UpdateOlgaMinionState_004a47a8,
//    dump 224813): four frame-event tests on the floats at 0x00a475c4 / c8 / cc / d0, and the first one
//    that crosses calls one of the minion handlers 0x004a121c, 0x004a115c, 0x004a109c or 0x004a0fdc.
//    Its only caller is the S21 frame (0x004a4527). See minionThresholdDispatch.
//  - The attack that the brief names (DispatchGalGryphonAttackEffect_004a8690) is called from the
//    homing minion's update (UpdateGalgryphonMinion_004ab283, its call at 0x004ab39e, dump 229617), each
//    tick. It is not called from S21. See galgryphonAttackBurst.
//
// Not ported here (named for the wiring step): the minion's particle objects (create_particle_effect),
// the sounds' positions, the lightning's jitter (create_jitter_values_for_points), the S27 beam's
// spawn body (SpawnOlgaMinionEffect_004a5218, dump 225179), and the vtable bodies of the Derolle object
// that DispatchSinowberillAttackEffect_0051fc9c calls (+0x30 / +0x34). ASSUMED items are marked below.
//
// Run: node tests/galgryphonfx.test.ts

import { DrlBurst } from './derolle.ts';
import type { ShotEffect, ShotLook } from './enemyshots.ts';
import { galgryphonAttackParams } from './galgryphon.ts';
import { bamsCos, bamsSin, galRoundB } from './galgryphonstatesb.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** What unknown_get_ground_info(pos, 0x16ef) returns, reduced to the object's height. */
export interface GroundHit {
  y: number;
}

// ---- constants (each names its exe address; the value is read with tools/exedata.py) ----

export const GALFX = {
  /** The flag of every ground probe in this file (unknown_get_ground_info(pos, 0x16ef)). */
  groundFlag: 0x16ef,
  /** 0x00903ae0 = 6.0: a ground hit above this is no landing (the S18 / S30 / lightning clamp). */
  groundLimit: 6.0,
  /** 0x00039b: the probe's sound (play_directional_sound_effect(0x39b, this+0x568)). */
  sfxProbe: 0x39b,
  /** The particle flag the probe's effect is made with (create_particle_effect_3(..., 0x40)). */
  particleFlag: 0x40,
} as const;

/** The S27 beam value (SpawnGalgryphonBeam, dump 224954 / disassembly 0x004a4dd5..0x004a4e7b). */
export const GALFX_S27 = {
  /** 0x00903a88 = 0.0: the bias (indexed by the sign bit of the 16-bit random, always 0 here). */
  bias: 0.0,
  /** 0x00903d20 = 65536.0 (the dump's g_GalgryphonMinionEffectScaleDivisor). */
  divisor: 65536.0,
  /** 0x00903d1c = 4.0 (the dump's g_GalgryphonMinionEffectScaleFactor). */
  scale: 4.0,
  /** The beam every this many ticks (m % 20 == 0, the counter m at +0x6ec). */
  period: 20,
  /** The under-body projectile transform's value, 0x42700000 = 60.0 (the S27 frame, P > 1). */
  transformValue: 60.0,
} as const;

/** The lightning arc (CreateGalgryphonLightningEffect_004a9869, dump 228056) and the beam object (0x004a9de0). */
export const GALFX_LIGHTNING = {
  /** 0x009043b0 = 16.0: the arc's point spacing (ROUND(length / 16) + 1 points). */
  pointScale: 16.0,
  /** The point count's clamp (0x0c -> 0x0d, and 2 at least). */
  minPoints: 2,
  maxPoints: 13,
  /** 0x0090440c = 5.0: the beam's offset radius (the X and Z offsets are sin / cos of the angle times this). */
  beamRadius: 5.0,
  /** 0x0090441c = 12.0: the beam's height above the clamped ground. */
  beamYOffset: 12.0,
} as const;

/** The S30 dive beam (CreateGalgryphonLightningBeamEffectObject_004aa4ec, dump 228700; the call at 225540). */
export const GALFX_DIVE_BEAM = {
  /** The call's start frame (param_4 = 0x28) and its length (param_5 = 0x11): the object's +0x98 / +0x9c frames. */
  start: 40,
  length: 17,
  /** The constructor's argument 0x41a00000 = 20.0 (CreateGalgryphonMinion_004a95d8). */
  constructorArg: 20.0,
} as const;

/** The minion ring (CreateGalgryphonMinion_004aabd8, dump 229084; the particle update 0x004aade4, dump 229207). */
export const GALFX_RING = {
  /** 0x00904488 = 7.0: the ring radius per tick of the spawn state (radius = counter * 7). */
  radiusStep: 7.0,
  /** 0x00904480 = 10.0: the outer particle ring's offset from the inner one. */
  outerOffset: 10.0,
  /** 0x00904484 = 1.0, 0x00904494 = 30.0, 0x00904490 = 1.0: the attack's speed factor (30 - counter) * 1 / 30 + 1. */
  speedStep: 1.0,
  speedDivisor: 30.0,
  speedBase: 1.0,
  /** 32 particle slots, one turn divided into 32 (the angle k * 0x800 BAMS). */
  slots: 32,
  bamsStep: 0x800,
  /** The spawn state runs 31 ticks (counter 0..30), then the fade state (counter 0..30, dead past 30). */
  spawnFrames: 31,
  lastFrame: 30,
  /** 0x40000000 = 2.0: the ring's y, which the constructor writes over its y argument. */
  y: 2.0,
} as const;

/** The Sinowberill dispatch's constants (DispatchSinowberillAttackEffect_0051fc9c, dump 303366). */
export const GALFX_AREA = {
  /** FLOAT_100_ (the dump's name; 100.0): the threshold between the two Derolle vtable calls. */
  longRangeAbove: 100.0,
  /** The look of an attack burst (ASSUMED: the minion's icon colour 0xffa24c; the drawn size is not decoded). */
  color: 0xffa24c,
  size: 3,
} as const;

// ---- the threshold dispatch (0x004a47a8) ----

/** The handler the threshold dispatch calls (the four minion handlers of dump 223409..223576). */
export type MinionHandler = 'state1' | 'state2' | 'state3' | 'init';

/**
 * UpdateOlgaMinionState_004a47a8 (dump 224813): test the frame events in order and call the first
 * handler that crosses. `crossed(i)` is the exe's check_entity_animation_elapsed_threshold on the float
 * at 0x00a475c4 (i = 0), 0x00a475c8 (1), 0x00a475cc (2), 0x00a475d0 (3); the tests run lazily and in
 * this order, as the exe does (a crossing test may keep state, so the later ones are not tested after a hit).
 * The values of those floats are runtime values (no writer in the exe image): the caller passes them.
 */
export function minionThresholdDispatch(crossed: (i: 0 | 1 | 2 | 3) => boolean): MinionHandler | null {
  if (crossed(0)) return 'state1';
  if (crossed(1)) return 'state2';
  if (crossed(2)) return 'state3';
  if (crossed(3)) return 'init';
  return null;
}

// ---- the ground probe (0x004a15fc) and the S33 stage-1 probe (0x004a1a48) ----

export type GroundProbeOutcome = { effect: Vec3; sfx: number } | null;

/**
 * OlgaMinionSpawnEffect_004a15fc (dump 223918), the Gal Gryphon's ground probe at the boss's
 * position. `hit` is unknown_get_ground_info(pos, 0x16ef)'s object (null: no ground). A hit above
 * the limit is no landing; otherwise the effect is made at the hit's height and the sound 0x39b plays.
 */
export function groundProbe(pos: Vec3, hit: GroundHit | null): GroundProbeOutcome {
  if (hit === null) return null;
  if (GALFX.groundLimit < hit.y) return null;
  return { effect: { x: pos.x, y: hit.y, z: pos.z }, sfx: GALFX.sfxProbe };
}

/**
 * OlgaMinionCheckSpawnEffect_004a1a48 (dump 224063), the S33 stage-1 probe: the probe runs when the
 * frame event 14.0 is crossed (check_entity_animation_elapsed_threshold(14.0)); otherwise nothing.
 */
export function s33StageOneProbe(crossed14: boolean, probe: () => GroundProbeOutcome): GroundProbeOutcome {
  return crossed14 ? probe() : null;
}

// ---- the area hit (0x004a8690 and 0x0051fc9c) ----

/**
 * The five-word context DispatchSinowberillAttackEffect_0051fc9c takes: [group / intensity, speed,
 * radius, 10 or 20, the flag or the second parameter]. The first, second and last words are the
 * callers' (see the builders below).
 */
export type AreaContext = readonly [number, number, number, number, number];

/**
 * DispatchSinowberillAttackEffect_0051fc9c (dump 303366): the context's float at +8 selects the
 * Derolle vtable call, +0x30 when it is above 100.0 (the call takes the float too), else +0x34.
 * Returns which branch the exe takes.
 */
export function sinowberillBranch(ctx: AreaContext): 'x30' | 'x34' {
  return ctx[2] > GALFX_AREA.longRangeAbove ? 'x30' : 'x34';
}

/**
 * The area hit as a burst: the radius is the context's +8 float and the power is the first word.
 * ASSUMED: the Derolle vtable bodies (+0x30 / +0x34) are not decoded, so reading the +8 float as the
 * radius, the intensity as the power and the look are the port's guesses; the branch is exact.
 */
export function sinowberillBurst(point: Vec3, ctx: AreaContext, only: readonly number[] | null = null): DrlBurst {
  const effect: ShotEffect = { kind: 'tech', power: Math.max(0, ctx[0]) };
  const look: ShotLook = { color: GALFX_AREA.color, size: GALFX_AREA.size };
  return new DrlBurst(point.x, point.y, point.z, ctx[2], effect, look, only);
}

/**
 * DispatchGalGryphonAttackEffect_004a8690 (dump 227054), called from the homing minion each tick
 * (dump 229617): the context is galgryphonAttackParams(intensity, speed) (galgryphon.ts) and the
 * burst is at the minion's position.
 */
export function galgryphonAttackBurst(point: Vec3, intensity: number, speed: number, only: readonly number[] | null = null): DrlBurst {
  const p = galgryphonAttackParams(intensity, speed);
  return sinowberillBurst(point, p, only);
}

/**
 * DispatchGalGryphonAttackEffectVariant_004a86e0 (dump 227070), called from the minion ring each
 * tick (dump 229600): [variant, speed0 * factor, radius, 10.0, variantParam2]. The third word is the
 * ring's radius; the 10.0 is 0x41200000 (dump 227075).
 */
export function galgryphonVariantContext(variant: number, variantParam2: number, speed0: number, factor: number, radius: number): AreaContext {
  return [variant, speed0 * factor, radius, 10.0, variantParam2];
}

/**
 * UpdateOlgaMinionAnimationTransform_004a51c0 (dump 225140), the S27 projectile transform and the
 * S30 beam's minion transform: the context is [transformParam1, speed3, value, 20.0, transformParam2]
 * (0x41a00000 = 20.0 at dump 225146).
 */
export function galgryphonTransformContext(param1: number, speed3: number, value: number, param2: number): AreaContext {
  return [param1, speed3, value, 20.0, param2];
}

// ---- the spawn ring (0x004a9174) ----

/**
 * UpdateEnemyPositionAndRotation_004a9174 (dump 227626): the object's y rotation is the heading and
 * its anchor point (the field at +0xac, transformed) is translate(pos) * rotY(heading) * local.
 * The rotation is matrix_rotation_y (0x0082d8bc): x' = cos x + sin z, z' = -sin x + cos z, the
 * angle in BAMS (the same convention as darkfalzcamera.ts).
 */
export function ringAnchor(pos: Vec3, heading: number, local: Vec3): Vec3 {
  const s = bamsSin(heading);
  const c = bamsCos(heading);
  return {
    x: c * local.x + s * local.z + pos.x,
    y: local.y + pos.y,
    z: -s * local.x + c * local.z + pos.z,
  };
}

/** The hitboxes of the spawn ring: each gets its bit 1 (DisableGalgryphonMinions_004a91fc clears it). */
export function activateHitboxes(flags: readonly number[]): number[] {
  return flags.map((f) => (f | 1) >>> 0);
}

// ---- the S27 lightning (0x004a9de0, 0x004a9869, 0x0073d160) and the S27 beam value ----

/**
 * CreateGalgryphonLightningBeamObject_004a9de0 (dump 228345): the beam's height is the ground's
 * height clamped to 6.0 (no ground: 6.0), plus 12.0. The constructor (CreateGalgryphonLightningBeam_004a9ec4,
 * dump 228375) puts the X and Z offsets at sin / cos of the angle times 5.0 (the angle is the heading in BAMS: ASSUMED).
 */
export function lightningBeamPlacement(pos: Vec3, ground: GroundHit | null, angle: number): { pos: Vec3; offsetX: number; offsetZ: number } {
  const groundY = ground === null ? GALFX.groundLimit : Math.min(ground.y, GALFX.groundLimit);
  return {
    pos: { x: pos.x, y: groundY + GALFX_LIGHTNING.beamYOffset, z: pos.z },
    offsetX: bamsSin(angle) * GALFX_LIGHTNING.beamRadius,
    offsetZ: bamsCos(angle) * GALFX_LIGHTNING.beamRadius,
  };
}

/** The arc's point count for a length: ROUND(length / 16) + 1, at least 2 and at most 13 (dump 228056). */
export function lightningPointCount(length: number): number {
  const n = galRoundB(length / GALFX_LIGHTNING.pointScale) + 1;
  return Math.min(GALFX_LIGHTNING.maxPoints, Math.max(GALFX_LIGHTNING.minPoints, n));
}

/** The length of the polyline through the points (the arc's some_magnitude, the sum of the segments). */
export function polylineLength(points: readonly Vec3[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    sum += Math.hypot(points[i]!.x - points[i + 1]!.x, points[i]!.y - points[i + 1]!.y, points[i]!.z - points[i + 1]!.z);
  }
  return sum;
}

/**
 * The arc of CreateGalgryphonLightningEffect_004a9869 before its jitter: the ends are the curve at tu and
 * tv; the count comes from their distance; the points are the curve at i / (n - 1) * (tv - tu) + tu.
 * `curve` stands for InterpolateMinionEffectPosition_007be6b8 (ASSUMED to be the caller's curve).
 * The jitter (create_jitter_values_for_points) is not ported.
 */
export function lightningArc(curve: (t: number) => Vec3, tu: number, tv: number): { points: Vec3[]; length: number } {
  const a = curve(tu);
  const b = curve(tv);
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const n = lightningPointCount(length);
  const points: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    points.push(curve((i / (n - 1)) * (tv - tu) + tu));
  }
  return { points, length: polylineLength(points) };
}

/**
 * The S27 beam's value: the 16-bit random r (get_random_int >> 16) goes to
 * trunc(((r + bias) / divisor) * scale). The truncation is the exe's x87 control word (0xc00,
 * round toward zero, the fistp), not the ROUND of the dump, so the result is 0..3.
 */
export function s27BeamValue(rand16: number): number {
  return Math.trunc(((rand16 + GALFX_S27.bias) / GALFX_S27.divisor) * GALFX_S27.scale);
}

/**
 * The S27 beam's flag and value at the counter m (+0x6ec): only on m % 20 == 0; the flag is
 * (m / 20) & 1 == 0 (the exe's `iVar1 / 0x14 & 1`). Returns null on the other ticks.
 */
export function s27Beam(m: number, rand16: () => number): { flag: boolean; value: number } | null {
  if (m % GALFX_S27.period !== 0) return null;
  const k = Math.trunc(m / GALFX_S27.period);
  return { flag: (k & 1) === 0, value: s27BeamValue(rand16()) };
}

/** 0x0073d160: the release sets bit 0 of the u16 at +8 (the delete flag). */
export function markForDestruction(flags16: number): number {
  return (flags16 | 1) & 0xffff;
}

// ---- the S30 dive beam (0x004aa4b0 / 0x004aa4ec) ----

/**
 * The S30 beam's three points. P0 is the start point `from` (the boss's point 50 ahead and 50 up);
 * P2 is the target `to` with its height the ground's clamped to 6.0 (no ground: 6.0); P1 is the
 * decompile's triple (to.x, from.y, to.z). ASSUMED: the wrapper's local triple is read as the dump
 * shows it (the middle point takes from's height); the disassembly was not checked term by term.
 * The object runs from frame 40 to frame 57 (the call's 0x28 and 0x11).
 */
export function diveBeamPoints(from: Vec3, to: Vec3, ground: GroundHit | null): { points: [Vec3, Vec3, Vec3]; start: number; end: number } {
  const groundY = ground === null ? GALFX.groundLimit : Math.min(ground.y, GALFX.groundLimit);
  return {
    points: [
      { x: from.x, y: from.y, z: from.z },
      { x: to.x, y: from.y, z: to.z },
      { x: to.x, y: groundY, z: to.z },
    ],
    start: GALFX_DIVE_BEAM.start,
    end: GALFX_DIVE_BEAM.start + GALFX_DIVE_BEAM.length,
  };
}

// ---- the minion ring (0x004aabd8 and the particle update 0x004aade4) ----

/** The ring's state at its spawn: the position is the midpoint (the caller's) and y is 2.0. */
export function minionRingSpawn(mid: { x: number; z: number }): Vec3 {
  return { x: mid.x, y: GALFX_RING.y, z: mid.z };
}

export interface RingSlot {
  primary: { x: number; z: number };
  outer: { x: number; z: number };
}

export interface RingTick {
  /** 0 spawning, 1 fading. */
  state: 0 | 1;
  /** The counter after this tick (+0x12c). */
  counter: number;
  /** The ring's dead bit (flags |= 1), set once the fade passes its last frame. */
  dead: boolean;
  /** The area hit of this tick (state 0 only): the variant context, to pass to sinowberillBurst. */
  attack: AreaContext | null;
  /** The 32 particle slots (state 0 only; the fade turns the particles off). */
  slots: RingSlot[] | null;
}

/**
 * One tick of the minion ring (UpdateGalgryphonMinionParticles_004aade4, dump 229207). State 0 places
 * the 32 slots on the ring of radius counter * 7 (the outer ring is 10 further), and makes the area
 * hit with radius counter * 7; after 31 ticks it goes to state 1, which turns the slots off and
 * marks the ring dead after 31 more. The centre is the ring's (+0x120, +0x128).
 */
export function minionRingTick(
  state: 0 | 1,
  counter: number,
  centre: { x: number; z: number },
  opts: { speed0: number; variant: number; variantParam2: number },
): RingTick {
  if (state === 0) {
    const r = counter * GALFX_RING.radiusStep;
    const factor = ((GALFX_RING.lastFrame - counter) * GALFX_RING.speedStep) / GALFX_RING.speedDivisor + GALFX_RING.speedBase;
    const attack = galgryphonVariantContext(opts.variant, opts.variantParam2, opts.speed0, factor, r);
    const slots: RingSlot[] = [];
    for (let k = 0; k < GALFX_RING.slots; k++) {
      const a = k * GALFX_RING.bamsStep;
      const s = bamsSin(a);
      const c = bamsCos(a);
      const ro = r + GALFX_RING.outerOffset;
      slots.push({
        primary: { x: s * r + centre.x, z: c * r + centre.z },
        outer: { x: s * ro + centre.x, z: c * ro + centre.z },
      });
    }
    if (counter + 1 < GALFX_RING.spawnFrames) {
      return { state: 0, counter: counter + 1, dead: false, attack, slots };
    }
    return { state: 1, counter: 0, dead: false, attack, slots };
  }
  const next = counter + 1;
  return { state: 1, counter: next, dead: next > GALFX_RING.lastFrame, attack: null, slots: null };
}

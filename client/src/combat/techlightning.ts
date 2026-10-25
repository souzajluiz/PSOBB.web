// The visual objects, motion and hit tests of the Zonde family (Zonde, Gizonde,
// Razonde), Grants, Megid and the support techniques, plus the Shock / Thunder
// and Storm / Tempest weapon specials that reuse the Zonde bolt, as PsoBB.exe
// (Ephinea 1.25.13, addresses are VAs) builds them. Pure data and rules: no
// three.js here. render/techlightning.ts draws the bolts and the models,
// render/combat.ts runs the objects and applies the damage the existing way
// (combat/techniques.ts techDamage / megidChance, combat/buffs.ts).
//
// unknown_cast_tech (0x006e0770 area, called by the 6x48 handler for every
// client): what each technique creates, and when it creates nothing:
//   - Zonde, Gizonde, Grants need the 6x47 target list (an empty list creates
//     nothing: they have no "fire ahead" fallback, unlike Foie / Megid);
//   - Razonde, Deband, Jellen, Zalure, Shifta, Resta, Anti take no target;
//   - Megid with no target flies along the caster's heading (create_megid1),
//     with one it flies at the target's hit box (create_megid);
//   - the attack techniques create nothing on a city map (Pioneer 2, lobby).
// The creation point is unknown_get_tech_cast_location: the node of the
// weapon model data (+0x10 of GetWeaponModelData_006ac778), a hand. The web
// client has no weapon node: ASSUMED player position + 20 up (CAST_HEIGHT).
//
// Effect tier (AllocateEffectBuffer_006e1cec, the +0xc6 / +0x7a / +0xa6 field
// of every technique object): trunc(level / 5) for 1..5, else 0 (level is the
// 0-based level clamped to 0..30, so level 30 is tier 0 again). Sounds and
// looks differ per tier.
//
// The jagged bolt (GizondeVisualEffect_Constructor_006f3c22, used by Zonde,
// Gizonde, Razonde, the Shock / Storm specials, Gi Gue and the Jungle Tank
// trap; the same code draws the Galgryphon's lightning): 13 points on the
// segment start..start + dir * length (i * length / 12), the particle 0x1f0
// (zonde_ryuusi) made once at each. Per point a jitter direction: the
// dominant axis of dir picks which component is derived from the other two
// (create_jitter... see jitterDirection), range (rand - 0.5) * 2 * 10, then
// normalised; per inner point a jitter scale (rand - 0.5) * 2 * 8, the two
// ends 0. Every update (ProcessParticleEffect_006f4004): scale = max(scale -
// 0.05, 1.0) (0x0096e080, 0x0096e088), point = base + jitter * scale; the
// alpha (colour 0xff000000) holds for `hold` updates (0x14, Razonde 6) and
// then drops by 0x14 an update until it cannot, and the object ends once its
// counter passes 0x78. It is drawn as a screen-space ribbon: half width
// `thickness` (0.5 / 0.6 / 0.7 / 5.0, in world units at any distance: the
// strip's x extent is f * thickness / depth) and 1.8 times that vertically
// (0x0096e0c0), u 0..1 across, v + 1 per point, the texture entry 0 of
// technic_pt.xvm (ASSUMED, matched by content: the only lightning strand).

import { NO_ORIENT, orientOfDirection, type Orient } from '../classic/particles.ts';
import { EnemyShot, type ShotEffect, type ShotLook } from './enemyshots.ts';
import type { AiTarget } from './enemyai.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A random source in [0, 1) (the exe's rand() / 32768). */
export type Rng = () => number;

// ASSUMED: the weapon node (unknown_get_tech_cast_location) is 20 above the
// feet, like the specials' weapon position (combat/hitfx.ts).
export const CAST_HEIGHT = 20;

const TWO_PI_BAMS = (2 * Math.PI) / 0x10000;

/** AllocateEffectBuffer_006e1cec on the clamped level. */
export function effectTier(level: number): number {
  const l = level > 0x1d ? 0x1e : level < 1 ? 0 : Math.trunc(level);
  const q = Math.trunc(l / 5);
  return q >= 1 && q <= 5 ? q : 0;
}

// --- sounds -------------------------------------------------------------------
//
// play_directional_sound_effect(id, position, 0, 0) and then
// ProcessAudioCommand_00814664(voice, value, 0). ASSUMED unit of `value`: 1/256
// semitone (the engine turns it into (value / 3072 - 0.1222) * 4096, and 0.1222 is
// log2(44100 / 48000), the sample rate correction, so 3072 is an octave).
// "none" means ProcessAudioCommand is not called: the sample's own pitch.

/** Pitch by tier of the attack techniques: Zonde 0x8f, Gizonde 0x90, Razonde 0x91, Megid 0x92, Grants 0x93. */
export const TECH_PITCH: readonly number[] = [0x100, 0, -0x180, -0x180, -0x250, -0x100];
/** Pitch by tier of the support techniques (Resta 0x95, Anti 0x97, Shifta 0x9b, Jellen 0x9c, Deband 0x9d, Zalure 0x9e): tiers 0-1 / 2-3 / 4-5. */
export const SUPPORT_PITCH: readonly number[] = [0x100, 0x100, 0, 0, -0x100, -0x100];

export const SE = {
  zonde: 0x8f,
  gizonde: 0x90,
  razonde: 0x91,
  megid: 0x92,
  grants: 0x93,
  grantsEnd: 0x94, // PlaySoundEffectObject 0xf frames, at the end of the Grants
  resta: 0x95,
  anti: 0x97,
  reverser: 0x99,
  shifta: 0x9b,
  jellen: 0x9c,
  deband: 0x9d,
  zalure: 0x9e,
  megidHit: 0xb0,
  specialStart: 0x40, // the special attack's start (state 0x0069c4a0 case 2)
} as const;

export interface FxSound {
  id: number;
  at: Vec3;
  pitch: number;
}

/** play_directional_sound_effect + the tier's pitch command. */
export function techSound(id: number, at: Vec3, tier: number, support = false): FxSound {
  return { id, at, pitch: (support ? SUPPORT_PITCH : TECH_PITCH)[tier] ?? 0 };
}

/** The pitch as a playback rate (ASSUMED unit above). */
export function pitchRate(pitch: number): number {
  return 2 ** (pitch / 3072);
}

// The charge sound each technique starts with its cast light
// (InstantiateTechniqueEffect_006e104c, jump table 0x0096cc80; the sound object
// only for the local player): Foie / Gifoie / Rafoie 0xa3 (6e2cd8), Barta /
// Gibarta / Rabarta 0xa4 (6e77b0), the Zonde family 0xa5 (6f1cc8), Megid 0xa6
// (6e244c), Grants / Resta / Anti / Reverser 0xa7 (6e7fc8), Deband / Jellen /
// Zalure / Ryuker / Shifta 0xa2 (6ebb58). The sound object stops its voice when
// it ends, charge + 0x32 + cast frames after the start.
export const CHARGE_SE: readonly number[] = [
  0xa3, 0xa3, 0xa3, 0xa4, 0xa4, 0xa4, 0xa5, 0xa5, 0xa5, 0xa7, 0xa2, 0xa2, 0xa2, 0xa2, 0xa2, 0xa7, 0xa7, 0xa7, 0xa6,
];
export const CHARGE_SE_PADDING = 0x32;

/**
 * The cast light (TechniqueEffectObject_Constructor_006eb618): the caster's
 * light definition is moved toward {a, r, g, b} and back over the object's life
 * (UpdateLightDefinition_00794984 on the caster, 0x00a9d460 the base light).
 * The order is the exe's colour array (set_light_definition_for_entity reads
 * color[0] as diffuse_a, color[1..3] as r, g, b); castLightColor gives rgb.
 * Drawn by render/levelupfx.ts LevelUpEffects.castLight (the player's lit
 * materials, the same stand-in as the level-up light).
 */
export const CAST_LIGHT: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 1, 0.5, 0], [1, 1, 0.5, 0], [1, 1, 0.5, 0], // Foie, Gifoie, Rafoie
  [1, 1, 1, 1], [1, 1, 1, 1], [1, 0.3, 0.7, 1], // Barta, Gibarta, Rabarta
  [1, 1, 1, 0.3], [1, 1, 1, 0.3], [1, 1, 1, 0.3], // the Zonde family
  [1, 1, 1, 1], // Grants
  [1, 0.3, 0.9, 1], [1, 0.3, 0.9, 1], [1, 0.3, 0.9, 1], // Deband, Jellen, Zalure
  [1, 0.9, 0.3, 1], // Shifta
  [1, 0.3, 0.9, 1], // Ryuker
  [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], // Resta, Anti, Reverser
  [1, 0.6, 0.2, 0.7], // Megid
];

/** The cast light's rgb (the colour's a is the light's alpha, not used by the renderer). */
export function castLightColor(tech: number): [number, number, number] {
  const c = CAST_LIGHT[tech];
  if (!c) return [1, 1, 1];
  return [c[1], c[2], c[3]];
}

/** The cast light's ambient target (the constructor's +0x58, 0x3eb33333). */
export const CAST_LIGHT_AMBIENT = 0.35;

/** The cast light's frames: charge + 0x32 + cast (the charge sound's length too). */
export function castLightFrames(charge: number, cast: number): number {
  return charge + CHARGE_SE_PADDING + cast;
}

// --- the bolt ---------------------------------------------------------------------

export const BOLT_POINTS = 13;
export const BOLT_PARTICLE = 0x1f0; // zonde_ryuusi, rate 3, made once at each point
export const BOLT_HOLD = 0x14; // updates at full alpha (param_7 of the constructor)
export const BOLT_FADE_STEP = 0x14; // alpha lost an update after the hold (0x14000000)
export const BOLT_LAST = 0x78; // the object ends when its counter passes it
export const BOLT_JITTER_RANGE = 10; // 0x0096e0e4
export const BOLT_SCALE_RANGE = 8; // 0x0096e0e0
export const BOLT_SCALE_DECAY = 0.05; // 0x0096e080
export const BOLT_SCALE_FLOOR = 1; // 0x0096e088
export const BOLT_VERTICAL = 1.8; // 0x0096e0c0

/** get_dominant_axis (0x006f3c00 area): 0 x, 1 y, 2 z. */
export function dominantAxis(dx: number, dy: number, dz: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  if (ax <= ay) {
    if (az < ay) return 1;
  } else if (az < ax) return 0;
  return 2;
}

/**
 * One jitter direction (the constructor's loop, 0x006f3d40 area). The two
 * components that are not the dominant axis are random in +-10; the dominant
 * one is (second * other + first * other) / dir[axis] (NOT a perpendicular: the
 * exe adds, it does not negate), then the vector is normalised when it is not
 * zero. Consumes two random numbers.
 */
export function jitterDirection(dir: Vec3, axis: number, rng: Rng, out: Float32Array, o: number): void {
  const r = (): number => (rng() - 0.5) * 2 * BOLT_JITTER_RANGE;
  let x: number;
  let y: number;
  let z: number;
  if (axis === 0) {
    y = r();
    z = r();
    x = (z * dir.z + y * dir.y) * (1 / dir.x);
  } else if (axis === 1) {
    z = r();
    x = r();
    y = (x * dir.x + z * dir.z) * (1 / dir.y);
  } else {
    x = r();
    y = r();
    z = (y * dir.y + x * dir.x) * (1 / dir.z);
  }
  const len = Math.hypot(x, y, z);
  if (len !== 0 && Number.isFinite(len)) {
    x /= len;
    y /= len;
    z /= len;
  }
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
}

export class LightningBolt {
  readonly thickness: number;
  readonly hold: number;
  readonly length: number;
  /** The 13 points the particles are made at (start + dir * i * length / 12). */
  readonly base = new Float32Array(BOLT_POINTS * 3);
  readonly jitter = new Float32Array(BOLT_POINTS * 3);
  readonly scale = new Float32Array(BOLT_POINTS);
  /** The drawn points: base + jitter * scale, from the first update on. */
  readonly points = new Float32Array(BOLT_POINTS * 3);
  alpha = 255;
  counter = 0;
  /** +0x25e: set by the first update; the ribbon is drawn only then. */
  visible = false;
  done = false;

  /** `dir` is the unit direction (the exe normalises when the length is not 0). */
  constructor(start: Vec3, dir: Vec3, length: number, thickness: number, rng: Rng, hold = BOLT_HOLD) {
    this.thickness = thickness;
    this.hold = hold;
    this.length = length;
    for (let i = 0; i < BOLT_POINTS; i++) {
      const t = (i * length) / (BOLT_POINTS - 1);
      this.base[i * 3] = dir.x * t + start.x;
      this.base[i * 3 + 1] = dir.y * t + start.y;
      this.base[i * 3 + 2] = dir.z * t + start.z;
    }
    const axis = dominantAxis(dir.x, dir.y, dir.z);
    for (let i = 0; i < BOLT_POINTS; i++) jitterDirection(dir, axis, rng, this.jitter, i * 3);
    for (let i = 1; i < BOLT_POINTS - 1; i++) this.scale[i] = (rng() - 0.5) * 2 * BOLT_SCALE_RANGE;
  }

  /** One 30 Hz update (ProcessParticleEffect_006f4004). */
  tick(): void {
    if (this.counter > BOLT_LAST) {
      this.done = true;
      return;
    }
    for (let i = 0; i < BOLT_POINTS; i++) {
      const s = this.scale[i] - BOLT_SCALE_DECAY;
      const v = s > BOLT_SCALE_FLOOR ? s : BOLT_SCALE_FLOOR;
      this.scale[i] = v;
      for (let k = 0; k < 3; k++) this.points[i * 3 + k] = this.base[i * 3 + k] + this.jitter[i * 3 + k] * v;
    }
    this.visible = true;
    let c = this.counter;
    if (this.hold < c) {
      if (BOLT_FADE_STEP < this.alpha) this.alpha -= BOLT_FADE_STEP;
      else {
        this.alpha = 0;
        c = BOLT_LAST + 1;
      }
    }
    this.counter = c + 1;
  }

  /** The alpha (0..1) the ribbon is drawn with. */
  get opacity(): number {
    return this.alpha / 255;
  }

  /** The points the particle 0x1f0 is made at (the constructor). */
  particlePoints(): Vec3[] {
    return Array.from({ length: BOLT_POINTS }, (_, i) => ({ x: this.base[i * 3], y: this.base[i * 3 + 1], z: this.base[i * 3 + 2] }));
  }
}

function unitFrom(from: Vec3, to: Vec3): { dir: Vec3; length: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  return length === 0 ? { dir: { x: dx, y: dy, z: dz }, length } : { dir: { x: dx / length, y: dy / length, z: dz / length }, length };
}

/** A bolt from `from` to `to` (the point -> target vectors of the exe's callers). */
export function boltBetween(from: Vec3, to: Vec3, thickness: number, rng: Rng, hold = BOLT_HOLD): LightningBolt {
  const { dir, length } = unitFrom(from, to);
  return new LightningBolt(from, dir, length, thickness, rng, hold);
}

// --- what a technique shows -----------------------------------------------------------

export interface FxParticle {
  id: number;
  at: Vec3;
  delay?: number;
  duration?: number; // frames of continuous emission (create_particle_effect_ex / 3)
  scale?: number;
  tint?: number; // ARGB, ParticleEffectSingleParticle_SetId
  /** Where the point is: 'caster' follows nothing here, the point is final. */
}

export interface StrikePlan {
  tier: number;
  bolts: LightningBolt[];
  particles: FxParticle[];
  sounds: FxSound[];
}

// --- Zonde -----------------------------------------------------------------------------
//
// CreateTechniqueEffectEntity_006f2570 (the object is named "ZalureEffectEntity"
// in the dump; vtable 0x00b3e880: update ZalureEffectEntity_Update_006f2840,
// hit zonde_tech_hit_entity 0x006f3014 at +0x18). On its first update, for the
// first target of the 6x47 list only (+0x134):
//   14 points: i = 0 is straight above the target, the others are spread
//   (rand * i * 13) toward +x and +z (rand is not centred) around it;
//   the height is 100 above the target's origin (500 for point 0 of tier 5);
//   each point's bolt goes down to the target's origin.
//   tier 0 / 1 / 2: bolt 0 alone, thickness 0.5 / 0.6 / 0.7;
//   tier 3 / 4: bolts 0..2, thickness 0.5 / 0.7;
//   tier 5: bolt 0 at 5.0 and bolts 1..13 at 0.5.
//   The particle 0x19f (razonde_kona) at point 0 (not for tier 5); SE 0x8f at
//   the target with the tier's pitch; then the target is hit (entity_hit_by_tech
//   group 3, power +0xcc) and the object ends.

export const ZONDE_POINTS = 14;
export const ZONDE_SPREAD = 13; // 0x0096e054
export const ZONDE_HEIGHT = 100; // 0x0096e060
export const ZONDE_HEIGHT_TIER5 = 500; // 0x0096e05c, point 0 of tier 5
export const ZONDE_HIT_PARTICLE = 0x19f;
const ZONDE_THICKNESS_SINGLE = [0.5, 0.6, 0.7];

/** The 14 points of a Zonde strike on `target` (rand consumed x then z per point). */
export function zondePoints(target: Vec3, tier: number, rng: Rng): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < ZONDE_POINTS; i++) {
    const x = rng() * i * ZONDE_SPREAD + target.x;
    const z = rng() * i * ZONDE_SPREAD + target.z;
    out.push({ x, y: target.y + (tier === 5 && i === 0 ? ZONDE_HEIGHT_TIER5 : ZONDE_HEIGHT), z });
  }
  return out;
}

/** The bolts of the Weapon special "Storm" / "Tempest" and of Zonde share this: 14 random points above `target`. */
export function zondeBolts(target: Vec3, tier: number, rng: Rng, count: number, thickness: (i: number) => number, hold = BOLT_HOLD): { bolts: LightningBolt[]; points: Vec3[] } {
  const points = zondePoints(target, tier, rng);
  const bolts: LightningBolt[] = [];
  for (let i = 0; i < count; i++) bolts.push(boltBetween(points[i], target, thickness(i), rng, hold));
  return { bolts, points };
}

export function zondeStrike(level: number, target: Vec3, rng: Rng): StrikePlan {
  const tier = effectTier(level);
  const count = tier === 5 ? ZONDE_POINTS : tier >= 3 ? 3 : 1;
  const thickness = (i: number): number => (tier === 5 ? (i === 0 ? 5 : 0.5) : tier >= 3 ? (tier === 3 ? 0.5 : 0.7) : ZONDE_THICKNESS_SINGLE[tier]);
  const { bolts, points } = zondeBolts(target, tier, rng, count, thickness);
  return {
    tier,
    bolts,
    particles: tier === 5 ? [] : [{ id: ZONDE_HIT_PARTICLE, at: points[0] }],
    sounds: [techSound(SE.zonde, target, tier)],
  };
}

// --- Gizonde -----------------------------------------------------------------------------
//
// CreateTechniqueEffectEntity_006e54a8 -> TechniqueEffectEntity_Constructor_006e5520
// (SE 0x90 at the cast point, tier pitch) and update_gizonde 0x006e5890 on its
// first update: UpdateGizondeTechniqueVisuals_006e5954 draws a bolt from the
// cast point to the first target's hit box position (thickness 0.5 / 0.6 / 0.7 /
// 0.6 / 0.7 by tier, tier 5: 5.0 plus two of 0.5), the particle 0x19f at that
// hit box and, from tier 3, 0x188; then one chain bolt per consecutive pair of
// targets, from the first one's hit box to the second's (the same thicknesses).
//
// The exe's return value decides the hit (asm 6e5a08..6e6148, 6e60c1, 6e605f):
//   - the first target missing, or at zero distance from the cast point: return
//     0, nothing is drawn and nothing is hit;
//   - a later pair with a missing entity, at zero distance (0x6e6148 against
//     g_GizondeTechnicleHitboxRadius = 0.0), or with both flagged, targetable
//     and dead (0x6e60c1): `goto` the return 0 label. The bolts drawn before
//     that pair stay, and NOTHING is hit;
//   - otherwise return 1: update_gizonde hits every target of the list that is
//     constructed and targetable (group 3, tech gizonde) and the object ends.
// The chain's end points use each target's hit box at the 6x47 box index,
// crossed in the exe (direction = box[i+1][idx_i] - box[i][idx_i+1]); the port
// keeps one point per target, the same for single-box targets (ASSUMED for the
// multi-box ones).

export const GIZONDE_HIT_PARTICLES = [0x19f, 0x19f, 0x19f, 0x19f, 0x19f, 0x19f];
export const GIZONDE_EXTRA_PARTICLE = 0x188; // tiers 3..5
const GIZONDE_THICKNESS = [[0.5], [0.6], [0.7], [0.6], [0.7], [5, 0.5, 0.5]];

/**
 * The strike of a Gizonde. `targets` is the 6x47 list in order, each one's hit
 * box point, or null when that entity is not constructed here. `hits` is the
 * exe's return value: true when every target of the list is hit.
 */
export function gizondeStrike(level: number, cast: Vec3, targets: readonly (Vec3 | null)[], rng: Rng): StrikePlan & { hits: boolean } {
  const tier = effectTier(level);
  const plan: StrikePlan & { hits: boolean } = { tier, bolts: [], particles: [], sounds: [techSound(SE.gizonde, cast, tier)], hits: false };
  const first = targets[0];
  if (!first) return plan;
  if (unitFrom(cast, first).length === 0) return plan;
  for (const t of GIZONDE_THICKNESS[tier]) plan.bolts.push(boltBetween(cast, first, t, rng));
  plan.particles.push({ id: GIZONDE_HIT_PARTICLES[tier], at: first });
  if (tier >= 3) plan.particles.push({ id: GIZONDE_EXTRA_PARTICLE, at: first });
  for (let i = 0; i + 1 < targets.length; i++) {
    const a = targets[i];
    const b = targets[i + 1];
    if (!a || !b || unitFrom(a, b).length === 0) return plan; // return 0: the chain stops, no hit at all
    for (const t of GIZONDE_THICKNESS[tier]) plan.bolts.push(boltBetween(a, b, t, rng));
  }
  plan.hits = true;
  return plan;
}

// --- Razonde ------------------------------------------------------------------------------
//
// RafoieEffectEntity_Constructor_006ee674 (named after Rafoie in the dump;
// RafoieEffectEntity_Create_006ee600 is the Razonde case of unknown_cast_tech,
// stats RazondeEffectEntity_Update_006eeae0): an outward spiral of 8 points around the
// cast point, radius step * (i + 1) with the step 5.4 (level < 15), 8.1
// (15..24), 10.8 (25..29), 5.4 again at 30 (0x0096ddd8 / 0x0096ddd0 /
// 0x0096ddd4), angle (i + 1) * 0x2aaa BAMS (60 degrees; the x offset is the
// cosine and the z offset the sine here), all at the cast height. 7 bolts, one
// per consecutive pair, thickness 5.0 holding only 6 updates (tier 5 adds a
// 0.5 one each), the particles of the tier table made at the first points,
// SE 0x91 at the cast point. On its first update (update_razonde 0x006eebe0) it
// makes, for a player caster, the particle table at the caster's weapon
// position (table[1] as an emitter for 0x3c frames) and ticks the area damage
// (AoE_TechDamageTick_006deadc): every enemy within range_h + 5 of the cast
// point (a sphere against the hit boxes, at most 15, within 250 of the point:
// 62500 squared for a player's, 100 for an enemy's) is hit (group 3, tech
// razonde).

export const RAZONDE_HOLD = 6;
export const RAZONDE_THICKNESS = 5;
export const RAZONDE_RADIUS_BONUS = 5; // 0x0096dde0 + range_h
export const RAZONDE_MAX_HITS = 15;
export const RAZONDE_PARTICLES: readonly (readonly number[])[] = [[0x93], [0x93], [0x93], [0xaa, 0xad], [0xaa, 0xad], [0xab, 0xae]];
export const RAZONDE_CASTER_DURATION = 0x3c;

export function razondeStep(level: number): number {
  const l = level > 0x1d ? 0x1e : level < 1 ? 0 : Math.trunc(level);
  if (l >= 15 && l < 25) return 8.1;
  if (l >= 25 && l < 30) return 10.8;
  return 5.4;
}

export function razondeSpiral(cast: Vec3, level: number): Vec3[] {
  const step = razondeStep(level);
  const out: Vec3[] = [];
  let r = 0;
  let a = 0;
  for (let i = 0; i < 8; i++) {
    r += step;
    a += 0x2aaa;
    out.push({ x: Math.cos(a * TWO_PI_BAMS) * r + cast.x, y: cast.y, z: Math.sin(a * TWO_PI_BAMS) * r + cast.z });
  }
  return out;
}

export interface RazondePlan extends StrikePlan {
  spiral: Vec3[];
  /** The first update's particles at the caster's weapon position (player casters). */
  casterParticles: FxParticle[];
}

/**
 * `caster`: a player caster's hand (the table's other particles, ASSUMED) and
 * weapon position (the feet, +0x300: table[1]'s 0x3c frame emitter, exe
 * update_razonde `create_particle_effect_ex(caster + 0x300, ..., 0x3c)`).
 */
export function razondeStrike(level: number, cast: Vec3, rng: Rng, caster: { hand: Vec3; weapon: Vec3 } | null): RazondePlan {
  const tier = effectTier(level);
  const spiral = razondeSpiral(cast, level);
  const bolts: LightningBolt[] = [];
  for (let i = 0; i < 7; i++) {
    bolts.push(boltBetween(spiral[i], spiral[i + 1], RAZONDE_THICKNESS, rng, RAZONDE_HOLD));
    if (tier === 5) bolts.push(boltBetween(spiral[i], spiral[i + 1], 0.5, rng, RAZONDE_HOLD));
  }
  const table = RAZONDE_PARTICLES[tier];
  const particles = table.map((id, k) => ({ id, at: spiral[k] }));
  const casterParticles: FxParticle[] = [];
  if (caster) table.forEach((id, k) => casterParticles.push(k === 1 ? { id, at: caster.weapon, delay: 0, duration: RAZONDE_CASTER_DURATION } : { id, at: caster.hand }));
  return { tier, bolts, particles, sounds: [techSound(SE.razonde, cast, tier)], spiral, casterParticles };
}

/** The enemies a Razonde reaches: a sphere of range_h + 5 around the cast point against each hit box, the first 15 in list order. */
export function aoeTargets<T extends { x: number; y: number; z: number; radius: number }>(center: Vec3, rangeH: number, candidates: readonly T[]): T[] {
  const radius = rangeH + RAZONDE_RADIUS_BONUS;
  const out: T[] = [];
  for (const c of candidates) {
    if (Math.hypot(c.x - center.x, c.y - center.y, c.z - center.z) <= radius + c.radius) out.push(c);
    if (out.length >= RAZONDE_MAX_HITS) break;
  }
  return out;
}

// --- the weapon specials -----------------------------------------------------------------------
//
// weapon_special_handlers (0x009c2660) entries 26..30. Type 0 (the special
// attack starts, state 0x0069c4a0 case 2: ExecuteWeaponSpecialAttack_005ce89c(
// player, 0, 0, 0), then SE 0x40) makes a particle at the weapon: Flame and
// Burning 0x69 (+0x300), Shock / Thunder 0xbe (the node at vtable +0x10c with
// 0x30), Storm / Tempest 0xa0 (+0x300). Type 1 (the special lands on an entity,
// at its hit position):
//   Shock / Thunder (CreateGizondeVisualEffect_005ce264): one bolt from 100
//     above the position straight down, length 100, thickness 1.8;
//   Storm / Tempest (WeaponSpecialAttackZonde_005ce3d8): the Zonde points (14
//     random points 100 above, spread 13) and bolts 0..2 at thickness 0.7;
//   Burning (CreateProjectileRafoieEffect_005ce054): a ProjectileRafoie
//     (ConstructProjectileRafoie_006ee0d0) at the position, type 0: the table
//     entry 0 of rafoie_and_bazooka_particles (0x1ee, scale 1) made at the
//     position + (0, 13, 0), and the explosion model (model 11 of bm_technic.bml,
//     eff_rafoie.xj) for 0x6e updates: scale 0.6 grows toward 0.8 by 15 % of the
//     gap an update (the Rafoie ball itself starts at 1.2 toward 1.9), alpha 1
//     toward 0 by 3.5 % an update, turned to face the camera, additive.

export const SPECIAL_ID = { flame: 25, burning: 26, shock: 27, thunder: 28, storm: 29, tempest: 30 } as const;

export interface SpecialStart {
  particle: number;
  /** 'weapon': the attacker's weapon position (+0x300); 'node': the cast hand node. */
  at: 'weapon' | 'node';
}

/** The type 0 effect of a weapon special (null: no object special). */
export function specialStart(special: number): SpecialStart | null {
  switch (special) {
    case SPECIAL_ID.flame:
    case SPECIAL_ID.burning:
      return { particle: 0x69, at: 'weapon' };
    case SPECIAL_ID.shock:
    case SPECIAL_ID.thunder:
      return { particle: 0xbe, at: 'node' };
    case SPECIAL_ID.storm:
    case SPECIAL_ID.tempest:
      return { particle: 0xa0, at: 'weapon' };
    default:
      return null;
  }
}

export const SHOCK_HEIGHT = 100; // 0x0092bf5c
export const SHOCK_LENGTH = 100; // 0x42c80000
export const SHOCK_THICKNESS = 1.8; // 0x3fe66666
export const STORM_THICKNESS = 0.7; // 0x3f333333

export function shockBolt(at: Vec3, rng: Rng): LightningBolt {
  return new LightningBolt({ x: at.x, y: at.y + SHOCK_HEIGHT, z: at.z }, { x: 0, y: -1, z: 0 }, SHOCK_LENGTH, SHOCK_THICKNESS, rng);
}

export function stormBolts(at: Vec3, rng: Rng): LightningBolt[] {
  return zondeBolts(at, 0, rng, 3, () => STORM_THICKNESS).bolts;
}

export const BURNING = {
  particle: 0x1ee,
  particleDy: 13, // 5 (0x0096dcf0) + 8 (0x0096dcec)
  lifetime: 0x6e,
  scale0: 0.6,
  scaleTarget: 0.8,
  scaleRate: 0.15,
  alphaRate: 0.035,
  color: 0.6,
  alpha0: 1,
} as const;

/** The ProjectileRafoie explosion model's state after `frames` updates (update_bazooka_explosion 0x006ee... ). */
export class RafoieBall {
  scale: number;
  alpha: number = BURNING.alpha0;
  frames = 0;
  private target: number;
  private rate: number;
  constructor(scale0 = BURNING.scale0, target = BURNING.scaleTarget, rate = BURNING.scaleRate) {
    this.scale = scale0;
    this.target = target;
    this.rate = rate;
  }
  get done(): boolean {
    return this.frames > BURNING.lifetime;
  }
  tick(): void {
    this.frames++;
    this.scale += (this.target - this.scale) * this.rate;
    this.alpha += (0 - this.alpha) * BURNING.alphaRate;
  }
}

// --- Megid ---------------------------------------------------------------------------------
//
// create_megid1 (CreateMegidEntity_006e98c0, along a heading) / create_megid
// (MegidEntity_ConstructorVariant_006ea16e, at a target's hit box): a
// TechniqueEntity (vtable +0xc6 tier) that flies. Stats UpdateMegidEntityStats
// _006e9be8: speed (level / 5) * 2 + 2.0 a tick, range range_h. update_megid
// (0x006ea3b0): the particle emitters of the tier follow its position, then
// TechniqueEntity_UpdatePosition_006f0474 (pos += dir * speed; a map ray
// from the old to the new point (cast_ray_at_map_collision_geometry, mask 0x100)
// moves it to the hit point and ends it, the rest of the update still runs),
// TechniqueEntity_CheckDuration_006f053c (ends when range < travelled, else
// travelled += speed) and TechniqueEntity_UpdateTargeting_006f0798: a sphere of
// radius 5 (the box +0x108) at the object against the hit boxes; only the
// FIRST entity of the list is processed a tick. MegidEntity_ProcessHit
// _006ea310 skips an entity it already hit (a list of 32), else
// entity_hit_by_tech(group 5, power +0xcc, tech megid), SE 0xb0 at the
// entity, and for a player caster the object ends unless
// maybe_check_for_tech_pierce(megid) has bit 0 (the class boost of Megid is
// exactly 1.0: FOnewearl); an enemy caster's object never ends on a hit.

export const MEGID_RADIUS = 5; // 0x00000108 box radius
export const MEGID_BASE_SPEED = 2; // technique_data speed
export const MEGID_MAX_HITS = 32;
export const MEGID_WALL_MASK = 0x100; // UpdateTechniqueEntityPositionWithRaycast_006f04c0 (0x006f04c0)

/** The map ray of a technique object: the hit point of the segment from -> to, or null. */
export type WallHit = (from: Vec3, to: Vec3) => Vec3 | null;

export interface EmitterSpec {
  id: number;
  scale?: number; // flag 0x40: field +0x44 / +0x48
  /** create_particle_effect2 with the object's angles (the table's flag 2); else create_particle_effect4. */
  angles?: boolean;
  /** Particle flag 0x2000 (the table's 0x1000): destroyed at birth, never drawn (EffectFx.noDraw). */
  hidden?: boolean;
}

/** g_pMegidParticleEffectConfigPointers (0x0096da78 + 8 * tier): continuous emitters following the object. */
export const MEGID_EMITTERS: readonly (readonly EmitterSpec[])[] = [
  [{ id: 0x1c5 }, { id: 0x1c8 }],
  [{ id: 0x1c5, scale: 1.4 }, { id: 0x1c8, scale: 1.4 }],
  [{ id: 0x1c5, scale: 1.8 }, { id: 0x1c8, scale: 1.8 }],
  [{ id: 0x1c4, angles: true }, { id: 0x1c5, scale: 2.2 }, { id: 0x1c8, scale: 2.2 }],
  [{ id: 0x1c4, angles: true }, { id: 0x1c5, scale: 2.6 }, { id: 0x1c8, scale: 2.6 }],
  // 0x1cf is flags 0x1002: its flag 2 gives the angles, its 0x1000 the particle flag 0x2000 (hidden: create_megid
  // passes uVar8 | 0x1000, so every Megid emitter carries 0x1000, which only the 0x200 model branch reads).
  [{ id: 0x1c4, angles: true }, { id: 0x1c5, scale: 3 }, { id: 0x1c8, scale: 3 }, { id: 0x1c7 }, { id: 0x1cf, angles: true, hidden: true }],
];

export function megidSpeed(level: number): number {
  const l = level > 0x1d ? 0x1e : level < 1 ? 0 : Math.trunc(level);
  return Math.trunc(l / 5) * 2 + MEGID_BASE_SPEED;
}

export interface FlightTarget extends Vec3 {
  id: number;
  radius: number;
}

export class MegidFlight {
  x: number;
  y: number;
  z: number;
  readonly dir: Vec3;
  readonly speed: number;
  readonly range: number;
  travelled = 0;
  done = false;
  /** Entities already hit (a list of 32). */
  readonly struck: number[] = [];
  readonly pierce: boolean;

  /** `dir` unit; `pierce` is the maybe_check_for_tech_pierce bit (or an enemy caster). */
  constructor(start: Vec3, dir: Vec3, speed: number, range: number, pierce: boolean) {
    this.x = start.x;
    this.y = start.y;
    this.z = start.z;
    this.dir = dir;
    this.speed = speed;
    this.range = range;
    this.pierce = pierce;
  }

  /** The heading flight (create_megid1): (sin h, 0, cos h). */
  static along(start: Vec3, heading: number, speed: number, range: number, pierce: boolean): MegidFlight {
    return new MegidFlight(start, { x: Math.sin(heading), y: 0, z: Math.cos(heading) }, speed, range, pierce);
  }

  /** The flight at a target (create_megid): toward its hit box, 3D. */
  static at(start: Vec3, target: Vec3, speed: number, range: number, pierce: boolean): MegidFlight {
    const { dir } = unitFrom(start, target);
    return new MegidFlight(start, dir, speed, range, pierce);
  }

  /**
   * One update. Moves, then the map ray from the old point to the new one (a
   * hit moves the orb to the hit point and ends it), checks the range, then looks
   * for the first entity inside the sphere (the list order is the caller's);
   * returns it when it is new. ASSUMED: the ray's hit point is the object's
   * x/y/z (ground_info.object, written by line_segment_intersects_triangle).
   */
  tick(candidates: readonly FlightTarget[], wall?: WallHit): FlightTarget | null {
    const from = { x: this.x, y: this.y, z: this.z };
    this.x += this.dir.x * this.speed;
    this.y += this.dir.y * this.speed;
    this.z += this.dir.z * this.speed;
    if (wall) {
      const hit = wall(from, { x: this.x, y: this.y, z: this.z });
      if (hit) {
        this.x = hit.x;
        this.y = hit.y;
        this.z = hit.z;
        this.done = true;
      }
    }
    if (this.range < this.travelled) this.done = true;
    else this.travelled += this.speed;
    for (const c of candidates) {
      if (Math.hypot(c.x - this.x, c.y - this.y, c.z - this.z) > MEGID_RADIUS + c.radius) continue;
      // Only the first overlapping entity is processed this update.
      if (this.struck.includes(c.id)) return null;
      if (this.struck.length < MEGID_MAX_HITS) this.struck.push(c.id);
      if (!this.pierce) this.done = true;
      return c;
    }
    return null;
  }
}

/** maybe_check_for_tech_pierce(megid) bit 0 for a player class: the Megid class boost is exactly 1.0. */
export function megidPierces(megidBoost: number): boolean {
  return megidBoost === 1;
}

// --- Grants ---------------------------------------------------------------------------------
//
// unknown_cast_grants -> CastGrantEffectEntity_Constructor_006e6c6c (vtable
// 0x00b3e... g_TechniqueEffectEntityVTable, update
// UpdateTechniqueTargetingEntity_006e6efc): for the first target of the list.
// Every update while the target is valid and the counter is 0, a tracker
// object is made at the target's position (the position then, it does not
// follow): the continuous emitters of the tier (create_particle_effect4 at the
// position, flag 0x10; table 0x0096d5b4), SE 0x93 with the tier's pitch. The
// counter goes up every update; above 0x1e (31 updates) the target is hit
// (UpdateCastGrantEffectEffect_006e6ec0: entity_hit_by_tech(group 4, power
// +0x88, tech grants), only if it is still valid and targetable) and the
// object ends. The tracker (TechniqueEffectParticle_Constructor_006e72bc) counts
// its own updates: on every 5th it makes a ring wave (model 10 of
// bm_technic.bml, eff_f_ringwave.xj, following the target, additive, turned to
// face the camera, the technic_pt.xvm entry frame + 1: scale from 0.05 toward
// 1.2 by 5 % an update, alpha toward 0 by 10 %), and above 29 it makes the burst
// 0xb4 0xb5 0xb6 at the target (table 0x0096d6cc, one emission each), the sound
// object 0x94 (pitch: tier 0 / 1 +0x100, 2 / 3 none, 4 / 5 -0x100) and ends,
// stopping its emitters.

export const GRANTS_HIT_TICK = 0x1f; // the update on which the counter passes 0x1e
export const GRANTS_TRACKER_END = 30;
export const GRANTS_RING_EVERY = 5;
export const GRANTS_EMITTERS: readonly (readonly number[])[] = [
  [0x1d3, 0x1d4, 0x1cb],
  [0x1d3, 0x1d4, 0x1d5],
  [0x1d3, 0x1d4, 0x1cc],
  [0x1c0, 0x1d4, 0x10f],
  [0x1c0, 0x1d4, 0x1a4],
  [0x1c2, 0x1d4, 0x1c9, 0x1da],
];
export const GRANTS_BURST: readonly number[] = [0xb4, 0xb5, 0xb6];
export const GRANTS_END_PITCH: readonly number[] = [0x100, 0x100, 0, 0, -0x100, -0x100];
export const RING = { scale0: 0.05, scaleTarget: 1.2, scaleRate: 0.05, alphaRate: 0.1, rise: 10, frames: 30, textures: 7 } as const;

/** A ring wave (TechniqueEffectEntity_Render_006e75b8). */
export class RingWave {
  scale: number = RING.scale0;
  alpha = 1;
  frame = 0;
  done = false;
  tick(): void {
    this.scale += (RING.scaleTarget - this.scale) * RING.scaleRate;
    this.alpha += (0 - this.alpha) * RING.alphaRate;
    // ASSUMED: the entry (frame + 1) cycles through the 7 ring variations like the critical flash's.
    this.frame = (this.frame + 1) % RING.textures;
    if (++this.age >= RING.frames) this.done = true;
  }
  private age = 0;
}

export type TechFxEvent =
  | { t: 'bolt'; bolt: LightningBolt }
  | { t: 'particle'; p: FxParticle }
  | { t: 'se'; s: FxSound }
  | { t: 'ring'; at: Vec3 }
  | { t: 'emitters'; ids: readonly number[]; at: Vec3; frames: number }
  | { t: 'follow'; emitters: readonly EmitterSpec[]; frames: number; base: Orient };

/** The Grants object's timeline for one target, ticked once per game tick. */
export class GrantsTimeline {
  readonly tier: number;
  private tick = 0; // the Grants object's counter (+0x148)
  private tracker = -1; // the tracker's counter (+0x2c), -1: not made
  private at: Vec3 | null = null;
  done = false;
  /** True on the tick the target must be hit (if it is still valid). */
  hit = false;
  events: TechFxEvent[] = [];

  constructor(level: number) {
    this.tier = effectTier(level);
  }

  /** `target`: the target's position when it is valid, else null. */
  update(target: Vec3 | null): void {
    this.hit = false;
    if (this.done) return;
    if (this.tracker >= 0) this.stepTracker();
    if (target && this.tick === 0) {
      this.at = { ...target };
      this.tracker = 0;
      this.events.push({ t: 'emitters', ids: GRANTS_EMITTERS[this.tier], at: this.at, frames: GRANTS_TRACKER_END + 1 });
      this.events.push({ t: 'se', s: techSound(SE.grants, this.at, this.tier) });
    }
    this.tick++;
    if (this.tick > 0x1e) {
      this.hit = true;
      this.done = true;
    }
  }

  private stepTracker(): void {
    this.tracker++;
    if (this.at && this.tracker % GRANTS_RING_EVERY === 0) this.events.push({ t: 'ring', at: this.at });
    if (this.at && this.tracker > 0x1d) {
      for (const id of GRANTS_BURST) this.events.push({ t: 'particle', p: { id, at: this.at } });
      this.events.push({ t: 'se', s: { id: SE.grantsEnd, at: this.at, pitch: GRANTS_END_PITCH[this.tier] } });
      this.tracker = -1;
    }
  }
}

// --- the support techniques ----------------------------------------------------------------------
//
// PlayTechniqueHitParticles_006ec06c, called by the constructors of Resta,
// Anti, Shifta and Deband (not Jellen / Zalure / Reverser) when the caster is a
// player (id < 4) that is not hidden: at the caster's position one particle
// from the table 0x0096db38 [0x1ed, 0x1f9, 0x1fa, 0x1fb] by
// GetPlayerTechBoost_006e1fc8 (level 0 or 1: 0; else the class + equipment
// boost b: < 1 -> 1, < 2 -> 2, else 3); for 3 also 0x1f2 and 0x19d. Anti is tinted
// 0xff4dff99, Shifta 0xffff9999, Deband 0xff337fff (ParticleEffectSingleParticle
// _SetId), Resta not. Sounds: Resta 0x95, Anti 0x97, Shifta 0x9b, Deband 0x9d,
// Jellen 0x9c, Zalure 0x9e, all with SUPPORT_PITCH; Reverser 0x99 without pitch.
// The areas (the probe box radius, +0xc of the object's box) are range_h + 5
// around the cast point for Resta / Anti / Shifta / Deband (0x0096de64,
// 0x0096c918, 0x0096df98 / 0x0096df90, 0x0096d110 / 0x0096d118), range_h for
// Jellen (+0x90; Zalure ASSUMED the same), and Reverser keeps the default 10
// (+0xc8, PhysicalEffectEntity_Constructor_006de7fc). A technique below Lv3
// (0-based level < 2) hits only its caster; from Lv3 the caster plus every
// 6x47 target (TechniqueObject_UpdateTarget_006e2ac4, update_anti_tech
// 0x006dd1e0 with Anti at level 0 only), and an object made with no list
// (0x13c = 0, the enemy casts) hits everything in the area.
// On each target a technique lands on (SpawnChallengeEntities_006ef4a4 for
// Resta, AntiTech_HandleCreationAction_006dd410 for Anti) another player's
// body gets the particles 0x1f6 + 0x1f7 (Resta) or 0x1f8 + 0x1ff (Anti), following
// it (flag 0x10), and a GameEntity sound (Resta 0x96 after 0x14 frames, Anti
// 0x98 after 0xf); the caster's own body runs the custom emitter definitions
// of the exe's tables (create_particle_effect9, not decoded: ASSUMED the same
// pair of particles).

export const RING_PARTICLES: readonly number[] = [0x1ed, 0x1f9, 0x1fa, 0x1fb];
export const RING_EXTRA: readonly number[] = [0x1f2, 0x19d];
export const RING_TINT = { anti: 0xff4dff99, shifta: 0xffff9999, deband: 0xff337fff } as const;

export type SupportTech = 'resta' | 'anti' | 'shifta' | 'deband' | 'jellen' | 'zalure' | 'reverser';

/** GetPlayerTechBoost_006e1fc8's result. */
export function ringTier(level: number, boost: number): number {
  if (level === 0 || level === 1) return 0;
  if (boost < 1) return 1;
  return boost < 2 ? 2 : 3;
}

const SUPPORT_SE: Record<SupportTech, number> = { resta: SE.resta, anti: SE.anti, shifta: SE.shifta, deband: SE.deband, jellen: SE.jellen, zalure: SE.zalure, reverser: SE.reverser };

/**
 * What a support technique shows at the caster when its object is made.
 * `boost` is the caster's class (+ equipment) boost of the technique.
 */
export function supportCastFx(tech: SupportTech, level: number, boost: number, at: Vec3): { particles: FxParticle[]; sounds: FxSound[] } {
  const tier = effectTier(level);
  const particles: FxParticle[] = [];
  if (tech === 'resta' || tech === 'anti' || tech === 'shifta' || tech === 'deband') {
    const t = ringTier(level, boost);
    const tint = tech === 'resta' ? undefined : RING_TINT[tech];
    const ids = [RING_PARTICLES[t], ...(t === 3 ? RING_EXTRA : [])];
    ids.forEach((id, k) => particles.push(tint !== undefined && (k === 0 || t === 3) ? { id, at, tint } : { id, at }));
  }
  const sounds = [tech === 'reverser' ? { id: SE.reverser, at, pitch: 0 } : techSound(SUPPORT_SE[tech], at, tier, true)];
  return { particles, sounds };
}

export const TARGET_PARTICLES = { resta: [0x1f6, 0x1f7], anti: [0x1f8, 0x1ff] } as const;
export const TARGET_SE = { resta: { id: 0x96, frames: 0x14 }, anti: { id: 0x98, frames: 0xf } } as const;

/** The support area radius (range_h + 5; Jellen / Zalure range_h; Reverser 10). */
export function supportRadius(tech: SupportTech, rangeH: number): number {
  if (tech === 'reverser') return 10;
  return tech === 'jellen' || tech === 'zalure' ? rangeH : rangeH + 5;
}

// --- enemy-cast objects --------------------------------------------------------------------------
//
// The enemies that cast these (the Chaos Sorcerer's Gizonde / Grants / Megid,
// the Gibbon's, the Del Lily's Megid) create the same objects with the player
// they aim at as the target list, so they are the strikes above and the flying
// orb, not a ball: EnemyShots that queue the visual events for the renderer
// (combat/enemyshots.ts has only the flight stand-in TechBolt).

export interface TechShotLook extends ShotLook {
  hidden: true;
}

export abstract class TechShot extends EnemyShot {
  override readonly absolute = true;
  readonly look: TechShotLook = { color: 0, size: 0, hidden: true };
  /** Visual events queued since the last drain (the renderer takes them). */
  events: TechFxEvent[] = [];

  drain(into: (e: TechFxEvent) => void): void {
    if (!this.events.length) return;
    const list = this.events;
    this.events = [];
    for (const e of list) into(e);
  }
}

const PLAYER_POINT: number = 10; // ASSUMED: the point of a player an enemy technique aims at (PLAYER_AIM_HEIGHT)

// The enemy shots are in world heights (`absolute`); `ground` is the height
// of the ground the enemy and the player stand on (ASSUMED the same, as the
// other shots of combat/enemyshots.ts).

/** An enemy's Gizonde: the bolt at once, the target hit on the first update. */
export class GizondeStrike extends TechShot {
  readonly effect: ShotEffect;
  private target: AiTarget;
  private fired = false;

  constructor(from: Vec3, target: AiTarget, level: number, power: number, rng: Rng, ground: number) {
    super(from.x, from.y, from.z);
    this.target = target;
    this.effect = { kind: 'tech', power };
    const plan = gizondeStrike(level, from, [{ x: target.x, y: ground + PLAYER_POINT, z: target.z }], rng);
    for (const b of plan.bolts) this.events.push({ t: 'bolt', bolt: b });
    for (const p of plan.particles) this.events.push({ t: 'particle', p });
    for (const s of plan.sounds) this.events.push({ t: 'se', s });
    this.fired = !plan.hits;
  }

  tick(): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.done = true;
    return this.fired || this.target.dead ? [] : [this.target];
  }
}

/** An enemy's Grants: the emitters and rings at the target's position, the hit 31 updates later. */
export class GrantsStrike extends TechShot {
  readonly effect: ShotEffect;
  private timeline: GrantsTimeline;
  private target: AiTarget;
  private ground: number;

  constructor(from: Vec3, target: AiTarget, level: number, power: number, ground: number) {
    super(from.x, from.y, from.z);
    this.target = target;
    this.ground = ground;
    this.effect = { kind: 'tech', power };
    this.timeline = new GrantsTimeline(level);
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    const now = targets.find((t) => t.clientId === this.target.clientId) ?? this.target;
    this.timeline.update(now.dead ? null : { x: now.x, y: this.ground, z: now.z });
    for (const e of this.timeline.events) this.events.push(e);
    this.timeline.events = [];
    if (this.timeline.done) this.done = true;
    return this.timeline.hit && !now.dead ? [now] : [];
  }
}

/** An enemy's Megid: the real flight (3D, a sphere of 5 + the player's radius), the emitters of its tier, never ended by a hit. */
export class MegidOrb extends TechShot {
  readonly effect: ShotEffect;
  readonly flight: MegidFlight;
  readonly tier: number;
  readonly speed: number;
  private radius: number;
  private ground: number;
  private wall: WallHit | undefined;

  // `aim`: a player in front of the caster (create_megid flies at its hit box, 3D);
  // without one it is create_megid1, along the heading. `wall`: the map ray of its flight.
  constructor(from: Vec3, heading: number, level: number, range: number, power: number, playerRadius: number, ground: number, aim?: Vec3, wall?: WallHit) {
    super(from.x, from.y, from.z);
    this.ground = ground;
    this.tier = effectTier(level);
    this.speed = megidSpeed(level);
    this.flight = aim ? MegidFlight.at(from, aim, this.speed, range, true) : MegidFlight.along(from, heading, this.speed, range, true);
    this.effect = { kind: 'megid', power };
    this.radius = playerRadius;
    this.wall = wall;
    this.events.push({ t: 'se', s: techSound(SE.megid, from, this.tier) });
    // The angles of the object (TechniqueEntity +0x54 / +0x5c): the heading's, or none for an aimed one (EffectEntityBase).
    const base = aim ? NO_ORIENT : orientOfDirection(Math.sin(heading), 0, Math.cos(heading));
    this.events.push({ t: 'follow', emitters: MEGID_EMITTERS[this.tier], frames: Math.ceil(range / this.speed) + 2, base });
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    const list: FlightTarget[] = targets.filter((t) => !t.dead).map((t) => ({ id: t.clientId, x: t.x, y: this.ground + PLAYER_POINT, z: t.z, radius: this.radius }));
    const hit = this.flight.tick(list, this.wall);
    this.x = this.flight.x;
    this.y = this.flight.y;
    this.z = this.flight.z;
    if (this.flight.done) this.done = true;
    if (!hit) return [];
    this.events.push({ t: 'se', s: { id: SE.megidHit, at: { x: hit.x, y: hit.y, z: hit.z }, pitch: 0 } });
    return targets.filter((t) => t.clientId === hit.id);
  }
}

/**
 * The Gibbon's Gizonde with nobody in front of it (unknown_gibbon_behavior2,
 * 0x0055fecc area, Ultimate non-leader): not the technique at all, the
 * particles 0xb9 and 0xba at the cast point and a bolt of thickness 1.8 along
 * the heading for the attack's max_x_distance, SE 0x8f without a pitch. It hits
 * nothing.
 */
export class PlainBolt extends TechShot {
  readonly effect: ShotEffect = { kind: 'tech', power: 0 };

  constructor(from: Vec3, heading: number, length: number, rng: Rng) {
    super(from.x, from.y, from.z);
    this.events.push({ t: 'particle', p: { id: 0xb9, at: from } });
    this.events.push({ t: 'particle', p: { id: 0xba, at: from } });
    this.events.push({ t: 'bolt', bolt: new LightningBolt(from, { x: Math.sin(heading), y: 0, z: Math.cos(heading) }, length, 1.8, rng) });
    this.events.push({ t: 'se', s: { id: SE.zonde, at: from, pitch: 0 } });
  }

  tick(): AiTarget[] {
    this.done = true;
    return [];
  }
}

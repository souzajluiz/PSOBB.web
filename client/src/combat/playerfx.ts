// What a player (the local one and the remote ones the local client sees)
// shows and sounds when it is hit, blocks, dies, is revived or carries a status
// effect, as PsoBB.exe does it (Ephinea 1.25.13, addresses are VAs). Pure
// data and rules; render/playerfx.ts draws the particles, render/combat.ts
// plays the sounds. Particle ids index particleentry.dat (data.gsl), whose
// entry names confirm the readings below (hit_a..d, guard_a..d, konran,
// poison_effect, mahi_effect, slow_effect, riverser_*, soul).
//
// Emitter creation functions of the exe, as used here:
//   create_particle_effect(pos, id)               0x0050b510: one emission at
//     `pos` (the emitter spawns its rate once, at least one particle, then is
//     destroyed: +0x34 = 1).
//   create_particle_effect(pos, id, delay, frames) 0x0050a984: a continuous
//     emitter that waits `delay` updates, emits every update and is destroyed
//     after `frames` updates (+0x38 / +0x3c; 1 = a single emission).
//   create_particle_effect3(pos, id)              0x00509590: a continuous
//     emitter with no limit; its owner moves or kills it.
//   create_particle_effect_3(&entity position, id, flags) (the level-up and the
//     status effects, flags 0x50): one emission whose particles follow the
//     player of the motion index (SetMotionIndex_00508f14 = player slot, flag
//     0x10); 0x40 = not culled by the camera distance.
//
// What happens, state by state (every handler runs on the local player and on
// the remote copies; the handlers of a remote copy are the ones the 6x4A / 6x4B
// / 6x4C / 6x4D / 6x4F receivers call, player+0x32c == 2):
//
//   Hit (EntityHitEntity_00773350, the local player as the defender, once per
//   hit that did damage; the remote copies never run it):
//     hit spark (AllocateAndInitializeEnemyEntity_0050325c -> entity 0x005032c8,
//     update 0x00503308): particles 4, 5, 6 (15 units below the hit point) and
//     0xd at the hit point, one emission each;
//     attribute particle at the hit point: the defender's attribute (+0x2e8,
//     SetPlayerBattleAction_006951a0: 4 machine for an android class, else 1
//     native, |0x20 for a Ranger) picks 0xf1 native / 0xf2 A.Beast / 0xe3
//     machine / 0x10d dark; a Ranger's 0x21 / 0x24 matches none: no particle;
//     no damage number for the local player (field 0x32c == 1 is excluded);
//     tech hits (entity_hit_by_tech) draw the same spark and particle.
//   Hit state entry, local and remote (0x0069ed10 light, 0x0069ea00 heavy):
//     SE 0x13 / 0x14 at the player; on a remote copy (0x32c == 2) also
//     EntityProcessStatusEffectParticle_007752dc: the attribute particle (same
//     table) at the player.
//   Heavy fall, frame 10 of the motion: SE 0x15, or 0x21 for a RAcast
//     (get_player_class_footstep_sound_effect_type == 2).
//   Block (6x4A, PlayerProcessHurtDamage_0068c8e8 on the evade state's entry):
//     with a shield equipped the shield's own routine runs: the shield item's
//     do_attack (vtable +0x70 = 0x0061cdb0, a bare `ret`), so nothing shows and
//     no SE plays (read: the shield vtable 0x00b0fb60, CreateArmorInstance_005e3200).
//     Without one CreateEnemyEffectEntity_005030bc: entity 0x00503144 (update
//     0x00503184) emits particles 0, 1, 2, 3 (guard_a..d, once each) at the
//     player's height-0x24 point, and SE 0x23 plays either way.
//   Death (handle_input_state_dead, 0x0069e458): no sound, no particle;
//     the death motion, then on the local player the red fade (combat/
//     playerdamage.ts DEATH_FADE_*); 6x4E (HandlePlayerRootObjectDespawn_
//     0069ad04 on the receivers, also TriggerDespawnEffect_00697988 locally
//     after the fade) creates the soul marker: particle 0xaf (soul), a
//     continuous emitter at the dead player's position + 10 (0x0093ca1c) on a
//     field, alive while the player is dead, on the player's floor.
//   Revive (6x4F, handle_input_state_0x4f / ForceExitSpecialState_0069db5c):
//     on a field a revive entity (constructor 0x006efc48, update 0x006efd5c, 200
//     updates) creates, at the player's position (the first one 20 above), the
//     emitters 0x35 riverser_hosi (30 updates), 0x36 riverser_fukkatu (starts
//     after 35, one update), 0x37 riverser_shuugo (after 45, one update) and,
//     on its 10th update, 0x38 riverser_wakka once. No sound.
//
// Status effects (combat/status.ts has the logic; the exe's functions are
// poison_entity .. shock_entity 0x007788ec.., the tick functions
// 0x00777bc8 ..): infliction creates the particle (flags 0x50, following the
// player); every 45 frames the tick repeats the particle and the SE:
//   poison 0x25 / SE 0xc, paralysis 0x26 / 0xd, slow 0x27 / 0xe,
//   confusion 0x24 / 0xf, shock 0x21 / 0x11 (the infliction plays the SE too),
//   freeze: no particle; the infliction creates the ice block entity
//   (CreateItemEffectHandler_00500fe8, the model of g_IceBmlData_00a72838,
//   ASSUMED left out here) and plays SE 0x10, the tick repeats SE 0x10 every 45
//   frames. All of them are skipped while the character flag 0x2000000 (the
//   player is invisible) is set. Infliction of poison / paralysis / slow /
//   confusion plays no sound.
//
// ASSUMED (not readable): the heights above the player's feet of the hit
// point and of the "weapon position" the status particles use (HIT_POINT_DY /
// BODY_DY); that particle entries of types 1 and 2 are drawn like type 0 (as
// render/levelupfx.ts does); that SEs have no distance attenuation here
// (play_directional_sound_effect's distance model is not read).

import { CRITICAL_SPARK } from './hitfx.ts';
import { STATUS, STATUS_SE, type StatusType } from './status.ts';

export interface FxSpec {
  id: number;
  // Updates to wait before the first emission (0x0050a984's +0x38).
  delay?: number;
  // Emit on this many updates (0x0050a984's +0x3c); undefined = a single
  // emission (create_particle_effect, +0x34 = 1).
  frames?: number;
  // Height above the anchor.
  dy?: number;
}

// Heights above the player's feet. HIT_POINT_DY / BODY_DY are ASSUMED (see
// the header); the others are read: 36 = the block's 0x24, 20 and 10 from the
// revive entity (0x0096de80) and TriggerDespawnEffect (0x0093ca1c).
export const HIT_POINT_DY = 20;
export const BODY_DY = 20;
export const BLOCK_DY = 36;
export const REVIVE_DY = 20;
export const SOUL_DY = 10;

// EntityHitEntity_00773350: the hit spark entity's four emitters (6 sits 15
// below the hit point).
export const HIT_SPARK: readonly FxSpec[] = [
  { id: 4, dy: HIT_POINT_DY },
  { id: 5, dy: HIT_POINT_DY },
  { id: 6, dy: HIT_POINT_DY - 15 },
  { id: 13, dy: HIT_POINT_DY },
];

// The critical hit's particles on a player (EntityHitEntity_00773350's
// unknown_display_critical_hit_effect, 0x005014e8, replaces HIT_SPARK): 7,
// 0xb, 0xc (20 below the hit point) and 0xe, the same offsets as on an enemy.
export const CRITICAL_HIT_FX: readonly FxSpec[] = CRITICAL_SPARK.map((p) => ({ id: p.id, dy: HIT_POINT_DY + (p.dy ?? 0) }));

// The attribute particle of a hit (EntityHitEntity_00773350 on the local
// player, EntityProcessStatusEffectParticle_007752dc on a remote copy).
export function attributeFx(charClass: number): FxSpec[] {
  const id = attributeParticle(charClass);
  return id === null ? [] : [{ id, dy: HIT_POINT_DY }];
}

// CreateEnemyEffectEntity_005030bc's entity (guard_a .. guard_d).
export const BLOCK_FX: readonly FxSpec[] = [
  { id: 0, dy: BLOCK_DY },
  { id: 1, dy: BLOCK_DY },
  { id: 2, dy: BLOCK_DY },
  { id: 3, dy: BLOCK_DY },
];

// The revive entity's emitters (0x006efc48 + 0x006efd5c): ids, delays and
// lengths from the table at 0x009cf9f4 (stride 0x10: delay +0, frames +4,
// id +8 -> {53, 0, 30}, {54, 35, 1}, {55, 45, 1}) and the 10th-update shot.
export const REVIVE_FX: readonly FxSpec[] = [
  { id: 0x35, delay: 0, frames: 30, dy: REVIVE_DY },
  { id: 0x36, delay: 35, frames: 1, dy: 0 },
  { id: 0x37, delay: 45, frames: 1, dy: 0 },
  { id: 0x38, delay: 10, dy: 0 },
];
// The revive entity ends after more than 200 updates.
export const REVIVE_FX_UPDATES = 200;

// TriggerDespawnEffect_00697988: the dead marker (particle "soul"), a
// continuous emitter with no limit.
export const SOUL_PARTICLE = 0xaf;
export const SOUL_FX: readonly FxSpec[] = [{ id: SOUL_PARTICLE, frames: Infinity, dy: SOUL_DY }];

// The attribute table of EntityProcessStatusEffectParticle_007752dc and
// EntityHitEntity_00773350: attribute -> particle.
export const ATTRIBUTE_PARTICLE: Readonly<Record<number, number>> = { 1: 0xf1, 2: 0xf2, 4: 0xe3, 8: 0x10d };

// Class flags (player +0x964, newserv class_flags_for_class), as in
// combat/progression.ts and net/bbsession.ts.
// prettier-ignore
const CLASS_FLAGS: readonly number[] = [0x25, 0x2a, 0x31, 0x45, 0x51, 0x52, 0x86, 0x89, 0x8a, 0x32, 0x85, 0x46];

// The player's +0x2e8 (SetPlayerBattleAction_006951a0): 4 for an android class
// (+0x964 & 0x10), else 1; a Ranger (& 0x40) gets |0x20.
export function playerAttribute(charClass: number): number {
  const f = CLASS_FLAGS[charClass] ?? 0;
  const base = f & 0x10 ? 4 : 1;
  return f & 0x40 ? base | 0x20 : base;
}

// The attribute particle of a hit, or null (a Ranger matches no entry).
export function attributeParticle(charClass: number): number | null {
  return ATTRIBUTE_PARTICLE[playerAttribute(charClass)] ?? null;
}

// The footstep type of get_player_class_footstep_sound_effect_type: 1 for
// HUcast, RAcaseal, HUcaseal; 2 for RAcast; else 0.
export function footstepType(charClass: number): 0 | 1 | 2 {
  if (charClass === 2 || charClass === 5 || charClass === 9) return 1;
  return charClass === 4 ? 2 : 0;
}

// SE of the heavy fall's 10th frame (ProcessPlayerDeathState_0069e92c).
export function heavyLandSe(charClass: number): number {
  return footstepType(charClass) === 2 ? 0x21 : 0x15;
}

// The status effects' particle and sound ids.
export interface StatusFx {
  particle: number | null;
  se: number;
  // SE on the infliction itself (only the shock and the freeze play one).
  seOnset: boolean;
}

export const STATUS_FX: Readonly<Record<StatusType, StatusFx>> = {
  [STATUS.poison]: { particle: 0x25, se: STATUS_SE[STATUS.poison], seOnset: false },
  [STATUS.paralysis]: { particle: 0x26, se: STATUS_SE[STATUS.paralysis], seOnset: false },
  [STATUS.slow]: { particle: 0x27, se: STATUS_SE[STATUS.slow], seOnset: false },
  [STATUS.confusion]: { particle: 0x24, se: STATUS_SE[STATUS.confusion], seOnset: false },
  [STATUS.freeze]: { particle: null, se: STATUS_SE[STATUS.freeze], seOnset: true },
  [STATUS.shock]: { particle: 0x21, se: STATUS_SE[STATUS.shock], seOnset: true },
};

// What one pulse of a status effect shows / plays: `onset` is the infliction
// (poison_entity .. shock_entity), otherwise a tick of the 45-frame period.
export function statusPulse(type: StatusType, onset: boolean): { particle: number | null; se: number | null } {
  const f = STATUS_FX[type];
  return { particle: f.particle, se: onset && !f.seOnset ? null : f.se };
}

// The particle of a status pulse as an FxSpec (one emission following the
// player, flags 0x50), or [] for the freeze.
export function statusFx(type: StatusType): FxSpec[] {
  const id = STATUS_FX[type].particle;
  return id === null ? [] : [{ id, dy: BODY_DY }];
}

// One emitter of an FxSpec list, advanced by game updates. update() returns
// the number of emissions due on this update (0, or 1 for a spec that emits).
export class FxEmitter {
  readonly spec: FxSpec;
  private updates = 0;
  private emitted = 0;

  constructor(spec: FxSpec) {
    this.spec = spec;
  }

  get done(): boolean {
    return this.spec.frames === undefined ? this.emitted >= 1 : this.emitted >= this.spec.frames;
  }

  update(): number {
    if (this.done) return 0;
    this.updates++;
    // update_particle_effect: while the delay counter is positive it only
    // counts down.
    if (this.updates <= (this.spec.delay ?? 0)) return 0;
    this.emitted++;
    return 1;
  }
}

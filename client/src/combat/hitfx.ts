// What an enemy shows and sounds when it is hit, from PsoBB.exe (Ephinea
// 1.25.13, VAs). Pure data and rules; render/hitfx.ts draws the particles and
// render/combat.ts plays the sounds.
//
// EntityHitEntity_00773350 (the weapon strike, per hit box of the defender):
//   - a hit box that is hit and takes damage >= 0:
//       not critical -> AllocateAndInitializeEnemyEntity_0050325c(pos), the
//         "hit spark": its update 0x00503308 creates the particles 4, 5, 6
//         (raised by DAT_0091fca0 = -15) and 0xd at the hit point (names in
//         particleentry.dat: hit_a, hit_b, hit_c, hit_d), once, and lives 60
//         frames;
//       critical -> unknown_display_critical_hit_effect (entity 0x00501478,
//         update 0x005014e8): the particles 7, 0xb, 0xc (raised by
//         DAT_0091f040 = -20) and 0xe (critical_a..d) and a flash model, and
//         play_directional_sound_effect(0x42), damage x the critical
//         multiplier;
//     then, with the entity not hidden (flag 0x2000000), by the defender's
//     kind (+0x2e8, an exact compare, so a mini-boss' 0x11 / 0x12 / 0x18 has
//     none): native 0xf1, A.beast 0xf2, machine 0xe3, dark 0x10d, created with
//     flags 0x40 (no camera-distance cull);
//     then the number (display_floating_text_effect_numeric, white, 0x14
//     frames) when the damage as a short is >= 0 and the defender is not
//     the local player (+0x32c != 1).
//   - a hit box that is hit and takes < 0 (the defense swallowed it): the
//     number 0, white.
//   - the accuracy roll that fails: display_attack_miss_text, "MISS" in red
//     (0xffff0000, 0x14 frames), unless the entity is hidden (0x2000000) or is
//     the local player.
//   - an invulnerable defender: the number 0 and nothing else.
// entity_hit_by_tech (0x00773afc): Foie / Gifoie / Rafoie, Barta / Gibarta /
// Rabarta and Grants make the spark, EntityProcessStatusEffectParticle
// _007752dc (the kind particle above) and the number; the Zonde family makes
// EntityProcessHitEffect_00775204 (0xb9, 0xba and the kind particle) and the
// number; Megid makes the spark only; the support techniques none.
//
// No hit sound beyond the critical's 0x42 was found in any of these paths
// (the weapon swing sounds are not in the hit code).

export type EnemyKind = number; // enemy_attribute: native 1, A.beast 2, machine 4, dark 8

/** One particle to create (create_particle_effect / _3 / _ex / 9). */
export interface ParticleSpawn {
  id: number; // particleentry.dat entry
  dy?: number; // added to the point's y
  delay?: number; // frames before the first emission (create_particle_effect_ex / 9)
  duration?: number; // frames of emission (default: the one emission of create_particle_effect)
  scale?: readonly [number, number]; // particle field +0x44 / +0x48
  at?: 'hit' | 'player'; // the hit point (default) or the attacker's weapon position
}

export const CRITICAL_SE = 0x42;
export const HIT_SPARK_FRAMES = 0x3c;

/** AllocateAndInitializeEnemyEntity_0050325c's particles (0x00503308). */
export const HIT_SPARK: readonly ParticleSpawn[] = [{ id: 4 }, { id: 5 }, { id: 6, dy: -15 }, { id: 0xd }];
/** unknown_display_critical_hit_effect's particles (0x005014e8). */
export const CRITICAL_SPARK: readonly ParticleSpawn[] = [{ id: 7 }, { id: 0xb }, { id: 0xc, dy: -20 }, { id: 0xe }];

/** EntityProcessStatusEffectParticle_007752dc: by the defender's exact kind. */
export function kindParticle(kind: EnemyKind): ParticleSpawn | null {
  switch (kind) {
    case 1:
      return { id: 0xf1 };
    case 2:
      return { id: 0xf2 };
    case 4:
      return { id: 0xe3 };
    case 8:
      return { id: 0x10d };
    default:
      return null;
  }
}

export type HitFxKind =
  | 'weapon' // EntityHitEntity: spark or critical spark, the kind particle
  | 'spark' // the spark alone (Megid, the steal / freeze / paralysis specials)
  | 'foie' // spark + kind particle (Foie family, Barta family, Grants, the fire special)
  | 'zonde' // 0xb9, 0xba + kind particle (Zonde family, the thunder special)
  | 'none';

/** The particles of one hit. `critical` only matters for 'weapon'. */
export function hitParticles(kind: HitFxKind, critical: boolean, enemyKind: EnemyKind): ParticleSpawn[] {
  const k = kindParticle(enemyKind);
  const out: ParticleSpawn[] = [];
  switch (kind) {
    case 'weapon':
      out.push(...(critical ? CRITICAL_SPARK : HIT_SPARK));
      if (k) out.push(k);
      break;
    case 'spark':
      out.push(...HIT_SPARK);
      break;
    case 'foie':
      out.push(...HIT_SPARK);
      if (k) out.push(k);
      break;
    case 'zonde':
      out.push({ id: 0xb9 }, { id: 0xba });
      if (k) out.push(k);
      break;
    default:
      break;
  }
  return out;
}

/** The technique's hit effect kind in entity_hit_by_tech. */
export function techHitFx(tech: number): HitFxKind {
  if (tech >= 0 && tech <= 5) return 'foie'; // Foie..Rabarta
  if (tech >= 6 && tech <= 8) return 'zonde';
  if (tech === 9) return 'foie'; // Grants
  if (tech === 18) return 'spark'; // Megid
  return 'none';
}

/** The special's own hit effect kind (HandleSpecialAttack_007765a5), by the ItemPMT special type. */
export function specialHitFx(type: number): HitFxKind {
  switch (type) {
    case 1: // HP steal
    case 2: // TP steal
    case 3: // EXP steal
    case 7: // freeze
    case 8: // paralysis
      return 'spark';
    case 9: // fire
      return 'foie';
    case 10: // thunder
      return 'zonde';
    default:
      return 'none';
  }
}

/**
 * ExecuteWeaponSpecialAttack_005ce89c -> weapon_special_handlers[special]
 * (0x009c2660), called with type 1 when the special lands: the handlers'
 * particle effects, by the weapon special byte (1 Draw .. 40 Demon's). Objects
 * the handlers create that are not particles (Flame's and Burning's fire
 * projectiles, the Shock / Thunder / Storm / Tempest lightning) are not
 * here. `at: 'player'` is the attacker's weapon position (+0x300), the others
 * the hit point.
 */
export function specialHandlerParticles(special: number): ParticleSpawn[] {
  if (special >= 1 && special <= 4) return [{ id: 0x10a, at: 'player' }]; // 0x005ce7f8
  if (special >= 5 && special <= 8) return [{ id: 0xa8, at: 'player', scale: [0.2, 0.3] }]; // 0x005ce828
  if (special >= 9 && special <= 11) return [{ id: 0xa8, at: 'player' }]; // 0x005ce86c
  if (special === 12) return [{ id: 0x66, at: 'player' }]; // Charge, 0x005ce728
  if (special === 13) return [{ id: 0x67, at: 'player', scale: [0.2, 0.3] }]; // Spirit, 0x005ce788
  if (special === 14) return [{ id: 0x67, at: 'player' }]; // Berserk, 0x005ce758
  if (special === 17) return [{ id: 0x9a, delay: 0, duration: 0xf }]; // Freeze, 0x005ce14c
  if (special === 18) return [{ id: 0xbf, delay: 0, duration: 0xf }]; // Blizzard, 0x005ce1d8
  if (special === 23 || special === 24) return [{ id: 0x18, delay: 0, duration: 5 }]; // Heat, Fire, 0x005cddd0
  if (special === 31 || special === 32) return [{ id: 200 }, { id: 0x101, delay: 0, duration: 0x1e }]; // Dim, Shadow, 0x005ce564
  if (special === 33) return [{ id: 0x1c5 }, { id: 0x1c8 }]; // Dark, 0x005ce5e0
  if (special === 34) return [{ id: 0x1c5, scale: [2, 2] }, { id: 0x1c8, scale: [2, 2] }]; // Hell, 0x005ce638
  if (special === 39 || special === 40) return [{ id: 0x1ac }]; // Devil's, Demon's, 0x005ce7cc
  return [];
}

// --- status effects on an enemy -----------------------------------------------

export const STATUS_FX_PERIOD = 0x2d; // frames between the repeats
export const STATUS_SE = { paralysisTick: 0xd, confusionTick: 0xf, freeze: 0x10, shock: 0x11 } as const;

export type EnemyStatusKind = 'paralysis' | 'confusion' | 'freeze' | 'shock';

export interface StatusFx {
  particle: ParticleSpawn | null;
  se: number | null;
}

/**
 * What landing a status on an enemy shows and sounds (maybe_paralyze_entity
 * 0x007789c8, confuse_entity 0x00778be8, freeze_entity 0x00778cc0,
 * shock_entity 0x00778e40), all skipped for a hidden entity (flag
 * 0x2000000). The particles follow the enemy (flag 0x10, motion index = the
 * entity) and come from its lock-on cursor position; the particle flag is
 * 0x50. Freeze also creates the ice object (BattleMapEffect ice model, the
 * particle 0x12e at its centre).
 */
export function statusApplyFx(kind: EnemyStatusKind): StatusFx {
  switch (kind) {
    case 'paralysis':
      return { particle: { id: 0x26 }, se: null };
    case 'confusion':
      return { particle: { id: 0x24 }, se: null };
    case 'shock':
      return { particle: { id: 0x21 }, se: STATUS_SE.shock };
    case 'freeze':
      return { particle: { id: 0x12e }, se: STATUS_SE.freeze };
  }
}

/**
 * The repeat every 0x2d frames while the status holds
 * (unknown_handle_paralysis_effect, frozen_effect_tick, shock_effect_tick,
 * confusion_effect_tick): paralysis 0x26 + SE 0xd, shock 0x21 + SE 0x11,
 * freeze SE 0x10 (no particle), confusion 0x24 + SE 0xf.
 */
export function statusTickFx(kind: EnemyStatusKind): StatusFx {
  switch (kind) {
    case 'paralysis':
      return { particle: { id: 0x26 }, se: STATUS_SE.paralysisTick };
    case 'confusion':
      return { particle: { id: 0x24 }, se: STATUS_SE.confusionTick };
    case 'shock':
      return { particle: { id: 0x21 }, se: STATUS_SE.shock };
    case 'freeze':
      return { particle: null, se: STATUS_SE.freeze };
  }
}

// --- enemy death -----------------------------------------------------------------

/**
 * The death particles by enemy kind. ASSUMED: the dump shows these four
 * families inside the individual enemies' death states (and no common death
 * routine): gensei_dead 0xe4 (SpawnParticleEffectEntity_00578824, native),
 * ab_dead 0xe5 (CreateEnemyDeathParticle_005787a4 at the ground point,
 * A.beast), eall_bakuhatu1 / 2 + mecha_hahen 0xfb 0xfc 0xe3
 * (SpawnEntityParticles_005787d0, machine), dark_dead / dark_dead2 0xe8 0xec
 * (SpawnDeathParticles_005787fc, delayed 10 frames, dark). The pairing with the
 * kind follows the names and the hit particles above; which enemy uses which
 * was not traced for each of them.
 */
export function deathParticles(kind: EnemyKind): ParticleSpawn[] {
  switch (kind & 0xf) {
    case 1:
      return [{ id: 0xe4, delay: 0, duration: 0x1e }];
    case 2:
      return [{ id: 0xe5, delay: 0, duration: 0x1e }];
    case 4:
      return [{ id: 0xfb }, { id: 0xfc }, { id: 0xe3 }];
    case 8:
      return [
        { id: 0xe8, delay: 10, duration: 1 },
        { id: 0xec, delay: 10, duration: 1 },
      ];
    default:
      return [];
  }
}

// --- the floating number -----------------------------------------------------------

export const FLOAT_WHITE = 0xffffff;
export const FLOAT_RED = 0xff0000;
export const FLOAT_FRAMES = 0x14;

export interface FloatSpec {
  text: string;
  rgb: number;
}

/** A damage number: the hit box' damage as a short, shown when >= 0. */
export function damageFloat(damage: number): FloatSpec | null {
  const d = (Math.round(damage) << 16) >> 16; // (short)
  if (d < 0) return null;
  return { text: String(d), rgb: FLOAT_WHITE };
}

/** display_attack_miss_text. */
export function missFloat(): FloatSpec {
  return { text: 'MISS', rgb: FLOAT_RED };
}

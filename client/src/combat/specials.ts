// Weapon specials: what the special attack (attack type 2, the palette's
// special slot) does with the equipped weapon's special, as PsoBB.exe runs it
// (Ephinea 1.25.13, addresses are VAs).
//
// The special. The weapon's special byte (item +0x1f6, data1[4]) & 0x3f
// indexes ItemPMT's special table (GetPmtItemPair_005e4cdc); on equip
// ApplyPmtItemStatsToEntity_005e7a20 copies its {type, amount} to the player
// (+0x116 weapon_special_attack, +0x118 weapon_special_power). Types
// (special_attack_type): 1 HP steal (Draw / Drain / Fill / Gush), 2 TP steal
// (Heart / Mind / Soul / Geist), 3 EXP steal (Master's / Lord's / King's),
// 4 Charge (meseta), 5 Spirit (TP), 6 Berserk (HP), 7 freeze (Ice / Frost /
// Freeze / Blizzard), 8 paralysis (Bind / Hold / Seize / Arrest), 9 fire
// (Heat / Fire / Flame / Burning), 10 thunder (Shock / Thunder / Storm /
// Tempest), 11 instant kill (Dim / Shadow / Dark / Hell), 12 confusion (Panic
// / Riot / Havoc / Chaos), 13 HP divide (Devil's / Demon's).
//
// Who may use it. CheckPlayerAttackPermission_006994d4: a type-2 attack needs
// a weapon whose special byte is not 0 (or the item flags 0x400020,
// CheckItemStateForUpdate_005e9534); otherwise the palette button does
// nothing. is_player_allowed_to_attack (0x00699510) also refuses any attack
// while the character flags hold 0x20006 (paralyzed 2, shocked 4).
// weapon_can_use_special: an unidentified weapon (data1[4] &
// 0x80, is_item_tekked) falls back to do_regular_melee_attack.
//
// The hit (unknown_melee_attack_2, 0x006997a0 loop, per target):
//   accuracy = 0x009cb9dc[2] (0.5) * combo step factor; for an unidentified
//   weapon 0.1 (0x0093dae0) instead (ATA >= 0). The enemy's hit check
//   (vtable +0x70) rolls it.
//   Hit: the enemy's vtable +0x64 = HandleSpecialAttack (0x007753b4).
//   Miss: types 4, 5, 6, 9, 10, 13 show MISS; the others (0..3, 7, 8, 11,
//   12) roll the hit check once more with 0.5 * combo step and on a hit deal
//   an ordinary strike (try_hit_entity with 0x009cb9d0[2] = 0.5) and its PB
//   charge; else MISS.
//
// HandleSpecialAttack (0x007753b4), with power = +0x118, roll = a first
// get_random_float, and the reduction 1.0 / 0.5 for weapon kinds 2..4
// (swords, daggers, partisans) / 0.33 for kinds 5, 8, 9 (slicers, mechguns,
// shots) (0x00978224 / 0x00978220 / 0x0097821c). In Ultimate a player
// android's power gets + 30 except for 9, 10, 11 (0x00777007). Values are
// truncated (fistp with the control word | 0xc00).
//   1 HP steal (0x00776a64): v = min(power * enemy HP * 0.01, (difficulty
//     + 1) * 30) * reduction, at least 1 (0x00978214, 0x009781e0). The local
//     attacker sends 6x9A {its client id, its client id, 3, v} (handled
//     locally: HP + v), the enemy loses v, then try_hit_entity(0.6).
//   2 TP steal (0x007765ec): v = min(power * attacker max TP * 0.01,
//     (difficulty + 1) * 25) * reduction, at least 1; 6x9A what 4; the enemy
//     "loses" v TP; try_hit_entity(0.6). An android gets nothing (no hit).
//   3 EXP steal (0x007763a1): try_hit_entity(0.6) first; not on a boss map:
//     v = min(power * (exp * 13 / 10 in Episode 1, else exp) * 0.01,
//     (difficulty + 1) * 20) * reduction, at least 1 (the server grants it:
//     6xC6 {entity id, enemy index}); the strike's damage below 1 is a MISS.
//   4 Charge (0x007761a2): meseta < 200 (0x009781ec) -> MISS; else 6xC7
//     {200}, meseta - 200, try_hit_entity(3.0).
//   5 Spirit (0x00776005): TP < 10 (0x009781f0) -> MISS; else TP -
//     trunc(TP * 0.2) (0x009781f4), try_hit_entity(3.0).
//   6 Berserk (0x00775e43): HP <= 1 -> MISS; else HP - trunc(HP * 0.25)
//     (0x009781fc), try_hit_entity(3.0).
//   7 freeze (0x00775d58): c = max(0, (power - ESP) * 0.01 * reduction);
//     freeze_activation_check (0x007771a0): min(c, 0.4), or 0.2 in Ultimate
//     when c > 0.2, times the V50x boost (1.0, get_unit_v50x_status_boost);
//     a fresh roll below it freezes (vtable +0xc8) and try_hit_entity(0.6);
//     else MISS (no damage).
//   8 paralysis (0x00775c73): c as above; roll < c * boost paralyzes
//     (vtable +0xbc) and try_hit_entity(0.6); else MISS.
//   9 fire (0x00775b2c) / 10 thunder (0x007759a6): d = (100 - EFR / ETH) *
//     0.002 * (level / (5 - power) + (1 + power) * 20) * 5 (0x00978200,
//     0x00978208, 0x00978204; level = the 0-based player level, vtable
//     +0x38); HP - trunc(d), flag 0x400 when d > max HP * 0.25
//     (try_knockdown_player). Thunder then rolls the shock
//     (thunder_special_attack_shock_chance 0x007770d0): 1/15, 0.025 in
//     Ultimate, times the boost; shock_entity only takes on machines.
//   11 instant kill (0x007758c1): c = (power - EDK) * 0.01 * reduction;
//     roll < c * (status boost 1.0 + instant-kill boost 0.0) and not a boss
//     map: HP = 0, dead; else MISS.
//   12 confusion (0x007757fe): c as for paralysis; roll < c * boost confuses
//     (entity_hit_by_tech group 0x12); try_hit_entity(0.6) either way.
//   13 HP divide (0x00775657): not a boss map and roll < 0.5 (0x00978220):
//     d = (1 - power * 0.01) * HP * reduction, at least 1; HP - trunc(d);
//     else MISS.
//   0 / other: nothing.
// Then 6x0A (vtable +0x130) and ApplyHitEffects.

import { STATUS, type StatusType } from './status.ts';

const f32 = Math.fround;

export const SPECIAL = {
  none: 0, hpSteal: 1, tpSteal: 2, expSteal: 3, charge: 4, spirit: 5, berserk: 6, freeze: 7, paralysis: 8,
  fire: 9, thunder: 10, instantKill: 11, confusion: 12, hpDivide: 13,
} as const;

export const SPECIAL_TYPE_NAMES: Readonly<Record<number, string>> = {
  1: 'HP steal', 2: 'TP steal', 3: 'EXP steal', 4: 'Charge', 5: 'Spirit', 6: 'Berserk', 7: 'freeze', 8: 'paralysis',
  9: 'fire', 10: 'thunder', 11: 'instant kill', 12: 'confusion', 13: 'HP divide',
};

// The try_hit_entity multipliers (0x3f19999a, 0x40400000).
export const SPECIAL_HIT_MULT = f32(0.6);
export const SACRIFICE_HIT_MULT = 3;
// unknown_melee_attack_2's accuracy for an unidentified weapon (0x0093dae0).
export const UNTEKKED_SPECIAL_ACCURACY = f32(0.1);

// The special of a weapon's data1: {special index, unidentified}.
export function weaponSpecialByte(data1: ArrayLike<number>): { index: number; untekked: boolean; byte: number } {
  const b = data1[4] ?? 0;
  return { index: b & 0x3f, untekked: (b & 0x80) !== 0, byte: b };
}

// CheckPlayerAttackPermission_006994d4: may the palette start a special attack?
export function canUseSpecialAttack(data1: ArrayLike<number> | null): boolean {
  return !!data1 && (data1[0] ?? 0) === 0 && (data1[4] ?? 0) !== 0;
}

// The special attack's power reduction by weapon kind (data1[1]).
export function specialReduction(weaponKind: number): number {
  if (weaponKind >= 2 && weaponKind <= 4) return f32(0.5);
  if (weaponKind === 5 || weaponKind === 8 || weaponKind === 9) return f32(0.33);
  return 1;
}

// unknown_melee_attack_2: the types that roll a second, plain strike on a miss.
export function retriesOnMiss(type: number): boolean {
  return !((type >= 4 && type <= 6) || type === 9 || type === 10 || type === 13);
}

// freeze_activation_check (0x007771a0) for a player attacker.
export function freezeActivationChance(c: number, ultimate: boolean, boost = 1): number {
  const v = ultimate && c > f32(0.2) ? f32(0.2) : Math.min(c, f32(0.4));
  return v * boost;
}

// thunder_special_attack_shock_chance (0x007770d0) for a player attacker.
export function thunderShockChance(ultimate: boolean, boost = 1): number {
  return (ultimate ? f32(0.025) : f32(0.06666667)) * boost;
}

// The fire / thunder damage before truncation.
export function elementalSpecialDamage(level: number, power: number, resist: number): number {
  const inner = f32(f32(level / f32(5 - power)) + f32(f32(1 + power) * 20));
  return f32(f32(f32((100 - resist) * f32(0.002)) * f32(inner * 5)));
}

export interface SpecialAttacker {
  type: number; // +0x116
  power: number; // +0x118
  weaponKind: number; // data1[1]
  level: number; // 0-based
  hp: number;
  tp: number;
  maxTp: number;
  meseta: number;
  android: boolean;
}

export interface SpecialDefender {
  hp: number;
  maxHp: number;
  esp: number;
  efr: number;
  eth: number;
  edk: number;
  exp: number;
  canTake: (type: StatusType) => boolean;
}

export interface SpecialContext {
  difficulty: number; // 0..3
  episode: number; // 1, 2, 3 (= 4)
  bossMap: boolean;
  rng: () => number;
}

// What HandleSpecialAttack does to one enemy; render/combat.ts applies it.
export interface SpecialOutcome {
  miss: boolean; // MISS text, no damage
  hpDamage: number; // HP the special itself takes (steal / fire / thunder / divide)
  strikeMult: number | null; // try_hit_entity(attacker, mult) afterwards
  status: StatusType | null; // inflict on the enemy
  kill: boolean;
  bigHit: boolean; // try_knockdown_player's 0x400
  heal: { what: 'hp' | 'tp'; amount: number } | null; // 6x9A what 3 / 4
  cost: { what: 'meseta' | 'tp' | 'hp'; amount: number } | null;
  expSteal: boolean; // 6xC6 after a strike that did >= 1
  note: string;
}

const outcome = (o: Partial<SpecialOutcome>): SpecialOutcome => ({
  miss: false,
  hpDamage: 0,
  strikeMult: null,
  status: null,
  kill: false,
  bigHit: false,
  heal: null,
  cost: null,
  expSteal: false,
  note: '',
  ...o,
});

// HandleSpecialAttack for the local player hitting an enemy.
export function resolveSpecial(a: SpecialAttacker, d: SpecialDefender, ctx: SpecialContext): SpecialOutcome {
  const ultimate = ctx.difficulty === 3;
  let power = a.power;
  const t = a.type;
  if (ultimate && a.android && t !== SPECIAL.fire && t !== SPECIAL.thunder && t !== SPECIAL.instantKill) power += 30;
  const roll = ctx.rng();
  const red = specialReduction(a.weaponKind);
  const statusChance = Math.max(0, f32(f32((power - d.esp) * f32(0.01)) * red));
  switch (t) {
    case SPECIAL.hpSteal: {
      const v = Math.max(1, f32(Math.min(f32(power * d.hp * f32(0.01)), (ctx.difficulty + 1) * 30) * red));
      const n = Math.trunc(v);
      return outcome({ hpDamage: n, strikeMult: SPECIAL_HIT_MULT, heal: { what: 'hp', amount: n }, note: `drains ${n} HP` });
    }
    case SPECIAL.tpSteal: {
      if (a.android) return outcome({ note: 'android: no TP steal' });
      const v = Math.max(1, f32(Math.min(f32(power * a.maxTp * f32(0.01)), (ctx.difficulty + 1) * 25) * red));
      const n = Math.trunc(v);
      return outcome({ strikeMult: SPECIAL_HIT_MULT, heal: { what: 'tp', amount: n }, note: `drains ${n} TP` });
    }
    case SPECIAL.expSteal:
      return outcome({ strikeMult: SPECIAL_HIT_MULT, expSteal: !ctx.bossMap, note: ctx.bossMap ? 'no EXP steal on a boss map' : 'steals EXP' });
    case SPECIAL.charge:
      if (a.meseta < 200) return outcome({ miss: true, note: 'not enough meseta' });
      return outcome({ strikeMult: SACRIFICE_HIT_MULT, cost: { what: 'meseta', amount: 200 }, note: '-200 meseta' });
    case SPECIAL.spirit: {
      if (a.tp < 10) return outcome({ miss: true, note: 'not enough TP' });
      const n = Math.trunc(f32(a.tp * f32(0.2)));
      return outcome({ strikeMult: SACRIFICE_HIT_MULT, cost: { what: 'tp', amount: n }, note: `-${n} TP` });
    }
    case SPECIAL.berserk: {
      if (a.hp <= 1) return outcome({ miss: true, note: 'not enough HP' });
      const n = Math.trunc(f32(a.hp * 0.25));
      return outcome({ strikeMult: SACRIFICE_HIT_MULT, cost: { what: 'hp', amount: n }, note: `-${n} HP` });
    }
    case SPECIAL.freeze: {
      const c = freezeActivationChance(statusChance, ultimate);
      if (!(ctx.rng() < c)) return outcome({ miss: true, note: `freeze failed (${pct(c)})` });
      return outcome({ status: STATUS.freeze, strikeMult: SPECIAL_HIT_MULT, note: `freeze (${pct(c)})` });
    }
    case SPECIAL.paralysis: {
      if (!(roll < statusChance)) return outcome({ miss: true, note: `paralysis failed (${pct(statusChance)})` });
      return outcome({ status: STATUS.paralysis, strikeMult: SPECIAL_HIT_MULT, note: `paralysis (${pct(statusChance)})` });
    }
    case SPECIAL.fire:
    case SPECIAL.thunder: {
      const dmg = elementalSpecialDamage(a.level, power, t === SPECIAL.fire ? d.efr : d.eth);
      const n = Math.trunc(dmg);
      let status: StatusType | null = null;
      if (t === SPECIAL.thunder && ctx.rng() < thunderShockChance(ultimate)) status = STATUS.shock;
      return outcome({ hpDamage: n, bigHit: dmg > d.maxHp * 0.25, status, note: `${SPECIAL_TYPE_NAMES[t]} ${n}${status ? ' + shock roll' : ''}` });
    }
    case SPECIAL.instantKill: {
      const c = f32(f32((power - d.edk) * f32(0.01)) * red);
      if (!(roll < c) || ctx.bossMap) return outcome({ miss: true, note: `instant kill failed (${pct(c)})` });
      return outcome({ kill: true, note: `instant kill (${pct(c)})` });
    }
    case SPECIAL.confusion: {
      const hit = roll < statusChance;
      return outcome({ status: hit ? STATUS.confusion : null, strikeMult: SPECIAL_HIT_MULT, note: `confusion ${hit ? '' : 'failed '}(${pct(statusChance)})` });
    }
    case SPECIAL.hpDivide: {
      if (ctx.bossMap || !(roll < f32(0.5))) return outcome({ miss: true, note: 'HP divide failed' });
      const v = Math.max(1, f32(f32(f32(power * f32(-0.01)) + 1) * d.hp * red));
      const n = Math.trunc(v);
      return outcome({ hpDamage: n, note: `HP divide ${n}` });
    }
    default:
      return outcome({ note: 'no special' });
  }
}

const pct = (c: number) => `${Math.round(c * 1000) / 10}%`;

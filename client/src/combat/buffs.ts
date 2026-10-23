// The support technique effects of PsoBB.exe (Ephinea 1.25.13, addresses are
// VAs): Shifta / Jellen (attack slot), Deband / Zalure (defense slot), Anti's
// cure list and Reverser's revive.
//
// Power. The support technique objects do not use GetTechniquePower: their
// stats functions (UpdateSpecialAttackEntityStats_006f0ae4 for Shifta,
// UpdateTechniqueEntityStats_006f20cc for Zalure, and the same shape for
// Deband / Jellen) set power = v_power * level, with the 0-based level of the
// cast (6x48 level + the 6x8D override when it is 14, action_launch_tech) and
// v_power = 1 for all four. That power is the `power` argument of
// entity_hit_by_tech (vtable +0x60), which clamps it at 0.
//
// entity_hit_by_tech (0x00773b2c area), groups 9..12:
//   shifta (9) / jellen (11): vtable +0xd4 = on_shifta_jellen_received
//     (0x007791b8)
//   deband (10) / zalure (12): vtable +0xd8 = on_deband_zalure_received
//     (0x007793c8)
//   Jellen / Zalure on a player first roll the player's technique resistance
//   (get_player_tech_resist_chance); enemies have none. Then the defender's
//   +0x130 runs when the hit is the caster's own (the enemy's sends 6x0A with
//   its unchanged total damage, 0x00787578); every other client applies the
//   effect from the caster's 6x47 / 6x48 with its own copy of the object.
//
// on_shifta_jellen_received(type, power) (0x007791b8):
//   m = (power * 1.3 + 10) * 0.01, * -0.01 for Jellen
//       (0x009780f4 = 1.3, 0x009780f8 = 10, 0x009780f0 = 0.01, 0x009780ec = -0.01)
//   if |m| < |current m| (+0x278): nothing happens (a weaker cast neither
//   replaces nor refreshes a stronger one);
//   else +0x278 = m, +0x274 = type, +0x27c (frames) =
//       round((power * 10 + 40) * 30) (0x009780f8, 0x009780e8 = 40, 0x009780e4 = 30)
//     ATP (+0x2cc) += round(-old * base ATP (+0x2c4)) + round(m * base ATP)
//     ATP spread (+0x2ce) the same with the base spread (+0x2c6)
// on_deband_zalure_received(type, power) (0x007793c8): the same with
//   0x009780d8 / 0x009780dc / 0x009780d4 / 0x009780d0 (same values) on
//   +0x284 (m), +0x280 (type), +0x288 (frames, 0x009780cc = 40,
//   0x009780c8 = 30) and DFP (+0x2d2) from the base DFP (+0x2ca).
// ROUND is the x87 fistp in its default mode: round half to even.
//
// Ticks (shifta_jellen_effect_tick 0x007782b4 / deband_zalure_effect_tick
// 0x00778580, enemy vtable +0xac / +0xb0, per 30 Hz frame; players only on a
// field, Player_HandleJellenTick_0068ff38): frames -= 1; when it reaches 0 the slot is cleared and the stat goes back
// (+= round(-m * base)).
//
// Anti: AntiTech_HandleCreationAction_006dd410 calls entity_hit_by_tech(anti,
// power, ..., level) and a player's vtable +0xec = Player_ClearStatusEffect
// (0x00779868) clears by the 0-based level: poison always; level >= 1 shock;
// >= 2 paralysis; >= 3 confusion; >= 4 slow; >= 5 Jellen and Zalure; >= 6
// freeze. Anti / Shifta / Deband / Resta objects (update_anti_tech,
// TechniqueObject_UpdateTarget_006e2ac4) hit the caster, and the 6x47 targets
// too from level 3 (Anti level 2) on.
//
// Reverser: a player's vtable +0x108 = PlayerResetDeadState_0068fdc8 clears
// the dead flag and PlayerRestoreHealthAndTP_0068fddc sets HP to max HP / 2 on
// a field (outside battle mode and quests), full HP / TP otherwise (reviveRestore).

const f32 = Math.fround;

// x87 fistp in round-to-nearest mode.
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export const BUFF_LEVEL_SCALE = f32(1.3); // 0x009780f4 / 0x009780d8
export const BUFF_BASE = 10; // 0x009780f8 / 0x009780dc
export const BUFF_PERCENT = f32(0.01); // 0x009780f0 / 0x009780d4
export const BUFF_FRAMES_BASE = 40; // 0x009780e8 / 0x009780cc
export const BUFF_FRAMES_SCALE = 30; // 0x009780e4 / 0x009780c8

// technique_group values of entity_hit_by_tech.
export const GROUP = { anti: 7, reverser: 8, shifta: 9, deband: 10, jellen: 11, zalure: 12 } as const;
export type BuffGroup = (typeof GROUP)['shifta' | 'deband' | 'jellen' | 'zalure'];

// power = v_power (1) * 0-based level.
export function supportPower(level: number): number {
  return Math.max(0, level);
}

// The multiplier on_shifta_jellen_received / on_deband_zalure_received store.
export function buffMultiplier(group: BuffGroup, power: number): number {
  const p = Math.max(0, power);
  const sign = group === GROUP.jellen || group === GROUP.zalure ? -1 : 1;
  return f32((p * BUFF_LEVEL_SCALE + BUFF_BASE) * f32(sign * BUFF_PERCENT));
}

// Duration in 30 Hz frames.
export function buffFrames(power: number): number {
  return roundHalfEven((Math.max(0, power) * BUFF_BASE + BUFF_FRAMES_BASE) * BUFF_FRAMES_SCALE);
}

interface BuffSlot {
  type: number; // 0 = none, else the group
  mult: number;
  frames: number;
}

const empty = (): BuffSlot => ({ type: 0, mult: 0, frames: 0 });

// get_monster_status: the HUD's status icon for a slot type.
export function statusIcon(type: number): number {
  return ({ 2: 2, 3: 1, 9: 6, 10: 8, 11: 7, 12: 9, 0x0f: 3, 0x10: 4, 0x11: 5, 0x12: 0 } as Record<number, number>)[type] ?? 0x0e;
}

// The attack (+0x274..+0x27c) and defense (+0x280..+0x288) slots of one
// entity. Stats are derived from the base values on demand, which equals the
// client's incremental += round(-old * base) + round(new * base).
export class EntityBuffs {
  attack: BuffSlot = empty();
  defense: BuffSlot = empty();

  // entity_hit_by_tech with group 9..12; false when a stronger effect held.
  apply(group: BuffGroup, power: number): boolean {
    const slot = group === GROUP.shifta || group === GROUP.jellen ? this.attack : this.defense;
    const m = buffMultiplier(group, power);
    if (Math.abs(m) < Math.abs(slot.mult)) return false;
    slot.type = group;
    slot.mult = m;
    slot.frames = buffFrames(power);
    return true;
  }

  // One 30 Hz frame. Returns the slots that ran out this frame.
  tick(): BuffSlot[] {
    const ended: BuffSlot[] = [];
    for (const s of [this.attack, this.defense]) {
      if (s.frames < 1) continue;
      if (--s.frames > 0) continue;
      ended.push({ ...s });
      Object.assign(s, empty());
    }
    return ended;
  }

  // Player_ClearStatusEffect level >= 5: only the debuffs go.
  clearDebuffs(): boolean {
    let any = false;
    if (this.attack.type === GROUP.jellen) {
      this.attack = empty();
      any = true;
    }
    if (this.defense.type === GROUP.zalure) {
      this.defense = empty();
      any = true;
    }
    return any;
  }

  clear(): void {
    this.attack = empty();
    this.defense = empty();
  }

  atp(base: number): number {
    return base + roundHalfEven(base * this.attack.mult);
  }

  atpSpread(base: number): number {
    return base + roundHalfEven(base * this.attack.mult);
  }

  dfp(base: number): number {
    return base + roundHalfEven(base * this.defense.mult);
  }

  // The status icons QuickMenuUpdateShiftaStatusIcons_007426d8 shows for the
  // two technique slots (attack first).
  icons(): number[] {
    return [this.attack, this.defense].filter((s) => s.type !== 0).map((s) => statusIcon(s.type));
  }
}

// What Player_ClearStatusEffect cures at an Anti level (0-based).
export function antiCures(level: number): string[] {
  const all = ['poison', 'shock', 'paralysis', 'confusion', 'slow', 'Jellen / Zalure', 'freeze'];
  return level < 0 ? [] : all.slice(0, Math.min(all.length, level + 1));
}

// PlayerRestoreHealthAndTP_0068fddc on a field: max HP / 2 (short division).
export function reverserHp(maxHp: number): number {
  return Math.max(1, Math.trunc(maxHp / 2));
}

// The revive of a Reverser or a Moon Atomizer: PlayerResetDeadState_0068fdc8
// clears the dead flag and PlayerRestoreHealthAndTP_0068fddc runs. Outside a
// quest, on an unsafe map (a field), HP is max / 2 and the TP is left alone
// (tp null); otherwise HP and TP are full. ASSUMED: the exe's battle-mode and
// invincibility-3 tests are covered by the quest test (a battle run is a quest).
export function reviveRestore(maxHp: number, maxTp: number, opts: { quest: boolean; unsafe: boolean }): { hp: number; tp: number | null } {
  if (!opts.quest && opts.unsafe) return { hp: reverserHp(maxHp), tp: null };
  return { hp: Math.max(1, maxHp), tp: maxTp };
}

// The level a remote technique object runs at (action_launch_tech): the 6x48
// level, plus the last 6x8D level_upgrade when it is 14.
export function remoteTechLevel(sent: number, override: number): number {
  return sent === 14 ? sent + override : sent;
}

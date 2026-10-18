// Status effects on the local player: poison, paralysis, freeze, shock, slow
// and confusion, as PsoBB.exe runs them (Ephinea 1.25.13, addresses are VAs).
//
// Slots. A player (and an enemy) has two status slots next to the two
// technique slots of combat/buffs.ts, 0xc bytes apart:
//   slot 0 (+0x25c type, +0x260 EVP multiplier, +0x264 counter): poison (0x0f)
//     or paralysis (0x10);
//   slot 1 (+0x268 type, +0x26c EVP multiplier, +0x270 frames): freeze (2),
//     shock (3), slow (0x11) or confusion (0x12).
// The types are the technique_group values of entity_hit_by_tech (0x00773afc):
// groups 0x0f..0x12 call the defender's vtable +0xb8 / +0xbc / +0xc0 / +0xc4,
// group 2 (Barta's freeze roll) +0xc8, group 3 (Zonde's) +0xcc. The flags they
// set are the low six bits of entity+0x30 (newserv's 6x0A game_flags):
// 1 poisoned, 2 paralyzed, 4 shocked, 8 slowed, 0x10 confused, 0x20 frozen.
//
// Infliction (player vtable 0x00b39460; every one of these entries is the
// shared entity function, the player has no override):
//   +0xb8 poison_entity (0x007788ec): nothing on an android (+0x2e8 & 4; the
//     player's +0x2e8 is 4 for an android class, 1 otherwise, 0x006951a0) or
//     with the equipment immunity bit +0x11c & 1; else slot 0 = poison, counter
//     = 0x2d, the poison particle (0x25).
//   +0xbc maybe_paralyze_entity (0x007789c8): nothing on an android, with flag
//     0x1000000 or the immunity bit +0x11c & 2; for a player slot 0 =
//     paralysis with multiplier 0 and counter 0 (an enemy gets -0.15 EVP and
//     0xd2 frames).
//   +0xc0 slow_entity (0x00778b10): slot 1 = slow, 0xd2 frames (immunity +0x11c & 8).
//   +0xc4 confuse_entity (0x00778be8): slot 1 = confusion, 300 frames (+0x11c & 0x10).
//   +0xc8 freeze_entity (0x00778cc0): not while flag 0x8000 / 0x1000000 /
//     +0x11c & 0x20, nor while already frozen with frames left; slot 1 =
//     freeze, multiplier -0.3 (0x0097810c) applied to EVP, 0x96 frames, SE 0x10.
//   +0xcc shock_entity (0x00778e40): slot 1 = shock, 300 frames, multiplier 0
//     for a player (-0.15 for an enemy), SE 0x11 (+0x11c & 4 blocks it).
//   A new effect replaces whatever its slot held (the old EVP multiplier is
//   taken back first).
//
// Ticks (SinowberillChallengePlayer_UpdateLoop_00689790 calls vtable +0x94 ..
// +0xb0 every frame; the player wrappers 0x0068fe48 .. 0x0068ff10 only tick on
// a field, is_player_in_unsafe_map, and not while invisible):
//   poison_effect_tick (0x00777bc8 area): counter + 1; every time it is a
//     multiple of 45 the particle and SE 0xc play and the player loses
//     trunc(HP * 0.0066666668) (0x00978188, fistp in truncation mode), at
//     least 1, plus [0, 2, 5, 10][difficulty] (0x00978180, indexed by
//     g_CurrentDifficulty 0x00a9cd68); the counter goes back to 0. Poison
//     never kills: an HP below 1 is set back to 1. It has no end of its own.
//   unknown_handle_paralysis_effect (0x00777cfc area): a player's paralysis
//     never runs out; the counter only replays the particle (0x26) and SE 0xd
//     every 45 frames.
//   slow_effect_tick / confusion_effect_tick / frozen_effect_tick /
//     shock_effect_tick: frames - 1; at 0 the slot is cleared and the EVP
//     multiplier taken back. Every 45 frames the particle / SE replays.
//
// Effects while active:
//   frozen: HandlePostEvadeDamageCheck_0069f408 / unknown_handle_defend_or_
//     enter_special_npc_dialog put the player into input state 0x13, which
//     takes no movement or attack input until the flag clears (pressing a
//     movement key adds +0x3e0 to the frames left, InputState0x13Invincibility
//     Check_0069d6f4: left out here).
//   slowed: apply_slow_status_effect_to_attack_speed (0x00690300 area)
//     multiplies the player's motion frame step by 0.5 (0x0093c710).
//   paralyzed: ASSUMED to lock movement and attacks like the freeze. No test
//     of the paralyzed bit was found in the player's input states (the only
//     readers of bit 2 in the player code are the 6x0C watcher below and the
//     Antiparalysis use check); newserv describes player paralysis as
//     indefinite and the game's manuals as "cannot move".
//   confused: should_do_confused_movement (0x0068be00 area) changes how the
//     movement input turns the player; left out.
//
// Sync. SinowberillChallengePlayer_UpdateStatusEffects_006894d4 compares the
// six flag bits with the copy at +0x3d8 every frame: a slot that gained an
// effect sends 6x0C {type, 0.0} through vtable +0x140 (0x0068ff70; paralysis
// wins over poison, shock over freeze over confusion over slow), a slot that
// emptied sends 6x0D {slot 0 / 1, 0} (0x006895d4). Receivers run
// ChallengePlayerProcessEntityAction_0068749c (6x0C -> the same vtable entry
// on their copy of the player) and PlayerProcessActionType_006900c0 (6x0D ->
// clear that slot).
//
// Cures:
//   Anti: Player_ClearStatusEffect (vtable +0xec, 0x00779868) by the 0-based
//     level: poison always; level >= 1 shock; >= 2 paralysis; >= 3 confusion;
//     >= 4 slow; >= 5 Jellen / Zalure (combat/buffs.ts); >= 6 freeze.
//   Antidote (03 06 00): the tool's use entry 0x005dee9c (vtable 0x00b0e5e0
//     +0xa8, ConstructItemToolVariant7_005def60) calls the owner's vtable
//     +0xdc = remove_poison_and_paralysis (0x00779574), which only clears a
//     poison. Antiparalysis (03 06 01) calls +0xe0 (0x007795ac), which only
//     clears a paralysis. The item can only be used while the player has that
//     flag (SinowberillChallengePlayer_Process_0068be94: item class 3 / 6,
//     subtype 0 needs flag 1, subtype 1 flag 2).

import { roundHalfEven } from './buffs.ts';

const f32 = Math.fround;

export const STATUS = { freeze: 2, shock: 3, poison: 0x0f, paralysis: 0x10, slow: 0x11, confusion: 0x12 } as const;
export type StatusType = (typeof STATUS)[keyof typeof STATUS];

// Low bits of entity+0x30 (character_flags).
export const STATUS_FLAG: Record<StatusType, number> = {
  [STATUS.poison]: 0x01,
  [STATUS.paralysis]: 0x02,
  [STATUS.shock]: 0x04,
  [STATUS.slow]: 0x08,
  [STATUS.confusion]: 0x10,
  [STATUS.freeze]: 0x20,
};
export const SLOT0_FLAGS = 0x03; // paralyzed | poisoned
export const SLOT1_FLAGS = 0x3c; // frozen | confused | slowed | shocked

export const STATUS_NAME: Record<StatusType, string> = {
  [STATUS.poison]: 'poison',
  [STATUS.paralysis]: 'paralysis',
  [STATUS.shock]: 'shock',
  [STATUS.slow]: 'slow',
  [STATUS.confusion]: 'confusion',
  [STATUS.freeze]: 'freeze',
};

export function statusSlot(type: StatusType): 0 | 1 {
  return type === STATUS.poison || type === STATUS.paralysis ? 0 : 1;
}

export function isStatusType(type: number): type is StatusType {
  return type in STATUS_FLAG;
}

// The particle / sound period of every effect, and the poison damage period.
export const STATUS_PERIOD = 0x2d;
// poison_entity's starting counter.
export const POISON_START = 0x2d;
// 0x00978188 and the difficulty table 0x00978180.
export const POISON_HP_FRACTION = f32(0.006666666828095913);
export const POISON_DIFFICULTY_BONUS = [0, 2, 5, 10] as const;
// Durations in frames (slow_entity 0xd2, confuse_entity 300, freeze_entity
// 0x96, shock_entity 300).
export const SLOW_FRAMES = 0xd2;
export const CONFUSION_FRAMES = 300;
export const FREEZE_FRAMES = 0x96;
export const SHOCK_FRAMES = 300;
// freeze_entity's EVP multiplier (0xbe99999a, the same as 0x0097810c).
export const FREEZE_EVP = f32(-0.3);
// apply_slow_status_effect_to_attack_speed: 0x0093c710.
export const SLOW_MOTION_SCALE = 0.5;

// Sound effects of the ticks / infliction (play_directional_sound_effect ids).
export const STATUS_SE: Record<StatusType, number> = {
  [STATUS.poison]: 0x0c,
  [STATUS.paralysis]: 0x0d,
  [STATUS.slow]: 0x0e,
  [STATUS.confusion]: 0x0f,
  [STATUS.freeze]: 0x10,
  [STATUS.shock]: 0x11,
};

// The poison damage of one 45-frame period: trunc(hp * fraction), at least 1,
// plus the difficulty bonus.
export function poisonDamage(hp: number, difficulty: number): number {
  const t = Math.trunc(Math.max(0, hp) * POISON_HP_FRACTION);
  return (t < 2 ? 1 : t) + (POISON_DIFFICULTY_BONUS[Math.max(0, Math.min(3, difficulty))] ?? 0);
}

// What Player_ClearStatusEffect clears at an Anti level (0-based).
export function antiClears(level: number): StatusType[] {
  if (level < 0) return [];
  const out: StatusType[] = [STATUS.poison];
  if (level >= 1) out.push(STATUS.shock);
  if (level >= 2) out.push(STATUS.paralysis);
  if (level >= 3) out.push(STATUS.confusion);
  if (level >= 4) out.push(STATUS.slow);
  if (level >= 6) out.push(STATUS.freeze);
  return out;
}

interface Slot {
  type: StatusType | 0;
  mult: number; // EVP multiplier
  counter: number; // slot 0: the poison / paralysis counter; slot 1: frames left
}

const empty = (): Slot => ({ type: 0, mult: 0, counter: 0 });

export interface StatusEvents {
  // 6x0C {type, 0.0} / 6x0D {slot}.
  sendAdd(type: StatusType): void;
  sendRemove(slot: 0 | 1): void;
  // The player loses this much HP to poison (already clamped to keep 1 HP).
  poisonDamage(amount: number): void;
  // A particle / sound period of an effect (and the infliction itself).
  pulse(type: StatusType): void;
  log(msg: string): void;
}

// The local player's two status slots. Pure logic: render/combat.ts owns it,
// supplies the HP and the sends, and asks it whether the player may act.
export class PlayerStatus {
  slot0: Slot = empty();
  slot1: Slot = empty();
  // +0x3d8: the flags the 6x0C / 6x0D watcher last saw.
  private synced = 0;
  private events: StatusEvents;
  android = false;

  constructor(events: StatusEvents) {
    this.events = events;
  }

  get flags(): number {
    let f = 0;
    if (this.slot0.type) f |= STATUS_FLAG[this.slot0.type];
    if (this.slot1.type) f |= STATUS_FLAG[this.slot1.type];
    return f;
  }

  has(type: StatusType): boolean {
    return (this.flags & STATUS_FLAG[type]) !== 0;
  }

  // Input state 0x13 (frozen) or a paralysis (ASSUMED, see above): no
  // movement, attacks or techniques.
  get immobile(): boolean {
    return this.has(STATUS.freeze) || this.has(STATUS.paralysis);
  }

  // The player's motion frame step factor (slow).
  get motionScale(): number {
    return this.has(STATUS.slow) ? SLOW_MOTION_SCALE : 1;
  }

  // EVP after the slot multipliers (freeze -0.3; the player's paralysis and
  // shock multipliers are 0): evp + round(mult * evp) per slot.
  evp(base: number): number {
    return base + roundHalfEven(this.slot0.mult * base) + roundHalfEven(this.slot1.mult * base);
  }

  // The vtable +0xb8 .. +0xcc entry of `type` on the local player. Returns
  // false when the player is immune.
  inflict(type: StatusType): boolean {
    if ((type === STATUS.poison || type === STATUS.paralysis) && this.android) return false;
    if (type === STATUS.freeze && this.slot1.type === STATUS.freeze && this.slot1.counter > 0) return false;
    const slot = statusSlot(type) === 0 ? this.slot0 : this.slot1;
    slot.type = type;
    slot.mult = type === STATUS.freeze ? FREEZE_EVP : 0;
    slot.counter =
      type === STATUS.poison
        ? POISON_START
        : type === STATUS.paralysis
          ? 0
          : type === STATUS.slow
            ? SLOW_FRAMES
            : type === STATUS.confusion
              ? CONFUSION_FRAMES
              : type === STATUS.freeze
                ? FREEZE_FRAMES
                : SHOCK_FRAMES;
    this.events.pulse(type);
    return true;
  }

  private clear(slot: 0 | 1): void {
    if (slot === 0) this.slot0 = empty();
    else this.slot1 = empty();
  }

  // Player_ClearStatusEffect(level): returns what it cleared.
  anti(level: number): StatusType[] {
    const cleared: StatusType[] = [];
    for (const t of antiClears(level)) {
      const s = statusSlot(t);
      if ((s === 0 ? this.slot0 : this.slot1).type === t) {
        this.clear(s);
        cleared.push(t);
      }
    }
    return cleared;
  }

  // Antidote (vtable +0xdc) / Antiparalysis (+0xe0).
  cure(type: typeof STATUS.poison | typeof STATUS.paralysis): boolean {
    if (this.slot0.type !== type) return false;
    this.clear(0);
    return true;
  }

  // 6x0C / 6x0D of this player from the server (another client of ours, or a
  // replay): the same entries as a local infliction / PlayerProcessActionType.
  receiveAdd(type: number): void {
    if (isStatusType(type)) this.inflict(type);
  }

  receiveRemove(slot: number): void {
    if (slot === 0 || slot === 1) this.clear(slot);
  }

  // Leaving the field (a floor change keeps the player object; the ticks only
  // run on a field) or dying (ASSUMED: the effects end with the player).
  reset(): void {
    this.slot0 = empty();
    this.slot1 = empty();
    this.sync();
  }

  // One frame on a field. `hp` is the current HP, `dead` whether the player
  // has the dead flag, `difficulty` g_CurrentDifficulty.
  tick(hp: number, dead: boolean, difficulty: number): void {
    const s0 = this.slot0;
    if (s0.type === STATUS.poison) {
      const c = s0.counter + 1;
      if (c % STATUS_PERIOD === 0) {
        this.events.pulse(STATUS.poison);
        s0.counter = 0;
        const damage = poisonDamage(hp, difficulty);
        if (!dead) this.events.poisonDamage(Math.min(damage, Math.max(0, hp - 1)));
      } else {
        s0.counter = c;
      }
    } else if (s0.type === STATUS.paralysis) {
      const c = s0.counter - 1;
      if (c < 1) {
        this.events.pulse(STATUS.paralysis);
        s0.counter = STATUS_PERIOD;
      } else {
        s0.counter = c;
      }
    }
    const s1 = this.slot1;
    if (s1.type) {
      const c = --s1.counter;
      if (c > 0) {
        if (c % STATUS_PERIOD === 0 && s1.type !== STATUS.freeze) this.events.pulse(s1.type);
      } else {
        this.events.log(`${STATUS_NAME[s1.type]} wore off`);
        this.clear(1);
      }
    }
    this.sync();
  }

  // SinowberillChallengePlayer_UpdateStatusEffects_006894d4.
  sync(): void {
    const now = this.flags;
    const changed = this.synced ^ now;
    if (changed & SLOT0_FLAGS) {
      if (!(now & SLOT0_FLAGS)) this.events.sendRemove(0);
      else this.events.sendAdd(now & STATUS_FLAG[STATUS.paralysis] ? STATUS.paralysis : STATUS.poison);
    }
    if (changed & SLOT1_FLAGS) {
      if (!(now & SLOT1_FLAGS)) this.events.sendRemove(1);
      else {
        let t: StatusType = STATUS.slow;
        if (now & STATUS_FLAG[STATUS.slow]) t = STATUS.slow;
        if (now & STATUS_FLAG[STATUS.confusion]) t = STATUS.confusion;
        if (now & STATUS_FLAG[STATUS.freeze]) t = STATUS.freeze;
        if (now & STATUS_FLAG[STATUS.shock]) t = STATUS.shock;
        this.events.sendAdd(t);
      }
    }
    this.synced = now;
  }

  // The status icons of the two slots, in slot order (QuickMenuUpdateShifta
  // StatusIcons_007426d8 walks +0x25c, +0x268, then the technique slots).
  types(): StatusType[] {
    const out: StatusType[] = [];
    if (this.slot0.type) out.push(this.slot0.type);
    if (this.slot1.type) out.push(this.slot1.type);
    return out;
  }
}

// Status effects of enemy melee hits in Forest / Caves. Both are Ultimate
// only (is_ultimate_mode) and roll get_random_float after the hit landed:
//   SavageWolfProcessStateAttack_0051c810: roll <= 0.1 (0x00921304); the
//     Savage Wolf (Gulgus, +0x3e0 == 0) slows (wolf_slow_entity, group 0x11),
//     the Barbarous Wolf (Gulgus-gue) paralyzes (wolf_paralyze_entity, 0x10).
//   The Mothmant attack state at 0x0051784c (named HildebearProcessState in
//     the dump; it reads g_MothmantAnimSpeedParams): roll < 0.05 (0x00920c0c)
//     poisons (mothvist_poison_entity, group 0x0f).
export const WOLF_STATUS_CHANCE = f32(0.1);
export const MOTHMANT_POISON_CHANCE = f32(0.05);

export function meleeHitStatus(enemyType: string, ultimate: boolean, roll: number): StatusType | null {
  if (!ultimate) return null;
  if (enemyType === 'SAVAGE_WOLF') return roll <= WOLF_STATUS_CHANCE ? STATUS.slow : null;
  if (enemyType === 'BARBAROUS_WOLF') return roll <= WOLF_STATUS_CHANCE ? STATUS.paralysis : null;
  if (enemyType === 'MOTHMANT') return roll < MOTHMANT_POISON_CHANCE ? STATUS.poison : null;
  return null;
}

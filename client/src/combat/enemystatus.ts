// Status effects on enemies: what a player's weapon specials and techniques
// do to an enemy (paralysis, freeze, shock, confusion), how long they last,
// how they lock the enemy and how they travel to the other clients, as
// PsoBB.exe runs them (Ephinea 1.25.13, addresses are VAs).
//
// An enemy uses the same two status slots as a player (combat/status.ts): slot
// 0 (+0x25c type, +0x260 EVP multiplier, +0x264 counter) and slot 1 (+0x268 /
// +0x26c / +0x270). The infliction entries are the shared entity functions of
// the enemy vtable, with the enemy branches:
//   +0xb8 poison_entity (0x007788ec): only entities below 0x1000 (players);
//     an enemy is never poisoned.
//   +0xbc maybe_paralyze_entity (0x007789c8): nothing on a machine (+0x2e8 &
//     4), with flag 0x1000000 or the immunity bit +0x11c & 2; else slot 0 =
//     paralysis, EVP multiplier -0.15 (0xbe19999a; EVP += trunc(EVP * -0.15),
//     0x00978100, fistp under RC = 11 at 0x00778a77) and 0xd2 frames.
//   +0xc0 slow_entity (0x00778b10): entities up to 0x1000 only; never an enemy.
//   +0xc4 confuse_entity (0x00778be8): nothing on a mini-boss (+0x2e8 & 0x10)
//     or with +0x11c & 0x10; slot 1 = confusion, 300 frames, multiplier 0.
//   +0xc8 freeze_entity (0x00778cc0): not with flag 0x8000 / 0x1000000 or
//     +0x11c & 0x20, nor while frozen with frames left; slot 1 = freeze,
//     multiplier -0.3 (0x0097810c), 0x96 frames, the ice effect
//     (CreateItemEffectHandler_00500fe8) and SE 0x10.
//   +0xcc shock_entity (0x00778e40): an enemy (0x1000..0x3fff) only when it is
//     a machine (+0x2e8 & 4) without flag 0x1000000 / +0x11c & 4; slot 1 =
//     shock, multiplier -0.15 (0x0097811c), 300 frames, SE 0x11.
//   A new effect in slot 1 first takes back the EVP multiplier of the one it
//   replaces (types 2..3, freeze / shock).
//
// Ticks and the behaviour lock (update_enemy_control_object 0x00787a80,
// enemy_ailment_statuses_tick): every frame the enemy runs vtable
// +0xa0 (confusion_effect_tick), then the lock gate, vtable +0x158 =
// 0x00521920, which ORs the results of +0x98 (paralysis: 0x00777d10, the
// unknown_handle_paralysis_effect), +0xa8 (shock: 0x0077818c) and +0xa4
// (freeze: 0x007780a8). The gate calls all three every frame, with no short
// circuit (0x00521920 reads the three into locals, then ORs them), so a frozen
// enemy's freeze still counts down while it is also paralysed. A nonzero OR
// makes EnemyUpdateLoop (0x0052167c) return 4: the enemy only refreshes its
// reticle and minimap icon (vtable +0x78) and returns: no AI state, no damage
// reaction (+0x88 / +0x100 are skipped). So a paralyzed, shocked or frozen
// enemy stands still; a confused one keeps acting. (ASSUMED: a hit that lands
// during the lock is not consumed here; the port drops it, see render/combat.ts.)
// The 0x4000 hold (Player_ApplyStatusEffect_00779828, dump line 751127, the
// enemy's vtable slot 0xe8): +0x294 = trunc(power) (fistp, RC = 11), +0x28c = 20, flag 0x4000.
// Its one writer is entity_hit_by_tech's always_zero_damage case (tech group
// 20, dump line 748365), which runs on a live enemy whatever its invulnerable
// bits (the invulnerability test skips group 20). The paralysis test (+0x98,
// unknown_handle_paralysis_effect, dump line 750229) runs the hold first, for
// enemies (id > 0xfff): while the flag is set it counts +0x294 down and returns
// 1 (locked) without touching the paralysis; at the count's end it clears the
// flag and the counters, and that frame still returns 1. Shock and freeze run
// on their own (0x00521920 calls all three). The hold is not in the 6x0A's
// status bits (the low six), so it is not sent (ASSUMED).
//   paralysis: counter - 1; while > 0 the flag stays and every 45 frames the
//     particle 0x26 / SE 0xd play; at 0 the slot clears and the EVP comes back.
//   freeze / shock / confusion: frames - 1; at 0 the slot clears.
//
// Sync (send_packet0x60_subcommand0xa, 0x00787710): the enemy's 6x0A carries
// its whole flag word, the six status bits included (1 poison, 2 paralysis,
// 4 shock, 8 slow, 0x10 confusion, 0x20 freeze). In Ultimate the 6x0A flags
// are sent with the low six bits cleared, and when some of those bits are new
// since the last send (+0x338) a 6x9C {entity id, new bits} (0x007877bc) goes
// out first. Receivers: action_hit_enemy (0x007877e8) -> restore_enemy_status
// calls +0xbc / +0xcc / +0xc4 / +0xc8 for every bit that is set
// in the 6x0A flags and not yet on the enemy (not in Ultimate, where the low
// bits are kept local), then ORs the flags in; handle_packet0x60_subcommand0x9c
// (0x007878f4, Ultimate only) does the same for its single bit when the enemy
// is not dead.
//
// Enemy kind (+0x2e8, enemy_attribute: native 1, A.beast 2, machine 4, dark 8,
// mini-boss 0x10): set by each constructor, directly or through
// set_enemy_attribute_to_native / _abeast / _machine / _dark:
// booma, savage_wolf, hildebear, monest, Mothman, dragon -> native;
// shark, PoisonLily, grassassassin, nanodragon, panarms (+ hidoom / migium),
// Derolle -> A.beast; gilchic, Dubchich, Canadine, sinowbeat, garanz, recobox
// -> machine; delsaber, belra, sorcerer, dark_gunner, ChaosBringer, Dark Falz
// -> dark; gibbles, GiGue (native), Mericarol (A.beast), Dorphon (dark) carry
// the mini-boss bit too.

import { chop } from './buffs.ts';
import { STATUS, STATUS_FLAG, STATUS_NAME, type StatusType } from './status.ts';

const f32 = Math.fround;

export const ENEMY_ATTR = { native: 1, abeast: 2, machine: 4, dark: 8, miniboss: 0x10 } as const;

// Enemy kind by newserv enemy type. The rows marked ASSUMED were not traced to
// a constructor (dimenian_constructor, the claw / bulclaw constructors and the
// rappy's runtime rappy_attributes[] do not set it in a way the dump shows);
// they follow the area's kind.
const ATTRIBUTE: Readonly<Record<string, number>> = {
  BOOMA: 1, GOBOOMA: 1, GIGOBOOMA: 1, SAVAGE_WOLF: 1, BARBAROUS_WOLF: 1, HILDEBEAR: 1, HILDEBLUE: 1,
  MONEST: 1, MOTHMANT: 1, DRAGON: 1,
  RAG_RAPPY: 1, AL_RAPPY: 1, // ASSUMED (rappy_attributes[] is filled at run time)
  EVIL_SHARK: 2, PAL_SHARK: 2, GUIL_SHARK: 2, POISON_LILY: 2, NAR_LILY: 2, GRASS_ASSASSIN: 2, NANO_DRAGON: 2,
  PAN_ARMS: 2, HIDOOM: 2, MIGIUM: 2, DE_ROL_LE: 2,
  GILLCHIC: 4, DUBCHIC: 4, CANADINE: 4, CANANE: 4, SINOW_BEAT: 4, SINOW_GOLD: 4, GARANZ: 4, RECOBOX: 4,
  DELSABER: 8, DARK_BELRA: 8, CHAOS_SORCERER: 8, DARK_GUNNER: 8, CHAOS_BRINGER: 8,
  DARK_FALZ_1: 8, DARK_FALZ_2: 8, DARK_FALZ_3: 8,
  DIMENIAN: 8, LA_DIMENIAN: 8, SO_DIMENIAN: 8, CLAW: 8, BULCLAW: 8, BULK: 8, // ASSUMED
  GIBBLES: 0x11, GI_GUE: 0x11, MERICAROL: 0x12, DORPHON: 0x18, DORPHON_ECLAIR: 0x18,
};

export function enemyAttribute(type: string): number {
  return ATTRIBUTE[type] ?? 0;
}

// Frames and EVP multipliers of the enemy branches.
export const ENEMY_PARALYSIS_FRAMES = 0xd2;
export const ENEMY_PARALYSIS_EVP = f32(-0.15); // 0xbe19999a / 0x00978100
export const ENEMY_FREEZE_FRAMES = 0x96;
export const ENEMY_FREEZE_EVP = f32(-0.3); // 0x0097810c
export const ENEMY_SHOCK_FRAMES = 300;
export const ENEMY_SHOCK_EVP = f32(-0.15); // 0x0097811c
export const ENEMY_CONFUSION_FRAMES = 300;
export const ENEMY_STATUS_PERIOD = 0x2d;

// The status bits of the entity flags (the low six of 6x0A's game flags).
export const STATUS_BITS = 0x3f;

interface Slot {
  type: StatusType | 0;
  mult: number;
  frames: number;
}
const empty = (): Slot => ({ type: 0, mult: 0, frames: 0 });

export interface EnemyStatusTick {
  locked: boolean; // +0x98 / +0xa8 / +0xa4 returned 1: the enemy skips its AI
  ended: StatusType[]; // effects that wore off this frame
  pulse: StatusType | null; // a 45-frame particle / sound period (the first of `pulses`)
  pulses: StatusType[]; // every effect whose 45-frame period came up (confusion included)
}

// The two status slots of one enemy.
export class EnemyStatus {
  slot0: Slot = empty();
  slot1: Slot = empty();
  // +0x338: the status bits the last Ultimate 6x9C carried.
  private sent = 0;
  // The 0x4000 hold's frames left (+0x294); null when flag 0x4000 is clear.
  hold: number | null = null;
  readonly attribute: number;

  constructor(attribute: number) {
    this.attribute = attribute;
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

  // Paralyzed, shocked, frozen or held: the enemy control skips the AI.
  get locked(): boolean {
    return this.has(STATUS.paralysis) || this.has(STATUS.shock) || this.has(STATUS.freeze) || this.hold !== null;
  }

  // Whether the status block of the enemy's frame has anything to count.
  get active(): boolean {
    return this.flags !== 0 || this.hold !== null;
  }

  // Player_ApplyStatusEffect_00779828 (vtable 0xe8, from entity_hit_by_tech's
  // always_zero_damage case): the hold lasts trunc(power) ticks (the fistp
  // at 0x00779836 runs under RC = 11, so it truncates).
  applyHold(power: number): void {
    this.hold = chop(power);
  }

  // EVP after the multipliers: evp + trunc(mult * evp) per slot (the paralysis
  // 0x007789c8, the shock 0x00778e40 and the freeze 0x00778cc0 all chop).
  evp(base: number): number {
    return base + chop(this.slot0.mult * base) + chop(this.slot1.mult * base);
  }

  // Whether the entry of `type` takes on this enemy (the immunity checks).
  canTake(type: StatusType): boolean {
    const a = this.attribute;
    switch (type) {
      case STATUS.paralysis:
        return !(a & ENEMY_ATTR.machine);
      case STATUS.shock:
        return (a & ENEMY_ATTR.machine) !== 0;
      case STATUS.confusion:
        return !(a & ENEMY_ATTR.miniboss);
      case STATUS.freeze:
        return !(this.slot1.type === STATUS.freeze && this.slot1.frames > 0);
      default:
        return false; // poison / slow: players only
    }
  }

  // The vtable +0xbc / +0xc4 / +0xc8 / +0xcc entry. False when immune.
  inflict(type: StatusType): boolean {
    if (!this.canTake(type)) return false;
    if (type === STATUS.paralysis) {
      this.slot0 = { type, mult: ENEMY_PARALYSIS_EVP, frames: ENEMY_PARALYSIS_FRAMES };
      return true;
    }
    const mult = type === STATUS.freeze ? ENEMY_FREEZE_EVP : type === STATUS.shock ? ENEMY_SHOCK_EVP : 0;
    const frames = type === STATUS.freeze ? ENEMY_FREEZE_FRAMES : type === STATUS.shock ? ENEMY_SHOCK_FRAMES : ENEMY_CONFUSION_FRAMES;
    this.slot1 = { type, mult, frames };
    return true;
  }

  // One frame of update_enemy_control_object's status block.
  tick(): EnemyStatusTick {
    const ended: StatusType[] = [];
    const pulses: StatusType[] = [];
    const done = (locked: boolean): EnemyStatusTick => ({ locked, ended, pulse: pulses[0] ?? null, pulses });
    // +0xa0 confusion_effect_tick (its result is not used for the lock; every
    // 0x2d frames it makes the particle 0x24 and SE 0xf).
    if (this.slot1.type === STATUS.confusion && this.countDown(1, ended) && this.slot1.frames % ENEMY_STATUS_PERIOD === 0) {
      pulses.push(STATUS.confusion);
    }
    // +0x98 paralysis, +0xa8 shock, +0xa4 freeze: 0x00521920 calls all three
    // and ORs them (no early return), so each counts down every frame.
    let locked = false;
    if (this.hold !== null) {
      // unknown_handle_paralysis_effect's flag 0x4000 branch (dump line 750229):
      // count +0x294 down; at the end clear the hold, and this frame still locks.
      // The paralysis is not counted while the hold runs (its branch returns first).
      if (--this.hold < 1) this.hold = null;
      locked = true;
    } else if (this.slot0.type === STATUS.paralysis && this.countDown(0, ended)) {
      if (this.slot0.frames % ENEMY_STATUS_PERIOD === 0) pulses.push(STATUS.paralysis);
      locked = true;
    }
    const t1 = this.slot1.type;
    if ((t1 === STATUS.shock || t1 === STATUS.freeze) && this.countDown(1, ended)) {
      if (this.slot1.frames % ENEMY_STATUS_PERIOD === 0) pulses.push(t1);
      locked = true;
    }
    return done(locked);
  }

  // frames - 1; true while the effect lasts, else the slot is cleared.
  private countDown(slot: 0 | 1, ended: StatusType[]): boolean {
    const s = slot === 0 ? this.slot0 : this.slot1;
    if (--s.frames > 0) return true;
    if (s.type) ended.push(s.type);
    if (slot === 0) this.slot0 = empty();
    else this.slot1 = empty();
    return false;
  }

  // The status bits of the outgoing 6x0A and, in Ultimate, the 6x9C bits that
  // must go out first (0 = none).
  syncBits(ultimate: boolean): { flags: number; ultimateBits: number } {
    const now = this.flags;
    if (!ultimate) return { flags: now, ultimateBits: 0 };
    const fresh = now & ~this.sent & STATUS_BITS;
    if (fresh) this.sent = now;
    return { flags: 0, ultimateBits: fresh };
  }

  // restore_enemy_status for a received 6x0A: the entry of every status bit
  // that is new on this enemy (not in Ultimate). Returns what was inflicted.
  receiveFlags(flags: number, ultimate: boolean): StatusType[] {
    if (ultimate) return [];
    const out: StatusType[] = [];
    for (const t of [STATUS.paralysis, STATUS.shock, STATUS.confusion, STATUS.freeze] as const) {
      if (flags & STATUS_FLAG[t] && !this.has(t) && this.inflict(t)) out.push(t);
    }
    return out;
  }

  // handle_packet0x60_subcommand0x9c: Ultimate only, one bit.
  receiveUltimate(bits: number, ultimate: boolean, dead: boolean): StatusType | null {
    if (!ultimate || dead || bits & this.flags) return null;
    const t = bits === 2 ? STATUS.paralysis : bits === 4 ? STATUS.shock : bits === 0x10 ? STATUS.confusion : bits === 0x20 ? STATUS.freeze : null;
    if (t === null) return null;
    return this.inflict(t) ? t : null;
  }

  describe(): string {
    return [this.slot0, this.slot1]
      .filter((s) => s.type)
      .map((s) => `${STATUS_NAME[s.type as StatusType]} ${s.frames}f`)
      .join(', ');
  }
}

// --- technique rolls (entity_hit_by_tech, 0x00773afc) ------------------------

// Gibarta / Rabarta (technique group 2, 0x0077494a): after the damage, with
// p = the hit's power argument ((MST + power) * (1 + boost)) and a player
// caster:
//   c = (max(0, p - 250) * 0.025 + 5) * 0.025       (0x00978258, 0x0097825c,
//                                                     0x00978254)
//   not Ultimate, or c <= 0.2 (0x00978248): c = min(c, 0.4) (0x00978244);
//   Ultimate with c > 0.2: c = 0.2 (0x00978250). Then c * 1.0.
//   The roll is a fresh get_random_float; freeze_entity runs when roll < c and
//   the defender is the local player or the attacker is (+0x32c == 1).
// Barta (group 0x13) has no roll.
export function techFreezeChance(power: number, ultimate: boolean): number {
  const c = f32(f32(f32(Math.max(0, f32(power - 250)) * f32(0.025)) + 5) * f32(0.025));
  if (ultimate && c > f32(0.2)) return f32(0.2);
  return Math.min(c, f32(0.4));
}

// Zonde / Gizonde / Razonde (group 3, 0x00774760): a player caster rolls
// 1 / 15 (0x00978260), 0.025 in Ultimate (0x0097825c); shock_entity then only
// takes on a machine.
export function techShockChance(ultimate: boolean): number {
  return ultimate ? f32(0.025) : f32(0.06666667);
}

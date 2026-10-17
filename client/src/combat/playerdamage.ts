// The local player taking damage: the hit / knockback / death / revive states
// of the player state machine of PsoBB.exe (Ephinea 1.25.13, addresses are
// VAs), their field motions, and the 6x subcommands they send.
//
// Player state machine (player+0x32e, enum input_state_1 of the reference
// headers): 5/6/7 = attack 1/2/3 (see combat/attack.ts), 10 = evade,
// 13 = got_hit_light, 14 = got_hit_heavy, 15 = dead.
//
// Entering a state runs the handler with argument 0 (input_state_2.unknown0),
// which ends the previous state and plays the motion the motion set's vtable
// returns (field motion set vtable 0x00b39ec0):
//   handle_input_state_got_hit_light  (0x0069ec4c family, entry FUN_0069ed10):
//     motion slot = vtable +0x60 -> 11, sound effect 0x13, invulnerability =
//     get_invincibility_frames() = invincibility_frames[8 + difficulty] = 60
//     ticks in game (table 0x009690e8; [12 + difficulty] = 120/150/180/210
//     is used when player+0x2b4 == 3).
//   handle_input_state_got_hit_heavy  (entry at 0x0069e7b8's head):
//     motion slot = vtable +0x58 -> 9, sound effect 0x14, player+0x? invuln
//     frames = 300 (literal).
//   handle_input_state_dead: motion slot = vtable +0x64 -> 12 (when death flag
//     0x1 is clear; with it set no motion is played and a "dead helper object"
//     is created instead).
//   handle_input_state_evade_attack: motion slot 10 (vtable +0x5c), the motion
//     the 6x4A handler (action_evade @ 0x0069a9c8) plays.
//   Slot 13 (vtable +0x68) is the stand-up motion played after a revive.
// The slot numbers come from the vtable getters at 0x006a75ac (+0x60 -> 11),
// 0x006a759c (+0x58 -> 9), 0x006a75b4 (+0x64 -> 12), 0x006a75a4 (+0x5c -> 10)
// and 0x006a75bc (+0x68 -> 13), each of which is a `mov eax, N; ret`.
//
// Subcommands (newserv src/CommandFormats.hh; the send sites are
// dispatch_action_got_hit_light / _heavy @ 0x0069ec4c / 0x0069e7b8 and
// dispatch_actions_0x89_0x4d @ 0x0069e234):
//   6x4A G_ShieldAttack_6x4A       {header}                      - attack fully blocked
//   6x4B / 6x4C G_HitByEnemy      {header, u16 angle, u16 hp, f32 vx, f32 vz}
//     6x4B when the damage was <= 25% of max HP, 6x4C above that; 6x4C also
//     recomputes the facing from the knockback velocity when its squared
//     length passes _DAT_0093da04.
//   6x89 G_PlayerDeath            {header, u16 killer entity, u16 0}
//   6x4D G_PlayerDied_6x4D        {header, u32 death_flags}       (player+0x92c)
//   6x4E G_PlayerRevivable_6x4E   {header}                        - Reverser target
//   6x4F G_PlayerRevived_6x4F     {header}
//
// The motion tables below are the field motion tables 0x009cbeec (records) /
// 0x009cbf04 (rlc index lists) read out of PsoBB.exe, [motion type][weapon
// class] -> [rlc entry, frames per tick]; every one of these slots has mode 3
// (play once and hold the last frame) and one flag word, listed per table.

import type { MotionRecord } from '../formats/plymotion.ts';

// slot 9 (vtable +0x58), flags 0xa0000040
// prettier-ignore
const HEAVY_MOTIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[202, 1.4], [105, 1.4], [120, 1.4], [133, 1.4], [146, 1.4], [105, 1.4], [7, 1.8], [17, 1.4], [7, 1.6], [43, 1.4], [105, 1.4], [146, 1.4], [105, 1.4], [202, 1.4], [105, 1.4], [184, 1.4], [105, 1.4], [56, 1.4], [93, 1.8]],
  [[359, 1.5], [336, 1.5], [351, 1.6], [359, 1.5], [351, 1.6], [374, 1.6], [245, 1.6], [256, 1.8], [268, 1.5], [280, 1.5], [336, 1.5], [351, 1.5], [313, 1.5], [359, 1.5], [313, 1.5], [395, 1.5], [336, 1.5], [293, 1.8], [323, 1.6]],
  [[488, 1.5], [488, 1.7], [351, 1.5], [359, 1.5], [351, 1.5], [488, 1.5], [488, 1.6], [256, 1.5], [453, 1.6], [280, 1.5], [488, 1.6], [488, 1.5], [488, 1.5], [488, 1.6], [488, 1.6], [395, 1.5], [336, 1.5], [293, 1.8], [323, 1.6]],
  [[202, 1.4], [105, 1.4], [120, 1.4], [133, 1.4], [146, 1.4], [105, 1.4], [7, 1.8], [17, 1.4], [7, 1.6], [43, 1.4], [105, 1.4], [146, 1.4], [105, 1.4], [202, 1.4], [105, 1.4], [184, 1.4], [105, 1.4], [56, 1.4], [93, 1.8]],
  [[549, 1.5], [336, 1.5], [351, 1.6], [549, 1.5], [351, 1.6], [374, 1.6], [245, 1.6], [256, 1.8], [268, 1.5], [280, 1.5], [336, 1.5], [351, 1.5], [313, 1.5], [549, 1.5], [555, 1.5], [395, 1.5], [336, 1.5], [293, 1.8], [323, 1.6]],
  [[359, 1.5], [336, 1.5], [351, 1.6], [359, 1.5], [351, 1.6], [374, 1.6], [570, 1.6], [256, 1.8], [268, 1.5], [280, 1.5], [336, 1.5], [351, 1.5], [313, 1.5], [549, 1.5], [313, 1.5], [395, 1.5], [336, 1.5], [293, 1.8], [323, 1.6]],
];
// slot 10 (vtable +0x5c), flags 0x20000100
// prettier-ignore
const GUARD_MOTIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[203, 1.9], [106, 1.9], [121, 1.9], [134, 1.9], [147, 1.9], [106, 1.9], [8, 2], [18, 1.5], [8, 1.6], [44, 1.6], [106, 1.9], [147, 1.9], [106, 1.9], [203, 1.9], [106, 1.9], [185, 1.9], [106, 1.9], [57, 1.5], [94, 2]],
  [[360, 1.8], [337, 1.8], [352, 1.8], [360, 1.8], [352, 1.8], [375, 1.8], [246, 1.6], [257, 1.6], [269, 1.8], [281, 1.8], [337, 1.8], [352, 1.8], [314, 1.8], [360, 1.8], [314, 1.8], [396, 1.8], [337, 1.8], [294, 1.6], [324, 1.6]],
  [[489, 1.6], [489, 1.7], [352, 1.8], [360, 1.8], [352, 1.8], [489, 1.8], [489, 1.7], [257, 1.8], [454, 1.7], [281, 1.8], [489, 1.7], [489, 1.7], [489, 1.7], [489, 1.6], [489, 1.6], [396, 1.8], [337, 1.8], [294, 1.6], [324, 1.6]],
  [[203, 1.9], [106, 1.9], [121, 1.9], [134, 1.9], [147, 1.9], [106, 1.9], [8, 2], [18, 1.5], [8, 1.6], [44, 1.6], [106, 1.9], [147, 1.9], [106, 1.9], [203, 1.9], [106, 1.9], [185, 1.9], [106, 1.9], [57, 1.5], [94, 2]],
  [[550, 1.8], [337, 1.8], [352, 1.8], [550, 1.8], [352, 1.8], [375, 1.8], [246, 1.6], [257, 1.6], [269, 1.8], [281, 1.8], [337, 1.8], [352, 1.8], [314, 1.8], [550, 1.8], [556, 1.8], [396, 1.8], [337, 1.8], [294, 1.6], [324, 1.6]],
  [[360, 1.8], [337, 1.8], [352, 1.8], [360, 1.8], [352, 1.8], [375, 1.8], [571, 1.6], [257, 1.6], [269, 1.8], [281, 1.8], [337, 1.8], [352, 1.8], [314, 1.8], [550, 1.8], [314, 1.8], [396, 1.8], [337, 1.8], [294, 1.6], [324, 1.6]],
];
// slot 11 (vtable +0x60), flags 0xa0000040
// prettier-ignore
const LIGHT_MOTIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[204, 3.7], [107, 3.7], [122, 3.7], [135, 3.7], [148, 3], [107, 3.7], [32, 3.7], [19, 3.7], [204, 3.7], [45, 3.7], [107, 3.7], [148, 3.7], [107, 3.7], [204, 3.7], [107, 3.7], [186, 3.7], [107, 3.7], [58, 3.7], [95, 3.7]],
  [[413, 3.7], [338, 3.7], [353, 3.7], [361, 3.7], [353, 3.7], [338, 3.7], [247, 3.7], [258, 3.7], [270, 3.7], [282, 3.7], [338, 3.7], [353, 3.7], [315, 3.7], [413, 3.7], [315, 3.7], [397, 3.7], [338, 3.7], [295, 3.7], [325, 3.7]],
  [[490, 3.7], [490, 3.7], [353, 3.7], [361, 3.7], [353, 3.7], [490, 3.7], [490, 3.7], [258, 3.7], [455, 3.7], [282, 3.7], [490, 3.7], [490, 3.7], [490, 3.7], [490, 3.7], [490, 3.7], [397, 3.7], [338, 3.7], [295, 3.7], [325, 3.7]],
  [[204, 3.7], [107, 3.7], [122, 3.7], [135, 3.7], [148, 3], [107, 3.7], [32, 3.7], [19, 3.7], [204, 3.7], [45, 3.7], [107, 3.7], [148, 3.7], [107, 3.7], [204, 3.7], [107, 3.7], [186, 3.7], [107, 3.7], [58, 3.7], [95, 3.7]],
  [[413, 3.7], [338, 3.7], [353, 3.7], [361, 3.7], [353, 3.7], [338, 3.7], [247, 3.7], [258, 3.7], [270, 3.7], [282, 3.7], [338, 3.7], [353, 3.7], [315, 3.7], [413, 3.7], [315, 3.7], [397, 3.7], [338, 3.7], [295, 3.7], [325, 3.7]],
  [[413, 3.7], [338, 3.7], [353, 3.7], [361, 3.7], [353, 3.7], [338, 3.7], [247, 3.7], [258, 3.7], [270, 3.7], [282, 3.7], [338, 3.7], [353, 3.7], [315, 3.7], [413, 3.7], [315, 3.7], [397, 3.7], [338, 3.7], [295, 3.7], [325, 3.7]],
];
// slot 12 (vtable +0x64), flags 0x80
// prettier-ignore
const DEATH_MOTIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1]],
  [[414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [205, 1], [414, 1]],
  [[491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [491, 1], [414, 1], [414, 1], [205, 1], [414, 1]],
  [[205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1], [205, 1]],
  [[414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [205, 1], [414, 1]],
  [[414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [414, 1], [205, 1], [414, 1]],
];
// slot 13 (vtable +0x68), flags 0x20000400
// prettier-ignore
const REVIVE_MOTIONS: readonly (readonly (readonly [number, number])[])[] = [
  [[109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [21, 1.3], [109, 1.3], [21, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [59, 1.3], [109, 1.3]],
  [[340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [260, 1.3], [340, 1.3], [260, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [398, 1.3], [340, 1.3], [296, 1.3], [340, 1.3]],
  [[340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [260, 1.3], [260, 1.3], [260, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [398, 1.3], [340, 1.3], [296, 1.3], [340, 1.3]],
  [[109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [21, 1.3], [109, 1.3], [21, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [109, 1.3], [59, 1.3], [109, 1.3]],
  [[340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [260, 1.3], [340, 1.3], [260, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [398, 1.3], [340, 1.3], [296, 1.3], [340, 1.3]],
  [[340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [260, 1.3], [340, 1.3], [260, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [340, 1.3], [398, 1.3], [340, 1.3], [296, 1.3], [340, 1.3]],
];

export type HitMotionKind = 'light' | 'heavy' | 'guard' | 'death' | 'revive';

const TABLES: Record<HitMotionKind, { rows: readonly (readonly (readonly [number, number])[])[]; flags: number }> = {
  heavy: { rows: HEAVY_MOTIONS, flags: 0xa0000040 },
  guard: { rows: GUARD_MOTIONS, flags: 0x20000100 },
  light: { rows: LIGHT_MOTIONS, flags: 0xa0000040 },
  death: { rows: DEATH_MOTIONS, flags: 0x80 },
  revive: { rows: REVIVE_MOTIONS, flags: 0x20000400 },
};

// Field motion of one of the hit / death / revive states.
export function hitMotion(motionType: number, weaponClass: number, kind: HitMotionKind): MotionRecord {
  const t = TABLES[kind];
  const row = t.rows[motionType]?.[weaponClass] ?? t.rows[0][0];
  return { index: row[0], mode: 3, next: -1, speed: row[1], flags: t.flags };
}

// Invulnerability after a hit, in game ticks: invincibility_frames[8 + x] = 60
// for a light hit (table 0x009690e8, read by get_invincibility_frames while the
// current scene is `logged_in`) and the literal 300 of the heavy-hit handler.
export const INVULN_TICKS_LIGHT = 60;
export const INVULN_TICKS_HEAVY = 300;

// A hit counts as heavy (6x4C) above a quarter of max HP; newserv's comment on
// G_HitByEnemy_6x4B_6x4C, and the same quarter that makes the enemy-side flag
// 0x400 in combat/formulas.ts (FUN_0077529c / DAT_0097822c).
export const HEAVY_HIT_FRACTION = 0.25;

// Death flags (player+0x92c, dispatch_actions_0x89_0x4d @ 0x0069e234):
// bit 0 "items already dropped", bit 1 "no drop items in inventory" (set when
// CheckForDropItemInInventory @ 0x0069248c returned 0), bit 2 cleared on the
// first death frame.
export const DEATH_FLAG_DROPPED = 1;
export const DEATH_FLAG_NO_DROP = 2;

export type PlayerHitState = 'alive' | 'light' | 'heavy' | 'guard' | 'dead' | 'revivable' | 'reviving';

export interface PlayerDamageEvents {
  // Play one of the field motions on the player's model.
  motion(kind: HitMotionKind): void;
  // Push the player by a knockback velocity (one tick worth).
  push(vx: number, vz: number): void;
  // Face the player this way (6x4C recomputes the facing from the velocity).
  face(angle: number): void;
  // 6x4B / 6x4C.
  sendHit(heavy: boolean, angle: number, hp: number, vx: number, vz: number): void;
  // 6x4A: the attack did no damage.
  sendShieldAttack(): void;
  // 6x89 + 6x4D.
  sendDeath(killerEntityId: number, deathFlags: number): void;
  // 6x4E / 6x4F.
  sendRevivable(): void;
  sendRevived(): void;
  log(msg: string): void;
}

// Knockback velocity of a hit, in world units per tick. The real client's
// knockback is applied by the attacker's `cause_knockback` vtable entry with a
// per-attack strength (3.0 for the generic enemy melee, see combat/enemyai.ts);
// FUN_00694230 then damps the velocity each tick. APPROXIMATED here as a
// single impulse along the hit direction that decays by DAMPING per tick.
export const KNOCKBACK_DAMPING = 0.75;
// _DAT_0093da04: above this squared velocity 6x4C turns the player to face the
// knockback direction. Not read out of the binary; ASSUMED small enough that
// any real knockback passes it.
export const KNOCKBACK_TURN_SPEED_SQ = 0.01;

// The local player's HP, hit motions and death / revive flow. Pure logic: the
// owner (render/combat.ts) supplies the motions, the movement and the sends.
export class PlayerDamage {
  hp = 0;
  maxHp = 0;
  state: PlayerHitState = 'alive';
  // Ticks of invulnerability left (a hit while this is positive is ignored).
  invuln = 0;
  deathFlags = 0;
  private events: PlayerDamageEvents;
  private vx = 0;
  private vz = 0;
  private motionTicks = 0; // ticks left in the current hit / death motion
  private killer = 0xffff;

  constructor(events: PlayerDamageEvents) {
    this.events = events;
  }

  // Entering a floor (or a fresh character): full HP, alive.
  reset(maxHp: number, hp = maxHp): void {
    this.maxHp = Math.max(1, maxHp);
    this.hp = Math.max(0, Math.min(this.maxHp, hp));
    this.state = 'alive';
    this.invuln = 0;
    this.deathFlags = 0;
    this.vx = 0;
    this.vz = 0;
    this.motionTicks = 0;
  }

  // True while the player must not move or attack on its own.
  get busy(): boolean {
    return this.state !== 'alive';
  }

  get dead(): boolean {
    return this.state === 'dead' || this.state === 'revivable';
  }

  // One attack against the player. `damage` is the rounded total (0 = the hit
  // did nothing: the client sends 6x4A instead), `angle` the direction the hit
  // came from in radians, `strength` the knockback magnitude.
  hit(damage: number, angle: number, strength: number, killerEntityId = 0xffff): void {
    if (this.dead || this.state === 'reviving') return;
    if (this.invuln > 0) return;
    if (damage < 1) {
      // 6x4A: the attack was fully shielded (the client plays the evade motion).
      this.state = 'guard';
      this.motionTicks = 20;
      this.events.motion('guard');
      this.events.sendShieldAttack();
      return;
    }
    this.killer = killerEntityId;
    this.hp = Math.max(0, this.hp - Math.round(damage));
    const heavy = damage > this.maxHp * HEAVY_HIT_FRACTION;
    this.vx = Math.sin(angle) * strength;
    this.vz = Math.cos(angle) * strength;
    // 6x4C turns the player to face the knockback direction when the velocity
    // is fast enough (the staggering sibling of the two hit commands).
    let facing = angle;
    if (heavy && this.vx * this.vx + this.vz * this.vz > KNOCKBACK_TURN_SPEED_SQ) {
      facing = Math.atan2(this.vx, this.vz);
      this.events.face(facing);
    }
    this.events.sendHit(heavy, facing, this.hp, this.vx, this.vz);
    if (this.hp < 1) {
      this.die();
      return;
    }
    this.state = heavy ? 'heavy' : 'light';
    this.invuln = heavy ? INVULN_TICKS_HEAVY : INVULN_TICKS_LIGHT;
    this.motionTicks = heavy ? 40 : 20;
    this.events.motion(heavy ? 'heavy' : 'light');
    this.events.log(`hit for ${Math.round(damage)}: ${this.hp}/${this.maxHp} HP`);
  }

  private die(): void {
    this.state = 'dead';
    this.invuln = 0;
    this.motionTicks = 60;
    // The first death frame clears flag 4 and sets flag 2 when the inventory
    // has nothing to drop; this client never drops items on death, so the
    // "no drop" bit is always set and the "already dropped" bit stays clear.
    this.deathFlags = DEATH_FLAG_NO_DROP;
    this.events.motion('death');
    this.events.sendDeath(this.killer, this.deathFlags);
    this.events.log('you died');
  }

  // Another player's Reverser / Moon Atomizer, or the web client's own revive
  // key. The real client cannot revive itself; this is the 6x4F path.
  revive(hp = Math.max(1, Math.round(this.maxHp * 0.125))): void {
    if (!this.dead) return;
    this.state = 'reviving';
    this.hp = Math.min(this.maxHp, Math.max(1, hp));
    this.motionTicks = 40;
    this.invuln = INVULN_TICKS_LIGHT;
    this.deathFlags = 0;
    this.events.motion('revive');
    this.events.sendRevived();
    this.events.log(`revived with ${this.hp}/${this.maxHp} HP`);
  }

  // One game tick (30 per second).
  tick(): void {
    if (this.invuln > 0) this.invuln--;
    if (this.vx || this.vz) {
      this.events.push(this.vx, this.vz);
      this.vx *= KNOCKBACK_DAMPING;
      this.vz *= KNOCKBACK_DAMPING;
      if (Math.abs(this.vx) < 0.05 && Math.abs(this.vz) < 0.05) {
        this.vx = 0;
        this.vz = 0;
      }
    }
    if (this.motionTicks > 0) this.motionTicks--;
    if (this.motionTicks > 0) return;
    if (this.state === 'light' || this.state === 'heavy' || this.state === 'guard' || this.state === 'reviving') {
      this.state = 'alive';
    } else if (this.state === 'dead') {
      // The death motion ended: 6x4E creates the particle a Reverser can target.
      this.state = 'revivable';
      this.events.sendRevivable();
    }
  }
}

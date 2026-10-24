// Battle Mode player traps and the player-versus-player rules, following PsoBB.exe
// (Ephinea 1.25.13). Pure logic, no three.js and no network, so it runs in Node tests.
//
// Tags: VERIFIED = read from the exe here (objdump of .text, exedata.py reads) or from
// newserv (vendor/newserv, read-only); ASSUMED = from the earlier trace notes, not
// re-checked; UNCLEAR = the decoded code did not settle it.
//
// Placing: the local palette press sends 6x83 with the owner's count BEFORE the
// decrement. VERIFIED: handle_packet0x60_subcommand0x83 (0x00695930) copies the 8-byte
// subcommand and runs the validator 0x006a9ea4 (type 0..3, count >= 0), then
// safe_create_trap_object 0x0062f830 (refuses unless the global at 0x009f9860 == 1, see
// TRAP_GATE_VALUE; then refuses a boss map (current_map_is_boss_map == 1), a missing owner,
// or an owner's floor word of 0xffff / 0x1000 or one that differs from the current floor at
// 0x00aafca0), then the owner's counter at +0x89c is decremented (0x00698954). The 8-byte
// subcommand is:
//   [0] 0x83 subcommand id, [1] 2 (size in words), [2..3] client id,
//   [4..5] trap type (i16), [6..7] count (i16).
// VERIFIED (2026-10-21, exe bytes): the palette slot is group 1 = 4 with group 2 = 0x0d..0x10
// (HandlePaletteInput 0x0068aadc, jump table 0x0093c5c0); the type is group 2 - 0x0d
// (trapPaletteType). The special handler 0x006959c0 sends `c6 04 24 83` / `c6 44 24 01 02`
// (0x83, 2), the client id from +0x1c, the type, and the counter read by 0x00698984 (the
// count before the decrement); it refuses a count that is not > 0 (`test eax,eax; jg`).
// ASSUMED: the remaining palette-side guards (not remote, not lobby / boss map) are from the
// earlier trace and were not re-checked. The validator's predicate (dump line 595030,
// is_packet0x60_subcommand_sent_by_self) refuses a 6x83 that the client sent itself unless
// g_IsActionExecuting is set, so a self echo is not placed twice; the local placement runs
// during the palette action. UNCLEAR: how the exe dispatches its own send (checked_call_
// packet0x60_subcommand) was not traced, and the server's echo behaviour is not checked.
//
// The trap object (vtable 0x00b2a5c0; constructor 0x0062f9a8 with the base 0x0062ed74):
//   VERIFIED: +0x35c effect group: type 0 -> 1 (damage), type 2 -> 0x11 (slow),
//   type 3 -> 0x12 (confusion); type 1 (freeze) takes a separate path. +0x360 = 0 for
//   types 2 and 3. +0x388 "announced" = 0. +0x386 is the trap number (its store is on
//   the path after the constructor; the formula is ASSUMED: count + client * 0x50 +
//   type * 0x14, see battle.ts trapNumber).
//   ASSUMED: arming delay +0x84 = 0x96 frames, fuse +0x88 = 0x1e frames (the exe does not
//   store these as immediates in the trap code; the place they are set is not traced);
//   trigger radius +0x354 and blast radius +0x358 = 50.0 (0x42480000), 80.0 in Ultimate
//   outside battle (the float literals exist in the exe but the trap-specific store was
//   not located).
//
// The state machine (update_trap 0x0062f4a4, the 6x80 handler 0x0062f2d4):
//   state 0: ASSUMED: the delay counts down; then the first live player on the floor
//     within the trigger radius stuns the trap into state 3 (the owner only when
//     g_BATrapsCanTargetOwnerPlayer).
//   state 3: ASSUMED: the fuse counts down; when it was already negative the state becomes
//     4 and 6x80 {trap number, what 2} is sent.
//   state 4: ASSUMED: the blast hits every other live entity in the blast radius (a
//     remote player is left to its own client); another trap in range is hit
//     (unknown_player_hit_trap 0x0062f1f0): a trap in state 0 is stunned and its fuse is
//     capped at 0xf (VERIFIED: 0x0062f269..0x0062f274 cmp 0x10 / movl $0xf to +0x88), a
//     trap in state 3 goes to state 4 at once with its own 6x80 (VERIFIED: the state 3
//     branch at 0x0062f280..0x0062f28c sets state 4 and pushes what 2). Then state 5 and
//     the death effect (particle 0x47, ASSUMED) and the object is removed.
//   6x80 (VERIFIED: the trap number is the u16 at +4, what the u16 at +6): finds the trap
//     by number; what 1 stuns a state-0 trap (ASSUMED), what 2 sets state 4 (VERIFIED for
//     state 0..3 targets as the chain path above; the exact guard is ASSUMED).

import { STATUS, type StatusType } from '../combat/status.ts';
import { roundEven, trapNumber } from './battle.ts';

export { trapNumber };

export const TRAP_ARM_FRAMES = 0x96; // ASSUMED
export const TRAP_FUSE_FRAMES = 0x1e; // ASSUMED
export const TRAP_CHAIN_FUSE = 0x0f; // VERIFIED (0x0062f274)
export const TRAP_TRIGGER_RADIUS = 50; // ASSUMED
export const TRAP_BLAST_RADIUS = 50; // ASSUMED (80 in Ultimate outside battle, not modelled)
// The reveal range (TrapProcessHitbox_0062ea74, dump 492200): g_TrapHitboxRangeSq at 0x00932bc0
// is 40000.0 (VERIFIED: exedata read), i.e. 200 units; the squared XZ distance is compared to it.
export const TRAP_REVEAL_RANGE_SQ = 40000;
// Upper bound of a trap count: 0x14 = 20. VERIFIED: the counter read (0x00698984) clamps
// 0..0x14 (the exe bytes), and safe_create_trap_object refuses a count of 0x15 or more (dump).
// The 6x83 validator 0x006a9ea4 itself only refuses a negative count (VERIFIED).
export const TRAP_MAX_COUNT = 0x14;
// The gate of the trap constructor (0x0062f9a8: `cmp edx,1; je` at 0x0062fa75..0x0062fa7e,
// else the trap is marked inert at +8) and of safe_create_trap_object (0x0062f857..0x0062f85f,
// `cmp eax,1; je`, else nothing is placed). VERIFIED: the global is 0x009f9860, a dword whose
// .data image value is 1 (exedata.py read). The exe has 34 reads of it and no write: no
// absolute store, no immediate / lea / push of its address, no displacement form (a scan of
// the disassembly). So it stays 1 in this build (ASSUMED that no indirect writer exists).
// The project's notes call it the online flag (formats/enemymodels.ts, docs/PROTOCOL.md).
// NOT 0x00a4372c: the Ghidra dump's name gDragonControlAlwaysActive_00a4372c is for another
// build; in PsoBB.exe that address is never referenced (and lies past the initialised data).
export const TRAP_GATE_ADDRESS = 0x009f9860;
export const TRAP_GATE_VALUE = 1;
// The draw state: EnemyDraw_0062e014 draws the trap model only while +0x32e == 3, and
// set_entity_stunned_by_damage (dump line 493079; its address was not traced) sets 3. A trap in
// state 0 is not drawn by the exe's render slot.
export const TRAP_DRAW_STATE = 3;
// The death effect: TrapEnemyTriggerDeathEffect_0062e9e0 pushes particle 0x47 and the
// trap's position (+0xc0, ASSUMED to be the trap's x / y / z) on the blast (update_trap
// state 4 -> 5). VERIFIED for the id.
export const TRAP_DEATH_PARTICLE = 0x47;
export const TECH_DAMAGE_SCALE = 0.002; // ASSUMED (0x00978270 read not performed)

// The wire / counter type (the internal trap type 0..3) and what it does. VERIFIED against
// newserv's QuestScript (the quest's ba_set_trap_count arg 0 damage, 1 slow, 2 confuse,
// 3 freeze, remapped to internal 0, 2, 3, 1) and the constructor's effect groups.
export type TrapEffect = { kind: 'damage' } | { kind: 'status'; status: StatusType };
export const TRAP_EFFECTS: readonly TrapEffect[] = [
  { kind: 'damage' },
  { kind: 'status', status: STATUS.freeze },
  { kind: 'status', status: STATUS.slow },
  { kind: 'status', status: STATUS.confusion },
];

// The 6x83 subcommand as the handler reads it (the 8 bytes from the subcommand id on).
export interface PlaceTrap {
  clientId: number;
  type: number;
  count: number;
}

export function parse6x83(body: Uint8Array): PlaceTrap | null {
  if (body.length < 8 || body[0] !== 0x83) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { clientId: dv.getUint16(2, true), type: dv.getInt16(4, true), count: dv.getInt16(6, true) };
}

export interface TrapCall {
  trapNumber: number;
  what: number;
}

// The 6x80 subcommand: trap number at +4, what at +6 (VERIFIED from 0x0062f2d4).
export function parse6x80(body: Uint8Array): TrapCall | null {
  if (body.length < 8 || body[0] !== 0x80) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { trapNumber: dv.getUint16(4, true), what: dv.getUint16(6, true) };
}

// A player's trap stock (player +0x89c, one char per type). The clamp to 0..0x14 is ASSUMED.
export class TrapCounters {
  readonly n = [0, 0, 0, 0];

  // ResetAll_00690674: with trap mode ALL_PLAYERS every counter takes the rule.
  setFromRules(counts: readonly number[] | null): void {
    if (counts) for (let i = 0; i < 4; i++) this.n[i] = Math.max(0, Math.min(TRAP_MAX_COUNT, counts[i] ?? 0));
  }

  // ASSUMED: a value outside 0..0x14 reads (and becomes) 0.
  get(type: number): number {
    const v = this.n[type] ?? 0;
    if (v < 0 || v > TRAP_MAX_COUNT) {
      this.n[type] = 0;
      return 0;
    }
    return v;
  }

  // DecrementTrapCounter (0x00698954, VERIFIED to be called after a successful create):
  // false (and 0) when it would go negative.
  decrement(type: number): boolean {
    const v = this.n[type]! - 1;
    if (v >= 0) {
      this.n[type] = v;
      return true;
    }
    this.n[type] = 0;
    return false;
  }
}

export interface PlaceContext {
  floor: number; // the local current floor
  gate: number; // the global at TRAP_GATE_ADDRESS (0x009f9860); a trap is placed only when it is TRAP_GATE_VALUE
  bossMap: boolean; // current_map_is_boss_map() (safe_create refuses when it returns 1)
  fieldMap: boolean; // not the lobby / Pioneer 2 (ASSUMED mapping of the 0xffff / 0x1000 floor test)
  ownerFloor: number;
  ownerPos: { x: number; y: number; z: number };
  ownerAngle: number;
}

// The palette slot that places a trap: group 1 = 4 (item) and group 2 = 0x0d..0x10; the trap
// type is group 2 - 0x0d. VERIFIED (see the header). Other item group 2 values are not traps.
export const TRAP_PALETTE_FIRST = 0x0d;
export function trapPaletteType(group2: number): number | null {
  const t = group2 - TRAP_PALETTE_FIRST;
  return t >= 0 && t <= 3 ? t : null;
}

// The local palette press: returns the 6x83 count to send, or null. The count sent is the
// one BEFORE the decrement. The palette-side guards are in the header.
export function placeRequest(counters: TrapCounters, type: number, canAct: boolean): PlaceTrap | null {
  if (!canAct || type < 0 || type > 3) return null;
  const count = counters.get(type);
  if (count < 1) return null;
  return { clientId: -1, type, count };
}

export type TrapState = 0 | 3 | 4 | 5;

export class BattleTrap {
  state: TrapState = 0;
  delay = TRAP_ARM_FRAMES; // ASSUMED
  fuse = TRAP_FUSE_FRAMES; // ASSUMED
  readonly number: number;
  announced = false; // +0x388: the "<name> TRAP" line was shown
  // +0xa4 (the trap's hitboxes field, TrapProcessHitbox_0062ea74): 0 hidden, 2 revealed to the owner
  // (the owner's trap vision and invincibility check). The state 2 position copy is not ported (UNCLEAR).
  hitbox: 0 | 2 = 0;
  readonly owner: number;
  readonly type: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly floor: number;
  readonly angle: number;
  constructor(owner: number, type: number, count: number, x: number, y: number, z: number, floor: number, angle: number) {
    this.owner = owner;
    this.type = type;
    this.x = x;
    this.y = y;
    this.z = z;
    this.floor = floor;
    this.angle = angle;
    this.number = trapNumber(owner, type, count);
  }
}

export interface TrapTarget {
  id: number; // client id
  x: number;
  z: number;
  floor: number;
  dead: boolean;
  local: boolean; // the effect is applied by this client only to its own player
  // The owner's checks of TrapProcessHitbox_0062ea74 (read from the player when the trap is revealed):
  // trapVision = the vision bit 0x10000 of unknown_flags_2 (+0x33c), set for androids (player class
  // flag 0x10, UpdatePlayerEntityStateAndFlags_00695b48); challengeOne = the player's +0x32c word is 1.
  // ASSUMED: the +0x32c word is the challenge type set by SinowberillChallengePlayer_SetChallengeType_00686984
  // (1 for types 0..3); the dump names it unknown_flags_invincibility, but its writers are the challenge
  // type, so the battle players are taken as type 1 by the caller.
  trapVision?: boolean;
  challengeOne?: boolean;
}

export type TrapEvent =
  | { kind: 'send80'; trap: BattleTrap; what: number } // 6x80
  | { kind: 'hit'; trap: BattleTrap; target: TrapTarget } // the blast reached a player (the local one: apply the effect)
  | { kind: 'announce'; trap: BattleTrap } // show "<owner> TRAP" once
  | { kind: 'burst'; trap: BattleTrap }; // the death effect and the removal

export interface TrapRules {
  trapsHitOwner: boolean; // g_BATrapsCanTargetOwnerPlayer
  // get_player_room_id(trap) == get_player_room_id(owner) (the reveal's room test). ASSUMED false when
  // the caller has no room data (the battle field has none in this port), so only the range counts.
  sameRoom?: (t: BattleTrap, owner: TrapTarget) => boolean;
}

const dist2 = (ax: number, az: number, bx: number, bz: number): number => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

// TrapProcessHitbox_0062ea74 (hitboxes == 0 branch, VERIFIED from the disassembly 0x0062ea74..0x0062eb32):
// the owner (GetPlayer(+0xa8)) must exist, have the challenge word 1 (+0x32c) and the vision bit
// (+0x33c & 0x10000). Then the trap is revealed when the squared XZ distance to the owner is at most
// g_TrapHitboxRangeSq (40000) or the two are in the same room (the exe returns only when the distance
// is over the range and the rooms differ).
export function trapRevealed(t: BattleTrap, owner: TrapTarget | undefined, sameRoom: boolean): boolean {
  if (!owner || !owner.challengeOne || !owner.trapVision) return false;
  return dist2(t.x, t.z, owner.x, owner.z) <= TRAP_REVEAL_RANGE_SQ || sameRoom;
}

export class TrapField {
  readonly traps: BattleTrap[] = [];

  // handle_packet0x60_subcommand0x83 + safe_create_trap_object. The caller has already
  // checked that the owner exists; `counters` is the owner's stock.
  place(p: PlaceTrap, ctx: PlaceContext, counters: TrapCounters): BattleTrap | null {
    if (ctx.gate !== TRAP_GATE_VALUE) return null; // VERIFIED (0x0062f857): the global must be 1
    if (p.type < 0 || p.type > 3 || p.count < 0) return null; // VERIFIED (0x006a9ea4)
    // safe_create_trap_object (dump line 492781): the count must be below 0x15. The palette side never
    // sends more (the counter clamps to 0..0x14, 0x00698984, VERIFIED).
    if (p.count > TRAP_MAX_COUNT) return null;
    if (ctx.ownerFloor !== ctx.floor || ctx.bossMap || !ctx.fieldMap) return null; // VERIFIED shape, ASSUMED mapping
    const t = new BattleTrap(p.clientId, p.type, p.count, ctx.ownerPos.x, ctx.ownerPos.y, ctx.ownerPos.z, ctx.floor, ctx.ownerAngle);
    this.traps.push(t);
    counters.decrement(p.type);
    return t;
  }

  find(number: number): BattleTrap | undefined {
    return this.traps.find((t) => t.number === number && t.state !== 5);
  }

  // handle_packet0x60_subcommand0x80. ASSUMED: what 0 has no effect.
  receiveCall(c: TrapCall): void {
    const t = this.find(c.trapNumber);
    if (!t) return;
    if (c.what === 1) {
      if (t.state === 0) this.stun(t);
    } else if (c.what === 2) {
      if (t.state === 0 || t.state === 3) t.state = 4;
    }
  }

  private stun(t: BattleTrap): void {
    t.state = 3; // ASSUMED: set_entity_stunned_by_damage
  }

  // unknown_player_hit_trap: another trap's blast reached this one. VERIFIED for the fuse cap
  // and the state 3 -> 4 step (see the header).
  private chainHit(t: BattleTrap, events: TrapEvent[]): void {
    if (t.state === 0) {
      this.stun(t);
      if (t.fuse >= 0x10) t.fuse = TRAP_CHAIN_FUSE;
    } else if (t.state === 3) {
      t.state = 4;
      events.push({ kind: 'send80', trap: t, what: 2 });
    }
  }

  // One 30 Hz frame of every trap (update_trap). `targets` are the players in the game.
  tick(targets: readonly TrapTarget[], rules: TrapRules): TrapEvent[] {
    const events: TrapEvent[] = [];
    // TrapProcessHitbox_0062ea74: a hidden trap is revealed to its owner (hitbox 0 -> 2), once.
    for (const t of this.traps) {
      if (t.hitbox !== 0 || t.state === 5) continue;
      const owner = targets.find((g) => g.id === t.owner);
      if (owner && trapRevealed(t, owner, rules.sameRoom?.(t, owner) ?? false)) t.hitbox = 2;
    }
    for (const t of [...this.traps]) {
      if (t.state === 0) {
        if (t.delay > 0) {
          t.delay--;
          continue;
        }
        for (const g of targets) {
          if (g.dead || g.floor !== t.floor) continue;
          if (g.id === t.owner && !rules.trapsHitOwner) continue;
          if (dist2(t.x, t.z, g.x, g.z) < TRAP_TRIGGER_RADIUS * TRAP_TRIGGER_RADIUS) {
            this.stun(t);
            break;
          }
        }
      } else if (t.state === 3) {
        const old = t.fuse--;
        if (old < 0) {
          t.state = 4;
          events.push({ kind: 'send80', trap: t, what: 2 });
        }
      } else if (t.state === 4) {
        for (const g of targets) {
          if (g.dead || g.floor !== t.floor) continue;
          if (g.id === t.owner && !rules.trapsHitOwner) continue;
          if (dist2(t.x, t.z, g.x, g.z) >= TRAP_BLAST_RADIUS * TRAP_BLAST_RADIUS) continue;
          if (g.local) events.push({ kind: 'hit', trap: t, target: g });
          if (!t.announced) {
            t.announced = true;
            events.push({ kind: 'announce', trap: t });
          }
        }
        for (const o of this.traps) {
          if (o === t || o.state === 5) continue;
          if (dist2(t.x, t.z, o.x, o.z) < TRAP_BLAST_RADIUS * TRAP_BLAST_RADIUS) this.chainHit(o, events);
        }
        t.state = 5;
        events.push({ kind: 'burst', trap: t });
      }
    }
    for (let i = this.traps.length - 1; i >= 0; i--) if (this.traps[i]!.state === 5) this.traps.splice(i, 1);
    return events;
  }

  clear(): void {
    this.traps.length = 0;
  }
}

// The "<name> TRAP" line. ASSUMED: "\tC4" + name + " TRAP\n" (Trap_CheckPlayerInBattleAndGetName).
export const trapAnnouncement = (name: string): string => `\tC4${name} TRAP`;

// --- the trap model -------------------------------------------------------------

// The trap is drawn only in the draw state (TRAP_DRAW_STATE). The model is bm_o_mine.bml
// (LoadMineTrapBMLData_006300a4, string at 0x009c6048 -> 0x00932ce0). VERIFIED from the
// constructor's switch on the effect group: type 0 (damage) and 1 (freeze) draw the njcm /
// njtl chunk 4 as the primary model and chunk 1 as the secondary (0x37c / 0x380); types 2
// (slow) and 3 (confusion) draw chunks 5 and 0. ASSUMED: chunk n is model entry n of the
// web's archive (objectmodels / enemymodel count the models first).
export interface TrapModelParts {
  primary: number;
  secondary: number;
}
export function trapModelParts(type: number): TrapModelParts {
  return type === 2 || type === 3 ? { primary: 5, secondary: 0 } : { primary: 4, secondary: 1 };
}

export function trapDrawn(t: BattleTrap): boolean {
  return t.state === TRAP_DRAW_STATE;
}

// --- trap vision --------------------------------------------------------------

// Whether a trap is drawn for the local player. newserv documents the has-trap-vision flag
// (0x00100000 in the player's unknown flags) as permanent for androids and temporary after
// a Trap Vision tool (VERIFIED in newserv). ASSUMED: the model is drawn for everyone with the
// flag, and for the owner when the quest showed self traps; the draw function was not traced.
export function trapVisible(t: BattleTrap, localId: number, hasTrapVision: boolean, showSelfTraps: boolean): boolean {
  return hasTrapVision || (t.owner === localId && showSelfTraps);
}

// --- player versus player -------------------------------------------------------

// The damage a damage trap does to a player. ASSUMED: the entity_hit_by_tech formula
// (100 - EFR) * 0.002 * power rounded to nearest even, with the player's EFR taken as 0
// (armor resistances are not tracked). The base 700.0 matches newserv's documented default
// trap damage (700.0 * area factor * 2.0 * (0.01 * level + 0.1)); the battle value is UNCLEAR.
export function trapDamage(power: number, efr = 0): number {
  const f = Math.fround;
  return roundEven(f(f(f(100 - efr) * f(TECH_DAMAGE_SCALE)) * f(Math.max(0, power))));
}

// ApplyHitEffectText: what the victim's client records and sends when `amount` damage hurts
// it. ASSUMED: a trap attacker is replaced by its owner; only a player attacker is scored
// and reported (a monster's hit is just damage taken).
export interface HitReport {
  attacker: number | null; // the player to credit, null: an enemy
  send6x8F: boolean;
}

export function hitReport(attackerKind: 'player' | 'trap' | 'enemy', owner: number | null, attackerId: number): HitReport {
  if (attackerKind === 'enemy') return { attacker: null, send6x8F: false };
  if (attackerKind === 'trap') return owner === null ? { attacker: null, send6x8F: false } : { attacker: owner, send6x8F: true };
  return { attacker: attackerId, send6x8F: true };
}

// ASSUMED (ProcessExperienceGainEffect): the killer's kill score is skipped when both players
// are on the same team with teams on.
export function killCounts(teamsOn: boolean, killerTeam: number, victimTeam: number): boolean {
  return !(teamsOn && killerTeam === victimTeam);
}

// --- the death / respawn teleport -----------------------------------------------

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  angle: number;
}

// The candidate list is built by the caller. VERIFIED from SendTeleportRequestToPlayer
// (0x00695444): the walk takes at most 5 candidates (the loop stops past index 4), and the
// index is ROUND(count * (rnd / 32768) * 0.99) where rnd is the raw 15-bit random value
// (the constants at 0x0093c694 = 32768.0 and 0x0093c690 = 0.99 were read from the exe).
// VERIFIED: the distance filter threshold at 0x0093c68c is 2500.0 (50 squared), not 0; the
// branch sense of that compare is UNCLEAR in the decoded code, so the filter is left to the
// caller. An index past the list (it can reach count) gives null: the player stays where it died.
export function pickRespawn(points: readonly SpawnPoint[], rnd: number): SpawnPoint | null {
  const list = points.slice(0, 5);
  if (!list.length) return null;
  const i = roundEven(Math.fround(Math.fround(list.length * Math.fround(Math.fround(rnd) / 32768)) * Math.fround(0.99)));
  return list[i] ?? null;
}

// The candidates of SendTeleportRequestToPlayer (0x00695444): the floor's player spawns in
// their list order, skipping a spawn that a player other than the one respawning stands within
// the threshold of (xz distance squared below 2500, the constant at 0x0093c68c, VERIFIED), and
// stopping at 5 candidates. The dead player's own position is not in `others`.
export const RESPAWN_PLAYER_DISTANCE_SQ = 2500;

export function respawnCandidates(points: readonly SpawnPoint[], others: readonly { x: number; z: number }[]): SpawnPoint[] {
  const out: SpawnPoint[] = [];
  for (const p of points) {
    if (out.length >= 5) break;
    const near = others.some((o) => (o.x - p.x) ** 2 + (o.z - p.z) ** 2 < RESPAWN_PLAYER_DISTANCE_SQ);
    if (!near) out.push(p);
  }
  return out;
}

// NPC players' follow state (6x69 commands 1-3), the rules the exe applies in
// the 0x69 row of the 0x60 subcommand table (g_Packet0x60SubcommandTable row
// 0x69 = 0x007b3f04, SinowberillChallenge_DispatchPacket_007b3f04, .c:798360;
// the dump's Sinowberill names are community guesses, the body is the 6x69
// receiver). Body: {69, 03, u16 unused, u16 param1 (+4), u16 param2 (+6, the
// NPC's player slot), u16 command (+8), u16 param3 (+10, template)}.
//
// Traced (exe):
//  - command 0 / 3 (create): the NPC is a player object built with
//    SinowberillChallengePlayer_Constructor_00686258, whose constructor sets
//    unknown_flags_invincibility (+0x32c) = 7 and the leader (+0x750) = 0xffff
//    (.c:552273, .c:552337). The client named by param1 == its own slot is the
//    owner: it also builds the AI object (SinowberillChallengeBoss_Constructor_
//    007aea10, .c:798404); the others build only the player (.c:798452). Command 3
//    also runs Player_ProcessActionPacket on the new player (the action state).
//  - command 1 (stop acting): the player at slot param1 with flag 3 gets its
//    leader cleared (+0x750 = 0xffff, .c:798425).
//  - command 2 (start acting): every player in slots 0..3 with flag 3 gets
//    +0x750 = param1 (the leader to follow, .c:798433).
//  - flag 3 is set on an NPC when its owner leaves and the next client takes over
//    (SinowberillChallenge_CheckAndReassignPlayer_007b46f8, .c:798808), and the
//    leader it follows is the taking-over client's slot.
//  - a follower with a leader (+0x750 != 0xffff) moves to the leader's floor
//    when the leader changes floor (MapObject_ChangeFloor_00669bf8, .c:533036).
//
// ASSUMED (not traced): that command 2 reaches the NPCs made by command 0 / 3
// too (their flag is 7 in the constructor; what sets flag 3 for them is in the
// vtable init, not traced), so the quest's npc_play follows them here; the
// follow distance; the walk path (a straight line with the render-side
// followTick); who syncs the NPC's position to the other clients (every client
// simulates the followers from the leaders' synced positions). The attack AI
// (below) runs on the owner's client only, as the exe's AI object does.

export const NPC_FLAG_CREATED = 7; // SinowberillChallengePlayer_Constructor_00686258 (.c:552337)
export const NPC_FLAG_FOLLOWER = 3; // 007b46f8 (.c:798808); the 6x69 command 1 / 2 gate (.c:798425, .c:798433)
export const NO_LEADER = 0xffff; // player +0x750 (.c:552273)
// ASSUMED: the distance a follower keeps from its leader, in units.
export const FOLLOW_DISTANCE = 3.0;
// ASSUMED: command 2 also starts the NPCs made by command 0 / 3 (see above).
export const FOLLOW_CREATED_NPCS = true;

export interface NpcControlCommand {
  param1: number;
  param2: number;
  command: number;
  param3: number;
}

export interface NpcAiState {
  flag: number;
  leader: number; // a player slot, or NO_LEADER
  owner: boolean; // param1 named this client when the NPC was created
}

// The NPC players of this client, by slot.
export class NpcAi {
  private readonly states = new Map<number, NpcAiState>();

  get(slot: number): NpcAiState | undefined {
    return this.states.get(slot);
  }

  slots(): number[] {
    return [...this.states.keys()];
  }

  // Command 0 / 3: a new NPC player in `slot`; `owner` when the sender named this client.
  create(slot: number, owner: boolean): void {
    this.states.set(slot, { flag: NPC_FLAG_CREATED, leader: NO_LEADER, owner });
  }

  remove(slot: number): void {
    this.states.delete(slot);
  }

  clear(): void {
    this.states.clear();
  }

  // Command 1: the NPC in `slot` stops following (exe: flag 3 only).
  stop(slot: number): boolean {
    const s = this.states.get(slot);
    if (!s || s.flag !== NPC_FLAG_FOLLOWER) return false;
    s.leader = NO_LEADER;
    return true;
  }

  // Command 2: every follower takes `leader` as its leader (exe: flag 3 only; see FOLLOW_CREATED_NPCS).
  follow(leader: number): number {
    let n = 0;
    for (const s of this.states.values()) {
      if (s.flag !== NPC_FLAG_FOLLOWER && !(FOLLOW_CREATED_NPCS && s.flag === NPC_FLAG_CREATED)) continue;
      s.leader = leader;
      n++;
    }
    return n;
  }

  // Applies one received or self-sent 6x69. Returns a short description for the log, or null.
  apply(c: NpcControlCommand, selfSlot: number): string | null {
    switch (c.command) {
      case 0:
      case 3: {
        const slot = c.param2;
        if (slot === 0xffff || slot === selfSlot) return null;
        this.create(slot, c.param1 === selfSlot);
        return c.command === 3 ? `attacker NPC in slot ${slot}` : `follower NPC in slot ${slot}`;
      }
      case 1:
        return this.stop(c.param1) ? `NPC ${c.param1} stops following` : `NPC ${c.param1} stop: not a follower`;
      case 2: {
        const n = this.follow(c.param1);
        return `${n} NPC(s) follow client ${c.param1}`;
      }
      default:
        return null;
    }
  }
}

// The follow point: the spot FOLLOW_DISTANCE from the leader on the line to the follower (ASSUMED shape).
export function followPoint(
  follower: { x: number; z: number },
  leader: { x: number; z: number },
): { x: number; z: number } {
  const dx = follower.x - leader.x;
  const dz = follower.z - leader.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= FOLLOW_DISTANCE || dist < 1e-6) return { x: follower.x, z: follower.z };
  return { x: leader.x + (dx / dist) * FOLLOW_DISTANCE, z: leader.z + (dz / dist) * FOLLOW_DISTANCE };
}

// --- the attack AI (the AI object's update, traced 2026-10-23) ---------------------
//
// The AI object built by SinowberillChallengeBoss_Constructor_007aea10 (.c:794483,
// the owner's branch of command 0 and of command 3's owner path, .c:798404 /
// .c:798753) has the vtable g_SinowberillChallengeBossVtable at 0x00b46578
// (constructor writes it at .c:794503). Vtable slot [1] is
// SinowberillChallengePlayer_Update_007aefd4 (.c:794690, read from the table). The
// dump's Sinowberill / Head / Challenge names are community guesses; the bodies are
// what is used here. Two records hang off the object: +0x74 = A, the owner's own
// player (slot = the ctor's param_1 = g_CurrentPlayerSlotIndex), +0x78 = B, the NPC
// (slot = param2 of 6x69). The stat row is the 6x69 template (+0x2c, param3).
//
// Update gate (.c:794690-794749): A and B both resolve to live, not step-constructed
// players (ResolvePlayerReference, .c:794766), B's +0xdf0 is 0, and B's leader
// (+0x750) is not 0xffff, i.e. the NPC only attacks while it follows. Then the
// movement / state / AI chain runs (AIUpdate_007b1134 -> AIUpdateState_007b267c ->
// ExecuteAttack via state 8, .c:796961..797050).
//
// Target pick (EnemyAI_AcquireClosestTargetInRange_007af2a0, .c:794836): every
// entity from g_PlayerEntityCount to g_PlayerEntityCount + g_NumEntities whose state
// flags are non-zero and whose +0x30 has 0x20000000 (enemies); per collision box with
// flag 0x8000 (+0x18), the xz distance squared from the origin (the NPC's position,
// +0x38 of B's player) must be below range^2; at most 9 candidates, sorted ascending
// by distance. The head uses the nearest one (.c:795069, AcquireTarget_007afc2c with
// range = stat +0x38).
//
// Attack decision (SinowberillHead_TryAttack_007b0754, .c:795725): the attack flag
// (0x80) is set only on the far branch (|A - B|^2 >= stat +0x44 ^2, i.e. the NPC is
// at least that far from its leader): every 4th call (counter +0x66 0..3) it takes
// the current target and sets 0x8080 when the target is within stat +0x48 of the NPC.
// Attack execution is ExecuteAttack_007b2ae8 (.c:797151): action 0 casts tech 0xf
// (or uses an item when B's flag 0x20 is set), 2 / 3 cast 0x10 / 0x11 (see
// npcAttackCast below: Resta, Anti, Reverser, none of them a hit on an enemy).
//
// Stat row 0x00a02ea0 + template * 0x28 (10 floats; exe read with tools/exedata.py,
// rows 0..5). Float index k is at +4k: k=2 acquire range (+0x38), k=5 far radius
// (+0x44), k=6 attack radius (+0x48). Rows 6+ are not read.
//   row: acquire / far / attack
//   0: 100 / 30 / 30    1: 100 / 35 / 25    2: 100 / 40 / 30
//   3: 120 / 40 / 30    4: 100 / 40 / 30    5: 100 / 30 / 30
// ASSUMED: the first two floats of each row are integer fields (they read as tiny
// denormals) and are not used here.

export interface NpcAttackRow {
  acquireRange: number;
  farRadius: number;
  attackRadius: number;
}

// The stat rows read from the exe (see the comment above).
export const NPC_ATTACK_ROWS: readonly NpcAttackRow[] = [
  { acquireRange: 100, farRadius: 30, attackRadius: 30 },
  { acquireRange: 100, farRadius: 35, attackRadius: 25 },
  { acquireRange: 100, farRadius: 40, attackRadius: 30 },
  { acquireRange: 120, farRadius: 40, attackRadius: 30 },
  { acquireRange: 100, farRadius: 40, attackRadius: 30 },
  { acquireRange: 100, farRadius: 30, attackRadius: 30 },
];

// The 6x69 template index is the stat row (+0x2c = param3). Null for rows not read.
export function npcAttackRow(template: number): NpcAttackRow | null {
  return NPC_ATTACK_ROWS[template] ?? null;
}

// A collision box of an enemy, reduced to what the target pick reads: its xz centre
// and whether its flag word has 0x8000 (+0x18 of the 0x2c-byte box).
export interface EnemyHitbox {
  x: number;
  z: number;
  targetable: boolean;
}

export interface EnemyCandidate {
  slot: number;
  hitboxes: readonly EnemyHitbox[];
}

export const MAX_ATTACK_CANDIDATES = 9; // EnemyAI_AcquireClosestTargetInRange: the list stops at 9 (.c:794900)

// The nearest enemy with a targetable box inside `range` of the NPC, or null
// (EnemyAI_AcquireClosestTargetInRange: candidates sorted by distance, [0] is used).
export function pickAttackTarget(
  npc: { x: number; z: number },
  range: number,
  enemies: readonly EnemyCandidate[],
): number | null {
  let best: { slot: number; d: number } | null = null;
  let count = 0;
  for (const e of enemies) {
    for (const b of e.hitboxes) {
      if (!b.targetable) continue;
      const dx = b.x - npc.x;
      const dz = b.z - npc.z;
      const d = dx * dx + dz * dz;
      if (d >= range * range) continue;
      if (count >= MAX_ATTACK_CANDIDATES) break;
      count++;
      if (!best || d < best.d) best = { slot: e.slot, d };
    }
  }
  return best ? best.slot : null;
}

// TryAttack's retarget cadence: the counter (+0x66) is bumped while it stays below 3
// and the check runs on the call that finds it at 3 (sVar3 = counter + 1 < 3 stores,
// else reset and check; .c:795737..795760). ASSUMED to run once per AI tick.
export const ATTACK_RETARGET_THRESHOLD = 3;

// One TryAttack tick. `farFromLeader` = |A - B|^2 >= farRadius^2 (the far branch);
// `targetDistSq` = the locked target's distance from the NPC squared, or null when
// the NPC has no target. Returns whether the attack flag is set this tick. The
// counter is the state; pass the same object every tick.
export class NpcAttackGate {
  private counter = 0;

  // True when the next far tick with a target re-picks the target (the call that finds the counter at 3).
  retargetDue(): boolean {
    return this.counter + 1 >= ATTACK_RETARGET_THRESHOLD;
  }

  tick(row: NpcAttackRow, farFromLeader: boolean, targetDistSq: number | null): boolean {
    if (!farFromLeader) return false;
    if (targetDistSq === null) return false; // B has no targets: the counter is not advanced (.c:795737)
    if (this.counter + 1 < ATTACK_RETARGET_THRESHOLD) {
      this.counter++;
      return false;
    }
    this.counter = 0;
    return targetDistSq < row.attackRadius * row.attackRadius;
  }
}

// --- the attack's technique (SinowberillHead_ExecuteAttack_007b2ae8, dump .c:797151) ---
//
// action 0 -> HandlePlayerTechCastState_007b2bc0(this, 0xf), 2 -> 0x10, 3 -> 0x11
// (ChallengePlayer_HandleItemUsage_007b2d7c instead when B's flag 0x20 is set, subtype =
// the action); action 1 is the item only. The port's TECH ids (combat/techniques.ts):
// 0xf = Resta, 0x10 = Anti, 0x11 = Reverser. None of them damages an enemy, so the
// attack's effect is the support / revive on the owner or on the target, not a hit.
// The target of 0xf and 0x10 is the owner's own player (.c:797207..797232: the 6x47
// list takes A's id); 0x11 takes B's own target (B +0x7c / +0x84, not traced further).
export const NPC_TECH_RESTA = 0xf;
export const NPC_TECH_ANTI = 0x10;
export const NPC_TECH_REVERSER = 0x11;

export type NpcAttackCast = { kind: 'tech'; tech: number; target: 'owner' | 'target' } | { kind: 'item'; subtype: number };

// What ExecuteAttack does for `action` (the state machine that picks it is not traced).
export function npcAttackCast(action: number, itemFlag: boolean): NpcAttackCast | null {
  if (action === 0 || action === 2 || action === 3) {
    if (itemFlag) return { kind: 'item', subtype: action };
    if (action === 0) return { kind: 'tech', tech: NPC_TECH_RESTA, target: 'owner' };
    if (action === 2) return { kind: 'tech', tech: NPC_TECH_ANTI, target: 'owner' };
    return { kind: 'tech', tech: NPC_TECH_REVERSER, target: 'target' };
  }
  if (action === 1 && itemFlag) return { kind: 'item', subtype: 1 };
  return null;
}

// The NPC's attack AI for one NPC: the gate (cadence and radii) plus the locked target
// (EnemyAI_AcquireClosestTargetInRange at the acquire range, re-picked on the retarget
// call or when the locked target is gone). ASSUMED: the target is re-picked when the gate
// is due, not kept between retargets; `busy` models the cast the exe's state machine waits on.
export class NpcAttackAi {
  private readonly gate = new NpcAttackGate();
  // The locked enemy's entity id (0x1000 | index), or null.
  target: number | null = null;
  private cooldown = 0;

  // The cast takes `ticks` ticks before the next attack (ASSUMED: the technique's charge + cast).
  busy(ticks: number): void {
    this.cooldown = Math.max(this.cooldown, ticks);
  }

  // True when no cast is still running (the head's chooser runs only then).
  ready(): boolean {
    return this.cooldown === 0;
  }

  // One AI tick. Returns true when the attack flag is set this tick.
  tick(a: {
    row: NpcAttackRow;
    npc: { x: number; z: number };
    leader: { x: number; z: number };
    enemies: readonly EnemyCandidate[];
    targetPos: (id: number) => { x: number; z: number } | null;
  }): boolean {
    if (this.cooldown > 0) {
      this.cooldown--;
      return false;
    }
    const dx = a.leader.x - a.npc.x;
    const dz = a.leader.z - a.npc.z;
    const far = dx * dx + dz * dz >= a.row.farRadius * a.row.farRadius;
    if (!far) {
      this.gate.tick(a.row, false, null);
      return false;
    }
    const locked = this.target === null ? null : a.targetPos(this.target);
    if (locked === null || this.gate.retargetDue()) {
      this.target = pickAttackTarget(a.npc, a.row.acquireRange, a.enemies);
    }
    const pos = this.target === null ? null : a.targetPos(this.target);
    const distSq = pos === null ? null : (pos.x - a.npc.x) ** 2 + (pos.z - a.npc.z) ** 2;
    return this.gate.tick(a.row, true, distSq);
  }
}

// --- the head's status flags (SinowberillCheckHeadRotation_007af694, .c:795008) ---------
//
// Each record's +0x90 (status) and +0x8c (need) words are set from the player's HP and TP
// ratios: HP (cur +0x334 / max +0x2bc) <= 0.75 sets 0x8 and need 4, <= 0.1 also 0x800 (ratio
// thresholds 0xddd8 / 0xddd0); the player's state 0x30 & 0x13 sets 0x2 and need 4; TP (cur
// +0x336 / max +0x2be) <= 0.2 (0xddcc) with a max above 0 sets 0x10 and need 4.
// ASSUMED: the exe ORs these bits into the words and clears them elsewhere; here each tick
// starts from zero and the flags are recomputed from the current ratios. ASSUMED: the state
// word 0x30 is 0 for an NPC's owner (not read).

export const HEAD_FLAG_STATUS = 0x2;
export const HEAD_FLAG_NEED_HEAL = 0x8;
export const HEAD_FLAG_NEED_TP = 0x10;
export const HEAD_FLAG_ITEM = 0x20;
export const HEAD_FLAG_CRITICAL = 0x800;
export const HEAD_NEED_BIT = 0x4; // written into +0x8c with the flags above
export const HEAD_NEED_BLOCK = 0x2; // +0x8c & 2 of the NPC: the chooser returns (.c:795905)

export interface PlayerRatioStatus {
  hp: number;
  hpMax: number;
  tp: number;
  tpMax: number;
  stateFlags30: number; // the player's +0x30 word (ASSUMED 0 when not known)
}

export function headStatusFlags(s: PlayerRatioStatus): { f90: number; f8c: number } {
  let f90 = 0;
  let f8c = 0;
  if (s.hpMax > 0) {
    const r = s.hp / s.hpMax;
    if (r <= 0.75) {
      f90 |= HEAD_FLAG_NEED_HEAL;
      f8c |= HEAD_NEED_BIT;
      if (r <= 0.1) {
        f90 |= HEAD_FLAG_CRITICAL;
        f8c |= HEAD_NEED_BIT;
      }
    }
  }
  if ((s.stateFlags30 & 0x13) !== 0) {
    f90 |= HEAD_FLAG_STATUS;
    f8c |= HEAD_NEED_BIT;
  }
  if (s.tpMax !== 0 && s.tp / s.tpMax <= 0.2) {
    f90 |= HEAD_FLAG_NEED_TP;
    f8c |= HEAD_NEED_BIT;
  }
  return { f90, f8c };
}

// --- the head's action chooser (SinowberillHead_AIProcessState_007b0a7c, .c:795871) ----
//
// The action is the head's +0x92 word that ExecuteAttack_007b2ae8 reads (.c:797040, the state
// 8 dispatch of AIUpdateState_007b2764). This function is the only writer of +0x92 in the dump:
// it writes 0, 1 or 2 (3 is never written, so action 3 / Reverser is not chosen in the exe).
// Its inputs: the owner's record A (+0x74: +0x90 status, +0x8c need) and the NPC's record B
// (+0x78: +0x90, +0x8c, its player's inventory and tech eligibility), the head's +0x34 (ASSUMED
// meaning: 0x40 set = the action is held back) and +0x84 (a second target; 0 for an NPC).
// mode = the call's param_2: 0 for the NPC's own needs, 1 for the owner's.
//
//   v = (B +0x8c & 4 ? 1 : 0) | (mode != 0 && A +0x8c & 4 && head +0x84 == 0 ? 2 : 0)
//   1. mode 1, v & 2, B has a candidate: a counter (+0x66, threshold 0x1e) and every 30th
//      call the locked target within the attack radius returns 1 with no write to +0x92.
//   2. v 1 / 3 (B's needs): if B +0x90 has no 0x2: if 0x8, item 0 or tech 0xf (eligibility)
//      gives action 0 (item use when an item is taken, flag 0x20); else if 0x10, item 1 gives
//      action 1; else v 3 falls to 2. If B +0x90 has 0x2, tech 0x10 gives action 2.
//   3. v 2 (the owner's needs, B +0x8c & 2 returns): A +0x90 without 0x2 and with 0x800 and
//      tech 0xf gives action 0; with 0x2 and tech 0x10 gives action 2. Each needs the head's
//      +0x34 & 0x40 clear.

export interface HeadChooseInput {
  owner90: number; // A +0x90
  owner8c: number; // A +0x8c
  npc90: number; // B +0x90 (the status bits from headStatusFlags)
  npc8c: number; // B +0x8c
  head34: number; // the head's +0x34 (ASSUMED: 0 for the NPC's head)
  head84: number; // the head's +0x84 (ASSUMED: 0)
  hasTarget: boolean; // B's candidate count is not 0 (the locked target is entry 0)
  hasItem(sub: number): boolean; // GetItemInstanceIdFromPlayerInventory(B player, 3, sub) != -1
  canCast(tech: number): boolean; // CheckPlayerTechCastEligibility(B player, tech) (ASSUMED true when not modelled)
  lockedInRadius(): boolean; // the locked target within the head's attack radius (+0x48) of the NPC
}

export interface HeadChoice {
  attack: boolean; // the chooser's return value
  action: number; // the head's +0x92 after the call (ExecuteAttack's action)
  item: boolean; // B +0x90 0x20: the action is an item use
}

export const HEAD_COUNTER_THRESHOLD = 0x1e; // +0x66 in AIProcessState (.c:795905); TryAttack's own counter uses 3

export class NpcHeadChooser {
  // The head's +0x92 (ASSUMED 0 at the start: the first use of an unwritten word is action 0).
  action = 0;
  private counter = 0;

  choose(mode: 0 | 1, i: HeadChooseInput): HeadChoice {
    let item = false;
    const none = (): HeadChoice => ({ attack: false, action: this.action, item: false });
    const act = (a: number): HeadChoice => {
      this.action = a;
      return { attack: true, action: a, item };
    };
    const free = (i.head34 & 0x40) === 0;
    let v = i.npc8c & HEAD_NEED_BIT ? 1 : 0;
    if (mode !== 0 && i.owner8c & HEAD_NEED_BIT && i.head84 === 0) v |= 2;

    if (mode !== 0 && i.hasTarget && (v & 2) !== 0) {
      if (this.counter + 1 < HEAD_COUNTER_THRESHOLD) {
        this.counter++;
      } else {
        this.counter = 0;
        if (i.lockedInRadius()) return { attack: true, action: this.action, item: false };
      }
    }

    if (v === 1 || v === 3) {
      if ((i.npc90 & HEAD_FLAG_STATUS) === 0) {
        if ((i.npc90 & HEAD_FLAG_NEED_HEAL) !== 0) {
          const hasItem0 = i.hasItem(0);
          if (hasItem0) item = true;
          else if (!i.canCast(0xf)) return none();
          return item || free ? act(0) : none();
        }
        if ((i.npc90 & HEAD_FLAG_NEED_TP) !== 0) {
          if (i.hasItem(1)) {
            item = true;
            return act(1);
          }
          return none();
        }
        if (v !== 3) return none();
        v = 2;
      } else {
        return i.canCast(0x10) && free ? act(2) : none();
      }
    }

    if (v === 2) {
      if (i.npc8c & HEAD_NEED_BLOCK) return none();
      if ((i.owner90 & HEAD_FLAG_STATUS) === 0) {
        if ((i.owner90 & HEAD_FLAG_CRITICAL) !== 0 && i.canCast(0xf) && free) return act(0);
      } else if (i.canCast(0x10) && free) {
        return act(2);
      }
    }
    return none();
  }
}

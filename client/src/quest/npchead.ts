// The NPC's head (SinowberillHead_*): where the owner's client sends the NPC to walk, whether
// a move is needed, the target pick of the field, and the attack state machine. The exe keeps
// one head record per NPC (P) with the owner entity Q = P+0x74 and the NPC entity B = P+0x78
// (B+0x94 is the NPC's player record: its position +0x38, weapon +0x300, height +0x304, TP +0x336).
// The dump's Sinowberill / Head names are community guesses; the bodies are what is used.
//
// Head fields (P): +0x30 / +0x34 raw row words (+0x34 = the tier word, 0x40 = no state-2 cast),
// +0x38 acquire range, +0x40 leash, +0x44 far radius (TryAttack's near test is the far test:
// (P+0x44)^2 <= P+0x58), +0x48 attack radius, +0x4c path radius, +0x50 level byte, +0x52 / +0x53
// need bytes, +0x54 stand-off, +0x58 owner-NPC distance^2, +0x66 TryAttack counter, +0x68 path
// counter, +0x7c state, +0x80 flags, +0x88 spawn distance^2, +0x8c / +0x8d wall counters,
// +0x8e cooldown, +0xac send target, +0xd0 move target, +0xdc anchor.
// B fields: +0x0 candidate count and triples (id, box, distance^2), +0x7c / +0x84 the locked
// id and box (+0x80 the previous id), +0x8c need bits (0x1 moved, 0x2 acquired a target, 0x20 /
// 0x80 avoidance, ASSUMED not written here), +0x90 status bits, +0x9c the last move origin.
//
// Traced (dump /Users/junior/Downloads/psobb-master/reverse/refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c):
//  - the update chain (SinowberillChallengePlayer_Update_007aefd4, .c:794690): UpdateState_007af1a8
//    (the owner's bit 2 on Q), SinowberillHead_UpdateState_007af7ec (.c:795069: the distance, the
//    B acquire, the wall counter), SinowberillHead_UpdateState_007b00bc (.c:795481: the Pioneer 2
//    branch, or the field's mode 0 / mode 1), SinowberillHead_AIUpdate_007b1134 (.c:796128), and the
//    state dispatch SinowberillHead_AIUpdateState_007b2764 (.c:796961) with its +0x328 & 2 gate.
//  - the stat row (SinowberillChallenge_InitializePlayerStats_007adbe0, .c:794403..794413; see
//    npcai.ts NPC_ATTACK_ROWS): every field above that comes from the table.
//  - the mode-1 entry: AcquireTarget (SinowberillHead_AcquireTarget_007afc2c, .c:795255) sets B +0x8c
//    bit 2 when EnemyAI_AcquireClosestTargetInRange (.c:794836) finds a candidate within the range
//    P+0x38 of the NPC; the owner's bit (Q +0x8c bit 2, UpdateState_007af1a8, .c:794797) is set the
//    same way with range 30 around the owner. Neither bit is cleared in the traced code (only reset).
//  - the candidate list: AcquireClosestTargetInRange fills B's triples (count at B+0x0, at most 9,
//    sorted ascending by the box's xz distance^2 from the NPC): enemies with state flags and entity
//    flag 0x20000000, per box with flag 0x8000 within the range.
//  - the wall counter (+0x8c, UpdateState_007af7ec .c:795227): CheckHeadDistance (SinowberillCheckHeadDistance_007af628,
//    .c:794983: the NPC moved more than 0.4 since the last copy) resets it; otherwise in state 1 it counts up
//    (+0x8d capped at 0x1e) unless B +0x8c & 0x80. The moved case copies the move origin (B+0x9c).
//  - the move gate (AIUpdateState_007b267c, .c:796915) and the spawn check (CheckSpawnValidity_007b1220,
//    .c:796178: flag 0x10 bypasses the range, the squared distance goes to +0x88).
//  - the mode-0 tail (.c:795669..795730): B +0x8c & 2 enters mode 1 (flags & 0xffffefcf, state 0,
//    anchor = the NPC); otherwise AIProcessState(1) (the attack chooser) decides attack or move.
//  - mode 1 (.c:795510..795700): the cooldown roll, TryAttack, CheckPathAndTarget, the chooser
//    transitions, and the attack anchor = the NPC (B.player weapon), not the owner.
//  - TryAttack (.c:795725), CheckPathAndTarget (.c:795775: the ray from the NPC's weapon to each
//    candidate, mask 0x2100; flag 0x1000 when (path+10)^2 > the anchor's distance^2; 0x40 when none).
//  - the state-2 cast (SinowberillHead_CastTechnique_007b2e20, .c:797346): the table word 0x40 of +0x34
//    blocks it; the tier from +0x34; the strong pick needs P+0x80 & 0x2000 and B+0x90 & 0x1000, else the
//    roll |rand / 32768 * 10| against +0x53 * 0.1; the TP gate (B.player +0x336 against the cost / +0x2be)
//    only sets the input state 3 and the chat bubble; HandlePlayerTechCastState_007b2bc0 (.c:797215) sets
//    the input state (0x16 / 0x17 / 2) and sends the cast with the targets B +0x7c / +0x84.
//  - the 0x16 / 0x17 input states are the player's own action dispatch (PlayerActionDispatch, .c:232924:
//    case 0x16 -> ProcessSinowberillSpecialAttack_004b41ac(param 2), case 0x17 -> ProcessSinowberillActionState_004B6D08(param 2)).
//    No head writer produces them except HandlePlayerTechCastState; whether the head's +0x24 reaches that
//    table is not traced.
//
// ASSUMED (not traced here):
//  - B +0x90 & 0x1000 (the strong bit) and B +0x90 & 8 / 0x10 are not written in the traced code (the
//    status comes from the server); the port keeps them 0, so the state-2 cast is always the roll.
//  - B.player +0x44 (the NPC's last position for CheckHeadDistance) is modelled as the position at the
//    last tick: the moved test is the NPC's own movement since the last tick.
//  - the owner's and the NPC's bits 0x20 / 0x80 of B +0x8c are set by the collision loop of
//    UpdateState_007af7ec (not ported): 0 here.
//  - the second-target branches (P +0x84 != 0) are dormant: P+0x84 is not written in the traced code.
//  - the wall branch of AIUpdateMovement (CalculateAvoidanceTarget, AdjustTargetForCollision,
//    UpdateTargetPosition) is the midpoint.
//  - the input states of the head (+0x24) and the timers +0x5c / +0x6a / +0x6c / +0x70 / +0x100 are not modelled.
//  - the cast's release timing (quest/npcai.ts, combat.ts npcCastTechnique): the charge ticks.
//  - the Pioneer 2 test (map_is_pioneer2_) is the floor 0 of the lobby (ASSUMED).

// DAT_0097dd84 (.c:796204): the midpoint factor.
export const HEAD_MIDPOINT = 0.5;
// DAT_0097dd34 = 100: the squared distance above which a move is needed (AIUpdateState_007b267c).
export const HEAD_MOVE_GATE_SQ = 100;
// DAT_0097dd8c = 40 and DAT_0097dd90 = 12: the spawn check's range is min(40, leash + 12).
export const HEAD_SPAWN_CAP = 40;
export const HEAD_SPAWN_PAD = 12;
// The wall ray's mask (SinowberillHead_CheckWall_007b18e0, .c:796427).
export const HEAD_WALL_MASK = 0x2100;
// ASSUMED: the owner's weapon height above its feet for the wall ray (see the comment above).
export const HEAD_RAY_HEIGHT = 5;
// DAT_0097dd6c = 20: CalculateTarget's offset (.c:796453).
export const HEAD_STUCK_OFFSET = 20;
// DAT_0097dd9c = 900: the squared distance under which the attack starts (30^2) and DAT_0097dd98 = 10
// (CheckPathAndTarget's margin).
export const HEAD_ATTACK_START_SQ = 900;
export const HEAD_PATH_MARGIN = 10;
// DAT_0097dddc = 0.4: the distance the NPC must move for CheckHeadDistance to count it as moved.
export const HEAD_MOVED_DIST = 0.4;
// DAT_0097dd14 = 0.2 is the TP gate of CastTechnique (the input state 3 only); the owner's acquire
// range is 30 (EnemyAI_AcquireClosestTargetInRange(Q, 30.0, ...), .c:794816).
export const HEAD_OWNER_ACQUIRE = 30;
// The max candidates of the target list (EnemyAI_AcquireClosestTargetInRange: the list stops at 9).
export const HEAD_MAX_TARGETS = 9;

// Head flags (+0x80) this module writes.
export const HEAD_FLAG_RUN = 0x8; // +0x80 & 8: a run was sent this move (2764)
export const HEAD_FLAG_MOVE = 0x20; // +0x80 & 0x20: a move was requested (UpdateState_007b00bc)
export const HEAD_FLAG_TARGET_LOCKED = 0x40; // +0x80 & 0x40: no path target (CheckPathAndTarget)
export const HEAD_FLAG_ACTION = 0x10; // +0x80 & 0x10: the cast request (state 2)
export const HEAD_FLAG_STRONG = 0x1000; // +0x80 & 0x1000: the target is near the anchor (CheckPathAndTarget)
export const HEAD_FLAG_TOO_CLOSE = 0x2000; // +0x80 & 0x2000: three or more targets (CheckPathAndTarget)
export const HEAD_FLAG_WALL_CLAMP = 0x4000; // +0x80 & 0x4000: the wall counter reached 0x1f
export const HEAD_FLAG_AVOID = 0x1; // +0x80 & 1: the avoidance target is in use (AIUpdateMovement)
export const HEAD_FLAG_NEXT = 0x200; // +0x80 & 0x200: an attack is chosen (the AIProcessState result)
export const HEAD_FLAG_ATTACK_SET = 0x100; // +0x80 & 0x100: TryAttack's attack flag
export const HEAD_FLAG_TARGET_HIT = 0x8000; // +0x80 & 0x8000: the target was re-picked and is in range (TryAttack)
export const HEAD_FLAG_SECOND = 0x80; // +0x80 & 0x80: the second target is in range (TryAttack, 0x8080)
export const HEAD_FLAG_BIG = 0x8000; // +0x80 & 0x8000: the cooldown roll's multiplier 2 (DAT_0097ddac)

// Head states (+0x7c). 0 = idle, 1 = move, 2 = cast, 8 = attack (AIUpdateState_007b2764).
export const HEAD_STATE_IDLE = 0;
export const HEAD_STATE_MOVE = 1;
export const HEAD_STATE_CAST = 2;
export const HEAD_STATE_ATTACK = 8;

// B +0x8c need bits this module reads or writes.
export const HEAD_NEED_MOVED = 0x1;
export const HEAD_NEED_ACQUIRED = 0x2;
export const HEAD_NEED_0X20 = 0x20;
export const HEAD_NEED_0X80 = 0x80;

export interface HeadPoint {
  x: number;
  y: number;
  z: number;
}

// xz distance squared (vec3_xz_distance_sq).
export function xzDistSq(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

// The spawn check's range (SinowberillChallengeBoss_CheckSpawnValidity_007b1220): min(40, leash + 12).
export function headSpawnRange(leash: number): number {
  const r = HEAD_SPAWN_PAD + leash;
  return HEAD_SPAWN_CAP <= r ? HEAD_SPAWN_CAP : r;
}

// The midpoint of the NPC and the anchor (AIUpdateMovement_007b1298, the k = 0.5 branch).
export function headMidpoint(npc: HeadPoint, anchor: HeadPoint): HeadPoint {
  return {
    x: npc.x + (anchor.x - npc.x) * HEAD_MIDPOINT,
    y: npc.y + (anchor.y - npc.y) * HEAD_MIDPOINT,
    z: npc.z + (anchor.z - npc.z) * HEAD_MIDPOINT,
  };
}

// SinowberillHead_CalculateTarget_007b193c (.c:796453): the stuck target. v is the reversed
// movement (xz, normalised); the two sides are v rotated by +90 and -90 degrees (the exe's
// matrix_rotation_y, .c:846662: x' = x cos + z sin, z' = z cos - x sin, so +90 is (z, -x) and
// -90 is (-z, x)). The side is +90 when the anchor direction has a dot <= 0 with it, else -90.
// The target is the NPC's position moved 20 along that side, away from it when the wall counter
// is above 0x13 (`counter` is head +0x8c).
export function headCalculateTarget(npc: HeadPoint, anchor: HeadPoint, move: { x: number; z: number }, counter: number): HeadPoint {
  let vx = -move.x;
  let vz = -move.z;
  const vl = Math.hypot(vx, vz);
  if (vl !== 0) {
    vx /= vl;
    vz /= vl;
  }
  const plus = { x: vz, z: -vx };
  const minus = { x: -vz, z: vx };
  let ax = anchor.x - npc.x;
  let az = anchor.z - npc.z;
  const al = Math.hypot(ax, az);
  if (al !== 0) {
    ax /= al;
    az /= al;
  }
  const dir = ax * plus.x + az * plus.z <= 0 ? plus : minus;
  const k = counter > 0x13 ? -HEAD_STUCK_OFFSET : HEAD_STUCK_OFFSET;
  return { x: npc.x + dir.x * k, y: npc.y, z: npc.z + dir.z * k };
}

// The wall ray between the NPC and the anchor (SinowberillHead_CheckWall_007b18e0). The
// caller passes the map's ray with the mask (combat view's npcWallBlocks).
export type WallRay = (from: HeadPoint, to: HeadPoint, mask: number) => boolean;

const raised = (p: HeadPoint): HeadPoint => ({ x: p.x, y: p.y + HEAD_RAY_HEIGHT, z: p.z });

// A candidate enemy as the head reads it (combat.npcEnemies): the entity id, the xz of its hit
// point (+0x38 / +0x40 of the target, the anchor), and one box per collision box (xz centre and
// the flag 0x8000 of the box, formats/enemyboxes.ts).
export interface HeadCandidate {
  id: number;
  x: number;
  z: number;
  boxes: readonly { x: number; z: number; targetable: boolean }[];
}

// The stat row of one NPC (npcai.ts NpcAttackRow) as the head reads it.
export interface HeadRow {
  acquireRange: number;
  leash: number;
  farRadius: number;
  attackRadius: number;
  pathRadius: number;
  flags34: number;
  need52: number;
  need53: number;
  standOff: number;
}

// One entry of B's candidate triples: the entity id, its box index, and the entity's position.
export interface PathTarget {
  id: number;
  id2: number;
  pos: HeadPoint | null;
}

// EnemyAI_AcquireClosestTargetInRange_007af2a0 (.c:794836): the candidates of one box within
// `range` (xz distance^2 from the origin to the box centre), nearest first, at most 9. The
// target's position is its hit point (ASSUMED: the exe reads +0x300 / +0x38 of the entity).
export function acquireClosestTargets(origin: HeadPoint, range: number, cands: readonly HeadCandidate[]): PathTarget[] {
  const found: { entry: PathTarget; d: number }[] = [];
  for (const c of cands) {
    for (let box = 0; box < c.boxes.length; box++) {
      const b = c.boxes[box];
      if (!b.targetable) continue;
      const d = xzDistSq(origin, b);
      if (d < range * range) found.push({ entry: { id: c.id, id2: box, pos: { x: c.x, y: origin.y, z: c.z } }, d });
    }
  }
  found.sort((a, b) => a.d - b.d);
  return found.slice(0, HEAD_MAX_TARGETS).map((f) => f.entry);
}

export interface HeadUpdateInput {
  npc: HeadPoint; // the NPC's position (B +0x94 +0x38; y for the ray)
  owner: HeadPoint; // the owner's position (Q.player +0x38; the anchor on Pioneer 2)
  wall: WallRay;
}

// One NPC's head. The exe's record is one object per NPC; the port keeps one per slot
// (quest/town.ts). A fresh head is the zeroed record of the exe with its row copied in
// (configure).
export class NpcHead {
  state = HEAD_STATE_IDLE; // +0x7c
  flags = 0; // +0x80
  anchor: HeadPoint = { x: 0, y: 0, z: 0 }; // +0xdc
  moveTarget: HeadPoint = { x: 0, y: 0, z: 0 }; // +0xd0
  sendTarget: HeadPoint = { x: 0, y: 0, z: 0 }; // +0xac
  // The map-mode branch's mode (head +0x1c): 0 = the follow / chooser tail, 1 = field attack.
  mode = 0;
  counter66 = 0; // +0x66: TryAttack's retarget counter (3)
  counter68 = 0; // +0x68: CheckPathAndTarget's counter (100)
  cooldown8e = 0; // +0x8e: the attack cooldown from the roll (AIUpdateState cooldown)
  wall8c = 0; // +0x8c (byte): the wall counter (CalculateTarget at 15..29, stuck at 0x1f)
  wall8d = 0; // +0x8d (byte): the counter's reset guard
  dist58 = 0; // +0x58: the owner-NPC distance^2 (UpdateState_007af7ec)
  dist88 = 0; // +0x88: the spawn check's distance^2 (CheckSpawnValidity)
  // The row (npcai.ts NpcAttackRow, copied by configure).
  head34 = 0; // +0x34: the tier word (0x40 blocks the state-2 cast)
  need52 = 0; // +0x52: the cooldown need (* 0.1)
  need53 = 0; // +0x53: the cast need (* 0.1)
  nearRadius = 0; // +0x44: TryAttack's far branch
  attackRadius = 0; // +0x48
  pathRadius = 0; // +0x4c: CheckPathAndTarget's margin
  standOff = 0; // +0x54
  leash = 0; // +0x40
  acquireRange = 0; // +0x38
  // B's fields the head reads and writes.
  npcNeed8c = 0; // B +0x8c (the bits 0x1, 0x2, 0x20, 0x80)
  ownerNeed8c = 0; // Q +0x8c (bit 2: the owner has a candidate within 30)
  targets: PathTarget[] = []; // B's candidate triples (B +0x0 count)
  lockedPrimary = 0; // B +0x7c: the locked target id (0 = none)
  lockedSecond = 0; // B +0x84: the locked target's box
  lockedPrevious = 0; // B +0x80: the previous locked id (CastTechnique's 0xffff test is not ported)
  moveRef: HeadPoint = { x: 0, y: 0, z: 0 }; // B +0x9c: the move origin
  prevNpc: HeadPoint | null = null; // the NPC's position at the last tick (B.player +0x44, ASSUMED)
  castTicks = 0; // the state-2 cast's busy ticks (ASSUMED: the technique's charge + cast)
  wallHit = false; // the wall ray's answer for the last movement (the branch it picks is ASSUMED)

  // Copies the stat row (the head's constructor, .c:794403..794413).
  configure(r: HeadRow): void {
    this.acquireRange = r.acquireRange;
    this.leash = r.leash;
    this.nearRadius = r.farRadius;
    this.attackRadius = r.attackRadius;
    this.pathRadius = r.pathRadius;
    this.head34 = r.flags34;
    this.need52 = r.need52;
    this.need53 = r.need53;
    this.standOff = r.standOff;
  }

  // UpdateState_007b00bc on Pioneer 2 (.c:795492): the anchor is the owner's position
  // (UpdateAttackTarget with no second target), the state is 1 (move) and the flags get 0x20
  // with 0x1010 cleared.
  pioneerUpdateState(owner: HeadPoint): void {
    this.anchor = { x: owner.x, y: owner.y, z: owner.z };
    this.state = HEAD_STATE_MOVE;
    this.flags = (this.flags & ~0x1010) | HEAD_FLAG_MOVE;
  }

  // SinowberillHead_UpdateState_007af7ec (.c:795069), the parts the field reads, in the exe's order:
  // the owner-NPC distance (+0x58), the moved test and the wall counter, the B acquire (AcquireTarget,
  // range +0x38, sets B +0x8c bit 2 when it finds a candidate), and the owner's bit (UpdateState_007af1a8,
  // range 30 around the owner). The candidate list is B's triples for CheckPathAndTarget.
  headStateUpdate(i: { npc: HeadPoint; owner: HeadPoint; cands: readonly HeadCandidate[] }): void {
    this.dist58 = xzDistSq(i.owner, i.npc);
    const moved = this.prevNpc === null || Math.hypot(i.npc.x - this.prevNpc.x, i.npc.y - this.prevNpc.y, i.npc.z - this.prevNpc.z) > HEAD_MOVED_DIST;
    if (moved) {
      this.npcNeed8c |= HEAD_NEED_MOVED;
      this.moveRef = this.prevNpc ? { ...this.prevNpc } : { x: 0, y: 0, z: 0 };
      this.wall8c = 0;
      this.wall8d = 0;
    } else if (this.state === HEAD_STATE_MOVE) {
      if ((this.npcNeed8c & HEAD_NEED_0X80) === 0) {
        this.wall8c = (this.wall8c + 1) & 0xff;
        this.wall8d = Math.min(this.wall8d + 1, 0x1e);
      } else {
        this.wall8c = 0;
        this.wall8d = 0;
      }
    }
    this.targets = acquireClosestTargets(i.npc, this.acquireRange, i.cands);
    if (this.targets.length > 0) this.npcNeed8c |= HEAD_NEED_ACQUIRED;
    if (acquireClosestTargets(i.owner, HEAD_OWNER_ACQUIRE, i.cands).length > 0) this.ownerNeed8c |= HEAD_NEED_ACQUIRED;
  }

  // The move gate (SinowberillHead_AIUpdateState_007b267c, .c:796915). True when a move is
  // needed; the send target then follows the new target. At the wall counter's clamp the move
  // is refused, the counter goes to 0x1e and flag 0x4000 is set (the input states +0x24 and the
  // +0x6a timer are ASSUMED, not modelled).
  private moveGate(): boolean {
    if (!(xzDistSq(this.sendTarget, this.moveTarget) > HEAD_MOVE_GATE_SQ)) return false;
    if (this.wall8c < 0x1f) {
      if (this.wall8c === 0) this.flags &= ~HEAD_FLAG_WALL_CLAMP;
      return true;
    }
    this.wall8c = 0x1e;
    this.flags |= HEAD_FLAG_WALL_CLAMP;
    return false;
  }

  // SinowberillHead_AIUpdate_007b1134 (.c:796128) with its movement and state gate. Inside
  // the spawn range the send target keeps its last value (the exe returns before writing it).
  update(i: HeadUpdateInput): void {
    // CheckSpawnValidity (.c:796178): flag 0x10 bypasses the range; the squared distance is +0x88.
    const range = headSpawnRange(this.leash);
    this.dist88 = xzDistSq(this.anchor, i.npc);
    if ((this.flags & HEAD_FLAG_ACTION) === 0 && this.dist88 < range * range) {
      this.flags &= ~HEAD_FLAG_ATTACK_SET; // 0x80 & 0xfffffeff (.c:796187)
      if ((this.flags & HEAD_FLAG_MOVE) !== 0 && this.state !== HEAD_STATE_ATTACK) {
        // 0xffffefcf: the state idle, the move and cast flags cleared, the anchor is the NPC's weapon.
        this.state = HEAD_STATE_IDLE;
        this.flags &= ~(0x1000 | HEAD_FLAG_MOVE | HEAD_FLAG_ACTION);
        this.anchor = { x: i.npc.x, y: i.npc.y, z: i.npc.z };
      }
      this.prevNpc = { ...i.npc };
      return; // the send target is not written on this path (.c:796131)
    }
    // AIUpdateMovement (.c:796204): the midpoint, or the stuck target at the wall counter's band.
    const move = { x: i.npc.x - this.moveRef.x, z: i.npc.z - this.moveRef.z };
    const mid = headMidpoint(i.npc, this.anchor);
    const wallHit = i.wall(raised(i.npc), raised(this.anchor), HEAD_WALL_MASK);
    this.wallHit = wallHit;
    if (!wallHit &&  (this.npcNeed8c & HEAD_NEED_0X20) === 0 && (this.npcNeed8c & HEAD_NEED_0X80) === 0) {
      if (this.wall8c < 0xf || this.wall8c > 0x1d) {
        if (this.wall8d > 0xf) this.wall8c = 0;
        this.moveTarget = mid;
      } else {
        this.moveTarget = headCalculateTarget(i.npc, this.anchor, move, this.wall8c);
      }
    } else {
      // The wall branch (avoidance, UpdateTargetPosition) is ASSUMED to be the midpoint.
      this.moveTarget = mid;
    }
    this.flags &= ~HEAD_FLAG_AVOID; // 0x80 & 0xfffffffe (.c:796296)
    // AIUpdateState_007b267c (.c:796915): a move is needed when the send target is more than 10 away.
    if (this.moveGate()) {
      this.sendTarget = { ...this.moveTarget };
      if (this.state !== HEAD_STATE_CAST) {
        this.state = HEAD_STATE_MOVE;
        this.flags = (this.flags & ~0x1010) | HEAD_FLAG_MOVE;
      }
    } else {
      // No move: the send target is the NPC's own position (AIUpdate_007b1134 .c:796149).
      this.sendTarget = { x: i.npc.x, y: i.npc.y, z: i.npc.z };
    }
    this.prevNpc = { ...i.npc };
  }

  // SinowberillHead_TryAttack_007b0754 (.c:795725). The owner's bit (Q +0x8c & 2) stops the attack;
  // the NPC's status 8 (B +0x90 & 8, `npcStatus8`) starts it. The near test is the far test of the
  // head's distance: (P+0x44)^2 <= P+0x58. Returns the attack flag (0x100).
  tryAttack(t: { npcStatus8: boolean }): boolean {
    if ((this.ownerNeed8c & HEAD_NEED_ACQUIRED) !== 0) {
      this.flags &= ~HEAD_FLAG_ATTACK_SET;
      return false;
    }
    if (t.npcStatus8) {
      this.flags |= HEAD_FLAG_ATTACK_SET;
      return true;
    }
    if (this.nearRadius * this.nearRadius <= this.dist58) {
      this.flags |= HEAD_FLAG_ATTACK_SET;
      if (this.targets.length > 0) {
        if (this.counter66 + 1 < 3) {
          this.counter66++;
        } else {
          this.counter66 = 0;
          this.flags &= ~HEAD_FLAG_TARGET_HIT;
          const first = this.targets[0].pos;
          const npc = this.npcPos;
          if (first && npc && xzDistSq(first, npc) < this.attackRadius * this.attackRadius) this.flags |= HEAD_FLAG_TARGET_HIT | HEAD_FLAG_SECOND;
        }
      }
      return true;
    }
    if ((this.flags & HEAD_FLAG_ATTACK_SET) !== 0) return true;
    this.flags &= ~HEAD_FLAG_ATTACK_SET;
    return false;
  }

  // The NPC's position for TryAttack and CheckPathAndTarget (set by fieldUpdate and headStateUpdate callers).
  npcPos: HeadPoint | null = null;

  // SinowberillHead_CheckPathAndTarget_007b086c (.c:795775). The count of B's candidates decides
  // the flag 0x2000 and the counter +0x68. The first candidate with a clear ray from the NPC's weapon
  // (mask 0x2100, to the candidate at the NPC's height) becomes the locked one: B +0x7c / +0x84 take its
  // id and box (+0x80 the previous id), the anchor is the first candidate's position at the NPC's height,
  // and flag 0x1000 is set when (path + 10)^2 > the anchor's distance^2. With none clear, flag 0x40.
  checkPathAndTarget(t: { npc: HeadPoint; npcWeapon: HeadPoint; ray: WallRay }): boolean {
    const count = this.targets.length;
    if (count < 3) {
      this.flags &= ~HEAD_FLAG_TOO_CLOSE;
    } else {
      this.flags |= HEAD_FLAG_TOO_CLOSE;
      if (this.counter68 + 1 < 100) {
        this.counter68++;
      } else {
        this.counter68 = 0;
      }
    }
    if (count === 0) return false; // the exe's whole block (loop, 0x40) sits under B's count != 0 (.c:795806)
    for (const e of this.targets) {
      if (!e.pos) continue;
      const to = { x: e.pos.x, y: t.npcWeapon.y, z: e.pos.z };
      if (t.ray(t.npcWeapon, to, HEAD_WALL_MASK)) continue;
      this.lockedPrevious = this.lockedPrimary;
      this.lockedPrimary = e.id;
      this.lockedSecond = e.id2;
      const first = this.targets[0].pos ?? e.pos;
      this.anchor = { x: first.x, y: t.npc.y, z: first.z };
      const margin = HEAD_PATH_MARGIN + this.pathRadius;
      if (!(margin * margin <= xzDistSq(this.anchor, t.npc))) this.flags |= HEAD_FLAG_STRONG;
      this.flags &= ~HEAD_FLAG_TARGET_LOCKED;
      return true;
    }
    this.flags |= HEAD_FLAG_TARGET_LOCKED;
    return false;
  }

  // SinowberillHead_UpdateAttackTarget_007b0fdc (.c:796082): the anchor. Without a second target
  // it is the owner's weapon position. With one and the stand-off bit 0x80 of +0x34 set, it is
  // pushed `standOff` away from the NPC when the NPC is inside that range (head +0x88 is the
  // squared distance of the spawn check); otherwise the owner's weapon position.
  updateAttackTarget(t: { ownerWeapon: HeadPoint; npc: HeadPoint; secondTarget: boolean }): void {
    const ow = t.ownerWeapon;
    if (!t.secondTarget || (this.head34 & 0x80) === 0) {
      this.anchor = { x: ow.x, y: ow.y, z: ow.z };
      return;
    }
    if (this.dist88 <= this.standOff * this.standOff) {
      let dx = this.anchor.x - t.npc.x;
      let dz = this.anchor.z - t.npc.z;
      const l = Math.hypot(dx, dz);
      if (l !== 0) {
        dx /= l;
        dz /= l;
      }
      this.anchor = { x: this.anchor.x - dx * this.standOff, y: ow.y, z: this.anchor.z - dz * this.standOff };
      return;
    }
    this.anchor = { x: ow.x, y: ow.y, z: ow.z };
  }

  // The field's state update: SinowberillHead_UpdateState_007b00bc's map-mode branch (.c:795510..795700).
  // ctx.owner is the owner's position (the anchor's owner weapon); ctx.npc the NPC's position and
  // ctx.npcWeapon its ray origin; `allowed` is is_player_allowed_to_attack(B's player) (ASSUMED true);
  // `roll` is rand() in 0..32767; `npcStatus8` is B +0x90 & 8; `chooser(mode)` is AIProcessState(mode)
  // (quest/npcai.ts NpcHeadChooser), true when an attack is chosen.
  fieldUpdate(ctx: {
    owner: HeadPoint;
    npc: HeadPoint;
    npcWeapon: HeadPoint;
    allowed: boolean;
    roll: number;
    npcStatus8: boolean;
    ray: WallRay;
    chooser: (mode: 0 | 1) => boolean;
  }): void {
    this.npcPos = ctx.npc;
    if (this.mode === 0) {
      this.modeZeroTail(ctx);
      return;
    }
    // Mode 1: the cooldown roll (+0x8e) from the cooldown need (+0x52) when the NPC may attack.
    const localC = (this.flags & HEAD_FLAG_BIG) !== 0 ? 2 : 1; // DAT_0097ddac = 2 with 0x8000, else DAT_0097ddb0 = 1
    let s = this.cooldown8e;
    if (ctx.allowed && s === 0) {
      const r = Math.abs((ctx.roll / 32768) * 10);
      const f = this.need52 * 0.1;
      s = localC * f <= r ? Math.round(-localC * f + r) * 10 : 0;
    }
    s -= 1;
    this.cooldown8e = s < 1 ? 0 : s;

    const tryOk = this.tryAttack({ npcStatus8: ctx.npcStatus8 });
    if (!tryOk) {
      if (!ctx.chooser(1)) {
        const path = this.checkPathAndTarget({ npc: ctx.npc, npcWeapon: ctx.npcWeapon, ray: ctx.ray });
        if (!path || this.cooldown8e !== 0) {
          this.anchor = { ...ctx.npc };
          this.setMove();
        } else if ((this.flags & HEAD_FLAG_STRONG) === 0) {
          this.setMove();
        } else {
          this.state = HEAD_STATE_CAST;
          this.flags = (this.flags & 0xffffefdf) | HEAD_FLAG_ACTION; // clears 0x1000 and 0x20, sets 0x10 (.c:795556)
        }
      } else {
        this.attackOrCastBranch(ctx);
      }
    } else if (!ctx.chooser(0)) {
      if ((this.flags & HEAD_FLAG_SECOND) === 0) {
        this.updateAttackTarget({ ownerWeapon: ctx.owner, npc: ctx.npc, secondTarget: false });
        this.setMove();
      } else if (this.cooldown8e === 0) {
        this.state = HEAD_STATE_CAST;
        this.flags = (this.flags & 0xffffef5f) | HEAD_FLAG_ACTION; // clears 0x1000, 0x80, 0x20; sets 0x10
      } else {
        this.flags &= ~HEAD_FLAG_SECOND; // 0xffffff7f (.c:795700)
      }
    } else {
      this.toAttack(ctx.npc);
      this.flags &= ~(0x1000 | HEAD_FLAG_SECOND); // 0xffffef7f
    }
    if ((this.npcNeed8c & HEAD_NEED_ACQUIRED) === 0) this.mode = 0; // .c:795663: the mode exit when B +0x8c & 2 is clear
  }

  // The mode-0 tail of UpdateState_007b00bc (.c:795669..795730): the mode entry on B +0x8c bit 2,
  // else the attack chooser decides attack or the move to the owner.
  private modeZeroTail(ctx: { owner: HeadPoint; npc: HeadPoint; chooser: (mode: 0 | 1) => boolean }): void {
    if ((this.npcNeed8c & HEAD_NEED_ACQUIRED) !== 0) {
      this.mode = 1;
      this.flags &= 0xffffefcf; // clears 0x1000, 0x20 and 0x10
      this.state = HEAD_STATE_IDLE;
      this.anchor = { ...ctx.npc };
      return;
    }
    this.flags &= ~0x100; // 0xfffffeff (.c:795680)
    if (ctx.chooser(1)) {
      if ((this.flags & HEAD_FLAG_NEXT) !== 0) {
        this.toAttack(ctx.npc);
        this.flags &= ~0x1000;
        return;
      }
      this.flags &= ~HEAD_FLAG_NEXT;
      if (xzDistSq(this.anchor, ctx.npc) < HEAD_ATTACK_START_SQ) {
        this.state = HEAD_STATE_ATTACK;
        this.flags &= ~0x1000;
        this.anchor = { ...ctx.npc };
        return;
      }
      this.updateAttackTarget({ ownerWeapon: ctx.owner, npc: ctx.npc, secondTarget: false });
      this.setMove();
      return;
    }
    this.updateAttackTarget({ ownerWeapon: ctx.owner, npc: ctx.npc, secondTarget: false });
    this.setMove();
    this.cooldown8e = 0; // P+0x8e = 0 on this path (.c:795690)
  }

  // The chooser(1) attack branch of mode 1 (.c:795602..795685), with the second-target branches dormant.
  private attackOrCastBranch(ctx: { owner: HeadPoint; npc: HeadPoint }): void {
    const f = this.flags;
    if ((f & HEAD_FLAG_NEXT) === 0) {
      if ((f & HEAD_FLAG_SECOND) === 0) {
        this.flags &= ~HEAD_FLAG_NEXT;
        if (xzDistSq(this.anchor, ctx.npc) < HEAD_ATTACK_START_SQ) {
          this.state = HEAD_STATE_ATTACK;
          this.flags &= ~0x1000;
          this.anchor = { ...ctx.npc };
        } else {
          this.updateAttackTarget({ ownerWeapon: ctx.owner, npc: ctx.npc, secondTarget: false });
          this.setMove();
        }
      } else if (this.cooldown8e === 0) {
        this.state = HEAD_STATE_CAST;
        this.flags = (f & 0xffffed5f) | HEAD_FLAG_ACTION; // clears 0x1000, 0x200, 0x80, 0x20; sets 0x10
      } else {
        this.flags = f & 0xfffffd7f; // clears 0x200 and 0x80
      }
    } else {
      this.toAttack(ctx.npc);
      this.flags &= ~0x1000;
    }
  }

  // The state-8 switch of the field (.c:795580 / .c:795700): input state 0x13 is the head's action
  // input (ASSUMED not modelled), the anchor is the NPC's own weapon position.
  private toAttack(npc: HeadPoint): void {
    this.state = HEAD_STATE_ATTACK;
    this.anchor = { ...npc };
  }

  // State 1 with the move flags (0xffffefef | 0x20).
  private setMove(): void {
    this.state = HEAD_STATE_MOVE;
    this.flags = (this.flags & ~0x1010) | HEAD_FLAG_MOVE;
  }

  // The 2764 dispatch's post-state resets (.c:797023..797050): TryAttack's counter and the 0x8000 flag
  // clear unless the state is 2; the run flag 8 clears unless the state is 1; state 0 writes the send
  // and move targets from the anchor.
  afterDispatch(): void {
    if (this.state !== HEAD_STATE_CAST) {
      this.counter66 = 0;
      this.flags &= ~HEAD_FLAG_TARGET_HIT;
    }
    if (this.state !== HEAD_STATE_MOVE) this.flags &= ~HEAD_FLAG_RUN;
    if (this.state === HEAD_STATE_IDLE) {
      this.sendTarget = { ...this.anchor };
      this.moveTarget = { ...this.anchor };
    }
  }

  // The owner's and the NPC's need bits that the chooser reads (the NPC's bit 2 is the target flag).
  get acquired(): boolean {
    return (this.npcNeed8c & HEAD_NEED_ACQUIRED) !== 0;
  }
}

// The state-1 sends read the head's send target: the distance from it to the NPC, and the
// state. Returns that distance (XZ), or null when the send is not in state 1 (the run flag is
// then cleared by the caller, NpcMoveSender.reset).
export function headSendDistance(head: NpcHead, npc: { x: number; z: number }): number | null {
  if (head.state !== HEAD_STATE_MOVE) return null;
  return Math.hypot(head.sendTarget.x - npc.x, head.sendTarget.z - npc.z);
}

// --- the cast states (HandlePlayerTechCastState_007b2bc0, .c:797215) ---------------

// The input state the head's cast sets on the NPC (+0x24): 0xf (Resta) and 0x10 (Anti) are
// 0x16, 0 / 3 / 6 (Foie, Barta, Zonde) are 0x17, the other techniques 2. The release of the
// cast (the end of these states, handle_input_state_0x57 / dispatch_action_emote) is not
// traced: quest/npcai.ts keeps the port's charge + cast ticks as the busy time (ASSUMED).
export const HEAD_INPUT_STATE_SUPPORT = 0x16;
export const HEAD_INPUT_STATE_ATTACK = 0x17;
export function headCastInputState(tech: number): number {
  if (tech === 0xf || tech === 0x10) return HEAD_INPUT_STATE_SUPPORT;
  if (tech === 0 || tech === 3 || tech === 6) return HEAD_INPUT_STATE_ATTACK;
  return 2;
}

// The state-2 technique table (SinowberillHead_CastTechnique_007b2e20, .c:797346; the table is
// g_SinowberillHead_TechniqueTable at 0x0097dcf8, read with tools/exedata.py): indexed by the
// strength tier * 2 + strong. Foie, Gifoie / Barta, Gibarta / Zonde, Razonde (the port's TECH
// ids: 0, 1, 3, 4, 6, 8). These hit the target: the NPC's own target list (B +0x7c / +0x84).
export const HEAD_TWO_TECH_TABLE: readonly number[] = [0, 1, 3, 4, 6, 8];

// The tier from the head's +0x34 word: 0x4 -> 0, 0x8 -> 1, 0x10 -> 2, else 0 (.c:797366..797380).
export function headTwoTier(head34: number): number {
  if ((head34 & 4) !== 0) return 0;
  if ((head34 & 8) !== 0) return 1;
  if ((head34 & 0x10) !== 0) return 2;
  return 0;
}

// The technique the state-2 cast picks. `strong` is the head's 0x2000 flag together with the
// NPC's 0x1000 need bit (.c:797384); `roll` is the exe's rand in [0, 10) (|rand / 32768 * 10|),
// used only when not strong: the cast is skipped when roll > the head's +0x53 byte * 0.1
// (.c:797384..797388), reported as null (UpdateAnimationCounter_007b2fd8, not traced).
export function headTwoTech(head34: number, strong: boolean, roll: number, need53: number): number | null {
  if (!strong && roll > need53 * 0.1) return null;
  return HEAD_TWO_TECH_TABLE[headTwoTier(head34) * 2 + (strong ? 1 : 0)];
}

// The NPC's head (SinowberillHead_*): where the owner's client sends the NPC to walk, whether
// a move is needed, and the field's attack state machine. The exe keeps one head record per
// NPC; this is the part of it the follow walk and the attack read (DEVLOG 2026-10-23 NPC follow
// head, and the DEVLOG entry of the map-mode port). The dump's Sinowberill / Head names are
// community guesses; the bodies are what is used. Head fields: +0x34 tier word, +0x40 leash
// (stat row k=4), +0x44 / +0x58 near test, +0x48 attack radius, +0x4c far radius, +0x52 / +0x53
// need bytes, +0x54 stand-off, +0x66 / +0x68 counters, +0x6c / +0x5c timers, +0x7c state,
// +0x80 flags, +0x8c / +0x8d wall counters, +0x8e cooldown, +0x90 move timer, +0xac send
// target, +0xd0 move target, +0xdc anchor, +0xe0 / +0xe4 anchor height and z, +0x94..+0x9c the
// last move vector. The NPC's own record B has +0x38 (position), +0x300 (weapon position, XZ the
// same as +0x38), +0x7c / +0x84 (target ids), +0x8c (need bits), +0x90 (status bits).
//
// Traced (dump /Users/junior/Downloads/psobb-master/reverse/refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c):
//  - the update chain of a leader-following NPC (SinowberillChallengePlayer_Update_007aefd4,
//    .c:794690): SinowberillHead_UpdateState_007b00bc (.c:795481), then
//    SinowberillHead_AIUpdate_007b1134 (.c:796128), then the state dispatch
//    SinowberillHead_AIUpdateState_007b2764 (.c:796961), and only when the owner's 0x800 is clear
//    (.c:794710); the sends are gated by the record's +0x328 & 2 (.c:796974).
//  - Pioneer 2 (map_is_pioneer2_, .c:795492): UpdateState_007b00bc sets the anchor to the
//    owner's weapon position (UpdateAttackTarget_007b0fdc with head +0x84 == 0, .c:796082),
//    state 1 (move) and flag 0x20, and returns.
//  - the spawn check (SinowberillChallengeBoss_CheckSpawnValidity_007b1220, .c:796178): range
//    min(40, leash + 12) (DAT_0097dd8c = 40, DAT_0097dd90 = 12); inside it the head stops.
//  - the move target (SinowberillHead_AIUpdateMovement_007b1298, .c:796204): the midpoint of
//    the NPC and the anchor (k = 0.5, DAT_0097dd84). The wall ray (SinowberillHead_CheckWall_007b18e0,
//    cast_ray_at_map_collision_geometry mask 0x2100) is from the NPC's weapon position to the
//    anchor (.c:796254). With no wall and B's need bits 0x20 / 0x80 clear, the target is the
//    midpoint, or SinowberillHead_CalculateTarget_007b193c when the wall counter (+0x8c) is
//    15..29 (.c:796257..796290).
//  - the move gate (SinowberillHead_AIUpdateState_007b267c, .c:796915): xz distance squared
//    above DAT_0097dd34 = 100 needs a move; with the counter (+0x8c) at 0x1f or more the move is
//    refused and the counter is set to 0x1e with flag 0x4000 (.c:796915..796936).
//  - the state-1 sends (2764 state 1, .c:796990..797035): quest/npcai.ts NpcMoveSender.
//  - the map-mode branch (UpdateState_007b00bc, head mode +0x1c = 1, .c:795510..795700):
//    TryAttack (.c:795725), CheckPathAndTarget (.c:795775), the attack chooser
//    AIProcessState(1) / (0) (quest/npcai.ts NpcHeadChooser), UpdateAttackTarget's second
//    target branch (.c:796082). The state-2 cast is set here (.c:795602: CheckPathAndTarget
//    ok and no cooldown, flag 0x1000 set).
//  - the state-2 cast (SinowberillHead_CastTechnique_007b2e20, .c:797346): the tier from +0x34,
//    the table 0x0097dcf8, the strong flags 0x2000 (head) and 0x1000 (B +0x90), the roll with the
//    byte +0x53 (quest/npchead.ts headTwoTech); each tick while the state is 2 (2764 dispatch).
//
// ASSUMED (not traced here):
//  - the map-mode entry: UpdateState_007b00bc enters mode 1 when B +0x8c & 2 (.c:795539..); who
//    sets B +0x8c bit 2 is not traced, so the port keeps mode 0 and runs the Pioneer 2 state on
//    every map (the field branch is ported but not entered).
//  - the wall branch of AIUpdateMovement with the wall hit (CalculateAvoidanceTarget_007b23a4,
//    AdjustTargetForCollision_007b25c0, CalculatePointToSegmentDistance_007b20ac) and
//    UpdateTargetPosition_007b1ad0: the midpoint is kept when the ray hits.
//  - the counter +0x8c increments (not found in the dump: only its reset and 0x1e are written).
//  - the head's input states (+0x24: 0x13, 0x18, 7, 8, 0xb) are not modelled.
//  - the near test of TryAttack ((head +0x44)^2 <= head +0x58) is the caller's input (not traced).
//  - the cast's release timing (quest/npcai.ts, combat.ts npcCastTechnique).

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
// DAT_0097dd9c = 900: the squared distance under which the attack starts (AIUpdateMovement's
// map branch, .c:795571; 900 = 30^2) and DAT_0097dd98 = 10 (CheckPathAndTarget's margin).
export const HEAD_ATTACK_START_SQ = 900;
export const HEAD_PATH_MARGIN = 10;

// Head flags (+0x80) this module writes.
export const HEAD_FLAG_RUN = 0x8; // +0x80 & 8: a run was sent this move (2764)
export const HEAD_FLAG_MOVE = 0x20; // +0x80 & 0x20: a move was requested (UpdateState_007b00bc)
export const HEAD_FLAG_TARGET_LOCKED = 0x40; // +0x80 & 0x40: no path target (CheckPathAndTarget)
export const HEAD_FLAG_ACTION = 0x10; // +0x80 & 0x10: the cast request (state 2)
export const HEAD_FLAG_STRONG = 0x1000; // +0x80 & 0x1000: the target is far (CheckPathAndTarget)
export const HEAD_FLAG_TOO_CLOSE = 0x2000; // +0x80 & 0x2000: three or more targets (CheckPathAndTarget)
export const HEAD_FLAG_WALL_CLAMP = 0x4000; // +0x80 & 0x4000: the wall counter reached 0x1f
export const HEAD_FLAG_AVOID = 0x1; // +0x80 & 1: the avoidance target is in use (AIUpdateMovement)
export const HEAD_FLAG_NEXT = 0x200; // +0x80 & 0x200: an attack is chosen (the AIProcessState result)
export const HEAD_FLAG_ATTACK_SET = 0x100; // +0x80 & 0x100: TryAttack's attack flag
export const HEAD_FLAG_TARGET_HIT = 0x8000; // +0x80 & 0x8000: the target was re-picked and is in range (TryAttack)
export const HEAD_FLAG_SECOND = 0x80; // +0x80 & 0x80: the second target is in range (TryAttack, 0x8080)
export const HEAD_FLAG_BIG = 0x8000; // +0x80 & 0x8000: the multiplier 2 of the cooldown roll (TryAttack's 0x8080 pair)

// Head states (+0x7c). 0 = idle, 1 = move, 2 = cast, 8 = attack (AIUpdateState_007b2764).
export const HEAD_STATE_IDLE = 0;
export const HEAD_STATE_MOVE = 1;
export const HEAD_STATE_CAST = 2;
export const HEAD_STATE_ATTACK = 8;

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

export interface HeadUpdateInput {
  npc: HeadPoint; // the NPC's position (B +0x38, XZ; y for the ray)
  owner: HeadPoint; // the owner's position (A +0x300, the anchor on Pioneer 2)
  leash: number; // stat row k=4 (head +0x40)
  wall: WallRay;
  needMove?: number; // B +0x8c (the need bits 0x20 / 0x80 of the wall branch; default 0)
}

// A target of CheckPathAndTarget: the B record's entry (id, second id) and the target's position.
export interface PathTarget {
  id: number;
  id2: number;
  pos: HeadPoint | null;
}

// One NPC's head. The exe's record is one object per NPC; the port keeps one per slot
// (quest/town.ts). Start state: idle, the send target and the targets at the origin
// (never written before the first update), like the exe's zeroed record.
export class NpcHead {
  state = HEAD_STATE_IDLE; // +0x7c
  flags = 0; // +0x80
  anchor: HeadPoint = { x: 0, y: 0, z: 0 }; // +0xdc
  moveTarget: HeadPoint = { x: 0, y: 0, z: 0 }; // +0xd0
  sendTarget: HeadPoint = { x: 0, y: 0, z: 0 }; // +0xac
  // The map-mode branch's mode (head +0x1c): 0 = Pioneer-style follow, 1 = field attack (ASSUMED
  // not entered, see the header).
  mode = 0;
  counter66 = 0; // +0x66: TryAttack's retarget counter (3)
  counter68 = 0; // +0x68: CheckPathAndTarget's counter (100)
  cooldown8e = 0; // +0x8e: the attack cooldown from the roll (AIUpdateState cooldown)
  wall8c = 0; // +0x8c (byte): the wall counter (CalculateTarget at 15..29, stuck at 0x1f)
  wall8d = 0; // +0x8d (byte): the counter's reset guard
  head34 = 0; // +0x34: the tier word (ASSUMED 0 for an NPC's head, see headTwoTier)
  prevNpc: HeadPoint | null = null; // the NPC's position of the last update (the move vector, +0x9c..)
  wallHit = false; // the wall ray's answer for the last movement (the branch it picks is ASSUMED)
  castTicks = 0; // the state-2 cast's busy ticks (ASSUMED: the technique's charge + cast)

  // UpdateState_007b00bc on Pioneer 2 (.c:795492): the anchor is the owner's position
  // (UpdateAttackTarget with no second target), the state is 1 (move), and the flags get 0x20
  // with 0x1010 cleared.
  pioneerUpdateState(owner: HeadPoint): void {
    this.anchor = { x: owner.x, y: owner.y, z: owner.z };
    this.state = HEAD_STATE_MOVE;
    this.flags = (this.flags & ~0x1010) | HEAD_FLAG_MOVE;
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
    // CheckSpawnValidity: the NPC inside the range of its anchor stops (.c:796178).
    const range = headSpawnRange(i.leash);
    if (xzDistSq(this.anchor, i.npc) < range * range) {
      if ((this.flags & HEAD_FLAG_MOVE) !== 0 && this.state !== HEAD_STATE_ATTACK) {
        this.state = HEAD_STATE_IDLE;
        this.flags &= ~HEAD_FLAG_MOVE;
        this.anchor = { x: i.owner.x, y: i.owner.y, z: i.owner.z };
      }
      this.prevNpc = { ...i.npc };
      return; // the send target is not written on this path (.c:796131)
    }
    const move = this.prevNpc ? { x: i.npc.x - this.prevNpc.x, z: i.npc.z - this.prevNpc.z } : { x: 0, z: 0 };
    this.prevNpc = { ...i.npc };
    // AIUpdateMovement (.c:796204): the midpoint, or the stuck target at the wall counter's band.
    const mid = headMidpoint(i.npc, this.anchor);
    this.wallHit = i.wall(raised(i.npc), raised(this.anchor), HEAD_WALL_MASK);
    const needMove = i.needMove ?? 0;
    if (!this.wallHit && (needMove & 0x20) === 0 && (needMove & 0x80) === 0) {
      if (this.wall8c < 0xf || this.wall8c > 0x1d) {
        if (this.wall8d > 0xf) this.wall8c = 0;
        this.moveTarget = mid;
      } else {
        this.moveTarget = headCalculateTarget(i.npc, this.anchor, move, this.wall8c);
      }
      this.flags &= ~HEAD_FLAG_AVOID; // 0x80 & 0xfffffffe (.c:796257..796290)
    } else {
      // The wall branch (avoidance, UpdateTargetPosition) is ASSUMED to be the midpoint.
      this.moveTarget = mid;
    }
    // AIUpdateState_007b267c (.c:796915): a move is needed when the send target is more than 10 away.
    if (this.moveGate()) {
      this.sendTarget = { ...this.moveTarget };
      if (this.state !== HEAD_STATE_CAST) {
        this.state = HEAD_STATE_MOVE;
        this.flags = (this.flags & ~0x1010) | HEAD_FLAG_MOVE;
      }
      return;
    }
    // No move: the send target is the NPC's own position (AIUpdate_007b1134 .c:796149).
    this.sendTarget = { x: i.npc.x, y: i.npc.y, z: i.npc.z };
  }

  // SinowberillHead_TryAttack_007b0754 (.c:795725). `near` is (head +0x44)^2 <= head +0x58
  // (ASSUMED: the caller's test). `primaryPos` is the NPC's first target (B +0x7c's record), or
  // null; `hasTargets` is B's candidate count != 0. Returns the attack flag.
  tryAttack(t: { ownerBusy: boolean; npcStatus8: boolean; near: boolean; hasTargets: boolean; primaryPos: HeadPoint | null; npc: HeadPoint; attackRadius: number }): boolean {
    if (t.ownerBusy) {
      this.flags &= ~HEAD_FLAG_ATTACK_SET;
      return false;
    }
    if (t.npcStatus8) {
      this.flags |= HEAD_FLAG_ATTACK_SET;
      return true;
    }
    if (t.near) {
      this.flags |= HEAD_FLAG_ATTACK_SET;
      if (t.hasTargets) {
        if (this.counter66 + 1 < 3) {
          this.counter66++;
        } else {
          this.counter66 = 0;
          this.flags &= ~HEAD_FLAG_TARGET_HIT;
          if (t.primaryPos && xzDistSq(t.primaryPos, t.npc) < t.attackRadius * t.attackRadius) this.flags |= HEAD_FLAG_TARGET_HIT | HEAD_FLAG_SECOND;
        }
      }
      return true;
    }
    if ((this.flags & HEAD_FLAG_ATTACK_SET) !== 0) return true;
    this.flags &= ~HEAD_FLAG_ATTACK_SET;
    return false;
  }

  // SinowberillHead_CheckPathAndTarget_007b086c (.c:795775). `targets` is B's candidate list
  // (the exe's B +0x0 count and triples of ids). The first target with a clear ray from the NPC's
  // weapon position (mask 0x2100) becomes the locked one: B +0x7c / +0x84 take its ids, the anchor
  // is the first candidate's position at the NPC's height, and flag 0x1000 is set when the
  // anchor is beyond (far + 10). Returns true when a target was picked. The state writes of the
  // counter (+0x24: 0 / 1 / 8) are ASSUMED (not modelled).
  checkPathAndTarget(t: { targets: readonly PathTarget[]; npc: HeadPoint; npcWeapon: HeadPoint; farRadius: number; ray: WallRay; lockedId: { primary: number; second: number } }): boolean {
    const count = t.targets.length;
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
    if (count === 0) return false;
    for (const e of t.targets) {
      if (!e.pos) continue;
      const to = { x: e.pos.x, y: t.npcWeapon.y, z: e.pos.z };
      if (t.ray(t.npcWeapon, to, HEAD_WALL_MASK)) continue;
      t.lockedId.primary = e.id;
      t.lockedId.second = e.id2;
      const first = t.targets[0].pos ?? e.pos;
      this.anchor = { x: first.x, y: t.npc.y, z: first.z };
      const far = HEAD_PATH_MARGIN + t.farRadius;
      if (far * far > xzDistSq(this.anchor, t.npc)) this.flags |= HEAD_FLAG_STRONG;
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
  updateAttackTarget(t: { ownerWeapon: HeadPoint; npc: HeadPoint; secondTarget: boolean; standOff: number; distSq: number }): void {
    const ow = t.ownerWeapon;
    if (!t.secondTarget || (this.head34 & 0x80) === 0) {
      this.anchor = { x: ow.x, y: ow.y, z: ow.z };
      return;
    }
    if (t.distSq <= t.standOff * t.standOff) {
      let dx = this.anchor.x - t.npc.x;
      let dz = this.anchor.z - t.npc.z;
      const l = Math.hypot(dx, dz);
      if (l !== 0) {
        dx /= l;
        dz /= l;
      }
      this.anchor = { x: this.anchor.x - dx * t.standOff, y: ow.y, z: this.anchor.z - dz * t.standOff };
      return;
    }
    this.anchor = { x: ow.x, y: ow.y, z: ow.z };
  }

  // The map-mode branch of SinowberillHead_UpdateState_007b00bc (head mode 1, .c:795510..795700).
  // ctx: the attack inputs of the call. chooser(mode) is AIProcessState(mode) (quest/npcai.ts
  // NpcHeadChooser.choose returns its attack flag). It returns nothing; it updates state, flags,
  // anchor and the cooldown. The mode exit at the end (B +0x8c & 2 clear -> mode 0) is applied.
  fieldUpdate(ctx: {
    ownerWeapon: HeadPoint;
    owner: HeadPoint;
    npc: HeadPoint;
    npcWeapon: HeadPoint;
    npcNeed8c: number;
    npcStatus90: number;
    npcSecond: boolean;
    npcTargets: readonly PathTarget[];
    lockedId: { primary: number; second: number };
    ownerNeed8c: number;
    allowed: boolean;
    roll: number; // _rand(), 0..32767
    need52: number;
    near: boolean;
    npcStatus8: boolean;
    hasTargets: boolean;
    primaryPos: HeadPoint | null;
    attackRadius: number;
    farRadius: number;
    standOff: number;
    ray: WallRay;
    chooser: (mode: 0 | 1) => boolean;
  }): void {
    // The cooldown (+0x8e): rolled from the need byte when the player may attack and it is 0.
    const localC = (this.flags & HEAD_FLAG_BIG) !== 0 ? 2 : 1; // DAT_0097ddac = 2 when 0x8000, else DAT_0097ddb0 = 1
    let s = this.cooldown8e;
    if (ctx.allowed && s === 0) {
      const r = Math.abs((ctx.roll / 32768) * 10);
      const f = ctx.need52 * 0.1;
      s = localC * f <= r ? Math.round(-localC * f + r) * 10 : 0;
    }
    s -= 1;
    this.cooldown8e = s < 1 ? 0 : s;

    const tryOk = this.tryAttack({
      ownerBusy: (ctx.ownerNeed8c & 2) !== 0,
      npcStatus8: ctx.npcStatus8,
      near: ctx.near,
      hasTargets: ctx.hasTargets,
      primaryPos: ctx.primaryPos,
      npc: ctx.npc,
      attackRadius: ctx.attackRadius,
    });
    if (!tryOk || ctx.npcSecond) {
      if (!ctx.chooser(1)) {
        const path = this.checkPathAndTarget({ targets: ctx.npcTargets, npc: ctx.npc, npcWeapon: ctx.npcWeapon, farRadius: ctx.farRadius, ray: ctx.ray, lockedId: ctx.lockedId });
        if (!path || this.cooldown8e !== 0) {
          if (!ctx.npcSecond) this.anchor = { ...ctx.npc };
          else this.updateAttackTarget({ ownerWeapon: ctx.ownerWeapon, npc: ctx.npc, secondTarget: true, standOff: ctx.standOff, distSq: xzDistSq(this.anchor, ctx.npc) });
          this.state = HEAD_STATE_MOVE;
          this.flags = (this.flags & ~0x1010) | HEAD_FLAG_MOVE;
        } else if ((this.flags & HEAD_FLAG_STRONG) === 0) {
          this.state = HEAD_STATE_MOVE;
          this.flags = (this.flags & ~0x1010) | HEAD_FLAG_MOVE;
        } else {
          this.state = HEAD_STATE_CAST;
          this.flags = (this.flags & 0xffffefdf) | HEAD_FLAG_ACTION; // clears 0x1000 and 0x20 (.c:795556)
        }
      } else {
        this.enterAttackOrCast(ctx);
      }
    } else if (!ctx.chooser(0)) {
      if ((this.flags & HEAD_FLAG_SECOND) === 0) {
        this.updateAttackTarget({ ownerWeapon: ctx.ownerWeapon, npc: ctx.npc, secondTarget: false, standOff: ctx.standOff, distSq: 0 });
        this.state = HEAD_STATE_MOVE;
        this.flags = (this.flags & ~0x1010) | HEAD_FLAG_MOVE;
      } else if (this.cooldown8e === 0) {
        this.state = HEAD_STATE_CAST;
        this.flags = (this.flags & 0xffffef5f) | HEAD_FLAG_ACTION;
      } else {
        this.flags &= ~HEAD_FLAG_AVOID;
      }
    } else {
      this.anchor = { ...ctx.ownerWeapon };
      this.state = HEAD_STATE_ATTACK;
      this.flags &= ~0x1000;
      this.flags &= ~0x80;
    }
    if ((ctx.npcNeed8c & 2) === 0) this.mode = 0; // .c:795663: the mode exit when B +0x8c & 2 is clear
  }

  // The AIProcessState(1) attack branch of the field update (.c:795602..795685).
  private enterAttackOrCast(ctx: { ownerWeapon: HeadPoint; npc: HeadPoint; npcSecond: boolean; standOff: number }): void {
    const f = this.flags;
    if ((f & HEAD_FLAG_NEXT) === 0) {
      if ((f & HEAD_FLAG_SECOND) === 0) {
        this.flags &= ~HEAD_FLAG_NEXT;
        if (xzDistSq(this.anchor, ctx.npc) < HEAD_ATTACK_START_SQ) {
          this.state = HEAD_STATE_ATTACK;
          this.flags &= ~HEAD_FLAG_STRONG;
          this.anchor = { ...ctx.ownerWeapon };
        } else if (!ctx.npcSecond) {
          this.updateAttackTarget({ ownerWeapon: ctx.ownerWeapon, npc: ctx.npc, secondTarget: false, standOff: ctx.standOff, distSq: 0 });
          this.state = HEAD_STATE_MOVE;
          this.flags = (this.flags & ~0x1010) | HEAD_FLAG_MOVE;
        } else if (this.cooldown8e === 0) {
          this.state = HEAD_STATE_CAST;
          this.flags = (this.flags & ~HEAD_FLAG_MOVE) | HEAD_FLAG_ACTION;
        }
      } else if (this.cooldown8e === 0) {
        this.state = HEAD_STATE_CAST;
        this.flags = (f & 0xffffed5f) | HEAD_FLAG_ACTION;
      } else {
        this.flags = f & 0xfffffd7f;
      }
    } else {
      this.state = HEAD_STATE_ATTACK;
      this.flags &= ~HEAD_FLAG_STRONG;
      this.anchor = { ...ctx.ownerWeapon };
    }
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

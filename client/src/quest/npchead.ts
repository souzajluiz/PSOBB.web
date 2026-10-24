// The NPC follower's head (SinowberillHead_*): where the owner's client sends the
// NPC to walk, and whether a move is needed. The exe keeps one head record per
// NPC; this is the part of it the follow walk reads (DEVLOG 2026-10-23 NPC follow
// head). The dump's Sinowberill / Head names are community guesses; the bodies are
// what is used. Record fields: +0xdc anchor (the point the NPC wants to stand at),
// +0xd0 move target, +0xac send target (the point the 6x40 / 6x42 carry), +0x7c
// state, +0x80 flags, +0x40 leash (stat row k=4). The NPC's own record B has +0x38
// (player position), +0x300 (weapon position, XZ the same as +0x38 per the struct's
// comment), and +0x8c (need bits).
//
// Traced (dump /Users/junior/Downloads/psobb-master/reverse/refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c):
//  - the update chain of a leader-following NPC (SinowberillChallengePlayer_Update_007aefd4,
//    .c:794690): SinowberillHead_UpdateState_007b00bc (.c:795481), then
//    SinowberillHead_AIUpdate_007b1134 (.c:796128), then the state-1 sends
//    SinowberillHead_AIUpdateState_007b2764 (.c:796961), and only when the owner's
//    own 0x800 is clear (.c:794710); the sends are gated by the record's +0x328 & 2 (.c:796974).
//  - Pioneer 2 (map_is_pioneer2_, .c:795492): UpdateState_007b00bc sets the anchor to
//    the owner's position (UpdateAttackTarget_007b0fdc with head +0x84 == 0, .c:796082),
//    state 1 (move) and flag 0x20, and returns. So in the town the head always moves.
//  - the spawn check (SinowberillChallengeBoss_CheckSpawnValidity_007b1220, .c:796178):
//    the NPC is valid while its xz distance to the anchor is at least
//    min(40, leash + 12) (DAT_0097dd8c = 40, DAT_0097dd90 = 12). Inside that range the
//    head stops: state 0 and flag 0x20 cleared when the state is not 8, the send target
//    is not written, and the state-1 sends see nothing.
//  - the move target (SinowberillHead_AIUpdateMovement_007b1298, .c:796204): the
//    midpoint of the NPC and the anchor (k = 0.5, DAT_0097dd84), checked with the wall
//    ray SinowberillHead_CheckWall_007b18e0 (cast_ray_at_map_collision_geometry mask
//    0x2100, .c:796427). With no wall and the NPC's need bits 0x20 / 0x80 clear, the
//    target is the midpoint (+0xd0).
//  - the move-needed gate (SinowberillHead_AIUpdateState_007b267c, .c:796915): the xz
//    distance squared between the send target (+0xac) and the new target (+0xd0) must
//    be above 100 (DAT_0097dd34). When it is, the send target becomes the target and
//    the state is 1 (unless it is 2) with flag 0x20. When it is not, the send target is
//    the NPC's own position (.c:796149), so the state-1 sends find nothing to walk to.
//  - the state-1 sends (SinowberillHead_AIUpdateState_007b2764 state 1, .c:796990..797035)
//    are in quest/npcai.ts NpcMoveSender, read from the send target.
//
// ASSUMED (not traced here): the wall branch of AIUpdateMovement (the avoidance target
// CalculateAvoidanceTarget_007b23a4, AdjustTargetForCollision_007b25c0, the path
// CalculateTarget_007b193c, UpdateTargetPosition_007b1ad0): when the ray hits a wall the
// midpoint is used anyway; the owner's weapon height (+0x300 y) is taken as the
// position's y plus WALL_RAY_HEIGHT (5, the player's wall-ray height in render/collision.ts);
// the non-Pioneer map branch (head mode +0x1c, UpdateState_007b00bc mode 1: TryAttack,
// CheckPathAndTarget) is not run here, so the follow walk is the same on every map.

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

// Head flags (+0x80) this module writes.
export const HEAD_FLAG_RUN = 0x8; // +0x80 & 8: a run was sent this move (2764)
export const HEAD_FLAG_MOVE = 0x20; // +0x80 & 0x20: a move was requested (UpdateState_007b00bc)

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

// The wall ray between the NPC and the anchor (SinowberillHead_CheckWall_007b18e0). The
// caller passes the map's ray with the mask (combat view's npcWallBlocks).
export type WallRay = (from: HeadPoint, to: HeadPoint, mask: number) => boolean;

const raised = (p: HeadPoint): HeadPoint => ({ x: p.x, y: p.y + HEAD_RAY_HEIGHT, z: p.z });

export interface HeadUpdateInput {
  npc: HeadPoint; // the NPC's position (B +0x38, XZ; y for the ray)
  owner: HeadPoint; // the owner's position (A +0x300, the anchor on Pioneer 2)
  leash: number; // stat row k=4 (head +0x40)
  wall: WallRay;
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

  // UpdateState_007b00bc on Pioneer 2 (.c:795492): the anchor is the owner's
  // position (UpdateAttackTarget with no second target), the state is 1 (move), and
  // the flags get 0x20 with 0x1010 cleared.
  pioneerUpdateState(owner: HeadPoint): void {
    this.anchor = { x: owner.x, y: owner.y, z: owner.z };
    this.state = HEAD_STATE_MOVE;
    this.flags = (this.flags & ~0x1010) | HEAD_FLAG_MOVE;
  }

  // SinowberillHead_AIUpdate_007b1134 (.c:796128) with its movement and state gate. Inside
  // the spawn range the send target keeps its last value (the exe returns before writing it).
  // wallHit is the wall ray's answer for the last movement (the branch it picks is ASSUMED).
  wallHit = false;

  update(i: HeadUpdateInput): void {
    // CheckSpawnValidity: the NPC inside the range of its anchor stops (.c:796178).
    const range = headSpawnRange(i.leash);
    if (xzDistSq(this.anchor, i.npc) < range * range) {
      if ((this.flags & HEAD_FLAG_MOVE) !== 0 && this.state !== HEAD_STATE_ATTACK) {
        this.state = HEAD_STATE_IDLE;
        this.flags &= ~HEAD_FLAG_MOVE;
        this.anchor = { x: i.owner.x, y: i.owner.y, z: i.owner.z };
      }
      return; // the send target is not written on this path (.c:796131)
    }
    // AIUpdateMovement (.c:796204): the midpoint; the wall branch is ASSUMED to use it too.
    this.moveTarget = headMidpoint(i.npc, this.anchor);
    this.wallHit = i.wall(raised(i.npc), raised(this.anchor), HEAD_WALL_MASK);
    // AIUpdateState_007b267c (.c:796915): a move is needed when the send target is more than 10 away.
    if (xzDistSq(this.sendTarget, this.moveTarget) > HEAD_MOVE_GATE_SQ) {
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

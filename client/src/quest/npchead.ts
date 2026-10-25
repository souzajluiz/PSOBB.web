// The NPC's head (SinowberillHead_*): where the owner's client sends the NPC to walk, whether
// a move is needed, the target pick of the field, the wall avoidance, and the state dispatch.
// The exe keeps one head record per NPC (P) with the owner entity Q = P+0x74 and the NPC entity
// B = P+0x78 (B+0x94 is the NPC's player record: its position +0x38, weapon +0x300, +0x304 y).
// The dump's Sinowberill / Head names are community guesses; the bodies are what is used.
//
// Head fields (P): +0x28 the one-time init, +0x30 / +0x34 raw row words (+0x34 = the tier word, 0x40 =
// no state-2 cast), +0x38 acquire range, +0x40 leash, +0x44 far radius, +0x48 attack radius, +0x4c path
// radius, +0x50 level byte, +0x52 / +0x53 need bytes, +0x54 stand-off, +0x58 owner-NPC distance^2,
// +0x66 TryAttack counter, +0x68 path counter, +0x7c state, +0x80 flags, +0x88 spawn distance^2,
// +0x8c / +0x8d wall counters, +0x8e cooldown, +0x90 the arrival counter (short), +0x92 the action,
// +0x94 the avoidance direction, +0xa0 the avoidance target, +0xac send target, +0xd0 move target,
// +0xdc anchor, +0xd8..+0x104 the collision record (B's, see HeadRecord).
// B fields: +0x0 candidate count and triples (id, box, distance^2), +0x7c / +0x84 the locked id and
// box (+0x80 the previous id), +0x8c need bits (0x1 moved, 0x2 acquired a target, 0x4 need, 0x20 / 0x80
// the collision probe), +0x90 status bits, +0x9c the last move origin.
//
// Traced (dump /Users/junior/Downloads/psobb-master/reverse/refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c):
//  - the per-tick chain (SinowberillChallengePlayer_Update_007aefd4, .c:794690): ResetEntityHitboxes_007b34e8
//    (.c:797677: Q and B +0x8c / +0x90 cleared every tick; the one-time UpdatePosition_007b3458 when P+0x28 is 0),
//    UpdateState_007af1a8 (the owner's bit 2 on Q, range 30), SinowberillHead_UpdateState_007af7ec (.c:795069: the
//    owner-NPC distance, the B acquire, the collision probe's bits 0x20 / 0x80, the moved test and the wall
//    counter), SinowberillHead_UpdateState_007b00bc (.c:795481), SinowberillHead_AIUpdate_007b1134 (.c:796128),
//    and the state dispatch SinowberillHead_AIUpdateState_007b2764 (.c:796961) with its B +0x328 & 2 gate.
//  - the stat row (SinowberillChallenge_InitializePlayerStats_007adbe0, .c:794403..794413; see npcai.ts NPC_ATTACK_ROWS).
//  - the mode-1 entry (AcquireTarget_007afc2c, .c:795255): B +0x8c bit 2 when a candidate is within the range.
//  - the candidate list: EnemyAI_AcquireClosestTargetInRange (.c:794836), B's triples, at most 9, nearest first.
//  - the move target (AIUpdateMovement_007b1298, .c:796204..796410): the midpoint, the stuck target
//    (CalculateTarget_007b193c) in the wall counter's band, UpdateTargetPosition_007b1ad0 with the 0x20 bit, and on a
//    wall hit (CheckWall_007b18e0) CalculateAvoidanceTarget_007b23a4, AdjustTargetForCollision_007b25c0 and
//    CalculatePointToSegmentDistance_007b20ac (the helpers below).
//  - the move gate (AIUpdateState_007b267c, .c:796915), the spawn check (CheckSpawnValidity_007b1220, .c:796178).
//  - the mode-0 tail (.c:795669..795730) and mode 1 (.c:795510..795700), TryAttack (.c:795725), CheckPathAndTarget
//    (.c:795775), the state-2 cast (CastTechnique_007b2e20, .c:797346) and HandlePlayerTechCastState_007b2bc0 (.c:797215).
//  - ExecuteAttack (SinowberillHead_ExecuteAttack_007b2ae8, .c:797151): state 8 runs it with the action +0x92.
//    The 0x16 / 0x17 input states are the player's action dispatch (PlayerActionDispatch, .c:232924).
//
// ASSUMED (not traced here):
//  - the collision probe (B+0xa8): the enemy part is ported (headProbeEnemies, the xz cut-off and a box centre
//    within PLAYER_RADIUS for CheckTwoHitboxCollision_007b5e40, ASSUMED); the object record (0x40000000) has no
//    source in the port, so UpdateTargetPosition stays dormant.
//  - the input states (+0x24) and timers: the writers of the paths the port runs are ported (see setInputState);
//    the TP gate of CastTechnique (input 3), AIProcessState's 0x14 / 0x6c writes, the multi-step attack (input
//    0xd), and the anim-timing acquire states (0xe..0x11, CheckAnimationState: B +0x334 is ASSUMED 0) are not.
//    The +0x5c increment is ASSUMED one per head tick (tickInput). The bit 0x100 of the head flags and +0x100 of
//    B are the collision record (B +0xd8..0x104), not a timer.
//  - the 2764 gate (B.player +0x328 & 2) is movement_state standing (= input state 1, SetPlayerInputState_00694390
//    writes 1 << input); the port reads it as "the NPC is not moving" (ASSUMED, see town.ts stepNpcHead).
//  - the weapon (B.player +0x300) is the NPC's feet position; the object of CheckWall is the hit point and
//    its normal is the surface normal (ground_info object x,y,z assumed to be the hit point).
//  - the threshold of GetDistancePointToLineSegment (g_DistancePointToLineSegmentThresholdSq) is 0.
//  - the strong bit B +0x90 & 0x1000 and status bits 8 / 0x10 come from the server (0 here).
//  - B.player +0x44 (the NPC's last position for CheckHeadDistance) is the position at the last tick.
//  - the input states of the head (+0x24) and the timers +0x5c / +0x5e / +0x6a / +0x6c / +0x70 / +0x100 are
//    not modelled; the busy time of a cast is the charge ticks (quest/npcai.ts, combat.ts npcCastTechnique).
//  - the Pioneer 2 test (map_is_pioneer2_) is the floor 0 of the lobby.

import { PLAYER_RADIUS } from '../render/collision.ts';

// DAT_0097dd84 (.c:796204): the midpoint factor.
export const HEAD_MIDPOINT = 0.5;
// DAT_0097dd34 = 100: the squared distance above which a move is needed (AIUpdateState_007b267c).
export const HEAD_MOVE_GATE_SQ = 100;
// DAT_0097dd8c = 40 and DAT_0097dd90 = 12: the spawn check's range is min(40, leash + 12).
export const HEAD_SPAWN_CAP = 40;
export const HEAD_SPAWN_PAD = 12;
// The wall ray's mask (SinowberillHead_CheckWall_007b18e0, .c:796427; the same mask in AdjustTarget and the avoidance).
export const HEAD_WALL_MASK = 0x2100;
// ASSUMED: the owner's weapon height above its feet for the wall ray.
export const HEAD_RAY_HEIGHT = 5;
// DAT_0097dd6c = 20: CalculateTarget's offset (.c:796453) and DAT_0097dd60 = 20 (UpdateTargetPosition's radius offset).
export const HEAD_STUCK_OFFSET = 20;
export const HEAD_TARGET_RADIUS_OFFSET = 20;
// DAT_0097dd9c = 900: the squared distance under which the attack starts (30^2); DAT_0097dd98 = 10 (CheckPathAndTarget's margin).
export const HEAD_ATTACK_START_SQ = 900;
export const HEAD_PATH_MARGIN = 10;
// DAT_0097dddc = 0.4: the distance the NPC must move for CheckHeadDistance to count it as moved.
export const HEAD_MOVED_DIST = 0.4;
// DAT_0097dcd8 = 18 (UpdatePosition_007b3458): the first move target is the owner's position + (0, 0, 18).
export const HEAD_SPAWN_Z = 18;
// DAT_0097dd38 = 10 (AdjustTargetForCollision's pull-back) and DAT_0097dd54 = 10 (the segment distance's offset).
export const HEAD_PULL_BACK = 10;
export const HEAD_SEG_OFFSET = 10;
// The avoidance (CalculateAvoidanceTarget): DAT_0097dd48 = 1.5 and DAT_0097dd44 = 20 (the floor of the step),
// DAT_0097dd40 = 5 (the owner-ray point), DAT_0097dd7c = 40 (the step along the avoidance direction).
export const HEAD_AVOID_SCALE = 1.5;
export const HEAD_AVOID_FLOOR = 20;
export const HEAD_AVOID_OWNER = 5;
export const HEAD_AVOID_STEP = 40;
// The arrival tests: DAT_0097dd78 = 5 (blocked branch with the arrive flag), DAT_0097dd74 = 1.5 (clear branch),
// DAT_0097dd80 = 1.0 (the step-back arrival, AIUpdateMovement's blocked branch).
export const HEAD_ARRIVE_BLOCKED = 5;
export const HEAD_ARRIVE_CLEAR = 1.5;
export const HEAD_ARRIVE_STEP = 1;
// DAT_0097dd68 = 12: UpdateTargetPosition's simple-branch test on B +0xe8.
export const HEAD_RECORD_SIMPLE = 12;
// DAT_0097dd2c = 1.0: the send stop distance (SendMove family, .c:797009).
export const HEAD_STOP_DISTANCE = 1;
// ValidateDoorAnimation's squared distance floor (the port's 0x00836208 reading: under 0.025 reads as 0).
const DOOR_FLOOR_SQ = 0.025;
// The max candidates of the target list (EnemyAI_AcquireClosestTargetInRange: the list stops at 9).
export const HEAD_MAX_TARGETS = 9;
// The owner's acquire range (EnemyAI_AcquireClosestTargetInRange(Q, 30.0, ...), .c:794816).
export const HEAD_OWNER_ACQUIRE = 30;

// Head flags (+0x80) this module writes or reads.
export const HEAD_FLAG_BUBBLE = 0x4; // +0x80 & 4: the input state changed, the chat line is due (2764 -> DisplayChatBubble_007b2a30)
export const HEAD_FLAG_AVOID = 0x1; // +0x80 & 1: the avoidance target is in use (AIUpdateMovement)
export const HEAD_FLAG_ARRIVE = 0x2; // +0x80 & 2: the blocked / clear arrival test is pending
export const HEAD_FLAG_RUN = 0x8; // +0x80 & 8: a run was sent this move (2764)
export const HEAD_FLAG_ACTION = 0x10; // +0x80 & 0x10: the cast request (state 2)
export const HEAD_FLAG_MOVE = 0x20; // +0x80 & 0x20: a move was requested (UpdateState_007b00bc)
export const HEAD_FLAG_TARGET_LOCKED = 0x40; // +0x80 & 0x40: no path target (CheckPathAndTarget)
export const HEAD_FLAG_SECOND = 0x80; // +0x80 & 0x80: the second target is in range (TryAttack, 0x8080)
export const HEAD_FLAG_ATTACK_SET = 0x100; // +0x80 & 0x100: TryAttack's attack flag
export const HEAD_FLAG_NEXT = 0x200; // +0x80 & 0x200: an attack is chosen (the chooser's result)
export const HEAD_FLAG_STRONG = 0x1000; // +0x80 & 0x1000: the target is near the anchor (CheckPathAndTarget)
export const HEAD_FLAG_TOO_CLOSE = 0x2000; // +0x80 & 0x2000: three or more targets (CheckPathAndTarget)
export const HEAD_FLAG_WALL_CLAMP = 0x4000; // +0x80 & 0x4000: the wall counter reached 0x1f
export const HEAD_FLAG_TARGET_HIT = 0x8000; // +0x80 & 0x8000: the target was re-picked and is in range (TryAttack)
export const HEAD_FLAG_BIG = 0x8000; // +0x80 & 0x8000: the cooldown roll's multiplier 2 (DAT_0097ddac)

// Head states (+0x7c). 0 = idle, 1 = move, 2 = cast, 8 = attack (AIUpdateState_007b2764).
export const HEAD_STATE_IDLE = 0;
export const HEAD_STATE_MOVE = 1;
export const HEAD_STATE_CAST = 2;
export const HEAD_STATE_ATTACK = 8;

// B +0x8c need bits this module reads or writes.
export const HEAD_NEED_MOVED = 0x1;
export const HEAD_NEED_ACQUIRED = 0x2;
export const HEAD_NEED_0X20 = 0x20; // the probe hit an object: the collision record is set
export const HEAD_NEED_0X80 = 0x80; // the probe hit an enemy

export interface HeadPoint {
  x: number;
  y: number;
  z: number;
}

// xz distance squared (vec3_xz_distance_sq).
export function xzDistSq(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

const vlen = (v: HeadPoint): number => Math.hypot(v.x, v.y, v.z);
// vec3_normalize: the vector is divided by its length only when that is not 0.
const vnorm = (v: HeadPoint): HeadPoint => {
  const l = vlen(v);
  return l !== 0 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: v.x, y: v.y, z: v.z };
};
const vdot = (a: HeadPoint, b: HeadPoint): number => a.x * b.x + a.y * b.y + a.z * b.z;
const vadd = (a: HeadPoint, b: HeadPoint): HeadPoint => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vsub = (a: HeadPoint, b: HeadPoint): HeadPoint => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vscale = (a: HeadPoint, k: number): HeadPoint => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const xzOf = (v: HeadPoint): HeadPoint => ({ x: v.x, y: 0, z: v.z });

// matrix_rotation_y with a BAMS angle (0x10000 = a full turn): x' = x cos + z sin, z' = z cos - x sin
// (the convention of CalculateTarget's +90 side, .c:796453).
export function rotYBams(v: HeadPoint, bams: number): HeadPoint {
  const a = ((bams & 0xffff) / 0x10000) * 2 * Math.PI;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: v.z * c - v.x * s };
}

// The spawn check's range (SinowberillChallengeBoss_CheckSpawnValidity_007b1220): min(40, leash + 12).
export function headSpawnRange(leash: number): number {
  const r = HEAD_SPAWN_PAD + leash;
  return HEAD_SPAWN_CAP <= r ? HEAD_SPAWN_CAP : r;
}

// The midpoint of the NPC and the anchor (AIUpdateMovement_007b1298, the k = 0.5 branch).
export function headMidpoint(npc: HeadPoint, anchor: HeadPoint): HeadPoint {
  return vadd(npc, vscale(vsub(anchor, npc), HEAD_MIDPOINT));
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

// A wall hit of the map ray (SinowberillHead_CheckWall_007b18e0): the object's position (ASSUMED the hit
// point) and its normal. `null` is no hit.
export interface WallHit {
  point: HeadPoint;
  normal: HeadPoint;
}
export type WallRay = (from: HeadPoint, to: HeadPoint, mask: number) => WallHit | null;

const raised = (p: HeadPoint): HeadPoint => ({ x: p.x, y: p.y + HEAD_RAY_HEIGHT, z: p.z });

// GetDistancePointToLineSegment_0083a0dc (.c:855683): the distance from p to the line through `o` with
// direction `d` (the exe does not clamp it to a segment), and the closest point on it. A squared distance
// under the threshold reads as 0 (ASSUMED threshold 0: g_DistancePointToLineSegmentThresholdSq is not traced).
export function distancePointToLine(p: HeadPoint, o: HeadPoint, d: HeadPoint): { dist: number; closest: HeadPoint } {
  const dd = d.z * d.z + d.x * d.x + d.y * d.y;
  const t = dd === 0 ? 0 : ((p.z - o.z) * d.z + (p.y - o.y) * d.y + (p.x - o.x) * d.x) / dd;
  const closest = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
  const sq = (p.x - closest.x) ** 2 + (p.y - closest.y) ** 2 + (p.z - closest.z) ** 2;
  return { dist: Math.sqrt(sq), closest };
}

// ValidateDoorAnimation_00836208 (.c:852670, the port's 0x00836208 reading): the distance, 0 under 0.025 squared.
export function doorDistance(a: HeadPoint, b: HeadPoint): number {
  const sq = (a.z - b.z) ** 2 + (a.y - b.y) ** 2 + (a.x - b.x) ** 2;
  return sq < DOOR_FLOOR_SQ ? 0 : Math.sqrt(sq);
}

// SinowberillHead_CalculatePointToSegmentDistance_007b20ac (.c:796696): the direction and the distance from the
// point p5 to the two segments (p1,p2) and (p3,p4). The first segment's measure is the mid of (p1,p2) against its
// closest point; the second's uses the same mid (the exe reads p1 and p2 twice) and the length of (p3,p4).
export function pointToSegmentDistance(p1: HeadPoint, p2: HeadPoint, p3: HeadPoint, p4: HeadPoint, p5: HeadPoint): { dir: HeadPoint; dist: number } {
  const sA = vsub(p1, p2);
  const lenA = vlen(sA);
  const dirA = vnorm(sA);
  const sB = vsub(p3, p4);
  const lenB = vlen(sB);
  const dirB = vnorm(sB);
  const a = distancePointToLine(p5, p2, dirA);
  const b = distancePointToLine(p5, p4, dirB);
  const mid = vscale(vadd(p1, p2), 0.5);
  let localA = lenA * 0.5 + HEAD_SEG_OFFSET - doorDistance(mid, a.closest);
  if (localA < 0) localA = lenA * 0.5;
  let localB = lenB * 0.5 + HEAD_SEG_OFFSET - doorDistance(mid, b.closest);
  if (localB < 0) localB = lenB * 0.5;
  if (b.dist < a.dist) return { dir: dirA, dist: localA + HEAD_SEG_OFFSET };
  if (b.dist !== a.dist) return { dir: dirB, dist: localB + HEAD_SEG_OFFSET };
  return { dir: vscale(vadd(dirA, dirB), 0.5), dist: 7 };
}

// SinowberillHead_AdjustTargetForCollision_007b25c0 (.c:796875): a clear ray from `origin` to `target` keeps
// the target (null); a hit returns the hit object's position pulled back 10 along the xz direction.
export function adjustTargetForCollision(origin: HeadPoint, target: HeadPoint, ray: WallRay): HeadPoint | null {
  const hit = ray(origin, target, HEAD_WALL_MASK);
  if (!hit) return null;
  const d = vscale(vnorm(xzOf(vsub(target, origin))), HEAD_PULL_BACK);
  return { x: hit.point.x - d.x, y: hit.point.y - d.y, z: hit.point.z - d.z };
}

export interface AvoidanceTarget {
  clear: boolean; // CalculateAvoidanceTarget's return (1: the owner's ray is clear)
  toward: HeadPoint; // param_5 (set when blocked)
  beyond: HeadPoint | null; // param_6 (set when clear)
}

// SinowberillHead_CalculateAvoidanceTarget_007b23a4 (.c:796797): the avoidance point beside the wall hit. The
// side is the hit normal's perpendicular, turned to the NPC's side; the point is on the NPC's weapon at
// max(1.5 * dist, 20). It is clear when the owner's weapon has a clear ray to the closest point on that line.
export function calculateAvoidanceTarget(i: { anchor: HeadPoint; weapon: HeadPoint; ownerWeapon: HeadPoint; hit: WallHit; ray: WallRay }): AvoidanceTarget {
  const v = vnorm(xzOf(vsub(i.hit.point, i.weapon)));
  const l = Math.hypot(i.hit.point.x - i.weapon.x, i.hit.point.z - i.weapon.z);
  let perp: HeadPoint = { x: i.hit.normal.z, y: 0, z: -i.hit.normal.x };
  if (vdot(v, perp) < 0) perp = { x: -perp.x, y: 0, z: -perp.z };
  const onLine = distancePointToLine(i.anchor, i.weapon, perp).closest;
  const far = Math.max(l * HEAD_AVOID_SCALE, HEAD_AVOID_FLOOR);
  const toward: HeadPoint = { x: perp.x * far + i.weapon.x, y: i.weapon.y, z: perp.z * far + i.weapon.z };
  if (i.ray(i.ownerWeapon, onLine, HEAD_WALL_MASK) !== null) return { clear: false, toward, beyond: null };
  return {
    clear: true,
    toward,
    beyond: { x: perp.x * HEAD_AVOID_OWNER + onLine.x, y: 0, z: perp.z * HEAD_AVOID_OWNER + onLine.z },
  };
}

// The collision record of B (the probe's box, B +0xd8..0x104): the fields UpdateTargetPosition reads.
// vx / vz are B +0xe4 / +0xe8, type is +0xec, centre is +0xf4..0xfc, heading is +0x104 (bams).
export interface HeadRecord {
  vx: number;
  vz: number;
  type: number;
  centre: HeadPoint;
  heading: number;
}

// SinowberillHead_UpdateTargetPosition_007b1ad0 (.c:796511): the target beside the probe's record (the 0x20 bit).
// The simple branch (type 0, or type 1 with a short vz equal to vx) sits on the record's centre, 20 + vx out
// along the perpendicular of the owner-NPC line, turned by the anchor side; the rotated branch takes the two
// segments of the record's extents (heading + 90) and the NPC's distance to them. `counter` is head +0x8c.
export function updateTargetPosition(i: { npc: HeadPoint; anchor: HeadPoint; rec: HeadRecord; counter: number; ray: WallRay }): HeadPoint {
  const c = i.rec.centre;
  if (i.rec.type === 0 || (i.rec.vz <= HEAD_RECORD_SIMPLE && i.rec.type === 1 && i.rec.vz === i.rec.vx)) {
    const fVar3 = i.rec.vx + HEAD_TARGET_RADIUS_OFFSET;
    const l2c = vnorm({ x: i.npc.x - c.x, y: 0, z: i.npc.z - c.z });
    let l20 = vnorm({ x: l2c.z, y: 0, z: -l2c.x });
    const l14 = vnorm({ x: i.anchor.x - c.x, y: 0, z: i.anchor.z - c.z });
    if (vdot(l20, l14) < 0) l20 = { x: -l20.x, y: 0, z: -l20.z };
    l20 = vnorm(vadd(l20, l2c));
    const out = vadd(vscale(l20, fVar3), c);
    return i.counter > 10 ? vadd(vscale(l20, -fVar3), c) : out;
  }
  // The rotated branch: the record's extents at heading + 90 (matrix_rotation_y(B+0x104 + 0x4000)).
  const ang = i.rec.heading + 0x4000;
  const v = rotYBams({ x: i.rec.vx, y: 0, z: 0 }, ang);
  const w = rotYBams({ x: 0, y: 0, z: i.rec.vz }, ang);
  const p1 = vadd(c, v);
  const p2 = vsub(c, v);
  const p3 = vadd(c, w);
  const p4 = vsub(c, w);
  const toNpc = vnorm(vsub(i.npc, c));
  const seg = pointToSegmentDistance(p1, p2, p3, p4, i.npc);
  let a8 = { x: seg.dir.x, y: seg.dir.y, z: seg.dir.z };
  if (vdot(toNpc, a8) < 0) a8 = { x: -a8.x, y: a8.y, z: -a8.z };
  let out: HeadPoint = { x: a8.x * seg.dist + i.npc.x, y: a8.y * seg.dist + i.npc.y, z: a8.z * seg.dist + i.npc.z };
  const adj = adjustTargetForCollision(i.npc, out, i.ray);
  if (adj) out = adj;
  if (i.counter > 0xf) {
    let b4 = { x: a8.z, y: 0, z: a8.x };
    if (vdot(toNpc, b4) < 0) b4 = { x: -b4.x, y: 0, z: -b4.z };
    out = { x: b4.x * seg.dist + i.npc.x, y: i.npc.y, z: b4.z * seg.dist + i.npc.z };
  }
  return out;
}

// The candidate enemy as the head reads it (combat.npcEnemies): the entity id, the xz of its hit point (the
// anchor), and one box per collision box (xz centre and the flag 0x8000 of the box, formats/enemyboxes.ts).
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

// EnemyAI_AcquireClosestTargetInRange_007af2a0 (.c:794836): the candidates of one box within `range` (xz
// distance^2 from the origin to the box centre), nearest first, at most 9. The target's position is its hit
// point (ASSUMED: the exe reads +0x300 / +0x38 of the entity).
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

// The collision probe of 7af7ec's loop (B +0xa8 against the entities): an enemy (0x80) or an object with
// its record (0x20). The caller returns the first hit; null when none (not wired: see the header).
export type HeadProbeHit = { kind: 'enemy' } | { kind: 'object'; rec: HeadRecord };
export type HeadProbe = (npc: HeadPoint) => HeadProbeHit | null;

// The collision probe of B+0xa8 (SinowberillHead_UpdateState_007af7ec, .c:795114..795145). The loop runs over the
// entities after the players in array order. GetCollisionDataForEntity_007b65b4 (.c:800203) rejects an entity
// farther than sqrt(10000) in xz (HEAD_PROBE_CUTOFF_SQ) and then tests the boxes (CheckTwoHitboxCollision_007b5e40,
// .c:799546, not ported: ASSUMED a box centre within PLAYER_RADIUS of the NPC). An enemy (flag 0x20000000) sets 0x80.
// The object record (flag 0x40000000, copied to B+0xd8..0x104) has no source in the port (ASSUMED none); the box
// flag test (puVar5[6] & 0x308) is ASSUMED to pass.
export const HEAD_PROBE_CUTOFF_SQ = 10000;
export interface ProbeEnemy {
  x: number;
  z: number;
  boxes: readonly { x: number; z: number }[];
}
export function headProbeEnemies(npc: HeadPoint, enemies: readonly ProbeEnemy[], radius = PLAYER_RADIUS): HeadProbeHit | null {
  for (const e of enemies) {
    if (xzDistSq(npc, e) > HEAD_PROBE_CUTOFF_SQ) continue;
    if (e.boxes.some((b) => (npc.x - b.x) ** 2 + (npc.z - b.z) ** 2 <= radius * radius)) return { kind: 'enemy' };
  }
  return null;
}

export interface HeadUpdateInput {
  npc: HeadPoint; // the NPC's position (B +0x94 +0x38; y for the ray)
  owner: HeadPoint; // the owner's position (Q.player +0x38; the owner's weapon, ASSUMED)
  wall: WallRay;
}

// One NPC's head. The exe's record is one object per NPC; the port keeps one per slot
// (quest/town.ts). A fresh head is the zeroed record of the exe with its row copied in (configure).
export class NpcHead {
  state = HEAD_STATE_IDLE; // +0x7c
  flags = 0; // +0x80
  anchor: HeadPoint = { x: 0, y: 0, z: 0 }; // +0xdc
  moveTarget: HeadPoint = { x: 0, y: 0, z: 0 }; // +0xd0
  sendTarget: HeadPoint = { x: 0, y: 0, z: 0 }; // +0xac
  avoidTarget: HeadPoint = { x: 0, y: 0, z: 0 }; // +0xa0
  avoidDir: HeadPoint = { x: 0, y: 0, z: 0 }; // +0x94
  // The map-mode branch's mode (head +0x1c): 0 = the follow / chooser tail, 1 = field attack.
  mode = 0;
  initDone = false; // +0x28: UpdatePosition_007b3458 ran
  counter66 = 0; // +0x66: TryAttack's retarget counter (3)
  counter68 = 0; // +0x68: CheckPathAndTarget's counter (100)
  cooldown8e = 0; // +0x8e: the attack cooldown from the roll (AIUpdateState cooldown)
  wall8c = 0; // +0x8c (byte): the wall counter (CalculateTarget at 15..29, stuck at 0x1f)
  wall8d = 0; // +0x8d (byte): the counter's reset guard
  arrive90 = 0; // +0x90 (short): the arrival counter of the avoidance (AIUpdateMovement)
  action = 0; // +0x92 (short): the chooser's action (ExecuteAttack's parameter)
  itemFlag = false; // B +0x90 & 0x20: the action is an item use
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
  // B's fields the head reads and writes (reset every tick: ResetEntityHitboxes_007b34e8).
  npcNeed8c = 0; // B +0x8c (the bits 0x1, 0x2, 0x4, 0x20, 0x80)
  ownerNeed8c = 0; // Q +0x8c (bit 2: the owner has a candidate within 30)
  record: HeadRecord | null = null; // B +0xd8..0x104 (set by the probe's object hit)
  targets: PathTarget[] = []; // B's candidate triples (B +0x0 count)
  lockedPrimary = 0; // B +0x7c: the locked target id (0 = none)
  lockedSecond = 0; // B +0x84: the locked target's box
  lockedPrevious = 0; // B +0x80: the previous locked id
  moveRef: HeadPoint = { x: 0, y: 0, z: 0 }; // B +0x9c: the move origin
  prevNpc: HeadPoint | null = null; // the NPC's position at the last tick (B.player +0x44, ASSUMED)
  castTicks = 0; // the cast's busy ticks (ASSUMED: the technique's charge + cast)
  wallHit = false; // the wall ray's answer for the last movement
  npcPos: HeadPoint | null = null; // the NPC's position for TryAttack and CheckPathAndTarget
  // The head's input state (+0x24) and its timers (exe offsets in the comments). The input state is the line
  // the NPC says (DisplayChatBubble_007b2a30 reads the situation table by it). Timers are shorts in the exe.
  inputState = 0; // +0x24: 0..0x19 (see setInputState for the writers)
  t5c = 0; // +0x5c: ticks in the input state (reset by each change; the increment site is ASSUMED, see tickInput)
  t5e = 0; // +0x5e: the multi-step counter (reset by the dispatch unless the head casts)
  t62 = 0; // +0x62: the dead branch's counter (0x800 chain, capped at 0x400)
  t64 = 0; // +0x64: the idle counter of state 0 (0x1518 -> input 0xb, 0x1519 -> 0x19)
  t6a = 0; // +0x6a: the wall clamp's timer (input 7 at the clamp, wraps at 300)
  t6c = 0; // +0x6c: the owner-status counter (input 0xc, UpdateState_007af1a8)
  t6e = 0; // +0x6e: the owner-acquire timer of input 0xc (reset to 0 above 699)
  t70 = 0; // +0x70: the owner's status-2 timer (input 9)
  anim84 = 0; // +0x84: the head's anim-mode flag (ASSUMED 0: the AcquireTarget path; never written in the traced code)

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

  // ResetEntityHitboxes_007b34e8 (.c:797677): Q and B +0x8c / +0x90 are cleared every tick, then the first
  // tick's UpdatePosition_007b3458 (.c:797632) puts the move target at the owner + (0, 0, 18) and the send
  // target on the owner. The collision record goes with the bits (the probe sets it again).
  resetEntityBits(owner: HeadPoint): void {
    this.ownerNeed8c = 0;
    this.npcNeed8c = 0;
    this.record = null;
    if (!this.initDone) {
      this.initDone = true;
      this.moveTarget = { x: owner.x, y: owner.y, z: owner.z + HEAD_SPAWN_Z };
      this.sendTarget = { ...owner };
    }
  }

  // UpdateState_007b00bc on Pioneer 2 (.c:795492): the anchor is the owner's position (UpdateAttackTarget with
  // no second target), the state is 1 (move) and the flags get 0x20 with 0x1010 cleared (0xffffefef = ~0x1010).
  pioneerUpdateState(owner: HeadPoint): void {
    this.anchor = { x: owner.x, y: owner.y, z: owner.z };
    this.state = HEAD_STATE_MOVE;
    this.flags = (this.flags & ~0x1010) | HEAD_FLAG_MOVE;
  }

  // SinowberillHead_UpdateState_007af7ec (.c:795069), the parts the field reads, in the exe's order: the
  // owner-NPC distance (+0x58), the owner's bit (UpdateState_007af1a8, range 30 around the owner), the B
  // acquire (AcquireTarget, range +0x38, sets B +0x8c bit 2), the collision probe (bits 0x20 / 0x80), then the
  // moved test and the wall counter (CheckHeadDistance). The candidate list is B's triples for CheckPathAndTarget.
  headStateUpdate(i: { npc: HeadPoint; owner: HeadPoint; cands: readonly HeadCandidate[]; probe?: HeadProbe }): void {
    if (acquireClosestTargets(i.owner, HEAD_OWNER_ACQUIRE, i.cands).length > 0) this.ownerNeed8c |= HEAD_NEED_ACQUIRED;
    this.dist58 = xzDistSq(i.owner, i.npc);
    this.targets = acquireClosestTargets(i.npc, this.acquireRange, i.cands);
    if (this.targets.length > 0) this.npcNeed8c |= HEAD_NEED_ACQUIRED;
    const hit = i.probe ? i.probe(i.npc) : null;
    if (hit?.kind === 'enemy') {
      this.npcNeed8c |= HEAD_NEED_0X80;
    } else if (hit?.kind === 'object') {
      this.npcNeed8c |= HEAD_NEED_0X20;
      this.record = hit.rec;
    }
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
  }

  // The move gate (SinowberillHead_AIUpdateState_007b267c, .c:796915). True when a move is
  // needed; the send target then follows the new target. At the wall counter's clamp the move
  // is refused, the counter goes to 0x1e and flag 0x4000 is set (the input states +0x24 and the
  // +0x6a timer are ASSUMED, not modelled).
  private moveGate(): boolean {
    if (!(xzDistSq(this.sendTarget, this.moveTarget) > HEAD_MOVE_GATE_SQ)) return false;
    if (this.wall8c < 0x1f) {
      // The counter back at 0 after a clamp: input 0x18 and the 0x6a timer reset (AIUpdateState_007b267c, .c:796928).
      if (this.wall8c === 0 && (this.flags & HEAD_FLAG_WALL_CLAMP) !== 0) {
        this.t6a = 0;
        this.t5c = 0;
        this.setInputState(0x18);
        this.flags &= ~HEAD_FLAG_WALL_CLAMP;
      }
      return true;
    }
    this.wall8c = 0x1e;
    this.flags |= HEAD_FLAG_WALL_CLAMP;
    // The clamp's timer: input 7 when it is 0, then +1 (0 again at 300 and up) (.c:796941..796951).
    const s = this.t6a;
    if (s === 0) {
      this.t5c = 0;
      this.setInputState(7);
    }
    this.t6a = s + 1 < 300 ? s + 1 : 0;
    return false;
  }

  // AIUpdateMovement_007b1298 (.c:795298). Without a wall hit: the midpoint, the stuck target in the wall
  // counter's band, or UpdateTargetPosition with the 0x20 bit. With a hit: the avoidance (the anchor and
  // the direction of the avoidance target), then the arrival tests (flag 2, the arrival counter +0x90).
  private movement(i: HeadUpdateInput): void {
    const npc = i.npc;
    const anchor = this.anchor;
    const hit = i.wall(raised(npc), raised(anchor), HEAD_WALL_MASK);
    this.wallHit = hit !== null;
    if (hit === null) {
      const mid = headMidpoint(npc, anchor);
      if ((this.npcNeed8c & HEAD_NEED_0X20) === 0) {
        if ((this.npcNeed8c & HEAD_NEED_0X80) === 0) {
          if (this.wall8c < 0xf || this.wall8c > 0x1d) {
            if (this.wall8d > 0xf) this.wall8c = 0;
            this.moveTarget = mid;
          } else {
            const move = { x: npc.x - this.moveRef.x, z: npc.z - this.moveRef.z };
            this.moveTarget = headCalculateTarget(npc, anchor, move, this.wall8c);
          }
        } else {
          this.moveTarget = mid;
        }
      } else {
        const ut = this.record ? updateTargetPosition({ npc, anchor, rec: this.record, counter: this.wall8c, ray: i.wall }) : mid;
        if (this.wall8c < 0x1e) {
          this.moveTarget = ut;
        } else {
          if (this.wall8d > 0xf) this.wall8c = 0;
          this.moveTarget = mid;
        }
      }
      this.flags &= ~HEAD_FLAG_AVOID; // 0x80 & 0xfffffffe (.c:796296)
      this.arrive90 = 0;
      return;
    }
    const av = calculateAvoidanceTarget({ anchor, weapon: npc, ownerWeapon: i.owner, hit, ray: i.wall });
    const f = this.flags;
    if ((f & HEAD_FLAG_AVOID) === 0) {
      let a0: HeadPoint;
      if (!av.clear) {
        const toward = { x: av.toward.x, y: anchor.y, z: av.toward.z };
        a0 = adjustTargetForCollision(anchor, toward, i.wall) ?? toward;
      } else {
        a0 = av.beyond ?? av.toward;
      }
      this.avoidTarget = { ...a0 };
      this.avoidDir = vnorm({ x: anchor.x - a0.x, y: 0, z: anchor.z - a0.z });
      this.flags |= HEAD_FLAG_AVOID;
    }
    if (!av.clear) {
      if ((f & HEAD_FLAG_ARRIVE) !== 0) {
        const old = { x: this.moveTarget.x - npc.x, z: this.moveTarget.z - npc.z };
        if (Math.hypot(old.x, old.z) <= HEAD_ARRIVE_BLOCKED) {
          const adj = adjustTargetForCollision(npc, av.toward, i.wall);
          this.moveTarget = adj ?? { ...av.toward };
          this.flags &= ~HEAD_FLAG_ARRIVE;
          this.arrive90 = this.arrive90 + 1 < 100 ? this.arrive90 + 1 : 100;
        } else {
          this.arrive90 = this.arrive90 + 1 < 100 ? this.arrive90 + 1 : 100;
        }
        return;
      }
      this.arrive90 = 0;
      const old = { x: this.moveTarget.x - npc.x, z: this.moveTarget.z - npc.z };
      this.moveTarget = { ...this.avoidTarget };
      if (Math.hypot(old.x, old.z) < HEAD_ARRIVE_STEP) {
        this.moveTarget = {
          x: this.avoidDir.x * HEAD_AVOID_STEP + this.avoidTarget.x,
          y: this.avoidDir.y * HEAD_AVOID_STEP + this.avoidTarget.y,
          z: this.avoidDir.z * HEAD_AVOID_STEP + this.avoidTarget.z,
        };
        this.arrive90 = 0;
        this.flags = (this.flags & ~HEAD_FLAG_AVOID) | HEAD_FLAG_ARRIVE;
      }
      return;
    }
    // The clear branch (iVar4 != 0): the owner's ray is clear; the beyond point is the target.
    this.arrive90 = 0;
    const beyond = av.beyond ?? av.toward;
    if ((f & HEAD_FLAG_ARRIVE) === 0) {
      this.moveTarget = { ...beyond };
      return;
    }
    const d = { x: this.moveTarget.x - npc.x, z: this.moveTarget.z - npc.z };
    if (Math.hypot(d.x, d.z) <= HEAD_ARRIVE_CLEAR) {
      this.moveTarget = { ...beyond };
      this.flags &= ~HEAD_FLAG_ARRIVE;
    }
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
    this.movement(i);
    // AIUpdateState_007b267c (.c:796915): a move is needed when the send target is more than 10 away.
    if (this.moveGate()) {
      this.sendTarget = { ...this.moveTarget };
      if (this.state !== HEAD_STATE_CAST) this.setMove();
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

  // SinowberillHead_CheckPathAndTarget_007b086c (.c:795775). The count of B's candidates decides
  // the flag 0x2000 and the counter +0x68. The first candidate with a clear ray from the NPC's weapon
  // (mask 0x2100, to the candidate at the NPC's height) becomes the locked one: B +0x7c / +0x84 take its
  // id and box (+0x80 the previous id), the anchor is the first candidate's position at the NPC's height,
  // and flag 0x1000 is set when (path + 10)^2 > the anchor's distance^2. With none clear, flag 0x40.
  checkPathAndTarget(t: { npc: HeadPoint; npcWeapon: HeadPoint; ray: WallRay; npcStatus8?: boolean }): boolean {
    const count = this.targets.length;
    if (count < 3) {
      this.flags &= ~HEAD_FLAG_TOO_CLOSE;
    } else {
      this.flags |= HEAD_FLAG_TOO_CLOSE;
      if (this.counter68 + 1 < 100) {
        this.counter68++;
      } else {
        this.counter68 = 0;
        // The NPC's status 8 (B +0x90 & 8) chooses input 1, else 0 (.c:795801..795812).
        this.t5c = 0;
        this.setInputState(t.npcStatus8 ? 1 : 0);
      }
    }
    if (count === 0) return false; // the exe's whole block (loop, 0x40) sits under B's count != 0 (.c:795806)
    for (const e of this.targets) {
      if (!e.pos) continue;
      const to = { x: e.pos.x, y: t.npcWeapon.y, z: e.pos.z };
      if (t.ray(t.npcWeapon, to, HEAD_WALL_MASK) !== null) continue;
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
    // No clear ray: input 8 (the attack wind-up) and flag 0x40 (.c:795856..795861).
    this.t5c = 0;
    this.setInputState(8);
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
        const path = this.checkPathAndTarget({ npc: ctx.npc, npcWeapon: ctx.npcWeapon, ray: ctx.ray, npcStatus8: ctx.npcStatus8 });
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
      this.attackInput();
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
        this.attackInput();
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
    this.t6c = 0; // the chooser(1) branch clears the owner counter (.c:795564)
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
      this.attackInput();
      this.toAttack(ctx.npc);
      this.flags &= ~0x1000;
    }
  }

  // The state-8 switch of the field (.c:795580 / .c:795700): the anchor is the NPC's own weapon position.
  private toAttack(npc: HeadPoint): void {
    this.state = HEAD_STATE_ATTACK;
    this.anchor = { ...npc };
  }

  // State 1 with the move flags (0xffffefef = ~0x1010 | 0x20).
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
      this.t5e = 0;
      this.flags &= ~HEAD_FLAG_TARGET_HIT;
    }
    if (this.state !== HEAD_STATE_IDLE) this.t64 = 0; // .c:797053
    if (this.state !== HEAD_STATE_MOVE) this.flags &= ~HEAD_FLAG_RUN;
    if (this.state === HEAD_STATE_IDLE) {
      this.sendTarget = { ...this.anchor };
      this.moveTarget = { ...this.anchor };
    }
  }

  // --- the input state (+0x24) and its timers ---------------------------------------------

  // The writes of +0x24 in the exe are `if (+0x24 != X) { +0x24 = X; flags |= 4 }`, with +0x5c = 0 before them
  // in most sites (the callers do that). Flag 4 asks the next 2764 for the chat line (DisplayChatBubble_007b2a30).
  setInputState(s: number): void {
    if (this.inputState !== s) {
      this.inputState = s;
      this.flags |= HEAD_FLAG_BUBBLE;
    }
  }

  // ASSUMED: the +0x5c increment is not traced; it counts one per head tick here, so the 399-tick idle test of
  // DisplayChatBubble has its meaning. It only changes the silent input state 0x19 (no line).
  tickInput(): void {
    this.t5c = (this.t5c + 1) & 0xffff;
  }

  // HandlePlayerTechCastState_007b2bc0 (.c:797215): the cast's input state is set before the eligibility test:
  // Resta / Anti 0x16, the Foie family (0 / 3 / 6) 0x17, others 2; +0x5c is cleared.
  castInput(tech: number): void {
    this.t5c = 0;
    this.setInputState(headCastInputState(tech));
  }

  // ExecuteAttack's 0x200 branch (.c:797161): after Resta (param 0) an attack is chosen, the input is 0x13.
  attackInput(): void {
    this.t5c = 0;
    this.setInputState(0x13);
  }

  // DisplayChatBubble_007b2a30 (.c:797110), the first step of the 2764 dispatch when flag 4 is set (it runs before
  // the standing gate). Input states above 0x18 go to 0x19 silently. Otherwise the line of the input state is the
  // NPC's (`line(state)`, the situation table; the per-player slot messages have no traced writer: ASSUMED none).
  // Flag 4 is cleared, and the 399-tick idle test sends the input to 0x19. Returns the line to show, or null.
  bubbleStep(line: (state: number) => string | null): string | null {
    if ((this.flags & HEAD_FLAG_BUBBLE) === 0) return null;
    if (this.inputState > 0x18) {
      this.inputState = 0x19;
      this.flags &= ~HEAD_FLAG_BUBBLE;
      return null;
    }
    const text = line(this.inputState);
    this.flags &= ~HEAD_FLAG_BUBBLE;
    if (this.t5c > 399) {
      this.inputState = 0x19;
      this.t5c = 0;
    }
    return text !== null && text !== '' ? text : null;
  }

  // The state-0 block of the 2764 (.c:796983..797002): the idle counter +0x64 counts to 0x1518 (input 0xb, with
  // +0x5c cleared), then 0x1519 (input 0x19, flag 4 cleared, the counter restarts at 0).
  idleStep(): void {
    let s = this.t64 + 1;
    if (s === 0x1519) {
      this.t64 = 0x1519;
      this.inputState = 0x19;
      this.flags &= ~HEAD_FLAG_BUBBLE;
      s = 0;
    }
    if (s < 0x1518) {
      this.t64 = s;
    } else {
      this.t64 = 0x1518;
      this.t5c = 0;
      this.setInputState(0xb);
    }
  }

  // The 0x800 branch of the chain (SinowberillChallengePlayer_Update_007aefd4, .c:794719..794746): the NPC is dead
  // (its character flag 0x800). +0x62 counts; input 4 while it is under 0x400 with +0x84 clear, input 5 at the cap.
  // The head is idle and its anchor is the NPC's weapon (B +0x94 +0x300). The normal movement is skipped.
  deadStep(npcWeapon: HeadPoint): void {
    let s = this.t62;
    if (s < 0x400) {
      if (s >= 0 && this.anim84 === 0) {
        this.t5c = 0;
        this.setInputState(4);
      }
    } else {
      s = 0x400;
      this.t62 = 0x400;
      this.t5c = 0;
      this.setInputState(5);
    }
    this.state = HEAD_STATE_IDLE;
    this.t62 = s + 1;
    this.flags &= ~0x1030; // 0xffffefcf: clears 0x1000, 0x20 and 0x10
    this.anchor = { ...npcWeapon };
  }

  // The owner's part of SinowberillChallengePlayer_UpdateState_007af1a8 (.c:794785): the owner's status bit 2 runs
  // the +0x70 timer (input 9); with the owner's acquire (`ownerAcquired`, range 30), the owner's status bit 8 runs
  // the +0x6e timer (input 0xc) and counts +0x6c. `ownerF90` is the owner's status word (headStatusFlags).
  ownerStep(ownerF90: number, ownerAcquired: boolean): void {
    if ((ownerF90 & 0x2) === 0) {
      this.t70 = 0;
    } else {
      const s = this.t70;
      if (s === 0) {
        this.t5c = 0;
        this.setInputState(9);
      }
      this.t70 = s + 1;
    }
    if (!ownerAcquired) return;
    if ((ownerF90 & 0x8) === 0) {
      this.t6e = 0;
      return;
    }
    const s = this.t6e;
    if (s === 0) {
      this.t5c = 0;
      this.setInputState(0xc);
    }
    this.t6c = (this.t6c + 1) & 0xffff;
    if (s > 699) this.t6e = 0;
  }

  // The owner's and the NPC's need bits that the chooser reads (the NPC's bit 2 is the target flag).
  get acquired(): boolean {
    return (this.npcNeed8c & HEAD_NEED_ACQUIRED) !== 0;
  }
}

// The chain's gate (SinowberillChallengePlayer_Update_007aefd4, .c:794696..794747). The character flag
// dead (0x800, enum character_flags) of the OWNER stops the chain and the 2764 dispatch (.c:794710). The
// NPC's own dead flag (.c:794711) runs the 0x800 branch (`NpcHead.deadStep`) instead of the normal updates.
// The 2764 dispatch runs after either branch (the call at .c:794746 is outside the if / else).
export const CHARACTER_FLAG_DEAD = 0x800;
export type HeadChainBranch = 'owner-dead' | 'npc-dead' | 'live';
export function headChainBranch(ownerFlags: number, npcFlags: number): HeadChainBranch {
  if ((ownerFlags & CHARACTER_FLAG_DEAD) !== 0) return 'owner-dead';
  if ((npcFlags & CHARACTER_FLAG_DEAD) !== 0) return 'npc-dead';
  return 'live';
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
// cast (the end of these states) is not traced: quest/npcai.ts keeps the port's charge + cast ticks as the busy time (ASSUMED).
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

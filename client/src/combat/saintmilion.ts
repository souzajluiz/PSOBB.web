// Saint-Milion / Shambertin / Kondrieu: the 16 tentacle entities the boss
// creates (Ephinea PsoBB.exe; the dump calls the class SaintEmilionEntity).
// The boss's own fight is not ported (there is no Saint-Milion brain in this
// tree); this module holds what the entities themselves do, read from the
// exe, so the fight can drive them: their layout, action table, animation
// table, procedural pose and placement.
//
// Layout (SaintEmilionEntityFactory_CreateEntity 0x0076f34c, constructor
// 0x0076df6c / 0x0076dfec): the boss creates 16 of them in the global slots
// 0x00a9b140 + 4 * i. Slot i belongs to group i >> 2 (four groups); slot
// i & 3 == 0 is the group's lead (sub-id 0, +0x3b4), the other three are its
// followers (sub-id 1). A lead starts in action 0, a follower in action 10.
// Both start hidden (flag 0x20, below) and wait for the boss: the boss moves
// them with RandomizeSaintEmilionPartEntityStates 0x0076f38c (the four leads)
// and SaintEmilionPart_UpdateBatchEntityPositions 0x0076f420 (the followers),
// and wakes them through the global state word 0x009f76f0 (SetStateBit
// 0x0076f578: bit 0x80 << n).
//
// ASSUMED: which of the 3 models an entity draws (+0x370 comes from the
// parent's set entry through vtable +0x14c 0x004adce0, which the dump does
// not carry); formats/enemymodels.ts uses the boss variant (param6 & 1).

export const SPINNER_COUNT = 16;
export const SPINNER_GROUPS = 4;

export const spinnerGroup = (slot: number): number => slot >> 2;
export const spinnerIsLead = (slot: number): boolean => (slot & 3) === 0;
export const spinnerSubId = (slot: number): 0 | 1 => ((slot & 3) !== 0 ? 1 : 0);
export const spinnerFirstAction = (slot: number): number => (spinnerIsLead(slot) ? 0 : 10);

// +0x3c0 flags of an action (the table's last column, applied by
// SaintEmilionEntity_SetInitialState 0x0076ef70 on entering an action).
export const SPINNER_FLAG = {
  nextRequested: 0x2, // ChangeAction(next) on the next update
  nextOnAnimationEnd: 0x4, // with the animation's end flag (+0xb0 & 0x10): set nextRequested
  noMovement: 0x8, // movement_disabled is cleared when set, set when clear
  noReticle: 0x10, // the lock-on reticle is not enabled
  hidden: 0x20, // no minimap icon, no animation, not drawn
  chunkLoaded: 0x40, // the reverse animation runs by hand
  randomHeading: 0x80, // the heading is picked at random (65536 * rand)
  zRise: 0x100, // +0x3c8 grows (see SPINNER_Z)
  zSink: 0x200,
  xGrow: 0x400, // +0x3cc grows at SPINNER_X.grow
  xShrink: 0x800,
  clearRates: 0x1000, // after the flags are applied, 0xf00 (the rate bits) is cleared again
} as const;

// One row of g_SaintEmilionEntityActionTable (0x009f78e0, 7 dwords): the
// handler (called with 4 on entering, 0 each update, 5 on leaving; their
// bodies are not decoded here), the action entered when this one ends
// (ChangeAction, 0x0076ded8), the event mask (+0x3c4: the action ends when
// it intersects the global word 0x009f76f0), the animation id (-1: keep) and
// the flags above. Entering an action clears all flags but 0x40 and 0xf00
// (0xffffef40) before it ORs its own in.
export interface SpinnerAction {
  handler: number;
  next: number;
  mask: number;
  anim: number;
  flags: number;
}

const A = (handler: number, next: number, mask: number, anim: number, flags: number): SpinnerAction => ({ handler, next, mask, anim, flags });
export const SPINNER_ACTIONS: readonly SpinnerAction[] = [
  A(0x76d238, 1, 0x0, -1, 0x1038),
  A(0x76d24c, 2, 0x0, 0, 0x1095),
  A(0x76d320, 9, 0x20, 3, 0x400),
  A(0x76d3dc, 4, 0x0, 5, 0x1005),
  A(0x76d2d0, 5, 0x0, 1, 0x1015),
  A(0x76d6d0, 6, 0x0, 0, 0x1015),
  A(0x76d24c, 2, 0x0, 0, 0x1015),
  A(0x76d420, 4, 0x0, 6, 0x5),
  A(0x76d2bc, 7, 0x0, 4, 0x5),
  A(0x76d2d0, 0, 0x0, 2, 0x101d),
  A(0x76d238, 11, 0x10, -1, 0x1038),
  A(0x76d24c, 12, 0x0, 0, 0x1095),
  A(0x76d494, 15, 0x20, 7, 0x1000),
  A(0x76d56c, 15, 0x0, 8, 0x1),
  A(0x76d2bc, 12, 0x0, 4, 0x5),
  A(0x76d2d0, 10, 0x0, 1, 0x101d),
  A(0x76d2d0, 10, 0x0, 2, 0x101d),
];

// 0x009f7820, 16 bytes a row: the motion entry of the tentacle archive
// (get_njm_chunk), the speed (negative: played backwards by hand from the
// last frame, SaintEmilionEntity_UpdateAnimationChunk 0x0076dd34) and the
// motion mode (0xffff0003 / 0xffff0001: hold / loop).
export interface SpinnerAnimation {
  motion: number;
  speed: number;
  loop: boolean;
}

export const SPINNER_ANIMATIONS: readonly SpinnerAnimation[] = [
  { motion: 1, speed: 1, loop: false },
  { motion: 1, speed: -1, loop: false },
  { motion: 4, speed: 1, loop: false },
  { motion: 6, speed: 1, loop: true },
  { motion: 3, speed: 1, loop: false },
  { motion: 5, speed: 1, loop: false },
  { motion: 5, speed: 1, loop: false },
  { motion: 2, speed: 1, loop: true },
  { motion: 0, speed: 1, loop: false },
  { motion: 0, speed: Math.fround(-0.01), loop: true },
];

// The motions of bm_ene_boss09_tentacle.bml key only the first 32 of the
// model's 59 nodes (motion 0 keys all 59); the rest stay in their bind pose
// except for the procedural pose below.
export const SPINNER_MOTION_NODES = 32;

// The procedural pose (SaintEmilionUpdateGlobalState 0x0076d138, called for
// each node in draw order by EnemyEntity_Render 0x0076d738 through
// SaintemilionentityUpdaterenderstate 0x0076d898): +0x3c8 (z) moves nodes 3
// and 8 along their local x axis, +0x3cc (x) scales nodes 46, 49, 52 and 55.
// z is clamped to 0..50 (0x00977b60 / 0x00977b94) and moves by the
// per-frame rates in 0x00a9b0e0 / e4 / e8 (filled in by the boss; the rise
// flag 0x100 uses e8, the sink flag 0x200 -e4, otherwise -e0); x is clamped
// to 0..1 and moves by +0.1 (flag 0x400), -1/180 (0x800 alone) or -0.1.
export const SPINNER_Z = { min: 0, max: 50, moveNodes: [3, 8] } as const;
export const SPINNER_X = { min: 0, max: 1, grow: Math.fround(0.1), shrink: Math.fround(-0.1), shrinkSlow: Math.fround(-1 / 180), scaleNodes: [46, 49, 52, 55] } as const;

// Scale of the four scaled nodes for an x of t (0x0076d8ec): x and z
// 1 - 0.9 t, y 1 - 0.1 t.
export function spinnerScale(t: number): [number, number, number] {
  const side = Math.fround(Math.fround(-0.9) * t + 1);
  return [side, Math.fround(1 + Math.fround(-0.1) * t), side];
}

// The x step of a frame for the flags (SaintEmilionEntity_UpdatePosition
// 0x0076de78) and the clamp.
export function spinnerStepX(flags: number, x: number): number {
  const step = flags & SPINNER_FLAG.xGrow ? SPINNER_X.grow : flags & SPINNER_FLAG.xShrink ? SPINNER_X.shrinkSlow : SPINNER_X.shrink;
  const v = Math.fround(step + x);
  return v >= SPINNER_X.min && v < SPINNER_X.max ? v : v < SPINNER_X.min ? SPINNER_X.min : SPINNER_X.max;
}

// A lead's random spot (SaintEmilionPart_RandomizePositionAndState
// 0x0076e48c): the angle (slot * 0x1000 + param) & 0xffff, a distance of
// 100 + rand16 * 0.0030517578125 (100..300), turned about the arena origin;
// a spot with x < 0 is stretched by 1.5. The exe repeats with a new random
// number until the ground exists there (the caller checks). Returns x, z and
// the angle in BAMS.
export function spinnerLeadSpot(slot: number, param: number, rand16: number): { x: number; z: number; angle: number } {
  const angle = (slot * 0x1000 + param) & 0xffff;
  const dist = Math.fround(Math.fround(rand16) * Math.fround(0.0030517578125) + 100);
  const a = (angle / 0x10000) * Math.PI * 2;
  let x = dist * Math.sin(a);
  const z = dist * Math.cos(a);
  if (x < 0) x *= 1.5;
  return { x, z, angle };
}

// A follower's spot (SaintEmilionPart_UpdateSingleEntityPosition 0x0076e5e8):
// 50 from `center`, at the angle ((slot & 3) * 0x5555 + param) & 0xffff. It
// is taken when the ground exists there, no wall lies between the center and
// it, and it is at least 30 (900 squared, 0x00977a84) from `avoid`; then the
// entity's +0x3d4 is 3 and its action 11.
export const SPINNER_FOLLOWER = { radius: 50, step: 0x5555, minDistSq: 900 } as const;

export function spinnerFollowerSpot(slot: number, center: { x: number; z: number }, param: number): { x: number; z: number } {
  const angle = ((slot & 3) * SPINNER_FOLLOWER.step + param) & 0xffff;
  const a = (angle / 0x10000) * Math.PI * 2;
  return { x: center.x + SPINNER_FOLLOWER.radius * Math.sin(a), z: center.z + SPINNER_FOLLOWER.radius * Math.cos(a) };
}

export function spinnerFarEnough(spot: { x: number; z: number }, avoid: { x: number; z: number } | null): boolean {
  return !avoid || (spot.x - avoid.x) ** 2 + (spot.z - avoid.z) ** 2 >= SPINNER_FOLLOWER.minDistSq;
}

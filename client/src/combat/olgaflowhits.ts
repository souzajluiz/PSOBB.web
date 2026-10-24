// Olga Flow form 1's hit tests (the beast's attack frames; map docs/bosses/olgaflow-map.md, section 14).
// Pure geometry and damage values; render/combat.ts places the sword in the model and applies the hit
// (the same path as the other enemy techs: enemyTechHitsPlayer, the group-0 formula).
//
// Exe (PsoBB.exe, Ghidra dump reverse/refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c):
//   CheckForSwordWaveHittingPlayers_00494f58 (0x00494f58), called every tick by the frame fns
//   Olga1HandleSwordWaveAttack_00498634 (states 5..7) and Olga1HandleSwordWaveMoveAttack_00498674
//   (states 8..10). Each live player on the Olga map (can_olga_hit_player) is tested against the
//   sword's segment on the XZ plane. The distance is to the infinite line through the sword's other
//   point with the direction (tip - other) (FUN_0083a0dc, the dump's GetDistancePointToLineSegment);
//   a hit needs distance <= 15 (0x00902b04) and the closest point between the two points
//   (dot <= 0, 0x00902b14 = 0). The damage is entity_hit_by_tech with group 0 (fixed_damage_maybe = 0)
//   and power = randomly_adjust_value_by_fraction(+0x484, 0.1), where +0x484 is the beast's
//   animation speed BattleParam fparam1 (InitializeOlga1AnimationSpeeds_00497bc8, the row 43, or 20).
//   The window: the wave's chunk (g_Olga1SwordWaveChunkId = 46) and the anim time in [12.5, 22]
//   (0x0090262c, 0x00902628). Every hit is applied on the tick it is found (no per-attack latch in the exe).
//
// ASSUMED (see the constants below): the sword's two points (the exe's unk_0x5e0 and position_of_sword,
// written outside the frame fns, not bound) are the model's bone world positions; the anim time is the
// tick count since the state entered; the chunk test is satisfied inside the wave rows.

import { BAMS_TO_RAD } from './enemyai.ts';

export const OLGA_AREA = 0x1f;

export const OLGA_SWORD_WAVE = {
  // The wave's njm chunk and its anim window (exe 0x009a6e9c = 46, 0x0090262c = 12.5, 0x00902628 = 22).
  chunk: 46,
  animStart: 12.5,
  animEnd: 22,
  // The hit radius on the XZ plane (exe 0x00902b04 = 15.0) and the dot threshold (0x00902b14 = 0.0).
  radius: 15,
  dotThreshold: 0,
  // The bone table of the wave effect (exe 0x00902678: 4, 3, 7, 5 read as u32; the effect loop walks it
  // from the first entry). ASSUMED: the sword tip is the first entry's bone, and the model's node index
  // is the exe's bone index.
  swordBone: 4,
  // The beast's animation speed fallback when fparam1 is not positive (exe InitializeOlga1AnimationSpeeds: 0x14).
  fallbackPower: 20,
} as const;

export interface XZ {
  x: number;
  z: number;
}

// FUN_0083a0dc on the XZ plane: the closest point on the infinite line through `a` with direction
// (`tip` - `a`) to the point `p`, and the distance to it. A zero direction (the two points coincide)
// leaves the closest point at `a` (the exe divides by zero there; ASSUMED the guard).
export function closestOnSwordLine(p: XZ, a: XZ, tip: XZ): { x: number; z: number; dist: number } {
  const dx = tip.x - a.x;
  const dz = tip.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2 : 0;
  const x = a.x + dx * t;
  const z = a.z + dz * t;
  return { x, z, dist: Math.hypot(p.x - x, p.z - z) };
}

// The sword's hit on a player at `p` (CheckForSwordWaveHittingPlayers_00494f58's inner test): the
// distance to the sword's line within the radius, and the closest point lies between `a` and `tip`
// (the dot of (a - c) and (tip - c) is at most the threshold). ASSUMED: the exe's dot is taken on the
// XZ plane (the dump's 2D vector copy of the Y component is not reproduced literally).
export function swordWaveTouches(p: XZ, a: XZ, tip: XZ): boolean {
  const c = closestOnSwordLine(p, a, tip);
  if (c.dist > OLGA_SWORD_WAVE.radius) return false;
  const dot = (a.x - c.x) * (tip.x - c.x) + (a.z - c.z) * (tip.z - c.z);
  return dot <= OLGA_SWORD_WAVE.dotThreshold;
}

// The exe's randomly_adjust_value_by_fraction (dump line 210422): rnd in [0, 1) stands for
// _rand() / 32768; the value moves by sin(BAMS of rnd * 65535) * fraction * value and is at least 1.
// ASSUMED: int_sin's table is the sine of the BAMS angle.
export function randomlyAdjust(value: number, fraction: number, rnd: number): number {
  const angle = Math.round(Math.floor(rnd * 32768) / 32768 * 65535);
  const s = Math.sin(angle * BAMS_TO_RAD);
  const v = Math.round(value + s * fraction * value);
  return v < 1 ? 1 : v;
}

// The beast's animation speed value (+0x484 or the tail's +0x488): the BattleParam fparam (a float,
// rounded) when it is positive, else the exe's 20.
export function olgaBattlePower(fparam: number): number {
  const r = Math.round(fparam);
  return r > 0 ? r : OLGA_SWORD_WAVE.fallbackPower;
}

// The sword trail: the exe keeps the sword's other point across ticks (unk_0x5e0); this keeps the
// previous tip so the line runs from the last tick's tip to this one. ASSUMED wiring (the exe's writer
// is not bound): the line's `a` is the previous tip.
export class OlgaSwordTrail {
  private prev: XZ | null = null;

  // Returns the (a, tip) pair for this tick; the first tick of a swing starts from the tip itself.
  step(tip: XZ): { a: XZ; tip: XZ } {
    const a = this.prev ?? tip;
    this.prev = { x: tip.x, z: tip.z };
    return { a, tip };
  }

  reset(): void {
    this.prev = null;
  }
}

// --- Pass 5: the sword stab (rows 11..20) -------------------------------------------------------------
//
// Exe (dump Psobb.exe-05112026.c): the frame fn Olga1HandleSwordStabAttack_004986c8 (line 217265) calls
// CheckOlga1SwordStab_00495508 every tick (215080). That spawns a stab OBJECT at the sword's ground point
// (create_olga_sword_stab_objects, 212446; vtable g_Olga1SwordStabVtable; fields: +0x1c = the beast, +0x20 =
// position, +0x2c = range, +0x30 = the tick counter, +0x34 = the power). The object's update is
// olga1_sword_stab_update_(212391, bound to the vtable by name: ASSUMED, the Ghidra provider did not launch):
// every tick, each player on the Olga map (can_olga_hit_player) within `range` on the XZ plane (Y zeroed) takes
// entity_hit_by_tech (group 0, fixed_damage_maybe, power = randomly_adjust(+0x34, 0.1) at each hit). The counter
// is incremented and the object is destroyed when it passes 7 (8 updates in all). No latch: every update hits.
//
// NOT the stab's damage: UpdateVoloptForm7State (line 195333) only moves an anim index (+0x20 == 1 -> +0x1c = 2)
// and the hit-position object's state 1 (UpdateOlgaHitPositionObjectState_00491980) is a different object.
//
// The spawn (CheckOlga1SwordStab, 215080): the sword tip (+0x5ec) and the sword's other point (+0x5e0) must
// cross the Y plane g_OlgaSwordStabYPlane with both |y| <= g_OlgaSwordStabYAxisThreshold; the ground point is
// a + (tip - a) * t with t = -a.y / (tip.y - a.y) when tip.y - a.y > g_OlgaSwordStabEpsilon, else t = 1, at y = 0.
// The formula is PROVEN. The constants are read from the exe (the loads in 0x00495508..0x00495684):
// g_OlgaSwordStabYPlane 0x00902af0 = 0.0, g_OlgaSwordStabYAxisThreshold 0x00902aec = 150.0,
// g_OlgaSwordStabEpsilon 0x00902ae8 = 1e-5. The range is maybe_olga1_sword_stab_ranges 0x0090264c
// {15, 20, 25, 50} indexed by g_CurrentDifficulty 0x00a9cd68 (0x00495614: an index outside 0..3 reads row 0).

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

export const OLGA_SWORD_STAB = {
  // The object lives for 8 updates (counter +0x30 0..7; destroyed when > 7). PROVEN.
  lifeTicks: 8,
  floorPlane: 0, // 0x00902af0
  axisThreshold: 150, // 0x00902aec
  epsilon: 1e-5, // 0x00902ae8
  ranges: [15, 20, 25, 50], // 0x0090264c, by difficulty
} as const;

// The stab range for a difficulty (0x00495614: outside 0..3 reads row 0).
export function olgaStabRange(difficulty: number): number {
  return OLGA_SWORD_STAB.ranges[difficulty >= 0 && difficulty < 4 ? difficulty : 0];
}

// The stab's ground point (CheckOlga1SwordStab_00495508 on the XZ plane), or null when the sword does not
// cross the stab plane or is outside the axis threshold. The gate's constants are ASSUMED (see above).
export function stabGroundPoint(a: XYZ, tip: XYZ): XZ | null {
  const P = OLGA_SWORD_STAB;
  const crosses = (tip.y < a.y && tip.y < P.floorPlane) || (a.y < tip.y && P.floorPlane < tip.y);
  if (!crosses || Math.abs(a.y) > P.axisThreshold || Math.abs(tip.y) > P.axisThreshold) return null;
  const dy = tip.y - a.y;
  const t = P.epsilon < dy ? -a.y / dy : 1;
  return { x: (tip.x - a.x) * t + a.x, z: (tip.z - a.z) * t + a.z };
}

// One stab object: created at `pos`, hits every player within its range for its life.
export class OlgaStabObject {
  age = 0;
  readonly pos: XZ;
  readonly range: number;

  constructor(pos: XZ, range: number = olgaStabRange(0)) {
    this.pos = pos;
    this.range = range;
  }

  get alive(): boolean {
    return this.age < OLGA_SWORD_STAB.lifeTicks;
  }

  // The players this update hits: the XZ distance (Y zeroed) at most the range, inclusive (`<=`, exe 212419).
  touches(p: XZ): boolean {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) <= this.range;
  }

  // One update: returns whether the object hits this tick (the caller checks the players), then ages it.
  tick(): void {
    this.age += 1;
  }
}

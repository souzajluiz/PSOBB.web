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
// (the dot of (a - c) and (tip - c) is at most the threshold). ASSUMED: the exe's dot is taken on the XZ plane.
// 2026-10-31 (asm 0x00494f58: the vectors are built at 0x004950bd..0x00495135): the first vector's Z is stack slot
// esp+0x44, which the function never writes (its X is a.x, its Y is a.z stored at esp+0x40, zeroed later), so the exe's
// dot has a stale-stack Z term. UNCLEAR, not reproducible; the port uses the intended XZ dot.
export function swordWaveTouches(p: XZ, a: XZ, tip: XZ): boolean {
  const c = closestOnSwordLine(p, a, tip);
  if (c.dist > OLGA_SWORD_WAVE.radius) return false;
  const dot = (a.x - c.x) * (tip.x - c.x) + (a.z - c.z) * (tip.z - c.z);
  return dot <= OLGA_SWORD_WAVE.dotThreshold;
}

// The exe's randomly_adjust_value_by_fraction (0x0048e9d4, dump line 210422, re-read 2026-10-31): rnd in [0, 1)
// stands for _rand() / 32768. Both int conversions run under the x87 control word with RC = 11 (`or 0xc00` at
// 0x0048e9f7 and 0x0048ea32, then `fistp`), so they TRUNCATE: the angle is trunc(_rand / 32768 * 65535) and the
// result is trunc(value + sin * fraction * value), at least 1 (0x0048ea50). The exe's constants: 32768 (0x009015a8),
// 65535 (0x009015ac). ASSUMED: int_sin (0x0082dcbc, a table) is the sine of the BAMS angle.
export function randomlyAdjust(value: number, fraction: number, rnd: number): number {
  const angle = Math.trunc((Math.floor(rnd * 32768) / 32768) * 65535);
  const s = Math.sin(angle * BAMS_TO_RAD);
  const v = Math.trunc(value + s * fraction * value);
  return v < 1 ? 1 : v;
}

// The beast's animation speed value (+0x484 .. +0x48c): the BattleParam fparam as an int, when it is positive,
// else the exe's 20. The exe's int is `fistp` under the x87 control word with RC = 11 (0x0c00 in
// InitializeOlga1AnimationSpeeds_00497bc8), which truncates toward zero: Math.trunc, not Math.round.
export function olgaBattlePower(fparam: number): number {
  const r = Math.trunc(fparam);
  return r > 0 ? r : OLGA_SWORD_WAVE.fallbackPower;
}

// The stab object's power (+0x34) is set in its constructor (olga1_sword_stab_constructor, 0x0049171c), not in
// InitializeOlga1AnimationSpeeds: the field is the truncated BattleParam value, and only an exact 0.0 (the
// compare with 0x009021e4 = 0.0 at 0x004917c8) gives the 0x14 fallback. A negative field is kept (the hit then
// clamps to 1 in randomly_adjust). PROVEN from the asm (fist RC = 11 at 0x004917c2, fcomp at 0x004917c8).
export function olgaStabPower(fparam: number): number {
  return fparam === 0 ? OLGA_SWORD_WAVE.fallbackPower : Math.trunc(fparam);
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

// 2026-10-31 (map section 18): the stab's gate needs the sword's two Y values to differ across the floor plane.
// The only decoded writers of the sword Y (+0x5e4, +0x5f0, +0x5fc) are SetOlga1SwordAttackYPosition_0049536c
// (0x0049536c, called only inside the sword wave's window, 0x00494ffd), which set all three to 10.0. No literal
// store to +0x5e0..+0x600 (X or Z either) exists in 0x00488000..0x004a2000. So with the decoded writers the gate
// (CheckOlga1SwordStab_00495508, 0x00495508..0x004955f0: `tip.y < a.y && tip.y < 0`, or the reverse) is never true,
// and the port's bone-based stab (below) is NOT the exe's proven behaviour. UNCLEAR: the writer of the sword points
// is not bound; the port keeps the bone-based gate (ASSUMED) until it is.
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

// --- Pass 6: the fire lancer (row 22; exe Olga1HandleFireLancerMoveAttack 0x0049876c, the hit
// CheckOlga1SwordWaveHit_0049592c at 0x0049592c..0x00495fdb, dump line 215247) ---------------------
//
// PROVEN from the asm (objdump 0x0049592c..0x00495fdb, and the frame 0x0049876c..0x004987ff):
// - The window: the state's timer (+0x418) starts at lead + hold + 30 (the enter 0x004994b4 writes +0x414 and
//   +0x418 = +0x4a4 + +0x4a8 + 0x1e) and counts down a frame. The hit runs on a tick whose timer is in [30, hold]
//   (`cmp timer, 0x1e; jl` and `cmp timer, +0x4a8; jg`). lead = +0x4a4 and hold = +0x4a8, the BattleParam row 43
//   iparam5 and iparam6 (0x497d5e..0x497dd7: each is the int when positive, else 90 (0x5a) and 180 (0xb4)).
// - The progress t (+0x4e4): on a hit tick t = min(t + 1/30, 1) (0x009026ac, 0x00902a90), else t = max(t - 2/15, 0)
//   (0x009026b0, 0x00902a8c). It is reset to 0 when the state ends (Olga1ResetAttackProgress, 0x00496834). The hit
//   test needs t != 0 (0x00902acc = 0.0) and the blade's length |B - A| >= 10 (0x00902670; the 3D distance,
//   0x00836208, with 0x0098a604 = 0.025 as the squared floor).
// - The blade: m = (A + B) / 2 (0x00902ac8 = 0.5), P1 = m + (A - m) t, P2 = m + (B - m) t, where A = +0x5b0 and
//   B = +0x5c8 (vec3s of the beast).
// - The quad: V0 = P1, V1 = P2, V2 = P2 + d, V3 = P1 + d, with d = (-500 sin h, 0, -500 cos h) (0x00902ac4 = -500;
//   h = the heading +0x60, BAMS, int_sin / int_cos). Only X and Z are used.
// - The test: for each edge V_i -> V_{i+1} (Y of the edge zeroed) the Y of cross(edge, player - V_i) must keep its sign
//   across the four edges (a zero is kept: the exe's sign test at 0x00495c02..0x00495c57). A player inside is hit.
// - The damage: entity_hit_by_tech(player, beast, fixed 0, randomly_adjust(+0x48c, 0.1), NULL, ~foie, -1), the same
//   call as the sword. +0x48c = BattleParam row 43 fparam4 (field 3), truncated, or 20 (the 0.1 is the immediate
//   0x3dcccccd at 0x00495c69).
//
// ASSUMED (not bound): the anchors A (+0x5b0) and B (+0x5c8). No direct writer of either lies in the Olga range of
// the asm; +0x5b0 is copied from a player field (0x9a8) in the target snapshot at 0x0049cb46 and the sub-object copy at
// 0x0049a3e9..0x0049a42e, so its meaning is UNCLEAR. render/combat.ts supplies them (the model's bones, ASSUMED).
//
// NOT PORTED: the push-out after the hit (0x00495d80..0x00495f97: the player is moved out of the blade along the
// blade's direction when its distance to the axis is under half the blade length; it needs Enemygetgroundinfo
// 0x007b4c58 and SetPlayerPositionAndStealth 0x0048dbf4, neither ported). The beast's orbit during the lancer
// (SetOlga1AttackPosition3 0x00496f74). The chunks (0x11 / 0x13) and the sounds.

export const OLGA_LANCER = {
  // The hit runs on a timer in [firstTimer, hold] (exe 0x0049876c: 0x1e and +0x4a8).
  firstTimer: 0x1e,
  // The progress t (+0x4e4): f32 steps, see above.
  progressStep: 0.03333333507180214, // 0x009026ac
  progressCap: 1, // 0x00902a90
  progressDecay: -0.13333334028720856, // 0x009026b0
  progressFloor: 0, // 0x00902a8c
  // The blade's anchors A and B, as model bones (ASSUMED: the exe's +0x5b0 / +0x5c8 have no decoded writer; the
  // sword's bone table 0x00902678 = 4, 3, 7, 5 gives the first and the last entry).
  anchorBones: [4, 5] as const,
  // The minimum blade length (0x00902670 = 10.0) and the extrusion (0x00902ac4 = -500.0) of the quad.
  minLength: 10,
  extrude: -500,
  // The power: randomly_adjust(+0x48c, 0.1) (0x3dcccccd = 0.1f).
  powerFraction: 0.1,
  // The lead (+0x4a4) and the hold (+0x4a8) when the BattleParam field is not positive (0x5a, 0xb4).
  leadDefault: 90,
  holdDefault: 180,
  // The no-hang cap of the timer (the brain's OLGA_TIMER.cap); the exe has no cap, a row this long is not reached.
  timerCap: 900,
} as const;

// The lead and the hold of the lancer from BattleParam row 43's iparam5 / iparam6 (exe +0x4a4 / +0x4a8).
export function olgaLancerLeadHold(iparam: readonly number[] | undefined): { lead: number; hold: number } {
  const lead = iparam?.[4] ?? 0;
  const hold = iparam?.[5] ?? 0;
  return {
    lead: lead > 0 ? lead : OLGA_LANCER.leadDefault,
    hold: hold > 0 ? hold : OLGA_LANCER.holdDefault,
  };
}

// The progress t after one tick of the lancer frame (exe 0x004967ec on a hit tick, 0x00496810 otherwise).
// f32 arithmetic (Math.fround) as the exe's fadd / fstp.
export function olgaLancerProgress(t: number, hitTick: boolean): number {
  const P = OLGA_LANCER;
  if (hitTick) return Math.min(Math.fround(t + P.progressStep), P.progressCap);
  return Math.max(Math.fround(t + P.progressDecay), P.progressFloor);
}

// The blade's two points on the XZ plane (CheckOlga1SwordWaveHit, the first block): m = (A + B) / 2,
// P1 = m + (A - m) t (from the middle toward A), P2 = m + (B - m) t (toward B). `t` is the progress.
export function lancerBlade(A: XYZ, B: XYZ, t: number): { p1: XZ; p2: XZ } {
  const mx = (A.x + B.x) * 0.5;
  const mz = (A.z + B.z) * 0.5;
  return {
    p1: { x: (A.x - mx) * t + mx, z: (A.z - mz) * t + mz },
    p2: { x: (B.x - mx) * t + mx, z: (B.z - mz) * t + mz },
  };
}

// The lancer's test gate: the blade's anchors are at least `minLength` apart (3D), and the progress is not 0.
export function lancerGate(A: XYZ, B: XYZ, t: number): boolean {
  if (t === 0) return false;
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const dz = B.z - A.z;
  const sq = dx * dx + dy * dy + dz * dz;
  // 0x00836208: below 0.025 squared the helper returns 0 (not the length).
  if (sq < 0.025) return false;
  return Math.sqrt(sq) >= OLGA_LANCER.minLength;
}

// The quad V0 = P1, V1 = P2, V2 = P2 + d, V3 = P1 + d with d = (-500 sin h, -500 cos h) on XZ. `heading` is in
// radians (the brain's angle, the exe's BAMS heading times BAMS_TO_RAD).
export function lancerQuad(p1: XZ, p2: XZ, heading: number): [XZ, XZ, XZ, XZ] {
  const dx = OLGA_LANCER.extrude * Math.sin(heading);
  const dz = OLGA_LANCER.extrude * Math.cos(heading);
  return [
    { x: p1.x, z: p1.z },
    { x: p2.x, z: p2.z },
    { x: p2.x + dx, z: p2.z + dz },
    { x: p1.x + dx, z: p1.z + dz },
  ];
}

// The quad test (exe 0x00495b5d..0x00495c57): the Y of cross(edge_i, p - V_i) over the four edges must not change
// sign. A zero before a non-zero is kept (prev == 0 accepts), a positive then <= 0 rejects, a negative then >= 0 rejects.
export function lancerTouches(p: XZ, quad: readonly XZ[]): boolean {
  let prev = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) & 3];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    // (edge x (p - a)).y with edge.y = 0: e.z * q.x - e.x * q.z.
    const cur = ez * (p.x - a.x) - ex * (p.z - a.z);
    if (i > 0) {
      if (prev >= 0 ? prev > 0 && cur <= 0 : cur >= 0) return false;
    }
    prev = cur;
  }
  return true;
}

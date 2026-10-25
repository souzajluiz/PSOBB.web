// Episode 4 enemy state machine, part 1: Zu / Pazuzu (set types 0x114, PsoBB.exe
// 1.25.13, addresses are VAs). This file holds the pieces of the Zu brain that are
// traced and checked so far, not the whole brain. The port has no Zu AI yet
// (no AI_PROFILES or OWN_FSM row), so the Zu on the field stays where it spawns.
// What is here is the state map, the pure arithmetic of the movement and the
// volley, and the radar icon bit, each with its address.
//
// Naming: the Ghidra dump (reverse/refsrc, Psobb.exe-05112026.c) calls these
// functions "Goran*" (its Goran family shares the code), and the Zu's own ones
// update_zu 0x005b27e8, handle_zu_ai (dispatcher), zu_fireball_state. The dump
// types the enemy as `player`; the field offsets below are the enemy's (+0x32e
// AI state, +0x37c pending state, +0x388 resume state, +0x390 entity flags,
// +0x3b0 squared distance to the player, +0x3b8 speed, +0x418 approach value,
// +0x60 heading in BAMS, +0xb8 motion index).
//
// Per frame (update_zu): the pause gate (g_UnknownShouldPauseEnemyAI) returns
// early; then the pending-state swap (+0x37c into +0x32e, the old state's exit
// runs with -1 and the new state's entry with 0), then handle_zu_ai, the animation,
// the collision, the lock-on point, the radar icon (unknown_add_minimap_icon
// 0xffffa24c, scale 1, skipped when +0x390 bit 0x40000 is set; PROVEN 0x005b28bc),
// and the hit-box flags.
//
// Dispatcher handle_zu_ai (switch on +0x32e):
//   0  wander        GoranProcessWanderState_005b44f8    (phases 0, 1, -1)
//   3  generic       EnemyAI_ProcessState3_0052c6ac      (the shared walking AI)
//   4  flinch-like   PlayerProcessGoranState_005b41a0    (phases on the sub-state counter)
//   5  death         on_zu_killed                        (the death sequence; deathfx.ts)
//   7  carry         ZuHandleCarryState_005b3e94         (phases null, 1, -1)
//   9  projectile    GoranUpdateProjectileState_005b3dd4 (phases 0, 1, -1; facing gate to 10)
//   10 fireball      zu_fireball_state                   (phases 0..3, -1)
//   11 (0xb)         GoranProcessProjectileState_005b3808 (phases 0, 1, 2)
//   12 (0xc)         GoranProcessProjectileState_005b3544 (phases 0, 1, -1)
//   13 (0xd)         GoranProcessProjectileState_005b3234 (tech projectile, phases 0..4, -1)
//   14 (0xe)         GoranProcessState_005b29e4          (not read yet)
//   1, 2, 6, 8        no case: the dispatcher does nothing (the dump's switch).
//
// Transitions write the pending state (+0x37c) and the resume state (+0x388):
// GoranTransitionToState_005b2ed4 sets the motion (+0xb8) and the speed data;
// GoranCheckAndTransitionState_005b378c picks the pending state from the distance
// class below.
export interface ZuStateInfo {
  id: number; // +0x32e value
  handler: string; // dump name
  address: number; // handler VA (0 when the dispatcher has no case)
  ported: boolean;
}
export const ZU_STATES: readonly ZuStateInfo[] = [
  { id: 0, handler: 'GoranProcessWanderState', address: 0x005b44f8, ported: false },
  { id: 1, handler: '(no case)', address: 0, ported: false },
  { id: 2, handler: '(no case)', address: 0, ported: false },
  { id: 3, handler: 'EnemyAI_ProcessState3', address: 0x0052c6ac, ported: false },
  { id: 4, handler: 'PlayerProcessGoranState', address: 0x005b41a0, ported: false },
  { id: 5, handler: 'on_zu_killed', address: 0, ported: false }, // death: combat/deathfx.ts plays it
  { id: 6, handler: '(no case)', address: 0, ported: false },
  { id: 7, handler: 'ZuHandleCarryState', address: 0x005b3e94, ported: false },
  { id: 8, handler: '(no case)', address: 0, ported: false },
  { id: 9, handler: 'GoranUpdateProjectileState', address: 0x005b3dd4, ported: false },
  { id: 10, handler: 'zu_fireball_state', address: 0, ported: false }, // VA not traced yet
  { id: 11, handler: 'GoranProcessProjectileState_3808', address: 0x005b3808, ported: false },
  { id: 12, handler: 'GoranProcessProjectileState_3544', address: 0x005b3544, ported: false },
  { id: 13, handler: 'GoranProcessProjectileState_3234', address: 0x005b3234, ported: false },
  { id: 14, handler: 'GoranProcessState_29e4', address: 0x005b29e4, ported: false },
];

// --- Movement: the distance class (GoranCheckAndTransitionState_005b378c) -----
//
// The class is 0 below the squared distance 0x0092ae08 (8100.0 = 90^2), 1 from
// there up to 0x0092ae04 (62500.0 = 250^2), 2 from there on. The class picks the
// pending state from the int table 0x0092ac88 ([9, 12, 0]) and the approach speed
// from the float table 0x0092aea4 ([10.0, 60.0, 80.0]). PROVEN: the table values
// and the constants read from PsoBB.exe with tools/exedata.py (float reads). ASSUMED:
// +0x3b0 is the squared XZ distance to the player (its writer,
// EnemyGetDistanceToPlayer_007713d4, is not traced; the 8100 / 62500 thresholds
// are squares).
export const ZU_CLASS_LIMIT_SQ = [Math.fround(8100), Math.fround(62500)] as const;
export const ZU_CLASS_STATE: readonly [number, number, number] = [9, 12, 0];
export const ZU_CLASS_SPEED: readonly [number, number, number] = [Math.fround(10), Math.fround(60), Math.fround(80)];

export function zuDistanceClass(distSq: number): 0 | 1 | 2 {
  const d = Math.fround(distSq);
  if (d < ZU_CLASS_LIMIT_SQ[0]) return 0;
  if (d < ZU_CLASS_LIMIT_SQ[1]) return 1;
  return 2;
}

// --- Movement: the approach to the class speed (GoranWaitForProjectileToReachTarget_005b36e4)
//
// f418 is the current approach value, f3b8 the target speed of the state. The
// step is 2.2 (0x0092ae10) toward the target, or -2.2 (0x0092ae14) when the
// approach is above it; within 0.5 (0x0092ae1c) of the speed it has arrived (the
// step is then not taken). An overshoot snaps to the speed. Returns the new
// approach value and whether the approach is done. PROVEN: the constants (float
// reads at 0x0092ae0c .. 0x0092ae1c) and the branch structure of the dump.
const APPROACH = { step: Math.fround(2.2), near: Math.fround(0.5), zero: 0 } as const;
export function zuApproach(f418: number, f3b8: number): { arrived: boolean; f418: number } {
  const fr = Math.fround;
  const f1 = fr(fr(f3b8) - fr(f418));
  let step = APPROACH.step;
  if (f1 <= APPROACH.near) {
    step = -APPROACH.step;
    if (f1 >= -APPROACH.near) return { arrived: true, f418: fr(f418) };
  }
  const next = fr(fr(f418) + step);
  const f2 = fr(fr(f3b8) - next);
  if (Math.abs(f2) >= APPROACH.near && fr(f2 * f1) >= APPROACH.zero) return { arrived: false, f418: next };
  return { arrived: true, f418: fr(f3b8) };
}

// --- Movement: the projectile difficulty (GoranCalculateProjectileDifficulty_005b3d90)
//
// level = floor * 10 + trunc(playerLevel / 20), clamped to 29 (0x1d), then divided
// by 3. PROVEN: objdump 0x005b3d90..0x005b3dc4 (imul 0x66666667 >> 3 is the /20,
// clamp by cmp 0x1d, imul 0x55555556 is the /3, all signed).
export function zuProjectileDifficulty(floor: number, playerLevel: number): number {
  let v = floor * 10 + Math.trunc(playerLevel / 20);
  if (v > 0x1d) v = 0x1d;
  return Math.trunc(v / 3);
}

// --- Attack: the fireball volley (GoranSpawnProjectileEffect_005b3cb0) -----------
//
// Three foie objects, at the heading +0x1000, the heading, and the heading -0x1000
// (BAMS, masked to 16 bits), and two more at +0x2000 / -0x2000 when the wide flag
// (+0x504, field 0x141) is set. The order is the order of creation.
// PROVEN: dump lines 400436..400445. ASSUMED: the flag's name (+0x504 is not
// traced to a writer).
export function zuVolleyHeadings(heading: number, wide: boolean): number[] {
  const h = heading & 0xffff;
  const out = [(h + 0x1000) & 0xffff, h, (h - 0x1000) & 0xffff];
  if (wide) out.push((h + 0x2000) & 0xffff, (h - 0x2000) & 0xffff);
  return out;
}

// --- Targeting: in range and facing (Derolle_IsTargetInRangeAndFacing_00786494) --
//
// The target (dx, dz) is the player minus the Zu in XZ. Out of range when
// range^2 < dx^2 + dz^2. The bearing is atan2(dz, dx) in BAMS:
// trunc(angle * 65536 / 6.283184051513672) (the FPU is set to truncate, 0xc00,
// before the store), and the Zu faces it when the heading is within half of the
// arc of 0x4000 - bearing (the exe's 16-bit angle difference). A target with
// character flags & 0x2000800 (the dump's test; the flag names are not traced) is
// never targeted. PROVEN: the constants 65536.0 (0x0097a1d0) and 6.283184051513672
// (0x0097a1c8, double), the 16-bit difference (integer_angle_abs_difference,
// dump 790253). ASSUMED: the double-precision division (the exe uses 80-bit).
const BAMS_PER_TURN = 6.283184051513672;
export function zuInRangeAndFacing(o: { dx: number; dz: number; heading: number; flags: number; range: number; arc: number }): boolean {
  if ((o.flags & 0x2000800) !== 0) return false;
  if (o.range * o.range < o.dx * o.dx + o.dz * o.dz) return false;
  const bearing = Math.trunc((Math.atan2(o.dz, o.dx) * 65536) / BAMS_PER_TURN);
  const want = (0x4000 - (bearing << 16 >> 16)) & 0xffff;
  let d = ((o.heading & 0xffff) - want) << 16 >> 16;
  if (d < 0) d = -d;
  return d <= Math.trunc(o.arc / 2);
}

// --- Radar: the icon bit (update_zu, PROVEN 0x005b28bc) --------------------------
//
// The radar icon of a Zu is not drawn while +0x390 has bit 0x40000. No code in
// the Zu's range sets it (the writers in the dump are other families'); the bit
// comes from the entity's flags as the factory sets them (ASSUMED, not traced).
// The port has no +0x390 flags field for an enemy, so nothing calls this yet.
export const ZU_ICON_HIDDEN_BIT = 0x40000;
export function zuRadarIconHidden(flags390: number): boolean {
  return (flags390 & ZU_ICON_HIDDEN_BIT) !== 0;
}

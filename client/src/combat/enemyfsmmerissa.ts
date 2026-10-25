// Merissa A / AA (Episode 4 desert, set types 0x112 and 0x113-era AA variant; PsoBB.exe
// 1.25.13, addresses are VAs). Part 1 of the brain: the pieces traced so far, not the whole
// brain. The port still has NO Merissa AI (no AI_PROFILES or OWN_FSM row), so the Merissa on
// the field stays where it spawns, as before. What is here is the exe's dispatch table, the
// state row layout, the +0x37c mask writes, the radar gate bit and the vanish sub-entity's
// arithmetic, each with its address.
//
// Naming: the Ghidra dump (reverse/refsrc, Psobb.exe-05112026.c) names the functions
// MerissaConstructor_005b6b24, merissa_constructor, on_merissa_dead, merissa_stab_attack,
// unknown_merissa_freeze_stab_attack and EnemyProcessSubEntitySpawn_005b6328. Many of the
// handlers in this range are shared with the Goran / Zu family (EnemyProcessState_005b5f3c,
// EnemyTransitionState_005b5768, EnemySetStateFlag_005b5de0), so the family attribution of a
// handler is ASSUMED where the exe's own table is the only proof.
//
// Field offsets are the enemy's: +0x32e AI state (short), +0x332 previous state, +0xb8 motion
// index (short), +0x37c state mask (the "state_maybe" word), +0x30 entity flags, +0x3c4
// vanish countdown (float), +0x380 variant (0 = A, 1 = AA).

// PROVEN: the vtable is 0x00b0b6a0 (written by the constructor at 0x005b6c32). Its +0 is
// 0x005b50fc (not traced), +4 is the update 0x005b66ec, +8 the lock-on render 0x005b6864
// (tools/exedata.py read 00b0b6a0 u 12; xref 0x005b6c34).
export const MERISSA_VTABLE_VA = 0x00b0b6a0;
export const MERISSA_UPDATE_VA = 0x005b66ec; // vtable +4

// PROVEN: the update indexes the state table with the short at +0x32e: the row is
// 0x009c1a24 + state * 20 (objdump 0x005b670f..0x005b6726: movswl 0x32e, leal (%eax,%eax,4),
// movl 0x9c1a24(,%edx,4), call *%eax with ecx = this). The base address is referenced only by
// the update (xref 0x005b671c); the transition reads the row words directly (0x005b5933..).
export const MERISSA_STATE_TABLE_VA = 0x009c1a24;
export const MERISSA_STATE_ROW_BYTES = 20;

// PROVEN (the transition's writes at 0x005b5933..0x005b5967 read the row fields by these
// offsets, and the ctor reads the row 0 fields at 0x009c1a2c and 0x009c1a30):
//   +0x00 handler (the update calls it; 0 = no handler)
//   +0x04 flag argument of EnemySetStateFlag_005b5de0 (0 / 1 / 2)
//   +0x08 motion index, a short written to +0xb8 (-1 = none, the update skips the motion step)
//   +0x0c state mask, OR-ed into +0x37c
//   +0x10 hook, called with ecx = this on the transition (0 = none). ASSUMED: which of the two
//         neighbouring states' hook runs (the transition to state 3 calls the row 2 hook,
//         0x009c1a5c, not row 3's); see the open list in the DEVLOG entry.
export interface MerissaStateRow {
  state: number; // +0x32e value
  handler: number; // VA of the per-state handler (0 = none)
  handlerName: string; // dump name, for the comments and tests
  flagArg: number; // +0x04
  motion: number; // +0x08 (-1 = no motion write)
  mask: number; // +0x0c
  hook: number; // +0x10 VA (0 = none)
}

// PROVEN: the table words (tools/exedata.py read 009c1a24 u 40). Row 7 is all zero. Words from
// 0x009c1ac0 on are a different 40-byte record family (the transition indexes it as
// 0x009c1ac0 + 40 * id, 0x005b59a8 / 0x005b5a64), so no row past 7 is a state. The motion
// values are PROVEN as numbers; which animation each is ASSUMED.
export const MERISSA_STATE_ROWS: readonly MerissaStateRow[] = [
  { state: 0, handler: 0x005b53dc, handlerName: 'unnamed (0x005b53dc)', flagArg: 1, motion: 0, mask: 0x4, hook: 0x005b51dc },
  { state: 1, handler: 0x005b54cc, handlerName: 'unnamed (0x005b54cc)', flagArg: 2, motion: 1, mask: 0x0, hook: 0x005b51e8 },
  { state: 2, handler: 0x005b5618, handlerName: 'EnemyUpdateState0_005b5618', flagArg: 2, motion: 2, mask: 0x0, hook: 0x005b51f8 },
  { state: 3, handler: 0x005b5f3c, handlerName: 'EnemyProcessState_005b5f3c', flagArg: 0, motion: 6, mask: 0x2, hook: 0x005b5294 },
  { state: 4, handler: 0x005b61a0, handlerName: 'EnemyProcessState_005b61a0', flagArg: 2, motion: -1, mask: 0x2, hook: 0x005b5260 },
  { state: 5, handler: 0x005b6108, handlerName: 'EnemyResetState_005b6108', flagArg: 2, motion: 7, mask: 0x2, hook: 0x005b52ec },
  { state: 6, handler: 0x005b6328, handlerName: 'EnemyProcessSubEntitySpawn_005b6328', flagArg: 0, motion: -1, mask: 0x8, hook: 0 },
  { state: 7, handler: 0, handlerName: '(no handler)', flagArg: 0, motion: 0, mask: 0, hook: 0 },
];

// PROVEN: the hook of state 5 is on_merissa_dead 0x005b52ec (the death, deathfx.ts plays its
// sounds); the state 6 handler (0x005b6328) is the vanish sub-entity below.

// The state row for a +0x32e value, or null past the table. The update calls the handler only
// when it is not 0 (PROVEN, 0x005b6722).
export function merissaStateRow(state: number): MerissaStateRow | null {
  if (!Number.isInteger(state) || state < 0 || state >= MERISSA_STATE_ROWS.length) return null;
  return MERISSA_STATE_ROWS[state];
}

// --- +0x37c mask ----------------------------------------------------------------------------
// PROVEN: the transition to state 3 (0x005b5768 tail) clears the bits 0x2, 0x4 and 0x8
// (`andl $-0xf` = 0xfffffff1 at 0x005b590e, stored at 0x005b5911), then ORs the row's mask in
// (0x005b5954 `orl %edx, 0x37c`, edx = the row 3 mask). The reset EnemyResetState_005b6108
// clears with the same 0xfffffff1 (dump line 401763). Bit 0x1 survives both.
export const MERISSA_MASK_CLEAR = 0xfffffff1;

export function merissaMaskAfterTransition(mask37c: number, rowMask: number): number {
  return (((mask37c & MERISSA_MASK_CLEAR) | rowMask) >>> 0);
}

// --- Radar gate -----------------------------------------------------------------------------
// PROVEN: the update's icon call (unknown_add_minimap_icon 0xffffa24c, scale 1, at 0x005b67d3)
// is skipped when `testb $0x8, %dl` on +0x37c is set (0x005b67c1 / 0x005b67c4 `jne 0x5b67e1`).
export const MERISSA_RADAR_HIDE_BIT = 0x8;

// True when the plain radar icon is drawn for a Merissa whose +0x37c is `mask37c`.
export function merissaRadarIconShown(mask37c: number): boolean {
  return (mask37c & MERISSA_RADAR_HIDE_BIT) === 0;
}

// Which state sets the bit: the row whose mask has 0x8 (row 6, the vanish). ASSUMED that no
// other transition path (the 0x9c1dbc distance tables, the 0x005b5b5c path) writes 0x8.
export function merissaStatesWithRadarHide(): readonly number[] {
  return MERISSA_STATE_ROWS.filter((r) => (r.mask & MERISSA_RADAR_HIDE_BIT) !== 0).map((r) => r.state);
}

// --- Vanish sub-entity (state 6, EnemyProcessSubEntitySpawn_005b6328) -----------------------
// PROVEN arithmetic: while the motion's end flag (+0xb0 bit 0x10) is set, the countdown +0x3c4
// drops by 0.1f each frame (constant 0x0092aff4 = 0.10000000149); when the result is below
// -15.0f (0x0092aff0) the entity's +0x08 bit 0x1 is set (the removal bit). The once-only green
// pool (+0x37c bit 0x40, CreateEntity_00578538 at the origin with 0x32) is ported as the deathfx
// row, not here. ASSUMED: +0x3c4 starts at 0 (the ctor's `+0x3c4 = 0`, PROVEN at 0x005b6b24's
// ctor); the removal is the same as the other families' bit 0x1 (ASSUMED meaning).
export const MERISSA_VANISH_STEP = Math.fround(0.1);
export const MERISSA_VANISH_LIMIT = -15;

export function merissaVanishStep(countdown: number): { countdown: number; removed: boolean } {
  const next = Math.fround(Math.fround(countdown) - MERISSA_VANISH_STEP);
  return { countdown: next, removed: next < MERISSA_VANISH_LIMIT };
}

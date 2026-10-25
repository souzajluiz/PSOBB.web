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

// --- Attack records (part 2) ----------------------------------------------------------------
// PROVEN layout: the 40-byte records at 0x009c1ac0 + 40 * id, read by the transition
// 0x005b5768 (`leal 0x9c1ac0(%edi,%edi)` after the id * 20 steps at 0x005b59a8 / 0x005b5a64 /
// 0x005b5ae1). Their float words are NOT in the file: the initializer 0x005b6f2c writes them at
// run time (movl $imm at 0x005b6f4a..0x005b70a8; objdump, the values below are the immediates
// converted from their IEEE bit patterns). Fields the initializer does not write (+0x4 angle,
// +0xc kind, +0x10 scale, +0x24 callback) are the file's own words (tools/exedata.py read).
//   +0x00 float: squared XZ range; the transition enters the attack when dist^2 < this
//         (fcomps at 0x005b59af, jae skip). The initializer's globals: 0x00a749f4 = 1600 (40),
//         0x00a74a04 = 3600 (60), 0x00a74a08 = 10000 (100).
//   +0x04 int: angle limit in BAMS (65536 = 360 degrees); the entry needs the angle below it
//         (cmpl at 0x005b59ba). 1820 = 10 degrees, 8192 = 45, 10922 = 60. ASSUMED that the value
//         the angle is compared with is the angle between the enemy and the target (the
//         0x007a9018 call's result, not traced).
//   +0x0c int: the kind (3, 4 or 5 in these rows); ASSUMED to be the sound / effect index.
//   +0x10 float: 1.0 for 0..5, 1.5 for the freeze record 6 (file words).
//   +0x14 float: start time (10.0): the handler's window begins at this elapsed time.
//   +0x18 / +0x1c floats: window start and end (the handler 0x005b61a0 tests elapsed against
//         them, equal values mean a single frame).
//   +0x24 int: the window callback VA, called with ecx = this (0x005b61a0 at 0x005b6219..).
export interface MerissaAttackRecord {
  id: number;
  rangeSq: number;
  angle: number;
  kind: number;
  scale: number;
  start: number;
  windowStart: number;
  windowEnd: number;
  callback: number;
  callbackName: string;
}

export const MERISSA_ATTACK_RECORD_BASE = 0x009c1ac0;
export const MERISSA_ATTACK_RECORD_BYTES = 40;

// Records 0 and 1 (the A stab of variants A and AA), 2 and 3 (B), 4 and 5 (C), 6 (the freeze stab).
// The callback names are ASSUMED: 0x005b6384 (a hit that spawns the sfx from 0x009c1c88 and
// sets flag 0x400 on the target; ASSUMED name merissa_stab_attack), 0x005b64fc (the dump's
// EnemyProcessAttackWindow_005b64fc), 0x005b667c (not named in the dump), 0x005b63e4 (the freeze
// hit, which checks the enemy's own +0x37c bit 0x20; ASSUMED name unknown_merissa_freeze_stab_attack).
export const MERISSA_ATTACK_RECORDS: readonly MerissaAttackRecord[] = [
  { id: 0, rangeSq: 1600, angle: 1820, kind: 3, scale: 1, start: 10, windowStart: 28, windowEnd: 28, callback: 0x005b6384, callbackName: 'merissa_stab_attack (ASSUMED)' },
  { id: 1, rangeSq: 1600, angle: 1820, kind: 3, scale: 1, start: 10, windowStart: 28, windowEnd: 28, callback: 0x005b6384, callbackName: 'merissa_stab_attack (ASSUMED)' },
  { id: 2, rangeSq: 3600, angle: 8192, kind: 4, scale: 1, start: 10, windowStart: 6, windowEnd: 15, callback: 0x005b64fc, callbackName: 'EnemyProcessAttackWindow_005b64fc' },
  { id: 3, rangeSq: 3600, angle: 8192, kind: 4, scale: 1, start: 10, windowStart: 6, windowEnd: 15, callback: 0x005b64fc, callbackName: 'EnemyProcessAttackWindow_005b64fc' },
  { id: 4, rangeSq: 10000, angle: 10922, kind: 5, scale: 1, start: 10, windowStart: 16, windowEnd: 16, callback: 0x005b667c, callbackName: '(not named in the dump)' },
  { id: 5, rangeSq: 10000, angle: 10922, kind: 5, scale: 1, start: 10, windowStart: 16, windowEnd: 16, callback: 0x005b667c, callbackName: '(not named in the dump)' },
  { id: 6, rangeSq: 1600, angle: 1820, kind: 3, scale: 1.5, start: 10, windowStart: 28, windowEnd: 90, callback: 0x005b63e4, callbackName: 'unknown_merissa_freeze_stab_attack (ASSUMED)' },
];

// PROVEN: the record ids per variant from the table 0x009c1dbc + 20 * variant (the transition's
// `movl 0x9c1dbc(,%ebp,4)` with ebp = variant * 5): word 0 (A, the near stab, 0x005b599a),
// word 1 (B, 0x005b5a52), word 2 (C, 0x005b5acf). Words 3 and 4 (0x009c1dc8, 0x009c1dcc, values
// 92 and 26 for variant 0) are not record ids and are not traced here.
export const MERISSA_ATTACK_SELECT: readonly { near: number; mid: number; far: number }[] = [
  { near: 0, mid: 2, far: 4 }, // variant 0 (A)
  { near: 1, mid: 3, far: 5 }, // variant 1 (AA)
];
export const MERISSA_FREEZE_RECORD = 6; // 0x009c1bb0, the record the A branch takes on a freeze roll
export const MERISSA_FREEZE_MASK = 0x10; // OR-ed into +0x37c on the freeze roll (0x005b5a34..0x005b5a3f)

export function merissaAttackRecord(id: number): MerissaAttackRecord | null {
  return MERISSA_ATTACK_RECORDS.find((r) => r.id === id) ?? null;
}

// PROVEN gate of one attack record: dist^2 below the record's range AND the angle below its
// limit (0x005b59af fcomps then 0x005b59ba cmpl; the same shape for B and C).
export function merissaInAttackRange(rec: MerissaAttackRecord, distSq: number, angle: number): boolean {
  return Math.fround(distSq) < rec.rangeSq && angle < rec.angle;
}

// PROVEN arithmetic of the rolls (0x005b5ae1..0x005b5b50, 0x005b59e1..0x005b5a32): the RNG value
// is read as unsigned (the sign fix adds 2^32 at 0x005b59e5..0x005b59ec), then floor(n * u / 2^32)
// with n = 3 (A) or 10 (C), truncated (fistpll with the chop control word 0xc00). ASSUMED: the
// RNG is 0x00763498 on the enemy's +0x168 object (its result is not traced).
export function merissaRngBucket(u32: number, n: number): number {
  return Math.floor(((u32 >>> 0) * n) / 4294967296);
}

// The A (near) branch once the record gate passed: a target with flag 0x20 (its +0x30 word, the
// `andl $0x20` at 0x005b5974) takes the stab without a roll; otherwise a roll of 3 picks the
// freeze record 6 when it is 0 (1 in 3, with +0x37c |= 0x10), and the stab record otherwise.
export function merissaPickNearAttack(variant: number, u32: number, targetFlag20: boolean): { record: number; freeze: boolean } {
  const sel = MERISSA_ATTACK_SELECT[variant & 1];
  if (targetFlag20) return { record: sel.near, freeze: false };
  if (merissaRngBucket(u32, 3) === 0) return { record: MERISSA_FREEZE_RECORD, freeze: true };
  return { record: sel.near, freeze: false };
}

// The C (far) branch: a roll of 10, the record C only when it is 0 (1 in 10). ASSUMED: the
// branch is taken only after the gate on dist^2 below the C range and the angle below 60 degrees
// (both PROVEN as the record gate); the B branch (record 2 / 3) is only partly traced and is not
// modelled here.
export function merissaPickFarAttack(variant: number, u32: number): number | null {
  const sel = MERISSA_ATTACK_SELECT[variant & 1];
  return merissaRngBucket(u32, 10) === 0 ? sel.far : null;
}

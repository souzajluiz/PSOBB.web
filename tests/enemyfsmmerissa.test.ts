// Episode 4 Merissa A / AA (combat/enemyfsmmerissa.ts): the exe's state table decode, the
// +0x37c mask writes, the radar gate bit and the vanish countdown.
// Run: node tests/enemyfsmmerissa.test.ts
import {
  MERISSA_MASK_CLEAR,
  MERISSA_RADAR_HIDE_BIT,
  MERISSA_STATE_ROWS,
  MERISSA_UPDATE_VA,
  MERISSA_VANISH_LIMIT,
  MERISSA_VTABLE_VA,
  merissaMaskAfterTransition,
  merissaRadarIconShown,
  merissaStateRow,
  merissaStatesWithRadarHide,
  MERISSA_ATTACK_RECORDS,
  MERISSA_ATTACK_SELECT,
  MERISSA_FREEZE_MASK,
  MERISSA_FREEZE_RECORD,
  merissaAttackRecord,
  merissaInAttackRange,
  merissaPickFarAttack,
  merissaPickNearAttack,
  merissaRngBucket,
  merissaVanishStep,
  MERISSA_SLOTS,
  MerissaAi,
} from '../client/src/combat/enemyfsmmerissa.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// Vtable and update (tools/exedata.py read 00b0b6a0 u 12: +4 = 5984508 = 0x5b66ec).
eq(MERISSA_VTABLE_VA, 0x00b0b6a0, 'vtable VA');
eq(MERISSA_UPDATE_VA, 0x005b66ec, 'update VA (vtable +4)');
eq(MERISSA_UPDATE_VA, 5990124, 'vtable +4 word is the update (0x5b66ec)');

// The state table rows (tools/exedata.py read 009c1a24 u 40).
eq(MERISSA_STATE_ROWS.length, 8, 'state rows 0..7');
eq(MERISSA_STATE_ROWS[0].handler, 0x005b53dc, 'state 0 handler');
eq(MERISSA_STATE_ROWS[2].handler, 0x005b5618, 'state 2 handler');
eq(MERISSA_STATE_ROWS[3].handler, 0x005b5f3c, 'state 3 handler');
eq(MERISSA_STATE_ROWS[4].handler, 0x005b61a0, 'state 4 handler');
eq(MERISSA_STATE_ROWS[5].handler, 0x005b6108, 'state 5 handler');
eq(MERISSA_STATE_ROWS[6].handler, 0x005b6328, 'state 6 handler');
eq(MERISSA_STATE_ROWS[7].handler, 0, 'state 7 has no handler');
// Row words: flag arg (+4), motion (+8), mask (+0xc), hook (+0x10).
eq([MERISSA_STATE_ROWS[3].flagArg, MERISSA_STATE_ROWS[3].motion, MERISSA_STATE_ROWS[3].mask, MERISSA_STATE_ROWS[3].hook], [0, 6, 2, 0x005b5294], 'row 3 words');
eq([MERISSA_STATE_ROWS[2].hook], [0x005b51f8], 'row 2 hook (the transition to state 3 calls it)');
eq([MERISSA_STATE_ROWS[4].motion], [-1], 'row 4 motion -1 (none)');
eq([MERISSA_STATE_ROWS[5].hook], [0x005b52ec], 'row 5 hook is on_merissa_dead');
eq([MERISSA_STATE_ROWS[0].flagArg, MERISSA_STATE_ROWS[0].mask], [1, 0x4], 'row 0 (ctor initial) flag and mask');
eq(merissaStateRow(3)?.state, 3, 'row lookup');
eq(merissaStateRow(8), null, 'no row past the table');
eq(merissaStateRow(-1), null, 'no row below 0');
eq(merissaStatesWithRadarHide(), [6], 'only state 6 carries mask 0x8');

// +0x37c: the transition clears 0x2 / 0x4 / 0x8 and keeps 0x1, then ORs the row mask.
eq(MERISSA_MASK_CLEAR, 0xfffffff1, 'clear mask is andl $-0xf');
eq(merissaMaskAfterTransition(0xf, 0x2), 0x3, 'clear 2,4,8 keep 1, OR row 3 mask');
eq(merissaMaskAfterTransition(0x8, 0x0), 0x0, 'bit 8 cleared by a transition with no mask');
eq(merissaMaskAfterTransition(0x1, 0x8), 0x9, 'state 6 entry sets 0x8');

// Radar gate: the plain icon is skipped when bit 0x8 is set (0x005b67c4 jne 0x5b67e1).
eq(MERISSA_RADAR_HIDE_BIT, 0x8, 'radar hide bit');
eq(merissaRadarIconShown(0x5), true, 'ctor state (0x5) shows the icon');
eq(merissaRadarIconShown(0x8), false, 'bit 0x8 hides the icon');
eq(merissaRadarIconShown(0xf7), true, 'bit 0x8 clear (0xf7) shows the icon');
eq(merissaRadarIconShown(0x1f8), false, 'bit 0x8 with other bits hides it');

// Vanish countdown: -0.1f per frame (0x0092aff4), removed below -15.0f (0x0092aff0).
eq(MERISSA_VANISH_LIMIT, -15, 'vanish limit');
let c = 0;
let frames = 0;
let removed = false;
while (!removed && frames < 1000) {
  const s = merissaVanishStep(c);
  c = s.countdown;
  removed = s.removed;
  frames++;
}
check(removed, 'countdown reaches the removal');
// Float32 accumulation of 0.1f: step 149 is -14.99999 (not removed), step 150 is -15.00002 (removed).
eq(frames, 150, 'frames to removal from 0');
check(merissaVanishStep(0).countdown < 0 && !merissaVanishStep(0).removed, 'one step from 0 is not removal');
check(!merissaVanishStep(-14.5).removed, 'above -15 stays');
check(merissaVanishStep(-15).removed === (merissaVanishStep(-15).countdown < -15), 'removal test is strict below -15');

// Attack records (part 2). Init words from the initializer 0x005b6f2c (objdump immediates):
// range 1600 / 3600 / 10000 (0x44c80000, 0x45610000, 0x461c4000), start 10 (0x41200000),
// windows as listed in the module, freeze scale 1.5 (file word at 0x009c1bc0).
eq(MERISSA_ATTACK_RECORDS.length, 7, 'seven attack records');
eq(MERISSA_ATTACK_RECORDS.map((r) => r.rangeSq), [1600, 1600, 3600, 3600, 10000, 10000, 1600], 'record ranges');
eq(MERISSA_ATTACK_RECORDS.map((r) => r.angle), [1820, 1820, 8192, 8192, 10922, 10922, 1820], 'record angle limits (BAMS)');
eq(MERISSA_ATTACK_RECORDS.map((r) => r.callback), [0x5b6384, 0x5b6384, 0x5b64fc, 0x5b64fc, 0x5b667c, 0x5b667c, 0x5b63e4], 'record callbacks');
eq(MERISSA_ATTACK_RECORDS.map((r) => r.start), [10, 10, 10, 10, 10, 10, 10], 'record start times');
eq(merissaAttackRecord(6)?.windowEnd, 90, 'freeze window end');
eq(merissaAttackRecord(2)?.windowStart, 6, 'B window start');
eq(merissaAttackRecord(9), null, 'no record past 6');
eq(MERISSA_ATTACK_SELECT, [{ near: 0, mid: 2, far: 4 }, { near: 1, mid: 3, far: 5 }], 'variant record ids (table 0x009c1dbc)');
eq(MERISSA_FREEZE_RECORD, 6, 'freeze record is 0x009c1bb0 = 0x009c1ac0 + 40 * 6');
eq(MERISSA_FREEZE_MASK, 0x10, 'freeze mask');

// Range gate: dist^2 strictly below the range and the angle strictly below the limit.
const recA = merissaAttackRecord(0)!;
check(merissaInAttackRange(recA, 1599, 1819), 'inside the A gate');
check(!merissaInAttackRange(recA, 1600, 0), 'dist^2 equal to the range is outside');
check(!merissaInAttackRange(recA, 100, 1820), 'angle equal to the limit is outside');

// RNG buckets: floor(n * u / 2^32) on the unsigned value.
eq(merissaRngBucket(0, 3), 0, 'bucket of 0');
eq(merissaRngBucket(0xffffffff, 3), 2, 'bucket of the top value, n = 3');
eq(merissaRngBucket(0x80000000, 3), 1, 'bucket of 2^31 (the sign bit set is unsigned), n = 3');
eq(merissaRngBucket(-1, 10), 9, 'a negative RNG word is read unsigned');
eq(merissaRngBucket(0x19999999, 10), 0, 'just under 0.1 of 2^32 is bucket 0 for n = 10');
eq(merissaRngBucket(0x1999999a, 10), 1, 'at 0.1 of 2^32 the bucket is 1 for n = 10');

// A branch: a flagged target never rolls; a roll of 0 freezes; otherwise the stab.
eq(merissaPickNearAttack(0, 0, true), { record: 0, freeze: false }, 'flagged target stabs without a roll');
eq(merissaPickNearAttack(1, 0, false), { record: 6, freeze: true }, 'roll 0 freezes');
eq(merissaPickNearAttack(1, 0x80000000, false), { record: 1, freeze: false }, 'other rolls stab with the AA record');
// C branch: 1 in 10 takes the far record.
eq(merissaPickFarAttack(0, 0), 4, 'far roll 0 takes record C');
eq(merissaPickFarAttack(1, 0x80000000), null, 'far roll other than 0 fails');
eq(merissaPickFarAttack(1, 0), 5, 'variant AA far record is 5');


// --- Port brain (MerissaAi, OWN_FSM 'MerissaA') ---------------------------------------------
// PROVEN parts: appear -> idle (row 0 countdown), idle acquires within 250 (row 1), the near
// gate and the freeze roll, the +0x37c flags. ASSUMED parts (chase walk, attack timeline, damage
// hold, death) are checked only for their own internal consistency.
const tgt = (x: number, z: number, clientId = 1): AiTarget => ({ clientId, x, z, charClass: 0, dead: false });
const brain = (rng = () => 0.5, angle = 0) => new MerissaAi({ x: 0, z: 0, angle, movement: null, variant: 0, rng });
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const toIdle = (m: MerissaAi) => {
  m.tick([]);
  for (let i = 0; i < 40; i++) m.tick([]);
};

// Ctor: +0x37c = row 0 mask (0x4), the radar icon shows, the vanish motion (slot 0) plays.
{
  const m = brain();
  eq(m.flagsWord, 0x4, 'ctor flags word is row 0 mask');
  check(m.radar, 'ctor: radar shown');
  eq(m.state, 'appear', 'ctor state is appear (row 0)');
  eq(m.motion?.index, MERISSA_SLOTS[0].index, 'ctor motion is the vanish slot');
}

// Row 0 countdown, then idle (row 1, wait slot): the Merissa stands still with no player near.
{
  const m = brain();
  toIdle(m);
  eq(m.state, 'idle', 'appear ends in idle with no player');
  const f = m.tick([]);
  eq(f.motion?.index, MERISSA_SLOTS[1].index, 'idle plays the wait slot');
  eq([f.x, f.z], [0, 0], 'idle does not move (row 1 has no movement)');
}

// Walks to a target inside the 250 acquire range; each step closes the distance.
{
  const m = brain();
  toIdle(m);
  const t = tgt(0, 200);
  let f = m.tick([t]);
  eq(m.state, 'chase', 'a player within 250 starts the chase');
  const d0 = dist(m, t);
  for (let i = 0; i < 20; i++) f = m.tick([t]);
  check(dist(m, t) < d0 - 15, 'chase walks toward the target');
  check(f.motion?.index === MERISSA_SLOTS[2].index, 'chase plays the walk slot');
  // Outside the 250 acquire range the idle keeps its distance.
  const far = brain();
  toIdle(far);
  far.tick([tgt(0, 300)]);
  eq(far.state, 'idle', 'a player at 300 does not wake the idle state');
}

// Attack in range: the near gate (dist^2 < 1600, angle < 10 degrees) with a roll of 0.5
// (not freeze) gives record A; the stab hits the target once in its window.
{
  const m = brain(() => 0.5, 0); // facing +z, the target straight ahead
  const t = tgt(0, 30);
  toIdle(m);
  m.tick([t]); // acquire
  let hits = 0;
  let attacked = false;
  for (let i = 0; i < 60; i++) {
    const f = m.tick([t]);
    if (f.hit) hits++;
    if (m.state === 'attack') attacked = true;
  }
  check(attacked, 'in range the Merissa enters the attack state');
  eq(hits, 1, 'the stab hits the target exactly once');
  // The target stays in range, so the pickers roll again (ASSUMED: the chase re-attacks at once).
  check(m.state === 'chase' || m.state === 'attack', 'after the recovery the Merissa chases or re-attacks');
  for (let i = 0; i < 5; i++) m.tick([]);
  eq(m.state, 'idle', 'with no player left the Merissa returns to idle');
  eq(m.flagsWord & MERISSA_FREEZE_MASK, 0, 'a 0.5 roll does not freeze');
}

// Freeze roll (rng 0.1 < 1/3 for the near roll): record 6 and +0x37c |= 0x10.
{
  const m = brain(() => 0.1, 0);
  const t = tgt(0, 30);
  toIdle(m);
  m.tick([t]);
  for (let i = 0; i < 5 && m.state !== 'attack'; i++) m.tick([t]);
  eq(m.state, 'attack', 'the freeze roll still enters the attack');
  check((m.flagsWord & MERISSA_FREEZE_MASK) !== 0, 'the freeze roll sets +0x37c bit 0x10');
}

// Radar gate: bit 0x8 (state 6, the vanish) hides the icon; leaving the state shows it again.
{
  const m = brain();
  m.startVanish();
  eq(m.state, 'vanish', 'startVanish enters the vanish state');
  check((m.flagsWord & MERISSA_RADAR_HIDE_BIT) !== 0, 'vanish sets bit 0x8');
  check(!m.radar, 'radar hidden while bit 0x8 is set');
  m.tick([]);
  check(!m.removed, 'vanish is not removed on the first frame');
  check(!m.radar, 'the vanish keeps the radar hidden on later frames');
  check(brain().radar, 'the appear state shows the radar');
}

// Death (kill): row 5's mask (0x2), state dead.
{
  const m = brain();
  m.kill();
  eq(m.state, 'dead', 'kill sets dead');
  check((m.flagsWord & 0x2) !== 0, 'death sets row 5 mask 0x2');
}

// Damage: a hit in the idle flinches; the flinch ends in idle with no target.
{
  const m = brain();
  toIdle(m);
  m.onDamage(7);
  eq(m.state, 'damage', 'a hit in idle flinches');
  for (let i = 0; i < 20; i++) m.tick([]);
  eq(m.state, 'idle', 'the flinch ends in idle with no target');
}

if (failures) {
  console.log(`enemyfsmmerissa: ${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsmmerissa: all checks passed');

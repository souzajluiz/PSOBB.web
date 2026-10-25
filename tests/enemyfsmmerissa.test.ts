// Episode 4 Merissa A / AA (combat/enemyfsmmerissa.ts): the exe's state table decode, the +0x37c
// flags, the radar gate, the record table, the motion slots, the transition's picks, the walk
// cycle, the lunge, the attack window, the flinch and the death / vanish path.
// Run: node tests/enemyfsmmerissa.test.ts
import {
  MERISSA,
  MERISSA_ATTACK_RECORDS,
  MERISSA_ATTACK_SELECT,
  MERISSA_DEAD_VA,
  MERISSA_FREEZE_MASK,
  MERISSA_FREEZE_RECORD,
  MERISSA_HIT_VA,
  MERISSA_MASK_CLEAR,
  MERISSA_RADAR_HIDE_BIT,
  MERISSA_SLOTS,
  MERISSA_STATE_ROWS,
  MERISSA_UPDATE_VA,
  MERISSA_VANISH_LIMIT,
  MERISSA_VTABLE_VA,
  MerissaAi,
  merissaAttackRecord,
  merissaFlagsAfterRow,
  merissaInAttackRange,
  merissaMaskAfterTransition,
  merissaPickFarAttack,
  merissaPickNearAttack,
  merissaRadarIconShown,
  merissaRngBucket,
  merissaStateRow,
  merissaStatesWithRadarHide,
  merissaVanishStep,
} from '../client/src/combat/enemyfsmmerissa.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';
import type { EnemyMovementData } from '../client/src/formats/battleparams.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// Vtable, update, hit and death entries (tools/exedata.py read 00b0b6a0 u 40 and 00b0b7a0 u 12).
eq(MERISSA_VTABLE_VA, 0x00b0b6a0, 'vtable VA');
eq(MERISSA_UPDATE_VA, 0x005b66ec, 'update VA (vtable +4)');
eq(MERISSA_UPDATE_VA, 5990124, 'vtable +4 word is the update (0x5b66ec)');
eq(MERISSA_HIT_VA, 5990900, 'vtable +0x100 word is the hit reaction 0x005b69f4');
eq(MERISSA_DEAD_VA, 5991056, 'vtable +0x104 word is the death entry 0x005b6a90');

// The state rows (tools/exedata.py read 009c1a24 u 40).
eq(MERISSA_STATE_ROWS.length, 8, 'state rows 0..7');
eq(MERISSA_STATE_ROWS.map((r) => r.handler).slice(0, 7), [0x005b53dc, 0x005b54cc, 0x005b5618, 0x005b5f3c, 0x005b61a0, 0x005b6108, 0x005b6328], 'row handlers 0..6');
eq(MERISSA_STATE_ROWS[7].handler, 0, 'state 7 has no handler');
eq([MERISSA_STATE_ROWS[3].flagArg, MERISSA_STATE_ROWS[3].motion, MERISSA_STATE_ROWS[3].mask], [0, 6, 2], 'row 3 words');
eq(MERISSA_STATE_ROWS.map((r) => r.hook), [0x005b51dc, 0x005b51e8, 0x005b51f8, 0x005b5294, 0x005b5260, 0x005b52ec, 0, 0], 'row hooks');
eq(MERISSA_STATE_ROWS[4].motion, -1, 'row 4 motion -1 (the kind is set by the row 3 hook)');
eq(MERISSA_STATE_ROWS[6].motion, -1, 'row 6 motion -1 (the death hook sets it)');
eq(merissaStateRow(3)?.state, 3, 'row lookup');
eq(merissaStateRow(8), null, 'no row past the table');
eq(merissaStateRow(-1), null, 'no row below 0');
eq(merissaStatesWithRadarHide(), [6], 'only state 6 carries mask 0x8');

// +0x37c: the transition clears 0x2 / 0x4 / 0x8, the flag argument sets or clears 0x1, then the mask.
eq(MERISSA_MASK_CLEAR, 0xfffffff1, 'clear mask is andl $-0xf');
eq(merissaMaskAfterTransition(0xf, 0x2), 0x3, 'clear 2,4,8 keep 1, OR row 3 mask');
eq(merissaMaskAfterTransition(0x8, 0x0), 0x0, 'bit 8 cleared by a transition with no mask');
eq(merissaFlagsAfterRow(0, MERISSA_STATE_ROWS[0]), 0x5, 'ctor: row 0 flag 1 sets bit 1, mask 4');
eq(merissaFlagsAfterRow(0x5, MERISSA_STATE_ROWS[3]), 0x3, 'row 3 (flag 0) keeps bit 1 set, mask 2');
eq(merissaFlagsAfterRow(0x3, MERISSA_STATE_ROWS[2]), 0x0, 'row 2 (flag 2) clears bit 1');
eq(merissaFlagsAfterRow(0x10, MERISSA_STATE_ROWS[6]), 0x19, 'state 6 entry: 0xfffffff1 keeps the freeze bit 0x10, bit 1 is set (flag 0), mask 0x8');

// Radar gate: the plain icon is skipped when bit 0x8 is set (0x005b67c4 jne 0x5b67e1).
eq(MERISSA_RADAR_HIDE_BIT, 0x8, 'radar hide bit');
eq(merissaRadarIconShown(0x5), true, 'ctor state (0x5) shows the icon');
eq(merissaRadarIconShown(0x8), false, 'bit 0x8 hides the icon');
eq(merissaRadarIconShown(0xf7), true, 'bit 0x8 clear (0xf7) shows the icon');

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
eq(frames, 150, 'frames to removal from 0 (float32 steps)');
check(!merissaVanishStep(-14.5).removed, 'above -15 stays');

// Motion slots (the table with the run-time speeds of 0x005b6f7c / 0x005b6f86 / the initializer).
eq(MERISSA_SLOTS.map((s) => s.index), [8, 16, 7, 3, 15, 2, 6, 4, 10, 5], 'motion indexes per slot');
eq(MERISSA_SLOTS.map((s) => s.speed), [0.5, 0.5, 1, 2, 0.5, 0.5, 1, 0.5, 0.5, 0.5], 'slot speeds (slot 4 0.5 and slot 6 1.0 by the initializer)');
eq(MERISSA_SLOTS.map((s) => s.loop), [false, true, true, false, false, false, false, false, false, false], 'loop flags (1 and 2 loop)');

// Attack records (the initializer 0x005b6f2c writes the ranges, starts and windows; the file
// words give the kinds and the freeze scale).
eq(MERISSA_ATTACK_RECORDS.length, 7, 'seven attack records');
eq(MERISSA_ATTACK_RECORDS.map((r) => r.rangeSq), [1600, 1600, 3600, 3600, 10000, 10000, 1600], 'record ranges');
eq(MERISSA_ATTACK_RECORDS.map((r) => r.angle), [1820, 1820, 8192, 8192, 10922, 10922, 1820], 'record angle limits (BAMS)');
eq(MERISSA_ATTACK_RECORDS.map((r) => r.kind), [3, 3, 4, 4, 5, 5, 3], 'record kinds (the motion slot)');
eq(MERISSA_ATTACK_RECORDS.map((r) => r.callback), [0x5b6384, 0x5b6384, 0x5b64fc, 0x5b64fc, 0x5b667c, 0x5b667c, 0x5b63e4], 'record callbacks');
eq(MERISSA_ATTACK_RECORDS.map((r) => r.start), [10, 10, 10, 10, 10, 10, 10], 'record start times');
eq(MERISSA_ATTACK_RECORDS.map((r) => [r.windowStart, r.windowEnd]), [[28, 28], [28, 28], [6, 15], [6, 15], [16, 16], [16, 16], [28, 90]], 'record windows');
eq(merissaAttackRecord(6)?.scale, 1.5, 'freeze scale 1.5');
eq(merissaAttackRecord(9), null, 'no record past 6');
eq(MERISSA_ATTACK_SELECT, [{ near: 0, mid: 2, far: 4 }, { near: 1, mid: 3, far: 5 }], 'variant record ids (table 0x009c1dbc)');
eq(MERISSA_FREEZE_RECORD, 6, 'freeze record is 0x009c1bb0 = 0x009c1ac0 + 40 * 6');
eq(MERISSA_FREEZE_MASK, 0x10, 'freeze mask');
eq([MERISSA.acquire, MERISSA.nearDistSq, MERISSA.homeDistSq, MERISSA.lungeDivisor], [250, 1600, 100, 21], 'PROVEN constants');

// Range gate: dist^2 strictly below the range and the angle strictly below the limit.
const recA = merissaAttackRecord(0)!;
check(merissaInAttackRange(recA, 1599, 1819), 'inside the A gate');
check(!merissaInAttackRange(recA, 1600, 0), 'dist^2 equal to the range is outside');
check(!merissaInAttackRange(recA, 100, 1820), 'angle equal to the limit is outside');

// RNG buckets: floor(n * u / 2^32) on the unsigned value.
eq(merissaRngBucket(0, 3), 0, 'bucket of 0');
eq(merissaRngBucket(0xffffffff, 3), 2, 'bucket of the top value, n = 3');
eq(merissaRngBucket(-1, 10), 9, 'a negative RNG word is read unsigned');
eq(merissaRngBucket(0x1999999a, 10), 1, 'at 0.1 of 2^32 the bucket is 1 for n = 10');

// A branch: a flagged target never rolls; a roll of 0 freezes; otherwise the stab.
eq(merissaPickNearAttack(0, 0, true), { record: 0, freeze: false }, 'flagged target stabs without a roll');
eq(merissaPickNearAttack(1, 0, false), { record: 6, freeze: true }, 'roll 0 freezes');
eq(merissaPickNearAttack(1, 0x80000000, false), { record: 1, freeze: false }, 'other rolls stab with the AA record');
eq(merissaPickFarAttack(0, 0), 4, 'far roll 0 takes record C');
eq(merissaPickFarAttack(1, 0x80000000), null, 'far roll other than 0 fails');
eq(merissaPickFarAttack(1, 0), 5, 'variant AA far record is 5');

// --- Port brain (MerissaAi, OWN_FSM 'MerissaA') -----------------------------------------------
const movement = (fparam4: number, turn: number, nearDeg: number): EnemyMovementData => ({
  fparam1: 0,
  fparam2: 0,
  fparam3: 0,
  fparam4,
  fparam5: 0,
  fparam6: 0,
  iparam: [turn, nearDeg, 0, 0, 0, 0],
});
const tgt = (x: number, z: number, angle = 0, clientId = 1): AiTarget => ({ clientId, x, z, charClass: 0, dead: false, angle });
// The facing that points the target at the Merissa at (mx, mz): the bearing from the target.
const facing = (tx: number, tz: number, mx = 0, mz = 0): number => Math.atan2(mx - tx, mz - tz);
const brain = (opts: { rng?: () => number; angle?: number; mv?: EnemyMovementData | null; frames?: number } = {}) =>
  new MerissaAi({
    x: 0,
    z: 0,
    angle: opts.angle ?? 0,
    movement: opts.mv === undefined ? movement(2, 10, 0) : opts.mv,
    variant: 0,
    rng: opts.rng ?? (() => 0.5),
    motionFrames: () => opts.frames ?? 30,
  });
const toIdle = (m: MerissaAi) => {
  for (let i = 0; i < 40 && m.state === 'appear'; i++) m.tick([]);
};
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

// Ctor: +0x37c = 0x5 (the row 0 flag 1 and mask 4), the radar icon shows, the wait-less appear motion (slot 0).
{
  const m = brain();
  eq(m.flagsWord, 0x5, 'ctor flags word is 0x5');
  check(m.radar, 'ctor: radar shown');
  eq(m.state, 'appear', 'ctor state is appear (row 0)');
  eq(m.motion?.index, MERISSA_SLOTS[0].index, 'ctor motion is slot 0');
}

// Row 0 countdown, then idle (row 1): no player near, the Merissa stands.
{
  const m = brain();
  toIdle(m);
  eq(m.state, 'idle', 'appear ends in idle with no player');
  const f = m.tick([]);
  eq([f.x, f.z], [0, 0], 'idle does not move (row 1 has no movement)');
  const far = brain();
  toIdle(far);
  far.tick([tgt(0, 300)]);
  eq(far.state, 'idle', 'a player at 300 does not wake the idle state');
  far.tick([tgt(0, 200)]);
  eq(far.state, 'chase', 'a player at 200 starts the chase (row 1 acquire 250)');
}

// Walk cycle (row 2): the turn while elapsed < 4, the step while 4 <= elapsed <= 16. Target far
// and facing away, so no pick fires; the walk uses fparam4 per step.
{
  const m = brain({ mv: movement(2, 10, 0) });
  toIdle(m);
  const t = tgt(0, 200, 0);
  m.tick([t]); // enters chase
  eq(m.state, 'chase', 'chase after the acquire');
  const xs: number[] = [];
  let prevZ = m.z;
  let steps = 0;
  for (let i = 0; i < 30; i++) {
    m.tick([t]);
    if (Math.abs(m.z - prevZ) > 1e-9) steps++;
    prevZ = m.z;
    xs.push(m.z);
  }
  eq(steps, 13, 'walk steps on the 13 frames 4..16 of the cycle');
  check(dist(m, { x: 0, z: 0 }) > 0, 'the steps move the Merissa');
}

// Turn (row 2 change_enemy_direction): iparam1 = 10 degrees a frame while elapsed < 4, facing +x.
{
  const m = brain({ mv: movement(2, 10, 0), angle: 0 });
  toIdle(m);
  m.tick([tgt(200, 0, 0)]); // enter chase
  m.tick([tgt(200, 0, 0)]); // a = 1, turns
  // 10 degrees is 1820 BAMS (ROUND(deg * 65536 / 360)), one step of the turn at a < 4.
  eq(Math.round(m.angle / (Math.PI * 2 / 65536)), 1820, 'the chase turn is iparam1 degrees a frame (1820 BAMS)');
}

// The N lunge (0x005b5818): dist^2 < 1600, the target's facing within iparam2 of the bearing back.
// Target 30 ahead and facing us: the Merissa lunges to the back of the target (20 units behind it).
{
  const m = brain({ mv: movement(2, 10, 45) });
  toIdle(m);
  const t = tgt(0, 30, facing(0, 30));
  m.tick([t]);
  for (let i = 0; i < 6 && m.state === 'chase'; i++) m.tick([t]);
  eq(m.state, 'lunge', 'the N lunge starts at the cycle start (target facing us within 45 degrees)');
  eq(m.motion?.index, MERISSA_SLOTS[6].index, 'the lunge plays slot 6');
  eq(m.flagsWord & 0x2, 0x2, 'the lunge mask 0x2 is set');
}

// The N gate fails when the target faces away (diff near 180 degrees): then no lunge.
{
  const m = brain({ mv: movement(2, 10, 45) });
  toIdle(m);
  const t = tgt(0, 30, Math.PI + facing(0, 30));
  m.tick([t]);
  for (let i = 0; i < 6; i++) m.tick([t]);
  check(m.state !== 'lunge', 'a target facing away does not get the lunge');
}

// Record A: the stab at dist^2 < 1600 with a diff under 10 degrees (N off: iparam2 = 0). The rolls
// 0.5 stab (bucket 1), the window crosses at 28 with stride 2. Hit once.
{
  const m = brain({ mv: movement(2, 10, 0), frames: 60 });
  toIdle(m);
  const t = tgt(0, 30, facing(0, 30));
  m.tick([t]);
  let hits = 0;
  let attacked = false;
  let ended = false;
  for (let i = 0; i < 120 && !ended; i++) {
    const f = m.tick([t]);
    if (f.hit) hits++;
    if (m.state === 'attack') {
      attacked = true;
      if (m.motion?.index !== MERISSA_SLOTS[3].index) check(false, 'the stab plays slot 3');
    } else if (attacked) ended = true;
  }
  check(attacked, 'in range the Merissa enters the attack state (slot 3)');
  eq(hits, 1, 'the stab hits the target exactly once in its window');
  eq(m.state, 'chase', 'the attack ends back in the chase (the animation end)');
  eq(m.flagsWord & MERISSA_FREEZE_MASK, 0, 'a 0.5 roll does not freeze');
}

// Freeze roll (rng 0.1 gives bucket 0): record 6, +0x37c |= 0x10, slot 3 at speed 2 * 1.5.
{
  const m = brain({ mv: movement(2, 10, 0), rng: () => 0.1, frames: 90 });
  toIdle(m);
  const t = tgt(0, 30, facing(0, 30));
  m.tick([t]);
  for (let i = 0; i < 4 && m.state !== 'attack'; i++) m.tick([t]);
  eq(m.state, 'attack', 'the freeze roll enters the attack');
  check((m.flagsWord & MERISSA_FREEZE_MASK) !== 0, 'the freeze roll sets +0x37c bit 0x10');
  eq(m.motion?.speed, 3, 'the freeze plays slot 3 at 2 * 1.5');
  eq(m.motion?.index, MERISSA_SLOTS[3].index, 'the freeze plays the kind 3 motion');
}

// Record B: dist^2 3600 gate (50 ahead, out of A), roll 0.1 gives record 2 (kind 4, slot 4).
{
  const m = brain({ mv: movement(2, 10, 0), rng: () => 0.1, frames: 60 });
  toIdle(m);
  const t = tgt(0, 50, facing(0, 50));
  m.tick([t]);
  for (let i = 0; i < 4 && m.state !== 'attack'; i++) m.tick([t]);
  eq(m.state, 'attack', 'B enters the attack with a roll of 0');
  eq(m.motion?.index, MERISSA_SLOTS[4].index, 'B plays the kind 4 motion (slot 4)');
}

// Record B roll failure: a roll of 0.5 (bucket 1) leaves the Merissa in the chase (no C either).
{
  const m = brain({ mv: movement(2, 10, 0), rng: () => 0.5 });
  toIdle(m);
  const t = tgt(0, 50, facing(0, 50));
  // Enter the chase, one frame at a = 0, then the pick at a = 1 (the walk has not moved yet).
  m.tick([t]);
  m.tick([t]);
  m.tick([t]);
  eq(m.state, 'chase', 'a failed B roll stays in the chase');
}

// Record C: dist^2 10000 gate (80 ahead), roll 0.01 (bucket 0 of 10) gives record 4 (kind 5).
{
  const m = brain({ mv: movement(2, 10, 0), rng: () => 0.01, frames: 60 });
  toIdle(m);
  const t = tgt(0, 80, facing(0, 80));
  m.tick([t]);
  for (let i = 0; i < 4 && m.state !== 'attack'; i++) m.tick([t]);
  eq(m.state, 'attack', 'C enters the attack with a roll of 0');
  eq(m.motion?.index, MERISSA_SLOTS[5].index, 'C plays the kind 5 motion (slot 5)');
}

// Flinch (row 5): a hit in the idle starts it (slot 7); the animation's end resets to the chase.
{
  const m = brain();
  toIdle(m);
  m.onDamage(7);
  eq(m.state, 'flinch', 'a hit in idle flinches');
  eq(m.motion?.index, MERISSA_SLOTS[7].index, 'the flinch plays slot 7');
  eq(m.flinchMotion.index, MERISSA_SLOTS[7].index, 'the flinch motion is slot 7');
  m.tick([], true);
  eq(m.state, 'chase', 'the flinch ends in the chase (the reset to state 2)');
}

// A hit in the attack (mask 0x2) does nothing.
{
  const m = brain({ mv: movement(2, 10, 0), frames: 60 });
  toIdle(m);
  const t = tgt(0, 30, facing(0, 30));
  m.tick([t]);
  for (let i = 0; i < 6 && m.state !== 'attack'; i++) m.tick([t]);
  eq(m.state, 'attack', 'setup: in the attack');
  m.onDamage(7);
  eq(m.state, 'attack', 'a hit during the attack does not flinch');
}

// Death (vtable +0x104, on_merissa_dead): state 6, the radar hidden, the countdown from 0, and
// motion 9 when the attacker is within 90 degrees of the facing, 8 otherwise.
{
  const front = brain();
  toIdle(front);
  front.tick([tgt(0, 100, 0, 3)]);
  front.onDamage(3);
  front.kill();
  eq(front.state, 'vanish', 'kill enters state 6');
  eq(front.motion?.index, MERISSA_SLOTS[9].index, 'an attacker in front (the target at +z, facing 0) gives motion 9');
  check(!front.radar, 'the death hides the radar (mask 0x8)');
  check((front.flagsWord & MERISSA_RADAR_HIDE_BIT) !== 0, 'bit 0x8 set');
  front.kill();
  eq(front.state, 'vanish', 'a second kill changes nothing');
}
{
  const behind = brain({ angle: 0 });
  toIdle(behind);
  behind.tick([tgt(0, -100, 0, 4)]); // -z: 180 degrees away from facing 0
  behind.onDamage(4);
  behind.kill();
  eq(behind.motion?.index, MERISSA_SLOTS[8].index, 'an attacker behind gives motion 8');
}

// The vanish countdown runs once the death motion has ended; removed after 150 steps (ended).
{
  const m = brain();
  toIdle(m);
  m.kill();
  for (let i = 0; i < 50; i++) m.tick([], false);
  check(!m.removed, 'no countdown while the death motion plays');
  let n = 0;
  while (!m.removed && n < 1000) {
    m.tick([], true);
    n++;
  }
  eq(n, 150, 'removed on the 150th frame after the motion ended');
}

// Attack deathMotion without a seen attacker: 8.
eq(brain().deathMotion.index, MERISSA_SLOTS[8].index, 'no attacker: death motion 8');

// The lunge's walk stays within its window: the Merissa moves only between 14 and 34 frames.
{
  const m = brain({ mv: movement(2, 10, 45), frames: 60 });
  toIdle(m);
  const t = tgt(0, 30, facing(0, 30));
  m.tick([t]);
  for (let i = 0; i < 6 && m.state === 'chase'; i++) m.tick([t]);
  check(m.state === 'lunge', 'setup: lunging');
  const z0 = m.z;
  let moved = 0;
  let prev = z0;
  for (let i = 0; i < 40 && m.state === 'lunge'; i++) {
    m.tick([t]);
    if (Math.abs(m.z - prev) > 1e-9) moved++;
    prev = m.z;
  }
  eq(moved, 19, 'the lunge steps on the 19 frames 14 < elapsed < 34');
  check(dist({ x: 0, z: z0 }, { x: m.x, z: m.z }) > 30, 'the lunge closes most of the 30 units');
}

if (failures) {
  console.log(`enemyfsmmerissa: ${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsmmerissa: all checks passed');

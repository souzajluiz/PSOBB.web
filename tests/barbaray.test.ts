// Barba Ray (client/src/combat/barbaray.ts, docs/bosses/barbaray-map.md): the
// action table playback per floor, the pool signs and the break -> body drain,
// the gate, the finale -> death, the spawner, the 6xA9 / 6xAA codec, and the
// motion chains against the real bm_boss7_de_rol_le_c frame counts (from the
// client data, skipped when it is not present).
//
// Run: node tests/barbaray.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BARBA_ANCHORS,
  BARBA_ATTACK,
  BARBA_CAPTURE_COUNT,
  BARBA_DROP,
  BARBA_DWELL,
  BARBA_CAPTURE_OFFSETS,
  BARBA_HP,
  BARBA_JUMP,
  BARBA_PACE,
  BARBA_PART_COUNT,
  BARBA_PART_RADIUS,
  BARBA_PIG_COUNT,
  BARBA_PIG_DEST,
  BARBA_PIG_HEADING,
  barbaPigMode,
  BARBA_PHASE,
  BARBA_ROW_PARK,
  BARBA_FOLLOW,
  BARBA_SIDE_ENTRY,
  BARBA_SLOTS,
  BARBA_SWIM,
  BARBA_TABLES,
  BarbaFollower,
  BarbaPartAi,
  BarbaRayAi,
  barbaResolve,
  barbaRows,
  decodeBarbaMessage,
  encodeBarbaAA,
  encodeBarbaA9,
  type BarbaEvent,
} from '../client/src/combat/barbaray.ts';
import { PIG_DEATH_TICKS, PIG_FX, PIG_SE, PIG_STATE, PigRayAi, type PigEvent } from '../client/src/combat/barbaminion.ts';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { EnemyArchive } from '../client/src/render/enemymodel.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = <T>(a: T, b: T, msg: string) => check(Object.is(a, b), `${msg}: got ${String(a)}, want ${String(b)}`);

const rng = () => 0.5; // roll > 0: the 0x1e / 0x20 picks take the second branch

function brain(opts: { leader?: boolean; floor?: number } = {}): BarbaRayAi {
  return new BarbaRayAi({ x: 0, z: 0, angle: 0, rng, movement: null, floor: opts.floor ?? 0, leader: () => opts.leader ?? true });
}

const sends = (events: BarbaEvent[]) => events.filter((e): e is Extract<BarbaEvent, { kind: 'send' }> => e.kind === 'send');

// --- constants and the table ---------------------------------------------------

eq(BARBA_HP, 20000, 'HP 20000 (0x4e20)');
eq(BARBA_SLOTS.length, 17, 'motion slots 0..16');
eq(BARBA_SLOTS[1]!.motion, 11, 'slot 1 is forward (motion 11)');
eq(BARBA_ANCHORS.length, 10, 'ten anchors');
eq(BARBA_TABLES[0]!.length, 67, 'floor 0 table: 67 codes (through 0x45)');
eq(BARBA_TABLES[1]!.length, 86, 'floor 1 table: 86 codes');
eq(BARBA_TABLES[2]!.length, 87, 'floor 2 table: 87 codes');
eq(BARBA_TABLES[3]!.length, 96, 'floor 3 table: 96 codes');
eq(BARBA_TABLES[0]![0], 3, 'floor 0 starts with 3');
eq(BARBA_TABLES[0]![66], 69, 'floor 0 ends with the 0x45 loop');
check(BARBA_TABLES.every((t) => t[t.length - 1] === 0x45), 'every floor table ends with the 0x45 loop');

// --- action table playback ----------------------------------------------------------

// The resolve switch (0x004b8e3c): the variants pick by the flag and the roll.
eq(barbaResolve(0x1e, 0, 0.5).phase, 8, '0x1e: roll above 0.0 -> 8');
eq(barbaResolve(0x1e, 0, -0.5).phase, 6, '0x1e: roll at or below 0.0 -> 6');
eq(barbaResolve(0x1f, 0, 0).phase, 5, '0x1f: flag 0 -> 5');
eq(barbaResolve(0x1f, 1, 0).phase, 9, '0x1f: flag 1 -> 9');
eq(barbaResolve(0x20, 0, 0.5).phase, 0x0c, '0x20: roll above 0.0 -> 0x0c');
eq(barbaResolve(0x20, 0, 0).phase, 0x0e, '0x20: roll at 0.0 -> 0x0e');
eq(barbaResolve(0x21, 0, 0).phase, 3, '0x21 flag 0 -> 3');
eq(barbaResolve(0x21, 1, 0).phase, 0x0b, '0x21 flag 1 -> 0x0b');
eq(barbaResolve(0x27, 1, 0).phase, 0x16, '0x27 flag 1 -> 0x16');
eq(barbaResolve(0x45, 0, 0).loop, true, '0x45 loops');
eq(barbaResolve(0x28, 0, 0).phase, 0x28, 'an unlisted code is sent as it is');

// Playback: the leader's table steps send the records in order, and 0x45
// jumps to record 1 (not 0).
{
  const b = brain();
  const t = BARBA_TABLES[0]!;
  const want: number[] = [];
  let cursor = 0;
  for (let n = 0; n < t.length * 2 + 5; n++) {
    const code = t[cursor % t.length]!;
    cursor++;
    if (code === 0x45) {
      cursor = 1;
      continue;
    }
    const s = barbaResolve(code, 0, 0.5);
    if (s.phase !== null) want.push(s.phase);
    if (want.length >= 60) break;
  }
  // The brain's own sends (each send is one step; the table has no 0x1c/0x1d code).
  const got: number[] = [];
  for (let n = 0; n < 400 && got.length < 60; n++) {
    b.tableLoop();
    for (const s of sends(b.drain())) got.push(s.phase);
  }
  eq(got.slice(0, 10).join(), want.slice(0, 10).join(), 'table playback: the first sends follow the records');
  check(got.length >= 60, 'table playback: 60 sends over the first two passes');
  // Record 1 (8) comes back right after the 0x45 loop at record 66.
  const b2 = brain();
  b2.cursor = 66;
  // Record 66 is 0x45: no send for it, the loop reads record 1 (8) in the same call.
  b2.tableLoop();
  const after = sends(b2.drain());
  eq(after.length, 1, 'table playback: one send per step even across the 0x45 loop');
  eq(after[0]?.phase, 8, 'table playback: after 0x45 the send is record 1 (8)');
  eq(b2.cursor, 2, 'table playback: the cursor is past record 1 after the loop');
}

// --- pools: the part sign, the break and the root drain ----------------------------

{
  const b = brain();
  eq(b.hitPart(0, 300), 'part', 'a part hit below the pool is the part');
  eq(b.parts[0]!.pool, 20000 - 300, 'part pool -= damage');
  eq(b.parts[0]!.broken, false, 'part not broken yet');
  eq(b.hitPart(0, 19700), 'broken', 'the hit that takes the pool below 1 breaks the part');
  eq(b.parts[0]!.broken, true, 'broken flag set');
  const before = b.bodyHp;
  eq(b.hitPart(0, 101), 'drain', 'a broken part drains the body');
  eq(before - b.bodyHp, Math.trunc(101 * 0.5), 'the body pool drops by trunc(damage * 0.5) (x87 control word 0xc00)');
  eq(Math.trunc(3 * 0.5), 1, 'truncation: 3 * 0.5 is 1, not 2');
  eq(b.hitPart(1, 0), 'none', 'zero damage does nothing');
  eq(b.hitPart(1, -5), 'none', 'negative damage does nothing');
  check(b.drain().some((e) => e.kind === 'se' && e.id === 0x3f9), 'the break plays SE 0x3f9');
}

{
  const b = brain();
  eq(b.hitRoot(100), 'shell', 'the root hit takes the shell first');
  eq(b.shellHp, 20000 - 100, 'shell pool -= damage');
  eq(b.hitRoot(20000), 'shellBroken', 'the shell breaks when its pool goes below 0');
  eq(b.shellBroken, true, 'flag 8 set with the break (0x88)');
  eq(b.shellHp, 0, 'shell pool clamped to 0');
  eq(b.hitRoot(50), 'body', 'after the shell breaks, hits go to the body 704');
  eq(b.bodyHp, 20000 - 50, 'body pool -= damage');
}

// --- gate ----------------------------------------------------------------------------

{
  const b = brain();
  eq(b.gateOpen, false, 'gate closed at the start (the body pool is up)');
  b.bodyHp = 0;
  eq(b.gateOpen, true, 'gate opens when the body pool is below 1 (0x004b8e1c)');
  b.flags |= 4;
  eq(b.gateOpen, false, 'flag 4 blocks the gate');
}

// Gate open: the leader paces one step per BARBA_PACE + 1 ticks (not every tick).
{
  const b = brain();
  b.bodyHp = 0;
  b.flags = 0;
  b.phase = 0x13;
  b.state = 'phase 13';
  b.cursor = 0;
  for (let n = 0; n < BARBA_PACE * 3; n++) b.tick([], false);
  const steps = sends(b.drain()).length;
  check(steps >= 1 && steps <= 4, `gate open: paced table steps (got ${steps} sends over ${BARBA_PACE * 3} ticks)`);
}

// --- finale -> death -------------------------------------------------------------------

{
  const b = brain();
  b.applyRemote(0x1c, 0, null);
  eq(b.phase, 0x1c, 'the 6xA9 phase 0x1c applies');
  eq(b.slot, 0x10, 'finale enter: slot 0x10 (motion 7, ed_boss2)');
  eq(b.side, 3, 'finale enter: side 3');
  eq(b.bodyHp, 0, 'finale enter: body pool 704 zeroed (0x004b6026)');
  eq(b.x, BARBA_ANCHORS[3]![0], 'finale enter: moved to anchor 3');
  b.drain();
  b.tick([], false);
  const ev = b.drain();
  check(sends(ev).some((e) => e.phase === 0x1d), 'finale: the kill request sends 0x1d');
  check(ev.some((e) => e.kind === 'killed'), 'finale: leaving 0x1c is the kill (EXP / drops / 6x76 on the owner)');
  check(ev.some((e) => e.kind === 'dead'), 'death: 0x1d enter reports dead');
  eq(b.dead, true, 'brain is dead');
  b.tick([], false);
  eq(b.drain().length, 0, 'dead: no more events');
}

// A follower does not send the kill request, but applies the 6xA9 0x1d it gets.
{
  const f = brain({ leader: false });
  f.applyRemote(0x1c, 0, null);
  f.tick([], false);
  check(!sends(f.drain()).some((e) => e.phase === 0x1d), 'follower: the leader sends 0x1d, not the follower');
  f.applyRemote(0x1d, 0, null);
  eq(f.dead, true, 'follower: applies the remote 0x1d (death)');
}

// --- spawner ------------------------------------------------------------------------------

{
  const b = brain();
  b.applyRemote(0x3a, 0, null);
  eq(b.spawnCount, 9, 'spawner enter: 9 Pig Rays (0x004b0910 param 4)');
  let spawns = 0;
  const seen: number[] = [];
  for (let n = 0; n < 80; n++) {
    b.tick([], false);
    for (const e of b.drain()) {
      if (e.kind === 'spawn') {
        spawns++;
        seen.push(e.index);
      }
    }
  }
  eq(spawns, 9, 'spawner: exactly 9 spawns in 80 ticks');
  eq(seen.join(), '0,1,2,3,4,5,6,7,8', 'spawner: indexes in order');
}

// --- the brain never hangs without damage ------------------------------------------

{
  const b = brain();
  let sendCount = 0;
  const phases = new Set<number>();
  for (let n = 0; n < 6000; n++) {
    b.tick([], true);
    for (const e of b.drain()) if (e.kind === 'send') {
      sendCount++;
      phases.add(e.phase);
    }
    check(!b.dead, 'no damage: the brain does not die by itself');
    if (b.dead) break;
  }
  check(sendCount > 10, `no damage: the table keeps going (${sendCount} sends)`);
  check(phases.size >= 4, `no damage: the phases change (${phases.size} distinct)`);
}

// --- the 6xA9 / 6xAA codec -----------------------------------------------------------------

{
  const a9 = encodeBarbaA9(0x1000 | 4, 0x13, 77);
  eq(a9.length, 8, '6xA9 is 8 bytes');
  eq(a9[0], 0xa9, '6xA9 command byte');
  eq(a9[1], 2, '6xA9 size word');
  const d9 = decodeBarbaMessage(a9)!;
  eq(d9.entity, 0x1004, '6xA9 entity @+2');
  eq(d9.phase, 0x13, '6xA9 phase @+4');
  eq(d9.cursor, 77, '6xA9 cursor @+6');
  eq(d9.target, null, '6xA9 has no target');

  const aa = encodeBarbaAA(0x1004, 0x14, 9, 0xfffe);
  eq(aa.length, 12, '6xAA is 12 bytes');
  eq(aa[0], 0xaa, '6xAA command byte');
  const daa = decodeBarbaMessage(aa)!;
  eq(daa.phase, 0x14, '6xAA phase');
  eq(daa.cursor, 9, '6xAA cursor');
  eq(daa.target, 0xfffe, '6xAA target @+8 (u32)');
  eq(decodeBarbaMessage(new Uint8Array([0x13, 2, 0, 0, 0, 0, 0, 0])), null, 'other subcommands are not Barba Ray');
  eq(decodeBarbaMessage(new Uint8Array([0xaa, 3, 0, 0, 0, 0, 0, 0])), null, 'a short 6xAA is rejected');
}

// Remote damage feeds the pools on every client (the same calls as the striker).
{
  const striker = brain({ leader: true });
  const follower = brain({ leader: false });
  striker.hitRoot(1234);
  follower.hitRoot(1234);
  eq(follower.shellHp, striker.shellHp, 'remote root damage: the follower has the same shell pool');
  striker.hitPart(2, 500);
  follower.hitPart(2, 500);
  eq(follower.parts[2]!.pool, striker.parts[2]!.pool, 'remote part damage: the follower has the same part pool');
}

// --- part positions (root update 0x004b8584: rows = midpoints of the captures) ----------

{
  // The capture operands: 0x3f4, 0x460, then 0x478 + 12 * j for the nine that follow.
  eq(BARBA_CAPTURE_COUNT, 11, 'capture count: 11 captures make 10 rows');
  eq(BARBA_CAPTURE_OFFSETS.length, BARBA_CAPTURE_COUNT, 'capture offset table length');
  eq(BARBA_CAPTURE_OFFSETS[0], 0x3f4, 'capture 0 is root+0x3f4');
  eq(BARBA_CAPTURE_OFFSETS[1], 0x460, 'capture 1 is root+0x460');
  let stepped = true;
  for (let k = 3; k < BARBA_CAPTURE_COUNT; k++) if (BARBA_CAPTURE_OFFSETS[k] !== 0x478 + 12 * (k - 2)) stepped = false;
  check(stepped, 'captures 2..10 are root+0x478 + 12 * (k - 2)');
  eq(BARBA_CAPTURE_OFFSETS[2], 0x478, 'capture 2 is root+0x478');
  eq(BARBA_PART_COUNT, 10, 'ten rows / parts');
  eq(BARBA_ROW_PARK, 9984, 'rows park at 9984.0 (0x461c4000)');

  // Row r is the midpoint of captures r and r + 1 (0.5 * (C[r] + C[r+1])).
  const caps: [number, number, number][] = Array.from({ length: BARBA_CAPTURE_COUNT }, (_, k) => [k * 10, k * 4, -k]);
  const rows: [number, number, number][] = Array.from({ length: BARBA_PART_COUNT }, () => [0, 0, 0]);
  barbaRows(caps, rows);
  for (let r = 0; r < BARBA_PART_COUNT; r++) {
    const want = [(r * 10 + (r + 1) * 10) / 2, (r * 4 + (r + 1) * 4) / 2, (-r - (r + 1)) / 2];
    check(rows[r]!.every((v, j) => Math.abs(v - want[j]!) < 1e-9), `row ${r} is the midpoint of captures ${r} and ${r + 1}`);
  }
  // No allocation: the same arrays are filled in place.
  const keep = rows[4];
  barbaRows(caps, rows);
  check(rows[4] === keep, 'barbaRows writes in place');

  // The brain's rows start parked and barbaRows fills them.
  const b = brain();
  eq(b.rows.length, BARBA_PART_COUNT, 'brain: ten rows');
  eq(b.rows[0]![0], BARBA_ROW_PARK, 'brain: rows park at 9984');
}

// --- part hit targets (render/combat.ts routes a part's strike to hitPart) ----------------

{
  eq(BARBA_PART_RADIUS, 50, 'part box radius 50.0 (0x004ba2d8)');
  const b = brain();
  const part = new BarbaPartAi(b, 3);
  check(!part.untargetable, 'a part is targetable while the body lives');
  b.rows[3] = [12, 34, -56];
  const f = part.tick();
  eq(f.x, 12, 'a part stands at its row (x)');
  eq(f.z, -56, 'a part stands at its row (z)');
  const before = b.parts[3]!.pool;
  eq(part.hit(500), 'part', 'a part hit goes to the part pool');
  eq(b.parts[3]!.pool, before - 500, 'a part hit takes its damage off the part pool');
  eq(b.parts[2]!.pool, before, 'a part hit leaves the other parts alone');
  b.kill();
  check(part.untargetable, 'a part is not a target once the body is dead');
}

// --- motion chains against the real frame counts --------------------------------------------

{
  const data = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
  const gslPath = join(data, 'data.gsl');
  if (!existsSync(gslPath)) {
    console.log('SKIP motion chains: no data.gsl (set PSOBB_DATA)');
  } else {
    const gsl = new GSLArchive(new Uint8Array(readFileSync(gslPath)));
    const name = 'bm_boss7_de_rol_le_c.bml';
    const arch = new EnemyArchive(name, gsl.get(name), 6);
    const nodes = arch.nodeCount(0);
    for (let s = 0; s < BARBA_SLOTS.length; s++) {
      const row = BARBA_SLOTS[s]!;
      const frames = arch.motion(row.motion, nodes).frameCount;
      check(frames > 0, `slot ${s}: motion ${row.motion} has frames`);
      const ticks = Math.ceil(frames / row.speed);
      const b = brain();
      b.applyRemote(0x13, 0, null); // a state with a slot; then pin the slot under test
      b.slot = s;
      b.current = null;
      let guard = 0;
      // Mode 2 chains to `next` when the motion ends; the brain never stalls.
      for (let n = 0; n < ticks + 2; n++) b.tick([], n === ticks);
      guard++;
      check(guard === 1, `slot ${s}: the chain loop finished`);
      if (row.mode === 2) check(b.slot === row.next || b.slot === s, `slot ${s}: a mode 2 motion chains to ${row.next}`);
    }
  }
}

// --- the mode 2 chain alone (no archive) -------------------------------------------------------

{
  const b = brain();
  b.slot = 4; // fjump, mode 2 -> 1
  b.tick([], true);
  eq(b.slot, 1, 'mode 2 chain: fjump ends into forward (slot 1)');
}

// --- spawner tables and the Pig Ray minion (client/src/combat/barbaminion.ts) -----------------

eq(BARBA_PIG_COUNT.length, 9, 'spawner count row: 9 indexes');
eq(BARBA_PIG_COUNT.filter((c) => c !== 0).length, 5, 'spawner row 0: five live indexes (0,2,4,6,8)');
eq(barbaPigMode(1), 0, 'count 1 -> mode 0');
eq(barbaPigMode(2), 1, 'count 2 -> mode 1');
eq(BARBA_PIG_DEST.length, 4, 'four destination groups');
eq(BARBA_PIG_DEST[0]!.length, 9, 'group 0: nine destinations');
eq(BARBA_PIG_DEST[0]![0]!.join(), '72,12,60', 'group 0 index 0 at (72, 12, 60)');
eq(BARBA_PIG_HEADING[0], 0xc000, 'group 0 heading 0xC000 (BAMS)');
{
  const b = brain();
  b.applyRemote(0x3a, 0, null);
  const live: number[] = [];
  for (let n = 0; n < 80; n++) {
    b.tick([], false);
    for (const e of b.drain()) if (e.kind === 'spawn' && e.count !== 0) live.push(e.index);
  }
  eq(live.join(), '0,2,4,6,8', 'spawner: only the nonzero count indexes spawn');
}

const pig = (over: Partial<ConstructorParameters<typeof PigRayAi>[0]> = {}) =>
  new PigRayAi({ x: 0, z: 0, angle: 0, mode: 1, frames: 30, speed: 0, rng: () => 0, ...over });
const pigEvents = (b: PigRayAi, out: PigEvent[]) => out.push(...b.drain());

{
  // Appear: timer = frames - 10 = 20; it leaves appear when the timer goes below 0 (tick 21).
  const p = pig();
  let aimTick = -1;
  for (let n = 1; n <= 30 && aimTick < 0; n++) {
    p.tick([]);
    if (p.phase === PIG_STATE.aim) aimTick = n;
  }
  eq(aimTick, 21, 'pig appear: aim at tick 21 (frames 30 - 10 = 20 timer)');
  const ev: PigEvent[] = [];
  pigEvents(p, ev);
  check(ev.some((e) => e.kind === 'se' && e.id === PIG_SE.appearMode1), 'pig appear: mode 1 shout (0x3f2)');
}
{
  // Mode 0 shouts 0x3f1 on leaving appear.
  const p = pig({ mode: 0, frames: 10 });
  const ev: PigEvent[] = [];
  for (let n = 0; n < 12; n++) {
    p.tick([]);
    pigEvents(p, ev);
  }
  check(ev.some((e) => e.kind === 'se' && e.id === PIG_SE.appearMode0), 'pig mode 0: shout 0x3f1');
}
{
  // Advance: heading east (rng 0, speed 0 -> velocity (1, 0)); the aura starts on entry.
  const p = pig();
  const ev: PigEvent[] = [];
  for (let n = 0; n < 25; n++) {
    p.tick([]);
    pigEvents(p, ev);
  }
  eq(p.phase, PIG_STATE.advance, 'pig: advancing after aim');
  check(p.x > 0 && Math.abs(p.z) < 1e-9, 'pig: the velocity moves it along x');
  check(ev.some((e) => e.kind === 'effect' && e.id === PIG_FX.aura), 'pig: aura on advance (0x20b)');
}
{
  // The clamp: old x past 75 refuses the move, the pig holds.
  const p = pig({ x: 80, frames: 0 });
  for (let n = 0; n < 4; n++) p.tick([]);
  eq(p.phase, PIG_STATE.hold, 'pig: x past 75 refuses the move -> hold');
  eq(p.anim, 4, 'pig: hold sets the animation code 4');
}
{
  // Latch: mode 1 hits the first alive target once; mode 0 never hits; the dead are skipped.
  const targets = [
    { clientId: 1, x: 0, z: 0, charClass: 0, dead: true },
    { clientId: 2, x: 0, z: 0, charClass: 0, dead: false },
  ];
  // Latching runs in advance (2) and hold (3): the pig is driven to advance first.
  const m1 = pig({ frames: 0 });
  for (let n = 0; n < 3; n++) m1.tick([]);
  eq(m1.phase, PIG_STATE.advance, 'pig latch: reached advance');
  const first = m1.tick(targets);
  eq(m1.latched.join(), '2', 'pig latch: the dead target is skipped');
  eq(first.hit?.clientId, 2, 'pig mode 1: the latch attacks the new target');
  eq(m1.tick(targets).hit, null, 'pig latch: a latched target is not hit again');
  const m0 = pig({ frames: 0, mode: 0 });
  for (let n = 0; n < 3; n++) m0.tick([]);
  check(m0.tick(targets).hit === null, 'pig mode 0: no attack');
  eq(m0.latched.join(), '2', 'pig mode 0 still latches');
}
{
  // Kill: dying (SE 0x3f5, anim 1), then dead after PIG_DEATH_TICKS with the death effects.
  const p = pig({ frames: 0 });
  p.kill();
  const ev: PigEvent[] = [];
  p.tick([]);
  pigEvents(p, ev);
  eq(p.anim, 1, 'pig kill: animation code 1 (dying)');
  check(ev.some((e) => e.kind === 'se' && e.id === PIG_SE.death), 'pig kill: death SE 0x3f5');
  for (let n = 0; n < PIG_DEATH_TICKS + 4; n++) {
    p.tick([]);
    pigEvents(p, ev);
  }
  eq(p.dead, true, 'pig: dead after the death countdown');
  eq(ev.filter((e) => e.kind === 'dead').length, 1, 'pig: one dead event');
  check(ev.some((e) => e.kind === 'effect' && e.id === PIG_FX.deathA) && ev.some((e) => e.kind === 'effect' && e.id === PIG_FX.deathB), 'pig: death sparks 0x20d / 0x20e');
}

// --- body movement (asm 0x004b1e58, 0x004b416c, 0x004b41ac, 0x004b3c2c, 0x004b0ee0) ---

const near = (a: number, b: number, msg: string) => check(Math.abs(a - b) < 1e-6, `${msg}: got ${a}, want ${b}`);
const finite = (b: BarbaRayAi) => Number.isFinite(b.x) && Number.isFinite(b.z) && Number.isFinite(b.lift) && Number.isFinite(b.yaw);
const runTicks = (b: BarbaRayAi, n: number) => {
  for (let i = 0; i < n; i++) b.tick([]);
};
{
  // Teleports: every anchor lands at its (x, y, z); the lift and heading reset; inside the arena.
  const b = brain({ leader: false });
  for (let i = 0; i < BARBA_ANCHORS.length; i++) {
    const w = b.warps;
    b.teleport(i);
    const a = BARBA_ANCHORS[i]!;
    eq(b.x, a[0], `teleport ${i}: x`);
    eq(b.y, a[1], `teleport ${i}: y`);
    eq(b.z, a[2], `teleport ${i}: z`);
    eq(b.warps, w + 1, `teleport ${i}: warps`);
    check(Math.abs(b.x) <= 205 && Math.abs(b.z) <= 528, `teleport ${i}: inside the arena`);
  }
  b.lift = 9;
  b.teleport(0);
  eq(b.lift, 0, 'teleport zeroes the lift');
  eq(b.yaw, 0, 'teleport zeroes the heading');
}
{
  // Side entry (0x004b416c) from the 0x13 enter: side 0 at x -100 heading +0x500, side 1 at +100 heading -0x500.
  const b = brain({ leader: false });
  b.side = 0;
  b.applyPhase(BARBA_PHASE.run0, null);
  eq(b.x, -BARBA_SIDE_ENTRY.x, '0x13 side 0: x -100');
  eq(b.z, BARBA_SIDE_ENTRY.z, '0x13 side 0: z 10');
  eq(b.lift, BARBA_SIDE_ENTRY.lift, '0x13 side 0: lift 4');
  eq(b.yaw, 0x500, '0x13 side 0: heading +0x500');
  eq(b.slot, 9, '0x13 side 0: slot 9');
  const c = brain();
  c.side = 1;
  c.applyPhase(BARBA_PHASE.run2, null);
  eq(c.x, BARBA_SIDE_ENTRY.x, '0x14 side 1: x +100');
  eq(c.yaw, -0x500, '0x14 side 1: heading -0x500');
  eq(c.slot, 10, '0x14 side 1: slot 10');
  // The root stands still while the followers work (0x13 moves no body).
  const x0 = b.x;
  runTicks(b, 60);
  eq(b.x, x0, '0x13: the body does not move in the wait');
}
{
  // Path followers (0x13): 41 wait ticks, then one target every 180 ticks, then the arrival wait.
  const b = brain({ leader: false });
  b.side = 0;
  b.applyPhase(BARBA_PHASE.run0, null);
  runTicks(b, 40);
  eq(b.moveSub, 0, 'followers: the wait holds for 41 ticks');
  runTicks(b, 1);
  eq(b.moveSub, 1, 'followers: sub 1 after the 41-tick wait');
  runTicks(b, 179);
  eq(b.followers[0]!.moving, false, 'followers: no target before the 180-tick interval');
  runTicks(b, 1);
  check(b.followers[0]!.moving && b.followers[0]!.speed === 120, 'followers: follower 0 sent at 180 ticks, speed 120');
  eq(b.arcSub, 1, 'followers: the next index');
  // rng 0.5: the random point is 60 out at angle pi, i.e. (-60, 0, ~0), within 120 of the centre.
  near(b.followers[0]!.tx, -60, 'followers: random point x (120 * 0.5, angle pi)');
  check(Math.hypot(b.followers[0]!.tx, b.followers[0]!.tz) <= BARBA_FOLLOW.radius + 1e-9, 'followers: random point within 120');
  runTicks(b, 180 * 3);
  eq(b.moveSub, 2, 'followers: all four sent, then the arrival wait');
  runTicks(b, 30);
  check(b.followers.every((f) => f.arrived), 'followers: all four arrive');
  runTicks(b, 1);
  eq(b.moveSub, 3, 'followers: sub 3 once they arrive');
}
{
  // A live player target takes the followers to its position (FUN_00520f04).
  const b = brain({ leader: false });
  b.side = 0;
  b.targetId = 2;
  b.applyPhase(BARBA_PHASE.run0, null);
  const targets = [{ clientId: 2, x: 50, z: -30, charClass: 0, dead: false }];
  for (let n = 0; n < 41 + 180; n++) b.tick(targets);
  eq(b.followers[0]!.tx, 50, 'followers: the player target x');
  eq(b.followers[0]!.tz, -30, 'followers: the player target z');
}
{
  // Follower speed: 1..599 is kept, anything else is 120 (FUN_004bd190).
  const f = new BarbaFollower();
  f.set(0, 0, 0, 0);
  eq(f.speed, 120, 'follower speed 0 -> 120');
  f.set(0, 0, 0, 600);
  eq(f.speed, 120, 'follower speed 600 -> 120');
  f.set(0, 0, 0, 599);
  eq(f.speed, 599, 'follower speed 599 kept');
}
{
  // Swim (0x15, side 0): the first frame's numbers from the asm.
  const b = brain({ leader: false });
  b.side = 0;
  b.applyPhase(BARBA_PHASE.wall0, null);
  eq(b.f750, -1, 'swim side 0: dir -1');
  eq(b.f758, BARBA_SWIM.vz0, 'swim: vz starts at -1');
  eq(b.f744, BARBA_SWIM.speed0, 'swim: speed 0x500');
  check((b.flags & 4) !== 0, 'swim: gate block on');
  b.tick([]);
  eq(b.f744, 1536, 'swim frame 1: speed +256');
  near(b.f74c, 0.08, 'swim frame 1: vx += 0.08');
  near(b.f754, 0.2, 'swim frame 1: vy += 0.2');
  near(b.f758, -0.9, 'swim frame 1: vz += 0.1');
  near(b.x, -100.08, 'swim frame 1: x += dir * vx');
  near(b.z, 9.8, 'swim frame 1: z -= vy');
  near(b.lift, 4.9, 'swim frame 1: lift -= vz');
  eq(b.yaw, 1536, 'swim frame 1: heading -dir * speed');
  eq(b.y, 0, 'swim: the height (+0x3c) is not touched');
}
{
  // Swim bounds: the speed clamps at 16384, the body leaves by a teleport at lift < -137,
  // the rise brings the lift back to 0.
  const b = brain({ leader: false });
  b.side = 0;
  b.applyPhase(BARBA_PHASE.wall0, null);
  let exitAt = -1;
  let speedAt = -1;
  for (let n = 1; n <= 150; n++) {
    const w = b.warps;
    b.tick([]);
    if (speedAt < 0 && b.f744 === BARBA_SWIM.speedMax) speedAt = n;
    check(b.f744 <= BARBA_SWIM.speedMax, `swim: speed <= 16384 at frame ${n}`);
    check(finite(b), `swim: finite at frame ${n}`);
    if (b.warps > w && exitAt < 0) {
      exitAt = n;
      eq(b.x, BARBA_ANCHORS[0]![0], 'swim exit: teleported to anchor 0 (x)');
      eq(b.z, BARBA_ANCHORS[0]![2], 'swim exit: teleported to anchor 0 (z)');
      eq(b.lift, BARBA_SWIM.exitLift, 'swim exit: lift at -137 after the teleport');
      eq(b.slot, 1, 'swim exit: slot 1 (idle)');
      eq(b.moveSub, 1, 'swim exit: sub 1 (rise)');
    }
  }
  eq(speedAt, 59, 'swim: speed reaches the 16384 clamp at frame 59');
  check(exitAt > 55 && exitAt < 70, `swim: lift falls below -137 around frame 63 (got ${exitAt})`);
  eq(b.moveSub, 2, 'swim: the rise ends (sub 2)');
  eq(b.lift, 0, 'swim: lift back at 0 after the rise');
}
{
  // Side 1 swim: dir +1, the body goes to +x, the heading is negative.
  const b = brain({ leader: false });
  b.side = 1;
  b.applyPhase(BARBA_PHASE.wall2, null);
  eq(b.f750, 1, 'swim side 1: dir +1');
  eq(b.x, BARBA_SIDE_ENTRY.x, 'swim side 1: starts at +100');
  eq(b.slot, 10, 'swim side 1: slot 10');
  b.tick([]);
  near(b.x, 100.08, 'swim side 1: x += dir * vx');
  eq(b.yaw, -1536, 'swim side 1: heading -1536');
}
{
  // Leave of the swim clears the gate block (+0x630 bit 2).
  const b = brain({ leader: false });
  b.side = 0;
  b.applyPhase(BARBA_PHASE.wall0, null);
  check((b.flags & 4) !== 0, 'swim enter sets the gate block');
  b.applyPhase(BARBA_PHASE.run0, null);
  eq(b.flags & 4, 0, 'swim leave clears the gate block');
}
{
  // Arc (phase 4, side 0, asm 0x004b0ee0; Ghidra dispatch (0, 2)): the enter teleports to
  // anchor 0; the sub-states follow the timer marks 10 / 20 / 28 / 45 / 46 (exe 0x906fb8) / 64.
  const b = brain({ leader: false });
  b.side = 0;
  b.applyPhase(4, null);
  eq(b.slot, 5, 'arc side 0: slot 5');
  eq(b.f74c, -1, 'arc side 0: dir -1');
  eq(b.x, BARBA_ANCHORS[0]![0], 'arc enter: anchor 0 x');
  eq(b.z, BARBA_ANCHORS[0]![2], 'arc enter: anchor 0 z');
  b.tick([]);
  eq(b.moveSub, 1, 'arc: the wait is one frame');
  let n = 0;
  while (b.arcSub === 0 && n < 50) {
    b.tick([]);
    n++;
  }
  eq(b.arcSub, 1, 'arc: sub 1 at timer 10');
  near(b.f75c, (65 / 20) * -1, 'arc sub 1: vx = (65/20) * dir');
  while (b.arcSub === 1 && n < 80) {
    b.tick([]);
    n++;
  }
  eq(b.arcSub, 2, 'arc: sub 2 at timer 20');
  near(b.f75c, (-90 / 16) * -1, 'arc sub 2: vx = (-90/16) * dir');
  while (b.arcSub === 2 && n < 120) {
    b.tick([]);
    n++;
  }
  eq(b.arcSub, 3, 'arc: sub 3 at timer 28');
  while (b.arcSub === 3 && n < 160) {
    b.tick([]);
    n++;
  }
  eq(b.arcSub, 4, 'arc: sub 4 at timer 45');
  check(b.arcStarted && b.arcEase.max === 7 && b.arcEase.accel === 0.2 && b.arcEase.decel === 0.05, 'arc sub 3: the easing 00434ac4(7, |25 - z|, 0.2, 0.05)');
  near(b.f75c, (-30 / 2) * -1, 'arc sub 4: vx = (-30/2) * dir');
  while (b.arcSub === 4 && n < 220) {
    b.tick([]);
    n++;
    check(finite(b), `arc: finite at tick ${n}`);
  }
  eq(b.arcSub, 5, 'arc: sub 5 at timer 46');
  while (b.moveSub === 1 && n < 400) {
    b.tick([]);
    n++;
    check(Math.abs(b.x) < 1000 && Math.abs(b.z) < 2000, `arc: bounded at tick ${n}`);
  }
  eq(b.moveSub, 2, 'arc: done (sub 6 returns 3) after the timer passes 64');
}
{
  // Arc on side 1 teleports to anchor 1 (0, 7, 500) and runs dir +1.
  const b = brain({ leader: false });
  b.side = 1;
  b.applyPhase(0x0a, null);
  eq(b.slot, 6, 'arc side 1: slot 6');
  eq(b.f74c, 1, 'arc side 1: dir +1');
  eq(b.x, BARBA_ANCHORS[1]![0], 'arc side 1: anchor 1 x');
  eq(b.z, BARBA_ANCHORS[1]![2], 'arc side 1: anchor 1 z');
}

// --- corner transitions (0x004b1e98: phases 3, 5, 6, 8, 9, 0xb, 0xc, 0xe and 0x28 .. 0x39) --
{
  // 0x03 (anchor 0 -> 1): the enter teleports to anchor 0 (one warp), the signs are (+, 0, +),
  // the curves are the low ones (max 3 / 0.08 in x, 5 / 0.08 in z for sign z > 0), sub 1.
  const b = brain({ leader: false });
  const ex = b.ex;
  const w = b.warps;
  b.applyPhase(3, null);
  eq(b.phase, 3, 'transition 3: phase');
  eq(b.warps, w + 1, 'transition 3: the enter is one warp');
  eq(b.x, BARBA_ANCHORS[0]![0], 'transition 3: teleport to anchor 0 x');
  eq(b.z, BARBA_ANCHORS[0]![2], 'transition 3: teleport to anchor 0 z');
  eq(b.sgnX, 1, 'transition 3: x sign +1');
  eq(b.sgnY, 0, 'transition 3: y sign 0 (both at height 7)');
  eq(b.sgnZ, 1, 'transition 3: z sign +1');
  eq(b.tSub, 1, 'transition 3: sub 1 (to anchor 1, y level)');
  near(b.ex.dist, 175, 'transition 3: x distance 175');
  near(b.ez.dist, 475, 'transition 3: z distance 475');
  eq(b.ex.max, 3, 'transition 3: x max 3');
  eq(b.ez.max, 5, 'transition 3: z max 5 (afc, sign +)');
  let n = 0;
  let warpsDuring = 0;
  while (b.moveSub === 0 && n < 400) {
    const w2 = b.warps;
    b.tick([]);
    warpsDuring += b.warps - w2;
    n++;
    check(Number.isFinite(b.x) && Number.isFinite(b.z), `transition 3: finite at tick ${n}`);
  }
  check(b.moveSub === 1, 'transition 3: done within 400 ticks');
  check(n > 100 && n < 260, `transition 3: the walk takes 100..260 ticks (got ${n})`);
  eq(warpsDuring, 0, 'transition 3: no warp during the walk');
  check(Math.abs(b.x - BARBA_ANCHORS[1]![0]) < 2 && Math.abs(b.z - BARBA_ANCHORS[1]![2]) < 1e-6, `transition 3: ends at anchor 1 (got ${b.x}, ${b.z})`);
  check(ex === b.ex, 'transition: the easing records are reused (no allocation per transition)');
}
{
  // 0x28 from anchor 0 goes to anchor 5 (-205, -100, 25): a drop, so sub 4 (the settle) and
  // the volopt flag 0x400 off, the SE 0x3e9 (sign y < 0 takes the else branch: flag on, SE 1000).
  const b = brain({ leader: false });
  b.applyPhase(0x28, null);
  eq(b.tSub, 4, 'transition 0x28: a y move is sub 4');
  check((b.flags & 0x400) !== 0, 'transition 0x28: a drop sets flag 0x400');
  check(b.drain().some((e) => e.kind === 'se' && e.id === 1000), 'transition 0x28: SE 1000 on the drop');
  let n = 0;
  while (b.moveSub === 0 && n < 400) {
    b.tick([]);
    n++;
  }
  check(b.moveSub === 1, 'transition 0x28: done within 400 ticks');
  check(Math.abs(b.y - BARBA_ANCHORS[5]![1]) < 1e-6 && Math.abs(b.x - BARBA_ANCHORS[5]![0]) < 2, `transition 0x28: lands on anchor 5 (got ${b.x}, ${b.y})`);
  // The next 0x28 starts from anchor 5 (+0x6c8, the leave's `from := to`), so it goes to 0.
  b.applyPhase(0x28, null);
  eq(b.tTo, 0, 'transition 0x28 again: from anchor 5 to anchor 0 (5 > 4 is 5 - 5)');
}
{
  // Phases 5 / 6 are transitions (0 -> 3 and 1 -> 2), not the arc (the arc is 4 / 0xa).
  const b = brain({ leader: false });
  b.applyPhase(5, null);
  eq(b.tTo, 3, 'phase 5: anchor 0 to 3');
  eq(b.x, BARBA_ANCHORS[0]![0], 'phase 5: teleport to anchor 0');
  eq(b.arcStarted, false, 'phase 5: no arc');
  b.applyPhase(6, null);
  eq(b.tTo, 2, 'phase 6: anchor 1 to 2');
  eq(b.x, BARBA_ANCHORS[1]![0], 'phase 6: teleport to anchor 1');
}
{
  // The leader's next table step after a transition: a closed gate waits BARBA_DWELL ticks.
  const b = brain({ leader: true });
  b.applyPhase(3, null);
  let n = 0;
  while (b.moveSub === 0 && n < 400) {
    b.tick([]);
    n++;
  }
  b.drain();
  let sent = -1;
  for (let k = 1; k <= BARBA_DWELL + 5 && sent < 0; k++) {
    b.tick([]);
    if (sends(b.drain()).length > 0) sent = k;
  }
  check(sent >= BARBA_DWELL - 2 && sent <= BARBA_DWELL + 2, `transition done, gate closed: the next step after the dwell (got ${sent})`);
}
{
  // A side entry (0x13 / 0x15 enter, FUN_004b416c) jumps: one warp.
  const b = brain({ leader: false });
  const w = b.warps;
  b.applyPhase(BARBA_PHASE.run0, null);
  eq(b.warps, w + 1, 'side entry: one warp (the body jumps to the side)');
}
{
  // The gate-open leader steps the table at once when the transition is done (event 9).
  const b = brain({ leader: true });
  b.bodyHp = 0; // gateOpen: the pool is empty and the gate block is clear
  b.applyPhase(3, null);
  // The first send comes when the walk is done (about 200 ticks), not on the 30-tick pace.
  let sentTick = -1;
  for (let k = 0; k < 400 && sentTick < 0; k++) {
    b.tick([]);
    if (sends(b.drain()).length > 0) sentTick = k;
  }
  check(sentTick > 150 && sentTick < 260, `gate open: the step follows the done walk, not the pace (sent at ${sentTick})`);
}
// --- phase 0x0d (0x004b7040, the fall, the drop's sub-states and the rise) ---------------
{
  // Enter (event 4): the body to anchor 3 (one warp), the gate block set, 0x100 cleared,
  // the slot 1 (the exe writes 1 first).
  const b = brain({ leader: false });
  const w = b.warps;
  b.applyPhase(BARBA_PHASE.drop, null);
  eq(b.warps, w + 1, 'drop enter: one warp');
  eq(b.tFrom, 3, 'drop enter: 0x6c8 = 3');
  eq(b.x, BARBA_ANCHORS[3]![0], 'drop enter: x of anchor 3');
  eq(b.z, BARBA_ANCHORS[3]![2], 'drop enter: z of anchor 3');
  check((b.flags & 4) !== 0 && (b.flags & 0x100) === 0, 'drop enter: flags 4 set, 0x100 clear');
  eq(b.slot, 1, 'drop enter: slot 1');
  // The fall: 20 ticks keep sub 0; the 21st moves to sub 1 and writes slot 4.
  for (let k = 0; k < 20; k++) b.tick([]);
  eq(b.moveSub, 0, 'drop fall: sub 0 for 20 ticks');
  const zBefore = b.z;
  b.tick([]);
  eq(b.moveSub, 1, 'drop fall: sub 1 at tick 21');
  eq(b.slot, 4, 'drop fall: slot 4 after the fall');
  // The speed: -0.2 a tick, so 21 ticks reach -4.2 and z dropped by sum(-0.2 k) = -(0.2 * 21 * 22 / 2).
  near(b.f754, -4.2, 'drop fall: speed -0.2 a tick');
  near(b.z - zBefore, -0.2 * 21, 'drop fall: z moves with the last speed only (tick 21)');
  // The blend (asm 0x007a9a6c type 4, 0x007aa369 wrap): the id change starts it on the next
  // Player__Animate (tick 22); the clock (0.6 a tick in slot 1) is past 1.0 by then, so it wraps at once:
  // clock 0, stride 0.3, and sub 1 ends on the same tick.
  b.tick([]);
  const pa = b as unknown as { moveSub: number; timer: number; animStride: number };
  eq(pa.moveSub, 2, 'drop blend: sub 1 ends on the wrap tick (tick 22)');
  near(pa.timer, 0, 'drop blend: the clock is 0 after the wrap');
  near(pa.animStride, 0.3, 'drop blend: the stride is slot 4 (0.3) after the wrap');
  // The leader's table step waits for sub 3 (the done state): a follower never steps.
  let done = -1;
  for (let k = 0; k < 3000 && b.moveSub !== 3; k++) {
    b.tick([]);
    if (b.moveSub === 3) done = k;
  }
  check(b.moveSub === 3, `drop: reaches sub 3 (done) within 3000 ticks (got ${b.moveSub})`);
  check(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z) && Number.isFinite(b.lift), 'drop: the body stays finite');
  check(sends(b.drain()).length === 0, 'drop: a follower sends nothing');
  void done;
}
{
  // The drop's z after sub 3 (asm 0x004b7040 at 0x4b7455..0x4b74c7, 0x42cdc0, 0x434ac4): when the speed
  // is <= 0 the easing starts from the body's z (speed = z), with max 7, dist |500 - z|, accel 0.2,
  // decel 0.05; each tick z = speed - pos (fsub [0x690]) while the easing returns not-done, then z is
  // not written again. The easing's pos is unsigned (ApplyVelocityEasing adds v >= 0), so z only falls
  // from the apex. PROVEN for the sign and the shape; the apex (the speed at the rise) is the clock's
  // output (ASSUMED 1 a tick, see docs/bosses/barbaray-map.md Pass 11).
  const b = brain({ leader: false });
  b.applyPhase(BARBA_PHASE.drop, null);
  let guard = 0;
  let peak = -Infinity;
  let zMin = Infinity;
  while (b.moveSub !== 3 && guard++ < 3000) {
    b.tick([]);
    peak = Math.max(peak, b.z);
    zMin = Math.min(zMin, b.z);
  }
  check(b.moveSub === 3, `drop z: reaches sub 3 (got ${b.moveSub})`);
  // The exe's drop (map Pass 13, the blend's wrap resets the clock at sub 0 -> 1): the fall runs 21 ticks
  // then 35 more to the rise (z -521 at tick 57, the bottom -528 at tick 60). The rise peaks near 672: the
  // design's z0 = 300 is the rise formula's target, not the apex (the sub 3 halving leaves a speed of ~11
  // that the 0.2 decel spends above it). The easing lands on z 500 (anchor 1) for any apex above 500.
  check(zMin > -545 && zMin < -515, `drop z: the fall bottoms near -528 (got ${zMin})`);
  check(peak > 600 && peak < 700, `drop z: the rise peaks near 672, above 600 (got ${peak})`);
  const apex = b.f754;
  check(b.ez.max === 7 && b.ez.accel === 0.2 && Math.abs(b.ez.decel - 0.05) < 1e-6, 'drop z: easing max 7, accel 0.2, decel 0.05 (0x4b7485..8d)');
  check(Math.abs(b.ez.dist - Math.abs(500 - apex)) < 1e-6, `drop z: easing dist |500 - apex| (${b.ez.dist})`);
  check(b.ez.pos >= 0, 'drop z: the easing pos is unsigned (ApplyVelocityEasing)');
  // Settled: once sub 3 is set, z stays put for many ticks (the easing is done, no more z writes).
  const zDone = b.z;
  let moved = 0;
  for (let k = 0; k < 50; k++) {
    const z0 = b.z;
    b.tick([]);
    if (b.z !== z0) moved++;
  }
  eq(moved, 0, 'drop z: z is settled after sub 3 (no tick moves it)');
  near(b.z, zDone, 'drop z: the settled z is the one sub 3 reached');
  // The last write is z = apex - pos (0x4b74c1): the settled z is the apex minus the easing's pos.
  near(b.z, apex - b.ez.pos, 'drop z: settled z = apex - easing pos (0x4b74c1 fsub [0x690])');
  check(Math.abs(b.z - 500) < 0.5, `drop z: the body lands on z 500 (anchor 1), got ${b.z}`);
}
{
  // The fall's speed clamp (906e74 = -7) is never reached in the fall: 21 ticks at -0.2 give -4.2.
  const b = brain({ leader: false });
  b.applyPhase(BARBA_PHASE.drop, null);
  let minV = 0;
  for (let k = 0; k < 21; k++) {
    b.tick([]);
    minV = Math.min(minV, b.f754);
  }
  check(minV >= -7 - 1e-9 && minV > -4.3, `drop: the fall speed stays above -4.2 (min ${minV})`);
  // The rise speed (sub 0 -> 1, asm 0x004b7040): ((A + B) * -vy + (300 - z)) / ((0.5 A + B) A), A = 18.333
  // (a47a9c), B = 30.769 (a47a98). The clock reaches 10.5 (0x906cf0) on the 35th tick at a stride of 0.3
  // (fall 21 ticks + 14 ticks of the sub 2 wait; the speed reaches -7 there), so the rise starts then.
  const b2 = brain({ leader: false });
  b2.applyPhase(BARBA_PHASE.drop, null);
  let tr = -1;
  let expect = NaN;
  for (let k = 0; k < 200 && tr < 0; k++) {
    const vPrev = b2.f754;
    const zPrev = b2.z;
    b2.tick([]);
    if ((b2 as unknown as { dropSub: number }).dropSub === 1) {
      tr = k;
      expect = ((BARBA_DROP.attackA + BARBA_DROP.attackB) * -vPrev + (BARBA_DROP.z0 - zPrev)) / ((0.5 * BARBA_DROP.attackA + BARBA_DROP.attackB) * BARBA_DROP.attackA);
    }
  }
  // The blend wrap (sub 0 -> 1, tick 22) resets the clock to 0; sub 2 then starts and the clock
  // reaches 10.5 (0x906cf0) on the 35th tick at a stride of 0.3: the rise starts at tick 57 (k = 56).
  check(tr === 56, `drop sub 0 -> 1: the clock reaches 10.5 on the 35th tick after the blend (got k ${tr})`);
  check(Math.abs(b2.f758 - expect) < 1e-9, `drop sub 0 -> 1: rise speed with the static-init A and B (got ${b2.f758}, want ${expect})`);
}
{
  // The static init (0x004b99a0, PROVEN): a47aa0 = 0.195, a47a98 = 6 / 0.195, a47a9c = 18.333.
  near(BARBA_DROP.liftZero, 0.195, 'drop constants: a47aa0 = 0.195');
  near(BARBA_DROP.attackB, 6 / 0.195, 'drop constants: a47a98 = 6.0 / a47aa0');
  check(Math.abs(BARBA_DROP.attackA - 18.333332) < 1e-6, `drop constants: a47a9c = 18.333 (got ${BARBA_DROP.attackA})`);
  // The clock (+0xc0) steps by the stride (+0xc8, 0.3 ASSUMED) on each drop tick (Player__Animate). In
  // the lift (734 == 2) the sub-state also takes 0.3 - 0.195 off (asm 0x004b7040 fsub a47aa0), so the
  // net step is the lift zero 0.195 and the span 16..22 lasts 6 / 0.195 = 30.77 ticks (= B).
  const b = brain({ leader: false });
  b.applyPhase(BARBA_PHASE.drop, null);
  let lift = 0;
  let other = 0;
  for (let k = 0; k < 400 && b.moveSub !== 3; k++) {
    const t0 = b.timer;
    const sub = (b as unknown as { dropSub: number }).dropSub;
    const inLift = b.moveSub === 2 && sub === 2;
    b.tick([]);
    const d = b.timer - t0;
    if (inLift && Math.abs(d - 0.195) < 1e-9) lift++;
    else if (!inLift && b.moveSub === 2 && Math.abs(d - 0.3) < 1e-9) other++;
  }
  check(lift >= 29 && lift <= 32, `drop sub 2: the lift steps the clock 0.195 a tick, about 30.77 ticks (got ${lift})`);
  check(other >= 1, `drop: the other sub-states step the clock by the stride 0.3 (got ${other})`);
}
{
  // Leader with the gate open: the table steps once the drop is done (event 9), not on the pace.
  const b = brain({ leader: true });
  b.bodyHp = 0; // gateOpen
  b.applyPhase(BARBA_PHASE.drop, null);
  let sentTick = -1;
  for (let k = 0; k < 3000 && sentTick < 0; k++) {
    b.tick([]);
    if (sends(b.drain()).length > 0) sentTick = k;
  }
  check(sentTick > 20, `drop: the leader's step comes after the fall (sent at ${sentTick})`);
  check(b.moveSub === 3 || b.phase !== BARBA_PHASE.drop, 'drop: the step follows sub 3');
}
{
  // Leave (event 5): 0x6c8 = 1 and the gate block cleared; the next phase applies on top.
  const b = brain({ leader: false });
  b.applyPhase(BARBA_PHASE.drop, null);
  b.applyPhase(1, null);
  eq(b.tFrom, 1, 'drop leave: 0x6c8 = 1');
  check((b.flags & 4) === 0, 'drop leave: gate block cleared');
}
// --- phases 0x0f / 0x10 (0x004b2cd0, the volopt sweep over the part rows) ----------------
{
  // Enter (side 0): the body to anchor 0 (one warp), 0x6c8 = 0, the gate block and 0x100 cleared,
  // the slot 3, and the sweep at point 0. The first tick places point 0 (one 0x3f8 sound).
  const b = brain({ leader: false });
  for (let i = 0; i < 10; i++) b.rows[i] = [0, i * 10, 0];
  b.drain();
  const w = b.warps;
  b.applyPhase(BARBA_PHASE.volopt0, null);
  eq(b.warps, w + 1, 'volopt 0x0f: one warp');
  eq(b.tFrom, 0, 'volopt 0x0f: 0x6c8 = side 0');
  eq(b.x, BARBA_ANCHORS[0]![0], 'volopt 0x0f: x of anchor 0');
  eq(b.slot, 3, 'volopt 0x0f: slot 3');
  check((b.flags & 0x104) === 0, 'volopt 0x0f: gate block and 0x100 clear');
  eq(b.f74c, -1000, 'volopt 0x0f: 0x74c = -1000');
  b.tick([]);
  eq(b.voloptSub, 1, 'volopt 0x0f: sub 1 after the first point');
  const ses0 = b.drain().filter((e) => e.kind === 'se' && e.id === 0x3f8).length;
  eq(ses0, 1, 'volopt 0x0f: point 0 plays 0x3f8');
  // Each tick row i is below row i + 1 (y rises along the rows): the sweep reaches index 4 in four
  // steps, then sub 2.
  let n = 0;
  while (b.voloptSub !== 2 && n < 20) {
    b.tick([]);
    n++;
  }
  eq(b.moveSub, 4, 'volopt 0x0f: the index reaches 4');
  eq(b.voloptSub, 2, 'volopt 0x0f: sub 2 at index 4');
  eq(n, 4, 'volopt 0x0f: four steps (one a tick)');
  const ses = b.drain().filter((e) => e.kind === 'se' && e.id === 0x3f8).length;
  eq(ses, 4, 'volopt 0x0f: the four further points play 0x3f8');
}
{
  // Side 2 (0x10): the anchor 2 and 0x6c8 = 2.
  const b = brain({ leader: false });
  b.applyPhase(BARBA_PHASE.volopt2, null);
  eq(b.tFrom, 2, 'volopt 0x10: 0x6c8 = side 2');
  eq(b.x, BARBA_ANCHORS[2]![0], 'volopt 0x10: x of anchor 2');
}
{
  // A flat spine (every row at the same y) never advances past point 0.
  const b = brain({ leader: false });
  for (let i = 0; i < 10; i++) b.rows[i] = [0, 5, 0];
  b.applyPhase(BARBA_PHASE.volopt0, null);
  for (let k = 0; k < 100; k++) b.tick([]);
  eq(b.moveSub, 0, 'volopt: a flat spine stays at point 0');
  eq(b.voloptSub, 1, 'volopt: a flat spine stays in sub 1');
}
{
  // The kind (+0x70c) cycles 1, 2, 0 over the enters.
  const b = brain({ leader: false });
  const kinds: number[] = [];
  for (let k = 0; k < 3; k++) {
    b.applyPhase(BARBA_PHASE.volopt0, null);
    kinds.push(b.voloptKind);
  }
  eq(kinds.join(','), '1,2,0', 'volopt: the kind cycles 1, 2, 0');
}
{
  // The leader (gate open) steps the table once the sweep is done (event 9).
  const b = brain({ leader: true });
  for (let i = 0; i < 10; i++) b.rows[i] = [0, i * 10, 0];
  b.bodyHp = 0;
  b.applyPhase(BARBA_PHASE.volopt0, null);
  let sentTick = -1;
  for (let k = 0; k < 100 && sentTick < 0; k++) {
    b.tick([]);
    if (sends(b.drain()).length > 0) sentTick = k;
  }
  check(sentTick >= 4 && sentTick <= 6, `volopt: the leader steps when the sweep is done (sent at ${sentTick})`);
}
// --- phase 0x17 (0x004b6d08, the beam_a motion chained into beamwait) --------------------
{
  // Enter: the gate open (0x100 set, 4 clear), the body to anchor 3 (one warp), slot 0xc.
  const b = brain({ leader: false });
  // The idle first (slot 1 started from the spawn's slot 0: no blend), so the beam's id change blends.
  b.applyPhase(0, null);
  b.tick([]);
  const w = b.warps;
  b.applyPhase(BARBA_PHASE.beam, null);
  eq(b.warps, w + 1, 'beam enter: one warp');
  eq(b.tFrom, 3, 'beam enter: 0x6c8 = 3');
  eq(b.slot, 12, 'beam enter: slot 0xc (beam_a)');
  check((b.flags & 4) === 0 && (b.flags & 0x100) !== 0, 'beam enter: gate open (0x100 set, 4 clear)');
  // The beam sound at the clock's crossing of 10.0 (FUN_007aaa30), once. The enter's id change blends
  // on tick 1 (the clock is 0.7 then, below 1.0) and wraps on tick 2 to 0 at beam_a's stride (0.4): the
  // clock is 0.4 * (n - 2) on tick n, and passes 10.0 (10.000000000000004) on the 25th step, tick 27.
  b.drain();
  let se = 0;
  let seTick = -1;
  for (let k = 0; k < 60; k++) {
    b.tick([]);
    const n = b.drain().filter((e) => e.kind === 'se' && e.id === 0x3ec).length;
    if (n && seTick < 0) seTick = k + 1;
    se += n;
  }
  eq(se, 1, 'beam: the 0x3ec sound once at the clock 10.0 crossing');
  eq(seTick, 27, 'beam: the crossing is on tick 27 (blend wrap on tick 2, then 0.4 a tick)');
  // The motion's end chains beam_a (12) into beamwait (15): event 9 is then the table step.
  b.tick([], true);
  eq(b.slot, 15, 'beam: beam_a chains into beamwait (slot 15)');
}
{
  // Straight from the spawn (slot 0, flags 0xc0000000): the id change to beam_a takes the else branch
  // of StartNpc (no blend, no wrap), so the clock keeps the spawn's stride 0.7 and the 10.0 crossing
  // is on tick 15 (10.5). PROVEN for the rule (0x007a9a6c: the old row's 0x40000000 test); the 0.7 is ASSUMED.
  const b = brain({ leader: false });
  b.applyPhase(BARBA_PHASE.beam, null);
  let seTick = -1;
  for (let k = 1; k <= 20 && seTick < 0; k++) {
    b.tick([]);
    if (b.drain().some((e) => e.kind === 'se' && e.id === 0x3ec)) seTick = k;
  }
  eq(seTick, 15, 'beam from the spawn: no blend from slot 0, the clock runs at the spawn stride 0.7');
}
{
  // The leader steps the table once beamwait is reached (the gate open).
  const b = brain({ leader: true });
  b.bodyHp = 0;
  b.applyPhase(BARBA_PHASE.beam, null);
  let sentTick = -1;
  for (let k = 0; k < 200 && sentTick < 0; k++) {
    b.tick([], k === 30);
    if (sends(b.drain()).length > 0) sentTick = k;
  }
  check(sentTick === 30 || sentTick === 31, `beam: the leader steps at beamwait (sent at ${sentTick}; the chain is applied after the leader's step, so 30 or 31)`);
}
// --- phases 0x19 / 0x1a (0x004b4684, the shot: beam_c chained into idle) -----------------------
for (const phase of [0x19, 0x1a]) {
  // Enter: the gate open, the body to anchor 3 (one warp), slot 0xe.
  const b = brain({ leader: false });
  b.applyPhase(0, null); // the idle first (slot 1, no blend from the spawn's slot 0)
  b.tick([]);
  const w = b.warps;
  b.applyPhase(phase, null);
  eq(b.warps, w + 1, `shot ${phase.toString(16)}: one warp`);
  eq(b.tFrom, 3, `shot ${phase.toString(16)}: 0x6c8 = 3`);
  eq(b.slot, 14, `shot ${phase.toString(16)}: slot 0xe (beam_c)`);
  check((b.flags & 4) === 0 && (b.flags & 0x100) !== 0, `shot ${phase.toString(16)}: gate open`);
  b.drain();
  // The blend wraps on tick 2 (the clock 0 there), then 0.4 a tick: 8.000000000000002 on the 20th step,
  // tick 22 (the crossing of 8.0 plays 0x3ed once).
  let se = 0;
  let seTick = -1;
  for (let k = 0; k < 40; k++) {
    b.tick([]);
    const n = b.drain().filter((e) => e.kind === 'se' && e.id === 0x3ed).length;
    if (n && seTick < 0) seTick = k + 1;
    se += n;
  }
  eq(se, 1, `shot ${phase.toString(16)}: the 0x3ed sound once at the clock's 8.0 crossing`);
  eq(seTick, 22, `shot ${phase.toString(16)}: the crossing is on tick 22 (the wrap on tick 2, then 0.4 a tick)`);
  b.tick([], true);
  eq(b.slot, 1, `shot ${phase.toString(16)}: beam_c chains into idle (slot 1)`);
}
{
  // The leader steps at idle (slot 1), the gate open.
  const b = brain({ leader: true });
  b.bodyHp = 0;
  b.applyPhase(0x19, null);
  let sentTick = -1;
  for (let k = 0; k < 200 && sentTick < 0; k++) {
    b.tick([], k === 30);
    if (sends(b.drain()).length > 0) sentTick = k;
  }
  check(sentTick === 30 || sentTick === 31, `shot: the leader steps at idle (sent at ${sentTick})`);
}
// --- dispatch 0 (0x004b9e54, SetEnemyAnimationState): the idle hold ------------------------------
{
  // Enter writes slot 1 and nothing else: the body stays where it is, no state change on a frame.
  const b = brain({ leader: false });
  const x0 = b.x;
  const z0 = b.z;
  const w = b.warps;
  b.applyPhase(0, null);
  eq(b.slot, 1, 'dispatch 0: enter writes slot 1');
  eq(b.warps, w, 'dispatch 0: no warp');
  for (let k = 0; k < 50; k++) b.tick([]);
  eq(b.phase, 0, 'dispatch 0: the frame does not leave the phase by itself (the leader steps it)');
  eq(b.x, x0, 'dispatch 0: x unchanged');
  eq(b.z, z0, 'dispatch 0: z unchanged');
}
// --- phases 0x11 / 0x12 (0x004b30fc, the jump; the leader's keyboard picks the next phase) -----
for (const phase of [0x11, 0x12]) {
  const side = phase === 0x11 ? 0 : 2;
  const dir = side === 0 ? -1 : 1;
  const tag = `jump ${phase.toString(16)}`;
  // Enter: slot 1, the body on anchor `side`, the gate block set, the 0x100 cleared.
  const b = brain({ leader: false });
  b.applyPhase(phase, null);
  eq(b.slot, 1, `${tag}: enter writes slot 1`);
  eq(b.tFrom, side, `${tag}: 0x6c8 = side`);
  eq(b.x, BARBA_ANCHORS[side]![0], `${tag}: x on anchor ${side}`);
  eq(b.z, BARBA_ANCHORS[side]![2], `${tag}: z on anchor ${side}`);
  check((b.flags & 4) !== 0 && (b.flags & 0x100) === 0, `${tag}: gate block set, 0x100 clear`);
  b.drain();
  // The windup: 11 frames of sub 0 (the 11th ends it), the z sinks, then slot 7 / 8 and dir.
  for (let k = 0; k < 10; k++) b.tick([]);
  eq(b.slot, 1, `${tag}: slot 1 through the 10 windup frames`);
  const z0 = b.z;
  b.tick([]);
  eq(b.slot, side === 0 ? 7 : 8, `${tag}: slot 7 (side 0) / 8 at the 11th frame`);
  eq(b.f74c, dir, `${tag}: dir ${dir} (the sub 0 end)`);
  check(b.z < z0 && b.z < BARBA_ANCHORS[side]![2], `${tag}: z sank in the windup`);
  // The sub-states run on the clock (+0xc0): the take-off at 6, the apex at 13, the descent at 20, the
  // landing at 25 (no motion on the landing frame). The slot 7 / 8 blend wraps the clock to 0 on the
  // first tick after the windup (sub 1 ends there, PROVEN), then the clock is stride * (tick - 1) at
  // r_bite's 0.28 (the row speed, slot 7 / 8). The leader is off, so no step.
  const stride = BARBA_SLOTS[side === 0 ? 7 : 8]!.speed;
  const at = (mark: number) => 1 + Math.ceil(mark / stride); // the tick (from the wrap tick) the clock passes it
  let ticks = 0;
  let se: number[] = [];
  let seTick: Record<number, number> = {};
  while (b.moveSub < 6 && ticks < 200) {
    b.tick([]);
    ticks++;
    for (const e of b.drain()) {
      if (e.kind !== 'se') continue;
      se.push(e.id);
      seTick[e.id] ??= ticks;
    }
  }
  eq(b.moveSub, 6, `${tag}: the landing (sub 6) is reached`);
  eq(ticks, at(BARBA_JUMP.t5), `${tag}: the landing at the clock 25 (${at(BARBA_JUMP.t5)} ticks from the wrap)`);
  eq(se.filter((id) => id === 0x3ed).length, 1, `${tag}: 0x3ed once (the 8.5 mark)`);
  eq(se.filter((id) => id === 0x3ec).length, 1, `${tag}: 0x3ec once (the 15.0 mark)`);
  eq(seTick[0x3ec], at(BARBA_JUMP.seAirMark), `${tag}: 0x3ec on the 15.0 crossing tick`);
  eq(se.filter((id) => id === 0x3ee).length, 1, `${tag}: 0x3ee once (the landing)`);
  check((b.flags & 0x200) !== 0, `${tag}: 0x200 set at the landing`);
  // The last motion frame is the one before the landing: the clock is stride * (ticks - 2) there.
  const tLast = stride * (ticks - 2);
  near(b.x, 135 * dir + (-7 * dir) * (tLast - 20), `${tag}: x at the landing frame (the last descent motion, clock ${tLast.toFixed(2)})`);
  // The descent's yaw: -256 * dir a tick, u = clock - 20 on the last descent frame.
  eq(b.yaw, Math.round((tLast - 20) * (-256 * dir)), `${tag}: yaw at the last descent frame`);
  eq(b.f750, 135 * dir, `${tag}: the descent (sub 5) starts from 135 * dir`);
}
// The keyboard (event 2, the leader): Left sends the followers, Right the swim.
for (const side of [0, 2]) {
  for (const [input, want] of [
    [{ left: true, right: false }, side === 0 ? 0x13 : 0x14],
    [{ left: false, right: true }, side === 0 ? 0x15 : 0x16],
    [{ left: true, right: true }, side === 0 ? 0x13 : 0x14],
  ] as const) {
    const b = brain({ leader: true });
    b.applyPhase(side === 0 ? 0x11 : 0x12, null);
    b.drain();
    b.input = { ...input };
    b.tick([]);
    const s = sends(b.drain());
    eq(s.length, 1, `jump ${side}: one send for input ${JSON.stringify(input)}`);
    eq(s[0]?.phase ?? -1, want, `jump ${side}: input ${JSON.stringify(input)} sends ${want.toString(16)}`);
    eq(b.phase, want, `jump ${side}: the phase is ${want.toString(16)} after the send`);
  }
  // Nothing held: no send.
  const n = brain({ leader: true });
  n.applyPhase(side === 0 ? 0x11 : 0x12, null);
  n.drain();
  n.input = { left: false, right: false };
  for (let k = 0; k < 30; k++) n.tick([]);
  eq(sends(n.drain()).length, 0, `jump ${side}: no key, no send`);
  eq(n.phase, side === 0 ? 0x11 : 0x12, `jump ${side}: stays in the jump`);
  // A follower never reads the keyboard.
  const f = brain({ leader: false });
  f.applyPhase(side === 0 ? 0x11 : 0x12, null);
  f.drain();
  f.input = { left: true, right: false };
  f.tick([]);
  eq(sends(f.drain()).length, 0, `jump ${side}: a follower sends nothing on a key`);
}
// Without the keyboard (ASSUMED mode 0) the leader's event 9 steps the table once the bite chain
// reaches its loop (slot 9 after r_bite, slot 10 after l_bite).
{
  const b = brain({ leader: true });
  b.applyPhase(0x11, null);
  b.drain();
  b.input = null;
  for (let k = 0; k < 11; k++) b.tick([]);
  eq(b.slot, 7, 'jump table step: slot 7 after the windup');
  b.tick([], true);
  eq(b.slot, 9, 'jump table step: r_bite chains into bite_rloop (slot 9)');
  b.drain();
  let sentAt = -1;
  for (let k = 0; k < 5 && sentAt < 0; k++) {
    b.tick([]);
    if (sends(b.drain()).length > 0) sentAt = k;
  }
  check(sentAt === 0, `jump table step: the leader steps on the first frame at slot 9 (sent at ${sentAt})`);
}
// Event 5: the gate block is cleared when the jump is left.
{
  const b = brain({ leader: false });
  b.applyPhase(0x11, null);
  check((b.flags & 4) !== 0, 'jump leave: the gate block is set on enter');
  b.applyPhase(0, null);
  check((b.flags & 4) === 0, 'jump leave: event 5 clears the gate block');
}
// --- phase 0x18 (0x004b6300, the player attack: windup, fire, area hit, aura hold) ---------------
{
  const mv = { fparam1: 250, fparam2: 0, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [0, 0, 0, 0, 0, 0] };
  const b = new BarbaRayAi({ x: 0, z: 0, angle: 0, rng, movement: mv, floor: 0, leader: () => false });
  b.targetId = 1;
  b.applyPhase(BARBA_PHASE.attack, null);
  check((b.flags & 4) === 0 && (b.flags & 0x100) !== 0, 'attack enter: gate open (0x100 set, 4 clear)');
  eq(b.tFrom, 3, 'attack enter: anchor 3');
  eq(b.slot, 15, 'attack enter: slot 0xf (beamwait)');
  b.drain();
  // The windup: 20 frames (0x734 counts 1..19, the 20th frame ends the sub); the slot becomes 13 then.
  // The target (6xAA = 1) is in the list from the start: sub 0's end takes the target point (0x774).
  const windupTargets = [{ clientId: 1, x: b.x + 100, z: b.z, charClass: 0, dead: false }];
  for (let k = 0; k < BARBA_ATTACK.windup - 1; k++) b.tick(windupTargets);
  eq(b.attackSub, 0, 'attack windup: sub 0 holds for 19 frames');
  eq(b.slot, 15, 'attack windup: slot still 15 before the 20th frame');
  b.tick(windupTargets);
  eq(b.attackSub, 1, 'attack windup: the 20th frame ends sub 0');
  eq(b.slot, 13, 'attack windup: sub 0 end writes slot 0xd (beam_b)');
  const first = b.drain();
  check(first.some((e) => e.kind === 'se' && e.id === 0x3f6), 'attack windup: the 0x3f6 sound at the end of sub 0');
  // Sub 1 waits for the clock (the blend wrap, then 0.3 a tick) to reach 13.0; sub 2 starts there.
  let fireTick = -1;
  let fireSe = 0;
  for (let k = 1; k <= 200 && b.attackSub === 1; k++) {
    b.tick([]);
    fireSe += b.drain().filter((e) => e.kind === 'se' && e.id === 0x3f7).length;
    fireTick = k;
  }
  eq(b.attackSub, 2, 'attack fire: sub 1 reaches sub 2 once the clock is 13.0');
  eq(fireSe, 1, 'attack fire: the 0x3f7 sound once at sub 1 end');
  check(b.timer === BARBA_ATTACK.fire, `attack fire: the clock is pinned at 13.0 (got ${b.timer})`);
  check(fireTick > 40 && fireTick < 60, `attack fire: about 44 ticks at 0.3 after the blend wrap (got ${fireTick})`);
  // Sub 2 holds BARBA_ATTACK.aura bodies (PROVEN, the aura's state 2). The centre is origin + dir * (80 + 30 k)
  // at body k (PROVEN scale; the origin is the body, ASSUMED). The target is the leader's 6xAA target, 100 east.
  // The enter teleports the body to anchor 3, so the players are placed from the body's position.
  const bx = b.x;
  const bz = b.z;
  const tgtNear = { clientId: 1, x: bx + 100, z: bz, charClass: 0, dead: false }; // the target: the centre at body 1 is (bx + 110, bz), 10 away
  const far = { clientId: 2, x: bx, z: bz + 400, charClass: 0, dead: false }; // never inside 120 of the centre (z 400 off the line)
  const late = { clientId: 4, x: bx + 500, z: bz + 100, charClass: 0, dead: false }; // inside 120 first at body 12 (centre bx + 440)
  const corpse = { clientId: 3, x: bx + 110, z: bz + 5, charClass: 0, dead: true };
  const targets = [tgtNear, far, late, corpse];
  const hits: Extract<BarbaEvent, { kind: 'hit' }>[] = [];
  const hitBody: number[] = [];
  let sub2Ticks = 0;
  let sub3Ticks = 0;
  for (let k = 0; k < 200 && b.attackSub !== 4; k++) {
    if (b.attackSub === 2) sub2Ticks++;
    if (b.attackSub === 3) sub3Ticks++;
    b.tick(targets);
    for (const e of b.drain()) if (e.kind === 'hit') {
      hits.push(e);
      hitBody.push(sub2Ticks);
    }
  }
  eq(b.attackSub, 4, 'attack: sub 4 (done) after sub 2 and sub 3');
  // PROVEN: the aura (+0x4c 80.0, +30.0 a update) reaches state 2 at 500.0, the 14th update, so sub 2 has 14 bodies.
  eq(sub2Ticks, BARBA_ATTACK.aura, 'attack aura: sub 2 holds 14 bodies (80 + 30 * 14 = 500)');
  // PROVEN shape: sub 3 holds until the play-once end (clock 13.0 + 0.3 a tick reaches animEnd 25.0): 40 ticks.
  eq(sub3Ticks, 40, 'attack hold: sub 3 holds 40 ticks to the animation end (clock 13.0 to 25.0 at 0.3)');
  eq(hits.length, 2, 'attack: two hits over the whole attack (the hit list keeps a player to one; the far and dead are out)');
  eq(hits[0]?.clientId ?? -1, 1, 'attack: the target (50 from the body) is hit first, at body 1');
  eq(hitBody[0] ?? -1, 1, 'attack: body 1 (the centre at 80 + 30 = 110 out)');
  near((hits[0]?.x ?? 0) - bx, 110, 'attack: body 1 centre x = body + 110 along the aura direction');
  near(hits[0]?.z ?? 0, bz, 'attack: body 1 centre z = body (direction east)');
  eq(hits[0]?.power ?? -1, 250, 'attack: the power is MovementData[15] fparam1');
  eq(hits[0]?.knockback ?? -1, 20, 'attack: the knockback is 20 (0x009abbb0)');
  eq(hits[1]?.clientId ?? -1, 4, 'attack: the late player (inside 120 only when the centre has moved out) is hit');
  eq(hitBody[1] ?? -1, 12, 'attack: the late player is hit at body 12 (centre 80 + 30 * 12 = 440 out)');
  near((hits[1]?.x ?? 0) - bx, 440, 'attack: body 12 centre x = body + 440');
  // No target: the exe writes 0 to 0x774, so the direction is the unit vector from the body to the origin (PROVEN
  // code path; the origin is ASSUMED to be the body). A body away from the origin gets its direction reversed.
  const nt = new BarbaRayAi({ x: 0, z: 0, angle: 0, rng, movement: mv, floor: 0, leader: () => false });
  nt.applyPhase(BARBA_PHASE.attack, null);
  for (let k = 0; k < 400 && nt.attackSub !== 2; k++) nt.tick([]);
  const ntLen = Math.hypot(nt.x, nt.z);
  if (ntLen > 0) {
    near(nt.attackDir.x, -nt.x / ntLen, 'attack no target: the aura points at the origin (x)');
    near(nt.attackDir.z, -nt.z / ntLen, 'attack no target: the aura points at the origin (z)');
  }
  nt.drain();
  nt.tick([]);
  check(Math.hypot(nt.attackDir.x, nt.attackDir.z) > 0.99 || ntLen === 0, 'attack no target: the direction is a unit vector (or zero at the origin)');
  // The range is the sweep's dist^2 <= 120^2: a player at 121 is out, at 120 is in.
  const edge = new BarbaRayAi({ x: 0, z: 0, angle: 0, rng, movement: mv, floor: 0, leader: () => false });
  edge.applyPhase(BARBA_PHASE.attack, null);
  edge.attackSub = 2;
  edge.timer = 13;
  const ex = edge.x;
  const ez = edge.z;
  edge.tick([{ clientId: 4, x: ex + 121, z: ez, charClass: 0, dead: false }, { clientId: 5, x: ex, z: ez + 120, charClass: 0, dead: false }]);
  const edgeHits = edge.drain().filter((e) => e.kind === 'hit');
  eq(edgeHits.length, 1, 'attack range: one hit (the player at 120 on z)');
  eq(edgeHits[0]?.clientId ?? -1, 5, 'attack range: the player at 121 is out');
  // The point follows the target when it is set (the leader's 6xAA target).
  const tb = new BarbaRayAi({ x: 0, z: 0, angle: 0, rng, movement: mv, floor: 0, leader: () => false });
  tb.targetId = 9;
  tb.applyPhase(BARBA_PHASE.attack, null);
  const tx = tb.x + 30;
  const tz = tb.z - 40;
  const tgt = [{ clientId: 9, x: tx, z: tz, charClass: 0, dead: false }];
  for (let k = 0; k < BARBA_ATTACK.windup; k++) tb.tick(tgt);
  eq(tb.attackSub, 1, 'attack target: sub 0 ends on the 20th frame with the target present');
  tb.drain();
  for (let k = 0; k < 200 && tb.attackSub !== 2; k++) tb.tick(tgt);
  const tHit: Extract<BarbaEvent, { kind: 'hit' }>[] = [];
  for (let k = 0; k < 5; k++) {
    tb.tick(tgt);
    for (const e of tb.drain()) if (e.kind === 'hit') tHit.push(e);
  }
  // The target is 50 out at (0.6, -0.8): the aura runs that way, and the body 1 centre is 110 out along it.
  eq(tHit.length, 1, 'attack target: the target inside range is hit once');
  near(tb.attackDir.x, 0.6, 'attack target: the aura direction is the unit target vector (x)');
  near(tb.attackDir.z, -0.8, 'attack target: the aura direction is the unit target vector (z)');
  near((tHit[0]?.x ?? 0) - tb.x, 0.6 * 110, 'attack target: body 1 centre x = body + 110 * dir.x');
  near((tHit[0]?.z ?? 0) - tb.z, -0.8 * 110, 'attack target: body 1 centre z = body + 110 * dir.z');
}
void BARBA_PHASE;
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

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
  BARBA_CAPTURE_COUNT,
  BARBA_DWELL,
  BARBA_CAPTURE_OFFSETS,
  BARBA_HP,
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
void BARBA_PHASE;
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

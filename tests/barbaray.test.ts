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
  BARBA_HP,
  BARBA_PACE,
  BARBA_PHASE,
  BARBA_SLOTS,
  BARBA_TABLES,
  BarbaRayAi,
  barbaResolve,
  decodeBarbaMessage,
  encodeBarbaAA,
  encodeBarbaA9,
  type BarbaEvent,
} from '../client/src/combat/barbaray.ts';
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

void BARBA_PHASE;
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

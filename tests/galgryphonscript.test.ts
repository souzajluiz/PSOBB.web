// The Gal Gryphon's pattern script (client/src/combat/galgryphonscript.ts): the tables
// generated from PsoBB.exe (galgryphonscriptdata.ts), the branch rules
// (SelectGalgryphonRandomState_004a771c, dump 226437), the walk and the op handlers
// (CalculateGalgryphonRandomPacketValue_004a8c9c, dump 227308), the death gate
// (HandleGalgryphonState9_004a7360, dump 226240) and the 0xA0 sync decode
// (SyncPlayerToEntityTransform_004a7034, dump 226104).
//
// Run: node tests/galgryphonscript.test.ts
import {
  GALGRYPHON_LIST,
  GALGRYPHON_OP,
  GalgryphonScript,
  decodeGalgryphonSync,
  galgryphonStageDue,
  galgryphonStageList,
  type GalgryphonScriptContext,
} from '../client/src/combat/galgryphonscript.ts';
import { GALGRYPHON_SCRIPT_SLOTS } from '../client/src/combat/galgryphonscriptdata.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (got: unknown, want: unknown, msg: string) => check(got === want, `${msg}: got ${String(got)}, want ${String(want)}`);
const near = (got: number, want: number, msg: string, tol = 1e-6) =>
  check(Math.abs(got - want) < tol, `${msg}: got ${got}, want ${want}`);

// A scripted random source: the values come back in order, then 0.
const seq = (...vals: number[]) => {
  let i = 0;
  return () => (i < vals.length ? vals[i++]! : 0);
};
const ctxOf = (rand: () => number, players = 4, hpRatio = 1, heading = 0): GalgryphonScriptContext => ({
  rand,
  players,
  hpRatio,
  heading,
});

// Data: 29 lists, 188 records (the exe's count), each ends at a branch or a hold.
{
  eq(GALGRYPHON_SCRIPT_SLOTS.length, 29, 'the pattern has 29 lists');
  eq(GALGRYPHON_SCRIPT_SLOTS.reduce((n, l) => n + l.length, 0), 188, 'the pattern has 188 records');
  let endsOk = true;
  let rangeOk = true;
  GALGRYPHON_SCRIPT_SLOTS.forEach((list, k) => {
    const last = list[list.length - 1]!.op;
    if (last !== GALGRYPHON_OP.branch && last !== GALGRYPHON_OP.hold) endsOk = false;
    for (const r of list) {
      if (r.op === GALGRYPHON_OP.branch && (r.i8 < 0 || r.i8 > 6)) rangeOk = false;
      if (r.op === GALGRYPHON_OP.hold && k * 4 < GALGRYPHON_LIST.stageOther) rangeOk = false;
    }
  });
  check(endsOk, 'every list ends at a branch (0x21) or a hold (0x22)');
  check(rangeOk, 'branch types are 0..6, and holds sit only in the stage lists');
  eq(GALGRYPHON_SCRIPT_SLOTS[0]![0]!.op, 0, 'the default list starts with op 0');
  eq(galgryphonStageList(1), 0x68, 'stage 1 list');
  eq(galgryphonStageList(3), 0x6c, 'stage 3 list');
  eq(galgryphonStageList(2), 0x70, 'stage 2 list');
  eq(galgryphonStageList('other'), 0x64, 'the other stage list');
}

// Branch rules, types 0, 2..6 (dump 226437). The draws are one per rule.
{
  const s = new GalgryphonScript();
  s.restart(0x00);
  eq(s.branch(0, ctxOf(seq(0.1))), 0x08, 'branch 0: r < 0.6 -> +08');
  eq(s.branch(0, ctxOf(seq(0.7))), 0x0c, 'branch 0: 0.6 <= r < 0.9 -> +0c');
  eq(s.branch(0, ctxOf(seq(0.95))), 0x10, 'branch 0: r >= 0.9 -> +10');
  eq(s.branch(3, ctxOf(seq(0.1))), 0x2c, 'branch 3: r < 0.3 -> +2c');
  eq(s.branch(3, ctxOf(seq(0.35))), 0x30, 'branch 3: r < 0.4 -> +30');
  eq(s.branch(3, ctxOf(seq(0.5))), 0x34, 'branch 3: r < 0.6 -> +34');
  eq(s.branch(3, ctxOf(seq(0.7))), 0x38, 'branch 3: r < 0.8 -> +38');
  eq(s.branch(3, ctxOf(seq(0.9))), 0x3c, 'branch 3: else -> +3c');
  eq(s.branch(4, ctxOf(seq(0.1), 1)), 0x40, 'branch 4: r < 0.2, P < 2 -> +40');
  eq(s.branch(4, ctxOf(seq(0.1), 2)), 0x4c, 'branch 4: r < 0.2, P >= 2 -> +4c');
  eq(s.branch(4, ctxOf(seq(0.4), 3)), 0x44, 'branch 4: r < 0.6, P < 4 -> +44');
  eq(s.branch(4, ctxOf(seq(0.4), 4)), 0x50, 'branch 4: r < 0.6, P >= 4 -> +50');
  eq(s.branch(4, ctxOf(seq(0.9), 6)), 0x54, 'branch 4: else, P > 5 -> +54');
  eq(s.branch(4, ctxOf(seq(0.9), 5)), 0x48, 'branch 4: else, P <= 5 -> +48');
  eq(s.branch(5, ctxOf(seq())), 0x58, 'branch 5 -> +58');
  eq(s.branch(6, ctxOf(seq())), 0x10, 'branch 6 -> +10');
  // Branch 2: T924[P] (P = 4 gives 0.2).
  eq(s.branch(2, ctxOf(seq(0.1), 4)), 0x24, 'branch 2: r < T924[4] -> +24');
  eq(s.branch(2, ctxOf(seq(0.25), 4)), 0x28, 'branch 2: r >= T924[4] -> +28');
  // P is clamped to 0..7 (T924[7] = 0.5).
  eq(s.branch(2, ctxOf(seq(0.45), 99)), 0x24, 'branch 2: P clamps to 7');
}

// Branch 1: the speed roll, the HP roll and the 0x200 flag (dump 226437, type 1).
// Draws, in order: A (T924[P]), B (T900[P], only when A failed), C (the HP compare).
{
  const s = new GalgryphonScript();
  s.restart(0x00);
  eq(s.branch(1, ctxOf(seq(0.1), 4)), 0x24, 'branch 1: A < T924[4] = 0.2 -> +24');
  eq(s.flag200, true, 'branch 1 sets the 0x200 flag');
  // P > 4 with the flag set: clear it and take +24 with no draw.
  const s5 = new GalgryphonScript();
  s5.restart(0x00);
  s5.branch(1, ctxOf(seq(0.9, 0.9, 0.9), 5));
  eq(s5.flag200, true, 'P = 5: a roll that fails keeps the flag set');
  eq(s5.branch(1, ctxOf(seq(), 5)), 0x24, 'P > 4 with the flag set: +24');
  eq(s5.flag200, false, 'P > 4 with the flag set: the flag is cleared');
  // P = 2: T924 = 0 (A never passes), T900 = 0.1. A = 0.5, B = 0.05 < 0.1: C decides.
  const h1 = new GalgryphonScript();
  h1.restart(0x00);
  eq(h1.branch(1, ctxOf(seq(0.5, 0.05, 0.3), 2, 0.5)), 0x1c, 'branch 1, low roll: hp 0.5 > C 0.3 -> +1c');
  const h2 = new GalgryphonScript();
  h2.restart(0x00);
  eq(h2.branch(1, ctxOf(seq(0.5, 0.05, 0.9), 2, 0.5)), 0x20, 'branch 1, low roll: hp 0.5 <= C 0.9 -> +20');
  // B = 0.5 >= 0.1: the else side, hp against C.
  const h3 = new GalgryphonScript();
  h3.restart(0x00);
  eq(h3.branch(1, ctxOf(seq(0.5, 0.5, 0.7), 2, 0.5)), 0x18, 'branch 1, high roll: hp 0.5 <= C 0.7 -> +18');
  const h4 = new GalgryphonScript();
  h4.restart(0x00);
  eq(h4.branch(1, ctxOf(seq(0.5, 0.5, 0.2), 2, 0.5)), 0x14, 'branch 1, high roll: hp 0.5 > C 0.2 -> +14');
}

// The default list: 00 0c 0d 0e 10 then a branch 0 (r = 0.1 -> +08, the list 09 07 09 07 09 07).
{
  const s = new GalgryphonScript();
  s.restart(GALGRYPHON_LIST.default);
  const ops: number[] = [];
  // Draws: five records (00, 0c, 0d: one each; 0e: three; 10: one) = 7, then the branch (0.1), then 0.5s.
  const r = seq(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.1, ...Array.from({ length: 40 }, () => 0.5));
  for (let i = 0; i < 8; i++) ops.push(s.next(ctxOf(r)).packet.op);
  eq(ops.slice(0, 5).join(','), '0,12,13,14,16', 'the default list walks its five records in order');
  eq(ops[5], 9, 'branch 0 with r < 0.6 goes to list +08, whose first record is 09');
  eq(ops[6], 7, 'then 07');
}

// The stage death script (+0x64, "06 05 hold"): the hold sends state 34 (remove) and repeats.
{
  const s = new GalgryphonScript();
  s.restart(GALGRYPHON_LIST.stageOther);
  const ops: number[] = [];
  let heldLast = false;
  for (let i = 0; i < 6; i++) {
    const r = s.next(ctxOf(seq(0.5, 0.5, 0.5, 0.5)));
    ops.push(r.packet.op);
    heldLast = r.held;
  }
  eq(ops.slice(0, 3).join(','), '6,5,34', 'the other-stage death script: S6, S5, then the hold (34)');
  eq(ops.slice(2).every((o) => o === 34), true, 'the hold repeats');
  eq(heldLast, true, 'the hold is reported as held');
}

// Resolve (CalculateGalgryphonRandomPacketValue_004a8c9c and the handlers).
{
  // List +04's first record: op 0x09 with roll min 30, range 0, count base 56, +0xc 1.8, +0x10 300.
  const s = new GalgryphonScript();
  s.restart(0x04);
  const p = s.next(ctxOf(() => 0.5)).packet; // roll, count, +0xc, +0x10, sign: five draws
  eq(p.op, 9, 'resolve: op 9');
  eq(p.roll, 30, 'resolve: roll = ROUND(min + r * range), range 0 -> min');
  eq(p.a, 56, 'resolve 0x09: count = ROUND(i10 + r * i14)');
  near(p.c, 1.8, 'resolve 0x09: +0xc = f28 + r * f2c');
  near(p.d, 300, 'resolve 0x09: +0x10 = f30 + r * f34');
  eq(p.b, 1, 'resolve 0x09: sign 0 with r >= 0.5 -> 1');
  // List +04's sixth record is op 0x1b: its +4 is ROUND(r * 2^32).
  const s2 = new GalgryphonScript();
  s2.restart(0x04);
  for (let i = 0; i < 5; i++) s2.next(ctxOf(() => 0.5));
  const q = s2.next(ctxOf(() => 0.25)).packet;
  eq(q.op, 0x1b, 'the sixth record of list +04 is 0x1b');
  eq(q.a, 0x40000000, 'resolve 0x1b: ROUND(r * 2^32) with r = 0.25');
}

// Resolve 0x0a (t = 0 for these records: i0c = 0): speed = 700 along the heading.
{
  const s = new GalgryphonScript();
  s.restart(0x14); // 0a 0a 0c 0d 10 B2
  const p = s.next(ctxOf(() => 0.5, 4, 1, Math.PI / 2)).packet;
  eq(p.op, 10, 'resolve 0x0a: op 10');
  near(p.a, 0, 'resolve 0x0a (t = 0): x = speed * cos(heading) at 90 degrees');
  near(p.b, 700, 'resolve 0x0a (t = 0): z = speed * sin(heading) at 90 degrees');
  eq(p.d, 8, 'resolve 0x0a: the count is ROUND(8 + r * 0)');
}

// The stage gate (HandleGalgryhonState9_004a7360, dump 226240).
{
  eq(galgryphonStageDue(0, 0), true, 'the death script is due at HP 0 with no flag');
  eq(galgryphonStageDue(0, 5), false, 'no death script above 0 HP');
  eq(galgryphonStageDue(0x8, 0), false, 'bit 0x8 (already run) blocks it');
  eq(galgryphonStageDue(0x4, 0), false, 'bit 0x4 blocks it');
  eq(galgryphonStageDue(0x200, -3), true, 'other bits do not block it');
}

// The 0xA0 sync (SyncPlayerToEntityTransform_004a7034): id, position, heading, the record.
{
  const v = new DataView(new ArrayBuffer(0x28));
  v.setUint8(0, 0xa0);
  v.setUint8(1, 10);
  v.setUint16(2, 0x1234, true);
  v.setFloat32(4, 1.5, true);
  v.setFloat32(8, 2.5, true);
  v.setFloat32(0xc, -3.5, true);
  v.setUint32(0x10, 0x4000, true);
  v.setUint16(0x14, 0x0a, true);
  v.setInt16(0x16, 90, true);
  v.setInt32(0x18, 7, true);
  const sync = decodeGalgryphonSync(v);
  eq(sync?.entityId, 0x1234, 'sync: entity id @2');
  eq(sync?.x, 1.5, 'sync: x @4');
  eq(sync?.z, -3.5, 'sync: z @0xc');
  eq(sync?.heading, 0x4000, 'sync: heading @0x10');
  eq(sync?.state, 10, 'sync: the state is the record op @0x14');
  eq(sync?.duration, 90, 'sync: the duration is the roll @0x16');
  eq(sync?.a, 7, 'sync: the first word @0x18');
  eq(decodeGalgryphonSync(new DataView(new ArrayBuffer(0x10))), null, 'sync: a short buffer is refused');
}

if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('galgryphonscript: all checks passed');

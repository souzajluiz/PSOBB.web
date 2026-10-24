// The Gal Gryphon's brain (client/src/combat/galgryphonai.ts): update_gal_gryphon (dump 226140),
// the pattern executor (ProcessGalgryphonAction_004a7b58, dump 226598), the default walk
// (ProcessGalgryphonDefaultSubcommandPacket_004a8d5c, dump 227369), the death gate
// (HandleGalgryphonState9_004a7360, dump 226240), the 0xA0 / 0x9F wire format, the motion player,
// and the part B view of the unified context (galgryphonstatesb.ts viewStateCtxB).
//
// Run: node tests/galgryphonai.test.ts
import {
  GalgryphonAi,
  GalgryphonMotionPlayer,
  GALGRYPHON_BRAIN_FLAG,
  GALGRYPHON_MOTION_ROWS,
  GALGRYPHON_SYNC_BYTES,
  encodeGalgryphonSync,
  encodeGalgryphonTarget,
} from '../client/src/combat/galgryphonai.ts';
import { decodeGalgryphonSync } from '../client/src/combat/galgryphonscript.ts';
import { bodyViewB, viewStateCtxB } from '../client/src/combat/galgryphonstatesb.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (got: unknown, want: unknown, msg: string) => check(got === want, `${msg}: got ${String(got)}, want ${String(want)}`);
const near = (got: number, want: number, msg: string, tol = 1e-4) =>
  check(Math.abs(got - want) < tol, `${msg}: got ${got}, want ${want}`);

/** A deterministic [0, 1) source (a 32-bit LCG). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface Rig {
  ai: GalgryphonAi;
  sent: Uint8Array[];
  setHp: (hp: number) => void;
}

function rig(opts: { leader?: boolean; players?: number; seed?: number } = {}): Rig {
  const sent: Uint8Array[] = [];
  const ai = new GalgryphonAi({
    entityId: 0x1234,
    x: 0,
    h: 180,
    z: 991,
    heading: 0,
    leader: () => opts.leader ?? true,
    hp: 1000,
    maxHp: 1000,
    players: () => opts.players ?? 2,
    rand: lcg(opts.seed ?? 7),
    send: (p) => sent.push(p),
  });
  return { ai, sent, setHp: (hp: number) => ai.setHp(hp, 1000) };
}

const opOf = (bytes: Uint8Array) => decodeGalgryphonSync(new DataView(bytes.buffer))!.state;
const rollOf = (bytes: Uint8Array) => decodeGalgryphonSync(new DataView(bytes.buffer))!.duration;

// ---- the wire format ----
{
  const rec = { op: 9, roll: 30, a: 1.5, b: -2, c: 0, d: 7 };
  const bytes = encodeGalgryphonSync(0x1234, { x: 10, y: 20, z: 30 }, 0x4000, rec);
  eq(bytes.length, GALGRYPHON_SYNC_BYTES, 'sync: 0x28 bytes');
  eq(bytes[0], 0xa0, 'sync: subcommand 0xa0');
  eq(bytes[1], 10, 'sync: size 10 words');
  const s = decodeGalgryphonSync(new DataView(bytes.buffer))!;
  eq(s.entityId, 0x1234, 'sync: entity id');
  near(s.x, 10, 'sync: x');
  near(s.y, 20, 'sync: y (height)');
  near(s.z, 30, 'sync: z');
  eq(s.heading, 0x4000, 'sync: heading');
  eq(s.state, 9, 'sync: state is the record op');
  eq(s.duration, 30, 'sync: duration is the record roll');
  const t = encodeGalgryphonTarget(0x1234, { id: 5, x: 1, z: 2 });
  eq(t[0], 0x9f, 'target: subcommand 0x9f');
  eq(t.length, 0x10, 'target: 16 bytes');
  eq(new DataView(t.buffer).getUint32(4, true), 5, 'target: client id');
}

// ---- the motion player ----
{
  const m = new GalgryphonMotionPlayer();
  m.play(0);
  eq(m.playing(), 0, 'motion: play loads the row');
  for (let i = 0; i < 40; i++) m.tick();
  check(m.frame() < 30, 'motion: a loop wraps inside its frame count');
  eq(m.finished(), false, 'motion: a loop never finishes');

  m.play(25);
  for (let i = 0; i < 499; i++) m.tick();
  eq(m.finished(), false, 'motion: the 500-frame op is not done after 499 ticks');
  m.tick();
  eq(m.finished(), true, 'motion: the once row finishes at its end');
  eq(m.speed() <= 0, true, 'motion: a finished once row has speed 0 (the states test it)');

  m.play(6);
  for (let i = 0; i < 60; i++) m.tick();
  eq(m.playing(), 7, 'motion: the chain row 6 moves to slot 7');

  m.write(4);
  m.tick();
  eq(m.playing(), 4, 'motion: a raw write loads its row on the next tick');
  eq(GALGRYPHON_MOTION_ROWS[25].frames, 500, 'motion: row 25 is the 500-frame op');
}

// ---- the leader: the entrance, the default walk, the re-arm ----
{
  const r = rig({ leader: true, seed: 7 });
  eq(r.ai.stateNumber, 4, 'leader: enters S4');
  for (let i = 0; i < 700 && r.sent.length === 0; i++) r.ai.tick([]);
  check(r.sent.length >= 1, 'leader: the entrance ends and the default walk sends a packet');
  eq(opOf(r.sent[0]), 0, 'leader: the first default record is op 0 (S0)');
  eq(rollOf(r.sent[0]), 2, 'leader: its duration is the record roll (2 ticks)');
  eq(r.ai.stateNumber, 0, 'leader: the packet loops back and the state is S0');
  eq(r.ai.currentRecord.op, 0, 'leader: the loopback writes the record at +0x49c');

  // S0 has no exit of its own: the duration runs out (the walk's own tick already took one of the
  // two ticks), the cursor moves to the seed (S33), and the executor sends the next pattern packet on
  // the following tick (the re-arm).
  r.ai.tick([]);
  eq(r.ai.stateNumber, 33, 'rearm: the expired record advances to the seed (S33)');
  eq(r.sent.length, 1, 'rearm: nothing is sent while the seed waits');
  r.ai.tick([]);
  eq(r.sent.length, 2, 'rearm: the executor sends the next packet on the tick after the seed');
  eq(opOf(r.sent[1]), 12, 'rearm: the next pattern record is op 12 (S12, the default list continues)');
  eq(r.ai.stateNumber, 12, 'rearm: the loopback sets S12');
  check((r.ai as unknown as { body: { flags: number } }).body.flags & GALGRYPHON_BRAIN_FLAG.pending, 'rearm: the loopback sets the pending bit again');
  // While S12 runs, the executor waits (the cursor is at +0x49c): no packet until the record ends.
  const before = r.sent.length;
  for (let i = 0; i < 5; i++) r.ai.tick([]);
  eq(r.sent.length, before, 'rearm: no packet while the synced record is current');
}

// ---- the death gate ----
{
  const r = rig({ leader: true, seed: 3 });
  for (let i = 0; i < 700 && r.sent.length === 0; i++) r.ai.tick([]);
  const body = (r.ai as unknown as { body: { flags: number; stage: number } }).body;
  r.setHp(0);
  r.ai.tick([]);
  check((body.flags & GALGRYPHON_BRAIN_FLAG.stageRan) !== 0, 'death: HP <= 0 runs the stage walk (bit 0x8)');
  const after = r.sent.length;
  r.ai.tick([]);
  check(r.sent.length >= after, 'death: the walk goes on through the tick');
  check((body.flags & 0xc) !== 0, 'death: the flags keep the script from running twice');
}

// ---- the follower: states come from the sync, nothing is sent ----
{
  const leader = rig({ leader: true, seed: 11 });
  const follower = rig({ leader: false, seed: 11 });
  const pkt = encodeGalgryphonSync(0x1234, { x: 100, y: 200, z: 300 }, 0x2000, { op: 9, roll: 30, a: 0, b: 0, c: 0, d: 0 });
  check(follower.ai.receive(new DataView(pkt.buffer)), 'follower: the sync for its entity is applied');
  eq(follower.ai.stateNumber, 9, 'follower: the synced state is applied');
  eq(follower.ai.currentRecord.roll, 30, 'follower: the synced duration is the record roll');
  // The sender's x and z are a delta for the next position step; the height and heading are set now.
  // S4's leave (the state change) writes its home pose first, as the exe does, so the height is 180 here.
  near(follower.ai.pendingDelta.x, 100, 'follower: the synced x is a delta from x = 0');
  near(follower.ai.pendingDelta.z, 300, 'follower: the synced z is a delta from z = 0');
  eq(follower.ai.body.heading, 36734, 'follower: the heading is S4\'s home heading after its leave');
  follower.ai.tick([]);
  eq(follower.ai.pendingDelta.x, 0, 'follower: the delta is applied once by the position step');
  for (let i = 0; i < 20; i++) follower.ai.tick([]);
  eq(follower.sent.length, 0, 'follower: it never sends a packet');
  eq(follower.ai.stateNumber, 9, 'follower: the state holds while its 30-tick record runs');
  for (let i = 0; i < 20; i++) follower.ai.tick([]);
  eq(follower.ai.stateNumber, 33, 'follower: the record expires into the seed (S33); a follower has no executor');
  eq(follower.sent.length, 0, 'follower: still no packet at the seed');
  void leader;

  const other = encodeGalgryphonSync(0x9999, { x: 0, y: 0, z: 0 }, 0, { op: 9, roll: 1, a: 0, b: 0, c: 0, d: 0 });
  check(!follower.ai.receive(new DataView(other.buffer)), 'follower: a sync for another entity is refused');

  const tgt = encodeGalgryphonTarget(0x1234, { id: 4, x: 5, z: 6 });
  check(follower.ai.receiveTarget(new DataView(tgt.buffer)), 'follower: the 9F target is applied');
  eq(follower.ai.body.target.id, 4, 'follower: the target id');
  near(follower.ai.body.target.z, 6, 'follower: the target z');
}

// ---- the leader's target search (the net hook) ----
{
  const r = rig({ leader: true });
  const targets: AiTarget[] = [
    { clientId: 1, x: 900, z: 900, charClass: 0, dead: false },
    { clientId: 2, x: 10, z: 10, charClass: 0, dead: false },
    { clientId: 3, x: 0, z: 0, charClass: 0, dead: true },
  ];
  r.ai.tick(targets);
  // The search runs in phase 8 of S2 or S30; here the state is S4, so the target stays as spawned.
  eq(r.ai.body.target.id, 0xffff, 'target: S4 does not search (the default is the spawn target)');
}

// ---- the part B view over the unified context ----
{
  const r = rig({ leader: false });
  const ai = r.ai as unknown as { body: Record<string, number>; ctx: unknown };
  const view = bodyViewB(ai.body as never);
  view.y = 55;
  eq(ai.body.h, 55, 'view: y is the height (+0x3c)');
  view.headingVel = 12;
  eq(ai.body.turn, 12, 'view: headingVel is the turn (+0x488)');
  view.velX = 3;
  eq(ai.body.vx, 3, 'view: velX is vx (+0x47c)');
  view.k = 9;
  eq(ai.body.aura, 9, 'view: k is the +0x6f0 storage');
  const cv = viewStateCtxB({
    body: ai.body,
    rec: null,
    motion: new GalgryphonMotionPlayer(),
    fx: {},
    rng: { next16: () => 1, reseed: () => {} },
    rt: { s19Base: 67, pairB4: 0, pairB8: 0, pairBC: 0, pairC0: 0, s29Base: 180, defaultY: 0 },
    players: 3,
    phase: 0,
    cine: {},
    world: {},
    death: {},
    net: {},
    throwMinion: () => {},
    queue: () => {},
    playerPresent: () => false,
    advance: () => {},
    changeState: () => {},
    walkDefault: () => {},
  } as never);
  eq(cv.players, 3, 'view: the player count is the context\'s');
  eq(cv.recordDuration, 0, 'view: no record gives duration 0');
}

if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('galgryphonai: all checks passed');

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
import { DrlBurst } from '../client/src/combat/derolle.ts';
import type { Vec3 } from '../client/src/combat/galgryphonfx.ts';

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

// ---- the motion table (0x009a7c80, 27 records; the motion is the record's u32 @4) ----
{
  for (let k = 0; k <= 26; k++) check(GALGRYPHON_MOTION_ROWS[k] !== undefined, `motion table: slot ${k} has a row`);
  eq(GALGRYPHON_MOTION_ROWS[17]!.motion, 24, 'motion: slot 17 (S27 kiri, literal 0x11) plays motion 24');
  eq(GALGRYPHON_MOTION_ROWS[22]!.motion, 18, 'motion: slot 22 (S18 runin) plays motion 18');
  eq(GALGRYPHON_MOTION_ROWS[2]!.motion, 1, 'motion: slot 2 (S31 kakuin) plays motion 1');
  eq(GALGRYPHON_MOTION_ROWS[10]!.next, 11, 'motion: slot 10 chains to slot 11');
  eq(GALGRYPHON_MOTION_ROWS[25]!.frames, 500, 'motion: slot 25 is the 500-frame motion 7');
}

// ---- the minion ring's area hits (UpdateGalgryphonMinionParticles_004aade4 -> 0x004a86e0) ----
{
  const r = rig({ leader: true, players: 1 });
  // The S31 22.0 event makes the ring (CreateGalgryphonMinion_004aabd8). Its hook is the default one.
  (r.ai as unknown as { ctx: { fx: { spawnMinionRing(x: number, y: number, z: number): void } } }).ctx.fx.spawnMinionRing(10, 2, 20);
  const radii: number[] = [];
  let spawnTicks = 0;
  for (let i = 0; i < 80; i++) {
    const f = r.ai.tick([]);
    for (const s of f.shots ?? []) {
      if (s instanceof DrlBurst) radii.push(s.radius);
      spawnTicks++;
    }
  }
  eq(spawnTicks, 31, 'ring: 31 area hits (the spawn state runs 31 ticks)');
  eq(radii[0], 0, 'ring: the first hit has radius counter * 7 = 0');
  eq(radii[30], 210, 'ring: the last spawn hit has radius 30 * 7 = 210');
  check(radii.every((v, i) => v === i * 7), 'ring: radius steps by 7');
  // The ring's hits are the variant context: power 0 (the exe's global 0x00903994), a tech hit.
  const first = (r.ai as unknown as { shotsOut: unknown[] }).shotsOut;
  eq(first.length, 0, 'ring: the queue is drained by frameOut');
}

// ---- the beams: the S27 beam (spawnBeam) and the S30 dive beam (diveBeam) reach the host's bolt hook
// 20 and 40 ticks after they are made, and the S27 one lives 17 ticks (the beam object's window) ----
{
  const drawn: number[] = [];
  let n = 0;
  const sent: Uint8Array[] = [];
  const ai = new GalgryphonAi({
    entityId: 0x1234,
    x: 0,
    h: 180,
    z: 991,
    heading: 0,
    leader: () => true,
    hp: 1000,
    maxHp: 1000,
    players: () => 1,
    rand: lcg(9),
    send: (p) => sent.push(p),
    ground: () => ({ y: 3 }),
    bolt: () => drawn.push(n),
  });
  const hooks = (ai as unknown as { ctx: { fx: { spawnBeam(f: boolean, v: number): void; diveBeam(a: Vec3, b: Vec3): void } } }).ctx.fx;
  hooks.spawnBeam(true, 0);
  for (let i = 0; i < 25; i++) {
    n++;
    ai.tick([]);
  }
  check(drawn.length === 1 && drawn[0] === 20, `beam: the S27 beam is drawn on its frame 20 (got ${drawn})`);
  hooks.diveBeam({ x: 0, y: 180, z: 0 }, { x: 100, y: 0, z: 100 });
  const base = n;
  for (let i = 0; i < 45; i++) {
    n++;
    ai.tick([]);
  }
  check(drawn.length === 2 && drawn[1] === base + 40, `beam: the dive beam is drawn on its frame 40 (got ${drawn})`);
}

// ---- the S27 under-body arc (one bolt per call, the arc's control points on the boss's underside) and the
// minion ring's particles (the start at the centre, then 32 slot points for each of its 31 spawn ticks) ----
{
  const bolts: number[] = [];
  const starts: Vec3[] = [];
  const slots: { k: number; at: Vec3 }[] = [];
  const ai = new GalgryphonAi({
    entityId: 0x1234,
    x: 0,
    h: 180,
    z: 991,
    heading: 0,
    leader: () => true,
    hp: 1000,
    maxHp: 1000,
    players: () => 2,
    rand: lcg(11),
    send: () => {},
    bolt: (b) => bolts.push(b.base[0]!),
    ringParticles: {
      start: (c) => starts.push(c),
      slot: (k, at) => slots.push({ k, at }),
    },
  });
  const hooks = (ai as unknown as { ctx: { fx: { lightningUnderBody(): void; spawnMinionRing(x: number, y: number, z: number): void } } }).ctx.fx;
  hooks.lightningUnderBody();
  hooks.lightningUnderBody();
  check(bolts.length === 2, `under-body: each call draws one arc bolt (got ${bolts.length})`);
  check(bolts.every((x) => Number.isFinite(x)), 'under-body: each bolt has a finite start point');
  hooks.spawnMinionRing(10, 99, -20);
  check(starts.length === 1 && starts[0]!.x === 10 && starts[0]!.z === -20, 'ring: the start is at the ring centre');
  check(starts[0]!.y === 2, `ring: the start height is 2.0 (got ${starts[0]!.y})`);
  for (let i = 0; i < 40; i++) ai.tick([]);
  check(slots.length === 31 * 32, `ring: 31 spawn ticks x 32 slots (got ${slots.length})`);
  check(slots.every((r) => r.at.y === 0), 'ring: every slot point is at height 0');
  check(slots.some((r) => r.k === 31) && slots.some((r) => r.k === 0), 'ring: the slots run 0..31');
}

// ---- the death hooks: hp <= 0 runs the death script once; its S5 leave calls the kill and quest flag 0x52 ----
{
  const killed: number[] = [];
  const flagsSet: number[] = [];
  const sent: Uint8Array[] = [];
  const ai = new GalgryphonAi({
    entityId: 0x1234,
    x: 0,
    h: 180,
    z: 991,
    heading: 0,
    leader: () => true,
    hp: 1000,
    maxHp: 1000,
    players: () => 2,
    rand: lcg(3),
    send: (p) => sent.push(p),
    death: { killed: () => killed.push(1), setQuestFlag: (id) => flagsSet.push(id) },
  });
  for (let i = 0; i < 700 && sent.length === 0; i++) ai.tick([]);
  ai.setHp(0, 1000);
  for (let i = 0; i < 6000 && killed.length === 0; i++) ai.tick([]);
  eq(killed.length, 1, 'death hooks: the leave calls the kill once');
  eq(flagsSet.length, 1, 'death hooks: the leave sets one quest flag');
  eq(flagsSet[0], 0x52, 'death hooks: the quest flag is 0x52');
  for (let i = 0; i < 3000; i++) ai.tick([]);
  eq(killed.length, 1, 'death hooks: the script does not run the kill twice');
  eq(flagsSet.length, 1, 'death hooks: the quest flag is set once');
  check(ai.gone, 'death hooks: the script reaches the remove state (34), the body is gone');
}

if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('galgryphonai: all checks passed');

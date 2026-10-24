// The Gal Gryphon brain, states 0..17 (client/src/combat/galgryphonstatesa.ts): the handler table,
// the shared helpers (FUN_004a15ac, FUN_004a5e10, sin16 / cos16 quarter angles), and each state's
// enter / frame / leave against a recording fake of the context. The exe addresses are in the
// handler comments; the expected values here come from the decompile and the disassembly.
//
// Run: node tests/galgryphonstatesa.test.ts
import {
  GALGRYPHON_FLAG,
  GALGRYPHON_HOME,
  GALGRYPHON_HOME_HEADING,
  GALGRYPHON_PHASE,
  GALGRYPHON_STATES_A,
  angle16FromRadians,
  cos16,
  cubicBernstein,
  quarterTurnAngle,
  sin16,
  steerToTarget,
  stepVelocity,
  turnToward,
  type GalgryphonBody,
  type GalgryphonStateCtx,
} from '../client/src/combat/galgryphonstatesa.ts';
import type { GalgryphonPacket } from '../client/src/combat/galgryphonscript.ts';

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

const P = GALGRYPHON_PHASE;
const F = GALGRYPHON_FLAG;

interface FakeMotion {
  frame: number;
  end: number;
  speed: number;
  finished: boolean;
  playing: number;
  crossedAt: Set<number>;
}

/** A context whose hooks are logged in `log`; `m` is the motion the test drives. */
function makeCtx(opts: { rec?: GalgryphonPacket | null; players?: number[] } = {}) {
  const log: string[] = [];
  const m: FakeMotion = { frame: 0, end: 0, speed: 1, finished: false, playing: 0, crossedAt: new Set() };
  const body: GalgryphonBody = {
    x: 0,
    h: 0,
    z: 0,
    heading: 0,
    pitch: 0,
    tilt: 0,
    turn: 0,
    vx: 0,
    vz: 0,
    flags: 0,
    stage: 0,
    sub: 0,
    aux: 0,
    waypointAngle: 0,
    syncCount: 0,
    muzzle: { x: 1, y: 40, z: 2 },
    beam: null,
    toTargetX: 0,
    toTargetZ: 0,
    toTargetLen: 0,
    target: { id: 7, x: 0, z: 0 },
    aura: 0,
  };
  const ctx: GalgryphonStateCtx = {
    phase: 0,
    body,
    rec: opts.rec ?? null,
    motion: {
      play: (s) => log.push(`play ${s}`),
      write: (s) => log.push(`write ${s}`),
      tick: () => log.push('tick'),
      frame: () => m.frame,
      endFrame: () => m.end,
      speed: () => m.speed,
      finished: () => m.finished,
      playing: () => m.playing,
      crossed: (f) => m.crossedAt.has(f),
    },
    fx: {
      spawn: (e) => {
        log.push(`spawn ${e}`);
        return {};
      },
      spawnSlot: (s) => {
        log.push(`slot ${s}`);
        return {};
      },
      move: () => log.push('move'),
      kill: () => log.push('kill'),
      releaseHandles: () => log.push('release'),
      se: (id, e) => log.push(`se ${id.toString(16)} ${e}`),
      seLoop: (id) => log.push(`seloop ${id.toString(16)}`),
      muzzleShots: () => log.push('muzzle'),
      frontShots: () => log.push('front'),
      landing: () => log.push('landing'),
      aura: () => log.push('aura'),
      auraUpdate: () => log.push('aura update'),
      kiriBeam: () => log.push('kiri beam'),
      kiriFx: () => log.push('kiri fx'),
      lightning: () => log.push('lightning'),
      lightningAux: () => log.push('lightning aux'),
    },
    cine: {
      begin: () => log.push('cine begin'),
      end: () => log.push('cine end'),
      hideHud: () => log.push('hud off'),
      freezePlayers: (on) => log.push(`freeze ${on}`),
      shake: (a, f) => log.push(`shake ${a} ${f}`),
      shakePreset: (k) => log.push(`preset ${k}`),
      deathStart: () => log.push('death start'),
      deathEnd: () => log.push('death end'),
      event: (id) => log.push(`event ${id.toString(16)}`),
    },
    world: {
      groundImpact: () => log.push('impact'),
      hitCheck: (flag, dist) => log.push(`hit ${flag.toString(16)} ${dist}`),
    },
    death: {
      killed: () => log.push('killed'),
      setQuestFlag: (id) => log.push(`quest ${id.toString(16)}`),
    },
    net: {
      sendTarget: (id) => log.push(`send ${id}`),
      findTarget: () => log.push('find'),
      refreshTarget: () => log.push('refresh'),
    },
    throwMinion: (origin, offset, target, slot) =>
      log.push(`throw o=${origin.x},${origin.y},${origin.z} off=${offset.x.toFixed(3)},${offset.y.toFixed(3)},${offset.z.toFixed(3)} t=${target.x},${target.z} slot=${slot}`),
    queue: (tag, arg) => log.push(`queue ${tag.toString(16)} ${arg}`),
    playerPresent: (slot) => (opts.players ?? []).includes(slot),
    advance: () => log.push('advance'),
    changeState: (s) => log.push(`change ${s}`),
    walkDefault: () => log.push('walk'),
  };
  return { ctx, body, m, log };
}

function run(state: number, phase: number, c: GalgryphonStateCtx): void {
  const h = GALGRYPHON_STATES_A[state];
  if (!h) throw new Error(`no handler for ${state}`);
  c.phase = phase;
  h(c);
}

// ---- the table and the helpers -------------------------------------------------------------------

for (let s = 0; s <= 17; s++) {
  check(typeof GALGRYPHON_STATES_A[s] === 'function', `table: state ${s} has a handler`);
}
eq(GALGRYPHON_STATES_A[18], undefined, 'table: states 18..34 are not in part A');

{
  // S0 is the empty placeholder: every phase is a no-op.
  const { ctx, log } = makeCtx();
  for (const p of [4, 5, 0, 8, 9, 2, 3]) run(0, p, ctx);
  eq(log.length, 0, 'S0: every phase is a no-op');
}

// angle16: a quarter turn is 16384; the sine of a quarter turn is 1.
eq(angle16FromRadians(Math.PI / 2), 16384, 'angle16: pi/2 is 0x4000');
eq(angle16FromRadians(-Math.PI / 2), -16384, 'angle16: -pi/2 is -0x4000');
near(sin16(16384), 1, 'sin16: a quarter turn is 1');
near(cos16(0), 1, 'cos16: zero is 1');
near(sin16(-16384), -1, 'sin16: a negative quarter turn is -1');
eq(quarterTurnAngle(9, 18), 8192, 'quarterTurn: 9 of 18 is 8192');
eq(quarterTurnAngle(10, 19.5), 8402, 'quarterTurn: truncates (16384*10/19.5 = 8402.05)');

{
  // FUN_004a15ac: sin(h) * speed on x, cos(h) * speed on z.
  const b = makeCtx().body;
  stepVelocity(b, 2, 0);
  near(b.vx, 0, 'step: heading 0 moves only z (x)');
  near(b.vz, 2, 'step: heading 0 moves z by the speed');
  stepVelocity(b, 3, 16384);
  near(b.vx, 3, 'step: heading a quarter turn moves x by the speed');
}

{
  // FUN_004a5e10: the turn accumulator takes the clamped error.
  const b = makeCtx().body;
  turnToward(b, 100, 1000); // d = 1000, round(0.6 d) = 600, e = 0 - 600 = -600 -> clamp to -100
  eq(b.turn, 100, 'turn: a large error is clamped to the rate');
  const c = makeCtx().body;
  turnToward(c, 100, 0);
  eq(c.turn, 0, 'turn: no error, no change');
}

{
  // steerToTarget: the bearing of the target from the boss, then the turn toward it.
  const { body } = makeCtx();
  body.target = { id: 1, x: 10, z: 0 };
  steerToTarget(body, 1000);
  near(body.toTargetLen, 10, 'target: the length to the target');
  eq(body.turn !== 0, true, 'steer: the turn moves toward the target bearing');
}

// ---- S1 / S2 / S3 --------------------------------------------------------------------------------

{
  const { ctx, body, log } = makeCtx();
  run(1, P.enter, ctx);
  eq(log[0], 'play 0', 'S1 enter: plays the stand motion');
  eq(body.stage, 0, 'S1 enter: stage 0');
  run(1, P.frame, ctx);
  eq(log[log.length - 1], 'tick', 'S1 frame: ticks the motion only');
}

{
  const { ctx, body, m, log } = makeCtx();
  run(2, P.enter, ctx);
  eq(log[0], 'play 1', 'S2 enter: plays walk');
  eq((body.flags & F.walk) !== 0, true, 'S2 enter: walking flag set');
  body.syncCount = 9;
  run(2, P.enter, ctx);
  eq(body.syncCount, 0, 'S2 enter: the sync counter is reset');
  for (const [d, hit] of [
    [3, true],
    [5, false],
    [12, true],
    [20, false],
    [30, true],
  ] as const) {
    log.length = 0;
    m.frame = d;
    run(2, P.frame, ctx);
    eq(log.includes('hit 100 1.8'), hit, `S2 frame: step at frame ${d}`);
  }
  run(2, P.leave, ctx);
  eq((body.flags & F.walk) === 0, true, 'S2 leave: walking flag cleared');
  // The sync: the target is searched on every call; the 6x9F send is on counts 0 and 32 of 33 calls.
  log.length = 0;
  body.syncCount = 0;
  for (let i = 0; i < 33; i++) run(2, P.sync, ctx);
  eq(log.filter((s) => s === 'find').length, 33, 'S2 sync: the target search on every call');
  eq(log.filter((s) => s.startsWith('send')).length, 2, 'S2 sync: the 6x9F send on counts 0 and 32');
}

{
  const { ctx, log, body } = makeCtx({ players: [] });
  run(3, P.enter, ctx);
  eq(log[0], 'write 0', 'S3 enter: a raw write of the stand slot (no set-animation)');
  eq(body.sub, 0, 'S3 enter: the counter is zero');
  run(3, P.frame, ctx);
  eq(body.sub, 0, 'S3 frame: no player, no count');
  const withP = makeCtx({ players: [2] });
  run(3, P.frame, withP.ctx);
  eq(withP.body.sub, 1, 'S3 frame: a player in slot 0..3 counts');
  withP.body.sub = 150;
  run(3, P.wait, withP.ctx);
  eq(withP.log.includes('change 11'), false, 'S3 wait: 150 is not more than 150');
  withP.body.sub = 151;
  run(3, P.wait, withP.ctx);
  eq(withP.log.includes('change 11'), true, 'S3 wait: more than 150 moves to S11');
}

// ---- S4 entrance ---------------------------------------------------------------------------------

{
  const { ctx, body, m, log } = makeCtx();
  run(4, P.enter, ctx);
  eq((body.flags & F.intro) !== 0, true, 'S4 enter: the intro flag');
  eq(body.aura, 1, 'S4 enter: the aura flag');
  eq(log.includes('aura'), true, 'S4 enter: the aura');
  eq(log.includes('play 25') || log.includes('write 25'), true, 'S4 enter: the op motion (slot 25)');
  eq(log.includes('cine begin'), true, 'S4 enter: the cinematic starts');
  m.crossedAt.add(68);
  m.frame = 68;
  log.length = 0;
  run(4, P.frame, ctx);
  eq(log.includes('slot 1'), true, 'S4 frame 68: the FX slot 1');
  eq(log.includes('queue 1c 60'), true, 'S4 frame 68: queue 0x1c, 0x3c');
  eq(body.sub, 0, 'S4 frame 68: still in the op motion');
  m.crossedAt.clear();
  m.finished = true;
  log.length = 0;
  run(4, P.frame, ctx);
  eq(body.sub, 1, 'S4 frame: the op motion finished, sub 1');
  eq(log.includes('write 4'), true, 'S4 frame: the fly slot 4 (raw write)');
  eq(log.includes('hud off'), true, 'S4 frame: the HUD goes off');
  log.length = 0;
  body.x = 5;
  body.heading = 123;
  run(4, P.frame, ctx);
  eq(body.x, GALGRYPHON_HOME.x, 'S4 sub 1: the home x');
  eq(body.h, GALGRYPHON_HOME.y, 'S4 sub 1: the home height');
  eq(body.z, GALGRYPHON_HOME.z, 'S4 sub 1: the home z');
  eq(body.heading, GALGRYPHON_HOME_HEADING, 'S4 sub 1: the home heading');
  run(4, P.dispatch, ctx);
  eq(log.includes('walk'), true, 'S4 phase 9 with sub 1: the default-list walk');
  run(4, P.walk, ctx);
  eq(log.filter((s) => s === 'walk').length, 2, 'S4 phase 2 with sub 1: the walk');
  body.sub = 0;
  log.length = 0;
  run(4, P.dispatch, ctx);
  eq(log.includes('walk'), false, 'S4 phase 9 with sub 0: no walk');
  run(4, P.leave, ctx);
  eq((body.flags & F.intro) === 0, true, 'S4 leave: the intro flag cleared');
  eq(body.aura, 0, 'S4 leave: the aura flag cleared');
  eq(log.includes('cine end'), true, 'S4 leave: the cinematic ends');
}

// ---- S5 death ------------------------------------------------------------------------------------

{
  const { ctx, body, m, log } = makeCtx();
  body.x = 100;
  body.z = -50;
  run(5, P.enter, ctx);
  eq(log[0], 'play 26', 'S5 enter: the dead motion (slot 26)');
  near(Math.hypot(body.x, body.z), 600, 'S5 enter: 600 units from the origin');
  eq(body.h, 360, 'S5 enter: height 360 (the exe writes 180, then 360)');
  // Facing the origin: the boss's position is opposite the heading's vector.
  near(body.x, -600 * sin16(body.heading), 'S5 enter: x = -600 sin(heading)', 1e-6);
  near(body.z, -600 * cos16(body.heading), 'S5 enter: z = -600 cos(heading)', 1e-6);
  eq((body.flags & 0xc4), 0xc4, 'S5 enter: the flags 0xc4');
  eq(log.includes('death start'), true, 'S5 enter: the death cinematic');
  m.crossedAt.add(110);
  log.length = 0;
  run(5, P.frame, ctx);
  eq(log.filter((s) => s === 'slot 513' || s === 'spawn 513').length, 1, 'S5 frame 110: the 0x201 FX');
  eq(log.filter((s) => s === 'spawn 525').length, 3, 'S5 frame 110: three 0x20d FX');
  m.crossedAt.clear();
  m.finished = true;
  run(5, P.frame, ctx);
  eq(body.sub, 1, 'S5 frame: the dead motion finished, sub 1');
  log.length = 0;
  for (let i = 1; i <= 49; i++) run(5, P.frame, ctx);
  eq(log.includes('advance'), false, 'S5: 49 counted ticks do not advance');
  run(5, P.frame, ctx);
  eq(log.includes('advance'), true, 'S5: the 50th counted tick advances');
  log.length = 0;
  body.x = 7;
  body.z = 9;
  run(5, P.leave, ctx);
  eq(log.includes('killed'), true, 'S5 leave: on-killed');
  eq(log.includes('quest 52'), true, 'S5 leave: quest flag 0x52');
  eq(body.x, 7, 'S5 leave: the position is restored');
  eq(body.z, 9, 'S5 leave: the position is restored (z)');
}

// ---- S6 takeoff ----------------------------------------------------------------------------------

{
  const { ctx, body, m, log } = makeCtx();
  run(6, P.enter, ctx);
  eq(log[0], 'play 3', 'S6 enter: the takeoff (slot 3)');
  m.crossedAt.add(25);
  log.length = 0;
  run(6, P.frame, ctx);
  eq(body.aux, 1, 'S6 25: sub 1');
  eq(body.vz, 5, 'S6 25: the step of 5.0');
  eq(log.includes('front'), true, 'S6 25: the front shots');
  eq(log.includes('shake 0.15 20'), true, 'S6 25: the camera shake');
  eq(log.includes('se 3a3 body'), true, 'S6 25: SE 0x3a3');
  m.crossedAt.clear();
  m.frame = 27;
  m.crossedAt.add(27);
  run(6, P.frame, ctx);
  eq(body.aux, 2, 'S6 27: sub 2');
  m.crossedAt.clear();
  m.frame = 0;
  m.speed = 0;
  body.aux = 3;
  log.length = 0;
  run(6, P.frame, ctx);
  eq(log.includes('advance'), true, 'S6 sub 3: advances when the motion has ended');
  body.aux = 1;
  m.frame = 30;
  run(6, P.frame, ctx);
  near(body.h, ((30 - 25) * (30 - 25) * 50) / 4, 'S6 sub 1: the parabola', 1e-9);
}

// ---- S7 shot and minion throw --------------------------------------------------------------------

{
  const { ctx, body, m, log } = makeCtx();
  body.heading = 16384; // a quarter turn: sin 1, cos 0
  body.target = { id: 9, x: 300, z: -200 };
  body.muzzle = { x: 11, y: 40, z: 12 };
  run(7, P.enter, ctx);
  eq(log[0], 'play 24', 'S7 enter: the shot (slot 24)');
  m.frame = 0;
  run(7, P.frame, ctx);
  eq(body.sub, 1, 'S7 frame: sub 0 -> 1 on the first tick');
  log.length = 0;
  m.frame = 10;
  m.crossedAt.add(20.5);
  run(7, P.frame, ctx);
  const throws = log.filter((s) => s.startsWith('throw'));
  eq(throws.length, 1, 'S7 20.5: one minion throw');
  eq(throws[0], 'throw o=11,40,12 off=150.000,-20.000,0.000 t=300,-200 slot=9', 'S7 20.5: origin, offset, target and slot');
  eq(log.includes('slot 4'), true, 'S7 20.5: the muzzle FX (slot 4)');
  eq(body.sub, 2, 'S7 20.5: sub 2');
  log.length = 0;
  m.crossedAt.clear();
  m.speed = 0;
  run(7, P.frame, ctx);
  eq(log.includes('advance'), true, 'S7 sub 2: advances when the motion has ended');
}

{
  // The beam: created in [8, 18], moved while it lives, killed after 18.
  const { ctx, body, m, log } = makeCtx();
  run(7, P.enter, ctx);
  body.sub = 1;
  m.frame = 10;
  run(7, P.frame, ctx);
  eq(body.beam !== null, true, 'S7 beam: created at frame 10');
  m.frame = 12;
  log.length = 0;
  run(7, P.frame, ctx);
  eq(log.includes('move'), true, 'S7 beam: moved while it lives');
  m.frame = 19;
  log.length = 0;
  run(7, P.frame, ctx);
  eq(log.includes('kill'), true, 'S7 beam: killed past frame 18');
  eq(body.beam, null, 'S7 beam: the handle is cleared');
}

// ---- S8 / S9 / S10 flight ------------------------------------------------------------------------

{
  const rec: GalgryphonPacket = { op: 8, roll: 30, a: 7, b: 3, c: 0, d: 0 };
  const { ctx, body, log } = makeCtx({ rec });
  run(8, P.enter, ctx);
  eq(log[0], 'play 4', 'S8 enter: the fly motion (slot 4)');
  run(8, P.frame, ctx);
  eq(body.turn, 7, 'S8 frame: the turn accumulator takes the record turn');
  near(body.vz, 3, 'S8 frame: the step at the record speed', 1e-9);
}

{
  // S9: the orbit takes the origin's bearing plus k (0x4000 or 0x5000, negated for sign < 1).
  const rec: GalgryphonPacket = { op: 9, roll: 30, a: 0, b: 1, c: 2, d: 1000 };
  const { ctx, body } = makeCtx({ rec });
  body.x = 0;
  body.z = 100;
  run(9, P.enter, ctx);
  run(9, P.frame, ctx);
  // ang = atan2(0, 100) = 0; d^2 (1e6) >= dist^2 (1e4): k = 0x4000; sign 1: heading 0x4000 (x gets +speed).
  near(body.vx, 2, 'S9 frame: the orbit step is on x at a quarter turn', 1e-9);
  const neg: GalgryphonPacket = { op: 9, roll: 30, a: 0, b: 0, c: 2, d: 1000 };
  const other = makeCtx({ rec: neg });
  other.body.z = 100;
  run(9, P.frame, other.ctx);
  near(other.body.vx, -2, 'S9 frame: a sign below 1 negates the offset', 1e-9);
}

{
  // S10: the waypoint (a, b) is reached at squared distance below 10.
  const rec: GalgryphonPacket = { op: 10, roll: 30, a: 0, b: 5, c: 1, d: 3 };
  const far = makeCtx({ rec });
  run(10, P.enter, far.ctx);
  run(10, P.frame, far.ctx);
  eq(far.log.includes('advance'), false, 'S10: dist^2 25 is not below 10');
  const near1 = makeCtx({ rec });
  near1.body.z = 4;
  run(10, P.enter, near1.ctx);
  run(10, P.frame, near1.ctx);
  eq(near1.log.includes('advance'), true, 'S10: dist^2 1 is below 10, advance');
}

// ---- S11 / S12 / S13 / S14 -----------------------------------------------------------------------

{
  const { ctx, body, m, log } = makeCtx();
  run(11, P.enter, ctx);
  eq(log[0], 'play 5', 'S11 enter: the land (slot 5)');
  eq((body.flags & F.busy) !== 0, true, 'S11 enter: busy');
  m.crossedAt.add(1);
  run(11, P.frame, ctx);
  eq(body.sub, 1, 'S11 frame 1: sub 1');
  m.crossedAt.clear();
  m.frame = 2;
  run(11, P.frame, ctx);
  near(body.h, 180 - (180 * 1) / 484, 'S11 sub 1: the descent at frame 2', 1e-9);
  m.frame = 1;
  m.crossedAt.add(23);
  log.length = 0;
  run(11, P.frame, ctx);
  eq(body.stage, 0, 'S11 23: the stage clears');
  eq(body.h, 0, 'S11 23: the height is the low height');
  eq(log.includes('se 3a7 body'), true, 'S11 23: SE 0x3a7');
  eq(log.includes('preset 1'), true, 'S11 23: the shake preset 1');
  eq(log.includes('landing'), true, 'S11 23: the landing FX');
  eq(log.includes('slot 1'), true, 'S11 23: the FX slot 1');
  m.crossedAt.clear();
  m.speed = 0;
  log.length = 0;
  run(11, P.frame, ctx);
  eq(log.includes('advance'), true, 'S11 sub 2: advances at the motion end');
}

{
  const { ctx, body, m, log } = makeCtx();
  run(12, P.enter, ctx);
  eq(log[0], 'play 6', 'S12 enter: the kakuin (slot 6, chained to 7)');
  m.frame = 9;
  run(12, P.frame, ctx);
  // quarter turn of 9 of 18 = 8192 (45 deg): h = (0 - 180) * sin(45) + 180.
  near(body.h, -180 * Math.sin(Math.PI / 4) + 180, 'S12 sub 0: the rise at frame 9', 1e-4);
  eq(body.vz > 0, true, 'S12 sub 0: the step of 0.25 on z (heading 0)');
  m.crossedAt.add(18);
  m.frame = 18;
  run(12, P.frame, ctx);
  eq(body.sub, 1, 'S12 18: sub 1');
  eq(body.aux, 0, 'S12 18: the counter starts at 0');
  m.crossedAt.clear();
  body.aux = 30;
  run(12, P.frame, ctx);
  eq(body.h, 67, 'S12 sub 1 end: height 67');
  eq(body.stage, 2, 'S12 sub 1 end: stage 2');
  eq(body.sub, 2, 'S12 sub 1 end: sub 2');
  m.playing = 7;
  log.length = 0;
  run(12, P.frame, ctx);
  eq(log.includes('advance'), true, 'S12 sub 2: advances when slot 7 is playing');
}

{
  // The quarter-turn pitch and the sine height at the middle of the rise (count 15 of 30).
  const { ctx, body, m } = makeCtx();
  run(12, P.enter, ctx);
  body.sub = 1;
  body.aux = 15;
  m.frame = 0;
  run(12, P.frame, ctx);
  eq(body.pitch, Math.round((15 * 6144) / 15), 'S12 sub 1: the pitch at count 15 is 6144 (the fall branch)');
  body.aux = 5;
  run(12, P.frame, ctx);
  eq(body.pitch, Math.round((5 * 6144) / 15), 'S12 sub 1: the pitch at count 5');
}

{
  const { ctx, body, m, log } = makeCtx();
  body.flags |= F.kiri;
  run(13, P.enter, ctx);
  eq(log[0], 'play 20', 'S13 enter with kiri: slot 20');
  run(13, P.frame, ctx);
  eq(log.includes('kiri beam') && log.includes('kiri fx'), true, 'S13 kiri: the beam and its FX');
  body.flags = 0;
  body.stage = 0;
  log.length = 0;
  run(13, P.enter, ctx);
  eq(log[0], 'play 7', 'S13 enter without kiri: slot 7');
  run(13, P.frame, ctx);
  eq(log.includes('seloop 39c'), true, 'S13 frame: the 0x39c loop');
  eq(body.vz > 0, true, 'S13 frame: the step of 3.5');
  void m;
}

{
  // S14: the record's turn adds to the turn accumulator when the orbit angle is ahead; the tilt damps.
  const rec: GalgryphonPacket = { op: 14, roll: 3, a: 4, b: 1, c: 0, d: 0 };
  const { ctx, body } = makeCtx({ rec });
  body.x = 0;
  body.z = 100;
  run(14, P.enter, ctx);
  body.tilt = 10;
  run(14, P.frame, ctx);
  // roll 3 <= 6: tilt -= trunc(10 / 3) = 3, so 7.
  eq(body.tilt, 7, 'S14 frame: the tilt is divided by the record duration when it is 6 or less');
  run(14, P.leave, ctx);
  eq(body.tilt, 0, 'S14 leave: the tilt clears');
}

// ---- S15 / S16 / S17 -----------------------------------------------------------------------------

{
  const { ctx, body, m, log } = makeCtx();
  run(15, P.enter, ctx);
  eq(log[0], 'play 9', 'S15 enter: the kakuland (slot 9)');
  eq(log.includes('release'), true, 'S15 enter: the FX handles are released');
  m.frame = 10;
  run(15, P.frame, ctx);
  near(body.h, cubicBernstein([67, 107, 147, 0], 10 / 20), 'S15 frame: the cubic Bezier height at t = 0.5', 1e-9);
  m.crossedAt.add(20);
  m.frame = 20;
  log.length = 0;
  run(15, P.frame, ctx);
  eq(body.sub, 1, 'S15 20: sub 1');
  eq(body.h, 0, 'S15 20: the height is the low height');
  eq(log.includes('landing') && log.includes('preset 1'), true, 'S15 20: the landing FX and the shake');
  m.crossedAt.clear();
  m.speed = 0;
  log.length = 0;
  run(15, P.frame, ctx);
  eq(log.includes('advance'), true, 'S15 sub 1: advances at the motion end');
}

{
  const { ctx, body, m, log } = makeCtx();
  run(16, P.enter, ctx);
  eq(log[0], 'play 7', 'S16 enter: the kaku loop (slot 7)');
  body.aux = 16;
  log.length = 0;
  run(16, P.frame, ctx);
  eq(log.includes('write 8'), true, 'S16 count 17: the raw write of slot 8');
  eq(body.aux, 17, 'S16 count: the counter goes up');
  body.aux = 39;
  run(16, P.frame, ctx);
  eq(body.sub, 1, 'S16 count past 39: sub 1');
  eq(body.pitch, 0, 'S16 count past 39: pitch 0');
  m.frame = 10;
  m.end = 20;
  m.speed = 0;
  log.length = 0;
  run(16, P.frame, ctx);
  eq(log.includes('advance'), true, 'S16 sub 1: advances at the motion end');
}

{
  const { ctx, body, m, log } = makeCtx();
  run(17, P.enter, ctx);
  eq(log[0], 'play 19', 'S17 enter: the kirin (slot 19)');
  eq((body.flags & F.kiri) !== 0, true, 'S17 enter: the kiri flag 0x100 is set');
  m.frame = 4.5;
  run(17, P.frame, ctx);
  // The sub 0 height: (0 - 180) * sin(quarter turn of 4.5 of 9) + 180.
  near(body.h, -180 * sin16(quarterTurnAngle(4.5, 9)) + 180, 'S17 sub 0: the rise at frame 4.5', 1e-9);
  m.crossedAt.add(9);
  m.frame = 9;
  run(17, P.frame, ctx);
  eq(body.sub, 1, 'S17 9: sub 1');
  body.aux = 20;
  run(17, P.frame, ctx);
  eq(body.h, 67, 'S17 sub 1 end: height 67');
  eq(body.sub, 2, 'S17 sub 1 end: sub 2');
  m.playing = 20;
  m.crossedAt.clear();
  log.length = 0;
  run(17, P.frame, ctx);
  eq(log.includes('advance'), true, 'S17 sub 2: advances when slot 20 is playing');
  run(17, P.leave, ctx);
  eq((body.flags & F.kiri) !== 0, true, 'S17 leave: the kiri flag is kept');
  eq((body.flags & F.busy) === 0, true, 'S17 leave: busy cleared');
}

// ---- the sign of the heights and the leave paths --------------------------------------------------

{
  // Every state's leave is safe with a fresh body (no throw, no NaN in the boss's fields).
  for (let s = 1; s <= 17; s++) {
    const { ctx, body } = makeCtx({ rec: { op: s, roll: 30, a: 1, b: 1, c: 1, d: 1 } });
    for (const p of [4, 0, 5]) run(s, p, ctx);
    const finite = [body.x, body.h, body.z, body.heading, body.pitch, body.tilt, body.turn, body.vx, body.vz].every((v) =>
      Number.isFinite(v),
    );
    check(finite, `state ${s}: enter, frame and leave keep the body finite`);
  }
}

if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('galgryphonstatesa: all checks passed');

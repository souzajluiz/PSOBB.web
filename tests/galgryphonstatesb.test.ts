// The Gal Gryphon's state handlers 18..34 (client/src/combat/galgryphonstatesb.ts):
// the table, the BAMS helpers, the steer and damping, and each state's enter, frame,
// leave and transition against a fake context that records the hook calls.
//
// The fake motion follows the exe's frame order: a handler ticks the motion once, then
// the frame events test the crossing from the previous time to the new one. setAnim
// restarts the motion clock (the exe's start-anim call).
//
// Run: node tests/galgryphonstatesb.test.ts
import {
  GALGRYPHON_ANIM_B,
  GALGRYPHON_STATE_HANDLERS_B,
  bamsAtan2,
  bamsSin,
  bamsCos,
  bernstein4,
  dampB,
  galRoundB,
  moveForwardB,
  runGalgryphonStateB,
  turnTowardB,
  wrapShortB,
  type GalgryphonBodyB,
  type GalgryphonFxB,
  type GalgryphonRuntimeB,
  type GalgryphonStateCtxB,
} from '../client/src/combat/galgryphonstatesb.ts';

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

// ---- a fake context ----

class FakeMotion {
  time = 0;
  prev = 0;
  stepValue = 1;
  flagsB4 = 0;
  flagsB0 = 0;
  restart() {
    this.time = 0;
    this.prev = 0;
  }
  tick() {
    this.prev = this.time;
    this.time += 1;
  }
  frameEvent(t: number) {
    return this.prev < t && t <= this.time;
  }
  elapsed() {
    return this.time;
  }
  step() {
    return this.stepValue;
  }
  recordFlags() {
    return this.flagsB4;
  }
  setFlagsB0(clear: number, set: number) {
    this.flagsB0 = (this.flagsB0 & ~clear) | set;
  }
}

function body(over: Partial<GalgryphonBodyB> = {}): GalgryphonBodyB {
  return {
    x: 0, y: 0, z: 0, heading: 0, pitch: 0, pitchB: 0, stage: 0, flags: 0, sub: 0, n: 0, m: 0, k: 0,
    slope: 0, velX: 0, velY: 0, velZ: 0, headingVel: 0, dirX: 0, dirZ: 0,
    pA: { x: 0, y: 0, z: 0 }, pB: { x: 0, y: 0, z: 0 },
    ...over,
  };
}

const RT: GalgryphonRuntimeB = { s19Base: 67, pairB4: 0, pairB8: 0, pairBC: 0, pairC0: 0, s29Base: 180, defaultY: 0 };

function makeCtx(over: { players?: number; recordDuration?: number } = {}, fxOver: Partial<GalgryphonFxB> = {}) {
  const calls: string[] = [];
  const motion = new FakeMotion();
  const fx: GalgryphonFxB = {
    groundProbe: () => calls.push('groundProbe'),
    resetParticles: () => calls.push('resetParticles'),
    releaseEffects: () => calls.push('releaseEffects'),
    footsteps: () => calls.push('footsteps'),
    lerpBattle: () => calls.push('lerpBattle'),
    thresholdDispatch: () => calls.push('thresholdDispatch'),
    phaseStats: () => calls.push('phaseStats'),
    spawnRing: () => calls.push('spawnRing'),
    disableMinions: () => calls.push('disableMinions'),
    effectAt: () => calls.push('effectAt'),
    cameraShake: () => calls.push('cameraShake'),
    initEntity: () => calls.push('initEntity'),
    markRemoved: () => calls.push('markRemoved'),
    sfx: (id: number) => calls.push(`sfx:${id.toString(16)}`),
    groundAt: () => 3,
    playerPos: () => null,
    lightningUnderBody: () => calls.push('lightningUnderBody'),
    lightningTransform: (v: number) => calls.push(`lightningTransform:${v}`),
    spawnBeam: (flag: boolean, v: number) => calls.push(`spawnBeam:${flag}:${v}`),
    lightningSetup: () => calls.push('lightningSetup'),
    lightningRelease: () => calls.push('lightningRelease'),
    spawnMinionRing: (x: number, y: number, z: number) => calls.push(`spawnMinionRing:${x},${y},${z}`),
    diveBeam: () => calls.push('diveBeam'),
    updateTargeting: () => calls.push('updateTargeting'),
    initVelocity: () => calls.push('initVelocity'),
    ...fxOver,
  };
  const anims: number[] = [];
  const counts = { advanced: 0, reseeded: 0 };
  const ctx: GalgryphonStateCtxB = {
    b: body(),
    motion: motion as unknown as GalgryphonStateCtxB['motion'],
    rng: { next16: () => 0x4000, reseed: () => counts.reseeded++ },
    rt: { ...RT },
    players: over.players ?? 1,
    recordDuration: over.recordDuration ?? 100,
    setAnim: (a: number) => {
      anims.push(a);
      motion.restart();
    },
    advance: () => counts.advanced++,
    fx,
  };
  return {
    ctx,
    motion,
    calls,
    anims,
    advanced: () => counts.advanced,
    reseeded: () => counts.reseeded,
  };
}

// ---- the table ----

for (let s = 18; s <= 34; s++) check(typeof GALGRYPHON_STATE_HANDLERS_B[s] === 'function', `table: state ${s}`);
eq(GALGRYPHON_STATE_HANDLERS_B[17], undefined, 'table: state 17 is not in part B');
eq(GALGRYPHON_STATE_HANDLERS_B[35], undefined, 'table: state 35 is not in part B');
{
  const { ctx } = makeCtx();
  eq(runGalgryphonStateB(ctx, 17, 0), false, 'runner: 17 is refused');
  eq(runGalgryphonStateB(ctx, 34, 4), true, 'runner: 34 runs');
}

// ---- BAMS helpers ----

near(bamsSin(16384), 1, 'bamsSin: 90 deg');
near(bamsCos(0), 1, 'bamsCos: 0');
eq(bamsAtan2(0, 1), 0, 'fpatan(0, 1) is 0');
eq(bamsAtan2(1, 0), 16384, 'fpatan(1, 0) is 90 deg');
eq(bamsAtan2(1, 1), 8192, 'fpatan(1, 1) is 45 deg');
eq(bamsAtan2(-1, 0), -16384, 'fpatan(-1, 0) is -90 deg');
eq(galRoundB(2.5), 3, 'ROUND rounds half up');
eq(galRoundB(-2.5), -2, 'ROUND on negatives: floor(x + 0.5)');
eq(wrapShortB(65535), -1, 'wrapShort: 65535 is -1');
eq(wrapShortB(32768), -32768, 'wrapShort: 32768 is -32768');
eq(wrapShortB(100), 100, 'wrapShort: a small value is unchanged');

// ---- the movement helpers ----
{
  const b = body({ heading: 0 });
  moveForwardB(b, 2, 0);
  near(b.velZ, 2, 'moveForward: heading 0 moves +z');
  near(b.velX, 0, 'moveForward: heading 0 has no x');
  const c = body({ heading: 16384 });
  moveForwardB(c, 2, 16384);
  near(c.velX, 2, 'moveForward: heading 90 moves +x');
}
{
  const b = body({ heading: 0, headingVel: 0 });
  turnTowardB(b, 256, 1000);
  eq(b.headingVel, 256, 'turn: one step is clamped to the rate');
  for (let i = 0; i < 40; i++) turnTowardB(b, 256, 1000);
  eq(b.headingVel, 600, 'turn: the velocity settles at 0.6 of the error');
}
{
  const b = body({ velX: 10, velY: 10, velZ: 10, headingVel: 100 });
  dampB(b, 0.5, 0.25, 0.5);
  eq(b.velX, 5, 'damp: x scaled by a');
  eq(b.velZ, 5, 'damp: z scaled by a');
  eq(b.velY, 2.5, 'damp: y scaled by b');
  eq(b.headingVel, 50, 'damp: heading velocity scaled by c and rounded');
}
{
  const p: [number, number, number, number] = [67, 157, 307, 0];
  near(bernstein4(p, 0), 67, 'bernstein: t 0 is the first point');
  near(bernstein4(p, 1), 0, 'bernstein: t 1 is the last point');
}

// ---- S18 ----
{
  const { ctx, calls, anims, motion, advanced } = makeCtx();
  const b = ctx.b;
  runGalgryphonStateB(ctx, 18, 4);
  eq(anims[0], GALGRYPHON_ANIM_B.runin, 'S18 enter: runin');
  eq(b.stage, 1, 'S18 enter: stage 1');
  eq(b.flags & 4, 4, 'S18 enter: flag 4');
  eq(b.y, 180, 'S18 enter: y 180');
  check(calls.includes('resetParticles'), 'S18 enter: particles reset');
  runGalgryphonStateB(ctx, 18, 0); // time 0 -> 1
  near(b.y, bernstein4([67, 157, 307, 0], 1 / 17), 'S18 frame: the curve at t = progress / 17');
  let guard = 0;
  while (b.sub === 0 && guard < 40) {
    runGalgryphonStateB(ctx, 18, 0);
    guard++;
  }
  eq(b.sub, 1, 'S18: event 17 starts the wait');
  eq(b.stage, 0, 'S18: event 17 clears the stage');
  near(b.y, 0, 'S18: event 17 puts y at the default');
  check(calls.includes('cameraShake') && calls.includes('initEntity'), 'S18: event 17 shake and init');
  motion.stepValue = 0;
  runGalgryphonStateB(ctx, 18, 0);
  eq(advanced(), 1, 'S18 sub 1: advances when the motion ends');
  runGalgryphonStateB(ctx, 18, 5);
  eq(b.flags & 0x104, 0, 'S18 leave: clears 0x104');
  check(calls.includes('releaseEffects'), 'S18 leave: releases effects');
}

// ---- S19 ----
{
  const { ctx, anims, motion } = makeCtx();
  const b = ctx.b;
  runGalgryphonStateB(ctx, 19, 4);
  eq(anims[0], GALGRYPHON_ANIM_B.kiriout, 'S19 enter: kiriout');
  eq(b.n, 0, 'S19 enter: counter 0');
  for (let i = 0; i < 11; i++) {
    runGalgryphonStateB(ctx, 19, 0);
  }
  eq(anims[anims.length - 1], GALGRYPHON_ANIM_B.run, 'S19: anim 21 at the 11th tick');
  let guard = 0;
  while (b.sub === 0 && guard < 100) {
    runGalgryphonStateB(ctx, 19, 0);
    guard++;
  }
  eq(b.sub, 1, 'S19: the rise ends after the counter passes 39');
  near(b.y, 67, 'S19: y at the base at the end of the rise');
  eq(b.pitch, 0, 'S19: pitch 0 at the end of the rise');
}

// ---- S20 ----
{
  const { ctx, motion, advanced, anims } = makeCtx();
  runGalgryphonStateB(ctx, 20, 4);
  eq(anims[0], GALGRYPHON_ANIM_B.takeoff, 'S20 enter: takeoff');
  motion.flagsB4 = 0xa;
  runGalgryphonStateB(ctx, 20, 0);
  eq(advanced(), 0, 'S20: not on the takeoff record');
  motion.flagsB4 = 0xb;
  runGalgryphonStateB(ctx, 20, 0);
  eq(advanced(), 1, 'S20: advances when the chain reaches walk (0xb)');
}

// ---- S21 ----
{
  const { ctx, calls, motion } = makeCtx();
  runGalgryphonStateB(ctx, 21, 4);
  eq(ctx.b.flags & 0x30, 0x30, 'S21 enter: flags 0x30');
  motion.time = 11; // the tick reaches 12: the near band (10..17)
  runGalgryphonStateB(ctx, 21, 0);
  check(calls.includes('footsteps') && calls.includes('thresholdDispatch'), 'S21: footsteps and the threshold dispatch');
  near(ctx.b.velZ, 1, 'S21 near band: speed 1 along heading 0');
  runGalgryphonStateB(ctx, 21, 5);
  eq(ctx.b.flags & 0x30, 0, 'S21 leave: clears 0x30');
}
{
  const { ctx, motion } = makeCtx();
  motion.time = 20; // the tick reaches 21: the far band, speed 0
  runGalgryphonStateB(ctx, 21, 0);
  near(ctx.b.velZ, 0, 'S21 far band: no speed');
}

// ---- S22 ----
{
  const { ctx, motion, advanced, anims } = makeCtx();
  runGalgryphonStateB(ctx, 22, 4);
  eq(anims[0], GALGRYPHON_ANIM_B.huseout, 'S22 enter: huseout');
  motion.stepValue = 0;
  runGalgryphonStateB(ctx, 22, 0);
  eq(advanced(), 1, 'S22: advances when the motion ends');
}

// ---- S23 ----
{
  const { ctx, motion, calls, advanced, anims } = makeCtx();
  runGalgryphonStateB(ctx, 23, 4);
  eq(anims[0], GALGRYPHON_ANIM_B.houko, 'S23 enter: houko');
  motion.time = 9; // the tick reaches 10: event 10
  runGalgryphonStateB(ctx, 23, 0);
  check(calls.includes('spawnRing'), 'S23: the ring at event 10');
  motion.flagsB4 = 0xe;
  runGalgryphonStateB(ctx, 23, 0);
  eq(advanced(), 1, 'S23: advances on the chain into huse (0xe)');
  runGalgryphonStateB(ctx, 23, 5);
  check(calls.includes('disableMinions'), 'S23 leave: minions disabled');
}

// ---- S24 ----
{
  const { ctx, calls, advanced, anims } = makeCtx();
  runGalgryphonStateB(ctx, 24, 4);
  eq(anims[0], GALGRYPHON_ANIM_B.huse, 'S24 enter: huse');
  check(calls.includes('spawnRing'), 'S24 enter: the ring');
  runGalgryphonStateB(ctx, 24, 0);
  eq(advanced(), 0, 'S24: script duration only');
}

// ---- S25 ----
{
  const { ctx, motion, calls, advanced } = makeCtx();
  runGalgryphonStateB(ctx, 25, 4);
  motion.time = 4; // the tick reaches 5
  runGalgryphonStateB(ctx, 25, 0);
  check(calls.includes('disableMinions'), 'S25: minions off at event 5');
  motion.stepValue = 0;
  runGalgryphonStateB(ctx, 25, 0);
  eq(advanced(), 1, 'S25: advances when the motion ends');
}

// ---- S26 ----
{
  const { ctx, motion, advanced, anims } = makeCtx();
  runGalgryphonStateB(ctx, 26, 4);
  eq(anims[0], GALGRYPHON_ANIM_B.dead, 'S26 enter: dead');
  motion.flagsB4 = 0x10;
  runGalgryphonStateB(ctx, 26, 0);
  eq(advanced(), 0, 'S26: not before the chain');
  motion.flagsB4 = 0x11;
  runGalgryphonStateB(ctx, 26, 0);
  eq(advanced(), 1, 'S26: advances on the chain into kiri (0x11)');
}

// ---- S27 ----
{
  const { ctx, calls, anims, reseeded } = makeCtx({ players: 2 });
  runGalgryphonStateB(ctx, 27, 4);
  eq(anims[0], GALGRYPHON_ANIM_B.kiri, 'S27 enter: kiri');
  check(calls.includes('lightningSetup') && calls.includes('spawnRing'), 'S27 enter: setup and ring');
  eq(reseeded(), 1, 'S27 enter: the rng is seeded');
  calls.length = 0;
  runGalgryphonStateB(ctx, 27, 0);
  check(calls.includes('lightningUnderBody') && calls.includes('lightningTransform:60'), 'S27: P > 1 makes the under-body effect and the transform at 60');
  check(calls.includes('sfx:3ab'), 'S27: the SFX every tick');
  eq(ctx.b.m, 1, 'S27: the counter advances');
}
{
  const { ctx, calls } = makeCtx({ players: 4 });
  runGalgryphonStateB(ctx, 27, 0); // m = 0 -> the beam
  // The raw random 16384 scales to trunc(16384 / 65536 * 4) = 1 (galgryphonfx.ts s27BeamValue).
  check(calls.some((c) => c === 'spawnBeam:true:1'), 'S27: P > 3 at m % 20 == 0 spawns the beam (flag true at m/20 = 0, value scaled by s27Beam)');
}
{
  const { ctx, calls } = makeCtx({ players: 1 });
  runGalgryphonStateB(ctx, 27, 5);
  check(calls.includes('lightningRelease') && calls.includes('disableMinions'), 'S27 leave: release and minions off');
}

// ---- S28 ----
{
  const { ctx, motion, calls, advanced } = makeCtx();
  runGalgryphonStateB(ctx, 28, 4);
  motion.time = 5; // the tick reaches 6
  runGalgryphonStateB(ctx, 28, 0);
  check(calls.includes('sfx:3aa'), 'S28: SFX 0x3aa at event 6');
  motion.stepValue = 0;
  runGalgryphonStateB(ctx, 28, 0);
  eq(advanced(), 1, 'S28: advances when the motion ends');
}

// ---- S29 ----
{
  const { ctx, motion, advanced } = makeCtx();
  const b = ctx.b;
  runGalgryphonStateB(ctx, 29, 4);
  eq(b.stage, 1, 'S29 enter: stage 1');
  runGalgryphonStateB(ctx, 29, 0); // the tick reaches 1: y = 180 + (180 - 180) * t^2 / 25
  near(b.y, 180, 'S29 sub 0: y is 180 for the base height 180');
  motion.time = 3; // the tick reaches 4: no event 5 yet
  runGalgryphonStateB(ctx, 29, 0);
  eq(b.sub, 0, 'S29: no rise before event 5');
  motion.time = 4; // the tick reaches 5: event 5
  runGalgryphonStateB(ctx, 29, 0);
  eq(b.sub, 1, 'S29: event 5 starts the rise');
  let guard = 0;
  while (b.stage !== 3 && guard < 100) {
    runGalgryphonStateB(ctx, 29, 0);
    guard++;
  }
  eq(b.stage, 3, 'S29: the rise ends at stage 3');
  near(b.y, 8000, 'S29: height 8000');
  eq(b.pitch, 0x4000, 'S29: pitch 0x4000');
  eq(advanced(), 1, 'S29: advances after the rise');
  runGalgryphonStateB(ctx, 29, 5);
  eq(b.stage, 3, 'S29 leave: stage stays 3');
}

// ---- S30 ----
{
  const { ctx, motion, anims, reseeded, calls, advanced } = makeCtx({ recordDuration: 107 });
  const b = ctx.b;
  runGalgryphonStateB(ctx, 30, 4);
  eq(anims[0], GALGRYPHON_ANIM_B.kiriout, 'S30 enter: kiriout');
  eq(b.stage, 3, 'S30 enter: stage 3');
  eq(b.flags & 4, 4, 'S30 enter: flag 4');
  eq(b.y, 8000, 'S30 enter: height 8000');
  eq(b.pitch, 0x4000, 'S30 enter: pitch 0x4000');
  eq(b.n, galRoundB(107 - 75), 'S30 enter: beam counter n = ROUND(dur - 75)');
  near(b.slope, 8000 / (107 - 32.5), 'S30 enter: slope (8000 - defaultY) / (dur - 32.5)');
  eq(reseeded(), 1, 'S30 enter: rng seeded');
  eq(b.sub, 0, 'S30 enter: sub 0');
  // sub 0: the dive; the beam at k % 5 == 0
  runGalgryphonStateB(ctx, 30, 0);
  check(calls.includes('diveBeam'), 'S30 sub 0: the beam on the first tick');
  eq(b.k, 1, 'S30 sub 0: the beam counter advances');
  let guard = 0;
  while (b.sub === 0 && guard < 200) {
    runGalgryphonStateB(ctx, 30, 0);
    guard++;
  }
  eq(b.sub, 1, 'S30: sub 1 when n <= k');
  eq(anims[anims.length - 1], GALGRYPHON_ANIM_B.runin, 'S30 sub 1: anim runin');
  check(guard >= 30, `S30: sub 0 runs about n ticks (ran ${guard})`);
  // sub 1: the pitch ramp from the motion time (restarted by the anim change)
  runGalgryphonStateB(ctx, 30, 0);
  const t1 = motion.elapsed();
  eq(b.pitch, galRoundB((t1 / -7 + 1) * -49152 + 65536), 'S30 sub 1: pitch ramp from the time');
  eq(b.pitchB, galRoundB(933.7857 * (7 - t1) * (7 - t1)), 'S30 sub 1: pitchB 933.7857 * (7 - t)^2');
  // sub 1 ends at event 7
  guard = 0;
  while (b.sub === 1 && guard < 50) {
    runGalgryphonStateB(ctx, 30, 0);
    guard++;
  }
  eq(b.sub, 2, 'S30: sub 2 at event 7');
  eq(b.pitch, 0, 'S30 sub 2: pitch 0');
  eq(b.pitchB, 0, 'S30 sub 2: pitchB 0');
  // sub 2 ends at event 17
  guard = 0;
  while (b.sub === 2 && guard < 50) {
    runGalgryphonStateB(ctx, 30, 0);
    guard++;
  }
  eq(b.sub, 3, 'S30: sub 3 at event 17');
  eq(b.stage, 0, 'S30: event 17 clears the stage');
  near(b.y, 0, 'S30: event 17 puts y at the default');
  check(calls.includes('initEntity') && calls.includes('cameraShake'), 'S30: event 17 init and shake');
  runGalgryphonStateB(ctx, 30, 5);
  eq(b.flags & 4, 0, 'S30 leave: clears flag 4');
  eq(advanced(), 0, 'S30: no explicit advance (script duration only)');
}
{
  const { ctx, calls } = makeCtx();
  ctx.b.sub = 1;
  runGalgryphonStateB(ctx, 30, 8);
  check(calls.includes('updateTargeting'), 'S30 phase 8: targeting in sub 0 and 1');
  calls.length = 0;
  ctx.b.sub = 3;
  runGalgryphonStateB(ctx, 30, 8);
  check(!calls.includes('updateTargeting'), 'S30 phase 8: none in sub 3');
}

// ---- S31 ----
{
  const { ctx, motion, calls, advanced, anims } = makeCtx();
  ctx.b.pA = { x: 2, y: 4, z: 6 };
  ctx.b.pB = { x: 4, y: 8, z: 10 };
  runGalgryphonStateB(ctx, 31, 4);
  eq(anims[0], GALGRYPHON_ANIM_B.kakuin, 'S31 enter: kakuin');
  motion.time = 20; // the tick reaches 21: no event 22
  runGalgryphonStateB(ctx, 31, 0);
  check(!calls.some((c) => c.startsWith('spawnMinionRing')), 'S31: no ring before event 22');
  motion.time = 21; // the tick reaches 22: event 22
  runGalgryphonStateB(ctx, 31, 0);
  check(calls.includes('spawnMinionRing:3,6,8'), 'S31: the ring at the midpoint (2+4)/2, (4+8)/2, (6+10)/2');
  check(calls.includes('cameraShake') && calls.includes('sfx:3a0'), 'S31: shake and SFX 0x3a0');
  motion.stepValue = 0;
  runGalgryphonStateB(ctx, 31, 0);
  eq(advanced(), 1, 'S31: advances when the motion ends');
}

// ---- S32 ----
{
  const { ctx, motion, calls, advanced, anims } = makeCtx();
  ctx.b.flags = 4;
  runGalgryphonStateB(ctx, 32, 4);
  eq(anims[0], GALGRYPHON_ANIM_B.runout, 'S32 enter: runout');
  eq(ctx.b.flags & 4, 0, 'S32 enter: clears 4');
  motion.time = 11; // the tick reaches 12: event 12
  runGalgryphonStateB(ctx, 32, 0);
  check(calls.includes('sfx:3b1'), 'S32: SFX 0x3b1 at event 12');
  motion.stepValue = 0;
  runGalgryphonStateB(ctx, 32, 0);
  eq(advanced(), 1, 'S32: advances when the motion ends');
}

// ---- S33 ----
for (const [stage, anim] of [[0, 0], [1, 4], [2, 7]] as const) {
  const { ctx, anims } = makeCtx();
  ctx.b.stage = stage;
  runGalgryphonStateB(ctx, 33, 4);
  eq(anims[0], anim, `S33 enter: stage ${stage} anim ${anim}`);
}
{
  const { ctx, advanced } = makeCtx();
  ctx.b.stage = 2;
  runGalgryphonStateB(ctx, 33, 0);
  near(ctx.b.velZ, 3, 'S33 stage 2: flies forward at 3');
  eq(advanced(), 0, 'S33: no advance (duration only)');
}
{
  const { ctx, calls, motion, advanced } = makeCtx();
  ctx.b.stage = 1;
  motion.time = 13; // the tick reaches 14: event 14
  runGalgryphonStateB(ctx, 33, 0);
  check(calls.includes('groundProbe'), 'S33 stage 1: the ground probe at event 14');
  eq(advanced(), 0, 'S33: still no advance');
}

// ---- S34 ----
{
  const { ctx, calls, advanced } = makeCtx();
  runGalgryphonStateB(ctx, 34, 4);
  eq(ctx.b.flags & 0x80, 0x80, 'S34 enter: flag 0x80');
  check(calls.includes('markRemoved'), 'S34 enter: removed');
  runGalgryphonStateB(ctx, 34, 0);
  runGalgryphonStateB(ctx, 34, 5);
  eq(advanced(), 0, 'S34: no frame, no leave, no advance');
}

if (failures > 0) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('galgryphonstatesb: all checks passed');

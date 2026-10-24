// The Gal Gryphon's state handlers 18..34 (PsoBB.exe, Ephinea 1.25.13): the ProcessState
// table entries at 0x009a7e40 + 8 * state (fn, adj), read with tools/exedata.py:
//   18 0x004a3f20  19 0x004a4170  20 0x004a4468  21 0x004a44d0  22 0x004a487c
//   23 0x004a4a08  24 0x004a4b9c  25 0x004a4c20  26 0x004a4cd8  27 0x004a4d6c
//   28 0x004a5530  29 0x004a55c8  30 0x004a5734  31 0x004a5eec  32 0x004a606c
//   33 0x004a6120  34 0x004a61bc
// Sources: docs/bosses/galgryphon-states-b.md (the first pass; its per-state specs
// are used where the dump does not say otherwise), and the dump's decompile for S27,
// S30 and S31 (dump = reverse/refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c,
// "dump N" below is a line there). Disassembly checks: objdump of 0x004a3f20..0x004a6200.
//
// Field offsets. The -b doc wrote some fields as int indices (its +0x1b9..+0x1c0 are the
// byte offsets 0x6e4..0x700, x4). The disassembly uses the byte offsets, so every field
// here is a byte offset in the boss object (the field map is in GalgryphonBodyB).
//
// Ported as data. The state machine, the timers, the velocity / heading / pitch math
// and the transitions are here. Effects, sounds, particles, collision probes and the
// attack spawns are hooks in GalgryphonFxB, named with the exe address they stand for;
// the brain (the wiring into render/combat.ts) is not done here.
//
// The per-state context is GalgryphonStateCtxB below. It is a local minimal shape: the
// S0..S17 module (galgryphonstatesa.ts, not merged yet) defines GalgryphonStateCtx and
// GalgryphonHandler; at wiring time this file's ctx and that one get unified.
//
// Run: node tests/galgryphonstatesb.test.ts

// ---- constants (exe bytes; see the comments per use) ----

/** Frame events the handlers test (the exe's check_entity_animation_elapsed_threshold). */
export const GALGRYPHON_EVENT_B = {
  e0_5: 0.5,   // 0x3f000000  S21
  e1: 1.0,     // 0x3f800000  S23
  e3: 3.0,     // 0x40400000  S22
  e4: 4.0,     // 0x40800000  S18
  e5: 5.0,     // 0x40a00000  S25, S29
  e6: 6.0,     // 0x40c00000  S28
  e7: 7.0,     // 0x40e00000  S19, S30 (sub 1 end)
  e10: 10.0,   // 0x41200000  S23
  e12: 12.0,   // 0x41400000  S32
  e14: 14.0,   // 0x41600000  S33 (stage 1)
  e15: 15.0,   // 0x41700000  S22
  e17: 17.0,   // 0x41880000  S18, S30 (sub 2 end)
  e19: 19.0,   // 0x41980000  S26
  e22: 22.0,   // 0x41b00000  S31, the minion ring (dump 225636)
} as const;

/** Sound ids used by the states. */
export const GALGRYPHON_SFX_B = {
  sfx39b: 0x39b, sfx3a0: 0x3a0, sfx3a2: 0x3a2, sfx3a6: 0x3a6, sfx3a7: 0x3a7, sfx3a8: 0x3a8,
  sfx3a9: 0x3a9, sfx3aa: 0x3aa, sfx3ab: 0x3ab, sfx3ac: 0x3ac, sfx3b1: 0x3b1, sfx3b2: 0x3b2,
} as const;

/** Motion (anim) indices written by the states (the motion table at 0x009a7c80). */
export const GALGRYPHON_ANIM_B = {
  fly: 0, kakuout: 4, kakuin: 2, op: 7, runin: 22, run: 21, takeoff: 10, walk: 11, huseout: 12,
  houko: 13, huse: 14, husein: 15, dead: 16, kiri: 17, kiriland: 18, kirin: 19, kiriout: 20,
  runout: 23, tunout: 26,
} as const;

/** Heights and the y the boss returns to (the exe's runtime y "ground", DAT_00a47564). */
export const GALGRYPHON_HEIGHT_B = {
  y180: 180.0,       // 0x43340000  S18, S19, S29 (rise / fall start)
  y8000: 8000.0,     // 0x45fa0000  S29, S30 (the dive's start height)
  yRiseHold: 67.0,   // 0x00a47524 init in S18 (curve point 0) and S19 base (-b doc)
  yCurve1: 157.0,    // 0x00a47534 init in S18 (curve point 1) (-b doc)
  yCurve2: 307.0,    // 0x00a47544 init in S18 (curve point 2) (-b doc)
  groundLimit: 6.0,  // 0x00903ae0  a ground hit above this is no landing
} as const;

const BAMS_FULL = 65536;
const TAU = Math.PI * 2;

// ---- small exe-faithful helpers ----

/** ROUND in the exe: floor(x + 0.5). */
export function galRoundB(x: number): number {
  return Math.floor(x + 0.5);
}

/** A BAMS angle (65536 = a full turn) as radians. int_sin / int_cos in the exe. */
export function bamsSin(a: number): number {
  return Math.sin((a * TAU) / BAMS_FULL);
}
export function bamsCos(a: number): number {
  return Math.cos((a * TAU) / BAMS_FULL);
}

/** fpatan(a, b) in the exe: atan2(a, b), returned as a BAMS angle (rounded). */
export function bamsAtan2(a: number, b: number): number {
  return galRoundB((Math.atan2(a, b) * BAMS_FULL) / TAU);
}

/** The exe's b_minus_a on shorts: a wrapped difference to the signed 16-bit range. */
export function wrapShortB(a: number): number {
  return ((a + 32768) & 0xffff) - 32768;
}

// ---- the context ----

/**
 * The boss fields the states read and write, by name. The byte offset is the exe's
 * (Ghidra int-index names in the -b doc, x4).
 */
export interface GalgryphonBodyB {
  x: number;         // +0x38 position
  y: number;         // +0x3c height
  z: number;         // +0x40
  heading: number;   // +0x60 BAMS, 65536 = 360 deg
  pitch: number;     // +0x5c BAMS (the tilt; 0x4000 = 90 deg, the dive)
  pitchB: number;    // +0x64 the second tilt-like field (S29 leave, S30 sub 1/2)
  stage: number;     // +0x4ec the movement stage (0 ground, 1 rise, 3 dive, 2 for fly)
  flags: number;     // +0x4c8 bits: 0x4 (set by the rise / dive, cleared on leave), 0x8, 0x10, 0x20, 0x40, 0x80 (remove)
  sub: number;       // +0x6e4 the sub-phase (the exe's "busy" field)
  n: number;         // +0x6e8 the counter (S19 rise, S29 fall, the dive's duration)
  m: number;         // +0x6ec the frame counter (S27 spin)
  k: number;         // +0x6f0 the dive's beam counter
  slope: number;     // +0x6fc the dive's per-tick height step
  velX: number;      // +0x47c velocity x
  velY: number;      // +0x480 velocity y
  velZ: number;      // +0x484 velocity z
  headingVel: number;// +0x488 heading velocity (BAMS per tick, a short)
  dirX: number;      // +0x3a8 the direction to the current target (x)
  dirZ: number;      // +0x3b0 the direction to the current target (z)
  /** +0x3d4 / +0x3d8 / +0x3dc and +0x3e0 / +0x3e4 / +0x3e8: the two stored points (S31 midpoint). */
  pA: { x: number; y: number; z: number };
  pB: { x: number; y: number; z: number };
}

/**
 * The motion player (the exe's motion ticks at 0x007aa094 and friends, all on the boss).
 */
export interface GalgryphonMotionB {
  /** 0x007aa094: advances the motion one tick (+0xc0 += +0xc8, the mode rules). */
  tick(): void;
  /** 0x007aaa30: true when this tick crosses frame t (check_entity_animation_elapsed_threshold). */
  frameEvent(t: number): boolean;
  /** 0x007aabd8: the motion's current time in frames (+0xc0). */
  elapsed(): number;
  /** +0xc8: the per-tick step; <= 0 means a one-shot motion finished. */
  step(): number;
  /** +0xb4: the current record's flags (the chain test: S20 0xb, S23 0xe, S26 0x11). */
  recordFlags(): number;
  /** The +0xb0 flags: 0x4 hold, 0x1 active (S30 sub 0 -> 1 sets 0x1 and clears 0x4). */
  setFlagsB0(clear: number, set: number): void;
}

/** Deterministic random source (rand() and get_random_int in the exe). */
export interface GalgryphonRngB {
  /** get_random_int >> 16: an integer in 0..65535 (S30). */
  next16(): number;
  /** Reseeds from the record (init_rng(this+0x5fc, *(rec+4))). */
  reseed(): void;
}

/**
 * The runtime values the exe reads from .bss (no value in the exe; set elsewhere). The
 * values here are ASSUMED defaults; the wiring step must give the real ones.
 */
export interface GalgryphonRuntimeB {
  /** DAT_00a475b0: S19 base height (ASSUMED default 67). */
  s19Base: number;
  /** DAT_00a475b4 / b8 / bc / c0: S21 and S22 speed and damping pairs (ASSUMED 0). */
  pairB4: number;
  pairB8: number;
  pairBC: number;
  pairC0: number;
  /** DAT_00a475d4: S29 fall target height (ASSUMED 180). */
  s29Base: number;
  /** DAT_00a47564: the default height y (ASSUMED 0). */
  defaultY: number;
}

/**
 * The minimal per-state context (local to this file; see the header). It is the boss
 * object as the handlers see it: fields, the motion player, the rng, the runtime values,
 * the hooks, and the players count P.
 */
export interface GalgryphonStateCtxB {
  b: GalgryphonBodyB;
  motion: GalgryphonMotionB;
  rng: GalgryphonRngB;
  rt: GalgryphonRuntimeB;
  /** The player count P (g_GalgryphonAnimationSpeeds[2]->field10_0x28 in the dump). */
  players: number;
  /** The record's duration seen by the dive (S30 enter reads *(rec+2)). */
  recordDuration: number;
  /** Set the motion anim (movw 0xb8 + the model vtable call 0x188). */
  setAnim(anim: number): void;
  /** Advance to the next script record (0x004a7e20). */
  advance(): void;
  fx: GalgryphonFxB;
}

/** The hooks: the exe's helpers that this file does not port (each names its address). */
export interface GalgryphonFxB {
  /** 0x004a15fc: ground probe at the boss; a hit at or below groundLimit makes an effect + SFX 0x39b. */
  groundProbe(): void;
  /** 0x004a410c: reset the particle objects (+0x72c..+0x734) to the reset point. */
  resetParticles(): void;
  /** 0x004a8a24: release the effect objects (+0x72c..+0x734). */
  releaseEffects(): void;
  /** 0x004a465c: footstep SE on the frame events. */
  footsteps(): void;
  /** 0x004a46bc: lerp the battle params (the lerp part is ported by the hook). */
  lerpBattle(): void;
  /** 0x004a47a8: the four-way attack dispatch on the frame events. */
  attackDispatch(): void;
  /** 0x004a4ae8: the phase battle-stats gate (ResetOlgaMinionStats_004a4ae8 in the dump). */
  phaseStats(): void;
  /** 0x004a9174: spawn the ring / area attack at a point with a heading. */
  spawnRing(x: number, y: number, z: number, heading: number): void;
  /** 0x004a91fc: end the active attacks (clear bit 0 on the list). */
  disableMinions(): void;
  /** 0x0050b7a4: spawn an effect object at a point (flags as the exe passes them). */
  effectAt(x: number, y: number, z: number, effectId: number, flags: number): void;
  /** 0x004d4288(1): a camera shake. */
  cameraShake(): void;
  /** 0x004a1f34: InitializeGalgryphonEntity (the landing reset). */
  initEntity(): void;
  /** *(u16*)(this+8) |= 1 (the delete flag; the remove state 34 and the gone case of the frame update). */
  markRemoved(): void;
  /** 0x00814298 / 0x008144b0: a sound at the boss. */
  sfx(id: number): void;
  /** 0x0082dcbc / 0x0082ddd8 / 0x00763498: ground and player probes for S30. */
  groundAt(x: number, z: number): number | null;
  /** GetPlayer_0068d5a8 + maybe_if_entity_is_not_dead: a live player's position, or null. */
  playerPos(slot: number): { x: number; y: number; z: number } | null;
  /** The S27 lightning: the under-body effect (create_gal_gryphon_lightning_effect_under_body). */
  lightningUnderBody(): void;
  /** UpdateOlgaMinionAnimationTransform_004a51c0 (the S27 projectile transform). */
  lightningTransform(value: number): void;
  /** SpawnOlgaMinionEffect_004a5218 (the S27 beam at a random player). */
  spawnBeam(flag: boolean, value: number): void;
  /** The S27 spawn objects (0x4a9de0 x2) and their release (0x0073d160). */
  lightningSetup(): void;
  lightningRelease(): void;
  /**
   * 0x004aabd8 (CreateGalgryphonMinion_004aabd8, dump 229084): the minion ring object, made at
   * the midpoint of pA and pB on the S31 22.0 event (dump 225636).
   */
  spawnMinionRing(x: number, y: number, z: number): void;
  /** CreateGalgryphonLightningBeamEffectWrapper_004aa4b0 (the S30 beam every 5 ticks, dump 225347). */
  diveBeam(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): void;
  /** OlgaMinionUpdateTargeting_004a12dc (S30 phase 8). */
  updateTargeting(): void;
  /** InitializeEnemyAnimationVelocity (base enemy code; zeroes the animation velocity). */
  initVelocity(): void;
}

// ---- the physics helpers (exe bodies ported; they run on the body fields) ----

/**
 * 0x004a15ac: forward speed along a heading: velX += sin(h) * speed, velZ += cos(h) * speed.
 * (The dump names the sin on +0x47c and the cos on +0x484.)
 */
export function moveForwardB(b: GalgryphonBodyB, speed: number, heading: number): void {
  b.velX += bamsSin(heading) * speed;
  b.velZ += bamsCos(heading) * speed;
}

/**
 * 0x004a5e10: the turn-rate limited steer of the heading velocity toward targetHeading.
 * desired = 0.6 * wrap(target - heading); the step is clamped to +-maxStep
 * (the exe's b_minus_a(a, b) = b - a on shorts).
 */
export function turnTowardB(b: GalgryphonBodyB, maxStep: number, targetHeading: number): void {
  const diff = wrapShortB(targetHeading - b.heading);
  const desired = wrapShortB(galRoundB(diff * 0.6));
  const d = wrapShortB(b.headingVel - desired);
  const c = d < -maxStep ? -maxStep : d > maxStep ? maxStep : d;
  b.headingVel -= c;
}

/** 0x004a1b84: steer the heading velocity toward atan2(dir) with rate (BAMS angle of dirX, dirZ). */
export function steerToDirB(b: GalgryphonBodyB, rate: number): void {
  turnTowardB(b, rate, bamsAtan2(b.dirX, b.dirZ));
}

/** 0x004a4814: damping: velX, velZ *= a; velY *= b; headingVel *= c (the int field rounds). */
export function dampB(b: GalgryphonBodyB, a: number, bY: number, c: number): void {
  b.headingVel = galRoundB(b.headingVel * c);
  b.velY *= bY;
  b.velX *= a;
  b.velZ *= a;
}

/** 0x004a5e90 (SetGalgryphonMovementDirection): forward speed toward atan2(dir). */
export function moveDirB(ctx: GalgryphonStateCtxB, speed: number): void {
  ctx.fx.initVelocity();
  moveForwardB(ctx.b, speed, bamsAtan2(ctx.b.dirX, ctx.b.dirZ));
}

/** The S19/S29 and S18 curve: a cubic Bernstein weighted sum of four heights (ASSUMED ordering). */
export function bernstein4(p: readonly [number, number, number, number], t: number): number {
  const u = 1 - t;
  return u * u * u * p[0] + 3 * u * u * t * p[1] + 3 * u * t * t * p[2] + t * t * t * p[3];
}

// ---- the states ----

/** A state handler: phase 4 enter, 5 leave, 0 frame, 8 / 9 extra hooks. */
export type GalgryphonHandlerB = (ctx: GalgryphonStateCtxB, phase: number) => void;

/** S18 (0x004a3f20): the landing / ground strike. Enter runin (22), rise to the curve. */
export const galStateB18: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.runin);
    b.stage = 1;
    b.flags |= 4;
    b.y = GALGRYPHON_HEIGHT_B.y180;
    ctx.fx.resetParticles();
    b.sub = 0;
    return;
  }
  if (phase === 5) {
    b.flags &= ~0x104;
    ctx.fx.releaseEffects();
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  if (b.sub === 0) {
    moveForwardB(b, 1.5, b.heading);
    const t = ctx.motion.elapsed() / 17.0;
    b.y = bernstein4([GALGRYPHON_HEIGHT_B.yRiseHold, GALGRYPHON_HEIGHT_B.yCurve1, GALGRYPHON_HEIGHT_B.yCurve2, ctx.rt.defaultY], t);
    if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e17)) {
      b.stage = 0;
      b.y = ctx.rt.defaultY;
      ctx.fx.sfx(GALGRYPHON_SFX_B.sfx3a7);
      ctx.fx.effectAt(b.x, 0, b.z, 0, 0x40); // the effect id is the struct at +0x17e (not decoded)
      ctx.fx.cameraShake();
      ctx.fx.initEntity();
      b.sub = 1;
    }
  } else if (b.sub === 1) {
    if (ctx.motion.step() <= 0) ctx.advance();
  }
  if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e4)) ctx.fx.groundProbe();
};

/** S19 (0x004a4170): the rise and spin (kiriout, then run). */
export const galStateB19: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.kiriout);
    b.stage = 1;
    b.flags |= 4;
    b.y = GALGRYPHON_HEIGHT_B.y180;
    b.n = 0;
    b.sub = 0;
    ctx.fx.resetParticles();
    return;
  }
  if (phase === 5) {
    b.flags &= ~0x104;
    ctx.fx.releaseEffects();
    b.y = GALGRYPHON_HEIGHT_B.y180;
    b.pitch = 0;
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  if (b.sub === 0) {
    const h = (ctx.rt.s19Base - GALGRYPHON_HEIGHT_B.yRiseHold) * 0.5;
    const n = b.n;
    if (n >= 19.5) {
      // ASSUMED: the exe's trig argument scale; see the file header.
      b.y = GALGRYPHON_HEIGHT_B.yRiseHold + h + h * Math.cos(39 - n);
    } else {
      b.y = GALGRYPHON_HEIGHT_B.yRiseHold + h - h * Math.sin(n);
    }
    b.pitch = galRoundB((n * -5120.0) / 19.5);
    b.n = n + 1;
    if (b.n === 11) ctx.setAnim(GALGRYPHON_ANIM_B.run);
    if (b.n > 39) {
      b.pitch = 0;
      b.y = ctx.rt.s19Base;
      b.sub = 1;
    }
    if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e7)) ctx.fx.groundProbe();
  } else if (b.sub === 1) {
    moveForwardB(b, 0.25, b.heading);
    // ASSUMED: progress is the motion time; the exe's cos argument scale is not decoded.
    b.y = ctx.rt.s19Base - (ctx.rt.s19Base - GALGRYPHON_HEIGHT_B.y180) * Math.cos(ctx.motion.elapsed());
    if (ctx.motion.step() <= 0) ctx.advance();
  }
};

/** S20 (0x004a4468): takeoff; advance once the chain reaches walk (record flags 0xb). */
export const galStateB20: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.takeoff);
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  if (ctx.motion.recordFlags() === 0xb) ctx.advance();
};

/** S21 (0x004a44d0): walk / approach, the damping and speed by distance band. */
export const galStateB21: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.walk);
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    b.flags |= 0x30;
    return;
  }
  if (phase === 5) {
    b.flags &= ~0x30;
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  ctx.fx.footsteps();
  ctx.fx.lerpBattle();
  ctx.fx.attackDispatch();
  const d = ctx.motion.elapsed();
  let damp: number;
  let speed: number;
  let turn: number;
  let pairB: number;
  let pairC: number;
  if (d < 10.0 || d >= 17.0) {
    damp = 0.9;
    speed = 0.0;
    turn = 0;
    pairB = ctx.rt.pairC0;
    pairC = ctx.rt.pairBC;
  } else {
    damp = 0.86;
    speed = 1.0;
    turn = 208;
    pairB = ctx.rt.pairB8;
    pairC = ctx.rt.pairB4;
  }
  if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e0_5)) {
    speed += 9.0;
    turn += 1280;
  }
  dampB(b, damp, pairB, pairC);
  moveForwardB(b, speed, b.heading);
  steerToDirB(b, turn);
};

/** S22 (0x004a487c): huse-out / strike prep (the speed is a per-tick impulse at event 3). */
export const galStateB22: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.huseout);
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    b.flags |= 0x30;
    return;
  }
  if (phase === 5) {
    b.flags &= ~0x30;
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  const near = ctx.motion.elapsed() < 15.0;
  const damp = near ? 0.9 : 0.86;
  const pairB = near ? ctx.rt.pairC0 : ctx.rt.pairB8;
  const pairC = near ? ctx.rt.pairBC : ctx.rt.pairB4;
  let speed = 0;
  if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e3)) speed += 11.0;
  dampB(b, damp, pairB, pairC);
  moveForwardB(b, speed, b.heading);
  if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e15)) {
    ctx.fx.effectAt(b.x, 0, b.z, 0, 0); // effect id from the +0x17e struct (not decoded)
    ctx.fx.initEntity();
    ctx.fx.sfx(GALGRYPHON_SFX_B.sfx3a7);
  }
  if (ctx.motion.step() <= 0) ctx.advance();
};

/** S23 (0x004a4a08): huse loop; the emit at event 10 and the chain into huse (record flags 0xe). */
export const galStateB23: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.houko);
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    return;
  }
  if (phase === 5) {
    ctx.fx.disableMinions();
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  ctx.fx.phaseStats();
  if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e10)) ctx.fx.spawnRing(b.x, b.y, b.z, b.heading);
  if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e1)) ctx.fx.sfx(GALGRYPHON_SFX_B.sfx3a8);
  if (ctx.motion.recordFlags() === 0xe) ctx.advance();
};

/** S24 (0x004a4b9c): huse (the ring at the enter; script duration only). */
export const galStateB24: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.huse);
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    ctx.fx.spawnRing(b.x, b.y, b.z, b.heading);
    return;
  }
  if (phase === 5) {
    ctx.fx.disableMinions();
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  ctx.fx.phaseStats();
};

/** S25 (0x004a4c20): husein; advance when the motion finishes. */
export const galStateB25: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.husein);
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    ctx.fx.spawnRing(b.x, b.y, b.z, b.heading);
    return;
  }
  if (phase === 5) {
    ctx.fx.disableMinions();
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  ctx.fx.phaseStats();
  if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e5)) ctx.fx.disableMinions();
  if (ctx.motion.step() <= 0) ctx.advance();
};

/** S26 (0x004a4cd8): dead (the death motion); advance on the chain into kiri (record flags 0x11). */
export const galStateB26: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.dead);
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e19)) ctx.fx.sfx(GALGRYPHON_SFX_B.sfx3a9);
  if (ctx.motion.recordFlags() === 0x11) ctx.advance();
};

/**
 * S27 (0x004a4d6c): kiri, the lightning barrage. The dump's decompile (dump 224954):
 * the under-body effect and the projectile transform when P > 1, the beam every 20 ticks
 * when P > 3, the SFX 0x3ab each tick, and the counter m (+0x6ec) is the spin.
 */
export const galStateB27: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.kiri);
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    ctx.fx.spawnRing(b.x, b.y, b.z, b.heading);
    b.m = 0;
    ctx.fx.lightningSetup();
    ctx.rng.reseed();
    return;
  }
  if (phase === 5) {
    ctx.fx.lightningRelease();
    ctx.fx.disableMinions();
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  ctx.fx.phaseStats();
  if (ctx.players > 1) {
    ctx.fx.lightningUnderBody();
    ctx.fx.lightningTransform(60.0);
  }
  if (ctx.players > 3 && b.m % 20 === 0) {
    // the raw get_random_int >> 16 value; the exe scales it by constants not decoded (ASSUMED in the hook)
    ctx.fx.spawnBeam(((b.m / 20) & 1) === 0, ctx.rng.next16());
  }
  ctx.fx.sfx(GALGRYPHON_SFX_B.sfx3ab);
  b.m += 1;
};

/** S28 (0x004a5530): kiriland; advance when the motion finishes. */
export const galStateB28: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.kiriland);
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e6)) ctx.fx.sfx(GALGRYPHON_SFX_B.sfx3aa);
  if (ctx.motion.step() <= 0) ctx.advance();
};

/**
 * S29 (0x004a55c8): kirin, the fall. Sub 0: the drop along t^2 (the exe's t is the motion
 * time); event 5 starts sub 1: the rise of 40 a tick for 40 ticks, then the stage 3 dive
 * height (8000) with pitch 0x4000 and the advance (chain 20 = kirin, flags 0x13).
 */
export const galStateB29: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.kirin);
    b.stage = 1;
    b.flags |= 4;
    b.y = GALGRYPHON_HEIGHT_B.y180;
    b.n = 0;
    b.sub = 0;
    return;
  }
  if (phase === 5) {
    b.stage = 3;
    b.y = GALGRYPHON_HEIGHT_B.y8000;
    b.pitch = 0x4000;
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  if (b.sub === 0) {
    const t = ctx.motion.elapsed();
    b.y = ((ctx.rt.s29Base - GALGRYPHON_HEIGHT_B.y180) * t * t) / 25.0 + GALGRYPHON_HEIGHT_B.y180;
    if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e5)) {
      b.n = 0;
      b.sub = 1;
    }
  } else if (b.sub === 1) {
    b.y += 40.0;
    b.n += 1;
    if (b.n > 39) {
      b.stage = 3;
      b.y = GALGRYPHON_HEIGHT_B.y8000;
      b.pitch = 0x4000;
      ctx.advance();
    }
  }
};

/**
 * S30 (0x004a5734): the dive. The dump's decompile (dump 225347) is the source here; the
 * -b doc's offsets and path math differ from it and are not used.
 *  enter: anim kiriout (20), stage 3, flags |= 4, y 8000, pitch 0x4000, the beam counter
 *         n = ROUND(duration - 75), the slope k = (8000 - defaultY) / (duration - 32.5);
 *  sub 0: the heading steer (near the origin: toward dir; else toward the origin), the
 *         speed 3, the height falls by the slope, a random target (a live player at 50%,
 *         else a ground point), the beam every 5 ticks, SFX 0x3ac at 20;
 *         when n <= k: sub 1, anim runin (22), flags |= 1 and clear 4;
 *  sub 1: forward speed 1, pitch from the height ramp, pitchB = 933.7857 * (7 - t)^2,
 *         event 7 -> sub 2 (pitch 0, pitchB 0);
 *  sub 2: forward speed 1, the fall; event 17 -> stage 0, y defaultY, SFX 0x3a7, the
 *         effect, the camera shake, initEntity, sub 3.
 */
export const galStateB30: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.kiriout);
    b.stage = 3;
    b.flags |= 4;
    b.y = GALGRYPHON_HEIGHT_B.y8000;
    ctx.fx.sfx(GALGRYPHON_SFX_B.sfx3b2);
    ctx.rng.reseed();
    b.pitch = 0x4000;
    b.k = 0;
    const dur = ctx.recordDuration;
    // ClampTextureCoordinate_0083a248(75.0) and (32.5): the exe's clamp, ASSUMED to be the value
    b.n = galRoundB(dur - 75.0);
    b.slope = (GALGRYPHON_HEIGHT_B.y8000 - ctx.rt.defaultY) / (dur - 32.5);
    b.sub = 0;
    return;
  }
  if (phase === 5) {
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    b.pitch = 0;
    b.pitchB = 0;
    b.flags &= ~4;
    return;
  }
  if (phase === 8) {
    if (b.sub >= 0 && b.sub < 2) ctx.fx.updateTargeting();
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  if (b.sub === 1) {
    moveForwardB(b, 1.0, b.heading);
    b.y -= b.slope;
    const t = ctx.motion.elapsed();
    const h = t;
    b.pitch = galRoundB((h / -7.0 + 1.0) * -49152.0 + 65536.0);
    b.pitchB = galRoundB(933.7857 * (7.0 - h) * (7.0 - h));
    if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e7)) {
      b.sub = 2;
      b.pitch = 0;
      b.pitchB = 0;
    }
    return;
  }
  if (b.sub === 2) {
    moveForwardB(b, 1.0, b.heading);
    b.y -= b.slope;
    if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e17)) {
      b.stage = 0;
      b.y = ctx.rt.defaultY;
      ctx.fx.sfx(GALGRYPHON_SFX_B.sfx3a7);
      ctx.fx.effectAt(b.x, 0, b.z, 0, 0x40);
      ctx.fx.cameraShake();
      ctx.fx.initEntity();
      b.sub = 3;
    }
    return;
  }
  if (b.sub !== 0) return;

  // sub 0
  if (b.x * b.x + b.z * b.z <= 102400.0) {
    ctx.fx.initVelocity();
    turnTowardB(b, 256, bamsAtan2(b.dirX, b.dirZ));
  } else {
    ctx.fx.initVelocity();
    turnTowardB(b, 256, bamsAtan2(-b.x, -b.z));
  }
  moveDirB(ctx, 3.0);
  b.y -= b.slope;
  b.pitchB += 0x3311;
  if (b.n <= b.k) {
    b.sub = 1;
    ctx.setAnim(GALGRYPHON_ANIM_B.runin);
    ctx.motion.setFlagsB0(4, 1);
  }

  // the target (dump 225347, after the heading): the draw order is the angle, one unused
  // draw, then the test draw (> 0.5 = a live player's ring); the ground search keeps the
  // last probed point. The bounds on the loops are ASSUMED (the exe loops until a hit).
  const ang0 = ctx.rng.next16();
  ctx.rng.next16();
  let target: { x: number; y: number; z: number } | null = null;
  if (ctx.rng.next16() / 65536 > 0.5) {
    const slot = galRoundB((ctx.rng.next16() / 65536) * 4.0);
    const p = ctx.fx.playerPos(slot);
    if (p) {
      let ang = ang0;
      const r = 50.0; // c78 (ASSUMED: the exe's unaff_EBP is not decoded; 1.0 * 50)
      for (let tries = 0; tries < 64; tries++) {
        const pt = { x: bamsSin(ang) * r + p.x, y: p.y + 50.0, z: bamsCos(ang) * r + p.z };
        const g = ctx.fx.groundAt(pt.x, pt.z);
        ang += 0x2000;
        if (g !== null && g <= GALGRYPHON_HEIGHT_B.groundLimit) {
          target = { x: pt.x, y: g, z: pt.z };
          break;
        }
      }
    }
  }
  if (!target) {
    let r = 360.0; // c74 (ASSUMED multiplier 1.0)
    for (let tries = 0; tries < 256; tries++) {
      const pt = { x: bamsSin(ang0) * r, y: 0, z: bamsCos(ang0) * r };
      const g = ctx.fx.groundAt(pt.x, pt.z);
      r += -4.0;
      if (g !== null && g <= GALGRYPHON_HEIGHT_B.groundLimit) {
        target = { x: pt.x, y: g, z: pt.z };
        break;
      }
    }
    if (!target) target = { x: 0, y: 0, z: 0 };
  }

  const h2 = bamsAtan2(target.x - b.x, target.z - b.z);
  const from = { x: bamsSin(h2) * 50.0 + b.x, y: b.y + 50.0, z: bamsCos(h2) * 50.0 + b.z };
  if (b.k % 5 === 0) ctx.fx.diveBeam(from, target);
  if (b.k === 20) ctx.fx.sfx(GALGRYPHON_SFX_B.sfx3ac);
  b.k += 1;
};

/** S31 (0x004a5eec): kakuin, the beam ring at the 22.0 event (dump 225636). */
export const galStateB31: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.kakuin);
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e22)) {
    // the midpoint of the two stored points (dump 225636: 0.5 * (+0x3d4 + +0x3e0) etc.)
    const mid = {
      x: (b.pA.x + b.pB.x) * 0.5,
      y: (b.pA.y + b.pB.y) * 0.5,
      z: (b.pA.z + b.pB.z) * 0.5,
    };
    ctx.fx.spawnMinionRing(mid.x, mid.y, mid.z);
    ctx.fx.cameraShake();
    ctx.fx.sfx(GALGRYPHON_SFX_B.sfx3a0);
  }
  if (ctx.motion.step() <= 0) ctx.advance();
};

/** S32 (0x004a606c): runout; the footstep SE at 12; advance when the motion finishes. */
export const galStateB32: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    ctx.setAnim(GALGRYPHON_ANIM_B.runout);
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    b.flags &= ~4;
    return;
  }
  if (phase === 5) {
    b.stage = 0;
    b.y = ctx.rt.defaultY;
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e12)) ctx.fx.sfx(GALGRYPHON_SFX_B.sfx3b1);
  if (ctx.motion.step() <= 0) ctx.advance();
};

/**
 * S33 (0x004a6120): fly / travel. The anim is by the stage: 0 fly, 1 kakuout, 2 op.
 * Stage 1 probes the ground at event 14; stage 2 flies forward at 3. Script duration only.
 */
export const galStateB33: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    if (b.stage === 0) ctx.setAnim(GALGRYPHON_ANIM_B.fly);
    else if (b.stage === 1) ctx.setAnim(GALGRYPHON_ANIM_B.kakuout);
    else if (b.stage === 2) ctx.setAnim(GALGRYPHON_ANIM_B.op);
    return;
  }
  if (phase !== 0) return;
  ctx.motion.tick();
  if (b.stage === 1) {
    if (ctx.motion.frameEvent(GALGRYPHON_EVENT_B.e14)) ctx.fx.groundProbe();
  } else if (b.stage === 2) {
    moveForwardB(b, 3.0, b.heading);
  }
};

/** S34 (0x004a61bc): remove. Enter sets the kill flag (0x80) and the delete bit; no frame, no leave. */
export const galStateB34: GalgryphonHandlerB = (ctx, phase) => {
  const b = ctx.b;
  if (phase === 4) {
    b.flags |= 0x80;
    ctx.fx.markRemoved();
  }
};

/** The table for states 18..34, by state index. */
export const GALGRYPHON_STATE_HANDLERS_B: Readonly<Record<number, GalgryphonHandlerB>> = {
  18: galStateB18,
  19: galStateB19,
  20: galStateB20,
  21: galStateB21,
  22: galStateB22,
  23: galStateB23,
  24: galStateB24,
  25: galStateB25,
  26: galStateB26,
  27: galStateB27,
  28: galStateB28,
  29: galStateB29,
  30: galStateB30,
  31: galStateB31,
  32: galStateB32,
  33: galStateB33,
  34: galStateB34,
};

/**
 * Runs one phase of a state in 18..34 (the table lookup; other states return false).
 * The per-frame order (the frame update, dump 226140) is the caller's.
 */
export function runGalgryphonStateB(ctx: GalgryphonStateCtxB, state: number, phase: number): boolean {
  const h = GALGRYPHON_STATE_HANDLERS_B[state];
  if (!h) return false;
  h(ctx, phase);
  return true;
}

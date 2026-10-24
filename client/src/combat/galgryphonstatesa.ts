// The Gal Gryphon brain, states 0..17 (PsoBB.exe, Ephinea 1.25.13, addresses are VAs).
//
// Each state is a ProcessState slot of the table at 0x009a7e40 (8 bytes per state: the
// handler, then an adjust word). A handler takes the phase: 4 = enter, 5 = leave, 0 = frame,
// 8 = sync (non-leader path), 9 = the alive dispatch from HandleGalgryphonState9_004a7360,
// 2 / 0xb = no-op in these states. Phase 3 is read only by S3 (its dispatcher is UNCLEAR).
//
// The exe's handlers write the boss's fields by byte offset (+0x38 x, +0x3c height, +0x40 z,
// +0x60 heading, +0x6e4 / +0x6e8 sub-step and counter, ...). Those are named here in `GalgryphonBody`;
// the byte offset is in each field's comment. The motion, FX, camera, world and network calls are
// host hooks in `GalgryphonStateCtx`; this file only decides when to call them.
//
// Sources, in order of trust: the decompile of each handler (dump names are not always right: the
// handler names in the dump do not say which state they are, so the states were matched by address
// through the table), the disassembly for the FPU argument of sin16 / cos16 (the decompile drops it),
// then docs/bosses/galgryphon-states-a.md. Where the doc and the exe disagree, the exe is followed and
// the difference is noted in the comment. ASSUMED marks what is inferred. Part B (S18..S34) is in
// galgryphonstatesb.ts and uses the same context.
//
// Dump: reverse/refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c.

import type { GalgryphonPacket } from './galgryphonscript.ts';
import type { Vec3 } from './galgryphon.ts';

/** The phases a handler is called with (the exe's ProcessState phase numbers). */
export const GALGRYPHON_PHASE = {
  /** Enter the state (the table's enter call). */
  enter: 4,
  /** Leave the state. */
  leave: 5,
  /** Frame update (the state's tick). */
  frame: 0,
  /** Sync on the non-leader path (FUN_004a12dc: the target refresh and the 6x9F send). */
  sync: 8,
  /** The alive dispatch of HandleGalgryphonState9_004a7360 (the default-list walk in S4). */
  dispatch: 9,
  /** Phase 2: a no-op in these states except S4 (where it is the same walk as 9). */
  walk: 2,
  /** Phase 3: S3's wait (its dispatcher is UNCLEAR). */
  wait: 3,
} as const;

/** The bits of +0x4c8 (`GalgryphonBody.flags`) that states 0..17 set or read. Names are ASSUMED. */
export const GALGRYPHON_FLAG = {
  /** 0x4: busy while a motion is run by the state (S6, S11, S12, S15, S16, S17). */
  busy: 0x4,
  /** 0x10: walking (S2). */
  walk: 0x10,
  /** 0x40: the death cinematic (S5). */
  death: 0x40,
  /** 0x80: the entrance cinematic (S4, and S5 clears it on leave). */
  intro: 0x80,
  /** 0x100: kiri mode. Set by S17 and never cleared in states 0..17; S13 and S14 read it. */
  kiri: 0x100,
} as const;

/**
 * The heights the handlers write (+0x3c, the exe's y). `hoverLow` is DAT_00a47564, the default height,
 * which the dump never writes (it is in .bss): ASSUMED 0. `hoverHigh` is 180.0 (0x43340000).
 */
export const GALGRYPHON_HEIGHT = {
  hoverLow: 0,
  hoverHigh: 180,
} as const;

/** The entrance home position (S4, DAT_009a8130 / DAT_009a8134 / DAT_009a8138: x 23, y 180, z 991). */
export const GALGRYPHON_HOME = { x: 23, y: 180, z: 991 } as const;

/** The raw heading and pitch the entrance writes on leave (DAT_00903ec4 = 36734; DAT_00903ec0 is a NaN bit pattern, ASSUMED 0 here). */
export const GALGRYPHON_HOME_HEADING = 36734;

const TAU = 2 * Math.PI;

/** ROUND in the exe: floor(x + 0.5) (ASSUMED for negative values; the decompile's ROUND is the same shape). */
export function round(x: number): number {
  return Math.floor(x + 0.5);
}

/** The exe's (short) cast: wraps an int to a signed 16-bit value. */
export function short(x: number): number {
  return (x << 16) >> 16;
}

/**
 * ROUND(fpatan(...) * 65536 / 2pi): the BAMS angle of a radian angle. The exe's `fpatan(a, b)` is
 * atan2(a, b), so the heading of a vector (x, z) is `angle16FromRadians(Math.atan2(x, z))`.
 */
export function angle16FromRadians(r: number): number {
  return round((r * 65536) / TAU);
}

/**
 * sin16 / cos16 (FUN_0082dcbc / FUN_0082ddd8, the 4096-entry tables at 0x0098b560 / 0x0098c560). The
 * argument is a 16-bit BAMS angle in the ecx register. ASSUMED: the exact table with its low-nibble
 * interpolation is replaced by Math.sin / Math.cos (within 1e-4 of the table).
 */
export function sin16(a: number): number {
  return Math.sin(((a & 0xffff) * TAU) / 65536);
}

export function cos16(a: number): number {
  return Math.cos(((a & 0xffff) * TAU) / 65536);
}

/**
 * The trig argument the handlers compute as `(int)(frame * K / D)` on the x87 stack (fistp with
 * truncation, RC = 11). K is 16384.0 (0x00903eac / 0x00903de4 / 0x00903e10): a quarter turn.
 */
export function quarterTurnAngle(n: number, divisor: number): number {
  return Math.trunc((n * 16384) / divisor);
}

/** The motion helpers the states call (FUN_007aa094 and its readers, dump names aside). */
export interface GalgryphonMotion {
  /** +0xb8 = slot, then the set-animation call (vtable +0x184 / +0x188 -> FUN_007a9a6c). */
  play(slot: number): void;
  /** +0xb8 = slot only: a raw write with no set-animation call (S3, S4, S16's slot 8). */
  write(slot: number): void;
  /** FUN_007aa094: advance the motion by +0xc8, switch modes, set +0xb0 bits. */
  tick(): void;
  /** FUN_007aabd8: the motion frame (+0xc0), not a distance. 0 while +0xb0 & 4. */
  frame(): number;
  /** +0xc4: the end frame of the playing motion. */
  endFrame(): number;
  /** +0xc8: the playing row's speed. The states test it as `<= 0` for "motion ended". */
  speed(): number;
  /** +0xb0 & 0x10: the motion has finished (mode 3 at its end, PROVEN for S4 / S5). */
  finished(): boolean;
  /** +0xb4: the slot number of the playing row (the row flags column equals the slot). */
  playing(): number;
  /** FUN_007aaa30(f): frame f was crossed on this tick. */
  crossed(frame: number): boolean;
}

/** The boss's own fields (exe byte offsets in the comments). Mutated by the handlers. */
export interface GalgryphonBody {
  /** +0x38: x. */
  x: number;
  /** +0x3c: the height (the exe's y). */
  h: number;
  /** +0x40: z. */
  z: number;
  /** +0x60: heading, a 16-bit BAMS angle. */
  heading: number;
  /** +0x5c: pitch, a 16-bit BAMS angle (the animation's tilt). */
  pitch: number;
  /** +0x64: the S14 damping accumulator (ASSUMED name). */
  tilt: number;
  /** +0x488: the turn accumulator (FUN_004a5e10 and the records' turn). */
  turn: number;
  /** +0x47c / +0x484: the velocity accumulators (FUN_004a15ac). */
  vx: number;
  vz: number;
  /** +0x4c8: the flag bits (GALGRYPHON_FLAG). */
  flags: number;
  /** +0x4ec: the stage (ASSUMED name: 0 at rest, 1 flying, 2 hovering). */
  stage: number;
  /** +0x6e4: the sub-step of the state (S3's counter in S3). */
  sub: number;
  /** +0x6e8: the state's counter (S6's sub-step; the frame counter of S4, S5, S12, S16, S17). */
  aux: number;
  /** +0x6f4: S10's target angle (waypoint heading). */
  waypointAngle: number;
  /** +0x498: the sync counter (FUN_004a12dc: the 6x9F send is on every 32nd). */
  syncCount: number;
  /** +0x44c..+0x454: the muzzle point (the beam origin and the minion's launch point). */
  muzzle: Vec3;
  /** +0x72c: S7's beam handle (null when none). */
  beam: GalgryphonFxHandle | null;
  /** +0x3a8 / +0x3b0: the vector to the target (x, z), and its length +0x3b4. Set by targetVector(). */
  toTargetX: number;
  toTargetZ: number;
  toTargetLen: number;
  /** +0x394 (entity id), +0x39c (target x), +0x3a4 (target z). The target the sync finds. */
  target: { id: number; x: number; z: number };
  /** +0x6f0: the entrance aura flag (S4 sets it on enter, clears it on leave). */
  aura: number;
}

/** An FX object the host made (the exe's effect object). Opaque to the states. */
export type GalgryphonFxHandle = object;

/** The FX, sound and muzzle hooks. The host maps the exe's ids to its own assets. */
export interface GalgryphonFx {
  /** A literal effect index (FUN_0050b7a4's index: 0x201, 0x20d, ...), at a point. */
  spawn(effect: number, at: Vec3): GalgryphonFxHandle | null;
  /** A template slot of the boss's FX table (+0x5f8: slot k is the k-th int, 0 .. 0x18). */
  spawnSlot(slot: number, at: Vec3): GalgryphonFxHandle | null;
  /** FUN_00508db8: move a handle to a point (the beam origin follows +0x44c). */
  move(handle: GalgryphonFxHandle, at: Vec3): void;
  /** The dead bit on one handle (FUN_0050981c's kill path). */
  kill(handle: GalgryphonFxHandle): void;
  /** FUN_004a8a88: the dead bit on every handle the boss holds (+0x73c..+0x778), then clear them. */
  releaseHandles(): void;
  /** A sound. `emitter` 'body' is the boss's sound position (+0x568); 'none' is no position. */
  se(id: number, emitter: 'body' | 'none'): void;
  /** FUN_008144b0: the looped positional sound at the boss (0x39c in S13 and S14). */
  seLoop(id: number): void;
  /** FUN_004a0f70: the muzzle shots driven by the frame thresholds (S2). Host-side values. */
  muzzleShots(): void;
  /** FUN_004a15e8: the two front shots (S6). */
  frontShots(): void;
  /** FUN_004a1f34: the landing FX and rings (S11, S15). */
  landing(): void;
  /** FUN_004a92b4 and FUN_005caba4: the entrance aura (S4 enter). */
  aura(): void;
  /** FUN_004ab934: the entrance's per-frame update (S4 frame 265). */
  auraUpdate(): void;
  /** The S13 / S14 visuals: the beam ribbon and its three FX (FUN_004a323c / FUN_004a3314). */
  kiriBeam(): void;
  kiriFx(): void;
  /** The S13 / S14 visuals: the lightning mesh and its second part (FUN_004a2bb0 / FUN_004a2ea8). */
  lightning(): void;
  lightningAux(): void;
}

/** The cinematic hooks (the director, the player freeze, the audio, the death camera). */
export interface GalgryphonCine {
  /** FUN_00520e2c: start the entrance cinematic (its list and HUD). */
  begin(): void;
  /** FUN_00520e34: end it (S4 leave). */
  end(): void;
  /** probably_disable_hud_and_screen_elements: hide the HUD for the entrance and the death. */
  hideHud(): void;
  /** FUN_00717f74 (on) / FUN_00717f38 (off): freeze and release the players' slots. */
  freezePlayers(on: boolean): void;
  /** FUN_004d430c: a camera shake of amplitude `amp` for `frames`. */
  shake(amp: number, frames: number): void;
  /** FUN_004d4288(k): the shake presets 0, 1 and 2 (the event queue tag is part of the preset). */
  shakePreset(k: 0 | 1 | 2): void;
  /** The death cinematic's start: the audio "dradeath.adx", the director mode, its event and camera. */
  deathStart(): void;
  /** FUN_004d3250: the death cinematic's end (the boss-cam copy). */
  deathEnd(): void;
  /** FUN_004d6770: the director event by id (0x31c7 at the death start, 0x238e at the aura). */
  event(id: number): void;
}

/** The world hooks: the sphere query and the move attempt. */
export interface GalgryphonWorld {
  /** FUN_004a15fc: the ground impact at the boss point (sphere query, mask 0x16ef, y <= 6; FX 0 and SE 0x39b). */
  groundImpact(): void;
  /** FUN_00521454 (ExecutePlayerHitCheckForGalgryphon): the step request with its flag and distance. */
  hitCheck(flag: number, dist: number): void;
}

/** The death and quest hooks. */
export interface GalgryphonDeath {
  /** FUN_0051f894: on-killed (FUN_00787534, then the 6x76 set-flags send FUN_008113e4). */
  killed(): void;
  /** FUN_006bb100(id): the quest flag (6x75 when the mode is 0xb, else a local bit). */
  setQuestFlag(id: number): void;
}

/** The network and targeting hooks. */
export interface GalgryphonNet {
  /** FUN_004a1328: the 6x9F target send (entity id, target x, target z). */
  sendTarget(id: number, x: number, z: number): void;
  /** EnemyEntity_FindTargetInRange: the target search, every sync tick. */
  findTarget(): void;
  /** The 32-tick refresh: the ray to the target and SetEnemyTargetPosition (or the default). */
  refreshTarget(): void;
}

/**
 * The shared context of the handlers, for states 0..17 here and states 18..34 in galgryphonstatesb.ts.
 * The dispatcher sets `phase` before each call. The handler reads `rec` (the current pattern record,
 * +0x4c4) and the body, and calls the hooks. Nothing here is random: the default-list walk runs in the host.
 */
export interface GalgryphonStateCtx {
  /** The phase of this call (GALGRYPHON_PHASE), set by the dispatcher. */
  phase: number;
  /** The boss's fields. */
  readonly body: GalgryphonBody;
  /** The current pattern record (+0x4c4), or null before the first record. */
  readonly rec: GalgryphonPacket | null;
  readonly motion: GalgryphonMotion;
  readonly fx: GalgryphonFx;
  readonly cine: GalgryphonCine;
  readonly world: GalgryphonWorld;
  readonly death: GalgryphonDeath;
  readonly net: GalgryphonNet;
  /** The minion throw of S7 (the host's GalgryphonMinionManager.throw). */
  throwMinion(origin: Vec3, offset: Vec3, target: { x: number; z: number }, slot: number): void;
  /** The event queue (FUN_006ff5f8: tag and argument). Its consumer is not decoded. */
  queue(tag: number, arg: number): void;
  /** FUN_0068d5a8(slot): a player is present in that slot (0..11). */
  playerPresent(slot: number): boolean;
  /** FUN_004a7e20: move to the next record (its state becomes current when it differs). */
  advance(): void;
  /** FUN_0051f62c(state): change the state now (leave the old one, enter the new one). */
  changeState(state: number): void;
  /** FUN_004a8d5c: the default-list walk. The host runs the walker and sends its packet (the loopback sets the state). */
  walkDefault(): void;
}

/** A handler of one state. The phase is in `ctx.phase`. */
export type GalgryphonHandler = (ctx: GalgryphonStateCtx) => void;

// ---- shared movement helpers (the states use these; part B imports them) -----------------------

/**
 * FUN_004a15ac(speed, heading): the step. The velocity accumulators take sin(heading) and cos(heading)
 * times the speed (PROVEN from the helper's code, +0x47c and +0x484).
 */
export function stepVelocity(b: GalgryphonBody, speed: number, heading: number): void {
  b.vx += sin16(heading) * speed;
  b.vz += cos16(heading) * speed;
}

/**
 * FUN_00521410 (the target vector, InitializeEnemyAnimationVelocity_* in the dump): +0x3a8 = target x - x,
 * +0x3b0 = target z - z, +0x3b4 = the length. The dump normalises the vector in place: ASSUMED here, the
 * states only use its angle (atan2 is scale-free) and the length.
 */
export function targetVector(b: GalgryphonBody): void {
  b.toTargetX = b.target.x - b.x;
  b.toTargetZ = b.target.z - b.z;
  b.toTargetLen = Math.hypot(b.toTargetX, b.toTargetZ);
}

/**
 * FUN_004a5e10(rate, target) (SetGalgryphonRotationAngle_004a5e10, dump 225565): d = target - heading;
 * e = turn - ROUND(d * 0.6) (16-bit); the turn accumulator takes e clamped to +-rate.
 */
export function turnToward(b: GalgryphonBody, rate: number, target: number): void {
  const d = short(target - b.heading);
  const e = short(b.turn - round(d * 0.6));
  const clamped = e < -rate ? -rate : e > rate ? rate : e;
  b.turn -= clamped;
}

/** FUN_004a1b84(rate): the vector to the target, then turn toward its bearing. */
export function steerToTarget(b: GalgryphonBody, rate: number): void {
  targetVector(b);
  turnToward(b, rate, angle16FromRadians(Math.atan2(b.toTargetX, b.toTargetZ)));
}

/** FUN_004a1a48: the ground check of S8..S10: the impact at frame 14. */
function groundCheck(c: GalgryphonStateCtx): void {
  if (c.motion.crossed(14)) c.world.groundImpact();
}

/** FUN_004a0f10: the sound at the motion frames 21, 5, 20 and 8 (S2). */
function animationSound(c: GalgryphonStateCtx): void {
  if (c.motion.crossed(21) || c.motion.crossed(5) || c.motion.crossed(20) || c.motion.crossed(8)) {
    c.fx.se(0x3a2, 'body');
  }
}

/**
 * The sync tick (FUN_004a12dc, OlgaMinionUpdateTargeting_004a12dc in the dump): the target search on
 * every call; on every 32nd (+0x498 & 0x1f == 0) the refresh and the 6x9F send; then the counter goes up.
 */
function syncTick(c: GalgryphonStateCtx): void {
  const b = c.body;
  c.net.findTarget();
  if ((b.syncCount & 0x1f) === 0) {
    c.net.refreshTarget();
    c.net.sendTarget(b.target.id, b.target.x, b.target.z);
  }
  b.syncCount += 1;
}

const P = GALGRYPHON_PHASE;
const F = GALGRYPHON_FLAG;

// ---- the states --------------------------------------------------------------------------------

/** S0 (`0x004a8e34`): the empty placeholder. Every phase returns at once. */
const s0: GalgryphonHandler = () => {};

/** S1 (`0x004a0d8c`, HandleGalgryphonState_004a0d8c): idle. The only exit is from outside. */
const s1: GalgryphonHandler = (c) => {
  if (c.phase === P.enter) {
    c.motion.play(0);
    c.body.stage = 0;
    c.body.h = GALGRYPHON_HEIGHT.hoverLow;
  } else if (c.phase === P.frame) {
    c.motion.tick();
  }
};

/**
 * S2 (`0x004a0dd8`, HandleGalgryphonState2_004a0dd8): walk toward the target. The step is a
 * hit check with (0x100, 1.8) when the motion frame is in [0,4), [10,18) or [25,inf).
 */
const s2: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(1);
    b.flags |= F.walk;
    b.stage = 0;
    b.h = GALGRYPHON_HEIGHT.hoverLow;
    b.syncCount = 0;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    animationSound(c);
    targetVector(b);
    c.fx.muzzleShots();
    const d = c.motion.frame();
    if (d < 4) c.world.hitCheck(0x100, 1.8);
    else if (d < 10) return;
    else if (d < 18) c.world.hitCheck(0x100, 1.8);
    else if (d >= 25) c.world.hitCheck(0x100, 1.8);
  } else if (c.phase === P.sync) {
    syncTick(c);
  } else if (c.phase === P.leave) {
    b.flags &= ~F.walk;
  }
};

/**
 * S3 (`0x004a2744`, FUN_004a2744): wait with the stand motion. Each frame with a player in slots 0..3
 * adds 1 to the counter (+0x6e4); phase 3 moves to S11 after more than 150 counted frames. The frame
 * does not tick the motion (the exe does not call FUN_007aa094 here).
 */
const s3: GalgryphonHandler = (c) => {
  if (c.phase === P.enter) {
    c.motion.write(0);
    c.body.sub = 0;
  } else if (c.phase === P.frame) {
    if (c.playerPresent(0) || c.playerPresent(1) || c.playerPresent(2) || c.playerPresent(3)) c.body.sub += 1;
  } else if (c.phase === P.wait) {
    if (c.body.sub > 150) c.changeState(11);
  }
};

/**
 * S4 (`0x004a22b0`, GalgryphonUpdateState_004a22b0): the entrance. The op motion (slot 25, 500 frames)
 * runs with its timeline of FX, sounds and queue events. When it finishes, the sub-step goes to 1 and
 * the boss is put at home; sub 1 is the walk of the default list (phase 2 / 9). Sub-step writes:
 * enter 0, the motion end 1, and the home copy each frame.
 */
const s4: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    // init: DAT_009a8134 = 180 (the first run only; the value is 180 on every run).
    b.h = GALGRYPHON_HOME.y;
    b.stage = 1;
    c.motion.write(0);
    c.motion.tick();
    b.x = 0;
    b.h = 0;
    b.z = 0;
    b.pitch = 0;
    b.heading = 0;
    b.tilt = 0;
    b.sub = 0;
    b.aura = 1;
    b.flags |= F.intro;
    b.aux = 0;
    c.fx.aura();
    c.motion.write(25);
    // The exe also calls UpdateDerolleNodes here (dump name; not ported, its effect on the boss is unread).
    c.cine.begin();
  } else if (c.phase === P.walk || c.phase === P.dispatch) {
    if (b.sub === 1) c.walkDefault();
  } else if (c.phase === P.frame) {
    if (b.sub === 0) {
      c.motion.tick();
      if (c.motion.finished()) {
        b.sub = 1;
        c.cine.hideHud();
        c.motion.write(4);
      }
      // The timeline. Only one of the 68 / 210 / 420 / 463 events fires; the sounds are separate.
      if (c.motion.crossed(68)) {
        c.fx.spawnSlot(1, { x: 27, y: 0, z: 175 });
        c.queue(0x1c, 0x3c);
      } else if (c.motion.crossed(210)) {
        c.fx.spawnSlot(1, { x: 153, y: 437, z: 1347 });
        c.queue(0xc0, 0xf);
      } else if (c.motion.crossed(420) || c.motion.crossed(463)) {
        c.fx.spawnSlot(0, { x: 153, y: 437, z: 1347 });
      }
      if (c.motion.crossed(290)) {
        c.fx.se(0x39a, 'none');
        c.queue(0xa0, 0x3c);
      }
      if (c.motion.crossed(100) || c.motion.crossed(405)) c.fx.se(0x3a3, 'none');
      if (c.motion.crossed(210)) c.fx.se(0x3a7, 'none');
      if (c.motion.crossed(455)) {
        c.fx.se(0x3a3, 'none');
        c.queue(0x80, 7);
      }
      if (c.motion.crossed(265)) c.fx.auraUpdate();
    } else if (b.sub === 1) {
      // The home copy (+0x38 = 23, +0x3c = 180, +0x40 = 991, pitch / heading / tilt raw), then the motion.
      b.x = GALGRYPHON_HOME.x;
      b.h = GALGRYPHON_HOME.y;
      b.z = GALGRYPHON_HOME.z;
      b.pitch = 0; // DAT_00903ec0 is NaN bits (ASSUMED 0)
      b.heading = GALGRYPHON_HOME_HEADING;
      b.tilt = 0;
      c.motion.tick();
    }
  } else if (c.phase === P.leave) {
    // The home copy again (the exe clears +0x48c, +0x490, +0x494 here; they are not modelled).
    b.x = GALGRYPHON_HOME.x;
    b.h = GALGRYPHON_HOME.y;
    b.z = GALGRYPHON_HOME.z;
    b.pitch = 0;
    b.heading = GALGRYPHON_HOME_HEADING;
    b.tilt = 0;
    b.aura = 0;
    b.flags &= ~F.intro;
    c.cine.hideHud();
    c.cine.end();
  }
};

/**
 * S5 (`0x004a2008`, FUN_004a2008; the dump has no name for it): the death. The
 * boss is placed 600 units from the origin, facing it, at height 360. The dead motion (slot 26, once)
 * runs; when it has finished, 50 counted ticks later the state advances. Four FX go up at frame 110.
 */
const s5: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(26);
    b.stage = 1;
    b.flags |= F.death | F.intro | F.busy; // 0x80 | 0x40 | 0x4 = 0xc4
    b.h = GALGRYPHON_HEIGHT.hoverHigh;
    b.sub = 0;
    b.aux = 0;
    b.heading = angle16FromRadians(Math.atan2(0 - b.x, 0 - b.z));
    b.x = -600 * sin16(b.heading) + 0;
    b.h = 360; // 0x43b40000 (the decompile writes 180 and then 360)
    b.z = -600 * cos16(b.heading) + 0;
    c.cine.deathStart();
    c.cine.freezePlayers(true);
  } else if (c.phase === P.frame) {
    c.motion.tick();
    if (c.motion.crossed(110)) {
      const at = { x: b.x, y: -30, z: b.z };
      c.fx.spawn(0x201, at);
      c.fx.spawn(0x20d, at);
      c.fx.spawn(0x20d, at);
      c.fx.spawn(0x20d, at);
      c.fx.se(0x3a6, 'none');
    }
    if (b.sub === 0) {
      if (c.motion.finished()) {
        b.sub = 1;
        b.aux = 0;
      }
    } else if (b.sub === 1) {
      b.aux += 1;
      if (b.aux > 49) c.advance();
    }
  } else if (c.phase === P.leave) {
    b.flags &= ~(F.intro | F.busy);
    // The on-killed path runs with the position at the origin, then the position is restored.
    const sx = b.x;
    const sh = b.h;
    const sz = b.z;
    b.x = 0;
    b.h = 2;
    b.z = 0;
    c.death.killed();
    c.death.setQuestFlag(0x52);
    b.x = sx;
    b.h = sh;
    b.z = sz;
    c.cine.deathEnd();
    c.cine.freezePlayers(false);
  }
};

/**
 * S6 (`0x004a1368`, OlgaMinionHandleAction_004a1368 in the dump): the takeoff. The takeoff motion
 * (slot 3, once) runs; its three sub-steps climb with a parabola, a descent to 180 and the step to 180.
 * The motion end advances. Ground impacts at frames 20 and 28.
 */
const s6: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(3);
    b.stage = 0;
    b.h = GALGRYPHON_HEIGHT.hoverLow;
    b.aux = 0;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    const g = GALGRYPHON_HEIGHT.hoverLow;
    const sub = b.aux;
    if (sub === 0) {
      if (c.motion.crossed(25)) {
        stepVelocity(b, 5, b.heading);
        b.flags |= F.busy;
        c.fx.frontShots();
        b.stage = 1;
        c.cine.shake(0.15, 20);
        c.fx.se(0x3a3, 'body');
        b.aux = 1;
      }
    } else if (sub === 1) {
      const d = c.motion.frame();
      b.h = ((d - 25) * (d - 25) * 50) / 4 + g;
      stepVelocity(b, 1, b.heading);
      if (c.motion.crossed(27)) b.aux = 2;
    } else if (sub === 2) {
      const d = c.motion.frame();
      b.h = ((180 - (50 + g)) * -((30 - d) * (30 - d))) / 9 + 180;
      stepVelocity(b, 1, b.heading);
      if (c.motion.crossed(30)) {
        b.h = 180;
        b.aux = 3;
      }
    } else if (sub === 3) {
      stepVelocity(b, 1, b.heading);
      if (c.motion.speed() <= 0) c.advance();
    }
    if (c.motion.crossed(20) || c.motion.crossed(28)) c.world.groundImpact();
  } else if (c.phase === P.leave) {
    b.stage = 1;
    b.flags &= ~F.busy;
    b.h = GALGRYPHON_HEIGHT.hoverHigh;
  }
};

/**
 * S7 (`0x004a1678`, HandleOlgaMinionAction_004a1678 in the dump): the shot and the minion throw. The
 * shot motion (slot 24, once) runs; a beam FX (slot 3) lives while the motion frame is in [8, 18]. At
 * the animation time 20.5 the minion launcher (CreateGalgryphonMinion_004aa808, 0x70 bytes) is made:
 * origin = the muzzle, offset = (150 sin, -muzzle.y / 2, 150 cos) of the heading, target = (target x,
 * 0, target z), slot = the target entity id. The motion end advances (after the throw).
 */
const s7: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(24);
    b.stage = 1;
    b.sub = 0;
    b.h = GALGRYPHON_HEIGHT.hoverHigh;
    b.aux = 0;
    b.beam = null;
    b.syncCount = 0;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    if (b.sub === 0) {
      b.sub = 1;
    } else if (b.sub !== 1) {
      if (b.sub === 2 && c.motion.speed() <= 0) c.advance();
      return;
    }
    if (c.motion.crossed(8)) c.fx.se(0x39d, 'body');
    if (c.motion.crossed(20)) c.fx.se(0x39e, 'body');
    if (c.motion.crossed(12)) c.world.groundImpact();
    const d = c.motion.frame();
    if (b.beam === null) {
      if (d >= 8 && d <= 18) b.beam = c.fx.spawnSlot(3, b.muzzle);
    } else if (d > 18) {
      c.fx.kill(b.beam);
      b.beam = null;
    } else {
      c.fx.move(b.beam, b.muzzle);
    }
    if (c.motion.crossed(20.5)) {
      const offset: Vec3 = {
        x: sin16(b.heading) * 150,
        y: -(b.muzzle.y - 0) * 0.5,
        z: cos16(b.heading) * 150,
      };
      c.throwMinion({ ...b.muzzle }, offset, { x: b.target.x, z: b.target.z }, b.target.id);
      c.fx.spawnSlot(4, b.muzzle);
      b.sub = 2;
    }
  } else if (c.phase === P.sync) {
    syncTick(c);
  } else if (c.phase === P.leave) {
    if (b.beam !== null) {
      c.fx.kill(b.beam);
      b.beam = null;
    }
  }
};

/**
 * S8 (`0x004a19c8`, FUN_004a19c8): flies the pattern record. Each frame it steps by the record's speed
 * (+0x8) at the heading and adds the record's turn (+0x4) to the turn accumulator.
 */
const s8: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(4);
    b.stage = 1;
    b.h = GALGRYPHON_HEIGHT.hoverHigh;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    groundCheck(c);
    const r = c.rec;
    if (r) {
      stepVelocity(b, r.b, b.heading);
      b.turn += r.a;
    }
  }
};

/**
 * S9 (`0x004a1a64`, FUN_004a1a64): orbits the origin. The heading to the origin plus 90 degrees (112.5
 * when the record's radius is smaller than the distance; negated when the record's sign is below 1),
 * at the record's speed (+0xc); the steer uses the turn rate (+0x4). Phase 8 is the sync.
 */
const s9: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(4);
    b.stage = 1;
    b.h = GALGRYPHON_HEIGHT.hoverHigh;
    b.syncCount = 0;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    groundCheck(c);
    const r = c.rec;
    if (!r) return;
    let k = 0x4000;
    if (r.d * r.d < b.z * b.z + b.x * b.x) k = 0x5000;
    const ang = angle16FromRadians(Math.atan2(b.x, b.z));
    if (r.b < 1) k = -k;
    stepVelocity(b, r.c, ang + k);
    steerToTarget(b, r.a);
  } else if (c.phase === P.sync) {
    syncTick(c);
  }
};

/**
 * S10 (`0x004a1be0`, FUN_004a1be0): flies to a waypoint (the record's (a, b)). Enter sets the target
 * heading to it. Each frame it turns at the record's rate (d), steps at its speed (c) toward it, and
 * advances once the squared distance is below 10.
 */
const s10: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(4);
    b.stage = 1;
    b.h = GALGRYPHON_HEIGHT.hoverHigh;
    const r = c.rec;
    b.waypointAngle = r ? angle16FromRadians(Math.atan2(r.a - b.x, r.b - b.z)) : 0;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    groundCheck(c);
    const r = c.rec;
    if (!r) return;
    // The distance is taken before the turn, as the exe does (the turn does not move the boss).
    const dx = r.a - b.x;
    const dz = r.b - b.z;
    turnToward(b, r.d, b.waypointAngle);
    stepVelocity(b, r.c, angle16FromRadians(Math.atan2(dx, dz)));
    if (dx * dx + dz * dz < 10) c.advance();
  }
};

/**
 * S11 (`0x004a1d3c`, FUN_004a1d3c): the landing. It steps at 0.75 until the motion frame 1, then the
 * height falls on a parabola (180 down to the low height over frames 1..23) and at frame 23 the
 * landing FX and shake run. The motion end advances. Ground impact at frame 24.
 */
const s11: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(5);
    b.flags |= F.busy;
    b.stage = 1;
    b.h = GALGRYPHON_HEIGHT.hoverHigh;
    b.sub = 0;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    if (b.sub === 0) {
      stepVelocity(b, 0.75, b.heading);
      if (c.motion.crossed(1)) b.sub = 1;
    } else if (b.sub === 1) {
      const d = c.motion.frame();
      b.h = ((GALGRYPHON_HEIGHT.hoverHigh - GALGRYPHON_HEIGHT.hoverLow) * -((d - 1) * (d - 1))) / 484 + GALGRYPHON_HEIGHT.hoverHigh;
      stepVelocity(b, 0.75, b.heading);
      if (c.motion.crossed(23)) {
        b.stage = 0;
        b.h = GALGRYPHON_HEIGHT.hoverLow;
        c.fx.se(0x3a7, 'body');
        c.fx.spawnSlot(1, { x: b.x, y: 0, z: b.z });
        c.cine.shakePreset(1);
        c.fx.landing();
        b.sub = 2;
      }
    } else if (b.sub === 2) {
      if (c.motion.speed() <= 0) c.advance();
    }
    if (c.motion.crossed(24)) c.world.groundImpact();
  } else if (c.phase === P.leave) {
    b.stage = 0;
    b.h = GALGRYPHON_HEIGHT.hoverLow;
    b.flags &= ~F.busy;
  }
};

/**
 * S12 (`0x004a27c8`, FUN_004a27c8): the kakuin (slot 6, chained to slot 7). Sub 0 rises on a quarter
 * sine of the motion frame over 18 frames; sub 1 is 30 counted ticks of the pitch (+0x5c) and the
 * height going up and down; sub 2 waits for slot 7 to be playing, then advances. Ground impact at 10.
 */
const s12: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(6);
    b.flags |= F.busy;
    b.stage = 1;
    b.h = GALGRYPHON_HEIGHT.hoverHigh;
    b.sub = 0;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    const base = 0 as number; // DAT_00a47590: .bss, never written (ASSUMED 0)
    let speed = 0;
    if (b.sub === 0) {
      speed = 0.25;
      const t = quarterTurnAngle(c.motion.frame(), 18);
      b.h = (base - GALGRYPHON_HEIGHT.hoverHigh) * sin16(t) + GALGRYPHON_HEIGHT.hoverHigh;
      if (c.motion.crossed(18)) {
        b.sub = 1;
        b.aux = 0;
      }
    } else if (b.sub === 1) {
      speed = 2.1;
      const n = b.aux;
      const A = (base - 67) * 0.5;
      const m = n >= 15 ? 30 - n : n;
      const cosv = cos16(quarterTurnAngle(m, 15));
      b.h = n >= 15 ? A + 67 - A * cosv : A * cosv + A + 67;
      b.pitch = round((m * 6144) / 15);
      b.aux = n + 1;
      if (n >= 30) {
        b.h = 67;
        b.pitch = 0;
        b.stage = 2;
        b.sub = 2;
      }
    } else if (b.sub === 2) {
      speed = 2.1;
      if (c.motion.playing() === 7) c.advance();
    }
    stepVelocity(b, speed, b.heading);
    if (c.motion.crossed(10)) c.world.groundImpact();
  } else if (c.phase === P.leave) {
    b.stage = 2;
    b.flags &= ~F.busy;
    b.h = 67;
    b.pitch = 0;
  }
};

/**
 * S13 (`0x004a2ae0`, FUN_004a2ae0): the kaku (slot 7) or, in kiri mode (+0x100), the kiri (slot 20).
 * It steps at 3.5 and draws the beam ribbon (kiri mode) or the lightning and its sound. No transitions.
 */
const s13: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(b.flags & F.kiri ? 20 : 7);
    b.stage = 2;
    b.h = 67;
    b.aux = 0;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    stepVelocity(b, 3.5, b.heading);
    if (b.flags & F.kiri) {
      c.fx.kiriBeam();
      c.fx.kiriFx();
      return;
    }
    c.fx.lightning();
    c.fx.lightningAux();
    c.fx.seLoop(0x39c);
  }
};

/**
 * S14 (`0x004a344c`, FUN_004a344c): the kaku orbit with the turn accumulator. The turn is taken from the
 * record's turn (+0x4) when the heading is short of the orbit angle; the step speed is the record's (+0x8),
 * scaled by 0.8 above 6144 of turn error. Its tilt (+0x64) damps toward the turn: divided by the record's
 * duration when that is 6 or less, else a 0.2 blend.
 */
const s14: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(b.flags & F.kiri ? 20 : 7);
    b.stage = 2;
    b.h = 67;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    const r = c.rec;
    if (!r) return;
    let k = 0x4000;
    if (r.c < b.z * b.z + b.x * b.x) k = 0x5000;
    let speed = r.b;
    const ang = angle16FromRadians(Math.atan2(b.x, b.z));
    if (r.a < 1) {
      if (short(ang - k - b.heading) < 0) b.turn += r.a;
    } else if (short(ang + k - b.heading) > 0) {
      b.turn += r.a;
    }
    const err = r.a < 1 ? short(ang - k - b.heading) : short(ang + k - b.heading);
    if (Math.abs(err) > 6144) speed *= 0.8;
    stepVelocity(b, speed, b.heading);
    if (r.roll <= 6) {
      if (r.roll !== 0) b.tilt -= Math.trunc(b.tilt / r.roll);
    } else {
      let t = round(b.turn * -4);
      if (t > 0x5ff) t = 0x600;
      if (t < -0x5ff) t = -0x600;
      const e = short(t - b.tilt);
      b.tilt = round(e * 0.2 + b.tilt);
    }
    if (b.flags & F.kiri) {
      c.fx.kiriBeam();
      c.fx.kiriFx();
      return;
    }
    c.fx.lightning();
    c.fx.lightningAux();
    c.fx.seLoop(0x39c);
  } else if (c.phase === P.leave) {
    b.tilt = 0;
  }
};

/**
 * The Bezier control points of S15's descent: y = 67, 107, 147, DAT_00a47564 (0). Their x and z are
 * not written in the exe (.bss), so they are 0 (ASSUMED).
 */
const S15_CONTROL_Y = [67, 107, 147, GALGRYPHON_HEIGHT.hoverLow] as const;

/** FUN_007be6b8: the cubic Bernstein sum of the control values. */
export function cubicBernstein(p: readonly number[], t: number): number {
  const u = 1 - t;
  return u * u * u * p[0] + 3 * u * u * t * p[1] + 3 * u * t * t * p[2] + t * t * t * p[3];
}

/**
 * S15 (`0x004a36e4`, FUN_004a36e4): the kakuland (slot 9). The height follows a cubic Bezier of the
 * motion frame over 20 frames (y only); at frame 20 the boss lands (the landing FX, SE and shake) and
 * the motion end advances. The FX handles are released on enter and leave.
 */
const s15: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(9);
    b.flags |= F.busy;
    b.stage = 1;
    b.h = GALGRYPHON_HEIGHT.hoverHigh;
    b.syncCount = 0;
    c.fx.releaseHandles();
    b.sub = 0;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    if (b.sub === 0) {
      stepVelocity(b, 1.5, b.heading);
      const t = c.motion.frame() / 20;
      b.h = cubicBernstein(S15_CONTROL_Y, t);
      if (c.motion.crossed(20)) {
        b.stage = 0;
        b.h = GALGRYPHON_HEIGHT.hoverLow;
        c.fx.se(0x3a7, 'body');
        c.fx.spawnSlot(1, { x: b.x, y: 0, z: b.z });
        c.cine.shakePreset(1);
        c.fx.landing();
        b.sub = 1;
      }
    } else if (b.sub === 1) {
      if (c.motion.speed() <= 0) c.advance();
    }
  } else if (c.phase === P.leave) {
    b.flags &= ~F.busy;
    c.fx.releaseHandles();
  }
};

/**
 * S16 (`0x004a38f8`, FUN_004a38f8): the dive and rise. Sub 0 is 40 counted ticks of the pitch (+0x5c)
 * and a height that goes down and back on a cosine; at count 17 the slot becomes 8 (kakuout), written
 * raw. Sub 1 rises to 180 on a sine over the motion's frames 10 to its end, with the ground impact
 * at 17. The motion end advances.
 */
const s16: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(7);
    b.flags |= F.busy;
    b.stage = 1;
    b.h = GALGRYPHON_HEIGHT.hoverHigh;
    c.fx.releaseHandles();
    b.sub = 0;
    b.aux = 0;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    const base = 0 as number; // DAT_00a475a8: .bss, never written (ASSUMED 0)
    let speed = 0;
    if (b.sub === 0) {
      speed = 2.3;
      const count = b.aux;
      const A = (base - 67) * 0.5;
      const n = count >= 19.5 ? 39 - count : count;
      const cosv = cos16(quarterTurnAngle(n, 19.5));
      b.h = count >= 19.5 ? 67 + A + A * cosv : 67 + A - A * cosv;
      b.pitch = round((n * -5120) / 19.5);
      b.aux = count + 1;
      if (b.aux === 17) {
        // The exe writes +0xb8 = 8 with no set-animation call (a raw write).
        c.motion.write(8);
      } else if (b.aux > 39) {
        b.pitch = 0;
        b.h = base;
        b.sub = 1;
      }
    } else if (b.sub === 1) {
      speed = 0.25;
      const d = c.motion.frame();
      const fraction = quarterTurnAngle(d - 10, c.motion.endFrame() - 10);
      b.h = base - (base - 180) * sin16(fraction);
      if (c.motion.crossed(17)) c.world.groundImpact();
      if (c.motion.speed() <= 0) c.advance();
    }
    stepVelocity(b, speed, b.heading);
  } else if (c.phase === P.leave) {
    b.flags &= ~F.busy;
    c.fx.releaseHandles();
    b.pitch = 0;
  }
};

/**
 * S17 (`0x004a3c08`, FUN_004a3c08): the kirin (slot 19, chained to slot 20, the kiri). It sets the kiri
 * flag (0x100) on enter and keeps it on leave. Sub 0 rises on a sine over 9 frames; sub 1 is 20 counted
 * ticks of the pitch and the height; sub 2 waits for slot 20 to be playing, then advances.
 */
const s17: GalgryphonHandler = (c) => {
  const b = c.body;
  if (c.phase === P.enter) {
    c.motion.play(19);
    b.flags |= F.kiri | F.busy;
    b.stage = 1;
    b.h = GALGRYPHON_HEIGHT.hoverHigh;
    b.sub = 0;
  } else if (c.phase === P.frame) {
    c.motion.tick();
    const base = 0 as number; // DAT_00a475ac: .bss, never written (ASSUMED 0)
    let speed = 0;
    if (b.sub === 0) {
      speed = 0.25;
      const t = quarterTurnAngle(c.motion.frame(), 9);
      b.h = (base - GALGRYPHON_HEIGHT.hoverHigh) * sin16(t) + GALGRYPHON_HEIGHT.hoverHigh;
      if (c.motion.crossed(9)) {
        b.sub = 1;
        b.aux = 0;
      }
    } else if (b.sub === 1) {
      speed = 2.1;
      const n0 = b.aux;
      const A = (base - 67) * 0.5;
      const n = n0 >= 10 ? 20 - n0 : n0;
      const cosv = cos16(quarterTurnAngle(n, 10));
      b.h = n0 >= 10 ? A + 67 - A * cosv : A * cosv + A + 67;
      b.pitch = round((n * 6144) / 10);
      b.aux = n0 + 1;
      if (n0 >= 20) {
        b.h = 67;
        b.pitch = 0;
        b.stage = 2;
        b.sub = 2;
      }
    } else if (b.sub === 2) {
      speed = 2.1;
      if (c.motion.playing() === 20) c.advance();
    }
    stepVelocity(b, speed, b.heading);
    if (c.motion.crossed(5)) c.world.groundImpact();
  } else if (c.phase === P.leave) {
    b.stage = 2;
    b.flags &= ~F.busy;
    b.h = 67;
    b.pitch = 0;
  }
};

/**
 * The handler table for states 0..17, keyed by the state number. The dispatcher sets `ctx.phase`,
 * then calls `GALGRYPHON_STATES_A[state](ctx)`. Part B's table covers 18..34.
 */
export const GALGRYPHON_STATES_A: Readonly<Record<number, GalgryphonHandler>> = {
  0: s0,
  1: s1,
  2: s2,
  3: s3,
  4: s4,
  5: s5,
  6: s6,
  7: s7,
  8: s8,
  9: s9,
  10: s10,
  11: s11,
  12: s12,
  13: s13,
  14: s14,
  15: s15,
  16: s16,
  17: s17,
};

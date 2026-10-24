// The Gal Gryphon's brain (PsoBB.exe, Ephinea 1.25.13, addresses are VAs). One object per boss:
// it owns the body (the boss fields), a motion player, the pattern cursor and the timers, and
// runs update_gal_gryphon (dump 226140) once per tick. The state handlers are the two tables
// (galgryphonstatesa.ts: S0..S17; galgryphonstatesb.ts: S18..S34, seen through the same context).
//
// update_gal_gryphon, per tick:
//   - the leader (+0x4e8 == 0; the follower flag is set in the constructor from the party-leader
//     check): HandleGalgryphonState9_004a7360 (the death script when HP <= 0 and flags & 0xc == 0,
//     else phase 9 of the state), ProcessGalgryphonAction_004a7b58 (the pattern executor), phase 8,
//     phase 0;
//   - a follower: phase 0 only (its state comes from the 0xA0 sync, see receive()).
//   Then the integrate (UpdateGalGryphon_004a7c44), the position's pending add (not decoded, see
//   the ASSUMED list) and the duration countdown (ProcessGalGryphonAttackCooldown_004a7de8).
//
// The re-arm (the question of the S0..S17 entry, PROVEN from the dump): a sync (0xA0, sent by the
// leader or received) writes the record at +0x49c, points the cursor at it and sets the pending
// bit 0x2 of +0x4c8. The record ends when its duration runs out (the countdown) or its state's
// handler advances (FUN_004a7e20): the cursor moves to +0x4b0, the seed record (S33, infinite).
// The executor then sees the pending bit and the cursor at or past +0x4b0, clears the bit, walks
// the pattern stream from +0x77c (one packet) and sends it; the loopback sets the next record. So
// the chain never waits for S4: the default walk (S4 at sub 1) only starts it, once.
//
// Wire format of the 0xA0 sync (checked against SyncPlayerToEntityTransform_004a7034 and
// SendGalgryphonActionPacket_004a7b28): u8 0xA0, u8 10, u16 entity id @2, f32 x @4, y @8, z @c,
// u32 heading @0x10, then the 0x14 record: u16 state @0x14, i16 duration @0x16, four 4-byte words
// @0x18..0x24. The sender's own packet comes back to it through the local table (the loopback).
//
// Not here: the renderer (render/combat.ts places the body from the frame and plays its motion),
// the effects and the sounds (the GalgryphonFx hooks, default: no-op), and the attack's area hit.
// ASSUMED items are marked where they are used.

import {
  GALGRYPHON_PHASE,
  GALGRYPHON_STATES_A,
  round,
  short,
  type GalgryphonBody,
  type GalgryphonCine,
  type GalgryphonDeath,
  type GalgryphonFx,
  type GalgryphonHandler,
  type GalgryphonMotion,
  type GalgryphonNet,
  type GalgryphonStateCtx,
  type GalgryphonWorld,
} from './galgryphonstatesa.ts';
import { GALGRYPHON_STATE_HANDLERS_B, viewStateCtxB } from './galgryphonstatesb.ts';
import {
  GalgryphonScript,
  GALGRYPHON_LIST,
  decodeGalgryphonSync,
  galgryphonStageDue,
  galgryphonStageList,
  type GalgryphonPacket,
  type GalgryphonScriptContext,
  type GalgryphonSync,
} from './galgryphonscript.ts';
import {
  GALFX_BEAM_THICKNESS,
  GALFX_OLGA,
  GALFX_RING,
  groundProbe as groundProbeOutcome,
  jitteredBolt,
  minionRingSpawn,
  minionRingTick,
  olgaBeamPoints,
  olgaMinionSpawn,
  ringSlotAt,
  sinowberillBurst,
  diveBeamPoints,
  underBodyArc,
  GALFX_UNDERBODY,
  type GroundHit,
  type Vec3,
} from './galgryphonfx.ts';
import type { LightningBolt } from './techlightning.ts';
import type { EnemyShot } from './enemyshots.ts';
import type { AiFrame, AiTarget, EnemyAiMotion } from './enemyai.ts';

/** The bits of +0x4c8 the brain itself reads (names are the port's; the exe's values are exact). */
export const GALGRYPHON_BRAIN_FLAG = {
  /** 0x2: a sync is pending for the executor (set by every 0xA0, cleared by the executor's run). */
  pending: 0x2,
  /** 0x8: the death script has run (set by the stage walk; never cleared in the dump). */
  stageRan: 0x8,
  /** 0x10: the walk / path mode (the integrate skips x and z; the hit check is not ported). */
  walk: 0x10,
  /** 0x20: the damping is skipped. */
  noDamping: 0x20,
} as const;

/** The seed records (+0x49c and +0x4b0): state 0x21 (= S33), infinite duration. */
const SEED_OP = 0x21;
const SEED_ROLL = -1;

/** The entry state (S4, GalgryphonUpdateState_004a22b0). ASSUMED: the constructor enters it. */
export const GALGRYPHON_ENTRY_STATE = 4;

// ---- the motion rows (0x009a7c80 table: the slots the states use, from docs/bosses/galgryphon-states-a.md) ----

export interface GalgryphonMotionRow {
  /** 1 loop, 2 chain (to `next` at the end), 3 once. */
  mode: 1 | 2 | 3;
  next: number;
  /** The motion file index in the BML archive. */
  motion: number;
  /** The motion's frame count. */
  frames: number;
  /** Frames per tick (+0xc8). */
  speed: number;
  flags: number;
}

/**
 * The motion table 0x009a7c80 (PROVEN, dump of the exe bytes via `tools/exedata.py motions 009a7c80 27`):
 * 27 records of 0x10 bytes: u16 mode @0, u16 chain slot @2, u32 MOTION FILE INDEX @4 (the doc's
 * "float @4 = 0" was wrong), f32 step @8, u32 flags @12. A state writes a SLOT number into +0xb8
 * (S27 writes the literal 0x11 at dump 224954), and the player reads record[slot]; the motion played
 * is record[slot].motion. So the slot is the state's number and the motion is the record's @4.
 * Before this table had all 27 rows, slots 2, 10..18, 21..23 fell back to the stand motion.
 */
export const GALGRYPHON_MOTION_ROWS: Readonly<Record<number, GalgryphonMotionRow>> = {
  0: { mode: 1, next: 0, motion: 9, frames: 30, speed: 0.8, flags: 0 },
  1: { mode: 1, next: 0, motion: 11, frames: 30, speed: 0.5, flags: 0 },
  2: { mode: 3, next: 0, motion: 1, frames: 30, speed: 0.43, flags: 0 },
  3: { mode: 3, next: 0, motion: 10, frames: 40, speed: 0.5, flags: 0 },
  4: { mode: 1, next: 0, motion: 0, frames: 30, speed: 0.77, flags: 0 },
  5: { mode: 3, next: 0, motion: 6, frames: 40, speed: 0.48, flags: 0 },
  6: { mode: 2, next: 7, motion: 2, frames: 30, speed: 0.7, flags: 6 },
  7: { mode: 1, next: 0, motion: 5, frames: 20, speed: 0.9, flags: 7 },
  8: { mode: 3, next: 0, motion: 4, frames: 30, speed: 0.57, flags: 0 },
  9: { mode: 3, next: 0, motion: 3, frames: 40, speed: 0.7, flags: 0 },
  10: { mode: 2, next: 11, motion: 22, frames: 10, speed: 1.0, flags: 0xa },
  11: { mode: 1, next: 0, motion: 21, frames: 20, speed: 1.0, flags: 0xb },
  12: { mode: 3, next: 0, motion: 23, frames: 35, speed: 1.0, flags: 0 },
  13: { mode: 2, next: 14, motion: 15, frames: 14, speed: 0.4, flags: 0xd },
  14: { mode: 1, next: 0, motion: 14, frames: 14, speed: 0.35, flags: 0xe },
  15: { mode: 3, next: 0, motion: 12, frames: 14, speed: 0.4, flags: 0 },
  16: { mode: 2, next: 17, motion: 25, frames: 30, speed: 0.75, flags: 0x10 },
  17: { mode: 1, next: 0, motion: 24, frames: 10, speed: 0.35, flags: 0x11 },
  18: { mode: 3, next: 0, motion: 26, frames: 30, speed: 0.6, flags: 0 },
  19: { mode: 2, next: 20, motion: 19, frames: 20, speed: 0.5, flags: 0x13 },
  20: { mode: 1, next: 0, motion: 17, frames: 20, speed: 1.0, flags: 0x14 },
  21: { mode: 3, next: 0, motion: 20, frames: 20, speed: 0.5, flags: 0x15 },
  22: { mode: 3, next: 0, motion: 18, frames: 30, speed: 0.0, flags: 0x16 },
  23: { mode: 3, next: 0, motion: 13, frames: 30, speed: 0.35, flags: 0 },
  24: { mode: 3, next: 0, motion: 8, frames: 30, speed: 0.65, flags: 0 },
  25: { mode: 3, next: 0, motion: 7, frames: 500, speed: 1.0, flags: 0x80000000 },
  26: { mode: 3, next: 0, motion: 16, frames: 150, speed: 0.5, flags: 0 },
};

/** ASSUMED for the slots without a row: the stand motion, looping at 1 frame per tick. */
const MOTION_DEFAULT: GalgryphonMotionRow = { mode: 1, next: 0, motion: 9, frames: 30, speed: 1, flags: 0 };

export function galgryphonMotionRow(slot: number): GalgryphonMotionRow {
  return GALGRYPHON_MOTION_ROWS[slot] ?? MOTION_DEFAULT;
}

/**
 * The motion player (the host side of GalgryphonMotion). ASSUMED: an approximation of FUN_007aa094
 * over the rows above: +0xc0 is the frame, +0xc8 the speed; a loop wraps, a chain moves to `next`,
 * a once stops at its end with speed 0 and sets +0xb0 bit 0x10 (the "finished" the states test).
 */
export class GalgryphonMotionPlayer implements GalgryphonMotion {
  /** +0xb8: the requested slot. `loaded` is the row in use (the playing one). */
  private slot = 0;
  private loaded = -1;
  // +0xc0 (the motion time), the previous tick's value, the end frame (+0xc4), the speed (+0xc8).
  private time = 0;
  private prev = 0;
  private end = 0;
  private step = 0;
  private mode: 1 | 2 | 3 = 1;
  private next = 0;
  private b0 = 0;

  /** The set-animation call: the row loads now and the time restarts. */
  play(slot: number): void {
    this.slot = slot;
    this.load(slot);
  }

  /**
   * A raw write of the slot (+0xb8 only). ASSUMED: the row loads on the next tick (the exe's tick
   * switches modes; the S4 entrance writes slot 25 and needs its 500-frame row to run its course).
   */
  write(slot: number): void {
    this.slot = slot;
  }

  private load(slot: number): void {
    const r = galgryphonMotionRow(slot);
    this.loaded = slot;
    this.time = 0;
    this.prev = 0;
    this.end = r.frames;
    this.step = r.speed;
    this.mode = r.mode;
    this.next = r.next;
    this.b0 = 0;
  }

  tick(): void {
    if (this.loaded !== this.slot) this.load(this.slot);
    if (this.step <= 0) return;
    this.prev = this.time;
    this.time += this.step;
    if (this.time < this.end) return;
    if (this.mode === 1) {
      this.time -= this.end;
      this.prev = this.time;
    } else if (this.mode === 2) {
      this.play(this.next);
    } else {
      this.time = this.end;
      this.step = 0;
      this.b0 |= 0x10;
    }
  }

  /** The motion time (+0xc0), 0 while +0xb0 bit 0x4 holds it. */
  frame(): number {
    return this.b0 & 0x4 ? 0 : this.time;
  }

  endFrame(): number {
    return this.end;
  }
  speed(): number {
    return this.step;
  }
  finished(): boolean {
    return (this.b0 & 0x10) !== 0;
  }
  playing(): number {
    return this.loaded;
  }
  crossed(f: number): boolean {
    return this.prev < f && f <= this.time;
  }
  setFlagsB0(clear: number, set: number): void {
    this.b0 = (this.b0 & ~clear) | set;
  }
  /** The current row as the EnemyAiMotion the renderer plays (the motion index and the speed). */
  motionFor(): EnemyAiMotion {
    const r = galgryphonMotionRow(this.loaded < 0 ? this.slot : this.loaded);
    return { index: r.motion, speed: r.speed, loop: r.mode === 1 };
  }
}

// ---- the wire format (0xA0 sync and 0x9F target) ----

const scratch = new DataView(new ArrayBuffer(4));

function floatFromBits(bits: number): number {
  scratch.setUint32(0, bits >>> 0, true);
  return scratch.getFloat32(0, true);
}

export const GALGRYPHON_SYNC_BYTES = 0x28;

/**
 * The 0xA0 the leader sends (SendGalgryphonActionPacket_004a7b28): the position, the heading and the
 * resolved record. ASSUMED: the record's four words are float bit patterns (the receiver reads op and
 * duration only, the rest is the handlers' input and the exe's float / int mix is not decoded).
 */
export function encodeGalgryphonSync(entityId: number, pos: Vec3, heading: number, rec: GalgryphonPacket): Uint8Array {
  const b = new Uint8Array(GALGRYPHON_SYNC_BYTES);
  const dv = new DataView(b.buffer);
  b[0] = 0xa0;
  b[1] = 10;
  dv.setUint16(2, entityId & 0xffff, true);
  dv.setFloat32(4, pos.x, true);
  dv.setFloat32(8, pos.y, true);
  dv.setFloat32(0xc, pos.z, true);
  dv.setUint32(0x10, heading & 0xffff, true);
  dv.setUint16(0x14, rec.op & 0xffff, true);
  dv.setInt16(0x16, Math.max(-32768, Math.min(32767, Math.trunc(rec.roll))), true);
  dv.setFloat32(0x18, rec.a, true);
  dv.setFloat32(0x1c, rec.b, true);
  dv.setFloat32(0x20, rec.c, true);
  dv.setFloat32(0x24, rec.d, true);
  return b;
}

/**
 * The 0x9F the leader sends for its target (SendOlgaMinionActionPacket_004a1328, dump 223787): u16
 * entity id @2, u32 target client id @4 (+0x394), f32 x @8 (+0x39c), f32 z @0xc (+0x3a4). 16 bytes.
 */
export function encodeGalgryphonTarget(entityId: number, target: { id: number; x: number; z: number }): Uint8Array {
  const b = new Uint8Array(0x10);
  const dv = new DataView(b.buffer);
  b[0] = 0x9f;
  b[1] = 4;
  dv.setUint16(2, entityId & 0xffff, true);
  dv.setUint32(4, target.id >>> 0, true);
  dv.setFloat32(8, target.x, true);
  dv.setFloat32(0xc, target.z, true);
  return b;
}

/** The record a sync carries, as the brain stores it (the words back to floats). */
function recordFromSync(s: GalgryphonSync): GalgryphonPacket {
  return { op: s.state, roll: s.duration, a: floatFromBits(s.a), b: floatFromBits(s.b), c: floatFromBits(s.c), d: floatFromBits(s.d) };
}

// ---- the brain ----

/** Damping per stage (0x00a475d8.. / 0x00a475e8.. / 0x00a475fc.., written by UpdateGalGryphon_004a7c44 at init). */
const DAMP_XZ = [0.3, 0.75, 0.75] as const;
/** ASSUMED: DAT_00a475f8 has no writer in the image; 0 here (the stages 1 and 2 lose their vertical speed). */
const DAMP_Y = [0, 0, 0] as const;
const DAMP_HEADING = [0, 0.75, 0.75] as const;

/** The flyover offsets of the pattern stream (unknown_set_gal_gryphon_state_by_current_fly_over_state). */
function flyOverOffset(stage: number): number {
  if (stage === 1) return 0x08;
  if (stage === 2) return 0x5c;
  if (stage === 3) return 0x60;
  return 0x40;
}

function stageKey(stage: number): 1 | 2 | 3 | 'other' {
  return stage === 1 || stage === 2 || stage === 3 ? stage : 'other';
}

function newBody(x: number, h: number, z: number, heading: number): GalgryphonBody {
  return {
    x,
    h,
    z,
    heading,
    pitch: 0,
    tilt: 0,
    turn: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    flags: 0,
    stage: 0,
    sub: 0,
    aux: 0,
    m: 0,
    slope: 0,
    waypointAngle: 0,
    syncCount: 0,
    muzzle: { x: 0, y: 0, z: 0 },
    beam: null,
    toTargetX: 0,
    toTargetZ: 0,
    toTargetLen: 0,
    target: { id: 0xffff, x: 0, z: 0 },
    aura: 0,
    pA: { x: 0, y: 0, z: 0 },
    pB: { x: 0, y: 0, z: 0 },
  };
}

function seedRecord(): GalgryphonPacket {
  return { op: SEED_OP, roll: SEED_ROLL, a: 0, b: 0, c: 0, d: 0 };
}

export interface GalgryphonAiOptions {
  /** The entity id (the packets' u16 at +2). */
  entityId: number;
  /** The spawn position (x, height, z) and BAMS heading. */
  x: number;
  h: number;
  z: number;
  heading: number;
  /** This client is the party leader: it runs the pattern and sends the packets. */
  leader: () => boolean;
  /** Current hp (+0x334) and max hp (+0x2bc) at the start; the host keeps them current with setHp(). */
  hp: number;
  maxHp: number;
  /** P, the party size the branches and the S27 / S30 gates read. */
  players: () => number;
  /** rand() / 32768: a value in [0, 1). */
  rand: () => number;
  /** The packets the leader sends (the host sends them as subcommands 0x60). */
  send: (packet: Uint8Array) => void;
  /** GalgryphonMinionManager.throw (the S7 throw). */
  throwMinion?: (origin: Vec3, offset: Vec3, target: { x: number; z: number }, slot: number) => void;
  /** unknown_get_ground_info(pos, 0x16ef): the ground under (x, z) at or below y, or null. */
  ground?: (x: number, z: number, y: number) => GroundHit | null;
  /** FUN_0068d5a8: the player in slot k is present. */
  playerPresent?: (slot: number) => boolean;
  /** A live player's position in slot k, or null. */
  playerPos?: (slot: number) => { x: number; y: number; z: number } | null;
  /** The event queue (FUN_006ff5f8: tag and argument). */
  queue?: (tag: number, arg: number) => void;
  /** A sound at the boss (the probe's 0x39b); the host plays it. */
  sfx?: (id: number) => void;
  /** A lightning beam (the S27 beam, the S30 dive beam) to draw; the host adds it to its bolts. */
  bolt?: (b: LightningBolt) => void;
  /** The minion point for the S27 beam, by selector (0 or 1); ASSUMED the boss's own point when not given. */
  minionAt?: (sel: number) => Vec3 | null;
  /**
   * The minion ring's particles (CreateGalgryphonMinion_004aabd8 and UpdateGalgryphonMinionParticles_004aade4):
   * start at the ring's centre (the two one-shots, and the 32 outer emitters), then slot(k, at) each spawn tick
   * with the k-th outer slot's point (the emitters follow it while they emit).
   */
  ringParticles?: { start: (centre: Vec3) => void; slot: (k: number, at: Vec3) => void };
  /** Host overrides of the hook groups (the defaults are no-ops). */
  fx?: Partial<GalgryphonFx>;
  cine?: Partial<GalgryphonCine>;
  world?: Partial<GalgryphonWorld>;
  death?: Partial<GalgryphonDeath>;
  net?: Partial<GalgryphonNet>;
}

/** The handler table of all 35 states: S0..S17 (part A) and S18..S34 (part B, through the same context). */
const HANDLERS: Record<number, GalgryphonHandler> = {};
for (const k of Object.keys(GALGRYPHON_STATES_A)) {
  const n = Number(k);
  const h = GALGRYPHON_STATES_A[n];
  if (h) HANDLERS[n] = h;
}
for (const k of Object.keys(GALGRYPHON_STATE_HANDLERS_B)) {
  const n = Number(k);
  const h = GALGRYPHON_STATE_HANDLERS_B[n];
  if (h) HANDLERS[n] = (c) => h(viewStateCtxB(c), c.phase);
}

export class GalgryphonAi {
  readonly body: GalgryphonBody;
  /** The motion player (the host plays its frame through the EnemyAiMotion of tick()). */
  readonly motionPlayer = new GalgryphonMotionPlayer();
  private readonly opts: GalgryphonAiOptions;
  private readonly script = new GalgryphonScript();
  // The records at +0x49c (index 0: the synced record) and +0x4b0 (index 1: the seed). The cursor is +0x4c4.
  private readonly records: GalgryphonPacket[];
  private cursor = 0;
  private current = GALGRYPHON_ENTRY_STATE;
  private targets: readonly AiTarget[] = [];
  private removed = false;
  private lastSlot = -2;
  private pendingX = 0;
  private pendingZ = 0;
  private hpNow: number;
  private hpMax: number;
  private readonly ctx: GalgryphonStateCtx;
  // The minion ring (CreateGalgryphonMinion_004aabd8): its counter and state, and the attacks it made
  // this tick. The attack is DispatchGalGryphonAttackEffectVariant_004a86e0 (dump 229600), at the centre.
  private ring: { state: 0 | 1; counter: number; x: number; z: number } | null = null;
  // The area hits and projectiles of this tick, handed to the host (frameOut's `shots`).
  private shotsOut: EnemyShot[] = [];
  // The brain's clock (game ticks) and the beams waiting for their frame (the beam object's +0x98).
  private clock = 0;
  private pendingBolts: { due: number; bolt: LightningBolt }[] = [];

  constructor(opts: GalgryphonAiOptions) {
    this.opts = opts;
    this.hpNow = opts.hp;
    this.hpMax = opts.maxHp;
    this.body = newBody(opts.x, opts.h, opts.z, opts.heading);
    this.records = [seedRecord(), seedRecord()];
    const self = this;
    const hooks = this.defaultHooks();
    this.ctx = {
      phase: 0,
      body: this.body,
      get rec(): GalgryphonPacket | null {
        return self.records[self.cursor] ?? null;
      },
      motion: this.motionPlayer,
      fx: { ...hooks.fx, ...opts.fx },
      cine: { ...hooks.cine, ...opts.cine },
      world: { ...hooks.world, ...opts.world },
      death: { ...hooks.death, ...opts.death },
      net: { ...hooks.net, ...opts.net },
      rng: {
        next16: () => Math.floor(opts.rand() * 65536),
        reseed: () => {},
      },
      rt: { s19Base: 67, pairB4: 0, pairB8: 0, pairBC: 0, pairC0: 0, s29Base: 180, defaultY: 0 },
      get players(): number {
        return opts.players();
      },
      throwMinion: (origin, offset, target, slot) => opts.throwMinion?.(origin, offset, target, slot),
      queue: (tag, arg) => opts.queue?.(tag, arg),
      playerPresent: (slot) => opts.playerPresent?.(slot) ?? false,
      advance: () => this.advance(),
      changeState: (s) => this.changeState(s),
      walkDefault: () => this.walkDefault(),
    };
    this.dispatch(this.current, GALGRYPHON_PHASE.enter);
  }

  /** The boss's hp (+0x334) and max (+0x2bc), pushed by the host each tick. */
  setHp(hp: number, max: number): void {
    this.hpNow = hp;
    this.hpMax = max;
  }

  /** The state as the EnemyBrain's name ("S4"). */
  get state(): string {
    return `S${this.current}`;
  }

  /** The state number (+0x32e). */
  get stateNumber(): number {
    return this.current;
  }

  get motion(): EnemyAiMotion | null {
    return this.motionPlayer.motionFor();
  }

  /** The record under the cursor (+0x4c4), for the tests and the host. */
  get currentRecord(): GalgryphonPacket {
    return this.records[this.cursor];
  }

  /** One game tick (update_gal_gryphon, dump 226140). `targets` are the live players the search reads. */
  tick(targets: readonly AiTarget[] = [], _animationEnded?: boolean): AiFrame {
    this.targets = targets;
    this.clock += 1;
    this.flushBolts();
    if (!this.removed) {
      if (this.opts.leader()) {
        this.stageGate();
        this.executor();
        this.dispatch(this.current, GALGRYPHON_PHASE.sync);
        this.dispatch(this.current, GALGRYPHON_PHASE.frame);
      } else {
        this.dispatch(this.current, GALGRYPHON_PHASE.frame);
      }
      this.integrate();
      this.cooldown();
      this.tickRing();
    }
    return this.frameOut();
  }

  onDamage(_clientId: number): void {}

  resume(): string {
    return this.state;
  }

  /** True once the body is removed (S34's markRemoved, or kill()): the host hides it and stops ticking it. */
  get gone(): boolean {
    return this.removed;
  }

  kill(): void {
    this.removed = true;
  }

  /** Draws the beams whose frame has come (the host's bolt hook). */
  private flushBolts(): void {
    if (this.pendingBolts.length === 0) return;
    const due = this.pendingBolts.filter((p) => p.due <= this.clock);
    if (due.length === 0) return;
    this.pendingBolts = this.pendingBolts.filter((p) => p.due > this.clock);
    for (const p of due) this.opts.bolt?.(p.bolt);
  }

  /** A beam object made now: it is drawn `after` ticks later (the object's counter starts at 0). */
  private scheduleBolt(after: number, bolt: LightningBolt): void {
    this.pendingBolts.push({ due: this.clock + after, bolt });
  }

  /** The 0xA0 from the leader (a follower's apply; the leader's own packets come back through emit()). */
  receive(view: DataView): boolean {
    const s = decodeGalgryphonSync(view);
    if (!s || s.entityId !== this.opts.entityId) return false;
    this.applySync(s, false);
    return true;
  }

  /** The 0x9F from the leader: the target the search found (SyncPlayer's neighbour; ASSUMED layout as sent). */
  receiveTarget(view: DataView): boolean {
    if (view.byteLength < 0x10 || view.getUint16(2, true) !== this.opts.entityId) return false;
    this.body.target = { id: view.getUint32(4, true), x: view.getFloat32(8, true), z: view.getFloat32(0xc, true) };
    return true;
  }

  /**
   * The minion ring's tick (UpdateGalgryphonMinionParticles_004aade4, dump 229207): the spawn state
   * (31 ticks) makes the variant attack with radius counter * 7 at the ring's centre; the fade state
   * makes none. ASSUMED: the variant's speed0 is 1.0 (the caller's value is not decoded; it reads only
   * the Derolle vtable's animation, which the port does not play).
   */
  private tickRing(): void {
    const r = this.ring;
    if (!r) return;
    const t = minionRingTick(r.state, r.counter, { x: r.x, z: r.z }, { speed0: 1, variant: 0, variantParam2: 1 });
    r.state = t.state;
    r.counter = t.counter;
    if (t.slots) t.slots.forEach((s, k) => this.opts.ringParticles?.slot(k, ringSlotAt(s.outer)));
    if (t.attack) {
      // The variant context is [variant, speed, radius, 10, param2]: its radius is the ring's, not 15.
      this.shotsOut.push(sinowberillBurst({ x: r.x, y: GALFX_RING.y, z: r.z }, t.attack));
    }
    if (t.dead) this.ring = null;
  }

  private frameOut(): AiFrame {
    const shots = this.shotsOut;
    this.shotsOut = [];
    const slot = this.motionPlayer.playing();
    let motion: EnemyAiMotion | null = null;
    if (slot !== this.lastSlot) {
      motion = this.motionPlayer.motionFor();
      this.lastSlot = slot;
    }
    return {
      motion,
      x: this.body.x,
      z: this.body.z,
      angle: (this.body.heading * 2 * Math.PI) / 65536,
      hit: null,
      y: this.body.h,
      shots: shots.length ? shots : undefined,
    };
  }

  /** HandleGalgryphonState9_004a7360: the death script when due, else phase 9. */
  private stageGate(): void {
    if (galgryphonStageDue(this.body.flags, this.hpNow)) {
      this.stageWalk();
      return;
    }
    this.dispatch(this.current, GALGRYPHON_PHASE.dispatch);
  }

  /** ProcessGalgryphonSubcommandPacket_004a7390: one packet from the stage's list. */
  private stageWalk(): void {
    this.body.flags |= GALGRYPHON_BRAIN_FLAG.stageRan;
    this.script.restart(galgryphonStageList(stageKey(this.body.stage)));
    this.emitNext();
  }

  /** ProcessGalgryphonAction_004a7b58: the pattern executor (see the header for the re-arm). */
  private executor(): void {
    if ((this.body.flags & GALGRYPHON_BRAIN_FLAG.pending) === 0 || this.cursor < 1) return;
    this.body.flags &= ~GALGRYPHON_BRAIN_FLAG.pending;
    if (!this.script.started) this.script.restart(flyOverOffset(this.body.stage));
    this.emitNext();
  }

  /** ProcessGalgryphonDefaultSubcommandPacket_004a8d5c: restart at the default list, one packet. */
  private walkDefault(): void {
    this.script.restart(GALGRYPHON_LIST.default);
    this.emitNext();
  }

  private emitNext(): void {
    const { packet } = this.script.next(this.scriptContext());
    this.emit(packet);
  }

  /** SendGalgryphonActionPacket_004a7b28: send, then the loopback (checked_call_packet0x60_subcommand). */
  private emit(p: GalgryphonPacket): void {
    const b = this.body;
    const bytes = encodeGalgryphonSync(this.opts.entityId, { x: b.x, y: b.h, z: b.z }, b.heading, p);
    this.opts.send(bytes);
    const s = decodeGalgryphonSync(new DataView(bytes.buffer));
    if (s) this.applySync(s, true);
  }

  /**
   * SyncPlayerToEntityTransform_004a7034 (dump 226104): the record goes to +0x49c, the cursor points at
   * it, the pending bit is set, and the state changes when it differs. The position is the sender's:
   * a follower takes it (ASSUMED: the exe keeps it as a smoothing target, not decoded).
   */
  private applySync(s: GalgryphonSync, local: boolean): void {
    this.records[0] = recordFromSync(s);
    this.cursor = 0;
    if (!local) {
      // The sender's x and z become a delta (SyncPlayer: x5 = pos - x2), added once by the position
      // step after the integrate (GalGryphonUpdatePosition_004a7dac). ASSUMED: x5 / z5 are +0x48c / +0x494.
      this.pendingX = s.x - this.body.x;
      this.pendingZ = s.z - this.body.z;
      this.body.h = s.y;
      this.body.heading = s.heading & 0xffff;
    }
    this.body.flags |= GALGRYPHON_BRAIN_FLAG.pending;
    if (s.state !== this.current) this.changeState(s.state);
  }

  /** The position delta a sync left for the next position step (tests and the host read it). */
  get pendingDelta(): { x: number; z: number } {
    return { x: this.pendingX, z: this.pendingZ };
  }

  /** FUN_004a7e20 (GalGryphonTransitionAIState_004a7e20): the cursor to the next record; a new state changes. */
  private advance(): void {
    if (this.cursor + 1 >= this.records.length) return; // ASSUMED: past the seed; not reached by the data
    this.cursor += 1;
    const next = this.records[this.cursor];
    if (next.op !== this.current) this.changeState(next.op);
  }

  /** FUN_0051f62c (SetEnemyAiState): phase 5 on the old state, the new state, phase 4 on the new one. */
  private changeState(s: number): void {
    this.dispatch(this.current, GALGRYPHON_PHASE.leave);
    this.current = s;
    this.dispatch(s, GALGRYPHON_PHASE.enter);
  }

  /** ProcessGalGryphonAttackCooldown_004a7de8: the record's duration counts down (not in S4). */
  private cooldown(): void {
    if (this.current === GALGRYPHON_ENTRY_STATE) return;
    const rec = this.records[this.cursor];
    if (rec.roll > 0) {
      rec.roll -= 1;
      if (rec.roll === 0) this.advance();
    }
  }

  /** UpdateGalGryphon_004a7c44 (ASSUMED: the flag-0x10 hit check is not ported; see the header). */
  private integrate(): void {
    const b = this.body;
    const walk = (b.flags & GALGRYPHON_BRAIN_FLAG.walk) !== 0;
    if (!walk) {
      b.x += b.vx;
      b.z += b.vz;
    }
    b.h += b.vy;
    b.heading = short(b.heading + b.turn);
    // GalGryphonUpdatePosition_004a7dac: the sync's delta, once.
    b.x += this.pendingX;
    b.z += this.pendingZ;
    this.pendingX = 0;
    this.pendingZ = 0;
    if ((b.flags & GALGRYPHON_BRAIN_FLAG.noDamping) === 0) {
      const i = Math.max(0, Math.min(2, b.stage));
      const a = DAMP_XZ[i];
      const bY = DAMP_Y[i];
      const c = DAMP_HEADING[i];
      b.turn = round(b.turn * c);
      b.vy *= bY;
      b.vx *= a;
      b.vz *= a;
    }
  }

  private dispatch(state: number, phase: number): void {
    const h = HANDLERS[state];
    if (!h) return;
    const prev = this.ctx.phase;
    this.ctx.phase = phase;
    h(this.ctx);
    this.ctx.phase = prev;
  }

  private scriptContext(): GalgryphonScriptContext {
    const max = this.hpMax;
    return {
      rand: this.opts.rand,
      players: this.opts.players(),
      hpRatio: max > 0 ? this.hpNow / max : 0,
      heading: (this.body.heading * 2 * Math.PI) / 65536,
    };
  }

  /** unknown_get_ground_info(p, 0x16ef) at p's (x, z): the ground object's height, or null. */
  private groundHitAt(p: Vec3): GroundHit | null {
    return this.opts.ground?.(p.x, p.z, p.y) ?? null;
  }

  /** The default hooks: no-ops, except the target search and send, which the brain needs. */
  private defaultHooks(): { fx: GalgryphonFx; cine: GalgryphonCine; world: GalgryphonWorld; death: GalgryphonDeath; net: GalgryphonNet } {
    const o = this.opts;
    const b = this.body;
    const noop = (): void => {};
    const fx: GalgryphonFx = {
      spawn: () => null,
      spawnSlot: () => null,
      move: noop,
      kill: noop,
      releaseHandles: noop,
      se: noop,
      seLoop: noop,
      muzzleShots: noop,
      frontShots: noop,
      landing: noop,
      aura: noop,
      auraUpdate: noop,
      kiriBeam: noop,
      kiriFx: noop,
      lightning: noop,
      lightningAux: noop,
      groundProbe: () => {
        // OlgaMinionSpawnEffect_004a15fc (dump 223918): the probe at the body; a hit at or below 6.0 plays 0x39b.
        const hit = o.ground?.(b.x, b.z, b.h) ?? null;
        const r = groundProbeOutcome({ x: b.x, y: b.h, z: b.z }, hit);
        if (r) o.sfx?.(r.sfx);
      },
      resetParticles: noop,
      releaseEffects: noop,
      footsteps: noop,
      lerpBattle: noop,
      thresholdDispatch: noop,
      phaseStats: noop,
      spawnRing: noop,
      disableMinions: noop,
      effectAt: noop,
      cameraShake: noop,
      initEntity: noop,
      markRemoved: () => {
        this.removed = true;
      },
      sfx: noop,
      groundAt: (x, z) => o.ground?.(x, z, b.h)?.y ?? null,
      playerPos: (slot) => o.playerPos?.(slot) ?? null,
      lightningUnderBody: () => {
        // create_gal_gryphon_lightning_effect_under_body (0x004a4fc4, dump 225036): one arc under the boss each
        // S27 tick (P > 1), from the first control point to the last, jittered as the Zonde bolt. Its randoms
        // are the C rand (0..32767): the brain's rand() is in [0, 1), so the value is scaled back.
        const arc = underBodyArc({ x: b.x, z: b.z }, () => Math.floor(o.rand() * 32768));
        o.bolt?.(jitteredBolt(arc.points, o.rand, GALFX_BEAM_THICKNESS, GALFX_UNDERBODY.hold));
      },
      lightningTransform: noop,
      spawnBeam: (flag, value) => {
        // SpawnOlgaMinionEffect_004a5218 (dump 225179): the minion point by selector, the player in slot
        // `value` (the S27 random), the ring point or the player's point, then the beam object (its
        // lightning is the three points of olgaBeamPoints, drawn from frame 20 for 17 frames).
        // param_1 is ((m / 20) & 1) == 0 at the S27 call (dump 225013): the flag itself, so it is 1 when true.
        const sel = flag ? 1 : 0;
        const at = o.minionAt ? o.minionAt(sel) : { x: b.x, y: b.h, z: b.z };
        const spawn = olgaMinionSpawn(
          { x: b.x, y: b.h, z: b.z, heading: b.heading },
          sel,
          o.playerPos?.(value) ?? null,
          at,
          () => this.ctx.rng.next16(),
          (p) => this.groundHitAt(p),
        );
        if (!spawn) return;
        const pts = olgaBeamPoints(spawn, (p) => this.groundHitAt(p));
        this.scheduleBolt(GALFX_OLGA.start, jitteredBolt(pts, o.rand, GALFX_BEAM_THICKNESS, GALFX_OLGA.length));
      },
      lightningSetup: noop,
      lightningRelease: noop,
      spawnMinionRing: (x, _y, z) => {
        // CreateGalgryphonMinion_004aabd8 (dump 229084): the ring starts at counter 0 in its spawn state, and its
        // one-shots and emitters are made at its centre (x, 2.0, z).
        this.ring = { state: 0, counter: 0, x, z };
        o.ringParticles?.start(minionRingSpawn({ x, z }));
      },
      diveBeam: (from, to) => {
        // CreateGalgryphonLightningBeamEffectWrapper_004aa4b0 (dump 228629): the beam from the boss to the
        // target, every 5 ticks (the caller's gate); its window is diveBeamPoints' start and end.
        const d = diveBeamPoints(from, to, this.groundHitAt(to));
        this.scheduleBolt(d.start, jitteredBolt(d.points, o.rand, GALFX_BEAM_THICKNESS, d.end - d.start));
      },
      updateTargeting: noop,
      initVelocity: noop,
    };
    const cine: GalgryphonCine = {
      begin: noop,
      end: noop,
      hideHud: noop,
      freezePlayers: noop,
      shake: noop,
      shakePreset: noop,
      deathStart: noop,
      deathEnd: noop,
      event: noop,
    };
    const world: GalgryphonWorld = { groundImpact: noop, hitCheck: noop };
    const death: GalgryphonDeath = { killed: noop, setQuestFlag: noop };
    const net: GalgryphonNet = {
      sendTarget: (id, x, z) => {
        o.send(encodeGalgryphonTarget(o.entityId, { id, x, z }));
        b.target = { id, x, z };
      },
      findTarget: () => {
        // ASSUMED: the nearest live player in XZ (EnemyEntity_FindTargetInRange is not decoded).
        let best: AiTarget | null = null;
        let bestD = Infinity;
        for (const t of this.targets) {
          if (t.dead) continue;
          const d = (t.x - b.x) ** 2 + (t.z - b.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = t;
          }
        }
        if (best) b.target = { id: best.clientId, x: best.x, z: best.z };
      },
      refreshTarget: noop,
    };
    return { fx, cine, world, death, net };
  }
}

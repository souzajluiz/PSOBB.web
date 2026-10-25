// Saint-Milion / Shambertin / Kondrieu, the Episode 4 boss (PsoBB.exe, Ephinea
// 1.25.13, addresses are VAs). One brain drives the body, its 8 parts, the 16
// tentacles (combat/saintmilionents.ts) and the boss's own objects.
//
// Sources: the Ephinea Ghidra dump (SaintEmilion* functions, 0x00764bc8 ..
// 0x0076fe20) and the executable itself where the dump failed to decompile
// (the state dispatcher 0x00769ecc and most of the state handlers are plain
// stubs around the named functions). The dump's address suffixes of some names
// are off, e.g. the constructor is at 0x0076a8e8 (named ..._0076acf0). The JP
// source has nothing of this boss.
//
// The class (vtable 0x00b43880, 0xfb8 bytes) is a table-driven machine: the
// 31 rows of 0x009f6c60 (SM_STATES: kind, handler, next state, animation,
// camera, flags, parts active) are entered through UpdatePhase 0x0076bbe8 and
// left through the dispatcher 0x00769ecc (vtable +0x164: UpdateState
// 0x00769f88 before the handler, UpdatePositionAndCollision 0x0076a0b8 after
// it on phase 0). A state ends when +0xf74 bit 2 is set (the row's animation
// flag 4 and the end of the animation, or the handler); the next state is the
// pending one (+0xfa0, set by a 6xDC) or, when none is, HandlePhaseCompletion
// 0x00767d88 and then the row's next. The kind (g_SaintEmilionBossState,
// 0x00a9b074) says which part of the fight a state belongs to: 2 the first
// form, 3 the second, 4 .. 7 the cutscenes and the end.
//
// The network: the 6xDC {action u16, param u16} of newserv's
// G_Episode4BossActions_BB_6xDC, sent by the party leader through
// checked_call_packet0x60_subcommand, which also runs it on the sender:
//   0 param = state: ProcessStateTransition (0x007677c0): the state is
//     entered unless +0xf74 & 0x25 holds, then it is queued (+0xfa0);
//   1 the 20 minute time limit (+0xf98 > 36000 with fa8 set): flag 0x400,
//     the failure ending (state 0x1c);
//   2 param = the idle animation frame (13 bits) | a 3-bit spot (1 << 13): a
//     lead tentacle of that spot died; every tentacle sinks and the boss
//     comes up at the spot (state 4 + spot);
//   3 param = arena (0 .. 4): the boss's next place (+0xf80), SendStatePacket;
//   4 param = arena: the boss arrived there (state 0xc).
//
// HP: the body has none that matters. Its 8 parts (ids body + 1 .. body + 8,
// hit boxes on the model nodes of slots 5 .. 12) have the stats row's hp / 4
// each; g_SaintEmilionStatMultiplier (0x00a9afe0, 4 at the start of each form)
// counts the parts still to kill. Form 1 revives parts 0 .. 3 every frame
// (vtable +0x108), so parts 4 .. 7 are the ones that die; form 2 has what is
// left, parts 0 .. 3. The fourth death of form 1 raises flag 0x800 of the body
// (PhaseTransition, vtable +0x104: the second form's stats row, state 0x1a,
// the tentacles gone). In form 2 the fourth would-be death keeps the part
// alive (State2 0x800: every living part's hp is set to MovementData iparam1
// each frame), the next state 11 turns that into 0x400, and the next death
// is the boss's: 6xDC {0, 0x1b}, the ending states 0x1b, 0x1d (the kill, 454
// frames after it is entered) and 0x1e.
//
// ASSUMED (not traced; everything else in the port is read from the exe):
//   - the cutscene states 0x19 .. 0x1c wait for a cutscene object
//     (GetGlobalGameState); they end here when their animation has ended
//     (0x1b waits 60 more frames);
//   - the aim of the lasers (states 0x13 / 0x14, see SmLaser and laserAim) is
//     drawn by the exe (the draw writes the origin and aim; see SM_LASER): the
//     length is the exe's ramp (capped ASSUMED), the origin and heading are the
//     node 0x2a's (proven), the stand-in sweep only without a render record;
//     the laser's hit, its life and its sound are; the missiles, the wave, the storm and the sand sonic are
//     objects of their own (see SmMissile, SmWave, SmStorm and SmSandSonic);
//   - the order of the players the followers go round and the stream of the
//     random numbers (SmRng, see saintmilionents.ts).

import { BAMS_TO_RAD, type AiFrame, type AiTarget } from './enemyai.ts';
import type { EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase } from './enemyfsm.ts';
import { EnemyShot, PLAYER_RADIUS } from './enemyshots.ts';
import { SM_LASER, SM_MISSILE, SM_SAND, SmClock, SmField, SmLaser, laserLength, SmMissile, SmRng, SmSandSonic, SmStorm, SmTouch, SmWave, type SmEvent, type SpinnerEntity } from './saintmilionents.ts';

const BAMS = BAMS_TO_RAD;
const f32 = Math.fround;

// --- tables ---------------------------------------------------------------------------

// One row of 0x009f6c60 (40 bytes): [kind, handler, adjust, next, animation,
// camera, script, flags, parts active, 0].
export interface SmStateRow {
  readonly kind: number;
  readonly next: number;
  readonly anim: number;
  readonly flags: number;
  readonly parts: number;
}
const R = (kind: number, next: number, anim: number, flags: number, parts: number): SmStateRow => ({ kind, next, anim, flags, parts });
export const SM_STATES: readonly SmStateRow[] = [
  R(0, -1, -1, 0x808, 0), // 0 waits for a player
  R(2, 2, 0, 0x814, 2), // 1
  R(2, -1, 1, 0x90, 1), // 2 the tentacles
  R(2, -1, 3, 0x804, 2), // 3
  R(2, 7, 4, 0x4, 2), // 4 .. 6 come up at the spot of the lead that died
  R(2, 8, 5, 0x4, 2),
  R(2, 9, 6, 0x4, 2),
  R(2, 10, 7, 0x4, 2), // 7 .. 9
  R(2, 10, 8, 0x4, 2),
  R(2, 10, 9, 0x4, 2),
  R(2, 2, 10, 0x4, 3), // 10 the swing
  R(3, 12, 11, 0x880, 2), // 11 walks to the next arena
  R(3, 15, 12, 0x884, 2), // 12
  R(3, 14, 13, 0x880, 2), // 13 waits for a player in the arena
  R(3, 15, 14, 0x884, 2), // 14
  R(3, -1, 15, 0x80, 2), // 15 picks an attack
  R(3, 0x18, -1, 0x184, 2), // 16 the reaction to a part's death
  R(3, 15, 17, 0x80, 2), // 17 the stomp
  R(3, 15, 18, 0x184, 2), // 18 missiles
  R(3, 15, 19, 0x184, 2), // 19 laser
  R(3, 15, 20, 0x184, 2), // 20 laser
  R(3, 15, 21, 0x184, 2), // 21 wave
  R(3, 15, 15, 0x184, 2), // 22 tentacles round the players
  R(3, 11, 22, 0x8a0, 2), // 23 the storm
  R(3, 11, 23, 0x884, 2), // 24 the retreat
  R(4, 2, 24, 0x8a0, 2), // 25 (0x19) the introduction
  R(5, 13, 25, 0x8a0, 2), // 26 (0x1a) form 1 -> form 2
  R(6, 29, 26, 0x8a0, 2), // 27 (0x1b) the ending
  R(7, 30, 27, 0x8a0, 2), // 28 (0x1c) the failure
  R(6, 30, -1, 0x808, 0), // 29 (0x1d) the death
  R(1, -1, -1, 0x808, 0), // 30 (0x1e) the end
];

export const SM_STATE = { wait: 0, tentacles: 2, swing: 10, walk: 11, arrive: 13, choose: 15, react: 16, stomp: 17, missiles: 18, laserA: 19, laserB: 20, wave: 21, around: 22, retreat: 24, intro: 0x19, change: 0x1a, ending: 0x1b, failure: 0x1c, death: 0x1d, end: 0x1e } as const;

// The animation rows (0x009f6a20): motion of bm_ene_boss09.bml, speed, loop.
export interface SmAnim {
  readonly motion: number;
  readonly speed: number;
  readonly loop: boolean;
}
const A = (motion: number, speed: number, loop: boolean): SmAnim => ({ motion, speed, loop });
export const SM_ANIMS: readonly SmAnim[] = [
  A(0, 1, false),
  A(9, 4, true),
  A(6, 1, false),
  A(8, 1, false),
  A(3, 1, false),
  A(4, 1, false),
  A(5, 1, false),
  A(0xa, f32(0.05), false),
  A(0xb, f32(0.1), false),
  A(0xc, f32(0.2), false),
  A(0xd, 1, false),
  A(0xe, 1, true),
  A(0xf, 1, false),
  A(0x19, 1, true),
  A(0x13, 1, false),
  A(0x1a, 1, true),
  A(0x10, 1, false),
  A(0x11, 1, false),
  A(0x14, 1, false),
  A(0x16, 1, false),
  A(0x17, 1, false),
  A(0x18, 1, false),
  A(0x15, 1, false),
  A(0x12, 1, false),
  A(0x1c, 1, false),
  A(0x1b, 1, false),
  A(0x1d, 1, false),
  A(0x1e, 1, false),
];

// The arenas (0x009f75f4 / 0x009f7630): where the body stands in form 2, its
// heading, and the origin and radius CheckPhaseEntryCondition looks round
// (0x00977408 / 0x00977444; the last two arenas read zeros).
export const SM_ARENAS = [
  { x: -1000, z: -800, heading: 0x2000, ox: -750, oz: -512, range: 250 },
  { x: -150, z: -1150, heading: 0, ox: -160, oz: -782, range: 250 },
  { x: 750, z: -750, heading: 0xe000, ox: 533, oz: -522, range: 250 },
  { x: -300, z: 250, heading: 0x6000, ox: 0, oz: 0, range: 620 },
  { x: 200, z: 250, heading: 0xa000, ox: 0, oz: 0, range: 620 },
] as const;

// Weights of state 15's choice of attack: by the phase counter (+0xf7c) a table
// (0x00976980 for 0 / 1, 0x00976a40 for 2, 0x009769e0 for 3 / 4), by the
// player's distance (< 250, < 450, farther, or off the boss's back: 3) a row
// of [0x11, 0x15, 0x12, 0x16].
const W_A = [[0x28, 0, 0x1e, 0x1e], [0xa, 0x23, 0x23, 0x14], [0xa, 0x28, 0x32, 0], [5, 5, 0x50, 0xa]];
const W_B = [[5, 0xf, 0x28, 0x28], [0xa, 0x23, 0x23, 0x14], [0x3c, 0x14, 0x14, 0], [5, 5, 0x2d, 0x2d]];
const W_C = [[0x64, 0, 0, 0], [0x64, 0, 0, 0], [0x64, 0, 0, 0], [0x64, 0, 0, 0]];
export const SM_WEIGHTS = { a: W_A, b: W_B, c: W_C } as const;
export const SM_ATTACKS = [0x11, 0x15, 0x12, 0x16] as const;
// The pause before state 15 picks (+0xf84 by the phase counter) and the
// arena choices (SendStatePacket 0x0076b208).
export const SM_PAUSE = [0x1e, 0x3c, 0, 0x1e, 0x3c] as const;
export const SM_ARENA_CHOICES = [[0, 1, 2], [0, 1, 2], [3, 4], [3, 4], [3, 4]] as const;
// HandlePhaseCompletion's tables (local_4c).
const PHASE_STEP = [2, 1, 3, 2, 1] as const;
const PHASE_SEND = [0, 1, 0, 0, 1] as const;

// The hit spheres of the body (0x009f71a0, 19 rows): matrix slot and radius.
export const SM_PIECES = [
  [0x11, 20], [4, 40], [0x13, 20], [0x14, 20], [0x15, 20], [2, 20], [0x17, 20], [0x18, 20], [0x19, 20], [0x1b, 20],
  [3, 60], [0x1f, 20], [0x20, 20], [1, 50], [0x22, 20], [0x23, 20], [0, 60], [0x25, 20], [0x26, 20],
] as const;
// Matrix slot -> model node (draw index), 0x009f6960.
export const SM_NODES = [
  76, 74, 21, 55, 17, 91, 92, 93, 94, 29, 30, 31, 32, 0, 1, 3, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 27, 28, 55, 71, 72, 73, 74, 42, 53, 76, 5, 10,
  79, 80, 83, 85,
] as const;
export const SM_PART_SLOT = 5; // part i sits on matrix slot 5 + i
export const SM_PART_RADIUS = 20;
export const SM_PART_COUNT = 8;

export const SM = {
  // State 0: a player within sqrt(6251) of (-50, 24).
  waitX: -50,
  waitZ: 24,
  waitRangeSq: 6251,
  // 36000 frames of the fight (+0xf98 > 0x8ca0) while fa8 is set.
  timeLimit: 36000,
  // CheckPhaseEntryCondition: 5400 frames in.
  idleLimit: 0x1517,
  // The speed of state 11 (1.5 * 6.0) and its arrival test.
  walkSpeed: 9,
  // The kill: 454 frames after state 0x1d is entered (0x009773b8, +1.0 a frame).
  deathFrames: 454,
  // State 0x1b waits this long after its cutscene (ASSUMED the cutscene's end).
  endingWait: 0x3c,
  // The distances of state 15's choice and its angle test (0x3800 BAMS).
  near: 250,
  far: 450,
  behind: 0x3800,
  // State 17: the stomp at frame 85 shakes the camera within sqrt(250000).
  stompFrame: 85,
  stompRangeSq: 250000,
  // State 10: the swing windows and the burst frame (the frames of
  // GalgryphonUpdate 0x0076865c) and the burst's radius.
  swing: [[12, 32], [40, 56]],
  burstFrame: 50,
  burstRadius: 40,
  contactEvery: 30,
  // State 18: the two more missiles of phase 0 come on the clock's frame 5 (0x007aaa30 with 5.0).
  missileFrame: 5,
  // State 21: the one beam of phase 0 comes on the clock's frame 28 (0x007aaa30; frame 27 is the effect 0x6f9).
  waveFrame: 28,
} as const;

// --- the parts -------------------------------------------------------------------------

export interface SmPart {
  readonly index: number;
  hp: number;
  maxHp: number;
  dead: boolean; // +0x30 & 0x800
  counted: boolean; // +0x384
  hit: boolean;
  // Whether the last strike was the local player's (+0x2da), null: none yet.
  ours: boolean | null;
  x: number;
  y: number;
  z: number;
}

// --- options and events -------------------------------------------------------------------

export type SmBossEvent =
  | { kind: 'send'; action: number; param: number }
  | { kind: 'se'; id: number; loop?: boolean }
  | { kind: 'bgm'; name: string }
  | { kind: 'effect'; name: string; state: number }
  | { kind: 'killed'; x: number; z: number; ours: boolean | null }
  | { kind: 'setDead' }
  | { kind: 'phase'; form: number }
  | SmEvent;

export interface SmBossOptions {
  x: number;
  z: number;
  angle: number;
  variant: 0 | 1 | 2;
  param1: number;
  seed: number;
  // MovementData rows of the two forms (iparam1 .. 5 are the powers).
  movement: readonly [EnemyMovementData | null, EnemyMovementData | null];
  // Stats hp of the two forms and of the tentacle rows [lead, follower].
  hp: readonly [number, number];
  tentacleHp: readonly [number, number];
  tentacleMovement: readonly [EnemyMovementData | null, EnemyMovementData | null];
  leader: () => boolean;
  frames: (motion: number) => number;
  tentacleFrames: (motion: number) => number;
  ground?: (x: number, z: number) => boolean;
  // The boss was already killed in this game (saved enemy status 0x12008).
  dead?: boolean;
  // The boss's base ATP (the stats row's atp, [boss+0x2c4]): the sand sonic's damage.
  atp?: number;
  rng?: () => number;
}

const MV_FALLBACK: EnemyMovementData = { fparam1: 0, fparam2: 0, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [1000, 0, 0, 0, 0, 0] };

export class SaintMilionAi extends BrainBase {
  state = 'wait';
  sid = -1; // +0x32e
  kind = 0; // g_SaintEmilionBossState
  flags = 0; // +0xf74
  pending = -1; // +0xfa0
  phase = 0; // +0xf7c
  arena = 0; // +0xf80
  pause = 0; // +0xf84
  frames = 0; // +0xf9c
  fight = 0; // +0xf98
  lastPart = -1; // +0xf94
  traveled = 0; // +0xfac
  cutWait = 0; // +0xfac in the ending
  deathTimer = 0; // +0x2b8
  heading = 0; // +0x60, BAMS
  remaining = 4; // g_SaintEmilionStatMultiplier
  bodyDead = false; // +0x30 & 0x800
  bodyHit = false; // +0x30 & 0x200
  contact = false; // g_SaintEmilionGlobalFlag
  readonly field: SmField;
  readonly parts: SmPart[] = [];
  readonly events: SmBossEvent[] = [];
  readonly clock = new SmClock();
  readonly variant: number;
  readonly opts: SmBossOptions;
  anim = 0; // +0xb8
  private clockAnim = -1;
  private swingAngle = 0; // +0xd0
  private tx = 0;
  private tz = 0;
  private dirX = 0;
  private dirZ = 0;
  private tdist = 0;
  private pendingShots: EnemyShot[] = [];
  // The laser of states 19 / 20 while it lives (its sound 0x6f8 loops until it is done).
  private laser: SmLaser | null = null;
  private targets: readonly AiTarget[] = [];
  private readonly rand: SmRng;
  private readonly contactAt = new Map<number, number>();
  private readonly mv: [EnemyMovementData, EnemyMovementData];
  private readonly hpRows: readonly [number, number];
  private readonly atp: number;
  private storm: SmStorm | null = null;
  private sonic: SmSandSonic | null = null;
  // Node positions the owner recorded: slot -> x, y, z.
  readonly nodes = new Float32Array(SM_NODES.length * 3);
  nodesKnown = false;
  // Node z axes the owner recorded (the node's world +Z, XZ only): slot -> x, z. The laser's heading (SM_LASER.headingSlot).
  readonly axes = new Float32Array(SM_NODES.length * 2);
  axesKnown = false;
  readonly everLeader: boolean;

  constructor(opts: SmBossOptions) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.opts = opts;
    this.variant = opts.variant;
    this.rand = new SmRng(opts.seed ^ 0x51d7);
    this.heading = Math.round(opts.angle / BAMS) & 0xffff;
    this.mv = [opts.movement[0] ?? MV_FALLBACK, opts.movement[1] ?? opts.movement[0] ?? MV_FALLBACK];
    this.hpRows = opts.hp;
    this.atp = opts.atp ?? 0;
    this.everLeader = opts.leader();
    this.field = new SmField({
      frames: opts.tentacleFrames,
      seed: opts.seed,
      level: [opts.tentacleMovement[0]?.iparam[0] ?? 8, opts.tentacleMovement[1]?.iparam[0] ?? 8],
      hp: opts.tentacleHp,
      param1: opts.param1,
      ...(opts.ground ? { ground: opts.ground } : {}),
    });
    for (let i = 0; i < SM_PART_COUNT; i++) {
      const hp = Math.max(1, Math.trunc(opts.hp[0] / 4));
      this.parts.push({ index: i, hp, maxHp: hp, dead: false, counted: false, hit: false, ours: null, x: opts.x, y: 0, z: opts.z });
    }
    this.clock.start(opts.frames(SM_ANIMS[0].motion), SM_ANIMS[0].speed, false);
    this.clockAnim = 0;
    // The constructor: ResetSaintEmilionPart(-1), then state 0, or 0x1e for a
    // boss that is already dead.
    this.setState(opts.dead ? SM_STATE.end : SM_STATE.wait, true);
  }

  // --- what the owner reads ---------------------------------------------------------------

  get form(): number {
    return this.kind === 3 || this.sid >= 11 ? 2 : 1;
  }
  get dying(): boolean {
    return this.kind === 6;
  }
  // The 8 parts and the tentacles can be hit only while the state's flag
  // 0x800 (SetEntityFlags 0xa000000) is clear and the row has them active.
  get partsHittable(): boolean {
    return SM_STATES[this.sid] !== undefined && SM_STATES[this.sid].parts !== 0 && (this.flags & 0x800) === 0;
  }
  partHittable(i: number): boolean {
    return this.partsHittable && !this.parts[i].counted;
  }
  get motionIndex(): number {
    return SM_ANIMS[Math.max(0, this.anim)].motion;
  }
  get mframe(): number {
    return this.clock.elapsed;
  }
  // The movement row of the form being fought (+0x3d0).
  get row(): EnemyMovementData {
    return this.mv[this.form === 2 ? 1 : 0];
  }

  // --- hits ---------------------------------------------------------------------------------

  hitPart(i: number, damage: number, ours: boolean): void {
    const p = this.parts[i];
    if (!p || damage < 1) return;
    p.hp = Math.max(0, p.hp - Math.round(damage));
    p.hit = true;
    p.ours = ours;
    if (p.hp <= 0) p.dead = true;
  }

  // restore_enemy_status of a 6x0A on part i.
  setPartDamageTaken(i: number, total: number): void {
    const p = this.parts[i];
    if (!p) return;
    p.hp = Math.max(0, p.maxHp - Math.max(0, Math.trunc(total)));
    p.hit = true;
    p.ours = false;
    if (p.hp <= 0) p.dead = true;
  }

  // --- the tick --------------------------------------------------------------------------------

  tick(targets: readonly AiTarget[]): AiFrame {
    const out = this.frame();
    this.targets = targets;
    this.field.players = targets;
    this.pendingShots.length = 0;
    // EnemyUpdateLoop of the body: dead -> vtable +0x104, hit -> +0x100.
    if (this.sid >= 0) {
      if (this.bodyDead) this.phaseTransition();
      else if (this.bodyHit) this.hitReaction();
      this.dispatch(this.sid, 0);
    }
    // The storm and the sand sonic are objects of their own: they run in whatever state the boss is in.
    if (this.storm) for (const b of this.storm.tick()) this.pendingShots.push(b);
    this.sandSonicFrame();
    // The laser's sound loop ends with the laser (0x00765d7c's end update; seen one frame late here, when the
    // laser is already done).
    if (this.laser?.done) {
      this.events.push({ kind: 'seStop', id: SM_LASER.se });
      this.laser = null;
    }
    // The parts and the tentacles are enemies of their own.
    this.updateParts();
    this.field.tick();
    for (const e of this.field.events.splice(0)) this.events.push(e);
    this.contactDamage();
    out.motion = null;
    if (this.sid >= 0) {
      const a = SM_ANIMS[Math.max(0, this.anim)];
      this.current = { index: a.motion, speed: a.speed, loop: a.loop };
      out.motion = this.current;
    }
    this.angle = this.heading * BAMS;
    if (this.pendingShots.length) out.shots = this.pendingShots.slice();
    return this.finish(out);
  }

  onDamage(): void {}
  resume(): string {
    return this.state;
  }
  override kill(): void {
    this.state = 'dead';
  }

  // --- states -----------------------------------------------------------------------------------

  private name(): string {
    return `state 0x${this.sid.toString(16)}`;
  }

  // SaintEmilionPart_ChangeState 0x00767ce0.
  private changeState(s: number): boolean {
    if (s < 0 || s >= 0x1f) return false;
    this.pending = -1;
    if (s !== this.sid && (this.flags & 1) === 0) {
      this.dispatch(this.sid, 5);
      this.sid = s;
      this.state = this.name();
      this.dispatch(s, 4);
      return true;
    }
    return false;
  }

  // The constructor's / failure's direct entries.
  private setState(s: number, first = false): void {
    this.pending = -1;
    if (!first) this.dispatch(this.sid, 5);
    this.sid = s;
    this.state = this.name();
    this.dispatch(s, 4);
  }

  // ResetSaintEmilionPart(-1) / SetSaintEmilionPartState: queue a state.
  private queue(s: number): void {
    if (this.pending === -1 && s !== this.sid) this.pending = s;
  }

  // ProcessStateTransition 0x007677c0.
  private transition(s: number): void {
    if ((this.flags & 0x25) === 0) this.changeState(s);
    else {
      this.pending = -1;
      this.queue(s);
    }
  }

  private dispatch(s: number, phase: number): void {
    if (s < 0 || s > 0x1f) return;
    if (phase === 4) this.enter(SM_STATES[s]);
    else if (phase === 0) this.preUpdate();
    // The state may have changed in the pre-hook; the handler is the current one's.
    const cur = phase === 0 ? this.sid : s;
    this.handle(cur, phase);
    if (phase === 0) this.post();
  }

  // UpdatePhase 0x0076bbe8.
  private enter(row: SmStateRow): void {
    this.flags = (this.flags & 0xfffff640) | row.flags;
    this.kind = row.kind;
    if (row.anim >= 0) this.anim = row.anim;
    if (this.flags & 0x30) this.resetPose();
    if (this.flags & 0x80) this.flags &= ~0x40;
    // TransitionCameraForPhase: only the cutscene states keep the wait flag.
    if (this.flags & 0x20 && !(this.sid === 0x17 || (this.sid >= 0x19 && this.sid <= 0x1c))) this.flags &= ~0x20;
  }

  // ResetPositionAndRotation 0x0076b1c0: the origin.
  private resetPose(): void {
    this.setPose(0, 0, this.heading);
  }

  private setPose(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading & 0xffff;
    this.warps++;
  }

  // UpdateState 0x00769f88, phase 0.
  private preUpdate(): void {
    this.field.state2 &= 0xffffffc3;
    if (this.flags & 0x1000) this.flags &= 0xffffefff;
    if (this.kind === 2) for (let i = 0; i < 4; i++) this.revive(this.parts[i]);
    if (this.flags & 2) {
      if (this.pending === -1) {
        if (!this.phaseCompletion()) this.changeState(SM_STATES[this.sid].next);
      } else this.changeState(this.pending);
    }
  }

  // The leader's send (checked_call_packet0x60_subcommand: it runs here too).
  private send(action: number, param: number): void {
    if (!this.opts.leader()) return;
    this.events.push({ kind: 'send', action, param });
    this.apply(action, param);
  }

  // The five receivers of 0x00976928.
  apply(action: number, param: number): void {
    switch (action) {
      case 0:
        this.transition(param);
        return;
      case 1:
        this.flags |= 0x400;
        return;
      case 2: {
        const bits = (param >> 13) & 7;
        this.clock.elapsed = param & 0x1fff;
        let s = this.field.state2 & ~0x380;
        s |= bits << 7;
        let next = -1;
        if (s & 0x80) next = 4;
        if (s & 0x100) next = 5;
        if (s & 0x200) next = 6;
        this.field.state2 = s | 0x20;
        this.field.hideAll();
        this.field.state2 &= ~0x380;
        this.changeState(next);
        return;
      }
      case 3: {
        const a = SM_ARENAS[param] ?? SM_ARENAS[0];
        this.arena = param;
        this.tx = a.x;
        this.tz = a.z;
        this.heading = Math.round(Math.atan2(a.x - this.x, a.z - this.z) / BAMS) & 0xffff;
        return;
      }
      case 4: {
        const a = SM_ARENAS[param] ?? SM_ARENAS[0];
        this.arena = param;
        this.setPose(a.x, a.z, a.heading);
        this.pending = -1;
        if (this.sid !== 0xc && (this.flags & 1) === 0) {
          this.dispatch(this.sid, 5);
          this.sid = 0xc;
          this.state = this.name();
          this.dispatch(0xc, 4);
        }
        return;
      }
      default:
        return;
    }
  }

  // The leader's packets from other clients.
  applyRemote(action: number, param: number): void {
    if (action < 0 || action > 4) return;
    this.apply(action, param);
  }

  // --- the handlers (the rows' stubs and the named functions they call) -----------------

  private handle(s: number, phase: number): void {
    switch (s) {
      case 0:
        if (phase === 0) this.waitForPlayer();
        return;
      case 2:
        if (phase === 4) this.randomizeTentacles();
        else if (phase === 5) this.contact = false;
        else if (phase === 0) this.tentaclesFrame();
        return;
      case 10:
        if (phase === 0) this.swing();
        return;
      case 11:
        if (phase === 4) this.walkEnter();
        else if (phase === 0) this.walkFrame();
        return;
      case 13:
        if (phase === 4) {
          this.arena = 2;
          this.setPose(SM_ARENAS[2].x, SM_ARENAS[2].z, SM_ARENAS[2].heading);
        } else if (phase === 0) this.arrivalFrame();
        return;
      case 15:
        if (phase === 4) this.pause = SM_PAUSE[this.phase] ?? 0;
        else if (phase === 0) this.chooseAttack();
        return;
      case 16:
      case 22:
        if (phase === 4 && s === 22) this.tentaclesAround();
        if (phase === 0) this.flags |= 2;
        return;
      case 17:
        if (phase === 0) this.stomp();
        return;
      case 18:
        if (phase === 4) {
          this.events.push({ kind: 'effect', name: 'missiles', state: s });
          this.launchMissiles(1);
        } else if (phase === 0) this.missileFrame();
        return;
      case 19:
      case 20:
      case 21:
        if (phase === 4) {
          if (s === 21) this.events.push({ kind: 'effect', name: 'wave', state: s });
          else this.laserEnter();
        } else if (phase === 0 && s === 21) this.waveFrame();
        return;
      case 23:
        if (phase === 4) {
          this.field.state2 |= 0x20;
          this.field.hideAll();
          this.events.push({ kind: 'effect', name: 'storm', state: s });
          // The storm is centred on the arena's origin (ASSUMED, see SmStorm); iparam4 is its damage.
          const a = SM_ARENAS[this.arena] ?? SM_ARENAS[0];
          this.storm = new SmStorm(a.ox, a.oz, this.row.iparam[3]);
        }
        return;
      case 24:
        if (phase === 4) this.field.hideAll();
        return;
      case 25:
      case 26:
      case 27:
      case 28:
        if (phase === 4) this.cutsceneEnter(s);
        else if (phase === 5) this.cutsceneLeave();
        return;
      case 29:
        if (phase === 4) {
          this.field.state2 |= 0x1002;
          this.deathTimer = 0;
        } else if (phase === 0) this.deathFrame();
        return;
      default:
        return;
    }
  }

  // State 0 (0x00768098): every client looks, the leader sends.
  private waitForPlayer(): void {
    for (const t of this.targets) {
      if (t.dead) continue;
      if ((t.x - SM.waitX) ** 2 + (t.z - SM.waitZ) ** 2 < SM.waitRangeSq) {
        this.send(0, SM_STATE.intro);
        return;
      }
    }
  }

  // State 2 enter (0x0076bb70): the four leads take their spots.
  private randomizeTentacles(): void {
    const r: [number, number, number, number] = [this.rand.next(), this.rand.next(), this.rand.next(), this.rand.next()];
    this.field.randomize(r, this.rand.u16());
    this.contact = true;
  }

  // State 2 frame (0x007681a4).
  private tentaclesFrame(): void {
    if (this.flags & 0x400) {
      if (this.sid !== 0x1c && (this.flags & 1) === 0) {
        this.pending = -1;
        this.setState(0x1c);
      }
      return;
    }
    if (this.field.state2 & 0x380) {
      const bits = (this.field.state2 & 0x380) >> 7;
      this.send(2, ((bits << 13) | (Math.round(this.clock.elapsed) & 0x1fff)) & 0xffff);
    }
    // Every 30 frames the followers go round the players.
    if (this.frames % 30 === 0) {
      const spots: Array<{ x: number; z: number; angle: number } | null> = [null, null, null, null];
      let n = 0;
      for (const t of this.targets) {
        if (t.dead || n >= 4) continue;
        spots[n++] = { x: t.x, z: t.z, angle: Math.round(((t.angle ?? 0) / BAMS)) & 0xffff };
      }
      this.field.placeFollowers({ x: 0, z: 0 }, spots);
    }
  }

  // State 10 (0x0076865c): the swing of the arm.
  private swing(): void {
    const c = this.clock;
    if (c.crossed(45)) {
      this.events.push({ kind: 'effect', name: 'sandsonic', state: 10 });
      // The sand sonic waits trunc(6 * rng) frames (0x009774ac), then launches (sandSonicFrame).
      this.sonic = new SmSandSonic(Math.trunc(SM_SAND.wait * this.rand.float()), this.atp);
    }
    if (c.crossed(SM.burstFrame)) {
      const p = this.node(4);
      if (p) this.burst(p[0], p[2], SM.burstRadius);
    }
    const e = c.elapsed;
    let window = false;
    for (const w of SM.swing) if (w[0] <= e && e <= w[1]) window = true;
    const a = this.node(4);
    const b = this.node(0x17);
    const tip = this.node(0x1c);
    if (!a || !b || !tip) return;
    const ang = Math.round(Math.atan2(b[0] - a[0], b[2] - a[2]) / BAMS) & 0xffff;
    if (window) this.sweep(ang, this.swingAngle, Math.hypot(tip[0] - this.x, tip[2] - this.z));
    this.swingAngle = ang;
  }

  // SaintemilionpartProcessattackhitbox type 1: the arc between the last and this angle.
  private sweep(now: number, prev: number, reach: number): void {
    const half = Math.abs(((now - prev + 0x8000) & 0xffff) - 0x8000);
    const mid = (now + prev) & 0xffff;
    for (const t of this.targets) {
      if (t.dead) continue;
      const d = Math.hypot(t.x - this.x, t.z - this.z);
      if (d > reach + PLAYER_RADIUS) continue;
      const a = Math.round(Math.atan2(t.x - this.x, t.z - this.z) / BAMS) & 0xffff;
      const off = Math.abs(((a - mid + 0x8000) & 0xffff) - 0x8000);
      if (off <= half + 0x400) this.pendingShots.push(new SmTouch(this.x, 0, this.z, t));
    }
  }

  // State 18, phase 0 (0x0076968c): on the clock's frame 5, two more missiles in arenas 3 / 4 (+0xf80).
  private missileFrame(): void {
    if (this.clock.crossed(SM.missileFrame) && (this.arena === 3 || this.arena === 4)) this.launchMissiles(2);
  }

  // Missiles (0x0076b8f4 / 0x0076968c) leave the boss with the MovementData iparam3 as their blast.
  // ASSUMED: each one aims at the nearest living player at launch (FindNearestPlayer), or along the heading,
  // and flies until it is within SM_MISSILE.arrive of that point (see SmMissile).
  private launchMissiles(count: number): void {
    let best: AiTarget | null = null;
    let bestSq = Infinity;
    for (const t of this.targets) {
      if (t.dead) continue;
      const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
      if (d < bestSq) {
        best = t;
        bestSq = d;
      }
    }
    const angle = best ? Math.atan2(best.x - this.x, best.z - this.z) : this.heading * BAMS;
    const range = best ? Math.max(0, Math.sqrt(bestSq) - SM_MISSILE.arrive) : null;
    for (let i = 0; i < count; i++) this.pendingShots.push(new SmMissile(this.x, this.z, angle, this.row.iparam[2], range));
  }

  // The sand sonic's launch (0x0076c974) once its wait is over: from node 0x17 toward node 0x17 from node 4.
  // ASSUMED: without the nodes the launch is from the boss, along its swing angle.
  private sandSonicFrame(): void {
    const s = this.sonic;
    if (!s || s.launched || s.waiting()) return;
    const start = this.node(0x17);
    const pivot = this.node(4);
    if (start && pivot) s.launch(start[0], start[2], Math.atan2(start[0] - pivot[0], start[2] - pivot[2]), pivot[0], pivot[2]);
    else s.launch(this.x, this.z, this.swingAngle * BAMS, this.x, this.z);
    this.pendingShots.push(s);
  }

  // States 19 / 20, phase 4 (0x0076b85c): one laser (SmLaser). Its sound 0x6f8 is a loop started here and stopped
  // when the laser is done (0x00765d7c starts it on the first update with child 2 flagged, ASSUMED: here at once).
  private laserEnter(): void {
    this.events.push({ kind: 'se', id: SM_LASER.se, x: this.x, z: this.z, loop: true });
    this.laser = new SmLaser({
      origin: () => ({ x: this.x, z: this.z }),
      aim: (k) => this.laserAim(k),
      damage: () => this.row.iparam[1],
    });
    this.pendingShots.push(this.laser);
  }

  // The aim point of update k (+0x44 = origin + length * forward): the exe's ramp length (laserLength, +100 an update,
  // capped at SM_LASER.reach ASSUMED for the wall) along the laser node's z axis (the render's heading, proven: the
  // node's translation is the origin, the XZ direction of its z axis the heading). Without the render's record the
  // stand-in sweep of SM_LASER (ASSUMED, centred on the boss's heading) is used.
  laserAim(k: number): { x: number; z: number } {
    const r = laserLength(k);
    const o = this.node(SM_LASER.headingSlot);
    const d = this.nodeAxis(SM_LASER.headingSlot);
    if (o && d) {
      const len = Math.hypot(d[0], d[1]);
      if (len > 1e-9) return { x: o[0] + (d[0] / len) * r, z: o[2] + (d[1] / len) * r };
    }
    const turn = (k / (SM_LASER.frames - 3) - 0.5) * SM_LASER.sweep * BAMS;
    const a = this.heading * BAMS + turn;
    return { x: this.x + Math.sin(a) * r, z: this.z + Math.cos(a) * r };
  }

  // State 21, phase 0 (0x00769808): one beam on the clock's frame 28. Its type: arenas 3 / 4 -> 2 or 3,
  // the others 0 or 1, the higher when the roll is >= 0.5 (0x009773c8). The blast is the form's iparam5.
  // ASSUMED: with no ground callback the beam's floor is the boss's arena circle (SM_ARENAS).
  private waveFrame(): void {
    if (!this.clock.crossed(SM.waveFrame)) return;
    const type = (this.arena === 3 || this.arena === 4 ? 2 : 0) + (this.rand.float() >= 0.5 ? 1 : 0);
    const a = SM_ARENAS[this.arena] ?? SM_ARENAS[0];
    const floor = this.opts.ground ?? ((x: number, z: number) => Math.hypot(x - a.ox, z - a.oz) <= a.range);
    this.pendingShots.push(new SmWave(this.x, this.z, this.heading, type, this.row.iparam[4], floor));
  }

  private burst(x: number, z: number, r: number): void {
    for (const t of this.targets) {
      if (!t.dead && Math.hypot(t.x - x, t.z - z) <= r + PLAYER_RADIUS) this.pendingShots.push(new SmTouch(x, 0, z, t));
    }
  }

  // The body's 19 hit spheres hurt players they touch while the tentacles are up.
  private contactDamage(): void {
    if (!this.contact || !this.nodesKnown) return;
    for (const t of this.targets) {
      if (t.dead) continue;
      const last = this.contactAt.get(t.clientId);
      if (last !== undefined && this.frames - last < SM.contactEvery) continue;
      for (const [slot, r] of SM_PIECES) {
        const p = this.node(slot);
        if (p && Math.hypot(t.x - p[0], t.z - p[2]) <= r + PLAYER_RADIUS) {
          this.contactAt.set(t.clientId, this.frames);
          this.pendingShots.push(new SmTouch(p[0], 0, p[2], t));
          break;
        }
      }
    }
  }

  node(slot: number): [number, number, number] | null {
    if (!this.nodesKnown) return null;
    return [this.nodes[slot * 3], this.nodes[slot * 3 + 1], this.nodes[slot * 3 + 2]];
  }

  // The node's z axis in XZ (not normalised), or null before the render has recorded it.
  nodeAxis(slot: number): [number, number] | null {
    if (!this.axesKnown) return null;
    return [this.axes[slot * 2], this.axes[slot * 2 + 1]];
  }

  // State 11 enter (0x0076ba68).
  private walkEnter(): void {
    this.traveled = 0;
    if (this.field.state2 & 0x800) {
      for (let i = 0; i < SM_PART_COUNT; i++) {
        if (!this.parts[i].counted) {
          this.lastPart = i;
          break;
        }
      }
      this.field.state2 = (this.field.state2 & ~0x800) | 0x400;
    }
    let param: number;
    if ((this.field.state2 & 0x400) === 0) {
      const list = SM_ARENA_CHOICES[this.phase] ?? SM_ARENA_CHOICES[0];
      param = list[Math.trunc(this.rand.float() * list.length)];
    } else param = 4;
    this.send(3, param);
  }

  // UpdateMovement 0x00768e3c.
  private walkFrame(): void {
    const dx = this.tx - this.x;
    const dz = this.tz - this.z;
    if (dx * dx + dz * dz > SM.walkSpeed * SM.walkSpeed) {
      this.x += Math.sin(this.heading * BAMS) * SM.walkSpeed;
      this.z += Math.cos(this.heading * BAMS) * SM.walkSpeed;
      this.traveled += SM.walkSpeed;
    } else {
      this.flags |= 0x1000;
      if (this.traveled >= SM.walkSpeed) this.send(4, this.arena);
    }
  }

  // State 13 (CheckPhaseEntryCondition 0x00769050).
  private arrivalFrame(): void {
    const a = SM_ARENAS[this.arena] ?? SM_ARENAS[0];
    for (const t of this.targets) {
      if (t.dead) continue;
      if ((t.x - a.ox) ** 2 + (t.z - a.oz) ** 2 < a.range * a.range) {
        this.flags |= 2;
        return;
      }
    }
    if (this.frames > SM.idleLimit) this.flags |= 2;
  }

  // State 15 (ProcessPhaseLogic 0x00769174).
  private chooseAttack(): void {
    if (this.pause >= 1) {
      this.pause--;
      return;
    }
    const a = SM_ARENAS[this.arena] ?? SM_ARENAS[0];
    let near = false;
    for (const t of this.targets) if (!t.dead && (t.x - a.ox) ** 2 + (t.z - a.oz) ** 2 < a.range * a.range) near = true;
    if (!near) {
      if (this.frames > SM.idleLimit) this.flags |= 0x102;
      return;
    }
    // FindNearestPlayer(10000), the direction and the distance to it.
    let best: AiTarget | null = null;
    let bestSq = 1e8;
    for (const t of this.targets) {
      if (t.dead) continue;
      const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
      if (d < bestSq) {
        best = t;
        bestSq = d;
      }
    }
    this.targetId = best ? best.clientId : null;
    let cls: number;
    if (!best) cls = 2;
    else {
      this.tdist = Math.sqrt(bestSq);
      this.dirX = best.x - this.x;
      this.dirZ = best.z - this.z;
      cls = this.tdist < SM.near ? 0 : this.tdist < SM.far ? 1 : 2;
      const ang = Math.round(Math.atan2(this.dirX, this.dirZ) / BAMS) & 0xffff;
      const diff = Math.abs(((ang - this.heading + 0x8000) & 0xffff) - 0x8000);
      if (diff > SM.behind) cls = 3;
    }
    const table = this.phase <= 1 ? W_A : this.phase === 2 ? W_C : W_B;
    const pick = weightedPick(table[cls], this.rand.float());
    this.send(0, SM_ATTACKS[pick] ?? 0x11);
  }

  // State 17 (0x00769418): the stomp.
  private stomp(): void {
    const c = this.clock;
    if (c.crossed(SM.stompFrame)) this.events.push({ kind: 'effect', name: 'stomp', state: 17 });
    if (this.clock.pulse) {
      this.queue(this.rand.float() < 0.5 ? 0x13 : 0x14);
      this.flags |= 2;
    }
  }

  // State 22 enter (0x0076b700): the followers go round the average player.
  private tentaclesAround(): void {
    const spots: Array<{ x: number; z: number; angle: number } | null> = [null, null, null, null];
    let n = 0;
    for (const t of this.targets) {
      if (t.dead || n >= 4) continue;
      spots[n++] = { x: t.x, z: t.z, angle: Math.round(((t.angle ?? 0) / BAMS)) & 0xffff };
    }
    this.field.placeFollowers({ x: 0, z: 0 }, spots);
  }

  // --- the end ----------------------------------------------------------------------------

  private cutsceneEnter(s: number): void {
    this.field.hideAll();
    if (s === SM_STATE.intro) {
      this.events.push({ kind: 'bgm', name: this.variant === 1 ? 'boss09b' : 'boss09' });
      this.field.state2 |= 1;
    } else this.field.state2 |= 0x20;
    this.cutWait = 0;
  }

  private cutsceneLeave(): void {
    if (this.sid !== 0x1b && this.sid === 0x1c) {
      // set_monster_spawn_initdata_as_dead of the body, no EXP, no drop.
      this.field.state2 |= 0x1000;
      this.events.push({ kind: 'setDead' });
    }
    this.flags |= 0x1000;
  }

  // State 29 (HandlePhaseLogic 0x00769a88).
  private deathFrame(): void {
    this.deathTimer = f32(this.deathTimer + 1);
    if (this.deathTimer > SM.deathFrames) {
      let ours: boolean | null = null;
      for (const p of this.parts) {
        if (p.ours !== null) {
          ours = p.ours;
          break;
        }
      }
      if (this.lastPart >= 0 && this.lastPart < SM_PART_COUNT && this.parts[this.lastPart].ours !== null) ours = this.parts[this.lastPart].ours;
      this.events.push({ kind: 'killed', x: this.x, z: this.z, ours });
      this.flags |= 2;
    }
  }

  // --- post-hook: UpdatePositionAndCollision 0x0076a0b8 ------------------------------------

  private post(): void {
    if ((this.flags & 8) === 0) this.animate();
    if (this.flags & 0x20) this.cutsceneWait();
    this.frames++;
    if (this.kind !== 0 && (this.kind < 4 || this.kind > 7)) this.fight++;
    if (this.fight > SM.timeLimit) this.send(1, 0);
  }

  private animate(): void {
    const a = SM_ANIMS[Math.max(0, this.anim)];
    if (this.anim !== this.clockAnim) {
      this.clock.set(this.opts.frames(a.motion), a.speed, a.loop);
      this.clockAnim = this.anim;
    }
    this.clock.step();
    if (this.flags & 4 && this.clock.pulse) this.flags |= 2;
  }

  // HandleStateOrPacket 0x0076a658 with the cutscene ended when the animation has.
  private cutsceneWait(): void {
    if (!this.clock.ended) {
      this.cutWait = 0;
      return;
    }
    if ((this.flags & 0x2000) === 0) {
      if (this.sid !== 0x1b) this.enterDefault();
      else {
        this.cutWait = SM.endingWait;
        this.flags |= 0x2000;
      }
      return;
    }
    if (this.cutWait >= 0) this.cutWait--;
    if (this.cutWait < 0) {
      this.enterDefault();
      this.flags &= ~0x2000;
    }
  }

  private enterDefault(): void {
    this.flags = (this.flags & ~0x20) | 2;
  }

  // --- HP and phases ---------------------------------------------------------------------------

  private revive(p: SmPart): void {
    p.dead = false;
    p.hp = p.maxHp;
    p.counted = false;
  }

  // HandlePhaseCompletion 0x00767d88.
  private phaseCompletion(): boolean {
    if (this.kind !== 3) return false;
    let f = this.flags;
    if (this.sid === 0x18) {
      if (f & 0x400) {
        this.send(0, 0x1c);
        return true;
      }
      if (f & 0x200) {
        this.send(0, 0x17);
        this.flags &= ~0x200;
        return true;
      }
    }
    if ((f & 0x100) === 0) return false;
    let c = this.phase;
    let sendIt = PHASE_SEND[c] ?? 0;
    if (this.sid < 0xf || this.sid > 0x10) {
      if (c === 1 || c === 4) {
        if (this.frames < 0x1518 && (this.field.state2 & 0x800) === 0) {
          c -= 1;
          this.phase = c;
          sendIt = 0;
        } else {
          c += 1;
          this.phase = c;
        }
      } else if (c === 0 || (c >= 2 && c <= 3)) {
        c += 1;
        this.phase = c;
      }
    } else {
      c += PHASE_STEP[c] ?? 0;
      sendIt = 1;
      this.phase = c;
    }
    if (c > 4) {
      this.phase = 0;
      c = 0;
      this.flags |= 0x200;
    }
    if (this.field.state2 & 0x400) {
      if (c < 4) c = 3;
      this.phase = c;
    }
    f = this.flags;
    if (sendIt === 0 && (f & 0x400) === 0) return false;
    this.send(0, 0x18);
    return true;
  }

  // vtable +0x100 (0x00769d04): a part died and others are left.
  private hitReaction(): void {
    this.bodyHit = false;
    if (this.flags & 0x800) return;
    if (this.kind === 3) this.send(0, 0x10);
  }

  // vtable +0x104 (0x00769d7c): the body died (the last part of the form).
  private phaseTransition(): void {
    if (this.kind === 2) {
      this.pending = -1;
      if (this.sid !== 0x1a && (this.flags & 1) === 0) {
        this.dispatch(this.sid, 5);
        this.sid = 0x1a;
        this.state = this.name();
        this.dispatch(0x1a, 4);
      }
      // Form 2's stats row: every part starts again with hp / 4.
      this.remaining = 4;
      const hp = Math.max(1, Math.trunc(this.hpRows[1] / 4));
      for (const p of this.parts) {
        p.maxHp = hp;
        p.hp = hp;
      }
      this.bodyDead = false;
      this.bodyHit = false;
      this.field.state2 |= 0x20;
      this.field.resetLeads();
      this.events.push({ kind: 'phase', form: 2 });
    } else if (this.kind === 3) this.send(0, 0x1b);
  }

  // The parts as enemies: SaintEmilionPart_Update 0x00765024 and the death
  // handler 0x0076512c.
  private updateParts(): void {
    for (const p of this.parts) {
      if (this.field.state2 & 0x800 && !p.counted) p.hp = Math.min(p.maxHp, Math.max(0, this.row.iparam[0]));
      if (p.dead) this.partDied(p);
      p.hit = false;
    }
  }

  private partDied(p: SmPart): void {
    if (p.counted) return;
    let n = this.remaining - 1;
    if (this.kind === 3) {
      if ((this.field.state2 & 0x400) === 0) {
        if (n === 0) {
          // The last one of the form does not die yet.
          this.remaining = 1;
          this.field.state2 |= 0x800;
          p.dead = false;
          return;
        }
        this.remaining = n;
      } else this.remaining = n;
    } else this.remaining = n;
    n = this.remaining;
    p.counted = true;
    if (n > 0) this.bodyHit = true;
    else this.bodyDead = true;
  }
}

// WeightedRandomSelect 0x0077776c: the index whose running total passes
// floor(r * total); 0 when all weights are 0.
export function weightedPick(weights: readonly number[], r: number): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total === 0) return 0;
  const v = Math.trunc(r * total);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (v < acc) return i;
  }
  return weights.length - 1;
}

// --- proxy brains --------------------------------------------------------------------------

// The brain of the invisible enemy of a part or a tentacle (render/combat.ts keeps one so
// strikes, the lock-on and the other clients' 6x0A find it by id).
export class SmChildAi {
  state = 'child';
  readonly motion = null;
  readonly superArmor = true;
  readonly owner: SaintMilionAi;
  readonly index: number; // 0 .. 7 a part, 8 .. 23 a tentacle
  private readonly out: AiFrame = { motion: null, x: 0, z: 0, angle: 0, hit: null };
  constructor(owner: SaintMilionAi, index: number) {
    this.owner = owner;
    this.index = index;
  }
  get part(): SmPart | null {
    return this.index < SM_PART_COUNT ? this.owner.parts[this.index] : null;
  }
  get entity(): SpinnerEntity | null {
    return this.index >= SM_PART_COUNT ? this.owner.field.entities[this.index - SM_PART_COUNT] : null;
  }
  get untargetable(): boolean {
    const p = this.part;
    if (p) return !this.owner.partHittable(p.index);
    const e = this.entity;
    return !e || !e.targetable;
  }
  tick(): AiFrame {
    const e = this.entity;
    if (e && e.shots.length) this.out.shots = e.shots.splice(0);
    else delete this.out.shots;
    return this.out;
  }
  onDamage(): void {}
  resume(): string {
    return this.state;
  }
  kill(): void {}
}

export { SmField };

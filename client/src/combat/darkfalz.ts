// Dark Falz, the control object (TBoss4DarkFalz 0xC8; PsoBB.exe, Ephinea
// 1.25.13): the scene machine, the Darvants, and the owner of the three forms
// (combat/darkfalz1.ts, darkfalz2.ts, darkfalz3.ts). See combat/darkfalzcommon.ts
// for the sources and for the leader / follower split.
//
// The control (ctor 0x0044C93C, update `UpdateVoloptAiState`) runs a table of 16
// scenes at 0x009A5940. Per tick: if it is the leader, the scene's "lead"
// procedure (+0xC) decides; every client then runs the "all" procedure (+0x10).
// A scene change is a 6x19 with the scene number (PlayerSendFootstepPacket
// 0x0044BF18); a form's order is a 6x19 with phase 0xFFFF and the packed action,
// which the receiver (0x0044CE6C) hands to the form of the scene it is in
// (scenes 5 / 6 form 1, 7 / 8 / 9 form 2, 12 / 13 / 14 form 3).
//
// The Darvants (ZAKO, class vtable 0xAF7D60, update 0x0045F25C, table
// 0x009A6780): created in the ring of 5 / 15 / 25 / 35 at radius 28.571 + 57.143
// per ring (x1.25 in Ultimate) about (0, -13, 0) by InitializeVoloptSpawnConfig
// (0x0044C430). State 0 rises 1/3 a frame to y 6, state 1 hovers and looks for a
// player within 150 every 60 frames, state 2 chases for 180 frames, state 3 sinks
// to y -13 and goes. In states 1 and 2, every 16th frame the nearest player
// within 8 is hit for the Darvant's ATP. A Darvant that dies (or is still alive
// when the scene leaves ZAKO) adds one to the control's kill count (+0x394); the
// scene ends when the count reaches row 53 iparam1 times the party size.
//
// The spat and beam Darvants (classes 0xAF7EC0 / 0xAF8020; PROVEN in this session: the launch, the fall,
// the chase with its cage, the beam's constructor and flight, and the bob, see DARVANT). ASSUMED
// (neither the dump nor the JP C has it): the spat's spawn height (25), the wall test of the nearest
// search (0x00780D3C, not ported), the hit's callee (the player's +0x60, so a spat or beam is not removed
// by a hit), the hit test of a dead spat or beam (its box bit stays set; the reader is not traced),
// the exclusion zones of 0x0044C674 (players are not pushed out of the cage props), the camera
// and fade work of the cutscene objects (only their durations are kept), and the
// party size at the moment the control is built (the exe counts the entities of
// the room in its constructor).

import { BrainBase } from './enemyfsm.ts';
import type { AiFrame, AiTarget } from './enemyai.ts';
import type { EnemyShot } from './enemyshots.ts';
import {
  BAMS,
  CASKET,
  DF_DARVANT_MAX,
  DF_ID,
  DfEntity,
  EMPTY_ROW,
  SCENE,
  SCENE_FRAMES,
  SCENE_NAMES,
  STALL_TICKS,
  cosB,
  sinB,
  type DfEvent,
  type DfFight,
  type DfRows,
  type Vec3,
} from './darkfalzcommon.ts';
import { DfForm1, F1, type Form1Row } from './darkfalz1.ts';
import { DfForm2, F2, type Form2Row } from './darkfalz2.ts';
import { DfForm3, F3, f3Spot, type Form3Row } from './darkfalz3.ts';
import { bossCameraView, captureCameraLive, type BossCameraSource, type LiveCameraInputs } from './darkfalzcamera.ts';

export { SCENE, SCENE_NAMES, DF_ID } from './darkfalzcommon.ts';

// DEMO_WARP0's cutscene object (exe ctor 0x004513D4, timer +0xB8): -1 at its
// ctor, +1 per update, held at 120 (update 0x004512E0). The port's scene frames
// count from 1 at the first tick, so the timer is frames - 1. Null outside
// DEMO_WARP0 (the object is not drawn; ASSUMED: it is destroyed with the scene).
export function demoWarpFrame(scene: number, sceneFrames: number): number | null {
  if (scene !== SCENE.demoWarp0) return null;
  return Math.min(SCENE_FRAMES.demoWarp0, sceneFrames - 1);
}

export const DARVANT = {
  // Ring spawn.
  ringCounts: [5, 15, 25, 35] as readonly number[],
  ringRadius: 28.571428,
  ringStep: 57.142856,
  ultimateScale: 1.25,
  centerY: -13,
  // States.
  rise: 0,
  hover: 1,
  chase: 2,
  dead: 3,
  spit: 4,
  riseStep: 1 / 3,
  top: 6,
  sinkLimit: -13,
  look: 150, // [0xA45984]
  lookEvery: 60,
  chaseFrames: 180,
  accel: 0.05 * 0.5833333, // [0xA45990]
  ring: 8, // the circle about the player the chase aims at
  auraReach: 8, // [0xA45A0C]
  auraEvery: 16,
  // The spat ones (class 0xAF7EC0; table 0x009A6794: 2 chase 0x004601B0, 3 sink 0x00460590,
  // 4 fall 0x00460620; factory 0x00460778). PROVEN, read per instruction in PsoBB.exe:
  // - Launch (factory): vel = unit(-x, 0, -z) * s, s = rand * 0.41666665 + 1.6666666 (0x00A459D8 =
  //   0.25 * 0x00A459D4). So the spat leaves its spawn point toward the room's centre.
  // - Fall (state 4, 0x00460620): vy += -0.015 (0xBC75C290 at 0x00A459C8), then pos += vel. While
  //   y >= 6 it keeps falling; the first tick with y < 6 sets y = 6, vy = 0 and the state to 2.
  spitGravity: -0.015,
  spitTop: 6,
  spitLaunchBase: 1.6666666,
  spitLaunchRand: 0.41666665,
  // Chase (state 2, 0x004601B0 = 0x004601E8 retarget + 0x0046032C horizontal law, then pos += vel).
  // Retarget at clock & 0x7F == 0 (0x004601E8, the clock read before its increment): with no target,
  // the nearest player within 287.5 (0x438FC000, 0x007714CC); with one, the target is dropped and the
  // aim point becomes form 1 + 110 * (sin, cos)(rand * 65536) (0x00A459A8 = 0x00A45A1C + 10).
  spitSearch: 287.5,
  wander: 110,
  // The law (0x0046032C): the aim is the target's (or the wander) xz + 16 * (sin, cos)((w & 7) * 45 deg),
  // w = the +0x1C word (0x00A459B8 = 2 * [0x00A45A0C]). vx (vz) moves by +-acc toward the aim (acc =
  // 0.05 * [0x00A45A18]); vy = 0; then the cage (0x004604BC, below); then the speed: while |v| > the cap
  // (0x3A8, the row 57 clamp) v = unit(v) * (|v| - acc), and the speed is kept in 0x3A0.
  aimRing: 16,
  spitAccel: 0.05 * 1.75 * 0.5833333,
  // The cage (0x004604BC, state 2 only): inside the circle of 100 about form 1 (xz; [0x00A45A1C]) the
  // spat is put on that circle, toward its own side (1, 0) when it is within 0.01 of the centre
  // (0x009005BC). Players are not involved.
  cageRadius: 100,
  cageMin: 0.01,
  // The beam's Darvants (Ultimate only, 0x00458E44 / 0x00460D34): three per living
  // player about the body, at radius 12.5 (0x00A45788): (0, -1), (-0.86, 0.5) and
  // (0.86, 0.5) times the radius (constants 0x009001E0..E8). Their constructor 0x00460DE4
  // (PROVEN) puts them at y -13 (beamFloor) with timer 150 (beamTimer) and state 0, and gives the
  // velocity: unit(p + side * offset - pos) * cap, p the nearest player within 100 (beamSearch), or
  // unit(-pos) when there is none (the offsets are +-4 by w & 3: x by bit 0, z by bit 1).
  beamRadius: 12.5,
  beamOffsets: [
    [0, -1],
    [-0.86, 0.5],
    [0.86, 0.5],
  ] as readonly (readonly [number, number])[],
  beamFloor: -13,
  beamTimer: 150,
  beamSearch: 100,
  beamSide: 4,
  // State 0 (0x00460B84) rises 10/9 a frame to the top 6, then state 2 (the flight, 0x00460C10):
  // pos += vel; the timer counts down and the Darvant dies when it is below 0 or |xz| > 260.
  beamTop: 6,
  beamReach: 260,
  beamRise: 10 / 9,
  // The ring's hit box cycle (PsoBB.exe UpdateDarvant 0x0045F25C, states 1 and 2): the
  // timer +0x3B4 counts down a frame; below 0 it is reloaded with 0xA8C and the box goes off,
  // below 0x1C2 the box is on (+0x3B0 is the flag). ASSUMED: the timer starts at 0.
  boxCycle: 0xa8c,
  boxOnBelow: 0x1c2,
  // The ring's forced radar icon (0x0045F25C tail: colour 0xff7f5126, scale 1.0, flag 1).
  forcedIconColour: 0xff7f5126,
  forcedIconScale: 1,
  // The bob of state 2 for the spat and the beam (the dispatchers 0x0045FF50 / 0x00460938, PROVEN):
  // after the state function, y += 0.1 * sin(angle), then angle += step. The phase is
  // ROUND(rand * 65536) and the step ROUND(rand * 2184 + 1092) (0x0045FBD4, every kind).
  bobAmp: 0.1,
  bobPhaseRange: 65536,
  bobStepBase: 1092,
  bobStepRand: 2184,
  // The fparam1 clamp of 0x0045FBD4 (see darvantRowSpeed): valid in (1/3, 10 x the default].
  // Defaults are 0x00A45A14 (the ring's row 53) and 0x00A45A18 = 1.75 x that (row 57, the spat and beam
  // cap). Both are written once by 0x00461028 (PROVEN; the constants 0x00900540 = 1.75, 0x00A45A0C = 8).
  speedFloor: 1 / 3,
  fallbackSpeed: 0.5833333,
  fallbackSpeedFalz: 1.75 * 0.5833333,
  // The spat and beam aura (the dispatchers, PROVEN): in states 1 and 2 only, every n frames where
  // n = trunc(8 / speed) when speed > 0.5 (the power of two at or above n, minus 1, is the mask) and 16
  // otherwise; a hit is the nearest player within 8 (0x00A45A0C). The Darvant is not removed by it.
  auraSpitBeamReach: 8,
} as const;

// 0x0045FBD4's clamp of a row's fparam1 (0x0077A6CC): the value when it is in (speedFloor, 10 x
// dflt], else dflt.
export function darvantRowSpeed(f1: number, dflt: number): number {
  return f1 <= DARVANT.speedFloor || f1 > 10 * dflt ? dflt : f1;
}

// One Darvant.
export class Darvant extends DfEntity {
  st: number = DARVANT.rise;
  kind: 'ring' | 'spit' | 'beam' = 'ring';
  // The velocity (+0x394, +0x398, +0x39c). The spat and beam fly with it; the ring does not.
  vx = 0;
  vy = 0;
  vz = 0;
  homeX = 0;
  homeZ = 0;
  target = -1; // +0x390 (-1: none)
  timer = 0; // +0x3ac (the ring); the beam's flight timer (+0x384)
  clock = 0; // +0x3c0
  // The spat / beam speed (+0x3a0: the launch speed, then the speed of the last law step; the aura's
  // cadence reads it).
  scale = 0;
  // The cap of the spat's and beam's speed (+0x3a8, the row 57 clamp).
  cap = 0;
  // The spat's aim point (+0x3cc, +0x3d4; y is unused).
  aimX = 0;
  aimZ = 0;
  // The bob phase and step (+0x3c4, +0x3c8).
  bobAngle = 0;
  bobStep = 0;
  // The ring's hit box flag (+0x3B0, bit 0 of the box at +0x38C is set to it each tick) and its
  // cycle timer (+0x3B4, see DARVANT.boxCycle). Created by darvantBoxStart; nothing else writes
  // the timer (no reset on a state change or a hit).
  boxOn = false;
  boxTimer = 0;
  speed = 0.4; // +0x3a4: the ring's cap (the row 53 clamp, darvantRowSpeed)
  born = 0;
  constructor(entity: number, hp: number) {
    super(entity, hp);
  }
  // A ring's hit box is on only in its window (the lock-on and the hit read bit 0). The spat
  // and beam boxes are proven on from creation and never cleared by the Dark Falz code: the spat
  // factory (0x00460778) sets bit 0 of [+0x38C]+0x18 at 0x004608D5 (once, with the spit state 4);
  // the beam's ctor (0x00460DE4, state 0 set at 0x00461002) sets it at 0x00461012 (once, not per
  // tick: the state 0 function 0x00460B84 does not touch the box). Nothing in 0x0044C000..0x00461000
  // clears it. The exe's removal is the due-for-destruction flag (+0x08, value 1; 0x00460590 and
  // 0x00460CA4: sink at 1/3 a tick, flagged once y < -13); the box is still on while they sink.
  // Dead ones are not targetable (the port's rule; the exe's hit test is not traced, ASSUMED).
  get targetable(): boolean {
    if (this.gone || this.st === DARVANT.dead) return false;
    if (this.kind === 'ring') return this.boxOn;
    return true;
  }
}

// The box timer a Darvant is created with (exe 0x0045FBD4, the init shared by the ring, the spat
// and the beam ones): w = the entity index word (+0x1C, "entity_index_small + 4096", read at
// 0x0045FD65), then +0x3B4 = 225 * (2 * (w % 6) + 2) = 450 * (w % 6 + 1) (0x0045FDC8..0x0045FDF9:
// the multiply by 0x2AAAAAAB is a signed divide by 6, the rest is w - 6 * (w / 6), then * 225),
// and +0x3B0 = 0. So the Darvants start staggered at 450, 900, .. 2700 ticks by their id.
export function darvantBoxStart(w: number): number {
  return 450 * ((w % 6) + 1);
}

export function darvantBoxStep(d: Darvant): void {
  const t = d.boxTimer - 1;
  if (t < 0) {
    d.boxOn = false;
    d.boxTimer = DARVANT.boxCycle;
  } else {
    d.boxTimer = t;
    if (t < DARVANT.boxOnBelow) d.boxOn = true;
  }
}

// The radar icon of a ring Darvant (the tail of 0x0045F25C): none once dead; the forced
// icon (0xff7f5126, scale 1, icon3 flag 1) while the box is off; the plain one (0xffffa24c,
// range checked) while it is on. The exe calls it every live frame, in the rise too.
export function darvantRingIcon(d: Darvant): 'forced' | 'plain' | null {
  if (d.gone || d.st === DARVANT.dead) return null;
  return d.boxOn ? 'plain' : 'forced';
}

export interface DarkFalzOptions {
  x: number;
  z: number;
  angle: number;
  difficulty: number; // 0..3
  rows: DfRows;
  leader: () => boolean;
  selfId: () => number;
  // The party at the time the control is built (+0x398, 1..4).
  partySize: () => number;
  rng: () => number;
  // The control's entity index word (render/combat.ts entityId, 0x1000 | slot ASSUMED). Proven
  // (0x0044CFC0): a Darvant's small id is the control's +0x1C + counter, the entity id is +0x2C +
  // counter, counter = control +0x38C in 1 .. 0x1FD. So the Darvants' words are that base + 1 .. 0x1FD.
  // Where the base comes from (PROVEN in part): the control's ctor 0x0044C93C calls the record
  // init (vtable slot 0x14C of 0x00AF6A20 = 0x00786848), which copies the set record's word 3 into
  // +0x1C; the registry (0x007B4D98 / 0x007B4F54, sorted by +0x1C) counts an id below 0x1000 in
  // bucket 0xAAE168 and 0x1000..0x3FFF in bucket 0xAAE164 (the enemies). The loader that writes
  // word 3 is not traced, so 0x1000 | index stays ASSUMED.
  entityId?: number;
}

const EMPTY_ROWS: DfRows = { darvant: EMPTY_ROW, df1: EMPTY_ROW, df2: EMPTY_ROW, df3: EMPTY_ROW, darvantFalz: EMPTY_ROW };

const clampRange = (v: number, lo: number, hi: number, dflt: number) => (v < lo || v > hi ? dflt : v);

export class DarkFalzAi extends BrainBase implements DfFight {
  state = 'EDITOR';
  readonly difficulty: number;
  readonly ultimate: boolean;
  readonly events: DfEvent[] = [];
  readonly rows: DfRows;
  // 6x19's fields the owner reads each tick (cleared after).
  readonly shots: EnemyShot[] = [];
  readonly superArmor = true;
  scene: number = SCENE.editor;
  private sceneTimer = 0; // +0x388
  private sceneFrames = 0; // ticks since the scene was set (the boss camera's frame; UNCLEAR, see darkfalzcamera.ts)
  // The boss camera's live pivots, captured at the scene enters that read them (darkfalzcamera.ts).
  private camLive: LiveCameraInputs = {};
  private soundTimer = 0; // +0x37c
  made = 0; // +0x390
  kills = 0; // +0x394
  players: number; // +0x398
  private counter = 1; // +0x38c
  form1: DfForm1 | null = null;
  form2: DfForm2 | null = null;
  form3: DfForm3 | null = null;
  readonly darvants: Darvant[] = [];
  private readonly byId = new Map<number, Darvant>();
  private targets: readonly AiTarget[] = [];
  private readonly aliveList: { clientId: number; x: number; z: number }[] = [];
  private aliveCount = 0;
  private readonly isLeader: () => boolean;
  private readonly self: () => number;
  private readonly rand: () => number;
  private readonly entityId: number;
  finished = false;
  private killedSent = false;
  readonly cx: number;
  readonly cz: number;
  private readonly out: AiFrame;
  private readonly tmp: Vec3 = [0, 0, 0];

  constructor(opts: DarkFalzOptions) {
    super(opts.x, opts.z, opts.angle, opts.rng);
    this.difficulty = opts.difficulty;
    this.ultimate = opts.difficulty === 3;
    this.rows = opts.rows ?? EMPTY_ROWS;
    this.isLeader = opts.leader;
    this.self = opts.selfId;
    this.rand = opts.rng;
    this.entityId = opts.entityId ?? 0x1000;
    this.cx = opts.x;
    this.cz = opts.z;
    // The constructor counts the room's players: 0 or more than 4 -> 1.
    const n = opts.partySize();
    this.players = n < 1 || n > 4 ? 1 : n;
    this.out = { motion: null, x: this.x, z: this.z, angle: this.angle, hit: null };
  }

  // The control itself is nothing to hit.
  get untargetable(): boolean {
    return true;
  }
  get invulnerable(): boolean {
    return true;
  }
  onDamage(): void {}
  resume(): string {
    return this.state;
  }
  get removed(): boolean {
    return this.finished;
  }

  // --- DfFight -----------------------------------------------------------------

  leader(): boolean {
    return this.isLeader();
  }
  random(): number {
    return this.rand();
  }
  selfId(): number {
    return this.self();
  }
  aliveDarvants(): number {
    return this.made - this.kills;
  }
  shoot(shot: EnemyShot): void {
    this.shots.push(shot);
  }
  alive(): readonly { clientId: number; x: number; z: number }[] {
    return this.aliveList;
  }
  randomAlive(): number {
    // GetRandomAlivePlayerEntityIndex (0x0044D084): up to 4 alive, one at random.
    const n = Math.min(4, this.aliveCount);
    if (n === 0) return 0xffff;
    return this.aliveList[Math.min(n - 1, Math.trunc(this.rand() * n))].clientId;
  }
  playerPos(clientId: number): { x: number; z: number } | null {
    for (let i = 0; i < this.targets.length; i++) if (this.targets[i].clientId === clientId) return this.targets[i];
    return null;
  }

  // 6x19, applied here first and then sent.
  send(phase: number, packed: number): void {
    this.events.push({ kind: 'send', phase, packed });
    this.receive(phase, packed);
  }

  // HandleVoloptEntityStateTransition (0x0044CE6C).
  receive(phase: number, packed: number): void {
    if (phase !== 0xffff && phase >= 0 && phase < 0x10 && phase !== this.scene) this.setScene(phase);
    if (packed === 0xffffffff) return;
    switch (this.scene) {
      case SCENE.appType1:
      case SCENE.type1:
        this.form1?.receive(packed);
        break;
      case SCENE.appType2:
      case SCENE.type2:
      case SCENE.dieType2:
        this.form2?.receive(packed);
        break;
      case SCENE.demoWarp3:
      case SCENE.type3:
      case SCENE.dieType3:
        this.form3?.receive(packed);
        break;
      default:
        break;
    }
  }

  // Ids for the Darvants (VoloptForm7Hazard_CalculateOffset: 1 .. 0x1fd).
  private allocId(): number {
    if (this.counter < 1 || this.counter > DF_DARVANT_MAX) return -1;
    return this.counter++;
  }
  nextDarvantId(): number {
    return this.allocId();
  }

  private newDarvant(kind: 'ring' | 'spit' | 'beam', x: number, y: number, z: number): Darvant | null {
    const id = this.allocId();
    if (id < 0) return null;
    // The shared init of every Darvant (0x0045FBD4): the row 53 clamp (the ring's cap, +0x3A4), the
    // row 57 clamp (+0x3A8, the spat's and beam's cap), the bob phase and step (two rands, in that order).
    // The spat and the beam take HP from row 57 and the rest from row 53 (ASSUMED for the beam's HP).
    const row = kind === 'spit' ? this.rows.darvantFalz : this.rows.darvant;
    const d = new Darvant(id, row.hp);
    d.kind = kind;
    d.x = x;
    d.y = y;
    d.z = z;
    d.homeX = x;
    d.homeZ = z;
    d.speed = darvantRowSpeed(this.rows.darvant.f1, DARVANT.fallbackSpeed);
    d.cap = darvantRowSpeed(this.rows.darvantFalz.f1, DARVANT.fallbackSpeedFalz);
    d.bobAngle = Math.round(this.rand() * DARVANT.bobPhaseRange) & 0xffff;
    d.bobStep = Math.round(this.rand() * DARVANT.bobStepRand + DARVANT.bobStepBase);
    d.timer = 0;
    d.boxTimer = darvantBoxStart(this.entityId + id);
    d.born = this.made;
    this.made++;
    this.darvants.push(d);
    this.byId.set(id, d);
    this.events.push({ kind: 'darvant', entity: id });
    return d;
  }

  // The nearest live player within reach on the XZ plane (EnemyGetNearestTargetInRange, 0x007714CC,
  // strict: the distance must be under the reach). ASSUMED: the exe's line-of-sight test is not ported.
  private nearestAlive(x: number, z: number, reach: number): { clientId: number; x: number; z: number } | null {
    let best: { clientId: number; x: number; z: number } | null = null;
    let bd = reach;
    for (let i = 0; i < this.aliveCount; i++) {
      const p = this.aliveList[i];
      const dist = Math.hypot(p.x - x, p.z - z);
      if (dist < bd) {
        bd = dist;
        best = p;
      }
    }
    return best;
  }

  // Form 2's beam ends (Ultimate only, 0x00458E44, the branch on difficulty 3 before
  // the stop state): three Darvants per living player about the body (the form's
  // position at the end of the beam). An id that is used up skips one (0x0044CFC0).
  spawnBeamDarvants(x: number, y: number, z: number): void {
    for (let p = 0; p < this.aliveCount; p++) {
      for (const [ox, oz] of DARVANT.beamOffsets) {
        const d = this.newDarvant('beam', x + ox * DARVANT.beamRadius, y, z + oz * DARVANT.beamRadius);
        if (d) this.beamConstructor(d);
      }
    }
  }

  // The beam's constructor (0x00460DE4, PROVEN): the velocity is unit(p + side * offset - pos) * cap,
  // where p is the nearest player within beamSearch of the spawn point (the offset: +-beamSide on x by
  // bit 0 of w, and on z by bit 1, w = the +0x1C word); with no player it is unit(-pos). A zero vector
  // becomes (1, 0). The beam starts at y = beamFloor, state 0 (rise), timer beamTimer.
  private beamConstructor(d: Darvant): void {
    const k = (this.entityId + d.entity) & 3;
    const near = this.nearestAlive(d.x, d.z, DARVANT.beamSearch);
    let vx: number;
    let vz: number;
    if (near) {
      const side = DARVANT.beamSide;
      vx = near.x + ((k & 1) !== 0 ? side : -side) - d.x;
      vz = near.z + ((k & 2) !== 0 ? side : -side) - d.z;
    } else {
      vx = -d.x;
      vz = -d.z;
    }
    const len = Math.hypot(vx, vz);
    if (len === 0) {
      vx = 1;
      vz = 0;
    } else {
      vx /= len;
      vz /= len;
    }
    d.vx = vx * d.cap;
    d.vz = vz * d.cap;
    d.vy = 0;
    d.scale = d.cap;
    d.y = DARVANT.beamFloor;
    d.timer = DARVANT.beamTimer;
    d.st = DARVANT.rise;
  }

  // Form 1's HAKILOOP spits one (the factory 0x00460778, PROVEN): the launch is toward the centre
  // from the spawn point (unit(-x, 0, -z), or (1, 0) when that is under 0.01 long) at the speed
  // rand * 0.41666665 + 1.6666666; state 4 (fall). The spawn height is ASSUMED (25; the caller's
  // position is not traced).
  spawnSpit(x: number, z: number): boolean {
    const d = this.newDarvant('spit', x, 25, z);
    if (!d) return false;
    d.st = DARVANT.spit;
    d.target = -1;
    d.aimX = 0;
    d.aimZ = 0;
    let vx = -x;
    let vz = -z;
    if (Math.hypot(vx, vz) < 0.01) {
      vx = 1;
      vz = 0;
    }
    const n = Math.hypot(vx, vz);
    if (n > 0) {
      vx /= n;
      vz /= n;
    }
    const s = this.rand() * DARVANT.spitLaunchRand + DARVANT.spitLaunchBase;
    d.scale = s;
    d.vx = vx * s;
    d.vz = vz * s;
    d.vy = 0;
    return true;
  }

  // --- scenes -------------------------------------------------------------------

  // The boss camera for the current scene (combat/darkfalzcamera.ts; null: the
  // normal camera). `source` supplies the motion and the pivots; null until the
  // camera asset is read (see darkfalzcamera.ts), so the view is null.
  cameraView(source: BossCameraSource | null = null): { source: Vec3; target: Vec3; up: Vec3 } | null {
    return bossCameraView(this.scene, this.sceneFrames, source);
  }

  // The live pivot inputs of the boss camera (darkfalzcamera.ts LiveCameraInputs): the poses the
  // scene enters captured. Pass them to cameraSourceOf(rel, ai.cameraLive()).
  cameraLive(): LiveCameraInputs {
    return this.camLive;
  }

  // The DEMO_WARP0 object's timer (demoWarpFrame), null outside DEMO_WARP0.
  get warpFrame(): number | null {
    return demoWarpFrame(this.scene, this.sceneFrames);
  }

  private setScene(n: number): void {
    if (n < 0 || n >= 0x10) return;
    this.scene = n;
    this.sceneFrames = 0;
    this.state = SCENE_NAMES[n];
    this.events.push({ kind: 'scene', scene: n });
    this.enterScene(n);
  }

  private flag(n: number): void {
    this.events.push({ kind: 'questFlag', flag: n });
  }

  private enterScene(n: number): void {
    // The enters read the forms' poses before they drop the forms (the exe clears its entity pointers here).
    this.camLive = captureCameraLive(this.camLive, n, { form1: this.form1, form2: this.form2, form3: this.form3 });
    switch (n) {
      case SCENE.demoWarp0:
        // 0x0044E504: the players stand in a small circle; the cutscene object.
        this.events.push({ kind: 'place', circle: 'inner', slots: this.players });
        this.sceneTimer = SCENE_FRAMES.demoWarp0;
        break;
      case SCENE.demoWarp1:
        this.sceneTimer = SCENE_FRAMES.demoWarp1;
        break;
      case SCENE.zako:
        // FUN_0044e5b4.cpp (0x0044E4A4): sound 0x369 and the player restore, then
        // InitializeVoloptSpawnConfig.
        this.events.push({ kind: 'se', id: 0x369 });
        this.spawnRings();
        break;
      case SCENE.appType1:
        this.sceneTimer = 0;
        this.events.push({ kind: 'se', id: 0x368 });
        break;
      case SCENE.type1:
        this.form1 = new DfForm1(this, this.form1Row(), this.angle / BAMS);
        this.formSwaps++;
        this.sceneTimer = 0;
        break;
      case SCENE.appType2:
        // 0x0044E2F4: form 1 goes, its flag.
        this.form1 = null;
        this.formSwaps++;
        this.flag(0x33);
        this.sceneTimer = SCENE_FRAMES.appType2;
        break;
      case SCENE.dieType2:
        this.flag(0x35);
        this.form2 = null;
        this.formSwaps++;
        this.sceneTimer = SCENE_FRAMES.dieType2;
        break;
      case SCENE.getRing:
        this.sceneTimer = SCENE_FRAMES.getRing;
        break;
      case SCENE.demoWarp2:
        this.events.push({ kind: 'bgm', track: 2 });
        this.sceneTimer = SCENE_FRAMES.demoWarp2;
        break;
      case SCENE.demoWarp3:
        this.events.push({ kind: 'place', circle: 'outer', slots: this.players });
        this.sceneTimer = SCENE_FRAMES.demoWarp3;
        break;
      case SCENE.dieType3:
        this.flag(0x37);
        this.form3 = null;
        this.formSwaps++;
        this.sceneTimer = SCENE_FRAMES.dieType3;
        break;
      case SCENE.olEnding:
        this.sceneTimer = SCENE_FRAMES.olEnding;
        break;
      default:
        break;
    }
  }

  private form1Row(): Form1Row {
    const r = this.rows.df1;
    const f = Math.round(r.f1);
    return {
      hp: r.hp,
      atp: r.atp,
      moveFrames: clampRange(f, 1, 60, 25) * 30,
      rafoie: r.i1,
      rabarta: r.i2,
      tenchu: r.i3,
      spitMax: this.rows.darvantFalz.i1 < 2 ? 1 : Math.min(6, this.rows.darvantFalz.i1),
    };
  }

  private form2Row(): Form2Row {
    const r = this.rows.df2;
    const b = this.rows.df1;
    return {
      hp: r.hp,
      atp: r.atp,
      moveFrames: clampRange(Math.round(r.f1), 1, 25, 4) * 30,
      stopState: 8 + clampRange(r.i1, 1, 4, 1),
      restaLevel: r.i2 >= 0 && r.i2 <= 14 ? r.i2 : 0,
      rafoie: b.i1,
      rabarta: b.i2,
      tenchu: b.i3,
    };
  }

  private form3Row(): Form3Row {
    const r = this.rows.df3;
    return { hp: r.hp, atp: r.atp, lMagic: r.i1, megid: r.i2, orbs: r.i3 >= 1 && r.i3 <= 8 ? r.i3 : 4, f1: r.f1, power: r.i5 };
  }

  // InitializeVoloptSpawnConfig (0x0044C430): rings of 5, 15, 25, 35.
  private spawnRings(): void {
    const scale = this.ultimate ? DARVANT.ultimateScale : 1;
    let radius = DARVANT.ringRadius * scale;
    const step = DARVANT.ringStep * scale;
    for (const n of DARVANT.ringCounts) {
      const slice = Math.trunc(0x10000 / n);
      for (let i = 0; i < n; i++) {
        const d = this.newDarvant('ring', this.cx + sinB(i * slice) * radius, DARVANT.centerY, this.cz + cosB(i * slice) * radius);
        if (!d) return;
        d.clock = d.entity & 3;
      }
      radius += step;
    }
  }

  // The ZAKO scene is done when the dead are row 53 iparam1 (1..19, else 2) times the party.
  private zakoDone(): boolean {
    const per = clampRange(this.rows.darvant.i1, 1, 19, 2);
    return per * this.players <= this.kills;
  }

  private leadScene(): void {
    switch (this.scene) {
      case SCENE.editor:
        this.setScene(SCENE.waitCasket);
        break;
      case SCENE.waitCasket:
        // 0x0044D490: any player entity within sqrt(900) of the casket.
        for (const t of this.targets) {
          const dx = CASKET.x - t.x;
          const dz = CASKET.z - t.z;
          if (dx * dx + dz * dz <= CASKET.radiusSq) {
            this.send(SCENE.demoWarp0, 0xffffffff);
            break;
          }
        }
        break;
      case SCENE.zako:
        if (this.zakoDone()) this.send(SCENE.appType1, 0xffffffff);
        break;
      case SCENE.type1:
        if (!this.form1 || this.form1.st === F1.dead || this.form1.st === F1.waitKill) this.send(SCENE.appType2, 0xffffffff);
        break;
      case SCENE.type2:
        if (!this.form2 || this.form2.st === F2.dead || this.form2.st === F2.waitKill) this.send(SCENE.dieType2, 0xffffffff);
        break;
      case SCENE.type3:
        if (!this.form3 || this.form3.st === F3.dead || this.form3.st === F3.waitKill) this.send(SCENE.dieType3, 0xffffffff);
        break;
      default:
        break;
    }
  }

  // A follower waits for the leader's scene change in the scenes whose lead
  // procedure decides (ZAKO, TYPE1, TYPE2, TYPE3); after STALL_TICKS ticks it
  // decides itself (ASSUMED failsafe, see darkfalzcommon.ts). The scene
  // machine's other waits are timers every client runs.
  private formSwaps = 0;
  private stall = 0;
  private stalled(): boolean {
    const s = this.scene;
    if (s !== SCENE.editor && s !== SCENE.waitCasket && s !== SCENE.zako && s !== SCENE.type1 && s !== SCENE.type2 && s !== SCENE.type3) {
      this.stall = 0;
      return false;
    }
    if (++this.stall < STALL_TICKS) return false;
    this.stall = 0;
    return true;
  }

  private allScene(): void {
    switch (this.scene) {
      case SCENE.demoWarp0:
        if (--this.sceneTimer < 0) this.setScene(SCENE.demoWarp1);
        break;
      case SCENE.demoWarp1:
        if (--this.sceneTimer <= 0) this.setScene(SCENE.zako);
        break;
      case SCENE.appType1: {
        const t = this.sceneTimer;
        if (t === SCENE_FRAMES.appType1Music) this.events.push({ kind: 'bgm', track: 1 });
        if (t > 0x145) {
          this.flag(0x32);
          this.setScene(SCENE.type1);
        } else this.sceneTimer = t + 1;
        break;
      }
      case SCENE.appType2:
        if (--this.sceneTimer < 0) {
          // 0x0044D7A8: form 2 is made, flag 0x34.
          this.form2 = new DfForm2(this, this.form2Row());
          this.formSwaps++;
          this.flag(0x34);
          this.setScene(SCENE.type2);
        }
        break;
      case SCENE.dieType2:
        // Normal has no third form: it goes straight to the ring.
        if (--this.sceneTimer < 0) this.setScene(this.difficulty === 0 ? SCENE.getRing : SCENE.demoWarp2);
        break;
      case SCENE.getRing:
        if (--this.sceneTimer < 0) this.setScene(SCENE.olEnding);
        break;
      case SCENE.demoWarp2:
        if (--this.sceneTimer <= 0) this.setScene(SCENE.demoWarp3);
        break;
      case SCENE.demoWarp3:
        if (--this.sceneTimer <= 0) {
          // 0x0044DA1C: flag 0x36 and form 3 at the middle of its arena.
          this.flag(0x36);
          f3Spot(F3.middle, this.tmp);
          this.form3 = new DfForm3(this, this.form3Row(), this.tmp[0], this.tmp[2]);
          this.formSwaps++;
          this.setScene(SCENE.type3);
        }
        break;
      case SCENE.dieType3:
        if (--this.sceneTimer < 0) this.setScene(SCENE.olEnding);
        break;
      case SCENE.olEnding:
        if (--this.sceneTimer < 0 && !this.killedSent) {
          // mark_falz_as_dead_and_request_drop (0x0044C230): on_enemy_killed with
          // the position changed to (20, 0, 20) (Normal) or (10226, y, 96).
          this.killedSent = true;
          this.events.push({ kind: 'killed', x: this.difficulty === 0 ? 20 : 10226, z: this.difficulty === 0 ? 20 : 96 });
          this.finished = true;
        }
        break;
      default:
        break;
    }
  }

  // The sound every 300..600 frames while the fight is on (scenes 4..8).
  private sceneSound(): void {
    if (this.scene > 3 && this.scene < 9 && --this.soundTimer < 0) {
      this.events.push({ kind: 'se', id: this.rand() >= 0.5 ? 0x35e : 0x35d });
      this.soundTimer = Math.round(this.rand() * 300 + 300);
    }
  }

  // --- the tick -----------------------------------------------------------------

  private collect(targets: readonly AiTarget[]): void {
    this.targets = targets;
    let n = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.dead) continue;
      let e = this.aliveList[n];
      if (!e) e = this.aliveList[n] = { clientId: 0, x: 0, z: 0 };
      e.clientId = t.clientId;
      e.x = t.x;
      e.z = t.z;
      n++;
    }
    this.aliveList.length = n;
    this.aliveCount = n;
  }

  tick(targets: readonly AiTarget[]): AiFrame {
    const out = this.out;
    this.sceneFrames++;
    out.motion = null;
    out.shots = undefined;
    out.hit = null;
    if (this.finished) return this.finish(out);
    this.collect(targets);
    if (this.isLeader() || this.stalled()) this.leadScene();
    this.allScene();
    this.sceneSound();
    this.tickDarvants();
    if (this.form1) this.form1.tick();
    if (this.form2) this.form2.tick();
    if (this.form3) this.form3.tick();
    // The renderer snaps the drawn pose when this changes (smoothrender.ts): a form
    // appearing or going, or a jump of a form.
    this.warps = this.formSwaps + (this.form1?.warps ?? 0) + (this.form2?.warps ?? 0) + (this.form3?.warps ?? 0);
    if (this.shots.length) {
      out.shots = this.shots.splice(0);
    }
    return this.finish(out);
  }

  // --- the Darvants ---------------------------------------------------------------

  // The die hook (0x0045F224): once, the control counts it.
  killDarvant(d: Darvant): void {
    if (d.st === DARVANT.dead) return;
    this.kills++;
    d.st = DARVANT.dead;
    d.timer = 0;
    d.boxOn = false; // the die hook sets +0x3B0 = 0 (0x0045F238)
    d.dead = true;
    this.events.push({ kind: 'died', entity: d.entity });
  }

  private tickDarvants(): void {
    const keepZako = this.scene === SCENE.zako;
    const keepSpit = this.scene === SCENE.type1;
    // The beam's ones live while the scene is TYPE2 (0x00460938: scene 8, else they die).
    const keepBeam = this.scene === SCENE.type2;
    for (let i = 0; i < this.darvants.length; i++) {
      const d = this.darvants[i];
      if (d.gone) continue;
      if (d.st !== DARVANT.dead) {
        if (d.hp <= 0) this.killDarvant(d);
        else if (d.kind === 'ring' ? !keepZako : d.kind === 'spit' ? !keepSpit : !keepBeam) {
          // The spat and beam dispatchers (0x0045FF50, 0x00460938) kill and return: no step this tick.
          this.killDarvant(d);
          if (d.kind !== 'ring') continue;
        }
      }
      this.stepDarvant(d);
    }
  }

  private stepDarvant(d: Darvant): void {
    d.clock++;
    if (d.kind === 'ring') {
      this.stepRing(d);
      return;
    }
    // The spat and beam dispatchers read the clock before its increment.
    const pre = d.clock - 1;
    switch (d.st) {
      case DARVANT.rise:
        if (d.kind === 'beam') this.beamRise(d);
        break;
      case DARVANT.chase:
        if (d.kind === 'spit') this.spitChase(d, pre);
        else this.beamFlight(d);
        break;
      case DARVANT.spit:
        this.spitFall(d);
        break;
      case DARVANT.dead:
        this.sink(d);
        return;
      default:
        // State 1 has no function in either table.
        return;
    }
    // The dispatcher reads the state after the call: a state 2 reached this tick gets the bob and
    // the aura too (a state 3 reached by the flight's death gets neither).
    if (d.st === DARVANT.chase) {
      this.bob(d);
      this.auraSpitBeam(d, pre);
    }
  }

  // The ring's update (0x0045F25C, table 0x009A6780).
  private stepRing(d: Darvant): void {
    if (d.st === DARVANT.hover || d.st === DARVANT.chase) darvantBoxStep(d);
    switch (d.st) {
      case DARVANT.rise:
        // State 0 (0x0045F628): up a third of a unit a frame.
        d.y += DARVANT.riseStep;
        if (d.y >= DARVANT.top) {
          d.y = DARVANT.top;
          d.st = DARVANT.hover;
          d.timer = DARVANT.lookEvery;
        }
        return;
      case DARVANT.hover: {
        // State 1 (0x0045F6B4): drift home; every 60 frames look for a player.
        this.drift(d, d.homeX, d.homeZ, 0.5);
        if (--d.timer < 0) {
          let best = -1;
          let bd: number = DARVANT.look;
          for (let i = 0; i < this.aliveCount; i++) {
            const p = this.aliveList[i];
            const dist = Math.hypot(p.x - d.x, p.z - d.z);
            if (dist < bd) {
              bd = dist;
              best = p.clientId;
            }
          }
          if (best >= 0) {
            d.target = best;
            d.timer = DARVANT.chaseFrames;
            d.st = DARVANT.chase;
          } else d.timer = DARVANT.lookEvery;
        }
        break;
      }
      case DARVANT.chase: {
        // State 2 (0x0045F8FC): a point on a circle of 8 about the player.
        const p = this.playerPos(d.target);
        if (!p) {
          d.timer = DARVANT.lookEvery;
          d.st = DARVANT.hover;
          break;
        }
        const tx = p.x + sinB(d.entity << 13) * DARVANT.ring;
        const tz = p.z + cosB(d.entity << 13) * DARVANT.ring;
        this.drift(d, tx, tz, d.speed);
        if (--d.timer < 0) {
          d.timer = DARVANT.lookEvery;
          d.st = DARVANT.hover;
        }
        break;
      }
      default:
        // State 3 (0x0045FA94): sink a third a frame; gone below -13.
        this.sink(d);
        return;
    }
    // The aura of states 1 and 2: every 16th frame the nearest player within 8 is hit.
    if (d.st !== DARVANT.rise && (d.clock & (DARVANT.auraEvery - 1)) === 0) {
      let best = -1;
      let bd: number = DARVANT.auraReach;
      for (let i = 0; i < this.aliveCount; i++) {
        const p = this.aliveList[i];
        const dist = Math.hypot(p.x - d.x, p.z - d.z);
        if (dist < bd) {
          bd = dist;
          best = p.clientId;
        }
      }
      if (best >= 0) {
        this.events.push({ kind: 'hit', clientId: best, power: this.rows.darvant.atp, fixed: false, x: d.x, z: d.z, what: 'Darvant' });
      }
    }
  }

  // State 3 of every Darvant (0x00460590 / 0x00460CA4 / 0x0045FA94): sink a third a frame, gone below -13.
  private sink(d: Darvant): void {
    d.y += -DARVANT.riseStep;
    if (d.y < DARVANT.sinkLimit) d.gone = true;
  }

  // The spat's fall (state 4, 0x00460620, PROVEN): vy += gravity, pos += vel; below the top it is
  // put on 6 and goes to the chase (state 2).
  private spitFall(d: Darvant): void {
    d.vy += DARVANT.spitGravity;
    d.x += d.vx;
    d.y += d.vy;
    d.z += d.vz;
    if (d.y < DARVANT.spitTop) {
      d.y = DARVANT.spitTop;
      d.vy = 0;
      d.st = DARVANT.chase;
    }
  }

  // The spat's chase (state 2, 0x004601B0): the retarget (0x004601E8), the horizontal law (0x0046032C,
  // with the cage 0x004604BC and the speed cap), then pos += vel.
  private spitChase(d: Darvant, pre: number): void {
    if ((pre & 0x7f) === 0) {
      if (d.target < 0) {
        const p = this.nearestAlive(d.x, d.z, DARVANT.spitSearch);
        d.target = p ? p.clientId : -1;
      } else {
        d.target = -1;
        if (this.form1) {
          const a = Math.trunc(this.rand() * 65536);
          d.aimX = this.form1.x + DARVANT.wander * sinB(a);
          d.aimZ = this.form1.z + DARVANT.wander * cosB(a);
        }
      }
    }
    // The target's position (0x0046032C; ASSUMED: the alive list stands in for the player entity).
    if (d.target >= 0) {
      const p = this.playerPos(d.target);
      if (p) {
        d.aimX = p.x;
        d.aimZ = p.z;
      }
    }
    // The aim: the aim point plus 16 about the circle of the +0x1C word's low three bits (45 degrees each).
    const ang = ((this.entityId + d.entity) & 7) << 13;
    const ax = d.aimX + DARVANT.aimRing * sinB(ang);
    const az = d.aimZ + DARVANT.aimRing * cosB(ang);
    const acc = DARVANT.spitAccel;
    if (ax <= d.x) d.vx -= acc;
    else d.vx += acc;
    if (az <= d.z) d.vz -= acc;
    else d.vz += acc;
    d.vy = 0;
    this.cageSpit(d);
    const s = Math.hypot(d.vx, d.vz);
    if (s > d.cap) {
      // The speed above the cap is taken off by acc a frame (the unit vector times |v| - acc).
      const k = s - acc;
      d.vx = (d.vx / s) * k;
      d.vz = (d.vz / s) * k;
      d.scale = k;
    } else d.scale = s;
    d.x += d.vx;
    d.y += d.vy;
    d.z += d.vz;
  }

  // The cage (0x004604BC): the spat is kept on or outside the circle of 100 about form 1 (xz).
  private cageSpit(d: Darvant): void {
    const f = this.form1;
    if (!f) return;
    const dx = d.x - f.x;
    const dz = d.z - f.z;
    const l = Math.hypot(dx, dz);
    if (!(l < DARVANT.cageRadius)) return;
    let ux = 1;
    let uz = 0;
    if (l > DARVANT.cageMin) {
      ux = dx / l;
      uz = dz / l;
    }
    d.x = f.x + ux * DARVANT.cageRadius;
    d.z = f.z + uz * DARVANT.cageRadius;
  }

  // The beam's rise (state 0, 0x00460B84): 10/9 a frame to the top 6, then the flight (state 2).
  private beamRise(d: Darvant): void {
    if (DARVANT.beamTop <= d.y) return;
    const up = d.y + DARVANT.beamRise;
    if (up <= DARVANT.beamTop) {
      d.y = up;
      return;
    }
    d.y = DARVANT.beamTop;
    d.st = DARVANT.chase;
  }

  // The beam's flight (state 2, 0x00460C10): pos += vel; the timer counts down, and the beam dies
  // when it is below 0 or 260 out from the centre (xz).
  private beamFlight(d: Darvant): void {
    d.x += d.vx;
    d.y += d.vy;
    d.z += d.vz;
    d.timer--;
    if (d.timer < 0 || Math.hypot(d.x, d.z) > DARVANT.beamReach) this.killDarvant(d);
  }

  // The bob of state 2 (the dispatchers): y += 0.1 * sin(phase), then phase += step.
  private bob(d: Darvant): void {
    d.y += DARVANT.bobAmp * sinB(d.bobAngle);
    d.bobAngle = (d.bobAngle + d.bobStep) & 0xffff;
  }

  // The spat's and beam's aura (the dispatchers, state 2): the cadence is the power of two at or
  // above trunc(8 / speed) minus 1 (16 when the speed is 0.5 or less); the hit is the nearest player
  // within 8. The Darvant is not removed by it (ASSUMED for the hit's callee, the player's +0x60).
  private auraSpitBeam(d: Darvant, pre: number): void {
    const reach = DARVANT.auraSpitBeamReach;
    const n = d.scale > reach / 16 ? Math.trunc(reach / d.scale) : 16;
    let m = 1;
    while (m < n) m *= 2;
    if ((pre & (m - 1)) !== 0) return;
    const p = this.nearestAlive(d.x, d.z, reach);
    if (!p) return;
    const row = d.kind === 'spit' ? this.rows.darvantFalz : this.rows.darvant;
    this.events.push({ kind: 'hit', clientId: p.clientId, power: row.atp, fixed: false, x: d.x, z: d.z, what: 'Darvant' });
  }

  // Accelerate toward a point a little each frame and cap the speed.
  private drift(d: Darvant, tx: number, tz: number, cap: number): void {
    d.vx += (tx > d.x ? 1 : -1) * DARVANT.accel;
    d.vz += (tz > d.z ? 1 : -1) * DARVANT.accel;
    const l = Math.hypot(d.vx, d.vz);
    const max = Math.max(0.05, Math.min(cap, d.speed));
    if (l > max) {
      d.vx = (d.vx / l) * max;
      d.vz = (d.vz / l) * max;
    }
    d.x += d.vx;
    d.z += d.vz;
  }

  // --- hits on the fight's entities ---------------------------------------------------

  // The entity at the offset from the control's id (null: none there).
  part(entity: number): DfEntity | null {
    if (entity === DF_ID.form1) return this.form1;
    if (entity === DF_ID.form2) return this.form2;
    if (entity === DF_ID.form3) return this.form3;
    return this.byId.get(entity) ?? null;
  }

  // A strike (ours or a 6x0A copy). Returns the damage taken.
  damagePart(entity: number, amount: number, byLocal: boolean): number {
    const e = this.part(entity);
    return e ? e.damage(amount, byLocal) : 0;
  }

  damageTaken(entity: number, total: number): void {
    this.part(entity)?.setDamageTaken(total);
  }

  // The point a strike from (px, pz) reaches on an entity.
  reachOf(entity: number, px: number, pz: number, out: Vec3): boolean {
    if (entity === DF_ID.form1 && this.form1) {
      this.form1.reach(px, pz, out);
      return true;
    }
    if (entity === DF_ID.form2 && this.form2) {
      this.form2.reach(out);
      return true;
    }
    if (entity === DF_ID.form3 && this.form3) {
      this.form3.reach(out);
      return true;
    }
    const d = this.byId.get(entity);
    if (d && !d.gone) {
      out[0] = d.x;
      out[1] = d.y;
      out[2] = d.z;
      return true;
    }
    return false;
  }

  // Where the ring of 16 slots of the second arena puts the local player.
  get ringSlots(): number {
    return this.players;
  }

  // Free every pool (the floor was left).
  override kill(): void {
    this.finished = true;
  }
}

// The brain of the invisible enemy render/combat.ts keeps for a hit target (so
// the player's strikes, the lock-on and the other clients' 6x0A find it by
// entity id). The control owns everything; this answers the owner's questions.
export class DarkFalzPartAi {
  state = 'part';
  readonly motion = null;
  readonly superArmor = true;
  readonly entity: number;
  readonly owner: DarkFalzAi;
  private readonly frame: AiFrame = { motion: null, x: 0, z: 0, angle: 0, hit: null };
  constructor(entity: number, owner: DarkFalzAi) {
    this.entity = entity;
    this.owner = owner;
  }
  get part(): DfEntity | null {
    return this.owner.part(this.entity);
  }
  get untargetable(): boolean {
    const p = this.part;
    return !p || !p.targetable;
  }
  get invulnerable(): boolean {
    return this.untargetable;
  }
  get warps(): number {
    return this.part?.warps ?? 0;
  }
  tick(): AiFrame {
    const p = this.part;
    if (p) {
      this.frame.x = p.x;
      this.frame.z = p.z;
    }
    return this.frame;
  }
  onDamage(): void {}
  resume(): string {
    return this.state;
  }
  kill(): void {}
}

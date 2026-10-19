// De Rol Le, the Episode 1 Caves boss (PsoBB.exe, Ephinea 1.25.13, addresses
// are VAs). One EnemyBrain drives the body along its path and owns the
// objects the fight spawns: the 4 tentacles, the rocks thrown from the shell
// segments, the ceiling rocks, the 5 + 3 stings (spore mines) and the beam.
// render/combat.ts places the body and the child parts, and applies the hits
// the brain hands it as EnemyShots.
//
// Sources (docs/adr/0001-client-reference-sources.md): the Ephinea Ghidra dump
// for the FSM. psobb-client-source (JP) has C for three of the functions used
// here, and they agree with the dump: FUN_00434b30.c = Ephinea
// DerolleInitializeAttackState_00434a2c (the sequence cursor +0x3dc starts at
// 0), FUN_00439c54.c = 0x00439b2c (tentacle state 2 entry: +0x11c =
// table[i], +0x120 = 0x4000) and FUN_00439c94.c = 0x00439b6c (state 0 entry:
// +0x11c = +0x120 = 0). Its other "De Rol Le" files are getters / thunks of
// other objects. Tables were read with tools/exedata.py.
//
// The body (ctor 0x0042ad4c) is a dispatcher on +0x32e (0x00433cc0, jump
// table 0x008fcb00) whose handlers take a phase: 4 enter, 0 the frame, 9 pick
// the next state when this one is done (leader only), 8 a leader check, 6
// right after a state is set (the target pick), 5 leave. UpdateDerolle
// (0x00432b4c) runs, on the leader: the death check (DerolleIsActionReady:
// body pool < 1 and flag 4 clear -> DerolleSelectNextAttackState), else
// phase 9; then phase 8 and phase 0. A follower (+0x3fc == 1) only runs
// phase 0 and takes its states from the leader's 6x13 / 6x14
// (start_drl_rock_cycle 0x0042ac2c, SetDerolleActionState /
// ProcessEntityById_00432a74).

import { BAMS_TO_RAD, type AiFrame, type AiTarget } from './enemyai.ts';
import type { EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase } from './enemyfsm.ts';
import { EnemyShot, type ShotEffect, type ShotLook } from './enemyshots.ts';
import { DE_ROL_LE_STING_POINTS, deRolLeStingRingTarget } from '../formats/enemymodels.ts';

export type Vec3 = [number, number, number];
const BAMS = BAMS_TO_RAD;
const TWO_PI = Math.PI * 2;

// --- tables -----------------------------------------------------------------

// Motion slots (table 0x009a45c0, speeds patched at run time by
// InitializeDerolleGlobals_004341bc). mode 1 loops, 2 plays once and goes on
// to `next`, 3 plays once and holds. Motions are BML entries of
// bm_boss2_de_rol_le.bml (0 beam02 .. 16 scatter, 17 tloop).
export interface DrlSlot {
  readonly motion: number;
  readonly mode: 1 | 2 | 3;
  readonly next: number;
  readonly speed: number;
}
const slot = (motion: number, mode: 1 | 2 | 3, next: number, speed: number): DrlSlot => ({ motion, mode, next, speed });
export const DRL_SLOTS: readonly DrlSlot[] = [
  slot(8, 3, 0, 0.8), // 0 enter
  slot(11, 1, 0, 0.6), // 1 forward
  slot(9, 1, 0, 1.0), // 2 fd02
  slot(0, 3, 0, 0.4), // 3 beam02
  slot(10, 2, 1, 0.3), // 4 fjump
  slot(14, 2, 1, 0.5), // 5 rljump
  slot(12, 2, 1, 0.5), // 6 lrjump
  slot(15, 2, 9, 0.28), // 7 r_bite
  slot(13, 2, 10, 0.28), // 8 l_bite
  slot(6, 1, 0, 2), // 9 bite_rloop
  slot(5, 1, 0, 2), // 10 bite_lloop
  slot(16, 3, 0, 0.6), // 11 scatter
  slot(2, 2, 15, 0.4), // 12 beam_a
  slot(3, 3, 0, 0.3), // 13 beam_b
  slot(4, 2, 1, 0.4), // 14 beam_c
  slot(1, 1, 0, 0.5), // 15 beamwait
  slot(7, 3, 0, 0.7), // 16 die
];
// The tentacle model's own loop (tloop), played by the tentacle parts.
export const DRL_TENTACLE_MOTION = 17;

// Path corners (bss 0x00a43ba8, 12 bytes each, written by 0x004341bc):
// DerolleSetTargetPosition_0042c154 puts the body on one of them.
export const DRL_CORNERS: readonly (readonly [number, number, number])[] = [
  [-175, 7, 25],
  [0, 7, 500],
  [175, 7, 25],
  [0, 7, -250], // the spawn corner (g_DerolleSpawnPos)
];

// The attack sequences: 0x009a4380 (normal) and 0x009a4440 (Ultimate),
// indexed by the cursor +0x3dc, which is pre-incremented on every pick.
// Values below 0x21 are states; 0x21..0x2b pick a variant (drlVariant);
// 0x2c sends the cursor back to 5 (so the loop restarts at entry 6).
export const DRL_SEQUENCE_NORMAL: readonly number[] = [
  1, 3, 24, 6, 17, 9, 12, 18, 20, 22, 3, 6, 17, 9, 13, 25, 8, 16, 4, 19, 21, 23, 9, 15, 33, 34, 26, 27, 27, 27, 27, 28, 35, 36, 37, 33, 34, 26,
  27, 27, 27, 27, 29, 44,
];
export const DRL_SEQUENCE_ULTIMATE: readonly number[] = [
  1, 40, 41, 42, 43, 34, 13, 37, 33, 40, 39, 41, 42, 43, 39, 34, 15, 33, 40, 39, 40, 39, 40, 34, 26, 27, 27, 27, 27, 27, 28, 13, 37, 33, 40, 41,
  42, 43, 40, 34, 26, 27, 27, 27, 27, 27, 27, 27, 29, 44,
];
const SEQ_LOOP = 0x2c;
const SEQ_RESTART = 5;

// The body's states (+0x32e) and their handlers in the jump table.
export const DRL_STATE = {
  idle: 0x00, // 0x004347b4 (debug idle)
  enter: 0x01, // ProcessDerolleCeilingRockAttack (the entrance)
  // Corner moves (0x0042b94c, from -> to): 3 0->1, 5 0->3, 6 1->2, 8 1->0,
  // 9 2->3, 0xb 2->1, 0xc 3->0, 0xe 3->2.
  sideJump02: 0x04, // 0x0042c194 (0 -> 2), 0x0a the other way
  sideJump20: 0x0a,
  bigJump: 0x0d, // 0x00431058, corner 3 -> 1
  dive: 0x0f, // 0x00430a90, dive and run along the ceiling dropping rocks
  rocks0: 0x10, // 0x0042ce8c, the segments throw rocks (corner 0 / 2)
  rocks2: 0x11,
  bite0: 0x12, // 0x0042d304, the bite leap to the wall
  bite2: 0x13,
  wall0: 0x14, // 0x0042dd68, hold the wall, the tentacles reach
  wall2: 0x15,
  sink0: 0x16, // 0x0042e348, dive and resurface at the same corner
  sink2: 0x17,
  stings: 0x18, // 0x0042e824, the 5 floor stings
  ringStings: 0x19, // the 3 stings around a player
  beamCharge: 0x1a,
  beam: 0x1b,
  recover: 0x1c, // 0x0042ebf0, after the beams
  recover2: 0x1d,
  sinkDeath: 0x1e, // the body pool ran out
  death: 0x1f,
  remove: 0x20,
} as const;
export type DrlStateId = number;

const MOVES: Readonly<Record<number, readonly [number, number]>> = {
  0x03: [0, 1],
  0x05: [0, 3],
  0x06: [1, 2],
  0x08: [1, 0],
  0x09: [2, 3],
  0x0b: [2, 1],
  0x0c: [3, 0],
  0x0e: [3, 2],
};

// The variant of a sequence entry 0x21..0x2b. `lane` is +0x660 (the corner
// the last move went to), `roll` a get_random_float_range_neg_one_to_one
// value compared with 0.0 (0x008fcd9c and the handlers' copies): 50 / 50.
export function drlVariant(value: number, lane: number, roll: number): number | null {
  const left = lane === 0;
  switch (value) {
    case 0x21:
      return roll <= 0 ? 0x06 : 0x08;
    case 0x22:
      return left ? 0x05 : 0x09;
    case 0x23:
      return roll <= 0 ? 0x0e : 0x0c;
    case 0x24:
      return left ? 0x03 : 0x0b;
    case 0x25:
      return roll <= 0 ? 0x19 : 0x18;
    case 0x27:
      return left ? 0x04 : 0x0a;
    case 0x28:
      return left ? 0x10 : 0x11;
    case 0x29:
      return left ? 0x12 : 0x13;
    case 0x2a:
      return left ? 0x14 : 0x15;
    case 0x2b:
      return left ? 0x16 : 0x17;
    case SEQ_LOOP:
      return null;
    default:
      return value;
  }
}

// One pick: the cursor moves on (0x2c restarts it) and the entry resolves.
export function drlNextState(cursor: number, ultimate: boolean, lane: number, roll: () => number): { cursor: number; state: number } {
  const table = ultimate ? DRL_SEQUENCE_ULTIMATE : DRL_SEQUENCE_NORMAL;
  let c = cursor;
  for (let guard = 0; guard < table.length * 2; guard++) {
    c++;
    const s = drlVariant(table[c] ?? SEQ_LOOP, lane, table[c] === 0x21 || table[c] === 0x23 || table[c] === 0x25 ? roll() : 0);
    if (s !== null) return { cursor: c, state: s };
    c = SEQ_RESTART;
  }
  return { cursor: SEQ_RESTART, state: 0x03 };
}

// --- the easing record (+0x66c for x, +0x68c for z) ---------------------------
//
// [state, accel, decel, max, v, dist, pos, brake]; init 0x00434ac4 /
// 0x00434afc, brake point NormalizeMovementTarget_00434a3c, tick
// Player__ApplyVelocityEasing_0042c9a0 (returns the state; 3 = arrived).
export class DrlEasing {
  state = 0;
  pos = 0;
  accel: number;
  decel: number;
  max: number;
  dist: number;
  v: number;
  brake: number;
  constructor(accel: number, decel: number, max: number, dist: number, v = 0) {
    this.accel = accel;
    this.decel = decel;
    this.max = max;
    this.dist = dist;
    this.v = v;
    this.brake = this.brakePoint();
  }

  private brakePoint(): number {
    const k = 1 / this.accel + 1 / this.decel;
    const t = (this.v * this.v) / (2 * this.decel) + this.dist;
    if (0.5 * this.v * this.v * k > t) this.max = Math.sqrt((2 * t) / k);
    return this.dist - (this.max * this.max) / (2 * this.decel);
  }

  tick(): number {
    if (this.state === 0) {
      this.v += this.accel;
      if (this.v > this.max) {
        this.v = this.max;
        this.state = 1;
      }
    } else if (this.state === 1) {
      if (this.pos > this.brake) {
        this.v -= this.decel;
        this.state = 2;
      }
    } else if (this.state === 2) {
      this.v -= this.decel;
      if (this.v < 0) {
        this.v = 0;
        this.state = 3;
      }
    }
    this.pos = Math.min(this.pos + this.v, this.dist);
    return this.state;
  }
}

// --- children: shots --------------------------------------------------------

// Shots of this fight carry absolute heights (the body swims at its own y).
abstract class DrlShot extends EnemyShot {
  readonly absolute = true;
}

// One area hit on the frame it is made (the beam end, a sting's blast, a
// tentacle's grab): 0x0051fc9c's {group, power, radius, ...} context.
export class DrlBurst extends DrlShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook;
  readonly radius: number;
  // Only these players (the beam's once-per-beam list, +0x6d0); null: all.
  private only: readonly number[] | null;
  constructor(x: number, y: number, z: number, radius: number, effect: ShotEffect, look: ShotLook, only: readonly number[] | null = null) {
    super(x, y, z);
    this.radius = radius;
    this.effect = effect;
    this.look = look;
    this.only = only;
  }
  // Who is inside, without using the burst up.
  peek(targets: readonly AiTarget[]): AiTarget[] {
    return this.within(targets, this.radius).filter((t) => !this.only || this.only.includes(t.clientId));
  }
  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.done = true;
    return this.peek(targets);
  }
}

// Segment rock types (0x008fd678): count, interval, spread (BAMS), speed.
export const DRL_ROCK_TYPES: readonly { count: number; interval: number; spread: number; speed: number }[] = [
  { count: 3, interval: 1, spread: 0x3000, speed: 3.5 },
  { count: 5, interval: 1, spread: 0x2000, speed: 5.0 },
  { count: 5, interval: 1, spread: 0x4000, speed: 5.0 },
];
// The rock (0x00437810, update 0x004378d0): falls to 8.7, rolls along the
// floor, hit box 3.0, 120 ticks, only tests hits while -75 <= x <= 76;
// entity_hit_by_tech group 0 with MovementData[15].fparam2.
export const DRL_ROCK = { floor: 8.7, airSpeed: 2.0, gravity: 0.05, maxFall: 3.0, radius: 3, life: 120, minX: -75, maxX: 76 } as const;

export class DrlSegmentRock extends DrlShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0x8a7a60, size: 3 };
  private vy = 0;
  private dx: number;
  private dz: number;
  private speed: number;
  constructor(x: number, y: number, z: number, dx: number, dz: number, speed: number, power: number) {
    super(x, y, z);
    this.dx = dx;
    this.dz = dz;
    this.speed = speed;
    this.effect = { kind: 'tech', power: Math.max(0, power) };
  }
  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    if (this.y > DRL_ROCK.floor) {
      this.vy = Math.min(this.vy + DRL_ROCK.gravity, DRL_ROCK.maxFall);
      this.y = Math.max(DRL_ROCK.floor, this.y - this.vy);
      this.x += this.dx * DRL_ROCK.airSpeed;
      this.z += this.dz * DRL_ROCK.airSpeed;
    } else {
      this.y = DRL_ROCK.floor;
      this.x += this.dx * this.speed;
      this.z += this.dz * this.speed;
    }
    if (this.frames >= DRL_ROCK.life) this.done = true;
    if (this.x < DRL_ROCK.minX || this.x > DRL_ROCK.maxX) return [];
    const hit = this.within(targets, DRL_ROCK.radius);
    if (hit.length) {
      this.done = true;
      return hit.slice(0, 1);
    }
    return [];
  }
}

// The emitter one segment makes (0x00437604, update 0x004376d8): starts
// turned by -spread / 2, fires every `interval` ticks and turns by
// spread / count.
export class DrlRockEmitter {
  private fired = 0;
  private timer = 0;
  private angle: number; // BAMS around the start direction
  done = false;
  private origin: Vec3;
  private dir: number; // BAMS heading
  private type: number;
  private power: number;
  constructor(origin: Vec3, dir: number, type: number, power: number) {
    this.origin = origin;
    this.dir = dir;
    this.type = type;
    this.power = power;
    this.angle = -DRL_ROCK_TYPES[type].spread / 2;
  }
  tick(): DrlSegmentRock[] {
    const t = DRL_ROCK_TYPES[this.type];
    const out: DrlSegmentRock[] = [];
    if (this.done) return out;
    if (++this.timer >= t.interval) {
      this.timer = 0;
      const a = (this.dir + this.angle) * BAMS;
      // ASSUMED: the "speed x 1.5" the emitter passes is the rolling speed.
      out.push(new DrlSegmentRock(this.origin[0], this.origin[1], this.origin[2], Math.sin(a), Math.cos(a), t.speed * 1.5, this.power));
      this.angle += t.spread / t.count;
      if (++this.fired >= t.count) this.done = true;
    }
    return out;
  }
}

// Ceiling rocks (ctor 0x00439c6c, update 0x00439e10): kind k = round(rand *
// 6); offY / radius per kind (0x00a44240); gravity 0.3 down to -10; with
// ground under them they land on it (state 2, a hit check on the way down),
// without they fall into the water (state 0 -> 1). A hit is try_hit_entity
// (body, 1.0) with the normal attack (handle_derolle_hit_player_with_rocks).
export const DRL_CEILING_ROCK = {
  offY: [10, 10, 7, 3, 10, 6],
  radius: [15, 15, 10.5, 15, 0.45, 1.2],
  gravity: 0.3,
  maxFall: -10,
  water: -10,
  sinkSpeed: 3,
  gone: -50,
  testAbove: 30,
  reach: 10,
  bounce: -0.5,
  roll: 2,
  fadeAfter: 10,
  fade: 0.04,
} as const;
// ASSUMED: a player's height (player +0xe3c) for the rocks' top test.
export const DRL_PLAYER_HEIGHT = 17;

export class DrlCeilingRock extends DrlShot {
  readonly effect: ShotEffect = { kind: 'melee', mult: 1.0, knockback: 0 };
  readonly look: ShotLook;
  private vy = 0;
  private vx = 0;
  private vz = 0;
  private phase: 0 | 1 | 2 | 3;
  private groundTop: number;
  private ground: number;
  private heading: number;
  private t3 = 0;
  alpha = 1;
  readonly kind: number;
  constructor(x: number, y: number, z: number, ground: number | null, rng: () => number) {
    super(x, y, z);
    this.kind = Math.min(5, Math.round(rng() * 6));
    this.heading = rng() * TWO_PI;
    this.ground = ground ?? -Infinity;
    this.groundTop = ground === null ? -Infinity : ground + DRL_CEILING_ROCK.offY[this.kind];
    this.phase = ground === null ? 0 : 2;
    this.look = { color: 0x6a6050, size: Math.max(1.5, DRL_CEILING_ROCK.radius[this.kind] * 0.4) };
  }
  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    const C = DRL_CEILING_ROCK;
    this.vy = Math.max(this.vy - C.gravity, C.maxFall);
    if (this.phase === 0) {
      this.y += this.vy;
      if (this.y <= C.water) this.phase = 1;
      return [];
    }
    if (this.phase === 1) {
      this.y -= C.sinkSpeed;
      if (this.y < C.gone) this.done = true;
      return [];
    }
    if (this.phase === 3) {
      this.x += this.vx;
      this.y += this.vy;
      this.z += this.vz;
      if (++this.t3 > C.fadeAfter) this.alpha -= C.fade;
      if (this.alpha <= 0) this.done = true;
      return [];
    }
    const y0 = this.y;
    const y1 = y0 + this.vy;
    let hits: AiTarget[] = [];
    if (y0 - this.groundTop < C.testAbove) {
      // The player's top (ASSUMED: feet on the ground under the rock).
      const top = this.ground + DRL_PLAYER_HEIGHT;
      if (y0 > top && y1 - C.offY[this.kind] < top) hits = this.within(targets, C.reach + C.radius[this.kind]);
    }
    this.y = y1;
    if (this.y <= this.groundTop || hits.length) {
      this.y = Math.max(this.y, this.groundTop);
      this.vy *= C.bounce;
      this.vx = Math.sin(this.heading) * C.roll;
      this.vz = Math.cos(this.heading) * C.roll;
      this.phase = 3;
    }
    return hits;
  }
}

// --- children: stings (spore mines) -------------------------------------------
//
// Kind 0 (ctor 0x004369bc, launch SetDerollePositionAndHp_00436a50) lob to a
// floor point; kind 1 (0x004370b4, launch DerolleInitializeSpawn_00437190)
// home on a player and shadow it. Both arm (SE 0x32b), blink faster as their
// timer runs out (0x004367e8 / 0x00436840) and blow up (0x00435f68): after 30
// ticks an area hit of radius 50 (0x009a48bc, patched by 0x004372d0),
// entity_hit_by_tech group 1 with MovementData[15].fparam3, SE 0x32c.
export const DRL_STING = {
  lobSpeed: 10,
  lobGravity: 0.2,
  homeSpeed: 8,
  homeMin: 3,
  homeDecel: 0.2,
  turnStep: 0.05,
  turnMax: 3,
  arrive: 4.5,
  follow: 0.75,
  followMax: 4,
  snap: 0.2,
  armBase: 180,
  armRandom: 30,
  shadowBase: 240,
  shadowRandom: 60,
  fuse: 30,
  blast: 50,
  ringRadius: 20,
  ringUp: 17,
} as const;

export type DrlStingPhase = 'parked' | 'lob' | 'home' | 'armed' | 'shadow' | 'explode';

export class DrlSting {
  phase: DrlStingPhase = 'parked';
  x = 0;
  y = 0;
  z = 0;
  yaw = 0; // BAMS
  pitch = 0; // BAMS
  roll = 0; // BAMS
  blink = false;
  private to: Vec3 = [0, 0, 0];
  private dx = 0;
  private dy = 0;
  private dz = 0;
  private vy = 0;
  private speed = 0;
  private turn = 0;
  private remaining = 0;
  private fall = 0;
  private timer = 0;
  private blinkClock = 0;
  private targetId: number | null = null;

  readonly kind: 0 | 1;
  readonly index: number;
  constructor(kind: 0 | 1, index: number) {
    this.kind = kind;
    this.index = index;
  }

  get visible(): boolean {
    return this.phase !== 'parked';
  }

  // Kind 0: from the launch point to the floor point (y + 1.0 already in `to`).
  lob(from: Vec3, to: Vec3): void {
    [this.x, this.y, this.z] = from;
    this.to = to;
    const ddx = to[0] - from[0];
    const ddz = to[2] - from[2];
    const len = Math.hypot(ddx, ddz) || 1;
    this.dx = ddx / len;
    this.dz = ddz / len;
    this.remaining = len;
    this.fall = Math.sqrt(Math.max(0, (2 * (from[1] - to[1])) / DRL_STING.lobGravity)) * DRL_STING.lobSpeed;
    this.vy = 0;
    this.pitch = 0x4000;
    this.phase = 'lob';
  }

  // Kind 1: from the launch point toward the ring point around a player.
  home(from: Vec3, targetId: number): void {
    [this.x, this.y, this.z] = from;
    this.targetId = targetId;
    this.yaw = deRolLeStingRingTarget(this.index, [0, 0, 0]).yaw ?? 0x8000;
    // ASSUMED: it leaves upward (the exe's start vector was not traced).
    this.dx = 0;
    this.dy = 1;
    this.dz = 0;
    this.speed = DRL_STING.homeSpeed;
    this.turn = 0;
    this.pitch = 0x4000;
    this.phase = 'home';
  }

  park(): void {
    this.phase = 'parked';
    this.blink = false;
  }

  private ring(targets: readonly AiTarget[], groundAt: (x: number, z: number) => number): Vec3 | null {
    const t = targets.find((p) => p.clientId === this.targetId && !p.dead);
    if (!t) return null;
    return deRolLeStingRingTarget(this.index, [t.x, groundAt(t.x, t.z), t.z]).target;
  }

  // The blink cadence (0x00436840): faster as the timer runs out.
  private tickBlink(): void {
    const period = this.timer < 90 ? 3 : this.timer < 150 ? 5 : this.timer < 300 ? 10 : 30;
    if (++this.blinkClock >= period) {
      this.blinkClock = 0;
      this.blink = !this.blink;
    }
  }

  tick(targets: readonly AiTarget[], power: number, groundAt: (x: number, z: number) => number, rng: () => number): DrlBurst | null {
    const S = DRL_STING;
    switch (this.phase) {
      case 'parked':
        return null;
      case 'lob':
        this.x += this.dx * S.lobSpeed;
        this.z += this.dz * S.lobSpeed;
        this.remaining -= S.lobSpeed;
        if (this.remaining < this.fall) {
          this.vy -= S.lobGravity;
          this.y += this.vy;
          this.pitch = Math.min(0x8000, Math.max(this.pitch, 0x4300) + 0x300);
        }
        if (this.y < this.to[1] || this.remaining < -this.fall) {
          [this.x, this.y, this.z] = this.to;
          this.timer = Math.trunc(rng() * S.armRandom) + S.armBase;
          this.phase = 'armed';
        }
        return null;
      case 'home': {
        const goal = this.ring(targets, groundAt);
        if (!goal) {
          this.timer = 0;
          this.phase = 'explode';
          return null;
        }
        this.roll = (this.roll + 2560) & 0xffff;
        this.pitch = Math.max(0, this.pitch - 0x600);
        this.speed = Math.max(this.speed - S.homeDecel, S.homeMin);
        this.turn = Math.min(this.turn + S.turnStep, S.turnMax);
        const gx = goal[0] - this.x;
        const gy = goal[1] - this.y;
        const gz = goal[2] - this.z;
        const gl = Math.hypot(gx, gy, gz) || 1;
        let nx = this.dx + (gx / gl) * (this.turn / this.speed);
        let ny = this.dy + (gy / gl) * (this.turn / this.speed);
        let nz = this.dz + (gz / gl) * (this.turn / this.speed);
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        this.dx = nx;
        this.dy = ny;
        this.dz = nz;
        this.x += nx * this.speed;
        this.y += ny * this.speed;
        this.z += nz * this.speed;
        if (Math.hypot(goal[0] - this.x, goal[1] - this.y, goal[2] - this.z) < S.arrive) {
          this.timer = Math.trunc(rng() * S.shadowRandom) + S.shadowBase;
          this.phase = 'shadow';
        }
        return null;
      }
      case 'armed':
      case 'shadow': {
        if (this.phase === 'shadow') {
          const goal = this.ring(targets, groundAt);
          if (goal) {
            this.y = goal[1];
            const d = Math.hypot(goal[0] - this.x, goal[2] - this.z);
            if (d < S.snap) {
              this.x = goal[0];
              this.z = goal[2];
            } else {
              const step = Math.min(d * S.follow, S.followMax);
              this.x += ((goal[0] - this.x) / d) * step;
              this.z += ((goal[2] - this.z) / d) * step;
            }
          }
        }
        this.tickBlink();
        if (--this.timer <= 0) {
          this.timer = 0;
          this.phase = 'explode';
        }
        return null;
      }
      case 'explode':
        this.blink = true;
        if (++this.timer > S.fuse) {
          this.park();
          return new DrlBurst(this.x, this.y, this.z, S.blast, { kind: 'tech', power: Math.max(0, power) }, { color: 0xff8040, size: 6 });
        }
        return null;
    }
  }
}

// --- children: tentacles -----------------------------------------------------
//
// The 4 objects the ctor makes with DerolleRockProjectile_Constructor
// _00437ba4 (the dump's name; they are the tentacles, model 4 cloned by
// DerolleInitializeParameters_00439444), each on an attach matrix the body's
// draw writes (+0x624 + i * 0x40). State +0x20:
//   0 sway (enter 0x00439b6c): yaw = +-round(K * (1 + sin(phase))),
//     phase += 0x5ef a tick;
//   1 raise (0x00439b50, 0x004393a8 when the bite leap lands): pitch +0x120
//     -> 0x4000 at 0x280 a tick;
//   2 aim (0x00439b2c, DerolleSetStateAndTarget_004393b0): yaw -> 0 at 0x80;
//   3 reach (0x00439890): the length grows 8.0 a tick to the target's xz
//     distance; the grab (DerolleInitializeStats_00434108) is try_hit with
//     mult 1.0 and attack row 15 around the target point (radius 8.0,
//     0x009a4738), SE 0x32e; held `frames`, then back 8.0 a tick under 20;
//   4 home (0x00439878): yaw -> 0x008fd70c[i] at 0x80 a tick;
//   5 lower: +0x120 -> 0 at 0x280, then 0.
export const DRL_TENTACLE = {
  swayStep: 0x5ef,
  // ASSUMED: K comes from the model asset at run time; this amplitude is a guess.
  swayAmp: 0x400,
  raise: 0x280,
  aim: 0x80,
  reachStep: 8,
  rest: 20,
  grabRadius: 8,
  pitch: [4096, -4096, 6144, -6144],
  home: [-2048, 2048, -4864, 4864], // 0x008fd70c = JP PTR_DAT_008fb6ec
  pitchStep: 0x100,
} as const;

export class DrlTentacle {
  state: 0 | 1 | 2 | 3 | 4 | 5 = 0;
  yaw = 0; // BAMS, relative to the attach matrix
  pitch = 0; // BAMS
  lift = 0; // +0x120, BAMS
  length: number = DRL_TENTACLE.rest;
  target: Vec3 | null = null;
  private phase = 0;
  private hold = 0;
  private grabbed = false;
  private retracting = false;

  readonly index: number;
  constructor(index: number) {
    this.index = index;
  }

  raise(): void {
    if (this.state === 0) this.state = 1;
  }

  // DerolleSetStateAndTarget_004393b0: frames outside 1..599 become 120.
  send(target: Vec3, frames: number): void {
    this.target = target;
    this.hold = frames >= 1 && frames <= 599 ? frames : 120;
    this.grabbed = false;
    this.retracting = false;
    this.state = 2;
  }

  lower(): void {
    this.state = 5;
  }

  reset(): void {
    this.state = 0;
    this.lift = 0;
    this.length = DRL_TENTACLE.rest;
    this.target = null;
  }

  // One tick; `attach` is where the tentacle hangs. Returns a grab when the
  // reach got there this tick.
  tick(attach: Vec3): Vec3 | null {
    const T = DRL_TENTACLE;
    const toward = (v: number, goal: number, step: number) => (Math.abs(goal - v) <= step ? goal : v + Math.sign(goal - v) * step);
    switch (this.state) {
      case 0:
        this.phase = (this.phase + T.swayStep) & 0xffff;
        this.yaw = (this.index & 1 ? -1 : 1) * Math.round(T.swayAmp * (1 + Math.sin(this.phase * BAMS)));
        return null;
      case 1:
        this.lift = toward(this.lift, 0x4000, T.raise);
        return null;
      case 2:
        this.yaw = toward(this.yaw, 0, T.aim);
        if (this.yaw === 0) this.state = 3;
        return null;
      case 3: {
        const t = this.target;
        if (!t) {
          this.state = 4;
          return null;
        }
        this.yaw = Math.round(Math.atan2(t[0] - attach[0], t[2] - attach[2]) / BAMS + 0x8000) & 0xffff;
        this.pitch = toward(this.pitch, T.pitch[this.index] ?? 0, T.pitchStep);
        const reach = Math.hypot(t[0] - attach[0], t[2] - attach[2]);
        if (this.retracting) {
          this.length -= T.reachStep;
          if (this.length < T.rest) {
            this.length = T.rest;
            this.state = 4;
          }
          return null;
        }
        if (!this.grabbed) {
          this.length = Math.min(this.length + T.reachStep, reach);
          if (this.length >= reach) {
            this.grabbed = true;
            return t;
          }
          return null;
        }
        if (--this.hold <= 0) this.retracting = true;
        return null;
      }
      case 4: {
        const home = T.home[this.index] ?? 0;
        const y = ((this.yaw + 0x8000) & 0xffff) - 0x8000;
        this.yaw = toward(y, home, T.aim);
        return null;
      }
      case 5:
        this.lift = toward(this.lift, 0, T.raise);
        if (this.lift === 0) this.reset();
        return null;
    }
  }
}

// --- the body -----------------------------------------------------------------

export type DrlEvent =
  // The leader set a state: 6x13 (or 6x14 with the target for 0x14, 0x15,
  // 0x19 and 0x1b), start_drl_rock_cycle 0x0042ac2c.
  | { kind: 'state'; state: number; cursor: number; target: number | null; withTarget: boolean }
  | { kind: 'se'; id: number }
  | { kind: 'shellBroken' }
  | { kind: 'bgm'; name: string } // 0x1f at frame 27: deldeath.adx (0x008fd420)
  | { kind: 'killed'; x: number; y: number; z: number } // 0x1f phase 5
  | { kind: 'remove' }; // 0x20

export interface DeRolLeOptions {
  x: number;
  z: number;
  angle: number;
  ultimate: boolean;
  // MovementData[15] (g_DerolleBattleparamsAnimationSpeeds): fparam1 beam,
  // fparam2 rock, fparam3 sting powers, fparam4 / fparam5 the ceiling rocks'
  // spread / chance, iparam1 body pool, iparam2 segment pool, iparam3 shell
  // pool, iparam4 / iparam5 the Ultimate tentacle cadence / hold.
  movement: EnemyMovementData | null;
  // Fallback pools when there is no MovementData (ASSUMED).
  hp: number;
  leader: () => boolean;
  frames: (motion: number) => number; // frame count of a body motion
  ground?: (x: number, z: number) => number | null;
  rng: () => number;
}

// MovementData fallbacks (ASSUMED: the BattleParamEntry rows are on the
// server side of the data; these only keep the fight running without them).
const FALLBACK = { beam: 100, rock: 60, sting: 80, spread: 60, chance: 0.15 } as const;

// Corner move modes (Player__UpdateMovement 0x0042b94c and its helpers
// 0x0043483c / 0x004349b4 / 0x00434934 / 0x004348b4): sx / sz scale the eased
// distances, the mode function (0x0042bd70.. Forward / Backward / LeftStrafe /
// RightStrafe) decides which axis eases when and writes the motion speed.
type MoveMode = 0 | 1 | 2 | 3;

export class DeRolLeAi extends BrainBase {
  state: string = 'enter';
  readonly superArmor = true;
  // DRL state number (+0x32e) and the sequence cursor (+0x3dc).
  sid: number = DRL_STATE.enter;
  cursor = 0;
  lane = 0; // +0x660
  corner = 3; // +0x65c
  y = 7;
  h = 0; // +0x6ac, the vertical draw offset
  yaw = 0; // +0x60, BAMS
  roll = 0; // +0x64, BAMS
  flags = 0; // +0x3c8: 4 no death now, 0x100 swim sound, 8 shell broken, 0x10 beam
  // Motion: slot +0xb8, frame +0xc0, speed +0xc8.
  slotIndex = 0;
  mframe = 0;
  speed = 0.8;
  private changing = false; // +0xb0 & 4
  private ended = false; // +0xb0 & 0x10
  private motionDirty = true;
  // HP pools (ProcessPlayerHealing_00433edc).
  bodyHp: number;
  readonly bodyMax: number;
  shellHp: number;
  readonly shellMax: number;
  readonly tentacles = [0, 1, 2, 3].map((i) => new DrlTentacle(i));
  readonly stings: DrlSting[] = [
    ...[0, 1, 2, 3, 4].map((i) => new DrlSting(0, i)),
    ...[0, 1, 2].map((i) => new DrlSting(1, i)),
  ];
  readonly events: DrlEvent[] = [];
  // The beam (0x1b): from the muzzle to its end, or null.
  beam: { from: Vec3; to: Vec3 } | null = null;
  // The owner keeps these current from the body's model (render_derolle's
  // node captures); null: estimated from the body position.
  segments: Vec3[] | null = null;
  attaches: Vec3[] | null = null;
  private emitters: DrlRockEmitter[] = [];
  private pendingShots: EnemyShot[] = [];
  private opts: DeRolLeOptions;
  private ultimate: boolean;
  // Working registers of the states (named after the exe's offsets).
  private sub = 0; // +0x6e8
  private s2 = 0; // +0x6ec
  private s3 = 0; // +0x6f0
  private s4 = 0; // +0x6f4
  private v704 = 0;
  private v708 = 0;
  private v70c = 0;
  private v710 = 0;
  private v714 = 0;
  private v718 = 0;
  private v71c = 0;
  private v720 = 0;
  private rockType = 0; // +0x6bc
  private beams = 0; // +0x6e4
  private beamHit = new Set<number>(); // +0x6d0
  private beamDir: Vec3 = [0, 0, 1];
  private beamLen = 0;
  private interval = 180; // +0x6f4 of 0x14 / 0x15
  private delay = 120; // +0x6f8
  private mode: MoveMode = 0;
  private ex: DrlEasing | null = null; // +0x66c
  private ez: DrlEasing | null = null; // +0x68c
  private moveSub = 0; // +0x664 / +0x668
  private x0 = 0;
  private z0 = 0;
  private sx = 1;
  private sz = 1;
  private enterDir: Vec3 = [0, 0, 0];
  private enterDist = 0;

  constructor(opts: DeRolLeOptions) {
    super(opts.x, opts.z, opts.angle, opts.rng);
    this.opts = opts;
    this.ultimate = opts.ultimate;
    const mv = opts.movement;
    // ASSUMED fallback split when MovementData is missing: the stats HP for
    // the body pool and a third of it for the shell.
    this.bodyMax = mv && mv.iparam[0] > 0 ? mv.iparam[0] : Math.max(1, opts.hp);
    this.shellMax = mv && mv.iparam[2] > 0 ? mv.iparam[2] : Math.max(1, Math.round(opts.hp / 3));
    this.bodyHp = this.bodyMax;
    this.shellHp = this.shellMax;
    // The ctor puts the body in state 1 (ProcessDerolleCeilingRockAttack(4))
    // unless the boss is already dead (0x3c8 & 0x8000).
    this.setState(DRL_STATE.enter, false);
  }

  get motionSlot(): DrlSlot {
    return DRL_SLOTS[this.slotIndex];
  }
  // Height of the body: its y plus the draw offset.
  get drawY(): number {
    return this.y + this.h;
  }
  get shellBroken(): boolean {
    return (this.flags & 8) !== 0;
  }
  // States 0x1e..0x20 set the entity's dead flag (UpdateDerolle).
  get invulnerable(): boolean {
    return this.sid >= DRL_STATE.sinkDeath;
  }
  get dying(): boolean {
    return this.sid >= DRL_STATE.sinkDeath;
  }

  // --- motion (Player__Animate on the body) -------------------------------------

  private setSlot(i: number): void {
    this.slotIndex = i;
    this.mframe = 0;
    this.speed = DRL_SLOTS[i].speed;
    this.changing = true;
    this.ended = false;
    this.motionDirty = true;
  }

  private animate(): void {
    const s = this.motionSlot;
    const count = Math.max(1, this.opts.frames(s.motion));
    this.changing = false;
    this.mframe += this.speed;
    if (s.mode === 1) {
      if (this.mframe >= count) this.mframe -= count;
    } else if (this.mframe >= count - 1) {
      if (s.mode === 2) {
        this.setSlot(s.next);
        this.ended = true;
      } else {
        this.mframe = count - 1;
        this.ended = true;
      }
    }
  }

  private crossed(f: number): boolean {
    return this.mframe >= f && this.mframe - this.speed < f;
  }

  // --- states ---------------------------------------------------------------

  private teleport(i: number): void {
    const c = DRL_CORNERS[i];
    this.x = c[0];
    this.y = c[1];
    this.z = c[2];
    this.h = 0;
    this.roll = 0;
  }

  private emit(e: DrlEvent): void {
    this.events.push(e);
  }

  private resetRegs(): void {
    this.sub = this.s2 = this.s3 = this.s4 = 0;
    this.v704 = this.v708 = this.v70c = this.v710 = this.v714 = this.v718 = this.v71c = this.v720 = 0;
  }

  // SetEnemyAiState_0051f62c: phase 5 on the old state, 4 then 6 on the new.
  // `send`: the leader's start_drl_rock_cycle also sends 6x13 / 6x14.
  setState(next: number, send = true, targets: readonly AiTarget[] = []): void {
    this.leave(this.sid);
    this.sid = next;
    this.state = DRL_NAMES[next] ?? `state ${next}`;
    this.resetRegs();
    this.enter(next);
    if (next === DRL_STATE.wall0 || next === DRL_STATE.wall2 || next === DRL_STATE.ringStings || next === DRL_STATE.beam) {
      if (send) this.pickTarget(targets);
    }
    if (send) {
      const withTarget = next === DRL_STATE.ringStings || next === DRL_STATE.wall0 || next === DRL_STATE.wall2 || next === DRL_STATE.beam;
      this.emit({ kind: 'state', state: next, cursor: this.cursor, target: this.targetId, withTarget });
    }
  }

  // A follower applies the leader's 6x13 / 6x14.
  applyRemote(state: number, cursor: number, target: number | null): void {
    if (target !== null) this.targetId = target;
    this.cursor = cursor;
    this.setState(state, false);
  }

  // Phase 6: the target pick of 0x14 / 0x15 / 0x19 / 0x1b: one player is
  // taken, more start at round(n * rand) and take the first live one.
  private pickTarget(targets: readonly AiTarget[]): void {
    const live = targets.filter((t) => !t.dead);
    if (!targets.length || !live.length) {
      this.targetId = null;
      return;
    }
    const start = Math.round(targets.length * this.rng()) % targets.length;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[(start + i) % targets.length];
      if (!t.dead) {
        this.targetId = t.clientId;
        return;
      }
    }
  }

  private enter(s: number): void {
    const S = DRL_STATE;
    const mv = MOVES[s];
    if (mv) return this.enterMove(mv[0], mv[1]);
    switch (s) {
      case S.enter:
        this.setSlot(0);
        this.x = 70; // 0x428c0000
        this.flags &= ~0x104;
        this.h = 0;
        this.roll = 0;
        this.sub = 0;
        return;
      case S.sideJump02:
      case S.sideJump20: {
        const from = s === S.sideJump02 ? 0 : 2;
        this.flags = (this.flags & ~0x100) | 4;
        this.corner = from;
        this.lane = from === 0 ? 2 : 0;
        this.teleport(from);
        this.v704 = from === 0 ? -1 : 1; // the x sign
        this.setSlot(from === 0 ? 5 : 6);
        return;
      }
      case S.bigJump:
        this.setSlot(1);
        this.flags = (this.flags & ~0x100) | 4;
        this.teleport(3);
        this.corner = 3;
        return;
      case S.dive:
        this.setSlot(1);
        this.flags = (this.flags & ~0x100) | 4;
        this.teleport(3);
        this.s3 = 30;
        this.v708 = 3;
        this.yaw = 0;
        return;
      case S.rocks0:
      case S.rocks2: {
        const c = s === S.rocks0 ? 0 : 2;
        this.setSlot(3);
        this.flags &= ~0x104;
        this.corner = c;
        this.teleport(c);
        this.v704 = -1000;
        this.rockType = (this.rockType + 1) % 3;
        return;
      }
      case S.bite0:
      case S.bite2: {
        const c = s === S.bite0 ? 0 : 2;
        this.setSlot(1);
        this.flags = (this.flags & ~0x100) | 4;
        this.corner = c;
        this.teleport(c);
        this.v71c = this.z;
        this.v714 = -0.2;
        return;
      }
      case S.wall0:
      case S.wall2: {
        const c = s === S.wall0 ? 0 : 2;
        this.flags &= ~0x104;
        this.corner = c;
        this.holdWall(c);
        this.setSlot(c === 0 ? 9 : 10);
        const mv = this.opts.movement;
        this.interval = this.ultimate && mv && mv.iparam[3] > 0 ? mv.iparam[3] : 180;
        this.delay = this.ultimate && mv && mv.iparam[4] > 0 ? mv.iparam[4] : 120;
        return;
      }
      case S.sink0:
      case S.sink2: {
        const c = s === S.sink0 ? 0 : 2;
        this.flags = (this.flags & ~0x100) | 4;
        this.corner = c;
        this.holdWall(c);
        this.v708 = c === 0 ? -1 : 1;
        this.setSlot(c === 0 ? 9 : 10);
        this.v710 = -1;
        this.s4 = 0x500;
        return;
      }
      case S.stings:
      case S.ringStings:
        this.flags = (this.flags & ~4) | 0x100;
        this.setSlot(11);
        this.corner = 1;
        this.teleport(1);
        return;
      case S.beamCharge:
        this.flags = (this.flags & ~4) | 0x100;
        this.setSlot(12);
        this.teleport(3);
        this.corner = 3;
        this.beams = 0;
        return;
      case S.beam:
        this.flags = (this.flags & ~4) | 0x100;
        this.setSlot(15);
        this.teleport(3);
        this.corner = 3;
        this.beamHit.clear();
        this.beam = null;
        return;
      case S.recover:
      case S.recover2:
        this.flags = (this.flags & ~4) | 0x100;
        this.setSlot(14);
        this.teleport(3);
        this.corner = 3;
        return;
      case S.sinkDeath:
        this.flags = (this.flags & ~0x100) | 4;
        this.h = 0;
        return;
      case S.death:
        this.flags |= 4;
        this.setSlot(16);
        this.teleport(3);
        this.bodyHp = 0;
        for (const t of this.tentacles) t.reset();
        return;
      case S.remove:
        this.setSlot(16);
        this.flags |= 4;
        this.emit({ kind: 'remove' });
        return;
      default:
        this.setSlot(1);
    }
  }

  // SetDerolleScaleAndRotation_0042e308: on the wall of side c.
  private holdWall(c: number): void {
    this.x = c === 0 ? -100 : 100;
    this.z = 10;
    this.roll = c === 0 ? 0x500 : -0x500 & 0xffff;
    this.h = 4;
  }

  private leave(s: number): void {
    const S = DRL_STATE;
    if (MOVES[s]) {
      this.corner = this.lane;
      return;
    }
    switch (s) {
      case S.sideJump02:
      case S.sideJump20:
        this.corner = this.lane;
        this.flags &= ~4;
        return;
      case S.bigJump:
        this.corner = 1;
        this.flags &= ~4;
        return;
      case S.bite0:
      case S.bite2:
      case S.sink0:
      case S.sink2:
        this.flags &= ~4;
        this.roll = 0;
        return;
      case S.wall0:
      case S.wall2:
        for (const t of this.tentacles) t.lower();
        return;
      case S.beam:
        this.beams++;
        this.flags &= ~0x10;
        this.beam = null;
        return;
      case S.death:
        // The kill runs at (-55.8, 2.0, 60.29): EXP, the drop request and
        // quest flag 0x20 (EnemyOnKilledHandler_0051f894).
        this.emit({ kind: 'killed', x: -55.8, y: 2.0, z: 60.29 });
        return;
    }
  }

  // Phase 4 of the corner moves.
  private enterMove(from: number, to: number): void {
    this.setSlot(1);
    this.flags = (this.flags & ~4) | 0x100;
    this.corner = from;
    this.lane = to;
    this.teleport(from);
    this.x0 = this.x;
    this.z0 = this.z;
    const C = DRL_CORNERS;
    if (from === 3) {
      this.mode = 0;
      this.sx = to === 2 ? 1 : -1;
      this.sz = 1;
      this.ex = new DrlEasing(0.08, 0.08, 3, Math.abs(C[to][0] - this.x));
      this.ez = new DrlEasing(0.08, 0.08, 5, Math.abs(25 - this.z));
      this.moveSub = 1;
    } else if (to === 1) {
      this.mode = 1;
      this.sx = from === 0 ? 1 : -1;
      this.sz = 1;
      this.ex = new DrlEasing(0.08, 0.08, 3, Math.abs(0 - this.x));
      this.ez = new DrlEasing(0.08, 0.08, 5, Math.abs(500 - this.z));
      this.moveSub = 0;
    } else if (from === 1) {
      this.mode = 2;
      this.sx = to === 2 ? 1 : -1;
      this.sz = -1;
      this.ex = new DrlEasing(0.08, 0.08, 3, 175);
      this.ez = new DrlEasing(0.2, 0.05, 7, Math.abs(25 - this.z));
      this.moveSub = 0;
    } else {
      this.mode = 3;
      this.sx = from === 0 ? 1 : -1;
      this.sz = -1;
      this.ex = new DrlEasing(0.08, 0.08, 3, 175);
      this.ez = new DrlEasing(0.2, 0.05, 7, Math.abs(-250 - this.z));
      this.moveSub = 0;
    }
  }

  // Phase 0 of the corner moves: the mode function, then
  // x = x0 + sx * Xpos, z = z0 + sz * Zpos.
  private tickMove(): void {
    const ex = this.ex!;
    const ez = this.ez!;
    const speedUp = () => (this.speed = Math.min(this.speed + 0.1, 0.9));
    let done = false;
    if (this.mode === 0) {
      ex.tick();
      if (this.moveSub === 1) {
        ez.v = Math.max(ez.v - 0.1, -4);
        ez.pos += ez.v;
        if (ex.pos > 30) this.moveSub = 3;
      } else if (this.moveSub === 3 && ez.tick() === 3) this.moveSub = 4;
      speedUp();
      done = this.moveSub === 4;
    } else if (this.mode === 1) {
      ez.tick();
      if (this.moveSub === 0 && ez.pos > 380) this.moveSub = 1;
      else if (this.moveSub === 1 && ex.tick() === 3) this.moveSub = 2;
      speedUp();
      done = this.moveSub === 2;
    } else if (this.mode === 2) {
      ex.tick();
      if (this.moveSub === 0 && ex.pos > 160) this.moveSub = 2;
      else if (this.moveSub === 2) {
        this.speed = 0.3;
        this.moveSub = 3;
      } else if (this.moveSub === 3) {
        if (ez.tick() === 3) this.moveSub = 4;
        if (ez.pos > 200) speedUp();
      }
      done = this.moveSub === 4;
    } else {
      ez.tick();
      if (this.moveSub === 0) {
        this.speed = 0.3;
        if (ez.pos > 100) this.moveSub = 1;
      } else if (this.moveSub === 1 && ex.tick() === 3) this.moveSub = 2;
      if (ez.pos > 100) this.speed = 0.9;
      done = this.moveSub === 2;
    }
    if (done) this.sub = 1;
    this.x = this.x0 + this.sx * ex.pos;
    this.z = this.z0 + this.sz * ez.pos;
  }

  // DerolleUpdateTargetAngle_0042c938: the draw offset back toward 0 by 0.4.
  private settle(): void {
    if (this.h > 0.4) this.h -= 0.4;
    else if (this.h < -0.4) this.h += 0.4;
    else this.h = 0;
  }

  // Whether the state's phase 9 may pick the next one.
  private done(): boolean {
    const S = DRL_STATE;
    const s = this.sid;
    if (MOVES[s]) return this.sub === 1;
    switch (s) {
      case S.enter:
        return this.sub === 5;
      case S.sideJump02:
      case S.sideJump20:
        return this.sub === 2;
      case S.bigJump:
        return this.sub === 3;
      case S.dive:
        return this.sub === 6;
      case S.rocks0:
      case S.rocks2:
      case S.stings:
      case S.ringStings:
        return this.ended;
      case S.bite0:
      case S.bite2:
        return this.slotIndex === 9 || this.slotIndex === 10;
      case S.wall0:
      case S.wall2:
        return this.sub === 3;
      case S.sink0:
      case S.sink2:
        return this.sub === 2;
      case S.beamCharge:
        return this.slotIndex === 15;
      case S.beam:
        return this.sub === 4;
      case S.recover:
      case S.recover2:
        return this.slotIndex === 1;
      case S.death:
        return this.sub === 3;
      default:
        return false;
    }
  }

  // DerolleSelectNextAttackState_00433318 when the body pool is gone.
  private dieNow(targets: readonly AiTarget[]): void {
    const s = this.sid;
    if (s === DRL_STATE.death || s === DRL_STATE.remove) return;
    if (s === DRL_STATE.wall0 || s === DRL_STATE.wall2) return this.advance(targets);
    if (s === DRL_STATE.sinkDeath) return;
    this.setState(s === DRL_STATE.sink0 || s === DRL_STATE.sink2 ? DRL_STATE.death : DRL_STATE.sinkDeath, true, targets);
  }

  private advance(targets: readonly AiTarget[]): void {
    if (this.sid === DRL_STATE.death) {
      this.setState(DRL_STATE.remove, true, targets);
      return;
    }
    const n = drlNextState(this.cursor, this.ultimate, this.lane, () => this.rng() * 2 - 1);
    this.cursor = n.cursor;
    this.setState(n.state, true, targets);
  }

  // --- HP (ProcessPlayerHealing_00433edc) ---------------------------------------

  // A hit on the body: the shell pool first; when it goes below 0 the shell
  // breaks (TriggerPlayerHealEffect_00433fe4: flags | 0x88, SE 0x32d); then
  // the body pool (SE 0x336). Returns the pool the hit went to.
  hit(damage: number): 'shell' | 'body' | 'none' {
    const d = Math.max(0, Math.round(damage));
    if (this.dying || d <= 0) return 'none';
    if (!this.shellBroken) {
      this.shellHp -= d;
      if (this.shellHp < 0) {
        this.shellHp = 0;
        this.flags |= 0x88;
        this.emit({ kind: 'shellBroken' });
        this.emit({ kind: 'se', id: 0x32d });
      }
      return 'shell';
    }
    this.bodyHp = Math.max(0, this.bodyHp - d);
    this.emit({ kind: 'se', id: 0x336 });
    return 'body';
  }

  // --- the frame --------------------------------------------------------------

  tick(targets: readonly AiTarget[]): AiFrame {
    const out = this.frame0();
    if (this.opts.leader() && this.sid !== DRL_STATE.remove) {
      if (this.bodyHp < 1 && (this.flags & 4) === 0) this.dieNow(targets);
      else if (this.done()) this.advance(targets);
      // Phase 8 of 0x1e: once sunk below -200 the leader moves on to 0x1f.
      if (this.sid === DRL_STATE.sinkDeath && this.h < -200) this.setState(DRL_STATE.death, true, targets);
    }
    this.phase0(targets);
    this.tickChildren(targets);
    if (this.motionDirty) {
      this.motionDirty = false;
      const s = this.motionSlot;
      this.play(out, { index: s.motion, speed: s.speed, loop: s.mode === 1 });
    }
    out.x = this.x;
    out.z = this.z;
    this.angle = this.yaw * BAMS;
    out.angle = this.angle;
    out.y = this.drawY;
    if (this.pendingShots.length) out.shots = this.pendingShots.splice(0);
    return out;
  }

  private frame0(): AiFrame {
    return { motion: null, x: this.x, z: this.z, angle: this.yaw * BAMS, hit: null };
  }

  private phase0(targets: readonly AiTarget[]): void {
    const S = DRL_STATE;
    const s = this.sid;
    if (MOVES[s]) {
      this.animate();
      if (this.sub === 0) this.tickMove();
      return;
    }
    switch (s) {
      case S.enter:
        return this.tickEnter();
      case S.sideJump02:
      case S.sideJump20:
        return this.tickSideJump();
      case S.bigJump:
        return this.tickBigJump();
      case S.dive:
        return this.tickDive();
      case S.rocks0:
      case S.rocks2:
        return this.tickRocks();
      case S.bite0:
      case S.bite2:
        return this.tickBite();
      case S.wall0:
      case S.wall2:
        return this.tickWall(targets);
      case S.sink0:
      case S.sink2:
        return this.tickSink();
      case S.stings:
      case S.ringStings:
        return this.tickStings(targets);
      case S.beam:
        return this.tickBeam(targets);
      case S.sinkDeath:
        this.animate();
        this.h -= 2;
        return;
      case S.death:
        return this.tickDeath();
      default:
        this.animate();
    }
  }

  // State 1 (ProcessDerolleCeilingRockAttack 0x00431c6c): the entrance.
  private tickEnter(): void {
    this.animate();
    if (this.sub === 0) {
      // 55 ticks (0x36), then (0, 7, -190) and the enter motion runs on.
      if (++this.s3 > 0x36) {
        this.sub = 1;
        this.s3 = 0;
        this.x = 0;
        this.y = 7;
        this.z = -190;
      }
      return;
    }
    if (this.sub === 1) {
      if (this.crossed(35) || this.crossed(112)) this.emit({ kind: 'se', id: 0x338 });
      else if (this.crossed(65)) this.emit({ kind: 'se', id: 0x339 });
      if (this.mframe >= 34) this.x += -1;
      else if (this.mframe >= 18) this.x += -5;
      if (this.ended) {
        this.flags |= 0x100;
        this.sub = 2;
      }
      return;
    }
    if (this.sub === 2) {
      // ASSUMED: the enter motion's root offset (DerolleAction, +0x72c) is
      // not added; the body walks to corner 0 from where it stands.
      const c = DRL_CORNERS[0];
      const dx = c[0] - this.x;
      const dz = c[2] - this.z;
      this.enterDist = Math.hypot(dx, dz);
      this.enterDir = [dx / (this.enterDist || 1), 0, dz / (this.enterDist || 1)];
      this.v704 = 0;
      this.sub = 3;
      return;
    }
    if (this.sub === 3) {
      this.x += this.enterDir[0] * 3;
      this.z += this.enterDir[2] * 3;
      this.v704 += 3;
      if (this.enterDist <= this.v704) {
        this.teleport(0);
        this.corner = 0;
        this.lane = 0;
        // ASSUMED: the game-state flag sub 4 waits for (the boss camera) is set.
        this.sub = 5;
      }
    }
  }

  // States 4 / 0xa (0x0042c194): the side jump between corners 0 and 2.
  // v704 is the x sign, v714 the x speed, v710 / v718 the z speed / its
  // change; a43c44 = 20, a43c40 = 16, a43c3c = 17 / 0.3, a43c38 = 2,
  // a43c34 = 36 (ticks of each part of the jump).
  private tickSideJump(): void {
    const d = this.v704;
    if (this.sub === 0) {
      this.animate();
      if (!this.changing) this.sub = 1;
      return;
    }
    if (this.sub !== 1) return;
    this.animate();
    const f = this.mframe;
    const step = this.s3;
    if (step === 0 && f >= 10) {
      this.s3 = 1;
      this.v714 = (65 / 20) * d;
    } else if (step === 1 && f >= 20) {
      this.s3 = 2;
      this.v714 = (-90 / 16) * d;
      this.v718 = ((16 + 17 / 0.3) * -this.v710 + 270 - this.z) / ((0.5 * 16 + 17 / 0.3) * 16);
    } else if (step === 2 && f >= 28) {
      this.s3 = 3;
      this.v714 = (-370 / (17 / 0.3)) * d;
    } else if (step === 3 && f >= 45) {
      this.s3 = 4;
      this.v714 = (-30 / 2) * d;
      this.ez = new DrlEasing(0.2, 0.05, 7, Math.abs(25 - this.z), this.v710 * -0.5);
      this.v71c = this.z;
    } else if (step === 4 && f >= 46) {
      this.s3 = 5;
      this.v714 = ((-175 - this.x * d) / 36) * d;
    } else if (step === 5 && f >= 64) this.s3 = 6;
    if (this.slotIndex !== 1) {
      if (this.crossed(10) || this.crossed(41)) this.emit({ kind: 'se', id: 0x338 });
      else if (this.crossed(25)) this.emit({ kind: 'se', id: 0x339 });
    }
    switch (this.s3) {
      case 0:
        this.v710 -= 0.2;
        this.z += this.v710;
        return;
      case 1:
        this.x += this.v714;
        this.z += this.v710;
        return;
      case 2:
        this.v710 += this.v718;
        this.x += this.v714;
        this.z += this.v710;
        return;
      case 3:
        // ASSUMED: the height term (GetPlayerYPosition_00422768) stays 0.
        this.x += this.v714;
        this.mframe -= 0.5 - 0.3;
        this.z += this.v710;
        return;
      case 4:
      case 5:
        this.x += this.v714;
        this.settle();
        this.ez!.tick();
        this.z = this.v71c - this.ez!.pos;
        return;
      case 6:
        this.settle();
        if (this.ez!.tick() === 3) this.sub = 2;
        this.z = this.v71c - this.ez!.pos;
        return;
    }
  }

  // State 0xd (0x00431058): the big jump from corner 3 over the arena to 1.
  private tickBigJump(): void {
    this.animate();
    const f = this.mframe;
    const back = () => {
      this.v70c = Math.max(this.v70c - 0.2, -7);
      this.z += this.v70c;
    };
    if (this.sub === 0) {
      back();
      if (++this.s3 > 20) {
        this.sub = 1;
        this.setSlot(4);
      }
      return;
    }
    if (this.sub === 1) {
      back();
      if (!this.changing) this.sub = 2;
      return;
    }
    if (this.sub !== 2) return;
    const a = 6 / 0.195;
    const b = 18.333;
    if (this.s2 === 0 && f >= 10.5) {
      this.v710 = (300 - this.z - 49.102 * this.v70c) / (40.936 * b);
      this.s2 = 1;
    } else if (this.s2 === 1 && f >= 16) {
      // ASSUMED: the ground height there is 0.
      this.v704 = ((40 - 0) * 4) / a;
      this.v708 = (this.v704 * 2) / a;
      this.s2 = 2;
    } else if (this.s2 === 2 && f >= 22) {
      this.v70c *= 0.5;
      this.v710 = 0;
      this.s2 = 3;
    } else if (this.s2 === 3 && f >= 29) this.s2 = 4;
    if (this.slotIndex !== 1) {
      if (this.crossed(4) || this.crossed(22)) this.emit({ kind: 'se', id: 0x338 });
      else if (this.crossed(14)) this.emit({ kind: 'se', id: 0x339 });
    }
    switch (this.s2) {
      case 0:
        back();
        return;
      case 1:
        this.v70c += this.v710;
        this.z += this.v70c;
        return;
      case 2:
        this.z += this.v70c;
        this.h += this.v704;
        this.v704 -= this.v708;
        this.mframe -= 0.105;
        return;
      default:
        if (this.v710 > 0 && this.ez) {
          if (this.ez.tick() === 3) this.sub = 3;
          else this.z = this.v70c - this.ez.pos;
        } else {
          this.v70c -= 0.2;
          if (this.v70c <= 0) {
            this.v710 = 1;
            this.ez = new DrlEasing(0.2, 0.05, 7, Math.abs(500 - this.z));
            this.v70c = this.z;
          } else this.z += this.v70c;
        }
        this.settle();
    }
  }

  // State 0xf (0x00430a90): dives at corner 3, runs along the ceiling from
  // z -1200 to 360 dropping rocks, dives again and comes up at corner 1.
  private tickDive(): void {
    this.animate();
    const mv = this.opts.movement;
    switch (this.sub) {
      case 0:
        this.v704 += 0.2;
        this.v708 -= 0.2;
        this.z -= this.v704;
        this.h += this.v708;
        if (this.h < -137) {
          this.sub = 1;
          this.s3 = 0;
        }
        return;
      case 1:
        if (++this.s3 >= 45) {
          this.z = -1200;
          this.yaw = 0x8000;
          this.setSlot(2);
          this.h = 93;
          this.sub = 2;
        }
        return;
      case 2: {
        this.z += 6;
        this.emit({ kind: 'se', id: 0x329 });
        const chance = mv ? mv.fparam5 : FALLBACK.chance;
        const spread = mv ? mv.fparam4 : FALLBACK.spread;
        if (this.rng() <= chance) {
          const rx = this.x + spread * (this.rng() * 2 - 1);
          const rz = this.z - 100 * this.rng();
          this.pendingShots.push(new DrlCeilingRock(rx, this.y + 10 + this.h, rz, this.opts.ground?.(rx, rz) ?? null, this.rng));
        }
        if (this.z >= 360) {
          this.sub = 3;
          this.v708 = 0;
        }
        return;
      }
      case 3:
        this.speed = Math.max(0, this.speed - 0.02);
        if (this.h > 0) {
          this.v708 -= 0.1;
          this.z += 4.8;
        } else this.z += 1.2;
        this.h += this.v708;
        if (this.h < -137) {
          this.sub = 4;
          this.s3 = 0;
          this.emit({ kind: 'se', id: 0x339 });
        }
        return;
      case 4:
        if (++this.s3 >= 45) {
          this.setSlot(1);
          this.teleport(1);
          this.corner = 1;
          this.yaw = 0;
          this.h = -137;
          this.sub = 5;
        }
        return;
      case 5:
        this.h += 0.9;
        if (this.h >= 0) {
          this.h = 0;
          this.sub = 6;
        }
        return;
    }
  }

  // Where the shell segments are (+0x548 + i * 0xc). Without the model's
  // node captures (ASSUMED) they trail the head 20 apart.
  segmentAt(i: number): Vec3 {
    const s = this.segments?.[i];
    if (s) return s;
    const a = this.yaw * BAMS;
    return [this.x - Math.sin(a) * 20 * (i + 1), this.drawY, this.z - Math.cos(a) * 20 * (i + 1)];
  }

  // Where tentacle i hangs (the attach matrices +0x624). ASSUMED without the
  // model's node captures: beside the head.
  attachAt(i: number): Vec3 {
    const a = this.attaches?.[i];
    if (a) return a;
    const yaw = this.yaw * BAMS;
    const side = i & 1 ? 1 : -1;
    const back = 10 + 6 * (i >> 1);
    return [this.x + Math.cos(yaw) * 12 * side - Math.sin(yaw) * back, this.drawY, this.z - Math.sin(yaw) * 12 * side - Math.cos(yaw) * back];
  }

  // States 0x10 / 0x11 (0x0042ce8c): segments 0..4 throw rocks as the body's
  // wave passes them (segment i fires once segment i's y is below i + 1's).
  private tickRocks(): void {
    this.animate();
    const fire = (i: number) => {
      let a = 0x3800 - 0x33 * i;
      if (this.corner === 2) a = -a;
      const power = this.opts.movement ? this.opts.movement.fparam2 : FALLBACK.rock;
      this.emitters.push(new DrlRockEmitter(this.segmentAt(i), a, this.rockType, power));
      this.emit({ kind: 'se', id: 0x32f });
    };
    if (this.s2 === 0) {
      if (!this.changing) {
        fire(this.sub);
        this.s2 = 1;
      }
    } else if (this.s2 === 1) {
      const i = this.sub;
      const fallback = !this.segments;
      // ASSUMED without node captures: one segment every 4 ticks.
      const next = fallback ? ++this.s4 % 4 === 0 : this.segmentAt(i)[1] < this.segmentAt(i + 1)[1];
      if (next) {
        this.sub = i + 1;
        if (this.sub >= 4) this.s2 = 2;
        fire(this.sub);
      }
    }
  }

  // States 0x12 / 0x13 (0x0042d304): the bite leap to the wall.
  private tickBite(): void {
    this.animate();
    const f = this.mframe;
    const d = this.v704;
    if (this.sub === 0) {
      if (++this.s2 > 11) {
        this.sub = 1;
        this.v704 = this.corner === 0 ? -1 : 1;
        this.setSlot(this.corner === 0 ? 7 : 8);
      }
    } else if (this.sub === 1) {
      if (!this.changing) this.sub = 2;
    } else if (this.sub === 2 && f >= 6) {
      this.v708 = this.x;
      this.v70c = (100 * d - this.x) / 7;
      this.v714 = this.v718 / -7;
      this.v718 = 0;
      this.v71c = this.z;
      this.sub = 3;
    } else if (this.sub === 3 && f >= 13) {
      this.v708 = 100 * d;
      this.v70c = (135 * d - 100 * d) / 7;
      this.v714 = ((10 - this.z) * 2) / 144;
      this.v71c = this.z;
      this.sub = 4;
    } else if (this.sub === 4 && f >= 20) {
      this.v708 = 135 * d;
      this.v70c = (100 * d - 135 * d) / 5;
      this.v720 = (-d * 1280) / 5;
      this.sub = 5;
    } else if (this.sub === 5 && f >= 25) {
      this.sub = 6;
      this.emit({ kind: 'se', id: 0x32e });
      for (const t of this.tentacles) t.raise();
    }
    if (this.sub <= 2) {
      this.v718 = Math.max(this.v718 + this.v714, -7);
      this.z += this.v718;
    } else if (this.sub === 3) {
      const t = f - 6;
      this.x = this.v70c * t + this.v708;
      this.z = (0.5 * this.v714 * t - 7) * t + this.v71c;
      if (this.crossed(8.5)) this.emit({ kind: 'se', id: 0x339 });
    } else if (this.sub === 4 || this.sub === 5) {
      const t = Math.min(f, 25) - 13;
      this.z = 0.5 * this.v714 * t * t + this.v71c;
      if (this.sub === 4) {
        this.x = this.v70c * t + this.v708;
        this.h = Math.min(7 * 4 * t, 4);
      } else {
        this.x = this.v70c * (Math.min(f, 25) - 20) + this.v708;
        this.roll = Math.round((Math.min(f, 25) - 20) * this.v720) & 0xffff;
      }
    }
    if (this.crossed(15)) this.emit({ kind: 'se', id: 0x338 });
  }

  // States 0x14 / 0x15 (0x0042dd68): on the wall, the tentacles reach for
  // the target (or a random floor point) one after the other.
  private tickWall(targets: readonly AiTarget[]): void {
    this.animate();
    if (this.sub === 0) {
      if (++this.s2 >= 41) {
        this.sub = 1;
        this.s2 = 0;
      }
    } else if (this.sub === 1) {
      if (this.s2++ % this.interval === 0) {
        const k = this.s3++;
        this.tentacles[k]?.send(this.reachPoint(targets), this.delay);
        if (this.s3 >= 4) {
          this.sub = 2;
          this.s2 = 0;
        }
      }
    } else if (this.sub === 2) {
      if (this.tentacles.every((t) => t.state === 4) || ++this.s2 > 600) this.sub = 3;
    }
  }

  private reachPoint(targets: readonly AiTarget[]): Vec3 {
    const t = targets.find((p) => p.clientId === this.targetId && !p.dead);
    if (t) return [t.x, this.opts.ground?.(t.x, t.z) ?? 0, t.z];
    const d = this.rng() * 120;
    const a = this.rng() * TWO_PI;
    const x = d * Math.sin(a);
    const z = d * Math.cos(a);
    return [x, this.opts.ground?.(x, z) ?? -1.85, z];
  }

  // States 0x16 / 0x17 (0x0042e348): sinks off the wall, comes up at the
  // same corner.
  private tickSink(): void {
    this.animate();
    if (this.sub === 0) {
      this.v70c += 0.2;
      this.v704 += 0.08;
      this.v710 += 0.1;
      this.x += this.v704 * this.v708;
      this.z -= this.v70c;
      this.h -= this.v710;
      const before = this.s4;
      this.s4 = Math.min(this.s4 + 256, 0x4000);
      this.roll = Math.round(-this.v708 * this.s4) & 0xffff;
      if (before <= 0x21ff && this.s4 > 0x21ff) this.emit({ kind: 'se', id: 0x339 });
      if (this.h < -137) {
        this.teleport(this.corner);
        this.v710 = 0;
        this.h = -137;
        this.setSlot(1);
        this.flags = (this.flags & ~4) | 0x100;
        this.sub = 1;
      }
    } else if (this.sub === 1) {
      if (this.h + 2 >= 0) {
        this.h = 0;
        this.sub = 2;
      } else this.h += 2;
    }
  }

  // The launch point (+0x4d8). ASSUMED: the head, 10 above the body.
  private launchPoint(): Vec3 {
    return [this.x, this.drawY + 10, this.z];
  }

  // States 0x18 / 0x19 (0x0042e824): at frame 18.0 the stings leave.
  private tickStings(targets: readonly AiTarget[]): void {
    this.animate();
    if (!this.crossed(18)) return;
    const from = this.launchPoint();
    if (this.sid === DRL_STATE.stings) {
      DE_ROL_LE_STING_POINTS.forEach((p, i) => {
        const g = this.opts.ground?.(p[0], p[2]) ?? p[1];
        this.stings[i].lob([...from], [p[0], g + 1, p[2]]);
      });
    } else if (this.targetId !== null && targets.some((t) => t.clientId === this.targetId)) {
      for (let i = 0; i < 3; i++) this.stings[5 + i].home([...from], this.targetId);
    }
    this.emit({ kind: 'se', id: 0x32a });
  }

  // State 0x1b: the beam from the muzzle at the target, 30 longer a tick up
  // to 500, an area hit at its end (group 0, MovementData fparam1) once per
  // player per beam.
  private tickBeam(targets: readonly AiTarget[]): void {
    this.animate();
    const muzzle: Vec3 = [this.x, this.drawY + 10, this.z + 30];
    if (this.sub === 0) {
      if (++this.s2 >= 20) {
        this.beamHit.clear();
        this.setSlot(13);
        const t = targets.find((p) => p.clientId === this.targetId && !p.dead);
        const tx = t ? t.x : this.x;
        const tz = t ? t.z : this.z + 100;
        const l = Math.hypot(tx - muzzle[0], tz - muzzle[2]) || 1;
        this.beamDir = [(tx - muzzle[0]) / l, 0, (tz - muzzle[2]) / l];
        this.flags |= 0x10;
        this.emit({ kind: 'se', id: 0x330 });
        this.sub = 1;
      }
      return;
    }
    if (this.sub === 1) {
      if (this.ultimate && this.beams > 0) this.mframe = 13;
      if (this.mframe >= 13) {
        this.mframe = 13;
        this.beamLen = 80;
        this.sub = 2;
      }
      return;
    }
    if (this.sub === 2) {
      this.mframe = 13;
      this.beamLen = Math.min(500, this.beamLen + 30);
      const end: Vec3 = [muzzle[0] + this.beamDir[0] * this.beamLen, -10, muzzle[2] + this.beamDir[2] * this.beamLen];
      this.beam = { from: muzzle, to: end };
      this.emit({ kind: 'se', id: 0x331 });
      const power = this.opts.movement ? this.opts.movement.fparam1 : FALLBACK.beam;
      // ASSUMED: field 2 (16) of the hit context is the radius.
      const burst = new DrlBurst(end[0], end[1], end[2], 16, { kind: 'tech', power: Math.max(0, power) }, { color: 0x80c0ff, size: 2 });
      const hits = burst.peek(targets).filter((t) => !this.beamHit.has(t.clientId));
      if (hits.length) {
        for (const h of hits) this.beamHit.add(h.clientId);
        this.pendingShots.push(new DrlBurst(end[0], end[1], end[2], 16, burst.effect, burst.look, hits.map((h) => h.clientId)));
      }
      if (this.beamLen >= 500) {
        this.sub = 3;
        this.beam = null;
      }
      return;
    }
    if (this.sub === 3 && (this.ultimate || this.ended)) this.sub = 4;
  }

  // State 0x1f: the death motion, then the body sinks.
  private tickDeath(): void {
    this.animate();
    if (this.crossed(20)) this.emit({ kind: 'se', id: 0x338 });
    if (this.crossed(27)) this.emit({ kind: 'bgm', name: 'deldeath.adx' });
    if (this.crossed(99)) this.emit({ kind: 'se', id: 0x339 });
    if (this.sub === 0) {
      if (this.mframe > 100 || this.ended) this.sub = 2;
    } else if (this.sub === 2) {
      this.h -= 1;
      if (this.h < -100) this.sub = 3;
    }
  }

  private tickChildren(targets: readonly AiTarget[]): void {
    for (const em of this.emitters) this.pendingShots.push(...em.tick());
    this.emitters = this.emitters.filter((e) => !e.done);
    const groundAt = (x: number, z: number) => this.opts.ground?.(x, z) ?? 0;
    const stingPower = this.opts.movement ? this.opts.movement.fparam3 : FALLBACK.sting;
    for (const s of this.stings) {
      const b = s.tick(targets, stingPower, groundAt, this.rng);
      if (b) {
        this.pendingShots.push(b);
        this.emit({ kind: 'se', id: 0x32c });
      }
    }
    this.tentacles.forEach((t, i) => {
      const grab = t.tick(this.attachAt(i));
      if (grab) {
        this.emit({ kind: 'se', id: 0x32e });
        this.pendingShots.push(new DrlBurst(grab[0], grab[1], grab[2], DRL_TENTACLE.grabRadius, { kind: 'melee', mult: 1.0, knockback: 0 }, { color: 0xc04060, size: 3 }));
      }
    });
  }

  onDamage(): void {
    // No flinch: hits only feed the pools (ProcessPlayerHealing_00433edc).
  }

  resume(): string {
    return this.state;
  }
}

const DRL_NAMES: Record<number, string> = {
  0x00: 'idle',
  0x01: 'enter',
  0x03: 'move 0-1',
  0x04: 'jump 0-2',
  0x05: 'move 0-3',
  0x06: 'move 1-2',
  0x08: 'move 1-0',
  0x09: 'move 2-3',
  0x0a: 'jump 2-0',
  0x0b: 'move 2-1',
  0x0c: 'move 3-0',
  0x0d: 'big jump',
  0x0e: 'move 3-2',
  0x0f: 'ceiling run',
  0x10: 'rocks 0',
  0x11: 'rocks 2',
  0x12: 'bite 0',
  0x13: 'bite 2',
  0x14: 'wall 0',
  0x15: 'wall 2',
  0x16: 'sink 0',
  0x17: 'sink 2',
  0x18: 'stings',
  0x19: 'ring stings',
  0x1a: 'beam charge',
  0x1b: 'beam',
  0x1c: 'recover',
  0x1d: 'recover',
  0x1e: 'sinking',
  0x1f: 'death',
  0x20: 'gone',
};

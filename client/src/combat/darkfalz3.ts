// Dark Falz form 3 (PsoBB.exe, Ephinea 1.25.13): the winged form in the second
// arena (create 0x0045E4F0 -> ctor 0x0045E5A0, update 0x0045AD6C, vtable
// 0x00AF7A60; battle row 56). See combat/darkfalzcommon.ts for the sources and
// the sync; the table is 0x009A6520 (stride 0x14: name, animation id, enter,
// lead, all).
//
// Packed action (VoloptExecuteMegidAttack's neighbours, SetVoloptEntityFlags
// 0x0045B64C / 0x0045E338):
//   bits 0-4 the new state (at most 0x10)   bits 5-9 the position it leaves
//   bits 10-14 the position it goes to   bits 15-18 the old facing   bits 19-22
//   the new facing   bits 23-26 / 27-30 the player it aims at / holds (0xF none)
// Positions 0..15 are the ring of 100 about (10000, -10, 0) (x = cx - 100 sin,
// z = cz + 100 cos of the slot angle slot << 12), 0x10 the middle on the ground
// and 0x11 the same 300 up where it cannot be hit.
//
// States: 0 APPEAR (147), 1 WAITNEXT, 2 WAITKILL, 3 DEAD (49), 4..8 CUT..CUT5
// (49: the dash and the slash; each hands on to the one below, CUT to BURA),
// 9 GOUP (49), 10 GODOWN (49), 11 HORMING (196: homing bolts), 12 LMAGIC (147:
// a technique on every player), 13 DMAGIC (98: Megid on every player), 14
// CAPTURE (98: takes a player, below half HP), 15 BURA (147: glides round with the
// prisoner), 16 LIBERA (98: lets go). While it holds a player every point of
// damage it takes also hurts that player (VoloptForm7ContextOnPlayerHit).
//
// The homing bolts' flight is read from the exe (BOLT below, DEVLOG 2026-10-31).
// ASSUMED (neither the dump nor the JP C has it): what LMAGIC's technique object
// (0x006E6BF4, a list technique) is (Gizonde here), and the hit sphere.

import { EnemyShot, type ShotEffect, type ShotLook } from './enemyshots.ts';
import type { AiTarget } from './enemyai.ts';
import {
  BAMS,
  DF_ID,
  DfAnim,
  DfEntity,
  STALL_TICKS,
  angDiff,
  cosB,
  ease,
  norm16,
  sinB,
  type DfAnimRow,
  type DfFight,
  type Vec3,
} from './darkfalzcommon.ts';
import { FALZ3_DEFAULT_COLOR, fadeColor, falz3Icons, falz3TargetColor, type Icon } from '../classic/minimap.ts';

// Animation table 0x009A6440 (stride 0x14: mode, next, body, wing, wing 1).
export const F3_ANIM_ROWS: readonly (DfAnimRow & { readonly motions: readonly number[] })[] = [
  { mode: 0, next: 0, motions: [84, 85, 83] }, // 0 idle
  { mode: 0, next: 0, motions: [53, 54, 52] }, // 1 rise
  { mode: 0, next: 0, motions: [56, 57, 55] }, // 2 descend
  { mode: 2, next: 0, motions: [65, 66, 64] }, // 3 left slash
  { mode: 2, next: 0, motions: [73, 74, 72] }, // 4 right slash
  { mode: 2, next: 0, motions: [89, 85, 83] }, // 5 grab
  { mode: 2, next: 0, motions: [59, 60, 58] }, // 6 laser
  { mode: 2, next: 0, motions: [37, 85, 83] }, // 7 dark magic
  { mode: 2, next: 0, motions: [15, 16, 14] }, // 8 hurt
  { mode: 1, next: 0, motions: [22, 85, 83] }, // 9 dead (holds)
];

export const F3 = {
  appear: 0,
  waitNext: 1,
  waitKill: 2,
  dead: 3,
  cut: 4,
  cut5: 8,
  goUp: 9,
  goDown: 10,
  homing: 11,
  lMagic: 12,
  dMagic: 13,
  capture: 14,
  bura: 15,
  libera: 16,
  // Animation id of each state (column +4).
  stateAnim: [0, 0, -1, 9, 3, 4, 3, 4, 3, 1, 2, 0, 0, 7, 0, 0, 0] as readonly number[],
  // Waits (static init 0x0045E7B0.. [0xA45928] ...).
  frames: [147, 0, 0, 49, 49, 49, 49, 49, 49, 49, 49, 196, 147, 98, 98, 147, 98] as readonly number[],
  // The ring and the two special spots.
  middle: 0x10,
  above: 0x11,
  cx: 10000,
  cz: 0,
  ringY: -10,
  aboveY: 300,
  ring: 100,
  // CUT: the dash takes 7 frames (t = 1 - (timer - 42) / 7), the slash is made at
  // timer 40; the 6 sectors of 0x71C.
  cutDash: 42,
  cutSlash: 40,
  sectors: 6,
  sector: 0x71c,
  // BURA: the glide takes 75 frames and ends at timer 72.
  buraGlide: 72,
  buraSpan: 75,
  // HORMING: the first volley at timer 117, then every 66 / n, two bolts each;
  // n = row 56 iparam3 (1..8 else 4).
  homingFirst: 117,
  homingSpan: 66,
  // LMAGIC fires at timer 69, DMAGIC's Megid at 70, CAPTURE shows at 49 and holds
  // at 33, LIBERA lets go at 49.
  lMagicFire: 69,
  dMagicFire: 70,
  captureShow: 49,
  captureHold: 33,
  liberaFree: 49,
  turn: 0x888, // BAMS a tick the body turns (ClampAngleDifference)
  animStep: 1, // ASSUMED: +0x3dc was set by 0x0045B4B4's neighbours, not traced
  hitRadius: 40, // ASSUMED
  // After this many BURA glides (5, or from 2 on half the time) it goes up.
  buraMax: 5,
  buraMore: 0.5,
} as const;

// The homing bolt of HORMING (PsoBB.exe, Ephinea 1.25.13): the constructor
// 0x00453030 (0x388 bytes, vtable 0x00AF72C0), the update 0x00452BCC and the
// steering modes at +0x370: 0 = 0x00452FD0 (climb to the target's height),
// 1 = 0x00452E88 (turn toward the target), 2 = 0x00452E50 (cruise; Ultimate
// re-steers). Helpers: 0x0082DF08 normalises (only above length 0), 0x00836208
// is the distance (0 below 0.158), 0x007714CC is the hit search. The constants
// are the floats at the addresses in the comments.
export const BOLT = {
  // +0x35c (0x40c00000): the unit velocity is scaled by this every tick.
  speed: 6,
  // +0x340 (0x96), 0x12c in Ultimate (g_CurrentDifficulty 0x00a9cd68 == 3).
  // The counter drops one a tick without a hit; the bolt is removed below 0.
  lifeNormal: 150,
  lifeUltimate: 300,
  // The constructor's velocity when the target is found (it is: the
  // not-found branch reads [0 + 0x38]): heading 0, (0, -6, 1.2) / sqrt(1.08)
  // (0x008ffaa0 -6.0, 0x008ffaa4 1.2; 1.08 = 0x3f8a3d71).
  startY: -6 / Math.sqrt(1.08),
  startZ: 1.2 / Math.sqrt(1.08),
  // Mode 0: vy moves 0.05 a tick toward the target's height (0x008ffa0c)
  // until |dy| is below 50 (0x008ffa08); then mode 1.
  climbStep: 0.05,
  climbDone: 50,
  // Mode 1: v = k v + (1 - k) T, v and T unit, T = target - bolt, k = 0.8 - 0.3 f
  // (0x008ffa04, 0x008ffaec), f = row 56 fparam1 (0.5 outside 0..1). The bolt
  // dies when |T| or |v| is 0.01 or less (0x008ffaf0). Mode 2 once the distance
  // is within 60 - 50 f (0x008ffa20, 0x008ffa90) and the step settled
  // (0x008ffae4).
  steerBase: 0.8,
  steerSlope: -0.3,
  reachFar: 60,
  reachSlope: -50,
  arrive: 0.01,
  settle: 0.001,
  // Mode 2 in Ultimate: back to mode 1 while life > 119 (0x77) and the distance
  // is above 2.5 x the reach (0x008ffa00).
  ultimateLifeMin: 119,
  ultimateRehome: 2.5,
  // The hit search: the nearest living player whose XZ distance from the bolt
  // is below 7.5 (0x40f00000), no player radius added.
  radius: 7.5,
} as const;

// FUN_00836208: 0 when the squared distance is below 0.025.
function exeDistance(a: readonly number[], b: readonly number[]): number {
  const s = (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]);
  return s < 0.025 ? 0 : Math.sqrt(s);
}

// v / |v| when |v| is above 0 (FUN_0082df08).
function unit(v: readonly number[]): number[] {
  const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return n > 0 ? [v[0] / n, v[1] / n, v[2] / n] : [v[0], v[1], v[2]];
}

// What the bolt reads from its shooter.
export interface BoltTune {
  f1: number; // row 56 fparam1 (+0x36c)
  power: number; // row 56 iparam5 (+0x28): the hit's power, passed raw
  ultimate: boolean; // g_CurrentDifficulty == 3
  // Form 3 can hit: DAT_00a44d5c's state (+0x37c) is neither WAITKILL (2) nor
  // DEAD (3) (0x0044d05c, ASSUMED to be the shooting form). A bolt that finds a
  // player is removed either way.
  shooterLive(): boolean;
}

// The homing bolt of HORMING. ASSUMED: the spawn point (the constructor's
// position argument is a pointer the caller passes, not traced here); the wall
// test of the hit search (0x00780d3c) is not applied; the freeze of
// 0x0067e408 (a same-room player in state 2) is not applied.
export class HomingBolt extends EnemyShot {
  override readonly absolute = true;
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xb060ff, size: 2.5 };
  // The velocity (+0x350..+0x358).
  private readonly v: number[] = [0, BOLT.startY, BOLT.startZ];
  private mode = 0;
  private life: number;
  private readonly target: number;
  private readonly tune: BoltTune;
  private readonly k: number;
  private readonly reach: number;
  constructor(x: number, y: number, z: number, target: number, tune: BoltTune) {
    super(x, y, z);
    this.target = target;
    this.tune = tune;
    const f = tune.f1 < 0 || tune.f1 > 1 ? 0.5 : tune.f1;
    this.k = BOLT.steerBase + BOLT.steerSlope * f;
    this.reach = BOLT.reachFar + BOLT.reachSlope * f;
    this.life = tune.ultimate ? BOLT.lifeUltimate : BOLT.lifeNormal;
    this.effect = { kind: 'tech', power: tune.power };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    // The update's last branch: a target that is gone removes the bolt. A dead
    // player is still the target (the exe's entity lookup does not check it).
    const t = targets.find((p) => p.clientId === this.target);
    if (!t) {
      this.done = true;
      return [];
    }
    const ty = t.y ?? 0;
    const dist = exeDistance([this.x, this.y, this.z], [t.x, ty, t.z]);
    const v = this.v;
    let arrived = false;
    if (this.mode === 0) {
      const dy = ty - this.y;
      v[1] += dy <= 0 ? -BOLT.climbStep : BOLT.climbStep;
      if (Math.abs(dy) < BOLT.climbDone) this.mode = 1;
    } else if (this.mode === 1) {
      const T = [t.x - this.x, ty - this.y, t.z - this.z];
      if (Math.hypot(T[0], T[1], T[2]) <= BOLT.arrive || Math.hypot(v[0], v[1], v[2]) <= BOLT.arrive) {
        arrived = true;
      } else {
        const tn = unit(T);
        const vn = unit(v);
        const old = [vn[0], vn[1], vn[2]];
        for (let i = 0; i < 3; i++) v[i] = vn[i] * this.k + tn[i] * (1 - this.k);
        if (dist <= this.reach && exeDistance(v, old) <= BOLT.settle) this.mode = 2;
      }
    } else if (this.tune.ultimate && this.life > BOLT.ultimateLifeMin && BOLT.ultimateRehome * this.reach < dist) {
      this.mode = 1;
    }
    // Unit velocity, then the speed; then the move.
    const vu = unit(v);
    for (let i = 0; i < 3; i++) v[i] = vu[i] * BOLT.speed;
    this.x += v[0];
    this.y += v[1];
    this.z += v[2];
    // The hit search: the nearest living player in XZ. The bolt is removed on a
    // find whether or not the shooter can hit.
    let hit: AiTarget | null = null;
    let best = BOLT.radius * BOLT.radius;
    for (const p of targets) {
      if (p.dead) continue;
      const d2 = (p.x - this.x) * (p.x - this.x) + (p.z - this.z) * (p.z - this.z);
      if (d2 < best) {
        best = d2;
        hit = p;
      }
    }
    if (hit) {
      this.done = true;
      return this.tune.shooterLive() ? [hit] : [];
    }
    if (arrived) {
      this.done = true;
      return [];
    }
    this.life -= 1;
    if (this.life < 0) this.done = true;
    return [];
  }
}

export interface Form3Row {
  hp: number;
  atp: number; // the slash's fixed damage
  lMagic: number; // iparam1
  megid: number; // iparam2
  orbs: number; // iparam3 clamped to 1..8 else 4
  f1: number; // fparam1: the homing bolt's steering (BOLT)
  power: number; // iparam5: the homing bolt's hit power
}

// The position of a slot.
export function f3Spot(slot: number, out: Vec3): Vec3 {
  if (slot === F3.middle) {
    out[0] = F3.cx;
    out[1] = F3.ringY;
    out[2] = F3.cz;
  } else if (slot === F3.above) {
    out[0] = F3.cx;
    out[1] = F3.aboveY;
    out[2] = F3.cz;
  } else {
    out[0] = F3.cx - sinB(slot << 12) * F3.ring;
    out[1] = F3.ringY;
    out[2] = F3.cz + cosB(slot << 12) * F3.ring;
  }
  return out;
}

// The scale animation (Voloptform7updatescaleanimation0045b9b8, dump 199138): the
// body's +0x3b8 (scale) and +0x3bc (counter). In the states 2 (WAITKILL) and 3
// (DEAD) the scale climbs by 0.1 a frame to 1.0 and stops there. Otherwise the
// counter runs: below 120 the scale is 1; 120..149 it falls by 1/30 a frame to 0;
// 150..269 it is 0; 270..299 it climbs by 1/30 to 1; from 300 it is 1 and the
// counter returns to 0. The step constants are the exe's floats (0x009002BC
// 0.1, 0x009002C0 -1/30, 0x009002C4 1/30; 0x00900460 0.0, 0x00900464 1.0).
// The sound effects of its transitions (0x38C, 0x38D) are not played.
// ASSUMED: the form 3 state `st` is the exe's +0x37c (the port's F3 numbers
// match the table's: waitKill 2, dead 3).
export function advanceScale(scale: number, count: number, climbing: boolean): { scale: number; count: number } {
  if (climbing) return { scale: Math.min(scale + 0.1, 1), count };
  const n = count + 1;
  if (n < 120) return { scale: 1, count: n };
  if (n < 150) {
    const v = scale - 1 / 30;
    return v >= 0 ? { scale: v, count: n } : { scale: 0, count: n };
  }
  if (n < 270) return { scale: 0, count: n };
  if (n < 300) {
    const v = scale + 1 / 30;
    return v <= 1 ? { scale: v, count: n } : { scale: 1, count: n };
  }
  return { scale: 1, count: 0 };
}

export class DfForm3 extends DfEntity {
  st: number = F3.appear;
  timer = 0;
  readonly anim = new DfAnim(F3_ANIM_ROWS, F3.animStep);
  from: number = F3.middle; // +0x3ac
  to: number = F3.middle; // +0x3a8
  oldFace = 0; // +0x3b4
  face = 0; // +0x3b0
  aim = -1; // +0x3c0
  held = -1; // +0x3c2: the prisoner
  t = 0; // +0x3a4
  yaw = 0; // BAMS
  hops = 0; // +0x3c4
  readonly threshold: number;
  readonly row: Form3Row;
  awake = true;
  private readonly fight: DfFight;
  private lastHp: number;
  private readonly a: Vec3 = [0, 0, 0];
  private readonly b: Vec3 = [0, 0, 0];
  private slashStart = 0;
  private slashStep = 0;
  private slashLeft = 0;

  constructor(fight: DfFight, row: Form3Row, x: number, z: number) {
    super(DF_ID.form3, row.hp);
    this.fight = fight;
    this.row = row;
    this.threshold = Math.trunc(row.hp / 2);
    this.lastHp = row.hp;
    this.x = x;
    this.z = z;
    this.y = F3.ringY;
    this.enter(F3.appear);
  }

  // Above the ring it cannot be hit (the collision flag is cleared at slot 0x11).
  get targetable(): boolean {
    return this.awake && this.to !== F3.above && this.st !== F3.dead && this.st !== F3.waitKill;
  }

  // How many states were entered (a re-entry of the same state counts).
  entries = 0;

  private enter(st: number): void {
    this.entries++;
    this.st = st;
    const a = F3.stateAnim[st];
    if (a !== undefined && a !== -1) this.anim.set(a);
    this.timer = F3.frames[st] ?? 0;
    switch (st) {
      case F3.goUp:
        this.oldFace = this.face;
        this.from = this.to;
        this.to = F3.above;
        break;
      case F3.goDown:
        this.oldFace = this.face;
        this.from = F3.above;
        this.to = F3.middle;
        break;
      case F3.homing:
      case F3.lMagic:
      case F3.dMagic:
        this.oldFace = this.face;
        this.from = F3.above;
        this.to = F3.above;
        break;
      case F3.cut:
      case F3.cut + 1:
      case F3.cut + 2:
      case F3.cut + 3:
      case F3.cut5:
        this.anim.set(3 + ((st - F3.cut) & 1));
        break;
      case F3.libera:
        break;
      default:
        break;
    }
  }

  // --- packets -----------------------------------------------------------------

  static pack(st: number, from: number, to: number, oldFace: number, face: number, aim: number, held: number): number {
    return (
      ((st & 0x1f) | ((from & 0x1f) << 5) | ((to & 0x1f) << 10) | ((oldFace & 0xf) << 15) | ((face & 0xf) << 19) | ((aim & 0xf) << 23) | ((held & 0xf) << 27)) >>> 0
    );
  }

  receive(packed: number): void {
    this.from = (packed >> 5) & 0x1f;
    this.to = (packed >> 10) & 0x1f;
    this.oldFace = (packed >> 15) & 0xf;
    this.face = (packed >> 19) & 0xf;
    const aim = (packed >> 23) & 0xf;
    this.aim = aim === 0xf ? -1 : aim;
    const held = (packed >> 27) & 0xf;
    this.held = held === 0xf ? -1 : held;
    const st = packed & 0x1f;
    if (st > 0x10) return;
    this.enter(st);
  }

  private send(st: number, to: number, face: number): void {
    this.fight.send(0xffff, DfForm3.pack(st, this.to, to, this.face, face, this.aim < 0 ? 0xf : this.aim, this.held < 0 ? 0xf : this.held));
  }

  // --- the leader's decisions ---------------------------------------------------

  // 0x0045E284: the slot angle (+0x800 >> 12) of a random alive player about
  // the middle, or a random slot.
  private dirToward(): number {
    const f = this.fight;
    const id = f.randomAlive();
    const p = id === 0xffff ? null : f.playerPos(id);
    if (!p) return Math.trunc(f.random() * 15.84) & 0xf;
    const a = Math.round(Math.atan2(-(p.x - F3.cx), p.z - F3.cz) / BAMS);
    return ((a + 0x800) >> 12) & 0xf;
  }

  // The chain of slashes: CUT..CUT3 start it (4 + trunc(rand * 2.97)).
  private startCuts(): void {
    const dir = this.dirToward();
    this.send(F3.cut + Math.trunc(this.fight.random() * 2.97), dir, dir);
  }

  // 0x0045C3F0: a glide to a random slot.
  private glide(): void {
    const slot = Math.trunc(this.fight.random() * 15.99);
    this.send(F3.bura, slot, slot);
  }

  private lead(): void {
    const f = this.fight;
    switch (this.st) {
      case F3.appear:
        if (this.timer === 0) this.startCuts();
        break;
      case F3.waitNext:
        if (this.hp <= 0 || this.dead) {
          this.fight.send(0xffff, DfForm3.pack(F3.waitKill, this.to, this.to, this.face, this.face, this.aim < 0 ? 0xf : this.aim, this.held < 0 ? 0xf : this.held));
        } else {
          this.aim = -1;
          this.held = -1;
          this.send(F3.goDown, this.to, this.face);
        }
        break;
      case F3.cut:
      case F3.cut + 1:
      case F3.cut + 2:
      case F3.cut + 3:
      case F3.cut5:
        if (this.timer === 0) {
          if (this.st === F3.cut) {
            this.hops = 0;
            this.glide();
          } else {
            const slot = Math.trunc(f.random() * 15.84);
            this.send(this.st - 1, slot, slot);
          }
        }
        break;
      case F3.goUp:
        if (this.timer === 0) {
          if (this.held >= 0) this.send(F3.dMagic, this.to, this.face);
          else {
            const who = f.randomAlive();
            if (who !== 0xffff) {
              this.aim = who;
              this.send(F3.homing, this.to, this.face);
            } else this.send(F3.lMagic, this.to, this.face);
          }
        }
        break;
      case F3.goDown:
        if (this.timer === 0) {
          if (this.held >= 0) this.send(F3.libera, this.to, this.face);
          else {
            const who = f.randomAlive();
            if (this.hp <= this.threshold && who !== 0xffff) {
              this.aim = who;
              this.send(F3.capture, this.to, this.face);
            } else this.startCuts();
          }
        }
        break;
      case F3.homing:
        if (this.timer === 0) {
          this.aim = -1;
          this.send(F3.lMagic, this.to, this.face);
        }
        break;
      case F3.lMagic:
        if (this.timer === 0) this.send(F3.goDown, this.to, this.face);
        break;
      case F3.dMagic:
        if (this.timer === 0) this.send(F3.lMagic, this.to, this.face);
        break;
      case F3.capture:
        if (this.timer === 0) {
          if (this.aim >= 0 && f.alive().some((p) => p.clientId === this.aim)) {
            this.held = this.aim;
            this.aim = -1;
            f.events.push({ kind: 'se', id: 0x389 });
            this.hops = 0;
            this.glide();
          } else {
            this.aim = -1;
            this.held = -1;
            this.startCuts();
          }
        }
        break;
      case F3.bura:
        if (this.held >= 0 && !f.alive().some((p) => p.clientId === this.held)) {
          this.aim = -1;
          this.held = -1;
        }
        if (this.timer === 0) {
          this.hops++;
          if (this.hops < F3.buraMax && (this.hops < 2 || f.random() >= F3.buraMore)) this.glide();
          else this.send(F3.goUp, this.to, this.face);
        }
        break;
      case F3.libera:
        // 0x0045E1A4: a prisoner who is gone is no reason to wait.
        if (this.held < 0 || this.timer === 0) {
          this.aim = -1;
          this.held = -1;
          this.startCuts();
        }
        break;
      default:
        break;
    }
  }

  // --- the frame ----------------------------------------------------------------

  // The minimap body's colour (dark_falz_form3_minimap_icons, +0x3cc), faded once a frame.
  minimapColour: number = FALZ3_DEFAULT_COLOR;
  // The frame counter of the minimap (+0x3c8, stepped once a frame): bit 2 makes
  // the body white while the scale is 0, bit 0 clear draws the trail.
  private minimapFrame = 0;
  private minimapWhite = false;
  private minimapTrail = true;
  // +0x3b8 (scale, ctor 1.0) and +0x3bc (its counter, ctor 0), advanced by advanceScale.
  scale = 1;
  private scaleCount = 0;

  // The icons of the body and the prisoner trail (render/combat.ts draws them).
  minimapIcons(): Icon[] {
    const held = this.held;
    const p = held >= 0 ? this.fight.alive().find((q) => q.clientId === held) : undefined;
    return falz3Icons({ x: this.x, z: this.z }, this.minimapColour, held, p ?? null, this.minimapWhite, this.minimapTrail);
  }

  tick(): void {
    const target = falz3TargetColor(this.held);
    if (target !== null) this.minimapColour = fadeColor(this.minimapColour, target);
    // dark_falz_form3_minimap_icons reads the scale before this frame's animation
    // and the counter before it steps (dump 199061, 199064, 199070, 199130).
    this.minimapWhite = this.scale === 0 && (this.minimapFrame & 4) !== 0;
    this.minimapTrail = (this.minimapFrame & 1) === 0;
    this.minimapFrame += 1;
    const next = advanceScale(this.scale, this.scaleCount, this.st === F3.waitKill || this.st === F3.dead);
    this.scale = next.scale;
    this.scaleCount = next.count;
    const f = this.fight;
    // A prisoner that left or died is let go.
    if (this.held >= 0 && !f.alive().some((p) => p.clientId === this.held)) {
      this.held = -1;
      this.aim = -1;
    }
    if (f.leader() || this.stalled(this.st === F3.waitNext)) this.lead();
    this.all();
    this.anim.tick();
    this.captureShield();
    this.sweep();
    this.trackPose();
    if (this.hp <= 0 && !this.dead) this.die();
  }

  private stall = 0;
  private stalled(waiting: boolean): boolean {
    if (!waiting) {
      this.stall = 0;
      return false;
    }
    if (++this.stall < STALL_TICKS) return false;
    this.stall = 0;
    return true;
  }

  die(): void {
    this.dead = true;
    if (this.st === F3.dead || this.st === F3.waitKill) return;
    this.enter(F3.dead);
    this.fight.events.push({ kind: 'died', entity: this.entity });
  }

  // 0x0045AD6C: while it holds a player, the damage it takes is dealt to the
  // player as well (VoloptForm7ContextOnPlayerHit with the HP it lost).
  private captureShield(): void {
    if (this.held >= 0 && this.st !== F3.waitKill && this.st !== F3.dead && this.hp < this.lastHp) {
      this.fight.events.push({ kind: 'hit', clientId: this.held, power: this.lastHp - this.hp, fixed: true, x: this.x, z: this.z, what: 'Dark Falz holding you' });
    }
    this.lastHp = this.hp;
  }

  // The pose between two slots.
  private glideTo(t: number): void {
    f3Spot(this.from, this.a);
    f3Spot(this.to, this.b);
    this.x = this.a[0] + (this.b[0] - this.a[0]) * t;
    this.y = this.a[1] + (this.b[1] - this.a[1]) * t;
    this.z = this.a[2] + (this.b[2] - this.a[2]) * t;
    const want = norm16(-((this.oldFace << 12) + Math.round(angDiff(this.oldFace << 12, this.face << 12) * t)));
    const d = angDiff(this.yaw, want);
    this.yaw = norm16(this.yaw + Math.max(-F3.turn, Math.min(F3.turn, d)));
  }

  // Turn toward the player (0x0045D46C) and keep the facing slot in step.
  private faceTarget(id: number): void {
    const p = id < 0 ? null : this.fight.playerPos(id);
    if (!p) return;
    const want = norm16(Math.round(Math.atan2(p.x - F3.cx, p.z - F3.cz) / BAMS));
    const d = angDiff(this.yaw, want);
    this.yaw = norm16(this.yaw + Math.max(-F3.turn, Math.min(F3.turn, d)));
    const slot = ((-this.yaw - 0x800) >> 12) & 0xf;
    this.face = slot;
    this.oldFace = slot;
  }

  private all(): void {
    const f = this.fight;
    switch (this.st) {
      case F3.appear:
        this.glideTo(0);
        if (--this.timer < 0) this.enter(F3.waitNext);
        break;
      case F3.dead:
        if (--this.timer < 0) this.enter(F3.waitKill);
        break;
      case F3.cut:
      case F3.cut + 1:
      case F3.cut + 2:
      case F3.cut + 3:
      case F3.cut5: {
        // 0x0045C48C: the dash, then the slash at timer 40.
        this.t = this.timer > F3.cutDash ? 1 - (this.timer - F3.cutDash) / 7 : 1;
        this.glideTo(this.t);
        if (this.timer === F3.cutSlash) {
          this.startSlash(this.face, (this.st - F3.cut) & 1);
          f.events.push({ kind: 'se', id: 0x385 });
        }
        if (--this.timer < 0) this.enter(F3.waitNext);
        break;
      }
      case F3.goUp:
      case F3.goDown: {
        this.t = ease(1 - this.timer / 49);
        this.glideTo(this.t);
        if (--this.timer < 0) this.enter(F3.waitNext);
        break;
      }
      case F3.homing: {
        if (this.aim >= 0) this.faceTarget(this.aim);
        const n = this.row.orbs;
        const step = Math.max(1, Math.trunc(F3.homingSpan / n));
        for (let i = 0, at = F3.homingFirst; i < n; i++, at += step) {
          if (this.timer === at) this.volley();
        }
        if (--this.timer < 0) this.enter(F3.waitNext);
        break;
      }
      case F3.lMagic:
        if (this.timer === F3.lMagicFire) {
          for (const p of f.alive()) {
            f.events.push({ kind: 'tech', clientId: p.clientId, tech: 'gizonde', level: this.row.lMagic, x: p.x, z: p.z, what: 'Dark Falz lightning' });
          }
          f.events.push({ kind: 'se', id: 0x133 });
        }
        if (--this.timer < 0) this.enter(F3.waitNext);
        break;
      case F3.dMagic:
        if (this.timer === F3.dMagicFire) {
          for (const p of f.alive()) f.events.push({ kind: 'megid', clientId: p.clientId, level: this.row.megid, what: 'Dark Falz Megid' });
        }
        if (--this.timer < 0) this.enter(F3.waitNext);
        break;
      case F3.capture:
        if (this.aim >= 0) this.faceTarget(this.aim);
        if (this.timer === F3.captureShow) f.events.push({ kind: 'se', id: 0x38b });
        if (--this.timer < 0) this.enter(F3.waitNext);
        break;
      case F3.bura: {
        // 0x0045DEB8: the glide round the ring (75 frames), then it waits out the rest.
        const t0 = this.timer > F3.buraGlide ? 1 - (this.timer - F3.buraGlide) / F3.buraSpan : 1;
        this.t = ease(t0);
        this.glideTo(this.t);
        if (--this.timer < 0) this.enter(F3.waitNext);
        break;
      }
      case F3.libera:
        if (this.held >= 0) this.faceTarget(this.held);
        if (this.timer === F3.liberaFree) {
          this.held = -1;
          this.aim = -1;
        }
        if (--this.timer < 0) this.enter(F3.waitNext);
        break;
      default:
        break;
    }
  }

  // 0x0045C860 / 0x0045C8D8 and the object's update 0x0045AB68: six sectors of
  // 0x71C swept over six ticks; a player whose angle about the middle is in the
  // current one takes the row's ATP as fixed damage.
  private startSlash(face: number, parity: number): void {
    const base = face << 12;
    this.slashStep = parity === 0 ? F3.sector : -F3.sector;
    this.slashStart = parity === 0 ? base - 0x1554 : base + 0xe38;
    this.slashLeft = F3.sectors;
  }

  private sweep(): void {
    if (this.slashLeft <= 0) return;
    const lo = norm16(this.slashStart);
    for (const p of this.fight.alive()) {
      const a = norm16(Math.round(Math.atan2(-(p.x - F3.cx), p.z - F3.cz) / BAMS));
      if (((a - lo) & 0xffff) < F3.sector) {
        this.fight.events.push({ kind: 'hit', clientId: p.clientId, power: this.row.atp, fixed: true, x: this.x, z: this.z, what: 'Dark Falz slash' });
      }
    }
    this.slashStart += this.slashStep;
    this.slashLeft--;
  }

  // Two bolts from the hands at the aimed player.
  // The exe's volley (0x0045D2FA): the SE 0x386 and two bolts, each with the
  // same target. The bolts' spawn points are ASSUMED (see HomingBolt).
  private volley(): void {
    const f = this.fight;
    f.events.push({ kind: 'se', id: 0x386 });
    if (this.aim < 0) return;
    const p = f.playerPos(this.aim);
    if (!p) return;
    const angle = Math.atan2(p.x - this.x, p.z - this.z);
    const tune: BoltTune = {
      f1: this.row.f1,
      power: this.row.power,
      ultimate: f.ultimate,
      shooterLive: () => this.st !== F3.waitKill && this.st !== F3.dead,
    };
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -0.6 : 0.6;
      f.shoot(new HomingBolt(this.x + Math.sin(angle + side) * 20, 40, this.z + Math.cos(angle + side) * 20, this.aim, tune));
    }
  }

  // The point a strike reaches (the body).
  reach(out: Vec3): void {
    out[0] = this.x;
    out[1] = this.y;
    out[2] = this.z;
  }
}

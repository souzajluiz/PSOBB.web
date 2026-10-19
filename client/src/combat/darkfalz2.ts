// Dark Falz form 2 (PsoBB.exe, Ephinea 1.25.13): the serpent that circles the
// arena below the floor (create 0x00457E7C, ctor 0x00457E7C+, update
// 0x00457BD4, vtable 0x00AF77E0; battle row 55). See combat/darkfalzcommon.ts
// for the sources and the sync, combat/darkfalz1.ts for the shape of the state
// machine; the table is 0x009A6280 (stride 0x14: name, animation id, enter,
// lead, all).
//
// Packed action (SendVoloptForm7HazardGridUpdate 0x0045846C /
// InitializeVoloptForm7Hazard 0x00458018):
//   bits 0-3 the new state (at most 0xD)   bits 4-7 the slot it leaves (angle
//   >> 12)   bits 8-11 the slot it goes to   bits 12-15 / 16-19 the grid cell
//   of the target (+0x3b4 / +0x3b8)   bits 20-23 a player (0xF = none).
// The body hangs at angle `a` on a circle (x = sin(a) * R, z = -cos(a) * R,
// y = Y) with R 300 and Y -50, going out to 330 / -95 while it fires.
//
// States: 0 APPEAR (60), 1 WAITNEXT, 2 WAITKILL, 3 DEAD (75), 4 MOVE, 5 JISIN
// (the quake, 75, goes on to TENCHU), 6 / 7 BEAM_L / BEAM_R (150), 8 TENCHU
// (150), 9..12 MD_STOP1..4 (the pauses: 75 / 150 / 225 / 300), 13 MD_RECOVER
// (150, ends in the enemy Resta).
//
// ASSUMED (neither the dump nor the JP C has it): the beam's path (the ball
// positions are the zigzag of +-20 about a point that runs round the circle of
// radius 100 at 50 a ball; the exe's steering of it was read only in part),
// the reach of the technique objects, what MD_RECOVER's drain does to the
// player (nothing here) and the single hit sphere.

import {
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
import { F1, pickWeighted } from './darkfalz1.ts';
import { TECH, techPower } from './techniques.ts';

// Animation table 0x009A61E0 (stride 0x10: mode, next, body motion, base motion).
export const F2_ANIM_ROWS: readonly (DfAnimRow & { readonly motions: readonly number[] })[] = [
  { mode: 0, next: 0, motions: [82, 81] }, // 0 idle
  { mode: 2, next: 0, motions: [13, 12] }, // 1
  { mode: 1, next: 0, motions: [21, 20] }, // 2 dead (holds)
  { mode: 2, next: 5, motions: [49, 48] }, // 3 recover
  { mode: 2, next: 0, motions: [51, 50] }, // 4 quake
  { mode: 2, next: 0, motions: [63, 62] }, // 5
  { mode: 2, next: 0, motions: [3, 2] }, // 6 beam L
  { mode: 2, next: 0, motions: [7, 6] }, // 7 beam R
  { mode: 2, next: 9, motions: [82, 68] }, // 8 tenchu
  { mode: 2, next: 0, motions: [82, 62] }, // 9
];

export const F2 = {
  appear: 0,
  waitNext: 1,
  waitKill: 2,
  dead: 3,
  move: 4,
  jisin: 5,
  beamL: 6,
  beamR: 7,
  tenchu: 8,
  stop1: 9,
  stop4: 12,
  recover: 13,
  // Animation id of each state (column +4); BEAM picks 6 / 7 itself.
  stateAnim: [0, 0, -1, 2, 0, 4, 0, 0, 8, 0, 0, 0, 0, 3] as readonly number[],
  appearFrames: 60,
  deadFrames: 75,
  jisinFrames: 75,
  jisinShake: 30,
  beamFrames: 150,
  beamAnim: 75, // the beam's animation starts at timer 75
  beamFire: 38, // the first ball at timer 38, then every second tick down to 4
  beamLast: 4,
  beamStep: 50,
  beamSide: 20,
  beamRing: 100,
  tenchuFrames: 150,
  stopFrames: [75, 150, 225, 300] as readonly number[],
  recoverFrames: 150,
  recoverDrain: 70,
  // The circle.
  radius: 300,
  height: -50,
  radiusOut: 330,
  heightOut: -95,
  // Blend of the outward move: ramps over the first 15 frames of 150, holds,
  // and back over the last 15 (0x003A8 = (150 - t) / 15 ...).
  blendFrames: 15,
  animStep: 0.7, // ASSUMED: +0x3dc was not traced
  hitRadius: 40, // ASSUMED
  // The leader's odds.
  moveAgainChance: 0.1,
  stopChance: 0.1,
  moveAfterStop: 0.25, // 1 - 0.75 (0x00900118)
  maxMoves: 3,
  attackFar: 560, // the player a beam aims at must be within this ([0xA457AC])
  // Weights (0x009A61A8 / 0x009A61C0).
  weightsHigh: [0.4, 0.3, 0.3] as readonly number[],
  valuesHigh: [5, 6, 7] as readonly number[],
  weightsLow: [0.3, 0.25, 0.25, 0.2] as readonly number[],
  valuesLow: [5, 6, 7, 13] as readonly number[],
} as const;

export interface Form2Row {
  hp: number;
  atp: number;
  moveFrames: number; // clamp(round(fparam1), 1..25 else 4) * 30
  stopState: number; // 8 + clamp(iparam1, 1..4 else 1): the state after a beam / the quake
  restaLevel: number; // iparam2 when 0..14, else 0
  // Row 54: the beams' technique levels and TENCHU's fixed damage.
  rafoie: number;
  rabarta: number;
  tenchu: number;
}

export class DfForm2 extends DfEntity {
  st: number = F2.appear;
  timer = 0;
  readonly anim = new DfAnim(F2_ANIM_ROWS, F2.animStep);
  angle = 0; // +0x3a8, BAMS
  fromAngle = 0; // +0x3ac
  toAngle = 0; // +0x3b0
  gx = 0;
  gz = 0;
  who = -1; // +0x3cc
  moves = 0; // +0x3e8
  blend = 0; // +0x3f0
  t = 0; // +0x3a4
  yaw = 0;
  readonly threshold: number;
  readonly row: Form2Row;
  awake = true;
  private readonly fight: DfFight;
  private readonly target: Vec3 = [0, 0, 0];
  // The beam's running point and the side it throws the next ball to.
  private beamX = 0;
  private beamZ = 0;
  private beamSide = 1;
  private beamSign = 1;
  private beamDone = false;
  private readonly marks: Vec3[] = [];
  private markCount = 0;
  private marksShown = false;
  readonly balls: { x: number; z: number; rabarta: boolean }[] = [];
  ballCount = 0;

  constructor(fight: DfFight, row: Form2Row) {
    super(DF_ID.form2, row.hp);
    this.fight = fight;
    this.row = row;
    this.threshold = Math.trunc(row.hp / 2);
    for (let i = 0; i < F1.marks; i++) this.marks.push([0, 0, 0]);
    this.place();
    this.enter(F2.appear);
  }

  get targetable(): boolean {
    return this.awake && this.st !== F2.dead && this.st !== F2.waitKill;
  }

  // 0x004587D4: the pose from the angle and the outward blend.
  private place(): void {
    const b = this.blend > 0 ? ease(Math.min(1, this.blend)) : 0;
    const r = F2.radius + (F2.radiusOut - F2.radius) * b;
    this.y = F2.height + (F2.heightOut - F2.height) * b;
    this.x = sinB(this.angle) * r;
    this.z = -r * cosB(this.angle);
    this.yaw = norm16(-this.angle);
  }

  // How many states were entered (a re-entry of the same state counts).
  entries = 0;

  private enter(st: number): void {
    this.entries++;
    this.st = st;
    if (st !== F2.move) this.moves = 0;
    const a = F2.stateAnim[st];
    if (a !== undefined && a !== -1) this.anim.set(a);
    this.marksShown = false;
    this.blend = 0;
    switch (st) {
      case F2.appear:
        this.anim.frame = 0;
        this.timer = F2.appearFrames;
        break;
      case F2.dead:
        this.timer = F2.deadFrames;
        break;
      case F2.move:
        this.timer = this.row.moveFrames;
        this.anim.frame = 0;
        this.moves++;
        break;
      case F2.jisin:
        this.timer = F2.jisinFrames;
        this.anim.frame = 0;
        break;
      case F2.beamL:
      case F2.beamR: {
        // 0x0045A792: aim at the target cell; the ball point starts 100 out
        // toward the body, and the side flips every ball.
        this.anim.frame = 0;
        this.timer = F2.beamFrames;
        this.beamDone = false;
        this.beamSign = st === F2.beamL ? 1 : -1;
        const len = Math.hypot(this.x, this.z) || 1;
        this.beamX = (this.x / len) * F2.beamRing;
        this.beamZ = (this.z / len) * F2.beamRing;
        this.beamSide = 1;
        break;
      }
      case F2.tenchu:
        this.anim.frame = 0;
        this.timer = F2.tenchuFrames;
        this.makeMarks();
        break;
      case F2.recover:
        this.anim.frame = 0;
        this.timer = F2.recoverFrames;
        break;
      default:
        if (st >= F2.stop1 && st <= F2.stop4) {
          this.timer = F2.stopFrames[st - F2.stop1];
          this.anim.frame = 0;
        }
        break;
    }
  }

  // --- packets -----------------------------------------------------------------

  static pack(st: number, fromSlot: number, toSlot: number, gx: number, gz: number, who: number): number {
    return ((st & 0xf) | ((fromSlot & 0xf) << 4) | ((toSlot & 0xf) << 8) | ((gx & 0xf) << 12) | ((gz & 0xf) << 16) | ((who & 0xf) << 20)) >>> 0;
  }

  receive(packed: number): void {
    const from = ((packed >> 4) & 0xf) << 12;
    this.fromAngle = from;
    this.angle = from;
    this.toAngle = ((packed >> 8) & 0xf) << 12;
    this.gx = (packed >> 12) & 0xf;
    this.gz = (packed >> 16) & 0xf;
    const w = (packed >> 20) & 0xf;
    this.who = w === 0xf ? -1 : w;
    this.target[0] = (this.gx + 0.5) * F1.cell - F1.half;
    this.target[2] = (this.gz + 0.5) * F1.cell - F1.half;
    this.place();
    const st = packed & 0xf;
    if (st > 0xd) return;
    this.enter(st);
  }

  private slot(): number {
    return (this.angle >> 12) & 0xf;
  }

  private send(st: number, toSlot = this.slot(), gx = this.gx, gz = this.gz, who = this.who): void {
    this.fight.send(0xffff, DfForm2.pack(st, this.slot(), toSlot, gx, gz, who < 0 ? 0xf : who));
  }

  // --- the leader's decisions ---------------------------------------------------

  // 0x0045A3D4 / 0x0045A64C: ...
  private chooseMove(): void {
    const f = this.fight;
    const to = ((this.angle + Math.round(f.random() * 49152) + 0x2000) >> 12) & 0xf;
    this.send(F2.move, to);
  }

  // 0x0045A140: the attack by the odds; a beam aims at the farthest player within
  // 560 or at a random point.
  private chooseAttack(): void {
    const f = this.fight;
    const who = f.randomAlive();
    const low = this.hp <= this.threshold && who !== 0xffff;
    const st = low ? pickWeighted(f, F2.valuesLow, F2.weightsLow) : pickWeighted(f, F2.valuesHigh, F2.weightsHigh);
    if (st === F2.recover) {
      this.send(F2.recover, this.slot(), this.gx, this.gz, who);
      return;
    }
    if (st === F2.beamL || st === F2.beamR) {
      let bx = 0;
      let bz = 0;
      let bd = 0;
      let found = false;
      for (const p of f.alive()) {
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (d <= F2.attackFar && d > bd) {
          bd = d;
          bx = p.x;
          bz = p.z;
          found = true;
        }
      }
      if (!found) {
        const r = f.random() * (230 - F1.cell);
        const a = Math.round(Math.atan2(-this.x, -this.z) / (Math.PI * 2 / 0x10000)) + Math.trunc(f.random() * 49152) - 0x6000;
        bx = sinB(a) * r;
        bz = cosB(a) * r;
      }
      this.send(st, this.slot(), Math.min(15, Math.max(0, Math.trunc((bx + F1.half) / F1.cell))), Math.min(15, Math.max(0, Math.trunc((bz + F1.half) / F1.cell))));
      return;
    }
    this.send(st);
  }

  // --- the frame ----------------------------------------------------------------

  tick(): void {
    const f = this.fight;
    if (f.leader() || this.stalled(this.st === F2.waitNext)) this.lead();
    this.all();
    this.anim.tick();
    this.place();
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
    if (this.st === F2.dead || this.st === F2.waitKill) return;
    this.enter(F2.dead);
    this.fight.events.push({ kind: 'died', entity: this.entity });
  }

  private lead(): void {
    const f = this.fight;
    switch (this.st) {
      case F2.appear:
        if (this.timer === 0) {
          // 0x00458178: the first move, to a random slot.
          const to = ((this.angle + Math.round(f.random() * 49152) + 0x2000) >> 12) & 0xf;
          this.send(F2.move, to);
        }
        break;
      case F2.waitNext:
        if (this.hp <= 0 || this.dead) this.send(F2.waitKill);
        else this.enter(F2.stop1); // the leader alone goes on to the first pause
        break;
      case F2.move:
        if (this.timer === 0) {
          // 0x0045A3D4: a second move at a tenth while fewer than 3 were made;
          // a pause at a tenth; otherwise an attack.
          if (this.moves < F2.maxMoves && f.random() < F2.moveAgainChance) this.chooseMove();
          else if (f.random() < F2.stopChance) {
            let lo = Math.min(this.row.stopState, this.row.stopState + 1);
            let hi = Math.max(this.row.stopState, this.row.stopState + 1);
            if (lo < F2.stop1) lo = F2.stop1;
            if (hi > F2.stop4) hi = F2.stop4;
            const slot = this.pickStop(lo, hi);
            if (slot >= 0) this.send(slot);
            else this.chooseAttack();
          } else this.chooseAttack();
        }
        break;
      default:
        if (this.st >= F2.stop1 && this.st <= F2.stop4 && this.timer === 0) {
          if (f.random() < 0.75) this.chooseAttack();
          else this.chooseMove();
        }
        break;
    }
  }

  // 0x0045A4E8 SelectRandomVoloptForm7HazardSlot: one of lo..hi, evenly.
  private pickStop(lo: number, hi: number): number {
    if (lo < F2.stop1 || hi > F2.stop4 || lo > hi) return -1;
    return Math.min(hi, lo + Math.trunc(this.fight.random() * (hi - lo + 1)));
  }

  private all(): void {
    const f = this.fight;
    switch (this.st) {
      case F2.appear:
        if (--this.timer < 0) this.enter(F2.waitNext);
        break;
      case F2.dead:
        if (--this.timer < 0) this.enter(F2.waitKill);
        break;
      case F2.move: {
        // 0x0045846D: the angle eases over the move (the last 7 frames hold).
        const span = this.row.moveFrames - 7;
        this.t = this.timer <= 7 ? 1 : ease(1 - (this.timer - 7) / span);
        this.angle = norm16(this.fromAngle + Math.round(angDiff(this.fromAngle, this.toAngle) * this.t));
        if (--this.timer < 0) {
          this.fromAngle = this.angle;
          this.enter(F2.waitNext);
        }
        break;
      }
      case F2.jisin:
        if (this.timer === F2.jisinShake) f.events.push({ kind: 'se', id: 0x373 });
        if (--this.timer < 0) this.enter(F2.tenchu);
        break;
      case F2.beamL:
      case F2.beamR:
        this.beam();
        break;
      case F2.tenchu:
        if (this.timer === F1.tenchuShow) {
          this.marksShown = true;
          f.events.push({ kind: 'se', id: 0x375 });
        }
        if (this.timer === F1.tenchuHit && this.marksShown) this.punish();
        this.blendOut(this.timer, F2.tenchuFrames);
        if (--this.timer < 0) this.enter(this.row.stopState);
        break;
      case F2.recover:
        if (this.timer === F2.recoverDrain) f.events.push({ kind: 'se', id: 0x13e });
        if (--this.timer < 0) {
          // CreateSpecialAttackEntity (0x006EEEB4) on itself, the enemy Resta. ASSUMED
          // heal: the technique's power (the attacker's MST term is not known).
          this.hp = Math.min(this.maxHp, this.hp + Math.round(techPower(TECH.resta, this.row.restaLevel)));
          f.events.push({ kind: 'resta', level: this.row.restaLevel });
          this.enter(this.row.stopState);
        }
        break;
      default:
        if (this.st >= F2.stop1 && this.st <= F2.stop4) {
          if (--this.timer < 0) this.enter(F2.waitNext);
        }
        break;
    }
  }

  // Outward blend: 0 -> 1 over the first 15 frames, 1 until the last 17, then
  // back (0x00458D3A).
  private blendOut(timer: number, total: number): void {
    if (timer > total - F2.blendFrames) this.blend = (total - timer) / F2.blendFrames;
    else if (timer >= 17) this.blend = 1;
    else if (timer > 2) this.blend = (timer - 2) / F2.blendFrames;
    else this.blend = 0;
  }

  // 0x004589BC: a ball every second tick from timer 38 down to 4, thrown to the
  // side of the running point (+-20), the point moving along the ring.
  private beam(): void {
    const f = this.fight;
    if (this.timer === F2.beamAnim) this.anim.set(this.st === F2.beamL ? 6 : 7);
    if (this.timer === F2.beamFire) f.events.push({ kind: 'se', id: 0x370 });
    if (this.timer <= F2.beamFire && this.timer >= F2.beamLast && (this.timer & 1) === 0) {
      const len = Math.hypot(this.beamX, this.beamZ) || 1;
      // The side vector is the tangent of the point.
      const tx = -this.beamZ / len;
      const tz = this.beamX / len;
      const bx = this.beamX + tx * F2.beamSide * this.beamSide;
      const bz = this.beamZ + tz * F2.beamSide * this.beamSide;
      const rabarta = this.st === F2.beamL;
      this.ballAt(bx, bz, rabarta);
      this.beamSide = -this.beamSide;
      // Run along the ring.
      let nx = this.beamX + tx * F2.beamStep * this.beamSign;
      let nz = this.beamZ + tz * F2.beamStep * this.beamSign;
      const nl = Math.hypot(nx, nz) || 1;
      nx = (nx / nl) * F2.beamRing;
      nz = (nz / nl) * F2.beamRing;
      this.beamX = nx;
      this.beamZ = nz;
    }
    this.blendOut(this.timer, F2.beamFrames);
    if (--this.timer < 0) this.enter(this.row.stopState);
  }

  private ballAt(x: number, z: number, rabarta: boolean): void {
    if (this.ballCount < 24) {
      const b = this.balls[this.ballCount] ?? (this.balls[this.ballCount] = { x: 0, z: 0, rabarta: false });
      b.x = x;
      b.z = z;
      b.rabarta = rabarta;
      this.ballCount++;
    }
    const level = rabarta ? this.row.rabarta : this.row.rafoie;
    const reach = rabarta ? F1.rabartaReach : F1.rafoieReach;
    for (const p of this.fight.alive()) {
      if (Math.hypot(p.x - x, p.z - z) <= reach) {
        this.fight.events.push({ kind: 'tech', clientId: p.clientId, tech: rabarta ? 'rabarta' : 'rafoie', level, x, z, what: `Dark Falz ${rabarta ? 'Rabarta' : 'Rafoie'}` });
      }
    }
  }

  private makeMarks(): void {
    const f = this.fight;
    this.markCount = 0;
    const me = f.playerPos(f.selfId());
    const put = (x: number, z: number) => {
      const m = this.marks[this.markCount++];
      m[0] = x;
      m[1] = 0;
      m[2] = z;
    };
    if (me) {
      put(me.x, me.z);
      for (let i = 0; i < 8; i++) put(me.x + sinB(i * 0x2000) * F1.markRing, me.z + cosB(i * 0x2000) * F1.markRing);
    }
    for (let tries = 0; tries < 256 && this.markCount < F1.marks; tries++) {
      const x = (f.random() * 2 - 1) * F1.arena;
      const z = (f.random() * 2 - 1) * F1.arena;
      if (x * x + z * z >= F1.arena * F1.arena) continue;
      if (Math.hypot(x - this.x, z - this.z) <= F1.markKeepOut) continue;
      let near = false;
      for (let i = 0; i < this.markCount; i++) {
        if (Math.hypot(x - this.marks[i][0], z - this.marks[i][2]) <= F1.markGap) {
          near = true;
          break;
        }
      }
      if (!near) put(x, z);
    }
  }

  private punish(): void {
    for (const p of this.fight.alive()) {
      for (let i = 0; i < this.markCount; i++) {
        if (Math.hypot(p.x - this.marks[i][0], p.z - this.marks[i][2]) < F1.markReach) {
          this.fight.events.push({ kind: 'hit', clientId: p.clientId, power: this.row.tenchu, fixed: true, x: this.x, z: this.z, what: 'Dark Falz TENCHU' });
          break;
        }
      }
    }
  }

  get markPoints(): readonly Vec3[] {
    return this.marks;
  }

  get shownMarks(): number {
    return this.marksShown ? this.markCount : 0;
  }

  // The point a strike reaches (the body).
  reach(out: Vec3): void {
    out[0] = this.x;
    out[1] = this.y;
    out[2] = this.z;
  }
}

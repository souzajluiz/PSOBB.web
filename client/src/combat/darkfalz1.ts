// Dark Falz form 1 (PsoBB.exe, Ephinea 1.25.13): the body with three heads that
// the control creates in TYPE1 (create 0x00457000, ctor 0x004570B0, update
// 0x00454838, vtable 0x00AF75A0; battle row 54). See combat/darkfalzcommon.ts
// for the sources and the sync.
//
// It is a dispatcher on +0x37c over the table at 0x009A6000 (stride 0x14: name,
// animation id, enter, lead, all). Every client runs `all`; the leader's `lead`
// decides and sends a packed action through 6x19 (the control's entity id):
//   bits 0-3  the new state            bits 4-5  the position it leaves (+0x3ac)
//   bits 6-7  the position it goes to (+0x3a8)  bits 8-9  the old head variant
//   bits 10-11 the new variant (+0x3b0)  bits 12-15 / 16-19 the grid cell of the
//   target (+0x3b8 / +0x3bc; 16 cells of 29.375 over 470 units)
// (SetPlayerVoloptForm7HazardConfig 0x0045660C, a state above 10 is ignored).
//
// States: 0 APPEAR (75), 1 WAITNEXT, 2 MOVESTNDPOS (the slide to another of the
// four spots, row 54 fparam1 * 30 frames), 3 DEAD (75), 4 WAITKILL, 5 HAKILOOP
// (spits Darvants, 300), 6 PAKULOOP (chews, 150), 7 HAKIEND (45 frames of
// closing), 8 / 9 BEAM_L / BEAM_R (Rabarta / Rafoie at the target cell, 75),
// 10 TENCHU (the 64 marks, 150).
//
// The beam (0x00456860, dump FUN_00456860 by Ghidra): at timer 38 it calls the
// Rabarta constructor 0x006ec8ec (BEAM_L, state 8) or CreateRafoieEffectEntity
// 0x006ed87c (BEAM_R) with the target cell point (+0x3c0 / +0x3c4 = 0 / +0x3c8)
// and the Form 1 row's level (0x0077a6cc(0x36) field +0x1c / +0x18). The object is
// a technique object of the fight (combat/techfire.ts through DfFight.shoot, as
// form 2's balls): it lives its cast frames and hits each player in its box. The
// beam adds no radar icon (no minimap call on that path, nor in the 0x006e..0x006f
// objects). Dark Falz' arena makes the cut-off 250 (0x006ea7c4). ASSUMED: the
// Rafoie's wait before it hits (the exe's 10 frames, not re-checked here).
//
// ASSUMED (neither the dump nor the JP C has it): the flight and the
// aura of the spat Darvants (class 0xAF7EC0, only its update's skeleton was
// read), and the sphere each head offers a strike.

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
import { form1Icons, type Icon } from '../classic/minimap.ts';
import { enemyFire } from './techfire.ts';
import { TECH } from './techniques.ts';

// Animation table 0x009A5E20 (stride 0x20: mode, next, six motions for the
// models {waist, dodai, head, head, head, body} = chunks {7, 5, 3, 2, 4, 1}).
export const F1_ANIM_ROWS: readonly (DfAnimRow & { readonly motions: readonly number[] })[] = [
  { mode: 0, next: 0, motions: [80, 78, 77, 77, 77, 76] }, // 0 idle
  { mode: 1, next: 0, motions: [80, 78, 18, 18, 18, 17] }, // 1 dead (holds)
  { mode: 2, next: 3, motions: [80, 78, 42, 77, 77, 17] }, // 2 spit, head 0 in
  { mode: 0, next: 4, motions: [80, 78, 40, 77, 77, 17] }, // 3 spit, head 0 loop
  { mode: 2, next: 0, motions: [80, 78, 44, 77, 77, 17] }, // 4 spit, head 0 out
  { mode: 2, next: 6, motions: [80, 78, 77, 42, 77, 17] }, // 5 head 1
  { mode: 0, next: 7, motions: [80, 78, 77, 40, 77, 17] }, // 6
  { mode: 2, next: 0, motions: [80, 78, 77, 44, 77, 17] }, // 7
  { mode: 2, next: 9, motions: [80, 78, 77, 77, 42, 17] }, // 8 head 2
  { mode: 0, next: 10, motions: [80, 78, 77, 77, 40, 17] }, // 9
  { mode: 2, next: 0, motions: [80, 78, 77, 77, 44, 17] }, // 10
  { mode: 2, next: 0, motions: [80, 78, 77, 77, 77, 0] }, // 11 beam L
  { mode: 2, next: 0, motions: [80, 78, 77, 77, 77, 4] }, // 12 beam R
  { mode: 2, next: 14, motions: [80, 78, 77, 77, 77, 67] }, // 13 tenchu
  { mode: 2, next: 0, motions: [80, 78, 77, 77, 77, 61] }, // 14
];

export const F1 = {
  // States (table 0x009A6000).
  appear: 0,
  waitNext: 1,
  move: 2,
  dead: 3,
  waitKill: 4,
  haki: 5,
  paku: 6,
  hakiEnd: 7,
  beamL: 8,
  beamR: 9,
  tenchu: 10,
  // Animation id of each state (column +4 of the table).
  stateAnim: [0, 0, 0, 1, -1, 2, 2, 4, 11, 12, 13] as readonly number[],
  // Frames of the waits (static init 0x00457604: [0xA45600] 75, [0xA4569C] 75,
  // [0xA456A0] 300, [0xA456A4] 150, [0xA45654] 75, [0xA456A8] 150; HAKIEND 0x3C).
  appearFrames: 75,
  deadFrames: 75,
  hakiFrames: 300,
  pakuFrames: 150,
  hakiEndFrames: 60,
  beamFrames: 75,
  tenchuFrames: 150,
  // The animation id of the spit by head variant (0x009A6158) and of the
  // closing (0x009A5D68).
  hakiAnim: [2, 5, 8] as readonly number[],
  hakiEndAnim: [4, 7, 10] as readonly number[],
  // The four spots (the lazy init at 0x00455B9D: 175 from the middle) and the
  // way the body faces at each (0x009A6164).
  spots: [
    [0, 0, -175],
    [175, 0, 0],
    [0, 0, 175],
    [-175, 0, 0],
  ] as readonly Vec3[],
  facing: [0, 0xc000, 0x8000, 0x4000] as readonly number[],
  // APPEAR slides from z -120 ([0xA45604]) to -175.
  appearFrom: [0, 0, -120] as Vec3,
  // The animation step (ctor: +0x3f4 = 0.4).
  animStep: 0.4,
  // Grid of the target cell: 16 cells over 470 units ([0xA45650] = 460 + 10
  // over 16 = 29.375, half 235).
  cells: 16,
  cell: 29.375,
  half: 235,
  // The nearest player must be within 460 ([0xA45648]) for a beam.
  beamReach: 460,
  // Frame of BEAM at which the technique object is created ([0xA45654] 75 -
  // [0xA45260] 37).
  beamFire: 38,
  // TENCHU: marks show at timer 6, the hit lands at timer 1; 64 marks, 9 of them
  // on the local player (itself and 8 at radius 40), a hit within 25 ([0xA45580]).
  tenchuShow: 6,
  tenchuHit: 1,
  marks: 64,
  markRing: 40,
  markReach: 25,
  arena: 230, // radius^2 52900
  markKeepOut: 125, // the body's distance (the 125.0 passed to 0x00454300)
  markGap: 15, // ASSUMED: g_VoloptForm7HazardDistanceThreshold was not read
  // HAKILOOP spits every 32 frames while timer < 262 ([0xA45640]).
  spitEvery: 32,
  spitBefore: 262,
  // The mouth a spat Darvant leaves from: the head's position, 25 up.
  headLocal: [
    [135, 25, 0],
    [0, 25, 135],
    [-135, 25, 0],
  ] as readonly Vec3[],
  headRadius: 30,
  // Two beams in a row: after a beam, half the time it moves (0x008FFD78 = 0.5).
  beamMoveChance: 0.5,
  // After an attack the leader moves 3 times in 4 ... 0x008FFE7C = 0.75 (TENCHU).
  tenchuAttackChance: 0.75,
} as const;

// Weights of SelectWeightedRandomOption (0x00453B6C): the loop adds the
// weight[i] again after a miss, so for these tables it is exactly the odds.
export function pickWeighted(f: { random(): number }, values: readonly number[], weights: readonly number[]): number {
  const r = f.random();
  let acc = weights[0];
  for (let i = 0; i < values.length - 1; i++) {
    if (r < acc) return values[i];
    acc += weights[i];
  }
  return values[values.length - 1];
}

export interface Form1Row {
  hp: number;
  atp: number;
  moveFrames: number; // clamp(round(fparam1), 1..60 else 25) * 30
  rafoie: number; // iparam1
  rabarta: number; // iparam2
  tenchu: number; // iparam3: the fixed damage
  spitMax: number; // row 57 iparam1: min(6) / 1 when below 2
}

// The box list (+0x39C) of form 1 (PROVEN, PsoBB.exe): the ctor 0x004570B0 (vtable 0x00AF75A0
// written at 0x00457106) calls 0x007B9A88 with the template 0x009A5D80, which copies three
// records of 0x2C (the count is the 3 of the call) and transforms their centres. Each record's
// flags (+0x18) is read from the template as 0x801B, so bit 0 (the hit bit) is on from creation.
// No store to a box's +0x18 exists in 0x00454838..0x00457BD4 (the form 1 update and its tables),
// and none in the rest of the Dark Falz range (0x0044C000..0x00461000, the two stores in the
// forms 2 and 3 and the table fill at 0x00454354 are other boxes). So the boxes stay on.
// The control's +0x39C is a different object (0x0044E4D0: a 0x98 map object, not a box).
export const F1_BOX_FLAGS = 0x801b;
export const F1_BOX_COUNT = 3;

export class DfForm1 extends DfEntity {
  st: number = F1.appear;
  timer = 0;
  readonly anim = new DfAnim(F1_ANIM_ROWS, F1.animStep);
  yaw = 0; // BAMS
  // +0x3ac (from) / +0x3a8 (to), the old / new head variant, the grid cell.
  from = 0;
  to = 0;
  oldV = 0;
  newV = 0;
  gx = 8;
  gz = 8;
  // t of the slide (this+0x3a4) and the target point (+0x3c0).
  t = 0;
  target: Vec3 = [0, 0, 0];
  spat = 0; // +0x3d0
  readonly threshold: number; // +0x3e0: half the HP
  readonly row: Form1Row;
  // Created in TYPE1; invulnerable flag 0x200 is clear from then on.
  awake = true;
  private readonly fight: DfFight;
  private readonly marks: Vec3[] = [];
  private markCount = 0;
  private marksShown = false;
  // The ASSUMED hit sphere points, world, reused.
  readonly heads: Vec3[] = [
    [0, 25, 0],
    [0, 25, 0],
    [0, 25, 0],
  ];
  // Per-frame hit scratch (no allocation).
  private firedBeam = false;

  constructor(fight: DfFight, row: Form1Row, yaw: number) {
    super(DF_ID.form1, row.hp);
    this.fight = fight;
    this.row = row;
    this.threshold = Math.trunc(row.hp / 2);
    this.yaw = norm16(yaw);
    for (let i = 0; i < F1.marks; i++) this.marks.push([0, 0, 0]);
    this.x = F1.appearFrom[0];
    this.z = F1.appearFrom[2];
    this.enter(F1.appear);
    this.updateHeads();
  }

  // The hit box is on from creation (F1_BOX_FLAGS bit 0, see above; nothing clears it), so the
  // gates are the entity's: the invulnerable flag 0x200 (`awake`), the dead state and waitKill.
  // ASSUMED: those gates are not traced in the exe's hit test (only the box is).
  get targetable(): boolean {
    return (F1_BOX_FLAGS & 1) !== 0 && this.awake && this.st !== F1.dead && this.st !== F1.waitKill;
  }

  // 0x0045A9E4 / the enter functions of the table.
  // How many states were entered (a re-entry of the same state counts).
  entries = 0;

  private enter(st: number): void {
    this.entries++;
    this.st = st;
    this.anim.set(F1.stateAnim[st] ?? -1);
    this.marksShown = false;
    switch (st) {
      case F1.appear:
        this.timer = F1.appearFrames;
        this.anim.frame = 0;
        break;
      case F1.move:
        this.timer = this.row.moveFrames;
        break;
      case F1.dead:
        this.timer = F1.deadFrames;
        break;
      case F1.haki:
      case F1.paku:
        // 0x004578BC: the animation of the new variant, no spit yet.
        this.anim.set(F1.hakiAnim[this.newV] ?? 2);
        this.spat = 0;
        this.timer = st === F1.haki ? F1.hakiFrames : F1.pakuFrames;
        break;
      case F1.hakiEnd:
        this.anim.set(F1.hakiEndAnim[this.newV] ?? 4);
        this.timer = F1.hakiEndFrames;
        break;
      case F1.beamL:
      case F1.beamR:
        // 0x00457878: the target point from the grid cell (the control's
        // TransformVoloptForm7HazardPosition 0x00456860 does it on receipt).
        this.timer = F1.beamFrames;
        this.firedBeam = false;
        break;
      case F1.tenchu:
        this.timer = F1.tenchuFrames;
        this.makeMarks();
        break;
      default:
        break;
    }
  }

  // --- packets ---------------------------------------------------------------

  static pack(st: number, from: number, to: number, oldV: number, newV: number, gx: number, gz: number): number {
    return ((st & 0xf) | ((from & 3) << 4) | ((to & 3) << 6) | ((oldV & 3) << 8) | ((newV & 3) << 10) | ((gx & 0xf) << 12) | ((gz & 0xf) << 16)) >>> 0;
  }

  // SetPlayerVoloptForm7HazardConfig.
  receive(packed: number): void {
    this.from = (packed >> 4) & 3;
    this.to = (packed >> 6) & 3;
    const oldV = (packed >> 8) & 3;
    const newV = (packed >> 10) & 3;
    if (oldV >= 3 || newV >= 3) return;
    this.oldV = oldV;
    this.newV = newV;
    this.gx = (packed >> 12) & 0xf;
    this.gz = (packed >> 16) & 0xf;
    this.target[0] = (this.gx + 0.5) * F1.cell - F1.half;
    this.target[1] = 0;
    this.target[2] = (this.gz + 0.5) * F1.cell - F1.half;
    const st = packed & 0xf;
    if (st > 10) return;
    this.enter(st);
  }

  private send(st: number, from = this.to, to = this.to, oldV = this.newV, newV = this.newV, gx = this.gx, gz = this.gz): void {
    this.fight.send(0xffff, DfForm1.pack(st, from, to, oldV, newV, gx, gz));
  }

  // --- the leader's decisions ----------------------------------------------------

  // 0x00455724 ProcessSpecialAttackRecovery: spit while the Darvants alive are
  // few enough, otherwise chew. `alive` is the control's +0x390 - +0x394.
  private chooseSpit(alive: number): void {
    this.send(alive <= 12 - this.row.spitMax ? F1.haki : F1.paku);
  }

  // 0x00455A34: slide to one of the other three spots, a random variant of the
  // head that faces the middle (0x008FFCC4 = 0.1, 0x008FFEA8 = 0.9).
  private chooseMove(): void {
    const f = this.fight;
    let dest = Math.trunc(f.random() * 2.97) + this.to + 1;
    if (dest >= 4) dest -= 4;
    const r = f.random();
    const variant = r <= 0.1 ? 0 : r <= 0.9 ? 1 : 2;
    this.send(F1.move, this.to, dest, this.newV, variant);
  }

  // 0x0045617C: a beam at the nearest player or the punishment; only while the
  // facing head is the middle one (variant 1), otherwise it spits again.
  private chooseAttack(alive: number): void {
    if (this.newV !== 1) {
      this.chooseSpit(alive);
      return;
    }
    const f = this.fight;
    const kind =
      this.hp <= this.threshold ? pickWeighted(f, [F1.beamL, F1.beamR, F1.tenchu], [0.25, 0.25, 0.5]) : pickWeighted(f, [F1.beamL, F1.beamR], [0.5, 0.5]);
    if (kind === F1.tenchu) {
      this.send(F1.tenchu);
      return;
    }
    this.aimCell(kind);
  }

  // The beam at the nearest player within 460 (the cell it stands in), or at a
  // random point in front of the arena.
  private aimCell(kind: number): void {
    const f = this.fight;
    let best = -1;
    let bx = 0;
    let bz = 0;
    let bd = 0;
    for (const p of f.alive()) {
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d <= F1.beamReach && d > bd) {
        bd = d;
        best = p.clientId;
        bx = p.x;
        bz = p.z;
      }
    }
    if (best < 0) {
      // 0x00456392: a random distance up to (230 - cell) and an angle about the
      // direction to the middle (+-0x6000).
      const r = f.random() * (F1.arena - F1.cell);
      const a = Math.round(Math.atan2(-this.x, -this.z) / BAMS) + Math.trunc(f.random() * 49152) - 0x6000;
      bx = sinB(a) * r;
      bz = cosB(a) * r;
    }
    const gx = Math.min(15, Math.max(0, Math.trunc((bx + F1.half) / F1.cell)));
    const gz = Math.min(15, Math.max(0, Math.trunc((bz + F1.half) / F1.cell)));
    this.send(kind, this.to, this.to, this.newV, this.newV, gx, gz);
  }

  // --- the frame ------------------------------------------------------------------

  tick(): void {
    const f = this.fight;
    const alive = f.aliveDarvants();
    if (f.leader() || this.stalled(this.st === F1.waitNext)) this.lead(alive);
    this.all();
    this.anim.tick();
    this.updateHeads();
    this.trackPose();
    if (this.hp <= 0 && !this.dead) this.die();
    // The control sets 0x800 from the HP; WAITNEXT's lead then asks for WAITKILL.
  }

  private stall = 0;
  // A follower that has waited for the leader's order too long decides itself.
  private stalled(waiting: boolean): boolean {
    if (!waiting) {
      this.stall = 0;
      return false;
    }
    if (++this.stall < STALL_TICKS) return false;
    this.stall = 0;
    return true;
  }

  // The die hook (vtable +0x114, 0x00454768).
  die(): void {
    if (this.st === F1.dead || this.st === F1.waitKill) {
      this.dead = true;
      return;
    }
    this.dead = true;
    this.enter(F1.dead);
    this.fight.events.push({ kind: 'died', entity: this.entity });
  }

  private lead(alive: number): void {
    const f = this.fight;
    switch (this.st) {
      case F1.appear:
        if (this.timer === 0) this.chooseSpit(alive);
        break;
      case F1.waitNext:
        if (this.hp <= 0 || this.dead) this.send(F1.waitKill);
        else this.chooseMove();
        break;
      case F1.move:
        if (this.timer === 0) this.chooseSpit(alive);
        break;
      case F1.hakiEnd:
        if (this.timer === 0) {
          if (this.newV === 1) this.chooseAttack(alive);
          else this.chooseMove();
        }
        break;
      case F1.beamL:
      case F1.beamR:
        if (this.timer === 0) {
          if (f.random() < F1.beamMoveChance) this.chooseMove();
          else this.aimCell(this.st === F1.beamL ? F1.beamR : F1.beamL);
        }
        break;
      case F1.tenchu:
        if (this.timer === 0) {
          if (f.random() < F1.tenchuAttackChance) this.chooseAttack(alive);
          else this.chooseMove();
        }
        break;
      default:
        break;
    }
  }

  private to_(st: number): void {
    this.enter(st);
  }

  private all(): void {
    const f = this.fight;
    switch (this.st) {
      case F1.appear: {
        // 0x004557F4: slide up out of the floor over 75 frames.
        this.t = ease(1 - this.timer / F1.appearFrames);
        this.x = F1.appearFrom[0];
        this.z = F1.appearFrom[2] + (F1.spots[0][2] - F1.appearFrom[2]) * this.t;
        if (--this.timer < 0) this.to_(F1.waitNext);
        break;
      }
      case F1.move: {
        // 0x00455B68: the eased slide between two spots and the turn of the heads.
        this.t = ease(1 - this.timer / this.row.moveFrames);
        const a = F1.spots[this.from];
        const b = F1.spots[this.to];
        this.x = a[0] + (b[0] - a[0]) * this.t;
        this.z = a[2] + (b[2] - a[2]) * this.t;
        const ya = F1.facing[this.from] + (this.oldV << 14) - 0x4000;
        const yb = F1.facing[this.to] + (this.newV << 14) - 0x4000;
        this.yaw = norm16(ya + Math.round(angDiff(ya, yb) * this.t));
        if (--this.timer < 0) {
          this.from = this.to;
          this.oldV = this.newV;
          this.to_(F1.waitNext);
        }
        break;
      }
      case F1.dead:
        if (--this.timer < 0) this.to_(F1.waitKill);
        break;
      case F1.haki: {
        // 0x00455E34: a Darvant from the mouth every 32 frames.
        if (this.timer < F1.spitBefore && (this.timer & 0x1f) === 0 && this.spat < this.row.spitMax) {
          const h = this.heads[this.newV];
          if (f.spawnSpit(h[0], h[2])) {
            f.events.push({ kind: 'se', id: 0x36d });
            this.spat++;
          }
        }
        if (this.timer === F1.spitBefore) f.events.push({ kind: 'se', id: 0x36c });
        if (--this.timer < 0) this.to_(F1.hakiEnd);
        break;
      }
      case F1.paku:
        if (--this.timer < 0) this.to_(F1.hakiEnd);
        break;
      case F1.hakiEnd:
        if (this.timer === 0x2d) f.events.push({ kind: 'se', id: 0x36e });
        if (--this.timer < 0) this.to_(F1.waitNext);
        break;
      case F1.beamL:
      case F1.beamR:
        // 0x00456860: the technique lands at the target cell at timer 38.
        if (this.timer === F1.beamFire && !this.firedBeam) {
          this.firedBeam = true;
          const rabarta = this.st === F1.beamL;
          const level = rabarta ? this.row.rabarta : this.row.rafoie;
          f.events.push({ kind: 'se', id: 0x370 });
          this.fireBeam(rabarta, level);
        }
        if (--this.timer < 0) this.to_(F1.waitNext);
        break;
      case F1.tenchu:
        if (this.timer === F1.tenchuShow) {
          this.marksShown = true;
          f.events.push({ kind: 'se', id: 0x375 });
        }
        if (this.timer === F1.tenchuHit && this.marksShown) this.punish();
        if (--this.timer < 0) this.to_(F1.waitNext);
        break;
      default:
        break;
    }
  }

  // 0x00456860 at timer 38: the beam's technique object at the target cell, an
  // enemy's object with the Dark Falz cut-off (the same path as form 2's balls,
  // darkfalz2.ts spawnBall). Rabarta for BEAM_L, a fixed Rafoie for BEAM_R.
  private fireBeam(rabarta: boolean, level: number): void {
    const shot = enemyFire({ tech: rabarta ? TECH.rabarta : TECH.rafoie, level, x: this.target[0], y: 0, z: this.target[2], heading: 0, fixed: !rabarta, enemy: false });
    if (shot) this.fight.shoot(shot);
  }

  // InitializeVoloptForm7HazardPositions (0x0045431C): the local player's spot
  // and the ring of 8 about it, then random points in the arena that keep away
  // from the body and from each other, up to 64.
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

  // 0x004545F4 SpawnVoloptForm7HazardsAndCheckHits: every alive player within
  // 25 of a mark is hit for the row's iparam3 (fixed damage).
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

  // The radar icons of the body, the heads and the ring (form1Icons).
  minimapIcons(): Icon[] {
    return form1Icons({ x: this.x, z: this.z }, this.heads, sinB(this.yaw), cosB(this.yaw));
  }

  // The three hit spheres in the world: the heads turn with the yaw.
  private updateHeads(): void {
    const c = cosB(this.yaw);
    const s = sinB(this.yaw);
    for (let i = 0; i < 3; i++) {
      const l = F1.headLocal[i];
      this.heads[i][0] = this.x + l[0] * c + l[2] * s;
      this.heads[i][1] = l[1];
      this.heads[i][2] = this.z - l[0] * s + l[2] * c;
    }
  }

  // The head a strike from (px, pz) reaches (nearest).
  reach(px: number, pz: number, out: Vec3): void {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < 3; i++) {
      const d = Math.hypot(px - this.heads[i][0], pz - this.heads[i][2]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    out[0] = this.heads[best][0];
    out[1] = this.heads[best][1];
    out[2] = this.heads[best][2];
  }
}

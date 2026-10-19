// Vol Opt phase 2 (TBoss3VoloptP02 0xC5; PsoBB.exe, Ephinea 1.25.13, addresses
// are VAs). The body is its own set entry; combat/volopt.ts has the control
// object that builds phase 1, hands the players over and directs both phases.
//
// Sources: the Ephinea Ghidra dump (the state functions that follow
// UpdatePlayerTechAndDamage, in the dump's order), tools/exedata.py
// for the motion table 0x009a5340 (stat init 0x004491cc), the hit boxes
// 0x009a53e0 and the 6x18 handler 0x004488d8 (read by hand: it stores the four
// shorts of the packet into +0x4b4 .. +0x4ba). JP files that agree:
// FUN_00448430.cpp (state 1 goes straight on to vtable +0xf0) and
// FUN_004492a0.c (SinowbeatInitializeTeleportData's field copy).
//
// The body is a dispatcher on +0x32e: 0 idle, 1 walk (straight to 0), 2 the
// laser and prison bars, 4 the hit reaction, 5 the death, 7 standing up, 9 the
// capture, 0xA the missiles, 0xB the heal, 0xC the Ultimate arm. The leader's
// 6x15 orders (action 3 missiles, 4 laser, 5 heal, 6 capture, 7 arm) set them.
// One pool, the entity's HP (row 37); four part HPs (row 42 iparam1..4:
// capture, laser, heal, missile) that only gate the actions, scale the pause
// (30 frames + 30 per part at 0) and ride 6x18. The hit boxes are 5 (the four
// parts and the body); a hit marks the box it touched and the reaction splits
// the damage between the marked parts.
//
// ASSUMED (neither the dump nor the JP C has it): the prison bar / prison cage
// objects' update code (only their constructors and the missile's update are
// in the dump), so the bars cost nothing and the cage is a projectile that
// takes the first player it touches; the launch points of the missiles; which
// part a strike touched (the nearest box to the attacker); the ability of the
// Ultimate arm (state 0xC, only its timeline and the arc are ported).

import { BAMS_TO_RAD, type AiFrame, type AiTarget } from './enemyai.ts';
import type { EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase } from './enemyfsm.ts';
import { EnemyShot, type ShotEffect, type ShotLook } from './enemyshots.ts';
import { NO_HITS, VO_ID, VoloptAnim, VoloptPart, VoloptWatchdog, type Vec3, type VoloptEvent, type VoloptForm2Link, type VoloptSlot } from './volopt.ts';

const BAMS = BAMS_TO_RAD;
const PLAYER_RADIUS = 5;

// Motion table 0x009a5340: 0 wait, 2 the laser, 3 the hit, 4 the death
// (holds), 5 the heal, 6 the capture, 7 the missiles, 8 standing up.
export const FORM2_SLOTS: readonly VoloptSlot[] = [
  { motion: 16, speed: 0.7, mode: 1, next: 0, flag: 0 },
  { motion: 16, speed: 0.7, mode: 1, next: 0, flag: 1 },
  { motion: 10, speed: 0.8, mode: 2, next: 0, flag: 4 },
  { motion: 4, speed: 0.6, mode: 2, next: 0, flag: 8 },
  { motion: 5, speed: 0.5, mode: 3, next: 4, flag: 0x10 },
  { motion: 11, speed: 0.7, mode: 2, next: 0, flag: 4 },
  { motion: 9, speed: 0.8, mode: 2, next: 0, flag: 4 },
  { motion: 1, speed: 0.7, mode: 2, next: 0, flag: 4 },
  { motion: 13, speed: 0.6, mode: 2, next: 0, flag: 1 },
];

// The five hit boxes (0x009a53e0, 0x2c bytes each), local to the body: the
// capture, laser, heal and missile parts, then the body.
export const FORM2_BOXES: readonly { x: number; y: number; z: number; r: number }[] = [
  { x: 0, y: 23, z: 29, r: 10 },
  { x: 36, y: 26, z: 0, r: 15 },
  { x: -36, y: 26, z: 0, r: 15 },
  { x: 0, y: 25, z: -35, r: 18 },
  { x: 0, y: 26, z: 0, r: 24 },
];

// Where the parts stand in the 6x18 order.
export const PART_NAMES = ['capture', 'laser', 'heal', 'missile'] as const;

// The numbers of the state functions, one place.
export const F2 = {
  turn: 0x566, // the heading step of the aim (ClampAngleDifference)
  missileArc: 0x1c72, // players in front of the muzzle (+/- 40 degrees)
  missileAim: 60, // frames of aiming (0x344)
  missileWait: 10,
  missileGap: 15,
  missileWaves: 2, // logged in; offline it is 4
  missileLaunchFrame: 22,
  healFrame: 38,
  healWait: 30,
  healPause: 60,
  laserFrame: 33,
  laserCharge: 30,
  laserAim: 30,
  laserWait: 300,
  laserRounds: 3,
  laserTurn: 0x180, // BAMS a tick the four points turn
  laserSweep: 0x1555,
  laserHit: 10, // a player this close to a point starts the bars
  laserRadius: [75, 25, 0x400] as const, // 75 + 25 * sin(phase), phase += 0x400
  pushRadius: 35,
  pushTo: 40, // ASSUMED: _g_VoloptInteractionRadius was not read
  captureAim: 45,
  captureHold: 120, // + row 37 iparam5
  captureRelease: 15,
  captureAfter: 30,
  prisonLife: 450, // + row 37 iparam5 (ProcessVoloptPlayerMoveToTarget)
  cageReach: 12, // ASSUMED: the cage's box
  standFrame: 38,
  flinch: 6,
  armArc: [0x31c7, 0x471c] as const,
  armWait: 0x5a,
  deathHold: 60,
  deathFrame: 47,
  deathLeave: 0x10,
} as const;

// The missile (the PrisonCore object, ConstructVoloptPrisonCoreEntity,
// update SpawnVoloptPrisonItem): the velocity gains fparam2 of row 37 toward
// the player's weapon point and is brought back to fparam1 every tick, life
// round(fparam4) + 240 frames, a 5 unit box; entity_hit_by_tech group 0
// (group 0x11, slow, one time in ten in Ultimate) with iparam1.
export class VoloptMissile extends EnemyShot {
  override readonly absolute = true;
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xff7040, size: 2 };
  private vx: number;
  private vy: number;
  private vz: number;
  private readonly speed: number;
  private readonly accel: number;
  private readonly life: number;
  private readonly target: number;
  constructor(x: number, y: number, z: number, dir: Vec3, speed: number, accel: number, life: number, power: number, target: number) {
    super(x, y, z);
    this.speed = speed;
    this.accel = accel;
    this.life = life;
    this.target = target;
    this.vx = dir[0] * speed;
    this.vy = dir[1] * speed;
    this.vz = dir[2] * speed;
    this.effect = { kind: 'tech', power: Math.max(0, power) };
  }
  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return NO_HITS;
    this.frames++;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.dead || t.clientId !== this.target) continue;
      // Toward the weapon point: add the pull, then back to the flight speed.
      const dx = t.x - this.x;
      const dy = 10 - this.y;
      const dz = t.z - this.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      this.vx += (dx / d) * this.accel;
      this.vy += (dy / d) * this.accel;
      this.vz += (dz / d) * this.accel;
      const n = Math.hypot(this.vx, this.vy, this.vz) || 1;
      this.vx = (this.vx / n) * this.speed;
      this.vy = (this.vy / n) * this.speed;
      this.vz = (this.vz / n) * this.speed;
      break;
    }
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    // The explosion damages the players it touches (at the end of its life
    // too); a player standing in it is hit once.
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.dead) continue;
      if (Math.hypot(t.x - this.x, t.z - this.z) <= 5 + PLAYER_RADIUS && Math.abs(this.y - 10) <= 20) {
        this.done = true;
        return [t];
      }
    }
    if (this.frames >= this.life || this.y < 0) this.done = true;
    return NO_HITS;
  }
}

export interface Form2Options {
  x: number;
  z: number;
  angle: number; // radians, the renderer's yaw
  ultimate: boolean;
  hp: number; // stats row 37
  movement: EnemyMovementData | null; // row 37
  parts: EnemyMovementData | null; // row 42: iparam1..4 the part HPs
  prison: EnemyMovementData | null; // row 38
  prisonHp: number; // stats row 38
  leader: () => boolean;
  selfId: () => number;
  frames: (motion: number) => number;
  rng: () => number;
}

// Row 37 / 42 / 38 of BattleParamEntry_on.dat (Normal), used only when the
// table is missing. ASSUMED fallback.
const FALLBACK = {
  move: { fparam1: 1.75, fparam2: 0.15, fparam3: 25, fparam4: -35, fparam5: 0, fparam6: 0, iparam: [300, 550, 900, 200, 190, 4] } as EnemyMovementData,
  parts: [1500, 3600, 800, 1500],
  prison: { fparam1: 1.24, fparam2: 0.7, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [130, 0, 0, 0, 0, 0] } as EnemyMovementData,
};

export class VoloptForm2Ai extends BrainBase implements VoloptForm2Link {
  state: string = 'idle';
  readonly superArmor = true;
  readonly ultimate: boolean;
  readonly events: VoloptEvent[] = [];
  readonly sustained = new Set<number>();
  hp: number;
  readonly maxHp: number;
  readonly partHp: number[];
  readonly partMax: number[];
  st = 7;
  private sub = 0;
  private timer = 0;
  heading = 0; // BAMS; the body faces heading + 0x8000
  private awake = false; // the control stood it up (AI state 3)
  private active = false; // the control reached phase 2 (the minion flag 0x8000000 is gone)
  private flinch = 0;
  private hitMarks = [false, false, false, false];
  private sinceHp: number; // the HP the last reaction left (+0x346)
  private hitFlag = false;
  private aim = 0xffff; // +0x340
  private waves = 0;
  private rounds = 0;
  private phase = 0;
  private radius = 75;
  private sweep = 0;
  private rotation = 0;
  private readonly anim: VoloptAnim;
  private readonly dog = new VoloptWatchdog();
  private readonly move: EnemyMovementData;
  private readonly prisonMove: EnemyMovementData;
  private prison: VoloptPart = new VoloptPart('prison', 0, VO_ID.prison, 1);
  private prisonHp: number;
  private readonly pending: EnemyShot[] = [];
  readonly points: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  pointCount = 0;
  // The captured player and how long the prison holds.
  captured = 0xffff;
  private prisonTimer = 0;
  private cage: { x: number; z: number; vx: number; vz: number; life: number; target: number } | null = null;
  killedAt: Vec3 | null = null;
  private readonly out: AiFrame;

  constructor(opts: Form2Options) {
    super(opts.x, opts.z, opts.angle, opts.rng);
    this.ultimate = opts.ultimate;
    this.move = opts.movement ?? FALLBACK.move;
    this.prisonMove = opts.prison ?? FALLBACK.prison;
    this.prisonHp = Math.max(1, opts.prisonHp || 260);
    this.bindPrison(this.prison);
    this.maxHp = Math.max(1, opts.hp);
    this.hp = this.maxHp;
    this.sinceHp = this.maxHp;
    const pm = opts.parts && opts.parts.iparam[0] > 0 ? opts.parts.iparam.slice(0, 4) : FALLBACK.parts;
    this.partHp = pm.slice();
    this.partMax = pm.slice();
    this.heading = Math.round(opts.angle / BAMS);
    this.anim = new VoloptAnim(FORM2_SLOTS, opts.frames);
    this.out = { motion: null, x: this.x, z: this.z, angle: this.angle, hit: null };
  }

  // --- VoloptForm2Link ---------------------------------------------------------

  // The control's part at base + 0x20 is the prison's hit target.
  bindPrison(part: VoloptPart): void {
    this.prison = part;
    part.maxHp = this.prisonHp;
    part.hp = 0;
    part.dead = true;
    part.targetable = false;
  }

  get dead(): boolean {
    return this.st === 5 && this.sub >= 4;
  }
  // Standing, alive and the fight is on.
  get ready(): boolean {
    return this.active && this.st !== 7 && this.st !== 5;
  }
  get dying(): boolean {
    return this.st === 5;
  }
  get busyParts(): number {
    let n = 0;
    for (const h of this.partHp) if (h < 1) n++;
    return n;
  }
  // The flags 0x10000.. 0x80000 of +0x390: an action is off when its part is
  // at 0 HP.
  canAct(action: 3 | 4 | 5 | 6 | 7): boolean {
    switch (action) {
      case 3:
        return this.partHp[3] >= 1;
      case 4:
      case 7:
        return this.partHp[1] >= 1;
      case 5:
        return this.partHp[2] >= 1;
      default:
        return this.partHp[0] >= 1;
    }
  }
  appear(): void {
    // GiGuesSetAIStateTo7: stand up (state 7), locked.
    this.awake = true;
    this.st = 7;
    this.sub = 0;
    this.active = false;
  }
  begin(): void {
    this.active = true;
  }
  position(out: Vec3): void {
    out[0] = this.x;
    out[1] = 0;
    out[2] = this.z;
  }
  // Frames the prison holds the captured player.
  get prisonFrames(): number {
    return this.prisonTimer;
  }
  get isAwake(): boolean {
    return this.awake;
  }
  get animSlot(): number {
    return this.anim.slot;
  }
  get animFrame(): number {
    return this.anim.frame;
  }
  // The body faces heading + 0x8000 (atan2(dx, dz) in BAMS).
  facing(): number {
    return (this.heading + 0x8000) & 0xffff;
  }
  get untargetable(): boolean {
    return !this.ready;
  }
  get invulnerable(): boolean {
    return !this.ready;
  }

  // --- orders ---------------------------------------------------------------------

  private canStart(flagOff: boolean, state: number): boolean {
    return this.st !== 5 && this.st !== 7 && flagOff && this.st !== state;
  }

  // handle_packet0x60_subcommand0x15 cases 3..7 (0x0043e4f8).
  applyAction(action: number, target: number, param: number): void {
    switch (action) {
      case 3:
        // SetVoloptPlayerInteractionState: the missile part must be alive.
        if (this.canStart(this.partHp[3] >= 1, 10) && target !== 0xffff) {
          this.aim = target;
          this.go(10);
        }
        break;
      case 4:
        if (this.canStart(this.partHp[1] >= 1, 2)) {
          this.aim = target;
          this.go(2);
        }
        break;
      case 5:
        if (this.canStart(this.partHp[2] >= 1, 0xb)) this.go(0xb);
        break;
      case 6:
        if (this.canStart(this.partHp[0] >= 1, 9)) {
          this.aim = target;
          this.go(9);
        }
        break;
      case 7:
        // UpdateVoloptPlayerEntityState: the arm, radius param + 55.
        if (this.canStart(this.partHp[1] >= 1, 0xc)) {
          this.sweep = param + 55;
          this.go(0xc);
        }
        break;
    }
  }

  // 6x18 (handler 0x004488d8): the four part HPs, as sent.
  applyPartsHp(hp: readonly number[]): void {
    for (let i = 0; i < 4; i++) if (hp[i] !== undefined) this.partHp[i] = Math.max(0, Math.min(this.partMax[i], hp[i]));
  }

  private go(st: number): void {
    // Leave the old state (its objects go), enter the new one at sub 0.
    this.leave(this.st);
    this.st = st;
    this.sub = 0;
    this.timer = 0;
    this.anim.set(0);
    this.state = FORM2_NAMES[st] ?? `state ${st}`;
  }

  private leave(st: number): void {
    if (st === 2 || st === 0xc) this.pointCount = 0;
    if (st === 9) this.releasePrison();
  }

  // --- damage ---------------------------------------------------------------------

  // A strike by the local player at (fx, fz). Returns the part it marked
  // (0..3), 4 for the body.
  hit(amount: number, fx: number, fz: number, _byLocal: boolean): number {
    const d = Math.max(0, Math.round(amount));
    if (d <= 0 || !this.ready) return -1;
    this.hp = Math.max(0, this.hp - d);
    this.hitFlag = true;
    // ASSUMED: the box nearest to the attacker (boxes turn with the body).
    const c = Math.cos(this.heading * BAMS);
    const s = Math.sin(this.heading * BAMS);
    let best = 4;
    let bd = Infinity;
    for (let i = 0; i < FORM2_BOXES.length; i++) {
      const b = FORM2_BOXES[i];
      const bx = this.x + b.x * c + b.z * s;
      const bz = this.z - b.x * s + b.z * c;
      const dd = Math.hypot(fx - bx, fz - bz) - b.r;
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    if (best < 4) this.hitMarks[best] = true;
    return best;
  }

  // restore_enemy_status from a 6x0A: hp = max - damage_taken, the hit flag.
  // The body's pool is one number on the wire (the dead flag is ignored: the
  // brain owns its death).
  setDamageTaken(total: number): void {
    if (this.st === 5) return;
    const hp = Math.max(0, this.maxHp - Math.max(0, Math.round(total)));
    if (hp < this.hp) {
      this.hp = hp;
      this.hitFlag = true;
    }
  }

  // The heal (ProcessVoloptHealInteraction sub 2): +iparam4 / 5 and 10 more.
  private heal(): void {
    const n = Math.trunc(this.move.iparam[3] / 5);
    this.hp = Math.min(this.maxHp, this.hp + n);
    for (let i = 0; i < 4; i++) if (this.partHp[i] > 0) this.partHp[i] = Math.min(this.partMax[i], this.partHp[i] + n);
    this.hp = Math.min(this.maxHp, this.hp + 10);
    this.sinceHp = this.hp;
    this.events.push({ kind: 'se', id: 0x95 });
  }

  // --- the frame -------------------------------------------------------------------

  tick(targets: readonly AiTarget[]): AiFrame {
    const out = this.out;
    out.motion = null;
    out.shots = undefined;
    this.sustained.clear();
    if (this.awake) this.update(targets);
    out.x = this.x;
    out.z = this.z;
    this.angle = this.heading * BAMS;
    out.angle = this.angle;
    if (this.pending.length) out.shots = this.pending.splice(0);
    return out;
  }

  // UpdatePlayerTechAndDamage: the death check, then the hit, then the state.
  private update(targets: readonly AiTarget[]): void {
    if (this.st !== 5 && this.hp <= 0) {
      this.go(5);
      return this.tickState(targets);
    }
    if (this.hitFlag && this.st !== 5) {
      if (this.ultimate) {
        // No reaction: the parts take the damage at once.
        this.hitFlag = false;
        this.splitDamage();
      } else if (this.flinch === 0 && this.st !== 7) {
        // State 4: the parts take it now and the body shakes for 6 frames.
        // A strike that lands during the shake waits for the next reaction.
        this.hitFlag = false;
        this.splitDamage();
        this.flinch = F2.flinch;
      }
    }
    if (this.flinch > 0) {
      this.flinch--;
      return;
    }
    this.tickState(targets);
  }

  // The marked parts share the damage the body took: (taken + n - 1) / n each
  // (6x18 follows).
  private splitDamage(): void {
    let n = 0;
    for (let i = 0; i < 4; i++) if (this.hitMarks[i] && this.partHp[i] > 0) n++;
    const taken = this.sinceHp - this.hp;
    this.sinceHp = this.hp;
    if (n === 0) {
      this.hitMarks.fill(false);
      return;
    }
    const each = Math.max(0, Math.trunc((taken + n - 1) / n));
    for (let i = 0; i < 4; i++) {
      if (this.hitMarks[i] && this.partHp[i] > 0) this.partHp[i] = Math.max(0, this.partHp[i] - each);
    }
    this.hitMarks.fill(false);
    this.events.push({ kind: 'partsHp', hp: this.partHp.slice() });
  }

  private tickState(targets: readonly AiTarget[]): void {
    if (this.dog.stuck(this.st * 32 + this.sub)) {
      // Nothing waits this long in the exe's timelines (the longest, the
      // prison's hold, is about 500 frames): leave the step.
      if (this.st === 5) this.sub = Math.min(4, this.sub + 1);
      else if (this.st !== 0) this.done();
    }
    switch (this.st) {
      case 0:
        break;
      case 1:
        // FUN_00448430.cpp: straight on to state 0.
        this.go(0);
        break;
      case 2:
        this.tickLaser(targets);
        break;
      case 5:
        this.tickDeath();
        break;
      case 7:
        this.tickStand();
        break;
      case 9:
        this.tickCapture(targets);
        break;
      case 10:
        this.tickMissiles(targets);
        break;
      case 0xb:
        this.tickHeal();
        break;
      case 0xc:
        this.tickArm(targets);
        break;
    }
    this.tickPrison(targets);
    this.hitMarks.fill(false);
  }

  private sustain(id: number): void {
    this.sustained.add(id);
  }

  private turnToward(x: number, z: number): number {
    const want = (Math.round(Math.atan2(x - this.x, z - this.z) / BAMS) + 0x10000 - 0x8000) & 0xffff;
    let diff = ((want - this.heading + 0x18000) & 0xffff) - 0x8000;
    const step = Math.max(-F2.turn, Math.min(F2.turn, diff));
    this.heading = (this.heading + step + 0x10000) & 0xffff;
    diff = Math.abs(diff);
    return diff;
  }

  private targetOf(targets: readonly AiTarget[]): AiTarget | null {
    for (let i = 0; i < targets.length; i++) if (targets[i].clientId === this.aim && !targets[i].dead) return targets[i];
    return null;
  }

  // Players within `radius` are pushed out to the interaction radius; ASSUMED
  // not applied to anybody (the owner would have to move the player).
  private done(): void {
    this.go(0);
  }

  // --- state 7: standing up (ProcessPlayerState7_CrouchProne) -----------------------

  private tickStand(): void {
    if (this.sub === 0) {
      this.anim.set(8);
      this.sub = 1;
    }
    this.anim.step();
    if (this.anim.reached(F2.standFrame) || this.anim.slot !== 8) this.done();
  }

  // --- state 10: the missiles ---------------------------------------------------------

  private tickMissiles(targets: readonly AiTarget[]): void {
    const t = this.targetOf(targets);
    // Sub-state 0 only sets up, then sub-state 1 runs in the same frame.
    if (this.sub === 0) {
      this.timer = F2.missileAim;
      this.waves = 0;
      this.sub = 1;
    }
    switch (this.sub) {
      case 1:
        if (t) this.turnToward(t.x, t.z);
        this.sustain(0x350);
        if (--this.timer < 1) {
          this.anim.set(7);
          this.sub = 2;
        }
        break;
      case 2:
        this.anim.step();
        if (this.anim.reached(F2.missileLaunchFrame)) {
          this.timer = F2.missileWait;
          this.sub = 3;
        }
        break;
      case 3:
        if (--this.timer < 1) this.sub = 4;
        break;
      case 4:
        this.waves++;
        this.launchMissiles(targets);
        this.events.push({ kind: 'se', id: 0x34d });
        this.timer = F2.missileGap;
        this.sub = 5;
        break;
      case 5:
        if (--this.timer < 1) {
          if (this.waves < F2.missileWaves) this.sub = 4;
          else {
            this.events.push({ kind: 'se', id: 0x34c });
            this.sub = 6;
          }
        }
        break;
      case 6:
        this.anim.step();
        if (this.anim.flag !== 4) this.done();
        break;
    }
  }

  // Up to four players in front of the body get a homing missile each (state
  // 10 sub 4). ASSUMED: they leave from 30 units in front, 26 up.
  private launchMissiles(targets: readonly AiTarget[]): void {
    const face = this.facing();
    let n = 0;
    const speed = this.move.fparam1;
    const accel = this.move.fparam2;
    const life = Math.round(this.move.fparam4) + 240;
    const power = this.move.iparam[0];
    for (let i = 0; i < targets.length && n < 4; i++) {
      const p = targets[i];
      if (p.dead) continue;
      const a = Math.round(Math.atan2(p.x - this.x, p.z - this.z) / BAMS + 0x10000) & 0xffff;
      const diff = Math.abs(((a - face + 0x18000) & 0xffff) - 0x8000);
      if (diff >= F2.missileArc) continue;
      n++;
      const fx = Math.sin(face * BAMS);
      const fz = Math.cos(face * BAMS);
      const sx = this.x + fx * 30;
      const sz = this.z + fz * 30;
      const dir: Vec3 = [fx, 0, fz];
      this.pending.push(new VoloptMissile(sx, 26, sz, dir, speed, accel, life, power, p.clientId));
    }
  }

  // --- state 0xB: the heal ------------------------------------------------------------

  private tickHeal(): void {
    switch (this.sub) {
      case 0:
        this.anim.set(5);
        this.sustain(0x351);
        this.sub = 1;
        break;
      case 1:
        this.anim.step();
        if (this.anim.reached(F2.healFrame)) {
          this.timer = F2.healWait;
          this.sub = 2;
        }
        break;
      case 2:
        this.sustain(0x353);
        if (--this.timer < 1) {
          this.heal();
          this.timer = F2.healPause;
          this.sub = 3;
        }
        break;
      case 3:
        if (--this.timer < 1) {
          this.sub = 4;
          this.sustain(0x351);
        }
        break;
      case 4:
        this.anim.step();
        if (this.anim.flag !== 4) this.done();
        break;
    }
  }

  // --- state 2: the laser and the bars -----------------------------------------------

  private tickLaser(targets: readonly AiTarget[]): void {
    // Sub-state 3 only sets the budget of the round, then sub-state 4 runs in the same frame.
    if (this.sub === 3) {
      // The budget of this round: nothing in the first one (iparam2 of the
      // prison row, 0 in Normal), 0x1555 after it.
      this.sweep = this.rounds === 0 ? this.prisonMove.iparam[1] * F2.laserTurn : F2.laserSweep;
      this.sub = 4;
    }
    switch (this.sub) {
      case 0:
        this.anim.set(2);
        this.rounds = 0;
        this.phase = 0;
        this.rotation = 0;
        this.sustain(0x350);
        this.sub = 1;
        break;
      case 1:
        this.anim.step();
        if (this.anim.reached(F2.laserFrame)) {
          this.timer = F2.laserCharge;
          this.sub = 2;
        }
        break;
      case 2:
        this.sustain(0x354);
        if (--this.timer < 1) {
          this.timer = F2.laserWait;
          this.sub = 3;
        }
        break;
      case 4: {
        this.sustain(0x350);
        this.rotation += F2.laserTurn;
        this.sweep -= F2.laserTurn;
        if (this.rounds === 0) {
          this.phase += F2.laserRadius[2];
          this.radius = F2.laserRadius[0] + Math.sin(this.phase * BAMS) * F2.laserRadius[1];
        }
        this.placePoints();
        if (this.sweep < 1) {
          if (this.rounds === 0) {
            let near = false;
            for (let k = 0; k < 4 && !near; k++) {
              for (let i = 0; i < targets.length; i++) {
                const t = targets[i];
                if (t.dead) continue;
                if (Math.hypot(t.x - this.points[k][0], t.z - this.points[k][2]) <= F2.laserHit) {
                  near = true;
                  break;
                }
              }
            }
            if (near || --this.timer < 1) this.sub = 5;
          } else {
            this.sub = 5;
          }
        }
        break;
      }
      case 5:
        // The prison bars drop at the four points (ASSUMED: no damage, no wall).
        this.timer = this.move.iparam[5];
        this.events.push({ kind: 'se', id: 0x35c });
        this.sub = 6;
        break;
      case 6:
        this.sustain(0x350);
        if (--this.timer < 1) {
          this.timer = 20;
          this.sub = 7;
        }
        break;
      case 7:
        if (--this.timer < 1) {
          this.timer = 5;
          this.sub = 8;
        }
        break;
      case 8:
        if (--this.timer < 1) {
          this.rounds++;
          if (this.rounds >= F2.laserRounds) {
            this.events.push({ kind: 'se', id: 0x351 });
            this.done();
          } else this.sub = 3;
        }
        break;
    }
  }

  // The four points turn round the body (0x180 a tick).
  private placePoints(): void {
    this.pointCount = 4;
    for (let k = 0; k < 4; k++) {
      const a = (this.rotation + k * 0x4000) * BAMS;
      this.points[k][0] = this.x + Math.sin(a) * this.radius;
      this.points[k][1] = 0;
      this.points[k][2] = this.z + Math.cos(a) * this.radius;
    }
  }

  // --- state 0xC: the Ultimate arm -------------------------------------------------------

  // The same bars at the players in a side arc (heading + 0x4000, 0x31c7 /
  // 0x471c); ASSUMED timeline: 90 frames, then the row's pause.
  private tickArm(targets: readonly AiTarget[]): void {
    const t = this.targetOf(targets);
    if (this.sub === 0) {
      this.timer = F2.armWait;
      this.sub = 1;
    }
    if (t) this.turnToward(t.x, t.z);
    this.sustain(0x350);
    if (--this.timer < 1) {
      this.pointCount = 0;
      let n = 0;
      const arc = this.ultimate ? F2.armArc[1] : F2.armArc[0];
      for (let i = 0; i < targets.length && n < 4; i++) {
        const p = targets[i];
        if (p.dead) continue;
        const a = Math.round(Math.atan2(p.x - this.x, p.z - this.z) / BAMS + 0x10000) & 0xffff;
        const diff = Math.abs(((a - ((this.heading + 0x4000) & 0xffff) + 0x18000) & 0xffff) - 0x8000);
        if (diff > arc) continue;
        this.points[n][0] = p.x;
        this.points[n][2] = p.z;
        n++;
      }
      this.pointCount = n;
      this.events.push({ kind: 'se', id: 0x35c });
      this.done();
    }
  }

  // --- state 9: the capture --------------------------------------------------------------

  private tickCapture(targets: readonly AiTarget[]): void {
    const t = this.targetOf(targets);
    // Sub-state 0 only sets up, then sub-state 1 runs in the same frame.
    if (this.sub === 0) {
      this.anim.set(6);
      this.sub = 1;
    }
    switch (this.sub) {
      case 1: {
        this.sustain(0x348);
        if (!t) {
          this.done();
          break;
        }
        if (this.turnToward(t.x, t.z) < F2.turn) {
          this.timer = F2.captureAim;
          this.sub = 2;
        }
        break;
      }
      case 2:
        if (--this.timer < 1) {
          this.throwCage(t);
          this.sub = 3;
        }
        break;
      case 3:
        // Wait for the cage: it hit (captured) or ran out.
        if (!this.cage) {
          if (this.captured !== 0xffff) {
            this.events.push({ kind: 'se', id: 0x345 });
            this.sub = 4;
          } else {
            this.done();
          }
        }
        break;
      case 4:
        this.anim.step();
        if (this.anim.reached(20)) {
          this.timer = F2.captureHold + this.move.iparam[4];
          this.sub = 5;
        }
        break;
      case 5:
        this.sustain(0x346);
        if (--this.timer < 1 || this.captured === 0xffff) {
          this.timer = F2.captureRelease;
          this.sub = 6;
        }
        break;
      case 6:
        this.sustain(0x355);
        if (--this.timer < 1) {
          this.timer = F2.captureAfter;
          this.sub = 7;
        }
        break;
      case 7:
        if (--this.timer < 1) {
          this.sub = 8;
          this.anim.set(6);
        }
        break;
      case 8:
        this.anim.step();
        if (this.anim.flag !== 4) this.done();
        break;
    }
  }

  // ConstructVoloptPrisonEntity: the cage leaves at row 38
  // fparam1 along the body's facing for iparam1 frames.
  private throwCage(t: AiTarget | null): void {
    const face = this.facing() * BAMS;
    const v = this.prisonMove.fparam1 || 1.24;
    this.cage = { x: this.x, z: this.z, vx: Math.sin(face) * v, vz: Math.cos(face) * v, life: this.prisonMove.iparam[0] || 130, target: t ? t.clientId : 0xffff };
    this.events.push({ kind: 'se', id: 0x356 });
  }

  // The cage's flight, the prison's hold and its release.
  private tickPrison(targets: readonly AiTarget[]): void {
    const c = this.cage;
    if (c) {
      c.x += c.vx;
      c.z += c.vz;
      let caught = 0xffff;
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (t.dead) continue;
        if (Math.hypot(t.x - c.x, t.z - c.z) <= F2.cageReach) {
          caught = t.clientId;
          break;
        }
      }
      if (caught !== 0xffff) {
        // SetupVoloptInteraction / the prison entity: the player is held for
        // iparam5 + 450 frames unless the prison (row 38 HP) is destroyed.
        this.captured = caught;
        this.prisonTimer = F2.prisonLife + this.move.iparam[4];
        this.prison.hp = this.prison.maxHp;
        this.prison.dead = false;
        this.prison.hit = false;
        this.prison.targetable = true;
        const p = targets.find((x) => x.clientId === caught);
        if (p) {
          this.prison.x = p.x;
          this.prison.z = p.z;
        }
        this.prison.y = 15;
        this.events.push({ kind: 'se', id: 0x34e });
        this.cage = null;
      } else if (--c.life < 1) {
        this.cage = null;
      }
    }
    if (this.captured !== 0xffff) {
      this.prison.hit = false;
      if (this.prison.hp <= 0 || --this.prisonTimer < 1) this.releasePrison();
    }
  }

  private releasePrison(): void {
    this.captured = 0xffff;
    this.cage = null;
    this.prison.targetable = false;
    this.prison.dead = true;
    this.prison.hp = 0;
  }

  // --- state 5: the death (ProcessPlayerVoloptTransition) ------------------------------------

  // 60 frames of shaking, the camera, the death motion held to frame 47, and
  // at that frame the kill: on_enemy_killed (EXP and the drop), the dead flag,
  // set_monster_spawn_initdata_as_dead (6x76), VoloptDeathHandler. 16 more
  // frames, then the body is deleted.
  private tickDeath(): void {
    switch (this.sub) {
      case 0:
        this.releasePrison();
        this.pointCount = 0;
        this.cage = null;
        this.anim.set(0);
        this.timer = F2.deathHold;
        this.sub = 1;
        break;
      case 1:
        this.sustain(0x35b);
        this.sub = 2;
        break;
      case 2:
        this.sustain(0x35b);
        if (--this.timer < 0) {
          this.anim.set(4);
          this.sub = 3;
        }
        break;
      case 3:
        this.anim.step();
        this.sustain(0x35b);
        if (this.anim.reached(F2.deathFrame) || this.anim.atEnd) {
          this.killedAt = [this.x, 0, this.z];
          this.events.push({ kind: 'killed', x: this.x, y: 0, z: this.z });
          this.timer = F2.deathLeave;
          this.sub = 4;
        }
        break;
      case 4:
        if ((this.timer & 3) === 0) this.events.push({ kind: 'se', id: 0x349 });
        if (--this.timer < 1) this.sub = 5;
        break;
    }
  }

  // The body is gone (deleted at the end of sub 4).
  get removed(): boolean {
    return this.st === 5 && this.sub >= 5;
  }

  // --- BrainBase ------------------------------------------------------------------------

  onDamage(): void {
    // Every hit goes through hit() / setDamageTaken().
  }

  resume(): string {
    return this.state;
  }
}

const FORM2_NAMES: Record<number, string> = {
  0: 'idle',
  1: 'walk',
  2: 'laser',
  4: 'hit',
  5: 'death',
  7: 'standing',
  9: 'capture',
  10: 'missiles',
  11: 'heal',
  12: 'arm',
};

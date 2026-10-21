// Per-family enemy state machines of Episode 2, part 2 (PsoBB.exe, Ephinea
// 1.25.13, addresses are VAs): Gee, Gi Gue and Gibbles. Same EnemyBrain shape
// as combat/enemyfsmep2.ts (Merillia / Dolmolm) and combat/enemyfsm.ts, so
// render/combat.ts drives them the same way.
//
// The Ghidra dump names these three families wrongly (Gee's functions are
// "Sinowberill*", its shot "GiGues_*", Gibbles' are "Derolle*"); they were
// matched by constructor, vtable and motion table, never by name:
//   Gee      factory 0x0055c974, vtable 0x00b051c0, motion table 0x009bdf80,
//   Gibbles  ctor 0x00563200, vtable 0x00b054e0, motion table 0x009be180,
//   Gi Gue   ctor 0x0056beb4, vtable 0x00b05a20, motion table 0x009be5c0.
//
// The Episode 2 decompilation psobb-client-source (JP build) has no C for any
// of these handlers; everything here is the Ephinea dump plus the disassembly
// of the same build (objdump of PsoBB.exe for the pieces the dump leaves
// unnamed: the vtables, the dispatcher jump tables, the float constants).
// Sound effects are cited, not played.

import { BAMS_TO_RAD, type AiFrame, type AiTarget, type EnemyAiMotion } from './enemyai.ts';
import type { EnemyAttackData, EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase, loop, once, turnToward, wrap } from './enemyfsm.ts';
import { PLAYER_AIM_HEIGHT, EnemyShot, type ShotEffect, type ShotLook } from './enemyshots.ts';
import { BOOMA_MELEE } from './enemyfsmep2.ts';
import { STATUS } from './status.ts';
import { exhaustive } from '../exhaustive.ts';
import { techReach } from './techfire.ts';
import { TECH } from './techniques.ts';

const fr = Math.fround;

// --- Gee ------------------------------------------------------------------------
//
// A hovering insect: it rises out of the ground (or drops from the ceiling),
// climbs to 45 units, shoots a volley of slow spikes (or, for the melee-only
// variant, lunges at the player and stings with a chance to slow), then
// strafes round the player in four quick dashes before the next attack.
//
// Factory CreateSinowberillInstance_0055c974 (object 0x498 bytes, base
// constructor 0x005216f4, vtable 0x00b051c0), InitializeSinowberillEntity
// _0055fbc4. Set entry params (enemy+0x35c .. 0x368):
//   param1 (round-down == 0 -> flag 0x100: melee only; else flag 0x200: the
//     shoot, shoot, melee pattern of ChooseAttack),
//   param2 (== 0 -> flag 0x2000000: rise from the ground (state 1); else
//     0x4000000: drop from the ceiling (state 2)),
//   param3 -> the descent step 0x408 = max(1.0, param3 + 1.0)
//     (InitializeSinowberillAttackParams_0055ca5c, 0x00925798),
//   param4 -> the spike speed 0x404 = max(0.01, 6.0 + param4)
//     (0x009257a0, 0x0092579c).
// MovementData row 7 (**0x434): fparam1 the lunge speed, fparam2 the spike's
// tech power, iparam1 the charge frames (+0x18), iparam3 the recovery frames
// (+0x20), iparam4 the spikes per volley (+0x24), iparam5 the flinch hold
// (+0x28). Motion table 0x009bdf80: row 0 wait (motion 3, 0.9, loop), 1 attack
// (2, 1.0), 2 (0, 1.0), 3 flinch (1, 0.8); every one-shot row chains back to
// row 0 (the engine resets enemy+0xb8 when it ends).
//
// Per frame (EnemyTransitionAiState_0051f5bc, vtable +0x15c): the state's
// transition check (handler arg 3) unless the state was just entered, then the
// frame (arg 0); SetEnemyAiState_0051f62c runs the old state's exit (arg 5)
// and the new state's enter (arg 4) at once. Then SinowberillProcessAttackState
// (the colour fade, 0x0055cbf4). The dispatcher is 0x0055d11c (jump table
// 0x00925500):
//   0 spawn 0x0055fa24    1 rise 0x0055f070     2 drop 0x0055eefc
//   3 idle 0x0055ede4     4 alert (vt +0x1c0 = 0x0055c5f4)
//   5 climb (vt +0x1c4 = 0x0055c798)            6 (pack only) 0x0055ebb8
//   7 shoot 0x0055e488    8 melee 0x0055dd78    9 strafe 0x0055d9cc
//   10 (pack only) 0x0055d8d4    12 killed 0x0055d800    13 flinch 0x0055d4e8
//   14 vanish (vt +0x1c8 = 0x0055c840)  15 lost target 0x0055d32c
//   17 / 18 idle fidgets (0x0055d2ac / 0x0055d220): entered by nothing here.
// States 6 and 10 are not reproduced: no Gee the factory makes reaches them
// (checked on PsoBB.exe 1.25.13, 2026-10-21; see docs/DEVLOG.md). The role
// field enemy+0x3cc is written only by the factory, as 0 (0x0055ca28; no set
// parameter, and no other code the Gee runs, writes it). Entries into them:
//   4 alert, transition (0x0055c6e5 .. 0x0055c723): push 6 only if 0x3cc == 1,
//     else push 5 (climb). 0x3cc is 0, so it always climbs.
//   7 shoot exit (0x0055e9e1): push 10 only if flag 0x100000 of enemy+0x3d0 is
//     clear, else push 9 (strafe). The spawn (0x0055fa71 .. 0x0055fa81) sets
//     0x100000 whenever 0x3cc == 0, and no code the Gee runs clears it (the
//     masks 0xffefffff in the exe are in other families). So the exit is always
//     9, and 10 never runs; its own exit to 6 (0x0055d959, when the float at
//     enemy+0x3b4 is below the constant at 0x00925730) is then unreachable too.
// The handlers are in the exe (6 at 0x0055ebb8, 10 at 0x0055d8d4) and are left
// out: porting unreachable code would be guesswork.
//
// Not reproduced: the line-of-sight rays (a Gee sees a player through walls),
// the knockback slide in the flinch (0x30c velocity), the ground height
// (ASSUMED flat: heights are above the ground under the Gee), the death
// effect (a killed Gee goes to state 14, which only plays SE 0x250 / 0x2f3 and
// deletes it: the owner removes it), and the spike's collision with walls.
export const GEE = {
  search: 200, // FindEnemyTarget_00520ea0(this, 200.0)
  retarget: 45, // unknown_set_state_interval_maybe(this, 0x2d)
  hover: 15, // enemy+0x3f4 (0x41700000)
  high: 45, // enemy+0x3f0 (0x42340000)
  ceiling: 150, // 0x009256a4: the drop's start above the ground
  altStep: fr(0.5), // 0x00925754 / 0x00925758
  // The colour fade (0x0055cbf4): 0.06 a frame (0x00925788) between 0 and 1.
  fadeStep: fr(0.06),
  emergeFrames: BOOMA_MELEE.emergeFrames, // InitializeEnemyStateTimer_00576c48
  spawnFrames: 4, // state 0: the check passes once the counter exceeds 3
  // state 7
  shootRange: 70, // 0x009256b4
  aimStep: fr(0.6), // 0x009256bc
  shootTurn: 0x200, // BAMS a frame
  shootMove: fr(0.5),
  fireFrames: 14, // the volley's release: counter > 0xe
  shotLife: 150, // GiGues_Constructor_0055fecc: enemy+0xc0 = 0x96
  shotRange: 1000, // GiGuesProjectile_CheckLifetime_007ace88 (0x20)
  shotBody: 5, // the shot's collision box radius (0x48 = 5.0)
  muzzleHeight: 45, // enemy+0x3f0 added to the muzzle node (ASSUMED node height 0)
  // state 8
  meleeFirst: 0x28, // enemy+0x440 on entry
  meleeAcquire: 0x29,
  lockRange: 100, // 0x009256e4
  lungeRange: 40, // 0x009256e8
  strikeRange: 18, // 0x00925700
  restrike: 13, // 0x009256ec
  strikes: 3,
  strikeFrame: 10,
  slowChance: fr(0.25), // 0x009256f0 (the roll against group 0x11)
  dashFrames: 4,
  dashSpeed: fr(956.25 ** 0.5 * 0.25), // 0x009256fc * 0x009256d8 / sqrt(956.25)
  dashCos: 30 / Math.sqrt(956.25), // 0x009256e0
  dashSin: 7.5 / Math.sqrt(956.25), // 0x009256dc
  // state 9
  strafeRadius: 70, // 0x00925714
  strafeFrames: 8,
  strafeStep: fr(0.125), // 0x00925718
  strafeBase: 12288, // 0x0092571c / 0x00925720
  strafeSpread: 8192, // 0x00925728
  strafeTurnFrames: 31,
  strafeCycles: 3, // the check passes once the counter exceeds 3
  // state 13
  flinchFloor: 20, // 5.0 (0x0092573c) + hover 15
  flinchGravity: fr(0.13), // 0x00925744
  flinchFall: -4, // 0x00925738
  flinchBounce: 27, // 12.0 (0x00925740) + hover 15
  flinchDamp: fr(30), // 0x00925748
  // state 15
  lostWait: 59,
  homeRange: 2, // 0x00925760
  homeSpeed: fr(0.8), // the literal of GalGryphonHandleHitCheck_00520adc in state 15
  turnFast: 0x400,
} as const;

const GEE_ANIM = {
  wait: loop(3, 0.9),
  attack: once(2, 1),
  flinch: once(1, 0.8),
} as const;

// exe ids: 0 spawn, 1 rise, 2 drop, 3 idle, 4 alert, 5 climb, 7 shoot, 8
// melee, 9 strafe, 13 flinch, 15 lost.
// No states 6 / 10 here: the exe's pack states are unreachable for a Gee (see
// the note in the Gee section above). Only the states a Gee enters are listed.
export type GeeState = 'spawn' |'rise' | 'drop' | 'idle' | 'alert' | 'climb' | 'shoot' | 'melee' | 'strafe' | 'flinch' | 'lost';

// The Gee's spike (GiGues_Constructor_0055fecc over GiGuesProjectile
// _Constructor_007acaf8): flies straight from the muzzle toward the aim point
// at the spike speed a frame, dies after 150 frames, 1000 units, or on the
// ground; the first player in its 5-unit body takes entity_hit_by_tech group 0
// with MovementData fparam2.
export class GeeSpike extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xe0c040, size: 1.2 };
  private vx: number;
  private vy: number;
  private vz: number;
  private travelled = 0;
  private life = GEE.shotLife;
  private speed: number;

  constructor(x: number, y: number, z: number, toX: number, toY: number, toZ: number, speed: number, power: number) {
    super(x, y, z);
    const dx = toX - x;
    const dy = toY - y;
    const dz = toZ - z;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.vx = (dx / len) * speed;
    this.vy = (dy / len) * speed;
    this.vz = (dz / len) * speed;
    this.effect = { kind: 'tech', power };
    this.speed = speed;
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    // ProcessState_007acda0: UpdatePosition, then CheckLifetime.
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    if (GEE.shotRange < this.travelled) {
      this.done = true;
      return [];
    }
    this.travelled += this.speed;
    // ASSUMED flat ground: the map ray-cast that ends it is the floor.
    if (this.y <= 0) {
      this.done = true;
      return [];
    }
    // ASSUMED: the player is an upright cylinder of radius 5 and height
    // 2 * PLAYER_AIM_HEIGHT (the spike aims at its feet).
    for (const t of targets) {
      if (t.dead) continue;
      if (Math.hypot(t.x - this.x, t.z - this.z) <= GEE.shotBody + 5 && this.y <= 2 * PLAYER_AIM_HEIGHT) {
        this.done = true;
        return [t];
      }
    }
    if (--this.life <= 0) this.done = true;
    return [];
  }
}

export class GeeAi extends BrainBase {
  state: GeeState | 'dead' = 'spawn';
  // The owner keeps these two current.
  confused = false;
  hpFraction = 1;
  private meleeOnly: boolean;
  private ground: boolean; // flag 0x2000000: rise instead of drop
  private climbStep: number; // enemy+0x408
  private spikeSpeed: number; // enemy+0x404
  private lungeSpeed: number;
  private spikePower: number;
  private charge: number;
  private recover: number;
  private volley: number;
  private holdFrames: number;
  private homeX: number;
  private homeZ: number;
  // Heights above the ground (enemy+0x400 - 0x3c).
  private alt: number = GEE.hover;
  private altRef: number = GEE.hover; // enemy+0x3fc, written by the rise/drop states only
  private arrived = false; // flag 0x80000
  private alerted = false; // flag 0x1
  private locked = false; // flag 0x40000
  private lastState: GeeState = 'spawn';
  private sub = 0; // enemy+0x43c
  private cnt = 0; // enemy+0x440
  private cnt2 = 0; // enemy+0x444
  private shots = 0; // enemy+0x410
  private pattern = 0; // enemy+0x438
  private resumeState: GeeState = 'idle'; // enemy+0x380
  private timer = 0; // the 0x3d4 state timer
  private fadeWait = 0; // enemy+0x40c
  private searchTimer = 0; // enemy+0x3b8
  private row = 0; // enemy+0xb8
  private frames = 0; // current_animation_elapsed
  private immune = false; // SetEnemyInvulnerableAndImmune
  private hitPending = false;
  // Target position and velocity (enemy+0x39c .. 0x3b4).
  private tx = 0;
  private tz = 0;
  private dirX = 0;
  private dirZ = 0;
  private gap = 0;
  // The spike's aim point (enemy+0x45c), the strafe vector and rates.
  private aimX = 0;
  private aimY = 0;
  private aimZ = 0;
  private ux = 0;
  private uz = 0;
  private turnRate = 0; // enemy+0x44c, BAMS
  private radial = 0; // enemy+0x454
  private radialStep = 0; // enemy+0x458
  private altStep = 0; // enemy+0x450 (the strafe's, the flinch's velocity)
  private altAccel = 0; // enemy+0x454 in the flinch
  // The colour fade (enemy+0x470, mode 0x484).
  private fadeValue = 0;
  private fadeMode = 0;

  constructor(opts: { x: number; z: number; angle: number; params: readonly number[]; movement: EnemyMovementData | null; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    const p = (i: number) => opts.params[i] ?? 0;
    this.meleeOnly = Math.floor(p(0)) === 0;
    this.ground = Math.floor(p(1)) === 0;
    const climb = fr(p(2) + 1);
    this.climbStep = climb <= 1 ? 1 : climb;
    const speed = fr(6 + p(3));
    this.spikeSpeed = speed <= fr(0.01) ? fr(0.01) : speed;
    const mv = opts.movement;
    this.lungeSpeed = mv?.fparam1 ?? 1;
    this.spikePower = mv?.fparam2 ?? 0;
    this.charge = mv?.iparam[0] ?? 0;
    this.recover = mv?.iparam[2] ?? 0;
    this.volley = mv?.iparam[3] ?? 1;
    this.holdFrames = mv?.iparam[4] ?? 0;
    this.homeX = opts.x;
    this.homeZ = opts.z;
    this.current = GEE_ANIM.wait;
    // The factory enters state 0 (InitializeSinowberillEntity vtable +0x164).
    this.enterSpawn(this.frame());
  }

  // The drawn height above the ground is enemy+0x3fc (SinowberillRender
  // _0055ce54 translates by it), which only the rise and drop states write
  // (vtable +0x168): the altitude enemy+0x400 the other states change feeds
  // the line-of-sight origin and the sound position, not the model.
  get lift(): number {
    return this.altRef;
  }

  // vtable +0x184 .. 0x188 (the hit boxes are off while it spawns) and
  // SetEnemyInvulnerableAndImmune_0053fdf0 in the dashes.
  get invulnerable(): boolean {
    return this.state === 'spawn' || this.state === 'rise' || this.state === 'drop' || this.immune;
  }

  // Every hit has its own flinch (state 13): the owner does not play the
  // damage motion.
  flinches(): boolean {
    return false;
  }

  private setRow(out: AiFrame, row: number): void {
    this.row = row;
    this.frames = 0;
    this.play(out, row === 0 ? GEE_ANIM.wait : row === 1 ? GEE_ANIM.attack : GEE_ANIM.flinch);
  }

  private setState(out: AiFrame, s: GeeState): void {
    const prev: GeeState = this.state === 'dead' ? 'spawn' : this.state;
    this.exit(out, prev);
    this.state = s;
    this.enter(out, s, prev);
  }

  // --- the colour fade: SinowberillProcessAttackState_0055cbf4 -------------------
  private fade(): void {
    if (this.fadeMode === 1) {
      if (this.fadeValue <= 0) {
        this.fadeMode = 0;
        this.fadeValue = 0;
      } else this.fadeValue = fr(this.fadeValue - GEE.fadeStep);
    } else if (this.fadeMode === 2) {
      if (1 <= this.fadeValue) {
        this.fadeMode = 0;
        this.fadeValue = 1;
      } else this.fadeValue = fr(this.fadeValue + GEE.fadeStep);
    }
  }

  // --- altitude: SinowberillQuantizeValue_0055d474 / MoveTowardsTarget ------------
  private approachAlt(to: number, step: number): void {
    const d = to - this.alt;
    if (d >= step) {
      this.alt += step;
      this.arrived = false;
    } else if (d <= -step) {
      this.alt -= step;
      this.arrived = false;
    } else {
      this.alt = to;
      this.arrived = true;
    }
  }

  private quant(to: number): void {
    this.approachAlt(to, GEE.altStep);
  }

  // --- targets --------------------------------------------------------------------
  // FindEnemyTarget_00520ea0 / EnemyUpdateTarget_00520ebc: every 45 frames the
  // nearest player within the radius (FindNearestPlayer_00521160), kept in
  // between while it stays valid.
  private find(targets: readonly AiTarget[], radius: number): AiTarget | null {
    if (this.searchTimer < GEE.retarget) {
      this.searchTimer++;
      const t = this.target(targets);
      if (!t) this.targetId = null;
      return t;
    }
    this.searchTimer = 0;
    let best: AiTarget | null = null;
    let bestSq = radius * radius;
    for (const t of targets) {
      if (t.dead) continue;
      const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
      if (d >= bestSq) continue;
      best = t;
      bestSq = d;
    }
    this.targetId = best ? best.clientId : null;
    return best;
  }

  // EnemyResolveTarget_00520f04 and the rest of CheckEnemyTargetVisibility
  // (ASSUMED always visible).
  private resolve(targets: readonly AiTarget[]): AiTarget | null {
    const t = this.target(targets);
    if (!t) this.targetId = null;
    return t;
  }

  // SetEnemyTargetPosition + InitializeEnemyAnimationVelocity (0x00521410).
  private aimAt(t: AiTarget): void {
    this.tx = t.x;
    this.tz = t.z;
    this.velocity();
  }

  private velocity(): void {
    const dx = this.tx - this.x;
    const dz = this.tz - this.z;
    const len = Math.hypot(dx, dz);
    this.gap = len;
    this.dirX = len > 0 ? dx / len : 0;
    this.dirZ = len > 0 ? dz / len : 0;
  }

  // SinowberillUpdateRotationFromVelocity_0055e430: toward the velocity, 0x400
  // BAMS a frame.
  private turnToVelocity(max: number = GEE.turnFast): void {
    if (this.gap <= 0) return;
    this.angle = turnToward(this.angle, Math.atan2(this.dirX, this.dirZ), max * BAMS_TO_RAD);
  }

  private move(dx: number, dz: number, len: number): void {
    this.x += dx * len;
    this.z += dz * len;
  }

  // ApplyEntityMovementVector / ProcessEntityMovementUpdate: turn toward the
  // velocity (clamped), then step along the new heading.
  private moveAhead(turn: number, len: number): void {
    this.turnToVelocity(turn);
    this.x += Math.sin(this.angle) * len;
    this.z += Math.cos(this.angle) * len;
  }

  // --- state enter / exit (handler argument 4 / 5) --------------------------------
  private enterSpawn(out: AiFrame): void {
    this.setRow(out, 0);
    this.resumeState = 'idle';
    this.fadeMode = 1;
    this.sub = 0;
  }

  private enter(out: AiFrame, s: GeeState, prev: GeeState): void {
    switch (s) {
      case 'spawn':
        this.enterSpawn(out);
        break;
      case 'rise':
        this.setRow(out, 0);
        this.resumeState = 'idle';
        this.fadeMode = 1;
        this.timer = 0;
        break;
      case 'drop':
        this.setRow(out, 0);
        this.resumeState = 'idle';
        this.arrived = false;
        this.fadeMode = 1;
        this.timer = 0;
        this.alt = GEE.ceiling;
        this.sub = 0;
        this.warps++;
        break;
      case 'idle':
        this.setRow(out, 0);
        this.resumeState = 'idle';
        this.fadeMode = 1;
        break;
      case 'alert':
        this.setRow(out, 0);
        this.resumeState = 'alert';
        this.sub = 0;
        break;
      case 'climb':
        this.setRow(out, 0);
        this.resumeState = 'climb';
        break;
      case 'shoot':
        this.resumeState = 'shoot';
        this.fadeValue = 1;
        this.sub = 1;
        this.cnt = 0;
        break;
      case 'melee':
        this.setRow(out, 0);
        this.resumeState = 'melee';
        this.cnt = GEE.meleeFirst;
        this.arrived = false;
        this.sub = 0;
        this.cnt2 = 0;
        break;
      case 'strafe':
        this.setRow(out, 0);
        this.resumeState = 'strafe';
        this.sub = 1;
        this.cnt = 0;
        this.cnt2 = 0;
        this.immune = true;
        break;
      case 'flinch':
        // Hit while idle: SinowberillSetTargetEntity_0055d7b4 alerts it.
        if (prev === 'idle') this.alerted = true;
        this.setRow(out, 2);
        this.sub = 0;
        this.cnt = this.alt <= GEE.flinchFloor ? 2 : 0;
        this.altStep = 0;
        this.altAccel = 0;
        break;
      case 'lost':
        this.resumeState = 'lost';
        this.sub = 0;
        break;
      default:
        exhaustive(s);
    }
  }

  private exit(out: AiFrame, s: GeeState): void {
    switch (s) {
      case 'shoot':
        this.locked = false;
        this.fadeValue = 1;
        break;
      case 'strafe':
        this.immune = false;
        break;
      case 'flinch':
        // SinowberillProcessState_0055d4e8 argument 5: enemy+0xb8 = 0.
        this.setRow(out, 0);
        break;
      default:
        break;
    }
  }

  // ChooseAttack, vtable +0x1ac (0x0055c4bc): the melee-only variant (flag
  // 0x100) always lunges; the others shoot twice, then lunge.
  private chooseAttack(out: AiFrame): void {
    if (this.meleeOnly) {
      this.setState(out, 'melee');
      return;
    }
    if (this.pattern < 2) {
      this.pattern++;
      this.setState(out, 'shoot');
    } else {
      this.pattern = 0;
      this.setState(out, 'melee');
    }
  }

  // A hit (vtable +0x88 -> +0x100): the next tick's update loop starts the
  // flinch (SinowberillSetStateToD_0055f15c, state 13) and the Gee turns on the
  // attacker.
  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
    this.hitPending = true;
  }

  // The owner's flinch is not used (flinches() is false), so there is nothing
  // to resume.
  resume(): string {
    return this.state;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    // EnemyUpdateLoop_0052167c: a hit starts the flinch unless it is in it.
    if (this.hitPending) {
      this.hitPending = false;
      if (this.state !== 'flinch' && !this.invulnerable) this.setState(out, 'flinch');
    }
    // Player__Animate: a one-shot row ends and the engine resets enemy+0xb8.
    if (animationEnded && this.row !== 0) {
      this.row = 0;
      this.frames = 0;
      this.play(out, GEE_ANIM.wait);
    }
    this.frames += this.current?.speed ?? 0;
    // The transition check, skipped on the frame the state was entered in.
    if (this.lastState === this.state) this.check(out, targets);
    this.frameOf(out, targets);
    this.lastState = this.state as GeeState;
    this.fade();
    out.lift = this.altRef;
    return this.finish(out);
  }

  // Handler argument 3.
  private check(out: AiFrame, targets: readonly AiTarget[]): void {
    switch (this.state) {
      case 'spawn':
        if (this.sub > 3) this.setState(out, this.ground ? 'rise' : 'drop');
        break;
      case 'rise':
        if (this.timer >= GEE.emergeFrames) this.setState(out, 'idle');
        break;
      case 'drop':
        if (this.arrived) this.setState(out, 'idle');
        break;
      case 'idle':
        if (this.alerted) {
          this.alerted = false;
          this.setState(out, 'alert');
        } else if (this.resolve(targets)) this.setState(out, 'alert');
        break;
      case 'alert':
        if (this.alerted2) {
          this.alerted2 = false;
          this.setState(out, 'climb');
        }
        break;
      case 'climb':
        if (this.arrived) {
          this.shots = 0;
          this.chooseAttack(out);
        }
        break;
      case 'shoot':
        if (!this.target(targets)) this.setState(out, 'lost');
        else if (this.sub === 6) this.setState(out, 'strafe');
        break;
      case 'melee':
        if (!this.target(targets)) this.setState(out, 'lost');
        else if (this.sub === 5) this.setState(out, 'strafe');
        break;
      case 'strafe':
        if (!this.target(targets)) this.setState(out, 'lost');
        else if (this.cnt2 > GEE.strafeCycles) this.chooseAttack(out);
        break;
      case 'flinch':
        if (this.cnt === 3) this.setState(out, this.resumeState);
        break;
      case 'lost':
        if (this.sub === 2) this.chooseAttack(out);
        break;
      default:
        break;
    }
  }

  // Set by the alert state (flag 0x2 of enemy+0x3d0).
  private alerted2 = false;

  // Handler argument 0.
  private frameOf(out: AiFrame, targets: readonly AiTarget[]): void {
    switch (this.state) {
      case 'spawn':
        this.sub++;
        break;
      case 'rise':
        this.timer++;
        this.quant(GEE.hover);
        this.altRef = this.alt;
        break;
      case 'drop':
        if (this.sub === 0) {
          if (++this.timer >= GEE.emergeFrames) this.sub = 1;
        } else this.approachAlt(GEE.hover, this.climbStep);
        this.altRef = this.alt;
        break;
      case 'idle':
        this.find(targets, GEE.search);
        this.quant(GEE.hover);
        break;
      case 'alert':
        this.alertFrame(out, targets);
        break;
      case 'climb':
        this.find(targets, GEE.search);
        this.lookAtTarget(targets);
        this.quant(GEE.high);
        break;
      case 'shoot':
        this.shootFrame(out, targets);
        break;
      case 'melee':
        this.meleeFrame(out, targets);
        break;
      case 'strafe':
        this.strafeFrame(out, targets);
        break;
      case 'flinch':
        this.flinchFrame();
        break;
      case 'lost':
        this.lostFrame(out, targets);
        break;
      case 'dead':
        break;
      default:
        exhaustive(this.state);
    }
  }

  // SinowberillResolveAndSetTarget_0055edbc.
  private lookAtTarget(targets: readonly AiTarget[]): void {
    const t = this.resolve(targets);
    if (!t) return;
    this.aimAt(t);
    this.turnToVelocity();
  }

  // 0x0055c5f4 (vtable +0x1c0), subtype 0.
  private alertFrame(_out: AiFrame, targets: readonly AiTarget[]): void {
    this.find(targets, GEE.search);
    if (this.sub === 0) {
      // enemy+0x40c counts down from 0 (it is 0 on entry): the fade-up starts
      // at once.
      if (--this.fadeWait <= 0) {
        this.fadeMode = 2;
        this.sub = 1;
      }
    } else if (this.sub === 1) {
      if (this.fadeMode === 0) {
        this.alerted2 = true; // flag 0x2 (0x0053e538)
        this.sub = 3;
      }
      this.lookAtTarget(targets);
    } else if (this.sub === 3) this.lookAtTarget(targets);
    this.quant(GEE.hover);
  }

  // 0x0055e488.
  private shootFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    const t = this.sub === 1 ? this.find(targets, GEE.search) : this.resolve(targets);
    if (!t) return;
    this.tx = t.x;
    this.tz = t.z;
    switch (this.sub) {
      case 1:
        // Aim: fly toward the player until within 70.
        this.velocity();
        if (this.gap < GEE.shootRange) {
          this.sub = 2;
          this.locked = true;
        }
        this.moveAhead(GEE.shootTurn, GEE.shootMove);
        break;
      case 2:
        this.velocity();
        this.turnToVelocity();
        this.sub = 3;
        this.fadeValue = 1;
        this.aimX = t.x;
        this.aimY = 0;
        this.aimZ = t.z;
        break;
      case 3: {
        // Charge: the aim point creeps toward the player at 0.6 a frame.
        this.velocity();
        this.turnToVelocity();
        const dx = t.x - this.aimX;
        const dz = t.z - this.aimZ;
        const dy = 0 - this.aimY;
        const len = Math.hypot(dx, dz);
        if (GEE.aimStep <= len) {
          this.aimX += (dx / len) * GEE.aimStep;
          this.aimY += dy * GEE.aimStep;
          this.aimZ += (dz / len) * GEE.aimStep;
        } else {
          this.aimX = t.x;
          this.aimY = 0;
          this.aimZ = t.z;
        }
        if (this.charge < ++this.cnt) {
          this.sub = 4;
          this.setRow(out, 1);
          this.cnt = 0;
        }
        break;
      }
      case 4:
        if (++this.cnt > GEE.fireFrames) {
          this.sub = 5;
          this.locked = false;
          this.fadeValue = 1;
          this.shots++;
          out.shots = [new GeeSpike(this.x, GEE.muzzleHeight, this.z, this.aimX, this.aimY, this.aimZ, this.spikeSpeed, this.spikePower)];
          this.cnt = 0;
        }
        break;
      case 5:
        if (this.recover < ++this.cnt) {
          this.cnt = 0;
          this.sub = this.shots < this.volley ? 1 : 6;
        }
        break;
      default:
        break;
    }
    this.quant(GEE.high);
  }

  // 0x0055dd78.
  private meleeFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    const t = this.sub === 0 ? this.find(targets, GEE.search) : this.resolve(targets);
    if (!t) return;
    switch (this.sub) {
      case 0:
        this.aimAt(t);
        this.turnToVelocity();
        if (++this.cnt < GEE.meleeAcquire) break;
        this.cnt = 0;
        this.sub = 1;
        if (!this.locked) {
          // ASSUMED: the pack's claim test passes for a lone Gee.
          if (this.gap < GEE.lockRange) this.locked = true;
        } else if (this.gap < GEE.lungeRange) {
          this.sub = 2;
          this.fadeValue = 1;
        }
        // SinowberillLookAtTarget_0055fb84(0x3c + enemy+0x3fc).
        this.quant(this.altRef);
        break;
      case 1: {
        // The side step: 4 frames at 7.73 a frame along the player's direction
        // turned 14 degrees to alternating sides.
        if (this.cnt === 0) {
          this.aimAt(t);
          const s = this.cnt2 === 1 ? -GEE.dashSin : GEE.dashSin;
          this.cnt2 = this.cnt2 === 1 ? 0 : 1;
          const dx = this.dirX;
          const dz = this.dirZ;
          this.dirX = s * dz + GEE.dashCos * dx;
          this.dirZ = -s * dx + dz * GEE.dashCos;
          this.altStep = GEE.dashSpeed;
          this.altAccel = fr((GEE.hover - this.altRef) * 0.25); // 0x009256d8
        }
        this.immune = true;
        if (++this.cnt >= GEE.dashFrames) {
          this.cnt = 0;
          this.sub = 0;
          this.immune = false;
        }
        this.alt += this.altAccel;
        this.move(this.dirX, this.dirZ, this.altStep);
        break;
      }
      case 2:
        this.aimAt(t);
        this.turnToVelocity();
        this.quant(GEE.hover);
        if (this.gap < GEE.strikeRange) {
          if (this.altRef < 20) {
            this.cnt = 0;
            this.sub = 3;
          }
        } else {
          if (this.gap > GEE.lungeRange) this.sub = 1;
          this.moveAhead(0x200, this.lungeSpeed);
        }
        break;
      case 3:
      case 4:
        this.strikeFrame(out, t);
        break;
      default:
        break;
    }
  }

  // Sub 3 / 4 of the melee: the sting.
  private strikeFrame(out: AiFrame, t: AiTarget): void {
    if (this.sub === 3) {
      this.sub = 4;
      this.setRow(out, 1);
    }
    this.aimAt(t);
    this.turnToVelocity();
    this.cnt++;
    if (this.row === 0) {
      if (this.shots < GEE.strikes) {
        const far = this.gap >= GEE.restrike;
        this.cnt = 0;
        if (far) {
          if (this.gap >= GEE.lungeRange) {
            this.sub = 1;
            this.fadeValue = 1;
            if (this.gap > GEE.lockRange) this.locked = false;
          } else this.sub = 2;
        } else this.sub = 3;
      } else this.sub = 5;
    } else if (this.crossed(GEE.strikeFrame)) {
      this.shots++;
      if (this.altRef < 20 && this.gap < GEE.lungeRange) {
        // ASSUMED: the exe tests nothing between the frame and the hit.
        out.hit = { clientId: t.clientId, knockback: 3, mult: 1 };
        if (Math.fround(this.rng()) <= GEE.slowChance) out.status = { clientId: t.clientId, type: STATUS.slow };
      }
    }
    // SinowberillLookAtTarget_0055fb70: the hover height.
    this.quant(GEE.hover);
  }

  // check_entity_animation_elapsed_threshold: the frame passed `f` this tick.
  private crossed(f: number): boolean {
    const step = this.current?.speed ?? 0;
    return this.frames - step <= f && f < this.frames;
  }

  // 0x0055d9cc.
  private strafeFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    const t = this.find(targets, GEE.search);
    if (!t) return;
    if (this.sub === 1) {
      if (this.cnt === 0) {
        this.aimAt(t);
        const rr = this.rng() * 2 - 1;
        const base = 0 <= GEE.strafeSpread * rr ? GEE.strafeBase : -GEE.strafeBase;
        this.turnRate = Math.trunc((base + GEE.strafeSpread * rr) * GEE.strafeStep);
        this.radialStep = fr((GEE.strafeRadius - this.gap) * GEE.strafeStep);
        this.altStep = fr(GEE.strafeStep * (GEE.high - this.altRef));
        this.ux = -this.dirX;
        this.uz = -this.dirZ;
        this.radial = this.gap;
      }
      if (++this.cnt > GEE.strafeFrames - 1) {
        this.cnt2++;
        this.sub = 0;
        this.immune = false;
      }
      this.alt += this.altStep;
      // RotateVector2D_00782b64 (the side is the roll's sign).
      const a = this.turnRate * BAMS_TO_RAD;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const nx = this.ux * c + this.uz * s;
      const nz = -this.ux * s + this.uz * c;
      this.ux = nx;
      this.uz = nz;
      this.radial += this.radialStep;
      const px = this.ux * this.radial + this.tx;
      const pz = this.uz * this.radial + this.tz;
      this.x = px;
      this.z = pz;
      this.angle = Math.atan2(this.ux, this.uz) + Math.PI;
    } else if (this.sub === 0) {
      this.aimAt(t);
      this.turnToVelocity();
      this.quant(GEE.high);
      if (++this.cnt >= GEE.strafeTurnFrames) {
        this.cnt = 0;
        this.sub = 1;
      }
    }
    void out;
  }

  // 0x0055d4e8.
  private flinchFrame(): void {
    if (this.cnt === 0) {
      let v = Math.max(GEE.flinchFall, fr(this.altStep - GEE.flinchGravity));
      this.alt += v;
      if (this.alt < GEE.flinchBounce) {
        v = v <= fr(0.5 * GEE.flinchFall) ? v : fr(0.5 * GEE.flinchFall);
        this.altAccel = fr((v * v) / GEE.flinchDamp);
        this.cnt = 1;
      }
      this.altStep = v;
    } else if (this.cnt === 1) {
      const v = fr(this.altStep + this.altAccel);
      this.altStep = v;
      this.alt += v;
      if (v >= 0 && this.alt > GEE.hover) {
        this.alt = GEE.hover;
        this.sub = 0;
        this.cnt = 2;
      }
    } else if (this.cnt === 2) {
      if (this.holdFrames <= ++this.sub) this.cnt = 3;
    }
  }

  // 0x0055d32c.
  private lostFrame(_out: AiFrame, targets: readonly AiTarget[]): void {
    if (this.find(targets, GEE.search)) this.sub = 2;
    if (this.sub === 0) {
      if (++this.cnt > GEE.lostWait) this.sub = 1;
      this.quant(this.altRef);
    } else if (this.sub === 1) {
      this.tx = this.homeX;
      this.tz = this.homeZ;
      this.velocity();
      this.turnToVelocity();
      this.quant(GEE.high);
      if (this.gap > GEE.homeRange) this.move(this.dirX, this.dirZ, GEE.homeSpeed);
    }
  }

  override kill(): void {
    super.kill();
    this.immune = false;
  }
}

// --- Gi Gue ---------------------------------------------------------------------
//
// A big hopping beast: it drops out of the sky (or emerges), turns toward a
// player in reach and spits three confusing spit volleys, puts up a barrier
// that blocks hits (a blocked hit answers with a Rafoie bomb), casts Jellen /
// Zalure at nearby players and hops away from the player.
//
// Ctor GiGuesConstructor_0056beb4 (object 0x460 bytes, vtable 0x00b05a20, AI
// record 0x009be6e4 {search 150, wander speed 0, turn 768 BAMS}, motion table
// 0x009be5c0). GiGuesUpdate_005695ec runs GibblesAcquireTarget_0056b9dc, then
// the state of enemy+0x32e through GibblesProcessAIState_005697b8: a state
// request (enemy+0x37c) first runs the old state with sub-state -1 (its exit),
// then the new one with sub-state 0 (its entry and first frame); a state ends
// itself by setting enemy+0x384 = -1 or by writing a request. Flag
// enemy+0x390 & 1 locks the requests until the flinch (state 4) is over.
//   0 idle 0x0056b7d0      1 approach 0x0056b4e8   4 flinch 0x0056b248
//   5 death 0x0056b19c     7 emerge 0x0056b09c     9 volley 0x0056aadc
//   10 bomb 0x0056a7a4     11 prepare 0x0056a3cc   12 barrier 0x0056a2cc
//   13 hop 0x00569a64      14 fall 0x00569820      3 (Booma chase): unreached.
// Set entry params: param1 > 0 starts in the fall from the sky (otherwise
// the emergence), param2 the idle radius (default 50 below 1), param3 + 150
// the fall height (not below 0), param4 + 0.5 the chance of the barrier / hop
// follow-ups, param5 + 0.5 the chance of the hop after a close approach.
// MovementData row 26 (g_GiGue_AnimSpeeds, 0x00a73d9c): fparam1 the hop speed,
// fparam2 the bomb speed, fparam3 the spit speed (and its hit radius), fparam4
// / fparam5 the spit's steering strength and its change per frame, fparam6 the
// chance a spit also confuses, iparam1 the bomb's damage, iparam2 the spit's,
// iparam3 the Jellen / Zalure level, iparam4 * 30 the barrier's life,
// iparam5 the minimum round length. AttackData row 26 distance_x / angle give
// the reach and the arc (GiGuesSetSpecialAttackParams_0056c22c).
//
// The stomp (prepare frame 10, 0x0056a48d / 0x0056a49d): two technique objects
// at the Gi Gue's own position, the Zalure (0x006f1eb0, tech 12) then the Jellen
// (0x006e7998, tech 11), both at the level iparam3. They have no target list:
// their one update is the area tick (AoE_TechDamageTick_006deadc), which hits
// every player within the object's reach (techReach: range_h + 5). The debuff
// is reported through `events`.
//
// Not reproduced: the objects' own look (the stomp's effect and sound), wall
// rays (flat ground), the barrier's own motions (ASSUMED 20 frames each), the
// pack-less hop direction search (the three 120 degree rays: with open ground
// the first is taken).
export const GIGUE = {
  search: 150, // AI record [0]
  turn: 768, // AI record [2], BAMS a frame
  acquire: 30, // vtable +0x44(0x1e)
  near: 50,
  extra: 50, // g_GibblesExtendedTargetRange (0x009262c8)
  skyBase: 150, // 0x009262b0
  chanceBias: fr(0.5), // 0x009262b4
  idleRoam: 1, // 0x009262b8
  idleFloor: 50, // param2 below 1 becomes 50.0
  emerge: BOOMA_MELEE.emergeFrames,
  // idle (state 0)
  idleWalk: 150, // 0x96
  idleStand: 90, // 0x5a
  spellDist: 400, // 0x009262dc
  spellMin: fr(0.4), // 0x009262cc
  // fall / landing
  fall: fr(2.3), // 0x00926360
  landScale: fr(2.3), // 0x00926368
  landBase: fr(1), // 0x00926364
  landEmerge: 40, // 0x0092635c
  landHop: fr(1), // 0x00926350
  // hop
  hopWait: 60,
  hopRise: fr(2.2), // 0x00926334
  hopTop: 50, // 0x00926330
  hopLeg: 200,
  hopArrive: 10, // 0x0092634c
  hopTurn: 2,
  hopBack: 15, // 0x00926348
  // attacks
  volleyRounds: 3,
  volleyMin: 20,
  bombMin: 40,
  prepareFrame: 5, // 0x00926320
  stompFrame: 10, // 0x00926324
  volleyFrameA: 5, // 0x00926308
  volleyFrameB: 10, // 0x0092630c
  bombFrameA: 5, // 0x00926314
  bombFrame: 20, // 0x00926318
  barrierWander: 45,
  barrierMotion: 20, // ASSUMED
  spitLife: 90, // 0x5a
  spitDelay: 3,
  spitCloseSq: 22500, // 0x0092653c
  spitClose: fr(2), // 0x00926538
  bombRadiusSq: 1600, // 0x00a73dd4
  bombRange: 1000, // GiGuesProjectile_CheckLifetime
  flinchSlide: fr(0.5), // 0x009262f0
  flinchNearSq: 400, // 0x009262f8
} as const;

interface GiGueRow {
  motion: number;
  speed: number;
  loop: boolean;
  next: number;
}

// Rows of 0x009be5c0 (chains: a once-row that ends continues with `next`).
const GIGUE_ROWS: readonly GiGueRow[] = [
  { motion: 4, speed: 0.7, loop: true, next: 0 },
  { motion: 3, speed: 0.7, loop: true, next: 1 },
  { motion: 2, speed: 0.6, loop: false, next: 0 },
  { motion: 1, speed: 0.6, loop: false, next: 7 },
  { motion: 0, speed: 0.5, loop: false, next: 0 },
  { motion: 0, speed: 0.5, loop: false, next: 7 },
  { motion: 3, speed: 0.7, loop: false, next: 7 },
  { motion: 3, speed: 0.7, loop: true, next: 7 },
  { motion: 3, speed: 0.7, loop: false, next: 0 },
];

const GIGUE_MOTIONS: readonly EnemyAiMotion[] = GIGUE_ROWS.map((r) => ({ index: r.motion, speed: r.speed, loop: r.loop }));

// exe ids: 0 idle, 1 approach, 4 flinch, 7 emerge, 9 volley, 10 bomb, 11
// prepare, 12 barrier, 13 hop, 14 fall.
export type GiGueState = 'idle' | 'approach' | 'flinch' | 'emerge' | 'volley' | 'bomb' | 'prepare' | 'barrier' | 'hop' | 'fall';

// A Jellen / Zalure cast at a player (render/combat.ts applies it to the local
// player).
export interface GiGueEvent {
  clientId: number;
  tech: 'jellen' | 'zalure';
  level: number;
}

// The spit (gigue_confuse_projectile_constructor 0x0056c...., update
// 0x0056c96c): it waits `delay` frames, then lives 90; every frame its
// steering vector (strength fparam4, doubled when the player is within 150,
// plus fparam5 a frame) pulls the velocity toward the player, which is then
// renormalised to fparam3; it hits within fparam3 of the player with
// entity_hit_by_tech (power iparam2) and may confuse.
export class GiGueSpit extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xa060e0, size: 1.4 };
  private vx: number;
  private vy = 0;
  private vz: number;
  private delay: number;
  private age = 0;
  private strength: number;
  private bump: number;
  private speed: number;
  private launched = false;
  readonly targetId: number;
  private ox: number;
  private oy: number;
  private oz: number;

  constructor(opts: { x: number; y: number; z: number; yaw: number; delay: number; speed: number; strength: number; bump: number; effect: ShotEffect; targetId: number }) {
    super(opts.x, opts.y, opts.z);
    this.ox = opts.x;
    this.oy = opts.y;
    this.oz = opts.z;
    this.vx = Math.sin(opts.yaw) * opts.speed;
    this.vz = Math.cos(opts.yaw) * opts.speed;
    this.delay = opts.delay;
    this.speed = opts.speed;
    this.bump = opts.bump;
    this.targetId = opts.targetId;
    this.strength = opts.strength;
    this.effect = opts.effect;
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    if (!this.launched) {
      if (--this.delay > 0) return [];
      this.launched = true;
      this.x = this.ox;
      this.y = this.oy;
      this.z = this.oz;
    }
    this.frames++;
    if (++this.age > GIGUE.spitLife - 1) {
      this.done = true;
      return [];
    }
    const t = targets.find((p) => p.clientId === this.targetId && !p.dead);
    if (t) {
      let dx = t.x - this.x;
      let dy = PLAYER_AIM_HEIGHT - this.y;
      let dz = t.z - this.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx = (dx / len) * this.strength;
      dy = (dy / len) * this.strength;
      dz = (dz / len) * this.strength;
      this.strength = fr(this.strength + this.bump);
      this.vx += dx;
      this.vy += dy;
      this.vz += dz;
      const v = Math.hypot(this.vx, this.vy, this.vz) || 1;
      this.vx = (this.vx / v) * this.speed;
      this.vy = (this.vy / v) * this.speed;
      this.vz = (this.vz / v) * this.speed;
    }
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    // ASSUMED flat ground: the map ray-cast that ends it is the floor.
    if (this.y <= 0) {
      this.done = true;
      return [];
    }
    if (t && Math.hypot(t.x - this.x, PLAYER_AIM_HEIGHT - this.y, t.z - this.z) <= this.speed) {
      this.done = true;
      return [t];
    }
    return [];
  }
}

// The bomb (GiGuesSpawnProjectile_0056d174 over the base projectile): flies
// straight to the player's position at fparam2 a frame and explodes on the
// first player or the floor, hurting every player within 40 (1600 squared,
// 0x00a73dd4) with entity_hit_by_tech power iparam1.
export class GiGueBomb extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xff6030, size: 2 };
  private vx: number;
  private vy: number;
  private vz: number;
  private travelled = 0;
  private speed: number;

  constructor(x: number, y: number, z: number, toX: number, toZ: number, speed: number, power: number) {
    super(x, y, z);
    const dx = toX - x;
    const dy = PLAYER_AIM_HEIGHT - y;
    const dz = toZ - z;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.vx = (dx / len) * speed;
    this.vy = (dy / len) * speed;
    this.vz = (dz / len) * speed;
    this.speed = speed;
    this.effect = { kind: 'tech', power };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    const direct = targets.some((t) => !t.dead && Math.hypot(t.x - this.x, this.y - PLAYER_AIM_HEIGHT, t.z - this.z) <= 10);
    if (this.travelled > GIGUE.bombRange || this.y <= 0 || direct) {
      this.done = true;
      return targets.filter((t) => !t.dead && (t.x - this.x) ** 2 + (t.z - this.z) ** 2 <= GIGUE.bombRadiusSq);
    }
    this.travelled += this.speed;
    return [];
  }
}

export class GiGueAi extends BrainBase {
  state: GiGueState | 'dead' = 'idle';
  // The owner keeps it current (the flinch's 25 % test).
  hpFraction = 1;
  confused = false;
  // Jellen / Zalure casts to apply (the owner drains it).
  readonly events: GiGueEvent[] = [];
  private req: GiGueState = 'idle'; // enemy+0x37c
  private sub = 0; // enemy+0x384
  private lock = false; // enemy+0x390 & 1
  private airborne = false; // entity flag 0x1000000
  private blockedHit = false;
  private homeX: number;
  private homeZ: number;
  private skyStart: boolean;
  private roam: number;
  private height = 0; // enemy+0x3f4
  private fallHeight: number; // enemy+0x444
  private chanceA: number; // enemy+0x448
  private chanceB: number; // enemy+0x44c
  private reach: number; // enemy+0x440
  private arc: number; // enemy+0x43c, BAMS
  private hopSpeed: number;
  private bombSpeed: number;
  private spitSpeed: number;
  private strength: number;
  private bump: number;
  private confuseChance: number;
  private bombPower: number;
  private spitPower: number;
  private level: number;
  private barrierLife: number;
  private roundMin: number;
  private timer = 0; // enemy+0x38c
  private turned = 0; // enemy+0x3e4
  private counter = 0; // enemy+0x400
  private rounds = 0; // enemy+0x450
  private waitFrames = 0; // enemy+0x44c's countdown (hop)
  private acquireTimer = 0;
  private roamTimer = 0;
  private wx: number;
  private wz: number;
  private hopX = 0;
  private hopZ = 0;
  private vx = 0;
  private vz = 0;
  private row = 0;
  private frames = 0;
  private hpBase = 1;
  private emergeTimer = 0;
  private picked: number[] = []; // clientIds on the list of a volley / prepare
  private barrier = -1; // -1 none, 0 appear, 1 up, 2 vanish
  private barrierTimer = 0;
  private barrierMotion = 0;
  private attacker: number | null = null;

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    params: readonly number[];
    attack: EnemyAttackData | null;
    movement: EnemyMovementData | null;
    rng?: () => number;
  }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    const p = (i: number) => opts.params[i] ?? 0;
    this.homeX = opts.x;
    this.homeZ = opts.z;
    this.wx = opts.x;
    this.wz = opts.z;
    this.skyStart = Math.trunc(p(0)) > 0;
    this.roam = p(1) < GIGUE.idleRoam ? GIGUE.idleFloor : p(1);
    this.fallHeight = Math.max(fr(GIGUE.skyBase + p(2)), 0);
    this.chanceA = fr(p(3) + GIGUE.chanceBias);
    this.chanceB = fr(p(4) + GIGUE.chanceBias);
    this.reach = opts.attack?.distanceX ?? 0;
    this.arc = (opts.attack?.angle ?? 0) & 0xffff;
    const mv = opts.movement;
    this.hopSpeed = mv?.fparam1 ?? 0;
    this.bombSpeed = mv?.fparam2 ?? 0;
    this.spitSpeed = mv?.fparam3 ?? 0;
    this.strength = mv?.fparam4 ?? 0;
    this.bump = mv?.fparam5 ?? 0;
    this.confuseChance = mv?.fparam6 ?? 0;
    this.bombPower = mv?.iparam[0] ?? 0;
    this.spitPower = mv?.iparam[1] ?? 0;
    this.level = mv?.iparam[2] ?? 0;
    this.barrierLife = (mv?.iparam[3] ?? 0) * 30;
    this.roundMin = mv?.iparam[4] ?? 0;
    // The ctor enters the fall (GibblesEnterAttackState_0056bb4c) or the
    // emergence (GiGuesSetAIStateTo7_0052ca40).
    if (this.skyStart) {
      this.airborne = true;
      this.state = 'fall';
      this.req = 'fall';
    } else {
      this.state = 'emerge';
      this.req = 'emerge';
    }
    this.sub = 0;
    this.current = GIGUE_MOTIONS[0];
  }

  // Flags 0x4040000 (hidden / invulnerable until the first frame of the fall /
  // the emergence's end) and the barrier (enemy+0x390 & 0x80000: a blocked hit
  // shows the miss text).
  get invulnerable(): boolean {
    return this.state === 'emerge' || this.barrier >= 0;
  }

  // The drawn height above the ground (enemy+0x3f4, GiGuesUpdateAI_00569384).
  get lift(): number {
    return this.height;
  }

  // Hits do not start the owner's flinch; the exe's own (state 4) does.
  flinches(): boolean {
    return false;
  }

  private setRow(out: AiFrame, row: number): void {
    this.row = row;
    this.frames = 0;
    this.play(out, GIGUE_MOTIONS[row]);
  }

  // Both the reach and the arc test of the volley / prepare / approach states:
  // within distance_x and within half the arc of the heading.
  private inCone(t: AiTarget): boolean {
    const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
    if (d > this.reach * this.reach) return false;
    return Math.abs(wrap(this.angleTo(t) - this.angle)) < (this.arc / 2) * BAMS_TO_RAD;
  }

  private request(s: GiGueState): void {
    if (!this.lock && this.state !== s) this.req = s;
  }

  // GibblesAcquireTarget_0056b9dc.
  private acquire(targets: readonly AiTarget[]): void {
    if (this.state === 'idle') {
      if (++this.acquireTimer < GIGUE.acquire) return;
      this.acquireTimer = 0;
      const t = this.nearestWithin(targets, GIGUE.search);
      if (t) {
        this.targetId = t.clientId;
        this.request('approach');
      }
    } else if (this.state === 'approach') {
      if (!this.nearestWithin(targets, GIGUE.near)) {
        if (!this.nearestWithin(targets, GIGUE.search + GIGUE.extra)) this.request('idle');
      } else if (this.chanceB < fr(this.rng())) {
        this.request('hop');
      } else this.request('prepare');
    }
  }

  private nearestWithin(targets: readonly AiTarget[], radius: number): AiTarget | null {
    let best: AiTarget | null = null;
    let bestSq = radius * radius;
    for (const t of targets) {
      if (t.dead) continue;
      const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
      if (d >= bestSq) continue;
      best = t;
      bestSq = d;
    }
    return best;
  }

  // unknown_enemy_behavior_wanderer with the AI record's speed 0: it only turns
  // toward a random waypoint around the spawn point, a new one every 150
  // frames.
  private wander(rx: number, rz: number): void {
    if (++this.roamTimer >= 150) {
      this.roamTimer = 0;
      const a = this.rng() * Math.PI * 2;
      this.wx = this.homeX + Math.sin(a) * rx;
      this.wz = this.homeZ + Math.cos(a) * rz;
    }
    this.angle = turnToward(this.angle, Math.atan2(this.wx - this.x, this.wz - this.z), GIGUE.turn * BAMS_TO_RAD);
  }

  // A blocked hit (GibblesPerformAttack_0056bc04 and the like): the answer is
  // the bomb, whatever the lock.
  blocked(clientId: number): void {
    if (this.state === 'dead') return;
    this.attacker = clientId;
    if (this.state !== 'bomb') this.req = 'bomb';
  }

  // A hit: the flinch (vtable +0x100, 0x005692dc) except in the bomb, prepare
  // and hop states.
  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
    this.attacker = clientId;
    if (this.state === 'bomb' || this.state === 'prepare' || this.state === 'hop' || this.state === 'emerge') return;
    if (this.state !== 'flinch') this.req = 'flinch';
    this.lock = true;
  }

  resume(): string {
    return this.state;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    if (animationEnded && !GIGUE_ROWS[this.row].loop) this.setRow(out, GIGUE_ROWS[this.row].next);
    this.frames += this.current?.speed ?? 0;
    this.acquire(targets);
    // GiGuesUpdate_005695ec: a pending request runs the old state's exit, then
    // the new state's first frame.
    if (this.state !== this.req) {
      if (this.sub !== -1) {
        this.sub = -1;
        this.stateFrame(out, targets);
      }
      this.sub = 0;
      this.state = this.req;
    }
    this.stateFrame(out, targets);
    if (this.sub === -1) {
      this.stateFrame(out, targets);
      this.sub = 0;
      this.state = this.req;
    }
    this.tickBarrier();
    out.lift = this.height;
    return this.finish(out);
  }

  private stateFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    // Only these states do anything on exit (sub-state -1).
    if (this.sub === -1) {
      if (this.state === 'hop') {
        if (this.req !== 'flinch') this.height = 0;
        return;
      }
      if (this.state !== 'fall' && this.state !== 'emerge' && this.state !== 'flinch') return;
    }
    switch (this.state) {
      case 'idle':
        this.idleFrame(out);
        break;
      case 'approach':
        this.approachFrame(out, targets);
        break;
      case 'flinch':
        this.flinchFrame(out, targets);
        break;
      case 'emerge':
        this.emergeFrame(out);
        break;
      case 'volley':
        this.volleyFrame(out, targets);
        break;
      case 'bomb':
        this.bombFrame(out, targets);
        break;
      case 'prepare':
        this.prepareFrame(out, targets);
        break;
      case 'barrier':
        this.barrierFrame(out);
        break;
      case 'hop':
        this.hopFrame(out, targets);
        break;
      case 'fall':
        this.fallFrame(out);
        break;
      case 'dead':
        break;
      default:
        exhaustive(this.state);
    }
  }

  // After a state: the next one when nothing locks it (the pattern that ends
  // the bomb, volley and hop: the barrier on a roll of chanceA, else idle).
  private afterAttack(): void {
    if (!this.blockedHit && Math.fround(this.rng()) <= this.chanceA) this.request('barrier');
    else this.request('idle');
  }

  // 0x0056b09c: the emergence.
  private emergeFrame(out: AiFrame): void {
    if (this.sub === 0) {
      this.setRow(out, 0);
      this.emergeTimer = 0;
      this.sub = 1;
    } else if (this.sub === -1) {
      if (this.state !== 'idle') this.req = 'idle';
      return;
    }
    if (++this.emergeTimer >= GIGUE.emerge) this.sub = -1;
  }

  // 0x0056b7d0 (the idle: walk 150 frames toward a spell target, stand 90).
  private idleFrame(out: AiFrame): void {
    if (this.sub === 0) {
      this.timer = GIGUE.idleWalk;
      this.setRow(out, 1);
      this.sub = 1;
      return;
    }
    if (this.sub === 2) {
      if (--this.timer > 0) return;
      this.sub = 0;
      return;
    }
    // sub 1: GibblesUpdateSpellCastTarget_0056b8d4 (home, radius param2).
    if ((this.wx - this.x) ** 2 + (this.wz - this.z) ** 2 < GIGUE.spellDist) {
      const a = this.rng() * Math.PI * 2;
      const d = (fr(this.rng()) + GIGUE.spellMin) * this.roam;
      this.wx = Math.cos(a) * d + this.homeX;
      this.wz = Math.sin(a) * d + this.homeZ;
    }
    this.angle = turnToward(this.angle, Math.atan2(this.wx - this.x, this.wz - this.z), GIGUE.turn * BAMS_TO_RAD);
    if (--this.timer < 1) {
      this.sub = 2;
      this.setRow(out, 0);
      this.timer = GIGUE.idleStand;
    }
  }

  // 0x0056b4e8: turn to face a player in reach, then attack.
  private approachFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    if (this.sub === 0) {
      this.turned = 0;
      this.airborne = false;
      this.setRow(out, 1);
      this.sub = 1;
    }
    this.airborne = false;
    if (this.sub === 2) {
      this.wander(100, 50);
      return;
    }
    const t = this.target(targets);
    if (t && this.inCone(t)) {
      if (++this.counter < 3) {
        this.rounds = 0;
        this.request('volley');
      } else {
        this.counter = 0;
        this.request('hop');
      }
      return;
    }
    // Turn on the spot by half the turn rate; a full turn without a target in
    // the cone ends in the wander sub-state.
    this.angle = wrap(this.angle + (GIGUE.turn / 2) * BAMS_TO_RAD);
    this.turned += GIGUE.turn / 2;
    if (this.turned > 0x10000) {
      this.roamTimer = 0;
      this.sub = 2;
    }
  }

  // The list of players in the cone (max 12): volley and prepare.
  private pickTargets(targets: readonly AiTarget[]): void {
    this.picked.length = 0;
    for (const t of targets) {
      if (this.picked.length >= 12) break;
      if (t.dead) continue;
      if (this.inCone(t)) this.picked.push(t.clientId);
    }
  }

  // 0x0056aadc: three rounds of one spit each.
  private volleyFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    if (this.sub === 0) {
      this.pickTargets(targets);
      if (this.picked.length > 0) {
        this.sub = 1;
        this.setRow(out, 3);
        this.timer = Math.max(this.roundMin, GIGUE.volleyMin);
      } else {
        if (this.airborne) this.request('hop');
        else this.afterAttack();
        return;
      }
    }
    if (this.sub === 4) {
      this.wander(100, 100);
      if (--this.timer > 0) return;
      this.afterAttack();
      return;
    }
    if (this.sub === 1) {
      if (this.frames >= GIGUE.volleyFrameA) this.sub = 2;
    } else if (this.sub === 2 && this.frames >= GIGUE.volleyFrameB) {
      const i = Math.trunc(this.picked.length * fr(this.rng())) % this.picked.length;
      const id = this.picked[i];
      const confuse = Math.fround(this.rng()) <= this.confuseChance;
      const side = (i & 1) === 0 ? 0x2000 : -0x2000;
      const victim = targets.find((t) => t.clientId === id);
      // gigue_confuse_projectile_constructor: the steering strength starts at
      // fparam4 and doubles when the player starts within 150 (xz).
      const close = victim && (victim.x - this.x) ** 2 + (victim.z - this.z) ** 2 < GIGUE.spitCloseSq;
      const mk = (effect: ShotEffect) =>
        // ASSUMED: the spit leaves from the middle of the body (node 0x16).
        new GiGueSpit({
          x: this.x,
          y: 20,
          z: this.z,
          yaw: this.angle + side * BAMS_TO_RAD,
          delay: i * GIGUE.spitDelay,
          speed: this.spitSpeed,
          strength: close ? fr(this.strength * GIGUE.spitClose) : this.strength,
          bump: this.bump,
          effect,
          targetId: id,
        });
      // The tech hit and then the confusion are two effects of one hit: two
      // identical spits fly together.
      out.shots = confuse ? [mk({ kind: 'tech', power: this.spitPower }), mk({ kind: 'status', status: STATUS.confusion })] : [mk({ kind: 'tech', power: this.spitPower })];
      this.sub = 3;
    }
    if (--this.timer > 0) return;
    if (++this.rounds > 2) {
      this.timer = GIGUE.barrierWander;
      this.setRow(out, 1);
      this.sub = 4;
      return;
    }
    this.sub = 0;
    this.frames = 0;
    this.setRow(out, 3);
  }

  // 0x0056a7a4: the bomb at the player.
  private bombFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    const t = this.target(targets);
    if (this.sub === 0) {
      this.timer = Math.max(this.roundMin, GIGUE.bombMin);
      this.sub = 1;
      this.setRow(out, 2);
      this.blockedHit = false;
      if (this.airborne) {
        this.request('hop');
        return;
      }
      return;
    }
    if (this.sub >= 1 && this.sub < 4) {
      if (!t) {
        this.sub = 4;
        return;
      }
      if (this.sub === 1) {
        if (this.frames >= GIGUE.bombFrameA) this.sub = 2;
      } else if (this.sub === 2 && this.frames >= GIGUE.bombFrame) {
        // ASSUMED: the bomb leaves from the middle of the body (node 0x2a).
        out.shots = [new GiGueBomb(this.x, 20, this.z, t.x, t.z, this.bombSpeed, this.bombPower)];
        this.sub = 3;
      }
      this.angle = this.angleTo(t);
      if (--this.timer < 1) this.sub = 4;
      return;
    }
    if (this.sub === 4) {
      if (!this.airborne) this.afterAttack();
      else this.request('hop');
    }
  }

  // 0x0056a3cc: the Jellen / Zalure cast at the players in the cone.
  private prepareFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    if (this.sub === 0) {
      if (!this.airborne) {
        this.pickTargets(targets);
        if (this.picked.length > 0) {
          this.sub = 1;
          this.setRow(out, 3);
          return;
        }
      }
      this.request(this.airborne ? 'hop' : 'idle');
      return;
    }
    if (this.sub === 1) {
      if (this.frames >= GIGUE.prepareFrame) this.sub = 2;
    } else if (this.sub === 2 && this.frames >= GIGUE.stompFrame) {
      this.sub = 3;
      // 0x0056a48d: the Zalure object, then 0x0056a49d the Jellen object, each at
      // the Gi Gue's position; the area tick hits the players inside its reach
      // (ASSUMED: the XZ distance, strict, as the Dark Falz technique objects).
      for (const tech of ['zalure', 'jellen'] as const) {
        const reach = techReach(TECH[tech], this.level);
        for (const t of targets) {
          if (t.dead || Math.hypot(t.x - this.x, t.z - this.z) >= reach) continue;
          this.events.push({ clientId: t.clientId, tech, level: this.level });
        }
      }
    }
    if (this.row === 3) return;
    this.request('hop');
  }

  // 0x0056a2cc: the barrier.
  private barrierFrame(out: AiFrame): void {
    if (this.sub === 0) {
      this.lock = false;
      this.setRow(out, 1);
      this.sub = 1;
      return;
    }
    if (this.sub === 1) {
      // GiGuesAllocateEntity_0056c564: the barrier object, the blocked flag.
      this.barrier = 0;
      this.barrierTimer = this.barrierLife;
      this.barrierMotion = GIGUE.barrierMotion;
      this.blockedHit = true;
      this.sub = 2;
      this.timer = GIGUE.barrierWander;
      return;
    }
    this.wander(100, 100);
    if (--this.timer < 1 && !this.lock && this.state !== 'idle') this.req = 'idle';
  }

  // The barrier object (vtable 0x00b05bf8, update 0x0056c704): appears, stays
  // for iparam4 * 30 frames or until the Gi Gue volleys, bombs, prepares or
  // flinches, then vanishes.
  private tickBarrier(): void {
    if (this.barrier < 0) return;
    this.barrierTimer--;
    if (this.barrier === 0) {
      if (--this.barrierMotion <= 0) {
        this.barrier = 1;
        this.barrierMotion = GIGUE.barrierMotion;
      }
    } else if (this.barrier === 1) {
      const busy = this.state === 'volley' || this.state === 'bomb' || this.state === 'prepare' || this.state === 'flinch';
      if (this.barrierTimer <= 0 || busy) this.barrier = 2;
    } else if (--this.barrierMotion <= 0) {
      this.barrier = -1;
      this.blockedHit = false;
    }
  }

  // 0x00569a64: crouch 60 frames, leap away from the player to 50 high, fly
  // 200 units at fparam1 a frame, drop 2.3 a frame.
  private hopFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    switch (this.sub) {
      case 0:
        this.height = 0;
        this.sub = 1;
        this.waitFrames = GIGUE.hopWait;
        this.setRow(out, 1);
        this.airborne = false;
          break;
      case 1: {
        this.airborne = false;
        this.wander(100, 50);
        this.waitFrames--;
        if (this.waitFrames < 1) {
          this.sub = 2;
          this.airborne = true;
          const t = this.nearestWithin(targets, GIGUE.search);
          if (t) this.targetId = t.clientId;
          if (!t) {
            this.hopX = this.homeX;
            this.hopZ = this.homeZ;
          } else {
            // The first of the three rays (200 away from the player) is clear on
            // open ground.
            const a = Math.atan2(this.x - t.x, this.z - t.z);
            this.hopX = this.x + Math.sin(a) * GIGUE.hopLeg;
            this.hopZ = this.z + Math.cos(a) * GIGUE.hopLeg;
          }
        }
        break;
      }
      case 2:
        this.airborne = true;
        this.setVelocity(this.hopSpeed);
        this.height += GIGUE.hopRise;
        if (this.height >= GIGUE.hopTop) this.sub = 3;
        break;
      case 3: {
        this.setVelocity(this.hopSpeed);
        this.x += this.vx;
        this.z += this.vz;
        if ((this.hopX - this.x) ** 2 + (this.hopZ - this.z) ** 2 <= GIGUE.hopArrive * GIGUE.hopArrive) {
          this.sub = 4;
          this.vx = 0;
          this.vz = 0;
        }
        if (this.height > GIGUE.hopBack && (this.vx !== 0 || this.vz !== 0)) {
          this.angle = turnToward(this.angle, Math.atan2(this.vx, this.vz), GIGUE.turn * 2 * BAMS_TO_RAD);
        }
        break;
      }
      case 4: {
        const h = fr(this.height - GIGUE.fall);
        if (h > 0) this.height = h;
        else {
          this.height = 0;
          this.airborne = false;
          // The landing animation (row 8) is never selected in the hop.
          if (this.row !== 8) this.afterAttack();
        }
        break;
      }
      default:
        break;
    }
  }

  private setVelocity(speed: number): void {
    const dx = this.hopX - this.x;
    const dz = this.hopZ - this.z;
    const d = dx * dx + dz * dz;
    if (d < 1e-6) {
      this.vx = 0;
      this.vz = 0;
      return;
    }
    const len = Math.sqrt(d);
    this.vx = (dx / len) * speed;
    this.vz = (dz / len) * speed;
  }

  // 0x00569820: the drop from the sky.
  private fallFrame(out: AiFrame): void {
    if (this.sub === 0) {
      this.hopX = this.homeX;
      this.hopZ = this.homeZ;
      this.lock = false;
      this.height = this.fallHeight;
      this.sub = 1;
      this.setRow(out, 7);
    } else if (this.sub === -1) {
      this.request('approach');
      return;
    }
    this.airborne = true;
    const h = fr(this.height - GIGUE.fall);
    if (h > -GIGUE.fall) {
      this.height = h;
      if (this.row === 7) {
        const speed = GIGUE_ROWS[7].speed;
        if (h <= fr((GIGUE.landEmerge / speed + GIGUE.landBase) * GIGUE.landScale)) this.setRow(out, 8);
      }
    } else {
      this.height = 0;
      this.airborne = false;
      if (this.row !== 8) this.sub = -1;
    }
  }

  // 0x0056b248: the flinch; a hit of a quarter of the HP or more is answered
  // with a volley (when the attacker is close, if it is airborne).
  private flinchFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    if (this.sub === 0) {
      this.setRow(out, this.airborne ? 5 : 4);
      this.sub = 1;
    } else if (this.sub === -1) {
      this.lock = false;
      const lost = this.hpBase - this.hpFraction;
      this.hpBase = this.hpFraction;
      const a = this.attacker !== null ? (targets.find((t) => t.clientId === this.attacker && !t.dead) ?? null) : null;
      if (lost > 0.25 && a && (!this.airborne || (a.x - this.x) ** 2 + (a.z - this.z) ** 2 <= GIGUE.flinchNearSq)) {
        this.targetId = a.clientId;
        this.req = 'volley';
        return;
      }
      this.req = this.airborne ? 'hop' : 'idle';
      return;
    }
    // The slide of the knockback is the owner's; the flinch lasts until its
    // motion ends.
    if (this.row !== 4 && this.row !== 5) this.sub = -1;
  }

  override kill(): void {
    super.kill();
    this.barrier = -1;
    this.blockedHit = false;
  }
}

// --- Gibbles --------------------------------------------------------------------
//
// A gorilla that lies in wait until a player comes within 200, drops in with a
// shockwave, walks up to the player, and then punches in triple slams, leaps,
// raises a guard when it is attacked in melee and, once the guard is spent,
// swings the heavier arm attack twice.
//
// Ctor gibbles_constructor 0x00563200 (object 0x454 bytes, vtable 0x00b054e0,
// AI record 0x009be2ac {search 250, wander 1.25 (written by 0x005643b0), turn
// 1024 BAMS}, motion table 0x009be180). It runs on the Booma controller
// (update_enemy_control_object 0x00787a80): a hit -> vtable +0x100 (0x00564210,
// the stagger); +0x84 (0x00563fe8) arms the guard -> +0xfc (0x005641c8); with
// no busy flag (0x200000) it finds the target (+0x78 0x00563644, every 30
// frames: the nearest player within 250), none -> +0xf0 (0x00563afc), in reach
// -> +0xf8 (0x00563e78: the attack of the reach test +0x80 0x00563d08), else
// +0xf4 (0x00563bcc). enemy+0x32e (dispatcher 0x0056021c):
//   0 / 10 hidden, waiting     1 waiting for a player within 200
//   2 drop in 0x00562a58...    3 approach 0x00562754
//   4 triple slam 0x00561798   5 rage swing 0x0056135c   6 leap 0x00560bc4
//   7 guard 0x0056097c         8 stagger 0x005607fc      9 death 0x005606d4
//   11 wander 0x00560338
// Set entry params: param1 + 100 the guard points (0x00925a14), param4 the
// chance of a leap after a stagger, param3 the chance of a leap during the
// approach. MovementData row 61: fparam2 the cooldown after a triple slam,
// fparam3 the walking speed, iparam1 the leap's wind-up frames. AttackData rows
// [0] = 61 (slams: damage minAtp, reach distance_x, arc angle), [1] = the
// rage swing (GibblesAttack1 -> the exe's stats[2]), [2] = the landing
// shockwave (GibblesAttack2 -> stats[1]); ASSUMED: the names follow the table
// order 62, 63.
//
// The hand boxes: two collision_box rows (0x2c bytes, radius at +0xc, flags
// 0x8003): 0x009be10c radius 15.0 (0x009be118), installed on the object at
// +0x3bc by the ctor 0x00563200 (call 0x007b9a88, count 1), and 0x009be138
// radius 30.0 (0x009be144), installed on +0x3c0. The combo's hand loop
// (0x00561534..0x00561737, the code before the state 4 handler; ASSUMED the
// same state) runs every fifth frame (the frame counter
// mod 5 at 0x00561553), tests the +0x3bc box's flag 0x80000 (set by the
// overlap pass 0x007b6894 that places it) and then every player with the vtable
// +0x50 test; a player it passes gets the vtable +0x5c / +0x60 / +0x68 calls
// (UNCLEAR which one damages; the damage above 0 is the hand's tech, 0x00925ab0),
// then Gibbles' flags 0x600 and 0x10e at +0x388 are set. Nothing outside the
// destructor (0x00560134..0x0056018e)
// reads the +0x3c0 box, so its use is UNCLEAR. Not reproduced: the hand bone
// positions, which the box centres follow (the hands use the body radius plus
// the attack reach, the slams are centred half a reach in front of the
// Gibbles, ASSUMED), the guard drain by the attacker's ATP
// (ASSUMED a fixed amount), line of sight, the pre-activation shuffle of states 0
// and 10, and the hold of the drop-in animation at frame 100. The sink of a
// dead Gibbles is GibblesAi.tickDead (0x005606d4, sub 1 / 4 / 3); its death
// particle and sounds are not (see that method).
export const GIBBLES = {
  search: 250,
  wander: fr(1.25), // 0x009be2b0
  turn: 1024,
  retarget: 30,
  dormant: 200, // 0x00925a2c = 40000 squared
  guardBase: 100, // 0x00925a14
  guardDrain: 80, // ASSUMED: 0.2 * (attacker ATP - own DFP) with an ATP of ~500
  guardRange: 30, // 0x00925a04 = 900 squared
  guardArc: 0x2aaa,
  guardFrames: 12,
  arriveHold: 40, // the emergence timer
  arriveHeight: 22, // 0x00a73cc0
  arriveVelocity: fr(1.0989011), // 0x3f8ca8cb
  arriveGravity: fr(1.0989011), // 0x00925b0c
  playerRadius: 5, // ASSUMED; the exe reads the target's hit box (10 without one)
  jumpFar: 150, // 0x00a73cbc = 22500 squared
  jumpRoll: 50, // 0x00925a3c: the walked distance between rolls
  jumpReach: 150, // 0x00925a08
  jumpArc: 0xaab,
  comboWindows: [
    // [from, slam, to] in motion frames (anim 2): the hands hit on every
    // fifth game frame between `from` and `to`, the slam lands at `slam`.
    [5, 8, 15],
    [19, 23, 31],
    [38, 40, Infinity],
  ],
  rageFrame: 24,
  rageSoundFrame: 10,
  rageHits: 2,
  leapStart: 8, // g_GibblesAttackDuration 0x00925ad4
  leapEarlyFrames: 25, // g_GibblesAttackStart 0x00925ad0
  leapEarly: fr(0.5), // 0x00925acc
  leapLate: fr(1.0989011), // 0x00925b0c
  leapVelocity: fr(12.5), // 0x00a73cb8
  leapOffset: 15, // 0x00925ac8
  leapScale: fr(0.02692308), // 0x00a73cb4
  handEvery: 5, // g_FrameCounter % 5
  handTech: 0, // 0x00925ab0: damage above it hits as a tech (rage swing)
  sinkStep: fr(0.1), // 0x00925b04: the sink a game tick, and the velocity's gain
  sinkLimit: 25, // 0x00925b00: the velocity that ends the sink
} as const;

interface GibblesRow {
  motion: number;
  speed: number;
  loop: boolean;
  next: number;
}

// Rows of 0x009be180 (a once-row that ends continues with `next`).
const GIBBLES_ROWS: readonly GibblesRow[] = [
  { motion: 8, speed: 0.3, loop: true, next: 0 },
  { motion: 9, speed: 0.5, loop: true, next: 0 },
  { motion: 0, speed: 0.7, loop: false, next: 0 },
  { motion: 7, speed: 0.6, loop: false, next: 0 },
  { motion: 5, speed: 0.3, loop: true, next: 0 },
  { motion: 4, speed: 0.7, loop: false, next: 6 },
  { motion: 6, speed: 0.7, loop: true, next: 0 },
  { motion: 3, speed: 0.8, loop: true, next: 0 },
  { motion: 1, speed: 0.8, loop: false, next: 0 },
  { motion: 2, speed: 0.7, loop: false, next: 0 },
];

const GIBBLES_MOTIONS: readonly EnemyAiMotion[] = GIBBLES_ROWS.map((r) => ({ index: r.motion, speed: r.speed, loop: r.loop }));

// exe ids: 0 / 10 dormant, 2 arrive, 3 approach, 4 combo, 5 rage, 6 leap, 7
// guard, 8 stagger, 11 wander.
export type GibblesState = 'dormant' | 'arrive' | 'approach' | 'combo' | 'rage' | 'leap' | 'guard' | 'stagger' | 'wander';

// An instant ground blast: every player within the radius takes the tech once
// (the slams and the landings: unknown_gibbles_tech_damage 0x00562...,
// entity_hit_by_tech with the attack's minAtp).
export class GroundBlast extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xc0a060, size: 3 };
  private radius: number;

  constructor(x: number, z: number, radius: number, power: number) {
    super(x, 0, z);
    this.radius = radius;
    this.effect = { kind: 'tech', power };
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.done = true;
    return targets.filter((t) => !t.dead && (t.x - this.x) ** 2 + (t.z - this.z) ** 2 <= this.radius * this.radius);
  }
}

export class GibblesAi extends BrainBase {
  state: GibblesState | 'dead' = 'dormant';
  hpFraction = 1;
  confused = false;
  private guard: number; // enemy+0x390
  private leapChance: number; // enemy+0x39c (param3)
  private staggerLeap: number; // enemy+0x3a0 (param4)
  private cooldown: number; // MovementData fparam2
  private speed: number; // MovementData fparam3
  private windup: number; // MovementData iparam1
  private attacks: readonly EnemyAttackData[];
  private radius: number;
  private sub = 0; // enemy+0x330
  private row = 0;
  private rowOnce = false; // the playing motion ends (a once row, or a looping one played once)
  private frames = 0;
  private clock = 0; // g_FrameCounter stand-in
  private searchTimer = 0;
  private busy = false; // entity flag 0x200000
  private alerted = false; // state_maybe & 4
  private attacking = false; // state_maybe & 0x100
  private rage = false; // state_maybe & 8
  private jumpReady = false; // state_maybe & 0x10
  private armed = false; // state_maybe & 0x20
  private immune = false; // maybe_invuln
  private walked = 0; // enemy+0x3b0 (the walked distance)
  private rageSwings = 0; // enemy+0x386
  private wait = 0; // enemy+0x342
  private timer = 0;
  private yOff = 0; // enemy+0x394
  private vy = 0; // enemy+0x398
  private vx = 0;
  private vz = 0;
  private hitPending = false;
  private homeX: number;
  private homeZ: number;
  private wx: number;
  private wz: number;
  private roamTimer = 0;
  private touchedDown = false;
  private sinkPhase: 'motion' | 'sink' | 'gone' | 'removed' | null = null; // enemy+0x330 once dead
  private sinkVelocity = 0; // enemy+0x3a8
  private sink = 0; // enemy+0x3c, how far it has gone into the ground

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    params: readonly number[];
    attacks: readonly EnemyAttackData[];
    movement: EnemyMovementData | null;
    radius?: number;
    rng?: () => number;
  }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    const p = (i: number) => opts.params[i] ?? 0;
    this.guard = Math.trunc(GIBBLES.guardBase + p(0));
    this.leapChance = p(2);
    this.staggerLeap = p(3);
    const mv = opts.movement;
    this.cooldown = Math.round(mv?.fparam2 ?? 0);
    this.speed = mv?.fparam3 ?? 0;
    this.windup = mv?.iparam[0] ?? 0;
    this.attacks = opts.attacks;
    this.radius = opts.radius ?? GIBBLES.playerRadius;
    this.homeX = opts.x;
    this.homeZ = opts.z;
    this.wx = opts.x;
    this.wz = opts.z;
    this.current = GIBBLES_MOTIONS[0];
  }

  // Flags 0x6040000 while it lies in wait / drops in, and the guard.
  get invulnerable(): boolean {
    return this.state === 'dormant' || this.state === 'arrive' || this.immune;
  }

  // Hidden (the flags of the lie-in-wait and the held drop-in: off the radar
  // and the lock-on, see frame()).
  get untargetable(): boolean {
    return this.state === 'dormant' || (this.state === 'arrive' && this.timer < GIBBLES.arriveHold);
  }

  // The drawn height above the ground (enemy+0x394), less the sink of a dead one.
  get lift(): number {
    return this.yOff + this.sink;
  }

  // The stagger and the guard are the brain's own.
  flinches(): boolean {
    return false;
  }

  // Death: row 9 (motion 2, 0.7), then it sinks (tickDead).
  get deathMotion(): EnemyAiMotion {
    return GIBBLES_MOTIONS[9];
  }

  override kill(): void {
    super.kill();
    this.sinkPhase = 'motion';
    this.sinkVelocity = 0;
  }

  // One game tick of a dead Gibbles, the state 9 handler 0x005606d4 (sub 1, 4,
  // 3): the death motion runs to its last frame; then every tick it sinks a
  // tenth of a unit (enemy+0x3c) while its velocity (enemy+0x3a8) gains a tenth,
  // and the sink ends when the velocity passes 25, 250 ticks in (ASSUMED the
  // same tick count as the exe's float steps). The tick after that sets the
  // removal flag (enemy+0x8 bit 0), so `removed` is true from then on.
  // NOT ported, on the transition tick (0x0056075d): the point 10 units behind
  // the heading (0x00782b64 on (0, 0, -10)), 0x00578148 with 10 (0x005607a7) and
  // the particle 0x00578778 with id 0x46 (0x005607b3). UNCLEAR what the two
  // helpers are, so no id or sound is ported.
  tickDead(animationEnded: boolean): void {
    if (this.sinkPhase === 'motion') {
      if (animationEnded) this.sinkPhase = 'sink';
    } else if (this.sinkPhase === 'sink') {
      this.sink = fr(this.sink - GIBBLES.sinkStep);
      this.sinkVelocity = fr(this.sinkVelocity + GIBBLES.sinkStep);
      if (this.sinkVelocity > GIBBLES.sinkLimit) this.sinkPhase = 'gone';
    } else if (this.sinkPhase === 'gone') {
      this.sinkPhase = 'removed';
    }
  }

  get removed(): boolean {
    return this.sinkPhase === 'removed';
  }

  private attack(i: number): EnemyAttackData {
    return this.attacks[i] ?? this.attacks[0] ?? { minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX: 0, angle: 0x2000, distanceY: 0 };
  }

  private setRow(out: AiFrame, row: number, once = false): void {
    this.row = row;
    this.frames = 0;
    const m = GIBBLES_MOTIONS[row];
    this.rowOnce = once || !m.loop;
    this.play(out, once ? { index: m.index, speed: m.speed, loop: false } : m);
  }

  private setState(out: AiFrame, s: GibblesState, row?: number): void {
    this.state = s;
    this.sub = 0;
    if (row !== undefined) this.setRow(out, row);
  }

  // check_entity_animation_elapsed_threshold: the frame passed `f` this tick.
  private crossed(f: number): boolean {
    const step = this.current?.speed ?? 0;
    return this.frames - step <= f && f < this.frames;
  }

  // unknown_gibbles_targeting_related 0x00563644: every 30 frames the nearest
  // player within 250 (ASSUMED: all classes match the preferred-class mask).
  private findTarget(targets: readonly AiTarget[]): AiTarget | null {
    if (++this.searchTimer >= GIBBLES.retarget) {
      this.searchTimer = 0;
      let best: AiTarget | null = null;
      let bestSq = GIBBLES.search * GIBBLES.search;
      for (const t of targets) {
        if (t.dead) continue;
        const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
        if (d >= bestSq) continue;
        best = t;
        bestSq = d;
      }
      this.targetId = best ? best.clientId : null;
      return best;
    }
    return this.target(targets);
  }

  // The reach test, vtable +0x80 (0x00563d08).
  private reachType(t: AiTarget): number {
    const diff = Math.abs(wrap(this.angleTo(t) - this.angle)) / BAMS_TO_RAD;
    const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
    if (this.rage) {
      const a = this.attack(1);
      const r = this.radius + a.distanceX;
      return d <= r * r && diff <= (a.angle & 0xffff) ? 2 : -1;
    }
    if (this.jumpReady) {
      const r = this.radius + GIBBLES.jumpReach;
      return d <= r * r && diff < GIBBLES.jumpArc ? 1 : -1;
    }
    const a = this.attack(0);
    const r = this.radius + a.distanceX;
    return d <= r * r && diff <= (a.angle & 0xffff) ? 0 : -1;
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
    this.hitPending = true;
  }

  resume(): string {
    return this.state;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.clock++;
    if (animationEnded && this.rowOnce) this.setRow(out, GIBBLES_ROWS[this.row].next);
    this.frames += this.current?.speed ?? 0;
    // A hit: the stagger (0x00564210), except in the middle of an attack
    // (state_maybe & 0x100: no reaction) or while it is invulnerable.
    if (this.hitPending) {
      this.hitPending = false;
      if (!this.invulnerable && this.state !== 'stagger' && !this.attacking && this.state !== 'leap') {
        this.busy = false;
        this.immune = false;
        this.setState(out, 'stagger', 8);
      }
    } else if (this.state !== 'guard' && this.state !== 'dormant' && this.state !== 'arrive' && this.state !== 'stagger' && this.armGuard(targets)) {
      // vtable +0xfc (0x005641c8): the guard.
      this.busy = false;
      this.attacking = false;
      this.setState(out, 'guard', 7);
    } else if (!this.busy && this.state !== 'dormant' && this.state !== 'arrive' && this.state !== 'stagger' && this.state !== 'guard') {
      this.control(out, targets);
    }
    this.stateFrame(out, targets);
    out.lift = this.yOff;
    // States 0 / 1 (flags 0x6040000) and the held drop-in: not drawn.
    out.hidden = this.untargetable;
    return this.finish(out);
  }

  // vtable +0x84 (0x00563fe8).
  private armGuard(targets: readonly AiTarget[]): boolean {
    if (this.armed) return true;
    if (!this.alerted || this.state === 'leap' || this.guard <= 0) return false;
    for (const t of targets) {
      if (t.dead || !t.attacking) continue;
      if ((t.x - this.x) ** 2 + (t.z - this.z) ** 2 >= GIBBLES.guardRange * GIBBLES.guardRange) continue;
      if (Math.abs(wrap(this.angleTo(t) - this.angle)) / BAMS_TO_RAD >= GIBBLES.guardArc) continue;
      // The player faces the Gibbles within the same arc.
      if (t.angle !== undefined && Math.abs(wrap(Math.atan2(this.x - t.x, this.z - t.z) - t.angle)) / BAMS_TO_RAD >= GIBBLES.guardArc) continue;
      this.armed = true;
      this.targetId = t.clientId;
      return true;
    }
    return false;
  }

  // The controller's target decisions.
  private control(out: AiFrame, targets: readonly AiTarget[]): void {
    const t = this.findTarget(targets);
    if (!t) {
      // +0xf0: back to the wander (states other than 11).
      if (this.state !== 'wander') {
        this.setState(out, 'wander', 1);
        this.alerted = false;
        this.immune = false;
      }
      return;
    }
    if (this.state === 'wander') {
      // GibblesUpdateLoop_00560338: a target ends the wander at once.
      this.setState(out, 'approach', 1);
      this.alerted = true;
      return;
    }
    const type = this.reachType(t);
    if (type < 0 || this.state !== 'approach') return;
    this.busy = true;
    this.attacking = false;
    if (type === 2) this.setState(out, 'rage', 3);
    else if (type === 1) {
      this.setState(out, 'leap', 4);
      this.jumpReady = false;
    } else {
      const diff = Math.abs(wrap(this.angleTo(t) - this.angle)) / BAMS_TO_RAD;
      if (diff < 0x10) {
        this.setState(out, 'combo', 2);
        this.sub = 1;
        this.attacking = true;
      } else this.setState(out, 'combo', 1);
    }
  }

  private stateFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    switch (this.state) {
      case 'dormant':
        this.dormantFrame(out, targets);
        break;
      case 'arrive':
        this.arriveFrame(out);
        break;
      case 'approach':
        this.approachFrame(targets);
        break;
      case 'combo':
        this.comboFrame(out, targets);
        break;
      case 'rage':
        this.rageFrame(out, targets);
        break;
      case 'leap':
        this.leapFrame(out, targets);
        break;
      case 'guard':
        this.guardFrame(out, targets);
        break;
      case 'stagger':
        this.staggerFrame(out);
        break;
      case 'wander':
        this.wanderFrame(out, targets);
        break;
      case 'dead':
        break;
      default:
        exhaustive(this.state);
    }
  }

  // States 0 / 1: hidden at the spawn point until a target is within 200.
  private dormantFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    const t = this.findTarget(targets);
    if (t && (t.x - this.x) ** 2 + (t.z - this.z) ** 2 < GIBBLES.dormant * GIBBLES.dormant) {
      this.setState(out, 'arrive');
      this.timer = 0;
      this.touchedDown = false;
    }
  }

  // State 2 (unknown_gibbles_spawn_behavior 0x00562a58...).
  private arriveFrame(out: AiFrame): void {
    if (this.sub === 0) {
      this.sub = 1;
      this.timer = 0;
      this.yOff = GIBBLES.arriveHeight;
      this.vy = GIBBLES.arriveVelocity;
      this.setRow(out, 0);
      return;
    }
    if (this.sub === 1) {
      if (this.timer < GIBBLES.arriveHold) {
        // The exe holds the drop animation at frame 100 until the 40-frame
        // emergence effect is over.
        if (++this.timer === GIBBLES.arriveHold) this.setRow(out, 5);
        return;
      }
      this.yOff = Math.max(0, fr(this.yOff - this.vy));
      this.vy = fr(this.vy + GIBBLES.arriveGravity);
      if (this.row !== 5 && !this.touchedDown) {
        // Row 5 chained on to row 6: the landing.
        this.landOn(out);
      }
      return;
    }
    if (this.sub === 3 && this.row !== 6) {
      this.alerted = true;
      this.immune = false;
      this.busy = false;
      this.setState(out, 'approach', 1);
    }
  }

  // The landing: the shockwave of attack [1] (damage minAtp, radius distance_x).
  private landOn(out: AiFrame): void {
    this.touchedDown = true;
    this.yOff = 0;
    this.vy = 0;
    const a = this.attack(2);
    out.shots = [new GroundBlast(this.x, this.z, a.distanceX, a.minAtp)];
    this.sub = 3;
    // The motion that follows is played once (the exe waits for one pass of
    // the looping row 6).
    this.setRow(out, 6, true);
  }

  // State 3 (DerolleHandleTargetApproach_00562754).
  private approachFrame(targets: readonly AiTarget[]): void {
    const t = this.target(targets);
    if (!t) return;
    if (this.sub === 0) this.sub = 1;
    this.walked += this.speed;
    // SorcererProcessProjectileLogic_00772aa0: turn, then step along the facing.
    this.angle = turnToward(this.angle, this.angleTo(t), GIBBLES.turn * BAMS_TO_RAD);
    this.x += Math.sin(this.angle) * this.speed;
    this.z += Math.cos(this.angle) * this.speed;
    const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
    if (d >= GIBBLES.jumpFar * GIBBLES.jumpFar) this.jumpReady = true;
    else if (this.walked >= GIBBLES.jumpRoll) {
      this.walked = 0;
      this.jumpReady = Math.fround(this.rng()) < this.leapChance;
    } else this.jumpReady = false;
  }

  // The hands: every fifth frame the players in reach of the hand are hit.
  private hands(out: AiFrame, a: EnemyAttackData): void {
    if (this.clock % GIBBLES.handEvery !== 0) return;
    let best: AiTarget | null = null;
    let bestSq = (a.distanceX + this.radius) ** 2;
    for (const t of this.lastTargets) {
      if (t.dead) continue;
      const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
      if (d > bestSq) continue;
      if (Math.abs(wrap(this.angleTo(t) - this.angle)) / BAMS_TO_RAD > ((a.angle & 0xffff) || 0x2000)) continue;
      best = t;
      bestSq = d;
    }
    if (best) out.hit = { clientId: best.clientId, knockback: 0, mult: 1, kbScale: 1 };
  }

  private lastTargets: readonly AiTarget[] = [];

  // A slam centred half a reach in front of the Gibbles (ASSUMED: the hand's bone).
  private slam(out: AiFrame): void {
    const a = this.attack(0);
    const cx = this.x + Math.sin(this.angle) * (a.distanceX / 2);
    const cz = this.z + Math.cos(this.angle) * (a.distanceX / 2);
    out.shots = [new GroundBlast(cx, cz, a.distanceX, a.minAtp)];
  }

  // State 4 (DerolleProcessAttackAnimationState_00561798).
  private comboFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    this.lastTargets = targets;
    const t = this.target(targets);
    if (this.sub === 0) {
      if (!t) {
        this.busy = false;
        this.setState(out, 'approach', 1);
        return;
      }
      const to = this.angleTo(t);
      this.angle = turnToward(this.angle, to, GIBBLES.turn * BAMS_TO_RAD);
      if (Math.abs(wrap(to - this.angle)) / BAMS_TO_RAD < 0x10) {
        this.attacking = true;
        this.sub = 1;
        this.setRow(out, 2);
      }
      return;
    }
    const w = GIBBLES.comboWindows;
    // The slam windows are crossings of the motion's frames: a motion that
    // ended (the engine chained to row 0) sends it on to the cooldown.
    if (this.sub >= 1 && this.sub <= 6 && this.row !== 2) {
      this.sub = 7;
      this.wait = this.cooldown;
    }
    if (this.sub === 1) {
      if (this.crossed(w[0][0])) this.sub = 2;
    } else if (this.sub === 2) {
      if (this.crossed(w[0][1])) this.slam(out);
      else this.hands(out, this.attack(0));
      if (this.crossed(w[0][2])) this.sub = 3;
    } else if (this.sub === 3) {
      if (this.crossed(w[1][0])) this.sub = 4;
    } else if (this.sub === 4) {
      if (this.crossed(w[1][1])) this.slam(out);
      else this.hands(out, this.attack(0));
      if (this.crossed(w[1][2])) this.sub = 5;
    } else if (this.sub === 5) {
      if (this.crossed(w[2][0])) this.sub = 6;
    } else if (this.sub === 6) {
      if (this.crossed(w[2][1])) this.slam(out);
      else this.hands(out, this.attack(0));
      if (this.row !== 2) {
        // The motion ended and chained to row 0: the cooldown.
        this.sub = 7;
        this.wait = this.cooldown;
      }
    } else if (this.sub === 7 && --this.wait < 0) {
      this.setRow(out, 1);
      this.sub = 0;
      this.busy = false;
      this.attacking = false;
      this.setState(out, 'approach', 1);
    }
  }

  // State 5 (DerolleProcessMovementState_0056135c): the heavy swing.
  private rageFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    this.lastTargets = targets;
    if (this.sub === 0) {
      this.sub = 1;
      this.attacking = true;
      this.setRow(out, 3);
      return;
    }
    if (this.sub === 1 || this.sub === 2) {
      if (this.crossed(GIBBLES.rageFrame)) this.sub = 2;
      if (this.sub === 1 && this.clock % GIBBLES.handEvery === 0) {
        const a = this.attack(1);
        let best: AiTarget | null = null;
        let bestSq = (a.distanceX + this.radius) ** 2;
        for (const t of targets) {
          if (t.dead) continue;
          const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
          if (d <= bestSq) {
            best = t;
            bestSq = d;
          }
        }
        // minAtp above 0x00925ab0 (0): entity_hit_by_tech with the damage.
        if (best) out.techHit = { clientId: best.clientId, power: a.minAtp };
      }
      if (this.row !== 3) {
        this.rageSwings++;
        this.sub = 3;
      }
      return;
    }
    if (this.sub === 3) {
      if (this.rageSwings > 1) {
        this.rageSwings = 0;
        this.rage = false;
        this.attacking = false;
      }
      this.busy = false;
      this.setState(out, 'approach', 1);
    }
  }

  // State 6 (unknown_gibbles_jump): wind up, leap at the player, land with a
  // shockwave.
  private leapFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    const t = this.target(targets);
    if (this.sub === 0) {
      this.timer = 0;
      this.sub = 4;
      this.attacking = true;
      return;
    }
    if (this.sub === 4) {
      if (++this.timer < this.windup) return;
      if (!t) {
        this.busy = false;
        this.attacking = false;
        this.setState(out, 'approach', 1);
        return;
      }
      this.sub = 1;
      const dx = t.x - this.x;
      const dz = t.z - this.z;
      const d = Math.hypot(dx, dz);
      const v = fr((d - GIBBLES.leapOffset) * GIBBLES.leapScale);
      this.vx = d > 0 ? (dx / d) * v : 0;
      this.vz = d > 0 ? (dz / d) * v : 0;
      this.vy = GIBBLES.leapVelocity;
      this.yOff = 0;
      this.setRow(out, 5);
      this.immune = true;
      this.angle = this.angleTo(t);
      return;
    }
    if (this.sub === 1) {
      if (this.frames >= GIBBLES.leapStart) {
        this.x += this.vx;
        this.z += this.vz;
        this.yOff += this.vy;
        this.vy = fr(this.vy - (this.frames < GIBBLES.leapEarlyFrames ? GIBBLES.leapEarly : GIBBLES.leapLate));
      }
      if (this.row !== 5) {
        // The motion ended and chained to row 6: the landing.
        this.yOff = 0;
        this.sub = 3;
        this.immune = false;
        const a = this.attack(2);
        out.shots = [new GroundBlast(this.x, this.z, a.distanceX, a.minAtp)];
        this.setRow(out, 6, true);
      }
      return;
    }
    if (this.sub === 3 && this.row !== 6) {
      this.busy = false;
      this.attacking = false;
      this.setState(out, 'approach', 1);
    }
  }

  // State 7 (DerolleHandleChargePhase_0056097c): the guard.
  private guardFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    if (this.sub === 0) {
      this.sub = 1;
      this.guard -= GIBBLES.guardDrain;
      if (this.guard < 1) {
        this.guard = 0;
        this.rage = true;
      }
      this.immune = true;
      this.frames = 0;
      return;
    }
    if (this.sub === 1) {
      if (this.crossed(GIBBLES.guardFrames)) {
        this.immune = false;
        this.armed = false;
        this.armGuard(targets);
        if (this.armed) {
          this.sub = 0;
          this.frames = 0;
        } else this.sub = 3;
      }
      return;
    }
    this.immune = false;
    this.armed = false;
    this.alerted = true;
    this.busy = false;
    this.setState(out, 'approach', 1);
  }

  // State 8 (DerolleHandleBeamAttackState_005607fc): the stagger; afterwards a
  // leap with the chance of param4.
  private staggerFrame(out: AiFrame): void {
    if (this.sub === 0) {
      this.sub = 1;
      return;
    }
    if (this.sub === 1) {
      if (this.row !== 8) this.sub = 3;
      return;
    }
    if (Math.fround(this.rng()) < this.staggerLeap) {
      this.busy = true;
      this.setState(out, 'leap', 4);
      this.jumpReady = false;
      return;
    }
    this.setState(out, 'approach', 1);
  }

  // State 11 (GibblesUpdateLoop_00560338): the wander at 1.25 within 100 of the
  // spawn point.
  private wanderFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    void out;
    void targets;
    if (++this.roamTimer >= 150 || (this.wx - this.x) ** 2 + (this.wz - this.z) ** 2 < GIBBLES.wander * GIBBLES.wander) {
      this.roamTimer = 0;
      const a = this.rng() * Math.PI * 2;
      this.wx = this.homeX + Math.sin(a) * 100;
      this.wz = this.homeZ + Math.cos(a) * 100;
    }
    this.angle = turnToward(this.angle, Math.atan2(this.wx - this.x, this.wz - this.z), GIBBLES.turn * BAMS_TO_RAD);
    this.x += Math.sin(this.angle) * GIBBLES.wander;
    this.z += Math.cos(this.angle) * GIBBLES.wander;
  }
}

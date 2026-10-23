// Episode 2 enemy state machines, second batch (PsoBB.exe, Ephinea 1.25.13,
// addresses are VAs): the Mericarol family (Mericarol / Merikle / Mericus) and
// the Gibbons (Ul Gibbon / Zol Gibbon). Same EnemyBrain shape as
// combat/enemyfsmep2.ts, so render/combat.ts drives them the same way.
//
// Both families are dispatchers on enemy+0x32e whose handlers take an
// argument (4 = enter, 0 = the frame, 3 = the transition check after the
// frame, 5 = leave), exactly as combat/enemyfsm.ts documents; SetEnemyAiState
// _0051f62c runs 5 on the old state and 4 on the new one, and the enemy's
// resume state after a flinch is +0x380. The names of the dump's functions
// ("Gibbles*", "Derolle*", "Mericarol*") are mostly wrong: every state below
// was matched by its callees and constants, and the data it reads (floats
// at 0x00925e00.. / 0x00926ae0.. / 0x00926b98.., the animation tables
// 0x009be3a0 / 0x009be9a0) comes from the executable itself
// (tools/exedata.py). Run-time globals the dump shows as _DAT_00a73dxx are
// written by static initialisers (0x00568f0f..0x00568f4a for the Gibbon,
// 0x00573606 for the Mericarol); their values are cited where used.
//
// Shared helper semantics (all from the dump):
//   check_entity_animation_elapsed_threshold (named in the dump, no address
//     suffix): true on the frame
//     the motion's elapsed frame counter moves from <= f to past f, that is
//     f < elapsed <= f + step (`crossed` below);
//   SetEnemyTargetPosition / InitializeEnemyAnimationVelocity: the unit
//     vector (+0x3a8, +0x3b0) and the distance (+0x3b4) to the target;
//   GalGryphonProcessMovement_005207c4 / DerolleProcessAttackHitCheck
//     _005209d4: position += unit vector * speed (the wall ray 0x00520940
//     only stops it against map geometry: NOT reproduced, ASSUMED flat open
//     ground as in combat/enemyshots.ts);
//   ProcessGalgryphonHitCheck_00521528(turn, speed): turn the heading toward
//     the vector by at most `turn` BAMS, then move along the heading;
//   FindEnemyTarget_00520ea0 / FindNearestPlayer_00521160: the nearest live
//     player closer than the radius that the line-of-sight ray sees (the ray
//     is not reproduced); a confused enemy looks at the other enemies first
//     (vtable +0x194, FindNearestEnemy_0052105c);
//   defender vtable +0x50 / +0x5c / +0x68 = should_push_defender(mult) /
//     try_hit_entity(mult) / cause_knockback(kb), as unknown_enemy_behavior_2
//     (0x0052b5f0) calls them.
// Sound effects and particles are cited, not played.
//
// The Episode 2 decompilation psobb-client-source (JP build) has no C for any
// of these enemies (its src/ holds no Gibbon / Mericarol function by name;
// its dirty/ tables only repeat this dump's names).

import { BAMS_TO_RAD, type AiFrame, type AiTarget, type EnemyAiMotion } from './enemyai.ts';
import type { EnemyAttackData, EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase, loop, once, turnToward, wrap } from './enemyfsm.ts';
import { EnemyShot, TechBolt, type ShotEffect, type ShotLook } from './enemyshots.ts';
import { enemyFire } from './techfire.ts';
import { SporeCloud } from './enemyfsmep2.ts';
import { techFreezeChance, techShockChance } from './enemystatus.ts';
import { STATUS } from './status.ts';
import { TECH, techData, techPower } from './techniques.ts';
import { exhaustive } from '../exhaustive.ts';

// ASSUMED: the player's hit box radius for body contacts (render/lobbyview.ts,
// the same value combat/enemyshots.ts uses).
const PLAYER_RADIUS = 5;

// check_entity_animation_elapsed_threshold: f < elapsed <= f + step.
function crossedAt(elapsed: number, step: number, f: number): boolean {
  return elapsed > f && elapsed <= f + step;
}

// --- Mericarol / Merikle / Mericus ---------------------------------------------
//
// Ctor TMericarol_Constructor_00572cd2 (factory 0x00572b84, vtable
// TMericarol_vtable, dispatcher MericarolProcessAction_005710b8, update
// 0x005730da, model bm_ene_bm9_s_mericarol.bml), animation table 0x009be9a0,
// AI record 0x009beaac {search 225, 0, turn 512 BAMS}, main hit box
// 0x009be940 (radius 25 at 0x009be94c), swipe hit box 0x009be96c (radius 50 at
// 0x009be978). Subtype (+0x464) = initdata_param6 when 0..2 (0 Mericarol, 1
// Merikle, 2 Mericus; the name index 0x38 / 0x39 / 0x3a), per-subtype
// battle-parameter rows g_MericarolStats[subtype] (entitynames: 58 / 69 / 70).
// The set entry's params (handle_mericarol_init_params 0x00572fa8, constants
// 0x00926ba0..0x00926bac) and MovementData (g_MericarolAnimationSpeeds row,
// offsets +0 fparam1 .. +0x14 fparam6, +0x18 iparam1 .. +0x2c iparam6):
//   +0x448 = 0.5 + param1   the chance a flinch in the 20..50% HP window sends
//                           it into the rush;
//   +0x44c = max(3.0 + param2, 1.0) the rush speed;
//   +0x450 = 0.1 + param3   in range: random > this -> swipe, else cloud;
//   fparam1 the rush's tech power (group 0), fparam2 the cloud's power
//   (group 5, Megid), fparam3 the bolt's power, fparam4 the bolt's speed,
//   fparam5 the cloud's radius, fparam6 the cloud's "real" threshold,
//   iparam3 frames of hunting before a bolt, iparam4 the cloud's warning
//   frames, iparam5 the swipe's hold frames, iparam6 the confusion chance
//   (percent) of a Mericarol bolt.
// Animation rows (motion, step): 0 (3, 0.6) once; 1 (5, 1.0) loop; 2 (6, 0.5)
// loop; 3 (5, 0.5) loop; 4 (7, 0.7) once -> row 3; 5 (1, 0.8) once; 6 (2,
// 0.5) once; 7 (4, 0.6) loop; 8 (0, 0.7) loop. The exe lets rows 7 and 8 run
// one cycle (it ends them at the last frame minus one step); they are played
// as one-shots here so the owner reports their end (the same frame, one step
// earlier at most).
// Flags +0x440: 0x20 super armor (the damage handler 0x0057358c skips the
// flinch while it is set: the attack states and the rush's charge), 0x08 set
// with it in the burrow, 0x10 "has a target", 0x02 "my bolt landed" (-> 8).
// The death handler (vtable +0xf4, 0x00573570) sends everything to state 0xb.
//   0 (0x005738b0): -> 1.
//   1 (0x00572a60, spawn): row 2, hidden (vtable +0x184: invulnerable, hit
//     boxes off, off the radar) and armored, the emergence effect (the same
//     40-frame object as the Merillia's), then 2 (+0x188 shows it again).
//   2 (0x005729c0, idle): row 2; FindEnemyTarget(250) -> 3; the landed-bolt
//     flag -> 8.
//   3 (0x00572718, hunt): row 4 coming from 2 (the wake-up), else row 3.
//     It never walks: it turns toward the target by 512 BAMS a frame. Every
//     20 frames it switches to a player 30 (0x00926bdc) closer than its
//     target. Then: flag -> 8; farther than 300 (0x00926bd8) or no target
//     -> 2; 50 (0x00926bd4) or farther: after iparam3 frames of hunting ->
//     4; closer than 50 and facing the target within 0x4000 BAMS: random >
//     +0x450 -> 5 else 9.
//   4 (0x00572410, bolt): row 0, armored; at motion frame 10 the technique
//     object (InitializeTechParameters_00573990 / MericarolTechEntity_Update
//     _00573ce4): aimed at the target 12 (0x00926dc0) above its feet at
//     fparam4 a frame, 150 frames of life (0x00926db0), group by subtype and
//     difficulty (Mericarol 0, Merikle 2 = Gibarta, Mericus 3 = Zonde,
//     Ultimate 5 = Megid) with power fparam3; a Mericarol's bolt also rolls
//     iparam6 % for a confusion hit (group 0x12). When it lands the shooter
//     gets flag 2 (MericarolProcessState_005735b0). Animation end -> 3.
//   5 (0x00572094, swipe): row 8, armored; at frame 8 the hit box of radius
//     50 hits every player in it (should_push_defender(1.0), try_hit(1.0),
//     knockback(1.0)); at the end of the cycle the pose freezes (row 3, step
//     0) for iparam5 frames -> 3.
//   6 (0x00571a60, rush): ray 100 ahead blocked -> 3. Row 2 for 10 frames
//     (+0x4a0) turning toward the target, then row 1 armored: it runs along
//     the aimed vector at +0x44c a frame until it has covered 200
//     (0x00926c1c), hitting each player once through entity_hit_by_tech group
//     0 with fparam1 (the exe also ORs 0x600 into the player's flags: not
//     reproduced), then 10 frames of 0.9 (0x00926c28) a frame deceleration,
//     then 3.
//   7 (0x005717dc, TP drain): row 2, armored and invulnerable (+0x174); at frame 6 the first live
//     player within 100 (0x00a73f20 = 10000 squared) becomes the target; at
//     frame 25 (0x19) its TP is set to 0; frame 30 -> 3.
//   8 (0x005716f8, recover): row 7 for one cycle -> 3.
//   9 (0x0057148c, cloud): row 2, armored, iparam4 frames of warning (turning
//     to face the target is NOT done); then random > fparam6: row 0, and at
//     motion frame 10 the Megid cloud (MericarolSpawnMegidCloud_00576714: 20
//     above, group 5, power fparam2, radius fparam5, particles 0x20b /
//     0x20c); else the bluff -> 8. Animation end -> 3.
//   10 (0x00571314, flinch): row 5. At its end: HP between max / 5 and max /
//     2 and random <= +0x448 -> 6; random < 0.05 (0x00926c38) -> 7; else the
//     resume state (+0x380, 3 or 2).
//   0xb (maybe_mericarol_hit, 0x00571194, dies): row 6; the owner plays it (the corpse sinks 0.1
//     a frame to 30 and drops an item 10 ahead).
export const MERICAROL = {
  search: 250, // FindEnemyTarget_00520ea0(250.0) in 0x005729c0
  turn: 512,
  emergeFrames: 40, // InitializeEnemyStateTimer_00576c48, as the Merillia
  bodyRadius: 25, // 0x009be94c
  swipeRadius: 50, // 0x009be978
  retarget: 20,
  retargetMargin: 30, // 0x00926bdc
  loseRange: 300, // 0x00926bd8
  boltMin: 50, // 0x00926bd4
  faceArc: 0x4000,
  boltFrame: 10,
  swipeFrame: 8,
  cloudFrame: 10,
  cloudLift: 20, // 0x00926c30
  windup: 10,
  rushRange: 200, // 0x00926c1c
  rushDecay: Math.fround(0.9), // 0x00926c28
  rushStop: 10,
  drainPick: 6,
  drainFrame: 0x19,
  drainEnd: 0x1d,
  drainRangeSq: 10000, // 0x00a73f20, written at 0x00573606
  flinchLowHp: Math.fround(0.05), // 0x00926c38
  chanceBase: Math.fround(0.5), // 0x00926bac
  speedBase: 3, // 0x00926ba8
  speedMin: 1, // 0x00926ba4
  swipeBase: Math.fround(0.1), // 0x00926ba0
  boltLife: 150, // 0x00926db0
  boltAim: 12, // 0x00926dc0
  boltRadius: 2, // the tech object's box, set to 2.0 at 0x00573990
  // ASSUMED: the model node the bolt leaves from (matrix pool slot 0x10c0).
  mouthAhead: 12,
  mouthHeight: 20,
  flinchHpLow: 0.2,
  flinchHpHigh: 0.5,
} as const;

const MERICAROL_ANIM = {
  cast: once(3, 0.6), // row 0
  run: loop(5, 1), // row 1
  idle: loop(6, 0.5), // row 2
  stand: loop(5, 0.5), // row 3
  wake: once(7, 0.7), // row 4 (-> row 3)
  flinch: once(1, 0.8), // row 5
  dead: once(2, 0.5), // row 6
  recover: once(4, 0.6), // row 7 (loop in the table, one cycle in the exe)
  swipe: once(0, 0.7), // row 8 (the same)
  freeze: { index: 5, speed: 0, loop: true } as EnemyAiMotion, // row 3 at animation_speed 0
} as const;

export type MericarolState = 'spawn' | 'idle' | 'hunt' | 'bolt' | 'swipe' | 'rush' | 'drain' | 'recover' | 'cloud';

// The Mericarol's technique object (flies on its own).
export class MericarolBolt extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook;
  private vx: number;
  private vy: number;
  private vz: number;
  private onHit: (() => void) | null;
  private roll: (() => boolean) | null;

  constructor(opts: { x: number; y: number; z: number; tx: number; tz: number; speed: number; effect: ShotEffect; color: number; onHit?: () => void; roll?: () => boolean }) {
    super(opts.x, opts.y, opts.z);
    this.effect = opts.effect;
    this.look = { color: opts.color, size: 2 };
    this.onHit = opts.onHit ?? null;
    this.roll = opts.roll ?? null;
    // local_48 = target - pos, y = 12 - pos.y + target.y (feet at 0 here).
    const dx = opts.tx - opts.x;
    const dy = MERICAROL.boltAim - opts.y;
    const dz = opts.tz - opts.z;
    const len = Math.hypot(dx, dy, dz);
    const k = len > 0 ? opts.speed / len : 0;
    this.vx = dx * k;
    this.vy = dy * k;
    this.vz = dz * k;
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    // MericarolTechEntity_Update_00573ce4: the life counter first (dies at
    // 150), then the move, then the hit test (vtable +0x38).
    if (++this.frames >= MERICAROL.boltLife) {
      this.done = true;
      return [];
    }
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    const hit = this.within(targets, MERICAROL.boltRadius)[0];
    if (!hit) return [];
    this.done = true;
    this.onHit?.();
    return !this.roll || this.roll() ? [hit] : [];
  }
}

export class MericarolAi extends BrainBase {
  state: MericarolState | 'dead' = 'spawn';
  confused = false;
  // Current HP / max HP: read when a flinch ends (the owner does not tick the
  // brain meanwhile); `hp` is the live reader, `hpFraction` a plain field.
  hpFraction = 1;
  private readonly hp: (() => number) | null;
  // The motion frame counts are not needed: every wait ends on the owner's
  // animationEnded or on a frame counter.
  private readonly subtype: number;
  private readonly ultimate: boolean;
  private readonly turnRate: number;
  private readonly runChance: number;
  private readonly runSpeed: number;
  private readonly swipeChance: number;
  private readonly mv: { f: readonly number[]; i: readonly number[] };
  private readonly selfId: () => number;
  private sub = 0;
  private timer = 0; // +0x498 style counter of the current state
  private huntFrames = 0; // [1].y1
  private retargetCount = 0; // [1].flPosition_z
  private frames = 0; // the motion's elapsed frame counter
  private armor = false; // flag 0x20
  private skill = false; // flag 0x02
  private resumeState: MericarolState = 'idle';
  private effect = 0; // emergence effect frames
  private windup = 0;
  private travelled = 0;
  private rushSpeed = 0;
  private dirX = 0;
  private dirZ = 0;
  private struck: number[] = [];
  private draining = false;
  private drainId = -1;

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    subtype: number;
    params: readonly number[];
    movement: EnemyMovementData | null;
    attack?: EnemyAttackData | null;
    ultimate?: boolean;
    selfId?: () => number;
    hp?: () => number;
    rng?: () => number;
  }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.hp = opts.hp ?? null;
    this.subtype = opts.subtype >= 0 && opts.subtype <= 2 ? opts.subtype : 0;
    this.ultimate = opts.ultimate ?? false;
    this.turnRate = MERICAROL.turn * BAMS_TO_RAD;
    const p = (i: number) => opts.params[i] ?? 0;
    this.runChance = Math.fround(MERICAROL.chanceBase + p(0));
    this.runSpeed = Math.max(Math.fround(MERICAROL.speedBase + p(1)), MERICAROL.speedMin);
    this.swipeChance = Math.fround(MERICAROL.swipeBase + p(2));
    const m = opts.movement;
    this.mv = {
      f: m ? [m.fparam1, m.fparam2, m.fparam3, m.fparam4, m.fparam5, m.fparam6] : [0, 0, 0, 0, 0, 0],
      i: m ? m.iparam : [0, 0, 0, 0, 0, 0],
    };
    this.selfId = opts.selfId ?? (() => -1);
    this.current = MERICAROL_ANIM.idle;
    this.armor = true;
  }

  // vtable +0x184 (0x00520504: +0x174 invulnerable flag 0x4000000 on the
  // entity and 0x2000000 on its hit boxes, +0x180 hit boxes off, entity flags
  // 0x4040000) hides the spawning one; the TP drain only calls +0x174.
  get invulnerable(): boolean {
    return this.state === 'spawn' || this.state === 'drain';
  }

  // Entity flag 0x40000 / minimap and lock-on: hidden while it burrows.
  get untargetable(): boolean {
    return this.state === 'spawn';
  }

  // Flag 0x20: the damage handler (vtable +0xf0, 0x0057358c) sends a hit to
  // state 10 unless this bit is set.
  get superArmor(): boolean {
    return this.armor && this.state !== 'dead';
  }

  get flinchMotion(): EnemyAiMotion {
    return MERICAROL_ANIM.flinch;
  }

  get deathMotion(): EnemyAiMotion {
    return MERICAROL_ANIM.dead;
  }

  private setAnim(out: AiFrame, m: EnemyAiMotion): void {
    this.frames = 0;
    this.play(out, m);
  }

  private crossed(f: number): boolean {
    return crossedAt(this.frames, this.current?.speed ?? 0, f);
  }

  // FindEnemyTarget_00520ea0 / FindNearestPlayer_00521160: the nearest live
  // target closer than `range`; a confused enemy prefers the other enemies
  // (FindNearestEnemy_0052105c, ids 0x1000 | index).
  private nearestIn(targets: readonly AiTarget[], range: number): AiTarget | null {
    let best: AiTarget | null = null;
    let bestSq = range * range;
    for (let pass = this.confused ? 0 : 1; pass < 2 && !best; pass++) {
      bestSq = range * range;
      for (const t of targets) {
        if (t.dead || (pass === 0) !== t.clientId >= 0x1000) continue;
        const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
        if (d >= bestSq) continue;
        best = t;
        bestSq = d;
      }
    }
    return best;
  }

  private faceTarget(t: AiTarget): void {
    this.angle = turnToward(this.angle, this.angleTo(t), this.turnRate);
  }

  private enter(out: AiFrame, state: MericarolState): void {
    const from = this.state;
    this.state = state;
    this.sub = 0;
    this.timer = 0;
    switch (state) {
      case 'spawn':
        this.armor = true;
        this.effect = 0;
        this.targetId = null;
        this.resumeState = 'idle';
        this.setAnim(out, MERICAROL_ANIM.idle);
        break;
      case 'idle':
        this.armor = false;
        this.targetId = null;
        this.resumeState = 'idle';
        this.setAnim(out, MERICAROL_ANIM.idle);
        break;
      case 'hunt':
        this.armor = false;
        this.resumeState = 'hunt';
        this.huntFrames = 0;
        this.setAnim(out, from === 'idle' ? MERICAROL_ANIM.wake : MERICAROL_ANIM.stand);
        break;
      case 'bolt':
        this.armor = true;
        this.resumeState = 'hunt';
        this.setAnim(out, MERICAROL_ANIM.cast);
        break;
      case 'swipe':
        this.armor = true;
        this.resumeState = 'hunt';
        this.setAnim(out, MERICAROL_ANIM.swipe);
        break;
      case 'rush':
        this.armor = false;
        this.resumeState = 'hunt';
        this.windup = MERICAROL.windup;
        this.travelled = 0;
        this.rushSpeed = this.runSpeed;
        this.struck.length = 0;
        // The vector of the last SetEnemyTargetPosition; before any, ahead.
        if (this.dirX === 0 && this.dirZ === 0) {
          this.dirX = Math.sin(this.angle);
          this.dirZ = Math.cos(this.angle);
        }
        this.setAnim(out, MERICAROL_ANIM.idle);
        break;
      case 'drain':
        this.armor = true;
        this.resumeState = 'hunt';
        this.draining = false;
        this.drainId = -1;
        this.setAnim(out, MERICAROL_ANIM.idle);
        break;
      case 'recover':
        this.armor = false;
        this.resumeState = 'hunt';
        this.setAnim(out, MERICAROL_ANIM.recover);
        break;
      case 'cloud':
        this.armor = true;
        this.resumeState = 'hunt';
        this.timer = Math.trunc(this.mv.i[3] ?? 0);
        this.setAnim(out, MERICAROL_ANIM.idle);
        break;
      default:
        exhaustive(state);
    }
  }

  // MericarolCheckSkillCondition_005726fc: the landed-bolt flag sends it to 8.
  private skillCheck(out: AiFrame): boolean {
    if (!this.skill) return false;
    this.enter(out, 'recover');
    return true;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.frames += this.current?.speed ?? 0;
    let t = this.target(targets);
    // The row 4 wake-up chains to row 3 (mode 2, next 3).
    if (this.current === MERICAROL_ANIM.wake && animationEnded) this.setAnim(out, MERICAROL_ANIM.stand);
    switch (this.state) {
      case 'spawn':
        if (++this.effect >= MERICAROL.emergeFrames) this.enter(out, 'idle');
        break;
      case 'idle': {
        if (this.skillCheck(out)) break;
        const found = this.nearestIn(targets, MERICAROL.search);
        if (found) {
          this.targetId = found.clientId;
          this.enter(out, 'hunt');
        }
        break;
      }
      case 'hunt':
        t = this.huntFrame(out, targets, t);
        break;
      case 'bolt':
        this.boltFrame(out, t, animationEnded);
        break;
      case 'swipe':
        this.swipeFrame(out, t, targets, animationEnded);
        break;
      case 'rush':
        this.rushFrame(out, t, targets);
        break;
      case 'drain':
        this.drainFrame(out, targets);
        break;
      case 'recover':
        if (animationEnded) {
          this.skill = false; // leaving state 8 clears flag 2
          this.enter(out, 'hunt');
        }
        break;
      case 'cloud':
        this.cloudFrame(out, animationEnded);
        break;
      default:
        exhaustive(this.state);
    }
    return this.finish(out);
  }

  // 0x00572718.
  private huntFrame(out: AiFrame, targets: readonly AiTarget[], t: AiTarget | null): AiTarget | null {
    if (this.skillCheck(out)) return t;
    if (this.retargetCount < MERICAROL.retarget) {
      this.retargetCount++;
      if (!t) {
        this.huntTransition(out, t);
        return t;
      }
    } else {
      this.retargetCount = 0;
      if (t && this.dist(t) > MERICAROL.retargetMargin) {
        const c = this.nearestIn(targets, this.dist(t) - MERICAROL.retargetMargin);
        if (c) {
          this.targetId = c.clientId;
          t = c;
        }
      }
    }
    if (t) {
      this.huntFrames++;
      this.faceTarget(t);
    }
    this.huntTransition(out, t);
    return t;
  }

  private huntTransition(out: AiFrame, t: AiTarget | null): void {
    if (!t || this.dist(t) > MERICAROL.loseRange) {
      this.enter(out, 'idle');
      return;
    }
    const d = this.dist(t);
    if (d >= MERICAROL.boltMin) {
      if (this.huntFrames > Math.trunc(this.mv.i[2] ?? 0)) this.enter(out, 'bolt');
      return;
    }
    if (Math.abs(wrap(this.angleTo(t) - this.angle)) < MERICAROL.faceArc * BAMS_TO_RAD) {
      this.enter(out, Math.fround(this.rng()) > this.swipeChance ? 'swipe' : 'cloud');
    }
  }

  // 0x00572410.
  private boltFrame(out: AiFrame, t: AiTarget | null, animationEnded: boolean): void {
    if (t) this.faceTarget(t);
    if (this.crossed(MERICAROL.boltFrame) && t) this.fireBolt(out, t);
    if (this.skillCheck(out)) return;
    if (animationEnded) this.enter(out, 'hunt');
  }

  private fireBolt(out: AiFrame, t: AiTarget): void {
    const x = this.x + Math.sin(this.angle) * MERICAROL.mouthAhead;
    const z = this.z + Math.cos(this.angle) * MERICAROL.mouthAhead;
    const power = this.mv.f[2] ?? 0;
    const speed = this.mv.f[3] ?? 0;
    const land = (): void => {
      this.skill = true;
    };
    const sub = this.subtype;
    const shots = (out.shots ??= []);
    const base = { x, y: MERICAROL.mouthHeight, z, tx: t.x, tz: t.z, speed };
    if (this.ultimate) {
      shots.push(new MericarolBolt({ ...base, effect: { kind: 'megid', power }, color: 0x802080, onHit: land }));
      return;
    }
    // InitializeTechParameters_00573990: group 0 / 2 (Gibarta) / 3 (Zonde).
    shots.push(new MericarolBolt({ ...base, effect: { kind: 'tech', power }, color: sub === 1 ? 0x80d0ff : sub === 2 ? 0xffff40 : 0x60c060, onHit: land }));
    if (sub === 1) {
      // ASSUMED: the freeze / shock rolls are the player caster's
      // (combat/enemystatus.ts); a companion shot carries the status.
      const chance = techFreezeChance(power, false);
      shots.push(new MericarolBolt({ ...base, effect: { kind: 'status', status: STATUS.freeze }, color: 0x80d0ff, roll: () => this.rng() < chance }));
    } else if (sub === 2) {
      const chance = techShockChance(false);
      shots.push(new MericarolBolt({ ...base, effect: { kind: 'status', status: STATUS.shock }, color: 0xffff40, roll: () => this.rng() < chance }));
    } else if (Math.fround(this.rng()) <= Math.fround((this.mv.i[5] ?? 0) / 100)) {
      // The extra confusion hit (group 0x12) a Mericarol's bolt rolls at launch.
      shots.push(new MericarolBolt({ ...base, effect: { kind: 'status', status: STATUS.confusion }, color: 0x60c060 }));
    }
  }

  // 0x00572094.
  private swipeFrame(out: AiFrame, t: AiTarget | null, targets: readonly AiTarget[], animationEnded: boolean): void {
    if (t) this.faceTarget(t);
    if (this.sub === 0) {
      if (animationEnded) {
        this.sub = 1;
        this.armor = false;
        this.timer = 0;
        this.setAnim(out, MERICAROL_ANIM.freeze);
      } else if (this.crossed(MERICAROL.swipeFrame)) {
        // The swipe box (radius 50) hits the players in it.
        let victim: AiTarget | null = null;
        const r = MERICAROL.swipeRadius + PLAYER_RADIUS;
        if (t && this.dist(t) <= r) victim = t;
        else
          for (const p of targets) {
            if (!p.dead && p.clientId < 0x1000 && this.dist(p) <= r) {
              victim = p;
              break;
            }
          }
        if (victim) out.hit = { clientId: victim.clientId, knockback: 1, mult: 1 };
      }
    } else if (this.sub === 1 && ++this.timer >= Math.trunc(this.mv.i[4] ?? 0)) this.sub = 2;
    if (this.sub === 2) this.enter(out, 'hunt');
  }

  // 0x00571a60.
  private rushFrame(out: AiFrame, t: AiTarget | null, targets: readonly AiTarget[]): void {
    if (this.sub === 0) {
      // Track the target while winding up (the ray ahead is open here).
      if (t) {
        const a = this.angleTo(t);
        this.dirX = Math.sin(a);
        this.dirZ = Math.cos(a);
        this.angle = turnToward(this.angle, a, this.turnRate);
      }
      if (--this.windup < 1) {
        this.sub = 1;
        this.armor = true;
        this.setAnim(out, MERICAROL_ANIM.run);
      }
      return;
    }
    const power = this.mv.f[0] ?? 0;
    if (this.sub === 1) {
      this.x += this.dirX * this.rushSpeed;
      this.z += this.dirZ * this.rushSpeed;
      this.rushHits(out, targets, power);
      this.travelled += this.rushSpeed;
      if (this.travelled >= MERICAROL.rushRange) {
        this.sub = 2;
        this.armor = false;
        this.timer = 0;
      }
      return;
    }
    this.rushSpeed = Math.fround(this.rushSpeed * MERICAROL.rushDecay);
    this.x += this.dirX * this.rushSpeed;
    this.z += this.dirZ * this.rushSpeed;
    this.rushHits(out, targets, power);
    if (++this.timer > MERICAROL.rushStop - 1) {
      this.sub = 3;
      this.setAnim(out, MERICAROL_ANIM.stand);
      this.enter(out, 'hunt');
    }
  }

  // The body box (flags 0x700) against the players: each is hit once.
  private rushHits(out: AiFrame, targets: readonly AiTarget[], power: number): void {
    const r = MERICAROL.bodyRadius + PLAYER_RADIUS;
    for (const p of targets) {
      if (p.dead || p.clientId >= 0x1000 || this.struck.includes(p.clientId) || this.dist(p) > r) continue;
      this.struck.push(p.clientId);
      if (power > 0) out.techHit = { clientId: p.clientId, power };
      return;
    }
  }

  // 0x005717dc.
  private drainFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    if (this.timer === MERICAROL.drainPick) {
      // The first live, targetable player in the entity array within 100.
      for (const p of targets) {
        if (p.dead || p.clientId >= 0x1000 || (p.x - this.x) ** 2 + (p.z - this.z) ** 2 >= MERICAROL.drainRangeSq) continue;
        this.targetId = p.clientId;
        this.draining = true;
        this.drainId = p.clientId;
        break;
      }
    } else if (this.timer === MERICAROL.drainFrame && this.draining) {
      // *(short *)(player + 0x336) = 0: the player's TP.
      if (this.drainId === this.selfId()) out.tpDrain = 1;
    }
    this.timer++;
    if (this.timer > MERICAROL.drainEnd) this.enter(out, 'hunt');
  }

  // 0x0057148c.
  private cloudFrame(out: AiFrame, animationEnded: boolean): void {
    if (this.sub === 0) {
      if (--this.timer < 1) {
        if ((this.mv.f[5] ?? 0) < Math.fround(this.rng())) {
          this.sub = 1;
          this.setAnim(out, MERICAROL_ANIM.cast);
        } else {
          this.enter(out, 'recover'); // the bluff
        }
      }
      return;
    }
    if (this.crossed(MERICAROL.cloudFrame)) {
      const radius = this.mv.f[4] ?? 0;
      const power = this.mv.f[1] ?? 0;
      out.shots = [new SporeCloud(this.x, this.z, radius, { kind: 'megid', power })];
    }
    if (animationEnded) this.enter(out, 'hunt');
  }

  // A hit turns it on its attacker. The motion is kept: an armored state
  // goes on with it, a flinch ends in resume(), which re-enters a state.
  override onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
  }

  // The flinch ended (0x00571314, state 10).
  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    this.armor = false;
    // Max HP / 5 <= HP <= max HP / 2 (integer division in the exe).
    const frac = this.hp ? this.hp() : this.hpFraction;
    const window = frac <= MERICAROL.flinchHpHigh && frac >= MERICAROL.flinchHpLow;
    if (window && Math.fround(this.rng()) <= this.runChance) {
      this.enter(out, 'rush');
      return this.state;
    }
    if (Math.fround(this.rng()) < MERICAROL.flinchLowHp) {
      this.enter(out, 'drain');
      return this.state;
    }
    this.enter(out, this.resumeState);
    return this.state;
  }
}

// --- Ul Gibbon / Zol Gibbon ------------------------------------------------------
//
// Ctor ulgibbon_constructor (0x00564a64; the dump's DerolleConstructor_
// 005649e8 is its factory), vtable ulgibbon_vtable (0x00b05750, dispatcher
// 0x00564ff0 at +0x154), update GibblesUpdate_005687bc, model
// bm_ene_bm5_gibon_u.bml (model 0 Ul, model 1 Zol), animation table
// 0x009be3a0, AI record 0x009be53c {search 225, 0, turn 1536 BAMS}, hit boxes
// 0x009be2e0 (Ul, radius 8) / 0x009be30c (Zol, radius 12). initdata_param6
// (+0x370) >= 1 makes a Zol Gibbon (+0x46c = 1, the group leader, name index
// 0x3c; a Ul is 0x3b). The set entry's params (InitializeTargetOffset_
// 00564e98, constants 0x00925ff4 / f8 / fc):
//   param1 = the group id (+0x474, round()): Ul Gibbons follow the Zol of
//            their group (the leader list g_GibbonEntityListHead is only fed
//            by Zols; every Gibbon is in g_GibbonEnemyTypeConfig);
//   param2 < 1.0 (+0x478 = 1): "SpotAppear" (state 2) else "JumpAppear" (1);
//   param3 + 0.4 (+0x4a8): the chance of the back step (13) instead of the
//            charge (12) when it attacks;
//   param4 + 0.3 (+0x4ac): the chance a stride of the approach (9 / 10)
//            ends in a spell (every 50 units walked);
//   param5 + 0.3 (+0x4b0): the chance of a spell after the back step.
// Its radius of vision is 350 (Zol) / 250 (Ul), 0x00565eac. The spell level
// is the stats row's level field (unknown_get_tech_level_from_battleparams_
// stats: 0..14, Ultimate 0..29). MovementData is not used.
//
// Animation rows of 0x009be3a0 (motion, step; the motions of the archive are
// 0 attack, 1 back, 2 damage, 3 dead, 4 fire, 5 hoe, 6 run, 7 wait, 8 walk):
//   0 (7, 1.0) loop wait; 1 (8, 1.0) loop walk; 2 and 3 (6, 1.0) loop run;
//   4 (7, 1.0) once; 5 and 9 (5, 1.0) once hoe; 6 (2, 1.0) once damage;
//   10 (0, 1.2) once attack; 11 (3, 1.3) once dead; 12 (1, 1.0) once back;
//   13 (4, 1.0) once fire; 14 (7, 0.5) once, chaining to row 9;
//   15 (0, 0) and 16 (6, 0): the table gives step 0 for these two rows.
//   ASSUMED: they run at 1.0 (a step of 0 would never end the jump or the
//   dodge, which the exe waits for).
// States (enemy+0x32e; the dispatcher also holds an unused state 0xd whose
// only callers are its own transitions: not ported):
//   0 spawn (0x005690f8): reads its group's leader (Zol with the same
//     param1; the leader's spawn point becomes the Ul's wander centre
//     +0x490, a Zol's own is) and goes to 1 or 2 on the first frame.
//   1 jump in (0x005685f4): row 15; it is moved 100 (0x00925e04) back along
//     its heading at once (a teleport: `warps`), then runs forward at 3.5714
//     (0x40649249) a frame, 0.8 (0x00925e08) times that after motion frame
//     28; at the end of the motion: a target in sight -> 8 else 3.
//   2 spot in (0x00568518): row 0; the 40-frame emergence effect, then the
//     same.
//   3 wait (0x00568420): row 4; looks for a target every frame; one in sight
//     -> 7 (leader) / 6 (member), and tells the leader; alerted by the group
//     -> 5.
//   5 alert (0x00568344): row 4 for trunc(60 * random) + 10 frames -> 7 / 6.
//   6 roar (0x0056825c): row 5 for 60 frames -> 8.
//   7 leader's call (0x00564ff0 case 7): row 14 (-> 9); at frame 60 every
//     member of the group is alerted; the end of the motion -> 8.
//   8 wander (0x00567cb8): row 1 toward a random point (distance 120 *
//     random, angle random) around the home point, speed 0.3 + 0.7 *
//     random (the speed rises 0.05 a frame, falls 0.02), stops within 2 +
//     20.37 * speed or after 100 frames, then waits 240..360 frames (row 0)
//     and picks the next point. A target within 150 (0x00a73d0c = 22500
//     squared) -> 9 or 10 (random < 0.5, 0x00925ed0).
//   9 run (0x00567a38): row 2; a stride speed burst of 4.0 at motion frame
//     18, 0.9 a frame outside frames 10..18; the end of a cycle within 90
//     of the target -> 11, else keeps running; a spell roll every 50 units.
//   10 zigzag (0x005676a0): row 3; the same with the heading alternating
//     +/- 0x1c71 BAMS every stride (burst 6.0).
//   11 (0xb) stalk (0x00566fbc): row 1; circles the point where the target
//     stood at speed 0.7 (the target speed lerps 0.12 a frame); between
//     frames 45 and 451: closer than 100 (0x00a73d04 = 10000 squared) it
//     attacks only when the target is within 30 (0x00a73d08 = 900 squared)
//     or the Gibbon is behind it (150 degrees off its facing, 0x6aaa); the
//     attack is the back step with probability +0x4a8 else the charge;
//     farther than 100 -> 9 / 10; at 451 frames a 50% roll.
//   12 (0xc) charge (0x00566b9c): row 10; runs at the target (min(distance,
//     40) / 14.667 a frame, 0x00925f18 / 0x00925f24), at motion frame 22 the
//     bite (try_hit(1.0), knockback 7.0; Ultimate: 0.1 (0x00925f28) slow
//     (Ul) / paralysis (Zol)); it slides on 0.8 a frame after frame 28
//     unless it landed.
//   13 (0x13) back step (0x005658c4): row 12; backwards (away from the
//     target, rotated by -1..1 * 0x1fff BAMS) 60 in 33 frames
//     (0x00925fd0) while it faces the target; the stomp at frame 33; then a
//     spell with probability +0x4b0 else 8.
//   14 (0x14) cast (unknown_gibbon_behavior2): turns 1536 BAMS a frame to
//     the target (row 1), then row 13; at frame 15 the spell from 12 ahead
//     and 15 up: Ul Foie (Ultimate: Gizonde), Zol Rafoie (Ultimate: Megid),
//     level from the stats; the end -> 8.
//   15 (0xf) enrage (0x00566468): row 9; Deband on itself at frame 30 and
//     Shifta at frame 40 (the caster is its leader), then 8.
//   16 (0x10) flinch (0x0056627c): row 6, the owner plays it; at its end
//     the resume state (a charge resumes as the dodge, a wait as 8).
//   17 (0x11) dies (0x00565ecc): row 11; a leader's death starts the
//     enrage countdown (trunc(50 * random) + 20 frames) of every Gibbon of
//     its group (GibblesUpdate_005687bc fires state 0xf at 0).
//   0xe dodge (0x0056661c): row 0, then row 16 for a stride at 1.8
//     (0x0056812c...) sideways (heading +/- (0x1800 + (n >> 1) * 0x1000)
//     BAMS, the sign by the entity index parity), then a target in sight
//     -> 11 else 8.
// Heights, the wall rays and the lean (+0x480) are not reproduced. The
// group's Shifta / Deband are exposed as `buffs` and queued in `casts`, which
// render/combat.ts applies to the enemy's own EntityBuffs.
export const GIBBON = {
  searchUl: 250,
  searchZol: 350, // 0x00565eac
  turn: 1536, // record 0x009be53c
  radius: [8, 12] as readonly number[], // 0x009be2e0 / 0x009be30c
  emergeFrames: 40,
  spotThreshold: 1, // 0x00925ffc
  backChanceBase: Math.fround(0.4), // 0x00925ff8
  spellChanceBase: Math.fround(0.3), // 0x00925ff4
  jumpBack: 100, // 0x00925e04
  jumpSpeed: Math.fround(3.5714285373687744), // 0x40649249
  jumpDecay: Math.fround(0.8), // 0x00925e08
  threshold: 28, // _g_GibblesSpeedThreshold 0x00925f20
  roarFrames: 60, // 0x3c
  alertBase: 10,
  alertSpan: 60, // 0x00925e14
  wanderRadius: 120, // 0x00925e3c
  wanderSpeed: Math.fround(0.7), // 0x00925e40
  wanderSpeedMin: Math.fround(0.3), // 0x00925e38
  wanderAccel: Math.fround(0.05),
  wanderBrake: Math.fround(0.02),
  wanderStop: 2, // 0x00925e64
  wanderSteps: 100,
  wanderHalt: Math.fround(0.1), // 0x00925e5c
  waitMin: 240,
  waitMax: 360,
  aggroSq: 22500, // 0x00a73d0c, written at 0x00568f15
  techChance: Math.fround(0.5), // 0x00925ed0
  burstA: 4, // 0x00925e78
  burstB: 6, // 0x40c00000
  burstFrame: 18, // 0x00925ea4
  burstLow: 10, // 0x00925ea8
  burstDecay: Math.fround(0.9), // 0x00925e88 / 0x00925eb8
  turnScale: 768, // 0x00925e8c
  stride: 50, // 0x00925e84
  nearStalk: 90, // 0x00925ea0
  zigzag: 0x1c71,
  zigzagTarget: 2,
  runTarget: Math.fround(1.6), // 0x3fcccccd
  stalkSpeed: Math.fround(0.7),
  stalkLerp: Math.fround(0.12),
  stalkMin: 0x2d,
  stalkMax: 0x1c3,
  stalkFarSq: 10000, // 0x00a73d04, written at 0x00568f1f
  stalkNearSq: 900, // 0x00a73d08, written at 0x00568f33
  stalkBehind: 0x6aaa,
  stalkTurn: 0x200,
  chargeFrame: 22,
  chargeMove: 28,
  chargeMax: 40, // _g_GibblesMaxSpeed 0x00925f18
  chargeNorm: Math.fround(14.666666984558105), // 0x00925f24
  chargeSlide: Math.fround(0.8), // 0x00925f1c
  chargeLerp: Math.fround(0.1), // 0x00925f28
  chargeSide: 7, // 0x00925f0c
  chargeKnock: 7,
  chargeStatusChance: Math.fround(0.1),
  chargeTurn: 0x1000,
  // ASSUMED: should_push_defender's box test (vtable +0x50) as a distance.
  reach: 8,
  backDistance: 60, // 0x42700000
  backFrames: 33, // 0x00925fd0
  backStomp: 33, // 0x00925fb4
  backFrame: 8,
  backTurn: 0x1000,
  backStep: 0x1fff,
  castFrame: 15,
  castAhead: 12,
  castHeight: 15,
  castTurn: 1536,
  castAligned: 0x100,
  enrageDeband: 0x1e,
  enrageShifta: 0x28,
  enrageDelay: 50, // 0x00925f90
  enrageBase: 0x14,
  dodgeSpeed: Math.fround(1.8),
  dodgeBase: 0x1800,
  dodgeStep: 0x1000,
  dodgeTurn: 0xf00,
  dodgeTries: 8,
  // ASSUMED: how the spell objects fly (enemyshots.ts TechBolt).
  boltSpeed: 4,
  boltRadius: 4,
  castRange: 100,
} as const;

const GIBBON_ANIM = {
  wait: loop(7, 1), // row 0
  walk: loop(8, 1), // row 1
  run: loop(6, 1), // rows 2, 3
  stand: once(7, 1), // row 4
  hoe: once(5, 1), // rows 5, 9
  charge: once(0, 1.2), // row 10
  back: once(1, 1), // row 12
  fire: once(4, 1), // row 13
  callA: once(7, 0.5), // row 14 -> 9
  jump: once(0, 1), // row 15 (ASSUMED step)
  dodge: once(6, 1), // row 16 (ASSUMED step, one stride)
  flinch: once(2, 1), // row 6
  dead: once(3, 1.3), // row 11
} as const;

export type GibbonState =
  | 'spawn'
  | 'jump'
  | 'spot'
  | 'wait'
  | 'alert'
  | 'roar'
  | 'call'
  | 'wander'
  | 'run'
  | 'zigzag'
  | 'stalk'
  | 'charge'
  | 'backstep'
  | 'cast'
  | 'enrage'
  | 'dodge';

// The two lists of the exe (g_GibbonEnemyTypeConfig: every Gibbon;
// g_GibbonEntityListHead: the Zols): the owner makes one and clears it with
// the floor.
export class GibbonGroups {
  private all: GibbonAi[] = [];

  add(g: GibbonAi): void {
    this.all.push(g);
  }

  leaderOf(group: number): GibbonAi | null {
    for (const g of this.all) if (g.isLeader && g.group === group) return g;
    return null;
  }

  each(group: number, fn: (g: GibbonAi) => void): void {
    for (const g of this.all) if (g.group === group) fn(g);
  }

  clear(): void {
    this.all.length = 0;
  }
}

export class GibbonAi extends BrainBase {
  state: GibbonState | 'dead' = 'spawn';
  confused = false;
  readonly isLeader: boolean;
  readonly group: number;
  // The group's Shifta / Deband on itself after its leader died.
  readonly buffs = { deband: false, shifta: false };
  // The enrage's Deband / Shifta on itself, for the owner to drain and apply
  // (render/combat.ts buffEnemy). ASSUMED: power = the stats row's level.
  readonly casts: { tech: 'deband' | 'shifta'; level: number }[] = [];
  private readonly groups: GibbonGroups;
  private readonly search: number;
  private readonly spot: boolean;
  private readonly backChance: number;
  private readonly strideChance: number;
  private readonly castChance: number;
  private readonly level: number;
  private readonly ultimate: boolean;
  // The row's max_y_angle (battleparams_attacks, ENEMY_TYPE_PARAMS attack[0]); null
  // when the table has no row (then the directed Foie is never taken).
  private readonly maxYRow: EnemyAttackData | null;
  private readonly entityIndex: number;
  private readonly motionFrames: (motion: number) => number;
  private readonly spawnX: number;
  private readonly spawnZ: number;
  private homeX: number;
  private homeZ: number;
  private leader: GibbonAi | null = null;
  private sub = 0;
  private n = 0; // +0x520
  private m = 0; // +0x524
  private frames = 0; // elapsed frame counter of the motion
  private alertFlag = false; // +0x4b4 bit 0
  private resumeState: GibbonState = 'wander';
  private enrageIn = 0; // GibblesUpdate's countdown (+0x4b8)
  private effect = 0;
  private aimX = 0; // +0x3a8 / +0x3b0
  private aimZ = 0;
  private aimDist = 0; // +0x3b4
  private curSpeed = 0; // +0x4a0
  private wantSpeed = 0; // +0x49c
  private stride = 0; // +0x4a4
  private stopDist = 0; // +0x538
  private pointX = 0; // +0x39c / +0x3a4 (the walk target)
  private pointZ = 0;
  private vecX = 0; // +0x554 / +0x55c (zigzag, committed copy in +0x548)
  private vecZ = 0;
  private cvecX = 0;
  private cvecZ = 0;
  private goal = 0; // +0x530 (radians)
  private goalHeld = 0; // +0x534
  private toggle = false;
  private side = 1; // +0xd0
  private centerX = 0; // +0xe8
  private centerZ = 0;
  private haveCenter = false;
  private exposed = true; // the back step's +0x174 is off
  private dealt = false; // +0x56c
  private moveAngle = 0;
  private backX = 0;
  private backZ = 0;
  private prevX = 0;
  private prevZ = 0;

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    subtype: number;
    params: readonly number[];
    ultimate?: boolean;
    level?: number;
    attack?: EnemyAttackData | null;
    entityIndex?: number;
    groups?: GibbonGroups;
    motionFrames?: (motion: number) => number;
    rng?: () => number;
  }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    const p = (i: number) => opts.params[i] ?? 0;
    this.isLeader = opts.subtype >= 1;
    this.group = Math.round(p(0));
    this.spot = p(1) < GIBBON.spotThreshold;
    this.backChance = Math.fround(GIBBON.backChanceBase + p(2));
    this.strideChance = Math.fround(p(3) + GIBBON.spellChanceBase);
    this.castChance = Math.fround(p(4) + GIBBON.spellChanceBase);
    this.search = this.isLeader ? GIBBON.searchZol : GIBBON.searchUl;
    this.ultimate = opts.ultimate ?? false;
    this.maxYRow = opts.attack ?? null;
    this.level = Math.max(0, Math.min(this.ultimate ? 29 : 14, Math.trunc(opts.level ?? 0)));
    this.entityIndex = opts.entityIndex ?? 0;
    this.motionFrames = opts.motionFrames ?? (() => 30);
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.homeX = opts.x;
    this.homeZ = opts.z;
    this.groups = opts.groups ?? new GibbonGroups();
    this.groups.add(this);
    this.prevX = opts.x;
    this.prevZ = opts.z;
    this.current = GIBBON_ANIM.wait;
  }

  get flinchMotion(): EnemyAiMotion {
    return GIBBON_ANIM.flinch;
  }

  get deathMotion(): EnemyAiMotion {
    return GIBBON_ANIM.dead;
  }

  // vtable +0x184 (0x00520504: invulnerable, hit boxes off, entity flags
  // 0x4040000 = off the radar and the lock-on) is called by the entries of
  // states 0, 1, 2, 5, 6 and 7; +0x188 (0x00520528) clears it in 3, 8, 0xc,
  // 0xe, 0xf, 0x10 (and 9, 10, 0xb, 0x11, 0x13, 0x14 through vtable[1]
  // field16_0x40, the same slot).
  get untargetable(): boolean {
    switch (this.state) {
      case 'spawn':
      case 'jump':
      case 'spot':
      case 'alert':
      case 'roar':
      case 'call':
        return true;
      default:
        return false;
    }
  }

  // The back step also calls +0x174 (invulnerable flag + hit box flag) until
  // its stomp at motion frame 33 (+0x178 clears it).
  get invulnerable(): boolean {
    return this.untargetable || (this.state === 'backstep' && !this.exposed);
  }

  get collisionRadius(): number {
    return GIBBON.radius[this.isLeader ? 1 : 0];
  }

  private setAnim(out: AiFrame, m: EnemyAiMotion): void {
    this.frames = 0;
    this.play(out, m);
  }

  private advance(): void {
    const m = this.current;
    if (!m) return;
    this.frames += m.speed;
    if (m.loop) {
      const len = this.motionFrames(m.index);
      if (len > 0 && this.frames >= len) this.frames -= len;
    }
  }

  private crossed(f: number): boolean {
    return crossedAt(this.frames, this.current?.speed ?? 0, f);
  }

  // The end of a looping motion's cycle (njm frame count - 1.0001).
  private cycleEnd(): boolean {
    const m = this.current;
    return !!m && crossedAt(this.frames, m.speed, this.motionFrames(m.index) - 1.0001);
  }

  // FindEnemyTarget_00520ea0: the nearest live target in the radius or none.
  private find(targets: readonly AiTarget[]): AiTarget | null {
    let best: AiTarget | null = null;
    for (let pass = this.confused ? 0 : 1; pass < 2 && !best; pass++) {
      let bestSq = this.search * this.search;
      for (const t of targets) {
        if (t.dead || (pass === 0) !== t.clientId >= 0x1000) continue;
        const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
        if (d >= bestSq) continue;
        best = t;
        bestSq = d;
      }
    }
    this.targetId = best ? best.clientId : null;
    return best;
  }

  // SetEnemyTargetPosition + InitializeEnemyAnimationVelocity.
  private aim(px: number, pz: number): void {
    const dx = px - this.x;
    const dz = pz - this.z;
    const d = Math.hypot(dx, dz);
    this.aimDist = d;
    if (d > 0) {
      this.aimX = dx / d;
      this.aimZ = dz / d;
    }
  }

  private turnHeading(to: number, bams: number): void {
    this.angle = turnToward(this.angle, to, bams * BAMS_TO_RAD);
  }

  // ProcessGalgryphonHitCheck_00521528: turn toward the aim vector, move
  // along the heading.
  private steer(bams: number, speed: number): void {
    this.turnHeading(Math.atan2(this.aimX, this.aimZ), bams);
    this.x += Math.sin(this.angle) * speed;
    this.z += Math.cos(this.angle) * speed;
  }

  private rotate(x: number, z: number, bams: number): void {
    const s = Math.sin(bams * BAMS_TO_RAD);
    const c = Math.cos(bams * BAMS_TO_RAD);
    this.vecX = x * c + z * s;
    this.vecZ = z * c - x * s;
    this.goal = Math.atan2(this.vecX, this.vecZ);
  }

  private enter(out: AiFrame, state: GibbonState): void {
    this.state = state;
    this.sub = 0;
    this.n = 0;
    this.exposed = true;
    switch (state) {
      case 'spawn':
        this.resumeState = 'wander';
        break;
      case 'jump':
        this.resumeState = 'wander';
        this.targetId = null;
        this.alertFlag = false;
        this.prevX = this.x;
        this.prevZ = this.z;
        this.x -= Math.sin(this.angle) * GIBBON.jumpBack;
        this.z -= Math.cos(this.angle) * GIBBON.jumpBack;
        this.curSpeed = GIBBON.jumpSpeed;
        this.warps++;
        this.setAnim(out, GIBBON_ANIM.jump);
        break;
      case 'spot':
        this.resumeState = 'wander';
        this.targetId = null;
        this.alertFlag = false;
        this.effect = 0;
        this.setAnim(out, GIBBON_ANIM.wait);
        break;
      case 'wait':
        this.resumeState = 'wander'; // a flinch resumes as 8 (the resume value 3 maps to 8)
        this.targetId = null;
        this.alertFlag = false;
        this.setAnim(out, GIBBON_ANIM.stand);
        break;
      case 'alert':
        this.resumeState = 'alert';
        this.n = Math.trunc(GIBBON.alertSpan * Math.fround(this.rng())) + GIBBON.alertBase;
        this.setAnim(out, GIBBON_ANIM.stand);
        break;
      case 'roar':
        this.resumeState = 'wander';
        this.setAnim(out, GIBBON_ANIM.hoe);
        break;
      case 'call':
        this.resumeState = 'wander';
        this.setAnim(out, GIBBON_ANIM.callA);
        break;
      case 'wander':
        this.resumeState = 'wander';
        this.pickWander(out, true);
        break;
      case 'run':
        this.resumeState = 'run';
        this.wantSpeed = GIBBON.runTarget;
        this.m = 0;
        this.setAnim(out, GIBBON_ANIM.run);
        break;
      case 'zigzag': {
        this.resumeState = 'zigzag';
        this.wantSpeed = GIBBON.zigzagTarget;
        this.m = 0;
        this.toggle = false;
        this.rotate(this.aimX, this.aimZ, GIBBON.zigzag);
        this.cvecX = this.vecX;
        this.cvecZ = this.vecZ;
        this.goalHeld = this.goal;
        this.setAnim(out, GIBBON_ANIM.run);
        break;
      }
      case 'stalk':
        this.resumeState = 'stalk';
        this.haveCenter = false;
        this.dealt = false;
        this.setAnim(out, { index: 8, speed: 1.05 * GIBBON.stalkSpeed, loop: true });
        break;
      case 'charge':
        this.resumeState = 'dodge';
        this.dealt = false;
        this.m = 0;
        this.setAnim(out, GIBBON_ANIM.charge);
        break;
      case 'backstep':
        this.resumeState = 'dodge';
        this.exposed = false;
        this.setAnim(out, GIBBON_ANIM.back);
        break;
      case 'cast':
        this.resumeState = 'dodge';
        this.setAnim(out, GIBBON_ANIM.wait);
        break;
      case 'enrage':
        this.resumeState = 'wander';
        this.setAnim(out, GIBBON_ANIM.hoe);
        break;
      case 'dodge':
        this.resumeState = 'dodge';
        this.m = 0;
        this.setAnim(out, GIBBON_ANIM.wait);
        break;
      default:
        exhaustive(state);
    }
  }

  // GibblesSetState3AI: a leader calls, a member roars.
  private spotted(out: AiFrame): void {
    this.enter(out, this.isLeader ? 'call' : 'roar');
  }

  // GibblesSetTechAIState: 9 or 10 on a 50% roll.
  private approach(out: AiFrame): void {
    this.enter(out, Math.fround(this.rng()) < GIBBON.techChance ? 'run' : 'zigzag');
  }

  // state 8's entry and its next-point picks (0x00567cb8 / 0x0056812c).
  private pickWander(out: AiFrame, entry: boolean): void {
    if (entry) {
      void this.rng(); // +0x528 = trunc(20 * random): never read again
      this.dealt = false; // +0x56c
      const a = this.rng() * 65536 * BAMS_TO_RAD;
      const r = this.rng() * GIBBON.wanderRadius;
      this.pointX = this.homeX + Math.sin(a) * r;
      this.pointZ = this.homeZ + Math.cos(a) * r;
    } else {
      // GibblesCalculateMovementTarget_0056812c: the home -> here vector
      // turned by 0x4000 + random * 32768 BAMS, scaled by 120 * (0.3..1).
      let dx = this.x - this.homeX;
      let dz = this.z - this.homeZ;
      const len = Math.hypot(dx, dz);
      if (len > 0) {
        dx /= len;
        dz /= len;
      }
      const a = (Math.trunc(32768 * this.rng()) + 0x4000) * BAMS_TO_RAD;
      const rx = dx * Math.cos(a) + dz * Math.sin(a);
      const rz = dz * Math.cos(a) - dx * Math.sin(a);
      const d = GIBBON.wanderRadius * (0.3 + 0.7 * this.rng());
      this.pointX = this.homeX + rx * d;
      this.pointZ = this.homeZ + rz * d;
    }
    this.wantSpeed = Math.fround(GIBBON.wanderSpeed * this.rng() + GIBBON.wanderSpeedMin);
    this.curSpeed = 0;
    this.stopDist = GIBBON.wanderStop + (0.5 * this.wantSpeed) / Math.sin(0x100 * BAMS_TO_RAD);
    this.aim(this.pointX, this.pointZ);
    this.sub = 0;
    this.n = 0;
    this.setAnim(out, { index: 8, speed: Math.fround(1.05 * this.wantSpeed), loop: true });
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.advance();
    // GibblesUpdate_005687bc: the enrage countdown.
    if (this.enrageIn > 0 && --this.enrageIn === 0) {
      this.enter(out, 'enrage');
      animationEnded = false; // the owner's flag belongs to the motion it replaced
    }
    let t = this.target(targets);
    switch (this.state) {
      case 'spawn':
        this.spawnFrame(out);
        break;
      case 'jump':
        if (this.frames > GIBBON.threshold) this.curSpeed = Math.fround(this.curSpeed * GIBBON.jumpDecay);
        if (!animationEnded) {
          this.x += Math.sin(this.angle) * this.curSpeed;
          this.z += Math.cos(this.angle) * this.curSpeed;
        } else this.appeared(out, targets);
        break;
      case 'spot':
        if (++this.effect >= GIBBON.emergeFrames) this.appeared(out, targets);
        break;
      case 'wait':
        t = this.find(targets);
        if (this.alertFlag) this.enter(out, 'alert');
        else if (t) {
          this.notifyLeader();
          this.spotted(out);
        }
        break;
      case 'alert':
        t = this.find(targets);
        this.n--;
        if (this.n < 1) this.spotted(out);
        break;
      case 'roar':
        this.n++;
        if (!t) this.find(targets);
        if (this.n > GIBBON.roarFrames) this.enter(out, 'wander');
        break;
      case 'call':
        this.callFrame(out, t, targets, animationEnded);
        break;
      case 'wander':
        this.wanderFrame(out, targets);
        break;
      case 'run':
        this.runFrame(out, t);
        break;
      case 'zigzag':
        this.zigzagFrame(out, t);
        break;
      case 'stalk':
        this.stalkFrame(out, t);
        break;
      case 'charge':
        this.chargeFrame(out, t, animationEnded);
        break;
      case 'backstep':
        this.backFrame(out, t, targets, animationEnded);
        break;
      case 'cast':
        this.castFrame(out, t, animationEnded);
        break;
      case 'enrage':
        this.enrageFrame(out, animationEnded);
        break;
      case 'dodge':
        this.dodgeFrame(out, targets, animationEnded);
        break;
      default:
        exhaustive(this.state);
    }
    this.prevX = this.x;
    this.prevZ = this.z;
    return this.finish(out);
  }

  // 0x005690f8.
  private spawnFrame(out: AiFrame): void {
    this.leader = this.groups.leaderOf(this.group);
    if (!this.isLeader && this.leader) {
      this.homeX = this.leader.spawnX;
      this.homeZ = this.leader.spawnZ;
    } else {
      this.homeX = this.spawnX;
      this.homeZ = this.spawnZ;
    }
    this.enter(out, this.spot ? 'spot' : 'jump');
  }

  // The end of states 1 / 2.
  private appeared(out: AiFrame, targets: readonly AiTarget[]): void {
    this.enter(out, this.find(targets) ? 'wander' : 'wait');
  }

  // GibblesSetTargetAcquiredFlag on the leader (0x00568420).
  private notifyLeader(): void {
    if (this.leader) this.leader.alertFlag = true;
  }

  // 0x00564ff0 case 7 (the leader's call).
  private callFrame(out: AiFrame, t: AiTarget | null, targets: readonly AiTarget[], animationEnded: boolean): void {
    this.n++;
    if (this.n === GIBBON.roarFrames) this.groups.each(this.group, (g) => (g.alertFlag = true));
    if (!t) this.find(targets);
    if (animationEnded) {
      if (this.current === GIBBON_ANIM.callA) this.setAnim(out, GIBBON_ANIM.hoe); // mode 2: row 14 -> row 9
      else this.enter(out, 'wander');
    }
  }

  // 0x00567cb8.
  private wanderFrame(out: AiFrame, targets: readonly AiTarget[]): void {
    const t = this.find(targets);
    let aggro = false;
    if (t) aggro = (t.x - this.x) ** 2 + (t.z - this.z) ** 2 < GIBBON.aggroSq;
    if (this.sub === 0) {
      this.aim(this.pointX, this.pointZ);
      this.curSpeed = lerpTo(this.curSpeed, this.wantSpeed, GIBBON.wanderAccel);
      this.n++;
      if (this.aimDist < this.stopDist || this.n > GIBBON.wanderSteps) {
        this.sub = 1;
        this.wantSpeed = 0;
      }
      this.steer(Math.trunc(this.curSpeed * 512), this.curSpeed);
    } else if (this.sub === 1) {
      this.aim(this.pointX, this.pointZ);
      this.curSpeed = lerpTo(this.curSpeed, this.wantSpeed, GIBBON.wanderBrake);
      if (this.curSpeed <= GIBBON.wanderHalt) {
        this.sub = 2;
        this.n = Math.round(GIBBON.waitMin + this.rng() * (GIBBON.waitMax - GIBBON.waitMin));
        this.setAnim(out, GIBBON_ANIM.wait);
      }
      this.steer(Math.trunc(this.curSpeed * 512), this.curSpeed);
    } else {
      if (--this.n < 1) this.pickWander(out, false);
    }
    if (aggro) this.approach(out);
  }

  // 0x00567a38.
  private runFrame(out: AiFrame, t: AiTarget | null): void {
    if (!t) {
      this.enter(out, 'wander');
      return;
    }
    this.aim(t.x, t.z);
    let s: number = this.curSpeed;
    if (this.crossed(GIBBON.burstFrame)) {
      s = GIBBON.burstA;
      this.curSpeed = s;
    }
    if (this.frames < GIBBON.burstLow || this.frames > GIBBON.burstFrame) {
      s = Math.fround(s * GIBBON.burstDecay);
      this.curSpeed = s;
      this.steer(Math.trunc(s * GIBBON.turnScale), s);
    } else this.steer(Math.trunc(s * GIBBON.turnScale), 1);
    this.strideRoll();
    // Transition: a spell, or the end of a cycle close to the target.
    if (this.m === 1) this.enter(out, 'cast');
    else if (this.cycleEnd() && this.aimDist < GIBBON.nearStalk) this.enter(out, 'stalk');
  }

  // +0x4a4 += speed; every 50 units one roll at +0x4ac.
  private strideRoll(): void {
    const v = this.stride + this.curSpeed;
    if (v >= GIBBON.stride) {
      this.stride = v - GIBBON.stride;
      if (Math.fround(this.rng()) < this.strideChance) this.m = 1;
    } else this.stride = v;
  }

  // 0x005676a0.
  private zigzagFrame(out: AiFrame, t: AiTarget | null): void {
    if (!t) {
      this.enter(out, 'wander');
      return;
    }
    if (this.crossed(GIBBON.burstLow)) {
      this.aim(t.x, t.z);
      if (!this.toggle) {
        this.toggle = true;
        this.rotate(this.aimX, this.aimZ, -GIBBON.zigzag);
      } else {
        this.toggle = false;
        this.rotate(this.aimX, this.aimZ, GIBBON.zigzag);
      }
    }
    if (this.cycleEnd()) {
      this.cvecX = this.vecX;
      this.cvecZ = this.vecZ;
      this.goalHeld = this.goal;
    }
    this.turnHeading(this.goalHeld, 0x800);
    if (this.crossed(GIBBON.burstFrame)) this.curSpeed = GIBBON.burstB;
    if (this.frames < GIBBON.burstLow || this.frames > GIBBON.burstFrame) {
      this.curSpeed = Math.fround(this.curSpeed * GIBBON.burstDecay);
      this.x += this.cvecX * this.curSpeed;
      this.z += this.cvecZ * this.curSpeed;
    } else {
      this.x += this.cvecX;
      this.z += this.cvecZ;
    }
    this.strideRoll();
    this.aim(t.x, t.z);
    if (this.m === 1) this.enter(out, 'cast');
    else if (this.cycleEnd() && this.aimDist < GIBBON.nearStalk) this.enter(out, 'stalk');
  }

  // 0x00566fbc.
  private stalkFrame(out: AiFrame, t: AiTarget | null): void {
    if (!t) {
      this.enter(out, 'wander');
      return;
    }
    if (!this.haveCenter) {
      this.haveCenter = true;
      this.centerX = t.x;
      this.centerZ = t.z;
      // CheckVectorCrossProduct(heading, to target): 0 when z*x' - x*z' >= 0.
      const hx = Math.sin(this.angle);
      const hz = Math.cos(this.angle);
      this.side = hz * (t.x - this.x) - hx * (t.z - this.z) >= 0 ? 1 : -1;
    }
    this.n++;
    this.wantSpeed = GIBBON.stalkSpeed;
    this.curSpeed = lerpTo(this.curSpeed, this.wantSpeed, GIBBON.stalkLerp);
    let dx = this.x - this.centerX;
    let dz = this.z - this.centerZ;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx /= len;
      dz /= len;
    }
    let mx = dz;
    let mz = dx;
    if (this.side < 0) mx = -mx;
    else mz = -mz;
    this.x += mx * this.curSpeed;
    this.z += mz * this.curSpeed;
    // The heading follows the movement (0x200 BAMS a frame).
    const mdx = this.x - this.prevX;
    const mdz = this.z - this.prevZ;
    if (mdx !== 0 || mdz !== 0) this.turnHeading(Math.atan2(mdx, mdz), GIBBON.stalkTurn);
    // Transition.
    if (this.n < GIBBON.stalkMax) {
      if (this.n > GIBBON.stalkMin) {
        const d2 = (this.x - t.x) ** 2 + (this.z - t.z) ** 2;
        if (d2 >= GIBBON.stalkFarSq) {
          this.approach(out);
          return;
        }
        if (d2 < GIBBON.stalkNearSq) {
          this.attack(out);
          return;
        }
        const th = t.angle ?? 0;
        if (Math.sin(th) * dx + Math.cos(th) * dz < Math.cos(GIBBON.stalkBehind * BAMS_TO_RAD)) this.attack(out);
      }
    } else {
      this.n = 0;
      if (Math.fround(this.rng()) < GIBBON.techChance) this.attack(out);
    }
  }

  // random < +0x4a8: the back step, else the charge.
  private attack(out: AiFrame): void {
    this.enter(out, Math.fround(this.rng()) < this.backChance ? 'backstep' : 'charge');
  }

  // 0x00566b9c.
  private chargeFrame(out: AiFrame, t: AiTarget | null, animationEnded: boolean): void {
    if (this.sub === 0 && this.n === 0) {
      // The entry (GibblesCalculateTargetAngle_00566e88): a point 7 to the
      // side of the target (the sign by the entity index parity) and 2
      // beyond it; speed min(distance, 40) / 14.667.
      this.n = 1;
      if (t) {
        this.aim(t.x, t.z);
        const side = this.entityIndex & 1 ? GIBBON.chargeSide : -GIBBON.chargeSide;
        const px = t.x + this.aimX * 2 + side * this.aimZ;
        const pz = t.z + this.aimZ * 2 - side * this.aimX;
        this.aim(px, pz);
        this.moveAngle = Math.atan2(this.aimX, this.aimZ);
      } else {
        this.aimX = Math.sin(this.angle);
        this.aimZ = Math.cos(this.angle);
        this.aimDist = 30;
        this.moveAngle = this.angle;
      }
      const s = Math.fround(Math.min(this.aimDist, GIBBON.chargeMax) / GIBBON.chargeNorm);
      this.wantSpeed = s;
      this.curSpeed = s;
    }
    if (this.sub === 0) {
      if (animationEnded) this.sub = 1;
      if (this.crossed(GIBBON.chargeFrame)) {
        this.dealt = false;
        if (t && this.reaches(t)) {
          out.hit = { clientId: t.clientId, knockback: GIBBON.chargeKnock, mult: 1 };
          this.dealt = true;
          if (this.ultimate && Math.fround(this.rng()) <= GIBBON.chargeStatusChance) {
            // wolf_slow_entity (Ul) / wolf_paralyze_entity (Zol).
            out.status = { clientId: t.clientId, type: this.isLeader ? STATUS.paralysis : STATUS.slow };
          }
        }
      }
      this.curSpeed = lerpTo(this.curSpeed, this.wantSpeed, GIBBON.chargeLerp);
      this.turnHeading(this.moveAngle, GIBBON.chargeTurn);
      if (this.frames <= GIBBON.chargeMove) {
        this.x += this.aimX * this.curSpeed;
        this.z += this.aimZ * this.curSpeed;
      } else if (!this.dealt) {
        this.curSpeed = Math.fround(this.curSpeed * GIBBON.chargeSlide);
        this.x += this.aimX * this.curSpeed;
        this.z += this.aimZ * this.curSpeed;
      }
    }
    if (this.sub === 1) this.enter(out, 'dodge');
  }

  // should_push_defender: the target is inside the Gibbon's reach.
  private reaches(t: AiTarget): boolean {
    return this.dist(t) <= this.collisionRadius + PLAYER_RADIUS + GIBBON.reach;
  }

  // 0x005658c4.
  private backFrame(out: AiFrame, t: AiTarget | null, targets: readonly AiTarget[], animationEnded: boolean): void {
    if (this.sub === 0 && this.n === 0) {
      this.n = 1;
      // trunc(3 * rand) - 1, trunc(2 * rand) - 1 (raised to trunc(2 * rand)
      // when not above the first), and minus their sum.
      const a0 = Math.trunc(3 * Math.fround(this.rng())) - 1;
      const r2 = Math.fround(this.rng());
      let a1 = Math.trunc(r2 + r2) - 1;
      if (a1 <= a0) a1 = Math.trunc(r2 + r2);
      void a1; // only the first of the three tries can succeed without walls
      this.find(targets);
      const tt = this.target(targets);
      if (tt) {
        this.aim(tt.x, tt.z);
        const base = Math.atan2(this.aimX, this.aimZ);
        const away = base + Math.PI + a0 * GIBBON.backStep * BAMS_TO_RAD;
        this.backX = Math.sin(away);
        this.backZ = Math.cos(away);
        this.moveAngle = base + Math.trunc((a0 * GIBBON.backStep) / 2) * BAMS_TO_RAD;
      } else {
        this.backX = 0;
        this.backZ = 0;
        this.moveAngle = this.angle;
      }
      this.wantSpeed = Math.fround(GIBBON.backDistance / GIBBON.backFrames);
    }
    if (this.sub === 0) {
      if (animationEnded) this.sub = 1;
      if (this.crossed(GIBBON.backStomp)) {
        this.exposed = true;
        // The stomp: every player touching the body.
        if (t && this.dist(t) <= this.collisionRadius + PLAYER_RADIUS) out.hit = { clientId: t.clientId, knockback: 1, mult: 1 };
      }
      this.turnHeading(this.moveAngle, GIBBON.backTurn);
      if (this.frames <= GIBBON.backFrames) {
        this.x += this.backX * this.wantSpeed;
        this.z += this.backZ * this.wantSpeed;
      }
    }
    if (this.sub === 1) {
      this.exposed = true;
      this.enter(out, Math.fround(this.rng()) < this.castChance ? 'cast' : 'wander');
    }
  }

  // unknown_gibbon_behavior2.
  private castFrame(out: AiFrame, t: AiTarget | null, animationEnded: boolean): void {
    if (this.sub === 1) {
      if (animationEnded) this.sub = 2;
      if (this.crossed(GIBBON.castFrame)) this.fireSpell(out, t);
    } else if (!t) {
      this.enter(out, 'wander');
      return;
    } else {
      const to = this.angleTo(t);
      this.turnHeading(to, GIBBON.castTurn);
      const diff = Math.abs(wrap(to - this.angle)) / BAMS_TO_RAD;
      if (diff < GIBBON.castAligned) {
        this.sub = 1;
        this.setAnim(out, GIBBON_ANIM.fire);
      } else if (this.current !== GIBBON_ANIM.walk) this.setAnim(out, GIBBON_ANIM.walk);
    }
    if (this.sub === 2) this.enter(out, 'wander');
  }

  // The Foie's branch test: |heading - bearing to t| (BAMS) < max_y_angle / 2
  // (C int division, so truncated). No row: 0, never taken.
  private aimedAtTarget(t: AiTarget): boolean {
    const turn = Math.abs(wrap(this.angleTo(t) - this.angle)) / BAMS_TO_RAD;
    const half = Math.trunc((this.maxYRow?.angle ?? 0) / 2);
    return turn < half;
  }

  private fireSpell(out: AiFrame, t: AiTarget | null): void {
    const x = this.x + Math.sin(this.angle) * GIBBON.castAhead;
    const z = this.z + Math.cos(this.angle) * GIBBON.castAhead;
    let tech: number;
    // Leader, non-ultimate floor: field_0x10 == 1 calls unknown_create_sorc_tech (dump
    // 349660, the else of g_CurrentFloor == ultimate), which is Gibarta
    // (techfire.ts: 0x006e38e0, the heading form). It always flies along the heading.
    if (this.isLeader) tech = this.ultimate ? TECH.megid : TECH.gibarta;
    else tech = this.ultimate ? TECH.gizonde : TECH.foie;
    // Foie and Gibarta are the real objects (combat/techfire.ts). unknown_gibbon_
    // behavior2 (dump 349686, the non-ultimate else): with a target (+0x398) and
    // the turn to it below max_y_angle / 2, create_directed_foie_object takes the
    // target's +0x300 (its feet); else create_foie_object1 flies along the heading.
    // The angle is the post-turn difference of EnemyAI_UpdateRotation_00771858
    // (dump 746368: integer_angle_abs_difference); here the difference before the
    // fire-frame turn (ASSUMED: the exe's extra turn by the record's rate is not
    // ported). The Gibarta never takes the aim (the sorc tech has no target form here).
    if (tech === TECH.foie || tech === TECH.gibarta) {
      const aimed = tech === TECH.foie && t !== null && this.aimedAtTarget(t);
      const shot = enemyFire({
        tech,
        level: this.level,
        x,
        y: GIBBON.castHeight,
        z,
        heading: this.angle,
        aim: aimed && t ? { x: t.x, y: t.y ?? 0, z: t.z } : null,
        enemy: true,
      });
      if (shot) (out.shots ??= []).push(shot);
      return;
    }
    const power = techPower(tech, this.level);
    const effect: ShotEffect = tech === TECH.megid ? { kind: 'megid', power } : { kind: 'tech', power };
    const d = techData(tech, this.level);
    (out.shots ??= []).push(
      new TechBolt({
        x,
        y: GIBBON.castHeight,
        z,
        angle: this.angle,
        speed: GIBBON.boltSpeed,
        range: Math.max(GIBBON.castRange, d.rangeH) + 20,
        radius: GIBBON.boltRadius,
        effect,
        color: tech === TECH.megid ? 0x602080 : tech === TECH.gizonde ? 0xffff40 : tech === TECH.rafoie ? 0xff6020 : 0xff8040,
        tech: { id: tech, level: this.level },
      }),
    );
  }

  // 0x00566468.
  private enrageFrame(out: AiFrame, animationEnded: boolean): void {
    this.n++;
    if (this.n === GIBBON.enrageDeband && this.leader) {
      this.buffs.deband = true;
      this.casts.push({ tech: 'deband', level: this.level });
    } else if (this.n === GIBBON.enrageShifta && this.leader) {
      this.buffs.shifta = true;
      this.casts.push({ tech: 'shifta', level: this.level });
    }
    if (animationEnded) this.enter(out, 'wander');
  }

  // 0x0056661c.
  private dodgeFrame(out: AiFrame, targets: readonly AiTarget[], animationEnded: boolean): void {
    if (this.sub === 0) {
      // Sweep sideways: (count >> 1) * 0x1000 + 0x1800, alternating sign,
      // flipped by the entity index parity; the first open try wins (no
      // walls here).
      let a = (this.m >> 1) * GIBBON.dodgeStep + GIBBON.dodgeBase;
      if (this.m & 1) a = -a;
      if ((this.entityIndex & 1) === 0) a = -a;
      this.moveAngle = this.angle + a * BAMS_TO_RAD;
      this.m++;
      this.backX = Math.sin(this.moveAngle);
      this.backZ = Math.cos(this.moveAngle);
      if (this.m > GIBBON.dodgeTries) this.sub = 2;
      else {
        this.sub = 1;
        this.setAnim(out, GIBBON_ANIM.dodge);
      }
    } else if (this.sub === 1) {
      if (animationEnded) {
        this.find(targets);
        this.sub = 2;
      }
      this.x += this.backX * GIBBON.dodgeSpeed;
      this.z += this.backZ * GIBBON.dodgeSpeed;
      this.turnHeading(this.moveAngle, GIBBON.dodgeTurn);
    }
    if (this.sub === 2) this.enter(out, this.target(targets) ? 'stalk' : 'wander');
  }

  override onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
  }

  // The flinch ended (0x0056627c, state 0x10): the resume state, a charge
  // resumes as the dodge and a wait as the wander (stored in resumeState).
  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    this.enter(out, this.resumeState);
    return this.state;
  }

  // State 0x11: a leader's death starts the group's enrage countdowns.
  override kill(): void {
    if (this.state === 'dead') return;
    if (this.isLeader) {
      this.groups.each(this.group, (g) => {
        if (g !== this && g.state !== 'dead') g.enrageIn = Math.trunc(GIBBON.enrageDelay * Math.fround(this.rng())) + GIBBON.enrageBase;
      });
    }
    super.kill();
  }
}

function lerpTo(cur: number, goal: number, step: number): number {
  if (cur === goal) return cur;
  if (cur > goal) return cur - step < goal ? goal : Math.fround(cur - step);
  return goal < cur + step ? goal : Math.fround(cur + step);
}

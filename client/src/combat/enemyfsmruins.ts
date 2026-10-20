// Per-family enemy state machines of the Ruins (PsoBB.exe, Ephinea 1.25.13,
// addresses are VAs): Bulclaw / Bulk / Claw, Dark Belra, Dark Gunner (and its
// control object, the Death Gunner), Chaos Bringer, Chaos Sorcerer,
// Delsaber, and the Dimenian's own record. Same EnemyBrain shape as
// combat/enemyfsm.ts (render/combat.ts drives them the same way); their
// projectiles are combat/enemyshots.ts.
//
// MovementData (`mv`) is the enemy's BattleParamEntry MovementData row:
// fparam1..6 = mv.f1..f6, iparam1..6 = mv.i1..i6.
//
// Most of these AIs are dispatchers on a state field whose handlers take a
// phase: 4 = enter, 0 = the frame, 3 = the transition check (skipped on the
// frame the state changed), 5 = leave (SetEnemyAiState_0051f62c / the tick
// 0x0051f5bc). "Stagger(n)" is vtable +0x44 (0x007713a4): true when
// frame % n == entity index % n.

import { BAMS_TO_RAD, type AiFrame, type AiTarget, type EnemyAiMotion } from './enemyai.ts';
import type { EnemyAttackData, EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase, loop, nearest, once, turnToward, wrap } from './enemyfsm.ts';
import { BelraArm, EnemyShot, GunnerLaser, TechBolt } from './enemyshots.ts';
import { STATUS } from './status.ts';
import { TECH, techData, techPower } from './techniques.ts';
import { exhaustive } from '../exhaustive.ts';

const EMPTY_MV: EnemyMovementData = { fparam1: 0, fparam2: 0, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [0, 0, 0, 0, 0, 0] };
const BAMS = (b: number) => b * BAMS_TO_RAD;

// The melee reach test of these families (should_push_defender / vtable +0x50
// = 0x00772e60 with hit boxes): XZ distance < hit box radius + AttackData
// max_x_distance and |angle| < max_y_angle.
function reachOf(attack: EnemyAttackData | null, radius: number): { reach: number; arc: number } {
  return { reach: (attack?.distanceX ?? 0) + radius, arc: BAMS((attack?.angle ?? 0x2000) & 0xffff) };
}

// The farthest live player within `range` (the Chaos Bringer's laser and the
// Chaos Sorcerer's heal pick the farthest one).
function farthest(targets: readonly AiTarget[], x: number, z: number, range: number): AiTarget | null {
  let best: AiTarget | null = null;
  let bestSq = -1;
  for (const t of targets) {
    if (t.dead) continue;
    const d = (t.x - x) ** 2 + (t.z - z) ** 2;
    if (d >= range * range || d <= bestSq) continue;
    best = t;
    bestSq = d;
  }
  return best;
}

// --- Bulclaw / Bulk / Claw -------------------------------------------------------
//
// One body object (TObjEneBalClawBody, map entity 0xa7, factory
// bulclaw_constructor 0x00533f90, vtable 0x00b01b40, table 0x009bc680) has two
// forms, switched by BulclawHandleClawAction_00532960(form): 1 = Bulclaw
// (merged, 0x390 |= 0x1000000, rt 0x28, animation 0) and 0 = Bulk (the core
// left after the split, rt 0x27, animation 5). It spawns as a Bulclaw.
// Movement entry 0x009bc744 + form * 0x1c: {150, speed, turn 1024, ...}; the
// speed is written at run time (0x00534208) = 0x3f0e38e3 (0.5556); the attack
// approach is a fixed 0.7 (0x3f333333). The update (0x00531d9c) counts +0x3dc
// every frame outside states 0 and 8; the transition check is 0x00533b80, the
// states 0x00531ee4. Targets: EnemyUpdateTarget_0052ccd8(250) on Stagger(30).
//   Bulclaw:
//     idle (0, 0x00533b14): animation 0, super armor (0x40000) while idle; a
//       target -> chase with band 2.
//     chase (1, 0x00533a00): animation 1, toward the target at 0.5556,
//       turning 1024; bands on d^2: 0 -> 1 past 60 (0x009229d4 = 3600),
//       1 -> 0 inside 40 (0x009229dc = 1600) = the claw attack, 1 -> 2 past
//       120 (14400), 2 -> 1 inside 100 (10000); no target -> home (8).
//     attack (9, 0x00532d44): approach at 0.7 until inside AttackData
//       max_x_distance, then animation 2 (motion 6, 0.5) still sliding at 0.7;
//       frame 10: on a hit a 0.1 roll (0x00922a28) for entity_hit_by_tech
//       group 15 (poison), try_hit_entity(1.0) + cause_knockback(3.0); every
//       frame-10 swing counts (+0x3e2), hit or miss; then back to idle.
//     split (11, 0x0053235c): in idle / chase when +0x3dc > 1800 (60 s) or
//       more than one swing: +0x3dc = 0, ClawAction(0), a 30-frame hold.
//   Bulk:
//     flee (12, 0x0053215c): animation 6 (motion 5, 0.8) toward a point 90
//       away from the player (EnemyAI_CalculateGroundPosition_0052c274 picks
//       the clearest of 3 headings 120 degrees apart), re-picked on
//       Stagger(90), at 0.5556; no target -> idle.
//     merge (10, 0x005323ec): from idle on Stagger(30) without a target, or
//       from flee after 1800 frames: up to 4 live Claws of the section (any
//       rt 0x26, standalone ones too) are called (EnemyProcessState10
//       _00534394); 600 frames to arrive within 15 (0x00922a50 = 225);
//       absorbed (EnemySetLockOnFlags_00535740: hidden, untargetable), their
//       HP added to the body's (no clamp); animation 11 (motion 1, 0.6), then
//       ClawAction(1): a Bulclaw again; 30 frames, idle.
//     self-destruct (2, 0x005334d0): when a flinch ends with HP <= iparam1 %
//       of max (10 when iparam1 < 1): it chases its last attacker at 0.7 and,
//       inside max_x_distance, animation 7 (motion 0, 0.6); frame 10:
//       try_hit_entity(1.0) + cause_knockback(3.0); when the row ends it dies.
//   ClawAction(0), the split: the first time the body's HP becomes
//   max(1, hp / 5) and 4 Claws are created in its 4 child slots
//   (BulclawCreateClawEntity_00535554, ctor 0x00535630: their own Claw
//   battleparams, state 11 = appear) on a ring of 13 at 45 + 90 i degrees
//   from the heading, facing outwards; later splits put the absorbed Claws
//   back on the ring (BulclawUpdateClawTransform_00534324) and share the HP:
//   body and each Claw get hp / (alive + 1).
//   flinch (4, 0x005332e0): animation 3 (motion 7, 0.6) / 8 (motion 2, 0.7).
//   death (5): Bulclaw animation 4 (motion 8, 0.5), the absorbed Claws die
//   with it; Bulk animation 9 (motion 3, 0.6).
export const BULCLAW = {
  search: 250,
  stagger: 30,
  speed: Math.fround(0.5555555820465088),
  approach: Math.fround(0.7),
  turn: 1024,
  bandOut: 60,
  bandAttack: 40,
  bandFar: 120,
  bandBack: 100,
  hitFrame: 10,
  poisonChance: Math.fround(0.1),
  knockback: 3,
  splitAfter: 1800,
  splitSwings: 1,
  splitHold: 30,
  ringRadius: 13,
  claws: 4,
  fleeDistance: 90,
  fleeRepick: 90,
  mergeTime: 600,
  mergeRadius: 15,
  mergeHold: 30,
  destructPercent: 10,
  home: 10,
} as const;

const BULCLAW_MOTION = {
  idle: loop(9, 0.8),
  walk: loop(9, 0.8),
  attack: once(6, 0.5),
  flinch: once(7, 0.6),
  death: once(8, 0.5),
  bulkIdle: loop(5, 0.8),
  bulkWalk: loop(5, 0.8),
  destruct: once(0, 0.6),
  bulkFlinch: once(2, 0.7),
  bulkDeath: once(3, 0.6),
  merge: once(1, 0.6),
};

export type BulclawState = 'idle' | 'chase' | 'attack' | 'split' | 'flee' | 'merge' | 'destruct' | 'home' | 'blown' | 'dead';

// What the owner does for the body (render/combat.ts): spawn / redeploy the
// Claws and share the HP, add the absorbed Claws' HP, the self-destruct.
export type BulclawEvent = { kind: 'split'; first: boolean } | { kind: 'absorb'; claws: ClawAi[] } | { kind: 'blown' };

export class BulclawAi extends BrainBase {
  state: BulclawState = 'idle';
  bulk = false;
  hpFraction = 1; // the owner keeps it current
  events: BulclawEvent[] = [];
  // The Claws this body knows (its ring after a split, the absorbed ones).
  claws: ClawAi[] = [];
  // Live Claws of the section the owner offers for a merge.
  candidates: ClawAi[] = [];
  private spawned = false;
  private mv: EnemyMovementData;
  private reach: number;
  private phase: number;
  private spawnX: number;
  private spawnZ: number;
  private timer = 0;
  private frames = 0;
  private busy = 0;
  private swings = 0;
  private band = 2;
  private sub = 0;
  private hold = 0;
  private armed = false;
  private fleeX = 0;
  private fleeZ = 0;
  private lastAttacker: number | null = null;
  private dealt = false;

  constructor(opts: { x: number; z: number; angle: number; movement: EnemyMovementData | null; attack: EnemyAttackData | null; radius: number; phase?: number; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.mv = opts.movement ?? EMPTY_MV;
    this.reach = (opts.attack?.distanceX ?? 0) + opts.radius;
    this.phase = opts.phase ?? 0;
    this.current = BULCLAW_MOTION.idle;
  }

  get rtIndex(): number {
    return this.bulk ? 0x27 : 0x28;
  }

  // Idle is super armor (0x40000); the merge is busy (0x390 & 1).
  get superArmor(): boolean {
    return this.state === 'idle' || this.state === 'merge' || this.state === 'split';
  }

  get flinchMotion(): EnemyAiMotion {
    return this.bulk ? BULCLAW_MOTION.bulkFlinch : BULCLAW_MOTION.flinch;
  }

  get deathMotion(): EnemyAiMotion {
    return this.bulk ? BULCLAW_MOTION.bulkDeath : BULCLAW_MOTION.death;
  }

  private stagger(n: number): boolean {
    return this.timer % n === this.phase % n;
  }

  // The ring slot i (BulclawCreateClawEntity_00535554): 13 along 45 + 90 i
  // degrees from the heading; the Claw faces that way.
  ringSlot(i: number): { x: number; z: number; angle: number } {
    const a = wrap(this.angle + BAMS(0x2000 + i * 0x4000));
    return { x: this.x + Math.sin(a) * BULCLAW.ringRadius, z: this.z + Math.cos(a) * BULCLAW.ringRadius, angle: a };
  }

  private enter(out: AiFrame, state: BulclawState): void {
    if (this.state === 'merge' && state !== 'merge') this.releaseClaws();
    this.state = state;
    this.frames = 0;
    this.sub = 0;
    this.dealt = false;
    if (state === 'idle') this.play(out, this.bulk ? BULCLAW_MOTION.bulkIdle : BULCLAW_MOTION.idle);
    else if (state === 'chase' || state === 'home') this.play(out, this.bulk ? BULCLAW_MOTION.bulkWalk : BULCLAW_MOTION.walk);
    else if (state === 'attack') this.play(out, BULCLAW_MOTION.walk);
    else if (state === 'flee' || state === 'destruct') {
      this.play(out, BULCLAW_MOTION.bulkWalk);
      this.fleeX = Number.NaN;
    } else if (state === 'split') {
      this.busy = 0;
      this.swings = 0;
      this.hold = BULCLAW.splitHold;
      this.bulk = true;
      this.events.push({ kind: 'split', first: !this.spawned });
      this.spawned = true;
      this.play(out, BULCLAW_MOTION.bulkIdle);
    } else if (state === 'merge') {
      this.busy = 0;
      const picked = this.candidates.filter((c) => c.state !== 'dead' && !c.absorbed).slice(0, BULCLAW.claws);
      if (!picked.length) {
        this.state = 'idle';
        this.play(out, BULCLAW_MOTION.bulkIdle);
        return;
      }
      this.claws = picked;
      for (const c of picked) c.callTo(this);
      this.hold = BULCLAW.mergeTime;
      this.play(out, BULCLAW_MOTION.bulkIdle);
    }
  }

  private releaseClaws(): void {
    if (this.sub >= 1 && !this.bulk) return;
    for (const c of this.claws) if (c.state === 'merge') c.release();
  }

  private moveToward(x: number, z: number, speed: number): void {
    this.angle = turnToward(this.angle, Math.atan2(x - this.x, z - this.z), BAMS(BULCLAW.turn));
    this.x += Math.sin(this.angle) * speed;
    this.z += Math.cos(this.angle) * speed;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead' || this.state === 'blown') return out;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    if (this.state !== 'idle' && this.state !== 'home') this.busy++;
    if (this.stagger(BULCLAW.stagger) && this.state !== 'destruct') {
      const t = nearest(targets, this.x, this.z, BULCLAW.search);
      this.targetId = t ? t.clientId : null;
    }
    let t = this.target(targets);
    // The transition check (0x00533b80).
    if (this.armed && this.bulk && this.state !== 'destruct' && this.state !== 'merge') this.enter(out, 'destruct');
    else if (!this.bulk) {
      if ((this.state === 'idle' || this.state === 'chase') && (this.busy > BULCLAW.splitAfter || this.swings > BULCLAW.splitSwings)) this.enter(out, 'split');
      else if ((this.state === 'idle' || this.state === 'home') && t) {
        this.band = 2;
        this.enter(out, 'chase');
      } else if (this.state === 'chase') {
        if (!t) this.enter(out, 'home');
        else {
          const d2 = this.dist(t) ** 2;
          if (this.band === 0 && d2 > BULCLAW.bandOut ** 2) this.band = 1;
          else if (this.band === 1 && d2 < BULCLAW.bandAttack ** 2) {
            this.band = 0;
            this.enter(out, 'attack');
          } else if (this.band === 1 && d2 > BULCLAW.bandFar ** 2) this.band = 2;
          else if (this.band === 2 && d2 < BULCLAW.bandBack ** 2) this.band = 1;
        }
      }
    } else {
      if (this.state === 'idle' && this.stagger(BULCLAW.stagger) && !t) this.enter(out, 'merge');
      else if (this.state === 'flee' && this.busy > BULCLAW.splitAfter) this.enter(out, 'merge');
      else if ((this.state === 'idle' || this.state === 'home') && t) this.enter(out, 'flee');
    }
    t = this.target(targets);
    switch (this.state) {
      case 'idle':
        break;
      case 'home': {
        if (Math.hypot(this.spawnX - this.x, this.spawnZ - this.z) < BULCLAW.home) this.enter(out, 'idle');
        else this.moveToward(this.spawnX, this.spawnZ, BULCLAW.speed);
        break;
      }
      case 'chase':
        if (t) this.moveToward(t.x, t.z, BULCLAW.speed);
        break;
      case 'attack': {
        if (this.sub === 0) {
          if (!t) {
            this.enter(out, 'idle');
            break;
          }
          this.moveToward(t.x, t.z, BULCLAW.approach);
          if (this.dist(t) <= this.reach) {
            this.sub = 1;
            this.frames = 0;
            this.play(out, BULCLAW_MOTION.attack);
          }
          break;
        }
        if (t) this.moveToward(t.x, t.z, BULCLAW.approach);
        if (!this.dealt && this.frames >= BULCLAW.hitFrame) {
          this.dealt = true;
          this.swings++;
          if (t && this.dist(t) <= this.reach) {
            if (Math.fround(this.rng()) <= BULCLAW.poisonChance) out.status = { clientId: t.clientId, type: STATUS.poison };
            out.hit = { clientId: t.clientId, knockback: BULCLAW.knockback, mult: 1 };
          }
        }
        if (animationEnded && this.dealt) this.enter(out, 'idle');
        break;
      }
      case 'split':
        if (--this.hold <= 0) this.enter(out, 'idle');
        break;
      case 'flee': {
        if (!t) {
          this.enter(out, 'idle');
          break;
        }
        if (Number.isNaN(this.fleeX) || this.stagger(BULCLAW.fleeRepick)) {
          // ASSUMED: straight away from the player (the three-heading wall
          // clearance pick needs the map collision).
          const a = Math.atan2(this.x - t.x, this.z - t.z);
          this.fleeX = this.x + Math.sin(a) * BULCLAW.fleeDistance;
          this.fleeZ = this.z + Math.cos(a) * BULCLAW.fleeDistance;
        }
        if (Math.hypot(this.fleeX - this.x, this.fleeZ - this.z) > BULCLAW.speed) this.moveToward(this.fleeX, this.fleeZ, BULCLAW.speed);
        break;
      }
      case 'merge': {
        if (this.sub === 0) {
          const live = this.claws.filter((c) => c.state === 'merge');
          if (--this.hold <= 0 || !live.length) {
            this.enter(out, 'idle');
            break;
          }
          if (live.every((c) => (c.x - this.x) ** 2 + (c.z - this.z) ** 2 <= BULCLAW.mergeRadius ** 2)) {
            for (const c of live) c.absorb();
            this.claws = live;
            this.events.push({ kind: 'absorb', claws: live });
            this.sub = 1;
            this.frames = 0;
            this.play(out, BULCLAW_MOTION.merge);
          }
        } else if (this.sub === 1) {
          if (animationEnded) {
            this.bulk = false;
            this.sub = 2;
            this.hold = BULCLAW.mergeHold;
            this.play(out, BULCLAW_MOTION.idle);
          }
        } else if (--this.hold <= 0) this.enter(out, 'idle');
        break;
      }
      case 'destruct': {
        const tt = this.lastAttacker !== null ? (targets.find((p) => p.clientId === this.lastAttacker && !p.dead) ?? null) : null;
        if (this.sub === 0) {
          if (!tt) {
            this.armed = false;
            this.enter(out, 'home');
            break;
          }
          this.moveToward(tt.x, tt.z, BULCLAW.approach);
          if (this.dist(tt) <= this.reach) {
            this.sub = 1;
            this.frames = 0;
            this.play(out, BULCLAW_MOTION.destruct);
          }
          break;
        }
        if (tt) this.moveToward(tt.x, tt.z, BULCLAW.approach);
        if (!this.dealt && this.frames >= BULCLAW.hitFrame) {
          this.dealt = true;
          if (tt && this.dist(tt) <= this.reach) out.hit = { clientId: tt.clientId, knockback: BULCLAW.knockback, mult: 1 };
        }
        if (animationEnded && this.dealt) {
          this.state = 'blown';
          this.events.push({ kind: 'blown' });
        }
        break;
      }
      default:
        exhaustive(this.state);
    }
    return this.finish(out);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead' || this.state === 'blown') return;
    this.lastAttacker = clientId;
    if (this.superArmor) return;
    this.current = null;
  }

  // The flinch ended (state 4's end): the Bulk's self-destruct check.
  resume(): string {
    if (this.state === 'dead' || this.state === 'blown') return this.state;
    const out = this.frame();
    const pct = this.mv.iparam[0] >= 1 ? this.mv.iparam[0] : BULCLAW.destructPercent;
    if (this.bulk && this.hpFraction <= pct / 100) {
      this.armed = true;
      this.enter(out, 'destruct');
    } else this.enter(out, 'idle');
    return this.state;
  }
}

// Claw (TObjEneBalClawClaw, rt 0x26; standalone 0xa8: CreateDragonEntity
// _00535408 -> ctor 0x005354d4 -> 0x00535818; a Bulclaw's: 0x00535630),
// table 0x009bc7c0, movement 0x009bc834 (0.5556, turn 1024); update
// 0x005345dc, transitions 0x00534764, states 0x00534994:
//   idle (0, 0x005353b0): animation 0 (motion 15, 1.0), super armor; a target
//     on Stagger(30) -> approach with band 2.
//   approach (1, 0x00535280): toward the target at 0.5556; bands 0 -> 1 past
//     40 (0x00922b60), 1 -> 0 inside 20 (0x00922b68) = the bite, 1 -> 2 past
//     100, 2 -> 1 inside 80; no target -> home.
//   bite (2, 0x00535070): approaches at 0.7 until +0x3c8 <= max_x_distance^2
//     - +0x3c8 is only written by the merge state, so the bite starts at once
//     (a Claw whose merge was cancelled keeps the last body distance);
//     animation 2 (motion 10, 0.8); frame 8: cause_knockback(3.0) +
//     try_hit_entity(1.0); then back off (12, 0x005349f8): 120 frames moving
//     away from the target at 0.6 (Enemy_CorrectPath(-0.6), 0x00922b54),
//     then idle.
//   merge (10, 0x00534b74): moves to the body at 0.5556 (aborts when it is
//     gone); absorbed: copies the body's position, hidden and untargetable.
//   appear (11, 0x00534af4): busy and hidden until the effect ends.
//   flinch (4): animation 3 (motion 11, 0.7); death (5): animation 4
//   (motion 12, 0.5).
export const CLAW = {
  search: 250,
  stagger: 30,
  speed: Math.fround(0.5555555820465088),
  approach: Math.fround(0.7),
  turn: 1024,
  bandOut: 40,
  bandBite: 20,
  bandFar: 100,
  bandBack: 80,
  hitFrame: 8,
  knockback: 3,
  backOff: 120,
  backSpeed: Math.fround(0.6),
  home: 10,
  // ASSUMED: the appear effect's length (vtable +0x14 of the +0x398 object).
  appear: 30,
} as const;

const CLAW_MOTION = { idle: loop(15, 1), walk: loop(15, 1), bite: once(10, 0.8) };

export type ClawState = 'idle' | 'approach' | 'bite' | 'back' | 'home' | 'merge' | 'appear' | 'absorbed' | 'dead';

export class ClawAi extends BrainBase {
  state: ClawState = 'idle';
  body: BulclawAi | null = null;
  private reach: number;
  private phase: number;
  private spawnX: number;
  private spawnZ: number;
  private timer = 0;
  private frames = 0;
  private band = 2;
  private sub = 0;
  private hold = 0;
  private dealt = false;
  private bodyD2 = 0; // +0x3c8

  constructor(opts: { x: number; z: number; angle: number; attack: EnemyAttackData | null; radius: number; phase?: number; appear?: boolean; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.reach = (opts.attack?.distanceX ?? 0) + opts.radius;
    this.phase = opts.phase ?? 0;
    this.current = CLAW_MOTION.idle;
    if (opts.appear) {
      this.state = 'appear';
      this.hold = CLAW.appear;
    }
  }

  get absorbed(): boolean {
    return this.state === 'absorbed';
  }

  get hidden(): boolean {
    return this.state === 'absorbed' || this.state === 'appear';
  }

  get superArmor(): boolean {
    return this.state === 'idle' || this.state === 'appear';
  }

  get invulnerable(): boolean {
    return this.state === 'absorbed' || this.state === 'appear';
  }

  // EnemyProcessState10_00534394: the body calls it.
  callTo(body: BulclawAi): void {
    this.body = body;
    this.bodyD2 = 100000;
    this.state = 'merge';
    this.current = CLAW_MOTION.walk;
    this.pending = CLAW_MOTION.walk;
  }

  // 0x00534c38: the merge was cancelled.
  release(): void {
    if (this.state !== 'merge') return;
    this.state = 'idle';
    this.pending = CLAW_MOTION.idle;
  }

  absorb(): void {
    this.state = 'absorbed';
  }

  // BulclawUpdateClawTransform_00534324 + 0x0053436c: back on the ring.
  redeploy(x: number, z: number, angle: number): void {
    this.x = x;
    this.z = z;
    this.angle = angle;
    this.spawnX = x;
    this.spawnZ = z;
    this.state = 'appear';
    this.hold = CLAW.appear;
    this.pending = CLAW_MOTION.idle;
  }

  private pending: EnemyAiMotion | null = null;

  private stagger(n: number): boolean {
    return this.timer % n === this.phase % n;
  }

  private enter(out: AiFrame, state: ClawState): void {
    this.state = state;
    this.frames = 0;
    this.sub = 0;
    this.dealt = false;
    if (state === 'idle') this.play(out, CLAW_MOTION.idle);
    else if (state === 'approach' || state === 'home' || state === 'bite' || state === 'back') this.play(out, CLAW_MOTION.walk);
    if (state === 'back') this.hold = CLAW.backOff;
  }

  private moveToward(x: number, z: number, speed: number): void {
    this.angle = turnToward(this.angle, Math.atan2(x - this.x, z - this.z), BAMS(CLAW.turn));
    this.x += Math.sin(this.angle) * speed;
    this.z += Math.cos(this.angle) * speed;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.pending) {
      this.play(out, this.pending);
      this.pending = null;
    }
    if (this.state === 'dead') return out;
    if (this.state === 'absorbed') {
      if (this.body) {
        this.x = this.body.x;
        this.z = this.body.z;
      }
      out.hidden = true;
      return this.finish(out);
    }
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    if (this.state === 'appear') {
      out.hidden = this.hold > 0;
      if (--this.hold <= 0) {
        out.hidden = false;
        this.enter(out, 'idle');
      }
      return this.finish(out);
    }
    if (this.stagger(CLAW.stagger) && this.state !== 'merge') {
      const t = nearest(targets, this.x, this.z, CLAW.search);
      this.targetId = t ? t.clientId : null;
    }
    let t = this.target(targets);
    if ((this.state === 'idle' || this.state === 'home') && this.stagger(CLAW.stagger)) {
      if (t) {
        this.band = 2;
        this.enter(out, 'approach');
      } else if (this.state === 'idle' && (this.x - this.spawnX) ** 2 + (this.z - this.spawnZ) ** 2 > CLAW.home ** 2) this.enter(out, 'home');
    } else if (this.state === 'approach') {
      if (!t) this.enter(out, 'home');
      else {
        const d2 = this.dist(t) ** 2;
        if (this.band === 0 && d2 > CLAW.bandOut ** 2) this.band = 1;
        else if (this.band === 1 && d2 < CLAW.bandBite ** 2) {
          this.band = 0;
          this.enter(out, 'bite');
        } else if (this.band === 1 && d2 > CLAW.bandFar ** 2) this.band = 2;
        else if (this.band === 2 && d2 < CLAW.bandBack ** 2) this.band = 1;
      }
    }
    t = this.target(targets);
    switch (this.state) {
      case 'home':
        if (Math.hypot(this.spawnX - this.x, this.spawnZ - this.z) < CLAW.home) this.enter(out, 'idle');
        else this.moveToward(this.spawnX, this.spawnZ, CLAW.speed);
        break;
      case 'approach':
        if (t) this.moveToward(t.x, t.z, CLAW.speed);
        break;
      case 'bite':
        if (this.sub === 0) {
          if (t) this.moveToward(t.x, t.z, CLAW.approach);
          if (this.bodyD2 <= this.reach ** 2) {
            this.sub = 1;
            this.frames = 0;
            this.play(out, CLAW_MOTION.bite);
          }
          break;
        }
        if (t) this.moveToward(t.x, t.z, CLAW.approach);
        if (!this.dealt && this.frames >= CLAW.hitFrame) {
          this.dealt = true;
          if (t && this.dist(t) <= this.reach) out.hit = { clientId: t.clientId, knockback: CLAW.knockback, mult: 1 };
        }
        if (animationEnded && this.dealt) this.enter(out, 'back');
        break;
      case 'back': {
        if (t) {
          this.angle = turnToward(this.angle, this.angleTo(t), BAMS(CLAW.turn));
          this.x -= Math.sin(this.angle) * CLAW.backSpeed;
          this.z -= Math.cos(this.angle) * CLAW.backSpeed;
        }
        if (--this.hold <= 0) this.enter(out, 'idle');
        break;
      }
      case 'merge': {
        const b = this.body;
        if (!b || b.state === 'dead' || b.state === 'blown') {
          this.enter(out, 'idle');
          break;
        }
        this.bodyD2 = (b.x - this.x) ** 2 + (b.z - this.z) ** 2;
        if (this.bodyD2 > CLAW.speed ** 2) this.moveToward(b.x, b.z, CLAW.speed);
        break;
      }
    }
    return this.finish(out);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead' || this.invulnerable) return;
    this.targetId = clientId;
    if (this.superArmor) return;
    this.current = null;
  }

  resume(): string {
    if (this.state === 'dead' || this.state === 'absorbed') return this.state;
    const out = this.frame();
    this.enter(out, 'idle');
    return this.state;
  }
}

// --- Dark Belra --------------------------------------------------------------------
//
// Ctor 0x00536bfc (vtable 0x00b02280) -> 0x005394ec; table 0x009bcaa0; the
// state setter (vtable +0x164) 0x005372dc; AttackData entry 14 (the punch)
// and 19 (the arm). Fixed constants, no MovementData:
//   appear (1 0x00538d18 / 3 0x005389ec): invulnerable; waits for a target
//     within 400, then the fade-in (alpha +0x20 for 8 frames, the texture
//     scroll +0.5 to 12 = 24 frames) -> chase.
//   chase (4, 0x005382d8): animation 1 (motion 7, 0.8); every tick a target
//     within 400; sub 0 aims at it, sub 1 turns at most 0x100 a frame until
//     facing, sub 2 walks 0.28 a frame (0x00922ecc) along that fixed heading;
//     every 20 units (0x00922ec8) a count; with count >= 2, distance > 80
//     (0x00922ec4) and the next arm in place it scans for the farthest player
//     within 400 (0x00922f4c) inside +-0xaaa of the heading -> the throw,
//     else re-aim. Ultimate: it never walks, it scans every frame and keeps
//     turning. Check: confused -> 9, no target -> idle (8), distance <= 30
//     (0x00922ec0) -> punch (6), the turn accumulator past its threshold ->
//     the dizzy spin (7).
//   throw (5, 0x00537e64): no flinch; animation 3 (motion 3) / 4 (motion 5)
//     for arm 0 / 1, at 0.8 (Ultimate 2.0, written at enter); at frame 30 /
//     29 the arm (enemyshots.ts BelraArm) leaves from the hand (BELRA.handNode,
//     read off the model); the body holds
//     until the arm has finished and the +0x404 regrow effect is done, then
//     the next arm (+0x3fc ^= 1) and back to chase.
//   punch (6, 0x005379ec): sub 0 turns at most 0x100 a frame until facing,
//     then animation 2 (motion 0, 0.8); frame 16: try_hit_entity(1.0); a
//     hit that did damage rolls <= 1/3 (0x00922ef8; Ultimate 0.1,
//     0x00922ef4) for entity_hit_by_tech group 16 (paralysis), then
//     cause_knockback(5.0); after the motion animation 0 for 50 frames.
//     Check (sub 0): confused -> 9, no target -> 8, distance >= 30
//     (0x00922eec) -> chase, the accumulator -> 7.
//   dizzy spin (7, 0x00537844): no flinch; animation 5 (motion 4, 0.8) for
//     150 * level frames; the spin starts at 0x300 BAMS a frame and drops by
//     11 a frame (step min(speed, 0x100)); after it level++ and the next
//     threshold is level << 15. The accumulator (+0x4c4) adds +-0x100 per
//     full (clamped) turn step and restarts when the direction flips; it
//     fires at |acc| >= level * 0x8000 (180 degrees * level of circling).
//   idle (8, 0x005376c4): invulnerable; animation 0 (motion 6, 0.8); a target
//     within 400 -> chase; 61 frames without one -> vanish (2, 0x00538c4c:
//     back at the spawn point, level 1, arm 1) -> appear when a target comes.
//   confused (9, 0x005375f4): no flinch; animation 1; the heading turns
//     0x280 a frame until it is 0x3800 past where it started (23 frames),
//     then the throw.
//   flinch (10, 0x005374cc, hit handler 0x00538dcc): only a hit of at least
//     max HP / 5 (integer) and not in states 5 / 7 / 9; animation 6 (motion
//     1, 0.8); back to the state it left (+0x380).
//   death (11, 0x00537388): animation 7 (motion 2, 0.8).
export const BELRA = {
  search: 400,
  punchRange: 30,
  throwMin: 80,
  walk: Math.fround(0.28),
  segment: 20,
  segments: 2,
  cone: 0xaaa,
  turn: 0x100,
  punchFrame: 16,
  paralysisChance: Math.fround(1 / 3),
  ultParalysisChance: Math.fround(0.1),
  knockback: 5,
  punchRest: 50,
  dizzyPerLevel: 150,
  dizzySpin: 0x300,
  dizzyDrop: 11,
  dizzyThreshold: 0x8000,
  idleVanish: 61,
  confusedTurn: 0x280,
  confusedSpan: 0x3800,
  launchFrames: [30, 29],
  fadeIn: 24,
  // The regrow effect (+0x404, class vtable 0x00aff758): started at the launch
  // (value 0, vtable +0xc 0x00512348) and incremented once a frame in the
  // throw's sub 2 (+0x14 = 0x00512404: value += step, done at >= 2.0,
  // 0x0092057c). The step is 0.04 (0x3d23d70a, set by the base ctor
  // 0x0057946c) and 2.0 / 10 in Ultimate (vtable +4 = 0x00512314 with 10,
  // called by the ctor 0x00536bfc's tail), so Normal needs 51 frames and
  // Ultimate 10 (float32 sums, see regrowFrames).
  regrowStep: Math.fround(0.04),
  regrowStepUltimate: Math.fround(2 / 10),
  regrowDone: 2,
  // The hand: init_belra_global_config (0x00538e28.. tail) walks the model's
  // node tree at motion 3 frame 30 (arm 0, node 0x21) and motion 5 frame 29
  // (arm 1, node 0x38) and keeps that node's origin in model space, then adds
  // (0, 20, -4) (g_BelraModelYOffset 0x00922f40, g_BelraModelZOffset
  // 0x00922f44). The throw turns the x / z of that vector by the heading and
  // adds the body position (0x00537e64 .. 0x00539fbc). handNode is the node
  // origin read off bm_ene_re7_berura.bml's re7_b_bell_body.nj by the same
  // walk (tests/enemies.test.ts re-derives it).
  handNode: [
    [8.049997664296725, 22.434811215424023, 17.927436955131892],
    [-8.298640101165915, 22.917272547851574, 17.952492213441293],
  ],
  // Ultimate loads bm_ene_re7_berura_a.bml (is_ultimate_mode, the same
  // function), whose throw motions put the hands elsewhere.
  handNodeUltimate: [
    [8.102078358984716, 22.6365931189685, 17.472928130628873],
    [-8.34561525780432, 23.095375622361153, 17.487641473226123],
  ],
  handOffset: [0, 20, -4],
  // Body nodes the throw hides while the arm is out (flags 0x420 + arm * 4
  // bit 1, EnemyRender_00536d4c sets the hide bit 8 on the first and last
  // node of the arm's range 0x21..0x31 / 0x38..0x48, the only two with
  // polygons): the root of the arm's subtree here (render/combat.ts).
  armRootNode: [33, 56],
} as const;

const BELRA_MOTION = {
  idle: loop(6, 0.8),
  walk: loop(7, 0.8),
  punch: once(0, 0.8),
  dizzy: loop(4, 0.8),
};

export type BelraState = 'hidden' | 'appear' | 'chase' | 'throw' | 'punch' | 'dizzy' | 'idle' | 'confused' | 'dead';

export class BelraAi extends BrainBase {
  state: BelraState = 'hidden';
  confused = false;
  private ultimate: boolean;
  private reach: number;
  private spawnX: number;
  private spawnZ: number;
  private frames = 0;
  private timer = 0;
  private sub = 0;
  private walked = 0;
  private count = 0;
  private aim = 0;
  private level = 1;
  private acc = 0;
  private arm = 1;
  private armOut: BelraArm | null = null;
  // Arm i is off the body (thrown, not yet regrown): the body draws without its node.
  readonly armGone: [boolean, boolean] = [false, false];
  private regrow = 0;
  private dealt = false;
  private spin = 0;
  private spinDir = 1;
  private turnStart = 0;
  private resumeState: BelraState = 'chase';

  constructor(opts: { x: number; z: number; angle: number; ultimate: boolean; attack: EnemyAttackData | null; radius: number; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.ultimate = opts.ultimate;
    this.reach = reachOf(opts.attack, opts.radius).reach;
    this.current = BELRA_MOTION.idle;
  }

  get invulnerable(): boolean {
    return this.state === 'hidden' || this.state === 'appear' || this.state === 'idle';
  }

  get superArmor(): boolean {
    return this.state === 'throw' || this.state === 'dizzy' || this.state === 'confused';
  }

  flinches(damage: number, maxHp: number): boolean {
    return damage >= Math.trunc(maxHp / 5);
  }

  // Where arm `i` leaves from, relative to the body (x, y above its ground,
  // z): the hand node with (0, 20, -4) added, x / z turned by the heading
  // (BELRA.handNode). The body's yaw is Y rotation `angle`, as drawn.
  private hand(i: number): [number, number, number] {
    const n = (this.ultimate ? BELRA.handNodeUltimate : BELRA.handNode)[i];
    const o = BELRA.handOffset;
    const lx = n[0] + o[0];
    const lz = n[2] + o[2];
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return [lx * c + lz * s, n[1] + o[1], -lx * s + lz * c];
  }

  // Turns toward `want` by at most 0x100; full steps feed the accumulator.
  private turn(want: number): boolean {
    const diff = wrap(want - this.angle);
    const max = BAMS(BELRA.turn);
    if (Math.abs(diff) <= max) {
      this.angle = want;
      return true;
    }
    const dir = Math.sign(diff);
    this.angle = wrap(this.angle + dir * max);
    if (Math.sign(this.acc) !== dir) this.acc = 0;
    this.acc += dir * BELRA.turn;
    return false;
  }

  private enter(out: AiFrame, state: BelraState): void {
    const from = this.state;
    this.state = state;
    this.frames = 0;
    this.timer = 0;
    this.sub = 0;
    this.dealt = false;
    // Leaving the throw clears the arm flags (0x00537e64's exit, & ~7).
    if (from === 'throw') this.armGone.fill(false);
    if (state === 'chase' || state === 'punch') this.resumeState = state;
    if (state === 'idle') this.play(out, BELRA_MOTION.idle);
    else if (state === 'chase') {
      this.count = 0;
      this.walked = 0;
      this.play(out, BELRA_MOTION.walk);
    } else if (state === 'punch') this.play(out, BELRA_MOTION.walk);
    else if (state === 'throw') {
      const speed = this.ultimate ? 2 : 0.8;
      this.play(out, this.arm === 0 ? once(3, speed) : once(5, speed));
    } else if (state === 'dizzy') {
      this.spin = BELRA.dizzySpin;
      this.spinDir = this.acc < 0 ? -1 : 1;
      this.play(out, BELRA_MOTION.dizzy);
    } else if (state === 'confused') {
      this.turnStart = this.angle;
      this.play(out, loop(7, 1.6));
    } else if (state === 'hidden') {
      this.x = this.spawnX;
      this.z = this.spawnZ;
      this.level = 1;
      this.arm = 1;
      this.acc = 0;
    }
    if (from === 'dizzy') {
      this.level++;
      this.acc = 0;
    }
  }

  private dizzyDue(): boolean {
    return Math.abs(this.acc) >= this.level * BELRA.dizzyThreshold;
  }

  // The throw scan: the farthest player within 400 inside +-0xaaa.
  private scan(targets: readonly AiTarget[]): AiTarget | null {
    let best: AiTarget | null = null;
    let bestD = -1;
    for (const t of targets) {
      if (t.dead) continue;
      const d = this.dist(t);
      if (d >= BELRA.search || d <= bestD) continue;
      if (Math.cos(wrap(this.angleTo(t) - this.angle)) <= Math.cos(BAMS(BELRA.cone))) continue;
      best = t;
      bestD = d;
    }
    return best;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    switch (this.state) {
      case 'hidden': {
        out.hidden = true;
        const t = nearest(targets, this.x, this.z, BELRA.search);
        if (t) {
          this.targetId = t.clientId;
          out.hidden = false;
          this.enter(out, 'appear');
        }
        break;
      }
      case 'appear':
        if (this.timer >= BELRA.fadeIn) this.enter(out, 'chase');
        break;
      case 'idle': {
        if (this.confused) {
          this.enter(out, 'confused');
          break;
        }
        const t = nearest(targets, this.x, this.z, BELRA.search);
        if (t) {
          this.targetId = t.clientId;
          this.enter(out, 'chase');
        } else if (this.timer >= BELRA.idleVanish) {
          out.hidden = true;
          this.enter(out, 'hidden');
        }
        break;
      }
      case 'chase': {
        const n = nearest(targets, this.x, this.z, BELRA.search);
        if (n && this.sub !== 3) this.targetId = n.clientId;
        const t = this.target(targets);
        // The check (phase 3).
        if (this.confused) {
          this.enter(out, 'confused');
          break;
        }
        if (!t) {
          this.enter(out, 'idle');
          break;
        }
        if (this.dist(t) <= BELRA.punchRange) {
          this.enter(out, 'punch');
          break;
        }
        if (this.sub === 3) {
          this.enter(out, 'throw');
          break;
        }
        if (this.dizzyDue()) {
          this.enter(out, 'dizzy');
          break;
        }
        if (this.sub === 0) {
          this.aim = this.angleTo(t);
          this.sub = 1;
        }
        if (this.sub === 1) {
          if (this.turn(this.aim)) this.sub = 2;
          if (!this.ultimate) break;
        }
        if (this.ultimate) {
          const s = this.scan(targets);
          if (s && !this.armOut) {
            this.targetId = s.clientId;
            this.sub = 3;
          } else this.turn(this.angleTo(t));
          break;
        }
        this.x += Math.sin(this.angle) * BELRA.walk;
        this.z += Math.cos(this.angle) * BELRA.walk;
        this.walked += BELRA.walk;
        if (this.walked >= BELRA.segment) {
          this.walked = 0;
          this.count++;
          const s = this.count >= BELRA.segments && this.dist(t) > BELRA.throwMin && !this.armOut ? this.scan(targets) : null;
          if (s) {
            this.targetId = s.clientId;
            this.count = 0;
            this.sub = 3;
          } else this.sub = 0;
        }
        break;
      }
      case 'throw': {
        if (this.sub === 0 && this.frames >= BELRA.launchFrames[this.arm]) {
          const hand = this.hand(this.arm);
          const arm = new BelraArm(this.x + hand[0], hand[1], this.z + hand[2], this.angle, this.ultimate, this.arm);
          this.armOut = arm;
          this.armGone[this.arm] = true;
          this.regrow = 0;
          (out.shots ??= []).push(arm as EnemyShot);
          this.sub = 1;
        } else if (this.sub === 1 && this.armOut?.done) {
          // The arm's flight ended: its flag bit 2 clears, the body's hide bit
          // (1) clears and the regrow bit (4) starts (0x00537e64).
          this.armOut = null;
          this.armGone[this.arm] = false;
          this.sub = 2;
        } else if (this.sub === 2) {
          this.regrow = Math.fround(this.regrow + (this.ultimate ? BELRA.regrowStepUltimate : BELRA.regrowStep));
          if (this.regrow >= BELRA.regrowDone) {
            this.arm ^= 1;
            this.sub = 3;
          }
        } else if (this.sub === 3) this.enter(out, this.confused ? 'confused' : 'chase');
        break;
      }
      case 'punch': {
        const t = this.target(targets);
        if (this.sub === 0) {
          if (this.confused) {
            this.enter(out, 'confused');
            break;
          }
          if (!t) {
            this.enter(out, 'idle');
            break;
          }
          if (this.dist(t) >= BELRA.punchRange) {
            this.enter(out, 'chase');
            break;
          }
          if (this.dizzyDue()) {
            this.enter(out, 'dizzy');
            break;
          }
          if (this.turn(this.angleTo(t))) {
            this.sub = 1;
            this.frames = 0;
            this.play(out, BELRA_MOTION.punch);
          }
        } else if (this.sub === 1) {
          if (!this.dealt && this.frames >= BELRA.punchFrame) {
            this.dealt = true;
            if (t && this.dist(t) <= this.reach) {
              out.hit = { clientId: t.clientId, knockback: BELRA.knockback, mult: 1 };
              // ASSUMED: the roll's "damage > 0" test passes when the hit lands.
              if (Math.fround(this.rng()) <= (this.ultimate ? BELRA.ultParalysisChance : BELRA.paralysisChance)) out.status = { clientId: t.clientId, type: STATUS.paralysis };
            }
          }
          if (animationEnded && this.dealt) {
            this.sub = 2;
            this.timer = 0;
            this.play(out, BELRA_MOTION.idle);
          }
        } else if (this.timer >= BELRA.punchRest) {
          this.sub = 0;
          this.play(out, BELRA_MOTION.walk);
        }
        break;
      }
      case 'dizzy': {
        const step = Math.min(this.spin, BELRA.turn);
        this.angle = wrap(this.angle + this.spinDir * BAMS(step));
        this.spin = Math.max(0, this.spin - BELRA.dizzyDrop);
        if (this.timer >= BELRA.dizzyPerLevel * this.level) this.enter(out, 'chase');
        break;
      }
      case 'confused': {
        this.angle = wrap(this.angle + BAMS(BELRA.confusedTurn));
        if (wrap(this.angle - this.turnStart) < 0 || this.timer * BELRA.confusedTurn >= BELRA.confusedSpan) this.enter(out, 'throw');
        break;
      }
      default:
        exhaustive(this.state);
    }
    return this.finish(out);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead' || this.invulnerable) return;
    if (this.targetId === null) this.targetId = clientId;
    if (this.superArmor) return;
    this.current = null;
  }

  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    this.enter(out, this.resumeState);
    return this.state;
  }
}

// --- Dark Gunner / Death Gunner and their control object ----------------------------
//
// Gunner: factory 0x00545e54 (vtable 0x00b03400, update 0x00543e8c,
// dispatcher 0x005443c4), table 0x009bcf60, MovementData row 0x1e. The control
// (TObjEneDarkGunCenter, map entity 0xa3, factory 0x00543ab8, update
// 0x00543494) has no model; its group is every gunner with the same param1
// and section, ordered by param2. "Death Gunner" is the gunner the control
// has made leader (0x390 |= 0x4000000, unitxt 0x23, rt 0x23 when it dies).
// Gunner flags: dormant 0x10000 at spawn (upside down, untargetable), the
// shield 0x400000 (hit box damage_reduction = iparam3 unless frozen or
// paralysed: flat off a weapon hit's damage).
//   idle (0, 0x00545a64): dormant or hovering; shield on.
//   active (1, 0x00544fe0): no super armor; the dormant one drops (x-rotation
//     -0x1000 a frame from 0x8000, then animation 2 = motion 5, 0.6, on the
//     ground); then it hovers (rising 0.5 a frame to 10 while it dashes)
//     until the control's dash request: the first dash goes straight, later
//     ones turn 0x555 a frame for 4 frames (+30 degrees) first; the dash
//     (animation 1, motion 11, 0.8) starts at fparam1 and slows by 0.2 a
//     frame to at least 0.5 (0x009239f8 / 0x009239f4) until fparam2 units.
//   shoot (2, 0x005449a8): shield off; animation 3 (motion 0, 0.8, then row 4
//     = motion 1 looping); the charge holds iparam1 frames, 4 more, then one
//     laser at the nearest player within 200 (enemyshots.ts GunnerLaser),
//     15 frames, animation 13 (motion 12, 0.7); two shots, then active.
//   flinch (4, 0x00544704): animation 5 (motion 3, 0.7), stunned 9 (motion 6,
//     0.6); a hit on the Death Gunner while it shoots stuns the whole group
//     instead (0x0054615c -> control 0x00543c88).
//   stun (6, 0x00544518): shield off; animation 8 (motion 10, 0.7, then 11 =
//     motion 8 looping) for iparam2 frames, then active.
//   home (8, 0x00544410): toward its spawn point at fparam1, idle within 10.
//   death (5, 0x00544634): animation 7 (motion 4, 0.7).
// The control (state +0x37c, timer +0x380):
//   0: on Stagger(30) the nearest player within 1000 of the control; none ->
//     the gunners go home; found -> gunner i (in order) heads at the player's
//     direction + 0x4000 + i * 0x1555 (a 30-degree fan), 90 frames -> 1.
//   1: after 90 frames a dash request to all, 210 frames -> 2.
//   2: all grounded or 210 frames -> 3.
//   3: no player within 1000 -> 0; else a dash request to all, the leader
//      moves to the next gunner in order (Death Gunner), 120 frames -> 4.
//   4: after 120 frames all shoot (vtable +0xf8), 420 frames -> 5.
//   5: after 420 frames -> 3.
//   6: (the group stun, 0x00543c88) 120 frames -> 3.
//   With no gunner left the control deletes itself 90 frames later.
export const GUNNER = {
  dropTurn: 0x1000,
  hoverRise: 0.5,
  hoverMax: 10,
  turn: 0x555,
  turnFrames: 4,
  decel: Math.fround(0.2),
  minSpeed: 0.5,
  shotRange: 200,
  shots: 2,
  flash: 4,
  afterShot: 15,
  // Muzzle: 5.0 (0x00923a70) + bob + hover above the gunner.
  muzzle: 5,
  home: 10,
  controlRange: 1000,
  controlStagger: 30,
  fanStep: 0x1555,
  aimWait: 90,
  landWait: 210,
  shootWait: 120,
  cycle: 420,
  stunWait: 120,
} as const;

const GUNNER_MOTION = {
  idle: loop(13, 1),
  dash: once(11, 0.8),
  land: once(5, 0.6),
  raise: once(0, 0.8),
  aim: loop(1, 1),
  end: once(12, 0.7),
  stun: once(10, 0.7),
  stunLoop: loop(8, 0.7),
  flinch: once(3, 0.7),
  stunFlinch: once(6, 0.6),
};

export type GunnerState = 'dormant' | 'drop' | 'hover' | 'turn' | 'dash' | 'shoot' | 'stun' | 'home' | 'idle' | 'dead';

export class GunnerAi extends BrainBase {
  state: GunnerState = 'dormant';
  death = false; // the Death Gunner (leader)
  grounded = false;
  dashRequest = false;
  shieldPower: number; // iparam3
  private mv: EnemyMovementData;
  private spawnX: number;
  private spawnZ: number;
  private firstDash = true;
  private lift = 0;
  private hover = false;
  private speed = 0;
  private dashed = 0;
  private timer = 0;
  private sub = 0;
  private count = 0;
  private stunned = false;
  private pendingMotion: EnemyAiMotion | null = null;
  frozenOrParalysed = false; // the owner keeps it current

  constructor(opts: { x: number; z: number; angle: number; movement: EnemyMovementData | null; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.mv = opts.movement ?? EMPTY_MV;
    this.shieldPower = this.mv.iparam[2];
    this.current = GUNNER_MOTION.idle;
  }

  get rtIndex(): number {
    return this.death ? 0x23 : 0x22;
  }

  // Dormant gunners carry 0x4040000 (untargetable).
  get invulnerable(): boolean {
    return this.state === 'dormant' || this.state === 'drop';
  }

  // The hit on the Death Gunner while it shoots stuns the group, no flinch.
  get superArmor(): boolean {
    return this.state === 'shoot' && this.death;
  }

  // The shield (0x400000): on in idle / active / home, off while shooting
  // or stunned and while frozen or paralysed.
  get shield(): boolean {
    if (this.frozenOrParalysed) return false;
    return this.state !== 'shoot' && this.state !== 'stun' && this.state !== 'dead';
  }

  get flinchMotion(): EnemyAiMotion {
    return this.stunned ? GUNNER_MOTION.stunFlinch : GUNNER_MOTION.flinch;
  }

  // The control's requests.
  requestDash(): void {
    if (this.state === 'dead') return;
    this.dashRequest = true;
    if (this.state === 'dormant') this.setState('drop');
    else if (this.state === 'stun' || this.state === 'idle' || this.state === 'home') this.setState('hover');
  }

  requestShoot(): void {
    if (this.state === 'dead' || this.state === 'dormant' || this.state === 'drop') return;
    this.setState('shoot');
  }

  requestStun(): void {
    if (this.state === 'dead' || this.state === 'stun' || this.state === 'dormant') return;
    this.setState('stun');
  }

  requestHome(): void {
    if (this.state === 'dead' || this.state === 'dormant') return;
    this.setState(Math.hypot(this.spawnX - this.x, this.spawnZ - this.z) > GUNNER.home ? 'home' : 'idle');
  }

  setHeading(a: number): void {
    this.angle = wrap(a);
  }

  private setState(state: GunnerState): void {
    this.state = state;
    this.timer = 0;
    this.sub = 0;
    this.stunned = state === 'stun';
    if (state === 'shoot') {
      this.count = 0;
      this.hover = false;
      this.pendingMotion = GUNNER_MOTION.raise;
    } else if (state === 'stun') {
      this.hover = false;
      this.pendingMotion = GUNNER_MOTION.stun;
    } else if (state === 'home') {
      this.hover = true;
      this.pendingMotion = GUNNER_MOTION.idle;
    } else if (state === 'idle' || state === 'hover') this.pendingMotion = GUNNER_MOTION.idle;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.pendingMotion) {
      this.play(out, this.pendingMotion);
      this.pendingMotion = null;
    }
    if (this.state === 'dead') return out;
    this.timer++;
    switch (this.state) {
      case 'dormant':
      case 'idle':
        break;
      case 'drop':
        // x-rotation 0x8000 -> 0 at 0x1000 a frame, then the landing.
        if (this.sub === 0 && this.timer >= 0x8000 / GUNNER.dropTurn) {
          this.sub = 1;
          this.grounded = true;
          this.play(out, GUNNER_MOTION.land);
        } else if (this.sub === 1 && animationEnded) {
          this.state = 'hover';
          this.play(out, GUNNER_MOTION.idle);
        }
        break;
      case 'hover':
        if (this.dashRequest) {
          this.dashRequest = false;
          this.hover = true;
          this.timer = 0;
          if (this.firstDash) {
            this.firstDash = false;
            this.startDash(out);
          } else this.state = 'turn';
        } else this.hover = false;
        break;
      case 'turn':
        this.angle = wrap(this.angle + BAMS(GUNNER.turn));
        if (this.timer >= GUNNER.turnFrames) this.startDash(out);
        break;
      case 'dash':
        this.x += Math.sin(this.angle) * this.speed;
        this.z += Math.cos(this.angle) * this.speed;
        this.dashed += this.speed;
        this.speed = Math.max(this.speed - GUNNER.decel, GUNNER.minSpeed);
        if (this.dashed >= this.mv.fparam2) {
          this.hover = false;
          this.state = 'hover';
        }
        break;
      case 'shoot':
        if (this.sub === 0 && animationEnded) {
          this.sub = 1;
          this.timer = 0;
          this.play(out, GUNNER_MOTION.aim);
        } else if (this.sub === 1 && this.timer >= this.mv.iparam[0]) {
          this.sub = 2;
          this.timer = 0;
        } else if (this.sub === 2 && this.timer >= GUNNER.flash) {
          this.sub = 3;
          this.timer = 0;
          this.count++;
          const t = nearest(targets, this.x, this.z, GUNNER.shotRange);
          if (t) {
            (out.shots ??= []).push(
              new GunnerLaser({ x: this.x, y: GUNNER.muzzle + this.lift, z: this.z, tx: t.x, tz: t.z, speed: this.mv.fparam4, power: this.mv.iparam[3], death: this.death }),
            );
          }
        } else if (this.sub === 3 && this.timer >= GUNNER.afterShot) {
          this.sub = 4;
          this.play(out, GUNNER_MOTION.end);
        } else if (this.sub === 4 && animationEnded) {
          if (this.count < GUNNER.shots) {
            this.sub = 0;
            this.play(out, GUNNER_MOTION.raise);
          } else this.setState('hover');
        }
        break;
      case 'stun':
        if (this.sub === 0 && animationEnded) {
          this.sub = 1;
          this.play(out, GUNNER_MOTION.stunLoop);
        }
        if (this.timer >= this.mv.iparam[1]) this.setState('hover');
        break;
      case 'home': {
        const d = Math.hypot(this.spawnX - this.x, this.spawnZ - this.z);
        if (d < GUNNER.home) {
          this.hover = false;
          this.setState('idle');
          break;
        }
        const v = Math.min(this.mv.fparam1 || 1, d);
        const a = Math.atan2(this.spawnX - this.x, this.spawnZ - this.z);
        this.x += Math.sin(a) * v;
        this.z += Math.cos(a) * v;
        break;
      }
      default:
        exhaustive(this.state);
    }
    this.lift = this.hover ? Math.min(GUNNER.hoverMax, this.lift + GUNNER.hoverRise) : Math.max(0, this.lift - GUNNER.hoverRise);
    out.lift = this.lift;
    return this.finish(out);
  }

  private startDash(out: AiFrame): void {
    this.state = 'dash';
    this.speed = this.mv.fparam1;
    this.dashed = 0;
    this.play(out, GUNNER_MOTION.dash);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
    if (this.superArmor) return;
    this.current = null;
  }

  // The flinch (state 4) ends in state 1 (active).
  resume(): string {
    if (this.state === 'dead') return this.state;
    this.setState('hover');
    return this.state;
  }
}

export class GunnerControl {
  state = 0;
  timer = -1;
  leader = -1;
  gone = false;
  private frame = 0;
  private emptyFor = -1;
  private x: number;
  private z: number;
  private phase: number;

  constructor(x: number, z: number, phase = 0) {
    this.x = x;
    this.z = z;
    this.phase = phase;
  }

  // One frame; `gunners` is the group in param2 order (live members only).
  tick(gunners: readonly GunnerAi[], targets: readonly AiTarget[]): void {
    if (this.gone) return;
    this.frame++;
    const live = gunners.filter((g) => g.state !== 'dead');
    if (!live.length) {
      if (this.emptyFor < 0) this.emptyFor = 90;
      else if (--this.emptyFor < 1) this.gone = true;
      return;
    }
    this.emptyFor = -1;
    const player = () => nearest(targets, this.x, this.z, GUNNER.controlRange);
    this.timer--;
    switch (this.state) {
      case 0: {
        if (this.frame % GUNNER.controlStagger !== this.phase % GUNNER.controlStagger) break;
        const t = player();
        if (!t) {
          for (const g of live) g.requestHome();
          break;
        }
        // ASSUMED: the fan's 0x4000 offset turns the exe's atan2(dz, dx)
        // into the heading toward the player, so gunner 0 heads at it.
        const base = Math.atan2(t.x - this.x, t.z - this.z);
        live.forEach((g, i) => g.setHeading(base + BAMS(i * GUNNER.fanStep)));
        this.timer = GUNNER.aimWait;
        this.state = 1;
        break;
      }
      case 1:
        if (this.timer <= 0) {
          for (const g of live) g.requestDash();
          this.timer = GUNNER.landWait;
          this.state = 2;
        }
        break;
      case 2:
        if (live.every((g) => g.grounded) || this.timer <= 0) this.state = 3;
        break;
      case 3: {
        if (!player()) {
          this.state = 0;
          break;
        }
        for (const g of live) g.requestDash();
        this.leader = (this.leader + 1) % live.length;
        live.forEach((g, i) => (g.death = i === this.leader));
        this.timer = GUNNER.shootWait;
        this.state = 4;
        break;
      }
      case 4:
        if (this.timer <= 0) {
          for (const g of live) g.requestShoot();
          this.timer = GUNNER.cycle;
          this.state = 5;
        }
        break;
      case 5:
      case 6:
        if (this.timer <= 0) this.state = 3;
        break;
    }
  }

  // 0x0054615c -> 0x00543c88: the Death Gunner was hit while shooting.
  stunGroup(gunners: readonly GunnerAi[]): void {
    for (const g of gunners) g.requestStun();
    this.state = 6;
    this.timer = GUNNER.stunWait;
  }
}

// EnemyUpdateTarget_0052ccd8(range): the nearest player; while confused
// (EnemyFindNearestTarget_0052cd2c) also the nearest other enemy (ids from
// 0x1000, the owner adds them), the closer one wins (the enemy on a tie) -
// but with no player in range there is no target at all.
export function updateTarget(targets: readonly AiTarget[], x: number, z: number, range: number): AiTarget | null {
  const player = nearest(
    targets.filter((t) => t.clientId < 0x1000),
    x,
    z,
    range,
  );
  if (!player) return null;
  const enemy = nearest(
    targets.filter((t) => t.clientId >= 0x1000),
    x,
    z,
    range,
  );
  if (!enemy) return player;
  return (enemy.x - x) ** 2 + (enemy.z - z) ** 2 <= (player.x - x) ** 2 + (player.z - z) ** 2 ? enemy : player;
}

// --- Delsaber -----------------------------------------------------------------------
//
// Ctor 0x0055018c (vtable 0x00b03fa0, update 0x0054e3dc), driven by the
// generic update_enemy_control_object 0x00787a80: dead -> damage -> the guard
// check (+0x84, before the behaviour lock, so the guard interrupts attacks)
// -> find target / attack choice. Table 0x009bd5e0; AI record 0x009bd6dc
// {search 250, 1.25 (written at 0x00551196: the lunge speed), turn 1024};
// AttackData rows [0] the combo, [1] the jump, [2] the slash.
// MovementData: fparam1 the combo's animation speed, fparam2 the pause after
// it, fparam3 / fparam4 the walk speed and its animation speed. The shield
// (+0x390 / +0x392) = round(initdata param1 + 100).
//   hidden (0, 0x0054fcf0) / waiting (1, 0x0054fc50): invulnerable at the
//     spawn point until the target is within 200 (0x009245d4 = 40000);
//   appear (2, 0x0054fb80): the dark spawn effect, still invulnerable.
//   target (0x00550550, Stagger(30)): the nearest player within 30 if any,
//     else the nearest within 250 (the param2 job-mask preference is left
//     out).
//   walk (3, 0x0054f8f8): animation 1 at fparam4, at fparam3 turning 1024;
//     "far" (bit 0x10) while the distance >= 150 (0x00a7395c = 22500).
//   attack choice (0x00550ac8, r = the target's radius 10, 0x009245b0):
//     shield broken -> the slash inside AttackData[2]'s reach; far -> the
//     jump inside r + 150 (0x009245ac) and +-0xaaa; else the combo inside
//     AttackData[0]'s reach and arc.
//   combo (4, 0x0054f228): turns 1024 until within 0x10 BAMS, then animation
//     2 (motion 1) at fparam1; the 1.25 lunge between the swings (frames
//     21..32, 42..52); hits at frames 16, 37, 54: try_hit_entity(1.0) +
//     cause_knockback(the damage); then round(fparam2) frames.
//   slash (5, 0x0054ef1c): animation 3 (motion 8, 1.0); frame 7 with
//     AttackData[2]; a hit refills the shield by its damage (to max); after 2
//     slashes the broken flag clears.
//   jump (6, 0x0054eae4): animation 4 (motion 7, 0.7 written at run time);
//     at frame 11 it leaps at the target at (horizontal distance - 15
//     (0x00924634)) * 0.0583333 (0x00a73954) a frame; lands at frame 23 with
//     AttackData[1]: try_hit_entity(1.0) + cause_knockback(the damage).
//   guard (+0x84 0x00550db4 -> 7, 0x0054e878): with the shield up, a player
//     within 30 (0x009245a8 = 900), inside +-0x2aaa of its facing, in an
//     attack action and facing it within +-0x2aaa: animation 5 (motion 6,
//     0.8); the shield loses (attacker ATP + spread + weapon ATP - own DFP)
//     * 0.2 (0x0092464c), below 1 it breaks; invulnerable (0x4000000) until
//     frame 28, then the check again (restart, drain again) or the walk.
//   flinch (0x00550fcc): the attacker within +-0x2aaa of its facing ->
//     animation 6 (motion 5, 1.0), else animation 8 (motion 2, 1.0).
//   no target (0x005509f4 -> 11, 0x0054e518): 31 frames, the shrink, back to
//     the spawn point hidden.
//   death (10): animation 9 (motion 4) or 10 (motion 3) at a 0.5 roll.
export const DELSABER = {
  search: 250,
  close: 30,
  wake: 200,
  far: 150,
  targetRadius: 10,
  jumpReach: 150,
  jumpArc: 0xaaa,
  lunge: 1.25,
  turn: 1024,
  aimed: 0x10,
  comboHits: [16, 37, 54],
  lungeWindows: [
    [21, 32],
    [42, 52],
  ],
  slashFrame: 7,
  slashes: 2,
  jumpFrame: 11,
  landFrame: 23,
  jumpShort: 15,
  jumpScale: Math.fround(0.0583333),
  guardRange: 30,
  guardArc: 0x2aaa,
  guardDrain: Math.fround(0.2),
  guardEnd: 28,
  shieldBase: 100,
  vanishWait: 31,
  // ASSUMED: the appear effect and the shrink take 30 / 10 frames.
  appear: 30,
  shrink: 10,
  stagger: 30,
} as const;

const DELSABER_MOTION = {
  wait: loop(9, 1),
  slash: once(8, 1),
  jump: once(7, 0.7),
  guard: once(6, 0.8),
  front: once(5, 1),
  back: once(2, 1),
};

export type DelsaberState = 'hidden' | 'appear' | 'walk' | 'combo' | 'slash' | 'jump' | 'guard' | 'vanish' | 'dead';

export class DelsaberAi extends BrainBase {
  state: DelsaberState = 'hidden';
  shield: number;
  readonly maxShield: number;
  broken = false;
  confused = false;
  private mv: EnemyMovementData;
  private attacks: Array<{ reach: number; arc: number }>;
  private spawnX: number;
  private spawnZ: number;
  private phase: number;
  private clock = 0;
  private timer = 0;
  private frames = 0;
  private sub = 0;
  private hitIndex = 0;
  private slashes = 0;
  private far = false;
  private vx = 0;
  private vz = 0;
  private lastAttacker: number | null = null;
  private seen: readonly AiTarget[] = [];
  private drainOf: (clientId: number) => number;

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    param1: number;
    movement: EnemyMovementData | null;
    attacks: Array<EnemyAttackData | null>;
    phase?: number;
    // The guard's drain for a player's attack: (ATP + spread + weapon ATP -
    // the Delsaber's DFP) * 0.2 (the owner has the attacker's stats).
    guardDrain?: (clientId: number) => number;
    rng?: () => number;
  }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.mv = opts.movement ?? EMPTY_MV;
    this.maxShield = Math.round(opts.param1 + DELSABER.shieldBase);
    this.shield = this.maxShield;
    // The attack choice uses r = the target's radius (10), not its own.
    this.attacks = [0, 1, 2].map((i) => reachOf(opts.attacks[i] ?? opts.attacks[0] ?? null, DELSABER.targetRadius));
    this.phase = opts.phase ?? 0;
    this.drainOf = opts.guardDrain ?? (() => 0);
    this.current = DELSABER_MOTION.wait;
  }

  get invulnerable(): boolean {
    return this.state === 'hidden' || this.state === 'appear' || this.state === 'vanish' || (this.state === 'guard' && this.frames < DELSABER.guardEnd);
  }

  get flinchMotion(): EnemyAiMotion {
    const t = this.lastAttacker !== null ? this.seen.find((p) => p.clientId === this.lastAttacker) : undefined;
    const front = !t || Math.abs(wrap(this.angleTo(t) - this.angle)) < BAMS(DELSABER.guardArc);
    return front ? DELSABER_MOTION.front : DELSABER_MOTION.back;
  }

  private deathRoll: EnemyAiMotion | null = null;
  get deathMotion(): EnemyAiMotion {
    this.deathRoll ??= Math.fround(this.rng()) < 0.5 ? once(4, 0.6) : once(3, 0.6);
    return this.deathRoll;
  }

  // The slash's hit refills the shield.
  landed(damage: number): void {
    if (this.state === 'slash' && damage > 0) this.shield = Math.min(this.maxShield, this.shield + Math.trunc(damage));
  }

  private enter(out: AiFrame, state: DelsaberState): void {
    this.state = state;
    this.timer = 0;
    this.frames = 0;
    this.sub = 0;
    this.hitIndex = 0;
    if (state === 'walk') this.play(out, loop(10, this.mv.fparam4 || 1));
    else if (state === 'combo') this.play(out, loop(10, 1));
    else if (state === 'slash') this.play(out, DELSABER_MOTION.slash);
    else if (state === 'jump') this.play(out, DELSABER_MOTION.jump);
    else if (state === 'guard') this.play(out, DELSABER_MOTION.guard);
    else if (state === 'hidden' || state === 'appear' || state === 'vanish') this.play(out, DELSABER_MOTION.wait);
  }

  private inReach(t: AiTarget, k: number, arc?: number): boolean {
    const a = this.attacks[k];
    return this.dist(t) <= a.reach && Math.abs(wrap(this.angleTo(t) - this.angle)) <= (arc ?? a.arc);
  }

  // The guard check (+0x84).
  private threat(targets: readonly AiTarget[]): AiTarget | null {
    if (this.shield <= 0 || this.broken) return null;
    for (const t of targets) {
      if (t.dead || !t.attacking || this.dist(t) >= DELSABER.guardRange) continue;
      if (Math.abs(wrap(this.angleTo(t) - this.angle)) >= BAMS(DELSABER.guardArc)) continue;
      const facing = Math.atan2(this.x - t.x, this.z - t.z);
      if (t.angle !== undefined && Math.abs(wrap(facing - t.angle)) >= BAMS(DELSABER.guardArc)) continue;
      return t;
    }
    return null;
  }

  private guard(t: AiTarget): void {
    // The shield is an int16: the float sum is truncated when stored.
    this.shield = Math.trunc(this.shield - this.drainOf(t.clientId));
    if (this.shield < 1) {
      this.shield = 0;
      this.broken = true;
    }
  }

  private retarget(targets: readonly AiTarget[]): void {
    if (this.clock % DELSABER.stagger !== this.phase % DELSABER.stagger) return;
    const t = (this.confused ? null : nearest(targets, this.x, this.z, DELSABER.close)) ?? nearest(targets, this.x, this.z, DELSABER.search);
    this.targetId = t ? t.clientId : null;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.seen = targets;
    this.clock++;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    const active = this.state !== 'hidden' && this.state !== 'appear' && this.state !== 'vanish';
    if (active && this.state !== 'guard') {
      const g = this.threat(targets);
      if (g) {
        this.guard(g);
        this.enter(out, 'guard');
        return this.finish(out);
      }
    }
    switch (this.state) {
      case 'hidden': {
        out.hidden = true;
        this.retarget(targets);
        const t = this.target(targets);
        if (t && this.dist(t) ** 2 < DELSABER.wake ** 2) {
          out.hidden = false;
          this.enter(out, 'appear');
        }
        break;
      }
      case 'appear':
        if (this.timer >= DELSABER.appear) this.enter(out, 'walk');
        break;
      case 'vanish':
        if (this.timer >= DELSABER.vanishWait + DELSABER.shrink) {
          this.x = this.spawnX;
          this.z = this.spawnZ;
          out.hidden = true;
          this.enter(out, 'hidden');
        }
        break;
      case 'walk': {
        this.retarget(targets);
        const t = this.target(targets);
        if (!t) {
          this.enter(out, 'vanish');
          break;
        }
        this.far = this.dist(t) ** 2 >= DELSABER.far ** 2;
        if (this.broken && this.inReach(t, 2)) {
          this.enter(out, 'slash');
          break;
        }
        if (!this.broken && this.far && this.dist(t) <= DELSABER.targetRadius + DELSABER.jumpReach && Math.abs(wrap(this.angleTo(t) - this.angle)) <= BAMS(DELSABER.jumpArc)) {
          this.enter(out, 'jump');
          break;
        }
        if (!this.broken && !this.far && this.inReach(t, 0)) {
          this.enter(out, 'combo');
          break;
        }
        // ASSUMED: the waypoint (SorcererAcquireTarget) is the target.
        this.angle = turnToward(this.angle, this.angleTo(t), BAMS(DELSABER.turn));
        const v = this.mv.fparam3 || 0.5;
        this.x += Math.sin(this.angle) * v;
        this.z += Math.cos(this.angle) * v;
        break;
      }
      case 'combo': {
        const t = this.target(targets);
        if (this.sub === 0) {
          if (!t) {
            this.enter(out, 'walk');
            break;
          }
          this.angle = turnToward(this.angle, this.angleTo(t), BAMS(DELSABER.turn));
          if (Math.abs(wrap(this.angleTo(t) - this.angle)) < BAMS(DELSABER.aimed)) {
            this.sub = 1;
            this.frames = 0;
            this.vx = Math.sin(this.angle) * DELSABER.lunge;
            this.vz = Math.cos(this.angle) * DELSABER.lunge;
            this.play(out, once(1, this.mv.fparam1 || 1));
          }
          break;
        }
        if (this.sub === 1) {
          if (DELSABER.lungeWindows.some(([a, b]) => this.frames >= a && this.frames <= b)) {
            this.x += this.vx;
            this.z += this.vz;
          }
          if (this.hitIndex < DELSABER.comboHits.length && this.frames >= DELSABER.comboHits[this.hitIndex]) {
            this.hitIndex++;
            if (t && this.inReach(t, 0)) out.hit = { clientId: t.clientId, knockback: 0, mult: 1, kbScale: 1 };
          }
          if (animationEnded && this.hitIndex >= DELSABER.comboHits.length) {
            this.sub = 2;
            this.timer = 0;
            this.play(out, DELSABER_MOTION.wait);
          }
        } else if (this.timer >= Math.round(this.mv.fparam2)) this.enter(out, 'walk');
        break;
      }
      case 'slash': {
        const t = this.target(targets);
        if (this.hitIndex === 0 && this.frames >= DELSABER.slashFrame) {
          this.hitIndex = 1;
          if (t && this.inReach(t, 2)) out.hit = { clientId: t.clientId, knockback: 0, mult: 1, kbScale: 1, attack: 2 };
        }
        if (animationEnded && this.hitIndex) {
          if (++this.slashes >= DELSABER.slashes) {
            this.slashes = 0;
            this.broken = false;
          }
          this.enter(out, 'walk');
        }
        break;
      }
      case 'jump': {
        const t = this.target(targets);
        if (this.sub === 0 && this.frames >= DELSABER.jumpFrame) {
          if (!t) {
            this.sub = 2;
            break;
          }
          const d = this.dist(t);
          const v = Math.max(0, d - DELSABER.jumpShort) * DELSABER.jumpScale;
          const a = this.angleTo(t);
          this.angle = a;
          this.vx = Math.sin(a) * v;
          this.vz = Math.cos(a) * v;
          this.sub = 1;
        } else if (this.sub === 1) {
          this.x += this.vx;
          this.z += this.vz;
          if (this.frames >= DELSABER.landFrame) {
            this.sub = 2;
            if (t && this.inReach(t, 1)) out.hit = { clientId: t.clientId, knockback: 0, mult: 1, kbScale: 1, attack: 1 };
          }
        }
        if (this.sub === 2 && animationEnded) this.enter(out, 'walk');
        break;
      }
      case 'guard':
        if (this.frames >= DELSABER.guardEnd && this.sub === 0) {
          const g = this.threat(targets);
          if (g) {
            this.guard(g);
            this.enter(out, 'guard');
          } else this.sub = 1;
        }
        if (this.sub === 1 && animationEnded) this.enter(out, 'walk');
        break;
      default:
        exhaustive(this.state);
    }
    return this.finish(out);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.lastAttacker = clientId;
    this.targetId ??= clientId;
    this.current = null;
  }

  // The flinch's end: shield < 1 breaks it (state 8's end).
  resume(): string {
    if (this.state === 'dead') return this.state;
    if (this.shield < 1) this.broken = true;
    const out = this.frame();
    this.enter(out, 'walk');
    return this.state;
  }
}

// --- Chaos Bringer ------------------------------------------------------------------
//
// Ctor 0x0053a454 (vtable 0x00b026e0), update 0x0053a500, dispatcher
// 0x0053a998, init 0x0053cd38; table 0x009bccc0. On hit (0x0053c7d8): outside
// states 8 / 9 the hit counter +0x49c++ and the attacker becomes the target;
// super armor (+0x3c8 & 4) keeps the state, else the flinch (9). Target
// search 300 every 30 frames. MovementData: fparam1 the charge speed, fparam2
// the walk speed, fparam3 / fparam4 the swing / laser animation speeds,
// fparam6 the rest after a swing; iparam2 the pause after a charge, iparam3 /
// iparam4 the charge / laser powers, iparam5 the swing approach distance,
// iparam6 the charge distance.
//   hidden (1, 0x0053c724): invulnerable until a target within 300.
//   appear (2, 0x0053c538): at the spawn point, invulnerable for the 50-frame
//     fade-in (0.04 a frame); walks 1.2 a frame toward the target for 20
//     frames (row 1 = motion 10, 1.0), then rears (row 3 = motion 4, 0.6).
//   lost (3, 0x0053c408): invulnerable; 60 frames without a target -> fade
//     out (50) -> hidden.
//   chase (4, 0x0053c1c8): row 1; turns 0x300 a frame; walks fparam2 while
//     farther than iparam5; no target -> lost; distance >= iparam6 with fewer
//     than 2 charges -> the charge; inside iparam5 and within 0x1800 of its
//     facing -> the swing.
//   charge (5, 0x0053b9fc): wind-up row 7 (motion 5, 0.6) turning 0x280;
//     then the run (row 2 = motion 7, 1.0, super armor) along the direction
//     frozen at the end of the wind-up at fparam1; each player touched once:
//     entity_hit_by_tech(group 0, iparam3) and a 0.3333 (0x00923220) roll for
//     confusion (Ultimate unequips the weapon instead: left out); it stops on
//     a hit, a wall or once it passed the target (distance >= 30 behind);
//     then the brake: 10 frames, row 3 with the speed * 0.95 (0x00923228),
//     still hitting while >= 3.0; then the pause (7: row 8 = motion 1, 0.6,
//     iparam2 frames) or the laser when hits > 4.
//   swing (6, 0x0053b64c): row 4 (motion 6, fparam3), super armor, the
//     charge count reset; hits in frames [10.8 (Ultimate 7.8), 13]:
//     try_hit_entity(1.0) + a 3.0 push; then row 0 for fparam6 frames.
//   laser (8, 0x0053ac24): super armor; row 9 (motion 8, 0.4): at frame 12
//     every player in sight loses floor(TP * 0.25) (0x0092328c); then the
//     farthest player within 300 (90000), turn 0x300 a frame, row 5 (motion
//     0, fparam4): at frame 14 the laser (0x0053de7c, update 0x0053dc78):
//     10 a frame for 26 frames, radius 5, piercing, entity_hit_by_tech(group
//     0, iparam4 * 1.5 when more than 70 TP were drained, * 2 from 151) + a
//     3.0 push; Ultimate fires 3 times; 60 frames; the hit count clears.
//   flinch (9, 0x0053aaf8): row 6 (motion 2, 0.7); hits > 4 -> the laser.
//   death (10): row 10 (motion 3, 0.6).
export const BRINGER = {
  search: 300,
  stagger: 30,
  appearWalk: 1.2,
  appearFrames: 20,
  fade: 50,
  lostWait: 60,
  turn: 0x300,
  windupTurn: 0x280,
  swingArc: 0x1800,
  maxCharges: 2,
  passed: 30,
  brakeWait: 10,
  brake: Math.fround(0.95),
  brakeHit: 3,
  confuseChance: Math.fround(0.3333),
  swingFrom: Math.fround(10.8),
  ultSwingFrom: Math.fround(7.8),
  swingTo: 13,
  push: 3,
  laserHits: 4,
  drain: 0.25,
  drainFrame: 12,
  laserRange: 300,
  laserFrame: 14,
  laserSpeed: 10,
  laserLife: 26,
  laserRadius: 5,
  laserRest: 60,
  ultShots: 3,
  // ASSUMED: the body's contact radius (hit box 0x009bcc20: radius 7).
  body: 7,
} as const;

const BRINGER_MOTION = {
  idle: loop(9, 0.8),
  walk: loop(10, 1),
  run: loop(7, 1),
  rear: once(4, 0.6),
  windup: once(5, 0.6),
  pant: loop(1, 0.6),
  charge: once(8, 0.4),
  flinch: once(2, 0.7),
};

export type BringerState = 'hidden' | 'appear' | 'lost' | 'chase' | 'charge' | 'pause' | 'swing' | 'laser' | 'dead';

export class BringerAi extends BrainBase {
  state: BringerState = 'hidden';
  hits = 0;
  private ultimate: boolean;
  private mv: EnemyMovementData;
  private reach: number;
  private spawnX: number;
  private spawnZ: number;
  private phase: number;
  private clock = 0;
  private timer = 0;
  private frames = 0;
  private sub = 0;
  private charges = 0;
  private speed = 0;
  private dirX = 0;
  private dirZ = 0;
  private struck = new Set<number>();
  private drainedTp = 0;
  private shots = 0;
  private aim = 0;
  private fading = 0;
  private resumeState: BringerState = 'chase';

  constructor(opts: { x: number; z: number; angle: number; ultimate: boolean; movement: EnemyMovementData | null; attack: EnemyAttackData | null; radius: number; phase?: number; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.ultimate = opts.ultimate;
    this.mv = opts.movement ?? EMPTY_MV;
    this.reach = reachOf(opts.attack, opts.radius).reach;
    this.phase = opts.phase ?? 0;
    this.current = BRINGER_MOTION.idle;
  }

  get invulnerable(): boolean {
    return this.state === 'hidden' || this.state === 'lost' || (this.state === 'appear' && this.fading > 0);
  }

  get superArmor(): boolean {
    return (this.state === 'charge' && this.sub === 1) || this.state === 'swing' || this.state === 'laser';
  }

  drained(tp: number): void {
    this.drainedTp += tp;
  }

  private stagger(): boolean {
    return this.clock % BRINGER.stagger === this.phase % BRINGER.stagger;
  }

  private enter(out: AiFrame, state: BringerState): void {
    this.state = state;
    this.timer = 0;
    this.frames = 0;
    this.sub = 0;
    if (state === 'chase' || state === 'pause') this.resumeState = state;
    if (state === 'appear') {
      this.x = this.spawnX;
      this.z = this.spawnZ;
      this.fading = BRINGER.fade;
      this.hits = 0;
      this.play(out, BRINGER_MOTION.walk);
    } else if (state === 'chase') this.play(out, BRINGER_MOTION.walk);
    else if (state === 'lost') this.play(out, BRINGER_MOTION.idle);
    else if (state === 'charge') {
      this.speed = this.mv.fparam1;
      this.struck.clear();
      this.play(out, BRINGER_MOTION.windup);
    } else if (state === 'pause') this.play(out, BRINGER_MOTION.pant);
    else if (state === 'swing') {
      this.charges = 0;
      this.struck.clear();
      this.play(out, once(6, Math.max(0.1, this.mv.fparam3)));
    } else if (state === 'laser') {
      this.drainedTp = 0;
      this.shots = 0;
      this.play(out, BRINGER_MOTION.charge);
    }
  }

  private after(out: AiFrame): void {
    this.enter(out, this.hits > BRINGER.laserHits ? 'laser' : 'chase');
  }

  private contact(targets: readonly AiTarget[], out: AiFrame): boolean {
    for (const t of targets) {
      if (t.dead || this.struck.has(t.clientId) || t.clientId >= 0x1000) continue;
      if (this.dist(t) > BRINGER.body + 5) continue;
      this.struck.add(t.clientId);
      out.techHit = { clientId: t.clientId, power: this.mv.iparam[2], ...(this.ultimate ? {} : { status: { type: STATUS.confusion, chance: BRINGER.confuseChance } }) };
      return true;
    }
    return false;
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.clock++;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    if (this.fading > 0) this.fading--;
    if (this.stagger() && this.state !== 'charge' && this.state !== 'laser') {
      const t = nearest(targets, this.x, this.z, BRINGER.search);
      this.targetId = t ? t.clientId : null;
    }
    const t = this.target(targets);
    switch (this.state) {
      case 'hidden':
        out.hidden = true;
        if (t) {
          this.angle = this.angleTo(t);
          out.hidden = false;
          this.enter(out, 'appear');
        }
        break;
      case 'appear':
        if (this.sub === 0) {
          if (t) this.angle = turnToward(this.angle, this.angleTo(t), BAMS(BRINGER.turn));
          this.x += Math.sin(this.angle) * BRINGER.appearWalk;
          this.z += Math.cos(this.angle) * BRINGER.appearWalk;
          if (this.timer > BRINGER.appearFrames) {
            this.sub = 1;
            this.play(out, BRINGER_MOTION.rear);
          }
        } else if (animationEnded && this.fading <= 0) this.enter(out, 'chase');
        break;
      case 'lost':
        if (this.sub === 0) {
          if (t) this.enter(out, 'chase');
          else if (this.timer > BRINGER.lostWait) {
            this.sub = 1;
            this.timer = 0;
          }
        } else if (this.timer >= BRINGER.fade) {
          out.hidden = true;
          this.enter(out, 'hidden');
        }
        break;
      case 'chase': {
        if (!t) {
          this.enter(out, 'lost');
          break;
        }
        const d = this.dist(t);
        if (d >= this.mv.iparam[5] && this.charges < BRINGER.maxCharges) {
          this.enter(out, 'charge');
          break;
        }
        this.angle = turnToward(this.angle, this.angleTo(t), BAMS(BRINGER.turn));
        if (d > this.mv.iparam[4]) {
          this.x += Math.sin(this.angle) * this.mv.fparam2;
          this.z += Math.cos(this.angle) * this.mv.fparam2;
        } else if (Math.cos(wrap(this.angleTo(t) - this.angle)) >= Math.cos(BAMS(BRINGER.swingArc))) this.enter(out, 'swing');
        break;
      }
      case 'charge':
        if (this.sub === 0) {
          if (t) this.angle = turnToward(this.angle, this.angleTo(t), BAMS(BRINGER.windupTurn));
          if (animationEnded) {
            const a = t ? this.angleTo(t) : this.angle;
            this.dirX = Math.sin(a);
            this.dirZ = Math.cos(a);
            this.sub = 1;
            this.play(out, BRINGER_MOTION.run);
          }
        } else if (this.sub === 1) {
          this.x += this.dirX * this.speed;
          this.z += this.dirZ * this.speed;
          const hit = this.contact(targets, out);
          const passed = t && this.dist(t) >= BRINGER.passed && (t.x - this.x) * this.dirX + (t.z - this.z) * this.dirZ < 0;
          if (hit || passed) {
            this.sub = 2;
            this.timer = 0;
          }
        } else if (this.sub === 2) {
          this.x += this.dirX * this.speed;
          this.z += this.dirZ * this.speed;
          if (this.timer >= BRINGER.brakeWait) {
            this.sub = 3;
            this.play(out, BRINGER_MOTION.rear);
          }
        } else if (this.sub === 3) {
          this.speed *= BRINGER.brake;
          this.x += this.dirX * this.speed;
          this.z += this.dirZ * this.speed;
          if (this.speed >= BRINGER.brakeHit) this.contact(targets, out);
          if (animationEnded) {
            this.charges++;
            if (this.hits > BRINGER.laserHits) this.enter(out, 'laser');
            else this.enter(out, 'pause');
          }
        }
        break;
      case 'pause':
        if (this.timer >= this.mv.iparam[1]) this.enter(out, 'chase');
        break;
      case 'swing': {
        if (this.sub === 0) {
          const from = this.ultimate ? BRINGER.ultSwingFrom : BRINGER.swingFrom;
          if (this.frames >= from && this.frames <= BRINGER.swingTo) {
            for (const p of targets) {
              if (p.dead || this.struck.has(p.clientId)) continue;
              if (this.dist(p) > this.reach || Math.cos(wrap(this.angleTo(p) - this.angle)) < 0) continue;
              this.struck.add(p.clientId);
              out.hit = { clientId: p.clientId, knockback: BRINGER.push, mult: 1 };
              break;
            }
          }
          if (animationEnded) {
            this.sub = 1;
            this.timer = 0;
            this.play(out, BRINGER_MOTION.idle);
          }
        } else if (this.timer >= this.mv.fparam6) this.after(out);
        break;
      }
      case 'laser':
        if (this.sub === 0) {
          if (this.timer === 1) this.struck.clear();
          if (!this.struck.has(-1) && this.frames >= BRINGER.drainFrame) {
            this.struck.add(-1);
            out.tpDrain = BRINGER.drain;
          }
          if (animationEnded) this.pick(targets, out);
        } else if (this.sub === 1) {
          this.angle = turnToward(this.angle, this.aim, BAMS(BRINGER.turn));
          if (Math.abs(wrap(this.aim - this.angle)) < 1e-6) {
            this.sub = 2;
            this.frames = 0;
            this.play(out, once(0, Math.max(0.1, this.mv.fparam4)));
          }
        } else if (this.sub === 2) {
          if (!this.struck.has(-2) && this.frames >= BRINGER.laserFrame) {
            this.struck.add(-2);
            const p = this.drainedTp >= 151 ? 2 : this.drainedTp > 70 ? 1.5 : 1;
            (out.shots ??= []).push(
              new TechBolt({
                x: this.x + Math.sin(this.angle) * 10,
                y: 20,
                z: this.z + Math.cos(this.angle) * 10,
                angle: this.angle,
                speed: BRINGER.laserSpeed,
                range: BRINGER.laserSpeed * BRINGER.laserLife,
                radius: BRINGER.laserRadius,
                effect: { kind: 'tech', power: this.mv.iparam[3] * p, knockback: BRINGER.push },
                color: 0xff4020,
                pierce: true,
              }),
            );
          }
          if (animationEnded) {
            this.shots++;
            if (this.ultimate && this.shots < BRINGER.ultShots) {
              this.struck.delete(-2);
              this.pick(targets, out);
            } else {
              this.sub = 3;
              this.timer = 0;
              this.hits = 0;
              this.play(out, BRINGER_MOTION.idle);
            }
          }
        } else if (this.sub === 3 && this.timer > BRINGER.laserRest) this.enter(out, 'chase');
        else if (this.sub === 4) this.enter(out, 'chase');
        break;
      default:
        exhaustive(this.state);
    }
    return this.finish(out);
  }

  private pick(targets: readonly AiTarget[], out: AiFrame): void {
    const f = farthest(targets, this.x, this.z, BRINGER.laserRange);
    if (!f) {
      this.sub = 4;
      return;
    }
    this.targetId = f.clientId;
    this.aim = this.angleTo(f);
    this.sub = 1;
    this.play(out, BRINGER_MOTION.walk);
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead' || this.state === 'laser' || this.invulnerable) return;
    this.targetId = clientId;
    this.hits++;
    if (this.superArmor) return;
    this.current = null;
  }

  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    this.enter(out, this.hits > BRINGER.laserHits ? 'laser' : this.resumeState);
    return this.state;
  }
}

// --- Chaos Sorcerer -----------------------------------------------------------------
//
// Ctor 0x0059b220 -> 0x0059d8b8 (vtable 0x00b09c60), per-frame AI 0x0059b308,
// dispatcher SorcererProcessState_0059b718; table 0x009bfe80. The bits (BEE_R
// / BEE_L slots, ctor 0x0059a1c4, dispatcher 0x0059a628) are the origins of
// its techniques: bit 1 casts the attacks, bit 2 the heal; they float 15 to
// the side and 18 above it (SorcererUpdateChargePositionOffsets_0059c770).
// MovementData iparam1 / iparam2 / iparam3 = the levels of technique A, B and
// Resta (constrain_tech_level). The cycle (+0x3f0): attack A, attack B, heal.
//   lurk (1, 0x0059d3d0): hidden, invulnerable; the nearest Ranger within 400
//     or else the nearest other player within 250; then it appears 50
//     (0x0092992c) from the target on the side it is on.
//   appear (2): row 7 (motion 6, 0.6, then row 0 = motion 7 looping);
//     invulnerable for the 50-frame warp (0.04 a frame); after 60 frames the
//     attack cast (5) or, on the cycle's third step, the heal (7).
//   attack (5, 0x0059c844): row 0, super armor (flag 8), turning 0xa00 a
//     frame; the target within 100 (0x00929940) -> row 1 (motion 2, 0.6, then
//     row 2 = motion 0 looping) for 90 frames, row 3 (motion 1, 0.7); at
//     frame 11 the technique from bit 1: A = Gizonde (Ultimate Grants), B =
//     Gibarta (Ultimate Megid); none in range -> 60 frames; then the vanish.
//   vanish (3): invulnerable; the warp out (50), 30 more frames, then the
//     reposition (4, 0x0059d064): a target within 400 -> it appears 30
//     (0x0092993c) or 80 (0x00929930) from it (attack count even / odd) at
//     the angle +0x3f8, which turns 60 degrees (0x2aaa) at every placement;
//     none for 90 frames -> lurk.
//   heal (6 0x0059c1a0 / 7 0x0059bd94): HP below max / 4 (Ultimate: below
//     max, 0x0059c7f0) heals itself (the other hurt enemies within 200 of
//     the room are left out), else it appears 160 (0x00929958) around itself
//     and idles 60 frames; the heal: 90 frames, row 4 (motion 3, 0.5), at
//     frame 11 the enemy Resta (CreateSpecialAttackEntity_006eeeb4) at level
//     iparam3.
//   flinch (8): practically never (super armor whenever it can be hit).
//   death (9): row 6 (motion 5, 0.5).
export const SORCERER = {
  rangerSearch: 400,
  search: 250,
  castRange: 100,
  placeFirst: 50,
  placeNear: 30,
  placeFar: 80,
  placeHeal: 160,
  placeStep: 0x2aaa,
  warp: 50,
  appearCast: 59,
  vanishWait: 29,
  repositionWait: 90,
  castTurn: 0xa00,
  charge: 90,
  releaseFrame: 11,
  noTarget: 60,
  bitSide: 15,
  bitHeight: 18,
  // ASSUMED: how the enemy technique objects fly (enemyshots.ts TechBolt).
  boltSpeed: 4,
  boltRadius: 4,
} as const;

const SORCERER_MOTION = { idle: loop(7, 0.6), appear: once(6, 0.6), charge: loop(0, 0.6), start: once(2, 0.6), cast: once(1, 0.7), heal: once(3, 0.5) };

export type SorcererState = 'lurk' | 'appear' | 'attack' | 'vanish' | 'reposition' | 'heal' | 'dead';

// Rangers (the 0x964 & 0x40 job flag): RAmar, RAcast, RAcaseal, RAmarl.
const RANGERS = new Set([3, 4, 5, 11]);

export class SorcererAi extends BrainBase {
  state: SorcererState = 'lurk';
  hpFraction = 1; // the owner keeps it current
  confused = false;
  private ultimate: boolean;
  private episode2: boolean;
  private mv: EnemyMovementData;
  private timer = 0;
  private frames = 0;
  private sub = 0;
  private cycle = 0;
  private attacks = 0;
  private placeAngle = 0;
  private warp = 0;
  private healSelf = false;

  constructor(opts: { x: number; z: number; angle: number; ultimate: boolean; episode2?: boolean; movement: EnemyMovementData | null; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.ultimate = opts.ultimate;
    this.episode2 = opts.episode2 ?? false;
    this.mv = opts.movement ?? EMPTY_MV;
    this.current = SORCERER_MOTION.idle;
  }

  get invulnerable(): boolean {
    return this.state === 'lurk' || this.state === 'vanish' || this.state === 'reposition' || (this.state === 'appear' && this.warp > 0);
  }

  get superArmor(): boolean {
    return true;
  }

  get hidden(): boolean {
    return this.state === 'lurk' || this.state === 'reposition' || (this.state === 'vanish' && this.timer > SORCERER.warp);
  }

  // The bit anchors (0x0059c770): 15 to each side, 18 up.
  bit(n: 1 | 2): { x: number; z: number; y: number } {
    const side = n === 1 ? -1 : 1;
    const a = this.angle + (side * Math.PI) / 2;
    return { x: this.x + Math.sin(a) * SORCERER.bitSide, z: this.z + Math.cos(a) * SORCERER.bitSide, y: SORCERER.bitHeight };
  }

  private search(targets: readonly AiTarget[], ranger: number, other: number): AiTarget | null {
    const r = nearest(
      targets.filter((t) => RANGERS.has(t.charClass)),
      this.x,
      this.z,
      ranger,
    );
    return r ?? nearest(
      targets.filter((t) => !RANGERS.has(t.charClass)),
      this.x,
      this.z,
      other,
    );
  }

  private place(cx: number, cz: number, r: number, a: number, face: { x: number; z: number }): void {
    this.x = cx + Math.sin(a) * r;
    this.z = cz + Math.cos(a) * r;
    this.angle = Math.atan2(face.x - this.x, face.z - this.z);
  }

  private enter(out: AiFrame, state: SorcererState): void {
    this.state = state;
    this.timer = 0;
    this.frames = 0;
    this.sub = 0;
    if (state === 'appear') {
      this.warp = SORCERER.warp;
      this.play(out, SORCERER_MOTION.appear);
    } else if (state === 'attack' || state === 'heal') this.play(out, SORCERER_MOTION.idle);
  }

  // constrain_tech_level: 0-based, 0..13 (Ultimate 0..28).
  private level(i: number): number {
    return Math.max(0, Math.min(this.ultimate ? 28 : 13, Math.trunc(this.mv.iparam[i])));
  }

  private release(out: AiFrame, t: AiTarget): void {
    const b = this.bit(1);
    const a = Math.atan2(t.x - b.x, t.z - b.z);
    let tech: number;
    if (this.cycle === 0) tech = this.ultimate ? TECH.grants : this.episode2 ? TECH.rafoie : TECH.gizonde;
    else tech = this.ultimate ? TECH.megid : TECH.gibarta;
    const level = this.level(this.cycle === 0 ? 0 : 1);
    const d = techData(tech, level);
    const effect = tech === TECH.megid ? ({ kind: 'megid', power: techPower(tech, level) } as const) : ({ kind: 'tech', power: techPower(tech, level) } as const);
    (out.shots ??= []).push(
      new TechBolt({
        x: b.x,
        y: b.y,
        z: b.z,
        angle: a,
        speed: SORCERER.boltSpeed,
        range: Math.max(SORCERER.castRange, d.rangeH) + 20,
        radius: SORCERER.boltRadius,
        effect,
        color: tech === TECH.megid ? 0x602080 : tech === TECH.gibarta ? 0x80d0ff : tech === TECH.rafoie ? 0xff6020 : tech === TECH.grants ? 0xffffa0 : 0xffff40,
      }),
    );
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.timer++;
    this.frames += this.current?.speed ?? 0;
    if (this.warp > 0) this.warp--;
    switch (this.state) {
      case 'lurk': {
        out.hidden = true;
        if (this.timer % 30 !== 0) break;
        const t = this.search(targets, SORCERER.rangerSearch, SORCERER.search);
        if (!t) break;
        this.targetId = t.clientId;
        this.placeAngle = Math.atan2(this.x - t.x, this.z - t.z);
        this.place(t.x, t.z, SORCERER.placeFirst, this.placeAngle, t);
        this.placeAngle = wrap(this.placeAngle + BAMS(SORCERER.placeStep));
        out.hidden = false;
        this.enter(out, 'appear');
        break;
      }
      case 'appear':
        if (this.timer > SORCERER.appearCast) this.enter(out, this.cycle === 2 ? 'heal' : 'attack');
        break;
      case 'attack': {
        const t = this.target(targets);
        if (t && this.sub <= 1) this.angle = turnToward(this.angle, this.angleTo(t), BAMS(SORCERER.castTurn));
        if (this.sub === 0) {
          if (t && this.dist(t) < SORCERER.castRange) {
            this.sub = 1;
            this.timer = 0;
            this.play(out, SORCERER_MOTION.start);
          } else {
            this.sub = 4;
            this.timer = 0;
          }
        } else if (this.sub === 1) {
          if (animationEnded && this.current === SORCERER_MOTION.start) this.play(out, SORCERER_MOTION.charge);
          if (this.timer > SORCERER.charge - 1) {
            this.sub = 3;
            this.frames = 0;
            this.play(out, SORCERER_MOTION.cast);
          }
        } else if (this.sub === 3) {
          if (this.frames >= SORCERER.releaseFrame) {
            if (t) this.release(out, t);
            this.sub = 2;
          }
        } else if (this.sub === 2) {
          if (animationEnded) this.sub = 5;
        } else if (this.sub === 4) {
          if (this.timer > SORCERER.noTarget - 1) this.sub = 5;
        }
        if (this.sub === 5) {
          this.cycle = (this.cycle + 1) % 3;
          this.attacks++;
          this.enter(out, 'vanish');
        }
        break;
      }
      case 'heal': {
        if (this.sub === 0) {
          if (this.healSelf) {
            this.sub = 1;
            this.timer = 0;
            this.play(out, SORCERER_MOTION.start);
          } else {
            this.sub = 4;
            this.timer = 0;
          }
        } else if (this.sub === 1) {
          if (animationEnded && this.current === SORCERER_MOTION.start) this.play(out, SORCERER_MOTION.charge);
          if (this.timer > SORCERER.charge - 1) {
            this.sub = 3;
            this.frames = 0;
            this.play(out, SORCERER_MOTION.heal);
          }
        } else if (this.sub === 3) {
          if (this.frames >= SORCERER.releaseFrame) {
            out.heal = { level: this.level(2) };
            this.sub = 2;
          }
        } else if (this.sub === 2) {
          if (animationEnded) this.sub = 5;
        } else if (this.sub === 4 && this.timer > SORCERER.noTarget - 1) this.sub = 5;
        if (this.sub === 5) {
          this.cycle = 0;
          this.enter(out, 'vanish');
        }
        break;
      }
      case 'vanish':
        out.hidden = this.timer > SORCERER.warp;
        if (this.timer > SORCERER.warp + SORCERER.vanishWait) this.enter(out, 'reposition');
        break;
      case 'reposition': {
        out.hidden = true;
        if (this.cycle === 2) {
          // State 6: itself when hurt, else 160 around its own position.
          this.healSelf = this.ultimate ? this.hpFraction < 1 : this.hpFraction < 0.25;
          const r = this.healSelf ? 20 : SORCERER.placeHeal;
          const cx = this.x;
          const cz = this.z;
          this.place(cx, cz, r, this.placeAngle, { x: cx, z: cz });
          this.placeAngle = wrap(this.placeAngle + BAMS(SORCERER.placeStep));
          out.hidden = false;
          this.enter(out, 'appear');
          break;
        }
        const t = this.search(targets, SORCERER.rangerSearch, SORCERER.rangerSearch);
        if (!t) {
          if (this.timer > SORCERER.repositionWait) this.enter(out, 'lurk');
          break;
        }
        this.targetId = t.clientId;
        this.place(t.x, t.z, this.attacks % 2 === 0 ? SORCERER.placeNear : SORCERER.placeFar, this.placeAngle, t);
        this.placeAngle = wrap(this.placeAngle + BAMS(SORCERER.placeStep));
        out.hidden = false;
        this.enter(out, 'appear');
        break;
      }
      default:
        exhaustive(this.state);
    }
    return this.finish(out);
  }

  onDamage(_clientId: number): void {}

  resume(): string {
    if (this.state !== 'dead') this.current = SORCERER_MOTION.idle;
    return this.state;
  }
}

// --- Del Lily's Megid ---------------------------------------------------------------
//
// The Lily's spit state (0x00528c38) at frame 12: a Del Lily, and any Lily in
// Ultimate, calls create_megid1 (CreateMegidEntity_006e98c0, stats
// UpdateMegidEntityStats_006e9be8) from 12 above its mouth along its heading
// at level constrain_tech_level(MovementData iparam1) (0-based, 0..13,
// Ultimate 0..28): power 27 + 3 L up to L 14, else 42 + 2 L (techPower);
// speed 2 + trunc(L / 5) * 2. Its hit is entity_hit_by_tech's Megid case.
// ASSUMED: it flies straight (its homing, TechniqueEntity_UpdateTargeting
// _006f0798, is not traced) for the technique's range_h.
export function delLilyMegid(x: number, z: number, angle: number, iparam1: number, ultimate: boolean): TechBolt {
  const level = Math.max(0, Math.min(ultimate ? 28 : 13, Math.trunc(iparam1)));
  const d = techData(TECH.megid, level);
  return new TechBolt({
    x,
    y: 12,
    z,
    angle,
    speed: 2 + Math.trunc(level / 5) * 2,
    range: d.rangeH,
    radius: 4,
    effect: { kind: 'megid', power: techPower(TECH.megid, level) },
    color: 0x602080,
  });
}

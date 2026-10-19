// Per-family enemy state machines of Episode 2 (PsoBB.exe, Ephinea 1.25.13,
// addresses are VAs): Merillia / Meriltas and Dolmolm / Dolmdarl. Same
// EnemyBrain shape as combat/enemyfsm.ts, so render/combat.ts drives them the
// same way. The VR Temple / VR Spaceship floors spawn the Episode 1 classes
// (Booma, Hildebear, Grass Assassin, Dimenian, Delsaber, Dark Belra, Chaos
// Sorcerer ...), which already run their own brains.
//
// Both families are built on the Booma substrate: the base constructor
// unknown_booma_superclass_constructor (0x0052b6ec), the generic controller
// update_enemy_control_object (0x00787a80) and the Booma state handlers for
// the states they do not override. The controller, once per frame while the
// enemy is not busy (entity flags 0x600000: an attack sets 0x200000):
//   find_target (vtable +0x78, unknown_booma_enemy_find_target 0x0052b888):
//     every 30 frames (vtable +0x44(0x1e)) the nearest player within the AI
//     record's search radius, kept in between;
//   no target -> vtable +0xf0; a target in reach (+0x80, the AttackData
//   distance_x + collision radius inside its arc) -> +0xf8 (attack); else
//   +0xf4 (chase).
// The dispatcher then runs the state's handler (vtable +0x154 + 4 * state,
// states 10 and up are the family's own). The shared handlers used here:
//   chase (3, unknown_booma_enemy_chase_target 0x0052afe4 and the families'
//     copies): substate 0 plays the war cry (animation 7) to its end, then
//     animation 2 (the gait) and the walk toward the target at enemy+0x39c,
//     turning the record's rate (SorcererProcessProjectileLogic_00772aa0).
//     The speed is MovementData fparam1 / fparam3 and the gait step fparam2 /
//     fparam4 by the guard-stance flag (ClearEnemyHitbox_0052ac5c /
//     RemoveEnemyFromList_0052ad44, as combat/enemyai.ts).
//   melee (5, entered by +0xf8: animation 4 when get_random_float <= 0.5,
//     else 3; the attack flag 0x200000), unknown_enemy_behavior_2 0x0052b5f0:
//     at motion frame 7 try_hit_entity(1.0) + cause_knockback(3.0); when the
//     animation ends animation 0 and 15 frames (0xf), then vtable +0x19c and
//     the flag is cleared.
//   flinch (7, EnemyAI_ProcessState7_0052bc44: animation 6), death (8,
//     set_booma_enemy_killed 0x0052bc74: animation 8): the owner plays them.
// Not reproduced (as in combat/enemyai.ts): the pack linking (state 2 and
// the Derolle subordinate lists), the line-of-sight ray, the idle stroll
// (unknown_enemy_behavior_wanderer) and the 60-frame detour of the chase.
// Sound effects are cited, not played (no FSM plays its SE yet).
//
// The Episode 2 decompilation psobb-client-source (JP build) has no C for
// any of these handlers (checked by their SE ids and constants); everything
// here is the Ephinea dump and Ghidra on the same build.

import { BAMS_TO_RAD, enemySpeeds, farSq, nearSq, type AiFrame, type AiTarget, type EnemyAiMotion, type EnemySpeeds } from './enemyai.ts';
import type { EnemyAttackData, EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase, loop, once, turnToward, wrap } from './enemyfsm.ts';
import { EnemyShot, type ShotEffect, type ShotLook } from './enemyshots.ts';
import { STATUS } from './status.ts';

// ATTACK_HIT_FRAME / knockback / recover of the Booma melee (0x0052b5f0).
export const BOOMA_MELEE = {
  hitFrame: 7,
  knockback: 3,
  mult: 1,
  recover: 0xf,
  retarget: 30,
  // DAT_00927234 / 0x0092720c / 0x00927260: the emergence effect object
  // (vtable 0x00b069b0) InitializeEnemyStateTimer_00576c48 starts: progress
  // -30 * (2 / 10) rising 2 / 10 a frame (ParticleEffectInstance_Update
  // _00576b18) until it reaches 2.0: 40 frames.
  emergeFrames: 40,
} as const;

// The shared Booma-substrate brain: the controller and the chase / melee
// handlers; the families add their states and their +0xf0 / +0xf4 / +0xf8 /
// +0x19c overrides.
abstract class BoomaBrain<S extends string> extends BrainBase {
  abstract state: S | 'dead';
  confused = false;
  hpFraction = 1; // the owner keeps it current
  near = false; // the guard-stance flag
  protected search: number;
  protected turn: number; // radians per frame
  protected reach: number;
  protected arc: number;
  protected radius: number;
  protected speeds: EnemySpeeds;
  protected spawnX: number;
  protected spawnZ: number;
  protected sub = 0; // enemy+0x330
  protected frames = 0; // motion frames of the current animation
  protected wait = 0; // enemy+0x344
  protected busy = false; // entity flag 0x200000 (the controller sleeps)
  protected dealt = false;
  private retarget = 0;
  protected abstract readonly anims: { idle: EnemyAiMotion; walk: EnemyAiMotion; warCry: EnemyAiMotion; attackA: EnemyAiMotion; attackB: EnemyAiMotion };
  protected abstract readonly attackChance: number;

  constructor(opts: { x: number; z: number; angle: number; search: number; turnRate: number; attack: EnemyAttackData | null; movement: EnemyMovementData | null; radius: number; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.spawnX = opts.x;
    this.spawnZ = opts.z;
    this.search = opts.search;
    this.turn = opts.turnRate * BAMS_TO_RAD;
    this.reach = opts.attack?.distanceX ?? 0;
    this.arc = ((opts.attack?.angle ?? 0x2000) & 0xffff) * BAMS_TO_RAD;
    this.radius = opts.radius;
    this.speeds = enemySpeeds(opts.movement, 0.5);
  }

  protected setAnim(out: AiFrame, m: EnemyAiMotion): void {
    this.frames = 0;
    this.play(out, m);
  }

  // The gait at the speed set's animation step.
  protected gait(): EnemyAiMotion {
    const w = this.anims.walk;
    return { index: w.index, speed: w.speed * (this.near ? this.speeds.engagedAnim : this.speeds.idleAnim), loop: true };
  }

  protected moveSpeed(): number {
    return this.near ? this.speeds.engagedMove : this.speeds.idleMove;
  }

  protected updateNear(t: AiTarget): void {
    const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
    if (!this.near) {
      if (d < nearSq(t.charClass)) this.near = true;
    } else if (d > farSq(t.charClass)) this.near = false;
  }

  // vtable +0x80 (0x00777904): the target inside AttackData distance_x plus
  // the collision radius, within the attack arc.
  protected inReach(t: AiTarget): boolean {
    return this.dist(t) <= this.reach + this.radius && Math.abs(wrap(this.angleTo(t) - this.angle)) <= this.arc;
  }

  // unknown_booma_enemy_find_target 0x0052b888: every 30 frames the nearest
  // target within the record's search radius (the owner hands it the other
  // enemies too while it is confused).
  protected findTarget(targets: readonly AiTarget[]): AiTarget | null {
    if (++this.retarget >= BOOMA_MELEE.retarget || this.targetId === null) {
      this.retarget = 0;
      let best: AiTarget | null = null;
      let bestSq = this.search * this.search;
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

  // +0xf8 default branch: the melee (state 5).
  protected startMelee(out: AiFrame, meleeState: S): void {
    this.state = meleeState;
    this.sub = 1;
    this.dealt = false;
    this.busy = true;
    this.setAnim(out, Math.fround(this.rng()) <= this.attackChance ? this.anims.attackB : this.anims.attackA);
  }

  // The chase handler (state 3) body.
  protected chaseFrame(out: AiFrame, t: AiTarget | null, animationEnded: boolean): void {
    if (this.sub === 0) {
      if (animationEnded) {
        this.sub = 1;
        this.setAnim(out, this.gait());
      }
      return;
    }
    if (!t) return;
    this.updateNear(t);
    const g = this.gait();
    if (this.current?.speed !== g.speed) this.play(out, g);
    this.angle = turnToward(this.angle, this.angleTo(t), this.turn);
    if (this.dist(t) > this.reach + this.radius) {
      const v = this.moveSpeed();
      this.x += Math.sin(this.angle) * v;
      this.z += Math.cos(this.angle) * v;
    }
  }

  // The melee handler (state 5) body; true when the 15-frame wait ran out.
  protected meleeFrame(out: AiFrame, t: AiTarget | null, animationEnded: boolean): boolean {
    if (this.sub === 1) {
      if (!this.dealt && this.frames >= BOOMA_MELEE.hitFrame) {
        this.dealt = true;
        if (t && this.inReach(t)) out.hit = { clientId: t.clientId, knockback: BOOMA_MELEE.knockback, mult: BOOMA_MELEE.mult };
      }
      if (animationEnded) {
        this.sub = 2;
        this.wait = BOOMA_MELEE.recover;
        this.setAnim(out, this.anims.idle);
      }
      return false;
    }
    if (this.sub === 2 && --this.wait < 0) {
      this.wait = 0;
      this.busy = false;
      this.sub = 3;
      return true;
    }
    return false;
  }

  // A hit (the owner plays the flinch, row 6, and calls resume() when it
  // ends; the AI does not tick meanwhile).
  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
    this.current = null;
  }
}

// --- Merillia / Meriltas ------------------------------------------------------
//
// Ctor merillia_constructor 0x00575e70 (vtable 0x00b066e0, dispatcher
// 0x005755cc), table 0x009bec00, AI record 0x009beb00 + subtype * 0x1c
// {search 225 / 250, turn 1024}, collision radius 8.0 (0x009beb60 + subtype
// * 0x2c). Subtype = param6 clamped to 0 / 1 (Meriltas). Rows used (motions
// of bm_ene_re8_merill_lia.bml): 0 stand (5, 0.6, loop), 1 wait (6, 0.8,
// loop: under the ground), 2 walk (8, 0.6, loop), 3 atk_a (1, 0.8), 4 atk_b
// (2, 1.0), 5 run (9, 1.0, loop), 6 damage (3, 0.8), 7 wakeup (7, 0.8, the
// war cry), 8 dead (4, 0.6), 10 stand once (5, 0.6), 11 appear (0, 0.5), 12
// kahun (10, 0.7, the pollen), 13 umari (11, 0.6, the burrow).
// SinowberillInitParameters_00576194 and the ctor:
//   +0x3cc = max(param1 - 0.2, 0) the run chance, +0x3d0 = max(param3 - 0.2,
//   0) the pollen chance, +0x3e0 = round(param4) + 300 the run frames,
//   +0x3d8 = max(param5 + 100, 15) the wake-up radius; from MovementData
//   (rows 74 / 75): +0x3dc = fparam6 the run speed (fparam1 when not > 0),
//   +0x3d4 = iparam1 / 100 the HP fraction below which a flinch may run or
//   spread pollen, fparam5 the pollen's power.
// It starts in state 13 with +0x398 (buried) = 1 and the target sentinel
// (find_target keeps no target and sets the flags 0x4040000).
//   13 (0x005756e8): animation 1, the emergence effect (40 frames), then 12.
//   12 (0x00575764): under the ground (invulnerable, 0x4000000): the
//     nearest player within the search radius that is also closer than
//     +0x3d8 wakes it -> 0.
//   0 (0x005743b0): buried: animation 11 (SE 0x20e, invulnerable; SE 0x213
//     at frame 10) to its end, then animation 0, +0x398 = 0; the nearest
//     player becomes the target -> 1.
//   1 (0x00574848): with no target and no wander radius (param2 <= 0) it
//     burrows (ClearEnemyTarget_005751d4 -> 11); else the stroll.
//   11 (0x005757e8): animation 13 (SE 0x213, invulnerable) to its end,
//     +0x398 = 1 -> 12 with animation 1.
//   +0xf0 (0x00575b00, no target): states 3 and 5..10 -> 1 (0 when buried).
//   +0xf4 (0x00575c44): 1 -> 3 with the war cry (animation 7); 5..9 -> 3
//     on the gait; 4 -> animation 5.
//   +0xf8 (0x00575b60): 1 -> 3 with the war cry; 3, 5..9 -> the melee
//     (get_random_float <= 0.5 (0x00926f8c): animation 4, else 3).
//   +0x19c: nothing (the controller picks the next state).
//   flinch (7, 0x0057460c, SE 0x20e): when it ends, HP <= max * +0x3d4 ->
//     MericarolHandleRandomBehavior_0057479c: get_random_float <= +0x3cc ->
//     run (4), else get_random_float <= +0x3d0 -> pollen (10).
//   run (4, 0x00574e38): toward the target at +0x3dc for up to +0x3e0
//     frames or until within fparam1 + radius (the wall ray 30 ahead is not
//     reproduced); then a target within 100 (10000 squared, 0x00926fc4) ->
//     1 with animation 10, else it burrows.
//   pollen (10, 0x005758dc): animation 12; at motion frame 13 the spore
//     cloud (MericarolCreateMegidCloud_005765a8: radius 20, power fparam5,
//     particle 0xd3, SE 0x211); MericarolMegidCloud_SpawnAttack_00576920
//     hits each player in it with entity_hit_by_tech group 0 (power) and
//     group 0x0f (poison); the animation ends -> animation 0, 15 frames,
//     then get_random_float > +0x3cc -> 1, else run (4).
export const MERILLIA = {
  search: [225, 250] as readonly number[],
  turn: 1024,
  radius: 8,
  attackChance: Math.fround(0.5),
  pollenFrame: 13,
  pollenRadius: 20,
  wakeMin: 15,
  wakeExtra: 100,
  chanceBias: Math.fround(-0.2),
  runFramesBase: 300,
  runNearSq: 10000,
  appearSeFrame: 10,
} as const;

const MERILLIA_ANIM = {
  idle: loop(5, 0.6),
  under: loop(6, 0.8),
  walk: loop(8, 0.6),
  attackA: once(1, 0.8),
  attackB: once(2, 1),
  run: loop(9, 1),
  warCry: once(7, 0.8),
  stand: once(5, 0.6),
  appear: once(0, 0.5),
  pollen: once(10, 0.7),
  burrow: once(11, 0.6),
} as const;

// exe states: 13 spawn, 12 under, 0 emerge, 1 idle, 11 burrow, 3 chase, 4
// run, 5 melee, 10 pollen (7, the flinch, is the owner's damage motion).
export type MerilliaState = 'spawn' | 'under' | 'emerge' | 'idle' | 'burrow' | 'chase' | 'run' | 'melee' | 'pollen';

// The spore cloud: one frame, every player within its radius.
export class SporeCloud extends EnemyShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xd0c040, size: 4 };
  private radius: number;

  constructor(x: number, z: number, radius: number, effect: ShotEffect) {
    super(x, 10, z);
    this.radius = radius;
    this.effect = effect;
  }

  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.done = true;
    return this.within(targets, this.radius);
  }
}

export class MerilliaAi extends BoomaBrain<MerilliaState> {
  state: MerilliaState | 'dead' = 'spawn';
  protected readonly anims = MERILLIA_ANIM;
  protected readonly attackChance = MERILLIA.attackChance;
  private buried = true; // +0x398
  private runChance: number;
  private pollenChance: number;
  private runFrames: number;
  private wakeRadius: number;
  private runSpeed: number;
  private lowHp: number;
  private power: number;
  private wander: number;
  private timer = 0;
  private sentinel = true;

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    subtype: number;
    params: readonly number[]; // set entry param1..6
    attack: EnemyAttackData | null;
    movement: EnemyMovementData | null;
    rng?: () => number;
  }) {
    const sub = opts.subtype >= 1 ? 1 : 0;
    super({ ...opts, search: MERILLIA.search[sub], turnRate: MERILLIA.turn, radius: MERILLIA.radius });
    const p = (i: number) => opts.params[i] ?? 0;
    this.runChance = Math.max(Math.fround(p(0) + MERILLIA.chanceBias), 0);
    this.pollenChance = Math.max(Math.fround(p(2) + MERILLIA.chanceBias), 0);
    this.runFrames = Math.round(p(3)) + MERILLIA.runFramesBase;
    this.wakeRadius = Math.max(p(4) + MERILLIA.wakeExtra, MERILLIA.wakeMin);
    this.wander = p(1);
    const mv = opts.movement;
    this.runSpeed = mv && mv.fparam6 > 0 ? mv.fparam6 : (mv?.fparam1 ?? 0.5);
    this.lowHp = (mv?.iparam[0] ?? 0) / 100;
    this.power = mv?.fparam5 ?? 0;
    this.current = MERILLIA_ANIM.under;
  }

  // Flag 0x4000000 (the burrow states).
  get invulnerable(): boolean {
    return this.state === 'spawn' || this.state === 'under' || (this.state === 'burrow' && this.sub >= 1) || (this.state === 'emerge' && this.sub === 1);
  }

  private enter(out: AiFrame, state: MerilliaState, m?: EnemyAiMotion): void {
    this.state = state;
    this.sub = 0;
    this.timer = 0;
    if (m) this.setAnim(out, m);
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.frames += this.current?.speed ?? 0;
    // The controller (0x00787a80) while not busy and not under the ground.
    let t: AiTarget | null = this.sentinel ? null : this.findTarget(targets);
    if (!this.busy) {
      if (!t) this.noTarget(out);
      else if (this.inReach(t)) this.attackDecision(out, t);
      else this.chaseDecision(out);
    }
    switch (this.state) {
      case 'spawn':
        if (this.sub === 0) {
          this.sub = 1;
          this.timer = 0;
          this.setAnim(out, MERILLIA_ANIM.under);
        } else if (++this.timer >= BOOMA_MELEE.emergeFrames) this.enter(out, 'under', MERILLIA_ANIM.under);
        break;
      case 'under': {
        // 0x00575764: its own search, then the wake-up radius.
        let best: AiTarget | null = null;
        let bestSq = this.search * this.search;
        for (const p of targets) {
          if (p.dead) continue;
          const d = (p.x - this.x) ** 2 + (p.z - this.z) ** 2;
          if (d < bestSq) {
            best = p;
            bestSq = d;
          }
        }
        if (best && bestSq < this.wakeRadius * this.wakeRadius) {
          this.sentinel = false;
          this.targetId = best.clientId;
          this.enter(out, 'emerge');
        }
        break;
      }
      case 'emerge':
        if (this.sub === 0) {
          if (this.buried) {
            this.sub = 1;
            this.setAnim(out, MERILLIA_ANIM.appear);
          } else this.sub = 2;
        } else if (this.sub === 1) {
          if (animationEnded) {
            this.sub = 2;
            this.buried = false;
            this.setAnim(out, MERILLIA_ANIM.idle);
          }
        } else {
          t = this.findTarget(targets);
          this.enter(out, 'idle');
        }
        break;
      case 'idle':
        if (!t && this.wander <= 0) {
          this.targetId = null;
          this.enter(out, 'burrow');
        }
        break;
      case 'burrow':
        if (this.sub === 0) {
          if (this.buried) this.sub = 2;
          else {
            this.sub = 1;
            this.setAnim(out, MERILLIA_ANIM.burrow);
          }
        } else if (this.sub === 1) {
          if (animationEnded) {
            this.buried = true;
            this.sub = 2;
          }
        } else this.enter(out, 'under', MERILLIA_ANIM.under);
        break;
      case 'chase':
        this.chaseFrame(out, t, animationEnded);
        break;
      case 'melee':
        this.meleeFrame(out, t, animationEnded);
        break;
      case 'run':
        this.runFrame(out, t);
        break;
      case 'pollen':
        this.pollenFrame(out, animationEnded);
        break;
    }
    return this.finish(out);
  }

  // +0xf0 (0x00575b00).
  private noTarget(out: AiFrame): void {
    const s = this.state;
    if (s === 'chase' || s === 'melee' || s === 'pollen') this.enter(out, this.buried ? 'emerge' : 'idle');
  }

  // +0xf4 (0x00575c44).
  private chaseDecision(out: AiFrame): void {
    if (this.state === 'idle') {
      this.enter(out, 'chase', MERILLIA_ANIM.warCry);
    } else if (this.state === 'run') {
      if (this.current !== MERILLIA_ANIM.run) this.play(out, MERILLIA_ANIM.run);
    } else if (this.state === 'melee') {
      this.enter(out, 'chase');
      this.sub = 1;
      this.setAnim(out, this.gait());
    }
  }

  // +0xf8 (0x00575b60).
  private attackDecision(out: AiFrame, t: AiTarget): void {
    if (this.state === 'idle') this.enter(out, 'chase', MERILLIA_ANIM.warCry);
    else if (this.state === 'chase' || this.state === 'melee') {
      this.angle = turnToward(this.angle, this.angleTo(t), this.turn);
      this.startMelee(out, 'melee');
    }
  }

  // 0x00574e38.
  private runFrame(out: AiFrame, t: AiTarget | null): void {
    if (this.sub === 0) {
      this.sub = 1;
      this.timer = this.runFrames;
      this.play(out, MERILLIA_ANIM.run);
      return;
    }
    if (this.sub === 1) {
      if (!t) {
        this.targetId = null;
        this.enter(out, 'burrow');
        return;
      }
      this.angle = turnToward(this.angle, this.angleTo(t), this.turn);
      this.x += Math.sin(this.angle) * this.runSpeed;
      this.z += Math.cos(this.angle) * this.runSpeed;
      const stop = this.speeds.idleMove + this.radius;
      if (this.dist(t) ** 2 < stop * stop || --this.timer < 0) this.sub = 2;
      return;
    }
    if (t && this.dist(t) ** 2 < MERILLIA.runNearSq) this.enter(out, 'idle', MERILLIA_ANIM.stand);
    else {
      this.targetId = null;
      this.enter(out, 'burrow');
    }
  }

  // 0x005758dc.
  private pollenFrame(out: AiFrame, animationEnded: boolean): void {
    if (this.sub === 0) {
      this.sub = 1;
      this.dealt = false;
      this.busy = true;
      this.setAnim(out, MERILLIA_ANIM.pollen);
      return;
    }
    if (this.sub === 1) {
      if (!this.dealt && this.frames >= MERILLIA.pollenFrame) {
        this.dealt = true;
        // ASSUMED: the cloud sits on the Merillia (the exe takes the
        // position of a model node, matrix pool slot 0x5c0).
        out.shots = [
          new SporeCloud(this.x, this.z, MERILLIA.pollenRadius, { kind: 'tech', power: this.power }),
          new SporeCloud(this.x, this.z, MERILLIA.pollenRadius, { kind: 'status', status: STATUS.poison }),
        ];
      }
      if (animationEnded) {
        this.sub = 2;
        this.wait = BOOMA_MELEE.recover;
        this.setAnim(out, MERILLIA_ANIM.idle);
      }
      return;
    }
    if (--this.wait < 0) {
      this.busy = false;
      if (Math.fround(this.rng()) > this.runChance) this.enter(out, 'idle');
      else this.enter(out, 'run');
    }
  }

  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    super.onDamage(clientId);
    this.sentinel = false;
  }

  // The flinch ended (0x0057460c).
  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    if (this.hpFraction <= this.lowHp) {
      if (Math.fround(this.rng()) <= this.runChance) {
        this.enter(out, 'run');
        return this.state;
      }
      if (Math.fround(this.rng()) <= this.pollenChance) {
        // MericarolSetState10_005747d8 sets the attack flag at once.
        this.enter(out, 'pollen');
        this.busy = true;
        return this.state;
      }
    }
    // The controller's default branches: back to the chase on the gait.
    this.busy = false;
    this.enter(out, 'chase');
    this.sub = 1;
    this.setAnim(out, this.gait());
    return this.state;
  }
}

// --- Dolmolm / Dolmdarl ---------------------------------------------------------
//
// Ctor 0x00553c7c (vtable 0x00b04480, dispatcher 0x005528d8), init
// 0x00553fc8, table 0x009bd9c0, AI record 0x009bdb1c + subtype * 0x1c
// {search 225 / 300, turn 1024}, collision radius 8.0 (0x009bd960). Subtype
// (+0x370) = 1 (Dolmdarl) when param6 >= 1. Rows (bm_ene_abgc01_wola_body.bml):
// 0 wait (5, 0.8, loop), 1 wait2 (6, 0.6), 2 walk (8, 0.8, loop), 3 atack_l
// (0, 0.8), 4 atack_r (1, 0.8), 6 damage (2, 0.8), 7 wake (7, 0.8, the war
// cry), 8 dead (3, 0.7), 12 odori (4, 0.8, the dance).
// +0x3d4 = param3 + 0.3 (0x0092491c) the back-step chance, +0x3d8 = param4
// + 0.3 the dance chance. MovementData rows 78 / 79: fparam5 the dance
// range, iparam1 its arc (BAMS), iparam2 the hold in seconds.
//   0 (0x00552704): with a target the emergence effect (40 frames, the
//     beast SE / particle), then the target is dropped -> 1.
//   +0xf0 (0x0055373c): states other than 0, 1 and 10 -> 0.
//   +0xf4 (0x005537e8): 1 -> 3 with the war cry; 5..9 -> 3 on the gait.
//   +0xf8 (0x005538cc): 1 -> 3 with the war cry; 3..9: a target within
//     fparam5 and get_random_float < +0x3d8 -> the dance (11); else, the
//     height difference under 20 (0x00924968), the melee (get_random_float
//     <= 0.5 (0x0092492c): animation 4, else 3).
//   +0x19c (0x0055281c, after the melee): get_random_float < +0x3d4 -> the
//     back step (10).
//   back step (10, 0x00553084, SE 0x25a): animation 2 at twice its step,
//     backwards (heading + 0x8000) at enemy+0x39c * 4 (0x0092495c) a frame
//     while it turns to face the target, until 50 units (0x00924958) or the
//     target is out of reach -> 3.
//   dance (11, 0x00552c04): a target already held -> the melee (|dy| < 20)
//     or the chase; else it turns to face it; inside iparam1 animation 12
//     (SE 0x259, particle 0x20e); every frame a target in the arc and within
//     fparam5 gets HandleHardAttackAction_0069375c(iparam2 * 30 frames,
//     particle 2) (6x2C, the hold); at the animation's end -> 3.
export const DOLMOLM = {
  search: [225, 300] as readonly number[],
  turn: 1024,
  radius: 8,
  attackChance: Math.fround(0.5),
  chanceBias: Math.fround(0.3),
  backStepScale: 4,
  backStepAnim: 2,
  backStepLength: 50,
  holdParticle: 2,
} as const;

const DOLMOLM_ANIM = {
  idle: loop(5, 0.8),
  walk: loop(8, 0.8),
  attackA: once(0, 0.8),
  attackB: once(1, 0.8),
  warCry: once(7, 0.8),
  dance: once(4, 0.8),
} as const;

// exe states: 0 emerge, 1 idle, 3 chase, 5 melee, 10 back step, 11 dance (7,
// the flinch, is the owner's damage motion).
export type DolmolmState = 'emerge' | 'idle' | 'chase' | 'melee' | 'backstep' | 'dance';

export class DolmolmAi extends BoomaBrain<DolmolmState> {
  state: DolmolmState | 'dead' = 'emerge';
  protected readonly anims = DOLMOLM_ANIM;
  protected readonly attackChance = DOLMOLM.attackChance;
  private backChance: number;
  private danceChance: number;
  private danceRange: number;
  private danceArc: number;
  private holdFrames: number;
  private timer = 0;
  private travelled = 0;
  private held = new Map<number, number>(); // clientId -> frames of hold left

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    subtype: number;
    params: readonly number[];
    attack: EnemyAttackData | null;
    movement: EnemyMovementData | null;
    rng?: () => number;
  }) {
    const sub = opts.subtype >= 1 ? 1 : 0;
    super({ ...opts, search: DOLMOLM.search[sub], turnRate: DOLMOLM.turn, radius: DOLMOLM.radius });
    const p = (i: number) => opts.params[i] ?? 0;
    this.backChance = Math.fround(p(2) + DOLMOLM.chanceBias);
    this.danceChance = Math.fround(p(3) + DOLMOLM.chanceBias);
    const mv = opts.movement;
    this.danceRange = mv?.fparam5 ?? 0;
    this.danceArc = (mv?.iparam[0] ?? 0) * BAMS_TO_RAD;
    this.holdFrames = (mv?.iparam[1] ?? 0) * 30;
    this.current = DOLMOLM_ANIM.idle;
  }

  private enter(out: AiFrame, state: DolmolmState, m?: EnemyAiMotion): void {
    this.state = state;
    this.sub = 0;
    this.timer = 0;
    if (m) this.setAnim(out, m);
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    if (this.state === 'dead') return out;
    this.frames += this.current?.speed ?? 0;
    for (const [id, n] of this.held) {
      if (n <= 1) this.held.delete(id);
      else this.held.set(id, n - 1);
    }
    const t = this.findTarget(targets);
    if (!this.busy) {
      if (!t) {
        // +0xf0 (an idle one goes to 0 too and straight back: left out).
        if (this.state !== 'emerge' && this.state !== 'idle' && this.state !== 'backstep') this.enter(out, 'emerge', DOLMOLM_ANIM.idle);
      } else if (this.inReach(t)) this.attackDecision(out, t);
      else if (this.state === 'idle') this.enter(out, 'chase', DOLMOLM_ANIM.warCry);
      else if (this.state === 'emerge' || this.state === 'melee') {
        // +0xf4's default branch (state 0 falls into it too).
        this.enter(out, 'chase');
        this.sub = 1;
        this.setAnim(out, this.gait());
      }
    }
    switch (this.state) {
      case 'emerge':
        if (this.sub === 0) {
          if (t) {
            this.sub = 1;
            this.timer = 0;
          } else this.sub = 2;
        } else if (this.sub === 1) {
          if (++this.timer >= BOOMA_MELEE.emergeFrames) {
            this.targetId = null;
            this.sub = 2;
          }
        } else this.enter(out, 'idle');
        break;
      case 'chase':
        this.chaseFrame(out, t, animationEnded);
        break;
      case 'melee':
        if (this.meleeFrame(out, t, animationEnded) && Math.fround(this.rng()) < this.backChance) this.enter(out, 'backstep');
        break;
      case 'backstep':
        this.backStepFrame(out, t);
        break;
      case 'dance':
        this.danceFrame(out, t, animationEnded);
        break;
      case 'idle':
        break;
    }
    return this.finish(out);
  }

  // +0xf8 (0x005538cc). ASSUMED flat ground: the height test always passes.
  private attackDecision(out: AiFrame, t: AiTarget): void {
    if (this.state === 'idle') {
      this.enter(out, 'chase', DOLMOLM_ANIM.warCry);
      return;
    }
    if (this.state !== 'chase' && this.state !== 'melee') return;
    if (this.dist(t) < this.danceRange && Math.fround(this.rng()) < this.danceChance) {
      this.enter(out, 'dance');
      this.busy = true;
      return;
    }
    this.startMelee(out, 'melee');
  }

  // 0x00553084.
  private backStepFrame(out: AiFrame, t: AiTarget | null): void {
    if (this.sub === 0) {
      this.sub = 1;
      this.travelled = 0;
      const w = this.gait();
      this.setAnim(out, { ...w, speed: w.speed * DOLMOLM.backStepAnim });
      return;
    }
    if (this.sub === 2 || !t) {
      this.enter(out, 'chase');
      this.sub = 1;
      this.setAnim(out, this.gait());
      return;
    }
    const step = this.moveSpeed() * DOLMOLM.backStepScale;
    const back = this.angle + Math.PI;
    this.x += Math.sin(back) * step;
    this.z += Math.cos(back) * step;
    this.angle = turnToward(this.angle, this.angleTo(t), this.turn);
    this.travelled += step;
    if (this.travelled >= DOLMOLM.backStepLength || this.dist(t) > this.reach + 5) this.sub = 2; // ASSUMED player hit box radius 5
  }

  // 0x00552c04.
  private danceFrame(out: AiFrame, t: AiTarget | null, animationEnded: boolean): void {
    const end = (): void => {
      this.busy = false;
      this.enter(out, 'chase');
      this.sub = 1;
      this.setAnim(out, this.gait());
    };
    if (this.sub === 0) {
      if (!t) end();
      else if (this.held.has(t.clientId)) {
        this.busy = false;
        this.startMelee(out, 'melee');
      } else this.sub = 1;
      return;
    }
    if (this.sub === 1) {
      if (!t) {
        end();
        return;
      }
      this.angle = turnToward(this.angle, this.angleTo(t), this.turn);
      if (Math.abs(wrap(this.angleTo(t) - this.angle)) < this.danceArc) {
        this.sub = 3;
        this.setAnim(out, DOLMOLM_ANIM.dance);
      }
      return;
    }
    // ASSUMED: one 6x2C per dance (the exe re-imposes it every frame the
    // player stays in the arc, which only refreshes the same hold).
    if (t && !this.held.has(t.clientId) && Math.abs(wrap(this.angleTo(t) - this.angle)) < this.danceArc && this.dist(t) < this.danceRange) {
      this.held.set(t.clientId, this.holdFrames);
      out.hold = { clientId: t.clientId, frames: this.holdFrames, particle: DOLMOLM.holdParticle, x: t.x, z: t.z, radius2: 0 };
    }
    if (animationEnded) end();
  }

  // The flinch ended: the controller's default branch back to the chase.
  resume(): string {
    if (this.state === 'dead') return this.state;
    const out = this.frame();
    this.busy = false;
    this.enter(out, 'chase');
    this.sub = 1;
    this.setAnim(out, this.gait());
    return this.state;
  }
}

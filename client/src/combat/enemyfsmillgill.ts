// Ill Gill (TObjEneIllGill, Episode 2 Control Tower and Episode 4 entries; PsoBB.exe,
// Ephinea 1.25.13, addresses are VAs). Same EnemyBrain shape as combat/enemyfsm.ts, so
// render/combat.ts drives it the same way (OWN_FSM).
//
// Structure (PROVEN from the exe): the factory 0x0052e380 calls the ctor 0x0052e44c, which
// writes the vtable 0x00b01760 at 0x0052e490. +0x4 is the update 0x0052e7c0: a switch on
// unknown_ai_state (+0x32e, a jump table at 0x0092248c) over the handlers
//   0 0x00530554 (spawn / wait), 1 0x0053044c (advance), 2 0x005301f0 (chase), 3 0x0052fb78
//   (scythe), 4 0x0052f18c (tackle / charge), 5 0x0052ebc0 (shadow snare), 6 0x0052eb3c (idle),
//   7 0x0052ea00 (damage), 8 0x0052e898 (dying, the death sequence: combat/deathfx.ts);
// every state then runs the common tail (0x00770738 target, the lock-on, the reticle).
// The sub-state (+0x330) is the handler's own phase. The attack choice (vtable +0x80,
// 0x00530cc4) fills +0x39c and unknown_illgill_determine_scythe_or_charge_state maps it to the
// state: 0 / 1 -> scythe (3), 2 -> snare (5), 3 -> tackle (4). The four AttackData rows are
// g_illgill_battle_attack_stats (+0x0), 0x0C (Attack1, ice), 0x10 (Attack2, snare), 0x14
// (Attack3, tackle): attacks[0..3] here, in that order.
//
// Radar (PROVEN, objdump): the minimap icon call 0x00805608 (scale 1, colour 0xffffa24c) is on
// the tail of states 0 to 3, 5, 6 and 7 unconditionally, and in state 4 only with a target (its
// no-target path returns at 0x0052fb75 before the call). State 8 has no icon. See `radar`.
//
// Resolved from the exe (this pass, Ephinea 1.25.13 dump + objdump):
//   the scythe's variant (0x0052fb78 sub 0): roll 1 > 0.35 (0x0092259c), then roll 2 <= 0.5
//   (0x00922598) gives thunder, else ice; roll 1 <= 0.35 gives the instant kill. The power of the
//   specials is the movement row's iparam (the battle params row 38, fparam1 / iparam1 / iparam2
//   at +0x00 / +0x18 / +0x1c): iparam1 for ice and thunder, iparam2 for the insta-kill. The
//   effects run on the player in its special handler (FUN_007753b4, the player's vtable +0x64):
//   ice = freeze roll only (no damage), thunder = its damage then the shock roll, insta-kill =
//   the kill roll then the attack's normal hit. See render/combat.ts (illGillSpecial).
//   The snare (sub 2): the target in the arc gets the 6x2C hold of 180 frames (flag object
//   0x0052f110, +0x94 = 0xb4), particle 3, at the target's spot; then sub 4 recovers 10 frames.
//   The scythe recovers 30 frames (sub 3) and its hit frame is 30 or 35 (fild of +0x3ac).
//
// ASSUMED (not traced): the transitions into and out of the states other than the attack
// selection, the walk and turn speeds (the port's MovementData fparam1 and turn 1024 BAMS from the
// record 0x009bc4cc), the windup and recovery counts of the tackle (its counters are written by a
// fistp of the animation frame count, not traced), the spawn and advance durations (the spawn
// waits on the state timer 0x00576c48, not traced), and the player's EIC / ETH / EDK (the local
// player's resists, combat/playerresist.ts, read in render/combat.ts illGillSpecial).

import { BAMS_TO_RAD, type AiFrame, type AiTarget, type EnemyAiMotion, type IllGillSpecial } from './enemyai.ts';
import type { EnemyAttackData, EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase, PLAYER_RADIUS, loop, nearest, once, turnToward } from './enemyfsm.ts';

// Animation slots (table 0x009bc3e0, mode / next / motion / speed). The motion index is the
// archive's motion entry (the enemymodels.ts order: wait, walk, kamae, tackle, lattack, rattack,
// damage, prekamae, kage, dead).
export const ILL_GILL_ANIM = {
  wait: loop(0, 0.6), // slot 0 (mode 1, loop)
  walk: loop(1, 0.8), // slot 1 (mode 1, loop)
  lattack: once(4, 1), // slot 2: the ice and thunder swings
  rattack: once(5, 1), // slot 3: the instant-kill swing
  kage: once(8, 1), // slot 4: the shadow of the snare
  damage: once(6, 1), // slot 5
  dead: once(9, 1), // slot 6 (mode 3: held)
  prekamae: once(7, 1), // slot 7
  kamae: once(2, 1), // slot 8: the tackle's stance (mode 3, chains to the tackle)
  tackle: once(3, 1), // slot 9: the dash
} as const satisfies Record<string, EnemyAiMotion>;

// The constants read from the exe (addresses in the comments; floats via tools/exedata.py).
export const ILL_GILL = {
  // 0x009bc4cc float 400.0 (the Alignment record): the target is dropped beyond it (state 2).
  sight: 400,
  // 0x009bc4d4 int 1024 (BAMS): the turn rate of the chase and the attacks.
  turn: 1024 * BAMS_TO_RAD,
  // 0x00922540 float -1.0 + the target's radius; 0x00922544 float 10.0 with no hitbox.
  reachBase: -1,
  reachNoBox: 10,
  // 0x0092259c 0.35 / 0x00922598 0.5: the scythe's variant roll (state 3 sub 0): roll 1 above
  // 0.35 is an ice / thunder swing (roll 2 at most 0.5 is thunder), else the insta-kill.
  scytheInstantBelow: 0.35,
  scytheThunderBelow: 0.5,
  // Hit frames (motion frames): 30 (ice, thunder) and 35 (instant kill), the counts stored in
  // +0x3a4-style fields as 4.2039e-44 (30) and 4.90454e-44 (35).
  scytheHit: 30,
  scytheHitInstant: 35,
  scytheRecover: 30, // 4.2039e-44 (30) in sub 2 (ASSUMED as the recovery count)
  // Tackle (state 4): the dash speed is the walk speed times 4.5 (0x009225b4), its knockback
  // 2.0 (0x009225b8), the dash ends after 120 frames (0x009225bc), in reach at the distance
  // of speed + radius, and gives up beyond the sight range (ASSUMED reach).
  dashSpeed: 4.5,
  dashKnockback: 2,
  dashFrames: 120,
  windup: 30, // ASSUMED: the count of sub 1 (the exe's +0x3a4-style counter, anim speed row 0)
  recover: 30, // ASSUMED: the count of sub 4
  // Shadow (state 5): the sub 1 wait (check_entity_animation_elapsed_threshold 10.0).
  snareWait: 10,
  // Sub 2 imposes the web's hold on the target: the flag object's +0x94 = 0xb4 (180 frames),
  // particle 3 (the arg of HandleHardAttackAction_0069375c), then sub 4 recovers for 10 frames
  // (the float 1.4013e-44 is the int 10 in the frame counter +0x3a4).
  snareHold: 180,
  snareParticle: 3,
  snareRecover: 10,
  // Sub 0 of the snare / scythe and the chase turn towards a target within the attack's
  // max_y_angle (attacks[n].angle, out of 0x10000).
} as const;

// integer_angle_abs_difference on BAMS.
const toBams = (rad: number): number => ((Math.round(rad / BAMS_TO_RAD) % 0x10000) + 0x10000) % 0x10000;
const bamsDiff = (a: number, b: number): number => {
  const d = (a - b) & 0xffff;
  return d > 0x8000 ? 0x10000 - d : d;
};
const sq = (v: number): number => v * v;

// Sub-states of the attack handlers, named for the handler's phase.
type Sub = number;

export type IllGillState = 'spawn' | 'advance' | 'chase' | 'scythe' | 'tackle' | 'snare' | 'idle' | 'damage' | 'dead';

// The exe's state numbers (+0x32e) of the port's names.
export const ILL_GILL_STATE_NUMBER: Record<IllGillState, number> = {
  spawn: 0,
  advance: 1,
  chase: 2,
  scythe: 3,
  tackle: 4,
  snare: 5,
  idle: 6,
  damage: 7,
  dead: 8,
};

export class IllGillAi extends BrainBase {
  state: IllGillState = 'spawn';
  // Read by the owner: the hit points as a fraction (the escape check of the damage state).
  health: (() => number) | null = null;
  // The Ill Gill's attacks (AttackData rows 0..3: scythe, ice, snare, tackle). The port's
  // rows; the exe's max_x_distance is distanceX and max_y_angle is angle (out of 0x10000).
  private readonly attacks: readonly EnemyAttackData[];
  private readonly speed: number; // ASSUMED: MovementData fparam1 (the walk / chase speed)
  private readonly radius = PLAYER_RADIUS;
  private sub: Sub = 0; // +0x330
  private count = 0; // the frame counters (+0x3a0 variant, +0x3a4, +0x398 timers)
  private elapsed = 0; // frames since the motion started (check_entity_animation_elapsed)
  private variant = 0; // +0x3a0: 1 ice, 2 thunder, 3 instant kill (the scythe)
  private hitFrame = 0; // the scythe's hit frame (30 or 35)
  private hitDone = false; // the scythe's hit (last_footstep_effect_z)
  private tackleHits = new Set<number>(); // +0x3e8..0x3f4: the dash's hit targets
  private dashFrames = 0; // the dash's frame count (state 4 sub 2)
  private homeX: number;
  private homeZ: number;
  private escaped = false; // flag 0x2000 (the escape below a quarter of its HP)
  // The scythe's specials: the movement row's iparam1 (ice / thunder power) and iparam2 (insta-kill
  // power), read as shorts (g_illgill_anim_speeds + 0x18 / + 0x1c).
  private readonly icePower: number;
  private readonly killPower: number;
  // The enemy's level (the thunder damage's attacker level); set by the owner from the stats row.
  level = 0;

  constructor(opts: { x: number; z: number; angle: number; movement: EnemyMovementData | null; attacks: readonly EnemyAttackData[]; rng?: () => number }) {
    super(opts.x, opts.z, opts.angle, opts.rng ?? Math.random);
    this.attacks = opts.attacks.length >= 4 ? opts.attacks : [...opts.attacks, ...Array(4 - opts.attacks.length).fill(null)];
    const f = opts.movement?.fparam1 ?? 0;
    this.speed = f > 0 ? f : 1; // ASSUMED fallback
    const ip = opts.movement?.iparam ?? [];
    this.icePower = ((ip[0] ?? 0) << 16) >> 16;
    this.killPower = ((ip[1] ?? 0) << 16) >> 16;
    this.homeX = opts.x;
    this.homeZ = opts.z;
    this.current = ILL_GILL_ANIM.wait;
  }

  // The weapon special of the scythe's variant (IllgillHandleCombatState_0052fb78 sub 2): 1 ice,
  // 2 thunder, 3 insta-kill.
  private scytheSpecial(): IllGillSpecial | null {
    if (this.variant === 1) return { kind: 'freeze', power: this.icePower, level: this.level };
    if (this.variant === 2) return { kind: 'shock', power: this.icePower, level: this.level };
    if (this.variant === 3) return { kind: 'kill', power: this.killPower, level: this.level };
    return null;
  }

  // The minimap icon (0x00805608) of the state's tail. States 0 to 3, 5, 6 and 7 always; state 4
  // only with a target; state 8 (dying) and the dead one never. The owner also hides a dead one.
  get radar(): boolean {
    if (this.state === 'dead') return false;
    if (this.state === 'tackle') return this.targetId !== null;
    return true;
  }

  private attackOf(i: number): EnemyAttackData {
    return this.attacks[i] ?? { minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX: 0, angle: 0, distanceY: 0 };
  }

  // The attack choice (IllgillCheckAttackValidity_00530cc4): the first row (0..3) whose reach
  // (base + distanceX) and arc (angle) the target is in. The base is radius - 1 for a target with
  // hit boxes (0x00922540), 10 without (0x00922544); the port's targets have the radius.
  chooseAttack(t: AiTarget): number | null {
    const d2 = sq(t.x - this.x) + sq(t.z - this.z);
    const diff = bamsDiff(toBams(this.angle), toBams(Math.atan2(t.x - this.x, t.z - this.z)));
    const base = ILL_GILL.reachBase + this.radius;
    for (let i = 0; i < 4; i++) {
      const a = this.attackOf(i);
      const reach = base + a.distanceX;
      if (d2 <= sq(reach) && diff <= a.angle) return i;
    }
    return null;
  }

  // The state change of unknown_illgill_determine_scythe_or_charge_state (0x00531024).
  private enterAttack(row: number): void {
    this.sub = 0;
    this.elapsed = 0;
    if (row === 2) {
      this.state = 'snare';
    } else if (row === 3) {
      this.state = 'tackle';
      this.tackleHits.clear();
      this.count = 0;
    } else {
      this.state = 'scythe';
    }
  }

  private setMotion(out: AiFrame, m: EnemyAiMotion): void {
    this.play(out, m);
    this.elapsed = 0;
  }

  private turnTo(t: AiTarget): void {
    const want = Math.atan2(t.x - this.x, t.z - this.z);
    this.angle = turnToward(this.angle, want, ILL_GILL.turn);
  }

  private faces(t: AiTarget, row: number): boolean {
    const want = Math.atan2(t.x - this.x, t.z - this.z);
    return bamsDiff(toBams(this.angle), toBams(want)) < this.attackOf(row).angle;
  }

  private stepToward(t: AiTarget, step: number): void {
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d > 0) {
      this.x += (dx / d) * Math.min(step, d);
      this.z += (dz / d) * Math.min(step, d);
    }
  }

  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out = this.frame();
    this.elapsed++;
    let t = this.target(targets);
    // ASSUMED: the chase takes the nearest live player within the sight range each frame while it
    // has none (the exe's target search and its interval are not traced for this class).
    if (!t && this.state === 'chase') {
      const n = nearest(targets, this.x, this.z, ILL_GILL.sight);
      if (n) {
        this.targetId = n.clientId;
        t = n;
      }
    }
    if (this.state === 'dead') return this.finish(out);
    if (this.state === 'damage') {
      this.tickDamage(out, t, animationEnded);
      return this.finish(out);
    }
    if (this.state === 'spawn') {
      // ASSUMED: the spawn wait lasts one frame (the exe's timer length is not traced).
      this.state = 'advance';
      this.setMotion(out, ILL_GILL_ANIM.wait);
      return this.finish(out);
    }
    if (this.state === 'advance') {
      // The exe's advance state (0x0053044c): ASSUMED to walk on to the chase.
      this.state = 'chase';
      this.sub = 0;
      this.setMotion(out, ILL_GILL_ANIM.walk);
      return this.finish(out);
    }
    if (this.state === 'idle') {
      // State 6: the counter-run idle. Its entry is not traced (ASSUMED), so it only holds still.
      this.setMotion(out, ILL_GILL_ANIM.wait);
      return this.finish(out);
    }
    if (this.state === 'chase') return this.tickChase(out, t);
    if (this.state === 'scythe') return this.tickScythe(out, t, animationEnded);
    if (this.state === 'snare') return this.tickSnare(out, t, animationEnded);
    if (this.state === 'tackle') return this.tickTackle(out, t);
    return this.finish(out);
  }

  // State 2 (0x005301f0). Sub 0 turns towards the target (the exe's SorcererProcess... logic,
  // ASSUMED to stay in place); sub 2 walks at the speed until within reach; the target is
  // dropped beyond the sight range (400) and the attack is chosen while in reach (ASSUMED
  // timing: every chase frame).
  private tickChase(out: AiFrame, t: AiTarget | null): AiFrame {
    if (!t) {
      this.sub = 0;
      this.setMotion(out, ILL_GILL_ANIM.wait);
      return this.finish(out);
    }
    if (sq(t.x - this.x) + sq(t.z - this.z) > sq(ILL_GILL.sight)) {
      this.targetId = null;
      this.setMotion(out, ILL_GILL_ANIM.wait);
      return this.finish(out);
    }
    const row = this.chooseAttack(t);
    if (row !== null) {
      this.enterAttack(row);
      this.tickAttackStart(out, t);
      return this.finish(out);
    }
    if (this.sub === 0) {
      this.turnTo(t);
      if (this.faces(t, 0)) this.sub = 2;
      this.setMotion(out, ILL_GILL_ANIM.wait);
    } else {
      this.turnTo(t);
      this.stepToward(t, this.speed);
      this.setMotion(out, ILL_GILL_ANIM.walk);
    }
    return this.finish(out);
  }

  // The first frame of an attack: each state's sub 0 (scythe 0x0052fb78, tackle 0x0052f18c,
  // snare 0x0052ebc0).
  private tickAttackStart(out: AiFrame, t: AiTarget): void {
    if (this.state === 'snare') {
      this.sub = 0;
      this.setMotion(out, ILL_GILL_ANIM.wait);
    } else if (this.state === 'tackle') {
      this.sub = 0;
      this.setMotion(out, ILL_GILL_ANIM.wait);
      this.turnTo(t);
    } else {
      this.sub = 0;
      this.setMotion(out, ILL_GILL_ANIM.wait);
    }
  }

  // State 3 (0x0052fb78), the scythe. Sub 0 turns to the target; once the facing is within the
  // attack's arc the variant is rolled (0x00922598 / 0x0092259c): 1 ice, 2 thunder, else instant
  // kill, then the swing (the lattack for ice / thunder, the rattack for the instant kill).
  // Sub 2 hits at the hit frame (30 or 35) once; sub 3 recovers 30 frames and returns to chase.
  private tickScythe(out: AiFrame, t: AiTarget | null, animationEnded: boolean): AiFrame {
    if (this.sub === 0) {
      if (!t) {
        this.state = 'chase';
        this.sub = 0;
        this.setMotion(out, ILL_GILL_ANIM.wait);
        return this.finish(out);
      }
      this.turnTo(t);
      if (this.faces(t, 0)) {
        // Two rolls (0x0052fb78): the first above 0.35 then the second at most 0.5 is thunder.
        const first = this.rng();
        this.variant = first > ILL_GILL.scytheInstantBelow ? (this.rng() <= ILL_GILL.scytheThunderBelow ? 2 : 1) : 3;
        this.hitFrame = this.variant === 3 ? ILL_GILL.scytheHitInstant : ILL_GILL.scytheHit;
        this.hitDone = false;
        this.sub = 2;
        this.setMotion(out, this.variant === 3 ? ILL_GILL_ANIM.rattack : ILL_GILL_ANIM.lattack);
      } else {
        this.setMotion(out, ILL_GILL_ANIM.wait);
      }
      return this.finish(out);
    }
    if (this.sub === 2) {
      if (!this.hitDone && this.elapsed >= this.hitFrame) {
        this.hitDone = true;
        if (t && this.reachHit(t, 0)) out.hit = { clientId: t.clientId, knockback: 0, mult: 1, kbScale: 1, special: this.scytheSpecial() };
      }
      if (animationEnded) {
        this.sub = 3;
        this.count = ILL_GILL.scytheRecover;
        this.setMotion(out, ILL_GILL_ANIM.wait);
      }
      return this.finish(out);
    }
    // Sub 3: the recovery, then back to the chase (IllgillHandleAttackCompletion_00530f58).
    this.count--;
    if (this.count < 0) {
      this.state = 'chase';
      this.sub = 0;
      this.setMotion(out, ILL_GILL_ANIM.walk);
    }
    return this.finish(out);
  }

  // Reach of a melee row for a target (the hit test of the swing).
  private reachHit(t: AiTarget, row: number): boolean {
    const reach = this.attackOf(row).distanceX + this.radius;
    return sq(t.x - this.x) + sq(t.z - this.z) < sq(reach);
  }

  // State 5 (0x0052ebc0), the shadow snare. Sub 0 turns to the target and, within the arc of
  // attack 2, shows the shadow (kage) and goes to sub 1; sub 1 waits 10 frames then sub 2 (the
  // snare); sub 2 takes the target into the snare (the hold of 180 frames, when it is in the arc)
  // and sub 4 returns to the chase after the 10-frame recovery (exe: the 1.4013e-44 counter).
  private tickSnare(out: AiFrame, t: AiTarget | null, animationEnded: boolean): AiFrame {
    void animationEnded;
    if (!t) {
      this.state = 'chase';
      this.sub = 0;
      this.setMotion(out, ILL_GILL_ANIM.wait);
      return this.finish(out);
    }
    if (this.sub === 0) {
      this.turnTo(t);
      if (this.faces(t, 2)) {
        this.sub = 1;
        this.setMotion(out, ILL_GILL_ANIM.kage);
      } else {
        this.setMotion(out, ILL_GILL_ANIM.wait);
      }
    } else if (this.sub === 1) {
      this.turnTo(t);
      if (this.elapsed >= ILL_GILL.snareWait) {
        this.sub = 2;
        this.setMotion(out, ILL_GILL_ANIM.kage);
      }
    } else if (this.sub === 2) {
      this.turnTo(t);
      // The web: a target still in the arc gets the 180-frame hold (the 6x2C of the flag object).
      if (this.faces(t, 2)) {
        out.hold = { clientId: t.clientId, frames: ILL_GILL.snareHold, particle: ILL_GILL.snareParticle, x: t.x, z: t.z, radius2: 0 };
      }
      this.sub = 4;
      this.count = ILL_GILL.snareRecover;
      this.setMotion(out, ILL_GILL_ANIM.wait);
    } else {
      this.count--;
      if (this.count < 0) {
        this.state = 'chase';
        this.sub = 0;
        this.setMotion(out, ILL_GILL_ANIM.walk);
      }
    }
    return this.finish(out);
  }

  // State 4 (0x0052f18c), the tackle. Sub 0 aims; sub 1 is the stance (kamae) and turns
  // towards the target, then the dash (sub 2) at the walk speed times 4.5 with a knockback of
  // 2.0 on each target it reaches once; the dash ends when it is near the target, beyond the
  // sight range, or after 120 frames; sub 4 recovers and returns to the chase. With no target
  // the state holds still and shows no icon (the exe's no-target return).
  private tickTackle(out: AiFrame, t: AiTarget | null): AiFrame {
    if (!t) {
      this.sub = 0;
      this.setMotion(out, ILL_GILL_ANIM.wait);
      return this.finish(out);
    }
    if (this.sub === 0) {
      this.sub = 1;
      this.count = ILL_GILL.windup;
      this.setMotion(out, ILL_GILL_ANIM.kamae);
      return this.finish(out);
    }
    if (this.sub === 1) {
      this.turnTo(t);
      this.count--;
      if (this.count < 0) {
        this.sub = 2;
        this.dashFrames = 0;
        this.setMotion(out, ILL_GILL_ANIM.tackle);
      }
      return this.finish(out);
    }
    if (this.sub === 2) {
      this.dashFrames++;
      this.turnTo(t);
      this.stepToward(t, this.speed * ILL_GILL.dashSpeed);
      const d2 = sq(t.x - this.x) + sq(t.z - this.z);
      if (!this.tackleHits.has(t.clientId) && d2 < sq(this.radius + this.attackOf(3).distanceX)) {
        this.tackleHits.add(t.clientId);
        out.hit = { clientId: t.clientId, knockback: 0, mult: 1, kbScale: ILL_GILL.dashKnockback };
      }
      if (d2 < sq(this.speed * ILL_GILL.dashSpeed + this.radius) || d2 > sq(ILL_GILL.sight) || this.dashFrames > ILL_GILL.dashFrames) {
        this.sub = 4;
        this.count = ILL_GILL.recover;
        this.setMotion(out, ILL_GILL_ANIM.wait);
      }
      return this.finish(out);
    }
    this.count--;
    if (this.count < 0) {
      this.state = 'chase';
      this.sub = 0;
      this.setMotion(out, ILL_GILL_ANIM.walk);
    }
    return this.finish(out);
  }

  // State 7 (0x0052ea00), the damage. Below a quarter of its HP (0x009225d8, strict) the escape
  // flag 0x2000 is set, the target is dropped and its position becomes the new home. The
  // return to the chase after the damage motion is ASSUMED (the exe's transition is not traced).
  private tickDamage(out: AiFrame, t: AiTarget | null, animationEnded: boolean): void {
    void t;
    const hp = this.health ? this.health() : 1;
    if (!this.escaped && hp < 0.25) {
      this.escaped = true;
      this.targetId = null;
      this.homeX = this.x;
      this.homeZ = this.z;
    }
    if (animationEnded) {
      this.state = 'chase';
      this.sub = 0;
      this.setMotion(out, ILL_GILL_ANIM.walk);
    } else {
      this.setMotion(out, ILL_GILL_ANIM.damage);
    }
    this.finish(out);
  }

  // A hit flinches into the damage state in the exe's chase and the stand-by states; the
  // attacks keep their own state (ASSUMED: the exe's hit handler 0x0053114c is not the flinch).
  onDamage(clientId: number): void {
    void clientId;
    if (this.state === 'chase' || this.state === 'spawn' || this.state === 'advance' || this.state === 'idle') {
      this.state = 'damage';
      this.sub = 0;
    }
  }

  resume(): string {
    return this.state;
  }

  override kill(): void {
    super.kill();
    this.sub = 0;
  }

  get homePosition(): { x: number; z: number } {
    return { x: this.homeX, z: this.homeZ };
  }

  // The escape state (for the owner's invulnerable / untargetable reads).
  get fled(): boolean {
    return this.escaped;
  }
}

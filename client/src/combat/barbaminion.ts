// The Pig Ray, the Barba Ray's minion (PsoBB.exe: ctor 0x004ad95c, update
// 0x004addc0, states 0..5 at 0x004ae918 / 0x004ae748 / 0x004ae398 / 0x004ae10c /
// 0x004ae024 / 0x004adfac, death effects 0x004adfe8, latch helpers 0x004ae724 /
// 0x004add2c). Spawned by the Barba Ray's spawner (combat/barbaray.ts,
// barbaPigMode / BARBA_PIG_DEST; the spawner is 0x004b4e6c).
//
// The state numbers are the exe's (+0x32e). Decoded: the state changes and their
// order, the timer on entry (motion frames - 10), the latch list (4 targets,
// +0x3b0..+0x3cc), the sends (6x60-style attacks only in mode 1), the SE and
// effect ids. ASSUMED (not proven, tagged below): the speed, the random aim, the
// move test (the wall and the x <= 75 clamp of 0x004add2c), the death countdown
// (the exe gates it on the float at +0xc8, not decoded) and the attack values.
import type { AiFrame, AiTarget, EnemyBrain } from './enemyai.ts';

export const PIG_STATE = {
  appear: 0, // 0x004ae918: the timer (motion frames - 10), then aim
  aim: 1, // 0x004ae748: a random direction, velocity, heading, then advance
  advance: 2, // 0x004ae398: moves along the velocity, latches targets; blocked -> hold
  hold: 3, // 0x004ae10c: stands, latches targets; the kill moves it on
  dying: 4, // 0x004ae024: SE 0x3f5, the animation code 1; always goes to dead
  dead: 5, // 0x004adfac: the death effects, then the entity is dead
} as const;

// SE (0x3f1 / 0x3f2 the appear shout by mode, 0x3f3 the advance, 0x3f4 the hold
// burst, 0x3f5 the death). Effects: 0x20b the aura (on advance, removed on hold),
// 0x20d / 0x20e the death sparks.
export const PIG_SE = { appearMode0: 0x3f1, appearMode1: 0x3f2, advance: 0x3f3, burst: 0x3f4, death: 0x3f5 } as const;
export const PIG_FX = { aura: 0x20b, deathA: 0x20d, deathB: 0x20e } as const;

// The latch list size (+0x3ac, four pairs).
export const PIG_LATCH = 4;
// ASSUMED: the death countdown in ticks (the exe reads the float at +0xc8, not decoded).
export const PIG_DEATH_TICKS = 30;
// ASSUMED: the exe's x clamp of 0x004add2c (the move is refused when the old x is past 75).
export const PIG_CLAMP_X = 75;

export interface PigRayOptions {
  x: number;
  z: number;
  // The spawn heading (radians, from BARBA_PIG_HEADING).
  angle: number;
  // 0 or 1 (barbaPigMode): mode 1 attacks the latched targets, mode 0 does not.
  mode: 0 | 1;
  // The motion record's frame count (+0x3a8 +0x18); the appear timer is frames - 10.
  frames: number;
  // The motion's first float (+0x3a8 **): ASSUMED the speed term, 1 + speed a tick.
  speed: number;
  rng: () => number;
  // A move into a wall / out of the room (ASSUMED: the owner's ground test).
  blocked?: (x: number, z: number) => boolean;
}

export type PigEvent =
  | { kind: 'se'; id: number }
  | { kind: 'effect'; id: number; remove?: boolean }
  | { kind: 'dead' };

export class PigRayAi implements EnemyBrain {
  state = 'appear';
  readonly motion = null;
  readonly superArmor = true;
  // The state (+0x32e) and the animation code (+0xb8: 0, 1 on dying, 4 on hold).
  phase: number = PIG_STATE.appear;
  anim = 0;
  // The state timer (+0x3d0).
  timer: number;
  // Velocity (+0x30c, +0x314; y +0x310 stays 0) and the heading (radians).
  x: number;
  z: number;
  angle: number;
  vx = 0;
  vz = 0;
  // The float at +0xc8 (0.1 * (1 + speed) while advancing).
  coef = 0;
  // The latch list: clientIds (+0x3b0..+0x3cc).
  readonly latched: number[] = [];
  killed = false;
  dead = false;
  readonly mode: 0 | 1;
  private readonly speed: number;
  private readonly rng: () => number;
  private readonly blocked: (x: number, z: number) => boolean;
  private events: PigEvent[] = [];
  private spare: PigEvent[] = [];
  private readonly frame: AiFrame = { motion: null, x: 0, z: 0, angle: 0, hit: null };

  constructor(opts: PigRayOptions) {
    this.x = opts.x;
    this.z = opts.z;
    this.angle = opts.angle;
    this.mode = opts.mode;
    this.speed = opts.speed;
    this.rng = opts.rng;
    this.blocked = opts.blocked ?? (() => false);
    this.timer = Math.max(0, opts.frames - 10);
    this.state = `phase ${this.phase}`;
  }

  // The drain of the last ticks (SE, effects, the death). Valid until the next drain().
  drain(): PigEvent[] {
    const out = this.events;
    this.events = this.spare;
    this.events.length = 0;
    this.spare = out;
    return out;
  }

  private setPhase(p: number): void {
    this.phase = p;
    this.state = `phase ${p}`;
    switch (p) {
      case PIG_STATE.advance:
        // ASSUMED ordering: the latch list is cleared and the aura starts on entry.
        this.latched.length = 0;
        this.events.push({ kind: 'effect', id: PIG_FX.aura });
        break;
      case PIG_STATE.hold:
        this.anim = 4;
        this.events.push({ kind: 'effect', id: PIG_FX.aura, remove: true });
        break;
      case PIG_STATE.dying:
        this.events.push({ kind: 'se', id: PIG_SE.death });
        this.anim = 1;
        break;
      case PIG_STATE.dead:
        this.timer = PIG_DEATH_TICKS;
        this.events.push({ kind: 'effect', id: PIG_FX.deathA }, { kind: 'effect', id: PIG_FX.deathB });
        break;
    }
  }

  // The latch (0x004ae398 / 0x004ae10c loops): an alive target not yet latched
  // joins the list (up to 4). Mode 1 returns the attack for the first of them.
  private latch(targets: readonly AiTarget[]): void {
    for (const t of targets) {
      if (this.latched.length >= PIG_LATCH) return;
      if (t.dead || this.latched.includes(t.clientId)) continue;
      this.latched.push(t.clientId);
      if (this.mode === 1) {
        // ASSUMED values: knockback 0 and the enemy's own damage multiplier (the attack row is not decoded).
        this.frame.hit = { clientId: t.clientId, knockback: 0, mult: 1 };
      }
    }
  }

  tick(targets: readonly AiTarget[] = []): AiFrame {
    this.frame.hit = null;
    const f = this.speed;
    if (this.killed && this.phase !== PIG_STATE.dying && this.phase !== PIG_STATE.dead) {
      this.setPhase(PIG_STATE.dying);
    }
    switch (this.phase) {
      case PIG_STATE.appear:
        this.timer--;
        if (this.timer < 0) {
          // The exe plays the appear shout here (0x3f1 / 0x3f2 at 9.0 in state 0).
          this.events.push({ kind: 'se', id: this.mode === 0 ? PIG_SE.appearMode0 : PIG_SE.appearMode1 });
          this.setPhase(PIG_STATE.aim);
        }
        break;
      case PIG_STATE.aim: {
        // ASSUMED: a uniform random heading; the exe scales cos / sin by (1 + speed).
        const a = this.rng() * Math.PI * 2;
        this.vx = Math.cos(a) * (1 + f);
        this.vz = Math.sin(a) * (1 + f);
        this.angle = Math.atan2(this.vx, this.vz);
        this.setPhase(PIG_STATE.advance);
        break;
      }
      case PIG_STATE.advance: {
        this.coef = (1 + f) * 0.1;
        this.vx *= 1 + f;
        this.vz *= 1 + f;
        const nx = this.x + this.vx;
        const nz = this.z + this.vz;
        if (this.x <= PIG_CLAMP_X && !this.blocked(nx, nz)) {
          this.x = nx;
          this.z = nz;
          this.angle = Math.atan2(this.vx, this.vz);
        } else {
          this.setPhase(PIG_STATE.hold);
        }
        this.latch(targets);
        break;
      }
      case PIG_STATE.hold:
        this.latch(targets);
        break;
      case PIG_STATE.dying:
        this.setPhase(PIG_STATE.dead);
        break;
      case PIG_STATE.dead:
        this.timer--;
        if (this.timer <= 0 && !this.dead) {
          this.dead = true;
          this.events.push({ kind: 'dead' });
        }
        break;
    }
    this.frame.x = this.x;
    this.frame.z = this.z;
    this.frame.angle = this.angle;
    return this.frame;
  }

  onDamage(): void {}

  resume(): string {
    return this.state;
  }

  kill(): void {
    this.killed = true;
  }
}

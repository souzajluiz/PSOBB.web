// The Gal Gryphon's minion Effect (PsoBB.exe, Ephinea 1.25.13, addresses are VAs).
// The object is GalgryphonMinionEffect (0x5c bytes): created by
// CreateGalgryphonMinionEffect_004ab138 (dump 229417) from the minion launcher's
// state 2 (UpdateGalgryphonMinionEffect_004aa968), with the launcher's position
// and the target slot (+0x24, a u16; 0xffff = none) and the ground under it.
// Its per-frame update is UpdateGalgryphonMinion_004ab283 (dump 229526), the
// vtable's `update` (the dump names the functions' `this` as this_00, which is
// never set: the object's fields are the ones this file uses).
//
// Sources: the Ephinea Ghidra dump for the shape and the calls, the executable
// for the constants (tools/exedata.py: 0x009044BC = 0.01, 0x009044B8 = 0.995,
// 0x00903AE0 = 6.0), the icon call's arguments from the dump (icon3 at +0x28, colour
// 0xffffa24c, scale 0x3fc00000 = 1.5, forced flag 1, dump 229625).
//
// States (+0x1c): 0 init (the first update goes to 1), 1 MOVE (homes on the
// target), 2 WIND (60 frames, then the object is dead), 3 done (the update
// returns). The icon is drawn in state 1 only (the state-1 code runs after the
// state-2 branch returns; the earlier note said state 2, and the exe says 1).
//
// State 1 (each tick):
//   the ground under (+0x28, +0x30) is looked up (unknown_get_ground_info
//   0x16ef): none -> dead; else the height +0x2c = min(ground y, 6).
//   the timer (+0x20) above 360 (0x168) goes to state 2 and zeroes the timer;
//   the falls through: the direction to the target (CalculateGalgryphonMinion
//   EffectDirection_004ab4e8: the target's x - x, z - z, normalised, zero when
//   there is no target), the velocity (+0x34 / +0x3c) = (dir * 0.01 + v) * 0.995
//   per axis, the position += velocity; the icon at the new position; the
//   timer + 1.
//
// ASSUMED: the Ghidra decompile reads the direction's x and z as its
// unaff_retaddr and fLerpSpeed arguments (the Calculate call writes them to
// the stack slots it passes); the sound 0x39f, the particles and the attack
// dispatch (DispatchGalGryphonAttackEffect_004a8690, the Sinow Berill attack
// effect) are not ported here. The launcher that makes this object is
// galgryphon.ts (its Bezier path is InterpolateMinionEffectPosition_007be6b8),
// and the brain's S7 throw makes that launcher (galgryphonstatesa.ts, 2026-10-24
// check: CreateGalgryphonMinion_004aa808 is called once per S7 run at animation 20.5,
// dump 224036).

import { ENEMY_ICON_COLOR, type Icon } from '../classic/minimap.ts';
import type { GroundFn } from './techfire.ts';

export const GALMINION = {
  groundY: 6, // 0x00903AE0: the ground's height is at most this, and the object's height is the ground's (capped)
  accel: 0.01, // 0x009044BC: the pull toward the target per tick
  damp: 0.995, // 0x009044B8: the velocity's damping per tick
  life: 0x168, // 360 ticks of MOVE (the exe's 0x168 compare)
  windDown: 0x3c, // 60 ticks of WIND (0x3c compare)
  icon: 1.5, // icon3 0x3fc00000, forced
} as const;

export interface GalgryphonPlayer {
  readonly clientId: number;
  readonly x: number;
  readonly z: number;
}

export const GALMINION_STATE = { init: 0, move: 1, wind: 2, done: 3 } as const;
export const GALMINION_NO_TARGET = 0xffff;

export class GalgryphonMinionEffect {
  /** +0x1c */
  state: number = GALMINION_STATE.init;
  /** +0x20 */
  timer = 0;
  /** +0x24: the target player's slot (0xffff none). */
  readonly slot: number;
  /** +0x28 / +0x2c / +0x30 */
  x: number;
  y: number;
  z: number;
  /** +0x34 / +0x3c */
  vx = 0;
  vz = 0;
  /** +0x8: the object's dead bit (set by the update when the object ends). */
  dead = false;
  private readonly ground: GroundFn;
  private readonly icons: Icon[] = [];

  private constructor(x: number, y: number, z: number, slot: number, ground: GroundFn) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.slot = slot;
    this.ground = ground;
  }

  /** CreateGalgryphonMinionEffect_004ab138: the Effect exists only where the
   * ground under (x, z) is at or below the height 6; its height is that ground's. */
  static create(ground: GroundFn, x: number, z: number, slot: number): GalgryphonMinionEffect | null {
    const y = ground(x, z, GALMINION.groundY);
    if (y === null || y > GALMINION.groundY) return null;
    return new GalgryphonMinionEffect(x, y, z, slot, ground);
  }

  /** The icons of this tick (the forced 1.5 icon in state 1; none otherwise). */
  minimapIcons(): Icon[] {
    return this.icons;
  }

  /** One game tick (UpdateGalgryphonMinion_004ab283). `players` are the living
   * party; a slot the party does not hold is no target. */
  update(players: readonly GalgryphonPlayer[], attack?: (at: { x: number; y: number; z: number }) => void): void {
    this.icons.length = 0;
    if (this.dead) return;
    if (this.state === GALMINION_STATE.init) {
      this.state = GALMINION_STATE.move;
      return;
    }
    if (this.state === GALMINION_STATE.wind) {
      if (this.timer > GALMINION.windDown) {
        this.dead = true;
        return;
      }
      this.timer++;
      return;
    }
    if (this.state !== GALMINION_STATE.move) return;

    const gy = this.ground(this.x, this.z, GALMINION.groundY);
    if (gy === null) {
      this.dead = true;
      return;
    }
    this.y = Math.min(gy, GALMINION.groundY);
    if (this.timer > GALMINION.life) {
      this.state = GALMINION_STATE.wind;
      this.timer = 0;
    }
    // Falls through to the move in the exe, on the same tick. The area hit comes first
    // (UpdateGalgryphonMinion_004ab283 calls DispatchGalGryphonAttackEffect_004a8690 at 0x004ab39e,
    // after the life test and before the direction): once per move tick, at the minion's point.
    attack?.({ x: this.x, y: this.y, z: this.z });
    const d = this.direction(players);
    this.vx = (d.x * GALMINION.accel + this.vx) * GALMINION.damp;
    this.vz = (d.z * GALMINION.accel + this.vz) * GALMINION.damp;
    this.x += this.vx;
    this.z += this.vz;
    this.icons.push({ x: this.x, z: this.z, color: ENEMY_ICON_COLOR, shape: 1, scale: GALMINION.icon, heading: 0 });
    this.timer++;
  }

  // CalculateGalgryphonMinionEffectDirection_004ab4e8: the unit vector (XZ) to
  // the target; zero with no target (or a zero distance: vec3_safe_normalize).
  private direction(players: readonly GalgryphonPlayer[]): { x: number; z: number } {
    if (this.slot === GALMINION_NO_TARGET) return { x: 0, z: 0 };
    const p = players.find((q) => q.clientId === this.slot);
    if (!p) return { x: 0, z: 0 };
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const l = Math.hypot(dx, dz);
    if (l === 0) return { x: 0, z: 0 };
    return { x: dx / l, z: dz / l };
  }
}

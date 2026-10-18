// Enemy projectiles of the per-family FSMs (combat/enemyfsm*.ts), such as
// the Nano Dragon's breath and homing shots (combat/enemyfsmcaves.ts). A brain creates the shots and hands them to its owner in
// AiFrame.shots; render/combat.ts ticks them once per game tick, draws them and
// applies `effect` to the local player when a shot reports it.
//
// Heights are above the ground under the enemy that launched the shot (the
// projectiles' own map collision is not reproduced: ASSUMED flat ground).

import type { AiTarget } from './enemyai.ts';

// ASSUMED: the player's hit box radius for projectiles (the player collision
// radius 5 of render/lobbyview.ts; same value as enemyfsm.ts PLAYER_RADIUS).
const PLAYER_RADIUS = 5;
// ASSUMED: the height of the point a shot aims at / hits on a player.
export const PLAYER_AIM_HEIGHT = 10;

// What a shot does to a player it hits:
//   tech: entity_hit_by_tech with group 0 (case 0 at 0x00774cc7: damage =
//     trunc((attacker MST * 0.5 + power) * 0.2), no resistance, no evasion
//     roll; render/combat.ts applies it);
//   melee: try_hit_entity(mult) + cause_knockback(knockback);
//   status: a status effect only (combat/status.ts STATUS).
export type ShotEffect =
  | { kind: 'tech'; power: number }
  | { kind: 'melee'; mult: number; knockback: number }
  | { kind: 'status'; status: number };

export interface ShotLook {
  color: number;
  size: number;
}

export abstract class EnemyShot {
  x: number;
  y: number; // above the launch ground
  z: number;
  done = false;
  frames = 0;
  abstract readonly effect: ShotEffect;
  abstract readonly look: ShotLook;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  // One game tick; returns the players the shot hit this tick.
  abstract tick(targets: readonly AiTarget[]): AiTarget[];

  protected within(targets: readonly AiTarget[], radius: number): AiTarget[] {
    return targets.filter((t) => !t.dead && Math.hypot(t.x - this.x, t.z - this.z) <= radius + PLAYER_RADIUS);
  }
}

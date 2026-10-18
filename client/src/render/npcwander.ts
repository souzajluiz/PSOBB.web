// What a Pioneer 2 / Lab NPC does when nobody talks to it: the walking
// townspeople (set entry param6 = 1) wander around their spawn point, the
// others turn back to their spawn angle after a talk. Pure math (no three.js)
// so it runs in Node tests; render/npcview.ts drives it at 30 ticks a second.
//
// From PsoBB.exe (Ephinea 1.25.13). Every humanoid NPC class shares these
// vtable slots (checked on the female, male, HFW, REL-model, NgcBase and
// Momoka vtables, e.g. 0x00b1ece0 for TObjNpcFemaleBase):
//   EnemyObjectUpdateAnimation_00606e34 calls the handler of the mode at
//   +0x32e (vtable +0x154..+0x160), then Player__Animate:
//     mode 0  0x0061cdb0 (nothing);
//     mode 1  0x006061ec  turn back to the spawn angle;
//     mode 2  0x00606280  wander;
//     mode 3  EnemyObjectUpdate_0060648c  talk (npcview.ts).
//   vtable +0xf4 (0x00607284), called by the enemy AI dispatcher 0x00787b80
//   while the NPC has nothing else to do: a mode outside 1..3 becomes
//   2 when param6 (+0x370) is 1, else 1; sub-state +0x330 = 0, motion 0.
//   vtable +0xf0 (0x0060725c): mode 0, sub 0, motion 0 (the talk's end does
//   the same through EnemyObjectUpdate's state 3).
//   vtable +0x2c (0x006072e0), the talk's start: mode 3, sub 0, motion 1
//   (the NPC turns to the player in its walk motion), +0x2b0 = 0.
//   vtable +0x164 (0x00606a34, set_params) clamps param6 to 0..1
//   (SetupEnemyObject_00606bc8 passes 0, 1) and keeps the spawn angle +0x60
//   at +0x38c.
//   vtable +0x168 (0x0060c834) picks the motion: +0xb8 = 1 for 1 (the walk
//   row of the motion table), else 0 (idle).
// Mode 1 (0x006061ec), sub-state +0x330:
//   0  facing the spawn angle -> sub 1 + idle; else sub 2 + walk motion;
//   2  turn towards it by ClampAngleDifference_007a8c74 with the step
//      *(+0x358)+8 = 0x400; once there -> sub 1 + idle;
//   1  nothing.
// Mode 2 (0x00606280):
//   0  pick a point: angle = trunc(rand * 360 * 65536 / 360) (0x007751b0 is
//      the entity's random float in [0, 1), 0x0092f144 = 360, 0x0092f140 =
//      65536), (0, 0, 1) rotated by it, times param1 (+0x35c, the radius),
//      plus the spawn point (+0x50). When its squared XZ distance to the NPC
//      (0x007a9180) is above 100 (0x0092f13c): SorcererAcquireTarget
//      _00771c8c (flags 0) aims at it, the velocity is cleared, sub 1, walk
//      motion. Otherwise the next tick tries again;
//   1  turn towards the target (0x00772358: ClampAngleDifference by 0x400),
//      velocity = speed *(+0x358)+4 along the new angle (vtable +0x48,
//      0x00771934), move with the wall slide (vtable +0x4c, 0x00771994).
//      The walk frames 1 and 15 call vtable +0x170 (0x00602948, footstep).
//      Then when (speed + hitbox radius)^2 > squared distance to the target,
//      or the hitbox flags hold 0x380000 (it touched a player 0x80000, an
//      enemy 0x100000 or an object 0x200000 in the last collision pass):
//      sub 3 + idle;
//   3  +0x2b0 counts up; past 0x78 (120 ticks) it goes back to 0 and so does
//      the sub-state.
// Constants: DefaultEnemyCollisionParams_009c3eb0 = {100 search range, speed,
// 0x400 turn step}; the speed is written to 0x009c3eb4 as 0.5 by 0x006073ec.
// The hitbox (InitEnemyCollisionBoxes_007b9a88 with 0x009c3ecc): center
// (0, 10, 0), radius 5, flags 0x30203, unk2 0 (round).
// SorcererAcquireTarget only takes the point when there is ground under it
// (Enemygetgroundinfo007b4c58), the line of sight holds
// (EnemyAI_CheckLineOfSight_00771e14) and the map ray from the NPC to the
// point pushed out by the hitbox radius hits nothing
// (cast_ray_at_map_collision_geometry); otherwise the old target (spawn
// point at first: InitializeEnemyObjectControl copies +0x38 to +0x2a4) stays.
//
// Collision with characters (EnemyUpdateCollisionWrapper_007b6880 after every
// update: EnemyUpdateCollisionAndStep_007b6894 against the players, then
// 0x007b798c against the other enemies): when the NPC's round hitbox
// overlaps another one (radius 5 + 5, XZ only) its flags get 0x80000 /
// 0x100000, and EnemyHandleCollisionStepUp_007b7704 answers: if the NPC moved
// (squared distance >= 1e-10, 0x0097e39c) and the other center is within 90
// degrees of its angle, the vector to it is turned by 0x4000 (or 0xc000 when
// it lies to the other side); if that is longer than sqrt(1e-5) (0x0097e398)
// the NPC is put 0.25 (0x0097e390) along it from its previous position, on
// the ground found from 10 (0x0097e38c) above; else back at its previous
// position.
//
// ASSUMED: the AI dispatcher calls vtable +0xf4 every tick in mode 0; the
// spawn point +0x50 is the set entry's position; the wall slide of 0x00771994
// is CollisionWorld.move with the hitbox radius; the line-of-sight check is the
// same map ray; Math.random stands in for the entity's random generator; the
// footstep sound is left out.

import { bodyInFront, type Body, type CollisionWorld } from './collision.ts';

export const NPC_SPEED = 0.5; // 0x009c3eb4 (written by 0x006073ec)
export const NPC_TURN = 0x400; // *(0x009c3eb0 + 8)
export const NPC_RADIUS = 5; // 0x009c3ecc box radius
export const NPC_WANDER_MIN_SQ = 100; // 0x0092f13c
export const NPC_WANDER_WAIT = 0x78; // 0x00606361
export const NPC_SIDESTEP = 0.25; // 0x0097e390
const SIDESTEP_MIN_SQ = 1e-5; // 0x0097e398
const MOVED_MIN_SQ = 1e-10; // 0x0097e39c
const GROUND_PROBE = 10; // 0x0097e38c
const NPC_GROUND_MASK = 0x55; // EnemyHandleCollisionStepUp: unknown_identify_entity == 0 -> 0x55

export type NpcMode = 0 | 1 | 2 | 3;

// The NPC fields the modes use (offsets of the 0x3c0-byte object).
export interface NpcBrain {
  mode: NpcMode; // +0x32e
  sub: number; // +0x330
  wait: number; // +0x2b0
  motion: 0 | 1; // +0xb8: 0 idle, 1 walk
  x: number; // +0x38
  y: number;
  z: number;
  angle: number; // +0x60 (BAMS)
  homeX: number; // +0x50
  homeY: number;
  homeZ: number;
  homeAngle: number; // +0x38c
  radius: number; // param1 (+0x35c)
  wanders: boolean; // param6 (+0x370) == 1
  targetX: number; // +0x2a4
  targetY: number;
  targetZ: number;
  touching: boolean; // hitbox flags & 0x380000 after the last collision pass
}

export function npcBrain(x: number, y: number, z: number, angle: number, params: readonly number[]): NpcBrain {
  // set_params 0x00606a34: param6 clamped to 0..1.
  const p6 = Math.min(Math.max(Math.trunc(params[5] ?? 0), 0), 1);
  return {
    mode: 0,
    sub: 0,
    wait: 0,
    motion: 0,
    x,
    y,
    z,
    angle: angle & 0xffff,
    homeX: x,
    homeY: y,
    homeZ: z,
    homeAngle: angle & 0xffff,
    radius: params[0] ?? 0,
    wanders: p6 === 1,
    targetX: x,
    targetY: y,
    targetZ: z,
    touching: false,
  };
}

// ClampAngleDifference_007a8c74: `from` moved towards `to` by at most `step`.
export function clampAngle(from: number, to: number, step: number): number {
  const d = ((((to - from) & 0xffff) + 0x8000) & 0xffff) - 0x8000;
  if (Math.abs(d) <= step) return to & 0xffff;
  return (from + Math.sign(d) * step) & 0xffff;
}

const toBams = (dx: number, dz: number) => Math.trunc((Math.atan2(dx, dz) * 0x10000) / (Math.PI * 2)) & 0xffff;
const sinB = (a: number) => Math.sin((a * Math.PI * 2) / 0x10000);
const cosB = (a: number) => Math.cos((a * Math.PI * 2) / 0x10000);

export interface NpcWorld {
  collision: CollisionWorld | null;
  rand: () => number;
}

// vtable +0xf4 (0x00607284).
export function npcIdleMode(b: NpcBrain): void {
  if (b.mode > 0 && b.mode <= 3) return;
  b.mode = b.wanders ? 2 : 1;
  b.sub = 0;
  b.motion = 0;
}

// vtable +0x2c (0x006072e0): a player starts talking.
export function npcTalkStart(b: NpcBrain): void {
  b.mode = 3;
  b.sub = 0;
  b.motion = 1;
  b.wait = 0;
}

// EnemyObjectUpdate_0060648c state 3 (the talk thread ended).
export function npcTalkEnd(b: NpcBrain): void {
  b.mode = 0;
  b.sub = 0;
}

// SorcererAcquireTarget_00771c8c with flags 0.
function acquireTarget(b: NpcBrain, x: number, y: number, z: number, w: NpcWorld): boolean {
  const c = w.collision;
  if (c) {
    if (c.groundHeight(x, z, y + GROUND_PROBE, NPC_GROUND_MASK) === null) return false;
    const a = toBams(x - b.x, z - b.z);
    const ex = x + sinB(a) * NPC_RADIUS, ez = z + cosB(a) * NPC_RADIUS;
    const ry = b.y + 10; // the hitbox center (0x009c3ecc: y + 10)
    if (c.segmentHit([b.x, ry, b.z], [ex, ry, ez])) return false;
  }
  b.targetX = x;
  b.targetY = y;
  b.targetZ = z;
  return true;
}

// One 30 Hz tick of modes 0..2 (mode 3 is the talk, driven by npcview.ts).
export function npcTick(b: NpcBrain, w: NpcWorld): void {
  if (b.mode === 0) npcIdleMode(b);
  if (b.mode === 1) {
    if (b.sub === 0) {
      if (b.angle !== b.homeAngle) {
        b.sub = 2;
        b.motion = 1;
      } else {
        b.sub = 1;
        b.motion = 0;
      }
    } else if (b.sub === 2) {
      if (b.angle !== b.homeAngle) b.angle = clampAngle(b.angle, b.homeAngle, NPC_TURN);
      else {
        b.sub = 1;
        b.motion = 0;
      }
    }
    return;
  }
  if (b.mode !== 2) return;
  if (b.sub === 0) {
    const a = Math.trunc(((w.rand() * 360) * 65536) / 360) & 0xffff;
    const px = b.homeX + sinB(a) * b.radius;
    const pz = b.homeZ + cosB(a) * b.radius;
    const dx = px - b.x, dz = pz - b.z;
    if (dx * dx + dz * dz > NPC_WANDER_MIN_SQ) {
      acquireTarget(b, px, b.homeY, pz, w);
      b.sub = 1;
      b.motion = 1;
    }
    return;
  }
  if (b.sub === 1) {
    b.angle = clampAngle(b.angle, toBams(b.targetX - b.x, b.targetZ - b.z), NPC_TURN);
    const vx = sinB(b.angle) * NPC_SPEED, vz = cosB(b.angle) * NPC_SPEED;
    if (w.collision) {
      const r = w.collision.move(b.x, b.y, b.z, vx, vz, NPC_RADIUS, false);
      b.x = r.x;
      b.y = r.y;
      b.z = r.z;
    } else {
      b.x += vx;
      b.z += vz;
    }
    const tx = b.targetX - b.x, tz = b.targetZ - b.z;
    const reach = NPC_SPEED + NPC_RADIUS;
    if (reach * reach > tx * tx + tz * tz || b.touching) {
      b.sub = 3;
      b.motion = 0;
    }
    return;
  }
  if (b.sub === 3) {
    const n = b.wait + 1;
    if (n > NPC_WANDER_WAIT) {
      b.sub = 0;
      b.wait = 0;
    } else b.wait = n;
  }
}

// EnemyUpdateCollisionWrapper_007b6880 for an NPC that went from (px, pz) to
// its current place this tick: sets `touching` and applies the step response
// of EnemyHandleCollisionStepUp_007b7704 against the first overlapped body.
export function npcCollide(b: NpcBrain, px: number, py: number, pz: number, bodies: readonly Body[], w: NpcWorld): void {
  b.touching = false;
  for (const o of bodies) {
    const ox = b.x - o.x, oz = b.z - o.z;
    const r = NPC_RADIUS + o.radius;
    if (ox * ox + oz * oz >= r * r) continue;
    b.touching = true;
    const mx = b.x - px, mz = b.z - pz;
    if (mx * mx + mz * mz < MOVED_MIN_SQ) continue;
    if (!bodyInFront(px, pz, b.angle, o)) continue;
    // The vector from the previous place to the other center, turned by
    // 0x4000 when it lies on the near side of the angle, else by 0xc000.
    const vx = o.x - px, vz = o.z - pz;
    const d = (toBams(vx, vz) - b.angle) & 0xffff;
    const rot = d < 0x4000 ? 0x4000 : 0xc000;
    const c = cosB(rot), s = sinB(rot);
    // matrix_rotation_y: (0, 0, 1) turned by `rot` is (sin, 0, cos).
    let sx = vx * c + vz * s;
    let sz = -vx * s + vz * c;
    const len2 = sx * sx + sz * sz;
    if (len2 > SIDESTEP_MIN_SQ) {
      const len = Math.sqrt(len2);
      sx = (sx / len) * NPC_SIDESTEP;
      sz = (sz / len) * NPC_SIDESTEP;
      const gy = w.collision?.groundHeight(px + sx, pz + sz, py + GROUND_PROBE, NPC_GROUND_MASK);
      if (gy !== null && gy !== undefined) {
        b.x = px + sx;
        b.y = gy;
        b.z = pz + sz;
        return;
      }
      if (!w.collision) {
        b.x = px + sx;
        b.z = pz + sz;
        return;
      }
    }
    const gy = w.collision?.groundHeight(px, pz, py + GROUND_PROBE, NPC_GROUND_MASK);
    b.x = px;
    b.z = pz;
    b.y = gy ?? py;
    return;
  }
}

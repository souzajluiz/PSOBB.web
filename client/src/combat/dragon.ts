// The Dragon, the Episode 1 Caves boss (PsoBB.exe, Ephinea 1.25.13, addresses
// are VAs). One EnemyBrain drives the body and owns the objects the fight
// spawns: the fire breath's flames, the fireballs and the area hits of the
// stomps, landings and dives. render/combat.ts places the body and applies the
// hits the brain hands it as EnemyShots.
//
// Sources (docs/adr/0001-client-reference-sources.md): the Ephinea Ghidra dump
// for the FSM and tools/exedata.py for the tables. psobb-client-source (JP)
// has nothing of the Dragon beyond five stubs, and they agree with the dump:
// FUN_00425b49.c = 0x00425b49 (+0x684 = 0x32), FUN_00425b3c.c (+0x684 = 0),
// FUN_00425b58.c = DragonSetDefaultWeapon (the two above), FUN_00419ffc.c =
// SinowbeatSetTeleportPosition (copies +0x38 / +0x40 to +0x698 / +0x69c, the
// 6x12's x and z) and FUN_00419fe8.c = InitializeSinowbeatPosition (copies
// +0x6a0 / +0x6a4 to +0x38 / +0x40). FUN_00427cc0.c (+0x1c = +0x3c = 1) is the
// ground follower's "surfaced" flag. NAMES: the dump calls this boss's whole
// code block "Sinowbeat..." (a FidDB false positive; headers/bosses.h says so)
// and the JP file names "Dragon_*" / "Sinowbeat*" come from a server's names,
// so none of them says what a function is. The class is TBoss1Dragon (ctor
// 0x00419214, vtable 0x00af3a20, 0x8c4 bytes), the real Sinow Beat is
// TObjEneMe3ShinowaReal (combat/enemyfsmmines.ts).
//
// The body is a dispatcher on +0x32e (0x00419b14, jump table 0x008fb1a0) whose
// handlers take a phase: 4 enter, 5 leave, 0 the frame, 6 right before the
// leader sends its state (the new state's phase 6 fills the 6x12's x and z),
// 7 right after a 6x12 arrived (x and z are in +0x6a0 / +0x6a4), 8 a leader
// check run before the frame, 9 "pick the next state" (leader only), and 2 /
// 0xb the same pick driven by a player pad (the debug "dragon control":
// not reproduced, and neither are the pad-only states 1, 23..28, 30, 31, 36,
// 37 and 14: no sequence reaches them). SetEnemyAiState (0x0051f62c) runs
// phase 5 on the old state, then phase 4 on the new one.
//
// The per-frame update 0x00423b7c (vtable +0x04; the dump names it OlgaUpdateMainLoop,
// but it is the Dragon's, not Olga Flow's) runs, on the leader
// (+0x3e8 == 0, recomputed every frame from the party leader): the hit clamp,
// UpdateDragonAiState (0x00423f74), phase 8 and phase 0; a follower only the
// clamp and phase 0. Everything the leader decides goes out as a 6x12
// {u16 state, u16 cursor (+0x684), u32 target client (+0x394), f32 x, f32 z}
// through checked_call_packet0x60_subcommand, which also runs it on the
// sender (action_dragon 0x00423b00: set the target, +0x684 = cursor,
// +0x6a0 / +0x6a4 = x / z, phase 7, SetEnemyAiState when the state differs).
//
// HP: the entity's own hp (+0x334) is real (stats row 18), there are no pools.
// +0x688 is the hit clamp: while the sequence cursor (+0x684) is below 0x32
// a hit cannot take hp under it (hp = max(+0x688, hp), OlgaUpdateMainLoop),
// and +0x688 starts at 90 % of the maximum (the ctor's loop: max - max / 10,
// minus 20 % while hp <= it). When hp reaches it the leader roars
// (control_dragon_low_hp_roar 0x0042093c): hp = +0x688, cursor = 0x32 (the
// second sequence for good) and state 0xd (0xb when it is airborne: it lands
// first). Leaving the roar recomputes +0x688 (state 0xd phase 5). The boss
// can only die with the cursor at 0x32 or more, hp < 1 and flag 0x800 clear:
// state 0x15 (0xc when it is airborne, it lands and goes on to 0x15).
// State 0x15's phase 5 is EnemyOnKilledHandler_0051f894 (on_enemy_killed +
// set_monster_spawn_initdata_as_dead), the exe's kill sends.
//
// Not reproduced: the intro's camera, particles and sounds, the model-node
// reads other than the tail's, the mouth's and the feet's (GetPlayerYPosition
// 0x00422768), the tail boxes' direction vector (+0xc4 / +0xcc, a knockback
// the hit callback reads), the ground follower's dust (0x00427984) and the
// player-controlled dragon. The hit boxes are DRAGON_BODY_BOXES and
// DRAGON_TAIL. Heights come from the altitude registers.

import { BAMS_TO_RAD, type AiFrame, type AiTarget } from './enemyai.ts';
import type { EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase } from './enemyfsm.ts';
import { EnemyShot, PLAYER_RADIUS, type ShotEffect, type ShotLook } from './enemyshots.ts';

const BAMS = BAMS_TO_RAD;
const TWO_PI = Math.PI * 2;
const f32 = Math.fround;

// --- tables -----------------------------------------------------------------

// Motion slots (table 0x009a3ae0; slot 19's speed 0 is written at run time by
// the globals init 0x0042510c, 0x00425258 = 0.5). `motion` is the entry of
// bm_boss1_dragon.bml after the two models (0 bossop .. 25 wngopn). mode 1
// loops, 2 plays once and goes on to `next`, 3 plays once and holds.
export interface DragonSlot {
  readonly motion: number;
  readonly mode: 1 | 2 | 3;
  readonly next: number;
  readonly speed: number;
}
const slot = (motion: number, mode: 1 | 2 | 3, next: number, speed: number): DragonSlot => ({ motion, mode, next, speed });
export const DRAGON_SLOTS: readonly DragonSlot[] = [
  slot(17, 1, 0, 0.5), // 0 stand
  slot(21, 1, 0, 0.5), // 1 walk
  slot(16, 3, 0, 0.7), // 2 nobi (the roar)
  slot(5, 3, 0, 0.9), // 3 fire
  slot(8, 3, 0, 0.5), // 4 frin (breath in)
  slot(9, 1, 0, 0.4), // 5 frloop (breath loop)
  slot(10, 3, 0, 0.5), // 6 frout (breath out)
  slot(18, 3, 0, 0.5), // 7 tatk (tail swipe)
  slot(14, 2, 9, 0.5), // 8 nkdown
  slot(4, 1, 0, 0.3), // 9 down
  slot(15, 3, 0, 0.3), // 10 nkup
  slot(2, 3, 0, 0.6), // 11 dams
  slot(1, 3, 0, 0.5), // 12 daml
  slot(25, 3, 0, 0.5), // 13 wngopn
  slot(24, 3, 0, 0.5), // 14 wngclose
  slot(13, 3, 0, 1), // 15 lift
  slot(7, 1, 0, 1), // 16 fly
  slot(12, 2, 14, 1), // 17 land
  slot(6, 2, 16, 1.1), // 18 flyshot
  slot(3, 3, 0, 0.5), // 19 dead
  slot(23, 1, 0, 1), // 20 wing
  slot(22, 1, 0, 0.5), // 21 wgwalk
  slot(20, 3, 0, 1), // 22 tukomi
  slot(11, 1, 0, 1), // 23 kiri
  slot(19, 2, 16, 0.5), // 24 tobidasi
  slot(0, 3, 0, 0.5), // 25 bossop (the intro)
  slot(2, 2, 8, 0.6), // 26 dams then nkdown
];

// The states (+0x32e). The names are this port's. Sids 0x19 (teleport, 0x0041c7f8)
// and 0x1a (fly move, 0x0041c168) are not listed: only the pad-driven pick (phases 2
// and 0xb) writes them, and no stock quest enables it (DEVLOG 2026-10-21, test section 31).
// The 2026-10-24 pass checked the writers again (DEVLOG 2026-10-24): every write of
// 0x19 / 0x1a is in phase 2 or 0xb of a handler, and the sequence tables hold neither.
export const DRAGON_STATE = {
  wait: 0x00, // 0x004258ac: picks the first action
  walk: 0x02, // 0x00423070: stomping walk toward the target
  fire: 0x03, // 0x00422a08: the fire breath
  tail: 0x04, // 0x004227dc: the tail swipe
  flyUp: 0x05, // 0x00422430: jump into the air
  flyAcross: 0x06, // 0x00421ecc: fly across the arena
  flyShoot: 0x07, // 0x00421494: two volleys of three fireballs
  land: 0x08, // 0x00420ee8: land with a stomp
  collapse: 0x09, // 0x004203cc: fall and lie (CheckDragonAttackReady only)
  landCollapse: 0x0a,
  landRoar: 0x0b, // lands, then roars
  landDie: 0x0c, // lands, then dies
  roar: 0x0d, // 0x004201f4: the roar at each hp threshold
  roarAir: 0x0e, // 0x0042008c: a pad-only hover roar
  dive: 0x0f, // 0x0041f6cc: dive into the ground
  burrowFirst: 0x10, // 0x0041f238: underground to the centre (resets the counter)
  burrowNext: 0x11, // the same handler, counter + 1
  burrowOut: 0x12, // 0x0041ed68: underground toward a player's side
  emerge: 0x13, // 0x0041e3f8: leap out of the ground
  death: 0x15, // 0x0041db28
  corpse: 0x16, // inline in the dispatcher
  rain: 0x22, // 0x0041a888 (Ultimate): hover and rain fireballs
  circle: 0x23, // 0x0041a364 (Ultimate): spiral underground
  intro: 0x1d, // 0x0041b220: the entrance
} as const;

// The action sequences (u32 states; 0x20 sends the cursor back to 0, 0x21 to
// 0x32; the cursor is stored plus one after the read). Normal A 0x009a3cb0,
// normal B 0x009a3cf0, Ultimate A 0x009a3d28, Ultimate B 0x009a3d78.
export const DRAGON_SEQ_NORMAL_A: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 0x20];
export const DRAGON_SEQ_NORMAL_B: readonly number[] = [5, 6, 15, 16, 18, 17, 18, 17, 18, 19, 8, 2, 3, 0x21];
export const DRAGON_SEQ_ULTIMATE_A: readonly number[] = [2, 3, 2, 3, 4, 5, 6, 34, 8, 0x20];
export const DRAGON_SEQ_ULTIMATE_B: readonly number[] = [5, 6, 15, 16, 18, 17, 18, 35, 19, 8, 2, 3, 0x21];
export const DRAGON_CURSOR_B = 0x32;

// UpdateDragonAiState's table walk (every phase 9 that picks): returns the
// state and stores the new cursor.
export function dragonNext(cursor: number, ultimate: boolean): { state: number; cursor: number } {
  let c = cursor;
  const table = c < DRAGON_CURSOR_B ? (ultimate ? DRAGON_SEQ_ULTIMATE_A : DRAGON_SEQ_NORMAL_A) : ultimate ? DRAGON_SEQ_ULTIMATE_B : DRAGON_SEQ_NORMAL_B;
  let i = c < DRAGON_CURSOR_B ? c : c - DRAGON_CURSOR_B;
  for (let n = 0; n < 4; n++) {
    const v = table[i];
    if (v === 0x20) {
      c = 0;
      i = 0;
      continue;
    }
    if (v === 0x21) {
      c = DRAGON_CURSOR_B;
      i = 0;
      continue;
    }
    return { state: v, cursor: c + 1 };
  }
  return { state: table[0], cursor: c + 1 };
}

// --- constants --------------------------------------------------------------

// Globals written by the init 0x0042510c: gravities and distances.
export const DRAGON = {
  gravityUp: -0.3, // 0x00a436f8: the jump
  gravityDive: -0.5, // 0x00a436ec: the dive's rise
  gravityDiveFall: -0.7, // 0x00a436f0: the dive's fall
  gravityLand: -0.2, // 0x00a436f4: the landing
  gravityEmerge: f32(-0.4018), // 0x00a436e4 (0xbecdb6db)
  arenaRadius: 350, // 0x00a436d8 / 0x00a436e8 / 0x00a4371c
  mouthAhead: 115, // 0x00a436fc: the breath's aim point, ahead of the mouth
  walkTargetNear: 35, // 0x00a43700: the walk ends within this of the point 185 ahead
  walkAhead: 185, // 0x00a436fc + 0x008fbba8 (70)
  shotMinDistSq: 6400, // 0x00a436ac
  flightAltitude: 180, // 0x008fbe70
  undergroundAltitude: -400, // 0x008fbed8
  walkSpeed: 0.8, // 0x008fbbd4
  stompRadius: 15, // the ctx of 0x008fb42c: field 2
  flameSpeed: 5, // 0x008fc370
  flameMaxY: 30, // 0x008fc368: it only hits below this
  flameMinY: -10, // 0x008fc36c: it dies below this
  flameRadius: 10, // the ctx's field 2 (UpdateItemDisplayTransform_00424f78)
  fireballSpeed: 25, // 0x008fc394 (the update 0x00426790)
  fireballRadius: 30, // the ctx's field 2 (UpdateItemDisplayTransform_00425004)
  hoverReach: 150, // 0x008fbc40 (the random aim distance of the flying volley is 125)
  volleyAim: 125, // 0x008fbc40
  volleySpread: 0x1000, // the second and third fireball's turn
  trailRadius: 45, // 0x0042... ProcessEnemySinowbeatTeleport's ctx field 2
  burrowCap: 4, // 0x008fbf60: speed per burrow counter
  burrowBase: 4, // 0x008fbf64
  burrowAccel: f32(0.1), // 0x008fbedc
  rimSlots: 12, // the emerge / dive points (0x1555 BAMS apart)
} as const;

// The mouth and the feet are model nodes (the draw records them, see
// recordFeet / recordMouth). The mouth is node 60 with the point (0, 0, 5) in
// its space: 0x00425334 sets the draw's tracker to node 0x3c (the counter of
// 0x00418d5c) and the point 0xa437ac = (0, 0, 5.0), 0x00418d5c turns the point
// into the Dragon's +0x3f0 with the node's matrix, and 0x00424938 copies it to
// +0x414 (x), +0x418 (y), +0x41c (z), the flame's origin (0x00422a8e). The
// stomps (0x0041d504 at frame 3, 0x0041d410 at frame 24) strike both nodes of a
// pair with radius 15: 50 and 51 for side +1, 40 and 41 for side -1 (the table
// slots 5, 6 and 3, 4 of DRAGON_NODE_TABLE).
export const DRAGON_MOUTH = { node: 60, forward: 5 } as const;
export const DRAGON_FEET = { front: [50, 51], back: [40, 41] } as const;
export function footNodes(side: number): readonly number[] {
  return side > 0 ? DRAGON_FEET.front : DRAGON_FEET.back;
}

// The fire's sound effects. 0x00814298 / 0x008144b0 are the SE engine
// (play_directional_sound_effect, audio/se.ts), not the particle spawn: the
// breath's loop plays 0x321 every frame (0x00422cb7), its 30 frames after the
// breath play it too (0x00422ddb, while the counter after the increment is
// below 30), and each fireball's constructor (0x004266b0, the call at
// 0x00426766) plays 0x31f at its own place. The Dragon's other ids in
// 0x314..0x326 are sound effects in the same way. Wired at their sites (each
// `emit({ kind: 'se' })` below cites its exe call): 0x315 (walk), 0x317 / 0x318
// (flyUp, flyShoot), 0x31a (collapse entry), 0x31b (death), 0x31d (tail), 0x31e
// (flyShoot), 0x325 (circle, burrow, burrowOut), 0x326 (collapse). The 2026-10-24
// pass (DEVLOG): 0x318 at frame 5 in the animate helper 0x0041ebc0 (animSound), 0x318
// at frame 2 in land (0x00421235), 0x320 at the fireball's impact (0x004268db, in the
// fireball update 0x00426790, arrived counter 1). Not wired: 0x319 (no call in the
// exe), 0x314 at 0x0042365d (state 1: no writer in the Dragon's code, no port state).
export const DRAGON_SE = { breath: 0x321, breathAfterFrames: 30, fireball: 0x31f, impact: 0x320 } as const;

// The Dragon's particle ids (create_particle_effect 0x0050b7a4 / 0x0050981c: the
// second argument is the id, the third the flag; the 0x840 of 0x0041ec4c is the
// flag, its id is the table's +0x00). Two tables: normal at 0x008fbeec,
// Ultimate at 0x008fbf0c; 0x004198fc / 0x0041991a pick by 0x00420a44 (the
// Ultimate test). Field names are the offsets the sites read: +0x00 the
// emerge / dive helper (0x0041ebf0), +0x04 the take-off helper (0x0041c784),
// +0x08 the body (intro, landing, death), +0x0c the stomps (0x0041d410 /
// 0x0041d504) and the collapse dust, +0x18 the flame's mouth point (flyShoot),
// +0x1c the fireball launch (0x004218eb) and the entrance's launch flashes
// (0x0041b5b3 / 0x0041b98e), +0x14 the entrance's flame emitter (0x0041b9c1,
// 0x0041b709). The entrance's body particles are +0x08 and the constant 0x203
// (0x0041b6a7). Ids 0x200..0x23f are entries of the map's particleentrya%d.dat
// (classic/particles.ts).
export const DRAGON_PARTICLE_IDS = {
  normal: { f00: 65, f04: 76, body: 547, stomp: 240, mouth: 546, launch: 549, intro: 545 },
  ultimate: { f00: 512, f04: 513, body: 514, stomp: 148, mouth: 523, launch: 521, intro: 524 },
} as const;
// The entrance's constant particle (0x0041b6a7 pushes 0x203 as the id).
export const DRAGON_INTRO_PARTICLE = 0x203;

// The fireball's table (normal 0x008fc374, Ultimate 0x008fc380; chosen by
// 0x0042693c). The fireball update (0x00426790), by its phase [+0x38]:
// flying (phase 0): +0x00 each frame, the flight emitter (0x0050981c, the
// handle at +0x44 made on the first flying frame, moved each frame; the exe
// makes it once and moves it, here one emitter each frame as the trail was);
// arrived (phase 1, counter [+0x34] 1): +0x04 at the impact (0x0042689d) and
// +0x08 (0x004267cf); counter 2: +0x08 again; then the phase 2 countdown.
export const DRAGON_FIRE_IDS = {
  normal: { f00: 548, f04: 550, f08: 553 },
  ultimate: { f00: 522, f04: 520, f08: 201 },
} as const;
export interface DragonFireIds {
  f00: number;
  f04: number;
  f08: number;
}

// ASSUMED: what the exe reads from variables this port does not reproduce, and
// the mouth / feet places when the model has no such node (the head +0x418).
export const DRAGON_GUESS = {
  mouthForward: 70,
  mouthHeight: 75,
  mouthHeightFlying: 40, // the head hangs below the flight altitude
  footForward: 35,
  footSide: 30,
  stompKnockback: 3,
  landRadiusMin: 60,
  impactRadius: 60,
  animYOffset: 0, // GetPlayerYPosition (the model's own root height)
  headBelowGround: 25, // the dive's head test (+0x418 <= -50) as an altitude
  followerWait: 900,
  fallbackWait: 150,
  walkMax: 900, // the walk toward a target that keeps running away ends here
  stateMax: 2400, // the leader leaves any state that has lasted this long (a motion shorter than a frame test)
} as const;

// --- hit boxes ---------------------------------------------------------------
//
// The Dragon owns two sets of boxes (collision_box, 0x2c bytes: +0 local
// position, +0xc radius, +0x18 flags, +0x1c world position).
//
// Its body: the ctor 0x00419214 loads 7 boxes from 0x009a39a0 (call
// 0x0051ff3c, count 7). The table is bss: every position is (0, 0, 0) and the
// radii are written by the static init 0x00425212..0x0042524e (offset +0xc of
// each row): 10, 10, 10, 15, 15, 10, 10, flags 0x8003. Nothing in the Dragon's
// code moves them (no call to 0x00520068 / 0x005200e4 / 0x00520158 from
// 0x00419000..0x00428000), so the body is a stack of spheres at its origin and
// the biggest one is 15.
export const DRAGON_BODY_BOXES = { radii: [10, 10, 10, 15, 15, 10, 10], flags: 0x8003, reach: 15 } as const;

// Its tail: a second object (ctor 0x004269f8, 0xd0 bytes, built by the Dragon's
// ctor at +0x68c with the node array at +0x4ec) holding 17 boxes of radius 10
// (the template 0x009a3fc0: flags 0x8003 and +0xc = 10.0, written by the
// static init 0x00426d74), copied to boxes 1..16 by the ctor. Its update
// (vtable +4, 0x00426ba8) places box i at the world position of model node
// DRAGON_NODE_TABLE[15 + i] (0x008fb900), then calls
// UpdateEntityStateFromThreshold (0x00520304, 30.0): flag 4 (high) when the
// box is 30 or more above the Dragon's y (+0x3c), flag 2 (low) below, and
// attacks the players (0x00521eb8 with the context {3.0, 1}, hit list +0xbc,
// AttackData row 0x00a4373c = the second of 18, 20, 21, 22, 23). The only
// state that calls the update is the tail swipe (0x004227dc): from its second
// tick, every tick; the hit list is reset on entering (box active), at the
// frame 10 crossing and at the frame 23 crossing, so a player can be struck at
// most three times by one swipe.
//
// The nodes are recorded while the model is drawn (0x00424580 +
// 0x00418d5c): the draw walks the model's nodes depth first with a counter
// and, when it equals DRAGON_NODE_TABLE[slot], copies the node's world
// position into the Dragon's array at +0x438 + 12 * slot. Slots 7..11 only
// when flag 0x80 of +0x3c8 is set, slots 18..31 only when 0x200 is (the tail
// state sets it; otherwise the last values stay). Verified against
// bm_boss1_dragon.bml: nodes 72..94 are the tail (a chain along -z with two
// forks), 40 / 41 / 50 / 51 the feet, 54..58 the neck.
export const DRAGON_NODE_TABLE: readonly number[] = [
  0, 8, 10, 40, 41, 50, 51, 54, 55, 56, 57, 58, 67, 70, 71, 72, 74, 76, 79, 80, 81, 82, 83, 84, 85, 88, 89, 90, 91, 92, 93, 94, 100, 102,
];
export const DRAGON_TAIL = {
  count: 17,
  firstSlot: 15, // box i is slot 15 + i of the node table
  alwaysSlots: 18, // slots below this are recorded in every state, the rest with flag 0x200
  recordFlag: 0x200,
  radius: 10, // 0x009a3fcc, written by 0x00426d74
  flags: 0x8003,
  highFrom: 30, // 0x00520304's threshold, y above the Dragon
  attackRow: 1, // index into [18, 20, 21, 22, 23]: 0x00a4373c holds row 20
  resetFrames: [10, 23], // the hit list is cleared when the swipe passes these
  knockback: 3, // the context's first float, 3.0 (the stomp's value too)
} as const;

export interface DragonTailBox {
  x: number;
  y: number;
  z: number;
  // The flags of 0x00520304: true is flag 2 (below 30 above the Dragon).
  low: boolean;
}

// MovementData row 17 (the Dragon's, g_DragonAnimationSpeedIndices 0x009a3dc8:
// 17, 18, 19): fparam1 the breath's power, fparam2 the fireballs', fparam3 the
// trail's, fparam4 the landing stomp's radius, fparam5 the Ultimate walk speed,
// fparam6 the Ultimate flight speed. ASSUMED fallback: the Normal row.
const FALLBACK_MOVEMENT: EnemyMovementData = { fparam1: 150, fparam2: 130, fparam3: 200, fparam4: 80, fparam5: 0, fparam6: 0, iparam: [0, 5, 15, 0, 0, 0] };

// --- helpers ----------------------------------------------------------------

const sinB = (a: number): number => Math.sin(a * BAMS);
const cosB = (a: number): number => Math.cos(a * BAMS);
const shortOf = (a: number): number => (a << 16) >> 16;
// atan2(x, z) as BAMS, truncated (the FPU control word 0xc00 of the exe).
const bamsOf = (x: number, z: number): number => Math.trunc((Math.atan2(x, z) * 65536) / TWO_PI);
// b_minus_a: the signed 16-bit turn from a to b.
const turnTo = (a: number, b: number): number => shortOf(b - a);
// ClampAngleDifference_007a8c74(from, to, max).
function clampAngle(from: number, to: number, max: number): number {
  const d = turnTo(from, to);
  return shortOf(from + Math.max(-max, Math.min(max, d)));
}
// CalculateSineScaledValue_00782a34: half the scale over sin of half the angle.
const sineScaled = (angle: number, scale: number): number => f32((0.5 * scale) / Math.sin((Math.trunc(angle / 2) * TWO_PI) / 65536));

// The trapezoid profile (CalculateEntityTrajectory 0x00783444,
// CalculateEntityStateValue 0x00782d28, IsEntityStateThresholdPassed
// 0x00782d9c): accelerate by `accel`, cruise at `vmax`, brake by `decel`
// (negative) over `dist`; value(t) is the distance covered after t ticks.
export class DragonTrapezoid {
  private a = 0;
  private d = 0;
  private v = 0;
  private t1 = 0;
  private t2 = 0;
  private t3 = 0;
  private s1 = 0;
  private total = 0;

  set(accel: number, decel: number, dist: number, vmax: number): void {
    const a = accel > 0 ? accel : 0.1;
    const d = decel < 0 ? decel : -0.1;
    let v = vmax;
    const s1 = (0.5 * v * v) / a;
    const s3 = (-(v * v) * 0.5) / d;
    this.a = a;
    this.d = d;
    this.total = dist;
    if (s1 + s3 < dist) {
      this.v = v;
      this.s1 = s1;
      this.t1 = v / a;
      this.t2 = this.t1 + (dist - s3 - s1) / v;
      this.t3 = -v / d + this.t2;
      return;
    }
    v = Math.sqrt((2 * a * d * dist) / (d - a));
    this.v = v;
    this.s1 = (v * v * 0.5) / a;
    this.t1 = v / a;
    this.t2 = this.t1;
    this.t3 = -v / d + this.t1;
  }

  value(t: number): number {
    if (t < 0) return 0;
    if (t < this.t1) return 0.5 * this.a * t * t;
    if (t < this.t2) return (t - this.t1) * this.v + this.s1;
    if (t < this.t3) {
      const r = this.t3 - t;
      return 0.5 * this.d * r * r + this.total;
    }
    return this.total;
  }

  done(t: number): boolean {
    return this.t3 <= t;
  }
}

// --- children: shots --------------------------------------------------------

// Shots of this fight: heights are above the ground under the body.
abstract class DragonShot extends EnemyShot {}

// One area hit on the frame it is made: the exe's attack object
// (g_pDerolleObject, vtable +0x34 / +0x3c) with a {group, power, radius}
// context. `only` limits it to the players a hit list has not seen.
export class DragonBurst extends DragonShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook;
  readonly radius: number;
  private only: readonly number[] | null;
  constructor(x: number, y: number, z: number, radius: number, effect: ShotEffect, look: ShotLook, only: readonly number[] | null = null) {
    super(x, y, z);
    this.radius = radius;
    this.effect = effect;
    this.look = look;
    this.only = only;
  }
  peek(targets: readonly AiTarget[]): AiTarget[] {
    return this.within(targets, this.radius).filter((t) => !this.only || this.only.includes(t.clientId));
  }
  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.done = true;
    return this.peek(targets);
  }
}

// The breath's flame (ctor 0x004264a4, update 0x00426598): it flies along the
// mouth's direction at 5 a frame, tests the players only while it is below 30
// (entity_hit_by_tech with the Dragon's group, power MovementData fparam1,
// radius 10) once per player (its own hit list), and dies below -10.
export class DragonFlame extends DragonShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xff7020, size: 2.5 };
  private vx: number;
  private vy: number;
  private vz: number;
  private seen = new Set<number>();
  constructor(x: number, y: number, z: number, dx: number, dy: number, dz: number, power: number) {
    super(x, y, z);
    this.vx = dx * DRAGON.flameSpeed;
    this.vy = dy * DRAGON.flameSpeed;
    this.vz = dz * DRAGON.flameSpeed;
    this.effect = { kind: 'tech', power };
  }
  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    if (this.y < DRAGON.flameMinY || this.frames > 400) {
      this.done = true;
      return [];
    }
    if (this.y >= DRAGON.flameMaxY) return [];
    const hit = this.within(targets, DRAGON.flameRadius).filter((t) => !this.seen.has(t.clientId));
    for (const t of hit) this.seen.add(t.clientId);
    return hit;
  }
}

// The fireball (ctor 0x004266b0, update 0x00426790): 25 a frame along the line
// from the mouth to the aim point, then one area hit of radius 30 (tech, power
// MovementData fparam2; UpdateItemDisplayTransform_00425004) on the first
// frame after it arrived. Its particles (the ids of its table, DRAGON_FIRE_IDS)
// are queued by tick and drained by the renderer (drainParticles).
export class DragonFireball extends DragonShot {
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xff9030, size: 4 };
  readonly ids: DragonFireIds;
  private queued: number[] = [];
  // The SE ids made since the last drain (0x320 at the impact, 0x00426790 counter 1).
  private sounds: number[] = [];
  private impactFrames = 0; // the exe's counter [+0x34] after the arrival
  private ox: number;
  private oy: number;
  private oz: number;
  private dx: number;
  private dy: number;
  private dz: number;
  private length: number;
  private travelled = 0;
  private arrived = false;
  constructor(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    power: number,
    ids: DragonFireIds = DRAGON_FIRE_IDS.normal,
  ) {
    super(from[0], from[1], from[2]);
    this.ids = ids;
    this.ox = from[0];
    this.oy = from[1];
    this.oz = from[2];
    const x = to[0] - from[0];
    const y = to[1] - from[1];
    const z = to[2] - from[2];
    const len = Math.hypot(x, y, z) || 1;
    this.dx = x / len;
    this.dy = y / len;
    this.dz = z / len;
    this.length = len;
    this.effect = { kind: 'tech', power };
  }
  // In the air (phase 0 of the update, the flight emitter +0x00 each frame).
  get flying(): boolean {
    return !this.arrived && !this.done;
  }
  // The particle ids made since the last drain, in order.
  drainParticles(): number[] {
    return this.queued.splice(0);
  }
  // The SE ids made since the last drain, in order (the renderer plays them).
  drainSounds(): number[] {
    return this.sounds.splice(0);
  }
  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return [];
    this.frames++;
    if (!this.arrived) {
      this.travelled = Math.min(this.length, this.travelled + DRAGON.fireballSpeed);
      this.x = this.ox + this.dx * this.travelled;
      this.y = this.oy + this.dy * this.travelled;
      this.z = this.oz + this.dz * this.travelled;
      // The arrival frame still makes the flight emitter (0x00426865 follows the arrival).
      this.queued.push(this.ids.f00);
      if (this.travelled >= this.length) this.arrived = true;
      return [];
    }
    // The impact (counter 1: the hit, +0x04, and the +0x08 puff); counter 2 is one more +0x08.
    this.impactFrames++;
    if (this.impactFrames === 1) {
      this.queued.push(this.ids.f04, this.ids.f08);
      // 0x004268db (the impact branch 0x0042688f, every impact): SE 0x320 at the fireball.
      this.sounds.push(DRAGON_SE.impact);
      return this.within(targets, DRAGON.fireballRadius);
    }
    if (this.impactFrames === 2) this.queued.push(this.ids.f08);
    this.done = true;
    return [];
  }
}

// --- the brain ----------------------------------------------------------------

export type DragonEvent =
  // A 6x12 the leader sends (unknown_dragon_send_0x60 / SendDragonActionPacket).
  | { kind: 'send'; state: number; cursor: number; target: number | null; x: number; z: number }
  | { kind: 'se'; id: number }
  | { kind: 'bgm'; name: string }
  // State 0x15's phase 5: EnemyOnKilledHandler_0051f894 (every client runs it).
  | { kind: 'killed'; x: number; z: number }
  // create_particle_effect at a world point (the brain's x / z, y above the ground).
  | { kind: 'particle'; id: number; x: number; y: number; z: number }
  // A looping emitter (create_particle_effect_handle 0x0050981c): it lives while
  // `handle.alive`, and follows the mouth (the brain's mouth()) while it lives.
  | { kind: 'emitter'; id: number; handle: DragonEmitter };

// The handle 0x0050981c returns; the brain clears `alive` where the exe stops
// the emitter (its flag word at +0x08, bit 0).
export interface DragonEmitter {
  alive: boolean;
}

export interface DragonOptions {
  x: number;
  z: number;
  angle: number;
  ultimate: boolean;
  // MovementData row 17 (see FALLBACK_MOVEMENT).
  movement: EnemyMovementData | null;
  // Stats row 18's hp.
  hp: number;
  leader: () => boolean;
  frames: (motion: number) => number; // frame count of a body motion
  // The hp of a player (the flying volley goes for the healthiest ones).
  playerHp: (clientId: number) => number;
  rng: () => number;
}

// Flag bits of +0x3c8 the fight reads: 0x400 keeps the leader from roaring,
// 0x800 from dying.
const NO_ROAR = 0x400;
const NO_DEATH = 0x800;

const NAMES: Record<number, string> = {
  0x00: 'wait',
  0x02: 'walk',
  0x03: 'fire breath',
  0x04: 'tail swipe',
  0x05: 'fly up',
  0x06: 'fly across',
  0x07: 'fireballs',
  0x08: 'land',
  0x09: 'collapse',
  0x0a: 'land, collapse',
  0x0b: 'land, roar',
  0x0c: 'land, die',
  0x0d: 'roar',
  0x0e: 'hover roar',
  0x0f: 'dive',
  0x10: 'burrow',
  0x11: 'burrow again',
  0x12: 'burrow out',
  0x13: 'emerge',
  0x15: 'death',
  0x16: 'corpse',
  0x1d: 'intro',
  0x22: 'fire rain',
  0x23: 'spiral',
};

export class DragonAi extends BrainBase {
  state = 'intro';
  // Dragon state number (+0x32e) and the sequence cursor (+0x684).
  sid: number = DRAGON_STATE.intro;
  cursor = 0;
  yaw = 0; // +0x60, BAMS
  alt = 0; // height above the ground (+0x5e0 minus the ground)
  flags = 0; // +0x3c8
  air = 0; // +0x3ec: 0 ground, 1 flying, 2 underground
  // hp (+0x334), the maximum (+0x2bc) and the hit clamp (+0x688).
  hp: number;
  readonly maxHp: number;
  thr: number;
  private hitFlag = false;
  // Motion: slot +0xb8, frame +0xc0, speed +0xc8.
  slotIndex = 25;
  mframe = 0;
  speed = 0.5;
  private changing = false; // +0xb0 & 4
  ended = false; // +0xb0 & 0x10
  private motionDirty = true;
  readonly events: DragonEvent[] = [];
  dead = false;
  // The flames and fireballs of this fight are in `pendingShots` until tick()
  // hands them out.
  private pendingShots: EnemyShot[] = [];
  // Working registers, named after the exe's offsets.
  private c86c = 0;
  private c870 = 0;
  private c874 = 0;
  private f884 = 0;
  private f888 = 0;
  private f88c = 0;
  private f890 = 0;
  private f894 = 0;
  private i87c = 0;
  private i880 = 0;
  private dug = false; // +0x8b0: the dive's impact has happened (0x0041fa73 tests it)
  // Target position (+0x39c / +0x3a4), the direction to it (+0x3a8 / +0x3b0)
  // and its length (+0x3b4); the 6x12's x / z out (+0x698 / +0x69c) and in
  // (+0x6a0 / +0x6a4).
  private tx = 0;
  private tz = 0;
  private dx = 0;
  private dz = 0;
  private tdist = 0;
  private ox = 0;
  private oz = 0;
  private ix = 0;
  private iz = 0;
  private startX = 0;
  private startZ = 0;
  private velX = 0; // +0x898 / +0x8a0 in the emerge
  private velZ = 0;
  private burrows = 0; // +0x6e4
  private rimUsed = 0; // +0x6a8
  private readonly rim = new Float32Array(DRAGON.rimSlots); // +0x6b0, 0 = unrolled
  // The turn easing (DragonCalculateMovementOffset 0x00425a40).
  private m660 = 0;
  private m668 = 0;
  private m66c = 0;
  private m670 = 0;
  private m674 = 0;
  private m678 = 0;
  private m67c = 0;
  private m680 = 0;
  private sign664 = 1;
  private readonly posProfile = new DragonTrapezoid();
  private readonly headProfile = new DragonTrapezoid();
  private targetTimer = 0; // +0x3b8
  private seen = new Set<number>(); // +0x690: the players the trail has hit
  // The tail object (+0x68c): its 17 boxes and its hit list (+0xbc).
  readonly tailBoxes: DragonTailBox[] = Array.from({ length: DRAGON_TAIL.count }, () => ({ x: 0, y: 0, z: 0, low: true }));
  private tailSeen = new Set<number>();
  // The feet's nodes (x, y, z in the world) and the mouth (recordMouth); null
  // until the model has been drawn.
  private readonly feetNodes = new Map<number, [number, number, number]>();
  private mouthPlace: [number, number, number] | null = null;
  // The flame's emitter handle (+0x8b4, flyShoot sub-state 2) and the counter of
  // the emerge / dive helper (+0x6ac, 0x0041ebf0: zero at the spawn, 0x004197a1).
  private mouthEmitter: DragonEmitter | null = null;
  private riseCount = 0;
  private rain = 0; // the shared rain generator (seeded from the 6x12's x / z)
  private everLeader: boolean;
  private takeover = false; // (current_attack_info).horiz_dist: the leader changed
  private stall = 0; // follower ticks without a 6x12
  private age = 0; // leader ticks in this state
  private cand: AiTarget[] = [];
  private last: readonly AiTarget[] = [];
  private opts: DragonOptions;
  private ultimate: boolean;
  private mv: EnemyMovementData;

  constructor(opts: DragonOptions) {
    super(opts.x, opts.z, opts.angle, opts.rng);
    this.opts = opts;
    this.ultimate = opts.ultimate;
    this.mv = opts.movement && opts.movement.fparam1 > 0 ? opts.movement : FALLBACK_MOVEMENT;
    this.maxHp = Math.max(1, Math.trunc(opts.hp));
    this.hp = this.maxHp;
    this.thr = this.threshold();
    this.everLeader = opts.leader();
    // The ctor 0x00419214 fills the node array with the body's position.
    for (const b of this.tailBoxes) {
      b.x = opts.x;
      b.z = opts.z;
    }
    // The ctor puts the body in state 0x1d (phase 4) unless it is already dead.
    this.setState(DRAGON_STATE.intro);
  }

  // --- what the owner reads ----------------------------------------------------

  // The entity's hits do nothing (the flag 0x4000000 of the burrow states,
  // the roars and the death; the entrance has its hit boxes off).
  get invulnerable(): boolean {
    const s = this.sid;
    return s === 0x0d || s === 0x0e || s === 0x10 || s === 0x11 || s === 0x12 || s === 0x15 || s === 0x16 || s === 0x23 || s === 0x1d || (s === 0x0f && this.dug);
  }
  get superArmor(): boolean {
    return this.sid === 0x0d || this.sid === 0x15 || this.sid === 0x16;
  }
  // The entrance: the hit boxes are disabled (SaintEmilionPart_DisableAll).
  get untargetable(): boolean {
    return this.sid === DRAGON_STATE.intro;
  }
  get dying(): boolean {
    return this.sid === DRAGON_STATE.death || this.sid === DRAGON_STATE.corpse;
  }
  // The Dragon has no damage motion: no state writes animation 0xb / 0xc.
  flinches(): boolean {
    return false;
  }
  get motionSlot(): DragonSlot {
    return DRAGON_SLOTS[this.slotIndex];
  }

  // --- hp -----------------------------------------------------------------------

  // The ctor's loop and the roar's phase 5 (0x00420969-style): the largest
  // 20 % step below hp that starts at 90 %.
  private threshold(): number {
    const step = Math.trunc(this.maxHp / 10);
    let t = this.maxHp - step;
    for (let n = 0; n < 16 && this.hp <= t; n++) t -= step * 2;
    return t;
  }

  // A hit landed here (entity_hit_by_tech / the weapon hit lowered hp and set
  // the hit flag; the clamp runs on the next tick).
  hit(damage: number): void {
    this.hp -= Math.max(0, Math.round(damage));
    this.hitFlag = true;
  }

  // restore_enemy_status (6x0A from another client): hp = max - damage_taken.
  setDamageTaken(total: number): void {
    this.hp = this.maxHp - Math.max(0, Math.trunc(total));
    this.hitFlag = true;
  }

  // --- motion (Player__Animate) --------------------------------------------------

  private setSlot(i: number): void {
    this.slotIndex = i;
    this.mframe = 0;
    this.speed = DRAGON_SLOTS[i].speed;
    this.changing = true;
    this.ended = false;
    this.motionDirty = true;
  }

  private animate(): void {
    const s = this.motionSlot;
    const count = Math.max(1, this.opts.frames(s.motion));
    this.changing = false;
    this.mframe += this.speed;
    if (s.mode === 1) {
      if (this.mframe >= count) this.mframe -= count;
    } else if (this.mframe >= count - 1) {
      if (s.mode === 2) {
        this.setSlot(s.next);
        this.ended = true;
      } else {
        this.mframe = count - 1;
        this.ended = true;
      }
    }
  }

  // check_entity_animation_elapsed_threshold: the frame passed f this tick.
  private crossed(f: number): boolean {
    return this.mframe >= f && this.mframe - this.speed < f;
  }

  // --- helpers ------------------------------------------------------------------

  private emit(e: DragonEvent): void {
    this.events.push(e);
  }

  private targetNow(): AiTarget | null {
    if (this.targetId === null) return null;
    for (const t of this.last) if (t.clientId === this.targetId && !t.dead) return t;
    return null;
  }

  // set_enemy_target_by_idx (0xffff / null clears it).
  private setTarget(id: number | null): void {
    this.targetId = id === null || id === 0xffff ? null : id;
  }

  private setTargetPos(x: number, z: number): void {
    this.tx = x;
    this.tz = z;
  }

  // InitializeEnemyAnimationVelocity (0x00521410): the unit direction and the
  // distance from the body to the target position.
  private initVelocity(): void {
    const x = this.tx - this.x;
    const z = this.tz - this.z;
    const d = Math.hypot(x, z);
    this.tdist = d;
    if (d > 0) {
      this.dx = x / d;
      this.dz = z / d;
    } else {
      this.dx = 0;
      this.dz = 0;
    }
  }

  // FindEnemyTarget_00520ea0(1000): every 11th call it picks the nearest live
  // player, the others keep or drop the current target. Returns whether there
  // is a target afterwards.
  private findTarget(targets: readonly AiTarget[], now = false): boolean {
    if (!now && this.targetTimer < 10) {
      this.targetTimer++;
      if (!this.targetNow()) this.targetId = null;
      return this.targetId !== null;
    }
    this.targetTimer = 0;
    let best: AiTarget | null = null;
    let bestSq = 1000 * 1000;
    for (const t of targets) {
      if (t.dead) continue;
      const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
      if (d >= bestSq) continue;
      best = t;
      bestSq = d;
    }
    this.targetId = best ? best.clientId : null;
    return best !== null;
  }

  // GalgryphonProcessAttack / ExecutePlayerHitCheck: a step along the heading
  // (ASSUMED: the wall ray is not reproduced; the arena rim stops it).
  private step(dirX: number, dirZ: number, len: number): void {
    this.x += dirX * len;
    this.z += dirZ * len;
    const r = Math.hypot(this.x, this.z);
    if (r > DRAGON.arenaRadius) {
      this.x *= DRAGON.arenaRadius / r;
      this.z *= DRAGON.arenaRadius / r;
    }
  }
  private stepAhead(len: number): void {
    this.step(sinB(this.yaw), cosB(this.yaw), len);
  }
  // UpdateEntityRotation_005214cc: toward the direction (+0x3a8 / +0x3b0) by at
  // most `max` BAMS.
  private turnToDir(max: number): void {
    if (this.dx === 0 && this.dz === 0) return;
    this.yaw = clampAngle(this.yaw, bamsOf(this.dx, this.dz), max);
  }

  private teleport(x: number, z: number): void {
    if (Math.hypot(x - this.x, z - this.z) > 1) this.warps++;
    this.x = x;
    this.z = z;
  }

  // DragonCalculateMovementOffset (0x00425a40): the smooth turn to `to`.
  private turnSetup(to: number): void {
    const v0 = shortOf(this.m660);
    this.m660 = v0;
    const delta = turnTo(this.yaw, to);
    this.m674 = v0;
    const a2 = f32(((delta - v0 * 0.5 * 35) * -2) / 1500);
    this.m668 = this.yaw;
    this.m670 = a2;
    this.m678 = f32(a2 * -25);
    const a1 = f32(-(25 * a2 + v0) / 35);
    this.m66c = a1;
    this.m680 = 0;
    this.m67c = f32((a1 * 0.5 * 35 + v0) * 35);
  }

  // CalculateSinowbeatDiveHeight (0x0041ffc0): one tick of that turn; true once
  // it is over (60 ticks).
  private turnStep(): boolean {
    const t = 1 + this.m680;
    this.m680 = t;
    if (t <= 35) {
      this.yaw = Math.round((0.5 * this.m66c * t + this.m674) * t) + this.m668;
      return false;
    }
    if (t <= 60) {
      const u = t - 35;
      this.yaw = Math.round((0.5 * this.m670 * u + this.m678) * u + this.m67c) + this.m668;
      return false;
    }
    return true;
  }

  // An area hit of the Dragon's stats (the physical attack object: AttackData
  // row `attack`) at a world point.
  private strike(x: number, z: number, radius: number, attack = 0, knockback: number = DRAGON_GUESS.stompKnockback): void {
    this.pendingShots.push(new DragonBurst(x, 0, z, radius, { kind: 'melee', mult: 1, knockback, attack }, { color: 0xff6030, size: 2 }));
  }

  // The tech-type hit (group 1 / 0x13, power from MovementData): one burst.
  private blast(x: number, z: number, radius: number, power: number, only: readonly number[] | null = null): void {
    this.pendingShots.push(new DragonBurst(x, 0, z, radius, { kind: 'tech', power }, { color: 0xff9030, size: 3 }, only));
  }

  // The flame's origin: the recorded node 60 (recordMouth), else the ASSUMED
  // place in front of the body.
  mouth(): [number, number, number] {
    if (this.mouthPlace) return [this.mouthPlace[0], this.mouthPlace[1], this.mouthPlace[2]];
    const h = this.alt > 0 || this.air === 1 ? this.alt + DRAGON_GUESS.mouthHeightFlying : DRAGON_GUESS.mouthHeight;
    return [this.x + sinB(this.yaw) * DRAGON_GUESS.mouthForward, h, this.z + cosB(this.yaw) * DRAGON_GUESS.mouthForward];
  }

  // The mouth as the draw recorded it, in the brain's space (x, z as the body;
  // y above the ground the body stands on), or null while the model has none.
  recordMouth(p: readonly [number, number, number] | null): void {
    this.mouthPlace = p ? [p[0], p[1], p[2]] : null;
  }

  // The feet's nodes as the draw recorded them (the table slots 3..6 are
  // recorded in every state); a node the model lacks is forgotten.
  recordFeet(read: (node: number, out: [number, number, number]) => boolean): void {
    for (const n of [...DRAGON_FEET.front, ...DRAGON_FEET.back]) {
      const p: [number, number, number] = [0, 0, 0];
      if (read(n, p)) this.feetNodes.set(n, p);
      else this.feetNodes.delete(n);
    }
  }

  // The places of a stomp (side +1 at frame 3, -1 at frame 24): the x / z of
  // the recorded pair, or the ASSUMED place of one foot in front of the body.
  footPlaces(side: number): [number, number][] {
    const rec = footNodes(side).map((n) => this.feetNodes.get(n));
    if (rec.every((p) => p !== undefined)) return rec.map((p) => [p![0], p![2]]);
    const fx = sinB(this.yaw);
    const fz = cosB(this.yaw);
    return [[this.x + fx * DRAGON_GUESS.footForward + fz * DRAGON_GUESS.footSide * side, this.z + fz * DRAGON_GUESS.footForward - fx * DRAGON_GUESS.footSide * side]];
  }

  // --- states: SetEnemyAiState_0051f62c ------------------------------------------

  // Phase 5 on the old state, phase 4 on the new one.
  setState(next: number): void {
    if (this.dead) return;
    this.leave(this.sid);
    this.age = 0;
    this.c86c = this.c870 = this.c874 = 0;
    this.f884 = this.f888 = this.f88c = this.f890 = this.f894 = 0;
    this.i87c = this.i880 = 0;
    this.enter(next);
    this.sid = next;
    this.state = NAMES[next] ?? `state ${next}`;
  }

  // The leader's send: phase 6 of the new state fills x / z, then the packet
  // goes out and runs here at once (checked_call_packet0x60_subcommand).
  private sendState(next: number, send = true): void {
    this.prepare(next);
    if (send) this.emit({ kind: 'send', state: next, cursor: this.cursor, target: this.targetId, x: this.ox, z: this.oz });
    this.applyPacket(next, this.cursor, this.targetId, this.ox, this.oz);
  }

  // action_dragon (0x00423b00): a 6x12.
  private applyPacket(state: number, cursor: number, target: number | null, x: number, z: number): void {
    this.setTarget(target);
    this.cursor = cursor;
    this.ix = x;
    this.iz = z;
    this.stall = 0;
    this.receive(state);
    if (state !== this.sid) this.setState(state);
  }

  // A follower applies the leader's 6x12.
  applyRemote(state: number, cursor: number, target: number | null, x: number, z: number): void {
    this.applyPacket(state, cursor, target, x, z);
  }

  // The direct packet of the entrance (state 0, no phase 6).
  private sendRaw(state: number, send = true): void {
    if (send) this.emit({ kind: 'send', state, cursor: this.cursor, target: this.targetId, x: this.ox, z: this.oz });
    this.applyPacket(state, this.cursor, this.targetId, this.ox, this.oz);
  }

  // The table walk of every phase 9 that picks the next state.
  private pickNext(send = true): void {
    const n = dragonNext(this.cursor, this.ultimate);
    this.cursor = n.cursor;
    this.sendState(n.state, send);
  }

  // --- the leader's step: UpdateDragonAiState (0x00423f74) -------------------------

  private leaderStep(send: boolean): void {
    if (this.cursor < DRAGON_CURSOR_B) {
      if (!(this.flags & NO_ROAR)) {
        // control_dragon_low_hp_roar (0x0042093c).
        if (this.thr >= this.hp) {
          this.hp = this.thr;
          this.cursor = DRAGON_CURSOR_B;
          this.sendState(this.air === 0 ? DRAGON_STATE.roar : DRAGON_STATE.landRoar, send);
          return;
        }
        // CheckDragonAttackReady (0x00424110) tests the same condition and so
        // never fires after the roar's; kept for the record.
      }
    } else if (!(this.flags & NO_DEATH) && this.hp < 1) {
      this.sendState(this.air !== 1 ? DRAGON_STATE.death : DRAGON_STATE.landDie, send);
      return;
    }
    // ASSUMED: the exe has no timeout in its states (its motions are as long
    // as the exe expects); one that is shorter than a frame test must not leave
    // the boss stuck, so the leader leaves a state that has lasted this long.
    if (++this.age > DRAGON_GUESS.stateMax && this.sid !== DRAGON_STATE.corpse) {
      this.age = 0;
      this.forceNext(send);
      return;
    }
    this.pick(send);
  }

  // The follow-up each state's phase 9 would pick, without its test.
  private forceNext(send: boolean): void {
    const S = DRAGON_STATE;
    switch (this.sid) {
      case S.intro:
        return this.sendRaw(S.wait, send);
      case S.death:
        return this.sendState(S.corpse, send);
      case S.landCollapse:
        return this.sendState(S.collapse, send);
      case S.landRoar:
        return this.sendState(S.roar, send);
      case S.landDie:
        return this.sendState(S.death, send);
      default:
        return this.pickNext(send);
    }
  }

  tick(targets: readonly AiTarget[]): AiFrame {
    const out = this.frame0();
    this.last = targets;
    if (this.dead) return this.finish0(out);
    const leaderNow = this.opts.leader();
    if (leaderNow && !this.everLeader) this.takeover = true;
    this.everLeader = leaderNow;
    // The hit clamp (OlgaUpdateMainLoop): hp never goes under +0x688 while the
    // first sequence runs.
    if (this.hitFlag) {
      if (this.cursor < DRAGON_CURSOR_B && this.thr > this.hp) this.hp = this.thr;
      this.hitFlag = false;
    }
    if (leaderNow) {
      this.leaderStep(true);
      if (!this.dead) this.leaderPost(targets);
    } else if (++this.stall >= DRAGON_GUESS.followerWait) {
      // ASSUMED: the exe has no resync for a follower (it runs phase 0 and
      // waits for the 6x12). So that a lost packet or a late join cannot leave
      // the body stuck, a follower that has heard nothing this long takes the
      // leader's step itself, without sending.
      this.stall = 0;
      this.leaderStep(false);
    }
    if (!this.dead) this.frameState();
    if (this.motionDirty) {
      this.motionDirty = false;
      const s = this.motionSlot;
      this.play(out, { index: s.motion, speed: s.speed, loop: s.mode === 1 });
    }
    return this.finish0(out);
  }

  private frame0(): AiFrame {
    return { motion: null, x: this.x, z: this.z, angle: this.yaw * BAMS, hit: null };
  }

  private finish0(out: AiFrame): AiFrame {
    out.x = this.x;
    out.z = this.z;
    this.angle = this.yaw * BAMS;
    out.angle = this.angle;
    out.lift = this.alt;
    if (this.pendingShots.length) out.shots = this.pendingShots.splice(0);
    return out;
  }

  onDamage(): void {
    // No flinch: hits only lower hp (the clamp and the thresholds do the rest).
  }

  resume(): string {
    return this.state;
  }

  // --- phase 4: enter ------------------------------------------------------------

  private enter(s: number): void {
    const S = DRAGON_STATE;
    switch (s) {
      case S.intro:
        // 0x0041b220 phase 4: bossop at the origin; sub-state 1 (2 in
        // Ultimate) runs until the motion ends.
        this.setSlot(25);
        this.air = 0;
        this.x = 0;
        this.z = 0;
        this.yaw = 0;
        this.alt = 0;
        this.c86c = this.ultimate ? 2 : 1;
        this.animate();
        return;
      case S.wait:
        return;
      case S.walk: {
        // 0x00423070: animation 1; +0x884 is the turn radius of the walk plus 5.
        this.setSlot(1);
        this.air = 0;
        this.alt = 0; // EnemySinowbeat_SetupState: +0x5e0 = ground y
        this.flags &= ~0xe80;
        const c = this.walkSpeed();
        this.f884 = f32(5 + (this.ultimate ? sineScaled(Math.round(320 * c), c) : sineScaled(0x100, 0.8)));
        return;
      }
      case S.fire:
        // 0x00422a08: the breath starts (animation 4, 2 flames' worth of delay).
        this.setSlot(4);
        this.air = 0;
        this.alt = 0;
        this.flags &= ~0xe80;
        this.c870 = 2;
        return;
      case S.tail:
        // 0x004227dc: animation 7 with the tail's hit list live (phase 4 resets
        // the list: GamelistobjectSetChildActive_00426b98).
        this.setSlot(7);
        this.tailSeen.clear();
        this.air = 0;
        this.alt = 0;
        this.flags = (this.flags & ~0xc80) | 0x200;
        return;
      case S.flyUp:
        // 0x00422430: animation 15 (lift).
        this.setSlot(15);
        this.animate();
        this.air = 0;
        this.alt = 0;
        this.flags &= ~0xe80;
        this.f884 = 0;
        return;
      case S.flyAcross: {
        // 0x00421ecc: fly (animation 16) at 180 across the arena.
        this.setSlot(16);
        this.air = 1;
        this.alt = DRAGON.flightAltitude;
        this.flags &= ~0xe80;
        this.initVelocity();
        this.posProfile.set(0.1, -0.1, this.tdist, this.ultimate ? this.mv.fparam6 : 2);
        this.startX = this.x;
        this.startZ = this.z;
        const to = bamsOf(this.dx, this.dz);
        let d = turnTo(this.yaw, to);
        if (d < 0) {
          this.sign664 = -1;
          d = -d;
        } else this.sign664 = 1;
        this.headProfile.set(16, -16, d, this.ultimate ? Math.round(256 * this.mv.fparam6) : 512);
        this.i87c = this.yaw;
        return;
      }
      case S.flyShoot:
        // 0x00421494: fly at 180, no target picked yet.
        this.setSlot(16);
        this.air = 1;
        this.alt = DRAGON.flightAltitude;
        this.flags &= ~0xe80;
        return;
      case S.land:
      case S.landCollapse:
      case S.landRoar:
      case S.landDie:
        // 0x00420ee8: animation 17 (land) from the flight altitude.
        this.setSlot(17);
        this.air = 0;
        this.alt = DRAGON.flightAltitude;
        this.flags |= 0xe80;
        return;
      case S.collapse:
        // 0x004203cc: animation 8 (fall), then 9 (lie), 10 (get up). Its phase 4 plays
        // 0x31a at the Dragon (0x00420502).
        this.setSlot(8);
        this.air = 0;
        this.flags = (this.flags & ~0x800) | 0x680;
        this.emit({ kind: 'se', id: 0x31a });
        return;
      case S.roar:
        // 0x004201f4: animation 2 (the roar), invulnerable and super armor.
        this.setSlot(2);
        this.air = 0;
        this.alt = 0;
        this.flags = (this.flags & ~0x280) | 0xc00;
        return;
      case S.roarAir:
        // 0x0042008c: hover with the roar jingle.
        this.setSlot(16);
        this.air = 1;
        this.alt = DRAGON.flightAltitude;
        this.flags = (this.flags & ~0x280) | 0xc00;
        this.emit({ kind: 'bgm', name: 'draroar.adx' });
        return;
      case S.dive:
        return this.enterDive();
      case S.burrowFirst:
      case S.burrowNext:
        // 0x0041f238: underground; the counter (+0x6e4) is reset by 0x10.
        this.burrowEnter();
        this.burrows = s === S.burrowFirst ? 0 : this.burrows + 1;
        this.f888 = f32(this.burrows * DRAGON.burrowCap + DRAGON.burrowBase);
        return;
      case S.burrowOut:
        // 0x0041ed68: underground at the current counter's speed.
        this.burrowEnter();
        this.f888 = f32(this.burrows * DRAGON.burrowCap + DRAGON.burrowBase);
        if (this.ultimate && this.burrows === 2) this.f888 = f32(3 * DRAGON.burrowCap + DRAGON.burrowBase);
        return;
      case S.emerge:
        // 0x0041e3f8: animation 24 (tobidasi), underground.
        this.setSlot(24);
        this.animate();
        this.air = 2;
        this.alt = DRAGON.undergroundAltitude;
        this.flags = (this.flags & ~0x380) | 0xc00;
        return;
      case S.death:
        // 0x0041db28: animation 19 (dead), invulnerable and super armor; the
        // death theme starts.
        this.setSlot(19);
        this.air = 0;
        this.alt = 0;
        this.flags |= 0xe80;
        this.emit({ kind: 'bgm', name: 'dradeath.adx' });
        return;
      case S.corpse:
        this.setSlot(19);
        this.air = 0;
        this.alt = 0;
        this.flags |= 0xe80;
        return;
      case S.rain:
        // 0x0041a888 (Ultimate): hover (animation 22) and raise.
        this.setSlot(22);
        this.air = 1;
        this.alt = DRAGON.flightAltitude;
        this.flags = (this.flags & ~0x280) | 0xc00;
        this.f884 = 13; // 0x00a436dc
        return;
      case S.circle:
        // 0x0041a364 (Ultimate): underground, spiralling in at counter * 4 + 4
        // (times 2.5 along the arc) from a radius of 350.
        this.burrowEnter();
        this.f888 = f32(this.burrows * DRAGON.burrowCap + DRAGON.burrowBase);
        this.f884 = f32(this.f888 * 2.5);
        this.f88c = DRAGON.arenaRadius;
        return;
      default:
        // A state this port does not reproduce (the pad-only ones): stand.
        this.setSlot(0);
        this.air = 0;
        this.alt = 0;
    }
  }

  // The shared enter of the underground states: vulnerable flag cleared, then
  // hidden (+0x174 / +0x180) 400 below the floor.
  private burrowEnter(): void {
    this.air = 2;
    this.alt = DRAGON.undergroundAltitude;
    this.flags = (this.flags & ~0x380) | 0xc00;
    this.seen.clear();
  }

  private walkSpeed(): number {
    return this.ultimate ? this.mv.fparam5 : DRAGON.walkSpeed;
  }

  // --- phase 5: leave ------------------------------------------------------------

  private leave(s: number): void {
    const S = DRAGON_STATE;
    switch (s) {
      case S.intro:
        // 0x0041b5ca phase 5: the flame's emitter is stopped (+0x8b4 cleared).
        this.stopMouth();
        return;
      case S.roar:
        // 0x004201f4 phase 5: the next hp clamp, from the hp it is at.
        this.thr = this.threshold();
        return;
      case S.death:
        // EnemyOnKilledHandler_0051f894 + set_quest_flag(0x17): every client.
        this.dead = true;
        this.emit({ kind: 'killed', x: this.x, z: this.z });
        return;
      case S.dive:
        this.dug = false;
        return;
      case S.land:
      case S.landCollapse:
      case S.landRoar:
      case S.landDie:
        // 0x00420ee8 phase 5: EnemySinowbeat_SetupState.
        this.alt = 0;
        return;
      default:
    }
  }

  // --- phase 6: the new state fills the 6x12's x / z --------------------------------

  // A target on the arena's rim slots (0x1555 BAMS apart, 100..220 out): the
  // radius of a slot is rolled the first time it is used.
  private rimPoint(): void {
    let slotNo = Math.min(DRAGON.rimSlots - 1, Math.floor(this.rng() * DRAGON.rimSlots));
    let radius: number;
    if (this.rimUsed < DRAGON.rimSlots) {
      this.rimUsed++;
      for (let n = 0; n < DRAGON.rimSlots && this.rim[slotNo] !== 0; n++) slotNo = (slotNo + 1) % DRAGON.rimSlots;
      radius = f32(100 + this.rng() * 120);
      this.rim[slotNo] = radius;
    } else radius = this.rim[slotNo];
    this.tx = sinB(slotNo * 0x1555) * radius;
    this.tz = cosB(slotNo * 0x1555) * radius;
  }

  private prepare(next: number): void {
    const S = DRAGON_STATE;
    switch (next) {
      case S.walk: {
        // +0x3b8 = +0x3bc, FindEnemyTarget(1000): the target position, or the
        // origin without one.
        const got = this.findTarget(this.last, true);
        const t = got ? this.targetNow() : null;
        if (t) this.setTargetPos(t.x, t.z);
        else this.setTargetPos(0, 0);
        this.ox = this.tx;
        this.oz = this.tz;
        return;
      }
      case S.fire: {
        const t = this.targetNow();
        if (t) this.setTargetPos(t.x, t.z);
        else {
          const m = this.mouth();
          this.setTargetPos(m[0] + sinB(this.yaw) * DRAGON.mouthAhead, m[2] + cosB(this.yaw) * DRAGON.mouthAhead);
        }
        this.ox = this.tx;
        this.oz = this.tz;
        return;
      }
      case S.flyAcross: {
        // SinowbeatNormalizeXZVector_004223ac: across the centre in the first
        // sequence (100 out on the other side), the centre in the second.
        if (this.cursor < DRAGON_CURSOR_B) {
          const r = Math.hypot(this.x, this.z);
          this.tx = r > 0 ? (this.x / r) * -100 : 0;
          this.tz = r > 0 ? (this.z / r) * -100 : 0;
        } else {
          this.tx = 0;
          this.tz = 0;
        }
        this.ox = this.tx;
        this.oz = this.tz;
        return;
      }
      case S.dive:
        this.rimPoint();
        this.initVelocity();
        this.ox = this.tx;
        this.oz = this.tz;
        return;
      case S.emerge:
        this.rimPoint();
        this.ox = this.tx;
        this.oz = this.tz;
        return;
      case S.burrowFirst:
      case S.burrowNext:
      case S.circle: {
        // A random point on the rim: the body goes there at once (it is
        // underground) and sends it.
        const a = Math.floor(this.rng() * 65536);
        this.teleport(DRAGON.arenaRadius * sinB(a), DRAGON.arenaRadius * cosB(a));
        this.ox = this.x;
        this.oz = this.z;
        return;
      }
      case S.burrowOut:
        return this.burrowAim();
      case S.flyUp:
      case S.land:
      case S.landCollapse:
      case S.landRoar:
      case S.landDie:
      case S.roar:
      case S.roarAir:
      case S.rain:
        this.ox = this.x;
        this.oz = this.z;
        return;
      default:
    }
  }

  // State 0x12's phase 6: one of the players in front (within 67.5 degrees of
  // the heading) as the target, then a point 350 along the way to it.
  private burrowAim(): void {
    this.cand.length = 0;
    const fx = sinB(this.yaw);
    const fz = cosB(this.yaw);
    const cone = Math.cos(0x3000 * BAMS);
    for (const t of this.last) {
      if (t.dead) continue;
      const x = t.x - this.x;
      const z = t.z - this.z;
      const d = Math.hypot(x, z);
      if (d > 0 && (x * fx + z * fz) / d > cone) this.cand.push(t);
    }
    if (this.cand.length === 0) {
      this.targetId = null;
      this.dx = fx;
      this.dz = fz;
    } else {
      const pick = this.cand.length === 1 ? this.cand[0] : this.cand[Math.min(this.cand.length - 1, Math.floor(this.rng() * this.cand.length))];
      this.targetId = pick.clientId;
      this.setTargetPos(pick.x, pick.z);
      this.initVelocity();
    }
    this.tx = this.dx * DRAGON.arenaRadius;
    this.tz = this.dz * DRAGON.arenaRadius;
    this.ox = this.tx;
    this.oz = this.tz;
  }

  // --- phase 7: a 6x12's x / z arrived -----------------------------------------------

  private receive(state: number): void {
    const S = DRAGON_STATE;
    switch (state) {
      case S.walk:
      case S.fire:
      case S.flyAcross:
      case S.burrowOut:
        this.setTargetPos(this.ix, this.iz);
        return;
      case S.dive:
        this.setTargetPos(this.ix, this.iz);
        this.initVelocity();
        return;
      case S.flyUp:
      case S.land:
      case S.landCollapse:
      case S.landRoar:
      case S.landDie:
      case S.roar:
      case S.roarAir:
        this.teleport(this.ix, this.iz);
        return;
      case S.rain:
        // init_rng(round(x * K) << 16 | round(z * K) & 0xffff): every client
        // draws the same fireball spots. ASSUMED K and generator.
        this.teleport(this.ix, this.iz);
        this.rain = (((Math.round(this.ix * 1000) << 16) | (Math.round(this.iz * 1000) & 0xffff)) >>> 0) || 1;
        return;
      default:
    }
  }

  private rainRandom(): number {
    this.rain = (Math.imul(this.rain, 1664525) + 1013904223) >>> 0;
    return this.rain / 0x100000000;
  }

  // --- phase 8: the leader's check before the frame ----------------------------------

  private leaderPost(targets: readonly AiTarget[]): void {
    if (this.sid !== DRAGON_STATE.walk) return;
    // 0x00423070 phase 8: find the target every tick; every 20th tick (the
    // counter at 19) send the tracking 6x12 with the target's position.
    this.findTarget(targets);
    this.c86c++;
    if (this.c86c % 20 === 19) {
      const t = this.targetNow();
      if (t) this.setTargetPos(t.x, t.z);
      else this.setTargetPos(0, 0);
      this.ox = this.tx;
      this.oz = this.tz;
      this.emit({ kind: 'send', state: this.sid, cursor: this.cursor, target: this.targetId, x: this.ox, z: this.oz });
      this.applyPacket(this.sid, this.cursor, this.targetId, this.ox, this.oz);
    }
  }

  // --- phase 9: pick the next state (leader) -----------------------------------------

  private pick(send: boolean): void {
    const S = DRAGON_STATE;
    switch (this.sid) {
      case S.intro:
        if (this.c86c === 4) this.sendRaw(S.wait, send);
        return;
      case S.wait:
        return this.pickNext(send);
      case S.walk: {
        // 0x00423070 phase 9: 150 ticks with a target and arrived (or the
        // target within 35 of the point 185 ahead; in Ultimate 600 ticks), or
        // 300 ticks whatever happens.
        const n = this.c86c;
        if (n >= DRAGON_GUESS.walkMax) {
          this.pickNext(send);
          return;
        }
        const has = this.targetId !== null && this.targetNow() !== null;
        if (n < 0x96 || !has) {
          if (n > 299) this.pickNext(send);
          return;
        }
        const ahx = this.x + sinB(this.yaw) * DRAGON.walkAhead;
        const ahz = this.z + cosB(this.yaw) * DRAGON.walkAhead;
        if (this.tdist < this.f884 || Math.hypot(this.tx - ahx, this.tz - ahz) <= DRAGON.walkTargetNear || (this.ultimate && n > 599)) this.pickNext(send);
        return;
      }
      case S.fire:
        if (this.c86c === 3) this.pickNext(send);
        return;
      case S.tail:
        if (this.ended) this.pickNext(send);
        return;
      case S.flyUp:
        if (this.f884 < 0) this.pickNext(send);
        return;
      case S.flyAcross:
        if (this.c86c === 2) this.pickNext(send);
        return;
      case S.flyShoot:
        if (this.c86c === 4) this.pickNext(send);
        return;
      case S.land:
      case S.landCollapse:
      case S.landRoar:
      case S.landDie:
        if (!this.ended) return;
        if (this.sid === S.landCollapse) this.sendState(S.collapse, send);
        else if (this.sid === S.landRoar) this.sendState(S.roar, send);
        else if (this.sid === S.landDie) this.sendState(S.death, send);
        else this.pickNext(send);
        return;
      case S.collapse:
        // ProcessDragonCommandState (0x004207c4): after the roar check, the next
        // action of the sequence.
        if (this.c870 === 2 && this.ended) this.pickNext(send);
        return;
      case S.roar:
        if (this.ended) this.pickNext(send);
        return;
      case S.roarAir:
        if (this.c86c > 0x3b) this.pickNext(send);
        return;
      case S.dive:
        if (this.c86c === 4) this.pickNext(send);
        return;
      case S.burrowFirst:
      case S.burrowNext:
        // The new leader (horiz_dist != 0) picks at once; the old one waits for
        // the emergence point's distance.
        if (this.takeover) {
          this.takeover = false;
          this.pickNext(send);
        } else if (this.c86c === 1 && Math.hypot(this.x, this.z) < 50) this.pickNext(send);
        return;
      case S.burrowOut:
        if (Math.hypot(this.x, this.z) > DRAGON.arenaRadius) this.pickNext(send);
        return;
      case S.emerge:
        if (this.c86c === 6) this.pickNext(send);
        return;
      case S.death:
        if (this.c870 > 49) this.sendState(S.corpse, send);
        return;
      case S.corpse:
        return;
      case S.rain:
        if (this.c86c === 6) this.pickNext(send);
        return;
      case S.circle:
        if (this.takeover) {
          this.takeover = false;
          this.pickNext(send);
        } else if (this.c86c === 2) this.pickNext(send);
        return;
      default:
        // A pad-only state the sequences never reach (ASSUMED: it ends).
        if (++this.c874 >= DRAGON_GUESS.fallbackWait) this.pickNext(send);
    }
  }

  // --- phase 0: the frame ----------------------------------------------------------

  private frameState(): void {
    const S = DRAGON_STATE;
    switch (this.sid) {
      case S.intro:
        return this.tickIntro();
      case S.walk:
        return this.tickWalk();
      case S.fire:
        return this.tickFire();
      case S.tail:
        return this.tickTail();
      case S.flyUp:
        return this.tickFlyUp();
      case S.flyAcross:
        return this.tickFlyAcross();
      case S.flyShoot:
        return this.tickFlyShoot();
      case S.land:
      case S.landCollapse:
      case S.landRoar:
      case S.landDie:
        return this.tickLand();
      case S.collapse:
        return this.tickCollapse();
      case S.roar:
        this.animate();
        if (this.crossed(20)) this.emit({ kind: 'bgm', name: 'draroar.adx' });
        return;
      case S.roarAir:
        this.animate();
        this.c86c++;
        // 0x0042008c case 0: 0x0041ebc0 (SE 0x318 at frame 5) before the take-off.
        this.animSound();
        // 0x004201ba: the take-off helper (0x0041c768) at frame 14.
        if (this.crossed(14)) this.emitBody(this.ultimate ? DRAGON_PARTICLE_IDS.ultimate.f04 : DRAGON_PARTICLE_IDS.normal.f04);
        return;
      case S.dive:
        return this.tickDive();
      case S.burrowFirst:
      case S.burrowNext:
        return this.tickBurrow(true);
      case S.burrowOut:
        return this.tickBurrowOut();
      case S.emerge:
        return this.tickEmerge();
      case S.death:
        return this.tickDeath();
      case S.rain:
        return this.tickRain();
      case S.circle:
        return this.tickCircle();
      default:
        // The corpse and the pad-only states just run their motion.
        this.animate();
    }
  }

  // 0x00423070 phase 0: the stomping walk. The animation runs at 0.6 x the walk
  // speed (0.125 x on the frame after a change); steps and turns happen in
  // frame windows, the feet strike at 3 and 24.
  private tickWalk(): void {
    const c = this.walkSpeed();
    this.speed = f32(c * (this.changing ? 0.125 : 0.6));
    this.animate();
    // 0x00423070 phase 0 calls TriggerSinowbeatSoundEffect (0x0041d3d0) after the
    // animation: 0x315 (the walk's dust, 0x0041d403) at frame 4 or 24.5. ASSUMED: the
    // input walk (the dump's handle_input_state_dragon_walk, exe address not read) calls
    // it too under its field 0xb8 == 1 gate; the port has one walk state, so one sound.
    if (this.passed(4) || this.passed(24.5)) this.emit({ kind: 'se', id: 0x315 });
    this.initVelocity();
    if (this.crossed(3)) this.footStrike(1);
    else if (this.crossed(24)) this.footStrike(-1);
    const f = this.mframe;
    const turn = Math.round(c * 320);
    if (f < 4) this.stepAhead(c);
    else if (f >= 9) {
      if (f < 19) {
        this.turnToDir(turn);
        this.stepAhead(c);
      } else if (f < 24) this.stepAhead(c);
      else if (f >= 30) {
        this.turnToDir(turn);
        this.stepAhead(c);
      }
    }
  }

  // The stomp's attack objects: one per node of the pair, radius 15, AttackData
  // row 0 (0x0041d410 / 0x0041d504 call 0x0051fdf8 for each node). Each foot
  // also makes the stomp's particle (0x0041d4f6 / 0x0041d5ea, +0x0c). ASSUMED:
  // one emitter per foot, on the ground.
  private footStrike(side: number): void {
    const ids = this.ultimate ? DRAGON_PARTICLE_IDS.ultimate : DRAGON_PARTICLE_IDS.normal;
    for (const [px, pz] of this.footPlaces(side)) {
      this.strike(px, pz, DRAGON.stompRadius, 0);
      this.emit({ kind: 'particle', id: ids.stomp, x: px, y: 0, z: pz });
    }
  }

  // 0x00422a08 phase 0: turn to the target (0xa0 a frame) while the breath
  // starts, 120 ticks of flames from every other frame, the breath ends.
  private tickFire(): void {
    this.animate();
    if (this.c86c === 0) {
      this.initVelocity();
      if (this.dx !== 0 || this.dz !== 0) this.yaw = clampAngle(this.yaw, bamsOf(this.dx, this.dz), 0xa0);
      if (this.ended) {
        this.c86c = 1;
        this.setSlot(5);
      }
    } else if (this.c86c === 1) {
      if (++this.c874 < 0x78) {
        if (!this.changing) {
          this.emit({ kind: 'se', id: 0x321 });
          if (++this.c870 > 1) {
            this.flame();
            this.c870 = 0;
          }
        }
      } else {
        this.setSlot(6);
        this.c86c = 2;
        this.c870 = 0;
      }
    } else if (this.c86c === 2) {
      this.c870++;
      // 0x00422dc8: the 30 frames after the breath still play 0x321 (0x00422ddb).
      if (this.c870 < DRAGON_SE.breathAfterFrames) this.emit({ kind: 'se', id: DRAGON_SE.breath });
      if (this.ended) this.c86c = 3;
    }
  }

  // GameListObject_Constructor_004264a4: a flame from the mouth, along the
  // line to the aim point (the target, or 115 ahead of the mouth).
  private flame(): void {
    const m = this.mouth();
    const t = this.targetNow();
    const ax = t ? t.x : m[0] + sinB(this.yaw) * DRAGON.mouthAhead;
    const az = t ? t.z : m[2] + cosB(this.yaw) * DRAGON.mouthAhead;
    const vx = ax - m[0];
    const vy = -m[1];
    const vz = az - m[2];
    const len = Math.hypot(vx, vy, vz) || 1;
    this.pendingShots.push(new DragonFlame(m[0], m[1], m[2], vx / len, vy / len, vz / len, this.mv.fparam1));
  }

  // Whether the owner should record the tail's nodes this frame (only the
  // tail swipe reads them; the feet and the mouth are recorded in every state).
  get wantsNodes(): boolean {
    return this.sid === DRAGON_STATE.tail;
  }

  // The tail object's update, first half (0x00426ba8): box i goes to the world
  // position of node DRAGON_NODE_TABLE[15 + i], as the model draw recorded it
  // (slots from 18 on only with flag 0x200 of +0x3c8; the others keep their
  // last value), and is low or high against 30 above the body's y.
  // `read` writes a node's world position into `out` and says whether the
  // model has that node.
  recordNodes(read: (node: number, out: [number, number, number]) => boolean, y: number): void {
    const p: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < DRAGON_TAIL.count; i++) {
      const slot = DRAGON_TAIL.firstSlot + i;
      if (slot >= DRAGON_TAIL.alwaysSlots && !(this.flags & DRAGON_TAIL.recordFlag)) continue;
      if (!read(DRAGON_NODE_TABLE[slot], p)) continue;
      const b = this.tailBoxes[i];
      b.x = p[0];
      b.y = p[1];
      b.z = p[2];
      b.low = !(DRAGON_TAIL.highFrom <= p[1] - y);
    }
  }

  // 0x004227dc phase 0: the tail swipe. From the second tick the tail object
  // updates every tick: its boxes strike the players they touch, once each
  // until the hit list is reset (the frame 10 and frame 23 crossings).
  private tickTail(): void {
    this.animate();
    this.c86c++;
    // 0x004227dc phase 0 (after the counter): 0x31d at the Dragon at frame 0 or 12 (call 0x00422979).
    if (this.passed(0) || this.passed(12)) this.emit({ kind: 'se', id: 0x31d });
    if (this.c86c <= 1) return;
    if (this.crossed(DRAGON_TAIL.resetFrames[0]) || this.crossed(DRAGON_TAIL.resetFrames[1])) this.tailSeen.clear();
    this.tailContact();
  }

  // 0x00521eb8 with the context {3.0, 1}. ASSUMED: only the low boxes touch a
  // player (the exe tests in 3D and the targets carry no height; the swipe is
  // low in frames 3..18 and the tip rises well above a player outside them),
  // and the player's box is the shared 5-unit disc.
  private tailContact(): void {
    const r = DRAGON_TAIL.radius + PLAYER_RADIUS;
    for (const t of this.last) {
      if (t.dead || this.tailSeen.has(t.clientId)) continue;
      for (const b of this.tailBoxes) {
        if (!b.low || Math.hypot(t.x - b.x, t.z - b.z) > r) continue;
        this.tailSeen.add(t.clientId);
        this.pendingShots.push(
          new DragonBurst(t.x, 0, t.z, 0, { kind: 'melee', mult: 1, knockback: DRAGON_TAIL.knockback, attack: DRAGON_TAIL.attackRow }, { color: 0xff6030, size: 2 }, [t.clientId]),
        );
        break;
      }
    }
  }

  // 0x00422430 phase 0: at frame 40 of the lift motion the jump starts, a
  // ballistic arc that peaks at 180.
  private tickFlyUp(): void {
    this.c86c++;
    if (this.c870 === 0 && this.mframe + this.speed >= 40) {
      this.f888 = DRAGON_GUESS.animYOffset;
      this.f884 = f32(Math.sqrt((DRAGON.flightAltitude - this.f888) * -2 * DRAGON.gravityUp));
      this.c870 = 1;
      this.flags |= 0xc00;
      this.air = 1;
    }
    this.animate();
    // 0x00422430 phase 0: 0x318 at frame 14 (0x00422677), 0x317 at 42 (0x0042269f).
    if (this.passed(14)) this.emit({ kind: 'se', id: 0x318 });
    if (this.passed(42)) this.emit({ kind: 'se', id: 0x317 });
    // 0x004226b7: the body's particle (+0x04) when the lift motion passes frame 46.
    if (this.crossed(46)) this.emitBody(this.ultimate ? DRAGON_PARTICLE_IDS.ultimate.f04 : DRAGON_PARTICLE_IDS.normal.f04);
    if (this.c870 === 1) {
      this.alt = this.f888;
      this.f888 += this.f884;
      this.f884 += DRAGON.gravityUp;
    }
  }

  // 0x00421ecc phase 0: turn along the easing, then glide across.
  private tickFlyAcross(): void {
    this.animate();
    // 0x00421ecc case 0: 0x0041ebc0 (SE 0x318 at frame 5) every tick, then the take-off
    // helper 0x0041c768 (particle +0x04 at the body, gated on frame 14; 0x004221a9 and
    // 0x004221b0 in this function, DEVLOG 2026-10-24).
    this.animSound();
    if (this.crossed(14)) this.emitBody(this.pids().f04);
    if (this.c86c === 0) {
      this.f884 += 1;
      this.yaw = Math.trunc(this.i87c + this.sign664 * this.headProfile.value(this.f884));
      if (this.headProfile.done(this.f884)) {
        this.f884 = 0;
        this.c86c = 1;
      }
    } else if (this.c86c === 1) {
      this.f884 += 1;
      const v = this.posProfile.value(this.f884);
      this.x = this.dx * v + this.startX;
      this.z = this.dz * v + this.startZ;
      if (this.posProfile.done(this.f884)) this.c86c = 2;
    }
  }

  // 0x00421494 phase 0: aim at the players (or at random), turn with the easing,
  // play the flyshot motion and throw three fireballs at its frame 47; twice.
  private tickFlyShoot(): void {
    this.animate();
    const sub = this.c86c;
    if (sub === 2) {
      // 0x00421494 sub-state 2: 0x318 at frame 2 (0x004215d5), 0x31e at 45 (0x00421601).
      if (this.passed(2)) this.emit({ kind: 'se', id: 0x318 });
      if (this.passed(45)) this.emit({ kind: 'se', id: 0x31e });
      // 0x0042162e: the take-off helper (+0x04) at frame 14 or 53, before the mouth.
      if (this.crossed(14) || this.crossed(53)) this.emitBody(this.pids().f04);
      this.tickMouth();
      if (this.crossed(47)) {
        this.volley();
        // ASSUMED: the flame ends with the volley (the exe has no stop after sub-state 2).
        this.stopMouth();
        this.c86c = 3;
        this.c874 = 0;
        this.flags &= ~0xc00;
      }
      return;
    }
    if (sub === 3) {
      if (++this.c874 > 10) {
        this.c870++;
        this.c86c = this.c870 < 2 ? 0 : 4;
      }
      return;
    }
    if (sub === 4) return;
    if (sub === 0) {
      // 0x00421494 case 0 has no take-off (the call at 0x004221b0 is flyAcross's, DEVLOG 2026-10-24).
      this.aimVolley();
      this.c86c = 1;
      this.sign664 = turnTo(this.yaw, this.i87c) >= 0 ? 1 : -1;
      this.turnSetup(this.i87c);
    }
    // 0x00421972 (the turn, sub-state 1): 0x0041ebc0, SE 0x318 at frame 5. ASSUMED: the
    // call sits in the turn's block, as the take-off below does (0x0042197a).
    if (sub === 1) this.animSound();
    // 0x0042197a: the take-off helper (0x0041c768, gated on frame 14) while it turns.
    if (sub === 1 && this.crossed(14)) this.emitBody(this.pids().f04);
    if (this.turnStep()) {
      this.yaw = this.i87c;
      this.setSlot(18);
      this.m660 = 0;
      this.flags |= 0xc00;
      this.c86c = 2;
    }
  }

  // The target point of a volley (+0x898 / +0x8a0) and the heading to it
  // (+0x87c): a live player far enough away (the healthiest, or the best pair
  // that stands close together), else a random point 125 out.
  private aimVolley(): void {
    this.cand.length = 0;
    for (const t of this.last) if (!t.dead && (t.x - this.x) ** 2 + (t.z - this.z) ** 2 >= DRAGON.shotMinDistSq) this.cand.push(t);
    const n = this.cand.length;
    if (n === 0) {
      const a = Math.round(65535 * this.rng());
      this.i87c = a;
      this.velX = sinB(a) * DRAGON.volleyAim;
      this.velZ = cosB(a) * DRAGON.volleyAim;
      return;
    }
    let px = 0;
    let pz = 0;
    if (n === 1) {
      px = this.cand[0].x;
      pz = this.cand[0].z;
    } else {
      let best = 0;
      let found = false;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = this.cand[i];
          const b = this.cand[j];
          if (Math.hypot(a.x - b.x, a.z - b.z) < 100) {
            const sum = this.opts.playerHp(a.clientId) + this.opts.playerHp(b.clientId);
            found = true;
            if (best < sum) {
              px = (a.x + b.x) * 0.5;
              pz = (a.z + b.z) * 0.5;
              best = sum;
            }
          }
        }
      }
      if (!found) {
        let top = 0;
        px = this.velX;
        pz = this.velZ;
        for (const t of this.cand) {
          const h = this.opts.playerHp(t.clientId);
          if (top < h) {
            px = t.x;
            pz = t.z;
            top = h;
          }
        }
      }
    }
    this.velX = px;
    this.velZ = pz;
    this.i87c = bamsOf(px - this.x, pz - this.z);
  }

  // Three fireballs from the mouth: at the point and at the same distance 22.5
  // degrees to either side.
  private volley(): void {
    const m = this.mouth();
    const vx = this.velX - this.x;
    const vz = this.velZ - this.z;
    const d = Math.hypot(vx, vz);
    const ux = d > 0 ? vx / d : 0;
    const uz = d > 0 ? vz / d : 0;
    const power = this.mv.fparam2;
    this.launch(m);
    this.fireball(m, [this.velX, 0, this.velZ], power);
    for (const a of [DRAGON.volleySpread, -DRAGON.volleySpread]) {
      const c = cosB(a);
      const s = sinB(a);
      // RotateVector2D: x' = x cos + z sin, z' = z cos - x sin.
      const rx = ux * c + uz * s;
      const rz = uz * c - ux * s;
      this.launch(m);
      this.fireball(m, [rx * d + this.x, 0, rz * d + this.z], power);
    }
  }

  // The launch flash of a flyShoot fireball at the mouth (0x004218eb: the
  // mouth node +0x414 is in ebx, the table's +0x1c). ASSUMED: one flash per
  // fireball of the volley.
  private launch(m: readonly [number, number, number]): void {
    const ids = this.ultimate ? DRAGON_PARTICLE_IDS.ultimate : DRAGON_PARTICLE_IDS.normal;
    this.emit({ kind: 'particle', id: ids.launch, x: m[0], y: m[1], z: m[2] });
  }

  // A fireball: its constructor plays SE 0x31f at its own place (0x00426766).
  private fireball(from: readonly [number, number, number], to: readonly [number, number, number], power: number): void {
    const ids = this.ultimate ? DRAGON_FIRE_IDS.ultimate : DRAGON_FIRE_IDS.normal;
    this.pendingShots.push(new DragonFireball(from, to, power, ids));
    this.emit({ kind: 'se', id: DRAGON_SE.fireball });
  }

  // 0x00420ee8 phase 0: land with the land motion; from its frame 18 the body
  // falls under 0.2 gravity, and 4 ticks after it touches the ground the stomp
  // goes off (radius MovementData fparam4).
  private tickLand(): void {
    this.animate();
    // 0x00420ee8 sub-state 0 (0x00421235): SE 0x318 at frame 2 (0x41300000 is frame 11, below).
    // ASSUMED: the port's sub 0 (before frame 18) is the exe's sub 0 (the counter at +0x21b).
    if (this.c86c === 0 && this.passed(2)) this.emit({ kind: 'se', id: 0x318 });
    this.f888 = DRAGON_GUESS.animYOffset;
    if (this.c86c === 0 && this.mframe >= 18) this.c86c = 1;
    const sub = this.c86c;
    if (sub === 1) {
      this.f884 += DRAGON.gravityLand;
      this.alt += this.f884;
      if (this.alt < this.f888) {
        this.c86c = 2;
        this.alt = 0;
        this.air = 0;
      }
    } else if (sub === 2 && ++this.c870 === 4) {
      // 0x004213b5: the body's particle (+0x08) at the stomp (the gate is the counter, not the frame).
      this.emitBody(this.ultimate ? DRAGON_PARTICLE_IDS.ultimate.body : DRAGON_PARTICLE_IDS.normal.body);
      this.strike(this.x, this.z, this.mv.fparam4, 0);
      this.emit({ kind: 'se', id: 0x323 });
    }
    // 0x00421242: the take-off helper's particle (+0x04) when the motion passes frame 11.
    if (this.crossed(11)) this.emitBody(this.ultimate ? DRAGON_PARTICLE_IDS.ultimate.f04 : DRAGON_PARTICLE_IDS.normal.f04);
  }

  // create_particle_effect at the body (its +0x38 point): x, z as the body, y the height.
  private emitBody(id: number): void {
    this.emit({ kind: 'particle', id, x: this.x, y: this.alt, z: this.z });
  }

  // The particle ids of this difficulty (DRAGON_PARTICLE_IDS).
  private pids(): { readonly f00: number; readonly f04: number; readonly body: number; readonly stomp: number; readonly mouth: number; readonly launch: number; readonly intro: number } {
    return this.ultimate ? DRAGON_PARTICLE_IDS.ultimate : DRAGON_PARTICLE_IDS.normal;
  }

  // --- the entrance (0x0041b220, phase 0) ----------------------------------------
  //
  // Two sub-state registers: +0x86c is the variant (1 normal, 2 Ultimate: the
  // entry tests 0x00420a44; 4 once the entrance motion has ended) and +0x874 the
  // step of that variant's chain. +0x870 is a counter (every 4th tick). A step
  // whose frame test is not met waits (the chain holds its step); a step with
  // `passed` runs once, in the tick the motion frame goes past its threshold.
  // The motion is bossop (slot 25, 170 frames at 0.5). The camera and the
  // object the entry makes (0x0041bbf0..0x0041bc1c, 0x28 bytes) are not
  // reproduced (UNCLEAR).
  private tickIntro(): void {
    if (this.c86c === 4) {
      this.animate();
      return;
    }
    const variant = this.c86c;
    this.animate();
    if (this.ended) {
      // 0x0041b833 (0x0041b2df): the motion is over: +0x86c = 4 and +0xb8 = 0 (the stand).
      // The frame counter is kept; the chain still runs this tick, as in the exe.
      this.c86c = 4;
      this.slotIndex = 0;
      this.motionDirty = true;
    }
    if (variant === 1) this.introNormal();
    else if (variant === 2) this.introUltimate();
    else if (variant === 3) this.introThree();
  }

  // The crossing test of the entrance: the exe's check_entity_animation_elapsed_threshold
  // (0x007aaa30) is `mframe > f && mframe <= f + speed` (f32, the frame after the speed
  // is added). The port's crossed() uses `mframe >= f && mframe - speed < f`: it differs
  // at the exact threshold (one tick), see the DEVLOG entry.
  private passed(f: number): boolean {
    return this.mframe > f && this.mframe <= f + this.speed;
  }

  // 0x0041ebc0 (called after the animate step by the take-off-style states: roarAir
  // 0x0042008c case 0, dive 0x0041f6cc sub 0, emerge 0x0041e3f8 sub 5 (and sub 4 on
  // slot 16), flyAcross 0x00421ecc case 0, flyShoot's turn 0x00421972): SE 0x318 at
  // frame 5 (0x0041ebde, the check 0x007aaa30(5.0) = 0x40a00000). The
  // teleport (0x19) and fly_move (0x1a) states call it too; the port has neither.
  private animSound(): void {
    if (this.passed(5)) this.emit({ kind: 'se', id: 0x318 });
  }

  // 0x0041b220 variant 1 (normal), by +0x874. Frames are motion frames.
  private introNormal(): void {
    const ids = this.pids();
    switch (this.c874) {
      case 0: // 0x0041ba76: sound 0x318 at 2
        if (!this.passed(2)) return;
        this.emit({ kind: 'se', id: 0x318 });
        this.c874++;
        return;
      case 1: // 0x0041ba16: sound 0x322 at 32 (optional), the body's particle at 35 (0x0041ba5f)
        if (this.passed(32)) this.emit({ kind: 'se', id: 0x322 });
        if (!this.passed(35)) return;
        this.emitBody(ids.body);
        this.c874++;
        return;
      case 2: // 0x0041b9d7: sound 0x31a at 75, the counter is cleared
        if (!this.passed(75)) return;
        this.emit({ kind: 'se', id: 0x31a });
        this.c874++;
        this.c870 = 0;
        return;
      case 3: // 0x0041b94d: the launch flashes at the mouth (0x0041b98e) every 4th tick until frame 80
        if (this.mframe > 80) {
          this.c874++;
          return;
        }
        if ((++this.c870 & 3) === 0) this.launch(this.mouth());
        return;
      case 4: // 0x0041b870: the BGM at 105, the counter is cleared
        if (!this.passed(105)) return;
        this.emit({ kind: 'bgm', name: 'dradeath.adx' });
        this.c874++;
        this.c870 = 0;
        return;
      case 5: // 0x0041b8b1: the flame (0x0041b9c1) until frame 150, then stopped
        if (this.mframe < 150) this.introFlame(ids.intro);
        else {
          this.stopMouth();
          this.c874++;
        }
        return;
      default:
    }
  }

  // 0x0041b220 variant 2 (Ultimate), by +0x874.
  private introUltimate(): void {
    const ids = this.pids();
    switch (this.c874) {
      case 0: // 0x0041b75e: sound 0x318 at 9 or 40, 0x322 at 62 (both optional), then 0x318 and the body's particle at 64 (0x0041b7ea)
        if (this.passed(9) || this.passed(40)) this.emit({ kind: 'se', id: 0x318 });
        if (this.passed(62)) this.emit({ kind: 'se', id: 0x322 });
        if (!this.passed(64)) return;
        this.emit({ kind: 'se', id: 0x318 });
        this.emitBody(ids.body);
        this.c874++;
        return;
      case 1: // 0x0041b71f: sound 0x31a at 92, the counter is cleared
        if (!this.passed(92)) return;
        this.emit({ kind: 'se', id: 0x31a });
        this.c874++;
        this.c870 = 0;
        return;
      case 2: // 0x0041b576: the launch flashes at the mouth (0x0041b5b3) every 4th tick until frame 99
        if (this.mframe > 99) {
          this.c874++;
          return;
        }
        if ((++this.c870 & 3) === 0) this.launch(this.mouth());
        return;
      case 3: // 0x0041b499: the BGM at 120, the counter is cleared
        if (!this.passed(120)) return;
        this.emit({ kind: 'bgm', name: 'dradeath.adx' });
        this.c874++;
        this.c870 = 0;
        return;
      case 4: // 0x0041b4da: the flame (0x0041b709) until frame 155, then stopped
        if (this.mframe < 155) this.introFlame(ids.intro);
        else {
          this.stopMouth();
          this.c874++;
        }
        return;
      default:
    }
  }

  // 0x0041b220 variant 3, by +0x874 (0x0041b2ad). NOTHING SELECTS IT: the entry
  // writes +0x86c = 1 or 2 only (0x0041bba6..0x0041bbc6, from 0x00420a44's 0 or 1),
  // and the other writers of 3 are other states' code. Ported so its two particle
  // sites (0x0041b69a, 0x0041b6a7) exist; the intro never runs it.
  private introThree(): void {
    const ids = this.pids();
    switch (this.c874) {
      case 0: // 0x0041b6be: sound 0x318 at 2
        if (!this.passed(2)) return;
        this.emit({ kind: 'se', id: 0x318 });
        this.c874++;
        return;
      case 1: // 0x0041b655: sound 0x322 at 60 (optional), the body's particle and 0x203 at 63
        if (this.passed(60)) this.emit({ kind: 'se', id: 0x322 });
        if (!this.passed(63)) return;
        this.emitBody(ids.body);
        this.emitBody(DRAGON_INTRO_PARTICLE);
        this.c874++;
        return;
      case 2: // 0x0041baab: sound 0x31a at 75, the counter is cleared
        if (!this.passed(75)) return;
        this.emit({ kind: 'se', id: 0x31a });
        this.c874++;
        this.c870 = 0;
        return;
      case 3: // 0x0041b3f9: wait for frame 80, no particle
        if (this.mframe > 80) this.c874++;
        return;
      case 4: // 0x0041b31c: the BGM at 105, the counter is cleared
        if (!this.passed(105)) return;
        this.emit({ kind: 'bgm', name: 'dradeath.adx' });
        this.c874++;
        this.c870 = 0;
        return;
      case 5: // 0x0041b35d: the flame until frame 150, then stopped
        if (this.mframe < 150) this.introFlame(ids.intro);
        else {
          this.stopMouth();
          this.c874++;
        }
        return;
      default:
    }
  }

  // The entrance's flame emitter: made when there is no handle (the exe moves it to the
  // mouth and aims it each tick: the render follows the mouth, the aim is not reproduced, ASSUMED).
  private introFlame(id: number): void {
    if (this.mouthEmitter) return;
    const handle: DragonEmitter = { alive: true };
    this.mouthEmitter = handle;
    this.emit({ kind: 'emitter', id, handle });
  }

  // The flame's emitter in flyShoot's sub-state 2 (0x00421636..0x00421674): with
  // no handle and motion frame >= 20 it is made (0x00421b2c: id +0x18, the mouth
  // point, flag 0x40); with a handle, above frame 40 it is stopped (its flag bit,
  // the handle dropped: 0x00421667), else it follows the mouth (0x00508db8). So a
  // handle stopped at 41 is made again at 42 (the exe has no other test).
  private tickMouth(): void {
    if (!this.mouthEmitter) {
      if (this.mframe >= 20) {
        const handle: DragonEmitter = { alive: true };
        this.mouthEmitter = handle;
        this.emit({ kind: 'emitter', id: this.pids().mouth, handle });
      }
    } else if (this.mframe > 40) {
      this.stopMouth();
    }
  }

  private stopMouth(): void {
    if (this.mouthEmitter) this.mouthEmitter.alive = false;
    this.mouthEmitter = null;
  }

  // 0x0041ebf0 (the emerge and the dive, 0x0041e9a9 / 0x0041fa7b): the point is the
  // body's, raised by 0.05 per earlier call while the counter is under 12 (the
  // counter +0x6ac goes up by one a call); the particle is table +0x00, flag 0x840.
  // ASSUMED: the flag's 0x800 bit is not read (one-shot as the others).
  private riseParticle(): void {
    let y = this.alt;
    if (this.riseCount < 12) {
      y = Math.fround(y + Math.fround(this.riseCount * 0.05));
      this.riseCount++;
    }
    this.emit({ kind: 'particle', id: this.pids().f00, x: this.x, y, z: this.z });
  }

  // 0x004203cc phase 0: fall (animation 8), lie 450 ticks, get up. Only
  // CheckDragonAttackReady reaches it, and that never fires; kept simple.
  private tickCollapse(): void {
    this.animate();
    if (this.c870 === 0) {
      if (this.crossed(7)) this.strike(this.x, this.z, DRAGON_GUESS.impactRadius, 4);
      if (this.crossed(14)) this.strike(this.x, this.z, DRAGON_GUESS.impactRadius * 1.5, 4);
      // 0x004203cc phase 0 (SinowbeatAttackStateMachine): frame 7 applies the battle
      // params and makes no dust; else frame 14 makes the outer ring, else frame 18 the inner.
      if (!this.crossed(7)) {
        if (this.crossed(14)) this.collapseRing(true);
        else if (this.crossed(18)) this.collapseRing(false);
      }
      if (this.slotIndex !== 8) this.c870 = 1;
    } else if (this.c870 === 1) {
      // 0x004203cc sub-state 1 (the counter runs to 0x1c1): 0x326 every frame (0x00420550).
      this.emit({ kind: 'se', id: 0x326 });
      if (++this.c86c > 0x1c1) {
        this.c870 = 2;
        this.setSlot(10);
      }
    }
  }

  // 0x0041f6cc phase 4: aim the dive at the rim point and work out the arc.
  private enterDive(): void {
    this.setSlot(16);
    this.air = 1;
    this.alt = DRAGON.flightAltitude;
    this.flags &= ~0xe80;
    this.f890 = 0;
    this.c86c = 0;
    this.dug = false;
    this.i880 = 0;
    const to = bamsOf(this.dx, this.dz);
    this.tdist = f32(this.tdist + 5);
    this.i87c = to;
    this.turnSetup(to);
    const tUp = f32(13 / -DRAGON.gravityDive);
    const tFall = f32(Math.sqrt((169 / -(DRAGON.gravityDive + DRAGON.gravityDive) + this.alt + 2) / -DRAGON.gravityDiveFall));
    if (50 <= this.tdist) {
      const v = f32(50 / tFall);
      this.f88c = v;
      const k = f32(((tUp * v - (this.tdist - 50)) * 2) / tUp);
      this.f888 = f32(v - k);
      this.f894 = f32(k / tUp);
    } else {
      const v = f32(this.tdist / (tFall + tUp));
      this.f88c = v;
      this.f888 = v;
      this.f894 = 0;
    }
    this.f890 = 13;
  }

  // 0x0041f6cc phase 0: turn, the lob, the plunge, down to -400.
  private tickDive(): void {
    this.animate();
    const sub = this.c86c;
    if (sub === 0) {
      // 0x0041f6cc sub 0: 0x0041ebc0 (SE 0x318 at frame 5) before the take-off.
      this.animSound();
      // 0x0041ff7a (before the turn, 0x0041ffc0): the take-off helper (+0x04) at frame 14.
      if (this.crossed(14)) this.emitBody(this.pids().f04);
      if (this.turnStep()) {
        this.m660 = 0;
        this.yaw = this.i87c;
        this.c86c = 1;
        this.setSlot(22);
      }
    } else if (sub === 1) {
      if (this.mframe >= 18) {
        this.c86c = 2;
        this.flags |= 0xc00;
        this.emit({ kind: 'se', id: 0x324 });
      }
    } else if (sub === 2) {
      if (this.f890 <= 0) {
        this.f890 += DRAGON.gravityDiveFall;
        this.step(this.dx, this.dz, this.f88c);
      } else {
        const v = this.f894 + this.f888;
        this.f890 += DRAGON.gravityDive;
        this.f888 = v;
        this.step(this.dx, this.dz, v);
      }
      this.alt += this.f890;
      if (this.alt <= DRAGON_GUESS.headBelowGround) {
        // ASSUMED: the head (node +0x418) is 50 below the floor by now.
        this.c86c = 3;
        this.emit({ kind: 'se', id: 0x323 });
      }
      if (this.ended) this.setSlot(23);
    } else if (sub === 3) {
      if (this.alt <= DRAGON.undergroundAltitude) {
        this.flags &= ~0x100;
        this.c86c = 4;
      }
      if (this.alt <= 0 && !this.dug) {
        // 0x0041fa7b (gate: alt <= 0 and the impact not yet done, 0x0041fa5e..0x0041fa8b):
        // the emerge / dive helper (+0x00) at the body, then SinowbeatLandingImpactEffect
        // + the hit box update: the crater.
        this.riseParticle();
        this.dug = true;
        this.air = 2;
        this.strike(this.x, this.z, DRAGON_GUESS.impactRadius, 0);
        this.emit({ kind: 'se', id: 0x323 });
      }
      this.alt += this.f890;
      this.step(this.dx, this.dz, this.f88c);
    }
  }

  // The sand trail (ProcessEnemySinowbeatTeleport, 0x0041a04c): a tech-type hit of
  // radius 45 and power fparam3 under the body, once per player per state.
  private trail(): void {
    let any = false;
    for (const t of this.last) {
      if (t.dead || this.seen.has(t.clientId)) continue;
      if (Math.hypot(t.x - this.x, t.z - this.z) <= DRAGON.trailRadius + 5) {
        any = true;
        break;
      }
    }
    if (!any) return;
    const fresh: number[] = [];
    for (const t of this.last) {
      if (t.dead || this.seen.has(t.clientId)) continue;
      if (Math.hypot(t.x - this.x, t.z - this.z) <= DRAGON.trailRadius + 5) fresh.push(t.clientId);
    }
    for (const id of fresh) this.seen.add(id);
    this.blast(this.x, this.z, DRAGON.trailRadius, this.mv.fparam3, fresh);
  }

  // 0x0041f238 phase 0 (states 0x10 / 0x11): wait 60 ticks hidden, come up at
  // the 6x12's point facing the centre and run at it, faster each time.
  private tickBurrow(center: boolean): void {
    void center;
    // 0x0041f238 phase 0, both sub-states: 0x325 every frame (call 0x0041f5b3).
    this.emit({ kind: 'se', id: 0x325 });
    if (this.c86c === 0) {
      if (++this.c870 >= 60) {
        this.c870 = 0;
        this.c86c = 1;
        this.teleport(this.ix, this.iz);
        this.yaw = shortOf(bamsOf(this.x, this.z) + 0x8000);
        this.dx = sinB(this.yaw);
        this.dz = cosB(this.yaw);
      }
    } else if (this.c86c === 1) {
      this.f884 = Math.min(f32(this.f884 + DRAGON.burrowAccel), this.f888);
      this.x += this.dx * this.f884;
      this.z += this.dz * this.f884;
      this.trail();
      this.c870++;
    }
  }

  // 0x0041ed68 phase 0 (state 0x12): turn to the rim point 0x600 a frame and
  // run at the burrow speed.
  private tickBurrowOut(): void {
    // 0x0041ed68 phase 0: 0x325 every frame (call 0x0041f16e).
    this.emit({ kind: 'se', id: 0x325 });
    this.initVelocity();
    if (this.dx !== 0 || this.dz !== 0) this.yaw = clampAngle(this.yaw, bamsOf(this.dx, this.dz), 0x600);
    this.x += sinB(this.yaw) * this.f888;
    this.z += cosB(this.yaw) * this.f888;
    this.trail();
    this.c870++;
  }

  // 0x0041e3f8 phase 0: leap out of the ground at the rim point, over the arena
  // and settle at 180.
  private tickEmerge(): void {
    const g = DRAGON.gravityEmerge;
    let sub = this.c86c;
    if (sub === 0) {
      if (++this.c870 >= 100) {
        this.c86c = sub = 1;
        this.teleport(this.ix, this.iz);
        const vx = 0 - this.x;
        const vz = 0 - this.z;
        const len = Math.hypot(vx, vz);
        this.flags |= 0x100;
        if (len > 100) {
          const t1 = -(15 / g);
          const t2 = Math.sqrt(-120 / g);
          this.f884 = f32(len / (t2 + t1));
        } else this.f884 = 0;
        const ux = len > 0 ? vx / len : 0;
        const uz = len > 0 ? vz / len : 0;
        this.velX = ux * this.f884;
        this.velZ = uz * this.f884;
        this.x += this.velX * -11.333333;
        this.z += this.velZ * -11.333333;
        this.yaw = bamsOf(this.velX, this.velZ);
        this.f888 = 15;
        this.alt = -170;
        return;
      }
      this.animate();
      return;
    }
    if (sub === 1) {
      if (this.alt > 0) {
        this.c86c = sub = 2;
        this.air = 1;
        this.strike(this.x, this.z, DRAGON_GUESS.impactRadius, 0);
        this.emit({ kind: 'se', id: 0x323 });
        // 0x0041e9a9: the emerge's particle (0x0041ebf0, table +0x00) at the body.
        this.riseParticle();
      }
    } else if (sub === 2) {
      if (this.alt > 110) this.c86c = sub = 3;
    } else if (sub === 3) {
      if (this.f888 < 0 && this.alt < 220) {
        this.f88c = f32((this.f888 * this.f888) / 80);
        this.c86c = sub = 4;
      }
    } else if (sub === 4 && this.f888 > 0) {
      this.c86c = sub = 5;
      this.f888 = 0;
      this.c870 = 0;
    }
    if (sub === 1) {
      this.x += this.velX;
      this.z += this.velZ;
      this.alt += this.f888;
      return;
    }
    if (sub === 2) {
      this.x += this.velX;
      this.z += this.velZ;
      this.f888 += g;
      this.alt += this.f888;
      return;
    }
    this.animate();
    if (sub === 3) {
      this.f888 += g;
      this.alt += this.f888;
      if (this.mframe >= 15) {
        this.velX *= 0.98;
        this.velZ *= 0.98;
      }
      this.x += this.velX;
      this.z += this.velZ;
    } else if (sub === 4) {
      // 0x0041e73b: 0x0041ebc0 (SE 0x318 at frame 5) only while the animation is 16 (+0x2e).
      if (this.slotIndex === 16) this.animSound();
      this.f888 += this.f88c;
      this.alt += this.f888;
      this.velX *= 0.98;
      this.velZ *= 0.98;
      this.x += this.velX;
      this.z += this.velZ;
    } else if (sub === 5) {
      // 0x0041e8d8: 0x0041ebc0 (SE 0x318 at frame 5) every tick of the settle.
      this.animSound();
      if (++this.c870 > 0x31) this.c86c = 6;
    }
  }

  // 0x0041db28 phase 0: the death motion with its burst of area hits (AttackData
  // row 4), then 50 ticks of lying (the camera returns).
  private tickDeath(): void {
    this.animate();
    if (this.c86c === 0) {
      // 0x0041db28 phase 0 (counter 0): 0x31b, no position, at frame 60 or 98 (call 0x0041dde5).
      if (this.passed(60) || this.passed(98)) this.emit({ kind: 'se', id: 0x31b });
      if (this.crossed(57)) {
        this.deathRing(-35, 10, 12);
        this.deathBurst(-35, 10);
      }
      if (this.crossed(88)) {
        this.deathRing(-60, -20, 100);
        this.deathBurst(-60, -20);
      }
      if (this.crossed(97)) {
        // ASSUMED: the two and four node places of the closing hits.
        this.deathRing(-40, 30, 15);
        this.deathRing(-40, -30, 15);
        this.deathRing(0, 45, 11);
        this.deathRing(0, -45, 11);
        this.deathRing(30, 20, 11);
        this.deathRing(30, -20, 11);
      }
      if (this.ended) {
        this.c86c = 1;
        this.c870 = 0;
      }
    } else if (this.c86c === 1) {
      this.c870++;
    }
  }

  // RotateVector2D by the heading, added to the body: an area hit of row 4.
  private deathRing(ox: number, oz: number, radius: number): void {
    const c = cosB(this.yaw);
    const s = sinB(this.yaw);
    this.strike(this.x + ox * c + oz * s, this.z + oz * c - ox * s, radius, 4);
  }

  // The collapse's dust ring (0x00420a58 inner at frame 18, 0x00420c74 outer at 14):
  // one stomp-table particle (+0x0c, flag 0x40) on the ground, its point the body
  // moved 4 back and 75 (inner) or 100 back (outer) along the heading, both
  // from the body's x / z (the exe's int_sin / int_cos of the yaw at +0x60).
  private collapseRing(outer: boolean): void {
    const c = cosB(this.yaw);
    const s = sinB(this.yaw);
    const d = outer ? -100 : 75;
    this.emit({ kind: 'particle', id: this.pids().stomp, x: this.x - 4 * c + d * s, y: 0, z: this.z + 4 * s + d * c });
  }

  // The death's two body particles (0x0041df9a at frame 57, 0x0041e0b9 at 88): the
  // body's table +0x08 at the same two points as its area hits (deathRing).
  private deathBurst(ox: number, oz: number): void {
    const c = cosB(this.yaw);
    const s = sinB(this.yaw);
    this.emit({ kind: 'particle', id: this.pids().body, x: this.x + ox * c + oz * s, y: this.alt, z: this.z + oz * c - ox * s });
  }

  // 0x0041a888 phase 0 (Ultimate): rise, spin and rain a fireball every 4 ticks
  // for 40 rounds (at a live player's spot on even rounds, anywhere in the
  // arena on odd ones), then face the centre.
  private tickRain(): void {
    this.animate();
    const sub = this.c86c;
    if (sub === 0) {
      if (this.mframe >= 18) {
        this.c86c = 1;
        this.emit({ kind: 'se', id: 0x324 });
      }
    } else if (sub === 1) {
      if (this.ended) {
        this.c86c = 2;
        this.setSlot(24);
      }
    } else if (sub === 2) {
      if (this.mframe > 22) {
        this.i87c = 0x1000;
        this.c86c = 3;
      }
    } else if (sub === 3) {
      this.i87c = Math.min(0x2000, this.i87c + 0x40);
      if (++this.c870 >= 4) {
        this.c870 = 0;
        this.c874++;
        if (this.c874 > 0x27) this.c86c = 4;
        this.rainDrop();
      }
    } else if (sub === 4) {
      this.i87c -= 0x50;
      if (this.i87c < 0x1300) {
        this.i87c = 0x1300;
        this.i880 = bamsOf(-this.x, -this.z);
        this.c86c = 5;
      }
    } else if (sub === 5) {
      const d = turnTo(this.yaw, this.i880);
      const step = d * 0.3;
      if ((step < 512 && step >= -512) || this.ended) {
        this.c86c = 6;
        this.yaw = this.i880;
      } else this.yaw += Math.trunc(step);
    }
    // The hover: 13 a frame of climb that runs out while rising, then 1 a
    // frame of sinking back to 180.
    if (sub === 1 || sub === 2) {
      this.f884 = Math.max(0, f32(-0.5 + this.f884));
      this.alt = Math.max(DRAGON.flightAltitude, this.alt + this.f884);
    } else if (sub >= 3 && sub <= 5) {
      this.alt = Math.max(DRAGON.flightAltitude, this.alt - 1);
    }
  }

  // One round of the rain: even rounds go to a player's slot (round / 2 mod
  // 4) with a spread of 100, odd rounds (or an empty slot) anywhere in 700.
  private rainDrop(): void {
    let px = (this.rainRandom() - 0.5) * 700;
    let pz = (this.rainRandom() - 0.5) * 700;
    if ((this.c874 & 1) === 0) {
      const slotNo = (this.c874 >> 1) & 3;
      for (const t of this.last) {
        if (t.clientId !== slotNo || t.dead) continue;
        px = t.x + (this.rainRandom() - 0.5) * 100;
        pz = t.z + (this.rainRandom() - 0.5) * 100;
        break;
      }
    }
    this.fireball(this.mouth(), [px, 0, pz], this.mv.fparam2);
  }

  // 0x0041a364 phase 0 (Ultimate): hidden for 60 ticks, then a spiral from the
  // rim into the centre, leaving the trail.
  private tickCircle(): void {
    if (this.c86c === 0) {
      if (++this.c870 < 60) return;
      this.c870 = 0;
      this.c86c = 1;
      this.teleport(this.ix, this.iz);
      this.i87c = bamsOf(this.x, this.z);
      return;
    }
    if (this.c86c !== 1) return;
    // 0x0041a364 phase 0, sub-state 1 (the spiral): 0x325 every frame (0x0041a69b).
    this.emit({ kind: 'se', id: 0x325 });
    const dTheta = Math.round(((this.f884 / this.f88c) * 65536) / TWO_PI);
    this.i87c += dTheta;
    this.x = this.f88c * sinB(this.i87c);
    this.z = this.f88c * cosB(this.i87c);
    this.f88c = f32(dTheta * -0.001068115234375 + this.f88c);
    if (this.f88c < 5) this.c86c = 2;
    this.trail();
    this.c870++;
  }
}

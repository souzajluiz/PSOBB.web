// Enemy behaviour: the generic walking-enemy state machine of PsoBB.exe
// (Ephinea 1.25.13, addresses are VAs) - idle wandering, noticing a player,
// chasing it, the melee attack and the way back to idle.
//
// The Forest families (Booma / Gobooma / Gigobooma, Hildebear, Evil Shark,
// Grass Assassin, Poison Lily ...) all share one AI substrate, whose
// dispatcher is `unknown_booma_enemy_ai` (the per-state handlers sit in the
// 0x0052a000..0x0052c000 block; `booma_constructor` installs them through
// `booma_vtable` and other families install the same functions). The
// dispatcher switches on enemy+0x32e:
//     0 spawn (vtable +0x154)        1 wander / idle (+0x158)
//     2 (+0x15c)                     3 chase target (+0x160)
//     4 (+0x164)                     5 attack (+0x168) ... 9 (+0x178)
// and 8 is the dead state (`set_booma_enemy_killed` sets state 8, animation 8).
// Every state ends with `SetDerolleLockonTarget_0078730c` + `enable_reticle`.
//
// Per state, what the handlers do (the parts reproduced here):
//   idle, `unknown_enemy_behavior_1`: plays animation 2 and wanders inside
//     cfg[1] + e.dat wander radius + collision radius of the spawn point; when
//     it drifted past that it walks straight back to the spawn point, turning
//     at most cfg[2] BAMS per tick (`ClampAngleDifference_007a8c74`).
//   target search, `unknown_booma_enemy_find_target`: every tick
//     `EnemyGetNearestTargetInRange_007714cc(this, cfg[0], 0)` picks the
//     nearest player inside cfg[0] with line of sight
//     (`EnemyAI_CheckLineOfSight_00771e14` / `cast_ray_at_map_collision_geometry`);
//     a target on another floor is dropped (`GetPlayer_0068d5a8` +
//     `floor_id_2 != g_CurrentFloor`).
//   notice -> chase, `unknown_enemy_behavior_4`: from the idle state it enters
//     state 3 with animation 7 (the war cry) and substate 0.
//   chase, `unknown_booma_enemy_chase_target`: substate 0 plays the war cry
//     (and its sound effect, vtable +0x188) until the animation ends, then
//     switches to animation 2 and substate 1; substate 1 steers toward the
//     target's `weapon_position` with
//     `SorcererProcessProjectileLogic_00772aa0(this, speed, cfg[2], x, y, z, 0)`
//     = turn by at most cfg[2] BAMS, then step `speed` units along the facing.
//     The target is dropped after 0x96 (150) ticks of not reaching it.
//   speed, `RemoveEnemyFromList_0052ad44`: enemy+0x39c (move units per tick)
//     and the animation frame step come from the BattleParamEntry MovementData
//     of the enemy: fparam1 / fparam2 normally and fparam3 / fparam4 while the
//     "near the player" flag is set. `ClearEnemyHitbox_0052ac5c` sets that flag
//     from the squared distance to the target with hysteresis, against
//     0x00922330..0x0092233c = {10000, 2500, 22500, 10000}: 50 / 100 units for
//     a Hunter class and 100 / 150 for everything else.
//   attack, `unknown_booma_enemy_attack_behavior` enters state 5 substate 1 and
//     picks animation 4 or animation 3 by `g_BoomaAttackSuccessChance`;
//     `unknown_enemy_behavior_2` runs it: at animation frame 7
//     (`check_entity_animation_elapsed_threshold(this, 7.0)`) it calls the
//     target's `try_hit_entity(this, 1.0)` and `cause_knockback(this, 3.0)`,
//     and when the attack animation ends it goes to substate 2 with animation 0
//     and a 15-tick (0xF) wait before vtable +0x19c puts it back into the chase.
//   The attack reach is the enemy's BattleParamEntry AttackData: distance_x
//     and `angle` (out of 0x10000), checked by `EnemyAI_CheckFacingArc_00772c08`.
//
// Not reproduced: the line-of-sight ray (an enemy here notices a player through
// walls), the wander path (an idle enemy stands still instead of strolling),
// the subordinate / group linking (`Derolle*Subordinate*`, which spreads a pack
// out), paralysis / freeze / confusion, and the second attack animation's
// different reach.

import { ENEMY_TYPE_PARAMS } from '../formats/entitynames.ts';
import type { EnemyAttackData, EnemyMovementData } from '../formats/battleparams.ts';
import type { EnemyShot } from './enemyshots.ts';
import { exhaustive } from '../exhaustive.ts';

export const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

// Squared guard-stance ("near the player") distances at 0x00922330: enter and
// leave for a Hunter class, then for every other class. The exe reads them in
// this order; which of each pair is the entry and which the exit is ambiguous
// in the decompilation, and the pairing below is the one that gives a stable
// hysteresis (enter closer than `near`, leave farther than `far`).
export const NEAR_HUNTER_SQ = 2500; // 50 units
export const FAR_HUNTER_SQ = 10000; // 100 units
export const NEAR_OTHER_SQ = 10000; // 100 units
export const FAR_OTHER_SQ = 22500; // 150 units

// Hunter classes (HUmar, HUnewearl, HUcast, HUcaseal): the class ids whose
// gender_race_job_flags carry only the Hunter bit.
const HUNTER_CLASSES = new Set([0, 1, 2, 9]);

export function nearSq(charClass: number): number {
  return HUNTER_CLASSES.has(charClass) ? NEAR_HUNTER_SQ : NEAR_OTHER_SQ;
}
export function farSq(charClass: number): number {
  return HUNTER_CLASSES.has(charClass) ? FAR_HUNTER_SQ : FAR_OTHER_SQ;
}

// `check_entity_animation_elapsed_threshold(this, 7.0)` in the attack state.
export const ATTACK_HIT_FRAME = 7;
// enemy+0x344, set to 0xF by the constructor and again at the end of the attack.
export const ATTACK_RECOVER_TICKS = 15;
// `cause_knockback(this, 3.0)` (0x40400000) of the generic enemy melee.
export const ATTACK_KNOCKBACK = 3;
// `try_hit_entity(this, 1.0)`: the damage multiplier of the hit.
export const ATTACK_DAMAGE_MULT = 1;
// enemy+0x2b0 counts up to 0x96 ticks of chasing without reaching the target.
export const CHASE_GIVE_UP_TICKS = 150;

export interface EnemyAiMotion {
  index: number; // motion entry of the archive, relative to the first motion
  speed: number; // frames per game tick
  loop: boolean;
}

// The animation slots the AI uses, out of the enemy's animation table in
// PsoBB.exe (rows {u16 mode, u16 next, u32 motion, f32 frames per tick,
// u32 flags}; mode 1 loops). Slot = the `animation_id` the FSM writes.
export interface EnemyAiProfile {
  idle: EnemyAiMotion; // animation 0
  walk: EnemyAiMotion | null; // animation 2; null = the enemy never walks
  notice: EnemyAiMotion | null; // animation 7, the war cry
  attacks: readonly EnemyAiMotion[]; // animations 3 and 4
}

const loop = (index: number, speed: number): EnemyAiMotion => ({ index, speed, loop: true });
const once = (index: number, speed: number): EnemyAiMotion => ({ index, speed, loop: false });

// Read out of the animation tables of PsoBB.exe; the table address of each
// class is the one combat/enemymotions.ts and formats/enemymodels.ts cite.
export const AI_PROFILES: Record<string, EnemyAiProfile> = {
  // 0x009bc980 (Booma / Gobooma / Gigobooma): 0 stund (9, 0.6, loop),
  // 2 walk (11, 0.5, loop), 3 attack A (1, 0.65), 4 attack B (2, 0.85),
  // 7 war cry (10, 0.8).
  TObjEneBeast: { idle: loop(9, 0.6), walk: loop(11, 0.5), notice: once(10, 0.8), attacks: [once(1, 0.65), once(2, 0.85)] },
  // 0x009bb300 (Evil / Pal / Guil Shark): same layout, different speeds.
  TObjEneShark: { idle: loop(9, 0.6), walk: loop(11, 1), notice: once(10, 0.8), attacks: [once(1, 1), once(2, 1)] },
  TObjEneDimedian: { idle: loop(9, 0.6), walk: loop(11, 1), notice: once(10, 0.8), attacks: [once(1, 1), once(2, 1)] },
  // 0x009bb420 (Hildebear / Hildeblue): 0 (9, 0.5, loop), 2 walk (10, 0.6,
  // loop), 3 (8, 0.7), 4 (5, 0.4), 5 (7, 0.5), 1 is the spawn row (6, 0.7).
  TObjEneMoja: { idle: loop(9, 0.5), walk: loop(10, 0.6), notice: null, attacks: [once(8, 0.7), once(5, 0.4)] },
  // 0x009bbaa0 (Grass Assassin): 0 wait (6, 0.7, loop), 1 run (7, 1.3, loop),
  // 2 (2, 0.7), 3 (4, 0.7), 4 (5, 0.7), 7 (3, 0.5).
  TObjGrass: { idle: loop(6, 0.7), walk: loop(7, 1.3), notice: once(3, 0.5), attacks: [once(4, 0.7), once(5, 0.7)] },
  // 0x009bb860 (Savage / Barbarous Wolf): 0 wait (12, 0.8, loop), 2 run
  // (9, 1.0, loop), 4 (10, 0.5), 5 (11, 0.5). The wolf has its own FSM
  // (SavageWolfProcessState_0051c0ac / _0051c264 / _0051c810, a leap attack)
  // and its MovementData is all zeros, so it uses the generic AI here with
  // the walk speed of the chase animation as its move speed (APPROXIMATED).
  TObjEneBm5Wolf: { idle: loop(12, 0.8), walk: loop(9, 1), notice: null, attacks: [once(10, 0.5), once(11, 0.5)] },
  // 0x009bbc20 (Rag Rappy): 0 wait (6, loop), 3 (9, loop), 4 (3, loop),
  // 5 attack (0), 9 (7). The speeds of this table are written at run time by
  // InitRappyGlobalConfig_00527973 from the MovementData, so only the idle
  // speed 0.9 (formats/enemymodels.ts) is known; the rest are ASSUMED 1.
  TObjEneLappy: { idle: loop(6, 0.9), walk: loop(9, 1), notice: null, attacks: [once(0, 1)] },
  // 0x009bb6a0 (Monest): a nest, it never moves (its MovementData is "loaded
  // with assets but not used", newserv notes/movement-data.txt). 0 wait
  // (14, 0.3, loop), 2 (2, 1.0) is the Mothmant spawn.
  TObjEneBm3FlyNest: { idle: loop(14, 0.3), walk: null, notice: null, attacks: [] },
  // 0x009bc280 (Poison Lily): stationary, 1 waitc closed (4, 0.3, loop),
  // 6 (3, 0.6) the bite. Its FSM is LilyAI_Update_0052ad80.
  TObjEneRe2Flower: { idle: loop(4, 0.3), walk: null, notice: null, attacks: [once(3, 0.6)] },
};

// Per-enemy AI configuration: the 7-dword records the constructors install at
// enemy+0x358, read out of PsoBB.exe. +0x00 f32 target search radius,
// +0x04 f32 extra wander allowance, +0x08 i32 turn rate in BAMS per tick.
// Subtype-indexed tables have one record per subtype (stride 0x1C).
export interface EnemyAiConfig {
  detect: readonly number[]; // by subtype
  turnRate: number; // BAMS per tick
}

export const AI_CONFIG: Record<string, EnemyAiConfig> = {
  // g_BoomaHitboxParams @ 0x009bc880 (installed at booma_constructor+0x1c1).
  TObjEneBeast: { detect: [225, 250, 300], turnRate: 1024 },
  // ASSUMED: the Hildebear's own record was not traced; 0x009bb200 (cited
  // here before) is the Shark's (shark_constructor installs it).
  TObjEneMoja: { detect: [225, 250, 300], turnRate: 1024 },
  // 0x009bb200 + subtype * 0x1c (shark_constructor, SetBoomaSubtype_00512f94):
  // Evil / Pal / Guil Shark search 225 / 250 / 300, turn 1024. The Shark runs
  // the Booma handlers (base ctor 0x0052b6ec, dispatcher 0x0052b78c): no
  // behaviour of its own besides sounds and the attack trails.
  TObjEneShark: { detect: [225, 250, 300], turnRate: 1024 },
  // 0x009bd740 + subtype * 0x1c (dimenian_constructor 0x00551d3c): Dimenian /
  // La / So search 225 / 250 / 300, turn 1024; the Booma handlers (vtable
  // 0x00b041e0 over the base 0x00b012e0) with its own spawn (the dark
  // portal, 0x005ad51c), sounds and attack trails.
  TObjEneDimedian: { detect: [225, 250, 300], turnRate: 1024 },
  // g_SavageWolfConfig @ 0x009bb9ec (savage_wolf_constructor + 0x11e).
  TObjEneBm5Wolf: { detect: [225], turnRate: 1536 },
  // 0x009bb764 (the Monest constructor at 0x005191c0 + 0x128).
  TObjEneBm3FlyNest: { detect: [225], turnRate: 1536 },
  // g_RappyMaxAttackRange @ 0x009bc144 (the Rappy constructor at 0x00526d90).
  TObjEneLappy: { detect: [150], turnRate: 1024 },
  // 0x009bc33c (the Poison Lily constructor at 0x005293ac).
  TObjEneRe2Flower: { detect: [225], turnRate: 512 },
};

// DefaultEnemyCollisionParams_009c3eb0, what an enemy without its own record
// gets: search radius 100, turn rate 1024.
export const DEFAULT_AI_CONFIG: EnemyAiConfig = { detect: [100], turnRate: 1024 };

export function aiConfig(className: string, subtype = 0): { detect: number; turnRate: number } {
  const c = AI_CONFIG[className] ?? DEFAULT_AI_CONFIG;
  return { detect: c.detect[Math.min(subtype, c.detect.length - 1)], turnRate: c.turnRate };
}

// Collision radii of the Booma family, set by init_booma_subtypes_global_config
// (7 / 7 / 8, and 10 / 10 / 9 in Ultimate). Other families are not decoded and
// fall back to COLLISION_RADIUS_DEFAULT (ASSUMED).
export const BOOMA_COLLISION_RADIUS = [7, 7, 8] as const;
export const BOOMA_COLLISION_RADIUS_ULTIMATE = [10, 10, 9] as const;
export const COLLISION_RADIUS_DEFAULT = 10;
export const DIMENIAN_COLLISION_RADIUS = [7, 7, 8] as const;

export function collisionRadius(className: string, subtype = 0, ultimate = false): number {
  if (className === 'TObjEneBeast') {
    const t = ultimate ? BOOMA_COLLISION_RADIUS_ULTIMATE : BOOMA_COLLISION_RADIUS;
    return t[Math.min(subtype, 2)];
  }
  // 0x009bd7a0 + subtype * 0x2c: Dimenian / La 7, So 8.
  if (className === 'TObjEneDimedian') return DIMENIAN_COLLISION_RADIUS[Math.min(subtype, 2)];
  // Delsaber 0x009bd6f8: radius 6.
  if (className === 'TObjEneSaver') return 6;
  return COLLISION_RADIUS_DEFAULT;
}

// MovementData index of an enemy type. newserv's type_defs do not bind it to
// the type (notes/movement-data.txt lists it separately); for every Episode 1
// type listed there it is the same index as the ResistData one, which is what
// this uses.
export function movementIndex(typeName: string): number | null {
  const def = ENEMY_TYPE_PARAMS[typeName];
  return def && def.resist.length ? def.resist[0] : null;
}

// Move speeds and animation steps of one enemy, from its MovementData:
// fparam1/fparam2 away from the player and fparam3/fparam4 near it (newserv
// notes/movement-data.txt names them "idle move speed", "idle walking
// animation speed", "engaged move speed", "engaged animation speed").
export interface EnemySpeeds {
  idleMove: number;
  idleAnim: number;
  engagedMove: number;
  engagedAnim: number;
}

export function enemySpeeds(movement: EnemyMovementData | null, fallback: number): EnemySpeeds {
  const f = movement;
  if (!f || (f.fparam1 <= 0 && f.fparam3 <= 0)) {
    // No usable MovementData (Monest, Savage Wolf, ...): the family's own code
    // sets the speed. APPROXIMATED with `fallback` for both states.
    return { idleMove: fallback, idleAnim: 1, engagedMove: fallback, engagedAnim: 1 };
  }
  return {
    idleMove: f.fparam1,
    idleAnim: f.fparam2 > 0 ? f.fparam2 : 1,
    engagedMove: f.fparam3 > 0 ? f.fparam3 : f.fparam1,
    engagedAnim: f.fparam4 > 0 ? f.fparam4 : f.fparam2 > 0 ? f.fparam2 : 1,
  };
}

export type AiState = 'idle' | 'notice' | 'chase' | 'attack' | 'recover' | 'dead';

export interface AiTarget {
  clientId: number;
  x: number;
  /** The feet (the entity origin, exe +0x300 / +0x20); absent in the tests (0). */
  y?: number;
  z: number;
  y?: number; // height (the Pofuilly Slime's arm window, 0x00598f1c); 0 when not given
  charClass: number;
  dead: boolean;
  angle?: number; // heading in radians (the wolf watches where it faces)
  // The player is in an attack action (player +0x328 & 0xE0; the Delsaber's
  // guard check).
  attacking?: boolean;
}

// What the owner must do after a tick.
export interface AiFrame {
  motion: EnemyAiMotion | null; // play this motion (only when it changed)
  x: number;
  z: number;
  angle: number; // radians
  // The attack landed. kbScale: cause_knockback(kbScale * the damage
  // try_hit_entity returned) instead of the fixed `knockback` (Grass Assassin).
  // attack: another AttackData row of the enemy (the index into its
  // ENEMY_TYPE_PARAMS attack list: the Delsaber's jump and slash).
  hit: { clientId: number; knockback: number; mult: number; kbScale?: number; attack?: number } | null;
  // Per-family FSMs (combat/enemyfsm.ts): a status effect landing on a player
  // without damage (Poison Lily's scream), a projectile to launch, and the
  // height of the model above the ground (Savage Wolf's leap).
  status?: { clientId: number; type: number } | null;
  projectile?: { x: number; z: number; angle: number } | null;
  lift?: number;
  // An absolute height instead of the ground under (x, z) plus lift (De Rol
  // Le swims at its own y, combat/derolle.ts).
  y?: number;
  // Projectiles of the Caves / Mines FSMs (combat/enemyshots.ts).
  shots?: EnemyShot[] | undefined;
  // A player hold (6x2C, the Grass Assassin's web): the player may not move
  // farther than sqrt(radius2) from (x, z) for `frames`.
  hold?: { clientId: number; frames: number; particle: number; x: number; z: number; radius2: number } | null;
  // The model is hidden (a warping Sinow: vtable +0x174 / +0x178).
  hidden?: boolean;
  // The Chaos Bringer's TP drain: every player in sight loses floor(TP *
  // tpDrain) (modify_tp_value); the owner reports the total back.
  tpDrain?: number;
  // A contact hit through entity_hit_by_tech (group 0 with this power: the
  // Chaos Bringer's charge), optionally with a status roll.
  techHit?: { clientId: number; power: number; status?: { type: number; chance: number } } | null;
  // The Chaos Sorcerer's Resta: heal the enemy with entity id `target` (0x1000 |
  // index; null / absent = the Sorcerer itself) with the technique at this
  // 0-based level.
  heal?: { level: number; target?: number | null } | null;
}

// What render/combat.ts drives: the generic FSM below or a per-family one.
export interface EnemyBrain {
  state: string;
  readonly motion: EnemyAiMotion | null;
  tick(targets: readonly AiTarget[], animationEnded?: boolean): AiFrame;
  onDamage(clientId: number): void;
  resume(): string;
  kill(): void;
  // Hits do not start the damage motion (flag 0x40000, the Garanz barrage).
  readonly superArmor?: boolean;
  // Bumped on a teleport (render/smoothrender.ts: the drawn pose snaps
  // instead of sliding). Only the renderer reads it.
  readonly warps?: number;
  // Hits do no damage (a crouching Grass Assassin, a cloaked Sinow ...).
  readonly invulnerable?: boolean;
  // Whether a hit of `damage` starts the flinch (the Dark Belra's hit handler
  // 0x00538dcc: only a hit of at least max HP / 5); absent = every hit.
  flinches?(damage: number, maxHp: number): boolean;
  // Flinch / death motions that depend on the brain's state (the Bulclaw /
  // Bulk forms, the stunned Dark Gunner); absent = the class's table.
  readonly flinchMotion?: EnemyAiMotion | null;
  readonly deathMotion?: EnemyAiMotion | null;
  // The owner keeps it current: confusion on this enemy (entity+0x30 & 0x10).
  confused?: boolean;
  // A melee hit of this enemy did `damage` (the Delsaber's shield refill).
  landed?(damage: number): void;
  // The players lost this much TP to the brain's tpDrain.
  drained?(tp: number): void;
}

// One enemy's behaviour. Positions are world units, angles radians; tick() is
// called once per game tick (30 per second).
export class EnemyAi {
  state: AiState = 'idle';
  // unknown_booma_enemy_find_target (0x0052b888, vtable +0x78) while
  // confused searches every entity, not only the players: the owner then
  // hands it the other enemies too (render/combat.ts), and the chase and the
  // attack run unchanged against whichever is nearest.
  confused = false;
  x: number;
  z: number;
  angle: number;
  targetId: number | null = null;
  near = false; // the guard-stance ("near the player") flag
  private spawnX: number;
  private spawnZ: number;
  private profile: EnemyAiProfile;
  private detect: number;
  private turn: number; // radians per tick
  private reach: number;
  private reachAngle: number; // radians, half-angle
  private radius: number;
  private speeds: EnemySpeeds;
  private wander: number; // e.dat wander radius of the spawn entry
  private timer = 0;
  private chaseTicks = 0;
  private attackIndex = 0;
  private attackFrames = 0;
  private dealt = false;
  private current: EnemyAiMotion | null = null;

  constructor(opts: {
    x: number;
    z: number;
    angle: number;
    profile: EnemyAiProfile;
    detect: number;
    turnRate: number; // BAMS per tick
    attack: EnemyAttackData | null;
    speeds: EnemySpeeds;
    radius: number;
    wander?: number;
  }) {
    this.x = this.spawnX = opts.x;
    this.z = this.spawnZ = opts.z;
    this.angle = opts.angle;
    this.profile = opts.profile;
    this.detect = opts.detect;
    this.turn = opts.turnRate * BAMS_TO_RAD;
    this.radius = opts.radius;
    this.speeds = opts.speeds;
    this.wander = opts.wander ?? 0;
    this.reach = opts.attack && opts.attack.distanceX > 0 ? opts.attack.distanceX : 0;
    this.reachAngle = ((opts.attack?.angle ?? 0x2000) & 0xffff) * BAMS_TO_RAD;
    this.current = opts.profile.idle;
  }

  get motion(): EnemyAiMotion | null {
    return this.current;
  }

  // The enemy died: state 8, the owner plays the death motion itself.
  kill(): void {
    this.state = 'dead';
    this.targetId = null;
    this.current = null;
  }

  // The enemy was hit: the real client goes through the damage animation and
  // `unknown_enemy_behavior_4` then resumes the chase with the attacker as the
  // target. Here it just drops into the chase on the attacker.
  onDamage(clientId: number): void {
    if (this.state === 'dead') return;
    this.targetId = clientId;
    this.state = 'chase';
    this.timer = 0;
    this.chaseTicks = 0;
    this.current = null; // the owner is playing the damage motion
  }

  // Called once the damage motion ended (combat/render puts the AI motion back).
  resume(): AiState {
    if (this.state === 'dead') return this.state;
    if (this.state === 'chase' || this.state === 'attack' || this.state === 'recover') {
      this.state = 'chase';
      this.current = this.gait() ?? this.profile.idle;
    } else {
      this.state = 'idle';
      this.current = this.profile.idle;
    }
    return this.state;
  }

  private play(m: EnemyAiMotion | null): EnemyAiMotion | null {
    if (m === this.current) return null;
    this.current = m;
    return m;
  }

  // The chase gait: the same motion with the animation step of the current
  // speed set (RemoveEnemyFromList_0052ad44 writes the frame step together
  // with the move speed).
  private gait(): EnemyAiMotion | null {
    const w = this.profile.walk;
    if (!w) return null;
    const speed = this.near ? this.speeds.engagedAnim : this.speeds.idleAnim;
    if (this.walkNear === this.near && this.walkMotion) return this.walkMotion;
    this.walkNear = this.near;
    this.walkMotion = { index: w.index, speed: w.speed * speed, loop: w.loop };
    return this.walkMotion;
  }

  private walkNear = false;
  private walkMotion: EnemyAiMotion | null = null;

  // One game tick against the players on this floor. `animationEnded` is true
  // when the motion the AI last asked for reached its last frame (the real
  // handlers test the entity's animation state, e.g. `field_0xb4 != 4`).
  tick(targets: readonly AiTarget[], animationEnded = false): AiFrame {
    const out: AiFrame = { motion: null, x: this.x, z: this.z, angle: this.angle, hit: null };
    if (this.state === 'dead') return out;
    const target = this.findTarget(targets);
    switch (this.state) {
      case 'idle':
        if (target) {
          // unknown_enemy_behavior_4: idle -> state 3 with the war cry.
          this.state = this.profile.notice ? 'notice' : 'chase';
          this.chaseTicks = 0;
          out.motion = this.play(this.profile.notice ?? this.gait() ?? this.profile.idle);
        } else {
          out.motion = this.play(this.profile.idle);
          this.walkHome(out);
        }
        break;
      case 'notice':
        if (!target) {
          this.state = 'idle';
          out.motion = this.play(this.profile.idle);
          break;
        }
        this.faceTarget(target);
        if (animationEnded) {
          this.state = 'chase';
          this.chaseTicks = 0;
          out.motion = this.play(this.gait() ?? this.profile.idle);
        }
        break;
      case 'chase': {
        if (!target) {
          this.state = 'idle';
          this.targetId = null;
          out.motion = this.play(this.profile.idle);
          break;
        }
        this.updateNear(target);
        this.faceTarget(target);
        const dist = Math.hypot(target.x - this.x, target.z - this.z);
        const stop = this.reach + this.radius;
        if (this.profile.attacks.length && dist <= stop && Math.abs(this.angleTo(target)) <= this.reachAngle) {
          // unknown_booma_enemy_attack_behavior: state 5, one of the attacks.
          this.state = 'attack';
          this.attackIndex = (this.attackIndex + 1) % this.profile.attacks.length;
          this.attackFrames = 0;
          this.dealt = false;
          out.motion = this.play(this.profile.attacks[this.attackIndex]);
          break;
        }
        out.motion = this.play(this.gait() ?? this.profile.idle);
        if (this.profile.walk && dist > stop) {
          const step = this.near ? this.speeds.engagedMove : this.speeds.idleMove;
          this.x += Math.sin(this.angle) * step;
          this.z += Math.cos(this.angle) * step;
        }
        if (++this.chaseTicks > CHASE_GIVE_UP_TICKS) {
          this.state = 'idle';
          this.targetId = null;
          this.chaseTicks = 0;
          out.motion = this.play(this.profile.idle);
        }
        break;
      }
      case 'attack': {
        const attack = this.profile.attacks[this.attackIndex];
        this.attackFrames += attack.speed;
        if (!this.dealt && this.attackFrames >= ATTACK_HIT_FRAME) {
          this.dealt = true;
          if (target && Math.abs(this.angleTo(target)) <= this.reachAngle && Math.hypot(target.x - this.x, target.z - this.z) <= this.reach + this.radius) {
            out.hit = { clientId: target.clientId, knockback: ATTACK_KNOCKBACK, mult: ATTACK_DAMAGE_MULT };
          }
        }
        // The attack animation ended: animation 0 and a 15-tick wait.
        if (animationEnded && this.dealt) {
          this.state = 'recover';
          this.timer = ATTACK_RECOVER_TICKS;
          out.motion = this.play(this.profile.idle);
        }
        break;
      }
      case 'recover':
        if (--this.timer <= 0) {
          if (target) {
            this.state = 'chase';
            this.chaseTicks = 0;
            out.motion = this.play(this.gait() ?? this.profile.idle);
          } else {
            this.state = 'idle';
            this.targetId = null;
            out.motion = this.play(this.profile.idle);
          }
        }
        break;
      default:
        exhaustive(this.state);
    }
    out.x = this.x;
    out.z = this.z;
    out.angle = this.angle;
    return out;
  }

  // EnemyGetNearestTargetInRange_007714cc: the nearest live player on this
  // floor inside the search radius; an acquired target is kept while it stays
  // inside it.
  private findTarget(targets: readonly AiTarget[]): AiTarget | null {
    const limit = this.detect * this.detect;
    let best: AiTarget | null = null;
    let bestSq = Infinity;
    for (const t of targets) {
      if (t.dead) continue;
      const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
      if (d > limit || d >= bestSq) continue;
      best = t;
      bestSq = d;
    }
    this.targetId = best ? best.clientId : null;
    return best;
  }

  private angleTo(t: AiTarget): number {
    const want = Math.atan2(t.x - this.x, t.z - this.z);
    const diff = want - this.angle;
    return Math.atan2(Math.sin(diff), Math.cos(diff));
  }

  // ClampAngleDifference_007a8c74: turn toward `want` by at most cfg[2] BAMS.
  private turnToward(want: number): void {
    const diff = Math.atan2(Math.sin(want - this.angle), Math.cos(want - this.angle));
    this.angle += Math.max(-this.turn, Math.min(this.turn, diff));
    this.angle = Math.atan2(Math.sin(this.angle), Math.cos(this.angle));
  }

  private faceTarget(t: AiTarget): void {
    this.turnToward(Math.atan2(t.x - this.x, t.z - this.z));
  }

  // ClearEnemyHitbox_0052ac5c: the "near the player" flag, with hysteresis.
  private updateNear(t: AiTarget): void {
    const d = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
    if (!this.near) {
      if (d < nearSq(t.charClass)) this.near = true;
    } else if (d > farSq(t.charClass)) {
      this.near = false;
    }
  }

  // The idle handler's way back: when the enemy is farther from its spawn point
  // than cfg[1] + e.dat wander radius + collision radius it walks straight back.
  private walkHome(out: AiFrame): void {
    const dx = this.spawnX - this.x;
    const dz = this.spawnZ - this.z;
    const dist = Math.hypot(dx, dz);
    const allowed = this.wander + this.radius;
    if (dist <= allowed || !this.profile.walk) {
      this.near = false;
      return;
    }
    out.motion = this.play(this.profile.walk);
    this.turnToward(Math.atan2(dx, dz));
    const step = Math.min(this.speeds.idleMove, dist);
    this.x += Math.sin(this.angle) * step;
    this.z += Math.cos(this.angle) * step;
  }
}

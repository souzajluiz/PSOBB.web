// Vol Opt, the Episode 1 Ruins boss, phase 1 and the control object (PsoBB.exe,
// Ephinea 1.25.13, addresses are VAs).
//
// Sources (docs/adr/0001-client-reference-sources.md): the Ephinea Ghidra dump
// for every state machine; tools/exedata.py for the tables. psobb-client-source
// (JP) has matching C for a handful of leaf functions of this fight and they
// agree with the dump: FUN_004416fc.cpp = VoloptMonitorSetHitFlag (flag
// 0x40000 of +0x390, flag 0x800 of +0x30, then vtable +0x104),
// FUN_00441f30.c = the monitor's activate state (clears 0x40000 once),
// FUN_00442f94.cpp = HandleVoloptMonitorPlayerHit (the pillar retract),
// FUN_00448430.cpp = form 2's state 1 (straight on to vtable +0xf0),
// FUN_00448f1c.c / FUN_00448f2c.c = SetVoloptMinionFlag / ClearVoloptMinionFlag
// (flag 0x8000000), FUN_004492a0.c = SinowbeatInitializeTeleportData, and
// FUN_0043da4c.c / FUN_0043ea70.c = the two targeting-slot calls. The other
// ~25 JP files that name "Volopt" are float-constant initialisers and the Dark
// Falz scene (everything from UpdateVoloptAiState on: its "VoloptForm2/7 MinionMapObject",
// "VoloptForm7Hazard", "VoloptInteractionObject" names are Dark Falz's, they
// share a mislabelled BML symbol with this fight), so Vol Opt has no form 7,
// no minion map objects and no hazards: those belong to the Dark Falz work.
//
// The fight is a set of entities that the control object (TBoss3Volopt 0xC2,
// entity id base+0) builds in its AI state 0 (0x0043C680): 6 pillars
// (base+1..6), 24 monitors (base+7..0x1e, 4 per wall), the lightning rod
// (base+0x21, not in Ultimate) and the core (base+0x22); the captured player's
// prison is base+0x20 and phase 2 (TBoss3VoloptP02 0xC5, combat/volopt2.ts) is
// a separate set entry. Every client runs every entity's state machine; only
// directors (Player__handlevoloptcommand and Volopt__ExecuteAttackPhase) are
// the room leader's, and they speak through
// 6x15 (action), 6x16 / 6x84 (the pillar table), 6x17 (positions), 6x85
// (Ultimate delays); 6x18 syncs form 2's four part HPs. Damage reaches an
// entity as its own 6x0A (the attacker's client sends it) and every client
// feeds its own copy of the HP.
//
// What is ASSUMED is marked in place. In short: the geometry of the core
// behind a wall (the sign of the sweep), the fade / camera waits (the exe waits
// for an overlay object and a camera event that this client does not have),
// the hatch lids (tracked, not drawn: VoloptLid), the laser bars' and the cage's
// look (balls, volopt2.ts), the Ultimate pillar's technique 0 (the exe's
// Gizonde-chain object is not traced: a plain bolt here), the level of the
// Ultimate objects, and the heights the hit tests use.

import { BAMS_TO_RAD, type AiFrame, type AiTarget, type EnemyBrain } from './enemyai.ts';
import type { EnemyMovementData } from '../formats/battleparams.ts';
import { BrainBase } from './enemyfsm.ts';
import { EnemyShot, type ShotEffect, type ShotLook } from './enemyshots.ts';
import { VOLOPT_MONITOR_OFFSET, VOLOPT_PILLAR_RADIUS } from '../formats/enemymodels.ts';
import { chopToInt } from './chop.ts';
import { trapFire } from './techfire.ts';
import { TECH } from './techniques.ts';

// The level the Ultimate pillar objects are made at (the exe passes 0x1d to the
// Foie / Gibarta constructors, 0x006e3480 / 0x006e4058). ASSUMED: the argument is
// the 0-based object level (29, Ultimate's top level).
export const VO_ULTIMATE_LEVEL = 0x1d;

export type Vec3 = [number, number, number];
const BAMS = BAMS_TO_RAD;

// --- ids and tables --------------------------------------------------------

// Entity id offsets from the control object (AI state 0, 0x0043C680).
export const VO_ID = { control: 0, pillar: 1, monitor: 7, prison: 0x20, rod: 0x21, core: 0x22 } as const;
export const VO_PILLARS = 6;
export const VO_MONITORS = 24;
export const VO_WALLS = 6;
// Parts in `VoloptAi.parts` order: pillars, monitors, prison, rod, core.
export const VO_PART_COUNT = VO_PILLARS + VO_MONITORS + 3;

// Motion slots of the pillar (table 0x009a5240): 0 wait, 2 the attack pose,
// 3 the hit, 5 the extension. [motion, speed, mode (1 loop, 2 once), next,
// flag]. The flag is "animation_flags", what the handlers compare.
export interface VoloptSlot {
  readonly motion: number;
  readonly speed: number;
  readonly mode: 1 | 2 | 3; // 1 loops, 2 plays once and goes on to `next`, 3 plays once and holds
  readonly next: number;
  readonly flag: number;
}
export const PILLAR_SLOTS: readonly VoloptSlot[] = [
  { motion: 15, speed: 0.7, mode: 1, next: 0, flag: 0 },
  { motion: 15, speed: 1, mode: 1, next: 0, flag: 1 },
  { motion: 0, speed: 0.5, mode: 2, next: 0, flag: 4 },
  { motion: 3, speed: 1.4, mode: 2, next: 0, flag: 8 },
  { motion: 15, speed: 1, mode: 1, next: 0, flag: 0x10 },
  { motion: 12, speed: 1, mode: 2, next: 2, flag: 0 },
];

// The pillar's rise / fall (0x00442c28 UpdateVoloptMonitorTransitionTimer and
// 0x00442bdc CheckVoloptMonitorDestructionTimer): y offset from -40.0
// (0x008fe544) by +2.9333 (0x00a449e4, static init 0x00443d7c) until 4.0
// (0x008fe540), then -0.6667 (0x00a449e8) until 0.0 (0x008fe548); lowering
// takes 2.9333 a tick back to -40.
export const PILLAR_RISE = { hidden: -40, step: 2.9333334, top: 4, settle: -0.6666667 } as const;

// Wall distances of the core behind the monitors (0x0043f344: 134.0 while the
// flag 0x20000 of +0x390 is set, 128.0 otherwise; divided by cos of the offset
// from the wall's middle; y 50.0 / 15.0).
export const CORE_WALL = { raised: 134, low: 128, raisedY: 50, lowY: 15 } as const;

// Monitor lock-on heights (the runtime array 0x00A44860): 43.0 for the big
// one, 15.0 for the three small ones.
const MONITOR_LOCK_Y = [43, 15, 15, 15] as const;
// ASSUMED: the height the hit tests use for a pillar (the exe's box radius
// and offset, 0x009a52c0 / g_VoloptPillarLockOnYOffset, were not read).
const PILLAR_LOCK_Y = 30;
// ASSUMED: render/combat.ts reaches an enemy with a 40 unit window in height,
// so the parts that sit higher are given the highest point that still counts.
export const VO_REACH_Y = 38;

// How long the exe waits for things this client does not have. ASSUMED.
export const VO_WAIT = {
  cameraIntro: 60, // sub 2 of the intro waits for the camera event (GlobalGameState + 2 & 1)
  fadeOut: 60, // the white overlay VoloptPlayerEntityConstructor makes, fading in
  fadeIn: 60, // CreateVoloptMinion's overlay fading back (g_VoloptForm7StateFlag)
  cameraForm2: 60, // state 3 sub 4 waits for the camera event
  traverse: 900, // the director's wait for the core (the exe has no cap)
} as const;

const norm16 = (a: number) => ((a % 0x10000) + 0x10000) % 0x10000;
const angDiff = (a: number, b: number) => {
  const d = norm16(a - b);
  return d > 0x8000 ? 0x10000 - d : d;
};
const bams = (deg: number) => Math.round((deg * 0x10000) / 360);

// --- parts ----------------------------------------------------------------

export type VoloptPartKind = 'pillar' | 'monitor' | 'prison' | 'rod' | 'core';

// A hit target of the fight. render/combat.ts gives each one an invisible
// enemy of its own (the entity id is base + `entity`) so the player's strikes
// and the other clients' 6x0A find it; the brain owns what happens to it.
export class VoloptPart {
  readonly kind: VoloptPartKind;
  readonly index: number; // within its kind
  readonly entity: number; // offset from the control's entity id
  hp: number;
  maxHp: number;
  // The lock-on / hit point (world).
  x = 0;
  y = 0;
  z = 0;
  targetable = false;
  dead = false;
  // Damage landed since the entity's update looked (vtable +0x88): who dealt
  // it (+0x2d8 == the local player) decides who forwards a hit to the core.
  hit = false;
  byLocal = false;
  constructor(kind: VoloptPartKind, index: number, entity: number, hp: number) {
    this.kind = kind;
    this.index = index;
    this.entity = entity;
    this.hp = hp;
    this.maxHp = hp;
  }
  // Damage that this client dealt (`byLocal`) or learned of through a 6x0A.
  damage(amount: number, byLocal: boolean): void {
    const d = Math.max(0, chopToInt(amount));
    if (d <= 0 || this.dead) return;
    this.hp = Math.max(0, this.hp - d);
    this.hit = true;
    this.byLocal = byLocal;
  }
  // restore_enemy_status: hp = max - damage_taken (the total on the wire).
  setDamageTaken(total: number): void {
    if (this.dead) return;
    const hp = Math.max(0, this.maxHp - Math.max(0, Math.round(total)));
    if (hp < this.hp) {
      this.hit = true;
      this.byLocal = false;
    }
    this.hp = Math.min(this.hp, hp);
  }
}

// Player__Animate on a tiny slot table (a once slot ends on its last frame and
// goes on to `next`).
export class VoloptAnim {
  slot = 0;
  frame = 0;
  // A holding slot (mode 3) reached its last frame.
  atEnd = false;
  // The last step ended the slot (a once slot ran out, a loop wrapped).
  ended = false;
  private slots: readonly VoloptSlot[];
  private frames: (motion: number) => number;
  constructor(slots: readonly VoloptSlot[], frames: (motion: number) => number) {
    this.slots = slots;
    this.frames = frames;
  }
  set(slot: number): void {
    this.slot = slot;
    this.frame = 0;
    this.atEnd = false;
  }
  step(): void {
    const s = this.slots[this.slot];
    const n = Math.max(1, this.frames(s.motion));
    this.ended = false;
    this.frame += s.speed;
    if (s.mode === 1) {
      if (this.frame >= n) {
        this.frame -= n;
        this.ended = true;
      }
    } else if (this.frame >= n - 1) {
      if (s.mode === 3) {
        this.frame = n - 1;
        this.atEnd = true;
      } else this.set(s.next);
      this.ended = true;
    }
  }
  // "elapsed >= frame" of the exe's waits, but a motion shorter than `frame`
  // ends the wait too (the exe would wait for ever).
  reached(frame: number): boolean {
    return this.ended || this.frame >= frame;
  }
  get flag(): number {
    return this.slots[this.slot].flag;
  }
}

// A guard for the states that wait on an animation or a flag: the exe would
// wait forever if the motion were shorter than the frame it waits for; this
// client moves on after `limit` ticks in one step. No state can hang.
export class VoloptWatchdog {
  private key = -1;
  private ticks = 0;
  readonly limit: number;
  constructor(limit = 1500) {
    this.limit = limit;
  }
  // True when the (state, step) pair `key` has lasted `limit` ticks.
  stuck(key: number): boolean {
    if (key !== this.key) {
      this.key = key;
      this.ticks = 0;
      return false;
    }
    if (++this.ticks < this.limit) return false;
    this.ticks = 0;
    return true;
  }
}

// What a part needs from the fight around it.
export interface VoloptFight {
  readonly ultimate: boolean;
  readonly events: VoloptEvent[];
  // g_VoloptPillarCheckFlag_0x50: the core finished its traverse.
  traverseDone: boolean;
  // g_VoloptPillarSpawnedFlag: a pillar was hit or destroyed this round.
  spawned: boolean;
  // g_CurrentVoloptMonitorId: the monitor the core is behind, or -1.
  exposed: number;
  rodDown(): boolean;
  wallChecked(wall: number): boolean;
  setChecked(monitor: number): void;
  coreHit(local: boolean): void;
  coreRetreat(hold: number): void;
  resetRod(): void;
  retractPillars(): void;
  // The active pillar's lightning (VoloptMonitorExecuteAttack0).
  bolt(pillar: number): void;
  leader(): boolean;
  // A sound that plays while the state does (PlayDirectionalSFX_00814630): a
  // set the owner reads each tick, nothing is allocated for it.
  sustain(id: number): void;
  frames(motion: number): number;
  movement: VoloptMovement;
}

// The BattleParamEntry MovementData rows of the fight (33 core, 34 pillar,
// 35 monitor, 36 rod) and the HPs the exe uses.
export interface VoloptMovement {
  coreSpeed: number; // row 33 iparam1: BAMS the core moves a tick
  bolt: number; // row 34 iparam1: the lightning's power
  bigMonitorHp: number; // row 35 iparam1
  smallMonitorHp: number; // row 35 iparam2
}

// --- events (what the owner must do) ----------------------------------------

export type VoloptEvent =
  // 6x15 {action, target, param, count}: the leader's order; every client
  // (the sender included) applies it.
  | { kind: 'action'; action: number; target: number; param: number; count: number }
  // 6x16 / 6x84 {entity_index_table[6], count (, technique)}.
  | { kind: 'pillars'; table: readonly number[]; count: number; technique: number | null }
  // 6x85 {action, pillar_delay_frames[3]}.
  | { kind: 'delays'; action: number; delays: readonly number[] }
  // 6x17 {entity, x, y, z, angle}: a player is placed in the other arena.
  | { kind: 'move'; client: number; x: number; y: number; z: number; angle: number }
  // 6x18 {capture, pillar, healing, missile part HP}.
  | { kind: 'partsHp'; hp: readonly number[] }
  // A monitor / pillar reaction hit the core with the attacker's strike
  // (player_hit_volopt_core): `local` = the attacker is us.
  | { kind: 'coreHit'; local: boolean }
  | { kind: 'se'; id: number }
  // The control moved on (music, logging).
  | { kind: 'phase'; phase: number }
  // Form 2 died: EXP / drop / 6x76 (combat/volopt2.ts).
  | { kind: 'killed'; x: number; y: number; z: number };

// --- the lightning --------------------------------------------------------

// What a shot returns when it hit nobody (shared, never changed).
export const NO_HITS: AiTarget[] = [];

// VoloptMonitorExecuteAttack0 (PsoBB.exe 0x004437ec, read 2026-10-31): every
// live player (flags 0x2000800 clear, index < 0x1000) is hit at once by
// entity_hit_by_tech(attacker = the pillar, group 3, power = the pillar row's
// iparam1 (`g_pVoloptMonitorAnimSpeeds + 0x18`), 0, -1, -1): the Zonde family,
// (100 - ETH) * 0.002 * (MST * 0.5 + power) with the shock roll (the port's
// enemyTechOnPlayer). The effect is group 3, not the fixed group 0 used before.
export const VO_BOLT_GROUP = 3;

export class VoloptBolt extends EnemyShot {
  override readonly absolute = true;
  readonly effect: ShotEffect;
  readonly look: ShotLook = { color: 0xa8c8ff, size: 2.5 };
  constructor(x: number, y: number, z: number, power: number) {
    super(x, y, z);
    this.effect = { kind: 'tech', power: Math.max(0, power), group: VO_BOLT_GROUP };
  }
  tick(targets: readonly AiTarget[]): AiTarget[] {
    if (this.done) return NO_HITS;
    this.frames++;
    this.done = true;
    return targets.filter((t) => !t.dead);
  }
}

// --- the pillar's hatch lid ---------------------------------------------------

// The 0x34-byte object at +0x3C0 of every pillar (ctor 0x0044B84C, vtable
// 0x00AF68C8, update 0x0044B8C4, draw 0x0044B9A0; the dump calls it
// VoloptPrisonBar). It is the cover of the pillar's hatch: the draw puts the
// first node of the BML's model entry 13 (fe_obj_vo_futa_moto, +0xD8 of the
// model table) at (0, b, 0) and its child node at (0, a, 0), turned by
// (-60 * index - 90) degrees like the pillar. The pillar sets +0x20 (and +0x24 to
// 0): 1 closes the hatch, 2 opens it.
//   state 1 (0x0044B944)  sub 0: b rises 1.8 a tick (0x00A44CA4) to 0.0, sub 1:
//                         a rises 0.3 a tick (0x00A44CA8) to 0.0, then state 0
//   state 2 (0x0044B8E4)  sub 0: a falls 0.3 a tick to -3.0 (0x008FEA10), sub 1:
//                         b falls 1.8 a tick to -18.0 (0x008FEA14), then state 0
export const LID = { stepA: Math.fround(0.3), stepB: Math.fround(1.8), minA: -3, minB: -18 } as const;

export class VoloptLid {
  state = 0;
  sub = 0;
  a = 0; // +0x28, drawn with the child node (table 0x00A44CB4)
  b = 0; // +0x2C, drawn with the first node (table 0x00A44CB0)

  set(state: number): void {
    this.state = state;
    this.sub = 0;
  }

  tick(): void {
    if (this.state === 1) {
      if (this.sub === 0) {
        const v = this.b + LID.stepB;
        if (v >= 0) {
          this.sub = 1;
          this.b = 0;
        } else this.b = Math.fround(v);
      } else {
        const v = this.a + LID.stepA;
        if (v >= 0) {
          this.state = 0;
          this.a = 0;
        } else this.a = Math.fround(v);
      }
    } else if (this.state === 2) {
      if (this.sub === 0) {
        const v = this.a - LID.stepA;
        if (v <= LID.minA) {
          this.sub = 1;
          this.a = LID.minA;
        } else this.a = Math.fround(v);
      } else {
        const v = this.b - LID.stepB;
        if (v <= LID.minB) {
          this.state = 0;
          this.b = LID.minB;
        } else this.b = Math.fround(v);
      }
    }
  }
}

// --- pillar -----------------------------------------------------------------

// States are the exe's +0x32e: 0 idle, 2 rise / attack, 4 hit, 5 dead,
// 9 retract.
export class VoloptPillar extends VoloptPart {
  st = 0;
  sub = 0;
  lastSub = 0; // unknown_animation_speed2: where state 2 resumes after a hit
  timer = 0;
  active = false; // +0x3b0: the red pillar that fires
  fires = 0; // unknown_animation_speed3
  yOff: number = PILLAR_RISE.hidden; // current_target_idx, the height above the floor
  private phase = 0; // +0x398 of the rise
  attacking = false; // flag 0x10000 of +0x390
  retracting = false; // flag 0x20000
  locked = false; // flag 1: the state does not change
  // The hatch lid (the object at +0x3C0): its state is written like the exe
  // does (+0x20 = n, +0x24 = 0): 1 closes the hatch, 2 opens it.
  readonly lid = new VoloptLid();
  get bars(): number {
    return this.lid.state;
  }
  set bars(state: number) {
    this.lid.set(state);
  }
  private readonly anim: VoloptAnim;
  private readonly fight: VoloptFight;
  private readonly dog = new VoloptWatchdog();
  readonly baseX: number;
  readonly baseZ: number;
  readonly angle: number;
  constructor(index: number, hp: number, fight: VoloptFight, ox: number, oz: number) {
    super('pillar', index, VO_ID.pillar + index, hp);
    this.fight = fight;
    const a = bams(index * 60);
    // Ctor 0x004422D4: radius 76.0 (0x008fe56c) at i * 60 degrees.
    this.baseX = ox + VOLOPT_PILLAR_RADIUS * Math.cos(a * BAMS);
    this.baseZ = oz + VOLOPT_PILLAR_RADIUS * Math.sin(a * BAMS);
    this.angle = (-0x4000 - a) * BAMS;
    this.anim = new VoloptAnim(PILLAR_SLOTS, (m) => fight.frames(m));
    this.x = this.baseX;
    this.z = this.baseZ;
    this.syncPose();
  }

  get animFrame(): number {
    return this.anim.frame;
  }
  get animSlot(): number {
    return this.anim.slot;
  }

  private syncPose(): void {
    this.x = this.baseX;
    this.z = this.baseZ;
    this.y = Math.min(VO_REACH_Y, PILLAR_LOCK_Y + this.yOff);
  }

  // ProcessEntityVoloptState (via 6x16): the table's entries go to
  // state 2, the first one as the red pillar.
  start(active: boolean): void {
    if (this.dead) return;
    this.locked = false;
    if (this.st !== 2) this.enter(2);
    this.active = active;
  }

  // HandleVoloptMonitorPlayerHit (JP FUN_00442f94.cpp): only a pillar that is
  // up and not hit-killed retracts.
  retract(): void {
    if (this.dead || !this.targetable || this.locked || this.st === 9) return;
    this.enter(9);
  }

  private enter(st: number): void {
    this.st = st;
    this.sub = 0;
  }

  private goIdle(): void {
    this.st = 0;
    this.sub = 0;
  }

  private rise(): boolean {
    if (this.phase === 0) {
      this.yOff += PILLAR_RISE.step;
      if (this.yOff >= PILLAR_RISE.top) this.phase = 1;
    } else if (this.phase === 1) {
      const f = this.yOff + PILLAR_RISE.settle;
      if (f <= 0) {
        this.yOff = 0;
        return true;
      }
      this.yOff = f;
    }
    return false;
  }

  private lower(): boolean {
    const f = this.yOff - PILLAR_RISE.step;
    if (f <= PILLAR_RISE.hidden) {
      this.phase = 0;
      this.yOff = PILLAR_RISE.hidden;
      this.bars = 1;
      return true;
    }
    this.yOff = f;
    return false;
  }

  tick(): void {
    // The update (unknown_update_volopt_pillar): the death check first, then
    // the hit, then the state (which starts over when it changed).
    if (this.st !== 5 && (this.hp <= 0 || this.dead)) {
      this.dead = true;
      this.enter(5);
      this.locked = true;
    } else if (this.hit && this.st !== 5) {
      if (!this.locked && this.st !== 4) {
        this.enter(4);
        this.locked = true;
      }
    }
    // A hit that did not change the state is consumed here.
    this.hit = false;
    if (this.st !== 5 && this.dog.stuck(this.st * 32 + this.sub)) {
      this.locked = false;
      this.attacking = false;
      this.retracting = false;
      this.goIdle();
    }
    switch (this.st) {
      case 0:
        this.tickIdle();
        break;
      case 2:
        this.tickAttack();
        break;
      case 4:
        this.tickHit();
        break;
      case 5:
        this.tickDead();
        break;
      case 9:
        this.tickRetract();
        break;
    }
    this.lid.tick();
    this.syncPose();
  }

  // VoloptMonitorInitState0: hidden, nothing active.
  private tickIdle(): void {
    if (this.sub === 0) {
      this.targetable = false;
      this.yOff = PILLAR_RISE.hidden;
      this.phase = 0;
      this.active = false;
      this.bars = 1;
      this.anim.set(0);
      this.sub = 1;
    }
  }

  // UpdateVoloptMonitor (state 2). `lastSub` keeps the step a hit interrupted.
  private tickAttack(): void {
    const f = this.fight;
    switch (this.sub) {
      case 0:
        if (!this.attacking) {
          this.attacking = true;
          this.fires = 0;
          this.yOff = PILLAR_RISE.hidden;
          this.phase = 0;
          this.bars = 2;
          this.anim.set(5);
          this.timer = 20;
          this.sub = 1;
          this.lastSub = 1;
        } else {
          // Resumed after a hit (the saved step).
          this.sub = this.lastSub || 3;
          if (this.sub === 2 || this.sub === 3) this.anim.set(5);
        }
        this.targetable = this.sub >= 3;
        break;
      case 1:
        this.targetable = false;
        if (--this.timer < 1) {
          f.events.push({ kind: 'se', id: 0x340 });
          this.sub = 2;
          this.lastSub = 2;
        }
        break;
      case 2:
        this.targetable = false;
        if (this.rise()) {
          this.sub = 3;
          this.lastSub = 3;
        }
        break;
      case 3:
        this.targetable = true;
        this.anim.step();
        if (this.anim.slot === 2) {
          if (!this.active) {
            this.lastSub = 12;
            this.sub = 12;
            this.timer = 0xaf;
            this.attacking = false;
          } else {
            this.lastSub = 4;
            this.sub = 4;
          }
        }
        break;
      case 4:
        this.targetable = true;
        this.timer = 0x19;
        this.sub = 5;
        this.lastSub = 5;
        break;
      case 5:
        f.sustain(0xa5);
        if (--this.timer < 1) {
          this.lastSub = 6;
          this.sub = 6;
        }
        break;
      case 6:
        this.anim.step();
        if (this.anim.reached(8)) this.sub = 7;
        break;
      case 7:
        // VoloptMonitorExecuteAttack0 (normal) / the technique objects.
        this.fire();
        this.fires++;
        this.sub = 8;
        this.attacking = false;
        this.timer = 0x78;
        break;
      case 8:
        if (--this.timer < 1) this.sub = 9;
        break;
      case 9:
        this.anim.step();
        if (this.anim.flag !== 4) this.sub = this.fires < 2 ? 4 : 10;
        break;
      case 10:
        f.events.push({ kind: 'se', id: 0x34a });
        this.sub = 11;
        if (this.lower()) this.finishAttack();
        break;
      case 11:
        if (this.lower()) this.finishAttack();
        break;
      case 12:
        this.targetable = true;
        if (--this.timer < 1) this.sub = 10;
        break;
    }
  }

  private finishAttack(): void {
    this.targetable = false;
    this.locked = false;
    this.attacking = false;
    this.goIdle();
  }

  private fire(): void {
    const f = this.fight;
    if (!this.active) return;
    // The bolt reaches every live player; when the rod lies on the floor the
    // pillar tells everybody (6x15 action 2) and the round ends.
    f.bolt(this.index);
    // The exe has every client's copy send this (VoloptMonitorExecuteAttack0
    // 6x15 action 2); the receivers' rod reset is not idempotent (it restores
    // HP), so only the leader's copy sends it here. ASSUMED deviation.
    if (f.rodDown() && f.leader()) f.events.push({ kind: 'action', action: 2, target: 0, param: 0, count: 0 });
  }

  // player_hit_volopt_pillar (state 4).
  private tickHit(): void {
    const f = this.fight;
    if (this.sub === 0) {
      this.targetable = true;
      if (this.active) {
        // The red pillar's hit reaches the core and sends it away.
        f.spawned = true;
        f.coreHit(this.byLocal);
        f.coreRetreat(300);
      }
      this.anim.set(3);
      this.sub = 1;
      return;
    }
    if (this.sub === 1) {
      this.anim.step();
      if (this.anim.flag === 8) return;
      // The reaction ended: resume the attack, retract, or leave.
      if (this.attacking) {
        this.locked = false;
        this.st = 2;
        this.sub = 0;
      } else if (!this.retracting) {
        f.events.push({ kind: 'se', id: 0x34a });
        this.sub = 2;
      } else {
        this.locked = false;
        this.enter(9);
      }
      return;
    }
    // sub 2: lower and go idle.
    if (this.lower()) {
      this.targetable = false;
      this.locked = false;
      this.attacking = false;
      this.goIdle();
    }
  }

  // unknown_volopt_pillar_behavior (state 5): the wreck stays.
  private tickDead(): void {
    const f = this.fight;
    if (this.sub === 0) {
      this.targetable = false;
      this.attacking = false;
      this.anim.set(4);
      this.timer = 0x5a;
      this.bars = 1;
      if (this.active) {
        f.spawned = true;
        f.coreHit(this.byLocal);
        f.coreRetreat(300);
      }
      this.sub = 1;
    }
    if (this.sub === 1) {
      this.anim.step();
      if (--this.timer < 0) {
        f.events.push({ kind: 'se', id: 0x341 });
        this.sub = 2;
        this.targetable = false;
      }
    }
    // sub 2: nothing, ever (flag 0x40000 of +0x390: out of the director's table).
  }

  // ProcessVoloptMonitorBehavior (state 9): up (or rising) with a glow for
  // 150 frames, then down.
  private tickRetract(): void {
    switch (this.sub) {
      case 0:
        this.anim.set(0);
        if (!this.retracting) {
          this.retracting = true;
          this.timer = 0x96;
        }
        this.bars = 2;
        if (this.yOff < 0) {
          this.targetable = false;
          this.phase = 0;
          this.sub = 1;
        } else {
          this.sub = 2;
        }
        break;
      case 1:
        this.targetable = false;
        if (this.rise()) this.sub = 2;
        break;
      case 2:
        this.targetable = true;
        this.sub = 3;
        break;
      case 3:
        this.targetable = true;
        if (--this.timer < 1) {
          this.retracting = false;
          this.sub = 4;
        }
        break;
      case 4:
        this.targetable = false;
        if (this.lower()) {
          this.locked = false;
          this.attacking = false;
          this.goIdle();
        }
        break;
    }
  }

  // The director's "busy": the pillar exists, is not a wreck and is not idle.
  get busy(): boolean {
    return !this.dead && this.st !== 0;
  }
  get wreck(): boolean {
    return this.dead;
  }
}

// --- monitor ----------------------------------------------------------------

export class VoloptMonitor extends VoloptPart {
  readonly wall: number;
  readonly shape: number;
  st = 0;
  sub = 0;
  private timer = 0;
  private locked = false;
  private readonly fight: VoloptFight;
  broken = false; // flag 0x40000 of +0x390
  // The struck test (EntityHitEntity 0x00773350 via the box overlap 0x007b5e40 and
  // do_collision_check_with_enemies 0x007b8980, PsoBB.exe): a monitor is struck while its
  // entity is not dead (+0x30 0x800) and its boxes are on (bit 0 and 0x8000, fixed in the
  // table). No exposure test is in that path; the exposure only gates the forward to the core
  // (player_hit_volopt_monitor 0x00441558, `wall == exposed >> 2`), see `forward`. So a monitor
  // on another wall takes damage, and it is `targetable` (the display window) only when exposed.
  get hittable(): boolean {
    return !this.broken && !this.dead;
  }
  constructor(index: number, hpBig: number, hpSmall: number, fight: VoloptFight, ox: number, oz: number) {
    const shape = index & 3;
    super('monitor', index, VO_ID.monitor + index, shape === 0 ? hpBig : hpSmall);
    this.fight = fight;
    this.shape = shape;
    this.wall = index >> 2;
    // Ctor 0x0044161C: the shape's point (0, 0, z) turned by wall * 60 degrees.
    const a = bams(this.wall * 60) * BAMS;
    const z = VOLOPT_MONITOR_OFFSET[shape];
    this.x = ox + z * Math.sin(a);
    this.z = oz + z * Math.cos(a);
    this.y = Math.min(VO_REACH_Y, MONITOR_LOCK_Y[shape]);
  }

  tick(): void {
    // The update (handle_volopt_monitor_behavior).
    if (this.st !== 5 && this.hp <= 0) {
      this.dead = true;
      this.st = 5;
      this.sub = 0;
      this.locked = true;
    } else if (this.hit && !this.locked && this.st !== 4 && this.st !== 5) {
      this.st = 4;
      this.sub = 0;
      this.locked = true;
    }
    this.hit = false;
    const f = this.fight;
    switch (this.st) {
      case 0:
        // VoloptMonitorUpdate: its +0x344 is 0, so it goes on to the activate
        // state at once (vtable +0xf4).
        this.st = 1;
        this.sub = 0;
        break;
      case 1:
        // The activate state (JP FUN_00441f30.c): flag 0x40000 off, once.
        if (this.sub === 0) this.sub = 1;
        break;
      case 4:
        if (this.sub === 0) {
          f.events.push({ kind: 'se', id: 0x33d });
          this.forward();
          this.timer = 3;
          this.sub = 1;
        } else if (--this.timer < 1) {
          this.locked = false;
          this.st = 0;
          this.sub = 0;
        }
        break;
      case 5:
        if (this.sub === 0) {
          f.events.push({ kind: 'se', id: 0x33e });
          this.forward();
          f.setChecked(this.index);
          this.sub = 1;
        }
        break;
    }
    // Only the wall the core is behind can be shot.
    this.targetable = !this.broken && !this.dead && f.exposed >= 0 && f.exposed >> 2 === this.wall;
  }

  // player_hit_volopt_monitor: a monitor of the core's wall
  // passes the strike on to the core.
  private forward(): void {
    const f = this.fight;
    if (!this.broken && f.exposed >= 0 && f.exposed >> 2 === this.wall) f.coreHit(this.byLocal);
  }

  // The wall's big monitor and its three small ones fall together
  // (state 5 of the monitor: the big one takes the small ones, the last small
  // one takes the big one).
  breakDown(): void {
    this.broken = true;
    this.hp = 0;
    this.dead = true;
    this.targetable = false;
  }
}

// --- rod --------------------------------------------------------------------

// The lightning rod (ctor 0x00440ad8, stat init 0x004413a4): it hangs at
// (0, 80, 0), sinks to y = 50 spinning (state 7 then 1), and shot down it falls
// to the floor (state 5; its box flag 2 is what the pillar tests). The round's
// 6x15 action 2 (VoloptPhaseTransition) stands it up again.
export class VoloptRod extends VoloptPart {
  st = 7;
  y0 = 80;
  private timer = 0;
  readonly cx: number;
  readonly cz: number;
  private locked = false;
  constructor(hp: number, ox: number, oz: number) {
    super('rod', 0, VO_ID.rod, hp);
    this.cx = ox;
    this.cz = oz;
    this.x = ox;
    this.z = oz;
    this.y = VO_REACH_Y;
  }
  // Not built in Ultimate (g_VoloptDifficultyMode != 0).
  absent = false;
  get down(): boolean {
    return !this.absent && this.st === 5 && this.timerDone;
  }
  private timerDone = false;
  reset(): void {
    // VoloptPhaseTransition: HP back, locked in the hover state again.
    this.hp = this.maxHp;
    this.dead = false;
    this.hit = false;
    this.st = 7;
    this.y0 = 80;
    this.timerDone = false;
    this.locked = false;
  }
  tick(): void {
    if (this.absent) {
      this.targetable = false;
      return;
    }
    if (this.st !== 5 && this.hp <= 0) {
      this.dead = true;
      this.st = 5;
      this.timerDone = false;
      this.locked = true;
    } else if (this.hit && !this.locked && this.st !== 4 && this.st !== 5 && this.st !== 7) {
      this.st = 4;
      this.timer = 12;
      this.locked = true;
    }
    this.hit = false;
    switch (this.st) {
      case 7:
        // State 7: from 80 down by 0.5 (0x008fe19c) to 50 (0x008fe1ac).
        this.y0 -= 0.5;
        if (this.y0 <= 50) {
          this.y0 = 50;
          this.st = 1;
        }
        this.targetable = false;
        break;
      case 4:
        if (--this.timer < 1) {
          this.locked = false;
          this.st = 1;
        }
        break;
      case 5:
        // Falls 2.27 a tick to 4.6 (0x008fe1a8); there its flag 2 is set.
        this.y0 = Math.max(4.6, this.y0 - 2.27);
        if (this.y0 <= 4.6) this.timerDone = true;
        break;
    }
    // Shootable while it hangs (state 1, or flinching in 4).
    this.targetable = this.st === 1 || this.st === 4;
    this.y = Math.min(VO_REACH_Y, this.y0);
  }
}

// --- core ------------------------------------------------------------------

// The core (VoloptEntityConstructorImpl; states in the dump order
// 0 idle, 1 traverse, 4 hit, 5 dead, 7 appear, 9 stand, 10 retreat). It lives
// behind the monitors and is hit through them; its own box is never shot.
export class VoloptCore extends VoloptPart {
  st = 0;
  sub = 0;
  angle = 0; // +0x398, BAMS
  depth = 0; // +0x39c
  wall = 0; // the wall it is on (-1: none)
  private count = 0; // +0x3c8: walls left
  private cursor = 0; // +0x3c4
  private hold = 0; // +0x3cc
  private timer = 0;
  private locked = false;
  private saved = 0;
  private turned = false; // heading rotated away from the traverse's (state 9)
  raised = false; // flag 0x20000 of +0x390
  hidden = true;
  private readonly fight: VoloptFight;
  private readonly dog = new VoloptWatchdog();
  private readonly speed: number;
  private readonly threshold: number;
  readonly ox: number;
  readonly oz: number;
  constructor(hp: number, speed: number, fight: VoloptFight, ox: number, oz: number) {
    super('core', 0, VO_ID.core, hp);
    this.fight = fight;
    this.speed = Math.max(1, speed);
    // InitializeVoloptEntityDetails: the heading threshold 0x200, 0xa00 in Ultimate.
    this.threshold = fight.ultimate ? 0xa00 : 0x200;
    this.ox = ox;
    this.oz = oz;
  }

  // SinowbeatSetActionState (6x15 action 0).
  command(start: number, count: number): void {
    if (this.dead) return;
    this.fight.traverseDone = false;
    this.cursor = ((start % 6) + 6) % 6;
    this.raised = true;
    this.count = Math.max(1, count);
    this.hold = 600;
    this.turned = false;
    if (!this.selectWall()) return;
    this.locked = false;
    if (this.st !== 1) {
      this.saved = this.st;
      this.st = 1;
      this.sub = 0;
    }
  }

  // VoloptSelectSpawnPhase: the next wall whose big monitor still
  // stands, going backwards from the cursor.
  private selectWall(): boolean {
    for (let k = 0; k < VO_WALLS; k++) {
      const w = (this.cursor - k + 6) % 6;
      if (!this.fight.wallChecked(w)) {
        this.cursor = w;
        this.wall = w;
        this.depth = -0x71c;
        this.angle = bams(w * 60 + 110);
        return true;
      }
    }
    this.fight.traverseDone = true;
    this.goIdle();
    return false;
  }

  private goIdle(): void {
    this.saved = this.st;
    this.st = 0;
    this.sub = 0;
    this.locked = false;
  }

  // VoloptSetTargetEntity (a pillar hit, 6x15 action 1): state 10.
  retreat(hold: number): void {
    if (this.dead || this.st === 10) return;
    if (!this.locked) {
      this.saved = this.st;
      this.st = 10;
      this.sub = 0;
    }
    this.hold = hold;
  }

  // The offset from the wall's middle in BAMS (the sweep).
  get offset(): number {
    return (norm16(this.angle) % 0x2aaa) - 0x1555;
  }

  // VoloptGetTargetIndex: the monitor the core is behind. Raised
  // (flag 0x20000), only the big one within 0x8dc of the middle.
  exposedMonitor(monitorAlive: (index: number) => boolean): number {
    if (this.st === 0) return -1;
    const rel = this.offset;
    let shape: number;
    if (!this.raised) {
      if (rel > 0xdb2) return -1;
      if (rel >= 0x510) shape = 1;
      else if (rel >= -0x510) shape = 2;
      else if (rel >= -0xdb2) shape = 3;
      else return -1;
    } else {
      if (Math.abs(rel) > 0x8dc) return -1;
      shape = 0;
    }
    const id = this.wall * 4 + shape;
    return monitorAlive(id) ? id : -1;
  }

  // Position behind the wall (unknown_volopt_core_behind_monitor_positioning).
  // ASSUMED: the core's sweep runs along the wall's tangent in the direction
  // of decreasing angle (the sign depends on the exe's rotation convention,
  // which was not traced).
  place(): void {
    const w = this.wall;
    const aw = bams(w * 60) * BAMS;
    const rel = this.offset * BAMS;
    const d = this.raised ? CORE_WALL.raised : CORE_WALL.low;
    const nx = -Math.sin(aw);
    const nz = -Math.cos(aw);
    const tx = Math.cos(aw);
    const tz = -Math.sin(aw);
    const t = d * Math.tan(rel);
    this.x = this.ox + nx * d + tx * t;
    this.z = this.oz + nz * d + tz * t;
    this.y = this.raised ? CORE_WALL.raisedY : CORE_WALL.lowY;
  }

  // The appear state (7) the intro puts it in (PlayerVoloptInteractionHandler, the 90 frame one): at the first wall
  // for 90 frames.
  appear(): void {
    this.cursor = 0;
    this.wall = 0;
    this.angle = 0x4000;
    this.depth = -0x1555;
    this.raised = true;
    this.saved = this.st;
    this.st = 7;
    this.sub = 0;
    this.locked = true;
  }

  tick(): void {
    if (this.st !== 5 && this.hp <= 0) {
      this.dead = true;
      this.st = 5;
      this.sub = 0;
      this.locked = true;
    } else if (this.hit && !this.locked && this.st !== 4 && this.st !== 5) {
      this.saved = this.st;
      this.st = 4;
      this.sub = 0;
      this.locked = true;
    }
    this.hit = false;
    const f = this.fight;
    if (this.st !== 0 && this.st !== 5 && this.dog.stuck(this.st * 32 + this.sub)) this.goIdle();
    switch (this.st) {
      case 0:
        // VoloptActivate: hidden, and the director may go on.
        if (this.sub === 0) {
          this.hidden = true;
          f.traverseDone = true;
          this.sub = 1;
        }
        break;
      case 1:
        this.tickTraverse();
        break;
      case 4:
        // The hit reaction (motion 2 at 0.8 once): back to what it was doing.
        if (this.sub === 0) {
          this.timer = Math.max(1, Math.ceil(f.frames(2) / 0.8));
          this.sub = 1;
        } else if (--this.timer < 1) {
          this.locked = false;
          this.st = this.saved === 4 ? 0 : this.saved;
          this.sub = 0;
          if (this.st === 1) this.sub = 1; // keep the sweep where it was
          if (this.st === 0) this.sub = 0;
        }
        break;
      case 5:
        this.hidden = false;
        break;
      case 7:
        if (this.sub === 0) {
          this.hidden = false;
          this.timer = 0x5a;
          this.sub = 1;
        } else if (--this.timer < 1) {
          this.locked = false;
          this.goIdle();
        }
        break;
      case 9:
        // PlayerVoloptInteractionUpdate: turn the heading a quarter round at
        // `threshold` a tick, then wait 30 frames (5 in Ultimate).
        if (this.sub === 0) {
          this.timer = Math.ceil(0x4000 / this.threshold) + (f.ultimate ? 5 : 30) + 2;
          this.turned = true;
          this.locked = true;
          this.sub = 1;
        } else if (--this.timer < 1) {
          f.events.push({ kind: 'se', id: 0x358 });
          f.traverseDone = true;
          this.goIdle();
        }
        break;
      case 10:
        this.tickRetreat();
        break;
    }
    this.place();
    this.targetable = false;
  }

  private tickTraverse(): void {
    const f = this.fight;
    this.hidden = false;
    if (this.sub === 0) {
      this.sub = 1;
      return;
    }
    this.angle -= this.speed;
    this.depth -= this.speed;
    if (this.count < 2) {
      if (this.depth < -0x1555 && !this.locked && this.st !== 9) {
        this.saved = this.st;
        this.st = 9;
        this.sub = 0;
        return;
      }
    } else if (this.depth < -0x238d) {
      this.count--;
      this.cursor = (this.cursor + 5) % 6;
      if (this.selectWall()) this.sub = 0;
      return;
    }
    f.sustain(0x33f);
  }

  // PlayerState10_VoloptInteraction: from the traverse it drops straight away;
  // from the stand it first waits `hold` frames and turns back.
  private tickRetreat(): void {
    if (this.sub === 0) {
      this.hidden = false;
      this.timer = this.turned ? Math.max(0, this.hold) + Math.ceil(0x4000 / this.threshold) : 0;
      this.sub = 1;
    }
    if (this.timer > 0) {
      this.timer--;
      return;
    }
    this.angle -= this.speed;
    this.depth -= this.speed;
    if (this.depth < -0x238d) {
      this.locked = false;
      this.goIdle();
    }
  }
}

// --- the control object ------------------------------------------------------

export interface VoloptOptions {
  x: number;
  z: number;
  angle: number;
  ultimate: boolean;
  // MovementData rows 33..35 and the stats HP of rows 33, 34, 36 (the exe
  // overrides the monitor HP with iparam1 / iparam2 of row 35).
  movement: { core: EnemyMovementData | null; pillar: EnemyMovementData | null; monitor: EnemyMovementData | null };
  hp: { core: number; pillar: number; rod: number };
  leader: () => boolean;
  frames: (motion: number) => number; // frame count of a pillar-archive motion
  // The HP of a player (+0x334): the Ultimate director aims at the one with the most.
  playerHp?: (client: number) => number;
  rng: () => number;
}

// Row values of BattleParamEntry_on.dat (Normal), used only when the table is
// not there. ASSUMED fallback.
const FALLBACK_MOVEMENT: VoloptMovement = { coreSpeed: 120, bolt: 280, bigMonitorHp: 420, smallMonitorHp: 350 };
const FALLBACK_HP = { core: 3000, pillar: 500, rod: 450 };

// The control object's AI state (the table at 0x0043C680 and the dispatcher
// EnemyProcessAiState): 0 build, 1 intro, 2 phase 1, 3 the change to
// form 2, 4 phase 2, 5 over.
export const VO_AI = { build: 0, intro: 1, fight: 2, change: 3, fight2: 4, over: 5 } as const;
const AI_NAMES = ['build', 'intro', 'phase 1', 'to form 2', 'phase 2', 'over'] as const;

// The link to the phase 2 body (combat/volopt2.ts).
export interface VoloptForm2Link {
  readonly dead: boolean;
  readonly ready: boolean; // standing, alive and the fight is on
  readonly busyParts: number; // CountUnreadyStates: parts at 0 HP
  // The director's view of form 2 (flags 0x10000..0x80000 of +0x390: a part at
  // 0 HP turns its action off).
  canAct(action: 3 | 4 | 5 | 6 | 7): boolean;
  appear(): void; // GiGuesSetAIStateTo7 (the body stands up)
  begin(): void; // the minion flag 0x8000000 is gone: it can be hit
  bindPrison(part: VoloptPart): void;
  position(out: Vec3): void;
  facing(): number; // BAMS, atan2(dx, dz) convention
}

export class VoloptAi extends BrainBase implements VoloptFight {
  state: string = 'build';
  readonly superArmor = true;
  readonly ultimate: boolean;
  readonly events: VoloptEvent[] = [];
  // Sounds that last while their state does; cleared every tick.
  readonly sustained = new Set<number>();
  readonly pillars: VoloptPillar[] = [];
  readonly monitors: VoloptMonitor[] = [];
  readonly rod: VoloptRod;
  readonly core: VoloptCore;
  readonly prison: VoloptPart;
  // Every hit target in entity order (pillars, monitors, prison, rod, core).
  readonly parts: VoloptPart[] = [];
  private form2Link: VoloptForm2Link | null = null;
  movement: VoloptMovement;
  ai: number = VO_AI.build;
  private sub = 0;
  private timer = 0;
  private waited = 0;
  // The director (+0x3f8 cursor, +0x3fa pause, +0x400 round, +0x404 count).
  cursor = 0;
  cooldown = 0;
  private round = 0;
  private pillarCount = 2;
  private wallCursor = 0; // last_footstep_effect_z: where the next traverse starts
  private picks = 0; // +0x40c: every third Ultimate target is random
  traverseDone = false;
  spawned = false;
  exposed = -1;
  // g_VoloptPillarCheckFlags: a monitor that fell (the wall's flag is its big one's).
  private readonly checked = new Uint8Array(VO_MONITORS);
  private readonly order = new Uint8Array(VO_PILLARS);
  private readonly pickThr = new Float64Array(5);
  private readonly pickAct = new Uint8Array(5);
  // 6x85's three delays (SetVoloptGlobalOffsets 0x00a44bcc..); nothing else reads them here.
  readonly delays: number[] = [0, 0, 0];
  private readonly pending: EnemyShot[] = [];
  // Ultimate pillar attacks waiting for a target list (the objects are aimed at each
  // live player's feet in tick()).
  private readonly ultimateFire: { pillar: number; technique: number }[] = [];
  // DAT_00a44790: the Ultimate attack type the leader sent (6x84 technique 0..3); -1
  // until one arrives (the ctor and 6x16's clear set it to -1).
  technique = -1;
  private readonly framesOf: (motion: number) => number;
  private readonly leaderOf: () => boolean;
  private readonly hpOf: (client: number) => number;
  private readonly out: AiFrame;
  private readonly spot: Vec3 = [0, 0, -5000];
  readonly ox = 0;
  readonly oz = 0;
  private readonly monitorUp = (i: number) => !this.monitors[i].dead && !this.monitors[i].broken;

  constructor(opts: VoloptOptions) {
    super(opts.x, opts.z, opts.angle, opts.rng);
    this.ultimate = opts.ultimate;
    this.leaderOf = opts.leader;
    this.framesOf = opts.frames;
    this.hpOf = opts.playerHp ?? (() => 0);
    const m = opts.movement;
    this.movement = {
      coreSpeed: m.core && m.core.iparam[0] > 0 ? m.core.iparam[0] : FALLBACK_MOVEMENT.coreSpeed,
      bolt: m.pillar && m.pillar.iparam[0] > 0 ? m.pillar.iparam[0] : FALLBACK_MOVEMENT.bolt,
      bigMonitorHp: m.monitor && m.monitor.iparam[0] > 0 ? m.monitor.iparam[0] : FALLBACK_MOVEMENT.bigMonitorHp,
      smallMonitorHp: m.monitor && m.monitor.iparam[1] > 0 ? m.monitor.iparam[1] : FALLBACK_MOVEMENT.smallMonitorHp,
    };
    const hp = {
      core: opts.hp.core > 0 ? opts.hp.core : FALLBACK_HP.core,
      pillar: opts.hp.pillar > 0 ? opts.hp.pillar : FALLBACK_HP.pillar,
      rod: opts.hp.rod > 0 ? opts.hp.rod : FALLBACK_HP.rod,
    };
    // The arena origin g_VoloptForm2Config / -Value is (0, 0): the boss03
    // section's origin, not the set entry's place.
    for (let i = 0; i < VO_PILLARS; i++) {
      const p = new VoloptPillar(i, hp.pillar, this, this.ox, this.oz);
      this.pillars.push(p);
      this.parts.push(p);
    }
    for (let i = 0; i < VO_MONITORS; i++) {
      const mo = new VoloptMonitor(i, this.movement.bigMonitorHp, this.movement.smallMonitorHp, this, this.ox, this.oz);
      this.monitors.push(mo);
      this.parts.push(mo);
    }
    this.prison = new VoloptPart('prison', 0, VO_ID.prison, 1);
    this.prison.dead = true;
    this.parts.push(this.prison);
    this.rod = new VoloptRod(hp.rod, this.ox, this.oz);
    this.rod.absent = this.ultimate;
    this.parts.push(this.rod);
    this.core = new VoloptCore(hp.core, this.movement.coreSpeed, this, this.ox, this.oz);
    this.parts.push(this.core);
    this.out = { motion: null, x: this.ox, z: this.oz, angle: this.angle, hit: null };
  }

  get form2(): VoloptForm2Link | null {
    return this.form2Link;
  }
  set form2(link: VoloptForm2Link | null) {
    this.form2Link = link;
    link?.bindPrison(this.prison);
  }

  // --- VoloptFight ----------------------------------------------------------------

  rodDown(): boolean {
    return !this.ultimate && this.rod.down;
  }
  wallChecked(wall: number): boolean {
    return this.checked[wall * 4] !== 0;
  }
  // A monitor fell (its state 5): its flag is set; the wall's big
  // monitor takes the three small ones down with it, and the last small one
  // takes the big one.
  setChecked(monitor: number): void {
    this.checked[monitor] = 1;
    const wall = monitor >> 2;
    const big = this.monitors[wall * 4];
    if ((monitor & 3) === 0) {
      for (let k = 1; k < 4; k++) {
        this.monitors[wall * 4 + k].breakDown();
        this.checked[wall * 4 + k] = 1;
      }
    } else {
      let all = true;
      for (let k = 1; k < 4; k++) if (this.checked[wall * 4 + k] === 0) all = false;
      if (all && !big.broken) {
        big.breakDown();
        this.checked[wall * 4] = 1;
      }
    }
  }
  coreHit(local: boolean): void {
    this.events.push({ kind: 'coreHit', local });
  }
  coreRetreat(hold: number): void {
    this.core.retreat(hold);
  }
  resetRod(): void {
    this.rod.reset();
  }
  retractPillars(): void {
    for (let i = 0; i < this.pillars.length; i++) this.pillars[i].retract();
  }
  leader(): boolean {
    return this.leaderOf();
  }
  // A pillar's attack (UpdateVoloptMonitor state 7, 0x00442ec0): Normal is the bolt
  // (VoloptMonitorExecuteAttack0, SE 0x90); Ultimate switches on DAT_00a44790.
  bolt(pillar: number): void {
    if (this.ultimate) {
      this.ultimateFire.push({ pillar, technique: this.technique });
      return;
    }
    const p = this.pillars[pillar];
    this.pending.push(new VoloptBolt(p.baseX, 60, p.baseZ, this.movement.bolt));
    this.events.push({ kind: 'se', id: 0x90 });
  }

  // The Ultimate branch of the pillar's attack (0x00442ec0 state 7, DAT_00a447c0 != 0),
  // run with the live players in hand (the exe's loop skips flags 0x2000800 and ids >= 0x1000):
  //   0: FUN_006e54a8 (a lightning chain over the list, 0x18c-byte object) — NOT traced here;
  //      ASSUMED the normal bolt (group 3, row 34 power).
  //   1: create_directed_foie_object (FUN_006e3408 -> FUN_006e3480) per live player, aimed at
  //      the player's feet (+0x300), group 1.
  //   2: FUN_006e4058 (a 0x178-byte object, Gibarta's size) per live player, aimed at the feet,
  //      group 2 (ASSUMED the Gibarta flight: its heading is the aim's bearing).
  //   3: no case in the switch: nothing is cast (the attack still runs its two fires).
  // Every object is made at level 0x1d (the exe's last argument; ASSUMED the level).
  private flushUltimate(targets: readonly AiTarget[]): void {
    for (const job of this.ultimateFire.splice(0)) {
      const p = this.pillars[job.pillar];
      if (!p) continue;
      if (job.technique === 0) {
        this.pending.push(new VoloptBolt(p.baseX, 60, p.baseZ, this.movement.bolt));
        continue;
      }
      if (job.technique !== 1 && job.technique !== 2) continue;
      const tech = job.technique === 1 ? TECH.foie : TECH.gibarta;
      for (const t of targets) {
        if (t.dead) continue;
        const shot = trapFire({
          tech,
          level: VO_ULTIMATE_LEVEL,
          x: p.baseX,
          y: 60,
          z: p.baseZ,
          heading: Math.atan2(t.x - p.baseX, t.z - p.baseZ),
          aim: { x: t.x, y: t.y ?? 0, z: t.z },
          enemy: true,
        });
        if (shot) this.pending.push(shot);
      }
    }
  }
  sustain(id: number): void {
    this.sustained.add(id);
  }
  frames(motion: number): number {
    return this.framesOf(motion);
  }

  // --- queries ----------------------------------------------------------------------

  // The control draws nothing and has no hit box (flags 0x6040000).
  get untargetable(): boolean {
    return true;
  }
  get invulnerable(): boolean {
    return true;
  }
  partOf(entity: number): VoloptPart | null {
    for (let i = 0; i < this.parts.length; i++) if (this.parts[i].entity === entity) return this.parts[i];
    return null;
  }
  // Pillars that are not wrecks (flag 0x40000 of +0x390 clear).
  get pillarsLeft(): number {
    let n = 0;
    for (let i = 0; i < this.pillars.length; i++) if (!this.pillars[i].wreck) n++;
    return n;
  }

  // --- orders (the same on every client) ------------------------------------------------

  // 6x15 (handle_packet0x60_subcommand0x15 0x0043e4f8). Action 0 sends the core
  // on a traverse (start wall, number of walls), 1 sends it away, 2 stands the
  // rod up and retracts the pillars; 3..7 are form 2's (combat/volopt2.ts).
  applyAction(action: number, param: number, count: number): void {
    switch (action) {
      case 0:
        this.core.command(param, count);
        break;
      case 1:
        this.core.retreat(0);
        break;
      case 2:
        this.rod.reset();
        this.retractPillars();
        this.events.push({ kind: 'se', id: 0x35 });
        break;
      default:
        break;
    }
  }

  // 6x85 (handle_packet0x60_subcommand0x85 0x0043e7cc): Ultimate only, action
  // 0: the three shorts are stored (SetVoloptGlobalOffsets).
  applyDelays(action: number, delays: readonly number[]): void {
    if (!this.ultimate || action !== 0) return;
    for (let i = 0; i < 3; i++) this.delays[i] = delays[i] ?? 0;
  }

  // 6x16 / 6x84 (ClearVoloptPlayerEntities 0x0043e658 / SetVoloptPlayerEntities
  // 0x0043e6e8): the first `count` entries of the table rise, the first as the
  // red pillar. The 6x84 technique (packet +0xc, Ultimate only) becomes DAT_00a44790.
  applyPillars(table: readonly number[], count: number, technique = -1): void {
    const n = Math.min(Math.trunc(count), VO_PILLARS, table.length);
    this.technique = technique;
    for (let i = 0; i < n; i++) this.pillars[Math.abs(table[i]) % VO_PILLARS].start(i === 0);
  }

  // --- the damage -------------------------------------------------------------------------

  // Damage on a part: our own strike (`byLocal`) or the total of a 6x0A.
  damagePart(entity: number, amount: number, byLocal: boolean): VoloptPart | null {
    const p = this.partOf(entity);
    if (!p) return null;
    p.damage(amount, byLocal);
    return p;
  }
  damageTaken(entity: number, total: number): VoloptPart | null {
    const p = this.partOf(entity);
    if (!p) return null;
    p.setDamageTaken(total);
    return p;
  }

  // --- the frame ------------------------------------------------------------------------------

  tick(targets: readonly AiTarget[]): AiFrame {
    const out = this.out;
    out.motion = null;
    out.shots = undefined;
    this.sustained.clear();
    switch (this.ai) {
      case VO_AI.build:
        this.build();
        break;
      case VO_AI.intro:
        this.tickIntro();
        break;
      case VO_AI.fight:
        this.tickFight(targets);
        break;
      case VO_AI.change:
        this.tickChange(targets);
        break;
      case VO_AI.fight2:
        this.tickFight2(targets);
        break;
    }
    // The parts update whenever the game runs, until the pillars are deleted.
    if (this.ai >= VO_AI.intro && this.ai <= VO_AI.fight) this.tickParts();
    if (this.ultimateFire.length) this.flushUltimate(targets);
    if (this.pending.length) out.shots = this.pending.splice(0);
    return out;
  }

  // AI state 0 (0x0043C680) builds the parts (done in the constructor) and
  // init_volopt_stuff (0x0043ee2c) clears the director.
  private build(): void {
    this.cursor = 0;
    this.cooldown = 0;
    this.round = 0;
    this.pillarCount = 2;
    this.traverseDone = false;
    this.spawned = false;
    this.wallCursor = 0;
    this.picks = 0;
    this.checked.fill(0);
    this.setAi(VO_AI.intro);
  }

  private setAi(ai: number): void {
    this.ai = ai;
    this.sub = 0;
    this.waited = 0;
    this.state = AI_NAMES[ai] ?? `state ${ai}`;
    this.events.push({ kind: 'phase', phase: ai });
  }

  // Volopt__ProcessStateTransition: 0xd2 frames of fog and
  // camera, 0x3c more, then the core appears and holds for 0x5a.
  private tickIntro(): void {
    switch (this.sub) {
      case 0:
        this.timer = 0xd2;
        this.sub = 1;
        break;
      case 1:
        this.sustain(0x33c);
        if (--this.timer < 1) {
          this.waited = 0;
          this.sub = 2;
        }
        break;
      case 2:
        // ASSUMED: the exe waits for the camera event's end flag
        // (GlobalGameState + 2 & 1) after 0x3c frames; no camera here.
        if (++this.waited >= 0x3c) {
          this.core.appear();
          this.timer = 0x5a;
          this.sub = 3;
        }
        break;
      case 3:
        if (--this.timer < 1) this.setAi(VO_AI.fight);
        break;
    }
  }

  private tickParts(): void {
    for (let i = 0; i < this.monitors.length; i++) this.monitors[i].tick();
    for (let i = 0; i < this.pillars.length; i++) this.pillars[i].tick();
    this.rod.tick();
    this.core.tick();
    // UpdateVoloptCore: g_CurrentVoloptMonitorId, read by the monitors next tick.
    this.exposed = this.core.exposedMonitor(this.monitorUp);
  }

  // --- phase 1 ----------------------------------------------------------------------------------

  // Volopt__ProcessBehaviorState: the leader's director, then the
  // end test (the core dead, or every pillar a wreck), then the way out.
  private tickFight(targets: readonly AiTarget[]): void {
    this.sustain(0x33a);
    switch (this.sub) {
      case 0:
        this.sub = 1;
        break;
      case 1:
        if (this.leaderOf()) this.direct1(targets);
        if (this.core.dead || this.pillarsLeft === 0) this.sub = 2;
        break;
      case 2:
        // Camera shake; the pillars are deleted (field_0x8 |= 8) and the core
        // flagged dead; 0x96 frames of rumble (SFX 0x35b).
        this.timer = 0x96;
        for (let i = 0; i < this.pillars.length; i++) {
          this.pillars[i].targetable = false;
          this.pillars[i].dead = true;
        }
        this.core.dead = true;
        this.core.hidden = true;
        this.sub = 3;
        break;
      case 3:
        this.sustain(0x35b);
        if (--this.timer < 1) this.sub = 4;
        break;
      case 4:
        // The white overlay (VoloptPlayerEntityConstructor) fades in; the
        // exe waits for it (g_VoloptSpecialReady). ASSUMED length.
        this.timer = VO_WAIT.fadeOut;
        this.sub = 5;
        break;
      case 5:
        if (--this.timer < 1) {
          // Nothing of phase 1 can be shot any more.
          for (let i = 0; i < this.parts.length; i++) this.parts[i].targetable = false;
          this.setAi(VO_AI.change);
        }
        break;
    }
  }

  // Player__handlevoloptcommand, normal mode, cursor +0x3f8:
  //   0 send a traverse (6x15 action 0: the start wall, 2..4 walls) -> 1;
  //   1 wait for the core -> 2; 2 clear the round -> 3;
  //   3 if a pillar was hit or destroyed, or two rounds passed: send the core
  //     away (action 1) and start over; otherwise shuffle the live pillars and
  //     raise the first `+0x404` of them (6x16): 2, then up to 5.
  // Ultimate sends 6x84 (the same table plus a technique 0..3).
  private direct1(targets: readonly AiTarget[]): void {
    for (let i = 0; i < this.pillars.length; i++) if (this.pillars[i].busy) return;
    if (!this.nearest(targets, this.ox, this.oz)) return;
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    switch (this.cursor) {
      case 0: {
        let open = false;
        for (let w = 0; w < VO_WALLS; w++) if (!this.wallChecked(w)) open = true;
        if (!open) {
          this.cursor = 2;
          break;
        }
        if (this.core.st === 0 && !this.core.dead) {
          const count = Math.round(this.rng() * 2) + 2;
          this.events.push({ kind: 'action', action: 0, target: 0, param: this.wallCursor, count });
          this.wallCursor -= count;
          if (this.wallCursor < 0) this.wallCursor += 6;
          this.cooldown = 0x1e;
          this.cursor = 1;
          this.waited = 0;
        }
        break;
      }
      case 1:
        // The exe waits for the core as long as it takes; ASSUMED cap so that
        // a core that never reports cannot stall the fight.
        if (this.traverseDone || ++this.waited > VO_WAIT.traverse) this.cursor = 2;
        break;
      case 2:
        this.spawned = false;
        this.round = 0;
        this.cursor = 3;
        break;
      default:
        if (this.spawned || this.round > 1) {
          this.spawned = true;
          this.events.push({ kind: 'action', action: 1, target: 0, param: 0, count: 0 });
          this.cursor = 0;
          this.cooldown = 0x1e;
          break;
        }
        this.round++;
        this.shufflePillars();
        break;
    }
  }

  private shufflePillars(): void {
    let n = 0;
    for (let i = 0; i < VO_PILLARS; i++) if (!this.pillars[i].wreck) this.order[n++] = i;
    if (n > 1) {
      for (let k = 0; k < n * 5; k++) {
        const a = Math.round(this.rng() * n) % n;
        const b = Math.round(this.rng() * n) % n;
        if (a !== b) {
          const t = this.order[a];
          this.order[a] = this.order[b];
          this.order[b] = t;
        }
      }
    }
    const table: number[] = [];
    for (let i = 0; i < VO_PILLARS; i++) table.push(i < n ? this.order[i] : 0);
    this.events.push({ kind: 'pillars', table, count: Math.min(this.pillarCount, n), technique: this.ultimate ? Math.round(this.rng() * 3) : null });
    if (this.pillarCount < 5) this.pillarCount++;
    this.cooldown = 0x1e;
  }

  // EnemyGetNearestTargetInRange (0x007714cc, range 400) from the control.
  private nearest(targets: readonly AiTarget[], cx: number, cz: number): AiTarget | null {
    let best: AiTarget | null = null;
    let bs = 400 * 400;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.dead) continue;
      const d = (t.x - cx) ** 2 + (t.z - cz) ** 2;
      if (d < bs) {
        bs = d;
        best = t;
      }
    }
    return best;
  }

  // --- the change to form 2 ----------------------------------------------------------------------

  // ProcessVoloptState: form 2 stands up, the leader carries the
  // players over (6x17), the second overlay fades back, 150 frames of camera.
  private tickChange(targets: readonly AiTarget[]): void {
    this.sustain(0x33b);
    switch (this.sub) {
      case 0:
        this.form2?.appear();
        // unknown_set_volopt_form2 clears the director (+0x3f8, +0x3fa, +0x40c).
        this.cursor = 0;
        this.cooldown = 0;
        this.picks = 0;
        if (this.leaderOf()) this.movePlayers(targets);
        this.timer = VO_WAIT.fadeIn;
        this.sub = 1;
        break;
      case 1:
        if (--this.timer < 1) {
          this.timer = 0x96;
          this.sub = 2;
        }
        break;
      case 2:
        if (--this.timer < 1) {
          this.timer = VO_WAIT.cameraForm2;
          this.sub = 3;
        }
        break;
      case 3:
        if (--this.timer < 1) {
          this.form2?.begin();
          this.setAi(VO_AI.fight2);
        }
        break;
    }
  }

  // unknown_position_player_for_volopt(1): each player goes to
  // its slot of the table at 0x009a4bf0, in the second arena.
  private movePlayers(targets: readonly AiTarget[]): void {
    for (let i = 0; i < targets.length; i++) {
      const p = FORM2_SPOTS[i % FORM2_SPOTS.length];
      // ASSUMED: they face the middle (the angle table was not read).
      const angle = (Math.round(Math.atan2(0 - p[0], -5000 - p[2]) / BAMS) + 0x10000) & 0xffff;
      this.events.push({ kind: 'move', client: targets[i].clientId, x: p[0], y: p[1], z: p[2], angle });
    }
  }

  // --- phase 2's director ----------------------------------------------------------------------------

  private tickFight2(targets: readonly AiTarget[]): void {
    this.sustain(0x33b);
    const f2 = this.form2;
    if (!f2) {
      // No body was built for this room: nothing to fight, nothing to wait on.
      this.setAi(VO_AI.over);
      return;
    }
    if (f2.dead) {
      // ProcessEnemyAiState4: g_VoloptIsDead -> VoloptDeathHandler, the
      // control object is done (state 5). render/combat.ts does the quest
      // side on the 'phase' event: set_quest_flag(0x2a) and
      // unhide_objects_for_volopt_death(0) (groups 1 and 3 of room 0).
      this.setAi(VO_AI.over);
      return;
    }
    if (this.leaderOf() && f2.ready) this.direct2(targets, f2);
  }

  // Volopt__ExecuteAttackPhase, normal mode: the cursor goes 0
  // missiles (action 3), 1 laser (4), 2 heal (5), 3 capture (6) and round; an
  // action whose part is gone is skipped; the pause is 30 frames + 30 per part
  // at 0 HP. Ultimate picks by weight (missiles 0.27, laser 0.15, arm 0.2, heal
  // 0.18, capture 0.2; 0x008fdc0c..0x008fdc1c) and aims at the player with the
  // most HP, every third time at a random one.
  private direct2(targets: readonly AiTarget[], f2: VoloptForm2Link): void {
    f2.position(this.spot);
    if (!this.nearest(targets, this.spot[0], this.spot[2])) return;
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    const pause = 0x1e + 30 * f2.busyParts;
    if (this.ultimate) return this.pick2(targets, f2, pause);
    switch (this.cursor) {
      case 0:
        if (f2.canAct(3)) {
          this.events.push({ kind: 'action', action: 3, target: this.closestToFace(targets, f2), param: 0, count: 0 });
          this.cooldown = pause;
        }
        this.cursor = 1;
        break;
      case 1:
        if (f2.canAct(4)) {
          this.events.push({ kind: 'action', action: 4, target: 0, param: 0, count: 0 });
          this.cooldown = pause;
        }
        this.cursor = 2;
        break;
      case 2:
        if (f2.canAct(5)) {
          this.events.push({ kind: 'action', action: 5, target: 0, param: 0, count: 0 });
          this.cooldown = pause;
        }
        this.cursor = 3;
        break;
      default: {
        const t = this.nearest(targets, this.spot[0], this.spot[2]);
        if (f2.canAct(6) && t) {
          this.events.push({ kind: 'action', action: 6, target: t.clientId, param: 0, count: 0 });
          this.cooldown = pause;
        }
        this.cursor = 0;
        break;
      }
    }
  }

  private pick2(targets: readonly AiTarget[], f2: VoloptForm2Link, pause: number): void {
    const thr = this.pickThr;
    const act = this.pickAct;
    let n = 0;
    let total = 0;
    const add = (w: number, a: number): void => {
      total += w;
      thr[n] = total;
      act[n++] = a;
    };
    if (f2.canAct(3)) add(0.27, 3);
    if (f2.canAct(4)) {
      add(0.15, 4);
      add(0.2, 7);
    }
    if (f2.canAct(5)) add(0.18, 5);
    if (f2.canAct(6)) add(0.2, 6);
    if (n === 0) {
      // All four parts are gone: nothing to order. The exe asks again every
      // frame; wait the pause instead.
      this.cooldown = pause;
      return;
    }
    const r = this.rng() * total;
    let action = act[n - 1];
    for (let i = 0; i < n; i++) {
      if (r <= thr[i]) {
        action = act[i];
        break;
      }
    }
    let target = 0xffff;
    if (this.picks === 0) {
      let live = 0;
      for (let i = 0; i < targets.length; i++) if (!targets[i].dead) live++;
      if (live) {
        let k = Math.min(live - 1, Math.floor(this.rng() * live));
        for (let i = 0; i < targets.length; i++) {
          if (targets[i].dead) continue;
          if (k-- === 0) target = targets[i].clientId;
        }
      }
    } else {
      let best = -1;
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (t.dead) continue;
        const hp = this.hpOf(t.clientId);
        if (hp > best) {
          best = hp;
          target = t.clientId;
        }
      }
    }
    this.picks = (this.picks + 1) % 3;
    this.events.push({ kind: 'action', action, target, param: action === 7 ? Math.round(this.rng() * 40) : 0, count: 0 });
    if (action === 4) {
      // VoloptSendRandomAction (6x85).
      this.events.push({ kind: 'delays', action: 0, delays: [this.delay(), this.delay(), this.delay()] });
    }
    this.cooldown = pause;
    this.cursor = action - 3;
  }

  // ASSUMED range: the exe reads two floats of row 37 (+0x10, +0x14).
  private delay(): number {
    return Math.round(this.rng() * 20 + 10);
  }

  // GetClosestPlayerToEnemy: the player nearest to straight in
  // front of form 2 (the smallest angle to its facing).
  private closestToFace(targets: readonly AiTarget[], f2: VoloptForm2Link): number {
    f2.position(this.spot);
    const face = f2.facing();
    let best = 0xffff;
    let bd = 0x10000;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.dead) continue;
      const a = (Math.round(Math.atan2(t.x - this.spot[0], t.z - this.spot[2]) / BAMS) + 0x10000) & 0xffff;
      const d = angDiff(a, face);
      if (d <= bd) {
        bd = d;
        best = t.clientId;
      }
    }
    return best;
  }

  // --- BrainBase ------------------------------------------------------------------------------------

  onDamage(): void {
    // Hits land on the parts, never on the control.
  }

  resume(): string {
    return this.state;
  }
}

// Where each player (by index) stands in the second arena: the table at
// 0x009a4bf0.
export const FORM2_SPOTS: readonly Vec3[] = [
  [0, 0, -5090],
  [0, 0, -4910],
  [-90, 0, -5000],
  [90, 0, -5000],
];

// The brain of the invisible enemy render/combat.ts keeps for a part (so the
// player's strikes, the lock-on and the other clients' 6x0A find it by entity
// id). The control owns everything; this answers the owner's questions.
export class VoloptPartAi implements EnemyBrain {
  state = 'part';
  readonly motion = null;
  readonly superArmor = true;
  readonly part: VoloptPart;
  readonly owner: VoloptAi;
  private readonly frame: AiFrame = { motion: null, x: 0, z: 0, angle: 0, hit: null };
  constructor(part: VoloptPart, owner: VoloptAi) {
    this.part = part;
    this.owner = owner;
  }
  // The hit gate: a monitor is struck unless it is down (see VoloptMonitor.hittable); the other
  // parts keep their `targetable` (the port's window, not traced for them).
  get untargetable(): boolean {
    return this.part instanceof VoloptMonitor ? !this.part.hittable : !this.part.targetable;
  }
  tick(): AiFrame {
    this.frame.x = this.part.x;
    this.frame.z = this.part.z;
    return this.frame;
  }
  onDamage(): void {}
  resume(): string {
    return this.state;
  }
  kill(): void {}
}

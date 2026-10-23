// The pillar traps of the Caves, Mines, Ruins and Spaceship, following
// PsoBB.exe (Ephinea 1.25.13). Pure logic (no three.js, no network) so it
// runs in Node tests; render/gamefield.ts drives one per placed object and
// hands the hold / technique events to render/combat.ts.
//
// TOTrapAncient02 (o.dat 0x0154, create 0x0063bfd4, ctor
// InitializeDerolleEnemyBase_0063c638, vtable 0x00b2d7c0) and
// TOTrapAncient02R (0x0167, create 0x0063b4e8, ctor 0x0063b5b4 on the same
// base, vtable 0x00b2d940). Set entry fields as the object holds them
// (ApplyObjectInitData_007ba33c): param1 +0x68, param3 +0x70, rotation z
// +0x64, param4 +0x84, param5 +0x88, param6 +0x8c.
//   radius (+0x33c)    param1 * 0.5 + 30 (0x00934128 / 0x00934168, 0x00934160)
//   hold time (+0x358) max(0, param4 + 30) frames
//   02R only: switch flag (+0x36c) param5 if 0..0xFF (else none), the
//   technique (+0x364) param6 clamped to 0..4, its level (+0x368,
//   0x0063bf48) round(1 + 2 * difficulty + param3) clamped to 0..14 (0..29 in
//   Ultimate).
//
// Every frame EnemyAIUpdateState_0063a034 calls vtable +0x158
// (UpdateTreeObject_0063cbe4: the spinning part +0x354 += 0x888, and while
// the state +0x32e is 1..3 the area's SE: Caves 0x456, Mines 0x46b, Ruins
// 0x489, Spaceship 0x4b5) and then the state's handler:
//   0 idle (0x0063a3d8; 02R 0x0063be8c, which first needs its switch flag):
//     the nearest player within the radius (EnemyGetNearestTargetInRange
//     _007714cc) whose XZ distance (0x007a9180) is under the radius -> 2.
//     (State 1, trap vision, only draws the marker and runs the same check;
//     vtable +0x154 IsPlayerVisibleToPartTrap_0063a208 picks it.)
//   2 spring (02: 0x0063c990, 02R: ProcessEnemyAttackState_0063b930), with
//     the sub-state +0x330:
//       0  the first segment rises: +0x34c += 1 a frame until 7
//       1  the second one: +0x350 += 1 until 10.15
//       2  the nearest player within the radius again; with r = radius -
//          its collision radius (02R: + it), r^2 > d^2 (XZ) fires:
//          02 the local player gets a hold: 6x2C (SnowBerillSendAttackPacket
//             _006937c8) {frames = the hold counter, particle 0, the trap's
//             x / z, r^2}; 02R the technique at the target;
//          then state 3, sub-state 2. Nobody in range -> sub-state 3.
//       3  +0x350 -= 1 to 0, then 4: +0x34c -= 1 to 0, then idle.
//   3 hold (02: 0x0063c7f4, 02R: ProcessPlayerStunState_0063b828): the hold
//     counter +0x35c counts down from the hold time (02: while the target is
//     there it is kept still, flags +0x30 |= 0x200); at -1 it is reset, the
//     sub-state goes to 3 (sink as above), and 02 sends the local player's
//     6x2D (DisablePlayerMovement_00685514) when it is still held.
// Render (RenderSeabedPillarMapObject*_0063c2bc / _0063c43c): the model's
// root node is lifted by +0x34c, its child (+0x2c) by +0x350 more; that
// child's child is drawn as it is and its sibling (+0x30) turns by +0x354.

export const TRAP_HOLD = 0x0154; // TOTrapAncient02
export const TRAP_TECH = 0x0167; // TOTrapAncient02R

export const RISE_1 = 7; // 0x00934138
export const RISE_2 = Math.fround(10.15); // 0x0093413c
export const SPIN_PER_FRAME = 0x888;

// The techniques the 02R casts (+0x364): create_directed_foie_object,
// entity_hit_by_tech Zonde, unknown_create_sorc_tech (Grants), create_megid,
// create_gifoie.
export const TRAP_TECHS = ['foie', 'zonde', 'grants', 'megid', 'gifoie'] as const;
export type TrapTech = (typeof TRAP_TECHS)[number];

// The area's trap SE (UpdateTreeObject_0063cbe4), by area id.
export function trapSe(area: number): number | null {
  if (area >= 3 && area <= 5) return 0x456; // cave1..3
  if (area === 6 || area === 7) return 0x46b; // mines1..2
  if (area >= 8 && area <= 10) return 0x489; // ruins1..3
  if (area === 0x15 || area === 0x16) return 0x4b5; // spaceship_a / b (VR Spaceship)
  return null;
}

export interface TrapParams {
  type: number; // 0x0154 or 0x0167
  x: number;
  z: number;
  params: readonly number[]; // o.dat param1..6
  difficulty: number;
}

export interface TrapPlayer {
  clientId: number;
  x: number;
  z: number;
  radius: number; // collision radius (player +0xa4 -> +0x0c)
}

export type TrapEvent =
  | { kind: 'hold'; clientId: number; frames: number; x: number; z: number; radius2: number }
  | { kind: 'release'; clientId: number }
  | { kind: 'tech'; clientId: number; tech: TrapTech; level: number }
  | { kind: 'sound'; id: number };

export class PillarTrap {
  readonly type: number;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly holdTime: number;
  readonly switchFlag: number; // -1 = none (02R)
  readonly tech: TrapTech;
  readonly level: number;
  state = 0; // +0x32e
  sub = 0; // +0x330
  rise1 = 0; // +0x34c
  rise2 = 0; // +0x350
  spin = 0; // +0x354 (BAMS)
  private counter: number; // +0x35c
  private target = -1; // +0x344
  private held = -1; // the local player held by this trap

  constructor(p: TrapParams) {
    this.type = p.type;
    this.x = p.x;
    this.z = p.z;
    const [p1 = 0, , p3 = 0, p4 = 0, p5 = 0, p6 = 0] = p.params;
    this.radius = Math.fround(Math.fround(p1 * 0.5) + 30);
    this.holdTime = Math.max(0, Math.trunc(p4) + 30);
    this.counter = this.holdTime;
    const flag = Math.trunc(p5);
    this.switchFlag = p.type === TRAP_TECH && flag >= 0 && flag <= 0xff ? flag : -1;
    this.tech = TRAP_TECHS[Math.min(4, Math.max(0, Math.trunc(p6)))];
    const level = Math.round(1 + 2 * p.difficulty + p3);
    this.level = level < 0 ? 0 : Math.min(level, p.difficulty === 3 ? 0x1d : 0x0e);
  }

  // Nearest player in range (XZ), as the object's target.
  private nearest(players: readonly TrapPlayer[]): TrapPlayer | null {
    let best: TrapPlayer | null = null;
    let bestD = this.radius * this.radius;
    for (const p of players) {
      const d = (p.x - this.x) ** 2 + (p.z - this.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  // One frame. `switchOn(flag)` answers the floor's switch flags (02R);
  // `self` is the local player's client id.
  frame(players: readonly TrapPlayer[], self: number, area: number, switchOn: (flag: number) => boolean = () => false): TrapEvent[] {
    const out: TrapEvent[] = [];
    this.spin = (this.spin + SPIN_PER_FRAME) & 0xffff;
    // The exe calls PlayDirectionalSFX_00814630 every frame of states 1..3;
    // ASSUMED here: one play when the trap springs (the SE player has no
    // per-object loop).
    if (this.state === 2 && this.sub === 0 && this.rise1 === 0) {
      const id = trapSe(area);
      if (id !== null) out.push({ kind: 'sound', id });
    }
    if (this.state === 0 || this.state === 1) this.idle(players, switchOn);
    else if (this.state === 2) this.spring(players, self, out);
    else if (this.state === 3) this.hold(players, self, out);
    return out;
  }

  private idle(players: readonly TrapPlayer[], switchOn: (flag: number) => boolean): void {
    if (this.switchFlag >= 0 && !switchOn(this.switchFlag)) return;
    const t = this.nearest(players);
    this.target = t?.clientId ?? -1;
    if (t) this.state = 2;
  }

  private sink(): boolean {
    if (this.sub === 3) {
      if (this.rise2 > 0) this.rise2 -= 1;
      else {
        this.sub = 4;
        this.rise2 = 0;
      }
      return true;
    }
    if (this.sub === 4) {
      if (this.rise1 > 0) this.rise1 -= 1;
      else {
        this.state = 0;
        this.sub = 0;
        this.rise1 = 0;
        this.target = -1;
      }
      return true;
    }
    return false;
  }

  private spring(players: readonly TrapPlayer[], self: number, out: TrapEvent[]): void {
    if (this.sub === 0) {
      if (this.rise1 >= RISE_1) {
        this.sub = 1;
        this.rise1 = RISE_1;
      } else this.rise1 += 1;
      return;
    }
    if (this.sub === 1) {
      const v = Math.fround(this.rise2 + 1);
      if (v < RISE_2) this.rise2 = v;
      else {
        this.sub = 2;
        this.rise2 = RISE_2;
      }
      return;
    }
    if (this.sink()) return;
    if (this.sub !== 2) return;
    const t = this.nearest(players);
    this.target = t?.clientId ?? -1;
    if (t) {
      const d2 = (t.x - this.x) ** 2 + (t.z - this.z) ** 2;
      // 02: radius - the target's radius (+0x340); 02R: radius + it.
      const r = this.type === TRAP_HOLD ? Math.fround(this.radius - t.radius) : Math.fround(this.radius + t.radius);
      if (r * r > d2) {
        if (this.type === TRAP_HOLD) {
          if (t.clientId === self) {
            out.push({ kind: 'hold', clientId: t.clientId, frames: this.counter, x: this.x, z: this.z, radius2: Math.fround(r * r) });
            this.held = t.clientId;
          }
        } else out.push({ kind: 'tech', clientId: t.clientId, tech: this.tech, level: this.level });
        this.state = 3;
        this.sub = 2;
      } else this.target = -1;
    }
    if (this.target < 0 && this.state === 2) this.sub = 3;
  }

  private hold(players: readonly TrapPlayer[], self: number, out: TrapEvent[]): void {
    if (this.sub < 0) return;
    if (this.sub <= 1) this.sub = 2;
    if (this.sink()) return;
    if (this.sub !== 2) return;
    const there = this.type === TRAP_HOLD ? players.some((p) => p.clientId === this.target) : true;
    if (!there && this.type === TRAP_HOLD) {
      this.sub = 3;
      this.counter = this.holdTime;
      return;
    }
    this.counter -= 1;
    if (this.counter >= 0) return;
    this.sub = 3;
    this.counter = this.holdTime;
    if (this.type === TRAP_HOLD && this.held === self && this.target === self) {
      out.push({ kind: 'release', clientId: self });
      this.held = -1;
    }
  }
}

// TODoorVoShip (o.dat 0x0130, Vol Opt's seal door; ctor
// InitializeLabodoorMapObject_00622648, update 0x006224a4, render 0x00622358,
// vtable 0x00b27fc0). +0xcc starts at 0x0e (three seals); quest flag 0x2c
// clears bit 2, 0x2d bit 4, 0x2e bit 8, 0x2f all three and turns the box off
// (0x007b52ec) — read in the ctor and again every frame of the update. While
// a seal is left the update advances the door motion and swings the lamp
// color's alpha +0xdc by 0.05 (0x0093152c) between -1 and 0, bit 0x10
// keeping the direction; the render draws the door, the lamp model's root and
// each lamp child whose bit is set: the root's first child bit 4, its
// sibling bit 2, the next sibling bit 8, with the color {alpha, 0, 0, 0}
// (render flag 0x20). Once no seal is left neither runs: nothing is drawn.
export const SEAL_DOOR = 0x0130;
export const SEAL_LAMP_BITS = [0x04, 0x02, 0x08] as const; // root child order

export class SealDoor {
  bits = 0x0e; // +0xcc
  alpha = 0; // +0xdc

  constructor(questFlag: (flag: number) => boolean) {
    this.apply(questFlag);
  }

  get sealed(): boolean {
    return (this.bits & 0x0e) !== 0;
  }

  private apply(questFlag: (flag: number) => boolean): void {
    if (questFlag(0x2c)) this.bits &= ~0x02;
    if (questFlag(0x2d)) this.bits &= ~0x04;
    if (questFlag(0x2e)) this.bits &= ~0x08;
    if (questFlag(0x2f)) this.bits &= ~0x0e;
  }

  // One frame (0x006224a4); the door motion advances while this is sealed.
  frame(questFlag: (flag: number) => boolean): void {
    if (!this.sealed) return;
    if (this.bits & 0x10) {
      const a = Math.fround(this.alpha + Math.fround(0.05));
      if (a >= 0) {
        this.alpha = 0;
        this.bits &= ~0x10;
      } else this.alpha = a;
    } else {
      const a = Math.fround(this.alpha - Math.fround(0.05));
      if (a <= -1) {
        this.alpha = -1;
        this.bits |= 0x10;
      } else this.alpha = a;
    }
    this.apply(questFlag);
  }

  lamps(): boolean[] {
    return SEAL_LAMP_BITS.map((b) => (this.bits & b) !== 0);
  }
}

// --- Seabed capture traps (TOTrapSeabed01, 0x0228) and trap vision -----------
//
// Object 0x0228 is the Seabed capture trap: the o.dat type table row (VA 0x00a084e4
// and its copies) pairs 0x0228 with the creator CreateDerolleTrapEntity_0063ee10,
// which builds the object on DerolleEnemyVTable3 (0x00b2df80) through
// InitializeDerolleTrapEntity_0063ec24. VERIFIED (exe bytes, dump names).
//
// Init (ApplyDerolleTrapInitData_0063ea98, VERIFIED): +0x68 (param1) = 0.1 (0x00934514) when
// below 0.1, else min(param1, 10) (0x00934508); the animation speed +0xc8 is that same value.
// +0x33c (the idle's radius) and +0x340 = 15.0 (0x41700000). +0x84 (param4) clamped 1..60, +0x350 =
// it x 30 (not read by the handlers traced here). +0x88 (param5) clamped 0..1, +0x354 = 1 when
// it is above 0 (the cloak). +0x6c clamped to >= 0, +0x35c = that x the difficulty's factor
// (1, 2, 3, 6, DAT_00a9cd68; not read here). +0x8c (param6) clamped 0..5, +0x358 = it.
// +0xc0 (the spring's motion frame) = 0; +0x348 (the hit counter) = 1 (InitializeBaseMapObject).
//
// Cloak: +0x354 != 0 selects the cloak pass in render_capturetrap (recursively_render_capture_
// trap_njm, unknown_set_advanced_effect_cloaked). VERIFIED.
//
// Trap vision: the player's unknown_flags_2 (player +0x33c) bit 0x10000 (dump enum
// has_trap_vision = 65536). The bit follows the player's +0x964 bit 0x10: FUN_00695b48 sets
// it when the bit is set, FUN_005e60c0 clears it when it is not. VERIFIED (Ghidra decompile of
// 0x00695b48 / 0x005e60c0). The source of +0x964 bit 0x10 (androids, the Trap Vision tool,
// its duration) was NOT located: no code in the exe writes +0x964 by a displacement store
// (only loads and a test), so the source is UNCLEAR. newserv says permanent for androids and
// temporary after a Trap Vision tool (ReceiveSubcommands.cc, the flag table); no duration
// is in newserv.
//
// The state machine (EnemyAIUpdateState_0063a034, 30 AI ticks a second, VERIFIED): the vtable
// slots of DerolleEnemyVTable3 are +0x144 idle (DerollePartObjectUpdateTarget_0063a3d8), +0x148
// state 1 (DerollePartObjectEnableReticle_0063a3bc: enable_reticle, then the idle), +0x14c state 2
// (SawMapObjectUpdateAnimation_0063e7a4), +0x150 state 3 (SawMapObjectHandleHit_0063e72c), +0x154
// IsPlayerVisibleToPartTrap_0063a208 (any of the four slots in the trap's room with the bit).
// Every tick: state 0 asks the vision (-> 1), then the idle runs for states 0 and 1; states 2
// and 3 run their handler instead. The dispatch is one handler per tick.
//   Trigger (idle): EnemyGetNearestTargetInRange_007714cc(radius +0x33c = 15) finds the nearest
//   player (entity on the floor, not dead or hidden; the exe also rays the map, not ported); its
//   XZ distance squared below 15^2 -> state 2. So a trap fires on a player in range whether or
//   not anyone has trap vision; the reveal only sets the reticle.
//   2 spring (SawMapObjectUpdateAnimation): anim (+0xc0) += speed (+0xc8) each tick. When it is
//   above (njm frame count - 1) (+0.0 from 0x009344d0; with no motion the float 2^32 keeps it
//   going), anim is clamped to that, state = 3, and EnemyAcquireTargetAndAttack_0063e444 runs:
//   the nearest player in 15 (cleared when none); r = +0x340 - the player's hitbox radius (+0x340
//   is rewritten by the call); XZ distance squared < r^2 -> SawMapObjectPlaySound (the seabed or
//   jungle SE, positional at the trap) and SnowBerillSendAttackPacket_006937c8 with the player as
//   its `this`: 6x2C {client id, frames 0xffff, particle 0, the trap's x / z, r^2}. 0xffff is the
//   frames value: the hold has no timer (the release is 6x2D, see below).
//   3 hold (SawMapObjectHandleHit): the counter (+0x348) drops by 1 a tick. While it is 0 or more
//   the SE plays (SawMapObjectPlaySound); below 0 the exe hits the target with vtable try_hit_entity
//   (1.0) and unknown_melee_attack_2 every tick (damage UNCLEAR, not ported). Nothing in these
//   handlers sets the state back: the trap stays in 3.
//   Release: the trap's on-interact (vtable +0x5c = SawMapObjectOnInteract_0063ed78) is called by
//   the collision step of an entity that touches the trap (the caller's +0x50 gate, 0x0063a00c, is
//   "entity != the trap's target"). It runs SawMapObjectDisablePlayerMovementOnVisibility_0063e3b0:
//   the trap's target with the movement_disabled flag gets DisablePlayerMovement_00685514, 6x2D.
//   So a teammate (or any other entity) that touches the trap releases the held player; the held
//   player cannot release itself. VERIFIED (decompile of 0x63a00c / 0x63ed78 / 0x63e3b0; the
//   collision loop of the enemy-side code at dump line 390595 calls (*obj+0x50) then (*obj+0x5c)).
//   ASSUMED: the touch distance (touch()).
//   Hit type 4 (vtable +0x10 = 0x0063ed14) also runs the release (FUN_0063e3b0) and then kills the
//   trap (flag 1, FUN_008113bc); the attack that hits it is not decoded here (not ported).
//
// Reticle (state 1): enable_reticle (dump 575550) makes the trap a lock-on target for each
// player's weapon targeting list (check_enemy_is_targetable); the drawing is not ported.
//
// Draw: render_capturetrap (dump 503294) and render_inactive_capture_trap (503119): a view
// test (vtable +0x24 = GiGuesGetViewDistance_007ba468 with 400), then the state: below 2 the
// inactive draw (the cloak rule), from 2 the active draw (render_active_capturetrap, the
// spring's njm frame +0xc0, no cloak check). The advanced-effects setting is ASSUMED on.

export const TRAP_CAPTURE = 0x0228; // TOTrapSeabed01 (the Seabed capture trap)
export const TRAP_VISION_FLAG = 0x10000; // player unknown_flags_2 (has_trap_vision)
export const CAPTURE_RADIUS = 15; // +0x33c (idle radius) and +0x340 (0x41700000, ApplyDerolleTrapInitData)
export const VIEW_DISTANCE = 400; // vtable +0x24 arg 0x43c80000 (400.0); its mesh radius 0x42c80000 (100.0) is not used here
export const CAPTURE_SPEED_MIN = Math.fround(0.1); // 0x00934514 (and 0x0093450c)
export const CAPTURE_SPEED_MAX = 10; // 0x00934508
export const HOLD_UNTIL_RELEASED = 0xffff; // 6x2C frames argument of the capture hold (EnemyAcquireTargetAndAttack)
// The trap's collision: a sphere of radius 14 at y + 20 (DerolleTrapCollisionBoxData 0x009c6b04: +0x0c = 14.0,
// +0x04 = 20.0, the layout of the pillar's box 0x009c684c, read with exedata.py).
export const CAPTURE_BOX_RADIUS = 14;
// ASSUMED: a player's hitboxes->radius (the pillar traps' PLAYER_RADIUS, combat/enemyfsm.ts).
export const CAPTURE_PLAYER_RADIUS = 5;
// ASSUMED: a touch is the other entity inside the box plus its own radius (CAPTURE_PLAYER_RADIUS), in XZ.
export const CAPTURE_TOUCH_RADIUS = CAPTURE_BOX_RADIUS + CAPTURE_PLAYER_RADIUS;

// The cloak flag: param5 (+0x88), an int clamped to 0..1 (ApplyDerolleTrapInitData).
export function captureTrapCloaked(params: readonly number[]): boolean {
  return Math.trunc(params[4] ?? 0) > 0;
}

// The animation speed (+0xc8) and the clamped param1 (+0x68): ApplyDerolleTrapInitData_0063ea98.
export function captureSpeed(p1: number): number {
  if (!(p1 >= CAPTURE_SPEED_MIN)) return CAPTURE_SPEED_MIN;
  return Math.fround(Math.min(p1, CAPTURE_SPEED_MAX));
}

// SawMapObjectPlaySound_0063e288 (PlayDirectionalSFX, positional): the jungle group (cca, jungle
// east / north, mountain, seaside) 0x4da and the seabed group (upper / lower) 0x4fe. ASSUMED: the
// areas 23..27 are the jungle group and 28 / 29 the seabed one (the DEVLOG's floor list).
export function captureSound(area: number): number | null {
  if (area >= 23 && area <= 27) return 0x4da;
  if (area === 28 || area === 29) return 0x4fe;
  return null;
}

// The has-trap-vision bit of a player's unknown_flags_2 (player +0x33c).
export function hasTrapVision(flags2: number): boolean {
  return (flags2 & TRAP_VISION_FLAG) !== 0;
}

export interface VisionPlayer {
  room: number;
  flags: number; // unknown_flags_2
}

// IsPlayerVisibleToPartTrap_0063a208: the four player slots (0..3), same room, has the bit.
export function trapVisionSeen(trapRoom: number, players: readonly (VisionPlayer | null)[]): boolean {
  for (let i = 0; i < 4; i++) {
    const p = players[i];
    if (p && p.room === trapRoom && hasTrapVision(p.flags)) return true;
  }
  return false;
}

// GiGuesGetViewDistance_007ba468 with view distance `distance`: the trap is in front of the
// camera (the exe's camera-space z is negative in front) and within the distance. ASSUMED:
// the frustum's screen-space bounds are left to three.js culling.
export function withinViewDistance(depth: number, distance = VIEW_DISTANCE): boolean {
  return depth <= 0 && depth >= -distance;
}

// What render_capturetrap draws: 'hidden', 'plain' (the normal model) or 'cloak' (the cloak
// pass). The reveal is not an input: the exe's draw does not read it.
export type CaptureDraw = 'hidden' | 'plain' | 'cloak';
export function captureTrapDraw(cloaked: boolean, advancedEffects: boolean, inView: boolean, sprung: boolean): CaptureDraw {
  if (!inView) return 'hidden';
  if (sprung) return 'plain'; // render_active_capturetrap: no cloak check
  if (!cloaked) return 'plain';
  return advancedEffects ? 'cloak' : 'hidden';
}

// A player as the trap's nearest search sees it (EnemyGetNearestTargetInRange: the floor's players).
export interface CapturePlayer {
  clientId: number;
  x: number;
  z: number;
  radius: number; // hitboxes->radius
}

export interface CaptureInput {
  slots: readonly (VisionPlayer | null)[]; // the four client slots (trap vision)
  room: number; // the trap's room
  players: readonly CapturePlayer[]; // the players on the trap's floor
  selfId: number; // the local client id (the hold goes to it only)
  springFrames: number; // the spring motion's frame count; 0 = not known (the spring does not end)
}

// Nearest player whose XZ distance squared is under max^2 (EnemyGetNearestTargetInRange_007714cc,
// the strict test updates the best). ASSUMED: the exe's map ray test is left out.
function nearestInRange(players: readonly CapturePlayer[], x: number, z: number, max: number): CapturePlayer | null {
  let best: CapturePlayer | null = null;
  let bestD = max * max;
  for (const p of players) {
    const dx = p.x - x;
    const dz = p.z - z;
    const d = dz * dz + dx * dx;
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export class CaptureTrap {
  readonly cloaked: boolean;
  readonly radius = CAPTURE_RADIUS; // +0x33c
  readonly speed: number; // +0xc8
  readonly sound: number | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  // Trap vision seen (sticky: nothing clears it).
  revealed = false;
  // +0x32e: 0 idle, 1 revealed (trap vision), 2 spring, 3 hold. Only 0 -> 1 comes from the vision,
  // 1 -> 2 from the idle (a player in range); nothing returns to 0 or 1.
  state: 0 | 1 | 2 | 3 = 0;
  // +0xc0: the spring motion frame (render_active_capturetrap reads it).
  anim = 0;
  // +0x340: EnemyAcquireTargetAndAttack rewrites it (r -= the player's radius) on each call.
  private reach = CAPTURE_RADIUS;
  // +0x348: the hit counter of SawMapObjectHandleHit (1 at construction, never reset here).
  private counter = 1;
  // The client id held by the spring's hit (EnemyGetNearestTargetInRange's target at the spring's
  // end), null when nobody is held. Set on every client (the trap runs on each), not only for the local player.
  captured: number | null = null;

  constructor(params: readonly number[], area = 0, at: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }) {
    this.cloaked = captureTrapCloaked(params);
    this.speed = captureSpeed(params[0] ?? 0);
    this.sound = captureSound(area);
    this.x = at.x;
    this.y = at.y;
    this.z = at.z;
  }

  // One AI tick (EnemyAIUpdateState_0063a034). The returned events are the exe's calls out: the
  // 6x2C hold (only for the local player), positional SEs.
  frame(input: CaptureInput): TrapEvent[] {
    const out: TrapEvent[] = [];
    if (this.state === 0 && trapVisionSeen(input.room, input.slots)) {
      this.revealed = true;
      this.state = 1;
    }
    if (this.state <= 1) {
      this.idle(input);
    } else if (this.state === 2) {
      this.spring(input, out);
    } else {
      this.touch(input.players, out);
      this.hold(out);
    }
    return out;
  }

  // The release (SawMapObjectOnInteract_0063ed78 -> SawMapObjectDisablePlayerMovementOnVisibility_0063e3b0).
  // The trap's on-interact is called when an entity's collision touches the trap (the caller checks the
  // +0x50 gate first: 0x0063a00c is "the entity is not the trap's target", so the held player cannot
  // release itself; any other entity does). The release sends 6x2D for the held player.
  // ASSUMED: "touches" is the entity within the box radius plus the player radius, in XZ.
  private touch(players: readonly CapturePlayer[], out: TrapEvent[]): void {
    if (this.captured === null) return;
    for (const p of players) {
      if (p.clientId === this.captured) continue;
      const dx = p.x - this.x;
      const dz = p.z - this.z;
      if (dz * dz + dx * dx < CAPTURE_TOUCH_RADIUS * CAPTURE_TOUCH_RADIUS) {
        out.push(this.release(this.captured));
        this.captured = null;
        return;
      }
    }
  }

  // DerollePartObjectUpdateTarget_0063a3d8: a player within the radius -> spring.
  private idle(input: CaptureInput): void {
    if (nearestInRange(input.players, this.x, this.z, this.radius)) this.state = 2;
  }

  // SawMapObjectUpdateAnimation_0063e7a4 (+ EnemyAcquireTargetAndAttack_0063e444 at the end).
  private spring(input: CaptureInput, out: TrapEvent[]): void {
    this.anim = Math.fround(this.anim + this.speed);
    // njm frame count - 1 (+0.0 from 0x009344d0). With no motion the exe's value is 2^32 - 1 (never ends).
    const end = input.springFrames > 0 ? input.springFrames - 1 : Infinity;
    if (this.anim <= end) return;
    this.anim = end;
    this.state = 3;
    const target = nearestInRange(input.players, this.x, this.z, this.radius);
    if (!target) return;
    this.reach = Math.fround(this.reach - target.radius);
    const dx = target.x - this.x;
    const dz = target.z - this.z;
    if (dz * dz + dx * dx < this.reach * this.reach) {
      const r2 = Math.fround(this.reach * this.reach);
      this.captured = target.clientId;
      // SnowBerillSendAttackPacket_006937c8 is sent for the target; the packet goes out for the local player.
      if (target.clientId === input.selfId) {
        out.push({ kind: 'hold', clientId: target.clientId, frames: HOLD_UNTIL_RELEASED, x: this.x, z: this.z, radius2: r2 });
      }
      if (this.sound !== null) out.push({ kind: 'sound', id: this.sound });
    }
  }

  // SawMapObjectHandleHit_0063e72c: the counter drops; while it is 0 or more the SE plays. Below 0
  // the exe calls unknown_melee_attack_2 and then try_hit_entity(target, 1.0) on the trap's own vtable
  // slot 0x5c (`call *0x5c(%edx)` in the asm: the on-interact, so the release of the target with no
  // touch gate). NOT ported: the counter's field (+0x348) is ASSUMED and the flag it needs is not traced;
  // if both hold, the release would come two ticks after the spring (open question, see the DEVLOG).
  private hold(out: TrapEvent[]): void {
    this.counter -= 1;
    if (this.counter >= 0 && this.sound !== null) out.push({ kind: 'sound', id: this.sound });
  }

  // The 6x2D for `clientId` (DisablePlayerMovement_00685514). The state is not changed by it in the exe.
  release(clientId: number): TrapEvent {
    return { kind: 'release', clientId };
  }
}

// An incoming 6x2C / 6x2D (u8 sub, u8 size, u16 client id at 2; 6x2C's u16 frames at 4).
export function parseHoldPacket(sub: number, body: Uint8Array): { sub: 0x2c | 0x2d; clientId: number; frames: number } | null {
  if (sub !== 0x2c && sub !== 0x2d) return null;
  if (body.length < 4) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const clientId = dv.getUint16(2, true);
  const frames = sub === 0x2c && body.length >= 6 ? dv.getUint16(4, true) : 0;
  return { sub, clientId, frames };
}

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

// Techniques: the data, the per-level scaling, the damage / heal formulas and
// the cast timing of PsoBB.exe (Ephinea 1.25.13, addresses are VAs).
//
// Data: technique_data_array (0x009cf3c0, 19 x 0x2C):
//   {f32 power, speed, range_h, range_v; u16 tp_cost, charge, unknown1, type;
//    u32 angle_h, angle_v (BAMS); u16 cast; u8 targets, v_tp_cost;
//    u16 v_power, v_range_h, v_range_v, v_angle}
// GetTechniqueData_006ded14(tech, level, player) copies a row and scales it by
// the 0-based level (jump table 0x0096cb60, one case per technique; decoded
// from the disassembly, 0x006dee57..0x006e06ca):
//   tp_cost = trunc(tp_cost + level * v_tp_cost / 100.0) (fistp with the
//     control word | 0xC00, i.e. truncation), except Ryuker / Reverser;
//   charge = max(0, charge - max(0, level - 4)); unknown1 += v_range_v * level;
//   range_h += v_range_h * (max(0, level - 4) or level / 5, per technique);
//   cast -= 5 * (min(level, 15) / 10 or / 5, per technique), <= 0 -> 10;
//     Gifoie's cast is a fixed 40;
//   angle_h += (level / 5) * trunc(v_angle * 65536 / 360) for Foie, Rafoie,
//     Barta, Gibarta, Megid; then every angle_h is halved (the epilogue at
//     0x006e0691), so it is a half-angle;
//   the support techniques scale range_h (Grants its power) by 1 + boost:
//     the 9 equipment boost slots of the player at 0x00a96520 (not tracked
//     by the web client, taken as 0) plus the class boost table
//     0x009cc550[class][tech] (0x006e1d98 -> 0x0068c3dc -> 0x006ad29c);
//   Shifta / Deband / Resta have targets = 0 below level 3, Anti at level 1.
//   In battle mode (0x00687c48) tp_cost is also scaled by 0x009cf780; battle
//   mode is not part of the web client.
//
// Power (GetTechniquePower_006dec5c and every attack technique's
// ApplyPowerAndSpeedStats, e.g. TechniqueObject_ApplyPowerAndSpeedStats
// _006e31e8): power + v_power * level up to level 15 (0-based 14); above it
// add + factor * level from g_TechniquePowerScaleArray_009cf720.
//
// Damage (entity_hit_by_tech, 0x00773b2c area, enemy vtable +0x60), for a
// player caster:
//   d = (MST + power) * (1 + boost(tech))                 (0x006e1d98 + 1.0)
//   d *= (100 - resist) * 0.002                           (0x00978270)
//   resist: EFR for Foie / Gifoie / Rafoie (group 1), EIC for Barta (group
//   0x13) and Gibarta / Rabarta (group 2), ETH for Zonde / Gizonde / Razonde
//   (group 3), ELT for Grants (group 4). HP -= round(d) (no hit roll and no
//   critical, unlike a weapon hit). Megid (group 5): kill when rand() <
//   (power - EDK) * 0.01 (0x0097826c), no boss maps.
//   Unlike the weapon hit, the attack boost here uses the class boost table
//   with the technique id (Ephinea's 0.3 / 0.5 / 1.0 rows); equipment boosts
//   are not tracked (ASSUMED 0).
// Resta (group 6): HP += round(MST * 0.5 + power) (0x00978278) on each
//   player it reaches.
//
// Cast (palette: the input dispatch of handle_input_state_cast_tech with
// argument 5; menu: SendCastTechPacket_0069a2f0), eligibility
// CanPlayerCastTechnique_0069a0c4: not already casting, on a field (not a
// city), the technique learned, TP >= tp_cost. Then:
//   1. 6x8D {level - 14 when level > 14, else 0} and 6x47 {tech, min(level,
//      14), targets} go out and the client runs its own 6x47
//      (action_cast_tech): input state 8, cast motion = field motion slot 1
//      (motion set vtable +0x38 = 0x007083d4, `mov eax, 1`), facing the first
//      target (the state's enter code after HandleHeavySpecialAttackState6).
//   2. ProcessHeavySpecialAttackState: phase 0 starts the charge effect and
//      sets the counter to `charge` ticks; phase 1 holds the motion near its
//      start (frame oscillates by 0.05 between 0 and 0.2, 0x0093d9cc /
//      0x0093d9d0) until the counter runs out; phase 2 lets the motion run
//      and releases at the motion frame of GetWeaponModelData (0x006ac778:
//      0x009cc4a4[motion type] + weapon class * 0x14, float +0xC; 13 for
//      armed hands, 8 / 17 / 13 bare-handed).
//   3. Release (0x006a0340 area, HandleHeavySpecialAttackUnsafeMap): TP -=
//      tp_cost (0 when it would drop below 1), then 6x48 {u16 tech, u16
//      min(level, 14)}; its handler (action_launch_tech) creates the
//      technique object (unknown_cast_tech) and sets `cast` ticks.
//   4. Phase 4 counts `cast` down, phase 5 waits for the motion to end.
// 6x47 targets (InitializeTechniqueTargetingParams_006e1a48): one (the
// targeting system's primary) for Foie, Rafoie, Barta, Gibarta, Zonde,
// Grants, Megid, Reverser; the list for Gizonde and the support techniques;
// none for Gifoie, Rabarta, Razonde. Rafoie / Barta / Foie etc. with no
// target fire straight ahead (unknown_cast_tech); Rafoie needs a target.

import type { MotionRecord } from '../formats/plymotion.ts';

export const TECH = {
  foie: 0, gifoie: 1, rafoie: 2, barta: 3, gibarta: 4, rabarta: 5, zonde: 6, gizonde: 7, razonde: 8, grants: 9,
  deband: 10, jellen: 11, zalure: 12, shifta: 13, ryuker: 14, resta: 15, anti: 16, reverser: 17, megid: 18,
} as const;

export const TECH_NAMES = [
  'Foie', 'Gifoie', 'Rafoie', 'Barta', 'Gibarta', 'Rabarta', 'Zonde', 'Gizonde', 'Razonde', 'Grants',
  'Deband', 'Jellen', 'Zalure', 'Shifta', 'Ryuker', 'Resta', 'Anti', 'Reverser', 'Megid',
] as const;

export interface TechniqueData {
  power: number;
  speed: number;
  rangeH: number;
  rangeV: number;
  tpCost: number;
  charge: number;
  unknown1: number;
  type: number;
  angleH: number; // BAMS
  angleV: number;
  cast: number;
  targets: number;
  vTpCost: number;
  vPower: number;
  vRangeH: number;
  vRangeV: number;
  vAngle: number;
}

// technique_data_array (0x009cf3c0): power, speed, range_h, range_v, tp_cost,
// charge, unknown1, type, angle_h, angle_v, cast, targets, v_tp_cost,
// v_power, v_range_h, v_range_v, v_angle.
// prettier-ignore
const TABLE: ReadonlyArray<readonly number[]> = [
  [110, 3, 100, 10, 5, 5, 40, 1, 5461, 7281, 15, 1, 130, 50, 10, 20, 5],
  [260, 8, 50, 0, 20, 7, 100, 1, 65536, 0, 20, 10, 70, 26, 5, 25, 0],
  [350, 0, 100, 10, 30, 13, 133, 1, 7281, 0, 25, 10, 25, 22, 10, 28, 5],
  [50, 3, 90, 10, 4, 5, 35, 2, 9102, 0, 15, 1, 120, 50, 30, 25, 20],
  [230, 0, 100, 0, 25, 7, 100, 2, 21845, 0, 40, 10, 50, 24, 10, 24, 30],
  [400, 0, 40, 0, 35, 13, 106, 2, 65536, 0, 25, 10, 20, 19, 2, 30, 0],
  [80, 0, 110, 0, 6, 5, 44, 3, 65536, 16384, 15, 1, 110, 50, 10, 24, 0],
  [200, 0, 80, 10, 25, 7, 100, 3, 14563, 16384, 20, 10, 60, 22, 20, 25, 0],
  [450, 0, 50, 0, 35, 13, 134, 3, 65536, 16384, 25, 10, 30, 16, 20, 30, 0],
  [1180, 0, 150, 0, 45, 15, 160, 3, 65536, 16384, 35, 1, 110, 75, 30, 30, 0],
  [0, 0, 60, 0, 10, 5, 60, 10, 65536, 16384, 30, 10, 100, 1, 25, 28, 0],
  [0, 0, 50, 0, 10, 5, 60, 11, 65536, 16384, 15, 10, 50, 1, 4, 28, 0],
  [0, 0, 50, 0, 10, 5, 60, 12, 65536, 16384, 15, 10, 50, 1, 4, 28, 0],
  [0, 0, 60, 0, 10, 5, 60, 9, 65536, 16384, 30, 10, 100, 1, 25, 28, 0],
  [0, 0, 10, 0, 10, 20, 150, 14, 0, 0, 20, 0, 50, 0, 0, 0, 0],
  [50, 0, 60, 0, 15, 7, 50, 6, 0, 0, 20, 10, 120, 5, 25, 30, 0],
  [0, 0, 60, 0, 10, 7, 85, 7, 0, 0, 20, 10, 50, 0, 25, 26, 0],
  [0, 0, 100, 0, 20, 10, 150, 8, 0, 0, 30, 1, 0, 0, 0, 0, 0],
  [27, 2, 100, 10, 30, 15, 160, 5, 7281, 7281, 35, 1, 105, 3, 20, 28, 10],
];

// g_TechniquePowerScaleArray_009cf720: {i16 add, i16 factor} per technique,
// the power above level 15.
// prettier-ignore
const POWER_ABOVE_15: ReadonlyArray<readonly [number, number]> = [
  [-85, 65], [30, 42], [370, 21], [-125, 63], [0, 40], [470, 15], [5, 55], [-30, 38], [550, 9], [1400, 60],
  [10, 1], [10, 1], [10, 1], [10, 1], [0, 0], [-20, 10], [0, 0], [0, 0], [42, 2],
];

// Class boost table 0x009cc550[class] -> f32[19] (classes 0-5, 9, 11 point
// at the zero row 0x009691e0).
const ZERO19: readonly number[] = new Array(19).fill(0);
// prettier-ignore
export const CLASS_TECH_BOOST: ReadonlyArray<readonly number[]> = [
  ZERO19, ZERO19, ZERO19, ZERO19, ZERO19, ZERO19,
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 0, 0, 1, 0, 1, 1, 0, 0], // FOmarl 0x00969240
  [0, 0.3, 0.3, 0, 0.3, 0.3, 0, 0.3, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // FOnewm 0x009692a0
  [0.3, 0, 0, 0.3, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1], // FOnewearl 0x00969300
  ZERO19,
  [0, 0.3, 0, 0, 0.3, 0, 0, 0.3, 0, 0.3, 1, 0, 0, 1, 0, 0, 0, 0, 0], // FOmar 0x00969360
  ZERO19,
];

export const TECH_DAMAGE_SCALE = 0.002; // 0x00978270
export const RESTA_MST_SCALE = 0.5; // 0x00978278
export const MEGID_CHANCE_SCALE = 0.01; // 0x0097826c
export const MAX_SENT_LEVEL = 14; // unknown_adjust_tech_level: 6x47 / 6x48 carry at most 14

const f32 = Math.fround;
// trunc(x * 65536.0f / 360.0f) (fistp in truncation mode).
const bamsOf = (deg: number) => Math.trunc(f32(f32(deg * 65536) / 360));

// The boost GetTechniqueData / entity_hit_by_tech add to 1.0 (0x006e1d98):
// the class row; equipment boosts are not tracked (ASSUMED 0).
export function techBoost(charClass: number, tech: number): number {
  return CLASS_TECH_BOOST[charClass]?.[tech] ?? 0;
}

// GetTechniqueData_006ded14 for a 0-based level.
export function techData(tech: number, level: number, charClass = 0): TechniqueData {
  const r = TABLE[tech] ?? TABLE[0];
  const d: TechniqueData = {
    power: r[0], speed: r[1], rangeH: r[2], rangeV: r[3], tpCost: r[4], charge: r[5], unknown1: r[6], type: r[7],
    angleH: r[8], angleV: r[9], cast: r[10], targets: r[11], vTpCost: r[12], vPower: r[13], vRangeH: r[14], vRangeV: r[15], vAngle: r[16],
  };
  const lv15 = Math.min(level, 15);
  const lv = Math.max(0, Math.min(0x1d, level));
  if (tech === TECH.ryuker || tech === TECH.reverser) {
    d.angleH = Math.trunc(d.angleH / 2);
    if (d.cast <= 0) d.cast = 10;
    return d;
  }
  d.tpCost = Math.trunc(f32(d.tpCost + f32(lv * f32(d.vTpCost / 100))));
  const m4 = Math.max(0, lv - 4);
  const per5 = Math.trunc(lv / 5);
  const boost = 1 + techBoost(charClass, tech);
  // range_h step: max(lv - 4, 0) or lv / 5.
  const rangeM4 = [TECH.foie, TECH.gifoie, TECH.rabarta, TECH.zonde, TECH.jellen, TECH.zalure] as number[];
  const rangePer5 = [TECH.rafoie, TECH.barta, TECH.gibarta, TECH.gizonde, TECH.razonde, TECH.grants, TECH.megid] as number[];
  if (rangeM4.includes(tech)) d.rangeH = f32(d.rangeH + d.vRangeH * m4);
  if (rangePer5.includes(tech)) d.rangeH = f32(d.rangeH + d.vRangeH * per5);
  if ([TECH.jellen, TECH.zalure, TECH.deband, TECH.shifta, TECH.resta, TECH.anti].includes(tech as never)) d.rangeH = f32(d.rangeH * boost);
  if (tech === TECH.grants) d.power = f32(d.power * boost);
  // cast step: 5 * (min(lv, 15) / 10) or / 5.
  const castPer10 = [TECH.foie, TECH.barta, TECH.zonde, TECH.jellen, TECH.zalure] as number[];
  if (tech === TECH.gifoie) d.cast = 40;
  else d.cast -= 5 * Math.trunc(lv15 / (castPer10.includes(tech) ? 10 : 5));
  if ([TECH.foie, TECH.rafoie, TECH.barta, TECH.gibarta, TECH.megid].includes(tech as never)) d.angleH += per5 * bamsOf(d.vAngle);
  if ((tech === TECH.deband || tech === TECH.shifta || tech === TECH.resta) && lv < 2) d.targets = 0;
  if (tech === TECH.anti && lv <= 0) d.targets = 0;
  d.charge = Math.max(0, d.charge - m4);
  d.unknown1 = (d.unknown1 + d.vRangeV * lv) & 0xffff;
  // Epilogue (0x006e0691).
  d.angleH = Math.trunc(d.angleH / 2);
  if (d.cast <= 0) d.cast = 10;
  return d;
}

export function techTpCost(tech: number, level: number): number {
  return techData(tech, level).tpCost;
}

// GetTechniquePower_006dec5c (0-based level).
export function techPower(tech: number, level: number, charClass = 0): number {
  if (level > 14) {
    const [add, factor] = POWER_ABOVE_15[tech] ?? [0, 0];
    return add + factor * level;
  }
  const d = techData(tech, level, charClass);
  return f32(d.power + d.vPower * level);
}

export type Element = 'fire' | 'ice' | 'lightning' | 'light' | 'dark' | null;

// technique_group of entity_hit_by_tech and the resistance it reads.
export function techElement(tech: number): Element {
  if (tech <= TECH.rafoie) return 'fire';
  if (tech <= TECH.rabarta) return 'ice';
  if (tech <= TECH.razonde) return 'lightning';
  if (tech === TECH.grants) return 'light';
  if (tech === TECH.megid) return 'dark';
  return null;
}

export interface TechResist {
  efr: number;
  eic: number;
  eth: number;
  elt: number;
  edk: number;
}

// entity_hit_by_tech's damage of an attack technique (not Megid) on an
// enemy, before rounding.
export function techDamage(tech: number, level: number, mst: number, charClass: number, resist: TechResist): number {
  const el = techElement(tech);
  const r = el === 'fire' ? resist.efr : el === 'ice' ? resist.eic : el === 'lightning' ? resist.eth : el === 'light' ? resist.elt : 0;
  return f32(f32((100 - r) * TECH_DAMAGE_SCALE) * techHitPower(tech, level, mst, charClass));
}

// The power argument entity_hit_by_tech gets: (MST + power) * (1 + boost).
// Gibarta / Rabarta's freeze roll reads it (combat/enemystatus.ts).
export function techHitPower(tech: number, level: number, mst: number, charClass: number): number {
  const power = Math.max(0, techPower(tech, level, charClass));
  return f32(f32(Math.max(0, mst) + power) * f32(techBoost(charClass, tech) + 1));
}

// Megid's instant-kill chance.
export function megidChance(level: number, edk: number): number {
  return (techPower(TECH.megid, level) - edk) * MEGID_CHANCE_SCALE;
}

// Resta's heal on one player.
export function restaHeal(level: number, mst: number, charClass = 0): number {
  const d = techData(TECH.resta, level, charClass);
  return Math.round(Math.max(0, mst) * RESTA_MST_SCALE + f32(d.power + d.vPower * level));
}

// Which targets 6x47 carries (InitializeTechniqueTargetingParams_006e1a48).
export function targetListKind(tech: number): 'one' | 'list' | 'none' {
  if (tech === TECH.gifoie || tech === TECH.rabarta || tech === TECH.razonde || tech === TECH.ryuker) return 'none';
  if (tech === TECH.gizonde || (tech >= TECH.deband && tech <= TECH.anti && tech !== TECH.ryuker)) return 'list';
  return 'one';
}

// 6x8D's level_upgrade and the level byte of 6x47 / 6x48
// (unknown_adjust_tech_level: levels above 14 send 14 + an override).
export function splitLevel(level: number): { sent: number; extra: number } {
  if (level !== 0xff && level > MAX_SENT_LEVEL) return { sent: MAX_SENT_LEVEL, extra: level - MAX_SENT_LEVEL };
  return { sent: level, extra: 0 };
}

// --- cast motion ---------------------------------------------------------

// Field motion slot 1 (0x009cbeec / 0x009cbf04) by motion type and weapon
// class: rlc index (mode 3, flags 0x20000008, speed 1.4 except where noted).
// prettier-ignore
const CAST_MOTIONS: ReadonlyArray<readonly number[]> = [
  [194, 98, 113, 126, 139, 113, 1, 11, 24, 37, 98, 63, 77, 194, 77, 176, 98, 50, 1],
  [406, 328, 344, 357, 344, 328, 240, 251, 357, 274, 328, 300, 310, 406, 310, 387, 328, 287, 240],
  [500, 481, 344, 357, 344, 481, 481, 251, 448, 274, 481, 460, 474, 500, 474, 387, 328, 287, 240],
  [194, 98, 113, 126, 139, 113, 1, 11, 511, 37, 98, 517, 77, 194, 77, 176, 98, 50, 1],
  [406, 328, 344, 357, 344, 328, 240, 251, 357, 274, 328, 300, 310, 406, 310, 387, 328, 287, 240],
  [406, 328, 344, 357, 344, 328, 240, 251, 357, 274, 328, 300, 310, 406, 310, 387, 328, 287, 240],
];
const CAST_SPEED_EXCEPTIONS: Record<string, number> = { '2:17': 1.0, '2:18': 1.5, '3:11': 1.2 };

export function castMotion(motionType: number, weaponClass: number): MotionRecord {
  const t = CAST_MOTIONS[motionType] ? motionType : 0;
  const w = weaponClass >= 0 && weaponClass < 19 ? weaponClass : 0;
  return { index: CAST_MOTIONS[t][w], mode: 3, next: -1, speed: CAST_SPEED_EXCEPTIONS[`${t}:${w}`] ?? 1.4, flags: 0x20000008 };
}

// GetWeaponModelData_006ac778 +0xC: the cast motion frame that releases the
// technique (0x009cc4a4[motion type][weapon class]).
export function releaseFrame(motionType: number, weaponClass: number): number {
  if (weaponClass !== 0) return 13;
  return [8, 17, 13, 8, 17, 17][motionType] ?? 13;
}

// --- the cast state machine (ProcessHeavySpecialAttackState) ---------------

export interface TechCastEvents {
  release: () => void; // TP, 6x48, the technique object
  done: () => void;
}

export type CastPhase = 'charge' | 'swing' | 'cast' | 'recover' | 'idle';

// One cast, ticked at 30/s with the cast motion's current frame.
export class TechCast {
  phase: CastPhase = 'charge';
  private counter: number;
  private readonly release: number;
  private readonly castTicks: number;
  private readonly events: TechCastEvents;
  holdFrame = 0; // phase 1 holds the motion near its start
  private holdStep = 0.05; // 0x0093d9d0

  constructor(data: TechniqueData, releaseAt: number, events: TechCastEvents) {
    this.counter = data.charge;
    this.release = releaseAt;
    this.castTicks = data.cast;
    this.events = events;
  }

  // True while the motion must stay paused (phase 1).
  get holding(): boolean {
    return this.phase === 'charge';
  }

  tick(motionFrame: number, motionEnded: boolean): void {
    switch (this.phase) {
      case 'charge': {
        this.holdFrame += this.holdStep;
        if (this.holdStep > 0 ? this.holdFrame >= 0.2 : this.holdFrame <= 0) this.holdStep = -this.holdStep;
        this.counter--;
        if (this.counter < 0) this.phase = 'swing';
        break;
      }
      case 'swing':
        if (motionFrame >= this.release || motionEnded) {
          this.phase = 'cast';
          this.counter = this.castTicks;
          this.events.release();
        }
        break;
      case 'cast':
        this.counter--;
        if (this.counter < 0) this.phase = 'recover';
        break;
      case 'recover':
        if (motionEnded) {
          this.phase = 'idle';
          this.events.done();
        }
        break;
    }
  }
}

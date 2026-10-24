// The MAG's model choice, its gate and its motion (the MAG object that follows the
// player's shoulder). Pure math: the three.js objects are in render/magmodel.ts.
//
// Decompiled from PsoBB.exe (Ephinea 1.25.13):
//   - A MAG is an item_instance with item_kind 2 (UpdateItemInstance_005c3ed8, dump 412764).
//     Its draw is UpdateItemPhysics_005c4124 (dump 412908), which calls the MAG's vtable draw
//     (FUN_005d901c, vtable +0x64) only when is_current_map_safe() != 0. That test is the
//     hub list 0x0097f1c8 = {0, 15, 18, 45, -1}: the port's HUB_AREAS (render/playermove.ts).
//   - The two model parts (InitializeMagModel_005d8351): each part with a motion record
//     builds one model object; the model is ItemModel.afs entry 271 + the PMT model and
//     ItemTexture.afs entry 295 + the PMT skin (the item group base table 0x0092c53c /
//     0x0092c534 at group 2 = mags; the loader is LoadItemAsset_005d7868). The colour is the
//     mag's colour index (item data2[3], formats/itemnames.ts magStats) into ItemMagEdit's
//     colour table.
//   - Per game tick (FUN_005dc7c0 at 0x005dc7c0; read from the asm of 0x005dc7c0..0x005dc98c):
//     the anchor follows the body node of the record (or the owner's position at -1) with the
//     record's damping factor (FUN_005dc62c: p += (t - p) * f); the offset is three sine
//     terms of BAMS angles (FUN_005dc600) plus three accumulated terms (FUN_005dc590, summed
//     into +0xa8..+0xb0 and added to the offset); the spin angles step from the record's bytes.
//   - The transform (FUN_005dd0d8, dump 0x005dd0d8): translate to the anchor, rotate with the
//     owner's heading, translate by the offset, rotate by the spin + tilt (Z, then Y, then X),
//     scale by +0xdc (1.0 for the port: ASSUMED; mag_model_constructor takes it from the owner's
//     +0x97c, not ported).
//
// ASSUMED: the rotation's axis order and signs (Z * Y * X), the sign of the heading, the
// spin flag (FUN_005db764 reads the owner's +0x328 bit 2 or 4: the port passes "standing"),
// the owner's invisibility and equipment flags in the gate (only the hub test is used, as
// the held weapon does), and that both parts draw the primary model (no secondary model
// is read, see the InitializeMagModel_005d8351 comment: the secondary slot is set only by
// the item loader).

import { BAMS_PER_UNIT, type MagMotionRecord } from '../formats/itemmagmotion.ts';
import { inUnsafeMap } from './playermove.ts';

export const BAMS_TURN = 65536;
export const MAG_MODEL_BASE = 271; // ItemModel.afs: group 2 (mags) model base, 0x0092c53c + 2 * 2
export const MAG_TEXTURE_BASE = 295; // ItemTexture.afs: group 2 skin base, 0x0092c534 + 2 * 2

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// The model's archive entries for a PMT mag (its model and skin fields).
export function magArchiveEntries(pmt: { type: number; skin: number }): { model: number; texture: number } {
  return { model: MAG_MODEL_BASE + pmt.type, texture: MAG_TEXTURE_BASE + pmt.skin };
}

// The colour index a MAG draws with: the exe clamps the index past 0x11 through mag_set_color
// (not ported: ASSUMED colour 0 there).
export function magColourIndex(colour: number): number {
  return colour >= 0 && colour <= 0x11 ? colour : 0;
}

// Whether a MAG draws on this map: outside the hubs (is_current_map_safe, UpdateItemPhysics).
export function magDrawsOn(area: number): boolean {
  return inUnsafeMap(area);
}

// sin of a BAMS angle (the exe's table lookup, FUN_0082dcbc: 65536 is one turn).
export function bamsSin(units: number): number {
  return Math.sin((((units | 0) & (BAMS_TURN - 1)) / BAMS_TURN) * 2 * Math.PI);
}

export function bamsToRadians(units: number): number {
  return (((units | 0) & (BAMS_TURN - 1)) / BAMS_TURN) * 2 * Math.PI;
}

// The exe's int wrap (the angles are 32-bit ints).
const wrap = (v: number): number => v | 0;

// The state of one MAG part (the model object's +0x30 record and +0xb4..+0xc8, +0x34..+0x3c, +0x4c..+0x60,
// +0xa8..+0xb0 in the exe).
export interface MagPartState {
  anchor: Vec3; // +0xb4
  offset: Vec3; // +0xc0 (the orbit with the extra terms)
  orbitAcc: [number, number, number]; // +0x4c, +0x50, +0x54
  extraAcc: [number, number, number]; // +0x58, +0x5c, +0x60
  extraSum: [number, number, number]; // +0xa8, +0xac, +0xb0 (accumulated, never reset)
  spin: [number, number, number]; // +0x34 (X), +0x38 (Y), +0x3c (Z), BAMS
}

// The exe's init (InitializeWeaponProjectilePosition_005dd200): the anchor starts at the
// node's (or the owner's) point, and the sums and angles start at zero.
export function newMagPartState(start: Vec3): MagPartState {
  return {
    anchor: { ...start },
    offset: { x: 0, y: 0, z: 0 },
    orbitAcc: [0, 0, 0],
    extraAcc: [0, 0, 0],
    extraSum: [0, 0, 0],
    spin: [0, 0, 0],
  };
}

// One game tick (FUN_005dc7c0's default path): `target` is the node's point (or the owner's
// position), `standing` the owner's standing flag (FUN_005db764, ASSUMED to be that bit).
export function magPartTick(s: MagPartState, rec: MagMotionRecord, target: Vec3, standing: boolean): void {
  // The anchor damps toward the target (FUN_005dc62c with the record's factor).
  const f = rec.factor;
  s.anchor.x = (target.x - s.anchor.x) * f + s.anchor.x;
  s.anchor.y = (target.y - s.anchor.y) * f + s.anchor.y;
  s.anchor.z = (target.z - s.anchor.z) * f + s.anchor.z;

  // The three orbit terms (FUN_005dc600): the accumulator steps, then amp * sin(acc + phase).
  const axes = ['x', 'y', 'z'] as const;
  for (let i = 0; i < 3; i++) {
    const t = rec.orbit[i];
    s.orbitAcc[i] = wrap(s.orbitAcc[i] + t.speed);
    s.offset[axes[i]] = t.amplitude * bamsSin(s.orbitAcc[i] + t.phase);
  }
  // The three extra terms (FUN_005dc590): acc += speed, then the sine is added into the sums.
  for (let i = 0; i < 3; i++) {
    const t = rec.extra[i];
    s.extraAcc[i] = wrap(s.extraAcc[i] + t.speed);
    const phase = Math.round((t.phaseUnits * BAMS_PER_UNIT));
    s.extraSum[i] += t.amplitude * bamsSin(s.extraAcc[i] + phase);
    s.offset[axes[i]] += s.extraSum[i];
  }

  // The spin (FUN_005dc7c0's tail): X is set from the flag branch and the byte at +0x05; Y and Z accumulate.
  const spinX = (standing ? Math.round(rec.spinFlag * BAMS_PER_UNIT) : 0) + Math.round(rec.spinBytes[0] * BAMS_PER_UNIT);
  s.spin[0] = wrap(spinX);
  s.spin[1] = wrap(s.spin[1] + Math.round(rec.spinBytes[1] * BAMS_PER_UNIT));
  s.spin[2] = wrap(s.spin[2] + Math.round(rec.spinBytes[2] * BAMS_PER_UNIT));
}

// The model's rotation in radians (X, Y, Z): the spin plus the record's tilt (FUN_005dd0d8).
export function magPartRotation(s: MagPartState, rec: MagMotionRecord): [number, number, number] {
  return [
    bamsToRadians(rec.tilt[0] + s.spin[0]),
    bamsToRadians(rec.tilt[1] + s.spin[1]),
    bamsToRadians(rec.tilt[2] + s.spin[2]),
  ];
}

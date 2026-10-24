// itemmagmotion.dat (data.gsl): the motion records of the MAG models.
//
// PsoBB.exe loads it as ItemMagEdit's "motion asset" (LoadAssetOptcallWrapper_005b9be8 with
// the string s_ItemMagEditMotionAsset, InitializeMagModel_005d8351's caller at dump 432875).
// The file is 90 records of 0x64 bytes; a MAG model part holds the index of its record
// (ItemMagEdit's per-type table, formats/itemmagedit.ts) and reads the fields below through
// its own object (InitializeWeaponProjectilePosition_005dd200 sets model +0x30 to the record).
//
// The field offsets are the exe's, read from the physics and the transform of the model
// (FUN_005dc7c0 at 0x005dc7c0, FUN_005dd0d8 at 0x005dd0d8, FUN_005dc590 / FUN_005dc600 at
// 0x005dc590 / 0x005dc600). Byte offsets in the record:
//   +0x00 i32  node: the owner's body node the MAG follows; -1: the owner's position
//   +0x08 f32  follow factor (the damping of the anchor toward the node, 0.9 on record 0)
//   +0x0c u8   spin (flag branch of FUN_005db764 only)
//   +0x0d s8   phase of the extra term 4 (x 182.04 BAMS per unit, exe's 65536 / 360)
//   +0x0e s8   phase of the extra term 5
//   +0x0f s8   phase of the extra term 6
//   +0x10 f32  amplitude of the extra term 4 (x, accumulated into +0xa8)
//   +0x14 f32  amplitude of the extra term 5 (y, into +0xac)
//   +0x18 f32  amplitude of the extra term 6 (z, into +0xb0)
//   +0x1c i32  tilt X (BAMS, the rotation about X of the model)
//   +0x20 i32  tilt Y (BAMS)
//   +0x24 i32  tilt Z (BAMS)
//   +0x28 i32  speed of the extra term 4 (BAMS per tick)
//   +0x2c i32  speed of the extra term 5
//   +0x30 i32  speed of the extra term 6
//   +0x34 f32  amplitude of orbit term A (x, into +0xc0), +0x3c i32 its phase, +0x40 i32 its speed
//   +0x44 f32  amplitude of orbit term B (y, into +0xc4), +0x4c i32 phase, +0x50 i32 speed
//   +0x54 f32  amplitude of orbit term C (z, into +0xc8), +0x5c i32 phase, +0x60 i32 speed
//   +0x05, +0x06, +0x07 s8  spin per tick of X, Y, Z (x 182.04 BAMS)
// The phases and speeds are BAMS (65536 is one turn); a record's trailing words (+0x64..)
// are not read.

export const MAG_MOTION_RECORDS = 90;
export const MAG_MOTION_SIZE = 100;
export const BAMS_PER_UNIT = 65536 / 360; // exe constants 0x0092cc54 / 0x0092cc50 (and 0x0092cc38 / 0x0092cc34)

export interface MagExtraTerm {
  amplitude: number; // f32 at +0x10 / +0x14 / +0x18
  phaseUnits: number; // s8 at +0x0d / +0x0e / +0x0f, in degrees (x BAMS_PER_UNIT when used)
  speed: number; // i32 at +0x28 / +0x2c / +0x30, BAMS per tick
}

export interface MagOrbitTerm {
  amplitude: number; // f32 at +0x34 / +0x44 / +0x54
  phase: number; // i32 at +0x3c / +0x4c / +0x5c, BAMS
  speed: number; // i32 at +0x40 / +0x50 / +0x60, BAMS per tick
}

export interface MagMotionRecord {
  node: number;
  factor: number;
  spinBytes: [number, number, number]; // s8 at +0x05, +0x06, +0x07
  spinFlag: number; // u8 at +0x0c
  tilt: [number, number, number]; // BAMS at +0x1c, +0x20, +0x24
  extra: [MagExtraTerm, MagExtraTerm, MagExtraTerm];
  orbit: [MagOrbitTerm, MagOrbitTerm, MagOrbitTerm];
}

// The records of the file, in order (record k is the k-th 100 bytes).
export function parseMagMotion(data: Uint8Array): MagMotionRecord[] {
  const n = Math.floor(data.length / MAG_MOTION_SIZE);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: MagMotionRecord[] = [];
  for (let r = 0; r < n; r++) {
    const o = r * MAG_MOTION_SIZE;
    const s8 = (k: number) => dv.getInt8(o + k);
    const i32 = (k: number) => dv.getInt32(o + k, true);
    const f32 = (k: number) => dv.getFloat32(o + k, true);
    out.push({
      node: i32(0x00),
      factor: f32(0x08),
      spinBytes: [s8(0x05), s8(0x06), s8(0x07)],
      spinFlag: data[o + 0x0c],
      tilt: [i32(0x1c), i32(0x20), i32(0x24)],
      extra: [
        { amplitude: f32(0x10), phaseUnits: s8(0x0d), speed: i32(0x28) },
        { amplitude: f32(0x14), phaseUnits: s8(0x0e), speed: i32(0x2c) },
        { amplitude: f32(0x18), phaseUnits: s8(0x0f), speed: i32(0x30) },
      ],
      orbit: [
        { amplitude: f32(0x34), phase: i32(0x3c), speed: i32(0x40) },
        { amplitude: f32(0x44), phase: i32(0x4c), speed: i32(0x50) },
        { amplitude: f32(0x54), phase: i32(0x5c), speed: i32(0x60) },
      ],
    });
  }
  return out;
}

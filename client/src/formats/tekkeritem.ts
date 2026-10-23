// The tekker's 3D item object at the description window (PsoBB.exe 1.25.13).
//
// FUN_006d9d94 (the tekker window's state update, 0x006d9d94) makes the object
// in the Result step: FUN_005caba4(0xb4) allocates it (a plain heap block, not
// a factory), FUN_00725d18 is its constructor (vtable 0x00b3fff0) at the GUI
// position of 0x29, which is the description window (0x00972088 = (400, 50),
// 240 x 184, read with tools/exedata.py; the table is 0x00971f40 + id * 8).
//
// Scale: the constructor sets +0xa8 / +0xac to 1.0 (0x3f800000). The window
// sets them to 0.75 (0x3f400000) only when FUN_0078b208() > 2 (0x6d3c24..0x6d3c2c,
// cmp eax, 2; jg). FUN_0078b208 returns 1 unless FUN_006dc358() is 1, and
// FUN_006dc358 is `return 0` (the decompile and the disassembly agree), so the
// gate is 1 and the object stays at 1.0. The 0.75 branch is not reached.
//
// Rotation: the update (FUN_00725e4c) sets +0x5c to 0x1000000 each frame while
// the flags' bit 2 is clear (the object's +0x2c is 0 from the constructor), and
// the draw (FUN_00712658) rotates by ROUND(+0x5c - 7.5) (0x0096f68c = -7.5),
// so the pose is fixed at -8 BAMS (about -0.0008 rad, ASSUMED to be the Y
// rotation): the object does not spin. (Superseded: 0x00712658 is the 2D
// element's text geometry, so this is not the model's angle; see Model below.)
//
// Model (corrected 2026-10-23, see the DEVLOG): 0x00725d18 is a 2D list
// window (vtable 0x00b3fff0: update 0x00725e4c = ChatShortcutMenu_Update, draw
// 0x00725ef8 = UIElement_UpdateRenderData 0x00712658 (text geometry), the
// element list 0x0072a648 and the sub-list text 0x0073e6b4). It draws no NJ
// model. The item's 3D object is a separate instance: FUN_006d9d94 stores
// FUN_005c9a40(item) in +0x14, the floor-item factory (kind table 0x009c2130:
// 0 weapon 0x005e762c, 1 armour 0x005c9718 -> sub table 0x009c2120, 2 mag
// 0x005d8d14, 3 tool 0x005de228, 4 0x005dd8e8). Those objects share the floor
// item base's update / draw (0x005c3ed8 / 0x005c4068 -> FUN_005c407c, the
// item.bml kind box). ASSUMED: the port keeps drawing the weapon's archives
// (render/heldweapon.ts) here; the exe's object is not that model. Armour,
// unit, mag and tool models are not drawn.

// GUI 0x29 (the description window), 0x00972088.
export const TEKKER_ITEM_X = 400;
export const TEKKER_ITEM_Y = 50;
export const TEKKER_ITEM_SCALE_FULL = 1; // +0xa8 / +0xac from the constructor (0x3f800000)
export const TEKKER_ITEM_SCALE_SMALL = 0.75; // 0x3f400000, FUN_006d9d94 when the gate is above 2
export const TEKKER_ITEM_GATE_LIMIT = 2;

// FUN_0078b208: 1 unless FUN_006dc358() == 1 (then DAT_00a0f45c). FUN_006dc358
// is `return 0`, so the result is 1 (DAT_00a0f45c is not read: unreachable).
export function tekkerItemGate(): number {
  return 1;
}

// The object's scale (FUN_006d9d94 at 0x006d3c24..0x006d3c3f).
export function tekkerItemScale(gate: number): number {
  return gate > TEKKER_ITEM_GATE_LIMIT ? TEKKER_ITEM_SCALE_SMALL : TEKKER_ITEM_SCALE_FULL;
}

// The fixed draw angle (FUN_00712658: ROUND(0x1000000 + -7.5), mod 0x10000),
// in BAMS. Round half to even, as the exe's FPU does by default (ASSUMED).
export function tekkerItemAngleBams(): number {
  const v = 0x1000000 - 7.5; // 16777208.5
  const lo = Math.floor(v);
  const r = v - lo === 0.5 ? (lo % 2 === 0 ? lo : lo + 1) : Math.round(v);
  return ((r % 0x10000) + 0x10000) % 0x10000;
}

// The weapon's archive keys, when the item is a weapon (data1[0] = 0):
// ItemPMT's weapon for data1[1] / data1[2], as the held weapon key (type, skin).
// Null for other kinds and for a weapon the table does not know.
export interface WeaponLookup {
  getWeapon(data1_1: number, data1_2: number): { type: number; skin: number } | undefined;
}

export function tekkerWeaponModel(data1: Uint8Array, pmt: WeaponLookup | null): { type: number; skin: number } | null {
  if (data1[0] !== 0 || !pmt) return null;
  const w = pmt.getWeapon(data1[1], data1[2]);
  return w ? { type: w.type, skin: w.skin } : null;
}

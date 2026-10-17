// Floor item models: which item.bml model a dropped item is drawn with.
//
// Decompiled from PsoBB.exe (Ephinea 1.25.13):
//   FUN_005d7ccc loads item.bml (data.gsl) through the asset loader
//     FUN_005b7a84 with the descriptor at 0x009c2794 {"item.bml", 14 models,
//     1 motion} into DAT_00a8da08. Entries by position:
//       0 gun_bullet.xj (its XVM holds every ixt_box* texture)  1 armor_scan.xj
//       2 ixm_box01 .. 7 ixm_box06, 8 ixm_box07_gift, 9 ixm_box08_xmas,
//       10 ixm_box09_egg, 11 ixm_box10_pumpkin, 12 ixm_box11_flower,
//       13 wxmR04_d_t_efect.xj, then the motion armor_scan.njm.
//   FUN_005d7a2c(kind): model = entry kind + 2 (FUN_005b8610), textures =
//     texture list 0 (FUN_005b8624(0)), i.e. gun_bullet's list.
//   Floor item object: ctor FUN_005c3a94 (vtable 0x00b0c020), item data
//     copied from the drop; +0xf5 = box kind, +0xf0 = present color,
//     +0xdc flags (0x100 kill counter, 0x400 wrapped).
//     - present color (+0xf0) = FUN_005d68b4: weapon data1[5] & 0xF,
//       armor/shield/unit data1[4] & 0xF, tool data1[3] & 0xF, else 0.
//     - kind (+0xf5): rare (FUN_005d6990: FUN_005d693c(item) >= 9) -> 4,
//       else the byte table 0x0092bb88[clamp(data1[0], 0, 4)] =
//       {0, 1, 1, 2, 3}: weapon box01, armor/shield/unit and mag box02,
//       tool box03, meseta box04. FUN_005d693c: weapons and armors use the
//       ItemPMT star count (FUN_005e5450, ids from 0xB1); tools count 12 when
//       their PMT flags have 0x80; mags 12 when data1[1] > 0x27 (the same
//       test as ItemNames.isRare).
//     - Tools (subclass ctor FUN_005de2d8, vtable 0x00b0dc40): when the
//       ItemPMT tool's `type` (ItemBase +4) is not 0 the kind becomes
//       type + 4 through the setter FUN_005c3e3c, which clamps kinds >= 11
//       to 2 (box03, present color 0) and sets the present color to 5 for
//       kind 7 (the Christmas present).
//     - Wrapped (FUN_005d281c: weapon/armor data1[4] & 0x40, tool data1[3] &
//       0x40 when not stackable, mag data2[2] & 0x40): flag 0x400.
//   Render FUN_005c407c (vtable +8 via FUN_005c4068, state 0 only): table
//     0x0092bac0 indexed by kind; flag 0x400 forces entry 6. Entries 0-4 and
//     8-10 (FUN_005c37c4) draw the kind's model; 5 (FUN_005c39a0) the same
//     with a texture scroll (FUN_005cb350(1, 1, 0xb), set up by
//     FUN_005cafb0); 6 and 7 (FUN_005c383c) draw entry 8 (the gift box)
//     whatever the kind, the root model with color 0x009c2000[color] and its
//     child (NJS_OBJECT +0x2c) with 0x009c2060[color] (FUN_0082d710 before
//     each FUN_008321d8).
//   Update FUN_005c3ed8 -> FUN_005c4010 (state 0, on the floor): Y angle
//     (+0x60) += 0x200 BAMS per frame. No bobbing and no extra glow pass
//     were found in the floor item code.

export const ITEM_BML = 'item.bml';
export const ITEM_BML_MODELS = 14; // descriptor 0x009c2794: 14 models, 1 motion
export const ITEM_KIND_COUNT = 11; // render table 0x0092bac0
export const ITEM_SPIN_BAMS_PER_FRAME = 0x200; // FUN_005c4010

// Box kinds (+0xf5).
export const KIND_WEAPON = 0;
export const KIND_EQUIP = 1;
export const KIND_TOOL = 2;
export const KIND_MESETA = 3;
export const KIND_RARE = 4;
export const KIND_GIFT = 6;
export const KIND_XMAS = 7;

// 0x0092bb88: box kind by data1[0] (clamped to 0..4).
export const KIND_BY_ITEM_CLASS = [0, 1, 1, 2, 3];

// Present colors as {a, r, g, b} floats: 0x009c2000 (box) and 0x009c2060 (ribbon).
export const PRESENT_BOX_COLORS: ReadonlyArray<[number, number, number]> = [
  [1, 1, 1],
  [1, 1, 0],
  [0.298039, 0.298039, 0.298039],
  [0, 0.698039, 1],
  [1, 0.4, 0.8],
  [1, 0, 0],
];
export const PRESENT_RIBBON_COLORS: ReadonlyArray<[number, number, number]> = [
  [1, 0, 0.4],
  [0, 0, 1],
  [1, 1, 0],
  [0.901961, 0.298039, 0],
  [0, 1, 0],
  [0, 1, 0],
];

// What the floor item code needs from ItemPMT / ItemNames.
export interface ItemModelTables {
  isRare(item: { data1: Uint8Array; id: number; data2: Uint8Array }): boolean;
  toolType(data1_1: number, data1_2: number): number | undefined;
}

export interface FloorItemLook {
  kind: number; // +0xf5
  model: number; // item.bml entry
  color: number; // present color (+0xf0)
  wrapped: boolean; // +0xdc & 0x400: drawn as the gift box
  scroll: boolean; // render entry 5: texture scroll
}

// FUN_005d68b4
export function presentColor(d: Uint8Array): number {
  if (d[0] === 0) return d[5] & 0xf;
  if (d[0] === 1) return d[4] & 0xf;
  if (d[0] === 3) return d[3] & 0xf;
  return 0;
}

// FUN_005d281c. Stackable tools are never wrapped (FUN_005d24b0).
export function isWrapped(item: { data1: Uint8Array; data2: Uint8Array }, stackable: boolean): boolean {
  const d = item.data1;
  if (d[0] < 2) return (d[4] & 0x40) !== 0;
  if (d[0] === 3) return !stackable && (d[3] & 0x40) !== 0;
  if (d[0] === 2) return (item.data2[2] & 0x40) !== 0;
  return false;
}

// FUN_005c3e3c: kinds >= 11 fall back to box03 with color 0; kind 7 forces color 5.
function setKind(look: FloorItemLook, kind: number): void {
  if (kind >= ITEM_KIND_COUNT) {
    look.kind = KIND_TOOL;
    look.color = 0;
  } else {
    look.kind = kind;
    if (kind === KIND_XMAS) look.color = 5;
  }
}

export function floorItemLook(item: { data1: Uint8Array; id: number; data2: Uint8Array }, tables: ItemModelTables | null, stackable: boolean): FloorItemLook {
  const d = item.data1;
  const look: FloorItemLook = { kind: 0, model: 0, color: presentColor(d), wrapped: isWrapped(item, stackable), scroll: false };
  if (tables?.isRare(item)) look.kind = KIND_RARE;
  else setKind(look, KIND_BY_ITEM_CLASS[Math.max(0, Math.min(4, d[0]))]);
  if (d[0] === 3 && tables) {
    const type = d[1] === 2 ? tables.toolType(2, d[4]) : tables.toolType(d[1], d[2]);
    if (type) setKind(look, (type + 4) & 0xff);
  }
  // Render table 0x0092bac0: wrapped items and kinds 6/7 draw the gift box.
  const gift = look.wrapped || look.kind === KIND_GIFT || look.kind === KIND_XMAS;
  look.model = gift ? KIND_GIFT + 2 : look.kind + 2;
  look.scroll = !gift && look.kind === 5;
  return look;
}

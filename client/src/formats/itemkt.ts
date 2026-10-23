// Item pictures (ItemKTep4.afs): which XVM entry the exe draws in the item
// picture window of the tekker's Result (window 0x32).
//
// Decompiled from PsoBB.exe (Ephinea 1.25.13), unknown_get_itemkt_image
// 0x005e5870 (the dump's name; the archive is loaded by load_itemkt_afs
// 0x005e5ad0 as "ItemKTep4.afs", handle 0xb8 in FUN_007081b4):
//   - data1[0] == 2 (tool): entry data1[1] when data1[1] < 0x52, else entry 0;
//   - data1[0] == 0 (weapon): the weapon's PMT record (FUN_005e5408(data1[1],
//     data1[2]), whose first dword is the item's name id, ItemBase.id), entry
//     id - 0x5f when id - 0xb1 < 0x1a6 (ITEM_STARS_FIRST_ID), else the
//     fallback entry 0x1f8;
//   - other kinds: no picture (the function returns 0).
// Each entry is an XVM ("XVMH") of textures; the picture is its first one.

export const ITEM_KT_FILE = 'ItemKTep4.afs';
export const ITEM_KT_FALLBACK = 0x1f8; // 504: FUN_005e5870's "no picture" entry
const ITEM_KT_WEAPON_BASE = 0x5f; // entry = name id - 0x5f
const ITEM_STARS_FIRST = 0xb1; // ItemStarsFirstID
const ITEM_KT_WEAPON_SPAN = 0x1a6; // FUN_005e5870's range test

// Entry of ItemKTep4.afs for an item, or null when the exe draws none.
// `weaponId` is the weapon's PMT name id (ItemPMT.getWeapon(data1[1],
// data1[2])?.id) for a weapon; undefined when the PMT has no such record.
export function itemPictureEntry(data1: Uint8Array, weaponId?: number): number | null {
  if (data1[0] === 2) return data1[1] < 0x52 ? data1[1] : 0;
  if (data1[0] !== 0) return null;
  if (weaponId === undefined) return ITEM_KT_FALLBACK;
  const d = weaponId - ITEM_STARS_FIRST;
  return d >= 0 && d < ITEM_KT_WEAPON_SPAN ? weaponId - ITEM_KT_WEAPON_BASE : ITEM_KT_FALLBACK;
}

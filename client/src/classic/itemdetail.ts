// The equipment stat panel and the mag rows of a selected item.
//
// Correction (2026-10-23, second pass): GUI entry 0xC (16, 172) is NOT the stat panel. Its
// element group is the item picture: ChallengePlayerListWindow_UpdateItemDetail_0073175c
// (state 2 / 8 of ChallengePlayerListWindow_HandleInput_007526c8) only calls
// unknown_get_itemkt_image(group, item) and sets the group's state byte (1 = picture, 2 = none).
// The stat rows and the pages are the elements of the GameList window itself (the list's
// CreateEquipListWindowObject_00725d18 with entry 9 in the mag window): the dispatcher
// GameList_RenderSelectionDisplay_00727450 is called with that window. The mag window is the
// mag menus' (menu ids 23 / 24 -> ChallengePlayerListWindow_Constructor_007525bc), NOT the
// Item Pack's (menu 11 -> GuildCardSearchWindow_Constructor_0075086c, a plain list window that
// creates neither entry 0xC nor a GameList). The Item Pack draws its description in
// ITEM_DETAIL (entry 2) only; itempack.ts keeps the panel off.
//
// Evidence (PsoBB.exe, Ephinea 1.25.13; the named dump's names are the
// community ones, the addresses are the exe's):
//   - the six stat labels are unitxt group 11: ATP 0x9c, DFP 0x9d, MST 0x9e,
//     ATA 0x9f, EVP 0xa0, LCK 0xa1 (EquipmentStatDisplayObject_SetStatLabels_
//     00726f38, in the order of the panel's six values).
//   - UpdateEquipmentStatDisplay_007258dc (0x007258dc): the current values are
//     ATP = base + variance + range min (battleparams), ATA = total_ata, DFP =
//     field_0x2d2, EVP = evp, MST and LCK = battleparams (set_current_equip_
//     value). The item values come from PlayerRecalculateStats_0068e030 (the
//     candidate, not equipped) or PlayerCalculateItemStats_0068e4e8 (the
//     equipped one), six shorts [ATP, DFP, MST, ATA, EVP, LCK].
//   - the rows are visible (flag 0x10, the colour) only when ValidateItemForEquip
//     is non-zero; otherwise the item values are drawn grey (0xff909090).
//   - the colour (UIElement_DisplayItemAttribute_0072d330): equal 0xffffffff,
//     lower 0xff77e8ff, higher 0xffdd8c41.
//   - what an item adds (ApplyEquipmentBonuses_005d330c): a weapon adds its
//     ATP range min += atp_min + 2 * grind (data1[3]), ATA += ata * 10 (plus
//     the ATA special, type 5 in data1[6..11]: value * 10) and MST += mst. The
//     armour and shield go through ApplyWeaponStats_005d4840 (their pmt struct
//     overlays the weapon's; the DFP / EVP use here are the item's dfp / evp,
//     ASSUMED from the names of the ItemPMT fields).
//   - the mag rows: RefreshItemStatDisplay_00726294 feeds Synchro and IQ and
//     DEF / POW / DEX / MIND as level (hundredths / 100) with the part as the
//     bar; the port's text is the level then the part as a decimal.
//
// ASSUMED (not decoded, kept simple):
//   - the current values come from the character file's displayed stats (the
//     exe's live battleparams / variance are not in the file); the candidate is
//     current + what the new item adds - what the equipped item of its slot
//     adds (the exe's PlayerRecalculateStats starts from the base and clamps
//     to the class maximum; the buff multipliers and the set / morning glory
//     bonuses are taken as 0 / 1);
//   - the armour's DFP / EVP variance (dfpRange / evpRange) and the unit slots
//     (units and tools add no row here);
//   - the panel's frame (height 132 = six rows of ROW + the inset, the width
//     240 like the description) and the row spacing;
//   - the mag's DEF / POW / DEX / MIND labels (plain text; no group 11 label
//     was found).
//
// The pages (the panel's kind per item and page) are at the end of this file. Correction
// (2026-10-23, second pass): the page byte is written ONLY by the mag window (see the pages
// section); a weapon, armour or shield is never shown in that window, so their attribute,
// resist and slot pages have no writer in this build (page 0 only). The shops and the bank
// list build the same GameList (page 0 = the stats) and never call the page writer.

import type { ItemData } from '../formats/itemnames.ts';
import { magStats } from '../formats/itemnames.ts';
import type { ItemPMT } from '../formats/itempmt.ts';
import type { WeaponRangeInput } from '../combat/playerstats.ts';

export const MAG_LEVEL_LABEL = 0xc0;
export const SYNCHRO_LABEL = 0xc1;
export const IQ_LABEL = 0xc2;
export const MAG_STAT_NAMES = ['DEF', 'POW', 'DEX', 'MIND'] as const; // ASSUMED plain text

// The panel's six rows, in the exe's order (labels 0x9c..0xa1).
export const EQUIP_STAT_ROWS = [
  { key: 'atp', label: 0x9c },
  { key: 'dfp', label: 0x9d },
  { key: 'mst', label: 0x9e },
  { key: 'ata', label: 0x9f },
  { key: 'evp', label: 0xa0 },
  { key: 'lck', label: 0xa1 },
] as const;
export type EquipStatKey = (typeof EQUIP_STAT_ROWS)[number]['key'];
export type StatBlock = Record<EquipStatKey, number>;

// ItemStatDisplayObject / UIElement_DisplayItemAttribute colours.
export const VALUE_COLOR = {
  same: '#ffffff', // 0xffffffff
  lower: '#77e8ff', // 0xff77e8ff
  higher: '#dd8c41', // 0xffdd8c41
  none: '#909090', // 0xff909090
} as const;

// The stat panel's window (ASSUMED position: the 0xC position below is the item picture of the
// mag window, see the header correction; the stats of a list are the list's own elements, and
// the Check Room / shop windows place theirs in their own rect). The height 132 is the exe's base: the
// stats-only case of EquipmentStatDisplayObject_Update_00727220 / _00727078 sets it with
// UIElement_SetPositionAndSize_0072e7e4(panel, 0, 132); the requirement rows grow it to
// 172 / 192 / 212 / 232 (not ported: the rows went with the pages). The width 240 is ASSUMED
// (the exe's calls leave the width to the element table, 0x00973e24, not decoded). In the
// mag menu the panel's bottom (304) overlaps that window's weapon list (entry 7 at (13, 256),
// 206 x 184, open height 188 by ListWindowObject_FinishRenderPositionUpdate 0x433c0000: the
// height, not y). The draw order of the two there is UNCLEAR.
export const EQUIP_PANEL = { x: 16, y: 172, w: 240, h: 132 } as const;

// What an item adds to the six stats (ApplyEquipmentBonuses_005d330c, see the
// header). Units, tools and mags add nothing here.
export function equipContribution(item: ItemData, pmt: ItemPMT): Partial<StatBlock> {
  const d = item.data1;
  if (d[0] === 0) {
    const w = pmt.getWeapon(d[1], d[2]);
    if (!w) return {};
    let ata = w.ata * 10;
    for (let i = 0; i < 3; i++) if (d[6 + 2 * i] === 5) ata += d[7 + 2 * i] * 10; // ATA special
    return { atp: w.atpMin + 2 * d[3], mst: w.mst, ata };
  }
  if (d[0] === 1 && (d[1] === 1 || d[1] === 2)) {
    const a = (d[1] === 1 ? pmt.armors : pmt.shields)[d[2]];
    if (!a) return {};
    return { dfp: a.dfp, evp: a.evp };
  }
  return {};
}

// Whether an item gets the panel (weapon, armour, shield).
export function hasEquipPanel(item: ItemData): boolean {
  const d = item.data1;
  return d[0] === 0 || (d[0] === 1 && (d[1] === 1 || d[1] === 2));
}

// The candidate's stats: the current ones, plus what the candidate adds and
// minus what the equipped item of its slot adds (ASSUMED model, see header).
export function candidateStats(current: StatBlock, add: Partial<StatBlock>, remove: Partial<StatBlock>): StatBlock {
  const out = { ...current };
  for (const { key } of EQUIP_STAT_ROWS) out[key] = current[key] + (add[key] ?? 0) - (remove[key] ?? 0);
  return out;
}

// The colour of a candidate value against the current one.
export function compareColor(item: number, current: number): string {
  if (item === current) return VALUE_COLOR.same;
  return item < current ? VALUE_COLOR.lower : VALUE_COLOR.higher;
}

export interface EquipStatRow {
  key: EquipStatKey;
  label: number;
  current: number;
  item: number; // the candidate's value (the equipped item shows its own)
  color: string;
}

// The weapon's range input (atp min / max + grind) for playerstats, or null for a non-weapon.
export function weaponRange(item: ItemData, pmt: ItemPMT): WeaponRangeInput | null {
  const d = item.data1;
  if (d[0] !== 0) return null;
  const w = pmt.getWeapon(d[1], d[2]);
  return w ? { atpMin: w.atpMin, atpMax: w.atpMax, grind: d[3] } : null;
}

// The panel rows for the cursor item. `equipped` is the item already in its
// slot (no delta); `old` is the item in that slot when the candidate is not
// equipped; `equippable` is ValidateItemForEquip's answer (not equippable =
// grey candidate values).
export function equipStatRows(
  current: StatBlock,
  item: ItemData,
  old: ItemData | null,
  pmt: ItemPMT,
  equipped: boolean,
  equippable: boolean,
): EquipStatRow[] {
  const cand = equipped
    ? current
    : candidateStats(current, equipContribution(item, pmt), old ? equipContribution(old, pmt) : {});
  // The Item Pack detail (ChallengePlayerListWindow_UpdateItemDetail_0073175c, dump 698949) does
  // not call PlayerRecalculateStats_0068e030, so this panel keeps the item-only delta; the quick
  // menu compare list uses combat/playerstats.ts (recalculateCandidate / equippedCandidate).
  return EQUIP_STAT_ROWS.map(({ key, label }) => {
    const cur = current[key];
    const it = cand[key];
    const color = equippable ? compareColor(it, cur) : VALUE_COLOR.none;
    return { key, label, current: cur, item: it, color };
  });
}

// The compare list's rows (quick menu, UpdateEquipmentStatDisplay_007258dc): the current
// values against the candidate values the exe computes (combat/playerstats.ts). Grey
// candidates when the item is not equippable (ValidateItemForEquip).
export function compareStatRows(current: StatBlock, cand: StatBlock, equippable: boolean): EquipStatRow[] {
  return EQUIP_STAT_ROWS.map(({ key, label }) => {
    const cur = current[key];
    const it = cand[key];
    const color = equippable ? compareColor(it, cur) : VALUE_COLOR.none;
    return { key, label, current: cur, item: it, color };
  });
}

// --- mags -----------------------------------------------------------------

// The stat text of a mag value in hundredths: level, then the part as a
// decimal ("3", "3.5", "3.05"), the port's own rule (itemnames.ts).
export function magStatText(v: number): string {
  const level = Math.floor(v / 100);
  const part = v % 100;
  if (part === 0) return `${level}`;
  if (part % 10 === 0) return `${level}.${part / 10}`;
  return `${level}.${String(part).padStart(2, '0')}`;
}

export interface MagRows {
  level: number;
  synchro: string; // "28%"
  iq: string;
  stats: Array<{ name: string; text: string; bar: number }>; // bar = part of the level, 0..99
}

export function magRows(item: ItemData): MagRows {
  const m = magStats(item);
  const raw = [m.def, m.pow, m.dex, m.mind];
  return {
    level: m.level,
    synchro: `${m.synchro}%`,
    iq: `${m.iq}`,
    stats: MAG_STAT_NAMES.map((name, i) => ({ name, text: magStatText(raw[i]), bar: raw[i] % 100 })),
  };
}

// --- The list's pages (the GameList window's dispatch; reached in this build only by the mag window) ---
//
// The attribute page's function is 0x726dc8, and
// 0x726ee2 is not a start: Ghidra and the dump (ItemAttributesPanel_Update_00726ee2) are the
// same body, the dump split it. The dispatcher is GameList_RenderSelectionDisplay_00727450
// (dump 690228 area), called from the list's selection changes. It picks a table by the
// item's kind (data1[0]; data1[1] for armour / shield) and calls entry [page] of that table:
//   table DAT_009f2520 (weapon):          [0x727220 stats, 0x726dc8 attributes, 0x726780 info]
//   table DAT_009f252c (shield, sub 2):   [0x727078 stats, 0x726c7c resist,     0x726780 info]
//   table DAT_009f2538 (armour, sub 1):   [0x727078 stats, 0x726cb0 resist+slot, 0x726780 info]
//   unit (sub 3):                         0x726780 directly (all pages)
//   table DAT_009f2544 (mag):             [0x726ff0 stats, 0x726864 mag status, 0x7267dc photon]
//   tool: 0x726608 / 0x7265f0 (not decoded)
// The page is the byte at the list's navigation object (this+0x64, read as `**(byte **)`).
// Its writer is UpdateListNavigationDirection_0073e954, the only caller of which is
// HandleGameListNavigation_007260e8 (exe.s: one call site), and that has two callers, both in
// the mag window's HandleInput: state 5 (the Select window's "Give Items", value 1 ->
// ChallengePlayerListWindowSetActionState_00752fe0; direction 1 -> page 1) and state 0xC (a
// photon blast gained after the feed, direction 2 -> page 2). The byte is set absolutely (not a
// step, no clamp): the same direction again changes nothing. The Cancel key (g_KeyboardSharedState
// [0xd]) in state 7 goes to state 5 again (page 1 again). The navigation object is built by
// CreateEquipListWindowObject_00725d18 with page 0 (ChatShortcutMenu_SubList_SetData_0073e5d4(obj,
// 0, 3, slot): the count 3 is the page count).
// The keys (2026-10-23, third pass): the GameList's vtable slot 1 is ChatShortcutMenu_Update_00725e4c
// (the vtable 0x00b3fff0 is shared by every GameList of CreateEquipListWindowObject_00725d18); when
// the list shows an item (flag 4 clear) it calls ChatShortcutMenu_HandleInput_0073e60c on the
// navigation object: g_KeyboardSharedState[0x11] goes up one page (slide +10, 0x41200000), [0x10]
// down one (slide -10, 0xc1200000), both wrapping over 3, SE 0x56f, and a change re-renders the page
// (GameList_RenderSelectionDisplay). The slide decays by 0.85 a tick (ChatShortcutMenu_UpdatePosition
// _0073e5f8, factor 0x00971eec = -0.15). The key of each slot is ASSUMED (ArrowRight / ArrowLeft).
// The slide's drawn axis is ASSUMED (horizontal, magmenu.ts drawStatus). The other GameLists built by
// the same constructor (the shops, the bank: ASSUMED, not checked one by one) would take the same keys
// on their weapon / armour pages; those pages are not ported in those windows.
// Each table is 4-byte entries: the call is `*(DAT_xxx + page * 4)`.

export type PanelKind =
  | 'weaponStats'
  | 'weaponAttributes'
  | 'shieldResist'
  | 'armourResist'
  | 'stats'
  | 'magStats'
  | 'magStatus'
  | 'magPhoton'
  | 'info'
  | 'none';

// The exe's kind for (data1[0], data1[1]) on a page; `null` for a page the table does not have.
export function panelKind(data1: Uint8Array, page: number): PanelKind | null {
  if (page < 0 || page > 2) return null;
  const type = data1[0];
  const sub = data1[1];
  const pick = (kinds: readonly PanelKind[]) => kinds[page];
  if (type === 0) return pick(['weaponStats', 'weaponAttributes', 'info']);
  if (type === 1) {
    if (sub === 3) return 'info';
    if (sub === 2) return pick(['stats', 'shieldResist', 'info']);
    return pick(['stats', 'armourResist', 'info']);
  }
  if (type === 2) return pick(['magStats', 'magStatus', 'magPhoton']);
  return 'none';
}

// The Attributes page (0x726dc8 / 0x726cf0): labels unitxt group 11 0xb5..0xb9, in the
// order of the element pairs (type 1 Native .. type 5 Hit). The item's pairs are data1[6..11]
// (type, value), three of them. The character's own values come from GetItemTechBoostAddress_
// 00770d6c(player, 0), not in the web client: ASSUMED 0. An equipped item's candidate is 0
// (the exe passes no pairs then), otherwise the candidate's pair value. The row's colour is
// grey (flag 0x10 is not set by this page). The fifth row (Hit) is not cleared by the exe's
// first pass (only the first four are): ASSUMED 0 here.
export const ATTRIBUTE_LABELS = [0xb5, 0xb6, 0xb7, 0xb8, 0xb9] as const;
export interface AttributeRow {
  label: number;
  current: number;
  candidate: number;
  color: string;
}
export function attributeRows(data1: Uint8Array, equipped: boolean): AttributeRow[] {
  const cand = [0, 0, 0, 0, 0];
  if (!equipped) {
    for (let i = 0; i < 3; i++) {
      const type = data1[6 + i * 2];
      if (type >= 1 && type <= 5) cand[type - 1] = data1[7 + i * 2];
    }
  }
  return ATTRIBUTE_LABELS.map((label, i) => ({ label, current: 0, candidate: cand[i], color: VALUE_COLOR.none }));
}

// The shield / armour resist page (0x726aa8 via 0x726c7c / 0x726cb0): unitxt group 11
// 0xa2..0xa6 = EFR, EIC, ETH, EDK, ELT. The current values are the player's efr..elt (not in
// the web client: ASSUMED 0). The candidate comes from PlayerRecalculateStats_0068e030's out
// array [6..10] (not decoded here: ASSUMED no candidate). The exe's candidate order is
// EFR <- [6], EIC <- [7], ETH <- [8], EDK <- [10], ELT <- [9] (dump 690776..690780).
export const RESIST_LABELS = [0xa2, 0xa3, 0xa4, 0xa5, 0xa6] as const;
// The armour's Slot line (0x726cb0): label 0xbf, value data1[5] (the slot count).
export const SLOT_LABEL = 0xbf;
export function slotValue(data1: Uint8Array): number {
  return data1[5];
}

// --- the mag window's pages (ported 2026-10-23) ---
//
// The mag window's panel page (its GameList's navigation byte, see the pages section): page 0
// when the window opens, page 1 when Give Items opens the item list (state 5), page 2 when the
// feed gains a photon blast (state 0xC). The page never goes back to 0 while the window is open.
export const MAG_PAGE = { stats: 0, status: 1, photon: 2 } as const;

// Page 0 (0x726ff0 EquipmentStatDisplayObject_Initialize): the six stat labels (group 11
// 0x9c..0xa1) with the character's current values, in the exe's order. The candidate arrow is not
// drawn: a mag is not equippable, so the exe hides the candidate values (ItemStatDisplayObject_
// SetVisible 0, ASSUMED from ValidateItemForEquip's answer for a mag).
export function magStatRows(current: StatBlock): Array<{ label: number; value: number }> {
  return EQUIP_STAT_ROWS.map(({ key, label }) => ({ label, value: current[key] }));
}

// Page 2 (0x7267dc): three photon blast rows, the mag's blasts in slot order; a slot without a
// blast is an empty row (ASSUMED: the exe writes its empty-slot text, not decoded).
export function magPhotonRows(blasts: readonly number[]): Array<number | null> {
  return [0, 1, 2].map((i) => (i < blasts.length ? blasts[i] : null));
}

// --- the mag window's element offsets and the photon rows (2026-10-23, third pass) ---
//
// The GameList's element table (this+0x28, pointers at 4-byte steps) is shared by the pages: each
// page writes its own elements. Page 1 (0x726864) and page 2 (0x7267dc) use these indices:
//   page 1: [0] Level (text 0xc0, value), [1] Synchro (text 0xc1, value), [2] IQ (text 0xc2,
//           value); the four stats DEF, POW, DEX, MIND, each as three elements: [3] / [6] / [9] /
//           [12] are cleared by 0x72e0e4 (ASSUMED: the bar's reset), [4] / [7] / [10] / [13] take the
//           level as an int at +0x20, [5] / [8] / [11] / [14] take the part (0..99) as a float at
//           +0x24 and their update (vtable +0xc). The stat values are the mag's shorts at data1
//           +4 / +6 / +8 / +0xa (the exe's 0x4(%esp).. of the item's mag struct), /100 and %100.
//           [15] (+0x3c) is centred: its y is -0.5 * its height (0x970740) plus 0x970744.
//   page 2: the photon rows are [1], [2], [3] (0x7267dc: `pushl 0x4(%ecx,%ebx,4)`, ebx = the row).
//   The photon highlight of the cursor row (the list of entry 0xA, see the photon window below) uses
//   the offsets table 0x00973e88 = bytes [3, 1, 2]: the cursor row 0 is element [3], row 1 is [1],
//   row 2 is [2] (ASSUMED that the row's text sits at the element's position).
export const MAG_ELEMENT = {
  level: 0,
  synchro: 1,
  iq: 2,
  stats: [
    { reset: 3, level: 4, bar: 5 }, // DEF
    { reset: 6, level: 7, bar: 8 }, // POW
    { reset: 9, level: 10, bar: 11 }, // DEX
    { reset: 12, level: 13, bar: 14 }, // MIND
  ],
  centre: 15,
  photonRows: [1, 2, 3],
  photonHighlight: [3, 1, 2],
} as const;

// The mag's photon rows (0x7267dc) call SinowberillChallengeObject_UpdateItemUI_0070ff48(element,
// type, index): type 0 = a blank row (the element kind 7, default UVs from 0x96f59c / 0x96f5a0), type
// 5 = the photon blast's picture (kind 5, the UV pair from table 0x009f1600 at the blast index). So an
// empty row is NOT text: it is `(element, 0, 0)`. The picture is palette.ts photonPictureUv on texture 5
// (magmenu.ts drawPhotonList); the blast name is only the fallback when no texture is given.
export function photonRowArgs(blast: number | null): readonly [number, number] {
  return blast === null ? [0, 0] : [5, blast];
}

// The photon blast's description: unitxt group 7 at index blast + 0x27 (unitxt_get_action_description,
// the photon window's info, ChallengePlayerListWindowUpdateDescriptionText_007531f4). An empty row
// shows the empty string (flag -1).
export const PHOTON_DESCRIPTION_BASE = 0x27;
export function photonDescriptionIndex(blast: number | null): number | null {
  return blast === null ? null : blast + PHOTON_DESCRIPTION_BASE;
}

// The page keys: the GameList's navigation (ChatShortcutMenu_HandleInput_0073e60c, 0x73e60c) reads
// g_KeyboardSharedState[0x11] (+1, slide +10) and [0x10] (-1, slide -10) every frame while the list
// shows an item, wrapping over the page count (3). The key of each slot is ASSUMED (ArrowRight /
// ArrowLeft, see the DEVLOG 2026-10-23 mag pages). `nextPage` is that wrap.
export const PAGE_COUNT = 3;
export function nextPage(page: number, step: 1 | -1): number {
  const p = page + step;
  if (p < 0) return p + PAGE_COUNT;
  return p >= PAGE_COUNT ? p - PAGE_COUNT : p;
}
// The slide the page change starts with (UpdateListNavigationDirection_0073e954 / HandleInput:
// +10.0 0x41200000 going up, -10.0 0xc1200000 going down) and its per-tick decay (the factor 0.85:
// the constant 0x00971eec = -0.15 in ChatShortcutMenu_UpdatePosition_0073e5f8, ASSUMED to run each
// tick).
export const PAGE_SLIDE = 10;
export const PAGE_SLIDE_DECAY = 0.85;
export function pageSlideAfter(slide: number): number {
  return slide * PAGE_SLIDE_DECAY;
}

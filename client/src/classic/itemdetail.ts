// The equipment stat panel and the mag rows of a selected item. The panel is the element
// group at GUI table entry 0xC (16, 172), the one ChallengePlayerListWindow_HandleInput_
// 007526c8 fills (state 2 / 8: ChallengePlayerListWindow_UpdateItemDetail_0073175c, and the
// mag's RefreshItemStatDisplay_00726294 in state 8). That window is the mag menus' (menu ids
// 23 / 24 -> ChallengePlayerListWindow_Constructor_007525bc), NOT the Item Pack's (menu 11 ->
// GuildCardSearchWindow_Constructor_0075086c, which never creates entry 0xC). The Item Pack
// draws its description in ITEM_DETAIL (entry 2) only; itempack.ts keeps the panel off.
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
// The pages (the panel's kind per item and page) are at the end of this file. The earlier
// note that the pages had no evidence was wrong: the page byte is set by the state machine
// (states 5 and 0xC), not by Left / Right keys, which ChallengePlayerListWindow_HandleInput_
// 007526c8 does not read.

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

// The panel's window: GUI entry 0xC (16, 172) (get_gui_position(0xc), state 0/1 of
// ChallengePlayerListWindow_HandleInput_007526c8). The height 132 is the exe's base: the
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

// --- The panel's pages (GUI 0xC, ChallengePlayerListWindow family) ---
//
// Correction (2026-10-23): the attribute page is reachable. Its function is 0x726dc8, and
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
// The page is the byte at the list's navigation object (this+0x64, read as `**(byte **)`),
// written only by UpdateListNavigationDirection_0073e954 through HandleGameListNavigation_
// 007260e8, which has two callers in ChallengePlayerListWindow_HandleInput_007526c8: state 5
// (opens the item list, direction 1 -> page 1) and state 0xC (a photon blast gained,
// direction 2 -> page 2). No Left / Right key calls it (the key handler's only use of the
// navigation object is the state change). ASSUMED: the page resets to 0 only when the window
// is built (the constructor was not traced). The sub-page direction also runs a slide (+10 / -10
// in the object's +8 field), not ported.
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

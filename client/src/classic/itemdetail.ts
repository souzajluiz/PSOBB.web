// Item Pack > Items: the item detail pages of equipment and mags (the item
// description window at ITEM_DETAIL, entry 2 = (324, 256) 240 x 184).
//
// Evidence (PsoBB.exe, Ephinea 1.25.13; the named dump's names are the
// community ones, the addresses are the exe's):
//   - the stat labels are unitxt group 11: ATP 0x9c, DFP 0x9d, MST 0x9e,
//     ATA 0x9f, EVP 0xa0, LCK 0xa1 (EquipmentStatDisplayObject_SetStatLabels_
//     00726f38); EFR..ELT 0xa2..0xa6; Native 0xb5, A.Beast 0xb6, Machine 0xb7,
//     Dark 0xb8, Hit 0xb9 (ItemAttributesPanel_Update_00726ee2); Slot 0xbf,
//     Level 0xc0, Synchro 0xc1, IQ 0xc2, "Attribute:" 0xc3.
//   - ItemAttributesPanel_Update_00726ee2 sets the label of each attribute
//     row, then the character's own values (GetItemTechBoostAddress 0x00770d6c,
//     the 5 types) and, unless the item is the equipped one, the candidate
//     item's pairs from data1[6..11] (type, value) x 3; every row gets 0 first,
//     so all five show an item value. Type 1..5 = Native..Hit (the row order).
//   - UIElement_DisplayItemAttribute_0072d330 draws "label:" at the left, the
//     current value right-aligned with "%" (flag 0x20, set on all five), then
//     when the item value is shown "→" and the item value. Its colour: equal
//     white 0xffffffff, lower 0xff77e8ff, higher 0xffdd8c41, and 0xff909090
//     unless flag 0x10 is set (no attribute row sets it, so they stay grey).
//     The numbers are plain decimal (append_number_to_wstrcat_buffer).
//   - Requirements: the weapon's ATP / MST / ATA (ItemPMT 0x12 / 0x14 / 0x16)
//     with the same labels, armour and shield Level = requiredLevel + 1
//     (the port's equipProblems rule; the exe's EquipmentStatDisplayObject_
//     Update_00727078 reads the mst_req byte path for the same row).
//   - Mags: RefreshItemStatDisplay_00726294 feeds the Synchro and IQ values
//     and DEF / POW / DEX / MIND as level (hundredths / 100) with the part
//     (hundredths % 100) as the bar; a level above the shown one is a full bar
//     (0x42c80000 = 100.0). ItemStatDisplayObject_SetAnimatedValue_0072d420
//     colours a changed value like the attributes.
//
// ASSUMED (not decoded, kept simple):
//   - the page order (info, requirements, attributes; mags: info, mag) and the
//     page keys (Left / Right, wrapping; the cursor move resets to the info
//     page); the exe's page switching is in ChallengePlayerListWindow_
//     HandleInput_007526c8 and was not traced;
//   - the row positions (INSET, ROW) and the spacing between the label and the
//     value (the exe's g_ItemAttributeColonSpacingConstant etc. are not read);
//   - the mag's DEF / POW / DEX / MIND labels (no unitxt label was found in
//     group 11; they are plain text here) and the PB names (the short names of
//     itemnames.ts);
//   - requirement rows that are not met are drawn in the cannot-equip grey.
//
// Not ported here: the equipment stat panel (ATP / DFP / MST / ATA / EVP / LCK
// with the item's deltas, UpdateEquipmentStatDisplay_007258dc) and the mag
// bar animation.

import type { ItemData } from '../formats/itemnames.ts';
import { magStats } from '../formats/itemnames.ts';
import type { ItemPMT } from '../formats/itempmt.ts';

export const ATTRIBUTE_LABELS = [0xb5, 0xb6, 0xb7, 0xb8, 0xb9] as const; // Native A.Beast Machine Dark Hit
export const ATTRIBUTE_HEADING = 0xc3; // "Attribute:"
export const REQUIREMENT_LABELS = { atp: 0x9c, mst: 0x9e, ata: 0x9f } as const; // ATP / MST / ATA
export const LEVEL_LABEL = 0xc0;
export const SYNCHRO_LABEL = 0xc1;
export const IQ_LABEL = 0xc2;
export const MAG_STAT_NAMES = ['DEF', 'POW', 'DEX', 'MIND'] as const; // ASSUMED plain text

// ItemStatDisplayObject / UIElement_DisplayItemAttribute colours.
export const VALUE_COLOR = {
  same: '#ffffff', // 0xffffffff
  lower: '#77e8ff', // 0xff77e8ff
  higher: '#dd8c41', // 0xffdd8c41
  none: '#909090', // 0xff909090
} as const;

export type DetailPage = 'info' | 'requirements' | 'attributes' | 'mag';

// Pages of an item (ASSUMED order). data1[0]: 0 weapon, 1 armour / shield /
// unit, 2 mag, 3 tool.
export function detailPages(item: ItemData): DetailPage[] {
  const d = item.data1;
  if (d[0] === 2) return ['info', 'mag'];
  if (d[0] === 0 || (d[0] === 1 && (d[1] === 1 || d[1] === 2))) return ['info', 'requirements', 'attributes'];
  return ['info'];
}

// --- requirements ---------------------------------------------------------

export interface RequirementRow {
  label: number; // unitxt group 11 index
  value: number;
  unmet: boolean;
}

export interface Stats {
  atp: number;
  ata: number;
  mst: number;
  level: number; // displayed level (1-based)
}

// The requirement rows of a weapon (ATP, MST, ATA) or of an armour / shield
// (Level). Other items have none.
export function requirementRows(item: ItemData, pmt: ItemPMT, stats: Stats): RequirementRow[] {
  const d = item.data1;
  if (d[0] === 0) {
    const w = pmt.getWeapon(d[1], d[2]);
    if (!w) return [];
    return [
      { label: REQUIREMENT_LABELS.atp, value: w.atpRequired, unmet: stats.atp < w.atpRequired },
      { label: REQUIREMENT_LABELS.mst, value: w.mstRequired, unmet: stats.mst < w.mstRequired },
      { label: REQUIREMENT_LABELS.ata, value: w.ataRequired, unmet: stats.ata < w.ataRequired },
    ];
  }
  if (d[0] === 1 && (d[1] === 1 || d[1] === 2)) {
    const a = (d[1] === 1 ? pmt.armors : pmt.shields)[d[2]];
    if (!a) return [];
    const need = a.requiredLevel + 1;
    return [{ label: LEVEL_LABEL, value: need, unmet: stats.level < need }];
  }
  return [];
}

// --- attributes -----------------------------------------------------------

export interface AttributeRow {
  label: number;
  current: number; // the character's value
  item: number | null; // the candidate item's value (null: not shown)
  color: string; // colour of the item value
}

// `current` holds the character's values for types 1..5 (Native..Hit).
export function attributeRows(item: ItemData, current: readonly number[], equipped: boolean): AttributeRow[] {
  const d = item.data1;
  const bonus: Array<number | null> = [null, null, null, null, null];
  if (!equipped) {
    // The candidate's values: every row starts at 0, the pairs at data1[6..11].
    bonus.fill(0);
    for (let i = 0; i < 3; i++) {
      const type = d[6 + 2 * i];
      if (type >= 1 && type <= 5) bonus[type - 1] = d[7 + 2 * i];
    }
  }
  return ATTRIBUTE_LABELS.map((label, i) => {
    const cur = current[i] ?? 0;
    const it = bonus[i];
    let color: string = VALUE_COLOR.none;
    if (it !== null) color = it === cur ? VALUE_COLOR.same : it < cur ? VALUE_COLOR.lower : VALUE_COLOR.higher;
    return { label, current: cur, item: it, color };
  });
}

// "12%" (the row's value text; the item value follows an arrow).
export function attributeText(n: number): string {
  return `${n}%`;
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
  photonBlasts: Array<number | null>;
}

export function magRows(item: ItemData): MagRows {
  const m = magStats(item);
  const raw = [m.def, m.pow, m.dex, m.mind];
  return {
    level: m.level,
    synchro: `${m.synchro}%`,
    iq: `${m.iq}`,
    stats: MAG_STAT_NAMES.map((name, i) => ({ name, text: magStatText(raw[i]), bar: raw[i] % 100 })),
    photonBlasts: m.photonBlasts,
  };
}

// --- page switching -------------------------------------------------------

// Left / Right move through the item's pages (wrapping); the caller resets
// the page when the cursor moves (ASSUMED).
export function nextPage(page: number, count: number, key: string): number {
  if (count <= 1) return 0;
  if (key === 'ArrowRight') return (page + 1) % count;
  if (key === 'ArrowLeft') return (page + count - 1) % count;
  return page;
}

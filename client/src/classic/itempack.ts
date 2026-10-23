// Item Pack > Items: the item list, the item's description, the "Purpose"
// action window and the "Amount" window, as PsoBB.exe (Ephinea 1.25.13) runs
// them (main menu id 0xB, handle_player_menu_select ->
// GuildCardSearchWindow_Constructor_0075086c; state machine
// ChallengePlayer_StateMachine_00750954).
//
// Windows (position table 0x00971f40):
//   - Item List: entry 3 = (13, 256), 308 x 184 (0x00973ca0), 0x24 rows
//     (ChallengePlayer_CreateGuildCardSearchWindow_0075198c), title unitxt
//     group 11 [0x37]; the number of items "n/30" in a teal pill at
//     (x + 158, y - 13) with its middle 80 - 60 = 20 wide, the text centred
//     50 px right of the pill's left and 4 px down
//     (ListWindowObject_RenderItemText_007367d0: 0x00971598, 0x00971594,
//     0x0097158c, 0x00971588; RenderTextCharacter_00760b74 -60.0, state 0).
//   - the description: entry 2 = (324, 256), 240 x 184 (0x009f2b58)
//     (CreateEquipListWindowObject_00725d18), open while the list is browsed
//     and closed when an action window opens (states 2 / 3).
//   - Purpose: entry 4 = (324, 256), 224 wide (0x43600000), title [0x39]
//     (ChallengePlayer_CreateSelectionListWindow_00751284).
//   - Amount: entry 5 = (324, 318), 224 x (74 + 6) (0x009f2c48, title [0x3B]
//     adds 6, CreateChatShortcutMenuTitleWindow_00729630), a digit spinner
//     (CreateNumericDisplayListWindow_00728ac4): min 1, max the stack size,
//     starts at 1; Up / Down add / subtract 10^digit and wrap to the other end
//     (0x00728f58 / 0x007290f0, steps 0x00970a00), Left / Right move the digit
//     (0x00729288 / 0x007292d0), Enter accepts when in range (SE 0x570, else
//     0x575). The digits are the texturejapanese.xvm font, 12 px apart, centred:
//     x = digits * 12 / 2 + (224 - 20) / 2 - 6 - k * 12 for digit k
//     (ListWindowObject_UpdateItemListRenderPositions_007296e4, 0x00970974..80),
//     at y = 18 (element table 0x009f2c24), with the green arrows of
//     f256_hyouji.prs texture 0 at (224, 0) 14 x 12 above (y - 15) and below
//     (y + 25, texels v + 28..40) the current digit
//     (SinowberillUIElementListWindow_RenderScrollbar_007293e0).
//   - Sort: entry 6 = (324, 318), title [0x3A], "Automatically" / "Manually"
//     ([0x70] / [0x71]).
// While an action window is up the list shrinks to the chosen row: height
// = 20 + 14 + 6 (ListWindowObject_AdjustSelectedLinePosition_0073600c,
// 0x0097143c / 0x00971438).
//
// Rows (InitializeItemObject_0072bdd4, drawn by BaseEntity_Render_0072ae74):
// two 18 x 18 icons from f256_hyouji.prs texture 1 (texel origin table
// 0x00970b40, 8 bytes per icon, 0x36 = none) then the item name in the row
// colour, and "×n" for stackable items right-aligned at the row's right edge
// (append_stackable_quantity_wstr, L"×" at 0x00970cf0). Meseta is a last row
// with icon 9 and "<n>Meseta" (UIElementSetIntText_0072c61c, unitxt group 12
// [0]); an empty pack shows "No Item" ([0xEE]) in 0xff909090.
//   icon 2 by type (UIElement_SetItemAnimationState_0072b9d0): weapons by
//     their kind (PMT weapon class -> 0x0092c360: 1 sword 0, 2 cane 2, 3 gun
//     1), frame 0xB, shield 0xA, unit 4, mag 3, mate 5, fluid 7, disk 6,
//     other tools 8, meseta 9, wrapped 8;
//   icon 1 and colours (ItemEntity_UpdateColoring_0072c045): equipped 0xC,
//     undroppable 0x2A / 0x2B (equipped), an untekked rare 0x19, a class that
//     cannot use it 0x13; an untekked weapon is 0xff00fffc, one the character
//     cannot equip 0xff909090 (icon 0xffaaaaaa), an S-rank 0xfffe3c28, a rare
//     (more than 8 stars) 0xffffea00, one with bonuses (attributes, slots,
//     +DFP/EVP, unit modifier, the ten-stat mags) 0xff61e853
//     (IsValidItemColoringData_005d325c), else white.
// Names (get_item_name 0x005d2aac): "%s" (0x0092c4cc), with grind "%s +%d"
// (0x0092c4d4), with a special "%s %s" / "%s %s +%d" (0x0092c4f8 /
// 0x0092c4e4), technique disks "%s%s Lv.%d" (0x0092c518, English locale) or
// "%s%s" for Ryuker / Reverser (0x00909e1c), units "%s%s" with their +/-
// modifier, wrapped items unitxt [0x78], untekked rares [0x19B].
// Descriptions (GetItemDescription_005d3078): unitxt group 3 [PMT id]
// (untekked rares [0x19B], units with "%d" filled with the unit's amount +
// modifier); meseta: group 11 [0x135].
//
// Purpose items (ChallengePlayer_AddNormalItemList_00751324), values:
// 0 Use ([0x73], usable items), 1 Equip ([0x75]) / 2 Remove ([0x74]) for
// equipment, 3 Drop ([0x72]), 7 Sort ([0x76]); in the lobby all but Equip /
// Remove's checks are disabled. Meseta has only 6 Drop. Use / Equip / Remove
// act at once (ChallengePlayer_HandleItemAndArmor_007515c4); Drop asks the
// amount when the stack holds more than one (state 0xC), meseta likewise
// (state 0x13).

import { menuKeyOf } from '../input/keyconfig.ts';
import { se, SE } from '../audio/se.ts';
import type { CharacterFile, InventoryItem } from '../net/charfile.ts';
import { MESETA_ITEM_ID, isEquippable, stackSize } from '../net/items.ts';
import { isSRankWeapon, maxStackSize, type ItemData, type ItemNames } from '../formats/itemnames.ts';
import { SPECIAL_STARS_BEGIN_INDEX } from '../formats/itempmt.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { DISABLED, drawListWindow, drawPill, drawTextWindow, drawWindowTitle, INSET, listKey, listWindowHeight, ROW, TITLE_GAP, type ListItem } from './fieldwindows.ts';
import { drawSelectBar, drawWindowFrame, type WindowSkin } from './stage.ts';
import { EQUIP_PANEL, equipStatRows, hasEquipPanel, IQ_LABEL, MAG_LEVEL_LABEL, magRows, SYNCHRO_LABEL, type StatBlock } from './itemdetail.ts';
import { wipeElement, WindowAnim, withElementWipe, withWindowAnim } from './windowanim.ts';

export const ITEM_LIST = { x: 13, y: 256, w: 308, h: 184 } as const; // entry 3, 0x00973ca0
export const ITEM_DETAIL = { x: 324, y: 256, w: 240, h: 184 } as const; // entry 2, 0x009f2b58
export const PURPOSE_POS = { x: 324, y: 256, w: 224 } as const; // entry 4
export const AMOUNT_RECT = { x: 324, y: 318, w: 224, h: 80 } as const; // entry 5
export const SORT_POS = { x: 324, y: 318, w: 224 } as const; // entry 6
// The equipment stat panel at GUI entry 0xC (drawPanel). Off in the Item Pack: the exe's
// inventory menu does not create entry 0xC (see the note in draw()). The panel is kept for
// the mag menus' window (ChallengePlayerListWindow_Constructor_007525bc), not ported yet.
const SHOW_EQUIP_PANEL = false;
export const MAX_ITEMS = 30; // 0x1e
export const VISIBLE_ROWS = 8;
export const ICON = 18; // 0x00970d98
export const NO_ICON = 0x36;

// --- icons ---------------------------------------------------------------

// Texel origins in f256_hyouji.prs texture 1 (0x00970b40); 0x30 blinks to
// 0x31 every 8 frames (GetInformationCounterListItemPosition_0072b39c).
export const ICON_UV: ReadonlyArray<readonly [number, number]> = [
  [161, 98], [179, 98], [197, 98], [215, 98], [233, 98], [161, 116], [179, 116], [197, 116], [215, 116], [233, 116],
  [161, 134], [179, 134], [197, 134], [215, 134], [233, 134], [161, 152], [179, 152], [197, 152], [215, 152], [233, 152],
  [161, 170], [179, 170], [197, 170], [215, 170], [233, 170], [233, 224], [197, 224], [72, 238], [90, 238], [108, 238],
  [126, 238], [161, 188], [179, 188], [197, 188], [215, 188], [233, 188], [161, 206], [179, 206], [197, 206], [54, 238],
  [197, 80], [215, 80], [233, 80], [197, 62], [215, 62], [233, 62], [197, 62], [233, 80], [81, 156], [99, 156],
  [117, 156], [135, 156], [179, 206], [161, 206],
];

// Weapon kind -> 1 sword / 2 cane / 3 gun (0x0092c360, 19 entries).
const WEAPON_ANIM = [1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 2, 2, 2, 1, 1, 1, 1, 3, 2];

export function isWrapped(item: ItemData): boolean {
  const d = item.data1;
  if (d[0] === 0 || d[0] === 1) return (d[4] & 0x40) !== 0;
  if (d[0] === 2) return (item.data2[2] & 0x40) !== 0;
  if (d[0] === 3) return maxStackSize(item) === 1 && (d[3] & 0x40) !== 0;
  return false;
}

// is_item_tekked: only weapons with an unidentified special (data1[4] &
// 0x80) are untekked.
export function isTekked(item: ItemData): boolean {
  return !(item.data1[0] === 0 && item.data1[4] & 0x80 && !isWrapped(item));
}

// Icon 2 (UIElement_SetItemAnimationState_0072b9d0).
export function categoryIcon(item: ItemData, weaponKind: (data1_1: number) => number | undefined): number {
  const d = item.data1;
  if (isWrapped(item)) return 8;
  if (d[0] === 0) {
    const kind = d[1] < 0xed ? weaponKind(d[1]) : d[1];
    const anim = kind !== undefined ? (WEAPON_ANIM[kind & 0xff] ?? 0) : 0;
    if (anim === 1) return 0;
    if (anim === 3) return 1;
    if (anim === 2) return 2;
    return NO_ICON;
  }
  if (d[0] === 1) return d[1] === 3 ? 4 : d[1] === 2 ? 10 : 11;
  if (d[0] === 2) return 3;
  if (d[0] === 3) return d[1] === 0 ? 5 : d[1] === 1 ? 7 : d[1] === 2 ? 6 : 8;
  if (d[0] === 4) return 9;
  return NO_ICON;
}

// --- classes and requirements --------------------------------------------

// newserv class_flags_for_class (bits FRHANMfm).
const CLASS_FLAGS = [0x25, 0x2a, 0x31, 0x45, 0x51, 0x52, 0x86, 0x89, 0x8a, 0x32, 0x85, 0x46];

// mag_class_check (0x005ca2b0 area): the item's usability bits are 1 hunter,
// 2 ranger, 4 force, 8 human, 0x10 android, 0x20 newman, 0x40 male,
// 0x80 female; a class must match its job, race and sex.
export function classCanUse(charClass: number, usability: number): boolean {
  const f = CLASS_FLAGS[charClass] ?? 0;
  const job = f & 0x20 ? 1 : f & 0x40 ? 2 : 4;
  const race = f & 0x10 ? 0x10 : f & 0x08 ? 0x20 : f & 0x04 ? 0x08 : 0;
  const sex = f & 0x01 ? 0x40 : f & 0x02 ? 0x80 : 0;
  return (usability & job) !== 0 && (!race || (usability & race) !== 0) && (!sex || (usability & sex) !== 0);
}

export interface RowContext {
  names: ItemNames | null;
  charClass: number;
  level: number; // displayed level (1-based)
  // dfp / evp / lck: the character's stats for the equipment panel (0 when absent).
  stats: { atp: number; mst: number; ata: number; dfp?: number; evp?: number; lck?: number };
  lobby: boolean;
}

// ValidateItemForEquip_005c9e40: bit 1 = the class cannot use it, 2 / 4 / 8 =
// the ATP / ATA / MST requirement is not met (the client compares the
// player's current stats; the web client has the character file's).
export function equipProblems(item: ItemData, ctx: RowContext): number {
  const d = item.data1;
  const pmt = ctx.names?.pmt;
  if (!pmt) return 0;
  if (d[0] === 0) {
    const w = pmt.getWeapon(d[1], d[2]);
    if (!w) return 0;
    let f = classCanUse(ctx.charClass, w.usabilityFlags) ? 0 : 1;
    if (ctx.stats.atp < w.atpRequired) f |= 2;
    if (ctx.stats.ata < w.ataRequired) f |= 4;
    if (ctx.stats.mst < w.mstRequired) f |= 8;
    return f;
  }
  if (d[0] === 1 && (d[1] === 1 || d[1] === 2)) {
    const a = (d[1] === 1 ? pmt.armors : pmt.shields)[d[2]];
    if (!a) return 0;
    let f = classCanUse(ctx.charClass, a.usabilityFlags) ? 0 : 1;
    if (ctx.level < a.requiredLevel + 1) f |= 2;
    return f;
  }
  if (d[0] === 2) {
    const m = pmt.mags[d[1]];
    return m && !classCanUse(ctx.charClass, m.usabilityFlags) ? 1 : 0;
  }
  if (d[0] === 3 && d[1] === 2) {
    const max = pmt.maxTechLevels[d[4]]?.[ctx.charClass];
    return max === undefined || max === 0xff || max < d[2] ? 1 : 0;
  }
  return 0;
}

const s16 = (v: number) => (v & 0x8000 ? v - 0x10000 : v);
const w16 = (d: Uint8Array, i: number) => d[i] | (d[i + 1] << 8);

// IsValidItemColoringData_005d325c: the green "has bonuses" rows.
export function hasBonuses(item: ItemData): boolean {
  const d = item.data1;
  if (d[0] === 0) return d[6] !== 0 || d[8] !== 0 || d[10] !== 0;
  if (d[0] === 1) {
    if (d[1] === 1 && d[5] !== 0) return true;
    if (d[1] === 3) return s16(w16(d, 6)) > 0;
    if (d[1] === 1 || d[1] === 2) return s16(w16(d, 6)) > 0 || s16(w16(d, 8)) > 0;
    return false;
  }
  if (d[0] === 2) return d[1] === 0x1d || (d[1] > 0x20 && (d[1] < 0x23 || d[1] === 0x27));
  return false;
}

// Undroppable items (GetItemAttackData flag 0x10): tools whose ItemPMT flags
// lack bit 2 (CheckItemEquipConditions_005d5f40).
export function undroppable(item: ItemData, names: ItemNames | null): boolean {
  const d = item.data1;
  if (d[0] !== 3 || !names) return false;
  const t = d[1] === 2 ? names.pmt.getTool(2, d[4]) : names.pmt.getTool(d[1], d[2]);
  return !!t && (t.itemFlags & 2) === 0;
}

export interface ItemRow {
  id: number; // item id, MESETA_ITEM_ID for the meseta row
  icon1: number;
  icon2: number;
  name: string;
  count: string; // right-aligned text ("×5", "300Meseta")
  nameColor: string;
  iconColor: string;
}

const COLOR = {
  white: '#ffffff',
  untekked: '#00fffc', // 0xff00fffc
  cannot: '#909090', // 0xff909090
  cannotIcon: '#aaaaaa', // 0xffaaaaaa
  srank: '#fe3c28', // 0xfffe3c28
  rare: '#ffea00', // 0xffffea00
  bonus: '#61e853', // 0xff61e853
} as const;

// get_item_name 0x005d2aac.
export function itemRowName(item: ItemData, names: ItemNames | null): string {
  const d = item.data1;
  const text = (group: number, index: number) => names?.text?.[group]?.[index] ?? '';
  if (!names) return `${[...d.subarray(0, 3)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  if (isWrapped(item)) return text(1, 0x78);
  const base = names.baseName(item);
  if (d[0] === 3 && d[1] === 2) {
    const tech = d[4];
    if (tech >= 0x13) return base;
    const techName = text(5, tech);
    if (tech === 0x0e || tech === 0x11) return `${base}${techName}`;
    return `${base}${techName} Lv.${d[2] + 1}`;
  }
  if (d[0] === 1 && d[1] === 3) {
    const m = s16(w16(d, 6));
    return `${base}${m >= 3 ? '++' : m > 0 ? '+' : m <= -3 ? '--' : m < 0 ? '-' : ''}`;
  }
  if (d[0] !== 0) return base;
  if (isSRankWeapon(item)) {
    // DecodeBase32ItemName_005d2fd4: three 5-bit letters per word of data1[6..11].
    let name = '';
    for (let i = 6; i < 12; i += 2) {
      const v = ((d[i] & 0x7f) << 8) | d[i + 1];
      for (const c of [(v >> 10) & 0x1f, (v >> 5) & 0x1f, v & 0x1f]) if (c) name += String.fromCharCode(c + 0x40);
    }
    const custom = name.startsWith('B');
    const shown = custom ? name.slice(1) : name;
    if (custom) return d[3] ? `${shown} +${d[3]}` : shown;
    return d[3] ? `${shown} ${base} +${d[3]}` : `${shown} ${base}`;
  }
  // A rare weapon shows no special: its name when tekked, "????" until then.
  if (names.isRare(item)) {
    if (!isTekked(item)) return text(1, 0x19b);
    return d[3] ? `${base} +${d[3]}` : base;
  }
  // unitxt_get_special_name(data1[4]): an unidentified special (0x80) reads
  // "????", the entry after the specials (ItemNames.textMatches).
  const special = d[4] & 0x80 ? text(1, SPECIAL_STARS_BEGIN_INDEX + names.pmt.specials.length) : d[4] & 0x3f ? text(1, SPECIAL_STARS_BEGIN_INDEX + (d[4] & 0x3f)) : '';
  if (!special) return d[3] ? `${base} +${d[3]}` : base;
  return d[3] ? `${special} ${base} +${d[3]}` : `${special} ${base}`;
}

// One inventory row (InitializeItemObject_0072bdd4 + ItemEntity_UpdateColoring_0072c045).
export function itemRow(it: InventoryItem, ctx: RowContext): ItemRow {
  const item = it.data;
  const names = ctx.names;
  const row: ItemRow = {
    id: item.id,
    icon1: NO_ICON,
    icon2: categoryIcon(item, (k) => names?.pmt.weaponKinds[k]),
    name: itemRowName(item, names),
    count: maxStackSize(item) > 1 ? `×${stackSize(item)}` : '',
    nameColor: COLOR.white,
    iconColor: COLOR.white,
  };
  if (isWrapped(item)) return row;
  const equipped = it.equipped;
  const noDrop = undroppable(item, names);
  const problems = equipProblems(item, ctx);
  const tekked = isTekked(item);
  if (!noDrop) {
    if (!equipped) row.icon1 = !tekked && names?.isRare(item) ? 0x19 : problems & 1 ? 0x13 : NO_ICON;
    else row.icon1 = 0x0c;
  } else row.icon1 = equipped ? 0x2b : 0x2a;
  if (!tekked) {
    row.nameColor = COLOR.untekked;
    return row;
  }
  if (problems) {
    row.nameColor = COLOR.cannot;
    row.iconColor = COLOR.cannotIcon;
    return row;
  }
  if (isSRankWeapon(item)) row.nameColor = COLOR.srank;
  else if (names?.isRare(item)) row.nameColor = COLOR.rare;
  else if (hasBonuses(item)) row.nameColor = COLOR.bonus;
  return row;
}

export function mesetaRow(meseta: number, mesetaWord: string): ItemRow {
  return { id: MESETA_ITEM_ID, icon1: NO_ICON, icon2: 9, name: '', count: `${meseta}${mesetaWord}`, nameColor: COLOR.white, iconColor: COLOR.white };
}

// ChallengePlayer_CreateItemList_00751ae0: the inventory in slot order, then
// meseta when there is any.
export function itemRows(c: CharacterFile, ctx: RowContext, mesetaWord: string): ItemRow[] {
  const rows = c.inventory.map((it) => itemRow(it, ctx));
  if (c.meseta > 0) rows.push(mesetaRow(c.meseta, mesetaWord));
  return rows;
}

// --- Purpose -------------------------------------------------------------

export const PURPOSE = { use: 0, equip: 1, remove: 2, drop: 3, mesetaDrop: 6, sort: 7 } as const;

export interface PurposeContext {
  lobby: boolean;
  canUse: (it: InventoryItem) => boolean;
  equipProblems: (it: InventoryItem) => number;
  undroppable: (it: InventoryItem) => boolean;
}

// ChallengePlayer_AddNormalItemList_00751324 / AddRandomItemList_00751548.
export function purposeItems(it: InventoryItem | 'meseta', ctx: PurposeContext, label: (index: number) => string): ListItem[] {
  if (it === 'meseta') return [{ label: label(0x72), value: PURPOSE.mesetaDrop, enabled: !ctx.lobby }];
  const out: ListItem[] = [];
  const d = it.data.data1;
  if (d[0] === 3 || isWrapped(it.data)) out.push({ label: label(0x73), value: PURPOSE.use, enabled: !ctx.lobby && ctx.canUse(it) });
  if (isEquippable(d) && !isWrapped(it.data)) {
    if (it.equipped) out.push({ label: label(0x74), value: PURPOSE.remove, enabled: !ctx.lobby });
    else out.push({ label: label(0x75), value: PURPOSE.equip, enabled: !ctx.lobby && ctx.equipProblems(it) === 0 });
  }
  out.push({ label: label(0x72), value: PURPOSE.drop, enabled: !ctx.lobby && !ctx.undroppable(it) });
  out.push({ label: label(0x76), value: PURPOSE.sort, enabled: !ctx.lobby });
  return out;
}

// --- description ----------------------------------------------------------

// GetItemDescription_005d3078 (group 3 = unitxt + 0xC).
export function itemDescription(item: ItemData, names: ItemNames | null): string {
  const text = (group: number, index: number) => names?.text?.[group]?.[index] ?? '';
  if (!names || isWrapped(item)) return '';
  const d = item.data1;
  const id = names.itemId(item);
  if (id === undefined || id === 0x27f) return '';
  if (d[0] === 0 && !isTekked(item) && names.isRare(item)) return text(3, 0x19b);
  if (d[0] === 1 && d[1] === 3 && id < 0x3b0) {
    const u = names.pmt.units[d[2]];
    return text(3, id).replace(/%d/, String((u?.amount ?? 0) + s16(w16(d, 6))));
  }
  return text(3, id);
}

// --- amount spinner ------------------------------------------------------

const STEPS = [1, 10, 100, 1000, 10000, 100000]; // 0x00970a00

export class AmountSpinner {
  value: number;
  digit = 0; // 0 = ones
  readonly min: number;
  readonly max: number;
  readonly digits: number;

  constructor(max: number, min = 1, start = 1) {
    this.min = min;
    this.max = max;
    this.value = start;
    // CreateNumericDisplayListWindow_00728ac4: digits of max (1..6).
    this.digits = Math.min(6, String(Math.max(1, max)).length);
  }

  up(): void {
    const v = this.value + STEPS[this.digit];
    this.value = v > this.max ? this.min : v;
  }

  down(): void {
    const v = this.value - STEPS[this.digit];
    this.value = v < this.min ? this.max : v;
  }

  left(): void {
    this.digit = this.digit + 1 < this.digits ? this.digit + 1 : 0;
  }

  right(): void {
    this.digit = this.digit - 1 >= 0 ? this.digit - 1 : this.digits - 1;
  }

  // Right edge of digit k (0 = ones) from the window's content origin: the
  // element x is width / 2 + digits * 12 / 2 + (window width - 20) / 2 - 6,
  // 12 less per digit, and the number is drawn leftwards from it.
  digitRight(k: number, width: number = AMOUNT_RECT.w): number {
    return 10 * 0.5 + this.digits * 12 * 0.5 + (width - 20) * 0.5 - 6 - k * 12;
  }

  // Hold-repeat (SinowberillUIElementListWindow_HandleAction_00728d44): a
  // direction steps once when it goes down (the "just pressed" bit, +0x4c),
  // then again on the frame its held count reaches SPIN_DELAY + 1 and every
  // SPIN_INTERVAL frames after that (CheckSharedInputStateKeyHeld_007c0c6c with
  // 6 and 5). The browser's own key repeat is not used (`press` is only called
  // for a first keydown); `frame` drives the repeats. ASSUMED: the held count
  // is 1 on the press frame, so the first repeat comes six frames after it.
  private held = new Map<SpinDir, number>();

  press(dir: SpinDir): void {
    this.step(dir);
    this.held.set(dir, 1);
  }

  release(dir: SpinDir): void {
    this.held.delete(dir);
  }

  // One game frame: returns true when a held direction stepped the value.
  frame(): boolean {
    let stepped = false;
    for (const [dir, c] of this.held) {
      const n = c + 1;
      this.held.set(dir, n);
      const k = n - SPIN_DELAY - 1;
      if (k >= 0 && k % SPIN_INTERVAL === 0) {
        this.step(dir);
        stepped = true;
      }
    }
    return stepped;
  }

  private step(dir: SpinDir): void {
    if (dir === 'up') this.up();
    else if (dir === 'down') this.down();
    else if (dir === 'left') this.left();
    else this.right();
  }
}

export type SpinDir = 'up' | 'down' | 'left' | 'right';
export const SPIN_DELAY = 6; // frames held before the first repeat (see AmountSpinner)
export const SPIN_INTERVAL = 5; // frames between repeats
const SPIN_KEYS: Readonly<Record<string, SpinDir>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

// Key routing for a spinner window (Item Pack and the shop / bank counters).
// Returns true when the key is a direction the spinner takes (a first press
// steps it and plays 0x56F; OS repeats are ignored, see AmountSpinner.frame).
export function spinnerKeyDown(a: AmountSpinner, e: KeyboardEvent): boolean {
  const dir = SPIN_KEYS[e.key];
  if (!dir) return false;
  if (!e.repeat) {
    a.press(dir);
    se(SE.cursor);
  }
  return true;
}

export function spinnerKeyUp(a: AmountSpinner, e: KeyboardEvent): void {
  const dir = SPIN_KEYS[e.key];
  if (dir) a.release(dir);
}

// --- the window set --------------------------------------------------------

export interface ItemPackActions {
  use(id: number): void;
  equip(id: number): void;
  unequip(id: number): void;
  drop(id: number, amount: number): void;
  dropMeseta(amount: number): void;
  // Sort > Automatically (ChallengePlayer_EndChallenge_0068fb70) and the
  // manual swap (ChallengePlayer_InitializeChallengeItems_0068fb3c); the new
  // order is sent (6xC4) when the window is destroyed (commitSort).
  sortAuto(): void;
  sortSwap(a: number, b: number): void;
  commitSort(): void;
}

export interface ItemPackTextures {
  icons: CanvasImageSource; // f256_hyouji.prs texture 1
  arrows: CanvasImageSource; // texture 0
  digits: CanvasImageSource; // texturejapanese.xvm texture 0
}

export interface ItemPackEnv {
  character: () => CharacterFile | null;
  rowContext: () => RowContext;
  purposeContext: () => PurposeContext;
  text: (group: number, index: number) => string;
  actions: ItemPackActions;
}

type State = 'list' | 'purpose' | 'amount' | 'sort' | 'manual';

export class ItemPackMenu {
  private state: State = 'list';
  private cursor = 0;
  private top = 0;
  private purpose: { cursor: number; items: ListItem[] } = { cursor: 0, items: [] };
  private sortMenu = { cursor: 0 };
  // Manual sort (states 9..0xB): the item picked first, waiting for the one
  // it trades places with.
  private picked: number | null = null;
  private amount: AmountSpinner | null = null;
  private frame = 0;
  // The later windows run their own list window animation (classic/windowanim.ts),
  // each with its own counter: the description (open while the list is browsed),
  // Purpose, Sort and Amount. ASSUMED silent: the menu's cursor / decide / cancel
  // sounds play as before. `speed`: the field menu's window speed (0..3).
  readonly detailAnim = new WindowAnim(true, true);
  readonly purposeAnim = new WindowAnim(true, false);
  readonly sortAnim = new WindowAnim(true, false);
  readonly amountAnim = new WindowAnim(true, false);
  speed = 1;
  rows: ItemRow[] = [];
  // The panel drawn by the last draw() (null: none), for the HUD's debug hook.
  private panelDrawn: { x: number; y: number; w: number; h: number; kind: 'equip' | 'mag' } | null = null;
  private env: ItemPackEnv;

  constructor(env: ItemPackEnv) {
    this.env = env;
    this.refresh();
  }

  private item(): InventoryItem | 'meseta' | null {
    const row = this.rows[this.cursor];
    if (!row) return null;
    if (row.id === MESETA_ITEM_ID) return 'meseta';
    return this.env.character()?.inventory.find((i) => i.data.id === row.id) ?? null;
  }

  // Rebuilds the rows after the inventory changed (states 8 / 0x16 -> 1).
  refresh(): void {
    const c = this.env.character();
    this.rows = c ? itemRows(c, this.env.rowContext(), this.env.text(12, 0)) : [];
    if (this.cursor >= this.rows.length) this.cursor = Math.max(0, this.rows.length - 1);
    this.clampTop();
  }

  private clampTop(): void {
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + VISIBLE_ROWS) this.top = this.cursor - VISIBLE_ROWS + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, this.rows.length - VISIBLE_ROWS)));
  }

  tick(): void {
    this.frame++;
    this.detailAnim.tick(this.speed);
    this.purposeAnim.tick(this.speed);
    this.sortAnim.tick(this.speed);
    this.amountAnim.tick(this.speed);
    if (this.state === 'amount' && this.amount?.frame()) se(SE.cursor);
  }

  // The description closes while an action window is up and opens again when
  // the list comes back (states 2 / 3 of ChallengePlayer_StateMachine_00750954).
  private openPurpose(): void {
    this.detailAnim.close();
    this.purposeAnim.open(this.speed);
  }

  private backToList(): void {
    this.purposeAnim.close();
    this.sortAnim.close();
    this.amountAnim.close();
    this.detailAnim.open(this.speed);
  }

  private openAmount(n: number): void {
    this.amount = new AmountSpinner(n);
    this.state = 'amount';
    this.amountAnim.open(this.speed);
  }

  // Key releases end a held direction of the amount spinner.
  keyUp(e: KeyboardEvent): void {
    if (this.amount) spinnerKeyUp(this.amount, e);
  }

  // Returns false when the menu closes (Backspace on the list).
  key(e: KeyboardEvent): boolean {
    if (this.state === 'list') {
      const n = this.rows.length;
      if (menuKeyOf(e) === 'up' || menuKeyOf(e) === 'down') {
        if (n) {
          this.cursor = (this.cursor + (menuKeyOf(e) === 'up' ? n - 1 : 1)) % n;
          this.clampTop();
          se(SE.cursor);
        }
      } else if (menuKeyOf(e) === 'decide') {
        const it = this.item();
        if (!it) {
          se(SE.buzzer);
          return true;
        }
        se(SE.ok);
        this.purpose = { cursor: 0, items: purposeItems(it, this.env.purposeContext(), (i) => this.env.text(11, i)) };
        this.state = 'purpose';
        this.openPurpose();
      } else if (menuKeyOf(e) === 'cancel') {
        se(SE.cancel);
        this.dispose();
        return false;
      }
      return true;
    }
    if (this.state === 'purpose') {
      const r = listKey(e, this.purpose.items, this.purpose);
      if (r === 'cancel') {
        this.state = 'list';
        this.backToList();
      } else if (r === 'decide') this.decide(this.purpose.items[this.purpose.cursor].value);
      return true;
    }
    if (this.state === 'sort') {
      const items = this.sortItems();
      const r = listKey(e, items, this.sortMenu);
      if (r === 'cancel') {
        this.state = 'purpose';
        this.sortAnim.close();
      } else if (r === 'decide') this.decideSort(items[this.sortMenu.cursor].value);
      return true;
    }
    if (this.state === 'manual') return this.manualKey(e);
    if (this.state === 'amount' && this.amount) {
      const a = this.amount;
      if (spinnerKeyDown(a, e)) return true;
      if (menuKeyOf(e) === 'decide') {
        if (a.value < a.min || a.value > a.max) return se(SE.buzzer), true;
        se(SE.ok);
        const it = this.item();
        if (it === 'meseta') this.env.actions.dropMeseta(a.value);
        else if (it) this.env.actions.drop(it.data.id, a.value);
        this.afterAction();
      } else if (menuKeyOf(e) === 'cancel') {
        se(SE.cancel);
        this.state = 'purpose';
        this.amountAnim.close();
      }
      return true;
    }
    return true;
  }

  private sortItems(): ListItem[] {
    return [
      { label: this.env.text(11, 0x70), value: 0, enabled: true },
      { label: this.env.text(11, 0x71), value: 1, enabled: true },
    ];
  }

  // ChallengePlayer_ProcessListAction_007516f0: 0 sorts at once (state 0x16,
  // back to the list), 1 closes the Purpose / Sort windows and the list takes
  // the choices itself (state 10).
  private decideSort(value: number): void {
    if (value === 0) {
      this.env.actions.sortAuto();
      this.afterAction();
    } else {
      this.picked = null;
      this.state = 'manual';
      this.purposeAnim.close();
      this.sortAnim.close();
      this.detailAnim.open(this.speed);
    }
  }

  // States 9 and 0xB: Enter picks an item, then another one to trade places
  // with it (the exe rebuilds the list and waits for the next pick); Backspace
  // drops the pick, or closes the window when nothing is picked.
  // ASSUMED: the meseta row cannot be picked (it is not an item object).
  private manualKey(e: KeyboardEvent): boolean {
    const n = this.rows.length;
    if ((menuKeyOf(e) === 'up' || menuKeyOf(e) === 'down') && n) {
      this.cursor = (this.cursor + (menuKeyOf(e) === 'up' ? n - 1 : 1)) % n;
      this.clampTop();
      se(SE.cursor);
    } else if (menuKeyOf(e) === 'decide') {
      const it = this.item();
      if (!it || it === 'meseta') {
        se(SE.buzzer);
        return true;
      }
      se(SE.ok);
      if (this.picked === null) this.picked = it.data.id;
      else {
        this.env.actions.sortSwap(it.data.id, this.picked);
        this.picked = null;
        this.refresh();
      }
    } else if (menuKeyOf(e) === 'cancel') {
      se(SE.cancel);
      if (this.picked !== null) this.picked = null;
      else {
        this.dispose();
        return false;
      }
    }
    return true;
  }

  // The window is destroyed: a sorted inventory is sent (6xC4).
  dispose(): void {
    this.env.actions.commitSort();
  }

  // ChallengePlayer_ProcessListSelection_0075158c.
  private decide(value: number): void {
    const it = this.item();
    if (!it) return;
    const a = this.env.actions;
    if (it === 'meseta') {
      const meseta = this.env.character()?.meseta ?? 0;
      if (meseta > 1) this.openAmount(meseta);
      else if (meseta === 1) {
        a.dropMeseta(1);
        this.afterAction();
      }
      return;
    }
    const id = it.data.id;
    if (value === PURPOSE.use) a.use(id);
    else if (value === PURPOSE.equip) a.equip(id);
    else if (value === PURPOSE.remove) a.unequip(id);
    else if (value === PURPOSE.drop) {
      const n = maxStackSize(it.data) > 1 ? stackSize(it.data) : 1;
      if (n >= 2) {
        this.openAmount(n);
        return;
      }
      a.drop(id, 1);
    } else if (value === PURPOSE.sort) {
      this.sortMenu = { cursor: 0 };
      this.state = 'sort';
      this.sortAnim.open(this.speed);
      return;
    }
    this.afterAction();
  }

  // State 0x16 -> 1: back to the list, rebuilt.
  private afterAction(): void {
    this.state = 'list';
    this.backToList();
    this.refresh();
  }

  // `wipe`: the leaf's opening animation (FieldMenu's leafAnim); its rows, bars
  // and texts are revealed by the element wipe (windowanim.ts withElementWipe).
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: ItemPackTextures, extra = 0, wipe?: WindowAnim): void {
    const c = this.env.character();
    const collapsed = this.state !== 'list' && this.state !== 'manual';
    const L = ITEM_LIST;
    const h = collapsed ? ROW + 14 + TITLE_GAP : L.h;
    drawWindowFrame(ctx, skin.frame, L.x, L.y, L.w, h);
    const cx = L.x + INSET;
    const cy = L.y + INSET + TITLE_GAP;
    const cw = L.w - 2 * INSET;
    withElementWipe(wipe, cx, cy, cw, () => {
      if (!this.rows.length) {
        const none = this.env.text(11, 0xee);
        wipeElement(ctx, cx, cy + 1, ROW, () => drawGameText(ctx, none, cx, cy + 1, DISABLED));
      } else if (collapsed) {
        this.drawRow(ctx, tex, this.rows[this.cursor], cx, cy, cw);
      } else {
        const mark = this.picked === null ? -1 : this.rows.findIndex((r) => r.id === this.picked);
        if (mark >= this.top && mark < this.top + VISIBLE_ROWS) {
          const my = cy + (mark - this.top) * ROW;
          wipeElement(ctx, cx, my, 16, () => drawSelectBar(ctx, skin.bars, cx, my, cw, 16));
        }
        const sy = cy + (this.cursor - this.top) * ROW;
        wipeElement(ctx, cx, sy, 16, () => drawSelectBar(ctx, skin.bars, cx, sy, cw, 16));
        this.rows.slice(this.top, this.top + VISIBLE_ROWS).forEach((r, i) => this.drawRow(ctx, tex, r, cx, cy + i * ROW, cw));
      }
      drawWindowTitle(ctx, skin, L.x, L.y, this.env.text(11, 0x37));
    });
    // "n/30" pill.
    const count = `${c?.inventory.length ?? 0}/${MAX_ITEMS}`;
    const px = L.x + 158;
    const py = L.y - 13;
    drawPill(ctx, skin.frame, px, py, 80 - 60, 0);
    // The count sits in the title's row: it waits for the window's opening, as the title text does.
    if (!wipe || wipe.textShown) drawGameText(ctx, count, px + 50 - gameTextWidth(count) / 2, py + 4 + 1, '#ffffff');

    // The other windows are on the right half: they follow the right edge.
    ctx.save();
    ctx.translate(extra, 0);
    // Each later window is under its own animation (windowanim.ts); a closing
    // window keeps drawing its last contents until it is gone.
    const it = this.item();
    if (this.rows.length) {
      const text = it && it !== 'meseta' ? itemDescription(it.data, this.env.rowContext().names) : it === 'meseta' ? this.env.text(11, 0x135) : '';
      const D = ITEM_DETAIL;
      withWindowAnim(ctx, this.detailAnim, D.x, D.y, D.w, D.h, () =>
        withElementWipe(this.detailAnim, D.x + INSET, D.y + INSET, D.w - 2 * INSET, () => drawTextWindow(ctx, skin, D, text)),
      );
    }
    const P = PURPOSE_POS;
    const purposeTitle = this.env.text(11, 0x39);
    withWindowAnim(ctx, this.purposeAnim, P.x, P.y, P.w, listWindowHeight(this.purpose.items.length, true), () =>
      withElementWipe(this.purposeAnim, P.x + INSET, P.y + INSET + TITLE_GAP, P.w - 2 * INSET, () =>
        drawListWindow(ctx, skin, P.x, P.y, P.w, purposeTitle, this.purpose.items, this.purpose.cursor, this.state === 'purpose'),
      ),
    );
    const S = SORT_POS;
    const sortTitle = this.env.text(11, 0x3a);
    withWindowAnim(ctx, this.sortAnim, S.x, S.y, S.w, listWindowHeight(2, true), () =>
      withElementWipe(this.sortAnim, S.x + INSET, S.y + INSET + TITLE_GAP, S.w - 2 * INSET, () =>
        drawListWindow(ctx, skin, S.x, S.y, S.w, sortTitle, this.sortItems(), this.sortMenu.cursor),
      ),
    );
    const amount = this.amount;
    if (amount) withWindowAnim(ctx, this.amountAnim, AMOUNT_RECT.x, AMOUNT_RECT.y, AMOUNT_RECT.w, AMOUNT_RECT.h, () => this.drawAmount(ctx, skin, tex, amount));
    ctx.restore();
    // The panel is on the left (no translation). Off: the exe's Item Pack
    // (inventory_menu 0xB -> GuildCardSearchWindow_Constructor_0075086c) never
    // creates GUI entry 0xC; that entry is the mag menus' window
    // (mag_menu1/2 -> ChallengePlayerListWindow_Constructor_007525bc). See SHOW_EQUIP_PANEL.
    this.panelDrawn = null;
    if (SHOW_EQUIP_PANEL && (this.state === 'list' || this.state === 'manual')) {
      const it = this.item();
      if (it && it !== 'meseta' && this.rows.length) this.drawPanel(ctx, skin, it, wipe);
    }
  }

  // The equipment stat panel (entry 0xC) of a weapon / armour / shield, or the
  // mag rows, drawn on the left under the list (itemdetail.ts).
  private drawPanel(ctx: CanvasRenderingContext2D, skin: WindowSkin, it: InventoryItem, wipe?: WindowAnim): void {
    const rc = this.env.rowContext();
    if (!rc.names || (!hasEquipPanel(it.data) && it.data.data1[0] !== 2)) return;
    const R = EQUIP_PANEL;
    drawWindowFrame(ctx, skin.frame, R.x, R.y, R.w, R.h);
    this.panelDrawn = { x: R.x, y: R.y, w: R.w, h: R.h, kind: it.data.data1[0] === 2 ? 'mag' : 'equip' };
    const x0 = R.x + INSET;
    const xr = R.x + R.w - INSET;
    const y0 = R.y + INSET;
    withElementWipe(wipe, x0, y0, R.w - 2 * INSET, () => this.drawPanelRows(ctx, it, rc, x0, xr, y0));
  }

  // The panel's lines (the mag rows, or the equipment stat rows); each text is an element of the wipe.
  private drawPanelRows(ctx: CanvasRenderingContext2D, it: InventoryItem, rc: RowContext, x0: number, xr: number, y0: number): void {
    const names = rc.names;
    if (!names) return;
    const white = '#ffffff';
    const text = (group: number, index: number) => this.env.text(group, index);
    const t = (s: string, x: number, y: number, color: string) => wipeElement(ctx, x, y, ROW, () => drawGameText(ctx, s, x, y, color));
    let y = y0;
    if (it.data.data1[0] === 2) {
      const m = magRows(it.data);
      const line = (label: string, value: string) => {
        t(label, x0, y, white);
        t(value, xr - gameTextWidth(value), y, white);
        y += ROW;
      };
      line(`${text(11, MAG_LEVEL_LABEL)}:`, `${m.level}`);
      line(`${text(11, SYNCHRO_LABEL)}:`, m.synchro);
      line(`${text(11, IQ_LABEL)}:`, m.iq);
      for (const s of m.stats) line(`${s.name}:`, s.text);
      return;
    }
    const c = this.env.character();
    const current: StatBlock = {
      atp: rc.stats.atp,
      dfp: rc.stats.dfp ?? 0,
      mst: rc.stats.mst,
      ata: rc.stats.ata,
      evp: rc.stats.evp ?? 0,
      lck: rc.stats.lck ?? 0,
    };
    const equipped = it.equipped;
    // The item in the same slot: a weapon for a weapon, the armour for an armour, the shield for a shield.
    const d = it.data.data1;
    const old = c?.inventory.find((o) => o.equipped && o.data.data1[0] === d[0] && (d[0] !== 1 || o.data.data1[1] === d[1])) ?? null;
    const problems = equipProblems(it.data, rc);
    const rows = equipStatRows(current, it.data, old && old !== it ? old.data : null, names.pmt, equipped, problems === 0);
    for (const row of rows) {
      t(`${text(11, row.label)}:`, x0, y, white);
      const cur = String(row.current);
      const item = `→ ${row.item}`;
      t(item, xr - gameTextWidth(item), y, row.color);
      t(cur, xr - gameTextWidth(item) - 6 - gameTextWidth(cur), y, white);
      y += ROW;
    }
  }

  // Console aid (window.gameView.hud.debug().itemPack): the cursor, the rows, the selected
  // item and the rects drawn by the last draw() (the list, the detail and the panel), plus
  // the cursor's row (the select bar draw() puts at cy + (cursor - top) * ROW, 16 high).
  debugState() {
    const it = this.item();
    const L = ITEM_LIST;
    return {
      state: this.state,
      cursor: this.cursor,
      rows: this.rows.map((r) => r.id),
      item: it && it !== 'meseta' ? { id: it.data.id, cls: it.data.data1[0], equipped: !!it.equipped } : null,
      list: { ...L },
      detail: { ...ITEM_DETAIL },
      panel: this.panelDrawn,
      cursorRow: { x: L.x + INSET, y: L.y + INSET + TITLE_GAP + (this.cursor - this.top) * ROW, w: L.w - 2 * INSET, h: 16 },
    };
  }

  private drawRow(ctx: CanvasRenderingContext2D, tex: ItemPackTextures, r: ItemRow, x: number, y: number, w: number): void {
    drawItemRow(ctx, tex.icons, r, this.frame, x, y, w);
  }

  private drawAmount(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: ItemPackTextures, a: AmountSpinner): void {
    const R = AMOUNT_RECT;
    withElementWipe(this.amountAnim, R.x + INSET, R.y + INSET + TITLE_GAP, R.w - 2 * INSET, () =>
      drawAmountWindow(ctx, skin, tex, a, R, this.env.text(11, 0x3b)),
    );
  }
}

// The digit spinner window (CreateNumericDisplayListWindow_00728ac4), with a
// title pill when `title` is given (the title adds 6 px of height).
export function drawAmountWindow(
  ctx: CanvasRenderingContext2D,
  skin: WindowSkin,
  tex: Pick<ItemPackTextures, 'arrows' | 'digits'>,
  a: AmountSpinner,
  R: { x: number; y: number; w: number; h: number },
  title: string | null,
): void {
  drawWindowFrame(ctx, skin.frame, R.x, R.y, R.w, R.h);
  if (title !== null) drawWindowTitle(ctx, skin, R.x, R.y, title);
  const cx = R.x + INSET;
  const y = R.y + INSET + (title !== null ? TITLE_GAP : 0) + 18; // element y (0x009f2c24)
  let v = a.value;
  for (let k = 0; k < a.digits; k++) {
    const c = 0x30 + (v % 10);
    v = Math.trunc(v / 10);
    const right = cx + a.digitRight(k, R.w);
    // Each digit is an element of the wipe (under the window's scope, if any).
    wipeElement(ctx, right - 10, y, 13, () => ctx.drawImage(tex.digits, (c & 15) * 16, c & 0xf0, 10, 13, right - 10, y, 10, 13));
    if (k === a.digit) {
      // SinowberillUIElementListWindow_RenderScrollbar_007293e0: texture 0
      // at u = 224 (240 once confirmed), 14 x 12 pieces at x = right - 5 - 8:
      // texels v 0..12 at y - 15, 13..25 at y + 19, 28..40 at y + 25.
      const ax = right - 5 - 8;
      wipeElement(ctx, ax, y - 15, 52, () => {
        ctx.drawImage(tex.arrows, 224, 0, 14, 12, ax, y - 15, 14, 12);
        ctx.drawImage(tex.arrows, 224, 13, 14, 12, ax, y + 19, 14, 12);
        ctx.drawImage(tex.arrows, 224, 28, 14, 12, ax, y + 25, 14, 12);
      });
    }
  }
}

// One Item List row at (x, y) in a list `w` wide: BaseEntity_Render_0072ae74
// draws icon 1 and icon 2 (18 px each), then the name, and the stack count
// right-aligned to the window's right edge in the name's colour. Nothing clips
// the name (no truncation in the render path).
export function drawItemRow(ctx: CanvasRenderingContext2D, icons: CanvasImageSource, r: ItemRow, frame: number, x: number, y: number, w: number): void {
  wipeElement(ctx, x, y, ICON, () => drawIcon(ctx, icons, r.icon1, x, y, r.iconColor, frame));
  wipeElement(ctx, x + ICON, y, ICON, () => drawIcon(ctx, icons, r.icon2, x + ICON, y, r.iconColor, frame));
  if (r.name) wipeElement(ctx, x + 2 * ICON, y, ROW, () => drawGameText(ctx, r.name, x + 2 * ICON, y, r.nameColor));
  if (r.count) {
    const nx = x + w - gameTextWidth(r.count);
    wipeElement(ctx, nx, y, ROW, () => drawGameText(ctx, r.count, nx, y, r.nameColor));
  }
}

export function drawIcon(ctx: CanvasRenderingContext2D, img: CanvasImageSource, icon: number, x: number, y: number, color: string, frame: number): void {
  if (icon === NO_ICON) return;
  const i = icon === 0x30 && frame & 8 ? 0x31 : icon;
  const uv = ICON_UV[i];
  if (!uv) return;
  if (color === '#ffffff') {
    ctx.drawImage(img, uv[0], uv[1], ICON, ICON, x, y, ICON, ICON);
    return;
  }
  ctx.save();
  ctx.globalAlpha = 0xaa / 0xff;
  ctx.drawImage(img, uv[0], uv[1], ICON, ICON, x, y, ICON, ICON);
  ctx.restore();
}

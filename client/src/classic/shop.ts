// The Pioneer 2 shop and bank counters (bb_p2_menu 0 WEAPON STORE, 2 GEAR
// STORE, 3 ITEM STORE, 5 CHECK ROOM), as PsoBB.exe (Ephinea 1.25.13) runs
// them. The named dump mislabels most of these functions (ShopDialog_*Join*,
// Sinowberill*, MedicalCenter*); the addresses are what matters.
//
// Counter objects (p2_special_npc_menus 0x009cf100, create / is-open):
//   0 weapons  CreateWeaponStoreDialog_006d6b8c, states 0x006d65fc (table
//              0x0096c258): 1 greeting 0x006d6a78, 2 Buy / Sell 0x006d6820,
//              3 waits for the 6xB6 list then opens the buy window
//              0x006d6758 (states 0x006d4d64), 4 opens the sell window
//              0x006d66a0 (states 0x006d5960), 8 message then back, 9 close;
//   2 armor    CreateArmorStoreDialog_006d6c94 (buy window 0x006d3a10);
//   3 tools    CreateItemStoreDialog_006d6d18 (greeting 0x006d922c, Buy /
//              Sell 0x006d8fcc, buy window states 0x006d830c);
//   5 bank     CreateBankDialog_006d6d98 -> BankDialog_Constructor_006c9390,
//              states bank_menu_handler_table 0x009cec80.
//
// Windows (position table 0x00971f40):
//   - the clerk's message: entry 0x2e = (294, 365), 332 x 80 (immediates in
//     0x006d6a78 / 0x006ca124, 0x006dc794 -> 0x0073c7e8), unitxt_shop
//     group 0 text, typed out;
//   - choices (Buy / Sell, Buy / Cancel, Sell / Cancel, Yes / No, Deposit /
//     Take, Meseta / Item) and the amount spinner: entry 0x2d = (266, 270);
//   - the item list: entry 0x28 = (12, 50), 385 x 184
//     (ListWindowObject_Create_0073ff34 -> 0x0073fe9c, 0x00972dd4), titled
//     with the shop's name; rows as the Item Pack's with the price at the
//     right (UIElement_InitializeItemDisplay_0072b870);
//   - the item description: entry 0x29 = (400, 50), 240 x 184
//     (CreateEquipListWindowObject_00725d18, 0x009f2b58);
//   - "Money": entry 0x2a = (12, 418), 226 x 27
//     (bank_meseta_inventory_count_constructor, 0x009f3220, unitxt group 11
//     [0x9b]), the player's meseta;
//   - "Item Quantity": entry 0x2c = (12, 389), 160 x 27
//     (InitializeDialogListItem_0073eeec, 0x009f33c4, group 12 [1]): the
//     tool shop and the sell window show how many of the item are carried;
//   - the bank's "Deposit": entry 0x2b = (12, 389), 160 x 27 (0x0071b668,
//     0x009f2064, group 12 [2]), the bank's meseta.
//
// Prices (get_item_shop_cost 0x005d24dc, x87 truncation everywhere): see
// itemShopCost. The buy windows recompute the price of every listed item with
// it (0x006d3a10 / 0x006d54cc) instead of the 6xB6 data2; selling pays
// cost / 8 per unit (0x006d600c).
//
// Not recovered: the windows' typing speed (the InfoWindow's), the bank item
// windows' messages (their decompilation fails; see BankCounter).
//
// The tekker (bb_p2_menu 6, JUDGMENT): see TekkerCounter; the Medical
// Center (bb_p2_menu 1): see MedicalCounter.

import { menuKeyOf } from '../input/keyconfig.ts';
import { se, SE } from '../audio/se.ts';
import type { ItemPMT } from '../formats/itempmt.ts';
import { hasEquipPanel } from './itemdetail.ts';
import { maxStackSize, type ItemData } from '../formats/itemnames.ts';
import type { CharacterFile, InventoryItem } from '../net/charfile.ts';
import { MEDICAL_COST, stackSize } from '../net/items.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { anchorX, InfoWindow } from './ingame.ts';
import { drawListWindow, drawTextWindow, drawWindowTitle, INSET, LINE, ROW, TITLE_GAP, type ListItem, type WindowRect } from './fieldwindows.ts';
import {
  AmountSpinner,
  categoryIcon,
  drawAmountWindow,
  drawIcon,
  equipProblems,
  hasBonuses,
  isTekked,
  isWrapped,
  itemDescription,
  itemRow,
  itemRowName,
  drawEquipPanel,
  type ItemPackTextures,
  type ItemRow,
  type RowContext,
} from './itempack.ts';
import { isSRankWeapon } from '../formats/itemnames.ts';
import { drawSelectBar, drawTitlePill, drawWindowFrame, pillWidth, type WindowSkin } from './stage.ts';

// --- layout ------------------------------------------------------------------

export const CLERK = { x: 294, y: 365, w: 332, h: 80 } as const; // entry 0x2e
export const CHOICE_POS = [266, 270] as const; // entry 0x2d
export const SHOP_LIST = { x: 12, y: 50, w: 385, h: 184 } as const; // entry 0x28, 0x00972dd4
export const SHOP_DETAIL = { x: 400, y: 50, w: 240, h: 184 } as const; // entry 0x29, 0x009f2b58
export const MONEY_WINDOW = { x: 12, y: 418, w: 226, h: 27 } as const; // entry 0x2a, 0x009f3220
export const QUANTITY_WINDOW = { x: 12, y: 389, w: 160, h: 27 } as const; // entry 0x2c, 0x009f33c4
export const BANK_WINDOW = { x: 12, y: 389, w: 160, h: 27 } as const; // entry 0x2b, 0x009f2064
// The spinner at 0x2d: the Item Pack's numeric window (0x009f2c48) without
// a title. ASSUMED: same template, so 224 x 74.
export const SHOP_AMOUNT = { x: 266, y: 270, w: 224, h: 74 } as const;
// The tekker's item picture window: entry 0x32 (0x009720d0 = (124, 98)), 160 x
// 120 from the template 0x00971018 (FUN_00731460, unknown_get_itemkt_image).
export const ITEM_PICTURE = { x: 124, y: 98, w: 160, h: 120 } as const;
export const LIST_ROWS = 8; // (184 - 20 - 6 + 6) / 20

// --- shops -------------------------------------------------------------------

export const SHOP_TOOL = 0;
export const SHOP_WEAPON = 1;
export const SHOP_ARMOR = 2;

export type CounterKind = 'weapon' | 'armor' | 'tool' | 'bank' | 'tekker' | 'medical';
export type ShopKind = Exclude<CounterKind, 'bank' | 'tekker' | 'medical'>;

export interface ShopDef {
  shopType: number; // 6xB5 / 6xB6 type
  title: number; // unitxt_shop group 0: the list title and the sell title
  welcome: number; // greeting
}

// Group 0 ids: 0x26 "Arms Shop" / 0x27 its greeting (0x006d6a78, title in
// 0x006d54cc), 0x2a "Guards Shop" (0x006d3a10), 0x2d "Tools Shop"
// (0x006d8a40) / 0x2e its greeting (0x006d922c). The Guards Shop greeting is
// ASSUMED to be 0x2b, the entry after its name like the other two.
export const SHOPS: Record<ShopKind, ShopDef> = {
  weapon: { shopType: SHOP_WEAPON, title: 0x26, welcome: 0x27 },
  armor: { shopType: SHOP_ARMOR, title: 0x2a, welcome: 0x2b },
  tool: { shopType: SHOP_TOOL, title: 0x2d, welcome: 0x2e },
};

// bb_p2_menu number -> counter (P2_MENUS in formats/npcmodels.ts).
export const COUNTER_MENUS: Readonly<Record<number, CounterKind>> = { 0: 'weapon', 1: 'medical', 2: 'armor', 3: 'tool', 5: 'bank', 6: 'tekker' };

// unitxt_shop group 0 messages used here.
export const MSG = {
  yes: 0x00,
  no: 0x01,
  meseta: 0x02,
  item: 0x03,
  buy: 0x04,
  cancelBuy: 0x05,
  sell: 0x06,
  cancelSell: 0x07,
  deposit: 0x08,
  take: 0x09,
  whatBuy: 0x0b,
  whatSell: 0x0c,
  notEnoughMeseta: 0x0f,
  skill: 0x11,
  cannotEquip: 0x12,
  equipNow: 0x18,
  inventoryFull: 0x19,
  otherHelp: 0x1a,
  nothingToSell: 0x1b,
  walletFull: 0x1c,
  thanks: 0x2c,
  bankTitle: 0x30,
  bankWelcome: 0x31,
  takeWhat: 0x32,
  depositWhat: 0x33,
  depositHowMuch: 0x34,
  bankMesetaFull: 0x37,
  whichItem: 0x38,
  bankItemsFull: 0x3c,
  bankNoMeseta: 0x3d,
  bankNoItems: 0x3e,
  takeHowMuch: 0x3f,
  bankOtherHelp: 0x46,
  noMeseta: 0x47,
  comeAgain: 0x48,
  noItems: 0x49,
  takeWalletFull: 0x4a,
  takeInventoryFull: 0x4b,
} as const;

export const MESETA_MAX = 999999; // 0x000f423f
export const BANK_ITEMS_MAX = 200; // 0xc8 (0x006c8d08, the take list)
const INVENTORY_MAX = 30;

// --- prices (get_item_shop_cost 0x005d24dc) -------------------------------------

// GetStarValueFromPMTTable_005e5450: 0xB0 < id < 0x3E1.
function starValue(pmt: ItemPMT, id: number | undefined): number {
  return id !== undefined && id > 0xb0 && id < 0x3e1 ? pmt.itemStars(id) : 0;
}

// CalculateItemStarValue_005d693c for weapons and armor (by PMT id).
function itemPmtId(pmt: ItemPMT, d: Uint8Array, sRank: boolean): number | undefined {
  if (d[0] === 0) return pmt.getWeapon(d[1], sRank ? 0 : d[2])?.id;
  if (d[0] === 1) return (d[1] === 1 ? pmt.armors : d[1] === 2 ? pmt.shields : d[1] === 3 ? pmt.units : undefined)?.[d[2]]?.id;
  return undefined;
}

const s16at = (d: Uint8Array, i: number) => {
  const v = d[i] | (d[i + 1] << 8);
  return v & 0x8000 ? v - 0x10000 : v;
};
const s8 = (v: number) => (v & 0x80 ? v - 0x100 : v);

// get_unit_star_value: the unit's stars, one more / less with a +/- modifier,
// at most 12.
export function unitStars(pmt: ItemPMT, item: ItemData): number {
  const d = item.data1;
  let s = starValue(pmt, itemPmtId(pmt, d, false));
  const m = s16at(d, 6);
  if (m < 0) s -= 1;
  else if (m > 0) s += 1;
  s &= 0xff;
  return s > 0xb ? 0xc : s;
}

// get_item_shop_cost. Wrapped items cost 0; weapons with an unidentified
// special 8 and rare weapons / armor 80; weapons
//   trunc(special stars^2 * 1000 + bonus * (grind + ATP max)^2 / (divisor * 100))
// with bonus = 100 per slot plus the percentage of attributes 1..5; armor
//   trunc(trunc((DFP + EVP + their bonuses)^2 / divisor) + (level + 1) * (slots + 1) * 70);
// units trunc(stars * divisor), mags trunc((data1[2] + 1) * divisor), technique
// disks (level + 1) * cost, other tools their cost, meseta its amount.
// Divisors: ItemPMT root +0x20 (weapons, by data1[1] < 0xED) and +0x24
// (armor, shield, unit, mag); 0x0092c4a8 = 1000, 0x0092c4ac = 100,
// 0x0092c4b0 = 70.
export function itemShopCost(item: ItemData, pmt: ItemPMT): number {
  if (isWrapped(item)) return 0;
  const d = item.data1;
  let cost = 0;
  if (d[0] === 0) {
    if (d[4] & 0x80) return 8;
    const sRank = isSRankWeapon(item);
    const id = itemPmtId(pmt, d, sRank);
    if (starValue(pmt, id) >= 9) return 0x50;
    const w = pmt.getWeapon(d[1], sRank ? 0 : d[2]);
    const div = d[1] < 0xed ? (pmt.weaponSaleDivisors[d[1]] ?? 0) : 0;
    if (div === 0 || !w) return 0;
    const atp = Math.fround(d[3] + w.atpMax);
    const atp2 = Math.fround(atp * atp);
    let bonus = 0;
    for (let k = 0; k < 3; k++) {
      const type = d[6 + 2 * k];
      bonus += type === 0 || type > 5 ? 100 : 100 + s8(d[7 + 2 * k]);
    }
    const stars = d[4] & 0x3f && !(d[4] & 0x80) ? starValue(pmt, (d[4] & 0x3f) + 0x256) : 0;
    cost = Math.trunc(stars * stars * 1000 + (bonus * atp2) / (div * 100));
  } else if (d[0] === 1) {
    if (starValue(pmt, itemPmtId(pmt, d, false)) >= 9) return 0x50;
    if (d[1] === 3) {
      cost = Math.trunc(unitStars(pmt, item) * pmt.nonWeaponSaleDivisors.unit);
    } else {
      const div = d[1] === 1 ? pmt.nonWeaponSaleDivisors.armor : d[1] === 2 ? pmt.nonWeaponSaleDivisors.shield : 0;
      const a = d[1] === 1 ? pmt.armors[d[2]] : d[1] === 2 ? pmt.shields[d[2]] : undefined;
      if (div === 0 || !a) return 0;
      const power = a.dfp + a.evp + s16at(d, 6) + s16at(d, 8);
      cost = Math.trunc(Math.trunc((power * power) / div) + (a.requiredLevel + 1) * (d[5] + 1) * 70);
    }
  } else if (d[0] === 2) {
    cost = Math.trunc((d[2] + 1) * pmt.nonWeaponSaleDivisors.mag);
  } else if (d[0] === 3) {
    if (d[1] === 2) cost = (((d[2] + 1) & 0xff) * (pmt.getTool(2, d[4])?.cost ?? 0)) | 0;
    else cost = pmt.getTool(d[1], d[2])?.cost ?? 0;
  } else if (d[0] === 4) {
    cost = new DataView(item.data2.buffer, item.data2.byteOffset, 4).getInt32(0, true);
  }
  return cost < 0 ? 0 : cost;
}

// ShopDialog_UpdateItemDisplay_006d600c: (cost + (cost >> 31 >>> 29)) >> 3.
export function sellPrice(cost: number): number {
  return Math.trunc(cost / 8);
}

// ValidateQuestOpcodeFormat_006dc1f8 (misnamed): items that leave the shop
// list once bought (the rest can be bought again): technique disks, tools
// 09..0B, units, and these weapons.
export function soldOutWhenBought(item: ItemData): boolean {
  const [c0, c1, c2] = item.data1;
  if (c0 === 3) return c1 === 2 || (c1 > 8 && c1 < 0xc);
  if (c0 === 1) return c1 === 3;
  if (c0 !== 0) return false;
  switch (c1) {
    case 0x02:
    case 0x03:
    case 0x08:
    case 0x0c:
      return c2 === 6;
    case 0x04:
    case 0x05:
    case 0x07:
      return c2 === 7;
    case 0x09:
      return c2 === 5;
    case 0x0d:
    case 0x0e:
      return c2 === 1;
    case 0x11:
    case 0x12:
    case 0x14:
    case 0x15:
    case 0x21:
    case 0x24:
      return c2 === 0;
    default:
      return false;
  }
}

const sameTool = (a: ItemData, b: ItemData) => a.data1[0] === b.data1[0] && a.data1[1] === b.data1[1] && a.data1[2] === b.data1[2];

// Player_GetRemainingStackCapacity_0068ec44: how many more of the item fit.
export function stackCapacity(inventory: readonly InventoryItem[], item: ItemData, count = 1): number {
  const max = maxStackSize(item);
  if (max <= 1) return inventory.length > INVENTORY_MAX - 1 ? 0 : 1;
  const same = inventory.find((i) => sameTool(i.data, item));
  if (same) {
    const room = max - stackSize(same.data);
    return count <= room ? room : 0;
  }
  return inventory.length > INVENTORY_MAX - 1 ? 0 : max;
}

// CountGroundItemStack_006a4b74 (misnamed): how many of the item are carried.
export function carriedCount(inventory: readonly InventoryItem[], item: ItemData): number {
  const same = inventory.find((i) => sameTool(i.data, item));
  return same ? stackSize(same.data) : 0;
}

export type BuyCheck = 'meseta' | 'full' | 'class' | 'skill' | 'ok';

// ShopDialog_ValidateItem_006d5318 (weapons, armor): 0 meseta, 1 full, then
// ValidateItemForEquip_005c9e40: 2 the class cannot use it, 3 a requirement is
// not met, 4 fine (and the "equip it now?" question follows the purchase).
export function buyCheck(item: ItemData, price: number, character: CharacterFile, ctx: RowContext): BuyCheck {
  if (price > character.meseta) return 'meseta';
  if (stackCapacity(character.inventory, item) === 0) return 'full';
  const p = equipProblems(item, ctx);
  if (p) return p & 1 ? 'class' : 'skill';
  return 'ok';
}

// --- rows ----------------------------------------------------------------------

const COLOR = { white: '#ffffff', untekked: '#00fffc', cannot: '#909090', cannotIcon: '#aaaaaa', srank: '#fe3c28', rare: '#ffea00', bonus: '#61e853' };

// A shop row (UIElement_InitializeItemDisplay_0072b870 +
// UIElement_UpdateItemValidationState_0072bab0): the Item Pack row without the
// equipped / undroppable marks, the price at the right.
export function shopRow(item: ItemData, right: string, ctx: RowContext): ItemRow {
  const names = ctx.names;
  const row: ItemRow = {
    id: item.id,
    icon1: 0x36,
    icon2: categoryIcon(item, (k) => names?.pmt.weaponKinds[k]),
    name: itemRowName(item, names),
    count: right,
    nameColor: COLOR.white,
    iconColor: COLOR.white,
  };
  if (isWrapped(item)) return row;
  // GetPlayer(+6) null -> return (dump 694290): icon 1 stays 0x36, colours unset.
  if (ctx.player === false) return row;
  const problems = equipProblems(item, ctx);
  const tekked = isTekked(item);
  if (!tekked && names?.isRare(item)) row.icon1 = 0x19;
  else if (problems & 1) row.icon1 = 0x13;
  if (!tekked) row.nameColor = COLOR.untekked;
  else if (problems) {
    row.nameColor = COLOR.cannot;
    row.iconColor = COLOR.cannotIcon;
  } else if (isSRankWeapon(item)) row.nameColor = COLOR.srank;
  else if (names?.isRare(item)) row.nameColor = COLOR.rare;
  else if (hasBonuses(item)) row.nameColor = COLOR.bonus;
  return row;
}

// --- the counter windows -----------------------------------------------------------

export interface CounterItems {
  readonly shops: ReadonlyArray<ItemData[] | null>;
  readonly bank: { meseta: number; items: Array<{ data: ItemData; amount: number }> } | null;
  requestShop(shopType: number): void;
  buy(shopType: number, index: number, item: ItemData, amount: number, unitPrice: number): number | null;
  sell(itemId: number, amount: number, price: number): boolean;
  equip(itemId: number): void;
  unequip(itemId: number): void;
  requestBank(): void;
  depositMeseta(amount: number): void;
  takeMeseta(amount: number): void;
  depositItem(itemId: number, amount: number): void;
  takeItem(index: number, amount: number): void;
  leaveBank(): void;
  // The tekker (net/items.ts).
  readonly identifyResult: ItemData | null;
  identify(itemId: number): void;
  acceptIdentify(itemId: number, result: ItemData): void;
  pay(amount: number): void;
  takeItemId(): number;
  // The Medical Center (net/items.ts): what a treatment would fix (MEDICAL_NEED
  // bits) and the treatment itself.
  medicalNeeds(): number;
  useMedicalCenter(): void;
}

export interface CounterEnv {
  shopText: (index: number, group?: number) => string; // unitxt_shop, group 0 by default
  text: (group: number, index: number) => string; // unitxt
  character: () => CharacterFile | null;
  rowContext: () => RowContext;
  pmt: () => ItemPMT | null;
  items: CounterItems;
  // The item picture of an identified item (formats/itemkt.ts), or null.
  picture?: ((item: ItemData) => Promise<ImageBitmap | null>) | undefined;
  // Floor music for the counter's jingles (audio/fieldbgm.ts FieldMusic).
  music?: CounterMusic | undefined;
  log?: ((msg: string) => void) | undefined;
}

export interface CounterMusic {
  jingle(name: string): void; // replaces the floor track (FUN_00814f0c)
  restore(): void; // the floor track again
}

interface Choice {
  items: ListItem[];
  cursor: number;
  resolve: (value: number | null) => void;
}

interface ItemList {
  title: string;
  rows: ItemRow[];
  items: ItemData[]; // description per row
  cursor: number;
  top: number;
  resolve: ((index: number | null) => void) | null;
  quantity: ((index: number) => number) | null; // "Item Quantity" window
  detail: boolean; // the description window at 0x29
  bar: boolean; // the cursor bar
  // The "n/max" line (ListWindowObject_RenderItemText_007367d0, drawn when the
  // list's max is above 0): the bank's take list only. null: no line.
  capacity: number | null;
  // The stat panel instead of the description for a weapon / armour / shield (the
  // bank's take list and the shops' buy / sell lists: their 0x29 detail window draws
  // the equipment rows, see drawEquipPanel).
  panel: boolean;
}

class Closed extends Error {}

// Shared by the shops and the bank: the clerk's window, the choices, the item
// list, the spinner and the small counters, driven by awaited prompts.
abstract class CounterBase {
  protected env: CounterEnv;
  protected clerk = new InfoWindow(CLERK.x, CLERK.y, CLERK.w, CLERK.h);
  private waitEnter: (() => void) | null = null;
  // The wait also takes Backspace (MedicalCenterDialog_CheckMenuInput_006dc8fc).
  private waitCancel = false;
  protected choice: Choice | null = null;
  protected list: ItemList | null = null;
  // The item picture window (0x32) while it is up.
  protected picture: ImageBitmap | null = null;
  private amount: { spinner: AmountSpinner; resolve: (v: number | null) => void } | null = null;
  private polls: Array<{ test: () => boolean; resolve: () => void }> = [];
  protected showBankMeseta = false;
  // unitxt_shop group of the clerk's lines (the tekker's depends on the
  // section id).
  protected textGroup = 0;
  private pages: string[] = [];
  // Frames ticked (30 a second), for the states that count frames.
  private frames = 0;
  private closed = false;
  done = false;
  onClose: () => void = () => {};

  constructor(env: CounterEnv) {
    this.env = env;
    // InfoWindow types 2 characters a frame; the exe's speed is not recovered.
    this.clerk.speed = 2;
  }

  start(): void {
    void this.run()
      .catch((err) => {
        if (!(err instanceof Closed)) this.env.log?.(`counter: ${(err as Error).message}`);
      })
      .finally(() => {
        this.done = true;
        this.picture = null;
        this.leave();
        this.onClose();
      });
  }

  protected abstract run(): Promise<void>;

  // Runs when the counter closes (after its last line or a force-close).
  protected leave(): void {}

  // Force-close (leaving the floor): every pending prompt rejects.
  close(): void {
    this.closed = true;
    this.waitEnter?.();
    this.choice?.resolve(null);
    this.list?.resolve?.(null);
    this.amount?.resolve(null);
    for (const p of this.polls) p.resolve();
  }

  protected check(): void {
    if (this.closed) throw new Closed();
  }

  // The clerk's line (vtable +0x14(id, 1)); `wait` = the state waits for it
  // to finish typing and for Enter (vtable +0x20, ShopDialog_CheckMenuInput_006dc988).
  protected say(id: number): void {
    // "\tP" splits a line into pages, each read with Enter (as quest/town.ts
    // does for the guild lines).
    const [first, ...rest] = this.env.shopText(id, this.textGroup).replace(/\t[CEJ][0-9A-Za-z]?/g, '').split('\tP');
    this.clerk.set(first);
    this.pages = rest;
  }

  protected async tell(id: number): Promise<void> {
    this.say(id);
    await this.read();
  }

  // Waits for Enter on the line shown (finishing its typing first);
  // `cancel`: Backspace once it is typed out ends the wait too.
  protected async read(cancel = false): Promise<void> {
    for (;;) {
      this.waitCancel = cancel;
      await new Promise<void>((r) => (this.waitEnter = r));
      this.waitEnter = null;
      this.check();
      const next = this.pages.shift();
      if (next === undefined) return;
      this.clerk.set(next);
    }
  }

  // A state that counts down `n` frames.
  protected async delay(n: number): Promise<void> {
    const end = this.frames + n;
    await this.until(() => this.frames >= end);
  }

  // A choice at 0x2d of unitxt_shop entries; resolves with the entry's index
  // or null on Backspace.
  protected async choose(ids: number[], cursor = 0): Promise<number | null> {
    const v = await new Promise<number | null>((resolve) => {
      this.choice = { items: ids.map((id, i) => ({ label: this.env.shopText(id), value: i, enabled: true })), cursor, resolve };
    });
    this.choice = null;
    this.check();
    return v;
  }

  protected async yesNo(): Promise<boolean> {
    return (await this.choose([MSG.yes, MSG.no])) === 0;
  }

  protected async spin(max: number): Promise<number | null> {
    const v = await new Promise<number | null>((resolve) => (this.amount = { spinner: new AmountSpinner(max), resolve }));
    this.amount = null;
    this.check();
    return v;
  }

  protected showList(
    title: string,
    rows: ItemRow[],
    items: ItemData[],
    quantity: ItemList['quantity'] = null,
    opts: { detail?: boolean; bar?: boolean; capacity?: number; panel?: boolean } = {},
  ): void {
    const cursor = this.list ? Math.min(this.list.cursor, Math.max(0, rows.length - 1)) : 0;
    this.list = {
      title,
      rows,
      items,
      cursor,
      top: 0,
      resolve: null,
      quantity,
      detail: opts.detail ?? true,
      bar: opts.bar ?? true,
      capacity: opts.capacity ?? null,
      panel: opts.panel ?? false,
    };
    this.clampTop();
  }

  protected async pick(): Promise<number | null> {
    const list = this.list;
    if (!list) return null;
    const v = await new Promise<number | null>((resolve) => (list.resolve = resolve));
    list.resolve = null;
    this.check();
    return v;
  }

  protected closeList(): void {
    this.list = null;
  }

  // A state that polls (the buy window waits for 6xB6, the bank for 6xBC).
  protected async until(test: () => boolean): Promise<void> {
    if (!test()) await new Promise<void>((resolve) => this.polls.push({ test, resolve }));
    this.check();
  }

  private clampTop(): void {
    const l = this.list;
    if (!l) return;
    if (l.cursor < l.top) l.top = l.cursor;
    if (l.cursor >= l.top + LIST_ROWS) l.top = l.cursor - LIST_ROWS + 1;
    l.top = Math.max(0, Math.min(l.top, Math.max(0, l.rows.length - LIST_ROWS)));
  }

  tick(): void {
    this.frames++;
    this.clerk.tick();
    const ready = this.polls.filter((p) => p.test());
    if (ready.length) {
      this.polls = this.polls.filter((p) => !ready.includes(p));
      for (const p of ready) p.resolve();
    }
  }

  get typing(): boolean {
    return this.clerk.shownLength < this.clerk.text.length;
  }

  key(e: KeyboardEvent): void {
    if (this.waitEnter) {
      if (menuKeyOf(e) === 'decide' && !e.repeat) {
        if (this.typing) this.clerk.finish();
        else this.waitEnter();
      } else if (this.waitCancel && (menuKeyOf(e) === 'cancel') && !e.repeat && !this.typing) {
        this.waitEnter();
      }
      return;
    }
    if (this.amount) {
      const { spinner: a, resolve } = this.amount;
      if (menuKeyOf(e) === 'up') (a.up(), se(SE.cursor));
      else if (menuKeyOf(e) === 'down') (a.down(), se(SE.cursor));
      else if (menuKeyOf(e) === 'left') (a.left(), se(SE.cursor));
      else if (menuKeyOf(e) === 'right') (a.right(), se(SE.cursor));
      else if (menuKeyOf(e) === 'decide') {
        if (a.value < a.min || a.value > a.max) return void se(SE.buzzer);
        se(SE.ok);
        resolve(a.value);
      } else if (menuKeyOf(e) === 'cancel') {
        se(SE.cancel);
        resolve(null);
      }
      return;
    }
    if (this.choice) {
      const c = this.choice;
      const n = c.items.length;
      if (menuKeyOf(e) === 'up' || menuKeyOf(e) === 'down') {
        c.cursor = (c.cursor + (menuKeyOf(e) === 'up' ? n - 1 : 1)) % n;
        se(SE.cursor);
      } else if (menuKeyOf(e) === 'decide' && !e.repeat) {
        se(SE.ok);
        c.resolve(c.cursor);
      } else if (menuKeyOf(e) === 'cancel') {
        se(SE.cancel);
        c.resolve(null);
      }
      return;
    }
    const l = this.list;
    if (l?.resolve) {
      const n = l.rows.length;
      if ((menuKeyOf(e) === 'up' || menuKeyOf(e) === 'down') && n) {
        l.cursor = (l.cursor + (menuKeyOf(e) === 'up' ? n - 1 : 1)) % n;
        this.clampTop();
        se(SE.cursor);
      } else if (menuKeyOf(e) === 'decide' && !e.repeat) {
        // ShopDialog_ProcessItemSelection_006d5200: SE 0x570 on Enter and on
        // Backspace alike.
        se(SE.ok);
        if (n) l.resolve(l.cursor);
      } else if (menuKeyOf(e) === 'cancel') {
        se(SE.ok);
        l.resolve(null);
      }
    }
  }

  // --- drawing ---------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: ItemPackTextures, extra: number): void {
    const c = this.env.character();
    const l = this.list;
    if (l) {
      this.drawList(ctx, skin, tex, l);
      const item = l.items[l.cursor];
      const R = SHOP_DETAIL;
      if (item && l.detail) {
        const rect = { x: anchorX(R.x, R.w, extra), y: R.y, w: R.w, h: R.h };
        const rc = this.env.rowContext();
        if (l.panel && rc.names && hasEquipPanel(item)) drawEquipPanel(ctx, skin, this.env, item, false, rc, rect);
        else drawTextWindow(ctx, skin, rect, itemDescription(item, rc.names));
      }
      if (l.quantity && item) this.drawCount(ctx, skin, QUANTITY_WINDOW, this.env.text(12, 1), l.quantity(l.cursor));
    }
    if (this.picture) this.drawPicture(ctx, skin, extra, this.picture);
    if (this.showBankMeseta && this.env.items.bank && !l) this.drawCount(ctx, skin, BANK_WINDOW, this.env.text(12, 2), this.env.items.bank.meseta);
    this.drawCount(ctx, skin, MONEY_WINDOW, this.env.text(11, 0x9b), c?.meseta ?? 0);
    if (this.clerk.text) this.clerk.draw(ctx, skin, extra);
    if (this.choice) {
      const w = Math.max(...this.choice.items.map((i) => gameTextWidth(i.label))) + 2 * INSET;
      drawListWindow(ctx, skin, anchorX(CHOICE_POS[0], w, extra), CHOICE_POS[1], w, null, this.choice.items, this.choice.cursor);
    }
    if (this.amount) {
      const R = SHOP_AMOUNT;
      drawAmountWindow(ctx, skin, tex, this.amount.spinner, { ...R, x: anchorX(R.x, R.w, extra) }, null);
    }
  }

  // The picture window: the frame, then the picture inside it (ASSUMED: the
  // picture fills the inset, the exe's texture scale is not decoded).
  private drawPicture(ctx: CanvasRenderingContext2D, skin: WindowSkin, extra: number, img: ImageBitmap): void {
    const P = ITEM_PICTURE;
    const x = anchorX(P.x, P.w, extra);
    drawWindowFrame(ctx, skin.frame, x, P.y, P.w, P.h);
    ctx.drawImage(img, x + INSET, P.y + INSET, P.w - 2 * INSET, P.h - 2 * INSET);
  }

  protected jingle(name: string): void {
    this.jingled = true;
    this.env.music?.jingle(name);
  }

  protected jingled = false;

  private drawList(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: ItemPackTextures, l: ItemList): void {
    const L = SHOP_LIST;
    drawWindowFrame(ctx, skin.frame, L.x, L.y, L.w, L.h);
    const cx = L.x + INSET;
    const cy = L.y + INSET + TITLE_GAP;
    const cw = L.w - 2 * INSET;
    if (l.rows.length && l.bar) drawSelectBar(ctx, skin.bars, cx, cy + (l.cursor - l.top) * ROW, cw, 16);
    l.rows.slice(l.top, l.top + LIST_ROWS).forEach((r, i) => {
      const y = cy + i * ROW;
      drawIcon(ctx, tex.icons, r.icon1, cx, y, r.iconColor, 0);
      drawIcon(ctx, tex.icons, r.icon2, cx + 18, y, r.iconColor, 0);
      if (r.name) drawGameText(ctx, r.name, cx + 36, y, r.nameColor);
      if (r.count) drawGameText(ctx, r.count, cx + cw - gameTextWidth(r.count), y, r.nameColor);
    });
    drawWindowTitle(ctx, skin, L.x, L.y, l.title);
    if (l.capacity !== null) this.drawCapacity(ctx, skin, L, `${l.rows.length}/${l.capacity}`);
  }

  // The "n/max" line: a pill of the title's kind with the number in it (the
  // exe draws it with RenderTextCharacter_00760b74, the title's pill routine).
  // ASSUMED placement: the bottom-right corner, on the frame's lower edge.
  private drawCapacity(ctx: CanvasRenderingContext2D, skin: WindowSkin, L: WindowRect, text: string): void {
    const tw = gameTextWidth(text);
    const x = L.x + L.w - INSET - pillWidth(tw);
    const y = L.y + L.h - 13;
    drawTitlePill(ctx, skin.frame, x, y, tw, 0);
    drawGameText(ctx, text, x + (pillWidth(tw) - tw) / 2, y + 4 + 1, '#120400');
  }

  // A one-line counter window: its label at the left, the number at the
  // right edge (ASSUMED element layout; the frames are 0x009f3220 / 0x009f33c4 /
  // 0x009f2064).
  private drawCount(ctx: CanvasRenderingContext2D, skin: WindowSkin, R: WindowRect, label: string, value: number): void {
    drawWindowFrame(ctx, skin.frame, R.x, R.y, R.w, R.h);
    const y = R.y + (R.h - LINE) / 2;
    drawGameText(ctx, label, R.x + INSET, y);
    const v = String(value);
    drawGameText(ctx, v, R.x + R.w - INSET - gameTextWidth(v), y);
  }

  // Console / test aid.
  state(): {
    message: string;
    choice: string[] | null;
    list: string[] | null;
    cursor: number;
    amount: number | null;
    picture: boolean;
    capacity: number | null;
    panel: boolean | null; // the list's detail is the equipment stat panel (null: no list)
  } {
    return {
      message: this.clerk.text,
      choice: this.choice?.items.map((i) => i.label) ?? null,
      list: this.list?.rows.map((r) => r.name) ?? null,
      cursor: this.list?.cursor ?? -1,
      amount: this.amount?.spinner.value ?? null,
      picture: this.picture !== null,
      capacity: this.list?.capacity ?? null,
      panel: this.list ? this.list.panel : null,
    };
  }
}

// --- shops ---------------------------------------------------------------------------

interface ShopEntry {
  index: number; // in the 6xB6 list (6xB7 item_index)
  item: ItemData;
  price: number;
}

export class ShopCounter extends CounterBase {
  readonly kind: ShopKind;
  private def: ShopDef;
  // Items bought out of this visit's list (ShopDialog_MarkItemUnavailable_*:
  // data2 = -1 hides them).
  private soldOut = new Set<number>();

  constructor(env: CounterEnv, kind: ShopKind) {
    super(env);
    this.kind = kind;
    this.def = SHOPS[kind];
  }

  protected async run(): Promise<void> {
    // Greeting (0x006d6a78 / 0x006d922c): the line and Buy / Sell at once.
    this.say(this.def.welcome);
    for (;;) {
      const v = await this.choose([MSG.buy, MSG.sell]);
      if (v === null) {
        // 0x006d6820: "Thank you!" (0x2c), then state 9 closes once read.
        await this.tell(MSG.thanks);
        return;
      }
      if (v === 0) {
        if (!this.env.items.shops[this.def.shopType]) {
          this.env.items.requestShop(this.def.shopType); // 6xB5 (HandleActionPacket0x62_006d7f5c)
          await this.until(() => !!this.env.items.shops[this.def.shopType]);
        }
        if (this.kind === 'tool') await this.buyTools();
        else await this.buyEquipment();
      } else {
        const sold = await this.sellWindow();
        if (!sold) {
          // WeaponStoreDialog_Callback_006d6ad8: "no items to sell" (0x1b),
          // then 0x1a.
          await this.tell(MSG.nothingToSell);
        }
      }
      // LAB_006d4a00: back to Buy / Sell with "Do you need any other help?".
      this.closeList();
      this.say(MSG.otherHelp);
    }
  }

  private entries(): ShopEntry[] {
    const pmt = this.env.pmt();
    const items = this.env.items.shops[this.def.shopType] ?? [];
    // 0x006d3a10 / 0x006d54cc / 0x006d8a40: the client's own price.
    return items
      .map((item, index) => ({ index, item, price: pmt ? itemShopCost(item, pmt) : new DataView(item.data2.buffer, item.data2.byteOffset, 4).getUint32(0, true) }))
      .filter((e) => !this.soldOut.has(e.index));
  }

  private showShopList(entries: ShopEntry[], quantity: boolean): void {
    const ctx = this.env.rowContext();
    const c = this.env.character();
    this.showList(
      this.env.shopText(this.def.title),
      entries.map((e) => shopRow(e.item, String(e.price), ctx)),
      entries.map((e) => e.item),
      quantity && c ? (i) => carriedCount(c.inventory, entries[i].item) : null,
      // The buy list's detail is the same 0x29 window as the Check Room's (ShopDialog_UpdateItemDisplay_006d600c
      // -> GameList_RenderSelectionDisplay_00727450): a weapon / armour / shield gets the stat rows.
      { panel: true },
    );
  }

  // The weapon / armor buy window (states 0x006d4d64; ASSUMED the same for
  // the armor shop's 0x006d3a10 set).
  private async buyEquipment(): Promise<void> {
    for (;;) {
      // State 0: the list and "What would you like to buy?" (0xb).
      const entries = this.entries();
      this.showShopList(entries, false);
      this.say(MSG.whatBuy);
      let entry: ShopEntry | undefined;
      let ask = false;
      for (;;) {
        const i = await this.pick();
        if (i === null) return; // state 3
        entry = entries[i];
        const c = this.env.character();
        if (!entry || !c) continue;
        const check = buyCheck(entry.item, entry.price, c, this.env.rowContext());
        if (check === 'meseta' || check === 'full') {
          // States 5 / 6: the line, then back to the list with 0xb.
          await this.tell(check === 'meseta' ? MSG.notEnoughMeseta : MSG.inventoryFull);
          this.say(MSG.whatBuy);
          continue;
        }
        if (check === 'class') this.say(MSG.cannotEquip);
        else if (check === 'skill') this.say(MSG.skill);
        ask = check === 'ok';
        break;
      }
      // State 8 / 2: Buy / Cancel.
      const v = await this.choose([MSG.buy, MSG.cancelBuy]);
      if (v !== 0) continue;
      let equip = false;
      if (ask) {
        // State 9: "Do you wish to equip it now?" and Yes / No; both buy.
        this.say(MSG.equipNow);
        equip = (await this.choose([MSG.yes, MSG.no])) === 0;
      }
      this.purchase(entry, 1, equip);
    }
  }

  // The tool buy window (states 0x006d830c).
  private async buyTools(): Promise<void> {
    for (;;) {
      const entries = this.entries();
      this.showShopList(entries, true);
      this.say(MSG.whatBuy);
      for (;;) {
        const i = await this.pick();
        if (i === null) return;
        const entry = entries[i];
        const c = this.env.character();
        if (!entry || !c) continue;
        // CheckStackCapacityForJoin_006d876c.
        if (entry.price > c.meseta || stackCapacity(c.inventory, entry.item) === 0) {
          await this.tell(entry.price > c.meseta ? MSG.notEnoughMeseta : MSG.inventoryFull);
          this.say(MSG.whatBuy);
          continue;
        }
        // State 7 (0x006d87dc): a spinner up to what fits and is affordable.
        const max = Math.min(stackCapacity(c.inventory, entry.item), entry.price > 0 ? Math.floor(c.meseta / entry.price) : 1);
        let amount = 1;
        if (max > 1) {
          const n = await this.spin(max);
          if (n === null) continue;
          amount = n;
        }
        const v = await this.choose([MSG.buy, MSG.cancelBuy]);
        if (v !== 0) continue;
        this.purchase(entry, amount, false);
        break;
      }
    }
  }

  private purchase(entry: ShopEntry, amount: number, equip: boolean): void {
    const items = this.env.items;
    const id = items.buy(this.def.shopType, entry.index, entry.item, amount, entry.price);
    if (id === null) return;
    if (soldOutWhenBought(entry.item)) this.soldOut.add(entry.index);
    if (equip) {
      // ShopDialog_HandleItemSelection_006d4de8: the slot's item comes off,
      // the new one goes on.
      const c = this.env.character();
      const d = entry.item.data1;
      const old = c?.inventory.find((i) => i.equipped && i.data.id !== id && i.data.data1[0] === d[0] && (d[0] !== 1 || i.data.data1[1] === d[1]) && !(d[0] === 1 && d[1] === 3));
      if (old) items.unequip(old.data.id);
      items.equip(id);
    }
  }

  // The sell window (states 0x006d5960). Returns false when there was nothing
  // to sell (state 7).
  private async sellWindow(): Promise<boolean> {
    let first = true;
    for (;;) {
      const c = this.env.character();
      const pmt = this.env.pmt();
      if (!c || !pmt) return false;
      // GetDropItemInstancesExcludingFlag0x80_006a520c: ASSUMED to leave out
      // the equipped items. Rows with a cost of 0 are skipped.
      const sellable = c.inventory.filter((it) => !it.equipped && itemShopCost(it.data, pmt) > 0);
      if (!sellable.length) {
        this.closeList();
        return !first;
      }
      first = false;
      const ctx = this.env.rowContext();
      const prices = sellable.map((it) => sellPrice(itemShopCost(it.data, pmt)));
      this.showList(
        this.env.shopText(this.def.title),
        sellable.map((it, i) => ({ ...itemRow(it, ctx), count: String(prices[i]) })),
        sellable.map((it) => it.data),
        (i) => stackSize(sellable[i].data),
        { panel: true }, // the same 0x29 detail as the buy list (see showShopList)
      );
      this.say(MSG.whatSell);
      const i = await this.pick();
      if (i === null) return true; // state 8
      const it = sellable[i];
      let amount = 1;
      const count = stackSize(it.data);
      if (it.data.data1[0] === 3 && count > 1) {
        const n = await this.spin(count);
        if (n === null) continue; // state 5
        amount = n;
      }
      const v = await this.choose([MSG.sell, MSG.cancelSell]);
      if (v !== 0) continue;
      if (!this.env.items.sell(it.data.id, amount, prices[i] * amount)) {
        await this.tell(MSG.walletFull); // state 4
      }
    }
  }
}

// --- bank ------------------------------------------------------------------------------

// The CHECK ROOM (bank_menu_handler_table 0x009cec80): 0 sends 6xBB, 1 waits
// for 6xBC, 2 greeting (0x006ca124: 0x31, the Money and Deposit windows),
// 3 Deposit / Take (handle_bank_deposit_take_menu), 4 / 11 Meseta / Item for
// deposit (0x33) / take (0x32), 7 / 6 meseta deposit (0x006c99ec /
// 0x006c9b94), 8 / 13 meseta take (0x006c9c7c / 0x006c9e14), 5 item deposit
// (0x006c9850 -> the window at 0x006da468), 10 item take (0x006c9f08 ->
// BankItemTakeMenuDialog 0x006d75e4), Backspace on Deposit / Take: 0x48 and
// the 6xBD "leave" (BankDialog_Callback_006c9954).
export class BankCounter extends CounterBase {
  protected async run(): Promise<void> {
    const items = this.env.items;
    items.requestBank();
    await this.until(() => !!items.bank);
    this.showBankMeseta = true;
    this.say(MSG.bankWelcome);
    try {
      for (;;) {
        const v = await this.choose([MSG.deposit, MSG.take]);
        if (v === null) {
          await this.tell(MSG.comeAgain);
          return;
        }
        if (v === 0) await this.depositMenu();
        else await this.takeMenu();
      }
    } finally {
      items.leaveBank();
    }
  }

  private async depositMenu(): Promise<void> {
    for (;;) {
      this.say(MSG.depositWhat);
      const v = await this.choose([MSG.meseta, MSG.item]);
      if (v === null) {
        this.say(MSG.bankOtherHelp);
        return;
      }
      const again = v === 0 ? await this.depositMeseta() : await this.depositItems();
      if (!again) return;
    }
  }

  private async takeMenu(): Promise<void> {
    for (;;) {
      this.say(MSG.takeWhat);
      const v = await this.choose([MSG.meseta, MSG.item]);
      if (v === null) {
        this.say(MSG.bankOtherHelp);
        return;
      }
      const again = v === 0 ? await this.takeMeseta() : await this.takeItems();
      if (!again) return;
    }
  }

  // States 7 / 6. Returns true to go back to Meseta / Item (Backspace on the
  // spinner), false for Deposit / Take.
  private async depositMeseta(): Promise<boolean> {
    const c = this.env.character();
    const bank = this.env.items.bank;
    if (!c || !bank) return false;
    if (c.meseta === 0 || bank.meseta >= MESETA_MAX) {
      // State 0x11: the line, then 0x46 and Deposit / Take.
      await this.tell(c.meseta === 0 ? MSG.noMeseta : MSG.bankMesetaFull);
      this.say(MSG.bankOtherHelp);
      return false;
    }
    this.say(MSG.depositHowMuch);
    // ASSUMED limit: what is carried, and what the bank still takes.
    const n = await this.spin(Math.min(c.meseta, MESETA_MAX - bank.meseta));
    this.say(MSG.bankOtherHelp);
    if (n === null) return true;
    this.env.items.depositMeseta(n);
    return false;
  }

  // States 8 / 13.
  private async takeMeseta(): Promise<boolean> {
    const c = this.env.character();
    const bank = this.env.items.bank;
    if (!c || !bank) return false;
    if (bank.meseta === 0 || c.meseta >= MESETA_MAX) {
      await this.tell(bank.meseta === 0 ? MSG.bankNoMeseta : MSG.takeWalletFull);
      this.say(MSG.bankOtherHelp);
      return false;
    }
    this.say(MSG.takeHowMuch);
    const n = await this.spin(Math.min(bank.meseta, MESETA_MAX - c.meseta));
    this.say(MSG.bankOtherHelp);
    if (n === null) return true;
    this.env.items.takeMeseta(n);
    return false;
  }

  // State 5 and the deposit window (0x006da468): the inventory titled "Check
  // Room" (0x30); the spinner for stacks, then Yes / No (the window's own
  // lines are not recovered: ASSUMED none). Leaving it: 0x1a
  // (InitializeBankDialog_006c9370), back to Deposit / Take.
  private async depositItems(): Promise<boolean> {
    const bank = this.env.items.bank;
    if (!bank) return false;
    if (bank.items.length >= BANK_ITEMS_MAX) {
      await this.tell(MSG.bankItemsFull);
      this.say(MSG.bankOtherHelp);
      return false;
    }
    this.say(MSG.whichItem);
    for (;;) {
      const c = this.env.character();
      if (!c) return false;
      // FUN_006daac4 / FUN_006a520c: the candidates are the inventory items
      // without flag 0x80 (ASSUMED: the equipped ones), in slot order; the
      // list has no "n/max" line (its max stays 0).
      const inv = c.inventory.filter((it) => !it.equipped);
      if (!inv.length) {
        this.closeList();
        await this.tell(MSG.noItems);
        break;
      }
      const ctx = this.env.rowContext();
      this.showList(this.env.shopText(MSG.bankTitle), inv.map((it) => itemRow(it, ctx)), inv.map((it) => it.data), (i) => stackSize(inv[i].data));
      const i = await this.pick();
      if (i === null) break;
      const it = inv[i];
      let amount = 1;
      if (stackSize(it.data) > 1) {
        const n = await this.spin(stackSize(it.data));
        if (n === null) continue;
        amount = n;
      }
      if (!(await this.yesNo())) continue;
      if ((this.env.items.bank?.items.length ?? 0) >= BANK_ITEMS_MAX) {
        await this.tell(MSG.bankItemsFull);
        continue;
      }
      this.env.items.depositItem(it.data.id, maxStackSize(it.data) > 1 ? amount : 1);
    }
    this.closeList();
    this.say(MSG.otherHelp);
    return false;
  }

  // State 10 and BankItemTakeMenuDialog (0x006d75e4): the bank's items titled
  // "Check Room"; 0x3e when empty, 0x4b when the item does not fit.
  private async takeItems(): Promise<boolean> {
    for (;;) {
      const bank = this.env.items.bank;
      const c = this.env.character();
      if (!bank || !c) return false;
      if (!bank.items.length) {
        this.closeList();
        await this.tell(MSG.bankNoItems);
        break;
      }
      const ctx = this.env.rowContext();
      const list = bank.items.slice();
      // FUN_006d7b50: the list's max is set to 200 (FUN_007400c0), so the
      // "n/200" line shows the bank's item count.
      this.showList(
        this.env.shopText(MSG.bankTitle),
        list.map((b) => shopRow(b.data, maxStackSize(b.data) > 1 ? `×${b.amount}` : '', ctx)),
        list.map((b) => b.data),
        (i) => list[i].amount,
        { capacity: BANK_ITEMS_MAX, panel: true },
      );
      const i = await this.pick();
      if (i === null) break;
      const b = list[i];
      if (stackCapacity(c.inventory, b.data) === 0) {
        await this.tell(MSG.takeInventoryFull);
        continue;
      }
      let amount = 1;
      if (maxStackSize(b.data) > 1 && b.amount > 1) {
        const n = await this.spin(Math.min(b.amount, stackCapacity(c.inventory, b.data)));
        if (n === null) continue;
        amount = n;
      }
      if (!(await this.yesNo())) continue;
      this.env.items.takeItem(i, amount);
    }
    this.closeList();
    this.say(MSG.otherHelp);
    return false;
  }
}

// --- tekker -----------------------------------------------------------------------------

// The JUDGMENT counter (p2_special_npc_menus entry 6: create
// CreateMedicalcenterDialog_006d6e1c -> MedicalcenterDialog_Constructor_006ce490,
// vtable 0x00b3be28, states 0x006ce528):
//   0 (0x006ce7e4) -> 1; 1 (0x006ce780) the clerk window at 0x2e, line [1]
//   and Money; 2 (0x006ce64c) waits for Enter; 3 (0x006ce598) opens the
//   appraisal window; 4 (0x006ce564) closes once the last line is read.
// The appraisal window (ShopDialog_Constructor_006d93e4, vtable 0x00b3ca60,
// states 0x006d945c, jump table 0x0096c3e8; its "line read" check, vtable
// +0x20 = 0x007083d4, is always true):
//   0 (0x006d94f2) the inventory items that are not identified (item vfunc
//     +0x84 = 0x005d2fb0: a weapon with data1[4] & 0x80 that is not wrapped)
//     in a list titled [0]; none: [2] and state 11;
//   1 (0x006da230) the list; Enter: [3] and Yes / No (state 2); Backspace:
//     state 10, whose callback (0x006ce688) says [0xd] and closes;
//   2 (0x006da050) Yes with more than 99 meseta: 6xB8, a 0x5f-frame timer,
//     BGM "Appraise", [6], state 3; Yes without: [5], state 11 (the callback
//     0x006ce6a8 closes after it); No / Backspace: [4], back to the list;
//   3 (0x006d9d94) once the timer is out and 6xB9 came: a list titled
//     "Result" (u"Result" @ 0x0096c444) with the item under a new id of ours
//     (increment_item_id_for_player), the picture window at 0x32 and the
//     description at 0x29, [8], state 4;
//   4 (0x006d9b98) Yes: pays 100 (subtract_inventory_meseta); if the
//     character can equip it (ValidateItemForEquip_005c9e40) [0xc] and state
//     7, else the swap (6x29 + 6xBA, the item back under the original id),
//     [0xb], BGM "Miniclear", state 0; No / Backspace: [9], state 6;
//   6 (0x006d999c) Yes: pays 100, [0xa], state 5 (3 frames, then Enter, then
//     [0xb] and state 0); No / Backspace: [8], state 4;
//   7 (0x006d96d8) Yes: the swap, the slot's item off and the new one on
//     (Player_EquipItem_0068de54); No / Backspace: the swap alone; [0xb],
//     state 0.
// The lines are unitxt_shop group 0x0096c6ec[section id] = 4 + section id
// (unknown_get_shop_unitxt_3, 0x006dbe14 for the title), the section id
// being the one that also picks the tekker's model (0x00a9c4d8).
// The picture window at 0x32 (124, 98), 160 x 120 (template 0x00971018), shows
// the item's ItemKTep4.afs picture (formats/itemkt.ts) while the Result list is
// up. The two BGM changes are j_kantei.adx (after 6xB8) and miniclear.adx
// (after the deal). Left out: the object created at 0x29's position (400, 50)
// with scale 0.75 when FUN_0078b208() > 2 (FUN_006d9d94, object 0xb4 via
// FUN_00725d18): its model is not traced.
export const TEKKER = {
  title: 0,
  welcome: 1,
  noUnknown: 2,
  cost: 3,
  changeItem: 4,
  noMeseta: 5,
  examining: 6,
  accept: 8,
  stillPay: 9,
  yourChoice: 0xa,
  anythingElse: 0xb,
  equipNow: 0xc,
  comeAgain: 0xd,
} as const;
export const TEKKER_FEE = 100; // 0x006da050: 99 < meseta; newserv on_identify_item_bb
export const TEKKER_WAIT = 0x5f; // state 3's timer, frames
export const TEKKER_RESULT_TITLE = 'Result'; // 0x0096c444 (0x0096c438 on a Japanese client)
// The two jingles (FUN_00814f0c, the ADX names at 0x0096c428 / 0x009699ac):
// the appraisal starts with j_kantei.adx, the end of a deal plays miniclear.adx.
export const TEKKER_APPRAISE_BGM = 'j_kantei.adx';
export const TEKKER_DONE_BGM = 'miniclear.adx';

// unitxt_shop group of the tekker's lines (0x0096c6ec: 4..13 by section id).
export function tekkerGroup(sectionId: number): number {
  return 4 + Math.max(0, Math.min(9, sectionId | 0));
}

// The items state 0 lists, in inventory order.
export function unidentifiedItems(inventory: readonly InventoryItem[]): InventoryItem[] {
  return inventory.filter((it) => !isTekked(it.data));
}

export class TekkerCounter extends CounterBase {
  protected async run(): Promise<void> {
    const items = this.env.items;
    this.textGroup = tekkerGroup(this.env.character()?.sectionId ?? 0);
    // Outer states 1 / 2.
    await this.tell(TEKKER.welcome);
    for (;;) {
      // State 0.
      const c = this.env.character();
      if (!c) return;
      const unknown = unidentifiedItems(c.inventory);
      if (!unknown.length) {
        this.closeList();
        await this.tell(TEKKER.noUnknown);
        return;
      }
      const ctx = this.env.rowContext();
      this.showList(
        this.env.shopText(TEKKER.title, this.textGroup),
        unknown.map((it) => itemRow(it, ctx)),
        unknown.map((it) => it.data),
        null,
        { detail: false },
      );
      // States 1 / 2.
      let picked: InventoryItem | null = null;
      while (!picked) {
        const i = await this.pick();
        if (i === null) {
          this.closeList();
          await this.tell(TEKKER.comeAgain);
          return;
        }
        this.say(TEKKER.cost);
        if ((await this.choose([MSG.yes, MSG.no])) !== 0) {
          this.say(TEKKER.changeItem);
          continue;
        }
        if (c.meseta < TEKKER_FEE) {
          this.closeList();
          await this.tell(TEKKER.noMeseta);
          return;
        }
        picked = unknown[i] ?? null;
      }
      const originalId = picked.data.id;
      items.identify(originalId);
      this.closeList();
      this.jingle(TEKKER_APPRAISE_BGM);
      this.say(TEKKER.examining);
      // State 3.
      await this.delay(TEKKER_WAIT);
      await this.until(() => items.identifyResult !== null);
      const answer = items.identifyResult!;
      const result: ItemData = { data1: answer.data1.slice(), id: items.takeItemId(), data2: answer.data2.slice() };
      this.picture = (await this.env.picture?.(result)) ?? null;
      this.showList(TEKKER_RESULT_TITLE, [shopRow(result, '', this.env.rowContext())], [result], null, { bar: false });
      this.say(TEKKER.accept);
      // States 4 / 6.
      for (;;) {
        if ((await this.choose([MSG.yes, MSG.no])) === 0) {
          this.closeList();
          this.picture = null;
          items.pay(TEKKER_FEE);
          let equip = false;
          if (equipProblems(result, this.env.rowContext()) === 0) {
            // State 7.
            this.say(TEKKER.equipNow);
            equip = (await this.choose([MSG.yes, MSG.no])) === 0;
          }
          this.accept(originalId, result, equip);
          this.jingle(TEKKER_DONE_BGM);
          this.say(TEKKER.anythingElse);
          break;
        }
        this.say(TEKKER.stillPay);
        if ((await this.choose([MSG.yes, MSG.no])) === 0) {
          this.closeList();
          this.picture = null;
          items.pay(TEKKER_FEE);
          this.say(TEKKER.yourChoice);
          // State 5.
          await this.delay(3);
          await this.read();
          this.say(TEKKER.anythingElse);
          break;
        }
        this.say(TEKKER.accept);
      }
    }
  }

  // The floor track comes back when the counter closes (ASSUMED: the exe
  // resumes the area track once nothing plays; the end is not traced).
  protected override leave(): void {
    if (this.jingled) this.env.music?.restore();
  }

  private accept(originalId: number, result: ItemData, equip: boolean): void {
    const items = this.env.items;
    items.acceptIdentify(originalId, result);
    if (!equip) return;
    // DialogbaseConfirmEquipState_006d96d8: the item in the weapon slot comes
    // off (Player_UnequipItem_0068dfd8), the new one goes on.
    const old = this.env.character()?.inventory.find((i) => i.equipped && i.data.id !== originalId && i.data.data1[0] === result.data1[0]);
    if (old) items.unequip(old.data.id);
    items.equip(originalId);
  }
}

// --- the Medical Center ------------------------------------------------------------
//
// bb_p2_menu 1 (p2_special_npc_menus entry 1: on_menu_open
// CreateMedicalCenterDialog_006d6c10 -> MedicalCenterDialog_Constructor_006cec20,
// vtable 0x00b3bf10, is-open GetMedicalCenterMenuState_006d6c04). Its update
// (vtable +0x24, 0x006ce9a4) jumps on the state (+0x20) through 0x0096bb18:
//   0 (vtable +0x28, 0x006ce7e4): BankDialog_CheckVisibility_006dc7d4, state 1;
//   1 (MedicalcenterDialog_EnterState2_006cef18): the clerk window at GUI
//     position 0x2e, 80 high (0x42a00000), line 0x1f, the "Money" window
//     (bank_meseta_inventory_count_constructor), state 2;
//   2 (0x006cebcc) once the line is read (vtable +0x20 and
//     ShopDialog_CheckMenuInput_006dc988): nothing to treat
//     (SinowberillChallengePlayer_GetStatusFlags_0068bfe0 == 0, outside
//     challenge mode) -> state 6, else state 7;
//   7 (0x006cea30): line 0x20 and Yes / No (yes_no_list_constructor at 0x2d),
//     state 3;
//   3 (0x006ceb4c): Yes -> state 4; No or Backspace -> state 5;
//   4 (HandleSeabedTuriganeChallengeAction_006ceabc): with less than 10
//     meseta line 0x0f; else SE 0x41f, 6x31, 6x32, the particle and SE 0x41f
//     at the player (SinowberillChallengePlayer_UpdateAudio_00688fd0),
//     subtract_inventory_meseta(10), 6xC5, line 0x22; state 10;
//   5 (0x006ceaa4): line 0x24, state 8;  6 (0x006cea8c): line 0x21, state 8;
//   8 (0x006ce9fc) once read: line 0x22, state 10;
//   10 (vtable +0x2c, 0x006ce564) once read with Enter or Backspace
//     (MedicalCenterDialog_CheckMenuInput_006dc8fc): closes.
// The lines are unitxt_shop group 0 (the shops' group). The cost is a plain
// 10 (immediates at 0x006ceacb / 0x006ceb1a), whatever the level; newserv
// takes the same 10 on 6xC5 (on_medical_center_bb).
// Left out: the camera move to the nurse (move_camera_to_p2_special_npc), the
// particle, and the challenge-mode branch (IsSeabedTuriganeChallengeEligible
// _00695388 / CheckChallengeStateEligibility_006953f0).
export const MEDICAL = {
  welcome: 0x1f,
  cost: 0x20,
  fine: 0x21,
  goodLuck: 0x22,
  careful: 0x24,
  notEnoughMeseta: 0x0f,
} as const;
export const SE_MEDICAL = 0x41f; // city.pac

// What needs treatment: combat/status.ts medicalNeeds.
export class MedicalCounter extends CounterBase {
  protected async run(): Promise<void> {
    const items = this.env.items;
    // States 1 / 2.
    await this.tell(MEDICAL.welcome);
    if (!items.medicalNeeds()) {
      // State 6.
      this.say(MEDICAL.fine);
    } else {
      // States 7 / 3.
      this.say(MEDICAL.cost);
      if ((await this.choose([MSG.yes, MSG.no])) === 0) {
        // State 4.
        if ((this.env.character()?.meseta ?? 0) < MEDICAL_COST) {
          this.say(MEDICAL.notEnoughMeseta);
        } else {
          // The first SE is 2D, the second at the player; both the same slot.
          se(SE_MEDICAL);
          items.useMedicalCenter();
          this.say(MEDICAL.goodLuck);
        }
        // State 10.
        await this.read(true);
        return;
      }
      // State 5.
      this.say(MEDICAL.careful);
    }
    // State 8, then 10.
    await this.read();
    this.say(MEDICAL.goodLuck);
    await this.read(true);
  }
}

export type Counter = ShopCounter | BankCounter | TekkerCounter | MedicalCounter;

export function createCounter(env: CounterEnv, kind: CounterKind): Counter {
  if (kind === 'bank') return new BankCounter(env);
  if (kind === 'tekker') return new TekkerCounter(env);
  if (kind === 'medical') return new MedicalCounter(env);
  return new ShopCounter(env, kind);
}

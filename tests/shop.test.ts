// Pioneer 2 shops and bank (classic/shop.ts) and their commands (net/items.ts):
// get_item_shop_cost, the sell price, the sold-out rule, the stack capacity,
// the window layout, the 6xB5..6xC0 bytes and key-driven counter flows.
// Run: node tests/shop.test.ts
import {
  BankCounter,
  BANK_WINDOW,
  buyCheck,
  carriedCount,
  CHOICE_POS,
  CLERK,
  COUNTER_MENUS,
  itemShopCost,
  MONEY_WINDOW,
  MSG,
  QUANTITY_WINDOW,
  sellPrice,
  SHOP_DETAIL,
  SHOP_LIST,
  ShopCounter,
  SHOPS,
  soldOutWhenBought,
  stackCapacity,
  unitStars,
  type CounterEnv,
  type CounterItems,
} from '../client/src/classic/shop.ts';
import type { RowContext } from '../client/src/classic/itempack.ts';
import { ItemPMT } from '../client/src/formats/itempmt.ts';
import { itemFromHex, ItemNames, type ItemData } from '../client/src/formats/itemnames.ts';
import type { CharacterFile, InventoryItem } from '../client/src/net/charfile.ts';
import {
  buildBankAction,
  buildBankRequest,
  buildBuyShopItem,
  buildSellItem,
  buildShopRequest,
  BANK_DEPOSIT,
  BANK_LEAVE,
  BANK_TAKE,
  parseBankContents,
  parseShopContents,
} from '../client/src/net/items.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// --- a small ItemPMT ---
const pmt = new ItemPMT();
const base = (id: number) => ({ id, type: 0, skin: 0, teamPoints: 0 });
pmt.weapons[1] = [];
pmt.weapons[1][0] = { ...base(0x177), atpMax: 40, usabilityFlags: 0xff, atpRequired: 0, ataRequired: 0, mstRequired: 0 } as never; // Saber
pmt.weapons[1][1] = { ...base(0x178), atpMax: 100, usabilityFlags: 0xff, atpRequired: 0, ataRequired: 0, mstRequired: 0 } as never; // a rare
pmt.weapons[2] = [];
pmt.weapons[2][6] = { ...base(0x179), atpMax: 1, usabilityFlags: 0xff, atpRequired: 0, ataRequired: 0, mstRequired: 0 } as never;
pmt.weaponSaleDivisors = [0, 5];
pmt.armors[0] = { ...base(0x200), dfp: 5, evp: 7, requiredLevel: 2 } as never; // Frame
pmt.shields[0] = { ...base(0x201), dfp: 3, evp: 4, requiredLevel: 0 } as never;
pmt.units[0] = { ...base(0x202) } as never;
pmt.mags[0] = { ...base(0x203) } as never;
pmt.nonWeaponSaleDivisors = { armor: 3, shield: 2, unit: 50, mag: 7.5 };
pmt.tools[0] = [{ ...base(0x204), cost: 50, amount: 0, tech: 0, itemFlags: 2 } as never];
pmt.tools[2] = [{ ...base(0x205), cost: 100, amount: 0, tech: 0, itemFlags: 2 } as never];
pmt.starValues = new Array(0x400).fill(0);
pmt.starValues[0x178 - 0xb1] = 9; // rare
pmt.starValues[0x202 - 0xb1] = 3; // unit: 3 stars
pmt.starValues[0x256 + 1 - 0xb1] = 2; // special 1: 2 stars

// --- get_item_shop_cost (0x005d24dc) ---
const saber = itemFromHex('000100000000000000000000');
eq(itemShopCost(saber, pmt), Math.trunc((300 * 40 * 40) / (5 * 100)), 'Saber: 300 * 40^2 / 500');
eq(itemShopCost(itemFromHex('000100030000000000000000'), pmt), Math.trunc((300 * 43 * 43) / 500), 'grind adds to ATP max');
eq(itemShopCost(itemFromHex('000100000100013200000000'), pmt), Math.trunc(2 * 2 * 1000 + (350 * 1600) / 500), 'special stars^2 * 1000, +50% native');
eq(itemShopCost(itemFromHex('0001000000000632011e0000'), pmt), Math.trunc((300 + 30) * 1600 / 500), 'attribute 6 is ignored, attribute 1 counts');
eq(itemShopCost(itemFromHex('0001000081000000000000'), pmt), 8, 'unidentified special: 8');
eq(itemShopCost(itemFromHex('000101000000000000000000'), pmt), 80, 'rare weapon: 80');
eq(itemShopCost(itemFromHex('000100004000000000000000'), pmt), 0, 'wrapped: 0');
eq(itemShopCost(itemFromHex('000500000000000000000000'), pmt), 0, 'no divisor: 0');
// Frame with 2 slots, +1 DFP: trunc((5 + 7 + 1)^2 / 3) + (2 + 1) * 3 * 70.
eq(itemShopCost(itemFromHex('010100000002010000000000'), pmt), Math.trunc(169 / 3) + 3 * 3 * 70, 'armor');
eq(itemShopCost(itemFromHex('010200000000000000000000'), pmt), Math.trunc(49 / 2) + 70, 'shield');
eq(unitStars(pmt, itemFromHex('010300000000ffff00000000')), 2, 'unit with "-": one star less');
eq(itemShopCost(itemFromHex('010300000000010000000000'), pmt), 4 * 50, 'unit "+": 4 stars * 50');
eq(itemShopCost(itemFromHex('020005000000000000000000'), pmt), Math.trunc(6 * 7.5), 'mag: (data1[2] + 1) * divisor');
eq(itemShopCost(itemFromHex('030000000000000000000000'), pmt), 50, 'tool cost');
eq(itemShopCost(itemFromHex('030204000000000000000000'), pmt), 5 * 100, 'disk Lv.5: 5 * cost');
eq(sellPrice(1)  , 0, 'sell 1 -> 0');
eq(sellPrice(960), 120, 'sell: cost / 8');
eq(sellPrice(967), 120, 'sell rounds down');

// --- sold out once bought (0x006dc1f8) ---
eq(soldOutWhenBought(itemFromHex('030204')), true, 'disks leave the list');
eq(soldOutWhenBought(itemFromHex('030000')), false, 'Monomate stays');
eq(soldOutWhenBought(itemFromHex('030a00')), true, 'tool 0A leaves');
eq(soldOutWhenBought(itemFromHex('010300')), true, 'units leave');
eq(soldOutWhenBought(itemFromHex('010100')), false, 'frames stay');
eq(soldOutWhenBought(itemFromHex('000100')), false, 'Saber stays');
eq(soldOutWhenBought(itemFromHex('000206')), true, 'weapon 02 06 leaves');
eq(soldOutWhenBought(itemFromHex('000d01')), true, 'weapon 0D 01 leaves');

// --- stack capacity (0x0068ec44) ---
const inv = (h: string, equipped = false): InventoryItem => ({ index: 0, state: 1, flags: equipped ? 8 : 0, extensionData1: 0, extensionData2: 0, equipped, data: itemFromHex(h) });
const mates = inv('030000000004000000000000 00010001 00000000');
eq(stackCapacity([mates], itemFromHex('030000000001')), 6, 'room left in the stack');
eq(stackCapacity([mates], itemFromHex('030100000001')), 10, 'a new stack');
eq(stackCapacity(Array(30).fill(mates), saber), 0, 'full inventory');
eq(carriedCount([mates], itemFromHex('030000')), 4, 'carried count');

// --- layout (position table 0x00971f40, sizes) ---
eq([CLERK.x, CLERK.y, CLERK.w, CLERK.h], [294, 365, 332, 80], 'clerk window 0x2e, 332 x 80');
eq([...CHOICE_POS], [266, 270], 'choices at 0x2d');
eq([SHOP_LIST.x, SHOP_LIST.y, SHOP_LIST.w, SHOP_LIST.h], [12, 50, 385, 184], 'list at 0x28');
eq([SHOP_DETAIL.x, SHOP_DETAIL.y, SHOP_DETAIL.w, SHOP_DETAIL.h], [400, 50, 240, 184], 'description at 0x29');
eq([MONEY_WINDOW.x, MONEY_WINDOW.y, MONEY_WINDOW.w], [12, 418, 226], 'Money at 0x2a, 226 wide');
eq([QUANTITY_WINDOW.x, QUANTITY_WINDOW.y, BANK_WINDOW.y], [12, 389, 389], 'quantity 0x2c, bank 0x2b');
eq([SHOPS.weapon.shopType, SHOPS.armor.shopType, SHOPS.tool.shopType], [1, 2, 0], '6xB5 types');
eq([SHOPS.weapon.title, SHOPS.armor.title, SHOPS.tool.title], [0x26, 0x2a, 0x2d], 'list titles');
eq(COUNTER_MENUS, { 0: 'weapon', 2: 'armor', 3: 'tool', 5: 'bank', 6: 'tekker' }, 'bb_p2_menu counters');

// --- commands ---
eq(hex(buildShopRequest(1)), 'b502ffff01000000', '6xB5 weapon shop');
eq(hex(buildBuyShopItem(0x00010005, 1, 3, 1)), 'b703ffff050001000103010' + '0', '6xB7 {id, type, index, amount}');
eq(hex(buildSellItem(2, 0x00410001, 3)), 'c003020001004100' + '03000000', '6xC0 {item id, amount}');
eq(hex(buildBankRequest()), 'bb02ffff00000000', '6xBB');
eq(hex(buildBankAction(BANK_DEPOSIT, { meseta: 500 })), 'bd04ffffffffffff' + 'f4010000' + '0000ffff', '6xBD deposit meseta (0x006c9c2c)');
eq(hex(buildBankAction(BANK_TAKE, { meseta: 20 })), 'bd04ffffffffffff' + '14000000' + '0100ffff', '6xBD take meseta (0x006c9eac)');
eq(hex(buildBankAction(BANK_DEPOSIT, { itemId: 0x10002, amount: 2 })), 'bd04ffff02000100' + '00000000' + '0002ffff', '6xBD deposit item');
eq(hex(buildBankAction(BANK_LEAVE)).slice(24, 26), '03', '6xBD leave');
const b6 = new Uint8Array(8 + 2 * 0x14);
b6.set([0xb6, 0x0c, 0, 0, 1, 2], 0);
b6.set(saber.data1, 8);
b6.set([0x20, 0x03], 8 + 0x10);
eq(parseShopContents(b6)?.items.map((i) => [i.data1[1], i.data2[0] | (i.data2[1] << 8)]), [[1, 800], [0, 0]], '6xB6 parse');
const bc = new Uint8Array(0x14 + 0x18);
const bdv = new DataView(bc.buffer);
bc[0] = 0xbc;
bdv.setUint32(0x0c, 1, true);
bdv.setUint32(0x10, 1234, true);
bc.set(itemFromHex('030000000003').data1, 0x14);
bdv.setUint32(0x14 + 12, 0x99000000, true);
bdv.setUint16(0x14 + 0x14, 3, true);
const bank = parseBankContents(bc);
eq([bank?.meseta, bank?.items[0].amount, bank?.items[0].data.id], [1234, 3, 0x99000000], '6xBC parse');

// --- counter flows ---
const text: string[][] = [];
text[1] = [];
text[3] = [];
const names = new ItemNames(pmt, text);
const tick = async (c: { tick(): void }, n = 200) => {
  for (let i = 0; i < n; i++) c.tick();
  await new Promise((r) => setTimeout(r, 0));
};
const press = async (c: { key(e: KeyboardEvent): void; tick(): void }, ...keys: string[]) => {
  for (const key of keys) {
    await tick(c);
    c.key({ key } as KeyboardEvent);
    await tick(c, 1);
  }
};

function makeEnv(character: CharacterFile, calls: string[], shopItems: ItemData[]) {
  const shops: Array<ItemData[] | null> = [null, null, null];
  let bankState: { meseta: number; items: Array<{ data: ItemData; amount: number }> } | null = null;
  const items: CounterItems = {
    shops,
    get bank() {
      return bankState;
    },
    requestShop: (t) => {
      calls.push(`6xB5 ${t}`);
      shops[t] = shopItems;
    },
    buy: (t, i, item, n, price) => {
      calls.push(`buy ${t} #${i} x${n} @${price}`);
      character.meseta -= price * n;
      return 0x10010;
    },
    sell: (id, n, price) => {
      calls.push(`sell ${id.toString(16)} x${n} ${price}`);
      character.meseta += price;
      character.inventory = character.inventory.filter((it) => it.data.id !== id);
      return true;
    },
    equip: (id) => calls.push(`equip ${id.toString(16)}`),
    unequip: (id) => calls.push(`unequip ${id.toString(16)}`),
    requestBank: () => {
      calls.push('6xBB');
      bankState = { meseta: 100, items: [] };
    },
    depositMeseta: (n) => {
      calls.push(`deposit ${n}`);
      bankState!.meseta += n;
      character.meseta -= n;
    },
    takeMeseta: (n) => calls.push(`take ${n}`),
    depositItem: (id, n) => calls.push(`deposit item ${id.toString(16)} x${n}`),
    takeItem: (i, n) => calls.push(`take item ${i} x${n}`),
    leaveBank: () => calls.push('leave'),
  };
  const ctx: RowContext = { names, charClass: 0, level: 5, stats: { atp: 100, mst: 0, ata: 100 }, lobby: false };
  const env: CounterEnv = {
    shopText: (i) => `#${i.toString(16)}`,
    text: () => '',
    character: () => character,
    rowContext: () => ctx,
    pmt: () => pmt,
    items,
  };
  return env;
}

{
  // Weapon shop: Buy -> 6xB5 -> list -> Saber -> Buy -> equip now? Yes.
  const calls: string[] = [];
  const ch = { charClass: 0, level: 5, meseta: 2000, inventory: [] as InventoryItem[], stats: { atp: 100, mst: 0, ata: 100 } } as unknown as CharacterFile;
  const shopSaber = itemFromHex('000100000000000000000000 ffffffff 20030000');
  const c = new ShopCounter(makeEnv(ch, calls, [shopSaber, itemFromHex('000206000000000000000000')]), 'weapon');
  let closed = false;
  c.onClose = () => (closed = true);
  c.start();
  await tick(c);
  eq(c.state().message, '#27', 'greeting 0x27');
  eq(c.state().choice, ['#4', '#6'], 'Buy / Sell');
  await press(c, 'Enter');
  eq(calls, ['6xB5 1'], '6xB5 sent for the weapon list');
  eq(c.state().message, '#b', 'What would you like to buy?');
  eq(c.state().list?.length, 2, 'two items listed');
  await press(c, 'Enter');
  eq(c.state().choice, ['#4', '#5'], 'Buy / Cancel');
  await press(c, 'Enter');
  eq(c.state().message, '#18', 'equip it now?');
  await press(c, 'Enter');
  eq(calls.slice(1), ['buy 1 #0 x1 @960', 'equip 10010'], 'bought at the client price and equipped');
  eq(c.state().list?.length, 2, 'the Saber stays in the list');
  await press(c, 'ArrowDown', 'Enter', 'Enter', 'ArrowDown', 'Enter');
  eq(calls.slice(3), ['buy 1 #1 x1 @0'], 'second item, not equipped (No)');
  eq(c.state().list?.length, 1, 'weapon 02 06 is sold out');
  await press(c, 'Backspace');
  eq(c.state().message, '#1a', 'back: other help');
  await press(c, 'Backspace');
  eq(c.state().message, '#2c', 'Thank you');
  await press(c, 'Enter');
  await tick(c);
  eq(closed, true, 'closed after the last line');
}

{
  // Not enough meseta, then the sell window.
  const calls: string[] = [];
  const mate = inv('030000000003000000000000 01000100 00000000');
  const ch = { charClass: 0, level: 5, meseta: 10, inventory: [mate], stats: { atp: 100, mst: 0, ata: 100 } } as unknown as CharacterFile;
  const c = new ShopCounter(makeEnv(ch, calls, [itemFromHex('000100000000000000000000')]), 'armor');
  c.start();
  await press(c, 'Enter', 'Enter');
  eq(c.state().message, '#f', 'not enough meseta');
  await press(c, 'Enter');
  eq(c.state().message, '#b', 'back to the list');
  await press(c, 'Backspace', 'ArrowDown', 'Enter');
  eq(c.state().message, '#c', 'What do you want to sell?');
  eq(c.state().list?.length, 1, 'the Monomates');
  await press(c, 'Enter');
  eq(c.state().amount, 1, 'spinner for a stack of 3');
  await press(c, 'ArrowUp', 'ArrowUp', 'Enter', 'Enter');
  eq(calls, ['6xB5 2', 'sell 10001 x3 18'], 'sold 3 for 3 * (50 / 8)');
  await tick(c);
  eq(c.state().message, '#1a', 'nothing left: back with other help');
}

{
  // Tool shop: spinner capped by meseta.
  const calls: string[] = [];
  const ch = { charClass: 0, level: 5, meseta: 120, inventory: [] as InventoryItem[], stats: { atp: 100, mst: 0, ata: 100 } } as unknown as CharacterFile;
  const c = new ShopCounter(makeEnv(ch, calls, [itemFromHex('030000000001')]), 'tool');
  c.start();
  await press(c, 'Enter', 'Enter');
  eq(c.state().amount, 1, 'tool spinner');
  await press(c, 'ArrowDown', 'Enter', 'Enter');
  eq(calls, ['6xB5 0', 'buy 0 #0 x2 @50'], 'Down wraps to the max: 120 / 50 = 2');
}

{
  // Bank: deposit 50 meseta, leave.
  const calls: string[] = [];
  const ch = { charClass: 0, level: 5, meseta: 300, inventory: [] as InventoryItem[], stats: { atp: 100, mst: 0, ata: 100 } } as unknown as CharacterFile;
  const c = new BankCounter(makeEnv(ch, calls, []));
  c.start();
  await tick(c);
  eq(c.state().message, '#31', 'bank greeting');
  eq(c.state().choice, ['#8', '#9'], 'Deposit / Take');
  await press(c, 'Enter');
  eq([c.state().message, c.state().choice], ['#33', ['#2', '#3']], 'Meseta / Item');
  await press(c, 'Enter');
  eq(c.state().message, '#34', 'How much are you depositing?');
  c.key({ key: 'ArrowLeft' } as KeyboardEvent);
  await press(c, 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'Enter');
  eq(calls, ['6xBB', 'deposit 51'], 'deposited 51');
  eq(c.state().message, '#46', 'other help');
  await press(c, 'ArrowDown', 'Enter', 'ArrowDown', 'Enter');
  eq(c.state().message, '#3e', 'no items in the stock room');
  await press(c, 'Enter', 'Backspace', 'Backspace');
  eq(c.state().message, '#48', 'please come again');
  await press(c, 'Enter');
  await tick(c);
  eq(calls.at(-1), 'leave', '6xBD leave on close');
}

eq(buyCheck(saber, 10, { meseta: 5, inventory: [] } as unknown as CharacterFile, { names, charClass: 0, level: 1, stats: { atp: 0, mst: 0, ata: 0 }, lobby: false }), 'meseta', 'buy check: meseta first');

if (failures) {
  console.log(`shop: ${failures} failure(s)`);
  process.exit(1);
}
console.log('shop: all checks passed');

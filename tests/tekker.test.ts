// The tekker (classic/shop.ts TekkerCounter, bb_p2_menu 6) and its commands
// (net/items.ts 6xB8 / 6xB9 / 6xBA): the section-id text group, the list of
// unidentified items, the key-driven appraisal flows (accept with and without
// equipping, refuse, not enough meseta, leave) and GameItems' side of it.
// Run: node tests/tekker.test.ts
import {
  COUNTER_MENUS,
  ITEM_PICTURE,
  MSG,
  SHOP_DETAIL,
  TEKKER,
  TEKKER_FEE,
  TEKKER_RESULT_TITLE,
  TEKKER_WAIT,
  TekkerCounter,
  tekkerGroup,
  unidentifiedItems,
  type CounterEnv,
  type CounterItems,
} from '../client/src/classic/shop.ts';
import { itemRow, type RowContext } from '../client/src/classic/itempack.ts';
import { shopRow } from '../client/src/classic/shop.ts';
import { ItemPMT } from '../client/src/formats/itempmt.ts';
import { itemFromHex, ItemNames, type ItemData } from '../client/src/formats/itemnames.ts';
import type { CharacterFile, InventoryItem } from '../client/src/net/charfile.ts';
import { buildAcceptIdentify, buildIdentifyItem, GameItems, parseIdentifyResult } from '../client/src/net/items.ts';
import type { Game } from '../client/src/net/game.ts';
import { itemPictureEntry } from '../client/src/formats/itemkt.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// --- text group and list ---
eq([tekkerGroup(0), tekkerGroup(2), tekkerGroup(9), tekkerGroup(12)], [4, 6, 13, 13], 'group 0x0096c6ec[section id] = 4 + id');
eq(COUNTER_MENUS[6], 'tekker', 'bb_p2_menu 6 is the tekker');
eq([TEKKER_FEE, TEKKER_WAIT, TEKKER_RESULT_TITLE], [100, 0x5f, 'Result'], 'fee, timer, result title');

const inv = (h: string, equipped = false): InventoryItem => ({ index: 0, state: 1, flags: equipped ? 8 : 0, extensionData1: 0, extensionData2: 0, equipped, data: itemFromHex(h) });
const unknownSaber = () => inv('000100008000000000000000 02000100 00000000'); // data1[4] & 0x80
const wrappedUnknown = inv('00010000c000000000000000 03000100 00000000'); // wrapped: listed as tekked
const knownSaber = inv('000100000000000000000000 04000100 00000000', true);
const mate = inv('030000000003000000000000 05000100 00000000');
eq(unidentifiedItems([knownSaber, unknownSaber(), wrappedUnknown, mate]).map((i) => i.data.id), [0x10002], 'vfunc +0x84 (0x005d2fb0): unidentified, not wrapped');

// --- commands ---
eq(hex(buildIdentifyItem(0x00010002)), 'b802ffff02000100', '6xB8 {item id} (ProcessActionPacket0x62_006ce6b8)');
eq(hex(buildAcceptIdentify(0x00010002)), 'ba02ffff02000100', '6xBA {item id} (Player_AddItemToInventory_0068f48c)');
const b9 = new Uint8Array(0x18);
b9.set([0xb9, 0x06, 0x01, 0x00], 0);
b9.set(itemFromHex('000100000500000000000000').data1, 4);
new DataView(b9.buffer).setUint32(16, 0x00010002, true);
const r = parseIdentifyResult(b9);
eq([r?.clientId, r?.item.id, r?.item.data1[4]], [1, 0x10002, 5], '6xB9 parse');

// --- counter flows ---
const pmt = new ItemPMT();
const base = (id: number) => ({ id, type: 0, skin: 0, teamPoints: 0 });
pmt.weapons[1] = [];
pmt.weapons[1][0] = { ...base(0x177), atpMax: 40, usabilityFlags: 0xff, atpRequired: 0, ataRequired: 0, mstRequired: 0 } as never;
pmt.weapons[2] = [];
pmt.weapons[2][0] = { ...base(0x179), atpMax: 40, usabilityFlags: 0x00, atpRequired: 0, ataRequired: 0, mstRequired: 0 } as never; // nobody can equip
pmt.starValues = new Array(0x400).fill(0);
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

// The server identifies by clearing the 0x80 flag and setting data1[4] = 5.
function makeEnv(character: CharacterFile, calls: string[], answerAfter = 0, extra: Partial<CounterEnv> = {}) {
  let result: ItemData | null = null;
  let pendingFrames = -1;
  let sent: ItemData | null = null;
  let nextId = 0x10020;
  const items = {
    shops: [],
    bank: null,
    get identifyResult() {
      return result;
    },
    identify: (id: number) => {
      calls.push(`6xB8 ${id.toString(16)}`);
      sent = character.inventory.find((i) => i.data.id === id)!.data;
      pendingFrames = answerAfter;
      if (!answerAfter) answer();
    },
    acceptIdentify: (id: number, res: ItemData) => {
      calls.push(`accept ${id.toString(16)} ${res.data1[4]}`);
      character.inventory = character.inventory.filter((i) => i.data.id !== id);
      character.inventory.push({ index: 0, state: 1, flags: 0, extensionData1: 0, extensionData2: 0, equipped: false, data: { ...res, id } });
      result = null;
    },
    pay: (n: number) => {
      calls.push(`pay ${n}`);
      character.meseta -= n;
    },
    takeItemId: () => nextId++,
    equip: (id: number) => calls.push(`equip ${id.toString(16)}`),
    unequip: (id: number) => calls.push(`unequip ${id.toString(16)}`),
  } as unknown as CounterItems;
  function answer() {
    const d = sent!.data1.slice();
    d[4] = 5;
    result = { data1: d, id: sent!.id, data2: new Uint8Array(4) };
  }
  const ctx: RowContext = { names, charClass: 0, level: 5, stats: { atp: 100, mst: 0, ata: 100 }, lobby: false };
  const env: CounterEnv = {
    // [2] has two pages, as the real line does ("\tP").
    shopText: (i, g = 0) => `${g}#${i.toString(16)}` + (g && i === TEKKER.noUnknown ? '\tPpage 2' : ''),
    text: () => '',
    character: () => character,
    rowContext: () => ctx,
    pmt: () => pmt,
    items,
    ...extra,
  };
  return {
    env,
    // Lets a delayed 6xB9 arrive.
    advance: () => {
      if (pendingFrames > 0 && --pendingFrames === 0) answer();
    },
  };
}
const character = (meseta: number, inventory: InventoryItem[]) =>
  ({ charClass: 0, level: 5, sectionId: 2, meseta, inventory, stats: { atp: 100, mst: 0, ata: 100 } }) as unknown as CharacterFile;

{
  // Accept and equip.
  const calls: string[] = [];
  const ch = character(500, [knownSaber, unknownSaber()]);
  const { env } = makeEnv(ch, calls);
  const c = new TekkerCounter(env);
  let closed = false;
  c.onClose = () => (closed = true);
  c.start();
  await tick(c);
  eq(c.state().message, '6#1', 'greeting [1] of group 4 + section id');
  eq(c.state().list, null, 'no list before the greeting is read');
  await press(c, 'Enter');
  eq(c.state().list?.length, 1, 'one unidentified item listed');
  await press(c, 'Enter');
  eq([c.state().message, c.state().choice], ['6#3', [`0#${MSG.yes}`, `0#${MSG.no}`]], 'the fee and Yes / No');
  await press(c, 'ArrowDown', 'Enter');
  eq([c.state().message, c.state().choice, c.state().list?.length], ['6#4', null, 1], 'No: change the item?, back to the list');
  await press(c, 'Enter', 'Enter');
  eq(calls, ['6xB8 10002'], '6xB8 on Yes');
  eq([c.state().message, c.state().list], ['6#6', null], 'examining, list closed');
  // The answer is in, but the timer runs 0x5f frames.
  for (let i = 0; i < TEKKER_WAIT - 2; i++) c.tick();
  await tick(c, 0);
  eq(c.state().list, null, 'no result before the timer runs out');
  await tick(c, 5);
  eq([c.state().list?.length, c.state().message], [1, '6#8'], 'Result shown, accept?');
  await press(c, 'ArrowDown', 'Enter');
  eq(c.state().message, '6#9', 'No: you still pay');
  await press(c, 'ArrowDown', 'Enter');
  eq(c.state().message, '6#8', 'No again: back to accept?');
  await press(c, 'Enter');
  eq(c.state().message, '6#c', 'Yes: equip it now? (the class can equip it)');
  eq(calls.slice(1), ['pay 100'], 'pays 100 on accept');
  await press(c, 'Enter');
  eq(calls.slice(2), ['accept 10002 5', 'unequip 10004', 'equip 10002'], 'swap, the old weapon off, the new one on');
  eq([ch.meseta, c.state().message], [400, '6#2'], 'list rebuilt: no unknown items left ([0xb] replaced by [2])');
  await press(c, 'Enter');
  eq([c.state().message, closed], ['page 2', false], '"\\tP": Enter shows the second page');
  await press(c, 'Enter');
  await tick(c);
  eq(closed, true, 'closed after [2]');
}

{
  // Accept an item the class cannot equip: no question, no equip.
  const calls: string[] = [];
  const ch = character(500, [inv('000200008000000000000000 02000100 00000000'), unknownSaber()]);
  ch.inventory[1].data.id = 0x10003;
  const { env } = makeEnv(ch, calls);
  const c = new TekkerCounter(env);
  c.start();
  await press(c, 'Enter', 'Enter', 'Enter');
  await tick(c, TEKKER_WAIT + 2);
  eq(c.state().message, '6#8', 'result');
  await press(c, 'Enter');
  eq([calls.slice(1), c.state().message], [['pay 100', 'accept 10002 5'], '6#b'], 'accepted without the equip question, Anything else?');
  eq(c.state().list?.length, 1, 'the other unknown item is listed again');
  await press(c, 'Backspace');
  eq([c.state().message, c.state().list], ['6#d', null], 'Backspace: come again');
}

{
  // Refuse: pays, the item stays unknown; then not enough meseta.
  const calls: string[] = [];
  const ch = character(150, [unknownSaber()]);
  const { env, advance } = makeEnv(ch, calls, 150);
  const c = new TekkerCounter(env);
  let closed = false;
  c.onClose = () => (closed = true);
  c.start();
  const tickA = async (n: number) => {
    for (let i = 0; i < n; i++) {
      advance();
      c.tick();
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  await press(c, 'Enter', 'Enter', 'Enter');
  await tickA(TEKKER_WAIT + 10);
  eq(c.state().list, null, 'waits for 6xB9 past the timer');
  await tickA(200);
  eq(c.state().message, '6#8', 'result once 6xB9 came');
  await press(c, 'Backspace');
  eq(c.state().message, '6#9', 'Backspace: you still pay');
  await press(c, 'Enter');
  eq([calls.slice(1), ch.meseta, c.state().message, c.state().list], [['pay 100'], 50, '6#a', null], 'refused: paid, your choice');
  await press(c, 'Enter');
  eq([c.state().message, c.state().list?.length], ['6#b', 1], 'Anything else? and the list again');
  await press(c, 'Enter', 'Enter');
  eq([c.state().message, c.state().list, calls.length], ['6#5', null, 2], 'under 100 meseta: no 6xB8, earn some meseta');
  await press(c, 'Enter');
  await tick(c);
  eq(closed, true, 'closed after [5]');
}

// --- GameItems: 6xB8, 6xB9, the swap and newserv's 6xBE echo ---
{
  const handlers: Record<string, (...a: never[]) => void> = {};
  const sent62: string[] = [];
  const sent60: string[] = [];
  const game = {
    on: (ev: string, fn: (...a: never[]) => void) => (handlers[ev] = fn),
    conn: { onCommand: () => {}, send: (_cmd: number, _flag: number, body: Uint8Array) => sent62.push(hex(body)) },
    info: null,
    players: new Map(),
    selfId: 1,
    leaderId: 0,
    active: true,
    sendSubcommand: (sub: number, body: Uint8Array) => sent60.push(`${sub.toString(16)} ${hex(body)}`),
  } as unknown as Game;
  const ch = character(500, [unknownSaber()]);
  ch.inventory[0].data.id = 0x00210000;
  const items = new GameItems(game, { character: () => ch, fullCharacter: () => null } as never);
  const sub = handlers.subcommand as unknown as (sub: number, clientId: number, body: Uint8Array) => void;
  items.identify(0x00210000);
  eq(sent62, ['b802ffff00002100'], 'identify sends 6xB8 via 62');
  const other = b9.slice();
  new DataView(other.buffer).setUint32(16, 0x00010002, true);
  sub(0xb9, 1, other);
  eq(items.identifyResult?.data1[4], 0x80, 'a 6xB9 for another id: the item as sent (0x006ce718)');
  items.identify(0x00210000);
  const mine = b9.slice();
  new DataView(mine.buffer).setUint32(16, 0x00210000, true);
  sub(0xb9, 1, mine);
  eq([items.identifyResult?.id, items.identifyResult?.data1[4]], [0x00210000, 5], '6xB9 for our id');
  items.acceptIdentify(0x00210000, items.identifyResult!);
  eq(sent60, ['29 00002100' + '01000000'], '6x29 {item id, 1} via 60');
  eq(sent62.slice(2), ['ba02ffff00002100'], 'then 6xBA via 62');
  eq(ch.inventory.map((i) => [i.data.id, i.data.data1[4]]), [[0x00210000, 5]], 'the identified item under the same id');
  const be = new Uint8Array(0x18);
  be.set([0xbe, 0x06, 0x01, 0x00], 0);
  be.set(mine.subarray(4), 4);
  sub(0xbe, 1, be);
  eq(ch.inventory.length, 1, "newserv's 6xBE echo does not duplicate it");
}

// --- the item picture (ItemKTep4.afs entry, FUN_005e5870) ---
const d1 = (kind: number, sub: number) => Uint8Array.from([kind, sub, 0, 0, 0, 0, 0, 0]);
eq(
  [itemPictureEntry(d1(0, 1), 0xb1), itemPictureEntry(d1(0, 1), 0x256), itemPictureEntry(d1(0, 1), 0x257), itemPictureEntry(d1(0, 1), undefined), itemPictureEntry(d1(2, 0x10)), itemPictureEntry(d1(2, 0x52)), itemPictureEntry(d1(1, 0x10))],
  [0x52, 0x1f7, 0x1f8, 0x1f8, 0x10, 0, null],
  'weapon: name id - 0x5f inside 0xb1..0x256, else 0x1f8; tool: its id below 0x52, else 0; armor: none',
);
// The windows the Result draws: GUI table 0x00971f40 + id * 8. The picture window 0x32 is
// (124, 98) at 0x009720d0 and 160 x 120 from the template at 0x00971018. The description
// window 0x29 is (400, 50) at 0x00972088, 240 x 184 (ShopDialog's detail). Read with
// tools/exedata.py read 009720d0 f 2 and 00972088 f 2.
eq(
  [ITEM_PICTURE.x, ITEM_PICTURE.y, ITEM_PICTURE.w, ITEM_PICTURE.h],
  [124, 98, 160, 120],
  'picture window 0x32 (exe GUI table, template 0x00971018)',
);
eq([SHOP_DETAIL.x, SHOP_DETAIL.y, SHOP_DETAIL.w, SHOP_DETAIL.h], [400, 50, 240, 184], 'description window 0x29 (exe GUI table)');

// --- the jingles and the picture (BGM j_kantei.adx / miniclear.adx; window 0x32) ---
{
  // Deal without the equip question (the class cannot equip the Saber).
  const calls: string[] = [];
  const ch = character(500, [inv('000200008000000000000000 02000100 00000000'), unknownSaber()]);
  ch.inventory[1].data.id = 0x10003;
  const pictures: number[] = [];
  const music = { jingle: (name: string) => calls.push(`jingle ${name}`), restore: () => calls.push('restore') };
  const { env } = makeEnv(ch, calls, 0, {
    music,
    picture: async (item) => {
      pictures.push(item.data1[4]);
      return {} as ImageBitmap;
    },
  });
  const c = new TekkerCounter(env);
  c.start();
  await press(c, 'Enter', 'Enter', 'Enter');
  eq(calls, ['6xB8 10002', 'jingle j_kantei.adx'], '6xB8, then the appraisal jingle');
  await tick(c, TEKKER_WAIT + 2);
  eq([c.state().message, c.state().picture, pictures], ['6#8', true, [5]], 'Result: the picture of the identified item');
  await press(c, 'Enter');
  eq(calls.slice(2), ['pay 100', 'accept 10002 5', 'jingle miniclear.adx'], 'the deal: pay, accept, then miniclear');
  eq(c.state().picture, false, 'the picture is not kept past the deal');
  await press(c, 'Backspace', 'Enter');
  await tick(c);
  eq([c.done, calls.slice(-1)], [true, ['restore']], 'closed: the floor track comes back');
}
{
  // Not enough meseta: nothing sent, no jingle, no restore.
  const calls: string[] = [];
  const music = { jingle: (name: string) => calls.push(`jingle ${name}`), restore: () => calls.push('restore') };
  const { env } = makeEnv(character(50, [unknownSaber()]), calls, 0, { music });
  const c = new TekkerCounter(env);
  c.start();
  await press(c, 'Enter', 'Enter', 'Enter', 'Enter');
  await tick(c);
  eq([calls, c.done], [[], true], 'not enough meseta: nothing sent, no jingle');
}

// --- the Result row's icons (UIElement_SetItemAnimationState_0072b9d0 for icon 2,
// ItemEntity_UpdateColoring_0072c045 for icon 1; the row is InitializeItemObject_0072bdd4's).
// The weapon kind goes through GetWeaponAnimationTableEntry_005d6724: the table 0x0092c360
// (19 DWORDs: 1 sword, 2 cane, 3 gun) indexed by the PMT kind; kinds >= 0x13 give 0.
{
  const ctx: RowContext = { names, charClass: 0, level: 5, stats: { atp: 100, mst: 0, ata: 100 }, lobby: false };
  pmt.weaponKinds = Array.from({ length: 19 }, (_, k) => k); // identity: the test names the table index
  const anim = [1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 2, 2, 2, 1, 1, 1, 1, 3, 2];
  const want = (k: number) => (anim[k] === 1 ? 0 : anim[k] === 3 ? 1 : anim[k] === 2 ? 2 : 0x36);
  const weapon = (kind: number) => inv(`00${kind.toString(16).padStart(2, '0')}00000000000000000000 00000000 00000000`);
  const got = [0, 6, 10, 13, 17, 18, 19].map((k) => shopRow(weapon(k).data, '', ctx).icon2);
  eq(got, [0, 6, 10, 13, 17, 18, 19].map(want), 'weapon kinds -> icon 2 (0x0092c360 by kind)');
  eq(shopRow(weapon(6).data, '', ctx).icon2, 1, 'gun kind 6 -> icon 1');
  // Non-weapon groups: armour 11 (sub 1), shield 10 (sub 2), unit 4 (sub 3), mag 3, mate 5, fluid 7, disk 6, other tool 8, meseta 9.
  const row2 = (h: string) => shopRow(inv(h).data, '', ctx).icon2;
  eq(
    [row2('010100000000000000000000 00000000 00000000'), row2('010200000000000000000000 00000000 00000000'), row2('010300000000000000000000 00000000 00000000'), row2('020100000000000000000000 00000000 00000000')],
    [11, 10, 4, 3],
    'armour / shield / unit / mag icon 2',
  );
  eq(
    [row2('030000000003000000000000 05000100 00000000'), row2('030100000003000000000000 05000100 00000000'), row2('030200000003000000000000 05000100 00000000'), row2('030500000003000000000000 05000100 00000000')],
    [5, 7, 6, 8],
    'tools: mate / fluid / disk / other icon 2',
  );
  // Icon 1 of the compact rows (shop stock, bank take list, Result): ListWindowObject_AddItem_007375a4 ->
  // UIElement_InitializeItemDisplay_0072b870 (dump 694171) -> UIElement_UpdateItemValidationState_0072bab0
  // (dump 694290), which writes only 0x19 / 0x13 over the 0x36 it set. The undroppable (0x2a / 0x2b) and
  // equipped (0x0c) icons are written by ItemEntity_UpdateColoring_0072c045, reached only from the
  // item_instance rows (InitializeItemObject_0072bdd4, dump 694456). So a compact row never shows them.
  pmt.tools[1] = [];
  pmt.tools[1][0] = { ...base(0x20), amount: 10, tech: 0, cost: 0, itemFlags: 0 } as never; // no bit 2: undroppable (GetItemAttackData 0x10)
  const undrop = inv('030100000003000000000000 0a000100 00000000');
  const undropEquipped = inv('030100000003000000000000 0a000100 00000000', true);
  eq([itemRow(undrop, ctx).icon1, itemRow(undropEquipped, ctx).icon1], [0x2a, 0x2b], 'inventory rows: undroppable 0x2a, equipped 0x2b');
  eq(shopRow(undrop.data, '', ctx).icon1, 0x36, 'compact row: undroppable tool stays 0x36 (UpdateItemValidationState never writes 0x2a)');
  eq([itemRow(knownSaber, ctx).icon1, shopRow(knownSaber.data, '', ctx).icon1], [0x0c, 0x36], 'equipped saber: inventory 0x0c, compact row 0x36');
  eq([shopRow(unknownSaber().data, '', ctx).icon1, shopRow(wrappedUnknown.data, '', ctx).icon1], [0x36, 0x36], 'untekked saber (class ok): 0x36; wrapped: 0x36 (returns before the icon)');
  pmt.tools[1] = [];
  pmt.weaponKinds = [];
}

if (failures) {
  console.log(`tekker: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('tekker: all checks passed');

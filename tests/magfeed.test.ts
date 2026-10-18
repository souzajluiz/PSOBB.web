// MAG feeding (net/magfeed.ts, GameItems.feedMag, classic/magmenu.ts): the
// 6x28 bytes, which items a MAG eats, the stat rules of mag_feed, the level,
// evolution and photon blast, the feed timer, ItemMagEdit's stage table and
// the MAG window's flow. The feed rows and mag / tool entries come from
// newserv's system/tables/item-parameter-table-bb-v4.json.
// Run: node tests/magfeed.test.ts

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ItemPMT } from '../client/src/formats/itempmt.ts';
import { itemFromHex, type ItemData } from '../client/src/formats/itemnames.ts';
import type { CharacterFile, InventoryItem } from '../client/src/net/charfile.ts';
import { buildFeedMag, GameItems } from '../client/src/net/items.ts';
import type { Game } from '../client/src/net/game.ts';
import { addPhotonBlast, applyMagFeed, FEED_TIMER_FRAMES, FeedTimer, isMagFood, magAlignment, magLevel, parseMagEvolution, photonBlasts } from '../client/src/net/magfeed.ts';
import { MagMenu, magSelectItems, LEVEL_STEP_FRAMES } from '../client/src/classic/magmenu.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// --- the tables (newserv JSON with hex numbers) ---
const ROOT = resolve(import.meta.dirname, '..');
const json = JSON.parse(
  readFileSync(join(ROOT, 'vendor/newserv/system/tables/item-parameter-table-bb-v4.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/0x[0-9A-Fa-f]+/g, (h) => String(parseInt(h, 16))).replace(/,(\s*[}\]])/g, '$1'),
);
const find = (o: unknown, key: string): unknown => {
  if (!o || typeof o !== 'object') return undefined;
  if (key in (o as object)) return (o as Record<string, unknown>)[key];
  for (const v of Object.values(o as object)) {
    const r = find(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
};
const pmt = new ItemPMT();
for (let t = 0; t < 0x53; t++) {
  const m = find(json, `02${t.toString(16).toUpperCase().padStart(2, '0')}`) as Record<string, number> | undefined;
  pmt.mags[t] = { id: m?.ID ?? 0, feedTable: m?.FeedTable ?? 0, photonBlast: m?.PhotonBlast ?? 0xff } as never;
}
for (const code of ['030000', '030001', '030002', '030100', '030300', '030700', '030800']) {
  const t = find(json, code) as Record<string, number>;
  const [a, b] = [parseInt(code.slice(2, 4), 16), parseInt(code.slice(4, 6), 16)];
  (pmt.tools[a] ??= [])[b] = { id: t.ID, itemFlags: t.ItemFlags } as never;
}
pmt.magFeedTables = (find(json, 'MagFeedResults') as Array<Array<Record<string, number>>>).map((tbl) =>
  tbl.map((r) => ({ def: r.DEF, pow: r.POW, dex: r.DEX, mind: r.MIND, iq: r.IQ, synchro: r.Synchro })),
);
eq(pmt.magFeedTables.length, 8, 'eight feed tables');

const mag = (h: string): ItemData => itemFromHex(h);
const monomate = itemFromHex('030000000001000000000000 00000000 00000000');
const ctx = (over = {}) => ({ pmt, evolution: new Uint8Array(0x53), charClass: 0, sectionId: 0, ...over });

// --- 6x28 (Player_SendFeedMagPacket_0068dcf8) ---
eq(hex(buildFeedMag(1, 0x00210004, 0x00210007)), '2803010004002100' + '07002100', '6x28 {mag id, item id}');

// --- what a MAG eats (CheckItemEquipConditions_005d5f40 bit 4) ---
eq(
  [monomate, itemFromHex('030700'), itemFromHex('030300'), itemFromHex('030800'), itemFromHex('00010000')].map((i) => isMagFood(i, pmt, false)),
  [true, false, true, false, false],
  'Monomate / Sol Atomizer yes; Telepipe, Trap Vision, weapons no',
);
eq(isMagFood(monomate, pmt, true), false, 'a wrapped item no');

// --- the feed (ExecuteMagFeed_005da00c, mag_feed) ---
{
  // Mag (type 0, feed table 0) level 5: DEF 5.00.
  const m = mag('02000500 f4010000 00000000 00000000 14000000');
  eq(applyMagFeed(m, monomate, ctx()), true, 'fed');
  const row = pmt.magFeedTables[0][0];
  const w = (i: number) => m.data1[i * 2] | (m.data1[i * 2 + 1] << 8);
  eq([w(2), w(3), w(4), w(5)], [500 + row.def, row.pow, row.dex, row.mind], 'def / pow / dex / mind plus the row (table 0, Monomate)');
  eq([m.data2[0], m.data2[1], m.data1[2]], [0x14 + row.synchro, row.iq, 5], 'sync, iq, level');
}
{
  // A fall bigger than the part within the level is dropped; iq / sync clamp.
  pmt.magFeedTables[7][0] = { def: -5, pow: -3, dex: 0, mind: 0, iq: -50, synchro: 120 };
  pmt.mags[0x40] = { id: 0, feedTable: 7, photonBlast: 0xff } as never;
  const m = mag('02400a00 f4010400 00000000 00000000 10050000');
  applyMagFeed(m, monomate, ctx());
  const w = (i: number) => m.data1[i * 2] | (m.data1[i * 2 + 1] << 8);
  eq([w(2), w(3), m.data2[0], m.data2[1]], [500, 1, 120, 0], 'DEF 5.00 -5 stays, POW 0.04 -3 = 0.01; sync 120, iq 0');
}
{
  // Level 200: a rise stops at 99 within the level.
  pmt.magFeedTables[7][0] = { def: 40, pow: 0, dex: 0, mind: 0, iq: 0, synchro: 0 };
  const m = mag('0240c800 704e0000 00000000 00000000 00000000'); // DEF 0x4e70 = 200.80 -> level 200
  eq(magLevel(m.data1), 200, 'level 200');
  applyMagFeed(m, monomate, ctx());
  eq(m.data1[4] | (m.data1[5] << 8), 20099, 'stops at x.99');
}
{
  // Level 10 with stage 0: a HUmar's mag becomes Varuna (1) and learns its
  // photon blast; a FOnewearl's becomes Vritra (0x19).
  pmt.magFeedTables[7][0] = { def: 0, pow: 40, dex: 0, mind: 0, iq: 0, synchro: 0 };
  const m = mag('02400900 84030000 00000000 00000000 00000000'); // DEF 9.00, POW 0.00
  m.data1.set([0xc4, 0x00], 6); // POW 1.96
  applyMagFeed(m, monomate, ctx());
  eq([m.data1[1], m.data1[2], photonBlasts(m)], [1, 11, [pmt.mags[1].photonBlast]], 'Varuna at level 10+, its photon blast in the center');
  const f = mag('02400900 84030000 c4000000 00000000 00000000');
  f.data1.set([0xc4, 0x00], 6);
  applyMagFeed(f, monomate, ctx({ charClass: 8 }));
  eq(f.data1[1], 0x19, 'FOnewearl: Vritra');
  const done = mag('02400900 84030000 c4000000 00000000 00000000');
  done.data1.set([0xc4, 0x00], 6);
  const stages = new Uint8Array(0x53);
  stages[0x40] = 1;
  applyMagFeed(done, monomate, ctx({ evolution: stages }));
  eq(done.data1[1], 0x40, 'stage 1 or more: no level-10 evolution');
}
eq([magAlignment(new Uint8Array([2, 0, 0, 0, 0, 0, 0x2c, 1, 0x64, 0, 0x64, 0])), magAlignment(new Uint8Array([2, 0, 0, 0, 0, 0, 0x64, 0, 0x2c, 1, 0x2c, 1]))], [0x008, 0x100], 'alignment: POW highest 8, a tie 0x100');
{
  const m = mag('02000000 00000000 00000000 00000000 00000000');
  addPhotonBlast(m, 2);
  addPhotonBlast(m, 0);
  addPhotonBlast(m, 5);
  addPhotonBlast(m, 0);
  eq(photonBlasts(m), [2, 0, 5], 'center, right, left; no double');
}

// --- the feed timer (0x189c frames, count limit 2) ---
{
  const t = new FeedTimer();
  const can: boolean[] = [];
  for (let i = 0; i < 4; i++) {
    can.push(t.canFeed);
    if (t.canFeed) t.fed();
  }
  eq(can, [true, true, true, false], 'three feeds, then wait');
  for (let i = 0; i < FEED_TIMER_FRAMES - 1; i++) t.tick();
  eq(t.canFeed, false, 'not before 0x189c frames');
  t.tick();
  eq([t.canFeed, t.count], [true, 0], 'the count clears when the timer runs out');
}

// --- ItemMagEdit (root +0x14 -> stage per type) ---
{
  const f = new Uint8Array(0x100);
  const dv = new DataView(f.buffer);
  for (let i = 0; i < 0x53; i++) f[0x20 + i] = i % 5;
  dv.setUint32(0x80 + 0x14, 0x20, true); // root at 0x80
  dv.setUint32(f.length - 0x10, 0x80, true);
  eq([...parseMagEvolution(f, false).subarray(0, 6)], [0, 1, 2, 3, 4, 0], 'evolution stages');
}

// --- GameItems.feedMag and the MAG window ---
{
  const sent: Array<[number, string]> = [];
  const game = {
    on: () => {},
    conn: { onCommand: () => {}, send: () => {} },
    info: null,
    players: new Map(),
    selfId: 0,
    active: true,
    sendSubcommand: (sub: number, body: Uint8Array) => sent.push([sub, hex(body)]),
  } as unknown as Game;
  const inv = (h: string, id: number): InventoryItem => ({ index: 0, state: 1, flags: 0, extensionData1: 0, extensionData2: 0, equipped: false, data: { ...itemFromHex(h), id } });
  const m = inv('02000500 f4010000 00000000 00000000 14000000', 0x10);
  const food = inv('030000000003000000000000 00000000 00000000', 0x11);
  const ch = { meseta: 0, inventory: [m, food], techLevels: [], stats: {}, charClass: 0, sectionId: 0 } as unknown as CharacterFile;
  const items = new GameItems(game, { character: () => ch, fullCharacter: () => null } as never);
  items.magFeed = () => ctx();
  let fed = 0;
  items.onMagFed = () => fed++;
  const menu = new MagMenu({
    character: () => ch,
    rowContext: () => ({ names: null, charClass: 0, level: 1, stats: { atp: 0, mst: 0, ata: 0 }, lobby: false }),
    text: (_g, i) => `[${i.toString(16)}]`,
    pmt: () => pmt,
    feedTimer: (id) => items.feedTimer(id),
    feed: (a, b) => items.feedMag(a, b),
  });
  eq([menu.mags.length, menu.foods.length], [1, 1], 'one mag, one food');
  const key = (k: string) => menu.key({ key: k } as KeyboardEvent);
  eq(
    magSelectItems(m, items.feedTimer(0x10), (i) => `[${i.toString(16)}]`).map((x) => [x.label, x.value, x.enabled]),
    [['[78]', 1, true], ['[77]', 0, false]],
    'Select: Give Items on, Photon Blast off (none yet)',
  );
  key('Enter'); // the mag -> Select
  key('Enter'); // Give Items -> the item list
  key('Enter'); // the Monomate: feed
  eq(sent, [[0x28, hex(buildFeedMag(0, 0x10, 0x11).subarray(4))]], '6x28 sent for the mag and the Monomate');
  eq([food.data.data1[5], fed, m.data.data1[6]], [2, 1, pmt.magFeedTables[0][0].pow], 'one Monomate used, the feed applied');
  eq(menu.busy, true, 'the stat levels rise first');
  for (let i = 0; i < LEVEL_STEP_FRAMES * 3; i++) menu.tick();
  eq(menu.busy, false, 'then back to Select');
}

if (failures) {
  console.log(`magfeed: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('magfeed: all checks passed');

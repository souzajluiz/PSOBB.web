// Items in a game, two clients against newserv (net/items.ts):
//   A creates a game, B joins (item ids: A from the game creation, B from the
//   server's 6x6D); A drops a whole item (6x2A) and one item of a stack
//   (6xC3 -> 6x5D -> 6x29) and some meseta; B sees the floor items, walks
//   there and picks them up (6x5A -> 6x59); B drops them again and A picks them
//   back up (so the accounts keep their items across runs). A unequips and
//   re-equips its weapon (6x26 / 6x25) and uses a Monomate (6x27); B sees each
//   command. On Forest 1, A breaks item boxes (6x0B + 6xA2) until one drops
//   an item (6x5F to both). Finally both leave and the inventory each client
//   kept matches the one newserv sends back in the lobby (67).
// Requires newserv + bridge running. Run: node tests/items.live.ts
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { parseSetFile, type ObjectSet } from '../client/src/formats/setdata.ts';
import { floorFiles, parseSetDataTable } from '../client/src/formats/setdatatable.ts';
import { BBSession } from '../client/src/net/bbsession.ts';
import { Game } from '../client/src/net/game.ts';
import { GameItems, ITEM_BOX_TYPES, MESETA_ITEM_ID, parseInventoryItems, stackSize, type FloorItem } from '../client/src/net/items.ts';
import type { Lobby } from '../client/src/net/lobby.ts';
import { nodeBridge } from './lib/nodews.ts';

const ROOT = resolve(import.meta.dirname, '..');
const nsk = new Uint8Array(readFileSync(join(ROOT, 'vendor/newserv/system/blueburst/keys/default.nsk')));
let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
};
const timeout = <T>(p: Promise<T>, what: string, ms = 5000) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms))]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function enter(user: string, charName: string, charClass: number): Promise<{ session: BBSession; lobby: Lobby }> {
  const session = new BBSession({ nsk, connect: nodeBridge });
  await session.login(user, user);
  const slots = await session.characterPreviews();
  if (!slots[0]) await session.createCharacter(0, { name: charName, charClass });
  const lobby = await session.enterLobby(user, user, 0);
  return { session, lobby };
}
const ctxOf = (s: BBSession) => ({ guildCardNumber: s.init!.guildCardNumber, fullCharacter: () => s.fullCharacter });
const itemsOf = (g: Game, s: BBSession) => new GameItems(g, { character: () => s.character, fullCharacter: () => s.fullCharacter });

// Resolves when `items` gets a floor item matching `pred`.
function nextFloorItem(items: GameItems, pred: (it: FloorItem) => boolean, what: string): Promise<FloorItem> {
  const found = [...items.floorItems.values()].find(pred);
  if (found) return Promise.resolve(found);
  return timeout(
    new Promise<FloorItem>((res) => {
      const prev = items.onFloorItemAdded;
      items.onFloorItemAdded = (it) => {
        prev(it);
        if (pred(it)) res(it);
      };
    }),
    what,
  );
}
function floorItemGone(items: GameItems, id: number, what: string): Promise<void> {
  if (!items.floorItems.has(id)) return Promise.resolve();
  return timeout(
    new Promise<void>((res) => {
      const prev = items.onFloorItemRemoved;
      items.onFloorItemRemoved = (it) => {
        prev(it);
        if (it.id === id) res();
      };
    }),
    what,
  );
}
const waitSub = (g: Game, sub: number, from: number, what: string) =>
  timeout(new Promise<Uint8Array>((r) => g.on('subcommand', (s, c, body) => s === sub && c === from && r(body))), what);

// Move a player to (x, z) on its floor so newserv's pickup range check passes.
function stand(g: Game, x: number, z: number): void {
  g.sendStop(x, 0, z, 0);
}

try {
  const a = await enter('webitema', 'ItemHunter', 0);
  const b = await enter('webitemb', 'ItemForce', 6);
  const gameName = `itm${Date.now() % 100000}`;
  const ga = await Game.create(a.lobby, ctxOf(a.session), { name: gameName, difficulty: 0, episode: 1 });
  const ia = itemsOf(ga, a.session);
  ga.finishLoading(0, 0, 0, 0);
  await timeout(ga.ready, 'A: B1 after 6F');
  const invA = () => a.session.character!.inventory;
  check(`A (creator) item ids ${invA().map((i) => i.data.id.toString(16)).join(' ')}`, ia.idsAssigned && invA().every((it, i) => it.data.id === 0x00010000 + i));

  const list = await Game.list(b.lobby.conn);
  const entry = list.find((g) => g.name === gameName)!;
  const gb = await Game.join(b.lobby, ctxOf(b.session), entry.itemId);
  const ib = itemsOf(gb, b.session);
  const aInvAtB = timeout(new Promise<void>((r) => gb.on('playerJoined', (p) => p.clientId === 0 && p.charClass >= 0 && r())), 'B gets 6x70 from A');
  await aInvAtB;
  await sleep(300); // 6x6D from the server
  gb.finishLoading(0, 0, 0, 0);
  ib.ensureIds();
  const invB = () => b.session.character!.inventory;
  check(`B (joiner) item ids from 6x6D: ${invB().map((i) => i.data.id.toString(16)).join(' ')}`, ib.idsAssigned && invB().every((it, i) => it.data.id === invB()[0].data.id + i) && (invB()[0]?.data.id >>> 21) === 1);
  check(`B knows A's inventory from 6x70 (${ib.others.get(0)?.size ?? 0} items)`, (ib.others.get(0)?.size ?? 0) === invA().length);
  await sleep(200);
  check(`A knows B's inventory from 65 (${ia.others.get(1)?.size ?? 0} items)`, (ia.others.get(1)?.size ?? 0) === invB().length);

  // Both stand at the same spot on Pioneer 2.
  stand(ga, 100, 100);
  stand(gb, 101, 100);
  await sleep(200);

  // --- A drops a whole item: its armor (equipped: dropping unequips it).
  const whole = invA().find((i) => i.data.data1[0] === 1 && stackSize(i.data) === 1) ?? invA().find((i) => stackSize(i.data) === 1 && i.data.data1[0] !== 0)!;
  const wholeId = whole.data.id;
  const wasEquipped = whole.equipped;
  const countA = invA().length;
  const bSees = nextFloorItem(ib, (it) => it.id === wholeId, 'B sees the dropped item (6x2A)');
  ia.drop(wholeId);
  const dropped = await bSees;
  check(`A dropped ${wholeId.toString(16)} (6x2A); B sees it at (${dropped.x}, ${dropped.z}) on floor ${dropped.floor}`, dropped.floor === 0 && dropped.x === 100 && invA().length === countA - 1 && ia.floorItems.has(wholeId));

  // --- B picks it up.
  const aSeesPick = floorItemGone(ia, dropped.id, 'A sees the pickup (6x59)');
  const bGot = floorItemGone(ib, dropped.id, 'B gets 6x59');
  ib.pickUp(dropped);
  await bGot;
  await aSeesPick;
  check(`B picked it up: ${invB().some((i) => i.data.id === dropped.id)}; A's view of B's inventory has it: ${ia.others.get(1)?.has(dropped.id)}`, invB().some((i) => i.data.id === dropped.id) && !!ia.others.get(1)?.has(dropped.id));
  // B gives it back (6x2A), A picks it up and equips it again.
  {
    const seen = nextFloorItem(ia, (f) => f.id === wholeId, 'A sees B drop it');
    ib.drop(wholeId);
    const f = await seen;
    const gone = floorItemGone(ia, f.id, 'A picks it back up');
    ia.pickUp(f);
    await gone;
    if (wasEquipped) ia.equip(wholeId);
    check(`A has ${wholeId.toString(16)} back${wasEquipped ? ' and equipped' : ''}`, invA().some((i) => i.data.id === wholeId && i.equipped === wasEquipped) && !invB().some((i) => i.data.id === wholeId));
  }

  // --- One item from a stack (6xC3 -> 6x5D -> 6x29), B picks it up and gives it back.
  const stack = invA().find((i) => i.data.data1[0] === 3 && stackSize(i.data) > 1);
  if (stack) {
    const before = stackSize(stack.data);
    const key = (d: Uint8Array) => `${d[0]}:${d[1]}:${d[2]}`;
    const k = key(stack.data.data1);
    const bSeesSplit = nextFloorItem(ib, (it) => key(it.data.data1) === k && it.data.data1[5] === 1, 'B sees the split stack (6x5D)');
    ia.drop(stack.data.id, 1);
    const split = await bSeesSplit;
    await sleep(200);
    check(`A dropped 1 of ${before} (new id ${split.id.toString(16)}); A's stack is now ${stackSize(stack.data)}`, stackSize(stack.data) === before - 1 && split.id !== stack.data.id);
    const bCount = () => invB().filter((i) => key(i.data.data1) === k).reduce((n, i) => n + stackSize(i.data), 0);
    const nB = bCount();
    const gone = floorItemGone(ia, split.id, 'A sees the pickup');
    ib.pickUp(split);
    await gone;
    await sleep(100);
    check(`B picked it up (${nB} -> ${bCount()})`, bCount() === nB + 1);
    const bStack = invB().find((i) => key(i.data.data1) === k)!;
    const seen = nextFloorItem(ia, (f) => key(f.data.data1) === k, 'A sees B drop one');
    ib.drop(bStack.data.id, stackSize(bStack.data) > 1 ? 1 : 0);
    const f = await seen;
    const back = floorItemGone(ia, f.id, 'A picks it back up');
    ia.pickUp(f);
    await back;
    await sleep(100);
    check(`A's stack is back to ${stackSize(stack.data)}`, stackSize(stack.data) === before);
  } else {
    check('A has a stack of tools to split', false);
  }

  // --- Meseta (A gets some from the boxes below on the first run).
  const mesetaA = a.session.character!.meseta;
  if (mesetaA >= 10) {
    const bSeesMeseta = nextFloorItem(ib, (it) => it.data.data1[0] === 4, 'B sees the meseta (6x5D)');
    ia.drop(MESETA_ITEM_ID, 10);
    const m = await bSeesMeseta;
    await sleep(200);
    check(`A dropped 10 meseta (${mesetaA} -> ${a.session.character!.meseta})`, a.session.character!.meseta === mesetaA - 10);
    const mesetaB = b.session.character!.meseta;
    const gone = floorItemGone(ib, m.id, 'B picks up the meseta');
    ib.pickUp(m);
    await gone;
    check(`B picked up 10 meseta (${mesetaB} -> ${b.session.character!.meseta})`, b.session.character!.meseta === mesetaB + 10);
    const seen = nextFloorItem(ia, (f) => f.data.data1[0] === 4, 'A sees B drop meseta');
    ib.drop(MESETA_ITEM_ID, 10);
    const f = await seen;
    const back = floorItemGone(ia, f.id, 'A picks the meseta back up');
    ia.pickUp(f);
    await back;
    check(`A has its meseta back (${a.session.character!.meseta})`, a.session.character!.meseta === mesetaA);
  }
  check(`A has as many items as before (${invA().length})`, invA().length === countA);

  // --- Equip / unequip / use.
  const weapon = invA().find((i) => i.equipped && i.data.data1[0] === 0);
  if (weapon) {
    const bSees26 = waitSub(gb, 0x26, 0, 'B sees 6x26');
    ia.unequip(weapon.data.id);
    await bSees26;
    check('A unequipped its weapon; B got 6x26', !weapon.equipped);
    const bSees25 = waitSub(gb, 0x25, 0, 'B sees 6x25');
    ia.equip(weapon.data.id);
    await bSees25;
    check('A equipped it again; B got 6x25', weapon.equipped);
  }
  const mate = invA().find((i) => i.data.data1[0] === 3 && i.data.data1[1] === 0);
  if (mate) {
    const n = stackSize(mate.data);
    const bSees27 = waitSub(gb, 0x27, 0, 'B sees 6x27');
    ia.use(mate.data.id);
    await bSees27;
    check(`A used a ${mate.data.data1[2] === 0 ? 'Monomate' : 'mate'} (${n} -> ${n > 1 ? stackSize(mate.data) : 0}); B got 6x27`, n > 1 ? stackSize(mate.data) === n - 1 : !invA().includes(mate));
  }

  // --- Item boxes on Forest 1.
  {
    const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
    const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
    const read = (n: string) => (existsSync(join(DATA, n)) ? new Uint8Array(readFileSync(join(DATA, n))) : gsl.get(n));
    const table = parseSetDataTable(read('SetDataTableOn.rel'));
    const v = ga.info!.variations;
    const p2 = floorFiles(table, 0, v[0].layout, v[0].entities, 0, 'normal')!;
    const f1 = floorFiles(table, 1, v[1].layout, v[1].entities, 1, 'normal')!;
    const base = read(p2.objects).length / 0x44;
    const boxes = parseSetFile(f1.objects, read(f1.objects)).filter((o): o is ObjectSet => o.kind === 'object' && ITEM_BOX_TYPES.has(o.type));
    ga.warp(1);
    ga.finishWarp(0, 0, 0, 0);
    gb.warp(1);
    gb.finishWarp(0, 0, 0, 0);
    await sleep(300);
    let drop: FloorItem | null = null;
    let tried = 0;
    for (const box of boxes) {
      tried++;
      const bSees0B = waitSub(gb, 0x0b, 0x4000 + base + box.index, 'B sees 6x0B');
      const aSees = nextFloorItem(ia, (it) => it.source === 'box' && it.entityIndex === base + box.index, 'box drop').catch(() => null);
      stand(ga, box.position[0], box.position[2]);
      ia.openBox({ floor: 1, area: 1, objectIndex: base + box.index, type: box.type, room: box.section, x: box.position[0], z: box.position[2], params: box.params });
      await bSees0B.catch(() => null);
      drop = await aSees;
      if (drop) break;
      if (tried >= 8) break;
    }
    check(`A broke ${tried} of ${boxes.length} Forest 1 boxes; drop: ${drop ? `${drop.id.toString(16)} ${[...drop.data.data1].map((x) => x.toString(16).padStart(2, '0')).join('')}` : 'none'}`, !!drop);
    if (drop) {
      await nextFloorItem(ib, (it) => it.id === drop!.id, 'B gets the same 6x5F');
      check('B got the same 6x5F and marks the box open', ib.openedBoxes.has(drop.entityIndex));
      // A walks there and picks it up.
      stand(ga, drop.x, drop.z);
      await sleep(200);
      const gone = floorItemGone(ib, drop.id, 'B sees A pick up the box drop');
      const before = invA().length;
      const mBefore = a.session.character!.meseta;
      ia.pickUp(drop);
      await gone;
      check(`A picked up the box drop (${before} items, ${mBefore} meseta -> ${invA().length}, ${a.session.character!.meseta})`, invA().length > before || a.session.character!.meseta > mBefore || invA().some((i) => stackSize(i.data) > 1));
      // Leave non-meseta drops on the floor again so the account does not fill up.
      if (invA().length > before) ia.drop(invA()[invA().length - 1].data.id);
    }
  }

  // --- Leave; the lobby 67 carries newserv's inventory.
  const lb = await gb.leave();
  const la = await ga.leave();
  for (const [who, l, s] of [['A', la, a.session], ['B', lb, b.session]] as const) {
    const e = l.selfEntry!;
    const server = parseInventoryItems(e, 0x44, 0x48);
    const serverMeseta = new DataView(e.buffer, e.byteOffset).getUint32(0x44 + 0x34c + 0x20, true);
    const local = s.character!.inventory;
    const same = server.length === local.length && server.every((d, i) => d.data1.every((v, k) => v === local[i].data.data1[k]));
    check(`${who}: newserv's inventory (${server.length} items, ${serverMeseta} meseta) matches the local one (${local.length}, ${s.character!.meseta})`, same && serverMeseta === s.character!.meseta);
  }
  a.session.close();
  b.session.close();
} catch (err) {
  console.log(`FAIL ${(err as Error).message}`);
  failures++;
}
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

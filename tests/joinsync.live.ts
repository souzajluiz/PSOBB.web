// Join sync against newserv: A creates a game and leads it, sets a switch,
// kills an enemy (6x0A + 6x76) and breaks a box (6x0B); B joins and must get
// the leader's 6x6B / 6x6C / 6x6E / 6x6F (net/joinsync.ts) with the game's
// entity counts and A's changes, and newserv must accept them (it checks
// every count against its own maps and would drop A otherwise).
// Requires newserv + bridge running. Run: node tests/joinsync.live.ts
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BBSession } from '../client/src/net/bbsession.ts';
import { floorToArea, Game } from '../client/src/net/game.ts';
import { buildSyncLayout, MAX_ENEMY_SLOTS, type SyncFloor } from '../client/src/net/joinsync.ts';
import { parseEnemySets, parseSetFile, type ObjectSet } from '../client/src/formats/setdata.ts';
import { enemySlots } from '../client/src/formats/enemyids.ts';
import { parseEventFile } from '../client/src/formats/events.ts';
import { floorFiles, parseSetDataTable } from '../client/src/formats/setdatatable.ts';
import type { Lobby } from '../client/src/net/lobby.ts';
import { nodeBridge } from './lib/nodews.ts';

const ROOT = resolve(import.meta.dirname, '..');
const NEWSERV = process.env.NEWSERV ?? join(ROOT, 'vendor/newserv');
const MAPS = join(NEWSERV, 'system/maps/bb-v4');
const nsk = new Uint8Array(readFileSync(join(NEWSERV, 'system/blueburst/keys/default.nsk')));
let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
};
const timeout = <T>(p: Promise<T>, what: string, ms = 8000) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms))]);

async function enter(user: string, charName: string, charClass: number): Promise<{ session: BBSession; lobby: Lobby }> {
  const session = new BBSession({ nsk, connect: nodeBridge });
  await session.login(user, user);
  const slots = await session.characterPreviews();
  if (!slots[0]) await session.createCharacter(0, { name: charName, charClass });
  const lobby = await session.enterLobby(user, user, 0);
  return { session, lobby };
}
const ctxOf = (s: BBSession) => ({ guildCardNumber: s.init!.guildCardNumber, fullCharacter: () => s.fullCharacter });
const map = (n: string) => (existsSync(join(MAPS, n)) ? new Uint8Array(readFileSync(join(MAPS, n))) : null);

// The same walk over floors 0..0x11 as render/gameview.ts syncLayout, on
// newserv's own map files.
function layoutFor(g: Game) {
  const table = parseSetDataTable(map('SetDataTableOn.rel')!);
  const floors: Array<Omit<SyncFloor, 'objectBase' | 'enemySetBase' | 'enemySlotBase' | 'eventBase'>> = [];
  for (let f = 0; f < 0x12; f++) {
    const area = floorToArea(g.info!.episode)[f] ?? -1;
    const v = g.info!.variations[f] ?? { layout: 0, entities: 0 };
    const files = area >= 0 ? floorFiles(table, area, v.layout, v.entities, f, 'normal') : null;
    const o = files ? map(files.objects) : null;
    const e = files ? map(files.enemies) : null;
    const ev = files ? map(files.events) : null;
    const objects = o ? (parseSetFile(files!.objects, o).filter((x) => x.kind === 'object') as ObjectSet[]) : [];
    const enemies = e ? parseEnemySets(e) : [];
    const slots = enemySlots(enemies, area);
    floors.push({ floor: f, objects, setFirstSlots: slots.first, enemySlots: slots.total, eventIds: ev ? parseEventFile(ev).events.map((x) => x.id) : [] });
  }
  return buildSyncLayout(floors);
}

try {
  const a = await enter('webjoina', 'SyncLeader', 0);
  const b = await enter('webjoinb', 'SyncJoiner', 6);
  const gameName = `sync${Date.now() % 100000}`;
  const ga = await Game.create(a.lobby, ctxOf(a.session), { name: gameName, difficulty: 0, episode: 1 });
  ga.finishLoading(0, 0, 0, 0);
  await timeout(ga.ready, 'A: B1 after 6F');
  const layout = layoutFor(ga);
  const c = layout.counts;
  check(`layout: ${c.objects} objects, ${c.enemySets} enemy sets, ${c.enemySlots} enemy slots, ${c.events} events`, c.objects > 0 && c.enemySlots > 0 && c.enemySlots <= MAX_ENEMY_SLOTS);

  // A's changes on Forest 1: an enemy dies, a switch is set, a box breaks.
  const f1 = layout.floors[1];
  const slot = f1.enemySlotBase + f1.setFirstSlots[0];
  ga.warp(1);
  ga.finishWarp(0, 0, 0, 0);
  ga.sendEnemyState(slot, 50, 0x800); // 6x0A, dead
  ga.sendEntitySetFlags(0x1000 + slot, 1, 0x08); // 6x76
  ga.sendSwitchFlag(0xffff, 1, 7, true);
  const boxIndex = f1.objectBase + Math.max(0, (f1.objects as ObjectSet[]).findIndex((o) => o.type === 0x0092 || o.type === 0x0088));
  const box = new Uint8Array(0x0c);
  const bdv = new DataView(box.buffer);
  box[0] = 0x0b;
  box[1] = 3;
  bdv.setUint16(2, 0x4000 + boxIndex, true);
  bdv.setUint32(4, 1, true);
  bdv.setUint32(8, boxIndex, true);
  ga.recordSent(box);
  ga.conn.send(0x60, 0, box);
  // The field's export (render/gamefield.ts) would set these from the kill and
  // the switch; here they go straight into the tables.
  ga.joinSync.enemySetFlags[f1.enemySetBase] |= 0x08;
  ga.joinSync.setSwitchFlag(1, 7, true);
  ga.setQuestFlag(0x0a, true);
  ga.prepareJoinSync = async () => layout.counts;

  const list = await Game.list(b.lobby.conn);
  const entry = list.find((g) => g.name === gameName)!;
  const seen = new Set<number>();
  const gb = await Game.join(b.lobby, ctxOf(b.session), entry.itemId);
  gb.on('subcommand', (sub) => seen.add(sub));
  const bSawA70 = timeout(new Promise<void>((r) => gb.on('playerJoined', (p) => p.clientId === 0 && p.charClass >= 0 && r())), 'B gets 6x70 from A');
  await bSawA70;
  const r = gb.joinSync.received;
  check(`B got 6x6B: ${r.enemySlots} enemy states (leader ${c.enemySlots})`, r.enemySlots === c.enemySlots);
  check(`B got 6x6C: ${r.objects} object states (leader ${c.objects})`, r.objects === c.objects);
  check(`B got 6x6E: ${r.enemySets} enemy set flags, ${r.events} event flags`, r.setFlags && r.enemySets === c.enemySets && r.events === c.events);
  check(`6x6B carries A's dead enemy: slot ${slot} flags 0x${gb.joinSync.enemyFlags(slot).toString(16)}, damage ${gb.joinSync.enemyDamage(slot)}`, gb.joinSync.enemyFlags(slot) === 0x800 && gb.joinSync.enemyDamage(slot) === 50);
  check(`6x6C carries the broken box (object ${boxIndex}: flags ${gb.joinSync.objectFlags(boxIndex)})`, gb.joinSync.objectFlags(boxIndex) === 1);
  check(`6x6E carries the dead set entry and switch flag 7 of floor 1`, (gb.joinSync.enemySetFlags[f1.enemySetBase] & 8) !== 0 && gb.joinSync.switchFlag(1, 7));
  check(`6x6F carries quest flag 0x0A`, gb.getQuestFlag(0x0a));
  gb.finishLoading(10, 0, 20, 0);
  await timeout(gb.ready, 'B: B1 after 6F');
  // newserv accepted the sync: A is still connected and B hears it.
  const heard = timeout(new Promise<void>((res) => gb.on('moved', (p) => p.clientId === 0 && res())), 'B sees A move after the sync');
  ga.sendRun(12, 34);
  await heard;
  check('A still in the game after the sync (newserv took 6x6B / 6x6C / 6x6E)', true);
  a.session.close();
  b.session.close();
} catch (err) {
  console.log(`FAIL ${(err as Error).message}`);
  failures++;
}
console.log(failures ? `${failures} failures` : 'join sync (live): all checks passed');
process.exit(failures ? 1 : 0);

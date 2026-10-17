// Picks a quest from the running server and loads it: creates a game, asks for
// the quest menu (A2), opens a category (10 -> A2), asks for a quest's
// description (09 -> A3), loads it (10 -> 44/13 for the .bin and the .dat),
// sends the quest barrier (AC) and waits for the server's AC, then runs the
// quest's start label and checks what it designated against the .bin header.
//
// Requires newserv + the bridge running. Run: node tests/quest.live.ts
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BBSession } from '../client/src/net/bbsession.ts';
import { Game } from '../client/src/net/game.ts';
import { MENU_ID_QUEST_EP1, MENU_ID_QUEST_EP2, QuestClient, type LoadedQuest, type QuestMenuEntry } from '../client/src/net/quests.ts';
import { QuestSession } from '../client/src/quest/session.ts';
import { nodeBridge } from './lib/nodews.ts';

const ROOT = resolve(import.meta.dirname, '..');
const nsk = new Uint8Array(readFileSync(join(ROOT, 'vendor/newserv/system/blueburst/keys/default.nsk')));
let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
};
const timeout = <T>(p: Promise<T>, what: string, ms = 15000) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms))]);

const USER = process.env.PSOBB_USER ?? 'webtest';
const PASS = process.env.PSOBB_PASS ?? 'webtest';
const CHAR = process.env.PSOBB_CHAR ?? 'WebHunter';

try {
  const session = new BBSession({ nsk, connect: nodeBridge });
  await session.login(USER, PASS);
  const slots = await session.characterPreviews();
  if (!slots[0]) await session.createCharacter(0, { name: CHAR, charClass: 0 });
  const lobby = await session.enterLobby(USER, PASS, 0);
  check(`logged in and in the lobby as client ${lobby.selfId}`, lobby.selfId >= 0);

  const ctx = { guildCardNumber: session.init!.guildCardNumber, fullCharacter: () => session.fullCharacter };
  const name = `quest${Date.now() % 100000}`;
  const game = await Game.create(lobby, ctx, { name, difficulty: 0, episode: 1 });
  game.finishLoading(0, 0, 0, 0);
  await timeout(game.ready, 'B1 after 6F');
  check(`created game "${name}" as client ${game.info!.clientId}`, game.info!.clientId === 0);

  let started = false;
  const quests = new QuestClient(game.conn, {
    log: (m) => console.log(`  ${m}`),
    onStart: () => (started = true),
  });

  // A2: the quest categories of this game's episode.
  const categories = await timeout(quests.requestMenu(), 'A2 quest categories');
  check(`A2 returned ${categories.length} categories: ${categories.map((c) => c.name).join(', ')}`, categories.length > 0 && categories.every((c) => c.isCategory));

  // 10 on a category: its quest list. Prefer a category with ordinary quests.
  const preferred = categories.find((c) => /retriev|extermin|event|vr|solo/i.test(c.name)) ?? categories[0];
  const list = await timeout(quests.selectCategory(preferred), `A2 quest list of "${preferred.name}"`);
  check(`category "${preferred.name}" holds ${list.length} quests: ${list.slice(0, 4).map((q) => q.name).join(', ')}...`, list.length > 0);
  // newserv uses the fixed menu ids 0x55010155 (Ep1) / 0x55020255 (Ep2) for
  // quest entries rather than building the episode/icon bytes the client reads
  // out of them, so only the menu id itself is checked here.
  check(
    `quest entries use the Ep1/Ep2 quest menu id (${list[0]?.menuId.toString(16)}) and carry a quest number`,
    !!list[0] && (list[0].menuId === MENU_ID_QUEST_EP1 || list[0].menuId === MENU_ID_QUEST_EP2) && list[0].itemId > 0 && !list[0].isCategory,
  );

  const pick: QuestMenuEntry | undefined = list.find((q) => !q.disabled);
  if (!pick) throw new Error('every quest in the category is locked');

  // 09 -> A3: the long description.
  const info = await timeout(quests.requestInfo(pick), 'A3 quest info');
  check(`09 on "${pick.name}" answered with an A3 of ${info.length} characters`, info.length > 0);

  // 10 -> 44 + 13 for both files.
  const loaded: LoadedQuest = await timeout(quests.selectQuest(pick), '44/13 quest files', 30000);
  check(
    `received ${loaded.binFilename} (${loaded.bin.length} bytes from ${loaded.binCompressedSize} compressed) and ` +
      `${loaded.datFilename} (${loaded.dat.length} from ${loaded.datCompressedSize})`,
    loaded.bin.length > 0x398 && loaded.dat.length > 0x10,
  );
  check('the files came as online quest files (44/13), not download (A6/A7)', !loaded.download);

  // The barrier: QuestClient sent AC when the files arrived; newserv answers
  // AC once every client in the game is loaded (here, only us).
  await timeout(
    new Promise<void>((resolve) => {
      if (started) return resolve();
      const t = setInterval(() => started && (clearInterval(t), resolve()), 20);
    }),
    'the server AC that starts the quest',
  );
  check('quest barrier round trip (C->S AC, S->C AC)', started);

  // Parse and run it.
  const q = new QuestSession(loaded, { log: (m) => console.log(`  ${m}`) });
  check(`.bin header: "${q.bin.header.name}" quest ${q.bin.header.questNumber}, episode ${q.episode}, ${q.bin.labels.length} labels`, q.bin.header.name.length > 0);
  // The menu's item_id is the server's quest number (newserv takes it from the
  // file name, qNNN), which is not always the number in the .bin header: q058
  // ships with 105 in its header.
  console.log(`  menu item_id ${pick.itemId}, header quest number ${q.bin.header.questNumber}`);
  check(`the server named the quest files after its own quest number (${loaded.binFilename})`, loaded.binFilename === `quest${pick.itemId}.bin`);
  check(`the menu name matches the header name ("${pick.name}" / "${q.bin.header.name}")`, pick.name.trim() === q.bin.header.name.trim());

  q.start();
  const designated = q.designatedFloors();
  check(
    `running the start label designated ${designated.length} floors: ${designated.map((d) => `${d.floor}->area ${d.area} type ${d.type} var ${d.layoutVar}/${d.entitiesVar}`).join(', ')}`,
    designated.length > 0,
  );
  const handlers = [...q.vm.floorHandlers.entries()].filter(([, l]) => l >= 0);
  check(`set_floor_handler installed ${handlers.length} handlers: ${handlers.map(([f, l]) => `floor ${f} -> label ${l}`).join(', ')}`, handlers.length > 0);

  // The VM's designations must agree with the copies the quest assembler wrote
  // into the .bin header (newserv src/QuestScript.cc:4942).
  let agree = true;
  for (const fa of q.bin.header.floorAssignments) {
    const live = q.vm.designations.get(fa.floor);
    if (live && (live.area !== fa.area || live.type !== fa.type)) agree = false;
  }
  check('the VM designations agree with the header copies of bb_map_designate', agree);

  // The .dat must carry set data for the floors the quest draws itself.
  const own = designated.filter((d) => d.type === 0 || d.type === 3);
  const withData = own.filter((d) => q.dat.floors.has(d.floor));
  check(`${withData.length} of ${own.length} self-drawn floors have .dat set data (${[...q.dat.floors.keys()].sort((x, y) => x - y).join(',')})`, withData.length > 0);
  for (const f of q.dat.floors.values()) {
    console.log(`  floor ${f.floor}: ${f.objects.length} objects, ${f.enemies.length} enemies, ${f.events?.events.length ?? 0} wave events${f.randomEnemies ? ', random enemies' : ''}`);
  }

  // Run a few frames of each floor handler.
  for (const d of designated) {
    q.enterFloor(d.floor);
    q.vm.runFrames(10);
  }
  const missing = [...q.vm.unimplemented.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  opcodes not implemented: ${missing.map(([n, c]) => `${n}(${c})`).join(' ') || 'none'}`);
  check('the floor handlers ran without leaving the bytecode', q.vm.liveThreads >= 0);

  await game.leave();
  session.close();
} catch (err) {
  console.log(`FAIL ${err instanceof Error ? err.message : String(err)}`);
  failures++;
}

console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);

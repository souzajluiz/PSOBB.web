// The classic party menus against a live newserv: A creates a game with a
// password, B opens the game list (08), reads a game's info (09 / 11), is
// refused without the password and joins with it (10), then both leave.
// Requires newserv + bridge running. Run: node tests/gamelist.live.ts
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PartyMenus, type PartyHost } from '../client/src/classic/gamelist.ts';
import { BBSession } from '../client/src/net/bbsession.ts';
import { Game } from '../client/src/net/game.ts';
import type { Lobby } from '../client/src/net/lobby.ts';
import { nodeBridge } from './lib/nodews.ts';

const ROOT = resolve(import.meta.dirname, '..');
const nsk = new Uint8Array(readFileSync(join(ROOT, 'vendor/newserv/system/blueburst/keys/default.nsk')));
let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (what: string, ok: () => boolean, ms = 8000) => {
  const t = Date.now();
  while (!ok()) {
    if (Date.now() - t > ms) throw new Error(`timeout: ${what}`);
    await sleep(20);
  }
};

async function enter(user: string, charName: string, charClass: number): Promise<{ session: BBSession; lobby: Lobby }> {
  const session = new BBSession({ nsk, connect: nodeBridge });
  await session.login(user, user);
  const slots = await session.characterPreviews();
  if (!slots[0]) await session.createCharacter(0, { name: charName, charClass });
  const lobby = await session.enterLobby(user, user, 0);
  return { session, lobby };
}
const ctxOf = (s: BBSession) => ({ guildCardNumber: s.init!.guildCardNumber, fullCharacter: () => s.fullCharacter });

try {
  const a = await enter('webgamea', 'GameHunter', 0);
  const b = await enter('webgameb', 'GameForce', 6);
  const name = `cl${Date.now() % 100000}`;
  const ga = await Game.create(a.lobby, ctxOf(a.session), { name, password: 'pw', difficulty: 0, episode: 1 });
  check(`A created "${name}"`, ga.info !== null);
  ga.finishLoading(0, 0, 0, 0); // 6F, so the server lets others in
  await ga.ready;

  // B's host, as classic/main.ts builds it.
  const entered: Game[] = [];
  const host: PartyHost = {
    listGames: () => Game.list(b.lobby.conn),
    gameInfo: (e) => Game.info(b.lobby.conn, e),
    join: async (e, pw) => void entered.push(await Game.join(b.lobby, ctxOf(b.session), e.itemId, pw)),
    create: async (o) => void entered.push(await Game.create(b.lobby, ctxOf(b.session), o)),
  };
  const t11 = (i: number) => `[11:${i.toString(16)}]`;
  const menus = new PartyMenus(host, { t11, t15: (i) => `[15:${i}]` });
  menus.openList();
  await until('list', () => menus.phase === 'list');
  const view = menus.list!;
  const idx = view.entries.findIndex((e) => e.name === name);
  check(`the list has "${name}" (${view.entries.length} games)`, idx >= 0);
  const e = view.entries[idx];
  check(`row: password ${e.passworded}, difficulty ${e.difficulty}, ${e.players}/${e.maxPlayers}, episode ${e.episode}`, e.passworded && e.difficulty === 0 && e.players === 1 && e.maxPlayers === 4 && e.episode === 1);
  const row = view.rows[idx];
  console.log('row texts:', JSON.stringify(row));
  check('the row draws the password icon', row.icon === 0x18);

  // Tab: 09 -> 11.
  for (let i = 0; i < idx; i++) menus.key({ key: 'ArrowDown' });
  menus.key({ key: 'Tab' });
  await until('info', () => (menus as unknown as { details: { text: string } | null }).details !== null);
  const info = (menus as unknown as { details: { text: string } }).details.text;
  console.log('game info:', JSON.stringify(info));
  check('the info text lists the creator', info.includes('GameHunter'));

  // Enter: the password prompt; a wrong password is refused.
  menus.key({ key: 'Enter' });
  check('a passworded game asks for the password', menus.phase === 'password');
  for (const c of 'bad') menus.key({ key: c });
  menus.key({ key: 'Enter' });
  await until('refusal', () => menus.phase === 'message');
  console.log('refusal:', JSON.stringify(menus.message));
  check('a wrong password is refused with the server text', menus.message.length > 0 && entered.length === 0);
  menus.key({ key: 'Enter' });

  // The right password joins.
  menus.openList();
  await until('list 2', () => menus.phase === 'list');
  const again = menus.list!.entries.findIndex((x) => x.name === name);
  for (let i = 0; i < again; i++) menus.key({ key: 'ArrowDown' });
  menus.key({ key: 'Enter' });
  for (const c of 'pw') menus.key({ key: c });
  menus.key({ key: 'Enter' });
  await until('joined', () => entered.length === 1);
  check(`B joined "${name}" (client ${entered[0].info?.clientId})`, entered[0].info?.clientId === 1);
  await sleep(200);

  const lb = await entered[0].leave();
  const la = await ga.leave();
  check('both are back in a lobby', lb.selfId >= 0 && la.selfId >= 0);
  a.session.close();
  b.session.close();
} catch (err) {
  console.error(err);
  failures++;
}
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

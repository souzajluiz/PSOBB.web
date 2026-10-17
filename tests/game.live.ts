// Two clients and a game: A creates it, B lists and joins it, both see each
// other, move (6x42 / 6x40 / 6x3E), A warps to Forest 1, B follows, both go
// back to the lobby. Requires newserv + bridge running. Run: node tests/game.live.ts
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BBSession } from '../client/src/net/bbsession.ts';
import { Game } from '../client/src/net/game.ts';
import type { Lobby, LobbyPlayer } from '../client/src/net/lobby.ts';
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
const waitEvent = <T>(register: (resolve: (v: T) => void) => void, what: string) => timeout(new Promise<T>(register), what);

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
  check(
    `A and B in the lobby (client ${a.lobby.selfId}, ${b.lobby.selfId}); A has save data (${a.session.fullCharacter?.length ?? 0} bytes)`,
    a.lobby.selfId >= 0 && b.lobby.selfId >= 0 && (a.session.fullCharacter?.length ?? 0) >= 0x2ea4,
  );

  // A creates a game.
  const gameName = `web${Date.now() % 100000}`;
  const ga = await Game.create(a.lobby, ctxOf(a.session), { name: gameName, difficulty: 0, episode: 1 });
  const info = ga.info!;
  check(
    `A created "${gameName}": client ${info.clientId}, leader ${info.leaderId}, episode ${info.episode}, section ${info.sectionId}, seed ${info.randomSeed.toString(16)}`,
    info.clientId === 0 && info.leaderId === 0 && info.episode === 1,
  );
  check(`64 variations (floors 0-10): ${info.variations.slice(0, 11).map((v) => `${v.layout}/${v.entities}`).join(' ')}`, info.variations.length === 16);
  ga.finishLoading(0, 0, 0, 0);
  await timeout(ga.ready, 'A: B1 after 6F');
  check('A done loading (6F answered with B1)', true);

  // B lists and joins it.
  const list = await Game.list(b.lobby.conn);
  const entry = list.find((g) => g.name === gameName);
  check(
    `B lists ${list.length} game(s) incl. "${gameName}" (${entry?.players} player, max ${entry?.maxPlayers}, episode ${entry?.episode})`,
    !!entry && entry.players === 1 && entry.episode === 1,
  );
  // On BB the server, not the leader, sends 6x72 to the players already in the
  // game once the leader has sent its 6x70 to the joiner.
  const resumed = waitEvent<number>((r) => ga.on('subcommand', (sub) => sub === 0x72 && r(sub)), 'A gets 6x72');
  const aSawB = waitEvent<LobbyPlayer>((r) => ga.on('playerJoined', r), 'A gets 65');
  const gbP = Game.join(b.lobby, ctxOf(b.session), entry!.itemId);
  const gb = await gbP;
  const bSawA70 = waitEvent<LobbyPlayer>((r) => gb.on('playerJoined', (p) => p.clientId === 0 && p.charClass >= 0 && r(p)), 'B gets 6x70 from A');
  check(`B joined as client ${gb.selfId}; 64 lists ${[...gb.players.values()].map((p) => p.name).join(', ')}`, gb.selfId === 1 && [...gb.players.values()].some((p) => p.name === 'GameHunter'));
  const joinedB = await aSawB;
  check(`A got 65 for ${joinedB.name} (class ${joinedB.charClass})`, joinedB.clientId === 1 && joinedB.charClass === 6);
  const synced = await bSawA70;
  check(`B got A's 6x70: ${synced.name}, class ${synced.charClass}, level ${synced.level}, floor ${synced.floor}`, synced.charClass === 0 && synced.name === 'GameHunter');
  await resumed;
  check('server resumed the game for A after the sync (6x72)', ga.resumed);
  gb.finishLoading(10, 0, 20, 0);

  // Movement.
  const bSawRun = waitEvent<LobbyPlayer>((r) => gb.on('moved', (p) => p.clientId === 0 && p.moving && r(p)), 'B sees A run');
  ga.sendRun(50.5, -12.25);
  const run = await bSawRun;
  check(`B saw A run to (${run.position.x}, ${run.position.z})`, run.position.x === 50.5 && run.position.z === -12.25 && run.gait === 'run');
  const aSawWalk = waitEvent<LobbyPlayer>((r) => ga.on('moved', (p) => p.clientId === 1 && p.moving && r(p)), 'A sees B walk');
  gb.sendWalk(-7, 33);
  const walk = await aSawWalk;
  check(`A saw B walk to (${walk.position.x}, ${walk.position.z})`, walk.position.x === -7 && walk.gait === 'walk');
  const bSawStop = waitEvent<LobbyPlayer>((r) => gb.on('moved', (p) => p.clientId === 0 && !p.moving && p.position.x === 55 && r(p)), 'B sees A stop');
  ga.sendStop(55, 0, -10, Math.PI);
  const stop = await bSawStop;
  check(`B saw A stop at (${stop.position.x}, ${stop.position.z})`, stop.position.x === 55 && Math.abs(stop.angle - Math.PI) < 0.01);

  // A warps to Forest 1, B follows.
  const bSawWarp = waitEvent<LobbyPlayer>((r) => gb.on('floorChanged', (p) => p.clientId === 0 && p.floor === 1 && r(p)), 'B sees A on floor 1');
  ga.warp(1);
  ga.finishWarp(0, 0, 0, 0);
  await bSawWarp;
  check('B saw A warp to floor 1 (6x21)', gb.players.get(0)?.floor === 1);
  const aSawWarp = waitEvent<LobbyPlayer>((r) => ga.on('floorChanged', (p) => p.clientId === 1 && p.floor === 1 && r(p)), 'A sees B on floor 1');
  gb.warp(1);
  gb.finishWarp(5, 0, 5, 0);
  await aSawWarp;
  check('A saw B follow to floor 1', ga.players.get(1)?.floor === 1 && ga.self?.floor === 1);

  // Back to the lobby.
  const aSawLeave = waitEvent<number>((r) => ga.on('playerLeft', r), 'A gets 66');
  const lb = await gb.leave();
  check(`B is back in lobby ${lb.lobbyNumber + 1} as client ${lb.selfId}`, lb.active && lb.selfId >= 0 && !!lb.self);
  check('A got 66 for B', (await aSawLeave) === 1);
  const la = await ga.leave();
  check(`A is back in the lobby with ${la.players.size} players`, la.active && [...la.players.values()].some((p) => p.name === 'GameForce'));

  // The game is gone once empty.
  const after = await Game.list(lb.conn);
  check('the empty game was deleted', !after.some((g) => g.name === gameName));
  a.session.close();
  b.session.close();
} catch (err) {
  console.log(`FAIL ${(err as Error).message}`);
  failures++;
}
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

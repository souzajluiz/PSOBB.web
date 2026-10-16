// Two clients enter the same lobby; checks join/leave, chat and movement relay.
// Requires newserv + bridge running. Run: node web/tests/lobby.live.ts
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BBSession } from '../client/src/net/bbsession.ts';
import type { Lobby, LobbyPlayer } from '../client/src/net/lobby.ts';
import { nodeBridge } from './lib/nodews.ts';

const ROOT = resolve(import.meta.dirname, '..');
const nsk = new Uint8Array(readFileSync(join(ROOT, 'vendor/newserv/system/blueburst/keys/default.nsk')));
let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
};
const timeout = <T>(p: Promise<T>, ms = 4000) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function join_(user: string, charName: string, charClass: number): Promise<{ session: BBSession; lobby: Lobby }> {
  const session = new BBSession({ nsk, connect: nodeBridge });
  await session.login(user, user);
  const slots = await session.characterPreviews();
  if (!slots[0]) await session.createCharacter(0, { name: charName, charClass });
  const lobby = await session.enterLobby(user, user, 0);
  return { session, lobby };
}

const a = await join_('webtest', 'WebHunter', 0);
check(`A in lobby as client ${a.lobby.selfId}`, a.lobby.selfId >= 0 && !!a.lobby.self);

const aSawJoin = new Promise<LobbyPlayer>((r) => a.lobby.on('playerJoined', r));
const b = await join_('webtest2', 'WebForce', 6);
check(`B sees ${b.lobby.players.size} players incl. A`, [...b.lobby.players.values()].some((p) => p.name === a.lobby.self!.name));
const joined = await timeout(aSawJoin);
check(`A got 68 for ${joined.name} (${joined.charClass === 6 ? 'FOmarl' : joined.charClass})`, joined.clientId === b.lobby.selfId);

const chat = new Promise<string>((r) => b.lobby.on('chat', (_from, _gc, text) => r(text)));
a.lobby.sendChat('hello from the browser client');
const text = await timeout(chat);
check(`B received chat "${text}"`, text.includes('hello from the browser client'));

const moved = new Promise<LobbyPlayer>((r) => b.lobby.on('moved', (p) => p.clientId === a.lobby.selfId && r(p)));
a.lobby.sendRun(123.5, -45.25);
const m = await timeout(moved);
check(`B saw A run to (${m.position.x}, ${m.position.z})`, m.position.x === 123.5 && m.position.z === -45.25);

const stopped = new Promise<LobbyPlayer>((r) => b.lobby.on('moved', (p) => p.clientId === a.lobby.selfId && !p.moving && r(p)));
a.lobby.sendStop(130, 0, -50, Math.PI / 2);
const s = await timeout(stopped);
check(`B saw A stop at (${s.position.x}, ${s.position.z}) angle ${s.angle.toFixed(2)}`, s.position.x === 130 && Math.abs(s.angle - Math.PI / 2) < 0.01);

const left = new Promise<number>((r) => a.lobby.on('playerLeft', r));
b.session.close();
check(`A got 69 when B left`, (await timeout(left)) === b.lobby.selfId);

a.session.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

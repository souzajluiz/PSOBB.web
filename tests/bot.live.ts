// A bot that joins the lobby, runs in a circle and answers chat.
// Useful as a second player while testing the browser client.
// Run: node web/tests/bot.live.ts [username] [seconds]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BBSession } from '../client/src/net/bbsession.ts';
import { nodeBridge } from './lib/nodews.ts';

const ROOT = resolve(import.meta.dirname, '..');
const nsk = new Uint8Array(readFileSync(join(ROOT, 'vendor/newserv/system/blueburst/keys/default.nsk')));
const [user = 'webbot', seconds = '120'] = process.argv.slice(2);

const session = new BBSession({ nsk, connect: nodeBridge, log: (m) => console.log(`[bot] ${m}`) });
await session.login(user, user);
const slots = await session.characterPreviews();
if (!slots[0]) await session.createCharacter(0, { name: 'RoboRAcast', charClass: 4 });
const lobby = await session.enterLobby(user, user, 0);
lobby.on('chat', (from, _gc, text) => {
  console.log(`[bot] chat from ${from?.name}: ${text}`);
  if (from && from.clientId !== lobby.selfId) lobby.sendChat(`echo: ${text}`);
});
lobby.on('playerJoined', (p) => lobby.sendChat(`hi ${p.name}!`));

// Circle around the first player we see (or the origin).
let t = 0;
const timer = setInterval(() => {
  t += 0.2;
  const other = [...lobby.players.values()].find((p) => p.clientId !== lobby.selfId);
  const cx = other?.position.x ?? 0;
  const cz = other?.position.z ?? 0;
  lobby.sendRun(cx + Math.cos(t) * 60, cz + Math.sin(t) * 60);
}, 200);
setTimeout(() => {
  clearInterval(timer);
  session.close();
  process.exit(0);
}, Number(seconds) * 1000);

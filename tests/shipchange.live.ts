// The counter's Change SHIP / Change BLOCK against a live newserv: A0 / A1 take
// the player out of the lobby (69), newserv sends the main menu again (07) and
// the character file again (E7) on the same connection, and picking "Go to
// lobby" puts the player back (67). A second client in the lobby sees A leave
// and come back.
// Requires newserv + bridge running. Run: node tests/shipchange.live.ts
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BBSession } from '../client/src/net/bbsession.ts';
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

try {
  const a = await enter('webshipa', 'ShipHunter', 0);
  const b = await enter('webshipb', 'ShipForce', 6);
  check('both in a lobby', a.lobby.selfId >= 0 && b.lobby.selfId >= 0);
  check('A is tracked as the session lobby', a.session.lobby === a.lobby);

  for (const [name, change] of [
    ['Change SHIP (A0)', () => a.session.changeShip()],
    ['Change BLOCK (A1)', () => a.session.changeBlock()],
  ] as const) {
    const aId = a.lobby.selfId;
    let gone = false;
    b.lobby.on('playerLeft', (id) => {
      if (id === aId) gone = true;
    });
    const before = a.session.fullCharacter;
    const menu = await change();
    check(`${name}: answered with the main menu`, !!menu && menu.length > 1);
    check(`${name}: entry 0 is the menu title (item_id 0xFFFFFFFF)`, menu?.[0]?.itemId === 0xffffffff);
    const go = menu?.find((m) => /lobby/i.test(m.name));
    check(`${name}: the menu offers "Go to lobby" (${menu?.map((m) => m.name).join(' | ')})`, !!go);
    await until('B sees A leave', () => gone);
    check(`${name}: B saw A leave the lobby (69)`, gone);
    check(`${name}: the character file was sent again (E7)`, a.session.fullCharacter !== before && !!a.session.character);
    const next = await a.session.selectMenuItem(go!);
    check(`${name}: "Go to lobby" joined a lobby (67)`, next === null && a.lobby.players.size >= 2 && !!a.lobby.self);
    check(`${name}: same character (${a.session.character?.name})`, a.session.character?.guildCardNumber === a.session.init?.guildCardNumber);
    await until('B sees A back', () => b.lobby.players.has(a.lobby.selfId));
    check(`${name}: B sees A again as client ${a.lobby.selfId}`, b.lobby.players.has(a.lobby.selfId));
  }
} catch (err) {
  console.error(err);
  failures++;
}
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

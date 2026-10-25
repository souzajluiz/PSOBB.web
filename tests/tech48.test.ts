// The 6x48 (technique released) sender. The exe's sender is the release of
// the cast state machine: 0x006a031c, called once from 0x006a01b9 when the
// state word (player +0x330) goes 2 -> 3. Its gate is is_player_in_unsafe_map
// (0x0068a3fc: the map id at player +0x3ec is outside the hub table
// 0x0097f1c8 = {0, 15, 18, 45}); with the gate closed the cast stays in state 3
// with no 6x48 and no TP drop. Its body: {48, 02, u16 player idx (+0x1c),
// u16 tech, u16 level (the level the 6x47 carried, at most 14)}, built at
// 0x006a03c4 and sent through 0x008003e0 with no target block.
//
// The port sends it from TechniqueCast's release (render/combat.ts
// releaseTechnique). The gate is not re-checked there: a cast starts only in an
// unsafe map (castTechnique, inUnsafeMap) and entering a floor clears the cast
// (enterFloor, render/combat.ts), so the two agree on every path the port reaches.
//
// Run: NEWSERV=... node tests/tech48.test.ts
import { Game, parseCastTechniqueComplete } from '../client/src/net/game.ts';
import { Lobby } from '../client/src/net/lobby.ts';
import { HUB_AREAS, inUnsafeMap } from '../client/src/render/playermove.ts';
import { TECH } from '../client/src/combat/techniques.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (a: unknown, b: unknown, msg: string) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const hex = (b: Uint8Array | undefined) => (b ? [...b].map((x) => x.toString(16).padStart(2, '0')).join('') : '');

// What a Game would put on the wire for one call: the 0x60 bodies it sends.
const sentBy = (run: (g: Game) => void, selfId = 0x0007): Uint8Array[] => {
  const sent: Uint8Array[] = [];
  const game = {
    selfId,
    conn: { send: (_cmd: number, _flags: number, body: Uint8Array) => sent.push(body) },
    sendSubcommand: Lobby.prototype.sendSubcommand,
  } as unknown as Game;
  run.call(null, game);
  return sent;
};

// Release of Megid at level 16 (the exe's 6x47 carries min(level, 14) = 14).
{
  const sent = sentBy((g) => Game.prototype.sendCastTechniqueComplete.call(g, TECH.megid, 16));
  eq(sent.length, 1, 'release: one body');
  eq(hex(sent[0]), '48020700' + '1200' + '0e00', 'release: 48 02 0700 tech 18 level 14 (8 bytes)');
  eq(sent[0]?.length, 8, 'release: body is 8 bytes');
  eq(parseCastTechniqueComplete(sent[0]!), { clientId: 7, tech: 18, level: 14 }, 'release: parses back');
}

// Release of Foie at level 0: the first level, no cap.
{
  const sent = sentBy((g) => Game.prototype.sendCastTechniqueComplete.call(g, TECH.foie, 0));
  eq(hex(sent[0]), '48020700' + '0000' + '0000', 'foie lv1: 48 02 0700 tech 0 level 0');
}

// An NPC player's release carries the NPC's client id, and the same bytes.
{
  const sent = sentBy((g) => Game.prototype.sendNpcCastTechniqueComplete.call(g, 0x0b, TECH.barta, 3));
  eq(hex(sent[0]), '48020b00' + '0300' + '0300', 'npc release: client id 0x0b, barta level 3');
}

// The release sends no target block: exactly the 8-byte header-and-two-words body.
{
  const sent = sentBy((g) => Game.prototype.sendCastTechniqueComplete.call(g, TECH.zonde, 5));
  eq(sent[0]?.length, 8, 'no target block after the two words');
}

// The exe's gate (is_player_in_unsafe_map): hub table and the port's rule.
eq([...HUB_AREAS], [0, 15, 18, 45], 'hub table 0x0097f1c8');
eq(inUnsafeMap(0x00), false, 'Pioneer 2 (0x00) is a hub: no release send');
eq(inUnsafeMap(0x12), false, 'Lab (0x12) is a hub');
eq(inUnsafeMap(0x01), true, 'Forest 1 (0x01) is outside the hub table: release sends');

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

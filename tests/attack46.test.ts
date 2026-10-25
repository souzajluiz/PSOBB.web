// The 6x46 attack-finished sender (Game.sendAttackTargets) with zero targets. The exe's
// send_0x60_0x46_attack_end (0x00699248) gates on the weapon's targeting entry (reticle type 2,
// update_player_targeting_info), not on the target count, so a strike that hits nothing still
// sends {46, 02, client id, u32 0}: 8 bytes, size_dwords 2. newserv forwards it (count 0 is within
// min(size - 2, 10)). The 6x47 / 6x48 senders have no target gate (SendCastTechPacket_0069a2f0).
//
// Run: NEWSERV=... node tests/attack46.test.ts
import { Game, parseAttackTargets } from '../client/src/net/game.ts';
import { Lobby } from '../client/src/net/lobby.ts';

let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = (a: unknown, b: unknown, msg: string) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// The real framing: Lobby.sendSubcommand writes {sub, size_dwords, client id, payload} into a 0x60 body.
const framed = (targets: Array<{ entityId: number; hitbox?: number }>) => {
  const sent: Uint8Array[] = [];
  const game = {
    selfId: 0x0007,
    conn: { send: (cmd: number, _flags: number, body: Uint8Array) => sent.push(body) },
    sendSubcommand: Lobby.prototype.sendSubcommand,
  } as unknown as Game;
  Game.prototype.sendAttackTargets.call(game, targets);
  return sent;
};

// Zero targets: one 0x60 body of 8 bytes, subcmd 0x46, size_dwords 2, client id 7, count 0.
{
  const sent = framed([]);
  eq(sent.length, 1, 'zero targets: one packet');
  eq(sent[0] ? hex(sent[0]) : '', '46020700' + '00000000', 'zero targets: 46 02 0700 00000000 (8 bytes)');
  eq(sent[0]?.length, 8, 'zero targets: body is 8 bytes');
  eq(parseAttackTargets(sent[0]!), { clientId: 7, targets: [] }, 'zero targets: parses back as count 0');
}

// One and two targets: size_dwords = count + 2, entries as {u16 entity id, u16 hit box}.
{
  const one = framed([{ entityId: 0x1005 }]);
  eq(one[0] ? hex(one[0]) : '', '4603' + '0700' + '01000000' + '05100000', 'one target: 46 03 0700 count 1, entity 0x1005 box 0');
  const two = framed([{ entityId: 0x1000, hitbox: 2 }, { entityId: 0x1001 }]);
  eq(two[0] ? hex(two[0]) : '', '4604' + '0700' + '02000000' + '00100200' + '01100000', 'two targets: size 4, entries 0x1000/box 2 and 0x1001/box 0');
}

// More than ten targets are cut to ten (size_dwords 12, the exe's clamp range).
{
  const many = Array.from({ length: 12 }, (_, i) => ({ entityId: 0x1000 + i }));
  const sent = framed(many);
  eq(sent[0]?.[1], 12, 'eleven+ targets: size_dwords 12');
  eq(parseAttackTargets(sent[0]!)?.targets.length, 10, 'eleven+ targets: ten entries on the wire');
}

// The zero-target body parses through the receive side the same as an empty strike.
{
  const parsed = parseAttackTargets(Uint8Array.from([0x46, 0x02, 0x07, 0, 0, 0, 0, 0]));
  eq(parsed, { clientId: 7, targets: [] }, 'parseAttackTargets: empty strike');
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

// Photon blasts (combat/photonblast.ts): the gauge's gain from damage dealt
// and taken, the 100 cap and its 6x39 / 6x3A events, every basic blast's
// power formula and the 6x49 / 6x37 / 6x39 bytes.
// Run: node tests/photonblast.test.ts
import {
  PB_BASE, PB_CREATE_TICKS_ASSUMED, PB_FULL, PB_SLOT_BLAST, PB_SLOT_ONE, pbBasePower, pbBlockedBy, pbCounterEndUpdates, pbDamage, pbDelayFor, pbGain,
  pbLocalEndUpdates, pbParticipants, pbPower, pbTechHitTicks, PhotonBlastGauge, PhotonBlastSlots, type PbCaster,
} from '../client/src/combat/photonblast.ts';
import { Game } from '../client/src/net/game.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string) => check(Math.abs(a - b) < 1e-3, `${what}: ${a} != ${b}`);

// 1. Gain: trunc(damage) / ((level + 1) * 15); taken damage counts 20 times.
near(pbGain(30.9, 0, false), 30 / 15, 'Lv1 dealing 30.9: 2');
near(pbGain(30, 9, false), 30 / 150, 'Lv10 dealing 30');
near(pbGain(7.5, 9, true), 150 / 150, 'Lv10 taking 7.5: trunc(150) / 150');
near(pbGain(100, 500, false), 100 / (200 * 15), 'level clamped to the maximum');
eq(pbGain(0, 3, false), 0, 'no damage, no gain');

// 2. The gauge: capped at 100, ready once, emptied when fired.
{
  const g = new PhotonBlastGauge();
  eq(g.add(60), null, 'below 100');
  eq(g.add(60), 'ready', '6x39 at 100');
  eq(g.charge, PB_FULL, 'capped at 100');
  eq(g.add(10), null, 'nothing more at 100');
  eq(g.ready, true, 'ready');
  eq(g.spend(), 'notReady', '6x3A when it empties');
  eq(g.charge, 0, 'empty');
}

// 3. Power per blast.
const c: PbCaster = { atp: 300, equipAtp: 100, evp: 200, ata: 120, synchro: 120, iq: 200 };
eq([...PB_BASE], [500, 350, 1200, 500, 150, 0], 'table 0x009cb4e0 base powers');
near(pbBasePower(0, c), 120 * 400 * 0.025 + 200 * 2.5 + 500, 'Farlla');
near(pbBasePower(1, c), 200 * 120 * 0.15 + 200 * 15 + 350, 'Estlla');
near(pbBasePower(2, c), 120 * 400 * 0.075 + 200 * 7.5 + 1200, 'Golla');
near(pbBasePower(3, c), 120 * 120 * 0.075 + 200 * 7.5 + 500, 'Pilla');
near(pbBasePower(4, c), 200 * 0.5 + 150, 'Leilla');
near(pbBasePower(5, c), 20, 'Mylla & Youlla capped at 20');
near(pbBasePower(5, { ...c, iq: 50 }), 5, 'Mylla & Youlla IQ * 0.1');
near(pbPower(0, c, 100, 1), pbBasePower(0, c), 'one blast at 100: factor 1');
near(pbPower(0, c, 100, 2), 2 * pbBasePower(0, c), 'two joined: factor 2');
near(pbDamage(1000, 20), 1000 * 80 * 0.002, 'group 4 damage vs ELT 20');

// 4. Bytes.
{
  const sent: Uint8Array[] = [];
  const game = Object.create(Game.prototype) as Game;
  (game as unknown as { selfId: number }).selfId = 2;
  (game as unknown as { conn: { send: (c: number, f: number, b: Uint8Array) => void } }).conn = { send: (_c, _f, b) => sent.push(b) };
  game.sendPhotonBlast(1, 100, [{ entityId: 0x1005 }, { entityId: 0x1007 }]);
  game.sendPhotonBlastDone(100);
  game.sendPhotonBlastReady(true);
  game.sendPhotonBlastReady(false);
  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
  eq(hex(sent[0]), '49 05 02 00 01 00 02 00 64 00 00 00 05 10 00 00 07 10 00 00', '6x49 with two targets (3 + n dwords)');
  eq(hex(sent[1]), '37 02 02 00 64 00 00 00', '6x37');
  eq(hex(sent[2]), '39 01 02 00', '6x39');
  eq(hex(sent[3]), '3a 01 02 00', '6x3A');
}

// 7. Per-slot blast state (something_about_photon_blasts): the constructor sets 2 for
// each participant below 4; the destructor clears them when the caster is below 4;
// the icon follows GetPhotonBlastData (1 or 2), never the gauge.
{
  const s = new PhotonBlastSlots();
  eq([0, 1, 2, 3].map((i) => s.active(i)), [false, false, false, false], 'no blast: no icon');
  s.start([1]);
  eq([0, 1, 2, 3].map((i) => s.get(i)), [0, 2, 0, 0], 'start sets state 2 for the caster slot only');
  eq(s.active(1), true, 'state 2 shows the icon');
  s.start([2, 7]);
  eq(s.get(2), 2, 'participant 2 set');
  eq(s.get(7), 0, 'slot 7 (out of range) ignored');
  s.end(1, [1]);
  eq(s.get(1), 0, 'end clears the participant when the caster is below 4');
  eq(s.get(2), 2, 'end leaves other slots alone');
  s.start([0]);
  s.end(5, [0]);
  eq(s.get(0), 2, 'caster 5 (not below 4): the destructor does not clear');
  s.reset();
  eq([0, 1, 2, 3].map((i) => s.active(i)), [false, false, false, false], 'reset clears all four');
  // The exe never stores 1 (the only stores to the array are 0 and 2), so the
  // icon state is never 1 in a live blast.
  s.start([3]);
  eq(s.get(3) === PB_SLOT_ONE, false, 'a started blast is state 2, not 1');
  eq(PB_SLOT_BLAST, 2, 'state 2 constant');
}

// 8. Joins, the gate and the end timing (CreatePhotonBlast, dump 547409; the
// constructor's delay 100 + 150 n; SpawnBossEntity phase 2).
{
  // The delay: n = the index of the first empty participant; all four filled
  // leaves n at 0 (the exe's loop), so the delay is 100.
  eq([0, 1, 2, 3, 4].map((n) => pbDelayFor(n)), [100, 250, 400, 550, 100], 'delay 100 + 150 n, 4 filled gives 100');
  eq(pbCounterEndUpdates(1), 251, 'counter branch: effect on update delay + 1');
  eq(pbLocalEndUpdates(1), 4, 'local branch: 2 n + 2 updates for one participant');
  eq(pbLocalEndUpdates(4), 10, 'local branch: four participants');
  eq(pbTechHitTicks(1, true), PB_CREATE_TICKS_ASSUMED + 3, 'fire to effect: creation (ASSUMED) + 3 entries');
  // Participants: same-room players with a weapon field, in slot order.
  eq(pbParticipants([{ slot: 2, field: 0 }, { slot: 0, field: -1 }, { slot: 1, field: 3 }]), [1, 2], 'no-field players are left out, slot order');
  eq(pbParticipants([{ slot: 5, field: 0 }, { slot: 3, field: 1 }]), [3], 'slot 5 out of range');
  eq(pbParticipants([]), [], 'no entries, no participants');
  // The gate: another player's blast (state != 0) blocks a new one; the caster's own does not count.
  const s = new PhotonBlastSlots();
  eq(pbBlockedBy(s, 0), false, 'empty room: not blocked');
  s.start([1]);
  eq(pbBlockedBy(s, 0), true, 'slot 1 in a blast blocks slot 0');
  eq(pbBlockedBy(s, 1), false, 'the caster\'s own blast does not block itself');
  s.end(1, [1]);
  eq(pbBlockedBy(s, 0), false, 'after the end, not blocked');
}

if (failures) {
  console.log(`photonblast: ${failures} failure(s)`);
  process.exit(1);
}
console.log('photonblast: all checks passed');

// Photon blasts (combat/photonblast.ts): the gauge's gain from damage dealt
// and taken, the 100 cap and its 6x39 / 6x3A events, every basic blast's
// power formula and the 6x49 / 6x37 / 6x39 bytes.
// Run: node tests/photonblast.test.ts
import { PB_BASE, PB_FULL, pbBasePower, pbDamage, pbGain, pbPower, PhotonBlastGauge, type PbCaster } from '../client/src/combat/photonblast.ts';
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

if (failures) {
  console.log(`photonblast: ${failures} failure(s)`);
  process.exit(1);
}
console.log('photonblast: all checks passed');

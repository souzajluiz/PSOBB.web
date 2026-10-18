// Mines FSMs (combat/enemyfsmmines.ts) and their shots (combat/enemyshots.ts):
// Dubchic / Gillchic walk, melee, laser and revival; Garanz phases, mines and
// the missile barrage; Sinow Beat's warp-strike, combo and warp away;
// Canadine laser / zap and the Canane's ring.
// Run: node tests/enemyfsmmines.test.ts
import { CANADINE, CanadineAi, CanadineLaser, CananeAi, DUBCHIC, DubchicAi, GARANZ, GaranzAi, SINOW, SinowAi } from '../client/src/combat/enemyfsmmines.ts';
import { DubchicLaser, GaranzMine, GaranzMissile, LASER, MINE } from '../client/src/combat/enemyshots.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';
import { STATUS } from '../client/src/combat/status.ts';
import { expandEnemySets } from '../client/src/formats/enemyslots.ts';
import type { EnemySet } from '../client/src/formats/setdata.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string, eps = 1e-3) => check(Math.abs(a - b) < eps, `${what}: ${a} != ${b}`);
const player = (x: number, z: number, charClass = 0): AiTarget => ({ clientId: 0, x, z, charClass, dead: false, angle: 0 });
const atk = (distanceX: number, angle = 0x2000) => ({ minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX, angle, distanceY: 0 });
const mv = (f: number[], i: number[]) => ({ fparam1: f[0] ?? 0, fparam2: f[1] ?? 0, fparam3: f[2] ?? 0, fparam4: f[3] ?? 0, fparam5: f[4] ?? 0, fparam6: f[5] ?? 0, iparam: i });

// --- Dubchic / Gillchic ----------------------------------------------------------
{
  const m = mv([0.8, 0, 0.6, 1.2, 0.7], [90, 45, 90, 225, 0, 0]);
  const d = new DubchicAi({ x: 0, z: 0, angle: 0, param1: 0, gillchic: false, ultimate: false, movement: m, attack: atk(12), rng: () => 0.9 });
  for (let f = 0; f < 29; f++) d.tick([player(0, 160)]);
  eq(d.state, 'idle', 'it looks every 30 frames');
  d.tick([player(0, 160)]);
  eq(d.state, 'walk', 'even param1: aggro 170');
  const odd = new DubchicAi({ x: 0, z: 0, angle: 0, param1: 1, gillchic: false, ultimate: false, movement: m, attack: atk(12) });
  for (let f = 0; f < 30; f++) odd.tick([player(0, 210)]);
  eq(odd.state, 'walk', 'odd param1: aggro 220');
  const z0 = d.z;
  d.tick([player(0, 160)]);
  near(d.z - z0, DUBCHIC.speed, 'the Dubchic walks 0.37037 a frame');
  const g = new DubchicAi({ x: 0, z: 0, angle: 0, param1: 0, gillchic: true, ultimate: false, movement: m, attack: atk(12), rng: () => 0.1 });
  for (let f = 0; f < 30; f++) g.tick([player(0, 30)]);
  g.tick([player(0, 30)]);
  near(g.z, DUBCHIC.gillchicSpeed, 'the Gillchic walks 0.57037');
  for (let f = 0; f < 80 && g.state === 'walk'; f++) g.tick([player(0, 15)]);
  eq(g.state, 'melee', 'inside distance_x: melee');
  const hits: number[] = [];
  let slowed = 0;
  for (let f = 0; f < 60 && g.state === 'melee'; f++) {
    const r = g.tick([player(0, 15)], f === 50);
    if (r.hit) hits.push(f);
    if (r.status?.type === STATUS.slow) slowed++;
  }
  eq(hits.length, 2, 'two melee hits (frames 20 and 28)');
  eq(slowed, 2, 'the Gillchic slows with a roll <= 1/6');
  // The laser: walked 80 units, roll < 0.35.
  const l = new DubchicAi({ x: 0, z: 0, angle: 0, param1: 2, gillchic: false, ultimate: false, movement: m, attack: atk(5), rng: () => 0.1 });
  const far = player(0, 140);
  for (let f = 0; f < 30; f++) l.tick([far]);
  for (let f = 0; f < 300 && l.state === 'walk'; f++) l.tick([far]);
  eq(l.state, 'laser', 'after 80 units a 0.35 roll fires the laser');
  let lasers = 0;
  for (let f = 0; f < 400 && l.state === 'laser'; f++) lasers += l.tick([far]).shots?.length ?? 0;
  eq(lasers, 2, 'round(param1) = 2 shots');
  const shot = new DubchicLaser(0, 12, 0, 0, 225);
  let hit: AiTarget[] = [];
  for (let f = 0; f < 30 && !shot.done; f++) hit = shot.tick([player(0, 100)]);
  eq([hit.length, shot.effect], [1, { kind: 'tech', power: 225 }], 'the laser hits with entity_hit_by_tech (group 0, iparam4)');
  const miss = new DubchicLaser(0, 12, 0, 0, 225);
  let n = 0;
  while (!miss.done) {
    miss.tick([]);
    n++;
  }
  eq(n, Math.ceil(LASER.range / LASER.speed), 'it dies after 150 units');
  // Revival: 5 deaths for a Dubchic, none for a Gillchic.
  const rv = new DubchicAi({ x: 0, z: 0, angle: 0, param1: 0, gillchic: false, ultimate: false, movement: m, attack: atk(12) });
  const ups = [1, 2, 3, 4, 5, 6].map(() => rv.revive());
  eq(ups, [true, true, true, true, false, false], 'a Dubchic gets up 4 times (dies for good on the 5th death)');
  check(rv.revived, 'the revived flag');
  eq(new DubchicAi({ x: 0, z: 0, angle: 0, param1: 0, gillchic: true, ultimate: false, movement: m, attack: atk(12) }).revive(), false, 'a Gillchic never gets up');
  const dn = new DubchicAi({ x: 0, z: 0, angle: 0, param1: 0, gillchic: false, ultimate: false, movement: m, attack: atk(12) });
  dn.revive();
  check(dn.invulnerable, 'lying down it cannot be hurt');
  for (let f = 0; f < 89; f++) dn.tick([]);
  eq(dn.state, 'down', 'it lies iparam1 frames');
  dn.tick([]);
  dn.tick([], true);
  eq(dn.state, 'idle', 'then it stands up');
}

// --- Garanz ------------------------------------------------------------------------
{
  const m = mv([55, 1.2, 0, 1.42, 0.17], [30, -30, 245, 320, 0, 0]);
  const g = new GaranzAi({ x: 0, z: 0, angle: 0, movement: m, rng: () => 0.5 });
  for (let f = 0; f < 30; f++) g.tick([player(0, 200)]);
  eq(g.state, 'walk', 'phase 0: walk toward sorted[1]');
  let f = 0;
  while (g.state === 'walk' && f++ < 200) g.tick([player(0, 200)]);
  eq(f, Math.ceil(55 / 1.2), 'it walks mv.f1 units');
  eq(g.state, 'barrage', 'then the barrage');
  check(g.superArmor, 'the barrage has super armor');
  let missiles = 0;
  for (let k = 0; k < 200 && g.state === 'barrage'; k++) missiles += g.tick([player(0, 200)]).shots?.length ?? 0;
  eq(missiles, 4, 'phase 0 fires 4 missiles');
  g.hpFraction = 0.3;
  g.updatePhase();
  eq(g.phase, 1, 'HP <= 1/3: phase 1');
  eq(g.volley().length, 8, 'phase 1 fires 8');
  g.hpFraction = 0.2;
  g.updatePhase();
  eq([g.phase, g.volley().length], [2, 16], 'HP <= 1/4: phase 2 fires 16');
  // Phase 1+: the mine walk, a mine every 20 units of 120.
  const h = new GaranzAi({ x: 0, z: 0, angle: 0, movement: m, rng: () => 0.5 });
  h.hpFraction = 0.3;
  for (let k = 0; k < 30; k++) h.tick([player(0, 250)]);
  eq(h.state, 'mines', 'phase 1 lays mines');
  let mines = 0;
  while (h.state === 'mines') mines += h.tick([player(0, 250)]).shots?.length ?? 0;
  eq(mines, GARANZ.mineWalk / GARANZ.mineEvery, '6 mines over 120 units');
  const mi = new GaranzMine(0, 15, 0, 0, 320, () => 0.5);
  let boom: AiTarget[] = [];
  let frames = 0;
  while (!mi.done) {
    boom = mi.tick([player(80, 0)]);
    frames++;
  }
  eq([frames, boom.length], [MINE.life, 0], 'a mine nobody touches explodes after 150 frames');
  const mi2 = new GaranzMine(0, 15, 0, 0, 320, () => 0.5);
  frames = 0;
  while (!mi2.done) {
    boom = mi2.tick([player(0, -10)]);
    frames++;
  }
  check(frames > MINE.arm && boom.length === 1, `a mine armed after 15 frames explodes on contact (${frames})`);
  const ms = new GaranzMissile({ x: 0, y: 20, z: 0, yaw: 0, pitch: Math.PI / 8, speed: 1.42, steer: 0.17, lifeAdjust: -30, power: 245, targetId: 0 });
  frames = 0;
  boom = [];
  while (!ms.done) {
    boom = ms.tick([player(30, 40)]);
    frames++;
  }
  check(boom.length === 1 && frames <= 121, `the missile homes onto its target (${frames} frames)`);
}

// --- Sinow Beat ------------------------------------------------------------------------
{
  const m = mv([1.25, 0.8, 0.6], [0, 0, 3, 0, 0, 0]);
  const s = new SinowAi({ x: 0, z: 0, angle: 0, gold: false, ultimate: false, movement: m, attack: atk(15), radius: 10, rng: () => 0.05 });
  for (let f = 0; f < 30; f++) s.tick([player(0, 120)]);
  eq(s.state, 'drop', 'after 30 frames with a target: the ceiling drop');
  check(s.superArmor, 'no flinch while dropping');
  s.tick([player(0, 120)], true);
  s.tick([player(0, 120)]);
  eq(s.state, 'chase', 'lost -> chase');
  s.tick([player(0, 120)]);
  eq(s.state, 'warp', '100..150 away: the warp-strike');
  let hidden = 0;
  let hit = 0;
  let f = 0;
  let appearZ = 0;
  while (s.state === 'warp' && f++ < 100) {
    const r = s.tick([player(0, 120)], s['frames'] >= 40);
    if (r.hidden) {
      hidden++;
      appearZ = s.z;
    }
    if (r.hit) hit++;
  }
  near(hidden, SINOW.warpFrames, 'it is hidden for 12.857 ticks', 1);
  check(appearZ > 90 && appearZ < 105, `it reappears ~20 short of the target (${appearZ.toFixed(1)})`);
  eq(hit, 1, 'and strikes once at frame 25');
  const c = new SinowAi({ x: 0, z: 0, angle: 0, gold: false, ultimate: false, movement: m, attack: atk(15), radius: 10, rng: () => 0.05 });
  for (let k = 0; k < 30; k++) c.tick([player(0, 20)]);
  c.tick([player(0, 20)], true);
  c.tick([player(0, 20)]);
  c.tick([player(0, 20)]);
  eq(c.state, 'combo', 'within 25: the combo');
  let hits = 0;
  let confused = 0;
  for (let k = 0; k < 60 && c.state === 'combo'; k++) {
    const r = c.tick([player(0, 20)]);
    if (r.hit) hits++;
    if (r.status?.type === STATUS.confusion) confused++;
  }
  eq([hits, confused], [2, 1], 'two hits, the second confuses (roll < 0.1666)');
  for (let k = 0; k < 200 && c.state !== 'combo'; k++) c.tick([player(0, 20)]);
  for (let k = 0; k < 60 && c.state === 'combo'; k++) c.tick([player(0, 20)]);
  eq(c.state, 'away', 'every 2nd combo: the warp away');
  const ult = new SinowAi({ x: 0, z: 0, angle: 0, gold: false, ultimate: true, movement: m, attack: atk(15), radius: 10 });
  check(ult.superArmor, 'never flinches in Ultimate');
}

// --- Canadine / Canane -----------------------------------------------------------------
{
  const m = mv([0.6, 200, 220], [4, 3, 5, 2, 45, 7]);
  const c = new CanadineAi({ x: 0, z: 0, angle: 0, kind: 'standalone', inFighter: false, movement: m, attack: atk(10), radius: 10, rng: () => 0.5 });
  c.tick([player(0, 150)]);
  eq(c.state, 'notice', 'a standalone Canadine notices within 200');
  for (let f = 0; f < 200 && c.state !== 'laser'; f++) c.tick([player(0, 150)]);
  near(c.alt, CANADINE.high, 'it rises to 45');
  eq(c.state, 'laser', 'an out-fighter starts with the laser');
  let lasers = 0;
  for (let f = 0; f < 600 && c.state === 'laser'; f++) lasers += c.tick([player(0, 150)], true).shots?.length ?? 0;
  eq([lasers, c.state], [2, 'orbit'], 'iparam4 = 2 shots, then (standalone) the orbit');
  const lz = new CanadineLaser(0, 45, 0, 0, 100);
  let got: AiTarget[] = [];
  let n = 0;
  while (!lz.done) {
    got = lz.tick([player(0, 100)]);
    n++;
  }
  eq([n, got.length], [5, 1], 'the laser flies 20 a frame and hits where it was aimed');
  // Zap: an in-fighter dives and zaps.
  const z = new CanadineAi({ x: 0, z: 0, angle: 0, kind: 'standalone', inFighter: true, movement: m, attack: atk(10), radius: 10, rng: () => 0.01 });
  let zaps = 0;
  let shock = 0;
  const android = player(0, 30, 2);
  for (let f = 0; f < 1500 && z.state !== 'orbit'; f++) {
    const r = z.tick([android]);
    if (r.hit) zaps++;
    if (r.status?.type === STATUS.shock) shock++;
  }
  eq([zaps, z.state], [3, 'orbit'], 'three zaps, then the orbit');
  check(shock > 0, 'an android can be shocked by the zap');
  // The Canane: ring slots and the release order.
  const lead = new CananeAi({ x: 0, z: 0, angle: 0, movement: m, attack: atk(10), radius: 10, rng: () => 0.5 });
  const slots = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => lead.ringSlot(i));
  near(Math.hypot(slots[2].x, slots[2].z), CANADINE.ringRadius, 'ring radius 40');
  eq(slots.map((s) => s.inFighter), [false, false, true, true, true, true, true, true], 'ceil(8 / 7) = 2 out-fighters');
  lead.children = slots.map((s) => new CanadineAi({ x: s.x, z: s.z, angle: 0, kind: 'ring', inFighter: s.inFighter, movement: m, attack: atk(10), radius: 10 }));
  const p = player(0, 150);
  for (let f = 0; f < 120; f++) {
    lead.tick([p]);
    for (const ch of lead.children) ch.tick([p]);
  }
  eq(lead.children.map((ch) => ch.released), [true, true, false, false, false, false, false, false], 'blink pattern 0, then the out-fighters go');
  lead.children[5].state = 'dead';
  lead.children[6].state = 'dead';
  lead.childGone();
  for (let f = 0; f < 60; f++) lead.tick([p]);
  check(lead.children.filter((ch) => ch.inFighter && ch.state !== 'dead').every((ch) => ch.released), 'with 6 left the in-fighters follow after pattern 2');
  for (const i of [0, 1]) lead.children[i].state = 'dead';
  eq(lead.childGone(), false, '4 left: everyone is freed');
  for (let f = 0; f < 70; f++) lead.tick([p]);
  check(lead.free && lead.children.every((ch) => ch.state === 'dead' || ch.free), 'blink pattern 4 frees the ring');
  for (const i of [2, 3]) lead.children[i].state = 'dead';
  eq(lead.childGone(), true, '2 left: the ring leaves');
  eq(lead.state, 'gone', 'the Canane leaves without EXP');
  // newserv: CANANE + 8 CANADINE_GROUP slots, Sinow + 4.
  const set = (type: number, params: number[] = [0, 0, 0, 0, 0, 0, 0]) => ({ type, index: 0, params, numChildren: 0, section: 0, wave: 0 }) as unknown as EnemySet;
  const s1 = expandEnemySets([set(0x84)], 1);
  eq([s1.length, s1[0].type, s1[1].type, s1[8].type], [9, 'CANANE', 'CANADINE_GROUP', 'CANADINE_GROUP'], 'Canane + 8 CANADINE_GROUP slots');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsmmines: all checks passed');

// Caves FSMs (combat/enemyfsmcaves.ts): the Grass Assassin's chase / slash /
// web / dash and its enrage, the Nano Dragon's combat choice, breath, volley
// and take-off, the Shark's AI record; the Dubchic laser / Garanz shots of
// combat/enemyshots.ts that the Caves code shares.
// Run: node tests/enemyfsmcaves.test.ts
import { GRASS, GrassAi, NANO, NanoBreath, NanoDragonAi, NanoShot } from '../client/src/combat/enemyfsmcaves.ts';
import { aiConfig, type AiTarget } from '../client/src/combat/enemyai.ts';
import { enemyCombatMotions } from '../client/src/combat/enemymotions.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string, eps = 1e-3) => check(Math.abs(a - b) < eps, `${what}: ${a} != ${b}`);
const player = (x: number, z: number): AiTarget => ({ clientId: 0, x, z, charClass: 0, dead: false, angle: 0 });
const atk = (distanceX: number, angle = 0x1000) => ({ minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX, angle, distanceY: 0 });

// --- Shark: the Booma handlers with its own record ---------------------------
eq([aiConfig('TObjEneShark', 0), aiConfig('TObjEneShark', 1), aiConfig('TObjEneShark', 2)].map((c) => c.detect), [225, 250, 300], 'Evil / Pal / Guil Shark search 225 / 250 / 300');
eq(aiConfig('TObjEneShark').turnRate, 1024, 'Shark turn rate 1024');
eq(enemyCombatMotions('TObjEneShark', null as never).damage, { index: 3, speed: 1 }, 'Shark flinch row 6 at 1.0');

// --- Grass Assassin ------------------------------------------------------------
{
  const attacks = [atk(15), atk(120), atk(200)];
  const mk = (fparam2 = 0, rng = () => 0.9) => new GrassAi({ x: 0, z: 0, angle: 0, attacks, radius: 10, fparam1: 0.5, fparam2, rng });
  const g = mk();
  g.tick([player(0, 500)]);
  eq(g.state, 'idle', 'a player beyond 400 is not noticed');
  g.tick([player(0, 300)]);
  eq(g.state, 'chase', 'a player within 400 is chased (mode 1)');
  const z0 = g.z;
  g.tick([player(0, 300)]);
  check(g.z > z0 && g.z - z0 <= GRASS.speed * GRASS.creep + 1e-6 || g.z - z0 <= GRASS.speed + 1e-6, 'the chase creeps or runs at 0.75');
  // Web at 120 + 10, slash at 15 + 10.
  const w = mk();
  w.tick([player(0, 100)]);
  w.tick([player(0, 100)]);
  eq(w.state, 'web', 'inside AttackData[1] (not [0]): the web');
  let hold = null;
  let r;
  for (let f = 0; f < 5 && !hold; f++) {
    r = w.tick([player(0, 100)], f === 3);
    hold = r.hold ?? null;
  }
  eq(hold && [hold.frames, hold.particle, hold.radius2], [GRASS.webFrames, 1, 0], 'the web imposes a 180-frame hold, particle 1, radius 0');
  const s = mk(0, () => 0.2);
  s.tick([player(0, 20)]);
  s.tick([player(0, 20)]);
  eq(s.state, 'slash', 'within 10 + 15: the slash');
  r = s.tick([player(0, 20)]);
  eq(r.motion?.index, 4, 'roll <= 0.5: animation 3 (motion 4)');
  let hit = null;
  for (let f = 0; f < 30 && !hit; f++) hit = s.tick([player(0, 20)]).hit;
  eq(hit && hit.kbScale, 1, 'the slash knocks back by the damage it did');
  // Enrage below fparam1: always the dash.
  const e = mk();
  e.tick([player(0, 300)]);
  e.hpFraction = 0.4;
  e.onDamage(0);
  e.resume();
  check(e.enraged, 'below fparam1 of its HP it enrages');
  e.tick([player(0, 300)]);
  e.tick([player(0, 300)]);
  for (let f = 0; f < 31 && e.state !== 'dash'; f++) e.tick([player(0, 300)]);
  eq(e.state, 'dash', 'an enraged assassin dashes whatever the range');
  check(e.tick([player(0, 300)]) !== null && e.invulnerable, 'the crouch is invulnerable');
  // Ambush mode: fparam2 > 0 runs ahead of the spawn point first.
  const a = mk(50);
  a.tick([player(0, 300)]);
  eq(a.state, 'ambush', 'fparam2 > 0: the ambush run');
}

// --- Nano Dragon -----------------------------------------------------------------
{
  const mv = { fparam1: 2, fparam2: 3, fparam3: 2, fparam4: 0.1, fparam5: 0.01, fparam6: 0, iparam: [40, 25, 0, 0, 0, 0] };
  const d = new NanoDragonAi({ x: 0, z: 0, angle: 0, param2: 50, movement: mv, rng: () => 0.5 });
  for (let f = 0; f < 29; f++) d.tick([player(0, 120)]);
  eq(d.state, 'idle', 'it searches every 30 frames');
  d.tick([player(0, 120)]);
  eq(d.state, 'combat', 'a player within 150 -> combat');
  near(NANO.walk, 0.2777777, 'walk speed 0.46296 * 0.6');
  let st = '';
  for (let f = 0; f < 400 && d.state === 'combat'; f++) {
    d.tick([player(0, 120)]);
    st = d.state;
  }
  eq(st, 'volley', 'facing a player within 400: the first attack is the volley (toggle)');
  let shots = 0;
  for (let f = 0; f < 120 && d.state === 'volley'; f++) shots += d.tick([player(0, 120)]).shots?.length ?? 0;
  eq(shots, 1, 'one homing shot per player at frame 20');
  // Breath below a quarter of HP.
  const b = new NanoDragonAi({ x: 0, z: 0, angle: 0, param2: 50, movement: mv, rng: () => 0.5 });
  b.hpFraction = 0.2;
  for (let f = 0; f < 30; f++) b.tick([player(0, 120)]);
  for (let f = 0; f < 400 && b.state === 'combat'; f++) b.tick([player(0, 120)]);
  eq(b.state, 'breath', 'below a quarter of its HP: always the breath');
  // Take-off when a player comes within 50.
  const t = new NanoDragonAi({ x: 0, z: 0, angle: 0, param2: 50, movement: mv, rng: () => 0.5 });
  for (let f = 0; f < 30; f++) t.tick([player(0, 120)]);
  t.tick([player(0, 30)]);
  eq(t.state, 'takeoff', 'a player within 50: take-off');
  let maxH = 0;
  for (let f = 0; f < 600 && t.state === 'takeoff'; f++) {
    t.tick([player(0, 30)], f === 25);
    maxH = Math.max(maxH, t.height);
  }
  eq(maxH, NANO.cruise, 'it rises to 50');
  eq([t.state, t.height], ['idle', 0], 'and lands back in idle');
  // The breath pierces and dies after 500 units.
  const br = new NanoBreath(0, 10, 0, 0, 10, 100, 3, 40);
  let hits = 0;
  let frames = 0;
  while (!br.done && frames < 1000) {
    hits += br.tick([player(0, 60)]).length;
    frames++;
  }
  check(hits > 1, `the breath keeps hitting a player it passes through (${hits})`);
  eq(Math.ceil(500 / 3), frames, 'it travels 500 units');
  const sh = new NanoShot({ x: 0, y: 10, z: 0, yaw: Math.PI / 2, speed: 2, steer: 0.1, grow: 0.01, power: 25, targetId: 0, near: true });
  let got: AiTarget[] = [];
  for (let f = 0; f < NANO.shotLife && !sh.done; f++) got = sh.tick([player(0, 60)]);
  eq(got.length, 1, 'the homing shot turns onto its target');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsmcaves: all checks passed');

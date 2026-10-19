// Episode 2 FSMs (combat/enemyfsmep2.ts): the Merillia / Meriltas burrow,
// wake-up, chase, melee, run and pollen; the Dolmolm / Dolmdarl emergence,
// melee, back step and the holding dance.
// Run: node tests/enemyfsmep2.test.ts
import { BOOMA_MELEE, DOLMOLM, DolmolmAi, MERILLIA, MerilliaAi, SporeCloud } from '../client/src/combat/enemyfsmep2.ts';
import type { AiFrame, AiTarget } from '../client/src/combat/enemyai.ts';
import { enemyCombatMotions } from '../client/src/combat/enemymotions.ts';
import { STATUS } from '../client/src/combat/status.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const player = (x: number, z: number, clientId = 0): AiTarget => ({ clientId, x, z, charClass: 0, dead: false, angle: 0 });
const atk = (distanceX: number, angle = 0x2000) => ({ minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX, angle, distanceY: 0 });
const mv = (o: Partial<{ f1: number; f3: number; f5: number; f6: number; i1: number; i2: number }> = {}) => ({
  fparam1: o.f1 ?? 1,
  fparam2: 1,
  fparam3: o.f3 ?? 1,
  fparam4: 1,
  fparam5: o.f5 ?? 50,
  fparam6: o.f6 ?? 0,
  iparam: [o.i1 ?? 0, o.i2 ?? 0, 0, 0, 0, 0],
});
// Runs `n` ticks, reporting the motion end whenever the brain's motion is a
// one-shot that has had `len` frames.
function run(ai: { tick(t: readonly AiTarget[], ended?: boolean): AiFrame; motion: { loop: boolean } | null }, targets: AiTarget[], n: number, len = 30, each?: (r: AiFrame) => void): void {
  let frames = 0;
  let last: unknown = null;
  for (let i = 0; i < n; i++) {
    if (ai.motion !== last) {
      last = ai.motion;
      frames = 0;
    }
    const ended = !!ai.motion && !ai.motion.loop && frames >= len;
    const r = ai.tick(targets, ended);
    frames++;
    each?.(r);
  }
}

// --- Merillia -----------------------------------------------------------------
{
  const mk = (params: number[] = [0, 0, 0, 0, 0, 0], rng = () => 0.9, movement = mv()) =>
    new MerilliaAi({ x: 0, z: 0, angle: 0, subtype: params[5] ?? 0, params, attack: atk(10), movement, rng });
  const m = mk();
  eq(m.state, 'spawn', 'starts in state 13');
  check(m.invulnerable, 'buried: invulnerable');
  run(m, [player(0, 500)], BOOMA_MELEE.emergeFrames + 2);
  eq(m.state, 'under', 'after the 40-frame emergence effect: under the ground (12)');
  run(m, [player(0, 150)], 5);
  eq(m.state, 'under', 'a player within 225 but beyond param5 + 100 does not wake it');
  m.tick([player(0, 90)]);
  eq(m.state, 'emerge', 'within 100: it wakes (0)');
  const r = m.tick([player(0, 90)]);
  eq(r.motion?.index, 0, 'buried: the appear animation (row 11, motion 0)');
  check(m.invulnerable, 'invulnerable while it appears');
  run(m, [player(0, 90)], 40);
  check(!m.invulnerable, 'vulnerable once up');
  check(m.state === 'chase' || m.state === 'idle', `then the chase (${m.state})`);
  // A Meriltas searches 250.
  const big = mk([0, 0, 0, 0, 200, 1]);
  run(big, [player(0, 240)], BOOMA_MELEE.emergeFrames + 3);
  eq(big.state, 'emerge', 'Meriltas: search 250, wake radius param5 + 100 = 300');

  // Chase and melee.
  const c = mk([0, 0, 0, 0, 200, 0], () => 0.2);
  run(c, [player(0, 100)], BOOMA_MELEE.emergeFrames + 2);
  let hit = null as AiFrame['hit'];
  run(c, [player(0, 100)], 200, 20, (x) => (hit ??= x.hit));
  check(c.z > 50, `it walks toward the player (${c.z.toFixed(1)})`);
  eq(hit && [hit.knockback, hit.mult], [3, 1], 'the Booma melee: try_hit_entity(1.0) + cause_knockback(3.0)');

  // Burrows with no target and no wander radius.
  const b = mk([0, 0, 0, 0, 200, 0]);
  run(b, [player(0, 100)], BOOMA_MELEE.emergeFrames + 30);
  run(b, [player(0, 900)], 80);
  eq(b.state, 'under', 'the target gone: it burrows (11 -> 12)');

  // Flinch at low HP: run (param1 - 0.2 chance) or pollen (param3 - 0.2).
  const p = mk([0, 0, 1.2, 0, 200, 0], () => 0.5, mv({ i1: 50, f5: 40 }));
  run(p, [player(0, 100)], BOOMA_MELEE.emergeFrames + 30);
  p.onDamage(0);
  p.hpFraction = 0.4;
  eq(p.resume(), 'pollen', 'HP <= iparam1 %: the pollen when the run roll fails');
  let shots: AiFrame['shots'] = undefined;
  run(p, [player(0, 10)], 40, 30, (x) => (shots ??= x.shots));
  check(!!shots && shots.length === 2, 'the spore cloud at motion frame 13');
  if (shots) {
    eq(shots.map((s) => s.effect), [{ kind: 'tech', power: 40 }, { kind: 'status', status: STATUS.poison }], 'tech hit with fparam5, then poison (group 0x0f)');
    eq(shots[0].tick([player(0, 10), player(0, 60, 1)]).map((t) => t.clientId), [0], 'radius 20');
    check(shots[0] instanceof SporeCloud && shots[0].done, 'one frame');
  }
  const q = mk([1.2, 0, 0, 0, 200, 0], () => 0.5, mv({ i1: 50 }));
  run(q, [player(0, 100)], BOOMA_MELEE.emergeFrames + 30);
  q.hpFraction = 0.4;
  eq(q.resume(), 'run', 'param1 1.2: the run');
  q.hpFraction = 0.6;
  eq(q.resume(), 'chase', 'above iparam1 %: back to the chase');
  eq(MERILLIA.radius, 8, 'collision radius 8 (0x009beb6c)');
  eq(enemyCombatMotions('TObjEneMerillLia', null as never), { damage: { index: 3, speed: 0.8 }, death: { index: 4, speed: 0.6 } }, 'Merillia rows 6 / 8');
}

// --- Dolmolm ------------------------------------------------------------------
{
  const mk = (params: number[] = [0, 0, 0, 0, 0, 0], rng = () => 0.9, movement = mv({ f5: 30, i1: 0x2000, i2: 3 })) =>
    new DolmolmAi({ x: 0, z: 0, angle: 0, subtype: params[5] ?? 0, params, attack: atk(10), movement, rng });
  const d = mk();
  run(d, [player(0, 500)], 5);
  check(d.state === 'emerge' || d.state === 'idle', `no target: state 0 / 1 (${d.state})`);
  run(d, [player(0, 200)], 2);
  eq(d.state, 'chase', 'a target out of reach: +0xf4 sends state 0 to the chase');
  // Melee then the back step (param3 + 0.3 chance).
  const b = mk([0, 0, 0.5, -1, 0, 0], () => 0.2);
  let hit = null as AiFrame['hit'];
  let back = false;
  run(b, [player(0, 15)], 120, 20, (x) => {
    hit ??= x.hit;
    if (b.state === 'backstep') back = true;
  });
  check(!!hit, 'melee hit at frame 7');
  check(back, 'get_random_float < param3 + 0.3: the back step');
  // The dance: within fparam5, roll < param4 + 0.3: hold for iparam2 seconds.
  const h = mk([0, 0, -1, 0.5, 0, 0], () => 0.1);
  let hold = null as AiFrame['hold'];
  run(h, [player(0, 15)], 80, 20, (x) => (hold ??= x.hold ?? null));
  eq(hold && [hold.frames, hold.particle, hold.radius2], [90, DOLMOLM.holdParticle, 0], 'the dance holds 3 * 30 frames, particle 2');
  eq(enemyCombatMotions('TObjEneDolmOlm', null as never), { damage: { index: 2, speed: 0.8 }, death: { index: 3, speed: 0.7 } }, 'Dolmolm rows 6 / 8');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsmep2: all checks passed');

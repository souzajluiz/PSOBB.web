// Ill Gill brain (combat/enemyfsmillgill.ts, PsoBB.exe update 0x0052e7c0 and the handlers
// 0x0052ebc0 snare, 0x0052f18c tackle, 0x0052fb78 scythe, 0x0052ea00 damage): the radar gate
// per state (objdump-proven icon calls), the attack choice order, the scythe's variant roll and
// hit frame, the snare and tackle sequences, and the damage escape below a quarter HP.
// Run: node tests/enemyfsmillgill.test.ts

import { ILL_GILL, ILL_GILL_ANIM, IllGillAi } from '../client/src/combat/enemyfsmillgill.ts';
import type { AiTarget } from '../client/src/combat/enemyai.ts';
import type { EnemyAttackData } from '../client/src/formats/battleparams.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string, eps = 1e-6) => check(Math.abs(a - b) < eps, `${what}: ${a} != ${b}`);
const row = (distanceX: number, angle: number): EnemyAttackData => ({ minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX, angle, distanceY: 0 });
const mv = (fparam1: number) => ({ fparam1, fparam2: 0, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [0, 0, 0, 0, 0, 0] });
const target = (x: number, z: number, clientId = 0): AiTarget => ({ clientId, x, z, charClass: 0, dead: false, angle: 0 });

// Four rows: scythe (0), ice (1), snare (2), tackle (3). Rows 0, 1 and 3 face forward only (0 arc);
// the snare has a half arc. A target at (10, 0) is off the nose: only the snare row is in arc.
const sideAttacks = [row(10, 0), row(10, 0), row(10, 0x8000), row(10, 0)];
const frontAttacks = [row(10, 0x2000), row(10, 0x2000), row(10, 0x2000), row(10, 0x2000)];

// --- Constants read from the exe ----------------------------------------------------------
near(ILL_GILL.sight, 400, 'sight range 400.0 (0x009bc4cc)');
near(ILL_GILL.turn * (0x10000 / (Math.PI * 2)), 1024, 'turn 1024 BAMS (0x009bc4d4)', 1e-3);
eq([ILL_GILL_ANIM.wait.index, ILL_GILL_ANIM.walk.index, ILL_GILL_ANIM.lattack.index, ILL_GILL_ANIM.rattack.index], [0, 1, 4, 5], 'wait / walk / lattack / rattack motions');
eq([ILL_GILL_ANIM.kage.index, ILL_GILL_ANIM.damage.index, ILL_GILL_ANIM.dead.index, ILL_GILL_ANIM.kamae.index, ILL_GILL_ANIM.tackle.index], [8, 6, 9, 2, 3], 'kage / damage / dead / kamae / tackle motions');
eq([ILL_GILL_ANIM.wait.speed, ILL_GILL_ANIM.walk.speed, ILL_GILL_ANIM.wait.loop, ILL_GILL_ANIM.tackle.loop], [0.6, 0.8, true, false], 'slot speeds and loop flags (table 0x009bc3e0)');

// --- Radar gate per state (icon call sites, objdump) ----------------------------------------
{
  const ai = new IllGillAi({ x: 0, z: 0, angle: 0, movement: mv(1), attacks: frontAttacks, rng: () => 0.9 });
  const seen: Record<string, boolean> = {};
  for (const s of ['spawn', 'advance', 'chase', 'scythe', 'snare', 'idle', 'damage'] as const) {
    ai.state = s;
    seen[s] = ai.radar;
  }
  eq(seen, { spawn: true, advance: true, chase: true, scythe: true, snare: true, idle: true, damage: true }, 'icon in states 0 to 3, 5, 6, 7 (always)');
  ai.state = 'tackle';
  eq(ai.radar, false, 'tackle (state 4) without a target: no icon (0x0052fb75 return)');
  ai.targetId = 3;
  eq(ai.radar, true, 'tackle with a target: icon');
  ai.state = 'dead';
  eq(ai.radar, false, 'dead (state 8, dying): no icon');
}

// --- Attack choice: first row in reach and arc ---------------------------------------------
{
  const ai = new IllGillAi({ x: 0, z: 0, angle: 0, movement: mv(1), attacks: sideAttacks, rng: () => 0.9 });
  eq(ai.chooseAttack(target(10, 0)), 2, 'side target: only the snare row is in arc');
  eq(ai.chooseAttack(target(0, 10)), 0, 'front target: row 0 first (order 0..3)');
  eq(ai.chooseAttack(target(0, 100)), null, 'out of reach: no attack');
}

// --- Scythe: the variant roll, the hit frame, the one hit, and the recovery -------------------
function runScythe(roll: number): { variantMotion: number; hitTick: number; hits: number; backTick: number } {
  const ai = new IllGillAi({ x: 0, z: 0, angle: 0, movement: mv(1), attacks: frontAttacks, rng: () => roll });
  const t = [target(0, 10)];
  ai.tick(t); // spawn -> advance
  ai.tick(t); // advance -> chase
  ai.tick(t); // chase: row 0 in reach -> scythe sub 0
  ai.tick(t); // scythe sub 0 -> sub 2 (the swing, its motion set here)
  const variantMotion = ai.motion?.index ?? -1;
  let hitTick = -1;
  let hits = 0;
  let backTick = -1;
  // k counts the ticks after the swing's first frame; the swing ends at k = 40.
  for (let k = 0; k < 80; k++) {
    const out = ai.tick(t, k === 40);
    if (out.hit) {
      hits++;
      if (hitTick < 0) hitTick = k + 1;
    }
    if (k > 40 && backTick < 0 && ai.state === 'chase') backTick = k - 40;
  }
  return { variantMotion, hitTick, hits, backTick };
}
{
  const ice = runScythe(0.9);
  eq(ice.variantMotion, ILL_GILL_ANIM.lattack.index, 'roll 0.9 (ice): the lattack swing');
  eq(ice.hitTick, 30, 'ice: the hit at the 30th frame after the swing starts');
  eq(ice.hits, 1, 'ice: one hit');
  const thunder = runScythe(0.4);
  eq(thunder.variantMotion, ILL_GILL_ANIM.lattack.index, 'roll 0.4 (thunder): the lattack swing');
  eq(thunder.hitTick, 30, 'thunder: hit at 30');
  const insta = runScythe(0.2);
  eq(insta.variantMotion, ILL_GILL_ANIM.rattack.index, 'roll 0.2 (instant kill): the rattack swing');
  eq(insta.hitTick, 35, 'instant kill: hit at 35');
  eq(insta.hits, 1, 'instant kill: one hit');
  eq(insta.backTick, 31, 'the scythe recovers 30 frames, then the chase (31st frame after the swing ends)');
}

// --- Snare: kage, the 10-frame wait, the snare on its arc, then the chase ---------------------
{
  const ai = new IllGillAi({ x: 0, z: 0, angle: 0, movement: mv(1), attacks: sideAttacks, rng: () => 0.9 });
  const t = [target(10, 0, 7)];
  ai.tick(t);
  ai.tick(t);
  ai.tick(t); // chase -> snare (row 2)
  eq(ai.state, 'snare', 'side target: the snare state');
  ai.tick(t); // sub 0 -> sub 1 (kage)
  eq(ai.motion?.index, ILL_GILL_ANIM.kage.index, 'snare sub 1 shows the kage motion');
  for (let k = 0; k < 12; k++) ai.tick(t);
  eq(ai.state, 'snare', 'still snaring after the wait');
  // Sub 2 snares the target and sub 4 runs 30 frames, then the chase. The chase re-picks the snare
  // while the target stays in its arc (no cooldown is traced: ASSUMED).
  let sawChase = false;
  for (let k = 0; k < 40; k++) {
    ai.tick(t);
    if (ai.state === 'chase') sawChase = true;
  }
  eq(sawChase, true, 'the snare ends in the chase');
}

// --- Tackle: stance, dash, one knockback of 2.0, recovery --------------------------------------
{
  const ai = new IllGillAi({ x: 0, z: 0, angle: 0, movement: mv(1), attacks: [row(10, 0), row(10, 0), row(10, 0), row(10, 0x8000)], rng: () => 0.9 });
  const t = [target(10, 0, 9)];
  ai.tick(t);
  ai.tick(t);
  ai.tick(t); // chase -> tackle (row 3)
  eq(ai.state, 'tackle', 'side target: the tackle state (row 3)');
  let hits: { kbScale?: number }[] = [];
  let sawChase = false;
  for (let k = 0; k < 80; k++) {
    const out = ai.tick(t);
    if (out.hit) hits.push(out.hit);
    if (ai.state === 'chase') sawChase = true;
  }
  eq(hits.length, 1, 'the dash hits once');
  near(hits[0]?.kbScale ?? 0, ILL_GILL.dashKnockback, 'the dash knocks back 2.0 times the damage');
  eq(sawChase, true, 'the tackle recovers into the chase');
}

// --- Damage: the escape below a quarter HP (strict), and the flinch from the chase --------------
{
  const ai = new IllGillAi({ x: 3, z: 4, angle: 0, movement: mv(1), attacks: frontAttacks, rng: () => 0.9 });
  ai.state = 'chase';
  ai.targetId = 2;
  ai.health = () => 0.25;
  ai.onDamage(2);
  eq(ai.state, 'damage', 'a hit in the chase flinches into the damage state');
  ai.tick([target(0, 0)], false);
  eq(ai.fled, false, 'exactly a quarter of the HP does not escape (strict)');
  ai.health = () => 0.2;
  ai.tick([target(0, 0)], false);
  eq(ai.fled, true, 'below a quarter escapes');
  eq(ai.homePosition, { x: 3, z: 4 }, 'the escape keeps the position as home');
  ai.tick([target(0, 0)], true);
  eq(ai.state, 'chase', 'the damage motion ends into the chase (ASSUMED)');
}

// --- Dead: no radar, the brain does nothing ---------------------------------------------------
{
  const ai = new IllGillAi({ x: 0, z: 0, angle: 0, movement: mv(1), attacks: frontAttacks, rng: () => 0.9 });
  ai.kill();
  eq([ai.state, ai.radar], ['dead', false], 'killed: state dead, no radar');
  eq(ai.tick([target(0, 10)]).hit, null, 'killed: no hit');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsmillgill: all checks passed');

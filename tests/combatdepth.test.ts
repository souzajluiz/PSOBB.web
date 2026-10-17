// Combat depth: the player taking damage (6x4A / 6x4B / 6x4C / 6x89 + 6x4D /
// 6x4E / 6x4F, the hit and death motions, HP tracking) and the generic enemy
// AI (idle, noticing, chasing, attacking, returning to idle).
//
// Run: node tests/combatdepth.test.ts
// Env: BATTLE_PARAMS (BattleParamEntry_on.dat, optional)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BattleParams } from '../client/src/formats/battleparams.ts';
import { ENEMY_TYPE_PARAMS } from '../client/src/formats/entitynames.ts';
import {
  AI_PROFILES,
  AI_CONFIG,
  aiConfig,
  ATTACK_HIT_FRAME,
  ATTACK_KNOCKBACK,
  ATTACK_RECOVER_TICKS,
  BAMS_TO_RAD,
  CHASE_GIVE_UP_TICKS,
  collisionRadius,
  DEFAULT_AI_CONFIG,
  EnemyAi,
  enemySpeeds,
  FAR_HUNTER_SQ,
  FAR_OTHER_SQ,
  movementIndex,
  NEAR_HUNTER_SQ,
  NEAR_OTHER_SQ,
  nearSq,
  type AiTarget,
} from '../client/src/combat/enemyai.ts';
import {
  DEATH_FLAG_NO_DROP,
  HEAVY_HIT_FRACTION,
  hitMotion,
  INVULN_TICKS_HEAVY,
  INVULN_TICKS_LIGHT,
  PlayerDamage,
  type HitMotionKind,
} from '../client/src/combat/playerdamage.ts';
import { parseHitByEnemy, parsePlayerDeath } from '../client/src/net/game.ts';
import { rollDamage } from '../client/src/combat/formulas.ts';

let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${msg}`);
  }
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- player hit / death motions (field motion tables 0x009cbeec / 0x009cbf04)

{
  // Spot checks of the five slots read out of PsoBB.exe for motion type 0
  // (male) and weapon class 0 (bare hands / sword).
  const expect: Array<[HitMotionKind, number, number, number]> = [
    ['heavy', 202, 1.4, 0xa0000040], // slot 9, vtable +0x58
    ['guard', 203, 1.9, 0x20000100], // slot 10, vtable +0x5c
    ['light', 204, 3.7, 0xa0000040], // slot 11, vtable +0x60
    ['death', 205, 1, 0x80], // slot 12, vtable +0x64
    ['revive', 109, 1.3, 0x20000400], // slot 13, vtable +0x68
  ];
  for (const [kind, index, speed, flags] of expect) {
    const m = hitMotion(0, 0, kind);
    check(m.index === index && near(m.speed, speed) && m.flags === flags && m.mode === 3, `hitMotion(0, 0, ${kind}) = ${JSON.stringify(m)}`);
  }
  // Every slot plays once and holds the last frame (mode 3) for every motion
  // type and weapon class, and falls back instead of throwing.
  let rows = 0;
  for (const kind of ['heavy', 'guard', 'light', 'death', 'revive'] as HitMotionKind[]) {
    for (let mt = 0; mt < 6; mt++) {
      for (let wc = 0; wc < 19; wc++) {
        const m = hitMotion(mt, wc, kind);
        check(m.mode === 3 && m.index > 0 && m.speed > 0, `hitMotion(${mt}, ${wc}, ${kind}) = ${JSON.stringify(m)}`);
        rows++;
      }
    }
  }
  check(hitMotion(99, 99, 'light').index === hitMotion(0, 0, 'light').index, 'hitMotion falls back to motion type 0 / weapon class 0');
  // The female death motion differs from the male one (414 vs 205).
  check(hitMotion(1, 0, 'death').index === 414 && hitMotion(2, 0, 'death').index === 491, 'death motion per motion type');
  console.log(`player hit motions: ${rows} rows, mode 3 everywhere`);
}

// --- PlayerDamage: HP, the light/heavy split, death and revive -------------

interface Sent {
  kind: string;
  args: number[];
}

function damageHarness(maxHp: number) {
  const sent: Sent[] = [];
  const motions: HitMotionKind[] = [];
  const pushes: Array<[number, number]> = [];
  const d = new PlayerDamage({
    motion: (k) => motions.push(k),
    push: (vx, vz) => pushes.push([vx, vz]),
    face: () => {},
    sendHit: (heavy, angle, hp, vx, vz) => sent.push({ kind: heavy ? '6x4C' : '6x4B', args: [angle, hp, vx, vz] }),
    sendShieldAttack: () => sent.push({ kind: '6x4A', args: [] }),
    sendDeath: (killer, flags) => sent.push({ kind: '6x89+6x4D', args: [killer, flags] }),
    sendRevivable: () => sent.push({ kind: '6x4E', args: [] }),
    sendRevived: () => sent.push({ kind: '6x4F', args: [] }),
    log: () => {},
  });
  d.reset(maxHp);
  return { d, sent, motions, pushes };
}

{
  // A small hit: 6x4B, the light-hit motion, 60 ticks of invulnerability.
  const h = damageHarness(200);
  h.d.hit(20, 0, ATTACK_KNOCKBACK);
  check(h.d.hp === 180, `light hit HP ${h.d.hp}`);
  check(h.d.state === 'light', `light hit state ${h.d.state}`);
  check(h.sent.length === 1 && h.sent[0].kind === '6x4B', `light hit sent ${JSON.stringify(h.sent)}`);
  check(h.sent[0].args[1] === 180, '6x4B carries the current HP');
  check(h.motions[0] === 'light', `light hit motion ${h.motions[0]}`);
  check(h.d.invuln === INVULN_TICKS_LIGHT, `light invulnerability ${h.d.invuln}`);
  // A second hit inside the invulnerability window does nothing.
  h.d.hit(20, 0, ATTACK_KNOCKBACK);
  check(h.d.hp === 180 && h.sent.length === 1, 'a hit during invulnerability is ignored');
  // The knockback is applied once per tick and decays.
  h.d.tick();
  check(h.pushes.length === 1 && Math.abs(h.pushes[0][1] - ATTACK_KNOCKBACK) < 1e-6, `knockback ${JSON.stringify(h.pushes[0])}`);
  for (let i = 0; i < 40; i++) h.d.tick();
  check(h.d.state === 'alive', `back to alive, got ${h.d.state}`);
}

{
  // More than a quarter of max HP: 6x4C and the heavy-hit motion.
  const h = damageHarness(200);
  const heavy = 200 * HEAVY_HIT_FRACTION + 1;
  h.d.hit(heavy, 0, ATTACK_KNOCKBACK);
  check(h.sent[0].kind === '6x4C', `heavy hit sent ${h.sent[0].kind}`);
  check(h.motions[0] === 'heavy', `heavy hit motion ${h.motions[0]}`);
  check(h.d.invuln === INVULN_TICKS_HEAVY, `heavy invulnerability ${h.d.invuln}`);
  // Exactly a quarter is still light.
  const l = damageHarness(200);
  l.d.hit(50, 0, 0);
  check(l.sent[0].kind === '6x4B', 'exactly 25% of max HP is a light hit');
}

{
  // No damage: 6x4A and the evade motion, HP unchanged.
  const h = damageHarness(100);
  h.d.hit(0, 0, 0);
  check(h.d.hp === 100 && h.sent[0].kind === '6x4A' && h.motions[0] === 'guard', `shielded hit ${JSON.stringify(h.sent)} ${h.motions[0]}`);
}

{
  // Death: 6x4C (the killing hit is reported first), then 6x89 + 6x4D, the
  // death motion, 6x4E when it ends, and 6x4F on revive.
  const h = damageHarness(100);
  h.d.hit(500, 1.2, ATTACK_KNOCKBACK, 0x1003);
  check(h.d.hp === 0 && h.d.dead, `death HP ${h.d.hp} state ${h.d.state}`);
  check(h.sent.map((s) => s.kind).join(',') === '6x4C,6x89+6x4D', `death sends ${h.sent.map((s) => s.kind).join(',')}`);
  const death = h.sent[1];
  check(death.args[0] === 0x1003, `6x89 killer entity 0x${death.args[0].toString(16)}`);
  check(death.args[1] === DEATH_FLAG_NO_DROP, `6x4D death flags 0x${death.args[1].toString(16)}`);
  check(h.motions.at(-1) === 'death', `death motion ${h.motions.at(-1)}`);
  // A hit while dead does nothing.
  h.d.hit(10, 0, 0);
  check(h.sent.length === 2, 'no command while dead');
  for (let i = 0; i < 61; i++) h.d.tick();
  check(h.d.state === 'revivable' && h.sent.at(-1)!.kind === '6x4E', `revivable after the death motion, got ${h.d.state}`);
  h.d.revive();
  check(h.d.hp > 0 && h.d.state === 'reviving' && h.sent.at(-1)!.kind === '6x4F', `revive ${h.d.hp} ${h.d.state}`);
  for (let i = 0; i < 41; i++) h.d.tick();
  check(h.d.state === 'alive' && !h.d.busy, `alive after the stand-up motion, got ${h.d.state}`);
}

// --- 6x4B / 6x4C / 6x4D wire format (newserv src/CommandFormats.hh) --------

{
  // G_HitByEnemy_6x4B_6x4C: {u8 sub, u8 size_dwords, u16 client_id, u16 angle,
  // u16 current_hp, f32 velocity_x, f32 velocity_z} = 0x10 bytes.
  const b = new Uint8Array(0x10);
  const dv = new DataView(b.buffer);
  b[0] = 0x4c;
  b[1] = 4;
  dv.setUint16(2, 3, true);
  dv.setUint16(4, 0x4000, true); // a quarter turn
  dv.setUint16(6, 77, true);
  dv.setFloat32(8, 1.5, true);
  dv.setFloat32(12, -2.5, true);
  const p = parseHitByEnemy(b);
  check(!!p, '6x4C parses');
  check(p!.clientId === 3 && p!.heavy && p!.currentHp === 77, `6x4C fields ${JSON.stringify(p)}`);
  check(near(p!.angle, 0x4000 * BAMS_TO_RAD) && near(p!.vx, 1.5) && near(p!.vz, -2.5), `6x4C angle / velocity ${JSON.stringify(p)}`);
  b[0] = 0x4b;
  check(parseHitByEnemy(b)!.heavy === false, '6x4B is the light one');
  check(parseHitByEnemy(b.subarray(0, 8)) === null, 'a short 6x4B is rejected');

  // G_PlayerDied_6x4D: {header, u32 death_flags} = 8 bytes.
  const d = new Uint8Array(8);
  const ddv = new DataView(d.buffer);
  d[0] = 0x4d;
  d[1] = 2;
  ddv.setUint16(2, 1, true);
  ddv.setUint32(4, 0x2, true);
  const pd = parsePlayerDeath(d);
  check(!!pd && pd.clientId === 1 && pd.deathFlags === 2, `6x4D fields ${JSON.stringify(pd)}`);
  check(parsePlayerDeath(new Uint8Array([0x4e, 1, 0, 0])) === null, '6x4E is not a 6x4D');
}

// --- enemy AI tables -------------------------------------------------------

{
  // Every Forest family has a profile and the records the constructors install.
  for (const cls of ['TObjEneBeast', 'TObjEneMoja', 'TObjEneBm5Wolf', 'TObjEneBm3FlyNest', 'TObjEneLappy']) {
    const p = AI_PROFILES[cls];
    check(!!p && p.idle.loop && p.idle.speed > 0, `${cls} has an idle motion`);
    check(!!AI_CONFIG[cls], `${cls} has an AI record`);
  }
  // g_BoomaHitboxParams @ 0x009bc880: search radius 225 / 250 / 300 per subtype,
  // turn rate 1024 BAMS per tick.
  check(aiConfig('TObjEneBeast', 0).detect === 225, 'Booma search radius');
  check(aiConfig('TObjEneBeast', 1).detect === 250, 'Gobooma search radius');
  check(aiConfig('TObjEneBeast', 2).detect === 300, 'Gigobooma search radius');
  check(aiConfig('TObjEneBeast', 7).detect === 300, 'an out-of-range subtype clamps');
  check(aiConfig('TObjEneBeast', 0).turnRate === 1024, 'Booma turn rate');
  check(aiConfig('TObjEneLappy', 0).detect === 150, 'Rag Rappy search radius');
  check(aiConfig('TObjEneBm5Wolf', 0).turnRate === 1536, 'Savage Wolf turn rate');
  // DefaultEnemyCollisionParams_009c3eb0 for an undecoded class.
  check(aiConfig('TObjSomethingElse').detect === DEFAULT_AI_CONFIG.detect[0], 'unknown class falls back to the default record');
  // init_booma_subtypes_global_config: 7 / 7 / 8, and 10 / 10 / 9 in Ultimate.
  check(collisionRadius('TObjEneBeast', 0) === 7 && collisionRadius('TObjEneBeast', 2) === 8, 'Booma collision radii');
  check(collisionRadius('TObjEneBeast', 2, true) === 9, 'Ultimate Booma collision radius');
  // The guard-stance distances at 0x00922330 (squared).
  check(NEAR_HUNTER_SQ === 2500 && FAR_HUNTER_SQ === 10000, 'Hunter guard-stance distances');
  check(NEAR_OTHER_SQ === 10000 && FAR_OTHER_SQ === 22500, 'non-Hunter guard-stance distances');
  check(nearSq(0) === NEAR_HUNTER_SQ && nearSq(6) === NEAR_OTHER_SQ, 'Hunter classes use the closer band');
  // MovementData index == ResistData index for the Episode 1 types newserv
  // lists in notes/movement-data.txt.
  const expectMovement: Record<string, number> = {
    MOTHMANT: 0x00,
    MONEST: 0x01,
    SAVAGE_WOLF: 0x02,
    BARBAROUS_WOLF: 0x03,
    POISON_LILY: 0x04,
    RAG_RAPPY: 0x18,
    HILDEBEAR: 0x48,
    HILDEBLUE: 0x49,
    BOOMA: 0x4a,
    GOBOOMA: 0x4b,
    GIGOBOOMA: 0x4c,
  };
  for (const [name, index] of Object.entries(expectMovement)) {
    check(movementIndex(name) === index, `${name} movement data index ${movementIndex(name)} (expected 0x${index.toString(16)})`);
  }
  // enemySpeeds maps fparam1..4; all-zero movement data falls back.
  const s = enemySpeeds({ fparam1: 0.8, fparam2: 0.8, fparam3: 0.5, fparam4: 0.5, fparam5: 0, fparam6: 0, iparam: [] }, 9);
  check(s.idleMove === 0.8 && s.engagedMove === 0.5 && s.engagedAnim === 0.5, `enemySpeeds ${JSON.stringify(s)}`);
  const z = enemySpeeds({ fparam1: 0, fparam2: 0, fparam3: 0, fparam4: 0, fparam5: 0, fparam6: 0, iparam: [] }, 9);
  check(z.idleMove === 9 && z.engagedMove === 9, `enemySpeeds fallback ${JSON.stringify(z)}`);
  check(enemySpeeds(null, 3).idleMove === 3, 'enemySpeeds without movement data');
}

// --- enemy AI state machine ------------------------------------------------

function booma(x = 0, z = 0, angle = 0) {
  return new EnemyAi({
    x,
    z,
    angle,
    profile: AI_PROFILES['TObjEneBeast'],
    detect: 225,
    turnRate: 1024,
    // The Booma AttackData of Normal: reach 12, arc 0x1C71 (40 degrees).
    attack: { minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX: 12, angle: 0x1c71, distanceY: 0 },
    speeds: { idleMove: 0.8, idleAnim: 0.8, engagedMove: 0.5, engagedAnim: 0.5 },
    radius: 7,
    wander: 0,
  });
}
const player = (x: number, z: number): AiTarget => ({ clientId: 0, x, z, charClass: 0, dead: false });

{
  // Nobody in range: the enemy idles and plays the idle motion.
  const ai = booma();
  const r = ai.tick([player(400, 0)]);
  check(ai.state === 'idle' && ai.targetId === null, `idle without a target, got ${ai.state}`);
  // The idle motion is the one the model already plays, so nothing is re-played.
  check(ai.motion?.index === AI_PROFILES['TObjEneBeast'].idle.index, 'idle motion');
  check(r.x === 0 && r.z === 0, 'an idle enemy on its spawn point stays put');
  // Just outside the search radius.
  ai.tick([player(0, 226)]);
  check(ai.state === 'idle', 'a player at 226 units is out of the 225-unit radius');
}

{
  // A player inside the search radius: the war cry, then the chase.
  const ai = booma();
  let r = ai.tick([player(0, 200)]);
  check(ai.state === 'notice', `notice, got ${ai.state}`);
  check(r.motion?.index === AI_PROFILES['TObjEneBeast'].notice!.index, 'war cry motion');
  // The war cry runs until its animation ends.
  r = ai.tick([player(0, 200)], false);
  check(ai.state === 'notice' && r.motion === null, 'the war cry holds while the animation runs');
  r = ai.tick([player(0, 200)], true);
  check(ai.state === 'chase', `chase after the war cry, got ${ai.state}`);
  check(r.motion?.index === AI_PROFILES['TObjEneBeast'].walk!.index, 'chase gait motion');
  // It walks toward the player at the idle speed (it is still far away).
  const before = ai.z;
  ai.tick([player(0, 200)]);
  check(near(ai.z - before, 0.8, 1e-5), `chase step ${ai.z - before} (expected the idle move speed 0.8)`);
  check(ai.near === false, 'not in guard stance at 200 units');
}

{
  // Close in: the guard-stance flag switches to the engaged speed.
  const ai = booma(0, 0, 0);
  ai.tick([player(0, 200)]);
  ai.tick([player(0, 200)], true); // through the war cry
  ai.tick([player(0, 40)]);
  check(ai.near === true, 'guard stance within 50 units of a Hunter');
  const before = ai.z;
  ai.tick([player(0, 40)]);
  check(near(ai.z - before, 0.5, 1e-5), `engaged step ${ai.z - before} (expected 0.5)`);
  // Hysteresis: it stays engaged until 100 units.
  ai.tick([player(0, 80)]);
  check(ai.near === true, 'still engaged at 80 units');
  ai.tick([player(0, 120)]);
  check(ai.near === false, 'out of guard stance past 100 units');
}

{
  // In reach (12 + 7 collision radius): the attack, the hit at frame 7, the
  // 15-tick recovery, then back to the chase.
  const ai = booma(0, 0, 0);
  ai.tick([player(0, 200)]);
  ai.tick([player(0, 200)], true);
  const t = player(0, 15);
  let r = ai.tick([t]);
  check(ai.state === 'attack', `attack in reach, got ${ai.state}`);
  check(r.motion !== null && AI_PROFILES['TObjEneBeast'].attacks.some((a) => a.index === r.motion!.index), 'attack motion');
  // The attack motion runs at 0.65 or 0.85 frames per tick, so the hit frame
  // is reached after ceil(7 / speed) ticks.
  let hit: typeof r.hit = null;
  let ticks = 0;
  while (!hit && ticks < 40) {
    r = ai.tick([t]);
    hit = r.hit;
    ticks++;
  }
  check(!!hit, `the attack lands (after ${ticks} ticks)`);
  check(hit!.clientId === 0 && hit!.knockback === ATTACK_KNOCKBACK && hit!.mult === 1, `hit ${JSON.stringify(hit)}`);
  check(ticks >= Math.ceil(ATTACK_HIT_FRAME / 0.85) - 1, `the hit waits for frame ${ATTACK_HIT_FRAME}`);
  // Only once per attack.
  for (let i = 0; i < 5; i++) check(ai.tick([t]).hit === null, 'one hit per attack animation');
  r = ai.tick([t], true);
  check(ai.state === 'recover', `recover after the attack, got ${ai.state}`);
  check(r.motion?.index === AI_PROFILES['TObjEneBeast'].idle.index, 'the recovery plays the idle motion');
  for (let i = 0; i < ATTACK_RECOVER_TICKS - 1; i++) ai.tick([t]);
  check(ai.state === 'recover', `still recovering after ${ATTACK_RECOVER_TICKS - 1} ticks`);
  ai.tick([t]);
  check(ai.state === 'attack' || ai.state === 'chase', `back to the fight, got ${ai.state}`);
}

{
  // The target walks out of range: back to idle, and home again.
  const ai = booma(0, 0, 0);
  ai.tick([player(0, 100)]);
  ai.tick([player(0, 100)], true);
  for (let i = 0; i < 20; i++) ai.tick([player(0, 100)]);
  check(ai.z > 0, 'the enemy moved away from its spawn point');
  ai.tick([]);
  check(ai.state === 'idle' && ai.targetId === null, `idle with no players, got ${ai.state}`);
  // It turns back home at cfg[2] BAMS per tick, so it keeps walking forward
  // for a few ticks before the heading points at the spawn point.
  const away = Math.hypot(ai.x, ai.z);
  for (let i = 0; i < 120; i++) ai.tick([]);
  check(Math.hypot(ai.x, ai.z) < away, 'an idle enemy walks back toward its spawn point');
  for (let i = 0; i < 200; i++) ai.tick([]);
  check(Math.hypot(ai.x, ai.z) <= 7 + 1e-3, `home again (${ai.x.toFixed(2)}, ${ai.z.toFixed(2)})`);
}

{
  // Chasing a target it can never reach is given up after 150 ticks.
  const ai = booma(0, 0, 0);
  ai.tick([player(0, 200)]);
  ai.tick([player(0, 200)], true);
  let i = 0;
  for (; i < CHASE_GIVE_UP_TICKS + 5; i++) {
    // Keep the player at 200 units ahead of the enemy.
    ai.tick([player(0, ai.z + 200)]);
    if (ai.state === 'idle') break;
  }
  check(ai.state === 'idle' && i >= CHASE_GIVE_UP_TICKS - 1, `the chase is given up after ${i} ticks`);
}

{
  // The turn rate is clamped to cfg[2] BAMS per tick.
  const ai = booma(0, 0, 0);
  ai.tick([player(200, 0)]); // the player is 90 degrees to the right
  ai.tick([player(200, 0)], true);
  const first = ai.angle;
  check(near(first, 1024 * BAMS_TO_RAD, 1e-6) || near(first, 2 * 1024 * BAMS_TO_RAD, 1e-6), `turn clamped to 1024 BAMS per tick, got ${first}`);
  ai.tick([player(200, 0)]);
  check(ai.angle - first <= 1024 * BAMS_TO_RAD + 1e-9, 'every tick turns at most cfg[2]');
}

{
  // Being hit turns the enemy on its attacker; death stops the AI.
  const ai = booma(0, 0, 0);
  ai.onDamage(2);
  check(ai.state === 'chase' && ai.targetId === 2, `onDamage -> chase on client 2, got ${ai.state}`);
  ai.resume();
  check(ai.state === 'chase', 'resume keeps the chase');
  ai.kill();
  const r = ai.tick([player(0, 10)]);
  check(ai.state === 'dead' && r.motion === null && r.hit === null, 'a dead enemy does nothing');
}

{
  // A class without a walk motion (Monest) never moves and never attacks.
  const nest = new EnemyAi({
    x: 0,
    z: 0,
    angle: 0,
    profile: AI_PROFILES['TObjEneBm3FlyNest'],
    detect: 225,
    turnRate: 1536,
    attack: null,
    speeds: { idleMove: 0, idleAnim: 1, engagedMove: 0, engagedAnim: 1 },
    radius: 10,
    wander: 0,
  });
  for (let i = 0; i < 50; i++) nest.tick([player(0, 20)], true);
  check(nest.x === 0 && nest.z === 0, 'a Monest stays on its spawn point');
  check(nest.state !== 'attack', `a Monest never attacks, got ${nest.state}`);
}

// --- enemy damage against the player, with the real tables ------------------

{
  const file = process.env.BATTLE_PARAMS ?? join(process.env.HOME!, 'Downloads/psobb-master/BattleParamEntry_on.dat');
  let data: Uint8Array | null = null;
  try {
    data = new Uint8Array(readFileSync(file));
  } catch {
    console.log(`BattleParamEntry: ${file} not found, skipped`);
  }
  if (data) {
    const params = new BattleParams(data);
    const booma = ENEMY_TYPE_PARAMS['BOOMA'];
    const attack = params.attack(0, booma.attack[0]);
    check(near(attack.distanceX, 12), `Booma attack reach ${attack.distanceX}`);
    check(attack.angle === 0x1c71, `Booma attack arc 0x${attack.angle.toString(16)}`);
    const wolf = ENEMY_TYPE_PARAMS['SAVAGE_WOLF'];
    check(near(params.attack(0, wolf.attack[0]).distanceX, 20), 'Savage Wolf attack reach 20');
    const move = params.movement(0, movementIndex('BOOMA')!);
    check(near(move.fparam1, 0.8) && near(move.fparam3, 0.5), `Booma movement data ${JSON.stringify(move)}`);
    const nestMove = params.movement(0, movementIndex('MONEST')!);
    check(nestMove.fparam1 === 0 && nestMove.fparam3 === 0, 'Monest has no movement data (newserv: loaded but not used)');
    // One Booma hit on a level-1 HUmar: ATP 106, no spread, player DFP ~ 8.
    const stats = params.stats(0, booma.stats[0]);
    const attacker = { atp: stats.atp, atpSpread: Math.max(0, attack.maxAtp - attack.minAtp), equipAtp: attack.minAtp, ata: attack.minAta + stats.ata, lck: stats.lck, isPlayer: false };
    const defender = { hp: 50, maxHp: 50, evp: 20, dfp: 8 };
    const d = rollDamage(attacker, defender, 0, () => 0.5, 1);
    const expected = (stats.atp - defender.dfp) * 0.2;
    check(near(d.damage, expected, 1e-4), `Booma hit for ${d.damage.toFixed(2)} (expected ${expected.toFixed(2)})`);
    console.log(`BattleParamEntry: Booma ATP ${stats.atp}, ATA ${attacker.ata}, reach ${attack.distanceX}, move ${move.fparam1}/${move.fparam3}; one hit = ${d.damage.toFixed(1)}`);
  }
}

console.log(`${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);

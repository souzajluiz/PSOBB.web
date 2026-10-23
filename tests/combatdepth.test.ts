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
  DEATH_FADE_MAX,
  DEATH_FADE_STEP,
  DEATH_FADE_TICKS,
  DEATH_FLAG_NO_DROP,
  HEAVY_HIT_FRACTION,
  hitMotion,
  INVULN_TICKS_GETUP,
  INVULN_TICKS_HEAVY,
  INVULN_TICKS_LIGHT,
  INVULN_TICKS_REVIVE,
  dampKnockback,
  KNOCKBACK_DAMPING,
  KnockbackSlide,
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
  // Spot checks of the slots read out of PsoBB.exe for motion type 0 (male)
  // and weapon class 0 (bare hands / sword).
  const expect: Array<[HitMotionKind, number, number, number]> = [
    ['block', 199, 3, 0xa0000010], // slot 6, vtable +0x4c (6x4A)
    ['heavy', 202, 1.4, 0xa0000040], // slot 9, vtable +0x58
    ['getup', 203, 1.9, 0x20000100], // slot 10, vtable +0x5c (the stand-up after the fall)
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
  for (const kind of ['block', 'heavy', 'getup', 'light', 'death', 'revive'] as HitMotionKind[]) {
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
  const sounds: number[] = [];
  const fx: string[] = [];
  const crits: boolean[] = [];
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
    sound: (id) => sounds.push(id),
    fx: (e) => {
      fx.push(e.kind === 'hit' ? (e.heavy ? 'hit-heavy' : 'hit-light') : e.kind);
      if (e.kind === 'hit') crits.push(e.critical);
    },
  });
  d.reset(maxHp);
  return { d, sent, motions, pushes, sounds, fx, crits };
}

{
  // A critical hit flags its hit fx (the owner shows the critical spark, SE 0x42 and the flash); a normal one does not.
  const crit = damageHarness(200);
  crit.d.hit(20, 0, ATTACK_KNOCKBACK, 0xffff, true);
  check(crit.d.hp === 180 && crit.crits.at(-1) === true, 'a critical hit sets the hit fx flag');
  const plain = damageHarness(200);
  plain.d.hit(20, 0, ATTACK_KNOCKBACK);
  check(plain.crits.at(-1) === false, 'a normal hit leaves the hit fx flag clear');
}

{
  // A small hit: 6x4B, the light-hit motion, SE 0x13, 60 ticks of invulnerability.
  const h = damageHarness(200);
  h.d.hit(20, 0, ATTACK_KNOCKBACK);
  check(h.d.hp === 180, `light hit HP ${h.d.hp}`);
  check(h.d.state === 'light', `light hit state ${h.d.state}`);
  check(h.sent.length === 1 && h.sent[0].kind === '6x4B', `light hit sent ${JSON.stringify(h.sent)}`);
  check(h.sent[0].args[1] === 180, '6x4B carries the current HP');
  check(h.motions[0] === 'light', `light hit motion ${h.motions[0]}`);
  check(h.sounds.join() === '19' && h.fx.join() === 'hit-light', `light hit SE 0x13 and the hit fx: ${h.sounds} ${h.fx}`);
  check(h.d.invuln === INVULN_TICKS_LIGHT, `light invulnerability ${h.d.invuln}`);
  // A second hit inside the invulnerability window does nothing.
  h.d.hit(20, 0, ATTACK_KNOCKBACK);
  check(h.d.hp === 180 && h.sent.length === 1 && h.sounds.length === 1, 'a hit during invulnerability is ignored');
  // ClampAndDampPlayerVelocity_00694230: each tick halves the velocity first,
  // then the player moves; below 1e-5 it is zero.
  h.d.tick();
  check(h.pushes.length === 1 && near(h.pushes[0][1], ATTACK_KNOCKBACK * KNOCKBACK_DAMPING), `knockback ${JSON.stringify(h.pushes[0])}`);
  h.d.tick();
  check(near(h.pushes[1][1], ATTACK_KNOCKBACK * KNOCKBACK_DAMPING ** 2), 'the knockback halves every tick');
  for (let i = 0; i < 40; i++) h.d.tick();
  check(h.d.state === 'alive', `back to alive, got ${h.d.state}`);
  // The light state ends when the motion ends, not after a fixed time.
  let ended = false;
  const dm = new PlayerDamage({
    motion: () => {},
    push: () => {},
    face: () => {},
    sendHit: () => {},
    sendShieldAttack: () => {},
    sendDeath: () => {},
    sendRevivable: () => {},
    sendRevived: () => {},
    log: () => {},
    motionEnded: () => ended,
  });
  dm.reset(200);
  dm.hit(10, 0, 0);
  for (let i = 0; i < 30; i++) dm.tick();
  check(dm.state === 'light', 'the light state lasts while the motion plays');
  ended = true;
  dm.tick();
  check(dm.state === 'alive', 'the light state ends with the motion');
}

{
  // More than a quarter of max HP: 6x4C, the fall (motion 9, SE 0x14, 300
  // ticks of invulnerability), SE 0x15 / 0x21 past frame 10, the stand-up
  // (motion 10) and 60 ticks of invulnerability after it.
  const sent: string[] = [];
  const sounds: number[] = [];
  const motions: HitMotionKind[] = [];
  let ended = false;
  let frame = 0;
  const d = new PlayerDamage({
    motion: (k) => {
      motions.push(k);
      ended = false;
      frame = 0;
    },
    push: () => {},
    face: () => {},
    sendHit: (heavy) => sent.push(heavy ? '6x4C' : '6x4B'),
    sendShieldAttack: () => {},
    sendDeath: () => {},
    sendRevivable: () => {},
    sendRevived: () => {},
    log: () => {},
    sound: (id) => sounds.push(id),
    landSound: () => 0x21,
    motionEnded: () => ended,
    motionFrame: () => frame,
  });
  d.reset(200);
  d.hit(200 * HEAVY_HIT_FRACTION + 1, 0, ATTACK_KNOCKBACK);
  check(sent[0] === '6x4C' && motions[0] === 'heavy' && sounds.join() === '20', `heavy hit ${sent} ${motions} ${sounds}`);
  check(d.invuln === INVULN_TICKS_HEAVY, `heavy invulnerability ${d.invuln}`);
  frame = 9;
  d.tick();
  check(sounds.length === 1, 'no landing SE before frame 10');
  frame = 11;
  d.tick();
  check(sounds.join() === '20,33', `landing SE 0x21 (RAcast) past frame 10: ${sounds}`);
  frame = 30;
  d.tick();
  check(sounds.length === 2, 'the landing SE plays once');
  ended = true;
  d.tick();
  check(d.state === 'getup' && motions.at(-1) === 'getup', `stand-up after the fall: ${d.state} ${motions}`);
  ended = true;
  d.tick();
  check(d.state === 'alive' && d.invuln === INVULN_TICKS_GETUP, `alive again with ${d.invuln} ticks of invulnerability`);
  // Exactly a quarter is still light.
  const l = damageHarness(200);
  l.d.hit(50, 0, 0);
  check(l.sent[0].kind === '6x4B', 'exactly 25% of max HP is a light hit');
}

{
  // No damage: 6x4A, the block motion (slot 6), SE 0x23 and the guard particles.
  const h = damageHarness(100);
  h.d.hit(0, 0, 0);
  check(h.d.hp === 100 && h.sent[0].kind === '6x4A' && h.motions[0] === 'block', `blocked hit ${JSON.stringify(h.sent)} ${h.motions[0]}`);
  check(h.sounds.join() === '35' && h.fx.join() === 'block', `block SE 0x23 and fx: ${h.sounds} ${h.fx}`);
  check(h.d.invuln === 0, 'a block grants no invulnerability');
}

{
  // Death: 6x4C (the killing hit is reported first), the whole fall, then 6x89 +
  // 6x4D and the death motion, the 64 frame red fade, 6x4E, and 6x4F on revive.
  const h = damageHarness(100);
  h.d.hit(500, 1.2, ATTACK_KNOCKBACK, 0x1003);
  check(h.d.hp === 0 && !h.d.dead && h.d.dying, `a lethal hit plays the fall first: HP ${h.d.hp} state ${h.d.state}`);
  check(h.sent.map((s) => s.kind).join(',') === '6x4C', `death hit sends ${h.sent.map((s) => s.kind).join(',')}`);
  for (let i = 0; i < 41; i++) h.d.tick();
  check(h.d.dead && h.d.state === 'dead', `dead once the fall has played, got ${h.d.state}`);
  check(h.sent.map((s) => s.kind).join(',') === '6x4C,6x89+6x4D', `death sends ${h.sent.map((s) => s.kind).join(',')}`);
  const death = h.sent[1];
  check(death.args[0] === 0x1003, `6x89 killer entity 0x${death.args[0].toString(16)}`);
  check(death.args[1] === DEATH_FLAG_NO_DROP, `6x4D death flags 0x${death.args[1].toString(16)}`);
  check(h.motions.at(-1) === 'death', `death motion ${h.motions.at(-1)}`);
  // A hit while dead does nothing.
  h.d.hit(10, 0, 0);
  check(h.sent.length === 2, 'no command while dead');
  // The death motion (60 ticks without a model), then the fade grows by 2 a
  // tick to 128 and 6x4E goes out on the 64th.
  for (let i = 0; i < 59; i++) h.d.tick();
  check(h.d.fade === 0 && h.d.state === 'dead', 'the fade starts after the death motion');
  h.d.tick();
  check(h.d.fade === DEATH_FADE_STEP, `fade after one tick ${h.d.fade}`);
  for (let i = 0; i < DEATH_FADE_TICKS - 2; i++) h.d.tick();
  check(h.d.fade === DEATH_FADE_MAX - DEATH_FADE_STEP && h.d.state === 'dead', `fade ${h.d.fade} one tick before the end`);
  h.d.tick();
  check(h.d.fade === DEATH_FADE_MAX && h.d.state === 'revivable' && h.sent.at(-1)!.kind === '6x4E', `revivable after the fade, got ${h.d.state}`);
  h.d.revive();
  check(h.d.hp > 0 && h.d.state === 'reviving' && h.sent.at(-1)!.kind === '6x4F', `revive ${h.d.hp} ${h.d.state}`);
  check(h.d.fade === 0 && h.d.invuln === INVULN_TICKS_REVIVE && h.fx.at(-1) === 'revive', 'revive clears the fade, 300 ticks of invulnerability, the revive fx');
  for (let i = 0; i < 41; i++) h.d.tick();
  check(h.d.state === 'alive' && !h.d.busy, `alive after the stand-up motion, got ${h.d.state}`);
  // A light killing blow: the flinch plays out, then the death.
  const l = damageHarness(1000);
  l.d.reset(1000, 10);
  l.d.hit(10, 0, 0);
  check(l.d.state === 'light' && l.d.dying, 'a lethal light hit flinches first');
  for (let i = 0; i < 21; i++) l.d.tick();
  check(l.d.state === 'dead', `then dies, got ${l.d.state}`);
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

// --- knockback slide (ClampAndDampPlayerVelocity_00694230, HandlePostHitPhysics) --
{
  // Per axis: |v| < 1e-5 becomes 0, otherwise v * 0.5 (0x0093c6b8).
  check(near(dampKnockback(1), 0.5) && near(dampKnockback(-1), -0.5), 'the knockback halves per tick');
  check(dampKnockback(9e-6) === 0 && dampKnockback(-9e-6) === 0, 'a velocity under 1e-5 is zeroed');
  check(near(dampKnockback(1e-5), 5e-6), 'a velocity of exactly 1e-5 is halved, not zeroed');

  // A packet's velocity slides the player: each tick it moves by the damped velocity.
  const s = new KnockbackSlide();
  s.start(1, -2);
  const first = s.tick();
  check(!!first && near(first.dx, 0.5) && near(first.dz, -1), `first slide tick ${JSON.stringify(first)}`);
  const second = s.tick();
  check(!!second && near(second.dx, 0.25) && near(second.dz, -0.5), `second slide tick ${JSON.stringify(second)}`);
  let total = { dx: first!.dx + second!.dx, dz: first!.dz + second!.dz };
  for (let i = 0; i < 60; i++) {
    const step = s.tick();
    if (step) {
      total.dx += step.dx;
      total.dz += step.dz;
    }
  }
  check(near(total.dx, 1, 1e-3) && near(total.dz, -2, 1e-3), `the slide covers 2 x its velocity: ${JSON.stringify(total)}`);
  check(s.tick() === null && s.vx === 0 && s.vz === 0, 'the slide stops once both axes are zero');

  // One axis at rest: only the other moves.
  const x = new KnockbackSlide();
  x.start(0.8, 0);
  const xs = x.tick();
  check(!!xs && near(xs.dx, 0.4) && xs.dz === 0, `a zero Z stays zero ${JSON.stringify(xs)}`);

  // stop() ends a slide at once (the stand-up, a new hit).
  const st = new KnockbackSlide();
  st.start(3, 3);
  st.stop();
  check(st.tick() === null, 'stop() ends the slide');

  // A velocity that decays below the epsilon on one tick: the last step is the
  // damped value of that tick, then nothing.
  const e = new KnockbackSlide();
  e.start(1.5e-5, 0);
  const e1 = e.tick();
  check(!!e1 && near(e1.dx, 7.5e-6, 1e-9), `1.5e-5 halves to 7.5e-6 ${JSON.stringify(e1)}`);
  check(e.tick() === null, 'then 7.5e-6 is under the epsilon and the slide stops');
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

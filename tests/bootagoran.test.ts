// Boota (0x115: vtable 0x00b0a680) and Goran (0x117: vtable 0x00b0af40): the Booma-substrate brain
// (combat/enemyai.ts AI_PROFILES BootaFamily / GoranFamily) and the radar icon rule (classic/minimap.ts).
// The vtable rows are the dumps of tools/exedata.py read <vtable+0x154> p 12 (VERIFIED); the motion
// rows are the dumps of tools/exedata.py motions (VERIFIED). Run: node tests/bootagoran.test.ts
import { AI_PROFILES, EnemyAi, type AiTarget, type EnemyAiProfile } from '../client/src/combat/enemyai.ts';
import { BOOMA_BRAIN_TYPES, boomaBrainIconShown } from '../client/src/classic/minimap.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// --- vtable +0x154 + 4 * state (state 0..11), read from PsoBB.exe ---
const BOOMA = [
  0x00535a6c, 0x0052a6e4, 0x0052ad80, 0x0052afe4, 0x0052b1b8, 0x0052b290,
  0x0061cdb0, 0x0052b33c, 0x0052b518, 0x0073d160, 0x0061cdb0, 0x005366b0,
];
const BOOTA = [
  0x005a57f4, 0x0052a6e4, 0x0052ad80, 0x0052afe4, 0x0052b1b8, 0x0052b290,
  0x0061cdb0, 0x0052b33c, 0x0052b518, 0x0073d160, 0x0061cdb0, 0x005a6448,
];
const GORAN = [
  0x005ad51c, 0x0052a6e4, 0x0052ad80, 0x005acdb8, 0x0052b1b8, 0x0052b290,
  0x0061cdb0, 0x0052b33c, 0x0052b518, 0x005517a0, 0x005acb78, 0x005ae3cc,
];
// The states whose handler is the Booma's (the same pointer in the Booma table).
const sharedWithBooma = (t: number[]) => t.map((p, i) => (p === BOOMA[i] ? i : -1)).filter((i) => i >= 0);
eq(sharedWithBooma(BOOTA), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'Boota: states 1..10 share the Booma handlers (6 and 10 the empty placeholder)');
eq(sharedWithBooma(GORAN), [1, 2, 4, 5, 6, 7, 8], 'Goran: states 1, 2, 4, 5, 7, 8 share the Booma handlers (6 the placeholder)');
eq(BOOTA.map((p, i) => (p === BOOMA[i] ? -1 : i)).filter((i) => i >= 0), [0, 11], 'Boota own: states 0 (0x005a57f4) and 11 (0x005a6448)');
eq(GORAN.map((p, i) => (p === BOOMA[i] ? -1 : i)).filter((i) => i >= 0), [0, 3, 9, 10, 11], 'Goran own: states 0, 3, 9, 10, 11');

// --- motion rows (slot -> motion index, speed), from exedata motions of 0x009c05a0 (Boota) and 0x009c10c0 (Goran) ---
// Boota's motion names (formats/enemymodels.ts): 0 appear, 1 atackl, 2 atackr, 7 mihari, 10 stund, 11 wakeup, 12 walk.
// Goran's: the same order with stund = 9, wakeup = 10, walk = 11.
const BOOTA_TABLE_NAMES = ['appear', 'atackl', 'atackr', 'damage', 'dead', 'deadb', 'leader', 'mihari', 'run', 'rush', 'stund', 'wakeup', 'walk'];
eq(BOOTA_TABLE_NAMES[10], 'stund', 'Boota motion 10 is stund (slot 0)');
eq(BOOTA_TABLE_NAMES[12], 'walk', 'Boota motion 12 is walk (slot 2)');
eq(BOOTA_TABLE_NAMES[11], 'wakeup', 'Boota motion 11 is wakeup (the war cry, slot 7)');

const boota: EnemyAiProfile = AI_PROFILES.BootaFamily as EnemyAiProfile;
const goran: EnemyAiProfile = AI_PROFILES.GoranFamily as EnemyAiProfile;
eq(boota.idle, { index: 10, speed: 0.6, loop: true }, 'Boota idle: slot 0 (stund, 0.6, loop)');
eq(boota.walk, { index: 12, speed: 0.5, loop: true }, 'Boota walk: slot 2 (walk, 0.5, loop)');
eq(boota.notice, { index: 11, speed: 0.8, loop: false }, 'Boota war cry: slot 7 (wakeup, 0.8, once)');
eq(boota.attacks, [{ index: 1, speed: 0.65, loop: false }, { index: 2, speed: 0.85, loop: false }], 'Boota attacks: slots 3 and 4');
eq(boota.spawn, { index: 0, speed: 0.5, loop: false }, 'Boota spawn row: slot 11 (appear, 0.5)');
eq(boota.spawnGate, false, 'Boota spawn gate: +0x398 is never 1 for the family');
eq(goran.idle, { index: 9, speed: 0.6, loop: true }, 'Goran idle: slot 0 (stund, 0.6, loop)');
eq(goran.walk, { index: 11, speed: 1, loop: true }, 'Goran walk: slot 2 (walk, 1.0, loop)');
eq(goran.notice, { index: 10, speed: 0.8, loop: false }, 'Goran war cry: slot 7 (wakeup, 0.8, once)');
eq(goran.attacks, [{ index: 1, speed: 1, loop: false }, { index: 2, speed: 1, loop: false }], 'Goran attacks: slots 3 and 4 at 1.0');
eq(goran.spawn ?? null, null, 'Goran has no spawn row (slot 11 mode 0)');
eq(goran.spawnTimer ?? null, null, 'Goran has no timed spawn in the brain');

// --- the brain ---
const speeds = { idleMove: 0.8, idleAnim: 0.8, engagedMove: 0.5, engagedAnim: 0.5 };
const brain = (profile: EnemyAiProfile, spawn?: boolean) =>
  new EnemyAi({
    x: 0,
    z: 0,
    angle: 0,
    profile,
    detect: 100,
    turnRate: 1024,
    attack: { minAtp: 0, maxAtp: 0, minAta: 0, maxAta: 0, distanceX: 12, angle: 0x1c71, distanceY: 0 },
    speeds,
    radius: 10,
    wander: 0,
    spawn,
  });
const near: AiTarget = { clientId: 0, x: 50, z: 0, charClass: 0, dead: false };

// Boota: the owner passes spawn true (the Booma's rule), the profile's gate makes it the no-animation branch:
// the first tick is sub 2 (no motion, not invulnerable), the next tick is idle (0x005a57f4 sub 2 -> state 1).
const b = brain(boota, true);
eq(b.state, 'spawn', 'Boota starts in the spawn state (its own state 0)');
const b0 = b.tick([near]);
eq([b.state, b0.motion, b.invulnerable], ['spawn', null, false], 'Boota first tick: no appear, not invulnerable');
const b1 = b.tick([near]);
eq([b.state, b1.motion], ['idle', null], 'Boota next tick: idle (state 1) with no motion change');
const b2 = b.tick([near]);
eq([b.state, b2.motion], ['notice', boota.notice], 'Boota: a near player starts the war cry (Booma state 3)');

// Goran: no spawn row, so the brain starts idle with the idle motion.
const g = brain(goran, false);
eq(g.state, 'idle', 'Goran starts idle (no spawn row in the port)');
eq(g.motion, goran.idle, 'Goran starts on its idle motion');
const g1 = g.tick([near]);
eq([g.state, g1.motion], ['notice', goran.notice], 'Goran: a near player starts the war cry');

// Hits: the Booma chase on the attacker, as for the other Booma-substrate families.
const bh = brain(boota, false);
bh.tick([]);
bh.onDamage(4);
eq(bh.state, 'chase', 'Boota: a hit starts the chase on the attacker');

// --- radar icon (the Booma rule, classic/minimap.ts BOOMA_BRAIN_TYPES) ---
for (const t of ['BOOTA', 'ZE_BOOTA', 'BA_BOOTA', 'GORAN', 'PYRO_GORAN', 'GORAN_DETONATOR']) {
  check(BOOMA_BRAIN_TYPES.has(t), `${t} uses the Booma brain's icon rule`);
}
// Boota's shared handlers: spawn (own state 0, no icon call), idle (1), notice and chase (3), attack and recover (5),
// dead (8, 0x0052b518, no icon). Goran's shared ones are the same exe states; its notice and chase are own state 3
// (ASSUMED icon shown, the Booma state-3 delegate).
eq(['spawn', 'idle', 'notice', 'chase', 'attack', 'recover', 'dead'].map((s) => boomaBrainIconShown(s)),
  [false, true, true, true, true, true, false], 'the radar icon of the Booma-substrate states');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('bootagoran: all checks passed');

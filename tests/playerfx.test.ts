// What a player shows and sounds when hit, blocking, dying, revived or carrying
// a status effect (combat/playerfx.ts): the attribute particle per class, the
// heavy fall's landing SE, the status pulses (onset and 45-frame ticks), the
// hit spark / guard / revive / soul emitter tables and their timelines, and
// the particle names in the client's particleentry.dat.
// Run: node tests/playerfx.test.ts
// Env: PSOBB_DATA (the client's data folder, default ~/Downloads/psobb-client/data)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ATTRIBUTE_PARTICLE,
  attributeFx,
  attributeParticle,
  BLOCK_FX,
  CRITICAL_HIT_FX,
  footstepType,
  FxEmitter,
  heavyLandSe,
  HIT_SPARK,
  playerAttribute,
  REVIVE_FX,
  SOUL_FX,
  STATUS_FX,
  statusFx,
  statusPulse,
  type FxSpec,
} from '../client/src/combat/playerfx.ts';
import { PlayerStatus, STATUS, type StatusType } from '../client/src/combat/status.ts';
import { parseParticleEntry } from '../client/src/classic/particles.ts';
import { GSLArchive } from '../client/src/formats/archives.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// --- the attribute particle of a hit (SetPlayerBattleAction_006951a0 + the table) ---
// HUmar HUnewearl HUcast RAmar RAcast RAcaseal FOmarl FOnewm FOnewearl HUcaseal FOmar RAmarl
eq(
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(playerAttribute),
  [1, 1, 4, 0x21, 0x24, 0x24, 1, 1, 1, 4, 1, 0x21],
  'player attribute per class (android 4, else 1, |0x20 for a Ranger)',
);
eq(
  [0, 2, 3, 4, 6, 9].map(attributeParticle),
  [0xf1, 0xe3, null, null, 0xf1, 0xe3],
  'attribute particle: native 0xf1, machine 0xe3, none for a Ranger',
);
eq(ATTRIBUTE_PARTICLE, { 1: 0xf1, 2: 0xf2, 4: 0xe3, 8: 0x10d }, 'attribute table of EntityHitEntity / EntityProcessStatusEffectParticle');
eq(attributeFx(3), [], 'a Ranger gets no attribute particle');
eq(attributeFx(0).map((s) => s.id), [0xf1], 'a HUmar gets 0xf1');

// --- the heavy fall's landing SE: 0x15, 0x21 for a RAcast ---
eq([0, 1, 2, 3, 4, 5, 9].map(footstepType), [0, 0, 1, 0, 2, 1, 1], 'footstep type per class');
eq([0, 2, 4, 5, 9].map(heavyLandSe), [0x15, 0x15, 0x21, 0x15, 0x15], 'heavy landing SE');

// --- status pulses: the particle every time, the SE on the ticks (and on the shock / freeze onset) ---
eq(statusPulse(STATUS.poison, true), { particle: 0x25, se: null }, 'poison onset: particle only');
eq(statusPulse(STATUS.poison, false), { particle: 0x25, se: 0x0c }, 'poison tick: particle + SE 0xc');
eq(statusPulse(STATUS.paralysis, true), { particle: 0x26, se: null }, 'paralysis onset');
eq(statusPulse(STATUS.paralysis, false), { particle: 0x26, se: 0x0d }, 'paralysis tick');
eq(statusPulse(STATUS.slow, false), { particle: 0x27, se: 0x0e }, 'slow tick');
eq(statusPulse(STATUS.confusion, true), { particle: 0x24, se: null }, 'confusion onset');
eq(statusPulse(STATUS.confusion, false), { particle: 0x24, se: 0x0f }, 'confusion tick');
eq(statusPulse(STATUS.shock, true), { particle: 0x21, se: 0x11 }, 'shock onset: particle + SE');
eq(statusPulse(STATUS.freeze, true), { particle: null, se: 0x10 }, 'freeze onset: SE 0x10, the ice object instead of a particle');
eq(statusPulse(STATUS.freeze, false), { particle: null, se: 0x10 }, 'freeze tick: SE 0x10');
eq(statusFx(STATUS.freeze), [], 'freeze has no particle');
eq(statusFx(STATUS.poison), [{ id: 0x25, dy: 20 }], 'poison particle spec');
eq(Object.keys(STATUS_FX).length, 6, 'six status effects');

// The pulses PlayerStatus sends, with their SE: poison 45 frames after the hit,
// then every 45; freeze repeats SE 0x10 every 45 frames until it ends.
{
  const log: string[] = [];
  const s = new PlayerStatus({
    sendAdd: () => {},
    sendRemove: () => {},
    poisonDamage: () => {},
    pulse: (t, onset) => {
      const p = statusPulse(t, onset);
      log.push(`${onset ? 'on' : 'tick'}:${t}:${p.particle ?? '-'}:${p.se ?? '-'}`);
    },
    log: () => {},
  });
  s.inflict(STATUS.poison);
  eq(log, ['on:15:37:-'], 'poison infliction pulse');
  for (let i = 0; i < 44; i++) s.tick(300, false, 0);
  eq(log.length, 1, 'no poison pulse in the first 44 frames');
  s.tick(300, false, 0);
  eq(log.at(-1), 'tick:15:37:12', 'poison tick pulse on frame 45');
  s.reset();
  log.length = 0;
  s.inflict(STATUS.freeze);
  for (let i = 0; i < 149; i++) s.tick(300, false, 0);
  // 150 frames: pulses where the remaining frames are multiples of 45 (135, 90, 45).
  eq(log, ['on:2:-:16', 'tick:2:-:16', 'tick:2:-:16', 'tick:2:-:16'], 'freeze: SE 0x10 on the onset and every 45 frames');
  const t: StatusType[] = [];
  for (const type of [STATUS.slow, STATUS.confusion, STATUS.shock]) {
    s.reset();
    log.length = 0;
    s.inflict(type);
    for (let i = 0; i < 400; i++) s.tick(300, false, 0);
    t.push(type);
    check(log.length >= 4 && log.every((l) => l.includes(`:${STATUS_FX[type].particle}:`)), `${type} pulses carry particle ${STATUS_FX[type].particle}`);
  }
}

// --- the emitter tables ---
eq(HIT_SPARK.map((s) => s.id), [4, 5, 6, 13], 'hit spark entity: particles 4, 5, 6, 0xd');
eq(CRITICAL_HIT_FX.map((s) => s.id), [7, 0xb, 0xc, 0xe], 'critical spark: particles 7, 0xb, 0xc, 0xe');
check(CRITICAL_HIT_FX[2].dy === HIT_SPARK[0].dy! - 20, 'particle 0xc sits 20 below the hit point, as on an enemy');
check(HIT_SPARK[2].dy === HIT_SPARK[0].dy! - 15, 'particle 6 sits 15 below the hit point');
eq(BLOCK_FX.map((s) => s.id), [0, 1, 2, 3], 'block entity: particles 0..3');
eq(SOUL_FX.map((s) => s.id), [0xaf], 'dead marker: particle 0xaf');
check(SOUL_FX[0].frames === Infinity && SOUL_FX[0].dy === 10, 'the dead marker is unbounded, 10 above the player');

// REVIVE_FX: update numbers (1-based) on which each emitter fires.
function schedule(spec: FxSpec, updates: number): number[] {
  const e = new FxEmitter(spec);
  const out: number[] = [];
  for (let i = 1; i <= updates; i++) if (e.update()) out.push(i);
  return out;
}
{
  const s35 = schedule(REVIVE_FX[0], 200);
  check(s35.length === 30 && s35[0] === 1 && s35.at(-1) === 30, 'riverser_hosi (0x35) emits on updates 1..30');
  eq(schedule(REVIVE_FX[1], 200), [36], 'riverser_fukkatu (0x36) after a 35 update delay, one update');
  eq(schedule(REVIVE_FX[2], 200), [46], 'riverser_shuugo (0x37) after a 45 update delay, one update');
  eq(schedule(REVIVE_FX[3], 200), [11], 'riverser_wakka (0x38) on the 11th update (the entity\'s counter hits 10), once');
  eq(REVIVE_FX.map((s) => s.id), [0x35, 0x36, 0x37, 0x38], 'revive emitter ids');
  const e = new FxEmitter({ id: 1 });
  check(!e.done && e.update() === 1 && e.done && e.update() === 0, 'a spec without frames is a single emission');
  const soul = new FxEmitter(SOUL_FX[0]);
  for (let i = 0; i < 1000; i++) soul.update();
  check(!soul.done, 'the unbounded emitter never finishes');
}

// --- the particle entries of the client's data ---
{
  const gslPath = join(process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data'), 'data.gsl');
  if (!existsSync(gslPath)) console.log('data.gsl not found, skipping the particleentry.dat names');
  else {
    const dat = new GSLArchive(new Uint8Array(readFileSync(gslPath))).get('particleentry.dat');
    const name = (id: number) => parseParticleEntry(dat, id).name;
    eq([0, 1, 2, 3].map(name), ['guard_a', 'guard_b', 'guard_c', 'guard_d'], 'particles 0..3 are the guard effects');
    eq([4, 5, 6, 13].map(name), ['hit_a', 'hit_b', 'hit_c', 'hit_d'], 'particles 4, 5, 6, 0xd are the hit effects');
    eq([0x24, 0x25, 0x26, 0x27].map(name), ['konran', 'poison_effect', 'mahi_effect', 'slow_effect'], 'status particles');
    eq([0x35, 0x36, 0x37, 0x38].map(name), ['riverser_hosi', 'riverser_fukkatu', 'riverser_shuugo', 'riverser_wakka'], 'revive particles');
    eq(name(0xaf), 'soul', 'particle 0xaf is the soul');
    console.log('particleentry.dat: names of the player effects match');
  }
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('playerfx: all checks passed');

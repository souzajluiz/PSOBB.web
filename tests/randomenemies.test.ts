// The challenge quests' random enemies and random waves (formats/randomenemies.ts):
// the evt2 events and the type 4 / 5 sections of the Episode 1 challenge quests
// (c88101..c88109) are materialized with a seed and compared with newserv's
// `materialize-map --bb --seed=...` output (vendor/newserv/src/Map.cc:3823) when
// the newserv binary is built. Enemies are compared by type, room, wave and child
// count, events by id, room, wave, delay and action offset: those are what kill
// sync depends on. Positions are not compared (see randomenemies.ts, positionFor).
//
// Run: node tests/randomenemies.test.ts
// Env: NEWSERV (newserv checkout with build/newserv; default: vendor/newserv)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuestDat } from '../client/src/formats/questdat.ts';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { PsoV2Cipher } from '../client/src/formats/prc.ts';
import { parseEvt2File, isEvt2 } from '../client/src/formats/events.ts';
import { materializeQuestDat, parseRandomEnemySections, RAND_ENEMY_BASE_TYPES } from '../client/src/formats/randomenemies.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const NEWSERV = [process.env.NEWSERV, join(HERE, '../vendor/newserv'), join(HERE, '../../../vendor/newserv')].find((d) => d && existsSync(join(d, 'system/quests')));
const SEED = 0x12345678; // newserv's --seed is hex
let failures = 0;
const fail = (msg: string) => {
  failures++;
  if (failures <= 40) console.log(`FAIL ${msg}`);
};
const check = (cond: boolean, msg: string) => cond || fail(msg);
const eq = <T>(a: T, b: T, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

if (!NEWSERV) {
  console.log('SKIP: no newserv checkout (system/quests)');
  process.exit(0);
}
const CHALLENGE = join(NEWSERV, 'system/quests/challenge-ep1');
const load = (name: string) => prsDecompress(new Uint8Array(readFileSync(join(CHALLENGE, `${name}-bb.dat`))));

// 1. The PSOV2 stream: the first values of a seed are newserv's (PSOV2Encryption,
//    PSOEncryption.cc:76), the same stream the exe's 56-value generator produces.
{
  const c = new PsoV2Cipher(SEED);
  const a = [c.next(), c.next(), c.next()];
  const d = new PsoV2Cipher(SEED);
  eq([d.next(), d.next(), d.next()], a, 'PsoV2Cipher is deterministic');
  check(new Set(a).size === 3, 'PsoV2Cipher values differ');
}

// 2. Every challenge quest parses, and its evt2 floors have their random sections.
const names = ['c88101', 'c88102', 'c88103', 'c88104', 'c88105', 'c88106', 'c88107', 'c88108', 'c88109'];
const datOf = new Map<string, ReturnType<typeof parseQuestDat>>();
for (const n of names) {
  const dat = parseQuestDat(load(n));
  datOf.set(n, dat);
  check(dat.warnings.length === 0, `${n}: parse warnings ${dat.warnings.join('; ')}`);
  for (const f of dat.floors.values()) {
    if (f.eventData && isEvt2(f.eventData)) {
      check(!!f.randomLocations && !!f.randomDefinitions, `${n} floor ${f.floor}: evt2 without random sections`);
      const e2 = parseEvt2File(f.eventData);
      check(e2.entries.length > 0, `${n} floor ${f.floor}: no evt2 entries`);
      const sec = parseRandomEnemySections(f.randomLocations!, f.randomDefinitions!);
      check(sec.weightTotal > 0, `${n} floor ${f.floor}: no weight`);
      for (const w of sec.weights) check(w.baseTypeIndex < RAND_ENEMY_BASE_TYPES.length || w.baseTypeIndex === 0xff, `${n} floor ${f.floor}: base index ${w.baseTypeIndex}`);
    }
  }
}

// 3. Materialization: deterministic, evt1 out, enemies inside the wave counts.
{
  const a = materializeQuestDat(datOf.get('c88101')!, SEED);
  const b = materializeQuestDat(datOf.get('c88101')!, SEED);
  eq([...a.floors.values()].map((f) => f.enemies.length), [...b.floors.values()].map((f) => f.enemies.length), 'materialize is deterministic');
  const c = materializeQuestDat(datOf.get('c88101')!, SEED + 1);
  check(JSON.stringify([...c.floors.values()].map((f) => f.enemyBytes)) !== JSON.stringify([...a.floors.values()].map((f) => f.enemyBytes)), 'another seed gives other enemies');
  const f1 = a.floors.get(1)!;
  check(!f1.eventData || !isEvt2(f1.eventData), 'materialized floor is evt1');
  check(f1.enemies.every((e) => e.floor === 1), 'enemies carry their floor');
  check(f1.enemies.every((e, i) => e.index === i), 'enemy indices run from 0');
  check(f1.enemies.length > 0 && (f1.events?.events.length ?? 0) > 0, 'floor 1 has enemies and events');
  // Every wave event either has enemies of its (room, wave) or only runs actions.
  const waves = new Set(f1.enemies.map((e) => `${e.section}/${e.wave}`));
  for (const ev of f1.events?.events ?? []) {
    if (!waves.has(`${ev.room}/${ev.wave}`)) check(ev.actions.length > 0, `event ${ev.id} has no enemies and no actions`);
  }
}

// 4. Against newserv: the same enemies (type, room, wave, children) and the same
//    events, floor by floor, for three quests.
const newservBin = join(NEWSERV, 'build/newserv');
if (existsSync(newservBin)) {
  const tmp = mkdtempSync(join(tmpdir(), 'randomenemies-'));
  try {
    for (const n of ['c88101', 'c88102', 'c88109']) {
      const input = join(tmp, `${n}-bb.dat`);
      copyFileSync(join(CHALLENGE, `${n}-bb.dat`), input);
      execFileSync(newservBin, ['materialize-map', '--bb', `--seed=${SEED.toString(16)}`, '--disassemble', input], { stdio: 'ignore' });
      const want = parseNewservText(readFileSync(`${input}.txt`, 'utf8'));
      const got = materializeQuestDat(datOf.get(n)!, SEED);
      let floorsChecked = 0;
      for (const [floor, f] of got.floors) {
        if (!f.randomEnemies) continue;
        floorsChecked++;
        const w = want.get(floor) ?? { enemies: [], events: [] };
        eq(f.enemies.map((e) => `${e.type} ${e.section} ${e.wave} ${e.numChildren}`), w.enemies, `${n} floor ${floor} enemies vs newserv`);
        eq((f.events?.events ?? []).map((e) => `${e.id} ${e.room} ${e.wave} ${e.delay} ${e.actionOffset}`), w.events, `${n} floor ${floor} events vs newserv`);
      }
      check(floorsChecked > 0, `${n}: no random floors checked`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
} else {
  console.log('note: newserv build/newserv not found; the newserv comparison is skipped');
}

// Parses newserv's `--disassemble` text: enemy sets and events per floor section.
function parseNewservText(text: string): Map<number, { enemies: string[]; events: string[] }> {
  const out = new Map<number, { enemies: string[]; events: string[] }>();
  let cur: { enemies: string[]; events: string[] } | null = null;
  for (const line of text.split('\n')) {
    let m = line.match(/^\.(?:enemy_sets|events) (\d+)/);
    if (m) {
      // Both sections of a floor share one entry.
      const floor = Number(m[1]);
      cur = out.get(floor) ?? { enemies: [], events: [] };
      out.set(floor, cur);
      continue;
    }
    if (line.startsWith('.')) {
      cur = null;
      continue;
    }
    if (!cur) continue;
    m = line.match(/\[EnemySetEntry type=([0-9A-F]+) .*?num_children=([0-9A-F]+) .*?room=([0-9A-F]+) wave_number=([0-9A-F]+)/);
    if (m) {
      cur.enemies.push(`${parseInt(m[1], 16)} ${parseInt(m[3], 16)} ${parseInt(m[4], 16)} ${parseInt(m[2], 16)}`);
      continue;
    }
    m = line.match(/\[Event1Entry event_id=([0-9A-F]+) flags=[0-9A-F]+ event_type=[0-9A-F]+ room=([0-9A-F]+) wave_number=([0-9A-F]+) delay=([0-9A-F]+) action_stream_offset=([0-9A-F]+)\]/);
    if (m) cur.events.push(`${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)} ${parseInt(m[4], 16)} ${parseInt(m[5], 16)}`);
  }
  return out;
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exitCode = failures ? 1 : 0;

// Field music: the area -> BGM table, the interactive-music sequencer (slbgm)
// and the chained-Ogg links of the user's data/ogg/slbgm_*.ogg files.
// Run: node web/tests/fieldbgm.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fieldBgm, FieldMusic, CITY_ZONES } from '../client/src/audio/fieldbgm.ts';
import { oggLinks, SLBGM, SlSequencer } from '../client/src/audio/slbgm.ts';
import type { BgmPlayer } from '../client/src/audio/bgm.ts';

const OGG = join(process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data'), 'ogg');
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// --- Area table (scene records at 0x00a160c0) ---
eq(fieldBgm(0x01, 1), { kind: 'sl', index: 0 }, 'Forest 1');
eq(fieldBgm(0x05, 1), { kind: 'sl', index: 1 }, 'Cave 3');
eq(fieldBgm(0x07, 1), { kind: 'sl', index: 2 }, 'Mine 2');
eq(fieldBgm(0x0a, 1), { kind: 'sl', index: 3 }, 'Ruins 3');
eq(fieldBgm(0x0b, 1), { kind: 'adx', name: 'dragon.adx' }, 'Dragon');
eq(fieldBgm(0x0c, 1), { kind: 'adx', name: 'delo.adx' }, 'De Rol Le');
eq(fieldBgm(0x0d, 1), { kind: 'sl', index: 3, minZ: 4000 }, 'Vol Opt');
eq(fieldBgm(0x0e, 1), { kind: 'sl', index: 4, delayFrames: 0x5b }, 'Dark Falz');
eq(fieldBgm(0x13, 2), { kind: 'sl', index: 7 }, 'VR Temple Alpha');
eq(fieldBgm(0x16, 2), { kind: 'sl', index: 8 }, 'VR Spaceship Beta');
eq(fieldBgm(0x10, 1), { kind: 'none' }, 'Ep1 battle area');
eq(fieldBgm(0x17, 2), { kind: 'sl', index: 5 }, 'CCA');
eq(fieldBgm(0x22, 2), { kind: 'sl', index: 5 }, 'Seaside Night');
eq(fieldBgm(0x1d, 2), { kind: 'sl', index: 6 }, 'Seabed Lower');
eq(fieldBgm(0x1e, 2), { kind: 'adx', name: 'gryphon.adx' }, 'Gal Gryphon');
eq(fieldBgm(0x20, 2), { kind: 'adx', name: 'delo2.adx' }, 'Barba Ray');
eq(fieldBgm(0x21, 2), { kind: 'adx', name: 'dragon2.adx' }, 'Gol Dragon');
eq(fieldBgm(0x26, 3), { kind: 'sl', index: 9 }, 'Crater South');
eq(fieldBgm(0x28, 3), { kind: 'sl', index: 10 }, 'Crater Interior');
eq(fieldBgm(0x2b, 3), { kind: 'sl', index: 11 }, 'Desert 3');
eq(fieldBgm(0x2c, 3), { kind: 'adx', name: 'slbgm_boss09.ogg' }, 'Saint-Milion');
check(fieldBgm(0x00, 1).kind === 'city' && fieldBgm(0x2d, 3).kind === 'city' && fieldBgm(0x12, 2).kind === 'city', 'Pioneer 2 / Lab zones');

// --- Sequencer (FUN_00814c7c / FUN_00814f30 / FUN_00815170) ---
{
  const s = new SlSequencer(0); // forest
  const links = [...s.start()];
  for (let i = 0; i < 26; i++) links.push(s.next());
  // Calm: records of 4 links 0..23; record 0 comes back at its loop link 24.
  eq(links, [...Array(24).keys(), 24, 1, 2, 3], 'forest calm sequence');
  // Battle requested while link 3 (record 0) plays: the queued choice is the
  // record's transition (25), then battle[calm record 0 .next = 1].loop = 35.
  s.setBattle(true);
  eq([s.next(), s.next(), s.next()], [25, 35, 36], 'calm -> battle');
  check(s.battle, 'in battle mode');
  s.setBattle(false);
  // Battle record 1 transition 57, then calm[battle record 1 .next = 2].loop = 8.
  eq([s.next(), s.next(), s.next()], [57, 8, 9], 'battle -> calm');
}
{
  const s = new SlSequencer(9); // wilds: record 0 is a single link
  eq(s.start(), [37, 39], 'wilds start (one-link record)');
  eq([s.next(), s.next(), s.next()], [40, 41, 42], 'wilds record 1 then 2');
}
{
  const s = new SlSequencer(4); // dark: battle requests are ignored
  s.start();
  s.setBattle(true);
  const l = [s.next(), s.next(), s.next()];
  check(!s.battle && l.every((x) => x < 13), `dark ignores battle (${l})`);
}

// --- Chained Ogg links in the user's files ---
if (existsSync(OGG)) {
  for (const b of SLBGM) {
    const path = join(OGG, b.file);
    if (!existsSync(path)) {
      check(false, `${b.file} present`);
      continue;
    }
    const data = new Uint8Array(readFileSync(path));
    const links = oggLinks(data);
    const used = Math.max(...[...b.calm, ...b.battle].flatMap((r) => [r.first + r.count - 1, r.loop, r.transition]));
    check(links.length > used, `${b.file}: ${links.length} links, tables use up to ${used}`);
    check(links.every(([s, e], i) => e > s && (i === 0 || links[i - 1][1] === s)), `${b.file}: contiguous links`);
    console.log(`${b.file.padEnd(20)} ${String(links.length).padStart(3)} links, highest used ${used}`);
  }
} else {
  console.log(`(no ${OGG}; skipping the file checks)`);
}

// --- Pioneer 2 BGM zones (FUN_00642824 / FUN_00642724) ---
{
  const played: string[] = [];
  const fake = { play: async (n: string) => void played.push(n), playInteractive: (i: number) => played.push(`sl:${i}`), stop: () => played.push('stop') } as unknown as BgmPlayer;
  const m = new FieldMusic(fake);
  m.enter(0, 1);
  const shop = CITY_ZONES[7];
  m.tick(1 / 30, { x: 0, y: 0, z: 0 }); // inside a city zone: no change
  m.tick(1 / 30, { x: shop.x, y: 0, z: shop.z });
  m.tick(1 / 30, { x: 500, y: 0, z: 500 }); // nowhere: the shop music keeps playing
  m.tick(1 / 30, { x: 0, y: 0, z: 0 });
  eq(played, ['stop', 'city.adx', 'SHOP.adx', 'city.adx'], 'city zones');
  played.length = 0;
  m.enter(0x0e, 1);
  for (let i = 0; i < 0x5a; i++) m.tick(1 / 30, { x: 0, y: 0, z: 0 });
  eq(played, ['stop'], 'Dark Falz waits 0x5a frames');
  m.tick(1 / 30, { x: 0, y: 0, z: 0 });
  eq(played, ['stop', 'sl:4'], 'Dark Falz music');
}

// --- Counter jingles (classic/shop.ts TekkerCounter: j_kantei / miniclear) ---
{
  const played: string[] = [];
  const fake = { play: async (n: string) => void played.push(n), playInteractive: (i: number) => played.push(`sl:${i}`), stop: () => played.push('stop') } as unknown as BgmPlayer;
  const m = new FieldMusic(fake);
  m.enter(0x00, 1); // Pioneer 2: city zones
  m.tick(1 / 30, { x: 0, y: 0, z: 0 });
  played.length = 0;
  m.jingle('j_kantei.adx');
  eq(played, ['j_kantei.adx'], 'a jingle replaces the track');
  m.tick(1 / 30, { x: 0, y: 0, z: 0 });
  eq(played, ['j_kantei.adx'], 'no restore while the jingle is the one playing');
  m.resume();
  m.tick(1 / 30, { x: 0, y: 0, z: 0 });
  eq(played, ['j_kantei.adx', 'city.adx'], 'resume: the city track starts again');
  played.length = 0;
  m.enter(0x0e, 1); // Dark Falz: sl:4 after 0x5b frames
  for (let i = 0; i < 0x5c; i++) m.tick(1 / 30, { x: 0, y: 0, z: 0 });
  played.length = 0;
  m.jingle('miniclear.adx');
  m.resume();
  m.tick(1 / 30, { x: 0, y: 0, z: 0 });
  eq(played, ['miniclear.adx', 'sl:4'], 'resume on an interactive track plays it again');
}

console.log(failures ? `${failures} failures` : 'field music: all checks passed');
process.exit(failures ? 1 : 0);

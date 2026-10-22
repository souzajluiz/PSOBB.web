// Parses every sound bank in the user's client data/sound folder and checks it
// against the exe tables (entry counts, loop points inside the wave).
// Run: node web/tests/sound.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSePac, waveToFloat } from '../client/src/formats/sepac.ts';
import { SE_AREA_BANK, SE_BANKS, SE_SLOT_FLAGS } from '../client/src/audio/se_tables.ts';
import { SE, seSlot, seVolume } from '../client/src/audio/se.ts';

const SOUND = join(process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data'), 'sound');
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

const files = readdirSync(SOUND).filter((f) => f.endsWith('.pac'));
for (const b of SE_BANKS) check(files.includes(b.file), `${b.file} present`);
let total = 0, seconds = 0;
for (const f of files.sort()) {
  const data = new Uint8Array(readFileSync(join(SOUND, f)));
  const waves = parseSePac(data);
  const table = SE_BANKS.find((b) => b.file === f);
  if (!table) console.log(`${f}: not in the exe bank table (never loaded by FUN_00828d40)`);
  if (table) {
    check(waves.length === table.slots.length, `${f}: ${waves.length} waves, exe table ${table.slots.length}`);
    for (const [k, start, end] of table.loops) check(start < end && end <= waves[k].frames, `${f} #${k} loop ${start}..${end} of ${waves[k].frames}`);
  }
  const dur = waves.map((w) => w.frames / w.rate);
  const rates = [...new Set(waves.map((w) => `${w.rate}Hz/${w.bits}bit/${w.channels}ch`))];
  const peak = Math.max(...waves.slice(0, 3).map((w) => waveToFloat(w)[0].reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  check(peak > 0 && peak <= 1, `${f} sample range`);
  const sum = dur.reduce((a, b) => a + b, 0);
  total += waves.length;
  seconds += sum;
  console.log(`${f.padEnd(12)} ${String(waves.length).padStart(4)} waves  ${sum.toFixed(1).padStart(6)} s  (${Math.min(...dur).toFixed(2)}..${Math.max(...dur).toFixed(2)} s)  ${rates.join(' ')}  loops ${table?.loops.length ?? 0}`);
}
console.log(`${total} waves, ${seconds.toFixed(1)} s`);

// UI ids resolve to a wave in common.pac or city.pac (the banks resident on the title and character screens).
const resident = new Set([...SE_BANKS.find((b) => b.file === 'common.pac')!.slots, ...SE_BANKS.find((b) => b.file === 'city.pac')!.slots]);
for (const [name, id] of Object.entries(SE)) {
  const slot = seSlot(id);
  check(resident.has(slot), `SE.${name} 0x${id.toString(16)} resident`);
  console.log(`SE.${name.padEnd(8)} 0x${id.toString(16)} flags 0x${(SE_SLOT_FLAGS[slot] >>> 0).toString(16).padStart(8, '0')} volume ${seVolume(SE_SLOT_FLAGS[slot])}`);
}
check(seVolume(0) === 0 && seVolume(0x7f00) === -6400, 'volume formula end points');
// Saint-Milion's area (0x2c) plays from boss09.pac (SE_AREA_BANK): its laser loop 0x6f8 must be
// in that bank's slots, or the area swap (CombatView.enterFloor) would load nothing for it.
const area = SE_AREA_BANK[0x2c];
check(SE_BANKS[area]?.file === 'boss09.pac', `area 0x2c bank is boss09.pac (got ${SE_BANKS[area]?.file})`);
check(SE_BANKS[area]?.slots.includes(0x6f8) === true, 'SE 0x6f8 (laser loop) in the area 0x2c bank');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('ok');

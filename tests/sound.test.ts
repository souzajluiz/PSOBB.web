// Parses every sound bank in the user's client data/sound folder and checks it
// against the exe tables (entry counts, loop points inside the wave).
// Run: node web/tests/sound.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSePac, waveToFloat } from '../client/src/formats/sepac.ts';
import { SE_AREA_BANK, SE_BANKS, SE_SLOT_FLAGS } from '../client/src/audio/se_tables.ts';
import { positionalMode, SE, seDistance, seGain3d, seSlot, sePan, seVolume } from '../client/src/audio/se.ts';

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

// Positional SE (FUN_00814298 with a position): SE 0x571 (the pickup, play_sound_effect_at_player)
// has flag 0x8000 and kind 0 (a 3D buffer), static attenuation 0x28, and is culled at 300.
const f571 = SE_SLOT_FLAGS[seSlot(0x571)];
check(((f571 >>> 15) & 1) === 1 && ((f571 & 0x0f000000) >>> 24) === 0 && ((f571 & 0x7f00) >> 8) === 0x28, `SE 0x571 flags 0x${f571.toString(16)}: 3D bit, kind 0, attenuation 0x28`);
check(positionalMode(0x571, f571, 0, 1) === '2d' && positionalMode(0x571, f571, 2, 1) === '2d', 'SE 0x571 within 2 is 2D');
check(positionalMode(0x571, f571, 2.5, 1) === '3d' && positionalMode(0x571, f571, 299.9, 1) === '3d', 'SE 0x571 from 2 to 300 is 3D');
check(positionalMode(0x571, f571, 300, 1) === 'cull' && positionalMode(0x571, f571, 900, 1) === 'cull', 'SE 0x571 at 300 or more is culled');
check(positionalMode(0x571, f571, 900, 0x0e) === '3d' && positionalMode(0x571, f571, 900, 0x2c) === '3d', 'areas 0xe / 0x2c do not cull');
check(positionalMode(0x571, 0, 50, 1) === '2d', 'a slot without flag 0x8000 is 2D');
check(positionalMode(0x90, 0x8000, 10, 1) === '2d' && positionalMode(0x90, 0x8000, 17, 1) === '3d', 'slot 0x90 is 2D within 16 only');
check(positionalMode(0x88, 0x8000, 10, 1) === '3d', 'slot 0x88 stays 3D within 16');
check(positionalMode(0x90, 0x8000 | (10 << 24), 50, 1) === '3d' && positionalMode(0x90, 0x8000 | (3 << 24), 50, 1) === '2d', 'kinds 0 and 10 are 3D, other kinds 2D');
check(seDistance([3, 4, 0], [0, 0, 0]) === 5 && seDistance([0.1, 0, 0], [0, 0, 0]) === 0, 'distance: 3-4-5, and under 0.025 squared is 0');
check(seGain3d(50) === 1 && seGain3d(80) === 1 && seGain3d(160) === 0.5 && seGain3d(900) === 80 / 500, 'DS3D gain: 1 to min 80, min / d, clamped at max 500');
const lis = { pos: [0, 0, 0] as const, front: [0, 0, -1] as const };
check(sePan([10, 0, 0], lis) === 1 && sePan([-10, 0, 0], lis) === -1 && sePan([0, 5, -10], lis) === 0, 'pan: right is +x for a front of -z (the camera\'s screen)');
check(Math.abs(sePan([10, 0, -10], lis) - Math.SQRT1_2) < 1e-9, 'pan 45 degrees right is sqrt(1/2)');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('ok');

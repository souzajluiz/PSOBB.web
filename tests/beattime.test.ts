// The beat clock (client/src/combat/beattime.ts) as PsoBB.exe computes it, and what it feeds: the set
// factors of the galatine ladder and morning glory in the live SetContext and the compare list.
// Exe: GetBeatTime_0077b950 / get_beat_time_0077bab4 / set_base_beat_time_from_packet_b1 0x0077bb68 /
// InitializePhaseTimer_0077bc80 (dump src/Psobb.exe-05112026.c 752556..752740); the galatine ladder is
// get_equipment_set_atp_bonus_weapon 0x005d3b54 (its beat branch at 0x005d3e78, the asm bytes).
// Dates are built from local fields so the expected beats do not depend on the machine's time zone.
//
// Run: node tests/beattime.test.ts
import {
  beatBaseFromServer,
  beatFromFrames,
  beatTime,
  clockFrames,
  liveBeatTime,
  parseServerTimeB1,
  PHASE_TIMER_DEFAULT_BASE,
  resetPhaseTimerBase,
  setPhaseBaseFromServerTime,
} from '../client/src/combat/beattime.ts';
import { defaultSetContext, morningGloryAtpBonus, recalculateCandidate, wornEquipment, type CompareStats } from '../client/src/combat/playerstats.ts';
import { weaponForCombat } from '../client/src/combat/formulas.ts';
import type { ItemData } from '../client/src/formats/itemnames.ts';

let failures = 0;
let checks = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// A local epoch ms for 2026-10-25 hh:mm:ss (the machine's zone, as GetLocalTime reads it).
const at = (h: number, m: number, s: number) => new Date(2026, 9, 25, h, m, s).getTime();

// The constants and the frame arithmetic.
eq(PHASE_TIMER_DEFAULT_BASE, 1728000, 'InitializePhaseTimer base 0x1a5e00');
eq(clockFrames({ hour: 1, minute: 2, second: 3 }), (3600 + 120 + 3) * 30, 'GetBeatTime clock: 30 frames per second');
eq(beatFromFrames(0), 0, 'frames 0 is beat 0');
eq(beatFromFrames(2591), 0, 'one frame short of a beat is still beat 0');
eq(beatFromFrames(2592), 1, 'one beat = 2592 frames = 86.4 s');
eq(beatFromFrames(2592 * 999), 999, 'the last beat of the day');
eq(beatFromFrames(2592000), 0, 'a day of frames wraps to beat 0 (1000 beats)');

// Offline (no B1 yet): the base is 0x1a5e00 and the clock is the local one.
resetPhaseTimerBase();
eq(beatTime(at(0, 0, 0)), 666, 'offline 00:00:00: (0 + 1728000) / 2592 = 666');
eq(beatTime(at(12, 0, 0)), 166, 'offline 12:00:00: (1296000 + 1728000) / 2592 = 1166 -> 166');
eq(beatTime(at(16, 0, 0)), 333, 'offline 16:00:00: 3456000 / 2592 = 1333 -> 333');
eq(beatTime(at(23, 59, 59)), 666, 'offline 23:59:59: 4319970 / 2592 = 1666 -> 666');
eq(beatTime(at(0, 1, 26), 0), 0, 'base 0, 00:01:26 (86 s = 2580 frames): beat 0');
eq(beatTime(at(0, 1, 27), 0), 1, 'base 0, 00:01:27 (87 s = 2610 frames): beat 1');
eq(beatTime(at(0, 0, 0) + 999, 0), 0, 'milliseconds are ignored (SYSTEMTIME seconds)');

// The base from a B1 string: the server clock and the local clock at receipt.
eq(parseServerTimeB1('2022:03:30: 15:36:42.000'), { hour: 15, minute: 36, second: 42 }, 'B1 string: hour, minute, second at 12, 15, 18');
eq(parseServerTimeB1('garbage'), null, 'B1 string that is not a time: no base');
eq(beatBaseFromServer({ hour: 12, minute: 0, second: 0 }, { hour: 12, minute: 0, second: 0 }), 0x1a5e0, 'same clocks: base = 0x1a5e0');
eq(beatBaseFromServer({ hour: 0, minute: 0, second: 0 }, { hour: 23, minute: 59, second: 59 }), 108030, 'base folded into [0, one day): -2591970 + 108000 + 2592000');
// newserv sends UTC: a machine at UTC+4 (16:00 local) and a server at 12:00 UTC give the same beat.
// 12:00 UTC + 1 h (0x1a5e0) = 13:00 BMT = 1404000 frames = 541.67 beats.
const utcBase = beatBaseFromServer({ hour: 12, minute: 0, second: 0 }, { hour: 16, minute: 0, second: 0 });
eq(utcBase, 2268000, 'server 12:00 vs local 16:00: -324000 folded by one day');
eq(beatTime(at(16, 0, 0), utcBase), beatFromFrames(12 * 3600 * 30 + 0x1a5e0), 'with a B1 base the beat is (server frames + 0x1a5e0) / 2592');
eq(beatTime(at(16, 0, 0), utcBase), 541, 'server 12:00:00 UTC: beat 541 (1296000 + 108000 = 1404000 -> 541)');
eq(beatTime(at(12, 0, 0), 0x1a5e0), 541, 'same instant on a UTC machine: beat 541');
// The base is always in [0, one day) so the beat is never negative.
let folded = true;
for (let h = 0; h < 24; h += 3) for (let m = 0; m < 60; m += 17) for (let s = 0; s < 60; s += 13) {
  const b = beatBaseFromServer({ hour: h, minute: m, second: s }, { hour: 23 - h, minute: 59 - m, second: 59 - s });
  if (b < 0 || b >= 2592000 || (b - (clockFrames({ hour: h, minute: m, second: s }) - clockFrames({ hour: 23 - h, minute: 59 - m, second: 59 - s }) + 0x1a5e0)) % 2592000 !== 0) folded = false;
}
eq(folded, true, 'base folds into [0, 2592000) and keeps the frame difference modulo a day');

// The live clock: the B1 base is set, then liveBeatTime follows the local clock.
resetPhaseTimerBase();
setPhaseBaseFromServerTime('2026:10:25: 12:00:00.000', at(16, 0, 0));
eq(liveBeatTime(at(16, 0, 0)), 541, 'B1 12:00 UTC received at local 16:00: live beat 541');
eq(liveBeatTime(at(16, 0, 87)), 542, 'the live beat moves with the local clock: 87 s later is beat 542');
setPhaseBaseFromServerTime('nonsense', at(16, 0, 0));
eq(liveBeatTime(at(16, 0, 0)), 541, 'an unparsed B1 string keeps the base');
resetPhaseTimerBase();
eq(liveBeatTime(at(16, 0, 0)), 333, 'no B1: the InitializePhaseTimer base, the local clock');

// The set factors read the beat through the SetContext: the galatine ladder (0x005d3b54) and morning glory.
const pmt = { getWeapon: () => ({ atpMin: 40, atpMax: 50, ata: 30, mst: 0, statBoostEntryIndex: 0 }), statBoosts: [] };
const item = (d: number[]): ItemData => ({ data1: new Uint8Array(d), id: 0, data2: new Uint8Array(4) });
const galatine = new Uint8Array([0, 1, 8, 10, 0, 0, 0, 0, 0, 0, 0, 0]); // grind 10: (40 + 20) x f .. (50 + 20) x f
const galatineRange = (beat: number) => weaponForCombat(galatine, pmt, defaultSetContext(wornEquipment([]), beat))!.range;
eq(galatineRange(0), { min: 20, max: 23 }, 'galatine beat 0: 0.33');
eq(galatineRange(124), { min: 20, max: 23 }, 'galatine beat 124: 0.33');
eq(galatineRange(125), { min: 30, max: 35 }, 'galatine beat 125: 0.5');
eq(galatineRange(250), { min: 60, max: 70 }, 'galatine beat 250: 1.0');
eq(galatineRange(375), { min: 120, max: 140 }, 'galatine beat 375: 2.0');
eq(galatineRange(500), { min: 180, max: 210 }, 'galatine beat 500: 3.0');
eq(galatineRange(625), { min: 120, max: 140 }, 'galatine beat 625: 2.0');
eq(galatineRange(750), { min: 60, max: 70 }, 'galatine beat 750: 1.0');
eq(galatineRange(875), { min: 30, max: 35 }, 'galatine beat 875: 0.5');
eq(galatineRange(liveBeatTimeAt(16)), { min: 60, max: 70 }, 'galatine on the offline clock at 16:00 (beat 333): 1.0');
function liveBeatTimeAt(hour: number): number {
  return beatTime(at(hour, 0, 0));
}

// Morning glory: beat / 4 on a sub 0x94 weapon, 0 otherwise.
eq(morningGloryAtpBonus(item([0, 0x94, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 541), 135, 'morning glory beat 541: 541 >> 2 = 135');
eq(morningGloryAtpBonus(item([0, 0x94, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 0), 0, 'morning glory beat 0: 0');
eq(morningGloryAtpBonus(item([0, 1, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 541), 0, 'morning glory: other subs give 0');

// The compare list: the candidate's ATP moves with the beat (galatine 0.33 -> 3.0 at beat 500).
const file: CompareStats = { atp: 100, dfp: 0, mst: 0, ata: 0, evp: 0, lck: 0 };
const noWorn = wornEquipment([]);
const gal = item([0, 1, 8, 10, 0, 0, 0, 0, 0, 0, 0, 0]);
const cmpLow = recalculateCandidate(file, gal, noWorn, 0, pmt as never, 0);
const cmpHigh = recalculateCandidate(file, gal, noWorn, 0, pmt as never, 500);
eq(cmpLow.atp < cmpHigh.atp, true, 'compare: galatine candidate ATP is higher at beat 500 than at beat 0');
eq(recalculateCandidate(file, gal, noWorn, 0, pmt as never).atp, cmpLow.atp, 'compare: the default beat is 0');

console.log(`beattime: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

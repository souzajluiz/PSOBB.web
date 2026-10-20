// Challenge Mode (client/src/quest/cmode.ts): the encodings, the packets, the
// character templates, the rank rules, and the BB challenge quests running
// through the VM with a recording environment.
//
// Run: node tests/cmode.test.ts
// Env: NEWSERV (newserv checkout with system/quests; the quest part skips
//      without it).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prsDecompress } from '../client/src/formats/prs.ts';
import {
  CHALLENGE_FORCE_TEMPLATES,
  CHALLENGE_HUNTER_TEMPLATES,
  CHALLENGE_RANGER_TEMPLATES,
} from '../client/src/formats/challengetemplates.ts';
import {
  areaCounterText,
  buildChallengeRecords,
  buildDeadFlag,
  buildDfAwardItem,
  buildDfExpMultiplier,
  buildDfRankText,
  buildDfRankThreshold,
  buildFailureOption,
  buildGraveRecoveryRequest,
  buildSRankWeapon,
  buildSetChallengeTime,
  ChallengeMode,
  ChallengeRecords,
  CM_EXP_MULTIPLIER_MAX,
  colorFrom1555,
  colorTo1555,
  decodeChallengeTime,
  decryptRankText,
  dfCommand,
  encodeChallengeTime,
  encryptRankText,
  parseChallengeRecords,
  parseDeadFlag,
  parseFailureOption,
  parseSetChallengeTime,
  RECORDS_SIZE,
  resultLines,
  timerText,
  validTime,
  type ChallengeEnv,
  type ChallengeResult,
} from '../client/src/quest/cmode.ts';
import type { LoadedQuest } from '../client/src/net/quests.ts';
import { killExp } from '../client/src/combat/progression.ts';
import { parsePlyLevelTbl } from '../client/src/formats/plyleveltbl.ts';
import { applyOverlay, buildChallengeOverlay, challengeTemplate, writeOverlayRaw } from '../client/src/quest/cmodeoverlay.ts';
import { graveDropPoints, recordGrave, saveGrave } from '../client/src/quest/cmode.ts';
import type { CharacterFile } from '../client/src/net/charfile.ts';
import { QuestSession } from '../client/src/quest/session.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${msg}`);
  }
};
const eq = <T>(got: T, want: T, msg: string) => check(JSON.stringify(got) === JSON.stringify(want), `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// A repeatable random source.
function lcg(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// --- time encoding (GenerateChallengeProgressionValue_004d9580 / decrypt_challenge_time) ---
{
  const r = lcg(7);
  for (const t of [60, 300, 1234, 25200, 35999]) {
    const enc = encodeChallengeTime(t, r);
    eq(decodeChallengeTime(enc), t, `time ${t} round trip`);
    const mask = enc >>> 16;
    let bits = 0;
    for (let x = mask; x; x &= x - 1) bits++;
    check(bits > 3 && bits < 13, `mask of ${t} has ${bits} bits`);
    eq(validTime(enc), t, `valid ${t}`);
  }
  eq(decodeChallengeTime(0x00010000), -1, 'a mask with one bit is not a time');
  eq(validTime(0), 0, 'an empty slot');
  eq(validTime(encodeChallengeTime(59, r)), 0, '59 s is below the range');
  eq(validTime(encodeChallengeTime(36000, r)), 0, '36000 s is out of the range');
  // Fallback mask 0x3938 when the random source never makes a plausible mask.
  eq(encodeChallengeTime(100, () => 0) >>> 16, 0x3938, 'fallback mask');
}

// --- rank text ----------------------------------------------------------------------------------
{
  const w = encryptRankText('Ra-GOU');
  eq(w[0], 'R'.charCodeAt(0) ^ 0x7f, 'first character is xor 0x7F');
  eq(w[1], ('a'.charCodeAt(0) - 'R'.charCodeAt(0)) ^ 0x7f & 0xffff, 'second character is the difference xor 0x7F');
  eq(decryptRankText(w), 'Ra-GOU', 'rank text round trip');
  eq(w[11], 0, 'the 12th word stays empty');
  eq(decryptRankText(encryptRankText('ABCDEFGHIJKLMNOP')), 'ABCDEFGHIJK', 'at most 11 characters');
  eq(colorTo1555(0xffff0000), 0x7c00, 'XRGB8888 to 1555');
  eq(colorFrom1555(0x7c00), 0xfff80000, '1555 to XRGB8888');
}

// --- packets -----------------------------------------------------------------------------------
{
  eq(dfCommand(5), 0x05df, 'DF 05 command');
  eq(buildDfExpMultiplier(1.5).length, 4, 'DF 04 payload');
  eq(buildDfRankText(0xffffffff, encryptRankText('S')).length, 0x1c, 'DF 05 payload (C_SetChallengeRankText_BB_05DF)');
  eq(buildDfRankThreshold(2, 25200, 4).length, 0x0c, 'DF 06 payload');
  eq(buildDfAwardItem(1, 2, new Uint8Array(20)).length, 0x1c, 'DF 07 payload');
  const t = buildSetChallengeTime(2, 0x12345678, 9);
  eq([t.length, t[0], t[1]], [0x14, 0x95, 5], '6x95 is 0x14 bytes');
  eq(parseSetChallengeTime(t), { clientId: 2, encodedTime: 0x12345678 }, '6x95 round trip');
  const f = buildFailureOption(1, true);
  eq([f.length, f[0], f[1]], [0x14, 0x97, 5], '6x97 is 0x14 bytes');
  eq(parseFailureOption(f), { clientId: 1, retry: true }, '6x97 round trip');
  const d = buildDeadFlag(3);
  eq([d.length, d[0], d[1]], [8, 0x9d, 2], '6x9D is 8 bytes');
  eq(parseDeadFlag(d), 3, '6x9D round trip');
  const rec = new ChallengeRecords();
  const r7c = buildChallengeRecords(2, rec.raw);
  eq([r7c.length, r7c[0], r7c[1]], [0x148, 0x7c, 0x52], '6x7C is 0x148 bytes');
  eq(parseChallengeRecords(r7c)?.clientId, 2, '6x7C client id');
  const g = buildGraveRecoveryRequest(1, 3, 7, 10.5, -4, 5);
  eq([g.length, g[0], g[1]], [0x14, 0xd1, 5], '6xD1 is 0x14 bytes');
  eq(new DataView(g.buffer).getUint32(0x10, true), 5, '6xD1 item type');
  eq(RECORDS_SIZE, 0x140, 'records size');
}

// --- the records ---------------------------------------------------------------------------------
{
  const r = new ChallengeRecords();
  eq(r.titleColor, 0x7fff, 'default title colour');
  r.setTimeRaw(1, 2, 0xdead);
  eq(new DataView(r.raw.buffer).getUint32(0x04 + (9 + 2) * 4, true), 0xdead, 'Episode 2 times follow the 9 Episode 1 ones');
  r.setAwardFlags(0, 3);
  eq(new DataView(r.raw.buffer).getUint32(0xf4, true), 3, 'ep1 online award state at 0xF4');
  r.setAwardFlags(1, 4);
  eq(new DataView(r.raw.buffer).getUint32(0xfc, true), 4, 'ep2 online award state at 0xFC');
  r.setMaxRank(0, 2, lcg(3));
  eq(r.maxRank(0), 2, 'max rank round trip');
  r.rankTitleWords = encryptRankText('Hero');
  eq(r.rankTitle, 'Hero', 'rank title at 0x10C');
  check(!r.hasGraveMessage(), 'no grave message');
  r.raw[0xa4] = 0x41;
  check(r.hasGraveMessage(), 'grave message at 0xA4');
}

// --- the character templates ---------------------------------------------------------------------------
{
  for (const [name, t] of [['hunter', CHALLENGE_HUNTER_TEMPLATES], ['ranger', CHALLENGE_RANGER_TEMPLATES], ['force', CHALLENGE_FORCE_TEMPLATES]] as const) {
    eq(t.length, 16, `${name} templates`);
    check(t.every((x) => x.items.every((i) => i.data.length === 32 && /^[0-9A-F]+$/.test(i.data))), `${name}: item data is 16 bytes of hex`);
    // 0..11 climb in level; 12..15 are the single-weapon templates (levels 0, 24, 50, 99).
    check(t.slice(0, 12).every((x, i) => i === 0 || x.level >= t[i - 1]!.level), `${name}: levels do not shrink`);
    eq(t.slice(12).map((x) => x.level), [0, 24, 50, 99], `${name}: levels of the last four`);
  }
  eq(CHALLENGE_HUNTER_TEMPLATES.slice(0, 4).map((x) => [x.level, x.items.length]), [[0, 5], [4, 8], [6, 8], [9, 10]], 'hunter template levels and item counts (PsoBB.exe 0x009af360)');
  eq(CHALLENGE_HUNTER_TEMPLATES[0]!.items[2]!.data, '02000500F4010000000000001200 0028'.replace(/ /g, ''), 'the starting mag (data2 as the exe stores it)');
  eq(CHALLENGE_HUNTER_TEMPLATES[0]!.items[0], { equipped: true, data: '00010000000000000000000000000000' }, 'a Saber');
  eq(CHALLENGE_FORCE_TEMPLATES[3]!.techs, [[0, 2], [3, 2], [13, 2], [10, 2]], 'force template 3 techniques (tech, level)');
  eq(CHALLENGE_FORCE_TEMPLATES[11]!.techs.length, 10, 'force template 11 techniques');
  eq(CHALLENGE_FORCE_TEMPLATES[12]!.techs, [[0, 0]], 'force template 12 keeps Foie');
  eq(CHALLENGE_HUNTER_TEMPLATES[12]!.techs, [], 'hunters have no techniques');
}

// --- S-rank weapon names --------------------------------------------------------------------------------
{
  const w = buildSRankWeapon(0x70, 'Abc DEFG', 0x00010005)!;
  eq([w[0], w[1]], [0, 0x70], 'S-rank weapon type bytes');
  const word = (i: number) => ((w[i * 2]! << 8) | w[i * 2 + 1]!) & 0xffff;
  eq(word(3) & 0x7fff, (1 << 10) | (1 << 5) | 2, 'first word: marker 1, A, B');
  eq(word(4) & 0x7fff, (3 << 10) | (0 << 5) | 4, 'second word: C, blank, D');
  eq(word(5) & 0x7fff, (5 << 10) | (6 << 5) | 7, 'third word: E, F, G');
  check((w[6]! & 0x80) !== 0 && (w[8]! & 0x80) !== 0 && (w[10]! & 0x80) !== 0, 'bit 15 set on every word');
  eq(new DataView(w.buffer).getUint32(12, true), 0x00010005, 'item id');
  eq(buildSRankWeapon(0x6f, 'X'), null, '0x6F is not an S-rank type');
  check(buildSRankWeapon(0xa5, 'X') !== null && buildSRankWeapon(0x88, 'X') !== null, 'edges of the type ranges');
}

// --- the mode itself (an Episode 1 game) --------------------------------------------------------------------
function makeEnv(extra: Partial<ChallengeEnv> = {}) {
  const sent: { sub: number; payload: Uint8Array }[] = [];
  const subs: Uint8Array[] = [];
  const records = new ChallengeRecords();
  const results: ChallengeResult[] = [];
  const prizes: Uint8Array[] = [];
  const rand = lcg(11);
  const env: ChallengeEnv = {
    isChallenge: () => true,
    episodeIndex: () => 0,
    clientId: () => 0,
    isLeader: () => true,
    sendDf: (sub, payload) => sent.push({ sub, payload }),
    sendSub: (b) => subs.push(b),
    presentClients: () => [0],
    isDead: () => false,
    records: () => records,
    random: rand,
    freeSlots: () => 10,
    addPrize: (i) => (prizes.push(i), true),
    newItemId: () => 0x00010010,
    showResult: (r) => results.push(r),
    ...extra,
  };
  return { env, sent, subs, records, results, prizes };
}

{
  const { env, sent } = makeEnv();
  const cm = new ChallengeMode(env);
  cm.setStage(3);
  eq([cm.stage, sent[0]?.sub], [3, 1], 'cmode_stage sends DF 01');
  cm.setStage(9);
  eq(cm.stage, 0, 'a stage at the stage count falls back to 0 (Episode 1 has 9)');
  cm.setTemplate(16);
  eq(cm.templateIndex, -1, 'template 16 is refused');
  cm.setTemplate(5);
  eq([cm.templateIndex, sent[sent.length - 1]?.sub], [5, 2], 'template sends DF 02');
  check(cm.setDifficulty(2) && cm.difficulty === 2, 'difficulty');
  // exp_multiplication: regs[0] + regs[1] / regs[2].
  check(cm.setExpMultiplier(1, 50, 100) && cm.expMultiplier === 1.5, '1 + 50/100 = 1.5');
  check(!cm.setExpMultiplier(1, 1, 0), 'a zero denominator is refused');
  check(!cm.setExpMultiplier(0, 0, 1), '0 is below the 0.01 minimum');
  check(!cm.setExpMultiplier(CM_EXP_MULTIPLIER_MAX + 1, 0, 1), 'above 10000');
  eq(cm.expMultiplier, 1.5, 'a refused multiplier leaves the old one');
  const dv = new DataView(sent.find((s) => s.sub === 4)!.payload.buffer);
  eq(dv.getFloat32(0, true), 1.5, 'DF 04 carries the float');
  // Only the leader sends.
  const { env: e2, sent: s2 } = makeEnv({ isLeader: () => false });
  const cm2 = new ChallengeMode(e2);
  cm2.setStage(2);
  cm2.setExpMultiplier(2, 0, 1);
  eq([s2.length, cm2.stage, cm2.expMultiplier], [0, 2, 2], 'a non-leader keeps the state and sends nothing');
}

{
  // Thresholds: B is forced to 35999 * stages, each next one must be smaller.
  const { env, sent } = makeEnv();
  const cm = new ChallengeMode(env);
  eq(cm.setRankThreshold(0, 356400, 1), 1, 'B accepted');
  eq(cm.thresholds[0]!.seconds, 35999 * 9, 'B is forced to 35999 * 9');
  eq(cm.setRankThreshold(1, 46800, 2), 1, 'A accepted');
  eq(cm.setRankThreshold(2, 25200, 4), 1, 'S accepted');
  eq(cm.setRankThreshold(2, 20000, 4), 0, 'a rank already set is refused');
  eq(sent.filter((s) => s.sub === 6).length, 3, 'three DF 06');
  const again = makeEnv().env;
  const cm3 = new ChallengeMode(again);
  eq(cm3.setRankThreshold(1, 2000, 2), 0, 'under 300 s per stage (2700) is refused');
  eq(cm3.setRankThreshold(3, 30000, 8), 0, 'rank 3 does not exist');
  cm3.setRankThreshold(1, 46800, 2);
  eq(cm3.setRankThreshold(2, 50000, 4), 0, 'S slower than A fails the ordering check');
}

{
  // Grave rates: 4 counts then 6 items; each >= 0, the groups sum to <= 1.
  const cm = new ChallengeMode(makeEnv().env);
  // 0.1 / 0.2 / 0.3 / 0.4 counts, six item rates 1/6.
  check(cm.setGraveRates([1, 2, 3, 4, 1, 1, 1, 1, 1, 1], [10, 10, 10, 10, 6, 6, 6, 6, 6, 6]), 'valid rates');
  eq(cm.graveRates.map((x) => Math.round(x * 100)), [10, 20, 30, 40, 17, 17, 17, 17, 17, 17], 'rates as fractions');
  check(!cm.setGraveRates([6, 6, 1, 1, 1, 1, 1, 1, 1, 1], [10, 10, 10, 10, 6, 6, 6, 6, 6, 6]), 'counts summing past 1 are refused');
  check(!cm.setGraveRates([-1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [10, 10, 10, 10, 6, 6, 6, 6, 6, 6]), 'a negative rate is refused');
  eq(cm.graveDrop(4, 0.05, 0.1), { count: 1, type: 0 }, 'roll under the first count and the first item');
  eq(cm.graveDrop(4, 0.25, 0.55), { count: 2, type: 3 }, 'roll 0.25 is two items; 0.55 is the fourth type');
  eq(cm.graveDrop(4, 0.95, 0.55), { count: 4, type: 3 }, 'roll 0.95 is four items');
  eq(cm.graveDrop(2, 0.95, 0.55), { count: 2, type: 3 }, 'capped by the players present');
  const half = new ChallengeMode(makeEnv().env);
  half.setGraveRates([1, 1, 0, 0, 1, 0, 0, 0, 0, 0], [4, 4, 1, 1, 2, 1, 1, 1, 1, 1]);
  eq(half.graveDrop(4, 0.9, 0.1), null, 'a roll past the counts (0.25 + 0.25) drops nothing');
  eq(half.graveDrop(4, 0.4, 0.9), null, 'a roll past the item rates (0.5) drops nothing');
  eq(half.graveDrop(4, 0.4, 0.4), { count: 2, type: 0 }, 'inside both');
  eq(cm.graveDrop(4, 0.5, 0.99)?.type ?? -1, 5, 'the last item type');
  const none = new ChallengeMode(makeEnv().env);
  none.setGraveRates([0, 0, 0, 0, 0, 0, 0, 0, 0, 0].map(() => 0), new Array<number>(10).fill(1));
  eq(none.graveDrop(4, 0.1, 0.1), null, 'all-zero rates drop nothing');
}

{
  // chl_set_timerecord / chl_get_timerecord with two players.
  const { env, subs } = makeEnv({ presentClients: () => [0, 1] });
  const cm = new ChallengeMode(env);
  eq(cm.getTimeRecord(), -1, 'nobody has a score yet');
  cm.setBaseTime(100);
  cm.setTimeRecord(600);
  eq(subs.length, 1, '6x95 sent');
  eq(parseSetChallengeTime(subs[0]!)?.clientId, 0, '6x95 carries our client id');
  const token = new DataView(subs[0]!.buffer, subs[0]!.byteOffset).getUint32(12, true);
  eq(token, (1 ^ (600 - 100)) >>> 0, 'token is (client id + 1) ^ (time - base time)');
  eq(cm.getTimeRecord(), -1, 'player 1 has no score yet');
  cm.receiveTimeRecord(1, encodeChallengeTime(900, lcg(5)));
  eq(cm.getTimeRecord(), 900, 'the slowest score');
  cm.receiveTimeRecord(1, encodeChallengeTime(200, lcg(5)));
  eq(validTime(cm.scores.get(1)!), 35999, 'an under-minimum score is stored as the 35999 s cap');
  eq(cm.getTimeRecord(), 35999, 'which is then the slowest');
  cm.receiveTimeRecord(1, encodeChallengeTime(400, lcg(5)));
  cm.setMinStageTime(500);
  eq(cm.getTimeRecord(), -2, 'a score under a raised minimum reads as invalid');
  cm.setMinStageTime(120);
  eq(cm.currentMinTime, 120, 'chl_set_min_time_online');
  cm.setMinStageTime(30);
  eq(cm.currentMinTime, 120, 'under 60 s is refused');
  cm.resetStage();
  eq(cm.getTimeRecord(), -1, 'reset_map clears the scores');
}

{
  // check_rank_time over a full Episode 1 (9 stages).
  const { env, records, sent, results } = makeEnv();
  const cm = new ChallengeMode(env);
  cm.setStage(8);
  cm.setRankResult(0xffffff, 'Ra-GOU');
  cm.setRankThreshold(0, 356400, 1);
  cm.setRankThreshold(1, 46800, 2);
  cm.setRankThreshold(2, 25200, 4);
  // Stages 0..7 are already cleared at 3000 s each; the last one is this run.
  for (let s = 0; s < 8; s++) records.setTimeRaw(0, s, encodeChallengeTime(3000, lcg(s + 1)));
  eq(cm.checkRankTime(3000), 1, 'total 27000 beats A (46800) but not S (25200): A is available');
  eq(cm.stageIndex, 1, 'stageIndex remembers the rank');
  eq(records.maxRank(0), 2, 'the best rank is saved');
  eq(records.time(0, 8), 3000, 'the stage time is saved');
  eq(records.rankTitle, 'Ra-GOU', 'the rank title is set on the first Episode 1 clear');
  eq(records.titleColor, colorTo1555(0xffffff), 'and its colour');
  // The prize.
  const prize = cm.createPrize([1, 2, 44, 0, 0, 0]);
  eq(prize, 1, 'item_create_cmode succeeds');
  eq(records.awardFlags(0), 2, 'the A award flag is marked');
  eq(sent[sent.length - 1]?.sub, 7, 'DF 07 sent');
  eq(cm.checkRankTime(3000), 0, 'a second clear: A is claimed, B (always met) is the prize left');
  cm.createPrize([1, 2, 46, 0, 0, 0]);
  eq(records.awardFlags(0), 3, 'B flag added');
  eq(cm.checkRankTime(3000), 4, 'everything claimed: no prize left');
  // S rank run.
  records.setTimeRaw(0, 8, 0);
  for (let s = 0; s < 8; s++) records.setTimeRaw(0, s, encodeChallengeTime(2000, lcg(s + 20)));
  eq(cm.checkRankTime(2000), 2, 'total 18000 meets S (25200)');
  eq(records.maxRank(0), 3, 'rank S saved');
  check(results.length >= 4, 'the result window was asked for each time');
  eq(results[0]!.runTime, 3000, 'result: this run');
  eq(results[0]!.total, 27000, 'result: the total uses this run for the stage');
  eq(results[0]!.previousBest, 0, 'result: no previous best');
  // An incomplete episode.
  const inc = makeEnv();
  const cm2 = new ChallengeMode(inc.env);
  cm2.setStage(0);
  cm2.setRankThreshold(0, 356400, 1);
  eq(cm2.checkRankTime(400), 3, 'only one stage cleared: no aggregate time (3)');
  // Not a Challenge game / no stage / no save file.
  eq(new ChallengeMode(makeEnv({ isChallenge: () => false }).env).checkRankTime(400), 6, 'outside Challenge mode');
  eq(new ChallengeMode(makeEnv().env).checkRankTime(400), 6, 'stage never set');
  eq(new ChallengeMode(makeEnv({ records: () => null }).env).checkRankTime(400), 6, 'no save file');
  // A full inventory.
  const full = makeEnv({ freeSlots: () => 0 });
  const cm3 = new ChallengeMode(full.env);
  cm3.setStage(8);
  cm3.setRankThreshold(0, 356400, 1);
  for (let s = 0; s < 8; s++) full.records.setTimeRaw(0, s, encodeChallengeTime(3000, lcg(s + 1)));
  eq(cm3.checkRankTime(3000), 5, 'inventory full: 5');
  // Invalid thresholds: S above the total range.
  const bad = makeEnv();
  const cm4 = new ChallengeMode(bad.env);
  cm4.setStage(8);
  cm4.setRankThreshold(1, 20000, 2);
  cm4.thresholds[2] = { seconds: 100, mask: 4 };
  for (let s = 0; s < 8; s++) bad.records.setTimeRaw(0, s, encodeChallengeTime(40, lcg(s + 1)));
  eq(cm4.checkRankTime(3000), 3, 'times under 60 s do not count as cleared stages');
}

{
  // The Episode 2 table: 5 stages.
  const { env, records } = makeEnv({ episodeIndex: () => 1 });
  const cm = new ChallengeMode(env);
  cm.setStage(5);
  eq(cm.stage, 0, 'Episode 2 has 5 stages');
  cm.setStage(4);
  eq(cm.setRankThreshold(1, 1400, 2), 0, 'Episode 2 minimum is 300 * 5 = 1500');
  eq(cm.setRankThreshold(1, 2000, 2), 1, '2000 s is fine');
  eq(cm.thresholds[0]!.seconds, 0, 'B stays unset until given');
  cm.setRankThreshold(0, 9999, 1);
  eq(cm.thresholds[0]!.seconds, 35999 * 5, 'B is 35999 * 5 in Episode 2');
  for (let s = 0; s < 4; s++) records.setTimeRaw(1, s, encodeChallengeTime(500, lcg(s + 3)));
  eq(records.total(1), 0, 'one Episode 2 stage missing');
  eq(records.time(0, 0), 0, 'Episode 1 slots are separate');
  records.setTimeRaw(1, 4, encodeChallengeTime(500, lcg(9)));
  eq(records.total(1), 2500, 'five Episode 2 stages');
}

{
  // Players dead: F826 / F827, the retry register.
  let dead = new Set<number>();
  const { env } = makeEnv({ presentClients: () => [0, 1], isDead: (i) => dead.has(i) });
  const cm = new ChallengeMode(env);
  eq([cm.allPlayersDead(), cm.anyPlayerDead()], [0, 0], 'nobody dead');
  dead.add(1);
  eq([cm.allPlayersDead(), cm.anyPlayerDead()], [0, 1], 'one dead');
  eq(cm.failed, true, 'a dead player flags the stage failed');
  dead = new Set([0, 1]);
  eq(cm.allPlayersDead(), 1, 'all dead');
  eq(cm.retryRegister, 0, 'stage id -1: not chosen yet');
  cm.setRankResult(0x112233, 'X');
  eq(cm.retryRegister, null, 'the rank colour sits in the shared id: the register is left alone');
  cm.openRetryMenu();
  cm.receiveRetry(true);
  eq(cm.retryRegister, 2, 'retry chosen: 2');
  cm.receiveRetry(false);
  eq(cm.retryRegister, 1, 'quit chosen: 1');
  cm.resetStage();
  eq([cm.failed, cm.stageId], [false, -1], 'reset_map clears the failure');
  eq(cm.retryRegister, 1, 'not failed reads as 1 (no)');
}

// --- the window texts ---------------------------------------------------------------------------------
{
  eq(timerText(0), `0'00"00`, 'timer text');
  eq(timerText(3723), `1'02"03`, 'timer 1:02:03');
  eq(timerText(40000), `9'59"59`, 'timer cap');
  eq(areaCounterText(2, 46), 'Area 02/46', 'area counter');
  const r: ChallengeResult = { stage: 0, episodeIndex: 0, runTime: 323, total: 0, previousBest: 0, oldTitle: '', newTitle: 'Ra-GOU', oldRank: 0, newRank: 0 };
  eq(resultLines(r), [`Clear Time < Stage 1 >`, `   0'05"23`, '    New Record', 'Title', '  Ra-GOU'], 'first clear');
  const r2: ChallengeResult = { ...r, stage: 8, runTime: 4000, total: 30000, previousBest: 4100, oldTitle: 'Ra-GOU', newTitle: 'Ra-GOU', oldRank: 1, newRank: 2 };
  const l2 = resultLines(r2);
  check(l2.includes('Total Time') && l2.includes(`  08'20"00`), `total time line ${JSON.stringify(l2)}`);
  check(l2.includes(`  -0'01"40  New Record`), `improvement line ${JSON.stringify(l2)}`);
  check(l2.includes('  B -> A'), `rank change line ${JSON.stringify(l2)}`);
  eq(resultLines({ ...r2, episodeIndex: 1 }).includes('Title'), false, 'no title line in Episode 2');
}

// --- the EXP multiplier in handle_experience ------------------------------------------------------------
eq(killExp(100, { episode2: false, killer: true, challenge: 1.5 }), 150, 'Challenge multiplier 1.5 on a 100 EXP kill');
eq(killExp(7, { episode2: false, killer: true, challenge: 2.5 }), 17, 'rounded before the division by 100 (7 * 100 * 2.5 = 1750 -> 17)');
eq(killExp(7, { episode2: false, killer: true, challenge: 1, multiplier: 3 }), 21, 'then the lobby multiplier');
eq(killExp(100, { episode2: true, killer: false }), 104, 'no Challenge multiplier: unchanged');

// --- graves -------------------------------------------------------------------------------------------
{
  const pts = graveDropPoints(100, 200, 0, 3);
  eq(pts.length, 3, 'a fan of three points');
  check(pts.every((p) => Math.abs(Math.hypot(p.x - 100, p.z - 200) - 7.5) < 1e-6), 'each 7.5 from the grave');
  const a0 = Math.atan2(pts[0]!.z - 200, pts[0]!.x - 100);
  eq(Math.round(((a0 * 0x10000) / (Math.PI * 2) + 0x10000) % 0x10000), 0x10000 - 0x2000, 'the fan starts at heading - (count - 1) * 0x1000');
  eq(graveDropPoints(0, 0, 0, 1).length, 1, 'one point');
  const rec = new ChallengeRecords();
  eq(recordGrave(rec), null, 'no grave before a death');
  saveGrave(rec, { episodeIndex: 1, stage: 3, floor: 5, x: 1, y: 2, z: 3, team: 'Party', defeatedByRt: 0x44, date: new Date(2026, 9, 20, 13, 45) });
  const g = recordGrave(rec)!;
  eq([g.episodeIndex, g.stage, g.floor, g.deaths, g.x, g.y, g.z, g.team], [1, 3, 5, 1, 1, 2, 3, 'Party'], 'grave fields');
  eq(new DataView(rec.raw.buffer).getUint32(0x68, true), 0xfa140d2d, 'packed date: the year caps at 15 (2015), then month 10, day 20, hour 13, minute 45');
  eq(new DataView(rec.raw.buffer).getUint32(0x6c, true), 0x44, 'defeated-by enemy');
  saveGrave(rec, { episodeIndex: 1, stage: 3, floor: 5, x: 1, y: 2, z: 3, team: 'Party', defeatedByRt: 0xffffffff, date: new Date(2026, 9, 20) });
  eq(recordGrave(rec)!.deaths, 2, 'a second death counts');
}

// --- the character template (needs PlyLevelTbl.prs) ----------------------------------------------------
{
  const tbl = [process.env.PLY_LEVEL_TBL, join(HERE, '../../PlyLevelTbl.prs'), join(process.env.HOME ?? '', 'Downloads/psobb-master/PlyLevelTbl.prs')].find((f) => f && existsSync(f));
  if (tbl) {
    const table = parsePlyLevelTbl(new Uint8Array(readFileSync(tbl)));
    const base: CharacterFile = {
      name: 'Test',
      guildCardNumber: 1,
      charClass: 0,
      sectionId: 0,
      level: 50,
      exp: 99999,
      meseta: 1234,
      stats: { atp: 1, mst: 2, evp: 3, hp: 4, dfp: 5, ata: 6, lck: 7, esp: 8 },
      hpFromMaterials: 5,
      tpFromMaterials: 4,
      inventory: [],
      bank: { meseta: 0, items: [] },
      techLevels: new Array<number | null>(19).fill(5),
      playTimeSeconds: 0,
      deathCount: 0,
      guildCard: { number: 1, name: '', teamName: '', description: '', language: 1 },
      infoBoard: '',
      autoReply: '',
      teamName: '',
    };
    let id = 0x00010000;
    const o = buildChallengeOverlay(base, 3, table, () => id++);
    eq(o.level, 10, 'template 3 of a HUmar is level 9 (displayed 10)');
    eq(o.inventory.length, 10, 'ten items');
    eq(o.inventory.map((i) => i.data.id), Array.from({ length: 10 }, (_, i) => 0x00010000 + i), 'consecutive ids');
    eq(o.inventory.filter((i) => i.equipped).length, 4, 'weapon, frame, barrier and mag equipped');
    eq([o.stats.esp, o.meseta, o.hpFromMaterials, o.tpFromMaterials], [40, 0, 0, 0], 'ESP 40, no Meseta, no materials');
    eq(o.exp, table.expForLevel(0, 9), 'EXP at the level threshold');
    let atp = table.base[0]!.atp;
    for (let l = 1; l <= 9; l++) atp += table.delta(0, l).atp;
    eq(o.stats.atp, atp, 'ATP = base + the gains of levels 1..9');
    check(o.techLevels.every((x) => x === null), 'a hunter learns no technique');
    eq(base.level, 50, 'the original is not touched');
    // A force keeps its template techniques.
    const f = buildChallengeOverlay({ ...base, charClass: 6 }, 3, table, () => id++);
    eq(f.techLevels.slice(0, 14).map((x) => x ?? 0), [3, 0, 0, 3, 0, 0, 0, 0, 0, 0, 3, 0, 0, 3], 'force template 3: Foie, Barta, Deband, Shifta at level 3 (displayed)');
    eq(challengeTemplate(6, 0).items[0]!.data.slice(0, 4), '000A', 'a force starts with a Cane (data1 00 0A)');
    // Live character: applied in place; the raw save follows.
    const live: CharacterFile = structuredClone(base);
    applyOverlay(live, o);
    eq([live.level, live.inventory.length, live.stats.atp], [10, 10, atp], 'applied in place');
    const raw = new Uint8Array(0x3994);
    writeOverlayRaw(live, raw);
    eq(raw[0], 10, 'raw: 10 items');
    eq(new DataView(raw.buffer).getUint32(0x34c + 0x18, true), 9, 'raw: level 9');
    eq(raw[0x34c + 0x17c], 0xff, 'raw: Foie unlearned for a hunter');
    eq(new DataView(raw.buffer).getUint32(4 + 0x1c + 20, true), 0x00010001, 'raw: item 1 id');
  } else {
    console.log('SKIP the template overlay (no PlyLevelTbl.prs)');
  }
}

// --- the quests through the VM ------------------------------------------------------------------------
const newserv = [process.env.NEWSERV, join(HERE, '../vendor/newserv'), join(HERE, '../../../../vendor/newserv')].find((d) => d && existsSync(join(d, 'system/quests')));
if (newserv) {
  const load = (p: string) => prsDecompress(new Uint8Array(readFileSync(p)));
  const open = (dir: string, name: string) => {
    const bin = load(join(newserv, 'system/quests', dir, `${name}-bb-e.bin`));
    const dat = load(join(newserv, 'system/quests', dir, `${name}-bb.dat`));
    const lq: LoadedQuest = { name, binFilename: `${name}-bb-e.bin`, datFilename: `${name}-bb.dat`, bin, dat, binCompressedSize: 0, datCompressedSize: 0, download: false };
    return lq;
  };
  // Stage 1 of Episode 1: the opening sets everything up.
  {
    const { env, sent } = makeEnv();
    const s = new QuestSession(open('challenge-ep1', 'c88101'), { log: () => {}, host: { cmode: env } });
    s.start();
    for (let i = 0; i < 60; i++) s.vm.frame();
    const cm = s.vm.cmode;
    eq(cm.stage, 0, 'c88101: stage 0');
    eq(cm.difficulty, 0, 'c88101: difficulty 0');
    eq(cm.expMultiplier, 1.5, 'c88101: 1 + 50/100 EXP');
    eq(cm.rankText, 'Ra-GOU', 'c88101: rank text');
    eq(cm.thresholds.map((t) => t.seconds), [323991, 46800, 25200], 'c88101: thresholds (B forced to 35999 * 9)');
    eq(cm.thresholds.map((t) => t.mask), [1, 2, 4], 'c88101: award masks');
    eq(cm.graveRates.map((x) => Math.round(x * 100)), [20, 20, 20, 20, 33, 1, 1, 33, 1, 1], 'c88101: grave rates from the pairs');
    eq(sent.map((x) => x.sub).slice(0, 7), [1, 3, 4, 5, 6, 6, 6], 'c88101: DF 1, 3, 4, 5, 6, 6, 6 in order');
    eq(s.vm.unimplemented.has('cmode_stage') || s.vm.unimplemented.has('set_cmode_grave_rates'), false, 'no Challenge opcode is skipped');
    eq(s.vm.areaTotal, 46, 'c88101: 46 areas in total');
  }
  // Every Challenge quest runs without skipping a Challenge opcode.
  for (const [dir, names] of [['challenge-ep1', 9], ['challenge-ep2', 5]] as const) {
    for (let n = 1; n <= names; n++) {
      const name = `c88${dir === 'challenge-ep1' ? '1' : '2'}${String(n).padStart(2, '0')}`;
      if (!existsSync(join(newserv, 'system/quests', dir, `${name}-bb-e.bin`))) continue;
      const { env } = makeEnv({ episodeIndex: () => (dir === 'challenge-ep1' ? 0 : 1) });
      const s = new QuestSession(open(dir, name), { log: () => {}, host: { cmode: env } });
      s.start();
      for (let i = 0; i < 600; i++) s.vm.frame();
      const skipped = [...s.vm.unimplemented.keys()].filter((k) => /cmode|chl_|rank|award|grave|exp_mult|kills/.test(k));
      eq(skipped, [], `${name}: no Challenge opcode skipped`);
      check(s.vm.cmode.thresholds.every((t) => t.seconds > 0), `${name}: all three thresholds set`);
    }
  }
}

console.log(failures ? `FAILED (${failures} problems)` : 'OK');
process.exit(failures ? 1 : 0);

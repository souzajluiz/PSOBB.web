// The grave of Challenge Mode: the text that floats over it, its fade and its
// heading (PsoBB.exe, Ephinea 1.25.13 Ghidra dump names; VAs are the exe's).
// Pure: no DOM, no three.js (quest/cmoderun.ts places the text, quest/questui.ts
// draws it).

import { ENEMY_TYPE_NAMES } from '../formats/entitynames.ts';
//
// The grave is a ChallengeEntityProgress object, one per player whose record
// (quest/cmode.ts `saveGrave`) matches this stage and floor:
//   ChallengeEntityProgress_Constructor_004dedfc   object +0xac = slot, +0xc0..0x144
//                                                  = the record's 0x60..0xe4 (the
//                                                  exe copies 0x84 bytes; the object
//                                                  is 0x38c long), +0x38 = position,
//                                                  +0x60 = slot << 13 (the heading)
//   UpdateChallengeUI_004df408                     the six lines at +0x144 + n * 0x60
//   UpdateGraveChallengeSubPanel_004de304          the text is drawn when
//                                                  CanProcessGraveChallenge_004de810 (the
//                                                  distance b0 <= 500, 0x00909cc0)
//   UpdateChallengePlayerGraveDistance_004de164    the fade (object +0xb4)

// The killer. SaveChallengeEntityProgressOnDeath_004d9a60 stores the last attacker
// enemy's enemy_name_unitxt_index (enemy +0x378) as the record's monster id, and
// "Defeated by %s." is unitxt_get_monster_name(id) when id > 0 (0xffffffff: none).
// The exe writes +0x378 only through the setter at 0x00787550 (`mov [ecx+0x378],
// eax; ret 4`, 72 call sites, read from the disassembly with their immediates) and
// through forwarders that pass the id on (0x00520390 and the like). The ids below
// are the immediates of those calls, reached from each type's creator in the
// per-area spawn table at 0x009fa000 (type code -> create function) by call depth 2.
// Dump: the same calls appear as set_enemy_name_unitxt_index(this, N) (.c:762775).
// A kind with no entry here shows no killer line (the exe's own 0xffffffff), because
// its index is not decoded yet (see the DEVLOG "Left" list).
export const GRAVE_NO_KILLER = 0xffffffff;

export const GRAVE_KILLER_INDEX: Readonly<Record<string, number>> = {
  // InitializeHildebearResources_005157e0 (0x005157e0, calls at 0x005157ff / 0x00515841 with 2,
  // 0x00515874 with 1): 2 when the set's param6 >= 1 or is_monster_rare, else 1.
  HILDEBEAR: 1,
  HILDEBLUE: 2,
  // monest ctor (0x005191c0 forwards 4 through 0x00520390).
  MONEST: 4,
  // savage_wolf_constructor (0x0051b2e8): 8 when the wolf subtype (+0x3e0) is not 0, else 7.
  SAVAGE_WOLF: 7,
  BARBAROUS_WOLF: 8,
  // set_booma_name_unitxt_index (dump .c:319613): subtype 0 / 1 / 2 -> 9 / 10 / 11.
  BOOMA: 9,
  GOBOOMA: 10,
  GIGOBOOMA: 11,
  // grass assassin ctor (0x005249c8 with 12).
  GRASS_ASSASSIN: 12,
  // PoisonLilyConstructor_005293ac (0x005293ac): the tower (0x800 flag) 0x53; else
  // LilyIsRareOrDel ? 0xe : 0xd. DEL_LILY is the tower's lily.
  POISON_LILY: 13,
  NAR_LILY: 14,
  DEL_LILY: 83,
  // nanodragon ctor (0x0057f6b0 with 15).
  NANO_DRAGON: 15,
  // SetBoomaSubtype_00512f94 (the shark's, dump name notwithstanding): subtype 0 / 1 / 2 -> 16 / 17 / 18.
  EVIL_SHARK: 16,
  PAL_SHARK: 17,
  GUIL_SHARK: 18,
  // panarms ctor (0x00582e38 with 21).
  PAN_ARMS: 21,
  // gilchic_constructor (0x00556600): param6 == 0 -> 24, else 50.
  DUBCHIC: 24,
  GILLCHIC: 50,
  // set_sinowbeat_subtype (0x0058d660 forwards 26 / 27): 27 when initdata_param2 >= g_SinowbeatSubtypeThreshold.
  SINOW_BEAT: 26,
  SINOW_GOLD: 27,
  // canadine ctor (0x005424d8 forwards 28).
  CANADINE: 28,
  // delsaber ctor (0x0055018c with 30).
  DELSABER: 30,
  // dark gunner (0x00545e54 with 34).
  DARK_GUNNER: 34,
  // chaos bringer (0x0053cd38 forwards 36), dark belra (0x005394ec forwards 37).
  CHAOS_BRINGER: 36,
  DARK_BELRA: 37,
  // SetDimenianDifficulty_005520f8: difficulty 0 / 1 / 2 -> 41 / 42 / 43.
  DIMENIAN: 41,
  LA_DIMENIAN: 42,
  SO_DIMENIAN: 43,
  // The Rappy family: the ids are the monster name indices (equal to each kind's rt). The
  // episode / seasonal / rare table is RAPPY_UNITXT_IDS (below), the kinds' rows follow it.
  RAG_RAPPY: 5,
  AL_RAPPY: 6,
  LOVE_RAPPY: 51,
  SAINT_RAPPY: 79,
  HALLO_RAPPY: 80,
  EGG_RAPPY: 81,
  SAND_RAPPY_CRATER: 104,
  SAND_RAPPY_DESERT: 104,
  DEL_RAPPY_CRATER: 105,
  DEL_RAPPY_DESERT: 105,
  // garanz_constructor (0x56f8f4): push 0x19 at 0x56faa6, setter call 0x56fb06, unconditional.
  GARANZ: 25,
  // CananeConstructor_00541ae0: push 0x1d, then 0x520390 (the id forwarder) at 0x541b44.
  CANANE: 29,
  // The Chaos Sorcerer (0x59d8b8): push 0x1f at 0x59d956, forwarder call 0x59d958, unconditional.
  CHAOS_SORCERER: 31,
  // The Pofuilly (0x5997c8): [this+0x3fc] (the rare flag) == 0 -> push 0x13 (0x599984),
  // else push 0x14 (0x59998f).
  POFUILLY_SLIME: 19,
  POUILLY_SLIME: 20,
  // InitializeEnemyBase_00535818 (the Claw): push 0x26 at 0x53588b, setter 0x5358c0, unconditional.
  CLAW: 38,
  // BulclawHandleClawAction_00532960: param_2 == 1 -> push 0x28 (0x532ceb), else 0x27 (0x532975).
  BULK: 39,
  BULCLAW: 40,
  // The Vol Opt parts: 0x2e in six straight-line setter sites (0x44050a, 0x442186, 0x443f99,
  // 0x44927e, 0x449d8b, 0x441477; the first five checked in the disassembly).
  VOL_OPT_2: 46,
  VOL_OPT_1: 46,
  VOL_OPT_AMP: 46,
  VOL_OPT_CORE: 46,
  VOL_OPT_MONITOR: 46,
  VOL_OPT_PILLAR: 46,
  // Dark Falz forms 1 / 2 / 3: 0x2f, unconditional, in FUN_004570b0 (call 0x457259, sub-object 0x36 = battleparams
  // DarkFalzForm1), FUN_004598d0 (call 0x459a7b, 0x37 = Form2), FUN_0045e5a0 (call 0x45e743, 0x38 = Form3).
  DARK_FALZ_1: 47,
  DARK_FALZ_2: 47,
  DARK_FALZ_3: 47,
  // Olga Flow (both forms): 0x4e, unconditional, at 0x497719 (form 1) and 0x49d495 (form 2).
  OLGA_FLOW_1: 78,
  OLGA_FLOW_2: 78,
  // Gal Gryphon (0x4a6971 via 0x520390, unconditional).
  GAL_GRYPHON: 77,
  // Epsilon (0x558627), Epsigard (0x55c26c, via 0x520390), Astark (0x5a41b1): unconditional.
  EPSILON: 84,
  EPSIGARD: 87,
  ASTARK: 88,
  // Yowie / Satellite Lizard (0x5ae848): [this+0x3ec] != 0 -> 89 (Yowie) at 0x5ae98b, else 90 at 0x5ae994.
  // +0x3ec = (the spawn record's dword +0x2c, copied to this+0x360, as a float >= 1.0), written by the
  // helper 0x5aec2c (0x5aec6f / 0x5aec9a). PROVEN chain; the set-file index of the record is not traced.
  YOWIE_CRATER: 89,
  YOWIE_DESERT: 89,
  SATELLITE_LIZARD_CRATER: 90,
  SATELLITE_LIZARD_DESERT: 90,
  // Merissa (0x5b6ebc): [this+0x380] != 0 -> 92 (AA), else 91 (A). +0x380 = P(this.word+0x2c) ? 1 : (record word +0x3c & 1)
  // (setter 0x5b6ea0, sole caller 0x5b6ca5). PROVEN formula; the table P (0x813038, runtime data) is not read.
  MERISSA_A: 91,
  MERISSA_AA: 92,
  // Zu / Pazuzu (0x5b4884): the ctor's esi != 0 -> 95 (Pazuzu) at 0x5b4ae0, else 94 (Zu) at 0x5b4aeb.
  // The flag is +0x504 (esi at 0x5b4a9b): (record word +0x3c & 1) OR P(this.word+0x2c) (writers 0x5b4981, 0x5b4cef).
  // PROVEN formula; P (a 16-word table at *[0xab0248]) is runtime data, not read.
  ZU_CRATER: 94,
  ZU_DESERT: 94,
  PAZUZU_CRATER: 95,
  PAZUZU_DESERT: 95,
  // Dorphon (0x5a9c58): [this+0x4d8] != 0 -> 100 (Eclair) at 0x5a9d71, else 99 at 0x5a9d7c.
  // The flag is set in the Dorphon's init (0x5a6eff: 1 or 0, from the branch at 0x5a6ee0).
  DORPHON: 99,
  DORPHON_ECLAIR: 100,
  // Goran family (0x5adf28): the subtype (+0x33c, clamped to >= 0): 2 -> 102 (0x5adf59),
  // 1 -> 103 (0x5adf70), else 101 (0x5adf82).
  GORAN: 101,
  GORAN_DETONATOR: 102,
  PYRO_GORAN: 103,
  // Sinow Zoa / Zele (0x591c48): [this+0x408] > 0 -> 70 (Zele) at 0x591c60, else 69 (Zoa) at 0x591c86.
  // +0x408 = [this+0x370] (record word +0x3c) via method 0x591658 (writer 0x5916ef) on the 0x5915b4 path PROVEN; the 0x595240 path ASSUMED.
  SINOW_ZOA: 69,
  SINOW_ZELE: 70,
  // Sinow Spigell / Berill (0x59e844): [this+0x3f8] > 0 -> 63 (Spigell) at 0x59e858, else 62 (Berill) at 0x59e882.
  // +0x3f8 = [this+0x370] (record word +0x3c) via method 0x59e1a4 (writer 0x59e23b) on the 0x59e100 path PROVEN; the 0x5a1bf4 caller ASSUMED.
  SINOW_SPIGELL: 63,
  SINOW_BERILL: 62,
  // The Sorcerer's bees (0x59ae6c): [this+0x3d0] == 1 -> 32 (Bee L) at 0x59af88, else 33 (Bee R) at 0x59aee9.
  BEE_L: 32,
  BEE_R: 33,
  // Gee (0x55fc5c, unconditional), Gi Gue (0x56c188, unconditional).
  GEE: 54,
  GI_GUE: 55,
  // Mericarol family (0x572c00): [this+0x464] 0 -> 56 (0x572ddb), 1 -> 57 (Merikle, 0x572dbe), 2 -> 58 (Mericus, 0x572dcf).
  MERICAROL: 56,
  MERIKLE: 57,
  MERICUS: 58,
  // Gibbon family (0x564a64): the flag is +0x46c = ([this+0x370] > 0) (writer 0x564f00 / 0x564f2d, method 0x564e98); != 0 -> 60
  // (Zol Gibbon, 0x564c15), else 59 (Ul Gibbon). PROVEN writer; the source of +0x370 (record word +0x3c, via callees not traced) is ASSUMED.
  ZOL_GIBBON: 60,
  UL_GIBBON: 59,
  // Gibbles (0x563200, unconditional).
  GIBBLES: 61,
  // Merillia family (0x576240): the subtype (+0x33c, clamped to >= 0) == 1 -> 53 (Merilltas, 0x576271), else 52 (Merillia, 0x576283).
  MERILLIA: 52,
  MERILTAS: 53,
  // Delbiter (0x54d8c8, unconditional at 0x54d9a2).
  DELBITER: 72,
  // Ill Gill (0x52e4b3, unconditional).
  ILL_GILL: 82,
  // Morfos (0x57c96c, unconditional), Recobox (0x5886e5, unconditional).
  MORFOS: 66,
  RECOBOX: 67,
  // Boota family (0x5a602c): the variant (eax) == 1 -> 97 (Ze Boota, 0x5a6074), else 96 (Boota, 0x5a6086).
  // The variant is this+0x33c (clamped to 0..2 by the ctor), written from this+0x370 = record word +0x3c (creator 0x5a5cd4,
  // record init 0x786848). PROVEN; eax is not the flag.
  BOOTA: 96,
  ZE_BOOTA: 97,
  // Dolmolm / Dolmdarl (0x553fc8; the dump's name InitializeRappyEntity is wrong): [this+0x370] < 1 -> 64 (push at
  // 0x553fd6, set_enemy_name 0x787550), else 65 (push at 0x553ff9). The flag is the set's param6 (setdata 0xdd).
  DOLMOLM: 64,
  DOLMDARL: 65,
  // Mothmant (ctor FUN_00518bfc, 0x518bfc; the dump has no name for it, ASSUMED from the id): push 3 at 0x518c96, forwarder
  // call 0x518c9a, unconditional.
  MOTHMANT: 3,
  // Hidoom / Migium (ctor FUN_00586bf8, 0x586bf8): [this+0x388] == 0 -> 23 (Hidoom, push at 0x586e52, sub-object 0x32),
  // else 22 (Migium, push at 0x586e5b, 0x33). The test is at 0x586e4e / jne 0x586e5b.
  HIDOOM: 23,
  MIGIUM: 22,
  // Girtablulu (ctor FUN_005aba28, 0x5aba28): push 0x5d at 0x5abbd7, forwarder call 0x5abc24, unconditional.
  GIRTABLULU: 93,
  // Not in the table, so no killer line: DUBWITCH (ctor 0x618ae4 has no setter call, and the enemy base ctor 0x7865e8
  // zeroes +0x378 at 0x78663d). Olga's sub-object (ctor 0x48a4b0, vtable 0xaf8c40) names 85 (0x55), or 86 (0x56)
  // when [this+0x38c] == 1 (cmp at 0x48a661). The value is the loop index of its only creator (0x48a400, called
  // from 0x49da9b in the form 2 builder): the index is stored at the creator's [ebp-0x7c] (0x49da71 mov, edi = 0 / 1),
  // which is the struct field +0x54 the ctor reads. So index 0 is 85 and index 1 is 86 (PROVEN, objdump). No port kind
  // has those ids, and it is not traced that this minion is the last attacker a grave records: nothing is keyed.
};

// The Rappy family's unitxt ids (the exe's `rappy_unitxt_ids`, 24 int32 at 0x00921a00 in .data,
// read with tools/exedata.py). init_ragrappy_global_config_bp (0x005279e8) copies
// index 8 * episode + 2 * seasonal + rare into rappy_loaded_unitxt_ids (0x00a72f54 + 4 * rare),
// and ragrappy_constructor names the enemy with rappy_loaded_unitxt_ids[rare].
// episode: 0 Ep1, 1 Ep2, 2 Ep4. seasonal: 0 outside the lobby; in the lobby (scene logged_in,
// InitRappyGlobalConfig_00527973 at 0x00527973) null_ARRAY_00921ae0[g_SeasonalEvent], which the
// exe holds as 0, 1, 0, 0, 2, 3 (ASSUMED: the field load's seasonal index is 0).
export const RAPPY_UNITXT_IDS: readonly number[] = [
  5, 6, 5, 6, 5, 6, 5, 6, // Ep1: Rag Rappy / Al Rappy (rare)
  5, 51, 5, 79, 5, 81, 5, 80, // Ep2: Rag / Love (rare), Rag / Saint, Rag / Egg, Rag / Hallo
  104, 105, 104, 105, 104, 105, 104, 105, // Ep4: Sand Rappy / Del Rappy (rare)
];

// The unitxt id of a Rappy: rare is the enemy's param6 / is_monster_rare flag.
export function rappyKillerId(episode: number, seasonal: number, rare: boolean): number {
  return RAPPY_UNITXT_IDS[8 * episode + 2 * seasonal + (rare ? 1 : 0)] ?? GRAVE_NO_KILLER;
}

// The monster id of a killer kind (GRAVE_NO_KILLER when the kind has none).
export function graveKillerId(enemyType: string | null): number {
  if (enemyType === null) return GRAVE_NO_KILLER;
  return GRAVE_KILLER_INDEX[enemyType] ?? GRAVE_NO_KILLER;
}

// The port's name of a monster id: the first kind with that id in ENEMY_TYPE_NAMES, without
// its variant in brackets ("Yowie (crater)" -> "Yowie"; unitxt names carry no variant, the
// exe's monster name is the same for the crater and desert forms). Null when no kind has it.
export function graveKillerBaseName(kind: string): string {
  return ENEMY_TYPE_NAMES[kind]![0].replace(/ \([^)]*\)$/, '');
}
const KILLER_NAME_BY_ID = new Map<number, string>();
for (const [key, id] of Object.entries(GRAVE_KILLER_INDEX)) {
  if (!KILLER_NAME_BY_ID.has(id)) KILLER_NAME_BY_ID.set(id, graveKillerBaseName(key));
}

// The killer's name, null when there is none (the exe shows the line only for id > 0).
export function graveKillerName(id: number): string | null {
  const sid = id | 0;
  if (sid <= 0) return null;
  return KILLER_NAME_BY_ID.get(sid) ?? null;
}

// The grave's model: the tomb / rebirth-mark archive the object loader reads
// (LoadBML_005b7a84 with g_pRebirthMarkBaseBMLPath, 0x005089ec "re_b_mark_base.bml";
// `unknown_challenge_related`, 0x00622d14 area). ASSUMED: the name has no directory
// prefix. It is not in the local data set, so the model is not drawn yet.
export const GRAVE_MODEL_BML = 're_b_mark_base.bml';

// Text fade (UpdateChallengePlayerGraveDistance_004de164): a line fades in while
// the local player is within this XZ distance (0x00909c94) and nearer to this
// grave than to any other (the nearest other grave starts at 50, 0x00909dc0).
export const GRAVE_TEXT_RANGE = 50;
export const GRAVE_NEAREST_START = 50;
export const GRAVE_FADE_IN = 0.13333334; // 0x00909c90, per game tick
export const GRAVE_FADE_OUT = -0.044444446; // 0x00909c8c, per game tick
// The text is drawn while the local player is within this distance (0x00909cc0).
export const GRAVE_DRAW_RANGE = 500;
// The spacing of the six lines in the 640x480 space (0x00909c9c).
export const GRAVE_LINE_STEP = 25;
// The grave's game ticks are 30 a second (ASSUMED: the exe's frame rate here).
export const GRAVE_TICK_MS = 1000 / 30;
// Where the text starts above the grave's position (the exe adds
// g_GraveChallengeTextYOffset, not located; ASSUMED 2.0).
export const GRAVE_TEXT_HEIGHT = 2;

// The heading of a grave: the owner's slot << 13 (BAMS; ProcessGraveChallengePlayerLogic
// passes it to the drop fan, which starts at heading - (count - 1) * 0x1000).
export function graveHeading(slot: number): number {
  return (slot << 13) & 0xffff;
}

// The unitxt strings of group 12 the lines use (the port's English text, the
// Ephinea collection of unitxt_j.prs at 0x4c / 0x4d / 0x4e).
export interface GraveStrings {
  partyName: string; // 0x4c, "Party Name : " then the party name ("%s%s")
  failed: string; // 0x4d, "Number of times failed : " then the count ("%s%d")
  defeatedBy: string; // 0x4e, "Defeated by %s." (the killer's name)
}
export const GRAVE_STRINGS_EN: GraveStrings = {
  partyName: 'Party Name : ',
  failed: 'Number of times failed : ',
  defeatedBy: 'Defeated by %s.',
};

// The packed date of a grave (the record's u32 at 0x68): year - 2000 in the top
// 4 bits, then month (4), day (5), hour (5), minute (6). The exe stores 15 for
// every year from 2015 on, and its reader rejects 15 (FormatChallengeTimestamp_004df250),
// so a grave saved in 2015 or later shows no date.
export interface GraveDate {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function decodeGraveDate(packed: number): GraveDate | null {
  const v = packed >>> 0;
  const yy = (v >>> 28) & 0xf;
  const month = (v >>> 24) & 0xf;
  const day = (v >>> 16) & 0x1f;
  const hour = (v >>> 8) & 0x1f;
  const minute = v & 0x3f;
  if (yy === 0xf || month === 0 || month >= 13 || day === 0 || day >= 0x20 || hour >= 0x18 || minute >= 0x3c) return null;
  return { year: 2000 + yy, month, day, hour, minute };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

// The timestamp line: "%d/%02d/%02d %02d:%02d" (year first) when the locale is 0,
// "%02d/%02d/%d %02d:%02d" (month first) otherwise (0x00909e34 / 0x00909e64).
export function formatGraveDate(d: GraveDate, locale = 0): string {
  const hm = `${pad2(d.hour)}:${pad2(d.minute)}`;
  if (locale === 0) return `${d.year}/${pad2(d.month)}/${pad2(d.day)} ${hm}`;
  return `${pad2(d.month)}/${pad2(d.day)}/${d.year} ${hm}`;
}

export interface GraveTextInput {
  // The name of the player in the owner's slot, null when that player is not
  // here (the exe then leaves line 0 empty).
  owner: string | null;
  deaths: number;
  team: string;
  message: string;
  // The killer's name, null when there is none (the record's 0xffffffff).
  defeatedBy: string | null;
  // The packed date, given only for the local player's own grave (the exe's
  // timestamp is for the local slot alone).
  date: number | null;
  locale?: number;
  strings?: GraveStrings;
}

// The six lines of a grave (UpdateChallengeUI_004df408 and the Format* helpers),
// top to bottom; an empty string is a line the exe leaves blank.
export function graveLines(i: GraveTextInput): string[] {
  const s = i.strings ?? GRAVE_STRINGS_EN;
  const lines = ['', '', '', '', '', ''];
  if (i.owner !== null) lines[0] = `< ${i.owner.replace(/ +$/, '')} >`;
  lines[1] = `${s.failed}${i.deaths}`;
  if (i.team !== '') lines[2] = `${s.partyName}${i.team}`;
  if (i.defeatedBy !== null) lines[3] = s.defeatedBy.replace('%s', i.defeatedBy);
  if (i.message !== '') lines[4] = `"${i.message}"`;
  if (i.date !== null) {
    const d = decodeGraveDate(i.date);
    if (d) lines[5] = formatGraveDate(d, i.locale ?? 0);
  }
  return lines;
}

// One game tick of a grave's text fade. `distToThis` is the local player's XZ
// distance to this grave (null with no local player); `nearestOther` the
// smallest such distance to another grave (GRAVE_NEAREST_START when there is
// none); `isLocalOwner` whether the grave is the local player's own.
export function graveFadeStep(fade: number, distToThis: number | null, nearestOther: number, isLocalOwner: boolean): number {
  if (distToThis !== null && nearestOther <= distToThis && (distToThis !== nearestOther || !isLocalOwner)) {
    return fadeOut(fade);
  }
  const b0 = distToThis ?? Infinity;
  return b0 < GRAVE_TEXT_RANGE ? fadeIn(fade) : fadeOut(fade);
}

function fadeIn(fade: number): number {
  const v = GRAVE_FADE_IN + fade;
  return v > 1 ? 1 : v;
}

function fadeOut(fade: number): number {
  const v = GRAVE_FADE_OUT + fade;
  return v >= 0 ? v : 0;
}

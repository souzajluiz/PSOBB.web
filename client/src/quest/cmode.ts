// Challenge Mode, as PsoBB.exe runs it: the state the quest opcodes build up
// (stage, character template, difficulty, EXP multiplier, rank thresholds and
// text, grave rates), the rules that turn a stage time into a rank and a
// prize, the player's saved challenge records, and the packets the client
// sends (DF subcommands 1..7, ED 08, 6x7C, 6x95, 6x97, 6x9D, 6xD1).
//
// Sources, in order: PsoBB.exe (the Ghidra dump at refsrc/original-psobb-client-source,
// names there are often wrong; matched by callees and constants), then newserv
// (src/QuestScript.cc opcode notes, src/ReceiveCommands.cc on_DF_BB,
// src/PlayerSubordinates.hh PlayerRecordsChallengeBB). Where the dump's
// addresses are cited they are the Ephinea 1.25.13 ones.
//
//   F820 cmode_stage              send_packet0xdf_subcommand1   -> DF 01
//   F823 set_cmode_char_template  SendPacket0xDFSubcommand2     -> DF 02
//   F824 set_cmode_difficulty     send_packet0xdf_subcommand3   -> DF 03
//   F825 exp_multiplication       send_packet0xdf_subcommand4   -> DF 04
//   F864 set_cmode_rank_result    send_packet0xdf_subcommand5   -> DF 05
//   F868 set_cmode_rank_threshold send_packet0xdf_subcommand6   -> DF 06
//   F86A item_create_cmode        send_packet0xd_subcommand7    -> DF 07
//   F869 check_rank_time          ProcessChallengeStage_004da994 -> ED 08
//
// Every DF is sent by the leader only (g_CurrentPlayerSlotIndex ==
// g_PartyLeaderIdx); the state is kept on every client.

// --- tables from the exe ---------------------------------------------------------

// Stage counts by episode index (0 = Episode 1, 1 = Episode 2, 2 = Episode 1
// offline), uint32_t_ARRAY_009098b0.
export const CM_STAGE_COUNT: readonly number[] = [9, 5, 9];
// Where each episode's times start in the record's time array (0x009097f0).
export const CM_TIME_OFFSET: readonly number[] = [0, 9, 14];
// The record holds 9 + 5 + 9 stage times.
export const CM_TIME_SLOTS = 23;
// A stage time is valid in [60, 36000); the cap of an unfinished stage (a
// failed one) is 35999 seconds.
export const CM_MIN_TIME = 60;
export const CM_MAX_TIME = 36000;
export const CM_FAIL_TIME = 35999;
// The shortest stage time a clear is accepted for, unless chl_set_min_time_online
// moved it (GetChallengeStageCurrentTime_004d8dc0).
export const CM_DEFAULT_MIN_STAGE_TIME = 300;
// The EXP multiplier must be inside [0.01, 10000.0] (0x00909910 / 0x0090990c).
export const CM_EXP_MULTIPLIER_MIN = Math.fround(0.01);
export const CM_EXP_MULTIPLIER_MAX = 10000;
// The ten recovery-item rates (set_cmode_grave_rates) name these items in
// order after the four counts: Monomate, Dimate, Trimate, Monofluid, Difluid,
// Trifluid x1 (newserv on_request_challenge_grave_recovery_item_bb).
export const CM_GRAVE_ITEMS: readonly (readonly number[])[] = [
  [3, 0, 0],
  [3, 0, 1],
  [3, 0, 2],
  [3, 1, 0],
  [3, 1, 1],
  [3, 1, 2],
];
// Rank letters by rank value 1..3 (B, A, S); rank 0 is "none".
export const CM_RANK_LETTERS = ['', 'B', 'A', 'S'] as const;

// 0-based episode index the tables use: Episode 2 is 1, everything else 0
// (return_param1_or_is_curr_ep_2: g_CurrentEpisode == 1).
export function cmodeEpisodeIndex(episode: number): 0 | 1 {
  return episode === 2 ? 1 : 0;
}

// --- time and text encodings -------------------------------------------------------

function popcount16(v: number): number {
  let n = 0;
  for (let x = v & 0xffff; x; x &= x - 1) n++;
  return n;
}

// GenerateChallengeProgressionValue_004d9580: (mask << 16) | (mask ^ value),
// the mask random with 4..12 bits set (8 tries, then 0x3938).
export function encodeChallengeTime(value: number, random: () => number = Math.random): number {
  let mask = 0x3938;
  for (let i = 0; i < 8; i++) {
    const m = Math.floor(random() * 0x10000) & 0xffff;
    const bits = popcount16(m);
    if (bits > 3 && bits < 13) {
      mask = m;
      break;
    }
  }
  return ((mask << 16) | (mask ^ (value & 0xffff))) >>> 0;
}

// decrypt_challenge_time: -1 (0xffffffff) when the mask is not plausible.
export function decodeChallengeTime(v: number): number {
  const mask = (v >>> 16) & 0xffff;
  const bits = popcount16(mask);
  if (bits > 3 && bits < 13) return (mask ^ v) & 0xffff;
  return -1;
}

// is_value_less_than_60_or_greater_36000 inverted.
export function timeInRange(t: number): boolean {
  return t > 59 && t < CM_MAX_TIME;
}

// ValidateDecryptedChallengeTime_004d9604: 0 for an empty or invalid value.
export function validTime(v: number): number {
  if (v === 0) return 0;
  const t = decodeChallengeTime(v);
  return timeInRange(t) ? t : 0;
}

// CalculateChallengeProgressionValue_004d9554: 0 for a time out of range.
export function encodeStageTime(t: number, random: () => number = Math.random): number {
  return t !== 0 && timeInRange(t) ? encodeChallengeTime(t, random) : 0;
}

// The rank value saved in an award state: DecryptAndClampChallengeTime.
function decodeRank(v: number): number {
  const t = decodeChallengeTime(v);
  return t < 0 ? 0 : t;
}

// DecryptChallengeData_004d9eec (the dump's names for the pair are swapped:
// this one is newserv's encrypt_challenge_rank_text): the first character
// ^ 0x7F, each next (c - previous c) ^ 0x7F, all 16 bits wide, at most 11
// characters and a NUL.
export function encryptRankText(text: string, chars = 0xc): Uint16Array {
  const n = Math.min(0x20, chars);
  const out = new Uint16Array(chars);
  let prev = 0;
  for (let i = 0; i < n - 1 && i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) break;
    out[i] = i === 0 ? (c ^ 0x7f) & 0xffff : ((c - prev) & 0xffff) ^ 0x7f;
    prev = c;
  }
  return out;
}

// EncryptChallengeData_004d9f78 (newserv's decrypt_challenge_rank_text).
export function decryptRankText(words: ArrayLike<number>): string {
  let out = '';
  let prev = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] & 0xffff;
    if (w === 0) break;
    const c = i === 0 ? (w ^ 0x7f) & 0xff : (((w ^ 0x7f) + prev) & 0xff);
    out += String.fromCharCode(c);
    prev = c;
  }
  return out;
}

// XRGB8888 (0xffRRGGBB) to the record's XRGB1555 (Extract5BitColorComponents_004da6c8).
export function colorTo1555(argb: number): number {
  return ((argb & 0xf80000) >> 9) | ((argb & 0xf800) >> 6) | ((argb & 0xf8) >> 3);
}

// ConvertColor16To32 (the other way, for the lobby name tag).
export function colorFrom1555(v: number): number {
  return (((v & 0x7c00) << 9) | 0xff000000 | ((v & 0x3e0) << 6) | ((v & 0x1f) * 8)) >>> 0;
}

// --- the saved records (PlayerRecordsChallengeBB, 0x140 bytes) ---------------------------

export const RECORDS_SIZE = 0x140;
const R_TITLE_COLOR = 0x00;
const R_TIMES = 0x04;
const R_GRAVE = 0x60;
const R_AWARDS = 0xf4;
const R_RANK_TITLE = 0x10c;

export class ChallengeRecords {
  readonly raw: Uint8Array;
  private readonly dv: DataView;

  constructor(raw?: Uint8Array) {
    this.raw = raw ? raw.slice(0, RECORDS_SIZE) : new Uint8Array(RECORDS_SIZE);
    if (this.raw.length < RECORDS_SIZE) {
      const grown = new Uint8Array(RECORDS_SIZE);
      grown.set(this.raw);
      this.raw = grown;
    }
    this.dv = new DataView(this.raw.buffer, this.raw.byteOffset, this.raw.byteLength);
    if (!raw) this.titleColor = 0x7fff;
  }

  get titleColor(): number {
    return this.dv.getUint16(R_TITLE_COLOR, true);
  }
  set titleColor(v: number) {
    this.dv.setUint16(R_TITLE_COLOR, v & 0xffff, true);
  }

  // The encoded time of stage `stage` of episode index `e` (0 = none).
  timeRaw(e: number, stage: number): number {
    return this.dv.getUint32(R_TIMES + (CM_TIME_OFFSET[e]! + stage) * 4, true);
  }
  setTimeRaw(e: number, stage: number, v: number): void {
    this.dv.setUint32(R_TIMES + (CM_TIME_OFFSET[e]! + stage) * 4, v >>> 0, true);
  }
  // The decoded time, 0 when the slot is empty or invalid.
  time(e: number, stage: number): number {
    return stage < 0 || stage >= CM_STAGE_COUNT[e]! ? 0 : validTime(this.timeRaw(e, stage));
  }

  // The rank of the record: the title dword's high half, decoded (0 = none). The stage list's
  // first column shows its letter (the exe's entry+4, the record's first dword, ASSUMED).
  get rank(): number {
    return decodeRank(this.dv.getUint32(R_TITLE_COLOR, true));
  }

  // The sum of the episode's stage times without the "any missing" rule (the stage list's
  // total, UpdateChallengeStageListWindowContent_004dc6ac's loop over ValidateDecryptedChallengeTime).
  sumTimes(e: number): number {
    let sum = 0;
    for (let s = 0; s < CM_STAGE_COUNT[e]!; s++) sum += this.time(e, s);
    return sum;
  }

  // GetChallengeTotalTime_004da47c: the sum of the episode's stage times, 0
  // when any stage has none.
  total(e: number): number {
    let sum = 0;
    for (let s = 0; s < CM_STAGE_COUNT[e]!; s++) {
      const t = validTime(this.timeRaw(e, s));
      if (t === 0) return 0;
      sum += t;
    }
    return sum;
  }

  // The award state of episode index `e` (ep1 online, ep2 online, ep1 offline).
  awardFlags(e: number): number {
    return this.dv.getUint32(R_AWARDS + e * 8, true);
  }
  setAwardFlags(e: number, v: number): void {
    this.dv.setUint32(R_AWARDS + e * 8, v >>> 0, true);
  }
  // The best rank earned (0 none, 1 B, 2 A, 3 S).
  maxRank(e: number): number {
    return decodeRank(this.dv.getUint32(R_AWARDS + e * 8 + 4, true));
  }
  setMaxRank(e: number, rank: number, random: () => number = Math.random): void {
    this.dv.setUint32(R_AWARDS + e * 8 + 4, encodeChallengeTime(rank, random), true);
  }

  // The rank title (12 UTF-16 words, encrypted) and its plain text.
  get rankTitleWords(): Uint16Array {
    const w = new Uint16Array(12);
    for (let i = 0; i < 12; i++) w[i] = this.dv.getUint16(R_RANK_TITLE + i * 2, true);
    return w;
  }
  set rankTitleWords(w: ArrayLike<number>) {
    for (let i = 0; i < 12; i++) this.dv.setUint16(R_RANK_TITLE + i * 2, (w[i] ?? 0) & 0xffff, true);
  }
  get rankTitle(): string {
    return decryptRankText(this.rankTitleWords);
  }

  // opcode_have_grave: the online grave has a message (0xA4, 32 UTF-16 chars).
  hasGraveMessage(): boolean {
    for (let i = 0; i < 0x40; i++) if (this.raw[0xa4 + i]) return true;
    return false;
  }

  // The grave (online): stage, floor, deaths, time, party name and message.
  get graveDeaths(): number {
    return this.dv.getUint16(R_GRAVE + 4, true);
  }

  clone(): ChallengeRecords {
    return new ChallengeRecords(this.raw);
  }
}

// --- packets ----------------------------------------------------------------------------

// DF subcommand n is the command 0x(n)DF with flag 0 (bytes 0xDF, n).
export const dfCommand = (sub: number): number => ((sub & 0xff) << 8) | 0xdf;
export const CMD_ED_RECORDS = 0x08ed;

const u32 = (v: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return b;
};

// DF 01: C_SetChallengeModeStageNumber_BB_01DF {u32 stage}.
export const buildDfStage = (stage: number): Uint8Array => u32(stage);
// DF 02: C_SetChallengeModeCharacterTemplate_BB_02DF {u32 template}.
export const buildDfTemplate = (index: number): Uint8Array => u32(index);
// DF 03: {u32 difficulty}.
export const buildDfDifficulty = (difficulty: number): Uint8Array => u32(difficulty);
// DF 04: {f32 multiplier}.
export function buildDfExpMultiplier(m: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, m, true);
  return b;
}
// DF 05: {u32 color ARGB, 12 x u16 encrypted text}.
export function buildDfRankText(color: number, words: ArrayLike<number>): Uint8Array {
  const b = new Uint8Array(0x1c);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, color >>> 0, true);
  for (let i = 0; i < 12; i++) dv.setUint16(4 + i * 2, (words[i] ?? 0) & 0xffff, true);
  return b;
}
// DF 06: {u32 rank 0..2, u32 seconds, u32 award bitmask}.
export function buildDfRankThreshold(rank: number, seconds: number, mask: number): Uint8Array {
  const b = new Uint8Array(12);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, rank >>> 0, true);
  dv.setUint32(4, seconds >>> 0, true);
  dv.setUint32(8, mask >>> 0, true);
  return b;
}
// DF 07: {u32 prize rank, u32 award bitmask, ItemData (data1[12], id, data2[4])}.
export function buildDfAwardItem(rank: number, mask: number, item: Uint8Array): Uint8Array {
  const b = new Uint8Array(0x1c);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, rank >>> 0, true);
  dv.setUint32(4, mask >>> 0, true);
  b.set(item.subarray(0, 0x14), 8);
  return b;
}

// A 6x body: {sub, size in dwords, u16 argument (client id / unused)} + payload.
function sixX(sub: number, payload: Uint8Array, hdr16 = 0): Uint8Array {
  const total = 4 + payload.length;
  const b = new Uint8Array(total);
  b[0] = sub;
  b[1] = total >> 2;
  new DataView(b.buffer).setUint16(2, hdr16, true);
  b.set(payload, 4);
  return b;
}

// 6x95 (G_SetChallengeTime_6x95, 0x14): {client id, encoded time, token_v4 =
// (client id + 1) ^ (time - base), unused}. SendChallengeProgressionPacket_004db9b4.
export function buildSetChallengeTime(clientId: number, encodedTime: number, token: number): Uint8Array {
  const p = new Uint8Array(16);
  const dv = new DataView(p.buffer);
  dv.setUint32(0, clientId, true);
  dv.setUint32(4, encodedTime >>> 0, true);
  dv.setUint32(8, token >>> 0, true);
  return sixX(0x95, p);
}
export function parseSetChallengeTime(b: Uint8Array): { clientId: number; encodedTime: number } | null {
  if (b.length < 12) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { clientId: dv.getUint32(4, true), encodedTime: dv.getUint32(8, true) };
}
// 6x97 (G_SelectChallengeModeFailureOption_6x97, 0x14): {client id, is_retry, 0, 0}.
export function buildFailureOption(clientId: number, retry: boolean): Uint8Array {
  const p = new Uint8Array(16);
  const dv = new DataView(p.buffer);
  dv.setUint32(0, clientId, true);
  dv.setUint32(4, retry ? 1 : 0, true);
  return sixX(0x97, p);
}
export function parseFailureOption(b: Uint8Array): { clientId: number; retry: boolean } | null {
  if (b.length < 12) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { clientId: dv.getUint32(4, true), retry: dv.getUint32(8, true) === 1 };
}
// 6x9D (G_SetChallengeDeadFlag_6x9D, 8): {client id}.
export function buildDeadFlag(clientId: number): Uint8Array {
  return sixX(0x9d, u32(clientId));
}
export function parseDeadFlag(b: Uint8Array): number | null {
  return b.length < 8 ? null : new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true);
}
// 6x7C (G_SetChallengeRecords_BB_6x7C, 0x148): {u16 client id, 2 unused} + the
// 0x140 records. SendChallengeDataRequest_004dbacc (sent when the player enters
// a Challenge game).
export function buildChallengeRecords(clientId: number, records: Uint8Array): Uint8Array {
  const p = new Uint8Array(4 + RECORDS_SIZE);
  new DataView(p.buffer).setUint16(0, clientId, true);
  p.set(records.subarray(0, RECORDS_SIZE), 4);
  const b = sixX(0x7c, p, 0);
  b[1] = 0x52;
  return b;
}
export function parseChallengeRecords(b: Uint8Array): { clientId: number; records: ChallengeRecords } | null {
  if (b.length < 8 + RECORDS_SIZE) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { clientId: dv.getUint16(4, true), records: new ChallengeRecords(b.subarray(8, 8 + RECORDS_SIZE)) };
}
// 6xD1 (G_ChallengeModeGraveRecoveryItemRequest_BB_6xD1, 0x14), server-handled.
export function buildGraveRecoveryRequest(clientId: number, floor: number, room: number, x: number, z: number, itemType: number): Uint8Array {
  const p = new Uint8Array(16);
  const dv = new DataView(p.buffer);
  dv.setUint16(0, floor, true);
  dv.setUint16(2, room, true);
  dv.setFloat32(4, x, true);
  dv.setFloat32(8, z, true);
  dv.setUint32(12, itemType, true);
  const b = sixX(0xd1, p, clientId);
  b[1] = 5;
  return b;
}

// --- the S-rank weapon name (maybe_put_srank_name_data_into_item, 0x005d5a60 area) ----------

// data1[0] = 0, data1[1] = the weapon type (0x70..0x88 or 0xA5..0xA9), then
// the name in 5-bit characters (A..Z = 1..26, anything else 0) in three
// big-endian words data1w[3..5] with bit 15 set. The first word's bits 10..14
// hold 1 (the exe seeds the name buffer with 'A'); newserv's S-rank name
// decoder reads the 8 characters from the rest.
export function buildSRankWeapon(type: number, name: string, id = 0xffffffff): Uint8Array | null {
  if (!((type > 0x6f && type < 0x89) || (type > 0xa4 && type < 0xaa))) return null;
  const item = new Uint8Array(20);
  item[0] = 0;
  item[1] = type;
  const idx = (ch: string | undefined): number => {
    const c = ch ? ch.charCodeAt(0) : 0;
    if (c >= 0x61 && c <= 0x7a) return c - 0x60;
    if (c >= 0x41 && c <= 0x5a) return c - 0x40;
    return 0;
  };
  const n = Array.from({ length: 8 }, (_, i) => idx(name[i]));
  const w3 = ((1 << 10) | (n[0]! << 5) | n[1]!) & 0xffff;
  const w4 = ((n[2]! << 10) | (n[3]! << 5) | n[4]!) & 0xffff;
  const w5 = ((n[5]! << 10) | (n[6]! << 5) | n[7]!) & 0xffff;
  item[6] = (w3 >> 8) | 0x80;
  item[7] = w3 & 0xff;
  item[8] = (w4 >> 8) | 0x80;
  item[9] = w4 & 0xff;
  item[10] = (w5 >> 8) | 0x80;
  item[11] = w5 & 0xff;
  new DataView(item.buffer).setUint32(12, id >>> 0, true);
  return item;
}

// --- the S-rank prize choices (award_item_select, QuestThread5Constructor_006bd0f8) --------------
//
// The list has one row per S-rank weapon the episode can give: the row's name is
// unitxt group 1 entry `name` (unitxt_get_item_name) and its value is the weapon
// type (GetQuestThread5SelectedItemID_006bd288 reads the second word). The rows
// are two -1 ended tables in the exe's data: g_QuestThread5ItemIDs_Episode0 at
// 0x009ce920 (Episode 1, read with `tools/exedata.py read 009ce920 u 40`) and
// g_QuestThread5ItemIDs_EpisodeOther at 0x009ce9a0 (Episode 2 and 4).
export interface SRankChoice {
  name: number; // unitxt group 1 index (the item name)
  type: number; // the S-rank weapon type, 0x70.. (maybe_put_srank_name_data_into_item)
}

const S_RANK_CHOICES_EPISODE_1: readonly SRankChoice[] = Array.from({ length: 14 }, (_, i) => ({ name: 386 + i, type: 0x70 + i }));

const S_RANK_CHOICES_OTHER: readonly SRankChoice[] = [
  ...Array.from({ length: 11 }, (_, i) => ({ name: 400 + i, type: 0x7e + i })),
  ...Array.from({ length: 5 }, (_, i) => ({ name: 484 + i, type: 0xa5 + i })),
];

// The rows of the episode (0 = Episode 1, anything else the other table).
export function sRankChoices(episodeIndex: number): readonly SRankChoice[] {
  return episodeIndex === 0 ? S_RANK_CHOICES_EPISODE_1 : S_RANK_CHOICES_OTHER;
}

// The name window (award_item_name, QuestThread4Constructor_006bcf6c): a keyboard
// of 8 characters (TKeyboardControl(.., 8, ..)). What is typed is the name written
// into the weapon: letters only (the 5-bit table of maybe_put_srank_name_data_into_item).
export const S_RANK_NAME_MAX = 8;
export function srankNameFromInput(typed: string): string {
  return typed.replace(/[^A-Za-z]/g, '').slice(0, S_RANK_NAME_MAX).toUpperCase();
}

// --- the state a Challenge game keeps ------------------------------------------------------

export interface RankThreshold {
  seconds: number;
  mask: number;
}

// What the world gives the mode (all optional: without them the state still
// builds, which is what the headless quest audit runs).
export interface ChallengeEnv {
  // g_ChallengeObject != 0: the game is a Challenge game.
  isChallenge?(): boolean;
  // 0 = Episode 1, 1 = Episode 2 (return_param1_or_is_curr_ep_2).
  episodeIndex?(): number;
  clientId?(): number;
  isLeader?(): boolean;
  // DF subcommand (`dfCommand(sub)`, no flag) and 6x subcommands to the server.
  sendDf?(sub: number, payload: Uint8Array): void;
  sendSub?(body: Uint8Array): void;
  sendRecords?(records: Uint8Array): void;
  // Players present in the game (client ids), whether one is dead, kills.
  presentClients?(): number[];
  isDead?(clientId: number): boolean;
  kills?(clientId: number): number;
  resetKills?(clientId: number): void;
  // The local player's saved records (null: save file missing).
  records?(): ChallengeRecords | null;
  random?(): number;
  // Free inventory slots of the local player.
  freeSlots?(): number;
  // Puts a prize in the inventory; false when it does not fit.
  addPrize?(item: Uint8Array): boolean;
  // The id the next created item gets (increment_item_id_for_player).
  newItemId?(): number;
  // The template replaces the local player's character.
  applyTemplate?(index: number): void;
  // set_cmode_difficulty took effect (the game's difficulty becomes this).
  difficultyChanged?(difficulty: number): void;
  // exp_multiplication took effect (handle_experience multiplies kills by it).
  expMultiplierChanged?(multiplier: number): void;
  // The records changed (a prize was marked as received).
  recordsChanged?(): void;
  // The quest's player entered a floor (quest_start_floor_thread).
  floorEntered?(floor: number): void;
  // reset_map ran (clear_unknown_challenge_object): a new attempt starts.
  stageReset?(): void;
  // UI. The result window after check_rank_time; the retry menu; the list of
  // dead players; the timer window; the S-rank prize prompts.
  showResult?(r: ChallengeResult): void;
  showRetryMenu?(): void;
  showDeadList?(clients: number[]): void;
  setTimer?(seconds: number): void;
  // award_item_select / _name / _ok show windows and wait: each answers with
  // a promise (an S-rank weapon type 0x70.., the name, 0 = OK / 1 = reconsider).
  selectAward?(): Promise<number>;
  nameAward?(): Promise<string>;
  confirmAward?(): Promise<number>;
  log?(msg: string): void;
}

export interface ChallengeResult {
  stage: number; // 0-based
  episodeIndex: number;
  runTime: number; // this run's stage time
  total: number; // total of the episode's stages (0: not all cleared)
  previousBest: number; // the stage's best before this run (0: none)
  oldTitle: string;
  newTitle: string;
  oldRank: number;
  newRank: number;
}

// check_rank_time's register values (opcode_unknownF869): ProcessChallengeStage's
// return maps 2 -> 2, 1 -> 1, 0 -> 0, -1 -> 3, -2 -> 4, -3 -> 5, else 6.
export type RankCheckCode = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export class ChallengeMode {
  readonly env: ChallengeEnv;
  // g_ChallengeStageFinalData: -1 until cmode_stage ran (ASSUMED: the initial
  // value comes from the exe's default block and is the "unset" -1 that
  // ProcessChallengeStage_004da994 tests).
  stage = -1;
  templateIndex = -1;
  difficulty = 0;
  expMultiplier = 1;
  // set_cmode_rank_result
  rankText = '';
  rankTextWords: Uint16Array = new Uint16Array(12);
  rankColor = 0;
  // set_cmode_rank_override: encrypted check string and result per entry (at most 16).
  readonly overrides: { check: Uint16Array; result: Uint16Array; color: number }[] = [];
  // set_cmode_rank_threshold, indexed by rank 0 = B, 1 = A, 2 = S.
  readonly thresholds: RankThreshold[] = [
    { seconds: 0, mask: 0 },
    { seconds: 0, mask: 0 },
    { seconds: 0, mask: 0 },
  ];
  // set_cmode_grave_rates, 10 fractions: 4 counts, 6 item types.
  graveRates: number[] = new Array<number>(10).fill(0);
  // set_cmode_base_time: the clock the timer window shows, seconds.
  baseTime = 0;
  // chl_set_min_time_online (a value in [60, 3600] seconds).
  minStageTime = 0;
  // chl_set_timerecord: the local score (encoded) and the others', by client id.
  readonly scores = new Map<number, number>();
  private progressionResult = 0;
  private progressionInit = false;
  // The last check_rank_time's rank index (g_ChallengeStageIndex) for item_create_cmode.
  stageIndex = -4;
  // g_challenge_stage_failed / the retry menu. g_CurrentChallengeStageId is
  // shared: -1 until a choice, set to the rank colour by DF 05
  // (set_cmode_rank_result), and to 0 / 1 (no / yes) by the leader's 6x97
  // (SetChallengeStageId_004dbb90).
  failed = false;
  retryAllowed = true;
  stageId = -1;
  retryMenuOpen = false;
  // g_ChallengeObjectInitialized: set once the retry menu object exists
  // (ASSUMED: InitializeChallengeObjectState_004da0c8 runs when it is created).
  menuInitialized = false;
  // award_item_*: the S-rank prize being built.
  awardType = 0;
  awardName = '';
  // The last result shown (for tests and the UI).
  lastResult: ChallengeResult | null = null;

  constructor(env: ChallengeEnv = {}) {
    this.env = env;
  }

  get active(): boolean {
    return this.env.isChallenge?.() ?? true;
  }
  get episodeIndex(): number {
    return this.env.episodeIndex?.() ?? 0;
  }
  get stageCount(): number {
    return CM_STAGE_COUNT[this.episodeIndex]!;
  }
  private rnd(): number {
    return this.env.random?.() ?? Math.random();
  }
  private leaderSend(sub: number, payload: Uint8Array): void {
    if (this.env.isLeader?.() ?? true) this.env.sendDf?.(sub, payload);
  }

  // F820 cmode_stage: a stage at or past the last one is stage 0
  // (opcode_cmode_stage, then send_packet0xdf_subcommand1 clamps again).
  setStage(n: number): void {
    let v = n >>> 0;
    if (v >= this.stageCount) v = 0;
    this.stage = v;
    this.leaderSend(1, buildDfStage(v));
  }

  // F823 set_cmode_char_template: a template 0..15 replaces the characters.
  setTemplate(n: number): void {
    if (n < 0 || n > 0xf) return;
    this.templateIndex = n;
    this.env.applyTemplate?.(n);
    this.leaderSend(2, buildDfTemplate(n));
  }

  // F824 set_cmode_difficulty: only in a Challenge game.
  setDifficulty(n: number): boolean {
    if (!this.active) return false;
    this.difficulty = n;
    this.env.difficultyChanged?.(n);
    this.leaderSend(3, buildDfDifficulty(n));
    return true;
  }

  // F825 exp_multiplication: regs[0] + regs[1] / regs[2] as floats, accepted in
  // [0.01, 10000].
  setExpMultiplier(a: number, b: number, c: number): boolean {
    const m = Math.fround(Math.fround(Math.fround(b) / Math.fround(c)) + Math.fround(a));
    if (!this.active || !(m >= CM_EXP_MULTIPLIER_MIN) || !(m <= CM_EXP_MULTIPLIER_MAX)) return false;
    this.expMultiplier = m;
    this.env.expMultiplierChanged?.(m);
    this.leaderSend(4, buildDfExpMultiplier(m));
    return true;
  }

  // F864 set_cmode_rank_result: the title and colour the player earns by
  // clearing the stage, the text sent encrypted.
  setRankResult(color: number, text: string): void {
    this.rankTextWords = encryptRankText(text);
    this.rankText = decryptRankText(this.rankTextWords);
    this.rankColor = (color | 0xff000000) >>> 0;
    this.stageId = this.rankColor | 0;
    this.leaderSend(5, buildDfRankText(this.rankColor, this.rankTextWords));
  }

  // F874 set_cmode_rank_override: strB is "check<TAB or newline>result" (at
  // most 16 of them, ProcessChallengeData_004da7f8).
  addRankOverride(color: number, text: string): boolean {
    if (this.overrides.length >= 16) return false;
    const cut = text.search(/[\t\n]/);
    const check = cut < 0 ? text : text.slice(0, cut);
    const result = cut < 0 ? '' : text.slice(cut + 1);
    this.overrides.push({ check: encryptRankText(check), result: encryptRankText(result), color: color >>> 0 });
    return true;
  }

  // F868 set_cmode_rank_threshold: rank 0..2, seconds >= 300 per stage of the
  // episode (the B rank is forced to the 35999 s cap), the three thresholds
  // strictly shrinking. Returns the register value (1 = accepted).
  setRankThreshold(rank: number, seconds: number, mask: number): number {
    const e = this.episodeIndex;
    const count = CM_STAGE_COUNT[e]!;
    if (rank < 0 || rank > 2 || seconds < 300 * count) return 0;
    if (rank === 0) seconds = CM_FAIL_TIME * count;
    const t = this.thresholds[rank]!;
    if (t.seconds !== 0) return 0;
    t.seconds = seconds;
    t.mask = mask >>> 0;
    // The loop walks the three entries: each non-empty one must be smaller
    // than the previous non-empty one.
    let prev = 0x7fffffff;
    for (const x of this.thresholds) {
      if (x.seconds !== 0 && x.seconds >= prev) return 0;
      if (x.seconds !== 0) prev = x.seconds;
    }
    this.leaderSend(6, buildDfRankThreshold(rank, seconds, mask));
    return 1;
  }

  // F88F set_cmode_grave_rates: ten fractions; each >= 0, the first four and
  // the last six summing to at most 1.
  setGraveRates(num: number[], den: number[]): boolean {
    const r = num.map((n, i) => Math.fround(Math.fround(n) / Math.fround(den[i]!)));
    if (r.some((v) => v < 0)) return false;
    const sum = (a: number[]) => a.reduce((s, v) => Math.fround(s + v), 0);
    if (sum(r.slice(0, 4)) > 1 || sum(r.slice(4)) > 1) return false;
    this.graveRates = r;
    return true;
  }

  // The grave drop (ProcessGraveChallengePlayerLogic_004ddcbc): `count` recovery
  // items (capped by the players present) of the type the second roll picks,
  // or null when a roll falls outside the rates.
  graveDrop(presentPlayers: number, roll1 = this.rnd(), roll2 = this.rnd()): { count: number; type: number } | null {
    const p = this.graveRates;
    let count = 0;
    let c = 0;
    for (let k = 0; k < 4; k++) {
      c = Math.fround(c + p[k]!);
      if (c !== 0 && roll1 <= c) {
        count = k + 1;
        break;
      }
    }
    if (count === 0) return null;
    count = Math.min(count, presentPlayers);
    if (count === 0) return null;
    let type = -1;
    c = 0;
    for (let k = 0; k < 6; k++) {
      c = Math.fround(c + p[4 + k]!);
      if (c !== 0 && roll2 <= c) {
        type = k;
        break;
      }
    }
    return type < 0 ? null : { count, type };
  }

  // F83C set_cmode_base_time (UpdateChallengeDefaultTime_004daba4): the timer
  // window shows this many seconds.
  setBaseTime(seconds: number): void {
    if (!this.active) return;
    this.baseTime = seconds;
    this.env.setTimer?.(seconds);
  }

  // F8B7 chl_set_min_time_online: [60, 3600].
  setMinStageTime(seconds: number): void {
    if (this.active && seconds > 59 && seconds < 0xe11) this.minStageTime = seconds;
  }

  // GetChallengeStageCurrentTime_004d8dc0
  get currentMinTime(): number {
    return this.minStageTime > 59 && this.minStageTime < 0xe11 ? this.minStageTime : CM_DEFAULT_MIN_STAGE_TIME;
  }

  // IsChallengeStageTimeValid_004d8d9c: false for a time under the minimum or at 36000.
  stageTimeOk(t: number): boolean {
    return this.currentMinTime <= t && t < CM_MAX_TIME;
  }

  // F88D chl_set_timerecord: the local score, sent as 6x95; the token is
  // (client id + 1) ^ (time - base time).
  setTimeRecord(t: number): void {
    if (!this.active) return;
    const id = this.env.clientId?.() ?? 0;
    const enc = encodeStageTime(t, () => this.rnd());
    this.env.sendSub?.(buildSetChallengeTime(id, enc, ((id + 1) ^ (t - this.baseTime)) >>> 0));
    // The client runs its own 6x95 handler too (it waits for every present
    // player's score, its own included).
    this.receiveTimeRecord(id, enc);
  }
  // 6x95 from another client (handle_packet0x60_subcommand0x95).
  receiveTimeRecord(clientId: number, enc: number): void {
    if (!this.active || clientId < 0 || clientId > 3) return;
    const t = validTime(enc);
    this.scores.set(clientId, !this.stageTimeOk(t) ? encodeStageTime(CM_FAIL_TIME, () => this.rnd()) : enc);
  }

  // F88E chl_get_timerecord (GetChallengeStageProgressionResult_004db6bc): the
  // slowest score of the players present, -1 when one has none, -2 when one is
  // invalid or nobody is slower than the minimum.
  getTimeRecord(): number {
    if (!this.active) return -1;
    const present = this.env.presentClients?.() ?? [this.env.clientId?.() ?? 0];
    const local = [0, 0, 0, 0];
    for (const id of present) {
      if (id < 0 || id > 3) continue;
      const enc = this.scores.get(id) ?? 0;
      if (enc === 0) return -1;
      const t = validTime(enc);
      if (!this.stageTimeOk(t)) return -2;
      local[id] = t;
    }
    if (!this.progressionInit) {
      this.progressionResult = this.currentMinTime - 1;
      this.progressionInit = true;
    }
    let r = this.progressionResult;
    if (local[0] !== 0 && !(local[0]! <= this.progressionResult)) r = local[0]!;
    for (let i = 1; i < 4; i++) if (local[i] !== 0 && r < local[i]!) r = local[i]!;
    return r !== this.progressionResult ? r : -2;
  }

  // F826 / F827 (CheckChallengePlayerAlive / Dead): 1 when every / any player
  // present is dead; a failure flags the stage.
  allPlayersDead(): number {
    if (!this.active) return 0;
    const present = this.env.presentClients?.() ?? [];
    for (const id of present) if (!(this.env.isDead?.(id) ?? false)) return 0;
    this.failed = true;
    return 1;
  }
  anyPlayerDead(): number {
    if (!this.active) return 0;
    for (const id of this.env.presentClients?.() ?? []) {
      if (this.env.isDead?.(id)) {
        this.failed = true;
        return 1;
      }
    }
    return 0;
  }

  // F89D chl_create_retry_menu / F89C get_chl_retry_choice (the leader picks).
  // ChallengeObjectIsMultiplayerReady_004dc208: the retry object exists only
  // while the retry menu is allowed and more than one player is in the game.
  get multiplayerReady(): boolean {
    return this.retryAllowed && (this.env.presentClients?.().length ?? 0) > 1;
  }
  openRetryMenu(): void {
    if (!this.active || !this.multiplayerReady) return;
    this.retryMenuOpen = true;
    this.menuInitialized = true;
    this.env.showRetryMenu?.();
  }
  // The leader's pick: 6x97 {is_retry}; the handler runs on every client,
  // the sender's included.
  chooseRetry(retry: boolean): void {
    this.env.sendSub?.(buildFailureOption(this.env.clientId?.() ?? 0, retry));
    this.receiveRetry(retry);
  }
  // SetChallengeStageId_004dbb90: the value clamps to 0 / 1.
  receiveRetry(retry: boolean): void {
    if (!this.active) return;
    this.stageId = retry ? 1 : 0;
    this.retryMenuOpen = false;
  }
  // GetChallengeStageResult_004db7d4 through opcode_disp_chl_retry_menu: 0 not
  // chosen, 1 no, 2 yes; null leaves the register alone (the stage id still
  // holds the rank colour).
  get retryRegister(): number | null {
    let v = this.failed ? this.stageId : 0;
    if (v === 1 && !this.menuInitialized) v = -1;
    if (v === -1) return 0;
    if (v === 0) return 1;
    if (v === 1) return 2;
    return null;
  }
  // clear_unknown_challenge_object (end of reset_map): the bookkeeping of
  // the stage that just ended.
  resetStage(): void {
    if (!this.active) return;
    this.stageId = -1;
    this.baseTime = 0;
    this.failed = false;
    this.menuInitialized = false;
    this.retryMenuOpen = false;
    this.scores.clear();
    this.progressionInit = false;
    this.progressionResult = 0;
    this.env.stageReset?.();
  }
  // F8B8 disable_retry_menu
  disableRetry(): void {
    if (this.active) this.retryAllowed = false;
  }
  // F8B9 chl_show_dead_player_list
  showDeadList(): void {
    if (!this.active || !this.multiplayerReady) return;
    const dead = (this.env.presentClients?.() ?? []).filter((id) => this.env.isDead?.(id));
    this.env.showDeadList?.(dead);
  }

  // F8AA is_there_grave_message
  hasGraveMessage(): boolean {
    return this.env.records?.()?.hasGraveMessage() ?? false;
  }

  // F8AC get_cmode_prize_rank
  prizeRank(): number {
    return this.env.records?.()?.maxRank(this.episodeIndex) ?? 0;
  }

  // F869 check_rank_time (ProcessChallengeStage_004da994 and
  // ProcessChallengeStageProgression_004d8dec). `t` is the stage time in
  // seconds; the return is the register value.
  checkRankTime(t: number): RankCheckCode {
    const rec = this.env.records?.() ?? null;
    if (!this.active || this.stage === -1 || !rec) {
      this.stageIndex = -4;
      return 6;
    }
    if (!this.stageTimeOk(t)) t = CM_FAIL_TIME;
    const r = this.progression(rec, t);
    this.env.sendRecords?.(rec.raw);
    if (r === -1) {
      this.stageIndex = -1;
      return 3;
    }
    if (r < 0) {
      this.stageIndex = -2;
      return 4;
    }
    if (this.env.freeSlots && this.env.freeSlots() <= 0) {
      this.stageIndex = -3;
      return 5;
    }
    this.stageIndex = r;
    return r as RankCheckCode;
  }

  // The rank logic. Returns 0 (B prize available), 1 (A), 2 (S), -1 (the
  // episode's stages are not all cleared), -2 (no unclaimed prize) or -4
  // (thresholds invalid / the total out of range).
  private progression(rec: ChallengeRecords, t: number): number {
    const e = this.episodeIndex;
    const stage = this.stage;
    const prevBest = rec.time(e, stage);
    const oldTitle = rec.rankTitle;
    const oldRank = rec.maxRank(e);
    this.finalData(rec, e, stage, t);
    let total = rec.total(e);
    let result: number;
    let rank = 0;
    if (total === 0) {
      result = -1;
    } else {
      total = total - rec.time(e, stage) + t;
      const count = CM_STAGE_COUNT[e]!;
      const lo = 300 * count;
      const hi = CM_FAIL_TIME * count;
      const flags = rec.awardFlags(e);
      const [B, A, S] = this.thresholds as [RankThreshold, RankThreshold, RankThreshold];
      const bad = (x: RankThreshold) => x.seconds < lo || x.seconds > hi;
      result = -4;
      if (total >= lo && total <= hi) {
        let done = false;
        if (S.seconds !== 0 && S.seconds >= total) {
          if (bad(S)) {
            result = -4;
            done = true;
          } else {
            rank = 3;
            if ((S.mask & flags) === 0) {
              result = 2;
              done = true;
            }
          }
        }
        if (!done && A.seconds !== 0 && total <= A.seconds) {
          if (bad(A)) {
            result = -4;
            done = true;
          } else {
            rank = Math.max(rank, 2);
            if ((A.mask & flags) === 0) {
              result = 1;
              done = true;
            }
          }
        }
        if (!done && B.seconds !== 0 && total <= B.seconds) {
          if (bad(B)) {
            result = -4;
            done = true;
          } else {
            rank = Math.max(rank, 1);
            if ((B.mask & flags) === 0) {
              result = 0;
              done = true;
            }
          }
        }
        if (!done) result = -1;
        if (result < 0 && result !== -4) result = -2;
      }
      if (rec.maxRank(e) < rank) rec.setMaxRank(e, rank, () => this.rnd());
    }
    const newRank = rec.maxRank(e);
    this.lastResult = {
      stage,
      episodeIndex: e,
      runTime: t,
      total: total === 0 ? 0 : total,
      previousBest: prevBest,
      oldTitle,
      newTitle: rec.rankTitle,
      oldRank,
      newRank,
    };
    this.env.showResult?.(this.lastResult);
    return result;
  }

  // ProcessChallengeStageFinalData_004d9218: keeps the best time of the stage
  // and, on a first clear in Episode 1, the rank title.
  private finalData(rec: ChallengeRecords, e: number, stage: number, t: number): boolean {
    if (stage < 0 || stage >= CM_STAGE_COUNT[e]!) return false;
    const slot = rec.timeRaw(e, stage);
    if (slot === 0) {
      if (e === 0 && this.rankText !== '') this.applyTitle(rec);
    } else {
      const old = validTime(slot);
      if (old === 0) {
        rec.setTimeRaw(e, stage, 0);
        return false;
      }
      if (old <= t) return false;
    }
    rec.setTimeRaw(e, stage, encodeStageTime(t, () => this.rnd()));
    return true;
  }

  // The first Episode 1 clear sets the title: the first override whose check
  // text equals the current title replaces it, else the stage's own text.
  private applyTitle(rec: ChallengeRecords): void {
    const current = rec.rankTitle;
    for (const o of this.overrides) {
      if (decryptRankText(o.check) === current) {
        rec.rankTitleWords = o.result;
        rec.titleColor = colorTo1555(o.color);
        return;
      }
    }
    rec.rankTitleWords = this.rankTextWords;
    rec.titleColor = colorTo1555(this.rankColor);
  }

  // F86A item_create_cmode: a prize item (regs -> data1[0..5]) goes to the
  // inventory, marks the award as received and goes to the server as DF 07.
  createPrize(data1: number[]): number {
    const idx = this.stageIndex;
    const rec = this.env.records?.() ?? null;
    if (idx < 0 || idx > 2 || !rec) return 0;
    const item = new Uint8Array(20);
    for (let i = 0; i < 6; i++) item[i] = data1[i]! & 0xff;
    new DataView(item.buffer).setUint32(12, (this.env.newItemId?.() ?? 0xffffffff) >>> 0, true);
    if (this.env.addPrize && !this.env.addPrize(item)) return 0;
    const mask = this.thresholds[idx]!.mask;
    const e = this.episodeIndex;
    rec.setAwardFlags(e, rec.awardFlags(e) | mask);
    this.env.recordsChanged?.();
    this.env.sendDf?.(7, buildDfAwardItem(idx, mask, item));
    return 1;
  }

  // F866 award_item_select / F865 award_item_name / F86C award_item_ok /
  // F867 award_item_give. The first three wait for their window when the game
  // has one (null: nothing to wait for, the defaults stand).
  selectAward(): Promise<number> | null {
    const p = this.env.selectAward?.();
    if (!p) {
      this.awardType = 0x70;
      return null;
    }
    return p.then((v) => (this.awardType = v));
  }
  nameAward(): Promise<string> | null {
    const p = this.env.nameAward?.();
    if (!p) return null;
    return p.then((v) => (this.awardName = v));
  }
  // The answer register: 0 = OK, 1 = the player wants to choose again.
  confirmAward(): Promise<number> | null {
    return this.env.confirmAward?.() ?? null;
  }
  giveAward(): number {
    const item = buildSRankWeapon(this.awardType, this.awardName, this.env.newItemId?.() ?? 0xffffffff);
    const idx = this.stageIndex;
    const rec = this.env.records?.() ?? null;
    if (!item || idx < 0 || idx > 2 || !rec) return 0;
    if (this.env.addPrize && !this.env.addPrize(item)) return 0;
    const mask = this.thresholds[idx]!.mask;
    const e = this.episodeIndex;
    rec.setAwardFlags(e, rec.awardFlags(e) | mask);
    this.env.recordsChanged?.();
    this.env.sendDf?.(7, buildDfAwardItem(idx, mask, item));
    return 1;
  }

  // quest_start_floor_thread: a floor was entered.
  floorEntered(floor: number): void {
    if (this.active) this.env.floorEntered?.(floor);
  }
}

// --- graves (ProcessGraveChallengePlayerLogic_004ddcbc) ---------------------------------------------

// The grave object of a player who died here: the leader, once a present
// player stands within GRAVE_TRIGGER_DISTANCE (XZ) of it, rolls the recovery
// items and drops them on a fan of points GRAVE_DROP_RADIUS around it
// (0x00909c88 = 10.0, 0x00909c84 = 7.5; the rolls use rand() / 32768).
export const GRAVE_TRIGGER_DISTANCE = 10;
export const GRAVE_DROP_RADIUS = 7.5;

// The first `count` points of the fan: it starts at heading - (count - 1) *
// 0x1000 and steps 0x2000 (BAMS, 0x10000 = a turn).
export function graveDropPoints(x: number, z: number, heading: number, count: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  let a = heading - (count - 1) * 0x1000;
  for (let i = 0; i < 8 && out.length < count; i++, a += 0x2000) {
    const r = (a & 0xffff) * ((Math.PI * 2) / 0x10000);
    out.push({ x: x + GRAVE_DROP_RADIUS * Math.cos(r), z: z + GRAVE_DROP_RADIUS * Math.sin(r) });
  }
  return out;
}

// The grave a record describes (online_grave_*): null when the player never died.
export function recordGrave(r: ChallengeRecords): { episodeIndex: number; stage: number; floor: number; deaths: number; x: number; y: number; z: number; team: string; date: number; defeatedBy: number } | null {
  const deaths = r.graveDeaths;
  if (deaths <= 0 || deaths > 9999) return null;
  const dv = new DataView(r.raw.buffer, r.raw.byteOffset, r.raw.byteLength);
  let team = '';
  for (let i = 0; i < 0x14; i++) {
    const c = dv.getUint16(0x7c + i * 2, true);
    if (!c) break;
    team += String.fromCharCode(c);
  }
  return {
    episodeIndex: r.raw[0x60]!,
    stage: r.raw[0x61]!,
    floor: r.raw[0x62]!,
    deaths,
    x: dv.getFloat32(0x70, true),
    y: dv.getFloat32(0x74, true),
    z: dv.getFloat32(0x78, true),
    team,
    date: dv.getUint32(0x68, true),
    defeatedBy: dv.getUint32(0x6c, true),
  };
}

// SaveChallengeEntityProgressOnDeath_004d9a60: the record of a player who just
// died (the grave stays until the next death): episode, stage, floor, one more
// death (capped at 9999), the date, the party name, where it happened.
export function saveGrave(r: ChallengeRecords, g: { episodeIndex: number; stage: number; floor: number; x: number; y: number; z: number; team: string; defeatedByRt: number; date: Date }): void {
  const dv = new DataView(r.raw.buffer, r.raw.byteOffset, r.raw.byteLength);
  r.raw[0x60] = g.episodeIndex;
  r.raw[0x61] = g.stage;
  r.raw[0x62] = g.floor;
  const d = dv.getUint16(0x64, true);
  dv.setUint16(0x64, d + 1 < 10000 ? d + 1 : 9999, true);
  const y = g.date.getFullYear();
  const yy = Math.floor(y / 100) === 20 ? Math.min(15, y % 100) : 15;
  dv.setUint32(0x68, ((((((yy << 4) | (g.date.getMonth() + 1)) << 8) | g.date.getDate()) << 8) | g.date.getHours()) * 256 + g.date.getMinutes() >>> 0, true);
  dv.setUint32(0x6c, g.defeatedByRt >>> 0, true);
  dv.setFloat32(0x70, g.x, true);
  dv.setFloat32(0x74, g.y, true);
  dv.setFloat32(0x78, g.z, true);
  for (let i = 0; i < 0x14; i++) dv.setUint16(0x7c + i * 2, i < g.team.length && i < 0x13 ? g.team.charCodeAt(i) : 0, true);
  for (let i = 0; i < 0x20; i++) dv.setUint16(0xa4 + i * 2, 0, true);
}

// --- the result window text (ChallengeObjectUIPanel_UpdateLabel_004dd29c) --------------------

const pad2 = (n: number): string => String(Math.trunc(n)).padStart(2, '0');
// %02d'%02d"%02d: the total's hours (clamped to 99), minutes and seconds (two digits each).
const hmsTotal = (t: number): string => {
  const { h, m, s } = formatHms(t);
  return `${pad2(h)}'${pad2(m)}"${pad2(s)}`;
};

// FormatTimeToHoursMinutesSeconds_004da01c: hours capped at 99, "h'mm\"ss".
export function formatHms(t: number): { h: number; m: number; s: number } {
  return { h: Math.min(99, Math.floor(t / 3600)), m: Math.floor(t / 60) % 60, s: t % 60 };
}
export function hmsText(t: number, hourWidth = 1): string {
  const { h, m, s } = formatHms(t);
  return `${String(h).padStart(hourWidth, ' ')}'${pad2(m)}"${pad2(s)}`;
}

// The strings the window uses: unitxt group 12 (0x53 "Stage ", 0x54 "Clear Time",
// 0x55 "Total Time", 0x56 "New Record", 0x57 "Title", 0x58 "Rank").
export interface ResultStrings {
  stage: string;
  clearTime: string;
  totalTime: string;
  newRecord: string;
  title: string;
  rank: string;
}
export const RESULT_STRINGS_EN: ResultStrings = {
  stage: 'Stage ',
  clearTime: 'Clear Time',
  totalTime: 'Total Time',
  newRecord: 'New Record',
  title: 'Title',
  rank: 'Rank',
};

// The lines of the window, from the format strings at 0x00909b58..0x00909c48.
export function resultLines(r: ChallengeResult, s: ResultStrings = RESULT_STRINGS_EN): string[] {
  const out: string[] = [];
  out.push(`${s.clearTime} < ${s.stage}${String.fromCharCode(r.stage + 0x31)} >`);
  out.push(`   ${hmsText(r.runTime)}`);
  if (r.total !== 0) {
    out.push(s.totalTime);
    const { h, m, s: sec } = formatHms(r.total);
    out.push(`  ${pad2(h)}'${pad2(m)}"${pad2(sec)}`);
  }
  if (r.previousBest === 0) {
    out.push(`    ${s.newRecord}`);
  } else {
    const d = r.runTime - r.previousBest;
    if (d === 0) out.push(`   0'00"00`);
    else if (d < 0) out.push(`  -${hmsText(-d)}  ${s.newRecord}`);
    else out.push(`  +${hmsText(d)}`);
  }
  if (r.episodeIndex === 0) {
    out.push(s.title);
    out.push(r.oldTitle === '' || r.oldTitle === r.newTitle ? `  ${r.newTitle}` : `  ${r.oldTitle} -> ${r.newTitle}`);
  }
  if (r.newRank !== 0) {
    out.push(s.rank);
    const name = (n: number) => CM_RANK_LETTERS[n] ?? '';
    out.push(r.oldRank === 0 || r.oldRank === r.newRank ? `  ${name(r.newRank)}` : `  ${name(r.oldRank)} -> ${name(r.newRank)}`);
  }
  return out;
}

// SetTimerText (set_timer_text 0x00761588): "h'mm\"ss", capped at 9'59"59.
export function timerText(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  if (hours >= 10) return `9'59"59`;
  return `${hours}'${pad2(Math.floor((seconds % 3600) / 60))}"${pad2(seconds % 60)}`;
}

// The Area counter window (SetupTitleAndCountInternal_00710ae0): "<Area> NN/NN".
export function areaCounterText(current: number, total: number, label = 'Area'): string {
  return `${label} ${pad2(current)}/${pad2(total)}`;
}

// --- the stage list window (Pioneer 2 Challenge object) ----------------------------------------
// 6x8A (show_challenge_times_window, row 0x8a / perm 2 in the 0x60 table at 0x00a0fba0, handler
// HandleChallengeStageSelection_004dbb20 at 0x004dbb20 -> SetChallengeStageSelectionWindow_004d9d1c
// -> UpdateChallengeStageListWindow_004dc350). The sender is the leader's challenge entity
// (UpdateChallengeEntityProgress_004d9848, 0x004d9848), which the port does not run.
// The index is the u32 at body +4. 0 closes the window; 1 and 2 are the Records overviews of
// Episode 1 and 2; 3..11 are Episode 1 stages 1..9; 12..16 are Episode 2 stages 1..5.
export const CM_STAGE_LIST_MAX = 16;

// The strings the window uses: unitxt group 12 (0x4f "Records", 0x50 "Current Stage ", 0x51
// "No Record", 0x52 "All stages cleared", 0x53 "Stage "). The separators are the exe's own
// strings: 0x00909980 "< %s >\n", 0x00909990 "\n    ", 0x009099c4 "\n  ", 0x009099cc "      ",
// 0x00909a28 "  ", 0x00909a30 "%1d'%02d\"%02d\n" (the time).
export interface StageListStrings {
  records: string;
  current: string;
  noRecord: string;
  allCleared: string;
  stage: string;
}
export const STAGE_LIST_STRINGS_EN: StageListStrings = {
  records: 'Records',
  current: 'Current Stage ',
  noRecord: 'No Record',
  allCleared: 'All stages cleared',
  stage: 'Stage ',
};

// The leading valid stage times of an episode (the count GetValidChallengeStageCount_004da298 returns).
export function validStageCount(records: ChallengeRecords, e: number): number {
  let n = 0;
  while (n < CM_STAGE_COUNT[e]! && records.time(e, n) !== 0) n++;
  return n;
}

// The window's lines (UpdateChallengeStageListWindow_004dc350 / ..Content_004dc6ac), or null for
// index 0 or an index out of range. A completed stage (its time is set) has a first column: the
// episode's total (the sum of its stage times, the exe's stack slot E+0x64 passed to
// FormatTimeToHoursMinutesSeconds_004da01c) and the rank letter `CM_RANK_LETTERS[rank]` in the
// exe's "%02d'%02d\"%02d %s" (0x00909a04). A rank of 0 leaves 12 spaces (0x009099dc). The exe
// reads the rank as (&g_ChallengeStageNames)[n]; the table at 0x009b0ff4 holds "", "B", "A", "S".
export function stageListLines(
  index: number,
  players: readonly { name: string; records: ChallengeRecords }[],
  s: StageListStrings = STAGE_LIST_STRINGS_EN,
): string[] | null {
  if (!Number.isInteger(index) || index <= 0 || index > CM_STAGE_LIST_MAX) return null;
  let text = '';
  if (index <= 2) {
    const e = index - 1;
    text = `< ${s.records} >\n`;
    for (const p of players) {
      const n = validStageCount(p.records, e);
      const count = n < CM_STAGE_COUNT[e]! ? (n === 0 ? s.noRecord : `${s.current}${pad2(n)}`) : s.allCleared;
      text += `${p.name}\n    ${count}\n`;
    }
  } else {
    const e = index <= 11 ? 0 : 1;
    const k = e === 0 ? index - 3 : index - 12;
    text = `< ${s.stage}${k + 1} >\n`;
    for (const p of players) {
      text += `${p.name}\n  `;
      const t = p.records.time(e, k);
      if (t === 0) {
        text += `      ${s.noRecord}\n`;
        continue;
      }
      const rank = p.records.rank;
      const first = rank === 0 ? ' '.repeat(12) : `${hmsTotal(p.records.sumTimes(e))} ${CM_RANK_LETTERS[rank] ?? ''}`;
      text += `${first}  ${hmsText(t)}\n`;
    }
  }
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// The index of a 6x8A body (its u32 at +4, the exe's *(int *)(param_1 + 4)).
export function parseStageListIndex(b: Uint8Array): number | null {
  if (b.length < 8) return null;
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true);
}

// The 6x8A the leader sends (exec_packet0x60_subcommand0x8a, 0x004db990): bytes 0x8a, 2 (dwords),
// 0, 0, then the index as the u32 at +4. checked_call_packet0x60_subcommand (0x008003e0) sends it
// and then runs the same handler locally, so the leader's own window follows.
export function buildStageListIndex(index: number): Uint8Array {
  return sixX(0x8a, u32(index));
}

// --- the Pioneer 2 challenge quest dialog and the leader's 6x8A sender --------------------------
// g_pChallengeQuestDialogWindow (0x00a96180) is the QuestSelectionDialog (vtable 0x00b3c080,
// QuestSelectionDialog_Constructor_006cfde8). GameListMenu_EnterCreatePartyState_006cd2d4 builds it
// when the Hunter's Guild counter (CreateMedicalCenterDialog_006cafb8 -> MedicalCenterDialog_
// Constructor_006cd830, the leader in a logged-in scene) enters its state 8. Its own state machine
// (the input that moves +0x78, the list builders) is NOT ported: only the fields below, which the
// sender reads, are modelled, and the port has no code that opens the dialog yet.
export interface ChallengeQuestDialog {
  // +0x38 != 0: the dialog is built (the window state reads this, the progress does not).
  built: boolean;
  // +0x78: 0 = the episode choice (window state 1), 1 / 2 = a quest choice (window state 2, or 3
  // while g_ChallengeQuestSelectionState is 1). The writers are not ported.
  state: number;
  // +0x40 != 0: the quest header is read. The header is MedicalCenterDialogDataBuffer_00a96080
  // (0x248 bytes, copied by HandleChallengeMenuUpdate_006ccaa8).
  headerRead: boolean;
  // *(0x00a96080) + 4: the quest number in that header (ASSUMED: 0x33..0x3b = Episode 1 stages
  // 1..9, 0x3d..0x41 = Episode 2 stages 1..5, from the ranges the sender tests).
  quest: number;
}

// get_challenge_quest_window_state (0x006d0584). selection = g_ChallengeQuestSelectionState
// (0x00a96168, written 0 / 1 at 0x006d02cc..0x006d02e9). Returns 0 closed, 1 episode choice,
// 2 quest choice, 3 quest choice with the selection flag.
export function challengeWindowState(d: ChallengeQuestDialog | null, selection: number): number {
  if (!d || !d.built) return 0;
  if (d.state === 0) return 1;
  if (d.state < 0 || d.state > 2) return 0;
  return selection === 1 ? 3 : 2;
}

// GetChallengeEntityProgress_006cb310 -> 0x006d0524: the quest number when the header is read,
// -1 otherwise. The dialog's +0x38 is not tested here.
export function challengeQuestProgress(d: ChallengeQuestDialog | null): number {
  return d && d.headerRead ? d.quest : -1;
}

export interface ChallengeSenderStep {
  // The entity's 30-tick counter (+0x2c) after this step.
  counter: number;
  // The index to send with 6x8A, or null for no send.
  send: number | null;
}

// UpdateChallengeEntityProgress_004d9848 (0x004d9848), one step. Only the leader runs it
// (g_CurrentPlayerSlotIndex == g_PartyLeaderIdx). windowState / progress are the two getters
// above; selected is maybe_currently_selected_challenge_stage_window (0x00a48c28).
//   window 2: index 1, or progress - 0x30 when progress is 0x33..0x3b;
//   window 3: index 2, or progress - 0x31 when progress is 0x3d..0x41;
//   a window 2 / 3 with no match: the counter is set to 30 and the index stays 1 / 2;
//   any other window: index 0 and the counter counts down, clamped at 0.
// The send is (counter < 1 || index != 0) && index != selected (the asm at 0x004d98bf..c7).
// Where the index is nonzero the counter does not matter, so the send is index != selected.
export function challengeSenderStep(counter: number, leader: boolean, windowState: number, progress: number, selected: number): ChallengeSenderStep {
  if (!leader) return { counter, send: null };
  let index = 0;
  let next = counter;
  let value: number; // the eax the asm tests at 0x004d98bf
  let matched = false;
  if (windowState === 2) {
    index = 1;
    if (progress >= 0x33 && progress <= 0x3b) {
      index = progress - 0x30;
      matched = true;
    }
  } else if (windowState === 3) {
    index = 2;
    if (progress >= 0x3d && progress <= 0x41) {
      index = progress - 0x31;
      matched = true;
    }
  }
  if (matched) {
    value = progress;
  } else if (windowState === 2 || windowState === 3) {
    next = 30;
    value = 30;
  } else {
    next = Math.max(0, counter - 1);
    value = next;
  }
  const send = (value < 1 || index !== 0) && index !== selected;
  return { counter: next, send: send ? index : null };
}

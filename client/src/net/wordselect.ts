// Word select (BB): the word table the exe reads for the word select chat, and the 6x74
// receive side (handle_packet0x60_subcommand0x74, dump 664363).
//
// Data (read at runtime from the client's own data folder, never committed): the exe loads
// the JP locale through LoadLocaleData_00705eb8 (dump 662480): the phrases from
// ParseUnitxtFileList(s_LocaleFile_WordSelect_JP) = unitxt_ws_j.prs (the unitxt group 0 list
// below), and the table from s_WorldSelectLocaleData_JP = ws_data_jp.bin (LoadAndProcessRelAsset).
// The table file is PRC (u32 size, u32 seed, PRS under the V2 cipher) with a REL footer. Its
// root (footer +0x10) is newserv's BBRoot: u32 table1, table2, token_id_to_string_id, table4,
// article_types, table6. token_id_to_string_id is u16[0x68C]: token id -> phrase index in the
// group 0 list. newserv's WordSelectSet parses the same file for BB_V4 (vendor/newserv
// src/WordSelectTable.cc, parse_windows_t<BBRoot, 0x68C>).
//
// The JP phrase text is built by the exe's selection-type renderer (WordSelectMenu_
// ProcessSelectionType_00703690, dump 659612, and its helpers). That renderer is not
// ported here: see DEVLOG 2026-10-23 (word select receive). This module supplies the table,
// the message parse, and the receive-side item selection (SetSelectedItemID_007078a0).
// MIT license for the layout notes (newserv).

import { prcDecompress } from '../formats/prc.ts';
import { RelFile } from '../formats/rel.ts';
import { parseUnitxt } from '../classic/charcreate_text.ts';
import { parseWordSelectMessage, WORD_SELECT_SUBCOMMAND, type WordSelectMessage } from './chatshortcut.ts';

export const WORD_SELECT_DATA_FILE = 'ws_data_jp.bin';
export const WORD_SELECT_TEXT_FILE = 'unitxt_ws_j.prs';
export const WORD_SELECT_TOKEN_COUNT = 0x68c; // BB token count (newserv BB_V4 parse)
const BB_ROOT_TOKEN_TABLE = 8; // BBRoot.token_id_to_string_id_table (u32 at root + 8)
const NO_PHRASE = 0xffff;

export interface WordSelectTable {
  // Token id -> phrase index (0xFFFF = none).
  tokenToPhrase: number[];
  // The phrases (unitxt_ws group 0).
  phrases: string[];
  // table1 and table2 (root +0 and +4): each entry is a u16 list at {u32 offset, u32 count}.
  // Read by the exe's JP case of LoadLocaleData_00705eb8 (only gp[0..2] are read for JP;
  // table4 / article types / table6 are null in ws_data_jp.bin). See classic/wordselectmenu.ts.
  list1: number[][];
  list2: number[][];
}

// JP counts from the exe's LoadLocaleData_00705eb8 (g_ListItemCount 0x11A, g_WordSelectItemCount 0x12).
export const WORD_SELECT_JP_LIST1_COUNT = 0x11a;
export const WORD_SELECT_JP_LIST2_COUNT = 0x12;

// The {u32 offset, u32 count}[count] pointer array at `at`, each target a u16[count] list. An entry
// that runs past the data reads as an empty list (the exe does not check; this port does).
function readPointerLists(rel: RelFile, at: number, count: number): number[][] {
  const out: number[][] = [];
  const len = rel.data.length;
  for (let i = 0; i < count; i++) {
    const e = at + i * 8;
    if (e + 8 > len) {
      out.push([]);
      continue;
    }
    const off = rel.u32(e);
    const n = rel.u32(e + 4);
    const list: number[] = [];
    if (off + n * 2 <= len) for (let k = 0; k < n; k++) list.push(rel.u16(off + k * 2));
    out.push(list);
  }
  return out;
}

// The decompressed table (PRC already undone) with its phrase list.
export function parseWordSelectTable(
  decompressed: Uint8Array,
  phrases: string[],
  list1Count = WORD_SELECT_JP_LIST1_COUNT,
  list2Count = WORD_SELECT_JP_LIST2_COUNT,
): WordSelectTable {
  const rel = new RelFile(decompressed);
  const table = rel.u32(rel.root + BB_ROOT_TOKEN_TABLE);
  const tokenToPhrase: number[] = [];
  for (let i = 0; i < WORD_SELECT_TOKEN_COUNT; i++) {
    const at = table + i * 2;
    tokenToPhrase.push(at + 2 <= decompressed.length ? rel.u16(at) : NO_PHRASE);
  }
  const list1 = readPointerLists(rel, rel.u32(rel.root), list1Count);
  const list2 = readPointerLists(rel, rel.u32(rel.root + 4), list2Count);
  return { tokenToPhrase, phrases, list1, list2 };
}

// The two files as the client has them (the PRC table and the unitxt_ws PRS text).
export function loadWordSelectTable(dataFile: Uint8Array, textFile: Uint8Array): WordSelectTable {
  const phrases = parseUnitxt(textFile)[0] ?? [];
  return parseWordSelectTable(prcDecompress(dataFile), phrases);
}

// The phrase of a token ('' for an unknown token or a missing table).
export function wordSelectPhrase(table: WordSelectTable | null, token: number): string {
  if (!table || token < 0 || token >= table.tokenToPhrase.length) return '';
  const p = table.tokenToPhrase[token];
  return p === NO_PHRASE ? '' : (table.phrases[p] ?? '');
}

// 6x74 (G_WordSelect_6x74, newserv CommandFormats.hh): subcommand, size, client id (u16 at +2),
// the 0x1C message at +4. Null when the body is too short or not a 6x74.
export function parseWordSelectSubcommand(body: Uint8Array): { clientId: number; message: WordSelectMessage } | null {
  if (body.length < 4 + 0x1c || body[0] !== WORD_SELECT_SUBCOMMAND) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { clientId: dv.getUint16(2, true), message: parseWordSelectMessage(body, 4) };
}

// SetSelectedItemID_007078a0 (dump, after handle_packet0x60_subcommand0x74): on a message whose second u16 (target_type) is 1,
// the first token is the selected item id when it lies in (0x7e, 0x139) (IsValidItemIDRange_007078cd).
// Applied only when the sender is not this client (handle_packet0x60_subcommand0x74 checks
// client_id != g_CurrentPlayerSlotIndex first). Returns the id, or null.
export function wordSelectItemId(message: WordSelectMessage): number | null {
  if (message.targetType !== 1) return null;
  const id = message.tokens[0] << 16 >> 16;
  return id > 0x7e && id < 0x139 ? id : null;
}

// ---- The text: the JP renderer (word_select_locale 0) ----
//
// WordSelectMenu_ProcessStringByLocale_0070717d (dump 663949) calls, for the JP locale,
// WordSelectMenu_ProcessSelectionType_00703690 (dump 659612) with the message (EAX) and the
// buffer. DisplayItemBubble_007078f1 (dump 664497) passes the buffer to DisplayChatBubble with
// flags 0x4F. The shape of the code below follows the exe's asm (objdump of PsoBB.exe at
// 0x703690..0x7038d8, 0x706490, 0x7064d8..0x706569, 0x7069fc..0x706b6d; checked against the
// decompile). The buffer is 0x80 wide characters: an append that would reach 0x80 is skipped.

const BUF_CAP = 0x80;
const NEWLINE = 0x0a;
const SPACE = 0x20;
const WRAP_COLUMNS = 0x10;
const PLAYER_TOKEN_FIRST = 0x68c; // GetStringResource_0070651d: 0x68C..0x697 are the 12 player names
const PLAYER_TOKEN_LAST = 0x697;
const PLAYER_TOKEN_EMPTY = 0x698; // the exe returns NULL for it
const NAME_CHARS = 0x18; // _wcsncpy(name, 0x18) in handle_packet0x60_subcommand0x74

// DAT_0096e714 (exe data): the largest value a numeric parameter is shown with, per string class.
// Class 6 holds 1.0f as bits (its text is never drawn), so it is effectively unlimited here.
const NUMBER_LIMIT = [999999, 99, 30, 15, 200, 999, Number.MAX_SAFE_INTEGER];

// The player name of a slot (0..11); '' for an empty slot.
export type WordSelectNames = (slot: number) => string;
// The phrase of a token: the text, '' when there is none, or null (the exe's NULL pointer).
export type WordSelectPhrase = (token: number) => string | null;

// GetWordSelectStringType_00706831: the class of a token (0..5, or 7 for a plain phrase).
export function wordSelectStringType(token: number): number {
  if (token === 0x2e4) return 0;
  if (token > 0x2ff && token < 0x396) return 1; // IsStringIdInGroupA_007068b1
  if (token > 0x45c && token < 0x470 && token !== 0x46d && token !== 0x46e) return 2; // IsStringIdInGroupB_007068d1
  if (token === 0x4f3) return 3;
  if (token === 0x635) return 4;
  if (token === 0x650) return 5;
  return 7;
}

// The exe's wide buffer with its cap rules (AppendStringToBuffer_007067f0, AppendWideChar_0070625c,
// AppendWordSelectEntry_007069b8, WrapTextAtNewline_00706284, HandleLineBreaks_00706904).
class WordSelectBuffer {
  readonly chars: number[] = [];

  private get len(): number {
    return this.chars.length;
  }

  // A phrase: appended only when it fits with its terminator (len + n + 1 < 0x80).
  plain(s: string | null): void {
    if (s === null) return;
    if (this.len + s.length + 1 >= BUF_CAP) return;
    for (let i = 0; i < s.length; i++) this.chars.push(s.charCodeAt(i));
  }

  char(c: number): void {
    if (this.len + 2 < BUF_CAP) this.chars.push(c);
  }

  // "\n> " (AppendWordSelectEntry_007069b8): needs len + 4 < 0x80.
  entry(): void {
    if (this.len + 4 < BUF_CAP) this.chars.push(NEWLINE, 0x3e, SPACE);
  }

  // Characters after the last newline (the exe scans back from the end).
  lineLength(): number {
    for (let i = this.len - 1; i >= 0; i--) if (this.chars[i] === NEWLINE) return this.len - 1 - i;
    return this.len;
  }

  // WrapTextAtNewline_00706284: a newline when the line has 16 or more characters.
  wrap(): void {
    if (this.lineLength() >= WRAP_COLUMNS) this.char(NEWLINE);
  }

  // HandleLineBreaks_00706904: a newline when the line has 16 or more characters, else a space.
  lineBreak(): void {
    this.char(this.lineLength() >= WRAP_COLUMNS ? NEWLINE : SPACE);
  }
}

function toInt16(v: number): number {
  return (v << 16) >> 16;
}

// The typed phrase (AppendStringToBuffer_00706569, reached through AppendResourceString_007064d8):
// the message's numeric parameter (msg +0x14) is shown with the phrase, per the token's class.
// JP order: class 0 and 5 = number then phrase; 1 = phrase "+" number; 2 = phrase " Lv." number;
// 3 and 4 = phrase number; 6 = nothing. A parameter <= 0 gives the plain phrase.
function appendTyped(buf: WordSelectBuffer, m: WordSelectMessage, token: number, phrase: WordSelectPhrase): void {
  const type = wordSelectStringType(token);
  const text = phrase(token);
  if (type === 7) return buf.plain(text);
  const n = m.numericParameter | 0;
  if (n <= 0) return buf.plain(text);
  const num = String(Math.min(n, NUMBER_LIMIT[type]));
  switch (type) {
    case 1:
      buf.plain(text);
      buf.char(0x2b); // '+'
      return buf.plain(num);
    case 2:
      buf.plain(text);
      buf.plain(' Lv.');
      return buf.plain(num);
    case 3:
    case 4:
      buf.plain(text);
      return buf.plain(num);
    case 6:
      return;
    default: // 0 and 5 (the JP locale has no space here)
      buf.plain(num);
      return buf.plain(text);
  }
}

// WordSelectMenu_ProcessSelectionType_00703690 for the JP locale: the message's count (msg +0),
// selection type (msg +2, 1..6) and tokens (msg +4). Returns the text the balloon shows.
export function renderWordSelectJP(m: WordSelectMessage, phrase: WordSelectPhrase): string {
  const count = toInt16(m.numTokens);
  if (count <= 0) return '';
  const buf = new WordSelectBuffer();
  const tok = (i: number): number => toInt16(m.tokens[i] ?? 0);
  const plainAt = (i: number): void => buf.plain(phrase(tok(i)));
  // The run of typed tokens: a line wrap before each token except the third (asm 0x7036ed..0x703719).
  const typedRun = (n: number): void => {
    for (let i = 0; i < n; i++) {
      if (i !== 2) buf.wrap();
      appendTyped(buf, m, tok(i), phrase);
    }
  };
  switch (toInt16(m.targetType)) {
    case 1: // ProcessWordSelectStringData_00706490: the first token typed; a second token after "\n> "
      appendTyped(buf, m, tok(0), phrase);
      if (count > 1) {
        buf.entry();
        plainAt(1);
      }
      break;
    case 2: // two phrases, "?", then "\n> " and the third phrase
      for (let i = 0; i < Math.min(count, 2); i++) plainAt(i);
      buf.char(0x3f);
      if (count > 2) {
        buf.entry();
        plainAt(2);
      }
      break;
    case 3: // up to three typed tokens with wraps; a fourth after "\n> "
      typedRun(Math.min(count, 3));
      if (count > 3) {
        buf.entry();
        plainAt(3);
      }
      break;
    case 4: // third typed; wrap, second, fourth; then "\n> " and the first
      if (count > 2) appendTyped(buf, m, tok(2), phrase);
      if (count > 1) {
        buf.wrap();
        plainAt(1);
        if (count > 3) plainAt(3);
      }
      buf.entry();
      plainAt(0);
      break;
    case 5: // every token typed, with the wrap rule
      typedRun(count);
      break;
    case 6: {
      // up to three phrases, each but the last followed by a line break; then "\n> " and the fourth
      const n = Math.min(count, 3);
      for (let i = 0; i < n - 1; i++) {
        plainAt(i);
        buf.lineBreak();
      }
      plainAt(n - 1);
      if (count > 3) {
        buf.entry();
        plainAt(3);
      }
      break;
    }
    default:
      break;
  }
  return String.fromCharCode(...buf.chars);
}

// The phrase lookup of GetStringResource_0070651d over the table and the player names.
export function wordSelectPhraseOf(table: WordSelectTable | null, names: WordSelectNames): WordSelectPhrase {
  return (token) => {
    if (token >= PLAYER_TOKEN_FIRST && token <= PLAYER_TOKEN_LAST) return (names(token - PLAYER_TOKEN_FIRST) ?? '').slice(0, NAME_CHARS);
    if (token === PLAYER_TOKEN_EMPTY || token < 0 || token >= PLAYER_TOKEN_FIRST) return null;
    return wordSelectPhrase(table, token);
  };
}

// The balloon text of a received (or sent) word select message.
export function renderWordSelect(m: WordSelectMessage, table: WordSelectTable | null, names: WordSelectNames): string {
  return renderWordSelectJP(m, wordSelectPhraseOf(table, names));
}

// The table the screens use (loaded once from the client's data folder; null without it).
let activeTable: WordSelectTable | null = null;
export function setWordSelectTable(t: WordSelectTable | null): void {
  activeTable = t;
}
export function currentWordSelectTable(): WordSelectTable | null {
  return activeTable;
}

// Loads the two JP files from the client's data (ClientFiles). False when either is missing.
export async function loadWordSelectFromFiles(files: {
  has(name: string): Promise<boolean>;
  read(name: string): Promise<Uint8Array>;
}): Promise<boolean> {
  if (!(await files.has(WORD_SELECT_DATA_FILE)) || !(await files.has(WORD_SELECT_TEXT_FILE))) return false;
  activeTable = loadWordSelectTable(await files.read(WORD_SELECT_DATA_FILE), await files.read(WORD_SELECT_TEXT_FILE));
  return true;
}

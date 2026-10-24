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
}

// The decompressed table (PRC already undone) with its phrase list.
export function parseWordSelectTable(decompressed: Uint8Array, phrases: string[]): WordSelectTable {
  const rel = new RelFile(decompressed);
  const table = rel.u32(rel.root + BB_ROOT_TOKEN_TABLE);
  const tokenToPhrase: number[] = [];
  for (let i = 0; i < WORD_SELECT_TOKEN_COUNT; i++) {
    const at = table + i * 2;
    tokenToPhrase.push(at + 2 <= decompressed.length ? rel.u16(at) : NO_PHRASE);
  }
  return { tokenToPhrase, phrases };
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

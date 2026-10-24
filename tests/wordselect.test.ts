// Word select (BB): the token table (net/wordselect.ts parseWordSelectTable), the 6x74 subcommand
// parse, and the receive-side item selection (SetSelectedItemID_007078a0). The table is built
// in memory with a REL footer and newserv's BBRoot (token table at root + 8). The real JP file
// (ws_data_jp.bin, read from the client data folder) is checked only when it is present.
// Run: node tests/wordselect.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  loadWordSelectTable,
  parseWordSelectSubcommand,
  parseWordSelectTable,
  wordSelectItemId,
  wordSelectPhrase,
  WORD_SELECT_TOKEN_COUNT,
} from '../client/src/net/wordselect.ts';
import { wordSelectSubcommandPayload, type WordSelectMessage } from '../client/src/net/chatshortcut.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// A decompressed table: root (0x18 bytes) at 0x100 with table1..6, the token table at 0x200,
// and the REL footer (root offset at length - 0x10).
function buildTable(tokenToPhrase: number[]): Uint8Array {
  const tokenOffset = 0x200;
  const len = tokenOffset + WORD_SELECT_TOKEN_COUNT * 2 + 0x20;
  const data = new Uint8Array(len);
  const dv = new DataView(data.buffer);
  const root = 0x100;
  dv.setUint32(root + 8, tokenOffset, true);
  dv.setUint32(len - 0x10, root, true);
  for (let i = 0; i < WORD_SELECT_TOKEN_COUNT; i++) {
    dv.setUint16(tokenOffset + i * 2, i < tokenToPhrase.length ? tokenToPhrase[i] : 0xffff, true);
  }
  return data;
}

const phrases = ['Are you free?', 'Let\'s team up!', 'Please select a subject.'];
const table = parseWordSelectTable(buildTable([2, 0, 1]), phrases);

eq(table.tokenToPhrase.length, WORD_SELECT_TOKEN_COUNT, 'token count is the BB 0x68C');
eq(wordSelectPhrase(table, 0), 'Please select a subject.', 'token 0 -> phrase index 2');
eq(wordSelectPhrase(table, 1), 'Are you free?', 'token 1 -> phrase 0');
eq(wordSelectPhrase(table, 2), "Let's team up!", 'token 2 -> phrase 1');
eq(wordSelectPhrase(table, 3), '', 'a token past the list has no phrase (0xFFFF)');
eq(wordSelectPhrase(table, WORD_SELECT_TOKEN_COUNT), '', 'a token past the table is empty');
eq(wordSelectPhrase(null, 0), '', 'no table: empty');

// 6x74 parse: subcommand 0x74, size 8, client id u16 at +2, the message at +4.
const msg: WordSelectMessage = {
  numTokens: 2,
  targetType: 1,
  tokens: [0x80, 0x90, 0xffff, 0, 0, 0, 0, 0],
  numericParameter: 0x1234,
  unknownA4: 7,
};
const body = new Uint8Array(4 + 0x1c);
body[0] = 0x74;
body[1] = 8;
new DataView(body.buffer).setUint16(2, 3, true);
body.set(wordSelectSubcommandPayload(msg), 4);
const parsed = parseWordSelectSubcommand(body);
eq(parsed?.clientId, 3, 'the 6x74 client id');
eq(parsed?.message, msg, 'the 6x74 message round trip');
eq(parseWordSelectSubcommand(body.subarray(0, 0x10)), null, 'a short 6x74 is refused');
body[0] = 0x07;
eq(parseWordSelectSubcommand(body), null, 'another subcommand is refused');

// SetSelectedItemID: target_type 1 and the first token in (0x7e, 0x139).
eq(wordSelectItemId(msg), 0x80, 'a valid item id is selected');
eq(wordSelectItemId({ ...msg, tokens: [0x7e, 0, 0, 0, 0, 0, 0, 0] }), null, '0x7e is out of range');
eq(wordSelectItemId({ ...msg, tokens: [0x139, 0, 0, 0, 0, 0, 0, 0] }), null, '0x139 is out of range');
eq(wordSelectItemId({ ...msg, tokens: [0x138, 0, 0, 0, 0, 0, 0, 0] }), 0x138, '0x138 is in range');
eq(wordSelectItemId({ ...msg, targetType: 2 }), null, 'only target type 1 selects');

// The real JP table, when the client data folder has it (never committed; the path is the
// default client data folder).
const dataDir = process.env.PSOBB_CLIENT_DATA ?? join(homedir(), 'Downloads', 'psobb-client', 'data');
const dataPath = join(dataDir, 'ws_data_jp.bin');
const textPath = join(dataDir, 'unitxt_ws_j.prs');
if (existsSync(dataPath) && existsSync(textPath)) {
  const real = loadWordSelectTable(new Uint8Array(readFileSync(dataPath)), new Uint8Array(readFileSync(textPath)));
  eq(real.tokenToPhrase.length, WORD_SELECT_TOKEN_COUNT, 'real JP table: token count');
  eq(wordSelectPhrase(real, 0x7f), 'Are you free?', 'real JP table: token 0x7F');
  eq(wordSelectPhrase(real, 0x68b), 'Please select a subject.', 'real JP table: token 0x68B');
} else {
  console.log(`SKIP real JP table (no ${dataPath})`);
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('wordselect: all tests passed');

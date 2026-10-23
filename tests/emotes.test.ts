// Emotes (client/src/formats/emotes.ts): the symbol-chat keys and their slots
// (the emote getters of the motion sets, PsoBB.exe 0x006a7584..0x006a7704), the
// {key} parse of process_chat_message, the queue of 10, the 6x58 body (newserv
// G_LobbyAnimation_6x58) and the field records (plyemotedata.ts, generated from
// the field tables 0x009cbeec / 0x009cbf04).
// Run: node tests/emotes.test.ts
import {
  EMOTE_KEYS,
  EMOTE_OPCODE,
  EMOTE_SLOTS,
  EmoteQueue,
  emotePayload,
  emoteRecord,
  emoteSlot,
  parseEmoteKeys,
  parseEmoteSubcommand,
} from '../client/src/formats/emotes.ts';
import { FIELD_EMOTE_ROWS, FIELD_EMOTE_SLOTS } from '../client/src/formats/plyemotedata.ts';
import { townMotion } from '../client/src/formats/plymotion.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// 46 keys: F1-F12, the letters without i and u, 0-9 (szEmote_* at 0x0097957c..0x00979660).
eq(EMOTE_KEYS.length, 46, 'key count');
eq(new Set(EMOTE_KEYS).size, 46, 'keys are unique');
eq(EMOTE_KEYS.includes('i') || EMOTE_KEYS.includes('u'), false, 'no i or u key');

// Every key has a slot in both maps; town slots fit the 56-slot town set, field
// slots are the field table's emote slots.
for (const k of EMOTE_KEYS) {
  const t = EMOTE_SLOTS.town[k];
  const f = EMOTE_SLOTS.field[k];
  if (t === undefined || f === undefined) failures++, console.log(`FAIL no slot for ${k}`);
  if (t !== undefined && (t < 0 || t >= 56)) failures++, console.log(`FAIL town slot ${k} ${t}`);
  if (f !== undefined && !FIELD_EMOTE_SLOTS.includes(f)) failures++, console.log(`FAIL field slot ${k} ${f}`);
}
eq([EMOTE_SLOTS.town.f1, EMOTE_SLOTS.field.f1], [6, 9], 'F1 town 6 / field 9');
eq([EMOTE_SLOTS.town['1'], EMOTE_SLOTS.field['1']], [50, 66], '1 town 50 / field 66');
eq([EMOTE_SLOTS.town.a, EMOTE_SLOTS.field.a], [42, 58], 'a town 42 / field 58');
eq(emoteSlot('zz', false), undefined, 'unknown key has no slot');
eq(emoteSlot('a', true), 58, 'emoteSlot field');

// Field rows: 6 types x 46 slots x 19 weapon columns.
eq(FIELD_EMOTE_ROWS.length, 6, 'field types');
eq(FIELD_EMOTE_ROWS.every((t) => t.length === 46 && t.every((s) => s.length === 19)), true, 'field row shape');

// Chat parse (process_chat_message): braces, lower case, the 16-character cap.
eq(parseEmoteKeys('hi {f1} there {A}'), ['f1', 'a'], 'two keys in a line');
eq(parseEmoteKeys('{F12}{f2}'), ['f12', 'f2'], 'upper case and adjacent keys');
eq(parseEmoteKeys('{xx}'), [], 'unknown name');
eq(parseEmoteKeys('{f1'), [], 'unterminated brace');
eq(parseEmoteKeys('plain text'), [], 'no braces');
eq(parseEmoteKeys('{abcdefghijklmnopq}'), [], 'name longer than 16 characters');
eq(parseEmoteKeys('{f1 }'), [], 'a space is part of the name');

// Queue: 10 entries, played in order.
const q = new EmoteQueue();
q.push(parseEmoteKeys('{f1}{f2}{f3}{f4}{f5}{f6}{f7}{f8}{f9}{f10}{f11}{f12}'));
eq(q.length, 10, 'queue holds 10');
eq(q.head(), 'f1', 'head is the first key');
q.shift();
eq(q.head(), 'f2', 'second key next');

// 6x58 body: u8 0x58, u8 2, u16 client id, u16 emote, u16 flags (8 bytes).
const payload = emotePayload(12, true);
eq(Array.from(payload), [12, 0, 1, 0], 'payload: emote then flags');
const body = new Uint8Array(8);
body[0] = EMOTE_OPCODE;
body[1] = 2;
body[2] = 7;
body.set(payload, 4);
eq(parseEmoteSubcommand(body), { clientId: 7, slot: 12, opposite: true }, 'parse a 6x58 body');
eq(parseEmoteSubcommand(new Uint8Array([0x59, 2, 0, 0, 0, 0, 0, 0])), null, 'other subcommand');
eq(parseEmoteSubcommand(new Uint8Array([0x58, 2, 0, 0])), null, 'short body');
eq(parseEmoteSubcommand(Uint8Array.from([0x58, 2, 3, 0, 9, 0, 0, 0])).opposite, false, 'flags 0 is not opposite');

// Town record: the town set's slot (male set 0, row 6 = 202, mode 3, 1.4, 0x20000040).
eq(townMotion(0, 6).index, 202, 'town slot 6 for class 0');
const town6 = emoteRecord(0, 0, 6, false);
eq([town6.index, town6.mode, town6.speed, town6.flags], [202, 3, 1.4, 0x20000040], 'town emote record');

// Field record: type 0 (male), F1 = slot 9; weapon columns differ (index 202 for
// column 0, 105 for column 1; the same flags 0xa0000040, speed 1.4).
const f0 = emoteRecord(0, 0, 9, true);
const f1 = emoteRecord(0, 1, 9, true);
eq([f0.index, f0.mode, f0.next, f0.speed, f0.flags], [202, 3, -1, 1.4, 0xa0000040], 'field emote, weapon 0');
eq(f1.index, 105, 'field emote, weapon 1');
eq(emoteRecord(0, 99, 9, true).index, 202, 'weapon class out of range uses column 0');
let threw = false;
try {
  emoteRecord(0, 0, 7, true);
} catch {
  threw = true;
}
eq(threw, true, 'a slot that is not a field emote slot throws');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('emotes: all checks passed');

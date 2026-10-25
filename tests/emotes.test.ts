// Emotes (client/src/formats/emotes.ts): the symbol-chat keys and their slots
// (the emote getters of the motion sets, PsoBB.exe 0x006a7584..0x006a7704), the
// {key} parse of process_chat_message, the queue of 10, the 6x58 body (newserv
// G_LobbyAnimation_6x58) and the field records (plyemotedata.ts, generated from
// the field tables 0x009cbeec / 0x009cbf04).
// Run: node tests/emotes.test.ts
import { setPositionBody } from '../client/src/net/game.ts';
import {
  ALT_EMOTE_ORDER,
  altEmoteKey,
  chatLineSends,
  chatSendValue,
  sitEndKey,
  sitStandsUp,
  EMOTE_KEYS,
  EMOTE_OPCODE,
  EMOTE_SLOTS,
  EmoteQueue,
  emotePayload,
  emoteRecord,
  emoteSlot,
  parseEmoteKeys,
  parseEmoteSubcommand,
  parseSitSubcommand,
  sitPayload,
  SIT_SLOT_CHAIR,
  SIT_SLOT_PLAIN,
} from '../client/src/formats/emotes.ts';
import { FIELD_EMOTE_ROWS, FIELD_EMOTE_SLOTS } from '../client/src/formats/plyemotedata.ts';
import { townMotion } from '../client/src/formats/plymotion.ts';
import { stopBody } from '../client/src/net/lobby.ts';

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

// Sit (6xAB): the body is u8 0xAB, u8 2, u16 client id, u16 0, u16 flags; flag 2
// (dword 0x20000) is the chair pose (slot 49), flag 1 (0x10000) the option.
{
  const body = new Uint8Array(8);
  body.set(sitPayload(true, true), 4);
  body[0] = 0xab;
  body[1] = 2;
  new DataView(body.buffer).setUint16(2, 0x1234, true);
  eq(parseSitSubcommand(body), { clientId: 0x1234, chair: true, opposite: true }, 'sit body round trip');
  eq(Array.from(sitPayload(false, false)), [0, 0, 0, 0], 'plain sit has no flags');
  eq([SIT_SLOT_PLAIN, SIT_SLOT_CHAIR], [48, 49], 'sit slots are the town getters 0x108 / 0x10c');
  body[0] = 0x58;
  eq(parseSitSubcommand(body), null, 'a 6x58 is not a sit');
}

// Alt block (handle_player_emote_input, named dump 587822..588157): Alt+key plays
// the key's emote in the exe's order, the same keys as the chat keys (checked
// against the getters of the field 0xb39ec0 and the town 0xb3a040 vtables).
{
  eq(ALT_EMOTE_ORDER.length, 46, 'alt block has 46 keys');
  eq([...ALT_EMOTE_ORDER].sort(), [...EMOTE_KEYS].sort(), 'alt block keys are the chat keys');
  eq([ALT_EMOTE_ORDER[0], ALT_EMOTE_ORDER[11], ALT_EMOTE_ORDER[12], ALT_EMOTE_ORDER[45]], ['f1', 'f12', 'm', '4'], 'alt block order');
  eq(altEmoteKey((k) => k === 'a' || k === 'f5'), 'f5', 'the F-keys come before the letters');
  eq(altEmoteKey((k) => k === '1' || k === 'm'), 'm', 'm comes before the digits');
  eq(altEmoteKey(() => false), undefined, 'no edge, no emote');
  eq(altEmoteKey((k) => k === 'u' || k === 'i'), undefined, 'Alt+U / Alt+I are not in the Alt block');
  // Alt+F1 on the field is the field's slot 9, in the town it is 6 (EMOTE_SLOTS).
  eq([emoteSlot(altEmoteKey((k) => k === 'f1') ?? '', true), emoteSlot('f1', false)], [9, 6], 'Alt+F1 slots');
  eq(sitEndKey(false), 'u', 'Alt+U ends the plain sit');
  eq(sitEndKey(true), 'i', 'Alt+I ends the chair sit');
  // 6x3F body (dispatch_action_0x3f_, dump 583247; newserv G_SetPosition_6x3F): guard flag +4,
  // floor +8, room +0xa, xyz +0xc. The body starts after the 4-byte header.
  const body = setPositionBody({ angle: 0, floor: 3, position: { x: 1, y: 2, z: 3 } }, { guard: true, room: 7 });
  const bdv = new DataView(body.buffer);
  eq([bdv.getUint16(0, true), bdv.getInt16(4, true), bdv.getInt16(6, true), bdv.getFloat32(8, true), bdv.getFloat32(12, true), bdv.getFloat32(16, true)], [1, 3, 7, 1, 2, 3], '6x3F guard, floor, room, xyz');
  const plain = setPositionBody({ angle: 0, floor: 0, position: { x: 0, y: 0, z: 0 } }, { guard: false, room: 0 });
  eq(new DataView(plain.buffer).getUint16(0, true), 0, '6x3F guard off');
  eq(plain.length, 0x14, '6x3F body is 20 bytes');
}

// The chat send gate (process_chat_message's value, send_chat_message_text 754354):
// the value is the length less each emote token (braces included) less 2; 0 is
// not sent. Plain two-character lines, and one token with two characters, are not.
eq(chatSendValue('hello'), 3, 'chat value: plain text is length - 2');
eq(chatLineSends('\tEhi'), true, 'chat gate: a two-character line with its \\tE marker is sent');
eq(chatLineSends('\tE'), false, 'chat gate: the marker alone (empty line) is not sent');
eq(chatLineSends(''), false, 'chat gate: an empty line is not sent');
eq(chatSendValue('{f1}'), -2, 'chat value: a token alone is -2 (sent)');
eq(chatLineSends('\tE{f1}'), false, 'chat gate: a token alone with the marker is 0 (only the emote plays)');
eq(chatLineSends('\tE{f1}ab'), true, 'chat gate: token + text is sent');
eq(chatLineSends('{f1}abc'), true, 'chat gate: token + three characters is sent');
eq(chatSendValue('{F1}{Zz}ab'), 4, 'chat value: an unknown name is not a token (its length stays): 10 - 4 - 2');
eq(chatSendValue('{f1}{f2}ab'), 0, 'chat value: two tokens: 10 - 8 - 2 = 0 (not sent)');
{
  const q = new EmoteQueue();
  q.push(parseEmoteKeys('{f1}ab'));
  eq(q.head(), 'f1', 'chat gate: the token still queues when the line is not sent');
}

// The local stand-up (handle_input_state_0xab, LAB_0069c17e): Alt + the sit's key
// on its edge ends the sit and sends move_stop (6x3E, dispatch_action_move_stop).
{
  const none = () => false;
  const down = (k: string) => (key: string) => key === k;
  eq(sitStandsUp(false, true, down('u')), true, 'stand-up: Alt+U ends the plain sit');
  eq(sitStandsUp(false, true, down('i')), false, 'stand-up: Alt+I does not end the plain sit');
  eq(sitStandsUp(true, true, down('i')), true, 'stand-up: Alt+I ends the chair sit');
  eq(sitStandsUp(true, true, down('u')), false, 'stand-up: Alt+U does not end the chair sit');
  eq(sitStandsUp(false, false, down('u')), false, 'stand-up: U without Alt does not end the sit');
  eq(sitStandsUp(true, true, none), false, 'stand-up: no edge, no stand-up');
  const body = stopBody({ x: 1, y: 2, z: 3 }, 0, 4, { guard: true, room: 2 });
  const sdv = new DataView(body.buffer);
  eq([body.length, sdv.getUint16(0, true), sdv.getInt16(4, true), sdv.getInt16(6, true), sdv.getFloat32(8, true), sdv.getFloat32(16, true)], [0x14, 1, 4, 2, 1, 3], 'stand-up 6x3E body: guard, floor, room, x, z');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('emotes: all checks passed');

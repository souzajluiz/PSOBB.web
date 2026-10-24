// Emotes: the symbol-chat keys that play a motion, the 6x58 packet that tells
// the other players, and the motion each key plays (PsoBB.exe, Ephinea build,
// VAs).
//
// Trigger: a chat line with `{key}` in it queues the key (process_chat_message
// 0x0077cbf3..0x0077cd1b, names in emote_key_names, the queue of 10 entries
// `num_queued_emotes < 10`, the text lower-cased, at most 16 characters between
// the braces). The queue head is played when the player is in the idle or
// move state: ProcessPlayerEmote_0077cec0 maps the key to the motion set's
// getter (vtable +off) and that getter's value is the emote id, which is the
// motion slot of the set (plymotion.ts).
//
// Wire (6x58, `G_LobbyAnimation_6x58` in newserv, 8 bytes): u8 0x58, u8 2
// (size in dwords), u16 client id, u16 emote id (the slot), u16 flags (bit 0
// = the character option 0x80000 is set, newserv "use opposite gender's
// animation"). The sender is dispatch_action_emote 0x0069c74c; the receiver
// FUN_0069b2d4 stores the emote into the player's +0x3cc and sets the state
// 0x17 (handle_input_state_emote) with the emote as its motion slot.
//
// Emote slots: the getter values of the set. Town (lobby, vtable 0x00b3a040)
// and field (vtable 0x00b39ec0) differ, so the sender's emote id follows its
// map (EMOTE_SLOTS.town in the lobby, .field in a game); both ends are in the
// same map kind, so a slot means the same motion for the receiver.

import { MOTION_TYPE, townMotion, type MotionRecord } from './plymotion.ts';
import { FIELD_EMOTE_FLAGS, FIELD_EMOTE_ROWS, FIELD_EMOTE_SLOTS } from './plyemotedata.ts';

export const EMOTE_OPCODE = 0x58;
export const EMOTE_QUEUE_MAX = 10; // process_chat_message: num_queued_emotes < 10
export const EMOTE_NAME_MAX = 16; // the name buffer of process_chat_message (local_24[16])

// The 46 symbol-chat emote keys (emote_key_names / szEmote_* 0x0097957c..0x00979660).
export const EMOTE_KEYS: readonly string[] = [
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'v', 'w', 'x', 'y', 'z',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
];

// Key -> emote slot. Town: the getter of vtable 0x00b3a040 (+0x4c, +0x58, ...,
// 0x6a7584..0x6a7704 return the constant). Field: vtable 0x00b39ec0 (0x6a7584..).
export const EMOTE_SLOTS: { readonly town: Readonly<Record<string, number>>; readonly field: Readonly<Record<string, number>> } = {
  town: {
    f1: 6, f2: 7, f3: 8, f4: 9, f5: 10, f6: 11, f7: 12, f8: 13, f9: 14, f10: 15, f11: 16, f12: 17,
    a: 42, b: 26, c: 36, d: 37, e: 43, f: 38, g: 39, h: 25, j: 30, k: 32, l: 47, m: 18,
    n: 28, o: 27, p: 41, q: 29, r: 31, s: 34, t: 35, v: 46, w: 33, x: 45, y: 40, z: 44,
    '1': 50, '2': 51, '3': 52, '4': 53, '5': 19, '6': 20, '7': 21, '8': 22, '9': 23, '0': 24,
  },
  field: {
    f1: 9, f2: 11, f3: 13, f4: 6, f5: 26, f6: 27, f7: 28, f8: 29, f9: 30, f10: 31, f11: 32, f12: 33,
    a: 58, b: 42, c: 52, d: 53, e: 59, f: 54, g: 55, h: 41, j: 46, k: 48, l: 63, m: 12,
    n: 44, o: 43, p: 57, q: 45, r: 47, s: 50, t: 51, v: 62, w: 49, x: 61, y: 56, z: 60,
    '1': 66, '2': 67, '3': 68, '4': 69, '5': 35, '6': 36, '7': 37, '8': 38, '9': 39, '0': 40,
  },
};

// The emote keys named by a chat line, in order (process_chat_message): each
// `{` starts a name that runs to the next `}` (lower-cased, 16 characters at
// most, no check when the cap or the end of the line comes first). A name that
// is one of EMOTE_KEYS is an emote.
export function parseEmoteKeys(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let name = '';
    let j = open + 1;
    let closed = false;
    while (j < text.length && name.length < EMOTE_NAME_MAX) {
      if (text[j] === '}') {
        closed = true;
        break;
      }
      name += text[j].toLowerCase();
      j++;
    }
    if (closed && (EMOTE_KEYS as readonly string[]).includes(name)) {
      out.push(name);
      i = j + 1;
    } else {
      i = open + 1;
    }
  }
  return out;
}

// process_chat_message's return (0x0077cbf3..0x0077cd1b): the line's length less
// each recognised emote token (`{`, the key, `}`) less 2, or -2 for an empty line
// (0x0077cd1b, `(iVar3 - iVar4) + -2`). send_chat_message_text (dump
// Psobb.exe-05112026.c 754354; ProcessAndSendChatMessage_0077d7cc 754336 has the
// same gate) sends the line only when that value is not 0 (`if (iVar2 == 0) return`).
// The emote tokens are counted with their braces. So a line of
// two plain characters, or of one emote token and two characters, is not sent.
// The queueing of the emote keys happens inside the same call, before the return.
export function chatSendValue(text: string): number {
  let tokens = 0;
  for (const key of parseEmoteKeys(text)) tokens += key.length + 2;
  return text.length - tokens - 2;
}

// send_chat_message_text: the line goes to the server (ASSUMED: the exe checks
// the empty line first, the port's lobby and field sends are the same path).
export function chatLineSends(text: string): boolean {
  return text.length > 0 && chatSendValue(text) !== 0;
}

// The emote slot of a key in the lobby (field = false) or a game (field = true).
export function emoteSlot(key: string, field: boolean): number | undefined {
  return (field ? EMOTE_SLOTS.field : EMOTE_SLOTS.town)[key];
}

// The motion record of an emote slot for a character class. Lobby: the town
// set's slot. Field: the field table's row of the motion type, the slot and the
// held weapon's column (weaponClass 0..18, else column 0).
export function emoteRecord(charClass: number, weaponClass: number, slot: number, field: boolean): MotionRecord {
  if (!field) return townMotion(charClass, slot);
  const type = MOTION_TYPE[charClass] ?? 0;
  const s = FIELD_EMOTE_SLOTS.indexOf(slot);
  if (s < 0) throw new Error(`no field emote slot ${slot}`);
  const w = weaponClass >= 0 && weaponClass < 19 ? weaponClass : 0;
  const [index, speed, flags] = FIELD_EMOTE_ROWS[type][s][w];
  return { index, mode: 3, next: -1, speed, flags: FIELD_EMOTE_FLAGS[flags] };
}

// The 6x58 body: u8 0x58, u8 2, u16 client id (sendSubcommand fills the id), u16
// emote, u16 flags. `opposite` is flag bit 0.
export function emotePayload(slot: number, opposite: boolean): Uint8Array {
  const out = new Uint8Array(4);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, slot & 0xffff, true);
  dv.setUint16(2, opposite ? EMOTE_FLAG_OPPOSITE : 0, true);
  return out;
}

// Sit (6xAB, action_type sit_photon_chair = 171): the subcommand table entry
// 0x000700AB is HandlePlayerInputState_0069b378 (FUN_0069b378), the same body
// shape as 6x58: u16 client id @2, u16 0 @4, u16 flags @6. dispatch_action_
// sit_photon_chair sets flag 2 when the key's slot is 49 (Alt+I) and flag 1
// from the option 0x80000 (Alt+Shift). The receiver reads flag 2 as
// +0x33c |= 0x10000000 (the chair pose: slot 49 instead of 48) and flag 1 as
// +0x33c |= 0x8000000 (FUN_00691b30 re-picks +0xdc from the receiver's own
// body type; no sender gender enters it).
export const SIT_OPCODE = 0xab;
export const SIT_SLOT_PLAIN = 48; // Alt+U: the town getter 0x108
export const SIT_SLOT_CHAIR = 49; // Alt+I: the town getter 0x10c
export const EMOTE_FLAG_OPPOSITE = 1; // dword bit 0x10000
export const SIT_FLAG_CHAIR = 2; // dword bit 0x20000

export function sitPayload(chair: boolean, opposite: boolean): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint16(2, (chair ? SIT_FLAG_CHAIR : 0) | (opposite ? EMOTE_FLAG_OPPOSITE : 0), true);
  return out;
}

export function parseSitSubcommand(body: Uint8Array): { clientId: number; chair: boolean; opposite: boolean } | null {
  if (body.length < 8 || body[0] !== SIT_OPCODE) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const flags = dv.getUint16(6, true);
  return { clientId: dv.getUint16(2, true), chair: (flags & SIT_FLAG_CHAIR) !== 0, opposite: (flags & EMOTE_FLAG_OPPOSITE) !== 0 };
}

// The keys of the Alt block of handle_player_emote_input (PsoBB.exe named dump
// 587822..588157, the Alt+F1 .. Alt+4 tests in the order the exe makes them). With
// Alt down, the first key of this list whose was_key_pressed edge is set plays
// its emote: the getter at the vtable offset of the chat key (the same offsets as
// ProcessPlayerEmote_0077cec0), so the slot is EMOTE_SLOTS of the map. The list
// is EMOTE_KEYS in that order (checked by tests/emotes.test.ts).
export const ALT_EMOTE_ORDER: readonly string[] = [
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
  'm', '5', '6', '7', '8', '9', '0',
  'h', 'b', 'o', 'n', 'q', 'j', 'r', 'k', 'w', 's', 't', 'c', 'd', 'f', 'g', 'y', 'p', 'a', 'e', 'z', 'x', 'v', 'l',
  '1', '2', '3', '4',
];

// The first Alt emote key of this poll (`edge` = was_key_pressed), in the exe's order.
export function altEmoteKey(edge: (key: string) => boolean): string | undefined {
  for (const k of ALT_EMOTE_ORDER) if (edge(k)) return k;
  return undefined;
}

// The key that ends a sit (HandleInputState0xAB_0069c0c8): Alt+U ends the plain
// sit (chair flag clear), Alt+I the chair sit (flag set). Nothing else in this
// poll ends it; the sit holds (ASSUMED on the other paths: a new action or a hit).
export function sitEndKey(chair: boolean): string {
  return chair ? 'i' : 'u';
}

// A received 6x58: body = the whole subcommand (header included).
export function parseEmoteSubcommand(body: Uint8Array): { clientId: number; slot: number; opposite: boolean } | null {
  if (body.length < 8 || body[0] !== EMOTE_OPCODE) return null;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const flags = dv.getUint16(6, true);
  return { clientId: dv.getUint16(2, true), slot: dv.getUint16(4, true), opposite: (flags & 1) !== 0 };
}

// The chat queue (chat_emote_queue): up to EMOTE_QUEUE_MAX keys, played in order.
export class EmoteQueue {
  private keys: string[] = [];

  get length(): number {
    return this.keys.length;
  }

  // A chat line's keys; the entries past the cap are dropped (the exe checks
  // `num_queued_emotes < 10` before each one).
  push(keys: readonly string[]): void {
    for (const k of keys) if (this.keys.length < EMOTE_QUEUE_MAX) this.keys.push(k);
  }

  head(): string | undefined {
    return this.keys[0];
  }

  shift(): string | undefined {
    return this.keys.shift();
  }

  clear(): void {
    this.keys = [];
  }
}

// The Simple Mail (BB): the lobby Home menu's Simple Mail leaf (main menu entry 0x13,
// classic/simplemail.ts). Packets, the received mail store and the answer service.
//
// Decoded from PsoBB.exe (Psobb.exe-05112026.c, Ghidra via tools/ghidra/decomp.sh):
//   - 0081 (S->C) is the function at 0x007c8dc4 (the dump's name handle_ship_packet0x81 at
//     0x00810083 is wrong: that address is mid-function). It is the 0x81 entry of the pair table
//     at 0x00a0f800 (8-byte stride; the pair at 0x00a0f9b8, next to the in-game 0x60 / 0x62).
//     It runs ProcessEntityNameWithShopItems on the message in place (msg = packet + 0x5c), then
//     unknown_packet_handlers[0x17] = LAB_0081384c (ship connection +0x1e0d0). That thunk runs
//     FUN_00813a3c (the text check) and then the store FUN_00813870 / 0081386c (SE 0x586).
//   - 0081 (C->S) is FUN_008136f0 (the builder) and the wrapper FUN_007d4384, which sets the
//     header to size 0x45C, command 0x81, flags 0 (0x7d75c8: `mov word [esi], 0x45c`,
//     `mov byte [eax+2], 0x81`). The body is 0x454 bytes (newserv SC_SimpleMail_BB_81,
//     __packed_ws__(..., 0x454): the body without the 8-byte header).
//   - C7 (C->S) is send_packet0xc7 (812242): the answer text, size (2 * units + 13) & ~3,
//     the text UTF-16 and zero fill. C8 (C->S) is send_packet0xc8 (812271): 8 bytes.
//   - The mail store is 50 entries of 0x1BC bytes at 0x00ab0300 (FUN_0081364c), count
//     0x00ab59b8, serial counter 0x00ab59bc (FUN_00813930 gives the serial at +4).
//
// Body offsets (the packet offset minus the 8-byte header; newserv's field names):
//   +0x00 player tag (u32; the exe's session word at 0x12120, 0x00010000 for BB)
//   +0x04 from guild card (u32; the session word at 0x12124)
//   +0x08 from name (UTF-16, 15 units, zero terminated at +0x26; the exe copies 23 units and
//         then zeroes unit 15, so the name is cut at 15)
//   +0x28 to guild card (u32)
//   +0x2C received date (UTF-16, 19 units, term at +0x52; not written by the exe's sender)
//   +0x54 text (UTF-16, 0x1FF units in newserv; the exe's sender copies 0xAB units, term at +0x1AA)
import type { Packet, CommandLink } from './guildcard.ts';

export const MAIL_CMD = { mail: 0x81, answerOn: 0xc7, answerOff: 0xc8 } as const;
// The exe's wrapper header size (FUN_007d4384) and the body size of newserv's struct.
export const MAIL_PACKET_BYTES = 0x45c;
export const MAIL_BODY_BYTES = MAIL_PACKET_BYTES - 8;
export const MAIL_BODY = { tag: 0x00, fromGc: 0x04, fromName: 0x08, toGc: 0x28, date: 0x2c, text: 0x54 } as const;
// The sender's name is cut at 15 units (exe 008136f0: unit 15 is zeroed).
export const MAIL_NAME_UNITS = 0x0f;
// The receiver's copies (exe 00813930): name 0x17 units, date 0x13, message 0xAB.
export const MAIL_RECV_NAME_UNITS = 0x17;
export const MAIL_RECV_DATE_UNITS = 0x13;
export const MAIL_TEXT_UNITS = 0xab;
// The store: 50 entries (exe 0x32), the oldest is dropped when it is full.
export const MAIL_CAPACITY = 0x32;
// The player tag the exe and newserv put first (0x00010000 = BB).
export const MAIL_PLAYER_TAG = 0x00010000;
// Entry flags (exe +0x1B8): bit 0 used, bit 1 unread (set on arrival, cleared when the
// Simple Mail window closes: FUN_008136c0), bit 2 answered (set by a reply), bit 3 the
// new-mail icon (set on arrival).
export const MAIL_FLAG = { used: 1, unread: 2, replied: 4, icon: 8 } as const;
export const MAIL_ARRIVAL_FLAGS = MAIL_FLAG.used | MAIL_FLAG.unread | MAIL_FLAG.icon;

export interface MailMessage {
  fromGuildCard: number;
  fromName: string;
  date: string;
  text: string;
}

export interface MailEntry extends MailMessage {
  // The serial the window and the delete use (FUN_00813930 at +4).
  serial: number;
  flags: number;
}

// Reads a zero-terminated UTF-16LE string of at most `units` units from a body.
export function readUnits(body: Uint8Array, offset: number, units: number): string {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let out = '';
  for (let i = 0; i < units; i++) {
    const p = offset + i * 2;
    if (p + 1 >= body.byteLength) break;
    const u = dv.getUint16(p, true);
    if (u === 0) break;
    out += String.fromCharCode(u);
  }
  return out;
}

// The smut filter (ProcessEntityNameWithShopItems, exe 00813a78; NormalizeAndFilterEntityName,
// exe 00813b18). The list is smutdata.prs (g_ShopDialogFilePath at 0x0096ee00, "smutdata.prs"),
// read by InitializeShopDialog_0070ac88 with the unitxt parser: each group is a list of strings
// ended by an empty string. The exe runs it on every 0081 message in place (007c8dc4), so a mail
// is stored with the words replaced. With no groups (count < 1) the message is copied as it is.
//
// The tables (PsoBB.exe .data, read with tools/exedata.py):
//   0x00980980: 16 entries of 4 units, stride 8 bytes: the symbols that become spaces in the
//               normalized text (ASCII and fullwidth punctuation, see FILTER_SYMBOLS).
//   0x00980a00: halfwidth katakana FF66..FF9D -> full width (KATAKANA_FULL).
//   0x00980a80: g_ShopNameReplacementPattern, "#!@%" x 8 (the character j of a word is replaced
//               by pattern[j]; past the 32 units the pattern reads 0, which ends the text).
const FILTER_SYMBOLS: readonly number[] = [
  0x21, 0x40, 0x23, 0x24, 0x25, 0x5e, 0x26, 0x2a, 0x28, 0x29, 0x2d, 0x5f, 0x3d, 0x2b, 0x7c, 0x5c,
  0x5b, 0x5d, 0x7b, 0x7d, 0x3b, 0x3a, 0x27, 0x22, 0x3f, 0x2f, 0x3c, 0x2c, 0x3e, 0x2e, 0xff01, 0xff20,
  0xff03, 0xff04, 0xff05, 0xff3e, 0xff06, 0xff0a, 0xff08, 0xff09, 0x30fc, 0xff3f, 0xff1d, 0xff0b,
  0xffe5, 0xff5c, 0x300c, 0x300d, 0xff5b, 0xff5d, 0xff1b, 0xff1a, 0x2019, 0x201d, 0xff1f, 0x30fb,
  0x3002, 0xff1e, 0xff1c, 0x3001, 0xff5e, 0x2018, 0x7e, 0x60,
];
const KATAKANA_FULL: readonly number[] = [
  0x30f2, 0x30a1, 0x30a3, 0x30a5, 0x30a7, 0x30a9, 0x30e3, 0x30e5, 0x30e7, 0x30c3, 0x30fc, 0x30a2, 0x30a4, 0x30a6,
  0x30a8, 0x30aa, 0x30ab, 0x30ad, 0x30af, 0x30b1, 0x30b3, 0x30b5, 0x30b7, 0x30b9, 0x30bb, 0x30bd, 0x30bf, 0x30c1,
  0x30c4, 0x30c6, 0x30c8, 0x30ca, 0x30cb, 0x30cc, 0x30cd, 0x30ce, 0x30cf, 0x30d2, 0x30d5, 0x30d8, 0x30db, 0x30de,
  0x30df, 0x30e0, 0x30e1, 0x30e2, 0x30e4, 0x30e6, 0x30e8, 0x30e9, 0x30ea, 0x30eb, 0x30ec, 0x30ed, 0x30ef, 0x30f3,
];
const REPLACEMENT_PATTERN = '#!@%#!@%#!@%#!@%#!@%#!@%#!@%#!@%';
const FILTER_SYMBOL_SET = new Set(FILTER_SYMBOLS);
// ASSUMED: the exe loops until a word no longer matches; a replacement that rebuilds the same
// word would loop forever there, so the port stops after this many passes over one word.
const FILTER_PASSES = 256;

// The groups of smutdata.prs (set once the file is read; the exe's InitializeShopDialog).
let shopDialogItems: readonly (readonly string[])[] = [];

export function setShopDialogItems(groups: readonly (readonly string[])[]): void {
  shopDialogItems = groups;
}

// One unit of NormalizeAndFilterEntityName's pass over the text: u5 is the unit to process
// (a space after a tab), u6 the original unit (the katakana table is used only when they match).
function normalizeFilterUnit(u5: number, u6: number): number {
  let c = u5 === 0x3000 ? 0x20 : u5;
  if (c >= 0x41 && c <= 0x5a) c += 0x20; // ASCII capitals to lower case
  else if (c >= 0xff21 && c <= 0xff3a) c -= 0xfec0; // fullwidth capitals to ASCII capitals
  else if (c > 0xff40 && c < 0xff5b) c -= 0xfee0; // fullwidth small letters to ASCII
  if (c === u6 && u6 > 0xff65 && u6 < 0xff9e) c = KATAKANA_FULL[u6 - 0xff66];
  if (FILTER_SYMBOL_SET.has(c)) c = 0x20;
  return c;
}

// NormalizeAndFilterEntityName (exe 00813b18) for one group. N is the normalized text with a
// leading and a trailing space (N[i + 1] is the unit of O[i]); O is the text as sent, with the
// replaced words. Returns O with its zero unit.
function normalizeAndFilter(input: readonly number[], group: readonly string[]): number[] {
  const at = (k: number): number => (k < input.length ? input[k] : 0);
  const N: number[] = [0x20];
  const O: number[] = [];
  let i = 0;
  let u6 = at(0);
  let u5 = u6;
  let bVar2 = false;
  if (u6 === 9) {
    // A tab starts the exe's second pass: its unit and the one after it become spaces.
    u5 = 0x20;
    bVar2 = true;
  }
  if (u6 !== 0) {
    for (;;) {
      N.push(normalizeFilterUnit(u5, u6));
      O.push(u6);
      i++;
      u6 = at(i);
      if (u6 === 0 || i > 0xfc) break;
      if (u6 === 9) {
        u5 = 0x20;
        bVar2 = true;
        continue;
      }
      u5 = bVar2 ? 0x20 : u6;
      bVar2 = false;
    }
  }
  N.push(0x20, 0);
  O.push(0);

  const pattern = (j: number): number => (j < REPLACEMENT_PATTERN.length ? REPLACEMENT_PATTERN.charCodeAt(j) : 0);
  for (const word of group) {
    if (word.length === 0) break; // the group's end
    const S = Array.from(word, (ch) => ch.charCodeAt(0));
    for (let pass = 0; pass < FILTER_PASSES; pass++) {
      // The last place the word occurs in N (the exe keeps the last match it scanned).
      let last = -1;
      for (let pos = 0; pos < N.length && N[pos] !== 0; pos++) {
        let hit = true;
        for (let j = 0; j < S.length && hit; j++) hit = (N[pos + j] ?? 0) === S[j];
        if (hit) last = pos;
      }
      if (last < 0) break;
      for (let j = 0; j < S.length; j++) {
        if (S[j] === 0x20) continue;
        const c = pattern(j);
        N[last + j] = c;
        // The exe writes O only when the unit before it is set; before the text (O[-1]) it
        // reads memory outside the message, which is taken as set (ASSUMED).
        const prev = last + j - 2;
        if (prev < 0 || O[prev] !== 0) O[last + j - 1] = c;
      }
    }
  }
  return O;
}

// ProcessEntityNameWithShopItems (exe 00813a78): each group filters the result of the one
// before it. Returns the text up to its first zero unit.
export function processEntityNameWithShopItems(text: string, items: readonly (readonly string[])[]): string {
  if (items.length < 1) return text;
  let dest = Array.from(text, (ch) => ch.charCodeAt(0));
  let out: number[] = [];
  for (const group of items) {
    out = normalizeAndFilter(dest, group);
    const end = out.indexOf(0);
    dest = out.slice(0, end < 0 ? out.length : end);
  }
  const end = out.indexOf(0);
  return String.fromCharCode(...out.slice(0, end < 0 ? out.length : end));
}

// The 0081 body with its message filtered (the exe filters the packet's message in place).
export function filterMailBody(body: Uint8Array): Uint8Array {
  if (shopDialogItems.length < 1) return body;
  const text = readUnits(body, MAIL_BODY.text, 0xfd);
  const filtered = processEntityNameWithShopItems(text, shopDialogItems);
  const out = body.slice();
  const dv = new DataView(out.buffer);
  for (let i = 0; i <= filtered.length; i++) {
    const p = MAIL_BODY.text + i * 2;
    if (p + 1 >= out.byteLength) break;
    dv.setUint16(p, i < filtered.length ? filtered.charCodeAt(i) : 0, true);
  }
  return out;
}

// FUN_00813a3c: a message whose first unit is set must end (a zero unit) within the
// first 156 units; otherwise the store drops it. Returns true when it is kept.
export function mailTextAccepted(body: Uint8Array): boolean {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const unit = (i: number) => (MAIL_BODY.text + i * 2 + 1 < body.byteLength ? dv.getUint16(MAIL_BODY.text + i * 2, true) : 0);
  if (unit(0) === 0) return true;
  for (let count = 1; ; count++) {
    if (unit(count) === 0) return true;
    if (count > 0x9b) return false;
  }
}

// The 0081 body from the server: the store's fields (exe 00813930 field copies).
export function parseMailBody(body: Uint8Array): MailMessage {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    fromGuildCard: dv.getUint32(MAIL_BODY.fromGc, true),
    fromName: readUnits(body, MAIL_BODY.fromName, MAIL_RECV_NAME_UNITS),
    date: readUnits(body, MAIL_BODY.date, MAIL_RECV_DATE_UNITS),
    text: readUnits(body, MAIL_BODY.text, MAIL_TEXT_UNITS),
  };
}

// 0081 (C->S): FUN_008136f0. The text is cut at 0xAB units; the rest of the exe's buffer is
// not written there (ASSUMED zero here).
export function simpleMailPacket(from: { tag: number; guildCard: number; name: string }, toGuildCard: number, text: string): Packet {
  const body = new Uint8Array(MAIL_BODY_BYTES);
  const dv = new DataView(body.buffer);
  dv.setUint32(MAIL_BODY.tag, from.tag >>> 0, true);
  dv.setUint32(MAIL_BODY.fromGc, from.guildCard >>> 0, true);
  const name = from.name.slice(0, MAIL_NAME_UNITS);
  for (let i = 0; i < name.length; i++) dv.setUint16(MAIL_BODY.fromName + i * 2, name.charCodeAt(i), true);
  dv.setUint32(MAIL_BODY.toGc, toGuildCard >>> 0, true);
  const units = text.slice(0, MAIL_TEXT_UNITS);
  for (let i = 0; i < units.length; i++) dv.setUint16(MAIL_BODY.text + i * 2, units.charCodeAt(i), true);
  return { command: MAIL_CMD.mail, flag: 0, payload: body };
}

// C7: the answer service on, with its text (send_packet0xc7). Size (2 * units + 13) & ~3.
export function answerOnPacket(text: string): Packet {
  const units = Math.min(text.length, 0x1ff);
  const size = (units * 2 + 13) & 0xfffc;
  const payload = new Uint8Array(size - 8);
  const dv = new DataView(payload.buffer);
  for (let i = 0; i < units; i++) dv.setUint16(i * 2, text.charCodeAt(i), true);
  return { command: MAIL_CMD.answerOn, flag: 0, payload };
}

// C8: the answer service off (send_packet0xc8, 8 bytes).
export function answerOffPacket(): Packet {
  return { command: MAIL_CMD.answerOff, flag: 0, payload: new Uint8Array(0) };
}

// The store (FUN_0081364c table): entries oldest first; the window lists them newest first.
export class MailStore {
  private entries: MailEntry[] = [];
  private nextSerial = 0;
  // Bumps on every change, so the open window rebuilds its list (exe DAT_00a98474 bit 0).
  version = 0;

  get count(): number {
    return this.entries.length;
  }

  // The entries, oldest first.
  all(): readonly MailEntry[] {
    return this.entries;
  }

  find(serial: number): MailEntry | null {
    return this.entries.find((e) => e.serial === serial) ?? null;
  }

  // FUN_00813870: a full store drops the oldest (memmove), then the new mail goes last.
  insert(m: MailMessage): MailEntry {
    if (this.entries.length >= MAIL_CAPACITY) this.entries.shift();
    const entry: MailEntry = { ...m, serial: this.nextSerial++, flags: MAIL_ARRIVAL_FLAGS };
    this.entries.push(entry);
    this.version++;
    return entry;
  }

  // FUN_0081358c / FUN_008135d8: deletes the mail with that serial (memmove, count - 1).
  remove(serial: number): boolean {
    const i = this.entries.findIndex((e) => e.serial === serial);
    if (i < 0) return false;
    this.entries.splice(i, 1);
    this.version++;
    return true;
  }

  // FUN_008136c0: the window's close clears the unread bit of every mail.
  clearUnread(): void {
    for (const e of this.entries) e.flags &= ~MAIL_FLAG.unread;
    this.version++;
  }

  // The send's mark (exe state 0xe, the loop over the store): flags = flags & 0xF5 | 4 on the
  // mail the reply was made to (a new mail has no serial: the exe's -1).
  markReplied(serial: number): void {
    const e = this.find(serial);
    if (!e) return;
    e.flags = (e.flags & 0xf5) | MAIL_FLAG.replied;
    this.version++;
  }
}

// Session state of the Simple Mail: the store, the answer service (flags of
// g_SimpleMailMenuFlags: bit 0 on, bit 1 the state last sent, bit 2 the text changed) and
// the packets. Created with the session (BBSession.startGuildCardSync).
export class SimpleMailBox {
  readonly store = new MailStore();
  private readonly link: CommandLink;
  private readonly saveAnswer: ((text: string) => void) | null;
  answerOn = false;
  answerSent = false;
  answerDirty = false;
  answerText = '';

  // answerText: the auto reply the save holds (E7 0x29EC; the exe's in-memory +0x2510). The
  // service starts off whatever the text (the exe's flag bit 0 is not in the save; ASSUMED).
  // saveAnswer: told each new text, so the session's save copy keeps it (writeAutoReply).
  constructor(link: CommandLink, opts: { answerText?: string; saveAnswer?: (text: string) => void } = {}) {
    this.link = link;
    this.answerText = (opts.answerText ?? '').slice(0, MAIL_TEXT_UNITS);
    this.saveAnswer = opts.saveAnswer ?? null;
  }

  // The 0081 handler (the filter in 007c8dc4, then LAB_0081384c -> store). Returns 'stored' when
  // the mail was kept (the caller plays SE 0x586 then, FUN_0081386c), 'dropped' otherwise.
  receive(body: Uint8Array): 'stored' | 'dropped' {
    const filtered = filterMailBody(body);
    if (!mailTextAccepted(filtered)) return 'dropped';
    const m = parseMailBody(filtered);
    this.store.insert(m);
    return 'stored';
  }

  send(from: { guildCard: number; name: string }, toGuildCard: number, text: string): void {
    const p = simpleMailPacket({ tag: MAIL_PLAYER_TAG, guildCard: from.guildCard, name: from.name }, toGuildCard, text);
    this.link.send(p.command, p.flag, p.payload);
  }

  // SimpleMail_SetAnswerServiceSession (0077a4fc): the text is kept, the window's changed flag
  // is set, and the service is on exactly when the text is not empty.
  setAnswerText(text: string): void {
    this.answerText = text.slice(0, MAIL_TEXT_UNITS);
    this.answerDirty = true;
    this.answerOn = this.answerText.length > 0;
    this.saveAnswer?.(this.answerText);
  }

  // SimpleMail_SetAnswerServiceEnabled (0077a4c0): true when the flag changed.
  setAnswerEnabled(on: boolean): boolean {
    if (this.answerOn === on) return false;
    this.answerOn = on;
    return true;
  }

  // on_exit_simple_mail_menu (0077a4xx path in 751905): nothing when the service is unchanged
  // and the text is not dirty; else C7 (on, with the text) or C8 (off); then the sent state
  // becomes the on state and the dirty flag clears.
  closeWindow(): void {
    if (!this.answerDirty && this.answerOn === this.answerSent) return;
    const p = this.answerOn ? answerOnPacket(this.answerText) : answerOffPacket();
    this.link.send(p.command, p.flag, p.payload);
    this.answerDirty = false;
    this.answerSent = this.answerOn;
  }
}

// The Info Board (BB): the lobby Home menu's Info Board leaf (main menu entry 0x16,
// classic/infoboard.ts). Two packets, both in the BB command set:
//   - 00D8 (client -> server) asks for the board: an 8-byte packet, flag 0, no body.
//     Decoded from PsoBB.exe: FUN_007d79f4 (dump 'ChallengePlayerInfoWindowListWindow'
//     family, the request), header {size 8, command 0xD8, flag 0}.
//   - 00D8 (server -> client) answers with one entry per player of the lobby: the BB
//     header's flag is the entry count (newserv send_info_board_t), the body is the
//     entries, 0x178 bytes each: name (UTF-16, 0x10 chars, 0x20 bytes) then message
//     (UTF-16, 0xAC chars, 0x158 bytes). Decoded from the exe's receive
//     HandleGuildCardDataReceive_0078e11c (0x78e11c): it copies the whole packet (the
//     8-byte header included, 0x1A28 bytes) into the buffer, the window reads the
//     count at +4 and the entries at +8, stride 0x178. The exe ignores an answer
//     that comes when no request is open or one is already answered (flag 2).
//   - 00D9 (client -> server) writes the player's own board text. Built by
//     FUN_007d7aa4: the text is copied with _wcsncpy(…, 0xAC) (at most 172 UTF-16
//     units), the packet is {size (2 * units + 13) & ~3, command 0xD9, flag 0} then
//     the text, zero filled. The server does not answer (newserv on_D9).
// Newserv references: SendCommands.cc send_info_board_t, ReceiveCommands.cc on_D9,
// CommandFormats.hh S_InfoBoardEntryT_D8 (0x178 bytes per entry, BB).
import type { Packet, CommandLink } from './guildcard.ts';
import type { Command } from './bbconnection.ts';

export const INFO_BOARD_CMD = { list: 0xd8, write: 0xd9 } as const;
// S_InfoBoardEntry_BB_D8: name pstring<UTF16, 0x10> at +0, message pstring<UTF16, 0xAC> at +0x20.
export const INFO_BOARD_ENTRY_BYTES = 0x178;
export const INFO_BOARD_MESSAGE_OFFSET = 0x20;
export const INFO_BOARD_MESSAGE_BYTES = 0x158;
// The exe's copy buffer: 0x1A28 bytes with the 8-byte header, so 17 entries fit.
export const INFO_BOARD_MAX_ENTRIES = Math.floor((0x1a28 - 8) / INFO_BOARD_ENTRY_BYTES);
// The typed text: the keyboard result is copied into the character with 0xAB units (exe 0078e000).
export const INFO_BOARD_TYPED_MAX = 0xab;
// The write packet copies at most 0xAC units (exe 007d7aa4).
export const INFO_BOARD_WRITE_MAX = 0xac;

export interface InfoBoardEntry {
  name: string;
  message: string;
}

// Reads a zero-terminated UTF-16LE string of at most `bytes` bytes (the pstring field).
export function readUtf16Field(data: Uint8Array, offset: number, bytes: number): string {
  let out = '';
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let p = offset; p + 1 < offset + bytes && p + 1 < data.byteLength; p += 2) {
    const unit = dv.getUint16(p, true);
    if (unit === 0) break;
    out += String.fromCharCode(unit);
  }
  return out;
}

// The 00D8 answer: count = the BB header's flag, body = the packet without its header.
export function parseInfoBoardList(count: number, body: Uint8Array): InfoBoardEntry[] {
  const fit = Math.floor(body.byteLength / INFO_BOARD_ENTRY_BYTES);
  const n = Math.min(count >>> 0, fit, INFO_BOARD_MAX_ENTRIES);
  const out: InfoBoardEntry[] = [];
  for (let i = 0; i < n; i++) {
    const base = i * INFO_BOARD_ENTRY_BYTES;
    out.push({
      name: readUtf16Field(body, base, 0x20),
      message: readUtf16Field(body, base + INFO_BOARD_MESSAGE_OFFSET, INFO_BOARD_MESSAGE_BYTES),
    });
  }
  return out;
}

// 00D8 request: the exe's FUN_007d79f4 (size 8, flag 0).
export function infoBoardRequestPacket(): Packet {
  return { command: INFO_BOARD_CMD.list, flag: 0, payload: new Uint8Array(0) };
}

// 00D9 write: FUN_007d7aa4 (see the header comment for the size rule).
export function infoBoardWritePacket(text: string): Packet {
  const units = Math.min(text.length, INFO_BOARD_WRITE_MAX);
  const size = (units * 2 + 13) & 0xfffc;
  const payload = new Uint8Array(size - 8);
  const dv = new DataView(payload.buffer);
  for (let i = 0; i < units; i++) dv.setUint16(i * 2, text.charCodeAt(i), true);
  return { command: INFO_BOARD_CMD.write, flag: 0, payload };
}

// The request / answer pair the window uses. A request drops answers that are still
// queued from earlier (the guild card search does the same with its 0041 answers).
export class InfoBoardClient {
  private readonly link: CommandLink;
  private readonly timeoutMs: number;
  // The last board the server sent (the window's list is built from it).
  entries: InfoBoardEntry[] = [];

  constructor(link: CommandLink, timeoutMs = 5000) {
    this.link = link;
    this.timeoutMs = timeoutMs;
  }

  async fetch(): Promise<InfoBoardEntry[]> {
    while (this.link.poll(INFO_BOARD_CMD.list));
    const p = infoBoardRequestPacket();
    this.link.send(p.command, p.flag, p.payload);
    const reply = await this.wait(INFO_BOARD_CMD.list);
    this.entries = parseInfoBoardList(reply.flag, reply.data);
    return this.entries;
  }

  write(text: string): void {
    const p = infoBoardWritePacket(text);
    this.link.send(p.command, p.flag, p.payload);
  }

  private wait(command: number): Promise<Command> {
    return new Promise<Command>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no answer to ${command.toString(16)}`)), this.timeoutMs);
      this.link.waitFor(command).then(
        (c) => {
          clearTimeout(t);
          resolve(c);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }
}

// BB guild card book: the ship's guild card file (0xD590 bytes, stored by the
// server), its E8 commands and the 0x40 / 0x41 card search.
//
// Client side layouts come from PsoBB.exe (Ephinea 1.25.13) and were read in
// the dump (refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c):
//   send_packet0xe8_subcommand0x1      01E8 checksum, CRC32 of the 0xD590-byte file
//   handle_packets_0xe8_and_0xdc_      02E8 (needs update -> 03E8), 01DC / 02DC
//   handle_packet0xdc_subcommand0x1    01DC: unknown_a1 @8, file size @0xC, CRC32 @0x10
//   handle_packet0xdc_subcommand0x2    02DC: unknown_a1 @8, chunk index @0xC, data @0x10
//   send_packet0xe8_subcommand0x3      03E8 (no payload) after a checksum mismatch
//   handle_packet0xdc_subcommand0x2    03DC {unknown_a1, chunk index, cont}, cont 1 = next chunk
//   GetGuildCardEntry_00827f14         entry i at file 0x1F74 + i * 0x1BC (0x69 entries)
//   HandleGuildCardMenuData_00781c3c   05E8 with the removed card, then shift down
//   send_packet0xe8_subcommand4..0xa   04E8 add, 05E8 delete, 06E8 update, 07E8 block,
//                                      08E8 unblock, 09E8 comment, 0AE8 swap
//   send_packet0x40 / ShipConnectionManager_SendPacket_00827f28   0040 search
//   handle_ship_packet0x41             0041 search result (bb_guild_reply_pkt, 0x128 after the header)
// The server side layouts come from newserv src/CommandFormats.hh (guild card
// commands), SendCommands.cc send_guild_card_*_bb and ReceiveCommands.cc
// on_E8_BB / on_DC_BB / on_40 (MIT). The exe and newserv agree on every offset
// listed above; the exe's CRC32 is the table CRC (ASSUMED: the same as
// phosg::crc32, which newserv uses; the test checks the standard check value).

import { readUtf16, type Command } from './bbconnection.ts';

// Sizes and offsets of the guild card file (exe: g_ChallengeModeMainDataBuffer, 0xd590 bytes).
export const GC_FILE = {
  size: 0xd590,
  systemSize: 0x114, // system file part at the start (kept as raw bytes)
  blockedOffset: 0x114,
  blockedCount: 0x1c,
  entriesOffset: 0x1f74,
  entryCount: 0x69,
  entrySize: 0x1bc,
  cardSize: 0x108,
  commentUnits: 0x58,
  chunkSize: 0x6800,
} as const;

// Command numbers (u16 command of the 8-byte BB header).
export const GC_CMD = {
  checksum: 0x01e8,
  checksumResult: 0x02e8,
  download: 0x03e8,
  add: 0x04e8,
  delete: 0x05e8,
  update: 0x06e8,
  blockAdd: 0x07e8,
  blockDelete: 0x08e8,
  comment: 0x09e8,
  swap: 0x0ae8,
  fileHeader: 0x01dc,
  fileChunk: 0x02dc,
  chunkRequest: 0x03dc,
  search: 0x0040,
  searchResult: 0x0041,
} as const;

// Player tag the exe and newserv put first in the search request (0x00010000 = BB).
export const GC_PLAYER_TAG = 0x00010000;

export interface Packet {
  command: number;
  flag: number;
  payload: Uint8Array;
}

// The link the client needs from BBConnection (structural, so a test can script it).
export interface CommandLink {
  send(command: number, flag: number, payload?: Uint8Array): void;
  waitFor(...commands: number[]): Promise<Command>;
  poll(...commands: number[]): Command | null;
}

// Standard CRC-32 (zlib / phosg::crc32): init 0xFFFFFFFF, reflected, final xor.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// UTF-16LE string of `units` code units, zero filled; the last unit stays 0.
function utf16Bytes(text: string, units: number): Uint8Array {
  const out = new Uint8Array(units * 2);
  const dv = new DataView(out.buffer);
  [...text].slice(0, units - 1).forEach((c, i) => dv.setUint16(i * 2, c.charCodeAt(0), true));
  return out;
}

// Names are stored with the \tE / \tJ marker (UTF16_ALWAYS_MARKED); the port's
// charfile reader strips it the same way.
function stripMarker(s: string): string {
  return s.replace(/^\t[EJ]/, '');
}

function u32(dv: DataView, o: number): number {
  return dv.getUint32(o, true);
}

function packet(command: number, flag: number, payload: Uint8Array): Packet {
  return { command, flag, payload };
}

function le32(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const dv = new DataView(out.buffer);
  values.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, true));
  return out;
}

// One guild card record (newserv GuildCardBB, 0x108 bytes).
export interface GuildCard {
  guildCardNumber: number;
  name: string;
  teamName: string;
  description: string;
  present: boolean;
  language: number;
  sectionId: number;
  charClass: number;
}

export function parseGuildCard(data: Uint8Array, offset = 0): GuildCard {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    guildCardNumber: u32(dv, offset),
    name: stripMarker(readUtf16(data, offset + 0x04, 0x18)),
    teamName: stripMarker(readUtf16(data, offset + 0x34, 0x10)),
    description: readUtf16(data, offset + 0x54, 0x58),
    present: data[offset + 0x104] !== 0,
    language: data[offset + 0x105]!,
    sectionId: data[offset + 0x106]!,
    charClass: data[offset + 0x107]!,
  };
}

// The 0x108-byte record. Names get the \tE marker the server expects on its
// UTF16_ALWAYS_MARKED fields (ASSUMED: the exe's add path was not traced, the
// marker is taken from newserv's type).
export function buildGuildCard(card: GuildCard): Uint8Array {
  const out = new Uint8Array(GC_FILE.cardSize);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, card.guildCardNumber >>> 0, true);
  out.set(utf16Bytes('\tE' + card.name, 0x18), 0x04);
  out.set(utf16Bytes('\tE' + card.teamName, 0x10), 0x34);
  out.set(utf16Bytes(card.description, 0x58), 0x54);
  out[0x104] = card.present ? 1 : 0;
  out[0x105] = card.language & 0xff;
  out[0x106] = card.sectionId & 0xff;
  out[0x107] = card.charClass & 0xff;
  return out;
}

export interface GuildCardEntry {
  card: GuildCard;
  comment: string;
}

export interface GuildCardFileView {
  entries: GuildCardEntry[];
  blocked: GuildCard[];
}

// Reads the entries and the blocked senders of a whole file (all slots, the
// present flag tells the used ones).
export function parseGuildCardFile(data: Uint8Array): GuildCardFileView {
  if (data.length < GC_FILE.size) throw new Error(`guild card file is ${data.length} bytes, want ${GC_FILE.size}`);
  const entries: GuildCardEntry[] = [];
  for (let i = 0; i < GC_FILE.entryCount; i++) {
    const o = GC_FILE.entriesOffset + i * GC_FILE.entrySize;
    entries.push({ card: parseGuildCard(data, o), comment: readUtf16(data, o + GC_FILE.cardSize, GC_FILE.commentUnits) });
  }
  const blocked: GuildCard[] = [];
  for (let i = 0; i < GC_FILE.blockedCount; i++) blocked.push(parseGuildCard(data, GC_FILE.blockedOffset + i * GC_FILE.cardSize));
  return { entries, blocked };
}

// The header of a file transfer (01DC): unknown_a1 must be echoed in 03DC.
export interface GuildCardFileHeader {
  unknownA1: number;
  fileSize: number;
  checksum: number;
}

export function parseFileHeader(data: Uint8Array): GuildCardFileHeader {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { unknownA1: u32(dv, 0), fileSize: u32(dv, 4), checksum: u32(dv, 8) };
}

// A 02DC chunk: payload after the header is {unknown_a1, chunk index, data}.
export interface GuildCardFileChunk {
  unknownA1: number;
  chunkIndex: number;
  data: Uint8Array;
}

export function parseFileChunk(data: Uint8Array): GuildCardFileChunk {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { unknownA1: u32(dv, 0), chunkIndex: u32(dv, 4), data: data.subarray(8) };
}

// 01E8: the client's CRC32 of its copy (0 when it has none) and a zero word.
export function checksumPacket(checksum: number): Packet {
  return packet(GC_CMD.checksum, 0, le32(checksum, 0));
}

// 02E8: nonzero means the client must download the file (03E8).
export function parseChecksumResult(data: Uint8Array): boolean {
  return u32(new DataView(data.buffer, data.byteOffset, data.byteLength), 0) !== 0;
}

// 03E8: asks for the file; the server answers with 01DC and then the chunks.
export function downloadPacket(): Packet {
  return packet(GC_CMD.download, 0, new Uint8Array(0));
}

// 03DC: {unknown_a1 from the 01DC, chunk index, cont}. cont 1 asks for the chunk,
// 0 ends the transfer.
export function chunkRequestPacket(unknownA1: number, chunkIndex: number, cont: boolean): Packet {
  return packet(GC_CMD.chunkRequest, 0, le32(unknownA1, chunkIndex, cont ? 1 : 0));
}

// 04E8 (add or replace) and 06E8 (update): one 0x108 record.
export function addCardPacket(card: GuildCard): Packet {
  return packet(GC_CMD.add, 0, buildGuildCard(card));
}

export function updateCardPacket(card: GuildCard): Packet {
  return packet(GC_CMD.update, 0, buildGuildCard(card));
}

// 05E8 / 08E8: delete a card (list or blocked list).
export function deleteCardPacket(guildCardNumber: number): Packet {
  return packet(GC_CMD.delete, 0, le32(guildCardNumber));
}

export function unblockPacket(guildCardNumber: number): Packet {
  return packet(GC_CMD.blockDelete, 0, le32(guildCardNumber));
}

export function blockPacket(card: GuildCard): Packet {
  return packet(GC_CMD.blockAdd, 0, buildGuildCard(card));
}

// 09E8: {u32 guild card, UTF-16 comment[0x58]} = 0xB4 bytes.
export function commentPacket(guildCardNumber: number, comment: string): Packet {
  const out = new Uint8Array(4 + GC_FILE.commentUnits * 2);
  new DataView(out.buffer).setUint32(0, guildCardNumber >>> 0, true);
  out.set(utf16Bytes(comment, GC_FILE.commentUnits), 4);
  return packet(GC_CMD.comment, 0, out);
}

// 0AE8: swap two cards' positions in the list.
export function swapPacket(a: number, b: number): Packet {
  return packet(GC_CMD.swap, 0, le32(a, b));
}

// 0040: search for a player by guild card number. The server answers 0041 only
// when the target is online and does not block the searcher.
export function searchPacket(searcher: number, target: number, playerTag = GC_PLAYER_TAG): Packet {
  return packet(GC_CMD.search, 0, le32(playerTag, searcher, target));
}

// 0041 result. Offsets are from the payload (after the 8-byte header), the
// exe's bb_guild_reply_pkt minus its 8-byte header.
export interface GuildCardSearchResult {
  searcher: number;
  guildCardNumber: number;
  address: number; // raw IPv4 field (reconnect target), little-endian u32
  port: number;
  location: string; // "BLOCK##-##" style string, the lobby the player is in
  menuId: number;
  itemId: number;
  name: string;
}

export function parseSearchResult(data: Uint8Array): GuildCardSearchResult {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    searcher: u32(dv, 0x04),
    guildCardNumber: u32(dv, 0x08),
    address: u32(dv, 0x14),
    port: dv.getUint16(0x18, true),
    location: stripMarker(readUtf16(data, 0x1c, 0x44)),
    menuId: u32(dv, 0xa4),
    itemId: u32(dv, 0xa8),
    name: stripMarker(readUtf16(data, 0xe8, 0x20)),
  };
}

// The guild card book of this client: the file bytes as the server keeps them,
// so a checksum of the copy is the server's checksum. The mutations follow the
// newserv on_E8_BB handlers (same slot rules), so the copy can be updated
// right after a command without waiting for the server.
export class GuildCardBook {
  readonly raw: Uint8Array;

  constructor(raw: Uint8Array = new Uint8Array(GC_FILE.size)) {
    if (raw.length !== GC_FILE.size) throw new Error(`guild card file must be ${GC_FILE.size} bytes`);
    this.raw = raw.slice();
  }

  checksum(): number {
    return crc32(this.raw);
  }

  view(): GuildCardFileView {
    return parseGuildCardFile(this.raw);
  }

  // The present cards in list order (the exe's menu rows skip empty slots).
  cards(): GuildCard[] {
    return this.view().entries.filter((e) => e.card.present).map((e) => e.card);
  }

  find(guildCardNumber: number): GuildCardEntry | null {
    return this.view().entries.find((e) => e.card.present && e.card.guildCardNumber === guildCardNumber) ?? null;
  }

  // 04E8: the first empty slot or the card's own slot takes the record; the
  // slot's comment stays (newserv writes only the data part).
  add(card: GuildCard): boolean {
    for (let i = 0; i < GC_FILE.entryCount; i++) {
      const o = GC_FILE.entriesOffset + i * GC_FILE.entrySize;
      const cur = parseGuildCard(this.raw, o);
      if (!cur.present || cur.guildCardNumber === card.guildCardNumber) {
        this.raw.set(buildGuildCard(card), o);
        this.raw.fill(0, o + GC_FILE.cardSize + GC_FILE.commentUnits * 2, o + GC_FILE.entrySize);
        return true;
      }
    }
    return false;
  }

  // 06E8: overwrites every slot holding the card.
  update(card: GuildCard): void {
    for (let i = 0; i < GC_FILE.entryCount; i++) {
      const o = GC_FILE.entriesOffset + i * GC_FILE.entrySize;
      if (parseGuildCard(this.raw, o).guildCardNumber === card.guildCardNumber) this.raw.set(buildGuildCard(card), o);
    }
  }

  // 05E8: removes the first slot with the number, shifts the rest up, clears the last.
  remove(guildCardNumber: number): boolean {
    for (let i = 0; i < GC_FILE.entryCount; i++) {
      const o = GC_FILE.entriesOffset + i * GC_FILE.entrySize;
      if (parseGuildCard(this.raw, o).guildCardNumber !== guildCardNumber) continue;
      const end = GC_FILE.entriesOffset + GC_FILE.entryCount * GC_FILE.entrySize;
      this.raw.copyWithin(o, o + GC_FILE.entrySize, end);
      this.raw.fill(0, end - GC_FILE.entrySize, end);
      return true;
    }
    return false;
  }

  // 0AE8: swaps the two slots of the list; a card that appears twice is an error.
  swap(a: number, b: number): boolean {
    const idx = (gc: number): number => {
      const hits = this.view().entries.map((e, i) => (e.card.guildCardNumber === gc ? i : -1)).filter((i) => i >= 0);
      if (hits.length > 1) throw new Error(`guild card ${gc} appears ${hits.length} times`);
      return hits.length ? hits[0]! : -1;
    };
    const ia = idx(a);
    const ib = idx(b);
    if (ia < 0 || ib < 0) return false;
    if (ia === ib) return true;
    const oa = GC_FILE.entriesOffset + ia * GC_FILE.entrySize;
    const ob = GC_FILE.entriesOffset + ib * GC_FILE.entrySize;
    const tmp = this.raw.slice(oa, oa + GC_FILE.entrySize);
    this.raw.set(this.raw.slice(ob, ob + GC_FILE.entrySize), oa);
    this.raw.set(tmp, ob);
    return true;
  }

  // 09E8: writes the comment of the card's slot.
  setComment(guildCardNumber: number, comment: string): boolean {
    for (let i = 0; i < GC_FILE.entryCount; i++) {
      const o = GC_FILE.entriesOffset + i * GC_FILE.entrySize;
      if (parseGuildCard(this.raw, o).guildCardNumber === guildCardNumber) {
        this.raw.set(utf16Bytes(comment, GC_FILE.commentUnits), o + GC_FILE.cardSize);
        return true;
      }
    }
    return false;
  }

  // 07E8: the first free blocked slot takes the card.
  blockAdd(card: GuildCard): boolean {
    for (let i = 0; i < GC_FILE.blockedCount; i++) {
      const o = GC_FILE.blockedOffset + i * GC_FILE.cardSize;
      if (!parseGuildCard(this.raw, o).present) {
        this.raw.set(buildGuildCard(card), o);
        return true;
      }
    }
    return false;
  }

  // 08E8: removes the blocked card and shifts the rest up.
  blockDelete(guildCardNumber: number): boolean {
    for (let i = 0; i < GC_FILE.blockedCount; i++) {
      const o = GC_FILE.blockedOffset + i * GC_FILE.cardSize;
      if (parseGuildCard(this.raw, o).guildCardNumber !== guildCardNumber) continue;
      const end = GC_FILE.blockedOffset + GC_FILE.blockedCount * GC_FILE.cardSize;
      this.raw.copyWithin(o, o + GC_FILE.cardSize, end);
      this.raw.fill(0, end - GC_FILE.cardSize, end);
      return true;
    }
    return false;
  }
}

export class GuildCardError extends Error {}

// Runs the guild card protocol on a game-server connection: the file download
// (with the CRC check and a restart on mismatch, like the exe), the search and
// the list commands, which also update the local book.
export class GuildCardClient {
  book: GuildCardBook | null = null;
  private readonly link: CommandLink;
  private readonly timeoutMs: number;

  constructor(link: CommandLink, timeoutMs = 5000) {
    this.link = link;
    this.timeoutMs = timeoutMs;
  }

  // Checks the cached copy (if any) and downloads the file when the server asks.
  // Resolves with the book; a CRC mismatch restarts the download (3 tries).
  async sync(cached: GuildCardBook | null = null, maxTries = 3): Promise<GuildCardBook> {
    const local = cached ? cached.checksum() : 0;
    this.send(checksumPacket(local));
    const reply = await this.wait(GC_CMD.checksumResult);
    if (!parseChecksumResult(reply.data)) {
      if (!cached) throw new GuildCardError('server says the cached file is current but there is no copy');
      this.book = cached;
      return cached;
    }
    for (let attempt = 0; attempt < maxTries; attempt++) {
      const book = await this.download();
      if (book) {
        this.book = book;
        return book;
      }
    }
    throw new GuildCardError('guild card file checksum never matched');
  }

  // One transfer: 03E8, 01DC, then 03DC / 02DC per chunk. Resolves null on a CRC mismatch.
  private async download(): Promise<GuildCardBook | null> {
    this.send(downloadPacket());
    const header = parseFileHeader((await this.wait(GC_CMD.fileHeader)).data);
    if (header.fileSize !== GC_FILE.size) throw new GuildCardError(`guild card file size ${header.fileSize}`);
    const buf = new Uint8Array(header.fileSize);
    const count = Math.ceil(header.fileSize / GC_FILE.chunkSize);
    let index = 0;
    let req = chunkRequestPacket(header.unknownA1, 0, true);
    for (;;) {
      this.send(req);
      const chunk = parseFileChunk((await this.wait(GC_CMD.fileChunk)).data);
      if (chunk.chunkIndex !== index) throw new GuildCardError(`chunk ${chunk.chunkIndex}, want ${index}`);
      const at = index * GC_FILE.chunkSize;
      const want = Math.min(GC_FILE.chunkSize, header.fileSize - at);
      buf.set(chunk.data.subarray(0, want), at);
      index++;
      if (index >= count) break;
      req = chunkRequestPacket(header.unknownA1, index, true);
    }
    if (crc32(buf) !== header.checksum) {
      // The exe asks again with 03E8 (send_packet0xe8_subcommand0x3).
      return null;
    }
    this.send(chunkRequestPacket(header.unknownA1, index, false));
    return new GuildCardBook(buf);
  }

  // 0040 -> 0041. Resolves null when no reply comes (the target is offline or blocks the searcher).
  async search(searcher: number, target: number): Promise<GuildCardSearchResult | null> {
    while (this.link.poll(GC_CMD.searchResult)); // stale answers must not satisfy this search
    this.send(searchPacket(searcher, target));
    try {
      const r = await this.wait(GC_CMD.searchResult);
      const res = parseSearchResult(r.data);
      return res.guildCardNumber === target ? res : null;
    } catch (e) {
      if (e instanceof GuildCardError) return null;
      throw e;
    }
  }

  // The list commands: sent to the server and applied to the local copy the same way.
  add(card: GuildCard): void {
    this.send(addCardPacket(card));
    this.book?.add(card);
  }

  update(card: GuildCard): void {
    this.send(updateCardPacket(card));
    this.book?.update(card);
  }

  remove(guildCardNumber: number): void {
    this.send(deleteCardPacket(guildCardNumber));
    this.book?.remove(guildCardNumber);
  }

  swap(a: number, b: number): void {
    this.send(swapPacket(a, b));
    this.book?.swap(a, b);
  }

  setComment(guildCardNumber: number, comment: string): void {
    this.send(commentPacket(guildCardNumber, comment));
    this.book?.setComment(guildCardNumber, comment);
  }

  block(card: GuildCard): void {
    this.send(blockPacket(card));
    this.book?.blockAdd(card);
  }

  unblock(guildCardNumber: number): void {
    this.send(unblockPacket(guildCardNumber));
    this.book?.blockDelete(guildCardNumber);
  }

  private send(p: Packet): void {
    this.link.send(p.command, p.flag, p.payload);
  }

  private wait(command: number): Promise<Command> {
    return new Promise<Command>((resolve, reject) => {
      const t = setTimeout(() => reject(new GuildCardError(`no answer to ${command.toString(16)}`)), this.timeoutMs);
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

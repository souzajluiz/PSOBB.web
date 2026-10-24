// The BB guild card book: packet layouts (exe send_packet0xe8_* / 03DC / 0040),
// the file codec (entries at 0x1F74, stride 0x1BC), the book's slot rules (newserv
// on_E8_BB) and the download / search flow against a scripted server.
// Run: node tests/guildcard.test.ts
import {
  addCardPacket,
  blockPacket,
  checksumPacket,
  chunkRequestPacket,
  commentPacket,
  crc32,
  deleteCardPacket,
  GC_CMD,
  GC_FILE,
  GC_PLAYER_TAG,
  GuildCardBook,
  GuildCardClient,
  buildGuildCard,
  parseFileChunk,
  parseFileHeader,
  parseGuildCard,
  parseSearchResult,
  phaseLabelOf,
  searchPacket,
  swapPacket,
  type CommandLink,
  type GuildCard,
  type Packet,
} from '../client/src/net/guildcard.ts';
import type { Command } from '../client/src/net/bbconnection.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
}

function card(gc: number, name: string, extra: Partial<GuildCard> = {}): GuildCard {
  return {
    guildCardNumber: gc,
    name,
    teamName: '',
    description: `desc ${name}`,
    present: true,
    language: 1,
    sectionId: 2,
    charClass: 3,
    ...extra,
  };
}

function u32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// ---- constants and CRC -----------------------------------------------------
check('CRC-32 check value (123456789)', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
check('file: entries end at the file size', GC_FILE.entriesOffset + GC_FILE.entryCount * GC_FILE.entrySize === GC_FILE.size);
check('file: blocked list, then 0x180 unknown bytes (newserv unknown_a2), then the entries', GC_FILE.blockedOffset + GC_FILE.blockedCount * GC_FILE.cardSize + 0x180 === GC_FILE.entriesOffset);
check('entry = card + 0x58 UTF-16 comment + 4 bytes', GC_FILE.cardSize + GC_FILE.commentUnits * 2 + 4 === GC_FILE.entrySize);

// ---- packet layouts ---------------------------------------------------------
{
  const p = checksumPacket(0x12345678);
  check('01E8 command and payload (checksum, 0)', p.command === 0x01e8 && p.flag === 0 && hex(p.payload) === '78563412' + '00000000');
  const r = chunkRequestPacket(1, 2, true);
  check('03DC {unknown_a1, index, cont} is 12 bytes', r.command === 0x03dc && r.payload.length === 12 && hex(r.payload) === '01000000' + '02000000' + '01000000');
  check('03DC cont 0 ends the transfer', hex(chunkRequestPacket(1, 3, false).payload).endsWith('00000000'));
  const s = searchPacket(7, 9);
  check('0040 search is tag, searcher, target', s.command === 0x0040 && hex(s.payload) === hex(concat(u32(GC_PLAYER_TAG), u32(7), u32(9))));
  check('05E8 delete is one u32', deleteCardPacket(42).command === 0x05e8 && hex(deleteCardPacket(42).payload) === '2a000000');
  check('0AE8 swap is two u32', hex(swapPacket(1, 2).payload) === '01000000' + '02000000');
  const c = commentPacket(5, 'hi');
  check('09E8 comment is 0xB4 bytes: gc, UTF-16 comment[0x58]', c.command === 0x09e8 && c.payload.length === 0xb4 && c.payload[4] === 0x68 && c.payload[6] === 0x69);
  check('04E8 add carries a 0x108 record', addCardPacket(card(1, 'A')).payload.length === 0x108 && addCardPacket(card(1, 'A')).command === 0x04e8);
  check('07E8 block carries a 0x108 record', blockPacket(card(1, 'A')).command === 0x07e8);
  check('command numbers match the exe send sites', GC_CMD.checksum === 0x1e8 && GC_CMD.download === 0x3e8 && GC_CMD.blockDelete === 0x8e8 && GC_CMD.swap === 0xae8);
}

// ---- record and file codec --------------------------------------------------
{
  const a = card(0x1234, 'Alice', { teamName: 'Team', description: 'hello there' });
  const bytes = buildGuildCard(a);
  const back = parseGuildCard(bytes);
  check('record round trip', back.guildCardNumber === 0x1234 && back.name === 'Alice' && back.teamName === 'Team' && back.description === 'hello there' && back.present && back.language === 1 && back.sectionId === 2 && back.charClass === 3, JSON.stringify(back));
  check('name is stored with the \\tE marker', bytes[4] === 0x09 && bytes[5] === 0 && bytes[6] === 0x45 && bytes[7] === 0);
}

// ---- the book ---------------------------------------------------------------
function blankBook(): GuildCardBook {
  return new GuildCardBook();
}

{
  const b = blankBook();
  check('empty book has no cards', b.cards().length === 0 && b.find(1) === null);
  check('add fills the first slot', b.add(card(10, 'A')) && b.add(card(20, 'B')));
  check('cards come back in list order', b.cards().map((c) => c.guildCardNumber).join(',') === '10,20');
  b.setComment(10, 'first');
  b.add(card(10, 'A2'));
  const e = b.find(10);
  check('add on the same number replaces the record and keeps the comment', e?.card.name === 'A2' && e.comment === 'first', JSON.stringify(e));
  b.swap(10, 20);
  check('swap exchanges slots (comment moves with the slot)', b.view().entries[0]!.card.guildCardNumber === 20 && b.view().entries[1]!.card.guildCardNumber === 10 && b.view().entries[1]!.comment === 'first');
  check('remove shifts the rest up', b.remove(20) && b.cards().map((c) => c.guildCardNumber).join(',') === '10');
  check('remove of an unknown card does nothing', !b.remove(999) && b.cards().length === 1);
  const before = b.checksum();
  b.update(card(10, 'Renamed'));
  check('update overwrites the card and changes the checksum', b.find(10)?.card.name === 'Renamed' && b.checksum() !== before);
  check('block list: add and delete', b.blockAdd(card(77, 'Bad')) && b.view().blocked[0]!.guildCardNumber === 77 && b.blockDelete(77) && !b.view().blocked[0]!.present);
  check('swap of a missing card is refused', !blankBook().swap(1, 2));
}

// ---- download flow against a scripted server --------------------------------
// A link whose send() answers at once, like the server does. waitFor() works
// on a backlog, the same way BBConnection does.
class ScriptedLink implements CommandLink {
  sent: Packet[] = [];
  private backlog: Command[] = [];
  private waiters: Array<{ match: (c: Command) => boolean; resolve: (c: Command) => void }> = [];
  private readonly respond: (p: Packet) => Command[];
  constructor(respond: (p: Packet) => Command[]) {
    this.respond = respond;
  }

  send(command: number, flag: number, payload: Uint8Array = new Uint8Array(0)): void {
    const p = { command, flag, payload };
    this.sent.push(p);
    for (const c of this.respond(p)) this.deliver(c);
  }

  private deliver(c: Command): void {
    const i = this.waiters.findIndex((w) => w.match(c));
    if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(c);
    else this.backlog.push(c);
  }

  waitFor(...commands: number[]): Promise<Command> {
    const match = (c: Command) => commands.includes(c.command);
    const i = this.backlog.findIndex(match);
    if (i >= 0) return Promise.resolve(this.backlog.splice(i, 1)[0]!);
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  poll(...commands: number[]): Command | null {
    const i = this.backlog.findIndex((c) => commands.includes(c.command));
    return i >= 0 ? this.backlog.splice(i, 1)[0]! : null;
  }
}

function serverFile(): Uint8Array {
  const book = blankBook();
  for (let i = 0; i < 60; i++) book.add(card(1000 + i, `Friend ${i}`, { description: 'x'.repeat(i) }));
  book.setComment(1005, 'met at the lobby');
  return book.raw;
}

function cmd(command: number, data: Uint8Array, flag = 0): Command {
  return { command, flag, data };
}

// Sends the file in chunks of 0x6800 like newserv; badCrcFirst makes the first copy wrong.
function fileServer(file: Uint8Array, badCrcFirst: boolean): (p: Packet) => Command[] {
  let downloads = 0;
  const unknownA1 = 1;
  return (p) => {
    if (p.command === 0x01e8) return [cmd(0x02e8, u32(1))];
    if (p.command === 0x03e8) {
      downloads++;
      const crc = crc32(file) ^ (badCrcFirst && downloads === 1 ? 1 : 0);
      return [cmd(0x01dc, concat(u32(unknownA1), u32(file.length), u32(crc)))];
    }
    if (p.command === 0x03dc) {
      const req = parseChunkReq(p.payload);
      if (!req.cont) return [];
      const at = req.index * GC_FILE.chunkSize;
      const data = file.subarray(at, Math.min(file.length, at + GC_FILE.chunkSize));
      return [cmd(0x02dc, concat(u32(0), u32(req.index), data))];
    }
    return [];
  };
}

function parseChunkReq(p: Uint8Array): { unknown: number; index: number; cont: boolean } {
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return { unknown: dv.getUint32(0, true), index: dv.getUint32(4, true), cont: dv.getUint32(8, true) !== 0 };
}

async function main() {
  // header and chunk parsers
  const file = serverFile();
  const hdr = parseFileHeader(concat(u32(1), u32(file.length), u32(0xdeadbeef)));
  check('01DC header parse', hdr.unknownA1 === 1 && hdr.fileSize === GC_FILE.size && hdr.checksum === 0xdeadbeef);
  const ch = parseFileChunk(concat(u32(0), u32(2), new Uint8Array([9, 8, 7])));
  check('02DC chunk parse', ch.chunkIndex === 2 && ch.data.length === 3 && ch.data[0] === 9);

  // a full sync from an empty cache
  {
    const link = new ScriptedLink(fileServer(file, false));
    const client = new GuildCardClient(link, 1000);
    const book = await client.sync(null);
    check('sync downloads the file', hex(book.raw) === hex(file));
    // 0xD590 bytes = 3 chunks of 0x6800: three cont-1 requests, then one cont-0.
    check('sync: 3 chunk requests and the closing cont 0', link.sent.filter((p) => p.command === 0x03dc).length === 4);
    const last = link.sent.filter((p) => p.command === 0x03dc).pop()!;
    check('sync ends with a 03DC cont 0', parseChunkReq(last.payload).cont === false);
    check('sync reads the entries', book.find(1005)?.comment === 'met at the lobby' && book.cards().length === 60);
    check('client keeps the book', client.book === book);
  }

  // checksum of the cache is sent; the server says it is current
  {
    const link = new ScriptedLink((p) => (p.command === 0x01e8 ? [cmd(0x02e8, u32(0))] : []));
    const client = new GuildCardClient(link, 1000);
    const cached = new GuildCardBook(file);
    const book = await client.sync(cached);
    check('sync with a current cache skips the download', book === cached && link.sent.length === 1 && link.sent[0]!.command === 0x01e8);
    check('01E8 carries the cache checksum', hex(link.sent[0]!.payload) === hex(concat(u32(crc32(file)), u32(0))));
  }

  // a CRC mismatch restarts the download
  {
    const link = new ScriptedLink(fileServer(file, true));
    const client = new GuildCardClient(link, 1000);
    const book = await client.sync(null);
    check('CRC mismatch restarts with 03E8', link.sent.filter((p) => p.command === 0x03e8).length === 2 && hex(book.raw) === hex(file));
  }

  // search: the server answers 0041 for an online target
  {
    const link = new ScriptedLink((p) => {
      if (p.command !== 0x0040) return [];
      const target = new DataView(p.payload.buffer, p.payload.byteOffset).getUint32(8, true);
      const res = new Uint8Array(0x128);
      const dv = new DataView(res.buffer);
      dv.setUint32(0, GC_PLAYER_TAG, true);
      dv.setUint32(4, 7, true);
      dv.setUint32(8, target, true);
      dv.setUint32(0x14, 0x0100007f, true);
      dv.setUint16(0x18, 5000, true);
      const put = (o: number, s: string, units: number) => {
        for (let i = 0; i < s.length && i < units - 1; i++) dv.setUint16(o + i * 2, s.charCodeAt(i), true);
      };
      put(0x1c, 'BLOCK02-05', 0x44);
      dv.setUint32(0xa4, 3, true);
      dv.setUint32(0xa8, 4, true);
      put(0xe8, 'Bob', 0x20);
      return [cmd(0x0041, res)];
    });
    const client = new GuildCardClient(link, 1000);
    const r = await client.search(7, 9);
    check('search parses the 0041 reply', r !== null && r.guildCardNumber === 9 && r.searcher === 7 && r.port === 5000 && r.location === 'BLOCK02-05' && r.menuId === 3 && r.itemId === 4 && r.name === 'Bob', JSON.stringify(r));
    check('an empty 0041 body reads as blank', parseSearchResult(new Uint8Array(0x128)).name === '');
  }

  // 0041 Meet the User fields (newserv send_card_search_result_t, exe handle_ship_packet0x41 copy):
  // the embedded 19 header at payload 0x0c (8 bytes), its flag at 0x10, its body at 0x14 (8 bytes:
  // address, port, unused); the location at 0x1c; the lobby ref at 0xa4 / 0xa8 (BB 8-byte header not counted).
  {
    const res = new Uint8Array(0x128);
    const dv = new DataView(res.buffer);
    dv.setUint16(0x0c, 0x10, true); // embedded size
    dv.setUint16(0x0e, 0x19, true); // embedded command
    dv.setUint32(0x10, 0, true); // embedded flag
    res.set([0x7f, 0x00, 0x00, 0x01], 0x14); // address (big-endian)
    dv.setUint16(0x18, 5278, true); // port
    const location = 'BLOCK01-03,,BLOCK01,Ship Alpha';
    for (let i = 0; i < location.length; i++) dv.setUint16(0x1c + i * 2, location.charCodeAt(i), true);
    dv.setUint32(0xa4, 0x33000033, true);
    dv.setUint32(0xa8, 3, true);
    const r = parseSearchResult(res);
    check('the embedded 19 body is the 8 bytes at 0x14', hex(r.reconnect.body) === '7f000001' + '9e14' + '0000', hex(r.reconnect.body));
    check('the embedded 19 flag is 0', r.reconnect.flag === 0);
    check('the phase label is the last , token (ProcessPhaseLabel)', r.phaseLabel === 'Ship Alpha', r.phaseLabel);
    check('the lobby ref is LOBBY and the lobby number', r.menuId === 0x33000033 && r.itemId === 3, `${r.menuId} ${r.itemId}`);
    check('phaseLabelOf: no comma is the whole string, empty tokens skipped', phaseLabelOf('BLOCK02-05') === 'BLOCK02-05' && phaseLabelOf('a,,,b,') === 'b');
    check('phaseLabelOf: a token is cut at 0x10 units', phaseLabelOf(`x,${'y'.repeat(20)}`) === 'y'.repeat(16));
    check('phaseLabelOf: an empty location is empty', phaseLabelOf('') === '');
  }

  // a search with no answer (offline target) resolves null
  {
    const client = new GuildCardClient(new ScriptedLink(() => []), 20);
    check('offline target resolves null', (await client.search(7, 9)) === null);
  }

  // list commands update the local copy and send the matching E8 command
  {
    const link = new ScriptedLink(() => []);
    const client = new GuildCardClient(link, 20);
    client.book = blankBook();
    client.add(card(5, 'Eve'));
    client.setComment(5, 'hi');
    client.remove(5);
    check('add, comment and remove send 04E8 / 09E8 / 05E8', link.sent.map((p) => p.command.toString(16)).join(',') === '4e8,9e8,5e8');
    check('local copy follows the commands', client.book.cards().length === 0);
  }

  console.log(failures ? `${failures} FAILED` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
}

main();

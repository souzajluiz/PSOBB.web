// The lobby Home menu's Info Board leaf (main menu entry 0x16): the 00D8 request and
// answer, the 00D9 write packet (net/infoboard.ts), and the window's key flow
// (classic/infoboard.ts): menu -> view (request, list, message) -> menu, and
// menu -> write (keyboard with the own message) -> menu. Run: node tests/infoboard.test.ts
import {
  INFO_BOARD_ENTRY_BYTES,
  INFO_BOARD_MAX_ENTRIES,
  INFO_BOARD_TYPED_MAX,
  InfoBoardClient,
  infoBoardRequestPacket,
  infoBoardWritePacket,
  parseInfoBoardList,
  readUtf16Field,
} from '../client/src/net/infoboard.ts';
import { INFO_BOARD_POS, INFO_BOARD_ROW, INFO_BOARD_TEXT, InfoBoardMenu, type InfoBoardHost } from '../client/src/classic/infoboard.ts';
import type { Command } from '../client/src/net/bbconnection.ts';
import type { CommandLink } from '../client/src/net/guildcard.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
}

const utf16 = (s: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff, s.charCodeAt(i) >> 8);
  return out;
};
const text = (i: number): string => `t${i.toString(16)}`;
const key = (k: string) => ({ key: k });

// A 00D8 body: entries of 0x178 (name 0x20 bytes, message 0x158 bytes), UTF-16LE, zero filled.
function boardBody(players: Array<[string, string]>): Uint8Array {
  const body = new Uint8Array(players.length * INFO_BOARD_ENTRY_BYTES);
  players.forEach(([name, message], i) => {
    const base = i * INFO_BOARD_ENTRY_BYTES;
    body.set(utf16(name), base);
    body.set(utf16(message), base + 0x20);
  });
  return body;
}

// A link that records what was sent and answers from a queue.
function fakeLink(replies: Command[], stale: Command[] = []) {
  const sent: Array<{ command: number; flag: number; payload: Uint8Array }> = [];
  const queue = [...stale];
  const link: CommandLink & { sent: typeof sent } = {
    sent,
    send: (command: number, flag: number, payload?: Uint8Array) => {
      sent.push({ command, flag, payload: payload ?? new Uint8Array(0) });
    },
    waitFor: async (command: number) => {
      const r = replies.shift();
      if (!r || r.command !== command) throw new Error(`unexpected wait ${command.toString(16)}`);
      return r;
    },
    poll: (command: number) => {
      const i = queue.findIndex((c) => c.command === command);
      if (i < 0) return null;
      return queue.splice(i, 1)[0] ?? null;
    },
  };
  return link;
}

// 1. The request packet: 00D8, flag 0, no body (exe FUN_007d79f4: size 8).
{
  const p = infoBoardRequestPacket();
  check('request is 00D8 with flag 0 and no body', p.command === 0xd8 && p.flag === 0 && p.payload.length === 0);
}

// 2. The write packet: 00D9, text as UTF-16LE, size (2 * units + 13) & ~3 (exe FUN_007d7aa4).
{
  const p = infoBoardWritePacket('ab');
  const size = 8 + p.payload.length;
  check('write is 00D9', p.command === 0xd9 && p.flag === 0);
  check('write size of "ab" is (4 + 13) & ~3 = 16', size === 16, `size ${size}`);
  check('write body holds "ab" as UTF-16LE and zero fill', p.payload[0] === 0x61 && p.payload[2] === 0x62 && p.payload[4] === 0 && p.payload[5] === 0);
  check('write of "" is size 12 (the exe rule)', 8 + infoBoardWritePacket('').payload.length === 12);
  let ok = true;
  for (let n = 0; n <= 0xac; n++) {
    const q = infoBoardWritePacket('x'.repeat(n));
    const sz = 8 + q.payload.length;
    if (sz % 4 !== 0 || sz < 8 + 2 * n + 2 || sz > 8 + 2 * n + 2 + 6) ok = false;
  }
  check('write size is 4-aligned and holds the text and its terminator for every length 0..172', ok);
  const long = infoBoardWritePacket('y'.repeat(400));
  // 172 units: (344 + 13) & ~3 = 356 bytes on the wire (exe _wcsncpy(…, 0xAC)).
  check('write text is capped at 172 units (0xAC, exe _wcsncpy)', 8 + long.payload.length === 356, `size ${8 + long.payload.length}`);
}

// 3. The answer: count from the BB header flag, entries of 0x178 from the body (exe 0078e11c, newserv send_info_board_t).
{
  const entries = parseInfoBoardList(2, boardBody([['Ann', 'hello'], ['Bob', '']]));
  check('two entries parsed with their names', entries.length === 2 && entries[0]?.name === 'Ann' && entries[1]?.name === 'Bob');
  check('messages read from +0x20 of each entry', entries[0]?.message === 'hello' && entries[1]?.message === '');
  const clamped = parseInfoBoardList(5, boardBody([['A', 'a']]));
  check('a count above the body is clamped to the entries present', clamped.length === 1);
  const cap = parseInfoBoardList(40, new Uint8Array(40 * INFO_BOARD_ENTRY_BYTES));
  check(`the exe buffer holds ${INFO_BOARD_MAX_ENTRIES} entries at most`, cap.length === INFO_BOARD_MAX_ENTRIES && INFO_BOARD_MAX_ENTRIES === 17);
  const nul = new Uint8Array(0x20);
  nul.set(utf16('Cy'), 0);
  nul.set(utf16('z'), 6); // past the terminator: must not be read
  check('a name ends at its zero unit', readUtf16Field(nul, 0, 0x20) === 'Cy');
}

// 4. The client: request, drain of stale answers, the reply's entries.
{
  const stale: Command = { command: 0xd8, flag: 9, data: boardBody([['Old', 'x']]) };
  const reply: Command = { command: 0xd8, flag: 1, data: boardBody([['New', 'news']]) };
  const link = fakeLink([reply], [stale]);
  const client = new InfoBoardClient(link, 1000);
  const entries = await client.fetch();
  check('fetch sends 00D8 once', link.sent.length === 1 && link.sent[0]?.command === 0xd8);
  check('fetch drops the stale answer and keeps the new one', entries.length === 1 && entries[0]?.name === 'New' && client.entries[0]?.message === 'news');
  client.write('hi');
  check('write sends 00D9 with the text', link.sent[1]?.command === 0xd9 && link.sent[1].payload[0] === 0x68);
}

// 5. The window: the menu rows and their lobby test, the view flow, the write flow.
{
  const made: Array<{ text: string; own: string | null }> = [];
  const replies: Command[] = [];
  let lobby = true;
  let own = 'mine';
  const link = fakeLink(replies);
  const host: InfoBoardHost = {
    client: new InfoBoardClient(link, 1000),
    inLobby: () => lobby,
    own: () => own,
    setOwn: (t) => {
      own = t;
    },
  };
  const write = host.client.write.bind(host.client);
  host.client.write = (t: string) => {
    made.push({ text: t, own });
    write(t);
  };

  const menu = new InfoBoardMenu(text, host);
  check('the menu has View the board and Board: Write', menu.menuRows().map((r) => r.label).join('|') === `${text(INFO_BOARD_TEXT.view)}|${text(INFO_BOARD_TEXT.write)}`);
  check('View the board is enabled in the lobby', menu.menuRows()[0]?.enabled === true);
  lobby = false;
  check('View the board is greyed outside the lobby (exe 0x750690 ee0 variant)', menu.menuRows()[0]?.enabled === false);
  lobby = true;
  check('the window opens in the menu and is open', menu.phase === 'menu' && menu.open);
  check('the menu positions are the table entries (0xab 13,256; 0xad 194,256; 0xae 419,256; 0xcf 331,266)', INFO_BOARD_POS.menu.x === 13 && INFO_BOARD_POS.list.x === 194 && INFO_BOARD_POS.message.x === 419 && INFO_BOARD_POS.keyboard.y === 266);

  // View: request, answer, list.
  replies.push({ command: 0xd8, flag: 2, data: boardBody([['Ann', 'first'], ['Bob', 'second']]) });
  menu.key(key('Enter'));
  check('View goes to the loading state while the answer is awaited', menu.phase === 'loading');
  await new Promise((r) => setTimeout(r, 0));
  check('the answer opens the list', menu.phase === 'list');
  check('the list starts on the first player message', menu.highlightedMessage() === 'first');
  menu.key(key('ArrowDown'));
  check('moving the cursor shows that player message', menu.highlightedMessage() === 'second');
  menu.key(key('Escape'));
  check('cancel in the list goes back to the menu', menu.phase === 'menu' && menu.open);

  // Write: keyboard with the own message, Enter sends 00D9 and keeps the text.
  menu.key(key('ArrowDown'));
  menu.key(key('Enter'));
  check('Board: Write opens the keyboard', menu.phase === 'write');
  menu.key(key('Backspace'));
  for (const c of 'ok') menu.key(key(c));
  menu.key(key('Enter'));
  check('Enter writes the typed text (own "mine" minus one char plus "ok")', made.length === 1 && made[0]?.text === 'minok', JSON.stringify(made));
  check('the accepted text becomes the own message', own === 'minok');
  check('back in the menu after the write', menu.phase === 'menu');

  // Escape in the keyboard sends nothing.
  // The cursor stays on Board: Write after the write above.
  menu.key(key('Enter'));
  menu.key(key('x'));
  menu.key(key('Escape'));
  check('Escape in the keyboard sends nothing and returns to the menu', made.length === 1 && menu.phase === 'menu');

  // The empty board: the greyed No Player row.
  const empty = new InfoBoardMenu(text, { ...host, own: () => '' });
  replies.push({ command: 0xd8, flag: 0, data: new Uint8Array(0) });
  empty.key(key('Enter'));
  await new Promise((r) => setTimeout(r, 0));
  check('an empty board lists the greyed No Player row', empty.phase === 'list' && empty.listRows([])[0]?.enabled === false);

  // Close from the menu.
  menu.key(key('Escape'));
  check('cancel in the menu closes the window', menu.phase === 'closed' && !menu.open);
}

// 6. The keyboard limit: the typed text is capped at 0xAB units (exe 0078e000).
check('the keyboard holds 0xab units', INFO_BOARD_TYPED_MAX === 0xab);

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

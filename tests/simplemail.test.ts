// The Simple Mail (BB): the 0081 packets both ways, the C7 / C8 answer packets, the store
// (50 mails, newest first in the window), the answer service flags, and the window's flows
// (top menu, send to a book card, the mail list, reply, delete, the answer text).
// Run: node tests/simplemail.test.ts
import type { Command } from '../client/src/net/bbconnection.ts';
import type { CommandLink, GuildCard, GuildCardBook } from '../client/src/net/guildcard.ts';
import {
  MAIL_BODY,
  MAIL_BODY_BYTES,
  MAIL_CAPACITY,
  MAIL_CMD,
  MAIL_FLAG,
  MAIL_PACKET_BYTES,
  MAIL_PLAYER_TAG,
  MailStore,
  SimpleMailBox,
  answerOffPacket,
  answerOnPacket,
  mailTextAccepted,
  parseMailBody,
  readUnits,
  simpleMailPacket,
} from '../client/src/net/simplemail.ts';
// The Question and the text helpers measure on an OffscreenCanvas (gametext.ts); a fixed
// advance is enough for the window's logic. The window module loads after the stub.
const measure = { measureText: () => ({ width: 7 }), getImageData: () => ({ data: new Uint8ClampedArray(64) }) };
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext() {
    return measure;
  }
};
const { MAIL_POS, MAIL_TEXT, SimpleMailMenu } = await import('../client/src/classic/simplemail.ts');
type SimpleMailHost = Parameters<typeof SimpleMailMenu.prototype.constructor>[1];

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
const readU16 = (b: Uint8Array, off: number) => new DataView(b.buffer, b.byteOffset).getUint16(off, true);
const readU32 = (b: Uint8Array, off: number) => new DataView(b.buffer, b.byteOffset).getUint32(off, true);
const readStr = (b: Uint8Array, off: number, units: number) => {
  let s = '';
  for (let i = 0; i < units; i++) {
    const u = readU16(b, off + 2 * i);
    if (u === 0) break;
    s += String.fromCharCode(u);
  }
  return s;
};

// A 0081 body as the server sends it (newserv's SC_SimpleMail_BB_81 without the header).
function mailBody(gc: number, name: string, date: string, message: string): Uint8Array {
  const body = new Uint8Array(MAIL_BODY_BYTES);
  const dv = new DataView(body.buffer);
  dv.setUint32(0, MAIL_PLAYER_TAG, true);
  dv.setUint32(MAIL_BODY.fromGc, gc, true);
  body.set(utf16(name), MAIL_BODY.fromName);
  // The name field is read 23 units long (exe 00813930), so the units after it are not zero here.
  dv.setUint32(MAIL_BODY.toGc, 0x00050005, true);
  body.set(utf16(date), MAIL_BODY.date);
  body.set(utf16(message), MAIL_BODY.text);
  return body;
}

// A link that records what was sent.
function fakeLink() {
  const sent: Array<{ command: number; flag: number; payload: Uint8Array }> = [];
  const link: CommandLink & { sent: typeof sent } = {
    sent,
    send: (command: number, flag: number, payload?: Uint8Array) => {
      sent.push({ command, flag, payload: payload ?? new Uint8Array(0) });
    },
    waitFor: async (): Promise<Command> => {
      throw new Error('no reply expected');
    },
    poll: () => null,
  };
  return link;
}

function card(gc: number, name: string): GuildCard {
  return { guildCardNumber: gc, name, teamName: '', description: '', present: true, language: 0, sectionId: 0, charClass: 0 };
}

// The book: only the view's entries are read by the window.
function fakeBook(cards: GuildCard[]): GuildCardBook {
  const entries = cards.map((c) => ({ card: c, comment: '' }));
  return { view: () => ({ entries }) } as unknown as GuildCardBook;
}

function makeWindow(book: GuildCardBook | null) {
  const link = fakeLink();
  const box = new SimpleMailBox(link);
  let closes = 0;
  const host: SimpleMailHost = {
    box,
    book: () => book,
    client: () => null,
    self: () => ({ guildCard: 5, name: 'Me' }),
    unitxt: (_g, i) => text(i),
    onClose: () => {
      closes++;
      box.closeWindow();
      box.store.clearUnread();
    },
  };
  const win = new SimpleMailMenu(text, host);
  return { link, box, win, closes: () => closes };
}

const sentOf = (link: { sent: Array<{ command: number; flag: number; payload: Uint8Array }> }, command: number) =>
  link.sent.filter((s) => s.command === command);

// 1. The 0081 packet (FUN_008136f0): size 0x45c, the body fields, the cut-offs.
{
  const p = simpleMailPacket({ tag: MAIL_PLAYER_TAG, guildCard: 1234, name: 'Alice' }, 777, 'Hello');
  check('0081 is command 0x81, flag 0', p.command === 0x81 && p.flag === 0);
  check('0081 body is 0x454 bytes (packet 0x45c)', p.payload.length === 0x454 && MAIL_PACKET_BYTES === 0x45c);
  check('0081 tag at body 0 (0x00010000)', readU32(p.payload, 0) === 0x00010000);
  check('0081 from guild card at body 4', readU32(p.payload, MAIL_BODY.fromGc) === 1234);
  check('0081 from name at body 8, zero terminated', readStr(p.payload, MAIL_BODY.fromName, 32) === 'Alice' && readU16(p.payload, MAIL_BODY.fromName + 10) === 0);
  check('0081 to guild card at body 0x28', readU32(p.payload, MAIL_BODY.toGc) === 777);
  check('0081 text at body 0x54 (packet 0x5c)', readStr(p.payload, MAIL_BODY.text, 171) === 'Hello');
  check('0081 text terminator at packet 0x1b2', readU16(p.payload, 0x1b2 - 8) === 0);
  const longName = simpleMailPacket({ tag: 0, guildCard: 1, name: 'ABCDEFGHIJKLMNOPQRST' }, 2, 'x');
  check('0081 name cut at 15 units (exe unit 15 zeroed)', readStr(longName.payload, MAIL_BODY.fromName, 40) === 'ABCDEFGHIJKLMNO');
  const longText = simpleMailPacket({ tag: 0, guildCard: 1, name: 'a' }, 2, 'y'.repeat(300));
  check('0081 text cut at 171 units', readStr(longText.payload, MAIL_BODY.text, 300).length === 171);
}

// 2. The receive: the fields (FUN_00813930) and the text check (FUN_00813a3c).
{
  const body = mailBody(4321, 'Bob', '2026/10/23 12:00', 'Hi there');
  const m = parseMailBody(body);
  check('receive: sender gc at body 4', m.fromGuildCard === 4321);
  check('receive: sender name', m.fromName === 'Bob');
  check('receive: date', m.date === '2026/10/23 12:00');
  check('receive: text', m.text === 'Hi there');
  const long = mailBody(1, 'N'.repeat(30), 'D'.repeat(30), 'M'.repeat(200));
  const lm = parseMailBody(long);
  check('receive: name read at most 23 units', lm.fromName.length === 23);
  check('receive: date read at most 19 units', lm.date.length === 19);
  check('receive: text read at most 171 units', lm.text.length === 171);
  check('text check: empty message kept', mailTextAccepted(mailBody(1, 'a', 'b', '')));
  const ok = new Uint8Array(MAIL_BODY_BYTES);
  ok.set(utf16('a' + 'b'.repeat(155)), MAIL_BODY.text);
  check('text check: a zero unit within 156 units kept', mailTextAccepted(ok));
  const bad = new Uint8Array(MAIL_BODY_BYTES);
  const units = new Array(170).fill(0x41);
  bad.set(utf16('a'), MAIL_BODY.text);
  bad.set(units.flatMap((u) => [u, 0]), MAIL_BODY.text + 2);
  check('text check: no zero unit in 156 units dropped (FUN_00813a3c)', !mailTextAccepted(bad));
  check('readUnits stops at the zero unit', readUnits(mailBody(1, 'Q', '', ''), MAIL_BODY.fromName, 23) === 'Q');
}

// 3. The store: 50 slots (the oldest dropped when full), serials, delete, the unread bit, the reply mark.
{
  const store = new MailStore();
  const first = store.insert({ fromGuildCard: 1, fromName: 'a', date: '', text: 'x' });
  check('store: a new mail is unread, with the icon (flags 0xb)', first.flags === MAIL_FLAG.used + MAIL_FLAG.unread + MAIL_FLAG.icon && first.serial === 0);
  for (let i = 1; i < MAIL_CAPACITY; i++) store.insert({ fromGuildCard: i, fromName: 'n', date: '', text: '' });
  check('store: holds 50', store.count === MAIL_CAPACITY);
  const v = store.version;
  store.insert({ fromGuildCard: 99, fromName: 'new', date: '', text: '' });
  check('store: full, the oldest is dropped', store.count === MAIL_CAPACITY && store.find(0) === null && store.all()[store.count - 1]!.fromGuildCard === 99);
  check('store: the version moves with a change', store.version > v);
  store.markReplied(store.all()[0]!.serial);
  check('store: reply mark flags = flags & 0xF5 | 4', store.all()[0]!.flags === (((MAIL_FLAG.used | MAIL_FLAG.unread | MAIL_FLAG.icon) & 0xf5) | MAIL_FLAG.replied));
  check('store: remove by serial', store.remove(store.all()[1]!.serial) && store.count === MAIL_CAPACITY - 1);
  store.clearUnread();
  check('store: clearUnread drops the unread bit', store.all().every((e) => (e.flags & MAIL_FLAG.unread) === 0));
}

// 4. The receive path of the box: stored or dropped; the send path.
{
  const box = new SimpleMailBox(fakeLink());
  check('box: a good 0081 is stored', box.receive(mailBody(7, 'Ann', 'd', 'text')) === 'stored' && box.store.count === 1);
  const bad = new Uint8Array(MAIL_BODY_BYTES);
  bad.set(utf16('a'), MAIL_BODY.text);
  bad.set(new Array(170).fill(0x41).flatMap((u) => [u, 0]), MAIL_BODY.text + 2);
  check('box: a bad 0081 is dropped', box.receive(bad) === 'dropped' && box.store.count === 1);
  const sendLink = fakeLink();
  const sbox = new SimpleMailBox(sendLink);
  sbox.send({ guildCard: 5, name: 'Me' }, 42, 'yo');
  const s = sendLink.sent[0]!;
  check('box: send is one 0081 with a 0x454 body', sendLink.sent.length === 1 && s.command === 0x81 && s.payload.length === 0x454);
  check('box: send carries the to guild card', readU32(s.payload, MAIL_BODY.toGc) === 42);
}

// 5. The answer packets (C7 with the text, C8) and the close rule (on_exit_simple_mail_menu).
{
  const on = answerOnPacket('AB');
  check('C7 is 0xc7 with (2*units + 13) & ~3 bytes minus the header', on.command === 0xc7 && on.payload.length === ((2 * 2 + 13) & 0xfffc) - 8);
  check('C7 text is UTF-16 and zero filled', readStr(on.payload, 0, 4) === 'AB' && readU16(on.payload, 4) === 0);
  check('C7 empty text is 4 body bytes', answerOnPacket('').payload.length === 4);
  const off = answerOffPacket();
  check('C8 is 0xc8 with no body', off.command === 0xc8 && off.payload.length === 0);
  check('the command numbers', MAIL_CMD.mail === 0x81 && MAIL_CMD.answerOn === 0xc7 && MAIL_CMD.answerOff === 0xc8);

  const link = fakeLink();
  const box = new SimpleMailBox(link);
  box.closeWindow();
  check('close: nothing changed sends nothing', link.sent.length === 0);
  box.setAnswerText('Away');
  box.closeWindow();
  check('close: text set sends C7 with the text', link.sent.length === 1 && link.sent[0]!.command === 0xc7 && readStr(link.sent[0]!.payload, 0, 8) === 'Away');
  box.closeWindow();
  check('close: a second close sends nothing', link.sent.length === 1);
  check('close: turning the service off sends C8', box.setAnswerEnabled(false) && (box.closeWindow(), link.sent.length === 2 && link.sent[1]!.command === 0xc8));
  check('answer: setAnswerText with a text turns it on', (() => { const b = new SimpleMailBox(fakeLink()); b.setAnswerText('x'); return b.answerOn && b.answerDirty; })());
  check('answer: setAnswerEnabled reports a change only', (() => { const b = new SimpleMailBox(fakeLink()); return b.setAnswerEnabled(true) && !b.setAnswerEnabled(true); })());
}

// 6. The window's flows.
{
  // Send a new mail: Send Mail -> the book card -> keyboard -> confirm (Yes) -> 0081 to the card.
  const { win, link, box, closes } = makeWindow(fakeBook([card(77, 'Bob')]));
  check('window: opens at the top menu', win.phase === 'top' && win.open);
  win.key(key('Enter'));
  check('window: Send Mail opens the book picker', win.phase === 'recipient');
  win.key(key('Enter'));
  check('window: the picked card opens the keyboard', win.phase === 'compose');
  win.key(key('H'));
  win.key(key('i'));
  win.key(key('Enter'));
  check('window: Enter asks for the send', win.phase === 'sendConfirm');
  win.key(key('ArrowUp'));
  win.key(key('Enter'));
  const sent = sentOf(link, 0x81);
  check('window: Yes sends a 0081 to the card with the text', sent.length === 1 && readU32(sent[0]!.payload, MAIL_BODY.toGc) === 77 && readStr(sent[0]!.payload, MAIL_BODY.text, 10) === 'Hi');
  check('window: back to the top after the send', win.phase === 'top');
  check('window: the window stays open (no close packet)', closes() === 0 && link.sent.length === 1);

  // Receive a mail while the window is open; Received Mail is enabled now; cancel closes the window.
  const r = box.receive(mailBody(900, 'Carl', '2026', 'Good luck'));
  check('window: arrival stored', r === 'stored');
  win.key(key('ArrowDown'));
  win.key(key('Enter'));
  check('window: the list shows the mail', win.phase === 'inbox' && win.open);
  win.key(key('Escape'));
  check('window: Escape in the list closes the window and runs the close once', !win.open && closes() === 1);
}

{
  // Reply (the action menu's first row): the recipient is the sender; the reply marks the mail.
  const { win, link, box } = makeWindow(fakeBook([]));
  box.receive(mailBody(900, 'Carl', '2026', 'Good luck'));
  win.key(key('ArrowDown'));
  win.key(key('Enter'));
  win.key(key('Enter'));
  check('reply: the action menu opens for the mail', win.phase === 'action');
  win.key(key('Enter'));
  check('reply: Reply opens the keyboard', win.phase === 'compose');
  win.key(key('R'));
  win.key(key('Enter'));
  win.key(key('ArrowUp'));
  win.key(key('Enter'));
  const sent = sentOf(link, 0x81);
  check('reply: the 0081 goes to the sender', sent.length === 1 && readU32(sent[0]!.payload, MAIL_BODY.toGc) === 900);
  check('reply: the mail is marked answered', box.store.all()[0]!.flags === (((MAIL_FLAG.used | MAIL_FLAG.unread | MAIL_FLAG.icon) & 0xf5) | MAIL_FLAG.replied));
}

{
  // Delete: the action menu's Delete row, then Yes; the mail goes and the list is empty.
  const { win, box } = makeWindow(fakeBook([]));
  box.receive(mailBody(1, 'Del', '', 'bye'));
  win.key(key('ArrowDown'));
  win.key(key('Enter'));
  win.key(key('Enter'));
  win.key(key('ArrowDown'));
  win.key(key('ArrowDown'));
  win.key(key('Enter'));
  check('delete: asks first', win.phase === 'deleteConfirm');
  win.key(key('ArrowUp'));
  win.key(key('Enter'));
  check('delete: Yes removes the mail and goes to the list', box.store.count === 0 && win.phase === 'inbox');
}

{
  // The answer service: the empty text goes to the keyboard; the confirm keeps it and turns the service on.
  const { win, link, box, closes } = makeWindow(fakeBook([]));
  win.key(key('ArrowDown'));
  win.key(key('ArrowDown'));
  win.key(key('Enter'));
  check('answer: an empty text opens the response keyboard', win.phase === 'answerText');
  for (const c of 'Away') win.key(key(c));
  win.key(key('Enter'));
  win.key(key('ArrowUp'));
  win.key(key('Enter'));
  check('answer: Yes keeps the text and the service is on', win.phase === 'top' && box.answerText === 'Away' && box.answerOn);
  win.key(key('Escape'));
  check('answer: closing sends C7 with the text once', !win.open && closes() === 1 && sentOf(link, 0xc7).length === 1);
}

{
  // The answer menu with a text: the on / off list turns the service off, and the close sends C8.
  const link = fakeLink();
  const box = new SimpleMailBox(link);
  box.setAnswerText('Gone');
  box.closeWindow();
  const { win } = { win: new SimpleMailMenu(text, {
    box,
    book: () => null,
    client: () => null,
    self: () => ({ guildCard: 5, name: 'Me' }),
    unitxt: (_g, i) => text(i),
    onClose: () => box.closeWindow(),
  }) };
  win.key(key('ArrowDown'));
  win.key(key('ArrowDown'));
  win.key(key('Enter'));
  check('answer menu: opens with the text set', win.phase === 'answer');
  win.key(key('Enter'));
  check('answer menu: On / Off list', win.phase === 'onOff');
  win.key(key('ArrowDown'));
  win.key(key('Enter'));
  check('answer menu: Off turns the service off', box.answerOn === false && win.phase === 'answer');
  win.key(key('Escape'));
  win.key(key('Escape'));
  check('answer menu: close sends C8 (off changed)', sentOf(link, 0xc8).length === 1 && !win.open);
}

// Layout: the top window is at exe 0xa0 and the keyboard at 0xcf (table 0x00971f40).
check('positions: top 0xa0 (8, 256), keyboard 0xcf (331, 266)', MAIL_POS.top.x === 8 && MAIL_POS.top.y === 256 && MAIL_POS.keyboard.x === 331 && MAIL_POS.keyboard.y === 266);
check('text: Send Mail is unitxt 0x6a, Answer Service 0x12b', MAIL_TEXT.sendMail === 0x6a && MAIL_TEXT.answerService === 0x12b);

console.log(failures === 0 ? '\nall simplemail checks pass' : `\n${failures} failure(s)`);
if (failures) process.exitCode = 1;

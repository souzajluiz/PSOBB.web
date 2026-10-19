// The title screen's logic (classic/titleflow.ts): fades, "PRESS ENTER KEY",
// the Login menu, the Input UserID window and its editors.
//
// Run: node tests/titlescreen.test.ts
import {
  caretColor,
  editedUser,
  EXIT_CONFIRM,
  InputUserIdWindow,
  listWindowHeight,
  LOGIN_MENU,
  LoginMenu,
  mask,
  pressAlpha,
  ScreenFade,
  SE_CANCEL,
  SE_CURSOR,
  SE_TITLE_OK,
  storedUser,
  TitleFlow,
  yesNoRect,
  type Credentials,
  type Key,
} from '../client/src/classic/titleflow.ts';
import { SE_WINDOW_OPEN, WindowAnim } from '../client/src/classic/windowanim.ts';

let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${msg}`);
  }
};

const host = () => {
  const log = { se: [] as number[], start: [] as Credentials[], patch: 0, exit: 0 };
  return {
    log,
    host: {
      se: (id: number) => log.se.push(id),
      start: (c: Credentials) => log.start.push(c),
      patch: () => log.patch++,
      exit: () => log.exit++,
    },
  };
};
const ticks = (f: { tick(): void }, n: number) => {
  for (let i = 0; i < n; i++) f.tick();
};
const type = (f: { key(k: Key): void }, s: string) => [...s].forEach((c) => f.key({ char: c }));

// --- fades --------------------------------------------------------------------
{
  const f = new ScreenFade('in');
  check(f.value === 255 && f.alpha === 1, 'fade-in starts opaque');
  let n = 0;
  while (!f.tick()) n++;
  check(n + 1 === 32 && f.value === 0 && f.alpha === 0, `fade-in: 255 - 8 per frame, done on frame 32 (${n + 1})`);
  const o = new ScreenFade('out');
  n = 0;
  while (!o.tick()) n++;
  check(n + 1 === 32 && o.value === 255, `fade-out: +8 per frame to >= 255 on frame 32 (${n + 1})`);
  check(!o.tick(), 'callback runs once');
}

// --- PRESS ENTER KEY ------------------------------------------------------------
{
  check(Math.abs(pressAlpha(0) - 0.5) < 1e-9, 'alpha 0.5 at counter 0');
  check(Math.abs(pressAlpha(30) - 1) < 1e-9, 'alpha 1 at 90 deg (counter 30)');
  check(Math.abs(pressAlpha(90)) < 1e-9, 'alpha 0 at 270 deg (counter 90)');
  check(Math.abs(pressAlpha(120) - pressAlpha(0)) < 1e-12, 'period 120 frames');
}

// --- title: fade-in gates the keys ------------------------------------------------
{
  const { log, host: h } = host();
  const t = new TitleFlow(h);
  t.key('enter');
  check(t.menu === null, 'no key during the fade-in');
  check(t.press === 0, 'PRESS ENTER KEY hidden during the fade-in');
  ticks(t, 31);
  check(!t.enabled && t.fadeAlpha > 0, 'still fading on frame 31');
  t.tick();
  check(t.enabled && t.fadeAlpha === 0, 'menu child enabled on frame 32');
  check(Math.abs(t.press - 0.5) < 1e-9, 'first alpha uses counter 0');
  t.key('enter');
  check(t.menu !== null && log.se.includes(SE_WINDOW_OPEN), 'Enter opens the Login menu (SE 0x572)');
  check(t.press > 0 && t.state === 0, 'PRESS ENTER KEY stays under the window (state 0)');
  ticks(t, 10);
  t.key('cancel');
  check(t.menu === null, 'cancel destroys the window');
  t.key('exitGame');
  check(log.exit === 1, 'Alt+Backspace exits');
}

// --- Login menu rows ------------------------------------------------------------
{
  const m = new LoginMenu({ user: '', password: '' });
  const rows = m.rows();
  check(rows.length === 5 && rows[4].label === 'Empty' && !rows[4].selectable, 'account line: Empty, not selectable');
  check(!rows[0].selectable && rows[0].color === '#909090', 'Start Game greyed without credentials');
  check(m.selected === 3, 'cursor on Register UserID without credentials');
  const m2 = new LoginMenu({ user: 'bob', password: 'x' });
  check(m2.selected === 0 && m2.rows()[0].selectable && m2.rows()[4].label === '[bob]', 'with credentials: Start Game, [bob]');
  ticks(m2, 10);
  const se: number[] = [];
  m2.se = (id) => se.push(id);
  m2.key('up');
  check(m2.selected === 3 && se[0] === SE_CURSOR, 'up wraps past the account line');
  m2.key('down');
  check(m2.selected === 0, 'down wraps back');
  const m3 = new LoginMenu({ user: '', password: '' });
  m3.key('down');
  check(m3.selected === 1, 'down from Register UserID skips Start Game and the account line');
}

// --- Input UserID ------------------------------------------------------------------
{
  check(editedUser('a b c') === 'abc', 'spaces dropped from the user name');
  check(editedUser('x'.repeat(20)).length === 16, 'user name at most 16');
  check(storedUser('BoB') === 'bob', 'stored user name lower case');
  check(mask(12, 8) === '********' && mask(40, 31).length === 31, 'password masks');
  check(caretColor(0) !== caretColor(16) && caretColor(0) === caretColor(15), 'caret blinks on frame bit 0x10');

  const w = new InputUserIdWindow('');
  w.open();
  ticks(w, 10);
  check(!w.confirmEnabled && w.row === 0, 'Confirm greyed, cursor on UserID');
  w.key('down');
  w.key('down');
  check(w.row === 3, 'down skips the greyed Confirm');
  w.key('up');
  w.key('up');
  w.key('enter');
  check(w.editor?.field === 0 && w.values()[0] === '', 'editor opens on UserID, row value blanked');
  type(w, 'Hun ter');
  w.key('enter');
  check(w.user === 'Hunter' && w.editor === null, 'entry committed without spaces');
  w.key('down');
  w.key('enter');
  type(w, 'secret');
  check(w.editor?.edit.shown === '******', 'password editor shows *');
  w.key('enter');
  check(w.password === 'secret' && w.values()[1] === '******', 'password kept, masked');
  check(w.confirmEnabled && w.row === 2, 'both set: cursor moves to Confirm');
  w.key('enter');
  check(w.result === 'ok', 'Confirm');

  const v = new InputUserIdWindow('abc');
  v.open();
  ticks(v, 10);
  v.key('enter');
  type(v, 'zzz');
  v.key('cancel');
  check(v.user === 'abc' && v.result === null, 'cancelled edit keeps the old text');
  v.key('cancel');
  check(v.result === 'cancel', 'cancel closes the window');
}

// --- full flow: Register UserID -> Start Game -> fade-out -> start --------------------
{
  const { log, host: h } = host();
  const t = new TitleFlow(h);
  ticks(t, 32);
  t.key('enter');
  ticks(t, 10);
  check(t.menu!.selected === 3, 'cursor on Register UserID');
  t.key('enter');
  ticks(t, 10);
  check(t.menu!.input !== null && !t.menu!.active, 'Input UserID open, menu inactive');
  t.key('enter');
  type(t, 'Alice');
  t.key('enter');
  t.key('down');
  t.key('enter');
  type(t, 'pw');
  t.key('cancel');
  check(t.menu !== null && t.menu.input?.editor === null, 'cancel inside an editor only ends the edit');
  t.key('enter');
  type(t, 'pw');
  t.key('enter');
  t.key('enter');
  t.tick();
  check(t.menu!.input === null && t.menu!.creds.user === 'alice', 'credentials stored lower case');
  check(t.menu!.selected === 3, 'menu cursor stays (state 1 does not move it)');
  t.key('up');
  t.key('up');
  t.key('up');
  check(t.menu!.selected === 0, 'Start Game now selectable');
  t.key('enter');
  t.tick();
  check(t.state === 2 && t.menu === null && log.se.at(-1) === SE_TITLE_OK, 'Start Game: SE 0x420, state 2');
  check(t.press > 0, 'press alpha frozen, not drawn in state 2');
  ticks(t, 30);
  check(log.start.length === 0, 'still fading out');
  ticks(t, 2);
  check(log.start.length === 1 && log.start[0].user === 'alice' && log.start[0].password === 'pw', 'start after 32 frames');
  t.reset();
  check(t.state === 0 && t.menu === null && t.fadeAlpha === 1 && t.creds.user === 'alice', 'new title scene keeps the credentials');
}

// --- Exit Game ------------------------------------------------------------------
{
  const { log, host: h } = host();
  const t = new TitleFlow(h, { user: 'a', password: 'b' });
  ticks(t, 32);
  t.key('enter');
  ticks(t, 10);
  t.key('down');
  const opens = log.se.filter((id) => id === SE_WINDOW_OPEN).length;
  t.key('enter');
  check(t.menu!.exitConfirm?.cursor === 1, 'Really OK? opens on No');
  check(log.se.filter((id) => id === SE_WINDOW_OPEN).length === opens + 2, 'question and Yes/No lists open (SE 0x572 each)');
  t.key('up');
  check(t.menu!.exitConfirm?.cursor === 1 && t.menu!.exitConfirm.list.animating, 'no keys while the Yes/No list opens');
  ticks(t, 4);
  check(!t.menu!.exitConfirm!.list.animating, 'Yes/No list open after 4 frames (counter 8 >= 7.5)');
  t.key('enter');
  check(t.menu!.exitConfirm === null && t.menu!.result === null, 'No goes back to the list');
  t.key('enter');
  ticks(t, 4);
  t.key('up');
  t.key('enter');
  t.tick();
  check(t.state === 3 && t.fadeOut !== null, 'Yes: fade-out, state 3');
  ticks(t, 32);
  check(log.exit === 1, 'exit after the fade-out');
  check(!log.se.includes(SE_TITLE_OK), 'no 0x420 on exit');
  check(log.se.includes(SE_CANCEL) === false, 'no cancel SE');
}

// --- window geometry and text reveal from the exe ------------------------------------
{
  check(listWindowHeight(5, true) === LOGIN_MENU.h && LOGIN_MENU.w === 220, 'Login menu 220 x 120 (0x00974e10) = the list height rule');
  check(EXIT_CONFIRM.h === 34, 'Really OK? list: 1 row, no title, 34 high');
  const yn = yesNoRect();
  check(yn.x === 439 && yn.y === 374 && yn.w === 104 && yn.h === 54, `Yes/No at question right - 111, bottom - 10, 104 x 54 (${yn.x}, ${yn.y}, ${yn.w}, ${yn.h})`);

  // Opening wipe of a list window, window speed 1 (counter += 2 per frame).
  const a = new WindowAnim(true, false);
  a.open(1);
  check(!a.textShown && a.reveal(0, 0, 200) < 0, 'opening: titles hidden, first row not revealed');
  ticks(a, 4);
  check(a.c === 0 && a.textShown, 'title / info-counter text shown from c = 0 (frame 4)');
  // A centred 60 px row in the 200 px Login content: x = 70.
  const row = (i: number) => a.reveal(70, i * 20, 200);
  check(row(0) < 60 && row(4) < 0, 'rows are cut while the wipe runs');
  const frames = (i: number) => {
    const b = new WindowAnim(true, false);
    b.open(1);
    let n = 0;
    while (b.reveal(70, i * 20, 200) < 60 && n < 100) {
      b.tick(1);
      n++;
    }
    return n;
  };
  const f0 = frames(0);
  const f4 = frames(4);
  // Row 4 lags row 0 by (80 / 21) * 7.5 = 28.6 counts, 14.3 frames.
  const lag = f4 - f0;
  check(f0 > 4 && lag >= 14 && lag <= 15, `each row starts (y / 21) * 7.5 counts later (row 0: ${f0} frames, row 4: ${f4})`);
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

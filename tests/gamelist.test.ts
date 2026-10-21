// The lobby counter's party game list and creation window (classic/gamelist.ts),
// the counter's episode menu (classic/counter.ts), the "Connecting.." status
// logic (classic/connectstatus.ts) and the quest loading screen
// (classic/questloading.ts).
//
// Run: node tests/gamelist.test.ts
import { ConnectObject, LOGIN_STATUS, PANELS as CONNECT_PANELS, statusTextIndex, STATUS_POS } from '../client/src/classic/connectstatus.ts';
import { InfoCounter, type CounterChoice, type CounterMenuId, type CounterText } from '../client/src/classic/counter.ts';
import {
  CHOICE_POS,
  CREATE_WINDOW,
  CreatePartyWindow,
  entryMode,
  GAME_INFO_WINDOW,
  GAME_LIST_WINDOW,
  gameRow,
  GameListView,
  ICON_NONE,
  ICON_PASSWORD,
  MODE,
  PartyMenus,
  PasswordPrompt,
  ROW_COLUMNS,
  T11,
  type PartyHost,
} from '../client/src/classic/gamelist.ts';
import {
  BAR,
  BRACKETS,
  decorationVisible,
  DIAGONALS,
  ETA_MAX_FRAMES,
  formatEta,
  FRAME_LINES,
  LETTERBOX,
  PANELS,
  percentText,
  QuestLoadingBar,
  QuestLoadingBars,
} from '../client/src/classic/questloading.ts';
import type { CreateGameOptions, GameListEntry } from '../client/src/net/game.ts';
import { menuTextAligned, withAlignedMenuText } from '../client/src/classic/charcreate_text.ts';

let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${msg}`);
  }
};
const eq = <T>(got: T, want: T, msg: string) => check(JSON.stringify(got) === JSON.stringify(want), `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const k = (key: string) => ({ key });

// Group 11 strings the rows use (English unitxt).
const T11_TEXT: Record<number, string> = {
  [T11.episodeBase + 1]: 'Episode I',
  [T11.episodeBase + 2]: 'Episode II',
  [T11.episodeBase + 3]: 'Episode IV',
  [T11.modeBase]: 'Normal',
  [T11.modeBase + 1]: 'Challenge',
  [T11.modeBase + 2]: 'Battle',
  [T11.modeBase + 3]: 'One Person',
  [T11.difficultyBase]: 'Normal',
  [T11.difficultyBase + 1]: 'Hard',
  [T11.difficultyBase + 2]: 'Very Hard',
  [T11.difficultyBase + 3]: 'Ultimate',
  [T11.partyName]: 'Party Name',
};
const t11 = (i: number) => T11_TEXT[i] ?? `#${i}`;
const t15 = (i: number) => `t15:${i}`;

function entry(over: Partial<GameListEntry> = {}): GameListEntry {
  return {
    menuId: 0x44000044,
    itemId: 5,
    name: 'Room',
    difficulty: 0,
    players: 1,
    maxPlayers: 4,
    episode: 1,
    solo: false,
    passworded: false,
    joinable: true,
    battle: false,
    challenge: false,
    ...over,
  };
}

// --- geometry (position table entries 0xc1, 0xdb, 0xbf; sizes 0x009f3190, 0x009715d8) ---
{
  eq([GAME_LIST_WINDOW.x, GAME_LIST_WINDOW.y, GAME_LIST_WINDOW.w, GAME_LIST_WINDOW.h], [18, 53, 605, 184], 'game list window');
  eq([GAME_INFO_WINDOW.x, GAME_INFO_WINDOW.y, GAME_INFO_WINDOW.h], [18, 265, 188], 'info window');
  eq([CREATE_WINDOW.x, CREATE_WINDOW.y, CREATE_WINDOW.w, CREATE_WINDOW.h], [181, 50, 425, 188], 'create window');
  eq([CHOICE_POS.x, CHOICE_POS.y], [389, 251], 'choice lists');
  // Columns: name +18, then +210, +108, +96, +126.
  eq(Object.values(ROW_COLUMNS), [0, 18, 228, 336, 432, 558], 'row columns');
}

// --- rows (UIElement_RenderTextAndQuad_0072e1c4) --------------------------------
{
  eq(entryMode(entry()), MODE.normal, 'plain game is Normal');
  eq(entryMode(entry({ battle: true })), MODE.battle, 'battle flag is mode 2');
  eq(entryMode(entry({ challenge: true })), MODE.challenge, 'challenge flag is mode 1');
  eq(entryMode(entry({ battle: true, challenge: true })), MODE.challenge, 'challenge wins over battle');

  const r = gameRow(entry({ name: 'Forest', players: 2, maxPlayers: 4, episode: 2, difficulty: 3 }), t11);
  eq(r, { icon: ICON_NONE, name: 'Forest', episode: 'Episode II', mode: 'Normal', difficulty: 'Ultimate', players: '2/4', disabled: false }, 'normal row');
  eq(gameRow(entry({ passworded: true }), t11).icon, ICON_PASSWORD, 'password flag draws icon 0x18');
  eq(ICON_PASSWORD, 0x18, 'icon index');
  const c = gameRow(entry({ challenge: true, difficulty: 2 }), t11);
  eq([c.mode, c.difficulty], ['Challenge', ''], 'challenge rows show no difficulty');
  eq(gameRow(entry({ episode: 3 }), t11).episode, 'Episode IV', 'episode 3 is Episode IV');
  eq(gameRow(entry({ joinable: false }), t11).disabled, true, 'flags & 4 greys the row');
  eq(gameRow(entry({ battle: true }), t11).mode, 'Battle', 'battle text');
  eq(gameRow(entry({ players: 3, maxPlayers: 1, solo: true }), t11).players, '3/1', 'player count');
}

// --- the list window -------------------------------------------------------------
{
  const many = Array.from({ length: 20 }, (_, i) => entry({ itemId: i + 1, name: `G${i}` }));
  const v = new GameListView(many, t11);
  eq([v.cursor, v.top], [0, 0], 'starts at the top');
  v.key(k('ArrowUp'));
  eq([v.cursor, v.top], [19, 12], 'up wraps to the last row and scrolls so it is the 8th visible');
  v.key(k('ArrowDown'));
  eq([v.cursor, v.top], [0, 0], 'down wraps and the view returns');
  for (let i = 0; i < 8; i++) v.key(k('ArrowDown'));
  eq([v.cursor, v.top], [8, 1], 'the view follows the cursor');
  eq(v.key(k('Enter')), { type: 'decide', entry: many[8] }, 'Enter decides the selected game');
  eq(v.key(k('Tab')), { type: 'info', entry: many[8] }, 'Tab asks for the info');
  eq(v.key(k('Backspace')).type, 'cancel', 'Backspace cancels');
  eq(v.key(k('Escape')).type, 'cancel', 'Escape cancels');
  eq(v.key(k('x')).type, 'none', 'other keys do nothing');

  const huge = new GameListView(Array.from({ length: 100 }, (_, i) => entry({ itemId: i + 1 })), t11);
  eq(huge.entries.length, 0x40, 'the window holds 0x40 rows');

  const empty = new GameListView([], t11);
  eq([empty.key(k('Enter')).type, empty.key(k('ArrowDown')).type, empty.key(k('Tab')).type, empty.key(k('Escape')).type], ['none', 'none', 'none', 'cancel'], 'an empty list only cancels');
}

// --- the creation window (ChallengeMenuObject_ProcessState_007340a4) ------------
{
  const w = new CreatePartyWindow(2);
  eq([w.row, w.mode, w.difficulty, w.name, w.password], [0, 0, 0, '', ''], 'initial values');
  eq([w.selectable(0), w.selectable(1), w.selectable(2), w.selectable(3), w.selectable(4)], [true, true, true, true, false], 'Registration needs a name');
  // Down skips the greyed Registration row and wraps.
  for (let i = 0; i < 4; i++) w.key(k('ArrowDown'));
  eq(w.row, 0, 'four downs wrap around the four selectable rows');
  w.key(k('ArrowUp'));
  eq(w.row, 3, 'up from the first row skips Registration');
  w.key(k('Enter')); // Difficulty
  eq(w.step, 'difficulty', 'Difficulty opens its list');
  w.key(k('ArrowDown'));
  w.key(k('ArrowDown'));
  w.key(k('ArrowDown'));
  w.key(k('Enter'));
  eq([w.difficulty, w.step], [3, 'rows'], 'the list sets Ultimate (4 entries)');

  // Name: 14 characters, then Registration is where the cursor goes.
  w.row = 0;
  w.key(k('Enter'));
  eq(w.step, 'name', 'name editor');
  for (const c of 'abcdefghijklmnopqrstuvwxyz') w.key(k(c));
  w.key(k('Backspace'));
  w.key(k('Enter'));
  eq(w.name, 'abcdefghijklm', 'name keeps 14 characters, one erased');
  eq([w.step, w.row, w.selectable(4)], ['rows', 4, true], 'with a name the cursor jumps to Registration');

  // Escape in an editor keeps the old text.
  w.row = 1;
  w.key(k('Enter'));
  for (const c of 'pw') w.key(k(c));
  w.key(k('Escape'));
  eq([w.password, w.step], ['', 'rows'], 'Escape leaves the password as it was');
  w.row = 1;
  w.key(k('Enter'));
  for (const c of 'secret') w.key(k(c));
  w.key(k('Enter'));
  eq(w.password, 'secret', 'Enter takes the password');

  // Play Mode and the greyed Difficulty.
  w.row = 2;
  w.key(k('Enter'));
  eq(w.step, 'mode', 'Play Mode list');
  w.key(k('ArrowDown'));
  w.key(k('Enter'));
  eq([w.mode, w.selectable(3)], [MODE.challenge, false], 'Challenge greys Difficulty');
  eq(w.options(), { name: 'abcdefghijklm', password: 'secret', difficulty: 0, battle: false, challenge: true, solo: false, episode: 2 }, 'Challenge sends difficulty 0');
  w.row = 2;
  w.key(k('Enter'));
  w.key(k('ArrowDown'));
  w.key(k('Enter'));
  eq(w.mode, MODE.battle, 'Battle');
  eq(w.options(), { name: 'abcdefghijklm', password: 'secret', difficulty: 3, battle: true, challenge: false, solo: false, episode: 2 }, 'Battle keeps the difficulty');
  w.row = 2;
  w.key(k('Enter'));
  w.key(k('ArrowDown'));
  w.key(k('Enter'));
  eq([w.mode, w.options().solo], [MODE.solo, true], 'One Person sets solo');
  w.key(k('Enter')); // idle: the cursor is on Registration
  eq(w.result, 'create', 'Registration creates');

  const c = new CreatePartyWindow(1);
  c.key(k('Backspace'));
  eq(c.result, 'cancel', 'Backspace cancels the window');
  const z = new CreatePartyWindow(3);
  z.row = 4;
  z.key(k('Enter'));
  eq([z.result, z.step], [null, 'rows'], 'Registration without a name does nothing');
  eq(z.options().episode, 3, 'Episode 4 is wire episode 3');
}

// --- the password prompt ------------------------------------------------------------
{
  const p = new PasswordPrompt();
  for (const c of 'abcdefghijklmnopqrstuvwxyz') p.key(k(c));
  eq(p.password, 'abcdefghijklmnop', 'password holds 16 characters');
  p.key(k('Backspace'));
  p.key(k('Enter'));
  eq([p.password, p.result], ['abcdefghijklmno', 'ok'], 'Enter confirms');
  const q = new PasswordPrompt();
  q.key(k('Escape'));
  eq(q.result, 'cancel', 'Escape cancels');
}

// --- the menu flow ---------------------------------------------------------------------
{
  const calls: string[] = [];
  const list = [entry({ itemId: 7, name: 'Open' }), entry({ itemId: 8, name: 'Locked', passworded: true })];
  let joinFails: string | null = null;
  const host: PartyHost = {
    listGames: async () => (calls.push('list'), list),
    gameInfo: async (e) => (calls.push(`info ${e.itemId}`), 'Details'),
    join: async (e, pw) => {
      calls.push(`join ${e.itemId} ${pw}`);
      if (joinFails) throw new Error(joinFails);
    },
    create: async (o: CreateGameOptions) => void calls.push(`create ${o.name} ${o.episode}`),
  };
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  const m = new PartyMenus(host, { t11, t15 });
  let entered = 0;
  m.onEntered = () => entered++;
  eq(m.open, false, 'closed at first');
  m.openList();
  eq([m.phase, calls], ['loading', ['list']], '08 is sent and the list loads');
  await flush();
  eq(m.phase, 'list', 'the 08 answer opens the list');
  m.key(k('Tab'));
  await flush();
  eq(calls.at(-1), 'info 7', 'Tab sends 09');
  m.key(k('Enter'));
  eq(m.phase, 'burst', 'a game without a password is joined at once (menus closed, party_burst)');
  await flush();
  eq([calls.at(-1), m.phase, entered], ['join 7 ', 'closed', 1], 'join 10 sent, the menus close once in');

  m.openList();
  await flush();
  m.key(k('ArrowDown'));
  m.key(k('Enter'));
  eq(m.phase, 'password', 'a password flag opens the prompt');
  for (const c of 'pw1') m.key(k(c));
  m.key(k('Enter'));
  await flush();
  eq(calls.at(-1), 'join 8 pw1', 'the password goes with the join');

  joinFails = 'Game is full';
  m.openList();
  await flush();
  m.key(k('Enter'));
  await flush();
  eq([m.phase, m.message], ['message', 'Game is full'], 'a refusal is shown');
  m.key(k('Enter'));
  eq(m.phase, 'closed', 'Enter closes the message');

  m.openList();
  await flush();
  m.key(k('Escape'));
  eq(m.phase, 'closed', 'Cancel in the list closes every menu (close_lobby_menus)');

  m.openCreate(3);
  eq(m.phase, 'create', 'create window');
  m.key(k('Enter'));
  for (const c of 'Mine') m.key(k(c));
  m.key(k('Enter'));
  m.key(k('Enter'));
  await flush();
  eq(calls.at(-1), 'create Mine 3', 'Registration creates the Episode 4 game');
}

// --- the counter ---------------------------------------------------------------------------
{
  const text: CounterText = {
    info: 'info',
    first: ['Organize PARTY', 'Transport', 'Team'],
    transport: ['Change SHIP', 'Change BLOCK'],
    team: ['a', 'b', 'c', 'd'],
    party: ['Join a PARTY', 'Create a PARTY'],
    episodes: ['EPISODE 1', 'EPISODE 2', 'EPISODE 4'],
    episodeInfo: ['one', 'two', 'four'],
  };
  const c = new InfoCounter(text);
  const log: Array<[CounterMenuId, number]> = [];
  const choose: CounterChoice = (m, i) => log.push([m, i]);
  c.onChoose = choose;
  c.begin();
  c.key(k('Enter')); // Organize PARTY
  c.key(k('Enter')); // Join a PARTY
  eq([c.open, log], [false, [['party', 0]]], 'Join a PARTY reports and closes the menus');
  c.begin();
  c.key(k('Enter'));
  c.key(k('ArrowDown'));
  c.key(k('Enter')); // Create a PARTY -> episodes
  eq([c.open, log.length], [true, 1], 'Create a PARTY opens the episode menu');
  c.key(k('ArrowDown'));
  c.key(k('ArrowDown'));
  c.key(k('Enter'));
  eq([c.open, log.at(-1)], [false, ['episode', 2]], 'the third episode is Episode 4');
  c.begin();
  c.key(k('Enter'));
  c.key(k('Backspace'));
  eq(c.open, false, 'Cancel closes every counter menu');
}

// --- the Connecting.. object (GameListMenuObject) ----------------------------------------------
{
  // RenderStatusText_004080ac, JP FUN_004081ff / 0040816f / 00408152 / 00408135 /
  // 00408118 / 004080fb / 004080de / 004080c1.
  const table: Array<[number, number | null]> = [
    [0, null],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 6],
    [7, 9],
    [8, 0xc],
    [9, 0xe],
    [10, 0xc],
    [0xb, 3],
    [0xc, 0x14],
    [0xd, 0xd],
    [99, 0xd],
  ];
  for (const [sub, idx] of table) eq(statusTextIndex(sub), idx, `status text of state ${sub}`);
  eq([STATUS_POS.x, STATUS_POS.y], [23, 331], 'status text position');
  eq(CONNECT_PANELS.map((p) => [p.x, p.y, p.w, p.h]), [[0, 28, 640, 84], [0, 310, 640, 136]], 'panels of GameListMenuDrawPanel');

  const run = (sub: number, confirm: boolean, cancel: boolean) => {
    const o = new ConnectObject();
    o.setSub(sub);
    for (let i = 0; i < 0x98 && o.state !== 3; i++) o.tick(false, false);
    const waited = o.state === 3;
    o.tick(confirm, cancel);
    return [waited, o.state, o.status, o.properties] as const;
  };
  eq(run(1, true, false), [true, 4, LOGIN_STATUS.connected, 6], 'default arm: confirm connects');
  eq(run(2, false, true), [true, 4, LOGIN_STATUS.cancel, null], 'default arm: cancel');
  eq(run(0, false, false)[1], 4, 'sub state 0 ends at once');
  eq(run(4, true, false), [true, 4, LOGIN_STATUS.cancel, null], 'state 4: confirm gives status 2');
  eq(run(4, false, true)[1], 3, 'state 4 ignores cancel');
  eq(run(5, true, false)[2], LOGIN_STATUS.retry, 'state 5: confirm retries (1)');
  eq(run(7, false, true)[2], LOGIN_STATUS.ok, 'state 7: cancel is status 0');
  eq(run(8, true, false), [true, 4, LOGIN_STATUS.connected, 8], 'state 8: confirm, property 8');
  eq(run(0xc, true, false)[2], LOGIN_STATUS.cancel, 'state 0xc: confirm gives 2');
  const o = new ConnectObject();
  o.setSub(1);
  o.tick(false, false);
  eq(o.state, 2, 'the result state waits 0x96 frames');
  let frames = 0;
  while (o.state === 2) (o.tick(false, false), frames++);
  eq([o.state, frames > 0x96], [3, true], 'then state 3');
}

// --- the quest loading screen -----------------------------------------------------------------------
{
  eq(LETTERBOX.map((r) => [r.x, r.y, r.w, r.h]), [[0, 0, 640, 64], [0, 416, 640, 64]], 'letterbox');
  eq(PANELS.map((r) => [r.x, r.y, r.w, r.h]), [[31, 73, 455, 332], [543, 75, 72, 332]], 'panels');
  eq([BRACKETS.length, FRAME_LINES.length, DIAGONALS.length], [16, 4, 2], 'grey primitives');
  eq([BAR.x, BAR.y, BAR.w, BAR.h], [473, 440, 142, 8], 'bar');
  eq([decorationVisible(0), decorationVisible(1), decorationVisible(2)], [false, false, true], 'drawn from the second call');

  eq(formatEta(95), '3.1 ', 'below a minute: seconds.tenths');
  eq(formatEta(30), '1.0 ', 'one second');
  eq(formatEta(1800), '1"00.0 ', 'a minute');
  eq(formatEta(1800 * 2 + 30 * 5 + 7), '2"05.2 ', 'minutes, padded seconds, tenths');
  eq([percentText(0), percentText(0.5), percentText(0.999), percentText(1), percentText(7)], ['  0', ' 50', ' 99', '100', '100'], 'percentage truncated and clamped');

  const bars = new QuestLoadingBars();
  bars.update(5, 10);
  eq(bars.bar, null, 'no bar before the 0 call');
  bars.update(-1, 10);
  bars.update(0, 0);
  eq(bars.bar, null, 'invalid calls are ignored');
  bars.update(0, 100);
  const b = bars.bar!;
  check(b !== null && b.ratio === 0 && b.etaState === -1 && b.eta === -1, 'a new bar waits for an estimate');
  eq(b.fill, 'rgb(64,64,255)', 'initial pulse (phase 0 -> 64)');
  // 0x0f..: steady 1% per 15 frames -> 1500 frames for the whole file.
  let done = 0;
  for (let i = 0; i < 30; i++) {
    done = Math.min(100, done + 1);
    for (let f = 0; f < 15; f++) bars.step();
    bars.update(done, 100);
  }
  check(bars.bar !== null && bars.bar.etaState === 1, 'an estimate of 300 frames or more appears after 9 samples');
  const eta = bars.bar!.eta;
  check(eta > 300 && eta <= ETA_MAX_FRAMES, `estimate in range (${eta})`);
  const before = bars.bar!.eta;
  bars.step();
  eq(bars.bar!.eta, before - 1, 'the estimate counts down one frame at a time');
  bars.update(100, 100);
  eq(bars.bar!.dead, true, 'a full bar is destroyed');
  bars.step();
  eq(bars.bar, null, 'and gone the next frame');
  bars.update(0, 100);
  bars.update(0, 100);
  check(bars.bar?.dead === true, 'a 0 call while a bar exists destroys it');

  // A short transfer never shows an estimate (under 300 frames, 10 s).
  const fast = new QuestLoadingBars();
  fast.update(0, 100);
  for (let i = 1; i <= 30; i++) {
    fast.bar!.step();
    fast.update(i * 3, 100);
  }
  eq(fast.bar!.etaState, -1, 'an estimate below 300 frames is not shown');
  eq(fast.bar!.etaText(), null, 'so there is no text');
  eq(fast.bar!.percent(), ' 90', 'but the percentage is');

  const standalone = new QuestLoadingBar();
  standalone.progress(2, 1);
  eq(standalone.ratio, 1, 'the ratio is capped at 1');
  for (let i = 0; i < 20; i++) standalone.step();
  check(/^rgb\(\d+,\d+,255\)$/.test(standalone.fill), 'filled part stays blue');
}

// --- group 11 alignment (charcreate_text.ts) ---------------------------------
{
  // A group 11 laid out as the exe reads it, and the data.gsl unitxt_e.prs
  // one: entry 0xed ("Send to GM") missing, everything after one lower.
  const aligned = Array.from({ length: 0x142 }, (_, i) => `t${i}`);
  aligned[0xed] = 'Send to GM';
  aligned[0x139] = 'Normal'; // Play Mode
  aligned[0x13d] = 'Normal'; // Difficulty
  aligned[0x140] = 'Ultimate';
  const shifted = aligned.filter((_, i) => i !== 0xed);
  const items = ['item names'];
  const gsl = [items, ...Array.from({ length: 10 }, () => []), shifted];
  const loose = [['other items'], ...Array.from({ length: 10 }, () => []), aligned];
  check(menuTextAligned(loose) && !menuTextAligned(gsl), 'the 0x139 / 0x13d check tells the two layouts apart');
  const fixed = withAlignedMenuText(gsl, [loose]);
  eq([fixed[11][0x13d], fixed[11][0x140]], ['Normal', 'Ultimate'], 'group 11 comes from the aligned file');
  check(fixed[0] === items, 'the other groups are kept');
  check(withAlignedMenuText(loose, [gsl]) === loose, 'an aligned table is left alone');
  check(withAlignedMenuText(gsl, []) === gsl, 'no aligned alternative: unchanged');
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

// The classic chat line (classic/chat.ts ChatLine), shared by the lobby and the
// field: Enter sends the trimmed line and closes it, Escape and an empty line
// send nothing, a line from the server goes to the log and, for a known
// player, to a balloon (the nearer balloons stay when the list is full).
// Run: node tests/chatline.test.ts
// The input line measures its text (gametext.ts) on an OffscreenCanvas; a
// fixed width is enough here.
const measure = { measureText: () => ({ width: 7 }), getImageData: () => ({ data: new Uint8ClampedArray(64) }) };
(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = class {
  getContext() {
    return measure;
  }
};
const { ChatLine, ChatLog, logWindowRows, LOG_FIT } = await import('../client/src/classic/chat.ts');

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// Only the fields ChatInput.key reads.
const press = (key: string) => ({ key, preventDefault() {} }) as unknown as KeyboardEvent;

// Space opens the line, typed characters fill it, Enter sends what it holds.
const sent: string[] = [];
const line = new ChatLine((t) => sent.push(t));
eq(line.open, false, 'closed at start');
line.begin();
eq(line.open, true, 'begin opens the line');
for (const k of ['h', 'i']) line.key(press(k));
line.key(press('Enter'));
eq(sent, ['hi'], 'Enter sends the typed text');
eq(line.open, false, 'Enter closes the line');

// Blank lines are not sent (ChatInput trims them), and the line closes.
line.begin();
line.key(press(' '));
line.key(press('Enter'));
eq(sent, ['hi'], 'a blank line is not sent');
eq(line.open, false, 'a blank Enter closes the line');

// Escape cancels: nothing goes out.
line.begin();
line.key(press('o'));
line.key(press('Escape'));
eq(sent, ['hi'], 'Escape sends nothing');
eq(line.open, false, 'Escape closes the line');

// A line from a known player: a log entry and a balloon over the speaker.
const near = new ChatLine(() => {});
near.receive({ clientId: 3, name: 'Ann' }, 3, 'hello', () => 5);
eq(near.log.lines, ['Ann > hello'], 'log: name and text');
eq(near.bubbles.list.map((b) => b.clientId), [3], 'balloon over the speaker');

// No known player: the log names it by its client number, and no balloon.
near.receive(null, 7, 'who', () => 0);
eq(near.log.lines, ['Ann > hello', '#7 > who'], 'unknown speaker: #gc in the log');
eq(near.bubbles.list.map((b) => b.clientId), [3], 'unknown speaker: no balloon');

// Balloons: one per speaker; the far one goes when the list is full.
const crowd = new ChatLine(() => {});
for (let id = 1; id <= 8; id++) crowd.receive({ clientId: id, name: `P${id}` }, id, 'x', (c) => c);
eq(crowd.bubbles.list.length <= 8, true, 'balloons are capped');
crowd.receive({ clientId: 1, name: 'P1' }, 1, 'again', () => 0);
eq(crowd.bubbles.list.filter((b) => b.clientId === 1).length, 1, 'a speaker keeps one balloon');

// Overlap and docking (chat.ts ChatBubbles: FUN_0071f0c0 retries,
// UIElementMover_UpdatePosition's docked branch). The frame is 640 x 480.
const { ChatBubbles, ChatBubble } = await import('../client/src/classic/chat.ts');
const DOCK = [
  [320, 140],
  [140, 300],
  [500, 300],
  [320, 240],
];
const head = (x: number, y: number, front = true, dist = 50) => ({ x, y, dist, visible: true, front });
// Two balloons over one head: the second is moved off the first (the rand()
// of the retries is fixed, so the retry C angle is opposite the head's).
const pair = new ChatBubbles();
pair.rand = () => 16000;
pair.say(1, 'A', 'hello there friend', () => 0);
pair.say(2, 'B', 'hi', () => 0);
for (let i = 0; i < 12; i++) pair.tick(() => head(320, 240));
const [pa, pb] = pair.list;
const apart =
  pa.pos.x + pa.target.w <= pb.pos.x || pb.pos.x + pb.target.w <= pa.pos.x || pa.pos.y + pa.target.h <= pb.pos.y || pb.pos.y + pb.target.h <= pa.pos.y;
eq(apart, true, 'two balloons over one head do not overlap');

// A head off the frame docks the balloon on a slot: its centre is the slot's
// dock point (the GUI point 0x45 + slot).
const dockSet = new ChatBubbles();
dockSet.say(3, 'C', 'over here', () => 0);
for (let i = 0; i < 6; i++) dockSet.tick(() => head(-200, 100));
const d = dockSet.list[0];
eq(d.docked, true, 'off the frame: docked');
eq(d.slot >= 0 && d.slot <= 3, true, 'docked: a slot');
const pt = DOCK[d.slot];
eq([Math.round(d.pos.x + d.target.w / 2), Math.round(d.pos.y + d.target.h / 2)], pt, 'docked: centred on the slot point');
eq(dockSet.dock.taken !== 0, true, 'docked: slot bit taken');

// Behind the camera also docks; back in view (inside the 50 px margin) it
// undocks and frees the slot.
dockSet.tick(() => head(300, 200, false));
eq(d.docked, true, 'behind the camera: still docked');
for (let i = 0; i < 3; i++) dockSet.tick(() => head(300, 200));
eq(d.docked, false, 'back in view: undocked');
eq(dockSet.dock.taken, 0, 'undocked: slot freed');
eq(d.tailOn, true, 'in view: the tail is on');

// A far speaker (more than 120 units) docks too.
const far = new ChatBubbles();
far.say(4, 'D', 'far', () => 0);
for (let i = 0; i < 4; i++) far.tick(() => head(320, 240, true, 150));
eq(far.list[0].docked, true, 'beyond 120 units: docked');

// The chat send cooldown (is_chat_message_cooldown_over, dump 679808; 0x2d frames): a
// typed line sent sets it, and a line that comes while it runs is held until it ends.
const cool = [];
const cl = new ChatLine((t) => cool.push(t));
cl.begin();
for (const k of ['o', 'k']) cl.key(press(k));
cl.key(press('Enter'));
eq(cool, ['ok'], 'cooldown: the first line goes');
eq(cl.cooldownOver(), false, 'cooldown: a send starts it');
cl.begin();
for (const k of ['n', 'o']) cl.key(press(k));
cl.key(press('Enter'));
eq(cool, ['ok'], 'cooldown: a line during it is held');
eq(cl.open, true, 'cooldown: the held line keeps the input open');
cl.begin();
cl.key(press('x'));
eq(cl.input.text, 'no', 'cooldown: Space does not clear a held line');
for (let i = 0; i < 0x2c; i++) cl.tickCooldown();
eq(cool, ['ok'], 'cooldown: 44 frames, still held');
cl.tickCooldown();
eq(cool, ['ok', 'no'], 'cooldown: the held line goes at 45 frames');
eq(cl.open, false, 'cooldown: the line closes when it goes');
cl.begin();
cl.key(press('z'));
cl.key(press('Escape'));
cl.begin();
cl.key(press('a'));
cl.key(press('Enter'));
for (let i = 0; i < 0x2d; i++) cl.tickCooldown();
cl.begin();
cl.key(press('q'));
cl.key(press('Enter'));
cl.begin();
cl.key(press('w'));
cl.key(press('Enter'));
eq(cool.length, 3, 'cooldown: sends after the ticks only');
cl.tickCooldown();
eq(cl.cooldownOver(), false, 'cooldown: starts again after a send');

// Escape drops a held line: it never goes.
const esc = [];
const el = new ChatLine((t) => esc.push(t));
el.begin();
el.key(press('a'));
el.key(press('Enter'));
el.begin();
el.key(press('b'));
el.key(press('Enter'));
el.key(press('Escape'));
eq(el.open, false, 'held: Escape closes the held line');
for (let i = 0; i < 0x2d; i++) el.tickCooldown();
eq(esc, ['a'], 'held: a dropped line is not sent');

// A blank Enter during the cooldown closes the line and sends nothing (no hold).
const blank = [];
const bl = new ChatLine((t) => blank.push(t));
bl.begin();
bl.key(press('y'));
bl.key(press('Enter'));
bl.begin();
bl.key(press(' '));
bl.key(press('Enter'));
eq(blank, ['y'], 'blank during cooldown: nothing held');
eq(bl.open, false, 'blank during cooldown: the line closes');

// Chat shortcuts (use_chat_shortcut, dump 754183): a text record goes, and the cooldown
// starts; a record during the cooldown is dropped; an empty record starts it too.
const sc = [];
const sl = new ChatLine((t) => sc.push(t));
const symbolSent = [];
sl.sendSymbol = (chat) => symbolSent.push(chat);
eq(sl.useShortcut({ type: 1, text: 'hello', symbol: null }), true, 'shortcut: used when free');
eq(sc, ['hello'], 'shortcut: the text goes');
eq(sl.useShortcut({ type: 1, text: 'again', symbol: null }), false, 'shortcut: refused during the cooldown');
eq(sc, ['hello'], 'shortcut: a refused record is dropped (not held)');
for (let i = 0; i < 0x2d; i++) sl.tickCooldown();
eq(sl.useShortcut(null), true, 'shortcut: an empty slot is used');
eq(sl.cooldownOver(), false, 'shortcut: an empty slot still starts the cooldown');
eq(sc, ['hello'], 'shortcut: an empty slot sends nothing');
for (let i = 0; i < 0x2d; i++) sl.tickCooldown();
sl.useShortcut({ type: 3, text: '', symbol: { spec: 0, cornerObjects: [], faceParts: [] } });
eq(symbolSent.length, 1, 'shortcut: a symbol record goes to the symbol sender');
for (let i = 0; i < 0x2d; i++) sl.tickCooldown();
// A word-select record goes to the word sender (6x74, send_chat_message_word_select, dump 664328),
// not to the text path; with no sender it is dropped without a text line.
const wordSent = [];
sl.sendWord = (m) => wordSent.push(m);
const wordMsg = { numTokens: 1, targetType: 0, tokens: [7, 0, 0, 0, 0, 0, 0, 0], numericParameter: 0, unknownA4: 0 };
sl.useShortcut({ type: 2, text: '', symbol: null, word: wordMsg });
eq(wordSent, [wordMsg], 'shortcut: a word-select record goes to the word sender');
eq(sc, ['hello'], 'shortcut: a word-select record sends no text line');
for (let i = 0; i < 0x2d; i++) sl.tickCooldown();
sl.sendWord = null;
eq(sl.useShortcut({ type: 2, text: '', symbol: null, word: wordMsg }), true, 'shortcut: a word-select record with no sender still uses the slot');
eq(wordSent.length, 1, 'shortcut: no sender, nothing sent');

// Log Window paging (ChatLog.page; PageUp = older lines, PageDown = newer). A new line
// returns the view to the bottom.
const lg = new ChatLog();
for (let i = 0; i < 0x1e; i++) lg.add('P', `line ${i}`);
const rowsNow = () => logWindowRows(lg.wrapped(), LOG_FIT, lg.back);
eq(rowsNow().at(-1), lg.wrapped().at(-1), 'log: the newest line is at the bottom');
lg.page(true);
eq(lg.back > 0, true, 'log: PageUp moves the view back');
const older = rowsNow();
eq(older.at(-1) !== lg.wrapped().at(-1), true, 'log: PageUp shows older lines');
for (let i = 0; i < 20; i++) lg.page(true);
eq(lg.back, Math.max(0, lg.wrapped().length - LOG_FIT), 'log: PageUp stops at the first line');
eq(rowsNow()[0], lg.wrapped()[0], 'log: the first line is the top of the window');
for (let i = 0; i < 40; i++) lg.page(false);
eq(lg.back, 0, 'log: PageDown stops at the newest line');
lg.page(true);
lg.add('P', 'new');
eq(lg.back, 0, 'log: a new line returns the view to the bottom');
eq(logWindowRows(lg.wrapped(), LOG_FIT, 0).at(-1), 'P > new', 'log: the new line is shown');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('chatline: all checks passed');

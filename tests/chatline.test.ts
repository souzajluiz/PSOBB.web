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
const { ChatLine } = await import('../client/src/classic/chat.ts');

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

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('chatline: all checks passed');

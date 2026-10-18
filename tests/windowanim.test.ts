// The list windows' open / close animation and opening wipe
// (classic/windowanim.ts), and their use by the HUD windows and the field
// menu leaves.
//
// Run: node tests/windowanim.test.ts
import { CLOSE_FRAMES, OPENED, SE_WINDOW_CLOSE, SE_WINDOW_OPEN, WindowAnim } from '../client/src/classic/windowanim.ts';
import { PartyWindows } from '../client/src/classic/hud.ts';

let failures = 0;
let checks = 0;
const check = (ok: boolean, msg: string) => {
  checks++;
  if (!ok) {
    failures++;
    console.error(`FAIL ${msg}`);
  }
};

// --- opening ------------------------------------------------------------------
{
  const a = new WindowAnim(false, false);
  const se: number[] = [];
  a.se = (id) => se.push(id);
  check(!a.visible, 'closed until opened');
  a.open(0);
  check(a.visible && a.animating && a.counter === 0 && se[0] === SE_WINDOW_OPEN, 'open: counter 0, SE 0x572');
  check(a.c === -8 && a.alpha === 0, `c = round(0 - 7.5) = -8 (alpha ${a.alpha})`);
  let frames = 0;
  while (a.animating) {
    a.tick(0);
    frames++;
  }
  check(frames === 8, `speed 0: open after 8 frames (counter >= 7.5) (${frames})`);
  check(a.alpha === 1, 'opaque once c >= 0');
  // The wipe: (c - (x / W + y / 21) * 7.5) * 17.
  check(Math.abs(a.reveal(90, 24, 228) - (a.c - (90 / 228 + 24 / 21) * 7.5) * 17) < 1e-9, 'reveal formula');
  const before = a.reveal(0, 0, 100);
  a.tick(0);
  a.tick(0);
  // counter - 7.5 always ends in .5 and x87 rounds halves to even: c moves
  // 2 every other frame, 17 px per frame on average.
  check(Math.abs(a.reveal(0, 0, 100) - before - 34) < 1e-9, '34 px more per two frames at speed 0');
  const b = new WindowAnim(true, false);
  b.open(1);
  b.tick(1);
  check(b.counter === 2, 'speed 1 counts 2 per frame');
  const c = new WindowAnim(true, false);
  c.open(3);
  check(c.counter === OPENED && c.alpha === 1, 'speed 3 (table 0): opens at once');
  check(WindowAnim.speedOf(0x00040058) === 0 && WindowAnim.speedOf(0x100) === 1 && WindowAnim.speedOf(undefined) === 1, 'option bits 0x300');
}

// --- closing ------------------------------------------------------------------
{
  const a = new WindowAnim(false, true);
  const se: number[] = [];
  a.se = (id) => se.push(id);
  a.close();
  check(!a.isOpen && a.visible && se[0] === SE_WINDOW_CLOSE, 'close: SE 0x573, still drawn');
  const scales: { x: number; y: number }[] = [];
  while (a.visible) {
    a.tick(1);
    scales.push(a.scale);
  }
  check(scales.length === Math.ceil(CLOSE_FRAMES), `gone after 5 frames (${scales.length})`);
  check(Math.abs(scales[0].x - (1 + 0.2222222 * 2.3)) < 1e-6 && Math.abs(scales[0].y - (1 - 0.2222222)) < 1e-6, 'k = 1: x 1.51, y 0.78');
  check(Math.abs(scales[3].y - (1 - 4 * 0.2222222)) < 1e-6, 'k = 4: y 0.11');
  // Closing while opening waits for the open to finish.
  const b = new WindowAnim(true, false);
  b.open(0);
  b.tick(0);
  b.close();
  check(b.isOpen, 'a close during the opening is held');
  for (let i = 0; i < 8; i++) b.tick(0);
  check(!b.isOpen && b.visible, 'then it closes');
}

// --- party windows open and close -------------------------------------------------
{
  const p = new PartyWindows();
  p.setSelf(0);
  p.speed = 0;
  const v = { name: 'A', level: 1, hp: 1, maxHp: 1, dead: false };
  let present = true;
  p.tick((s) => (s === 1 && present ? v : null), () => 0);
  check(p.windows[0].anim.animating && p.windows[0].anim.alpha < 1, 'a party member appearing fades in');
  present = false;
  for (let i = 0; i < 20; i++) p.tick(() => null, () => 0);
  check(!p.windows[0].anim.visible, 'and its window closes when it leaves');
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

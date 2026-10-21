// The list windows' open / close animation and opening wipe
// (classic/windowanim.ts), and their use by the HUD windows and the field
// menu leaves.
//
// Run: node tests/windowanim.test.ts
import { CLOSE_FRAMES, OPENED, SE_WINDOW_CLOSE, SE_WINDOW_OPEN, SHINE_END, WindowAnim, WindowShine } from '../client/src/classic/windowanim.ts';
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


// --- the window shine (UpdateAnimationStateMachine_00712834) -------------------
{
  // rng 0 -> wait 60 frames; rng just under 1 -> 119.
  const s = new WindowShine(() => 0);
  s.tick();
  check(s.state === 1 && s.counter === 59, 'state 0: wait 60, counter 59 after the first call');
  let frames = 1;
  while (s.state === 1) {
    s.tick();
    frames++;
  }
  check(s.state === 2 && s.counter === 0 && frames === 62, `wait of 60 counts to -1, then state 2 (${frames} frames)`);
  const hi = new WindowShine(() => 0.99999);
  hi.tick();
  check(hi.counter === 118, `longest wait 119 (${hi.counter})`);
  let run = 0;
  while (s.state === 2) {
    s.tick();
    run++;
  }
  check(s.state === 0 && run === SHINE_END && s.counter === SHINE_END, `the shine runs ${SHINE_END} frames (${run})`);

  // Geometry: window y 256 -> A = round(268 / 4) = 67; x 13, w 308, h 184.
  const g = new WindowShine(() => 0);
  g.state = 2;
  g.counter = 100;
  check(g.lines(13, 256, 308, 184).length === 0, 'the band has not reached a low window yet');
  g.counter = 140;
  const lines = g.lines(13, 256, 308, 184);
  // start = (140 - 134) * 5 - 1 - 13 = 16; rows = round(160 / 4) = 40
  check(lines.length === 16 && lines[0].y === 268 && lines[0].x0 === 25 && lines[0].x2 === 309, `rows (${lines.length})`);
  check(lines[0].x1 === 25 + 16, 'the peak is at x0 + len');
  const f = 16 / 284;
  check(lines[0].alpha === Math.trunc(f * 2 * 255), `alpha 2 f * 255 (${lines[0].alpha})`);
  check(lines[1].x1 === 25 + 15 && lines[1].y === 272, 'next row: len - 1, 4 px lower');
  g.state = 0;
  check(g.lines(13, 256, 308, 184).length === 0, 'nothing outside state 2');
  const low = new WindowShine(() => 0);
  low.state = 2;
  low.counter = SHINE_END - 1;
  check(low.lines(13, 400, 200, 60).length === 0, 'a window below y ~372 never gets the band');
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

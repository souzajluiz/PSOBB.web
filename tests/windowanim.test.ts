// The list windows' open / close animation and opening wipe
// (classic/windowanim.ts), and their use by the HUD windows and the field
// menu leaves.
//
// Run: node tests/windowanim.test.ts
import {
  CLOSE_FRAMES,
  drawElementShine,
  elementShine,
  elementShineAlpha,
  OPENED,
  SE_WINDOW_CLOSE,
  SE_WINDOW_OPEN,
  SHINE_END,
  titleTextShown,
  wipeElement,
  WindowAnim,
  WindowShine,
  windowShine,
  withElementWipe,
} from '../client/src/classic/windowanim.ts';
import { BAR_COLORS, BAR_HOLD_FRAMES, PartyWindows, StatusWindow } from '../client/src/classic/hud.ts';

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

// --- the element shine (RenderAnimationFrame_007129a8) ------------------------
{
  // alpha: 160 * 2 t up to the middle, then down; trunc, one byte.
  check(elementShineAlpha(0.25) === 80 && elementShineAlpha(0.5) === 160, 'alpha ramps up to 160 at t = 0.5');
  check(elementShineAlpha(0.75) === 80, 'alpha ramps down after 0.5');
  // Band b = counter * 5 - 100 over an element at x 28, w 228.
  const saved = windowShine.state;
  const savedCounter = windowShine.counter;
  windowShine.state = 2;
  windowShine.counter = 40; // b = 100, t = 72 / 228
  const s = elementShine(28, 228);
  check(!!s && Math.abs(s.t - 72 / 228) < 1e-9 && s.alpha === elementShineAlpha(72 / 228), `band at 100 over x 28..256 (${s?.t})`);
  windowShine.counter = 10; // b = -50: before the element
  check(elementShine(28, 228) === null, 'no band before the element');
  windowShine.counter = 30; // b = 50
  check(elementShine(28, 228) !== null, 'band inside from b > x');
  windowShine.counter = 70; // b = 250 < 256
  check(elementShine(28, 228) !== null, 'band still inside near the right edge');
  windowShine.counter = 72; // b = 260 > 256
  check(elementShine(28, 228) === null, 'no band past the right edge');
  windowShine.state = 1;
  windowShine.counter = 40;
  check(elementShine(28, 228) === null, 'nothing unless the shine runs (state 2)');
  windowShine.state = saved;
  windowShine.counter = savedCounter;

  // Drawing: one 1-px column per texel with a ramped alpha; the band's column
  // at the peak.
  const calls: Array<{ a: number; sx: number; dx: number; sy: number; sh: number }> = [];
  let alpha = 1;
  const ctx = {
    save() {},
    restore() {},
    globalCompositeOperation: 'source-over',
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(v: number) {
      alpha = v;
    },
    drawImage(_src: unknown, sx: number, sy: number, _sw: number, sh: number, dx: number) {
      calls.push({ a: alpha, sx, dx, sy, sh });
    },
  } as unknown as CanvasRenderingContext2D;
  windowShine.state = 2;
  windowShine.counter = 40; // b = 100: the band at column 72 of x 28, w 228
  windowShine.last = performance.now();
  drawElementShine(ctx, {} as CanvasImageSource, 28, 37, 228, 76, [0, 0, 228, 76]);
  windowShine.state = saved;
  windowShine.counter = savedCounter;
  check(calls.length === 228, `one column per texel (${calls.length})`);
  check(calls[0].a < 0.01, 'left edge is clear');
  const peak = calls.reduce((m, c) => Math.max(m, c.a), 0);
  check(Math.abs(peak - elementShineAlpha(72 / 228) / 255) < 0.01, `peak alpha at the band (${peak})`);
  check(calls.every((c) => c.sy === 0 && c.sh === 76), 'texel rows 0..76');
  check(calls[227].dx === 28 + 227 && calls[227].sx === 227, 'columns map 1:1');
}

// --- TP use: the status window's TP bar drains like the exe's bar ---------------
{
  // QuickMenuTPBarUpdate_00742378 reads tp2 each frame; a technique's cost is
  // taken from tp2 at its release (HandleHeavySpecialAttackUnsafeMap), and
  // nothing else touches the bar: the drain is the bar's own hold and slide.
  const w = new StatusWindow();
  const v = { name: 'A', slot: 0, level: 1, hp: 40, maxHp: 40, tp: 29, maxTp: 29, pb: 0, dead: false };
  const rng = () => 0.5;
  w.tick(v, rng);
  for (let i = 0; i < 200; i++) w.tick(v, rng);
  check(w.tp.shown === 120 && w.shake.frames === 0, 'full TP bar, no shake');
  // Spend 19 TP (29 -> 10): the bar keeps its width for 0x24 frames.
  const spent = { ...v, tp: 10 };
  w.tick(spent, rng);
  check(w.tp.shown === 120, 'TP drop: the drawn width is held');
  for (let i = 0; i < BAR_HOLD_FRAMES - 1; i++) w.tick(spent, rng);
  check(w.tp.shown === 120, 'still held after 0x24 frames');
  w.tick(spent, rng);
  check(w.tp.shown === 118, 'then the bar slides 2 a frame');
  for (let i = 0; i < 100; i++) w.tick(spent, rng);
  check(Math.abs(w.tp.shown - (120 * 10) / 29) < 1e-9, `settles at 10 / 29 (${w.tp.shown})`);
  check(w.shake.frames === 0, 'a TP drop does not shake the window (only HP does)');
  check(w.tp.color === BAR_COLORS.tp.normal && w.tpText === BAR_COLORS.tp.text, 'TP 10 of 29 is not low');
  const low = { ...v, tp: 5 };
  for (let i = 0; i < 20; i++) w.tick(low, rng);
  check(w.tp.color === BAR_COLORS.tp.low && w.tpText === BAR_COLORS.tp.lowText, 'TP 5 of 29 fades to the low colour');
}

// --- the field palette's element shine (render_main_palette_bg) -----------------
// Its element: x 484, 150 wide, flags 0xB20 (bit 0x800: no inset), so the gate
// and the band use the window's own x and width; texture 2, texels (0,0)-(150,107).
{
  const saved = windowShine.state;
  const savedCounter = windowShine.counter;
  const calls: Array<{ a: number; dx: number; sh: number }> = [];
  let alpha = 1;
  const ctx = {
    save() {},
    restore() {},
    globalCompositeOperation: 'source-over',
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(v: number) {
      alpha = v;
    },
    drawImage(_src: unknown, _sx: number, _sy: number, _sw: number, sh: number, dx: number) {
      calls.push({ a: alpha, dx, sh });
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    fillRect() {},
  } as unknown as CanvasRenderingContext2D;
  // b = counter * 5 - 100 = 500 at counter 120: inside 484..634 at t = 16 / 150.
  windowShine.state = 2;
  windowShine.counter = 120;
  windowShine.last = performance.now();
  drawElementShine(ctx, {} as CanvasImageSource, 484, 368, 150, 107, [0, 0, 150, 107]);
  check(calls.length === 150 && calls.every((c) => c.sh === 107), `palette band: one column per texel, 107 high (${calls.length})`);
  check(calls[0].a === 0 || calls[0].a < 0.01, 'palette: left edge clear');
  // The band sits at column 16: alpha rises to the peak there, then falls.
  const peak = calls.reduce((m, c) => (c.a > m.a ? c : m), calls[0]);
  check(Math.abs(peak.dx - (484 + 16)) <= 1, `palette: peak near the band (${peak.dx})`);
  // Outside the window's span there is no band (the palette only shows while in state 2).
  calls.length = 0;
  windowShine.counter = 60; // b = 200 < 484
  drawElementShine(ctx, {} as CanvasImageSource, 484, 368, 150, 107, [0, 0, 150, 107]);
  check(calls.length === 0, 'palette: no band before the element');
  windowShine.state = saved;
  windowShine.counter = savedCounter;
}

// --- the element wipe of a leaf window (withElementWipe / wipeElement) ----------
// The leaves' rows, bars and texts are revealed per element: an element at
// (x, y) of a content at (cx, cy) of width cw shows reveal(x - cx, y - cy, cw)
// px from its left edge, drawn whole with no scope at all.
{
  const log: string[] = [];
  const ctx = {
    save() {
      log.push('save');
    },
    restore() {
      log.push('restore');
    },
    beginPath() {
      log.push('begin');
    },
    rect(x: number, y: number, w: number, h: number) {
      log.push(`rect ${x} ${y} ${w} ${h}`);
    },
    clip() {
      log.push('clip');
    },
  } as unknown as CanvasRenderingContext2D;
  const drawn = () => log.filter((l) => l === 'drawn').length;
  const draw = () => log.push('drawn');

  // No scope: the element is drawn whole, nothing clipped.
  log.length = 0;
  wipeElement(ctx, 40, 40, 20, draw);
  check(drawn() === 1 && !log.includes('clip'), 'wipe: no scope draws whole');
  check(titleTextShown(), 'wipe: no scope shows the title');

  // A window still at counter 0 (just opened, c = -8): no element shows.
  const shut = new WindowAnim(true, true);
  shut.counter = 0;
  log.length = 0;
  withElementWipe(shut, 0, 0, 150, () => {
    wipeElement(ctx, 10, 10, 20, draw);
    check(!titleTextShown(), 'wipe: the title waits for c >= 0');
  });
  check(drawn() === 0, 'wipe: a window not yet opened draws no element');

  // An open window (counter well past the wipe): the element is drawn whole.
  const open = new WindowAnim(true, true);
  open.counter = OPENED;
  log.length = 0;
  withElementWipe(open, 0, 0, 150, () => wipeElement(ctx, 10, 10, 20, draw));
  check(drawn() === 1 && titleTextShown(), 'wipe: opened window draws the element and its title');
  check(!log.includes('clip'), 'wipe: a fully revealed element is not clipped');

  // Mid-wipe: the element at the content's start shows reveal px from its left
  // edge (x = 0, y = 0: reveal = (c - 0) * 17 with c = 3 gives 51 px).
  const mid = new WindowAnim(true, true);
  mid.counter = 10.5; // c = round(10.5 - 7.5) = 3
  log.length = 0;
  withElementWipe(mid, 100, 50, 150, () => wipeElement(ctx, 100, 50, 20, draw));
  check(log.includes('rect 100 46 51 28') && drawn() === 1, `wipe: element at the content origin shows 51 px (${log.join(',')})`);
  // The same mid-wipe element further down the content is hidden (y / 21 pushes its reveal below 0).
  log.length = 0;
  withElementWipe(mid, 100, 50, 150, () => wipeElement(ctx, 100, 50 + 5 * 20, 20, draw));
  check(drawn() === 0, 'wipe: an element five rows down is not yet shown');
  // Scopes nest and restore: outside the inner scope the outer one is back.
  log.length = 0;
  withElementWipe(open, 0, 0, 150, () => {
    withElementWipe(undefined, 0, 0, 150, () => wipeElement(ctx, 10, 10, 20, draw));
    wipeElement(ctx, 10, 10, 20, draw);
  });
  check(drawn() === 2, 'wipe: undefined anim draws whole inside an outer scope');
  // Outside any scope again, the title shows whatever the old scope said.
  check(titleTextShown(), 'wipe: scope restored after the call');
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

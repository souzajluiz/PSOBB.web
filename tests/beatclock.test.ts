// The beat clock HUD (client/src/render/beatclock.ts): the layout numbers and timing of
// RenderChatShortcutMenuTimer_0077b5ac and its caller ChatShortcutMenuWindow_UpdateVisuals_0075855c.
// Exe constants are read from PsoBB.exe .data (see the module header). Run: node tests/beatclock.test.ts
import {
  advancePhase,
  alphaByte,
  barSweepByte,
  beatClockDraw,
  newBeatWindow,
  stepBeatWindow,
  beatBarColor,
  beatBarLength,
  beatBarVertices,
  beatDigits,
  beatTextColor,
  beatTextOrigin,
  beatVisible,
  BAR_DIVISOR,
  PHASE_STEP,
  WINDOW_X,
  WINDOW_Y,
  windowAlphas,
} from '../client/src/render/beatclock.ts';

let checks = 0;
let failures = 0;
function eq<T>(got: T, want: T, what: string): void {
  checks++;
  if (Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want)) return;
  failures++;
  console.log(`FAIL ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
function near(got: number, want: number, what: string, eps = 1e-9): void {
  checks++;
  if (Math.abs(got - want) <= eps) return;
  failures++;
  console.log(`FAIL ${what}: got ${got}, want ${want}`);
}

// Digits: one beat is 0xa20 = 2592 frames; the beat is (frames / 2592) % 1000.
eq(beatDigits(0).text, '000', 'digits: frame 0 is beat 000');
eq(beatDigits(2591).text, '000', 'digits: the last frame of beat 0');
eq(beatDigits(2592).text, '001', 'digits: the first frame of beat 1');
eq(beatDigits(2592 * 123 + 5).beat, 123, 'digits: beat 123');
eq(beatDigits(2592 * 999).text, '999', 'digits: beat 999');
eq(beatDigits(2592 * 1000).text, '000', 'digits: the day wraps at 1000 beats');
eq(beatDigits(2592 * 1000 + 2592 * 7).text, '007', 'digits: wrap keeps the remainder');

// Sub-beat bar: (frames % 2592) * 163 / 2592, proven from the asm.
eq(BAR_DIVISOR, 2592, 'bar divisor is 0xa20 frames');
near(beatBarLength(0), 0, 'bar: empty at the beat start');
near(beatBarLength(1296), 81.5, 'bar: half a beat is half of 163');
near(beatBarLength(2591), (2591 * 163) / 2592, 'bar: the last frame before the beat turns');
near(beatBarLength(2592), 0, 'bar: resets with the next beat');
near(beatBarLength(2592 * 5 + 648), 163 / 4, 'bar: quarter beat after five beats');

// Phase timer: g_UIPhaseTimer += 0.01 per frame, wrapped by -1 at 1.0.
let t = 0;
for (let i = 0; i < 99; i++) t = advancePhase(t);
near(t, 0.99, 'phase: 99 steps is 0.99', 1e-9);
t = advancePhase(t);
near(t, 0, 'phase: the 100th step wraps to 0', 1e-9);
near(advancePhase(0.5), 0.5 + PHASE_STEP, 'phase: a mid step adds 0.01');

// Bar vertices: the far end at x + len, the phase point at x + len * t, the left end at x; y + 18.
const v = beatBarVertices(100, 200, 1296, 0.5);
eq(v[0], { x: 100 + 81.5, y: 218 }, 'bar vertex 0: far end at y + 18');
eq(v[1], { x: 100 + 40.75, y: 218 }, 'bar vertex 1: phase point halfway');
eq(v[2], { x: 100, y: 218 }, 'bar vertex 2: the left end');

// Beat text origin: the window + (163, -1).
eq(beatTextOrigin(650, 425), { x: 813, y: 424 }, 'text origin: x + 163, y - 1');

// Colours: round(255 * clamp(alpha)) in the top byte; white or green below.
eq(alphaByte(1), 255, 'alpha: full is 255');
eq(alphaByte(0.5), 128, 'alpha: half rounds to 128');
eq(alphaByte(2), 255, 'alpha: clamped above 1');
eq(alphaByte(-1), 0, 'alpha: clamped below 0');
eq(beatTextColor(1), 0xffffffff, 'text colour: opaque white');
eq(beatBarColor(1), 0xff00ff00, 'bar colour: opaque green');
eq(beatBarColor(0.5), 0x8000ff00 >>> 0, 'bar colour: half alpha');

// Visibility: the beat draws only at a positive alpha (0x978498 = 0).
eq(beatVisible(0), false, 'visible: zero alpha hides');
eq(beatVisible(0.01), true, 'visible: a positive alpha shows');

// Window timeline (ChatShortcutMenuWindow_UpdateVisuals_0075855c): counter <= 150 is the hold.
eq(windowAlphas(0), { beat: 1, time: 1 }, 'window: counter 0 holds the beat and starts the time text full');
eq(windowAlphas(15), { beat: 1, time: 0 }, 'window: the time text is gone at 15');
eq(windowAlphas(150).beat, 1, 'window: counter 150 still holds the beat');
eq(windowAlphas(150).time < 0, true, 'window: the time text is hidden at 150 (negative alpha)');
eq(windowAlphas(151), { beat: (15 - 1) / 15, time: 1 }, 'window: from 151 the time text is full and the beat fades');
eq(windowAlphas(165).beat, 0, 'window: the beat is gone at 165');
eq(beatVisible(windowAlphas(165).beat), false, 'window: nothing draws at 165');
eq(WINDOW_X, 650, 'window x is 650 (0x44228000)');
eq(WINDOW_Y, 425, 'window y is 425 (0x43d48000)');

// The window's update (0x00758480): x eases 0.1 toward its target, the counter steps in logged_in only.
const w0 = newBeatWindow(true);
eq({ x: w0.x, y: w0.y, target: w0.target, counter: w0.counter }, { x: 650, y: 425, target: 396, counter: 0 }, 'window: the constructor (target -220 + 616)');
eq(newBeatWindow(false).target, 453, 'window: outside logged_in the target is -163 + 616');
const w1 = stepBeatWindow(w0, true);
near(w1.x, 650 + (396 - 650) * 0.1, 'window: x eases 10% of the way to the target');
eq(w1.counter, 1, 'window: the counter steps to 1 in logged_in');
const wOut = stepBeatWindow(w0, false);
eq(wOut.counter, 0, 'window: the counter does not step outside logged_in');
near(wOut.x, w1.x, 'window: the easing runs in every scene');
let wc = { x: 396, y: 425, target: 396, counter: 1 };
for (let i = 1; i < 300; i++) wc = stepBeatWindow(wc, true);
eq(wc.counter, 300, 'window: the counter reaches 300');
wc = stepBeatWindow(wc, true);
eq(wc.counter, 1, 'window: 300 wraps to 1 (the reset to 0 and the +1)');
eq(wc.x, 650, 'window: the wrap snaps x to 650');
eq(wc.y, 425, 'window: y stays 425');

// The 0.5 split: 2t up to 0.5, 2(1 - t) after it, scaled by 255 and truncated.
eq(barSweepByte(0), 0, 'sweep: phase 0 is 0');
eq(barSweepByte(0.25), 127, 'sweep: a quarter is 127');
eq(barSweepByte(0.5), 255, 'sweep: the split is the peak 255');
eq(barSweepByte(0.75), 127, 'sweep: three quarters is back to 127');
eq(barSweepByte(0.99), 5, 'sweep: near the wrap it is nearly 0');

// The draw: text at (x + 163, y - 1), bar from x to x + len at y + 18, colours from the beat alpha.
const d = beatClockDraw({ x: 650, y: 425, target: 396, counter: 0 }, 1296, 0.5);
eq(d?.text, '000', 'draw: frame 1296 is beat text 000');
eq(d?.textOrigin, { x: 813, y: 424 }, 'draw: text origin x + 163, y - 1');
eq(d?.textArgb, 0xffffffff, 'draw: full alpha text is opaque white');
eq(d?.bar, { x0: 650, x1: 650 + 81.5, y: 443, argb: 0xff00ff00 }, 'draw: bar from x to x + 81.5 at y + 18, opaque green');
eq(d?.sweep, 255, 'draw: the sweep byte at phase 0.5');
const fade = beatClockDraw({ x: 650, y: 425, target: 396, counter: 151 }, 0, 0);
eq(fade?.textArgb >>> 24, 238, 'draw: counter 151 fades the beat to 14/15 (238)');
eq(beatClockDraw({ x: 650, y: 425, target: 396, counter: 165 }, 0, 0), null, 'draw: counter 165 draws nothing');
console.log(`beatclock: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);

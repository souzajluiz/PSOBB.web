// The connected gamepad as the pad config reads it (input/padconfig.ts): the
// browser's Gamepad API standard layout, mapped to the exe's bits.
//
// - buttons 0..11 are PAD BUTTON1..12 (bit i, the exe's 0x1 << i); the browser's
//   d-pad (buttons 12..15) is the POV bits: up POV(Y)+ 0x10000, down POV(Y)-
//   0x20000, left POV(X)+ 0x40000, right POV(X)- 0x80000 (ASSUMED: the
//   default block puts Select Up on POV(Y)+ and Select Left on POV(X)+, which
//   fixes the signs);
// - axes 0..3 are X, Y, X rotate, Y rotate (the codes 0, 1, 3, 4) and axes 4..5
//   are Z, Z rotate (ASSUMED: the browser has no DirectInput axis names). A
//   deflection of 0.5 counts (the + side, or the - side: the code + 7).
//
// PadKeyFeed turns the held controls into key events on the game canvas, the
// same way the touch controls do (ui/webcontrols.ts): control c drives the keys
// of CONTROL_ROLES[c] (ASSUMED mapping, padconfig.ts). Autorepeat follows the
// select keys. Paused while the pad config window is open (the exe disables the
// keyboard controls there).

import { isRepeatingKey } from './keyconfig.ts';
import { padStickFromUnit, setPadStick, type StickAxes } from './analog.ts';
import { analogOf, buttonOf, CONTROL_COUNT, controlDomEvents, currentPadConfig, POV_DOWN, POV_LEFT, POV_RIGHT, POV_UP, ANALOG_NONE } from './padconfig.ts';
import { REPEAT_DELAY, REPEAT_INTERVAL } from './virtualpad.ts';

export const AXIS_THRESHOLD = 0.5;
const AXIS_CODES = [0, 1, 3, 4, 2, 5] as const; // browser axes 0..5 -> X, Y, X rotate, Y rotate, Z, Z rotate

// One sample of the pad: the exe's button bits and the analog codes deflected
// now (an axis code: the + side, or + 7 for the - side).
export interface PadSample {
  buttons: number;
  analog: number[];
  // The browser's six axes (0..5, -1..1; 0 where the pad has no such axis).
  axes: number[];
}

export interface GamepadLike {
  buttons: ReadonlyArray<{ pressed: boolean }>;
  axes: ReadonlyArray<number>;
}

export function padSampleOf(gp: GamepadLike | null | undefined): PadSample | null {
  if (!gp) return null;
  let buttons = 0;
  for (let i = 0; i < 12; i++) if (gp.buttons[i]?.pressed) buttons = (buttons | (1 << i)) >>> 0;
  if (gp.buttons[12]?.pressed) buttons = (buttons | POV_UP) >>> 0;
  if (gp.buttons[13]?.pressed) buttons = (buttons | POV_DOWN) >>> 0;
  if (gp.buttons[14]?.pressed) buttons = (buttons | POV_LEFT) >>> 0;
  if (gp.buttons[15]?.pressed) buttons = (buttons | POV_RIGHT) >>> 0;
  const analog: number[] = [];
  const axes: number[] = [];
  for (let i = 0; i < AXIS_CODES.length; i++) {
    const v = i < gp.axes.length && Number.isFinite(gp.axes[i]) ? Math.max(-1, Math.min(1, gp.axes[i])) : 0;
    axes.push(v);
    if (v >= AXIS_THRESHOLD) analog.push(AXIS_CODES[i]);
    else if (v <= -AXIS_THRESHOLD) analog.push(AXIS_CODES[i] + 7);
  }
  return { buttons, analog, axes };
}

// The unit deflection (-1..1) of one analog row's code, with the + side: the
// code's axis, or its negative for the - side (codes 7..13). The browser's
// axes 1 and 4 (Y, Y rotate) read the exe's + side as stick forward, which is
// the browser's negative Y (ASSUMED: the default block's Move Forward is code 1,
// and the stick pushed up must walk forward). Code 6 (the slider) and 0xFF
// (none) have no browser axis: 0.
const CODE_AXIS = [0, 1, 4, 2, 3, 5, -1] as const; // codes 0..6 -> browser axis index
const Y_AXIS_CODES = new Set([1, 4]);
export function analogUnit(code: number, axes: readonly number[]): number {
  if (code === ANALOG_NONE) return 0;
  const base = code >= 7 ? code - 7 : code;
  const idx = CODE_AXIS[base];
  if (base > 6 || idx === undefined || idx < 0) return 0;
  const sign = (code >= 7 ? -1 : 1) * (Y_AXIS_CODES.has(base) ? -1 : 1);
  return sign * (axes[idx] ?? 0);
}

// The left stick of a sample under the config: row 0 (Move Left/Right) and row 1
// (Move Forward/Backward), or null inside the dead zone (keyboard movement).
export function padMoveStick(cfg: Uint8Array, s: PadSample): StickAxes | null {
  return padStickFromUnit(analogUnit(analogOf(cfg, 0), s.axes), analogUnit(analogOf(cfg, 1), s.axes));
}

// The first connected gamepad's sample, or null (no pad, or no Gamepad API).
export function sampleGamepad(): PadSample | null {
  try {
    const pads = globalThis.navigator?.getGamepads?.() ?? [];
    for (const gp of pads) {
      if (gp) return padSampleOf(gp as unknown as GamepadLike);
    }
  } catch {
    // no Gamepad API: no pad
  }
  return null;
}

// The controls held by a sample under the config (a control with no button
// bound is never held).
export function controlsHeld(cfg: Uint8Array, s: PadSample): Set<number> {
  const held = new Set<number>();
  for (let c = 0; c < CONTROL_COUNT; c++) {
    const v = buttonOf(cfg, c);
    if (v !== 0 && (s.buttons & v) !== 0) held.add(c);
  }
  return held;
}

// Keeps the pad feed paused while the pad config window is open.
let paused = false;
export function setPadFeedPaused(v: boolean): void {
  paused = v;
}

// Feeds the held controls to the game as key events on target.
export class PadKeyFeed {
  private readonly target: HTMLElement;
  private readonly held = new Map<string, { key: string; code: string; since: number; last: number }>();
  private readonly getSample: () => PadSample | null;
  private readonly getConfig: () => Uint8Array;

  constructor(target: HTMLElement, getSample: () => PadSample | null = sampleGamepad, getConfig: () => Uint8Array = currentPadConfig) {
    this.target = target;
    this.getSample = getSample;
    this.getConfig = getConfig;
  }

  private send(type: 'keydown' | 'keyup', ev: { key: string; code: string }, repeat = false): void {
    this.target.dispatchEvent(new KeyboardEvent(type, { key: ev.key, code: ev.code, repeat, bubbles: true, cancelable: true }));
  }

  // One frame at time now (ms). Presses and releases the keys of the controls.
  tick(now: number): void {
    const s = paused ? null : this.getSample();
    const want = new Map<string, { key: string; code: string }>();
    const cfg = s ? this.getConfig() : null;
    // The stick feeds the player's mover (analog.ts analogStick), not the keys.
    setPadStick(s && cfg ? padMoveStick(cfg, s) : null);
    if (s && cfg) {
      for (const c of controlsHeld(cfg, s)) {
        for (const ev of controlDomEvents(c)) want.set(ev.key, ev);
      }
    }
    for (const [key, ev] of want) {
      if (!this.held.has(key)) {
        this.held.set(key, { key, code: ev.code, since: now, last: now });
        this.send('keydown', ev);
      } else if (isRepeatingKey(key)) {
        const h = this.held.get(key)!;
        if (now - h.since >= REPEAT_DELAY && now - h.last >= REPEAT_INTERVAL) {
          h.last = now;
          this.send('keydown', ev, true);
        }
      }
    }
    for (const [key, h] of [...this.held]) {
      if (!want.has(key)) {
        this.held.delete(key);
        this.send('keyup', { key, code: h.code });
      }
    }
  }

  // Releases everything (the pad went away or the feed stops).
  releaseAll(): void {
    setPadStick(null);
    for (const [key, h] of [...this.held]) {
      this.held.delete(key);
      this.send('keyup', { key, code: h.code });
    }
  }
}

// Starts the feed on target (the game canvas) at display rate. Returns a stop function.
export function startPadInput(target: HTMLElement): () => void {
  const feed = new PadKeyFeed(target);
  let raf = 0;
  let alive = true;
  const frame = (t: number) => {
    if (!alive) return;
    try {
      feed.tick(t);
    } catch {
      // a pad that breaks the poll is ignored for this frame
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    feed.releaseAll();
  };
}

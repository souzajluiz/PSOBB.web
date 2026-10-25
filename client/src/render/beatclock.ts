// The beat clock HUD (PsoBB.exe RenderChatShortcutMenuTimer_0077b5ac, Ephinea 1.25.13): the
// three-digit beat and the sub-beat bar. Pure layout and timing rules; the draw calls are left to the
// caller. Evidence: the named dump src/Psobb.exe-05112026.c 752482..752540 (the body), the caller
// ChatShortcutMenuWindow_UpdateVisuals_0075855c (dump 728474, entry 0x0075855c), the window's per-frame
// counter (+0x40) at 0x007584e0..0x00758546, and the asm of 0x0077b5ac (objdump of PsoBB.exe). The
// constants are read from the exe's .data (exedata.py read): 0x978488 = 163, 0x978480 = 2592,
// 0x978470 = 18, 0x978484 = 0.01, 0x978494 = 1, 0x978490 = -1, 0x978498 = 0, 0x974180 = 1, 0x974184 = 15,
// 0x978474 = 2, 0x97847c = 0.5, 0x97846c = 0x978478 = 255. The window position 650 x 425 is 0x44228000 and
// 0x43d48000 (set at 0x0075851c and 0x007584eb).
//
// Where it is drawn: only from the chat shortcut menu window's update (the window singleton
// g_pChatShortcutMenuInstance, 0x00a9acf0 is a pointer read in 0x0075854c). Its visibility trigger is
// ASSUMED: the counter +0x40 runs 0..0x96 (150 frames) with the beat at full alpha, then fades out in
// 15 frames. The position is set at counter 0x96 (+0x2c/+0x30) and 0x12c (+0x1c/+0x20).
// The port does not draw it yet (the window is not in the port's field HUD).
import { beatFromFrames, FRAMES_PER_BEAT } from '../combat/beattime.ts';

export const BEAT_DIGITS = 3; // render_texturejapanese_xvm_font(..., 3)
export const BEAT_TEXT_DX = 163; // 0x978488: the beat text sits 163 right of the window x (ASSUMED: the text origin)
export const BEAT_TEXT_DY = -1; // 0x978490 (g_RenderChatMenuYOffset)
export const BAR_DY = 18; // 0x978470 (g_RenderChatMenuXOffset): the bar sits 18 below the window y
export const BAR_LENGTH_SCALE = 163; // 0x978488 multiplies the sub-beat frames
export const BAR_DIVISOR = 2592; // 0x978480 (g_RenderChatMenuPhaseDivisor) = FRAMES_PER_BEAT
export const PHASE_STEP = 0.01; // 0x978484 (g_RenderChatMenuPhaseIncrement), per frame
export const PHASE_WRAP_AT = 1; // 0x978494 (g_RenderChatMenuPhaseMax)
export const PHASE_WRAP_BY = -1; // 0x978490 (g_RenderChatMenuYOffset)
export const COLOR_SCALE = 255; // 0x978478 / 0x97846c: the alpha byte
export const WINDOW_FADE_FRAMES = 15; // 0x974184
export const WINDOW_HOLD_FRAMES = 0x96; // 150: the beat is at full alpha before this counter value
export const WINDOW_X = 650; // 0x44228000
export const WINDOW_Y = 425; // 0x43d48000

export interface Point {
  x: number;
  y: number;
}

// The three digits of the beat as the exe's `(q) + (q / 1000) * -1000`, q = frames / 0xa20 (signed,
// truncating). Returns the beat 0..999 and its zero-padded text.
export function beatDigits(frames: number): { beat: number; text: string } {
  const beat = beatFromFrames(frames);
  return { beat, text: String(beat).padStart(BEAT_DIGITS, '0') };
}

// The sub-beat frames: `frames % 0xa20` (the exe's signed modulo; frames are never negative here).
export function subBeatFrames(frames: number): number {
  return frames % FRAMES_PER_BEAT;
}

// The bar's length in pixels: (frames % 0xa20) * 163 / 2592. Proven from the asm (fmul 0x978488,
// fdiv 0x978480 after the modulo).
export function beatBarLength(frames: number): number {
  return (subBeatFrames(frames) * BAR_LENGTH_SCALE) / BAR_DIVISOR;
}

// The bar's three vertices (the decomp's local_2c / local_24 / local_1c): the far end, the phase
// point that sweeps from the left to the far end with the phase timer t, and the left end. All on
// one line y + 18 (the decomp's local_28 / local_20 / local_18).
export function beatBarVertices(x: number, y: number, frames: number, phase: number): [Point, Point, Point] {
  const len = beatBarLength(frames);
  const yy = y + BAR_DY;
  return [
    { x: x + len, y: yy },
    { x: x + len * phase, y: yy },
    { x, y: yy },
  ];
}

// The beat text origin (x + 163, y - 1). ASSUMED: the decomp reads the text y from the window's
// param_4 while the asm adds it to the y argument; the asm is followed here.
export function beatTextOrigin(x: number, y: number): Point {
  return { x: x + BEAT_TEXT_DX, y: y + BEAT_TEXT_DY };
}

// The ARGB colour of the beat text and the bar: the alpha byte from the fade (round(255 * clamp(a))).
export function alphaByte(alpha: number): number {
  const a = Math.min(1, Math.max(0, alpha));
  return Math.round(a * COLOR_SCALE);
}

// The text colour: alpha byte in the top byte, white (0xffffff) below.
export function beatTextColor(alpha: number): number {
  return ((alphaByte(alpha) << 24) | 0xffffff) >>> 0;
}

// The bar colour: alpha byte in the top byte, green (0x00ff00) below.
export function beatBarColor(alpha: number): number {
  return ((alphaByte(alpha) << 24) | 0x00ff00) >>> 0;
}

// One frame of the phase timer: t += 0.01; wrap by -1 once t reaches 1 (the asm's compare of the
// phase max with the new value).
export function advancePhase(t: number): number {
  const n = t + PHASE_STEP;
  return PHASE_WRAP_AT <= n ? n + PHASE_WRAP_BY : n;
}

// The alphas of the beat and the time text from the window's counter (+0x40), as
// ChatShortcutMenuWindow_UpdateVisuals_0075855c computes them. The beat is full until 150 and then
// fades out over 15 frames; the time text starts faded (and is negative, so hidden, from 15 on) and is full from 151 on.
export function windowAlphas(counter: number): { beat: number; time: number } {
  if (counter < WINDOW_HOLD_FRAMES + 1) {
    return { beat: 1, time: (WINDOW_FADE_FRAMES - counter) / WINDOW_FADE_FRAMES };
  }
  return { beat: (WINDOW_FADE_FRAMES - (counter - WINDOW_HOLD_FRAMES)) / WINDOW_FADE_FRAMES, time: 1 };
}

// The beat draws only at a positive alpha (0x978498 = 0: RenderChatShortcutMenuTimer's first test).
export function beatVisible(alpha: number): boolean {
  return alpha > 0;
}

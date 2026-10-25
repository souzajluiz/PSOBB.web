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
// Where it is drawn (proven, 2026-10-25 pass): the window is ChatShortcutMenuWindow, constructed at
// 0x0075836c (dump 728406) from ChallengeMenuObject_CreateSubmenuWindow_00733428 (dump 700518): the
// submenu of the field's player menu object (ChallengeMenuObject_Constructor_00731bec, dump 699284,
// made by unknown_handle_ui_target_window 0x0071a9c3 from update_player_menu_, dump 682107 / 682135).
// Its per-frame update is 0x00758480 (vtable slot 1, see stepBeatWindow below) and its draw is
// 0x0075854c -> ChatShortcutMenuWindow_UpdateVisuals_0075855c, through the list window's callback.
// The chat shortcut menu entry (symbol_chat_menu, the 0x0075882c class, dump 728581) is a different window.
// The visibility gate of the player menu object is ASSUMED beyond these calls; the port draws the beat
// from render/fieldhud.ts while no menu is open.
//
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

// The window's per-frame update (PsoBB.exe 0x00758480, the vtable's update slot 1; dump
// ChatShortcutMenuWindow_UpdateVisuals_0075855c beside it). Proven from the asm:
//   - x (+0x1c) eases toward its target (+0x24) by 0.1 each frame (0x974194 = 0.1):
//     x += (target - x) * 0.1. The target is GetSceneTimerValue + 616 (0x974188 and 0x974198 =
//     616, set in the constructor 0x0075836c and at counter 300); GetSceneTimerValue is -220 in
//     logged_in (0x978458) and -163 elsewhere (0x97845c), so the target is 396 in logged_in.
//   - y (+0x20) stays 425: it starts at 425 and its target (+0x28) is always 425.
//   - the counter (+0x40) advances only in logged_in (0x7a61a4 returns the scene, compared with 0xb).
//     At 300 (0x12c) it snaps x to 650 and resets the target, then stores counter 1 (the reset to 0
//     and the +1); so the cycle is 1..300. The beat's alpha is windowAlphas(counter).beat.
// The easing runs in every scene; the counter steps only in logged_in. The window's x is the
// position the draw uses (ChatShortcutMenuWindow_UpdateVisuals passes +0x1c / +0x20).
export const WINDOW_EASE = 0.1; // 0x974194
export const WINDOW_TARGET_OFFSET = 616; // 0x974188 / 0x974198
export const WINDOW_CYCLE_AT = 0x12c; // 300: the snap and the counter reset
export const SCENE_TIMER_LOGGED_IN = -220; // 0x978458
export const SCENE_TIMER_OTHER = -163; // 0x97845c

export interface BeatWindow {
  x: number;
  y: number;
  target: number;
  counter: number;
}

// The constructor 0x0075836c: x = 650, y = 425, target = GetSceneTimerValue + 616, counter 0.
export function newBeatWindow(loggedIn: boolean): BeatWindow {
  const scene = loggedIn ? SCENE_TIMER_LOGGED_IN : SCENE_TIMER_OTHER;
  return { x: WINDOW_X, y: WINDOW_Y, target: scene + WINDOW_TARGET_OFFSET, counter: 0 };
}

// One frame of the window's update. The easing always runs; the counter only in logged_in, where
// the target at the wrap is the logged_in scene timer (-220 + 616 = 396).
export function stepBeatWindow(w: BeatWindow, loggedIn: boolean): BeatWindow {
  const x = w.x + (w.target - w.x) * WINDOW_EASE;
  if (!loggedIn) return { x, y: w.y, target: w.target, counter: w.counter };
  if (w.counter === WINDOW_CYCLE_AT) {
    return { x: WINDOW_X, y: w.y, target: SCENE_TIMER_LOGGED_IN + WINDOW_TARGET_OFFSET, counter: 1 };
  }
  return { x, y: w.y, target: w.target, counter: w.counter + 1 };
}

// The sub-beat bar's 0.5 split (asm 0x0077b77e..0x0077b7e7, the phase timer g_UIPhaseTimer at
// 0x00a9b1ec): the colour byte is the phase's triangle wave, 2t up to 0.5 and 2(1 - t) after it,
// scaled by 255 (the 0x978478 push, ASSUMED to be this multiplier) and truncated to the low byte.
export const SPLIT_AT = 0.5; // 0x97847c
export const SPLIT_SCALE = 2; // 0x978474
export function barSweepByte(phase: number): number {
  const v = phase <= SPLIT_AT ? phase * SPLIT_SCALE : (1 - phase) * SPLIT_SCALE;
  return Math.trunc(v * COLOR_SCALE) & 0xff;
}

// The draw of one frame of the beat (RenderChatShortcutMenuTimer_0077b5ac). Null when the beat is
// hidden (alpha <= 0). The text is the three digits; the bar is the 163-px sub-beat length at
// y + 18, drawn from the left end x to x + len. The sweep byte is computed but its use in the exe
// (the OR into the vertex word at +4) is ASSUMED, so the caller does not draw it.
export interface BeatClockDraw {
  text: string;
  textOrigin: Point;
  textArgb: number;
  bar: { x0: number; x1: number; y: number; argb: number };
  sweep: number;
}

export function beatClockDraw(w: BeatWindow, frames: number, phase: number): BeatClockDraw | null {
  const { beat } = windowAlphas(w.counter);
  if (!beatVisible(beat)) return null;
  const digits = beatDigits(frames);
  const v = beatBarVertices(w.x, w.y, frames, phase);
  return {
    text: digits.text,
    textOrigin: beatTextOrigin(w.x, w.y),
    textArgb: beatTextColor(beat),
    bar: { x0: v[2].x, x1: v[0].x, y: v[0].y, argb: beatBarColor(beat) },
    sweep: barSweepByte(phase),
  };
}

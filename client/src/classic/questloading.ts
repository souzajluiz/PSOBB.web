// The quest loading screen, as PsoBB.exe (Ephinea 1.25.13) shows it while a
// quest downloads and loads.
//
// NAMES. The dump's QuestLoadingScreen* names and the 7 psobb-client-source
// files named QuestLoadingScreen (FUN_0040c1c8, FUN_0040c864, FUN_0040c884,
// FUN_0040dd20, FUN_0040e148, FUN_0040e15c, FUN_0040e210, FUN_0040e248,
// FUN_004107c4, FUN_00410910, FUN_00410d68, FUN_00410894) are mostly guesses:
// FUN_0040c1c8 / FUN_0040c864 ("advance state", twins) are the render gates
// below, FUN_0040c884 dispatches the grey line primitives, FUN_0040e148 /
// 0040e15c / 0040e210 / 0040e248 / 004107c4 / 00410910 / 00410d68 / 00410894
// are unrelated thunks (a bit-mask check on a singleton, a parameter copy, a
// handle release, a vtable call). The real object is `update_loading_screen
// _widget` (0x00417ccc, `g_pLoginLoadingScreen`), which on its second frame
// builds one of four loading screens by `current_loading_screen_type`:
//   lobby      the burst of classic/connecting.ts (create_lobby_burst_screen)
//   quest      this file (QuestLoadingScreenConstructor, 0x0040c624)
//   floor_prev / floor_next  GameListObjectConstructor (0x0040a430, 0 / 1)
// (the type is chosen by 0x00417a9c from its callers: 1 for a quest, 2 by
// the episode).
//
// The quest screen (vtable 0x00af2998) owns, in this order:
//   black bars x3 (0x0040c1e8, QuestLoadingScreenBlackBarObject_Render)
//     mode 0  120 scan lines: a triangle (0, y) (640, y) (640, y + 4) for
//             y = 8 i, colour 0xff001a36, depth -500, blend 0x20
//     mode 1  the letterbox: black 0xff000000 rects (0, 0) 640 x 64 and
//             (0, 416) 640 x 64 (0x008f9f2c..0x008f9f48), depth -490
//     mode 2  two panels, 0x77000000 (alpha 0.467): (31, 73) 455 x 332 and
//             (543, 75) 72 x 332 (0x008f9f08..0x008f9f24), depth -490, blend 0x60
//   particle wipes x3 (QuestLoadingScreenInitialize, effects 0xf and 8)
//   grey bars x2 (quest_loading_screen_grey_line_primitives 0x0040c884)
//     mode 0  corner brackets of the two panels, 0xff777777 (0x0040cba8 with
//             the groups at 0x008f9f80)
//     mode 1  the letterbox lines and their diagonal jogs (0x0040c89c),
//             0xff777777, depth -1
//   the middle particle (create_quest_loading_screen_middle_particle)
// and each draws from its second call on (the 0x0040c864 twins: a counter at
// +0x20, nothing below 2).
// The progress widget of the bottom bar is the QuestLoadingBar (0x00783a70,
// created by UpdateQuestLoadingBar 0x007836d2 from the quest download in
// 0x006cd0xx / 0x006cbbxx with received / total bytes): a bar at (473, 440),
// 142 x 8, a "m\"ss.t" estimate and a percentage above it.
//
// THE PARTICLES (decoded 2026-10-31, Ghidra 0040ce9c / 0040cf30 / 0040d234 /
// 0040b990 / 0040bb70; constants by tools/exedata.py; entries from
// particleentry.dat, data.gsl):
//   QuestLoadingScreenInitialize 0x0040cf30 (called by 0040ce9c for the
//   particles2 objects 0, 1, 2; the vtable 0x00af2a80, update slot 0x0040d234):
//     mode 0  22 x effect 0xf ("quest_load_b", a free sprite, rate 1 a frame),
//             x = 8.0, y = 72 + 16 i (0x008fa1ac, 0x008fa1d4), z 0.002
//     mode 1  19 x effect 0x8 ("quest_load", rate 0.1): x = 50 + 16 i and y 35
//             for i < 10; x = 462 + 16 (i - 9) and y 444 for i >= 10 (0x008fa1c4,
//             0x008fa1c0)
//     mode 2  32 x effect 0x8: x = 555 + 16 (i % 4), y = 99 + 40 (i / 4)
//             (0x008fa1d8, 0x008fa1d0, 0x008fa1cc), z 0.1
//   Only the mode 0 instance has an update: 0x0040d234 begins with `if (+0x220
//   == 0)` and +0x220 is the mode. Its timer t (+0x224) goes up by one a frame
//   and wraps to 0 at 0xf1 (so t = 1..240, then 0). Particle i of mode 0 is
//   shown while 20 i < t < 20 i + 40 (0x14 / 0x28); then its x grows by 15.6
//   (0x008fa1a4) a frame (copied into its position), and outside it x is 0 and
//   the effect is hidden (SetObjectActiveFlag). Particles 12..21 never have a
//   window in the 241-frame cycle. Modes 1 and 2 never move (their update is the
//   early return) and are shown from the first frame.
//   create_quest_loading_screen_middle_particle 0x0040b990 (0x158 bytes, the
//   object's vtable 0x00af2870, update slot 0x0040bb70): four effects 0x1b
//   ("questload_d", a ring of radius 20, rate 20) at target * 100 + (-11, 0, 0)
//   (0x008f9ec0 / 0x008f9ec4) with target (0, 0, -1) and current (0, 0, 0)
//   (the camera 9 that 0x00417ccc sets). Their object angles start at
//   (k * 0xaaa, 0, k * 0xaaa) BAMS for emitter k, and the update turns Z by
//   91, -91, 182, -91 BAMS a frame (the constructor's 0x94 / 0xa0 / 0xac / 0xb8;
//   the X turn is the mouse's, 0x0040bb70 when DAT_00aae8b0 / 2 is not 0, not
//   ported). The colour is the ARGB of 0x008f9ea0[bbc], bbc moved by a button
//   (0x0040e210), not ported: it stays 0.
//   The screen projection of the wipes is ASSUMED (the exe's view of their
//   z of 0.002 is behind the camera of the connect warp, so they cannot be 3D
//   points here; their x / y are pixels of the 640 x 480 screen, as the bars'
//   are): a pixel at (x, y) with proj 1. The middle is drawn with the camera
//   projection of classic/particles.ts (centre 320 x 240, D 437.44).
//
// THE MIDDLE RING'S SHAPE: 0x0050f3fc (the ring update) places a ring of kind 1
// in the XZ plane at the owner's height: x = r cos + pos.x, z = r sin + pos.z,
// y = pos.y + rise (rise 0 for 0x1b). Its object angles are not read there when
// the renderer angles (+0x9c..+0xa4) are zero, which they are for these
// emitters, so the ring is a flat streak on the screen (seen in the e2e
// snapshot). classic/particles.ts draws rings the same way (ASSUMED that the
// exe's matrix branch, which is not traced, does not run for these).
//
// ASSUMED (not traced): the d3d clear colour (black); the order of the
// particles against the bars (the bars first, the particles, the grey lines
// last); the wipe effects' 0xc0 flags (0x40 / 0x80) are not modelled; the
// percent format is read as "%3d" because the wide string at 0x00979bb8 ends in
// a lone '%'; the estimate's float to int conversions truncate.

import { gameTextWidth, drawGameText } from './gametext.ts';
import { makeTinter, ParticleSystem, parseParticleEntry, type Orient } from './particles.ts';
import type { Screen } from './stage.ts';

export const SCREEN_W = 640;
export const SCREEN_H = 480;

// --- the decoration -----------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const WEDGE = { count: 120, step: 8, width: 4, color: '#001a36', depth: -500 } as const; // 0x008f9ee0..0x008f9efc, 0xff001a36
export const LETTERBOX: readonly Rect[] = [
  { x: 0, y: 0, w: 640, h: 64 },
  { x: 0, y: 416, w: 640, h: 64 },
];
export const PANELS: readonly Rect[] = [
  { x: 31, y: 73, w: 455, h: 332 },
  { x: 543, y: 75, w: 72, h: 332 },
];
export const PANEL_ALPHA = 0x77 / 255;
export const GREY = '#777777'; // 0xff777777

// Mode 0 of the grey bars: the six groups of 0x008f9f80 (every rect is 1 px
// thick: the corner brackets of the panels, then the marks at the mid height
// of the right panel).
export const BRACKETS: readonly Rect[] = [
  { x: 31, y: 73, w: 28, h: 1 },
  { x: 31, y: 73, w: 1, h: 333 },
  { x: 31, y: 405, w: 28, h: 1 },
  { x: 459, y: 73, w: 28, h: 1 },
  { x: 486, y: 73, w: 1, h: 333 },
  { x: 459, y: 405, w: 28, h: 1 },
  { x: 543, y: 73, w: 19, h: 1 },
  { x: 543, y: 73, w: 1, h: 333 },
  { x: 543, y: 405, w: 19, h: 1 },
  { x: 595, y: 73, w: 19, h: 1 },
  { x: 615, y: 73, w: 1, h: 333 },
  { x: 595, y: 405, w: 19, h: 1 },
  { x: 543, y: 241, w: 19, h: 1 },
  { x: 543, y: 318, w: 19, h: 1 },
  { x: 595, y: 241, w: 19, h: 1 },
  { x: 595, y: 318, w: 19, h: 1 },
];

// Mode 1: the lines of the letterbox with a jog (0x008fa124..0x008fa160) and
// the two one-pixel diagonals joining them.
export const FRAME_LINES: readonly Rect[] = [
  { x: 0, y: 55, w: 213, h: 1 },
  { x: 229, y: 24, w: 411, h: 1 },
  { x: 0, y: 456, w: 410, h: 1 },
  { x: 426, y: 425, w: 214, h: 1 },
];
// Each diagonal is a quad (x0, y0) (x0, y0 + 1) (x1, y1) (x1, y1 - 1).
export const DIAGONALS: ReadonlyArray<readonly [x0: number, y0: number, x1: number, y1: number]> = [
  [212, 55, 229, 25],
  [409, 456, 426, 426],
];

// The black bars / grey bars of a screen of `calls` render calls: nothing
// before the second.
export function decorationVisible(calls: number): boolean {
  return calls >= 2;
}

// --- the progress bar -------------------------------------------------------------

export const BAR = { x: 473, y: 440, w: 142, h: 8, outline: 2 } as const; // 0x00a9c1b0 / 0x00a9c1b8, 0x00979ae0
export const ETA_POS = { x: 543, y: 418 } as const; // right edge of the estimate: 70 + 473, 440 - 14 - 8
export const PERCENT_POS = { x: 615, y: 418 } as const; // 473 + 142
export const TEXT_OUTLINE = 2; // 0x00979b18 / 0x00979b1c
export const ETA_MIN_FRAMES = 300; // the first estimate must be 10 s or more
export const ETA_MAX_FRAMES = 17999;
export const ETA_RESAMPLE = 0x4c; // frames between two re-estimates from the overall rate
export const ETA_JUMP = 0x4a; // an estimate more than this above the shown one replaces it
export const SAMPLES_NEEDED = 9;
const EPS = 9.999999747378752e-6; // 0x00979b5c

const bams = (a: number) => Math.sin(((a & 0xffff) / 65536) * Math.PI * 2);

// m"ss.t / s.t as UpdateFloatingTextValueWithTimer_00783d94 formats the frames
// left (30 a second): "%d.%d " below a minute, "%d\"%02d.%d " from one.
export function formatEta(frames: number): string {
  const secs = Math.trunc(frames / 30) % 60;
  const tenths = Math.trunc((frames % 30) / 3);
  const minutes = Math.trunc(frames / 1800);
  return minutes < 1 ? `${secs}.${tenths} ` : `${minutes}"${String(secs).padStart(2, '0')}.${tenths} `;
}

// UpdateFloatingTextValue_00784104.
export function percentText(ratio: number): string {
  const v = Math.max(0, Math.min(100, Math.trunc(100 * ratio)));
  return String(v).padStart(3, ' ');
}

interface Sample {
  frame: number;
  ratio: number;
}

export class QuestLoadingBar {
  ratio = 0; // +0x1c
  frames = 0; // +0x24
  flags = 3; // +0x20: 1 the estimate, 2 the percentage
  etaState = -1; // +0x28: -1 waiting for a first estimate, 1 showing
  eta = -1; // +0x2c frames left
  stamp = -1; // +0x30 frame of the last estimate
  samples = 0; // +0x40
  private history: Sample[] = [
    { frame: -1, ratio: -1 },
    { frame: -1, ratio: -1 },
    { frame: -1, ratio: -1 },
    { frame: -1, ratio: -1 },
  ];
  phase = 0; // +0x3c
  fill = ''; // +0x34
  rest = ''; // +0x38
  dead = false; // bit 0 of +8: destroyed next frame

  constructor() {
    this.visuals();
  }

  // UpdateQuestLoadingBarVisuals_007841d0: the filled part pulses between
  // (64..96, 64..96, 255) at 2048 / 65536 of a turn a frame, the rest between
  // greys 64..192 at 128 / 65536.
  private visuals(): void {
    const a = Math.trunc(32 * Math.abs(bams(this.phase << 11)) + 64);
    this.fill = `rgb(${a},${a},255)`;
    const b = Math.trunc((1 - Math.abs(bams(this.phase << 7))) * 128 + 64);
    this.rest = `rgb(${b},${b},${b})`;
    this.phase++;
  }

  // The estimate of the frames left from the last four samples
  // (UpdateQuestLoadingBar_007836d2), or -1.
  private estimate(frame: number, ratio: number): number {
    const h = this.history;
    // Shift: the newest sample first.
    h.pop();
    h.unshift({ frame, ratio });
    this.samples++;
    if (this.samples < SAMPLES_NEEDED) return -1;
    const [a, b, c, d] = h;
    const dr0 = a.ratio - b.ratio;
    const df0 = a.frame - b.frame;
    const dr1 = b.ratio - c.ratio;
    const df1 = b.frame - c.frame;
    const dr2 = c.ratio - d.ratio;
    const df2 = c.frame - d.frame;
    if (!(df0 > EPS && dr0 > EPS && df1 > EPS && dr1 > EPS && df2 > EPS && dr2 > EPS)) return -1;
    const mean = (df0 / dr0 + 0 + df1 / dr1 + df2 / dr2) / 3;
    let est = Math.trunc(mean * (1 - ratio));
    if (est < 0) return -1;
    est += Math.trunc((est / 1800) * 30 + 30);
    return Math.min(est, ETA_MAX_FRAMES);
  }

  // The part of UpdateQuestLoadingBar after the instance exists.
  progress(loaded: number, total: number): void {
    let ratio = loaded / total;
    if (ratio >= 0) {
      if (ratio >= 1) ratio = 1;
      this.ratio = ratio;
    } else {
      this.ratio = 0;
      ratio = 0;
    }
    if (this.etaState !== 0) {
      const last = this.history[0];
      if (this.frames !== last.frame && ratio !== last.ratio) {
        const est = this.estimate(this.frames, ratio);
        if (est >= 0) {
          if (this.etaState === -1) {
            if (est >= ETA_MIN_FRAMES) {
              this.etaState = 1;
              this.eta = est;
              this.stamp = this.frames;
            }
          } else if (this.etaState === 1) {
            if (est < this.eta) this.eta = est;
            else if (est - this.eta > ETA_JUMP) this.eta = est;
            this.stamp = this.frames;
          }
        }
      }
    }
    if (this.ratio === 1) this.dead = true;
  }

  // What the render call does after drawing (UpdateFloatingTextValueWithTimer
  // _00783d94's tail, the visuals, the frame count).
  step(): void {
    if (this.flags & 1 && this.eta > 0) {
      let left = this.eta;
      if (this.stamp >= 1 && this.frames - this.stamp >= ETA_RESAMPLE && this.ratio > EPS) {
        left = Math.trunc(this.frames * (1 / this.ratio - 1));
        this.stamp = this.frames;
        if (left > 0x464e) left = ETA_MAX_FRAMES;
        this.eta = left;
      }
      if (left > 5) this.eta = left - 1;
    }
    this.visuals();
    this.frames++;
  }

  etaText(): string | null {
    return this.flags & 1 && this.eta > 0 ? formatEta(this.eta) : null;
  }

  percent(): string | null {
    return this.flags & 2 ? percentText(this.ratio) : null;
  }
}

// UpdateQuestLoadingBar_007836d2 and its global instance.
export class QuestLoadingBars {
  bar: QuestLoadingBar | null = null;

  update(loaded: number, total: number): void {
    if (loaded < 0 || total < 1) return;
    if (loaded === 0) {
      if (this.bar) {
        this.bar.dead = true;
        return;
      }
      this.bar = new QuestLoadingBar();
    } else if (!this.bar) return;
    this.bar.progress(loaded, total);
  }

  // The engine frees a destroyed object on the next frame.
  step(): void {
    if (!this.bar) return;
    if (this.bar.dead) this.bar = null;
    else this.bar.step();
  }
}

// --- drawing ------------------------------------------------------------------------

function fillRects(ctx: CanvasRenderingContext2D, rects: readonly Rect[], color: string): void {
  ctx.fillStyle = color;
  for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h);
}

// A quad of the dump's vertex order, filled.
function quad(ctx: CanvasRenderingContext2D, pts: ReadonlyArray<readonly [number, number]>, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

// The black bars (depth -500 and -490): the scan lines, the letterbox, the panels.
export function drawBackdrop(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, SCREEN_W, SCREEN_H);
  ctx.clip();
  for (let i = 0; i < WEDGE.count; i++) {
    const y = i * WEDGE.step;
    quad(ctx, [[0, y], [SCREEN_W, y], [SCREEN_W, y + WEDGE.width]], WEDGE.color);
  }
  fillRects(ctx, LETTERBOX, '#000000');
  ctx.globalAlpha = PANEL_ALPHA;
  fillRects(ctx, PANELS, '#000000');
  ctx.globalAlpha = 1;
  ctx.restore();
}

// The grey bars (depth -1): the panel corners, the letterbox lines and jogs.
export function drawFrameLines(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, SCREEN_W, SCREEN_H);
  ctx.clip();
  fillRects(ctx, BRACKETS, GREY);
  fillRects(ctx, FRAME_LINES, GREY);
  for (const [x0, y0, x1, y1] of DIAGONALS) quad(ctx, [[x0, y0], [x0, y0 + 1], [x1, y1], [x1, y1 - 1]], GREY);
  ctx.restore();
}

export function drawDecoration(ctx: CanvasRenderingContext2D): void {
  drawBackdrop(ctx);
  drawFrameLines(ctx);
}

// --- the particles ----------------------------------------------------------------

export interface QuestLoadingAssets {
  particleEntries: Uint8Array; // particleentry.dat
  effect: Map<number, ImageBitmap>; // effect_nt.xvm by GBIX
}

export const WIPE_CYCLE = 0xf1; // 0x0040d234: the timer wraps when it would reach 0xf1
export const WIPE_STAGGER = 0x14; // particle i of mode 0 is shown from t = 20 i ...
export const WIPE_WINDOW = 0x28; // ... to t = 20 i + 40 (exclusive)
export const WIPE_SPEED = Math.fround(15.6); // 0x008fa1a4, a frame, while shown
export const WIPE_SWEEP_EFFECT = 0xf; // mode 0 ("quest_load_b")
export const WIPE_SPARK_EFFECT = 0x8; // modes 1 and 2 ("quest_load")

export interface WipeSpawn {
  mode: 0 | 1 | 2;
  effect: number;
  x: number; // the start x (pixels); mode 0's is reset by its first hidden frame
  y: number;
}

// The particles of QuestLoadingScreenInitialize (0x0040cf30), in creation order.
export function wipeSpawns(): WipeSpawn[] {
  const out: WipeSpawn[] = [];
  for (let i = 0; i < 22; i++) out.push({ mode: 0, effect: WIPE_SWEEP_EFFECT, x: 8, y: 72 + 16 * i });
  for (let i = 0; i < 19; i++) out.push({ mode: 1, effect: WIPE_SPARK_EFFECT, x: i < 10 ? 50 + 16 * i : 462 + 16 * (i - 9), y: i < 10 ? 35 : 444 });
  for (let i = 0; i < 32; i++) out.push({ mode: 2, effect: WIPE_SPARK_EFFECT, x: 555 + 16 * (i % 4), y: 99 + 40 * Math.floor(i / 4) });
  return out;
}

// The middle particle (create_quest_loading_screen_middle_particle, 0x0040b990).
export const MIDDLE = {
  effect: 0x1b, // "questload_d", a ring
  count: 4,
  distance: 100, // 0x008f9ec0 (the positions scale)
  offsetX: -11, // 0x008f9ec4
  target: [0, 0, -1] as const, // the camera 9 target (0x00417ccc, FUN_004d33c0's second vector)
  current: [0, 0, 0] as const, // its position
  turn: 0xaaa, // the start turn of emitter k about X and Z: k * 0xaaa BAMS (15 degrees)
  spinZ: [0x5b, -0x5b, 0xb6, -0x5b] as const, // BAMS a frame, emitters 0..3 (0x94 / 0xa0 / 0xac / 0xb8)
  // The six colours (ARGB) of 0x008f9ea0; index 0 until the button that moves
  // bbc is ported.
  colours: [4286054207, 4281545591, 4289927799, 4289927706, 4294921498, 4289940736] as const,
} as const;

// The middle's emitter position: target * distance + (offsetX, 0, 0) + current.
export function middlePosition(): [number, number, number] {
  const [tx, ty, tz] = MIDDLE.target;
  const [cx, cy, cz] = MIDDLE.current;
  return [tx * MIDDLE.distance + MIDDLE.offsetX + cx, ty * MIDDLE.distance + cy, tz * MIDDLE.distance + cz];
}

const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

// The object angles (X, Y, Z, radians) of middle emitter k after `frames`
// updates: X stays at k * 0xaaa, Z starts there and turns by spinZ[k] a frame
// (BAMS, wrapped to 16 bits as the exe's ints are).
export function middleAngles(k: number, frames: number): Orient {
  const z = (k * MIDDLE.turn + Math.imul(MIDDLE.spinZ[k]!, frames)) & 0xffff;
  return [k * MIDDLE.turn * BAMS_TO_RAD, 0, z * BAMS_TO_RAD];
}

export interface WipeParticle {
  spawn: WipeSpawn;
  index: number; // the index within mode 0 (the stagger), or -1
  sys: ParticleSystem;
  x: number; // the current x (mode 0 only moves)
  active: boolean; // shown this frame (SetObjectActiveFlag / ClearFlag0)
}

// The wipe and middle particles of one quest loading screen. Each wipe particle
// is its own system with one emitter, so it can be hidden as a whole.
export class QuestLoadingParticles {
  readonly wipes: WipeParticle[] = [];
  readonly middle: ParticleSystem;
  private assets: QuestLoadingAssets;
  private timer = 0; // +0x224 of mode 0
  private tint = makeTinter();
  private frames = 0;

  constructor(assets: QuestLoadingAssets) {
    this.assets = assets;
    const slots = new Map<number, number>();
    [...assets.effect.keys()].forEach((gbix, slot) => slots.set(gbix, slot));
    let mode0 = 0;
    for (const spawn of wipeSpawns()) {
      const sys = new ParticleSystem();
      // The screen pixels: the projection is 1 and the centre is the origin;
      // the y is negated because the system draws y upwards.
      sys.centre = [0, 0];
      sys.D = 1;
      sys.slots = slots;
      sys.add(parseParticleEntry(assets.particleEntries, spawn.effect), [spawn.x, -spawn.y, -1], null);
      this.wipes.push({ spawn, index: spawn.mode === 0 ? mode0++ : -1, sys, x: spawn.x, active: true });
    }
    this.middle = new ParticleSystem();
    this.middle.slots = slots;
    const entry = parseParticleEntry(assets.particleEntries, MIDDLE.effect);
    const pos = middlePosition();
    for (let k = 0; k < MIDDLE.count; k++) this.middle.add(entry, [...pos], middleAngles(k, 0), MIDDLE.colours[0]);
  }

  // One update: the timer and the mode 0 windows, the middle's spin, then the particles.
  step(): void {
    this.timer = this.timer + 1 < WIPE_CYCLE ? this.timer + 1 : 0;
    for (const w of this.wipes) {
      if (w.spawn.mode !== 0) {
        w.sys.step(true);
        continue;
      }
      const lo = w.index * WIPE_STAGGER;
      const shown = this.timer > lo && this.timer < lo + WIPE_WINDOW;
      w.active = shown;
      w.x = shown ? Math.fround(w.x + WIPE_SPEED) : 0;
      const e = w.sys.emitters[0]!;
      e.pos[0] = w.x;
      e.pos[1] = -w.spawn.y;
      w.sys.step(shown);
    }
    this.frames++;
    for (let k = 0; k < MIDDLE.count; k++) {
      const e = this.middle.emitters[k];
      if (e) e.orient = middleAngles(k, this.frames);
    }
    this.middle.step(true);
  }

  // The shown wipe particles (the mode 0 sweep and the two static groups) and the middle.
  shownWipes(): number {
    return this.wipes.filter((w) => w.active).length;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const texture = (gbix: number) => this.assets.effect.get(gbix) ?? null;
    for (const w of this.wipes) if (w.active) w.sys.draw(ctx, texture, this.tint);
    this.middle.draw(ctx, texture, this.tint);
  }
}

// DrawOutlinedText_00783f50: right-aligned at x, eight black copies 2 px
// around the white one.
export function drawOutlined(ctx: CanvasRenderingContext2D, text: string, right: number, y: number): void {
  const x = right - gameTextWidth(text);
  const o = TEXT_OUTLINE;
  for (const [dx, dy] of [[-o, -o], [0, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [0, o], [o, o]] as const) drawGameText(ctx, text, x + dx, y + dy, '#000000');
  drawGameText(ctx, text, x, y, '#ffffff');
}

// RenderMapEventObject_00783c64: a black outline quad 2 px around, the filled
// part (width * ratio) and the rest.
export function drawBar(ctx: CanvasRenderingContext2D, bar: QuestLoadingBar): void {
  const { x, y, w, h, outline } = BAR;
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - outline, y - outline, w + 2 * outline, h + 2 * outline);
  const done = w * bar.ratio;
  ctx.fillStyle = bar.fill;
  ctx.fillRect(x, y, done, h);
  ctx.fillStyle = bar.rest;
  ctx.fillRect(x + done, y, w - done, h);
  const eta = bar.etaText();
  if (eta) drawOutlined(ctx, eta, ETA_POS.x, ETA_POS.y);
  const pct = bar.percent();
  if (pct) drawOutlined(ctx, pct, PERCENT_POS.x, PERCENT_POS.y);
}

// --- the screen ---------------------------------------------------------------------

const FRAME = 1 / 30;

export class QuestLoadingScreen implements Screen {
  layout = 'stretch' as const;
  readonly bars = new QuestLoadingBars();
  // The wipe and middle particles; none without the particle assets (the bars
  // and lines still draw).
  readonly particles: QuestLoadingParticles | null;
  private acc = 0;
  private calls = 0;

  constructor(assets?: QuestLoadingAssets) {
    this.particles = assets ? new QuestLoadingParticles(assets) : null;
  }

  // The download callback of the quest client: bytes received / total.
  progress(loaded: number, total: number): void {
    this.bars.update(loaded, total);
  }

  update(dt: number): void {
    this.acc += dt;
    while (this.acc >= FRAME) {
      this.acc -= FRAME;
      this.calls++;
      this.bars.step();
      this.particles?.step();
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    const bars = decorationVisible(this.calls);
    if (bars) drawBackdrop(ctx);
    this.particles?.draw(ctx);
    if (bars) drawFrameLines(ctx);
    if (this.bars.bar) drawBar(ctx, this.bars.bar);
  }
}

// The in-game HUD of the local player: the status window in the top-left
// corner (name, level, HP / TP bars with their numbers, the photon blast
// gauge), the "EXP+n" and "Level Up" floating texts and the level-up lines of
// the message window. Everything is drawn in the 640x480 virtual space with
// the client's own textures, after PsoBB.exe (Ephinea 1.25.13, VAs):
//
// The window. CreateChallengeMenuListWindow_007438f0 builds it at window
// position 0x1d of the table at 0x00971f40 = (28, 37), from the template
// g_ChallengeMenuListWindow_Config_009f3c04 = {228, 76, ..., element list
// 0x009f3a20, flags 0xb28}; the element list is {15 rows, 1 column} of
// typed records read by allocate_counted_array_of_text_objects (0x0072xxxx):
//    #  type                  record (offsets relative to the window)
//    0  6 sprite              (27, 16) 34x29, texels (112, 84) of texlist
//                             0x00a983d8 (f256_hyouji.prs) texture 0; its UVs
//                             are re-pointed every frame by
//                             QuickMenuUpdateListItemPosition_0074253c to
//                             (34 * slot, 202), the player's colour badge
//    1  3 text                (124, 67) the player name, flags 4
//    2  4 number              (82, 59) the level, right-aligned
//    3  2 bar                 (90, 24) 120 wide, colour 0xff00ff15, heal
//                             colour 0xff00ca9e, damage colour 0xffff2924
//    4  2 bar                 (90, 48) 120 wide, colour 0xff008cfc, heal
//                             colour 0xff008dee, damage colour 0xffff2924
//    5  3 text "Lv"           (30, 59)     (u"Lv" @ 0x00971f1c)
//    6  3 text "HP"           (90, 9)      (u"HP" @ 0x008fe828)
//    7  4 number current HP   right edge moved, see below
//    8  3 text "/"            (u"/" @ 0x0096f638)
//    9  4 number max HP       right edge (210, 9)
//   10  3 text "TP"           (90, 33)     (u"TP" @ 0x0097318c)
//   11-13 current TP, "/", max TP at y 33 like 7-9
//   14  5 number              (68, 13) the photon blast gauge, centred by
//                             ChallengeMenuListWindow_Render_00743b1c at
//                             68 + width * 0.5 (0x00973184, 0x00973180)
// ChallengeMenuListWindow_UpdateStatusBar_007439e8 moves the current value and
// the "/" to x = max.x - max.width - 12 (0x00973188) every frame.
//
// Texts and numbers with flag 4 use the ASCII atlas of texturejapanese.xvm /
// textureenglish.xvm texture 0: glyph c at texels ((c & 0xf) * 16, c & 0xf0),
// 13 high (0x0097a7b8), with the {advance, y offset} pairs of the table at
// 0x009fce80 (InitializeTextRendering_007896c8; SetTextPositionOffset_007893a4
// places one glyph). Numbers are drawn right to left from their x
// (AutoClass6::unknown_render_text4); their width is 10 per digit
// (get_width_of_numeric_text, 0x00970dcc). A space advances 5 when a string is
// measured (unknown_set_string_buffer).
//
// The background (render_player_hud_bg, 0x00743b60): the photon blast gauge
// first (QuickMenuRenderTextBackgroundInternal_00742bd4: a pie of radius 26
// around window + (44, 30.5) @ 0x0097313c, drawn as fans in 0x800 steps from
// angle 0 to 0xd700 of 0x10000, in colour table 0x00972fa0[level], and the
// part of the next level from 0xd700 * (1 - fraction) to 0xd700 in
// [level + 1]), then the corner piece of texture 13 texels (118, 80)-(187, 160)
// at screen (0, 0)-(69, 80) (it slides in from (-69, -80) while the window
// opens), then the window itself: texture 13 texels (0, 0)-(228, 76).
//
// Bars (ScrollbarObject_Render_0072a2c4 / _RenderThumb_00729c90): texture 13,
// texels v 30..37 (7 high): a 4-texel left cap at u 230, the middle stretched
// from u 237..249, the right cap from u 252; the fill is the bar colour times
// the texture. A change of the value holds the drawn width for 0x24 frames
// (UiElement_UpdateAnimation_00729fa4), then it moves 2 per frame
// (UpdatePosition_00729924, 0x00970ac0); meanwhile the gap is drawn in the
// damage colour (value went down, the solid part ends 1 short) or the heal
// colour (value went up). The bar colour fades over 11.1 frames
// (QuickMenuTPBar_InterpolateColor_0072a4d8) to 0xfff2ff19 (HP) / 0xffffc114
// (TP) when the value is at or under 20% of the maximum (0x0097308c,
// 0x00973084), and the HP / TP texts take the same colour (white otherwise).

import { drawGameText, gameTextWidth } from './gametext.ts';
import { clipReveal, WindowAnim, withWindowAnim } from './windowanim.ts';

export const STATUS_WINDOW = { x: 28, y: 37, w: 228, h: 76 } as const;

// Draw order of the 2D overlays (CSS z-index of their canvases). Every list
// window, the status window included, is a child of the player's UI element
// array (ListWindowObject_Constructor_00710d30 ->
// ListWindowObject_GetUIElementArray_00719930); base_game_object_constructor
// (0x008193cc) appends a child at the tail of its parent's list and the
// render walk (recursive_game_object_3rd_method_caller) goes head to tail, so
// a window drawn later is the one created later. The status window is created
// with the player's HUD (SinowberillChallengeMenuWindow_Constructor_0071a3d0)
// when the floor loads; the main menu and the shop / bank counter windows are
// created afterwards, so they cover it. Nothing hides the status window for a
// counter: it closes only on bits 1 / 0x10 of the HUD's flags
// (SinowberillChallengeObjectListWindow_HandleCancel_0071a838; set by the
// full map, ChallengeMenuListWindow_UpdateSelectionColor_007441a8, and the
// quest board, ChallengePlayerListWindow_Constructor_00754294), and the
// counters touch neither.
export const STATUS_LAYER = 2;
export const MENU_LAYER = STATUS_LAYER + 1;
// The quest's text windows (quest/questui.ts): created by the script after
// the HUD and the menu, so the quest board text (disp_msg_qb) is drawn over
// the main menu's Quest Board window (classic/questboard.ts).
export const QUEST_LAYER = MENU_LAYER + 1;

// Glyph table at 0x009fce80: {advance, y offset} for ASCII 0x20..0x7f.
// prettier-ignore
const GLYPHS: readonly (readonly [number, number])[] = [
  [6, 0], [6, 0], [10, 0], [11, 0], [11, 0], [15, 0], [13, 0], [6, 0], [7, 0], [7, 0], [11, 0], [11, 0], [6, 0], [11, 0], [6, 0], [12, 0],
  [10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [10, 0], [5, 0], [5, 0], [11, 0], [11, 0], [12, 0], [11, 0],
  [14, 0], [13, 0], [12, 0], [13, 0], [12, 0], [11, 0], [11, 0], [13, 0], [12, 0], [9, 0], [10, 0], [11, 0], [11, 0], [13, 0], [12, 0], [12, 0],
  [11, 0], [13, 0], [12, 0], [11, 0], [12, 0], [12, 0], [13, 0], [15, 0], [13, 0], [14, 0], [11, 0], [8, 0], [11, 0], [8, 0], [10, 0], [9, 0],
  [5, 0], [11, 0], [11, 0], [10, 0], [11, 0], [10, 0], [9, 0], [10, 3], [10, 0], [5, 0], [9, 1], [11, 0], [5, 0], [13, 0], [10, 0], [11, 0],
  [10, 3], [10, 3], [9, 0], [10, 0], [9, 0], [10, 0], [12, 0], [14, 0], [12, 0], [12, 3], [10, 0], [7, 0], [5, 0], [7, 0], [12, 0], [0, 0],
];
export const GLYPH_HEIGHT = 13; // 0x0097a7b8
export const DIGIT_WIDTH = 10; // 0x00970dcc

function glyph(ch: string): readonly [number, number] {
  const c = ch.charCodeAt(0);
  return GLYPHS[c - 0x20] ?? GLYPHS[0];
}

// Width of a string as unknown_set_string_buffer measures it (space = 5).
export function glyphTextWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += ch === ' ' ? 5 : glyph(ch)[0];
  return w;
}

// Width of a number as get_width_of_numeric_text measures it with flag 4.
export function numberWidth(n: number): number {
  const digits = String(Math.max(0, Math.trunc(n))).length;
  return digits < 2 ? 10 : digits * DIGIT_WIDTH;
}

// --- texture modulation ------------------------------------------------------

export type Argb = number;

const css = (argb: Argb) => `rgb(${(argb >>> 16) & 0xff}, ${(argb >>> 8) & 0xff}, ${argb & 0xff})`;
const alphaOf = (argb: Argb) => ((argb >>> 24) & 0xff) / 255;

const sourceIds = new WeakMap<object, number>();
let nextSourceId = 1;
const tintCache = new Map<string, OffscreenCanvas>();

// A texture region times a vertex colour (the D3D modulate the client draws
// its HUD with): multiply the RGB, keep the texture's alpha.
function tinted(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, rgb: Argb): CanvasImageSource | OffscreenCanvas {
  // (No OffscreenCanvas, e.g. under Node in the tests: draw untinted.)
  if ((rgb & 0xffffff) === 0xffffff || typeof OffscreenCanvas === 'undefined') return src;
  let id = sourceIds.get(src as object);
  if (!id) sourceIds.set(src as object, (id = nextSourceId++));
  const key = `${id}|${sx}|${sy}|${sw}|${sh}|${rgb & 0xffffff}`;
  let c = tintCache.get(key);
  if (c) return c;
  if (tintCache.size > 512) tintCache.clear();
  c = new OffscreenCanvas(Math.max(1, sw), Math.max(1, sh));
  const g = c.getContext('2d')!;
  g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = css(rgb);
  g.fillRect(0, 0, sw, sh);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  tintCache.set(key, c);
  return c;
}

// Draws texels (sx, sy, sw, sh) of `src` into (dx, dy, dw, dh) times `argb`.
export function drawModulated(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  argb: Argb = 0xffffffff,
): void {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  const a = alphaOf(argb);
  if (a <= 0) return;
  const img = tinted(src, sx, sy, sw, sh, argb);
  ctx.save();
  ctx.globalAlpha *= a;
  if (img === src) ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
  else ctx.drawImage(img, 0, 0, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

// --- glyph text --------------------------------------------------------------

// One glyph of the ASCII atlas at (x, y) (SetTextPositionOffset_007893a4),
// scaled by `scale` from its top-left like FloatingTextObjectRender_0078abd0.
function drawGlyph(ctx: CanvasRenderingContext2D, font: CanvasImageSource, ch: string, x: number, y: number, argb: Argb, scale = 1): number {
  const c = ch.charCodeAt(0) & 0xff;
  const [w, yoff] = glyph(ch);
  if (ch !== ' ' && w > 0) {
    drawModulated(ctx, font, (c & 0xf) << 4, c & 0xf0, w, GLYPH_HEIGHT, x, y + yoff, w * scale, GLYPH_HEIGHT * scale, argb);
  }
  return w;
}

// Left-aligned text (unknown_render_texturejapanese_xvm_font2 /
// render_texturejapanese_xvm_text).
export function drawGlyphText(ctx: CanvasRenderingContext2D, font: CanvasImageSource, text: string, x: number, y: number, argb: Argb = 0xffffffff): void {
  for (const ch of text) x += drawGlyph(ctx, font, ch, x, y, argb);
}

// A number whose right edge is x (AutoClass6::unknown_render_text4).
export function drawGlyphNumber(ctx: CanvasRenderingContext2D, font: CanvasImageSource, n: number, right: number, y: number, argb: Argb = 0xffffffff): void {
  const s = String(Math.max(0, Math.trunc(n)));
  let x = right;
  for (let i = s.length - 1; i >= 0; i--) {
    x -= glyph(s[i])[0];
    drawGlyph(ctx, font, s[i], x, y, argb);
  }
}

// An element of a window under its opening wipe: drawn clipped to the part
// that shows, from its left edge (x, y relative to the window; `w` the
// content width, the window's own with flag 0x800).
function wiped(ctx: CanvasRenderingContext2D, anim: WindowAnim, w: number, ex: number, ey: number, left: number, top: number, draw: () => void): void {
  const r = anim.reveal(ex, ey, w);
  ctx.save();
  if (clipReveal(ctx, left, top, r, GLYPH_HEIGHT + 4)) draw();
  ctx.restore();
}

// --- bars --------------------------------------------------------------------

// HP / TP bar colours of the template and the update functions.
export const BAR_COLORS = {
  hp: { normal: 0xff00ff15, low: 0xfff2ff19, heal: 0xff00ca9e, damage: 0xffff2924, text: 0xffffffff, lowText: 0xfff2ff19 },
  tp: { normal: 0xff008cfc, low: 0xffffc114, heal: 0xff008dee, damage: 0xffff2924, text: 0xffffffff, lowText: 0xffffc114 },
} as const;
export const LOW_FRACTION = 0.2; // 0x0097308c / 0x00973084
export const BAR_HOLD_FRAMES = 0x24;
export const BAR_STEP = 2; // 0x00970ac0 / 0x00970abc
export const COLOR_FADE_FRAMES = 11.1; // 0x00973080
export const BAR_WIDTH = 120;
export const BAR_HEIGHT = 7; // 0x00970a5c

// One bar element (type 2) and its animation state.
export class BarState {
  readonly width: number;
  max = 0; // +0x20
  value = 0; // +0x24
  shown = 0; // +0x1c, the drawn width
  private last = 0; // +0x28, the value the drawn width belongs to
  private hold = 0; // +0x2a
  color: Argb; // +0x18
  private target: Argb; // +0x2c
  private rgb: [number, number, number]; // +0x44.. while fading
  private step: [number, number, number] = [0, 0, 0]; // +0x54..
  private fading = false; // flag 0x40

  constructor(color: Argb, width = BAR_WIDTH) {
    this.width = width;
    this.color = color;
    this.target = color;
    this.rgb = [(color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff];
  }

  widthOf(value: number): number {
    return this.max > 0 && value > 0 ? (this.width * value) / this.max : 0;
  }

  // QuickMenuTPBar_InterpolateColor_0072a4d8.
  fadeTo(argb: Argb, frames = COLOR_FADE_FRAMES): void {
    if (argb === this.target) return;
    this.target = argb;
    const t = [(argb >>> 16) & 0xff, (argb >>> 8) & 0xff, argb & 0xff];
    const c = [(this.color >>> 16) & 0xff, (this.color >>> 8) & 0xff, this.color & 0xff];
    this.rgb = [c[0], c[1], c[2]];
    this.step = [(t[0] - c[0]) / frames, (t[1] - c[1]) / frames, (t[2] - c[2]) / frames];
    this.fading = true;
  }

  // One frame of UiElement_UpdateAnimation_00729fa4.
  tick(): void {
    if (this.fading) {
      const t = [(this.target >>> 16) & 0xff, (this.target >>> 8) & 0xff, this.target & 0xff];
      let done = true;
      for (let i = 0; i < 3; i++) {
        const next = this.rgb[i] + this.step[i];
        const v = this.step[i] >= 0 ? Math.min(t[i], next) : Math.max(t[i], next);
        this.rgb[i] = Math.max(0, Math.min(255, v));
        if (this.rgb[i] !== t[i]) done = false;
      }
      if (done) {
        this.fading = false;
        this.color = this.target;
      } else {
        this.color = (0xff000000 | (Math.round(this.rgb[0]) << 16) | (Math.round(this.rgb[1]) << 8) | Math.round(this.rgb[2])) >>> 0;
      }
    }
    if (this.last !== this.value) {
      // Hold the width of the old value, then start moving.
      this.shown = Math.min(this.width, this.widthOf(this.last));
      this.last = Math.round(this.value);
      this.hold = BAR_HOLD_FRAMES;
    }
    if (this.hold > 0) {
      this.hold--;
      return;
    }
    // UpdatePosition_00729924.
    const target = this.widthOf(this.value);
    const diff = target - this.shown;
    if (Math.abs(diff) >= BAR_STEP) this.shown += diff <= 0 ? -BAR_STEP : BAR_STEP;
    else this.shown = target;
  }
}

// ScrollbarObject_RenderThumb_00729c90: a fill `w` wide at (x, y).
function drawBarFill(ctx: CanvasRenderingContext2D, tex: CanvasImageSource, x: number, y: number, w: number, width: number, argb: Argb): void {
  if (w <= 0) return;
  const cap = Math.min(w, 4);
  drawModulated(ctx, tex, 230, 30, cap, BAR_HEIGHT, x, y, cap, BAR_HEIGHT, argb);
  if (w <= 4) return;
  const midEnd = w >= width - 4 ? width - 8 : w - 4;
  drawModulated(ctx, tex, 237, 30, 12, BAR_HEIGHT, x + 4, y, midEnd, BAR_HEIGHT, argb);
  if (w <= width - 4) return;
  const end = 4 - width + w;
  drawModulated(ctx, tex, 252, 30, end, BAR_HEIGHT, x + width - 4, y, end, BAR_HEIGHT, argb);
}

// ScrollbarObject_Render_0072a2c4; `limit` is the window-opening wipe's
// width (classic/windowanim.ts): both fills are cut to it.
export function drawBar(ctx: CanvasRenderingContext2D, tex: CanvasImageSource, bar: BarState, x: number, y: number, colors: { heal: Argb; damage: Argb }, limit = Infinity): void {
  const target = bar.widthOf(bar.value);
  let long: number;
  let short: number;
  let under: Argb;
  if (target < bar.shown) {
    long = bar.shown;
    short = target - 1;
    under = colors.damage;
  } else {
    long = target;
    short = bar.shown;
    under = colors.heal;
  }
  if (limit <= 0) return;
  long = Math.min(long, limit);
  short = Math.min(short, limit);
  if (long <= 0) return;
  drawBarFill(ctx, tex, x, y, long, bar.width, under);
  drawBarFill(ctx, tex, x, y, short, bar.width, bar.color);
}

// --- photon blast gauge ------------------------------------------------------

// Colour table 0x00972fa0, indexed by the gauge level (whole hundreds).
export const PB_COLORS: readonly Argb[] = [0xff3c3c3c, 0xffd8cf00, 0xffd88a00, 0xffd84500, 0xffd80000, 0xffffffff];
const ARC_END = 0xd700; // of 0x10000 per turn
const ARC_STEP = 0x800;

function pie(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, from: number, to: number, argb: Argb): void {
  if (to <= from) return;
  ctx.save();
  ctx.fillStyle = css(argb);
  ctx.globalAlpha *= alphaOf(argb);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  // The client steps in 0x800 units; the polygon edge is the same.
  for (let a = from; ; a = Math.min(to, a + ARC_STEP)) {
    const rad = (a / 0x10000) * Math.PI * 2;
    ctx.lineTo(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r);
    if (a >= to) break;
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// QuickMenuRenderTextBackgroundInternal_00742bd4 with the local window's
// arguments: centre window + (44, 30.5), radius 26, gauge 0..500.
export function drawPbGauge(ctx: CanvasRenderingContext2D, wx: number, wy: number, gauge: number): void {
  const v = Math.min(Math.max(0, gauge), 500);
  const level = Math.floor(v * 0.01);
  const cx = wx + 44;
  const cy = wy + 30.5;
  pie(ctx, cx, cy, 26, 0, ARC_END, PB_COLORS[level] ?? PB_COLORS[0]);
  const start = Math.round(ARC_END + (v - level * 100) * ARC_END * -0.01);
  pie(ctx, cx, cy, 26, start, ARC_END, PB_COLORS[level + 1] ?? PB_COLORS[PB_COLORS.length - 1]);
}

// --- the window --------------------------------------------------------------

export interface HudTextures {
  panel: CanvasImageSource; // f256_hyouji.prs texture 13
  icons: CanvasImageSource; // f256_hyouji.prs texture 0
  font: CanvasImageSource; // textureenglish.xvm / texturejapanese.xvm texture 0
  status?: CanvasImageSource; // f256_hyouji.prs texture 1 (status icons)
}

export interface StatusValues {
  name: string;
  slot: number; // lobby client id: the colour badge
  level: number; // displayed (1-based)
  hp: number;
  maxHp: number;
  tp: number;
  maxTp: number;
  pb: number; // photon blast gauge
  dead: boolean;
  // PlayerVisualConfig name_color (ARGB, the player's +0x948).
  nameColor?: Argb;
  // get_monster_status icons of the player's status slots, in slot order
  // (combat/buffs.ts statusIcon).
  statusIcons?: readonly number[];
}

// The hit shake of a player's window (QuickMenuStatusBarUpdateHP_007422c4
// sets +0x60 = 4 when the HP went down; QuickMenuUpdateListItemFloatingOffset
// _007429b0 then moves the render position by a random step each frame:
// angle = rand / 32768 * 65536 (0x00973050 / 0x00973054), distance =
// rand / 32768 * 5 (0x0097304c), on top of the position the render
// transition just reset it to, so the window jitters for 4 frames).
export const SHAKE_FRAMES = 4;
export const SHAKE_DISTANCE = 5;
export type Rng = () => number; // [0, 1), like rand() / 32768

export class WindowShake {
  frames = 0;
  x = 0;
  y = 0;

  start(): void {
    this.frames = SHAKE_FRAMES;
  }

  tick(rng: Rng = Math.random): void {
    this.x = 0;
    this.y = 0;
    if (this.frames <= 0) return;
    this.frames--;
    const angle = Math.round(rng() * 65536);
    const d = rng() * SHAKE_DISTANCE;
    const rad = (angle / 0x10000) * Math.PI * 2;
    this.x = Math.cos(rad) * d;
    this.y = Math.sin(rad) * d;
  }
}

// HUD flag bits that close the status window (0x0071a838).
export const STATUS_HIDING_FLAGS = 0x11;

// The status window's state across frames (bars and their colours).
export class StatusWindow {
  readonly hp = new BarState(BAR_COLORS.hp.normal);
  readonly tp = new BarState(BAR_COLORS.tp.normal);
  readonly shake = new WindowShake();
  // Template flags 0xb28: silent (0x20), no inset (0x800). ASSUMED: it opens
  // with the HUD when the floor loads.
  readonly anim = new WindowAnim(true, false);
  speed = 1; // the window speed option (classic/windowanim.ts)
  // The HUD's flags (+0x1c): with bit 1 (the full map, classic/areamap.ts) or
  // 0x10 (the quest board) set the window closes, else it (re)opens
  // (SinowberillChallengeObjectListWindow_HandleCancel_0071a838, each frame).
  hudFlags = 0;
  hpText: Argb = BAR_COLORS.hp.text;
  tpText: Argb = BAR_COLORS.tp.text;
  values: StatusValues = { name: '', slot: 0, level: 1, hp: 0, maxHp: 0, tp: 0, maxTp: 0, pb: 0, dead: false };

  // One 30 Hz frame: QuickMenuStatusBarUpdateHP_007422c4 /
  // QuickMenuTPBarUpdate_00742378 then the bar animations and the shake.
  tick(v: StatusValues, rng: Rng = Math.random): void {
    this.values = v;
    const hpLow = v.hp <= v.maxHp * LOW_FRACTION;
    if (v.hp < this.hp.value) this.shake.start();
    this.hp.max = v.maxHp;
    this.hp.value = v.hp;
    this.hp.fadeTo(hpLow ? BAR_COLORS.hp.low : BAR_COLORS.hp.normal);
    this.hpText = hpLow ? BAR_COLORS.hp.lowText : BAR_COLORS.hp.text;
    const tpLow = v.tp <= v.maxTp * LOW_FRACTION;
    this.tp.max = v.maxTp;
    this.tp.value = v.tp;
    this.tp.fadeTo(tpLow ? BAR_COLORS.tp.low : BAR_COLORS.tp.normal);
    this.tpText = tpLow ? BAR_COLORS.tp.lowText : BAR_COLORS.tp.text;
    this.hp.tick();
    this.tp.tick();
    this.shake.tick(rng);
    if (this.hudFlags & STATUS_HIDING_FLAGS) this.anim.close();
    else if (!this.anim.isOpen) this.anim.open(this.speed);
    this.anim.tick(this.speed);
  }

  draw(ctx: CanvasRenderingContext2D, tex: HudTextures, wx = STATUS_WINDOW.x, wy = STATUS_WINDOW.y): void {
    const v = this.values;
    wx += this.shake.x;
    wy += this.shake.y;
    const a = this.anim;
    const W = STATUS_WINDOW.w;
    const text = (ex: number, ey: number, left: number, draw: () => void) => wiped(ctx, a, W, ex, ey, wx + left, wy + ey, draw);
    withWindowAnim(ctx, a, wx, wy, STATUS_WINDOW.w, STATUS_WINDOW.h, () => {
      // render_player_hud_bg: gauge, corner piece, window.
      drawPbGauge(ctx, wx, wy, v.pb);
      drawModulated(ctx, tex.panel, 118, 80, 69, 80, 0, 0, 69, 80);
      drawModulated(ctx, tex.panel, 0, 0, 228, 76, wx, wy, 228, 76);
      // Elements in list order.
      drawModulated(ctx, tex.icons, 34 * (v.slot & 3), 202, 34, 29, wx + 27, wy + 16, 34, 29);
      // Name: the player's name colour (+0x948), red while dead
      // (QuickMenuUpdatePlayerInfo_00742454).
      text(124, 67, 124, () => drawGlyphText(ctx, tex.font, v.name, wx + 124, wy + 67, v.dead ? 0xffff0000 : (v.nameColor ?? 0xffffffff)));
      text(82, 59, 82 - numberWidth(v.level), () => drawGlyphNumber(ctx, tex.font, v.level, wx + 82, wy + 59));
      drawBar(ctx, tex.panel, this.hp, wx + 90, wy + 24, BAR_COLORS.hp, a.reveal(90, 24, W));
      drawBar(ctx, tex.panel, this.tp, wx + 90, wy + 48, BAR_COLORS.tp, a.reveal(90, 48, W));
      text(30, 59, 30, () => drawGlyphText(ctx, tex.font, 'Lv', wx + 30, wy + 59));
      this.drawValue(ctx, tex.font, 'HP', v.hp, v.maxHp, wx, wy, 9, this.hpText, text);
      this.drawValue(ctx, tex.font, 'TP', v.tp, v.maxTp, wx, wy, 33, this.tpText, text);
      // Element 14: the gauge number, centred on x 68.
      const pb = Math.min(Math.max(0, Math.round(v.pb)), 500);
      text(68, 13, 68 - numberWidth(pb) * 0.5, () => drawGlyphNumber(ctx, tex.font, pb, wx + 68 + numberWidth(pb) * 0.5, wy + 13));
      if (tex.status) drawStatusIcons(ctx, tex.status, v.statusIcons ?? [], wx, wy);
    });
  }

  private drawValue(
    ctx: CanvasRenderingContext2D,
    font: CanvasImageSource,
    label: string,
    value: number,
    max: number,
    wx: number,
    wy: number,
    ey: number,
    argb: Argb,
    text: (ex: number, ey: number, left: number, draw: () => void) => void,
  ): void {
    const y = wy + ey;
    text(90, ey, 90, () => drawGlyphText(ctx, font, label, wx + 90, y, argb));
    text(210, ey, 210 - numberWidth(max), () => drawGlyphNumber(ctx, font, max, wx + 210, y, argb));
    const x = 210 - numberWidth(max) - 12;
    text(x, ey, x, () => drawGlyphText(ctx, font, '/', wx + x, y, argb));
    text(x, ey, x - numberWidth(value), () => drawGlyphNumber(ctx, font, value, wx + x, y, argb));
  }
}

// --- status icons ------------------------------------------------------------

// QuickMenuUpdateShiftaStatusIcons_007426d8 (run by the status window's update,
// QuickMenuUpdateUI_00742248) keeps one small window per occupied status slot
// of the player (+0x25c, +0x268, +0x274 attack technique, +0x280 defense
// technique, 0xc apart), after a photon blast icon when one is ready. Each is
// the template 0x009f1fdc {32 x 28, element list 0x009f1fa4: one sprite at
// (0, 0) of texlist 0x00a983d8 = f256_hyouji.prs} created by
// unknown_create_player_hud_freeze_icon at GUI position 0x1e = (226, 37) plus
// the status window's render position (+0x40 / +0x44) plus 16 per icon
// already shown (0x0096fdf4 / 0x0096fdf0). ui_target_window_status picks the
// sprite: icon 14 hides it, icons < 10 use texture 1, others texture 2, at
// the texels of the table 0x0096fd20 (i * 2 floats).
// ASSUMED: the status window's render position is its position (28, 37), so
// the first icon sits at (254, 74).
export const STATUS_ICON_POS = { x: 226, y: 37 } as const;
export const STATUS_ICON_STEP = 16;
export const STATUS_ICON_SIZE = { w: 32, h: 28 } as const;
// prettier-ignore
const STATUS_ICON_TEXELS: readonly (readonly [number, number])[] = [
  [0, 180], [32, 180], [64, 180], [96, 180], [128, 180],
  [0, 208], [32, 208], [64, 208], [96, 208], [128, 208],
];

export function statusIconTexel(icon: number): readonly [number, number] | null {
  return STATUS_ICON_TEXELS[icon] ?? null;
}

export function drawStatusIcons(ctx: CanvasRenderingContext2D, tex: CanvasImageSource, icons: readonly number[], wx: number, wy: number): void {
  let k = 0;
  for (const icon of icons) {
    const t = statusIconTexel(icon);
    if (!t) continue;
    const x = wx + STATUS_ICON_POS.x + k * STATUS_ICON_STEP;
    drawModulated(ctx, tex, t[0], t[1], STATUS_ICON_SIZE.w, STATUS_ICON_SIZE.h, x, wy + STATUS_ICON_POS.y, STATUS_ICON_SIZE.w, STATUS_ICON_SIZE.h);
    k++;
  }
}

// --- party members' windows ----------------------------------------------------

// The other players' small windows under the status window. The player's
// HUD (QuickmenuobjectConstructor_00716354) creates three of them on any map
// but the lobby (CreateQuestListEntry_0073ea0c(i), i = 0..2), for the client
// slots (own slot + 1 + i) & 3, each a ChallengeMenuListWindow (base
// constructor 0x00742174) with the vtable 0x00b41250 at GUI position 0xbc =
// (30, 116) of the table at 0x00971f40, template 0x009f335c = {114, 46,
// element list 0x009f32a0, flags 0xb28}. Its update (0x0073ead8) runs
// QuickMenuClearSelection_00742430 (name), QuestListEntryUpdate_0073eb28
// (QuickMenuStatusBarUpdateHP_007422c4 + QuickMenuLevelUpdate_00742404),
// QuickMenuUpdateListItemPosition_0074253c (badge), the status icons at GUI
// 0xbd = (117, 7), the render transition and the hit shake; its render
// (QuestListEntryRender_0073eb3c -> 0x0073eb60) draws texture 13 texels
// (0, 180)-(114, 226) (UVs 0 / 0.703125 / 0.4453125 / 0.8828125) at the
// render position, 114 x 46 (0x00971f14 / 0x00971f10), then the elements:
//    #  type        record (relative to the window)
//    0  6 sprite    (7, 7) 34x29 of f256_hyouji.prs texture 0, re-pointed to
//                   (34 * slot, 202) like the status window's badge
//    1  3 text      (45, 40) the player's name, flags 4
//    2  4 number    (100, 19) the level (right edge)
//    3  2 bar       (44, 7) 57 wide, 0xff00ff15, heal 0xff00ca9e, damage
//                   0xffff2924 (the status window's HP bar rules)
//    4  3 text "Lv" (48, 19)
// QuickMenuObject_UpdatePlayerListStates_00716858 stacks the windows: from
// y = 116 (get_gui_position_y(0xbc)), each window whose player is present
// gets that y as its source position (with a 15-frame move, +0x50 = 0xf, when
// it changed) and the next one is 55 lower (0x0096fe78); a window whose
// player is gone is closed (play_sfx_for_closing_list_menu). The move
// (SinowberillChallengeObjectListWindow_UpdateRenderTransition_00710ee4):
// render += (source - render) / n each frame while n counts down.
export const PARTY_WINDOW = { x: 30, y: 116, w: 114, h: 46 } as const;
export const PARTY_SPACING = 55;
export const PARTY_MOVE_FRAMES = 15;
export const PARTY_BAR_WIDTH = 57;
export const PARTY_ICON_POS = { x: 117, y: 7 } as const;
export const PARTY_WINDOWS = 3;

export interface PartyValues {
  name: string;
  level: number; // displayed (1-based)
  hp: number;
  maxHp: number;
  dead: boolean;
  nameColor?: Argb;
  statusIcons?: readonly number[];
}

export class PartyWindow {
  readonly slot: number;
  readonly hp = new BarState(BAR_COLORS.hp.normal, PARTY_BAR_WIDTH);
  readonly shake = new WindowShake();
  values: PartyValues | null = null;
  // What the window showed last (drawn while it closes).
  private last: PartyValues | null = null;
  // Template flags 0xb28: silent, no inset. It opens when its player is
  // there (SinowberillChallengeObjectListWindow_UpdateListItemState_00712714)
  // and closes when not (play_sfx_for_closing_list_menu).
  readonly anim = new WindowAnim(true, false);
  speed = 1;
  // Source and render y (+0x34 / +0x44) and the move counter (+0x50).
  y: number = PARTY_WINDOW.y;
  renderY: number = PARTY_WINDOW.y;
  private move = 0;

  constructor(slot: number) {
    this.slot = slot;
  }

  get shown(): boolean {
    return this.values !== null;
  }

  // QuickMenuObject_UpdatePlayerListStates_00716858's placement.
  place(y: number): void {
    if (y === this.y) return;
    this.y = y;
    this.move = PARTY_MOVE_FRAMES;
  }

  // One 30 Hz frame of the window's update (0x0073ead8).
  tick(v: PartyValues | null, rng: Rng = Math.random): void {
    this.values = v;
    if (v) this.last = v;
    if (v) this.anim.open(this.speed);
    else this.anim.close();
    this.anim.tick(this.speed);
    if (v) {
      if (v.hp < this.hp.value) this.shake.start();
      this.hp.max = v.maxHp;
      this.hp.value = v.hp;
      this.hp.fadeTo(v.hp <= v.maxHp * LOW_FRACTION ? BAR_COLORS.hp.low : BAR_COLORS.hp.normal);
    } else {
      // QuickMenuStatusBarReset_00742120.
      this.hp.max = 0;
      this.hp.value = 0;
      this.hp.fadeTo(BAR_COLORS.hp.normal, 1);
    }
    if (this.move > 0) {
      this.renderY += (this.y - this.renderY) / this.move;
      this.move--;
    } else {
      this.renderY = this.y;
    }
    this.hp.tick();
    this.shake.tick(rng);
  }

  draw(ctx: CanvasRenderingContext2D, tex: HudTextures): void {
    const v = this.values ?? this.last;
    if (!v || !this.anim.visible) return;
    const wx = PARTY_WINDOW.x + this.shake.x;
    const wy = this.renderY + this.shake.y;
    const a = this.anim;
    const W = PARTY_WINDOW.w;
    const text = (ex: number, ey: number, left: number, draw: () => void) => wiped(ctx, a, W, ex, ey, wx + left, wy + ey, draw);
    withWindowAnim(ctx, a, wx, wy, PARTY_WINDOW.w, PARTY_WINDOW.h, () => {
      drawModulated(ctx, tex.panel, 0, 180, 114, 46, wx, wy, PARTY_WINDOW.w, PARTY_WINDOW.h);
      drawModulated(ctx, tex.icons, 34 * (this.slot & 3), 202, 34, 29, wx + 7, wy + 7, 34, 29);
      text(45, 40, 45, () => drawGlyphText(ctx, tex.font, v.name, wx + 45, wy + 40, v.dead ? 0xffff0000 : (v.nameColor ?? 0xffffffff)));
      text(100, 19, 100 - numberWidth(v.level), () => drawGlyphNumber(ctx, tex.font, v.level, wx + 100, wy + 19));
      drawBar(ctx, tex.panel, this.hp, wx + 44, wy + 7, BAR_COLORS.hp, a.reveal(44, 7, W));
      text(48, 19, 48, () => drawGlyphText(ctx, tex.font, 'Lv', wx + 48, wy + 19));
      if (tex.status) drawStatusIcons(ctx, tex.status, v.statusIcons ?? [], wx + PARTY_ICON_POS.x - STATUS_ICON_POS.x, wy + PARTY_ICON_POS.y - STATUS_ICON_POS.y);
    });
  }
}

// The three windows of the local player's HUD.
export class PartyWindows {
  readonly windows: PartyWindow[] = [];
  private self = -1;

  // The slots follow the local client id (CreateQuestListEntry_0073ea0c).
  setSelf(slot: number): void {
    if (slot === this.self) return;
    this.self = slot;
    this.windows.length = 0;
    for (let i = 0; i < PARTY_WINDOWS; i++) this.windows.push(new PartyWindow((slot + 1 + i) & 3));
  }

  speed = 1;

  tick(values: (slot: number) => PartyValues | null, rng: Rng = Math.random): void {
    let y: number = PARTY_WINDOW.y;
    for (const w of this.windows) {
      w.speed = this.speed;
      const v = values(w.slot);
      if (v) {
        w.place(y);
        y += PARTY_SPACING;
      }
      w.tick(v, rng);
    }
  }

  draw(ctx: CanvasRenderingContext2D, tex: HudTextures): void {
    for (const w of this.windows) w.draw(ctx, tex);
  }
}

// --- floating texts ----------------------------------------------------------

// The floating text object (unknown_display_floating_text_effect @ 0x0078a7xx,
// FloatingTextObject_Update_0078ab74, FloatingTextObjectRender_0078abd0):
// hidden for `delay` frames, then rises 1.4 per frame (0x0097a8f4) for
// `duration` frames; each glyph fades in over 2 frames (0x0097a8d4, alpha
// t * 255 * 0.5) one after the other (5.5 frames across the string,
// 0x0097a8c8), the whole text fades out over the last 8 frames (0x0097a8e0,
// 0x0097a8d8), and the glyphs are 1.4x (GetChatBubbleOrDamageNumberScale_0078a5c4,
// 0x0097a910), centred on the anchor.
export const FLOAT_SCALE = 1.4;
export const FLOAT_RISE = 1.4;

export interface FloatingText {
  text: string;
  rgb: Argb;
  anchor: () => { x: number; y: number } | null; // virtual-screen position each frame
  delay: number;
  duration: number;
  age: number;
  rise: number;
  kind: 'float' | 'levelup';
}

// "EXP+n" over a killed enemy: handle_experience calls
// display_special_attack_text_effect(pos, 0xffff00ff, 0x14, 0x14, u"EXP", n).
export function expText(amount: number, anchor: FloatingText['anchor']): FloatingText {
  return { text: `EXP${amount >= 0 ? '+' : ''}${amount}`, rgb: 0xff00ff, anchor, delay: 0x14, duration: 0x14, age: 0, rise: 0, kind: 'float' };
}

// "Level Up" / "Level Down" over a player's head: DisplayLevelUpMessage_00692aa4
// -> CreateJapaneseCharacterEntity_00789758(slot, white, 0x3c frames, text);
// unknown_player_levelup_text_related fades it in over 6 frames (0x0097a828,
// 1/6 @ 0x0097a820) and out over the last 6, unscaled, centred
// (x + width * -0.5, 0x0097a80c).
export function levelUpText(down: boolean, anchor: FloatingText['anchor']): FloatingText {
  return { text: down ? 'Level Down' : 'Level Up', rgb: 0xffffff, anchor, delay: 0, duration: 0x3c, age: 0, rise: 0, kind: 'levelup' };
}

export class FloatingTexts {
  private items: FloatingText[] = [];

  add(t: FloatingText): void {
    this.items.push(t);
  }

  get size(): number {
    return this.items.length;
  }

  tick(): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const t = this.items[i];
      if (t.kind === 'float') {
        if (t.delay > 0) {
          t.delay--;
          continue;
        }
        t.rise -= FLOAT_RISE;
        t.age++;
      } else {
        t.age++;
      }
      if (t.age >= t.duration) this.items.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D, font: CanvasImageSource): void {
    for (const t of this.items) {
      if (t.kind === 'float' && t.delay > 0) continue;
      const at = t.anchor();
      if (!at) continue;
      const width = glyphTextWidth(t.text);
      if (t.kind === 'levelup') {
        let f = t.age;
        if (t.duration > 0 && f > t.duration - 6) f = t.duration - t.age;
        const a = f >= 6 ? 255 : Math.round(f * 255 * (1 / 6));
        drawGlyphText(ctx, font, t.text, at.x + width * -0.5, at.y, ((a << 24) | t.rgb) >>> 0);
        continue;
      }
      const fade = t.age <= t.duration - 8 ? 1 : (t.duration - t.age) * 0.125;
      let x = at.x - width * 0.5 * FLOAT_SCALE;
      const y = at.y + t.rise;
      let phase = t.age;
      for (const ch of t.text) {
        const [w] = glyph(ch);
        if (phase > 0) {
          const a0 = phase >= 2 ? 255 : Math.round(phase * 255 * 0.5);
          const a = Math.max(0, Math.min(255, Math.round(a0 * fade)));
          drawGlyph(ctx, font, ch, x, y, ((a << 24) | t.rgb) >>> 0, FLOAT_SCALE);
        }
        x += w * FLOAT_SCALE;
        phase += (w / Math.max(1, width)) * -5.5;
      }
    }
  }
}

// --- message window ---------------------------------------------------------

// The player's message window (window position 0x22 = (373, 203) of the table
// at 0x00971f40): CreateChatShortcutMenuYesNoListWindow_0073b3a0 with the size
// {255, 120} (unknown_b0_window_params @ 0x0096ffd8) and 0x10 lines
// (SetListWindowRenderParameters_0073b1e8 into the template 0x009f3268,
// flags 3: no frame of its own, ChatShortcutMenuYesNoListWindow_UpdateRender
// _0073b470 draws only the text; content inset 10 like every window without
// flag 0x800, UiTextGeometryUpdate_0071b900, clipped to that rectangle; one
// system-font text element per line, element list 0x009f3244).
// display_levelup_stats / DisplayChallengeResultToPlayer_00718350 /
// DisplayFormattedTextToPlayer_00718300 add lines with flags 0xe
// (SinowberillChallengeObjectListWindow_AddItem_0071b550 ->
// ListWindowObject_AppendItem_0073ae4c), flag 4 = the line expires after
// +0x8c = 0xb4 frames.
//   Append: the next of the 16 slots (+0x9c, a ring); a slot still holding
//   an old line drops it first and moves everything (scroll +0x74, target
//   +0x98, write cursor +0x94, every line's y) up by its height + 6
//   (0x00971c8c). The line goes at y = cursor, cursor += height + 6; when
//   cursor passes scroll + 120 the target becomes max(target, cursor + 20 -
//   120) (0x00971c7c).
//   Each frame (ListWindowObject_UpdateScrollAndHighlight_0073abb0):
//   UpdateScroll_0073adcc moves the scroll by max(0.15 * (target - scroll),
//   15) (0x00971c94 / 0x00971c90), snapping when the rest is smaller; lines
//   wholly above the scroll are dropped (oldest first, everything moved up by
//   height + 6, 0x00971c9c); UpdateItemHighlight_0073b208 counts the timers of
//   flag-4 lines down and, from the oldest line on, every expired line sets
//   the target to at least its y + height + 1 (0x00971c68) so it scrolls out
//   of the top.
// Line height: 14 per text line (the system font cell) and 6 between
// wrapped lines, wrapped at the content width 235 (get_text_rendering_sizes
// _for_list_item with w - 20, 0x00971c84). ASSUMED: that height rule and the
// wrapping; flag 8 (a line waits for the previous one to be typed out) is
// not modelled: lines show whole.
// The level-up lines arrive one every 0x16 frames (display_levelup_stats);
// enqueue() feeds them in at that pace.
export const MESSAGE_WINDOW = { x: 373, y: 203, w: 255, h: 120 } as const;
export const MESSAGE_SLOTS = 0x10;
export const MESSAGE_LINE_FRAMES = 0xb4;
export const MESSAGE_GAP = 6; // 0x00971c8c / 0x00971c9c
export const MESSAGE_INSET = 10;
export const MESSAGE_SCROLL_MIN = 15; // 0x00971c90
export const MESSAGE_SCROLL_RATE = 0.15; // 0x00971c94
export const MESSAGE_BOTTOM_MARGIN = 20; // 0x00971c7c
const MESSAGE_TEXT_LINE = 14;

export interface MessageLine {
  text: string;
  rows: string[];
  y: number;
  height: number;
  timer: number;
  timed: boolean;
}

// Wraps text at `width` px of the system font (words, then characters).
export function wrapMessage(text: string, width: number, measure: (s: string) => number = gameTextWidth): string[] {
  const rows: string[] = [];
  for (const para of text.split('\n')) {
    let row = '';
    for (const word of para.split(/(?<= )/)) {
      if (row && measure((row + word).trimEnd()) > width) {
        rows.push(row.trimEnd());
        row = '';
      }
      row += word;
      while (measure(row.trimEnd()) > width && row.length > 1) {
        let k = row.length - 1;
        while (k > 1 && measure(row.slice(0, k)) > width) k--;
        rows.push(row.slice(0, k));
        row = row.slice(k);
      }
    }
    rows.push(row);
  }
  return rows;
}

export class MessageLines {
  private slots: (MessageLine | null)[] = new Array(MESSAGE_SLOTS).fill(null);
  private next = 0; // +0x9c
  private oldest = 0; // +0x84
  scroll = 0; // +0x74
  target = 0; // +0x98
  private cursor = 0; // +0x94
  private queue: string[] = [];
  private gap = 0;
  private measure: (s: string) => number;

  constructor(measure: (s: string) => number = gameTextWidth) {
    this.measure = measure;
  }

  // Lines that arrive one every 0x16 frames (display_levelup_stats).
  enqueue(lines: string[]): void {
    this.queue.push(...lines);
  }

  get pending(): number {
    return this.queue.length;
  }

  // The lines in the window, oldest first.
  get lines(): readonly MessageLine[] {
    const out: MessageLine[] = [];
    for (let i = 0; i < MESSAGE_SLOTS; i++) {
      const l = this.slots[(this.oldest + i) % MESSAGE_SLOTS];
      if (l) out.push(l);
    }
    return out;
  }

  get visible(): readonly string[] {
    return this.lines.map((l) => l.text);
  }

  private shiftUp(d: number): void {
    this.scroll -= d;
    this.target -= d;
    this.cursor -= d;
    for (const l of this.slots) if (l) l.y -= d;
  }

  private dropOldest(): void {
    const l = this.slots[this.oldest];
    if (!l) return;
    this.shiftUp(l.height + MESSAGE_GAP);
    this.slots[this.oldest] = null;
    this.oldest = (this.oldest + 1) % MESSAGE_SLOTS;
  }

  // ListWindowObject_AppendItem_0073ae4c with flags 0xe.
  add(text: string, timed = true): void {
    if (this.slots[this.next]) {
      // The ring caught up with the oldest line: it goes first.
      if (this.next === this.oldest) this.dropOldest();
    }
    const rows = wrapMessage(text, MESSAGE_WINDOW.w - 2 * MESSAGE_INSET, this.measure);
    const height = rows.length * MESSAGE_TEXT_LINE + (rows.length - 1) * MESSAGE_GAP;
    const line: MessageLine = { text, rows, y: this.cursor, height, timer: MESSAGE_LINE_FRAMES, timed };
    this.slots[this.next] = line;
    this.next = (this.next + 1) % MESSAGE_SLOTS;
    this.cursor += height + MESSAGE_GAP;
    if (this.scroll + MESSAGE_WINDOW.h < this.cursor) this.target = Math.max(this.target, this.cursor + MESSAGE_BOTTOM_MARGIN - MESSAGE_WINDOW.h);
  }

  tick(gapFrames = 0x16): void {
    if (this.gap > 0) this.gap--;
    if (this.gap <= 0 && this.queue.length) {
      this.add(this.queue.shift()!);
      this.gap = gapFrames;
    }
    // UpdateScroll_0073adcc.
    const d = this.target - this.scroll;
    const step = Math.max(MESSAGE_SCROLL_RATE * d, MESSAGE_SCROLL_MIN);
    this.scroll = d < step ? this.target : this.scroll + step;
    // Lines wholly above the top go.
    for (let l = this.slots[this.oldest]; l && l.y + l.height < this.scroll; l = this.slots[this.oldest]) this.dropOldest();
    // UpdateItemHighlight_0073b208.
    for (const l of this.slots) if (l && l.timed && l.timer > 0) l.timer--;
    for (let i = 0; i < MESSAGE_SLOTS; i++) {
      const l = this.slots[(this.oldest + i) % MESSAGE_SLOTS];
      if (!l || l.timer > 0 || !l.timed) break;
      l.timed = false;
      this.target = Math.max(this.target, l.y + 1 + l.height);
    }
  }

  draw(ctx: CanvasRenderingContext2D, wx: number = MESSAGE_WINDOW.x): void {
    const left = wx + MESSAGE_INSET;
    const top = MESSAGE_WINDOW.y + MESSAGE_INSET;
    const w = MESSAGE_WINDOW.w - 2 * MESSAGE_INSET;
    const h = MESSAGE_WINDOW.h - 2 * MESSAGE_INSET;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, w, h);
    ctx.clip();
    for (const l of this.lines) {
      const y = top + l.y - this.scroll;
      if (y + l.height < top || y > top + h) continue;
      l.rows.forEach((row, k) => drawGameText(ctx, row, left, y + k * (MESSAGE_TEXT_LINE + MESSAGE_GAP), '#ffffff'));
    }
    ctx.restore();
  }
}

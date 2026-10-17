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

import { drawGameText } from './gametext.ts';

export const STATUS_WINDOW = { x: 28, y: 37, w: 228, h: 76 } as const;

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

// ScrollbarObject_Render_0072a2c4 without the window-opening wipe.
export function drawBar(ctx: CanvasRenderingContext2D, tex: CanvasImageSource, bar: BarState, x: number, y: number, colors: { heal: Argb; damage: Argb }): void {
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
}

// The status window's state across frames (bars and their colours).
export class StatusWindow {
  readonly hp = new BarState(BAR_COLORS.hp.normal);
  readonly tp = new BarState(BAR_COLORS.tp.normal);
  hpText: Argb = BAR_COLORS.hp.text;
  tpText: Argb = BAR_COLORS.tp.text;
  values: StatusValues = { name: '', slot: 0, level: 1, hp: 0, maxHp: 0, tp: 0, maxTp: 0, pb: 0, dead: false };

  // One 30 Hz frame: QuickMenuStatusBarUpdateHP_007422c4 /
  // QuickMenuTPBarUpdate_00742378 then the bar animations.
  tick(v: StatusValues): void {
    this.values = v;
    const hpLow = v.hp <= v.maxHp * LOW_FRACTION;
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
  }

  draw(ctx: CanvasRenderingContext2D, tex: HudTextures, wx = STATUS_WINDOW.x, wy = STATUS_WINDOW.y): void {
    const v = this.values;
    // render_player_hud_bg: gauge, corner piece, window.
    drawPbGauge(ctx, wx, wy, v.pb);
    drawModulated(ctx, tex.panel, 118, 80, 69, 80, 0, 0, 69, 80);
    drawModulated(ctx, tex.panel, 0, 0, 228, 76, wx, wy, 228, 76);
    // Elements in list order.
    drawModulated(ctx, tex.icons, 34 * (v.slot & 3), 202, 34, 29, wx + 27, wy + 16, 34, 29);
    // Name: the player's name colour (+0x948), red while dead
    // (QuickMenuUpdatePlayerInfo_00742454).
    drawGlyphText(ctx, tex.font, v.name, wx + 124, wy + 67, v.dead ? 0xffff0000 : 0xffffffff);
    drawGlyphNumber(ctx, tex.font, v.level, wx + 82, wy + 59);
    drawBar(ctx, tex.panel, this.hp, wx + 90, wy + 24, BAR_COLORS.hp);
    drawBar(ctx, tex.panel, this.tp, wx + 90, wy + 48, BAR_COLORS.tp);
    drawGlyphText(ctx, tex.font, 'Lv', wx + 30, wy + 59);
    this.drawValue(ctx, tex.font, 'HP', v.hp, v.maxHp, wx, wy + 9, this.hpText);
    this.drawValue(ctx, tex.font, 'TP', v.tp, v.maxTp, wx, wy + 33, this.tpText);
    // Element 14: the gauge number, centred on x 68.
    const pb = Math.min(Math.max(0, Math.round(v.pb)), 500);
    drawGlyphNumber(ctx, tex.font, pb, wx + 68 + numberWidth(pb) * 0.5, wy + 13);
  }

  private drawValue(ctx: CanvasRenderingContext2D, font: CanvasImageSource, label: string, value: number, max: number, wx: number, y: number, argb: Argb): void {
    drawGlyphText(ctx, font, label, wx + 90, y, argb);
    const right = wx + 210;
    drawGlyphNumber(ctx, font, max, right, y, argb);
    const x = right - numberWidth(max) - 12;
    drawGlyphText(ctx, font, '/', x, y, argb);
    drawGlyphNumber(ctx, font, value, x, y, argb);
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

// --- message window lines ----------------------------------------------------

// The player's message window (window position 0x22 = (373, 203) of the table
// at 0x00971f40, built by CreateChatShortcutMenuYesNoListWindow_0073b3a0 with
// the size {255, 120} at 0x0096ffd8) that display_levelup_stats fills through
// DisplayChallengeResultToPlayer_00718350 -> ListWindowObject_AddItem_0073ae38.
// The text is the system font (gametext.ts), 20 per line (FUN_007ab554).
// APPROXIMATED: the window's own scrolling and how long a line stays are not
// decoded; lines scroll up when the window is full and fade after
// MESSAGE_LINE_FRAMES.
export const MESSAGE_WINDOW = { x: 373, y: 203, w: 255, h: 120 } as const;
export const MESSAGE_LINE_FRAMES = 300; // ASSUMED
const MESSAGE_LINES = Math.floor(MESSAGE_WINDOW.h / 20);

export class MessageLines {
  private lines: { text: string; age: number }[] = [];
  private queue: string[] = [];
  private gap = 0;

  // Lines that arrive one every `gapFrames` (the level-up message's 0x16).
  enqueue(lines: string[]): void {
    this.queue.push(...lines);
  }

  get pending(): number {
    return this.queue.length;
  }

  get visible(): readonly string[] {
    return this.lines.map((l) => l.text);
  }

  tick(gapFrames = 0x16): void {
    if (this.gap > 0) this.gap--;
    if (this.gap <= 0 && this.queue.length) {
      this.lines.push({ text: this.queue.shift()!, age: 0 });
      if (this.lines.length > MESSAGE_LINES) this.lines.shift();
      this.gap = gapFrames;
    }
    for (const l of this.lines) l.age++;
    this.lines = this.lines.filter((l) => l.age < MESSAGE_LINE_FRAMES);
  }

  draw(ctx: CanvasRenderingContext2D, wx: number = MESSAGE_WINDOW.x): void {
    this.lines.forEach((l, i) => {
      const left = MESSAGE_LINE_FRAMES - l.age;
      const alpha = Math.min(1, left / 30);
      drawGameText(ctx, l.text, wx + 10, MESSAGE_WINDOW.y + 10 + i * 20, '#ffffff', alpha);
    });
  }
}

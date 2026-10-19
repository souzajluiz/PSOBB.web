// "Classic" UI stage: reproduces the original client's 2D screens.
//
// The game lays its 2D UI out in a 640x480 virtual screen and stretches it to
// the window (the reference captures are 16:10, so everything is wider than
// tall by 1.2x). The stage draws with a Canvas2D transform from that virtual
// space to device pixels, so coordinates measured from the original map 1:1.
// Elements the original keeps round on screen (the title circle) use
// drawRound*, which compensates for the stretch.

import type { XvrTexture } from '../formats/xvm.ts';
import { clipReveal, type WindowAnim } from './windowanim.ts';

export const VW = 640;
export const VH = 480;
export const FONT = 'Tahoma, Verdana, sans-serif';

// An inline text editor of a screen (login rows, character name, game name /
// password, chat line). The page brings up the phone's on-screen keyboard for
// it (ui/softkeyboard.ts); the screen itself keeps reading ordinary key events.
export interface TextInputState {
  password: boolean; // masked on screen: the keyboard field is type=password
  chat?: boolean; // enter key hint "send"
}

export interface Screen {
  // 'stretch': the 640x480 virtual screen fills the window (title).
  // 'left43': uniform scale by height, 4:3 area anchored left (menus such as
  // SELECT CHARACTER); drawFullscreen paints the whole window first.
  layout?: 'stretch' | 'left43';
  // true: the canvas is cleared to transparent so a 3D view underneath shows
  // through (lobby, ship select).
  transparent?: boolean;
  // false: the touch pad (stick, arrows, OK / BACK) is hidden on this screen,
  // which is made for taps (title / login).
  touchPad?: boolean;
  // Non-null while an inline text editor is active.
  textInput?(): TextInputState | null;
  drawFullscreen?(ctx: CanvasRenderingContext2D, w: number, h: number, stage: Stage): void;
  enter?(stage: Stage): void;
  update(dt: number, stage: Stage): void;
  draw(ctx: CanvasRenderingContext2D, stage: Stage): void;
  key?(e: KeyboardEvent, stage: Stage): void;
  keyUp?(e: KeyboardEvent, stage: Stage): void;
  blur?(stage: Stage): void;
  leave?(stage: Stage): void;
}

// GPU-friendly image for a decoded texture. Drawing plain canvases as sources
// kept Chrome's Canvas2D at ~2 fps; ImageBitmaps stay on the GPU.
export function textureBitmap(t: XvrTexture): Promise<ImageBitmap> {
  return createImageBitmap(new ImageData(new Uint8ClampedArray(t.rgba), t.width, t.height));
}

export function textureBitmaps(ts: XvrTexture[]): Promise<ImageBitmap[]> {
  return Promise.all(ts.map(textureBitmap));
}

export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private screen: Screen | null = null;
  private last = performance.now();
  private raf = 0;
  sx = 1; // device pixels per virtual pixel
  sy = 1;
  time = 0;
  // Development aid (?t=<seconds>): the animation clock held at one value so a
  // frame can be compared with a capture.
  freezeTime: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', ' ', 'Tab'].includes(e.key)) e.preventDefault();
      this.screen?.key?.(e, this);
    });
    canvas.addEventListener('keyup', (e) => this.screen?.keyUp?.(e, this));
    canvas.addEventListener('blur', () => this.screen?.blur?.(this));
    const loop = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.time = this.freezeTime ?? this.time + dt;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private resize(): void {
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    this.sx = this.canvas.width / VW;
    this.sy = this.canvas.height / VH;
  }

  show(screen: Screen): void {
    this.screen?.leave?.(this);
    this.screen = screen;
    screen.enter?.(this);
    this.canvas.focus();
  }

  private frame(dt: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.screen?.transparent) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (!this.screen) return;
    this.screen.update(dt, this);
    this.paint(ctx, this.canvas.width, this.canvas.height);
  }

  private paint(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const screen = this.screen!;
    ctx.imageSmoothingEnabled = true;
    if (screen.layout === 'left43') {
      screen.drawFullscreen?.(ctx, w, h, this);
      this.sx = this.sy = h / VH;
    } else {
      this.sx = w / VW;
      this.sy = h / VH;
    }
    ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    screen.draw(ctx, this);
  }

  // Draws the current screen into another context of size w x h (no update).
  renderTo(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const [sx, sy] = [this.sx, this.sy];
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (this.screen) this.paint(ctx, w, h);
    [this.sx, this.sy] = [sx, sy];
  }

  // Ratio that makes a virtual-space circle look round on screen.
  get aspectFix(): number {
    return this.sy / this.sx;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.screen?.leave?.(this);
  }
}

export interface TextStyle {
  size: number; // virtual pixels
  color?: string;
  align?: CanvasTextAlign;
  bold?: boolean;
  shadow?: string;
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, s: TextStyle): void {
  ctx.font = `${s.bold === false ? '' : 'bold '}${s.size}px ${FONT}`;
  ctx.textAlign = s.align ?? 'left';
  ctx.textBaseline = 'middle';
  if (s.shadow) {
    ctx.fillStyle = s.shadow;
    ctx.fillText(text, x + 0.6, y + 0.6);
  }
  ctx.fillStyle = s.color ?? '#fff';
  ctx.fillText(text, x, y);
}


// ---------------------------------------------------------------------------
// Generic BB menu window, decompiled from PsoBB.exe (Ephinea 1.25.13).
// All windows of the 2D UI (title "Login" menu, "Input UserID", yes/no
// prompts...) share this renderer; its textures come from f256_hyouji.prs
// (FUN_00712d14 loads it as the window texlist at 0x00a983d8):
//   texture 1: window frame (96x96 nine-slice at texel 0,0) and the title pills
//   texture 2: selection bars
// ---------------------------------------------------------------------------

export interface WindowSkin {
  frame: CanvasImageSource; // f256_hyouji.prs texture 1
  bars: CanvasImageSource; // f256_hyouji.prs texture 2
}

// psobb.io's widescreen patch draws windows with a uniform scale, centered
// horizontally (measured on the reference capture: the Login window at
// x=210 lands at 120 + 210 * 1.875 px of a 1440 px wide frame). On a 4:3
// screen this is the identity. Runs `fn` in that space.
export function inWindowSpace(ctx: CanvasRenderingContext2D, stage: Stage, fn: () => void): void {
  ctx.save();
  const s = stage.sy;
  ctx.setTransform(s, 0, 0, s, (VW * stage.sx - VW * s) / 2, 0);
  fn();
  ctx.restore();
}

// FUN_00710f80: window frame. Nine-slice of the 96x96 texel block of texture 1:
// 32x32 corners (halved when the window is smaller than 64), edges and centre
// tiled in 32-texel steps, the last tile cut short (its UVs too). The height
// is rounded up to a multiple of 4; vertex color = style color (white).
// Collects the frames drawn while it is set (classic/fieldmenu.ts uses it for
// the bounds of a menu leaf's windows).
export const windowFrames: { record: ((x: number, y: number, w: number, h: number) => void) | null } = { record: null };

export function drawWindowFrame(ctx: CanvasRenderingContext2D, tex: CanvasImageSource, x: number, y: number, w: number, h: number): void {
  windowFrames.record?.(x, y, w, h);
  const hi = Math.trunc(h);
  const hq = hi + ((4 - (hi & 3)) & 3);
  const cw = Math.min(32, w / 2);
  const ch = hq < 64 ? hq / 2 : 32;
  const bands = (pos: number, len: number, c: number): Array<[number, number, number]> => {
    const out: Array<[number, number, number]> = [[pos, c, 0]]; // [screen pos, size, texel]
    for (let p = pos + c; p < pos + len - c; p += 32) out.push([p, Math.min(32, pos + len - c - p), 32]);
    out.push([pos + len - c, c, 96 - c]);
    return out;
  };
  for (const [yy, hh, v] of bands(y, hq, ch)) {
    for (const [xx, ww, u] of bands(x, w, cw)) {
      if (ww > 0 && hh > 0) ctx.drawImage(tex, u, v, ww, hh, xx, yy, ww, hh);
    }
  }
}

// FUN_00760b85: title pill above a window, from texture 1. Left cap 40x27
// (texels u..u+40), middle stretched from texels u+20..u+60, right cap
// u+40..u+80. The middle is max(0, textWidth - 112) + 80 wide (FUN_00760ab0).
// Row by state (table 0x00974bf8): 0 teal (0,98), 1 orange (0,125),
// 2 green (0,152), 3 teal (80,98).
const PILL_UV: Array<[number, number]> = [[0, 98], [0, 125], [0, 152], [80, 98]];
export function pillWidth(textWidth: number): number {
  return 160 + Math.max(0, textWidth - 112);
}
export function drawTitlePill(ctx: CanvasRenderingContext2D, tex: CanvasImageSource, x: number, y: number, textWidth: number, state = 1): void {
  const [u, v] = PILL_UV[state];
  const mid = Math.max(0, textWidth - 112) + 80;
  ctx.drawImage(tex, u, v, 40, 27, x, y, 40, 27);
  ctx.drawImage(tex, u + 20, v, 40, 27, x + 40, y, mid, 27);
  ctx.drawImage(tex, u + 40, v, 40, 27, x + 40 + mid, y, 40, 27);
}

// FUN_007120ec: selection bar, additive (SRCALPHA, ONE), texture 2 texels
// (151,57) 48x18 (orange) or (151,76) (green). Caps 16 texels wide drawn from
// x-2..x+14 and x+w-14..x+w+2, the middle (texels +16..+32) stretched between.
export function drawSelectBar(ctx: CanvasRenderingContext2D, tex: CanvasImageSource, x: number, y: number, w: number, h: number, green = false): void {
  const u = 151;
  const v = green ? 76 : 57;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(tex, u, v, 16, 18, x - 2, y, 16, h);
  ctx.drawImage(tex, u + 32, v, 16, 18, x + w - 14, y, 16, h);
  ctx.drawImage(tex, u + 16, v, 16, 18, x + 14, y, w - 28, h);
  ctx.restore();
}

export const WINDOW_FONT = 11; // virtual px; Tahoma bold (font_tahoma.reg), measured on the reference
export const ITEM_STEP = 20; // FUN_00735c90: item y = index * 0x14
export const ITEM_HEIGHT = 16; // measured: bar and text centred 7.5-8 px below the row top

export interface MenuItem {
  label: string;
  color?: string; // FUN_00735db8 item color (ARGB 0xffffcc33 -> #ffcc33)
  selectable?: boolean;
}

// Menu window (FUN_0073566c / FUN_007354fc). Layout from FUN_0071b900 and
// FUN_0071bc28: content = window inset by 10 px, plus 6 px under the title
// (flag 0x40 set by FUN_0073566c). The title pill sits at (x, y - 13)
// (template 0x00974d00) with its text 4 px below the pill top, centred.
// With `anim`, the rows are under the window's opening wipe (each row's text
// cut at anim.reveal(x, y, content width) px, x / y its offset in the
// content) and the title text waits for c >= 0 (classic/windowanim.ts).
// unknown_render_text narrows the quad of the glyph that crosses the cut
// (x_end = x + space left) without moving its UVs; here it is clipped
// instead (ASSUMED close enough at 11 px).
export function drawMenuWindow(
  ctx: CanvasRenderingContext2D,
  skin: WindowSkin,
  win: { x: number; y: number; w: number; h: number; title?: string },
  items: MenuItem[],
  selected: number,
  selectedColor = '#ffc19a',
  anim?: WindowAnim,
): void {
  drawWindowFrame(ctx, skin.frame, win.x, win.y, win.w, win.h);
  const cx = win.x + 10;
  const cy = win.y + 10 + (win.title !== undefined ? 6 : 0);
  const cw = win.w - 20;
  items.forEach((item, i) => {
    const top = cy + i * ITEM_STEP;
    const color = i === selected ? selectedColor : item.color ?? '#ffffff';
    const draw = () => drawText(ctx, item.label, cx + cw / 2, top + 7.5, { size: WINDOW_FONT, color, align: 'center', shadow: 'rgba(0,0,0,0.85)' });
    if (!anim) return draw();
    ctx.font = `bold ${WINDOW_FONT}px ${FONT}`;
    const ex = cw / 2 - ctx.measureText(item.label).width / 2;
    ctx.save();
    if (clipReveal(ctx, cx + ex, top, anim.reveal(ex, i * ITEM_STEP, cw), ITEM_HEIGHT)) draw();
    ctx.restore();
  });
  if (selected >= 0 && selected < items.length) drawSelectBar(ctx, skin.bars, cx, cy + selected * ITEM_STEP, cw, ITEM_HEIGHT);
  if (win.title !== undefined) {
    ctx.font = `bold ${WINDOW_FONT}px ${FONT}`;
    const tw = ctx.measureText(win.title).width;
    const px = win.x;
    const py = win.y - 13;
    drawTitlePill(ctx, skin.frame, px, py, tw, 1);
    if (!anim || anim.textShown) drawText(ctx, win.title, px + pillWidth(tw) / 2, py + 4 + 7.5, { size: WINDOW_FONT, color: '#120400', align: 'center' });
  }
}

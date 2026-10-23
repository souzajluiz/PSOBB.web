// The open / close animation every list window of PsoBB.exe (Ephinea 1.25.13)
// runs, and the opening wipe of its elements.
//
// State (list_window_object): flags +0x2c bit 1 = open, bit 2 = animating,
// bit 4 = close requested while opening, 0x20 = silent; +0x5c the open
// counter; +0x22 the closing counter.
//   Open (SinowberillChallengeObjectListWindow_UpdateListItemState_00712714,
//   MenuListItem_Initialize_00712c44 for windows created open): counter = 0
//   (0x1000000 = already open when the window speed's table entry, 0x0097e4cc
//   = {34, 51, 68, 0}, is 0), flags |= 3, SE 0x572 unless silent.
//   Close (play_sfx_for_closing_list_menu @ 0x007126xx): an opening window
//   only gets bit 4; an open one becomes "closing" (bit 1 cleared, bit 2 set),
//   SE 0x573 unless silent.
//   Each frame (unknown_closing_window): counter += window speed + 1 (the
//   character option bits 0x300 >> 8, GetCharacterOptionsBitfield_007be1d0;
//   1 without session data) while below 0x1000000; an opening window is open
//   once counter >= 7.5 (0x0096f754) (with bit 4 it starts closing then); a
//   closing window counts +0x22 up and is gone when it reaches 4.5
//   (0x0096f758).
// Drawing (UIElement_UpdateRenderData_00712658, UiTextGeometryUpdate
// _0071b900, UIElement_SetTextColor_0071bc8c, UIElement_SetScale_0071bcec):
//   c = round(counter - 7.5) (0x0096f68c); while c < 0 the window's quads
//   are drawn with alpha (c + 7.5) / 7.5 (0x00970098 / 0x00970094);
//   every element (bar, text, number) shows only its first
//   (c - (x / W + y / 21) * 7.5) * 17 px (ScrollbarObject_Render_0072a2c4
//   0x00970adc..0x00970ae4, render_chat_bubbles_and_more 0x00970eb0..0x00970eb8;
//   x, y relative to the content, W = the content width): the wipe;
//   a list row's text (AutoClass2, render_chat_bubbles_and_more 0x0072d9b4)
//   is cut at that width (text_space = min(width, reveal), x / y its offset
//   in the content: centred x, row * 20); W is the render data's +0x18, the
//   window width less 2 * 10;
//   texts drawn whole once c >= 0 instead: a window's title pill text
//   (unknown_tekker_result_text) and the label / ':' / value rows of the
//   info-counter windows (RenderInfoCounterEntity_0072e930, e.g. Input
//   UserID) (textShown);
//   while closing the quads are scaled about the window centre by
//   x (1 + 0.5111 k), y (1 - 0.2222 k) for k = the closing counter
//   (0x00970084..0x00970090: 1 + k * 0.2222 * 2.3, 1 - k * 0.2222).

export const OPEN_FRAMES = 7.5; // 0x0096f754 / 0x0096f68c
export const CLOSE_FRAMES = 4.5; // 0x0096f758
export const OPENED = 0x1000000;
export const WINDOW_SPEED = [34, 51, 68, 0] as const; // 0x0097e4cc
export const WIPE_RATE = 17; // 0x00970adc
export const WIPE_ROW = 21; // 0x00970ae4
export const SE_WINDOW_OPEN = 0x572;
export const SE_WINDOW_CLOSE = 0x573;

export class WindowAnim {
  counter = OPENED; // +0x5c
  closing = 0; // +0x22
  private flags = 1; // +0x2c bits 1 / 2 / 4
  silent: boolean;
  // Sound hook (SE 0x572 / 0x573).
  se: (id: number) => void = () => {};

  constructor(silent = false, open = true) {
    this.silent = silent;
    if (!open) this.flags = 0;
  }

  // The window speed option (0..3) of the character's option flags.
  static speedOf(optionFlags: number | undefined): number {
    return optionFlags === undefined ? 1 : (optionFlags & 0x300) >> 8;
  }

  get isOpen(): boolean {
    return (this.flags & 1) !== 0;
  }

  get animating(): boolean {
    return (this.flags & 2) !== 0;
  }

  // Drawn at all (open, opening or closing).
  get visible(): boolean {
    return (this.flags & 3) !== 0;
  }

  open(speed = 1): void {
    if (this.flags & 1) {
      this.flags &= ~4;
      return;
    }
    if (this.flags & 2) {
      // Closing: reopen.
      this.flags |= 4;
      return;
    }
    this.counter = (WINDOW_SPEED[speed] ?? 0) > 0 ? 0 : OPENED;
    this.closing = 0;
    this.flags |= 3;
    if (!this.silent) this.se(SE_WINDOW_OPEN);
  }

  close(): void {
    if (!(this.flags & 1)) {
      this.flags &= ~4;
      return;
    }
    if (this.flags & 2) {
      this.flags |= 4;
      return;
    }
    if (!this.silent) this.se(SE_WINDOW_CLOSE);
    this.flags = (this.flags & ~1) | 2;
    this.closing = 0;
  }

  // One frame of unknown_closing_window.
  tick(speed = 1): void {
    if (this.counter < OPENED) this.counter += speed + 1;
    const f = this.flags;
    if (!(f & 2)) return;
    if (f & 1) {
      if (this.counter >= OPEN_FRAMES) {
        if (f & 4) {
          if (!this.silent) this.se(SE_WINDOW_CLOSE);
          this.flags = f & ~5;
          this.closing = 0;
        } else {
          this.flags = f & ~2;
        }
      }
      return;
    }
    const k = this.closing + 1;
    if (k >= CLOSE_FRAMES) {
      this.closing = 0;
      if (f & 4) {
        // A reopen asked for while closing: open again from 0.
        if (!this.silent) this.se(SE_WINDOW_OPEN);
        this.counter = 0;
        this.flags = (f & ~4) | 1;
        return;
      }
      this.flags = f & ~2;
      return;
    }
    this.closing = k;
  }

  // c of the drawing rules.
  // (x87 rounding: halves to even.)
  get c(): number {
    const v = this.counter - OPEN_FRAMES;
    const f = Math.floor(v);
    const d = v - f;
    return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f;
  }

  // Texts with no wipe (titles, info-counter rows) are drawn from c >= 0.
  get textShown(): boolean {
    return this.c >= 0;
  }

  // The quads' alpha (0..1).
  get alpha(): number {
    const c = this.c;
    return c < 0 ? Math.max(0, (c + OPEN_FRAMES) / OPEN_FRAMES) : 1;
  }

  // How many px of an element at (x, y) of a content `w` wide are shown.
  reveal(x: number, y: number, w: number): number {
    return (this.c - (x / w + y / WIPE_ROW) * OPEN_FRAMES) * WIPE_RATE;
  }

  // The closing scale about the window centre.
  get scale(): { x: number; y: number } {
    const k = this.flags & 1 ? 0 : this.closing;
    return { x: 1 + k * 0.2222222 * 2.3, y: 1 - k * 0.2222222 };
  }
}

// Draws `body` with a window's alpha and closing scale about the centre of
// (x, y, w, h).
export function withWindowAnim(ctx: CanvasRenderingContext2D, a: WindowAnim, x: number, y: number, w: number, h: number, body: () => void): void {
  if (!a.visible) return;
  const s = a.scale;
  ctx.save();
  ctx.globalAlpha *= a.alpha;
  if (s.x !== 1 || s.y !== 1) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.translate(cx, cy);
    ctx.scale(s.x, s.y);
    ctx.translate(-cx, -cy);
  }
  body();
  ctx.restore();
}

// Clips to the part of an element the wipe shows: from its left edge `left`,
// `reveal` px wide (nothing when <= 0). Returns false when nothing shows.
export function clipReveal(ctx: CanvasRenderingContext2D, left: number, top: number, reveal: number, height: number): boolean {
  if (reveal <= 0) return false;
  if (reveal >= 1000) return true; // wider than any window: all of it
  ctx.beginPath();
  ctx.rect(left, top - 4, reveal, height + 8);
  ctx.clip();
  return true;
}

// --- the window shine ---------------------------------------------------------
//
// A sheen that crosses every list window now and then. One global state
// machine (UpdateAnimationStateMachine_00712834, run once a frame by
// update_unknown_animation_counter -> TriggerAnimationStateMachine_0071282c;
// g_AnimationState 0xa983e0, g_AnimationFrameCounter 0xa983dc):
//   state 0: wait = trunc(rand / 32768 * 60 + 60) frames (0x0096f66c,
//            0x0096f670), state 1;
//   state 1: counts the wait down to -1, then counter = 0, state 2;
//   state 2: counter += 1 a frame; over (state 0) once
//            (counter + -0.2 * round(120)) * 5 >= 840 (0x0096f678,
//            0x0096f7b4, 0x0096f674), that is at counter 192.
// The window background (unknown_render_background_for_menus, shine part
// 0x007116e6..0x00711986) draws while the state is 2: the window at (x, y), w x h
// (render position +0x40..+0x4c) gets rows = int(round((h - 24) / 4)) lines,
// row i at y + 12 + 4 i from x + 12 to x + w - 12, vertex colours 0x282828
// with alpha 0 at both ends and the peak at x + 12 + len, where
//   len(i) = start - i, start = (counter - 2 round((12 + y) / 4)) * 5 - 1 - x
//   (so the band reaches the windows higher on the screen first and sweeps
//   to the right), a row only when 0 < len < w - 24,
//   alpha = 255 * 2 f for f <= 0.5, 255 * 2 (1 - f) above, f = len / (w - 24).
// Element shines (RenderAnimationFrame_007129a8: the same counter drives a
// textured quad of texture 2 / 0xd over some elements) are not ported.

export const SHINE_FRAME = 1 / 30;
export const SHINE_END = 192; // counter at which (counter - 24) * 5 >= 840
export const SHINE_COLOR = '40, 40, 40'; // 0x282828
export const SHINE_ROW_STEP = 4; // 0x0096f7b8
export const SHINE_MARGIN = 12; // 0x0096f7bc
export const SHINE_PAD = 24; // 0x0096f728

export interface ShineLine {
  y: number;
  x0: number;
  x1: number; // the alpha peak
  x2: number;
  alpha: number; // 0..255, truncated like the exe's byte
}

export class WindowShine {
  state = 0; // g_AnimationState
  counter = 0; // g_AnimationFrameCounter
  private rng: () => number;
  private last = -1;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  // One frame of UpdateAnimationStateMachine_00712834.
  tick(): void {
    let wait: number;
    if (this.state === 0) {
      wait = Math.trunc(Math.floor(this.rng() * 32768) / 32768 * 60 + 60);
      this.state = 1;
    } else {
      wait = this.counter;
      if (this.state !== 1) {
        if (this.state !== 2) return;
        this.counter++;
        if ((this.counter + -0.2 * 120) * 5 >= 840) this.state = 0;
        return;
      }
    }
    if (wait >= 0) {
      this.counter = wait - 1;
      return;
    }
    this.counter = 0;
    this.state = 2;
  }

  // Runs the frames elapsed since the last call at 30 a second (the draw
  // path stands in for the exe's per-frame call).
  sync(nowMs: number): void {
    if (this.last < 0) this.last = nowMs;
    let n = Math.floor((nowMs - this.last) / (SHINE_FRAME * 1000));
    if (n <= 0) return;
    this.last += n * SHINE_FRAME * 1000;
    n = Math.min(n, 10);
    while (n-- > 0) this.tick();
  }

  get active(): boolean {
    return this.state > 1;
  }

  // The lines the window background draws now.
  lines(x: number, y: number, w: number, h: number): ShineLine[] {
    if (!this.active) return [];
    const rows = Math.trunc(roundEven((h - SHINE_PAD) / SHINE_ROW_STEP));
    const A = roundEven((SHINE_MARGIN + y) / SHINE_ROW_STEP);
    let len = (A * -2 + this.counter) * 5 + (-1 - x);
    const inner = w - SHINE_PAD;
    if (!(len > 0) || !(len - rows < inner)) return [];
    const out: ShineLine[] = [];
    for (let i = 0; i < rows; i++, len -= 1) {
      if (!(len > 0 && len < inner)) continue;
      const f = len / inner;
      const a = f <= 0.5 ? f * 2 * 255 : (1 - f) * 2 * 255;
      out.push({ y: y + SHINE_MARGIN + SHINE_ROW_STEP * i, x0: x + SHINE_MARGIN, x1: x + SHINE_MARGIN + len, x2: x - SHINE_MARGIN + w, alpha: Math.trunc(a) & 0xff });
    }
    return out;
  }
}

// CalculateRoundedFloat_0083c230 (fistp: halves to even).
function roundEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f;
}

export const windowShine = new WindowShine();

// Draws the shine over the window at (x, y, w, h).
export function drawWindowShine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  windowShine.sync(typeof performance !== 'undefined' ? performance.now() : Date.now());
  for (const l of windowShine.lines(x, y, w, h)) {
    const g = ctx.createLinearGradient(l.x0, 0, l.x2, 0);
    const p = Math.min(1, Math.max(0, (l.x1 - l.x0) / (l.x2 - l.x0)));
    g.addColorStop(0, `rgba(${SHINE_COLOR}, 0)`);
    g.addColorStop(p, `rgba(${SHINE_COLOR}, ${l.alpha / 255})`);
    g.addColorStop(1, `rgba(${SHINE_COLOR}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(l.x0, l.y, l.x2 - l.x0, 1);
  }
}

// --- the element shine --------------------------------------------------------
//
// The HUD windows with their own textured background (the status window,
// render_player_hud_bg 0x00743b60; the party members' windows,
// QuestListEntry_Render_0073eb60 0x0073eb60) draw the same band once more over
// that background (RenderAnimationFrame_007129a8, after the background and
// before their elements). The band position is b = counter * 5 - 100
// (g_AnimationFrameScale 0x0096f668 = 5, g_AnimationFrameOffset 0x0096f664 =
// 100). IsAnimationFrameInWindow_00712914 draws it only while x < b < x + w
// (the element's [4] / [6]; ASSUMED equal to the quad's x and width). Then
// t = (b - x) / w (the element's [0] / [2], ASSUMED the same) places the band
// at x + w t on the quad, and a triangle strip of six vertices gives it:
// alpha 0 at the quad's left and right edges, alpha(t) at the band, with
//   alpha(t) = trunc(160 * 2 t)        for t <= 0.5   (0x0096f658 = 160,
//   alpha(t) = trunc(160 * (1 - t) * 2) for t > 0.5    0x0096f650 = 2, the
//                                                      fistp under chop),
// colour 0xffffff, and the texture's u / v stretched over the quad as usual.
// Texture 13 (0xd) for these windows. ASSUMED: the blend is additive (the
// exe's texture stage / alpha state is set by SetupTextureBlendState_007a9570
// and D3D8_SetAlphaState_0082b13c(1), not decoded), so the band brightens the
// background; a plain alpha blend would not change a background drawn under it.
export const ELEMENT_SHINE_SCALE = 5; // 0x0096f668
export const ELEMENT_SHINE_OFFSET = 100; // 0x0096f664
export const ELEMENT_SHINE_PEAK = 160; // 0x0096f658

// The band's alpha (0..255) at position t in 0..1 (the strip's middle vertices).
export function elementShineAlpha(t: number): number {
  const a = t <= 0.5 ? ELEMENT_SHINE_PEAK * (t + t) : ELEMENT_SHINE_PEAK * (1 - t) * 2;
  return Math.trunc(a) & 0xff;
}

// The band across an element at x of width w, or null when the band is not in
// it (or the shine is not running: state 2 only).
export function elementShine(x: number, w: number): { t: number; alpha: number } | null {
  if (!windowShine.active || !(w > 0)) return null;
  const b = windowShine.counter * ELEMENT_SHINE_SCALE - ELEMENT_SHINE_OFFSET;
  if (!(x < b && b < x + w)) return null;
  const t = (b - x) / w;
  return { t, alpha: elementShineAlpha(t) };
}

// Draws the band over the quad (x, y, w, h) of texture `tex`, sampling the
// texels (u0, v0)-(u1, v1) (one column at a time: the band is a linear ramp
// across x, so each column gets its own alpha).
export function drawElementShine(
  ctx: CanvasRenderingContext2D,
  tex: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  uv: readonly [number, number, number, number],
): void {
  windowShine.sync(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const s = elementShine(x, w);
  if (!s) return;
  const peak = s.alpha / 255;
  const band = w * s.t;
  const [u0, v0, u1, v1] = uv;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let c = 0; c < w; c++) {
    const px = c + 0.5;
    const a = px < band ? peak * (px / band) : peak * ((w - px) / (w - band));
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    const su = u0 + Math.floor((c * (u1 - u0)) / w);
    ctx.drawImage(tex, su, v0, 1, v1 - v0, x + c, y, 1, h);
  }
  ctx.restore();
}

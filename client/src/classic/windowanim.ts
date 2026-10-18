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

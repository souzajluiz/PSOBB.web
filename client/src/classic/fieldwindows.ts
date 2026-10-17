// Window primitives of the in-game menus (Item Pack, Technique), on top of the
// shared frame / select bar renderers of stage.ts. PsoBB.exe (Ephinea 1.25.13):
//
// List window with a title (CreateListWindowObject_0073566c): frame at a
// position-table entry, width set by ListWindowObject_UpdateScrollPosition_00736138
// (FUN_00736138), height = items * (14 + 6) - 6 + 20, plus 6 for the title
// (0x0097140c / 0x00971410 / 0x00971414); the content starts 10 px inside
// the frame and 6 px lower under a title (FUN_0071b900, flag 0x40). Items are
// 20 px apart (FUN_00735c90) and centred: x = width / 2 - 10 - text / 2 from
// the content origin (FUN_00736458, 0x009713d0 / 0x009713d4 / 0x009713c8).
// Disabled items (ListWindowObject_AddListItem_00735ee0, flags 6) keep the
// cursor but are drawn 0xff909090. The title pill sits 13 px above the frame
// (template 0x00974d00), state 1 (orange) of table 0x00974bf8.
// The cursor moves with the arrows and wraps (0x00736768 / 0x007381e0, SE
// 0x56F); Enter confirms (SE 0x570), Backspace cancels (SE 0x585).

import { se, SE } from '../audio/se.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { drawSelectBar, drawTitlePill, drawWindowFrame, pillWidth, type WindowSkin } from './stage.ts';

export const ROW = 20; // FUN_00735c90
export const LINE = 14; // one text line (glyph cell)
export const INSET = 10; // FUN_0071b900
export const TITLE_GAP = 6; // 0x00971414 with flag 0x40
export const SELECTED = '#ffc19a';
export const DISABLED = '#909090'; // 0xff909090

export interface ListItem {
  label: string;
  value: number;
  enabled: boolean;
}

export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function listWindowHeight(items: number, titled: boolean): number {
  return items * (LINE + 6) - 6 + 2 * INSET + (titled ? TITLE_GAP : 0);
}

// Title pill with the game font, text centred in the pill 4 px below its top.
export function drawWindowTitle(ctx: CanvasRenderingContext2D, skin: WindowSkin, x: number, y: number, title: string, state = 1): void {
  const tw = gameTextWidth(title);
  drawTitlePill(ctx, skin.frame, x, y - 13, tw, state);
  drawGameText(ctx, title, x + (pillWidth(tw) - tw) / 2, y - 13 + 4 + 1, '#120400');
}

// A pill of f256_hyouji.prs texture 1 with a middle of `mid` px
// (RenderTextCharacter_00760b74: 40 px caps, the middle stretched from texels
// u + 20..u + 60; rows by state from table 0x00974bf8: 0 teal (0, 98),
// 1 orange (0, 125), 2 green (0, 152), 3 teal (80, 98)).
const PILL_UV: ReadonlyArray<readonly [number, number]> = [[0, 98], [0, 125], [0, 152], [80, 98]];
export function drawPill(ctx: CanvasRenderingContext2D, tex: CanvasImageSource, x: number, y: number, mid: number, state = 1): void {
  const [u, v] = PILL_UV[state];
  ctx.drawImage(tex, u, v, 40, 27, x, y, 40, 27);
  if (mid > 0) ctx.drawImage(tex, u + 20, v, 40, 27, x + 40, y, mid, 27);
  ctx.drawImage(tex, u + 40, v, 40, 27, x + 40 + Math.max(0, mid), y, 40, 27);
}

// A titled list window at (x, y) of width w.
export function drawListWindow(
  ctx: CanvasRenderingContext2D,
  skin: WindowSkin,
  x: number,
  y: number,
  w: number,
  title: string | null,
  items: readonly ListItem[],
  cursor: number,
  showCursor = true,
  colorOf?: (item: ListItem) => string | undefined,
): WindowRect {
  const h = listWindowHeight(items.length, title !== null);
  drawWindowFrame(ctx, skin.frame, x, y, w, h);
  const cx = x + INSET;
  const cy = y + INSET + (title !== null ? TITLE_GAP : 0);
  if (showCursor && cursor >= 0 && cursor < items.length) drawSelectBar(ctx, skin.bars, cx, cy + cursor * ROW, w - 2 * INSET, 16);
  items.forEach((it, i) => {
    const tw = gameTextWidth(it.label);
    const color = !it.enabled ? DISABLED : (colorOf?.(it) ?? (showCursor && i === cursor ? SELECTED : '#ffffff'));
    drawGameText(ctx, it.label, x + (w - tw) / 2, cy + i * ROW + 1, color);
  });
  if (title !== null) drawWindowTitle(ctx, skin, x, y, title);
  return { x, y, w, h };
}

// Plain text window (FUN_0073aa40 / ListWindowObject_AddItem_0073ae38): the
// text starts 10 px inside the frame, 20 px per line.
export function drawTextWindow(ctx: CanvasRenderingContext2D, skin: WindowSkin, r: WindowRect, text: string, color = '#ffffff'): void {
  drawWindowFrame(ctx, skin.frame, r.x, r.y, r.w, r.h);
  drawGameText(ctx, text, r.x + INSET, r.y + INSET, color);
}

// Cursor over a list: arrows wrap, Enter / Backspace report. Returns the
// decision for the caller ('none' when the key was not for the list).
export type ListKey = 'move' | 'decide' | 'cancel' | 'buzzer' | 'none';

export function listKey(e: KeyboardEvent, items: readonly ListItem[], state: { cursor: number }): ListKey {
  const n = items.length;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (!n) return 'none';
    state.cursor = (state.cursor + (e.key === 'ArrowUp' ? n - 1 : 1)) % n;
    se(SE.cursor);
    return 'move';
  }
  if (e.key === 'Enter') {
    const it = items[state.cursor];
    if (!it || !it.enabled) {
      se(SE.buzzer);
      return 'buzzer';
    }
    se(SE.ok);
    return 'decide';
  }
  if (e.key === 'Backspace' || e.key === 'Escape') {
    se(SE.cancel);
    return 'cancel';
  }
  return 'none';
}

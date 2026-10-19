// "Input UserID" window, opened by the title's Login menu (Register UserID).
// The logic is InputUserIdWindow in classic/titleflow.ts; this draws it.
//
// Decompiled from PsoBB.exe (Ephinea 1.25.13),
// ChallengePlayerInputWindow_Constructor_00762224:
//   CreateChatShortcutMenuYesNoWindow_0073840c(x 140, y 330, w 360, h 100, 4 items)
//   title  unitxt(41, 8)  "Input UserID"
//   item 0 unitxt(41, 9)  "UserID"   : user name      (AddInfoCounterItem_00738a04)
//   item 1 unitxt(41, 10) "Password" : '*' per character
//   item 2 unitxt(41, 1)  "Confirm"                    (ProcessNextInfoCounter_007389cc)
//   item 3 unitxt(41, 0)  "Cancel"
// Label/value rows (RenderInfoCounterEntity_0072e930): label at the content x,
// ':' at +154 (0x00970f50), value at +166 (+12, 0x00970f4c).
// Plain rows (SetInfoCounterText_0072ea1c): x = 202.5 - width / 2
// (0x00970f48, 0x00970f44).
// Enter on a value row opens a text editor (TKeyboardControl) on that row's
// value column, (316, 346) / (316, 366): the row's own value is blanked
// (UpdateItemSecondaryText(null)) and the editor draws the typed text
// (password: '*' each, flag 0x2000) with a 5 x 14 green caret block
// (TextInputCursor_Render_007307a8). Confirm is drawn greyed (0xff909090,
// SetItemColorById_00738a9c) until both fields hold something.
// The window frame, title pill and selection bar are the generic renderer in
// stage.ts.

import { drawText, drawTitlePill, drawSelectBar, drawWindowFrame, FONT, ITEM_HEIGHT, ITEM_STEP, pillWidth, WINDOW_FONT, type WindowSkin } from './stage.ts';
import { CARET, caretColor, DISABLED_COLOR, EDITOR_POS, INPUT_WINDOW, type InputUserIdWindow, type MenuText } from './titleflow.ts';
import { withWindowAnim } from './windowanim.ts';

export function drawInputWindow(ctx: CanvasRenderingContext2D, skin: WindowSkin, win: InputUserIdWindow, text: MenuText['input'], frame: number): void {
  const { x, y, w, h } = INPUT_WINDOW;
  withWindowAnim(ctx, win.anim, x, y, w, h, () => {
    drawWindowFrame(ctx, skin.frame, x, y, w, h);
    const cx = x + 10;
    const cy = y + 16;
    const style = { size: WINDOW_FONT, shadow: 'rgba(0,0,0,0.85)' };
    const values = win.values();
    [text.user, text.password].forEach((label, i) => {
      const ty = cy + i * ITEM_STEP + 7.5;
      drawText(ctx, label, cx, ty, { ...style, color: '#ffffff' });
      drawText(ctx, ':', cx + 154, ty, { ...style, color: '#ffffff' });
      drawText(ctx, values[i], cx + 166, ty, { ...style, color: '#ffffff' });
    });
    ctx.font = `bold ${WINDOW_FONT}px ${FONT}`;
    [text.confirm, text.cancel].forEach((label, i) => {
      const tw = ctx.measureText(label).width;
      const color = i === 0 && !win.confirmEnabled ? DISABLED_COLOR : '#ffffff';
      drawText(ctx, label, cx + 202.5 - tw / 2, cy + (i + 2) * ITEM_STEP + 7.5, { ...style, color });
    });
    if (!win.editor) drawSelectBar(ctx, skin.bars, cx, cy + win.row * ITEM_STEP, w - 20, ITEM_HEIGHT);

    ctx.font = `bold ${WINDOW_FONT}px ${FONT}`;
    const tw = ctx.measureText(text.title).width;
    drawTitlePill(ctx, skin.frame, x, y - 13, tw, 1);
    drawText(ctx, text.title, x + pillWidth(tw) / 2, y - 13 + 4 + 7.5, { size: WINDOW_FONT, color: '#120400', align: 'center' });
  });

  const ed = win.editor;
  if (!ed) return;
  const [ex, ey] = EDITOR_POS[ed.field];
  const shown = ed.edit.shown;
  drawText(ctx, shown, ex, ey + 7.5, { size: WINDOW_FONT, color: '#ffffff', shadow: 'rgba(0,0,0,0.85)' });
  ctx.font = `bold ${WINDOW_FONT}px ${FONT}`;
  const caretX = ex + ctx.measureText(shown).width;
  ctx.fillStyle = caretColor(frame);
  ctx.fillRect(caretX, ey, CARET.w, CARET.h);
}

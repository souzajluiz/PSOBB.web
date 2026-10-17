// "Input UserID" window, opened from the title's Login menu.
//
// Decompiled from PsoBB.exe (Ephinea 1.25.13), the constructor at the
// ChallengePlayerInputWindow vtable (psobb.c ~735490):
//   CreateChatShortcutMenuYesNoWindow_0073840c(x 140, y 330, w 360, h 100, 4 items)
//   title  unitxt(41, 8)  "Input UserID"
//   item 0 unitxt(41, 9)  "UserID"   : user name      (AddInfoCounterItem_00738a04)
//   item 1 unitxt(41, 10) "Password" : '*' per char, at most 8 (16 for some builds)
//   item 2 unitxt(41, 1)  "Confirm"                    (ProcessNextInfoCounter_007389cc)
//   item 3 unitxt(41, 0)  "Cancel"
// Label/value rows (RenderInfoCounterEntity_0072e930): label at the content x,
// ':' at +154 (0x00970f50), value at +166 (+12, 0x00970f4c).
// Plain rows (SetInfoCounterText_0072ea1c): x = 202.5 - width / 2
// (0x00970f48, 0x00970f44).
// The window frame, title pill and selection bar are the generic renderer in
// stage.ts. The original edits each field in a sub-window; here the selected
// field takes keystrokes directly.

import { se, SE } from '../audio/se.ts';
import { drawText, drawTitlePill, drawSelectBar, drawWindowFrame, FONT, inWindowSpace, ITEM_HEIGHT, ITEM_STEP, pillWidth, WINDOW_FONT, type Screen, type Stage, type WindowSkin } from './stage.ts';

export interface LoginHandlers {
  submit: (username: string, password: string) => void;
  cancel: () => void;
}

const WIN = { x: 140, y: 330, w: 360, h: 100 };
const TEXT = { title: 'Input UserID', user: 'UserID', password: 'Password', confirm: 'Confirm', cancel: 'Cancel' };
const MAX_PASSWORD_MASK = 16;

export class LoginScreen implements Screen {
  private behind: Screen;
  private skin: WindowSkin;
  private handlers: LoginHandlers;
  private fields = ['', ''];
  private row = 0; // 0 UserID, 1 Password, 2 Confirm, 3 Cancel
  status = '';
  busy = false;
  readonly pointerSpace = 'window';

  constructor(behind: Screen, skin: WindowSkin, handlers: LoginHandlers, username = '') {
    this.behind = behind;
    this.skin = skin;
    this.handlers = handlers;
    this.fields[0] = username;
    if (username) this.row = 1;
  }

  update(dt: number, stage: Stage): void {
    this.behind.update(dt, stage);
  }

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    this.behind.draw(ctx, stage);
    inWindowSpace(ctx, stage, () => this.drawWindow(ctx, stage));
  }

  private drawWindow(ctx: CanvasRenderingContext2D, stage: Stage): void {
    const { x, y, w, h } = WIN;
    drawWindowFrame(ctx, this.skin.frame, x, y, w, h);
    const cx = x + 10;
    const cy = y + 16;
    const style = { size: WINDOW_FONT, shadow: 'rgba(0,0,0,0.85)' };
    const caret = Math.floor(stage.time * 2) % 2 === 0 ? '_' : '';
    const values = [this.fields[0], '*'.repeat(Math.min(this.fields[1].length, MAX_PASSWORD_MASK))];
    [TEXT.user, TEXT.password].forEach((label, i) => {
      const ty = cy + i * ITEM_STEP + 7.5;
      drawText(ctx, label, cx, ty, { ...style, color: '#ffffff' });
      drawText(ctx, ':', cx + 154, ty, { ...style, color: '#ffffff' });
      drawText(ctx, values[i] + (i === this.row && !this.busy ? caret : ''), cx + 166, ty, { ...style, color: '#ffffff' });
    });
    ctx.font = `bold ${WINDOW_FONT}px ${FONT}`;
    [TEXT.confirm, TEXT.cancel].forEach((label, i) => {
      const tw = ctx.measureText(label).width;
      drawText(ctx, label, cx + 202.5 - tw / 2, cy + (i + 2) * ITEM_STEP + 7.5, { ...style, color: '#ffffff' });
    });
    if (!this.busy) drawSelectBar(ctx, this.skin.bars, cx, cy + this.row * ITEM_STEP, w - 20, ITEM_HEIGHT);

    const tw = ctx.measureText(TEXT.title).width;
    drawTitlePill(ctx, this.skin.frame, x, y - 13, tw, 1);
    drawText(ctx, TEXT.title, x + pillWidth(tw) / 2, y - 13 + 4 + 7.5, { size: WINDOW_FONT, color: '#120400', align: 'center' });

    const msg = this.busy ? 'Connecting..' : this.status;
    if (msg) drawText(ctx, msg, x + w / 2, y + h + 14, { size: WINDOW_FONT, color: this.status && !this.busy ? '#ff9a7a' : '#ffffff', align: 'center', shadow: 'rgba(0,0,0,0.85)' });
  }

  key(e: KeyboardEvent): void {
    if (this.busy) return;
    // Window list 0x007384xx..0x007388d0: SE 0x56f cursor, 0x570 confirm, 0x585 cancel.
    if (e.key === 'Escape') return (se(SE.cancel), this.handlers.cancel());
    if (e.key === 'ArrowDown' || e.key === 'Tab') {
      this.row = (this.row + 1) % 4;
      return se(SE.cursor);
    }
    if (e.key === 'ArrowUp') {
      this.row = (this.row + 3) % 4;
      return se(SE.cursor);
    }
    if (e.key === 'Enter') {
      if (this.row === 3) return (se(SE.cancel), this.handlers.cancel());
      se(SE.ok);
      if (this.row === 0 && this.fields[0]) {
        this.row = 1;
        return;
      }
      if (this.fields[0] && this.fields[1]) this.handlers.submit(this.fields[0], this.fields[1]);
      else this.row = this.fields[0] ? 1 : 0;
      return;
    }
    if (this.row > 1) return;
    if (e.key === 'Backspace') {
      this.fields[this.row] = this.fields[this.row].slice(0, -1);
      return;
    }
    if (e.key.length === 1 && /[ -~]/.test(e.key) && this.fields[this.row].length < 16) {
      this.fields[this.row] += e.key;
      this.status = '';
    }
  }

  pointer(vx: number, vy: number, click: boolean): void {
    if (this.busy || vx < WIN.x || vx > WIN.x + WIN.w) return;
    const i = Math.floor((vy - (WIN.y + 16)) / ITEM_STEP);
    if (i < 0 || i > 3) return;
    this.row = i;
    if (click && i >= 2) this.key(new KeyboardEvent('keydown', { key: 'Enter' }));
  }
}

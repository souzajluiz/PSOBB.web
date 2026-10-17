// Game ID / password window drawn over the title screen.
// The original client takes credentials in its launcher; the web client has no
// launcher, so it asks here using the same window style as the title menu.

import { drawPanel, drawPill, drawSelectBar, drawText, type Screen, type Stage } from './stage.ts';

export interface LoginHandlers {
  submit: (username: string, password: string) => void;
  cancel: () => void;
}

export class LoginScreen implements Screen {
  private behind: Screen;
  private handlers: LoginHandlers;
  private fields = ['', ''];
  private field = 0;
  status = '';
  busy = false;

  constructor(behind: Screen, handlers: LoginHandlers, username = '') {
    this.behind = behind;
    this.handlers = handlers;
    this.fields[0] = username;
    if (username) this.field = 1;
  }

  update(dt: number, stage: Stage): void {
    this.behind.update(dt, stage);
  }

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    this.behind.draw(ctx, stage);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, 640, 480);
    const x = 200, y = 300, w = 240, h = 104;
    drawPanel(ctx, x, y + 13, w, h);
    drawPill(ctx, x + 1, y, 131, 24);
    drawText(ctx, 'Login', x + 66, y + 12.5, { size: 9.5, color: '#120400', align: 'center' });
    const labels = ['Game ID', 'Password'];
    labels.forEach((label, i) => {
      const fy = y + 46 + i * 24;
      if (i === this.field) drawSelectBar(ctx, x + 8, fy - 5, w - 16, 10, 0.6);
      drawText(ctx, label, x + 14, fy, { size: 9.5, color: '#ffffff', shadow: 'rgba(0,0,0,0.6)' });
      const value = i === 1 ? '*'.repeat(this.fields[1].length) : this.fields[0];
      const caret = i === this.field && Math.floor(stage.time * 2) % 2 === 0 ? '_' : '';
      drawText(ctx, value + caret, x + 82, fy, { size: 9.5, color: '#f2c94c', shadow: 'rgba(0,0,0,0.6)' });
    });
    drawText(ctx, this.busy ? 'Connecting..' : this.status || 'Enter: OK    Esc: Cancel', x + w / 2, y + 104, {
      size: 8.5,
      color: this.status ? '#ff9a7a' : '#cfe8ee',
      align: 'center',
    });
  }

  key(e: KeyboardEvent): void {
    if (this.busy) return;
    if (e.key === 'Escape') return this.handlers.cancel();
    if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      this.field = 1 - this.field;
      return;
    }
    if (e.key === 'Enter') {
      if (this.field === 0 && this.fields[0]) {
        this.field = 1;
        return;
      }
      if (this.fields[0] && this.fields[1]) this.handlers.submit(this.fields[0], this.fields[1]);
      return;
    }
    if (e.key === 'Backspace') {
      this.fields[this.field] = this.fields[this.field].slice(0, -1);
      return;
    }
    if (e.key.length === 1 && /[ -~]/.test(e.key) && this.fields[this.field].length < 16) {
      this.fields[this.field] += e.key;
      this.status = '';
    }
  }
}

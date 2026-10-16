// "Classic" UI stage: reproduces the original client's 2D screens.
//
// The game lays its 2D UI out in a 640x480 virtual screen and stretches it to
// the window (the reference captures are 16:10, so everything is wider than
// tall by 1.2x). The stage draws with a Canvas2D transform from that virtual
// space to device pixels, so coordinates measured from the original map 1:1.
// Elements the original keeps round on screen (the title circle) use
// drawRound*, which compensates for the stretch.

import type { XvrTexture } from '../formats/xvm.ts';

export const VW = 640;
export const VH = 480;
export const FONT = 'Tahoma, Verdana, sans-serif';

export interface Screen {
  enter?(stage: Stage): void;
  update(dt: number, stage: Stage): void;
  draw(ctx: CanvasRenderingContext2D, stage: Stage): void;
  key?(e: KeyboardEvent, stage: Stage): void;
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
    const loop = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.time += dt;
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
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.screen) return;
    this.screen.update(dt, this);
    ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    ctx.imageSmoothingEnabled = true;
    this.screen.draw(ctx, this);
  }

  // Draws the current screen into another context of size w x h (no update).
  renderTo(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const [sx, sy] = [this.sx, this.sy];
    this.sx = w / VW;
    this.sy = h / VH;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    this.screen?.draw(ctx, this);
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Horizontal scanlines, the signature of PSOBB windows.
function scanlines(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, dark: string, light: string, period = 2.4): void {
  for (let yy = y; yy < y + h; yy += period) {
    ctx.fillStyle = light;
    ctx.fillRect(x, yy, w, period * 0.5);
    ctx.fillStyle = dark;
    ctx.fillRect(x, yy + period * 0.5, w, period * 0.5);
  }
}

// Teal menu panel with rounded corners, light rim and scanlines.
export function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, 5);
  ctx.clip();
  scanlines(ctx, x, y, w, h, 'rgba(6, 46, 56, 0.78)', 'rgba(22, 92, 104, 0.78)');
  ctx.restore();
  roundRect(ctx, x, y, w, h, 5);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#05080a';
  ctx.stroke();
  roundRect(ctx, x + 0.8, y + 0.8, w - 1.6, h - 1.6, 4.4);
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = 'rgba(205, 215, 220, 0.85)';
  ctx.stroke();
}

// Orange title pill ("Login") with a bright center band.
export function drawPill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#7a2a08');
  g.addColorStop(0.18, '#e2560c');
  g.addColorStop(0.42, '#ffb030');
  g.addColorStop(0.55, '#ff8a12');
  g.addColorStop(0.85, '#d04608');
  g.addColorStop(1, '#6a2006');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  for (let yy = y; yy < y + h; yy += 2.4) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(x, yy + 1.2, w, 1.2);
  }
  ctx.restore();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#3a1404';
  ctx.stroke();
}

// Translucent orange highlight behind the selected menu item.
export function drawSelectBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha = 1): void {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgba(150, 70, 30, ${0.55 * alpha})`);
  g.addColorStop(0.5, `rgba(240, 140, 80, ${0.85 * alpha})`);
  g.addColorStop(1, `rgba(150, 70, 30, ${0.55 * alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

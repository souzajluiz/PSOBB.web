// Title screen, reproduced from the psobb.io client (reference capture
// docs/reference: title.png) with the textures of title.prs.
//
// title.prs (XVM, 21 textures):
//   0      "PRESS ENTER KEY" + Japanese menu labels (256x256, DXT3)
//   1, 2   logo layers (black letters with white rim) drawn over the background at (64,62) and (320,62)
//   3-10   background, 640x512 in tiles: 256x256 at (0,0) (0,256) (256,0) (256,256),
//          128x128 at (512,0) (512,128) (512,256) (512,384)
//   11     magic circle (512x512)
//   12     small rings
//   13-20  the same background with a stronger flare (cross-faded for the shine)

import { drawPanel, drawPill, drawSelectBar, drawText, type Screen, type Stage } from './stage.ts';

const TILE_POS: Array<[number, number]> = [
  [0, 0], [0, 256], [256, 0], [256, 256], [512, 0], [512, 128], [512, 256], [512, 384],
];

export interface TitleMenuItem {
  label: string;
  color?: string;
  action: () => void;
}

// Layout measured from the reference capture, in 640x480 virtual pixels.
const MENU = {
  pill: { x: 230, y: 288, w: 131, h: 24 },
  panel: { x: 229, y: 301, w: 182, h: 116 },
  firstItemY: 323,
  itemStep: 20,
  centerX: 320,
  bar: { x: 238, w: 164, h: 8 },
};

// Rendering parameters tuned against the reference capture (tools/compare.sh).
// Values found by SSIM search against the capture (flare layer: SSIM 0.83 -> 0.90
// on the left background; circle: best of 4 grids, full-frame SSIM 0.727).
export const TITLE_TUNING = {
  flareMode: 'alpha' as 'none' | 'alpha' | 'add',
  flareAlpha: 1,
  flarePulse: 0,
  circleAlpha: 0.8,
  circleSize: 385,
  circleX: 345,
  circleY: 256,
  circleAngle: -0.2,
  circleSpin: 0.02,
  circleGlow: 0.3,
  menuFont: 9.5,
  // Horizontal light beam left of the logo (additive).
  beamY: 201,
  beamLength: 280,
  beamHeight: 24,
  beamAlpha: 1,
  rays: 14,
};

export class TitleScreen implements Screen {
  private bgA: ImageBitmap[];
  private bgB: ImageBitmap[];
  private press: ImageBitmap;
  private logo: ImageBitmap[];
  private items: TitleMenuItem[];
  private selected = 0;
  private versionText: string;
  title = 'Login';

  // `c`: title.prs textures as bitmaps; `tintedCircle`: texture 11 pre-tinted (see tintCircle).
  constructor(c: ImageBitmap[], tintedCircle: ImageBitmap, items: TitleMenuItem[], versionText: string) {
    this.tinted = tintedCircle;
    this.bgA = c.slice(3, 11);
    this.bgB = c.slice(13, 21);
    this.press = c[0];
    this.logo = [c[1], c[2]];
    this.items = items;
    this.versionText = versionText;
  }

  update(): void {}

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    // Background (two layers, the second carries the brighter flare).
    const t = TITLE_TUNING;
    TILE_POS.forEach(([x, y], i) => ctx.drawImage(this.bgA[i], x, y));
    if (t.flareMode !== 'none') {
      ctx.save();
      if (t.flareMode === 'add') ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.max(0, t.flareAlpha + t.flarePulse * Math.sin(stage.time * 1.6));
      TILE_POS.forEach(([x, y], i) => ctx.drawImage(this.bgB[i], x, y));
      ctx.restore();
    }

    // Magic circle, tinted cyan and added on top, slowly turning. It stays
    // round on screen, so it is drawn in device space (300 virtual px wide).
    const d = t.circleSize * stage.sx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, t.circleX * stage.sx, t.circleY * stage.sy);
    ctx.rotate(t.circleAngle + stage.time * t.circleSpin);
    ctx.globalCompositeOperation = 'lighter';
    if (t.circleGlow > 0) {
      ctx.globalAlpha = t.circleGlow;
      ctx.filter = `blur(${Math.max(1, d / 160)}px)`;
      ctx.drawImage(this.tinted, -d / 2, -d / 2, d, d);
      ctx.filter = 'none';
    }
    ctx.globalAlpha = t.circleAlpha;
    ctx.drawImage(this.tinted, -d / 2, -d / 2, d, d);
    ctx.restore();

    this.drawBeam(ctx, stage);
    ctx.drawImage(this.logo[0], 64, 62);
    ctx.drawImage(this.logo[1], 320, 62);

    // Faint "PRESS ENTER KEY" behind the window, as in the original.
    ctx.globalAlpha = 0.18;
    ctx.drawImage(this.press, 28, 4, 200, 26, 240, 342, 167, 22);
    ctx.globalAlpha = 1;

    // Login window.
    const m = MENU;
    drawPanel(ctx, m.panel.x, m.panel.y, m.panel.w, m.panel.h);
    drawPill(ctx, m.pill.x, m.pill.y, m.pill.w, m.pill.h);
    drawText(ctx, this.title, m.pill.x + m.pill.w / 2, m.pill.y + m.pill.h / 2 + 0.5, { size: TITLE_TUNING.menuFont, color: '#120400', align: 'center' });
    this.items.forEach((item, i) => {
      const y = m.firstItemY + i * m.itemStep;
      if (i === this.selected) {
        drawSelectBar(ctx, m.bar.x, y - m.bar.h / 2, m.bar.w, m.bar.h, 0.75 + 0.25 * Math.sin(stage.time * 6));
      }
      const color = i === this.selected ? '#ffc19a' : item.color ?? '#ffffff';
      drawText(ctx, item.label, m.centerX, y + 0.5, { size: TITLE_TUNING.menuFont, color, align: 'center', shadow: 'rgba(0,0,0,0.6)' });
    });

    // The original prints its version in a wide, letter-spaced debug font.
    ctx.letterSpacing = '1.6px';
    drawText(ctx, this.versionText, 9, 467, { size: 10.5, color: '#f4f4f4', bold: false, shadow: '#000' });
    ctx.letterSpacing = '0px';
  }

  private tinted: ImageBitmap;

  private drawBeam(ctx: CanvasRenderingContext2D, stage: Stage): void {
    const t = TITLE_TUNING;
    const pulse = 0.9 + 0.1 * Math.sin(stage.time * 3);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = t.beamAlpha * pulse;
    // Fades in from the left edge and out toward the logo.
    const gx = ctx.createLinearGradient(0, 0, t.beamLength, 0);
    gx.addColorStop(0, 'rgba(150, 200, 255, 0.85)');
    gx.addColorStop(0.55, 'rgba(225, 240, 255, 1)');
    gx.addColorStop(1, 'rgba(120, 190, 255, 0)');
    for (const [h, a] of [[t.beamHeight, 0.35], [t.beamHeight * 0.45, 0.6], [t.beamHeight * 0.15, 1]] as const) {
      ctx.globalAlpha = t.beamAlpha * pulse * a;
      ctx.fillStyle = gx;
      ctx.beginPath();
      ctx.ellipse(t.beamLength * 0.35, t.beamY, t.beamLength * 0.65, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Thin rays fanning out of the beam, slowly flickering.
    ctx.lineWidth = 0.4;
    for (let i = 0; i < t.rays; i++) {
      const a = ((i / t.rays) - 0.5) * 1.2 + 0.05 * Math.sin(stage.time * 2 + i);
      const len = 120 + 60 * ((i * 37) % 10) / 10;
      ctx.globalAlpha = t.beamAlpha * (0.25 + 0.2 * Math.sin(stage.time * 4 + i * 1.7));
      ctx.strokeStyle = 'rgb(110, 150, 255)';
      ctx.beginPath();
      ctx.moveTo(150, t.beamY);
      ctx.lineTo(150 - Math.cos(a) * len, t.beamY + Math.sin(a) * len * 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }

  key(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') this.selected = (this.selected + 1) % this.items.length;
    else if (e.key === 'ArrowUp') this.selected = (this.selected + this.items.length - 1) % this.items.length;
    else if (e.key === 'Enter') this.items[this.selected].action();
  }

  // Mouse support: virtual coordinates -> menu item.
  pointer(vx: number, vy: number, click: boolean): void {
    const m = MENU;
    if (vx < m.panel.x || vx > m.panel.x + m.panel.w) return;
    const i = Math.round((vy - m.firstItemY) / m.itemStep);
    if (i < 0 || i >= this.items.length) return;
    this.selected = i;
    if (click) this.items[i].action();
  }
}

// Texture 11 tinted cyan, as the original draws it.
export async function tintCircle(circle: ImageBitmap): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(circle.width, circle.height);
  const g = c.getContext('2d')!;
  g.drawImage(circle, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = '#1aa6c8';
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(circle, 0, 0);
  return createImageBitmap(c);
}

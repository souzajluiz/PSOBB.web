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

// Values decompiled from PsoBB.exe (Ephinea build, 1.25.13):
//   title background render  FUN_006f475c
//   logo / version render    FUN_006f4cc4
//   static init              0x006f4bb0
// Coordinates are in the 640x480 virtual screen. The title runs on a frame
// counter (game logic at 30 fps); the effect cycle is 300 frames.
const RE = {
  fps: 30,
  // FUN_00415ab0/00415bcc tile table 0x009a3840: {x, y, w, h, texture offset}
  tiles: [
    [512, 384, 128, 128, 7], [512, 256, 128, 128, 6], [512, 128, 128, 128, 5], [512, 0, 128, 128, 4],
    [0, 256, 256, 256, 1], [0, 0, 256, 256, 0], [256, 256, 256, 256, 3], [256, 0, 256, 256, 2],
  ] as const,
  baseLayer: 3, // drawn at z -130
  flareLayer: 13, // drawn at z -150, in front of the base layer
  center: [320, 220] as const, // 0x00a96918 / 0x00a9691c
  framesPerTurn: 900, // angle = frame * 0x10000 / 900 (BAMS)
  // FUN_007a919c(0, 0x58, 0x73, frame, 300, 150, 165, 180): RGB(0,88,115) pulsing to white
  color: [0, 88, 115] as const,
  pulse: [300, 150, 165, 180] as const,
  ring: { texture: 11, size: 430, uv: [0, 0, 0.84] }, // rotates by -angle
  innerRing: { texture: 12, size: 178, uv: [0, 0, 0.348] }, // rotates by +angle
  node: { texture: 12, size: 104, uv: [0.3496, 0, 0.203] },
  nodeOffsets: [[-137, -79], [137, -79], [0, 156]] as const, // 0x0096e168
  logo: [[1, 64, 61], [2, 320, 61]] as const,
  version: [10, 460] as const,
};

// Not decompiled yet: the light beam/rays are particle effects 0x1e3-0x1e5
// created by the title constructor (FUN_006f8130). Approximated procedurally.
export const TITLE_TUNING = {
  // psobb.io's widescreen patch keeps the rotating circle quads round while the
  // 4:3 layout is stretched to 16:10; 1/1.2 undoes the stretch around x=320.
  circleAspect: 1 / 1.2,
  menuFont: 9.5,
  beamY: 201,
  beamLength: 280,
  beamHeight: 24,
  beamAlpha: 1,
  rays: 14,
};

export class TitleScreen implements Screen {
  private tex: ImageBitmap[];
  private press: ImageBitmap;
  private tintCache = new Map<string, OffscreenCanvas>();
  private items: TitleMenuItem[];
  private selected = 0;
  private versionText: string;
  title = 'Login';

  // `c`: the 21 textures of title.prs as bitmaps.
  constructor(c: ImageBitmap[], items: TitleMenuItem[], versionText: string) {
    this.tex = c;
    this.press = c[0];
    this.items = items;
    this.versionText = versionText;
  }

  update(): void {}

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    const frame = stage.time * RE.fps;
    // Background: base layer, then the flare layer in front of it.
    for (const layer of [RE.baseLayer, RE.flareLayer]) {
      for (const [x, y, w, h, i] of RE.tiles) ctx.drawImage(this.tex[layer + i], x, y, w, h);
    }

    // Magic circle: additive, colored by the pulse.
    const [r, g, b] = pulseColor(frame);
    const angle = ((frame % RE.framesPerTurn) / RE.framesPerTurn) * Math.PI * 2;
    const [cx, cy] = RE.center;
    const tinted = (texture: number) => this.tinted(texture, r, g, b);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, 0);
    ctx.scale(TITLE_TUNING.circleAspect, 1);
    ctx.translate(-cx, 0);
    drawRotated(ctx, tinted(RE.ring.texture), RE.ring.uv, cx, cy, RE.ring.size, -angle);
    drawRotated(ctx, tinted(RE.innerRing.texture), RE.innerRing.uv, cx, cy, RE.innerRing.size, angle);
    for (const [ox, oy] of RE.nodeOffsets) {
      const nx = cx - ox * Math.cos(angle) + oy * Math.sin(angle);
      const ny = cy + ox * Math.sin(angle) + oy * Math.cos(angle);
      drawRotated(ctx, tinted(RE.node.texture), RE.node.uv, nx, ny, RE.node.size, angle);
    }
    ctx.restore();

    this.drawBeam(ctx, stage);
    for (const [i, x, y] of RE.logo) ctx.drawImage(this.tex[i], x, y, 256, 256);

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
    drawText(ctx, this.versionText, RE.version[0], RE.version[1] + 6, { size: 10.5, color: '#f4f4f4', bold: false, shadow: '#000' });
    ctx.letterSpacing = '0px';
  }

  // Texture multiplied by a vertex color, as D3D does with diffuse * texture.
  // Colors are quantized so the pulse needs only a few cached variants.
  private tinted(texture: number, r: number, g: number, b: number): OffscreenCanvas {
    const q = (v: number) => Math.round(v / 16) * 16;
    const key = `${texture}:${q(r)},${q(g)},${q(b)}`;
    let c = this.tintCache.get(key);
    if (!c) {
      const src = this.tex[texture];
      c = new OffscreenCanvas(src.width, src.height);
      const g2 = c.getContext('2d')!;
      g2.drawImage(src, 0, 0);
      g2.globalCompositeOperation = 'multiply';
      g2.fillStyle = `rgb(${Math.min(255, q(r))}, ${Math.min(255, q(g))}, ${Math.min(255, q(b))})`;
      g2.fillRect(0, 0, c.width, c.height);
      g2.globalCompositeOperation = 'destination-in';
      g2.drawImage(src, 0, 0);
      this.tintCache.set(key, c);
    }
    return c;
  }

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

// FUN_007a919c: base color, lerped to white between frames 150 -> 165 -> 180 of 300.
function pulseColor(frame: number): [number, number, number] {
  const [period, a, peak, b] = RE.pulse;
  const f = Math.floor(frame) % period;
  let t = 0;
  if (f >= a && f <= b) t = f < peak ? (f - a) / (peak - a) : (b - f) / (b - peak);
  return RE.color.map((c) => Math.round((255 - c) * t + c)) as [number, number, number];
}

// FUN_006f46c4 + FUN_0082bb74: a size x size quad centered at (cx, cy),
// rotated by `angle`, sampling the square UV region (u, v, extent).
function drawRotated(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  uv: readonly number[],
  cx: number,
  cy: number,
  size: number,
  angle: number,
): void {
  const [u, v, e] = uv;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.drawImage(img, u * img.width, v * img.height, e * img.width, e * img.height, -size / 2, -size / 2, size, size);
  ctx.restore();
}

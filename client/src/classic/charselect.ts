// SELECT CHARACTER screen, reproduced from the psobb.io capture (select.png).
// Layout: 4:3 virtual screen anchored left ('left43'); measurements below are
// in 640x480 virtual pixels (capture pixels * 0.384 at 2000x1250).
//
// Textures:
//   f512_midashi_eng.prs[0]  row 0 = "SELECT CHARACTER" header with orange streak
//   f256_tag_eng.prs[0]      row 0 = "CHARACTERS" tag text
//   f256_backtext.prs[0..4]  glyph tunnel background (animation frames)

import { CLASS_NAMES, type CharacterPreview } from '../net/bbsession.ts';
import { drawText, FONT, type Screen, type Stage } from './stage.ts';

export interface CharSelectAssets {
  header: ImageBitmap; // f512_midashi_eng[0]
  tag: ImageBitmap; // f256_tag_eng[0]
  tunnel: ImageBitmap[]; // f256_backtext
}

const BLUE = 'rgb(38, 130, 205)';
const GREEN = 'rgb(96, 178, 96)';

const SLOT = { x: 131.3, w: 179.7, h: 38.4, tops: [182.4, 225.4, 268.4, 311.4] };

export interface CharSelectHandlers {
  enter: (slot: number) => void;
  cancel: () => void;
}

export class CharSelectScreen implements Screen {
  layout = 'left43' as const;
  private assets: CharSelectAssets;
  private slots: Array<CharacterPreview | null>;
  private handlers: CharSelectHandlers;
  selected = 0;
  message = 'Please select character.';

  constructor(assets: CharSelectAssets, slots: Array<CharacterPreview | null>, handlers: CharSelectHandlers) {
    this.assets = assets;
    this.slots = slots;
    this.handlers = handlers;
  }

  setSlots(slots: Array<CharacterPreview | null>): void {
    this.slots = slots;
  }

  update(): void {}

  drawFullscreen(ctx: CanvasRenderingContext2D, w: number, h: number, stage: Stage): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const frames = this.assets.tunnel;
    const f = frames[Math.floor(stage.time * 8) % frames.length];
    ctx.drawImage(f, 0, 0, w, h);
    drawTunnelGrid(ctx, w, h, stage.time);
  }

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    this.drawFrameLines(ctx);

    // Header "SELECT CHARACTER" (texture row 0: 512 x 40).
    ctx.drawImage(this.assets.header, 0, 0, 512, 40, 88, 44, 461, 36);

    // Left frame and the CHARACTERS tag.
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 1.1;
    ctx.strokeRect(17.3, 132.5, 408.2, 229.2);
    this.drawTag(ctx);

    // Inner green panel with the notched top-right corner.
    ctx.beginPath();
    ctx.moveTo(123.6, 153.6);
    ctx.lineTo(268, 153.6);
    ctx.lineTo(282.2, 174.7);
    ctx.lineTo(322.6, 174.7);
    ctx.lineTo(322.6, 355.2);
    ctx.lineTo(123.6, 355.2);
    ctx.closePath();
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    this.slots.forEach((slot, i) => this.drawSlot(ctx, i, slot, stage));

    // Scrollbar.
    ctx.fillStyle = 'rgb(40, 220, 40)';
    ctx.fillRect(314, 182.4, 2.6, 55.6);

    drawText(ctx, this.message, 322.6, 377.5, { size: 10, color: '#f2f2f2', shadow: 'rgba(0,0,0,0.7)' });

    this.drawKey(ctx, 156.7, 422, 30.7, 30, 'Enter', '#c8382c', '#6e1410');
    drawText(ctx, 'Enter', 188, 436.6, { size: 10, color: '#f2f2f2', shadow: 'rgba(0,0,0,0.7)' });
    this.drawKey(ctx, 302.6, 424, 24.6, 25, 'Esc', '#2f5fcf', '#1a2a8a');
    drawText(ctx, 'Cancel', 331, 436.6, { size: 10, color: '#f2f2f2', shadow: 'rgba(0,0,0,0.7)' });
  }

  private drawFrameLines(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 1.1;
    const poly = (pts: Array<[number, number]>) => {
      ctx.beginPath();
      ctx.moveTo(...pts[0]);
      for (const p of pts.slice(1)) ctx.lineTo(...p);
      ctx.stroke();
    };
    poly([[0, 44.2], [388, 44.2], [395.5, 33.8], [640, 33.8]]);
    poly([[0, 103], [234, 103], [245.8, 82.6], [640, 82.6]]);
    poly([[0, 108.3], [640, 108.3]]);
    poly([[0, 430.8], [19.2, 430.8], [57.6, 367.9], [640, 367.9]]);
    poly([[0, 442.4], [73, 442.4], [88.3, 417.4], [640, 417.4]]);
  }

  private drawTag(ctx: CanvasRenderingContext2D): void {
    // Elongated hexagon behind the tag text.
    const [x0, x1, y0, y1] = [133.6, 309, 116, 150.5];
    const ym = (y0 + y1) / 2;
    ctx.beginPath();
    ctx.moveTo(x0, ym);
    ctx.lineTo(x0 + 9, y0);
    ctx.lineTo(x1 - 9, y0);
    ctx.lineTo(x1, ym);
    ctx.lineTo(x1 - 9, y1);
    ctx.lineTo(x0 + 9, y1);
    ctx.closePath();
    ctx.fillStyle = 'rgba(8, 24, 60, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgb(70, 140, 230)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // "CHARACTERS" is row 0 of f256_tag_eng (about 170 x 32).
    ctx.drawImage(this.assets.tag, 0, 0, 170, 32, 145, 120.5, 153, 28.8);
  }

  private drawSlot(ctx: CanvasRenderingContext2D, i: number, slot: CharacterPreview | null, stage: Stage): void {
    const y = SLOT.tops[i];
    if (y === undefined) return;
    // Teal translucent bar; the grid behind shows through.
    ctx.fillStyle = 'rgba(30, 150, 120, 0.55)';
    ctx.fillRect(SLOT.x, y, SLOT.w, SLOT.h);
    // Blurred light band in the lower half: orange for the cursor.
    const selected = i === this.selected;
    const pulse = selected ? 0.85 + 0.15 * Math.sin(stage.time * 5) : 0;
    if (selected) {
      ctx.save();
      ctx.filter = `blur(${2.2 * stage.sy}px)`;
      ctx.fillStyle = `rgba(245, 190, 80, ${0.85 * pulse})`;
      ctx.fillRect(SLOT.x + 3, y + 18, SLOT.w - 6, 13);
      ctx.restore();
    }
    const title = slot ? slot.name : 'NEW  CHARACTER';
    ctx.save();
    ctx.font = `bold 11.5px ${FONT}`;
    ctx.letterSpacing = '0.4px';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 20, 20, 0.85)';
    ctx.strokeText(title, SLOT.x, y + 7);
    ctx.fillStyle = '#f4f4f4';
    ctx.fillText(title, SLOT.x, y + 7);
    ctx.restore();
    if (slot) {
      const info = `Lv${slot.level}  ${CLASS_NAMES[slot.charClass] ?? ''}`;
      drawText(ctx, info, SLOT.x + 4, y + 25, { size: 9.5, color: '#f4f4f4', shadow: 'rgba(0,0,0,0.7)' });
    }
  }

  private drawKey(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, face: string, edge: string): void {
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 2.5);
    ctx.fill();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, face);
    g.addColorStop(1, edge);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, w - 2, h - 4, 2);
    ctx.fill();
    drawText(ctx, label, x + 2.5, y + 9, { size: 9, color: label === 'Esc' ? '#c040ff' : '#ffb0a0', bold: false });
  }

  key(e: KeyboardEvent): void {
    const n = Math.max(1, this.slots.length);
    if (e.key === 'ArrowDown') this.selected = (this.selected + 1) % n;
    else if (e.key === 'ArrowUp') this.selected = (this.selected + n - 1) % n;
    else if (e.key === 'Enter') this.handlers.enter(this.selected);
    else if (e.key === 'Escape') this.handlers.cancel();
  }

  pointer(vx: number, vy: number, click: boolean): void {
    if (vx < SLOT.x || vx > SLOT.x + SLOT.w) return;
    const i = SLOT.tops.findIndex((t) => vy >= t && vy <= t + SLOT.h);
    if (i < 0 || i >= this.slots.length) return;
    this.selected = i;
    if (click) this.handlers.enter(i);
  }
}

// Blue grid on the inside of a cylinder, matching the curvature of the glyph tunnel.
function drawTunnelGrid(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const step = h / 41;
  ctx.save();
  ctx.strokeStyle = 'rgba(40, 120, 200, 0.42)';
  ctx.lineWidth = Math.max(1, h / 900);
  // Vertical lines bow outward toward the top and bottom.
  for (let i = -Math.ceil(w / step); i <= Math.ceil(w / step); i++) {
    const x0 = i * step;
    ctx.beginPath();
    for (let y = 0; y <= h; y += h / 40) {
      const t = (y - cy) / (h / 2);
      const x = cx + x0 * (1 + 0.18 * t * t);
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Horizontal lines bow outward toward the left and right, drifting slowly.
  const drift = ((time * 6) % step);
  for (let j = -Math.ceil(h / step); j <= Math.ceil(h / step); j++) {
    const y0 = j * step + drift;
    ctx.beginPath();
    for (let x = 0; x <= w; x += w / 60) {
      const t = (x - cx) / (w / 2);
      const y = cy + y0 * (1 + 0.12 * t * t);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

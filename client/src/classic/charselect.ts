// SELECT CHARACTER screen, rebuilt from the decompiled PsoBB.exe (Ephinea
// build 1.25.13). Every position, size, color, blend mode and timing below
// comes from the code or from the data files it reads; the addresses are the
// evidence (see docs/DEVLOG.md, "select character screen from the decompiled code").
//
// Scene 6 of the scene switch FUN_0081aac8 is FUN_004135e0 (vtable 0x00af3370).
// It creates, in this order:
//   background      FUN_004010b0  vtable 0x00af2028, render FUN_004010e4
//   backtext        FUN_004012cc  vtable 0x00af2060, update FUN_00401304, render FUN_0040131c
//   header          FUN_00415154  vtable 0x00af3500, row 0 of f512_midashi
//   UI builder      FUN_00401504  vtable 0x00af20c0: tags, slot bars, slot text, frame lines
//   3D preview      FUN_00406ab4  (character model, not reproduced)
//   message         FUN_0040b72c  vtable 0x00af2810, "Please select character."
//   slot list       FUN_004121f0  vtable 0x00af3158, cursor highlight + scrollbars
//   help keys       FUN_0041571c  vtable 0x00af3538, positions overridden by the scene
// The game logic runs at 30 frames per second; the RE timings are in frames.
//
// Textures:
//   f256_ad_pic_2   blue grid tunnel, 640x512 in 8 tiles (texlist 0x009a2d00)
//   f256_backtext   glyph tunnel, 5 animation frames (0x009a2d5c)
//   f512_midashi    header rows, 512x40 each (DAT_00a3b1cc)
//   f256_tag        tag labels, 174x32 rows (DAT_00a3b1c4)
//   f256_ad         cursor bars at the bottom (DAT_00a3b09c)
//   f256_player_tex Enter/Esc key caps (DAT_00a3b1d4)

import { se, SE } from '../audio/se.ts';
import type { CharacterPreview } from '../net/bbsession.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { VH, VW, type Screen, type Stage } from './stage.ts';

export interface CharSelectAssets {
  grid: ImageBitmap[]; // f256_ad_pic_2.prs (8 tiles)
  backtext: ImageBitmap[]; // f256_backtext.prs (5 frames)
  midashi: ImageBitmap[]; // f512_midashi_eng.prs (2 pages)
  tag: ImageBitmap; // f256_tag_eng.prs[0]
  ad: ImageBitmap; // f256_ad_eng.prs[0]
  playerTex: ImageBitmap; // f256_player_tex_eng.prs[0]
}

type Seg = readonly [x0: number, y0: number, x1: number, y1: number];

// Frame lines: entries of CAdDrawLineTask.prs (addrawlinetask.prs, a REL file;
// the root is an array of {count, pairs, primitives}; a primitive is 0x2c bytes
// {index, x0, y0, z0, ARGB0, x1, y1, z1, ARGB1, speed 40, width 2}). Pairs
// (-1, b) start segment b at once, (a, b) start b when a is complete
// (FUN_004086ac, FUN_004089f8). Values from the data.gsl copy: Ephinea's loose
// override is a 16:9 variant whose right ends are at x = 853 instead of 640,
// and the reference capture (psobb.io) shows the 640 ones.
interface LineSet {
  color: string; // ARGB of the primitives
  segs: readonly Seg[];
  chain: ReadonlyArray<readonly [number, number]>;
}
const LINES: Record<string, LineSet> = {
  // Entry 8: created by the header (FUN_00415154 -> FUN_004088b8(this, 8)).
  header: {
    color: 'rgb(54, 139, 188)', // 0xff368bbc
    segs: [
      [640, 33, 396, 33], [396, 33, 388, 44], [388, 44, 0, 44],
      [640, 83, 247, 83], [247, 83, 233, 103], [233, 103, 0, 103],
      [640, 108, 0, 108],
    ],
    chain: [[-1, 0], [0, 1], [1, 2], [-1, 3], [3, 4], [4, 5], [-1, 6]],
  },
  // Entry 9: created by the message window (FUN_0040b72c -> FUN_004088b8(this, 9)).
  footer: {
    color: 'rgb(54, 139, 188)',
    segs: [
      [0, 431, 20, 431], [20, 431, 58, 368], [58, 368, 640, 368],
      [0, 443, 73, 443], [73, 443, 89, 417], [89, 417, 640, 417],
    ],
    chain: [[-1, 0], [0, 1], [1, 2], [-1, 3], [3, 4], [4, 5]],
  },
  // Entry 0xb: the CHARACTERS box with the tag outline (FUN_00402624(0)).
  box: {
    color: 'rgb(54, 139, 188)',
    segs: [
      [309, 132, 300, 116], [300, 116, 142, 116], [142, 116, 133, 132], [133, 132, 17, 132],
      [17, 132, 17, 362], [17, 362, 203, 362], [133, 132, 142, 150], [142, 150, 300, 150],
      [300, 150, 309, 132], [309, 132, 425, 132], [425, 132, 425, 362], [425, 362, 203, 362],
    ],
    chain: [[-1, 0], [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [-1, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11]],
  },
  // Entry 0x1c: the green panel behind the slots (FUN_00402624(0)).
  panel: {
    color: 'rgb(77, 165, 95)', // 0xff4da55f
    segs: [
      [124, 154, 124, 355], [124, 355, 322, 355], [124, 154, 268, 154],
      [268, 154, 281, 175], [281, 175, 322, 175], [322, 175, 322, 355],
    ],
    chain: [[-1, 0], [0, 1], [-1, 2], [2, 3], [3, 4], [4, 5]],
  },
};
const LINE = { speed: 40, halfWidth: 1 }; // px per frame; width 2 / 2.0 (0x008f8fa4)

const RE = {
  fps: 30,
  // FUN_00415bcc tile table 0x009a3840: {x, y, w, h, texture}; drawn additively
  // (blend 8/10 = SRCALPHA/ONE through FUN_00837468) over a black quad.
  tiles: [
    [512, 384, 128, 128, 7], [512, 256, 128, 128, 6], [512, 128, 128, 128, 5], [512, 0, 128, 128, 4],
    [0, 256, 256, 256, 1], [0, 0, 256, 256, 0], [256, 256, 256, 256, 3], [256, 0, 256, 256, 2],
  ] as const,
  // FUN_0040131c: additive quad (0,0)-(639,479), texture = counter / 3,
  // counter 0..14 (FUN_00401304).
  backtext: { w: 639, h: 479, cycle: 15, hold: 3 },
  // FUN_004153d4 / FUN_004154b8: 8 additive copies of a 512x40 row, alpha 0x1f,
  // x = 64 - (10 - t)^2 * k (t = 0..10), y 43..83; row 0 = SELECT CHARACTER,
  // v = row * 40 / 512 (0x008fadac / 0x008fada8).
  header: { x: 64, y: 43, w: 512, h: 40, row: 0, alpha: 0x1f, k: [1, 0.8, 0.6, 0.4, -1, -0.8, -0.6, -0.4], frames: 10 },
  // FUN_00414d60 / FUN_00414c94 / FUN_00414f8c: tag 0 at (134, 118), 174x32,
  // u 0..0.6797, v row * 32 / 256, alpha +1/15 per frame, additive (FUN_007a902c).
  tag: { x: 134, y: 118, w: 174, h: 32, fade: 15 },
  // FUN_00401664(0, 0) -> FUN_0040d3ac: slot bars 180x38 RGB(0x36,0xbc,0x88),
  // additive, alpha 0.05 per frame up to 1.0 x 119 (FUN_0040d65c, FUN_0040d6f8);
  // they fly from (131, 182) to their slot in 15 steps.
  slots: [[131, 182], [131, 225], [131, 268], [131, 311]] as const, // 0x008f86b8 = 0x008fac10
  slot: { w: 180, h: 38, color: [54, 188, 136], alpha: 119, fadeStep: 0.05, moveFrames: 15 },
  // FUN_0040e694: name at the cell, "LV%d" right-aligned 20 px lower, each with a
  // 0x111111 shadow 1 px to the right; alpha +1/15 per frame (FUN_0040e618).
  text: { shadow: '#111111', line2: 20, fade: 15 },
  // FUN_0041245c / FUN_00412800: cursor bar from f256_ad texture 0, three
  // quads 16 | w-32 | 16, v 224..242; normal state u 0..48 (orange), chosen
  // state u 49..97 (green). Additive; the cursor slot gets alpha 255, the
  // others lose 25 per frame.
  cursor: { cap: 16, v0: 224, v1: 242, normal: [0, 16, 32, 48], chosen: [49, 65, 81, 97], decay: 25 },
  // FUN_00411828: scrollbar quad RGB(0x25,0xec,0x00), alpha +1/15 per frame.
  // Its geometry is set outside the functions decompiled so far; measured
  // from the reference capture.
  scrollbar: { x: 314, y: 182, w: 3, h: 55, color: [37, 236, 0], fade: 15 },
  // FUN_0040b7d8 / FUN_0040b85c: two centered lines at y 370 and 390,
  // x = (640 - width) / 2, alpha +25 per frame. The widescreen patch of the
  // reference client centers them on the whole window instead of 640.
  message: { y: 370, step: 20, fadeStep: 25 },
  // FUN_0041571c, FUN_004157c4, FUN_0041594c: 32x32 key caps from
  // f256_player_tex (Enter u 122..154, Esc u 162..194, v 210..242) at
  // (156, 421) and (299, 421) (set by FUN_004135e0), sliding in from x = 640
  // as (640 - x) * (20 - t)^2 / 400 + x; alpha from 0x33, +12 per frame.
  // Labels (unitxt group 0x31) at (x + 32, y + 8).
  keys: [
    { x: 156, uv: [122, 210], label: 'Enter' },
    { x: 299, uv: [162, 210], label: 'Cancel' },
  ],
  key: { y: 421, size: 32, from: 640, frames: 20, alpha0: 0x33, alphaStep: 12, label: [32, 8] },
};

// unitxt_e group 0x39: 'NEW CHARACTER', 'LV%d'; group 0x1f entry 0.
const STR = { newChar: 'NEW CHARACTER', level: (n: number) => `LV${n}`, select: 'Please select character.' };

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
  chosen = false;
  message = STR.select;
  frame = 0; // game frames since the screen opened
  private acc = 0;
  private cursorAlpha = [0, 0, 0, 0];

  constructor(assets: CharSelectAssets, slots: Array<CharacterPreview | null>, handlers: CharSelectHandlers) {
    this.assets = assets;
    this.slots = slots;
    this.handlers = handlers;
  }

  setSlots(slots: Array<CharacterPreview | null>): void {
    this.slots = slots;
  }

  enter(): void {
    this.frame = 0;
    this.acc = 0;
  }

  update(dt: number): void {
    this.acc += dt * RE.fps;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.frame++;
      // FUN_0041245c: the cursor slot is lit, the others fade out.
      this.cursorAlpha = this.cursorAlpha.map((a, i) => (i === this.selected ? 255 : Math.max(0, a - RE.cursor.decay)));
    }
  }

  // Full-window layers: the widescreen client stretches these 640x480 quads.
  drawFullscreen(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.setTransform(w / VW, 0, 0, h / VH, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, tw, th, i] of RE.tiles) ctx.drawImage(this.assets.grid[i], x, y, tw, th);
    const b = RE.backtext;
    const tex = this.assets.backtext[Math.floor((this.frame % b.cycle) / b.hold)];
    ctx.drawImage(tex, 0, 0, b.w, b.h);
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    const f = this.frame;
    this.drawHeader(ctx, f);
    drawLines(ctx, LINES.header, f);
    this.drawTag(ctx, f);
    this.drawSlotBars(ctx, f);
    this.drawSlotText(ctx, f);
    drawLines(ctx, LINES.panel, f);
    drawLines(ctx, LINES.box, f);
    this.drawMessage(ctx, f, ctx.canvas.width / stage.sx);
    drawLines(ctx, LINES.footer, f);
    this.drawCursor(ctx);
    this.drawScrollbar(ctx, f);
    this.drawKeys(ctx, f);
  }

  private drawHeader(ctx: CanvasRenderingContext2D, f: number): void {
    const h = RE.header;
    const page = this.assets.midashi[h.row < 12 ? 0 : 1];
    const sy = ((h.row % 12) * h.h * page.height) / 512;
    const t = Math.min(f, h.frames);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = h.alpha / 255;
    for (const k of h.k) {
      const x = h.x - (h.frames - t) * (h.frames - t) * k;
      ctx.drawImage(page, 0, sy, page.width, (h.h * page.height) / 512, x, h.y, h.w, h.h);
    }
    ctx.restore();
  }

  private drawTag(ctx: CanvasRenderingContext2D, f: number): void {
    const t = RE.tag;
    const img = this.assets.tag;
    const s = img.width / 256;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // FUN_007a902c: blend 8/10
    ctx.globalAlpha = Math.min(1, f / t.fade);
    ctx.drawImage(img, 0, 0, t.w * s, t.h * s, t.x, t.y, t.w, t.h);
    ctx.restore();
  }

  private slotPos(i: number, f: number): [number, number] {
    const [sx, sy] = RE.slots[0];
    const [tx, ty] = RE.slots[i];
    const n = Math.min(f, RE.slot.moveFrames) / RE.slot.moveFrames;
    return [sx + (tx - sx) * n, sy + (ty - sy) * n];
  }

  private drawSlotBars(ctx: CanvasRenderingContext2D, f: number): void {
    const s = RE.slot;
    const a = (Math.min(1, f * s.fadeStep) * s.alpha) / 255;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(${s.color.join(',')}, ${a})`;
    for (let i = 0; i < RE.slots.length; i++) {
      const [x, y] = this.slotPos(i, f);
      ctx.fillRect(x, y, s.w, s.h);
    }
    ctx.restore();
  }

  private drawSlotText(ctx: CanvasRenderingContext2D, f: number): void {
    const a = Math.min(1, f / RE.text.fade);
    for (let i = 0; i < RE.slots.length; i++) {
      const [x, y] = this.slotPos(i, f);
      const slot = this.slots[i] ?? null;
      const name = slot ? slot.name : STR.newChar;
      drawGameText(ctx, name, x + 1, y, RE.text.shadow, a);
      drawGameText(ctx, name, x, y, '#ffffff', a);
      if (slot) {
        const lv = STR.level(slot.level);
        const lx = x + RE.slot.w - gameTextWidth(lv);
        drawGameText(ctx, lv, lx + 1, y + RE.text.line2, RE.text.shadow, a);
        drawGameText(ctx, lv, lx, y + RE.text.line2, '#ffffff', a);
      }
    }
  }

  private drawCursor(ctx: CanvasRenderingContext2D): void {
    const c = RE.cursor;
    const img = this.assets.ad;
    const s = img.width / 256;
    const u = this.chosen ? c.chosen : c.normal;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    RE.slots.forEach(([x, y], i) => {
      const alpha = this.cursorAlpha[i] / 255;
      if (alpha <= 0) return;
      ctx.globalAlpha = alpha;
      const w = RE.slot.w;
      const h = RE.slot.h;
      const quad = (u0: number, u1: number, dx: number, dw: number) =>
        ctx.drawImage(img, u0 * s, c.v0 * s, (u1 - u0) * s, (c.v1 - c.v0) * s, dx, y, dw, h);
      quad(u[1], u[2], x + c.cap, w - 2 * c.cap);
      quad(u[0], u[1], x, c.cap);
      quad(u[2], u[3], x + w - c.cap, c.cap);
    });
    ctx.restore();
  }

  private drawScrollbar(ctx: CanvasRenderingContext2D, f: number): void {
    const b = RE.scrollbar;
    ctx.fillStyle = `rgba(${b.color.join(',')}, ${Math.min(1, f / b.fade)})`;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }

  private drawMessage(ctx: CanvasRenderingContext2D, f: number, screenWidth: number): void {
    const m = RE.message;
    const a = Math.min(255, f * m.fadeStep) / 255;
    this.message.split('\n').slice(0, 2).forEach((line, i) => {
      drawGameText(ctx, line, (screenWidth - gameTextWidth(line)) / 2, m.y + i * m.step, '#ffffff', a);
    });
  }

  private drawKeys(ctx: CanvasRenderingContext2D, f: number): void {
    const k = RE.key;
    const t = Math.min(f + 1, k.frames);
    const a = Math.min(255, k.alpha0 + k.alphaStep * (f + 1)) / 255;
    const img = this.assets.playerTex;
    const s = img.width / 256;
    for (const key of RE.keys) {
      const x = ((k.from - key.x) * (k.frames - t) * (k.frames - t)) / (k.frames * k.frames) + key.x;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.drawImage(img, key.uv[0] * s, key.uv[1] * s, k.size * s, k.size * s, x, k.y, k.size, k.size);
      ctx.restore();
      drawGameText(ctx, key.label, x + k.label[0], k.y + k.label[1], '#ffffff', a);
    }
  }

  key(e: KeyboardEvent): void {
    const n = Math.max(1, Math.min(this.slots.length, RE.slots.length));
    // Slot list 0x00412610..0x00412742: SE 0x56f Up/Down, 0x570 Enter; 0x00412e4e: 0x585 Esc.
    if (e.key === 'ArrowDown') (se(SE.cursor), (this.selected = (this.selected + 1) % n));
    else if (e.key === 'ArrowUp') (se(SE.cursor), (this.selected = (this.selected + n - 1) % n));
    else if (e.key === 'Enter') (se(SE.ok), this.handlers.enter(this.selected));
    else if (e.key === 'Escape') (se(SE.cancel), this.handlers.cancel());
  }

  pointer(vx: number, vy: number, click: boolean): void {
    const i = RE.slots.findIndex(([x, y]) => vx >= x && vx <= x + RE.slot.w && vy >= y && vy <= y + RE.slot.h);
    if (i < 0 || i >= this.slots.length) return;
    this.selected = i;
    if (click) this.handlers.enter(i);
  }
}

// A set of growing line segments (FUN_0040840c / FUN_004089f8): each grows by
// 40 px per frame from its start; when complete, the segments chained to it
// start on the next frame. Each is a quad 2 px wide.
function drawLines(ctx: CanvasRenderingContext2D, set: LineSet, frame: number): void {
  const start = new Array<number>(set.segs.length).fill(Infinity);
  const begin = (i: number, f: number) => {
    if (f >= start[i]) return;
    start[i] = f;
    const [x0, y0, x1, y1] = set.segs[i];
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / LINE.speed);
    for (const [a, b] of set.chain) if (a === i) begin(b, f + Math.max(1, steps));
  };
  for (const [a, b] of set.chain) if (a === -1) begin(b, 0);
  ctx.fillStyle = set.color;
  set.segs.forEach(([x0, y0, x1, y1], i) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const done = Math.min(len, (frame - start[i]) * LINE.speed);
    if (!(done > 0) || len === 0) return;
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    const ex = x0 + ux * done;
    const ey = y0 + uy * done;
    const nx = -uy * LINE.halfWidth;
    const ny = ux * LINE.halfWidth;
    ctx.beginPath();
    ctx.moveTo(x0 + nx, y0 + ny);
    ctx.lineTo(ex + nx, ey + ny);
    ctx.lineTo(ex - nx, ey - ny);
    ctx.lineTo(x0 - nx, y0 - ny);
    ctx.closePath();
    ctx.fill();
  });
}

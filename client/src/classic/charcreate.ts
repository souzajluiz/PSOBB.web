// Character creation, rebuilt from PsoBB.exe's TCharaMaking code
// (0x004d0000-0x004f8000). Every position, sprite, rate and table below comes
// from the decompiled functions named next to it; docs/DEVLOG.md has the walk
// through. The game logic runs at 30 frames per second like the original.
//
// Flow (FUN_004df9ec builds the scene):
//   class selection (FUN_004eb98c, states in the table 0x009b8d80)
//     0  choose the type, Up/Down, Enter or Right to continue
//     1  choose the class of that type, Esc or Left goes back
//     2  10 frames, then the class's default look is copied (FUN_004eb7ec)
//   dressing room (FUN_004f0c10, sub-states in the table 0x009b8f20)
//     0  step menu (FUN_004ef208): Up/Down, Enter opens the step, Esc
//        returns to the class list
//     1  a step editor is open
//     2  confirmation (FUN_004ef410): TYPE / CHARACTER NAME / SECTION ID
//     5  7 frames, then 3: the character is sent (E5)
//     6  7 frames, then 4: back to the class selection
// The 3D model is drawn by a CharacterModelView (charcreate_model.ts).

import { CLASS_NAMES, sectionIdForName } from '../net/bbsession.ts';
import {
  APPEARANCE_FIELDS, CHIPS_COSTUME, CHIPS_SKIN, CLASS_ORDER, DEFAULT_LOOKS, HAIR_BAR_COLORS, HAIR_ROW_END, HEADING, HEADINGS,
  HELP, HELP_ITEMS, LIST_BAR_END, OPTION_COUNTS, PORTRAITS, SPR, SPRITES, STEP, STEP_BAR_END, STEP_EDITOR, STEP_LISTS,
  TEXT_GROUP, TYPE_RANGE, type Appearance,
} from './charcreate_data.ts';
import { se, SE } from '../audio/se.ts';
import type { CharacterModelView } from './charcreate_model.ts';
import { FONT, type Screen, type Stage } from './stage.ts';

export interface CharCreateAssets {
  tex: ImageBitmap[]; // ccconsole_e.xvm
  text: string[][]; // unitxt_e.prs
}

export interface CharCreateResult {
  charClass: number;
  classFlags: number;
  name: string;
  sectionId: number;
  look: Appearance;
}

export interface CharCreateHandlers {
  done: (r: CharCreateResult) => void;
  cancel: () => void; // leaving the class selection with Esc
}

const FPS = 30;
const NAME_MAX = 10; // 12 UTF-16 units including the "\tE" prefix (FUN_004f0c10)
// BAMS sine (FUN_0082dcbc): 0x10000 = one turn.
const bsin = (a: number) => Math.sin((a / 0x10000) * Math.PI * 2);
const bcos = (a: number) => Math.cos((a / 0x10000) * Math.PI * 2);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const typeOf = (listIndex: number) => (listIndex / 4) | 0;

// ---------------------------------------------------------------- input

type Button = 'up' | 'down' | 'left' | 'right' | 'ok' | 'cancel' | 'tab';
const KEYMAP: Record<string, Button> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'ok', ' ': 'ok', Escape: 'cancel', Backspace: 'cancel', Tab: 'tab',
};
const DIRS: Button[] = ['up', 'down', 'left', 'right'];

// FUN_004f3b9c: held (0x00a72614), pressed this frame (0x00a72618) and the
// direction auto-repeat (0x00a7261c: on press, then at frame 7 and every 3
// frames after).
class Pad {
  private down = new Set<Button>();
  private queue: Button[] = []; // presses not yet seen by a frame
  private taps = new Set<Button>();
  private prev = new Set<Button>();
  held = new Set<Button>();
  pressed = new Set<Button>();
  repeat = new Set<Button>();
  private repDir: Button | null = null;
  private repCount = 0;

  keydown(b: Button): void {
    this.down.add(b);
    this.queue.push(b);
  }

  keyup(b: Button): void {
    this.down.delete(b);
  }

  tick(): void {
    // One press of a button per frame, so quick taps are not merged.
    this.taps.clear();
    while (this.queue.length && !this.taps.has(this.queue[0])) this.taps.add(this.queue.shift()!);
    this.held = new Set([...this.down, ...this.taps]);
    this.pressed = new Set([...this.held].filter((b) => !this.prev.has(b) || this.taps.has(b)));
    this.prev = new Set(this.down);
    this.repeat.clear();
    const dir = DIRS.find((d) => this.held.has(d)) ?? null;
    if (!dir) {
      this.repDir = null;
      this.repCount = 0;
    } else if (dir !== this.repDir || this.pressed.has(dir)) {
      this.repDir = dir;
      this.repCount = 0;
      this.repeat.add(dir);
    } else {
      this.repCount++;
      if (this.repCount === 7 || this.repCount >= 10) {
        this.repCount = 7;
        this.repeat.add(dir);
      }
    }
  }

  releaseAll(): void {
    this.down.clear();
  }
}

// ---------------------------------------------------------------- drawing

type Paint = (ctx: CanvasRenderingContext2D) => void;

// Draw calls carry the z the original passes; more negative is further back,
// so painting in ascending z reproduces the depth test of the 2D quads.
class DrawList {
  private items: Array<{ z: number; seq: number; paint: Paint }> = [];
  private seq = 0;
  private readonly sprites: SpriteSheet;
  constructor(sprites: SpriteSheet) {
    this.sprites = sprites;
  }

  add(z: number, paint: Paint): void {
    this.items.push({ z, seq: this.seq++, paint });
  }

  // FUN_004e9d8c(sprite, z, pos, scale, color) and its wrappers.
  sprite(i: number, z: number, x: number, y: number, sx = 1, sy = 1, alpha = 1, gray = 1): void {
    if (alpha <= 0) return;
    this.add(z, (ctx) => this.sprites.draw(ctx, i, x, y, sx, sy, alpha, gray));
  }

  flush(ctx: CanvasRenderingContext2D): void {
    this.items.sort((a, b) => a.z - b.z || a.seq - b.seq);
    for (const it of this.items) {
      ctx.save();
      it.paint(ctx);
      ctx.restore();
    }
    this.items = [];
    this.seq = 0;
  }
}

class SpriteSheet {
  private tints = new Map<string, OffscreenCanvas>();
  private readonly tex: ImageBitmap[];
  constructor(tex: ImageBitmap[]) {
    this.tex = tex;
  }

  width(i: number): number {
    return SPRITES[i]?.[0] ?? 0;
  }

  draw(ctx: CanvasRenderingContext2D, i: number, x: number, y: number, sx: number, sy: number, alpha: number, gray: number): void {
    const s = SPRITES[i];
    if (!s) return;
    const [w, h, ax, ay, u0, v0, u1, v1, t] = s;
    const src = this.tinted(t, gray);
    if (!src) return;
    const kx = src.width / 256;
    const ky = src.height / 256;
    ctx.globalAlpha = clamp01(alpha);
    ctx.drawImage(src, u0 * kx, v0 * ky, Math.max(1, (u1 - u0) * kx), Math.max(1, (v1 - v0) * ky), x - ax * sx, y - ay * sy, w * sx, h * sy);
  }

  // Vertex color times texture (the RGB of the color the code passes).
  private tinted(t: number, gray: number): ImageBitmap | OffscreenCanvas | undefined {
    const src = this.tex[t];
    if (!src || gray >= 0.995) return src;
    const q = Math.max(0, Math.round(gray * 32)) / 32;
    const key = `${t}:${q}`;
    let c = this.tints.get(key);
    if (!c) {
      c = new OffscreenCanvas(src.width, src.height);
      const g = c.getContext('2d')!;
      g.drawImage(src, 0, 0);
      g.globalCompositeOperation = 'multiply';
      const v = Math.round(q * 255);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(src, 0, 0);
      this.tints.set(key, c);
    }
    return c;
  }
}

// The game's text renderer (FUN_007ac12c) draws at the top-left corner.
const TEXT_SIZE = 10.5;
function gameText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, alpha: number, color = '#fff'): void {
  ctx.globalAlpha = clamp01(alpha);
  ctx.font = `bold ${TEXT_SIZE}px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y + 1);
}
let measureCtx: OffscreenCanvasRenderingContext2D | null = null;
function textWidth(s: string): number {
  measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d')!;
  measureCtx.font = `bold ${TEXT_SIZE}px ${FONT}`;
  return measureCtx.measureText(s).width;
}

function quad(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, fill: string | CanvasGradient, alpha = 1): void {
  ctx.globalAlpha = clamp01(alpha);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(...pts[0]);
  for (const p of pts.slice(1)) ctx.lineTo(...p);
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------- shared widgets

// Background (FUN_004ed008): the hexback tiles, then two gradient quads from
// x = 140 (transparent) to x = 384 (#181818) and a near opaque #181818 band
// up to x = 640 (alpha 0xff at 384, 0xec at 640).
function drawBackground(list: DrawList): void {
  const tiles: Array<[number, number, number]> = [
    [12, 0, 0], [13, 0, 256], [14, 256, 0], [15, 256, 128], [16, 256, 256], [17, 256, 384], [12, 384, 0], [13, 384, 256],
  ];
  for (const [i, x, y] of tiles) list.sprite(i, -9935, x, y);
  list.add(-9934, (ctx) => {
    const g = ctx.createLinearGradient(140, 0, 384, 0);
    g.addColorStop(0, 'rgba(24,24,24,0)');
    g.addColorStop(1, 'rgba(24,24,24,1)');
    quad(ctx, [[140, 0], [384, 0], [384, 600], [140, 600]], g);
    const g2 = ctx.createLinearGradient(384, 0, 640, 0);
    g2.addColorStop(0, 'rgba(24,24,24,1)');
    g2.addColorStop(1, `rgba(24,24,24,${0xec / 255})`);
    quad(ctx, [[384, 0], [640, 0], [640, 600], [384, 600]], g2);
  });
}

// Heading pill (FUN_004ecd3c / FUN_004ecb10 / FUN_004ecc24): a stretched gray
// pill whose width eases toward the heading width + 15 (100..294), the gray
// hex cluster, and the heading text that pops in (FUN_004ecf48).
class Heading {
  width = 100;
  private shown = -1;
  private texts: Array<{ sprite: number; a: number; dying: boolean }> = [];

  set(n: number): void {
    if (n === this.shown) return;
    this.shown = n;
    for (const t of this.texts) t.dying = true;
    if (n >= 0) this.texts.push({ sprite: HEADINGS[n], a: 0, dying: false });
  }

  tick(sprites: SpriteSheet): void {
    const target = this.shown >= 0 ? sprites.width(HEADINGS[this.shown]) + 15 : this.width;
    let w = this.width;
    if (target > w + 12.933) w += 12.933;
    else if (target < w - 12.933) w -= 12.933;
    else w += (target - w) * 0.2;
    this.width = Math.min(294, Math.max(100, w));
    for (const t of this.texts) t.a = t.dying ? t.a - 0.066667 : Math.min(1, t.a + 0.133333);
    this.texts = this.texts.filter((t) => t.a > 0 || !t.dying);
  }

  draw(list: DrawList): void {
    list.sprite(SPR.pillBody, -3.0625, 0, 37, this.width / 32, 1);
    list.sprite(SPR.pillCap, -3.0625, this.width, 37);
    list.sprite(SPR.hexCluster, -2.75, 62, 67);
    // FUN_004ece78 -> FUN_004e9f8c: scaled about the sprite's anchor, placed
    // so that its top-left corner is at (27, 44) at scale 1.
    for (const t of this.texts) {
      const s = SPRITES[t.sprite];
      const scale = (1 - t.a) * 0.5 + 1;
      list.sprite(t.sprite, -2.4375, 27 + s[2], 44 + s[3], scale, scale, t.a);
    }
  }
}

// Key help (FUN_004f4128 / FUN_004f424c / FUN_004f44fc): five items that fade
// in (+1/6) or out (-1/15), packed right-aligned against x = 604 at y = 443.
class KeyHelp {
  private shown = [false, false, false, false, false];
  private a = [0, 0, 0, 0, 0];
  private ox = [0, 0, 0, 0, 0];
  private total = 0;

  set(items: number[]): void {
    this.shown = this.shown.map((_, i) => items.includes(i));
  }

  tick(sprites: SpriteSheet): void {
    let acc = 0;
    for (let i = 0; i < 5; i++) {
      this.a[i] = this.shown[i] ? Math.min(1, this.a[i] + 0.166667) : Math.max(0, this.a[i] - 0.066667);
      if (!this.shown[i]) this.ox[i] = Math.max(0, this.ox[i] - 1);
      else {
        this.ox[i] += (acc - this.ox[i]) * 0.05;
        for (const s of HELP_ITEMS[i]) acc += sprites.width(s) + 4;
        acc += 8;
      }
    }
    this.total += (acc - this.total) * 0.15;
  }

  draw(list: DrawList, sprites: SpriteSheet): void {
    const order = [0, 1, 2, 3, 4].sort((p, q) => this.a[p] ** 2 - this.a[q] ** 2);
    order.forEach((i, rank) => {
      const alpha = this.a[i] ** 2;
      let x = 604 - this.total + this.ox[i];
      for (const s of HELP_ITEMS[i]) {
        list.sprite(s, -3 + ((rank / 5) | 0), x, 443, 1, 1, alpha);
        x += sprites.width(s) + 4;
      }
    });
  }
}

// ---------------------------------------------------------------- class selection

// Base of the selection widgets (FUN_004f4760 / FUN_004f47bc): `fade` grows
// by `fadeIn` per frame until the selection is confirmed (state 2), then
// drops by `fadeOut`; `act` follows isActive() at `actUp` / `actDown`.
abstract class SelWidget {
  fade = 0;
  act = 0;
  leaving = false;
  dead = false;
  readonly index: number;
  protected fadeIn: number;
  protected fadeOut: number;
  protected actUp: number;
  protected actDown: number;
  constructor(index: number, fadeIn: number, fadeOut: number, actUp: number, actDown: number) {
    this.index = index;
    this.fadeIn = fadeIn;
    this.fadeOut = fadeOut;
    this.actUp = actUp;
    this.actDown = actDown;
  }

  abstract isActive(s: ClassSel): boolean;

  tick(s: ClassSel): void {
    if (this.isActive(s)) this.act = Math.min(1, this.act + this.actUp);
    else this.act = Math.max(0, this.act + this.actDown);
    if (!this.leaving) {
      this.fade = Math.min(1, this.fade + this.fadeIn);
      if (s.state === 2) this.leaving = true;
    } else if (this.fade + this.fadeOut > 0) this.fade += this.fadeOut;
    else {
      this.fade = 0;
      this.dead = true;
    }
  }

  abstract draw(list: DrawList, s: ClassSel): void;
}

interface ClassSel {
  state: number; // 0 type, 1 class, 2 confirmed
  type: number; // 0x009b8d90
  cls: number; // 0x009b8d94 (list index)
  frame: number;
}

// HUNTER / RANGER / FORCE tabs (FUN_004f5f50, render FUN_004f5ff4).
class TypeTab extends SelWidget {
  private start: number;
  constructor(i: number) {
    super(i, 1 / 30, -1 / 45, 0.666667, -0.066667);
    this.start = i * 0.053333 + 0.8;
  }
  isActive(s: ClassSel): boolean {
    return s.type === this.index;
  }
  draw(list: DrawList, s: ClassSel): void {
    if (this.fade <= this.start) return;
    const t = (this.fade - this.start) / (1 - this.start);
    const hl = s.state === 0 ? 0.4 * this.act + 0.6 : this.act;
    const z = this.isActive(s) ? -3.375 : hl * 0.3125 - 3.6875;
    list.sprite(SPR.typeTab + this.index, z, 33 + (1 - t) * 25, 100 + this.index * 108, 1, 1, 1, hl * hl * 0.75 + 0.25);
  }
}

// One row of the class list (FUN_004f5298; render FUN_004f541c bar,
// FUN_004f5590 frame, FUN_004f5890 name and face).
class ClassRow extends SelWidget {
  private end: number;
  private x = -242;
  private y: number;
  private counter = 0;
  constructor(i: number) {
    super(i, 1 / 30, -1 / 45, 0.666667, -0.066667);
    this.end = (12 - i) * -0.053333 + 0.8;
    this.y = 100 + i * 27;
  }
  isActive(s: ClassSel): boolean {
    return s.state === 0 ? typeOf(this.index) === s.type : s.cls === this.index;
  }
  // FUN_004f553c
  private highlight(s: ClassSel): number {
    if (s.state !== 0 && typeOf(this.index) !== s.type) return this.act;
    return 0.4 * this.act + 0.6;
  }
  tick(s: ClassSel): void {
    super.tick(s);
    // FUN_004f5314: slides in from x = -242 to 58 with (1 - cos) / 2 easing.
    this.x = this.fade < this.end ? 58 - 300 + ((1 - bcos((this.fade / this.end) * 32768)) * 0.5) * 300 : 58;
    this.counter++;
  }
  draw(list: DrawList, s: ClassSel): void {
    const active = this.isActive(s);
    const hl = this.highlight(s);
    const gray = hl * hl * 0.75 + 0.25;
    const c = this.fade < this.end ? this.fade / this.end : 1;
    const a = c * c;
    const { x, y } = this;
    // Bar.
    list.sprite(SPR.typeSquare + typeOf(this.index), active ? -2.4375 : 0.3125 * hl - 2.75, x, y + 3, 9.625, 1, a, gray);
    // Frame.
    const zf = active ? -2.125 : 0.3125 * hl - 2.4375;
    list.sprite(69, zf, x, y, 28.25, 1, a, gray);
    list.sprite(70, zf, x, y + 22, 28.25, 1, a, gray);
    list.sprite(this.index === 0 ? 0x48 : 0x4c, zf, x + 226, y, 1, 1, a, gray);
    list.sprite(this.index === 11 ? 0x4a : 0x4e, zf, x + 226, y + 22, 1, 1, a, gray);
    list.sprite(68, zf, x + 226, y + 8, 1, 1.75, a, gray);
    if (this.fade < 1) list.sprite(67, zf, x - 3, y, 1, 3.75, a, gray);
    // Name and face strip.
    if (this.fade <= this.end) return;
    const ct = (this.fade - this.end) / (1 - this.end);
    const zt = active ? -1.8125 : 0.3125 * hl - 2.125;
    let an = ct * ct;
    if (active) an = clamp01(bsin(this.counter << 9) * 0.25 + an);
    list.sprite(SPR.className + this.index, zt, x + 5, y + 9, 1, 1, an, gray);
    list.sprite(SPR.classFace + this.index, zt, 169, y + 3, 1, 1, ct * ct, gray);
  }
}

// Colored heading bar with "Hunter" / "Humar" ... (FUN_004f5bb0, render
// FUN_004f5c54); 15 of them: the 3 types, then the 12 classes.
class TypeBanner extends SelWidget {
  private counter = 0;
  constructor(i: number) {
    super(i, 0.333333, -0.111111, 0.333333, -0.111111);
  }
  isActive(s: ClassSel): boolean {
    return s.state === 0 ? this.index <= 2 && this.index === s.type : this.index >= 3 && this.index - 3 === s.cls;
  }
  tick(s: ClassSel): void {
    super.tick(s);
    this.counter++;
  }
  draw(list: DrawList, s: ClassSel): void {
    const v = this.fade * this.act;
    if (v <= 0) return;
    const active = this.isActive(s);
    const a = Math.min(1, (v / 0.4) ** 2);
    const scale = v < 0.4 ? 1 + ((0.4 - v) / 0.4) * 0.15 : 1;
    const type = this.index <= 2 ? this.index : typeOf(this.index - 3);
    list.sprite(SPR.typeBar + type, active ? -2.4375 : -3.0625, 393, 82, scale, scale, a);
    if (active && v > 0.4) {
      const c = (v - 0.4) / 0.6;
      list.sprite(SPR.className2 + this.index, -2.125, 393, 82, scale, scale, clamp01(bsin(this.counter << 9) * 0.25 + c));
    }
  }
}

// Window around the illustrations (FUN_004f6268, render FUN_004f62ac).
class PortraitWindow extends SelWidget {
  constructor() {
    super(0, 0.066667, -0.066667, 0.066667, -0.066667);
  }
  isActive(): boolean {
    return false;
  }
  draw(list: DrawList): void {
    const a = this.fade < 0.5 ? this.fade / 0.5 : 1;
    const z = -3.375;
    list.sprite(0x82, z, 307, 100, 1, 1, a);
    list.sprite(0x84, z, 575, 100, 1, 1, a);
    list.sprite(0x88, z, 307, 396, 1, 1, a);
    list.sprite(0x8a, z, 575, 396, 1, 1, a);
    list.sprite(0x83, z, 339, 100, 7.375, 1, a);
    list.sprite(0x89, z, 339, 396, 7.375, 1, a);
    for (let y = 132; y <= 396; y += 8) {
      list.sprite(0x85, z, 307, y, 1, 1, a);
      list.sprite(0x86, z, 339, y, 7.375, 1, a);
      list.sprite(0x87, z, 575, y, 1, 1, a);
    }
  }
}

// Class illustration (FUN_004f6618; update FUN_004f66f0, render FUN_004f67ec).
class Portrait extends SelWidget {
  private z: number;
  private scale: number;
  private x: number;
  private y: number;
  private vis = 0;
  constructor(i: number) {
    super(i, 0.133333, -0.066667, 0.133333, -0.066667);
    const p = PORTRAITS[i];
    [this.scale, this.z, this.x, this.y] = [p[0], p[1], p[2], p[3]];
  }
  isActive(s: ClassSel): boolean {
    return s.state === 0 ? typeOf(this.index) === s.type : s.cls === this.index;
  }
  tick(s: ClassSel): void {
    super.tick(s);
    this.vis = this.fade * this.act;
    const p = PORTRAITS[this.index];
    const ease = (from: number, to: number) => (to - from) * 0.25 + from;
    if (s.state === 0) {
      this.z = ease(this.z, p[1]);
      this.scale = ease(this.scale, p[0]);
      this.x = ease(this.x, p[2]);
      this.y = ease(this.y, p[3]);
    } else if (this.isActive(s)) {
      this.z = ease(this.z, -2.75);
      this.scale = ease(this.scale, 1);
      this.x = ease(this.x, p[4]);
      this.y = ease(this.y, p[5]);
    }
  }
  draw(list: DrawList): void {
    if (this.vis <= 0) return;
    const sp = SPR.portrait + this.index * 2;
    list.sprite(sp, this.z, this.x, this.y, this.scale, this.scale, this.vis, this.vis);
    list.sprite(sp + 1, this.z, this.x, this.y + this.scale * 255.5, this.scale, this.scale, this.vis, this.vis);
  }
}

// Description box (FUN_004f4910, render FUN_004f4a00) and its text
// (FUN_004f5174, render FUN_004f4e94: 7 lines at (315, 280 + 20 n)).
class InfoBox extends SelWidget {
  constructor() {
    super(0, 0.066667, -0.066667, 0.066667, -0.066667);
  }
  isActive(): boolean {
    return false;
  }
  draw(list: DrawList, s: ClassSel): void {
    const a = this.fade >= 0.5 ? (this.fade - 0.5) / 0.5 : 0;
    const z = -1.8125;
    if (s.type >= 0) list.sprite(SPR.infoLabel + s.type, z, 310, 255, 1, 1, a);
    list.sprite(SPR.infoBack, z, 310, 274, 294 / 32, 150 / 32, a * 0.5);
    list.sprite(0x4b, z, 307, 272, 1, 1, a);
    list.sprite(0x4c, z, 599, 272, 1, 1, a);
    list.sprite(0x49, z, 307, 420, 1, 1, a);
    list.sprite(0x4a, z, 599, 420, 1, 1, a);
    list.sprite(0x45, z, 315, 272, 35.5, 1, a);
    list.sprite(0x46, z, 315, 420, 35.5, 1, a);
    list.sprite(0x43, z, 307, 280, 1, 17.5, a);
    list.sprite(0x44, z, 599, 280, 1, 17.5, a);
  }
}

class InfoText {
  state = 0; // 0 delay, 1 fade in, 2 fade out
  delay = 5;
  a = 0;
  frame = 0;
  dead = false;
  readonly id: number;
  readonly lines: string[];
  constructor(id: number, lines: string[]) {
    this.id = id;
    this.lines = lines;
  }

  tick(current: number): void {
    this.frame++;
    if (this.state !== 2 && this.id !== current) this.state = 2;
    if (this.state === 0) {
      if (--this.delay <= 0) this.state = 1;
    } else if (this.state === 1) this.a = Math.min(1, this.a + 0.026667);
    else {
      this.a += current === -1 ? -0.133333 : -0.033333;
      if (this.a <= 0) this.dead = true;
    }
  }

  draw(list: DrawList): void {
    if (this.a <= 0) return;
    const a2 = this.a * this.a;
    const spread = 1 - a2;
    const ghost = (16 * this.a * Math.abs(bsin(this.frame << 10))) / 255;
    list.add(-1.5, (ctx) => {
      this.lines.forEach((line, n) => {
        const y = 280 + n * 20;
        gameText(ctx, line, 315, y, a2);
        if (spread <= 0) return;
        // Ghost copies on rings of radius 1.5 k (1 - a^2), 4 k samples each.
        for (let k = 1; k < 5; k++) {
          const r = k * 1.5 * spread;
          for (let j = 0; j < 4 * k; j++) {
            const ang = (j / (4 * k)) * Math.PI * 2;
            gameText(ctx, line, 315 + Math.sin(ang) * r, y + Math.cos(ang) * r, ghost);
          }
        }
      });
    });
  }
}

// ---------------------------------------------------------------- dressing room editors

interface Dress {
  cls: number; // class id
  listIndex: number;
  classFlags: number;
  look: Appearance;
  backup: Appearance;
  name: string;
  sectionId: number; // 0xff until confirmed
  frame: number;
}

const copyLook = (l: Appearance): Appearance => ({ ...l, hairColor: [...l.hairColor], proportion: [...l.proportion] });
const fieldValue = (l: Appearance, f: number) => l[APPEARANCE_FIELDS[f]];
const setField = (l: Appearance, f: number, v: number) => {
  l[APPEARANCE_FIELDS[f]] = v;
};
// FUN_004e732c: a name must contain something other than spaces and tabs
// (the game also runs a word filter, FUN_00813f0c, not reproduced).
const nameValid = (s: string) => /[^\s　]/.test(s);

abstract class Editor {
  alive = true; // param 0x3c / 0x30 / 0x24: 0 starts the fade-out
  fade = 0;
  dead = false;
  result: 'none' | 'ok' | 'cancel' = 'none';
  protected started = false;
  frame = 0;

  // Shared fade of the editors (e.g. FUN_004f0f44): +1/6 in, -1/12 out.
  tickFade(): void {
    if (this.alive) this.fade = Math.min(1, this.fade + 0.166667);
    else {
      this.fade -= 0.083333;
      if (this.fade <= 0) {
        this.fade = 0;
        this.dead = true;
      }
    }
  }

  abstract tick(pad: Pad, d: Dress, help: KeyHelp): void;
  abstract draw(list: DrawList, d: Dress): void;
  ruler(): number {
    return 0;
  }
  handlesText(): boolean {
    return false;
  }
  text(_e: KeyboardEvent): void {}

  protected close(result: 'ok' | 'cancel', d: Dress): void {
    if (result === 'cancel') d.look = copyLook(d.backup); // FUN_004f12dc
    se(result === 'cancel' ? SE.back : SE.ok); // SE 0x573 / 0x570 (FUN_004f0f44, FUN_004f1cb8, ...)
    this.result = result;
    this.alive = false;
  }
}

// The gray bar + orange hex of an editor row (FUN_004f1398 / FUN_004f1f54).
function editorRow(list: DrawList, fade: number, y: number, end: number, selected: boolean, frame: number): void {
  if (fade > 0.33) {
    const t = fade < 0.66 ? (fade - 0.33) / 0.33 : 1;
    const barEnd = (end - 75) * t + 75;
    const x0 = 75 + (selected ? 9 * bsin(frame << 10) : 0);
    const k = selected ? 2 : 0;
    list.sprite(SPR.barBody + k, -2.75, x0, y, (barEnd - x0) / 48, 1);
    list.sprite(SPR.barCap + k, -2.75, barEnd, y);
  }
  if (fade > 0) {
    const a = fade < 0.33 ? fade / 0.33 : 1;
    list.sprite(selected ? 0 : 1, -2.4375, 56, y, 1, 1, a);
  }
}

// Option tiles + "n / total" (FUN_004f1398 and the first row of FUN_004f1f54).
function optionTiles(list: DrawList, a: number, count: number, selected: number, selAlpha: number, dimmed: number, end: number): void {
  for (let k = 0; k < count; k++) {
    const sel = k === selected;
    list.sprite(sel ? 0x22 : 0x21, -2.4375, 103 + k * 17, 150, 1, 1, sel ? selAlpha : a * dimmed);
  }
  const e = end - 347;
  list.sprite(SPR.digit + selected, -2.4375, 299 + e, 149, 1, 1, selAlpha);
  list.sprite(SPR.slash, -2.4375, 305 + e, 150, 1, 1, a * dimmed);
  list.sprite(0x15 + count, -2.4375, 324 + e, 167, 1, 1, a * dimmed);
}

// List editor for costume / skin / face / head (FUN_004f04a8; update
// FUN_004f0f44, render FUN_004f1398). Up to 10 choices sit on one row; more
// are split into rows of 9 that scroll vertically.
class ListEditor extends Editor {
  private count: number;
  private pageAnim: number;
  private readonly field: number;
  constructor(field: number, d: Dress) {
    super();
    this.field = field;
    this.count = OPTION_COUNTS[d.cls][field];
    this.pageAnim = this.layout(d).page;
  }

  private layout(d: Dress) {
    const v = fieldValue(d.look, this.field);
    if (this.count < 11) return { cols: this.count, page: 0, sel: v, rows: 1, onPage: this.count };
    const page = (v / 9) | 0;
    return { cols: 9, page, sel: v % 9, rows: ((this.count + 8) / 9) | 0, onPage: Math.min(9, this.count - page * 9) };
  }

  tick(pad: Pad, d: Dress): void {
    this.frame++;
    this.tickFade();
    if (!this.alive) return;
    if (!this.started) {
      this.started = true;
      return;
    }
    const n = this.count;
    const L = this.layout(d);
    let step = 0;
    if (pad.repeat.has('right')) step = 1;
    else if (pad.repeat.has('left')) step = -1;
    if (L.rows > 1) {
      if (pad.repeat.has('down')) step = 9;
      else if (pad.repeat.has('up')) step = -9;
    }
    if (step !== 0 && n > 0) {
      const old = fieldValue(d.look, this.field);
      let v = old + step;
      if (step === 1 || step === -1) {
        if (v >= n) v = 0;
        else if (v < 0) v = n - 1;
      } else if (v >= n) v = old % 9;
      else if (v < 0) {
        let w = old % 9;
        while (w + 9 < n) w += 9;
        v = w;
      }
      setField(d.look, this.field, v);
      if (v !== old) se(SE.cursor); // FUN_004f0f44
    }
    const page = this.layout(d).page;
    if (page > this.pageAnim) this.pageAnim = Math.min(page, this.pageAnim + 0.333333);
    else if (page < this.pageAnim) this.pageAnim = Math.max(page, this.pageAnim - 0.333333);
    if (pad.pressed.has('cancel')) this.close('cancel', d);
    else if (pad.pressed.has('ok')) this.close('ok', d);
  }

  draw(list: DrawList, d: Dress): void {
    const L = this.layout(d);
    const f = this.fade;
    // Other rows of a long list, scrolled up-left or down-right.
    if (L.rows !== 1) {
      const ga = 0.4 * f * f * f;
      if (ga > 1e-5) {
        for (let p = 0; p < L.rows; p++) {
          const dp = p - this.pageAnim;
          if (dp === 0) continue;
          let x: number;
          let y: number;
          if (dp < 0) {
            x = 22 * (1 - dp) + 84;
            y = -20 * (1 - dp) + 168;
          } else {
            x = -22 * (1 + dp) + 124;
            y = 20 * (1 + dp) + 148;
          }
          const tiles = p === L.rows - 1 ? this.count - 9 * p : L.cols;
          for (let k = 0; k < tiles; k++, x += 17) list.sprite(0x21, -3.0625, x, y, 1, 1, ga);
          list.sprite(0x16 + p, -3.0625, x + 10, y + 5, 0.75, 0.75, ga);
        }
      }
    }
    const wob = Math.min(1, bsin(this.frame << 10) * 0.25 + 1);
    const end = LIST_BAR_END[Math.min(9, Math.max(0, L.cols - 1))];
    editorRow(list, f, 146, end, true, this.frame);
    if (f > 0.66) {
      const a = ((f - 0.66) / 0.34) ** 2;
      optionTiles(list, a, L.onPage, L.sel, wob * a, 1, end);
      if (L.rows > 1) list.sprite(0x16 + L.page, -2.4375, 103 + 17 * L.onPage + 6, 170, 0.75, 0.75, a);
      // Color chips under the tiles.
      const chips = this.field === 0 || (this.field === 1 && d.classFlags & 0x10) ? CHIPS_COSTUME : this.field === 1 ? CHIPS_SKIN : null;
      if (chips) for (let k = 0; k < this.count && k < chips.length; k++) list.sprite(chips[k], -2.4375, 113 + k * 17, 152, 1, 1, a);
    }
  }
}

// Hair editor: style row and R, G, B rows (FUN_004f070c; update
// FUN_004f1cb8, render FUN_004f1f54).
class HairEditor extends Editor {
  private row = 0;
  private count: number;
  constructor(d: Dress) {
    super();
    this.count = OPTION_COUNTS[d.cls][4];
  }

  tick(pad: Pad, d: Dress): void {
    this.frame++;
    if (!this.started) {
      this.started = true;
      return;
    }
    this.tickFade();
    if (!this.alive) return;
    // FUN_004f1cb8: SE 0x56f on row and hair style changes.
    if (pad.repeat.has('down')) (se(SE.cursor), (this.row = (this.row + 1) % 4));
    else if (pad.repeat.has('up')) (se(SE.cursor), (this.row = (this.row + 3) % 4));
    if (this.row === 0) {
      if (pad.repeat.has('right')) (se(SE.cursor), (d.look.hair = (d.look.hair + 1) % Math.max(1, this.count)));
      else if (pad.repeat.has('left')) (se(SE.cursor), (d.look.hair = (d.look.hair - 1 + this.count) % Math.max(1, this.count)));
    } else {
      const c = this.row - 1;
      let v = d.look.hairColor[c];
      if (pad.pressed.has('right')) v += 1;
      else if (pad.pressed.has('left')) v -= 1;
      else if (pad.held.has('right')) v += 5;
      else if (pad.held.has('left')) v -= 5;
      d.look.hairColor[c] = Math.max(0, Math.min(255, v));
    }
    if (pad.pressed.has('cancel')) this.close('cancel', d);
    else if (pad.pressed.has('ok')) this.close('ok', d);
  }

  draw(list: DrawList, d: Dress): void {
    const f = this.fade;
    const wob = Math.min(1, bsin(this.frame << 10) * 0.25 + 1);
    const end0 = LIST_BAR_END[Math.min(9, Math.max(0, this.count - 1))];
    for (let r = 0; r < 4; r++) editorRow(list, f, 146 + r * 44, r === 0 ? end0 : HAIR_ROW_END, r === this.row, this.frame);
    if (f <= 0.66) return;
    const t = (f - 0.66) / 0.34;
    const a = t * t;
    const onStyle = this.row === 0;
    optionTiles(list, a, this.count, d.look.hair, a * (onStyle ? wob : 0.6), onStyle ? 1 : 0.6, end0);
    [[105, 194], [105, 238], [105, 282]].forEach(([x, y], k) => list.sprite(SPR.colorR + k, -2.4375, x, y, 1, 1, a * (this.row === k + 1 ? wob : 0.6)));
    // Slanted value bars: gray back (10% larger) and the colored fill.
    list.add(-2.75, (ctx) => {
      for (let k = 0; k < 3; k++) {
        const dy = k * 44;
        quad(ctx, [[106.2, 211.4 + dy], [98.2, 225.4 + dy], [240.2, 225.4 + dy], [248.2, 211.4 + dy]], '#808080', t);
      }
    });
    list.add(-2.4375, (ctx) => {
      for (let k = 0; k < 3; k++) {
        const v = d.look.hairColor[k] / 255;
        if (v === 0) continue;
        const dy = k * 44;
        quad(ctx, [[107, 210 + dy], [99, 224 + dy], [99 + 142 * v, 224 + dy], [107 + 142 * v, 210 + dy]], HAIR_BAR_COLORS[k], t);
      }
    });
  }
}

// Proportion pad (FUN_004f09d0; update FUN_004f2f28, render FUN_004f31f4):
// a 150 x 150 box at (245, 165) with a cross at the current values; x wraps
// around, y is clamped to 0..0.99, 0.4 per second while a direction is held.
class ProportionEditor extends Editor {
  tick(pad: Pad, d: Dress): void {
    this.frame++;
    if (!this.started) {
      this.started = true;
      return;
    }
    this.tickFade();
    if (!this.alive) return;
    let [x, y] = d.look.proportion;
    if (pad.held.has('right')) x += 0.013333;
    else if (pad.held.has('left')) x -= 0.013333;
    if (pad.held.has('down')) y += 0.013333;
    else if (pad.held.has('up')) y -= 0.013333;
    if (x > 0.99) x -= 0.99;
    else if (x < 0) x += 0.99;
    y = Math.max(0, Math.min(0.99, y));
    d.look.proportion = [x, y];
    if (pad.pressed.has('cancel')) this.close('cancel', d);
    else if (pad.pressed.has('ok')) this.close('ok', d);
  }

  ruler(): number {
    return this.fade;
  }

  draw(list: DrawList, d: Dress): void {
    const a = this.fade * this.fade;
    if (a <= 0) return;
    const [px, py] = d.look.proportion;
    list.add(-2, (ctx) => {
      quad(ctx, [[245, 165], [395, 165], [395, 315], [245, 315]], '#fff', (32 * a) / 255);
      const cx = (px - 0.5) * 2 * 75 + 320;
      const cy = (py - 0.5) * 2 * 75 + 240;
      quad(ctx, [[cx - 2, 150], [cx + 2, 150], [cx + 2, 330], [cx - 2, 330]], '#fff', (64 * a) / 255);
      quad(ctx, [[230, cy - 2], [410, cy - 2], [410, cy + 2], [230, cy + 2]], '#fff', (64 * a) / 255);
    });
  }
}

// AUTO (FUN_004f089c; update FUN_004f2988): Tab rolls a random look, the
// hair color and proportions glide to it over 30 frames.
class AutoEditor extends Editor {
  private state = 0; // 0 first frame, 1 waiting, 2 closing, 3 rolling
  private rolled = false;
  private roll = 0;
  private from: Appearance;
  private to: Appearance;
  constructor(d: Dress) {
    super();
    this.from = copyLook(d.look);
    this.to = copyLook(d.look);
  }

  ruler(): number {
    return this.fade;
  }

  tick(pad: Pad, d: Dress, help: KeyHelp): void {
    this.frame++;
    if (this.state === 2) {
      this.alive = false;
      this.tickFade();
      return;
    }
    this.fade = Math.min(1, this.fade + 0.166667);
    if (this.state === 0) {
      this.state = 1;
      return;
    }
    if (this.state === 1) {
      help.set(this.rolled ? [HELP.change, HELP.ok, HELP.cancel] : [HELP.change, HELP.cancel]);
      if (pad.pressed.has('cancel')) {
        this.close('cancel', d);
        this.state = 2;
      } else if (this.rolled && pad.pressed.has('ok')) {
        this.close('ok', d);
        this.state = 2;
      } else if (pad.pressed.has('tab')) this.randomize(d);
    } else if (this.state === 3) {
      help.set([]);
      this.roll++;
      const t = this.roll / 30;
      const lerp = (p: number, q: number) => (q - p) * t + p;
      d.look.hairColor = [0, 1, 2].map((k) => Math.round(lerp(this.from.hairColor[k], this.to.hairColor[k]))) as [number, number, number];
      d.look.proportion = [lerp(this.from.proportion[0], this.to.proportion[0]), lerp(this.from.proportion[1], this.to.proportion[1])];
      if (this.roll > 0x1d) {
        se(SE.auto); // FUN_004f2988
        this.rolled = true;
        this.state = 1;
      }
    }
  }

  private randomize(d: Dress): void {
    const counts = OPTION_COUNTS[d.cls];
    for (let f = 0; f < 5; f++) {
      const n = counts[f];
      if (n <= 1) continue;
      let v = Math.round(Math.random() * n * 0.99);
      while (v === fieldValue(d.look, f)) v = v + 1 >= n ? 0 : v + 1;
      setField(d.look, f, v);
    }
    this.from = copyLook(d.look);
    this.to.hairColor = this.to.hairColor.map((c) => (c + 0x40 + Math.round(Math.random() * 128)) & 0xff) as [number, number, number];
    this.to.proportion = this.to.proportion.map((p) => {
      const q = p + Math.random() * 0.375 + 0.125;
      return q < 1 ? q : q - 1;
    }) as [number, number];
    this.roll = 0;
    this.state = 3;
  }

  draw(): void {}
}

// CHARACTER NAME (FUN_004f0af4; update FUN_004f34a8, render FUN_004f376c).
// The original opens its generic text entry window (FUN_0078eba4, max 12
// units, placed at (148, 137) with the soft keyboard at (53, 178)); here the
// keyboard types into a field drawn at the same place.
class NameEditor extends Editor {
  private value: string;
  constructor(d: Dress) {
    super();
    this.value = d.name;
  }

  handlesText(): boolean {
    return true;
  }

  text(e: KeyboardEvent): void {
    if (!this.alive) return;
    if (e.key === 'Backspace') this.value = this.value.slice(0, -1);
    else if (e.key.length === 1 && this.value.length < NAME_MAX && !e.ctrlKey && !e.metaKey) this.value += e.key;
  }

  tick(pad: Pad, d: Dress): void {
    this.frame++;
    if (this.frame < 2) return;
    this.tickFade();
    if (!this.alive) return;
    if (pad.pressed.has('ok')) {
      d.name = this.value.trimEnd();
      if (!nameValid(d.name)) d.name = '';
      se(d.name ? SE.back : SE.nameNg); // FUN_004f34a8: 0x573, or 0x57c for an invalid name
      this.result = 'ok';
      this.alive = false;
    } else if (pad.pressed.has('cancel')) {
      se(SE.back);
      this.result = 'cancel';
      this.alive = false;
    }
  }

  draw(list: DrawList): void {
    const f = this.fade;
    if (f > 0.33) {
      const t = f < 0.66 ? (f - 0.33) / 0.33 : 1;
      const end = 115 + (347 - 115) * t;
      const x0 = 115 + 9 * bsin(this.frame << 10);
      list.sprite(10, -2.75, x0, 124, (end - x0) / 48, 1);
      list.sprite(11, -2.75, end, 124);
    }
    if (f > 0) list.sprite(0, -2.4375, 95, 124, 1, 1, f < 0.33 ? f / 0.33 : 1);
    if (f > 0.66) {
      const a = (f - 0.66) / 0.34;
      list.add(-2, (ctx) => {
        gameText(ctx, this.value, 148, 137, a);
        if ((this.frame >> 3) & 1) gameText(ctx, '_', 148 + textWidth(this.value), 137, a);
      });
    }
  }
}

// ---------------------------------------------------------------- screen

export class CharCreateScreen implements Screen {
  layout = 'left43' as const;
  private sprites: SpriteSheet;
  private text: string[][];
  private pad = new Pad();
  private acc = 0;
  private heading = new Heading();
  private help = new KeyHelp();
  private intro = 18; // FUN_004ec3c8(0xf, 1): 15 + 3 frame wipe
  private outro = -1;

  // Class selection.
  private sel: ClassSel = { state: 0, type: 0, cls: 0, frame: 0 };
  private selWidgets: SelWidget[] = [];
  private infoTexts: InfoText[] = [];
  private infoId = -1;
  private selActive = true;
  private selLeave = 0;

  // Dressing room.
  private dress: Dress | null = null;
  private steps: readonly number[] = [];
  private cursor = 0;
  private sub = 0;
  private subTimer = 0;
  private returned = false; // 0x00a72570
  private menuFade = 0; // param 0x38
  private columnFade = 0; // param 0x3c
  private nameFade = 0; // param 0x44
  private confirmFade = 0; // param 0x48
  private modelFade = 0; // param 0x54
  private editor: Editor | null = null;
  private onKeyUp = (e: KeyboardEvent) => {
    const b = KEYMAP[e.key];
    if (b) this.pad.keyup(b);
  };

  private readonly handlers: CharCreateHandlers;
  private readonly model: CharacterModelView | null;

  constructor(assets: CharCreateAssets, handlers: CharCreateHandlers, model: CharacterModelView | null = null) {
    this.handlers = handlers;
    this.model = model;
    this.sprites = new SpriteSheet(assets.tex);
    this.text = assets.text;
    this.startSelection(0, 0, 0);
  }

  enter(): void {
    window.addEventListener('keyup', this.onKeyUp);
  }

  leave(): void {
    window.removeEventListener('keyup', this.onKeyUp);
    this.pad.releaseAll();
  }

  // FUN_004eb98c: the selection resumes on the class list when coming back
  // from the dressing room (both cursors already set).
  private startSelection(state: number, type: number, cls: number): void {
    this.sel = { state, type, cls, frame: 0 };
    this.selActive = true;
    this.heading.set(HEADING.creation);
    const w: SelWidget[] = [];
    for (let i = 0; i < 3; i++) w.push(new TypeTab(i));
    for (let i = 0; i < 12; i++) w.push(new ClassRow(i));
    for (let i = 0; i < 15; i++) w.push(new TypeBanner(i));
    w.push(new PortraitWindow());
    // FUN_004f68d0 creates the illustrations ordered by their z.
    for (const z of [-3.296875, -3.21875, -3.140625, -3.0625]) for (let i = 0; i < 12; i++) if (PORTRAITS[i][1] === z) w.push(new Portrait(i));
    w.push(new InfoBox());
    this.selWidgets = w;
    this.infoTexts = [];
    this.infoId = -1;
  }

  update(dt: number, stage: Stage): void {
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= 1 / FPS) {
      this.acc -= 1 / FPS;
      this.tick();
    }
    if (this.model && this.dress) {
      this.model.setVisible(this.modelFade);
      this.model.setRuler(this.editor?.ruler() ?? 0);
      this.model.render(dt);
    }
    void stage;
  }

  private tick(): void {
    this.pad.tick();
    if (this.intro > 0) this.intro--;
    if (this.outro > 0) this.outro--;
    if (this.selActive || this.selWidgets.length) this.tickSelection();
    if (this.dress) this.tickDress();
    this.heading.tick(this.sprites);
    this.help.tick(this.sprites);
  }

  // ------------------------------------------------ class selection logic

  private tickSelection(): void {
    const s = this.sel;
    s.frame++;
    const pad = this.pad;
    if (this.selActive && this.intro <= 3) {
      if (s.state === 0) {
        // FUN_004eb5f0
        if (pad.repeat.has('down')) (se(SE.cursor), (s.type = (s.type + 1) % 3));
        else if (pad.repeat.has('up')) (se(SE.cursor), (s.type = (s.type + 2) % 3));
        if (pad.pressed.has('ok') || pad.pressed.has('right')) {
          se(SE.ok);
          const [lo, hi] = TYPE_RANGE[s.type];
          if (s.cls < lo || s.cls > hi) s.cls = lo; // FUN_004eb6b8
          s.state = 1;
        } else if (pad.pressed.has('cancel')) {
          this.handlers.cancel();
          return;
        }
      } else if (s.state === 1) {
        // FUN_004eb6e0
        if (pad.repeat.has('down')) (se(SE.cursor), s.cls++);
        else if (pad.repeat.has('up')) (se(SE.cursor), s.cls--);
        const [lo, hi] = TYPE_RANGE[s.type]; // FUN_004eb7bc
        if (s.cls < lo) s.cls = hi;
        else if (s.cls > hi) s.cls = lo;
        if (pad.pressed.has('cancel') || pad.pressed.has('left')) (se(SE.back), (s.state = 0));
        else if (pad.pressed.has('ok')) {
          se(SE.ok);
          s.state = 2;
          this.selLeave = 10;
        }
      } else if (s.state === 2 && --this.selLeave <= 0) {
        this.selActive = false;
        this.startDress(s.cls);
      }
      // Key help (FUN_004eb5a0): OK, then OK + CANCEL on the class list.
      if (s.state === 0) this.help.set([HELP.ok]);
      else if (s.state === 1) this.help.set([HELP.ok, HELP.cancel]);
      else this.help.set([]);
    }
    for (const w of this.selWidgets) w.tick(s);
    this.selWidgets = this.selWidgets.filter((w) => !w.dead);
    // FUN_004f49a8: the description follows the cursor once the box is open.
    const box = this.selWidgets.find((w) => w instanceof InfoBox);
    let id = -1;
    if (box && box.fade >= 1 && !box.leaving) id = s.state === 0 ? s.type : CLASS_ORDER[s.cls] + 3;
    if (id !== this.infoId) {
      this.infoId = id;
      if (id >= 0) {
        const lines = id < 3 ? this.lines(TEXT_GROUP.typeInfo, id * 7) : this.lines(TEXT_GROUP.classInfo, (id - 3) * 7);
        this.infoTexts.push(new InfoText(id, lines));
      }
    }
    for (const t of this.infoTexts) t.tick(this.infoId);
    this.infoTexts = this.infoTexts.filter((t) => !t.dead);
  }

  private lines(group: number, start: number): string[] {
    return (this.text[group] ?? []).slice(start, start + 7);
  }

  // ------------------------------------------------ dressing room logic

  // FUN_004eb7ec: the class's default look, section ID 0xFF, empty name.
  private startDress(listIndex: number): void {
    const cls = CLASS_ORDER[listIndex];
    const def = DEFAULT_LOOKS[cls];
    const { classFlags: _flags, ...defLook } = def;
    const look = copyLook(defLook);
    this.dress = { cls, listIndex, classFlags: def.classFlags, look, backup: copyLook(look), name: '', sectionId: 0xff, frame: 0 };
    this.steps = STEP_LISTS[def.classFlags & 0x10 ? 1 : 0];
    this.cursor = 0;
    this.sub = 0;
    this.returned = false;
    this.menuFade = 0;
    this.columnFade = 0;
    this.nameFade = 0;
    this.confirmFade = 0;
    this.modelFade = 0;
    this.editor = null;
    this.model?.setAppearance(cls, look, 0xff);
    this.model?.setCamera(this.cameraMode());
  }

  private get step(): number {
    return this.steps[this.cursor];
  }

  // FUN_004ea854
  private cameraMode(): 0 | 1 | 2 {
    const s = this.sub === 1 || this.sub === 0 ? this.step : -1;
    if (s >= 0 && (s < 3 || s === 4)) return 0;
    if (s === 6 || s === 8) return 1;
    return 2;
  }

  private tickDress(): void {
    const d = this.dress!;
    d.frame++;
    const pad = this.pad;
    // FUN_004ef07c / FUN_004ef0f0 / FUN_004eee18 fades.
    if (this.sub >= 3 && this.sub <= 6) this.menuFade = Math.max(0, this.menuFade - 0.166667);
    else {
      this.menuFade += 0.008333;
      this.menuFade = Math.min(1, this.menuFade + (1 - this.menuFade) * 0.25);
    }
    this.columnFade = this.sub !== 0 ? Math.max(0, this.columnFade - 0.222222) : Math.min(1, this.columnFade + 0.083333);
    if (this.sub === 4 || this.sub === 6) this.modelFade = Math.max(0, this.modelFade - 0.2);
    else if (this.modelFade < 1) {
      const v = this.modelFade > 0.583333 ? ((this.modelFade - 0.583333) / (1 - 0.583333)) * -0.8 + 1 : 1;
      this.modelFade = Math.min(1, this.modelFade + v * 0.083333);
    }

    switch (this.sub) {
      case 0: this.tickMenu(); break;
      case 1: {
        const e = this.editor!;
        e.tick(pad, d, this.help);
        if (e.result !== 'none') {
          this.sub = 0;
          this.returned = true;
        }
        break;
      }
      case 2: this.tickConfirm(); break;
      case 5: if (--this.subTimer < 0) this.sub = 3; break;
      case 6: if (--this.subTimer < 0) this.sub = 4; break;
      case 3:
        this.sub = 7; // finished; wait for the handler
        this.handlers.done({ charClass: d.cls, classFlags: d.classFlags, name: d.name, sectionId: d.sectionId, look: copyLook(d.look) });
        break;
      case 4: {
        // FUN_004e6424 -> FUN_004eb918: back to the class list.
        const type = typeOf(d.listIndex);
        this.dress = null;
        this.editor = null;
        this.startSelection(1, type, d.listIndex);
        return;
      }
    }
    // A closed editor keeps fading out after the menu takes over.
    if (this.editor && this.sub !== 1) {
      this.editor.tick(pad, d, this.help);
      if (this.editor.dead) this.editor = null;
    }
    this.helpForSub();
    this.model?.setAppearance(d.cls, d.look, d.sectionId);
    this.model?.setCamera(this.cameraMode());
    // Name fade (FUN_004ef530).
    const showName = (this.sub === 0 || (this.sub === 1 && this.step !== STEP.name)) && nameValid(d.name);
    this.nameFade = showName ? Math.min(1, this.nameFade + 0.166667) : Math.max(0, this.nameFade - 0.083333);
  }

  // FUN_004ef208
  private tickMenu(): void {
    const d = this.dress!;
    const pad = this.pad;
    this.heading.set(HEADING.creation);
    if (this.returned) {
      this.returned = false;
      return;
    }
    if (d.sectionId === 0xff && pad.pressed.has('cancel')) {
      se(SE.back);
      this.sub = 6;
      this.subTimer = 7;
      return;
    }
    const n = this.steps.length;
    if (pad.repeat.has('down')) (se(SE.cursor), (this.cursor = (this.cursor + 1) % n));
    else if (pad.repeat.has('up')) (se(SE.cursor), (this.cursor = (this.cursor + n - 1) % n));
    if (!pad.pressed.has('ok')) return;
    // The editors' constructors play 0x570; FUN_004f0b80 plays 0x575 without a valid name.
    se(STEP_EDITOR[this.step].kind === 'ok' && !nameValid(d.name) ? SE.buzzer : SE.ok);
    d.backup = copyLook(d.look); // FUN_004ef354
    const ed = STEP_EDITOR[this.step];
    switch (ed.kind) {
      case 'list':
        this.openEditor(new ListEditor(ed.field, d), ed.field);
        break;
      case 'hair':
        this.openEditor(new HairEditor(d), 4);
        break;
      case 'proportion':
        this.openEditor(new ProportionEditor(), -1);
        break;
      case 'auto':
        this.openEditor(new AutoEditor(d), -1);
        break;
      case 'name':
        this.openEditor(new NameEditor(d), -1);
        break;
      case 'ok':
        // FUN_004f0b80: needs a valid name; the section ID is computed once.
        if (!nameValid(d.name)) return;
        if (d.sectionId === 0xff) d.sectionId = sectionIdForName(d.name, d.cls);
        this.sub = 2;
        this.subTimer = 0x3c;
        this.confirmFade = 0;
        break;
    }
  }

  private openEditor(e: Editor, field: number): void {
    this.editor = e;
    this.sub = 1;
    // Headings set by the editors' constructors (FUN_004f04a8 and friends).
    const step = field === 0 ? STEP.costume : field === 1 ? (this.dress!.classFlags & 0x10 ? STEP.body : STEP.skin) : this.step;
    this.heading.set(HEADING.step(step));
  }

  // FUN_004ef410
  private tickConfirm(): void {
    if (--this.subTimer < 0) this.subTimer = 0;
    let f = this.confirmFade + 0.013333;
    if (f < 0.8) f += (0.8 - f) * 0.25;
    this.confirmFade = Math.min(1, f);
    if (this.pad.pressed.has('ok')) {
      se(SE.ok); // FUN_004ef410
      this.sub = 5;
      this.subTimer = 7;
      this.outro = 10; // FUN_004ec4a4(7, 1)
    }
  }

  // Key help per sub-state (FUN_004ef530).
  private helpForSub(): void {
    const d = this.dress!;
    if (this.sub === 0) {
      if (this.step === STEP.ok && !nameValid(d.name)) this.help.set([HELP.back]);
      else if (d.sectionId === 0xff) this.help.set([HELP.ok, HELP.back]);
      else this.help.set([HELP.ok]);
    } else if (this.sub === 1) {
      if (this.step === STEP.name) this.help.set([]);
      else if (this.step !== STEP.auto) this.help.set([HELP.ok, HELP.cancel]);
    } else if (this.sub === 2) this.help.set([HELP.confirm]);
    else this.help.set([]);
  }

  // ------------------------------------------------ input

  key(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (this.sub === 1 && this.editor?.handlesText() && !['Enter', 'Escape', 'Tab'].includes(e.key)) {
      this.editor.text(e);
      return;
    }
    const b = KEYMAP[e.key];
    if (b) this.pad.keydown(b);
  }

  // ------------------------------------------------ drawing

  drawFullscreen(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const list = new DrawList(this.sprites);
    drawBackground(list);
    this.heading.draw(list);
    for (const w of this.selWidgets) w.draw(list, this.sel);
    for (const t of this.infoTexts) t.draw(list);
    if (this.dress) this.drawDress(list);
    this.help.draw(list, this.sprites);
    // Scene wipe (FUN_004ec3c8 / FUN_004ebfc4): opaque for 3 frames, then fades.
    const wipe = this.intro > 0 ? (this.intro < 4 ? 1 : 1 - (18 - this.intro - 3) / 15) : this.outro >= 0 ? 1 - this.outro / 10 : 0;
    if (wipe > 0) list.add(10, (c) => quad(c, [[0, 0], [640, 0], [640, 480], [0, 480]], '#000', wipe * wipe));
    list.flush(ctx);
  }

  private drawDress(list: DrawList): void {
    const d = this.dress!;
    const model = this.model;
    if (model) list.add(-100, (ctx) => model.draw(ctx));
    // Floor line (FUN_004ef530, colors 0x009b90d4): y 416..419, transparent
    // at x = 275 to 50% #c7c7c7 at 400, then solid to 640.
    const a = this.menuFade;
    list.add(-1.8125, (ctx) => {
      const g = ctx.createLinearGradient(275, 0, 400, 0);
      g.addColorStop(0, 'rgba(199,199,199,0)');
      g.addColorStop(1, 'rgba(199,199,199,0.5)');
      quad(ctx, [[275, 416], [400, 416], [400, 419], [275, 419]], g, a);
      quad(ctx, [[400, 416], [640, 416], [640, 419], [400, 419]], 'rgba(199,199,199,0.5)', a);
    });
    // Prompt when OK is highlighted without a name (unitxt 12: 59, 60).
    if (this.sub === 0 && this.step === STEP.ok && !nameValid(d.name)) {
      const pulse = (-0.35 * Math.abs(bsin(d.frame << 10)) + 1);
      const prompt = (this.text[TEXT_GROUP.prompts] ?? []).slice(59, 61);
      list.add(-1.5, (ctx) => prompt.forEach((line, i) => gameText(ctx, line, 604 - textWidth(line), 396 - 19 + i * 19, pulse)));
    }
    if (this.nameFade > 0) list.add(-1.5, (ctx) => gameText(ctx, d.name, 604 - textWidth(d.name), 396, this.nameFade));
    this.drawSteps(list);
    this.editor?.draw(list, d);
    if (this.sub === 2 || this.sub === 5) this.drawConfirm(list);
  }

  // Step column (FUN_004efb84).
  private drawSteps(list: DrawList): void {
    const f = Math.min(this.menuFade, this.columnFade);
    const frame = this.dress!.frame;
    const n = this.steps.length;
    if (f > 0.33) {
      const t = f < 0.66 ? (f - 0.33) / 0.33 : 1;
      for (let i = 0; i < n; i++) {
        const w = this.sprites.width(SPR.stepLabel + this.steps[i]) + 0x90;
        const end = STEP_BAR_END.find((b) => w < b) ?? 0x15b;
        const e = (end - 115) * t + 115;
        const sel = i === this.cursor;
        const x0 = 115 + (sel ? 9 * bsin(frame << 10) : 0);
        const k = sel ? 2 : 0;
        list.sprite(SPR.barBody + k, -2.125, x0, 80 + i * 44, (e - x0) / 48, 1);
        list.sprite(SPR.barCap + k, -2.125, e, 80 + i * 44);
      }
    }
    if (f > 0) {
      const a = f < 0.33 ? f / 0.33 : 1;
      for (let i = 0; i < n; i++) list.sprite(i === this.cursor ? 0 : 1, -1.8125, 95, 80 + i * 44, 1, 1, a);
    }
    if (f <= 0.66) return;
    const a = ((f - 0.66) / 0.34) ** 2;
    for (let i = 0; i < n; i++) {
      const id = this.steps[i];
      const dim = id === STEP.ok && !nameValid(this.dress!.name) ? 0.4 : 1;
      const alpha = i === this.cursor ? Math.min(1, bsin(frame << 10) * 0.25 + 1) * a : 0.6 * a;
      list.sprite(SPR.stepLabel + id, -1.8125, 144, 93 + i * 44, 1, 1, alpha * dim);
    }
  }

  // Confirmation (FUN_004f00bc): labels right-aligned, values at x = 263.
  private drawConfirm(list: DrawList): void {
    const d = this.dress!;
    const f = this.confirmFade;
    const a = f < 0.8 ? f / 0.8 : 1;
    list.sprite(SPR.typeLabel, -3.0625, 243 - this.sprites.width(SPR.typeLabel), 173, 1, 1, a);
    list.sprite(SPR.nameLabel, -3.0625, 242 - this.sprites.width(SPR.nameLabel), 210, 1, 1, a);
    list.sprite(SPR.sectionIdLabel, -3.0625, 202 - this.sprites.width(SPR.sectionIdLabel), 246, 1, 1, a);
    list.add(-2, (ctx) => {
      gameText(ctx, CLASS_NAMES[d.cls] ?? '', 263, 172, a);
      gameText(ctx, d.name, 263, 209, a);
    });
    if (f <= 0.8) return;
    const b = (f - 0.8) / 0.2;
    list.sprite(SPR.sectionIcon + d.sectionId, -3.0625, 212, 234, 1, 1, b);
    const sec = this.text[TEXT_GROUP.sectionNames]?.[d.sectionId] ?? '';
    list.add(-2, (ctx) => gameText(ctx, sec, 263, 247, b));
  }

  // Test hooks.
  get debug() {
    return { sel: this.sel, dress: this.dress, sub: this.sub, cursor: this.cursor, steps: this.steps };
  }
}

// Title screen, rendered from what PsoBB.exe does (Ephinea build 1.25.13).
//
// title.prs (XVM, 21 textures):
//   0      "PRESS ENTER KEY" + Japanese menu labels (256x256, DXT3)
//   1, 2   logo layers
//   3-10   background, 640x512 in tiles
//   11     magic circle (512x512)
//   12     small rings / flash
//   13-20  the same background with a stronger flare
// effect_nt.xvm: particle textures (GBIX 700460 = #5, 700151 = #43).
// f256_hyouji.prs: window skin of the "Login" menu (see stage.ts).
//
// Decompiled functions:
//   FUN_006f8130  title constructor: children, title.adx, screen centre
//                 (124, 201) via FUN_004d434c, particle emitters 0x1e3-0x1e5
//   FUN_006f475c  background render (tiles, flash, magic circle)
//   FUN_006f4cc4  logo and version
//   FUN_006fed04 / FUN_006ff0d4  title menu child: "PRESS ENTER KEY"
//   0x007617e8    the "Login" menu window (text group 41 of unitxt)
// The scene's logic (fades, menu child states, Login menu, Input UserID) is
// classic/titleflow.ts. SinowberillInit_006fb914 loads TitleEP4.prs instead of
// title.prs for an Episode 4 account (same layout, other logo/background).
// Coordinates are in the 640x480 virtual screen; game logic runs at 30 fps.

import { se } from '../audio/se.ts';
import { menuKeyOf } from '../input/keyconfig.ts';
import { drawInputWindow } from './login.ts';
import { drawMenuWindow, drawText, inWindowSpace, ITEM_STEP, type Screen, type Stage, type TextInputState, type WindowSkin } from './stage.ts';
import type { LoginForm } from './loginform.ts';
import { DEFAULT_TEXT, EXIT_CONFIRM, INPUT_WINDOW, LOGIN_MENU, TITLE_FPS, TitleFlow, yesNoRect, type Credentials, type InputUserIdWindow, type Key, type MenuText, type TitleHost } from './titleflow.ts';
import { withWindowAnim } from './windowanim.ts';

export interface TitleAssets {
  title: ImageBitmap[]; // title.prs, or TitleEP4.prs for an Episode 4 account
  effect: ImageBitmap[]; // effect_nt.xvm
  skin: WindowSkin; // f256_hyouji.prs textures 1 and 2
}

export interface TitleOptions {
  // get_game_version() != 0: TitleEP4.prs and the Login menu at y = 330.
  episode4?: boolean;
  version: string;
  text?: MenuText;
  credentials?: Credentials;
  // A phone (fit mode): the tall portrait layout, and the Input UserID window
  // as the HTML form (classic/loginform.ts) instead of the canvas window.
  phone?: boolean;
  form?: LoginForm | null;
}

const RE = {
  fps: 30,
  // FUN_00415ab0/00415bcc tile table 0x009a3840: {x, y, w, h, texture offset}
  tiles: [
    [512, 384, 128, 128, 7], [512, 256, 128, 128, 6], [512, 128, 128, 128, 5], [512, 0, 128, 128, 4],
    [0, 256, 256, 256, 1], [0, 0, 256, 256, 0], [256, 256, 256, 256, 3], [256, 0, 256, 256, 2],
  ] as const,
  baseLayer: 3,
  flareLayer: 13,
  center: [320, 220] as const, // 0x00a96918 / 0x00a9691c
  framesPerTurn: 900, // angle = frame * 0x10000 / 900 (BAMS)
  // FUN_007a919c(0, 0x58, 0x73, frame, 300, 150, 165, 180): RGB(0,88,115) pulsing to white
  color: [0, 88, 115] as const,
  pulse: [300, 150, 165, 180] as const,
  ring: { texture: 11, size: 430, uv: [0, 0, 0.84] },
  innerRing: { texture: 12, size: 178, uv: [0, 0, 0.348] },
  node: { texture: 12, size: 104, uv: [0.3496, 0, 0.203] },
  nodeOffsets: [[-137, -79], [137, -79], [0, 156]] as const, // 0x0096e168
  logo: [[1, 64, 61], [2, 320, 61]] as const,
  version: [10, 460] as const,
  // FUN_006f475c, frames 150..170 of each 300: additive sprite, texture 12.
  // Rect from 0x0096e1c0 (200), 0x0096e1c8 (320), 0x0096e1c4 (128), 0x0096e148
  // (-0.5) and the scale 4.2 (0x0096e154): x0 = 320 - 0.5, y0 = 200 - 0.5,
  // x1 = 320 - 4.2*128*0.25, y1 = 200 - 134.4. x0 > x1 and y0 > y1, so the
  // UVs (0x00a96904..10) are mirrored on both axes. z = 0.00714.
  flash: { x0: 319.5, y0: 199.5, x1: 185.6, y1: 65.6, uv: [0.574, 0, 0.824, 0.25] },
  // FUN_006ff0d4 -> FUN_0082b6bc(sprite set 0x009cff00 + 10*0x20, entry 10, z -10, flags 0x22):
  // set position (193, 338), scale 1; entry 10 = 256x32, texels (0,0)-(255,31)
  // of texture 0. Alpha (material color) = (sin(3 deg * (frame % 120)) + 1) / 2
  // (FUN_006fede0), white.
  press: { x: 193, y: 338, w: 256, h: 32, uv: [0, 0, 255 / 256, 31 / 256] },
};

export class TitleScreen implements Screen {
  private tex: ImageBitmap[];
  private skin: WindowSkin;
  private fx: TitleParticles;
  private tintCache = new Map<string, OffscreenCanvas>();
  private versionText: string;
  private menuY: number;
  private acc = 0;
  readonly flow: TitleFlow;
  // The menu is drawn in window space; main.ts maps pointer coordinates with it.
  readonly pointerSpace = 'window';
  // The title is tapped: rows of the Login menu, the Input UserID window and
  // the exit question (pointer()); the pad would only cover them.
  readonly touchPad = false;
  // A phone: the tall portrait stage (stage.ts tallLayout).
  readonly phoneLayout: boolean;
  private readonly form: LoginForm | null;
  // The Input UserID window the HTML form shows, while it is open.
  private formWin: InputUserIdWindow | null = null;

  textInput(): TextInputState | null {
    const ed = this.flow.menu?.input?.editor;
    return ed ? { password: ed.field === 1 } : null;
  }

  constructor(assets: TitleAssets, host: Omit<TitleHost, 'se'>, opts: TitleOptions) {
    this.tex = assets.title;
    this.skin = assets.skin;
    this.fx = new TitleParticles(assets.effect);
    this.versionText = opts.version;
    this.menuY = opts.episode4 ? LOGIN_MENU.yEpisode4 : LOGIN_MENU.y;
    this.flow = new TitleFlow({ ...host, se }, opts.credentials, opts.text ?? DEFAULT_TEXT);
    this.phoneLayout = opts.phone ?? false;
    this.form = opts.form ?? null;
  }

  // Each show() is a new title scene: fade-in again, no window.
  enter(): void {
    this.flow.reset();
    this.acc = 0;
    this.formWin = null;
  }

  leave(): void {
    this.form?.close();
    this.formWin = null;
  }

  update(dt: number): void {
    this.acc += dt;
    while (this.acc >= 1 / TITLE_FPS) {
      this.acc -= 1 / TITLE_FPS;
      this.flow.tick();
    }
    this.syncForm();
  }

  // Phones: the Input UserID window is the HTML form while the window is open.
  // The form's result is the window's own (InputUserIdWindow.submitForm), so
  // the Login menu takes it as it takes the canvas window's.
  private syncForm(): void {
    const form = this.form;
    if (!form) return;
    const win = this.flow.menu?.input ?? null;
    if (win === this.formWin) return;
    if (this.formWin) {
      form.close();
      this.formWin = null;
    }
    if (win && !win.result) {
      this.formWin = win;
      form.open(this.flow.text.input, win.user, {
        submit: (user, password) => {
          win.submitForm(user, password);
          form.close();
        },
        cancel: () => {
          win.cancelForm();
          form.close();
        },
      });
    }
  }

  // The background tiles (the 640x512 art), drawn in the current transform.
  private drawTiles(ctx: CanvasRenderingContext2D): void {
    for (const layer of [RE.baseLayer, RE.flareLayer]) {
      for (const [x, y, w, h, i] of RE.tiles) ctx.drawImage(this.tex[layer + i], x, y, w, h);
    }
  }

  // The tall phone layout's bars: the background covering the whole canvas,
  // dimmed (stage.ts drawBackdrop).
  drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const c = Math.max(w / 640, h / 512);
    ctx.save();
    ctx.setTransform(c, 0, 0, c, (w - 640 * c) / 2, (h - 512 * c) / 2);
    this.drawTiles(ctx);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, w, h);
  }

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    const frame = Math.floor(stage.time * RE.fps);
    this.drawTiles(ctx);
    this.drawFlash(ctx, frame);

    // Magic circle: additive, colored by the pulse. psobb.io's widescreen
    // patch keeps its quads round while the 4:3 layout is stretched to the
    // window (the 1/1.2 measured on the 16:10 capture is exactly this), so
    // x is scaled by the stage's aspect fix around x = 320. On a 4:3 window
    // it is 1, as in the stock exe.
    const [r, g, b] = pulseColor(frame);
    const angle = ((frame % RE.framesPerTurn) / RE.framesPerTurn) * Math.PI * 2;
    const [cx, cy] = RE.center;
    const tinted = (texture: number) => this.tinted(this.tex[texture], `t${texture}`, r, g, b);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, 0);
    ctx.scale(stage.aspectFix, 1);
    ctx.translate(-cx, 0);
    drawRotated(ctx, tinted(RE.ring.texture), RE.ring.uv, cx, cy, RE.ring.size, -angle);
    drawRotated(ctx, tinted(RE.innerRing.texture), RE.innerRing.uv, cx, cy, RE.innerRing.size, angle);
    for (const [ox, oy] of RE.nodeOffsets) {
      const nx = cx - ox * Math.cos(angle) + oy * Math.sin(angle);
      const ny = cy + ox * Math.sin(angle) + oy * Math.cos(angle);
      drawRotated(ctx, tinted(RE.node.texture), RE.node.uv, nx, ny, RE.node.size, angle);
    }
    ctx.restore();

    this.fx.advanceTo(frame);
    this.fx.draw(ctx, (img, key, cr, cg, cb) => this.tinted(img, key, cr, cg, cb));
    for (const [i, x, y] of RE.logo) ctx.drawImage(this.tex[i], x, y, 256, 256);

    // "PRESS ENTER KEY" (menu child render PrepareUIRenderState_006ff0d4,
    // state 0 only; still drawn under the Login window), alpha from the
    // child's update (titleflow.ts).
    const flow = this.flow;
    if (flow.state === 0 && flow.press > 0) {
      const p = RE.press;
      const t0 = this.tex[0];
      ctx.globalAlpha = flow.press;
      ctx.drawImage(t0, p.uv[0] * t0.width, p.uv[1] * t0.height, (p.uv[2] - p.uv[0]) * t0.width, (p.uv[3] - p.uv[1]) * t0.height, p.x, p.y, p.w, p.h);
      ctx.globalAlpha = 1;
    }

    ctx.letterSpacing = '1.6px';
    drawText(ctx, this.versionText, RE.version[0], RE.version[1] + 6, { size: 10.5, color: '#f4f4f4', bold: false, shadow: '#000' });
    ctx.letterSpacing = '0px';

    inWindowSpace(ctx, stage, () => this.drawWindows(ctx, frame));

    // Fade objects: a black 640x480 quad in front of everything.
    const fade = flow.fadeAlpha;
    if (fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${fade})`;
      ctx.fillRect(0, 0, 640, 480);
    }
  }

  private drawWindows(ctx: CanvasRenderingContext2D, frame: number): void {
    const m = this.flow.menu;
    if (!m) return;
    const win = { x: LOGIN_MENU.x, y: this.menuY, w: LOGIN_MENU.w, h: LOGIN_MENU.h, title: m.text.title };
    withWindowAnim(ctx, m.anim, win.x, win.y, win.w, win.h, () =>
      drawMenuWindow(ctx, this.skin, win, m.rows(), m.active ? m.selected : -1, undefined, m.anim),
    );
    if (m.input && !this.formWin) drawInputWindow(ctx, this.skin, m.input, m.text.input, frame);
    const x = m.exitConfirm;
    if (x) {
      // The question, then the Yes/No list in front of it (titleflow.ts).
      const q = EXIT_CONFIRM;
      withWindowAnim(ctx, x.question, q.x, q.y, q.w, q.h, () => drawMenuWindow(ctx, this.skin, q, [{ label: m.text.reallyOk }], -1, undefined, x.question));
      const yn = yesNoRect(q);
      withWindowAnim(ctx, x.list, yn.x, yn.y, yn.w, yn.h, () =>
        drawMenuWindow(ctx, this.skin, yn, [{ label: m.text.yes }, { label: m.text.no }], x.cursor, undefined, x.list),
      );
    }
  }

  // Flash, FUN_006f475c: gray level = low byte of trunc(255 * (1 - 0.21 k)),
  // k = frame % 300 - 150 in 0..20. The value goes negative from k = 5 and
  // the byte wraps, so the original flickers; reproduced as is.
  private drawFlash(ctx: CanvasRenderingContext2D, frame: number): void {
    const k = (frame % 300) - 150;
    if (k < 0 || k > 20) return;
    const level = Math.trunc((1 - (k / 20) * Math.fround(4.2)) * 255) & 0xff;
    const f = RE.flash;
    const t = this.tex[12];
    const [u0, v0, u1, v1] = f.uv;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Mirrored on both axes: the u0/v0 corner is at (x0, y0) = bottom right.
    ctx.translate(f.x0, f.y0);
    ctx.scale(-1, -1);
    ctx.drawImage(this.tinted(t, 't12', level, level, level), u0 * t.width, v0 * t.height, (u1 - u0) * t.width, (v1 - v0) * t.height, 0, 0, f.x0 - f.x1, f.y0 - f.y1);
    ctx.restore();
  }

  // Texture multiplied by a vertex color, as D3D does with diffuse * texture.
  // Colors are quantized so only a few cached variants are needed.
  private tinted(src: CanvasImageSource & { width: number; height: number }, id: string, r: number, g: number, b: number): OffscreenCanvas {
    const q = (v: number) => Math.min(255, Math.round(v / 8) * 8);
    const key = `${id}:${q(r)},${q(g)},${q(b)}`;
    let c = this.tintCache.get(key);
    if (!c) {
      c = new OffscreenCanvas(src.width, src.height);
      const g2 = c.getContext('2d')!;
      g2.drawImage(src, 0, 0);
      g2.globalCompositeOperation = 'multiply';
      g2.fillStyle = `rgb(${q(r)}, ${q(g)}, ${q(b)})`;
      g2.fillRect(0, 0, c.width, c.height);
      g2.globalCompositeOperation = 'destination-in';
      g2.drawImage(src, 0, 0);
      this.tintCache.set(key, c);
    }
    return c;
  }

  key(e: KeyboardEvent): void {
    if (this.formWin) return; // the HTML form has the keys
    const k = toKey(e);
    if (k) this.flow.key(k);
  }

  // Mouse (a browser convenience): hover moves the Login menu's cursor,
  // click confirms; a click on the bare title acts as Enter.
  pointer(vx: number, vy: number, click: boolean): void {
    if (this.formWin) return;
    const m = this.flow.menu;
    if (!m) {
      if (click) this.flow.key('enter');
      return;
    }
    // Input UserID window: a tap on a row selects it (UserID / Password open
    // the editor, Confirm / Cancel act).
    if (m.input) {
      const w = INPUT_WINDOW;
      const row = Math.floor((vy - (w.y + 16)) / ITEM_STEP);
      if (click && vx >= w.x + 10 && vx <= w.x + w.w - 10 && row >= 0 && row < 4) m.input.tapRow(row);
      return;
    }
    // Exit question: Yes / No.
    if (m.exitConfirm) {
      const r = yesNoRect(EXIT_CONFIRM);
      const row = Math.floor((vy - (r.y + 10)) / ITEM_STEP);
      if (click && vx >= r.x && vx <= r.x + r.w && row >= 0 && row < 2) m.tapYesNo(row);
      return;
    }
    if (!m.active || vx < LOGIN_MENU.x || vx > LOGIN_MENU.x + LOGIN_MENU.w) return;
    const i = Math.floor((vy - (this.menuY + 16)) / 20);
    const rows = m.rows();
    if (i < 0 || i >= rows.length || !rows[i].selectable) return;
    for (let guard = 0; m.selected !== i && guard < rows.length; guard++) this.flow.key(i > m.selected ? 'down' : 'up');
    if (click) this.flow.key('enter');
  }
}

// Keyboard -> the client's key slots (the live Decide / Cancel / Select keys,
// Escape = cancel slot 0xd, Alt+Backspace = exit the game), or a typed
// character. Backspace stays the text delete of the name and password fields
// (and exits the game with Alt).
export function toKey(e: Pick<KeyboardEvent, 'key' | 'altKey'>): Key | null {
  const mk = menuKeyOf(e);
  if (mk === 'up') return 'up';
  if (mk === 'down' || e.key === 'Tab') return 'down';
  if (mk === 'left') return 'left';
  if (mk === 'right') return 'right';
  if (mk === 'decide') return 'enter';
  if (e.key === 'Escape') return 'cancel';
  if (e.key === 'Backspace') return e.altKey ? 'exitGame' : 'backspace';
  if (mk === 'cancel') return 'cancel';
  return e.key.length === 1 ? { char: e.key } : null;
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

// ---------------------------------------------------------------------------
// Light beam: particle effects 0x1e3 "title_a", 0x1e4 "title_b" and 0x1e5
// "title_seiunn", entries of particleentry.dat (0x98 bytes each, data.gsl),
// emitted at (0, 0, -47) by FUN_0050a0ec from the title constructor.
//
// Emitter (FUN_00508f58): acc += number (+0x44) each frame; while acc >= 1,
// acc -= 1 and spawn one particle of particle_type (+0x10).
// Type 2 (title_a/b, FUN_0051145c, update FUN_0051095c, render FUN_00511004):
//   start = emitter + (rand - 0.5) * variation (+0x18..+0x20); speed = vacume
//   (+0x30) + rand * speed_x (+0x38), scaled by +0x50 every frame; each frame
//   the particle moves `speed` toward the emitter (negative: away from it,
//   FUN_007a8f28) and remembers the step. Life = round(duration (+0x48) +
//   rand * appear (+0x4c)) frames. tex_flags & 4: drawn as a streak along the
//   on-screen direction of the step, width radius (+0x60) * |step|, height
//   opt1 (+0x64) * |step| (renderer 4: rotated quad).
// Type 0 (title_seiunn, FUN_0050ec4c, update FUN_0050dbb8, render FUN_0050e698):
//   velocity (vacume + rand * speed_x, 0, 0) rotated by a random angle about Y,
//   x/z damped by +0x50 each frame; size = scale_x (+0x24) + rand * scale_y
//   (+0x28), times scale_z (+0x2c) each frame; tex_flags & 0x10: atlas frame
//   = round(15 * age) (renderer 3: axis-aligned quad).
// Both: fade = min(age / +0x58, (1 - age) / +0x5c) (1 outside those ranges);
// RGB = clamp(age * (+0x6c, +0x70, +0x74) + (+0x7c, +0x80, +0x84)) * fade
// (effect_nt renderers with flag 1 premultiply); blend SRCALPHA/ONE.
// Projection (renderers 0x801b..0x802114): view space = world (no camera on
// the title), screen = centre + (x, -y) * D / -z, with the centre set to
// (124, 201) by the title (FUN_004d434c -> 0x00a48828) and D = 240 * cot(fov/2)
// for the default perspective (FUN_0082eea0 with angle 0x3555:
// fov = 2 * atan(tan(0x3555 * 0.425) / 1.1333) = 57.5 deg, D = 437.44).
// Sprite half-size = D / -z * 16 (effect_nt metadata width) * size.
// ---------------------------------------------------------------------------

interface ParticleDef {
  type: 0 | 2;
  texture: number; // effect_nt.xvm index
  variation: [number, number, number];
  size: [number, number, number]; // base, random, per-frame factor
  vacume: number;
  speed: number;
  damping: number; // +0x50
  rate: number; // +0x44
  life: [number, number]; // duration, appear
  fade: [number, number]; // +0x58, +0x5c
  streak: [number, number]; // +0x60, +0x64
  colorSlope: [number, number, number];
  colorBase: [number, number, number];
  frames: number; // atlas frames (renderer metadata), 1 = whole texture
}

// Values read from particleentry.dat (data.gsl) entries 0x1e3..0x1e5.
const PARTICLES: ParticleDef[] = [
  { type: 2, texture: 5, variation: [10, 1, 10], size: [0.05, 0.15, 1], vacume: -0.2, speed: 0.05, damping: 1, rate: 0.8, life: [50, 10], fade: [0.8, 0.9498], streak: [7, 0.05], colorSlope: [0, -0.2, 0], colorBase: [0.8, 0.8, 0.8], frames: 1 },
  { type: 2, texture: 5, variation: [5, 1, 5], size: [0.05, 0.15, 1], vacume: -0.2, speed: 0.1, damping: 1, rate: 0.5, life: [100, 20], fade: [0.6, 0.7], streak: [1.3, 0.03], colorSlope: [0, -0.5, 0], colorBase: [0.9, 0.9, 0.9], frames: 1 },
  { type: 0, texture: 43, variation: [0, 0, 0], size: [0.07, 0.15, 0.994], vacume: 0.0798, speed: 0.0399, damping: 0.9969, rate: 0.8, life: [350, 300], fade: [0.1, 0.5], streak: [3, 0.8], colorSlope: [-1, -0.8, 0], colorBase: [0.5, 0.6998, 1], frames: 16 },
];

const EMITTER: [number, number, number] = [0, 0, -47];
const SCREEN_CENTER: [number, number] = [124, 201];
const PROJ_D = 437.44;
const NT_SIZE = 16; // effect_nt metadata width/height of textures 5 and 43

interface Particle {
  def: ParticleDef;
  p: [number, number, number];
  v: [number, number, number]; // type 0 velocity / type 2 last step
  speed: number;
  size: number;
  age: number;
  dt: number;
}

class TitleParticles {
  private tex: ImageBitmap[];
  private list: Particle[] = [];
  private acc = [0, 0, 0];
  private frame = 0;
  private seed = 1;

  constructor(effect: ImageBitmap[]) {
    this.tex = effect;
  }

  // MSVC-like rand() / 32768, seeded so captures are reproducible.
  private rand(): number {
    this.seed = (Math.imul(this.seed, 214013) + 2531011) | 0;
    return ((this.seed >>> 16) & 0x7fff) / 32768;
  }

  advanceTo(frame: number): void {
    if (frame < this.frame) {
      this.list = [];
      this.acc = [0, 0, 0];
      this.frame = 0;
      this.seed = 1;
    }
    // Cap catch-up work after long pauses: older particles are dead anyway.
    if (frame - this.frame > 1200) {
      this.list = [];
      this.frame = frame - 1200;
    }
    while (this.frame < frame) this.step();
  }

  private step(): void {
    this.frame++;
    PARTICLES.forEach((def, i) => {
      this.acc[i] += def.rate;
      while (this.acc[i] >= 1) {
        this.acc[i] -= 1;
        this.list.push(this.spawn(def));
      }
    });
    for (const q of this.list) this.update(q);
    this.list = this.list.filter((q) => q.age < 1);
  }

  private spawn(def: ParticleDef): Particle {
    const r = () => this.rand();
    const p: [number, number, number] = [
      EMITTER[0] + (r() - 0.5) * def.variation[0],
      EMITTER[1] + (r() - 0.5) * def.variation[1],
      EMITTER[2] + (r() - 0.5) * def.variation[2],
    ];
    const size = r() * def.size[1] + def.size[0];
    const dt = 1 / Math.round(r() * def.life[1] + def.life[0]);
    if (def.type === 2) {
      const speed = r() * def.speed + def.vacume;
      return { def, p, v: [0, 0, 0], speed, size, age: 0, dt };
    }
    const vx = r() * def.speed + def.vacume;
    const a = r() * Math.PI * 2; // FUN_007829f4 about Y
    return { def, p, v: [vx * Math.cos(a), 0, -vx * Math.sin(a)], speed: 0, size, age: 0, dt };
  }

  private update(q: Particle): void {
    const d = q.def;
    if (d.type === 2) {
      q.speed *= d.damping;
      const dx = EMITTER[0] - q.p[0], dy = EMITTER[1] - q.p[1], dz = EMITTER[2] - q.p[2];
      const len = Math.hypot(dx, dy, dz);
      if (q.speed < len && len !== 0) q.v = [(dx / len) * q.speed, (dy / len) * q.speed, (dz / len) * q.speed];
      else q.v = [dx, dy, dz];
      q.p = [q.p[0] + q.v[0], q.p[1] + q.v[1], q.p[2] + q.v[2]];
    } else {
      q.p = [q.p[0] + q.v[0], q.p[1] + q.v[1], q.p[2] + q.v[2]];
      q.v = [q.v[0] * d.damping, q.v[1], q.v[2] * d.damping];
      q.size *= d.size[2];
    }
    q.age += q.dt;
  }

  draw(ctx: CanvasRenderingContext2D, tint: (img: ImageBitmap, key: string, r: number, g: number, b: number) => OffscreenCanvas): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const q of this.list) {
      const d = q.def;
      const z = -q.p[2];
      if (z < 1) continue; // renderers skip z_view > -1
      const k = PROJ_D / z;
      const sx = SCREEN_CENTER[0] + q.p[0] * k;
      const sy = SCREEN_CENTER[1] - q.p[1] * k;
      const t = Math.min(q.age, 1);
      const fade = Math.min(t < d.fade[0] ? t / d.fade[0] : 1, 1 - t < d.fade[1] ? (1 - t) / d.fade[1] : 1);
      if (fade <= 0) continue;
      const c = [0, 1, 2].map((i) => Math.max(0, Math.min(1, t * d.colorSlope[i] + d.colorBase[i])) * 255);
      // Fade is applied as alpha on a tinted copy (additive: same result).
      ctx.globalAlpha = fade * (254 / 255);
      const img = tint(this.tex[d.texture], `nt${d.texture}`, c[0], c[1], c[2]);
      if (d.type === 2) {
        const L = Math.hypot(q.v[0], q.v[1], q.v[2]);
        if (L === 0) continue;
        const e = [q.p[0] + q.v[0], q.p[1] + q.v[1], q.p[2] + q.v[2]];
        const ke = PROJ_D / -e[2];
        const ex = SCREEN_CENTER[0] + e[0] * ke;
        const ey = SCREEN_CENTER[1] - e[1] * ke;
        const hw = k * NT_SIZE * d.streak[0] * L;
        const hh = k * NT_SIZE * d.streak[1] * L;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.atan2(ey - sy, ex - sx));
        ctx.drawImage(img, -hw, -hh, hw * 2, hh * 2);
        ctx.restore();
      } else {
        const frame = Math.round((d.frames - 1) * t);
        const cell = img.width / 4;
        const h = k * NT_SIZE * q.size;
        ctx.drawImage(img, (frame % 4) * cell, Math.floor(frame / 4) * cell, cell, cell, sx - h, sy - h, h * 2, h * 2);
      }
    }
    ctx.restore();
  }
}

// Lobby chat: the input line, the word balloons and the chat log, as
// PsoBB.exe (Ephinea 1.25.13) does them. All coordinates are the 640x480
// in-game window space; game logic runs at 30 frames per second.
//
// Chat key (FUN_0072f37c -> FUN_0072fdac): the input opens when input 9
// ("begin_chat_input") is pressed, which is "Start" in the key config, SPACE
// by default (newserv default-keyboard-config.bin, key id 0x59). Enter
// (key 0x61) sends, Escape (0x4c) cancels (FUN_0072f280 / handle_text_input_end).
//
// Input line (TWindowKeyboardBase, ctor 0x0072ebfc, vtable 0x00b40548, created
// by FUN_00713540):
//   - FUN_00731300(200, 2): width 200 + 20.1 (0x00970f9c), height 2 * 20 + 20
//     (0x00970f98); max length 0x4f = 79 characters (FUN_007312f0);
//   - position: table entry 0xc9 = (7, 397) (FUN_007138e0 -> FUN_0073128c);
//   - render FUN_0072fee4: no frame (flag 0x40 is only set by FUN_0078ee8c),
//     the typed text (FUN_0072ff2c) wraps at the content width, 20 px per line
//     (0x00970fe0), content inset 10 px (generic layout FUN_0071b900);
//   - cursor FUN_007307a8: a 5 x 14 quad (0x00970fd4, 0x00970fd0) colored
//     0x8000ff00 / 0x4000ff00 (table 0x00970f68), alternating every 16 frames
//     (frame counter 0x00a9c4ec & 0x10).
//
// Word balloons (vtable 0x00b3fcc8: update FUN_0071dd20, render FUN_0071e084).
// See ChatBubble below for the per-function details.
//
// Chat log (FUN_0073b858 = append_to_chat_log): 30 entries (0x00a9a920..),
// each "<name> > <text>" (0x00971cfc), the oldest dropped. There is no
// permanent log on screen: the main menu's "Log Window" (id 0x15,
// FUN_00752114) opens a list window at (17, 36), 303 x 400 (0x00973d78) that
// shows the 30 lines and receives new ones (UI table + 0x44).

import * as THREE from 'three';
import { drawGameText, gameTextWidth, GAME_TEXT } from './gametext.ts';
import { se } from '../audio/se.ts';
import { activeColorEscape } from './textcodes.ts';
import { drawWindowFrame, type WindowSkin } from './stage.ts';
import { drawSymbolParts, symbolSoundId, SYMBOL_CHAT_FRAMES, SYMBOL_PLATE, type TintFn } from './symbolchat.ts';
import type { SymbolChat } from '../net/symbolchat.ts';

export const CHAT_LOG_LINES = 0x1e; // FUN_0073b71c / FUN_0073b858
export const CHAT_MAX_LENGTH = 0x4f; // FUN_00713540 -> FUN_007312f0

// Wraps text by characters at `width` virtual pixels (the client's text
// objects break where the next glyph would cross the width, FUN_0072ff2c).
export function wrapGameText(text: string, width: number): string[] {
  const out: string[] = [];
  let active = ''; // the colour escape in force (it carries over wraps and newlines)
  for (const para of text.split('\n')) {
    let line = active;
    let w = 0;
    for (let i = 0; i < para.length; ) {
      if (para[i] === '\t' && i + 1 < para.length) {
        const code = para.slice(i, i + (para[i + 1] === 'C' ? 3 : 2));
        line += code;
        active = activeColorEscape(active + code);
        i += code.length;
        continue;
      }
      const ch = para[i++]!;
      const cw = gameTextWidth(ch);
      if (w + cw > width && w > 0) {
        out.push(line);
        line = active;
        w = 0;
      }
      line += ch;
      w += cw;
    }
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Input line
// ---------------------------------------------------------------------------

export const CHAT_INPUT = { x: 7, y: 397, w: 200 + 20.1, h: 2 * 20 + 20, lines: 2 };

export class ChatInput {
  text: string | null = null; // null = closed

  get open(): boolean {
    return this.text !== null;
  }

  begin(): void {
    this.text = '';
  }

  // Returns the text to send on Enter, or null.
  key(e: KeyboardEvent): string | null {
    if (this.text === null) return null;
    if (e.key === 'Enter') {
      const t = this.text;
      this.text = null;
      return t.trim() ? t : null;
    }
    if (e.key === 'Escape') this.text = null;
    else if (e.key === 'Backspace') this.text = this.text.slice(0, -1);
    else if (e.key.length === 1 && this.text.length < CHAT_MAX_LENGTH) {
      // The text may not grow past the two lines of the window (FUN_0072ff2c
      // drops what does not fit).
      const next = this.text + e.key;
      if (wrapGameText(next, CHAT_INPUT.w - 20).length <= CHAT_INPUT.lines) this.text = next;
    }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, frame: number): void {
    if (this.text === null) return;
    const cx = CHAT_INPUT.x + 10;
    const cy = CHAT_INPUT.y + 10;
    const lines = wrapGameText(this.text, CHAT_INPUT.w - 20);
    lines.forEach((l, i) => drawGameText(ctx, l, cx, cy + i * GAME_TEXT.lineHeight, '#ffffff'));
    const last = lines[lines.length - 1] ?? '';
    const x = cx + gameTextWidth(last);
    const y = cy + (lines.length - 1) * GAME_TEXT.lineHeight;
    ctx.fillStyle = frame & 0x10 ? 'rgba(0,255,0,0.25)' : 'rgba(0,255,0,0.5)';
    ctx.fillRect(x, y, 5, 14);
  }
}

// ---------------------------------------------------------------------------
// Chat log and its window
// ---------------------------------------------------------------------------

export class ChatLog {
  lines: string[] = [];

  add(name: string, text: string): void {
    // unknown_write_chat_message_to_logs turns '\n' into spaces first.
    this.lines.push(name ? `${name} > ${text.replace(/\n/g, ' ')}` : text);
    if (this.lines.length > CHAT_LOG_LINES) this.lines.shift();
  }
}

export const LOG_WINDOW = { x: 17, y: 36, w: 303, h: 400 }; // 0x00973d78

// The Log Window: the newest lines at the bottom (the list window scrolls to
// its last item when one is added, FUN_0073c228 -> FUN_0073b558).
export function drawLogWindow(ctx: CanvasRenderingContext2D, skin: WindowSkin, log: ChatLog): void {
  const { x, y, w, h } = LOG_WINDOW;
  drawWindowFrame(ctx, skin.frame, x, y, w, h);
  const rows = log.lines.flatMap((l) => wrapGameText(l, w - 20));
  const fit = Math.floor((h - 20 + 6) / GAME_TEXT.lineHeight);
  rows.slice(-fit).forEach((l, i) => drawGameText(ctx, l, x + 10, y + 10 + i * GAME_TEXT.lineHeight, '#ffffff'));
}

// ---------------------------------------------------------------------------
// Word balloons
// ---------------------------------------------------------------------------

// Balloon color per client id (0x009702a0, FUN_00720d94); 0xfff8f8f8 otherwise.
export const BUBBLE_COLORS = [
  0xffc8c8, 0xa2ff9d, 0xfbffb5, 0xb0f8ff, 0xd1adff, 0xffbf7c, 0xa5b6fb, 0xffb99c, 0x90d29b, 0x8bb5ee, 0xffb5da, 0xffff8c,
];
const DEFAULT_COLOR = 0xf8f8f8;

// Constants of the balloon code (addresses in PsoBB.exe).
const B = {
  wrap: 200, // FUN_00720940 -> FUN_0072ddf4(200.0): text width limit
  pad: 20.1, // 0x00970560: window = text extent + 20.1
  lifeA: 3.3, // 0x0097037c: frames per character
  lifeB: 55.5, // 0x00970380
  grow: 0.47, // 0x00970574: scale += (target - scale) * 0.47 per frame
  growEps: 0.011, // 0x00970570
  sizeFrames: 6, // FUN_0071dd20 states 1 and 5: size lerp over 6 frames
  follow: 0.21, // 0x00970468: centre += (target - centre) * 0.21
  followEps: 0.1, // 0x00970464
  slant: 0.342, // 0x0097044c: the balloon leans by 0.342 * height
  shadow: [3.0, 2.5] as const, // 0x00970558 / 0x00970554: black copy offset
  tailHalf: 12, // 0x00970548 / 0x009703e4: tail base half-width
  tailNear: 1000, // 0x0097054c / 0x009703e8: tip pulled back by 1000 / distance
  bounds: { left: 20, right: -20, top: 40, bottom: -40 }, // 0x0097045c..50 (FUN_0071fe58)
  // Placement (FUN_0071f0c0 / FUN_0071f830): ellipse radii
  // ((w * 0.5 + 20) * 0.5, (h * 0.5 + 10) * 0.5), default angle 0xd400.
  defaultAngle: 0xd400,
  moveMin: 10, // 0x009704bc: keep the old place if the new one is within 10
  // Name tab (FUN_0072062c), texturejapanese texture 0.
  tab: { dx: -11, dy: -18, cap: 16, h: 25, minText: 20, textDx: 6, textDy: 3 },
  tabFade: 6, // alpha = open frames * 255 / 6 (0x009703dc)
  maxBubbles: 4, // UI table + 0x90..0x9c
  dockMargin: -50, // 0x0097051c: the margin of a docked balloon (0x00970520 = 0 otherwise)
  farSq: 14400, // 0x00970518: squared distance limit (0x00970514 = 40 per margin unit)
};

const bams = (a: number) => (a / 0x10000) * Math.PI * 2;

// FUN_0071f830: offset of the balloon centre from the head for angle a.
function offsetFromAngle(a: number, w: number, h: number): [number, number] {
  const rx = (w * 0.5 + 20) * 0.5;
  const ry = (h * 0.5 + 10) * 0.5;
  const t = bams(a);
  let px = Math.cos(t) * rx;
  let py = Math.sin(t) * ry;
  let sx: number;
  let sy: number;
  if (((a + 0x2000) & 0x4000) === 0) {
    const right = ((a + 0x2000) & 0x8000) === 0;
    sx = right ? 1 : -1;
    sy = Math.tan(t) * (right ? 1 : -1);
  } else {
    sx = Math.tan(t - Math.PI / 2);
    if ((a & 0x8000) === 0) {
      sx = -sx;
      sy = 1;
    } else sy = -1;
  }
  px += rx * sx;
  py += ry * sy;
  return [px, py];
}

const toBams = (y: number, x: number) => Math.round((Math.atan2(y, x) * 0x10000) / (Math.PI * 2)) & 0xffff;

export interface BubbleTextures {
  body: CanvasImageSource; // f256_hyouji.prs texture 1 (white rounded block at 98..194 x 0..96)
  tab: CanvasImageSource; // texturejapanese.xvm texture 0 (name tab at v 237..256)
  // f256_hyouji.prs textures 9..12: the symbol chat's corner sheets (classic/symbolchat.ts).
  symbol: readonly CanvasImageSource[];
}

// Colour multiply of a sheet, cached per image and colour (the balloon's tint, as `tinted`).
const symbolTintCache = new WeakMap<object, Map<number, OffscreenCanvas>>();
const symbolTint: TintFn = (img, colour) => {
  let m = symbolTintCache.get(img as object);
  if (!m) symbolTintCache.set(img as object, (m = new Map()));
  let c = m.get(colour);
  if (c) return c;
  const w = (img as { width: number }).width;
  const h = (img as { height: number }).height;
  c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = rgb(colour & 0xffffff);
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  m.set(colour, c);
  return c;
};

// The projected head (window space): `dist` from the camera, `front` in front of it.
export interface BubbleHead {
  x: number;
  y: number;
  dist: number;
  visible: boolean;
  front: boolean;
}

// The dock slot bits shared by the balloons (table + 0x1c, 0x40 << slot).
export interface DockState {
  taken: number;
}

// What a balloon reads each frame: the other balloons, the dock bits, rand().
interface BubbleEnv {
  peers: ChatBubble[];
  dock: DockState;
  rand: () => number;
}

export class ChatBubble {
  // Width of the window space (640, more on a wide window).
  static screenW = 640;
  // Height of the frame the bubbles are placed in (480, or the tall fill's vh).
  static screenH = 480;
  readonly clientId: number;
  readonly name: string;
  readonly color: number;
  private lines: string[] = [];
  private textW = 0;
  // State machine of FUN_0071dd20 (0 new .. 9 dead).
  state = 0;
  scale = 0; // +0x94
  life = 0; // +0x88
  textShown = false; // +0x85 bit 4
  openFrames = 0; // window open counter (name tab fade)
  private target = { w: 0, h: 0 }; // +0x38 / +0x3c
  private size = { w: 0, h: 0 }; // +0x48 / +0x4c
  private sizeLeft = 0; // +0x50
  private pos = { x: 0, y: 0 }; // +0x30 / +0x34: placed top-left
  private centre = { x: 0, y: 0 }; // +0x9c / +0xa0
  private rect = { x: 0, y: 0 }; // +0x40 / +0x44: drawn top-left
  private head: BubbleHead = { x: 0, y: 0, dist: 1, visible: false, front: false };
  private prevHead: BubbleHead | null = null; // the head of the last frame
  docked = false; // flag 0x200 (and 0x85 bit 0): on a dock slot
  slot = -1; // 0x87: the dock slot, -1 none
  tailOn = false; // flag 0x20: the tail to the head
  // The symbol chat drawn instead of the text (sayParts), null for a text balloon.
  symbol: SymbolChat | null = null;

  constructor(clientId: number, name: string) {
    this.clientId = clientId;
    this.name = name;
    this.color = BUBBLE_COLORS[clientId] ?? DEFAULT_COLOR;
  }

  get alive(): boolean {
    return this.state !== 9;
  }

  // FUN_00720940: new text. Lifetime round(len * 3.3 + 55.5) frames; an open
  // balloon shrinks to half size and grows again with the new text (state 5).
  // `wrap`: width limit; quest balloons (flag 4, ChatBubbleEntity_UpdateText
  // AndSize_00720954) pass Infinity and keep the text's own line breaks.
  say(text: string, wrap: number = B.wrap): void {
    this.symbol = null;
    this.lines = wrapGameText(text, wrap);
    this.textW = Math.max(...this.lines.map(gameTextWidth));
    const textH = this.lines.length * GAME_TEXT.lineHeight - 6;
    this.target = { w: this.textW + B.pad, h: textH + B.pad };
    this.life = Math.round(text.length * B.lifeA + B.lifeB);
    this.textShown = false;
    if (this.state !== 0) this.state = 5;
  }

  // ChatBubbleEntity_RenderChatParts_00720b34: a symbol chat in place of the text.
  // The balloon is the plate's size (ASSUMED: the text pad added), it lives
  // SYMBOL_CHAT_FRAMES frames (`*(short*)(this+0x88) = 0x5a`) and it goes through
  // the same grow / shrink states as a new text (state 5 when open).
  sayParts(chat: SymbolChat): void {
    this.symbol = chat;
    this.lines = [];
    this.textW = 0;
    this.target = { w: SYMBOL_PLATE + B.pad, h: SYMBOL_PLATE + B.pad };
    this.life = SYMBOL_CHAT_FRAMES;
    this.textShown = false;
    if (this.state !== 0) this.state = 5;
  }

  // One game frame. `head` is the projected head point (window space); `env`
  // holds the other balloons and the dock slots. The state switch is the
  // exe's: dd20 (FUN_0071dd20) runs the states, the render's placement runs in
  // states 2, 4 and 6 and the hide in state 8 (render_chat_bubbles_related).
  // `env` defaults to the quest balloons' own dock state (questui.ts ticks
  // a balloon alone; the exe's dock table is shared, so one state serves).
  tick(head: BubbleHead, env: BubbleEnv = soloEnv): void {
    this.head = head;
    switch (this.state) {
      case 0: // FUN_0071e084 case 0: centred on the head
        this.pos = { x: head.x - this.target.w * 0.5, y: head.y - this.target.h * 0.5 };
        this.centre = { x: head.x, y: head.y };
        this.state = 1;
        break;
      case 1:
        this.sizeLeft = B.sizeFrames;
        this.state = 2;
        // then runs case 2 in the same frame
        this.grow(1, 3);
        this.place(head, env);
        break;
      case 2:
        this.grow(1, 3);
        this.place(head, env);
        break;
      case 3:
        this.state = 4;
        this.textShown = true;
        // then runs case 4 in the same frame
        this.place(head, env);
        if (--this.life < 0) this.state = 7;
        break;
      case 4:
        this.place(head, env);
        if (--this.life < 0) this.state = 7;
        break;
      case 5:
        this.sizeLeft = B.sizeFrames;
        this.textShown = false;
        this.state = 6;
        // then runs case 6 in the same frame
        if (this.grow(0.5, 1)) this.scale = 0.5;
        this.place(head, env);
        break;
      case 6:
        if (this.grow(0.5, 1)) this.scale = 0.5;
        this.place(head, env);
        break;
      case 7:
        this.textShown = false;
        this.state = 8;
        // then runs case 8 in the same frame
        if (this.grow(0, 9)) this.scale = 0;
        this.placeHide(head, env);
        break;
      case 8:
        if (this.grow(0, 9)) this.scale = 0;
        this.placeHide(head, env);
        break;
    }
    this.prevHead = head;
    if (this.textShown) this.openFrames++;
    else this.openFrames = 0;
    this.animate();
  }

  // Placed states of the exe's list (flag 0x100 is set in states 1..6 and
  // cleared when the hide starts).
  get placed(): boolean {
    return this.state >= 1 && this.state <= 6;
  }

  // scale += (to - scale) * 0.47 until the step is below 0.011.
  private grow(to: number, next: number): boolean {
    const d = (to - this.scale) * B.grow;
    if (Math.abs(d) >= B.growEps) {
      this.scale += d;
      return false;
    }
    this.scale = to === 0.5 ? 0.5 : to;
    this.state = next;
    return true;
  }

  // UIElementMover_UpdatePosition (flags 0x400 clear): off the frame, the
  // balloon docks; on it, the head offset is kept (UpdatePositionFromEntity),
  // then the angle placement (FUN_0071f0c0) wins when it succeeds.
  private place(head: BubbleHead, env: BubbleEnv): void {
    if (this.offscreen(head)) {
      this.dockAt(env);
      return;
    }
    this.undock(env.dock);
    const old = this.prevHead ?? head;
    const ent = this.clampBounds({ x: this.pos.x + head.x - old.x, y: this.pos.y + head.y - old.y });
    const entOk = !this.overlaps(ent, env);
    const tgt = this.targetPlace(head, ent, env);
    if (tgt) this.pos = tgt;
    else if (entOk) this.pos = ent;
  }

  // ChatBubbleObject_UpdatePositionAndVisibility (state 8): docked when off the
  // frame, else centred on the head (no overlap test).
  private placeHide(head: BubbleHead, env: BubbleEnv): void {
    if (this.offscreen(head)) {
      this.dockAt(env);
      return;
    }
    this.undock(env.dock);
    this.pos = { x: head.x - this.target.w * 0.5, y: head.y - this.target.h * 0.5 };
  }

  // ChatBubbleObject_UpdateVisibility (1 = docked): the head is off the frame
  // (50 px in once docked, 0 otherwise), behind the camera, or more than 120
  // units away (dist^2 > 14400 + margin * 40). The tail (flag 0x20) is on
  // while it is not.
  private offscreen(head: BubbleHead): boolean {
    const m = this.docked ? B.dockMargin : 0;
    const off =
      head.x < -m || head.y < -m || ChatBubble.screenW + m < head.x || ChatBubble.screenH + m < head.y || !head.front || head.dist * head.dist > B.farSq + m * 40;
    this.tailOn = !off;
    return off;
  }

  // The balloon's top-left clamped to the frame (UpdatePositionFromEntity and
  // UIElementMover_UpdatePosition: 20 / 40 from the edges, 0x0097045c..50).
  private clampBounds(p: { x: number; y: number }): { x: number; y: number } {
    const { w, h } = this.size;
    const { bounds } = B;
    const x = Math.min(Math.max(p.x, bounds.left), ChatBubble.screenW + bounds.right - w);
    const y = Math.min(Math.max(p.y, bounds.top), ChatBubble.screenH + bounds.bottom - h);
    return { x, y };
  }

  // The fit test of FUN_0071f0c0 before the overlap test: inside the bounds.
  private inBounds(p: { x: number; y: number }): boolean {
    const { w, h } = this.size;
    const { bounds } = B;
    return p.x >= bounds.left && p.x <= ChatBubble.screenW + bounds.right - w && p.y >= bounds.top && p.y <= ChatBubble.screenH + bounds.bottom - h;
  }

  // UIElement_CheckBounds (FUN_00712498): does the box at p (the target size)
  // overlap a placed balloon? Two docked balloons may overlap. The x test
  // reads the other balloon's placed x and its drawn x (0x30, 0x40) as the exe.
  private overlaps(p: { x: number; y: number }, env: BubbleEnv): boolean {
    const { w, h } = this.target;
    for (const o of env.peers) {
      if (o === this || !o.placed) continue;
      if (this.docked && o.docked) continue;
      if (p.x < o.pos.x + o.target.w && o.rect.x < w + p.x && p.y < o.target.h + o.pos.y && o.pos.y < h + p.y) return true;
    }
    return false;
  }

  // The offset of the balloon centre on the ellipse at angle a, pushed out by
  // the tail m (FUN_0071f830, then the tail of FUN_0071f0c0).
  private candidateAt(a: number, m: number): [number, number] {
    const o = offsetFromAngle(a, this.target.w, this.target.h);
    const t = Math.atan2(o[1], o[0]);
    return [o[0] + Math.cos(t) * m, o[1] + Math.sin(t) * m];
  }

  // FUN_0071f0c0: the balloon on the ellipse around the head, pushed out by
  // 1000 / distance, at the angle of the reference offset ref. When the spot
  // overlaps another balloon: retry A lerps toward the reference by rand/32768;
  // retry B takes the head angle - 0x4000 + rand; retry C a random angle. The
  // result is null where the exe returns 0 (no placement this frame).
  private targetPlace(head: BubbleHead, ref: { x: number; y: number }, env: BubbleEnv): { x: number; y: number } | null {
    const m = B.tailNear / Math.max(1, head.dist);
    const dx = this.size.w * 0.5 - head.x + ref.x;
    const dy = this.size.h * 0.5 - head.y + ref.y;
    const len = Math.hypot(dx, dy);
    let a = B.defaultAngle;
    if (len >= 3) {
      const a0 = bams(toBams(dy, dx));
      const fx = (dx - Math.cos(a0) * m) / (20 + this.size.w);
      const fy = (dy - Math.sin(a0) * m) / (10 + this.size.h);
      a = toBams(fy, fx);
    }
    const base = offsetFromAngle(a, this.target.w, this.target.h);
    const headAng = toBams(base[1], base[0]);
    const tailed = this.candidateAt(a, m);
    if (Math.abs(len - Math.hypot(tailed[0], tailed[1])) < B.moveMin) return null;
    const at = (o: [number, number]) => ({ x: o[0] + head.x - this.target.w * 0.5, y: o[1] + head.y - this.target.h * 0.5 });
    const c0 = at(tailed);
    if (!this.inBounds(c0)) return null;
    if (!this.overlaps(c0, env)) return c0;
    const r = env.rand() / 32768;
    const c1 = at([tailed[0] + (dx - tailed[0]) * r, tailed[1] + (dy - tailed[1]) * r]);
    if (!this.overlaps(c1, env)) return c1;
    const c2 = at(this.candidateAt(Math.round(headAng - 0x4000 + env.rand()), m));
    if (!this.inBounds(c2)) return null;
    if (!this.overlaps(c2, env)) return c2;
    const c3 = at(this.candidateAt(Math.round((env.rand() / 32768) * 0x10000), m));
    if (!this.inBounds(c3)) return null;
    if (this.overlaps(c3, env)) return null;
    return c3;
  }

  // The docked balloon: its centre on the dock point of its slot, clamped
  // (UIElementMover_UpdatePosition's docked branch, 0x00970538 = -0.5).
  private dockAt(env: BubbleEnv): void {
    if (!this.docked) {
      this.docked = true;
      this.slot = nearestDockSlot(env.dock, this.rect.x + this.size.w * 0.5, this.rect.y + this.size.h * 0.5);
    }
    const p = dockPoint(this.slot);
    this.pos = this.clampBounds({ x: p.x - this.target.w * 0.5, y: p.y - this.target.h * 0.5 });
  }

  // LockSlot (FUN_00717c78): the slot is free again.
  undock(dock: DockState): void {
    if (!this.docked) return;
    dock.taken &= ~(0x40 << this.slot);
    this.docked = false;
    this.slot = -1;
  }

  // FUN_0071fbac: smooth the centre, lerp the size, clamp to the screen.
  private animate(): void {
    const tx = this.pos.x + this.target.w * 0.5;
    const ty = this.pos.y + this.target.h * 0.5;
    const sx = (tx - this.centre.x) * B.follow;
    const sy = (ty - this.centre.y) * B.follow;
    this.centre.x = Math.abs(sx) >= B.followEps ? this.centre.x + sx : tx;
    this.centre.y = Math.abs(sy) >= B.followEps ? this.centre.y + sy : ty;
    if (this.sizeLeft > 0) {
      this.size.w += (this.target.w - this.size.w) / this.sizeLeft;
      this.size.h += (this.target.h - this.size.h) / this.sizeLeft;
      this.sizeLeft--;
    } else this.size = { ...this.target };
    let x = this.centre.x - this.size.w * 0.5;
    let y = this.centre.y - this.size.h * 0.5;
    x = Math.min(Math.max(x, B.bounds.left), ChatBubble.screenW + B.bounds.right - this.size.w * this.scale);
    y = Math.min(Math.max(y, B.bounds.top), ChatBubble.screenH + B.bounds.bottom - this.size.h * this.scale);
    this.rect = { x, y };
    this.centre = { x: x + this.size.w * 0.5, y: y + this.size.h * 0.5 };
  }

  draw(ctx: CanvasRenderingContext2D, tex: BubbleTextures): void {
    if (this.scale <= 0 || !this.size.w) return;
    const s = this.scale;
    const cx = this.centre.x;
    const cy = this.centre.y;
    // Black copy, then the balloon in the player's color (FUN_0071e084).
    const black = tinted(tex.body, 0x000000);
    const body = tinted(tex.body, this.color);
    ctx.save();
    ctx.translate(cx + B.shadow[0] * s, cy + B.shadow[1] * s);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    this.drawBody(ctx, black);
    ctx.restore();
    if (this.tailOn) this.drawTail(ctx, '#000000', B.shadow[0] * s, B.shadow[1] * s);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    this.drawBody(ctx, body);
    ctx.restore();
    if (this.tailOn) this.drawTail(ctx, rgb(this.color), 0, 0);
    if (!this.textShown) return;
    if (this.symbol) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
      drawSymbolParts(ctx, this.symbol, tex.symbol, cx, cy, symbolTint);
      ctx.restore();
    } else {
      const tx = this.rect.x + 10;
      const ty = this.rect.y + 10;
      this.lines.forEach((l, i) => drawGameText(ctx, l, tx, ty + i * GAME_TEXT.lineHeight, '#000000'));
    }
    this.drawNameTab(ctx, tex.tab);
  }

  // FUN_0071ff10 / FUN_00720308: rounded slanted block from the 96 x 96 white
  // shape at (98, 0) of hyouji texture 1. Corner radius r = min(h / 2, 32)
  // vertically and min(W / 2, 32) horizontally, W = w + 0.342 h; each row
  // band is a parallelogram whose bottom edge sits 0.342 * band height to the
  // left (FUN_0082bb74: P0, P0 + A, P0 + A + B, P0 + B).
  private drawBody(ctx: CanvasRenderingContext2D, img: CanvasImageSource): void {
    const { x, y } = this.rect;
    const { w, h } = this.size;
    const W = w + h * B.slant;
    const r = Math.min(h * 0.5, 32);
    const r1 = Math.min(W * 0.5, 32);
    const band = (by: number, bh: number, v0: number, vh: number, x0: number) => {
      const skew = -bh * B.slant;
      piece(ctx, img, x0, by, r1, skew, bh, 98, v0, r1, vh);
      piece(ctx, img, x0 + W - r1, by, r1, skew, bh, 194 - r1, v0, r1, vh);
      if (W - 64 >= 0) piece(ctx, img, x0 + 32, by, W - 64, skew, bh, 130, v0, r1, vh);
    };
    band(y, r, 0, r, x); // top
    if (h - 64 >= 0) band(y + 32, h - 64, 32, r, x - 32 * B.slant); // middle (0x00970418 = 10.944)
    band(y + h - r, r, 96 - r, r, x - (h - r) * B.slant); // bottom
  }

  // FUN_00720444: triangle from the balloon centre to the speaker's head.
  private drawTail(ctx: CanvasRenderingContext2D, color: string, ox: number, oy: number): void {
    const a = Math.atan2(this.centre.y - this.head.y, this.centre.x - this.head.x);
    const m = B.tailNear / Math.max(1, this.head.dist);
    const tipX = this.head.x + Math.cos(a) * m + ox;
    const tipY = this.head.y + Math.sin(a) * m + oy;
    const k = B.tailHalf * this.scale;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(this.centre.x + ox + Math.cos(a + Math.PI / 2) * k, this.centre.y + oy + Math.sin(a + Math.PI / 2) * k);
    ctx.lineTo(this.centre.x + ox + Math.cos(a - Math.PI / 2) * k, this.centre.y + oy + Math.sin(a - Math.PI / 2) * k);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // FUN_0072062c: name tab above the balloon's top-left corner, in the
  // balloon color, black name; fades in over 6 frames.
  private drawNameTab(ctx: CanvasRenderingContext2D, tabTex: CanvasImageSource): void {
    if (!this.name) return;
    const t = B.tab;
    const alpha = Math.min(1, this.openFrames / B.tabFade);
    const tw = gameTextWidth(this.name);
    const x = this.rect.x + t.dx;
    const y = this.rect.y + t.dy;
    const img = tinted(tabTex, this.color);
    ctx.save();
    ctx.globalAlpha = alpha;
    // Texels: left cap 145..161, middle 161..177, right cap 177..193, v 237..256.
    ctx.drawImage(img, 145, 237, 16, 19, x, y, t.cap, t.h);
    // Right cap at x - 4 + text width (0x009703ac) once the name is 20 px or
    // wider (0x009703b0), the middle stretched in between.
    const rightX = tw >= t.minText ? x - 4 + tw : x + t.cap;
    if (tw > t.minText) ctx.drawImage(img, 161, 237, 16, 19, x + t.cap, y, rightX - (x + t.cap), t.h);
    ctx.drawImage(img, 177, 237, 16, 19, rightX, y, t.cap, t.h);
    ctx.restore();
    let nx = x + t.textDx;
    if (tw < t.minText) nx += (t.minText - tw) * 0.5;
    drawGameText(ctx, this.name, nx, y + t.textDy, '#000000', alpha);
  }
}

// Texture region (u, v, uw, vh) mapped onto the parallelogram
// P0 = (x, y), A = (w, 0), B = (skew, h).
function piece(ctx: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, skew: number, h: number, u: number, v: number, uw: number, vh: number): void {
  if (w <= 0 || h <= 0 || uw <= 0 || vh <= 0) return;
  ctx.save();
  ctx.transform(w / uw, 0, skew / vh, h / vh, x, y);
  ctx.drawImage(img, u, v, uw, vh, 0, 0, uw, vh);
  ctx.restore();
}

const rgb = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

// Vertex color x texture (the client modulates the white texture by the
// balloon color). Cached per image and color.
const tintCache = new WeakMap<object, Map<number, OffscreenCanvas>>();
function tinted(img: CanvasImageSource, color: number): CanvasImageSource {
  let m = tintCache.get(img as object);
  if (!m) tintCache.set(img as object, (m = new Map()));
  let c = m.get(color);
  if (c) return c;
  const w = (img as { width: number }).width;
  const h = (img as { height: number }).height;
  c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = rgb(color);
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  m.set(color, c);
  return c;
}

// Up to four balloons (UI table + 0x90..0x9c); one per speaker; when all are
// taken the one farthest from the local player is replaced (FUN_00718b74).
// The list holds the balloons' shared state: the dock slots (table + 0x1c)
// and the rand() of the placement retries.
const soloEnv: BubbleEnv = { peers: [], dock: { taken: 0 }, rand: () => Math.floor(Math.random() * 32768) };

export class ChatBubbles {
  list: ChatBubble[] = [];
  readonly dock: DockState = { taken: 0 };
  // C rand(): 0..32767 (FUN_0071f0c0 retries). Tests may replace it.
  rand: () => number = () => Math.floor(Math.random() * 32768);

  // The balloon of a speaker: the one open for it, else a new one (the farthest is replaced when all four are taken).
  private balloonFor(clientId: number, name: string, distanceTo: (id: number) => number): ChatBubble {
    let b = this.list.find((x) => x.clientId === clientId && x.alive);
    if (!b) {
      if (this.list.length >= B.maxBubbles) {
        let far = 0;
        this.list.forEach((x, i) => {
          if (distanceTo(x.clientId) >= distanceTo(this.list[far].clientId)) far = i;
        });
        this.list[far].undock(this.dock);
        this.list.splice(far, 1);
      }
      b = new ChatBubble(clientId, name);
      this.list.push(b);
    }
    return b;
  }

  say(clientId: number, name: string, text: string, distanceTo: (id: number) => number): void {
    this.balloonFor(clientId, name, distanceTo).say(text);
  }

  // A symbol chat (6x07, or the sender's own): the balloon shows the picture and
  // the speaker's directional sound plays (ChatBubbleEntity_RenderChatParts_00720b34).
  saySymbol(clientId: number, name: string, chat: SymbolChat, distanceTo: (id: number) => number): void {
    this.balloonFor(clientId, name, distanceTo).sayParts(chat);
    const snd = symbolSoundId(chat.spec);
    if (snd !== null) se(snd);
  }

  // One game frame; head(id) gives the projected head point.
  tick(head: (id: number) => BubbleHead | null): void {
    for (const b of this.list) if (!b.alive) b.undock(this.dock);
    this.list = this.list.filter((b) => b.alive);
    const env: BubbleEnv = { peers: this.list, dock: this.dock, rand: this.rand };
    for (const b of this.list) {
      const h = head(b.clientId);
      if (h) b.tick(h, env);
      else b.state = 9;
    }
  }

  draw(ctx: CanvasRenderingContext2D, tex: BubbleTextures): void {
    for (const b of this.list) b.draw(ctx, tex);
  }
}

// The dock points of the slots: get_gui_position(0x45 + slot) (table
// 0x00971f40, 0x00972168..0x00972188), the balloon's centre. Slot 3 is the
// fallback when the first three are taken. In the 640 x 480 window space.
const DOCK_POINTS: readonly (readonly [number, number])[] = [
  [320, 140],
  [140, 300],
  [500, 300],
  [320, 240],
];

function dockPoint(slot: number): { x: number; y: number } {
  const [x, y] = DOCK_POINTS[slot];
  return { x: (x * ChatBubble.screenW) / 640, y: (y * ChatBubble.screenH) / 480 };
}

// QuickMenuObject_FindNearestInteractiveElement (FUN_00717aec): the nearest
// free slot of the first three (bits 0x40 << slot), else slot 3. Marks it taken.
function nearestDockSlot(dock: DockState, cx: number, cy: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < 3; i++) {
    if (dock.taken & (0x40 << i)) continue;
    const p = dockPoint(i);
    const d = (cx - p.x) ** 2 + (cy - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best === -1) best = 3;
  dock.taken |= 0x40 << best;
  return best;
}

// Head point of a player in window space: the model position plus its height
// (FUN_00716204: model bound * 0.92, 0x0096fe90), projected with the camera.
// `vh`: the frame's height (480, or the tall fill's virtual height). `front`:
// the point is in front of the camera (the exe's dot test, FUN_0071e70c).
export function projectHead(cam: THREE.Camera, pos: THREE.Vector3, height: number, width: number, vh = 480): BubbleHead {
  const p = pos.clone().add(new THREE.Vector3(0, height, 0));
  const dist = p.distanceTo(cam.position);
  const v = p.clone().project(cam);
  const visible = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
  const fwd = cam.getWorldDirection(new THREE.Vector3());
  const front = p.clone().sub(cam.position).dot(fwd) > 0;
  return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * vh, dist, visible, front };
}

export const SE_CHAT = 0x574; // FUN_00720940

// The chat line of the lobby and of the field (classic/lobby.ts, classic/field.ts):
// the input line, the log and the balloons. The screen forwards its keys to
// key() while `open`, and draws the input and the balloons in its own space.
// unknown_write_chat_message_to_logs: a log line and, for a player the client
// knows, a balloon over the speaker (flags 0xcb) and the chat sound.
export class ChatLine {
  readonly log = new ChatLog();
  readonly input = new ChatInput();
  readonly bubbles = new ChatBubbles();
  private readonly send: (text: string) => void;

  // send: the text Enter sends (the chat packet 06 of the lobby or the game).
  constructor(send: (text: string) => void) {
    this.send = send;
  }

  get open(): boolean {
    return this.input.open;
  }

  // Space (begin_chat_input) opens the line.
  begin(): void {
    this.input.begin();
  }

  key(e: KeyboardEvent): void {
    e.preventDefault();
    const text = this.input.key(e);
    if (text) this.send(text);
  }

  // A line from the server; `from` is null when the speaker is not a known player.
  receive(from: { clientId: number; name: string } | null, gc: number, text: string, distanceTo: (id: number) => number): void {
    this.log.add(from?.name || `#${gc}`, text);
    if (!from) return;
    se(SE_CHAT);
    this.bubbles.say(from.clientId, from.name, text, distanceTo);
  }

  // A symbol chat from a player (6x07). No log line: action_symbol_chat (dump 754836) writes none.
  receiveSymbol(clientId: number, name: string, chat: SymbolChat, distanceTo: (id: number) => number): void {
    this.bubbles.saySymbol(clientId, name, chat, distanceTo);
  }
}

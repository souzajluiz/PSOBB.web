// The quest and NPC text windows, drawn the way PsoBB.exe draws them, on a 2D
// canvas laid over the game's 3D canvas (640x480 virtual space scaled by the
// height, like the other in-game windows; classic/ingame.ts).
//
//   speech balloons  `message` and NPC talk: DisplayChatBubble_007184f8 with
//                    flags 0x2d (opcode_message .c:604178): the lobby's word
//                    balloon (classic/chat.ts) over the speaker's head, white
//                    (an NPC has no balloon color), no name tab (the name is
//                    only looked up for players, FUN_00716204), no wrap at 200
//                    (flag 4: only the text's own line breaks), and it stays
//                    until the script moves on instead of timing out;
//   window           `window_msg`: CreateChatShortcutMenuYesNoListWindow_0073c9cc
//                    at GUI position 0xbe = (88, 120) (0x00971f40 + 8 * 0xbe),
//                    384 x 80 (0x00971d18), text 10 px inside;
//   list             `list` (opcode_list .c:603982): one item per line at GUI
//                    position 0x39 = (106, 120), sized to the widest item
//                    (FUN_0073608c, as the warp menus), the selection bar of
//                    stage.ts;
//   quest board      `disp_msg_qb`: a text window at GUI position 0x74 =
//                    (39, 340) (opcode_disp_msg_qb .c:604116), sized to its
//                    text here (the exe's width is not recovered); add_msg
//                    adds a line; the thread waits for Enter meanwhile
//                    (disp_msg_qb__add_msg) but the player is not locked. It
//                    is mostly shown over the Quest Board window of the main
//                    menu (classic/questboard.ts), which forwards Enter itself;
//   yes / no         the counters' confirmation (yes_no_list_constructor at GUI
//                    position 0x2d = (266, 270), " Yes " / " No " from
//                    unitxt_shop group 0);
//   clerk window     the counters' lines (Hunter's Guild, shops, bank): the
//                    ShopDialogBase window at GUI position 0x2e = (294, 365),
//                    332 x 80 (immediates in MedicalCenterDialog_ProcessState_006ce004
//                    and 0x006d6a78, 0x006dc794 -> 0x0073c7e8).
//
// Enter (the action button) moves a waiting balloon, window or quest board text
// on; arrows and Enter drive lists, Escape / Backspace cancel them.
//
// The canvas is above the field HUD's (classic/hud.ts QUEST_LAYER): the quest's
// windows are created after the HUD, the main menu and its Quest Board window.

import * as THREE from 'three';
import { ChatBubble, projectHead, wrapGameText } from '../classic/chat.ts';
import { drawGameText, gameTextWidth, GAME_TEXT } from '../classic/gametext.ts';
import { QUEST_LAYER } from '../classic/hud.ts';
import { anchorX } from '../classic/ingame.ts';
import { drawSelectBar, drawWindowFrame, textureBitmaps, VH, VW, type WindowSkin } from '../classic/stage.ts';
import type { ClientFiles } from '../data/clientfiles.ts';

export const QUEST_WINDOW = { x: 88, y: 120, w: 384, h: 80 }; // GUI 0xbe, 0x00971d18
export const QUEST_LIST_POS = [106, 120] as const; // GUI 0x39
export const QUEST_BOARD_POS = [39, 340] as const; // GUI 0x74
export const YES_NO_POS = [266, 270] as const; // GUI 0x2d
export const CLERK_WINDOW = { x: 294, y: 365, w: 332, h: 80 }; // GUI 0x2e
const LINE = 14;
const ITEM_STEP = 20;
const GAP = 6;
const BORDER = 20;

// Color escapes the text renderer understands (\tC0..\tC9, \tCG..): drawn in
// white here; the palette is not recovered.
export function plainText(s: string): string {
  return s.replace(/\t[CEJ][0-9A-Za-z]?/g, '').replace(/<color \d+>/gi, '');
}

interface Balloon {
  key: number;
  bubble: ChatBubble;
  waiting: boolean;
}

interface ListState {
  items: string[];
  cursor: number;
  x: number;
  y: number;
  title?: string; // a text line above the items
  resolve: (i: number | null) => void;
  cancellable: boolean;
}

export class QuestUi {
  private host: HTMLCanvasElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private skin: WindowSkin | null = null;
  private body: CanvasImageSource | null = null;
  private balloons: Balloon[] = [];
  private window: { text: string; waiting: boolean; rect: { x: number; y: number; w: number; h: number } } | null = null;
  private board: { lines: string[]; waiting: boolean } | null = null;
  private lists: ListState[] = [];
  private raf = 0;
  private last = 0;
  private acc = 0;
  private onKey = (e: KeyboardEvent) => this.key(e);
  // The world point of a speaker's head (an NPC by its talk action >= 100, a
  // player by client id), or null when it is not on this floor.
  speakerHead: (target: number) => THREE.Vector3 | null = () => null;
  camera: () => THREE.Camera | null = () => null;
  // Enter moved a waiting balloon, window or quest board text on.
  onAdvance: () => void = () => {};
  // Enter while nothing waits (the caller looks for an NPC to talk to).
  onAction: () => boolean = () => false;
  // Once per 30 Hz game tick (quest/town.ts runs the area script on it).
  onTick: () => void = () => {};

  constructor(host: HTMLCanvasElement) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'quest-ui-overlay';
    Object.assign(this.canvas.style, { position: 'absolute', pointerEvents: 'none', zIndex: String(QUEST_LAYER) });
    host.parentElement?.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    host.addEventListener('keydown', this.onKey, true);
    const loop = (t: number) => {
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  async load(files: ClientFiles): Promise<void> {
    if (this.skin) return;
    const hyouji = await textureBitmaps(await files.textures('f256_hyouji.prs'));
    this.skin = { frame: hyouji[1], bars: hyouji[2] };
    this.body = hyouji[1];
  }

  // A balloon, window or list waits for the player (the player cannot move:
  // the talk locks the controls, UIState_SetLockedState_00717d68).
  get blocking(): boolean {
    return this.balloons.some((b) => b.waiting) || !!this.window?.waiting || this.lists.length > 0;
  }

  // --- speech balloons -------------------------------------------------------

  say(target: number, text: string, waiting = true): void {
    let b = this.balloons.find((x) => x.key === target && x.bubble.alive);
    if (!b) {
      // No name, white (FUN_00720d94 returns the default color past the
      // player ids).
      b = { key: target, bubble: new ChatBubble(1000 + target, ''), waiting };
      this.balloons.push(b);
    }
    b.waiting = waiting;
    b.bubble.say(plainText(text), Number.POSITIVE_INFINITY);
    // Stays until message_end (the script decides, not the timer).
    b.bubble.life = Number.POSITIVE_INFINITY;
  }

  closeBalloon(target?: number): void {
    for (const b of this.balloons) {
      if (target === undefined || b.key === target) {
        b.waiting = false;
        b.bubble.life = 0;
      }
    }
  }

  // --- window ------------------------------------------------------------------

  showWindow(text: string, waiting = true, rect = QUEST_WINDOW): void {
    this.window = { text: plainText(text), waiting, rect };
  }

  closeWindow(): void {
    this.window = null;
  }

  // --- quest board ---------------------------------------------------------------

  // disp_msg_qb (a new text) / add_msg (one more line); both wait for Enter.
  showBoard(text: string, append = false): void {
    const lines = plainText(text).split('\n');
    this.board = { lines: append && this.board ? [...this.board.lines, ...lines] : lines, waiting: true };
  }

  // Enter reached the quest board text some other way (the Quest Board
  // window holds the keys while the menu is open).
  boardAdvanced(): void {
    if (this.board) this.board.waiting = false;
  }

  closeBoard(): void {
    this.board = null;
  }

  // --- lists ---------------------------------------------------------------------

  // Resolves with the chosen index, or null when cancelled.
  list(items: string[], opts: { x?: number; y?: number; title?: string; cancellable?: boolean; cursor?: number } = {}): Promise<number | null> {
    return new Promise((resolve) => {
      this.lists.push({
        items: items.map(plainText),
        cursor: Math.min(Math.max(0, opts.cursor ?? 0), Math.max(0, items.length - 1)),
        x: opts.x ?? QUEST_LIST_POS[0],
        y: opts.y ?? QUEST_LIST_POS[1],
        title: opts.title === undefined ? undefined : plainText(opts.title),
        resolve,
        cancellable: opts.cancellable ?? true,
      });
    });
  }

  async yesNo(yes = ' Yes ', no = ' No ', cursor = 0): Promise<boolean> {
    return (await this.list([yes, no], { x: YES_NO_POS[0], y: YES_NO_POS[1], cursor, cancellable: true })) === 0;
  }

  // A window message the caller waits on (counters): resolves on Enter.
  async tell(text: string, rect = CLERK_WINDOW): Promise<void> {
    await new Promise<void>((resolve) => {
      this.showWindow(text, true, rect);
      this.pendingTell = resolve;
    });
    this.closeWindow();
  }
  private pendingTell: (() => void) | null = null;

  // --- input ---------------------------------------------------------------------

  private key(e: KeyboardEvent): void {
    if (e.defaultPrevented) return; // a warp menu took it
    const list = this.lists[this.lists.length - 1];
    let used = true;
    if (list) {
      const n = list.items.length;
      if (e.key === 'ArrowUp' && n) list.cursor = (list.cursor + n - 1) % n;
      else if (e.key === 'ArrowDown' && n) list.cursor = (list.cursor + 1) % n;
      else if (e.key === 'Enter' && !e.repeat) {
        this.lists.pop();
        list.resolve(n ? list.cursor : null);
      } else if ((e.key === 'Escape' || e.key === 'Backspace') && list.cancellable) {
        this.lists.pop();
        list.resolve(null);
      } else used = false;
    } else if (e.key === 'Enter' && !e.repeat) {
      if (this.pendingTell) {
        const r = this.pendingTell;
        this.pendingTell = null;
        r();
      } else if (this.window?.waiting || this.balloons.some((b) => b.waiting) || this.board?.waiting) {
        if (this.window) this.window.waiting = false;
        for (const b of this.balloons) b.waiting = false;
        this.boardAdvanced();
        this.onAdvance();
      } else used = this.onAction();
    } else used = false;
    if (!used) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // --- drawing -------------------------------------------------------------------

  private frame(t: number): void {
    const dt = this.last ? Math.min(0.25, (t - this.last) / 1000) : 0;
    this.last = t;
    this.acc += dt * 30;
    const ticks = Math.min(Math.floor(this.acc), 30);
    this.acc -= Math.floor(this.acc);
    for (let i = 0; i < ticks; i++) this.onTick();
    const host = this.host;
    const w = host.clientWidth;
    const h = host.clientHeight;
    const dpr = Math.min(devicePixelRatio, 2);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    Object.assign(this.canvas.style, { left: `${host.offsetLeft}px`, top: `${host.offsetTop}px`, width: `${w}px`, height: `${h}px` });
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.skin || !this.canvas.height) return;
    const s = this.canvas.height / VH;
    const extra = Math.max(0, this.canvas.width / s - VW);
    ChatBubble.screenW = VW + extra;
    ctx.setTransform(s, 0, 0, s, 0, 0);

    // Balloons: one game frame per 30 Hz tick, over the projected head.
    const cam = this.camera();
    this.balloons = this.balloons.filter((b) => b.bubble.alive);
    for (const b of this.balloons) {
      const head = this.speakerHead(b.key);
      const p = cam && head ? projectHead(cam, head, 0, VW + extra) : null;
      for (let i = 0; i < ticks; i++) {
        if (p) b.bubble.tick(p);
        else b.bubble.state = 9;
      }
      if (this.body) b.bubble.draw(ctx, { body: this.body, tab: this.body });
    }

    if (this.board) this.drawText(ctx, QUEST_BOARD_POS[0], QUEST_BOARD_POS[1], this.board.lines, extra);
    if (this.window) {
      const W = this.window.rect;
      const lines = this.window.text.split('\n');
      const hh = Math.max(W.h, lines.length * GAME_TEXT.lineHeight - 6 + BORDER);
      const x = anchorX(W.x, W.w, extra);
      drawWindowFrame(ctx, this.skin.frame, x, W.y, W.w, hh);
      lines.forEach((l, i) => drawGameText(ctx, l, x + 10, W.y + 10 + i * GAME_TEXT.lineHeight, '#ffffff'));
    }
    for (const list of this.lists) this.drawList(ctx, list, extra);
  }

  private drawText(ctx: CanvasRenderingContext2D, x0: number, y: number, lines: string[], extra: number): void {
    const w = Math.max(...lines.map(gameTextWidth)) + BORDER;
    const h = lines.length * GAME_TEXT.lineHeight - GAP + BORDER;
    const x = anchorX(x0, w, extra);
    drawWindowFrame(ctx, this.skin!.frame, x, y, w, h);
    lines.forEach((l, i) => drawGameText(ctx, l, x + 10, y + 10 + i * GAME_TEXT.lineHeight, '#ffffff'));
  }

  private drawList(ctx: CanvasRenderingContext2D, list: ListState, extra: number): void {
    const titleLines = list.title ? wrapGameText(list.title, 400) : [];
    const widest = Math.max(1, ...list.items.map(gameTextWidth), ...titleLines.map(gameTextWidth));
    const w = widest + BORDER;
    const h = titleLines.length * LINE + list.items.length * (LINE + GAP) - (list.items.length ? GAP : 0) + BORDER;
    const x = anchorX(list.x, w, extra);
    drawWindowFrame(ctx, this.skin!.frame, x, list.y, w, h);
    let top = list.y + 10;
    for (const l of titleLines) {
      drawGameText(ctx, l, x + 10, top + 1, '#ffffff');
      top += LINE;
    }
    if (list.items.length) drawSelectBar(ctx, this.skin!.bars, x + 10, top + list.cursor * ITEM_STEP, w - 20, 16);
    list.items.forEach((it, i) => {
      drawGameText(ctx, it, x + (w - gameTextWidth(it)) / 2, top + i * ITEM_STEP + 1, i === list.cursor ? '#ffc19a' : '#ffffff');
    });
  }

  clear(): void {
    this.balloons = [];
    this.window = null;
    this.board = null;
    for (const l of this.lists) l.resolve(null);
    this.lists = [];
    const r = this.pendingTell;
    this.pendingTell = null;
    r?.();
  }

  dispose(): void {
    this.clear();
    cancelAnimationFrame(this.raf);
    this.host.removeEventListener('keydown', this.onKey, true);
    this.canvas.remove();
  }
}

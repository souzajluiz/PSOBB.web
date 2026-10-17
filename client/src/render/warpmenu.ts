// Warp menus of the field, decoded from PsoBB.exe (Ephinea 1.25.13), drawn as
// a 2D overlay over the game view with the classic window renderer.
//
// Warp objects share a base class (ctor FUN_0066982c, vtable 0x00b350e0;
// update FUN_006698e0): while the local player is within the object's radius
// (FUN_00669a58, 3D distance) the object opens its menu (vtable +0x34),
// polls it (+0x40) and on Decide warps (+0x44, FUN_00669650). Cancel closes
// the menu and keeps it closed until the player has left the radius
// (+0xbc). The menus:
//   - area warps and boss warps (FUN_00669410): one item, the destination
//     area's name (FUN_0079313c = unitxt group 10, index table 0x0097c660),
//     window at position-table entry 0x35 = (267, 130), sized to the text
//     (FUN_0073608c: width = text + 20, height = 14 + 20);
//   - the Ragol teleporter TObjCityMainWarp (FUN_00649cec): one item per
//     available destination, window at entry 0x34 = (176, 130), 288 wide
//     (FUN_00736138), height = items * 20 - 6 + 20, at most 160 (FUN_007361d0
//     then scrolls); the items are centred (FUN_00736458).

import type { ClientFiles } from '../data/clientfiles.ts';
import { anchorX } from '../classic/ingame.ts';
import { drawGameText, gameTextWidth } from '../classic/gametext.ts';
import { parseUnitxt } from '../classic/charcreate_text.ts';
import { drawSelectBar, drawWindowFrame, textureBitmaps, VH, VW, type WindowSkin } from '../classic/stage.ts';

// unitxt group 10 index of each area id (0x0097c660, 47 entries).
export const AREA_TEXT = [
  0x2d, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x2f, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
  0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2e, 0x2b,
];

// Main warp destinations: bit i of the availability mask DAT_00a8f4fc means
// "floor table[i]" with the name unitxt(10, text[i]).
//   Episode 1: floors 0x00936260, text 0x00936300 (17 entries)
//   Episode 2: floors 0x009362a0, text 0x00936340 (17 entries)
//   Episode 4: floors 0x00936404, text 0x00936430 (10 entries)
const MAIN_WARP = {
  1: { floors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 1], text: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17] },
  2: { floors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], text: [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33] },
  3: { floors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], text: [34, 35, 36, 37, 38, 39, 40, 41, 42, 43] },
} as const;

// FUN_0064a428: the availability mask (questBits = DAT_00a8f500, set by
// quests; 0 in free play). `warpType` is the object's param5 clamped to 0..2
// (ctor FUN_0064a8dc; Episode 2 only: 0 all, 1 VR, 2 Central Control Area).
// On this client every destination is open by default: the quest-flag checks
// (FUN_0064a650) only OR in bits that the base mask already has, and
// FUN_006dc358 (checked for Episode 4) always returns 0.
export function mainWarpMask(episode: number, warpType = 0, questBits = 0): number {
  if (episode === 1) return (questBits | 0xa5) & 0xfffe03ff;
  if (episode === 2) {
    let m = questBits | 0x215;
    if (warpType === 1) m &= 0xfffe780f;
    else if (warpType === 2) m &= 0xfffe7ff0;
    return m & 0xffff87ff;
  }
  if (episode === 3) return (questBits | 0x01 | 0x3e) & 0xfffffcff;
  return questBits;
}

export interface WarpMenuItem {
  floor: number;
  text: number; // unitxt group 10 index
}

// Menu items in order (FUN_00649cec: bit 0 upward).
export function mainWarpItems(episode: number, warpType = 0, questBits = 0): WarpMenuItem[] {
  const t = MAIN_WARP[episode as 1 | 2 | 3];
  if (!t) return [];
  const mask = mainWarpMask(episode, warpType, questBits);
  const out: WarpMenuItem[] = [];
  for (let bit = 0; bit < t.floors.length; bit++) if (mask & (1 << bit)) out.push({ floor: t.floors[bit], text: t.text[bit] });
  return out;
}

// Window layout in the 640x480 space.
export interface WarpMenuLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAIN_POS = [176, 130] as const; // position table 0x00971f40, entry 0x34
const AREA_POS = [267, 130] as const; // entry 0x35
const MAIN_WIDTH = 288; // FUN_00649cec -> FUN_00736138(288.0)
const MAX_HEIGHT = 160; // _DAT_0093642c
const ITEM_STEP = 20; // FUN_00735c90: item y = index * 0x14
const LINE = 14; // one text line (item +0x14)
const GAP = 6; // 0x00971414
const BORDER = 20; // 0x0097140c / 0x0097141c: 10 px on each side

export function mainWarpLayout(count: number): WarpMenuLayout {
  const content = count * (LINE + GAP) - GAP;
  return { x: MAIN_POS[0], y: MAIN_POS[1], w: MAIN_WIDTH, h: Math.min(MAX_HEIGHT, content + BORDER) };
}

export function areaWarpLayout(textWidth: number): WarpMenuLayout {
  return { x: AREA_POS[0], y: AREA_POS[1], w: textWidth + BORDER, h: LINE + BORDER };
}

export interface WarpMenuChoice {
  label: string;
  floor: number;
}

// Extra windows the boss warp draws next to the menu (render/bosswarp.ts):
// the question or notice above the items, and the list of the players at the
// warp in its own window.
export interface WarpMenuExtra {
  message?: string; // may hold newlines
  panel?: { layout: WarpMenuLayout; rows: Array<{ label: string; color: string }> };
}

// Window that holds `lines` text lines and `items` selectable items.
export function textWindowLayout(x: number, y: number, w: number, lines: number, items: number): WarpMenuLayout {
  return { x, y, w, h: lines * LINE + items * ITEM_STEP + BORDER };
}

// The open menu, drawn on a 2D canvas laid over the 3D canvas.
export class WarpMenuOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private host: HTMLCanvasElement;
  private skin: WindowSkin | null = null;
  private text: string[] | null = null;
  private groups: string[][] | null = null;
  private items: WarpMenuChoice[] = [];
  private layout: WarpMenuLayout | null = null;
  private extra: WarpMenuExtra = {};
  private cursor = 0;
  private resolve: ((floor: number | null) => void) | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private raf = 0;

  constructor(host: HTMLCanvasElement) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'warp-menu-overlay';
    Object.assign(this.canvas.style, { position: 'absolute', pointerEvents: 'none', display: 'none' });
    host.parentElement?.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    host.addEventListener('keydown', this.onKey, true);
  }

  async load(files: ClientFiles): Promise<void> {
    if (!this.skin) {
      const hyouji = await textureBitmaps(await files.textures('f256_hyouji.prs'));
      this.skin = { frame: hyouji[1], bars: hyouji[2] };
    }
    if (!this.text) {
      // Ephinea's loose unitxt_j.prs carries the English names of all three
      // episodes (data.gsl's unitxt_e.prs has empty Episode 4 entries).
      const { data } = await files.readFirst(['unitxt_j.prs', 'unitxt_e.prs']);
      this.groups = parseUnitxt(data);
      this.text = this.groups[10] ?? [];
    }
  }

  // Any unitxt group (the boss warp uses group 11 for its windows and group
  // 15 for "Yes" / "No").
  string(group: number, index: number): string {
    return (this.groups?.[group]?.[index] ?? `#${group}:${index}`).replace(/\t[CEJ][0-9A-Za-z]?/g, '');
  }

  get open(): boolean {
    return this.resolve !== null;
  }

  areaName(area: number): string {
    return this.text?.[AREA_TEXT[area] ?? -1] ?? `area ${area}`;
  }

  label(textIndex: number): string {
    return this.text?.[textIndex] ?? `#${textIndex}`;
  }

  // Replaces the extra windows of the open menu (the boss warp refreshes the
  // player list every frame).
  update(extra: WarpMenuExtra): void {
    if (this.open) this.extra = extra;
  }

  // Shows the menu; resolves with the chosen floor, or null on cancel/close.
  // `cursor` is the item selected first (the boss warp's Yes/No starts on No,
  // ListWindowObject_SetSelectedIndex_0073d148(.., 1)).
  show(items: WarpMenuChoice[], layout: WarpMenuLayout, extra: WarpMenuExtra = {}, cursor = 0): Promise<number | null> {
    this.close();
    this.items = items;
    this.layout = layout;
    this.extra = extra;
    this.cursor = Math.min(Math.max(0, cursor), Math.max(0, items.length - 1));
    this.canvas.style.display = '';
    const p = new Promise<number | null>((res) => (this.resolve = res));
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
    return p;
  }

  close(choice: number | null = null): void {
    cancelAnimationFrame(this.raf);
    this.canvas.style.display = 'none';
    const r = this.resolve;
    this.resolve = null;
    r?.(choice);
  }

  // Default keyboard config (classic/lobby.ts): arrows select, Enter decides,
  // Backspace cancels.
  private key(e: KeyboardEvent): void {
    if (!this.open) return;
    const n = this.items.length;
    if (e.key === 'ArrowUp' && n) this.cursor = (this.cursor + n - 1) % n;
    else if (e.key === 'ArrowDown' && n) this.cursor = (this.cursor + 1) % n;
    else if (e.key === 'Enter' && n) this.close(this.items[this.cursor]?.floor ?? null);
    else if (e.key === 'Backspace' || e.key === 'Escape') this.close(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private draw(): void {
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
    const L = this.layout;
    if (!L || !this.skin) return;
    if (!this.items.length && !this.extra.message) {
      // Only the side windows (the boss warp's notice while nothing is asked).
      const s0 = this.canvas.height / VH;
      const e0 = Math.max(0, this.canvas.width / s0 - VW);
      ctx.setTransform(s0, 0, 0, s0, 0, 0);
      this.drawPanel(ctx, e0);
      return;
    }
    // Uniform scale by height; windows on the right half follow the right edge
    // (classic/ingame.ts inGameSpace / anchorX).
    const s = this.canvas.height / VH;
    const extra = Math.max(0, this.canvas.width / s - VW);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const x = anchorX(L.x, L.w, extra);
    drawWindowFrame(ctx, this.skin.frame, x, L.y, L.w, L.h);
    let top = L.y + 10;
    if (this.extra.message) {
      for (const line of this.extra.message.split('\n')) {
        drawGameText(ctx, line, x + 10, top + 1, '#ffffff');
        top += LINE;
      }
    }
    const room = L.h - (top - L.y) - 10 + GAP;
    const visible = Math.max(1, Math.floor(room / ITEM_STEP));
    const first = Math.min(Math.max(0, this.cursor - visible + 1), Math.max(0, this.items.length - visible));
    if (this.items.length) drawSelectBar(ctx, this.skin.bars, x + 10, top + (this.cursor - first) * ITEM_STEP, L.w - 20, 16);
    this.items.slice(first, first + visible).forEach((it, i) => {
      const tw = gameTextWidth(it.label);
      drawGameText(ctx, it.label, x + (L.w - tw) / 2, top + i * ITEM_STEP + 1, first + i === this.cursor ? '#ffc19a' : '#ffffff');
    });
    this.drawPanel(ctx, extra);
  }

  private drawPanel(ctx: CanvasRenderingContext2D, extra: number): void {
    const p = this.extra.panel;
    if (!p || !this.skin) return;
    const x = anchorX(p.layout.x, p.layout.w, extra);
    drawWindowFrame(ctx, this.skin.frame, x, p.layout.y, p.layout.w, p.layout.h);
    p.rows.forEach((r, i) => drawGameText(ctx, r.label, x + 10, p.layout.y + 11 + i * ITEM_STEP, r.color));
  }

  dispose(): void {
    this.close();
    this.host.removeEventListener('keydown', this.onKey, true);
    this.canvas.remove();
  }
}

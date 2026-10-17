// 2D windows drawn over the 3D view once the game server is reached (ship
// select, lobby). They use the generic window renderer of stage.ts; the
// positions come from PsoBB.exe's window position table at 0x00971f40
// (FUN_0073ec50(i) = &table[i], {x, y} floats).
//
// Widescreen: on psobb.io (16:10) the windows keep their size (uniform scale
// by height, like the menus) while windows on the right half move right by
// the extra width. Measured on the reference captures: "Ship Select" (x 12)
// stays at the left, the info window (x 294) lands at 294 + 128 and the lobby
// name window (right edge 622) at 622 + 128 on a 768-unit wide screen. On a
// 4:3 window both are the identity.

import { drawGameText, gameTextWidth } from './gametext.ts';
import { drawWindowFrame, VH, VW, type Stage, type WindowSkin } from './stage.ts';

// Position table entries used here (0x00971f40 + 8 * index).
export const WINDOW_POS = {
  shipMenu: [12, 50] as const, // index 0x28, FUN_0073fe9c
  shipInfo: [294, 305] as const, // index 0xd5, FUN_0079a8c4
  lobbyName: [622, 37] as const, // index 0xc0, FUN_0073f510 (right edge)
};

// Runs fn in the in-game window space and returns the extra width (virtual
// units beyond 640) available to right-side windows.
export function inGameSpace(ctx: CanvasRenderingContext2D, stage: Stage, fn: (extra: number) => void): void {
  const s = stage.canvas.height / VH;
  const extra = stage.canvas.width / s - VW;
  ctx.save();
  ctx.setTransform(s, 0, 0, s, 0, 0);
  fn(Math.max(0, extra));
  ctx.restore();
}

// Windows whose centre is on the right half move with the right edge.
export function anchorX(x: number, w: number, extra: number): number {
  return x + w / 2 >= VW / 2 ? x + extra : x;
}

// Text window with a typed-out message (FUN_0073a888 -> FUN_0073ae38).
// Text starts 10 px inside the frame (measured, like the menu inset of
// FUN_0071b900) and advances 20 px per line (FUN_007ab554).
export class InfoWindow {
  text = '';
  private shown = 0;
  x: number;
  y: number;
  w: number;
  h: number;
  // Characters revealed per frame: fitted (the capture shows the three-line
  // ship select message complete within about half a second).
  speed = 2;

  constructor(x: number, y: number, w: number, h: number) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  set(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.shown = 0;
  }

  tick(): void {
    this.shown = Math.min(this.text.length, this.shown + this.speed);
  }

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, extra: number): void {
    const x = anchorX(this.x, this.w, extra);
    drawWindowFrame(ctx, skin.frame, x, this.y, this.w, this.h);
    drawGameText(ctx, this.text.slice(0, this.shown), x + 10, this.y + 10);
  }
}

// Lobby name window "<ship>:<block>-<lobby>" (FUN_0079eb78 formats
// "%s:%02d-%02d", FUN_0073f510 builds the window): 160 x 27 (0x009f340c),
// right edge at table entry 0xc0, text centred.
export function drawLobbyNameWindow(ctx: CanvasRenderingContext2D, skin: WindowSkin, text: string, extra: number): void {
  const [right, y] = WINDOW_POS.lobbyName;
  const w = 160;
  const h = 27;
  const x = anchorX(right - w, w, extra);
  drawWindowFrame(ctx, skin.frame, x, y, w, h);
  drawGameText(ctx, text, x + (w - gameTextWidth(text)) / 2, y + (h - 14) / 2);
}

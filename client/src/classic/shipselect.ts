// Ship select: the server's main menu (command 07) as PsoBB.exe (Ephinea
// 1.25.13) shows it, over the 3D view.
//
// The 07 handler (code at 0x0079ba38):
//   - compares the first entry's name with L"BLOCK" (0x0097ce84) and picks the
//     window title L"Ship Select" (0x0097ce50) or L"Block Select" (0x0097ce68)
//     from 0x009ff4ec / 0x009ff4e8; the title comes from the client, not the
//     server;
//   - FUN_0073fdc4 -> FUN_0073fe9c builds the list window at position table
//     entry 0x28 = (12, 50), size 385 x 184 (FUN_00737f80, 0x00972dd4, mode 1),
//     up to 0x40 items; FUN_007374b8 adds one item per 0x2C-byte entry,
//     20 px apart (FUN_00737cdc: content height = count * 0x14 - 6);
//   - for a ship menu, FUN_0079bb58 -> FUN_0079a8c4 opens the info window
//     (FUN_0073a888) at table entry 0xd5 = (294, 305), 342 x 144, typing
//     unitxt group 0x0F entry 0 ("Select the SHIP you would like to join...").
//     The ship name (first entry) is kept in 0x00aab2ec for the lobby name
//     window.
// Items are left-aligned 10 px inside the frame, 6 px lower under a title
// (measured on the reference capture: "Go to lobby" at x 23, centre y 73.5),
// with the orange selection bar (drawSelectBar) across the content width.

import { anchorX, InfoWindow, inGameSpace, WINDOW_POS } from './ingame.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { drawSelectBar, drawTitlePill, drawWindowFrame, pillWidth, type Screen, type Stage, type WindowSkin } from './stage.ts';

export interface ShipMenuItem {
  label: string;
}

const FRAME = 1 / 30;
const MENU_W = 385;
const MENU_H = 184;
const ITEM_STEP = 20;

export class ShipSelectScreen implements Screen {
  transparent = true;
  private skin: WindowSkin;
  private title: string;
  private items: ShipMenuItem[];
  private info: InfoWindow;
  private cursor = 0;
  private acc = 0;
  private frame = 0;
  busy = false;
  private choose: (index: number) => void;
  private cancel: () => void;

  constructor(skin: WindowSkin, title: string, items: ShipMenuItem[], infoText: string, choose: (index: number) => void, cancel: () => void) {
    this.skin = skin;
    this.title = title;
    this.items = items;
    this.info = new InfoWindow(WINDOW_POS.shipInfo[0], WINDOW_POS.shipInfo[1], 342, 144);
    this.info.set(infoText);
    this.choose = choose;
    this.cancel = cancel;
  }

  update(dt: number): void {
    this.acc += dt;
    while (this.acc >= FRAME) {
      this.acc -= FRAME;
      this.frame++;
      this.info.tick();
    }
  }

  key(e: KeyboardEvent): void {
    if (this.busy) return;
    // Default keyboard config: Select Up/Down = arrows, Decide = Enter,
    // Cancel = Backspace (see lobby.ts in classic/).
    if (e.key === 'ArrowUp') this.cursor = (this.cursor + this.items.length - 1) % this.items.length;
    else if (e.key === 'ArrowDown') this.cursor = (this.cursor + 1) % this.items.length;
    else if (e.key === 'Enter') this.choose(this.cursor);
    else if (e.key === 'Backspace' || e.key === 'Escape') this.cancel();
  }

  draw(ctx: CanvasRenderingContext2D, stage: Stage): void {
    // The windows fade in over the first frames (capture: half-dark 0.2 s
    // after the warp). Fitted: 15 frames.
    const alpha = Math.min(1, this.frame / 15);
    inGameSpace(ctx, stage, (extra) => {
      ctx.globalAlpha = alpha;
      const [x0, y] = WINDOW_POS.shipMenu;
      const x = anchorX(x0, MENU_W, extra);
      drawWindowFrame(ctx, this.skin.frame, x, y, MENU_W, MENU_H);
      const cx = x + 10;
      const cy = y + 16;
      const cw = MENU_W - 20;
      if (this.items.length) drawSelectBar(ctx, this.skin.bars, cx, cy + this.cursor * ITEM_STEP, cw, 16);
      this.items.forEach((it, i) => {
        drawGameText(ctx, it.label, cx, cy + i * ITEM_STEP + 1, i === this.cursor ? '#ffc19a' : '#ffffff', alpha);
      });
      const tw = gameTextWidth(this.title);
      drawTitlePill(ctx, this.skin.frame, x, y - 13, tw, 1);
      drawGameText(ctx, this.title, x + (pillWidth(tw) - tw) / 2, y - 13 + 4 + 1, '#120400', alpha);
      this.info.draw(ctx, this.skin, extra);
    });
  }
}

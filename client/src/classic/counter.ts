// Lobby information counter, as PsoBB.exe (Ephinea 1.25.13) runs it.
//
// Trigger: TObjInfoCol (object type 0x0180 in map_lobby_NNo.dat, newserv
// Map.cc) — FUN_0065c2d0 keeps param1 as the radius (+0x68 -> +0xac);
// its update "unknown_update_lobby_menu_list" opens the menu when the local
// player is within that radius, presses Decide (Enter) and no menu is open.
// Lobby 1 has six of them (radius 15) around the counter.
//
// Menus (generic menu window, FUN_00735708, items added with FUN_00735c90
// flags 6, centred):
//   - FUN_0079f218: at table entry 0xc6 = (68, 251), "Organize PARTY" (0x0F/0x37),
//     "Transport" (0x38), "Team" (0x56) (+ "Change marker" (0x4a) in lobbies
//     >= 0xd); the info window (FUN_0079a8c4, entry 0xd5 = (294, 305), 342 x
//     144) types 0x0F/3 "This is the Information Counter.".
//   - a choice collapses its menu to the chosen line (FUN_0073600c: height =
//     20 (0x0097143c) + text height, over 3 frames) shown with the green bar,
//     and opens the next menu at entry 0xc7 = (82, 292):
//       Transport -> "Change SHIP" (0x40), "Change BLOCK" (0x41) (FUN_0079b568);
//       Team -> "Create Team" (0x57), "Ranking" (0x58), "Master Menu" (0x5b),
//         "Leave Team" (0x5c) (FUN_0079a288);
//       Organize PARTY -> "Join a PARTY" (0x3b), "Create a PARTY" (0x3c)
//         (ShowJoinOrCreatePartyMenu, assumed for this entry).
//   - size (FUN_0073608c): width = widest text + 20 (0x0097141c), height =
//     items * (14 + 6) - 6 + 20 (0x00971424, 0x00971420); items centred
//     (FUN_00736458: x = -0.5 * text width + width * 0.5 - 10).
// Widescreen: psobb.io centres these menus like the title's Login menu
// (measured on capture e01: "Transport" at x 68 + 64 on a 768-wide screen).
// The leaf actions (ship/block change, party and team commands) are not
// implemented: they close the menus.

import { se, SE } from '../audio/se.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { InfoWindow, WINDOW_POS } from './ingame.ts';
import { drawSelectBar, drawWindowFrame, type WindowSkin } from './stage.ts';

interface CounterMenu {
  x: number;
  y: number;
  items: string[];
  next?: Array<CounterMenu | null>;
}

export interface CounterText {
  info: string; // 0x0F/3
  first: string[]; // 0x0F/0x37, 0x38, 0x56
  transport: string[]; // 0x0F/0x40, 0x41
  team: string[]; // 0x0F/0x57, 0x58, 0x5b, 0x5c
  party: string[]; // 0x0F/0x3b, 0x3c
}

export class InfoCounter {
  open = false;
  private stack: Array<{ menu: CounterMenu; cursor: number; collapse: number }> = [];
  private info: InfoWindow;
  private infoText: string;
  private root: CounterMenu;

  constructor(text: CounterText) {
    this.infoText = text.info;
    this.info = this.newInfo();
    const sub = (items: string[]): CounterMenu => ({ x: 82, y: 292, items });
    this.root = { x: 68, y: 251, items: text.first, next: [sub(text.party), sub(text.transport), sub(text.team)] };
  }

  begin(): void {
    this.open = true;
    this.stack = [{ menu: this.root, cursor: 0, collapse: 0 }];
    this.info = this.newInfo();
    se(SE.ok);
  }

  private newInfo(): InfoWindow {
    const [ix, iy] = WINDOW_POS.shipInfo; // entry 0xd5
    const w = new InfoWindow(ix, iy, 342, 144);
    w.set(this.infoText);
    return w;
  }

  tick(): void {
    if (!this.open) return;
    this.info.tick();
    for (let i = 0; i < this.stack.length - 1; i++) this.stack[i].collapse = Math.min(3, this.stack[i].collapse + 1);
  }

  key(e: KeyboardEvent): void {
    if (!this.open) return;
    const top = this.stack[this.stack.length - 1];
    const n = top.menu.items.length;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      top.cursor = (top.cursor + (e.key === 'ArrowUp' ? n - 1 : 1)) % n;
      se(SE.cursor);
    } else if (e.key === 'Enter') {
      se(SE.ok);
      const next = top.menu.next?.[top.cursor];
      if (next) this.stack.push({ menu: next, cursor: 0, collapse: 0 });
      else this.open = false;
    } else if (e.key === 'Backspace' || e.key === 'Escape') {
      se(SE.cancel);
      this.stack.pop();
      if (this.stack.length) this.stack[this.stack.length - 1].collapse = 0;
      else this.open = false;
    }
  }

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, extra: number): void {
    if (!this.open) return;
    const dx = extra / 2;
    this.stack.forEach((lv, depth) => {
      const { menu } = lv;
      const textW = Math.max(...menu.items.map(gameTextWidth));
      const w = textW + 20;
      const full = menu.items.length * 20 - 6 + 20;
      const collapsed = depth < this.stack.length - 1;
      // FUN_0073600c: 20 + one line (14) when collapsed, reached in 3 frames.
      const h = collapsed ? full + ((34 - full) * lv.collapse) / 3 : full;
      const x = menu.x + dx;
      drawWindowFrame(ctx, skin.frame, x, menu.y, w, h);
      const cx = x + 10;
      const cy = menu.y + 10;
      if (collapsed) {
        drawSelectBar(ctx, skin.bars, cx, cy, w - 20, 16, true);
        const t = menu.items[lv.cursor];
        drawGameText(ctx, t, cx + (w - 20 - gameTextWidth(t)) / 2, cy + 1, '#ffffff');
        return;
      }
      drawSelectBar(ctx, skin.bars, cx, cy + lv.cursor * 20, w - 20, 16);
      menu.items.forEach((t, i) => drawGameText(ctx, t, cx + (w - 20 - gameTextWidth(t)) / 2, cy + i * 20 + 1, i === lv.cursor ? '#ffc19a' : '#ffffff'));
    });
    this.info.draw(ctx, skin, extra);
  }
}

// TObjInfoCol entries of a lobby object file, in world space.
export interface InfoCol {
  x: number;
  z: number;
  radius: number;
}

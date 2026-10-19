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
//         (ShowJoinOrCreatePartyMenu_0079b698 region, handle_counter_menu
//         _selection value 0); "Create a PARTY" opens "EPISODE 1" (0x47),
//         "EPISODE 2" (0x48) and, with Episode 4, "EPISODE 4" (0x49) at
//         entry 0xc8 = (96, 333) (ShowEpisodeDifficultySelect), the info
//         window following the cursor with 0x11 / 0x12 / 0x13.
//   - Cancel in any of these menus closes all of them (close_lobby_menus:
//     handle_counter_menu_selection, HandleLobbyEpisodeSubMenuInput_0079b264
//     and HandleGameListMenuSelection_0079a644 all do that on bit 4).
//   - The leaves then belong to classic/gamelist.ts (the party game list and
//     the party creation window).
//   - size (FUN_0073608c): width = widest text + 20 (0x0097141c), height =
//     items * (14 + 6) - 6 + 20 (0x00971424, 0x00971420); items centred
//     (FUN_00736458: x = -0.5 * text width + width * 0.5 - 10).
// Widescreen: psobb.io centres these menus like the title's Login menu
// (measured on capture e01: "Transport" at x 68 + 64 on a 768-wide screen).
// The ship/block change and the team commands are not implemented: they
// close the menus.

import { se, SE } from '../audio/se.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { InfoWindow, WINDOW_POS } from './ingame.ts';
import { drawSelectBar, drawWindowFrame, type WindowSkin } from './stage.ts';

interface CounterMenu {
  x: number;
  y: number;
  items: string[];
  next?: Array<CounterMenu | null>;
  // Info window text per cursor row (the episode menu), shown while this menu
  // is the top one.
  info?: string[];
  // Names the menu in onChoose.
  id?: CounterMenuId;
}

export type CounterMenuId = 'root' | 'party' | 'transport' | 'team' | 'episode';

// A leaf chosen: the menu and the row (party 0 = Join, party/episode 0..2 =
// the episode: 1, 2 or 3 for Episode 4).
export type CounterChoice = (menu: CounterMenuId, index: number) => void;

export interface CounterText {
  info: string; // 0x0F/3
  first: string[]; // 0x0F/0x37, 0x38, 0x56
  transport: string[]; // 0x0F/0x40, 0x41
  team: string[]; // 0x0F/0x57, 0x58, 0x5b, 0x5c
  party: string[]; // 0x0F/0x3b, 0x3c
  episodes?: string[]; // 0x0F/0x47, 0x48, (0x49 with Episode 4)
  episodeInfo?: string[]; // 0x0F/0x11, 0x12, (0x13)
}

export class InfoCounter {
  open = false;
  private stack: Array<{ menu: CounterMenu; cursor: number; collapse: number }> = [];
  private info: InfoWindow;
  private infoText: string;
  private root: CounterMenu;
  // Called when a leaf is chosen, before the menus close.
  onChoose: CounterChoice = () => {};

  constructor(text: CounterText) {
    this.infoText = text.info;
    this.info = this.newInfo();
    const sub = (id: CounterMenuId, items: string[], next?: Array<CounterMenu | null>): CounterMenu => ({ x: 82, y: 292, items, id, next });
    const episode: CounterMenu | null = text.episodes
      ? { x: 96, y: 333, items: text.episodes, info: text.episodeInfo, id: 'episode' } // entry 0xc8
      : null;
    this.root = {
      x: 68,
      y: 251,
      items: text.first,
      id: 'root',
      next: [sub('party', text.party, [null, episode]), sub('transport', text.transport), sub('team', text.team)],
    };
  }

  close(): void {
    this.open = false;
    this.stack = [];
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

  // The episode menu retypes the info window with the cursor row.
  private showInfo(level: { menu: CounterMenu; cursor: number }): void {
    const text = level.menu.info?.[level.cursor];
    if (text !== undefined) this.info.set(text);
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
      this.showInfo(top);
    } else if (e.key === 'Enter') {
      se(SE.ok);
      const next = top.menu.next?.[top.cursor];
      if (next) {
        const level = { menu: next, cursor: 0, collapse: 0 };
        this.stack.push(level);
        this.showInfo(level);
      } else {
        const id = top.menu.id;
        this.close();
        if (id) this.onChoose(id, top.cursor);
      }
    } else if (e.key === 'Backspace' || e.key === 'Escape') {
      // close_lobby_menus: every counter menu goes at once.
      se(SE.cancel);
      this.close();
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

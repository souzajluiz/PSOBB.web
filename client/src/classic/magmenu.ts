// Item Pack > MAG: the MAG list, the "Select" window, the item list and the
// feeding, as PsoBB.exe (Ephinea 1.25.13) runs them (main menu id 0x17,
// handle_player_menu_select -> ChallengePlayerListWindow_Constructor_007525bc;
// states ChallengePlayerListWindow_HandleInput_007526c8). The feed itself is
// net/magfeed.ts and GameItems.feedMag.
//
// Windows (position table 0x00971f40):
//   - MAG list: entry 7 = (13, 256), 206 x 184 (0x00973dc0), title unitxt
//     group 11 [0x3C] "MAG" (ChallengePlayerListWindow_InitializeUI_00752664),
//     the mags of the inventory in its order (EquipListWindow_PopulateWeaponList
//     _0074b340 with group 2), rows as in the Item Pack;
//   - the mag's window: entry 9 = (395, 256), the 240 x 184 description
//     window (CreateEquipListWindowObject_00725d18) following the cursor;
//   - Select: entry 8 = (221, 256), 172 wide (0x432c0000), title [0x30]
//     (ChallengePlayerListWindowCreateItemDetailWindow_00752edc): "Give
//     Items" [0x78] (value 1), off while the mag's feed count is 2 or more,
//     then "Photon Blast" [0x77] (value 0), off without a photon blast;
//   - Item List: entry 0xD = (13, 317), 308 x 124 (0x00973e2c), title [0x37]
//     (ChallengePlayerListWindowCreateItemListWindow_00752ffc): the items a
//     MAG can eat (ListWindowObject_PopulateRangedWeapons_0074b6f4);
//   - the new photon blast: entry 0xE, one line "[0x77] <name>" (group 9)
//     for 90 frames (0x00973e68, ..._00753060).
// States: 2 browse mags (Backspace closes, Enter -> 3); 3/4 Select (Backspace
// -> the list; Give Items -> 5, Photon Blast -> 0xE); 5/6 the item list
// (Backspace -> 3, Enter -> 7); 7 feed (Player_UpdateStateAndSync_0068dcc8);
// 8..0xB the stat levels rise one step each 30 frames (0x00973e6c) with SE
// 0x96 (ApplyItemMagData_0072610c, the bars full meanwhile:
// RefreshItemStatDisplay_00726294); 0xC/0xD the photon blast line when the
// mag gained one; back to 3.
//
// ASSUMED: the content of the mag's window (the exe draws stat elements whose
// layout is not recovered: here Level / Synchro / IQ [0xC0..0xC2] and the
// four stats with a bar of their part of a level); the Photon Blast choice
// (state 0xE, ListWindowObject_Initialize_0075330c at entry 0xA) is left
// out: it does nothing here.

import { se, SE } from '../audio/se.ts';
import type { CharacterFile, InventoryItem } from '../net/charfile.ts';
import { isMagFood, photonBlasts, SE_MAG_LEVEL, type FeedTimer } from '../net/magfeed.ts';
import type { ItemPMT } from '../formats/itempmt.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { DISABLED, drawListWindow, drawWindowTitle, INSET, listKey, ROW, TITLE_GAP, type ListItem } from './fieldwindows.ts';
import { ICON_UV, isWrapped, itemRow, type ItemPackTextures, type ItemRow, type RowContext } from './itempack.ts';
import { drawSelectBar, drawWindowFrame, type WindowSkin } from './stage.ts';

export const MAG_LIST = { x: 13, y: 256, w: 206, h: 184 } as const; // entry 7, 0x00973dc0
export const MAG_SELECT = { x: 221, y: 256, w: 172 } as const; // entry 8
export const MAG_STATUS = { x: 395, y: 256, w: 240, h: 184 } as const; // entry 9, 0x009f2b58
export const MAG_ITEMS = { x: 13, y: 317, w: 308, h: 124 } as const; // entry 0xD, 0x00973e2c
export const MAG_PB = { x: 320, y: 340 } as const; // entry 0xE
export const LEVEL_STEP_FRAMES = 30; // 0x00973e6c
export const PB_FRAMES = 90; // 0x00973e68
const LIST_ROWS = 8; // (184 - 26 + 6) / 20
const ITEM_ROWS = 5;
const ICON = 18;

export interface MagMenuEnv {
  character: () => CharacterFile | null;
  rowContext: () => RowContext;
  text: (group: number, index: number) => string;
  pmt: () => ItemPMT | null;
  feedTimer: (magId: number) => FeedTimer;
  feed: (magId: number, foodId: number) => boolean;
}

type State = 'mags' | 'select' | 'items' | 'rising' | 'pb';

// The mags of the inventory (group 2), in order.
export function magList(c: CharacterFile): InventoryItem[] {
  return c.inventory.filter((it) => it.data.data1[0] === 2);
}

// The items a mag can eat.
export function magFoods(c: CharacterFile, pmt: ItemPMT): InventoryItem[] {
  return c.inventory.filter((it) => isMagFood(it.data, pmt, isWrapped(it.data)));
}

// The Select window's entries (0x00752edc).
export function magSelectItems(mag: InventoryItem, timer: FeedTimer, text: (i: number) => string): ListItem[] {
  return [
    { label: text(0x78), value: 1, enabled: timer.canFeed },
    { label: text(0x77), value: 0, enabled: photonBlasts(mag.data).length > 0 },
  ];
}

const statLevels = (d: Uint8Array): number[] => [2, 3, 4, 5].map((i) => Math.trunc((d[i * 2] | (d[i * 2 + 1] << 8)) / 100));

export class MagMenu {
  private state: State = 'mags';
  private cursor = 0;
  private top = 0;
  private select = { cursor: 0, items: [] as ListItem[] };
  private item = { cursor: 0, top: 0 };
  private frame = 0;
  private wait = 0;
  // Levels shown by the mag's window while they rise (state 0xA).
  private shown: number[] | null = null;
  private pbCount = 0;
  private pbLine = '';
  mags: InventoryItem[] = [];
  foods: InventoryItem[] = [];
  private env: MagMenuEnv;

  constructor(env: MagMenuEnv) {
    this.env = env;
    this.refresh();
  }

  refresh(): void {
    const c = this.env.character();
    this.mags = c ? magList(c) : [];
    if (this.cursor >= this.mags.length) this.cursor = Math.max(0, this.mags.length - 1);
    const pmt = this.env.pmt();
    this.foods = c && pmt ? magFoods(c, pmt) : [];
    if (this.item.cursor >= this.foods.length) this.item.cursor = Math.max(0, this.foods.length - 1);
    this.clampTop();
    const mag = this.mags[this.cursor];
    if (mag && this.state !== 'mags') this.select.items = magSelectItems(mag, this.env.feedTimer(mag.data.id), (i) => this.env.text(11, i));
  }

  private clampTop(): void {
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + LIST_ROWS) this.top = this.cursor - LIST_ROWS + 1;
    if (this.item.cursor < this.item.top) this.item.top = this.item.cursor;
    if (this.item.cursor >= this.item.top + ITEM_ROWS) this.item.top = this.item.cursor - ITEM_ROWS + 1;
  }

  get busy(): boolean {
    return this.state === 'rising' || this.state === 'pb';
  }

  tick(): void {
    this.frame++;
    const mag = this.mags[this.cursor];
    if (this.state === 'rising' && mag && this.shown && ++this.wait > LEVEL_STEP_FRAMES) {
      // ApplyItemMagData_0072610c: each stat shown below its level goes up 1.
      const real = statLevels(mag.data.data1);
      let up = false;
      this.shown = this.shown.map((v, i) => (v < real[i] ? ((up = true), v + 1) : v));
      this.wait = 0;
      if (up) se(SE_MAG_LEVEL);
      else this.afterRise(mag);
    } else if (this.state === 'pb' && ++this.wait > PB_FRAMES) {
      this.state = 'select';
      this.refresh();
    }
  }

  // State 0xC: a photon blast more than before the feed shows its line.
  private afterRise(mag: InventoryItem): void {
    this.shown = null;
    const pbs = photonBlasts(mag.data);
    if (pbs.length === this.pbCount) {
      this.state = 'select';
      this.refresh();
      return;
    }
    this.pbLine = `${this.env.text(11, 0x77)} ${this.env.text(9, pbs[this.pbCount])}${this.env.text(11, 0x5f)}`;
    this.state = 'pb';
    this.wait = 0;
  }

  // Returns false when the window closes (Backspace on the MAG list).
  key(e: KeyboardEvent): boolean {
    if (this.busy) return true;
    const back = e.key === 'Backspace' || e.key === 'Escape';
    if (this.state === 'mags') {
      const n = this.mags.length;
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && n) {
        this.cursor = (this.cursor + (e.key === 'ArrowUp' ? n - 1 : 1)) % n;
        this.clampTop();
        se(SE.cursor);
      } else if (e.key === 'Enter') {
        if (!n) {
          se(SE.buzzer);
          return true;
        }
        se(SE.ok);
        this.state = 'select';
        this.select.cursor = 0;
        this.refresh();
      } else if (back) {
        se(SE.cancel);
        return false;
      }
      return true;
    }
    if (this.state === 'select') {
      const r = listKey(e, this.select.items, this.select);
      if (r === 'cancel') {
        this.state = 'mags';
      } else if (r === 'decide' && this.select.items[this.select.cursor].value === 1) {
        this.state = 'items';
        this.item = { cursor: 0, top: 0 };
        this.refresh();
      }
      return true;
    }
    // state 'items'
    const n = this.foods.length;
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && n) {
      this.item.cursor = (this.item.cursor + (e.key === 'ArrowUp' ? n - 1 : 1)) % n;
      this.clampTop();
      se(SE.cursor);
    } else if (e.key === 'Enter') {
      const mag = this.mags[this.cursor];
      const food = this.foods[this.item.cursor];
      if (!mag || !food) {
        se(SE.buzzer);
        return true;
      }
      se(SE.ok);
      this.feed(mag, food);
    } else if (back) {
      se(SE.cancel);
      this.state = 'select';
      this.refresh();
    }
    return true;
  }

  // State 7 -> 8: feed, then show the levels rising.
  private feed(mag: InventoryItem, food: InventoryItem): void {
    const before = statLevels(mag.data.data1);
    this.pbCount = photonBlasts(mag.data).length;
    if (!this.env.feed(mag.data.id, food.data.id)) {
      this.state = 'select';
      this.refresh();
      return;
    }
    this.refresh();
    const now = this.mags.find((m) => m.data.id === mag.data.id);
    if (now) this.cursor = this.mags.indexOf(now);
    this.shown = before;
    this.wait = LEVEL_STEP_FRAMES; // the first step comes at once
    this.state = 'rising';
  }

  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: ItemPackTextures, extra = 0): void {
    const rc = this.env.rowContext();
    const L = MAG_LIST;
    const cx = L.x + INSET;
    const cy = L.y + INSET + TITLE_GAP;
    const cw = L.w - 2 * INSET;
    const browsing = this.state === 'mags';
    drawWindowFrame(ctx, skin.frame, L.x, L.y, L.w, browsing ? L.h : ROW + 14 + TITLE_GAP);
    if (browsing) {
      if (!this.mags.length) drawGameText(ctx, this.env.text(11, 0xee), cx, cy + 1, DISABLED);
      else {
        drawSelectBar(ctx, skin.bars, cx, cy + (this.cursor - this.top) * ROW, cw, 16);
        this.mags.slice(this.top, this.top + LIST_ROWS).forEach((m, i) => this.drawRow(ctx, tex, itemRow(m, rc), cx, cy + i * ROW, cw));
      }
    } else {
      const m = this.mags[this.cursor];
      if (m) this.drawRow(ctx, tex, itemRow(m, rc), cx, cy, cw);
    }
    drawWindowTitle(ctx, skin, L.x, L.y, this.env.text(11, 0x3c));

    if (this.state === 'select') {
      drawListWindow(ctx, skin, MAG_SELECT.x, MAG_SELECT.y, MAG_SELECT.w, this.env.text(11, 0x30), this.select.items, this.select.cursor);
    }
    if (this.state === 'items' || this.busy) {
      const I = MAG_ITEMS;
      drawWindowFrame(ctx, skin.frame, I.x, I.y, I.w, I.h);
      const ix = I.x + INSET;
      const iy = I.y + INSET + TITLE_GAP;
      const iw = I.w - 2 * INSET;
      if (!this.foods.length) drawGameText(ctx, this.env.text(11, 0xee), ix, iy + 1, DISABLED);
      else {
        drawSelectBar(ctx, skin.bars, ix, iy + (this.item.cursor - this.item.top) * ROW, iw, 16);
        this.foods.slice(this.item.top, this.item.top + ITEM_ROWS).forEach((it, i) => this.drawRow(ctx, tex, itemRow(it, rc), ix, iy + i * ROW, iw));
      }
      drawWindowTitle(ctx, skin, I.x, I.y, this.env.text(11, 0x37));
    }

    ctx.save();
    ctx.translate(extra, 0);
    const mag = this.mags[this.cursor];
    if (mag) this.drawStatus(ctx, skin, mag);
    if (this.state === 'pb') {
      const w = gameTextWidth(this.pbLine) + 2 * INSET;
      drawWindowFrame(ctx, skin.frame, MAG_PB.x, MAG_PB.y, w, 14 + 2 * INSET);
      drawGameText(ctx, this.pbLine, MAG_PB.x + INSET, MAG_PB.y + INSET, '#ffffff');
    }
    ctx.restore();
  }

  // ASSUMED layout (see the header).
  private drawStatus(ctx: CanvasRenderingContext2D, skin: WindowSkin, mag: InventoryItem): void {
    const S = MAG_STATUS;
    drawWindowFrame(ctx, skin.frame, S.x, S.y, S.w, S.h);
    const d = mag.data.data1;
    const x = S.x + INSET;
    let y = S.y + INSET;
    const line = (label: string, value: string) => {
      drawGameText(ctx, label, x, y, '#ffffff');
      drawGameText(ctx, value, S.x + S.w - INSET - gameTextWidth(value), y, '#ffffff');
      y += ROW;
    };
    line(this.env.text(11, 0xc0), String(d[2]));
    line(this.env.text(11, 0xc1), `${mag.data.data2[0]}%`);
    line(this.env.text(11, 0xc2), String(mag.data.data2[1]));
    const real = statLevels(d);
    ['DEF', 'POW', 'DEX', 'MIND'].forEach((label, i) => {
      const v = d[(i + 2) * 2] | (d[(i + 2) * 2 + 1] << 8);
      const shown = this.shown?.[i] ?? real[i];
      // RefreshItemStatDisplay_00726294: a bar still below its level is full.
      const part = shown < real[i] ? 100 : v % 100;
      drawGameText(ctx, label, x, y, '#ffffff');
      const bx = x + 50;
      const bw = S.w - 2 * INSET - 50 - 30;
      ctx.fillStyle = '#203040';
      ctx.fillRect(bx, y + 4, bw, 6);
      ctx.fillStyle = '#ffd040';
      ctx.fillRect(bx, y + 4, (bw * part) / 100, 6);
      const lv = String(shown);
      drawGameText(ctx, lv, S.x + S.w - INSET - gameTextWidth(lv), y, '#ffffff');
      y += ROW;
    });
  }

  private drawRow(ctx: CanvasRenderingContext2D, tex: ItemPackTextures, r: ItemRow, x: number, y: number, w: number): void {
    for (const [icon, ox] of [[r.icon1, 0], [r.icon2, ICON]] as const) {
      const uv = ICON_UV[icon];
      if (uv) ctx.drawImage(tex.icons, uv[0], uv[1], ICON, ICON, x + ox, y, ICON, ICON);
    }
    if (r.name) drawGameText(ctx, r.name, x + 2 * ICON, y, r.nameColor);
    if (r.count) drawGameText(ctx, r.count, x + w - gameTextWidth(r.count), y, r.nameColor);
  }
}

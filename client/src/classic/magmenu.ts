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
// State 0xE (Select's "Photon Blast", value 0): the status window closes (entry 9), the
// photon list opens at entry 0xA (221, 256) with the mag's three blast rows and the cursor
// (ListWindowObject_Initialize_0075330c; Up / Down move it, wrapping over 3), and the info
// window at entry 0xB (409, 256) shows the cursor blast's description (unitxt group 7 at
// blast + 0x27). Decide and Cancel both return to state 3 (Select), where the status window
// opens again. Nothing is assigned: the exe's list has no writer for a blast.
//
// The status window (entry 9) is the GameList of the mag window; its page is the list's
// navigation byte (itemdetail.ts, the pages section). It is written by states 5 and 0xC
// (absolute: UpdateListNavigationDirection) and by the GameList's own key input
// (ChatShortcutMenu_HandleInput_0073e60c: Right / Left wrap it over 3, with a slide of
// +/-10 that decays each tick). The page is:
//   page 0 (open): the six stats with the current values (0x726ff0, labels 0x9c..0xa1);
//   page 1 (Give Items): Level / Synchro / IQ [0xC0..0xC2] and the four stats with a bar of
//     their part of a level (0x726864; the element offsets are in itemdetail.ts MAG_ELEMENT);
//   page 2 (a photon blast gained, or by the keys): the mag's three photon blast rows
//     (0x7267dc; an empty row is blank, `UpdateItemUI(elem, 0, 0)`).
// The item picture of the cursor mag is the window at entry 0xC (16, 172): the exe's
// ItemKTep4.afs entry (formats/itemkt.ts, through env.picture), or nothing.

import { menuKeyOf } from '../input/keyconfig.ts';
import { se, SE } from '../audio/se.ts';
import type { CharacterFile, InventoryItem } from '../net/charfile.ts';
import { isMagFood, photonBlasts, SE_MAG_LEVEL, type FeedTimer } from '../net/magfeed.ts';
import type { ItemPMT } from '../formats/itempmt.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { DISABLED, drawListWindow, drawWindowTitle, INSET, listKey, listWindowHeight, ROW, TITLE_GAP, type ListItem } from './fieldwindows.ts';
import { wipeElement, WindowAnim, withElementWipe, withWindowAnim } from './windowanim.ts';
import { ICON_UV, isWrapped, itemRow, type ItemPackTextures, type ItemRow, type RowContext } from './itempack.ts';
import { drawSelectBar, drawWindowFrame, type WindowSkin } from './stage.ts';
import {
  magPhotonRows,
  magStatRows,
  MAG_PAGE,
  nextPage,
  PAGE_SLIDE,
  pageSlideAfter,
  photonDescriptionIndex,
  PAGE_COUNT,
  type StatBlock,
} from './itemdetail.ts';
import type { ItemData } from '../formats/itemnames.ts';

export const MAG_LIST = { x: 13, y: 256, w: 206, h: 184 } as const; // entry 7, 0x00973dc0
export const MAG_SELECT = { x: 221, y: 256, w: 172 } as const; // entry 8
export const MAG_STATUS = { x: 395, y: 256, w: 240, h: 184 } as const; // entry 9, 0x009f2b58
export const MAG_ITEMS = { x: 13, y: 317, w: 308, h: 124 } as const; // entry 0xD, 0x00973e2c
export const MAG_PB = { x: 320, y: 340 } as const; // entry 0xE
// Entry 0xA (221, 256) and 0xB (409, 256) from the GUI table 0x00971f40 (8-byte stride). The
// photon list's width is ASSUMED to be the Select window's (172); the info window's width fits
// its text (ASSUMED: GetListWindowDefaultWidth's result is not decoded).
export const MAG_PHOTON_LIST = { x: 221, y: 256, w: 172 } as const; // entry 0xA
export const MAG_PHOTON_INFO = { x: 409, y: 256 } as const; // entry 0xB
export const MAG_PICTURE = { x: 16, y: 172 } as const; // entry 0xC
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
  // The mag's picture (ItemKTep4.afs, formats/itemkt.ts), or null when the exe draws none.
  picture?: (item: ItemData) => Promise<ImageBitmap | null>;
}

type State = 'mags' | 'select' | 'items' | 'rising' | 'pb' | 'photon';

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
  // The status window's page (the GameList's navigation byte, itemdetail.ts MAG_PAGE): 0 at
  // open, 1 once Give Items has opened the item list, 2 once a feed gained a photon blast.
  private panelPage: number = MAG_PAGE.stats;
  // The page slide (ChatShortcutMenu_UpdatePosition_0073e5f8): +/-10 when the page changes, decayed each tick.
  private slide = 0;
  // The photon list (entry 0xA): its cursor row, and the info window (entry 0xB) is its description.
  private photon = { cursor: 0 };
  // The cursor mag's picture (entry 0xC); `pictureId` is the mag whose picture was asked for.
  private picture: ImageBitmap | null = null;
  private pictureId = -1;
  mags: InventoryItem[] = [];
  foods: InventoryItem[] = [];
  // The later windows are objects of their own, each with its own counter
  // (classic/windowanim.ts). The status window (entry 9) is made with the menu
  // and opens with it (start). Select (entry 8), the item list (entry 0xD) and
  // the photon blast line (entry 0xE) are made fresh each time they open
  // (ChallengePlayerListWindow_HandleInput_007526c8 states 3 / 5 create them
  // when the pointer is null) and close with their close animation
  // (CloseGameListMenu, which nulls the pointer). `speed`: the field menu's window speed.
  speed = 1;
  statusAnim = new WindowAnim(true, false);
  selectAnim = new WindowAnim(true, false);
  itemsAnim = new WindowAnim(true, false);
  pbAnim = new WindowAnim(true, false);
  photonAnim = new WindowAnim(true, false);
  photonInfoAnim = new WindowAnim(true, false);
  private env: MagMenuEnv;

  constructor(env: MagMenuEnv) {
    this.env = env;
    this.refresh();
  }

  start(): void {
    this.statusAnim.open(this.speed);
  }

  // Changes the state and the windows it opens / closes.
  private setState(to: State): void {
    const from = this.state;
    if (from === to) return;
    const fresh = (): WindowAnim => {
      const a = new WindowAnim(true, false);
      a.open(this.speed);
      return a;
    };
    if (to === 'select') this.selectAnim = fresh();
    if (to === 'items') this.itemsAnim = fresh();
    if (to === 'pb') this.pbAnim = fresh();
    if (to === 'photon') {
      this.photonAnim = fresh();
      this.photonInfoAnim = fresh();
      // State 0xE: the status window (entry 9) closes with the close SFX and stays shut until state 3.
      this.statusAnim.close();
    }
    if (from === 'select') this.selectAnim.close();
    // Back to the Select window: the item list closes (state 3's CloseGameListMenu on +0x38).
    if (to === 'select' && from !== 'mags') this.itemsAnim.close();
    if (from === 'pb') this.pbAnim.close();
    if (from === 'photon') {
      this.photonAnim.close();
      this.photonInfoAnim.close();
      this.statusAnim.open(this.speed); // state 3 clears the status window's closing flag
    }
    this.state = to;
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

  get page(): number {
    return this.panelPage;
  }

  get busy(): boolean {
    return this.state === 'rising' || this.state === 'pb';
  }

  // The page slide now (0 when settled).
  get pageSlide(): number {
    return this.slide;
  }

  // The photon list's cursor row (0..2) and the description its info window shows.
  get photonCursor(): number {
    return this.photon.cursor;
  }

  get photonInfo(): string {
    const blast = magPhotonRows(this.cursorBlasts())[this.photon.cursor];
    const index = photonDescriptionIndex(blast);
    return index === null ? '' : this.env.text(7, index);
  }

  private cursorBlasts(): number[] {
    const mag = this.mags[this.cursor];
    return mag ? photonBlasts(mag.data) : [];
  }

  // The cursor mag's picture: asked for once per mag (UpdateItemDetail_0073175c runs on each cursor move).
  private syncPicture(): void {
    const mag = this.mags[this.cursor];
    const id = mag ? mag.data.id : -1;
    if (id === this.pictureId) return;
    this.pictureId = id;
    this.picture = null;
    if (!mag || !this.env.picture) return;
    const ask = this.env.picture(mag.data);
    ask.then((bmp) => {
      if (this.pictureId === id) this.picture = bmp;
    });
  }

  tick(): void {
    this.frame++;
    this.statusAnim.tick(this.speed);
    this.selectAnim.tick(this.speed);
    this.itemsAnim.tick(this.speed);
    this.pbAnim.tick(this.speed);
    this.photonAnim.tick(this.speed);
    this.photonInfoAnim.tick(this.speed);
    this.slide = Math.abs(this.slide) < 0.01 ? 0 : pageSlideAfter(this.slide);
    this.syncPicture();
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
      this.setState('select');
      this.refresh();
    }
  }

  // State 0xC: a photon blast more than before the feed shows its line.
  private afterRise(mag: InventoryItem): void {
    this.shown = null;
    const pbs = photonBlasts(mag.data);
    if (pbs.length === this.pbCount) {
      this.setState('select');
      this.refresh();
      return;
    }
    this.pbLine = `${this.env.text(11, 0x77)} ${this.env.text(9, pbs[this.pbCount])}${this.env.text(11, 0x5f)}`;
    this.panelPage = MAG_PAGE.photon; // state 0xC: HandleGameListNavigation(+2) before the PB window
    this.setState('pb');
    this.wait = 0;
  }

  // Returns false when the window closes (Backspace on the MAG list).
  key(e: KeyboardEvent): boolean {
    const k = menuKeyOf(e);
    // The status window's page keys (the GameList's navigation, ChatShortcutMenu_HandleInput_0073e60c):
    // read in every state while the window shows an item; not while it is shut (state 0xE).
    if ((k === 'left' || k === 'right') && this.state !== 'photon' && this.mags.length > 0) {
      this.stepPage(k === 'right' ? 1 : -1);
      return true;
    }
    if (this.busy) return true;
    const back = k === 'cancel';
    if (this.state === 'photon') {
      // The photon list (ListWindowObject_HandleDirectionalInput_007534ac): Up / Down move the
      // cursor over the three rows. Decide and Cancel both return to Select (state 0xF -> 3).
      if (k === 'up' || k === 'down') {
        this.photon.cursor = (this.photon.cursor + (k === 'up' ? PAGE_COUNT - 1 : 1)) % PAGE_COUNT;
        se(SE.cursor);
      } else if (k === 'decide' || back) {
        se(back ? SE.cancel : SE.ok);
        this.setState('select');
        this.refresh();
      }
      return true;
    }
    if (this.state === 'mags') {
      const n = this.mags.length;
      if ((k === 'up' || k === 'down') && n) {
        this.cursor = (this.cursor + (k === 'up' ? n - 1 : 1)) % n;
        this.clampTop();
        se(SE.cursor);
      } else if (menuKeyOf(e) === 'decide') {
        if (!n) {
          se(SE.buzzer);
          return true;
        }
        se(SE.ok);
        this.setState('select');
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
        this.setState('mags');
      } else if (r === 'decide' && this.select.items[this.select.cursor].value === 1) {
        this.panelPage = MAG_PAGE.status; // ChallengePlayerListWindow_HandleInput state 5: HandleGameListNavigation(+1)
        this.setState('items');
        this.item = { cursor: 0, top: 0 };
        this.refresh();
      } else if (r === 'decide') {
        // Photon Blast (value 0): state 0xE (ChallengePlayerListWindowSetActionState_00752fe0).
        this.photon.cursor = 0;
        this.setState('photon');
      }
      return true;
    }
    // state 'items'
    const n = this.foods.length;
    if ((menuKeyOf(e) === 'up' || menuKeyOf(e) === 'down') && n) {
      this.item.cursor = (this.item.cursor + (menuKeyOf(e) === 'up' ? n - 1 : 1)) % n;
      this.clampTop();
      se(SE.cursor);
    } else if (menuKeyOf(e) === 'decide') {
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
      this.setState('select');
      this.refresh();
    }
    return true;
  }

  // The GameList's page key (ChatShortcutMenu_HandleInput_0073e60c): the page wraps over 3, the
  // slide starts at +10 going right and -10 going left (0x41200000 / 0xc1200000), SE 0x56f.
  private stepPage(step: 1 | -1): void {
    this.panelPage = nextPage(this.panelPage, step);
    this.slide = step * PAGE_SLIDE;
    se(SE.cursor);
  }

  // State 7 -> 8: feed, then show the levels rising.
  private feed(mag: InventoryItem, food: InventoryItem): void {
    const before = statLevels(mag.data.data1);
    this.pbCount = photonBlasts(mag.data).length;
    if (!this.env.feed(mag.data.id, food.data.id)) {
      this.setState('select');
      this.refresh();
      return;
    }
    this.refresh();
    const now = this.mags.find((m) => m.data.id === mag.data.id);
    if (now) this.cursor = this.mags.indexOf(now);
    this.shown = before;
    this.wait = LEVEL_STEP_FRAMES; // the first step comes at once
    this.setState('rising');
  }

  // `wipe`: the leaf's opening animation (FieldMenu's leafAnim): the elements of each window are revealed by its wipe.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: ItemPackTextures, extra = 0, wipe?: WindowAnim): void {
    const rc = this.env.rowContext();
    const L = MAG_LIST;
    const cx = L.x + INSET;
    const cy = L.y + INSET + TITLE_GAP;
    const cw = L.w - 2 * INSET;
    const browsing = this.state === 'mags';
    drawWindowFrame(ctx, skin.frame, L.x, L.y, L.w, browsing ? L.h : ROW + 14 + TITLE_GAP);
    withElementWipe(wipe, cx, cy, cw, () => {
      if (browsing) {
        if (!this.mags.length) {
          const none = this.env.text(11, 0xee);
          wipeElement(ctx, cx, cy + 1, ROW, () => drawGameText(ctx, none, cx, cy + 1, DISABLED));
        } else {
          const bar = cy + (this.cursor - this.top) * ROW;
          wipeElement(ctx, cx, bar, 16, () => drawSelectBar(ctx, skin.bars, cx, bar, cw, 16));
          this.mags.slice(this.top, this.top + LIST_ROWS).forEach((m, i) => this.drawRow(ctx, tex, itemRow(m, rc), cx, cy + i * ROW, cw));
        }
      } else {
        const m = this.mags[this.cursor];
        if (m) this.drawRow(ctx, tex, itemRow(m, rc), cx, cy, cw);
      }
      drawWindowTitle(ctx, skin, L.x, L.y, this.env.text(11, 0x3c));
    });

    // Select and the item list are drawn while open or closing, each under its own animation.
    if (this.state === 'select' || this.selectAnim.visible) {
      const S = MAG_SELECT;
      const sa = this.selectAnim;
      withWindowAnim(ctx, sa, S.x, S.y, S.w, listWindowHeight(this.select.items.length, true), () =>
        withElementWipe(sa, S.x + INSET, S.y + INSET + TITLE_GAP, S.w - 2 * INSET, () =>
          drawListWindow(ctx, skin, S.x, S.y, S.w, this.env.text(11, 0x30), this.select.items, this.select.cursor),
        ),
      );
    }
    if (this.state === 'items' || this.busy || this.itemsAnim.visible) {
      const I = MAG_ITEMS;
      const ia = this.itemsAnim;
      withWindowAnim(ctx, ia, I.x, I.y, I.w, I.h, () => drawWindowFrame(ctx, skin.frame, I.x, I.y, I.w, I.h));
      const ix = I.x + INSET;
      const iy = I.y + INSET + TITLE_GAP;
      const iw = I.w - 2 * INSET;
      withWindowAnim(ctx, ia, I.x, I.y, I.w, I.h, () =>
        withElementWipe(ia, ix, iy, iw, () => {
        if (!this.foods.length) {
          const none = this.env.text(11, 0xee);
          wipeElement(ctx, ix, iy + 1, ROW, () => drawGameText(ctx, none, ix, iy + 1, DISABLED));
        } else {
          const bar = iy + (this.item.cursor - this.item.top) * ROW;
          wipeElement(ctx, ix, bar, 16, () => drawSelectBar(ctx, skin.bars, ix, bar, iw, 16));
          this.foods.slice(this.item.top, this.item.top + ITEM_ROWS).forEach((it, i) => this.drawRow(ctx, tex, itemRow(it, rc), ix, iy + i * ROW, iw));
        }
        drawWindowTitle(ctx, skin, I.x, I.y, this.env.text(11, 0x37));
        }),
      );
    }

    ctx.save();
    ctx.translate(extra, 0);
    const mag = this.mags[this.cursor];
    if (mag) this.drawStatus(ctx, skin, mag);
    if (this.picture) ctx.drawImage(this.picture, MAG_PICTURE.x, MAG_PICTURE.y); // entry 0xC (native size: ASSUMED)
    if (this.state === 'photon' || this.photonAnim.visible) this.drawPhotonList(ctx, skin);
    if (this.state === 'photon' || this.photonInfoAnim.visible) this.drawPhotonInfo(ctx, skin);
    if (this.state === 'pb' || this.pbAnim.visible) {
      const w = gameTextWidth(this.pbLine) + 2 * INSET;
      const P = MAG_PB;
      const pa = this.pbAnim;
      withWindowAnim(ctx, pa, P.x, P.y, w, 14 + 2 * INSET, () => {
        drawWindowFrame(ctx, skin.frame, P.x, P.y, w, 14 + 2 * INSET);
        withElementWipe(pa, P.x + INSET, P.y + INSET, w - 2 * INSET, () =>
          wipeElement(ctx, P.x + INSET, P.y + INSET, ROW, () => drawGameText(ctx, this.pbLine, P.x + INSET, P.y + INSET, '#ffffff')),
        );
      });
    }
    ctx.restore();
  }

  // ASSUMED layout (see the header). The page's rows slide with the page change (the slide is
  // ASSUMED to be a horizontal offset of the rows inside the window).
  private drawStatus(ctx: CanvasRenderingContext2D, skin: WindowSkin, mag: InventoryItem): void {
    const S = MAG_STATUS;
    const a = this.statusAnim;
    withWindowAnim(ctx, a, S.x, S.y, S.w, S.h, () => {
      drawWindowFrame(ctx, skin.frame, S.x, S.y, S.w, S.h);
      withElementWipe(a, S.x + INSET, S.y + INSET, S.w - 2 * INSET, () => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(S.x + INSET, S.y + INSET, S.w - 2 * INSET, S.h - 2 * INSET);
        ctx.clip();
        ctx.translate(this.slide, 0);
        this.drawStatusRows(ctx, mag);
        ctx.restore();
      });
    });
  }

  // The photon list (entry 0xA): the mag's blast rows (a blank row is empty), the cursor bar on
  // its row. The row's text is the blast's name (group 9), an ASSUMED stand-in for the exe's
  // picture of the blast (itemdetail.ts photonRowArgs).
  private drawPhotonList(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    const P = MAG_PHOTON_LIST;
    const a = this.photonAnim;
    const h = 3 * ROW + 2 * INSET;
    withWindowAnim(ctx, a, P.x, P.y, P.w, h, () => {
      drawWindowFrame(ctx, skin.frame, P.x, P.y, P.w, h);
      const x = P.x + INSET;
      const w = P.w - 2 * INSET;
      withElementWipe(a, x, P.y + INSET, w, () => {
        const bar = P.y + INSET + this.photon.cursor * ROW;
        wipeElement(ctx, x, bar, 16, () => drawSelectBar(ctx, skin.bars, x, bar, w, 16));
        magPhotonRows(this.cursorBlasts()).forEach((blast, i) => {
          if (blast === null) return;
          const y = P.y + INSET + i * ROW;
          wipeElement(ctx, x, y, ROW, () => drawGameText(ctx, this.env.text(9, blast), x, y, '#ffffff'));
        });
      });
    });
  }

  // The photon info window (entry 0xB): the cursor blast's description (group 7, blast + 0x27); an
  // empty row shows nothing. ASSUMED: the width is the list's or the text's, whichever is wider.
  private drawPhotonInfo(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    const I = MAG_PHOTON_INFO;
    const a = this.photonInfoAnim;
    const lines = this.photonInfo === '' ? [] : this.photonInfo.split('\n');
    const w = Math.max(MAG_PHOTON_LIST.w, ...lines.map((l) => gameTextWidth(l) + 2 * INSET));
    const h = Math.max(1, lines.length) * ROW + 2 * INSET;
    withWindowAnim(ctx, a, I.x, I.y, w, h, () => {
      drawWindowFrame(ctx, skin.frame, I.x, I.y, w, h);
      withElementWipe(a, I.x + INSET, I.y + INSET, w - 2 * INSET, () =>
        lines.forEach((line, i) => {
          const y = I.y + INSET + i * ROW;
          wipeElement(ctx, I.x + INSET, y, ROW, () => drawGameText(ctx, line, I.x + INSET, y, '#ffffff'));
        }),
      );
    });
  }

  // The status window's rows and stat bars (each text and bar is an element of the wipe).
  private drawStatusRows(ctx: CanvasRenderingContext2D, mag: InventoryItem): void {
    const S = MAG_STATUS;
    const x = S.x + INSET;
    let y = S.y + INSET;
    const t = (s: string, tx: number, ty: number) => wipeElement(ctx, tx, ty, ROW, () => drawGameText(ctx, s, tx, ty, '#ffffff'));
    const line = (label: string, value: string) => {
      t(label, x, y);
      t(value, S.x + S.w - INSET - gameTextWidth(value), y);
      y += ROW;
    };
    if (this.panelPage === MAG_PAGE.stats) {
      // Page 0 (EquipmentStatDisplayObject_Initialize_00726ff0): the six stats, current values.
      const s = this.env.rowContext().stats;
      const current: StatBlock = { atp: s.atp, dfp: s.dfp ?? 0, mst: s.mst, ata: s.ata, evp: s.evp ?? 0, lck: s.lck ?? 0 };
      for (const r of magStatRows(current)) line(`${this.env.text(11, r.label)}:`, String(r.value));
      return;
    }
    if (this.panelPage === MAG_PAGE.photon) {
      // Page 2 (ChallengePlayerListWindow family 0x7267dc): the mag's photon blasts, three rows.
      for (const pb of magPhotonRows(photonBlasts(mag.data))) {
        if (pb !== null) t(this.env.text(9, pb), x, y);
        y += ROW;
      }
      return;
    }
    // Page 1 (0x726864): Level, Synchro, IQ and the four stats with their bars.
    const d = mag.data.data1;
    line(this.env.text(11, 0xc0), String(d[2]));
    line(this.env.text(11, 0xc1), `${mag.data.data2[0]}%`);
    line(this.env.text(11, 0xc2), String(mag.data.data2[1]));
    const real = statLevels(d);
    ['DEF', 'POW', 'DEX', 'MIND'].forEach((label, i) => {
      const v = d[(i + 2) * 2] | (d[(i + 2) * 2 + 1] << 8);
      const shown = this.shown?.[i] ?? real[i];
      // RefreshItemStatDisplay_00726294: a bar still below its level is full.
      const part = shown < real[i] ? 100 : v % 100;
      t(label, x, y);
      const bx = x + 50;
      const bw = S.w - 2 * INSET - 50 - 30;
      wipeElement(ctx, bx, y + 4, 6, () => {
        ctx.fillStyle = '#203040';
        ctx.fillRect(bx, y + 4, bw, 6);
        ctx.fillStyle = '#ffd040';
        ctx.fillRect(bx, y + 4, (bw * part) / 100, 6);
      });
      const lv = String(shown);
      t(lv, S.x + S.w - INSET - gameTextWidth(lv), y);
      y += ROW;
    });
  }

  private drawRow(ctx: CanvasRenderingContext2D, tex: ItemPackTextures, r: ItemRow, x: number, y: number, w: number): void {
    for (const [icon, ox] of [[r.icon1, 0], [r.icon2, ICON]] as const) {
      const uv = ICON_UV[icon];
      if (uv) wipeElement(ctx, x + ox, y, ICON, () => ctx.drawImage(tex.icons, uv[0], uv[1], ICON, ICON, x + ox, y, ICON, ICON));
    }
    if (r.name) wipeElement(ctx, x + 2 * ICON, y, ROW, () => drawGameText(ctx, r.name, x + 2 * ICON, y, r.nameColor));
    if (r.count) {
      const nx = x + w - gameTextWidth(r.count);
      wipeElement(ctx, nx, y, ROW, () => drawGameText(ctx, r.count, nx, y, r.nameColor));
    }
  }
}

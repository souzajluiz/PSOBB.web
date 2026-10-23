// The in-game main menu (Home, "Menu Open/Close" in the key config; F12 is
// "main_menu_2") as PsoBB.exe (Ephinea 1.25.13) draws it.
//
// Owner: the per-player menu object built by FUN_0071a3d0 (+0x2c is the
// ChallengeMenuObject ctor FUN_007338ac). FUN_00733d70 fills it from a layout
// table of {u16 id, u16 pad, u32 sub-table} entries ending at id 0x30:
//   0x009f2f40 (non-android): 2 Item Pack (sub 0x009f2f80), 0 Customize,
//     3 Technique, 5 Chat (sub 0x009f2fb8), 0x23 Team (sub 0x009f2ff0),
//     6 Options, 7 Quit Game;
//   0x009f3020 (android, class flag 0x10 at player + 0x964): the same without
//     Technique.
//   Item Pack: 9 Equip, 0xb Items, 0x17 MAG, 0x1a Trade Window, 0xc Area Map,
//     0xf Quest Board. Chat: 0x11 Shortcut, 0x12 Symbol Chat, 0xe Guild Card,
//     0x13 Simple Mail, 0x16 Info Board, 0x15 Log Window. Team: 0x25 Team
//     Member List, 0x27 Team Log, 0x29 Invite members, 0x2b Team Info,
//     0x2d Point Regist.
//
// Window (FUN_00738e40, vtable 0x00b40c30, update FUN_007390a8, render
// FUN_0073950c) at position table entry 0x1b = (28, 85):
//   - width 116 (0x009f316c, set at 0x00739fbe), items 16 px apart
//     (0x00a9a8e0, set at 0x00739fb4); height = items * 16 + 51 + 39
//     (FUN_00738f70 -> FUN_00739044), lerped over 8 frames (+0x50,
//     FUN_00710ee4);
//   - panel: f256_hyouji.prs texture 13 (FUN_0082bb60(0xd, ...)): an 18 x 28
//     corner (texels 230..248 x 0..28) and a 116 x 23 top (0..116 x 80..103),
//     16 px (or 4 px) strips of 0..116 x 103.. for the body, and a 39 px
//     bottom (0..116 x 135..174) (FUN_007083d4 returns 1, so the second
//     branch of FUN_0073950c is the one used);
//   - labels: texture 2 of TextureEnglish.gvm / texturejapanese.xvm
//     (0x00a9cd48, FUN_0079324c), 98 x 16 texels each at the texel origin in
//     table 0x00971980 (8 bytes per id), drawn from (x + 10, y + 51) +
//     row * 16 (FUN_007399ec -> FUN_0071bc6c);
//   - label color: selected 0xffff6121, open sub-menu 0xff51eaff, disabled
//     0x686868, else white with alpha = age / 4 (age starts at -2 * row and
//     counts up to 4, FUN_00739d14 / FUN_007390a8): rows fade in one after
//     another.
//   - keys (FUN_0073916c): up/down with repeat (6, 5) and SE 0x56f, wrapping;
//     confirm FUN_00739418, cancel FUN_00739468.
// Help window: FUN_0073249c opens a text window (FUN_0073aa40) at table entry
// 0x1c = (17, 312), 206 x 140 (0x00971100) with unitxt group 0x0B [id].
// The 3D view (FUN_00733b2c, "render_player_menu_background"): while the menu
// is open the projection centre moves 80 right and 115.2 up and the view
// scales by 0.75 (0x009712c8, 0x009712cc, FUN_004d434c), in 3 frames
// (0x00971300); it moves back the same way when the menu closes.

import { se, SE } from '../audio/se.ts';
import { drawGameText, gameTextWidth } from './gametext.ts';
import { DISABLED, INSET, ROW as LIST_ROW, TITLE_GAP } from './fieldwindows.ts';
import { drawItemRow, type ItemRow } from './itempack.ts';
import { InfoWindow } from './ingame.ts';
import { drawSelectBar, drawTitlePill, drawWindowFrame, pillWidth, type WindowSkin } from './stage.ts';

export interface MenuEntry {
  id: number;
  sub?: MenuEntry[] | undefined;
}

const e = (id: number, sub?: MenuEntry[]): MenuEntry => ({ id, sub });
const ITEM_PACK = [e(9), e(0xb), e(0x17), e(0x1a), e(0xc), e(0xf)]; // 0x009f2f80
const CHAT = [e(0x11), e(0x12), e(0xe), e(0x13), e(0x16), e(0x15)]; // 0x009f2fb8
const TEAM = [e(0x25), e(0x27), e(0x29), e(0x2b), e(0x2d)]; // 0x009f2ff0
export const MAIN_MENU = [e(2, ITEM_PACK), e(0), e(3), e(5, CHAT), e(0x23, TEAM), e(6), e(7)]; // 0x009f2f40
export const MAIN_MENU_ANDROID = [e(2, ITEM_PACK), e(0), e(5, CHAT), e(0x23, TEAM), e(6), e(7)]; // 0x009f3020

// Label texel origin per id (0x00971980), in texture 2 of texturejapanese.xvm.
const LABEL_UV: Array<[number, number]> = [
  [0, 18], [0, 18], [0, 0], [0, 54], [0, 54], [0, 36], [0, 72], [0, 90], [0, 90], [0, 108],
  [0, 108], [0, 126], [0, 162], [0, 162], [0, 234], [0, 180], [0, 180], [0, 198], [0, 216], [98, 0],
  [98, 0], [98, 18], [98, 72], [0, 144], [0, 144], [98, 36], [98, 54], [98, 54], [98, 54], [98, 54],
  [98, 54], [98, 90], [98, 90], [98, 108], [98, 108], [98, 36], [98, 36], [98, 90], [98, 90], [98, 108],
  [98, 108], [98, 126], [98, 126], [98, 144], [98, 144], [98, 162], [98, 162], [98, 162],
];

export const MENU_POS = { x: 28, y: 85 }; // table entry 0x1b
const MENU_W = 116;
const ROW = 16;
const TOP = 51; // 28 + 23
const BOTTOM = 39;
const HELP = { x: 17, y: 312, w: 206, h: 140 }; // entry 0x1c, 0x00971100

export interface MainMenuTextures {
  panel: CanvasImageSource; // f256_hyouji.prs texture 13
  labels: CanvasImageSource; // texturejapanese.xvm texture 2
}

// Leaf actions the lobby implements; the rest only close the help text.
export type MenuAction = (id: number) => void;

// ValidateMenuItemCondition_00732620: the id shown for an entry (an entry
// that is not available here is replaced by id + 1, its "cannot be used"
// help text) and whether it can be chosen (drawn 0x686868 otherwise).
export type MenuValidate = (id: number) => { id: number; enabled: boolean };

interface ShownEntry extends MenuEntry {
  enabled: boolean;
}

// The cursor kept per menu level (+0x28 + level * 8: cursor, id, table;
// PlayerMenuWindow_SetItemState_00732910 stores it when an entry is chosen).
// A level opens on the kept cursor when it shows the same table
// (PlayerMenuWindow_CheckItemState_00732514), or on the first entry when the
// Cursor Position option is "Non-Saved" (character option mask 0x4 set:
// get_character_option(player, 4) != 0 in
// ChallengeMenuObject_UpdateMenuIndexFromCharacterOption_007332f8, run when
// the menu opens and when a sub-menu opens).
interface KeptCursor {
  cursor: number;
  table: MenuEntry[];
}

export class MainMenu {
  open = false;
  // Optional ValidateMenuItemCondition_00732620 rules (the field sets them).
  validate: MenuValidate | null = null;
  // Cursor Position option (classic/options.ts cursorSaved): true = "Saved".
  cursorSaved: () => boolean = () => true;
  private kept: KeptCursor[] = [];
  private stack: Array<{ entries: ShownEntry[]; cursor: number; table: MenuEntry[] }> = [];
  private ages: number[] = [];
  private height = 0;
  private heightLeft = 0;
  private help: InfoWindow;
  private helpText: (id: number) => string;
  private action: MenuAction;
  // Frames of the view shift (0..3), see the header.
  shift = 0;
  // A leaf window (Item List, Log Window) is up: the panel hides.
  leafOpen = false;

  constructor(helpText: (id: number) => string, action: MenuAction) {
    this.help = new InfoWindow(HELP.x, HELP.y, HELP.w, HELP.h);
    this.helpText = helpText;
    this.action = action;
  }

  private get level() {
    return this.stack[this.stack.length - 1];
  }

  toggle(entries: MenuEntry[]): void {
    if (this.open) return this.close();
    this.open = true;
    this.leafOpen = false;
    this.stack = [];
    this.height = TOP + BOTTOM; // FUN_00738e40: built empty, then filled
    this.show(entries, this.keptCursor(0, entries));
    se(SE.ok);
  }

  close(): void {
    this.open = false;
    this.leafOpen = false;
    this.stack = [];
  }

  private keptCursor(level: number, table: MenuEntry[]): number {
    const k = this.kept[level];
    return this.cursorSaved() && k && k.table === table && k.cursor < table.length ? k.cursor : 0;
  }

  private show(raw: MenuEntry[], cursor: number): void {
    const entries: ShownEntry[] = raw.map((e) => {
      const v = this.validate?.(e.id) ?? { id: e.id, enabled: true };
      return { id: v.id, sub: e.sub, enabled: v.enabled };
    });
    this.stack.push({ entries, cursor, table: raw });
    this.ages = entries.map((_, i) => -2 * i);
    this.heightLeft = 8;
    this.help.set(this.helpText(entries[cursor].id));
  }

  // One game frame (30 fps).
  tick(): void {
    this.shift = Math.max(0, Math.min(3, this.shift + (this.open ? 1 : -1)));
    if (!this.open) return;
    this.ages = this.ages.map((a) => Math.min(4, a + 1));
    const target = this.level.entries.length * ROW + TOP + BOTTOM;
    if (this.heightLeft > 0) {
      this.height += (target - this.height) / this.heightLeft;
      this.heightLeft--;
    } else this.height = target;
    this.help.tick();
  }

  key(e: KeyboardEvent): void {
    if (!this.open || this.leafOpen) return;
    const lv = this.level;
    const n = lv.entries.length;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      lv.cursor = (lv.cursor + (e.key === 'ArrowUp' ? n - 1 : 1)) % n;
      this.help.set(this.helpText(lv.entries[lv.cursor].id));
      se(SE.cursor);
    } else if (e.key === 'Enter') {
      const it = lv.entries[lv.cursor];
      if (!it.enabled) {
        se(SE.buzzer);
        return;
      }
      se(SE.ok);
      this.kept[this.stack.length - 1] = { cursor: lv.cursor, table: lv.table };
      if (it.sub) this.show(it.sub, this.keptCursor(this.stack.length, it.sub));
      else this.action(it.id);
    } else if (e.key === 'Backspace' || e.key === 'Escape') {
      se(SE.cancel);
      if (this.stack.length > 1) {
        this.kept[this.stack.length - 1] = { cursor: lv.cursor, table: lv.table };
        this.stack.pop();
        this.ages = this.level.entries.map(() => 4);
        this.heightLeft = 8;
        this.help.set(this.helpText(this.level.entries[this.level.cursor].id));
      } else this.close();
    }
  }

  // `bottom`: the y shift of the bottom band of a tall fill frame (stage.ts
  // bandsOf); the help window is anchored to the bottom edge, the menu to the top.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: MainMenuTextures, bottom = 0): void {
    if (!this.open || this.leafOpen) return;
    const { x, y } = MENU_POS;
    const h = this.height;
    const img = tex.panel;
    // FUN_0073950c, second branch.
    ctx.drawImage(img, 230, 0, 18, 28, x, y, 18, 28);
    ctx.drawImage(img, 0, 80, 116, 23, x, y + 28, MENU_W, 23);
    let rest = h - TOP - BOTTOM;
    let off = TOP;
    while (rest >= 4) {
      const sh = rest >= 16 ? 16 : 4;
      ctx.drawImage(img, 0, 103, 116, sh, x, y + off, MENU_W, sh);
      off += sh;
      rest -= sh;
    }
    ctx.drawImage(img, 0, 135, 116, 39, x, y + off, MENU_W, BOTTOM);
    const lv = this.level;
    lv.entries.forEach((it, i) => {
      const age = this.ages[i] ?? 4;
      if (age <= 0) return;
      const [u, v] = LABEL_UV[it.id] ?? [0, 0];
      const rx = x + 10;
      const ry = y + TOP + i * ROW;
      if (ry + ROW > y + h) return;
      const color = !it.enabled ? 0x686868 : i === lv.cursor ? 0xff6121 : 0xffffff;
      ctx.save();
      ctx.globalAlpha = Math.min(1, age / 4);
      ctx.drawImage(tintLabel(tex.labels, color), u, v, 98, 16, rx, ry, 98, 16);
      ctx.restore();
    });
    ctx.save();
    ctx.translate(0, bottom);
    this.help.draw(ctx, skin, 0);
    ctx.restore();
  }
}

const labelCache = new WeakMap<object, Map<number, OffscreenCanvas>>();
function tintLabel(img: CanvasImageSource, color: number): CanvasImageSource {
  if (color === 0xffffff) return img;
  let m = labelCache.get(img as object);
  if (!m) labelCache.set(img as object, (m = new Map()));
  let c = m.get(color);
  if (c) return c;
  const w = (img as { width: number }).width;
  const h = (img as { height: number }).height;
  c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  m.set(color, c);
  return c;
}

// Projection change of the 3D view for shift frame f (0..3): NDC offset and
// scale. 80 / 320 and 115.2 / 240 of the half screen; scale 1 - 0.25 f / 3
// (the larger of the two axis factors, FUN_00733b2c).
export function menuViewShift(f: number): { ox: number; oy: number; s: number } {
  const t = f / 3;
  return { ox: (80 / 320) * t, oy: (115.2 / 240) * t, s: 1 - (80 / 320) * t };
}

// ---------------------------------------------------------------------------
// Item List window (main menu > Item Pack > Items, id 0xb): FUN_0075086c ->
// FUN_0075198c(table entry 3 = (13, 256), size 308 x 184 (0x00973ca0), 0x24
// rows) -> FUN_00751a10, the list window class of Ship Select (FUN_00736988)
// titled unitxt 0x0B/0x37 "Item List". Rows 20 px apart, 8 visible. The rows
// are the Item Pack's (ChallengePlayer_CreateItemList_00751ae0, itempack.ts
// itemRows) and are drawn the same way (drawItemRow), so the equipped mark is
// icon 0x0C, not text.
// ---------------------------------------------------------------------------

export const ITEM_LIST = { x: 13, y: 256, w: 308, h: 184, visible: 8 };

export class ItemListWindow {
  rows: ItemRow[] = [];
  cursor = 0;
  private top = 0;
  private frame = 0;
  title: string;
  empty: string;

  constructor(title: string, rows: ItemRow[], empty = '') {
    this.title = title;
    this.rows = rows;
    this.empty = empty;
  }

  key(e: KeyboardEvent): boolean {
    const n = this.rows.length;
    if (e.key === 'Backspace' || e.key === 'Escape') {
      se(SE.cancel);
      return false;
    }
    if (!n) return true;
    if (e.key === 'ArrowUp') this.cursor = (this.cursor + n - 1) % n;
    else if (e.key === 'ArrowDown') this.cursor = (this.cursor + 1) % n;
    else return true;
    se(SE.cursor);
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + ITEM_LIST.visible) this.top = this.cursor - ITEM_LIST.visible + 1;
    return true;
  }

  // icons: f256_hyouji.prs texture 1 (the Item Pack's row icons).
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, icons: CanvasImageSource): void {
    this.frame++;
    const { x, y, w, h } = ITEM_LIST;
    drawWindowFrame(ctx, skin.frame, x, y, w, h);
    const cx = x + INSET;
    const cy = y + INSET + TITLE_GAP;
    const cw = w - 2 * INSET;
    if (!this.rows.length) {
      if (this.empty) drawGameText(ctx, this.empty, cx, cy + 1, DISABLED);
    } else {
      drawSelectBar(ctx, skin.bars, cx, cy + (this.cursor - this.top) * LIST_ROW, cw, 16);
      this.rows.slice(this.top, this.top + ITEM_LIST.visible).forEach((r, i) => drawItemRow(ctx, icons, r, this.frame, cx, cy + i * LIST_ROW, cw));
    }
    const tw = gameTextWidth(this.title);
    drawTitlePill(ctx, skin.frame, x, y - 13, tw, 1);
    drawGameText(ctx, this.title, x + (pillWidth(tw) - tw) / 2, y - 13 + 4 + 1, '#120400');
  }
}

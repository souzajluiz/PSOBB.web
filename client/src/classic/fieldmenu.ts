// The main menu in the field (Home / F12, "Menu Open/Close"), on top of the
// lobby's MainMenu (mainmenu.ts): the same panel, labels and help window, with
// the field's availability rules and the leaf windows the web client has
// (Item Pack > Equip, Item Pack > Items, Item Pack > MAG, Technique, Options).
//
// ValidateMenuItemCondition_00732620 (PsoBB.exe, Ephinea 1.25.13) replaces an
// entry that cannot be used here by id + 1 (its "cannot be used" help text,
// drawn 0x686868):
//   0 Customize, 9 Equip, 0x17 MAG     not in the lobby;
//   3 Technique                       not on a safe map (4); androids have no
//                                      entry (layout 0x009f3020);
//   7 Quit Game                       online it is 8 ("Disconnect ...");
//   0xC Area Map                      not on a safe map;
//   0xF Quest Board                   only while a quest runs (g_QuestStarted);
//   0x1A Trade Window                 only on a safe map online (0x1B);
//   0x23 / 0x25 / 0x27 / 0x29 / 0x2B / 0x2D (Team)  only in a team.
// Safe maps (unknown_safe_maps 0x0097f1c8): 0 Pioneer 2, 0xF lobby, 0x12 Lab,
// 0x2D Pioneer 2 (Episode 4).
// handle_player_menu_select opens the leaf; Backspace in a leaf returns to
// the menu at the same entry. Area Map (0xC) is classic/areamap.ts: a window
// with its own open / close animation that switches the minimap to the full
// map. Quest Board (0xF) is classic/questboard.ts: the quest's board items,
// whose threads run while it stays open.

import { MAIN_MENU, MAIN_MENU_ANDROID, MainMenu, type MainMenuTextures, type MenuEntry } from './mainmenu.ts';
import { EquipMenu, type EquipActions } from './equipmenu.ts';
import { ItemPackMenu, type ItemPackEnv, type ItemPackTextures } from './itempack.ts';
import { TechniqueMenu, type TechMenuEnv } from './techmenu.ts';
import { MagMenu, type MagMenuEnv } from './magmenu.ts';
import { cursorSaved, OptionsMenu, type OptionsEnv } from './options.ts';
import { AREA_MAP_MENU_ID, AreaMapWindow, type AreaMapEnv, type AreaMapTextures } from './areamap.ts';
import { QUEST_BOARD_MENU_ID, QuestBoardWindow, type QuestBoardEnv, type QuestBoardTextures } from './questboard.ts';
import { se, SE } from '../audio/se.ts';
import { windowFrames, type WindowSkin } from './stage.ts';
import { WindowAnim, withWindowAnim } from './windowanim.ts';

type Leaf = ItemPackMenu | EquipMenu | TechniqueMenu | MagMenu | OptionsMenu;

export const SAFE_MAPS = [0x00, 0x0f, 0x12, 0x2d];

export function isSafeMap(area: number): boolean {
  return SAFE_MAPS.includes(area);
}

export interface MenuRules {
  lobby: boolean;
  safe: boolean;
  online: boolean;
  questStarted: boolean;
  inTeam: boolean;
}

// ValidateMenuItemCondition_00732620.
export function validateMenuEntry(id: number, r: MenuRules): { id: number; enabled: boolean } {
  const off = { id: id + 1, enabled: false };
  switch (id) {
    case 0:
    case 9:
    case 0x17:
      return r.lobby ? off : { id, enabled: true };
    case 3:
      return r.safe ? off : { id, enabled: true };
    case 7:
      return { id: r.online ? 8 : 7, enabled: true };
    case 0xc:
      return r.safe ? off : { id, enabled: true };
    case 0xf:
      return r.questStarted ? { id, enabled: true } : off;
    case 0x1a:
      return r.online && r.safe ? { id, enabled: true } : off;
    case 0x23:
    case 0x25:
    case 0x27:
    case 0x29:
    case 0x2b:
    case 0x2d:
      return r.inTeam ? { id, enabled: true } : off;
    default:
      return { id, enabled: true };
  }
}

export interface FieldMenuEnv {
  text: (group: number, index: number) => string;
  rules: () => MenuRules;
  android: () => boolean;
  itemPack: ItemPackEnv;
  equip: EquipActions;
  tech: TechMenuEnv;
  mag: MagMenuEnv;
  options: OptionsEnv;
  areaMap: AreaMapEnv;
  questBoard: QuestBoardEnv;
}

export interface FieldMenuTextures extends ItemPackTextures, AreaMapTextures, QuestBoardTextures {
  menu: MainMenuTextures;
}

export class FieldMenu {
  readonly menu: MainMenu;
  private leaf: Leaf | null = null;
  private env: FieldMenuEnv;
  // The leaf's windows open and close with the list windows' animation
  // (classic/windowanim.ts): fade in, then the 4-frame close about the
  // centre. ASSUMED: one animation for all the windows of a leaf (the client
  // runs one per window, opened together) about the bounds of its frames,
  // silent (the menu's own cursor / decide / cancel sounds play), and the
  // elements' wipe is left out for the menus (their frames and text share
  // one draw path here).
  readonly leafAnim = new WindowAnim(true, false);
  private closingLeaf: Leaf | null = null;
  private leafBounds = { x: 0, y: 0, w: 0, h: 0 };
  // The Area Map window (open, or closing after the menu went away).
  areaMap: AreaMapWindow | null = null;
  // The Quest Board window (open, or closing).
  questBoard: QuestBoardWindow | null = null;
  speed = 1;

  constructor(env: FieldMenuEnv) {
    this.env = env;
    this.menu = new MainMenu(
      (id) => env.text(0x0b, id),
      (id) => this.open(id),
    );
    this.menu.validate = (id) => validateMenuEntry(id, env.rules());
    this.menu.cursorSaved = () => cursorSaved(env.options.flags());
  }

  get isOpen(): boolean {
    return this.menu.open;
  }

  // The menu shifts the 3D view (frames 0..3, mainmenu.ts menuViewShift).
  get shift(): number {
    return this.menu.shift;
  }

  toggle(): void {
    if (this.menu.open) this.close();
    else this.menu.toggle(this.entries());
  }

  // The Area Map window goes away at once (a floor change destroys the
  // field's windows): the full map ends and the menu shows its panel again.
  closeAreaMap(): void {
    if (!this.areaMap) return;
    this.areaMap.dispose();
    this.areaMap = null;
    this.menu.leafOpen = false;
  }

  // The Quest Board window goes away at once too (floor change).
  closeQuestBoard(): void {
    if (!this.questBoard) return;
    this.questBoard.close();
    this.questBoard = null;
    this.menu.leafOpen = false;
  }

  close(): void {
    this.closeLeaf();
    this.areaMap?.anim.close();
    this.questBoard?.close();
    this.menu.close();
  }

  private closeLeaf(): void {
    if (!this.leaf) return;
    if (this.leaf instanceof OptionsMenu || this.leaf instanceof ItemPackMenu) this.leaf.dispose();
    this.closingLeaf = this.leaf;
    this.leaf = null;
    this.leafAnim.close();
  }

  private entries(): MenuEntry[] {
    return this.env.android() ? MAIN_MENU_ANDROID : MAIN_MENU;
  }

  // handle_player_menu_select. Player Status (0x19,
  // ChatShortcutMenuWindow_Constructor_00756ff4) is in no menu table and no
  // caller passes it in this build, so it is not opened here.
  private open(id: number): void {
    if (id === AREA_MAP_MENU_ID) {
      this.areaMap?.dispose();
      this.areaMap = new AreaMapWindow(this.env.areaMap, this.speed, (id) => se(id));
      this.menu.leafOpen = true;
      return;
    }
    if (id === QUEST_BOARD_MENU_ID) {
      this.questBoard?.close();
      this.questBoard = new QuestBoardWindow(this.env.questBoard, this.speed, (id) => se(id));
      this.menu.leafOpen = true;
      return;
    }
    if (id === 9) this.leaf = new EquipMenu({ ...this.env.itemPack, equipActions: this.env.equip });
    else if (id === 0xb) this.leaf = new ItemPackMenu(this.env.itemPack);
    else if (id === 3) this.leaf = new TechniqueMenu(this.env.tech);
    else if (id === 0x17) this.leaf = new MagMenu(this.env.mag);
    else if (id === 6) this.leaf = new OptionsMenu(this.env.options);
    else return;
    this.menu.leafOpen = true;
    this.closingLeaf = null;
    this.leafAnim.open(this.speed);
  }

  // The inventory changed (net/items.ts): rebuild the item list.
  inventoryChanged(): void {
    if (this.leaf instanceof ItemPackMenu || this.leaf instanceof EquipMenu || this.leaf instanceof MagMenu) this.leaf.refresh();
  }

  tick(): void {
    this.menu.tick();
    this.leaf?.tick();
    this.leafAnim.tick(this.speed);
    if (!this.leafAnim.visible) this.closingLeaf = null;
    const map = this.areaMap;
    if (map) {
      map.windowSpeed = this.speed;
      map.tick();
      if (!map.anim.visible) {
        map.dispose();
        this.areaMap = null;
      }
    }
    const board = this.questBoard;
    if (board) {
      board.windowSpeed = this.speed;
      board.tick();
      // State 5: the menu takes over again at the same entry and the window
      // is destroyed (it closes with its animation).
      if (board.finished) {
        board.close();
        if (this.menu.open) this.menu.leafOpen = false;
      }
      if (!board.anim.visible) this.questBoard = null;
    }
  }

  key(e: KeyboardEvent): void {
    if (this.questBoard?.anim.isOpen && !this.questBoard.finished) {
      this.questBoard.key(e);
      return;
    }
    if (this.areaMap?.anim.isOpen) {
      if (!this.areaMap.key(e)) {
        se(SE.cancel);
        this.areaMap.anim.close();
        this.menu.leafOpen = false;
      }
      return;
    }
    if (this.leaf) {
      if (!this.leaf.key(e)) {
        this.closeLeaf();
        this.menu.leafOpen = false;
      }
      return;
    }
    this.menu.key(e);
  }

  // `extra`: virtual width beyond 640 (windows on the right half follow the
  // right edge, classic/ingame.ts anchorX). `bottom`: the y shift of the bottom
  // band of a tall fill frame (stage.ts bandsOf); the main menu stays at the top,
  // the Area Map, the Quest Board and the leaf windows move with the bottom.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: FieldMenuTextures, extra: number, bottom = 0): void {
    this.menu.draw(ctx, skin, tex.menu, bottom);
    ctx.save();
    ctx.translate(0, bottom);
    this.drawBottom(ctx, skin, tex, extra);
    ctx.restore();
  }

  private drawBottom(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: FieldMenuTextures, extra: number): void {
    this.areaMap?.draw(ctx, skin, tex);
    this.questBoard?.draw(ctx, skin, tex);
    const leaf = this.leaf ?? this.closingLeaf;
    if (!leaf || !this.leafAnim.visible) return;
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    windowFrames.record = (x, y, w, h) => rects.push({ x, y, w, h });
    const b = this.leafBounds;
    try {
      withWindowAnim(ctx, this.leafAnim, b.x, b.y, b.w, b.h, () => {
        if (leaf instanceof TechniqueMenu || leaf instanceof OptionsMenu) leaf.draw(ctx, skin, extra);
        else leaf.draw(ctx, skin, tex, extra);
      });
    } finally {
      windowFrames.record = null;
    }
    if (rects.length) {
      const x0 = Math.min(...rects.map((r) => r.x));
      const y0 = Math.min(...rects.map((r) => r.y));
      const x1 = Math.max(...rects.map((r) => r.x + r.w));
      const y1 = Math.max(...rects.map((r) => r.y + r.h));
      this.leafBounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  }
}

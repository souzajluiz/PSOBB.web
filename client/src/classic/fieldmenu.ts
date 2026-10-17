// The main menu in the field (Home / F12, "Menu Open/Close"), on top of the
// lobby's MainMenu (mainmenu.ts): the same panel, labels and help window, with
// the field's availability rules and the leaf windows the web client has
// (Item Pack > Items, Technique).
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
// the menu at the same entry.

import { MAIN_MENU, MAIN_MENU_ANDROID, MainMenu, type MainMenuTextures, type MenuEntry } from './mainmenu.ts';
import { ItemPackMenu, type ItemPackEnv, type ItemPackTextures } from './itempack.ts';
import { TechniqueMenu, type TechMenuEnv } from './techmenu.ts';
import type { WindowSkin } from './stage.ts';

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
  tech: TechMenuEnv;
}

export interface FieldMenuTextures extends ItemPackTextures {
  menu: MainMenuTextures;
}

export class FieldMenu {
  readonly menu: MainMenu;
  private leaf: ItemPackMenu | TechniqueMenu | null = null;
  private env: FieldMenuEnv;

  constructor(env: FieldMenuEnv) {
    this.env = env;
    this.menu = new MainMenu(
      (id) => env.text(0x0b, id),
      (id) => this.open(id),
    );
    this.menu.validate = (id) => validateMenuEntry(id, env.rules());
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

  close(): void {
    this.leaf = null;
    this.menu.close();
  }

  private entries(): MenuEntry[] {
    return this.env.android() ? MAIN_MENU_ANDROID : MAIN_MENU;
  }

  // handle_player_menu_select.
  private open(id: number): void {
    if (id === 0xb) this.leaf = new ItemPackMenu(this.env.itemPack);
    else if (id === 3) this.leaf = new TechniqueMenu(this.env.tech);
    else return;
    this.menu.leafOpen = true;
  }

  // The inventory changed (net/items.ts): rebuild the item list.
  inventoryChanged(): void {
    if (this.leaf instanceof ItemPackMenu) this.leaf.refresh();
  }

  tick(): void {
    this.menu.tick();
    this.leaf?.tick();
  }

  key(e: KeyboardEvent): void {
    if (this.leaf) {
      if (!this.leaf.key(e)) {
        this.leaf = null;
        this.menu.leafOpen = false;
      }
      return;
    }
    this.menu.key(e);
  }

  // `extra`: virtual width beyond 640 (windows on the right half follow the
  // right edge, classic/ingame.ts anchorX).
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, tex: FieldMenuTextures, extra: number): void {
    this.menu.draw(ctx, skin, tex.menu);
    if (this.leaf instanceof ItemPackMenu) this.leaf.draw(ctx, skin, tex, extra);
    else if (this.leaf instanceof TechniqueMenu) this.leaf.draw(ctx, skin, extra);
  }
}

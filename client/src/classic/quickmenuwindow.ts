// The End-key quick menu window (classic): the tab lists of the field (weapon,
// two-handed, traps, technique) and the lobby's motion menu (categories, then the
// emote sub-list). The model (tabs, cursor, rows, gui positions) is in quickmenu.ts.
//
// Exe (PsoBB.exe, dump lines of refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c):
//   - update_quickmenu (711625): the tab state byte 0x1d picks the window. Case 0 is the
//     weapon list (PopulateEquippableWeapons, gui 1), case 9 the technique list
//     (CreateTechniqueListWindow, gui 1), case 0xc the lobby motion categories (gui 0xe1),
//     case 0xe the sub-list (gui 0xe2). Cases 3 and 6 (two-handed, traps) build lists too:
//     not ported (see quickmenu.ts and the DEVLOG).
//   - Decide on a weapon (case 2, 712000 area): IsPlayerActionAllowed, then
//     HandleItemEquipSwap (equipSwap in equipmenu.ts), then the menu closes (flag 1).
//     Not allowed: no swap, the menu stays open.
//   - Decide on a technique (case 0xb): a cast through SendCastTechPacket_0069a2f0; the
//     menu closes when the cast was sent (castTechnique in render/combat.ts).
//   - Decide on a motion (case 0xf -> 0x10 -> 0x11, HandleCharacterOptionSelection_00741e94
//     dump 712415): the sub-list row's value is the callback index into
//     g_CharacterOptionCallbacks_009f35e0 (8-byte entries; each callback is a thunk that calls a
//     virtual method of the player, the emote dispatch). The value is the emote slot, sent as
//     6x58 (formats/emotes.ts emotePayload). The menu closes (state 0x11).
//   - Cancel (key 0xd, SE 0x585): a sub-list closes back to the categories (case 0x10 -> 0xc),
//     a category list closes the menu.

import { menuKeyOf } from '../input/keyconfig.ts';
import { se, SE } from '../audio/se.ts';
import type { CharacterFile, InventoryItem } from '../net/charfile.ts';
import { SLOT_WEAPON } from '../net/items.ts';
import { equipSwap, type EquipActions } from './equipmenu.ts';
import { drawListWindow, listKey } from './fieldwindows.ts';
import type { TechMenuEnv } from './techmenu.ts';
import type { WindowSkin } from './stage.ts';
import {
  QUICK_MENU_GUI,
  QUICK_MENU_LOBBY_CURSOR,
  QUICK_MENU_LIST_W,
  quickMenuMotionCategoryRows,
  quickMenuMotionSubRows,
  quickMenuStartCursor,
  quickMenuStepBack,
  quickMenuStepCursor,
  quickMenuTabFor,
  quickMenuTechRows,
  quickMenuWeaponRows,
  type QuickRow,
} from './quickmenu.ts';

export interface QuickMenuEnv {
  text: (group: number, index: number) => string;
  // The character (null in the lobby): the weapon list and the equip swap read it.
  character: () => CharacterFile | null;
  itemName: (it: InventoryItem) => string;
  // The technique list and the cast (the Technique menu's env).
  tech: TechMenuEnv;
  // The equip actions of the weapon row (equipmenu.ts equipSwap).
  equip: EquipActions;
  // IsPlayerActionAllowed (ASSUMED true in the field until it is ported).
  allowed: () => boolean;
  // The lobby's emote: the 6x58 for a motion sub-list row (emote slot).
  emote?: (slot: number) => void;
}

export interface QuickMenuStart {
  lobby: boolean;
  // The character option cursor mode, bits 16..17 of the option word (0..3).
  mode: number;
  // should_have_traps_quick_menu: battle mode or an Android.
  traps: boolean;
  android: boolean;
}

export class QuickMenu {
  // False once the menu closes (a decided row, or Cancel at the top level).
  open = true;
  readonly lobby: boolean;
  // The tab cursor (0..3) or QUICK_MENU_LOBBY_CURSOR in the lobby.
  private cursor: number;
  private readonly traps: boolean;
  private readonly android: boolean;
  private readonly env: QuickMenuEnv;
  private list = { cursor: 0 };
  // The motion menu: the category whose sub-list is open (null: the categories).
  private category: number | null = null;
  private sub = { cursor: 0 };

  constructor(env: QuickMenuEnv, start: QuickMenuStart) {
    this.env = env;
    this.lobby = start.lobby;
    this.traps = start.traps;
    this.android = start.android;
    this.cursor = start.lobby ? QUICK_MENU_LOBBY_CURSOR : quickMenuStartCursor(start.mode, start.traps, start.android);
  }

  // The tab state (the byte at quick menu +0x1d): 0 weapons, 3 two-handed, 6 traps, 9 techniques, 0x0c motions.
  get tab(): number {
    return quickMenuTabFor(this.cursor);
  }

  // The rows of the list that has the cursor.
  rows(): QuickRow[] {
    const { text } = this.env;
    if (this.lobby) return this.category === null ? quickMenuMotionCategoryRows(text) : quickMenuMotionSubRows(this.category, text);
    switch (this.tab) {
      case 0: {
        const c = this.env.character();
        return c ? quickMenuWeaponRows(c.inventory, (it) => this.env.itemName(it)) : [];
      }
      case 9:
        return quickMenuTechRows(text, this.env.tech.level, this.env.tech.canCast());
      default:
        // Two-handed (3) and traps (6): the lists are not ported (quickmenu.ts).
        return [];
    }
  }

  key(e: { key: string }): void {
    if (!this.open) return;
    const k = menuKeyOf(e);
    if (k === 'cancel') {
      se(SE.cancel);
      if (this.lobby && this.category !== null) this.category = null;
      else this.open = false;
      return;
    }
    if (!this.lobby && (k === 'left' || k === 'right')) {
      this.cursor = k === 'right'
        ? quickMenuStepCursor(this.cursor, this.traps, this.android)
        : quickMenuStepBack(this.cursor, this.traps, this.android);
      this.list.cursor = 0;
      return;
    }
    const items = this.rows();
    const state = this.lobby && this.category !== null ? this.sub : this.list;
    if (listKey(e, items, state) !== 'decide') return;
    const row = items[state.cursor];
    if (!row?.enabled) {
      se(SE.cancel);
      return;
    }
    this.decide(row);
  }

  private decide(row: QuickRow): void {
    if (this.lobby) {
      if (this.category === null) {
        this.category = row.value;
        this.sub.cursor = 0;
        se(SE.ok);
        return;
      }
      se(SE.ok);
      this.env.emote?.(row.value);
      this.open = false;
      return;
    }
    if (this.tab === 0) {
      const c = this.env.character();
      if (!c || !this.env.allowed()) {
        se(SE.cancel);
        return;
      }
      equipSwap(c, SLOT_WEAPON, row.value, this.env.equip);
      se(SE.ok);
      this.open = false;
      return;
    }
    if (this.tab === 9) {
      if (!this.env.tech.canCast() || !this.env.tech.cast?.(row.value)) {
        se(SE.cancel);
        return;
      }
      se(SE.ok);
      this.open = false;
    }
  }

  // The lists at their gui positions (in-game space; the field and the lobby pass the
  // frame's coordinates). Only the list that has the cursor is drawn with its cursor.
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin): void {
    if (!this.open) return;
    if (this.lobby) {
      const cats = quickMenuMotionCategoryRows(this.env.text);
      const pos = QUICK_MENU_GUI.motionList;
      drawListWindow(ctx, skin, pos.x, pos.y, QUICK_MENU_LIST_W, null, cats, this.list.cursor, this.category === null);
      if (this.category !== null) {
        const subPos = QUICK_MENU_GUI.motionSubList;
        drawListWindow(ctx, skin, subPos.x, subPos.y, QUICK_MENU_LIST_W, null, this.rows(), this.sub.cursor, true);
      }
      return;
    }
    const pos = QUICK_MENU_GUI.list;
    drawListWindow(ctx, skin, pos.x, pos.y, QUICK_MENU_LIST_W, null, this.rows(), this.list.cursor, true, (it) => (it as QuickRow).color);
  }
}

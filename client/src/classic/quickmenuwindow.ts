// The End-key quick menu window (classic): the tab lists of the field (weapon,
// two-handed, traps, technique) and the lobby's motion menu (categories, then the
// emote sub-list). The model (tabs, cursor, rows, gui positions) is in quickmenu.ts.
//
// Exe (PsoBB.exe, dump lines of refsrc/original-psobb-client-source/src/Psobb.exe-05112026.c):
//   - update_quickmenu (711625): the tab state byte 0x1d picks the window. Case 0 is the
//     weapon list (PopulateEquippableWeapons, gui 1), case 9 the technique list
//     (CreateTechniqueListWindow, gui 1), case 0xc the lobby motion categories (gui 0xe1),
//     case 0xe the sub-list (gui 0xe2). Case 3 is the tools list (gui 1; the populate is named
//     PopulateTwoHandedWeapons, but it lists tools), case 6 the traps list (gui 1, five rows).
//   - Tools (cases 3..5): Enter uses the tool through ChallengePlayer_HandleItemUsage_0068dbbc
//     (dump 569453), which sends the 6x27 use (net/items.ts use) and the menu closes. Cancel (0xd)
//     plays SE 0x585. The per-frame tool slot action (UpdateQuickMenuToolTechSlotState_00741c08,
//     dump 712261) is not ported.
//   - Traps (cases 6..8, dump 711817): Enter on rows 0..3 sends the 6x60 subcommand 0x83
//     (SinowberillChallengePlayer_HandleSpecialPaletteInput, dump 576703); row 4 places a Battle
//     Mode trap from the stock (CreateSinowberillChallengeEntityManager_006b08b8, dump 602277) and
//     takes one from the stock. The row values and the decide are quickmenu.ts trapDecide.
//   - Weapon compare (case 1, dump 711680): key 0xe toggles the gui 2 compare list (opened by
//     CreateEquipListWindowObject_00725d18). Its stat rows are not ported (names only).
//   - Technique swap (case 0xa, dump 711875): key 0xe marks the selected row, the next press swaps
//     the two rows of the 19-entry order (SwapTechniqueSlots_00741d28, dump 712325).
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

import { KEYS, menuKeyOf } from '../input/keyconfig.ts';
import { se, SE } from '../audio/se.ts';
import type { CharacterFile, InventoryItem } from '../net/charfile.ts';
import { SLOT_WEAPON } from '../net/items.ts';
import { equipSwap, type EquipActions } from './equipmenu.ts';
import { drawListWindow, listKey } from './fieldwindows.ts';
import type { TechMenuEnv } from './techmenu.ts';
import type { WindowSkin } from './stage.ts';
import {
  QM_TOOL_STATE_USE,
  QUICK_MENU_GUI,
  QUICK_MENU_LOBBY_CURSOR,
  QUICK_MENU_LIST_W,
  SWAP_NONE,
  compareToggle,
  quickMenuMotionCategoryRows,
  quickMenuMotionSubRows,
  quickMenuStartCursor,
  quickMenuStepBack,
  quickMenuStepCursor,
  quickMenuTabFor,
  quickMenuTechRows,
  quickMenuWeaponRows,
  techniqueSwapKey,
  toolItemFacts,
  toolTabStep,
  trapDecide,
  trapRows,
  twoHandedTabRows,
  type QuickRow,
  type TrapDecision,
} from './quickmenu.ts';

// The traps tab's facts and actions (quickmenu.ts trapRows / trapDecide). The field fills them
// (render/fieldhud.ts fieldQuickEnv).
export interface QuickTrapEnv {
  // Rows 0..3: the challenge status counts (+0x89c). ASSUMED zeros in the port: it has no
  // Sinowberill challenge player state.
  statuses: () => readonly number[];
  // Row 4: the Battle Mode trap stock.
  stock: () => number;
  // The row is enabled when the map is safe (is_current_map_safe) and not a boss map. The field
  // passes !isSafeMap (the hub list, classic/fieldmenu.ts) and not a boss area.
  safeNotBoss: () => boolean;
  // The area, for the battle map gate of row 4 (battle_spaceship 16, battle_ruins 17).
  map: () => number;
  // The Sinowberill entity manager exists (one at a time). ASSUMED false: the port's trap field
  // holds several traps, so the exe's single manager is not mapped.
  managerExists: () => boolean;
  // Row 4 decide: places a trap from the stock through render/combat.ts placeTrap. False when refused.
  placeStock: () => boolean;
  // Rows 0..3 decide: the 6x60 subcommand 0x83 for (row, count).
  sendStatus: (row: number, count: number) => void;
}

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
  // The tools tab: the use of a tool by its instance id (net/items.ts use, 6x27).
  tools: { use: (itemId: number) => void };
  // is_item_rare for an inventory item (ItemNames.isRare).
  isRare: (it: InventoryItem) => boolean;
  // The traps tab.
  traps: QuickTrapEnv;
  // The technique order (the 19 technique ids the list shows). The swap writes it.
  techOrder: { get: () => readonly number[]; set: (order: number[]) => void };
}

// The default technique order (ASSUMED: the exe's starting order is not traced).
export const DEFAULT_TECH_ORDER: readonly number[] = Array.from({ length: 19 }, (_, i) => i);

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
  // The weapon tab's compare list (gui 2) is open (key 0xe in case 1; cleared on a tab change).
  private compare = false;
  // The technique swap's marked row (the list's +0x8e; SWAP_NONE when none).
  private swapPending = SWAP_NONE;

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
      case 3:
        return this.toolRows();
      case 6:
        return this.trapRowList();
      case 9: {
        // The rows in the player's technique order (the swap rewrites it).
        const base = quickMenuTechRows(text, this.env.tech.level, this.env.tech.canCast());
        return this.env.techOrder.get().map((t) => base[t]).filter((r): r is QuickRow => r !== undefined);
      }
      default:
        return [];
    }
  }

  // The tools tab (update_quickmenu case 3, the populate's filter in quickmenu.ts twoHandedTabRows).
  private toolRows(): QuickRow[] {
    const c = this.env.character();
    if (!c) return [];
    const listed = c.inventory.map((it) => ({
      it,
      instanceId: it.data.id,
      facts: toolItemFacts(it.data.data1, this.env.isRare(it)),
    }));
    return twoHandedTabRows(listed).map((r) => ({ label: this.env.itemName(r.it), value: r.instanceId, enabled: true }));
  }

  // The traps tab (case 6): the five rows of quickmenu.ts trapRows, labelled from unitxt 0x11.
  private trapRowList(): QuickRow[] {
    const t = this.env.traps;
    return trapRows(t.statuses(), t.stock(), t.safeNotBoss()).map((r) => ({
      label: this.env.text(0x11, r.labelId),
      value: r.row,
      enabled: !r.disabled,
    }));
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
    // The End key (keyboard role 0xe, KEYS.symbolChat) closes the open menu: update_quickmenu
    // (dump 711664..711667) tests CheckKeyboardInput_0078fdfc(get_keyboard_controls(), 0xe) once the
    // state is past 2 and jumps to QuickMenu_Terminate.
    if (e.key.toLowerCase() === KEYS.symbolChat) {
      this.open = false;
      return;
    }
    // The compare / swap key is g_KeyboardSharedState[0xe] (SharedInputState_CheckKeyHeld_007c1168,
    // dump 711691), the shared bit Tab (hard-coded key 0x51, ProcessCameraInput_00708bd4 dump 666092)
    // sets: the weapon tab toggles the compare list (case 1), the technique tab swaps two rows
    // (case 0xa). ASSUMED: each press is one event.
    if (!this.lobby && e.key === 'Tab') {
      if (this.tab === 0) {
        this.compare = compareToggle(this.compare).open;
        return;
      }
      if (this.tab === 9) {
        const order = [...this.env.techOrder.get()];
        const step = techniqueSwapKey(this.swapPending, this.list.cursor, order);
        this.swapPending = step.pending;
        if (step.changed) this.env.techOrder.set(step.order);
        return;
      }
    }
    if (!this.lobby && (k === 'left' || k === 'right')) {
      // The tab does not step while the compare list is open (InformationCounterListWindow_HandleInput).
      if (this.compare) return;
      this.cursor = k === 'right'
        ? quickMenuStepCursor(this.cursor, this.traps, this.android)
        : quickMenuStepBack(this.cursor, this.traps, this.android);
      this.list.cursor = 0;
      // A tab change closes the list windows (InformationCounterListWindow_UpdateItemStates).
      this.compare = false;
      this.swapPending = SWAP_NONE;
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
    if (this.tab === 3) {
      // State 5: the use when the action is allowed and the item still exists (toolTabStep).
      const hasItem = this.env.character()?.inventory.some((i) => i.data.id === row.value) ?? false;
      const step = toolTabStep(QM_TOOL_STATE_USE, 0, false, this.env.allowed(), hasItem);
      if (!step.use) {
        se(SE.cancel);
        return;
      }
      this.env.tools.use(row.value);
      se(SE.ok);
      this.open = false;
      return;
    }
    if (this.tab === 6) {
      this.decideTrap(row.value);
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

  // The traps tab's decide (update_quickmenu case 8). The UI gate, the palette block and the
  // can-perform checks are ASSUMED true (the port has no Sinowberill element or palette state).
  private decideTrap(row: number): void {
    const t = this.env.traps;
    const statuses = t.statuses();
    const d: TrapDecision = trapDecide({
      row,
      keyHeld13: false,
      actionAllowed: this.env.allowed(),
      uiGate: true,
      paletteBlocked: false,
      canPerform: true,
      stock: t.stock(),
      status: statuses[row] ?? 0,
      playerId: 0,
      map: t.map(),
      managerExists: t.managerExists(),
    });
    if (d.kind === 'palette' && d.packet) {
      t.sendStatus(d.packet.row, d.packet.count);
    } else if (d.kind === 'trap') {
      if (!t.placeStock()) {
        se(SE.cancel);
        return;
      }
    } else {
      se(SE.cancel);
      return;
    }
    se(SE.ok);
    this.open = false;
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
    // The compare list (gui 2) is drawn empty: its stat rows are not ported (names only).
    if (this.compare && this.tab === 0) {
      const cmp = QUICK_MENU_GUI.compareList;
      drawListWindow(ctx, skin, cmp.x, cmp.y, QUICK_MENU_LIST_W, null, [], 0, false);
    }
  }
}

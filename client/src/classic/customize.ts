// Main menu > Customize (id 0), the action palette editor, as PsoBB.exe (Ephinea 1.25.13)
// runs it: customize_menu_constructor (dump 717277), unknown_handle_customize_menu_inputs
// (717334), GuildCardListWindow_UpdatePaletteUI (717656), customize_menu_action_list_constructor
// (718599), the action grid (render_customize_menu_action_list, dump 718800) and the slot writers
// below. The dump's GuildCardListWindow* names are the customize window's (the names are wrong).
//
// Windows: the slot list (position-table entry 0x0F = (0, 256), GUI table 0x00971f40) and the
// action grid (entry 0x10 = (214, 256)), titled from unitxt group 11 (0x36 and 0x35). The width
// (179) is ASSUMED: the exe passes it through the list constructors, not traced.
//
// Slot list: 3 entries, the palette slots Left, Bottom, Right (cursor value 0, 1, 2; the exe maps
// the value with GuildCardListWindowGetPaletteSlotIndex, 0 -> palette_slots[1], 1 -> [0], else [2];
// the cursor starts on Bottom, +0x61 = 1 in the constructor). Left / Right move it (wrapping); the
// Control key ("Action Palette Change" in the default config) flips the window's own palette
// (+0x62, starts on palette 0; the HUD's flip is not touched). Decide opens the grid; Cancel closes.
//
// Action grid: customize_menu_action_list_fleshie_config (0x009737e0) or _android_config (0x00973880)
// (dump 562653 / 562657): 4-byte {short category, short action} entries, three per grid row, the
// list ends at the row whose first category is 8. Category 0 is an empty cell (the cursor can sit on
// it; Decide or a number key then writes the empty action). The cursor starts at row 0, column 0 each
// time the grid opens; up / down move the row, left / right the column, both wrap (dump 718731).
//   category 2 attack: action 0..2 (unitxt group 7 0x13 + action: Attack, Heavy Attack, Extra Attack)
//   category 3 technique: action 0..18 (unitxt group 5 index, the Technique menu's names)
//   category 4 item: action 0..12 = PALETTE_ITEMS (unitxt group 7 0x16 + action: Monomate .. Trap
//     Vision), action 13..16 = Battle Mode trap types 0..3 (group 7 0x23..0x26; android only)
//   The table holds the attacks and techniques for fleshie, the items for both, and the traps for
//   android only (fleshie has no 13..16); the android table has no technique rows.
//
// Availability (ValidatePlayerAction_006ab474, dump 597294, with the menu open: the exe returns
// early for an open menu, so the challenge checks are skipped): attack 2 needs an equipped weapon;
// a technique needs to be learned (IsTechniqueLevelUnlimited = effective level 0xff); item N needs
// the tool in the bag; trap N needs a trap of that type (player+0x89c+N > 0, the same counter the
// palette shows); a category 0 cell is never available. The grey colour is only drawn. Assignment
// does NOT check availability: the number key path and the Decide path write the row as it is.
//
// Data: the character's action palette in PlayerDispDataV4.config (0xE8 bytes; classic/palette.ts
// parsePalette). Each palette is 0x38 bytes: middle override (4 bytes), then 13 palette_slots of
// 4 bytes {group_1, group_2, u16 flags}. palette_slots[0..2] are the three palette slots
// (bottom, left, right: flat index 0, 1, 2), palette_slots[3..12] the hotbar slots 1..0 (flat 3..12).
//
// The writes (exe rules, read from the code):
//   - hotbar (number key 1..0 in the grid, 717401..717439): unknown_set_palette_slot writes BOTH
//     palettes. If the action equals the slot's current action (palette 0), the slot is cleared.
//     Otherwise every other hotbar slot with the same action is cleared (both palettes) and the
//     slot takes the action (both palettes).
//   - palette slot (Decide in the grid, GuildCardListWindowApplyPaletteSelection_00749d98, 718358):
//     the window's palette only. Toggle clears; otherwise GuildCardListWindowResetDefaultPalette
//     (718426) clears the same action from palette 0's three palette slots (order 0, 2, 1; palette 1
//     is not read there), then the slot is written. Decide then returns to the slot list.
//   - the window's flag +0x24 (sent as 07ED when the window closes, the destructor, dump 717267) is
//     set by every write, and also by Cancel in the grid (717401's state 4 with bit 1: the flag is
//     set and the window goes back to the slot list). A Cancel with nothing done on the slot list
//     closes without sending.
//
// The lobby does not open it (fieldmenu.ts: id 0 is not in the lobby; the lobby's Customize row
// says "Customizing Action Palette is not allowed in the lobby." (unitxt group 11 index 1)).

import { HOTBAR_KEYS, menuKeyOf } from '../input/keyconfig.ts';
import { se, SE } from '../audio/se.ts';
import { PALETTE_ITEMS } from './palette.ts';
import { drawListWindow, INSET, type ListItem, TITLE_GAP } from './fieldwindows.ts';
import type { WindowSkin } from './stage.ts';
import { withElementWipe, type WindowAnim } from './windowanim.ts';

export const CONFIG_SIZE = 0xe8;
const PALETTE_BASE = 4;
const PALETTE_BYTES = 0x38;
const SLOT_COUNT = 13;
export const HOTBAR_FIRST = 3; // flat index of hotbar slot 1
export const SLOT_LIST_POS = { x: 0, y: 256, w: 179 } as const; // GUI entry 0x0F
export const ACTION_LIST_POS = { x: 214, y: 256, w: 179 } as const; // GUI entry 0x10

// Slot list cursor value -> flat palette slot index (GuildCardListWindowGetPaletteSlotIndex): Left, Bottom, Right.
export const SLOT_LIST_FLAT = [1, 0, 2] as const;
// Flat palette slot index -> name (palette.ts: palette_slots[0] is the bottom hexagon, [1] left, [2] right).
export const PALETTE_SLOT_NAMES = ['Bottom', 'Left', 'Right'] as const;

export interface SlotRow {
  group1: number;
  group2: number;
}

// The palette config in a 0xE8 buffer: byte offset of palette `p`'s flat slot `i` (group_1 at +0).
export function slotOffset(p: 0 | 1, i: number): number {
  return PALETTE_BASE + p * PALETTE_BYTES + 4 + 4 * i;
}

export function readRow(config: Uint8Array, p: 0 | 1, i: number): SlotRow {
  const o = slotOffset(p, i);
  return { group1: config[o] ?? 0, group2: config[o + 1] ?? 0 };
}

// unknown_set_palette_slot: group_1 and group_2 only; the flags (disabled bit) are kept.
export function writeRow(config: Uint8Array, p: 0 | 1, i: number, row: SlotRow): void {
  const o = slotOffset(p, i);
  config[o] = row.group1;
  config[o + 1] = row.group2;
}

const EMPTY: SlotRow = { group1: 0, group2: 0 };
const same = (a: SlotRow, b: SlotRow): boolean => a.group1 === b.group1 && a.group2 === b.group2;

// Hotbar assignment (dump 717407..717439). `i` is a flat index in HOTBAR_FIRST..12.
export function assignHotbar(config: Uint8Array, i: number, row: SlotRow): void {
  if (same(row, readRow(config, 0, i))) {
    writeRow(config, 0, i, EMPTY);
    writeRow(config, 1, i, EMPTY);
    return;
  }
  for (let j = HOTBAR_FIRST; j < SLOT_COUNT; j++) {
    if (same(row, readRow(config, 0, j))) {
      writeRow(config, 0, j, EMPTY);
      writeRow(config, 1, j, EMPTY);
    }
  }
  writeRow(config, 0, i, row);
  writeRow(config, 1, i, row);
}

// Palette slot assignment for the window's palette `which` (0 or 1) at flat slot `flat` (0..2).
// The reset compares and clears palette 0 only (718426), then the slot is written in `which`.
export function assignPaletteSlot(config: Uint8Array, which: 0 | 1, flat: number, row: SlotRow): void {
  if (same(row, readRow(config, which, flat))) {
    writeRow(config, which, flat, EMPTY);
    return;
  }
  for (const f of [0, 2, 1]) {
    if (same(row, readRow(config, 0, f))) writeRow(config, 0, f, EMPTY);
  }
  writeRow(config, which, flat, row);
}

// The 07ED frame (send_packet0xed_subcommand7, dump 813897): size 0xF0, command 0xED, flag 7,
// u32 0, then the 0xE8-byte config. newserv on_ED_BB stores it as disp.config (vendor/newserv
// ReceiveCommands.cc case 0x07ED). Returns the body (the connection adds the 8-byte header).
export function customizeBody(config: Uint8Array): Uint8Array {
  if (config.length !== CONFIG_SIZE) throw new Error(`customize config must be ${CONFIG_SIZE} bytes`);
  return new Uint8Array(config);
}

// The action grid tables (exe bytes, read with tools/exedata.py read 009737e0 u 40 and 00973880 u 20).
// Entries are [category, action]; a category 8 entry ends the list. Three entries per grid row.
export const ACTION_TABLE_FLESHIE: ReadonlyArray<readonly [number, number]> = [
  [2, 0], [2, 1], [2, 2], [3, 0], [3, 6], [3, 3], [3, 1], [3, 7], [3, 4], [3, 2], [3, 8], [3, 5], [3, 9], [3, 18], [0, 0],
  [3, 15], [3, 16], [3, 17], [3, 13], [3, 10], [3, 11], [3, 12], [3, 14], [0, 0], [4, 0], [4, 1], [4, 2], [4, 3], [4, 4],
  [4, 5], [4, 6], [4, 7], [4, 8], [4, 9], [4, 10], [0, 0], [4, 11], [4, 12], [0, 0], [8, 0],
];
export const ACTION_TABLE_ANDROID: ReadonlyArray<readonly [number, number]> = [
  [2, 0], [2, 1], [2, 2], [4, 0], [4, 1], [4, 2], [4, 9], [4, 10], [0, 0], [4, 11], [4, 8], [0, 0], [4, 13], [4, 14], [0, 0],
  [4, 15], [4, 16], [0, 0], [8, 0], [0, 0],
];
export const GRID_COLUMNS = 3;
const TERMINATOR = 8;
export const TRAP_ACTION_FIRST = 13; // category 4 action 13..16: Battle Mode trap types 0..3
export const ITEM_COUNT = PALETTE_ITEMS.length; // category 4 action 0..12

// The grid's cells in order (empty cells included), up to the terminator.
export function actionCells(android: boolean): ReadonlyArray<readonly [number, number]> {
  const table = android ? ACTION_TABLE_ANDROID : ACTION_TABLE_FLESHIE;
  const end = table.findIndex(([c]) => c === TERMINATOR);
  return table.slice(0, end < 0 ? table.length : end);
}

export interface CustomizeEnv {
  text: (group: number, index: number) => string;
  // Learned level of a technique, null when not learned (CharacterFile.techLevels).
  learned: (tech: number) => boolean;
  // A palette item (PALETTE_ITEMS index) the bag holds.
  hasItem: (index: number) => boolean;
  // An equipped weapon (ASSUMED: CheckItemStateForUpdate on the weapon slot, not traced).
  weaponEquipped: () => boolean;
  // The Battle Mode trap stock of a type (0..3).
  trapStock: (type: number) => number;
  // An android (player gender_race_job_flags & Android): the android table.
  android: () => boolean;
  // The current 0xE8 config (a copy).
  config: () => Uint8Array;
  // Writes the config back to the HUD and the save copy.
  setConfig: (config: Uint8Array) => void;
  // Window closed with a change: send 07ED (customizeBody).
  save: (config: Uint8Array) => void;
}

// Label of a grid entry (probably_get_item_description, dump 717482): the first line of the unitxt
// text, the name. Attacks: group 7 0x13 + action; techniques: group 5; items and traps: group 7 0x16 + action.
export function actionText(category: number, action: number, text: CustomizeEnv['text']): string {
  const first = (s: string) => (s.split('\n')[0] ?? '').trim();
  if (category === 2) return first(text(7, 0x13 + action));
  if (category === 3) return first(text(5, action));
  if (category === 4) return first(text(7, 0x16 + action));
  return '';
}

// ValidatePlayerAction_006ab474 with the menu open (see the header).
export function actionEnabled(category: number, action: number, env: CustomizeEnv): boolean {
  if (category === 0) return false;
  if (category === 1) return true;
  if (category === 2) return action !== 2 || env.weaponEquipped();
  if (category === 3) return env.learned(action);
  if (category === 4) return action < ITEM_COUNT ? env.hasItem(action) : env.trapStock(action - TRAP_ACTION_FIRST) > 0;
  return false;
}

// Slot list label: the palette slot's name and its action (or '-').
function slotLabel(flat: number, config: Uint8Array, p: 0 | 1, env: CustomizeEnv): string {
  const r = readRow(config, p, flat);
  const act = actionText(r.group1, r.group2, env.text);
  return `${PALETTE_SLOT_NAMES[flat]}: ${act || '-'}`;
}

type Focus = 'slots' | 'actions';

export class CustomizeMenu {
  private focus: Focus = 'slots';
  // +0x61: the slot list cursor value (0 Left, 1 Bottom, 2 Right); starts on Bottom.
  private slot = 1;
  // +0x62: the window's palette.
  private which: 0 | 1 = 0;
  // The grid cursor (+0x85 row, +0x84 column), reset each time the grid opens.
  private row = 0;
  private col = 0;
  // +0x24: a write or a grid Cancel happened; the close sends 07ED.
  private changed = false;
  private env: CustomizeEnv;
  private closed = false;

  constructor(env: CustomizeEnv) {
    this.env = env;
  }

  private slotItems(): ListItem[] {
    const config = this.env.config();
    return SLOT_LIST_FLAT.map((flat, v) => ({ label: slotLabel(flat, config, this.which, this.env), value: v, enabled: true }));
  }

  // The grid as a list (empty cells are not listed); `cursor` is the highlighted entry or -1 on an empty cell.
  private gridItems(): { items: ListItem[]; cursor: number } {
    const items: ListItem[] = [];
    let cursor = -1;
    actionCells(this.env.android()).forEach(([category, action], cell) => {
      if (category === 0) return;
      if (cell === this.row * GRID_COLUMNS + this.col) cursor = items.length;
      items.push({
        label: actionText(category, action, this.env.text),
        value: cell,
        enabled: actionEnabled(category, action, this.env),
      });
    });
    return { items, cursor };
  }

  // The highlighted grid cell's [category, action] (an empty cell is [0, 0]).
  private cell(): readonly [number, number] {
    return actionCells(this.env.android())[this.row * GRID_COLUMNS + this.col] ?? [0, 0];
  }

  // Writes the highlighted grid cell to the slot list's slot (Decide, 718358).
  private assignSlot(): void {
    const config = this.env.config();
    const [category, action] = this.cell();
    assignPaletteSlot(config, this.which, SLOT_LIST_FLAT[this.slot]!, { group1: category, group2: action });
    this.env.setConfig(config);
    this.changed = true;
  }

  // Number key n (0..9 for keys 1..0) writes the highlighted cell to hotbar slot n (717401).
  private assignHotbarKey(n: number): void {
    const config = this.env.config();
    const [category, action] = this.cell();
    assignHotbar(config, HOTBAR_FIRST + n, { group1: category, group2: action });
    this.env.setConfig(config);
    this.changed = true;
  }

  private moveGrid(k: 'up' | 'down' | 'left' | 'right'): void {
    const rows = actionCells(this.env.android()).length / GRID_COLUMNS;
    if (k === 'up') this.row = this.row - 1 < 0 ? rows - 1 : this.row - 1;
    if (k === 'down') this.row = this.row + 1 >= rows ? 0 : this.row + 1;
    if (k === 'left') this.col = this.col - 1 < 0 ? GRID_COLUMNS - 1 : this.col - 1;
    if (k === 'right') this.col = this.col + 1 >= GRID_COLUMNS ? 0 : this.col + 1;
    se(SE.cursor);
  }

  tick(): void {}

  // Returns false when the menu closes (Cancel on the slot list).
  key(e: KeyboardEvent): boolean {
    if (this.closed) return false;
    const k = menuKeyOf(e);
    if (this.focus === 'slots') {
      if (e.key === 'Control' && !e.repeat) {
        this.which = this.which === 0 ? 1 : 0;
        se(SE.cursor);
        return true;
      }
      if (k === 'left' || k === 'right') {
        this.slot = (this.slot + (k === 'right' ? 1 : 2)) % 3;
        se(SE.cursor);
      } else if (k === 'decide') {
        this.focus = 'actions';
        this.row = 0;
        this.col = 0;
        se(SE.ok);
      } else if (k === 'cancel') {
        return this.close();
      }
      return true;
    }
    // The grid: the number keys first (unknown_handle_customize_menu_inputs, state 4).
    const n = HOTBAR_KEYS.findIndex((h) => h !== '' && h === e.key.toLowerCase());
    if (n >= 0) {
      this.assignHotbarKey(n);
      se(SE.ok);
      return true;
    }
    if (k === 'up' || k === 'down' || k === 'left' || k === 'right') {
      this.moveGrid(k);
    } else if (k === 'decide') {
      this.assignSlot();
      this.focus = 'slots';
      se(SE.ok);
    } else if (k === 'cancel') {
      this.changed = true;
      this.focus = 'slots';
      se(SE.cancel);
    }
    return true;
  }

  // The window's destructor (dump 717267): send 07ED when the flag is set.
  private close(): boolean {
    this.closed = true;
    if (this.changed) this.env.save(this.env.config());
    return false;
  }

  // `wipe`: the leaf's opening animation (FieldMenu's leafAnim).
  draw(ctx: CanvasRenderingContext2D, skin: WindowSkin, extra = 0, wipe?: WindowAnim): void {
    const S = SLOT_LIST_POS;
    const A = { ...ACTION_LIST_POS, x: ACTION_LIST_POS.x + extra };
    const grid = this.gridItems();
    withElementWipe(wipe, S.x + INSET, S.y + INSET + TITLE_GAP, S.w - 2 * INSET, () =>
      drawListWindow(ctx, skin, S.x, S.y, S.w, this.env.text(11, 0x36), this.slotItems(), this.slot, this.focus === 'slots'),
    );
    withElementWipe(wipe, A.x + INSET, A.y + INSET + TITLE_GAP, A.w - 2 * INSET, () =>
      drawListWindow(ctx, skin, A.x, A.y, A.w, this.env.text(11, 0x35), grid.items, grid.cursor, this.focus === 'actions'),
    );
  }
}

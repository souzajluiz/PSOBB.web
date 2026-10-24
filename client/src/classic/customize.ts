// Main menu > Customize (id 0), the action palette editor, as PsoBB.exe (Ephinea 1.25.13)
// runs it: customize_menu_constructor (dump 717277), unknown_handle_customize_menu_inputs
// (717334), GuildCardListWindow_UpdatePaletteUI (717656), customize_menu_action_list_constructor
// (718599) and the slot writers below. The dump's GuildCardListWindow* names are the
// customize window's (the names are wrong, the code is the customize window).
//
// Windows: the slot list (position-table entry 0x0F = (0, 256), GUI table 0x00971f40) and the
// action list (entry 0x10 = (214, 256)), both titled from unitxt group 11 (0x36 and 0x35).
// The width (179) is ASSUMED: the exe passes it through the list constructors, not traced.
//
// Data: the character's action palette in PlayerDispDataV4.config (0xE8 bytes; classic/palette.ts
// parsePalette). Each palette is 0x38 bytes: middle override (4 bytes), then 13 palette_slots of
// 4 bytes {group_1, group_2, u16 flags}. palette_slots[0..2] are the three palette slots
// (bottom, left, right: flat index 0, 1, 2), palette_slots[3..12] the hotbar slots 1..0 (flat 3..12).
//
// The writes (exe rules, read from the code, not from a save):
//   - hotbar (number key or Decide on a hotbar slot): unknown_set_palette_slot writes BOTH palettes
//     (717407..717439). If the action equals the slot's current action (palette 0), the slot is
//     cleared. Otherwise every other hotbar slot with the same action is cleared (both palettes)
//     and the slot takes the action (both palettes).
//   - palette slot (GuildCardListWindowApplyPaletteSelection, 718358): only the window's palette
//     (flip state). Toggle clears; otherwise ResetDefaultPalette (718426) clears the same action
//     from the three palette slots of both palettes, then the slot is written.
//   - the window's flag +0x24 is set by every assignment; closing the window with it set sends
//     07ED with the config (send_packet0xed_subcommand7, dump 813897; the call in the window's
//     destructor, dump 717267). The flag is the only trigger; a cancel with no change sends nothing.
//
// The lobby does not open it (fieldmenu.ts: id 0 is not in the lobby; the exe's message
// "Customizing Action Palette is not allowed in the lobby.").

import { HOTBAR_KEYS } from '../input/keyconfig.ts';
import { se, SE } from '../audio/se.ts';
import { PALETTE_ITEMS } from './palette.ts';
import { drawListWindow, INSET, listKey, type ListItem, TITLE_GAP } from './fieldwindows.ts';
import type { WindowSkin } from './stage.ts';
import { withElementWipe, type WindowAnim } from './windowanim.ts';

export const CONFIG_SIZE = 0xe8;
const PALETTE_BASE = 4;
const PALETTE_BYTES = 0x38;
const SLOT_COUNT = 13;
export const HOTBAR_FIRST = 3; // flat index of hotbar slot 1
export const SLOT_LIST_POS = { x: 0, y: 256, w: 179 } as const; // GUI entry 0x0F
export const ACTION_LIST_POS = { x: 214, y: 256, w: 179 } as const; // GUI entry 0x10

// Palette slot names in flat order (palette.ts: bottom, left, right; then the hotbar keys 1..0).
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

const same = (a: SlotRow, b: SlotRow): boolean => a.group1 === b.group1 && a.group2 === b.group2;

// Hotbar assignment (dump 717407..717439). `i` is a flat index in HOTBAR_FIRST..12.
export function assignHotbar(config: Uint8Array, i: number, row: SlotRow): void {
  if (same(row, readRow(config, 0, i))) {
    writeRow(config, 0, i, { group1: 0, group2: 0 });
    writeRow(config, 1, i, { group1: 0, group2: 0 });
    return;
  }
  for (let j = HOTBAR_FIRST; j < SLOT_COUNT; j++) {
    if (same(row, readRow(config, 0, j))) {
      writeRow(config, 0, j, { group1: 0, group2: 0 });
      writeRow(config, 1, j, { group1: 0, group2: 0 });
    }
  }
  writeRow(config, 0, i, row);
  writeRow(config, 1, i, row);
}

// Palette slot assignment for the window's palette `which` (0 or 1, from the flip state). `flat` is 0..2.
export function assignPaletteSlot(config: Uint8Array, which: 0 | 1, flat: number, row: SlotRow): void {
  if (same(row, readRow(config, which, flat))) {
    writeRow(config, which, flat, { group1: 0, group2: 0 });
    return;
  }
  // GuildCardListWindowResetDefaultPalette (718426): palette 0 then 1, slots 0, 2, 1.
  for (const p of [0, 1] as const) {
    for (const f of [0, 2, 1]) {
      if (same(row, readRow(config, p, f))) writeRow(config, p, f, { group1: 0, group2: 0 });
    }
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

// Action rows (customize_menu_action_list_fleshie_config: the attack, technique and item kinds
// the palette shows; the exe's table order is not read, ASSUMED: attacks, techniques, items).
export type ActionKind = 'attack' | 'tech' | 'item';
export interface ActionRow {
  kind: ActionKind;
  row: SlotRow;
  label: string;
  enabled: boolean;
}

export interface CustomizeEnv {
  text: (group: number, index: number) => string;
  // Learned level of a technique, null when not learned (CharacterFile.techLevels).
  learned: (tech: number) => boolean;
  // A palette item (PALETTE_ITEMS index) the bag holds.
  hasItem: (index: number) => boolean;
  // The item's name (ASSUMED: the bag item's name, else a placeholder).
  itemName: (index: number) => string;
  // The current 0xE8 config (a copy) and the palette flip state.
  config: () => Uint8Array;
  flipped: () => boolean;
  // Writes the config back to the HUD and the save copy.
  setConfig: (config: Uint8Array) => void;
  // Window closed with a change: send 07ED (customizeBody).
  save: (config: Uint8Array) => void;
}

export const ATTACK_COUNT = 3;
export const TECH_COUNT = 19;
export const ITEM_COUNT = PALETTE_ITEMS.length;

export function actionRows(env: CustomizeEnv): ActionRow[] {
  const rows: ActionRow[] = [];
  for (let g2 = 0; g2 < ATTACK_COUNT; g2++) {
    // The attack names: unitxt_get_action_description(group_2 + 0x13) (group 11, ASSUMED to be the group of the action names).
    rows.push({ kind: 'attack', row: { group1: 2, group2: g2 }, label: env.text(11, 0x13 + g2), enabled: true });
  }
  for (let t = 0; t < TECH_COUNT; t++) {
    const on = env.learned(t);
    rows.push({ kind: 'tech', row: { group1: 3, group2: t }, label: env.text(5, t), enabled: on });
  }
  for (let i = 0; i < ITEM_COUNT; i++) {
    rows.push({ kind: 'item', row: { group1: 4, group2: i }, label: env.itemName(i), enabled: env.hasItem(i) });
  }
  return rows;
}

// Name of a flat slot's current action (for the slot list).
function slotLabel(flat: number, config: Uint8Array, env: CustomizeEnv, p: 0 | 1): string {
  const name = flat < HOTBAR_FIRST ? PALETTE_SLOT_NAMES[flat] : String((flat - HOTBAR_FIRST + 1) % 10);
  const r = readRow(config, p, flat);
  const act = actionRows(env).find((a) => same(a.row, r));
  return `${name}: ${act ? act.label : '-'}`;
}

type Focus = 'slots' | 'actions';

export class CustomizeMenu {
  private focus: Focus = 'slots';
  private slots = { cursor: 0 };
  private acts = { cursor: 0 };
  private changed = false;
  private env: CustomizeEnv;
  private closed = false;

  constructor(env: CustomizeEnv) {
    this.env = env;
  }

  // The slot list (ASSUMED order): the 3 palette slots, then the hotbar keys 1..0; cursor = flat index.
  private slotFlat(cursor: number): number {
    return cursor;
  }

  private slotItems(): ListItem[] {
    const config = this.env.config();
    const p = this.env.flipped() ? 1 : 0;
    const items: ListItem[] = [];
    for (let c = 0; c < SLOT_COUNT; c++) {
      const flat = this.slotFlat(c);
      items.push({ label: slotLabel(flat, config, this.env, p as 0 | 1), value: flat, enabled: true });
    }
    return items;
  }

  private actionItems(): ListItem[] {
    return actionRows(this.env).map((a, n) => ({ label: a.label, value: n, enabled: a.enabled }));
  }

  // Assigns the action at the action cursor to the selected slot (Decide in the action list).
  private assign(flat: number, act: ActionRow): void {
    const config = this.env.config();
    if (flat < HOTBAR_FIRST) assignPaletteSlot(config, this.env.flipped() ? 1 : 0, flat, act.row);
    else assignHotbar(config, flat, act.row);
    this.env.setConfig(config);
    this.changed = true;
  }

  tick(): void {}

  // Returns false when the menu closes (Cancel in the slot list).
  key(e: KeyboardEvent): boolean {
    if (this.closed) return false;
    const acts = actionRows(this.env);
    if (this.focus === 'actions') {
      // Number keys 1..0 set the hotbar slot directly (unknown_handle_customize_menu_inputs, 717401).
      const n = HOTBAR_KEYS.indexOf(e.key.toLowerCase());
      if (n >= 0 && HOTBAR_KEYS[n]) {
        const act = acts[this.acts.cursor];
        if (act?.enabled) {
          this.assign(HOTBAR_FIRST + n, act);
          se(SE.ok);
        } else se(SE.buzzer);
        return true;
      }
    }
    if (this.focus === 'slots') {
      const r = listKey(e, this.slotItems(), this.slots);
      if (r === 'decide') this.focus = 'actions';
      if (r === 'cancel') return this.close();
      return true;
    }
    const items = this.actionItems();
    const r = listKey(e, items, this.acts);
    if (r === 'decide') {
      const act = acts[this.acts.cursor];
      if (act) this.assign(this.slotFlat(this.slots.cursor), act);
      return true;
    }
    if (r === 'cancel') {
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
    withElementWipe(wipe, S.x + INSET, S.y + INSET + TITLE_GAP, S.w - 2 * INSET, () =>
      drawListWindow(ctx, skin, S.x, S.y, S.w, this.env.text(11, 0x36), this.slotItems(), this.slots.cursor, this.focus === 'slots'),
    );
    withElementWipe(wipe, A.x + INSET, A.y + INSET + TITLE_GAP, A.w - 2 * INSET, () =>
      drawListWindow(ctx, skin, A.x, A.y, A.w, this.env.text(11, 0x35), this.actionItems(), this.acts.cursor, this.focus === 'actions'),
    );
  }
}

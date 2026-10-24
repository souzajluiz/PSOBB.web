// Battle Mode item list rows (the Challenge player's list: the inventory, the five status rows
// with the traps and the sonar, the meseta row), following PsoBB.exe (2026-10-23). Pure logic:
// the row values, the state each selection goes to, the menu row under a status row, and the
// greying. The window itself (its drawing and the key that opens it) is not ported here.
//
// Tags: VERIFIED = read from the exe (dump line in brackets; the dump's names for the
// functions are the ones given, some misnamed); ASSUMED = not traced.
//
// The list (ChallengePlayer_CreateItemList_00751ae0, dump 724311):
//   - one row per inventory item, its value is the item's instance id;
//   - five status rows, values 0xfffffff0 + i (i = 0..4), added by
//     ChallengePlayerListWindowUpdateStatusItem_00737ec4 (dump 704479): row i shows
//     SinowberillChallengePlayer_GetStatusOrAction(+0x89c, i) for i < 4 (the trap stock of
//     trap type i, signed byte, 0..20) and ClampValue(+0x8a0) for i = 4 (the sonar stock,
//     0..99); the label is unitxt group 0x11, string 0x13 + i. A row with a count of 0 or
//     less is not added (the next row takes its slot);
//   - the meseta row, value 0xffffff01 (-255), when the meseta is above 0.
// VERIFIED: the rows with value -16..-1 (0xfffffff0 family) are the ones
// ChallengePlayer_SetMenuItemsDisabled_00751c80 (dump 724449) greys; the meseta row (-255)
// is greyed by ChallengePlayer_SetMenuItemsEnabled_00751bd4 (dump 724376). Both set the
// grey colours (0xffaaaaaa, 0xff909090) and flag 0x80. ASSUMED: the states that call them
// (8 and 10, and the window's first refresh, dump 721470) are the list's reset.
//
// A status row opens a one-row menu (ChallengePlayer_AddMenuItemList_007518b0, dump 724163):
// its row's value is 5 when the status index is 4 (the sonar), else 4 (the trap palette); the
// row's label is unitxt group 0x11, string 0x0f. Its flags are 0x26 (selectable) when the map
// is not in the unknown_safe_maps table and not a boss map, else 6 (greyed). ASSUMED: the
// table's contents are not read here; the battle maps must be outside it for the sonar row to
// be usable at all (the exe's own sonar gate needs them).
//
// The menu's selection (ChallengePlayer_ProcessListSelection_0075158c, dump 723874):
//   0, 1, 2 -> state 5 (use / equip / unequip the item, ChallengePlayer_HandleItemAndArmor)
//   3 -> state 0xc (the item menu)
//   4 -> state 0xf -> 0x10: SinowberillChallengePlayer_HandleSpecialPaletteInput_006959c0 with
//        type = the selected status value & 0xf (= the status index i), see battletraps.ts
//   5 -> state 0x11 -> 0x12: CreateSinowberillChallengeEntityManager_006b08b8 must return 1,
//        then DecrementCounterAndClamp(+0x8a0, 1) (the sonar, quest/battle.ts SonarStock)
//   6 -> state 0x13 (the meseta purchase menu)
//   7 -> state 6 (the selection list)
// The trap and the sonar both need IsPlayerActionAllowed_0068fb00 (the state 0x10 / 0x12 gate).

export const STATUS_ROW_COUNT = 5;
export const STATUS_ROW_VALUE_BASE = 0xfffffff0; // the value of status row 0 (signed -16)
export const SONAR_STATUS_ROW = 4;
export const STATUS_LABEL_GROUP = 0x11;
export const STATUS_LABEL_BASE = 0x13; // the status row's label: group 0x11, 0x13 + row
export const MENU_LABEL = 0x0f; // the one-row menu under a status row: group 0x11, 0x0f
export const MENU_VALUE_TRAP = 4;
export const MENU_VALUE_SONAR = 5;
export const MESETA_ROW_VALUE = 0xffffff01; // the meseta row (-255)

// The value of status row `index` as the list stores it (unsigned 32-bit).
export function statusRowValue(index: number): number {
  return (STATUS_ROW_VALUE_BASE + index) >>> 0;
}

// The status index of a list value, or null when it is not a status row (0xfffffff0..0xffffffff
// in the exe's test: value & 0xfffffff0 == 0xfffffff0; the meseta row -255 is not one).
export function statusRowIndex(value: number): number | null {
  const u = value >>> 0;
  if (((u & 0xfffffff0) >>> 0) !== 0xfffffff0) return null; // the & result is signed in JS
  return u & 0xf;
}

// The value of the one-row menu under a status row (AddMenuItemList: index & 0xf == 4 -> 5).
export function menuValueForStatusRow(index: number): number {
  return (statusRowValue(index) & 0xf) === SONAR_STATUS_ROW ? MENU_VALUE_SONAR : MENU_VALUE_TRAP;
}

export type ListSelectionAction = 'use' | 'itemMenu' | 'trap' | 'sonar' | 'meseta' | 'listInit';

// ProcessListSelection: the state a menu value goes to, as a named action. null for a value the
// exe does not map (the switch has no case for it, so the state stays).
export function listSelectionAction(value: number): ListSelectionAction | null {
  switch (value >>> 0) {
    case 0:
    case 1:
    case 2:
      return 'use';
    case 3:
      return 'itemMenu';
    case MENU_VALUE_TRAP:
      return 'trap';
    case MENU_VALUE_SONAR:
      return 'sonar';
    case 6:
      return 'meseta';
    case 7:
      return 'listInit';
    default:
      return null;
  }
}

// The menu row's flags (AddMenuItemList): selectable when the map is not in the safe table
// and not a boss map. `unlistedMap` is ChallengePlayer's is_current_map_safe() != 0 (the map
// is not in unknown_safe_maps), ASSUMED to be the port's "not a safe map". The status rows get
// the same rule with flag 0x80 (UpdateStatusItem with param_4 = 1, dump 704479; the traps tab's
// refresh ChallengePlayerListWindow_InitializeItems_0074b9d8, dump 719825, passes 1): greyed
// unless selectable here.
export function menuRowSelectable(unlistedMap: boolean, bossMap: boolean): boolean {
  return unlistedMap && !bossMap;
}

// The status row's label and count for the list (UpdateStatusItem: shown only when the count
// is above 0). `raw` is the stored byte or int, read the way the exe reads it.
export interface StatusRowView {
  index: number;
  value: number;
  labelId: number;
  count: number;
}

export function statusRowsView(traps: readonly number[], sonar: number): StatusRowView[] {
  const out: StatusRowView[] = [];
  for (let index = 0; index < STATUS_ROW_COUNT; index++) {
    const count = index === SONAR_STATUS_ROW ? clampSonar(sonar) : trapStatusByte(traps[index] ?? 0);
    if (count <= 0) continue;
    out.push({ index, value: statusRowValue(index), labelId: STATUS_LABEL_BASE + index, count });
  }
  return out;
}

// SinowberillChallengePlayer_GetStatusOrAction_00698984: a signed byte 0..20, else 0 (and the
// exe writes 0 back, which the caller does not model).
export function trapStatusByte(raw: number): number {
  const v = (raw << 24) >> 24;
  return v < 0 || v > 0x14 ? 0 : v;
}

// ClampValue_00697958: the sonar count is 0..99, anything else reads as 0.
export function clampSonar(raw: number): number {
  return raw < 0 || raw > 99 ? 0 : raw;
}

// What a press of a menu row does, given the status row it was opened from. The trap type is
// the status index (the exe reads it from the list's selected value & 0xf).
export type BattleRowAction = { kind: 'trap'; type: number } | { kind: 'sonar' } | null;

export function battleRowAction(statusIndex: number, menuValue: number): BattleRowAction {
  const a = listSelectionAction(menuValue);
  if (a === 'trap') return { kind: 'trap', type: statusIndex & 0xf };
  if (a === 'sonar') return { kind: 'sonar' };
  return null;
}

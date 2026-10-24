// Function-key shortcuts of the keyboard (PsoBB.exe 1.25.13): F1..F12 are the
// key config's bindings 20..31 (keyconfig.ts BINDING), read through the live config.
//
// unknown_handle_fkey_inputs (named dump Psobb.exe-05112026.c line 682260; the dump's
// addresses are not in the names, so the dump line is the citation) returns the menu
// entry a function key opens, or 0x30 for none:
//   - Ctrl or Alt held: none (Alt+F1..F12 are the lobby's emotes, emotes.ts);
//   - Shift: with the character option 0x2000000 clear, Shift must NOT be held; with it
//     set, Shift must be held (the chat shortcut form). The port has no such option
//     flag yet, so the option is taken as clear (ASSUMED);
//   - F1 function_key_info_menu toggles the F-key help list (flag 0x200 at the player
//     menu object, unknown_render_help_menu; the 0x400 branch when CanEnter is non-zero
//     is not read by the render): the field draws it (render/fieldhud.ts, ASSUMED geometry);
//   - F2 equipment_menu_shortcut -> 0x09 (Equip), F3 technique_menu_shortcut -> 0x03
//     (Technique), F4 mag_menu_shortcut -> 0x17 (MAG), F5 guild_card_menu_shortcut ->
//     0x0E (Guild Card), F6 simple_mail_menu_shortcut -> 0x13 (Simple Mail),
//     F7 symbol_chat_menu_shortcut -> 0x12 (Symbol Chat), F8 team_menu_shortcut -> 0x25
//     (Team Member List);
//   - F9 team_chat (dump 678299, TeamChatMenu_Update_00717260), F10 team_chat_toggle
//     (678385, the same window), F11 keyboard_controls_toggle (697159,
//     ChallengePlayerInfoWindow_UpdateTextInputHandler_0072f130, character option
//     0x1000000): not ported (no team chat window in the port's chat line, no mouse
//     control mode);
//   - F12 main_menu_2 opens and closes the main menu, as Home does (no shift test).
// The entry then goes through ChallengeMenuObject_HandleItemSelection_00733714 ->
// ValidateMenuItemCondition_00732620 -> handle_player_menu_select, so a disabled entry
// does nothing (classic/fieldmenu.ts validateMenuEntry).

import { bindingKey, BINDING } from './keyconfig.ts';

export const FKEY_COUNT = 12;

// The exe's input enum names of F1..F12 (unknown_input_type 20..31), index n - 1.
export const FKEY_ROLES: readonly string[] = [
  'function_key_info_menu',
  'equipment_menu_shortcut',
  'technique_menu_shortcut',
  'mag_menu_shortcut',
  'guild_card_menu_shortcut',
  'simple_mail_menu_shortcut',
  'symbol_chat_menu_shortcut',
  'team_menu_shortcut',
  'team_chat',
  'team_chat_toggle',
  'keyboard_controls_toggle',
  'main_menu_2',
];

// The menu entry id each shortcut opens (handle_player_menu_select ids), by F-key number.
export const FKEY_MENU_ID: Readonly<Record<number, number>> = { 2: 0x09, 3: 0x03, 4: 0x17, 5: 0x0e, 6: 0x13, 7: 0x12, 8: 0x25 };

// The leaves the field menu has (classic/fieldmenu.ts open()); the others are not in it.
// The Home leaves 0x0E / 0x12 / 0x13 / 0x25 are shared with the lobby (classic/homeleaves.ts).
export const FIELD_SHORTCUT_LEAVES: ReadonlySet<number> = new Set([0x09, 0x03, 0x17, 0x0e, 0x12, 0x13, 0x25]);
// The leaves the lobby's Home menu has for a shortcut (classic/lobby.ts menuAction).
export const LOBBY_SHORTCUT_LEAVES: ReadonlySet<number> = new Set([0x0e, 0x12, 0x13, 0x25]);

// The DOM keys bound to F1..F12 in the config in use (index n - 1; '' when unbound).
export function functionKeyNames(): string[] {
  return Array.from({ length: FKEY_COUNT }, (_, i) => bindingKey(BINDING.functionKeyInfo + i));
}

// The F-key number (1..12) a key is, by the bound names; 0 when it is not a function key.
export function functionKeyNumber(key: string, names: readonly string[]): number {
  const k = key.toLowerCase();
  if (!k) return 0;
  const i = names.indexOf(k);
  return i < 0 ? 0 : i + 1;
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type FKeyAction = { kind: 'menu'; id: number } | { kind: 'mainMenu' } | { kind: 'help' };

// What a function key does (null for none). shiftOption is the character option
// 0x2000000 (Shift is then required, not forbidden).
export function functionKeyAction(e: KeyLike, names: readonly string[], shiftOption = false): FKeyAction | null {
  const n = functionKeyNumber(e.key, names);
  if (!n) return null;
  if (n === FKEY_COUNT) return { kind: 'mainMenu' };
  if (e.ctrlKey || e.altKey) return null;
  if (shiftOption ? !e.shiftKey : e.shiftKey) return null;
  if (n === 1) return { kind: 'help' };
  const id = FKEY_MENU_ID[n];
  return id === undefined ? null : { kind: 'menu', id };
}

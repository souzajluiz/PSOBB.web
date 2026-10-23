// Blue Burst's keyboard configuration (the key config window and the input
// layer that reads it).
//
// The key config is 0x16C bytes, kept per account in the system file and
// sent with the character data: 00E7 carries the system file at 0x2EA4, so
// the key config is at 0x2FB8 (newserv PSOBBBaseSystemFile.key_config at
// 0x114). The client's copy is g_pKeyTeamConfig->key_config (exe
// send_packet0xed_subcommand4 sends it from there). It is 45 bindings of
// {u32 type, u32 key code} (type 0 = keyboard key, 1 = control button) and a
// marker entry (entry 45, type 1). ValidateAndApplyKeyboardConfig_007917c0
// (exe 0x007917c0) resets the config to the default when a type is above 1
// or the marker is not 1.
//
// The window's rows are 20 bindings (exe KeyboardConfigObject labels, table
// 0x0097b500 of {binding, unitxt group 0 index} pairs; the unitxt index is the
// second word, see classic/keyconfig.ts):
//
//   0 Move Forward  W      1 Move Backward  S      2 Move Left  A
//   3 Move Right    D      4 Lock Move Forward -  5 Lock Walk Forward -
//   6 Decide        Enter  7 Cancel    Backspace (not changeable in the window)
//   8 Menu Open/Close Home 9 Input Start Space
//   10..13 Select Up / Down / Left / Right: arrows
//   14 Symbol Chat Open End
//   15 Action Palette Middle Down   16 Action Palette Left Left
//   17 Action Palette Right  Right  18 Action Palette Change Ctrl (0x56)
//   19 Camera Up
//   20..31 F1..F12 (the function key shortcuts), 35..44 1..0 (hotbar)
//
// The key codes are the client's own (enum pso_keycode, table 0x0097b5e0 of
// {u32 code, wide name}, see KEY_NAMES): a..z = 0x10..0x29, 1..0 = 0x2A..0x33,
// F1..F12 = 0x40..0x4B, Home 6, End 7, Backspace 0x50, Space 0x59, arrows
// left / down / up / right = 0x5C..0x5F, Enter 0x61, Ctrl 0x56, Alt 0x57.
//
// The palette keys pick palette_slots[] of the current action palette: Left
// = slot 2 (the dump's "main slot left pressed" reads
// get_palette_slot_first_byte(player, 2)), Middle = slot 1, Right = slot 3
// (1-based, as the client numbers them).
//
// The values of KEYS are DOM KeyboardEvent.key names, lower-cased, as the views
// keep them in their held-key sets. They follow the bindings: applyKeyConfig
// rewrites KEYS and PALETTE_KEYS in place, so a reader that takes KEYS.x at
// call time sees the new key (module-load copies go stale).

// --- the key code table (0x0097b5e0) ---------------------------------------
// {code, name}. The exe's text has a ": " prefix, which keyCaption adds back.
export const KEY_NAMES: ReadonlyArray<readonly [number, string]> = [
  [0x05, 'FN'], [0x06, 'HOME'], [0x07, 'END'], [0x08, 'PAGE UP'], [0x09, 'PAGE DOWN'], [0x0a, 'SCROLL LOCK'],
  [0x10, 'a'], [0x11, 'b'], [0x12, 'c'], [0x13, 'd'], [0x14, 'e'], [0x15, 'f'], [0x16, 'g'],
  [0x17, 'h'], [0x18, 'i'], [0x19, 'j'], [0x1a, 'k'], [0x1b, 'l'], [0x1c, 'm'], [0x1d, 'n'],
  [0x1e, 'o'], [0x1f, 'p'], [0x20, 'q'], [0x21, 'r'], [0x22, 's'], [0x23, 't'], [0x24, 'u'],
  [0x25, 'v'], [0x26, 'w'], [0x27, 'x'], [0x28, 'y'], [0x29, 'z'],
  [0x2a, '1'], [0x2b, '2'], [0x2c, '3'], [0x2d, '4'], [0x2e, '5'], [0x2f, '6'], [0x30, '7'],
  [0x31, '8'], [0x32, '9'], [0x33, '0'], [0x34, '-'], [0x35, '^'], [0x36, '\\'], [0x37, '@'],
  [0x38, '['], [0x39, ';'], [0x3a, ':'], [0x3c, ','], [0x3d, '.'], [0x3e, '/'],
  [0x40, 'F1'], [0x41, 'F2'], [0x42, 'F3'], [0x43, 'F4'], [0x44, 'F5'], [0x45, 'F6'],
  [0x46, 'F7'], [0x47, 'F8'], [0x48, 'F9'], [0x49, 'F10'], [0x4a, 'F11'], [0x4b, 'F12'],
  [0x4c, 'ESC'], [0x4d, 'INSERT'], [0x4e, 'DELETE'], [0x50, 'BACK SPACE'], [0x51, 'TAB'],
  [0x52, 'BACKSLASH'], [0x53, 'CAPS LOCK'], [0x54, 'L SHIFT'], [0x55, 'R SHIFT'], [0x56, 'CTRL'],
  [0x57, 'ALT'], [0x59, 'SPACE'], [0x5c, '←'], [0x5d, '↓'], [0x5e, '↑'], [0x5f, '→'],
  [0x61, 'ENTER'], [0x62, '*'], [0x63, '+'], [0x64, '-'], [0x66, 'NUM LOCK'],
  [0x67, '0(TENKEY)'], [0x68, '1(TENKEY)'], [0x69, '2(TENKEY)'], [0x70, '3(TENKEY)'], [0x71, '4(TENKEY)'],
  [0x72, '5(TENKEY)'], [0x73, '6(TENKEY)'], [0x74, '7(TENKEY)'], [0x75, '8(TENKEY)'], [0x76, '9(TENKEY)'],
];

const NAME_OF = new Map<number, string>(KEY_NAMES);

// The text the window draws for a key code (the exe's table text).
export function keyCaption(code: number): string {
  const n = NAME_OF.get(code);
  return n === undefined ? '' : `: ${n}`;
}

// DOM KeyboardEvent.key (lower-cased) of a key code that has one.
const DOM_NAMES: ReadonlyMap<number, string> = new Map<number, string>([
  [0x06, 'home'], [0x07, 'end'], [0x08, 'pageup'], [0x09, 'pagedown'], [0x0a, 'scrolllock'],
  [0x34, '-'], [0x35, '^'], [0x36, '\\'], [0x37, '@'], [0x38, '['], [0x39, ';'], [0x3a, ':'],
  [0x3c, ','], [0x3d, '.'], [0x3e, '/'],
  [0x4c, 'escape'], [0x4d, 'insert'], [0x4e, 'delete'], [0x50, 'backspace'], [0x51, 'tab'],
  [0x53, 'capslock'], [0x54, 'shift'], [0x55, 'shift'], [0x56, 'control'], [0x57, 'alt'],
  [0x59, ' '], [0x5c, 'arrowleft'], [0x5d, 'arrowdown'], [0x5e, 'arrowup'], [0x5f, 'arrowright'],
  [0x61, 'enter'], [0x62, '*'], [0x63, '+'], [0x64, '-'], [0x66, 'numlock'],
]);

export function domKeyOfCode(code: number): string {
  if (code >= 0x10 && code <= 0x29) return String.fromCharCode(0x61 + code - 0x10);
  if (code >= 0x2a && code <= 0x32) return String(code - 0x29);
  if (code === 0x33) return '0';
  if (code >= 0x40 && code <= 0x4b) return `f${code - 0x3f}`;
  return DOM_NAMES.get(code) ?? '';
}

// The key code a DOM key name is bound with (the first code of the table that
// has that name; the exe scans the table in order). Keys with no code are null.
const CODE_OF_DOM = new Map<string, number>();
for (const [code] of KEY_NAMES) {
  const k = domKeyOfCode(code);
  if (k && !CODE_OF_DOM.has(k)) CODE_OF_DOM.set(k, code);
}

export function codeOfDomKey(key: string): number | null {
  return CODE_OF_DOM.get(key.toLowerCase()) ?? null;
}

// KeyboardEvent.key / .code of a game key, for the on-screen controls that
// send key events of their own.
export function domEventOf(key: string): { key: string; code: string } {
  if (/^[a-z]$/.test(key)) return { key, code: `Key${key.toUpperCase()}` };
  if (/^[0-9]$/.test(key)) return { key, code: `Digit${key}` };
  if (/^f\d+$/.test(key)) return { key: key.toUpperCase(), code: key.toUpperCase() };
  const named: Record<string, { key: string; code: string }> = {
    ' ': { key: ' ', code: 'Space' },
    enter: { key: 'Enter', code: 'Enter' },
    backspace: { key: 'Backspace', code: 'Backspace' },
    home: { key: 'Home', code: 'Home' },
    end: { key: 'End', code: 'End' },
    pageup: { key: 'PageUp', code: 'PageUp' },
    pagedown: { key: 'PageDown', code: 'PageDown' },
    escape: { key: 'Escape', code: 'Escape' },
    tab: { key: 'Tab', code: 'Tab' },
    insert: { key: 'Insert', code: 'Insert' },
    delete: { key: 'Delete', code: 'Delete' },
    control: { key: 'Control', code: 'ControlLeft' },
    shift: { key: 'Shift', code: 'ShiftLeft' },
    alt: { key: 'Alt', code: 'AltLeft' },
    arrowup: { key: 'ArrowUp', code: 'ArrowUp' },
    arrowdown: { key: 'ArrowDown', code: 'ArrowDown' },
    arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft' },
    arrowright: { key: 'ArrowRight', code: 'ArrowRight' },
  };
  return named[key] ?? { key, code: '' };
}

// --- the 0x16C-byte config ---------------------------------------------------
export const CONFIG_SIZE = 0x16c;
export const CONFIG_ENTRIES = 45; // 0x2D bindings; entry 45 is the marker
export const CONFIG_IN_CHARACTER = 0x2fb8; // 00E7: system file 0x2EA4 + key_config 0x114

// The bindings of the window (exe labels table, binding index = row value).
export const BINDING = {
  moveForward: 0,
  moveBackward: 1,
  moveLeft: 2,
  moveRight: 3,
  lockMoveForward: 4,
  lockWalkForward: 5,
  decide: 6,
  cancel: 7,
  menu: 8,
  inputStart: 9,
  selectUp: 10,
  selectDown: 11,
  selectLeft: 12,
  selectRight: 13,
  symbolChat: 14,
  paletteMiddle: 15,
  paletteLeft: 16,
  paletteRight: 17,
  paletteChange: 18,
  camera: 19,
} as const;

// The four Default presets, exe data at 0x0097aca0 (0x16C bytes each, read
// with tools/exedata.py-style PE reads; every entry is type 0 and the marker is
// 1). Index 0 is "Default 1" and is the default config (it equals newserv's
// DEFAULT_KEY_CONFIG). Presets 1 and 2 move with I/J/K/L and the arrows; preset
// 3 moves with the numpad 8/4/2/6. The menu keys (Decide Enter, Cancel
// Backspace, Select arrows) and the hotbar are the same in all four.
const PRESET_CODES: readonly (readonly number[])[] = [
  [
    0x26, 0x22, 0x10, 0x13, 0x00, 0x00, 0x61, 0x50, 0x06, 0x59, 0x5e, 0x5d, 0x5c, 0x5f, 0x07, 0x5d, 0x5c, 0x5f, 0x56, 0x5e,
    0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x00, 0x00, 0x00, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e,
    0x2f, 0x30, 0x31, 0x32, 0x33,
  ],
  [
    0x26, 0x22, 0x10, 0x13, 0x00, 0x00, 0x61, 0x50, 0x06, 0x59, 0x5e, 0x5d, 0x5c, 0x5f, 0x07, 0x1a, 0x19, 0x1b, 0x56, 0x18,
    0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x00, 0x00, 0x00, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e,
    0x2f, 0x30, 0x31, 0x32, 0x33,
  ],
  [
    0x5e, 0x5d, 0x5c, 0x5f, 0x00, 0x00, 0x61, 0x50, 0x06, 0x59, 0x5e, 0x5d, 0x5c, 0x5f, 0x07, 0x22, 0x10, 0x13, 0x56, 0x26,
    0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x00, 0x00, 0x00, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e,
    0x2f, 0x30, 0x31, 0x32, 0x33,
  ],
  [
    0x75, 0x69, 0x71, 0x73, 0x00, 0x00, 0x61, 0x50, 0x06, 0x59, 0x5e, 0x5d, 0x5c, 0x5f, 0x07, 0x5d, 0x5c, 0x5f, 0x56, 0x5e,
    0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x00, 0x00, 0x00, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e,
    0x2f, 0x30, 0x31, 0x32, 0x33,
  ],
];

export const PRESET_COUNT = PRESET_CODES.length;

// Preset n (0..3) as a 0x16C-byte config (exe FUN_00792f98 copies 0x168 bytes
// from 0x0097aca0 + n * 0x16C and sets the marker to 1).
export function presetKeyConfig(n: number): Uint8Array {
  const cfg = new Uint8Array(CONFIG_SIZE);
  const dv = new DataView(cfg.buffer);
  const codes = PRESET_CODES[n] ?? PRESET_CODES[0];
  codes.forEach((code, i) => dv.setUint32(i * 8 + 4, code, true));
  dv.setUint32(CONFIG_ENTRIES * 8, 1, true); // the marker
  return cfg;
}

export function defaultKeyConfig(): Uint8Array {
  return presetKeyConfig(0);
}

export interface Binding {
  type: number; // 0 keyboard, 1 control button
  code: number;
}

export function readBinding(cfg: Uint8Array, i: number): Binding {
  const dv = new DataView(cfg.buffer, cfg.byteOffset, cfg.byteLength);
  return { type: dv.getUint32(i * 8, true), code: dv.getUint32(i * 8 + 4, true) };
}

export function writeBinding(cfg: Uint8Array, i: number, b: Binding): void {
  const dv = new DataView(cfg.buffer, cfg.byteOffset, cfg.byteLength);
  dv.setUint32(i * 8, b.type, true);
  dv.setUint32(i * 8 + 4, b.code, true);
}

// ValidateAndApplyKeyboardConfig_007917c0: a config that is not valid is the
// default one.
export function normalizeKeyConfig(cfg: Uint8Array | null | undefined): Uint8Array {
  if (!cfg || cfg.length < CONFIG_SIZE) return defaultKeyConfig();
  for (let i = 0; i < CONFIG_ENTRIES; i++) if (readBinding(cfg, i).type > 1) return defaultKeyConfig();
  // The marker is the u32 at 360 alone (the last 4 bytes), not a whole binding.
  if (new DataView(cfg.buffer, cfg.byteOffset, cfg.byteLength).getUint32(CONFIG_ENTRIES * 8, true) !== 1) return defaultKeyConfig();
  return cfg.slice(0, CONFIG_SIZE);
}

// The key config of a 00E7 character record (null when it is too short).
export function keyConfigFromCharacter(full: Uint8Array | null | undefined): Uint8Array | null {
  if (!full || full.length < CONFIG_IN_CHARACTER + CONFIG_SIZE) return null;
  return full.slice(CONFIG_IN_CHARACTER, CONFIG_IN_CHARACTER + CONFIG_SIZE);
}

// Writes a config into a 00E7 character record in place.
export function writeKeyConfigToCharacter(full: Uint8Array | null | undefined, cfg: Uint8Array): void {
  if (!full || full.length < CONFIG_IN_CHARACTER + CONFIG_SIZE) return;
  full.set(cfg.subarray(0, CONFIG_SIZE), CONFIG_IN_CHARACTER);
}

// --- the live keys -------------------------------------------------------------

export type KeyRole =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'decide'
  | 'cancel'
  | 'menu'
  | 'chat'
  | 'symbolChat'
  | 'selectUp'
  | 'selectDown'
  | 'selectLeft'
  | 'selectRight'
  | 'paletteMiddle'
  | 'paletteLeft'
  | 'paletteRight'
  | 'paletteChange'
  | 'camera';

// The binding index each key role reads.
const ROLE_BINDING: Record<KeyRole, number> = {
  moveForward: BINDING.moveForward,
  moveBackward: BINDING.moveBackward,
  moveLeft: BINDING.moveLeft,
  moveRight: BINDING.moveRight,
  decide: BINDING.decide,
  cancel: BINDING.cancel,
  menu: BINDING.menu,
  chat: BINDING.inputStart,
  symbolChat: BINDING.symbolChat,
  selectUp: BINDING.selectUp,
  selectDown: BINDING.selectDown,
  selectLeft: BINDING.selectLeft,
  selectRight: BINDING.selectRight,
  paletteMiddle: BINDING.paletteMiddle,
  paletteLeft: BINDING.paletteLeft,
  paletteRight: BINDING.paletteRight,
  paletteChange: BINDING.paletteChange,
  camera: BINDING.camera,
};

// Current DOM key names per role (rewritten by applyKeyConfig).
export const KEYS: Record<KeyRole, string> = {
  moveForward: '',
  moveBackward: '',
  moveLeft: '',
  moveRight: '',
  decide: '',
  cancel: '',
  menu: '',
  chat: '',
  symbolChat: '',
  selectUp: '',
  selectDown: '',
  selectLeft: '',
  selectRight: '',
  paletteMiddle: '',
  paletteLeft: '',
  paletteRight: '',
  paletteChange: '',
  camera: '',
};

// Action palette keys and the palette_slots[] index (0-based) each one uses.
// Rewritten in place by applyKeyConfig.
export const PALETTE_KEYS: [string, number][] = [
  ['', 1],
  ['', 0],
  ['', 2],
];

// The bottom hotbar's keys 1..0 (bindings 35..44, palette_bar_slot_1.._0 at dump 86193):
// HOTBAR_KEYS[i] is the key of hotbar slot i (hotbar_slots[i], key i + 1, key 0 = slot 10).
// Rewritten in place by applyKeyConfig; '' when the binding has no key.
export const HOTBAR_BINDING_FIRST = 35;
export const HOTBAR_KEYS: string[] = Array.from({ length: 10 }, () => '');

let active: Uint8Array = defaultKeyConfig();

// The config in use (a copy).
export function currentKeyConfig(): Uint8Array {
  return active.slice();
}

// Makes cfg the config in use (an invalid or missing one becomes the default)
// and points KEYS / PALETTE_KEYS at its keys. Returns the config in use.
export function applyKeyConfig(cfg: Uint8Array | null | undefined): Uint8Array {
  active = normalizeKeyConfig(cfg);
  const keyOf = (i: number): string => {
    const b = readBinding(active, i);
    return b.type === 0 ? domKeyOfCode(b.code) : '';
  };
  for (const role of Object.keys(ROLE_BINDING) as KeyRole[]) KEYS[role] = keyOf(ROLE_BINDING[role]);
  PALETTE_KEYS[0] = [KEYS.paletteLeft, 1];
  PALETTE_KEYS[1] = [KEYS.paletteMiddle, 0];
  PALETTE_KEYS[2] = [KEYS.paletteRight, 2];
  for (let i = 0; i < HOTBAR_KEYS.length; i++) HOTBAR_KEYS[i] = keyOf(HOTBAR_BINDING_FIRST + i);
  return currentKeyConfig();
}

applyKeyConfig(null);

// The menu key a KeyboardEvent is, by the live bindings. The exe's menus read
// six keys (ProcessKeyboardInput / g_KeyboardSharedState[8..0xD]: Up, Down,
// Left, Right, Decide, Cancel), which come from the active config; so a menu
// follows the bindings and no longer the literal Enter / Backspace / arrows.
// Escape is always Cancel (the window's caption for Cancel is "ESC/BACK SPACE";
// ASSUMED that the exe keeps Escape as a second Cancel, since ESC cannot be bound).
export type MenuKey = 'up' | 'down' | 'left' | 'right' | 'decide' | 'cancel';

export function menuKeyOf(e: { key: string }): MenuKey | null {
  const k = e.key.toLowerCase();
  if (k === 'escape') return 'cancel';
  if (!k) return null;
  if (k === KEYS.selectUp) return 'up';
  if (k === KEYS.selectDown) return 'down';
  if (k === KEYS.selectLeft) return 'left';
  if (k === KEYS.selectRight) return 'right';
  if (k === KEYS.decide) return 'decide';
  if (k === KEYS.cancel) return 'cancel';
  return null;
}

// True for the arrow keys that auto-repeat in menus (the select keys).
export function isRepeatingKey(key: string): boolean {
  return key === KEYS.selectUp || key === KEYS.selectDown || key === KEYS.selectLeft || key === KEYS.selectRight;
}

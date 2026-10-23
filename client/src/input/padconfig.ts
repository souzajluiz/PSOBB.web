// Options > Pad Button Config: the joystick config, the pad's 0x38-byte block
// (PsoBB.exe's g_pKeyboardControlConfig; newserv PSOBBBaseSystemFile
// joystick_config at 0x280 of the account system file).
//
// Layout (exe ApplyKeyboardConfig_00791818 / UpdateKeyboardStateAndBitmasks_00792c64):
//   +0x00  4 bytes: the analog bindings of rows 0..3 (a DirectInput axis code:
//          0..6 = X, Y, Z, X rotate, Y rotate, Z rotate, slider on the + side,
//          7..13 the same axes on the - side, 0xFF = none);
//   +0x04  12 u32: the button controls 0..11 (a pad button bit, 0 = none);
//   +0x34  u32 marker, 1 (written by the exe after the copy).
// The exe copies controls 0..11 into g_KeyboardSharedState[8..0x13]; the
// first six are the menu keys (Up, Down, Left, Right, Decide, Cancel; the order
// is ASSUMED, see DEVLOG 2026-10-23 keyboard follow-up).
//
// The default block is exe data at 0x0097bab4 (the same bytes as newserv's
// DEFAULT_JOYSTICK_CONFIG). Names and the row table are exe data too: the
// gamepad codes at 0x0097b2e0 (21 pairs {code, wide name}), the analog codes
// at 0x0097b260 (16 pairs), the row table g_PadButtonMenuUnitxtIndices at
// 0x0097b3a0 (16 pairs {control index, unitxt group 0 index}), and the
// controls that must stay bound at 0x0097bb5c (11 u32).

import { domEventOf, KEYS, type KeyRole } from './keyconfig.ts';

export const JOYSTICK_SIZE = 0x38;
// 00E7 (SC_SyncSaveFiles) carries the system file at 0x2EA4; joystick_config is at 0x280 in it.
export const JOYSTICK_IN_CHARACTER = 0x2ea4 + 0x280;
export const ANALOG_ROWS = 4;
export const CONTROL_COUNT = 12;
export const ANALOG_NONE = 0xff;
const MARKER_OFFSET = 0x34;

// The gamepad button codes (g_GamepadConfigArray), in the exe's table order.
// The leading ": " is the exe's text.
export const PAD_BUTTON_NAMES: ReadonlyArray<readonly [number, string]> = [
  [0x0, ': NONE'],
  [0x1, ': PAD BUTTON1'],
  [0x2, ': PAD BUTTON2'],
  [0x4, ': PAD BUTTON3'],
  [0x8, ': PAD BUTTON4'],
  [0x10, ': PAD BUTTON5'],
  [0x20, ': PAD BUTTON6'],
  [0x40, ': PAD BUTTON7'],
  [0x80, ': PAD BUTTON8'],
  [0x100, ': PAD BUTTON9'],
  [0x200, ': PAD BUTTON10'],
  [0x400, ': PAD BUTTON11'],
  [0x800, ': PAD BUTTON12'],
  [0x1000, ': PAD BUTTON13'],
  [0x2000, ': PAD BUTTON14'],
  [0x4000, ': PAD BUTTON15'],
  [0x8000, ': PAD BUTTON16'],
  [0x10000, ': PAD POV(Y)+'],
  [0x20000, ': PAD POV(Y)-'],
  [0x40000, ': PAD POV(X)+'],
  [0x80000, ': PAD POV(X)-'],
];

// The analog codes (the keyboard-config-array table, 0x0097b260).
export const ANALOG_NAMES: ReadonlyArray<readonly [number, string]> = [
  [ANALOG_NONE, ': NONE'],
  [0, ': PAD X Axis (+)'],
  [1, ': PAD Y Axis (+)'],
  [2, ': PAD Z Axis (+)'],
  [3, ': PAD X Rotate (+)'],
  [4, ': PAD Y Rotate (+)'],
  [5, ': PAD Z Rotate (+)'],
  [6, ': PAD Slider (+)'],
  [7, ': PAD X Axis (-)'],
  [8, ': PAD Y Axis (-)'],
  [9, ': PAD Z Axis (-)'],
  [10, ': PAD X Rotate (-)'],
  [11, ': PAD Y Rotate (-)'],
  [12, ': PAD Z Rotate (-)'],
  [13, ': PAD Slider (-)'],
];

// The row table (g_PadButtonMenuUnitxtIndices): rows 0..3 are the analog
// bindings (unitxt group 0: 55..58), rows 4..15 the controls 0..11 (59..72).
// Controls 5 and 6 show the label one step on (65, 67) when option 0x800000
// is set, and that option swaps their values (ASSUMED: the names' meaning).
export interface PadRow {
  analog: boolean;
  index: number; // analog: the row (0..3); button: the control (0..11)
  label: number; // unitxt group 0 index
}
export const PAD_ROWS: readonly PadRow[] = [
  { analog: true, index: 0, label: 55 }, // Move Left/Right
  { analog: true, index: 1, label: 56 }, // Move Forward/Backward
  { analog: true, index: 2, label: 57 }, // Right Analog Left/Right
  { analog: true, index: 3, label: 58 }, // Right Analog Forward/Backward
  { analog: false, index: 0, label: 59 }, // Select Up
  { analog: false, index: 1, label: 60 }, // Select Down
  { analog: false, index: 2, label: 61 }, // Select Left
  { analog: false, index: 3, label: 62 }, // Select Right
  { analog: false, index: 4, label: 63 }, // Action Palette Middle / Decide
  { analog: false, index: 5, label: 64 }, // Action Palette Right / Cancel
  { analog: false, index: 6, label: 66 }, // Action Palette Left / Detail
  { analog: false, index: 7, label: 68 }, // Action Palette Top
  { analog: false, index: 8, label: 69 }, // Menu Open/Close
  { analog: false, index: 9, label: 70 }, // Prev Page / Camera
  { analog: false, index: 10, label: 71 }, // Next Page / Action Palette Change
  { analog: false, index: 11, label: 72 }, // Menu Open / Menu Decide
];

// Controls that must stay bound (g_PadConfigButtonMappingTable): the exe
// refuses to clear one (Delete) or to take its button away (unitxt 0x4C). Only
// control 7 may be left empty (ASSUMED reading of the table).
export const MUST_BIND: ReadonlySet<number> = new Set([0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11]);

// The key roles a control drives in the port (ASSUMED from the row labels and
// the menu key order; the pad's menus read controls 0..5). Control 5 also drives
// Cancel, so the same button leaves the menus as it does in the field.
export const CONTROL_ROLES: ReadonlyArray<readonly KeyRole[]> = [
  ['selectUp'],
  ['selectDown'],
  ['selectLeft'],
  ['selectRight'],
  ['decide', 'paletteMiddle'],
  ['cancel', 'paletteRight'],
  ['paletteLeft'],
  [],
  ['menu'],
  ['camera'],
  ['paletteChange'],
  [],
];

// The POV bits (DirectInput codes; the browser's d-pad maps to them, ASSUMED).
// The default block's controls 0..3 use them, so this is the default's direction.
export const POV_UP = 0x10000;
export const POV_DOWN = 0x20000;
export const POV_LEFT = 0x40000;
export const POV_RIGHT = 0x80000;

// The opposite side of an analog code (the exe: code < 7 ? code + 7 : code - 7).
// The exe compares a signed char, so 0xFF (-1) counts as "< 7" and gives 6
// (ported as the exe does; ASSUMED to be intended).
export function analogOpposite(code: number): number {
  const c = (code << 24) >> 24; // signed char
  return c < 7 ? (c + 7) & 0xff : (c - 7) & 0xff;
}

// Whether two analog codes are the same axis (either side).
export function sameAnalogAxis(a: number, b: number): boolean {
  return a === b || a === analogOpposite(b);
}

const DEFAULT_BUTTONS = [
  0x10000, 0x20000, 0x40000, 0x80000, 0x1, 0x4, 0x2, 0x8, 0x200, 0x20, 0x80, 0x100,
];

// The default block (0x0097bab4): analog 0, 1, none, none; the buttons above; marker 1.
export function defaultPadConfig(): Uint8Array {
  const b = new Uint8Array(JOYSTICK_SIZE);
  b[0] = 0x00;
  b[1] = 0x01;
  b[2] = 0xff;
  b[3] = 0xff;
  const dv = new DataView(b.buffer);
  DEFAULT_BUTTONS.forEach((v, i) => dv.setUint32(4 + 4 * i, v, true));
  dv.setUint32(MARKER_OFFSET, 1, true);
  return b;
}

function isValidAnalog(v: number): boolean {
  return v === ANALOG_NONE || v <= 13;
}

const KNOWN_BUTTONS = new Set<number>(PAD_BUTTON_NAMES.map(([c]) => c));

// A block the exe would accept: the marker is 1, every analog byte is a known
// code, every button value is a known code (ASSUMED: an invalid block becomes
// the default, as the keyboard config's validator does).
export function normalizePadConfig(cfg: Uint8Array | null | undefined): Uint8Array {
  if (!cfg || cfg.length < JOYSTICK_SIZE) return defaultPadConfig();
  const b = cfg.slice(0, JOYSTICK_SIZE);
  const dv = new DataView(b.buffer);
  if (dv.getUint32(MARKER_OFFSET, true) !== 1) return defaultPadConfig();
  for (let i = 0; i < ANALOG_ROWS; i++) if (!isValidAnalog(b[i])) return defaultPadConfig();
  for (let i = 0; i < CONTROL_COUNT; i++) if (!KNOWN_BUTTONS.has(dv.getUint32(4 + 4 * i, true))) return defaultPadConfig();
  return b;
}

export function analogOf(cfg: Uint8Array, row: number): number {
  return cfg[row];
}

export function setAnalog(cfg: Uint8Array, row: number, code: number): void {
  cfg[row] = code & 0xff;
}

export function buttonOf(cfg: Uint8Array, control: number): number {
  return new DataView(cfg.buffer, cfg.byteOffset, cfg.byteLength).getUint32(4 + 4 * control, true);
}

export function setButton(cfg: Uint8Array, control: number, code: number): void {
  new DataView(cfg.buffer, cfg.byteOffset, cfg.byteLength).setUint32(4 + 4 * control, code >>> 0, true);
}

export function analogName(code: number): string {
  return ANALOG_NAMES.find(([c]) => c === code)?.[1] ?? '';
}

export function buttonName(code: number): string {
  return PAD_BUTTON_NAMES.find(([c]) => c === code)?.[1] ?? '';
}

// The config from the 00E7 record (the system file's joystick_config), or null.
export function padConfigFromCharacter(full: Uint8Array | null | undefined): Uint8Array | null {
  if (!full || full.length < JOYSTICK_IN_CHARACTER + JOYSTICK_SIZE) return null;
  return full.slice(JOYSTICK_IN_CHARACTER, JOYSTICK_IN_CHARACTER + JOYSTICK_SIZE);
}

export function writePadConfigToCharacter(full: Uint8Array | null | undefined, cfg: Uint8Array): void {
  if (!full || full.length < JOYSTICK_IN_CHARACTER + JOYSTICK_SIZE) return;
  full.set(normalizePadConfig(cfg), JOYSTICK_IN_CHARACTER);
}

// The live pad config (the exe's g_pKeyboardControlConfig). Read by the pad
// input (input/padinput.ts).
let active: Uint8Array = defaultPadConfig();

export function currentPadConfig(): Uint8Array {
  return active.slice();
}

// Makes cfg the config in use (an invalid one becomes the default).
export function applyPadConfig(cfg: Uint8Array | null | undefined): Uint8Array {
  active = normalizePadConfig(cfg);
  return currentPadConfig();
}

// The DOM event of the key a control drives, for each control (the first role
// with a bound key). Used by the pad input to feed the keys.
export function controlKeys(control: number): string[] {
  return CONTROL_ROLES[control].map((r) => KEYS[r]).filter((k) => k !== '');
}

export function controlDomEvents(control: number): { key: string; code: string }[] {
  return controlKeys(control).map((k) => domEventOf(k));
}

// Blue Burst's default keyboard configuration, decoded.
//
// BB keeps the key config on the server (the account's 0x16C-byte
// key_config, sent with the E2 key/team config); newserv's default is
// system/blueburst/default-keyboard-config.bin. It is an array of 8-byte
// bindings {u32 modifiers, u32 key code}, in the order of the client's key
// config menu (labels: table 0x0097b500 of {binding, unitxt group 0 index}
// pairs, keyboard config handler HandleInputKeyBinding_00790458):
//
//   0 Move Forward  W      1 Move Backward  S      2 Move Left  A
//   3 Move Right    D      4 Lock Move Forward -   5 Lock Walk Forward -
//   6 Decide        Enter  7 Cancel    Backspace   8 Menu Open/Close Home
//   9 Input Start   Space  10..13 Select Up / Down / Left / Right: arrows
//   14 Symbol Chat Open End
//   15 Action Palette Middle  Down    16 Action Palette Left  Left
//   17 Action Palette Right   Right   18 Action Palette Change (code 0x56)
//   19 Camera                 Up      20..31 F1..F12   34..43 1..0 (hotbar)
//
// Key codes are the client's own (enum pso_keycode in the named dump; the
// DirectInput scan codes map to them through dinput8_key_remap in
// update_keyboard_state): a..z = 0x10..0x29, 1..0 = 0x2A..0x33, F1..F12 =
// 0x40..0x4B, home 6, end 7, backspace 0x50, space 0x59, arrows left / down /
// up / right = 0x5C..0x5F, enter 0x61. 0x56 is not in the enum; it is the
// Ctrl key the client's palette toggle reads (HandlePlayerPaletteToggle
// _00694f0c), which is how the default config labels it.
//
// The palette keys pick palette_slots[] of the current action palette: Left
// = slot 2 (the dump's "main slot left pressed" reads
// get_palette_slot_first_byte(player, 2)), Middle = slot 1, Right = slot 3
// (1-based, as the client numbers them).
//
// The values are DOM KeyboardEvent.key names, lower-cased, as the views keep
// them in their held-key sets.

export const KEYS = {
  moveForward: 'w',
  moveBackward: 's',
  moveLeft: 'a',
  moveRight: 'd',
  decide: 'enter',
  cancel: 'backspace',
  menu: 'home',
  chat: ' ',
  symbolChat: 'end',
  selectUp: 'arrowup',
  selectDown: 'arrowdown',
  selectLeft: 'arrowleft',
  selectRight: 'arrowright',
  paletteMiddle: 'arrowdown',
  paletteLeft: 'arrowleft',
  paletteRight: 'arrowright',
  paletteChange: 'control',
  camera: 'arrowup',
} as const;

// Action palette keys and the palette_slots[] index (0-based) each one uses.
export const PALETTE_KEYS: ReadonlyArray<readonly [string, number]> = [
  [KEYS.paletteLeft, 1],
  [KEYS.paletteMiddle, 0],
  [KEYS.paletteRight, 2],
];

// Main menu > Options (classic/options.ts): the rows and choices of the exe,
// the option word's bit fields, the 0x01ED save command, the settings
// window's keys, and the main menu's Cursor Position memory
// (classic/mainmenu.ts).
// Run: node tests/options.test.ts
// The labels are checked against newserv's bb-v4 unitxt_e.prs when it is
// there (vendor/newserv, or NEWSERV=<checkout>).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseUnitxt } from '../client/src/classic/charcreate_text.ts';
import { MAIN_MENU, MainMenu } from '../client/src/classic/mainmenu.ts';
import {
  brightnessOffset,
  characterOptionsEnv,
  clampBrightness,
  cursorSaved,
  DEFAULT_OPTION_FLAGS,
  getBrightness,
  OPTION_FLAGS_COMMAND,
  OPTION_FLAGS_OFFSET,
  OPTION_ROWS,
  optionFlagsPayload,
  OptionsMenu,
  parseBrightness,
  optionValue,
  readOptionFlags,
  withOptionValue,
  type OptionField,
  type OptionsEnv,
} from '../client/src/classic/options.ts';
import { WindowAnim } from '../client/src/classic/windowanim.ts';
import { CATEGORIES, KeyConfigMenu, type KeyConfigEnv } from '../client/src/classic/keyconfig.ts';
import {
  applyKeyConfig,
  BINDING,
  CONFIG_IN_CHARACTER,
  CONFIG_SIZE,
  codeOfDomKey,
  currentKeyConfig,
  defaultKeyConfig,
  domEventOf,
  domKeyOfCode,
  KEYS,
  keyCaption,
  keyConfigFromCharacter,
  menuKeyOf,
  normalizeKeyConfig,
  PALETTE_KEYS,
  presetKeyConfig,
  PRESET_COUNT,
  readBinding,
  writeBinding,
  writeKeyConfigToCharacter,
} from '../client/src/input/keyconfig.ts';
import { DOM_KEYS, stickKeys } from '../client/src/input/virtualpad.ts';

let failures = 0;
let checks = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.error(`FAIL ${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  }
};
const key = (k: string) => ({ key: k }) as KeyboardEvent;
type Bits = Extract<OptionField, { kind: 'bits' }>;
const bitsOf = (value: number): Bits => {
  const f = OPTION_ROWS.find((r) => r.value === value)!.field;
  if (f.kind !== 'bits') throw new Error(`row ${value} is not a bit field`);
  return f;
};

// --- rows (create_list_items_for_menu_options) -------------------------------
eq(OPTION_ROWS.map((r) => r.value), [0, 1, 2, 3, 4, 5, 6, 7, 9, 10], 'row values (no 8)');
eq(
  OPTION_ROWS.map((r) => r.label),
  [[11, 0x79], [0, 6], [0, 9], [0, 10], [0, 0x11], [0, 0], [11, 0x7b], [11, 0x7c], [11, 0x81], [11, 0x82]],
  'row labels',
);
eq(OPTION_ROWS.map((r) => r.choices.length), [2, 2, 2, 3, 0, 0, 2, 4, 4, 5], 'choices per row');

// --- bit fields (ApplySelectedSetting_00753c70) -------------------------------
eq(
  OPTION_ROWS.filter((r) => r.field.kind === 'bits').map((r) => [r.value, (r.field as Bits).mask, (r.field as Bits).shift]),
  [[0, 0x1, 0], [1, 0x2000000, 25], [2, 0x1000000, 24], [3, 0x700000, 20], [6, 0x4, 2], [7, 0x300, 8], [9, 0x1c00, 10]],
  'masks and shifts',
);
eq(optionValue(null, bitsOf(7)), 1, 'message speed without session data = 1 (GetCharacterOptionsBitfield_007be1d0)');
eq(optionValue(null, bitsOf(9)), 0, 'auto disconnect without session data = 0');
eq(optionValue(DEFAULT_OPTION_FLAGS, bitsOf(7)), 0, 'default 0x00040058: message speed Slow');
eq(optionValue(DEFAULT_OPTION_FLAGS, bitsOf(6)), 0, 'default: cursor Saved');
eq(withOptionValue(DEFAULT_OPTION_FLAGS, bitsOf(7), 3), 0x00040358, 'message speed Very Fast -> bits 0x300');
eq(withOptionValue(0xffffffff, bitsOf(3), 2), 0xffafffff, 'mouse HOLD (2 << 20) in an all-set word');
eq(withOptionValue(0, bitsOf(9), 3), 0xc00, 'auto disconnect 60 minutes');
eq(withOptionValue(0, bitsOf(1), 1), 0x2000000, 'function keys: chat shortcuts');
eq(withOptionValue(0x2000000, bitsOf(1), 0), 0, 'function keys: menu shortcuts');
eq(WindowAnim.speedOf(withOptionValue(0, bitsOf(7), 2)), 2, 'the window animation reads the message speed');
eq([cursorSaved(null), cursorSaved(0), cursorSaved(4)], [true, true, false], 'cursor memory: bit 4 = Non-Saved');

// --- save command (send_packet0xed_subcommand1) ----------------------------
eq(OPTION_FLAGS_COMMAND, 0x01ed, 'command 0x01ED');
eq([...optionFlagsPayload(0x00040358)], [0x58, 0x03, 0x04, 0x00], 'payload: u32 option_flags LE');

// --- brightness (UpdateExternalSettings) ------------------------------------
eq([0, 1, 2, 3, 4, 7].map(clampBrightness), [0, 1, 2, 3, 4, 4], 'SetExternalSettingsFlag clamp');
eq(brightnessOffset(2), 0, 'Normal: no ramp offset');
eq([null, '', 'x', '-1', '7', '1.5', ' 3 ', '0'].map((v) => parseBrightness(v)), [2, 2, 2, 2, 2, 2, 3, 0], 'stored brightness: bad values -> Normal');
eq(Math.round(brightnessOffset(0) * 0xffff), 0x2000, '+2 level: +0x2000');
eq(Math.round(brightnessOffset(4) * 0xffff), -0x2000, '-2 level: -0x2000');

// --- the window ---------------------------------------------------------------
const full = new Uint8Array(0x2ea4);
new DataView(full.buffer).setUint32(OPTION_FLAGS_OFFSET, DEFAULT_OPTION_FLAGS, true);
const sent: Array<[number, number[]]> = [];
const env: OptionsEnv = {
  ...characterOptionsEnv(
    (g, i) => `${g}:${i}`,
    () => full,
    (c, p) => sent.push([c, [...p]]),
  ),
  padConnected: () => false,
};
{
  const m = new OptionsMenu(env);
  // Message Speed is row 7 of the list.
  for (let i = 0; i < 7; i++) m.key(key('ArrowDown'));
  eq(m.cursor, 7, 'cursor on Message Speed');
  m.key(key('Enter'));
  eq(m.open?.row.value, 7, 'Message Speed settings open');
  eq(m.open?.items.map((i) => i.label), ['11:137', '11:138', '11:139', '11:140'], 'choices Slow..Very Fast');
  eq([m.open?.cursor, m.open?.chosen], [0, 0], 'cursor on the current value');
  m.key(key('ArrowUp'));
  eq(m.open?.cursor, 3, 'up wraps to Very Fast');
  m.key(key('Enter'));
  eq(m.open, null, 'Decide closes the settings window');
  eq(readOptionFlags(full), 0x00040358, 'option word updated in the session data');
  // Cancel leaves the value.
  m.key(key('Enter'));
  m.key(key('ArrowDown'));
  m.key(key('Backspace'));
  eq(readOptionFlags(full), 0x00040358, 'Cancel keeps the value');
  eq(m.key(key('Backspace')), false, 'Cancel on the list leaves the window');
  m.dispose();
  eq(sent, [[0x01ed, [0x58, 0x03, 0x04, 0x00]]], '0x01ED sent once on close');
}
{
  sent.length = 0;
  const m = new OptionsMenu(env);
  m.key(key('Backspace'));
  m.dispose();
  eq(sent.length, 0, 'nothing sent when no row was decided');
}
{
  const m = new OptionsMenu(env);
  for (let i = 0; i < 4; i++) m.key(key('ArrowDown'));
  m.key(key('Enter'));
  eq(m.open, null, 'Pad Button Config is greyed without a pad');
  // Brightness: -1 level.
  for (let i = 0; i < 5; i++) m.key(key('ArrowDown'));
  m.key(key('Enter'));
  eq(m.open?.row.value, 10, 'Brightness settings open');
  eq(m.open?.cursor, 2, 'Brightness starts on Normal');
  m.key(key('ArrowDown'));
  m.key(key('Enter'));
  eq(getBrightness(), 3, 'Brightness -1 level');
  m.dispose();
}

// --- cursor memory (PlayerMenuWindow_CheckItemState_00732514) ---------------
{
  const opened: number[] = [];
  const menu = new MainMenu(() => '', (id) => opened.push(id));
  let flags = 0;
  menu.cursorSaved = () => cursorSaved(flags);
  menu.toggle(MAIN_MENU);
  // the exe ignores keys for 2 frames after the menu opens (MainMenu.toggle)
  menu.tick(); menu.tick();
  for (let i = 0; i < 5; i++) menu.key(key('ArrowDown'));
  menu.key(key('Enter'));
  eq(opened, [6], 'Options chosen');
  menu.close();
  menu.toggle(MAIN_MENU);
  // the exe ignores keys for 2 frames after the menu opens (MainMenu.toggle)
  menu.tick(); menu.tick();
  menu.key(key('Enter'));
  eq(opened, [6, 6], 'Saved: the menu reopens on Options');
  menu.close();
  flags = 4;
  menu.toggle(MAIN_MENU);
  // the exe ignores keys for 2 frames after the menu opens (MainMenu.toggle)
  menu.tick(); menu.tick();
  menu.key(key('ArrowDown'));
  menu.key(key('Enter')); // Customize has no sub-menu
  eq(opened, [6, 6, 0], 'Non-Saved: the menu reopens on the first entry');
  menu.close();
  // Sub-menus keep their own cursor.
  flags = 0;
  menu.toggle(MAIN_MENU);
  // the exe ignores keys for 2 frames after the menu opens (MainMenu.toggle)
  menu.tick(); menu.tick();
  menu.key(key('ArrowUp')); // the kept Customize -> Item Pack
  menu.key(key('Enter')); // Item Pack
  menu.key(key('ArrowDown'));
  menu.key(key('ArrowDown'));
  menu.key(key('Enter')); // MAG
  menu.key(key('Backspace')); // back to the top level
  menu.key(key('Enter')); // Item Pack again
  menu.key(key('Enter'));
  eq(opened.slice(3), [0x17, 0x17], 'Item Pack sub-menu reopens on MAG');
}

// --- Keyboard Config (input/keyconfig.ts, classic/keyconfig.ts) ----------------
// The 0x16C config: 45 bindings and a marker (ValidateAndApplyKeyboardConfig_007917c0);
// the default is newserv's DEFAULT_KEY_CONFIG.
const dkey = (k: string, code = '') => ({ key: k, code }) as KeyboardEvent;
const defaults = defaultKeyConfig();
eq(defaults.length, CONFIG_SIZE, 'key config size 0x16C');
eq(CONFIG_SIZE + 8, 0x174, 'the 04ED packet: 8-byte header + key config = 0x174 (send_packet0xed_subcommand4)');
eq(new DataView(defaults.buffer).getUint32(360, true), 1, 'the marker (u32 at 360) is 1');
eq(
  [0, 1, 2, 3, 6, 7, 8, 9, 10, 14, 18, 19].map((i) => readBinding(defaults, i).code),
  [0x26, 0x22, 0x10, 0x13, 0x61, 0x50, 0x06, 0x59, 0x5e, 0x07, 0x56, 0x5e],
  'default codes (newserv DEFAULT_KEY_CONFIG)',
);
eq(readBinding(defaults, 20).code, 0x40, 'F1 is binding 20');
eq(readBinding(defaults, 35).code, 0x2a, 'hotbar 1 is binding 35');
eq(
  KEYS,
  {
    moveForward: 'w', moveBackward: 's', moveLeft: 'a', moveRight: 'd', decide: 'enter', cancel: 'backspace', menu: 'home',
    chat: ' ', symbolChat: 'end', selectUp: 'arrowup', selectDown: 'arrowdown', selectLeft: 'arrowleft', selectRight: 'arrowright',
    paletteMiddle: 'arrowdown', paletteLeft: 'arrowleft', paletteRight: 'arrowright', paletteChange: 'control', camera: 'arrowup',
  },
  'KEYS from the default config',
);
eq(PALETTE_KEYS, [['arrowleft', 1], ['arrowdown', 0], ['arrowright', 2]], 'PALETTE_KEYS from the default config');
eq(normalizeKeyConfig(null).length, CONFIG_SIZE, 'a missing config is the default');
const badType = defaults.slice();
writeBinding(badType, 3, { type: 2, code: 0x13 });
eq(normalizeKeyConfig(badType), defaults, 'a type above 1 resets to the default');
const badMarker = defaults.slice();
badMarker[360] = 0;
eq(normalizeKeyConfig(badMarker), defaults, 'a bad marker resets to the default');

// The config inside the 00E7 record (PSOBBBaseSystemFile.key_config at 0x2FB8).
eq(CONFIG_IN_CHARACTER, 0x2fb8, 'key config offset in 00E7');
const rec = new Uint8Array(0x3994);
eq(normalizeKeyConfig(keyConfigFromCharacter(rec)), defaults, 'a zero record (no marker) normalizes to the default');
writeKeyConfigToCharacter(rec, defaults);
eq(keyConfigFromCharacter(rec), defaults, 'key config round trip in the character record');
eq(keyConfigFromCharacter(new Uint8Array(0x100)), null, 'a short record has no key config');

// Key names and DOM names.
eq(domKeyOfCode(0x26), 'w', 'W code');
eq(domKeyOfCode(0x40), 'f1', 'F1 code');
eq(domKeyOfCode(0x5e), 'arrowup', 'Up arrow code');
eq(codeOfDomKey('w'), 0x26, 'DOM w -> code');
eq(codeOfDomKey('Escape'), 0x4c, 'DOM Escape -> ESC code');
eq(codeOfDomKey('Shift'), 0x54, 'DOM Shift -> L SHIFT');
eq(codeOfDomKey('1'), 0x2a, 'DOM 1 -> code 0x2A');
eq(codeOfDomKey('0'), 0x33, 'DOM 0 -> code 0x33');
eq(codeOfDomKey('F13'), null, 'a key the table does not have');
eq(keyCaption(0x26), ': w', 'caption of W (the exe text ": w")');
eq(keyCaption(0), '', 'an unbound key has no caption');
eq(domEventOf('w'), { key: 'w', code: 'KeyW' }, 'DOM event of a letter');
eq(DOM_KEYS.enter, { key: 'Enter', code: 'Enter' }, 'DOM event of Enter');

// applyKeyConfig: the live keys follow the config, in place.
const alt = defaults.slice();
writeBinding(alt, BINDING.moveRight, { type: 0, code: 0x10 }); // A
applyKeyConfig(alt);
eq(KEYS.moveRight, 'a', 'a rebound move key is the live key');
eq([...stickKeys({ dx: 1, dy: 0, radius: 1 })], ['a'], 'the stick reads the live keys');
eq(currentKeyConfig(), alt, 'the config in use is the one applied');
applyKeyConfig(null);
eq(KEYS.moveRight, 'd', 'the default restores the key');

// The window (classic/keyconfig.ts): Custom, then a category, a row, a key.
function keyWindowEnv(start: Uint8Array | null) {
  const commits: Uint8Array[] = [];
  const env: KeyConfigEnv = { text: (g, i) => `${g}:${i}`, load: () => start, commit: (c) => commits.push(c) };
  return { env, commits };
}
{
  // Move Forward (row 0 of Config of Movement) = K (0x1A), which no row holds: no swap.
  const { env, commits } = keyWindowEnv(null);
  const w = new KeyConfigMenu(env);
  eq(w.key(dkey('Enter')), true, 'Custom opens the category list');
  eq(w.key(dkey('Enter')), true, 'Move Forward is decided (waits for a key)');
  eq(w.key(dkey('k')), true, 'the key is taken');
  eq(w.key(dkey('Backspace')), true, 'Cancel goes back to the top list');
  eq(w.key(dkey('Backspace')), false, 'Cancel on the top list closes the window');
  eq(commits.length, 1, 'closing commits once');
  eq(readBinding(commits[0], 0), { type: 0, code: 0x1a }, 'Move Forward is K');
  eq(readBinding(commits[0], 1), { type: 0, code: 0x22 }, 'Move Backward untouched');
}
{
  // Move Forward = A: A is Move Left's key, so Move Left takes W (Move Forward's old key).
  // Then Move Backward = W: W is now Move Left's, so Move Left takes S (Move Backward's old key).
  const { env, commits } = keyWindowEnv(null);
  const w = new KeyConfigMenu(env);
  w.key(dkey('Enter'));
  w.key(dkey('Enter'));
  w.key(dkey('a'));
  w.key(dkey('ArrowDown'));
  w.key(dkey('Enter'));
  w.key(dkey('w'));
  w.key(dkey('Backspace'));
  w.key(dkey('Backspace'));
  eq(readBinding(commits[0], 0), { type: 0, code: 0x10 }, 'swap: Move Forward is A');
  eq(readBinding(commits[0], 1), { type: 0, code: 0x26 }, 'swap: Move Backward is W');
  eq(readBinding(commits[0], 2), { type: 0, code: 0x22 }, 'swap: Move Left took S');
}
{
  // ESC, Shift, Ctrl are refused (the wait goes on); J is set; the Cancel row is not changeable.
  const { env, commits } = keyWindowEnv(null);
  const w = new KeyConfigMenu(env);
  w.key(dkey('Enter'));
  w.key(dkey('Enter'));
  w.key(dkey('Escape'));
  w.key(dkey('Shift', 'ShiftLeft'));
  w.key(dkey('Control'));
  w.key(dkey('j'));
  w.key(dkey('ArrowRight'));
  w.key(dkey('ArrowRight'));
  w.key(dkey('ArrowDown'));
  w.key(dkey('Enter'));
  w.key(dkey('j'));
  w.key(dkey('Backspace'));
  w.key(dkey('Backspace'));
  eq(readBinding(commits[0], 0), { type: 0, code: 0x19 }, 'J is set after the refused keys');
  eq(readBinding(commits[0], BINDING.cancel), { type: 0, code: 0x50 }, 'Cancel is not changed');
}
{
  // Left wraps from the first category to the last.
  const { env, commits } = keyWindowEnv(null);
  const w = new KeyConfigMenu(env);
  w.key(dkey('Enter'));
  eq(w.key(dkey('ArrowLeft')), true, 'Left from the first category wraps');
  w.key(dkey('Backspace'));
  eq(w.key(dkey('Backspace')), false, 'closed');
  eq(commits.length, 1, 'one commit');
}
{
  // The four Default presets (exe 0x0097aca0): Default 1 is the default config; Default 4 is numpad moves.
  eq(PRESET_COUNT, 4, 'four presets');
  eq(presetKeyConfig(0), defaultKeyConfig(), 'Default 1 is the default config');
  const p = [0, 1, 2, 3].map((n) => presetKeyConfig(n));
  eq(p.map((c) => new DataView(c.buffer).getUint32(360, true)), [1, 1, 1, 1], 'each preset has the marker');
  eq(p.map((c) => readBinding(c, 0).code), [0x26, 0x26, 0x5e, 0x75], 'move forward: W, W, Up, numpad 8');
  eq(p.map((c) => readBinding(c, 16).code), [0x5c, 0x19, 0x10, 0x5c], 'action palette left: Left, J, A, Left');
  eq(
    p.map((c) => [6, 7, 10, 11, 12, 13].map((i) => readBinding(c, i).code)),
    [[0x61, 0x50, 0x5e, 0x5d, 0x5c, 0x5f], [0x61, 0x50, 0x5e, 0x5d, 0x5c, 0x5f], [0x61, 0x50, 0x5e, 0x5d, 0x5c, 0x5f], [0x61, 0x50, 0x5e, 0x5d, 0x5c, 0x5f]],
    'the menu keys are the same in all four',
  );
}
{
  // Default 4 (index 3) copied on Decide from the top list: Custom (4) is one Up away.
  const { env, commits } = keyWindowEnv(null);
  const w = new KeyConfigMenu(env);
  w.key(dkey('ArrowUp'));
  eq(w.key(dkey('Enter')), true, 'Default 4 is decided (copies its preset, stays on the top list)');
  eq(w.key(dkey('Backspace')), false, 'Cancel on the top list closes the window');
  eq(readBinding(commits[0], 0), { type: 0, code: 0x75 }, 'the working config is preset 4 (numpad 8)');
  eq(readBinding(commits[0], 20), { type: 0, code: 0x40 }, 'the copy keeps the function keys');
}
{
  // Default 2 (index 1): Up three times from Custom.
  const { env, commits } = keyWindowEnv(null);
  const w = new KeyConfigMenu(env);
  w.key(dkey('ArrowUp'));
  w.key(dkey('ArrowUp'));
  w.key(dkey('ArrowUp'));
  w.key(dkey('Enter'));
  w.key(dkey('Backspace'));
  w.key(dkey('Backspace'));
  eq(readBinding(commits[0], 16).code, 0x19, 'Default 2 is preset 2 (action palette left = J)');
}
{
  // The menu keys follow the bindings (menuKeyOf): Decide is Z once rebound, Enter no longer decides.
  eq(menuKeyOf({ key: 'Enter' }), 'decide', 'default: Enter decides');
  eq(menuKeyOf({ key: 'Backspace' }), 'cancel', 'default: Backspace cancels');
  eq(menuKeyOf({ key: 'Escape' }), 'cancel', 'Escape always cancels');
  eq(menuKeyOf({ key: 'ArrowUp' }), 'up', 'Up arrow is Select Up');
  eq(menuKeyOf({ key: 'ArrowRight' }), 'right', 'Right arrow is Select Right');
  eq(menuKeyOf({ key: 'a' }), null, 'a letter is not a menu key');
  const rebound = defaultKeyConfig();
  writeBinding(rebound, BINDING.decide, { type: 0, code: 0x29 });
  applyKeyConfig(rebound);
  eq(menuKeyOf({ key: 'z' }), 'decide', 'rebound Decide (Z) decides');
  eq(menuKeyOf({ key: 'Enter' }), null, 'Enter no longer decides after the rebind');
  eq(menuKeyOf({ key: 'Escape' }), 'cancel', 'Escape still cancels');
  applyKeyConfig(null);
  eq(menuKeyOf({ key: 'Enter' }), 'decide', 'the default config restores Enter');
}
// Options > Keyboard Config (row 5) opens the window; its Cancel returns to the option list.
{
  const commits: Uint8Array[] = [];
  const env: OptionsEnv = {
    text: (g, i) => `${g}:${i}`,
    flags: () => 0,
    setFlags: () => {},
    send: () => {},
    padConnected: () => false,
    keyConfig: { text: (g, i) => `${g}:${i}`, load: () => null, commit: (c) => commits.push(c) },
  };
  const menu = new OptionsMenu(env);
  for (let i = 0; i < 5; i++) menu.key(key('ArrowDown'));
  eq(menu.cursor, 5, 'row 5 is Keyboard Config');
  menu.key(key('Enter'));
  eq(commits.length, 0, 'the window is open, nothing committed yet');
  menu.key(key('Backspace'));
  eq(commits.length, 1, 'closing the key config window commits');
  eq(commits[0].length, CONFIG_SIZE, 'the commit carries the 364-byte config');
  eq(menu.key(key('Backspace')), false, 'the option list is still open and closes on Cancel');
}
applyKeyConfig(null);

if (!process.env.NO_TEXT) {
  const ROOT = resolve(import.meta.dirname, '..');
  const path = join(process.env.NEWSERV ?? join(ROOT, 'vendor/newserv'), 'system/text-sets/bb-v4/unitxt_e.prs');
  if (existsSync(path)) {
    const t = parseUnitxt(new Uint8Array(readFileSync(path)));
    const s = ([g, i]: readonly [number, number]) => t[g]?.[i] ?? '';
    eq(s([11, 0x3d]), 'Options', 'title');
    eq(
      OPTION_ROWS.map((r) => s(r.label)),
      ['Map Direction', 'Function Key Setting', 'Keyboard Controls', 'Mouse Controls', 'Pad Button Config', 'Keyboard Config', 'Cursor Position', 'Message Speed', 'Auto Disconnect', 'Brightness'],
      'row labels (unitxt)',
    );
    eq(OPTION_ROWS[7].choices.map(s), ['Slow', 'Normal', 'Fast', 'Very Fast'], 'Message Speed choices');
    eq(OPTION_ROWS[9].choices.map(s), ['+2 level', '+1 level', 'Normal', '-1 level', '-2 level'], 'Brightness choices');
    eq(OPTION_ROWS[6].choices.map(s), ['Saved', 'Non-Saved'], 'Cursor Position choices');
    // Keyboard Config: the category headers and the rows (the label is the second word of each
    // exe label-table pair; the binding is the first; see input/keyconfig.ts).
    eq(CATEGORIES.map((c) => s([0, c.name])), ['Config of Movement', 'Config of Action Palette', 'Setting improper item'], 'key config category headers');
    eq(CATEGORIES.map((c) => c.rows.map((r) => s([0, r.label]))), [
      ['Move Forward', 'Move Backward', 'Move Left', 'Move Right', 'Lock Move Forward', 'Lock Walk Forward'],
      ['Action Palette Left', 'Action Palette Middle', 'Action Palette Right', 'Symbol Chat Open', 'Camera'],
      ['Decide', 'Cancel', 'Menu Open/Close', 'Input Start', 'Action Palette Change', 'Select Up', 'Select Down', 'Select Left', 'Select Right'],
    ], 'key config rows (unitxt)');
    eq(s([0, 0x50]) + '|' + s([0, 0x54]), 'Default1|Custom', 'key config top list');
  } else console.log(`info: ${path} missing, labels not checked`);
}

console.log(`${failures ? 'FAIL' : 'PASS'} options: ${checks} checks, ${failures} failures`);
if (failures) process.exit(1);

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
  } else console.log(`info: ${path} missing, labels not checked`);
}

console.log(`${failures ? 'FAIL' : 'PASS'} options: ${checks} checks, ${failures} failures`);
if (failures) process.exit(1);

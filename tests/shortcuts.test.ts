// Function-key shortcuts (input/shortcuts.ts: unknown_handle_fkey_inputs, dump line
// 682260), the auto run / walk state (input/automove.ts: unknown_handle_movement,
// dump 667141..667157), and the menu entries they open (classic/fieldmenu.ts and
// classic/lobby.ts validate them with ValidateMenuItemCondition's rules).
// Run: node tests/shortcuts.test.ts
import {
  applyKeyConfig,
  bindingKey,
  BINDING,
  currentKeyConfig,
  defaultKeyConfig,
  readBinding,
  writeBinding,
} from '../client/src/input/keyconfig.ts';
import {
  FIELD_SHORTCUT_LEAVES,
  FKEY_COUNT,
  FKEY_MENU_ID,
  FKEY_ROLES,
  functionKeyAction,
  functionKeyNames,
  functionKeyNumber,
  LOBBY_SHORTCUT_LEAVES,
  type KeyLike,
} from '../client/src/input/shortcuts.ts';
import { autoKey, AUTO_RUN_FALLBACK, AUTO_WALK_FALLBACK, autoMoveAxes, autoMoveStart, stepAutoMove, type AutoMoveKeys } from '../client/src/input/automove.ts';
import { validateMenuEntry, type MenuRules } from '../client/src/classic/fieldmenu.ts';
import { lobbyMenuRules } from '../client/src/classic/lobby.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

const names = functionKeyNames();
const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

// 1. The default bindings: F1..F12 are bindings 20..31 (exe enum 20..31, names in order).
check(FKEY_COUNT === 12 && FKEY_ROLES.length === 12, 'twelve function keys and roles');
check(BINDING.functionKeyInfo === 20 && BINDING.mainMenu2 === 31, 'binding indexes 20 and 31');
check(FKEY_ROLES[1] === 'equipment_menu_shortcut' && FKEY_ROLES[11] === 'main_menu_2', 'exe role names');
check(names.join(',') === 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12', `default names ${names.join(',')}`);
check(functionKeyNumber('F5', names) === 5 && functionKeyNumber('F12', names) === 12, 'key name to F number (case-insensitive)');
check(functionKeyNumber('a', names) === 0 && functionKeyNumber('', names) === 0, 'non-function keys are 0');

// 2. The menu entries of F2..F8 (handle_player_menu_select ids; the exe's return values).
const want: Record<number, number> = { 2: 0x09, 3: 0x03, 4: 0x17, 5: 0x0e, 6: 0x13, 7: 0x12, 8: 0x25 };
for (const n of Object.keys(want)) check(FKEY_MENU_ID[Number(n)] === want[Number(n)], `F${n} -> 0x${want[Number(n)].toString(16)}`);
for (const n of [9, 10, 11]) check(functionKeyAction(key(`f${n}`), names) === null, `F${n} is not ported (null)`);
check(functionKeyAction(key('f1'), names)?.kind === 'help', 'plain F1 toggles the help list');
check(functionKeyAction(key('f1', { shiftKey: true }), names) === null, 'Shift+F1 is refused with the option clear');
check(functionKeyAction(key('f1', { ctrlKey: true }), names) === null, 'Ctrl+F1 is refused');
check(functionKeyAction(key('f12'), names)?.kind === 'mainMenu', 'F12 opens the main menu');
check(functionKeyAction(key('F12', { ctrlKey: true, altKey: true, shiftKey: true }), names)?.kind === 'mainMenu', 'F12 takes no modifier test');
check(functionKeyAction(key('f2'), names)?.kind === 'menu' && (functionKeyAction(key('f2'), names) as { id: number }).id === 0x09, 'plain F2 -> Equip');

// 3. Modifiers and the shift option (dump 682260: Ctrl / Alt none; Shift must be clear
// unless the character option 0x2000000 is set, then it must be held).
check(functionKeyAction(key('f3', { ctrlKey: true }), names) === null, 'Ctrl+F3 is none');
check(functionKeyAction(key('f3', { altKey: true }), names) === null, 'Alt+F3 is none (emotes)');
check(functionKeyAction(key('f3', { shiftKey: true }), names) === null, 'Shift+F3 with the option clear is none');
check(functionKeyAction(key('f3', { shiftKey: true }), names, true)?.kind === 'menu', 'Shift+F3 with the option set opens Technique');
check(functionKeyAction(key('f3'), names, true) === null, 'plain F3 with the option set is none');

// 4. Rebinding: the function key follows the live config (keyconfig.ts applyKeyConfig).
const saved = currentKeyConfig();
try {
  const cfg = defaultKeyConfig();
  writeBinding(cfg, BINDING.functionKeyInfo + 1, { type: 0, code: 0x10 }); // F2's row bound to 'a'
  writeBinding(cfg, BINDING.functionKeyInfo + 2, { type: 0, code: 0 }); // F3's row unbound
  applyKeyConfig(cfg);
  check(bindingKey(BINDING.functionKeyInfo + 1) === 'a', 'bindingKey reads the live config');
  const live = functionKeyNames();
  check(live[1] === 'a' && live[2] === '', `rebound names ${live.slice(0, 3).join(',')}`);
  check(functionKeyAction(key('a'), live)?.kind === 'menu', 'the rebound key opens the shortcut');
  check(functionKeyAction(key('f2'), live) === null, 'the old key no longer does');
  check(functionKeyAction(key(''), live) === null, 'an unbound row takes no key');
  check(readBinding(cfg, BINDING.functionKeyInfo + 2).type === 0, 'config write round-trips');
} finally {
  applyKeyConfig(saved);
}
check(functionKeyNames()[1] === 'f2', 'the default config is restored');

// 5. The menu entries: the field's leaves and the lobby's, with ValidateMenuItemCondition's rules.
const field: MenuRules = { lobby: false, safe: false, online: true, questStarted: false, inTeam: false };
const fieldSafe: MenuRules = { ...field, safe: true };
check(FIELD_SHORTCUT_LEAVES.has(0x09) && FIELD_SHORTCUT_LEAVES.has(0x03) && FIELD_SHORTCUT_LEAVES.has(0x17), 'field has Equip, Technique, MAG');
check(FIELD_SHORTCUT_LEAVES.has(0x0e) && FIELD_SHORTCUT_LEAVES.has(0x12) && FIELD_SHORTCUT_LEAVES.has(0x13) && FIELD_SHORTCUT_LEAVES.has(0x25), 'field has the shared Home leaves (Guild Card, Symbol Chat, Simple Mail, Team Member List)');
check(validateMenuEntry(0x25, field).enabled === false && validateMenuEntry(0x25, { ...field, inTeam: true }).enabled, 'Team Member List needs a team in the field');
check(validateMenuEntry(0x0e, field).enabled && validateMenuEntry(0x13, field).enabled, 'Guild Card and Simple Mail enabled in the field');
check(validateMenuEntry(0x09, field).enabled && validateMenuEntry(0x17, field).enabled, 'Equip and MAG enabled in the field');
check(validateMenuEntry(0x03, fieldSafe).enabled === false && validateMenuEntry(0x03, field).enabled, 'Technique off on a safe map only');
check(validateMenuEntry(0x09, lobbyMenuRules(false)).enabled === false, 'Equip off in the lobby');
check(validateMenuEntry(0x17, lobbyMenuRules(false)).enabled === false, 'MAG off in the lobby');
check(LOBBY_SHORTCUT_LEAVES.has(0x0e) && LOBBY_SHORTCUT_LEAVES.has(0x12) && LOBBY_SHORTCUT_LEAVES.has(0x13) && LOBBY_SHORTCUT_LEAVES.has(0x25), 'lobby has Guild Card, Symbol Chat, Simple Mail, Team');
check(validateMenuEntry(0x0e, lobbyMenuRules(false)).enabled && validateMenuEntry(0x13, lobbyMenuRules(false)).enabled, 'Guild Card and Simple Mail enabled in the lobby');
check(validateMenuEntry(0x12, lobbyMenuRules(false)).enabled, 'Symbol Chat enabled in the lobby');
check(validateMenuEntry(0x25, lobbyMenuRules(false)).enabled === false, 'Team list off without a team');
check(validateMenuEntry(0x25, lobbyMenuRules(true)).enabled, 'Team list on in a team');

// 6. Auto run / auto walk (the exe's toggles: run from off or walk, walk from off or run,
// neither with Alt; a movement key turns the setting off in this port).
const none: AutoMoveKeys = { run: false, walk: false, direction: false };
const runPress: AutoMoveKeys = { run: true, walk: false, direction: false };
const walkPress: AutoMoveKeys = { run: false, walk: true, direction: false };
let s = autoMoveStart();
s = stepAutoMove(s, runPress);
check(s.mode === 'run', 'Q from off turns auto run on');
s = stepAutoMove(s, { ...runPress });
check(s.mode === 'run', 'a held Q is no second edge');
s = stepAutoMove(s, none);
s = stepAutoMove(s, runPress);
check(s.mode === 'off', 'Q again turns it off');
s = stepAutoMove(s, none);
s = stepAutoMove(s, walkPress);
check(s.mode === 'walk', 'E from off turns auto walk on');
s = stepAutoMove(s, none);
s = stepAutoMove(s, runPress);
check(s.mode === 'run', 'Q while walking switches to run');
s = stepAutoMove(s, none);
s = stepAutoMove(s, walkPress);
check(s.mode === 'walk', 'E while running switches to walk');
s = stepAutoMove(s, { run: false, walk: false, direction: true });
check(s.mode === 'off', 'a direction key turns the setting off');
check(stepAutoMove(autoMoveStart(), { ...none, direction: true }).mode === 'off', 'a direction key with the setting off stays off');

check(autoMoveAxes('off') === null, 'no auto move: no axes');
const run = autoMoveAxes('run');
const walk = autoMoveAxes('walk');
check(run !== null && run.fb === 128 && run.lr === 0, 'auto run pushes full forward');
check(walk !== null && walk.fb === 64 && walk.lr === 0, 'auto walk pushes half forward');
// The mover's keyboard pace is the sum of squares over 128 squared; RUN_THRESHOLD is 0.75.
check(run !== null && (run.fb * run.fb) / (128 * 128) > 0.75, 'auto run is above the run threshold');
check(walk !== null && (walk.fb * walk.fb) / (128 * 128) < 0.75, 'auto walk is below the run threshold');

check(autoKey('', AUTO_RUN_FALLBACK) === 'q' && autoKey('', AUTO_WALK_FALLBACK) === 'e', 'unbound rows fall back to the manual keys Q and E');
check(autoKey('x', AUTO_RUN_FALLBACK) === 'x', 'a bound row keeps its key');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('shortcuts: all checks pass');

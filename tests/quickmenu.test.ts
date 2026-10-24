// The End-key quick menu (the model): the tab mapping (UpdateQuickMenuTabFromCharacterOption,
// dump 712540, bytes 00 03 06 09 at 0x00972f78), the cursor's start and step (quick_menu_constructor
// dump 711577..711597, InformationCounterListWindow_HandleInput dump 712096), the traps and
// Android rules (should_have_traps_quick_menu, dump 712522), the lobby motion menu's rows
// (0x00972ea0) and the gui positions (0x00971f40).
// Run: node tests/quickmenu.test.ts
import {
  QUICK_MENU_GUI,
  QUICK_MENU_LOBBY_CURSOR,
  QUICK_MENU_LOBBY_TAB,
  QUICK_MENU_MOTION_ROWS,
  QUICK_MENU_TAB_TABLE,
  quickMenuShouldHaveTraps,
  quickMenuStartCursor,
  quickMenuStepCursor,
  quickMenuTabFor,
} from '../client/src/classic/quickmenu.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
}

// Walks the cursor n steps from `start`, returning the visited cursors.
function walk(start: number, n: number, traps: boolean, android: boolean): number[] {
  const out: number[] = [];
  let c = start;
  for (let i = 0; i < n; i++) {
    c = quickMenuStepCursor(c, traps, android);
    out.push(c);
  }
  return out;
}

// Tab mapping: the bytes at 0x00972f78 are 00 03 06 09.
check('tabs: the mapping table is 00 03 06 09 (exe 0x00972f78)', QUICK_MENU_TAB_TABLE.join(',') === '0,3,6,9');
check('tabs: cursor 0 is the weapon tab (state 0)', quickMenuTabFor(0) === 0);
check('tabs: cursor 1 is tab 3', quickMenuTabFor(1) === 3);
check('tabs: cursor 2 (traps) is tab 6', quickMenuTabFor(2) === 6);
check('tabs: cursor 3 is the technique tab (9)', quickMenuTabFor(3) === 9);
check('tabs: the lobby cursor 0xff is tab 0x0c (the motion menu)', quickMenuTabFor(QUICK_MENU_LOBBY_CURSOR) === QUICK_MENU_LOBBY_TAB && QUICK_MENU_LOBBY_TAB === 0x0c);

// Traps: battle mode or Android (should_have_traps_quick_menu).
check('traps: battle mode has traps', quickMenuShouldHaveTraps(true, false));
check('traps: an Android has traps outside battle', quickMenuShouldHaveTraps(false, true));
check('traps: a normal field player has none', !quickMenuShouldHaveTraps(false, false));

// Stepping. Non-Android, with traps: 0 1 2 3 0.
check('step: with traps the cursor visits 0 1 2 3 and wraps', walk(0, 5, true, false).join(',') === '1,2,3,0,1');
// No traps: the 2 is skipped (to 3).
check('step: without traps 2 is skipped', walk(0, 4, false, false).join(',') === '1,3,0,1');
// Android: 3 is skipped (to 0), traps are on.
check('step: an Android skips 3 (goes to 0)', walk(1, 3, true, true).join(',') === '2,0,1');
check('step: an Android from 2 goes to 0', quickMenuStepCursor(2, true, true) === 0);
check('step: from 3 without traps wraps to 0', quickMenuStepCursor(3, false, false) === 0);

// Start cursor (the character option mode, quick_menu_constructor).
check('start: mode 0 starts on 0', quickMenuStartCursor(0, false, false) === 0);
check('start: mode 2 with traps stays on 2', quickMenuStartCursor(2, true, false) === 2);
check('start: mode 2 without traps moves to 3', quickMenuStartCursor(2, false, false) === 3);
check('start: an Android on mode 3 starts on 0', quickMenuStartCursor(3, true, true) === 0);
check('start: a human on mode 3 stays on 3', quickMenuStartCursor(3, false, false) === 3);

// The lobby motion menu (case 0xc / 0xe, the 12-byte table at 0x00972ea0): 8 categories.
check('motions: 8 categories', QUICK_MENU_MOTION_ROWS.length === 8);
check('motions: row 0 is Greeting (unitxt 0x42 0x0a, 5 entries, value base 2)', QUICK_MENU_MOTION_ROWS[0].textBase === 0x0a && QUICK_MENU_MOTION_ROWS[0].count === 5 && QUICK_MENU_MOTION_ROWS[0].valueBase === 2);
check('motions: row 7 is Photon Chair (0x08, 2 entries)', QUICK_MENU_MOTION_ROWS[7].textBase === 8 && QUICK_MENU_MOTION_ROWS[7].count === 2);

// GUI positions: get_gui_position(n) = 0x00971f40 + 8n.
check('gui: gui 1 (weapon / technique list) is (13, 317)', QUICK_MENU_GUI.list.x === 13 && QUICK_MENU_GUI.list.y === 317);
check('gui: gui 2 (two-handed list) is (324, 256)', QUICK_MENU_GUI.twoHandedList.x === 324 && QUICK_MENU_GUI.twoHandedList.y === 256);
check('gui: gui 0xe1 (motion list) is (13, 276)', QUICK_MENU_GUI.motionList.x === 13 && QUICK_MENU_GUI.motionList.y === 276);
check('gui: gui 0xe2 (motion sub-list) is (13, 317)', QUICK_MENU_GUI.motionSubList.x === 13 && QUICK_MENU_GUI.motionSubList.y === 317);

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

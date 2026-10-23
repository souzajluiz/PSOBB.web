// The Quest Board window of the field main menu (classic/questboard.ts): the
// menu entry's rule, the items shown by their display registers (r74 + slot),
// the keys and the owner's states, the HUD flag 0x10, the menu wiring
// (classic/fieldmenu.ts), and the quest board text's wait for the decide key
// (quest/vm.ts disp_msg_qb / add_msg) on newserv's "Maximum Attack 4th Stage
// -1C-" (q146), whose "Number of kills" item shows two lines.
// Run: node tests/questboard.test.ts
// Env: NEWSERV (newserv checkout; default: vendor/newserv of the main checkout).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldMenu, validateMenuEntry, type FieldMenuEnv, type MenuRules } from '../client/src/classic/fieldmenu.ts';
import { STATUS_HIDING_FLAGS } from '../client/src/classic/hud.ts';
import {
  HUD_FLAG_QUEST_BOARD,
  QUEST_BOARD_MENU_ID,
  QuestBoardWindow,
  SLOT_REGISTER,
  type QuestBoardEnv,
  type QuestBoardThread,
  type QuestBoardVM,
} from '../client/src/classic/questboard.ts';
import { prsDecompress } from '../client/src/formats/prs.ts';
import { parseQuestBin } from '../client/src/formats/questbin.ts';
import { QuestVM, type QuestBoardItem, type QuestMessage } from '../client/src/quest/vm.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};

// --- the menu entry (ValidateMenuItemCondition_00732620: g_QuestStarted) ---
const rules = (questStarted: boolean): MenuRules => ({ lobby: false, safe: true, online: true, questStarted, inTeam: false });
eq(QUEST_BOARD_MENU_ID, 0xf, 'menu id 0xF');
eq(validateMenuEntry(0xf, rules(false)), { id: 0x10, enabled: false }, 'no quest: "cannot be used" (0x10)');
eq(validateMenuEntry(0xf, rules(true)), { id: 0xf, enabled: true }, 'quest running: enabled');
eq(STATUS_HIDING_FLAGS & HUD_FLAG_QUEST_BOARD, 0x10, 'HUD flag 0x10 closes the status window');

// --- a fake VM ---
class FakeThread implements QuestBoardThread {
  done = false;
  readonly label: number;
  constructor(label: number) {
    this.label = label;
  }
}
class FakeVM implements QuestBoardVM {
  questBoard: QuestBoardItem[] = [
    { index: 0, label: 10, name: 'Zero' },
    { index: 1, label: 11, name: 'One' },
    { index: 3, label: 13, name: 'Three' },
    { index: 5, label: 15, name: 'Five' },
  ];
  regsI = new Int32Array(256);
  threads: FakeThread[] = [];
  startThread(label: number, runner: 2): FakeThread {
    eq(runner, 2, 'board threads run on quest_run_thread_2');
    const t = new FakeThread(label);
    this.threads.push(t);
    return t;
  }
}
const vm = new FakeVM();
let hud = 0;
const questKeys: string[] = [];
const env: QuestBoardEnv = {
  questKey: (e) => {
    questKeys.push(e.key);
    return true;
  },
  vm: () => vm,
  questName: () => 'Test Quest',
  text: () => '',
  setHudFlag: (bit, on) => (hud = on ? hud | bit : hud & ~bit),
};
const key = (w: QuestBoardWindow, k: string) => w.key({ key: k } as KeyboardEvent);

// Items show by their registers: r75 and r77 (slots 1 and 3) only.
vm.regsI[SLOT_REGISTER + 1] = 1;
vm.regsI[SLOT_REGISTER + 3] = 2; // any value but 0 (quest_read_register != 0)
eq(SLOT_REGISTER, 74, 'slot 0 is r74');
const sounds: number[] = [];
const w = new QuestBoardWindow(env, 1, (id) => sounds.push(id));
eq(sounds, [0x572], 'opens with SE 0x572');
eq(hud & 0x10, 0x10, 'HUD flag 0x10 set when it opens');
eq(w.shown, [false, true, false, true, false, false], 'slot images: r75, r77');
eq([w.cursor, w.itemName], [1, 'One'], 'the first set slot is selected');
sounds.length = 0;
key(w, 'ArrowRight');
eq([w.cursor, w.itemName, sounds], [3, 'Three', [0x56f]], 'Right: next set slot, SE 0x56F');
key(w, 'ArrowRight');
eq(w.cursor, 1, 'Right wraps over slots 0..5 to a set slot');
key(w, 'ArrowLeft');
eq(w.cursor, 3, 'Left wraps back');
// The selection follows the registers each frame while the slot is not set;
// the images stay as they were at open.
vm.regsI[SLOT_REGISTER + 3] = 0;
w.tick();
eq([w.cursor, w.shown[3]], [1, true], 'slot 3 cleared: the selection moves on, its image stays');
vm.regsI[SLOT_REGISTER + 3] = 1;

// Decide: SE 0x570, the item's thread on runner 2, the keys locked until it ends.
w.tick(); // state 0 -> 2
sounds.length = 0;
key(w, 'Enter');
eq([sounds, w.locked], [[0x570], true], 'decide: SE 0x570, locked');
w.tick(); // 2 -> 3
w.tick(); // 3 -> start the thread, 4
eq([w.state, vm.threads.map((t) => t.label)], [4, [11]], 'the selected item\'s label runs');
key(w, 'ArrowRight');
key(w, 'Enter');
key(w, 'Backspace');
eq([w.cursor, w.locked, w.finished], [1, true, false], 'no moves, no cancel while the thread runs');
eq(questKeys, ['ArrowRight', 'Enter', 'Backspace'], 'the keys go to the quest overlay (its list, the board text)');
w.tick();
eq(w.state, 4, 'waits for the thread');
vm.threads[0].done = true;
w.tick();
w.tick();
eq([w.state, w.locked], [2, false], 'the thread ended: keys again');

// Cancel: SE 0x585, state 5.
sounds.length = 0;
key(w, 'Backspace');
w.tick();
eq([sounds, w.finished], [[0x585], true], 'cancel: SE 0x585, done');
w.close();
eq([hud & 0x10, sounds], [0, [0x585, 0x573]], 'destroyed: HUD flag cleared, closes with SE 0x573');

// Nothing set: no selection, no decide (bit 4), cancel still works.
const none = new FakeVM();
const w0 = new QuestBoardWindow({ ...env, vm: () => none }, 1, () => {});
eq([w0.cursor, w0.itemName, w0.flags & 4], [-1, null, 4], 'no item: nothing selected, bit 4');
key(w0, 'Enter');
eq(w0.locked, false, 'no decide without items');
key(w0, 'Escape');
w0.tick();
w0.tick();
eq(w0.finished, true, 'Escape cancels');
w0.close();

// Slot 6 (r80): get_quest_board_slot_enabled takes it, the start loop reaches
// it, and from it the next try is 7 - 6 = 1.
const six = new FakeVM();
six.regsI[SLOT_REGISTER + 6] = 1;
six.regsI[SLOT_REGISTER + 0] = 0;
const w6 = new QuestBoardWindow({ ...env, vm: () => six }, 1, () => {});
eq([w6.flags & 4, w6.cursor], [4, -1], 'only r80 set: no slot image, so bit 4');
w6.close();

// --- the menu: Item Pack > Quest Board, back to the same entry ---
hud = 0;
let started = true;
const menuEnv = {
  text: () => '',
  rules: () => rules(started),
  android: () => false,
  itemPack: {},
  equip: {},
  tech: {},
  mag: {},
  areaMap: {},
  questBoard: env,
  options: { text: () => '', flags: () => null, setFlags: () => {}, send: () => {}, padConnected: () => false },
} as unknown as FieldMenuEnv;
const fm = new FieldMenu(menuEnv);
const press = (k: string) => fm.key({ key: k } as KeyboardEvent);
fm.toggle();
// the exe ignores keys for 2 frames after the menu opens (MainMenu.toggle)
fm.tick(); fm.tick();
press('Enter'); // Item Pack
for (let i = 0; i < 5; i++) press('ArrowDown'); // Equip, Items, MAG, Trade, Area Map, Quest Board
press('Enter');
eq([fm.questBoard !== null, fm.menu.leafOpen, hud & 0x10], [true, true, 0x10], 'Item Pack > Quest Board opens the window');
for (let i = 0; i < 6; i++) fm.tick();
press('Backspace');
for (let i = 0; i < 12; i++) fm.tick();
eq([fm.questBoard, fm.menu.leafOpen, fm.isOpen, hud & 0x10], [null, false, true, 0], 'Backspace: back to the menu');
press('Enter');
eq(fm.questBoard !== null, true, 'the cursor stayed on Quest Board');
fm.close();
for (let i = 0; i < 12; i++) fm.tick();
eq([fm.questBoard, hud & 0x10], [null, 0], 'closing the menu destroys it');
press('Enter'); // the menu is closed: nothing
fm.toggle();
// the exe ignores keys for 2 frames after the menu opens (MainMenu.toggle)
fm.tick(); fm.tick();
press('Enter');
for (let i = 0; i < 5; i++) press('ArrowDown');
press('Enter');
fm.closeQuestBoard();
eq([fm.questBoard, hud & 0x10, fm.menu.leafOpen], [null, 0, false], 'closeQuestBoard (floor change)');
started = false;
fm.close();
fm.toggle();
// the exe ignores keys for 2 frames after the menu opens (MainMenu.toggle)
fm.tick(); fm.tick();
press('Enter');
for (let i = 0; i < 5; i++) press('ArrowDown');
press('Enter');
eq(fm.questBoard, null, 'no quest: the entry does not open');

// --- the quest board text waits for the decide key (q146 label 0x9C) ---
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN_ROOT = (() => {
  try {
    return dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: HERE, encoding: 'utf8' }).trim());
  } catch {
    return join(HERE, '..');
  }
})();
const NEWSERV = [process.env.NEWSERV, join(HERE, '../vendor/newserv'), join(MAIN_ROOT, 'vendor/newserv')].find((d) => d && existsSync(join(d, 'system/quests')));
const q146 = NEWSERV && join(NEWSERV, 'system/quests/events/q146-bb-e.bin');
if (!q146 || !existsSync(q146)) {
  console.log('SKIP the q146 board thread (no newserv checkout)');
} else {
  const shown: QuestMessage[] = [];
  const closed: string[] = [];
  let blocking = true;
  const qvm = new QuestVM({
    bin: parseQuestBin(prsDecompress(new Uint8Array(readFileSync(q146)))),
    host: {
      showMessage: (m) => shown.push(m),
      closeMessage: (k) => closed.push(k),
      uiBlockingInput: () => blocking,
    },
  });
  qvm.regsI[118] = 42;
  const t = qvm.startThread(0x9c, 2);
  qvm.frame();
  eq([shown.map((m) => [m.kind, m.pages[0], m.append ?? false]), t?.yieldReason, qvm.boardWaiting], [[['questBoard', 'You currently cleared...', false]], 'board', true], 'disp_msg_qb shows and waits');
  qvm.frame();
  eq(shown.length, 1, 'still waiting without the key');
  qvm.dismissBoard();
  qvm.frame();
  eq([shown[1]?.pages[0], shown[1]?.append, t?.yieldReason], ['<r118> enemies.', true, 'board'], 'add_msg adds a line and waits');
  qvm.dismissBoard();
  qvm.frame();
  eq([closed, t?.done, qvm.questBoardOpen], [['questBoard'], true, false], 'close_msg_qb, ret: the thread ends');
  // The menu closes while the text waits: quest_run_thread_2 resets the
  // dialogs and ends the thread.
  const t2 = qvm.startThread(0x9c, 2);
  qvm.frame();
  blocking = false;
  qvm.frame();
  eq([t2?.done, qvm.questBoardOpen, closed.at(-1)], [true, false, 'questBoard'], 'the UI let go: the board thread ends');
  // A runner 1 thread keeps waiting, also through a dialog reset / close
  // (only the decide key releases it).
  const t3 = qvm.startThread(0x9c, 1);
  qvm.frame();
  qvm.resetDialogs();
  qvm.frame();
  eq([t3?.done, t3?.yieldReason, qvm.boardWaiting], [false, 'board', true], 'runner 1 ignores the UI; still waits after the text closed');
  qvm.dismissBoard();
  qvm.frame();
  eq(t3?.yieldReason, 'message', 'with the board text closed add_msg speaks instead (opcode_add_msg)');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('questboard: all checks passed');

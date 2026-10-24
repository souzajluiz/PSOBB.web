// The End-key quick menu (the model): the tab mapping (UpdateQuickMenuTabFromCharacterOption,
// dump 712540, bytes 00 03 06 09 at 0x00972f78), the cursor's start and step (quick_menu_constructor
// dump 711577..711597, InformationCounterListWindow_HandleInput dump 712096), the traps and
// Android rules (should_have_traps_quick_menu, dump 712522), the lobby motion menu's rows
// (0x00972ea0) and the gui positions (0x00971f40).
// Run: node tests/quickmenu.test.ts
import {
  ATTACK_BIT_EQUIPPABLE,
  QM_SOUND_CANCEL,
  quickMenuMotionCategoryRows,
  quickMenuMotionSubRows,
  quickMenuStepBack,
  quickMenuTechRows,
  quickMenuWeaponRows,
  QUICK_MENU_TECH_COUNT,
} from '../client/src/classic/quickmenu.ts';
import { QuickMenu, type QuickMenuEnv } from '../client/src/classic/quickmenuwindow.ts';
import { KEYS } from '../client/src/input/keyconfig.ts';
import { SLOT_WEAPON } from '../client/src/net/items.ts';
import {
  QUICK_MENU_GUI,
  canCreateChallengeTrapManager,
  compareToggle,
  isTwoHandedTabItem,
  itemAttackDataBits,
  techniqueRows,
  techniqueSwapKey,
  toolPendingAction,
  toolTabStep,
  toolTechSlotId,
  trapDecide,
  trapRows,
  trapStatusCount,
  trapStockCount,
  twoHandedTabRows,
  type QuickMenuItemFacts,
  type TrapDecideInput,
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
check('gui: gui 2 (the weapon compare list) is (324, 256)', QUICK_MENU_GUI.compareList.x === 324 && QUICK_MENU_GUI.compareList.y === 256);
check('gui: gui 0xe1 (motion list) is (13, 276)', QUICK_MENU_GUI.motionList.x === 13 && QUICK_MENU_GUI.motionList.y === 276);
check('gui: gui 0xe2 (motion sub-list) is (13, 317)', QUICK_MENU_GUI.motionSubList.x === 13 && QUICK_MENU_GUI.motionSubList.y === 317);


// ---- Rows and the window (quickmenu.ts row builders, quickmenuwindow.ts QuickMenu) ----

// Fake inventory: a weapon equipped (id 0x100), an unequipped weapon (0x101), a wrapped weapon
// (0x102, data1[4] & 0x40), an armor (0x103, data1[0] = 1).
const weapon = (id: number, equipped: boolean, wrapped = false) => ({
  equipped,
  data: { id, data1: new Uint8Array([0, 1, 0, 0, wrapped ? 0x40 : 0]) },
});
const armor = { equipped: false, data: { id: 0x103, data1: new Uint8Array([1, 1, 0, 0, 0]) } };
const INV = [weapon(0x100, true), weapon(0x101, false), weapon(0x102, false, true), armor];
const nameOf = (it: { data: { id: number } }) => `item${it.data.id.toString(16)}`;

const rowsW = quickMenuWeaponRows(INV, nameOf);
check('weapons: the unequipped weapon, then the equipped one (wrapped and armor left out)',
  rowsW.map((r) => r.value).join(',') === '257,256', rowsW.map((r) => r.value).join(','));
check('weapons: the labels come from the item name', rowsW[0].label === 'item101');

const TEXT = (g: number, i: number) => `t${g}.${i}`;
const learnedOnly = (t: number) => (t === 0 || t === 18 ? 1 : null);
const techRows = quickMenuTechRows(TEXT, learnedOnly, true);
check('techniques: 19 rows', techRows.length === QUICK_MENU_TECH_COUNT && techRows.length === 19);
check('techniques: an unlearned technique is disabled', techRows[1].enabled === false && techRows[0].enabled === true);
check('techniques: label is unitxt group 5 by technique number', techRows[18].label === 't5.18');
check('techniques: a learned technique that cannot be cast here is drawn in the red colour',
  quickMenuTechRows(TEXT, learnedOnly, false)[0].color === '#fd3901' && quickMenuTechRows(TEXT, learnedOnly, true)[0].color === undefined);

const cats = quickMenuMotionCategoryRows(TEXT);
check('motions: 8 categories, unitxt group 0x42 indices 0..7', cats.length === 8 && cats[3].label === 't66.3' && cats[3].value === 3);
const sub1 = quickMenuMotionSubRows(1, TEXT);
check('motions: category 1 has 5 rows, text 15+k, values 7+k', sub1.length === 5 && sub1[0].label === 't66.15' && sub1[4].value === 11);
check('motions: a bad category has no rows', quickMenuMotionSubRows(9, TEXT).length === 0);

check('step back: 0 goes to 3 (no traps, human)', quickMenuStepBack(0, false, false) === 3);
check('step back: 3 goes to 1 without traps', quickMenuStepBack(3, false, false) === 1);
check('step back: 0 goes to 3 with traps', quickMenuStepBack(0, true, false) === 3);
check('step back: an Android 0 goes to 2 (skips 3)', quickMenuStepBack(0, true, true) === 2);

// The window: a fake env that records the actions.
function fakeEnv(opts: { character?: boolean; canCast?: boolean; allowed?: boolean } = {}) {
  const calls: string[] = [];
  const env: QuickMenuEnv = {
    text: TEXT,
    character: () => (opts.character === false ? null : ({ inventory: INV } as never)),
    itemName: nameOf,
    tech: {
      text: TEXT,
      level: learnedOnly,
      canCast: () => opts.canCast ?? true,
      cast: (t) => {
        calls.push(`cast ${t}`);
        return true;
      },
    },
    equip: {
      equip: (id, slot) => calls.push(`equip ${id.toString(16)} ${slot}`),
      unequip: (id) => calls.push(`unequip ${id.toString(16)}`),
    },
    allowed: () => opts.allowed ?? true,
    emote: (slot) => calls.push(`emote ${slot}`),
  };
  return { env, calls };
}
const key = (k: string) => ({ key: k });

{
  const { env, calls } = fakeEnv();
  const m = new QuickMenu(env, { lobby: false, mode: 0, traps: false, android: false });
  check('window: a field menu starts on the weapon tab (state 0)', m.tab === 0 && m.open);
  m.key(key(KEYS.selectRight));
  check('window: Right steps to the two-handed tab (state 3), which has no rows here', m.tab === 3 && m.rows().length === 0);
  m.key(key(KEYS.selectRight));
  check('window: Right again skips 2 (no traps) to the technique tab (9)', m.tab === 9);
  m.key(key(KEYS.selectRight));
  check('window: Right from 9 wraps to the weapon tab (0)', m.tab === 0);
  const w = new QuickMenu(env, { lobby: false, mode: 0, traps: false, android: false });
  w.key(key(KEYS.decide));
  check('window: deciding a weapon equips it in the weapon slot, then the menu closes',
    calls.join(';') === 'unequip 100;equip 101 ' + SLOT_WEAPON && !w.open, calls.join(';'));
}
{
  const { env, calls } = fakeEnv({ allowed: false });
  const m = new QuickMenu(env, { lobby: false, mode: 0, traps: false, android: false });
  m.key(key(KEYS.decide));
  check('window: a weapon is not equipped when the action is not allowed (the menu stays open)', calls.length === 0 && m.open);
}
{
  const { env, calls } = fakeEnv();
  const m = new QuickMenu(env, { lobby: false, mode: 3, traps: false, android: false });
  check('window: mode 3 starts on the technique tab (9)', m.tab === 9);
  m.key(key(KEYS.decide));
  check('window: the cursor 0 technique is learned, cast, and the menu closes', calls.join(';') === 'cast 0' && !m.open, calls.join(';'));
}
{
  const { env, calls } = fakeEnv({ canCast: false });
  const m = new QuickMenu(env, { lobby: false, mode: 3, traps: false, android: false });
  m.key(key(KEYS.decide));
  check('window: a technique is not cast on a safe map (the menu stays open)', calls.length === 0 && m.open);
}
{
  const { env, calls } = fakeEnv();
  const m = new QuickMenu(env, { lobby: true, mode: 0, traps: false, android: false });
  check('window: the lobby starts on the motion tab (0x0c)', m.tab === 0x0c && m.lobby);
  m.key(key(KEYS.selectDown));
  m.key(key(KEYS.decide));
  check('window: deciding a category opens its sub-list (category 1 has 5 rows)', m.rows().length === 5 && m.open);
  m.key(key('escape'));
  check('window: Cancel in a sub-list goes back to the categories', m.rows().length === 8 && m.open);
  m.key(key(KEYS.decide));
  check('window: the category cursor stayed on 1, so deciding reopens it', m.rows().length === 5);
  m.key(key(KEYS.selectDown));
  m.key(key(KEYS.decide));
  check('window: deciding a motion sends its emote slot (category 1 row 1 = slot 8) and closes',
    calls.join(';') === 'emote 8' && !m.open, calls.join(';'));
}
check('gui: gui 1 (every tab list) is (13, 317)', QUICK_MENU_GUI.list.x === 13 && QUICK_MENU_GUI.list.y === 317);
check('gui: gui 2 (weapon compare list) is (324, 256)', QUICK_MENU_GUI.compareList.x === 324 && QUICK_MENU_GUI.compareList.y === 256 && QUICK_MENU_GUI.compareList.gui === 2);
check('gui: gui 0xe1 (motion list) is (13, 276)', QUICK_MENU_GUI.motionList.x === 13 && QUICK_MENU_GUI.motionList.y === 276);
check('gui: gui 0xe2 (motion sub-list) is (13, 317)', QUICK_MENU_GUI.motionSubList.x === 13 && QUICK_MENU_GUI.motionSubList.y === 317);

// ---- Tab rows and actions (2026-10-23) ----
const tool = (over: Partial<QuickMenuItemFacts> = {}): QuickMenuItemFacts => ({
  group1: 3, group2: 0, groupIdx: 0, dwItemFlags: 0, equipCheckBits: 0, rare: false, ...over,
});

// Attack data bits (GetItemAttackData_005c50b4, asm 5c50b4..5c510f).
check('attack: mask passes only the masked bits', itemAttackDataBits(tool({ equipCheckBits: 0x0d }), ATTACK_BIT_EQUIPPABLE) === 0);
check('attack: checker bit 2 shows for mask 2', itemAttackDataBits(tool({ equipCheckBits: 0x02 }), 2) === 2);
check('attack: dwItemFlags 0x200 adds bit 2 on a zero result', itemAttackDataBits(tool({ dwItemFlags: 0x200 }), 2) === 2);
check('attack: dwItemFlags 0x80 gives 0x10 when the result is 0', itemAttackDataBits(tool({ dwItemFlags: 0x80 }), 0x10) === 0x10);
check('attack: 0x80 does not replace a nonzero masked result', itemAttackDataBits(tool({ equipCheckBits: 0x02, dwItemFlags: 0x80 }), 0x12) === 2);
check('attack: the 0x80 fix-up is taken after the mask (mask 2 stays 0)', itemAttackDataBits(tool({ equipCheckBits: 0x01, dwItemFlags: 0x80 }), 2) === 0);

// Two-handed tab (PopulateTwoHandedWeapons 0x74b620): bit 2, not bit 1, not rare.
check('two-handed: a tool with bit 2 and no bit 1 is in the tab', isTwoHandedTabItem(tool({ equipCheckBits: 0x02 })));
check('two-handed: bit 1 (blocked here) keeps it out', !isTwoHandedTabItem(tool({ equipCheckBits: 0x03 })));
check('two-handed: a rare item is out', !isTwoHandedTabItem(tool({ equipCheckBits: 0x02, rare: true })));
check('two-handed: no bit 2 is out', !isTwoHandedTabItem(tool({ equipCheckBits: 0x00 })));
check('two-handed: a non-tool with dwItemFlags 0x200 is in (no group check in the populate)', isTwoHandedTabItem(tool({ group1: 0, dwItemFlags: 0x200 })));
const invRows = [
  { instanceId: 10, facts: tool({ equipCheckBits: 0x02 }) },
  { instanceId: 11, facts: tool({ equipCheckBits: 0x00 }) },
  { instanceId: 12, facts: tool({ equipCheckBits: 0x02, rare: true }) },
  { instanceId: 13, facts: tool({ equipCheckBits: 0x02 }) },
];
check('two-handed rows: inventory order, filtered', twoHandedTabRows(invRows).map((r) => r.instanceId).join(',') === '10,13');
check('two-handed rows: an empty inventory gives no rows', twoHandedTabRows([]).length === 0);

// Tool slot (GetToolTechSlotId 0x5de4d8: group_2 at +0xf3, group_idx at +0xf4).
check('slot: class 0 variants 0..2 are slots 0..2', toolTechSlotId(0, 0) === 0 && toolTechSlotId(0, 1) === 1 && toolTechSlotId(0, 2) === 2);
check('slot: class 1 variants 0..2 are slots 3..5', toolTechSlotId(1, 0) === 3 && toolTechSlotId(1, 2) === 5);
check('slot: class 3 is slot 8, class 4 is 9, class 5 is 10', toolTechSlotId(3, 7) === 8 && toolTechSlotId(4, 0) === 9 && toolTechSlotId(5, 9) === 10);
check('slot: class 6 variants 0/1 are 6/7, class 7 is 0xb, class 8 is 0xc', toolTechSlotId(6, 0) === 6 && toolTechSlotId(6, 1) === 7 && toolTechSlotId(7, 0) === 0x0b && toolTechSlotId(8, 0) === 0x0c);
check('slot: class 2 (technique scrolls) and unlisted variants have no slot', toolTechSlotId(2, 0) === -1 && toolTechSlotId(0, 3) === -1 && toolTechSlotId(6, 2) === -1);

// The player's pending action (ProcessToolTechUse 0x741c00, CanPerformAction 0x7a3790: slot 9 or 10, ready bit).
check('action: slot 9 with the ready bit sets action 4', JSON.stringify(toolPendingAction(9, true)) === '{"actionType":4,"slot":9}');
check('action: slot 10 with the ready bit sets action 4', toolPendingAction(10, true)?.slot === 10);
check('action: slot 8 is refused (8 < slot is strict)', toolPendingAction(8, true) === null);
check('action: slot 11 is refused', toolPendingAction(11, true) === null);
check('action: no ready bit, no action', toolPendingAction(9, false) === null);
check('action: no slot, no action', toolPendingAction(-1, true) === null);

// Tools tab state machine (update_quickmenu cases 3..5).
check('tools: state 3 goes to 4 on the same frame', toolTabStep(3, 0, false, true, true).state === 4);
check('tools: state 4 with list flag 4 closes', toolTabStep(4, 4, false, true, true).close === true);
check('tools: state 4 with list flag 2 goes to 5', toolTabStep(4, 2, false, true, true).state === 5 && !toolTabStep(4, 2, false, true, true).close);
check('tools: state 4 with no flags waits', toolTabStep(4, 0, false, true, true).state === 4 && !toolTabStep(4, 0, false, true, true).close);
check('tools: state 5 with key 0xd held cancels with SE 0x585', toolTabStep(5, 0, true, true, true).close && toolTabStep(5, 0, true, true, true).sound === QM_SOUND_CANCEL);
check('tools: state 5 with the action and an item uses it and closes', toolTabStep(5, 0, false, true, true).use === true && toolTabStep(5, 0, false, true, true).close === true);
check('tools: state 5 without the action waits', !toolTabStep(5, 0, false, false, true).use && !toolTabStep(5, 0, false, false, true).close);
check('tools: state 5 with no item waits', !toolTabStep(5, 0, false, true, false).use);

// Traps tab rows (ResetAndRefresh 0x74b9b4 -> the challenge status items 0x737ec4).
check('status: a signed byte 0..20 is the count', trapStatusCount(3) === 3 && trapStatusCount(20) === 20);
check('status: 21, negatives and the high bytes read as 0', trapStatusCount(21) === 0 && trapStatusCount(-1) === 0 && trapStatusCount(0xff) === 0);
check('stock: 0..99 is the count, outside is 0', trapStockCount(5) === 5 && trapStockCount(99) === 99 && trapStockCount(100) === 0 && trapStockCount(-3) === 0);
const safeRows = trapRows([3, 0, 20, 21], 5, true);
check('traps: rows with a count above 0 only, in index order', safeRows.map((r) => r.row).join(',') === '0,2,4');
check('traps: row 4 is the stock, label unitxt 0x11 0x17', safeRows[2].count === 5 && safeRows[2].labelId === 0x17 && safeRows[0].labelId === 0x13);
check('traps: a safe, non-boss map is not greyed', safeRows.every((r) => !r.disabled));
check('traps: an unsafe or boss map greys every row', trapRows([1], 1, false).every((r) => r.disabled));
check('traps: a stock of 100 hides row 4', trapRows([0, 0, 0, 0], 100, true).length === 0);
check('traps: a negative status hides its row', trapRows([-1, 0, 0, 0], 0, true).length === 0);

// Battle Mode trap manager (CreateSinowberillChallengeEntityManager 0x6b08b8).
check('trap manager: battle_spaceship (16) and battle_ruins (17) only', canCreateChallengeTrapManager(16, false) && canCreateChallengeTrapManager(17, false) && !canCreateChallengeTrapManager(15, false));
check('trap manager: not while one exists', !canCreateChallengeTrapManager(16, true));

// Traps decide (update_quickmenu case 8).
const td = (over: Partial<TrapDecideInput> = {}): TrapDecideInput => ({
  row: 2, keyHeld13: false, actionAllowed: true, uiGate: true, paletteBlocked: false, canPerform: true,
  stock: 4, status: 3, playerId: 7, map: 16, managerExists: false, ...over,
});
check('decide: key 0xd held cancels with SE 0x585', trapDecide(td({ keyHeld13: true })).sound === QM_SOUND_CANCEL && trapDecide(td({ keyHeld13: true })).close);
check('decide: no action allowed does nothing', trapDecide(td({ actionAllowed: false })).kind === 'none');
const pal = trapDecide(td({ row: 2, status: 3 }));
check('decide: row 0..3 sends the palette packet (sub 0x83, size 2, id, row, count) and closes', pal.kind === 'palette' && pal.close && JSON.stringify(pal.packet) === '{"sub":131,"size":2,"playerId":7,"row":2,"count":3}');
check('decide: a zero status sends nothing', trapDecide(td({ status: 0 })).kind === 'none' && !trapDecide(td({ status: 0 })).close);
check('decide: the element gate off sends nothing', trapDecide(td({ uiGate: false })).kind === 'none');
check('decide: palette blocked (0x32c == 2) sends nothing', trapDecide(td({ paletteBlocked: true })).kind === 'none');
check('decide: cannot perform sends nothing', trapDecide(td({ canPerform: false })).kind === 'none');
const trap = trapDecide(td({ row: 4, stock: 4, map: 16 }));
check('decide: row 4 on battle_spaceship makes a trap and takes one from the stock', trap.kind === 'trap' && trap.close && trap.stockAfter === 3);
check('decide: row 4 with an empty stock clamps to 0', trapDecide(td({ row: 4, stock: 0, map: 17 })).stockAfter === 0);
check('decide: row 4 off the battle maps does nothing', trapDecide(td({ row: 4, map: 1 })).kind === 'none');
check('decide: row 4 with a manager already up does nothing', trapDecide(td({ row: 4, managerExists: true })).kind === 'none');

// Weapon compare list (key 0xe held in state 1).
check('compare: opening sets the list open and clears bit 8', compareToggle(false).open && !compareToggle(false).uiBit8Set);
check('compare: closing sets bit 8', !compareToggle(true).open && compareToggle(true).uiBit8Set);

// Technique swap (update_quickmenu case 0xa, SwapTechniqueSlots 0x741d28).
const order = Array.from({ length: 19 }, (_, i) => i);
const first = techniqueSwapKey(-1, 4, order);
check('swap: the first press marks the selected row', first.pending === 4 && !first.changed && first.order.join() === order.join());
const second = techniqueSwapKey(4, 9, first.order);
check('swap: the second press swaps the two rows and clears the mark', second.pending === -1 && second.changed && second.order[4] === 9 && second.order[9] === 4);
check('swap: the same row twice keeps the order and sets changed', techniqueSwapKey(3, 3, order).order.join() === order.join() && techniqueSwapKey(3, 3, order).changed);
check('swap: the input order is not mutated', order[4] === 4);
const rows = techniqueRows(second.order);
check('swap: 19 rows, slot to tech id', rows.length === 19 && rows[4].techId === 9 && rows[18].slot === 18);

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

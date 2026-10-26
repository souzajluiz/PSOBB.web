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
import { DEFAULT_TECH_ORDER, QuickMenu, type QuickMenuEnv } from '../client/src/classic/quickmenuwindow.ts';
import { KEYS } from '../client/src/input/keyconfig.ts';
import { SLOT_WEAPON } from '../client/src/net/items.ts';
import { ItemPMT, type ItemCombination, type Tool } from '../client/src/formats/itempmt.ts';
import type { ItemData } from '../client/src/formats/itemnames.ts';
import { techMenuOrder, techMenuPayload, writeTechMenuOrder } from '../client/src/net/charfile.ts';
import { compareColor, equipStatRows, VALUE_COLOR, EQUIP_STAT_ROWS } from '../client/src/classic/itemdetail.ts';
import {
  classCheck,
  magCellUsable,
  techniqueMinMst,
  toolCheckerBits,
  toolCombinationPasses,
  type ToolCheckContext,
} from '../client/src/classic/quickmenu.ts';
import { CLASS_FLAGS } from '../client/src/combat/progression.ts';
import { techData } from '../client/src/combat/techniques.ts';
import {
  QUICK_MENU_GUI,
  canCreateChallengeTrapManager,
  compareToggle,
  isTwoHandedTabItem,
  itemAttackDataBits,
  techniqueRows,
  techniqueSwapKey,
  toolItemFacts,
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
function fakeEnv(opts: {
  character?: boolean;
  canCast?: boolean;
  allowed?: boolean;
  inv?: unknown[];
  stock?: number;
  statuses?: number[];
  safeNotBoss?: boolean;
  placeOk?: boolean;
  map?: number;
  managerExists?: boolean;
} = {}) {
  const calls: string[] = [];
  let order: number[] = [...DEFAULT_TECH_ORDER];
  const env: QuickMenuEnv = {
    text: TEXT,
    character: () => (opts.character === false ? null : ({ inventory: opts.inv ?? INV } as never)),
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
    tools: { use: (id) => calls.push(`use ${id.toString(16)}`) },
    isRare: () => false,
    toolChecks: () => toolFixture(),
    compareRows: () => null,
    traps: {
      statuses: () => opts.statuses ?? [0, 0, 0, 0],
      stock: () => opts.stock ?? 0,
      safeNotBoss: () => opts.safeNotBoss ?? true,
      map: () => opts.map ?? 0,
      managerExists: () => opts.managerExists ?? false,
      // Row 4 is the sonar (quest/battlerun.ts useSonar), not a trap placement.
      useSonar: () => {
        calls.push('sonar');
        return opts.placeOk ?? true;
      },
      sendStatus: (row, count) => calls.push(`status ${row} ${count}`),
    },
    techOrder: {
      get: () => order,
      set: (o) => {
        order = [...o];
        calls.push(`order ${o.slice(0, 6).join(',')}`);
      },
    },
  };
  return { env, calls, order: () => order };
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
check('decide: row 4 (the sonar stock, not a trap) on battle_spaceship uses the sonar and takes one from the stock', trap.kind === 'sonar' && trap.close && trap.stockAfter === 3 && trap.packet === null);
check('decide: row 4 with an empty stock clamps to 0', trapDecide(td({ row: 4, stock: 0, map: 17 })).stockAfter === 0);
check('decide: row 4 off the battle maps does nothing', trapDecide(td({ row: 4, map: 1 })).kind === 'none');
check('decide: row 4 with a manager already up does nothing', trapDecide(td({ row: 4, managerExists: true })).kind === 'none');
check('decide: row 4 is never a palette packet (it is the sonar, not the trap palette)', trapDecide(td({ row: 4, map: 16 })).kind !== 'palette');

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

// ---- Tools, traps, compare and swap in the window (2026-10-23) ----
const toolItem = (id: number, wrapped = false) => ({ equipped: false, data: { id, data1: new Uint8Array([3, 0, 0, 0, wrapped ? 0x40 : 0]) } });
const TOOL_INV = [weapon(0x100, true), toolItem(0x200), toolItem(0x201, true), toolItem(0x202)];

// Tool checker bits (CheckItemEquipConditions_005d5f40 tool branch, dump 427680; CanEquipItem
// dump 417953; the combination check, dump 418088). The flags are the tool's PMT +0x14 word.
// A tool at class 0 index 0 with flags 0x7f (Monomate-like: bit 0 set, the 0x10 / 0x20 flags set).
function toolFixture(over: Partial<ToolCheckContext> = {}): ToolCheckContext {
  return {
    pmt: fakePmt({ '0.0': 0x7f, '3.0': 0x7f, '12.0': 0x7f, '13.0': 0xfa, '10.0': 0x7b }), safeMap: true, bossMap: false, level: 10, charClass: 0, equipped: [], magStage: null,
    telepipe: true, challengeObject: false, questStarted: false, allowItemBit6: false, mst: 0x7fff, techLevels: [], statusType: 0, materialUsable: () => true,
    ...over,
  };
}
function fakePmt(flags: Record<string, number>, combinations: ItemCombination[] = []): ItemPMT {
  const pmt = new ItemPMT();
  for (const [key, f] of Object.entries(flags)) {
    const [c, i] = key.split('.').map(Number);
    pmt.tools[c] = pmt.tools[c] ?? [];
    pmt.tools[c][i] = { id: 0, type: 0, skin: 0, teamPoints: 0, amount: 0, tech: 0, cost: 0, itemFlags: f } as Tool;
  }
  pmt.combinations = combinations;
  return pmt;
}
const tools = (d1: number[], ctx: ToolCheckContext): boolean => isTwoHandedTabItem(toolItemFacts(new Uint8Array([...d1, 0, 0, 0]), false, ctx));
check('tools bits: an unwrapped tool with flag bit 0 set is in the tab', tools([3, 0, 0], toolFixture()));
check('tools bits: a wrapped tool is out (CanEquipItem is 0 for it)', !isTwoHandedTabItem(toolItemFacts(new Uint8Array([3, 0, 0, 0, 0x40]), false, toolFixture())));
check('tools bits: a weapon is not a tool row', !tools([0, 1, 0], toolFixture()));
check('tools bits: a rare tool is out', !isTwoHandedTabItem(toolItemFacts(new Uint8Array([3, 0, 0, 0, 0]), true, toolFixture())));
check('tools bits: the flag word 0x7f gives bit 2 and no bit 1 on a safe map', toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture()) === 0x06);
check('tools bits: flag 0x2 clear adds 0x10', (toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture({ pmt: fakePmt({ '0.0': 0x7d }) })) & 0x10) !== 0);
check('tools bits: flag 0x10 clear on an unsafe map blocks (bit 1)', (toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture({ pmt: fakePmt({ '0.0': 0x03 }), safeMap: false })) & 1) !== 0);
check('tools bits: flag 0x10 set on an unsafe map does not block', (toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture({ safeMap: false })) & 1) === 0);
check('tools bits: flag 0x20 clear on a boss map blocks', (toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture({ pmt: fakePmt({ '0.0': 0x1f }), bossMap: true })) & 1) !== 0);
check('tools bits: a grinder (class 0x0a) with no weapon equipped is blocked', !tools([3, 10, 0], toolFixture()));
check('tools bits: a grinder with a weapon equipped is not blocked here', tools([3, 10, 0], toolFixture({ equipped: [{ data1: new Uint8Array([0, 1, 0, 0]), magLevel: 0 }] })));
// Flag bit 0 clear: the combination check (exactly one equipped slot must match a row).
const TOOL_13 = { '13.0': 0xfa };
check('tools bits: flag bit 0 clear with no combination row is out', !tools([13, 0, 0], toolFixture({ pmt: fakePmt(TOOL_13) })));
// The row: used item = class 13 (bytes 13,0,0), equipped = a weapon (bytes 0,1,any); all else wild.
const ROW_ANY_ITEM: ItemCombination = { usedItem: 13 << 16, equippedItem: 0x0001ff, resultItem: 0, magLevel: 0xff, grind: 0xff, level: 0xff, charClass: 0xff };
const weaponEq = { data1: new Uint8Array([0, 1, 0, 3]), magLevel: 0 };
check('tools bits: a matching combination row with the equipped weapon passes', toolCombinationPasses(new Uint8Array([13, 0, 0]), toolFixture({ pmt: fakePmt(TOOL_13, [ROW_ANY_ITEM]), equipped: [weaponEq] })));
check('tools bits: two matching equipped slots fail (exactly one)', !toolCombinationPasses(new Uint8Array([13, 0, 0]), toolFixture({ pmt: fakePmt(TOOL_13, [ROW_ANY_ITEM]), equipped: [weaponEq, weaponEq] })));
check('tools bits: the row grind above the weapon grind fails', !toolCombinationPasses(new Uint8Array([13, 0, 0]), toolFixture({ pmt: fakePmt(TOOL_13, [{ ...ROW_ANY_ITEM, grind: 5 }]), equipped: [weaponEq] })));
check('tools bits: the row class must be the character class', !toolCombinationPasses(new Uint8Array([13, 0, 0]), toolFixture({ pmt: fakePmt(TOOL_13, [{ ...ROW_ANY_ITEM, charClass: 3 }]), equipped: [weaponEq] })));
check('tools bits: the row level above the character level fails', !toolCombinationPasses(new Uint8Array([13, 0, 0]), toolFixture({ pmt: fakePmt(TOOL_13, [{ ...ROW_ANY_ITEM, level: 20 }]), equipped: [weaponEq] })));
// A mag cell (class 0x0c, flag bit 0 set) needs a mag below stage 4.
check('tools bits: a mag cell with no mag is out', !tools([3, 12, 0], toolFixture()));
// A mag for the cell rule: data1 [2, type, level, 0, def, pow, dex, mind] (words at +4..+11),
// data2 [synchro, IQ, flags, color]. Stats are raw (value / 100 is the level).
const magEq = (level: number, stats: [number, number, number, number] = [0, 0, 0, 0], iq = 0, sync = 0) => {
  const d1 = new Uint8Array(12);
  d1[0] = 2;
  d1[2] = level;
  stats.forEach((v, i) => {
    d1[4 + i * 2] = v & 0xff;
    d1[5 + i * 2] = (v >> 8) & 0xff;
  });
  return { data1: d1, data2: new Uint8Array([sync, iq, 0, 0]), magLevel: level };
};
check('tools bits: a mag cell with a mag below stage 4 is in', tools([3, 12, 0], toolFixture({ magStage: 2, equipped: [magEq(100)] })));
check('tools bits: a mag cell with a mag at stage 4 is out', !tools([3, 12, 0], toolFixture({ magStage: 4, equipped: [magEq(100)] })));
// can_use_030C_mag_cell (dump 432721), by the cell's variant (data1[2]).
check('mag cell 0: a mag of level 100 is usable', magCellUsable(0, magEq(100)));
check('mag cell 0: a mag of level 99 is not', !magCellUsable(0, magEq(99)));
check('mag cell 1 and 3 use the level rule too', magCellUsable(1, magEq(100)) && magCellUsable(3, magEq(100)) && !magCellUsable(3, magEq(99)));
check('mag cell 2: two stats above 69 whole levels', magCellUsable(2, magEq(1, [7000, 7000, 0, 0])));
check('mag cell 2: one stat above 69 is not enough', !magCellUsable(2, magEq(1, [7000, 6900, 6900, 6900])));
check('mag cell 4: level 120, IQ 180 and synchro 110', magCellUsable(4, magEq(120, [0, 0, 0, 0], 180, 110)));
check('mag cell 4: synchro 109 fails', !magCellUsable(4, magEq(120, [0, 0, 0, 0], 180, 109)));
check('mag cell 4: IQ 179 fails', !magCellUsable(4, magEq(120, [0, 0, 0, 0], 179, 110)));
check('mag cell 4: level 119 fails', !magCellUsable(4, magEq(119, [0, 0, 0, 0], 180, 110)));
check('mag cell 5: all four stats above 34', magCellUsable(5, magEq(1, [3500, 3500, 3500, 3500])));
check('mag cell 5: one stat at 34 fails', !magCellUsable(5, magEq(1, [3500, 3500, 3400, 3500])));
check('mag cell: no mag is not usable', !magCellUsable(0, null));
check('mag cell: variant 6 and up are not usable', !magCellUsable(6, magEq(200, [9999, 9999, 9999, 9999], 200, 120)));
check('tools bits: a mag cell variant 0 with no mag is blocked', !tools([3, 12, 0], toolFixture({ equipped: [] })));
check('tools bits: a mag cell variant 0 with a level 50 mag is blocked', !tools([3, 12, 0], toolFixture({ equipped: [magEq(50)] })));
check('tools bits: a mag cell variant 0 with a level 100 mag is in', tools([3, 12, 0], toolFixture({ magStage: 0, equipped: [magEq(100)] })));
check('tools bits: a mag cell variant 6 is blocked even with a strong mag', !tools([3, 12, 6], toolFixture({ pmt: fakePmt({ '12.6': 0x7f }), magStage: 0, equipped: [magEq(200)] })));

// The rest of CheckItemEquipConditions_005d5f40's tool branch (dump names: class_check,
// IsTelepipeEnabled, GetTechniqueData / CalculateEffectiveTechniqueLevel / GetPMTTechniqueValue,
// the grinder's max_grind, can_use_material, the antidote's 0x25c test).
{
  const blocked = (b: number) => (b & 1) !== 0;
  // class_check(0xd7): the android flags pass, the HUmar flags (0x25: hunter, 0x4) fail.
  check('class_check: the android flags (0x31) pass 0xd7', classCheck(0x31, 0xd7));
  check('class_check: the HUmar flags (0x25) fail 0xd7', !classCheck(0x25, 0xd7));
  check('class_check: CLASS_FLAGS[2] (android) passes 0xd7', classCheck(CLASS_FLAGS[2], 0xd7));
  const hunterFlag = fakePmt({ '0.0': 0x77 }); // flag 0x8 clear, so the class test runs
  // The dump blocks on a nonzero class_check when flag 0x8 is clear (`(flags & 8) == 0 && iVar6 != 0`).
  check('tools bits: flag 0x8 clear and class_check failing does not block (HUmar)', !blocked(toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture({ pmt: hunterFlag, charClass: 0 }))));
  check('tools bits: flag 0x8 clear and class_check passing blocks (android)', blocked(toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture({ pmt: hunterFlag, charClass: 2 }))));
  check('tools bits: flag 0x8 set skips class_check', !blocked(toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture({ pmt: fakePmt({ '0.0': 0x7f }), charClass: 0 }))));
  check('tools bits: flag 0x40 clear in a challenge game blocks (g_ChallengeObject)', blocked(toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture({ pmt: fakePmt({ '0.0': 0x3f }), challengeObject: true, charClass: 2 }))));
  check('tools bits: flag 0x40 set in a challenge game does not block', !blocked(toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture({ pmt: fakePmt({ '0.0': 0x7f }), challengeObject: true, charClass: 2 }))));
  check('tools bits: a tool missing from the PMT skips the flag tests (no flag blocks)', !blocked(toolCheckerBits(new Uint8Array([3, 0, 5, 0, 0]), toolFixture({ safeMap: false, bossMap: true, challengeObject: true, charClass: 2 }))) );
  // Class 6: the antidote (variant 0) needs status type 0x0f, the antiparalysis (variant 1) 0x10.
  check('class 6: antidote with poison (0x0f) is in', !blocked(toolCheckerBits(new Uint8Array([3, 6, 0, 0, 0]), toolFixture({ statusType: 0x0f }))));
  check('class 6: antidote without poison is blocked', blocked(toolCheckerBits(new Uint8Array([3, 6, 0, 0, 0]), toolFixture({ statusType: 0 }))));
  check('class 6: antiparalysis with paralysis (0x10) is in', !blocked(toolCheckerBits(new Uint8Array([3, 6, 1, 0, 0]), toolFixture({ statusType: 0x10 }))));
  check('class 6: antiparalysis with poison is blocked', blocked(toolCheckerBits(new Uint8Array([3, 6, 1, 0, 0]), toolFixture({ statusType: 0x0f }))));
  check('class 6: a variant above 1 is not tested', !blocked(toolCheckerBits(new Uint8Array([3, 6, 2, 0, 0]), toolFixture({ statusType: 0 }))));
  // Class 7: the Telepipe needs IsTelepipeEnabled.
  check('class 7: the Telepipe is blocked when the pipe is not allowed', blocked(toolCheckerBits(new Uint8Array([3, 7, 0, 0, 0]), toolFixture({ telepipe: false }))));
  check('class 7: the Telepipe is in when the pipe is allowed', !blocked(toolCheckerBits(new Uint8Array([3, 7, 0, 0, 0]), toolFixture({ telepipe: true }))));
  // Class 0x0a: the weapon's grind (data1[3]) must be below its PMT max_grind.
  const weaponPmt = (maxGrind: number): ItemPMT => {
    const p = fakePmt({ '10.0': 0x7f });
    (p as unknown as { getWeapon: () => { maxGrind: number } }).getWeapon = () => ({ maxGrind });
    return p;
  };
  const grinderWeapon = (grind: number) => ({ data1: new Uint8Array([0, 1, 0, grind]), magLevel: 0 });
  check('grinder: a weapon below its max grind is in', !blocked(toolCheckerBits(new Uint8Array([3, 10, 0, 0, 0]), toolFixture({ pmt: weaponPmt(10), equipped: [grinderWeapon(9)] }))));
  check('grinder: a weapon at its max grind is blocked', blocked(toolCheckerBits(new Uint8Array([3, 10, 0, 0, 0]), toolFixture({ pmt: weaponPmt(10), equipped: [grinderWeapon(10)] }))));
  check('grinder: a weapon with no PMT entry is not blocked by the grind', !blocked(toolCheckerBits(new Uint8Array([3, 10, 0, 0, 0]), toolFixture({ equipped: [grinderWeapon(200)] }))));
  // Class 0x0b: the material use check (combat/materials.ts), variants 0..6.
  check('material: a usable material is in', !blocked(toolCheckerBits(new Uint8Array([3, 11, 0, 0, 0]), toolFixture({ materialUsable: () => true }))));
  check('material: an unusable material is blocked', blocked(toolCheckerBits(new Uint8Array([3, 11, 3, 0, 0]), toolFixture({ materialUsable: () => false }))));
  check('material: a variant above 6 is not tested', !blocked(toolCheckerBits(new Uint8Array([3, 11, 9, 0, 0]), toolFixture({ materialUsable: () => false }))));
  // Class 0x0f: the armour rule. No armour equipped blocks (proven: the get_equipment_slot null path).
  // With armour, the slot count (ASSUMED data1[5]) must be 3 or less (vtable +0x94 above 3 blocks).
  const armour = (slots: number) => ({ data1: new Uint8Array([1, 1, 0, 0, 0, slots]), magLevel: 0 });
  const armourTool = new Uint8Array([3, 0x0f, 0, 0, 0]);
  check('armour: no armour equipped blocks the slot tool', blocked(toolCheckerBits(armourTool, toolFixture({ equipped: [] }))));
  check('armour: a shield alone does not count as armour (class 2)', blocked(toolCheckerBits(armourTool, toolFixture({ equipped: [{ data1: new Uint8Array([1, 2, 0, 0, 0, 0]), magLevel: 0 }] }))));
  check('armour: slot count 3 is in', !blocked(toolCheckerBits(armourTool, toolFixture({ equipped: [armour(3)] }))));
  check('armour: slot count 4 is blocked', blocked(toolCheckerBits(armourTool, toolFixture({ equipped: [armour(4)] }))));
  // The second challenge rule (0x005d5f9a): a quest running, a group 3 item, and F85D arg 6 (0x40).
  check('challenge rule: a tool with a quest running and bit 0x40 is blocked', blocked(toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture({ questStarted: true, allowItemBit6: true }))));
  check('challenge rule: no quest running does not block', !blocked(toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture({ questStarted: false, allowItemBit6: true }))));
  check('challenge rule: bit 0x40 clear does not block', !blocked(toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0]), toolFixture({ questStarted: true, allowItemBit6: false }))));
  check('challenge rule: a wrapped tool stays out (returns before the rule)', toolCheckerBits(new Uint8Array([3, 0, 0, 0, 0x40]), toolFixture({ questStarted: true, allowItemBit6: true })) === 0);
  // Class 2: the technique scroll. The MST needs the requirement, a learned level blocks an equal or
  // lower scroll, the class maximum caps the level (0xff: cannot learn).
  const tech = 3;
  const need = techniqueMinMst(tech);
  const scroll = new Uint8Array([3, 2, 4, 0, tech]);
  const sPmt = fakePmt({ '2.3': 0x7f });
  sPmt.maxTechLevels[tech] = [14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14];
  check('technique: the MST at the requirement is in', !blocked(toolCheckerBits(scroll, toolFixture({ pmt: sPmt, mst: need }))));
  check('technique: the MST below the requirement is blocked', blocked(toolCheckerBits(scroll, toolFixture({ pmt: sPmt, mst: need - 1 }))));
  check('technique: a learned level equal to the scroll level blocks', blocked(toolCheckerBits(scroll, toolFixture({ pmt: sPmt, mst: 0x7fff, techLevels: [...new Array(tech).fill(null), 5] }))));
  check('technique: a learned level above the scroll level blocks', blocked(toolCheckerBits(scroll, toolFixture({ pmt: sPmt, mst: 0x7fff, techLevels: [...new Array(tech).fill(null), 6] }))));
  check('technique: a learned level below the scroll level is in', !blocked(toolCheckerBits(scroll, toolFixture({ pmt: sPmt, mst: 0x7fff, techLevels: [...new Array(tech).fill(null), 4] }))));
  const capped = fakePmt({ '2.3': 0x7f });
  capped.maxTechLevels[tech] = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3];
  check('technique: a scroll above the class maximum is blocked', blocked(toolCheckerBits(scroll, toolFixture({ pmt: capped, mst: 0x7fff }))));
  const noLearn = fakePmt({ '2.3': 0x7f });
  noLearn.maxTechLevels[tech] = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  check('technique: a technique the class cannot learn (0xff) is blocked', blocked(toolCheckerBits(scroll, toolFixture({ pmt: noLearn, mst: 0x7fff }))));
  check('technique: the MST requirement is a signed short', techniqueMinMst(tech) === ((techData(tech, 0).charge << 16) >> 16));
}
// The populate's stat rows (equipStatRows, the same as the equipment panel): six rows in label order.
{
  const cur = { atp: 100, dfp: 10, mst: 5, ata: 20, evp: 8, lck: 3 };
  const item = { id: 1, data1: new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) } as unknown as ItemData;
  const rows = equipStatRows(cur, item, null, new ItemPMT(), true, true);
  check('compare rows: six stats in the panel order ATP, DFP, MST, ATA, EVP, LCK', rows.map((r) => r.key).join(',') === 'atp,dfp,mst,ata,evp,lck' && EQUIP_STAT_ROWS.length === 6);
  check('compare rows: colour formula (equal white, lower cyan, higher orange)', compareColor(5, 5) === VALUE_COLOR.same && compareColor(4, 5) === VALUE_COLOR.lower && compareColor(6, 5) === VALUE_COLOR.higher);
}

{
  const { env, calls } = fakeEnv({ inv: TOOL_INV });
  const m = new QuickMenu(env, { lobby: false, mode: 0, traps: false, android: false });
  m.key(key(KEYS.selectRight));
  check('tools: the tab lists the unwrapped tools, by instance id', m.tab === 3 && m.rows().map((r) => r.value.toString(16)).join(',') === '200,202', m.rows().map((r) => r.value.toString(16)).join(','));
  m.key(key(KEYS.decide));
  check('tools: deciding a tool uses it (items.use, 6x27) and the menu closes', calls.join(';') === 'use 200' && !m.open, calls.join(';'));
}
{
  const { env, calls } = fakeEnv({ inv: TOOL_INV, allowed: false });
  const m = new QuickMenu(env, { lobby: false, mode: 0, traps: false, android: false });
  m.key(key(KEYS.selectRight));
  m.key(key(KEYS.decide));
  check('tools: not allowed, nothing is used and the menu stays open', calls.length === 0 && m.open);
}

// Traps: rows 0..3 are the challenge statuses (6x60 sub 0x83), row 4 is the Battle Mode stock.
{
  const { env, calls } = fakeEnv({ stock: 3, statuses: [0, 2, 0, 0], map: 16 });
  const m = new QuickMenu(env, { lobby: false, mode: 2, traps: true, android: false });
  check('traps: mode 2 with traps starts on the traps tab (6)', m.tab === 6);
  check('traps: the rows with a count are 1 (status 2) and 4 (stock 3)', m.rows().map((r) => r.value).join(',') === '1,4', m.rows().map((r) => r.value).join(','));
  m.key(key(KEYS.decide));
  check('traps: a status row sends sub 0x83 (row 1, count 2) and the menu closes', calls.join(';') === 'status 1 2' && !m.open, calls.join(';'));
}
{
  const { env, calls } = fakeEnv({ stock: 3, statuses: [0, 2, 0, 0], map: 16 });
  const m = new QuickMenu(env, { lobby: false, mode: 2, traps: true, android: false });
  m.key(key(KEYS.selectDown));
  m.key(key(KEYS.decide));
  check('traps: row 4 uses the sonar from the stock and the menu closes', calls.join(';') === 'sonar' && !m.open, calls.join(';'));
}
{
  const { env, calls } = fakeEnv({ stock: 3, map: 0 });
  const m = new QuickMenu(env, { lobby: false, mode: 2, traps: true, android: false });
  m.key(key(KEYS.decide));
  check('traps: row 4 off the battle maps does nothing (the menu stays open)', calls.length === 0 && m.open, calls.join(';'));
}
{
  const { env, calls } = fakeEnv({ stock: 3, map: 16, placeOk: false });
  const m = new QuickMenu(env, { lobby: false, mode: 2, traps: true, android: false });
  m.key(key(KEYS.selectDown));
  m.key(key(KEYS.decide));
  check('traps: a refused sonar use keeps the menu open', calls.join(';') === 'sonar' && m.open, calls.join(';'));
}
{
  const { env, calls } = fakeEnv({ stock: 3, statuses: [0, 2, 0, 0], map: 16, safeNotBoss: false });
  const m = new QuickMenu(env, { lobby: false, mode: 2, traps: true, android: false });
  m.key(key(KEYS.decide));
  check('traps: greyed rows (a hub or a boss map) cannot be chosen', calls.length === 0 && m.open);
}

// Weapon compare: Tab (g_KeyboardSharedState[0xe]) toggles the gui 2 list on the weapon tab; a tab change closes it.
{
  const { env } = fakeEnv();
  const m = new QuickMenu(env, { lobby: false, mode: 0, traps: false, android: false });
  m.key({ key: 'Tab' });
  m.key(key(KEYS.selectRight));
  check('compare: the list is open, so the tab does not step', m.tab === 0);
  m.key({ key: 'Tab' });
  m.key(key(KEYS.selectRight));
  check('compare: closed again, the tab steps to 3 (no traps: 2 is skipped)', m.tab === 3);
}

// Technique swap: Tab marks a row, the next press swaps it with the selected row.
{
  const { env, calls, order } = fakeEnv();
  const m = new QuickMenu(env, { lobby: false, mode: 3, traps: false, android: false });
  for (let i = 0; i < 4; i++) m.key(key(KEYS.selectDown));
  m.key({ key: 'Tab' });
  check('swap: the first press marks the row and changes nothing', calls.length === 0 && order().join() === DEFAULT_TECH_ORDER.join());
  for (let i = 0; i < 5; i++) m.key(key(KEYS.selectDown));
  m.key({ key: 'Tab' });
  check('swap: the second press swaps the marked and the selected rows', order()[4] === 9 && order()[9] === 4, order().join());
  check('swap: the list shows the new order (row 4 is tech 9)', m.rows()[4]?.value === 9);
  check('swap: the change is written once (order 0,1,2,3,9,5)', calls.join(';') === 'order 0,1,2,3,9,5', calls.join(';'));
}

// The End key closes the open quick menu (update_quickmenu, dump 711664).
{
  const { env } = fakeEnv();
  const m = new QuickMenu(env, { lobby: false, mode: 0, traps: false, android: false });
  m.key(key(KEYS.symbolChat));
  check('End: closes the menu', !m.open);
}

// The technique order's save (tech_menu at data offset 0x2DF8) and the ED 06 body (u32 0, then the 40 bytes).
{
  const save = new Uint8Array(0x3994);
  check('tech order: a zero save has no order (the default is used)', techMenuOrder(save) === null);
  const order = Array.from({ length: 19 }, (_, i) => (i * 7) % 19);
  writeTechMenuOrder(save, order);
  check('tech order: the order round-trips through the save', techMenuOrder(save)?.join(',') === order.join(','));
  check('tech order: the save bytes are the u16 ids at 0x2DF8', new DataView(save.buffer).getUint16(0x2df8 + 2, true) === order[1]);
  const body = techMenuPayload(order);
  check('tech order: ED 06 body is 44 bytes (u32 0, tech_menu 40)', body.length === 44 && body.subarray(0, 4).every((b) => b === 0));
  check('tech order: ED 06 carries the ids as u16 from +4', new DataView(body.buffer).getUint16(4 + 2 * 3, true) === order[3]);
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

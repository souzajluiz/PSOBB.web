// The action palette editor (Main menu > Customize, client/src/classic/customize.ts): the slot
// layout against parsePalette, the hotbar and palette-slot writes (PsoBB.exe dump 717407..717439,
// 718358..718426), the action grid decoded from the exe (tables 0x009737e0 / 0x00973880, dump
// 562653 / 562657; movement 718731; labels 717482; availability 597294), the 07ED body and the save
// upload (E7 then 05, dump 811320 / 811346), and the window's keys and close rule (dump 717267).
// Run: node tests/customize.test.ts
import { applyKeyConfig, KEYS } from '../client/src/input/keyconfig.ts';
import { parsePalette } from '../client/src/classic/palette.ts';
import {
  actionCells,
  actionEnabled,
  actionText,
  assignHotbar,
  assignPaletteSlot,
  CONFIG_SIZE,
  CustomizeMenu,
  customizeBody,
  HOTBAR_FIRST,
  readRow,
  slotOffset,
  writeRow,
  type CustomizeEnv,
} from '../client/src/classic/customize.ts';
import { BBSession } from '../client/src/net/bbsession.ts';
import { E7_SIZE } from '../client/src/net/charfile.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// A config with a known palette: palette 0 bottom = attack 1, left = technique 4, right = item 2;
// hotbar 1 = item 0, hotbar 2 = technique 0 (disabled bit set on hotbar 3 to check it is kept).
function sample(): Uint8Array {
  const c = new Uint8Array(CONFIG_SIZE);
  writeRow(c, 0, 0, { group1: 2, group2: 1 });
  writeRow(c, 0, 1, { group1: 3, group2: 4 });
  writeRow(c, 0, 2, { group1: 4, group2: 2 });
  writeRow(c, 0, HOTBAR_FIRST, { group1: 4, group2: 0 });
  writeRow(c, 0, HOTBAR_FIRST + 1, { group1: 3, group2: 0 });
  c[slotOffset(0, HOTBAR_FIRST + 2) + 2] = 1; // disabled flag on hotbar 3
  return c;
}

// The fake environment: every technique in `learned` is learned; the state holds the config.
function fakeEnv(
  learned: Set<number>,
  save: (c: Uint8Array) => void = () => {},
  state: { config: Uint8Array } = { config: sample() },
  extra: Partial<CustomizeEnv> = {},
): CustomizeEnv {
  return {
    text: (g, i) => `g${g}:${i}`,
    learned: (t) => learned.has(t),
    hasItem: () => true,
    weaponEquipped: () => false,
    trapStock: () => 0,
    android: () => false,
    config: () => new Uint8Array(state.config),
    setConfig: (c) => {
      state.config = new Uint8Array(c);
    },
    save,
    ...extra,
  };
}

const press = (k: string) => ({ key: k, repeat: false }) as KeyboardEvent;

applyKeyConfig(null);

// 1. Layout: the offsets are the palette.ts ones (base 4, 0x38 per palette, slots at +4 + 4i).
{
  const c = sample();
  eq(slotOffset(0, 0), 8, 'palette 0 bottom slot offset');
  eq(slotOffset(1, 0), 4 + 0x38 + 4, 'palette 1 bottom slot offset');
  eq(slotOffset(0, HOTBAR_FIRST), 4 + 4 + 12, 'hotbar 1 offset (palette_slots[3])');
  const p = parsePalette(c);
  eq(p.palettes[0].slots[0], { group1: 2, group2: 1, disabled: false }, 'parsePalette bottom matches the writes');
  eq(p.palettes[0].hotbar[0], { group1: 4, group2: 0, disabled: false }, 'parsePalette hotbar 1 matches flat index 3');
  eq(p.palettes[0].hotbar[2].disabled, true, 'parsePalette hotbar 3 disabled bit');
}

// 2. Hotbar: an empty action goes into the slot in both palettes; the flags stay.
{
  const c = sample();
  assignHotbar(c, HOTBAR_FIRST + 2, { group1: 2, group2: 0 });
  eq(readRow(c, 0, HOTBAR_FIRST + 2), { group1: 2, group2: 0 }, 'hotbar 3 takes the attack (palette 0)');
  eq(readRow(c, 1, HOTBAR_FIRST + 2), { group1: 2, group2: 0 }, 'hotbar 3 takes the attack (palette 1)');
  eq(c[slotOffset(0, HOTBAR_FIRST + 2) + 2], 1, 'the disabled flag is kept');
}

// 3. Hotbar: the same action in another hotbar slot moves (the other is cleared in both palettes).
{
  const c = sample();
  assignHotbar(c, HOTBAR_FIRST + 2, { group1: 4, group2: 0 }); // item 0 is already in hotbar 1
  eq(readRow(c, 0, HOTBAR_FIRST), { group1: 0, group2: 0 }, 'the old hotbar 1 is cleared');
  eq(readRow(c, 1, HOTBAR_FIRST), { group1: 0, group2: 0 }, 'the old hotbar 1 is cleared in palette 1');
  eq(readRow(c, 0, HOTBAR_FIRST + 2), { group1: 4, group2: 0 }, 'hotbar 3 takes item 0');
}

// 4. Hotbar toggle: the same action on the slot that already has it clears it (both palettes).
{
  const c = sample();
  assignHotbar(c, HOTBAR_FIRST, { group1: 4, group2: 0 });
  eq(readRow(c, 0, HOTBAR_FIRST), { group1: 0, group2: 0 }, 'toggle clears hotbar 1 in palette 0');
  eq(readRow(c, 1, HOTBAR_FIRST), { group1: 0, group2: 0 }, 'toggle clears hotbar 1 in palette 1');
}

// 5. Palette slot: writes only the window's palette (flip state 1 here), toggle clears it.
{
  const c = sample();
  assignPaletteSlot(c, 1, 0, { group1: 3, group2: 9 });
  eq(readRow(c, 1, 0), { group1: 3, group2: 9 }, 'palette 1 bottom takes the technique');
  eq(readRow(c, 0, 0), { group1: 2, group2: 1 }, 'palette 0 bottom is untouched');
  assignPaletteSlot(c, 0, 0, { group1: 2, group2: 1 });
  eq(readRow(c, 0, 0), { group1: 0, group2: 0 }, 'palette slot toggle clears the same action');
}

// 6. Palette slot reset (ResetDefaultPalette, 718426): the action leaves the other 3-slot entries of palette 0
// (only palette 0 is read there); hotbar entries keep it.
{
  const c = sample();
  assignPaletteSlot(c, 0, 2, { group1: 3, group2: 4 }); // technique 4 sits on the left slot
  eq(readRow(c, 0, 1), { group1: 0, group2: 0 }, 'the left slot loses the technique');
  eq(readRow(c, 0, 2), { group1: 3, group2: 4 }, 'the right slot takes it');
  eq(readRow(c, 0, HOTBAR_FIRST + 1), { group1: 3, group2: 0 }, 'hotbar entries are not touched by the palette reset');
  const d = sample();
  writeRow(d, 1, 1, { group1: 3, group2: 5 });
  assignPaletteSlot(d, 0, 2, { group1: 3, group2: 5 });
  eq(readRow(d, 1, 1), { group1: 3, group2: 5 }, 'palette 1 is not cleared by the palette 0 reset');
}

// 7. The 07ED body: the 0xE8 config, a copy; a wrong size is refused.
{
  const c = sample();
  const b = customizeBody(c);
  eq(b.length, CONFIG_SIZE, '07ED body is 0xE8 bytes');
  check(b !== c && b[8] === c[8], 'body is a copy of the config');
  let threw = false;
  try {
    customizeBody(new Uint8Array(10));
  } catch {
    threw = true;
  }
  check(threw, 'a short config is refused');
}

// 8. The action grid (exe tables 0x009737e0 fleshie, 0x00973880 android): fleshie is 13 rows (attacks,
// techniques, items), android 6 rows (attacks, items, traps; no techniques). Empty cells keep their place.
// Labels: group 7 0x13 + action (attacks), group 5 (techniques), group 7 0x16 + action (items, traps).
{
  const fleshie = actionCells(false);
  eq(fleshie.length, 39, 'fleshie: 13 rows of 3 cells');
  eq(fleshie[0], [2, 0], 'fleshie row 0 starts with the Attack');
  eq(fleshie[2], [2, 2], 'fleshie row 0 ends with the Extra Attack');
  eq(fleshie[3], [3, 0], 'fleshie row 1 starts with technique 0 (Foie)');
  eq(fleshie[14], [0, 0], 'a technique row ends with an empty cell');
  eq(
    fleshie.filter(([c]) => c === 3).map(([, a]) => a).sort((x, y) => x - y),
    Array.from({ length: 19 }, (_, i) => i),
    'all 19 techniques, once each',
  );
  eq(
    fleshie.filter(([c]) => c === 4).map(([, a]) => a),
    Array.from({ length: 13 }, (_, i) => i),
    'items 0..12 in order',
  );
  check(!fleshie.some(([c, a]) => c === 4 && a >= 13), 'fleshie has no traps');
  const android = actionCells(true);
  eq(android.length, 18, 'android: 6 rows of 3 cells');
  check(!android.some(([c]) => c === 3), 'android has no techniques');
  eq(
    android.filter(([c]) => c === 4).map(([, a]) => a),
    [0, 1, 2, 9, 10, 11, 8, 13, 14, 15, 16],
    'android items and traps',
  );
  const env = fakeEnv(new Set([0, 4]));
  eq(actionText(2, 2, env.text), 'g7:21', 'attack label: group 7 0x13 + 2');
  eq(actionText(3, 4, env.text), 'g5:4', 'technique label: group 5');
  eq(actionText(4, 13, env.text), 'g7:35', 'trap label: group 7 0x16 + 13');
  eq(actionText(0, 0, env.text), '', 'an empty cell has no label');
  eq(actionEnabled(3, 4, env), true, 'a learned technique is enabled');
  eq(actionEnabled(3, 5, env), false, 'an unlearned technique is disabled');
  eq(actionEnabled(2, 2, env), false, 'Extra Attack needs an equipped weapon');
  eq(actionEnabled(2, 1, env), true, 'Heavy Attack is always enabled');
  eq(actionEnabled(4, 0, env), true, 'an item in the bag is enabled');
  eq(actionEnabled(4, 13, env), false, 'a trap with no stock is disabled');
  eq(actionEnabled(4, 13, fakeEnv(new Set(), () => {}, undefined, { trapStock: () => 2 })), true, 'a trap with stock is enabled');
  eq(actionEnabled(0, 0, env), false, 'an empty cell is never enabled');
}

// 9. The window: the slot list is Left / Bottom / Right and starts on Bottom; Decide opens the grid at (0, 0);
// Decide writes the slot and returns to the list; a number key writes the hotbar; a Cancel in the grid marks a
// change; a Cancel with nothing done sends nothing; closing with a change sends the config once.
{
  const saved: Uint8Array[] = [];
  const state = { config: sample() };
  const env = fakeEnv(new Set([0, 4]), (c) => saved.push(new Uint8Array(c)), state);
  const decide = press(KEYS.decide);
  const cancel = press(KEYS.cancel);

  const idle = new CustomizeMenu(env);
  check(idle.key(cancel) === false, 'Cancel on the slot list closes the window');
  eq(saved.length, 0, 'no change: nothing sent');

  const m = new CustomizeMenu(env);
  m.key(decide); // slot list -> grid, cursor (0, 0) = Attack
  m.key(press(KEYS.selectRight));
  m.key(press(KEYS.selectRight)); // cell 2 = Extra Attack
  m.key(decide); // Bottom (the cursor's start) takes it; back to the list
  eq(readRow(state.config, 0, 0), { group1: 2, group2: 2 }, 'Decide writes the Extra Attack to Bottom');
  eq(saved.length, 0, 'nothing saved while the window is open');
  m.key(press(KEYS.selectLeft)); // Bottom -> Left
  m.key(decide); // grid again, cursor reset to (0, 0)
  m.key(press('1')); // number key 1 writes the Attack to hotbar 1
  eq(readRow(state.config, 0, HOTBAR_FIRST), { group1: 2, group2: 0 }, 'number key 1 writes hotbar 1 (palette 0)');
  eq(readRow(state.config, 1, HOTBAR_FIRST), { group1: 2, group2: 0 }, 'number key 1 writes hotbar 1 (palette 1)');
  m.key(cancel); // grid -> list (a change: the flag is set)
  check(m.key(cancel) === false, 'Cancel on the slot list closes');
  eq(saved.length, 1, 'closing after a grid action sends the config once');
  eq(saved[0]!.length, CONFIG_SIZE, 'the sent config is 0xE8 bytes');

  // A grid Cancel alone marks the change (dump 718731 path: the grid's bit 1 sets the window's flag).
  const saved2: Uint8Array[] = [];
  const m2 = new CustomizeMenu(fakeEnv(new Set([0, 4]), (c) => saved2.push(new Uint8Array(c)), { config: sample() }));
  m2.key(decide);
  m2.key(cancel);
  m2.key(cancel);
  eq(saved2.length, 1, 'a grid Cancel with nothing written still sends on close');
}

// 10. The writes do not check availability (the number-key and Decide paths have no ValidatePlayerAction call):
// a number key writes a cell whose item is not in the bag; an empty cell clears the hotbar slot it is sent to.
{
  const state = { config: sample() };
  const env = fakeEnv(new Set(), () => {}, state, { hasItem: () => false });
  const m = new CustomizeMenu(env);
  m.key(press(KEYS.decide)); // grid, cursor (0, 0)
  m.key(press('2')); // hotbar 2 gets cell 0 (Attack, always available)
  eq(readRow(state.config, 0, HOTBAR_FIRST + 1), { group1: 2, group2: 0 }, 'a number key writes the cell under the cursor');
  m.key(press(KEYS.selectDown)); // row 1
  m.key(press(KEYS.selectDown)); // row 2
  m.key(press(KEYS.selectDown)); // row 3
  m.key(press(KEYS.selectDown)); // row 4: cells 12, 13, 14
  m.key(press(KEYS.selectRight));
  m.key(press(KEYS.selectRight)); // cell 14 = empty
  m.key(press('1'));
  eq(readRow(state.config, 0, HOTBAR_FIRST), { group1: 0, group2: 0 }, 'an empty cell clears hotbar 1 (palette 0)');
  eq(readRow(state.config, 1, HOTBAR_FIRST), { group1: 0, group2: 0 }, 'an empty cell clears hotbar 1 (palette 1)');
  eq(readRow(state.config, 0, HOTBAR_FIRST + 1), { group1: 2, group2: 0 }, 'hotbar 2 is untouched');
}

// 11. The window's own palette (Control on the slot list) writes palette 1; the config's HUD flip is not read.
{
  const state = { config: sample() };
  const m = new CustomizeMenu(fakeEnv(new Set([0]), () => {}, state));
  m.key(press('Control'));
  m.key(press(KEYS.decide)); // grid (0, 0)
  m.key(press(KEYS.selectDown)); // row 1, cell 3 = Foie
  m.key(press(KEYS.selectDown)); // row 2, cell 6 = Gifoie
  m.key(press(KEYS.decide)); // Bottom of palette 1
  eq(readRow(state.config, 1, 0), { group1: 3, group2: 1 }, 'the flipped window writes palette 1');
  eq(readRow(state.config, 0, 0), { group1: 2, group2: 1 }, 'palette 0 bottom is untouched');
}

// 12. The save upload: E7 with the 0x3994 save, then the 05 packet with no body; the 07ED frame is 0xE8 with flag 7.
{
  const sent: Array<{ cmd: number; flag: number; len: number }> = [];
  const s = new BBSession({} as never);
  s.conn = {
    send: (cmd: number, flag: number, payload: Uint8Array = new Uint8Array(0)) => sent.push({ cmd, flag, len: payload.length }),
    close: () => {},
  } as never;
  s.fullCharacter = new Uint8Array(E7_SIZE);
  s.sendSaveFile();
  eq(sent, [{ cmd: 0xe7, flag: 0, len: E7_SIZE }, { cmd: 0x05, flag: 0, len: 0 }], 'E7 then 05');
  sent.length = 0;
  s.sendCustomize(sample());
  eq(sent, [{ cmd: 0xed, flag: 7, len: CONFIG_SIZE }], '07ED with the config');
  sent.length = 0;
  s.fullCharacter = new Uint8Array(10);
  s.sendSaveFile();
  eq(sent.length, 0, 'a short save is not sent');
}

applyKeyConfig(null);
if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('customize: all checks passed');

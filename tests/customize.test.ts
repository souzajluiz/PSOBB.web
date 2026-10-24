// The action palette editor (Main menu > Customize, client/src/classic/customize.ts): the slot
// layout against parsePalette, the hotbar and palette-slot writes (PsoBB.exe dump 717407..717439,
// 718380..718393, 718426), the 07ED body and the save upload (E7 then 05, dump 811320 / 811346),
// and the window's keys and close rule (dump 717267).
// Run: node tests/customize.test.ts
import { applyKeyConfig, KEYS } from '../client/src/input/keyconfig.ts';
import { parsePalette } from '../client/src/classic/palette.ts';
import {
  actionRows,
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

// 6. Palette slot reset (ResetDefaultPalette): the action leaves the other 3-slot entries of both palettes; hotbar keeps it.
{
  const c = sample();
  assignPaletteSlot(c, 0, 2, { group1: 3, group2: 4 }); // technique 4 sits on the left slot
  eq(readRow(c, 0, 1), { group1: 0, group2: 0 }, 'the left slot loses the technique');
  eq(readRow(c, 0, 2), { group1: 3, group2: 4 }, 'the right slot takes it');
  eq(readRow(c, 0, HOTBAR_FIRST + 1), { group1: 3, group2: 0 }, 'hotbar entries are not touched by the palette reset');
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

// 8. Action rows: attacks 0..2, techniques 0..18 (enabled when learned), palette items 0..12.
{
  const env = fakeEnv(new Set([0, 4]));
  const rows = actionRows(env);
  eq(rows.length, 3 + 19 + 13, 'row count');
  eq(rows[0].row, { group1: 2, group2: 0 }, 'first row is the first attack');
  eq(rows.find((r) => r.row.group1 === 3 && r.row.group2 === 4)?.enabled, true, 'a learned technique is enabled');
  eq(rows.find((r) => r.row.group1 === 3 && r.row.group2 === 5)?.enabled, false, 'an unlearned technique is disabled');
}

// 9. The window: Decide on a slot opens the actions, Decide on an action writes the slot, the number key writes the hotbar,
// closing with a change sends the config once; a close with no change sends nothing.
{
  const saved: Uint8Array[] = [];
  const state = { config: sample(), flipped: false };
  const env: CustomizeEnv = {
    text: (g, i) => `g${g}:${i}`,
    learned: (t) => t === 0 || t === 4,
    hasItem: () => true,
    itemName: (i) => `item${i}`,
    config: () => new Uint8Array(state.config),
    flipped: () => state.flipped,
    setConfig: (c) => {
      state.config = new Uint8Array(c);
    },
    save: (c) => saved.push(new Uint8Array(c)),
  };
  const key = (k: string) => ({ key: k }) as KeyboardEvent;
  const decide = key(KEYS.decide);
  const cancel = key(KEYS.cancel);
  const down = key(KEYS.selectDown);
  const menu = new CustomizeMenu(env);
  check(menu.key(cancel) === false, 'Cancel on the slot list closes the window');
  eq(saved.length, 0, 'no change: nothing sent');

  const m2 = new CustomizeMenu(env);
  m2.key(decide); // slot list -> actions
  m2.key(down);
  m2.key(down); // action 2: attack 2
  m2.key(decide); // assign to slot cursor 0 (bottom)
  eq(readRow(state.config, 0, 0), { group1: 2, group2: 2 }, 'Decide assigns the highlighted action to the bottom slot');
  m2.key(cancel); // back to the slots
  m2.key(down); // slot cursor 1 (left)
  m2.key(decide); // actions, cursor still on attack 2
  m2.key(key('1')); // number key 1: hotbar slot 1
  eq(readRow(state.config, 0, HOTBAR_FIRST), { group1: 2, group2: 2 }, 'number key 1 writes hotbar 1');
  eq(saved.length, 0, 'nothing saved while the window is open');
  m2.key(cancel); // actions -> slots
  check(m2.key(cancel) === false, 'Cancel on the slot list closes');
  eq(saved.length, 1, 'closing with a change sends the config once');
  eq(saved[0].length, CONFIG_SIZE, 'the sent config is 0xE8 bytes');
}

// 10. The save upload: E7 with the 0x3994 save, then the 05 packet with no body; the 07ED frame is 0xE8 with flag 7.
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

function fakeEnv(learned: Set<number>): CustomizeEnv {
  return {
    text: (g, i) => `g${g}:${i}`,
    learned: (t) => learned.has(t),
    hasItem: () => true,
    itemName: (i) => `item${i}`,
    config: () => sample(),
    flipped: () => false,
    setConfig: () => {},
    save: () => {},
  };
}

applyKeyConfig(null);
if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('customize: all checks passed');

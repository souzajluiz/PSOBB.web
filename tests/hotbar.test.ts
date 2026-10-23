// The bottom hotbar (client/src/classic/hotbar.ts): key -> slot, slot -> action,
// the window's positions and the item gate. The key bindings come from
// input/keyconfig.ts (HOTBAR_KEYS, bindings 35..44).
// Run: node tests/hotbar.test.ts
import { applyKeyConfig, defaultKeyConfig, HOTBAR_KEYS, writeBinding } from '../client/src/input/keyconfig.ts';
import { HOTBAR_POS, HOTBAR_Y_NORMAL, HOTBAR_Y_PANEL, HOTBAR_SLOTS, hexCenter, hotbarAction, hotbarLabel, hotbarUsable, hotbarY } from '../client/src/classic/hotbar.ts';
import { PALETTE_ITEMS, TRAP_SLOT_FIRST, TRAP_SLOT_LAST } from '../client/src/classic/palette.ts';
import { parsePalette } from '../client/src/classic/palette.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

// Keys: the default config binds 1..0 (0x2a..0x33) to hotbar slots 1..10.
applyKeyConfig(null);
check(HOTBAR_KEYS.length === HOTBAR_SLOTS, 'ten hotbar keys');
check(HOTBAR_KEYS.join(',') === '1,2,3,4,5,6,7,8,9,0', `default hotbar keys ${HOTBAR_KEYS.join(',')}`);

// A rebound key follows the binding (binding 35 = key F5 here, lower-cased as the views keep it: code 0x44).
const cfg = defaultKeyConfig();
writeBinding(cfg, 35, { type: 0, code: 0x44 });
applyKeyConfig(cfg);
check(HOTBAR_KEYS[0] === 'f5' && HOTBAR_KEYS[1] === '2', `rebound hotbar key ${HOTBAR_KEYS[0]}`);
applyKeyConfig(null);

// Labels: 1..9 then 0.
check([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(hotbarLabel).join(',') === '1,2,3,4,5,6,7,8,9,0', 'labels 1..9,0');

// Slot -> action.
const slot = (group1: number, group2: number, disabled = false) => ({ group1, group2, disabled });
check(hotbarAction(null).kind === 'none', 'no slot: nothing');
check(hotbarAction(slot(0, 0)).kind === 'none', 'empty slot: nothing');
check(hotbarAction(slot(2, 1)).kind === 'attack' && (hotbarAction(slot(2, 1)) as any).type === 1, 'group 2: heavy attack');
check(hotbarAction(slot(2, 3)).kind === 'none', 'group 2 above 2 is not an attack');
check(hotbarAction(slot(3, 7)).kind === 'technique' && (hotbarAction(slot(3, 7)) as any).tech === 7, 'group 3: technique');
check(hotbarAction(slot(4, 0)).kind === 'item' && (hotbarAction(slot(4, 0)) as any).group2 === 0, 'group 4: item (Monomate)');
check(hotbarAction(slot(4, TRAP_SLOT_FIRST + 2)).kind === 'trap', 'group 4 0x0f: a battle trap');
check((hotbarAction(slot(4, TRAP_SLOT_LAST)) as any).trap === 3, 'trap type 3 for 0x10');
check(hotbarAction(slot(5, 2)).kind === 'photon', 'group 5: photon blast');
check(hotbarAction(slot(6, 0)).kind === 'quest', 'group 6: quest hook');
check(hotbarAction(slot(2, 0, true)).kind === 'none', 'a disabled slot does nothing');

// Usable (lit) only with stock for items.
check(hotbarUsable(slot(4, 0), 3), 'item with stock is lit');
check(!hotbarUsable(slot(4, 0), 0), 'item with no stock is grey');
check(hotbarUsable(slot(2, 0), 0), 'an attack is lit without stock');
check(!hotbarUsable(slot(2, 0, true), 0), 'a disabled slot is grey');
check(!hotbarUsable(null, 0), 'no slot is grey');
check(hotbarUsable(slot(4, TRAP_SLOT_FIRST), 0) === true, 'a trap slot is lit (stock is checked at placement)');

// Item palette indices stay inside the 13-entry table.
check(PALETTE_ITEMS.length === 13, 'PALETTE_ITEMS has 13 entries');

// Positions: the window at GUI entry 0x21 = (0, 442); hidden row y 443 / 342.
check(HOTBAR_POS.x === 0 && HOTBAR_POS.y === 442, 'window at (0, 442)');
check(hotbarY(false) === HOTBAR_Y_NORMAL && HOTBAR_Y_NORMAL === 443, 'normal y 443');
check(hotbarY(true) === HOTBAR_Y_PANEL && HOTBAR_Y_PANEL === 342, 'main panel y 342');
const c0 = hexCenter(0);
const c9 = hexCenter(9);
check(c9.x > c0.x && c9.y === c0.y, 'slots run left to right on one row');
check(c9.x - c0.x === 9 * (hexCenter(1).x - c0.x), 'even pitch');
check(c9.x + 20 < 640, 'the row fits the 640 space');

// The palette parse feeds ten hotbar slots at the right offsets (palette.ts parsePalette).
const raw = new Uint8Array(0xe8);
raw[4 + 16 + 0 * 4] = 3; // palette 0, hotbar_slots[0] = technique 0 (Foie)
raw[4 + 16 + 9 * 4] = 4; // hotbar_slots[9] = item
raw[4 + 16 + 9 * 4 + 1] = 0;
const pal = parsePalette(raw);
check(pal.palettes[0].hotbar.length === 10, 'ten hotbar slots parsed');
check(pal.palettes[0].hotbar[0].group1 === 3 && pal.palettes[0].hotbar[9].group1 === 4, 'hotbar slots at base + 16');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('hotbar tests pass');

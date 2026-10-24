// The field main menu's layout against PsoBB.exe (Ephinea 1.25.13), read with
// tools/exedata.py from the exe's data (the values are copied here, so the test
// needs no exe):
//   - the layout table 0x009f2f40 ({u16 id, u16 pad, u32 sub}, end id 0x30):
//     2 Item Pack (sub 0x009f2f80), 0 Customize, 3 Technique, 5 Chat (sub
//     0x009f2fb8), 0x23 Team (sub 0x009f2ff0), 6 Options, 7 Quit Game; the
//     android table 0x009f3020 has no Technique. Row 0x19 (Status, the GC row)
//     is in no table: the BB Team row takes its place.
//   - the label texel origins 0x00971980 (8 bytes per id, 48 ids, floats);
//   - the window origins in the GUI table 0x00971f40: entry 0x1b = (28, 85)
//     (the menu), entry 0x1c = (17, 312) (the help window);
//   - the view shift constants: 80 / 115.2 at 0x009712c8 / 0x009712cc, the frame
//     count 3 at 0x00971300.
// Run: node tests/mainmenulayout.test.ts
import { LABEL_UV, MAIN_MENU, MAIN_MENU_ANDROID, MENU_POS, menuViewShift, type MenuEntry } from '../client/src/classic/mainmenu.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};
const ids = (m: MenuEntry[]) => m.map((e) => e.id);
const subIds = (m: MenuEntry[], id: number) => ids(m.find((e) => e.id === id)?.sub ?? []);

// --- the layout table 0x009f2f40 and its sub-tables -------------------------
eq(ids(MAIN_MENU), [2, 0, 3, 5, 0x23, 6, 7], 'main table ids (0x009f2f40)');
eq(subIds(MAIN_MENU, 2), [9, 0xb, 0x17, 0x1a, 0xc, 0xf], 'Item Pack sub-table (0x009f2f80)');
eq(subIds(MAIN_MENU, 5), [0x11, 0x12, 0xe, 0x13, 0x16, 0x15], 'Chat sub-table (0x009f2fb8)');
eq(subIds(MAIN_MENU, 0x23), [0x25, 0x27, 0x29, 0x2b, 0x2d], 'Team sub-table (0x009f2ff0)');
eq(ids(MAIN_MENU_ANDROID), [2, 0, 5, 0x23, 6, 7], 'android table (0x009f3020)');
eq(subIds(MAIN_MENU_ANDROID, 2), [9, 0xb, 0x17, 0x1a, 0xc, 0xf], 'android Item Pack sub-table');

// Status (0x19) is in no BB table: the field menu never opens it.
const all = (m: MenuEntry[]): number[] => m.flatMap((e) => [e.id, ...all(e.sub ?? [])]);
eq(all(MAIN_MENU).includes(0x19), false, 'no Status row (0x19) in the BB main menu');
eq(all(MAIN_MENU_ANDROID).includes(0x19), false, 'no Status row (0x19) in the android menu');

// --- the label texel origins 0x00971980 (48 ids, u v floats) ----------------
const EXE_LABEL_UV: Array<[number, number]> = [
  [0, 18], [0, 18], [0, 0], [0, 54], [0, 54], [0, 36], [0, 72], [0, 90], [0, 90], [0, 108],
  [0, 108], [0, 126], [0, 162], [0, 162], [0, 234], [0, 180], [0, 180], [0, 198], [0, 216], [98, 0],
  [98, 0], [98, 18], [98, 72], [0, 144], [0, 144], [98, 36], [98, 54], [98, 54], [98, 54], [98, 54],
  [98, 54], [98, 90], [98, 90], [98, 108], [98, 108], [98, 36], [98, 36], [98, 90], [98, 90], [98, 108],
  [98, 108], [98, 126], [98, 126], [98, 144], [98, 144], [98, 162], [98, 162], [98, 162],
];
eq(LABEL_UV, EXE_LABEL_UV, 'label texel origins (0x00971980)');
// The Team row 0x23 (entry 35) and the Status id 0x19 (entry 25) label origins.
eq(LABEL_UV[0x23], [98, 36], 'label origin of Team 0x23 (0x00971980 + 0x23 * 8)');
eq(LABEL_UV[0x19], [98, 36], 'label origin of Status 0x19 (0x00971980 + 0x19 * 8)');

// --- the window origins (GUI table 0x00971f40, 8 bytes per entry) ------------
eq(MENU_POS, { x: 28, y: 85 }, 'menu window origin (GUI entry 0x1b)');

// --- the view shift (FUN_00733b2c: 80 / 115.2 over 3 frames) ----------------
const s0 = menuViewShift(0);
eq([s0.ox, s0.oy, s0.s], [0, 0, 1], 'view shift at frame 0');
const s3 = menuViewShift(3);
eq(Math.abs(s3.ox - 0.25) < 1e-9 && Math.abs(s3.oy - 0.48) < 1e-9, true, 'view shift at frame 3 (80 / 320, 115.2 / 240)');
eq(Math.abs(s3.s - 0.75) < 1e-9, true, 'view scale at frame 3 (1 - 80 / 320)');
eq(Math.abs(menuViewShift(1).ox - 0.25 / 3) < 1e-9, true, 'view shift is linear over the 3 frames');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('mainmenulayout: all checks passed');

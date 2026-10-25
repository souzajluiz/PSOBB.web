// Episode 4 Merissa A / AA (combat/enemyfsmmerissa.ts): the exe's state table decode, the
// +0x37c mask writes, the radar gate bit and the vanish countdown.
// Run: node tests/enemyfsmmerissa.test.ts
import {
  MERISSA_MASK_CLEAR,
  MERISSA_RADAR_HIDE_BIT,
  MERISSA_STATE_ROWS,
  MERISSA_UPDATE_VA,
  MERISSA_VANISH_LIMIT,
  MERISSA_VTABLE_VA,
  merissaMaskAfterTransition,
  merissaRadarIconShown,
  merissaStateRow,
  merissaStatesWithRadarHide,
  merissaVanishStep,
} from '../client/src/combat/enemyfsmmerissa.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// Vtable and update (tools/exedata.py read 00b0b6a0 u 12: +4 = 5984508 = 0x5b66ec).
eq(MERISSA_VTABLE_VA, 0x00b0b6a0, 'vtable VA');
eq(MERISSA_UPDATE_VA, 0x005b66ec, 'update VA (vtable +4)');
eq(MERISSA_UPDATE_VA, 5990124, 'vtable +4 word is the update (0x5b66ec)');

// The state table rows (tools/exedata.py read 009c1a24 u 40).
eq(MERISSA_STATE_ROWS.length, 8, 'state rows 0..7');
eq(MERISSA_STATE_ROWS[0].handler, 0x005b53dc, 'state 0 handler');
eq(MERISSA_STATE_ROWS[2].handler, 0x005b5618, 'state 2 handler');
eq(MERISSA_STATE_ROWS[3].handler, 0x005b5f3c, 'state 3 handler');
eq(MERISSA_STATE_ROWS[4].handler, 0x005b61a0, 'state 4 handler');
eq(MERISSA_STATE_ROWS[5].handler, 0x005b6108, 'state 5 handler');
eq(MERISSA_STATE_ROWS[6].handler, 0x005b6328, 'state 6 handler');
eq(MERISSA_STATE_ROWS[7].handler, 0, 'state 7 has no handler');
// Row words: flag arg (+4), motion (+8), mask (+0xc), hook (+0x10).
eq([MERISSA_STATE_ROWS[3].flagArg, MERISSA_STATE_ROWS[3].motion, MERISSA_STATE_ROWS[3].mask, MERISSA_STATE_ROWS[3].hook], [0, 6, 2, 0x005b5294], 'row 3 words');
eq([MERISSA_STATE_ROWS[2].hook], [0x005b51f8], 'row 2 hook (the transition to state 3 calls it)');
eq([MERISSA_STATE_ROWS[4].motion], [-1], 'row 4 motion -1 (none)');
eq([MERISSA_STATE_ROWS[5].hook], [0x005b52ec], 'row 5 hook is on_merissa_dead');
eq([MERISSA_STATE_ROWS[0].flagArg, MERISSA_STATE_ROWS[0].mask], [1, 0x4], 'row 0 (ctor initial) flag and mask');
eq(merissaStateRow(3)?.state, 3, 'row lookup');
eq(merissaStateRow(8), null, 'no row past the table');
eq(merissaStateRow(-1), null, 'no row below 0');
eq(merissaStatesWithRadarHide(), [6], 'only state 6 carries mask 0x8');

// +0x37c: the transition clears 0x2 / 0x4 / 0x8 and keeps 0x1, then ORs the row mask.
eq(MERISSA_MASK_CLEAR, 0xfffffff1, 'clear mask is andl $-0xf');
eq(merissaMaskAfterTransition(0xf, 0x2), 0x3, 'clear 2,4,8 keep 1, OR row 3 mask');
eq(merissaMaskAfterTransition(0x8, 0x0), 0x0, 'bit 8 cleared by a transition with no mask');
eq(merissaMaskAfterTransition(0x1, 0x8), 0x9, 'state 6 entry sets 0x8');

// Radar gate: the plain icon is skipped when bit 0x8 is set (0x005b67c4 jne 0x5b67e1).
eq(MERISSA_RADAR_HIDE_BIT, 0x8, 'radar hide bit');
eq(merissaRadarIconShown(0x5), true, 'ctor state (0x5) shows the icon');
eq(merissaRadarIconShown(0x8), false, 'bit 0x8 hides the icon');
eq(merissaRadarIconShown(0xf7), true, 'bit 0x8 clear (0xf7) shows the icon');
eq(merissaRadarIconShown(0x1f8), false, 'bit 0x8 with other bits hides it');

// Vanish countdown: -0.1f per frame (0x0092aff4), removed below -15.0f (0x0092aff0).
eq(MERISSA_VANISH_LIMIT, -15, 'vanish limit');
let c = 0;
let frames = 0;
let removed = false;
while (!removed && frames < 1000) {
  const s = merissaVanishStep(c);
  c = s.countdown;
  removed = s.removed;
  frames++;
}
check(removed, 'countdown reaches the removal');
// Float32 accumulation of 0.1f: step 149 is -14.99999 (not removed), step 150 is -15.00002 (removed).
eq(frames, 150, 'frames to removal from 0');
check(merissaVanishStep(0).countdown < 0 && !merissaVanishStep(0).removed, 'one step from 0 is not removal');
check(!merissaVanishStep(-14.5).removed, 'above -15 stays');
check(merissaVanishStep(-15).removed === (merissaVanishStep(-15).countdown < -15), 'removal test is strict below -15');

if (failures) {
  console.log(`enemyfsmmerissa: ${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsmmerissa: all checks passed');

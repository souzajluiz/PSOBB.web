// The touch stick's flick for the freeze mash (CheckMovementInput_007c11d0's
// stick branch, client/src/input/analog.ts StickFlick). The exe's constants:
// the direction is ROUND(atan2 * 65536 / 2pi) & 0xffff (0x0097e5e8 = 2pi,
// 0x0097e5f0 = 65536), a flick turns it by more than 0x5000 and less than 0xb000
// while the movement amount is over 0.5 (0x0097e614).
// Run: node tests/stickflick.test.ts
import { FLICK_AMOUNT, FLICK_MAX_BAMS, FLICK_MIN_BAMS, StickFlick, stickAngleBams, stickAxes } from '../client/src/input/analog.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

// The exe's constants.
check(FLICK_MIN_BAMS === 0x5000 && FLICK_MAX_BAMS === 0xb000, 'flick window 0x5000..0xb000');
check(FLICK_AMOUNT === 0.5, 'movement threshold 0.5');

// --- direction in BAMS (0 forward, 0x4000 right, 0x8000 back, 0xc000 left) ---
const axes = (lr: number, fb: number) => ({ lr, fb });
check(stickAngleBams(null) === 0, 'no stick: direction 0');
check(stickAngleBams(axes(0, 100)) === 0, 'forward is 0');
check(stickAngleBams(axes(100, 0)) === 0x4000, 'right is 0x4000');
check(stickAngleBams(axes(0, -100)) === 0x8000, 'back is 0x8000');
check(stickAngleBams(axes(-100, 0)) === 0xc000, 'left is 0xc000 (negative wraps)');
check(stickAngleBams(axes(0, 0)) === 0, 'centred stick: direction 0');

// --- flicks ---
{
  const s = new StickFlick();
  s.step(axes(0, 100)); // forward, deflected
  check(s.step(axes(0, -100)) === true, 'forward to back (0x8000) is a flick');
}
{
  const s = new StickFlick();
  s.step(axes(0, 100));
  check(s.step(axes(100, 0)) === false, 'forward to right (0x4000) is not a flick');
}
{
  const s = new StickFlick();
  s.step(axes(0, 100));
  // Forward to back-left: 0xa000 BAMS, a turn of 0x6000 (inside the window).
  check(s.step(axes(-100, -100)) === true, 'forward to back-left (0xa000, turn 0x6000) is a flick');
}
{
  const s = new StickFlick();
  s.step(axes(0, 100));
  check(s.step(axes(-100, 0)) === false, 'forward to left (0xc000, a turn of 0x4000) is not a flick');
}
{
  // Weak deflection (amount 0.39 <= 0.5) does not count, however far it turns.
  const s = new StickFlick();
  s.step(axes(0, 50));
  check(s.step(axes(0, -50)) === false, 'half-strength flick is refused (amount under 0.5)');
}
{
  // A turn is measured from the last call, so a slow sweep never counts.
  const s = new StickFlick();
  let flicks = 0;
  const sweep = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180];
  for (const deg of sweep) {
    const r = (deg * Math.PI) / 180;
    if (s.step(axes(100 * Math.sin(r), 100 * Math.cos(r)))) flicks++;
  }
  check(flicks === 0, 'a slow sweep of 20 degrees a call is no flick');
}
{
  // Wrap: from 0xff00 (just left of forward) to 0x0100 is a turn of 0x0200, no flick.
  const s = new StickFlick();
  s.step(axes(-10, 127)); // ~ -0.0785 rad
  check(s.step(axes(10, 127)) === false, 'a small turn across forward is no flick');
}
{
  // Releasing the stick (direction 0, amount 0) never counts.
  const s = new StickFlick();
  s.step(axes(0, -100));
  check(s.step(null) === false, 'release of the stick is no flick');
}

// --- analog helpers still hold ---
check(stickAxes(0, -100, 100).fb > 0, 'screen up is forward');

if (failures === 0) console.log('stickflick: all checks passed');
else {
  console.log(`stickflick: ${failures} failures`);
  process.exitCode = 1;
}

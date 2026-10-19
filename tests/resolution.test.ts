// Drawing-buffer resolution (client/src/render/resolution.ts): the plan for a
// desktop, a phone and the ?dpr= / ?quality= overrides, and the adaptive step
// with its hysteresis.
// Run: node tests/resolution.test.ts
import {
  AdaptiveResolution,
  COOLDOWN_MS,
  DROP_FRAMES,
  isSmallTouchScreen,
  planResolution,
  RAISE_FRAMES,
  type ScreenInfo,
} from '../client/src/render/resolution.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

const desktop: ScreenInfo = { devicePixelRatio: 2, coarsePointer: false, shortSide: 1080 };
const retina3: ScreenInfo = { devicePixelRatio: 3, coarsePointer: false, shortSide: 1200 };
const phone: ScreenInfo = { devicePixelRatio: 3, coarsePointer: true, shortSide: 390 };
const tablet: ScreenInfo = { devicePixelRatio: 2, coarsePointer: true, shortSide: 1024 };

// --- plan -------------------------------------------------------------------------
check(!isSmallTouchScreen(desktop) && isSmallTouchScreen(phone) && !isSmallTouchScreen(tablet), 'small touch screen: a phone, not a desktop or a big tablet');
check(planResolution(desktop).ratio === 2 && !planResolution(desktop).adaptive, 'desktop dpr 2: ratio 2, no adaptation (as before)');
check(planResolution(retina3).ratio === 2 && !planResolution(retina3).adaptive, 'desktop dpr 3: capped at 2 (as before)');
check(planResolution({ ...desktop, devicePixelRatio: 1 }).ratio === 1, 'desktop dpr 1: ratio 1');
const p = planResolution(phone);
check(p.ratio === 1.5 && p.max === 1.5 && p.adaptive, 'phone dpr 3: starts at 1.5 and adapts');
check(planResolution({ ...phone, devicePixelRatio: 1 }).adaptive === false, 'a phone at dpr 1 has nothing to lower');
check(planResolution(tablet).ratio === 2, 'a big tablet is treated like a desktop');
check(planResolution(phone, '?dpr=1.25').ratio === 1.25 && !planResolution(phone, '?dpr=1.25').adaptive, '?dpr= sets the ratio and turns the adaptation off');
check(planResolution(desktop, '?dpr=3').ratio === 3, '?dpr=3 is honoured on a desktop too (testing)');
check(planResolution(phone, '?dpr=abc').ratio === 1.5, 'a bad ?dpr= is ignored');
check(planResolution(phone, '?quality=low').ratio === 1, '?quality=low: 1');
check(planResolution(phone, '?quality=high').ratio === 2 && !planResolution(phone, '?quality=high').adaptive, '?quality=high: like a desktop, fixed');
check(planResolution(phone, '?quality=auto').adaptive, '?quality=auto is the default');

// --- adaptation -------------------------------------------------------------------
const feed = (a: AdaptiveResolution, ms: number, n: number): number[] => {
  const changes: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = a.update(ms);
    if (r !== null) changes.push(r);
  }
  return changes;
};
const framesFor = (ms: number) => Math.ceil(COOLDOWN_MS / ms);

{
  const a = new AdaptiveResolution(planResolution(phone));
  check(feed(a, 16.7, 1000).length === 0, 'a steady 60 fps at the cap never changes it');
  check(a.ratio === 1.5, '... and the ratio stays at 1.5');
}
{
  const a = new AdaptiveResolution(planResolution(phone));
  const slow = 40;
  // Nothing happens during the cooldown that follows the start.
  check(feed(a, slow, framesFor(slow) - 1).length === 0, 'no change inside the first cooldown');
  const ch = feed(a, slow, DROP_FRAMES + 2);
  check(ch.length === 1 && ch[0] === 1.25, 'then slow frames lower one step');
  check(feed(a, slow, framesFor(slow) - 1).length === 0, 'and the cooldown holds the next drop back');
  const more = feed(a, slow, 2 * DROP_FRAMES);
  check(more.length === 1 && more[0] === 1, 'the next step down comes after it');
  const last = feed(a, slow, framesFor(slow) + 2 * DROP_FRAMES);
  check(last.length === 0 && a.ratio === 1, 'it stops at the minimum');
}
{
  // Hysteresis: frame times between the two thresholds change nothing in either direction.
  const a = new AdaptiveResolution(planResolution(phone));
  feed(a, 40, framesFor(40) + DROP_FRAMES + 2); // down to 1.25
  check(a.ratio === 1.25, 'dropped to 1.25');
  check(feed(a, 18, 4000).length === 0 && a.ratio === 1.25, 'frames of 18 ms (between the thresholds) hold the ratio');
  // A long fast window raises it, one step, after a cooldown.
  const up = feed(a, 8, framesFor(8) + RAISE_FRAMES + 5);
  check(up.length === 1 && up[0] === 1.5, 'a long fast window raises one step');
  check(feed(a, 8, 5000).length === 0 && a.ratio === 1.5, 'and it stays at the cap');
}
{
  // No oscillation: a load that is slow at 1.5 and fast at 1.25 settles instead of flapping.
  const a = new AdaptiveResolution(planResolution(phone));
  let changes = 0;
  for (let i = 0; i < 20000; i++) {
    const ms = a.ratio > 1.25 ? 30 : 15; // 15 ms is above RAISE_MS (13): it must not climb back
    if (a.update(ms) !== null) changes++;
  }
  check(changes === 1 && a.ratio === 1.25, `settles after one change (${changes} changes, ratio ${a.ratio})`);
}
{
  // Spikes (a tab switch, a loading hitch) are not samples.
  const a = new AdaptiveResolution(planResolution(phone));
  feed(a, 16, framesFor(16) + 5);
  check(feed(a, 2000, 200).length === 0, 'long frames are ignored');
  check(a.update(0) === null && a.update(-4) === null && a.update(NaN) === null, 'bad samples are ignored');
}
{
  const a = new AdaptiveResolution(planResolution(desktop));
  check(feed(a, 100, 5000).length === 0 && a.ratio === 2, 'a desktop never adapts');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('resolution.test: all checks passed');

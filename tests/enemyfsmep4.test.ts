// Episode 4 Zu / Pazuzu (combat/enemyfsmep4.ts): the traced arithmetic of the
// movement, the volley, the targeting and the radar bit, and the state map.
// Run: node tests/enemyfsmep4.test.ts
import {
  ZU_CLASS_SPEED,
  ZU_CLASS_STATE,
  ZU_ICON_HIDDEN_BIT,
  ZU_STATES,
  zuApproach,
  zuDistanceClass,
  zuInRangeAndFacing,
  zuProjectileDifficulty,
  zuRadarIconHidden,
  zuVolleyHeadings,
} from '../client/src/combat/enemyfsmep4.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// Distance class: thresholds 8100 (90^2) and 62500 (250^2) from 0x0092ae08 / 0x0092ae04.
eq(zuDistanceClass(0), 0, 'class at 0');
eq(zuDistanceClass(8099), 0, 'class just under 90^2');
eq(zuDistanceClass(8100), 1, 'class at 90^2');
eq(zuDistanceClass(62499), 1, 'class just under 250^2');
eq(zuDistanceClass(62500), 2, 'class at 250^2');
// The pending state and the speed per class (0x0092ac88 = 9, 12, 0; 0x0092aea4 = 10, 60, 80).
eq(ZU_CLASS_STATE, [9, 12, 0], 'pending state by class');
eq(ZU_CLASS_SPEED, [10, 60, 80], 'speed by class');

// Approach: already at the speed, it has arrived and the value is kept.
eq(zuApproach(80, 80), { arrived: true, f418: 80 }, 'approach at speed');
// Inside the 0.5 band on the low side: arrived.
eq(zuApproach(10.4, 10), { arrived: true, f418: Math.fround(10.4) }, 'approach inside band');
// From 0 toward 10 in 2.2 steps: 2.2, 4.4, 6.6, 8.8, then the 11.0 step overshoots and snaps to 10.
{
  let f = 0;
  const seen: number[] = [];
  let done = false;
  for (let i = 0; i < 10 && !done; i++) {
    const r = zuApproach(f, 10);
    f = r.f418;
    seen.push(Math.round(f * 10) / 10);
    done = r.arrived;
  }
  eq(seen, [2.2, 4.4, 6.6, 8.8, 10], 'approach ramp to 10');
  check(done && f === 10, 'approach ends on the speed');
}
// Downward ramp from 80 to 10: steps of -2.2 while the approach is above the speed.
{
  const r = zuApproach(80, 10);
  check(!r.arrived && Math.abs(r.f418 - 77.8) < 0.01, 'approach steps down from 80');
}

// Difficulty: floor * 10 + level / 20, clamp 29, then / 3 (objdump 0x005b3d90).
eq(zuProjectileDifficulty(0, 0), 0, 'difficulty floor 0 level 0');
eq(zuProjectileDifficulty(1, 0), 3, 'difficulty floor 1 (10 / 3)');
eq(zuProjectileDifficulty(1, 19), 3, 'difficulty level 19 adds nothing');
eq(zuProjectileDifficulty(1, 20), 3, 'difficulty level 20 adds 1 (11 / 3)');
eq(zuProjectileDifficulty(2, 40), 7, 'difficulty floor 2 level 40 (22 / 3)');
eq(zuProjectileDifficulty(10, 600), 9, 'difficulty clamps at 29 (29 / 3)');
eq(zuProjectileDifficulty(3, 0), 9, 'difficulty floor 3 clamps 30 to 29 (29 / 3)');

// Volley headings: +0x1000, 0, -0x1000 (masked), plus +-0x2000 when wide.
eq(zuVolleyHeadings(0x1000, false), [0x2000, 0x1000, 0x0000], 'volley from 0x1000');
eq(zuVolleyHeadings(0xf000, false), [0x0000, 0xf000, 0xe000], 'volley wraps');
eq(zuVolleyHeadings(0x0000, true), [0x1000, 0x0000, 0xf000, 0x2000, 0xe000], 'wide volley order');

// Targeting: the bearing is trunc(atan2(dz, dx) * 65536 / 2pi'); a player straight
// ahead along +z (bearing 0x4000) is faced from heading 0.
const base = { dx: 0, dz: 10, heading: 0, flags: 0, range: 20, arc: 0x1000 };
check(zuInRangeAndFacing(base), 'in range and facing (heading 0 faces +z)');
check(!zuInRangeAndFacing({ ...base, heading: 0x8000 }), 'heading 0x8000 does not face +z');
check(!zuInRangeAndFacing({ ...base, range: 5 }), 'out of range (5 < 10)');
check(!zuInRangeAndFacing({ ...base, flags: 0x800 }), 'flag 0x800 is never targeted');
check(!zuInRangeAndFacing({ ...base, flags: 0x2000000 }), 'flag 0x2000000 is part of the refused mask');
check(zuInRangeAndFacing({ ...base, dx: 10, dz: 0, heading: 0x4000 }), 'player along +x is faced from heading 0x4000');

// Radar bit: 0x40000 of +0x390 hides the icon.
eq(ZU_ICON_HIDDEN_BIT, 0x40000, 'radar bit');
check(zuRadarIconHidden(0x40000), 'bit set hides the icon');
check(zuRadarIconHidden(0x40001), 'bit set with others hides the icon');
check(!zuRadarIconHidden(0), 'no flags shows the icon');
check(!zuRadarIconHidden(0x3ffff), 'other bits do not hide the icon');

// State map: the dispatcher's cases; 1, 2, 6, 8 have no case and nothing else is ported yet.
eq(ZU_STATES.map((s) => s.id), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], 'state ids');
eq(ZU_STATES.filter((s) => s.ported).length, 0, 'no state ported yet');
eq(ZU_STATES.find((s) => s.id === 0)?.address, 0x005b44f8, 'wander handler VA');
eq(ZU_STATES.find((s) => s.id === 9)?.address, 0x005b3dd4, 'projectile handler VA');

if (failures) {
  console.log(`enemyfsmep4: ${failures} failure(s)`);
  process.exit(1);
}
console.log('enemyfsmep4: all checks passed');

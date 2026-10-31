// The list window's scroll bar geometry (client/src/classic/listscrollbar.ts,
// PsoBB.exe RenderScrollbarPrimitives_0073f6b2 / IsListEntryInView_0073f878).
// Run: node tests/listscrollbar.test.ts
import { listScrollbar } from '../client/src/classic/listscrollbar.ts';

let failures = 0;
const near = (a: number, b: number, what: string) => {
  if (!(Math.abs(a - b) < 1e-9)) {
    failures++;
    console.log(`FAIL ${what}: ${a} != ${b}`);
  }
};
const ok = (cond: boolean, what: string) => {
  if (!cond) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

// The Item Pack list: x 13, y 256, w 308, h 184, titled (ITEM_LIST in itempack.ts).
const X = 13;
const Y = 256;
const W = 308;
const H = 184;

// Hidden: 8 lines (content 8 * 20 - 6 = 154) fit the inner height 184 - 20 - 6 = 158.
ok(listScrollbar(X, Y, W, H, true, 8, 0) === null, '8 lines titled: hidden');
// Shown: 9 lines (content 174) overflow 158.
const s9 = listScrollbar(X, Y, W, H, true, 9, 0);
ok(s9 !== null, '9 lines titled: shown');
if (s9) {
  near(s9.track.x, X + W - 7, 'track x = rect[0] - 7 + rect[2]');
  near(s9.track.y, Y + 17, 'track y = 17 + rect[1]');
  near(s9.track.w, 3, 'track width');
  near(s9.track.h, H - 34, 'track length = rect[3] - 34');
  near(s9.thumb.x, s9.track.x, 'thumb x = track x');
  near(s9.thumb.w, 3, 'thumb width');
  near(s9.thumb.y, Y + 17, 'thumb at the top when top = 0');
  near(s9.thumb.h, 158 * 150 / 174, 'thumb length = rect[7] * track / content');
}
// One line down: the offset is 20 px, so the thumb moves 20 * 150 / 174 px.
const t1 = listScrollbar(X, Y, W, H, true, 9, 1);
if (t1 && s9) {
  near(t1.thumb.y - s9.thumb.y, 20 * 150 / 174, 'thumb moves with the offset (top 1)');
  near(t1.thumb.h, s9.thumb.h, 'thumb length does not move');
  near(t1.track.y, s9.track.y, 'track does not move');
}
// Past the end the offset clamps to the content (174): the thumb stops at 150 px down.
const tEnd = listScrollbar(X, Y, W, H, true, 9, 50);
if (tEnd) near(tEnd.thumb.y - Y - 17, 150, 'offset clamped to the content');

// Untitled: the inner height is 164, so 9 lines (174) still overflow and 8 lines (154) fit.
ok(listScrollbar(X, Y, W, H, false, 8, 0) === null, '8 lines untitled: hidden');
const u9 = listScrollbar(X, Y, W, H, false, 9, 0);
ok(u9 !== null, '9 lines untitled: shown');
if (u9) near(u9.thumb.h, 164 * 150 / 174, 'untitled thumb length uses inner height 164');

// Empty list and a window under 35 px are hidden.
ok(listScrollbar(X, Y, W, H, true, 0, 0) === null, 'no lines: hidden');
ok(listScrollbar(X, Y, W, 34, true, 30, 0) === null, 'height 34 (< 35): hidden');

// Long list: thumb length shrinks with the line count.
const l30 = listScrollbar(X, Y, W, H, true, 30, 0);
if (l30) near(l30.thumb.h, 158 * 150 / (30 * 20 - 6), 'thumb length for 30 lines');

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('listscrollbar: all checks passed');

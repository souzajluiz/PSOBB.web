// Phone support of the classic page (browser side, not in PsoBB.exe): the text
// forwarded from the hidden on-screen-keyboard field, the stage fit and
// orientation maths, the pad layout choice and the loader's progress steps.
// Run: node tests/mobileinput.test.ts
import { diffKeys, inputTypeKey, TextProxy } from '../client/src/input/textproxy.ts';
import { PROXY_SENTINEL } from '../client/src/input/virtualpad.ts';
import { padLayout } from '../client/src/input/padlayout.ts';
import { fitEnabled, fitStage, isPortrait, keyboardOpen, nextOrientation, orientationOf, padBelow, snapBox, usableArea } from '../client/src/ui/stagefit.ts';
import { describeLoadError, formatBytes, LOAD_STEPS, LoadProgress } from '../client/src/classic/loadprogress.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const S = PROXY_SENTINEL;
const names = (ks: Array<{ key: string }>) => ks.map((k) => k.key).join(',');

// --- typed text -> keys ---
check(names(diffKeys('', 'ab')) === 'a,b', 'typing a b');
check(names(diffKeys('ab', 'a')) === 'Backspace', 'one char removed: Backspace');
check(names(diffKeys('cat', 'car')) === 'Backspace,r', 'autocorrect t -> r');
check(names(diffKeys('hel', 'hello')) === 'l,o', 'composition grows');
check(names(diffKeys('a\u{1F600}', 'a')) === 'Backspace', 'an emoji is one code point');
check(names(diffKeys('ab', 'a\n')) === 'Backspace,Enter', 'newline is Enter');
{
  const p = new TextProxy();
  let r = p.input(S + 'a', false);
  check(names(r.keys) === 'a' && r.reset, 'plain char: key, field reset');
  r = p.input('', false);
  check(names(r.keys) === 'Backspace' && r.reset, 'Backspace on the empty field (sentinel gone)');
  // Android composition: the word grows in the field, is replaced by autocorrect.
  r = p.input(S + 'h', true);
  check(names(r.keys) === 'h' && !r.reset, 'composing: live key, no reset');
  r = p.input(S + 'he', true);
  check(names(r.keys) === 'e', 'composing: only the new char');
  r = p.input(S + 'hi', true);
  check(names(r.keys) === 'Backspace,i', 'composition rewritten: replace in place');
  r = p.compositionEnd(S + 'hi');
  check(r.keys.length === 0 && r.reset, 'compositionend: nothing new, field reset');
  r = p.input(S + 'x', false);
  check(names(r.keys) === 'x', 'after the reset typing starts from empty');
  p.reset();
  r = p.input(S + 'abc', false);
  check(names(r.keys) === 'a,b,c', 'a pasted string is typed char by char');
}
check(inputTypeKey('insertLineBreak')?.key === 'Enter', 'beforeinput line break = Enter (Android Unidentified keydown)');
check(inputTypeKey('insertText') === null, 'other input types are not keys');

// --- orientation and stage fit ---
check(orientationOf(390, 844) === 'portrait' && orientationOf(844, 390) === 'landscape', 'orientation from width / height');
check(orientationOf(500, 500) === 'landscape', 'square counts as landscape');
check(nextOrientation('portrait', 390, 390, 400, true) === 'portrait', 'keyboard in portrait: height 400 > width stays portrait');
check(nextOrientation('portrait', 390, 390, 350, true) === 'portrait', 'keyboard shrinks portrait below the width: not a rotation');
check(nextOrientation('landscape', 844, 844, 200, true) === 'landscape', 'keyboard in landscape stays');
check(nextOrientation('portrait', 390, 844, 390, true) === 'landscape', 'width changed: a rotation even with a keyboard');
check(nextOrientation('landscape', 844, 390, 844, false) === 'portrait', 'rotation to portrait');
{
  const land = fitStage({ x: 0, y: 0, w: 844, h: 390 });
  check(Math.abs(land.w / land.h - 16 / 9) < 1e-9 && land.h === 390, '844x390 -> 16:9 by height');
  check(Math.abs(land.x - (844 - land.w) / 2) < 1e-9, 'landscape stage centred horizontally');
  const port = fitStage({ x: 0, y: 0, w: 390, h: 844 }, 4 / 3, 4 / 3);
  check(port.w === 390 && Math.abs(port.h - 292.5) < 1e-9, '390x844 portrait -> 4:3 fitted to the width');
  check(port.y > 0 && Math.abs(port.y - (844 - 292.5) / 2) < 1e-9, 'portrait stage centred vertically');
  const desk = fitStage({ x: 0, y: 0, w: 1440, h: 900 });
  check(Math.abs(desk.w / desk.h - 1.6) < 1e-9 && desk.w === 1440, 'a 16:10 window is kept (clamp range)');
  const tall = fitStage({ x: 0, y: 0, w: 390, h: 844 });
  check(tall.w === 390 && tall.h > 0 && tall.h <= 844, 'default clamp never exceeds the area');
  for (const [w, h] of [[390, 844], [844, 390], [768, 1024], [1024, 768], [320, 568]]) {
    const b = fitStage({ x: 0, y: 0, w, h });
    check(b.x >= 0 && b.y >= 0 && b.x + b.w <= w + 1e-9 && b.y + b.h <= h + 1e-9, `${w}x${h}: nothing cropped`);
  }
  const sn = snapBox({ x: 10.4, y: 0.6, w: 100.5, h: 50.2 });
  check(Number.isInteger(sn.x) && Number.isInteger(sn.y) && Number.isInteger(sn.w) && Number.isInteger(sn.h), 'snapped to whole pixels');
}
{
  const a = usableArea({ width: 844, height: 390, offsetLeft: 0, offsetTop: 0 }, { top: 0, right: 47, bottom: 21, left: 47 });
  check(a.x === 47 && a.w === 750 && a.h === 369, 'notch insets removed from the usable area');
  check(keyboardOpen(844, 400) && !keyboardOpen(844, 780), 'keyboard: lost > 20% of the height; an address bar is not');
  check(isPortrait({ x: 0, y: 0, w: 390, h: 844 }) && !isPortrait({ x: 0, y: 0, w: 844, h: 390 }), 'portrait hint condition');
  check(fitEnabled('', true) && !fitEnabled('', false) && fitEnabled('?fit=1', false) && !fitEnabled('?fit=0', true), 'fit: coarse pointer, ?fit override');
  const area = { x: 0, y: 0, w: 390, h: 844 };
  const box = fitStage(area, 4 / 3, 4 / 3);
  check(padBelow('portrait', area, box) === 844 - box.y - box.h, 'portrait: free height under the stage');
  check(padBelow('landscape', area, box) === 0, 'landscape: nothing under the stage');
}

// --- pad layout choice ---
{
  const land = padLayout(693, 390);
  check(!land.underStage && land.dpad.y + land.dpad.h <= 390, 'landscape pad stays over the stage');
  check(land.stickZone.x < 693 * 0.5 && land.actions.x > land.stickZone.x, 'landscape: stick left, buttons right');
  const port = padLayout(390, 292, undefined, 480);
  check(port.underStage, 'portrait pad moves under the stage');
  check(port.stickZone.y >= 292 && port.dpad.y >= 292 && port.actions.y >= 292, 'portrait: stick, diamond and OK / BACK below the stage');
  check(port.dpad.y + port.dpad.h <= 292 + 480 && port.actions.x + port.actions.w <= 390, 'portrait pad inside the screen');
  check(port.stickZone.x + port.stickZone.w <= port.dpad.x, 'portrait: stick zone left of the diamond');
  check(port.palette.every((p) => p.rect.y < 292), 'portrait: palette taps stay over the HUD icons');
  check(!padLayout(390, 292, undefined, 40).underStage, 'too little room below: pad stays over the stage');
}

// --- loader progress ---
{
  const p = new LoadProgress();
  check(p.status().percent === 0 && p.status().indeterminate, 'starts at 0, indeterminate');
  p.begin('source');
  p.begin('archive');
  const s0 = p.status();
  check(s0.label === LOAD_STEPS[1].label && s0.indeterminate, 'archive step before any bytes: indeterminate');
  p.bytes(50_000_000, 100_000_000);
  const s1 = p.status();
  check(!s1.indeterminate && s1.detail === '47.7 MB of 95.4 MB', 'bytes shown');
  check(s1.percent > s0.percent && s1.percent < 100, 'bytes move the bar');
  p.bytes(100_000_000, 100_000_000);
  p.begin('title');
  const s2 = p.status();
  check(s2.percent > s1.percent && s2.label === LOAD_STEPS[2].label, 'next step continues');
  p.begin('source');
  p.begin('archive');
  p.bytes(1, 100);
  check(p.status().percent >= s2.percent, 'the bar never goes back');
  p.begin('open');
  p.finish();
  check(p.status().percent === 100 && p.status().label === 'Ready', 'finish = 100%');
  check(LOAD_STEPS.reduce((a, s) => a + s.weight, 0) === 100, 'step weights sum to 100');
  const q = new LoadProgress();
  q.begin('archive');
  q.bytes(2048, 0);
  check(q.status().indeterminate && q.status().detail === '2 KB', 'no content length: counter only');
  check(formatBytes(1536) === '2 KB' && formatBytes(5 * 1024 * 1024) === '5.0 MB' && formatBytes(900) === '900 B', 'formatBytes');
  check(describeLoadError(new TypeError('Failed to fetch')).includes('connection'), 'network error message');
  check(describeLoadError(new Error('cannot read data.gsl')) === 'cannot read data.gsl', 'other errors pass through');
}

if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('mobileinput: all checks passed');

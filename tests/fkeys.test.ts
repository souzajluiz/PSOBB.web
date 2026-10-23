// The on-screen function-key bar (input/fkeys.ts): platform detection, the
// KeyboardEvent fields of F1..F12 and the hold timing. The DOM part (the
// buttons, the Alt wrapping in KeyFeed.pressFKey) is in ui/webcontrols.ts.
// Run: node tests/fkeys.test.ts
import { FKEY_COUNT, FKEY_HOLD_MS, fKeyEventInit, fkeysShown, holdRemaining, isMacPlatform } from '../client/src/input/fkeys.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPAD_SITE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// Platform detection.
check(isMacPlatform({ platform: 'MacIntel', userAgent: MAC_CHROME, maxTouchPoints: 0 }), 'mac: MacIntel on a Mac');
check(isMacPlatform({ platform: 'MacIntel', userAgent: MAC_CHROME, uaPlatform: 'macOS' }), 'mac: userAgentData says macOS');
check(isMacPlatform({ userAgent: MAC_CHROME }), 'mac: no platform field, the UA says Macintosh');
check(!isMacPlatform({ platform: 'Win32', userAgent: WIN_CHROME, maxTouchPoints: 0 }), 'not mac: Windows');
check(!isMacPlatform({ platform: 'Linux x86_64', userAgent: WIN_CHROME, uaPlatform: 'Linux' }), 'not mac: Linux');
check(!isMacPlatform({ platform: 'MacIntel', userAgent: MAC_CHROME, uaPlatform: 'Windows' }), 'not mac: userAgentData wins over navigator.platform');
check(!isMacPlatform({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), 'not mac: iPhone');
check(!isMacPlatform({ platform: 'MacIntel', userAgent: IPAD_SITE, maxTouchPoints: 5 }), 'not mac: iPad asking for the desktop site (touch points)');
check(!isMacPlatform({}), 'not mac: nothing known');

// The stored choice wins over the platform default.
check(fkeysShown(null, true) === true, 'shown: no choice on a Mac');
check(fkeysShown(undefined, false) === false, 'hidden: no choice off a Mac');
check(fkeysShown('1', false) === true, 'shown: stored 1 off a Mac');
check(fkeysShown('0', true) === false, 'hidden: stored 0 on a Mac');
check(fkeysShown('garbage', true) === true, 'unknown stored value: the default');

// KeyboardEvent fields of F1..F12.
check(FKEY_COUNT === 12, 'twelve function keys');
for (let n = 1; n <= FKEY_COUNT; n++) {
  const plain = fKeyEventInit(n, false);
  check(plain !== null && plain.key === `F${n}` && plain.code === `F${n}` && plain.altKey === false, `F${n}: key, code, no alt`);
  const alt = fKeyEventInit(n, true);
  check(alt !== null && alt.key === `F${n}` && alt.altKey === true, `F${n}: altKey passes through`);
}
check(fKeyEventInit(0, false) === null, 'F0 is not a key of the bar');
check(fKeyEventInit(13, false) === null, 'F13 is not a key of the bar');
check(fKeyEventInit(1.5, false) === null, 'a fractional key number is refused');

// Hold timing: a press is held FKEY_HOLD_MS at least.
check(FKEY_HOLD_MS === 120, 'hold is 120 ms');
check(holdRemaining(1000, 1000) === 120, 'a release at once waits the full hold');
check(holdRemaining(1000, 1050) === 70, 'a release after 50 ms waits the rest');
check(holdRemaining(1000, 1120) === 0, 'a release at the hold has no wait');
check(holdRemaining(1000, 1500) === 0, 'a long press is released at once');

console.log(failures ? `${failures} failures` : 'function-key bar: all checks passed');
process.exit(failures ? 1 : 0);

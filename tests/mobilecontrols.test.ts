// Browser conveniences that are not in PsoBB.exe: the touch pad's stick and
// key logic (input/virtualpad.ts), the master mute state (audio/mute.ts) and
// the fullscreen state machine (ui/fullscreen.ts).
// Run: node tests/mobilecontrols.test.ts
import { KEYS } from '../client/src/input/keyconfig.ts';
import {
  clampStick,
  DOM_KEYS,
  isTap,
  keyDiff,
  proxyKeys,
  PROXY_SENTINEL,
  REPEAT_DELAY,
  REPEAT_INTERVAL,
  repeatCount,
  proxyInput,
  shortcutFor,
  stickKeys,
  SwallowedKeys,
} from '../client/src/input/virtualpad.ts';
import { intersects, padLayout, type PxRect } from '../client/src/input/padlayout.ts';
import { loadMuted, MUTE_STORAGE_KEY, parseMuted, resolveMuted, saveMuted, serializeMuted } from '../client/src/audio/mute.ts';
import { fullscreenStep, isFullscreen, type FullscreenEvent, type FullscreenState } from '../client/src/ui/fullscreen.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const keys = (dx: number, dy: number, radius = 50) => [...stickKeys({ dx, dy, radius })].sort().join('');

// --- stick -> move keys (8-way, dead zone) ---
check(keys(0, 0) === '', 'centred stick: no keys');
check(keys(10, 0) === '', 'inside the 25% dead zone: no keys');
check(keys(0, -12) === '', 'dead zone edge (12 < 12.5): no keys');
check(keys(0, -40) === KEYS.moveForward, 'up = forward (W)');
check(keys(0, 40) === KEYS.moveBackward, 'down = backward (S)');
check(keys(-40, 0) === KEYS.moveLeft, 'left = A');
check(keys(40, 0) === KEYS.moveRight, 'right = D');
check(keys(30, -30) === 'dw', 'up-right = W+D');
check(keys(-30, -30) === 'aw', 'up-left = W+A');
check(keys(-30, 30) === 'as', 'down-left = S+A');
check(keys(30, 30) === 'ds', 'down-right = S+D');
check(keys(40, -10) === 'd', '14 degrees off right stays D');
check(keys(40, -20) === 'dw', '27 degrees off right is W+D');
check(keys(10, 0, 0) === '', 'zero radius: no keys');
{
  const c = clampStick(300, 400, 50);
  check(Math.abs(Math.hypot(c.dx, c.dy) - 50) < 1e-9 && Math.abs(c.dx - 30) < 1e-9, 'knob clamped to the rim');
  const d = clampStick(3, 4, 50);
  check(d.dx === 3 && d.dy === 4, 'knob inside the rim is unchanged');
}
{
  const { release, press } = keyDiff(new Set(['w', 'd']), new Set(['w', 'a']));
  check(release.join() === 'd' && press.join() === 'a', 'W+D -> W+A releases D, presses A');
}

// --- pad keys use the game's key config ---
check(DOM_KEYS[KEYS.decide].key === 'Enter' && DOM_KEYS[KEYS.cancel].key === 'Backspace', 'decide / cancel: Enter / Backspace');
check(DOM_KEYS[KEYS.menu].key === 'Home' && DOM_KEYS[KEYS.camera].key === 'ArrowUp', 'menu / camera: Home / ArrowUp');
check(DOM_KEYS[KEYS.paletteChange].key === 'Control', 'palette change: Control (fieldhud compares e.key === "Control")');
check(DOM_KEYS[KEYS.chat].key === ' ', 'chat: Space');
for (const [name, k] of Object.entries(KEYS)) check(DOM_KEYS[k].key.toLowerCase() === k, `${name}: DOM key lower-cases to the held-set name`);

// --- auto-repeat and taps ---
check(repeatCount(REPEAT_DELAY - 1) === 0, 'no repeat before the delay');
check(repeatCount(REPEAT_DELAY) === 1, 'first repeat at the delay');
check(repeatCount(REPEAT_DELAY + 3 * REPEAT_INTERVAL) === 4, 'then one per interval');
check(isTap(100, 3, 4), 'short, still press is a tap');
check(!isTap(400, 0, 0) && !isTap(100, 20, 0), 'long or moved press is not a tap');

// --- on-screen keyboard proxy ---
check(proxyKeys(PROXY_SENTINEL + 'hi').map((k) => k.key).join() === 'h,i', 'typed text -> one key per character');
check(proxyKeys('')[0].key === 'Backspace', 'sentinel deleted -> Backspace');
check(proxyKeys(PROXY_SENTINEL).length === 0, 'unchanged field -> nothing');

check(proxyInput(PROXY_SENTINEL + 'abc', true) === null, 'IME composing: wait');
check(proxyInput(PROXY_SENTINEL + 'abc', false)?.length === 3, 'composition done: keys');

// --- shortcuts ---
const ev = (key: string, code: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({ key, code, altKey: false, ctrlKey: false, metaKey: false, ...mods });
check(shortcutFor(ev('Enter', 'Enter', { altKey: true })) === 'fullscreen', 'Alt+Enter = fullscreen');
check(shortcutFor(ev('µ', 'KeyM', { altKey: true })) === 'mute', 'Alt+M = mute (macOS Option+M types µ)');
check(shortcutFor(ev('Enter', 'Enter')) === null, 'bare Enter stays the game\'s decide key');
check(shortcutFor(ev('m', 'KeyM')) === null, 'bare M stays text input');
check(shortcutFor(ev('Enter', 'Enter', { altKey: true, ctrlKey: true })) === null, 'Ctrl+Alt+Enter is not ours');
for (let f = 1; f <= 12; f++) check(shortcutFor(ev(`F${f}`, `F${f}`, { altKey: true })) === null, `Alt+F${f} left to the game`);
{
  const sw = new SwallowedKeys();
  sw.down('Enter');
  check(sw.up('Enter'), 'keyup of a swallowed Enter is swallowed (Alt already released)');
  check(!sw.up('Enter'), 'only once');
  check(!sw.up('KeyW'), 'other keyups pass');
}

// --- pad layout: clear of the HUD, palette slots are the buttons ---
for (const [w, h] of [[844, 390], [1000, 462], [1280, 720], [1024, 768], [2560, 1440], [667, 375]] as const) {
  const l = padLayout(w, h);
  const hud = l.hud;
  const what = `${w}x${h}`;
  const pad: Array<[string, PxRect]> = [['dpad', l.dpad], ['actions', l.actions], ['top strip', l.topStrip]];
  for (const [name, r] of pad) {
    for (const [hn, hr] of Object.entries(hud)) check(!intersects(r, hr), `${what}: ${name} clear of the ${hn} window`);
    check(r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 1e-6 && r.y + r.h <= h + 1e-6, `${what}: ${name} on the canvas`);
  }
  check(!intersects(l.stickZone, l.dpad) && !intersects(l.stickZone, hud.status) && !intersects(l.stickZone, hud.party), `${what}: stick zone clear of the diamond and the status / party windows`);
  check(!intersects(l.dpad, l.actions), `${what}: diamond and OK / BACK apart`);
  check(l.palette.length === 4, `${what}: three slots + Ctrl tab`);
  for (const { key, rect } of l.palette) {
    const p = hud.palette;
    check(rect.x >= p.x - 1e-6 && rect.y >= p.y - 1e-6 && rect.x + rect.w <= p.x + p.w + 1e-6 && rect.y + rect.h <= p.y + p.h + 1e-6, `${what}: ${key} target inside the palette window`);
  }
  check(Math.abs(hud.palette.x + hud.palette.w - (484 + 150 + l.extra) * l.scale) < 1e-6, `${what}: palette right-anchored like fieldhud (anchorX)`);
}
{
  const l = padLayout(844, 390);
  const left = l.palette.find((p) => p.key === KEYS.paletteLeft)!.rect;
  const right = l.palette.find((p) => p.key === KEYS.paletteRight)!.rect;
  const mid = l.palette.find((p) => p.key === KEYS.paletteMiddle)!.rect;
  check(left.x < mid.x && mid.x < right.x && mid.y > left.y, 'palette targets: left, middle (lower), right as drawn');
  check(l.palette.some((p) => p.key === KEYS.paletteChange), 'Ctrl tab is the palette-change target');
  const inset = padLayout(844, 390, { top: 0, right: 0, bottom: 21, left: 47 });
  check(inset.stickZone.x >= 47 && inset.dpad.y + inset.dpad.h <= 390 - 21 + 1e-6, 'safe-area insets respected');
}

// --- mute persistence and default ---
check(parseMuted('1') && parseMuted('true'), '"1" / "true" = muted');
check(!parseMuted('0') && !parseMuted(null) && !parseMuted('yes'), 'anything else = sound on');
check(parseMuted(serializeMuted(true)) && !parseMuted(serializeMuted(false)), 'serialize round-trips');
{
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  check(loadMuted(store) === null, 'nothing stored -> no choice');
  saveMuted(true, store);
  check(map.get(MUTE_STORAGE_KEY) === '1' && loadMuted(store) === true, 'saved mute loads back');
  saveMuted(false, store);
  check(loadMuted(store) === false, 'saved unmute loads back');
  const broken = {
    getItem: (): string | null => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  check(loadMuted(broken) === null, 'throwing storage reads as no choice');
  saveMuted(true, broken); // must not throw
  check(loadMuted(null) === null, 'no storage reads as no choice');
}
check(resolveMuted({ stored: null, dev: true, soundParam: null }) === true, 'dev server, no choice: muted');
check(resolveMuted({ stored: null, dev: false, soundParam: null }) === false, 'production build, no choice: sound on');
check(resolveMuted({ stored: false, dev: true, soundParam: null }) === false, 'dev: stored unmute wins');
check(resolveMuted({ stored: true, dev: false, soundParam: null }) === true, 'build: stored mute wins');
check(resolveMuted({ stored: true, dev: true, soundParam: '1' }) === false, '?sound=1 forces sound on');
check(resolveMuted({ stored: false, dev: false, soundParam: '0' }) === true, '?sound=0 forces mute');
check(resolveMuted({ stored: null, dev: true, soundParam: 'x' }) === true, 'unknown ?sound= is ignored');

// --- fullscreen state machine ---
{
  const run = (events: FullscreenEvent[], from: FullscreenState = { mode: 'off' }) => {
    let s = from;
    const actions: string[] = [];
    for (const e of events) {
      const r = fullscreenStep(s, e);
      s = r.state;
      if (r.action) actions.push(r.action);
    }
    return { mode: s.mode, actions: actions.join(), on: isFullscreen(s) };
  };
  const toggleNative: FullscreenEvent = { type: 'toggle', nativeAvailable: true };
  const toggleNone: FullscreenEvent = { type: 'toggle', nativeAvailable: false };
  let r = run([toggleNative]);
  check(r.mode === 'pending' && r.actions === 'request' && !r.on, 'toggle with the API: request, pending');
  r = run([toggleNative, { type: 'entered' }]);
  check(r.mode === 'native' && r.on, 'fullscreenchange in: native');
  r = run([toggleNative, { type: 'entered' }, { type: 'exited' }]);
  check(r.mode === 'off' && r.actions === 'request', 'Esc (fullscreenchange out): off, nothing to undo');
  r = run([toggleNative, { type: 'entered' }, toggleNative, { type: 'exited' }]);
  check(r.mode === 'off' && r.actions === 'request,exit', 'toggle again: exit, off on the change event');
  r = run([toggleNative, { type: 'failed' }]);
  check(r.mode === 'fallback' && r.actions === 'request,fallbackOn' && r.on, 'refused request: CSS fallback');
  r = run([toggleNone]);
  check(r.mode === 'fallback' && r.actions === 'fallbackOn', 'no API (iPhone Safari): CSS fallback');
  r = run([toggleNone, { type: 'exited' }, toggleNone]);
  check(r.mode === 'off' && r.actions === 'fallbackOn,fallbackOff', 'fallback ignores change events, toggles off');
  r = run([toggleNative, toggleNative]);
  check(r.mode === 'off' && r.actions === 'request,cancel', 'toggle while pending cancels (never stuck)');
  r = run([toggleNative, { type: 'timeout' }]);
  check(r.mode === 'fallback' && r.actions === 'request,fallbackOn', 'no answer (silent webkit refusal): CSS fallback after the timeout');
  r = run([toggleNative, { type: 'timeout' }, { type: 'entered' }]);
  check(r.mode === 'native' && r.actions === 'request,fallbackOn,fallbackOff', 'late fullscreenchange after the timeout: native, fallback undone');
  r = run([toggleNative, { type: 'entered' }, { type: 'timeout' }]);
  check(r.mode === 'native', 'a stale timeout does nothing once native');
}

if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('mobilecontrols: all checks passed');

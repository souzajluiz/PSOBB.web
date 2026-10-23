// Browser-side controls layered over the game view: fullscreen and mute
// buttons (all devices) and, on touch screens, an on-screen pad. None of this
// is in PsoBB.exe and none of it changes how the game behaves: the pad
// dispatches the same KeyboardEvents a keyboard would (input/keyconfig.ts
// KEYS) on the canvas the views listen on, so held-key sets, menus and the
// action palette all see ordinary key presses.
//
// The pad's controls are placed around the game's own HUD (input/padlayout.ts):
// the action palette's slot icons are its attack buttons.
//
// Touch extras (input/analog.ts, input/haptics.ts): while the stick is held
// its analog axes drive the player view (walk / run by deflection, as the
// exe's pad code does) and a second finger dragging on the canvas turns the
// camera; key presses on the pad, hits, damage and level ups vibrate where the
// browser can (Android), with a VIB toggle on the top strip.
//
// Shortcuts (window capture phase, so the game never sees them):
//   Alt+Enter  fullscreen (F1..F12 are game keys, F11 is the browser's)
//   Alt+M      mute (a bare M would be typed into the canvas text inputs:
//              login, character name, lobby chat)

import { isMuted, onMuteChange, toggleMuted } from '../audio/mute.ts';
import { isRepeatingKey, KEYS } from '../input/keyconfig.ts';
import { addCameraTurn, dragTurn, setTouchStick, stickAxes } from '../input/analog.ts';
import { canVibrate, haptic, hapticsEnabled, onHapticsChange, toggleHaptics } from '../input/haptics.ts';
import {
  clampStick,
  DOM_KEYS,
  isTap,
  keyDiff,
  repeatCount,
  REPEAT_INTERVAL,
  shortcutFor,
  stickKeys,
  SwallowedKeys,
  type GameKey,
  type MoveKey,
  type ProxyKey,
} from '../input/virtualpad.ts';
import { padLayout, padLayoutFill, type Insets, type PadLayout, type PxRect } from '../input/padlayout.ts';
import { FullscreenController } from './fullscreen.ts';
import type { SoftKeyboard } from './softkeyboard.ts';
import './webcontrols.css';

// How the Chat button reaches the game's chat.
export type ChatMode =
  // A DOM text field next to the view (the Online tab's chat form).
  | { kind: 'input'; input: HTMLInputElement }
  // The game's own canvas text input, opened with KEYS.chat (classic lobby);
  // `keyboard` raises the on-screen keyboard for it (ui/softkeyboard.ts).
  | { kind: 'canvas'; keyboard?: SoftKeyboard };

export type TouchSetting = 'auto' | 'on' | 'off';

export interface WebControlsOptions {
  // Element the overlay is mounted in (it covers it).
  root: HTMLElement;
  // Element put into fullscreen (default: root).
  fullscreenElement?: HTMLElement;
  // Element whose key listeners drive the game (the focused game canvas).
  keyTarget: HTMLElement;
  chat: ChatMode;
  // 'auto': shown on coarse pointers / touch screens; ?touch=1 / ?touch=0 in
  // the URL override it.
  touch?: TouchSetting;
  // Free CSS px under the canvas box (portrait phone), see input/padlayout.ts.
  below?: () => number;
  // true while the screen has the tall phone stage (stage.ts phoneLayout): the
  // top strip is then placed at the box's top-right corner.
  tall?: () => boolean;
  // true while the screen's 3D view fills the tall box (stage.ts phoneFill):
  // the stick and buttons go in the bar under the box, the small buttons in
  // the bar above it (input/padlayout.ts padLayoutFill).
  fill?: () => boolean;
}

export interface WebControls {
  readonly fullscreen: FullscreenController;
  setTouchVisible(on: boolean): void;
  // true: the stick, arrows and buttons are hidden for a screen made for taps
  // (title / login); the fullscreen and mute strip stays.
  setPadSuppressed(on: boolean): void;
  // true: menu pad (menus such as character select / creation): only the arrow
  // diamond and OK / BACK stay; the stick and the field-only buttons (PAL, MENU,
  // CHAT, VIB, the palette keys) are hidden. The fullscreen and mute strip stays.
  setPadMenu(on: boolean): void;
  dispose(): void;
}

// Feeds synthesized key events to the game canvas. Counts holders per key so
// two sources holding the same key release it only once both let go.
class KeyFeed {
  private readonly target: HTMLElement;
  private readonly held = new Map<string, number>();

  constructor(target: HTMLElement) {
    this.target = target;
  }

  private send(type: 'keydown' | 'keyup', k: ProxyKey, repeat = false): void {
    const ctrlKey = type === 'keydown' && k.key === 'Control';
    this.target.dispatchEvent(new KeyboardEvent(type, { key: k.key, code: k.code, repeat, ctrlKey, bubbles: true, cancelable: true }));
  }

  down(key: GameKey): void {
    const n = this.held.get(key) ?? 0;
    this.held.set(key, n + 1);
    if (n === 0) this.send('keydown', DOM_KEYS[key]);
  }

  up(key: GameKey): void {
    const n = this.held.get(key) ?? 0;
    if (n <= 0) return;
    if (n === 1) {
      this.held.delete(key);
      this.send('keyup', DOM_KEYS[key]);
    } else this.held.set(key, n - 1);
  }

  repeat(key: GameKey): void {
    if (this.held.has(key)) this.send('keydown', DOM_KEYS[key], true);
  }

  tap(k: ProxyKey): void {
    this.send('keydown', k);
    this.send('keyup', k);
  }

  releaseAll(): void {
    for (const key of [...this.held.keys()]) {
      this.held.delete(key);
      this.send('keyup', DOM_KEYS[key as GameKey]);
    }
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
const ICON_FULLSCREEN = ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'];
const ICON_EXIT_FULLSCREEN = ['M9 4v5H4', 'M20 9h-5V4', 'M15 20v-5h5', 'M4 15h5v5'];
const ICON_SOUND = ['M4 9h4l5-4v14l-5-4H4z', 'M16 9a4 4 0 0 1 0 6', 'M18.5 6.5a8 8 0 0 1 0 11'];
const ICON_MUTED = ['M4 9h4l5-4v14l-5-4H4z', 'M16 9l5 6', 'M21 9l-5 6'];

function button(cls: string, label: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.tabIndex = -1; // keep keyboard focus on the game canvas
  b.title = title;
  b.setAttribute('aria-label', title);
  b.textContent = label;
  return b;
}

function touchPreferred(): boolean {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

function urlTouchSetting(): TouchSetting | null {
  const q = new URLSearchParams(location.search).get('touch');
  return q === '1' ? 'on' : q === '0' ? 'off' : null;
}

export function installWebControls(opts: WebControlsOptions): WebControls {
  const { root, keyTarget, chat } = opts;
  const fs = new FullscreenController(opts.fullscreenElement ?? root);
  const feed = new KeyFeed(keyTarget);
  const cleanups: Array<() => void> = [() => fs.dispose()];
  const listen = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, capture = false) => {
    window.addEventListener(type, fn, capture);
    cleanups.push(() => window.removeEventListener(type, fn, capture));
  };
  const refocus = () => keyTarget.focus({ preventScroll: true });

  // The overlay covers exactly the canvas box, like the HUD canvases
  // (render/fieldhud.ts: offsetLeft / offsetTop / clientWidth / clientHeight),
  // so the palette tap targets line up with the drawn palette.
  const overlay = document.createElement('div');
  overlay.className = 'wc-overlay';
  // Pressing overlay controls must not move focus off the game canvas (its
  // blur handler clears the held keys).
  overlay.addEventListener('pointerdown', (e) => e.preventDefault());
  overlay.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- top strip: small buttons, fullscreen, mute ------------------------------
  const strip = document.createElement('div');
  strip.className = 'wc-strip';
  const row = document.createElement('div');
  row.className = 'wc-row';
  row.hidden = true; // touch only
  const fsButton = button('wc-bar-button', '', 'Fullscreen (Alt+Enter)');
  const muteButton = button('wc-bar-button', '', 'Mute (Alt+M)');
  const syncFs = (on: boolean) => {
    fsButton.replaceChildren(icon(on ? ICON_EXIT_FULLSCREEN : ICON_FULLSCREEN));
    fsButton.setAttribute('aria-pressed', String(on));
    const t = on ? 'Exit fullscreen (Alt+Enter)' : 'Fullscreen (Alt+Enter)';
    fsButton.title = t;
    fsButton.setAttribute('aria-label', t);
    requestAnimationFrame(relayout);
  };
  const syncMute = (m: boolean) => {
    muteButton.replaceChildren(icon(m ? ICON_MUTED : ICON_SOUND));
    muteButton.setAttribute('aria-pressed', String(m));
    const t = m ? 'Unmute (Alt+M)' : 'Mute (Alt+M)';
    muteButton.title = t;
    muteButton.setAttribute('aria-label', t);
  };
  syncMute(isMuted());
  cleanups.push(fs.onChange(syncFs), onMuteChange(syncMute));
  fsButton.addEventListener('click', () => {
    fs.toggle();
    refocus();
  });
  muteButton.addEventListener('click', () => {
    toggleMuted();
    refocus();
  });
  strip.append(row, fsButton, muteButton);

  // Shortcuts. The keydown is stopped in the window capture phase so the game
  // never sees Enter / M; the matching keyup is stopped too, even when Alt is
  // let go first.
  const swallowed = new SwallowedKeys();
  listen(
    'keydown',
    (e) => {
      if (!e.isTrusted) return; // the audio-unlock echo below
      const shortcut = shortcutFor(e);
      if (!shortcut) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      swallowed.down(e.code);
      // The audio modules start their AudioContexts on the first window
      // keydown (audio/bgm.ts, audio/se.ts), which this one no longer
      // reaches: echo a plain Alt keydown at the window only (no game
      // listener reads it; the canvas listeners are not on its path).
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', code: 'AltLeft', altKey: true }));
      if (e.repeat) return;
      if (shortcut === 'mute') toggleMuted();
      // Only while the game view is on screen (not from the login form or the
      // Map viewer tab), or to leave fullscreen.
      else if (fs.active || root.getClientRects().length > 0) fs.toggle();
    },
    true,
  );
  listen(
    'keyup',
    (e) => {
      if (swallowed.up(e.code)) e.stopImmediatePropagation();
    },
    true,
  );

  // --- touch pad -------------------------------------------------------------
  const pad = document.createElement('div');
  pad.className = 'wc-touch';
  pad.hidden = true;

  // Stick: floats to where the finger lands in the lower-left zone, returns
  // home on release.
  const zone = document.createElement('div');
  zone.className = 'wc-stick-zone';
  const base = document.createElement('div');
  base.className = 'wc-stick';
  const knob = document.createElement('div');
  knob.className = 'wc-knob';
  base.append(knob);
  overlay.append(base);

  type StickState =
    | { kind: 'idle' }
    | { kind: 'held'; pointerId: number; cx: number; cy: number; startX: number; startY: number; startTime: number; maxMove: number; keys: ReadonlySet<MoveKey> };
  let stick: StickState = { kind: 'idle' };
  let layout: PadLayout | null = null;
  const stickRadius = () => (layout ? layout.stickSize / 2 : 48);
  const placeStick = (x: number | null, y: number | null) => {
    if (!layout) return;
    const r = overlay.getBoundingClientRect();
    const cx = x === null ? layout.stickHome.x : x - r.left;
    const cy = y === null ? layout.stickHome.y : y - r.top;
    base.style.left = `${cx}px`;
    base.style.top = `${cy}px`;
    base.classList.toggle('is-active', x !== null);
  };
  const moveKnob = (dx: number, dy: number) => {
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  const setStickKeys = (next: ReadonlySet<MoveKey>) => {
    if (stick.kind !== 'held') return;
    const { release, press } = keyDiff(stick.keys, next);
    for (const k of release) feed.up(k);
    for (const k of press) feed.down(k);
    stick = { ...stick, keys: next };
  };
  const endStick = (e: PointerEvent | null) => {
    if (stick.kind !== 'held') return;
    const s = stick;
    setStickKeys(new Set());
    stick = { kind: 'idle' };
    setTouchStick(null);
    endCameraDrag();
    placeStick(null, null);
    moveKnob(0, 0);
    if (e && e.type === 'pointerup' && isTap(performance.now() - s.startTime, s.maxMove, 0)) passTap(e.clientX, e.clientY);
  };
  zone.addEventListener('pointerdown', (e) => {
    if (stick.kind === 'held') return;
    capture(zone, e.pointerId);
    stick = { kind: 'held', pointerId: e.pointerId, cx: e.clientX, cy: e.clientY, startX: e.clientX, startY: e.clientY, startTime: performance.now(), maxMove: 0, keys: new Set() };
    setTouchStick({ lr: 0, fb: 0 });
    placeStick(e.clientX, e.clientY);
    moveKnob(0, 0);
  });
  zone.addEventListener('pointermove', (e) => {
    if (stick.kind !== 'held' || e.pointerId !== stick.pointerId) return;
    const radius = stickRadius();
    const { dx, dy } = clampStick(e.clientX - stick.cx, e.clientY - stick.cy, radius);
    stick = { ...stick, maxMove: Math.max(stick.maxMove, Math.hypot(e.clientX - stick.startX, e.clientY - stick.startY)) };
    moveKnob(dx, dy);
    setStickKeys(stickKeys({ dx, dy, radius }));
    setTouchStick(stickAxes(dx, dy, radius));
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    zone.addEventListener(type, (e) => {
      if (stick.kind === 'held' && e.pointerId === stick.pointerId) endStick(e);
    });
  }

  // Second finger: while the stick is held, a touch anywhere on the canvas
  // outside the pad's controls turns the camera as it drags sideways. The
  // canvas never sees that touch (window capture phase).
  let camDrag: { pointerId: number; x: number } | null = null;
  function endCameraDrag(): void {
    camDrag = null;
  }
  const onCanvas = (e: PointerEvent): boolean => {
    const t = e.target;
    if (t instanceof Node && overlay.contains(t) && t !== overlay) return false;
    const r = keyTarget.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
  };
  listen(
    'pointerdown',
    (e) => {
      if (pad.hidden || stick.kind !== 'held' || camDrag || e.pointerType !== 'touch' || e.pointerId === stick.pointerId || !onCanvas(e)) return;
      camDrag = { pointerId: e.pointerId, x: e.clientX };
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  listen(
    'pointermove',
    (e) => {
      if (!camDrag || e.pointerId !== camDrag.pointerId) return;
      addCameraTurn(dragTurn(e.clientX - camDrag.x, keyTarget.clientWidth));
      camDrag.x = e.clientX;
      e.stopImmediatePropagation();
    },
    true,
  );
  for (const type of ['pointerup', 'pointercancel'] as const) {
    listen(
      type,
      (e) => {
        if (!camDrag || e.pointerId !== camDrag.pointerId) return;
        endCameraDrag();
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );
  }

  // A tap on the stick zone reaches the canvas below as a click (the classic
  // screens and the lobby take pointer input).
  function passTap(x: number, y: number): void {
    const under = document.elementsFromPoint(x, y).find((el) => !overlay.contains(el));
    if (!under) return;
    const init: PointerEventInit = { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true };
    under.dispatchEvent(new PointerEvent('pointermove', init));
    under.dispatchEvent(new PointerEvent('pointerdown', init));
    under.dispatchEvent(new PointerEvent('pointerup', init));
    under.dispatchEvent(new MouseEvent('click', init));
  }

  // Buttons that hold a game key while pressed (multi-touch: each tracks its
  // own pointer).
  const releasers: Array<() => void> = [];
  const holdButton = (cls: string, label: string, title: string, key: GameKey): HTMLButtonElement => {
    const b = button(`wc-key ${cls}`, label, title);
    let pointer: number | null = null;
    let timer = 0;
    const release = () => {
      if (pointer === null) return;
      pointer = null;
      clearInterval(timer);
      b.classList.remove('is-down');
      feed.up(key);
    };
    b.addEventListener('pointerdown', (e) => {
      if (pointer !== null) return;
      pointer = e.pointerId;
      capture(b, e.pointerId);
      b.classList.add('is-down');
      haptic('tap');
      feed.down(key);
      if (isRepeatingKey(key)) {
        const start = performance.now();
        let sent = 0;
        timer = window.setInterval(() => {
          const due = repeatCount(performance.now() - start);
          for (; sent < due; sent++) feed.repeat(key);
        }, REPEAT_INTERVAL / 2);
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      b.addEventListener(type, (e) => {
        if (e.pointerId === pointer) release();
      });
    }
    releasers.push(release);
    return b;
  };

  // The action palette window itself: its three slot icons and the Ctrl tab
  // are tap targets for the palette keys (input/padlayout.ts).
  const PALETTE_TITLES: Partial<Record<GameKey, string>> = {
    [KEYS.paletteLeft]: 'Palette left (Left)',
    [KEYS.paletteMiddle]: 'Palette middle (Down)',
    [KEYS.paletteRight]: 'Palette right (Right)',
    [KEYS.paletteChange]: 'Palette change (Ctrl)',
  };
  const paletteButtons = new Map<GameKey, HTMLButtonElement>();
  for (const key of [KEYS.paletteLeft, KEYS.paletteMiddle, KEYS.paletteRight, KEYS.paletteChange] as const) {
    paletteButtons.set(key, holdButton('wc-palette', '', PALETTE_TITLES[key] ?? key, key));
  }

  // Arrow diamond: Up = camera, the others are the palette keys again; in
  // menus they are the cursor keys, as on the keyboard.
  const dpad = document.createElement('div');
  dpad.className = 'wc-dpad';
  dpad.append(
    holdButton('wc-up', '▲', 'Camera / up (Up)', KEYS.camera),
    holdButton('wc-left', '◀', 'Left (Left)', KEYS.selectLeft),
    holdButton('wc-down', '▼', 'Down (Down)', KEYS.selectDown),
    holdButton('wc-rt', '▶', 'Right (Right)', KEYS.selectRight),
  );
  const actions = document.createElement('div');
  actions.className = 'wc-actions';
  actions.append(holdButton('wc-decide', 'OK', 'Decide (Enter)', KEYS.decide), holdButton('wc-cancel', 'BACK', 'Cancel (Backspace)', KEYS.cancel));
  row.append(holdButton('wc-small', 'PAL', 'Palette change (Ctrl)', KEYS.paletteChange), holdButton('wc-small', 'MENU', 'Menu (Home)', KEYS.menu));

  // Chat.
  const chatButton = button('wc-key wc-small', 'CHAT', 'Chat');
  row.append(chatButton);
  chatButton.addEventListener('click', () => {
    if (chat.kind === 'input') {
      // The chat field is outside the game view: leave fullscreen to show it.
      if (fs.active && !root.contains(chat.input)) fs.exit();
      chat.input.focus();
      chat.input.scrollIntoView({ block: 'center' });
    } else {
      feed.tap(DOM_KEYS[KEYS.chat]); // Space opens the game's chat line
      chat.keyboard?.sync(true); // inside this tap: the on-screen keyboard opens
    }
  });

  // Vibration on / off (only where the browser can vibrate).
  if (canVibrate()) {
    const vib = button('wc-key wc-small', 'VIB', 'Vibration');
    const syncVib = (on: boolean) => {
      vib.setAttribute('aria-pressed', String(on));
      vib.title = on ? 'Vibration: on' : 'Vibration: off';
      vib.setAttribute('aria-label', vib.title);
      vib.classList.toggle('is-off', !on);
    };
    syncVib(hapticsEnabled());
    cleanups.push(onHapticsChange(syncVib));
    vib.addEventListener('click', () => {
      if (toggleHaptics()) haptic('tap');
      refocus();
    });
    row.append(vib);
  }

  pad.append(zone, dpad, actions, ...paletteButtons.values());
  overlay.append(pad, strip);
  root.append(overlay);

  // --- layout ------------------------------------------------------------------
  const place = (el: HTMLElement, r: PxRect) => {
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  };
  // Safe-area insets, read from the overlay's CSS padding (env()).
  const insets = (): Insets => {
    const cs = getComputedStyle(overlay);
    return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
  };
  // Menu pad (setPadMenu): the parts that exist only on the field are hidden.
  let menuOnly = false;
  function relayout(): void {
    const w = keyTarget.clientWidth;
    const h = keyTarget.clientHeight;
    Object.assign(overlay.style, { left: `${keyTarget.offsetLeft}px`, top: `${keyTarget.offsetTop}px`, width: `${w}px`, height: `${h}px` });
    if (!w || !h) return;
    // Tall fill: the pad lives in the bars around the box (see padLayoutFill).
    const fillOn = !!opts.fill?.() && h > w && !menuOnly;
    const l = fillOn ? padLayoutFill(w, h, insets(), opts.below?.() ?? 0) : padLayout(w, h, insets(), opts.below?.() ?? 0);
    layout = l;
    // Menu pad on the portrait tall stage: padLayout is sized for the field's
    // landscape window and runs off the right edge here. The arrows and OK /
    // BACK go in the bar under the 640x480 screen (the stage is centred, so the
    // bars above and below are equal), right-aligned.
    const menuTall = menuOnly && h > w && !!opts.tall?.();
    let dpadRect = l.dpad;
    let actionsRect = l.actions;
    let button = l.button;
    let gap = l.gap;
    if (menuTall) {
      const band = (h - (480 * w) / 640) / 2; // the 640x480 screen is w wide
      button = Math.min(60, Math.max(30, band / 3.4));
      gap = 6;
      const aw = button * 1.25;
      const dsize = 3 * button;
      const bottomY = h - gap;
      actionsRect = { x: w - gap - aw, y: bottomY - 2 * aw - gap, w: aw, h: 2 * aw + gap };
      dpadRect = { x: actionsRect.x - gap - dsize, y: bottomY - dsize, w: dsize, h: dsize };
    }
    overlay.style.setProperty('--wc-btn', `${button}px`);
    overlay.style.setProperty('--wc-gap', `${gap}px`);
    if (fillOn) place(strip, l.topStrip);
    else if (opts.tall?.()) {
      // The HUD geometry of padLayout does not hold on a tall stage (no HUD
      // there): the two buttons sit in the top-right corner.
      const sw = 2 * l.button * 0.75 + l.gap;
      place(strip, { x: Math.max(0, w - insets().right - l.gap - sw), y: l.topStrip.y, w: sw, h: l.topStrip.h });
    } else place(strip, l.topStrip);
    place(zone, l.stickZone);
    place(dpad, dpadRect);
    place(actions, actionsRect);
    for (const { key, rect } of l.palette) {
      const b = paletteButtons.get(key);
      if (b) place(b, rect);
    }
    base.style.width = base.style.height = `${l.stickSize}px`;
    if (stick.kind === 'idle') placeStick(null, null);
  }
  const ro = new ResizeObserver(() => relayout());
  ro.observe(keyTarget);
  cleanups.push(() => ro.disconnect());
  listen('resize', () => relayout());
  listen('psobb:fit', () => relayout()); // the canvas box moved (ui/stagefit.ts)
  syncFs(false);
  relayout();

  // Nothing stays held when the page loses focus or the pad is hidden.
  const releaseAll = () => {
    endStick(null);
    for (const r of releasers) r();
    feed.releaseAll();
  };
  listen('blur', releaseAll);
  const onVisibility = () => {
    if (document.hidden) releaseAll();
  };
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

  // While the pad is up the canvas must not pan or zoom the page: a pan would
  // cancel the pointers (pointercancel) under the stick and buttons.
  const touchAction = keyTarget.style.touchAction;
  let wanted = false;
  let suppressed = false;
  const syncParts = () => {
    const shown = !pad.hidden;
    zone.hidden = menuOnly;
    base.hidden = !shown || menuOnly;
    row.hidden = !shown || menuOnly;
    for (const b of paletteButtons.values()) b.hidden = menuOnly;
  };
  const applyTouch = (on: boolean) => {
    if (pad.hidden === !on) return;
    if (!on) releaseAll();
    pad.hidden = !on;
    syncParts();
    overlay.classList.toggle('is-touch', on);
    keyTarget.style.touchAction = on ? 'none' : touchAction;
    relayout();
  };
  const setTouchVisible = (on: boolean) => {
    wanted = on;
    applyTouch(wanted && !suppressed);
  };
  const setPadSuppressed = (on: boolean) => {
    suppressed = on;
    applyTouch(wanted && !suppressed);
  };
  const setPadMenu = (on: boolean) => {
    if (menuOnly === on) return;
    menuOnly = on;
    releaseAll(); // a key held on the hidden stick or palette must not stick
    syncParts();
    relayout();
  };
  base.hidden = true;
  const setting = urlTouchSetting() ?? opts.touch ?? 'auto';
  if (setting === 'on') setTouchVisible(true);
  else if (setting === 'auto') {
    setTouchVisible(touchPreferred());
    const mq = matchMedia('(pointer: coarse)');
    const onMq = () => setTouchVisible(touchPreferred());
    mq.addEventListener('change', onMq);
    cleanups.push(() => mq.removeEventListener('change', onMq));
    // A touch anywhere shows the pad even where detection said no.
    listen('pointerdown', (e) => {
      if (e.pointerType === 'touch') setTouchVisible(true);
    });
  }

  return {
    fullscreen: fs,
    setTouchVisible,
    setPadSuppressed,
    setPadMenu,
    dispose() {
      releaseAll();
      for (const c of cleanups) c();
      keyTarget.style.touchAction = touchAction;
      overlay.remove();
    },
  };
}

// setPointerCapture throws for a pointer the browser no longer tracks (a
// touch that ended before the handler ran, or a synthetic event); the
// control still works without the capture.
function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // ignored: see above
  }
}

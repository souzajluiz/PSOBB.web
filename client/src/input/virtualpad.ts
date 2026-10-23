// On-screen game pad logic (a browser convenience for touch screens, not in
// PsoBB.exe). The pad does not drive the game directly: it turns touches into
// the same keys the keyboard sends (input/keyconfig.ts KEYS), so every view
// keeps reading its held-key set and keydown handlers unchanged.
//
// Movement is digital in this client (the views test W / A / S / D), so the
// stick is quantised to 8 directions with a dead zone in the middle.

import { domEventOf, KEYS } from './keyconfig.ts';

export type GameKey = string; // a DOM key name (KEYS holds the bound ones)
export type MoveKey = string;

// KeyboardEvent.key / .code of each game key. Read at call time: the keys
// follow the key config (input/keyconfig.ts applyKeyConfig).
export const DOM_KEYS: Readonly<Record<string, { key: string; code: string }>> = new Proxy(
  {} as Record<string, { key: string; code: string }>,
  { get: (_t, k) => domEventOf(String(k)) },
);

// Fraction of the stick radius that counts as centred.
export const STICK_DEAD_ZONE = 0.25;

// The 8 directions counter-clockwise from screen right (east), y up.
function sectorKeys(sector: number): readonly MoveKey[] {
  switch (sector) {
    case 0: return [KEYS.moveRight];
    case 1: return [KEYS.moveForward, KEYS.moveRight];
    case 2: return [KEYS.moveForward];
    case 3: return [KEYS.moveForward, KEYS.moveLeft];
    case 4: return [KEYS.moveLeft];
    case 5: return [KEYS.moveBackward, KEYS.moveLeft];
    case 6: return [KEYS.moveBackward];
    default: return [KEYS.moveBackward, KEYS.moveRight];
  }
}

export interface StickVector {
  // Knob offset from the stick centre in screen pixels (y grows downward).
  dx: number;
  dy: number;
  radius: number;
}

// Move keys held for a stick position: none inside the dead zone, otherwise
// the one or two keys of the nearest of 8 directions.
export function stickKeys({ dx, dy, radius }: StickVector, deadZone = STICK_DEAD_ZONE): ReadonlySet<MoveKey> {
  if (!(radius > 0) || Math.hypot(dx, dy) <= radius * deadZone) return new Set();
  const angle = Math.atan2(-dy, dx); // screen y down -> math y up
  const sector = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return new Set(sectorKeys(sector));
}

// Clamps a knob offset to the stick radius (the knob stops at the rim).
export function clampStick(dx: number, dy: number, radius: number): { dx: number; dy: number } {
  const len = Math.hypot(dx, dy);
  if (len <= radius || len === 0) return { dx, dy };
  return { dx: (dx / len) * radius, dy: (dy / len) * radius };
}

// Keys to release and to press to go from one held set to the next.
export function keyDiff<K>(prev: ReadonlySet<K>, next: ReadonlySet<K>): { release: K[]; press: K[] } {
  return { release: [...prev].filter((k) => !next.has(k)), press: [...next].filter((k) => !prev.has(k)) };
}

// Keyboard-like auto-repeat for held arrow buttons (menu cursors): first
// repeat after REPEAT_DELAY ms, then every REPEAT_INTERVAL ms. isRepeatingKey
// (the select keys) says which keys repeat.
export const REPEAT_DELAY = 400;
export const REPEAT_INTERVAL = 80;

// Number of repeat keydowns due after a button has been held `heldMs`.
export function repeatCount(heldMs: number): number {
  return heldMs < REPEAT_DELAY ? 0 : 1 + Math.floor((heldMs - REPEAT_DELAY) / REPEAT_INTERVAL);
}

// A tap (short press that barely moved) on the stick area is passed through
// to the game canvas as a click.
export const TAP_MAX_MS = 250;
export const TAP_MAX_MOVE = 10;

export function isTap(ms: number, dx: number, dy: number): boolean {
  return ms <= TAP_MAX_MS && Math.hypot(dx, dy) <= TAP_MAX_MOVE;
}

// Typed-text proxy for the on-screen keyboard. The hidden field keeps one
// sentinel character so a Backspace on an "empty" field still produces an
// input event; each change maps to the keys the game's own text input reads.
export const PROXY_SENTINEL = '​';

export type ProxyKey = { key: string; code: string };

export function proxyKeys(value: string): ProxyKey[] {
  if (!value.startsWith(PROXY_SENTINEL)) return [DOM_KEYS.backspace];
  const out: ProxyKey[] = [];
  for (const ch of value.slice(PROXY_SENTINEL.length)) {
    if (ch === '\n') out.push(DOM_KEYS.enter);
    else out.push({ key: ch, code: '' });
  }
  return out;
}

// Android keyboards compose words (IME): while composing, the field holds
// text that is not final; it is read once composition ends.
export function proxyInput(value: string, composing: boolean): ProxyKey[] | null {
  return composing ? null : proxyKeys(value);
}

// Browser shortcuts of ui/webcontrols.ts. Alt+Enter / Alt+M: the game binds
// neither Alt nor M, and F1..F12 are its hotbar keys (F11 is the browser's).
export type Shortcut = 'fullscreen' | 'mute';

export function shortcutFor(e: { key: string; code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): Shortcut | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  if (e.key === 'Enter') return 'fullscreen';
  if (e.code === 'KeyM') return 'mute';
  return null;
}

// Keys whose keydown a shortcut swallowed; the matching keyup is swallowed
// too, even when Alt is released first.
export class SwallowedKeys {
  private readonly codes = new Set<string>();

  down(code: string): void {
    this.codes.add(code);
  }

  // true: this keyup belongs to a swallowed keydown.
  up(code: string): boolean {
    return this.codes.delete(code);
  }
}

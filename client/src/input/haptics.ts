// Vibration feedback for touch screens (a browser convenience, not in
// PsoBB.exe: the exe has no rumble on keyboard / mouse and this client has no
// gamepad support). Short pulses through navigator.vibrate, which only some
// browsers have (Android Chrome / Firefox); iOS Safari and desktop Safari
// have none, and there every call is a no-op (desktop Chrome has the call but
// no motor).
//
// Pulses: a touch-pad key press (palette slot, arrow, OK / BACK, MENU), the
// local player landing a hit, the local player taking damage (longer), and a
// level up (a short pattern). Hits and damage come from render/combat.ts
// (applyEnemyHit, PlayerDamage's sendHit event, displayLevelUp).
//
// On by default. The choice is kept in localStorage ("psobb.haptics" = "1" /
// "0"; the touch pad's VIB button toggles it) and ?haptics=1 / ?haptics=0 in
// the URL wins for that page load (not stored), like ?sound= (audio/mute.ts).

export const HAPTICS_STORAGE_KEY = 'psobb.haptics';

export type HapticKind = 'tap' | 'hit' | 'damage' | 'levelup';

// Vibration patterns in ms (on, off, on, ...). ASSUMED: tuned by feel.
export const HAPTIC_PATTERNS: Readonly<Record<HapticKind, number | readonly number[]>> = {
  tap: 8,
  hit: 18,
  damage: 45,
  levelup: [30, 50, 30, 50, 80],
};

// A pulse does not cut a stronger one still running (several enemies hit in
// one swing, or a hit and a hurt in the same frame).
const PRIORITY: Readonly<Record<HapticKind, number>> = { tap: 0, hit: 1, damage: 2, levelup: 3 };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export interface VibrateLike {
  vibrate?: (pattern: number | number[]) => boolean;
}

function storage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked site data, sandboxed frame, Node
  }
}

// "1" / "true" on, "0" / "false" off, anything else no choice.
export function parseHaptics(raw: string | null): boolean | null {
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}

export function loadHaptics(store: StorageLike | null = storage()): boolean | null {
  try {
    return parseHaptics(store?.getItem(HAPTICS_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function saveHaptics(on: boolean, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(HAPTICS_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Private mode / quota: the choice just does not persist.
  }
}

// ?haptics= > stored choice > on.
export function resolveHaptics(stored: boolean | null, param: string | null): boolean {
  return parseHaptics(param) ?? stored ?? true;
}

function hapticsParam(): string | null {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('haptics');
  } catch {
    return null;
  }
}

function defaultNavigator(): VibrateLike | null {
  return (globalThis.navigator as VibrateLike | undefined) ?? null;
}

// Whether this browser has navigator.vibrate (false on iOS Safari).
export function canVibrate(nav: VibrateLike | null = defaultNavigator()): boolean {
  return typeof nav?.vibrate === 'function';
}

let enabled = resolveHaptics(loadHaptics(), hapticsParam());
let last: { kind: HapticKind; until: number } | null = null;
const listeners = new Set<(on: boolean) => void>();

export function hapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(on: boolean, store: StorageLike | null = storage()): void {
  if (on === enabled) return;
  enabled = on;
  saveHaptics(on, store);
  for (const fn of listeners) fn(on);
}

export function toggleHaptics(): boolean {
  setHapticsEnabled(!enabled);
  return enabled;
}

// Calls fn on every change; returns the unsubscribe function.
export function onHapticsChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function patternLength(p: number | readonly number[]): number {
  return typeof p === 'number' ? p : p.reduce((a, b) => a + b, 0);
}

// Plays one pulse. Returns whether the device was asked to vibrate: false
// when haptics are off, the browser has no vibrate (iOS), a stronger
// pulse is still running, or the call threw.
export function haptic(kind: HapticKind, nav: VibrateLike | null = defaultNavigator(), now: number = Date.now()): boolean {
  if (!enabled || !nav || typeof nav.vibrate !== 'function') return false;
  if (last && now < last.until && PRIORITY[last.kind] > PRIORITY[kind]) return false;
  const pattern = HAPTIC_PATTERNS[kind];
  try {
    nav.vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
  } catch {
    return false; // e.g. blocked before the first user gesture
  }
  last = { kind, until: now + patternLength(pattern) };
  return true;
}

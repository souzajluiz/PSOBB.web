// On-screen function-key bar (a browser convenience for Macs, not in PsoBB.exe).
// On a Mac the top row of keys is brightness / volume, so F1..F12 reach the
// browser only with fn held, and the game's hotbar and emote keys (Alt+F1..)
// cannot be used. The bar's buttons send the same KeyboardEvents a keyboard
// would (ui/webcontrols.ts), so the held-key sets and keydown handlers see an
// ordinary F-key press. Pure helpers here; the DOM part is in ui/webcontrols.ts.

import { domEventOf } from './keyconfig.ts';

export const FKEY_COUNT = 12;

// How long a press of a bar button keeps its key down at least. The client
// reads its held keys once per 30 fps frame (~33 ms), so a shorter tap can be
// missed; 120 ms covers several frames.
export const FKEY_HOLD_MS = 120;

// localStorage key of the bar's visibility: "1" shown, "0" hidden, absent = the
// platform default (shown on a Mac).
export const FKEYS_STORAGE_KEY = 'psobb.fkeys';

export interface PlatformInfo {
  platform?: string | undefined; // navigator.platform
  userAgent?: string | undefined;
  maxTouchPoints?: number | undefined;
  uaPlatform?: string | undefined; // navigator.userAgentData?.platform
}

// True on a Mac keyboard. iPhones and iPads (also an iPad that asks for the
// desktop site, which reports "MacIntel" with touch points) are not Macs here:
// they have the touch pad and no function-key row.
export function isMacPlatform(p: PlatformInfo): boolean {
  const ua = p.userAgent ?? '';
  if (/iPhone|iPad|iPod/.test(ua)) return false;
  const platform = p.platform ?? '';
  if ((p.maxTouchPoints ?? 0) > 1 && /^Mac/i.test(platform)) return false;
  if (p.uaPlatform) return p.uaPlatform === 'macOS';
  return /^Mac/i.test(platform) || /Macintosh/.test(ua);
}

// Whether the bar is shown: the stored choice when there is one, else the
// platform default.
export function fkeysShown(stored: string | null | undefined, mac: boolean): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return mac;
}

// KeyboardEvent fields of F<n> (1..12) with Alt / Option held or not; null for a
// number outside 1..12.
export function fKeyEventInit(n: number, altKey: boolean): { key: string; code: string; altKey: boolean } | null {
  if (!Number.isInteger(n) || n < 1 || n > FKEY_COUNT) return null;
  const { key, code } = domEventOf(`f${n}`);
  return { key, code, altKey };
}

// Milliseconds still to keep a key down after a press at `pressedAt`, when the
// press is seen to end at `now` (0 once FKEY_HOLD_MS has passed).
export function holdRemaining(pressedAt: number, now: number): number {
  return Math.max(0, pressedAt + FKEY_HOLD_MS - now);
}

// Master mute (a browser convenience, not in PsoBB.exe: the exe has no volume
// settings, so this stays out of the Options window).
//
// Every audio module routes its output through masterOutput() instead of
// ctx.destination. Muting ramps those gain nodes to 0; the AudioContexts keep
// running, so BGM loop points and SE timing are not disturbed. The choice is
// kept in localStorage ("psobb.muted" = "1" / "0").
//
// Default when nothing is stored: muted under the Vite dev server
// (import.meta.env.DEV), sound on in production builds. A stored choice (the
// toggle was used) wins over that default, and ?sound=1 / ?sound=0 in the URL
// wins over both for that page load (it is not stored). The gain nodes are
// created with the resolved value, so nothing plays before it applies.

export const MUTE_STORAGE_KEY = 'psobb.muted';
// Time constant of the gain ramp (seconds): short enough to feel instant,
// long enough to avoid a click.
const RAMP = 0.015;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

// "1" / "true" mean muted; anything else (missing, garbage) means sound on.
export function parseMuted(raw: string | null): boolean {
  return raw === '1' || raw === 'true';
}

export function serializeMuted(muted: boolean): string {
  return muted ? '1' : '0';
}

function storage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked site data, sandboxed frame, Node
  }
}

// The stored choice, or null when the toggle was never used.
export function loadMuted(store: StorageLike | null = storage()): boolean | null {
  try {
    const raw = store?.getItem(MUTE_STORAGE_KEY) ?? null;
    return raw === null ? null : parseMuted(raw);
  } catch {
    return null;
  }
}

export interface MuteDefaults {
  stored: boolean | null; // loadMuted()
  dev: boolean; // import.meta.env.DEV
  soundParam: string | null; // ?sound= of the page URL
}

// Starting mute state: ?sound= > stored choice > muted in dev, on in builds.
export function resolveMuted({ stored, dev, soundParam }: MuteDefaults): boolean {
  if (soundParam === '1') return false;
  if (soundParam === '0') return true;
  if (stored !== null) return stored;
  return dev;
}

function soundParam(): string | null {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('sound');
  } catch {
    return null;
  }
}

export function saveMuted(muted: boolean, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(MUTE_STORAGE_KEY, serializeMuted(muted));
  } catch {
    // Private mode / quota: the choice just does not persist.
  }
}

// import.meta.env is undefined outside Vite (Node tests).
let muted = resolveMuted({ stored: loadMuted(), dev: import.meta.env?.DEV === true, soundParam: soundParam() });
const outputs = new Set<GainNode>();
const listeners = new Set<(muted: boolean) => void>();

export function isMuted(): boolean {
  return muted;
}

// The node an audio module connects to instead of ctx.destination.
export function masterOutput(ctx: BaseAudioContext): AudioNode {
  const gain = ctx.createGain();
  gain.gain.value = muted ? 0 : 1;
  gain.connect(ctx.destination);
  outputs.add(gain);
  return gain;
}

export function setMuted(next: boolean): void {
  if (next === muted) return;
  muted = next;
  for (const gain of outputs) {
    const t = gain.context.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setTargetAtTime(muted ? 0 : 1, t, RAMP);
  }
  saveMuted(muted);
  for (const fn of listeners) fn(muted);
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

// Calls fn on every change; returns the unsubscribe function.
export function onMuteChange(fn: (muted: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

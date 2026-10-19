// Drawing-buffer resolution: the pixel ratio of the renderer.
//
// Desktop keeps min(devicePixelRatio, 2). A phone (small coarse-pointer screen,
// devicePixelRatio 3) would draw 4x the pixels of dpr 1.5 for almost no visible
// gain, and its GPU, not its CPU, is what a full-screen pass costs, so there the
// ratio starts at 1.5 and an AdaptiveResolution steps it between 1 and that cap
// by the measured frame time, with hysteresis: it drops one step when the
// average of a window of frames is slower than DROP_MS, raises one step only
// after a longer window faster than RAISE_MS, and waits COOLDOWN_MS after every
// change, so it does not oscillate around a threshold.
//
// URL overrides (for testing, they turn the adaptation off):
//   ?dpr=1.25               the ratio itself
//   ?quality=low | high     low: 1; high: min(devicePixelRatio, 2) like desktop
//   ?quality=auto           the default

export const DESKTOP_MAX_RATIO = 2;
export const MOBILE_MAX_RATIO = 1.5;
export const MIN_RATIO = 1;
export const STEP = 0.25;
export const DROP_MS = 24; // average frame time above this: lower one step (under ~42 fps)
export const RAISE_MS = 13; // average frame time below this for a long window: raise one step
export const DROP_FRAMES = 45;
export const RAISE_FRAMES = 240;
export const COOLDOWN_MS = 3000;
export const SPIKE_MS = 250; // longer frames (tab switch, GC, loading) are not samples

export interface ScreenInfo {
  devicePixelRatio: number;
  coarsePointer: boolean;
  shortSide: number; // CSS px of the screen's shorter side
}

// A phone or a small tablet: touch first and a short side under 820 CSS px.
export function isSmallTouchScreen(s: ScreenInfo): boolean {
  return s.coarsePointer && s.shortSide > 0 && s.shortSide <= 820;
}

export interface ResolutionPlan {
  ratio: number; // the starting pixel ratio
  max: number; // the cap the adaptation raises to
  adaptive: boolean;
}

export function planResolution(s: ScreenInfo, search = ''): ResolutionPlan {
  const q = new URLSearchParams(search);
  const dpr = Math.max(0.5, s.devicePixelRatio || 1);
  const desktop = Math.min(dpr, DESKTOP_MAX_RATIO);
  const forced = Number(q.get('dpr'));
  if (q.has('dpr') && forced > 0 && forced <= 4) return { ratio: forced, max: forced, adaptive: false };
  const quality = q.get('quality');
  if (quality === 'low') return { ratio: Math.min(dpr, MIN_RATIO), max: Math.min(dpr, MIN_RATIO), adaptive: false };
  if (quality === 'high') return { ratio: desktop, max: desktop, adaptive: false };
  if (isSmallTouchScreen(s)) {
    const max = Math.min(dpr, MOBILE_MAX_RATIO);
    return { ratio: max, max, adaptive: max > MIN_RATIO };
  }
  return { ratio: desktop, max: desktop, adaptive: false };
}

export class AdaptiveResolution {
  ratio: number;
  readonly max: number;
  readonly min = MIN_RATIO;
  readonly adaptive: boolean;
  private sum = 0;
  private frames = 0;
  private fastSum = 0;
  private fastFrames = 0;
  private sinceChange = 0; // ms since the last change

  constructor(plan: ResolutionPlan) {
    this.ratio = plan.ratio;
    this.max = plan.max;
    this.adaptive = plan.adaptive;
  }

  // Feeds one frame (ms since the previous one). Returns the new ratio when it
  // changed, else null.
  update(frameMs: number): number | null {
    if (!this.adaptive || !(frameMs > 0) || frameMs > SPIKE_MS) return null;
    this.sinceChange += frameMs;
    this.sum += frameMs;
    this.frames++;
    this.fastSum += frameMs;
    this.fastFrames++;
    if (this.sinceChange < COOLDOWN_MS) {
      // Only the window that starts after the cooldown counts.
      this.reset();
      return null;
    }
    if (this.frames >= DROP_FRAMES && this.sum / this.frames > DROP_MS) {
      const next = Math.max(this.min, this.ratio - STEP);
      return this.change(next);
    }
    if (this.frames >= DROP_FRAMES) {
      this.sum = 0;
      this.frames = 0;
    }
    if (this.fastFrames >= RAISE_FRAMES) {
      const fast = this.fastSum / this.fastFrames < RAISE_MS;
      this.fastSum = 0;
      this.fastFrames = 0;
      if (fast) return this.change(Math.min(this.max, this.ratio + STEP));
    }
    return null;
  }

  private reset(): void {
    this.sum = 0;
    this.frames = 0;
    this.fastSum = 0;
    this.fastFrames = 0;
  }

  private change(next: number): number | null {
    this.reset();
    if (next === this.ratio) return null;
    this.ratio = next;
    this.sinceChange = 0;
    return next;
  }
}

// The browser's view of the screen (null fields in a non-browser context).
export function readScreenInfo(): ScreenInfo {
  const g = globalThis as { devicePixelRatio?: number; matchMedia?: (q: string) => { matches: boolean }; screen?: { width: number; height: number } };
  return {
    devicePixelRatio: g.devicePixelRatio ?? 1,
    coarsePointer: g.matchMedia?.('(pointer: coarse)').matches ?? false,
    shortSide: g.screen ? Math.min(g.screen.width, g.screen.height) : 0,
  };
}

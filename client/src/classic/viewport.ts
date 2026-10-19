// Fits the classic page to a phone's screen and keeps it fitted through
// rotations (see ui/stagefit.ts for the rules). On a desktop window nothing is
// touched: the CSS of classic.html stretches the stage over the window as the
// exe does.
//
// One place re-measures and refits everything that depends on the screen: the
// 2D stage and 3D world canvases (their own ResizeObservers then resize the
// drawing buffers, renderers and cameras), the touch overlay (it listens for
// 'psobb:fit' and picks the landscape or portrait pad layout), the key button
// and hidden text fields of the on-screen keyboard, and the rotate hint. The
// loader (#boot) is position: fixed over the page and follows by CSS alone.
//
// Rotation is read from screen.orientation, matchMedia (orientation), resize,
// orientationchange and the visual viewport. iOS reports the old size right
// after a rotation, so every trigger measures again on the next two frames and
// after 200 ms. The on-screen keyboard also shrinks the viewport: while it is
// up the orientation is kept unless the width changed (nextOrientation).

import { fitEnabled, fitStage, keyboardOpen, nextOrientation, orientationOf, padBelow, snapBox, usableArea, type Box, type Insets, type Orientation } from '../ui/stagefit.ts';

export interface StageFitOptions {
  canvases: HTMLElement[];
  safe: HTMLElement; // padding = the safe-area insets
  hint: HTMLElement; // "rotate your phone"
  // true while the on-screen keyboard has focus (ui/softkeyboard.ts).
  keyboardFocused?: () => boolean;
  onBox?: (box: Box, orientation: Orientation) => void;
}

export interface StageFit {
  readonly enabled: boolean;
  readonly box: Box;
  readonly orientation: Orientation;
  // Free CSS px under the stage box (portrait), where the touch pad sits.
  readonly below: number;
  refresh(): void;
}

// Android Chrome only, and only in fullscreen; iOS has no lock. Never throws.
export function lockLandscape(on: boolean): void {
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (t: string) => Promise<void> };
    if (on) void o.lock?.('landscape')?.catch(() => {});
    else o.unlock?.();
  } catch {
    // not supported
  }
}

export function installStageFit(o: StageFitOptions): StageFit {
  const enabled = fitEnabled(location.search, matchMedia('(pointer: coarse)').matches);
  const state = { enabled, box: { x: 0, y: 0, w: innerWidth, h: innerHeight } as Box, orientation: orientationOf(innerWidth, innerHeight), below: 0, refresh: measure };
  let lastWidth = innerWidth;
  let hintDismissed = false;
  o.hint.addEventListener('click', () => {
    hintDismissed = true;
    o.hint.hidden = true;
  });

  function insets(): Insets {
    const cs = getComputedStyle(o.safe);
    return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
  }

  function measure(): void {
    if (!enabled) return;
    const vv = window.visualViewport;
    const view = vv ?? { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0 };
    const layoutHeight = document.documentElement.clientHeight || innerHeight;
    const kb = keyboardOpen(layoutHeight, view.height) || (o.keyboardFocused?.() ?? false);
    // With the keyboard up the home-bar inset is under it: use the whole rest.
    const ins = insets();
    const area = usableArea(view, kb ? { ...ins, bottom: 0 } : ins);
    // Rotation: the width changes; keyboard height changes do not count.
    state.orientation = nextOrientation(state.orientation, lastWidth, view.width, view.height, kb);
    lastWidth = view.width;
    // Portrait: a 4:3 stage fitted to the width; landscape: 4:3 .. 16:9.
    const box = snapBox(state.orientation === 'portrait' ? fitStage(area, 4 / 3, 4 / 3) : fitStage(area));
    state.box = box;
    state.below = kb ? 0 : padBelow(state.orientation, area, box);
    for (const c of o.canvases) {
      Object.assign(c.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    }
    // The hint sits in the free space under the stage; the pad is there too,
    // so it goes above the pad.
    o.hint.hidden = hintDismissed || kb || state.orientation !== 'portrait';
    o.hint.style.top = `${box.y + box.h + 6}px`;
    o.hint.style.bottom = 'auto';
    o.onBox?.(box, state.orientation);
    window.dispatchEvent(new Event('psobb:fit'));
  }

  // Measure now, on the next two frames and after 200 ms (iOS reports the old
  // size right after a rotation).
  let timer = 0;
  function settle(): void {
    measure();
    requestAnimationFrame(() => requestAnimationFrame(measure));
    clearTimeout(timer);
    timer = window.setTimeout(measure, 200);
  }

  if (enabled) {
    window.addEventListener('resize', settle);
    window.addEventListener('orientationchange', settle);
    screen.orientation?.addEventListener?.('change', settle);
    matchMedia('(orientation: portrait)').addEventListener('change', settle);
    window.visualViewport?.addEventListener('resize', settle);
    window.visualViewport?.addEventListener('scroll', measure);
    measure();
  }
  return {
    enabled,
    get box() {
      return state.box;
    },
    get orientation() {
      return state.orientation;
    },
    get below() {
      return state.below;
    },
    refresh: settle,
  };
}

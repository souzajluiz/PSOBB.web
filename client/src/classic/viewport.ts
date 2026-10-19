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

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface StageFitOptions {
  canvases: HTMLElement[];
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
  // Removes the window listeners and the pending settle timer.
  dispose(): void;
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

  function measure(): void {
    if (!enabled) return;
    const vv = window.visualViewport;
    const view = vv ?? { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0 };
    const layoutHeight = document.documentElement.clientHeight || innerHeight;
    const kb = keyboardOpen(layoutHeight, view.height) || (o.keyboardFocused?.() ?? false);
    const area = usableArea(view, NO_INSETS);
    // Rotation: the width changes; keyboard height changes do not count.
    state.orientation = nextOrientation(state.orientation, lastWidth, view.width, view.height, kb);
    lastWidth = view.width;
    // Landscape: the whole screen, edge to edge (notch and home bar included;
    // the touch controls keep their own insets, ui/webcontrols.ts). Portrait: a
    // 4:3 stage fitted to the width, with the touch pad under it. The HUD is
    // drawn at the uniform scale of the height (render/fieldhud.ts), so it
    // needs at least 4:3 or its right side falls off the screen.
    const box = snapBox(state.orientation === 'portrait' ? fitStage(area, 4 / 3, 4 / 3) : area);
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

  const portraitQuery = matchMedia('(orientation: portrait)');
  if (enabled) {
    window.addEventListener('resize', settle);
    window.addEventListener('orientationchange', settle);
    screen.orientation?.addEventListener?.('change', settle);
    portraitQuery.addEventListener('change', settle);
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
    dispose() {
      clearTimeout(timer);
      window.removeEventListener('resize', settle);
      window.removeEventListener('orientationchange', settle);
      screen.orientation?.removeEventListener?.('change', settle);
      portraitQuery.removeEventListener('change', settle);
      window.visualViewport?.removeEventListener('resize', settle);
      window.visualViewport?.removeEventListener('scroll', measure);
    },
  };
}

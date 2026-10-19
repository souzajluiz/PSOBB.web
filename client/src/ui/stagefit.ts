// How the classic page's canvases are fitted to the screen (browser side, not
// in PsoBB.exe). On a desktop window the 640x480 virtual screen is stretched
// over the whole window, as the exe does (classic/stage.ts). A phone is far
// from any desktop aspect (390x844 portrait, 844x390 or wider landscape), so
// there the stage is a box of a clamped aspect ratio, centred in the usable
// area with black bars around it: nothing is cropped, nothing is stretched
// beyond a 16:9 screen, and the game's virtual coordinates are untouched.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const MIN_ASPECT = 4 / 3; // a portrait phone: the stage fills the width
export const MAX_ASPECT = 16 / 9; // a wide landscape phone: bars left and right

// Usable area: the visual viewport (it shrinks when the on-screen keyboard is
// up, and follows the URL bar, unlike 100vh) minus the safe-area insets.
export function usableArea(view: { width: number; height: number; offsetLeft?: number; offsetTop?: number }, insets: Insets): Box {
  const x = (view.offsetLeft ?? 0) + insets.left;
  const y = (view.offsetTop ?? 0) + insets.top;
  return { x, y, w: Math.max(1, view.width - insets.left - insets.right), h: Math.max(1, view.height - insets.top - insets.bottom) };
}

// The largest box with the area's aspect ratio clamped to [min, max], centred
// (vertically too: bars above and below in portrait).
export function fitStage(area: Box, min = MIN_ASPECT, max = MAX_ASPECT): Box {
  const aspect = Math.min(max, Math.max(min, area.w / area.h));
  const w = Math.min(area.w, area.h * aspect);
  const h = w / aspect;
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

// Whole CSS pixels: a canvas box on a half pixel is blurred by the compositor.
export function snapBox(b: Box): Box {
  const x = Math.round(b.x);
  const y = Math.round(b.y);
  return { x, y, w: Math.round(b.x + b.w) - x, h: Math.round(b.y + b.h) - y };
}

// The on-screen keyboard is up when the visual viewport lost a good part of
// the layout viewport's height (an address bar collapsing is only ~10 %).
export function keyboardOpen(layoutHeight: number, visualHeight: number): boolean {
  return visualHeight < layoutHeight * 0.8;
}

// A portrait screen: the stage is small there, so a hint suggests rotating.
export function isPortrait(area: Box): boolean {
  return area.h > area.w * 1.1;
}

export type Orientation = 'portrait' | 'landscape';

export function orientationOf(w: number, h: number): Orientation {
  return h > w ? 'portrait' : 'landscape';
}

// The orientation after a measurement. The on-screen keyboard shrinks the
// viewport's height without any rotation (in landscape it can leave a short
// strip, in portrait on Android it can make the viewport wider than tall):
// while it is up and the width is unchanged, the orientation stays. A rotation
// always changes the width.
export function nextOrientation(prev: Orientation, prevWidth: number, w: number, h: number, keyboard: boolean): Orientation {
  if (keyboard && Math.abs(w - prevWidth) < 1) return prev;
  return orientationOf(w, h);
}

// Free height under the stage box in portrait, where the touch pad sits (the
// bars are otherwise empty); 0 in landscape, where the pad is over the stage.
export function padBelow(orientation: Orientation, area: Box, box: Box): number {
  return orientation === 'portrait' ? Math.max(0, area.y + area.h - (box.y + box.h)) : 0;
}

// 'auto' follows the pointer type (a phone or tablet); ?fit=1 / ?fit=0 force it.
export function fitEnabled(search: string, coarsePointer: boolean): boolean {
  const v = new URLSearchParams(search).get('fit');
  if (v === '1') return true;
  if (v === '0') return false;
  return coarsePointer;
}

declare global {
  interface WindowEventMap {
    // The canvases moved or resized (installStageFit); the touch overlay re-lays out.
    'psobb:fit': Event;
  }
}

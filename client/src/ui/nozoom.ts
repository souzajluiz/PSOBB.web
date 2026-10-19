// No pinch zoom and no double-tap zoom on the game page (a browser convenience,
// not in PsoBB.exe). The page's viewport meta says user-scalable=no and the CSS
// sets touch-action: none, but iOS Safari ignores both for pinch, so its gesture
// events are cancelled here as well. Two-finger touches stay: the camera drag of
// the touch pad uses them, and they are plain touch events, not gesture events.

export function installNoZoom(): void {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend'] as const) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
}

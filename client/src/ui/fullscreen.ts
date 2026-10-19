// Fullscreen for the game view (a browser convenience, not in PsoBB.exe).
//
// Uses the Fullscreen API on the view's container (with the webkit-prefixed
// calls of older Safari / iPadOS). iPhone Safari has no element fullscreen,
// so there, or when the request is refused, the container is made to fill
// the viewport with CSS instead ("fallback"). The canvases inside resize
// through their own ResizeObservers (render/mapviewer.ts, classic/stage.ts)
// and the HUD overlays re-read the canvas box every frame.

export type FullscreenState =
  | { mode: 'off' }
  | { mode: 'pending' } // requestFullscreen() sent, no fullscreenchange yet
  | { mode: 'native' }
  | { mode: 'fallback' };

export type FullscreenEvent =
  | { type: 'toggle'; nativeAvailable: boolean }
  | { type: 'entered' } // fullscreenchange: our element is fullscreen
  | { type: 'exited' } // fullscreenchange: no fullscreen element (Esc, F11 exit, API)
  | { type: 'failed' } // requestFullscreen() rejected
  | { type: 'timeout' }; // no answer in PENDING_TIMEOUT_MS (prefixed calls return nothing)

// 'cancel' leaves a fullscreen the pending request may have reached.
export type FullscreenAction = 'request' | 'exit' | 'cancel' | 'fallbackOn' | 'fallbackOff' | null;

// How long a request may stay unanswered before the CSS fallback is used.
export const PENDING_TIMEOUT_MS = 1500;

export function fullscreenStep(state: FullscreenState, event: FullscreenEvent): { state: FullscreenState; action: FullscreenAction } {
  switch (state.mode) {
    case 'off':
      if (event.type === 'toggle') return event.nativeAvailable ? { state: { mode: 'pending' }, action: 'request' } : { state: { mode: 'fallback' }, action: 'fallbackOn' };
      if (event.type === 'entered') return { state: { mode: 'native' }, action: null };
      return { state, action: null };
    case 'pending':
      if (event.type === 'entered') return { state: { mode: 'native' }, action: null };
      if (event.type === 'failed' || event.type === 'timeout') return { state: { mode: 'fallback' }, action: 'fallbackOn' };
      if (event.type === 'exited') return { state: { mode: 'off' }, action: null };
      return { state: { mode: 'off' }, action: 'cancel' }; // toggled again before an answer
    case 'native':
      if (event.type === 'toggle') return { state, action: 'exit' }; // off on the change event
      if (event.type === 'exited') return { state: { mode: 'off' }, action: null };
      return { state, action: null };
    case 'fallback':
      if (event.type === 'toggle') return { state: { mode: 'off' }, action: 'fallbackOff' };
      if (event.type === 'entered') return { state: { mode: 'native' }, action: 'fallbackOff' };
      return { state, action: null };
  }
}

export function isFullscreen(state: FullscreenState): boolean {
  return state.mode === 'native' || state.mode === 'fallback';
}

// Prefixed members of older WebKit.
interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
}

function fullscreenElement(): Element | null {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function nativeAvailable(el: HTMLElement): boolean {
  const doc = document as WebkitDocument;
  const w = el as WebkitElement;
  return Boolean((doc.fullscreenEnabled || doc.webkitFullscreenEnabled) && (w.requestFullscreen || w.webkitRequestFullscreen));
}

export class FullscreenController {
  private state: FullscreenState = { mode: 'off' };
  private readonly el: HTMLElement;
  private readonly listeners = new Set<(on: boolean) => void>();

  private timer = 0;
  private readonly change = () => this.dispatch(fullscreenElement() === this.el ? { type: 'entered' } : { type: 'exited' });

  constructor(el: HTMLElement) {
    this.el = el;
    document.addEventListener('fullscreenchange', this.change);
    document.addEventListener('webkitfullscreenchange', this.change);
  }

  // Leaves fullscreen and removes the document listeners.
  dispose(): void {
    this.exit();
    clearTimeout(this.timer);
    document.removeEventListener('fullscreenchange', this.change);
    document.removeEventListener('webkitfullscreenchange', this.change);
    this.listeners.clear();
  }

  get active(): boolean {
    return isFullscreen(this.state);
  }

  get mode(): FullscreenState['mode'] {
    return this.state.mode;
  }

  // Must run inside a user gesture (click, touch, keydown).
  toggle(): void {
    this.dispatch({ type: 'toggle', nativeAvailable: nativeAvailable(this.el) });
  }

  // Leaves fullscreen of either kind (e.g. to reach the page's chat field).
  exit(): void {
    if (this.active) this.toggle();
  }

  onChange(fn: (on: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private dispatch(event: FullscreenEvent): void {
    const was = this.active;
    const { state, action } = fullscreenStep(this.state, event);
    this.state = state;
    if (state.mode !== 'pending') clearTimeout(this.timer);
    this.run(action);
    this.el.classList.toggle('is-fullscreen', this.active);
    if (this.active !== was) for (const fn of this.listeners) fn(this.active);
  }

  private run(action: FullscreenAction): void {
    const el = this.el as WebkitElement;
    const doc = document as WebkitDocument;
    switch (action) {
      case 'request': {
        const fail = () => this.dispatch({ type: 'failed' });
        // Neither a change event nor a rejection (webkitRequestFullscreen
        // returns nothing and may refuse silently): fall back after a while.
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.dispatch({ type: 'timeout' }), PENDING_TIMEOUT_MS);
        try {
          const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
          if (p instanceof Promise) p.catch(fail);
        } catch {
          fail();
        }
        break;
      }
      case 'exit': {
        const p = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
        if (p instanceof Promise) p.catch(() => this.dispatch({ type: 'exited' }));
        break;
      }
      case 'cancel':
        if (fullscreenElement() === this.el) {
          const p = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
          if (p instanceof Promise) p.catch(() => {});
        }
        break;
      case 'fallbackOn':
        this.el.classList.add('is-fill-viewport');
        document.documentElement.classList.add('has-fill-viewport');
        break;
      case 'fallbackOff':
        this.el.classList.remove('is-fill-viewport');
        document.documentElement.classList.remove('has-fill-viewport');
        break;
      case null:
        break;
    }
  }
}

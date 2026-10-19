// On-screen keyboard for the canvas screens' text editors (browser side, not
// in PsoBB.exe). The classic screens draw their inline editors on the canvas
// and read KeyboardEvents, so a phone has nothing to type into. While an
// editor is active (Screen.textInput) a real, hidden <input> takes focus: the
// OS keyboard opens, and what it types is forwarded to the canvas as the same
// key events (input/textproxy.ts). Two fields, one plain and one
// type=password, so the keyboard matches the row without changing a focused
// field's type (iOS closes the keyboard for that).
//
// iOS only opens the keyboard from a focus() call made inside a user gesture,
// so main.ts calls sync() from the tap / key handlers that start an editor.
// When the OS dismisses the keyboard while the editor is still open, a small
// key button appears; a tap on it (or anywhere on the canvas) opens it again.
// Desktop is left alone: nothing is focused unless a touch was seen.

import { ESCAPE_KEY, TextProxy, inputTypeKey } from '../input/textproxy.ts';
import { DOM_KEYS, type ProxyKey } from '../input/virtualpad.ts';
import './softkeyboard.css';

export interface TextInputRequest {
  password: boolean;
  chat?: boolean;
}

export interface SoftKeyboardOptions {
  parent: HTMLElement;
  // The element that reads the keys (the game canvas).
  canvas: HTMLElement;
  // The active editor, or null.
  editing: () => TextInputRequest | null;
  // Delivers one key to the canvas.
  send: (k: ProxyKey) => void;
}

export class SoftKeyboard {
  private readonly o: SoftKeyboardOptions;
  private readonly proxy = new TextProxy();
  private readonly fields: { text: HTMLInputElement; password: HTMLInputElement };
  private readonly button: HTMLButtonElement;
  private active: HTMLInputElement | null = null;
  private touch: boolean;

  constructor(o: SoftKeyboardOptions) {
    this.o = o;
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.fields = { text: this.makeField('text'), password: this.makeField('password') };
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'sk-button';
    this.button.hidden = true;
    this.button.setAttribute('aria-label', 'Open the on-screen keyboard');
    this.button.textContent = '⌨';
    this.button.addEventListener('click', () => this.sync(true));
    // A tap on the canvas must not blur the field (the keyboard would close and reopen).
    o.canvas.addEventListener('pointerdown', (e) => {
      if (this.active) e.preventDefault();
    });
    o.parent.append(this.fields.text, this.fields.password, this.button);
    // A touch makes this a touch device even where detection said no.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') this.touch = true;
      },
      true,
    );
  }

  private makeField(type: 'text' | 'password'): HTMLInputElement {
    const f = document.createElement('input');
    f.type = type;
    f.className = 'sk-field';
    f.value = this.proxy.initial;
    f.setAttribute('aria-label', 'On-screen keyboard input');
    f.setAttribute('inputmode', 'text');
    f.setAttribute('autocapitalize', 'off');
    f.setAttribute('autocorrect', 'off');
    f.setAttribute('autocomplete', type === 'password' ? 'new-password' : 'off');
    f.setAttribute('spellcheck', 'false');
    f.tabIndex = -1;
    f.addEventListener('input', (e) => this.onInput(f, (e as InputEvent).isComposing));
    f.addEventListener('compositionend', () => this.flush(f, this.proxy.compositionEnd(f.value)));
    f.addEventListener('beforeinput', (e) => {
      const k = inputTypeKey((e as InputEvent).inputType);
      if (!k) return;
      e.preventDefault();
      this.o.send(k);
      this.sync();
    });
    f.addEventListener('keydown', (e) => {
      // Text comes from the input events: Android reports key 'Unidentified'
      // here. Enter and Escape (a hardware keyboard, iOS) are forwarded.
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        this.o.send(e.key === 'Enter' ? DOM_KEYS.enter : ESCAPE_KEY);
        this.sync();
      }
    });
    f.addEventListener('keyup', (e) => e.stopPropagation());
    f.addEventListener('blur', () => {
      if (this.active !== f) return;
      // Dismissed by the OS (or a tap elsewhere) while an editor is open: keep
      // the screen working and offer the key button.
      this.active = null;
      this.updateButton();
    });
    return f;
  }

  private onInput(f: HTMLInputElement, composing: boolean): void {
    this.flush(f, this.proxy.input(f.value, composing));
  }

  private flush(f: HTMLInputElement, r: { keys: ProxyKey[]; reset: boolean }): void {
    for (const k of r.keys) this.o.send(k);
    if (r.reset) this.resetField(f);
    this.sync();
  }

  private resetField(f: HTMLInputElement): void {
    this.proxy.reset();
    f.value = this.proxy.initial;
    f.setSelectionRange(f.value.length, f.value.length);
  }

  // Call from a user gesture (tap, pointerup, key press) and after every key the
  // fields forward: opens the keyboard when an editor became active, closes it
  // when the editor ended. `force`: a tap on the key button (always opens).
  sync(force = false): void {
    const want = this.o.editing();
    if (!want) {
      if (this.active) {
        const a = this.active;
        this.active = null;
        a.blur();
        this.o.canvas.focus({ preventScroll: true });
      }
      this.button.hidden = true;
      return;
    }
    if (!force && !this.touch) return; // desktop: the physical keyboard
    const f = want.password ? this.fields.password : this.fields.text;
    if (this.active === f && document.activeElement === f) return;
    if (this.active) this.active.blur();
    f.enterKeyHint = want.chat ? 'send' : 'done';
    this.resetField(f);
    this.active = f;
    f.focus({ preventScroll: true });
    // iOS pans the page to a focused field; the stage is fixed to the top.
    window.scrollTo(0, 0);
    this.updateButton();
  }

  // Frame tick (not a gesture): shows the key button while an editor is open
  // and the field has no focus.
  update(): void {
    this.updateButton();
    if (!this.o.editing() && this.active) this.sync();
  }

  // A field has focus (the keyboard is up).
  get focused(): boolean {
    return this.active !== null && document.activeElement === this.active;
  }

  private updateButton(): void {
    const editing = !!this.o.editing();
    this.button.hidden = !(editing && this.touch && document.activeElement !== this.active);
  }

  // The key button sits in the corner of the stage box.
  placeButton(box: { x: number; y: number; w: number; h: number }): void {
    for (const f of [this.fields.text, this.fields.password]) Object.assign(f.style, { left: `${box.x}px`, top: `${box.y}px` });
    Object.assign(this.button.style, { left: `${box.x + box.w - 8}px`, top: `${box.y + 8}px` });
  }
}

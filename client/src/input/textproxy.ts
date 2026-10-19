// Text typed into the hidden <input> that brings up the on-screen keyboard
// (ui/softkeyboard.ts), turned into the key events the canvas screens read.
// Pure logic, no DOM: the field is read through its value and input events,
// never through keydown, because Android keyboards report key 'Unidentified'
// (keyCode 229) for everything they type.
//
// The field holds one sentinel character, then the text typed since the last
// reset. Each input event is compared with the text already forwarded:
// removed characters become Backspace, new ones become key presses. This
// also follows IME composition (Gboard composes whole words, autocorrect
// rewrites the word under the caret): the diff is sent while composing, so
// typing is live and a corrected word is replaced in place.

import { DOM_KEYS, PROXY_SENTINEL, type ProxyKey } from './virtualpad.ts';

export const ESCAPE_KEY: ProxyKey = { key: 'Escape', code: 'Escape' };

export function charKey(ch: string): ProxyKey {
  return { key: ch, code: '' };
}

// Keys that turn `prev` into `next`: Backspace for each character after the
// common prefix, then the rest of `next` typed. Whole code points, so an emoji
// is one key (the screens drop what they cannot show).
export function diffKeys(prev: string, next: string): ProxyKey[] {
  const a = [...prev];
  const b = [...next];
  let c = 0;
  while (c < a.length && c < b.length && a[c] === b[c]) c++;
  const out: ProxyKey[] = [];
  for (let i = c; i < a.length; i++) out.push(DOM_KEYS.backspace);
  for (let i = c; i < b.length; i++) out.push(b[i] === '\n' ? DOM_KEYS.enter : charKey(b[i]));
  return out;
}

// beforeinput's inputType for the Enter key of a keyboard that sent no usable
// keydown (key 'Unidentified'); null for the other types.
export function inputTypeKey(inputType: string): ProxyKey | null {
  if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') return DOM_KEYS.enter;
  return null;
}

export class TextProxy {
  private sent = '';

  // The value the field is reset to (caret at its end).
  get initial(): string {
    return PROXY_SENTINEL;
  }

  // Text of the field after the sentinel, or null when the sentinel is gone
  // (Backspace on the empty field).
  static textOf(value: string): string | null {
    return value.startsWith(PROXY_SENTINEL) ? value.slice(PROXY_SENTINEL.length) : null;
  }

  // An input event: the keys to send, and whether the field must be reset to
  // `initial` (only when not composing: resetting would cancel the IME).
  input(value: string, composing: boolean): { keys: ProxyKey[]; reset: boolean } {
    const text = TextProxy.textOf(value);
    if (text === null) {
      if (composing) {
        const keys = diffKeys(this.sent, value);
        this.sent = value;
        return { keys, reset: false };
      }
      // Backspace on the empty field (the sentinel went).
      this.sent = '';
      return { keys: [DOM_KEYS.backspace], reset: true };
    }
    const keys = diffKeys(this.sent, text);
    if (composing) {
      this.sent = text;
      return { keys, reset: false };
    }
    this.sent = '';
    return { keys, reset: true };
  }

  // compositionend: the final text of the composition is sent and the field reset.
  compositionEnd(value: string): { keys: ProxyKey[]; reset: boolean } {
    return this.input(value, false);
  }

  reset(): void {
    this.sent = '';
  }
}

// The character name entry on a phone (browser side, not in PsoBB.exe). The
// canvas name editor takes its keys from the window; on a phone (fit mode,
// classic/viewport.ts) the name is typed into an HTML field instead, over the
// creation screen, with the same styles as the login form (loginform.css). Its
// result goes to the same NameEditor as the canvas one (submitForm / cancelForm
// in charcreate.ts), so the dressing room takes it as it takes the canvas's.
//
// The form sits in the visual viewport, so the on-screen keyboard does not hide
// it: it is placed by visualViewport's offset and height.

import './loginform.css';

export interface NameFormHandlers {
  submit(name: string): void;
  cancel(): void;
}

export interface NameFormOptions {
  parent: HTMLElement;
  // Gets the focus back on close (the game canvas reads the keys).
  returnFocus: HTMLElement;
  // The name's maximum length (the canvas editor's NAME_MAX).
  maxLength: number;
}

// The canvas editor's rule (charcreate.ts nameValid): a non-blank character.
const hasName = (s: string) => /[^\s　]/.test(s);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  e.textContent = text;
  return e;
}

export class NameForm {
  private readonly root = el('div', 'lf-root');
  private readonly form = el('form', 'lf-panel');
  private readonly heading = el('h2', 'lf-title', 'Name');
  private readonly input = el('input', '');
  private readonly ok = el('button', 'lf-ok', 'OK');
  private readonly cancelButton = el('button', 'lf-cancel', 'Cancel');
  private readonly returnFocus: HTMLElement;
  private handlers: NameFormHandlers | null = null;

  constructor(o: NameFormOptions) {
    this.returnFocus = o.returnFocus;
    this.input.type = 'text';
    this.input.name = 'name';
    this.input.maxLength = o.maxLength;
    this.input.autocomplete = 'off';
    this.input.enterKeyHint = 'done';
    this.input.setAttribute('autocapitalize', 'off');
    this.input.setAttribute('autocorrect', 'off');
    this.input.spellcheck = false;
    this.ok.type = 'submit';
    this.cancelButton.type = 'button';
    const row = el('label', 'lf-row');
    row.append(el('span', 'lf-label', 'Name'), this.input);
    const buttons = el('div', 'lf-buttons');
    buttons.append(this.cancelButton, this.ok);
    this.form.append(this.heading, row, buttons);
    this.root.append(this.form);
    this.root.hidden = true;
    o.parent.append(this.root);

    this.input.addEventListener('input', () => this.refresh());
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.handlers) return;
      if (!hasName(this.input.value)) {
        this.input.focus();
        return;
      }
      const h = this.handlers;
      const name = this.input.value;
      this.close();
      h.submit(name);
    });
    this.cancelButton.addEventListener('click', () => {
      const h = this.handlers;
      this.close();
      h?.cancel();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  // Shows the form with the current name (the canvas editor starts from it).
  open(name: string, handlers: NameFormHandlers): void {
    this.handlers = handlers;
    this.input.value = name;
    this.refresh();
    this.place();
    this.root.hidden = false;
    window.addEventListener('resize', this.place);
    window.visualViewport?.addEventListener('resize', this.place);
    window.visualViewport?.addEventListener('scroll', this.place);
  }

  // Hides the form and gives the focus back to the canvas (idempotent).
  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.handlers = null;
    window.removeEventListener('resize', this.place);
    window.visualViewport?.removeEventListener('resize', this.place);
    window.visualViewport?.removeEventListener('scroll', this.place);
    if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
    this.returnFocus.focus({ preventScroll: true });
  }

  // Confirm looks greyed until the name holds a character (the canvas rule).
  private refresh(): void {
    this.ok.classList.toggle('lf-off', !hasName(this.input.value));
  }

  private readonly place = (): void => {
    const vv = window.visualViewport;
    Object.assign(this.root.style, { top: `${vv?.offsetTop ?? 0}px`, height: `${vv?.height ?? innerHeight}px` });
  };
}

// The "Input UserID" window on a phone (browser side, not in PsoBB.exe). A
// canvas text editor is small and its keyboard is awkward on a touch screen, so
// on a phone (fit mode, classic/viewport.ts) the title shows this HTML form over
// the title backdrop instead of the canvas window. It hands back the same result
// as the canvas window's Confirm / Cancel (InputUserIdWindow.submitForm /
// cancelForm in titleflow.ts), so the Login menu and the login after it are
// unchanged. Desktop keeps the canvas window.
//
// The form sits in the visual viewport, so the on-screen keyboard does not hide
// it: it is placed by visualViewport's offset and height, and scrolls inside it.

import { editedUser, type MenuText } from './titleflow.ts';
import './loginform.css';

export interface LoginFormHandlers {
  submit(user: string, password: string): void;
  cancel(): void;
}

export interface LoginFormOptions {
  parent: HTMLElement;
  // Gets the focus back on close (the game canvas reads the keys).
  returnFocus: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  e.textContent = text;
  return e;
}

export class LoginForm {
  private readonly root = el('div', 'lf-root');
  private readonly form = el('form', 'lf-panel');
  private readonly heading = el('h2', 'lf-title');
  private readonly userLabel = el('span', 'lf-label');
  private readonly passwordLabel = el('span', 'lf-label');
  private readonly user = el('input', '');
  private readonly password = el('input', '');
  private readonly ok = el('button', 'lf-ok');
  private readonly cancelButton = el('button', 'lf-cancel');
  private readonly returnFocus: HTMLElement;
  private handlers: LoginFormHandlers | null = null;

  constructor(o: LoginFormOptions) {
    this.returnFocus = o.returnFocus;
    this.user.type = 'text';
    this.user.name = 'userid';
    this.user.maxLength = 16;
    this.user.autocomplete = 'username';
    this.user.enterKeyHint = 'next';
    this.password.type = 'password';
    this.password.name = 'password';
    this.password.maxLength = 16;
    this.password.autocomplete = 'current-password';
    this.password.enterKeyHint = 'go';
    for (const i of [this.user, this.password]) {
      i.setAttribute('autocapitalize', 'off');
      i.setAttribute('autocorrect', 'off');
      i.spellcheck = false;
    }
    this.ok.type = 'submit';
    this.cancelButton.type = 'button';
    const userRow = el('label', 'lf-row');
    userRow.append(this.userLabel, this.user);
    const passwordRow = el('label', 'lf-row');
    passwordRow.append(this.passwordLabel, this.password);
    const buttons = el('div', 'lf-buttons');
    buttons.append(this.cancelButton, this.ok);
    this.form.append(this.heading, userRow, passwordRow, buttons);
    this.root.append(this.form);
    this.root.hidden = true;
    o.parent.append(this.root);

    // Enter in the UserID field moves on to the password; Enter in the password
    // field submits (the form's submit event).
    this.user.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      this.password.focus();
    });
    this.user.addEventListener('input', () => this.refresh());
    this.password.addEventListener('input', () => this.refresh());
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.handlers) return;
      if (!this.valid()) {
        (editedUser(this.user.value) === '' ? this.user : this.password).focus();
        return;
      }
      const h = this.handlers;
      const user = this.user.value;
      const password = this.password.value;
      this.close();
      h.submit(user, password);
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

  // Shows the form with the window's texts and user name; the password starts
  // empty (as the canvas window's does).
  open(text: MenuText['input'], user: string, handlers: LoginFormHandlers): void {
    this.handlers = handlers;
    this.heading.textContent = text.title;
    this.userLabel.textContent = text.user;
    this.passwordLabel.textContent = text.password;
    this.ok.textContent = text.confirm;
    this.cancelButton.textContent = text.cancel;
    this.user.value = user;
    this.password.value = '';
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

  private valid(): boolean {
    return editedUser(this.user.value) !== '' && this.password.value !== '';
  }

  // Confirm looks greyed until both fields hold something (the canvas rule).
  private refresh(): void {
    this.ok.classList.toggle('lf-off', !this.valid());
  }

  // The visual viewport: the form stays on the part of the screen that is
  // visible while the on-screen keyboard is up.
  private readonly place = (): void => {
    const vv = window.visualViewport;
    Object.assign(this.root.style, { top: `${vv?.offsetTop ?? 0}px`, height: `${vv?.height ?? innerHeight}px` });
  };
}

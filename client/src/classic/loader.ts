// The loader of classic.html (#boot): plain HTML / CSS that is on screen from
// the first paint, updated here from LoadProgress while the game loads and
// faded out once the title screen is drawn. Also the folder-picker prompt
// (showDirectoryPicker needs a user gesture, so it waits for a tap) and the
// error view with a Retry button. Browser side, not in PsoBB.exe.

import { LoadProgress, describeLoadError } from './loadprogress.ts';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Loader {
  readonly progress = new LoadProgress();
  private readonly boot = el<HTMLDivElement>('boot');
  private readonly text = el<HTMLSpanElement>('boot-text');
  private readonly fill = el<HTMLDivElement>('boot-fill');
  private readonly detail = el<HTMLDivElement>('boot-detail');
  private readonly pick = el<HTMLDivElement>('boot-pick');
  private readonly error = el<HTMLDivElement>('boot-error');
  private done = false;
  private raf = 0;

  constructor() {
    el<HTMLButtonElement>('boot-retry').onclick = () => location.reload();
    this.render();
  }

  step(id: string): void {
    this.progress.begin(id);
    this.schedule();
  }

  bytes(loaded: number, total: number): void {
    this.progress.bytes(loaded, total);
    this.schedule();
  }

  // Updates are drawn once a frame, however many chunks arrive.
  private schedule(): void {
    if (this.raf || this.done) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render(): void {
    if (this.boot.classList.contains('is-error')) return;
    const s = this.progress.status();
    const { n, of } = this.progress.stepNumber;
    this.text.textContent = `${s.label}.. (${n}/${of})`;
    this.detail.textContent = s.detail;
    this.fill.style.width = `${s.percent.toFixed(1)}%`;
    this.boot.classList.toggle('is-indeterminate', s.indeterminate);
  }

  // The folder picker prompt; resolves on the tap (the picker is opened by the
  // caller from that gesture).
  askFolder(): Promise<void> {
    this.pick.hidden = false;
    this.text.textContent = 'Game data not found on this server';
    this.boot.classList.remove('is-indeterminate');
    const button = el<HTMLButtonElement>('boot-pick-button');
    return new Promise((resolve) =>
      button.addEventListener(
        'click',
        () => {
          this.pick.hidden = true;
          resolve();
        },
        { once: true },
      ),
    );
  }

  fail(e: unknown): void {
    if (this.done) return;
    this.boot.hidden = false;
    this.boot.classList.remove('is-done', 'is-indeterminate');
    this.boot.classList.add('is-error');
    this.pick.hidden = true;
    this.text.textContent = 'The game could not start';
    el<HTMLParagraphElement>('boot-msg').textContent = describeLoadError(e);
    this.error.hidden = false;
  }

  // The title screen is drawn: the bar fills, then a short fade.
  finish(): void {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    this.progress.finish();
    this.pick.hidden = true;
    this.boot.classList.remove('is-error', 'is-indeterminate');
    this.text.textContent = 'Ready';
    this.fill.style.width = '100%';
    this.boot.classList.add('is-done');
    const hide = () => (this.boot.hidden = true);
    this.boot.addEventListener('transitionend', hide, { once: true });
    setTimeout(hide, 700); // no transition events with reduced motion or a hidden tab
  }
}

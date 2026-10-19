// Progress of the classic page's start-up (browser side, not in PsoBB.exe):
// the steps main.ts runs before the title screen is drawn, with weights for
// the bar. The data.gsl download is by far the longest step, so its bytes move
// the bar inside its share. Pure logic; classic/loader.ts shows it.

export interface LoadStep {
  id: string;
  label: string; // status line
  weight: number;
}

export const LOAD_STEPS: readonly LoadStep[] = [
  { id: 'source', label: 'Looking for the game data', weight: 2 },
  { id: 'archive', label: 'Downloading the game archive', weight: 70 },
  { id: 'title', label: 'Unpacking the title screen', weight: 14 },
  { id: 'text', label: 'Reading the menu texts', weight: 8 },
  { id: 'open', label: 'Opening the game', weight: 6 },
];

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 100 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface LoadStatus {
  label: string;
  detail: string; // "12.3 MB of 180 MB", or ""
  percent: number; // 0..100, never goes back
  // true while the step has no measurable part (the bar then pulses).
  indeterminate: boolean;
}

export class LoadProgress {
  private index = -1;
  private within = 0; // 0..1 of the current step; NaN: unknown
  private loaded = 0;
  private total = 0;
  private best = 0;
  private finished = false;
  private readonly steps: readonly LoadStep[];

  constructor(steps: readonly LoadStep[] = LOAD_STEPS) {
    this.steps = steps;
  }

  // Starts a step by id; the earlier ones count as done. An unknown id is ignored.
  begin(id: string): void {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i < 0 || i < this.index) return;
    this.index = i;
    this.within = Number.NaN;
    this.loaded = this.total = 0;
  }

  // Bytes of the current step (total 0 / unknown: only the counter moves).
  bytes(loaded: number, total: number): void {
    this.loaded = loaded;
    this.total = total;
    this.within = total > 0 ? Math.min(1, Math.max(0, loaded / total)) : Number.NaN;
  }

  finish(): void {
    this.finished = true;
    this.index = this.steps.length - 1;
    this.within = 1;
  }

  status(): LoadStatus {
    if (this.finished) return { label: 'Ready', detail: '', percent: 100, indeterminate: false };
    const sum = this.steps.reduce((a, s) => a + s.weight, 0);
    const done = this.steps.slice(0, Math.max(0, this.index)).reduce((a, s) => a + s.weight, 0);
    const cur = this.steps[this.index];
    const part = cur && Number.isFinite(this.within) ? cur.weight * this.within : 0;
    // The bar never moves back (a second download may restart the byte count).
    this.best = Math.max(this.best, Math.min(100, ((done + part) / sum) * 100));
    return {
      label: cur ? cur.label : 'Starting',
      detail: this.total > 0 ? `${formatBytes(this.loaded)} of ${formatBytes(this.total)}` : this.loaded > 0 ? formatBytes(this.loaded) : '',
      percent: this.best,
      indeterminate: !cur || !Number.isFinite(this.within),
    };
  }

  get stepNumber(): { n: number; of: number } {
    return { n: Math.max(0, this.index) + 1, of: this.steps.length };
  }
}

// A short message for a failure the user can act on.
export function describeLoadError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return `The game data could not be downloaded (${m}). Check your connection.`;
  return m;
}

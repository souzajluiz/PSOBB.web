// Quest editor: small DOM helpers shared by the panels.

type Child = Node | string | null | false | undefined;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'style') el.style.cssText = String(v);
    else if (k in el && k !== 'list') (el as unknown as Props)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

// Sets an input's value unless the user is typing in it.
export function setValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  if (document.activeElement === input && input.type !== 'checkbox') return;
  if (input.value !== value) input.value = value;
}

export const hex = (n: number, width = 4): string => n.toString(16).toUpperCase().padStart(width, '0');

// A number format that keeps float noise out of the fields (3 decimals, trimmed).
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

export interface Field {
  el: HTMLElement;
  refresh(): void;
}

export interface NumberOptions {
  step?: number;
  min?: number;
  max?: number;
  hex?: boolean;
  width?: number;
}

// A labelled number input. `get` reads the current value; `set` commits a new one
// (called on every input event with a valid number), `done` ends the edit
// (change event: the history seals the run so the next edit is a new undo step).
export function numberField(label: string, get: () => number, set: (v: number) => void, done: () => void, opts: NumberOptions = {}): Field {
  const input = h('input', {
    type: opts.hex ? 'text' : 'number',
    step: opts.step ?? 1,
    min: opts.min,
    max: opts.max,
    inputMode: opts.hex ? 'text' : 'decimal',
    spellcheck: false,
  });
  const parse = (): number | null => {
    const raw = input.value.trim();
    if (!raw) return null;
    const v = opts.hex ? parseInt(raw.replace(/^0x/i, ''), 16) : Number(raw);
    if (!Number.isFinite(v)) return null;
    if (opts.min !== undefined && v < opts.min) return null;
    if (opts.max !== undefined && v > opts.max) return null;
    return v;
  };
  input.addEventListener('input', () => {
    const v = parse();
    if (v !== null) set(v);
  });
  input.addEventListener('change', () => {
    done();
    input.value = show(get());
  });
  const show = (v: number) => (opts.hex ? hex(v) : fmt(v));
  const el = h('label', { class: 'qe-field' }, h('span', { text: label }), input);
  return { el, refresh: () => setValue(input, show(get())) };
}

export function textField(label: string, get: () => string, set: (v: string) => void, done: () => void, opts: { multiline?: boolean; maxLength?: number } = {}): Field {
  const input = opts.multiline ? h('textarea', { rows: 3, maxLength: opts.maxLength }) : h('input', { type: 'text', maxLength: opts.maxLength });
  input.addEventListener('input', () => set(input.value));
  input.addEventListener('change', done);
  const el = h('label', { class: 'qe-field' }, h('span', { text: label }), input);
  return { el, refresh: () => setValue(input, get()) };
}

export function selectField<T extends string | number>(label: string, options: ReadonlyArray<readonly [T, string]>, get: () => T, set: (v: T) => void): Field {
  const sel = h('select', null, ...options.map(([v, text]) => h('option', { value: String(v), text })));
  sel.addEventListener('change', () => {
    const raw = sel.value;
    const match = options.find(([v]) => String(v) === raw);
    if (match) set(match[0]);
  });
  const el = h('label', { class: 'qe-field' }, h('span', { text: label }), sel);
  return {
    el,
    refresh: () => {
      const cur = String(get());
      if (![...sel.options].some((o) => o.value === cur)) sel.append(h('option', { value: cur, text: `${cur} (unknown)` }));
      sel.value = cur;
    },
  };
}

export function button(text: string, onClick: (e: MouseEvent) => void, cls = '', title = ''): HTMLButtonElement {
  return h('button', { type: 'button', class: cls, text, title, onClick });
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'qe-section' }, h('h3', { text: title }), ...children);
}

// Downloads bytes as a file.
export function download(name: string, bytes: Uint8Array | string, type = 'application/octet-stream'): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

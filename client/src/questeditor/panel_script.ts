// Quest editor: the script as text. The disassembly of the .bin is shown in an
// editor with line numbers and label navigation; "Apply" assembles the text and
// replaces the quest's script (one undo step). Assembler errors are listed with
// their line and the editor jumps to it.

import type { QuestBin } from '../formats/questbin.ts';
import { editableHeaderOf, type EditableHeader } from './binhead.ts';
import { button, h } from './dom.ts';
import type { QuestDocument } from './model.ts';
import type { Panel } from './panel_props.ts';

export interface ScriptHost {
  disassemble(bin: QuestBin): string;
  assemble(text: string, header: Partial<EditableHeader>): QuestBin;
}

const LINE_HEIGHT = 18;
const LABEL_RE = /^([A-Za-z_][A-Za-z0-9_]*):/;

export interface ScriptLabel {
  name: string;
  line: number; // 0-based
}

export function findLabels(text: string): ScriptLabel[] {
  const out: ScriptLabel[] = [];
  text.split('\n').forEach((l, i) => {
    const m = LABEL_RE.exec(l);
    if (m) out.push({ name: m[1], line: i });
  });
  return out;
}

// The identifier under (or just before) a caret offset.
export function wordAt(text: string, at: number): string {
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
  let a = at;
  let b = at;
  while (a > 0 && isWord(text[a - 1])) a--;
  while (b < text.length && isWord(text[b])) b++;
  return text.slice(a, b);
}

// The line number an assembler error names ("line 12", "at line 12", "12:").
export function errorLine(message: string): number | null {
  const m = /line\s+(\d+)/i.exec(message) ?? /^(\d+):/.exec(message);
  return m ? Number(m[1]) : null;
}

export function createScriptPanel(doc: QuestDocument, host: ScriptHost): Panel {
  const area = h('textarea', { class: 'qe-script', spellcheck: false, wrap: 'off', autocapitalize: 'off', 'aria-label': 'Quest script' });
  const gutter = h('pre', { class: 'qe-gutter', 'aria-hidden': 'true' });
  const status = h('p', { class: 'qe-script-status', role: 'status' });
  const labelSel = h('select', { 'aria-label': 'Go to label' }, h('option', { value: '', text: 'Go to label...' }));
  const stale = h('p', { class: 'qe-hint', hidden: true, text: 'The quest changed (properties or undo) while this text has unapplied edits. Revert to see the current script.' });
  const errors = h('pre', { class: 'qe-error', hidden: true });
  let baseline = '';
  let lastBin: QuestBin | null = null;
  let labels: ScriptLabel[] = [];
  let errorAt = -1;
  const back: number[] = [];

  const dirty = () => area.value !== baseline;
  const updateGutter = () => {
    const n = area.value.split('\n').length;
    let s = '';
    for (let i = 1; i <= n; i++) s += `${i === errorAt ? '>' : ' '}${i}\n`;
    gutter.textContent = s;
    gutter.scrollTop = area.scrollTop;
  };
  const updateLabels = () => {
    labels = findLabels(area.value);
    labelSel.replaceChildren(h('option', { value: '', text: `Go to label... (${labels.length})` }), ...labels.map((l) => h('option', { value: String(l.line), text: `${l.name} (line ${l.line + 1})` })));
  };
  const goToLine = (line: number, select = true) => {
    const lines = area.value.split('\n');
    const l = Math.max(0, Math.min(line, lines.length - 1));
    const start = lines.slice(0, l).reduce((n, s) => n + s.length + 1, 0);
    area.focus({ preventScroll: true });
    if (select) area.setSelectionRange(start, start + lines[l].length);
    area.scrollTop = Math.max(0, (l - 3) * LINE_HEIGHT);
    updateGutter();
  };
  const load = () => {
    lastBin = doc.bin;
    try {
      baseline = host.disassemble(doc.bin);
      status.textContent = '';
      status.className = 'qe-script-status';
    } catch (err) {
      baseline = `; the script could not be disassembled: ${(err as Error).message}\n`;
      status.textContent = `Disassembly failed: ${(err as Error).message}`;
      status.className = 'qe-script-status err';
    }
    area.value = baseline;
    errorAt = -1;
    errors.hidden = true;
    stale.hidden = true;
    updateLabels();
    updateGutter();
  };

  const apply = () => {
    errorAt = -1;
    try {
      const bin = host.assemble(area.value, editableHeaderOf(doc.bin));
      doc.setBin(bin);
      doc.seal();
      load();
      status.textContent = `Applied: ${bin.labels.length} labels, ${bin.data.length} bytes.`;
      status.className = 'qe-script-status ok';
    } catch (err) {
      const message = (err as Error).message;
      const line = errorLine(message);
      errors.textContent = message;
      errors.hidden = false;
      status.textContent = line ? `Assembler error on line ${line}.` : 'Assembler error.';
      status.className = 'qe-script-status err';
      if (line) {
        errorAt = line;
        goToLine(line - 1);
      }
      updateGutter();
    }
  };

  const goToDefinition = () => {
    const word = wordAt(area.value, area.selectionStart);
    const target = labels.find((l) => l.name === word);
    if (!target) {
      status.textContent = word ? `"${word}" is not a label.` : 'Put the caret on a label name.';
      status.className = 'qe-script-status';
      return;
    }
    back.push(area.value.slice(0, area.selectionStart).split('\n').length - 1);
    goToLine(target.line);
  };

  area.addEventListener('input', () => {
    updateLabels();
    updateGutter();
    errors.hidden = true;
    errorAt = -1;
    status.textContent = dirty() ? 'Unapplied changes.' : '';
  });
  area.addEventListener('scroll', () => (gutter.scrollTop = area.scrollTop));
  area.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey) goToDefinition();
  });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'F12') {
      e.preventDefault();
      goToDefinition();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      apply();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  });
  labelSel.addEventListener('change', () => {
    if (labelSel.value !== '') {
      back.push(area.value.slice(0, area.selectionStart).split('\n').length - 1);
      goToLine(Number(labelSel.value));
    }
    labelSel.value = '';
  });

  const el = h(
    'div',
    { class: 'qe-panel qe-script-panel' },
    h(
      'div',
      { class: 'qe-script-bar' },
      button('Apply', apply, 'primary', 'Assemble the text and replace the quest script (Ctrl+Enter)'),
      button('Revert', load, '', 'Throw the text away and show the current script'),
      labelSel,
      button('Definition', goToDefinition, '', 'Go to the label under the caret (F12, or Ctrl+click)'),
      button('Back', () => {
        const l = back.pop();
        if (l !== undefined) goToLine(l, false);
      }),
    ),
    stale,
    h('div', { class: 'qe-script-body' }, gutter, area),
    status,
    errors,
  );
  load();
  return {
    el,
    refresh() {
      if (doc.bin === lastBin) return;
      if (!dirty()) load();
      else stale.hidden = false;
    },
  };
}

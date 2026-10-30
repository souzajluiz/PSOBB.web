// Quest editor page (questeditor.html): wires the document, the panels, the 3D
// view and the file actions together. The logic lives in model.ts and the
// panels; this file only connects them to the page.

import { detectDevDataSource, onDataSource, setDataSource } from '../data/store.ts';
import { pickDataFolder } from '../data/source.ts';
import { areaName, NUM_QUEST_FLOORS } from './areas.ts';
import { copyEntities, takePaste } from './clipboard.ts';
import { button, download, h } from './dom.ts';
import { buildPackage, openQuestFiles, scriptHost, type NamedBytes } from './io.ts';
import { createEnemy, createObject, QuestDocument, type Change } from './model.ts';
import { createEntityListPanel, createInspectorPanel, createPalettePanel, PALETTE_MIME, type PaletteEntry } from './panel_entities.ts';
import { createEventsPanel } from './panel_events.ts';
import { createRandomPanel } from './panel_random.ts';
import { createOverviewPanel } from './panel_overview.ts';
import { createPropertiesPanel, type Panel } from './panel_props.ts';
import { createScriptPanel } from './panel_script.ts';
import { EditorScene, type Placement } from './scene.ts';
import { adminSession, buildPublishBody, defaultPublishName, listQuestDirectories, PUBLISH_NAME_RE, publishQuest, publishTarget, type AdminSession, type PublishFormat } from './publish.ts';
import { buildJsonBody, checkJsonText, defaultJsonName, JSON_NAME_RE, JSON_TEMPLATE, loadQuestJson, saveQuestJson } from './metajson.ts';
import { extractScriptPositions } from './scriptpos.ts';
import { registerTestInGame, testInGame } from './testhook.ts';
import { degreesToBams, wrapBams } from './geom.ts';

const app = document.getElementById('app')!;
const doc = QuestDocument.blank();

// --- Messages -----------------------------------------------------------------------
const message = h('p', { class: 'qe-message', role: 'status' });
let messageTimer: ReturnType<typeof setTimeout> | null = null;
function say(text: string, kind: '' | 'ok' | 'err' = ''): void {
  message.textContent = text;
  message.className = `qe-message ${kind}`;
  if (messageTimer) clearTimeout(messageTimer);
  if (kind === 'ok') messageTimer = setTimeout(() => (message.textContent = ''), 6000);
}

// --- 3D view -------------------------------------------------------------------------
const canvas = h('canvas', { class: 'qe-canvas', tabIndex: 0 });
const viewStatus = h('p', { class: 'qe-view-status', role: 'status' });
const canvasWrap = h('div', { class: 'qe-canvas-wrap' }, canvas);
const scene = new EditorScene(canvas, doc, {
  status: (msg, kind) => {
    viewStatus.textContent = msg;
    viewStatus.className = `qe-view-status ${kind ?? ''}`;
  },
});

function addEntity(entry: PaletteEntry, at: Placement | null): void {
  const p = at ?? { world: [0, 0, 0] as [number, number, number], section: 0, local: [0, 0, 0] as [number, number, number] };
  const e = entry.kind === 'enemy' ? createEnemy(entry.type, doc.floor, p.section, p.local) : createObject(entry.type, doc.floor, p.section, p.local);
  doc.addEntity(doc.floor, e, `Add ${entry.name}`);
  doc.seal();
}

canvasWrap.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes(PALETTE_MIME)) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
});
canvasWrap.addEventListener('drop', (e) => {
  const raw = e.dataTransfer?.getData(PALETTE_MIME);
  if (!raw) return;
  e.preventDefault();
  addEntity(JSON.parse(raw) as PaletteEntry, scene.pointAt(e.clientX, e.clientY));
});

// --- Panels ------------------------------------------------------------------------------
const props = createPropertiesPanel(doc);
const palette = createPalettePanel(doc, { addAtCenter: (entry) => addEntity(entry, scene.centerPoint()) });
const entityList = createEntityListPanel(doc);
const overview = createOverviewPanel(doc, { frame: () => scene.frameSelection() });
const inspector = createInspectorPanel(doc, {
  snapSection: (e) => scene.reassignSection(e),
  dropToGround: (e) => scene.groundedPosition(e),
  frame: () => scene.frameSelection(),
});
const events = createEventsPanel(doc);
const random = createRandomPanel(doc);
let scriptPanel: Panel | null = null;

// --- Toolbar -------------------------------------------------------------------------------
const title = h('span', { class: 'qe-title' });
const undoBtn = button('Undo', () => doc.undo(), '', 'Undo (Ctrl+Z)');
const redoBtn = button('Redo', () => doc.redo(), '', 'Redo (Ctrl+Shift+Z or Ctrl+Y)');
const fileInput = h('input', { type: 'file', multiple: true, accept: '.qst,.bin,.dat', hidden: true });
const dataBtn = button('Open PSOBB data folder', async () => {
  try {
    setDataSource(await pickDataFolder());
  } catch (err) {
    if ((err as DOMException).name !== 'AbortError') say((err as Error).message, 'err');
  }
}, '', 'The 3D view needs the data folder of your PSOBB install (nothing leaves your machine)');
const dataLabel = h('span', { class: 'qe-data-label', text: 'no data folder' });

const confirmDiscard = (): boolean => !doc.dirty || window.confirm('The quest has unsaved changes. Discard them?');

async function readFiles(files: File[]): Promise<NamedBytes[]> {
  return Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

function openFiles(named: NamedBytes[]): void {
  try {
    const next = openQuestFiles(named);
    doc.replaceWith(next);
    say(`Opened "${doc.header.name || doc.fileName}"${doc.warnings.length ? ` with ${doc.warnings.length} warning(s): ${doc.warnings.slice(0, 2).join('; ')}` : ''}.`, doc.warnings.length ? '' : 'ok');
  } catch (err) {
    say(`Cannot open: ${(err as Error).message}`, 'err');
  }
}

fileInput.addEventListener('change', async () => {
  const files = [...(fileInput.files ?? [])];
  fileInput.value = '';
  if (files.length && confirmDiscard()) openFiles(await readFiles(files));
});

const dialog = h('dialog', { class: 'qe-dialog' });
const newBtn = button('New', () => {
  if (!confirmDiscard()) return;
  const episode = h('select', null, h('option', { value: '0', text: 'Episode 1' }), h('option', { value: '1', text: 'Episode 2' }), h('option', { value: '2', text: 'Episode 4' }));
  const name = h('input', { type: 'text', value: 'New quest', maxLength: 31 });
  dialog.replaceChildren(
    h('h3', { text: 'New quest' }),
    h('p', { class: 'qe-hint', text: 'A minimal quest: a start label that sets the episode and designates one floor, and the player spawn point.' }),
    h('label', { class: 'qe-field' }, h('span', { text: 'Episode' }), episode),
    h('label', { class: 'qe-field' }, h('span', { text: 'Name' }), name),
    h('div', { class: 'qe-actions' }, button('Create', () => {
      doc.replaceWith(QuestDocument.blank({ episode: Number(episode.value), name: name.value }));
      dialog.close();
      say('Created a new quest.', 'ok');
    }, 'primary'), button('Cancel', () => dialog.close())),
  );
  dialog.showModal();
});
const openBtn = button('Open...', () => fileInput.click(), '', 'Open a .qst, or a .bin together with its .dat (select both)');

function save(kind: 'qst' | 'pair'): void {
  try {
    const pkg = buildPackage(doc);
    if (kind === 'qst') download(`${pkg.stem}.qst`, pkg.qst);
    else {
      download(`${pkg.stem}.bin`, pkg.bin);
      download(`${pkg.stem}.dat`, pkg.dat);
    }
    doc.markSaved();
    say(`Saved ${kind === 'qst' ? `${pkg.stem}.qst` : `${pkg.stem}.bin and ${pkg.stem}.dat`} (${doc.header.name}).`, 'ok');
  } catch (err) {
    say(`Cannot save: ${(err as Error).message}`, 'err');
  }
}
const saveQstBtn = button('Save .qst', () => save('qst'), 'primary', 'Download a Blue Burst .qst (Ctrl+S)');
const savePairBtn = button('Save .bin + .dat', () => save('pair'), '', 'Download the PRS-compressed .bin and .dat');
const testBtn = button('Test in game', async () => {
  try {
    const r = await testInGame(doc);
    say(
      r === 'no-target' ? 'No game target is connected: the admin panel registers one (registerTestInGame). Use Save .qst and add the quest to the server.' : r === 'posted' ? 'Sent the quest to the page that opened the editor.' : 'Sent the quest to the game server.',
      r === 'no-target' ? '' : 'ok',
    );
  } catch (err) {
    say(`Test in game failed: ${(err as Error).message}`, 'err');
  }
}, '', 'Hand the quest to the admin panel to try it on the server');

// --- Publish to server (only with an admin session on this origin) ------------------------------
let session: AdminSession | null = null;
let publishCategory = '';
const publishDialog = h('dialog', { class: 'qe-dialog' });
const publishBtn = button('Publish to server', () => void openPublish(), 'primary', 'Write this quest into the server\'s quest folder and reload quests (admin panel session required)');
publishBtn.hidden = true;

async function openPublish(): Promise<void> {
  if (!session) return;
  let dirs;
  try {
    dirs = await listQuestDirectories();
  } catch (err) {
    say(`Cannot list the server's quest folders: ${(err as Error).message}`, 'err');
    return;
  }
  const category = h('select', { 'aria-label': 'Category folder' }, ...dirs.map((d) => h('option', { value: d.dir, text: d.dir, selected: d.dir === publishCategory })));
  const format = h('select', { 'aria-label': 'Format' }, h('option', { value: 'pair', text: '.bin + .dat' }), h('option', { value: 'qst', text: '.qst' }));
  const name = h('input', { type: 'text', value: defaultPublishName(doc.fileName || 'quest', 'pair'), maxLength: 64, autocomplete: 'off', spellcheck: false });
  const confirmInput = h('input', { type: 'text', autocomplete: 'off', spellcheck: false, 'aria-label': 'Confirmation' });
  const note = h('p', { class: 'qe-hint' });
  const go = button('Publish', () => void doPublish(), 'primary');
  const target = (): string => publishTarget(category.value, name.value);
  const refresh = (): void => {
    const existing = dirs.find((d) => d.dir === category.value)?.files.map((f) => f.name) ?? [];
    const files = name.value.endsWith('.qst') ? [name.value] : [name.value, name.value.replace(/-bb(-[a-z])?\.bin$/, '-bb.dat')];
    const clash = files.filter((f) => existing.includes(f));
    note.textContent = clash.length ? `Replaces ${clash.join(', ')} (a backup is kept on the server).` : 'Creates new files.';
    go.disabled = !PUBLISH_NAME_RE.test(name.value) || confirmInput.value !== target();
  };
  format.addEventListener('change', () => {
    name.value = defaultPublishName(name.value.replace(/\.(bin|qst)$/, '').replace(/-bb(-[a-z])?$/, ''), format.value as PublishFormat);
    refresh();
  });
  for (const el of [category, name, confirmInput]) el.addEventListener('input', refresh);
  async function doPublish(): Promise<void> {
    if (!session) return;
    go.disabled = true;
    try {
      const pkg = buildPackage(doc);
      const r = await publishQuest(session, buildPublishBody(pkg, category.value, name.value));
      publishCategory = category.value;
      doc.markSaved();
      publishDialog.close();
      say(`Published ${r.files.map((f) => f.name).join(' + ')} to ${category.value}; the server reloaded its quests (quest ${r.quest.questNumber}, "${r.quest.name}").`, 'ok');
    } catch (err) {
      say(`Publish failed: ${(err as Error).message}`, 'err');
      refresh();
    }
  }
  publishDialog.replaceChildren(
    h('h3', { text: 'Publish to server' }),
    h('p', { class: 'qe-hint', text: 'Writes the quest into the server\'s quest folder (the previous file is backed up) and reloads quests. Players see it next time they open the quest menu. The file name needs the Blue Burst tag, e.g. q9001-bb-e.bin (the .dat becomes q9001-bb.dat) or q9001-bb.qst.' }),
    h('label', { class: 'qe-field' }, h('span', { text: 'Category folder' }), category),
    h('label', { class: 'qe-field' }, h('span', { text: 'Format' }), format),
    h('label', { class: 'qe-field' }, h('span', { text: 'File name' }), name),
    note,
    h('label', { class: 'qe-field' }, h('span', { text: 'Type the target to confirm' }), confirmInput),
    h('p', { class: 'qe-hint' }, h('code', { text: 'category/file' }), ' must match exactly.'),
    h('div', { class: 'qe-actions' }, go, button('Cancel', () => publishDialog.close())),
  );
  refresh();
  publishDialog.showModal();
}

// --- Quest .json (newserv metadata), admin session only ------------------------------------------
const jsonDialog = h('dialog', { class: 'qe-dialog qe-json-dialog' });
const jsonBtn = button('Quest .json', () => void openJson(), '', 'Edit the quest\'s newserv metadata file (enabled expressions, chat start ...) on the server (admin panel session required)');
jsonBtn.hidden = true;

async function openJson(): Promise<void> {
  if (!session) return;
  let dirs;
  try {
    dirs = await listQuestDirectories();
  } catch (err) {
    say(`Cannot list the server's quest folders: ${(err as Error).message}`, 'err');
    return;
  }
  const category = h('select', { 'aria-label': 'JSON category folder' }, ...dirs.map((d) => h('option', { value: d.dir, text: d.dir, selected: d.dir === publishCategory })));
  const name = h('input', { type: 'text', value: defaultJsonName(doc.fileName || 'quest'), maxLength: 64, autocomplete: 'off', spellcheck: false, 'aria-label': 'JSON file name' });
  const text = h('textarea', { class: 'qe-json-text', rows: 12, spellcheck: false, 'aria-label': 'Quest JSON' });
  const note = h('p', { class: 'qe-hint', role: 'status' });
  const save = button('Save .json', () => void doSave(), 'primary');
  const target = (): string => `${category.value}/${name.value}`;
  const exists = (): boolean => dirs.find((d) => d.dir === category.value)?.files.some((f) => f.name === name.value) ?? false;
  const refresh = (): void => {
    const nameOk = JSON_NAME_RE.test(name.value);
    const err = nameOk ? checkJsonText(text.value) : 'The name must look like q9001-bb.json.';
    note.textContent = err ?? (exists() ? `Replaces ${target()} (a backup is kept on the server).` : `Creates ${target()}.`);
    note.className = err ? 'qe-hint qe-error' : 'qe-hint';
    save.disabled = err !== null;
  };
  async function load(): Promise<void> {
    if (!JSON_NAME_RE.test(name.value)) return refresh();
    try {
      const t = await loadQuestJson(category.value, name.value);
      text.value = t ?? JSON_TEMPLATE;
    } catch (err) {
      say(`Cannot read ${target()}: ${(err as Error).message}`, 'err');
    }
    refresh();
  }
  async function doSave(): Promise<void> {
    if (!session) return;
    save.disabled = true;
    try {
      const r = await saveQuestJson(session, buildJsonBody(category.value, name.value, text.value));
      publishCategory = category.value;
      jsonDialog.close();
      say(`${r.replaced ? 'Replaced' : 'Created'} ${target()}; the server reloaded its quests.`, 'ok');
    } catch (err) {
      say(`Saving the .json failed: ${(err as Error).message}`, 'err');
      refresh();
    }
  }
  category.addEventListener('change', () => void load());
  name.addEventListener('change', () => void load());
  text.addEventListener('input', refresh);
  jsonDialog.replaceChildren(
    h('h3', { text: 'Quest metadata (.json)' }),
    h('p', { class: 'qe-hint', text: 'newserv reads q9001-bb-e.json, q9001-bb.json or q9001.json next to the quest and applies its keys: DescriptionFlag, AvailableIf, EnabledIf, AllowStartFromChatCommand, Joinable, LockStatusRegister, AllowedDropModes ... Saving writes the file (the previous one is backed up) and reloads quests.' }),
    h('label', { class: 'qe-field' }, h('span', { text: 'Category folder' }), category),
    h('label', { class: 'qe-field' }, h('span', { text: 'File name' }), name),
    text,
    note,
    h('div', { class: 'qe-actions' }, save, button('Cancel', () => jsonDialog.close())),
  );
  await load();
  jsonDialog.showModal();
}

void adminSession().then((s) => {
  session = s;
  publishBtn.hidden = !s;
  jsonBtn.hidden = !s;
});

const toolbar = h(
  'div',
  { class: 'qe-toolbar', role: 'toolbar', 'aria-label': 'Quest editor' },
  newBtn,
  openBtn,
  saveQstBtn,
  savePairBtn,
  h('span', { class: 'sep' }),
  undoBtn,
  redoBtn,
  h('span', { class: 'sep' }),
  dataBtn,
  dataLabel,
  h('span', { class: 'grow' }),
  jsonBtn,
  publishBtn,
  testBtn,
);

// --- View bar and tabs ---------------------------------------------------------------------------
const floorSel = h('select', { 'aria-label': 'Floor' });
floorSel.addEventListener('change', () => doc.selectFloor(Number(floorSel.value)));
const snapBox = h('input', { type: 'checkbox' });
snapBox.addEventListener('change', () => (scene.snapToGround = snapBox.checked));
const markersBox = h('input', { type: 'checkbox', checked: true });
markersBox.addEventListener('change', () => scene.setMarkersVisible(markersBox.checked));
const modelsBox = h('input', { type: 'checkbox', checked: true });
modelsBox.addEventListener('change', () => scene.setModelsVisible(modelsBox.checked));
const scriptPosBox = h('input', { type: 'checkbox', checked: true });
scriptPosBox.addEventListener('change', () => scene.setScriptVisible(scriptPosBox.checked));
const scriptPosLabel = h('span', { class: 'qe-script-count', text: '' });
// The script's positions and radii (p_setpos, at_coords_call ...) for the 3D view, from the disassembly.
function refreshScriptPositions(): void {
  try {
    scene.setScriptPositions(extractScriptPositions(scriptHost.disassemble(doc.bin)));
  } catch {
    scene.setScriptPositions([]);
  }
  scriptPosLabel.textContent = ` (${scene.scriptMarkerCount})`;
}
const viewBar = h(
  'div',
  { class: 'qe-viewbar' },
  h('label', { class: 'qe-inline' }, 'Floor ', floorSel),
  button('Frame all', () => scene.frameAll()),
  button('Frame selection', () => scene.frameSelection()),
  h('label', { class: 'qe-check' }, markersBox, ' Markers'),
  h('label', { class: 'qe-check' }, modelsBox, ' Models'),
  h('label', { class: 'qe-check', title: 'Positions and radii the quest script uses: player starts, at_coords_call / talk circles, moved collisions, particles' }, scriptPosBox, ' Script positions', scriptPosLabel),
  h('label', { class: 'qe-check', title: 'Dragging keeps entities on the ground' }, snapBox, ' Snap to ground'),
);
const view3d = h('div', { class: 'qe-view' }, viewBar, canvasWrap, viewStatus, h('p', { class: 'qe-hint', text: 'Click selects (Shift or Ctrl adds), drag moves, Alt-drag rotates, drag the green ring around the selection to turn it (Shift snaps to 15 degrees), Delete removes; Ctrl+C / Ctrl+X copy or cut the selection and Ctrl+V pastes it (onto any floor, or into another quest). Drag orbits, wheel zooms, right-drag pans, WASD / Q / E fly. Drag a type from the palette into the view to create it.' }));
const viewScript = h('div', { class: 'qe-view', hidden: true });
const viewEvents = h('div', { class: 'qe-view scroll', hidden: true }, events.el);
const viewRandom = h('div', { class: 'qe-view scroll', hidden: true }, random.el);

type Tab = '3d' | 'script' | 'events' | 'random';
let tab: Tab = '3d';
const tabButtons = (['3d', 'script', 'events', 'random'] as const).map((t) =>
  button(t === '3d' ? '3D view' : t === 'script' ? 'Script' : t === 'events' ? 'Wave events' : 'Random waves', () => showTab(t), 'tab'),
);
function showTab(t: Tab): void {
  tab = t;
  tabButtons.forEach((b, i) => b.classList.toggle('active', ['3d', 'script', 'events', 'random'][i] === t));
  view3d.hidden = t !== '3d';
  viewScript.hidden = t !== 'script';
  viewEvents.hidden = t !== 'events';
  viewRandom.hidden = t !== 'random';
  if (t === 'script') {
    if (!scriptPanel) {
      try {
        scriptPanel = createScriptPanel(doc, scriptHost);
        viewScript.append(scriptPanel.el);
      } catch (err) {
        viewScript.append(h('p', { class: 'qe-error', text: `The script editor needs the quest assembler: ${(err as Error).message}` }));
      }
    }
    scriptPanel?.refresh();
  }
  if (t === 'events') events.refresh();
  if (t === 'random') random.refresh();
  flush(['all']);
}

// --- Layout -----------------------------------------------------------------------------------------
const left = h('aside', { class: 'qe-left' }, props.el, overview.el);
const right = h('aside', { class: 'qe-right' }, palette.el, entityList.el, inspector.el);
const center = h('main', { class: 'qe-center' }, h('nav', { class: 'qe-main-tabs', role: 'tablist' }, ...tabButtons), view3d, viewScript, viewEvents, viewRandom);
app.replaceChildren(
  h('header', { class: 'qe-top' }, h('div', { class: 'qe-brand' }, 'PSOBB', h('span', { text: '.web' }), ' Quest editor'), title, message),
  toolbar,
  left,
  center,
  right,
  fileInput,
  dialog,
  publishDialog,
  jsonDialog,
);

// --- Refresh scheduling -------------------------------------------------------------------------------
type Part = 'props' | 'palette' | 'list' | 'inspector' | 'events' | 'random' | 'script' | 'toolbar' | 'floors' | 'all';
const pending = new Set<Part>();
let scheduled = false;

function floorOptions(): void {
  const have = new Set(doc.designatedFloors());
  const options: HTMLOptionElement[] = [];
  for (let f = 0; f < NUM_QUEST_FLOORS; f++) {
    const area = doc.areaOf(f);
    options.push(h('option', { value: String(f), text: `${have.has(f) ? '* ' : ''}Floor ${f}${area === null ? '' : ` - ${areaName(area)}`}` }));
  }
  floorSel.replaceChildren(...options);
  floorSel.value = String(doc.floor);
}

function flush(parts: Part[]): void {
  for (const p of parts) pending.add(p);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    // Snapshot the requested parts before clearing: `has` must read the snapshot, not the
    // live set, or every named part reads as "not requested" once it is cleared.
    scheduled = false;
    const todo = new Set(pending);
    pending.clear();
    const has = (p: Part) => todo.has('all') || todo.has(p);
    // Each part refreshes on its own: one panel throwing must not starve the others (and
    // the error is logged, not swallowed).
    const part = (p: Part, fn: () => void): void => {
      if (!has(p)) return;
      try {
        fn();
      } catch (err) {
        console.error(`Quest editor: refreshing "${p}" failed`, err);
      }
    };
    part('props', () => props.refresh());
    part('floors', () => {
      floorOptions();
      overview.refresh();
    });
    part('palette', () => palette.refresh());
    part('list', () => entityList.refresh());
    part('inspector', () => inspector.refresh());
    part('events', () => {
      if (tab === 'events') events.refresh();
    });
    part('random', () => {
      if (tab === 'random') random.refresh();
    });
    part('script', () => {
      if (tab === 'script') scriptPanel?.refresh();
    });
    part('toolbar', () => {
      undoBtn.disabled = !doc.history.canUndo;
      redoBtn.disabled = !doc.history.canRedo;
      undoBtn.title = doc.history.undoLabel ? `Undo: ${doc.history.undoLabel} (Ctrl+Z)` : 'Nothing to undo';
      redoBtn.title = doc.history.redoLabel ? `Redo: ${doc.history.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo';
      title.textContent = `${doc.header.name || doc.fileName}${doc.dirty ? ' *' : ''}`;
      document.title = `${doc.dirty ? '* ' : ''}${doc.header.name || doc.fileName} - PSOBB.web Quest editor`;
    });
  });
}

doc.onChange((c: Change) => {
  switch (c.kind) {
    case 'document':
      refreshScriptPositions();
      flush(['all']);
      break;
    case 'header':
    case 'bin':
      if (c.kind === 'bin') refreshScriptPositions();
      flush(['props', 'palette', 'floors', 'script', 'toolbar', 'list']);
      break;
    case 'floor':
      flush(['props', 'palette', 'floors', 'list', 'inspector', 'events', 'random']);
      break;
    case 'entities':
      flush(['props', 'list', 'inspector', 'events', 'floors']);
      break;
    case 'fields':
      flush(['inspector', 'list', 'events', 'floors']);
      break;
    case 'events':
      flush(['props', 'events', 'floors']);
      break;
    case 'random':
      flush(['random', 'floors']);
      break;
    case 'selection':
      flush(['list', 'inspector']);
      break;
    case 'history':
      flush(['toolbar']);
      break;
  }
});

// --- Keyboard ---------------------------------------------------------------------------------------------
const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save('qst');
    return;
  }
  if (typing(e.target) || dialog.open || publishDialog.open || jsonDialog.open) return;
  const key = e.key.toLowerCase();
  if (mod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) doc.redo();
    else doc.undo();
  } else if (mod && key === 'y') {
    e.preventDefault();
    doc.redo();
  } else if (mod && key === 'd') {
    e.preventDefault();
    doc.duplicateSelection();
    doc.seal();
  } else if (mod && (key === 'c' || key === 'x') && doc.selection.length) {
    e.preventDefault();
    const n = copyEntities(doc.selection)?.entities.length ?? 0;
    say(`Copied ${n} ${n === 1 ? 'entity' : 'entities'} (Ctrl+V pastes them on the current floor, or in another quest).`, 'ok');
    if (key === 'x') {
      doc.deleteSelection();
      doc.seal();
    }
  } else if (mod && key === 'v') {
    e.preventDefault();
    const copies = takePaste(doc.floor);
    if (!copies) say('Nothing copied yet: select entities and press Ctrl+C.', 'err');
    else {
      doc.addEntities(doc.floor, copies, 'Paste');
      doc.seal();
      say(`Pasted ${copies.length} ${copies.length === 1 ? 'entity' : 'entities'} on floor ${doc.floor}.`, 'ok');
    }
  } else if (mod && key === 'a' && tab === '3d') {
    e.preventDefault();
    doc.select(doc.entitiesOf(doc.floor));
  } else if (!mod && (key === 'delete' || (key === 'backspace' && e.target === canvas)) && doc.selection.length) {
    e.preventDefault();
    doc.deleteSelection();
    doc.seal();
  } else if (!mod && key === 'escape') {
    doc.clearSelection();
  } else if (!mod && key === 'f' && tab === '3d') {
    scene.frameSelection();
  } else if (!mod && (e.key === '[' || e.key === ']') && doc.selection.length) {
    const d = degreesToBams(e.key === '[' ? -15 : 15);
    doc.patchEntities(doc.selection.map((s) => [s, { rotation: [s.rotation[0], wrapBams(s.rotation[1] + d), s.rotation[2]] as [number, number, number] }] as const), 'Rotate');
    doc.seal();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (doc.dirty) e.preventDefault();
});

// Dropping quest files on the page opens them.
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!files.length) return;
  e.preventDefault();
  if (confirmDiscard()) openFiles(await readFiles(files));
});

// --- Data folder -------------------------------------------------------------------------------------------
onDataSource((s) => {
  dataLabel.textContent = s.label;
  scene.setSource(s);
  say(`Data source: ${s.label}.`, 'ok');
});
void detectDevDataSource();

// --- Embedding API -------------------------------------------------------------------------------------------
// For the admin panel: window.questEditor in the same page, or postMessage from a window that opened this one.
const api = {
  document: doc,
  scene,
  buildPackage: () => buildPackage(doc),
  testInGame: () => testInGame(doc),
  registerTestInGame,
  open: (name: string, bytes: Uint8Array) => openFiles([{ name, bytes }]),
};
(globalThis as { questEditor?: typeof api }).questEditor = api;

window.addEventListener('message', (e: MessageEvent) => {
  if (e.origin !== window.location.origin) return;
  const d = e.data as { type?: string; name?: string; bytes?: Uint8Array } | null;
  if (d?.type === 'questeditor:open' && d.bytes && d.name) openFiles([{ name: d.name, bytes: new Uint8Array(d.bytes) }]);
  else if (d?.type === 'questeditor:get-package') (e.source as Window | null)?.postMessage({ type: 'questeditor:package', package: buildPackage(doc) }, e.origin);
});

// ?qst=<url> opens a quest from a URL (same origin or CORS-enabled); &dat=<url>
// adds the .dat when the first URL is a .bin. The admin panel's "Open in editor"
// uses /admin/api/quests/file/<folder>/<name>, which needs the admin session
// cookie (same origin, sent automatically).
const query = new URLSearchParams(location.search);
const qstUrl = query.get('qst');
const datUrl = query.get('dat');
const nameOfUrl = (u: string): string => {
  try {
    return decodeURIComponent(new URL(u, location.href).pathname.split('/').pop() ?? 'quest.qst');
  } catch {
    return 'quest.qst';
  }
};
async function fetchBytes(u: string): Promise<NamedBytes> {
  const res = await fetch(u, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return { name: nameOfUrl(u), bytes: new Uint8Array(await res.arrayBuffer()) };
}
if (qstUrl) {
  Promise.all([fetchBytes(qstUrl), datUrl ? fetchBytes(datUrl) : null])
    .then(([first, second]) => {
      openFiles(second ? [first, second] : [first]);
      const m = /\/admin\/api\/quests\/file\/([^/]+)\//.exec(new URL(qstUrl, location.href).pathname);
      if (m) publishCategory = decodeURIComponent(m[1]);
    })
    .catch((err) => say(`Cannot load ${qstUrl}: ${(err as Error).message}`, 'err'));
}

refreshScriptPositions();
showTab('3d');
flush(['all']);
doc.markSaved();
void scene.showFloor();

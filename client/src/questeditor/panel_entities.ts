// Quest editor: the palette (entity types to create), the entity list of the
// floor and the inspector of the selection.

import { ENEMY_DEFINITIONS, OBJECT_DEFINITIONS } from '../formats/entitynames.ts';
import { enemyDisplayName, entityName, entityParamLabels, type EnemySet, type ObjectSet, type SetEntity } from '../formats/setdata.ts';
import { bamsToDegrees, degreesToBams, wrapBams } from './geom.ts';
import { button, h, hex, numberField, section, type Field } from './dom.ts';
import { createEnemy, createObject, type EntityPatch, type QuestDocument } from './model.ts';
import type { Panel } from './panel_props.ts';

// --- Palette -----------------------------------------------------------------------------

export interface PaletteEntry {
  kind: 'enemy' | 'object';
  type: number;
  name: string;
}

const hasArea = (mask: number, area: number) => Math.floor(mask / 2 ** area) % 2 === 1;

// The types the area can hold (newserv's definition tables), by display name.
export function paletteEntries(kind: 'enemy' | 'object', area: number | null): PaletteEntry[] {
  const defs = kind === 'enemy' ? ENEMY_DEFINITIONS : OBJECT_DEFINITIONS;
  const seen = new Set<number>();
  const out: PaletteEntry[] = [];
  for (const [type, mask] of defs) {
    if (seen.has(type) || (area !== null && !hasArea(mask, area))) continue;
    seen.add(type);
    const name = kind === 'enemy' ? enemyDisplayName(createEnemy(type, 0, 0), area) : entityName(createObject(type, 0, 0), area);
    out.push({ kind, type, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.type - b.type);
}

export const PALETTE_MIME = 'application/x-psobb-quest-entity';

export interface PaletteHost {
  addAtCenter(entry: PaletteEntry): void;
}

export function createPalettePanel(doc: QuestDocument, host: PaletteHost): Panel {
  let kind: 'enemy' | 'object' = 'enemy';
  let shownKey = '';
  const search = h('input', { type: 'search', placeholder: 'Filter by name or hex type', spellcheck: false });
  const list = h('div', { class: 'qe-palette-list', role: 'list' });
  const tabs = (['enemy', 'object'] as const).map((k) =>
    button(k === 'enemy' ? 'Enemies / NPCs' : 'Objects', () => {
      kind = k;
      build();
    }, 'tab'),
  );
  const build = () => {
    const area = doc.areaOf(doc.floor);
    const q = search.value.trim().toLowerCase();
    shownKey = `${kind}:${area}:${q}`;
    tabs.forEach((t, i) => t.classList.toggle('active', (i === 0 ? 'enemy' : 'object') === kind));
    const entries = paletteEntries(kind, area).filter((e) => !q || e.name.toLowerCase().includes(q) || hex(e.type).toLowerCase().includes(q.replace(/^0x/, '')));
    list.replaceChildren(
      ...entries.map((e) => {
        const row = h(
          'div',
          { class: 'qe-palette-row', draggable: true, role: 'listitem', title: 'Drag into the 3D view, or press + to add at the centre of the view' },
          h('span', { class: 'name', text: e.name }),
          h('span', { class: 'type', text: `0x${hex(e.type)}` }),
          button('+', () => host.addAtCenter(e), 'small', 'Add at the centre of the view'),
        );
        row.addEventListener('dragstart', (ev) => {
          ev.dataTransfer?.setData(PALETTE_MIME, JSON.stringify(e));
          ev.dataTransfer?.setData('text/plain', `${e.kind}:${e.type}`);
          if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
        });
        row.addEventListener('dblclick', () => host.addAtCenter(e));
        return row;
      }),
    );
    if (!entries.length) list.append(h('p', { class: 'qe-hint', text: 'No type matches.' }));
  };
  search.addEventListener('input', build);
  const el = h('div', { class: 'qe-panel' }, section('Palette', h('div', { class: 'qe-tabs' }, ...tabs), search, list));
  build();
  return {
    el,
    refresh() {
      const key = `${kind}:${doc.areaOf(doc.floor)}:${search.value.trim().toLowerCase()}`;
      if (key !== shownKey) build();
    },
  };
}

// --- Entity list --------------------------------------------------------------------------------

const MAX_ROWS = 500;

export function createEntityListPanel(doc: QuestDocument): Panel {
  const filter = h('input', { type: 'search', placeholder: 'Filter (name, hex type, room, wave)', spellcheck: false });
  const rows = h('div', { class: 'qe-entity-list', role: 'listbox', 'aria-multiselectable': 'true' });
  const info = h('p', { class: 'qe-hint' });
  let rowOf = new Map<SetEntity, HTMLElement>();
  let shownKey = '';

  const label = (e: SetEntity): string => {
    const area = doc.areaOf(e.floor);
    const where = e.kind === 'enemy' ? `room ${e.section} · wave ${e.wave}` : `room ${e.section} · group ${e.group}`;
    return `${entityName(e, area)}\n${e.kind === 'enemy' ? (doc.isNpc(e) ? 'NPC' : 'enemy') : 'object'} #${e.index} · 0x${hex(e.type)} · ${where}`;
  };

  const sig = () => {
    const f = doc.floors.get(doc.floor);
    return `${doc.floor}:${f?.objects.length ?? 0}:${f?.enemies.length ?? 0}:${filter.value}:${doc.header.episode}`;
  };

  const build = () => {
    shownKey = sig();
    const q = filter.value.trim().toLowerCase();
    const all = doc.entitiesOf(doc.floor);
    const lines = all.map((e) => [e, label(e)] as const).filter(([, l]) => !q || l.toLowerCase().includes(q));
    rowOf = new Map();
    rows.replaceChildren(
      ...lines.slice(0, MAX_ROWS).map(([e, l]) => {
        const [name, detail] = l.split('\n');
        const row = h('div', { class: `qe-entity-row ${e.kind === 'object' ? 'object' : doc.isNpc(e) ? 'npc' : 'enemy'}`, role: 'option', tabIndex: -1 }, h('span', { class: 'name', text: name }), h('span', { class: 'detail', text: detail }));
        row.addEventListener('click', (ev) => doc.select([e], ev.shiftKey || ev.ctrlKey || ev.metaKey ? 'toggle' : 'set'));
        rowOf.set(e, row);
        return row;
      }),
    );
    info.textContent = `${lines.length} of ${all.length} entities${lines.length > MAX_ROWS ? ` (first ${MAX_ROWS} shown, use the filter)` : ''}`;
    markSelection();
  };
  const markSelection = () => {
    for (const [e, row] of rowOf) {
      const on = doc.isSelected(e);
      row.classList.toggle('selected', on);
      row.setAttribute('aria-selected', String(on));
    }
    const first = doc.selection[0];
    if (first) rowOf.get(first)?.scrollIntoView({ block: 'nearest' });
  };
  filter.addEventListener('input', build);
  const el = h('div', { class: 'qe-panel' }, section('Entities on this floor', filter, info, rows));
  return {
    el,
    refresh() {
      if (sig() !== shownKey) build();
      else markSelection();
    },
  };
}

// --- Inspector -----------------------------------------------------------------------------------------

export interface InspectorHost {
  snapSection(e: SetEntity): { section: number; position: [number, number, number] } | null;
  dropToGround(e: SetEntity): [number, number, number] | null;
  frame(): void;
}

export function createInspectorPanel(doc: QuestDocument, host: InspectorHost): Panel {
  const root = h('div', { class: 'qe-panel' });
  let shownFor: readonly SetEntity[] = [];
  let fields: Field[] = [];
  const done = () => doc.seal();

  const current = (): SetEntity | null => (doc.selection.length === 1 ? doc.selection[0] : null);
  const patch = (e: SetEntity, p: EntityPatch, key: string) => doc.patchEntity(e, p, `${key}:${doc.selection.indexOf(e)}`);

  const buildOne = (e: SetEntity): HTMLElement => {
    fields = [];
    const add = (f: Field): HTMLElement => (fields.push(f), f.el);
    const area = doc.areaOf(e.floor);
    const title = h('h3', { text: `${e.kind === 'enemy' ? (doc.isNpc(e) ? 'NPC' : 'Enemy') : 'Object'} #${e.index}` });
    const name = h('p', { class: 'qe-entity-name' });
    const nameUpdate = () => (name.textContent = `${entityName(e, area)} · floor ${e.floor}`);
    nameUpdate();
    fields.push({ el: name, refresh: nameUpdate });
    const pos = (i: number, l: string) =>
      add(
        numberField(
          l,
          () => e.position[i],
          (v) => patch(e, { position: e.position.map((x, k) => (k === i ? v : x)) as [number, number, number] }, `pos${i}`),
          done,
          { step: 1 },
        ),
      );
    const rot = (i: number, l: string) =>
      add(
        numberField(
          l,
          () => bamsToDegrees(e.rotation[i]),
          (v) => patch(e, { rotation: e.rotation.map((x, k) => (k === i ? wrapBams(degreesToBams(v)) : x)) as [number, number, number] }, `rot${i}`),
          done,
          { step: 1 },
        ),
      );
    const params = entityParamLabels(e, area).map((l, i) =>
      add(
        numberField(
          l,
          () => e.params[i],
          (v) => patch(e, { params: e.params.map((x, k) => (k === i ? v : x)) }, `param${i}`),
          done,
          { step: i < (e.kind === 'object' ? 3 : 5) ? 0.1 : 1 },
        ),
      ),
    );
    const typeField = add(numberField('Type (hex)', () => e.type, (v) => patch(e, { type: v }, 'type'), done, { hex: true, min: 0, max: 0xffff }));
    const section_ = add(numberField('Room (section)', () => e.section, (v) => patch(e, { section: v }, 'section'), done, { min: 0, max: 0xffff }));
    const kindFields: HTMLElement[] =
      e.kind === 'enemy'
        ? [
            add(numberField('Wave', () => (e as EnemySet).wave, (v) => patch(e, { wave: v }, 'wave'), done, { min: 0, max: 0xffff })),
            add(numberField('Wave 2', () => (e as EnemySet).wave2, (v) => patch(e, { wave2: v }, 'wave2'), done, { min: 0, max: 0xffff })),
            add(numberField('Children', () => (e as EnemySet).numChildren, (v) => patch(e, { numChildren: v }, 'children'), done, { min: 0, max: 0xffff })),
            add(numberField('Unknown A1', () => (e as EnemySet).unknownA1, (v) => patch(e, { unknownA1: v }, 'a1'), done, { min: 0, max: 0xffff })),
          ]
        : [
            add(numberField('Group', () => (e as ObjectSet).group, (v) => patch(e, { group: v }, 'group'), done, { min: 0, max: 0xffff })),
            add(numberField('Unknown A3', () => (e as ObjectSet).unknownA3, (v) => patch(e, { unknownA3: v }, 'a3'), done, { min: 0, max: 0xffff })),
          ];
    const actions = h(
      'div',
      { class: 'qe-actions' },
      button('Nearest room', () => {
        const s = host.snapSection(e);
        if (s) {
          doc.patchEntity(e, { section: s.section, position: s.position }, undefined, 'Change room');
          doc.seal();
        }
      }, '', 'Assign the room whose origin is nearest and keep the world position'),
      button('Drop to ground', () => {
        const p = host.dropToGround(e);
        if (p) {
          doc.patchEntity(e, { position: p }, undefined, 'Drop to ground');
          doc.seal();
        }
      }),
      button('Rotate -15', () => rotateBy(-15)),
      button('Rotate +15', () => rotateBy(15)),
      button('Frame', () => host.frame()),
      button('Duplicate', () => doc.duplicateSelection()),
      button('Delete', () => doc.deleteSelection(), 'danger'),
    );
    const rotateBy = (deg: number) => {
      doc.patchEntity(e, { rotation: [e.rotation[0], wrapBams(e.rotation[1] + degreesToBams(deg)), e.rotation[2]] }, undefined, 'Rotate');
      doc.seal();
    };
    return h(
      'div',
      null,
      title,
      name,
      actions,
      h('div', { class: 'qe-grid2' }, typeField, section_),
      h('h4', { text: 'Position (relative to the room)' }),
      h('div', { class: 'qe-grid3' }, pos(0, 'X'), pos(1, 'Y'), pos(2, 'Z')),
      h('h4', { text: 'Rotation (degrees)' }),
      h('div', { class: 'qe-grid3' }, rot(0, 'X'), rot(1, 'Y'), rot(2, 'Z')),
      h('h4', { text: e.kind === 'enemy' ? 'Wave' : 'Group' }),
      h('div', { class: 'qe-grid2' }, ...kindFields),
      h('h4', { text: 'Parameters' }),
      h('div', { class: 'qe-grid2' }, ...params),
    );
  };

  const buildMany = (list: readonly SetEntity[]): HTMLElement => {
    fields = [];
    const enemies = list.filter((e): e is EnemySet => e.kind === 'enemy');
    const room = numberField('Room (all)', () => list[0].section, (v) => doc.patchEntities(list.map((e) => [e, { section: v }] as const), 'Change room', 'many:section'), () => doc.seal(), { min: 0, max: 0xffff });
    fields.push(room);
    const wave = numberField('Wave (enemies)', () => enemies[0]?.wave ?? 0, (v) => doc.patchEntities(enemies.map((e) => [e, { wave: v }] as const), 'Change wave', 'many:wave'), () => doc.seal(), { min: 0, max: 0xffff });
    fields.push(wave);
    return h(
      'div',
      null,
      h('h3', { text: `${list.length} entities selected` }),
      h('div', { class: 'qe-actions' }, button('Duplicate', () => doc.duplicateSelection()), button('Delete', () => doc.deleteSelection(), 'danger'), button('Frame', () => host.frame())),
      h('div', { class: 'qe-grid2' }, room.el, enemies.length ? wave.el : null),
      h('p', { class: 'qe-hint', text: 'Drag in the 3D view moves all of them.' }),
    );
  };

  const rebuild = () => {
    shownFor = [...doc.selection];
    const one = current();
    root.replaceChildren(
      section(
        'Inspector',
        one
          ? buildOne(one)
          : doc.selection.length > 1
            ? buildMany(doc.selection)
            : h('p', { class: 'qe-hint', text: 'Select an entity in the 3D view or the list. Click to select, drag to move, Alt-drag to rotate, Shift-click to add to the selection, Delete removes it.' }),
      ),
    );
    for (const f of fields) f.refresh();
  };
  rebuild();
  return {
    el: root,
    refresh() {
      const same = shownFor.length === doc.selection.length && shownFor.every((e, i) => e === doc.selection[i]);
      if (!same) rebuild();
      else for (const f of fields) f.refresh();
    },
  };
}

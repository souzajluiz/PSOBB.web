// Quest editor: the quest properties and the floor (map designation) table.

import type { QuestFloorAssignment } from '../formats/questbin.ts';
import { AREA_NAMES, FLOOR_TYPE_NAMES, floorToArea, NUM_QUEST_FLOORS } from './areas.ts';
import { LONG_CHARS, NAME_CHARS, SHORT_CHARS, MAX_FLOOR_ASSIGNMENTS } from './binhead.ts';
import { button, h, numberField, section, selectField, textField, type Field } from './dom.ts';
import type { QuestDocument } from './model.ts';

export interface Panel {
  el: HTMLElement;
  refresh(): void;
}

const AREA_OPTIONS = Object.entries(AREA_NAMES).map(([n, name]) => [Number(n), `${name} (0x${Number(n).toString(16)})`] as const);

export function createPropertiesPanel(doc: QuestDocument): Panel {
  const done = () => doc.seal();
  const fields: Field[] = [
    selectField(
      'Episode',
      [[0, 'Episode 1'], [1, 'Episode 2'], [2, 'Episode 4']] as const,
      () => doc.header.episode,
      (v) => doc.setHeader({ episode: v }),
    ),
    numberField('Quest number', () => doc.header.questNumber, (v) => doc.setHeader({ questNumber: v }, 'prop:number'), done, { min: 0, max: 0xffff }),
    textField('Name', () => doc.header.name, (v) => doc.setHeader({ name: v }, 'prop:name'), done, { maxLength: NAME_CHARS }),
    textField('Short description', () => doc.header.shortDescription, (v) => doc.setHeader({ shortDescription: v }, 'prop:short'), done, { multiline: true, maxLength: SHORT_CHARS }),
    textField('Long description', () => doc.header.longDescription, (v) => doc.setHeader({ longDescription: v }, 'prop:long'), done, { multiline: true, maxLength: LONG_CHARS }),
    selectField(
      'Players',
      [[1, '1'], [2, '2'], [3, '3'], [4, '4']] as const,
      () => doc.header.maxPlayers,
      (v) => doc.setHeader({ maxPlayers: v }),
    ),
  ];
  const joinable = h('input', { type: 'checkbox' });
  joinable.addEventListener('change', () => doc.setHeader({ joinable: joinable.checked }));
  const counts = h('p', { class: 'qe-counts' });
  const props = section(
    'Quest',
    ...fields.map((f) => f.el),
    h('label', { class: 'qe-check' }, joinable, ' Joinable after start'),
    counts,
  );

  const rows = h('div', { class: 'qe-floor-rows' });
  const note = h('p', { class: 'qe-hint' });
  const add = button('Add floor', () => {
    const list = doc.header.floorAssignments;
    if (list.length >= MAX_FLOOR_ASSIGNMENTS) return;
    const used = new Set(list.map((f) => f.floor));
    let floor = 1;
    while (used.has(floor) && floor < NUM_QUEST_FLOORS) floor++;
    if (floor >= NUM_QUEST_FLOORS) return;
    const area = floorToArea(doc.episode)[floor];
    doc.setDesignation(floor, { area: area >= 0 ? area : 1, type: 0, layoutVar: 0, entitiesVar: 0 });
    doc.seal();
    doc.selectFloor(floor);
  });
  const floors = section('Floors', note, rows, add);

  // The rows are rebuilt when the list changes (not while one is edited).
  let shown = '';
  const editRow = (i: number, patch: Partial<QuestFloorAssignment>, key: string) => {
    const list = doc.header.floorAssignments.map((f) => ({ ...f }));
    if (!list[i]) return;
    Object.assign(list[i], patch);
    doc.setHeader({ floorAssignments: list }, `floor:${i}:${key}`);
  };
  const buildRows = () => {
    const list = doc.header.floorAssignments;
    shown = JSON.stringify(list);
    rows.replaceChildren(
      ...list.map((fa, i) => {
        const area = selectField('Area', AREA_OPTIONS, () => fa.area, (v) => editRow(i, { area: v }, 'area'));
        const type = selectField('Source', FLOOR_TYPE_NAMES.map((t, n) => [n, t] as const), () => fa.type, (v) => editRow(i, { type: v }, 'type'));
        const floor = numberField('Floor', () => fa.floor, (v) => editRow(i, { floor: v }, 'floor'), done, { min: 0, max: NUM_QUEST_FLOORS - 1 });
        const layout = numberField('Layout', () => fa.layoutVar, (v) => editRow(i, { layoutVar: v }, 'layout'), done, { min: 0, max: 255 });
        const entities = numberField('Entities', () => fa.entitiesVar, (v) => editRow(i, { entitiesVar: v }, 'entities'), done, { min: 0, max: 255 });
        for (const f of [area, type, floor, layout, entities]) f.refresh();
        const row = h(
          'div',
          { class: `qe-floor-row${fa.floor === doc.floor ? ' current' : ''}` },
          h('div', { class: 'qe-row-head' }, button(`Floor ${fa.floor}`, () => doc.selectFloor(fa.floor), 'link', 'Show this floor in the 3D view'), button('Remove', () => {
            doc.setDesignation(fa.floor, null);
            doc.seal();
          }, 'danger small')),
          h('div', { class: 'qe-grid2' }, area.el, type.el),
          h('div', { class: 'qe-grid3' }, floor.el, layout.el, entities.el),
        );
        return row;
      }),
    );
    if (!list.length) rows.append(h('p', { class: 'qe-hint', text: 'No floor is designated in the header.' }));
  };

  const el = h('div', { class: 'qe-panel' }, props, floors);
  return {
    el,
    refresh() {
      for (const f of fields) f.refresh();
      joinable.checked = doc.header.joinable;
      const c = doc.counts();
      counts.textContent = `${c.enemies} enemies · ${c.npcs} NPCs · ${c.objects} objects · ${c.events} wave events`;
      note.textContent = 'The map and entity set of each floor. "Quest set data" uses the .dat of this quest; the template sources load the free-play entities of that map instead.';
      // Editing inside a row keeps the row as it is; otherwise it is rebuilt.
      const active = document.activeElement;
      if (!(active instanceof HTMLElement && rows.contains(active)) || JSON.stringify(doc.header.floorAssignments) === shown) {
        if (JSON.stringify(doc.header.floorAssignments) !== shown || !rows.childElementCount) buildRows();
      }
      [...rows.querySelectorAll('.qe-floor-row')].forEach((r, i) => r.classList.toggle('current', doc.header.floorAssignments[i]?.floor === doc.floor));
      add.disabled = doc.header.floorAssignments.length >= MAX_FLOOR_ASSIGNMENTS;
    },
  };
}

// Quest editor: the wave events of the current floor (the .evt inside the .dat)
// and the spawn lists they imply: an event's enemies are the e.dat entries with
// the same room and wave number (formats/events.ts).

import type { WaveEvent } from '../formats/events.ts';
import { entityName } from '../formats/setdata.ts';
import { formatActions, parseActionText } from './datcodec.ts';
import { button, h, numberField, section, setValue, type Field } from './dom.ts';
import { createEvent, type QuestDocument } from './model.ts';
import type { Panel } from './panel_props.ts';

export function createEventsPanel(doc: QuestDocument): Panel {
  const done = () => doc.seal();
  const notice = h('p', { class: 'qe-hint' });
  const list = h('div', { class: 'qe-event-list' });
  const waves = h('div', { class: 'qe-wave-list' });
  let events: readonly WaveEvent[] = [];
  let shownFloor = -1;
  let refreshers: Array<() => void> = [];

  const nextId = (): number => {
    const used = new Set(doc.floorEdit(doc.floor).events.map((e) => e.id));
    let id = 1;
    while (used.has(id)) id++;
    return id;
  };
  const addBtn = button('Add event', () => {
    const f = doc.floorEdit(doc.floor);
    if (!f.eventsEditable) return;
    doc.addEvent(doc.floor, createEvent(nextId(), 0, 0));
    doc.seal();
  });

  const spawnText = (ev: WaveEvent): string => {
    const spawns = doc.spawnsOf(doc.floor, ev);
    if (!spawns.length) return 'Spawns nothing: no enemy has this room and wave.';
    const counts = new Map<string, number>();
    for (const e of spawns) {
      const n = entityName(e, doc.areaOf(doc.floor));
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return `Spawns ${spawns.length}: ${[...counts].map(([n, c]) => (c > 1 ? `${c} x ${n}` : n)).join(', ')}`;
  };

  const buildRow = (ev: WaveEvent): HTMLElement => {
    const floor = doc.floor;
    const patch = (p: Parameters<QuestDocument['patchEvent']>[2], key: string) => doc.patchEvent(floor, ev, p, `ev:${ev.index}:${key}`);
    const fields: Field[] = [
      numberField('Event id', () => ev.id, (v) => patch({ id: v }, 'id'), done, { min: 0, max: 0xffffffff }),
      numberField('Type', () => ev.type, (v) => patch({ type: v }, 'type'), done, { min: 0, max: 0xffff }),
      numberField('Room', () => ev.room, (v) => patch({ room: v }, 'room'), done, { min: 0, max: 0xffff }),
      numberField('Wave', () => ev.wave, (v) => patch({ wave: v }, 'wave'), done, { min: 0, max: 0xffff }),
      numberField('Delay (frames)', () => ev.delay, (v) => patch({ delay: v }, 'delay'), done, { min: 0, max: 0xffffffff }),
      numberField('Flags', () => ev.flags ?? 0, (v) => patch({ flags: v }, 'flags'), done, { min: 0, max: 0xffff }),
    ];
    const spawns = h('p', { class: 'qe-hint' });
    const text = h('textarea', { class: 'qe-code', rows: Math.max(3, ev.actions.length + 1), spellcheck: false, 'aria-label': 'Actions run when the wave is cleared' });
    const error = h('p', { class: 'qe-error', hidden: true });
    text.addEventListener('change', () => {
      try {
        const actions = parseActionText(text.value);
        error.hidden = true;
        doc.patchEvent(floor, ev, { actions }, `ev:${ev.index}:actions`);
        doc.seal();
      } catch (err) {
        error.textContent = (err as Error).message;
        error.hidden = false;
      }
    });
    const refresh = () => {
      for (const f of fields) f.refresh();
      spawns.textContent = spawnText(ev);
      setValue(text, formatActions(ev.actions));
    };
    refreshers.push(refresh);
    return h(
      'div',
      { class: 'qe-event' },
      h(
        'div',
        { class: 'qe-row-head' },
        h('strong', { text: `Event ${ev.index}` }),
        button('Select spawns', () => doc.select(doc.spawnsOf(floor, ev)), 'small'),
        button('Delete', () => {
          doc.removeEvent(floor, ev);
          doc.seal();
        }, 'danger small'),
      ),
      h('div', { class: 'qe-grid3' }, ...fields.map((f) => f.el)),
      spawns,
      h('label', { class: 'qe-field' }, h('span', { text: 'Actions when cleared (one per line)' }), text),
      error,
    );
  };

  const buildWaves = () => {
    const f = doc.floors.get(doc.floor);
    const groups = new Map<string, { room: number; wave: number; count: number }>();
    for (const e of f?.enemies ?? []) {
      const k = `${e.section}:${e.wave}`;
      const g = groups.get(k) ?? { room: e.section, wave: e.wave, count: 0 };
      g.count++;
      groups.set(k, g);
    }
    const rows = [...groups.values()].sort((a, b) => a.room - b.room || a.wave - b.wave);
    waves.replaceChildren(
      ...rows.map((g) => {
        const has = (f?.events ?? []).some((e) => e.room === g.room && e.wave === g.wave);
        return h(
          'div',
          { class: `qe-wave-row${has ? '' : ' missing'}` },
          h('span', { text: `Room ${g.room} · wave ${g.wave}: ${g.count} enemies` }),
          h('span', { class: 'tag', text: has ? 'has event' : 'no event' }),
          button('Select', () => doc.select((f?.enemies ?? []).filter((e) => e.section === g.room && e.wave === g.wave)), 'small'),
          !has && f?.eventsEditable
            ? button('Create event', () => {
                doc.addEvent(doc.floor, createEvent(nextId(), g.room, g.wave));
                doc.seal();
              }, 'small')
            : null,
        );
      }),
    );
    if (!rows.length) waves.append(h('p', { class: 'qe-hint', text: 'No enemies on this floor.' }));
  };

  const el = h(
    'div',
    { class: 'qe-panel qe-events' },
    section('Wave events', notice, h('div', { class: 'qe-actions' }, addBtn), list),
    section('Waves of this floor', h('p', { class: 'qe-hint', text: 'Enemies are grouped by room and wave number. A wave that no event starts is not spawned when the room is entered.' }), waves),
  );

  return {
    el,
    refresh() {
      const f = doc.floorEdit(doc.floor);
      const same = shownFloor === doc.floor && events.length === f.events.length && events.every((e, i) => e === f.events[i]);
      if (!same) {
        shownFloor = doc.floor;
        events = [...f.events];
        refreshers = [];
        list.replaceChildren(...events.map(buildRow));
        if (!events.length) list.append(h('p', { class: 'qe-hint', text: 'No wave events on this floor.' }));
      }
      notice.textContent = f.eventsEditable
        ? 'Each event starts the wave of its room when it is triggered (stepping on its trigger object, or another event\'s trigger_event). Reordering is not needed: events are matched by id.'
        : 'This floor uses the random-wave (evt2) event format. It is kept as it is and cannot be edited here.';
      addBtn.disabled = !f.eventsEditable;
      for (const r of refreshers) r();
      buildWaves();
    },
  };
}

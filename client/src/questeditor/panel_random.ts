// Quest editor: the random-wave sections of the current floor (quest .dat types 4
// and 5, and the evt2 wave templates of the events chunk). Shows the locations of
// each room, the enemy definitions and their weights, and the evt2 entries, and
// edits their fields. Layouts: newserv Map.hh (Event2Entry, RandomEnemyRoom,
// RandomEnemyLocation, RandomEnemyDefinition, RandomEnemyWeight); the generator is
// formats/randomenemies.ts. The panel rebuilds only when the floor's shape changes
// (rooms, counts, entries), so typing into a field keeps its focus.

import { RAND_ENEMY_BASE_TYPES } from '../formats/randomenemies.ts';
import { button, h, hex, numberField, section, type Field } from './dom.ts';
import type { QuestDocument } from './model.ts';
import type { Panel } from './panel_props.ts';

const FLOAT_STEP = 0.5;

export function createRandomPanel(doc: QuestDocument): Panel {
  const done = () => doc.seal();
  const body = h('div', { class: 'qe-random-body' });
  let shown = '';
  let fields: Field[] = [];
  let tokens = 0;

  // A number field. Edits typed into the same field in a row share one undo step
  // (the token is unique per field and per build).
  const numeric = (label: string, get: () => number, set: (v: number, token: string) => void, opts: { step?: number; min?: number; max?: number; hex?: boolean } = {}): HTMLElement => {
    const token = `rnd:${tokens++}`;
    const field = numberField(label, get, (v) => set(v, token), done, opts);
    fields.push(field);
    return field.el;
  };

  // The shape decides whether the rows are rebuilt; the values are refreshed in place.
  const shapeOf = (): string => {
    const f = doc.floors.get(doc.floor);
    if (!f) return 'none';
    const r = f.random;
    return JSON.stringify({
      floor: doc.floor,
      rooms: r ? r.rooms.map((x) => [x.roomId, x.count]) : null,
      definitions: r ? r.definitions.length : -1,
      weights: r ? r.weights.length : -1,
      raw: !!f.rawRandom,
      evt2: f.evt2 ? f.evt2.entries.length : -1,
    });
  };

  const current = () => doc.floors.get(doc.floor);

  const evt2Section = (floor: number): HTMLElement => {
    const count = current()?.evt2?.entries.length ?? 0;
    const rows: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const at = () => current()!.evt2!.entries[i];
      const field = (label: string, key: 'eventId' | 'eventType' | 'room' | 'waveNumber' | 'minDelay' | 'maxDelay' | 'minEnemies' | 'maxEnemies' | 'maxWaves', opts: { min?: number; max?: number; hex?: boolean } = {}) =>
        numeric(label, () => at()[key], (v, token) => doc.setEvt2Entry(floor, i, { [key]: v }, `${token}:${i}`), opts);
      rows.push(
        h(
          'div',
          { class: 'qe-random-row' },
          h('strong', { text: `Entry ${i}` }),
          h(
            'div',
            { class: 'qe-grid3' },
            field('Event id', 'eventId', { hex: true, min: 0, max: 0xffffffff }),
            field('Type', 'eventType', { min: 0, max: 65535 }),
            field('Room', 'room', { min: 0, max: 65535 }),
            field('Wave', 'waveNumber', { min: 0, max: 65535 }),
            field('Min delay', 'minDelay', { min: 0, max: 65535 }),
            field('Max delay', 'maxDelay', { min: 0, max: 65535 }),
            field('Min enemies', 'minEnemies', { min: 0, max: 255 }),
            field('Max enemies', 'maxEnemies', { min: 0, max: 255 }),
            field('Waves', 'maxWaves', { min: 0, max: 65535 }),
          ),
        ),
      );
    }
    return section(
      'Random-wave events (evt2)',
      h('p', { class: 'qe-hint', text: 'Each entry is a template: it runs 1 to "Waves" waves, each with a random number of enemies between "Min" and "Max", placed at random by the sections below.' }),
      ...rows,
    );
  };

  const locationsSection = (floor: number): HTMLElement => {
    const blocks: HTMLElement[] = [];
    const rooms = current()?.random?.rooms ?? [];
    let start = 0;
    for (const room of rooms) {
      const rows: HTMLElement[] = [];
      for (let j = 0; j < room.count; j++) {
        const idx = start + j;
        const at = () => current()!.random!.locations[idx];
        const axis = (label: string, key: 'pos' | 'angle', k: number, step: number) =>
          numeric(
            label,
            () => at()[key][k],
            (v, token) => {
              const next = [...at()[key]] as [number, number, number];
              next[k] = v;
              doc.setRandomLocation(floor, idx, { [key]: next }, `${token}:${idx}`);
            },
            { step },
          );
        rows.push(
          h(
            'div',
            { class: 'qe-random-row' },
            h('span', { class: 'tag', text: `#${idx}` }),
            h(
              'div',
              { class: 'qe-grid3' },
              axis('X', 'pos', 0, FLOAT_STEP),
              axis('Y', 'pos', 1, FLOAT_STEP),
              axis('Z', 'pos', 2, FLOAT_STEP),
              axis('Angle X', 'angle', 0, 1),
              axis('Angle Y', 'angle', 1, 1),
              axis('Angle Z', 'angle', 2, 1),
            ),
            button(
              'Delete',
              () => {
                doc.removeRandomLocation(floor, idx);
                doc.seal();
              },
              'danger small',
            ),
          ),
        );
      }
      const lastIndex = start + room.count - 1;
      blocks.push(
        h(
          'div',
          { class: 'qe-random-room' },
          h('strong', { text: `Room ${hex(room.roomId)} · ${room.count} location${room.count === 1 ? '' : 's'}` }),
          ...rows,
          button(
            'Add location',
            () => {
              const last = room.count > 0 ? current()!.random!.locations[lastIndex] : null;
              doc.addRandomLocation(floor, room.roomId, {
                pos: last ? [...last.pos] : [0, 0, 0],
                angle: [0, 0, 0],
                unknownA9: 0,
                unknownA10: 0,
              });
              doc.seal();
            },
            'small',
          ),
        ),
      );
      start += room.count;
    }
    return section(
      'Random enemy locations (type 4)',
      h('p', { class: 'qe-hint', text: "Each room lists the places its random enemies can appear. Each enemy takes a location at random from its room's list when the wave is built." }),
      ...(blocks.length ? blocks : [h('p', { class: 'qe-hint', text: 'No rooms.' })]),
    );
  };

  const definitionsSection = (floor: number): HTMLElement => {
    const count = current()?.random?.definitions.length ?? 0;
    const rows: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const at = () => current()!.random!.definitions[i];
      const param = (k: number) =>
        numeric(
          `Param ${k + 1}`,
          () => at().params[k],
          (v, token) => {
            const next = [...at().params] as [number, number, number, number, number];
            next[k] = v;
            doc.setRandomDefinition(floor, i, { params: next }, `${token}:${i}`);
          },
          { step: FLOAT_STEP },
        );
      const int = (label: string, key: 'param6' | 'param7' | 'minChildren' | 'maxChildren', min: number, max: number) =>
        numeric(label, () => at()[key], (v, token) => doc.setRandomDefinition(floor, i, { [key]: v }, `${token}:${i}`), { min, max });
      rows.push(
        h(
          'div',
          { class: 'qe-random-row' },
          h('strong', { text: `Definition ${i}` }),
          h('span', { class: 'tag', text: `entry ${at().entryIndex}` }),
          h(
            'div',
            { class: 'qe-grid3' },
            param(0),
            param(1),
            param(2),
            param(3),
            param(4),
            int('Param 6', 'param6', -32768, 32767),
            int('Param 7', 'param7', -32768, 32767),
            int('Min children', 'minChildren', 0, 65535),
            int('Max children', 'maxChildren', 0, 65535),
          ),
        ),
      );
    }
    return section(
      'Random enemy definitions (type 5)',
      h('p', { class: 'qe-hint', text: 'Each definition is an enemy the random waves can place: its parameters and how many children it brings. The weights below pick between them.' }),
      ...(rows.length ? rows : [h('p', { class: 'qe-hint', text: 'No definitions.' })]),
    );
  };

  const weightsSection = (floor: number): HTMLElement => {
    const count = current()?.random?.weights.length ?? 0;
    const rows: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const at = () => current()!.random!.weights[i];
      const int = (label: string, key: 'baseTypeIndex' | 'defEntryIndex' | 'weight') =>
        numeric(label, () => at()[key], (v, token) => doc.setRandomWeight(floor, i, { [key]: v }, `${token}:${i}`), { min: 0, max: 255 });
      rows.push(
        h(
          'div',
          { class: 'qe-random-row' },
          h('strong', { text: `Weight ${i}` }),
          h('span', { class: 'tag', text: `base type 0x${(RAND_ENEMY_BASE_TYPES[at().baseTypeIndex] ?? 0).toString(16)}` }),
          h('div', { class: 'qe-grid3' }, int('Base type index', 'baseTypeIndex'), int('Definition', 'defEntryIndex'), int('Weight', 'weight')),
        ),
      );
    }
    return section(
      'Random enemy weights (type 5)',
      h('p', { class: 'qe-hint', text: 'A weight of 0 never picks its definition. The enemy kind is chosen among all weights in proportion.' }),
      ...(rows.length ? rows : [h('p', { class: 'qe-hint', text: 'No weights.' })]),
    );
  };

  const build = () => {
    fields = [];
    const f = current();
    if (!f || (!f.random && !f.rawRandom && !f.evt2)) {
      body.replaceChildren(h('p', { class: 'qe-hint', text: 'This floor has no random-wave sections (quest .dat types 4 and 5, and the evt2 events).' }));
      return;
    }
    const nodes: HTMLElement[] = [];
    if (f.evt2) nodes.push(evt2Section(doc.floor));
    if (f.random) nodes.push(locationsSection(doc.floor), definitionsSection(doc.floor), weightsSection(doc.floor));
    else if (f.rawRandom) nodes.push(section('Random enemy sections', h('p', { class: 'qe-hint', text: 'Types 4 and 5 are kept as the file has them: they do not parse as a pair, so they cannot be edited here.' })));
    body.replaceChildren(...nodes);
  };

  const el = h('div', { class: 'qe-panel qe-random' }, body);

  return {
    el,
    refresh() {
      const key = shapeOf();
      if (key !== shown) {
        shown = key;
        build();
      }
      for (const f of fields) f.refresh();
    },
  };
}

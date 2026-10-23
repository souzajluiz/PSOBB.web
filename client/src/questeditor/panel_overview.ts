// Quest editor: the overview panel. Every designated floor with its counts (click
// to show it in the 3D view), and the rooms of the current floor with previous /
// next navigation (selects the room's entities and frames them).

import { button, h, section } from './dom.ts';
import { adjacentRoom, floorSummaries, roomEntities, roomSummaries, type FloorSummary, type RoomSummary } from './overview.ts';
import { areaName } from './areas.ts';
import type { QuestDocument } from './model.ts';
import type { Panel } from './panel_props.ts';

export interface OverviewHost {
  frame(): void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function countsText(s: { enemies: number; npcs: number; objects: number }, events?: number): string {
  const parts = [plural(s.enemies, 'enemy', 'enemies'), plural(s.npcs, 'NPC'), plural(s.objects, 'object')];
  if (events !== undefined) parts.push(plural(events, 'wave event'));
  return parts.join(', ');
}

export function createOverviewPanel(doc: QuestDocument, host: OverviewHost): Panel {
  const floorsBox = h('div', { class: 'qe-overview-rows', role: 'list' });
  const roomsBox = h('div', { class: 'qe-overview-rows', role: 'list' });
  const roomNote = h('p', { class: 'qe-hint' });
  let rooms: RoomSummary[] = [];
  let currentRoom: number | null = null;
  let shownFloor = -1;

  const showRoom = (room: number) => {
    currentRoom = room;
    doc.select(roomEntities(doc, doc.floor, room));
    host.frame();
    roomRows();
  };
  const step = (dir: 1 | -1) => {
    const r = adjacentRoom(rooms, currentRoom, dir);
    if (r) showRoom(r.room);
  };
  const prev = button('Previous room', () => step(-1), 'small', 'Select the entities of the previous room and frame them');
  const next = button('Next room', () => step(1), 'small', 'Select the entities of the next room and frame them');

  const roomRows = () => {
    prev.disabled = next.disabled = rooms.length === 0;
    roomsBox.replaceChildren(
      ...rooms.map((r: RoomSummary) =>
        h(
          'div',
          { class: `qe-overview-row${r.room === currentRoom ? ' current' : ''}`, role: 'listitem' },
          button(`Room ${r.room}`, () => showRoom(r.room), 'link', 'Select the entities of this room and frame them'),
          h('span', { class: 'detail', text: countsText(r) }),
        ),
      ),
    );
    roomNote.textContent = rooms.length ? `${plural(rooms.length, 'room')} with entities on this floor.` : 'No entities on this floor.';
  };

  const floorRows = (floors: FloorSummary[]) => {
    floorsBox.replaceChildren(
      ...floors.map((s: FloorSummary) =>
        h(
          'div',
          { class: `qe-overview-row${s.floor === doc.floor ? ' current' : ''}`, role: 'listitem' },
          button(`Floor ${s.floor}`, () => doc.selectFloor(s.floor), 'link', 'Show this floor in the 3D view'),
          h('span', { class: 'detail', text: `${s.area === null ? 'no area' : areaName(s.area)} · ${countsText(s, s.events)}` }),
        ),
      ),
    );
    if (!floors.length) floorsBox.append(h('p', { class: 'qe-hint', text: 'No floor is designated.' }));
  };

  const el = h(
    'div',
    { class: 'qe-panel' },
    section('Floors overview', h('p', { class: 'qe-hint', text: 'Entities and wave events of each designated floor (* in the floor list is designated).' }), floorsBox),
    section('Rooms of this floor', h('div', { class: 'qe-actions' }, prev, next), roomNote, roomsBox),
  );

  return {
    el,
    refresh() {
      if (doc.floor !== shownFloor) {
        shownFloor = doc.floor;
        currentRoom = null;
      }
      floorRows(floorSummaries(doc));
      rooms = roomSummaries(doc, doc.floor);
      if (currentRoom !== null && !rooms.some((r) => r.room === currentRoom)) currentRoom = null;
      roomRows();
    },
  };
}

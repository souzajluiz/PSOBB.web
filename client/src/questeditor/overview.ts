// Quest editor: the multi-floor overview and the room navigation of a floor.
// Pure functions over the document (no DOM), so the counts are tested directly.

import type { SetEntity } from '../formats/setdata.ts';
import type { QuestDocument } from './model.ts';

export interface FloorSummary {
  floor: number;
  area: number | null;
  enemies: number;
  npcs: number;
  objects: number;
  events: number;
}

// Every designated floor (and every floor that holds data), ascending, with the
// counts of its entities and wave events.
export function floorSummaries(doc: QuestDocument): FloorSummary[] {
  return doc.designatedFloors().map((floor) => {
    const s: FloorSummary = { floor, area: doc.areaOf(floor), enemies: 0, npcs: 0, objects: 0, events: doc.floors.get(floor)?.events.length ?? 0 };
    for (const e of doc.entitiesOf(floor)) {
      if (e.kind === 'object') s.objects++;
      else if (doc.isNpc(e, floor)) s.npcs++;
      else s.enemies++;
    }
    return s;
  });
}

export interface RoomSummary {
  room: number; // the entity's section ("room" in newserv), the id of the map's n.rel section
  enemies: number;
  npcs: number;
  objects: number;
}

// The rooms of a floor that hold entities, ascending by room id.
export function roomSummaries(doc: QuestDocument, floor: number): RoomSummary[] {
  const byRoom = new Map<number, RoomSummary>();
  for (const e of doc.entitiesOf(floor)) {
    const r = byRoom.get(e.section) ?? { room: e.section, enemies: 0, npcs: 0, objects: 0 };
    if (e.kind === 'object') r.objects++;
    else if (doc.isNpc(e, floor)) r.npcs++;
    else r.enemies++;
    byRoom.set(e.section, r);
  }
  return [...byRoom.values()].sort((a, b) => a.room - b.room);
}

// The entities of one room of a floor.
export function roomEntities(doc: QuestDocument, floor: number, room: number): SetEntity[] {
  return doc.entitiesOf(floor).filter((e) => e.section === room);
}

// The room after (dir = 1) or before (dir = -1) `current` in the floor's room list,
// wrapping around. With no current room, the first (dir = 1) or the last one.
export function adjacentRoom(rooms: readonly RoomSummary[], current: number | null, dir: 1 | -1): RoomSummary | null {
  if (!rooms.length) return null;
  const at = current === null ? -1 : rooms.findIndex((r) => r.room === current);
  if (at < 0) return dir > 0 ? rooms[0] : rooms[rooms.length - 1];
  return rooms[(at + dir + rooms.length) % rooms.length];
}

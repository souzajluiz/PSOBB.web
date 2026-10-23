// Quest editor: the document. A quest being edited: the .bin (header fields,
// floor assignments, the script bytes), the .dat per floor (objects, enemies,
// wave events) as editable lists, the selection and the undo / redo history.
// Plain TypeScript, no DOM or three.js: the panels and the 3D view subscribe
// with onChange() and call the methods below, and every edit goes through the
// history.
//
// What an edit leaves consistent: the QuestBin is rebuilt from its bytes after
// each header edit (binhead.ts), and toQuestDat() writes the lists to bytes and
// parses them again, so the QuestBin / QuestDat objects handed to the writer
// (formats/questwrite.ts) always agree with the bytes.

import { questEpisode, type QuestBin, type QuestFloorAssignment } from '../formats/questbin.ts';
import { parseQuestDat, QuestDatChunkType, type QuestDat, type QuestDatFloor } from '../formats/questdat.ts';
import { isEvt2, parseEvt2File, serializeEvt2File, type Event2Entry, type WaveEvent } from '../formats/events.ts';
import { ENEMY_SET_SIZE, enemyKind, OBJECT_SET_SIZE, type EnemySet, type ObjectSet, type SetEntity } from '../formats/setdata.ts';
import {
  parseRandomEnemySections,
  serializeRandomDefinitions,
  serializeRandomLocations,
  type RandomEnemyDefinition,
  type RandomEnemyLocation,
  type RandomEnemyRoom,
  type RandomEnemyWeight,
} from '../formats/randomenemies.ts';
import { floorToArea, gameEpisode, MAX_AREA, NUM_QUEST_FLOORS } from './areas.ts';
import { applyHeader, newQuestBin, type EditableHeader, type NewQuestOptions } from './binhead.ts';
import { buildQuestDatBytes, serializeEvents, type ChunkSlot, type DatFloorContent, type RawChunk } from './datcodec.ts';
import { History, type Command } from './history.ts';

export type ChangeKind =
  | 'document' // a new document was loaded: rebuild everything
  | 'header' // quest properties changed
  | 'bin' // the .bin was replaced (script applied) or its floor assignments changed
  | 'floor' // the current floor changed
  | 'entities' // entities were added or removed on `floor`
  | 'fields' // fields of `entities` changed
  | 'events' // wave events of `floor` changed
  | 'random' // random-wave sections (types 4 / 5) or evt2 entries of `floor` changed
  | 'selection'
  | 'history';

export interface Change {
  kind: ChangeKind;
  floor?: number;
  entities?: readonly SetEntity[];
}

// The random-wave sections of a floor (quest .dat types 4 and 5, newserv
// Map.hh RandomEnemyLocationsHeader / RandomEnemyDefinitionsHeader) as lists.
// `locations` are in room order, the order the room table's offsets count.
export interface RandomWaveSections {
  rooms: RandomEnemyRoom[];
  locations: RandomEnemyLocation[];
  definitions: RandomEnemyDefinition[];
  weights: RandomEnemyWeight[];
  hasLocations: boolean; // a type 4 chunk is written
  hasDefinitions: boolean; // a type 5 chunk is written
}

// The bytes the two random sections had when the file was read, and the key of
// their lists at that time: unchanged lists are written back as these bytes.
export interface RawRandomWave {
  locations: Uint8Array | null;
  definitions: Uint8Array | null;
  key: string;
}

export interface Evt2Section {
  entries: Event2Entry[];
  actionStream: Uint8Array;
}

export interface FloorEdit {
  floor: number;
  objects: ObjectSet[];
  enemies: EnemySet[];
  events: WaveEvent[];
  // The event chunk cannot be edited as wave events when it is in the 'evt2'
  // (random wave) format or does not parse; its bytes are then written back as
  // they were, unless the evt2 entries are edited (`evt2`, see setEvt2Entry).
  eventsEditable: boolean;
  rawEvents: Uint8Array | null; // the event chunk's bytes as read
  rawEventsKey: string; // eventsKey() at read time: unchanged events are written as rawEvents
  hasEventChunk: boolean; // write an event chunk even when the list is empty
  evt2: Evt2Section | null; // the random-wave events, when the chunk is in evt2 format
  random: RandomWaveSections | null; // both random sections parsed; null when they are not (or not both there)
  rawRandom: RawRandomWave | null; // the random sections' bytes as read
  extra: RawChunk[]; // unknown chunk types, untouched
}

// The state of a floor's events that decides whether its bytes are reused.
function eventsKey(f: FloorEdit): string {
  if (f.evt2) return JSON.stringify(f.evt2.entries);
  return JSON.stringify(f.events.map((e) => ({ ...e, index: 0 })));
}

function randomKey(r: RandomWaveSections): string {
  return JSON.stringify(r);
}

function cloneRandom(r: RandomWaveSections | null): RandomWaveSections | null {
  return r ? structuredClone(r) : null;
}

function cloneEvt2(s: Evt2Section | null): Evt2Section | null {
  return s ? { entries: s.entries.map((e) => ({ ...e })), actionStream: s.actionStream.slice() } : null;
}

// What a random-wave edit changes on a floor, as copies of the state before and after.
interface RandomSnapshot {
  random: RandomWaveSections | null;
  evt2: Evt2Section | null;
}
interface RandomSpan {
  from: RandomSnapshot;
  to: RandomSnapshot;
}

type Fields = Record<string, unknown>;
interface PatchItem {
  target: object;
  before: Fields;
  after: Fields;
}
interface ModelCommand extends Command {
  changes: Change[];
  items?: PatchItem[];
  bins?: { before: QuestBin; after: QuestBin };
}

const clone = <T>(v: T): T => (Array.isArray(v) ? (v.map(clone) as unknown as T) : v && typeof v === 'object' ? ({ ...v } as T) : v);

function applyFields(target: object, fields: Fields): void {
  for (const k of Object.keys(fields)) (target as Fields)[k] = clone(fields[k]);
}

const sameItems = (a: PatchItem[], b: PatchItem[]): boolean =>
  a.length === b.length && a.every((x, i) => x.target === b[i].target && Object.keys(x.after).join() === Object.keys(b[i].after).join());

export type EntityPatch = Partial<{
  type: number;
  section: number;
  position: [number, number, number];
  rotation: [number, number, number];
  group: number;
  unknownA3: number;
  numChildren: number;
  wave: number;
  wave2: number;
  unknownA1: number;
  params: number[];
}>;
export type EventPatch = Partial<Pick<WaveEvent, 'id' | 'type' | 'room' | 'wave' | 'delay' | 'flags' | 'actions'>>;

export function createObject(type: number, floor: number, section: number, position: [number, number, number] = [0, 0, 0]): ObjectSet {
  return { kind: 'object', index: 0, type, floor, section, position, rotation: [0, 0, 0], group: 0, unknownA3: 0, params: [0, 0, 0, 0, 0, 0] };
}

export function createEnemy(type: number, floor: number, section: number, position: [number, number, number] = [0, 0, 0]): EnemySet {
  return { kind: 'enemy', index: 0, type, floor, section, position, rotation: [0, 0, 0], numChildren: 0, wave: 0, wave2: 0, unknownA1: 0, params: [0, 0, 0, 0, 0, 0, 0] };
}

export function createEvent(id: number, room: number, wave: number): WaveEvent {
  return { index: 0, id, flags: 0, type: 1, room, wave, delay: 0, actionOffset: 0, actions: [{ op: 'constructEnemies', room, wave, stop: false }, { op: 'stop' }] };
}

export interface QuestCounts {
  enemies: number;
  npcs: number;
  objects: number;
  events: number;
}

export class QuestDocument {
  bin: QuestBin;
  readonly floors = new Map<number, FloorEdit>();
  readonly history = new History<ModelCommand>();
  fileName = 'quest';
  warnings: string[] = [];
  layout: ChunkSlot[] = []; // the .dat's chunks in file order (buildQuestDatBytes keeps it)
  private current = 0;
  private selected: SetEntity[] = [];
  private listeners = new Set<(c: Change) => void>();

  constructor(bin: QuestBin) {
    this.bin = bin;
  }

  // --- Loading ----------------------------------------------------------------

  static fromQuest(bin: QuestBin, dat: QuestDat | null, fileName = 'quest'): QuestDocument {
    const doc = new QuestDocument(bin);
    doc.fileName = fileName;
    if (dat) {
      doc.warnings = [...dat.warnings];
      doc.layout = dat.chunks.map((c) => ({ type: c.type, floor: c.floor }));
      for (const f of dat.floors.values()) loadFloor(doc.floorEdit(f.floor), f);
      for (const c of dat.chunks) {
        if (KNOWN_CHUNK_TYPES.has(c.type)) continue;
        doc.floorEdit(c.floor).extra.push({ type: c.type, data: c.data.slice() });
      }
    }
    for (const f of doc.floors.values()) {
      reindex(f);
      f.rawEventsKey = eventsKey(f);
    }
    doc.current = doc.designatedFloors()[0] ?? 0;
    return doc;
  }

  static blank(opts: NewQuestOptions = {}): QuestDocument {
    const bin = newQuestBin(opts);
    const doc = QuestDocument.fromQuest(bin, null, 'new-quest');
    const first = bin.header.floorAssignments[0]?.floor ?? 1;
    // The player spawn point (TObjPlayerSet) of the first floor.
    doc.floorEdit(first).objects.push(createObject(0, first, 0));
    for (const f of doc.floors.values()) reindex(f);
    doc.current = first;
    return doc;
  }

  // --- Observers ---------------------------------------------------------------

  onChange(fn: (c: Change) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(c: Change): void {
    for (const fn of this.listeners) fn(c);
  }

  private emitAll(changes: Change[]): void {
    for (const c of changes) this.emit(c);
    this.emit({ kind: 'history' });
  }

  // Runs a command through the history and tells the observers.
  private exec(cmd: ModelCommand): void {
    this.history.run(cmd);
    this.prune();
    this.emitAll(cmd.changes);
  }

  // --- Queries ----------------------------------------------------------------

  get header(): QuestBin['header'] {
    return this.bin.header;
  }

  // The game's episode number (1, 2 or 3 for Episode 4), the one the model tables use.
  get episode(): number {
    return gameEpisode(this.bin.header.episode);
  }

  get questEpisodeNumber(): number {
    return questEpisode(this.bin.header);
  }

  get floor(): number {
    return this.current;
  }

  designation(floor: number): QuestFloorAssignment | null {
    return this.bin.header.floorAssignments.find((f) => f.floor === floor) ?? null;
  }

  // The area a floor shows: the designation's, else the episode's default.
  areaOf(floor: number): number | null {
    const d = this.designation(floor);
    if (d && d.area <= MAX_AREA) return d.area;
    const a = floorToArea(this.episode)[floor];
    return a !== undefined && a >= 0 ? a : null;
  }

  // Floors that are designated or hold data, ascending.
  designatedFloors(): number[] {
    const set = new Set<number>();
    for (const fa of this.bin.header.floorAssignments) set.add(fa.floor);
    for (const [n, f] of this.floors) if (f.objects.length || f.enemies.length || f.events.length || f.rawEvents) set.add(n);
    return [...set].filter((n) => n < NUM_QUEST_FLOORS).sort((a, b) => a - b);
  }

  floorEdit(floor: number): FloorEdit {
    let f = this.floors.get(floor);
    if (!f) {
      f = {
        floor,
        objects: [],
        enemies: [],
        events: [],
        eventsEditable: true,
        rawEvents: null,
        rawEventsKey: '',
        hasEventChunk: false,
        evt2: null,
        random: null,
        rawRandom: null,
        extra: [],
      };
      this.floors.set(floor, f);
    }
    return f;
  }

  entitiesOf(floor: number): SetEntity[] {
    const f = this.floors.get(floor);
    return f ? [...f.objects, ...f.enemies] : [];
  }

  floorOf(entity: SetEntity): number {
    return entity.floor;
  }

  isNpc(e: SetEntity, floor = e.floor): boolean {
    return e.kind === 'enemy' && enemyKind(e, this.areaOf(floor)) === 'NON_ENEMY_NPC';
  }

  counts(): QuestCounts {
    const c: QuestCounts = { enemies: 0, npcs: 0, objects: 0, events: 0 };
    for (const f of this.floors.values()) {
      c.objects += f.objects.length;
      c.events += f.events.length;
      for (const e of f.enemies) if (this.isNpc(e, f.floor)) c.npcs++;
      else c.enemies++;
    }
    return c;
  }

  // The e.dat entries a wave event spawns: the enemies of its room and wave.
  spawnsOf(floor: number, ev: Pick<WaveEvent, 'room' | 'wave'>): EnemySet[] {
    return (this.floors.get(floor)?.enemies ?? []).filter((e) => e.section === ev.room && e.wave === ev.wave);
  }

  // --- Selection ---------------------------------------------------------------

  get selection(): readonly SetEntity[] {
    return this.selected;
  }

  isSelected(e: SetEntity): boolean {
    return this.selected.includes(e);
  }

  select(entities: readonly SetEntity[], mode: 'set' | 'add' | 'toggle' = 'set'): void {
    let next: SetEntity[];
    if (mode === 'set') next = [...entities];
    else if (mode === 'add') next = [...this.selected, ...entities.filter((e) => !this.selected.includes(e))];
    else {
      next = this.selected.filter((e) => !entities.includes(e));
      for (const e of entities) if (!this.selected.includes(e)) next.push(e);
    }
    if (next.length === this.selected.length && next.every((e, i) => e === this.selected[i])) return;
    this.selected = next;
    this.emit({ kind: 'selection' });
  }

  clearSelection(): void {
    this.select([]);
  }

  selectFloor(floor: number): void {
    if (floor === this.current) return;
    this.current = floor;
    this.selected = [];
    this.emit({ kind: 'floor', floor });
    this.emit({ kind: 'selection' });
  }

  // Drops selected entities that no longer exist (after an undo).
  private prune(): void {
    const live = this.selected.filter((e) => {
      const f = this.floors.get(e.floor);
      return !!f && (e.kind === 'object' ? f.objects.includes(e) : f.enemies.includes(e));
    });
    if (live.length !== this.selected.length) {
      this.selected = live;
      this.emit({ kind: 'selection' });
    }
  }

  // --- History ------------------------------------------------------------------

  undo(): boolean {
    const cmd = this.history.undo();
    if (!cmd) return false;
    this.prune();
    this.emitAll(cmd.changes);
    return true;
  }

  redo(): boolean {
    const cmd = this.history.redo();
    if (!cmd) return false;
    this.prune();
    this.emitAll(cmd.changes);
    return true;
  }

  // Ends a run of mergeable edits (a drag, typing in a field).
  seal(): void {
    this.history.seal();
  }

  get dirty(): boolean {
    return this.history.dirty;
  }

  markSaved(): void {
    this.history.markClean();
    this.emit({ kind: 'history' });
  }

  // --- Header and script ----------------------------------------------------------

  setHeader(patch: Partial<EditableHeader>, mergeKey?: string): void {
    const before = this.bin;
    const after = applyHeader(before, patch);
    const kind: ChangeKind = patch.floorAssignments ? 'bin' : 'header';
    const make = (b: QuestBin, a: QuestBin): ModelCommand => ({
      label: 'Edit quest properties',
      redo: () => (this.bin = a),
      undo: () => (this.bin = b),
      changes: [{ kind }, { kind: 'header' }],
      bins: { before: b, after: a },
      ...(mergeKey !== undefined
        ? {
            mergeKey,
            merge: (next: Command) => {
              const n = next as ModelCommand;
              return n.bins ? make(b, n.bins.after) : null;
            },
          }
        : {}),
    });
    this.exec(make(before, after));
  }

  // The script was assembled: replace the whole .bin.
  setBin(bin: QuestBin, label = 'Apply script'): void {
    const before = this.bin;
    this.exec({ label, redo: () => (this.bin = bin), undo: () => (this.bin = before), changes: [{ kind: 'bin' }, { kind: 'header' }] });
  }

  // Sets or clears the designation of one floor (map_designate in the header).
  setDesignation(floor: number, fa: Omit<QuestFloorAssignment, 'floor'> | null): void {
    const list = this.bin.header.floorAssignments.filter((f) => f.floor !== floor).map((f) => ({ ...f }));
    if (fa) list.push({ floor, ...fa });
    list.sort((a, b) => a.floor - b.floor);
    this.setHeader({ floorAssignments: list });
  }

  // --- Entities ---------------------------------------------------------------------

  addEntities(floor: number, list: readonly SetEntity[], label = 'Add entities'): void {
    if (!list.length) return;
    const fe = this.floorEdit(floor);
    const added = list.map((e) => ({ ...e, floor }) as SetEntity);
    const target = (e: SetEntity) => (e.kind === 'object' ? fe.objects : fe.enemies);
    this.exec({
      label,
      redo: () => {
        for (const e of added) (target(e) as SetEntity[]).push(e);
        reindex(fe);
      },
      undo: () => {
        for (const e of added) {
          const arr = target(e) as SetEntity[];
          const i = arr.indexOf(e);
          if (i >= 0) arr.splice(i, 1);
        }
        reindex(fe);
      },
      changes: [{ kind: 'entities', floor }],
    });
    this.select(added);
  }

  addEntity<T extends SetEntity>(floor: number, e: T, label?: string): T {
    this.addEntities(floor, [e], label ?? 'Add entity');
    return this.selected[0] as T;
  }

  removeEntities(list: readonly SetEntity[]): void {
    if (!list.length) return;
    const byFloor = new Map<number, SetEntity[]>();
    for (const e of list) (byFloor.get(e.floor) ?? byFloor.set(e.floor, []).get(e.floor)!).push(e);
    // Remember where each one stood so undo puts it back in the same place.
    const records = [...byFloor].map(([floor, ents]) => {
      const fe = this.floorEdit(floor);
      return {
        floor,
        fe,
        removed: ents
          .map((e) => ({ e, at: ((e.kind === 'object' ? fe.objects : fe.enemies) as SetEntity[]).indexOf(e) }))
          .filter((r) => r.at >= 0)
          .sort((a, b) => a.at - b.at),
      };
    });
    this.exec({
      label: list.length === 1 ? 'Delete entity' : `Delete ${list.length} entities`,
      redo: () => {
        for (const r of records) {
          for (const { e } of r.removed) {
            const arr = (e.kind === 'object' ? r.fe.objects : r.fe.enemies) as SetEntity[];
            const i = arr.indexOf(e);
            if (i >= 0) arr.splice(i, 1);
          }
          reindex(r.fe);
        }
      },
      undo: () => {
        for (const r of records) {
          for (const { e, at } of r.removed) ((e.kind === 'object' ? r.fe.objects : r.fe.enemies) as SetEntity[]).splice(at, 0, e);
          reindex(r.fe);
        }
      },
      changes: records.map((r) => ({ kind: 'entities' as const, floor: r.floor })),
    });
  }

  deleteSelection(): void {
    this.removeEntities([...this.selected]);
  }

  // Copies of the selected entities, shifted by `offset` (local units), and selected.
  duplicateSelection(offset: [number, number, number] = [10, 0, 10]): void {
    const byFloor = new Map<number, SetEntity[]>();
    for (const e of this.selected) {
      const copy = cloneEntity(e);
      copy.position = [e.position[0] + offset[0], e.position[1] + offset[1], e.position[2] + offset[2]];
      (byFloor.get(e.floor) ?? byFloor.set(e.floor, []).get(e.floor)!).push(copy);
    }
    for (const [floor, list] of byFloor) this.addEntities(floor, list, 'Duplicate');
  }

  // Changes fields of several entities as one history entry. Edits with the same
  // mergeKey on the same entities and fields fold together until seal().
  patchEntities(pairs: ReadonlyArray<readonly [SetEntity, EntityPatch]>, label = 'Edit entity', mergeKey?: string): void {
    const items: PatchItem[] = pairs.map(([target, patch]) => {
      const before: Fields = {};
      const after: Fields = {};
      for (const k of Object.keys(patch)) {
        before[k] = clone((target as unknown as Fields)[k]);
        after[k] = clone((patch as Fields)[k]);
      }
      return { target, before, after };
    });
    this.exec(this.patchCommand(label, items, mergeKey, [{ kind: 'fields', entities: pairs.map((p) => p[0]) }]));
  }

  patchEntity(e: SetEntity, patch: EntityPatch, mergeKey?: string, label?: string): void {
    this.patchEntities([[e, patch]], label ?? 'Edit entity', mergeKey);
  }

  private patchCommand(label: string, items: PatchItem[], mergeKey: string | undefined, changes: Change[]): ModelCommand {
    const make = (its: PatchItem[]): ModelCommand => ({
      label,
      items: its,
      changes,
      redo: () => its.forEach((it) => applyFields(it.target, it.after)),
      undo: () => its.forEach((it) => applyFields(it.target, it.before)),
      ...(mergeKey !== undefined
        ? {
            mergeKey,
            merge: (next: Command) => {
              const n = next as ModelCommand;
              if (!n.items || !sameItems(its, n.items)) return null;
              return make(its.map((it, i) => ({ target: it.target, before: it.before, after: n.items![i].after })));
            },
          }
        : {}),
    });
    return make(items);
  }

  // --- Wave events ----------------------------------------------------------------------

  addEvent(floor: number, ev: WaveEvent): WaveEvent {
    const fe = this.floorEdit(floor);
    if (!fe.eventsEditable) throw new Error('this floor uses the random-wave (evt2) event format, which the editor cannot change');
    const added = { ...ev, actions: ev.actions.map((a) => ({ ...a })) };
    this.exec({
      label: 'Add wave event',
      redo: () => {
        fe.events.push(added);
        fe.hasEventChunk = true;
        reindexEvents(fe);
      },
      undo: () => {
        fe.events.splice(fe.events.indexOf(added), 1);
        reindexEvents(fe);
      },
      changes: [{ kind: 'events', floor }],
    });
    return added;
  }

  removeEvent(floor: number, ev: WaveEvent): void {
    const fe = this.floorEdit(floor);
    const at = fe.events.indexOf(ev);
    if (at < 0 || !fe.eventsEditable) return;
    this.exec({
      label: 'Delete wave event',
      redo: () => {
        fe.events.splice(fe.events.indexOf(ev), 1);
        reindexEvents(fe);
      },
      undo: () => {
        fe.events.splice(at, 0, ev);
        reindexEvents(fe);
      },
      changes: [{ kind: 'events', floor }],
    });
  }

  patchEvent(floor: number, ev: WaveEvent, patch: EventPatch, mergeKey?: string): void {
    const before: Fields = {};
    const after: Fields = {};
    for (const k of Object.keys(patch)) {
      before[k] = clone((ev as unknown as Fields)[k]);
      after[k] = clone((patch as Fields)[k]);
    }
    this.exec(this.patchCommand('Edit wave event', [{ target: ev, before, after }], mergeKey, [{ kind: 'events', floor }]));
  }

  // --- Output ----------------------------------------------------------------------------

  // --- Random-wave sections and evt2 entries ---------------------------------------------

  // Edits of a floor's random sections and evt2 entries share one command: the
  // floor's state before and after is kept as a copy, so undo and redo restore it.
  // The commands with a mergeKey fold together (a number field typed into
  // several times is one undo step), as patchEvent's do.
  private randomEdit(floor: number, label: string, edit: (fe: FloorEdit) => void, mergeKey?: string): void {
    const fe = this.floorEdit(floor);
    const from: RandomSnapshot = { random: cloneRandom(fe.random), evt2: cloneEvt2(fe.evt2) };
    const scratch = { ...fe, random: cloneRandom(fe.random), evt2: cloneEvt2(fe.evt2) } as FloorEdit;
    edit(scratch);
    const to: RandomSnapshot = { random: scratch.random, evt2: scratch.evt2 };
    this.exec(this.randomCommand(floor, label, { from, to }, mergeKey));
  }

  private randomCommand(floor: number, label: string, span: RandomSpan, mergeKey?: string): ModelCommand & { span: RandomSpan } {
    const apply = (s: RandomSnapshot) => {
      const fe = this.floorEdit(floor);
      fe.random = cloneRandom(s.random);
      fe.evt2 = cloneEvt2(s.evt2);
    };
    return {
      label,
      changes: [{ kind: 'random', floor }],
      span,
      redo: () => apply(span.to),
      undo: () => apply(span.from),
      ...(mergeKey !== undefined
        ? {
            mergeKey,
            merge: (next: Command) => {
              const n = next as Partial<{ span: RandomSpan }>;
              return n.span ? this.randomCommand(floor, label, { from: span.from, to: n.span.to }, mergeKey) : null;
            },
          }
        : {}),
    };
  }

  private requireRandom(fe: FloorEdit): RandomWaveSections {
    if (!fe.random) throw new Error(`floor ${fe.floor} has no editable random-wave sections (both types 4 and 5 must parse)`);
    return fe.random;
  }

  // The room block a flat location index falls in: [room, first index, count].
  private roomBlockOf(r: RandomWaveSections, index: number): { room: RandomEnemyRoom; start: number } | null {
    let start = 0;
    for (const room of r.rooms) {
      if (index >= start && index < start + room.count) return { room, start };
      start += room.count;
    }
    return null;
  }

  // Moves one location (its position, angle or the two unmodelled u16s).
  setRandomLocation(floor: number, index: number, patch: Partial<RandomEnemyLocation>, mergeKey?: string): void {
    this.randomEdit(
      floor,
      'Edit random location',
      (fe) => {
        const r = this.requireRandom(fe);
        const loc = r.locations[index];
        if (!loc) throw new Error(`random location ${index} is out of range`);
        Object.assign(loc, { ...patch, pos: patch.pos ? [...patch.pos] : loc.pos, angle: patch.angle ? [...patch.angle] : loc.angle });
      },
      mergeKey,
    );
  }

  // Adds a location at the end of a room's block. The room must exist (its
  // number is the room id of the section, as in the .dat's room table).
  addRandomLocation(floor: number, roomId: number, loc: RandomEnemyLocation): void {
    this.randomEdit(floor, 'Add random location', (fe) => {
      const r = this.requireRandom(fe);
      const at = r.rooms.findIndex((x) => x.roomId === roomId);
      if (at < 0) throw new Error(`room ${roomId} has no random-location table in floor ${floor}`);
      const blockStart = r.rooms.slice(0, at).reduce((n, x) => n + x.count, 0);
      r.locations.splice(blockStart + r.rooms[at].count, 0, { ...loc, pos: [...loc.pos], angle: [...loc.angle] });
      r.rooms[at].count++;
    });
  }

  // Removes a location from its room's block.
  removeRandomLocation(floor: number, index: number): void {
    this.randomEdit(floor, 'Delete random location', (fe) => {
      const r = this.requireRandom(fe);
      const block = this.roomBlockOf(r, index);
      if (!block) throw new Error(`random location ${index} is out of range`);
      r.locations.splice(index, 1);
      block.room.count--;
    });
  }

  setRandomDefinition(floor: number, index: number, patch: Partial<RandomEnemyDefinition>, mergeKey?: string): void {
    this.randomEdit(
      floor,
      'Edit random enemy definition',
      (fe) => {
        const d = this.requireRandom(fe).definitions[index];
        if (!d) throw new Error(`random enemy definition ${index} is out of range`);
        Object.assign(d, { ...patch, params: patch.params ? [...patch.params] : d.params });
      },
      mergeKey,
    );
  }

  setRandomWeight(floor: number, index: number, patch: Partial<RandomEnemyWeight>, mergeKey?: string): void {
    this.randomEdit(
      floor,
      'Edit random enemy weight',
      (fe) => {
        const w = this.requireRandom(fe).weights[index];
        if (!w) throw new Error(`random enemy weight ${index} is out of range`);
        Object.assign(w, patch);
      },
      mergeKey,
    );
  }

  // Edits an evt2 entry's fields (the wave count, enemy counts, delays, room).
  // The action stream is kept as it was.
  setEvt2Entry(floor: number, index: number, patch: Partial<Event2Entry>, mergeKey?: string): void {
    this.randomEdit(
      floor,
      'Edit random wave event',
      (fe) => {
        const e = fe.evt2?.entries[index];
        if (!fe.evt2 || !e) throw new Error(`evt2 entry ${index} is out of range`);
        Object.assign(e, patch);
      },
      mergeKey,
    );
  }

  private randomBytes(f: FloorEdit): { locations: Uint8Array | null; definitions: Uint8Array | null } {
    const raw = f.rawRandom;
    if (!f.random) return { locations: raw?.locations ?? null, definitions: raw?.definitions ?? null };
    if (raw && randomKey(f.random) === raw.key) return { locations: raw.locations, definitions: raw.definitions };
    return {
      locations: f.random.hasLocations ? serializeRandomLocations(f.random.rooms, f.random.locations) : null,
      definitions: f.random.hasDefinitions ? serializeRandomDefinitions(f.random.definitions, f.random.weights) : null,
    };
  }

  private eventsBytes(f: FloorEdit): Uint8Array | null {
    if (f.rawEvents && eventsKey(f) === f.rawEventsKey) return f.rawEvents;
    if (f.evt2) return serializeEvt2File(f.evt2.entries, f.evt2.actionStream);
    if (!f.eventsEditable) return f.rawEvents;
    return f.events.length || f.hasEventChunk ? serializeEvents(f.events) : null;
  }

  private datContent(): DatFloorContent[] {
    return [...this.floors.values()].map((f) => {
      const random = this.randomBytes(f);
      return {
        floor: f.floor,
        objects: f.objects,
        enemies: f.enemies,
        events: this.eventsBytes(f),
        randomLocations: random.locations,
        randomDefinitions: random.definitions,
        extra: f.extra,
      };
    });
  }

  toDatBytes(): Uint8Array {
    return buildQuestDatBytes(this.datContent(), this.layout);
  }

  // The .dat as the parsed object the writer takes.
  toQuestDat(): QuestDat {
    return parseQuestDat(this.toDatBytes());
  }

  toQuestBin(): QuestBin {
    return this.bin;
  }

  // Replaces the whole content (Open, New).
  replaceWith(other: QuestDocument): void {
    this.bin = other.bin;
    this.floors.clear();
    for (const [k, v] of other.floors) this.floors.set(k, v);
    this.fileName = other.fileName;
    this.warnings = other.warnings;
    this.layout = other.layout;
    this.current = other.current;
    this.selected = [];
    this.history.clear();
    this.emit({ kind: 'document' });
    this.emit({ kind: 'history' });
  }
}

export function cloneEntity<T extends SetEntity>(e: T): T {
  return { ...e, position: [...e.position], rotation: [...e.rotation], params: [...e.params] } as T;
}

const KNOWN_CHUNK_TYPES = new Set<number>([
  QuestDatChunkType.Objects,
  QuestDatChunkType.Enemies,
  QuestDatChunkType.Events,
  QuestDatChunkType.RandomEnemyLocations,
  QuestDatChunkType.RandomEnemyDefinitions,
]);

// Fills a floor from its parsed .dat chunks. Every entity keeps its record bytes
// (SetEntryBase.raw) so the writer can keep the fields the editor does not model.
function loadFloor(fe: FloorEdit, f: QuestDatFloor): void {
  fe.objects = f.objects.map((o, i) => ({ ...cloneEntity(o), raw: f.objectBytes.slice(i * OBJECT_SET_SIZE, (i + 1) * OBJECT_SET_SIZE), homeFloor: f.floor }));
  fe.enemies = f.enemies.map((e, i) => ({ ...cloneEntity(e), raw: f.enemyBytes.slice(i * ENEMY_SET_SIZE, (i + 1) * ENEMY_SET_SIZE), homeFloor: f.floor }));
  if (f.eventData) {
    fe.hasEventChunk = true;
    fe.rawEvents = f.eventData.slice();
    if (isEvt2(f.eventData)) {
      const evt2 = parseEvt2File(f.eventData);
      fe.evt2 = { entries: evt2.entries.map((e) => ({ ...e })), actionStream: evt2.actionStream.slice() };
      fe.eventsEditable = false;
    } else if (f.events && f.events.format === 'evt1') {
      fe.events = f.events.events.map((e) => ({ ...e, actions: e.actions.map((a) => ({ ...a })) }));
    } else {
      fe.eventsEditable = false;
    }
  }
  if (f.randomLocations || f.randomDefinitions) {
    fe.rawRandom = { locations: f.randomLocations?.slice() ?? null, definitions: f.randomDefinitions?.slice() ?? null, key: '' };
    if (f.randomLocations && f.randomDefinitions) {
      try {
        const s = parseRandomEnemySections(f.randomLocations, f.randomDefinitions);
        fe.random = {
          rooms: s.rooms,
          locations: s.locations,
          definitions: s.definitions,
          weights: s.weights,
          hasLocations: true,
          hasDefinitions: true,
        };
        fe.rawRandom.key = randomKey(fe.random);
      } catch {
        // Kept as bytes: the chunks are written back unchanged.
        fe.random = null;
      }
    }
  }
}

function reindex(f: FloorEdit): void {
  f.objects.forEach((o, i) => (o.index = i));
  f.enemies.forEach((e, i) => (e.index = i));
}

function reindexEvents(f: FloorEdit): void {
  f.events.forEach((e, i) => (e.index = i));
}

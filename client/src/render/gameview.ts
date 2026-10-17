// 3D view of a game (team room): loads the floor the local player is on from
// the variations of the join command (64) through the client's set data table
// (SetDataTableOn.rel), places the players with the LobbyView machinery
// (collision, TObjPlayerSet spawn points, animated models, 6x40/42/3E), shows
// the enemies of the floor's set data with their models and idle motions
// (render/enemyview.ts; markers for objects, NPCs and anything without a
// model), and warps between floors: choosing a destination in a warp object's
// menu (render/gamefield.ts: area, boss and Ragol warps, doors, switches, floor
// music) or calling warpTo() sends 6x21/6x22, loads the next floor, then sends
// 6x3F/6x1F/6x3B/6x23 (net/game.ts). Items on the floor, pickup and item
// boxes: net/items.ts (GameItems) and render/flooritems.ts (FloorItemLayer).

import type { BgmPlayer } from '../audio/bgm.ts';
import { ClientFiles } from '../data/clientfiles.ts';
import type { DataSource } from '../data/source.ts';
import { parseMapCRel } from '../formats/crel.ts';
import { parseMapNRel, type MapSection } from '../formats/nrel.ts';
import { parseObjectSets, playerSpawns, roomToWorld, type ObjectSetEntry } from '../formats/objset.ts';
import { parseSetFile, placeEntities, type EnemySet } from '../formats/setdata.ts';
import { floorFiles, geometryCandidates, parseSetDataTable, type FloorFiles, type GameMode, type SetDataTable } from '../formats/setdatatable.ts';
import { floorToArea, type Game } from '../net/game.ts';
import { GameItems } from '../net/items.ts';
import type { CharacterFile } from '../net/charfile.ts';
import { FloorItemLayer } from './flooritems.ts';
import { CollisionWorld } from './collision.ts';
import { CombatView } from './combat.ts';
import { EnemyLayer } from './enemyview.ts';
import { GameField } from './gamefield.ts';
import { ObjectLayer } from './objectview.ts';
import { enemySlots } from '../formats/enemyids.ts';
import { parseEnemySets } from '../formats/setdata.ts';
import { LobbyView, type LobbyMapData, type LobbySpawn } from './lobbyview.ts';
import type { QuestSession } from '../quest/session.ts';
import type { MapViewer } from './mapviewer.ts';

export const AREA_NAMES: Record<number, string> = {
  0x00: 'Pioneer 2', 0x01: 'Forest 1', 0x02: 'Forest 2', 0x03: 'Cave 1', 0x04: 'Cave 2', 0x05: 'Cave 3',
  0x06: 'Mine 1', 0x07: 'Mine 2', 0x08: 'Ruins 1', 0x09: 'Ruins 2', 0x0a: 'Ruins 3', 0x0b: 'Dragon',
  0x0c: 'De Rol Le', 0x0d: 'Vol Opt', 0x0e: 'Dark Falz', 0x12: 'Lab', 0x13: 'VR Temple Alpha',
  0x14: 'VR Temple Beta', 0x15: 'VR Spaceship Alpha', 0x16: 'VR Spaceship Beta', 0x17: 'Central Control Area',
  0x18: 'Jungle North', 0x19: 'Jungle South', 0x1a: 'Mountain', 0x1b: 'Seaside', 0x1c: 'Seabed Upper',
  0x1d: 'Seabed Lower', 0x1e: 'Gal Gryphon', 0x1f: 'Olga Flow', 0x20: 'Barba Ray', 0x21: 'Gol Dragon',
  0x22: 'Seaside Night', 0x23: 'Tower', 0x24: 'Crater East', 0x25: 'Crater West', 0x26: 'Crater South',
  0x27: 'Crater North', 0x28: 'Crater Interior', 0x29: 'Desert 1', 0x2a: 'Desert 2', 0x2b: 'Desert 3',
  0x2c: 'Saint-Milion', 0x2d: 'Pioneer 2',
};

export interface FloorInfo {
  floor: number;
  area: number;
  name: string;
  files: FloorFiles | null;
  geometry: string;
  enemies: number;
  objects: number;
}

export class GameView {
  readonly game: Game;
  private viewer: MapViewer;
  private source: DataSource;
  private files: ClientFiles;
  private log: (msg: string) => void;
  private table: Promise<SetDataTable | null> | null = null;
  private view: LobbyView | null = null;
  readonly enemyLayer: EnemyLayer;
  readonly combat: CombatView;
  readonly objectLayer: ObjectLayer;
  private field: GameField;
  readonly items: GameItems;
  readonly floorItems: FloorItemLayer;
  private collision: CollisionWorld | null = null;
  private objectCounts = new Map<number, Promise<number>>();
  private enemyCounts = new Map<number, Promise<number>>();
  private busy = false;
  private disposed = false;
  current: FloorInfo | null = null;
  onFloor: (info: FloorInfo) => void = () => {};
  // The lobby teleporter (TObjCityAreaWarp) was used: the caller leaves the game.
  onLobbyWarp: () => void = () => {};

  constructor(
    viewer: MapViewer,
    game: Game,
    source: DataSource,
    log: (msg: string) => void = () => {},
    bgm: BgmPlayer | null = null,
    character: { character: () => CharacterFile | null; fullCharacter: () => Uint8Array | null } = { character: () => null, fullCharacter: () => null },
  ) {
    this.viewer = viewer;
    this.game = game;
    this.source = source;
    this.files = new ClientFiles(source);
    this.log = log;
    this.enemyLayer = new EnemyLayer(viewer, this.files);
    this.objectLayer = new ObjectLayer(viewer, this.files);
    this.field = new GameField(viewer, game, this.files, {
      bgm,
      log,
      warpTo: (f) => this.warpTo(f),
      toLobby: () => this.onLobbyWarp(),
      tickQuest: (dt) => this.quest?.tick(dt),
    });
    this.items = new GameItems(game, { ...character, log });
    this.floorItems = new FloorItemLayer(viewer, this.files, this.items, {
      ground: (x, z, fromY) => (this.collision ? this.collision.groundHeight(x, z, fromY) : viewer.groundHeight(x, z, fromY)),
      blocked: () => this.field.menu.open || this.busy,
      log,
    });
    // Combat lives in render/combat.ts; the view only hands it the floor.
    this.combat = new CombatView(viewer, game, this.files, this.enemyLayer, {
      log,
      floorFilesFor: (f) => this.floorFilesFor(f),
      ground: (x, z, fromY) => (this.collision ? this.collision.groundHeight(x, z, fromY) : viewer.groundHeight(x, z, fromY)),
      ...character,
      source,
    });
  }

  // Number of set-data objects on the floors before `floor` (object entity
  // ids count across all floors, as newserv's MapState does).
  private async objectBase(floor: number): Promise<number> {
    let base = 0;
    for (let f = 0; f < floor; f++) {
      let n = this.objectCounts.get(f);
      if (!n) {
        const quest = this.quest?.floorData(f);
        n = quest
          ? Promise.resolve(quest.objects.length)
          : this.floorFilesFor(f)
              .then(async ({ files }) => (files && (await this.files.has(files.objects)) ? (await this.files.read(files.objects)).length / 0x44 : 0))
              .catch(() => 0);
        this.objectCounts.set(f, n);
      }
      base += await n;
    }
    return base;
  }

  // Number of enemy slots on the floors before `floor` (an enemy's entity id
  // is 0x1000 + its global slot; one e.dat entry can take several slots, see
  // formats/enemyids.ts).
  private async enemyBase(floor: number): Promise<number> {
    let base = 0;
    for (let f = 0; f < floor; f++) {
      let n = this.enemyCounts.get(f);
      if (!n) {
        const quest = this.quest?.floorData(f);
        n = quest
          ? this.floorFilesFor(f)
              .then(({ area }) => enemySlots(quest.enemies, area).total)
              .catch(() => 0)
          : this.floorFilesFor(f)
              .then(async ({ area, files }) => {
                if (!files || !(await this.files.has(files.enemies))) return 0;
                return enemySlots(parseEnemySets(await this.files.read(files.enemies)), area).total;
              })
              .catch(() => 0);
        this.enemyCounts.set(f, n);
      }
      base += await n;
    }
    return base;
  }

  private mode(): GameMode {
    const i = this.game.info!;
    return i.solo ? 'solo' : i.challenge ? 'challenge' : i.battle ? 'battle' : 'normal';
  }

  private setDataTable(): Promise<SetDataTable | null> {
    this.table ??= (async () => {
      const name = this.game.info?.solo ? 'SetDataTableOff.rel' : 'SetDataTableOn.rel';
      try {
        return parseSetDataTable(await this.files.read(name));
      } catch (err) {
        this.log(`no ${name}: ${(err as Error).message}`);
        return null;
      }
    })();
    return this.table;
  }

  // The quest the game is running, if any. Its map designations replace the
  // game's own variations, and its .dat replaces the free-play set data of the
  // floors it owns (see quest/session.ts).
  quest: QuestSession | null = null;

  setQuest(quest: QuestSession | null): void {
    this.quest = quest;
    // Entity-id bases are counted per floor and differ with the quest's maps.
    this.objectCounts.clear();
    this.enemyCounts.clear();
  }

  private episode(): number {
    return this.quest?.episode ?? this.game.info?.episode ?? 1;
  }

  // Map files of a floor: from the quest's designation when a quest is
  // running, otherwise from the game's variations (64).
  async floorFilesFor(floor: number): Promise<{ area: number; files: FloorFiles | null; geometry: string | null }> {
    const info = this.game.info!;
    const designation = this.quest?.designation(floor) ?? null;
    const area = designation && designation.area <= 0x2e ? designation.area : (floorToArea(this.episode())[floor] ?? -1);
    const table = await this.setDataTable();
    const v = designation
      ? { layout: designation.layoutVar, entities: designation.entitiesVar }
      : (info.variations[floor] ?? { layout: 0, entities: 0 });
    const files = table && area >= 0 ? floorFiles(table, area, v.layout, v.entities, floor, this.mode()) : null;
    const scene = new Set(await this.source.list('scene'));
    const geometry = files ? (geometryCandidates(files.setup).find((g) => scene.has(g)) ?? null) : null;
    return { area, files, geometry };
  }

  // First load after 64: Pioneer 2, then 6F.
  async enter(): Promise<void> {
    await this.loadFloor(0, 0);
    const me = this.game.self!;
    this.game.finishLoading(me.position.x, me.position.y, me.position.z, me.angle);
    this.items.ensureIds();
  }

  // 6x21 + 6x22, load, then 6x3F / 6x1F / 6x3B / 6x23.
  async warpTo(floor: number): Promise<void> {
    const me = this.game.self;
    if (!me || this.busy || floor === me.floor) return;
    this.busy = true;
    try {
      const from = me.floor;
      this.game.warp(floor);
      // TObjPlayerSet param4: 0 = arriving from a lower floor, 1 = returning from a higher one.
      await this.loadFloor(floor, floor > from ? 0 : 1);
      this.game.finishWarp(me.position.x, me.position.y, me.position.z, me.angle);
    } finally {
      this.busy = false;
    }
  }

  private async loadFloor(floor: number, source: number): Promise<void> {
    this.view?.dispose();
    this.view = null;
    this.enemyLayer.clear();
    this.objectLayer.clear();
    const { area, files, geometry } = await this.floorFilesFor(floor);
    if (!geometry) throw new Error(`no map for floor ${floor} (area ${area})`);
    await this.viewer.load(this.source, geometry);
    if (area >= 0 && this.viewer.area !== area) await this.viewer.setArea(this.source, area); // base fog and light of the floor's area
    if (this.disposed) return;
    const sections = this.viewer.geometry?.sections ?? parseMapNRel(await this.source.read(`scene/${geometry}`)).sections;

    const mapData: LobbyMapData = { collision: null, spawns: new Map(), files: this.files };
    try {
      mapData.collision = new CollisionWorld(parseMapCRel(await this.source.read(`scene/${geometry.replace(/n\.rel$/, 'c.rel')}`)));
    } catch (err) {
      this.log(`no collision for ${geometry}: ${(err as Error).message}`);
    }

    let objects: ObjectSetEntry[] = [];
    let enemySets: EnemySet[] = [];
    let enemyCount = 0;
    let placedObjects: ReturnType<typeof placeEntities> = [];
    let eventFile: Uint8Array | null = null;
    // A quest floor takes its objects, enemies and wave events from the .dat
    // (HandleQuestDat, PsoBB.exe 0x006ba0da) unless its designation says to
    // load the free-play template of the designated map (type 1 or 2).
    const questFloor = this.quest?.floorData(floor) ?? null;
    if (questFloor) {
      objects = parseObjectSets(questFloor.objectBytes);
      mapData.spawns = spawnsFor(objects, sections, source);
      const entities = [...questFloor.objects, ...questFloor.enemies];
      enemySets = questFloor.enemies;
      enemyCount = questFloor.enemies.length;
      eventFile = questFloor.eventData;
      const placed = placeEntities(entities, sections, area).filter((p) => !(p.entity.kind === 'object' && p.entity.type === 0));
      const info = this.game.info!;
      const modeled = await this.enemyLayer.show(placed, { area, episode: this.episode(), difficulty: info.difficulty, event: info.event ?? 0 });
      if (this.disposed) return;
      const s = this.enemyLayer.stats;
      this.log(`quest floor ${floor}: ${s.placed} enemy models placed${s.unresolved.length ? `, no model: ${[...new Set(s.unresolved)].join(', ')}` : ''}`);
      placedObjects = placed.filter((p) => p.entity.kind === 'object');
      const objectModels = await this.objectLayer.show(placedObjects, { area, episode: this.episode(), ultimate: info.difficulty === 3 });
      if (this.disposed) return;
      this.viewer.setEntities(placed.filter((p) => !modeled.has(p) && !objectModels.has(p)));
      this.viewer.setFogRegions(placed);
      this.viewer.setEntitiesVisible(true);
    } else if (files) {
      try {
        objects = parseObjectSets(await this.files.read(files.objects));
      } catch (err) {
        this.log(`no object sets ${files.objects}: ${(err as Error).message}`);
      }
      mapData.spawns = spawnsFor(objects, sections, source);
      // Markers: enemies (e.dat) and objects (o.dat), placed in their rooms.
      const entities = [];
      try {
        entities.push(...parseSetFile(files.objects, await this.files.read(files.objects)));
      } catch {
        // reported above
      }
      if (await this.files.has(files.enemies)) {
        const enemies = parseSetFile(files.enemies, await this.files.read(files.enemies));
        enemyCount = enemies.length;
        enemySets = enemies.filter((e): e is EnemySet => e.kind === 'enemy');
        entities.push(...enemies);
        enemySets = enemies.filter((e): e is (typeof enemySets)[number] => e.kind === 'enemy');
      }
      // The floor's wave events (<enemy basename>.evt).
      if (await this.files.has(files.events)) eventFile = await this.files.read(files.events);
      else this.log(`no event file ${files.events}`);
      const placed = placeEntities(entities, sections, area).filter((p) => !(p.entity.kind === 'object' && p.entity.type === 0));
      const info = this.game.info!;
      const modeled = await this.enemyLayer.show(placed, { area, episode: info.episode, difficulty: info.difficulty, event: info.event ?? 0 });
      if (this.disposed) return;
      const s = this.enemyLayer.stats;
      this.log(`enemy models: ${s.placed} placed${s.unresolved.length ? `, no model: ${[...new Set(s.unresolved)].join(', ')}` : ''}${s.errors.length ? `, errors: ${s.errors.join('; ')}` : ''}`);
      placedObjects = placed.filter((p) => p.entity.kind === 'object');
      const objectModels = await this.objectLayer.show(placedObjects, { area, episode: info.episode, ultimate: info.difficulty === 3 });
      if (this.disposed) return;
      const os = this.objectLayer.stats;
      this.log(
        `object models: ${os.placed} placed, ${os.invisible} invisible` +
          `${os.unresolved.length ? `, no model: ${[...new Set(os.unresolved)].join(', ')}` : ''}` +
          `${os.errors.length ? `, errors: ${os.errors.join('; ')}` : ''}`,
      );
      this.viewer.setEntities(placed.filter((p) => !modeled.has(p) && !objectModels.has(p)));
      this.viewer.setFogRegions(placed); // TObjFogCollision* regions switch the fog as we walk
      this.viewer.setEntitiesVisible(true);
    }

    const me = this.game.self!;
    me.floor = floor;
    me.position = { x: 0, y: 0, z: 0 };
    this.view = new LobbyView(this.viewer, this.game, mapData, { showPlayer: (p) => p.floor === this.game.self?.floor && p.visible !== false });
    const objectBase = await this.objectBase(floor);
    // The quest's floor handler runs on a new thread when the player arrives
    // (quest_start_floor_thread, PsoBB.exe .c:615128).
    this.quest?.enterFloor(floor);
    this.field.enterFloor(floor, area, {
      placed: placedObjects,
      objectBase,
      enemySets,
      enemyBase: await this.enemyBase(floor),
      eventFile,
      sections,
      enemies: this.enemyLayer,
      objects: this.objectLayer,
      collision: mapData.collision,
    });
    this.field.attach();
    this.collision = mapData.collision;
    this.floorItems.enterFloor(floor, area, placedObjects, objectBase);
    this.floorItems.attach();
    this.view.attacking = this.combat.isAttacking;
    await this.combat.enterFloor(floor, area, enemySets, await this.combat.enemyBase(floor));
    if (this.disposed) return;
    this.combat.attach(this.view);
    this.current = {
      floor,
      area,
      name: AREA_NAMES[area] ?? `area ${area}`,
      files,
      geometry,
      enemies: enemyCount,
      objects: objects.length,
    };
    this.log(
      `floor ${floor} (${this.current.name}): ${geometry}, ${files?.objects ?? '-'} (${objects.length}), ${files?.enemies ?? '-'} (${enemyCount}), ` +
        `${mapData.spawns.size} spawn points`,
    );
    this.onFloor(this.current);
  }

  // Reloads the floor the player is on. Used when a quest's map designations
  // replace what the floor holds (quest/run.ts).
  async reloadCurrentFloor(): Promise<void> {
    const floor = this.game.self?.floor ?? this.current?.floor ?? 0;
    this.busy = true;
    try {
      await this.loadFloor(floor, 0);
    } finally {
      this.busy = false;
    }
  }

  // --- what the quest VM asks of the field (quest/run.ts) ---

  roomAt(pos: { x: number; y: number; z: number }): number {
    return this.field.roomAt(pos);
  }

  zoneCleared(floor: number, room: number): boolean {
    return this.field.zoneCleared(floor, room);
  }

  // construct_delayed_enemy (0x8B): make a room's wave appear now, the way a
  // wave event's construct_enemies action does (render/waves.ts).
  constructEnemies(floor: number, room: number, wave: number): void {
    this.field.constructEnemies(floor, room, wave);
  }

  switchFlag(floor: number, flag: number): boolean {
    return this.field.switchFlag(floor, flag);
  }

  setSwitchFlag(floor: number, flag: number, set: boolean): void {
    this.field.setSwitchFlagFromQuest(floor, flag, set);
  }

  // Console helpers: window.psobb.waves (wave events, triggers, killWave).
  debug() {
    return this.field.debug();
  }

  // An enemy died (combat code / render/combat.ts): advances its wave event.
  onEnemyKilled(entityId: number, floor?: number): void {
    this.field.onEnemyKilled(entityId, floor);
  }

  // Boxes of the current floor, for the item drop code.
  get fieldObjects() {
    return this.field.fieldObjects;
  }

  dispose(): void {
    this.disposed = true;
    this.combat.dispose();
    this.field.dispose();
    this.floorItems.dispose();
    this.items.dispose();
    this.view?.dispose();
    this.view = null;
    this.enemyLayer.dispose();
    this.objectLayer.dispose();
    this.viewer.clearEntities();
  }
}

// TObjPlayerSet entries of the floor (param1 = client id, param4 = arrival source).
function spawnsFor(objects: ObjectSetEntry[], sections: MapSection[], source: number): Map<number, LobbySpawn> {
  const out = new Map<number, LobbySpawn>();
  const sets = playerSpawns(objects);
  for (const pass of [source, 0, 1]) {
    for (const s of sets) {
      if (s.source !== pass || out.has(s.clientId)) continue;
      const room = sections.find((r) => r.id === s.room);
      const [x, y, z] = roomToWorld(s.position, room);
      out.set(s.clientId, { x, y, z, angle: (s.angleY / 0x10000) * Math.PI * 2 + (room?.rotation[1] ?? 0) });
    }
  }
  return out;
}


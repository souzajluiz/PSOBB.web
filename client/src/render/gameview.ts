// 3D view of a game (team room): loads the floor the local player is on from
// the variations of the join command (64) through the client's set data table
// (SetDataTableOn.rel), places the players with the LobbyView machinery
// (collision, TObjPlayerSet spawn points, animated models, 6x40/42/3E), shows
// the enemies of the floor's set data with their models and idle motions
// (render/enemyview.ts; markers for objects, NPCs and anything without a
// model), and warps between floors: choosing a destination in a warp object's
// menu (render/gamefield.ts: area, boss and Ragol warps, doors, switches, floor
// music) or calling warpTo() sends 6x21/6x22, loads the next floor, then sends
// 6x3F/6x1F/6x3B/6x23 (net/game.ts).

import type { BgmPlayer } from '../audio/bgm.ts';
import { ClientFiles } from '../data/clientfiles.ts';
import type { DataSource } from '../data/source.ts';
import { parseMapCRel } from '../formats/crel.ts';
import { parseMapNRel, type MapSection } from '../formats/nrel.ts';
import { parseObjectSets, playerSpawns, roomToWorld, type ObjectSetEntry } from '../formats/objset.ts';
import { parseSetFile, placeEntities } from '../formats/setdata.ts';
import { floorFiles, geometryCandidates, parseSetDataTable, type FloorFiles, type GameMode, type SetDataTable } from '../formats/setdatatable.ts';
import { floorToArea, type Game } from '../net/game.ts';
import { CollisionWorld } from './collision.ts';
import { EnemyLayer } from './enemyview.ts';
import { GameField } from './gamefield.ts';
import { LobbyView, type LobbyMapData, type LobbySpawn } from './lobbyview.ts';
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
  private field: GameField;
  private objectCounts = new Map<number, Promise<number>>();
  private busy = false;
  private disposed = false;
  current: FloorInfo | null = null;
  onFloor: (info: FloorInfo) => void = () => {};
  // The lobby teleporter (TObjCityAreaWarp) was used: the caller leaves the game.
  onLobbyWarp: () => void = () => {};

  constructor(viewer: MapViewer, game: Game, source: DataSource, log: (msg: string) => void = () => {}, bgm: BgmPlayer | null = null) {
    this.viewer = viewer;
    this.game = game;
    this.source = source;
    this.files = new ClientFiles(source);
    this.log = log;
    this.enemyLayer = new EnemyLayer(viewer, this.files);
    this.field = new GameField(viewer, game, this.files, { bgm, log, warpTo: (f) => this.warpTo(f), toLobby: () => this.onLobbyWarp() });
  }

  // Number of set-data objects on the floors before `floor` (object entity
  // ids count across all floors, as newserv's MapState does).
  private async objectBase(floor: number): Promise<number> {
    let base = 0;
    for (let f = 0; f < floor; f++) {
      let n = this.objectCounts.get(f);
      if (!n) {
        n = this.floorFilesFor(f)
          .then(async ({ files }) => (files && (await this.files.has(files.objects)) ? (await this.files.read(files.objects)).length / 0x44 : 0))
          .catch(() => 0);
        this.objectCounts.set(f, n);
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

  // Map files of a floor from the game's variations.
  async floorFilesFor(floor: number): Promise<{ area: number; files: FloorFiles | null; geometry: string | null }> {
    const info = this.game.info!;
    const area = floorToArea(info.episode)[floor] ?? -1;
    const table = await this.setDataTable();
    const v = info.variations[floor] ?? { layout: 0, entities: 0 };
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
    let enemyCount = 0;
    let placedObjects: ReturnType<typeof placeEntities> = [];
    if (files) {
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
        entities.push(...enemies);
      }
      const placed = placeEntities(entities, sections, area).filter((p) => !(p.entity.kind === 'object' && p.entity.type === 0));
      const info = this.game.info!;
      const modeled = await this.enemyLayer.show(placed, { area, episode: info.episode, difficulty: info.difficulty, event: info.event ?? 0 });
      if (this.disposed) return;
      const s = this.enemyLayer.stats;
      this.log(`enemy models: ${s.placed} placed${s.unresolved.length ? `, no model: ${[...new Set(s.unresolved)].join(', ')}` : ''}${s.errors.length ? `, errors: ${s.errors.join('; ')}` : ''}`);
      placedObjects = placed.filter((p) => p.entity.kind === 'object');
      this.viewer.setEntities(placed.filter((p) => !modeled.has(p)));
      this.viewer.setFogRegions(placed); // TObjFogCollision* regions switch the fog as we walk
      this.viewer.setEntitiesVisible(true);
    }

    const me = this.game.self!;
    me.floor = floor;
    me.position = { x: 0, y: 0, z: 0 };
    this.view = new LobbyView(this.viewer, this.game, mapData, { showPlayer: (p) => p.floor === this.game.self?.floor && p.visible !== false });
    this.field.enterFloor(floor, area, placedObjects, await this.objectBase(floor));
    this.field.attach();
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

  dispose(): void {
    this.disposed = true;
    this.field.dispose();
    this.view?.dispose();
    this.view = null;
    this.enemyLayer.dispose();
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


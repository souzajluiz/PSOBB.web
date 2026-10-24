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
import type { HomeLeafServices } from '../classic/homeleaves.ts';
import { ClientFiles } from '../data/clientfiles.ts';
import { readIfPresent, type DataSource } from '../data/source.ts';
import { parseMapCRel } from '../formats/crel.ts';
import { parseMapNRel, type MapSection } from '../formats/nrel.ts';
import { parseObjectSets, playerSpawns, roomToWorld, type ObjectSetEntry } from '../formats/objset.ts';
import { parseSetFile, placeEntities, type EnemySet, type PlacedEntity } from '../formats/setdata.ts';
import { floorFiles, geometryCandidates, parseSetDataTable, type FloorFiles, type GameMode, type SetDataTable } from '../formats/setdatatable.ts';
import { floorToArea, type Game } from '../net/game.ts';
import { playerRoomId } from '../formats/playerroom.ts';
import { floorChangeSource, spawnsOfSource } from '../formats/fieldspawn.ts';
import { GameItems } from '../net/items.ts';
import { parseMagEvolution, SE_FEED } from '../net/magfeed.ts';
import { parseMagEdit, type MagEdit } from '../formats/itemmagedit.ts';
import { se } from '../audio/se.ts';
import type { CharacterFile } from '../net/charfile.ts';
import { FloorItemLayer } from './flooritems.ts';
import { FieldHud } from './fieldhud.ts';
import { doorIcon, komoVariant6Icon, raderIconObject, radToBams, type Icon, type MinimapPlayer, type RaderHide, type RaderIconObject } from '../classic/minimap.ts';
import { doorMapLocked } from './fieldobjects.ts';
import { CollisionWorld } from './collision.ts';
import { CombatView } from './combat.ts';
import type { WeaponReach } from '../combat/weaponaim.ts';
import { EnemyLayer } from './enemyview.ts';
import { GameField } from './gamefield.ts';
import { ObjectLayer } from './objectview.ts';
import { enemySlots } from '../formats/enemyids.ts';
import { parseEnemySets, type ObjectSet } from '../formats/setdata.ts';
import { parseEventFile } from '../formats/events.ts';
import { buildSyncLayout, type SyncFloor, type SyncLayout } from '../net/joinsync.ts';
import { LobbyView, type HeldWeaponSource, type LobbyMapData, type LobbySpawn } from './lobbyview.ts';
import { inUnsafeMap } from './playermove.ts';
import { NpcLayer } from './npcview.ts';
import { NPC_ENEMY_TYPES } from '../formats/enemymodels.ts';
import { TelepipeLayer, type Arrival } from './telepipe.ts';
import * as THREE from 'three';
import type { QuestSession } from '../quest/session.ts';
import type { SpawnPoint } from '../quest/battletraps.ts';
import type { MapViewer } from './mapviewer.ts';
import { serverUrl } from '../net/server.ts';
import { pioneer2ReturnArrival } from '../net/telepipe.ts';
import { build6x83 } from '../quest/battle.ts';
import type { TeamChat } from '../classic/teamchat.ts';
import type { ChatLog } from '../classic/chat.ts';

const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

// The map viewer's set-data markers stand in for entities without a model.
// In a game those are logic-only objects (TShopGenerator, TObjLuker,
// TObjTradeCollision, ...) that the client never draws, so the markers stay
// hidden unless the page is opened with ?markers (development aid).
const SHOW_MARKERS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('markers');

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
  // Every TObjPlayerSet of the floor in world space (angle in radians): the battle respawn's candidates.
  private floorSpawns: SpawnPoint[] = [];
  readonly enemyLayer: EnemyLayer;
  // NPCs of the floor (render/npcview.ts); quest/town.ts drives their talk.
  readonly npcs: NpcLayer;
  readonly combat: CombatView;
  readonly objectLayer: ObjectLayer;
  private field: GameField;
  readonly items: GameItems;
  readonly floorItems: FloorItemLayer;
  readonly hud: FieldHud;
  // Ryuker / Telepipe pipes and the Pioneer 2 pipes (render/telepipe.ts).
  readonly telepipes: TelepipeLayer;
  // The objects of the floor the player is on.
  private placedObjects: PlacedEntity[] = [];
  private collision: CollisionWorld | null = null;
  private objectCounts = new Map<number, Promise<number>>();
  private enemyCounts = new Map<number, Promise<number>>();
  private layout: Promise<SyncLayout> | null = null;
  private busy = false;
  private disposed = false;
  current: FloorInfo | null = null;
  // The local character file (its inventory has the equipped weapon).
  private characterFile: () => CharacterFile | null = () => null;
  // ItemMagEdit's MAG model tables (loaded with the MAG feed's evolution table).
  private magEdit: MagEdit | null = null;
  onFloor: (info: FloorInfo) => void = () => {};
  // The lobby teleporter (TObjCityAreaWarp) was used: the caller leaves the game.
  onLobbyWarp: () => void = () => {};
  // Called after every floor load (quest/town.ts loads the area script).
  readonly floorHooks = new Set<(info: FloorInfo) => void>();
  // While this returns true the local player cannot move, attack or pick up
  // (an NPC talk, a quest message or list waits; UIState_SetLockedState).
  inputBlocked: () => boolean = () => false;
  // A chat shortcut slot (0..11) was pressed; the field's chat line sends it (classic/field.ts).
  chatShortcut: ((index: number, full: Uint8Array | null) => void) | null = null;
  // The Action Palette Middle key's interact (quest/town.ts): true when an NPC or floor item
  // in the weapon's reach took the key, so the key does not attack (render/combat.ts).
  middleInteract: (reach: WeaponReach | null) => boolean = () => false;
  // false: no name labels over the players (the classic page, classic/field.ts).
  private labels: boolean;
  // The team chat window (classic/teamchat.ts), shared with the lobby; null without one.
  readonly teamChat: TeamChat | null;
  // The chat log the Home menu's Log Window pages; set by the classic field (classic/field.ts).
  chatLog: ChatLog | null = null;

  constructor(
    viewer: MapViewer,
    game: Game,
    source: DataSource,
    log: (msg: string) => void = () => {},
    bgm: BgmPlayer | null = null,
    character: { character: () => CharacterFile | null; fullCharacter: () => Uint8Array | null; saveCustomize?: (config: Uint8Array) => void; sendTechOrder?: (order: readonly number[]) => void } = { character: () => null, fullCharacter: () => null },
    options: { labels?: boolean; streamFiles?: () => Promise<Map<string, Uint8Array>>; home?: () => Omit<HomeLeafServices, 'lobby'> | null; teamChat?: TeamChat | null } = {},
  ) {
    this.labels = options.labels ?? true;
    this.teamChat = options.teamChat ?? null;
    this.characterFile = character.character;
    this.viewer = viewer;
    this.game = game;
    this.source = source;
    // The game's maps come from the server's set data when the dev server has
    // it (data/clientfiles.ts), so the entity ids match newserv's.
    this.files = new ClientFiles(source, { serverSetData: serverUrl('/newserv-maps/') });
    this.log = log;
    this.enemyLayer = new EnemyLayer(viewer, this.files);
    this.npcs = new NpcLayer(viewer, this.files);
    (globalThis as { gameView?: GameView }).gameView = this; // console/automation access
    this.objectLayer = new ObjectLayer(viewer, this.files);
    this.field = new GameField(viewer, game, this.files, {
      bgm,
      log,
      warpTo: (f) => this.warpTo(f),
      toLobby: () => this.onLobbyWarp(),
      tickQuest: (dt) => this.quest?.tick(dt),
      questStarted: () => this.quest !== null,
      warpSelf: (pos, angle) => this.view?.warpSelf(pos, angle),
      talkCamera: () => this.npcs.talkCameraView(),
      bossCamera: () => this.combat.bossCameraView(),
      trap: (ev, trap) => this.combat.trapEvent(ev, trap),
      captureTrap: (ev) => this.combat.captureTrapEvent(ev),
      fieldHit: (damage, at) => this.combat.fieldObjectHit(damage, at),
      captureReticle: (pos) => this.combat.setCaptureReticle(pos),
    });
    this.items = new GameItems(game, { ...character, log });
    // Join sync (net/joinsync.ts): when we lead and a player joins, the
    // field's set / event / switch flags go into the game's tables first.
    game.prepareJoinSync = async () => {
      const layout = await this.syncLayout();
      if (this.disposed) return null;
      this.field.exportSync(game.joinSync, layout);
      return layout.counts;
    };
    this.floorItems = new FloorItemLayer(viewer, this.files, this.items, {
      ground: (x, z, fromY) => (this.collision ? this.collision.groundHeight(x, z, fromY) : viewer.groundHeight(x, z, fromY)),
      // The drop's line of sight: cast_ray_at_map_collision_geometry(eye, spot, -1) (net/dropspot.ts).
      wallBlocks: (a, b) => (this.collision ? this.collision.segmentHit([a.x, a.y, a.z], [b.x, b.y, b.z], 0xffffffff) !== null : false),
      // The drop spot's body test (FUN_007b5318) over the object boxes (render/collision.ts obstacles).
      dropBodies: () => this.collision?.obstacles ?? [],
      blocked: () => this.field.menu.open || this.busy || this.inputBlocked(),
      log,
    });
    // Combat lives in render/combat.ts; the view only hands it the floor.
    this.combat = new CombatView(viewer, game, this.files, this.enemyLayer, {
      log,
      cameraYaw: () => {
        const v = this.view?.cameraView();
        return v ? radToBams(Math.atan2(v.source.x - v.target.x, v.source.z - v.target.z)) : 0;
      },
      floorFilesFor: (f) => this.floorFilesFor(f),
      ground: (x, z, fromY) => (this.collision ? this.collision.groundHeight(x, z, fromY) : viewer.groundHeight(x, z, fromY)),
      // cast_ray_at_map_collision_geometry(from, to, 0x8100) for a gun's bullet (combat/gunbullet.ts).
      wallBlocks: (a, b, mask = 0x8100) => (this.collision ? this.collision.segmentHit([a.x, a.y, a.z], [b.x, b.y, b.z], mask) !== null : false),
      // The same ray's hit point (cast_ray_at_map_collision_geometry: the Megid orb stops there).
      wallHit: (a, b, mask) => {
        const hit = this.collision?.segmentHit([a.x, a.y, a.z], [b.x, b.y, b.z], mask);
        return hit ? { x: hit.point[0], y: hit.point[1], z: hit.point[2], normal: { x: hit.normal[0], y: hit.normal[1], z: hit.normal[2] } } : null;
      },
      ...character,
      source,
      paletteSlot: (i) => this.hud?.paletteSlot(i) ?? null,
      hotbarSlot: (i) => this.hud?.hotbarSlot(i) ?? null,
      useItem: (g) => this.hud?.useHotbarItem(g) ?? false,
      interactMiddle: (reach) => this.middleInteract(reach),
      warpSelf: (pos, angle) => this.view?.warpSelf(pos, angle),
      bossPhase: (phase) => this.field.noteBossPhase(phase),
      constructObjects: (floor, room, group) => this.constructObjects(floor, room, group),
      onRevivable: () => this.openReturnPrompt(),
      onRevived: () => this.hud.closeReturnPrompt(),
      questRunning: () => this.quest !== null,
      ...(options.streamFiles ? { streamFiles: options.streamFiles } : {}),
    });
    // The player trade's host (net/tradeio.ts): the offers come from the character, the
    // session's notices go to the open Trade Window (render/fieldhud.ts notifyTrade).
    game.tradeHost = { character: () => this.characterFile(), notify: (textId) => this.hud.notifyTrade(textId) };
    // Classic field HUD: action palette and main menu (render/fieldhud.ts).
    this.hud = new FieldHud(viewer, this.files, {
      ...character,
      teamChat: this.teamChat,
      chatLog: () => this.chatLog,
      items: this.items,
      music: this.field.counterMusic(),
      area: () => this.current?.area ?? 0,
      questStarted: () => this.quest !== null,
      quest: () => this.quest,
      questKey: (e) => this.questKey?.(e) ?? false,
      blocked: () => this.field.menu.open,
      chatShortcut: (index) => this.chatShortcut?.(index, character.fullCharacter()),
      cast: (t) => this.combat.castTechnique(t),
      challengeTrap: (row, count) => game.sendSubcommand(0x83, build6x83(game.selfId, row, count).subarray(4)),
      telepipeAllowed: () => this.telepipes.allowed(),
      statusFlags: () => this.combat.status.flags,
      atomizerTarget: () => this.combat.atomizerTarget(),
      starTargets: () => this.combat.starTargets(),
      atomizerEcho: (packet) => this.combat.atomizerEcho(packet),
      send: (command, payload) => game.conn.send(command, 0, payload),
      trade: () => ({
        session: game.trade,
        partners: () => [...game.players.values()].filter((p) => p.clientId !== game.selfId).map((p) => ({ id: p.clientId, name: p.name })),
      }),
      minimap: {
        self: () => this.minimapPlayer(this.game.selfId),
        others: () => {
          const out: MinimapPlayer[] = [];
          const floor = this.game.self?.floor;
          for (const p of this.game.players.values()) {
            if (p.clientId === this.game.selfId || p.floor !== floor || p.visible === false) continue;
            const m = this.minimapPlayer(p.clientId);
            if (m) out.push({ ...m, team: this.hud.battleTeam?.(p.clientId) ?? null });
          }
          return out;
        },
        battle: () => this.hud.battleTeam?.(this.game.selfId) ?? null,
        enemies: () => this.combat.minimapEnemies(),
        forcedIcons: () => this.combat.minimapIcons(),
        switchOn: (flag) => this.fieldObjects?.switchOn(flag) ?? false,
        doorIcons: () => this.doorMinimapIcons(),
        komoIcons: () => this.komoMinimapIcons(),
        cameraYaw: () => {
          const v = this.view?.cameraView();
          return v ? radToBams(Math.atan2(v.source.x - v.target.x, v.source.z - v.target.z)) : 0;
        },
        hidden: () => this.busy || this.inputBlocked(),
      },
      home: () => {
        const s = options.home?.() ?? null;
        return s ? { lobby: game, ...s } : null;
      },
      log,
    });
    this.telepipes = new TelepipeLayer(viewer, game, this.files, {
      log,
      area: () => this.current?.area ?? 0,
      floor: () => this.current?.floor ?? null,
      episode: () => this.game.info?.episode ?? 1,
      selfPose: () => this.selfPose(),
      ground: (x, z, fromY) => (this.collision ? this.collision.groundHeight(x, z, fromY) : viewer.groundHeight(x, z, fromY)),
      roomAt: (pos) => this.roomAt(pos),
      objects: () => this.placedObjects,
      blocked: () => this.field.menu.open || this.busy || this.inputBlocked() || this.hud.menu.isOpen || this.hud.counterOpen,
      areaName: (floor) => AREA_NAMES[floorToArea(this.game.info?.episode ?? 1)[floor] ?? -1] ?? `floor ${floor}`,
      warp: (floor, arrival) => this.warpTo(floor, undefined, arrival),
    });
    this.hud.prompt = () => this.telepipes.prompt();
    this.combat.telepipe = { allowed: () => this.telepipes.allowed(), open: () => this.telepipes.open() };
    this.items.onTelepipe = () => this.telepipes.open();
    this.items.onDropHold = (frames) => this.combat.holdLocal(frames);
    this.items.onDropRelease = () => this.combat.releaseLocalHold();
    this.items.onCure = (subtype) => this.combat.useCureItem(subtype);
    // The Medical Center (classic/shop.ts MedicalCounter).
    this.items.medicalNeedsOf = () => this.combat.medicalNeeds();
    this.items.onMedical = () => this.combat.medicalTreatment();
    // MAG feeding (net/magfeed.ts): ItemPMT from the item names, the
    // evolution stages from ItemMagEdit.prs (loose, else the stream file).
    let evolution: Uint8Array | null = null;
    const files = this.files;
    const combat = this.combat;
    void (async () => {
      const data = (await files.has('ItemMagEdit.prs')) ? await files.read('ItemMagEdit.prs') : (await combat.streamFiles()).get('ItemMagEdit.prs');
      if (data) {
        evolution = parseMagEvolution(data);
        this.magEdit = parseMagEdit(data); // the MAG models' part table and colours (render/magmodel.ts)
      }
    })().catch((err) => log(`MAG: no ItemMagEdit (${(err as Error).message}); mags will not evolve`));
    this.items.magFeed = () => {
      const pmt = this.hud.pmt;
      const c = character.character();
      return pmt && c ? { pmt, evolution, charClass: c.charClass, sectionId: c.sectionId } : null;
    };
    // ExecuteMagFeed_005da00c: SE 0x580 at the owner.
    this.items.onMagFed = () => se(SE_FEED);
    this.hud.load().catch((err) => log(`field HUD: ${(err as Error).message}`));
  }

  // Number of set-data objects on the floors before `floor` (object entity
  // ids count across all floors, as newserv's MapState does).
  // What the field shows of the held weapons (render/heldweapon.ts): each
  // player's equipped weapon as its ItemPMT entry (the local player from the
  // character file, the others from their join data and 6x25 / 6x26), and
  // whether weapons show (not in the hubs: render/playermove.ts).
  private heldSource(): HeldWeaponSource {
    // The combat view loads ItemPMT (its own file or the server's stream file).
    void this.combat.itemPmt();
    return {
      // The local player's equipped MAG (the PMT entry's model and skin; the colour is data2[3]).
      mag: (clientId) => {
        if (clientId !== this.game.self?.clientId) return null;
        const pmt = this.combat.loadedItemPmt;
        const m = this.characterFile()?.inventory.find((i) => (i.flags & 8) !== 0 && i.data.data1[0] === 2);
        const entry = pmt && m ? pmt.mags[m.data.data1[1]] : undefined;
        return entry && m ? { type: entry.type, skin: entry.skin, colour: m.data.data2[3] } : null;
      },
      magEdit: () => this.magEdit,
      equipped: (clientId) => {
        const pmt = this.combat.loadedItemPmt;
        let data1: Uint8Array | null | undefined;
        if (clientId === this.game.self?.clientId) {
          const w = this.characterFile()?.inventory.find((i) => (i.flags & 8) !== 0 && i.data.data1[0] === 0);
          data1 = w?.data.data1 ?? this.game.self?.weapon;
        } else {
          data1 = this.game.players.get(clientId)?.weapon;
        }
        const w = pmt && data1 ? pmt.getWeapon(data1[1], data1[2]) : undefined;
        return w ? { type: w.type, skin: w.skin } : null;
      },
      // The weapon's motion class: ItemPMT's kind table (combat/attack.ts Motion class, ASSUMED).
      motionClass: (clientId) => {
        const pmt = this.combat.loadedItemPmt;
        let data1: Uint8Array | null | undefined;
        if (clientId === this.game.self?.clientId) {
          const w = this.characterFile()?.inventory.find((i) => (i.flags & 8) !== 0 && i.data.data1[0] === 0);
          data1 = w?.data.data1 ?? this.game.self?.weapon;
        } else {
          data1 = this.game.players.get(clientId)?.weapon;
        }
        return pmt && data1 ? (pmt.weaponKinds[data1[1]] ?? 0) : 0;
      },
      visible: () => inUnsafeMap(this.current?.area ?? 0),
    };
  }

  // Development hook (e2e): the held weapons of the players in the field.
  heldWeapons(): ReturnType<LobbyView['heldState']> {
    return this.view?.heldState() ?? [];
  }

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
  // The quest overlay's keys while the main menu holds them (quest/town.ts).
  questKey: ((e: KeyboardEvent) => boolean) | null = null;
  // The soft keyboard's request while a quest window takes text (the S-rank name window).
  questTextInput: (() => { password: boolean } | null) | null = null;

  setQuest(quest: QuestSession | null): void {
    this.quest = quest;
    // Entity-id bases are counted per floor and differ with the quest's maps.
    this.objectCounts.clear();
    this.enemyCounts.clear();
    this.layout = null;
  }

  // Every floor's entities (0..0x11, the exe's per-floor tables), for the
  // join sync's game-wide indices: objects, enemy set entries and their slots,
  // wave events. A floor without set data contributes nothing.
  syncLayout(): Promise<SyncLayout> {
    this.layout ??= (async () => {
      const floors: Array<Omit<SyncFloor, 'objectBase' | 'enemySetBase' | 'enemySlotBase' | 'eventBase'>> = [];
      for (let f = 0; f < 0x12; f++) {
        let objects: ObjectSet[] = [];
        let enemies: EnemySet[] = [];
        let events: Uint8Array | null = null;
        let area = -1;
        try {
          const quest = this.quest?.floorData(f) ?? null;
          const ff = await this.floorFilesFor(f);
          area = ff.area;
          if (quest) {
            objects = quest.objects;
            enemies = quest.enemies;
            events = quest.eventData;
          } else if (ff.files) {
            const files = ff.files;
            if (await this.files.has(files.objects)) objects = parseSetFile(files.objects, await this.files.read(files.objects)).filter((e): e is ObjectSet => e.kind === 'object');
            if (await this.files.has(files.enemies)) enemies = parseEnemySets(await this.files.read(files.enemies));
            if (await this.files.has(files.events)) events = await this.files.read(files.events);
          }
        } catch (err) {
          this.log(`join sync layout, floor ${f}: ${(err as Error).message}`);
        }
        let eventIds: number[] = [];
        if (events) {
          try {
            eventIds = parseEventFile(events).events.map((e) => e.id);
          } catch {
            // no events
          }
        }
        const slots = enemySlots(enemies, area);
        floors.push({ floor: f, objects, setFirstSlots: slots.first, enemySlots: slots.total, eventIds });
      }
      return buildSyncLayout(floors);
    })();
    return this.layout;
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
    // The first floor of a game is entered from the lobby: the flag bit 0 is set
    // (handle_packet0x64), so get_warp_type is 2 and the source 0 (formats/fieldspawn.ts).
    await this.loadFloor(0, 0);
    const me = this.game.self!;
    // 6x3F room: get_player_room_id is 0 on Pioneer 2 (dump 803432), the first floor here.
    this.game.finishLoading(me.position.x, me.position.y, me.position.z, me.angle, { guard: false, room: 0 });
    this.items.ensureIds();
  }

  // The dead prompt (render/fieldhud.ts): Yes returns to Pioneer 2.
  private openReturnPrompt(): void {
    this.hud.openReturnPrompt((yes) => {
      if (yes) void this.returnToPioneer2();
    });
  }

  // Yes on the dead prompt: return_to_p2_maybe sends 6x21 floor 0 and loads
  // Pioneer 2 (warpTo). The arrival is the player's Medical Center spot
  // (SetPlayerRespawnState_006986ec, net/telepipe.ts pioneer2ReturnArrival). The exe
  // places a player with a respawn state of 1 at the respawn data (554164 / 554210), not
  // at a TObjPlayerSet, so the source 0 is not used there: placePlayer below overrides
  // the view's own spawn. The floor's group 0 spawn still places the objects and NPCs. DAT_0097df90 is
  // sent for the state-3 players only (FUN_007b4234), not for this player.
  // combat.returnedToCity refills HP and TP.
  private async returnToPioneer2(): Promise<void> {
    try {
      const a = pioneer2ReturnArrival(this.game.selfId, this.episode());
      await this.warpTo(0, 0, { x: a.x, y: a.y, z: a.z, angle: a.angle * BAMS_TO_RAD });
      if (this.game.self?.floor === 0) {
        this.combat.returnedToCity();
        this.log('returned to Pioneer 2');
      }
    } catch (err) {
      this.log(`return to Pioneer 2 failed: ${(err as Error).message}`);
    }
  }

  // 6x21 + 6x22, load, then 6x3F / 6x1F / 6x3B / 6x23.
  // `source` picks the TObjPlayerSet group. Unset: the exe's arrival kind of this
  // floor change (get_warp_type, formats/fieldspawn.ts), which the telepipe, the
  // Pioneer 2 return and the lobby entries do not use (they pass `arrival` or their
  // own source). p_return_guild passes 0 (the spawn in front of the Hunter's Guild).
  // `arrival`: where a telepipe puts the player (GetTeleportTargetDataForPlayer
  // _006e9630) instead of the floor's spawn point.
  async warpTo(floor: number, source?: number, arrival?: Arrival): Promise<void> {
    const me = this.game.self;
    if (!me || this.busy || floor === me.floor) return;
    this.busy = true;
    try {
      const from = me.floor;
      // The guard stance is the mover's before the warp; the exe's flag (character_flags
      // 0x100000) is not cleared by a floor load, so the 6x3F after it carries that value
      // (ASSUMED: the load does not clear it).
      const guard = this.view?.guarding ?? false;
      this.game.warp(floor);
      await this.loadFloor(floor, source ?? floorChangeSource(from, floor, this.episode()));
      if (arrival) this.view?.placePlayer(this.game.selfId, arrival.x, arrival.y, arrival.z, arrival.angle);
      // The room is get_player_room_id on the new floor at the position.
      this.game.finishWarp(me.position.x, me.position.y, me.position.z, me.angle, { guard, room: this.playerRoom(me.position) });
    } finally {
      this.busy = false;
    }
  }

  private async loadFloor(floor: number, source: number): Promise<void> {
    this.view?.dispose();
    this.view = null;
    this.enemyLayer.clear();
    this.objectLayer.clear();
    this.npcs.clear();
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
      const npcModels = await this.showNpcs(placed, area);
      if (this.disposed) return;
      for (const p of npcModels) modeled.add(p);
      const s = this.enemyLayer.stats;
      this.log(`quest floor ${floor}: ${s.placed} enemy models placed${s.unresolved.length ? `, no model: ${[...new Set(s.unresolved)].join(', ')}` : ''}`);
      placedObjects = placed.filter((p) => p.entity.kind === 'object');
      const objectModels = await this.objectLayer.show(placedObjects, { area, episode: this.episode(), ultimate: info.difficulty === 3 });
      if (this.disposed) return;
      this.viewer.setEntities(placed.filter((p) => !modeled.has(p) && !objectModels.has(p)));
      this.viewer.setFogRegions(placed);
      this.viewer.setEntitiesVisible(SHOW_MARKERS);
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
      const npcModels = await this.showNpcs(placed, area);
      if (this.disposed) return;
      for (const p of npcModels) modeled.add(p);
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
      this.viewer.setEntitiesVisible(SHOW_MARKERS);
    }

    this.floorSpawns = allSpawnPoints(objects, sections);
    // The floor has player sets (of any source): a client id without one of this source
    // is the origin (lobbySpawnAt, 554194), not the spiral search of a set-less map.
    mapData.hasSpawnSets = playerSpawns(objects).length > 0;
    const me = this.game.self!;
    me.floor = floor;
    me.position = { x: 0, y: 0, z: 0 };
    this.view = new LobbyView(this.viewer, this.game, mapData, {
      labels: this.labels,
      showPlayer: (p) => p.floor === this.game.self?.floor && p.visible !== false,
      held: this.heldSource(),
      // Pioneer 2: the talk's target height (render/playercamera.ts). ASSUMED area test.
      town: AREA_NAMES[area] === 'Pioneer 2',
      // The game's maps, Pioneer 2 included, use the field motion set (DAT_00a943cc = 1 in a
      // game, 0 in the lobby: FUN_006a745c / FUN_006a7748). ASSUMED for Pioneer 2 (a game area).
      field: true,
      // 6x3E / 6x3F room: get_player_room_id on this floor's map (the field's section).
      room: (pos) => this.playerRoom(pos),
    });
    const objectBase = await this.objectBase(floor);
    // The quest's floor handler runs on a new thread when the player arrives
    // (quest_start_floor_thread, PsoBB.exe .c:615128).
    this.quest?.enterFloor(floor);
    // The joiner's 6x6E is game-wide: the field takes this floor's part.
    const syncFloor = this.game.joinSync.received.setFlags ? ((await this.syncLayout()).floors[floor] ?? null) : null;
    this.field.enterFloor(floor, area, {
      placed: placedObjects,
      objectBase,
      sync: syncFloor,
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
    // The NPCs walk on the floor's collision and block the players there.
    this.npcs.attach(mapData.collision);
    this.npcs.players = () => this.floorPlayers();
    this.floorItems.enterFloor(floor, area, placedObjects, objectBase);
    this.floorItems.attach();
    const attacking = this.combat.isAttacking;
    this.view.attacking = (id) => attacking(id) || (id === this.game.selfId && (this.inputBlocked() || this.telepipes.using));
    // The dead camera (render/playercamera.ts): the dead flag of the local player.
    this.view.dead = () => this.combat.damage.dead;
    await this.combat.enterFloor(floor, area, enemySets, await this.combat.enemyBase(floor));
    if (this.disposed) return;
    this.combat.attach(this.view);
    this.hud.attach();
    if (this.combat.hud) this.combat.hud.hudFlags = () => this.hud.hudFlags;
    // The floor's minimap (map_*r.rel) and its TObjRaderCol (0x17) objects.
    const raderCols = placedObjects
      .filter((p) => p.entity.kind === 'object' && p.entity.type === 0x17)
      .map((p) => ({ x: p.world[0], z: p.world[2], radius: p.entity.kind === 'object' ? p.entity.params[0] : 0, room: p.entity.kind === 'object' ? p.entity.params[3] : -1 }));
    // TObjRaderHideCol (0x1f: radius param1) and TObjRaderIcon (0x27) of the floor.
    const raderHides: RaderHide[] = [];
    const raderIcons: RaderIconObject[] = [];
    for (const p of placedObjects) {
      if (p.entity.kind !== 'object') continue;
      const pos = { x: p.world[0], y: p.world[1], z: p.world[2] };
      if (p.entity.type === 0x1f) raderHides.push({ ...pos, radius: p.entity.params[0], inside: false });
      else if (p.entity.type === 0x27) raderIcons.push(raderIconObject(p.entity.params, pos, radToBams(p.yaw)));
    }
    void this.hud.enterFloor(floor, area, geometry, (name) => readIfPresent(this.source, `scene/${name}`), raderCols, raderHides, raderIcons);
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
    this.placedObjects = placedObjects;
    this.telepipes.enterFloor();
    this.onFloor(this.current);
    for (const h of this.floorHooks) h(this.current);
  }

  // A player's minimap marker (unknown_minimap_update_players): position and
  // heading as drawn, coloured by client slot.
  private minimapPlayer(clientId: number): MinimapPlayer | null {
    const pose = this.view?.playerPose(clientId);
    return pose ? { slot: clientId, x: pose.x, y: pose.y, z: pose.z, heading: radToBams(pose.angle) } : null;
  }

  // The doors of the floor as minimap icons (red while locked): TObjDoor (0x0080) by its
  // state (UpdatePlayerActionState_00656e28); the beam-family doors (0x0202, 0x0204) by bit 0
  // (UpdateSeabedDolphinPlayerMinimapIcon_00657718, 0x00657e00: green while bit 0 is set).
  private doorMinimapIcons(): Icon[] {
    const doors = this.fieldObjects?.doors ?? [];
    return doors.filter((d) => !d.city).map((d) => doorIcon(d.x, d.z, radToBams(d.yaw), doorMapLocked(d)));
  }

  // The Komo variant 6 objects as minimap icons (Episode 2 only: the exe's
  // icon call is behind g_CurrentEpisode == 2). The colour is the state the
  // object had at the start of the frame (render/fieldobjects.ts stepKomo).
  private komoMinimapIcons(): Icon[] {
    if (this.episode() !== 2) return [];
    return (this.fieldObjects?.komos ?? []).map((k) => komoVariant6Icon(k.value, k.shown, radToBams(k.yaw), k));
  }

  // Where the players on the local player's floor stand (the NPCs' collision).
  private floorPlayers(): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const floor = this.game.self?.floor;
    for (const [id, p] of this.game.players) {
      if (p.floor !== floor) continue;
      const pose = this.view?.playerPose(id);
      if (pose) out.push({ x: pose.x, z: pose.z });
    }
    return out;
  }

  // NPC models of the floor (render/npcview.ts); returns the entries drawn.
  private async showNpcs(placed: ReturnType<typeof placeEntities>, area: number): Promise<Set<(typeof placed)[number]>> {
    const done = await this.npcs.show(placed, { area, sectionId: this.game.self?.sectionId ?? 0 });
    // The enemy-built NPCs (0x33, 0x45, 0x46, 0xa9) are drawn by the enemy layer; they
    // talk through the NPC layer (NpcLayer.adoptEnemyNpcs).
    const adopted: { placed: (typeof placed)[number]; root: THREE.Object3D }[] = [];
    for (const p of placed) {
      if (p.category !== 'npc' || p.entity.kind !== 'enemy' || !NPC_ENEMY_TYPES.has(p.entity.type)) continue;
      const root = this.enemyLayer.model(p.entity.index);
      if (root) adopted.push({ placed: p, root });
    }
    this.npcs.adoptEnemyNpcs(adopted);
    const n = this.npcs.stats;
    if (n.placed || n.unresolved.length || n.errors.length) {
      this.log(
        `NPC models: ${n.placed} placed${n.hidden ? `, ${n.hidden} not loaded on this map` : ''}` +
          `${n.unresolved.length ? `, no model: ${[...new Set(n.unresolved)].join(', ')}` : ''}` +
          `${n.errors.length ? `, errors: ${n.errors.join('; ')}` : ''}`,
      );
    }
    return done;
  }

  // --- what quest/town.ts asks of the view ---

  get camera(): THREE.Camera {
    return this.viewer.camera;
  }

  // The local player's position and facing (radians), as drawn.
  selfPose(): { x: number; y: number; z: number; angle: number } | null {
    return this.view?.playerPose(this.game.selfId) ?? null;
  }

  // The action palette is flipped (Ctrl): the End key's quick menu needs it (classic/field.ts).
  paletteFlipped(): boolean {
    return this.hud.paletteFlipped();
  }

  // Head point of a player (speech balloons of `message` with a client id).
  playerHead(clientId: number): THREE.Vector3 | null {
    const p = this.view?.playerPose(clientId);
    if (!p) return null;
    return new THREE.Vector3(p.x, p.y + (this.view?.playerHeight(clientId) ?? 16) * 0.92, p.z);
  }

  // The floor's player spawns (battle respawn, quest/battletraps.ts pickRespawn).
  respawnPoints(): readonly SpawnPoint[] {
    return this.floorSpawns;
  }

  // Moves a player at once (6x24 / set_player_start_position), radians.
  placePlayer(clientId: number, x: number, y: number, z: number, angle: number): void {
    this.view?.placePlayer(clientId, x, y, z, angle);
  }

  // Turns the local player (an NPC talk turns the player to the NPC).
  // The camera's current view and the default NPC talk camera
  // (render/lobbyview.ts).
  cameraView(): { source: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null {
    return this.view?.cameraView() ?? null;
  }

  talkCameraTurn(): void {
    this.view?.talkCameraTurn();
  }

  talkCameraEnd(): void {
    this.view?.talkCameraEnd();
  }

  setSelfAngle(angle: number): void {
    const p = this.selfPose();
    if (p) this.view?.placePlayer(this.game.selfId, p.x, p.y, p.z, angle);
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

  // reset_map: floor items and the field's flags, waves and constructed
  // objects start over (reset_floor_items_for_chl_reset and the resets after it).
  resetMap(): void {
    this.field.resetState();
    for (const it of [...this.items.floorItems.values()]) {
      this.items.floorItems.delete(it.id);
      this.items.onFloorItemRemoved(it);
    }
  }

  // The ground under (x, z) probed down from fromY with a collision mask (the grave's
  // drop test uses 0x55, Enemygetgroundinfo_007b4c58 for an entity with no entity bits).
  groundProbe(x: number, z: number, fromY: number, mask = 0x55): number | null {
    return this.collision ? this.collision.groundHeight(x, z, fromY, mask) : this.viewer.groundHeight(x, z, fromY);
  }

  roomAt(pos: { x: number; y: number; z: number }): number {
    return this.field.roomAt(pos);
  }

  // The room a player sends in 6x3F / 6x3E at `pos` (get_player_room_id, formats/playerroom.ts):
  // Pioneer 2 gives 0, the field's section otherwise, both exe fields holding that section.
  playerRoom(pos: { x: number; y: number; z: number }): number {
    const r = this.field.roomAt(pos);
    return playerRoomId(this.current?.area ?? -1, r, r);
  }

  zoneCleared(floor: number, room: number): boolean {
    return this.field.zoneCleared(floor, room);
  }

  // construct_delayed_enemy (0x8B): make a room's wave appear now, the way a
  // wave event's construct_enemies action does (render/waves.ts).
  constructEnemies(floor: number, room: number, wave: number): void {
    this.field.constructEnemies(floor, room, wave);
  }

  // construct_delayed_object (0x8A): the floor's delayed objects of a room
  // and group appear, as an event's construct_objects action does.
  constructObjects(floor: number, room: number, group: number): void {
    this.field.constructObjects(floor, room, group);
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
    this.telepipes.dispose();
    this.hud.dispose();
    this.field.dispose();
    this.floorItems.dispose();
    this.items.dispose();
    this.view?.dispose();
    this.view = null;
    this.enemyLayer.dispose();
    this.npcs.dispose();
    this.objectLayer.dispose();
    this.viewer.clearEntities();
  }
}

// TObjPlayerSet entries of the floor (param1 = client id, param4 = arrival source).
// Every TObjPlayerSet of the floor, in the object list's order (SendTeleportRequestToPlayer walks that list).
function allSpawnPoints(objects: ObjectSetEntry[], sections: MapSection[]): SpawnPoint[] {
  return playerSpawns(objects).map((s) => {
    const room = sections.find((r) => r.id === s.room);
    const [x, y, z] = roomToWorld(s.position, room);
    return { x, y, z, angle: (s.angleY / 0x10000) * Math.PI * 2 + (room?.rotation[1] ?? 0) };
  });
}

// The sets of one source only (formats/fieldspawn.ts spawnsOfSource): the exe has
// no fallback to another source, a client id without one is the origin (lobbySpawnAt).
function spawnsFor(objects: ObjectSetEntry[], sections: MapSection[], source: number): Map<number, LobbySpawn> {
  const out = new Map<number, LobbySpawn>();
  for (const [clientId, s] of spawnsOfSource(playerSpawns(objects), source)) {
    const room = sections.find((r) => r.id === s.room);
    const [x, y, z] = roomToWorld(s.position, room);
    out.set(clientId, { x, y, z, angle: (s.angleY / 0x10000) * Math.PI * 2 + (room?.rotation[1] ?? 0) });
  }
  return out;
}


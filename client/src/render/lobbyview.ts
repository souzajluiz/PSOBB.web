// 3D lobby: renders the lobby map, the players' character models, and drives
// the local player with WASD, sending 6x42 (run) while moving and 6x3E (stop)
// on release. Walking uses the map collision (c.rel); players start at the
// lobby's TObjPlayerSet spawn point for their client id (map_lobby_NNo.dat).
// Models come from pl<L>nj.bml / pl<L>tex.afs with the appearance of the
// lobby join data, animated with the town idle / walk / run motions of
// plymotiondata.rlc (formats/plymotion.ts). Until a model is loaded (or when
// the files are missing) a capsule stands in.

import { PlayerCamera } from './playercamera.ts';
import { njPerspectiveFovy } from '../classic/playerview.ts';
import { KEYS, keyboardControlsOn } from '../input/keyconfig.ts';
import { autoKey, AUTO_RUN_FALLBACK, AUTO_WALK_FALLBACK, autoMoveAxes, autoMoveStart, stepAutoMove, type AutoMoveState } from '../input/automove.ts';
import { analogStick, stickAmount, takeCameraTurn } from '../input/analog.ts';
import * as THREE from 'three';
import { ClientFiles } from '../data/clientfiles.ts';
import type { DataSource } from '../data/source.ts';
import { parseMapCRel } from '../formats/crel.ts';
import { parseMapNRel, type MapSection } from '../formats/nrel.ts';
import { playerRoomAt } from '../formats/playerroom.ts';
import { lobbySpawnAt, type LobbySpawn } from '../formats/lobbyspawn.ts';
import { parseObjectSets, playerSpawns, roomToWorld } from '../formats/objset.ts';
import { parseObjectSets as parseSetObjects, placeEntities, type PlacedEntity } from '../formats/setdata.ts';
import { ObjectLayer } from './objectview.ts';
import { fieldLocomotion, locomotionSlot, LOCOMOTION_FACTOR, PLAYER_MOTION_FILE, PlayerMotions, townMotion, type Locomotion, type MotionRecord } from '../formats/plymotion.ts';
import { EMOTE_OPCODE, SIT_OPCODE, SIT_SLOT_CHAIR, SIT_SLOT_PLAIN, altEmoteKey, emotePayload, emoteRecord, emoteSlot, sitEndKey, sitPayload } from '../formats/emotes.ts';
import type { Lobby, LobbyPlayer } from '../net/lobby.ts';
import type { SetPositionState } from '../net/game.ts';
import { CollisionWorld, STEP_UP, type Body } from './collision.ts';
import type { MapViewer } from './mapviewer.ts';
import { PlayerAnimator, skeletonNodePosition } from './playeranim.ts';
import { HAND_BODY_NODE, type WeaponNodeRef } from '../combat/weaponorigin.ts';
import { PlayerMover, RAND_MAX_C, fromBams, legSpeed, modifyDirection, rampAxis, remoteStep, toBams, type Follower, type LegState } from './playermove.ts'; // exe: 1.5 / 1.0 units per tick
import { buildPlayerModel, classLetter, loadPlayerAssets, type PlayerAssets } from './playermodel.ts';
import { HeldWeaponFiles, type HeldWeapon } from './heldweapon.ts';
import { buildMagRig, disposeMagRig, magKey, setMagRigVisible, updateMagRig, type MagEquip, type MagRig } from './magmodel.ts';
import { parseMagMotion, type MagMotionRecord } from '../formats/itemmagmotion.ts';
import type { MagEdit } from '../formats/itemmagedit.ts';

const CLASS_COLORS = [
  0xd64545, 0xe0607a, 0xa83232, // HUmar, HUnewearl, HUcast
  0x3f86d6, 0x2f5fa8, 0x4fa3c9, // RAmar, RAcast, RAcaseal
  0x9a59d1, 0xb57be0, 0xc79bf0, // FOmarl, FOnewm, FOnewearl
  0xc94f4f, 0x7a3fb0, 0x5fa8e8, // HUcaseal, FOmar, RAmarl
];

export function lobbyMapFile(lobbyNumber: number): string {
  return `map_${lobbyArea(lobbyNumber)}n.rel`;
}

function lobbyArea(lobbyNumber: number): string {
  return `lobby_${String((lobbyNumber % 10) + 1).padStart(2, '0')}`;
}

export type { LobbySpawn };

export interface LobbyMapData {
  collision: CollisionWorld | null;
  spawns: Map<number, LobbySpawn>; // by client id, the sets of the arrival source
  // The map has player sets of any source (lobbySpawnAt); unset: spawns.size > 0.
  hasSpawnSets?: boolean;
  // Client files for the player models and motions (null: capsules only).
  files: ClientFiles | null;
  // TObjInfoCol (object type 0x0180): information counter trigger circles,
  // world x/z and radius (param1).
  infoCols?: Array<{ x: number; z: number; radius: number }>;
  // TObjLobbyMain entries placed like the field's objects (the seasonal model,
  // objectmodels.ts lobbyMainSpec, is drawn by LobbyView).
  mainObjects?: PlacedEntity[];
  // The lobby's map sections (map_NNn.rel rooms): the room a stop sends (playerRoomAt).
  sections?: MapSection[];
}

// The lobby map's area (the exe's map_id lobby = 15; class 14, so the room is _1).
const LOBBY_AREA = 15;

// The lobby objects of map_lobby_NNo.dat that collide (object factory
// 0x00a06be0, the constructors checked for InitEnemyCollisionBoxes_007b9a88 /
// ConstructEntityHitbox_007b9ccc): only TObjLobbyMain (0x0182, create
// 0x00672254, constructor 0x006722d0) has a hitbox, the round box 0x009c9778:
// center at the object, radius 32, flags 0x10003. The info counters
// (TObjInfoCol 0x0180), the lobby warp, pigeons, butterflies, pumpkins,
// stained glass, curtain, aquarium, particles and fish have none (the
// counters themselves are map collision). Players run into it with the rule
// of CollisionWorld.bodies (EnemyHandleCollisionStepUp_007b7704 through
// MericarolProcessCollision_007b7e9c, the player-vs-object pass).
export const LOBBY_MAIN_RADIUS = 32;
export function lobbyMainBody(x: number, z: number): Body {
  return { x, z, radius: LOBBY_MAIN_RADIUS };
}

// Loads the lobby's collision (scene/map_lobby_NNc.rel) and player spawn points
// (map_lobby_NNo.dat from data.gsl, positions relative to the n.rel rooms).
// `arrival` is the arrival source (lobbyArrivalSource); every lobby set is source 0
// in the data, so the default 0 finds them all. Missing files only degrade the
// view, so errors are reported and swallowed.
export async function loadLobbyMapData(source: DataSource, lobbyNumber: number, log: (msg: string) => void = () => {}, arrival = 0): Promise<LobbyMapData> {
  const area = lobbyArea(lobbyNumber);
  const files = new ClientFiles(source);
  const data: LobbyMapData = { collision: null, spawns: new Map(), files, infoCols: [] };
  try {
    data.collision = new CollisionWorld(parseMapCRel(await source.read(`scene/map_${area}c.rel`)));
  } catch (err) {
    log(`no collision for ${area}: ${(err as Error).message}`);
  }
  try {
    const rooms = parseMapNRel(await source.read(`scene/map_${area}n.rel`)).sections;
    data.sections = rooms;
    const raw = await files.read(`map_${area}o.dat`);
    const sets = parseObjectSets(raw);
    // TObjLobbyMain (0x0182) and the centre teleporter TObjWarpLobby (0x0181, the beam).
    const mains = parseSetObjects(raw).filter((o) => o.type === 0x0182 || o.type === 0x0181);
    if (mains.length) data.mainObjects = placeEntities(mains, rooms, 1);
    const all = playerSpawns(sets);
    data.hasSpawnSets = all.length > 0;
    for (const s of all) {
      if (s.source !== arrival || data.spawns.has(s.clientId)) continue;
      const room = rooms.find((r) => r.id === s.room);
      const [x, y, z] = roomToWorld(s.position, room);
      data.spawns.set(s.clientId, { x, y, z, angle: (s.angleY / 0x10000) * Math.PI * 2 + (room?.rotation[1] ?? 0) });
    }
    for (const o of sets) {
      if (o.type === 0x0182 && data.collision) {
        // TObjLobbyMain blocks the players with its round hitbox (lobbyMainBody).
        const [x, , z] = roomToWorld(o.position, rooms.find((r) => r.id === o.room));
        data.collision.bodies.push(lobbyMainBody(x, z));
      }
      if (o.type !== 0x0180) continue;
      const [x, , z] = roomToWorld(o.position, rooms.find((r) => r.id === o.room));
      data.infoCols!.push({ x, z, radius: o.fparams[0] });
    }
  } catch (err) {
    log(`no spawn points for ${area}: ${(err as Error).message}`);
  }
  return data;
}

function nameSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 28px system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  canvas.width = w;
  canvas.height = 40;
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(2, 16, 30, 0.75)';
  ctx.fillRect(0, 0, w, 40);
  ctx.fillStyle = '#d8ecff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8, 21);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(w / 6, 40 / 6, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// What the field shows of the held weapon: the equipped weapon's ItemPMT model
// (type, skin) of a player, and whether weapons show here (not in the hubs).
export interface HeldWeaponSource {
  equipped(clientId: number): { type: number; skin: number } | null;
  visible(): boolean;
  // The motion class of the player's weapon (0..18, 0 = none), which picks the field
  // motions (formats/plymotion.ts fieldLocomotion). Absent: 0.
  motionClass?(clientId: number): number;
  // The player's equipped MAG (render/magmodel.ts), and ItemMagEdit's tables once loaded
  // (null: not yet). Absent: no MAG.
  mag?(clientId: number): MagEquip | null;
  magEdit?(): MagEdit | null;
}

interface Marker {
  clientId: number;
  group: THREE.Group;
  target: THREE.Vector3;
  angle: number;
  capsule: THREE.Object3D | null;
  model: THREE.Object3D | null;
  // The held weapon's mesh in the model (null: none) and the weapon key the
  // model was built with ('type:skin', '' for none).
  weapon: THREE.SkinnedMesh | null;
  weaponKey: string;
  animator: PlayerAnimator | null;
  // The body's bones (depth-first, the model's partBones[0]); null until the model loads.
  body: THREE.Bone[] | null;
  // The held weapon's bones in the exe's walk order (playermodel.ts weaponBones), or null.
  weaponBones: THREE.Bone[] | null;
  // The equipped MAG's rig (null: none) and the key it was built or is being built with.
  mag: MagRig | null;
  magKey: string;
  charClass: number;
  gait: Locomotion;
  follow: Follower; // the tick-rate state of a remote player's run toward `target`
  legDir: { x: number; z: number }; // unit direction of the player's last leg (dead reckoning)
  moveTicks: number;
  lastX: number; // the logic position one tick ago (for drawing between ticks)
  lastZ: number;
  label: THREE.Sprite | null;
  labelText: string;
}

// Stand-in until the model is loaded.
function capsule(charClass: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(4, 10, 4, 12), new THREE.MeshBasicMaterial({ color: CLASS_COLORS[charClass] ?? 0xcccccc }));
  body.position.y = 9;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(2, 6, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 13, 5);
  g.add(body, nose);
  return g;
}

function disposeObject(o: THREE.Object3D, disposeMaps: boolean): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh || c instanceof THREE.Sprite) {
      c.geometry.dispose();
      const mats = (Array.isArray(c.material) ? c.material : [c.material]) as (THREE.Material & { map?: THREE.Texture | null })[];
      for (const mat of mats) {
        // Player textures are shared by every model of the class.
        if (disposeMaps) mat.map?.dispose();
        mat.dispose();
      }
    }
  });
}

export class LobbyView {
  private viewer: MapViewer;
  private lobby: Lobby;
  private markers = new Map<number, Marker>();
  // The client's player camera (render/playercamera.ts): five zoom levels,
  // chasing behind the player while it runs.
  private camera = new PlayerCamera();
  private cameraKeyHeld = false;
  private get cameraYaw(): number {
    return this.camera.angle;
  }
  // Placing the player (spawn, warps) puts the camera behind it and shows
  // it there at once (PlayerCamera.snap).
  private set cameraYaw(v: number) {
    this.camera.angle = v;
    this.camera.snap();
  }
  private sentLeg = -1; // the mover's leg serial of the last 6x40 / 6x42
  private mover = new PlayerMover();
  private drawn = new THREE.Vector3(); // what the view drew last frame
  private logic = new THREE.Vector3(); // the tick-rate position the mover works on
  private prevLogic = new THREE.Vector3();
  private moveTicks = 0;
  private keyFb = 0;
  private keyLr = 0;
  private auto: AutoMoveState = autoMoveStart(); // auto run / walk (input/automove.ts)
  private wasMoving = false;
  private sentGait: 'walk' | 'run' | null = null;
  private disposers: Array<() => void> = [];
  private collision: CollisionWorld | null;
  private spawns: Map<number, LobbySpawn>;
  // The map has player sets (of any source): a missing one is the exe's origin (lobbySpawnAt).
  private hasSpawnSets: boolean;
  private mainObjects: ObjectLayer | null = null; // TObjLobbyMain models (disposed with the view)
  private files: ClientFiles | null;
  private assets = new Map<number, Promise<PlayerAssets>>();
  private motions: Promise<PlayerMotions> | null = null;
  private held: HeldWeaponSource | null;
  // The players' gait uses the field motion set (weapon-dependent) instead of the town set.
  private fieldMotions: boolean;
  private heldFiles: HeldWeaponFiles | null = null;
  private itemFiles: ClientFiles | null = null;
  private magMotion: Promise<MagMotionRecord[]> | null = null;
  private disposed = false;

  // labels: false leaves the name tags to the caller (classic HUD).
  private labels: boolean;
  // Which players to show (games: only the ones on the local player's floor).
  private showPlayer: (p: LobbyPlayer) => boolean;
  // While this returns true for a player, its gait motion is not played over
  // the attack motion and the local player does not move (render/combat.ts).
  attacking: (clientId: number) => boolean = () => false;
  // The emotes playing (formats/emotes.ts): a player's emote holds its motion to the
  // last frame (mode 3) and stops the local player; the gait resumes after it.
  // `sit` is set for a sit (6xAB) of the local player: it holds (state 0xab) until its own key.
  private emotes = new Map<number, { record: MotionRecord; sit?: { chair: boolean } }>();
  // The option 0x80000 (opposite gender flag) and last frame's keys (edge detection).
  private emoteOpposite = false;
  private prevKeys: ReadonlySet<string> = new Set();
  // The local player is dead or revivable (the dead camera orbits; set by GameView).
  dead: () => boolean = () => false;
  // The local player's slow and guard inputs (render/combat.ts in the field;
  // the lobby has no status effects and no target, so 0.5 / 0.75 never apply).
  legState: () => LegState = () => ({ slowed: false, target: null, confused: false });
  // The room a 6x3E / 6x3F sends at a point (get_player_room_id; the field passes its own).
  private roomOf: (pos: { x: number; y: number; z: number }) => number;

  // The local player's guard stance (the mover's, 0x0052ac5c): in_guard_stance in 6x3E / 6x3F.
  get guarding(): boolean {
    return this.mover.guard;
  }

  // The 6x3E state at `pos`: the guard stance and the room (net/lobby.ts stopBody).
  stopState(pos: { x: number; y: number; z: number }): SetPositionState {
    return { guard: this.mover.guard, room: this.roomOf(pos) };
  }

  constructor(
    viewer: MapViewer,
    lobby: Lobby,
    mapData: LobbyMapData = { collision: null, spawns: new Map(), files: null },
    options: { labels?: boolean; showPlayer?: (p: LobbyPlayer) => boolean; held?: HeldWeaponSource; town?: boolean; field?: boolean; room?: (pos: { x: number; y: number; z: number }) => number } = {},
  ) {
    this.labels = options.labels ?? true;
    this.roomOf = options.room ?? ((pos) => playerRoomAt(LOBBY_AREA, mapData.sections ?? [], pos));
    this.camera.town = options.town ?? false;
    this.fieldMotions = options.field ?? false;
    this.viewer = viewer;
    this.lobby = lobby;
    this.showPlayer = options.showPlayer ?? (() => true);
    this.held = options.held ?? null;
    this.heldFiles = this.held && mapData.files ? new HeldWeaponFiles(mapData.files) : null;
    this.collision = mapData.collision;
    (globalThis as { lobbyView?: LobbyView }).lobbyView = this; // console/automation access
    this.spawns = mapData.spawns;
    this.hasSpawnSets = mapData.hasSpawnSets ?? mapData.spawns.size > 0;
    this.files = mapData.files;
    this.itemFiles = mapData.files;
    if (mapData.files && mapData.mainObjects?.length) {
      // The seasonal decoration of TObjLobbyMain for this session's event (the
      // lobby's 64 join); a load error only leaves the decoration out.
      const layer = new ObjectLayer(viewer, mapData.files);
      this.mainObjects = layer;
      layer.show(mapData.mainObjects, { area: 0, episode: 1, event: lobby.event, lobby: true }).catch((err) => console.warn('lobby objects:', err));
    }
    // The map is unlit (vertex colors); the player materials are Lambert, lit by
    // the area light the viewer takes from lightentry.bin (MapViewer.setArea).
    viewer.setOrbitEnabled(false);
    viewer.onFrame = (dt, keys) => this.frame(dt, keys);

    const sync = (p: LobbyPlayer) => {
      if (this.disposed) return;
      if (p.clientId === lobby.selfId || this.showPlayer(p)) this.addMarker(p);
      else this.removeMarker(p.clientId);
    };
    for (const p of lobby.players.values()) if (p.clientId === lobby.selfId || this.showPlayer(p)) this.addMarker(p);
    lobby.on('playerJoined', sync);
    // A player's marker follows its floor and its visibility (a player hides
    // while it changes floors: 6x22, shows again with 6x23).
    const recheck = (p: LobbyPlayer) => {
      if (!this.disposed && this.markers.has(p.clientId) !== this.showPlayer(p)) sync(p);
    };
    lobby.on('floorChanged', recheck);
    lobby.on('visibilityChanged', recheck);
    lobby.on('playerLeft', (id) => this.removeMarker(id));
    lobby.on('moved', (p) => this.onMoved(p));
    lobby.on('teleported', (p) => {
      if (p.clientId !== this.lobby.selfId) this.place(p.clientId, p.position, p.angle);
    });
    // 6x58: another player's emote (the local player's own is played in frame()).
    lobby.on('emote', (p, slot) => {
      if (p.clientId !== this.lobby.selfId) this.playEmote(p.clientId, slot);
    });
    // 6xAB: another player's sit (the field has no sit slots: its getters are -1).
    lobby.on('sit', (p, chair) => {
      // The sit holds (state 0xab, FUN_0069b378 sets 0x10000000 for the chair) until the stop (6x3E) below.
      if (p.clientId !== this.lobby.selfId && !this.fieldMotions) this.playEmote(p.clientId, chair ? SIT_SLOT_CHAIR : SIT_SLOT_PLAIN, { chair });
    });
    // 6x3E from another player: its move_stop ends a remote sit (the sit is held until then).
    lobby.on('stopped', (p) => {
      if (p.clientId === this.lobby.selfId || !this.emotes.get(p.clientId)?.sit) return;
      this.emotes.delete(p.clientId);
      const m = this.markers.get(p.clientId);
      if (m) this.setGait(m, m.gait, true);
    });

    this.placeSelfOnGround();
    this.bindMouse(viewer.renderer.domElement);
  }

  // Ground under (x, z): map collision when available, else the render mesh.
  private ground(x: number, z: number, fromY: number): number | null {
    return this.collision ? this.collision.groundHeight(x, z, fromY) : this.viewer.groundHeight(x, z, fromY);
  }

  // The client puts a player joining a lobby on the TObjPlayerSet whose param1
  // equals its client id (12 per lobby, ids 0-11).
  private spawnFor(clientId: number): LobbySpawn | null {
    const s = lobbySpawnAt(this.spawns, clientId, this.hasSpawnSets);
    if (!s) return null;
    return { ...s, y: this.ground(s.x, s.z, s.y + STEP_UP) ?? s.y };
  }

  private placeSelfOnGround(): void {
    const me = this.lobby.self;
    if (!me) return;
    let spot = this.spawnFor(me.clientId);
    if (!spot) {
      // No spawn data: spiral out from the origin until the map has a floor under us.
      search: for (let r = 0; r < 400; r += 20) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
          const x = Math.cos(a) * r;
          const z = Math.sin(a) * r;
          const y = this.ground(x, z, 200);
          if (y !== null) {
            spot = { x, y, z, angle: me.angle };
            break search;
          }
          if (r === 0) break;
        }
      }
    }
    if (!spot) return;
    const { x, y, z, angle } = spot;
    me.position = { x, y, z };
    me.angle = angle;
    const m = this.markers.get(me.clientId);
    if (m) {
      m.group.position.set(x, y, z);
      m.target.set(x, y, z);
      m.angle = angle;
    }
    this.cameraYaw = angle + Math.PI; // camera behind the player
    this.lobby.sendStop(x, y, z, angle, this.stopState({ x, y, z }));
  }

  // The client has no mouse look: a click only gives the view the keyboard,
  // and the wheel steps the camera's zoom level (render/playercamera.ts).
  private bindMouse(canvas: HTMLCanvasElement): void {
    const down = () => canvas.focus();
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.camera.step(e.deltaY > 0 ? 1 : -1);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.disposers.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('wheel', wheel);
    });
  }

  private addMarker(p: LobbyPlayer): void {
    this.removeMarker(p.clientId);
    const group = new THREE.Group();
    const stand = capsule(p.charClass);
    group.add(stand);
    let label: THREE.Sprite | null = null;
    const labelText = `${p.name}  Lv${p.level}`;
    if (this.labels) {
      label = nameSprite(labelText);
      label.position.y = 24;
      group.add(label);
    }
    // A player that has not reported a position yet stands on its spawn point.
    const unplaced = p.position.x === 0 && p.position.y === 0 && p.position.z === 0;
    const spawn = unplaced && p.clientId !== this.lobby.selfId ? this.spawnFor(p.clientId) : null;
    if (spawn) group.position.set(spawn.x, spawn.y, spawn.z);
    else group.position.set(p.position.x, p.position.y, p.position.z);
    this.viewer.scene.add(group);
    const marker: Marker = {
      clientId: p.clientId,
      group,
      target: group.position.clone(),
      angle: spawn ? spawn.angle : p.angle,
      capsule: stand,
      model: null,
      weapon: null,
      weaponKey: '',
      animator: null,
      body: null,
      weaponBones: null,
      mag: null,
      magKey: '',
      charClass: p.charClass,
      gait: 'idle',
      follow: { x: 0, z: 0, heading: 0 },
      legDir: { x: 0, z: 1 },
      moveTicks: 0,
      lastX: 0,
      lastZ: 0,
      label,
      labelText,
    };
    this.markers.set(p.clientId, marker);
    console.info(`[lobby#${this.lobby.seq}] marker added: client ${p.clientId} "${p.name}" (markers ${this.markers.size})`);
    void this.loadModel(p, marker);
  }

  // Ids of the players with a marker (support: window.psoLobbyDebug()).
  markerIds(): number[] {
    return [...this.markers.keys()];
  }

  private classAssets(charClass: number): Promise<PlayerAssets> {
    let a = this.assets.get(charClass);
    if (!a) this.assets.set(charClass, (a = loadPlayerAssets(this.files!, charClass)));
    return a;
  }

  // The held weapon's key of a player ('type:skin', '' for none).
  private heldKey(clientId: number): string {
    const e = this.held?.equipped(clientId);
    return e ? `${e.type}:${e.skin}` : '';
  }

  private heldWeapon(key: string): Promise<HeldWeapon | null> {
    if (!key || !this.heldFiles) return Promise.resolve(null);
    const [type, skin] = key.split(':').map(Number);
    return this.heldFiles.load(type, skin).catch((err) => {
      console.warn(`held weapon ${key}: ${(err as Error).message}`);
      return null;
    });
  }

  // Builds (or rebuilds, when the held weapon changed) a player's model. The
  // weapon key is taken when the build starts; a build whose key went stale
  // is dropped (syncHeld starts the one for the new key).
  private async loadModel(p: LobbyPlayer, marker: Marker): Promise<void> {
    const key = this.heldKey(p.clientId);
    marker.weaponKey = key;
    if (!this.files || p.charClass < 0 || p.charClass > 11) return;
    try {
      this.motions ??= this.files.read(PLAYER_MOTION_FILE).then((d) => new PlayerMotions(d));
      const [assets, motions, weapon] = await Promise.all([this.classAssets(p.charClass), this.motions, this.heldWeapon(key)]);
      if (this.disposed || this.markers.get(p.clientId) !== marker || marker.weaponKey !== key) return;
      const model = buildPlayerModel(assets, p.appearance, { weapon });
      const body = assets.parts.get(`pl${classLetter(p.charClass)}bdy00.nj`)!;
      marker.animator = new PlayerAnimator(model.partBones[0], body, motions);
      marker.body = model.partBones[0];
      marker.weaponBones = model.weaponBones;
      if (marker.model) {
        marker.group.remove(marker.model);
        disposeObject(marker.model, false); // textures are shared
      }
      marker.model = model.root;
      marker.weapon = model.weapon;
      if (marker.weapon) marker.weapon.visible = this.held?.visible() ?? false;
      if (marker.capsule) {
        marker.group.remove(marker.capsule);
        disposeObject(marker.capsule, true);
        marker.capsule = null;
      }
      marker.group.add(model.root);
      this.setGait(marker, marker.gait, true);
    } catch (err) {
      console.warn(`[lobby#${this.lobby.seq}] player model failed: client ${p.clientId} "${p.name}": ${(err as Error).message}`);
    }
  }

  // Development hook (e2e): each marker's held weapon key, the key its model
  // was built with, the vertex count of its mesh (0: none), whether the mesh
  // is drawn (visible up the parent chain), and the MAG rig's parts and whether one is drawn.
  heldState(): { clientId: number; key: string; weaponKey: string; vertices: number; shown: boolean; mags: number; magShown: boolean }[] {
    return [...this.markers.values()].map((m) => {
      let shown = !!m.weapon;
      for (let o: THREE.Object3D | null = m.weapon; o && shown; o = o.parent) shown = o.visible;
      const parts = m.mag?.parts ?? [];
      return {
        clientId: m.clientId,
        key: this.heldKey(m.clientId),
        weaponKey: m.weaponKey,
        vertices: m.weapon?.geometry.attributes.position?.count ?? 0,
        shown,
        // The MAG rig: its parts, and whether one of them is drawn (visible up the parent chain).
        mags: parts.length,
        magShown: parts.some((p) => p.root.visible && (p.root.parent?.visible ?? false)),
      };
    });
  }

  // Each frame: the weapon shows only outside the hubs, and a player whose
  // held weapon changed gets its model rebuilt with the new one.
  private syncHeld(): void {
    if (!this.held) return;
    const visible = this.held.visible();
    for (const m of this.markers.values()) {
      if (m.weapon) m.weapon.visible = visible;
      const p = this.lobby.players.get(m.clientId);
      if (p && this.heldKey(m.clientId) !== m.weaponKey) void this.loadModel(p, m);
      this.syncMag(m);
    }
  }

  // The MAG of a marker (render/magmodel.ts): built once the body is loaded, and rebuilt when
  // the equipped MAG changes. The rig's parts are children of the marker's group.
  private syncMag(m: Marker): void {
    if (!this.held?.mag || !m.body) return;
    const key = magKey(this.held.mag(m.clientId));
    if (key === m.magKey) return;
    m.magKey = key;
    this.dropMag(m);
    if (key) void this.buildMag(m, key);
  }

  private async buildMag(m: Marker, key: string): Promise<void> {
    try {
      const equip = this.held?.mag?.(m.clientId) ?? null;
      const edit = this.held?.magEdit?.() ?? null;
      if (!equip || !edit || !this.heldFiles || !this.itemFiles) return;
      this.magMotion ??= this.itemFiles.read('itemmagmotion.dat').then((d) => parseMagMotion(d));
      const motion = await this.magMotion;
      const rig = await buildMagRig(this.heldFiles, equip, { edit, motion }, (node) => this.anchorPoint(m, node));
      if (!rig) return;
      if (this.disposed || this.markers.get(m.clientId) !== m || m.magKey !== key) {
        disposeMagRig(rig);
        return;
      }
      m.mag = rig;
      for (const part of rig.parts) m.group.add(part.root);
    } catch (err) {
      console.warn(`MAG of client ${m.clientId}: ${(err as Error).message}`);
    }
  }

  // Removes a marker's MAG rig (its parts leave the group before the group's children are disposed:
  // the model's textures are shared).
  private dropMag(m: Marker): void {
    if (!m.mag) return;
    for (const part of m.mag.parts) m.group.remove(part.root);
    disposeMagRig(m.mag);
    m.mag = null;
  }

  // A MAG part's anchor point: the body node's point, or the owner's position (node -1, or no such node).
  private anchorPoint(m: Marker, node: number): { x: number; y: number; z: number } {
    const out = { x: 0, y: 0, z: 0 };
    if (node >= 0 && skeletonNodePosition(m.body, node, out)) return out;
    return { x: m.group.position.x, y: m.group.position.y, z: m.group.position.z };
  }

  // Each frame: the MAGs follow their players (game ticks), and show outside the hubs.
  private updateMags(dt: number): void {
    if (!this.held) return;
    const shown = this.held.visible();
    for (const m of this.markers.values()) {
      if (!m.mag) continue;
      const p = this.lobby.players.get(m.clientId);
      m.group.updateWorldMatrix(true, false);
      const inv = m.group.matrixWorld.clone().invert();
      const v = new THREE.Vector3();
      updateMagRig(
        m.mag,
        dt,
        { x: m.group.position.x, y: m.group.position.y, z: m.group.position.z },
        (node, out) => skeletonNodePosition(m.body, node, out),
        (w) => {
          v.set(w.x, w.y, w.z).applyMatrix4(inv);
          return { x: v.x, y: v.y, z: v.z };
        },
        !(p?.moving ?? false),
      );
      setMagRigVisible(m.mag, shown && !!m.model);
    }
  }

  // Town idle / walk / run motion of the marker's class.
  private setGait(m: Marker, gait: Locomotion, force = false): void {
    if (m.gait === gait && !force) return;
    m.gait = gait;
    if (!m.animator) return;
    if (this.attacking(m.clientId) || this.emoting(m.clientId)) return;
    const cls = m.charClass;
    if (this.fieldMotions) {
      // Field: the weapon's column of the field tables (loop records, no chain).
      const weaponClass = this.held?.motionClass?.(m.clientId) ?? 0;
      m.animator.play(fieldLocomotion(cls, weaponClass, gait), LOCOMOTION_FACTOR[gait]);
      return;
    }
    m.animator.play(townMotion(cls, locomotionSlot(cls, gait)), LOCOMOTION_FACTOR[gait], (slot) => townMotion(cls, slot));
  }

  private removeMarker(id: number): void {
    const m = this.markers.get(id);
    if (!m) return;
    this.viewer.scene.remove(m.group);
    this.dropMag(m);
    for (const child of m.group.children) disposeObject(child, child !== m.model);
    this.markers.delete(id);
    console.info(`[lobby#${this.lobby.seq}] marker removed: client ${id} (markers ${this.markers.size})`);
  }

  // Puts a player's model at a spot at once (intra-floor warps, 6x55).
  private place(clientId: number, pos: { x: number; y: number; z: number }, angle: number): void {
    const m = this.markers.get(clientId);
    if (!m) return;
    m.group.position.set(pos.x, pos.y, pos.z);
    m.target.set(pos.x, pos.y, pos.z);
    m.angle = angle;
  }

  // An intra-floor warp of the local player: sends 6x55 and moves the model
  // and the camera behind it.
  warpSelf(pos: { x: number; y: number; z: number }, angle: number): void {
    const me = this.lobby.self;
    if (!me) return;
    const y = this.ground(pos.x, pos.z, pos.y + STEP_UP) ?? pos.y;
    const to = { x: pos.x, y, z: pos.z };
    this.lobby.sendIntraMapWarp(to, angle);
    this.place(me.clientId, to, angle);
    this.cameraYaw = angle + Math.PI;
  }

  private onMoved(p: LobbyPlayer): void {
    if (p.clientId === this.lobby.selfId) return;
    const m = this.markers.get(p.clientId);
    if (!m) return;
    const y = p.moving ? (this.ground(p.position.x, p.position.z, m.group.position.y + STEP_UP) ?? m.group.position.y) : p.position.y;
    m.target.set(p.position.x, y, p.position.z);
    if (!p.moving) m.angle = p.angle;
    // The leg's direction: from the follower toward its new point (kept when that is too short).
    const lx = p.position.x - m.follow.x;
    const lz = p.position.z - m.follow.z;
    const len = Math.hypot(lx, lz);
    if (len > 0.5) m.legDir = { x: lx / len, z: lz / len };
  }

  // One tick's move of the local player through the map collision.
  private stepPlayer(pos: THREE.Vector3, dx: number, dz: number): { x: number; z: number } {
    if (this.collision) {
      const r = this.collision.move(pos.x, pos.y, pos.z, dx, dz);
      pos.set(r.x, r.y, r.z);
    } else {
      const y = this.viewer.groundHeight(pos.x + dx, pos.z + dz, pos.y + 30);
      // Only walk onto floor that is not a wall-sized step.
      if (y !== null && Math.abs(y - pos.y) < 25) pos.set(pos.x + dx, y, pos.z + dz);
    }
    return { x: pos.x, z: pos.z };
  }

  // Whether a player is in an emote (its motion is the emote's, not the gait's).
  emoting(clientId: number): boolean {
    return this.emotes.has(clientId);
  }

  // Plays an emote slot on a player (the lobby's map or the field's, by the view).
  // The field record takes the held weapon's column (the same as the gait).
  playEmote(clientId: number, slot: number, sit?: { chair: boolean }): void {
    const m = this.markers.get(clientId);
    if (!m || !m.animator || this.attacking(clientId)) return;
    const weaponClass = this.fieldMotions ? this.held?.motionClass?.(clientId) ?? 0 : 0;
    let record: MotionRecord;
    try {
      record = emoteRecord(m.charClass, weaponClass, slot, this.fieldMotions);
    } catch (err) {
      console.warn(`emote ${slot}: ${(err as Error).message}`);
      return;
    }
    this.emotes.set(clientId, sit ? { record, sit } : { record });
    m.animator.play(record, 1);
  }

  // Each frame: an emote that reached its last frame ends (the gait returns), a
  // local sit does not (it holds until its key); the local player's input is
  // polled once per frame, in the exe's order of handle_player_emote_input: the
  // chat queue first, then Alt+U / Alt+I (sit), then the option 0x80000 from
  // Alt+Shift, then the Alt+<key> emotes (the Alt block).
  private emoteTick(me: LobbyPlayer | null, keys: ReadonlySet<string>): void {
    for (const [id, e] of this.emotes) {
      const m = this.markers.get(id);
      if (!m || !m.animator || (m.animator.ended && !e.sit)) {
        this.emotes.delete(id);
        if (m) this.setGait(m, m.gait, true);
      }
    }
    // Edge-triggered keys (was_key_pressed): down this frame and not the last.
    const prev = this.prevKeys;
    this.prevKeys = new Set(keys);
    const edge = (k: string) => keys.has(k) && !prev.has(k);
    if (!me) return;
    const alt = keys.has('alt');
    const sitting = this.emotes.get(me.clientId)?.sit;
    if (sitting) {
      // handle_input_state_0xab: only the sit's own key ends it (move_stop); the
      // movement input does not (the exe sends a packet and keeps the state).
      const m = this.markers.get(me.clientId);
      if (alt && edge(sitEndKey(sitting.chair))) {
        this.emotes.delete(me.clientId);
        if (m) this.setGait(m, m.gait, true);
      }
      return;
    }
    if (this.emoting(me.clientId) || this.attacking(me.clientId) || this.dead()) return;
    const key = this.lobby.emoteQueue.head();
    if (key !== undefined) {
      this.lobby.emoteQueue.shift();
      const slot = emoteSlot(key, this.fieldMotions);
      if (slot === undefined) return;
      // The exe sends the emote whether or not the model is up (dispatch_action_emote).
      this.playEmote(me.clientId, slot);
      this.lobby.sendSubcommand(EMOTE_OPCODE, emotePayload(slot, this.emoteOpposite));
      return;
    }
    // Alt+U (slot 48) wins over Alt+I (49) when both are down, as in the exe. The
    // field's getters are -1 (no sit there): the exe still returns then, so the
    // Alt+<key> emotes of this poll are skipped too.
    if (alt && (edge('u') || edge('i'))) {
      if (!this.fieldMotions) {
        const chair = !edge('u');
        const slot = chair ? SIT_SLOT_CHAIR : SIT_SLOT_PLAIN;
        this.playEmote(me.clientId, slot, { chair });
        this.lobby.sendSubcommand(SIT_OPCODE, sitPayload(chair, this.emoteOpposite));
      }
      return;
    }
    // Option 0x80000 (dispatch_action_emote reads it): set while Alt and Shift are down.
    this.emoteOpposite = alt && keys.has('shift');
    const k = alt ? altEmoteKey(edge) : undefined;
    if (k === undefined) return;
    const slot = emoteSlot(k, this.fieldMotions);
    if (slot === undefined) return;
    this.playEmote(me.clientId, slot);
    this.lobby.sendSubcommand(EMOTE_OPCODE, emotePayload(slot, this.emoteOpposite));
  }

  private frame(dt: number, keys: ReadonlySet<string>): void {
    const me = this.lobby.self;
    const mine = me ? this.markers.get(me.clientId) : undefined;
    this.syncHeld();
    this.updateMags(dt);
    this.emoteTick(me ?? null, keys);
    this.viewer.fogProbe = mine ? mine.group.position : null; // fog regions follow our player

    // Second-finger camera drag of the touch pad (input/analog.ts): turns the
    // camera angle; the chase rules of render/playercamera.ts stay as they are.
    const turn = takeCameraTurn();
    if (turn && mine) this.camera.angle = Math.atan2(Math.sin(this.camera.angle + turn), Math.cos(this.camera.angle + turn));

    // The local player's logic position and its camera step together, once per
    // game tick (30 a second). The exe's order is the walk / run state machine
    // (render/playermove.ts), then the camera controller (render/playercamera.ts,
    // ProcessCameraChaseState_004d7a1c reads the logic position of that tick). The
    // drawn pose is interpolated between the ticks afterwards. The camera used to
    // sample the drawn pose once per camera tick: a frame's extra ticks saw no move,
    // so the chase stopped and restarted and lagged behind the player.
    const shown = mine?.group.position;
    const pos = this.logic;
    // Placed from outside (spawn, warp, 6x24): the mover and the logic start there.
    if (mine && shown && shown.distanceToSquared(this.drawn) > 0.0001) {
      pos.copy(shown);
      this.prevLogic.copy(shown);
      this.mover.place(shown.x, shown.z, mine.angle);
    }
    const moveOn = !!me && !!mine && !this.attacking(me.clientId) && !this.emoting(me.clientId);
    const dead = mine ? this.dead() : false;
    if (mine) {
      const camKey = keys.has(KEYS.camera);
      if (camKey && !this.cameraKeyHeld) this.camera.reset(mine.angle);
      this.cameraKeyHeld = camKey;
    }
    this.moveTicks += dt * 30;
    let ticks = Math.min(Math.floor(this.moveTicks), 30);
    this.moveTicks = Math.min(this.moveTicks - Math.floor(this.moveTicks), 1);
    const stick = analogStick(); // the touch pad's or the gamepad's left stick
    const leg = moveOn ? this.legState() : undefined;
    // Auto run / auto walk (input/automove.ts, unknown_handle_movement dump 667141): a
    // press toggles the mode, a direction key turns it off; Alt disables the toggles.
    if (mine && !stick) {
      // Keyboard Controls OFF: no keyboard auto run or walk (the exe's table has no key for them).
      const kb = keyboardControlsOn() && !keys.has('alt');
      this.auto = stepAutoMove(this.auto, {
        run: kb && keys.has(autoKey(KEYS.autorun, AUTO_RUN_FALLBACK)),
        walk: kb && keys.has(autoKey(KEYS.autowalk, AUTO_WALK_FALLBACK)),
        direction: keys.has(KEYS.moveForward) || keys.has(KEYS.moveBackward) || keys.has(KEYS.moveLeft) || keys.has(KEYS.moveRight),
      });
    }
    for (; ticks > 0 && mine; ticks--) {
      this.prevLogic.copy(pos);
      // A held key ramps its axis once per game tick (0x0070a60c): in the move
      // loop, and while dead (the move loop is off then, the camera still turns).
      if (!stick && (moveOn || dead)) {
        this.keyFb = rampAxis(this.keyFb, keys.has(KEYS.moveBackward), keys.has(KEYS.moveForward));
        this.keyLr = rampAxis(this.keyLr, keys.has(KEYS.moveLeft), keys.has(KEYS.moveRight));
        const axes = moveOn ? autoMoveAxes(this.auto.mode) : null;
        if (axes) {
          this.keyFb = axes.fb;
          this.keyLr = axes.lr;
        }
      }
      const lr = stick ? stick.lr : this.keyLr;
      const fb = stick ? stick.fb : this.keyFb;
      if (moveOn && leg) {
        // The exe's per-tick checks: the slow, then the guard stance by the flat
        // (x, z) distance to the target (0x007a9180 reads x and z only).
        this.mover.slowed = leg.slowed;
        const t = leg.target;
        this.mover.setGuard(t ? (pos.x - t.x) ** 2 + (pos.z - t.z) ** 2 : null, mine.charClass);
        // Confusion steering (modify_direction): a random heading per tick in the field.
        const steer = leg.confused ? (heading: number) => modifyDirection(heading, true, () => Math.floor(Math.random() * (RAND_MAX_C + 1))) : undefined;
        this.mover.tick({ lr, fb, cameraYaw: this.cameraYaw, keyboard: !stick, steer }, (dx, dz) => this.stepPlayer(pos, dx, dz));
        mine.angle = this.mover.angle;
      }
      // The camera's tick: this game tick's logic position and heading.
      this.camera.tick(pos, mine.angle, this.collision, { dead, stick: { amount: stickAmount({ lr, fb }), lr } });
    }
    if (me && mine && shown && moveOn) {
      const gait = this.mover.state;
      const moving = gait !== 'stand';
      mine.target.copy(pos);
      shown.lerpVectors(this.prevLogic, pos, this.moveTicks);
      this.drawn.copy(shown);
      mine.angle = this.mover.angle;
      if (moving) {
        this.setGait(mine, gait);
        // The walk / run step follows the leg speed (0x006a2061 / 0x006a1a10).
        mine.animator?.setRate(legSpeed(LOCOMOTION_FACTOR[gait], this.mover.slowed, this.mover.guard));
        // One 6x40 / 6x42 per leg, with the leg's point (the exe sends it when
        // the leg starts); a change of gait goes out at once too.
        if (gait !== this.sentGait || this.mover.legSerial !== this.sentLeg) {
          const end = this.mover.legEnd();
          if (gait === 'walk') this.lobby.sendWalk(end.x, end.z);
          else this.lobby.sendRun(end.x, end.z);
          this.sentGait = gait;
          this.sentLeg = this.mover.legSerial;
        }
      } else if (this.wasMoving) {
        this.lobby.sendStop(pos.x, pos.y, pos.z, mine.angle, this.stopState(pos));
        this.sentGait = null;
        this.sentLeg = -1;
        this.setGait(mine, 'idle');
      }
      this.wasMoving = moving;
    }

    // Interpolate everyone toward their targets.
    for (const [id, m] of this.markers) {
      if (me && id === me.clientId) {
        m.group.rotation.y = m.angle;
        m.animator?.update(dt);
        continue;
      }
      // Remote players run (or walk, 6x40) toward the last reported point and
      // idle once there.
      const pos = m.group.position;
      const p = this.lobby.players.get(id);
      const run = p?.gait !== 'walk';
      m.moveTicks += dt * 30;
      let ticks = Math.min(Math.floor(m.moveTicks), 30);
      m.moveTicks -= Math.floor(m.moveTicks);
      if (Math.hypot(m.target.x - pos.x, m.target.z - pos.z) > 150) {
        pos.set(m.target.x, m.target.y, m.target.z); // far behind: a warp, not a run
        m.follow.heading = toBams(m.angle);
      }
      let moved = false;
      // The logic position persists between frames; `pos` is only what was
      // drawn. Placed from outside (spawn, 6x24): start from the drawn spot.
      if (Math.hypot(m.follow.x - pos.x, m.follow.z - pos.z) > 20) {
        m.follow.x = pos.x;
        m.follow.z = pos.z;
        m.follow.heading = toBams(m.angle);
      }
      while (ticks-- > 0) {
        m.lastX = m.follow.x;
        m.lastZ = m.follow.z;
        if (!remoteStep(m.follow, m.target, run, !!p?.moving, m.legDir)) break;
        moved = true;
      }
      if (moved || Math.hypot(m.target.x - m.follow.x, m.target.z - m.follow.z) > 0.5) {
        const dist0 = Math.hypot(m.target.x - pos.x, m.target.z - pos.z) || 1;
        const dist1 = Math.hypot(m.target.x - m.follow.x, m.target.z - m.follow.z);
        pos.y += (m.target.y - pos.y) * Math.min(1, (dist0 - dist1) / dist0);
        const a = this.viewer.smoother.enabled ? m.moveTicks : 1;
        pos.x = m.lastX + (m.follow.x - m.lastX) * a;
        pos.z = m.lastZ + (m.follow.z - m.lastZ) * a;
        m.angle = fromBams(m.follow.heading);
      }
      // The pose follows the packets: a walking or running player keeps its gait while
      // the follower waits for the next packet (no idle between the legs).
      if (p?.moving || Math.hypot(m.target.x - pos.x, m.target.z - pos.z) > 0.5) {
        this.setGait(m, run ? 'run' : 'walk');
      } else {
        pos.y = m.target.y;
        // Arrived: face the angle of the last stop (6x3E / 6x3F / 6x20).
        if (p && !p.moving) m.angle = p.angle;
        this.setGait(m, 'idle');
      }
      m.group.rotation.y = m.angle;
      m.animator?.update(dt);
    }

    // The player camera is drawn between its last two ticks (render/smoothrender.ts;
    // not with ?fps=30). Its ticks ran above, on the logic position.
    if (mine) {
      const { source, target } = this.camera.view(this.logic, mine.angle, this.viewer.smoother.enabled ? this.moveTicks : 1);
      const cam = this.viewer.camera;
      const fov = njPerspectiveFovy(this.camera.fovAngle);
      if (cam.fov !== fov) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      cam.position.set(source.x, source.y, source.z);
      cam.lookAt(target.x, target.y, target.z);
    }
  }

  // Height of a player's model above its position (bounding box top), for
  // 2D overlays anchored at the head.
  playerHeight(clientId: number): number | null {
    const m = this.markers.get(clientId);
    if (!m) return null;
    const box = new THREE.Box3().setFromObject(m.group);
    return box.isEmpty() ? null : box.max.y - m.group.position.y;
  }

  // --- combat hooks (render/combat.ts) --------------------------------------

  // Redraws a player's name tag after a level change (6x30).
  refreshNameTag(clientId: number): void {
    const m = this.markers.get(clientId);
    const p = this.lobby.players.get(clientId);
    if (!m || !m.label || !p) return;
    const text = `${p.name}  Lv${p.level}`;
    if (text === m.labelText) return;
    const next = nameSprite(text);
    next.position.copy(m.label.position);
    m.group.remove(m.label);
    m.label.material.map?.dispose();
    m.label.material.dispose();
    m.group.add(next);
    m.label = next;
    m.labelText = text;
  }

  // The lit (Lambert) materials of a player's model, for the level-up light
  // (render/levelupfx.ts).
  playerLitMaterials(clientId: number): THREE.MeshLambertMaterial[] {
    const m = this.markers.get(clientId);
    const out = new Set<THREE.MeshLambertMaterial>();
    m?.model?.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) if (x instanceof THREE.MeshLambertMaterial) out.add(x);
    });
    return [...out];
  }

  // Motion player of a player's model (null while the model loads).
  playerAnimator(clientId: number): PlayerAnimator | null {
    return this.markers.get(clientId)?.animator ?? null;
  }

  // Turns a player (6x43 carries the attack angle).
  setPlayerAngle(clientId: number, angle: number): void {
    const m = this.markers.get(clientId);
    if (m) m.angle = angle;
  }

  // Plays the gait motion again after an attack motion ended.
  resetGait(clientId: number): void {
    const m = this.markers.get(clientId);
    if (m) this.setGait(m, m.gait, true);
  }

  // Knockback: moves a player by (dx, dz) through the map collision
  // (render/combat.ts, the velocity of 6x4B / 6x4C).
  pushPlayer(clientId: number, dx: number, dz: number): void {
    const m = this.markers.get(clientId);
    if (!m) return;
    const pos = m.group.position;
    if (this.collision) {
      const r = this.collision.move(pos.x, pos.y, pos.z, dx, dz);
      pos.set(r.x, r.y, r.z);
    } else {
      const y = this.viewer.groundHeight(pos.x + dx, pos.z + dz, pos.y + 30);
      if (y !== null && Math.abs(y - pos.y) < 25) pos.set(pos.x + dx, y, pos.z + dz);
    }
    m.target.copy(pos);
    // A remote player's run-follow (remoteStep) walks from its logic point; the
    // knockback moves that point too, or the follow would pull the player back.
    m.follow.x = pos.x;
    m.follow.z = pos.z;
    const me = this.lobby.self;
    if (me && me.clientId === clientId) me.position = { x: pos.x, y: pos.y, z: pos.z };
  }

  // The camera's current source / target (null before the first frame).
  cameraView(): { source: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null {
    const c = this.camera;
    return c.source && c.target ? { source: { ...c.source }, target: { ...c.target } } : null;
  }

  // FUN_004d7e4c: the talk ends for a talk that is not a camera mover's.
  talkCameraEnd(): void {
    this.camera.talk = false;
  }

  // UpdateDefaultNPCCameraOrientation_004d83f4: an NPC talk turns the camera
  // to the player's heading + or - 0x6000 (BAMS; +0x30 is heading + 0x8000
  // for straight behind), the one nearer the current angle first, the other
  // when CheckCameraRaycastCollision_004d847c finds a wall (mask 0x100) from
  // the current source to the new source or from there to the target; it
  // stays when both are blocked. ASSUMED: the new source is the player
  // camera's desired source at that angle (the exe offsets the player by the
  // camera's +0xdc..+0xe4 vector).
  talkCameraTurn(): void {
    // The talk flag (+0x100) first: the field of view goes to 0x22d8.
    this.camera.talk = true;
    const me = this.lobby.self;
    const m = me ? this.markers.get(me.clientId) : undefined;
    if (!m) return;
    const BAMS_RAD = (Math.PI * 2) / 0x10000;
    const cur = this.camera.angle;
    const diff = (a: number) => Math.abs(Math.atan2(Math.sin(a - cur), Math.cos(a - cur)));
    let first = m.angle + 0x6000 * BAMS_RAD;
    let second = m.angle - 0x6000 * BAMS_RAD;
    if (diff(second) < diff(first)) [first, second] = [second, first];
    const pos = m.group.position;
    const blocked = (a: number): boolean => {
      if (!this.collision || !this.camera.source || !this.camera.target) return false;
      const saved = this.camera.angle;
      this.camera.angle = a;
      const d = this.camera.desired(pos, m.angle);
      this.camera.angle = saved;
      const s = this.camera.source, t = this.camera.target;
      return (
        !!this.collision.segmentHit([s.x, s.y, s.z], [d.source.x, d.source.y, d.source.z], 0x100) ||
        !!this.collision.segmentHit([d.source.x, d.source.y, d.source.z], [t.x, t.y, t.z], 0x100)
      );
    };
    if (!blocked(first)) this.camera.angle = first;
    else if (!blocked(second)) this.camera.angle = second;
  }

  // Where a player stands and faces (radians), as drawn.
  playerPose(clientId: number): { x: number; y: number; z: number; angle: number } | null {
    const m = this.markers.get(clientId);
    if (!m) return null;
    const p = m.group.position;
    return { x: p.x, y: p.y, z: p.z, angle: m.angle };
  }

  // Puts a player at once at (x, z) on the ground under y, facing `angle`
  // (6x24 and set_player_start_position; the local player also tells the
  // others with a stop at the new place).
  placePlayer(clientId: number, x: number, y: number, z: number, angle: number): void {
    const gy = this.ground(x, z, y + STEP_UP) ?? y;
    const m = this.markers.get(clientId);
    if (m) {
      m.group.position.set(x, gy, z);
      m.target.set(x, gy, z);
      m.angle = angle;
      m.group.rotation.y = angle;
    }
    const p = this.lobby.players.get(clientId);
    if (p) {
      p.position = { x, y: gy, z };
      p.angle = angle;
      p.moving = false;
    }
    if (clientId === this.lobby.selfId) {
      this.cameraYaw = angle + Math.PI;
      this.lobby.sendStop(x, gy, z, angle, this.stopState({ x, y: gy, z }));
    }
  }

  // The world point of a gun's attach node of a player (combat/weaponorigin.ts): a weapon
  // walk entry or a body node of the skeleton; false when the player has no model yet.
  // A weapon node whose walk is pushed from another body node (WeaponNodeRef.base, the Mechgun's
  // second start): the weapon bone is under the hand, so its point is re-based from the hand's
  // frame to the base node's frame (the same local walk, pushed from that node).
  weaponOriginOf(clientId: number, ref: WeaponNodeRef, out: { x: number; y: number; z: number }): boolean {
    const m = this.markers.get(clientId);
    if (ref.part === 'weapon' && ref.base !== undefined && ref.base !== HAND_BODY_NODE) {
      const bone = m?.weaponBones?.[ref.node];
      const hand = m?.body?.[HAND_BODY_NODE];
      const base = m?.body?.[ref.base];
      if (!bone || !hand || !base) return false;
      bone.updateWorldMatrix(true, false);
      hand.updateWorldMatrix(true, false);
      base.updateWorldMatrix(true, false);
      const v = new THREE.Vector3();
      bone.getWorldPosition(v);
      v.applyMatrix4(hand.matrixWorld.clone().invert()).applyMatrix4(base.matrixWorld);
      out.x = v.x;
      out.y = v.y;
      out.z = v.z;
      return true;
    }
    return skeletonNodePosition(ref.part === 'body' ? m?.body : m?.weaponBones, ref.node, out);
  }

  // World position of each player (for 2D overlays such as name tags).
  playerPositions(): Map<number, THREE.Vector3> {
    const out = new Map<number, THREE.Vector3>();
    for (const [id, m] of this.markers) out.set(id, m.group.position.clone());
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.mainObjects?.dispose();
    this.mainObjects = null;
    for (const id of [...this.markers.keys()]) this.removeMarker(id);
    this.viewer.fogProbe = null;
    for (const d of this.disposers) d();
    this.viewer.onFrame = null;
    this.viewer.setOrbitEnabled(true);
  }
}

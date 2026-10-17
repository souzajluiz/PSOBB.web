// 3D lobby: renders the lobby map, the players' character models, and drives
// the local player with WASD, sending 6x42 (run) while moving and 6x3E (stop)
// on release. Walking uses the map collision (c.rel); players start at the
// lobby's TObjPlayerSet spawn point for their client id (map_lobby_NNo.dat).
// Models come from pl<L>nj.bml / pl<L>tex.afs with the appearance of the
// lobby join data, animated with the town idle / walk / run motions of
// plymotiondata.rlc (formats/plymotion.ts). Until a model is loaded (or when
// the files are missing) a capsule stands in.

import * as THREE from 'three';
import { ClientFiles } from '../data/clientfiles.ts';
import type { DataSource } from '../data/source.ts';
import { parseMapCRel } from '../formats/crel.ts';
import { parseMapNRel } from '../formats/nrel.ts';
import { parseObjectSets, playerSpawns, roomToWorld } from '../formats/objset.ts';
import { locomotionSlot, LOCOMOTION_FACTOR, PLAYER_MOTION_FILE, PlayerMotions, townMotion, type Locomotion } from '../formats/plymotion.ts';
import type { Lobby, LobbyPlayer } from '../net/lobby.ts';
import { CollisionWorld, STEP_UP } from './collision.ts';
import type { MapViewer } from './mapviewer.ts';
import { PlayerAnimator } from './playeranim.ts';
import { buildPlayerModel, classLetter, loadPlayerAssets, type PlayerAssets } from './playermodel.ts';

const RUN_SPEED = 120; // units per second (approximate)
const SEND_INTERVAL = 0.15; // seconds between 6x42 while moving
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

export interface LobbySpawn {
  x: number;
  y: number;
  z: number;
  angle: number; // radians, same convention as LobbyPlayer.angle
}

export interface LobbyMapData {
  collision: CollisionWorld | null;
  spawns: Map<number, LobbySpawn>; // by client id
  // Client files for the player models and motions (null: capsules only).
  files: ClientFiles | null;
  // TObjInfoCol (object type 0x0180): information counter trigger circles,
  // world x/z and radius (param1).
  infoCols?: Array<{ x: number; z: number; radius: number }>;
}

// Loads the lobby's collision (scene/map_lobby_NNc.rel) and player spawn points
// (map_lobby_NNo.dat from data.gsl, positions relative to the n.rel rooms).
// Missing files only degrade the view, so errors are reported and swallowed.
export async function loadLobbyMapData(source: DataSource, lobbyNumber: number, log: (msg: string) => void = () => {}): Promise<LobbyMapData> {
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
    const sets = parseObjectSets(await files.read(`map_${area}o.dat`));
    for (const s of playerSpawns(sets)) {
      if (s.source !== 0 || data.spawns.has(s.clientId)) continue;
      const room = rooms.find((r) => r.id === s.room);
      const [x, y, z] = roomToWorld(s.position, room);
      data.spawns.set(s.clientId, { x, y, z, angle: (s.angleY / 0x10000) * Math.PI * 2 + (room?.rotation[1] ?? 0) });
    }
    for (const o of sets) {
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

interface Marker {
  clientId: number;
  group: THREE.Group;
  target: THREE.Vector3;
  angle: number;
  capsule: THREE.Object3D | null;
  model: THREE.Object3D | null;
  animator: PlayerAnimator | null;
  charClass: number;
  gait: Locomotion;
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
  private cameraYaw = Math.PI;
  private cameraPitch = 0.35;
  private cameraDistance = 70;
  private sendTimer = 0;
  private wasMoving = false;
  private disposers: Array<() => void> = [];
  private collision: CollisionWorld | null;
  private spawns: Map<number, LobbySpawn>;
  private files: ClientFiles | null;
  private assets = new Map<number, Promise<PlayerAssets>>();
  private motions: Promise<PlayerMotions> | null = null;
  private disposed = false;

  // labels: false leaves the name tags to the caller (classic HUD).
  private labels: boolean;
  // Which players to show (games: only the ones on the local player's floor).
  private showPlayer: (p: LobbyPlayer) => boolean;
  // While this returns true for a player, its gait motion is not played over
  // the attack motion and the local player does not move (render/combat.ts).
  attacking: (clientId: number) => boolean = () => false;

  constructor(
    viewer: MapViewer,
    lobby: Lobby,
    mapData: LobbyMapData = { collision: null, spawns: new Map(), files: null },
    options: { labels?: boolean; showPlayer?: (p: LobbyPlayer) => boolean } = {},
  ) {
    this.labels = options.labels ?? true;
    this.viewer = viewer;
    this.lobby = lobby;
    this.showPlayer = options.showPlayer ?? (() => true);
    this.collision = mapData.collision;
    this.spawns = mapData.spawns;
    this.files = mapData.files;
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
    lobby.on('floorChanged', (p) => {
      if (!this.disposed && this.markers.has(p.clientId) !== this.showPlayer(p)) sync(p);
    });
    lobby.on('playerLeft', (id) => this.removeMarker(id));
    lobby.on('moved', (p) => this.onMoved(p));

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
    const s = this.spawns.get(clientId);
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
    this.lobby.sendStop(x, y, z, angle);
  }

  private bindMouse(canvas: HTMLCanvasElement): void {
    let dragging = false;
    const down = (e: PointerEvent) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      canvas.focus();
    };
    const up = () => (dragging = false);
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      this.cameraYaw -= e.movementX * 0.005;
      this.cameraPitch = Math.min(1.2, Math.max(-0.2, this.cameraPitch + e.movementY * 0.004));
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.cameraDistance = Math.min(600, Math.max(20, this.cameraDistance * (e.deltaY > 0 ? 1.1 : 0.9)));
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.disposers.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('wheel', wheel);
    });
  }

  private addMarker(p: LobbyPlayer): void {
    this.removeMarker(p.clientId);
    const group = new THREE.Group();
    const stand = capsule(p.charClass);
    group.add(stand);
    if (this.labels) {
      const label = nameSprite(`${p.name}  Lv${p.level}`);
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
      animator: null,
      charClass: p.charClass,
      gait: 'idle',
    };
    this.markers.set(p.clientId, marker);
    void this.loadModel(p, marker);
  }

  private classAssets(charClass: number): Promise<PlayerAssets> {
    let a = this.assets.get(charClass);
    if (!a) this.assets.set(charClass, (a = loadPlayerAssets(this.files!, charClass)));
    return a;
  }

  private async loadModel(p: LobbyPlayer, marker: Marker): Promise<void> {
    if (!this.files || p.charClass < 0 || p.charClass > 11) return;
    try {
      this.motions ??= this.files.read(PLAYER_MOTION_FILE).then((d) => new PlayerMotions(d));
      const [assets, motions] = await Promise.all([this.classAssets(p.charClass), this.motions]);
      if (this.disposed || this.markers.get(p.clientId) !== marker) return;
      const model = buildPlayerModel(assets, p.appearance);
      const body = assets.parts.get(`pl${classLetter(p.charClass)}bdy00.nj`)!;
      marker.animator = new PlayerAnimator(model.partBones[0], body, motions);
      marker.model = model.root;
      if (marker.capsule) {
        marker.group.remove(marker.capsule);
        disposeObject(marker.capsule, true);
        marker.capsule = null;
      }
      marker.group.add(model.root);
      this.setGait(marker, marker.gait, true);
    } catch (err) {
      console.warn(`player model for ${p.name}: ${(err as Error).message}`);
    }
  }

  // Town idle / walk / run motion of the marker's class.
  private setGait(m: Marker, gait: Locomotion, force = false): void {
    if (m.gait === gait && !force) return;
    m.gait = gait;
    if (!m.animator) return;
    if (this.attacking(m.clientId)) return;
    const cls = m.charClass;
    m.animator.play(townMotion(cls, locomotionSlot(cls, gait)), LOCOMOTION_FACTOR[gait], (slot) => townMotion(cls, slot));
  }

  private removeMarker(id: number): void {
    const m = this.markers.get(id);
    if (!m) return;
    this.viewer.scene.remove(m.group);
    for (const child of m.group.children) disposeObject(child, child !== m.model);
    this.markers.delete(id);
  }

  private onMoved(p: LobbyPlayer): void {
    if (p.clientId === this.lobby.selfId) return;
    const m = this.markers.get(p.clientId);
    if (!m) return;
    const y = p.moving ? (this.ground(p.position.x, p.position.z, m.group.position.y + STEP_UP) ?? m.group.position.y) : p.position.y;
    m.target.set(p.position.x, y, p.position.z);
    if (!p.moving) m.angle = p.angle;
  }

  private frame(dt: number, keys: ReadonlySet<string>): void {
    const me = this.lobby.self;
    const mine = me ? this.markers.get(me.clientId) : undefined;
    this.viewer.fogProbe = mine ? mine.group.position : null; // fog regions follow our player

    // Local movement relative to the camera (not while attacking).
    if (me && mine && !this.attacking(me.clientId)) {
      const forward = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const dir = new THREE.Vector3();
      if (keys.has('w') || keys.has('arrowup')) dir.add(forward);
      if (keys.has('s') || keys.has('arrowdown')) dir.sub(forward);
      if (keys.has('d') || keys.has('arrowright')) dir.add(right);
      if (keys.has('a') || keys.has('arrowleft')) dir.sub(right);
      const moving = dir.lengthSq() > 0;
      if (moving) {
        dir.normalize();
        const pos = mine.group.position;
        const step = RUN_SPEED * dt;
        if (this.collision) {
          // Sub-step so a long frame cannot tunnel through thin walls.
          const n = Math.max(1, Math.ceil(step / 4));
          for (let i = 0; i < n; i++) {
            const r = this.collision.move(pos.x, pos.y, pos.z, (dir.x * step) / n, (dir.z * step) / n);
            pos.set(r.x, r.y, r.z);
          }
        } else {
          const next = pos.clone().addScaledVector(dir, step);
          const y = this.viewer.groundHeight(next.x, next.z, pos.y + 30);
          // Only walk onto floor that is not a wall-sized step.
          if (y !== null && Math.abs(y - pos.y) < 25) pos.set(next.x, y, next.z);
        }
        mine.target.copy(pos);
        mine.angle = Math.atan2(dir.x, dir.z);
        this.setGait(mine, 'run');
        this.sendTimer -= dt;
        if (this.sendTimer <= 0) {
          this.lobby.sendRun(mine.group.position.x, mine.group.position.z);
          this.sendTimer = SEND_INTERVAL;
        }
      } else if (this.wasMoving) {
        const p = mine.group.position;
        this.lobby.sendStop(p.x, p.y, p.z, mine.angle);
        this.sendTimer = 0;
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
      const delta = m.target.clone().sub(m.group.position);
      delta.y = 0;
      const dist = delta.length();
      if (dist > 0.5) {
        const step = Math.min(dist, Math.max(RUN_SPEED * dt, dist * 0.2));
        m.group.position.addScaledVector(delta.normalize(), step);
        m.group.position.y += (m.target.y - m.group.position.y) * Math.min(1, step / dist);
        m.angle = Math.atan2(delta.x, delta.z);
        this.setGait(m, this.lobby.players.get(id)?.gait === 'walk' ? 'walk' : 'run');
      } else {
        m.group.position.y = m.target.y;
        // Arrived: face the angle of the last stop (6x3E / 6x3F / 6x20).
        const p = this.lobby.players.get(id);
        if (p && !p.moving) m.angle = p.angle;
        this.setGait(m, 'idle');
      }
      m.group.rotation.y = m.angle;
      m.animator?.update(dt);
    }

    // Third-person camera.
    if (mine) {
      const focus = mine.group.position.clone().add(new THREE.Vector3(0, 14, 0));
      const cam = this.viewer.camera;
      cam.position.set(
        focus.x + Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch) * this.cameraDistance,
        focus.y + Math.sin(this.cameraPitch) * this.cameraDistance,
        focus.z + Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch) * this.cameraDistance,
      );
      cam.lookAt(focus);
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
    const me = this.lobby.self;
    if (me && me.clientId === clientId) me.position = { x: pos.x, y: pos.y, z: pos.z };
  }

  // World position of each player (for 2D overlays such as name tags).
  playerPositions(): Map<number, THREE.Vector3> {
    const out = new Map<number, THREE.Vector3>();
    for (const [id, m] of this.markers) out.set(id, m.group.position.clone());
    return out;
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.markers.keys()]) this.removeMarker(id);
    this.viewer.fogProbe = null;
    for (const d of this.disposers) d();
    this.viewer.onFrame = null;
    this.viewer.setOrbitEnabled(true);
  }
}

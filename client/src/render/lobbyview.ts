// 3D lobby: renders the lobby map, a marker per player, and drives the local
// player with WASD, sending 6x42 (run) while moving and 6x3E (stop) on release.

import * as THREE from 'three';
import type { Lobby, LobbyPlayer } from '../net/lobby.ts';
import type { MapViewer } from './mapviewer.ts';

const RUN_SPEED = 120; // units per second (approximate)
const SEND_INTERVAL = 0.15; // seconds between 6x42 while moving
const CLASS_COLORS = [
  0xd64545, 0xe0607a, 0xa83232, // HUmar, HUnewearl, HUcast
  0x3f86d6, 0x2f5fa8, 0x4fa3c9, // RAmar, RAcast, RAcaseal
  0x9a59d1, 0xb57be0, 0xc79bf0, // FOmarl, FOnewm, FOnewearl
  0xc94f4f, 0x7a3fb0, 0x5fa8e8, // HUcaseal, FOmar, RAmarl
];

export function lobbyMapFile(lobbyNumber: number): string {
  return `map_lobby_${String((lobbyNumber % 10) + 1).padStart(2, '0')}n.rel`;
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
  sprite.scale.set(w / 2.5, 16, 1);
  sprite.renderOrder = 10;
  return sprite;
}

interface Marker {
  group: THREE.Group;
  target: THREE.Vector3;
  angle: number;
}

export class LobbyView {
  private viewer: MapViewer;
  private lobby: Lobby;
  private markers = new Map<number, Marker>();
  private cameraYaw = Math.PI;
  private cameraPitch = 0.35;
  private cameraDistance = 140;
  private sendTimer = 0;
  private wasMoving = false;
  private disposers: Array<() => void> = [];

  constructor(viewer: MapViewer, lobby: Lobby) {
    this.viewer = viewer;
    this.lobby = lobby;
    viewer.setOrbitEnabled(false);
    viewer.onFrame = (dt, keys) => this.frame(dt, keys);

    for (const p of lobby.players.values()) this.addMarker(p);
    lobby.on('playerJoined', (p) => this.addMarker(p));
    lobby.on('playerLeft', (id) => this.removeMarker(id));
    lobby.on('moved', (p) => this.onMoved(p));

    this.placeSelfOnGround();
    this.bindMouse(viewer.renderer.domElement);
  }

  private placeSelfOnGround(): void {
    const me = this.lobby.self;
    if (!me) return;
    // Spiral out from the origin until the map has a floor under us.
    for (let r = 0; r < 400; r += 20) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = this.viewer.groundHeight(x, z, 200);
        if (y !== null) {
          me.position = { x, y, z };
          const m = this.markers.get(me.clientId);
          if (m) {
            m.group.position.set(x, y, z);
            m.target.set(x, y, z);
          }
          this.lobby.sendStop(x, y, z, me.angle);
          return;
        }
        if (r === 0) break;
      }
    }
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
      this.cameraDistance = Math.min(600, Math.max(40, this.cameraDistance * (e.deltaY > 0 ? 1.1 : 0.9)));
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
    const color = CLASS_COLORS[p.charClass] ?? 0xcccccc;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(6, 14, 4, 12),
      new THREE.MeshBasicMaterial({ color }),
    );
    body.position.y = 13;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(3, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 18, 7);
    const label = nameSprite(`${p.name}  Lv${p.level}`);
    label.position.y = 38;
    group.add(body, nose, label);
    group.position.set(p.position.x, p.position.y, p.position.z);
    this.viewer.scene.add(group);
    this.markers.set(p.clientId, { group, target: group.position.clone(), angle: p.angle });
  }

  private removeMarker(id: number): void {
    const m = this.markers.get(id);
    if (!m) return;
    this.viewer.scene.remove(m.group);
    m.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        o.geometry.dispose();
        const mat = o.material as THREE.Material & { map?: THREE.Texture };
        mat.map?.dispose();
        mat.dispose();
      }
    });
    this.markers.delete(id);
  }

  private onMoved(p: LobbyPlayer): void {
    if (p.clientId === this.lobby.selfId) return;
    const m = this.markers.get(p.clientId);
    if (!m) return;
    const y = p.moving ? (this.viewer.groundHeight(p.position.x, p.position.z, m.group.position.y + 50) ?? m.group.position.y) : p.position.y;
    m.target.set(p.position.x, y, p.position.z);
    if (!p.moving) m.angle = p.angle;
  }

  private frame(dt: number, keys: ReadonlySet<string>): void {
    const me = this.lobby.self;
    const mine = me ? this.markers.get(me.clientId) : undefined;

    // Local movement relative to the camera.
    if (me && mine) {
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
        const next = mine.group.position.clone().addScaledVector(dir, RUN_SPEED * dt);
        const y = this.viewer.groundHeight(next.x, next.z, mine.group.position.y + 30);
        // Only walk onto floor that is not a wall-sized step.
        if (y !== null && Math.abs(y - mine.group.position.y) < 25) {
          next.y = y;
          mine.group.position.copy(next);
          mine.target.copy(next);
        }
        mine.angle = Math.atan2(dir.x, dir.z);
        this.sendTimer -= dt;
        if (this.sendTimer <= 0) {
          this.lobby.sendRun(mine.group.position.x, mine.group.position.z);
          this.sendTimer = SEND_INTERVAL;
        }
      } else if (this.wasMoving) {
        const p = mine.group.position;
        this.lobby.sendStop(p.x, p.y, p.z, mine.angle);
        this.sendTimer = 0;
      }
      this.wasMoving = moving;
    }

    // Interpolate everyone toward their targets.
    for (const [id, m] of this.markers) {
      if (me && id === me.clientId) {
        m.group.rotation.y = m.angle;
        continue;
      }
      const delta = m.target.clone().sub(m.group.position);
      const dist = delta.length();
      if (dist > 0.5) {
        const step = Math.min(dist, Math.max(RUN_SPEED * dt, dist * 0.2));
        m.group.position.addScaledVector(delta.normalize(), step);
        if (delta.x || delta.z) m.angle = Math.atan2(delta.x, delta.z);
      }
      m.group.rotation.y = m.angle;
    }

    // Third-person camera.
    if (mine) {
      const focus = mine.group.position.clone().add(new THREE.Vector3(0, 20, 0));
      const cam = this.viewer.camera;
      cam.position.set(
        focus.x + Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch) * this.cameraDistance,
        focus.y + Math.sin(this.cameraPitch) * this.cameraDistance,
        focus.z + Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch) * this.cameraDistance,
      );
      cam.lookAt(focus);
    }
  }

  dispose(): void {
    for (const id of [...this.markers.keys()]) this.removeMarker(id);
    for (const d of this.disposers) d();
    this.viewer.onFrame = null;
    this.viewer.setOrbitEnabled(true);
  }
}

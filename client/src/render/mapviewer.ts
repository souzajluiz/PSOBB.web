// Map viewer: loads map_*n.rel + its .xvm from a DataSource and renders it.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { DataSource } from '../data/source.ts';
import { parseMapNRel, type MapGeometry } from '../formats/nrel.ts';
import { parseXvm } from '../formats/xvm.ts';
import { buildObjectTree, buildObjectTreeWithNodes, MaterialCache } from './njmesh.ts';
import { MapAnimator } from './mapanim.ts';
import { TextureAnimator } from './texanim.ts';
import { parseTam, tamFileFor, type TamFile } from '../formats/tam.ts';
import { areaForMap, type PlacedEntity } from '../formats/setdata.ts';
import { ENTRY_NO_FOG } from '../formats/nrel.ts';
import { ClientFiles } from '../data/clientfiles.ts';
import {
  defaultFogForArea,
  FogController,
  FogRegionManager,
  fogRegionFromSet,
  parseFogEntries,
  regionActive,
  type FogEntry,
  type FogRegion,
} from '../formats/fogentry.ts';
import { lightForArea, parseLightEntries, type LightEntry } from '../formats/lightentry.ts';

export interface MapStats {
  sections: number;
  objects: number;
  meshes: number;
  triangles: number;
  textures: number;
  skippedEntries: number;
  animations: number;
}

// "map_city00_00n.rel" -> "map_city00.xvm"; "map_forest01n.rel" -> "map_forest01.xvm"
export function textureArchiveFor(nrel: string): string {
  return textureArchiveCandidates(nrel)[0];
}

// Layout maps share one archive ("map_city00_00n.rel" -> "map_city00.xvm"), but
// some names end in a number that is not a layout ("map_lobby_01n.rel" ->
// "map_lobby_01.xvm"), so try both.
export function textureArchiveCandidates(nrel: string): string[] {
  const stripped = nrel.replace(/(_\d\d)?n\.rel$/, '.xvm');
  const plain = nrel.replace(/n\.rel$/, '.xvm');
  return stripped === plain ? [plain] : [stripped, plain];
}

// Marker colors: enemies red, NPCs (from the enemy file) cyan, objects yellow.
export const MARKER_COLORS = { enemy: 0xff4040, npc: 0x40d8ff, object: 0xffd040 } as const;
const MARKER_LIFT = 6; // markers float above the spawn point so they are not buried in the floor
const UP = new THREE.Vector3(0, 1, 0);
const GAME_FPS = 30; // the client's fog object and frame counter advance once per game frame

// D3D lighting has no 1/pi in the Lambert term; three.js does.
const D3D_LIGHT_SCALE = Math.PI;
const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const rgb24 = (c: number) => srgb(((c >>> 16) & 0xff) / 255, ((c >>> 8) & 0xff) / 255, (c & 0xff) / 255);

interface AreaTables {
  fog: FogEntry[] | null;
  light: LightEntry[] | null;
}
const ONE = new THREE.Vector3(1, 1, 1);

export class MapViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private mapRoot: THREE.Group | null = null;
  private materials: MaterialCache | null = null;
  private textures: THREE.Texture[] = [];
  private resizeObserver: ResizeObserver;
  readonly mapAnimator = new MapAnimator();
  private textureAnimator: TextureAnimator | null = null;
  private raycaster = new THREE.Raycaster();
  private keys = new Set<string>();
  private clock = new THREE.Clock();
  private entityRoot: THREE.Group | null = null;
  private entityMeshes: Array<{ mesh: THREE.InstancedMesh; items: PlacedEntity[] }> = [];
  private labelRoot: THREE.Group | null = null;
  private labelTextures = new Map<string, THREE.CanvasTexture>();
  private labelsVisible = false;
  private tooltip: HTMLDivElement | null = null;
  private hoverId = -1;
  // Fog and lights (fogentry.dat / lightentry.bin).
  private areaTables: Promise<AreaTables> | null = null;
  private areaSource: DataSource | null = null;
  private fog: FogController | null = null;
  private fogRegions: FogRegion[] = [];
  private fogManager = new FogRegionManager();
  private fogClock = 0;
  private gameFrame = 0;
  private noFogMaterials: THREE.Material[] = [];
  readonly sceneFog = new THREE.Fog(0x000000, 1000, 10000);
  readonly ambientLight = new THREE.AmbientLight(0xffffff, 0.3 * D3D_LIGHT_SCALE);
  readonly directionalLight = new THREE.DirectionalLight(0xffffff, D3D_LIGHT_SCALE);
  area: number | null = null;
  fogEnabled = true;
  // Where the fog regions test for "the player": the orbit target unless set.
  fogProbe: THREE.Vector3 | null = null;
  // Switch flags for TObjFogCollisionSwitch regions (all off, as when a floor starts).
  switchOn: (id: number) => boolean = () => false;
  // Geometry of the map shown last (sections are needed to place set data).
  geometry: MapGeometry | null = null;
  // When set, replaces the free-fly camera: called every frame with the
  // pressed keys and the frame time.
  onFrame: ((dt: number, keys: ReadonlySet<string>) => void) | null = null;
  // Called every frame with the frame time (e.g. enemy motions).
  readonly frameHooks = new Set<(dt: number) => void>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x0a1424);
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 20000);
    this.camera.position.set(0, 300, 600);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    // The area light is given in camera space (FUN_00843a68 transforms it by the
    // inverse view matrix), so it rides on the camera.
    this.directionalLight.position.set(0, 0, 1);
    this.directionalLight.target.position.set(0, 0, 0);
    this.camera.add(this.directionalLight, this.directionalLight.target);
    this.scene.add(this.camera, this.ambientLight);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (e) => {
      // The game keys (input/keyconfig.ts) must not scroll the page.
      if (/^(arrow(up|down|left|right)| |home|end|backspace)$/i.test(e.key)) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
    });
    canvas.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    canvas.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointermove', (e) => this.hover(e));
    canvas.addEventListener('pointerleave', () => this.setTooltip(null));
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize(): void {
    const c = this.renderer.domElement;
    const w = c.clientWidth || 1;
    const h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // WASD/QE moves camera and orbit target together.
  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.mapAnimator.update(dt);
    this.textureAnimator?.update(dt);
    for (const hook of this.frameHooks) hook(dt);
    this.updateFog(dt);
    if (this.onFrame) {
      this.onFrame(dt, this.keys);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const speed = (this.keys.has('shift') ? 1200 : 300) * dt;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const move = new THREE.Vector3();
    if (this.keys.has('w')) move.add(forward);
    if (this.keys.has('s')) move.sub(forward);
    if (this.keys.has('d')) move.add(right);
    if (this.keys.has('a')) move.sub(right);
    if (this.keys.has('e')) move.y += 1;
    if (this.keys.has('q')) move.y -= 1;
    if (move.lengthSq()) {
      move.normalize().multiplyScalar(speed);
      this.camera.position.add(move);
      this.controls.target.add(move);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  async load(source: DataSource, nrelName: string): Promise<MapStats> {
    const nrelData = await source.read(`scene/${nrelName}`);
    const geometry = parseMapNRel(nrelData);
    let xvm: Uint8Array | null = null;
    for (const name of textureArchiveCandidates(nrelName)) {
      try {
        xvm = await source.read(`scene/${name}`);
        break;
      } catch {
        xvm = null;
      }
    }
    let tam: TamFile | null = null;
    try {
      tam = parseTam(await source.read(`scene/${tamFileFor(nrelName)}`));
    } catch {
      tam = null; // most maps have no texture animation file
    }
    this.show(geometry, xvm, tam);
    const area = areaForMap(nrelName);
    await this.setArea(source, area);
    return this.stats(geometry);
  }

  show(geometry: MapGeometry, xvm: Uint8Array | null, tam: TamFile | null = null): void {
    this.clear();
    this.geometry = geometry;
    this.textures = xvm
      ? parseXvm(xvm).map((t) => {
          const tex = new THREE.DataTexture(t.rgba, t.width, t.height, THREE.RGBAFormat);
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.magFilter = THREE.LinearFilter;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.generateMipmaps = true;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          return tex;
        })
      : [];
    this.materials = new MaterialCache((id) => this.textures[id] ?? null);
    this.textureAnimator = tam ? new TextureAnimator(tam, (id) => this.textures[id] ?? null) : null;

    const root = new THREE.Group();
    for (const section of geometry.sections) {
      const s = new THREE.Group();
      s.position.set(...section.position);
      s.rotation.set(section.rotation[0], section.rotation[1], section.rotation[2], 'YXZ'); // map sections rotate in the client's Y, X, Z order (see DEVLOG)
      for (const entry of section.entries) {
        if (!entry.rendered) continue;
        let root: THREE.Object3D;
        if (entry.animated && entry.motion) {
          const built = buildObjectTreeWithNodes(entry.object, this.materials);
          this.mapAnimator.add(built.nodes, entry.motion, entry.frameStep);
          root = built.root;
        } else {
          root = buildObjectTree(entry.object, this.materials);
        }
        if (entry.flags & ENTRY_NO_FOG) this.disableFog(root);
        this.textureAnimator?.attach(entry, root);
        s.add(root);
      }
      root.add(s);
    }
    this.scene.add(root);
    this.mapRoot = root;
    this.frameAll();
  }

  // Entry flag 0x1: the client turns fog off while drawing the entry.
  private disableFog(root: THREE.Object3D): void {
    const copies = new Map<THREE.Material, THREE.Material>();
    const copy = (m: THREE.Material) => {
      let c = copies.get(m);
      if (!c) {
        c = m.clone();
        (c as THREE.MeshBasicMaterial).fog = false;
        copies.set(m, c);
        this.noFogMaterials.push(c);
      }
      return c;
    };
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material);
    });
  }

  // --- Area fog and light -----------------------------------------------------

  private loadAreaTables(source: DataSource): Promise<AreaTables> {
    if (this.areaTables && this.areaSource === source) return this.areaTables;
    this.areaSource = source;
    const files = new ClientFiles(source);
    const read = async <T>(name: string, parse: (d: Uint8Array) => T): Promise<T | null> => {
      try {
        return parse(await files.read(name));
      } catch {
        return null;
      }
    };
    this.areaTables = Promise.all([read('fogentry.dat', parseFogEntries), read('lightentry.bin', parseLightEntries)]).then(([fog, light]) => ({ fog, light }));
    return this.areaTables;
  }

  // Applies the area's base fog (DEFAULT_FOG_BY_AREA) and light (lightentry.bin).
  // `area` uses the newserv/client area numbers (setdata.ts areaForMap).
  async setArea(source: DataSource, area: number | null): Promise<void> {
    const tables = await this.loadAreaTables(source);
    this.area = area;
    this.fog = null;
    this.fogManager = new FogRegionManager();
    this.scene.fog = null;
    if (area !== null && tables.fog) {
      this.fog = new FogController(tables.fog);
      this.fog.setBase(defaultFogForArea(area), true);
      this.fog.tick(this.gameFrame);
      this.applyFog();
    }
    const light = area !== null && tables.light ? lightForArea(tables.light, area) : null;
    if (light) this.setLight(light);
  }

  setLight(l: LightEntry): void {
    const [x, y, z] = l.direction;
    const len = Math.hypot(x, y, z);
    this.directionalLight.position.set(...(len > 1e-6 ? ([x / len, y / len, z / len] as const) : ([0, 0, 1] as const)));
    this.directionalLight.color.copy(srgb(...l.color));
    this.directionalLight.intensity = D3D_LIGHT_SCALE;
    // Models and objects get D3DRS_AMBIENT = grey(ambient level) (FUN_00794a80).
    this.ambientLight.color.copy(srgb(l.ambientLevel, l.ambientLevel, l.ambientLevel));
    this.ambientLight.intensity = D3D_LIGHT_SCALE;
  }

  // Switches to fog entry `id` like a fog region does (fade unless immediate).
  setFogOverride(id: number, immediate = false): void {
    this.fog?.setOverride(id, immediate);
  }

  setFogEnabled(enabled: boolean): void {
    this.fogEnabled = enabled;
    this.applyFog();
  }

  get fogId(): number | null {
    return this.fog?.currentId ?? null;
  }

  // Fog regions from the floor's object set data (types 0x07, 0x18, 0x160).
  setFogRegions(items: PlacedEntity[]): void {
    this.fogRegions = [];
    for (const p of items) {
      const e = p.entity;
      if (e.kind !== 'object') continue;
      const r = fogRegionFromSet(e.type, p.world, e.params.slice(0, 3), e.params.slice(3, 6));
      if (r) this.fogRegions.push(r);
    }
  }

  get fogRegionCount(): number {
    return this.fogRegions.length;
  }

  private updateFog(dt: number): void {
    if (!this.fog) return;
    this.fogClock += dt * GAME_FPS;
    let changed = false;
    // At most a few game frames per rendered frame.
    for (let n = 0; this.fogClock >= 1 && n < 4; n++) {
      this.fogClock -= 1;
      this.gameFrame++;
      const probe = this.fogProbe ?? this.controls.target;
      for (const r of this.fogRegions) {
        if (!regionActive(r, this.switchOn)) continue;
        const dx = r.position[0] - probe.x, dy = r.position[1] - probe.y, dz = r.position[2] - probe.z;
        if (dx * dx + dy * dy + dz * dz < r.radius * r.radius) this.fogManager.register(r.fogId, r.fade);
      }
      this.fogManager.update(this.fog);
      changed = this.fog.tick(this.gameFrame) || changed;
    }
    this.fogClock = Math.min(this.fogClock, 1);
    if (changed) this.applyFog();
  }

  // FUN_005bc440: linear fog with the evaluated color, start and end.
  private applyFog(): void {
    if (!this.fog || !this.fogEnabled) {
      this.scene.fog = null;
      return;
    }
    const s = this.fog.state;
    this.sceneFog.color.copy(rgb24(s.color));
    this.sceneFog.near = s.start;
    this.sceneFog.far = Math.max(s.end, s.start + 1e-3);
    this.scene.fog = this.sceneFog;
  }

  // Height of the map surface under (x, z), searching downward from `fromY`.
  groundHeight(x: number, z: number, fromY = 1000): number | null {
    if (!this.mapRoot) return null;
    this.raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    const hit = this.raycaster.intersectObject(this.mapRoot, true)[0];
    return hit ? hit.point.y : null;
  }

  setOrbitEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  frameAll(): void {
    if (!this.mapRoot) return;
    const box = new THREE.Box3().setFromObject(this.mapRoot);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0, size * 0.45, size * 0.55));
    this.camera.far = Math.max(20000, size * 4);
    this.camera.updateProjectionMatrix();
  }

  private stats(g: MapGeometry): MapStats {
    let objects = 0, meshes = 0, triangles = 0;
    this.mapRoot?.traverse((o) => {
      objects++;
      if (o instanceof THREE.Mesh) {
        meshes++;
        triangles += (o.geometry.index?.count ?? 0) / 3;
      }
    });
    return {
      sections: g.sections.length,
      objects,
      meshes,
      triangles,
      textures: this.textures.length,
      skippedEntries: g.skippedEntries.length,
      animations: this.mapAnimator.count + (this.textureAnimator?.count ?? 0),
    };
  }

  // --- Enemy/object markers (set data) ---------------------------------------

  // Replaces the markers. Each category gets one InstancedMesh.
  setEntities(items: PlacedEntity[]): void {
    this.clearEntities();
    const root = new THREE.Group();
    root.name = 'set-data';
    const geometry = new THREE.OctahedronGeometry(5);
    for (const category of ['enemy', 'npc', 'object'] as const) {
      const list = items.filter((p) => p.category === category);
      if (!list.length) continue;
      const material = new THREE.MeshBasicMaterial({ color: MARKER_COLORS[category], fog: false });
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      list.forEach((p, i) => {
        q.setFromAxisAngle(UP, p.yaw);
        m.compose(new THREE.Vector3(p.world[0], p.world[1] + MARKER_LIFT, p.world[2]), q, ONE);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
      this.entityMeshes.push({ mesh, items: list });
    }
    this.scene.add(root);
    this.entityRoot = root;
    if (this.labelsVisible) this.buildLabels();
  }

  setEntitiesVisible(visible: boolean): void {
    if (this.entityRoot) this.entityRoot.visible = visible;
    if (this.labelRoot) this.labelRoot.visible = visible && this.labelsVisible;
    if (!visible) this.setTooltip(null);
  }

  setLabelsVisible(visible: boolean): void {
    this.labelsVisible = visible;
    if (visible && !this.labelRoot) this.buildLabels();
    if (this.labelRoot) this.labelRoot.visible = visible && (this.entityRoot?.visible ?? false);
  }

  private buildLabels(): void {
    if (!this.entityMeshes.length) return;
    const root = new THREE.Group();
    for (const { items } of this.entityMeshes) {
      for (const p of items) {
        const tex = this.labelTexture(p.name, MARKER_COLORS[p.category]);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true }));
        const h = 0.028;
        sprite.scale.set((h * tex.image.width) / tex.image.height, h, 1);
        sprite.center.set(0.5, 0);
        sprite.position.set(p.world[0], p.world[1] + MARKER_LIFT + 6, p.world[2]);
        sprite.renderOrder = 10;
        root.add(sprite);
      }
    }
    root.visible = this.entityRoot?.visible ?? true;
    this.scene.add(root);
    this.labelRoot = root;
  }

  private labelTexture(text: string, color: number): THREE.CanvasTexture {
    const key = `${color}:${text}`;
    let tex = this.labelTextures.get(key);
    if (tex) return tex;
    const font = '600 28px system-ui, sans-serif';
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    ctx.font = font;
    c.width = Math.ceil(ctx.measureText(text).width) + 16;
    c.height = 40;
    ctx.font = font;
    ctx.fillStyle = 'rgba(2, 10, 20, 0.7)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 8, c.height / 2 + 1);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.labelTextures.set(key, tex);
    return tex;
  }

  private hover(e: PointerEvent): void {
    if (!this.entityRoot?.visible || !this.entityMeshes.length || e.buttons) return this.setTooltip(null);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.entityMeshes.map((m) => m.mesh), false)[0];
    const entry = hit && this.entityMeshes.find((m) => m.mesh === hit.object);
    const item = entry && hit.instanceId !== undefined ? entry.items[hit.instanceId] : null;
    this.setTooltip(item, e.clientX, e.clientY);
  }

  private setTooltip(item: PlacedEntity | null | undefined, x = 0, y = 0): void {
    if (!item) {
      if (this.tooltip) this.tooltip.hidden = true;
      this.hoverId = -1;
      return;
    }
    if (!this.tooltip) {
      const t = document.createElement('div');
      t.style.cssText =
        'position:fixed;z-index:20;pointer-events:none;padding:6px 9px;border-radius:4px;' +
        'background:rgba(2,10,20,.9);border:1px solid #2b4a66;color:#dce8f4;font:12px/1.4 system-ui,sans-serif;white-space:pre';
      document.body.append(t);
      this.tooltip = t;
    }
    const e = item.entity;
    const id = e.kind === 'enemy' ? 0x1000 + e.index : 0x4000 + e.index;
    if (id !== this.hoverId) {
      this.hoverId = id;
      const hex = (n: number, w = 4) => n.toString(16).toUpperCase().padStart(w, '0');
      const extra = e.kind === 'enemy' ? `wave ${e.wave}${e.numChildren ? ` · children ${e.numChildren}` : ''}` : `group ${e.group}`;
      this.tooltip.textContent =
        `${item.name}\n${e.kind} #${e.index} · type ${hex(e.type)} · section ${e.section}${item.sectionFound ? '' : ' (missing)'} · ${extra}\n` +
        `local ${e.position.map((v) => v.toFixed(1)).join(', ')} · world ${item.world.map((v) => v.toFixed(1)).join(', ')}`;
    }
    this.tooltip.hidden = false;
    this.tooltip.style.left = `${x + 14}px`;
    this.tooltip.style.top = `${y + 14}px`;
  }

  clearEntities(): void {
    for (const { mesh } of this.entityMeshes) (mesh.material as THREE.Material).dispose();
    this.entityMeshes[0]?.mesh.geometry.dispose();
    this.entityMeshes = [];
    if (this.entityRoot) this.scene.remove(this.entityRoot);
    this.entityRoot = null;
    if (this.labelRoot) {
      this.labelRoot.traverse((o) => {
        if (o instanceof THREE.Sprite) o.material.dispose();
      });
      this.scene.remove(this.labelRoot);
    }
    this.labelRoot = null;
    this.setTooltip(null);
  }

  clear(): void {
    this.mapAnimator.clear();
    this.textureAnimator?.dispose();
    this.textureAnimator = null;
    this.clearEntities();
    this.geometry = null;
    if (this.mapRoot) {
      this.mapRoot.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      this.scene.remove(this.mapRoot);
      this.mapRoot = null;
    }
    this.materials?.dispose();
    for (const m of this.noFogMaterials) m.dispose();
    this.noFogMaterials = [];
    this.fogRegions = [];
    for (const t of this.textures) t.dispose();
    this.textures = [];
  }
}

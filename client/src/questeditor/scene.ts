// Quest editor: the 3D view of the selected floor. A thin layer over the map
// viewer (render/mapviewer.ts) and the model layers of the game (enemy, object
// and NPC models): it draws the floor's geometry, the document's entities of
// that floor as picking markers plus their models, the selection, and turns
// pointer input into document edits (select, move, rotate, create at a point).
// The state lives in the document (model.ts); nothing here is the source of truth.

import * as THREE from 'three';
import { ClientFiles } from '../data/clientfiles.ts';
import type { DataSource } from '../data/source.ts';
import type { MapSection } from '../formats/nrel.ts';
import { placeEntities, type PlacedEntity, type SetEntity, type Vec3 } from '../formats/setdata.ts';
import { floorFiles, geometryCandidates, parseSetDataTable, type SetDataTable } from '../formats/setdatatable.ts';
import { EnemyLayer } from '../render/enemyview.ts';
import { MapViewer } from '../render/mapviewer.ts';
import { NpcLayer } from '../render/npcview.ts';
import { ObjectLayer } from '../render/objectview.ts';
import { areaName } from './areas.ts';
import { bamsToDegrees, degreesToBams, nearestSection, wrapBams, worldToSection } from './geom.ts';
import type { Change, QuestDocument } from './model.ts';
import { pivotAngle, turnedBams } from './turn.ts';

const MARKER_COLORS = { enemy: 0xff6b5b, npc: 0x6bff9a, object: 0x5fd4ff } as const;
const MARKER_LIFT = 6;
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const MODEL_DELAY_MS = 150;
const TURN_RADIUS = 18; // the rotation gizmo's ring, in world units around the pivot
const TURN_GRAB = 6; // how far from the ring a press still grabs it
const TURN_COLOR = 0x7dffd1;

interface Item {
  entity: SetEntity;
  placed: PlacedEntity;
  mesh: THREE.InstancedMesh | null;
  slot: number;
  key: string; // what the models depend on: type and parameters
}

export interface SceneHost {
  status(msg: string, kind?: '' | 'ok' | 'err'): void;
}

export interface Placement {
  world: Vec3;
  section: number;
  local: Vec3;
}

export class EditorScene {
  readonly viewer: MapViewer;
  private doc: QuestDocument;
  private host: SceneHost;
  private canvas: HTMLCanvasElement;
  private source: DataSource | null = null;
  private files: ClientFiles | null = null;
  private table: Promise<SetDataTable | null> | null = null;
  private enemyLayer: EnemyLayer | null = null;
  private objectLayer: ObjectLayer | null = null;
  private npcLayer: NpcLayer | null = null;
  private items: Item[] = [];
  private byEntity = new Map<SetEntity, Item>();
  private sections: MapSection[] = [];
  private markerRoot = new THREE.Group();
  private markerMeshes: THREE.InstancedMesh[] = [];
  private markerOf = new Map<THREE.InstancedMesh, Item[]>();
  private selectionRoot = new THREE.Group();
  private turnRoot = new THREE.Group();
  private loadToken = 0;
  private modelToken = 0;
  private modelTimer: ReturnType<typeof setTimeout> | null = null;
  private geometryKey = '';
  private geometryName: string | null = null;
  private tooltip: HTMLDivElement;
  private raycaster = new THREE.Raycaster();
  private drag: DragState | null = null;
  snapToGround = false;
  private markersVisible = true;
  private modelsVisible = true;

  constructor(canvas: HTMLCanvasElement, doc: QuestDocument, host: SceneHost) {
    this.canvas = canvas;
    this.doc = doc;
    this.host = host;
    this.viewer = new MapViewer(canvas);
    this.viewer.scene.add(this.markerRoot, this.selectionRoot, this.turnRoot);
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'qe-tooltip';
    this.tooltip.hidden = true;
    canvas.parentElement?.append(this.tooltip);
    // Capture phase on the parent: the editor sees a press before OrbitControls
    // does and can keep the camera still while an entity is dragged.
    canvas.parentElement?.addEventListener('pointerdown', (e) => this.onDown(e), true);
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => (this.tooltip.hidden = true));
    doc.onChange((c) => this.onChange(c));
  }

  // --- Data ---------------------------------------------------------------------

  setSource(source: DataSource | null): void {
    this.source = source;
    this.files = source ? new ClientFiles(source) : null;
    this.table = null;
    this.enemyLayer?.dispose();
    this.objectLayer?.dispose();
    this.npcLayer?.dispose();
    this.enemyLayer = this.objectLayer = this.npcLayer = null;
    if (this.files) {
      this.enemyLayer = new EnemyLayer(this.viewer, this.files);
      this.objectLayer = new ObjectLayer(this.viewer, this.files);
      this.npcLayer = new NpcLayer(this.viewer, this.files);
    }
    this.geometryKey = '';
    void this.showFloor();
  }

  get hasSource(): boolean {
    return !!this.source;
  }

  private setDataTable(): Promise<SetDataTable | null> {
    this.table ??= (async () => {
      try {
        return parseSetDataTable(await this.files!.read('SetDataTableOn.rel'));
      } catch (err) {
        this.host.status(`SetDataTableOn.rel: ${(err as Error).message}`, 'err');
        return null;
      }
    })();
    return this.table;
  }

  // What picks the map of a floor: its area and the two variations.
  private keyFor(floor: number): string {
    const d = this.doc.designation(floor);
    return `${floor}:${this.doc.areaOf(floor)}:${d?.layoutVar ?? 0}:${d?.entitiesVar ?? 0}`;
  }

  // The map file the quest's designation of a floor selects.
  private async geometryFor(floor: number): Promise<{ key: string; name: string | null }> {
    const d = this.doc.designation(floor);
    const area = this.doc.areaOf(floor);
    const key = this.keyFor(floor);
    if (!this.source || area === null) return { key, name: null };
    const table = await this.setDataTable();
    const ff = table ? floorFiles(table, area, d?.layoutVar ?? 0, d?.entitiesVar ?? 0, floor) : null;
    if (!ff) return { key, name: null };
    const scene = new Set(await this.source.list('scene'));
    return { key, name: geometryCandidates(ff.setup).find((g) => scene.has(g)) ?? null };
  }

  // Loads the map of the document's current floor and builds its entities.
  async showFloor(): Promise<void> {
    const token = ++this.loadToken;
    const floor = this.doc.floor;
    try {
      const geo = await this.geometryFor(floor);
      if (token !== this.loadToken) return;
      if (geo.key !== this.geometryKey || geo.name !== this.geometryName) {
        this.geometryKey = geo.key;
        this.geometryName = geo.name;
        this.clearModels();
        if (this.source && geo.name) {
          this.host.status(`Loading ${geo.name}...`);
          await this.viewer.load(this.source, geo.name);
          if (token !== this.loadToken) return;
        } else {
          this.viewer.clear();
        }
      }
      this.sections = this.viewer.geometry?.sections ?? [];
      this.rebuild();
      const area = this.doc.areaOf(floor);
      const d = this.doc.designation(floor);
      const note =
        d && (d.type === 1 || d.type === 2)
          ? ' · this floor loads the free-play template, the quest .dat entities are not used by the game'
          : d?.type === 3
            ? ' · this floor loads nothing in the game'
            : '';
      this.host.status(
        `Floor ${floor}: ${area === null ? 'no area' : areaName(area)}${geo.name ? ` (${geo.name})` : this.source ? ' · no map file found' : ' · open the PSOBB data folder to see the map'}${note}`,
        geo.name || !this.source ? 'ok' : 'err',
      );
      if (!geo.name) this.frameEntities();
    } catch (err) {
      this.host.status(`Floor ${floor}: ${(err as Error).message}`, 'err');
      this.sections = [];
      this.rebuild();
    }
  }

  // --- Building ---------------------------------------------------------------------

  private area(): number | null {
    return this.doc.areaOf(this.doc.floor);
  }

  private clearModels(): void {
    this.modelToken++;
    this.enemyLayer?.clear();
    this.objectLayer?.clear();
    this.npcLayer?.clear();
  }

  private keyOf(e: SetEntity): string {
    return `${e.type}|${e.params.join(',')}`;
  }

  // Markers and items for the entities of the current floor, then the models.
  rebuild(): void {
    const entities = this.doc.entitiesOf(this.doc.floor);
    const placed = placeEntities(entities, this.sections, this.area());
    this.items = placed.map((p) => ({ entity: p.entity, placed: p, mesh: null, slot: 0, key: this.keyOf(p.entity) }));
    this.byEntity = new Map(this.items.map((i) => [i.entity, i]));
    this.rebuildMarkers();
    this.rebuildSelection();
    this.scheduleModels();
  }

  private rebuildMarkers(): void {
    for (const m of this.markerMeshes) {
      this.markerRoot.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.markerMeshes = [];
    this.markerOf.clear();
    for (const category of ['enemy', 'npc', 'object'] as const) {
      const list = this.items.filter((i) => i.placed.category === category);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(6), new THREE.MeshBasicMaterial({ color: MARKER_COLORS[category], fog: false, transparent: true, opacity: 0.85 }), list.length);
      mesh.frustumCulled = false;
      list.forEach((item, i) => {
        item.mesh = mesh;
        item.slot = i;
        this.setMarkerMatrix(item);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.markerRoot.add(mesh);
      this.markerMeshes.push(mesh);
      this.markerOf.set(mesh, list);
    }
    this.markerRoot.visible = this.markersVisible;
  }

  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();

  private setMarkerMatrix(item: Item): void {
    if (!item.mesh) return;
    const [x, y, z] = item.placed.world;
    this.tmpQ.setFromAxisAngle(UP, item.placed.yaw);
    this.tmpM.compose(this.tmpV.set(x, y + MARKER_LIFT, z), this.tmpQ, ONE);
    item.mesh.setMatrixAt(item.slot, this.tmpM);
    item.mesh.instanceMatrix.needsUpdate = true;
  }

  // The selected entities get a yellow ring and a stem to the ground point.
  private rebuildSelection(): void {
    disposeChildren(this.selectionRoot);
    for (const e of this.doc.selection) {
      const item = this.byEntity.get(e);
      if (!item) continue;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(11, 1.4, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffe14d, fog: false, depthTest: false }));
      ring.rotation.x = Math.PI / 2;
      ring.renderOrder = 20;
      ring.userData.item = item;
      this.selectionRoot.add(ring);
    }
    this.rebuildTurnGizmo();
    this.positionSelection();
  }

  private positionSelection(): void {
    for (const c of this.selectionRoot.children) {
      const item = c.userData.item as Item;
      c.position.set(item.placed.world[0], item.placed.world[1] + MARKER_LIFT, item.placed.world[2]);
    }
    this.placeTurnGizmo();
  }

  // The pivot of the rotation gizmo: the last selected entity on this floor.
  private turnPivot(): Item | null {
    let pivot: Item | null = null;
    for (const s of this.doc.selection) pivot = this.byEntity.get(s) ?? pivot;
    return pivot;
  }

  // The rotation gizmo: a ring lying flat around the pivot with a dot at its
  // heading. Pressing the ring and dragging turns every selected entity in place.
  // Rebuilt with the selection; the geometry and materials of the old one are freed.
  private rebuildTurnGizmo(): void {
    disposeChildren(this.turnRoot);
    if (!this.turnPivot()) return;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(TURN_RADIUS, 1.2, 6, 48), new THREE.MeshBasicMaterial({ color: TURN_COLOR, fog: false, depthTest: false, transparent: true, opacity: 0.9 }));
    ring.rotation.x = Math.PI / 2;
    ring.renderOrder = 21;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 8), new THREE.MeshBasicMaterial({ color: TURN_COLOR, fog: false, depthTest: false }));
    dot.name = 'turn-heading';
    dot.renderOrder = 21;
    this.turnRoot.add(ring, dot);
    this.placeTurnGizmo();
  }

  // Moves the gizmo with its pivot and turns the heading dot to the pivot's yaw.
  private placeTurnGizmo(): void {
    const pivot = this.turnPivot();
    if (!pivot) return;
    const [x, y, z] = pivot.placed.world;
    this.turnRoot.position.set(x, y + MARKER_LIFT, z);
    this.turnRoot.getObjectByName('turn-heading')?.position.set(Math.sin(pivot.placed.yaw) * TURN_RADIUS, 0, Math.cos(pivot.placed.yaw) * TURN_RADIUS);
  }

  // The gizmo's grab test: where the pointer's ray meets the ring's plane is within
  // TURN_GRAB of the ring. Returns the plane and the pivot and start angle of a drag.
  private turnAt(e: { clientX: number; clientY: number }): { plane: THREE.Plane; cx: number; cz: number; angle: number } | null {
    const pivot = this.turnPivot();
    if (!pivot) return null;
    const [x, y, z] = pivot.placed.world;
    const plane = new THREE.Plane(UP, -(y + MARKER_LIFT));
    this.raycaster.setFromCamera(this.ndc(e), this.viewer.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return null;
    if (Math.abs(Math.hypot(p.x - x, p.z - z) - TURN_RADIUS) > TURN_GRAB) return null;
    return { plane, cx: x, cz: z, angle: pivotAngle(x, z, p.x, p.z) };
  }

  private scheduleModels(): void {
    if (this.modelTimer) clearTimeout(this.modelTimer);
    this.modelTimer = setTimeout(() => void this.buildModels(), MODEL_DELAY_MS);
  }

  private async buildModels(): Promise<void> {
    if (!this.files || !this.enemyLayer || !this.objectLayer || !this.npcLayer) return;
    const token = ++this.modelToken;
    const area = this.area();
    if (area === null) return;
    const placed = this.items.map((i) => i.placed).filter((p) => !(p.entity.kind === 'object' && p.entity.type === 0));
    const episode = this.doc.episode;
    try {
      await this.enemyLayer.show(placed, { area, episode, difficulty: 0, event: 0 });
      if (token !== this.modelToken) return;
      await this.npcLayer.show(placed, { area, sectionId: 0 });
      if (token !== this.modelToken) return;
      await this.objectLayer.show(placed, { area, episode });
      if (token !== this.modelToken) return;
      this.applyModelVisibility();
    } catch (err) {
      this.host.status(`Models: ${(err as Error).message}`, 'err');
    }
  }

  private applyModelVisibility(): void {
    for (const name of ['enemies', 'npcs', 'objects']) {
      const o = this.viewer.scene.getObjectByName(name);
      if (o) o.visible = this.modelsVisible;
    }
  }

  setMarkersVisible(v: boolean): void {
    this.markersVisible = v;
    this.markerRoot.visible = v;
  }

  setModelsVisible(v: boolean): void {
    this.modelsVisible = v;
    this.applyModelVisibility();
  }

  // --- Reacting to the document ---------------------------------------------------------

  private onChange(c: Change): void {
    switch (c.kind) {
      case 'document':
      case 'floor':
        this.geometryKey = c.kind === 'document' ? '' : this.geometryKey;
        void this.showFloor();
        break;
      case 'bin':
      case 'header':
        // A designation or the episode may have changed the map.
        if (this.keyFor(this.doc.floor) !== this.geometryKey) void this.showFloor();
        else if (c.kind === 'bin') this.rebuild();
        break;
      case 'entities':
        if (c.floor === this.doc.floor) this.rebuild();
        break;
      case 'fields':
        this.syncFields(c.entities ?? []);
        break;
      case 'selection':
        this.rebuildSelection();
        break;
      default:
        break;
    }
  }

  // Position / angle / section edits move the markers and models in place; a
  // change of type or parameters rebuilds the models.
  private syncFields(entities: readonly SetEntity[]): void {
    let models = false;
    for (const e of entities) {
      const item = this.byEntity.get(e);
      if (!item) continue;
      const fresh = placeEntities([e], this.sections, this.area())[0];
      item.placed.world = fresh.world;
      item.placed.yaw = fresh.yaw;
      item.placed.name = fresh.name;
      item.placed.sectionFound = fresh.sectionFound;
      this.setMarkerMatrix(item);
      this.moveModel(item);
      const key = this.keyOf(e);
      if (key !== item.key) {
        item.key = key;
        models = true;
        if (fresh.category !== item.placed.category) {
          this.rebuild(); // moved between marker groups
          return;
        }
      }
    }
    this.positionSelection();
    if (models) this.scheduleModels();
  }

  private moveModel(item: Item): void {
    const e = item.entity;
    const [x, y, z] = item.placed.world;
    let root: THREE.Object3D | null | undefined = null;
    if (e.kind === 'enemy') {
      root = this.enemyLayer?.model(e.index) ?? this.npcLayer?.instances.find((n) => n.placed === item.placed)?.root;
    } else root = this.objectLayer?.models.get(e.index)?.root;
    if (!root) return;
    root.position.set(x, y, z);
    root.rotation.y = item.placed.yaw;
  }

  // --- Picking and dragging ------------------------------------------------------------------

  private ndc(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private pick(e: { clientX: number; clientY: number }): Item | null {
    if (!this.markersVisible || !this.markerMeshes.length) return null;
    this.raycaster.setFromCamera(this.ndc(e), this.viewer.camera);
    const hit = this.raycaster.intersectObjects(this.markerMeshes, false)[0];
    if (!hit || hit.instanceId === undefined) return null;
    return this.markerOf.get(hit.object as THREE.InstancedMesh)?.[hit.instanceId] ?? null;
  }

  private onDown(e: PointerEvent): void {
    if (e.target !== this.canvas || e.button !== 0) return;
    this.canvas.focus({ preventScroll: true });
    const turn = this.turnAt(e);
    if (turn) {
      // The gizmo wins over the markers; the selection is what it turns.
      e.stopPropagation();
      const items = this.doc.selection.map((s) => this.byEntity.get(s)).filter((i): i is Item => !!i);
      this.drag = {
        kind: 'turn',
        plane: turn.plane,
        cx: turn.cx,
        cz: turn.cz,
        startAngle: turn.angle,
        startX: e.clientX,
        startY: e.clientY,
        items: items.map((item) => ({ item, rotation: [...item.entity.rotation] as Vec3 })),
        moved: false,
      };
      this.viewer.setOrbitEnabled(false);
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    const item = this.pick(e);
    if (!item) {
      this.drag = { kind: 'click', startX: e.clientX, startY: e.clientY, shift: e.shiftKey || e.ctrlKey || e.metaKey };
      return;
    }
    e.stopPropagation(); // keep OrbitControls from starting a rotation
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) this.doc.select([item.entity], 'toggle');
    else if (!this.doc.isSelected(item.entity)) this.doc.select([item.entity]);
    const moved = this.doc.selection.map((s) => this.byEntity.get(s)).filter((i): i is Item => !!i);
    if (!moved.length) return;
    this.raycaster.setFromCamera(this.ndc(e), this.viewer.camera);
    const plane = new THREE.Plane(UP, -item.placed.world[1]);
    const start = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, start)) return;
    this.drag = {
      kind: e.altKey ? 'rotate' : 'move',
      plane,
      start,
      startX: e.clientX,
      startY: e.clientY,
      shift: additive,
      items: moved.map((i) => ({ item: i, world: [...i.placed.world] as Vec3, rotation: [...i.entity.rotation] as Vec3 })),
      moved: false,
    };
    this.viewer.setOrbitEnabled(false);
    this.canvas.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || d.kind === 'click') {
      this.hover(e);
      return;
    }
    this.tooltip.hidden = true;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 3) return;
    d.moved = true;
    if (d.kind === 'turn') {
      // Holding Shift snaps the stored angle to 15 degrees (the drag's own snap is live).
      this.raycaster.setFromCamera(this.ndc(e), this.viewer.camera);
      const point = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(d.plane, point)) return;
      const angle = pivotAngle(d.cx, d.cz, point.x, point.z);
      const snap = e.shiftKey;
      this.doc.patchEntities(
        d.items.map(({ item, rotation }) => [item.entity, { rotation: [rotation[0], turnedBams(rotation[1], d.startAngle, angle, snap), rotation[2]] as Vec3 }] as const),
        'Turn',
        'turn',
      );
      return;
    }
    if (d.kind === 'rotate') {
      const deltaDeg = -(e.clientX - d.startX) * 0.5;
      this.doc.patchEntities(
        d.items.map(({ item, rotation }) => [item.entity, { rotation: [rotation[0], wrapBams(rotation[1] + degreesToBams(deltaDeg)), rotation[2]] as Vec3 }] as const),
        'Rotate',
        'rotate',
      );
      return;
    }
    this.raycaster.setFromCamera(this.ndc(e), this.viewer.camera);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(d.plane, point)) return;
    const delta = point.sub(d.start);
    this.doc.patchEntities(
      d.items.map(({ item, world }) => {
        const w: Vec3 = [world[0] + delta.x, world[1], world[2] + delta.z];
        if (this.snapToGround) w[1] = this.viewer.groundHeight(w[0], w[2], world[1] + 200) ?? w[1];
        return [item.entity, { position: this.localOf(item.entity, w) }] as const;
      }),
      'Move',
      'move',
    );
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    this.viewer.setOrbitEnabled(true);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (d.kind === 'click') {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4 && !d.shift) this.doc.clearSelection();
      return;
    }
    this.doc.seal();
  }

  private hover(e: PointerEvent): void {
    if (e.buttons) return;
    if (this.turnAt(e)) {
      this.canvas.style.cursor = 'grab';
      this.tooltip.hidden = true;
      return;
    }
    const item = this.pick(e);
    this.canvas.style.cursor = item ? 'pointer' : '';
    if (!item) {
      this.tooltip.hidden = true;
      return;
    }
    const en = item.entity;
    const extra = en.kind === 'enemy' ? `room ${en.section} · wave ${en.wave}` : `room ${en.section} · group ${en.group}`;
    this.tooltip.textContent = `${item.placed.name}\n${en.kind} #${en.index} · type 0x${en.type.toString(16).toUpperCase()} · ${extra}`;
    const r = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
    this.tooltip.style.left = `${e.clientX - r.left + 14}px`;
    this.tooltip.style.top = `${e.clientY - r.top + 14}px`;
    this.tooltip.hidden = false;
  }

  // Section-relative position of a world point for an entity (its own section; a
  // section the map lacks leaves the point as it is).
  localOf(entity: SetEntity, world: Vec3): Vec3 {
    const s = this.sections.find((x) => x.id === entity.section);
    return s ? worldToSection(s, world) : world;
  }

  // --- Placement ---------------------------------------------------------------------------------

  // Where a pointer position lands on the floor: the horizontal plane through the
  // orbit target, dropped onto the map under it when there is one.
  pointAt(clientX: number, clientY: number): Placement | null {
    this.raycaster.setFromCamera(this.ndc({ clientX, clientY }), this.viewer.camera);
    const target = this.viewer.orbitTarget;
    const plane = new THREE.Plane(UP, -target.y);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return null;
    const ground = this.viewer.groundHeight(p.x, p.z, target.y + 600);
    return this.placement([p.x, ground ?? p.y, p.z]);
  }

  centerPoint(): Placement | null {
    const r = this.canvas.getBoundingClientRect();
    return this.pointAt(r.left + r.width / 2, r.top + r.height / 2);
  }

  private placement(world: Vec3): Placement {
    const s = nearestSection(this.sections, world);
    return { world, section: s?.id ?? 0, local: s ? worldToSection(s, world) : world };
  }

  // Section and local position of the entity's current world position under another
  // section (the "snap to the nearest section" action).
  reassignSection(entity: SetEntity): { section: number; position: Vec3 } | null {
    const item = this.byEntity.get(entity);
    if (!item) return null;
    const s = nearestSection(this.sections, item.placed.world);
    return s ? { section: s.id, position: worldToSection(s, item.placed.world) } : null;
  }

  // Y of the map under an entity (the "drop to ground" action), in local units.
  groundedPosition(entity: SetEntity): Vec3 | null {
    const item = this.byEntity.get(entity);
    if (!item) return null;
    const [x, y, z] = item.placed.world;
    const g = this.viewer.groundHeight(x, z, y + 200);
    return g === null ? null : this.localOf(entity, [x, g, z]);
  }

  // --- Camera ----------------------------------------------------------------------------------------

  frameAll(): void {
    if (this.sections.length) this.viewer.frameAll();
    else this.frameEntities();
  }

  // Client coordinates of an entity's marker on screen (null when it is not drawn or is behind the
  // camera). The e2e tests use it to grab an entity with the mouse.
  screenPointOf(entity: SetEntity): { x: number; y: number } | null {
    const item = this.byEntity.get(entity);
    if (!item) return null;
    const [x, y, z] = item.placed.world;
    const p = new THREE.Vector3(x, y + MARKER_LIFT, z).project(this.viewer.camera);
    if (p.z > 1 || p.z < -1) return null;
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  frameSelection(): void {
    const list = this.doc.selection.length ? this.doc.selection : this.doc.entitiesOf(this.doc.floor);
    this.frameOn(list.map((e) => this.byEntity.get(e)?.placed.world).filter((w): w is Vec3 => !!w), this.doc.selection.length ? 120 : 0);
  }

  private frameEntities(): void {
    this.frameOn(this.items.map((i) => i.placed.world), 0);
  }

  private frameOn(points: Vec3[], minDistance: number): void {
    if (!points.length) return;
    const box = new THREE.Box3();
    for (const p of points) box.expandByPoint(this.tmpV.set(p[0], p[1], p[2]));
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), minDistance, 200);
    const cam = this.viewer.camera.position.clone().sub(this.viewer.orbitTarget);
    if (cam.lengthSq() < 1e-6) cam.set(0, 0.45, 0.55);
    cam.setLength(size * 0.9);
    this.viewer.orbitTarget.copy(center);
    this.viewer.camera.position.copy(center).add(cam);
  }

  // Yaw of an entity in degrees as the inspector shows it.
  static yawDegrees(e: SetEntity): number {
    return bamsToDegrees(e.rotation[1]);
  }
}

// Removes the children of a group and frees their geometry and materials.
function disposeChildren(group: THREE.Group): void {
  for (const c of [...group.children]) {
    group.remove(c);
    if (c instanceof THREE.Mesh) {
      c.geometry.dispose();
      (c.material as THREE.Material).dispose();
    }
  }
}

type DragState =
  | { kind: 'click'; startX: number; startY: number; shift: boolean }
  | {
      kind: 'turn';
      plane: THREE.Plane;
      cx: number;
      cz: number;
      startAngle: number;
      startX: number;
      startY: number;
      items: Array<{ item: Item; rotation: Vec3 }>;
      moved: boolean;
    }
  | {
      kind: 'move' | 'rotate';
      plane: THREE.Plane;
      start: THREE.Vector3;
      startX: number;
      startY: number;
      shift: boolean;
      items: Array<{ item: Item; world: Vec3; rotation: Vec3 }>;
      moved: boolean;
    };

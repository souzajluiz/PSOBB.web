// Items on the floor of a game (net/items.ts holds the state) drawn with the
// item.bml box models the way PsoBB.exe does (formats/itemmodels.ts), plus
// the two interactions the field needs before combat exists: pick up the
// nearest item and break the nearest item box, both with Enter.
//
// From PsoBB.exe (Ephinea 1.25.13), see formats/itemmodels.ts:
//   - model = item.bml entry kind + 2, textures from entry 0's list;
//   - wrapped items and kinds 6/7 draw the gift box (entry 8), the root
//     tinted with 0x009c2000[color] and its child with 0x009c2060[color];
//   - kind 5 scrolls its texture (FUN_005cb350(1, 1, 0xb) -> FUN_00835f88):
//     the offset is (counter * 1 & 0xFF) * 1 * 1/256 (0x0092bd9c) on both
//     axes, i.e. one texel row of a 256 cycle per frame. The counters at
//     +0x100/+0x102 of the effect object are taken to advance once per frame
//     (not traced);
//   - the Y angle turns 0x200 BAMS per frame (FUN_005c4010), 30 frames/s.
// Fitted (not from the exe): the box rests on the floor under its drop
// position (the drop commands only carry x and z; how the client finds the
// height was not traced), the Enter radius for pickup (PICKUP_RADIUS; newserv
// accepts up to 30) and for boxes (BOX_RADIUS).

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import {
  floorItemLook,
  ITEM_BML,
  ITEM_BML_MODELS,
  ITEM_SPIN_BAMS_PER_FRAME,
  PRESENT_BOX_COLORS,
  PRESENT_RIBBON_COLORS,
  type ItemModelTables,
} from '../formats/itemmodels.ts';
import { maxStackSize } from '../formats/itemnames.ts';
import type { PlacedEntity, ObjectSet } from '../formats/setdata.ts';
import { EMPTY_BOX_TYPES, ITEM_BOX_TYPES, type FloorItem, type GameItems } from '../net/items.ts';
import { EnemyArchive } from './enemymodel.ts';
import type { MapViewer } from './mapviewer.ts';
import { buildObjectTreeWithNodes, MaterialCache } from './njmesh.ts';
import { GAME_TICKS_PER_SECOND } from './playeranim.ts';
import type { NjObject } from '../formats/xj.ts';

export const PICKUP_RADIUS = 15; // fitted
export const BOX_RADIUS = 20; // fitted
const SPIN_RAD_PER_SECOND = (ITEM_SPIN_BAMS_PER_FRAME / 0x10000) * Math.PI * 2 * GAME_TICKS_PER_SECOND;
const HEIGHT_WINDOW = 30;

export interface FloorItemLayerOptions {
  ground: (x: number, z: number, fromY: number) => number | null;
  blocked: () => boolean; // a menu has the keyboard
  describe?: (item: FloorItem) => string;
  log?: (msg: string) => void;
}

interface Shown {
  item: FloorItem;
  node: THREE.Object3D;
  scroll: THREE.Texture[];
}

interface Box {
  objectIndex: number; // across all floors
  entity: ObjectSet;
  x: number;
  y: number;
  z: number;
  area: number;
}

export class FloorItemLayer {
  private viewer: MapViewer;
  private files: ClientFiles;
  private items: GameItems;
  private opts: FloorItemLayerOptions;
  private archive: Promise<EnemyArchive | null>;
  private tables: ItemModelTables | null = null;
  private root = new THREE.Group();
  private shown = new Map<number, Shown>();
  private boxes: Box[] = [];
  private floor = -1;
  private frames = 0;
  private disposed = false;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.repeat && !this.opts.blocked()) this.interact();
  };

  constructor(viewer: MapViewer, files: ClientFiles, items: GameItems, opts: FloorItemLayerOptions) {
    this.viewer = viewer;
    this.files = files;
    this.items = items;
    this.opts = opts;
    this.root.name = 'floor-items';
    viewer.scene.add(this.root);
    this.archive = files
      .read(ITEM_BML)
      .then((d) => new EnemyArchive(ITEM_BML, d, ITEM_BML_MODELS))
      .catch((err) => {
        opts.log?.(`floor items: ${(err as Error).message}`);
        return null;
      });
    items.onFloorItemAdded = (it) => void this.show(it);
    items.onFloorItemRemoved = (it) => this.hide(it.id);
    viewer.renderer.domElement.addEventListener('keydown', this.onKey);
  }

  setTables(tables: ItemModelTables | null, describe?: (item: FloorItem) => string): void {
    this.tables = tables;
    if (describe) this.opts.describe = describe;
    for (const s of [...this.shown.values()]) {
      this.hide(s.item.id);
      void this.show(s.item);
    }
  }

  // A floor was loaded: show its items and remember its item boxes.
  enterFloor(floor: number, area: number, placed: PlacedEntity[], objectBase: number): void {
    this.floor = floor;
    for (const id of [...this.shown.keys()]) this.hide(id);
    this.boxes = placed
      .filter((p) => p.entity.kind === 'object' && (ITEM_BOX_TYPES.has(p.entity.type) || EMPTY_BOX_TYPES.has(p.entity.type)))
      .map((p) => ({ objectIndex: objectBase + p.entity.index, entity: p.entity as ObjectSet, x: p.world[0], y: p.world[1], z: p.world[2], area }));
    for (const it of this.items.floorItems.values()) void this.show(it);
  }

  // Chains viewer.onFrame (call after the floor's LobbyView / GameField took it).
  attach(): void {
    const inner = this.viewer.onFrame;
    this.viewer.onFrame = (dt, keys) => {
      inner?.(dt, keys);
      this.frame(dt);
    };
  }

  private async show(item: FloorItem): Promise<void> {
    if (item.floor !== this.floor || this.shown.has(item.id)) return;
    const archive = await this.archive;
    if (!archive || this.disposed || item.floor !== this.floor || this.shown.has(item.id) || !this.items.floorItems.has(item.id)) return;
    const look = floorItemLook(item.data, this.tables, maxStackSize(item.data) > 1);
    const names = archive.model(0).textures; // FUN_005b8624(0): texture list 0
    const data = archive.model(look.model);
    if (data.kind !== 'xj') return;
    const built = buildObjectTreeWithNodes(data.object as NjObject, new MaterialCache((id) => (names[id] !== undefined ? archive.texture(names[id]) : null)));
    const scroll: THREE.Texture[] = [];
    const gift = look.model === 8;
    built.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m: THREE.Material) => {
        const c = m.clone() as THREE.MeshBasicMaterial;
        if (gift) {
          // FUN_005c383c: root model with the box color, child with the ribbon color.
          const [r, g, b] = (o.parent === built.nodes[0] ? PRESENT_BOX_COLORS : PRESENT_RIBBON_COLORS)[Math.min(look.color, 5)];
          c.color.setRGB(r, g, b, THREE.SRGBColorSpace);
        }
        if (look.scroll && c.transparent && c.map) {
          c.map = c.map.clone();
          c.map.wrapS = c.map.wrapT = THREE.RepeatWrapping;
          c.map.needsUpdate = true;
          scroll.push(c.map);
        }
        return c;
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
    });
    const node = new THREE.Group();
    node.add(built.root);
    const box = new THREE.Box3().setFromObject(built.root);
    const near = this.boxes.find((b) => Math.hypot(b.x - item.x, b.z - item.z) < 1)?.y ?? this.items.game.self?.position.y ?? 0;
    const ground = this.opts.ground(item.x, item.z, near + HEIGHT_WINDOW) ?? near;
    node.position.set(item.x, ground - (Number.isFinite(box.min.y) ? box.min.y : 0), item.z);
    node.name = `item ${item.id.toString(16)}`;
    node.userData.floorItem = item;
    this.root.add(node);
    this.shown.set(item.id, { item, node, scroll });
  }

  private hide(id: number): void {
    const s = this.shown.get(id);
    if (!s) return;
    this.shown.delete(id);
    this.root.remove(s.node);
    s.node.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
    for (const t of s.scroll) t.dispose();
  }

  private frame(dt: number): void {
    if (this.disposed) return;
    const spin = SPIN_RAD_PER_SECOND * dt;
    this.frames += dt * GAME_TICKS_PER_SECOND;
    const offset = (Math.floor(this.frames) & 0xff) / 256;
    for (const s of this.shown.values()) {
      s.node.rotation.y += spin;
      for (const t of s.scroll) t.offset.set(offset, offset);
    }
  }

  // Enter: the nearest item within PICKUP_RADIUS, else the nearest closed box.
  interact(): void {
    const me = this.items.game.self;
    if (!me || this.items.game.loading) return;
    const p = me.position;
    let best: Shown | null = null;
    let bestD = PICKUP_RADIUS;
    for (const s of this.shown.values()) {
      const d = Math.hypot(s.item.x - p.x, s.item.z - p.z);
      if (d <= bestD && Math.abs(s.node.position.y - p.y) < HEIGHT_WINDOW) {
        best = s;
        bestD = d;
      }
    }
    if (best) {
      this.opts.log?.(`pick up ${this.opts.describe?.(best.item) ?? best.item.id.toString(16)}`);
      this.items.pickUp(best.item);
      return;
    }
    let box: Box | null = null;
    let boxD = BOX_RADIUS;
    for (const b of this.boxes) {
      if (this.items.openedBoxes.has(b.objectIndex)) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d <= boxD && Math.abs(b.y - p.y) < HEIGHT_WINDOW) {
        box = b;
        boxD = d;
      }
    }
    if (box) {
      const e = box.entity;
      this.opts.log?.(`break box ${e.index} (type 0x${e.type.toString(16)}, object ${box.objectIndex})`);
      this.items.openBox({ floor: this.floor, area: box.area, objectIndex: box.objectIndex, type: e.type, room: e.section, x: box.x, z: box.z, params: e.params });
    }
  }

  // Item boxes of the current floor that are still closed (tests, overlays).
  get closedBoxes(): Box[] {
    return this.boxes.filter((b) => !this.items.openedBoxes.has(b.objectIndex));
  }

  get visibleItems(): FloorItem[] {
    return [...this.shown.values()].map((s) => s.item);
  }

  dispose(): void {
    this.disposed = true;
    this.viewer.renderer.domElement.removeEventListener('keydown', this.onKey);
    for (const id of [...this.shown.keys()]) this.hide(id);
    this.viewer.scene.remove(this.root);
    void this.archive.then((a) => a?.dispose());
  }
}

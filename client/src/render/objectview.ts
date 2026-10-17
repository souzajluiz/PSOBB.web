// Models of the set-data objects of a floor (formats/objectmodels.ts): loads
// each class's BML the way the client's loader does (render/enemymodel.ts
// reads the archives by entry position), builds the parts the constructor
// picks and keeps the parts that are only drawn in one state (locked /
// unlocked door, lit switch) switchable.
//
// Motions: parts with drive 'loop' or 'restart' advance like an enemy idle
// motion; parts with drive 'door' or 'laser' are driven by the door state
// machine (fieldobjects.ts) through ObjectModel.setDoorFrame / setLaserFrame.
// Four-light doors light their lamps one by one through setLamps.

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import { isInvisibleObject, objectModelFor, type ObjectModelContext, type ObjectModelSpec, type ObjectPartSpec, type PartShow } from '../formats/objectmodels.ts';
import type { PlacedEntity } from '../formats/setdata.ts';
import { buildEnemy, EnemyArchiveCache, type EnemyPartSpec, type NodeAnimator } from './enemymodel.ts';
import type { MapViewer } from './mapviewer.ts';

// Texture ids are per model; remapping every id to one texture is how
// FUN_0081a588 sets the texture of all meshes of a model.
const ALL_IDS = 64;

export interface ObjectPart {
  show: PartShow;
  group: THREE.Object3D;
  animator: NodeAnimator | null;
  drive: ObjectPartSpec['drive'];
  nodes: THREE.Object3D[]; // node tree, depth first
}

export interface ObjectModel {
  entity: PlacedEntity;
  spec: ObjectModelSpec;
  root: THREE.Group;
  parts: ObjectPart[];
}

export interface ObjectLayerStats {
  placed: number;
  unresolved: string[]; // names of object types with no model yet
  invisible: number; // volumes and markers that draw nothing on purpose
  errors: string[];
}

function texRemap(p: ObjectPartSpec): number[] | undefined {
  if (p.textureId !== undefined) return new Array(ALL_IDS).fill(p.textureId);
  if (!p.texIds) return undefined;
  const ids = Array.from({ length: ALL_IDS }, (_, i) => i);
  for (const [from, to] of Object.entries(p.texIds)) ids[Number(from)] = to;
  return ids;
}

const loops = (drive: ObjectPartSpec['drive']) => drive === 'loop' || drive === 'restart' || drive === 'restart-last';

function toEnemyPart(p: ObjectPartSpec): EnemyPartSpec {
  return {
    model: p.model,
    texlistOf: p.texlistOf,
    textureArchive: p.textures,
    texRemap: texRemap(p),
    motion: p.motion !== undefined ? { index: p.motion, speed: p.speed ?? 1, loop: loops(p.drive) } : null,
  };
}

// The meshes a node draws itself (its model), not those of its child nodes.
function ownMeshes(node: THREE.Object3D, nodes: ReadonlySet<THREE.Object3D>): THREE.Object3D[] {
  return node.children.filter((c) => !nodes.has(c));
}

export class ObjectLayer {
  private viewer: MapViewer;
  private cache: EnemyArchiveCache;
  private root: THREE.Group | null = null;
  private animators: NodeAnimator[] = [];
  private hook = (dt: number) => {
    for (const a of this.animators) a.update(dt);
  };
  private generation = 0;
  models = new Map<number, ObjectModel>(); // by o.dat entry index
  stats: ObjectLayerStats = { placed: 0, unresolved: [], invisible: 0, errors: [] };

  constructor(viewer: MapViewer, files: ClientFiles) {
    this.viewer = viewer;
    this.cache = new EnemyArchiveCache(files);
    viewer.frameHooks.add(this.hook);
  }

  // Builds the models of the objects in `items`; returns the entries that got
  // one (the caller keeps markers for the rest).
  async show(items: PlacedEntity[], ctx: ObjectModelContext): Promise<Set<PlacedEntity>> {
    this.clear();
    const gen = ++this.generation;
    const root = new THREE.Group();
    root.name = 'objects';
    const done = new Set<PlacedEntity>();
    const stats: ObjectLayerStats = { placed: 0, unresolved: [], invisible: 0, errors: [] };
    const animators: NodeAnimator[] = [];
    for (const p of items) {
      const e = p.entity;
      if (e.kind !== 'object') continue;
      const spec = objectModelFor(e, ctx);
      if (!spec) {
        // A volume or marker draws nothing on purpose, so it is not a gap.
        if (isInvisibleObject(p.name)) stats.invisible++;
        else stats.unresolved.push(p.name);
        continue;
      }
      try {
        // The archive's model count is the number of non-motion entries; the
        // loader knows it from the asset descriptor. Here it is derived from
        // the entry names, which the BML keeps (.nj / .xj vs .njm / .njs).
        const archive = await this.cache.getAuto(spec.bml);
        for (const part of spec.parts) if (part.textures) await this.cache.textures(part.textures);
        if (gen !== this.generation) return done;
        const model: ObjectModel = { entity: p, spec, root: new THREE.Group(), parts: [] };
        for (const part of spec.parts) {
          const built = buildEnemy(archive, [toEnemyPart(part)], 0, this.cache.loadedTextures);
          if (part.tint) {
            const [r, g, b] = part.tint;
            built.root.traverse((o) => {
              if (o instanceof THREE.Mesh) {
                for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
                  const mat = m as THREE.MeshBasicMaterial;
                  if (mat.color) mat.color.setRGB(r, g, b);
                }
              }
            });
          }
          const animator = built.animators[0] ?? null;
          if (animator && part.drive === 'restart') animator.restart = 'past';
          if (animator && part.drive === 'restart-last') animator.restart = 'last';
          if (animator && loops(part.drive)) animators.push(animator);
          if (animator && !loops(part.drive)) animator.setFrame(0);
          model.parts.push({ show: part.show ?? 'always', group: built.root, animator, drive: part.drive, nodes: built.partNodes[0] ?? [] });
          model.root.add(built.root);
        }
        model.root.position.set(p.world[0], p.world[1], p.world[2]);
        model.root.rotation.y = p.yaw;
        model.root.name = `${spec.name} #${e.index}`;
        model.root.userData.entity = p;
        root.add(model.root);
        this.models.set(e.index, model);
        done.add(p);
        stats.placed++;
      } catch (err) {
        stats.errors.push(`${p.name} (${spec.bml}): ${(err as Error).message}`);
      }
    }
    if (gen !== this.generation) return done;
    this.viewer.scene.add(root);
    this.root = root;
    this.animators = animators;
    this.stats = stats;
    return done;
  }

  // Shows the parts of one object for a state: doors pass 'locked' or
  // 'unlocked', switches 'on' or 'off', boss warps 'idle', 'active' or 'off'.
  setState(index: number, state: PartShow): void {
    const m = this.models.get(index);
    if (!m) return;
    for (const part of m.parts) part.group.visible = part.show === 'always' || part.show === state;
  }

  // Four-light door: `lit` gives each lamp while the door is closed, null
  // draws the whole door with the lit list (opening, open, closing). Parts 0
  // and 1 are the door with its own list and with the lit one.
  setLamps(index: number, lit: readonly boolean[] | null): void {
    const m = this.models.get(index);
    const lamps = m?.spec.lamps;
    if (!m || !lamps || m.parts.length < 2) return;
    const [own, green] = m.parts;
    own.group.visible = lit !== null;
    green.group.visible = true;
    const ownSet = new Set(own.nodes);
    const greenSet = new Set(green.nodes);
    const lampOf = new Map<number, number>();
    lamps.forEach((nodes, i) => nodes.forEach((n) => lampOf.set(n, i)));
    green.nodes.forEach((node, n) => {
      const lamp = lampOf.get(n);
      const show = lit === null || (lamp !== undefined && lit[lamp]);
      for (const o of ownMeshes(node, greenSet)) o.visible = show;
    });
    if (lit === null) return;
    own.nodes.forEach((node, n) => {
      const lamp = lampOf.get(n);
      const show = lamp === undefined || !lit[lamp];
      for (const o of ownMeshes(node, ownSet)) o.visible = show;
    });
  }

  setVisible(index: number, visible: boolean): void {
    const m = this.models.get(index);
    if (m) m.root.visible = visible;
  }

  // Frame of the parts driven by the door state machine.
  setDoorFrame(index: number, frame: number): void {
    const m = this.models.get(index);
    if (!m) return;
    for (const part of m.parts) if (part.drive === 'door' && part.animator) part.animator.setFrame(frame);
  }

  setLaserFrame(index: number, frame: number): void {
    const m = this.models.get(index);
    if (!m) return;
    for (const part of m.parts) if (part.drive === 'laser' && part.animator) part.animator.setFrame(frame);
  }

  // Length of the door motion in frames (the state machine clamps to it).
  doorFrames(index: number): number {
    const m = this.models.get(index);
    if (!m) return 0;
    for (const part of m.parts) if (part.drive === 'door' && part.animator) return part.animator.frameCount;
    return 0;
  }

  clear(): void {
    this.generation++;
    this.animators = [];
    this.models.clear();
    if (!this.root) return;
    this.viewer.scene.remove(this.root);
    const materials = new Set<THREE.Material>();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
      if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
    });
    for (const m of materials) m.dispose();
    this.root = null;
  }

  dispose(): void {
    this.clear();
    this.viewer.frameHooks.delete(this.hook);
    void this.cache.dispose();
  }
}

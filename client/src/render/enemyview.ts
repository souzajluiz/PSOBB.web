// Enemy models of a floor: resolves each enemy set entry to its model
// (formats/enemymodels.ts), builds it at the spawn point and plays its idle
// motion every frame. An enemy whose client object creates child objects (the
// Chaos Sorcerer's bits, Vol Opt's monitors and pillars, Saint-Milion's
// tentacles) builds them too: children placed relative to the enemy go under
// its root, the ones the client places from the arena origin go into a second
// root that stays at the world origin. In a game every enemy belongs to a wave event and only
// exists once its wave has spawned (render/waves.ts), so the game hides them
// all (hideAll) and shows each set entry when its wave starts (setVisible);
// the map viewer leaves them visible.

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import { enemyModelFor, type EnemyModelContext, type EnemyModelSpec } from '../formats/enemymodels.ts';
import type { PlacedEntity } from '../formats/setdata.ts';
import { buildEnemy, EnemyArchiveCache, type EnemyArchive, type EnemyPartSpec, type NodeAnimator } from './enemymodel.ts';
import type { MapViewer } from './mapviewer.ts';

export interface EnemyLayerStats {
  placed: number; // enemies with a model
  unresolved: string[]; // names of enemies without one
  errors: string[];
}

// A built enemy model (render/combat.ts plays its damage / death motions).
export interface EnemyInstance {
  placed: PlacedEntity;
  spec: EnemyModelSpec;
  archive: EnemyArchive;
  root: THREE.Group;
  // Child objects the client places from the arena origin instead of the set
  // entry (Vol Opt): a second root, left at the world origin.
  world: THREE.Group | null;
  animators: NodeAnimator[];
  parts: EnemyPartSpec[]; // part of each animator
  nodes?: THREE.Object3D[][]; // node tree of each spec part, depth first (BuiltEnemy.partNodes)
}

export class EnemyLayer {
  private viewer: MapViewer;
  private cache: EnemyArchiveCache;
  private root: THREE.Group | null = null;
  private animators: NodeAnimator[] = [];
  private hook = (dt: number) => {
    for (const a of this.animators) a.update(dt);
  };
  private generation = 0;
  private byIndex = new Map<number, THREE.Object3D>(); // e.dat entry index -> model root
  private worldByIndex = new Map<number, THREE.Object3D>(); // -> its world-placed children
  private hidden = false; // hideAll() was called for the current floor
  startHidden = false; // games: every floor starts with all enemies hidden (waves show them)
  stats: EnemyLayerStats = { placed: 0, unresolved: [], errors: [] };
  instances: EnemyInstance[] = [];

  constructor(viewer: MapViewer, files: ClientFiles) {
    this.viewer = viewer;
    this.cache = new EnemyArchiveCache(files);
    viewer.frameHooks.add(this.hook);
  }

  // Builds the models of the enemies in `items`; returns the entries that got
  // a model (the caller can keep markers for the rest).
  async show(items: PlacedEntity[], ctx: EnemyModelContext): Promise<Set<PlacedEntity>> {
    this.clear();
    this.hidden = this.startHidden;
    const gen = ++this.generation;
    const root = new THREE.Group();
    root.name = 'enemies';
    const done = new Set<PlacedEntity>();
    const stats: EnemyLayerStats = { placed: 0, unresolved: [], errors: [] };
    const animators: NodeAnimator[] = [];
    const instances: EnemyInstance[] = [];
    for (const p of items) {
      const e = p.entity;
      if (e.kind !== 'enemy' || p.category !== 'enemy') continue;
      const spec = enemyModelFor(e, ctx);
      if (!spec) {
        stats.unresolved.push(p.name);
        continue;
      }
      try {
        const archive = await this.cache.get(spec.bml, spec.models);
        for (const t of spec.textures ?? []) await this.cache.textures(t);
        const extra = new Map<string, EnemyArchive>();
        for (const a of spec.archives ?? []) extra.set(a.bml, await this.cache.get(a.bml, a.models));
        if (gen !== this.generation) return done;
        // Spread the start frames so a group does not move in lockstep.
        const built = buildEnemy(archive, spec.parts, ((e.index * 0.618034) % 1 + 1) % 1, this.cache.loadedTextures, extra);
        built.root.position.set(p.world[0], p.world[1], p.world[2]);
        built.root.rotation.y = p.yaw;
        built.root.name = `${spec.name} #${e.index}`;
        built.root.userData.entity = p;
        built.root.visible = !this.hidden;
        this.byIndex.set(e.index, built.root);
        root.add(built.root);
        // World-placed children sit at the arena origin, not under the entry.
        const world = built.world.children.length ? built.world : null;
        if (world) {
          world.name = `${spec.name} #${e.index} children`;
          world.visible = !this.hidden;
          root.add(world);
          this.worldByIndex.set(e.index, world);
        }
        animators.push(...built.animators);
        instances.push({ placed: p, spec, archive, root: built.root, world, animators: built.animators, parts: built.animatedParts, nodes: built.partNodes });
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
    this.instances = instances;
    this.stats = stats;
    return done;
  }

  // Builds one more model at run time (a Monest's Mothmant, combat/enemyfsm.ts):
  // the spec's archive is the floor's own, so it is in the cache already.
  async spawn(placed: PlacedEntity, spec: EnemyModelSpec): Promise<EnemyInstance | null> {
    const gen = this.generation;
    const archive = await this.cache.get(spec.bml, spec.models);
    if (gen !== this.generation || !this.root) return null;
    const built = buildEnemy(archive, spec.parts, 0, this.cache.loadedTextures, new Map());
    built.root.position.set(placed.world[0], placed.world[1], placed.world[2]);
    built.root.rotation.y = placed.yaw;
    built.root.name = `${spec.name} (spawned)`;
    built.root.userData.entity = placed;
    this.root.add(built.root);
    this.animators.push(...built.animators);
    const instance: EnemyInstance = { placed, spec, archive, root: built.root, world: null, animators: built.animators, parts: built.animatedParts };
    this.instances.push(instance);
    return instance;
  }

  // Removes one enemy's model (render/combat.ts: the death motion ended).
  remove(instance: EnemyInstance): void {
    const i = this.instances.indexOf(instance);
    if (i >= 0) this.instances.splice(i, 1);
    this.animators = this.animators.filter((a) => !instance.animators.includes(a));
    const materials = new Set<THREE.Material>();
    for (const r of [instance.root, instance.world]) {
      if (!r) continue;
      r.removeFromParent();
      r.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
        }
        if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
      });
    }
    for (const m of materials) m.dispose();
    this.byIndex.delete(instance.placed.entity.index);
    this.worldByIndex.delete(instance.placed.entity.index);
  }

  // Hides every enemy (models built later start hidden too) until setVisible().
  hideAll(): void {
    this.hidden = true;
    for (const r of this.byIndex.values()) r.visible = false;
    for (const r of this.worldByIndex.values()) r.visible = false;
  }

  // Shows or hides the enemy of e.dat entry `index` (wave spawns and deaths).
  setVisible(index: number, visible: boolean): void {
    const r = this.byIndex.get(index);
    if (r) r.visible = visible;
    const w = this.worldByIndex.get(index);
    if (w) w.visible = visible;
  }

  isVisible(index: number): boolean {
    return this.byIndex.get(index)?.visible ?? false;
  }

  // Model root of e.dat entry `index` (userData.entity is its PlacedEntity).
  model(index: number): THREE.Object3D | null {
    return this.byIndex.get(index) ?? null;
  }

  clear(): void {
    this.generation++;
    this.animators = [];
    this.instances = [];
    this.byIndex.clear();
    this.worldByIndex.clear();
    this.hidden = false;
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

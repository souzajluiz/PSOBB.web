// Enemy models of a floor: resolves each enemy set entry to its model
// (formats/enemymodels.ts), builds it at the spawn point and plays its idle
// motion every frame.

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
  animators: NodeAnimator[];
  parts: EnemyPartSpec[]; // part of each animator
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
        if (gen !== this.generation) return done;
        // Spread the start frames so a group does not move in lockstep.
        const built = buildEnemy(archive, spec.parts, ((e.index * 0.618034) % 1 + 1) % 1, this.cache.loadedTextures);
        built.root.position.set(p.world[0], p.world[1], p.world[2]);
        built.root.rotation.y = p.yaw;
        built.root.name = `${spec.name} #${e.index}`;
        built.root.userData.entity = p;
        root.add(built.root);
        animators.push(...built.animators);
        instances.push({ placed: p, spec, archive, root: built.root, animators: built.animators, parts: built.animatedParts });
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

  clear(): void {
    this.generation++;
    this.animators = [];
    this.instances = [];
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

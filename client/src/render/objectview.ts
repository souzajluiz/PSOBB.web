// Models of the set-data objects of a floor (formats/objectmodels.ts): loads
// each class's BML the way the client's loader does (render/enemymodel.ts
// reads the archives by entry position), builds the parts the constructor
// picks and keeps the parts that are only drawn in one state (locked /
// unlocked door, lit switch) switchable.
//
// Motions: parts with drive 'loop' or 'restart' advance like an enemy idle
// motion; parts with drive 'door' or 'laser' are driven by the door state
// machine (fieldobjects.ts) through ObjectModel.setDoorFrame / setLaserFrame;
// drive 'spring' (the Seabed capture trap) by its state machine through setSpringFrame.
// Four-light doors light their lamps one by one through setLamps.

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import { isInvisibleObject, objectModelFor, type ObjectModelContext, type ObjectModelSpec, type ObjectPartSpec, type PartShow } from '../formats/objectmodels.ts';
import type { PlacedEntity } from '../formats/setdata.ts';
import { buildEnemy, EnemyArchiveCache, type EnemyPartSpec, type NodeAnimator } from './enemymodel.ts';
import { extractStatic, freezeStatic, poolMeshInPlace, StaticBatcher, type BatchStats } from './batching.ts';
import type { MapViewer } from './mapviewer.ts';
import { disposeTree } from './dispose.ts';
import { TexturePool } from './texturepool.ts';
import type { CaptureDraw } from './traps.ts';
import type { DerolleChunk } from '../classic/particles.ts';

// The cloak of a Seabed capture trap (render/traps.ts captureTrapDraw, 'cloak').
// ASSUMED shader: the exe's cloak (unknown_set_advanced_effect_cloaked, dump)
// projects a screen-space effect texture through the texture matrices of stage
// 1 and draws each mesh once more; that texture is not in the web's data, so
// the cloak here is a translucent, cool-tinted copy of the mesh's own material
// with a screen-space shimmer standing in for the projection.
function cloakMaterial(src: THREE.Material): THREE.Material {
  const basic = src as THREE.MeshBasicMaterial;
  const m = new THREE.MeshBasicMaterial({
    map: basic.map ?? null,
    color: basic.color ? basic.color.clone() : new THREE.Color(0xffffff),
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: src.side,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       float shimmer = 0.75 + 0.25 * sin(gl_FragCoord.x * 0.35) * sin(gl_FragCoord.y * 0.35);
       gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.6, 0.78, 1.0), 0.35);
       gl_FragColor.a *= shimmer;`,
    );
  };
  m.customProgramCacheKey = () => 'capture-trap-cloak';
  return m;
}

// Texture ids are per model; remapping every id to one texture is how
// FUN_0081a588 sets the texture of all meshes of a model.
const ALL_IDS = 64;

export interface ObjectPart {
  show: PartShow;
  group: THREE.Object3D;
  animator: NodeAnimator | null;
  drive: ObjectPartSpec['drive'];
  nodes: THREE.Object3D[]; // node tree, depth first
  // Built on first use by the per-frame setters below (setLamps, setTrapPose,
  // setSealLamps), which would otherwise allocate every call.
  nodeSet?: Set<THREE.Object3D>;
  sealMaterials?: THREE.MeshBasicMaterial[]; // the part's own copies of its materials (the originals may be shared / pooled)
}

export interface ObjectModel {
  entity: PlacedEntity;
  spec: ObjectModelSpec;
  root: THREE.Group;
  parts: ObjectPart[];
  lampOf?: Map<number, number>; // node index -> lamp, for setLamps
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

const loops = (drive: ObjectPartSpec['drive']) => drive === 'loop' || drive === 'loop-last' || drive === 'restart' || drive === 'restart-last';

function toEnemyPart(p: ObjectPartSpec): EnemyPartSpec {
  return {
    model: p.model,
    ...(p.offset ? { offset: p.offset } : {}),
    texlistOf: p.texlistOf,
    textureArchive: p.textures,
    texRemap: texRemap(p),
    motion: p.motion !== undefined ? { index: p.motion, speed: p.speed ?? 1, loop: loops(p.drive), shape: p.shape, keys16: p.keys16 } : null,
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
  // Objects whose meshes went into merged batches (batchStatic): they cannot
  // change state any more, so the state setters below ignore them.
  private batched = new Set<number>();
  private ownBatched = new Set<number>(); // merged per object: setVisible still works
  private pool: TexturePool | null = null;
  private warned = new Set<string>();
  // The pillar trap nodes setTrapPose moves on the game ticks (drawn
  // between ticks by render/smoothrender.ts).
  readonly trapNodes = new Set<THREE.Object3D>();
  // Seabed capture traps (setCaptureDraw): the cloak copy of each source material and
  // the draw each object was last given (the setter only swaps when it changes).
  private cloaks = new Map<THREE.Material, THREE.Material>();
  private captureDraws = new Map<number, CaptureDraw>();
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
        if (gen !== this.generation) {
          disposeTree(root); // a newer show() / clear() took over: the models built so far are nobody's
          return done;
        }
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
          if (animator && part.drive === 'loop-last') animator.restart = 'carry-last';
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
    if (gen !== this.generation) {
      disposeTree(root);
      return done;
    }
    this.viewer.scene.add(root);
    this.root = root;
    this.animators = animators;
    this.stats = stats;
    return done;
  }

  // The model of `index` if it can still change: a batched object's meshes are
  // merged with its neighbours', so a setter that would change it is a bug of
  // the caller (it left the index out of `dynamic`); say so once.
  private live(index: number, what: string): ObjectModel | undefined {
    if (!this.batched.has(index)) return this.models.get(index);
    if (!this.warned.has(what)) {
      this.warned.add(what);
      console.warn(`ObjectLayer.${what}(${index}): the object was batched as static; pass its index to batchStatic`);
    }
    return undefined;
  }

  // Merges the objects that never change after placement into a few meshes
  // (render/batching.ts) and freezes their transforms.
  //  - `dynamic`: indices the caller still drives (doors, switches, warps,
  //    triggers, traps...): left as they are.
  //  - `hideable`: indices that only ever change through setVisible (boxes,
  //    delayed objects): their meshes are merged per object and stay children of
  //    the object's root, so hiding the root still hides them.
  //  - everything else is merged across objects (spatial cells).
  // An object is also left as it is when a part plays a motion or is only drawn
  // in some states. Chunk models (skinned meshes) stay in their meshes.
  // Returns the batching stats.
  batchStatic(dynamic: ReadonlySet<number>, hideable: ReadonlySet<number> = new Set()): BatchStats | null {
    const root = this.root;
    if (!root) return null;
    const shared: THREE.Object3D[] = [];
    const sharedIndices: number[] = [];
    const own: number[] = [];
    const liveRoots = new Set<THREE.Object3D>();
    for (const [index, m] of this.models) {
      const still = !dynamic.has(index) && !m.spec.lamps && m.parts.every((p) => !p.animator && p.show === 'always');
      if (!still) liveRoots.add(m.root);
      else if (hideable.has(index)) own.push(index);
      else {
        sharedIndices.push(index);
        for (const p of m.parts) shared.push(p.group);
      }
    }
    root.updateMatrixWorld(true);
    this.pool?.dispose();
    const pool = (this.pool = new TexturePool());
    const stats: BatchStats = { meshesIn: 0, groupsIn: 0, groupsKept: 0, batches: 0, vertices: 0, triangles: 0, pooled: 0 };
    const add = (from: BatchStats) => (Object.keys(stats) as Array<keyof BatchStats>).forEach((k) => (stats[k] += from[k]));
    const batcher = new StaticBatcher({ pool });
    extractStatic(shared, batcher);
    for (const mesh of batcher.build()) root.add(mesh);
    add(batcher.stats);
    for (const i of sharedIndices) {
      this.batched.add(i);
      const r = this.models.get(i)!.root;
      if (!r.children.some((c) => c.children.length || (c as THREE.Mesh).isMesh)) r.removeFromParent(); // nothing left to draw
    }
    for (const i of own) {
      const m = this.models.get(i)!;
      const local = new StaticBatcher({ pool, cellSize: 0, space: m.root.matrixWorld.clone().invert() });
      extractStatic(
        m.parts.map((p) => p.group),
        local,
      );
      for (const mesh of local.build()) {
        // build() switches the merged mesh's matrix updates off, so its world matrix
        // would stay at identity and the box would draw at the world origin. The
        // geometry is in the object's frame (space = the inverse of m.root's world
        // matrix), so the mesh is an identity child of m.root: freezeStatic below
        // computes and freezes its world matrix with the root's.
        mesh.matrixAutoUpdate = true;
        mesh.matrixWorldAutoUpdate = true;
        m.root.add(mesh);
      }
      add(local.stats);
      this.ownBatched.add(i);
    }
    // The models that stay live keep their meshes (they follow animated nodes),
    // but a mesh with several same-size textures still becomes one draw per state.
    for (const m of this.models.values()) {
      if (!liveRoots.has(m.root)) continue;
      const meshes: THREE.Mesh[] = [];
      m.root.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
      });
      for (const mesh of meshes) if (poolMeshInPlace(mesh, pool)) stats.pooled++;
    }
    pool.finish();
    freezeStatic(root, (o) => liveRoots.has(o));
    return stats;
  }

  // Shows the parts of one object for a state: doors pass 'locked' or
  // 'unlocked', switches 'on' or 'off', boss warps 'idle', 'active' or 'off'.
  setState(index: number, state: PartShow): void {
    const m = this.live(index, 'setState');
    if (!m) return;
    for (const part of m.parts) part.group.visible = part.show === 'always' || part.show === state;
  }

  // Four-light door: `lit` gives each lamp while the door is closed, null
  // draws the whole door with the lit list (opening, open, closing). Parts 0
  // and 1 are the door with its own list and with the lit one.
  setLamps(index: number, lit: readonly boolean[] | null): void {
    const m = this.live(index, 'setLamps');
    const lamps = m?.spec.lamps;
    if (!m || !lamps || m.parts.length < 2) return;
    const [own, green] = m.parts;
    own.group.visible = lit !== null;
    green.group.visible = true;
    const ownSet = (own.nodeSet ??= new Set(own.nodes));
    const greenSet = (green.nodeSet ??= new Set(green.nodes));
    if (!m.lampOf) {
      m.lampOf = new Map<number, number>();
      lamps.forEach((nodes, i) => nodes.forEach((n) => m.lampOf!.set(n, i)));
    }
    const lampOf = m.lampOf;
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

  // Pillar traps (render/traps.ts; RenderSeabedPillarMapObject_0063c2bc):
  // the root node lifted by `rise1`, its child (+0x2c) by `rise2` more, the
  // child's child drawn as it is and that one's sibling (+0x30) turned by
  // `spin` (BAMS) about Y.
  setTrapPose(index: number, rise1: number, rise2: number, spin: number): void {
    const m = this.live(index, 'setTrapPose');
    const nodes = m?.parts[0]?.nodes;
    if (!nodes?.length) return;
    const set = (m!.parts[0].nodeSet ??= new Set(nodes));
    const kidsOf = (n: THREE.Object3D) => n.children.filter((c) => set.has(c));
    const root = nodes[0];
    const child = kidsOf(root)[0];
    const base = (n: THREE.Object3D) => (n.userData.trapBaseY ??= n.position.y) as number;
    root.position.y = base(root) + rise1;
    this.trapNodes.add(root);
    if (!child) return;
    child.position.y = base(child) + rise2;
    this.trapNodes.add(child);
    const spinner = kidsOf(child)[1];
    if (spinner) {
      this.trapNodes.add(spinner);
      spinner.userData.trapBaseRot ??= spinner.rotation.y;
      spinner.rotation.y = (spinner.userData.trapBaseRot as number) + (spin / 0x10000) * Math.PI * 2;
    }
  }

  // TODoorVoShip (render/traps.ts SealDoor): part 1 is the lamp model; the
  // root's children in order are the lamps; `alpha` (-1..0) darkens them
  // (ASSUMED: the render's color {alpha, 0, 0, 0} with flag 0x20 read as a
  // brightness of 1 + alpha).
  setSealLamps(index: number, lit: readonly boolean[], alpha: number): void {
    const part = this.live(index, 'setSealLamps')?.parts[1];
    const nodes = part?.nodes;
    if (!part || !nodes?.length) return;
    const set = (part.nodeSet ??= new Set(nodes));
    const kids = nodes[0].children.filter((c) => set.has(c));
    kids.forEach((k, i) => (k.visible = lit[i] ?? false));
    const v = Math.max(0, Math.min(1, 1 + alpha));
    // The colour is this object's own: the materials may be shared (pooled), so
    // the part takes copies the first time.
    if (!part.sealMaterials) {
      const list: THREE.MeshBasicMaterial[] = [];
      part.group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const own = (m: THREE.Material) => {
          const c = m.clone() as THREE.MeshBasicMaterial;
          c.onBeforeCompile = m.onBeforeCompile;
          c.customProgramCacheKey = m.customProgramCacheKey;
          list.push(c);
          return c;
        };
        o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
      });
      part.sealMaterials = list;
    }
    for (const m of part.sealMaterials) m.color?.setRGB(v, v, v);
  }

  // Seabed capture trap (TOTrapSeabed01, render/traps.ts captureTrapDraw): 'hidden'
  // hides the model, 'plain' draws it, 'cloak' swaps each mesh's material for its
  // cloak copy. The original materials stay on the mesh as userData.plainMaterial.
  setCaptureDraw(index: number, draw: CaptureDraw): void {
    const m = this.live(index, 'setCaptureDraw');
    if (!m || this.captureDraws.get(index) === draw) return;
    this.captureDraws.set(index, draw);
    m.root.visible = draw !== 'hidden';
    const cloak = draw === 'cloak';
    const swap = (src: THREE.Material): THREE.Material => {
      if (!cloak) return src;
      let c = this.cloaks.get(src);
      if (!c) this.cloaks.set(src, (c = cloakMaterial(src)));
      return c;
    };
    for (const part of m.parts) {
      part.group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const plain = (o.userData.plainMaterial ??= o.material) as THREE.Material | THREE.Material[];
        o.material = Array.isArray(plain) ? plain.map(swap) : swap(plain);
      });
    }
  }

  setVisible(index: number, visible: boolean): void {
    const m = this.ownBatched.has(index) ? this.models.get(index) : this.live(index, 'setVisible');
    if (m) m.root.visible = visible;
  }

  // Frame of the parts driven by the door state machine.
  setDoorFrame(index: number, frame: number): void {
    const m = this.live(index, 'setDoorFrame');
    if (!m) return;
    for (const part of m.parts) if (part.drive === 'door' && part.animator) part.animator.setFrame(frame);
  }

  // Frame of the spring motion of a Seabed capture trap (drive 'spring', render/traps.ts CaptureTrap.anim).
  setSpringFrame(index: number, frame: number): void {
    const m = this.live(index, 'setSpringFrame');
    if (!m) return;
    for (const part of m.parts) if (part.drive === 'spring' && part.animator) part.animator.setFrame(frame);
  }

  // Frame count of that motion (0 when the object has none, or is not built yet).
  springFrames(index: number): number {
    const m = this.models.get(index);
    if (!m) return 0;
    for (const part of m.parts) if (part.drive === 'spring' && part.animator) return part.animator.frameCount;
    return 0;
  }

  setLaserFrame(index: number, frame: number): void {
    const m = this.live(index, 'setLaserFrame');
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

  // Debris chunks (the DerollePartObject emitters of render/fieldobjects.ts): each chunk is a clone of one model
  // of its object's archive (model index, texture list) placed at the particle. A template is built once per
  // (bml, model, texture); a chunk whose template is still loading is not drawn yet.
  private chunkTemplates = new Map<string, THREE.Group>();
  private chunkPending = new Set<string>();
  private chunkPool: THREE.Group[] = [];
  private chunkGroup: THREE.Group | null = null;

  drawChunks(list: ReadonlyArray<{ bml: string; chunk: DerolleChunk }>): void {
    if (!this.root) return;
    if (!this.chunkGroup) {
      this.chunkGroup = new THREE.Group();
      this.chunkGroup.name = 'debris';
      this.root.add(this.chunkGroup);
    }
    let used = 0;
    for (const { bml, chunk } of list) {
      const key = `${bml}|${chunk.model}|${chunk.texture}`;
      const tpl = this.chunkTemplates.get(key);
      if (!tpl) {
        void this.loadChunk(bml, chunk.model, chunk.texture, key);
        continue;
      }
      let g = this.chunkPool[used];
      if (!g || g.userData.key !== key) {
        const fresh = tpl.clone(true);
        fresh.userData.key = key;
        if (g) this.chunkGroup.remove(g);
        this.chunkGroup.add(fresh);
        this.chunkPool[used] = fresh;
        g = fresh;
      }
      g.visible = true;
      g.position.set(chunk.pos[0], chunk.pos[1], chunk.pos[2]);
      g.rotation.set(chunk.ang[0], chunk.ang[1], chunk.ang[2]);
      used++;
    }
    for (let i = used; i < this.chunkPool.length; i++) this.chunkPool[i].visible = false;
  }

  private async loadChunk(bml: string, model: number, texture: number, key: string): Promise<void> {
    if (this.chunkPending.has(key)) return;
    this.chunkPending.add(key);
    const gen = this.generation;
    try {
      const archive = await this.cache.getAuto(bml);
      if (gen !== this.generation) return; // a clear() came first: this template belongs to nobody
      const built = buildEnemy(archive, [toEnemyPart({ model, texlistOf: texture } as ObjectPartSpec)], 0, this.cache.loadedTextures);
      this.chunkTemplates.set(key, built.root);
    } catch (err) {
      if (!this.warned.has(key)) {
        this.warned.add(key);
        this.stats.errors.push(`debris ${bml} model ${model}: ${(err as Error).message}`);
      }
    } finally {
      this.chunkPending.delete(key);
    }
  }

  clear(): void {
    this.generation++;
    this.animators = [];
    this.models.clear();
    this.batched.clear();
    this.ownBatched.clear();
    this.warned.clear();
    this.pool?.dispose();
    this.pool = null;
    // The cloak copies are this layer's own: back to the plain materials (which
    // disposeTree releases with the meshes), then the copies go.
    if (this.root) {
      this.root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.userData.plainMaterial) o.material = o.userData.plainMaterial;
      });
    }
    for (const c of this.cloaks.values()) c.dispose();
    this.cloaks.clear();
    this.captureDraws.clear();
    for (const g of this.chunkTemplates.values()) disposeTree(g);
    this.chunkTemplates.clear();
    this.chunkPending.clear();
    this.chunkPool = [];
    this.chunkGroup = null;
    if (!this.root) return;
    this.viewer.scene.remove(this.root);
    disposeTree(this.root);
    this.root = null;
  }

  dispose(): void {
    this.clear();
    this.viewer.frameHooks.delete(this.hook);
    void this.cache.dispose();
  }
}

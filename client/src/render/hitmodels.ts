// Model-based damage effects (rules in combat/hitmodels.ts): the critical
// flash (effect_nt.rel's cross of two quads with the technic_pt.xvm ring
// frames), the model dissolve of a dying enemy (a per-material alpha) and the
// frozen enemy's ice block (bm_eff_ice.bml). One shared geometry per model and
// one material per live effect; nothing is allocated per frame.

import * as THREE from 'three';
import { textureBitmaps } from '../classic/stage.ts';
import {
  criticalFlashFrames,
  FLASH_DIFFUSE,
  ICE_RING_FRAMES,
  ICE_RING_PARTICLE,
  ICE_SHARD_MODEL,
  IceBlock,
  TECH_PARTICLE_BML,
  TECH_PARTICLE_TEXTURES,
  type FlashFrame,
  type IceStep,
} from '../combat/hitmodels.ts';
import type { ParticleSpawn } from '../combat/hitfx.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import { parseNjcmObject, type NjcmModel } from '../formats/njcm.ts';
import { RelFile } from '../formats/rel.ts';
import { BAMS_TO_RAD, type NjObject } from '../formats/xj.ts';
import { EnemyArchive, NodeAnimator, texturesFromXvm } from './enemymodel.ts';
import type { MapViewer } from './mapviewer.ts';
import { buildObjectTreeWithNodes, MaterialCache } from './njmesh.ts';

const FRAME = 1 / 30;

/**
 * A per-material alpha for a model tree (the exe adds the colour ramp's alpha
 * offset to the draw colour). Materials of an enemy model belong to that
 * instance (render/enemymodel.ts builds a material cache per part), so they are
 * changed in place; the first call remembers the originals.
 */
export function setModelOpacity(root: THREE.Object3D, opacity: number): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const base = (m.userData.fadeBase ??= { opacity: m.opacity, transparent: m.transparent }) as { opacity: number; transparent: boolean };
      m.opacity = base.opacity * opacity;
      m.transparent = base.transparent || opacity < 1;
    }
  });
}

/** The cross of quads of a model with one vertex chunk and plain strips (effect_nt.rel's). */
export function njcmQuadGeometry(model: NjcmModel): THREE.BufferGeometry {
  const chunk = model.vertices[0];
  const pos: number[] = [];
  const uv: number[] = [];
  for (const op of model.polys) {
    if (op.op !== 'strips') continue;
    for (const s of op.strips) {
      if (!s.uvs) continue;
      const v = (k: number): void => {
        const i = chunk.indices.indexOf(s.indices[k]);
        pos.push(chunk.positions[i * 3], chunk.positions[i * 3 + 1], chunk.positions[i * 3 + 2]);
        uv.push(Math.min(1, s.uvs![k * 2]), Math.min(1, s.uvs![k * 2 + 1]));
      };
      // A strip's triangles: (0, 1, 2), (2, 1, 3), ...
      for (let k = 0; k + 2 < s.indices.length; k++) {
        if (k % 2 === 0) [k, k + 1, k + 2].forEach(v);
        else [k + 1, k, k + 2].forEach(v);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

interface Flash {
  group: THREE.Mesh;
  frames: FlashFrame[];
  at: number;
}

/** What an ice block follows: the frozen enemy's hit box centre and its freeze. */
export interface IceHost {
  /** The hit box centre; null once the entity is gone. */
  center(): THREE.Vector3 | null;
  /** The entity's own position (the shatter's pieces start there: the item entity's +0x368); the centre when absent. */
  origin?(): THREE.Vector3 | null;
  /** The entity's flag 0x20 (frozen). */
  frozen(): boolean;
  /** The target scale (the hit box radius * 0.15). */
  radius: number;
}

interface IceFx {
  host: IceHost;
  block: IceBlock;
  group: THREE.Group;
  model: THREE.Object3D;
  cache: MaterialCache;
  archive: EnemyArchive;
  over: boolean; // the block is finished (the breaking pieces may play on)
  pieces: { root: THREE.Object3D; animator: NodeAnimator; cache: MaterialCache; frames: number } | null;
}

const PIECES_FRAMES = 20; // the particle 0x33's life

const flagsOf = (o: NjObject, out: number[] = []): number[] => {
  out.push(o.flags);
  for (const c of o.children) flagsOf(c, out);
  return out;
};

/**
 * A model particle's template (classic/particles.ts EffectFx.model): one BML model as a
 * tree, never drawn itself. `motion` is the njm the particle plays (null: a static model).
 * `order` numbers the template's objects depth-first, so a copy's nodes are found by index.
 */
export interface ParticleModel {
  root: THREE.Object3D;
  nodes: THREE.Object3D[];
  flags: number[];
  motion: ReturnType<EnemyArchive['motion']> | null;
  order: Map<THREE.Object3D, number>;
}

/** One particle's own copy of a model: shared geometry, its own materials and pose (NodeAnimator). */
export interface ParticleModelPiece {
  root: THREE.Object3D;
  animator: NodeAnimator | null;
  materials: THREE.Material[];
}

/** A copy of a template for one particle: the clone shares geometry; its materials and nodes are its own. */
export function instanceParticleModel(t: ParticleModel): ParticleModelPiece {
  const root = t.root.clone(true);
  const materials: THREE.Material[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map((m) => m.clone());
      materials.push(...o.material);
    } else {
      o.material = o.material.clone();
      materials.push(o.material);
    }
  });
  let animator: NodeAnimator | null = null;
  if (t.motion) {
    const all: THREE.Object3D[] = [];
    root.traverse((o) => all.push(o));
    const nodes = t.nodes.map((n) => all[t.order.get(n)!]);
    animator = new NodeAnimator(nodes, t.flags, t.motion, 1, false);
  }
  return { root, animator, materials };
}

export class HitModels {
  private viewer: MapViewer;
  private files: ClientFiles;
  private log: (msg: string) => void;
  private geometry: THREE.BufferGeometry | null = null;
  private rings: THREE.Texture[] = []; // technic_pt.xvm entries 1..7 -> [0..6]
  private loaded: Promise<void> | null = null;
  private flashes: Flash[] = [];
  private ices: IceFx[] = [];
  private iceArchive: Promise<EnemyArchive | null> | null = null;
  private frames = criticalFlashFrames();
  private acc = 0;
  private disposed = false;
  private hook = (dt: number) => this.frame(dt);

  constructor(viewer: MapViewer, files: ClientFiles, log: (msg: string) => void) {
    this.viewer = viewer;
    this.files = files;
    this.log = log;
    viewer.frameHooks.add(this.hook);
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        // load_effect_nt_data: the root pointer of effect_nt.rel is the model.
        const data = await this.files.read('effect_nt.rel');
        const rel = new RelFile(data);
        const obj = parseNjcmObject(data, rel.u32(rel.root));
        if (obj.model) this.geometry = njcmQuadGeometry(obj.model);
        const tex = await this.files.textures('technic_pt.xvm');
        const bitmaps = await textureBitmaps(tex);
        this.rings = [];
        for (let i = 1; i <= 7; i++) {
          const t = new THREE.Texture(bitmaps[i]);
          t.flipY = false;
          t.colorSpace = THREE.SRGBColorSpace;
          t.needsUpdate = true;
          this.rings.push(t);
        }
      } catch (err) {
        this.log(`hit effects: models unavailable (${(err as Error).message})`);
      }
    })();
    return this.loaded;
  }

  preload(): void {
    void this.load();
  }

  // bm_eff_ice.bml: model 0 the breaking block (ice_break_root.xj, 10 nodes,
  // motion 0), model 1 the block (ice_root.xj); InitializeIceBml_005012d4.
  private archive(): Promise<EnemyArchive | null> {
    this.iceArchive ??= (async () => {
      try {
        return new EnemyArchive('bm_eff_ice.bml', await this.files.read('bm_eff_ice.bml'), 2);
      } catch (err) {
        this.log(`hit effects: ice model unavailable (${(err as Error).message})`);
        return null;
      }
    })();
    return this.iceArchive;
  }

  // An archive model as a three.js tree with its own materials (additive,
  // double sided: the strips are source alpha / one with a half alpha diffuse).
  private build(archive: EnemyArchive, index: number): { root: THREE.Object3D; nodes: THREE.Object3D[]; cache: MaterialCache; flags: number[] } | null {
    const m = archive.model(index);
    if (m.kind !== 'xj') return null;
    const cache = new MaterialCache((id) => (m.textures[id] !== undefined ? archive.texture(m.textures[id]) : null));
    const built = buildObjectTreeWithNodes(m.object, cache);
    return { root: built.root, nodes: built.nodes, cache, flags: flagsOf(m.object) };
  }

  /**
   * The ice block of a freeze (combat/hitmodels.ts IceBlock): grows around the
   * frozen entity, turns, and when the freeze ends shatters (the breaking
   * block's motion). `ring` makes the particle 0x12d at a point.
   */
  async ice(host: IceHost, ring: (p: ParticleSpawn, at: THREE.Vector3) => void, shards?: (at: THREE.Vector3) => void): Promise<void> {
    const archive = await this.archive();
    if (this.disposed || !archive || this.ices.length >= 8) return;
    const b = this.build(archive, 1);
    if (!b) return;
    const group = new THREE.Group();
    group.add(b.root);
    group.scale.setScalar(0.001);
    this.viewer.scene.add(group);
    this.ices.push({ host, block: new IceBlock(host.radius), group, model: b.root, cache: b.cache, archive, over: false, pieces: null });
    this.ringHook = ring;
    this.shardHook = shards ?? null;
  }

  private ringHook: ((p: ParticleSpawn, at: THREE.Vector3) => void) | null = null;
  private shardHook: ((at: THREE.Vector3) => void) | null = null;
  private shardLoad: Promise<THREE.Mesh | null> | null = null;
  private shardCleanup: (() => void) | null = null;

  /**
   * The ice piece (model 5 of bm_technic.bml, eff_f_ice_piece.xj: three strips
   * of texture id 2, additive) with technic.xvm as its texture list, as one
   * template mesh the particle system clones per piece (render/hitfx.ts).
   * The model has no texture list of its own: the exe draws it with the
   * current xvm (g_CurrentXvmTexture), the emitter's y field.
   */
  shardTemplate(): Promise<THREE.Mesh | null> {
    this.shardLoad ??= (async () => {
      try {
        const archive = new EnemyArchive(ICE_SHARD_MODEL.bml, await this.files.read(ICE_SHARD_MODEL.bml), 12);
        const list = texturesFromXvm(await this.files.read(ICE_SHARD_MODEL.textures));
        const m = archive.model(ICE_SHARD_MODEL.model);
        if (m.kind !== 'xj') return null;
        const cache = new MaterialCache((id) => list[id] ?? null);
        this.shardCleanup = () => {
          cache.dispose();
          for (const t of list) t.dispose();
          archive.dispose();
        };
        const built = buildObjectTreeWithNodes(m.object, cache);
        let mesh: THREE.Mesh | null = null;
        built.root.traverse((o) => {
          if (!mesh && o instanceof THREE.Mesh) mesh = o;
        });
        return mesh;
      } catch (err) {
        this.log(`hit effects: ice shards unavailable (${(err as Error).message})`);
        return null;
      }
    })();
    return this.shardLoad;
  }

  // bm_technic.bml (with technic.xvm) read once: the model entries of the technique table's flag 0x20.
  private techBml: Promise<{ archive: EnemyArchive; list: THREE.Texture[] } | null> | null = null;
  private particleModels = new Map<string, Promise<ParticleModel | null>>();
  private particleCleanup: (() => void)[] = [];

  /**
   * The technique BML's model `chunk` (njcm) with its motion (njm, or none), for a model particle
   * (combat/techfire.ts FxEmitter.model; the particle's own copies are instanceParticleModel).
   */
  particleModel(chunk: number, motion: number | null): Promise<ParticleModel | null> {
    const key = `${chunk}:${motion}`;
    let p = this.particleModels.get(key);
    if (!p) {
      p = (async () => {
        this.techBml ??= (async () => {
          try {
            const archive = new EnemyArchive(TECH_PARTICLE_BML, await this.files.read(TECH_PARTICLE_BML), 12);
            const list = texturesFromXvm(await this.files.read(TECH_PARTICLE_TEXTURES));
            this.particleCleanup.push(() => {
              for (const t of list) t.dispose();
              archive.dispose();
            });
            return { archive, list };
          } catch (err) {
            this.log(`hit effects: technique models unavailable (${(err as Error).message})`);
            return null;
          }
        })();
        const tech = await this.techBml;
        if (!tech || this.disposed) return null;
        try {
          const m = tech.archive.model(chunk);
          if (m.kind !== 'xj') return null;
          const cache = new MaterialCache((id) => tech.list[id] ?? null);
          this.particleCleanup.push(() => cache.dispose());
          const built = buildObjectTreeWithNodes(m.object, cache);
          const order = new Map<THREE.Object3D, number>();
          let k = 0;
          built.root.traverse((o) => {
            order.set(o, k++);
          });
          return {
            root: built.root,
            nodes: built.nodes,
            flags: flagsOf(m.object),
            motion: motion === null ? null : tech.archive.motion(motion, built.nodes.length),
            order,
          };
        } catch (err) {
          this.log(`hit effects: technique model ${chunk} unavailable (${(err as Error).message})`);
          return null;
        }
      })();
      this.particleModels.set(key, p);
    }
    return p;
  }

  // One game frame of an ice block.
  private stepIce(f: IceFx): void {
    if (f.over) return;
    const center = f.host.center();
    const st: IceStep | null = center ? f.block.tick(f.host.frozen()) : null; // no entity (FindEntityById fails): it removes itself
    if (!center || !st || st.done) {
      f.over = true;
      f.group.visible = false;
      return;
    }
    f.group.position.copy(center);
    f.group.rotation.y = st.yaw * BAMS_TO_RAD;
    f.group.scale.setScalar(Math.max(st.scale, 0.001));
    if (st.state >= 2) setModelOpacity(f.model, Math.max(0, 1 + st.fade));
    if (st.ring) {
      const a = st.ring.angle * BAMS_TO_RAD;
      this.ringHook?.({ id: ICE_RING_PARTICLE, delay: 0, duration: ICE_RING_FRAMES }, new THREE.Vector3(center.x + Math.sin(a) * st.ring.radius, center.y, center.z + Math.cos(a) * st.ring.radius));
    }
    if (st.shatter) {
      this.shatter(f, f.archive, center, st.scale);
      this.shardHook?.(f.host.origin?.() ?? center);
    }
  }

  // The particle 0x33 (ice_breaker): model 0 with its motion 0 at the centre
  // for the particle's 20 frames. ASSUMED: drawn at the block's last scale.
  private shatter(f: IceFx, archive: EnemyArchive, center: THREE.Vector3, scale: number): void {
    const b = this.build(archive, 0);
    if (!b) return;
    try {
      const animator = new NodeAnimator(b.nodes, b.flags, archive.motion(0, b.nodes.length), 1, false);
      b.root.position.copy(center);
      b.root.scale.setScalar(scale);
      this.viewer.scene.add(b.root);
      f.pieces = { root: b.root, animator, cache: b.cache, frames: 0 };
    } catch (err) {
      this.log(`hit effects: ice break motion: ${(err as Error).message}`);
    }
  }

  /** The critical hit's flash at `at`. */
  async flash(at: THREE.Vector3): Promise<void> {
    await this.load();
    if (this.disposed || !this.geometry || this.rings.length < 7 || this.flashes.length >= 12) return;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(FLASH_DIFFUSE, FLASH_DIFFUSE, FLASH_DIFFUSE), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.geometry, mat);
    mesh.position.copy(at);
    mesh.frustumCulled = false;
    this.viewer.scene.add(mesh);
    const f: Flash = { group: mesh, frames: this.frames, at: 0 };
    this.flashes.push(f);
    this.showFlash(f);
  }

  // matrix_rotation_y(camera yaw), then the entity scale and colour; entry
  // (frame + 1) of technic_pt.xvm. ASSUMED: the camera yaw turns the model's
  // axis (the line the two quads share) to the screen's horizontal.
  private showFlash(f: Flash): void {
    const fr = f.frames[f.at];
    const m = f.group.material as THREE.MeshBasicMaterial;
    m.opacity = fr.alpha;
    const tex = this.rings[fr.texture - 1];
    if (m.map !== tex) {
      if (m.map === null) m.needsUpdate = true; // the shader gains its map define once
      m.map = tex;
    }
    f.group.scale.setScalar(fr.scale);
    const dir = this.viewer.camera.getWorldDirection(new THREE.Vector3());
    f.group.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
  }

  private frame(dt: number): void {
    if (this.disposed || (this.flashes.length === 0 && this.ices.length === 0)) return;
    for (const i of this.ices) i.pieces?.animator.update(dt);
    this.acc += dt;
    let ticks = 0;
    while (this.acc >= FRAME && ticks < 5) {
      this.acc -= FRAME;
      ticks++;
      this.flashes = this.flashes.filter((f) => {
        f.at++;
        if (f.at < f.frames.length) return true;
        this.viewer.scene.remove(f.group);
        (f.group.material as THREE.Material).dispose();
        return false;
      });
      this.ices = this.ices.filter((i) => {
        this.stepIce(i);
        if (i.pieces && ++i.pieces.frames >= PIECES_FRAMES) this.dropPieces(i);
        if (i.over && !i.pieces) {
          this.dropIce(i);
          return false;
        }
        return true;
      });
    }
    if (this.acc >= FRAME) this.acc = 0;
    for (const f of this.flashes) this.showFlash(f);
  }

  private dropPieces(i: IceFx): void {
    if (!i.pieces) return;
    this.viewer.scene.remove(i.pieces.root);
    i.pieces.cache.dispose();
    i.pieces = null;
  }

  private dropIce(i: IceFx): void {
    this.viewer.scene.remove(i.group);
    i.cache.dispose();
    this.dropPieces(i);
  }

  dispose(): void {
    this.disposed = true;
    this.viewer.frameHooks.delete(this.hook);
    for (const f of this.flashes) {
      this.viewer.scene.remove(f.group);
      (f.group.material as THREE.Material).dispose();
    }
    this.flashes = [];
    for (const i of this.ices) this.dropIce(i);
    this.ices = [];
    this.shardCleanup?.();
    this.shardCleanup = null;
    for (const c of this.particleCleanup) c();
    this.particleCleanup = [];
    this.particleModels.clear();
    this.geometry?.dispose();
    for (const t of this.rings) t.dispose();
    this.rings = [];
  }
}

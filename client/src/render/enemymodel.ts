// Enemy models: loads the bm_ene_*.bml (and boss) archives the way the
// client's TBinModel loader does and builds animated three.js models.
//
// FUN_005b7a84 (TBinModel::load, flag 1) reads the BML entries BY POSITION:
// the first `models` entries (the asset descriptor's model count) become the
// model array (+0x42c, 0x10 bytes each: +8 NJCM object, +0xC texture list,
// textures from the XVM attached to the entry), the next `motions` entries the
// motion array (+0x430, 8 bytes each, +4 NJS_MOTION). The enemy constructors
// pick model i and start a motion table slot (FUN_007aa4c8), see
// formats/enemymodels.ts. The entry names are not looked up.
//
// Entries without an attached XVM (e.g. bm3_s_nest.nj) draw with textures of
// the same name already loaded (Ninja resolves texture list names against the
// textures in memory), so textures are shared by name across the archive.
//
// Motions: NMDM chunks. Angle keys are 16-bit (NJS_MKEY_SA, as in the player
// motions); Episode 4 motions use quaternion keys (type 0x2000, w x y z).

import * as THREE from 'three';
import type { ClientFiles } from '../data/clientfiles.ts';
import { BmlArchive } from '../formats/bml.ts';
import { parseNinjaChunkFile, parseNjtl, type NjcmObject } from '../formats/njcm.ts';
import { parseNjmFile, sampleKeys, type NjMotion, type NjQuatKey } from '../formats/njmotion.ts';
import { RelFile } from '../formats/rel.ts';
import { EVAL_ZXY_ANG, parseNjObject, type NjObject } from '../formats/xj.ts';
import { parseXvm } from '../formats/xvm.ts';
import { NjcmModelBuilder } from './njcmmesh.ts';
import { buildObjectTreeWithNodes, MaterialCache } from './njmesh.ts';
import { GAME_TICKS_PER_SECOND } from './playeranim.ts';

type EnemyModelData =
  | { kind: 'nj'; name: string; object: NjcmObject; textures: string[] }
  | { kind: 'xj'; name: string; object: NjObject; textures: string[] };

function countNodes(o: { children: { children: unknown[] }[] }): number {
  let n = 1;
  for (const c of o.children) n += countNodes(c as { children: { children: unknown[] }[] });
  return n;
}

function makeTexture(rgba: Uint8Array, width: number, height: number): THREE.DataTexture {
  const t = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Textures of a separate XVM archive, in archive order.
export function texturesFromXvm(data: Uint8Array): THREE.Texture[] {
  return parseXvm(data).map((x) => makeTexture(x.rgba, x.width, x.height));
}

// One loaded BML (one asset descriptor).
export class EnemyArchive {
  readonly name: string;
  readonly bml: BmlArchive;
  readonly modelCount: number;
  private textures = new Map<string, THREE.Texture>();
  private models = new Map<number, EnemyModelData>();
  private motions = new Map<string, NjMotion>();

  constructor(name: string, data: Uint8Array, modelCount: number) {
    this.name = name;
    this.bml = new BmlArchive(data);
    this.modelCount = modelCount;
    if (modelCount > this.bml.entries.length) throw new Error(`${name}: ${modelCount} models but ${this.bml.entries.length} entries`);
    // Textures of every model entry, by texture list name.
    for (let i = 0; i < modelCount; i++) {
      const e = this.bml.entries[i];
      if (!e.textureSize) continue;
      const names = this.model(i).textures;
      parseXvm(this.bml.getTextures(e.name)!).forEach((x, k) => {
        const name = names[k] ?? `${e.name}#${k}`;
        if (!this.textures.has(name)) this.textures.set(name, makeTexture(x.rgba, x.width, x.height));
      });
    }
  }

  get motionCount(): number {
    return this.bml.entries.length - this.modelCount;
  }

  // Model entry i (BML position).
  model(i: number): EnemyModelData {
    let m = this.models.get(i);
    if (m) return m;
    const e = this.bml.entries[i];
    if (!e || i >= this.modelCount) throw new Error(`${this.name}: no model ${i}`);
    const data = this.bml.get(e.name);
    // The BML keeps at most 0x20 characters of the name, so some entries lose
    // their extension (bm_obj_ep4_container_01_hakai_s.); those are chunk
    // models, which parse as NJ.
    const chunk = /\.nj$/i.test(e.name) || !/\.[a-z0-9]+$/i.test(e.name);
    if (chunk) {
      const f = parseNinjaChunkFile(data);
      m = { kind: 'nj', name: e.name, object: f.object!, textures: f.textureNames };
    } else {
      const body = RelFile.chunk(data, 'NJCM');
      if (!body) throw new Error(`${this.name}: ${e.name} has no NJCM chunk`);
      const tl = RelFile.chunk(data, 'NJTL');
      m = { kind: 'xj', name: e.name, object: parseNjObject(body, 0), textures: tl ? parseNjtl(tl.data) : [] };
    }
    this.models.set(i, m);
    return m;
  }

  nodeCount(i: number): number {
    return countNodes(this.model(i).object as unknown as { children: { children: unknown[] }[] });
  }

  // Motion j (relative to the first motion entry) for a tree of `nodes` nodes.
  motion(j: number, nodes: number): NjMotion {
    const key = `${j}:${nodes}`;
    let m = this.motions.get(key);
    if (!m) {
      const e = this.bml.entries[this.modelCount + j];
      if (!e) throw new Error(`${this.name}: no motion ${j}`);
      m = parseNjmFile(this.bml.get(e.name), nodes, { shortAngles: true });
      this.motions.set(key, m);
    }
    return m;
  }

  motionName(j: number): string | null {
    return this.bml.entries[this.modelCount + j]?.name ?? null;
  }

  texture(name: string): THREE.Texture | null {
    return this.textures.get(name) ?? null;
  }

  dispose(): void {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
  }
}

// Plays one NJS_MOTION on a node tree (bones or groups in depth-first order):
// frame += speed every game tick (30/s); mode 1 loops, others hold the end
// (FUN_007aa094, see formats/plymotion.ts for the record format).
export class NodeAnimator {
  private nodes: THREE.Object3D[];
  private orders: THREE.EulerOrder[];
  private bindPos: THREE.Vector3[];
  private bindQuat: THREE.Quaternion[];
  private bindScale: THREE.Vector3[];
  private motion: NjMotion;
  private speed: number;
  private loop: boolean;
  private tickRemainder = 0;
  frame = 0;
  private v: [number, number, number] = [0, 0, 0];
  private euler = new THREE.Euler();
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();

  constructor(nodes: THREE.Object3D[], flags: number[], motion: NjMotion, speed: number, loop: boolean, startFrame = 0) {
    this.nodes = nodes;
    this.orders = flags.map((f) => (f & EVAL_ZXY_ANG ? 'YXZ' : 'ZYX'));
    this.bindPos = nodes.map((n) => n.position.clone());
    this.bindQuat = nodes.map((n) => n.quaternion.clone());
    this.bindScale = nodes.map((n) => n.scale.clone());
    this.motion = motion;
    this.speed = speed;
    this.loop = loop;
    this.frame = motion.frameCount > 0 ? startFrame % motion.frameCount : 0;
    this.apply(this.frame);
  }

  // Plays one explicit frame (door and laser motions are driven by their own
  // state machine, not by the tick counter).
  setFrame(frame: number): void {
    const m = this.motion;
    const f = m.frameCount > 1 ? Math.min(Math.max(frame, 0), m.frameCount - 1) : 0;
    this.frame = f;
    this.apply(f);
  }

  get frameCount(): number {
    return this.motion.frameCount;
  }

  update(dt: number): void {
    const m = this.motion;
    if (m.frameCount <= 1) return;
    this.tickRemainder += dt * GAME_TICKS_PER_SECOND;
    const ticks = Math.min(Math.floor(this.tickRemainder), 30);
    this.tickRemainder -= Math.floor(this.tickRemainder);
    for (let i = 0; i < ticks; i++) {
      this.frame += this.speed;
      if (this.loop) {
        if (this.frame >= m.frameCount) this.frame -= m.frameCount;
      } else if (this.frame >= m.frameCount - 1) {
        this.frame = m.frameCount - 1;
      }
    }
    let f = this.frame + this.speed * this.tickRemainder;
    f = this.loop ? f % m.frameCount : Math.min(f, m.frameCount - 1);
    this.apply(f);
  }

  private quat(keys: NjQuatKey[], frame: number, out: THREE.Quaternion): THREE.Quaternion {
    const n = keys.length;
    const set = (q: THREE.Quaternion, k: NjQuatKey) => q.set(k.value[1], k.value[2], k.value[3], k.value[0]);
    if (n === 1 || frame <= keys[0].frame) return set(out, keys[0]);
    let i = 0;
    while (i + 1 < n && keys[i + 1].frame <= frame) i++;
    const a = keys[i];
    const b = i + 1 < n ? keys[i + 1] : keys[0];
    const span = i + 1 < n ? b.frame - a.frame : this.motion.frameCount - a.frame;
    const t = span > 0 ? Math.min(1, (frame - a.frame) / span) : 0;
    set(out, a);
    return out.slerp(set(this.qb, b), t);
  }

  private apply(frame: number): void {
    const m = this.motion;
    const v = this.v;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const k = m.nodes[i];
      if (!k) continue;
      if (k.position) node.position.fromArray(sampleKeys(k.position, frame, m.frameCount, v));
      else node.position.copy(this.bindPos[i]);
      if (k.quaternion) {
        node.quaternion.copy(this.quat(k.quaternion, frame, this.qa));
      } else if (k.rotation) {
        sampleKeys(k.rotation, frame, m.frameCount, v, m.shortAngles);
        node.quaternion.setFromEuler(this.euler.set(v[0], v[1], v[2], this.orders[i]));
      } else {
        node.quaternion.copy(this.bindQuat[i]);
      }
      if (k.scale) node.scale.fromArray(sampleKeys(k.scale, frame, m.frameCount, v));
      else node.scale.copy(this.bindScale[i]);
    }
  }
}

export interface EnemyMotionSpec {
  index: number; // motion entry, relative to the first motion of the archive
  speed: number; // frames per game tick
  loop: boolean;
}

export interface EnemyPartSpec {
  model: number; // model entry (BML position)
  motion?: EnemyMotionSpec | null;
  texlistOf?: number; // draw with this model entry's texture list
  texRemap?: number[]; // texture id i (< length) draws as texture texRemap[i] of the list
  textureArchive?: string; // separate XVM used as the texture list (e.g. Gillchic)
}

export interface BuiltEnemy {
  root: THREE.Group;
  animators: NodeAnimator[];
  missingTextures: number;
  triangles: number;
}

function flagsDepthFirst(o: { flags: number; children: unknown[] }, out: number[] = []): number[] {
  out.push(o.flags);
  for (const c of o.children) flagsDepthFirst(c as { flags: number; children: unknown[] }, out);
  return out;
}

// Builds the parts of one enemy (each part is drawn at the enemy's origin).
// `phase` offsets the start frame so neighbours do not move in lockstep.
export function buildEnemy(archive: EnemyArchive, parts: EnemyPartSpec[], phase = 0, external: ReadonlyMap<string, THREE.Texture[]> = new Map()): BuiltEnemy {
  const root = new THREE.Group();
  const animators: NodeAnimator[] = [];
  let missingTextures = 0;
  let triangles = 0;
  for (const part of parts) {
    const data = archive.model(part.model);
    const names = archive.model(part.texlistOf ?? part.model).textures;
    const list = part.textureArchive ? external.get(part.textureArchive) : null;
    if (part.textureArchive && !list) throw new Error(`texture archive ${part.textureArchive} not loaded`);
    const lookup = (id: number) => {
      const i = part.texRemap && id < part.texRemap.length ? part.texRemap[id] : id;
      if (list) return list[i] ?? null;
      return names[i] !== undefined ? archive.texture(names[i]) : null;
    };
    let nodes: THREE.Object3D[];
    if (data.kind === 'nj') {
      const built = new NjcmModelBuilder().build([{ name: data.name, root: data.object, textures: lookup }]);
      root.add(built.root);
      nodes = built.partBones[0];
      missingTextures += built.stats.missingTextures;
      triangles += built.stats.triangles;
    } else {
      const built = buildObjectTreeWithNodes(data.object, new MaterialCache(lookup));
      root.add(built.root);
      nodes = built.nodes;
      built.root.traverse((o) => {
        if (o instanceof THREE.Mesh) triangles += (o.geometry.index?.count ?? 0) / 3;
      });
    }
    if (part.motion && part.motion.index >= 0 && part.motion.index < archive.motionCount) {
      const motion = archive.motion(part.motion.index, nodes.length);
      const start = motion.frameCount > 1 ? phase * (motion.frameCount - 1) : 0;
      animators.push(new NodeAnimator(nodes, flagsDepthFirst(data.object), motion, part.motion.speed, part.motion.loop, part.motion.loop ? start : 0));
    }
  }
  return { root, animators, missingTextures, triangles };
}

// Loads archives once per view.
export class EnemyArchiveCache {
  private files: ClientFiles;
  private archives = new Map<string, Promise<EnemyArchive>>();
  private xvms = new Map<string, Promise<THREE.Texture[]>>();
  readonly loadedTextures = new Map<string, THREE.Texture[]>();

  // A separate texture archive (.xvm in data/ or data.gsl).
  textures(name: string): Promise<THREE.Texture[]> {
    let p = this.xvms.get(name);
    if (!p) {
      p = this.files.read(name).then((d) => {
        const list = texturesFromXvm(d);
        this.loadedTextures.set(name, list);
        return list;
      });
      this.xvms.set(name, p);
    }
    return p;
  }

  constructor(files: ClientFiles) {
    this.files = files;
  }

  // Object archives: the model count is not in a descriptor here, so it is
  // taken from the entry names (models first, then the .njm / .njs motions,
  // which is how every object archive is laid out).
  getAuto(name: string): Promise<EnemyArchive> {
    let p = this.archives.get(name);
    if (!p) {
      p = this.files.read(name).then((data) => {
        const bml = new BmlArchive(data);
        const first = bml.entries.findIndex((e) => /\.(njm|njs)$/i.test(e.name));
        return new EnemyArchive(name, data, first < 0 ? bml.entries.length : first);
      });
      this.archives.set(name, p);
    }
    return p;
  }

  get(name: string, modelCount: number): Promise<EnemyArchive> {
    let p = this.archives.get(name);
    if (!p) {
      p = this.files.read(name).then((data) => new EnemyArchive(name, data, modelCount));
      this.archives.set(name, p);
    }
    return p;
  }

  async dispose(): Promise<void> {
    for (const p of this.archives.values()) (await p.catch(() => null))?.dispose();
    this.archives.clear();
    for (const list of this.loadedTextures.values()) for (const t of list) t.dispose();
    this.loadedTextures.clear();
    this.xvms.clear();
  }
}

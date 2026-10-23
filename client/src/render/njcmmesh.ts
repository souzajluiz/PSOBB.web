// Builds skinned three.js meshes from Ninja chunk (NJCM) object trees.
//
// Chunk models are not self-contained meshes. Ninja draws them by walking the
// object tree: each node's vertex chunks are transformed by the node's matrix
// and written into a vertex buffer shared by the whole tree, and polygon
// chunks index that buffer. Weighted vertex chunks (Ninja flags) accumulate
// the same vertex from several nodes, which is how PSO skins characters, and
// "cache"/"draw" polygon chunks postpone strips until later nodes have written
// the vertices they use. Layouts are documented in formats/njcm.ts.
//
// This evaluates that walk once in the bind pose and emits, per tree, one
// THREE.SkinnedMesh whose vertices carry the (up to 4) nodes that wrote them
// as skin indices/weights. One THREE.Bone is created per node, in depth-first
// order, so motions addressed by node index can drive it later.

import * as THREE from 'three';
import type { NjcmObject, NjcmPolyOp, NjcmStrip } from '../formats/njcm.ts';
import { SHAPE_NORMAL_TYPES, SHAPE_POSITION_TYPES } from '../formats/njshape.ts';
import { EVAL_HIDE, EVAL_UNIT_ANG, EVAL_UNIT_POS, EVAL_UNIT_SCL, EVAL_ZXY_ANG } from '../formats/xj.ts';

export type NjcmTextureLookup = (id: number) => THREE.Texture | null;

export interface NjcmPartInput {
  name: string;
  root: NjcmObject;
  textures: NjcmTextureLookup;
  // Bone (depth-first node index of the first part) to attach this part's
  // root to; undefined = the model root.
  attachTo?: number;
  // Replaces the material diffuse color (hair color).
  diffuse?: THREE.Color;
  // Keep where each vertex came from (partShapeSources), for a shape motion.
  shape?: boolean;
  // Nodes (depth-first, as partBones) whose strips get materials of their own,
  // tagged userData.node, so the caller can tint one node's plate (De Rol Le's
  // segments). A strip belongs to the node that polls it: a cached op list
  // belongs to the node that cached it (the 'cache' op), not to the draw.
  ownMaterials?: readonly number[] | undefined;
  // Texture ids whose UV the caller shifts (the Morfos' wall stream,
  // EnemyPartSpec.uvDrive): the texture of that id repeats (the exe's
  // ProcessCommandStream clears the clamp bits) and its UV offset is this
  // vector, which the caller sets each frame.
  uvOffsets?: ReadonlyMap<number, THREE.Vector2> | undefined;
}

export interface NjcmModelStats {
  bones: number;
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  missingTextures: number;
  // Strip vertices that referenced a vertex buffer slot nothing wrote.
  unresolvedVertices: number;
}

// Where each vertex of a part's mesh came from, for shape motions
// (formats/njshape.ts): the node (depth-first index in the part) whose vertex
// chunk wrote it and the vertex's index in that node's shape key arrays
// (-1: not one the shape motion replaces, or a weighted vertex).
export interface NjcmShapeSources {
  node: Int32Array;
  position: Int32Array;
  normal: Int32Array;
}

export interface NjcmModel {
  root: THREE.Group;
  skeleton: THREE.Skeleton;
  // Bones of each part, depth-first.
  partBones: THREE.Bone[][];
  // Each part's mesh (null if it drew nothing), the sources of its vertices
  // and each node's world matrix in the bind pose (model space).
  partMeshes: (THREE.SkinnedMesh | null)[];
  partShapeSources: (NjcmShapeSources | null)[];
  partBindMatrices: THREE.Matrix4[][];
  stats: NjcmModelStats;
}

// Ninja blend factors (src/dst fields of blend and material chunks).
const BLEND_FACTORS: THREE.BlendingSrcFactor[] = [
  THREE.ZeroFactor,
  THREE.OneFactor,
  THREE.SrcColorFactor,
  THREE.OneMinusSrcColorFactor,
  THREE.SrcAlphaFactor,
  THREE.OneMinusSrcAlphaFactor,
  THREE.DstAlphaFactor,
  THREE.OneMinusDstAlphaFactor,
];

// Strip flags (NJD_FST_*).
const STRIP_IGNORE_LIGHT = 0x01;
const STRIP_USE_ALPHA = 0x08;
// Texture chunk flags.
const TEX_FLIP_U = 0x80;
const TEX_FLIP_V = 0x40;
const TEX_CLAMP_U = 0x20;
const TEX_CLAMP_V = 0x10;

interface Slot {
  p: THREE.Vector3;
  n: THREE.Vector3;
  inf: Map<number, number>; // bone index -> weight
  color: [number, number, number, number] | null;
  // Shape motion source: node (depth-first in the part), index in its vertex
  // and normal key arrays; absent for weighted vertices.
  shape?: { node: number; position: number; normal: number };
}

interface MatState {
  texId: number;
  texFlags: number;
  src: number;
  dst: number;
  diffuse: number; // BGRA u32
}

class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  skinIndex: number[] = [];
  skinWeight: number[] = [];
  shapeNode: number[] = [];
  shapePosition: number[] = [];
  shapeNormal: number[] = [];
  groups = new Map<string, { indices: number[]; mat: MatState; stripFlags: number; owner: number }>();
  hasColors = false;

  vertex(s: Slot, u: number, v: number, color: number[] | null): number {
    const i = this.positions.length / 3;
    this.positions.push(s.p.x, s.p.y, s.p.z);
    const n = s.n.lengthSq() > 0 ? s.n.clone().normalize() : new THREE.Vector3(0, 1, 0);
    this.normals.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    const c = color ?? s.color;
    if (c) this.hasColors = true;
    this.colors.push(...(c ?? [1, 1, 1, 1]));
    this.shapeNode.push(s.shape?.node ?? -1);
    this.shapePosition.push(s.shape?.position ?? -1);
    this.shapeNormal.push(s.shape?.normal ?? -1);
    // Strongest 4 influences, renormalized.
    const inf = [...s.inf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = inf.reduce((t, [, w]) => t + w, 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.skinIndex.push(inf[k]?.[0] ?? 0);
      this.skinWeight.push(inf[k] ? inf[k][1] / total : 0);
    }
    return i;
  }
}

function materialKey(m: MatState, stripFlags: number): string {
  return `${m.texId}|${m.texFlags & 0xf0}|${m.src}|${m.dst}|${m.diffuse}|${stripFlags & (STRIP_USE_ALPHA | STRIP_IGNORE_LIGHT)}`;
}

export class NjcmModelBuilder {
  private wrapped = new Map<THREE.Texture, Map<string, THREE.Texture>>();
  private materials = new Map<string, THREE.Material>();
  private missing = 0;

  // Texture with the wrap mode a texture chunk asks for (clones share the image).
  private texture(base: THREE.Texture, flags: number): THREE.Texture {
    const wrapS = flags & TEX_CLAMP_U ? THREE.ClampToEdgeWrapping : flags & TEX_FLIP_U ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
    const wrapT = flags & TEX_CLAMP_V ? THREE.ClampToEdgeWrapping : flags & TEX_FLIP_V ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
    if (base.wrapS === wrapS && base.wrapT === wrapT) return base;
    let byMode = this.wrapped.get(base);
    if (!byMode) this.wrapped.set(base, (byMode = new Map()));
    const key = `${wrapS}|${wrapT}`;
    let t = byMode.get(key);
    if (!t) {
      t = base.clone();
      t.wrapS = wrapS;
      t.wrapT = wrapT;
      t.needsUpdate = true;
      byMode.set(key, t);
    }
    return t;
  }

  // A texture whose UV offset the caller drives. The clone is ours and reads the
  // caller's offset vector at every draw (three.js updates the texture matrix
  // from `offset` each frame); it repeats, as the shifted strips may leave the
  // texture's edge.
  private driven(base: THREE.Texture, offset: THREE.Vector2): THREE.Texture {
    const t = base.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.offset = offset;
    t.needsUpdate = true;
    return t;
  }

  // owner: the node whose own material this is (ownMaterials), -1 for the shared ones.
  private material(part: NjcmPartInput, m: MatState, stripFlags: number, owner: number): THREE.Material {
    const key = `${part.name}|${owner}|${materialKey(m, stripFlags)}`;
    let mat = this.materials.get(key);
    if (mat) return mat;
    const base = m.texId >= 0 ? part.textures(m.texId) : null;
    if (m.texId >= 0 && !base) this.missing++;
    const drive = base && m.texId >= 0 ? part.uvOffsets?.get(m.texId) : undefined;
    const map = base ? (drive ? this.driven(base, drive) : this.texture(base, m.texFlags)) : null;
    const color = part.diffuse
      ? part.diffuse.clone()
      : new THREE.Color().setRGB(((m.diffuse >> 16) & 0xff) / 255, ((m.diffuse >> 8) & 0xff) / 255, (m.diffuse & 0xff) / 255, THREE.SRGBColorSpace);
    const alpha = !!(stripFlags & STRIP_USE_ALPHA);
    const params = {
      map,
      color,
      side: THREE.DoubleSide,
      transparent: alpha,
      alphaTest: alpha ? 0.02 : 0.5,
      depthWrite: true,
    };
    mat = stripFlags & STRIP_IGNORE_LIGHT ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params);
    if (alpha) {
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = BLEND_FACTORS[m.src] ?? THREE.SrcAlphaFactor;
      mat.blendDst = (BLEND_FACTORS[m.dst] ?? THREE.OneMinusSrcAlphaFactor) as THREE.BlendingDstFactor;
    }
    // The wrapped clone is ours (the base texture is the caller's): it goes with the material.
    if (map && base && map !== base) mat.addEventListener('dispose', () => map.dispose());
    if (owner >= 0) mat.userData.node = owner;
    this.materials.set(key, mat);
    return mat;
  }

  build(parts: NjcmPartInput[]): NjcmModel {
    const root = new THREE.Group();
    const allBones: THREE.Bone[] = [];
    const partBones: THREE.Bone[][] = [];
    const partNodes: { node: NjcmObject; bone: THREE.Bone; index: number }[][] = [];

    // 1. Bones for every node of every part.
    for (const part of parts) {
      const list: { node: NjcmObject; bone: THREE.Bone; index: number }[] = [];
      const parent = part.attachTo !== undefined ? partBones[0]?.[part.attachTo] : undefined;
      if (part.attachTo !== undefined && !parent) throw new Error(`${part.name}: no bone ${part.attachTo} to attach to`);
      const make = (node: NjcmObject, into: THREE.Object3D) => {
        const bone = new THREE.Bone();
        bone.name = `${part.name}:${list.length}`;
        if (!(node.flags & EVAL_UNIT_POS)) bone.position.set(...node.position);
        if (!(node.flags & EVAL_UNIT_ANG)) {
          // Ninja applies X, then Y, then Z (M = T * Rz * Ry * Rx); with ZXY_ANG: Z, X, Y.
          bone.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2], node.flags & EVAL_ZXY_ANG ? 'YXZ' : 'ZYX');
        }
        if (!(node.flags & EVAL_UNIT_SCL)) bone.scale.set(...node.scale);
        into.add(bone);
        list.push({ node, bone, index: allBones.length });
        allBones.push(bone);
        for (const c of node.children) make(c, bone);
      };
      make(part.root, parent ?? root);
      partNodes.push(list);
      partBones.push(list.map((e) => e.bone));
    }
    root.updateMatrixWorld(true);

    // 2. Evaluate vertices and strips in node order, per part.
    let vertices = 0, triangles = 0, unresolved = 0;
    const meshes: THREE.SkinnedMesh[] = [];
    const partMeshes: (THREE.SkinnedMesh | null)[] = parts.map(() => null);
    const partShapeSources: (NjcmShapeSources | null)[] = parts.map(() => null);
    const partBindMatrices = partNodes.map((list) => list.map((e) => e.bone.matrixWorld.clone()));
    parts.forEach((part, pi) => {
      const buffer: (Slot | undefined)[] = [];
      const cache = new Map<number, { ops: NjcmPolyOp[]; owner: number }>();
      const state: MatState = { texId: -1, texFlags: 0, src: 4, dst: 5, diffuse: 0xffffffff };
      const out = new MeshBuilder();
      const own = new Set(part.ownMaterials ?? []);

      // by: the node whose polys these are (its index when it is in ownMaterials).
      const runPolys = (ops: NjcmPolyOp[], by: number) => {
        for (let k = 0; k < ops.length; k++) {
          const op = ops[k];
          switch (op.op) {
            case 'cache':
              cache.set(op.slot, { ops: ops.slice(k + 1), owner: by });
              return;
            case 'draw': {
              const cached = cache.get(op.slot);
              if (cached) runPolys(cached.ops, cached.owner);
              break;
            }
            case 'blend':
              state.src = op.src;
              state.dst = op.dst;
              break;
            case 'material':
              state.src = op.src;
              state.dst = op.dst;
              if (op.diffuse !== null) state.diffuse = op.diffuse;
              break;
            case 'texture':
              state.texId = op.id;
              state.texFlags = op.flags;
              break;
            case 'strips':
              for (const strip of op.strips) emitStrip(strip, op.flags, by);
              break;
          }
        }
      };

      const emitStrip = (strip: NjcmStrip, stripFlags: number, by: number) => {
        const owner = own.has(by) ? by : -1;
        const key = `${materialKey(state, stripFlags)}${owner >= 0 ? `|node${owner}` : ''}`;
        let group = out.groups.get(key);
        if (!group) out.groups.set(key, (group = { indices: [], mat: { ...state }, stripFlags, owner }));
        const ids: number[] = [];
        for (let v = 0; v < strip.indices.length; v++) {
          const slot = buffer[strip.indices[v]];
          if (!slot) {
            unresolved++;
            ids.push(-1);
            continue;
          }
          const u = strip.uvs ? strip.uvs[v * 2] : 0;
          const t = strip.uvs ? strip.uvs[v * 2 + 1] : 0;
          ids.push(out.vertex(slot, u, t, strip.colors ? strip.colors.slice(v * 4, v * 4 + 4) : null));
        }
        for (let v = 2; v < ids.length; v++) {
          const a = ids[v - 2], b = ids[v - 1], c = ids[v];
          if (a < 0 || b < 0 || c < 0) continue;
          if (strip.indices[v - 2] === strip.indices[v - 1] || strip.indices[v - 1] === strip.indices[v] || strip.indices[v - 2] === strip.indices[v]) continue;
          // Alternating winding; a negative strip length starts reversed.
          if (((v & 1) === 1) !== strip.flipped) group.indices.push(b, a, c);
          else group.indices.push(a, b, c);
          triangles++;
        }
      };

      const normalMatrix = new THREE.Matrix3();
      partNodes[pi].forEach(({ node, bone, index }, local) => {
        const model = node.model;
        if (!model) return;
        normalMatrix.getNormalMatrix(bone.matrixWorld);
        // Shape key array positions run on across the node's chunks.
        let shapePos = 0;
        let shapeNorm = 0;
        for (const chunk of model.vertices) {
          const blend = chunk.flags & 3; // 0 start/overwrite, 1 middle, 2 end
          const posBase = SHAPE_POSITION_TYPES.has(chunk.type) ? shapePos : -1;
          const normBase = SHAPE_NORMAL_TYPES.has(chunk.type) ? shapeNorm : -1;
          if (posBase >= 0) shapePos += chunk.indices.length;
          if (normBase >= 0) shapeNorm += chunk.indices.length;
          for (let i = 0; i < chunk.indices.length; i++) {
            const p = new THREE.Vector3().fromArray(chunk.positions, i * 3).applyMatrix4(bone.matrixWorld);
            const n = chunk.normals ? new THREE.Vector3().fromArray(chunk.normals, i * 3).applyMatrix3(normalMatrix) : new THREE.Vector3();
            const color: [number, number, number, number] | null = chunk.colors
              ? [chunk.colors[i * 4], chunk.colors[i * 4 + 1], chunk.colors[i * 4 + 2], chunk.colors[i * 4 + 3]]
              : null;
            const idx = chunk.indices[i];
            if (!chunk.weights) {
              const shape = { node: local, position: posBase >= 0 ? posBase + i : -1, normal: normBase >= 0 ? normBase + i : -1 };
              buffer[idx] = { p, n, inf: new Map([[index, 1]]), color, shape };
              continue;
            }
            const w = chunk.weights[i];
            const prev = buffer[idx];
            if (blend === 0 || !prev) {
              buffer[idx] = { p: p.multiplyScalar(w), n: n.multiplyScalar(w), inf: new Map([[index, w]]), color };
            } else {
              prev.p.addScaledVector(p, w);
              prev.n.addScaledVector(n, w);
              prev.inf.set(index, (prev.inf.get(index) ?? 0) + w);
            }
          }
        }
        if (!(node.flags & EVAL_HIDE)) runPolys(model.polys, local);
      });

      if (!out.groups.size) return;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3));
      geom.setAttribute('normal', new THREE.Float32BufferAttribute(out.normals, 3));
      geom.setAttribute('uv', new THREE.Float32BufferAttribute(out.uvs, 2));
      if (out.hasColors) geom.setAttribute('color', new THREE.Float32BufferAttribute(out.colors, 4));
      geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out.skinIndex, 4));
      geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(out.skinWeight, 4));
      const indices: number[] = [];
      const mats: THREE.Material[] = [];
      // Opaque groups first so alpha strips blend over them.
      const groups = [...out.groups.values()].sort((a, b) => (a.stripFlags & STRIP_USE_ALPHA) - (b.stripFlags & STRIP_USE_ALPHA));
      for (const g of groups) {
        if (!g.indices.length) continue;
        geom.addGroup(indices.length, g.indices.length, mats.length);
        mats.push(this.material(part, g.mat, g.stripFlags, g.owner));
        for (const i of g.indices) indices.push(i);
      }
      geom.setIndex(indices);
      geom.computeBoundingSphere();
      const mesh = new THREE.SkinnedMesh(geom, mats);
      mesh.name = part.name;
      mesh.frustumCulled = false;
      meshes.push(mesh);
      partMeshes[pi] = mesh;
      if (part.shape) {
        partShapeSources[pi] = { node: Int32Array.from(out.shapeNode), position: Int32Array.from(out.shapePosition), normal: Int32Array.from(out.shapeNormal) };
      }
      vertices += out.positions.length / 3;
    });

    const skeleton = new THREE.Skeleton(allBones);
    for (const mesh of meshes) {
      root.add(mesh);
      mesh.bind(skeleton, new THREE.Matrix4());
    }
    return {
      root,
      skeleton,
      partBones,
      partMeshes,
      partShapeSources,
      partBindMatrices,
      stats: {
        bones: allBones.length,
        meshes: meshes.length,
        vertices,
        triangles,
        materials: this.materials.size,
        missingTextures: this.missing,
        unresolvedVertices: unresolved,
      },
    };
  }
}

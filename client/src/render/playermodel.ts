// PSOBB player character models: body, head, hair and cap parts from
// pl<L>nj.bml (NJCM chunk models), textures from pl<L>tex.afs (one XVR per
// entry), assembled into one skinned three.js object.
//
// Class letters: the class index 0..11 maps to A..L (HUmar = plA..., RAmarl =
// plL...), as in the file list of PsoBB.exe (planj.bml, plbnj.bml, ...).
// Letters O..Y are the extra NPC-style models (not handled here).
//
// Parts (class record at 0x009b5b60 + 0x2c * class, playertables.ts):
// pl<L>bdy00.nj is the 64-node skeleton with the body; the head
// (pl<L>hed<NN>.nj, androids have 5) hangs from body node 58 and hair
// (pl<L>hai<NN>.nj, 10 styles) and caps (pl<L>cap<NN>.nj, drawn with hair
// style NN when present) from node 59 (depth-first indices; the player draw
// FUN_0068a088 uses the node matrices at +0xe80 and +0xec0). Hair and cap NN
// share one texture list; only the hair gets the hair color.
//
// Texture ids in each part index a per-part texture list that the game builds
// by name from the appearance (see "Texture lists" below); the body and head
// are morphed by proportion_x/y (see "Proportions").

import * as THREE from 'three';
import { AFSArchive } from '../formats/archives.ts';
import { BmlArchive } from '../formats/bml.ts';
import { parseNinjaChunkFile, type NjcmModel as NjcmChunkModel, type NjcmObject } from '../formats/njcm.ts';
import { EVAL_UNIT_POS, EVAL_UNIT_SCL } from '../formats/xj.ts';
import { exeWalkIndices } from './playeranim.ts';
import { parseXvr } from '../formats/xvm.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import { NjcmModelBuilder, type NjcmModel, type NjcmPartInput } from './njcmmesh.ts';
import { PLAYER_CLASS_TABLES, SMP_BASE, SMP_COUNT } from './playertables.ts';
import { HAND_NODE, type HeldWeapon } from './heldweapon.ts';

export const CLASS_NAMES = [
  'HUmar', 'HUnewearl', 'HUcast', 'RAmar', 'RAcast', 'RAcaseal',
  'FOmarl', 'FOnewm', 'FOnewearl', 'HUcaseal', 'FOmar', 'RAmarl',
] as const;

export const SECTION_IDS = [
  'Viridia', 'Greenill', 'Skyly', 'Bluefull', 'Purplenum', 'Pinkal', 'Redria', 'Oran', 'Yellowboze', 'Whitill',
] as const;

// Body node the hair and cap hang from.
export const HEAD_NODE = 59;
// Body node the head model hangs from (same bind pose as node 59).
export const HEAD_MODEL_NODE = 58;

// PlayerVisualConfig fields (newserv PlayerSubordinates.hh) that affect the model.
export interface PlayerAppearance {
  sectionId: number;
  costume: number;
  skin: number;
  face: number;
  head: number;
  hair: number;
  hairR: number;
  hairG: number;
  hairB: number;
  proportionX: number;
  proportionY: number;
}

export const DEFAULT_APPEARANCE: PlayerAppearance = {
  sectionId: 0, costume: 0, skin: 0, face: 0, head: 0, hair: 0,
  hairR: 160, hairG: 110, hairB: 60, proportionX: 0, proportionY: 0,
};

export function classLetter(charClass: number): string {
  if (charClass < 0 || charClass > 11) throw new Error(`bad character class ${charClass}`);
  return String.fromCharCode(0x41 + charClass);
}

export function isAndroid(charClass: number): boolean {
  return charClass === 2 || charClass === 4 || charClass === 5 || charClass === 9;
}

// Number of values of each appearance field: the limits of the class record
// (0x009b5b60 + 0x2c * class, i16 costume/skin/face/head/hair) that
// FUN_004e665c checks; a limit of 0 means the field must be 0 (count 1 here).
// Humans/newmans: 18 costumes, 4 skins, 5 faces, 1 head, 10 hair styles;
// androids: 1, 25, 1, 5, 1.
export function appearanceLimits(charClass: number): { costume: number; skin: number; face: number; head: number; hair: number } {
  const [costume, skin, face, head, hair] = PLAYER_CLASS_TABLES[charClass].limits.map((n) => Math.max(n, 1));
  return { costume, skin, face, head, hair };
}

export interface PlayerAssets {
  charClass: number;
  letter: string;
  parts: Map<string, NjcmObject>; // by entry name, e.g. "plAbdy00.nj"
  textures: (THREE.Texture | null)[]; // one per pl<L>tex.afs entry, decoded lazily
  textureCount: number;
  textureData: AFSArchive;
  // plZsmpnj.afs (proportion shapes of every class); null = no proportions.
  morphs: AFSArchive | null;
}

export function parsePlayerAssets(charClass: number, bmlData: Uint8Array, afsData: Uint8Array, smpData?: Uint8Array): PlayerAssets {
  const letter = classLetter(charClass);
  const bml = new BmlArchive(bmlData);
  const parts = new Map<string, NjcmObject>();
  for (const e of bml.entries) {
    const f = parseNinjaChunkFile(bml.get(e.name));
    if (f.object) parts.set(e.name, f.object);
  }
  const afs = new AFSArchive(afsData);
  const morphs = smpData ? new AFSArchive(smpData) : null;
  return { charClass, letter, parts, textures: new Array(afs.entries.length).fill(null), textureCount: afs.entries.length, textureData: afs, morphs };
}

export async function loadPlayerAssets(files: ClientFiles, charClass: number): Promise<PlayerAssets> {
  const letter = classLetter(charClass);
  // Loose files in data/ (not in data.gsl). plZsmpnj.afs is the archive the
  // client opens as file 0xdf (FUN_004e65a3).
  const [bml, afs, smp] = await Promise.all([files.read(`pl${letter}nj.bml`), files.read(`pl${letter}tex.afs`), files.read('plZsmpnj.afs')]);
  return parsePlayerAssets(charClass, bml, afs, smp);
}

function texture(assets: PlayerAssets, index: number): THREE.Texture | null {
  if (index < 0 || index >= assets.textureCount) return null;
  let t = assets.textures[index];
  if (!t) {
    const x = parseXvr(assets.textureData.get(index), index);
    t = new THREE.DataTexture(x.rgba, x.width, x.height, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    assets.textures[index] = t;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Texture lists
//
// FUN_004e6920 (called from FUN_004e660c with the player's PlayerVisualConfig)
// builds three texture lists, each from a list of texture names of the class
// record (playertables.ts): hair (record +0x20, indexed by hair style; hai and
// cap both draw with it), head (+0x24, by head) and body (+0x28). Each name,
// "pxt" + part letter + type + "_NNv_...", is copied and edited in place:
//   type 'b' (body) or 't' (hands), NN != "00", costume limit > 0: NN = costume + 1
//   type 'b', 'f' (face) or 't', v != 'z', skin limit > 0:          v = 'a' + skin
//   type 'f', N[1] != '0', face limit > 0:                          N[1] = '1' + face
//   type 'c' (section ID emblem): v = 'a' + section ID, or 'z' (empty ring) when
//   the section ID is invalid
// and looked up by name in the class's sorted texture name table
// (FUN_004ed735, binary search); the index is the pl<L>tex.afs entry. A name
// that is not found loads entry 0 and flags the list. Texture id N of a part
// is entry N of its list. Every name these rules produce exists in the table.

interface TexLists {
  body: number[];
  head: number[];
  hair: number[]; // shared by hai<NN> and cap<NN>
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function textureName(template: string, a: PlayerAppearance, limits: readonly number[]): string {
  const s = ('pxt' + template).split('');
  const type = s[4];
  if (limits[0] > 0 && !(s[6] === '0' && s[7] === '0') && (type === 'b' || type === 't')) {
    const v = a.costume + 1;
    s[6] = String(Math.trunc(v / 10));
    s[7] = String(v % 10);
  }
  if (limits[1] > 0 && s[8] !== 'z' && (type === 'b' || type === 'f' || type === 't')) s[8] = String.fromCharCode(0x61 + a.skin);
  if (limits[2] > 0 && s[7] !== '0' && type === 'f') s[7] = String.fromCharCode(0x31 + a.face);
  if (type === 'c') s[8] = a.sectionId >= 0 && a.sectionId < 10 ? String.fromCharCode(0x61 + a.sectionId) : 'z';
  return s.join('');
}

// Texture names of each part for an appearance, in texture id order.
// `emblemSectionId` overrides the clamped section ID for the emblem ('c')
// textures: character creation keeps 0xFF ("not computed yet") until the
// name is confirmed, which draws the empty ring ('z').
export function playerTextureNames(charClass: number, appearance: PlayerAppearance, emblemSectionId?: number): { body: string[]; head: string[]; hair: string[] } {
  const t = PLAYER_CLASS_TABLES[charClass];
  const a = clampAppearance(charClass, appearance);
  if (emblemSectionId !== undefined) a.sectionId = emblemSectionId;
  const names = (list: readonly number[] | undefined) => (list ?? []).map((i) => textureName(t.names[i], a, t.limits));
  return { body: names(t.body), head: names(t.head[a.head]), hair: names(t.hair?.[a.hair]) };
}

const nameIndexes = new Map<number, Map<string, number>>();
function textureIndex(charClass: number, name: string): number {
  let m = nameIndexes.get(charClass);
  if (!m) {
    m = new Map(PLAYER_CLASS_TABLES[charClass].names.map((n, i) => ['pxt' + n, i]));
    nameIndexes.set(charClass, m);
  }
  return m.get(name) ?? 0;
}

export function playerTextureLists(assets: PlayerAssets, a: PlayerAppearance, emblemSectionId?: number): TexLists {
  const n = playerTextureNames(assets.charClass, a, emblemSectionId);
  const idx = (list: string[]) => list.map((name) => textureIndex(assets.charClass, name));
  return { body: idx(n.body), head: idx(n.head), hair: idx(n.hair) };
}

// ---------------------------------------------------------------------------
// Proportions (PlayerVisualConfig proportion_x / proportion_y)
//
// The body and head are not scaled: they are morphed between 7 shapes per
// class (and head) stored in plZsmpnj.afs (playertables.ts: SMP_BASE/COUNT).
// The proportion square is split into 8 triangles over 9 points
// (0x009b1680, x of points 1, 2, 3, 5, 6 set at run time by FUN_004e9690):
//   P0 (0,0)  P1 (1/3,0)  P2 (2/3,0)  P3 (1/3,1/2)  P4 (0,1)
//   P5 (1/3,1)  P6 (2/3,1)  P7 (1,1)  P8 (1,0)
// triangle vertices at 0x009b16e0; shape of point 7 = shape 4, point 8 =
// shape 0 (FUN_004e93b4). FUN_004e877c picks the triangle, FUN_004e86e4 the
// barycentric weights, FUN_004e7e54 blends the three shapes into the model:
// per node (depth-first) the model center, the position (if any shape has a
// position), the scale (body only, if any shape has one) and the vertex chunks
// 41/44 (position, normal renormalized, Ninja-flags weight). In game the
// three shapes are loaded per player by FUN_004ee448 and blended by
// FUN_004ee534; character creation does the same in FUN_00603ce0.
// FUN_004e686c first resets both to 0 unless 0 <= x < 1 and 0 <= y < 1.

const F13 = Math.fround(1 / 3);
const F23 = Math.fround(2 / 3);
const PROPORTION_POINTS: readonly (readonly [number, number])[] = [
  [0, 0], [F13, 0], [F23, 0], [F13, 0.5], [0, 1], [F13, 1], [F23, 1], [1, 1], [1, 0],
];
const PROPORTION_TRIANGLES: readonly (readonly [number, number, number])[] = [
  [1, 3, 0], [0, 4, 3], [3, 5, 4], [1, 3, 2], [2, 6, 3], [3, 5, 6], [2, 6, 7], [8, 7, 2],
];
const POINT_SHAPE = (p: number) => (p === 7 ? 4 : p === 8 ? 0 : p);

export function validProportions(x: number, y: number): [number, number] {
  return x >= 0 && x < 1 && y >= 0 && y < 1 ? [x, y] : [0, 0];
}

// FUN_004e877c (same constants as FUN_006045e8 for character creation).
function proportionTriangle(x: number, y: number): number {
  if (x > F23) return (x - F23) * 3 <= y ? 6 : 7;
  if (x <= F13) {
    if (F23 * y <= x) return 0;
    return x <= (y - 1) * -F23 ? 1 : 2;
  }
  if (x <= (y - 1) * -F23) return 3;
  return y * F23 <= x ? 4 : 5;
}

// Shapes (0..6) and weights the client blends for these proportions.
export function proportionMorph(proportionX: number, proportionY: number): { shapes: [number, number, number]; weights: [number, number, number] } {
  const [x, y] = validProportions(proportionX, proportionY);
  const [ia, ib, ic] = PROPORTION_TRIANGLES[proportionTriangle(x, y)];
  const [pa, pb, pc] = [PROPORTION_POINTS[ia], PROPORTION_POINTS[ib], PROPORTION_POINTS[ic]];
  const wc = Math.fround((x - pa[0]) / (pc[0] - pa[0]));
  const wb = Math.fround((y - pa[1] - wc * (pc[1] - pa[1])) / (pb[1] - pa[1]));
  const wa = Math.fround(1 - (wb + wc));
  return { shapes: [POINT_SHAPE(ia), POINT_SHAPE(ib), POINT_SHAPE(ic)], weights: [wa, wb, wc] };
}

export function morphTargetEntry(charClass: number, shape: number, head: number, part: 'body' | 'head'): number {
  return SMP_BASE[charClass] + SMP_COUNT[charClass] * shape + (part === 'body' ? SMP_COUNT[charClass] - 1 : head);
}

function flatten(o: NjcmObject, out: NjcmObject[] = []): NjcmObject[] {
  out.push(o);
  for (const c of o.children) flatten(c, out);
  return out;
}

function cloneObject(o: NjcmObject): NjcmObject {
  return {
    ...o,
    position: [...o.position],
    scale: [...o.scale],
    model: o.model && {
      ...o.model,
      center: [...o.model.center],
      vertices: o.model.vertices.map((v) => ({
        ...v,
        positions: v.positions.slice(),
        normals: v.normals?.slice() ?? null,
        weights: v.weights?.slice() ?? null,
      })),
    },
    children: o.children.map(cloneObject),
  };
}

// x87 FISTP in the default rounding mode (nearest, ties to even).
const roundEven = (v: number) => {
  const f = Math.floor(v);
  const d = v - f;
  return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f;
};

// FUN_004e838c: vertex chunks 41 (position + normal) and 44 (+ Ninja flags) of
// the destination, in order, until another chunk type.
function blendVertices(dst: NjcmChunkModel, src: NjcmChunkModel[], w: readonly number[]): void {
  for (let c = 0; c < dst.vertices.length; c++) {
    const d = dst.vertices[c];
    if (d.type !== 41 && d.type !== 44) return;
    const s = src.map((m) => m.vertices[c]);
    if (s.some((v) => !v || v.positions.length !== d.positions.length)) return;
    for (let i = 0; i < d.positions.length; i++) d.positions[i] = Math.fround(w[0] * s[0].positions[i] + w[1] * s[1].positions[i] + w[2] * s[2].positions[i]);
    if (d.normals && s.every((v) => v.normals)) {
      for (let i = 0; i < d.normals.length; i += 3) {
        const n = [0, 1, 2].map((k) => w[0] * s[0].normals![i + k] + w[1] * s[1].normals![i + k] + w[2] * s[2].normals![i + k]);
        const len = Math.hypot(n[0], n[1], n[2]);
        for (let k = 0; k < 3; k++) d.normals[i + k] = Math.fround(len ? n[k] / len : n[k]);
      }
    }
    if (d.weights && s.every((v) => v.weights)) {
      for (let i = 0; i < d.weights.length; i++) {
        const hi = s.map((v) => Math.round(v.weights![i] * 255));
        d.weights[i] = roundEven(w[0] * hi[0] + w[1] * hi[1] + w[2] * hi[2]) / 255;
      }
    }
  }
}

// FUN_007aaefc node flags: 1 position, 4 scale, 0x10 vertex list.
const nodeFlags = (o: NjcmObject) =>
  (o.flags & EVAL_UNIT_POS ? 0 : 1) | (o.flags & EVAL_UNIT_SCL ? 0 : 4) | (o.model?.vertices.length ? 0x10 : 0);

// FUN_004e7e54: blends three shapes into a copy of `base`. `body` selects the
// body loop (64 nodes, scale blended, vertices if any shape has them); the
// head loop (5 nodes) does not blend scale and blends vertices when the
// first shape has them.
export function morphObject(base: NjcmObject, shapes: NjcmObject[], weights: readonly number[], body: boolean): NjcmObject {
  const out = cloneObject(base);
  const dst = flatten(out);
  const src = shapes.map((s) => flatten(s));
  const blend3 = (get: (o: NjcmObject) => readonly number[], i: number) =>
    [0, 1, 2].map((k) => Math.fround(weights[0] * get(src[0][i])[k] + weights[1] * get(src[1][i])[k] + weights[2] * get(src[2][i])[k])) as [number, number, number];
  const count = Math.min(dst.length, body ? 64 : 5);
  for (let i = 0; i < count; i++) {
    const d = dst[i];
    if (src.some((s) => !s[i])) break;
    const models = src.map((s) => s[i].model);
    const allModels = models.every((m) => m) ? (models as NjcmChunkModel[]) : null;
    if (d.model && allModels) d.model.center = blend3((o) => o.model!.center, i);
    const flags = src.map((s) => nodeFlags(s[i]));
    const any = flags[0] | flags[1] | flags[2];
    if (any & 1) {
      d.flags &= ~EVAL_UNIT_POS;
      d.position = blend3((o) => o.position, i);
    }
    if (body && any & 4) {
      d.flags &= ~EVAL_UNIT_SCL;
      d.scale = blend3((o) => o.scale, i);
    }
    if ((body ? any : flags[0]) & 0x10 && d.model && allModels) blendVertices(d.model, allModels, weights);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Model assembly

export interface PlayerModel extends NjcmModel {
  parts: string[];
  // The held weapon's mesh (null without one). The caller hides it in the hubs.
  weapon: THREE.SkinnedMesh | null;
  // The weapon's bones in the exe's walk order (exeWalkIndices): entry k is the bone the
  // attach index k names (combat/weaponorigin.ts). Null without a weapon.
  weaponBones: THREE.Bone[] | null;
}

export interface PlayerBuildOptions {
  emblemSectionId?: number | undefined;
  // The equipped weapon, in the right hand (render/heldweapon.ts).
  weapon?: HeldWeapon | null;
}

// FUN_004e665c: a value outside 0..limit-1 (or not 0 when the limit is 0)
// is reset to 0; an invalid section ID becomes id % 10, hair color channels
// outside 0..255 become 0, invalid proportions become (0, 0).
export function clampAppearance(charClass: number, a: PlayerAppearance): PlayerAppearance {
  const m = appearanceLimits(charClass);
  const fix = (v: number, n: number) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);
  const color = (v: number) => (Number.isInteger(v) && v >= 0 && v <= 255 ? v : 0);
  const sectionId = a.sectionId === -1 ? 0 : a.sectionId >= 0 && a.sectionId <= 9 ? a.sectionId : Math.trunc(a.sectionId) % 10;
  const [proportionX, proportionY] = validProportions(a.proportionX, a.proportionY);
  return {
    ...a,
    sectionId,
    costume: fix(a.costume, m.costume),
    skin: fix(a.skin, m.skin),
    face: fix(a.face, m.face),
    head: fix(a.head, m.head),
    hair: fix(a.hair, m.hair),
    hairR: color(a.hairR),
    hairG: color(a.hairG),
    hairB: color(a.hairB),
    proportionX,
    proportionY,
  };
}

export function buildPlayerModel(assets: PlayerAssets, appearance: PlayerAppearance = DEFAULT_APPEARANCE, opts: PlayerBuildOptions = {}): PlayerModel {
  const a = clampAppearance(assets.charClass, appearance);
  const L = assets.letter;
  const lists = playerTextureLists(assets, a, opts.emblemSectionId);
  const lookup = (list: number[]) => (id: number) => (list[id] !== undefined ? texture(assets, list[id]) : null);
  const part = (name: string) => {
    const p = assets.parts.get(name);
    if (!p) throw new Error(`${name} missing from pl${L}nj.bml`);
    return p;
  };
  // Part names from the exe's model name lists (playertables.ts `models`):
  // androids pick their head by index; humans have one head, pl<L>hed00.nj.
  const models = PLAYER_CLASS_TABLES[assets.charClass].models;
  const head = isAndroid(assets.charClass) ? (models.head[a.head] ?? `pl${L}hed${pad2(a.head)}.nj`) : `pl${L}hed00.nj`;
  let bodyRoot = part(`pl${L}bdy00.nj`);
  let headRoot = part(head);
  if (assets.morphs) {
    const { shapes, weights } = proportionMorph(a.proportionX, a.proportionY);
    const shape = (s: number, p: 'body' | 'head') => {
      const o = parseNinjaChunkFile(assets.morphs!.get(morphTargetEntry(assets.charClass, s, a.head, p))).object;
      if (!o) throw new Error(`plZsmpnj.afs: no model for class ${assets.charClass} shape ${s} ${p}`);
      return o;
    };
    bodyRoot = morphObject(bodyRoot, shapes.map((s) => shape(s, 'body')), weights, true);
    headRoot = morphObject(headRoot, shapes.map((s) => shape(s, 'head')), weights, false);
  }
  const inputs: NjcmPartInput[] = [{ name: `pl${L}bdy00.nj`, root: bodyRoot, textures: lookup(lists.body) }];
  inputs.push({ name: head, root: headRoot, textures: lookup(lists.head), attachTo: HEAD_MODEL_NODE });
  if (!isAndroid(assets.charClass)) {
    // A null cap name is a style without a cap (exe record +0x14).
    const hair = models.hair?.[a.hair];
    const hairColor = new THREE.Color().setRGB(a.hairR / 255, a.hairG / 255, a.hairB / 255, THREE.SRGBColorSpace);
    if (hair && assets.parts.has(hair)) inputs.push({ name: hair, root: part(hair), textures: lookup(lists.hair), attachTo: HEAD_NODE, diffuse: hairColor });
    const cap = models.cap?.[a.hair];
    if (cap && assets.parts.has(cap)) inputs.push({ name: cap, root: part(cap), textures: lookup(lists.hair), attachTo: HEAD_NODE });
  }
  let weaponAt = -1;
  if (opts.weapon) {
    const w = opts.weapon;
    weaponAt = inputs.length;
    inputs.push({ name: `weapon:${HAND_NODE}`, root: w.object, textures: (id) => w.textures[id] ?? null, attachTo: HAND_NODE });
  }
  const model = new NjcmModelBuilder().build(inputs);
  const weaponBones = opts.weapon && weaponAt >= 0 ? exeWalkIndices(opts.weapon.object).map((i) => model.partBones[weaponAt]?.[i]).filter((b): b is THREE.Bone => !!b) : null;
  return { ...model, parts: inputs.map((p) => p.name), weapon: weaponAt >= 0 ? (model.partMeshes[weaponAt] ?? null) : null, weaponBones };
}

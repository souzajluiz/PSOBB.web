// PSOBB player character models: body, head, hair and cap parts from
// pl<L>nj.bml (NJCM chunk models), textures from pl<L>tex.afs (one XVR per
// entry), assembled into one skinned three.js object.
//
// Class letters: the class index 0..11 maps to A..L (HUmar = plA..., RAmarl =
// plL...), as in the file list of PsoBB.exe (planj.bml, plbnj.bml, ...).
// Letters O..Y are the extra NPC-style models (not handled here).
//
// Parts: pl<L>bdy00.nj is the 64-node skeleton with the body. Heads
// (pl<L>hed<NN>.nj, androids have 5), hair (pl<L>hai<NN>.nj, 10 styles) and
// caps (pl<L>cap<NN>.nj, drawn with hair style NN when present) are attached
// to body node 59 (depth-first index), the head node. Hair and cap NN share
// one texture list.
//
// Texture ids in each part index a per-part texture list that the game builds
// from pl<L>tex.afs according to the appearance. The tables below were
// derived from the archive contents (contact sheets of every class) and the
// texture ids each part uses, then checked by eye in models.html; they are not
// taken from the game's code. The order of the body/head lists (e.g. HUnewearl
// body = [emblem, skin top, skin bottom... ] with entry 1 of the costume block
// first) follows the PSO v2 lists hard-coded in the PSOv2 web client
// (gitlab.com/dashgl/psov2, AssetPlayer.js, GPL; used as a reference only).
// Common layout of pl<L>tex.afs:
//   humans/newmans: [18 costume blocks][ears x4][faces 5 x 4 skins][hair]
//                   [skin and/or costume swatches][11 section ID emblems]
//   androids:       [25 skin blocks of 5][head blocks][swatches][11 emblems]
// The last 11 entries are the section ID emblems (Viridia .. Whitill, then an
// empty ring); body texture id 0 is always the emblem.
// Known gaps: per-style hair/cap texture lists of the hat-wearing classes
// (RAmar, FOmarl, FOnewm, FOnewearl, FOmar, RAmarl), parts of the FOmar and
// RAmarl body lists, and the non-default android heads are best guesses
// (the default appearance of all 12 classes looks right).

import * as THREE from 'three';
import { AFSArchive } from '../formats/archives.ts';
import { BmlArchive } from '../formats/bml.ts';
import { parseNinjaChunkFile, type NjcmObject } from '../formats/njcm.ts';
import { parseXvr } from '../formats/xvm.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import { NjcmModelBuilder, type NjcmModel, type NjcmPartInput } from './njcmmesh.ts';

export const CLASS_NAMES = [
  'HUmar', 'HUnewearl', 'HUcast', 'RAmar', 'RAcast', 'RAcaseal',
  'FOmarl', 'FOnewm', 'FOnewearl', 'HUcaseal', 'FOmar', 'RAmarl',
] as const;

export const SECTION_IDS = [
  'Viridia', 'Greenill', 'Skyly', 'Bluefull', 'Purplenum', 'Pinkal', 'Redria', 'Oran', 'Yellowboze', 'Whitill',
] as const;

// Body node the head, hair and cap hang from.
export const HEAD_NODE = 59;

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

// Appearance limits of BB (v3/v4 maxima from newserv's ClassMaxes).
export function appearanceLimits(charClass: number): { costume: number; skin: number; face: number; head: number; hair: number } {
  return isAndroid(charClass)
    ? { costume: 1, skin: 25, face: 1, head: 5, hair: 1 }
    : { costume: 18, skin: 4, face: 5, head: 1, hair: 10 };
}

export interface PlayerAssets {
  charClass: number;
  letter: string;
  parts: Map<string, NjcmObject>; // by entry name, e.g. "plAbdy00.nj"
  textures: (THREE.Texture | null)[]; // one per pl<L>tex.afs entry, decoded lazily
  textureCount: number;
  textureData: AFSArchive;
}

export function parsePlayerAssets(charClass: number, bmlData: Uint8Array, afsData: Uint8Array): PlayerAssets {
  const letter = classLetter(charClass);
  const bml = new BmlArchive(bmlData);
  const parts = new Map<string, NjcmObject>();
  for (const e of bml.entries) {
    const f = parseNinjaChunkFile(bml.get(e.name));
    if (f.object) parts.set(e.name, f.object);
  }
  const afs = new AFSArchive(afsData);
  return { charClass, letter, parts, textures: new Array(afs.entries.length).fill(null), textureCount: afs.entries.length, textureData: afs };
}

export async function loadPlayerAssets(files: ClientFiles, charClass: number): Promise<PlayerAssets> {
  const letter = classLetter(charClass);
  // Loose files in data/ (not in data.gsl).
  const [bml, afs] = await Promise.all([files.read(`pl${letter}nj.bml`), files.read(`pl${letter}tex.afs`)]);
  return parsePlayerAssets(charClass, bml, afs);
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

interface TexLists {
  body: number[];
  head: number[];
  hair: number[]; // shared by hai<NN> and cap<NN>
}

// Texture ids a part uses, sorted.
function usedIds(obj: NjcmObject | undefined, out = new Set<number>()): Set<number> {
  if (!obj) return out;
  for (const p of obj.model?.polys ?? []) if (p.op === 'texture') out.add(p.id);
  for (const c of obj.children) usedIds(c, out);
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// Human/newman layout parameters (see the header comment).
interface HumanLayout {
  costumeBase: (costume: number) => number; // first entry of a costume block
  // Body ids 1.. as offsets: 'c+N' costume block entry, 'cs+N' costume block
  // entry N + 3*skin, 'cs1+N' entry N + skin, 'cs2+N' entry N + 2*skin,
  // 'skin+B' entry B + skin, 'cos+B' entry B + costume, 'fix+B' entry B.
  body: string[];
  // Head ids: 'face+B' B + 4*face + skin, 'ear+B' B + skin,
  // 'pair+B' B + 2*(4*face + skin) (+1 for the ear, given as 'pair1+B').
  head: string[];
  hairBase: number;
  capBase: number; // offset of cap textures inside a costume block (-1: none)
}

const HUMAN_LAYOUTS: Record<number, HumanLayout> = {
  0: { costumeBase: (c) => c * 3, body: ['c+0', 'c+1', 'c+2', 'cos+108'], head: ['pair+54', 'pair1+54'], hairBase: 94, capBase: -1 },
  1: {
    costumeBase: (c) => 1 + c * 13,
    body: ['cs+1', 'cs+2', 'cs+0', 'c+12', 'skin+277', 'cos+281', 'fix+0'],
    head: ['ear+235', 'face+239'],
    hairBase: 259,
    capBase: -1,
  },
  3: { costumeBase: (c) => c * 7, body: ['c+4', 'c+5', 'c+6', 'cos+179'], head: ['pair+126', 'pair1+126'], hairBase: 166, capBase: 0 },
  6: { costumeBase: (c) => c * 16, body: ['c+1', 'c+2', 'c+0', 'skin+322'], head: ['face+288'], hairBase: 308, capBase: 3 },
  7: { costumeBase: (c) => c * 17, body: ['c+4', 'c+5', 'cs1+0', 'c+6'], head: ['ear+306', 'face+310'], hairBase: 330, capBase: 7 },
  8: { costumeBase: (c) => c * 26, body: ['cs+1', 'cs+2', 'skin+501', 'cs+0'], head: ['face+472', 'ear+468'], hairBase: 492, capBase: 12 },
  10: {
    costumeBase: (c) => (c === 0 ? 0 : 17 + (c - 1) * 15),
    body: ['c+4', 'c+5', 'c+6', 'cs1+0'],
    head: ['face+276', 'ear+272'],
    hairBase: 296,
    capBase: 7,
  },
  11: { costumeBase: (c) => c * 16, body: ['cs2+0', 'cs2+1', 'c+8'], head: ['face+288'], hairBase: 308, capBase: 9 },
};

function humanTexLists(assets: PlayerAssets, a: PlayerAppearance, emblem: number): TexLists {
  const L = HUMAN_LAYOUTS[assets.charClass];
  const cb = L.costumeBase(a.costume);
  const slot = (spec: string): number => {
    const [kind, n] = spec.split('+');
    const v = Number(n);
    switch (kind) {
      case 'c': return cb + v;
      case 'cs': return cb + v + 3 * a.skin;
      case 'cs1': return cb + v + a.skin;
      case 'cs2': return cb + v + 2 * a.skin;
      case 'skin': return v + a.skin;
      case 'cos': return v + a.costume;
      case 'fix': return v;
      case 'face': return v + 4 * a.face + a.skin;
      case 'ear': return v + a.skin;
      case 'pair': return v + 2 * (4 * a.face + a.skin);
      case 'pair1': return v + 2 * (4 * a.face + a.skin) + 1;
      default: throw new Error(`bad texture slot ${spec}`);
    }
  };
  // Hair: each style takes the next run of hair textures (ids used by its
  // hair model); ids only used by the cap come from the costume block.
  let hairCursor = L.hairBase;
  let capCursor = L.capBase;
  let hair: number[] = [];
  for (let s = 0; s <= a.hair; s++) {
    const hai = usedIds(assets.parts.get(`pl${assets.letter}hai${pad2(s)}.nj`));
    const cap = usedIds(assets.parts.get(`pl${assets.letter}cap${pad2(s)}.nj`));
    const list: number[] = [];
    const ids = [...new Set([...hai, ...cap])].sort((x, y) => x - y);
    for (const id of ids) {
      if (hai.has(id) || L.capBase < 0) list[id] = hairCursor++;
      else list[id] = cb + capCursor++;
    }
    hair = list;
  }
  return { body: [emblem, ...L.body.map(slot)], head: L.head.map(slot), hair };
}

// Android layouts: 25 skin blocks of 5 at 0, then one group of 25 entries
// (times the number of textures it holds) per head model.
interface AndroidLayout {
  body: number[]; // body ids 1.. as offsets into the skin block
  // Per head model: texture ids as [group base, textures per skin, index] or
  // ['block', offset] for an entry of the skin block.
  heads: (readonly [number, number, number] | readonly ['block', number])[][];
}

const ANDROID_LAYOUTS: Record<number, AndroidLayout> = {
  2: {
    body: [0, 1, 2, -250],
    heads: [[['block', 3], ['block', 4]], [[125, 2, 0], [125, 2, 1]], [[175, 1, 0]], [[200, 1, 0]], [[225, 1, 0]]],
  },
  4: {
    body: [1, 2, 3, -275, 0],
    heads: [[['block', 4]], [[125, 2, 0], [125, 2, 1]], [[175, 1, 0]], [[200, 2, 0], [200, 2, 1]], [[250, 1, 0]]],
  },
  5: {
    body: [0, 1, 2, -350],
    heads: [
      [['block', 3], ['block', 4]],
      [[125, 3, 0], [125, 3, 1], [125, 3, 2]],
      [[200, 2, 0], [200, 2, 1]],
      [[250, 2, 0], [250, 2, 1]],
      [[300, 2, 0], [300, 2, 1]],
    ],
  },
  9: {
    body: [0, 1, 2],
    heads: [
      [['block', 3], ['block', 4]],
      [[125, 2, 0], [125, 2, 1]],
      [[175, 2, 0], [175, 2, 1]],
      [[225, 3, 0], [225, 3, 1], [225, 3, 2]],
      [[300, 3, 0], [300, 3, 1], [300, 3, 2]],
    ],
  },
};

function androidTexLists(assets: PlayerAssets, a: PlayerAppearance, emblem: number): TexLists {
  const L = ANDROID_LAYOUTS[assets.charClass];
  const block = 5 * a.skin;
  // Negative body offsets are swatch groups: -B = entry B + skin.
  const body = [emblem, ...L.body.map((o) => (o < 0 ? -o + a.skin : block + o))];
  const head = (L.heads[a.head] ?? L.heads[0]).map((s) => (s[0] === 'block' ? block + s[1] : s[0] + s[1] * a.skin + s[2]));
  return { body, head, hair: [] };
}

export function playerTextureLists(assets: PlayerAssets, a: PlayerAppearance): TexLists {
  const emblem = assets.textureCount - 11 + (a.sectionId >= 0 && a.sectionId < 10 ? a.sectionId : 10);
  return isAndroid(assets.charClass) ? androidTexLists(assets, a, emblem) : humanTexLists(assets, a, emblem);
}

// ---------------------------------------------------------------------------
// Model assembly

export interface PlayerModel extends NjcmModel {
  parts: string[];
}

export function clampAppearance(charClass: number, a: PlayerAppearance): PlayerAppearance {
  const m = appearanceLimits(charClass);
  const wrap = (v: number, n: number) => ((Math.trunc(v) % n) + n) % n;
  return { ...a, costume: wrap(a.costume, m.costume), skin: wrap(a.skin, m.skin), face: wrap(a.face, m.face), head: wrap(a.head, m.head), hair: wrap(a.hair, m.hair) };
}

export function buildPlayerModel(assets: PlayerAssets, appearance: PlayerAppearance = DEFAULT_APPEARANCE): PlayerModel {
  const a = clampAppearance(assets.charClass, appearance);
  const L = assets.letter;
  const lists = playerTextureLists(assets, a);
  const lookup = (list: number[]) => (id: number) => (list[id] !== undefined ? texture(assets, list[id]) : null);
  const part = (name: string) => {
    const p = assets.parts.get(name);
    if (!p) throw new Error(`${name} missing from pl${L}nj.bml`);
    return p;
  };
  const inputs: NjcmPartInput[] = [{ name: `pl${L}bdy00.nj`, root: part(`pl${L}bdy00.nj`), textures: lookup(lists.body) }];
  const head = isAndroid(assets.charClass) ? `pl${L}hed${pad2(a.head)}.nj` : `pl${L}hed00.nj`;
  inputs.push({ name: head, root: part(head), textures: lookup(lists.head), attachTo: HEAD_NODE });
  if (!isAndroid(assets.charClass)) {
    const hair = `pl${L}hai${pad2(a.hair)}.nj`;
    const hairColor = new THREE.Color().setRGB(a.hairR / 255, a.hairG / 255, a.hairB / 255, THREE.SRGBColorSpace);
    if (assets.parts.has(hair)) inputs.push({ name: hair, root: part(hair), textures: lookup(lists.hair), attachTo: HEAD_NODE, diffuse: hairColor });
    const cap = `pl${L}cap${pad2(a.hair)}.nj`;
    if (assets.parts.has(cap)) inputs.push({ name: cap, root: part(cap), textures: lookup(lists.hair), attachTo: HEAD_NODE });
  }
  const model = new NjcmModelBuilder().build(inputs);
  return { ...model, parts: inputs.map((p) => p.name) };
}

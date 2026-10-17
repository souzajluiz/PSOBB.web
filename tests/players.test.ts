// Parses every player model part of the 12 classes (pl<L>nj.bml), checks
// every pl<L>tex.afs texture decodes, and builds the assembled model for each
// costume/skin/face/head/hair variant, then checks the table-driven texture
// lists and the proportion shapes (plZsmpnj.afs).
// Run: node web/tests/players.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AFSArchive } from '../client/src/formats/archives.ts';
import { parseNinjaChunkFile, type NjcmObject } from '../client/src/formats/njcm.ts';
import { parseXvr } from '../client/src/formats/xvm.ts';
import {
  appearanceLimits,
  buildPlayerModel,
  clampAppearance,
  CLASS_NAMES,
  classLetter,
  DEFAULT_APPEARANCE,
  isAndroid,
  morphTargetEntry,
  parsePlayerAssets,
  playerTextureLists,
  playerTextureNames,
  proportionMorph,
  type PlayerAppearance,
} from '../client/src/render/playermodel.ts';
import { PLAYER_CLASS_TABLES } from '../client/src/render/playertables.ts';

const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`FAIL ${msg}`);
};

for (let cls = 0; cls < 12; cls++) {
  const L = classLetter(cls);
  const name = `${CLASS_NAMES[cls]} (pl${L})`;
  try {
    const assets = parsePlayerAssets(cls, new Uint8Array(readFileSync(join(DATA, `pl${L}nj.bml`))), new Uint8Array(readFileSync(join(DATA, `pl${L}tex.afs`))));
    for (let i = 0; i < assets.textureCount; i++) {
      const t = parseXvr(assets.textureData.get(i), i);
      if (t.rgba.length !== t.width * t.height * 4) fail(`${name}: texture ${i} has a bad size`);
    }
    const lim = appearanceLimits(cls);
    // Every value of each appearance field, the others at their defaults.
    const variants: PlayerAppearance[] = [DEFAULT_APPEARANCE];
    for (const key of ['costume', 'skin', 'face', 'head', 'hair'] as const) {
      for (let v = 1; v < lim[key]; v++) variants.push({ ...DEFAULT_APPEARANCE, [key]: v });
    }
    let built = 0;
    let first = '';
    for (const a of variants) {
      const lists = playerTextureLists(assets, a);
      for (const [part, list] of Object.entries(lists)) {
        for (const idx of list) if (idx !== undefined && (idx < 0 || idx >= assets.textureCount)) fail(`${name} ${JSON.stringify(a)}: ${part} texture ${idx} out of range`);
      }
      const m = buildPlayerModel(assets, a);
      if (!m.stats.triangles) fail(`${name}: no triangles for ${JSON.stringify(a)}`);
      if (m.stats.unresolvedVertices) fail(`${name}: ${m.stats.unresolvedVertices} strip vertices reference unwritten buffer slots for ${JSON.stringify(a)}`);
      if (m.stats.missingTextures) fail(`${name}: ${m.stats.missingTextures} missing textures for ${JSON.stringify(a)}`);
      if (!first) first = `${m.parts.length} parts, ${m.stats.bones} bones, ${m.stats.vertices} vertices, ${m.stats.triangles} triangles, ${m.stats.materials} materials`;
      built++;
    }
    console.log(`${name}: ${assets.parts.size} models, ${assets.textureCount} textures; default: ${first}; ${built} variants built`);
  } catch (e) {
    fail(`${name}: ${(e as Error).stack}`);
  }
}
// Texture lists come from the class tables of PsoBB.exe (playertables.ts):
// every name the substitution rules produce must exist in the class's name
// table, and every texture id a part uses must be inside its list.
const usedIds = (o: NjcmObject | undefined, out = new Set<number>()): Set<number> => {
  if (!o) return out;
  for (const p of o.model?.polys ?? []) if (p.op === 'texture') out.add(p.id);
  for (const c of o.children) usedIds(c, out);
  return out;
};
const pad2 = (n: number) => String(n).padStart(2, '0');
const smpData = new Uint8Array(readFileSync(join(DATA, 'plZsmpnj.afs')));
const smp = new AFSArchive(smpData);
const flat = (o: NjcmObject, out: NjcmObject[] = []): NjcmObject[] => {
  out.push(o);
  for (const c of o.children) flat(c, out);
  return out;
};
for (let cls = 0; cls < 12; cls++) {
  const L = classLetter(cls);
  const name = `${CLASS_NAMES[cls]} (pl${L})`;
  const t = PLAYER_CLASS_TABLES[cls];
  const assets = parsePlayerAssets(cls, new Uint8Array(readFileSync(join(DATA, `pl${L}nj.bml`))), new Uint8Array(readFileSync(join(DATA, `pl${L}tex.afs`))), smpData);
  if (t.names.length !== assets.textureCount) fail(`${name}: ${t.names.length} texture names for ${assets.textureCount} pl${L}tex.afs entries`);
  const known = new Set(t.names.map((n) => 'pxt' + n));
  const lim = appearanceLimits(cls);
  let checked = 0;
  for (let costume = 0; costume < lim.costume; costume++)
    for (let skin = 0; skin < lim.skin; skin++)
      for (let face = 0; face < lim.face; face++)
        for (let sectionId = -1; sectionId < 10; sectionId++) {
          const n = playerTextureNames(cls, { ...DEFAULT_APPEARANCE, costume, skin, face, sectionId });
          for (const x of [...n.body, ...n.head, ...n.hair]) if (!known.has(x)) fail(`${name}: texture name ${x} not in the table`);
          checked++;
        }
  for (let head = 0; head < lim.head; head++) {
    const part = isAndroid(cls) ? `pl${L}hed${pad2(head)}.nj` : `pl${L}hed00.nj`;
    const n = t.head[head].length;
    for (const id of usedIds(assets.parts.get(part))) if (id >= n) fail(`${name}: ${part} uses texture ${id}, head list ${head} has ${n}`);
  }
  for (let hair = 0; hair < lim.hair && t.hair; hair++) {
    const n = t.hair[hair].length;
    for (const p of [`pl${L}hai${pad2(hair)}.nj`, `pl${L}cap${pad2(hair)}.nj`])
      for (const id of usedIds(assets.parts.get(p))) if (id >= n) fail(`${name}: ${p} uses texture ${id}, hair list ${hair} has ${n}`);
  }
  for (const id of usedIds(assets.parts.get(`pl${L}bdy00.nj`))) if (id >= t.body.length) fail(`${name}: body uses texture ${id}, list has ${t.body.length}`);
  // Every proportion shape has the node and vertex chunk layout of the part
  // it is blended into.
  for (let shape = 0; shape < 7; shape++) {
    for (let head = 0; head < lim.head; head++) {
      for (const [p, base] of [
        ['body', `pl${L}bdy00.nj`],
        ['head', isAndroid(cls) ? `pl${L}hed${pad2(head)}.nj` : `pl${L}hed00.nj`],
      ] as const) {
        const s = parseNinjaChunkFile(smp.get(morphTargetEntry(cls, shape, head, p))).object!;
        const a = flat(assets.parts.get(base)!);
        const b = flat(s);
        if (a.length !== b.length) fail(`${name}: shape ${shape} ${p}: ${b.length} nodes, ${base} has ${a.length}`);
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
          const va = a[i].model?.vertices ?? [];
          const vb = b[i].model?.vertices ?? [];
          if (va.length !== vb.length || va.some((v, k) => v.type !== vb[k].type || v.positions.length !== vb[k].positions.length))
            fail(`${name}: shape ${shape} ${p} node ${i}: vertex chunks differ from ${base}`);
        }
      }
    }
  }
  // Proportions: the extremes and the middle of every triangle build.
  for (const [x, y] of [[0, 0], [0.99, 0], [0, 0.99], [0.99, 0.99], [1 / 3, 0.5], [0.5, 0.25], [0.8, 0.9], [0.1, 0.8]]) {
    const m = buildPlayerModel(assets, { ...DEFAULT_APPEARANCE, proportionX: x, proportionY: y });
    if (!m.stats.triangles || m.stats.unresolvedVertices) fail(`${name}: proportions (${x}, ${y}) build failed`);
  }
  console.log(`${name}: ${checked} texture name sets resolved; proportion shapes match`);
}

// Spot checks of table-driven selections (names from PsoBB.exe).
const eq = (what: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
// RAmar hair 0 with costume 3: the cap texture follows the costume.
eq('RAmar hair 0 costume 3', playerTextureNames(3, { ...DEFAULT_APPEARANCE, costume: 3, hair: 0 }).hair, ['pxtDh_01z_w_kami1', 'pxtDh_01z_w_kami2', 'pxtDb_04z_w_hg1']);
// FOmar default body: core (Viridia), costume 1 top/bottom/coat, hands.
eq('FOmar body', playerTextureNames(10, DEFAULT_APPEARANCE).body, ['pxtZc_01a_t_core', 'pxtKb_01z_t_fuku1', 'pxtKb_01z_t_fuku2', 'pxtKb_01z_t_fuku3', 'pxtKb_01a_t_te']);
// RAmarl body, skin 2, section Whitill.
eq('RAmarl body', playerTextureNames(11, { ...DEFAULT_APPEARANCE, skin: 2, sectionId: 9 }).body, ['pxtZc_01j_t_core', 'pxtLb_01z_t_kosi', 'pxtLb_01c_t_fuku2', 'pxtLb_01c_t_fuku1']);
// HUmar face 3, skin 1.
eq('HUmar head', playerTextureNames(0, { ...DEFAULT_APPEARANCE, face: 3, skin: 1 }).head, ['pxtAf_04b_w_kao1', 'pxtAf_04b_w_kao2']);
// RAcaseal head 3, skin 24 (letter y).
eq('RAcaseal head', playerTextureNames(5, { ...DEFAULT_APPEARANCE, head: 3, skin: 24 }).head, ['pxtFb_04y_w_kami1', 'pxtFb_04y_w_kao1']);
// Out-of-range values reset to 0 (FUN_004e665c), not wrapped.
eq('clamp', clampAppearance(0, { ...DEFAULT_APPEARANCE, costume: 18, skin: -1, hair: 3, proportionX: 1, proportionY: 0.5 }), { ...DEFAULT_APPEARANCE, hair: 3 });
// Proportion triangles and weights.
eq('proportions (0,0)', proportionMorph(0, 0), { shapes: [1, 3, 0], weights: [0, 0, 1] });
eq('proportions (1/3,1/2)', proportionMorph(Math.fround(1 / 3), 0.5).weights.map((w) => Math.round(w * 1e6) / 1e6), [0, 1, 0]);
eq('proportions (0.9,0.1) triangle', proportionMorph(0.9, 0.1).shapes, [0, 4, 2]);
const pm = proportionMorph(0.5, 0.25);
if (Math.abs(pm.weights[0] + pm.weights[1] + pm.weights[2] - 1) > 1e-6 || pm.weights.some((w) => w < -1e-6)) fail(`proportion weights ${pm.weights}`);

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

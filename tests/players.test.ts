// Parses every player model part of the 12 classes (pl<L>nj.bml), checks
// every pl<L>tex.afs texture decodes, and builds the assembled model for each
// costume/skin/face/head/hair variant.
// Run: node web/tests/players.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseXvr } from '../client/src/formats/xvm.ts';
import {
  appearanceLimits,
  buildPlayerModel,
  CLASS_NAMES,
  classLetter,
  DEFAULT_APPEARANCE,
  parsePlayerAssets,
  playerTextureLists,
  type PlayerAppearance,
} from '../client/src/render/playermodel.ts';

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
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

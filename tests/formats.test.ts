// Parses every map n.rel and every XVM in the user's client data/scene folder.
// Run: node web/tests/formats.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMapNRel } from '../client/src/formats/nrel.ts';
import { parseXvm } from '../client/src/formats/xvm.ts';
import type { NjObject } from '../client/src/formats/xj.ts';

const SCENE = join(process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data'), 'scene');
let failures = 0;

const countModels = (o: NjObject): number => (o.model ? 1 : 0) + o.children.reduce((n, c) => n + countModels(c), 0);

let maps = 0, models = 0, skipped = 0;
for (const f of readdirSync(SCENE).filter((f) => /^map_.*n\.rel$/.test(f))) {
  try {
    const g = parseMapNRel(new Uint8Array(readFileSync(join(SCENE, f))));
    maps++;
    skipped += g.skippedEntries.length;
    models += g.sections.reduce((n, s) => n + s.objects.reduce((m, o) => m + countModels(o), 0), 0);
  } catch (e) {
    failures++;
    console.log(`FAIL ${f}: ${(e as Error).message}`);
  }
}
console.log(`n.rel: ${maps} maps parsed, ${models} models, ${skipped} unknown entries skipped`);

let xvms = 0, textures = 0;
for (const f of readdirSync(SCENE).filter((f) => f.endsWith('.xvm'))) {
  try {
    const t = parseXvm(new Uint8Array(readFileSync(join(SCENE, f))));
    xvms++;
    textures += t.length;
    for (const x of t) if (x.rgba.length !== x.width * x.height * 4) throw new Error(`bad size in texture ${x.index}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${f}: ${(e as Error).message}`);
  }
}
console.log(`xvm: ${xvms} archives, ${textures} textures`);
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

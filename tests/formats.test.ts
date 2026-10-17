// Parses every map n.rel and every XVM in the user's client data/scene folder.
// Run: node web/tests/formats.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMapNRel } from '../client/src/formats/nrel.ts';
import { parseXvm } from '../client/src/formats/xvm.ts';
import type { NjObject } from '../client/src/formats/xj.ts';
import { ENTRY_INDIRECT } from '../client/src/formats/nrel.ts';

const SCENE = join(process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data'), 'scene');
let failures = 0;

const countModels = (o: NjObject): number => (o.model ? 1 : 0) + o.children.reduce((n, c) => n + countModels(c), 0);

const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

let maps = 0, models = 0, skipped = 0, indirect = 0, hidden = 0, motions = 0;
const addressModes = new Set<number>();
const collectModes = (o: NjObject) => {
  for (const s of o.model?.strips ?? []) addressModes.add(s.material.addressU).add(s.material.addressV);
  o.children.forEach(collectModes);
};
for (const f of readdirSync(SCENE).filter((f) => /^map_.*n\.rel$/.test(f))) {
  try {
    const g = parseMapNRel(new Uint8Array(readFileSync(join(SCENE, f))));
    maps++;
    skipped += g.skippedEntries.length;
    for (const e of g.skippedEntries) console.log(`FAIL ${f} section ${e.section} entry ${e.entry}: ${e.error}`);
    models += g.sections.reduce((n, s) => n + s.objects.reduce((m, o) => m + countModels(o), 0), 0);
    for (const s of g.sections) {
      for (const e of s.entries) {
        if (e.flags & ENTRY_INDIRECT) indirect++;
        if (!e.rendered) hidden++;
        if (e.motion) {
          motions++;
          if (e.motion.frameCount < 1 || !e.motion.nodes.length) throw new Error(`empty motion in section ${s.id}`);
        }
      }
      s.objects.forEach(collectModes);
    }
  } catch (e) {
    failures++;
    console.log(`FAIL ${f}: ${(e as Error).message}`);
  }
}
check(skipped === 0, `${skipped} n.rel entries skipped`);
check([...addressModes].every((m) => m >= 0 && m <= 3), `unexpected texture address modes ${[...addressModes]}`);
console.log(`n.rel: ${maps} maps parsed, ${models} models, ${indirect} indirect entries, ${hidden} entries not drawn by the PC client, ${motions} motions, ${skipped} skipped`);

// map_jungle07_00n.rel section 0, static entries 108/109 (flags 0x10224): indirect
// objects resolving to real models with i.bin ids 0x27 / 0x27.
{
  const g = parseMapNRel(new Uint8Array(readFileSync(join(SCENE, 'map_jungle07_00n.rel'))));
  const e = g.sections[0].entries.filter((x) => !x.animated && (x.index === 108 || x.index === 109));
  check(e.length === 2 && e.every((x) => x.flags === 0x10224 && x.rendered && x.indirectId === 0x27 && countModels(x.object) > 0 && x.effect !== null), 'jungle07 indirect entries');
}
// map_city00_00n.rel: the first animated entry spins about Y over 120 frames.
{
  const g = parseMapNRel(new Uint8Array(readFileSync(join(SCENE, 'map_city00_00n.rel'))));
  const m = g.sections[0].entries.find((x) => x.animated)?.motion;
  const rot = m?.nodes[0].rotation;
  check(!!m && m.frameCount === 120 && !!rot && rot.length === 5 && rot[4].frame === 119 && Math.abs(rot[4].value[1] - 2 * Math.PI) < 0.01, 'city00 animated entry motion');
}

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
// Texture animation files (.tam): every block must parse and reference sane values.
{
  const { parseTam } = await import('../client/src/formats/tam.ts');
  let files = 0, scrolls = 0, swaps = 0;
  for (const f of readdirSync(SCENE).filter((f) => f.endsWith('.tam'))) {
    const t = parseTam(new Uint8Array(readFileSync(join(SCENE, f))));
    files++;
    scrolls += t.scrolls.length;
    swaps += t.swaps.length;
    const bad = t.scrolls.some((s) => ![...s.scroll, ...s.speed].every(Number.isFinite)) || t.swaps.some((w) => w.steps.some((x) => x.frames < -1));
    if (bad) {
      failures++;
      console.log(`FAIL ${f}: bad tam values`);
    }
  }
  console.log(`tam: ${files} files, ${scrolls} UV scrolls, ${swaps} texture swaps`);
}
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

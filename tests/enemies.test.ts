// Enemy models: every enemy of every Episode 1/2/4 free-play floor (all
// SetDataTable variations, online and offline) resolves to a model archive
// that exists in the client, whose entries match the asset descriptor in
// PsoBB.exe, and whose model and idle motion parse (for every difficulty,
// both model detail levels and the seasonal events). Also builds every
// resolved enemy once with three.js and plays its motion.
//
// Run: node tests/enemies.test.ts
// Env: PSOBB_DATA (client data/ folder)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { ENEMY_ASSETS, enemyModelFor, NO_MODEL_TYPES, type EnemyModelContext, type EnemyModelSpec } from '../client/src/formats/enemymodels.ts';
import { floorToArea } from '../client/src/net/game.ts';
import { enemyKind, parseEnemySets, type EnemySet } from '../client/src/formats/setdata.ts';
import { floorFiles, freePlayVariations, parseSetDataTable } from '../client/src/formats/setdatatable.ts';
import { buildEnemy, EnemyArchive, texturesFromXvm } from '../client/src/render/enemymodel.ts';

const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
let failures = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failures++;
    if (failures < 60) console.log(`FAIL ${msg}`);
  }
};

const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
const loose = new Set(readdirSync(DATA));
// The client reads a loose file in data/ before data.gsl (data/clientfiles.ts).
const read = (name: string) => (loose.has(name) ? new Uint8Array(readFileSync(join(DATA, name))) : gsl.has(name) ? gsl.get(name) : null);

// 1. Every asset descriptor: the archive exists, has the descriptor's entry
//    count (the loader reads by position) and the descriptor's model names.
const archives = new Map<string, EnemyArchive>();
// Second archives an enemy loads (EnemyModelSpec.archives), loaded on demand.
const extraArchives = new Map<string, EnemyArchive | null>();
const extraArchive = (bml: string, models: number): EnemyArchive | null => {
  let a = extraArchives.get(bml);
  if (a === undefined) {
    const data = read(bml);
    check(!!data, `${bml}: missing`);
    a = data ? new EnemyArchive(bml, data, models) : null;
    check(!a || a.modelCount === models, `${bml}: ${a?.modelCount} models, descriptor ${models}`);
    extraArchives.set(bml, a);
  }
  return a;
};
const renamed: string[] = [];
for (const a of ENEMY_ASSETS) {
  for (const bml of [a.bml, a.ultimate, a.low].filter((n): n is string => !!n)) {
    const data = read(bml);
    check(!!data, `${bml}: missing`);
    if (!data) continue;
    try {
      const archive = new EnemyArchive(bml, data, a.models.length);
      archives.set(bml, archive);
      const names = archive.bml.entries.map((e) => e.name.toLowerCase());
      const expect = [...a.models, ...a.motions].map((n) => n.toLowerCase());
      // Same entry count. The names only document the archive (the loader
      // ignores them): model names differ between variants (lo_*.nj, *.gj ->
      // *.xj), and bm4_ps_ma_body.bml stores its motions in another order.
      check(names.length === expect.length, `${bml}: ${names.length} entries, descriptor ${expect.length}`);
      const motionNames = names.slice(a.models.length).sort().join();
      if (motionNames !== a.motions.map((m) => m.toLowerCase()).sort().join()) renamed.push(bml);
      if (bml === a.bml) a.models.forEach((m, i) => check(names[i] === m.toLowerCase().replace(/\.gj$/, '.xj'), `${bml}: model ${i} is ${names[i]}, descriptor ${m}`));
    } catch (err) {
      check(false, `${bml}: ${(err as Error).message}`);
    }
  }
}
console.log(`${archives.size} enemy archives match their PsoBB.exe descriptors (motion files named differently from the descriptor: ${renamed.join(', ') || 'none'})`);

// 2. Every free-play floor.
const contexts: Omit<EnemyModelContext, 'area' | 'episode'>[] = [];
for (const difficulty of [0, 1, 2, 3]) for (const lowModels of [false, true]) for (const event of [0, 1, 4, 5]) contexts.push({ difficulty, lowModels, event });
const external = new Map<string, ReturnType<typeof texturesFromXvm>>();
const built = new Set<string>();
const seen = new Map<string, number>();
let enemies = 0;
let floors = 0;
const tryBuild = (spec: EnemyModelSpec, what: string) => {
  const archive = archives.get(spec.bml);
  check(!!archive, `${what}: archive ${spec.bml} not loaded`);
  if (!archive) return;
  const key = `${spec.bml}|${JSON.stringify(spec.parts)}`;
  if (built.has(key)) return;
  built.add(key);
  try {
    for (const t of spec.textures ?? []) {
      if (external.has(t)) continue;
      const d = read(t);
      check(!!d, `${what}: texture archive ${t} missing`);
      if (d) external.set(t, texturesFromXvm(d));
    }
    const extra = new Map<string, EnemyArchive>();
    for (const a of spec.archives ?? []) {
      const loaded = extraArchive(a.bml, a.models);
      if (loaded) extra.set(a.bml, loaded);
    }
    for (const p of spec.parts) {
      const own = p.archive ? extra.get(p.archive) : archive;
      check(!!own, `${what}: archive ${p.archive} not in spec.archives`);
      if (!own) continue;
      check(p.model >= 0 && p.model < own.modelCount, `${what}: model ${p.model} of ${own.modelCount}`);
      if (p.texlistOf !== undefined) check(p.texlistOf >= 0 && p.texlistOf < own.modelCount, `${what}: texlistOf ${p.texlistOf} of ${own.modelCount}`);
      if (p.motion) check(p.motion.index >= 0 && p.motion.index < own.motionCount, `${what}: motion ${p.motion.index} of ${own.motionCount}`);
    }
    const b = buildEnemy(archive, spec.parts, 0, external, extra);
    check(b.triangles > 0, `${what}: no triangles`);
    check(b.missingTextures === 0, `${what}: ${b.missingTextures} missing textures`);
    for (const a of b.animators) for (let i = 0; i < 40; i++) a.update(1 / 30);
    check(b.animators.length === spec.parts.filter((p) => p.motion).length, `${what}: ${b.animators.length} animators`);
    // Children: every part gets its own group under the right root, and the
    // ones the client hides at spawn are not drawn.
    const worldParts = spec.parts.filter((p) => p.place === 'world');
    check(b.world.children.length === worldParts.length, `${what}: ${b.world.children.length} world children, ${worldParts.length} parts`);
    check(b.root.children.length === spec.parts.length - worldParts.length, `${what}: ${b.root.children.length} roots, ${spec.parts.length - worldParts.length} parts`);
    const hidden = [...b.root.children, ...b.world.children].filter((c) => !c.visible).length;
    check(hidden === spec.parts.filter((p) => p.hidden).length, `${what}: ${hidden} hidden groups`);
  } catch (err) {
    check(false, `${what}: ${(err as Error).message}`);
  }
};

for (const tname of ['SetDataTableOn.rel', 'SetDataTableOff.rel']) {
  const table = parseSetDataTable(read(tname)!);
  const solo = tname.includes('Off');
  for (const episode of [1, 2, 3]) {
    const areas = floorToArea(episode);
    for (let floor = 0; floor < 0x10; floor++) {
      const area = areas[floor];
      if (area < 0 || !table[area] || [0x0f, 0x10, 0x11, 0x2e].includes(area)) continue;
      const n = freePlayVariations(table, area, solo);
      for (let layout = 0; layout < n.layouts; layout++) {
        for (let v = 0; v < n.entities; v++) {
          const f = floorFiles(table, area, layout, v, floor, solo ? 'solo' : 'normal')!;
          const data = read(f.enemies);
          if (!data) continue;
          floors++;
          for (const e of parseEnemySets(data)) {
            const kind = enemyKind(e, area);
            if (kind === 'NON_ENEMY_NPC' || kind === 'UNKNOWN') continue; // NPCs; types the area's enemy table does not construct
            if (NO_MODEL_TYPES.has(e.type)) continue; // controllers that draw nothing (Dark Gunner control, Vol Opt)
            enemies++;
            for (const c of contexts) {
              const ctx = { ...c, area, episode };
              const what = `${f.enemies} #${e.index} ${kind} (type ${e.type.toString(16)}, diff ${c.difficulty}${c.lowModels ? ', low' : ''}, event ${c.event})`;
              const spec = enemyModelFor(e as EnemySet, ctx);
              check(!!spec, `${what}: no model`);
              if (!spec) continue;
              seen.set(`${kind} -> ${spec.bml}`, (seen.get(`${kind} -> ${spec.bml}`) ?? 0) + 1);
              tryBuild(spec, what);
            }
          }
        }
      }
    }
  }
}

for (const [k, n] of [...seen].sort()) console.log(`  ${k} (${n})`);
console.log(`${floors} floor variations, ${enemies} enemy entries, ${built.size} distinct models built`);
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

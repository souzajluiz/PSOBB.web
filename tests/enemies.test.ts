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
import { enemySlotCount } from '../client/src/formats/enemyids.ts';
import { expandEnemySets } from '../client/src/formats/enemyslots.ts';
import { buildEnemy, EnemyArchive, texturesFromXvm } from '../client/src/render/enemymodel.ts';
import { BELRA } from '../client/src/combat/enemyfsmruins.ts';
import { SPINNER_ANIMATIONS, SPINNER_COUNT, SPINNER_MOTION_NODES } from '../client/src/combat/saintmilion.ts';

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

// 3. Dark Belra's hand (BELRA.handNode): the origin of node 0x21 at motion 3 frame 30 and of
//    node 0x38 at motion 5 frame 29, read off the model like init_belra_global_config does.
for (const [bml, nodes] of [['bm_ene_re7_berura.bml', BELRA.handNode], ['bm_ene_re7_berura_a.bml', BELRA.handNodeUltimate]] as const) {
  const data = read(bml);
  check(!!data, `${bml}: missing`);
  if (!data) continue;
  const a = new EnemyArchive(bml, data, 3);
  [[3, 30], [5, 29]].forEach(([motion, frame], arm) => {
    const b = buildEnemy(a, [{ model: 0, motion: { index: motion, speed: 1, loop: false } }], 0, new Map(), new Map());
    b.animators[0].setFrame(frame);
    b.root.updateMatrixWorld(true);
    const node = b.partNodes[0][BELRA.armRootNode[arm]];
    const e = node.matrixWorld.elements;
    for (let k = 0; k < 3; k++) check(Math.abs(e[12 + k] - nodes[arm][k]) < 1e-3, `${bml}: arm ${arm} hand ${[e[12], e[13], e[14]]} vs ${nodes[arm]}`);
  });
}

// 4. Saint-Milion's tentacle archive: three 59-node models whose motions key the first 32 nodes
//    (motion 0: all 59), and the animation table points at motions that exist.
{
  const data = read('bm_ene_boss09_tentacle.bml');
  check(!!data, 'bm_ene_boss09_tentacle.bml: missing');
  if (data) {
    const a = new EnemyArchive('bm_ene_boss09_tentacle.bml', data, 3);
    for (let m = 0; m < a.motionCount; m++) {
      const nodes = m === 0 ? 59 : SPINNER_MOTION_NODES;
      try {
        const motion = a.motion(m, nodes);
        check(motion.nodes.length === nodes, `tentacle motion ${m}: ${motion.nodes.length} keyed nodes`);
      } catch (err) {
        check(false, `tentacle motion ${m}: ${(err as Error).message}`);
      }
    }
    for (const [i, an] of SPINNER_ANIMATIONS.entries()) check(an.motion < a.motionCount, `spinner animation ${i}: motion ${an.motion}`);
    // A 32-node motion plays on the 59-node tree (the other nodes keep their bind pose).
    for (const variant of [0, 1]) {
      const spec = enemyModelFor({ kind: 'enemy', type: 0x119, index: 0, numChildren: 0, section: 0, wave: 0, wave2: 0, unknownA1: 0, params: [0, 0, 0, 0, 0, variant, 0] } as unknown as EnemySet, { area: 0x2c, episode: 3, difficulty: 0, lowModels: false, event: 0 });
      const parts = spec?.parts.filter((p) => p.archive) ?? [];
      check(parts.length === SPINNER_COUNT && parts.every((p, i) => p.hidden && p.name === `spinner ${i}` && p.model === variant), `Saint-Milion variant ${variant}: ${parts.length} hidden spinner parts`);
      const part = { ...parts[0], motion: { index: 3, speed: 1, loop: true, nodes: SPINNER_MOTION_NODES } };
      const b = buildEnemy(a, [part], 0, new Map(), new Map([['bm_ene_boss09_tentacle.bml', a]]));
      for (let i = 0; i < 30; i++) b.animators[0].update(1 / 30);
      check(b.animators.length === 1 && b.partNodes[0].length === 59, 'a 32-node motion drives the 59-node tentacle');
    }
  }
}

// Type 0xe0 (Epsilon or Sinow Zoa / Zele) must resolve to the same enemy in the
// set name table (setdata.ts), the model (enemymodels.ts) and the Epsigard
// children (enemyids.ts, enemyslots.ts) for every area. The exe's per-area enemy
// table 0x009fba60 has a 0xe0 row only for area 0x23 (factory 0x00558530, ctor
// 0x005585ac, 4 children); area 0x22 has none, and 0x1c / 0x1d get Sinow Zoa.
{
  const ctx = { episode: 2, difficulty: 0, event: 0, lowModels: false };
  const e0 = { kind: 'enemy', type: 0xe0, index: 0, numChildren: 0, section: 0, wave: 0, wave2: 0, unknownA1: 0, params: [0, 0, 0, 0, 0, 0, 0] } as unknown as EnemySet;
  for (let area = 0; area <= 0x2e; area++) {
    const epsilon = enemyKind(e0, area) === 'EPSILON';
    const model = enemyModelFor(e0, { ...ctx, area })?.name === 'TObjEneEpsilonBody';
    const children = enemySlotCount(e0, area) === 5;
    check(epsilon === model, `area ${area.toString(16)}: setdata says EPSILON ${epsilon}, enemymodels says Epsilon ${model}`);
    check(epsilon === children, `area ${area.toString(16)}: EPSILON ${epsilon} but ${children ? '4' : 'no'} Epsigard children`);
    check(epsilon === (area === 0x23), `area ${area.toString(16)}: EPSILON ${epsilon}, exe table says only area 0x23`);
    check(expandEnemySets([e0], area).length === (epsilon ? 5 : 1), `area ${area.toString(16)}: expandEnemySets slot count for 0xe0`);
  }
}

// 5. Morfos (0xde): the descriptor's model_files are kabe_arm (0), kabe_body (1), kabe_wall (2)
//    (0x009bee9c; the exe's stream reads model_files[1] child = body, [2] = wall). The body is
//    built with the wait motion, the wall static, the arm its own (ownMotion, hidden until the
//    punch). The stream shifts texture 2 of the body and texture 0 of the wall: those parts
//    carry a UV offset handle, and it is zero at build.
{
  const data = read('bm_ene_morfos.bml');
  check(!!data, 'bm_ene_morfos.bml: missing');
  if (data) {
    const a = new EnemyArchive('bm_ene_morfos.bml', data, 3);
    const e0 = { kind: 'enemy', type: 0xde, index: 0, numChildren: 0, section: 0, wave: 0, wave2: 0, unknownA1: 0, params: [0, 0, 0, 0, 0, 0, 0] } as unknown as EnemySet;
    const spec = enemyModelFor(e0, { area: 0x0e, episode: 2, difficulty: 0, event: 0 });
    check(spec?.parts.map((p) => p.model).join() === '1,2,0', `Morfos parts ${spec?.parts.map((p) => p.model).join()} (want 1,2,0)`);
    const b = buildEnemy(a, spec?.parts ?? [], 0, new Map(), new Map());
    const byName = (n: string) => b.root.children.find((c) => c.name === n);
    check(!!byName('Morfos body') && !!byName('Morfos wall') && !!byName('Morfos arm'), 'Morfos: body, wall and arm groups');
    check(byName('Morfos arm')?.visible === false, 'Morfos: the arm starts hidden');
    check(b.animators.length === 2 && b.animatedParts[1]?.ownMotion === true, 'Morfos: the arm has its own animator (ownMotion)');
    const uvBody = byName('Morfos body')?.userData.uvOffsets as Map<number, { x: number; y: number }> | undefined;
    const uvWall = byName('Morfos wall')?.userData.uvOffsets as Map<number, { x: number; y: number }> | undefined;
    check(!!uvBody?.get(2) && uvBody.get(2)!.x === 0 && uvBody.get(2)!.y === 0, 'Morfos: body texture 2 has a zero UV handle');
    check(!!uvWall?.get(0) && uvWall.get(0)!.x === 0 && uvWall.get(0)!.y === 0, 'Morfos: wall texture 0 has a zero UV handle');
    // The handle is the texture's offset: a driven texture repeats and reads it.
    const body = byName('Morfos body');
    let driven = 0;
    // three.js is not resolvable from tests/: duck-typed (RepeatWrapping = 1000).
    body?.traverse((o) => {
      const mesh = o as { isMesh?: boolean; material?: { map?: { offset: unknown; wrapS: number } | null } | { map?: { offset: unknown; wrapS: number } | null }[] };
      if (!mesh.isMesh || !mesh.material) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (mat.map && mat.map.offset === uvBody?.get(2) && mat.map.wrapS === 1000) driven++;
      }
    });
    check(driven > 0, 'Morfos: a body material uses the driven texture');
  }
}

for (const [k, n] of [...seen].sort()) console.log(`  ${k} (${n})`);
console.log(`${floors} floor variations, ${enemies} enemy entries, ${built.size} distinct models built`);
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);

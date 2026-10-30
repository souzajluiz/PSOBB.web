// Ninja shape motions (.njs, formats/njshape.ts) and their playback
// (render/shapeanim.ts), from PsoBB.exe and the Ephinea data.gsl:
//  1. key picking and blending as NJM_FindKeyframeInterval_0084ae50 /
//     NJM_InterpolateKeyframes_008474b8 do it (pure);
//  2. every .njs of data.gsl parses against a chunk model of its BML, its key
//     arrays exactly as long as the node's shaped vertices;
//  3. Vol Opt's seal door: fe_obj_fuuin_doa.njs layout, and the built door's
//     vertices following the keys at the node motion's frame.
//  4. The other six: the file each object / enemy part names, the speed and
//     wrap the exe's timer 0x0061347c gives it, and the shape advancing frame by
//     frame (jellyfish, Poison Plant, desert plants bohu and kogomi, the slime
//     body forms 7 and 8).
// Run: node tests/njshape.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as THREE from '../client/node_modules/three/build/three.module.js';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { BmlArchive } from '../client/src/formats/bml.ts';
import { parseNjsFile, sampleShapeKeys, type NjShapeKey } from '../client/src/formats/njshape.ts';
import { RelFile } from '../client/src/formats/rel.ts';
import { buildEnemy, EnemyArchive, shapeNodeInputs } from '../client/src/render/enemymodel.ts';
import { objectModelFor } from '../client/src/formats/objectmodels.ts';
import { enemyModelFor, type EnemyModelContext } from '../client/src/formats/enemymodels.ts';
import type { EnemySet, ObjectSet } from '../client/src/formats/setdata.ts';

const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
};
const near = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) <= eps;

// 1. Key picking.
{
  const key = (frame: number, v: number): NjShapeKey => ({ frame, values: new Float32Array([v, 2 * v, -v]) });
  const keys = [key(0, 0), key(10, 10), key(20, 40)];
  const out = new Float32Array(3);
  check(near(sampleShapeKeys(keys, 5, out)[0], 5) && near(out[1], 10) && near(out[2], -5), 'frame 5: halfway between keys 0 and 10');
  check(near(sampleShapeKeys(keys, 10, out)[0], 10), 'frame 10: key 10');
  check(near(sampleShapeKeys(keys, 15.5, out)[0], 10 + 30 * 0.55), 'frame 15.5: the float frame sets t, the integer frame the keys');
  // Past the last key B is the first key and t = frame - A (one frame to it).
  check(near(sampleShapeKeys(keys, 20.25, out)[0], 40 * 0.75), 'frame 20.25 past the last key: a quarter of the way back to key 0');
  check(near(sampleShapeKeys([key(0, 3)], 7.5, out)[0], 3), 'one key: its value at any frame');
  const odd = [key(0, 0), key(3, 3), key(4, 4), key(9, 9), key(12, 12)];
  let ok = true;
  for (let f = 0; f < 12; f += 0.5) {
    sampleShapeKeys(odd, f, out);
    if (!near(out[0], f)) ok = false;
  }
  check(ok, 'binary search over uneven keys: linear values come back linear');
}

// 2. Every .njs in data.gsl.
const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
const modelCount = (bml: BmlArchive) => {
  const first = bml.entries.findIndex((e) => /\.(njm|njs)$/i.test(e.name));
  return first < 0 ? bml.entries.length : first;
};
let files = 0;
for (const name of gsl.entries.keys()) {
  if (!/\.bml$/i.test(name)) continue;
  const data = gsl.get(name);
  const bml = new BmlArchive(data);
  const shapes = bml.entries.map((e, i) => ({ e, i })).filter(({ e }) => /\.njs$/i.test(e.name));
  if (!shapes.length) continue;
  const archive = new EnemyArchive(name, data, modelCount(bml));
  for (const { e, i } of shapes) {
    files++;
    const raw = RelFile.chunk(bml.get(e.name), 'NSSM')!;
    // The models whose shaped vertex counts make the key arrays tile exactly:
    // each key array ends where the next one (or the file's POF0) starts.
    const fits: number[] = [];
    for (let m = 0; m < archive.modelCount; m++) {
      if (archive.model(m).kind !== 'nj') continue;
      let shape;
      try {
        shape = archive.shapeMotion(i - archive.modelCount, m);
      } catch {
        continue;
      }
      const inputs = shapeNodeInputs(archive.model(m).object as Parameters<typeof shapeNodeInputs>[0]);
      if (shape.nodes.length !== inputs.length) continue;
      let ok = shape.nodes.some((n) => n?.vertices);
      const starts: number[] = [];
      shape.nodes.forEach((n) => {
        for (const keys of [n?.vertices, n?.normals]) if (keys) for (const k of keys) starts.push(k.values.length * 4);
      });
      // Total key data = the file's data after the records and key lists.
      const total = starts.reduce((a, b) => a + b, 0);
      const firstData = Math.min(...collectPointers(raw, shape.nodes.length, inputs.map((x) => x.flags)));
      if (!(firstData + total <= raw.data.length)) ok = false;
      if (ok && raw.data.length - (firstData + total) < 12) fits.push(m);
    }
    console.log(`  ${name} ${e.name}: model ${fits.join(', ') || '-'}`);
    check(fits.length >= 1, `${e.name}: key arrays tile the file for a model of ${name}`);
  }
}
check(files === 7, `7 shape motions in data.gsl (${files})`);

// Lowest key-array pointer of a shape motion (the key data follows the lists).
function collectPointers(rel: RelFile, nodes: number, flags: number[]): number[] {
  const factors = rel.u16(10) & 0x3f;
  const out: number[] = [];
  let rec = rel.u32(0);
  for (let n = 0; n < nodes; n++) {
    if (flags[n] & 0x80) continue;
    for (let i = 0; i < factors; i++) {
      const p = rel.u32(rec + i * 4);
      const c = rel.u32(rec + (factors + i) * 4);
      for (let k = 0; p && k < c; k++) out.push(rel.u32(p + k * 8 + 4));
    }
    rec += factors * 8;
  }
  return out;
}

// 3. Vol Opt's seal door.
{
  const name = 'bm_o_door_vo_ship.bml';
  const data = gsl.get(name);
  const archive = new EnemyArchive(name, data, 2);
  check(archive.motionName(1) === 'fe_obj_fuuin_doa.njs', `motion 1 is the .njs (${archive.motionName(1)})`);
  const shape = archive.shapeMotion(1, 1);
  check(shape.frameCount === 30 && shape.type === 0x30, `30 frames, type 0x30 (${shape.frameCount}, 0x${shape.type.toString(16)})`);
  check(shape.nodes.length === 2 && !shape.nodes[0]?.vertices && !shape.nodes[0]?.normals, 'two nodes, the root unshaped');
  const keys = shape.nodes[1]?.vertices ?? [];
  check(keys.map((k) => k.frame).join() === '0,7,14,21,29', `node 1 keys at frames ${keys.map((k) => k.frame).join()}`);
  check(keys.every((k) => k.values.length === 48 * 3) && !shape.nodes[1]?.normals, '48 vertices per key, no normal keys');
  check(parseNjsFile(archive.bml.get('fe_obj_fuuin_doa.njs'), shapeNodeInputs(archive.model(1).object as Parameters<typeof shapeNodeInputs>[0])).nodes.length === 2, 'parseNjsFile on the raw entry');

  const built = buildEnemy(archive, [{ model: 1, texlistOf: 1, motion: { index: 0, speed: 1, loop: true, shape: 1 } }]);
  const animator = built.animators[0];
  check(!!animator && !!animator.onFrame, 'the door animator drives the shape');
  let mesh: THREE.SkinnedMesh | null = null;
  built.root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  const pos = (mesh as unknown as THREE.SkinnedMesh).geometry.getAttribute('position') as THREE.BufferAttribute;
  // Node 1 is at the origin with unit transforms (flags 0x17), so its shaped
  // vertices are the key values themselves.
  const valuesAt = (frame: number) => {
    const out = new Float32Array(48 * 3);
    return sampleShapeKeys(keys, frame, out);
  };
  const matches = (frame: number) => {
    const want = valuesAt(frame);
    let hits = 0;
    for (let k = 0; k < pos.count; k++) {
      for (let j = 0; j < 48; j++) {
        if (near(pos.getX(k), want[j * 3], 1e-3) && near(pos.getY(k), want[j * 3 + 1], 1e-3) && near(pos.getZ(k), want[j * 3 + 2], 1e-3)) {
          hits++;
          break;
        }
      }
    }
    return hits;
  };
  animator.setFrame(7);
  const at7 = matches(7);
  animator.setFrame(18.5);
  const at18 = matches(18.5);
  const stale = matches(7);
  console.log(`  mesh vertices ${pos.count}: ${at7} match frame 7, ${at18} frame 18.5, ${stale} still frame 7 after moving on`);
  check(at7 > 48 && at18 >= at7, 'the shaped vertices follow the keys at the motion frame');
  check(stale < at18, 'and change with it');
}

// 4. Which file each object draws, and how its frame runs.
{
  const obj = (type: number, params: ObjectSet['params'] = [0, 0, 0, 0, 0, 0]): ObjectSet => ({ kind: 'object', index: 0, type, floor: 0, group: 0, section: 0, unknownA3: 0, position: [0, 0, 0], rotation: [0, 0, 0], params });
  const specOf = (type: number, params?: ObjectSet['params']) => objectModelFor(obj(type, params), { area: 0x0d, episode: 1 })!;
  // [type, params, bml, node motion, shape file, speed, the shaped model]
  const cases: [string, number, ObjectSet['params'], string, number, string, number, number][] = [
    ['TOKurage 0x00cc', 0xcc, [0, 0, 0, 0, 0, 0], 'bm_fs_obj_kurage.bml', 0, 'fs_obj_kurage.njs', 0.5, 0],
    ['Poison Plant 0x0380', 0x380, [0, 0, 0, 0, 0, 0], 'bm_obj_ep4_flower.bml', 0, 'bm_obj_ep4_flower.njs', 1, 0],
    ['bohu 0x0383 (model 0)', 0x383, [0.75, 2, 0, 0, 0, 0], 'bm_obj_ep4_bohu.bml', -1, 'bm_obj_ep4_bohu3.njs', 0.75, 0],
    ['bohu 0x0383 (param4 1: model 1)', 0x383, [0.5, 1, 0, 1, 0, 0], 'bm_obj_ep4_bohu.bml', -1, 'bm_obj_ep4_bohu3.njs', 0.5, 1],
    ['kogomi 0x038c', 0x38c, [2, 3, 0, 0, 0, 0], 'bm_obj_ep4_kogomi.bml', -1, 'kogome_bm_obj_ep4_kogomi.njs', 1, 0],
  ];
  for (const [what, type, params, bml, motion, njs, speed, model] of cases) {
    const spec = specOf(type, params);
    const part = spec.parts[0];
    const archive = new EnemyArchive(bml, gsl.get(bml), modelCount(new BmlArchive(gsl.get(bml))));
    check(spec.bml === bml && part.motion === motion && part.speed === speed && part.model === model, `${what}: ${bml}, node motion ${motion}, speed ${speed}, model ${model}`);
    check(part.shape !== undefined && archive.motionName(part.shape) === njs, `${what}: shape entry ${part.shape} is ${archive.motionName(part.shape ?? 0)}`);
    if (motion >= 0) check(/\.njm$/.test(archive.motionName(motion) ?? ''), `${what}: node motion ${motion} is an .njm (${archive.motionName(motion)})`);
    // The timer: frame += speed, past (frames - 1) subtract (frames - 1) ('loop-last').
    check(part.drive === 'loop-last' || what.startsWith('Poison'), `${what}: drive ${part.drive}`);

    const built = buildEnemy(archive, [{ model: part.model, motion: { index: part.motion ?? 0, speed: part.speed ?? 1, loop: true, shape: part.shape } }]);
    const a = built.animators[0];
    check(!!a && !!a.onFrame, `${what}: an animator drives the shape`);
    let mesh: THREE.SkinnedMesh | null = null;
    built.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    });
    const pos = (mesh as unknown as THREE.SkinnedMesh).geometry.getAttribute('position') as THREE.BufferAttribute;
    const snap = () => Array.from(pos.array as ArrayLike<number>).join(',');
    a.restart = 'carry-last';
    a.setFrame(0);
    const f0 = snap();
    // Two seconds of game ticks, the frame must have advanced by speed per tick and the vertices moved.
    a.update(1 / 30);
    const f1 = a.frame;
    for (let i = 0; i < 4; i++) a.update(1 / 30);
    check(near(f1, speed, 1e-6) && a.frame > f1, `${what}: the frame advances by ${speed} a tick (${f1}, then ${a.frame})`);
    check(snap() !== f0, `${what}: the shaped vertices changed with the frame`);
    // Past the last key frame count - 1 the frame wraps (carry-last).
    const last = a.frameCount - 1;
    a.setFrame(last - speed / 2);
    a.update(1 / 30);
    check(a.frame < last, `${what}: wraps after frame ${last} (${a.frame})`);
  }
  // The slime body, forms 7 and 8 (0x00599d0b rows at 0x009bfd60 + 12 * form: {njm, njs, speed}).
  const ctx: EnemyModelContext = { area: 0x02, episode: 1, difficulty: 0, event: 0 };
  const slime = enemyModelFor({ kind: 'enemy', type: 0x64, params: [0, 0, 0, 0, 0, 0, 0] } as unknown as EnemySet, ctx)!;
  const bml = 'bm4_ps_ma_body.bml';
  const archive = new EnemyArchive(bml, gsl.get(bml), 6);
  const want: [string, string, string, number][] = [
    ['Slime puddle', 'wait_bm4_ps_mb_body.njm', 'wait_bm4_ps_mb_body.njs', 0.7],
    ['Slime crawl', 'move_bm4_ps_mb_body.njm', 'move_bm4_ps_mb_body.njs', 0.8],
  ];
  for (const [name, njm, njs, speed] of want) {
    const part = slime.parts.find((p) => p.name === name);
    check(!!part && part.motion?.speed === speed && archive.motionName(part.motion.index) === njm && archive.motionName(part.motion.shape ?? -1) === njs, `${name}: ${njm} + ${njs} at ${speed}`);
    check(part?.model === 4, `${name}: model 4 (bm4_ps_mb_body)`);
    const built = buildEnemy(archive, [part!]);
    const a = built.animators[0];
    a.setFrame(0);
    let mesh: THREE.SkinnedMesh | null = null;
    built.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    });
    const pos = (mesh as unknown as THREE.SkinnedMesh).geometry.getAttribute('position') as THREE.BufferAttribute;
    const f0 = Array.from(pos.array as ArrayLike<number>).join(',');
    a.update(1 / 30);
    for (let i = 0; i < 6; i++) a.update(1 / 30);
    check(near(a.frame, speed * 7, 1e-5), `${name}: frame ${a.frame.toFixed(2)} after 7 ticks`);
    check(Array.from(pos.array as ArrayLike<number>).join(',') !== f0, `${name}: the shaped vertices follow the frame`);
  }
  const rare = enemyModelFor({ kind: 'enemy', type: 0x64, params: [0, 0, 0, 0, 0, 1, 0] } as unknown as EnemySet, ctx)!;
  check(rare.parts.find((p) => p.name === 'Slime crawl')?.model === 5, 'rare slime: model 5 (bm4_ps_mbr_body)');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('all passed');

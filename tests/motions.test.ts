// Decodes every player motion of plymotiondata.rlc (data.gsl), checks the
// town motion tables taken from PsoBB.exe point at valid entries, and plays
// the idle / walk / run motions of every class on its model.
// Run: node web/tests/motions.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { sampleKeys } from '../client/src/formats/njmotion.ts';
import {
  locomotionSlot,
  LOCOMOTION_FACTOR,
  MOTION_TYPE,
  PLAYER_MOTION_FILE,
  PLAYER_MOTION_NODES,
  PlayerMotions,
  TOWN_SLOTS,
  townMotion,
} from '../client/src/formats/plymotion.ts';
import { PlayerAnimator } from '../client/src/render/playeranim.ts';
import { buildPlayerModel, CLASS_NAMES, classLetter, DEFAULT_APPEARANCE, parsePlayerAssets } from '../client/src/render/playermodel.ts';

const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`FAIL ${msg}`);
};

const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
const motions = new PlayerMotions(gsl.get(PLAYER_MOTION_FILE));
console.log(`${PLAYER_MOTION_FILE}: ${motions.count} entries`);

// 1. Every entry decodes: 64 nodes, increasing key frames inside the motion,
//    angles within a 16-bit BAMS turn, finite positions.
let keys = 0;
const frameCounts = new Map<number, number>();
for (let i = 0; i < motions.count; i++) {
  try {
    const m = motions.get(i);
    if (m.nodes.length !== PLAYER_MOTION_NODES) fail(`entry ${i}: ${m.nodes.length} nodes`);
    if (m.type !== 3 || m.spline) fail(`entry ${i}: type 0x${m.type.toString(16)} spline ${m.spline}`);
    if (m.frameCount < 1) fail(`entry ${i}: frame count ${m.frameCount}`);
    frameCounts.set(m.frameCount, (frameCounts.get(m.frameCount) ?? 0) + 1);
    let animated = 0;
    m.nodes.forEach((n, k) => {
      for (const [what, list] of [['pos', n.position], ['ang', n.rotation]] as const) {
        if (!list) continue;
        animated++;
        keys += list.length;
        let prev = -1;
        for (const key of list) {
          if (key.frame <= prev || key.frame >= m.frameCount) fail(`entry ${i} node ${k} ${what}: key frame ${key.frame} after ${prev} (frames ${m.frameCount})`);
          prev = key.frame;
          for (const v of key.value) {
            if (!Number.isFinite(v)) fail(`entry ${i} node ${k} ${what}: non-finite value`);
            if (what === 'ang' && Math.abs(v) > Math.PI + 1e-6) fail(`entry ${i} node ${k}: angle ${v} outside a 16-bit turn`);
          }
        }
      }
    });
    if (!animated) fail(`entry ${i}: no keys`);
  } catch (err) {
    fail(`entry ${i}: ${(err as Error).message}`);
  }
}
console.log(`decoded ${motions.count} motions, ${keys} keys; frame counts ${[...frameCounts].sort((a, b) => a[0] - b[0]).map(([f, n]) => `${f}:${n}`).join(' ')}`);

// 2. Town tables reference existing entries; idle/walk/run loop.
for (let cls = 0; cls < 12; cls++) {
  for (let slot = 0; slot < TOWN_SLOTS; slot++) {
    const r = townMotion(cls, slot);
    if (r.index < 0 || r.index >= motions.count) fail(`${CLASS_NAMES[cls]} slot ${slot}: entry ${r.index} out of range`);
    if (r.mode === 2 && (r.next < 0 || r.next >= TOWN_SLOTS)) fail(`${CLASS_NAMES[cls]} slot ${slot}: bad next ${r.next}`);
  }
  for (const g of ['idle', 'walk', 'run'] as const) {
    const r = townMotion(cls, locomotionSlot(cls, g));
    if (r.mode !== 1) fail(`${CLASS_NAMES[cls]} ${g}: mode ${r.mode}, expected a loop`);
  }
}
console.log(
  'town idle/walk/run entries: ' +
    CLASS_NAMES.map((n, c) => `${n}(type ${MOTION_TYPE[c]}) ${(['idle', 'walk', 'run'] as const).map((g) => townMotion(c, locomotionSlot(c, g)).index).join('/')}`).join(', '),
);

// 3. Interpolation: halfway between two keys, and the wrap back to the first key.
{
  const k = [
    { frame: 0, value: [0, 0, 0] as [number, number, number] },
    { frame: 10, value: [1, 2, 3] as [number, number, number] },
  ];
  const out: [number, number, number] = [0, 0, 0];
  sampleKeys(k, 5, 20, out);
  if (Math.abs(out[1] - 1) > 1e-9) fail(`linear interpolation: ${out}`);
  sampleKeys(k, 15, 20, out);
  if (Math.abs(out[1] - 1) > 1e-9) fail(`wrap interpolation: ${out}`);
  // Short angles take the short way round: 170 deg -> -170 deg passes 180.
  const d = Math.PI / 180;
  sampleKeys([{ frame: 0, value: [170 * d, 0, 0] }, { frame: 2, value: [-170 * d, 0, 0] }], 1, 3, out, true);
  if (Math.abs(Math.abs(out[0]) - Math.PI) > 1e-9) fail(`short-way angle interpolation: ${out[0] / d}`);
}

// 4. Play idle / walk / run on every class model; bones stay finite and the
//    walk / run motions actually move the legs.
for (let cls = 0; cls < 12; cls++) {
  const L = classLetter(cls);
  const assets = parsePlayerAssets(cls, new Uint8Array(readFileSync(join(DATA, `pl${L}nj.bml`))), new Uint8Array(readFileSync(join(DATA, `pl${L}tex.afs`))));
  const model = buildPlayerModel(assets, DEFAULT_APPEARANCE);
  const body = model.partBones[0];
  if (body.length !== PLAYER_MOTION_NODES) fail(`${CLASS_NAMES[cls]}: ${body.length} body bones`);
  const anim = new PlayerAnimator(body, assets.parts.get(`pl${L}bdy00.nj`)!, motions);
  for (const g of ['idle', 'walk', 'run'] as const) {
    anim.play(townMotion(cls, locomotionSlot(cls, g)), LOCOMOTION_FACTOR[g]);
    const seen = body.map((b) => b.quaternion.clone());
    let maxTurn = 0;
    for (let t = 0; t < 60; t++) {
      anim.update(1 / 30);
      model.root.updateMatrixWorld(true);
      body.forEach((b, i) => {
        const e = b.matrixWorld.elements;
        if (e.some((v) => !Number.isFinite(v))) fail(`${CLASS_NAMES[cls]} ${g}: bone ${i} not finite`);
        if (t === 10) seen[i].copy(b.quaternion);
        if (t > 10) maxTurn = Math.max(maxTurn, b.quaternion.angleTo(seen[i]));
      });
    }
    if (g !== 'idle' && maxTurn < 0.3) fail(`${CLASS_NAMES[cls]} ${g}: bones barely move (${maxTurn.toFixed(2)} rad)`);
  }
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('OK');

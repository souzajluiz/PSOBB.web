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
  fieldLocomotion,
  MOTION_TYPE,
  PLAYER_MOTION_FILE,
  PLAYER_MOTION_NODES,
  PlayerMotions,
  TOWN_SLOTS,
  townMotion,
} from '../client/src/formats/plymotion.ts';
import { PlayerAnimator } from '../client/src/render/playeranim.ts';
import { EMOTE_KEYS, EMOTE_SLOTS, emoteRecord } from '../client/src/formats/emotes.ts';
import { CharaMotions, charaMotionRecord } from '../client/src/classic/playerview.ts';
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

// 4b. Field locomotion (FIELD_LOCOMOTION_TABLE): every weapon column is a loop
//     inside the archive; column 0 is the town set's walk / idle / run (the
//     field table reads the same records); a weapon column differs from it;
//     a field pose plays on every class.
{
  const town = (cls: number, g: 'idle' | 'walk' | 'run') => townMotion(cls, locomotionSlot(cls, g));
  for (let cls = 0; cls < 12; cls++) {
    for (let w = 0; w < 19; w++) {
      for (const g of ['idle', 'walk', 'run'] as const) {
        const r = fieldLocomotion(cls, w, g);
        if (r.index < 0 || r.index >= motions.count) fail(`field ${CLASS_NAMES[cls]} weapon ${w} ${g}: entry ${r.index} out of range`);
        if (r.mode !== 1 || r.next !== -1) fail(`field ${CLASS_NAMES[cls]} weapon ${w} ${g}: mode ${r.mode} next ${r.next}, expected a plain loop`);
        if (!(r.speed > 0)) fail(`field ${CLASS_NAMES[cls]} weapon ${w} ${g}: speed ${r.speed}`);
      }
    }
    for (const g of ['idle', 'walk', 'run'] as const) {
      const f = fieldLocomotion(cls, 0, g);
      const t = town(cls, g);
      if (f.index !== t.index || f.speed !== t.speed || f.mode !== t.mode) fail(`field ${CLASS_NAMES[cls]} ${g} weapon 0: ${f.index}/${f.speed} is not the town ${t.index}/${t.speed}`);
    }
  }
  // Weapon columns differ: HUmar with a weapon class 1 (walk 104, idle 159, run 111 in the exe's table).
  const expect = (cls: number, w: number, g: 'idle' | 'walk' | 'run', index: number, speed: number) => {
    const r = fieldLocomotion(cls, w, g);
    if (r.index !== index || Math.abs(r.speed - speed) > 1e-6) fail(`field ${CLASS_NAMES[cls]} weapon ${w} ${g}: ${r.index}/${r.speed}, expected ${index}/${speed}`);
  };
  expect(0, 1, 'walk', 104, 1.2);
  expect(0, 1, 'idle', 159, 1);
  expect(0, 1, 'run', 111, 0.8);
  expect(0, 3, 'idle', 159, 0.8);
  expect(0, 3, 'run', 207, 0.8);
  expect(0, 11, 'walk', 69, 1.4);
  // A field pose: a weapon column plays on a model.
  const L = classLetter(11);
  const assets = parsePlayerAssets(11, new Uint8Array(readFileSync(join(DATA, `pl${L}nj.bml`))), new Uint8Array(readFileSync(join(DATA, `pl${L}tex.afs`))));
  const model = buildPlayerModel(assets, DEFAULT_APPEARANCE);
  const anim = new PlayerAnimator(model.partBones[0], assets.parts.get(`pl${L}bdy00.nj`)!, motions);
  for (const w of [0, 5, 18]) {
    anim.play(fieldLocomotion(11, w, 'walk'), LOCOMOTION_FACTOR.walk);
    for (let t = 0; t < 30; t++) anim.update(1 / 30);
    model.root.updateMatrixWorld(true);
    if (model.partBones[0].some((b) => b.matrixWorld.elements.some((v) => !Number.isFinite(v)))) fail(`field RAmarl weapon ${w}: bone not finite`);
  }
  console.log('field locomotion: 12 classes x 19 weapon columns, column 0 = town set, weapon columns differ');
}

// Character screens: charamakingmot.bml (NMDM chunks), the 9 motion records
// of 0x009b1580 / 0x009a2ec0 played on FOmar, FOmarl and HUnewearl.
{
  const chara = new CharaMotions(gsl.get('charamakingmot.bml'));
  let keys = 0;
  for (let r = 0; r < 9; r++) {
    const m = chara.get(charaMotionRecord(r).index);
    if (m.frameCount < 2 || m.nodes.length !== 64) fail(`chara record ${r}: ${m.frameCount} frames, ${m.nodes.length} nodes`);
    for (const n of m.nodes) keys += (n.position?.length ?? 0) + (n.rotation?.length ?? 0);
  }
  for (const [cls, type] of [[10, 0], [6, 2], [1, 1]] as const) {
    const L = classLetter(cls);
    const assets = parsePlayerAssets(cls, new Uint8Array(readFileSync(join(DATA, `pl${L}nj.bml`))), new Uint8Array(readFileSync(join(DATA, `pl${L}tex.afs`))));
    const model = buildPlayerModel(assets, DEFAULT_APPEARANCE);
    const anim = new PlayerAnimator(model.partBones[0], assets.parts.get(`pl${L}bdy00.nj`)!, chara);
    for (const r of [type, 3 + type, 6 + type]) {
      anim.play(charaMotionRecord(r));
      for (let t = 0; t < 40; t++) anim.update(1 / 30);
      model.root.updateMatrixWorld(true);
      if (model.partBones[0].some((b) => b.matrixWorld.elements.some((v) => !Number.isFinite(v)))) fail(`${CLASS_NAMES[cls]} chara record ${r}: bone not finite`);
    }
  }
  console.log(`charamakingmot.bml: 9 records decoded (${keys} keys), played on FOmar/FOmarl/HUnewearl`);
}

// 4c. Emotes (formats/emotes.ts): every key's town record is a town slot inside
//     the archive, every field record (plyemotedata.ts) is a play-once hold inside
//     the archive for all classes and weapon columns; the 6x58 emote plays on the
//     archive's motions.
{
  for (const key of EMOTE_KEYS) {
    const t = emoteRecord(0, 0, EMOTE_SLOTS.town[key], false);
    if (t.index < 0 || t.index >= motions.count) fail(`emote ${key} town: entry ${t.index} out of range`);
  }
  for (let cls = 0; cls < 12; cls++) {
    for (let w = 0; w < 19; w++) {
      for (const key of EMOTE_KEYS) {
        const r = emoteRecord(cls, w, EMOTE_SLOTS.field[key], true);
        if (r.index < 0 || r.index >= motions.count) fail(`emote ${key} field ${CLASS_NAMES[cls]} weapon ${w}: entry ${r.index} out of range`);
        if (r.mode !== 3 || r.next !== -1) fail(`emote ${key} field ${CLASS_NAMES[cls]} weapon ${w}: mode ${r.mode} next ${r.next}, expected a hold`);
        if (!(r.speed > 0)) fail(`emote ${key} field ${CLASS_NAMES[cls]} weapon ${w}: speed ${r.speed}`);
      }
    }
  }
  const L = classLetter(11);
  const assets = parsePlayerAssets(11, new Uint8Array(readFileSync(join(DATA, `pl${L}nj.bml`))), new Uint8Array(readFileSync(join(DATA, `pl${L}tex.afs`))));
  const model = buildPlayerModel(assets, DEFAULT_APPEARANCE);
  const anim = new PlayerAnimator(model.partBones[0], assets.parts.get(`pl${L}bdy00.nj`)!, motions);
  anim.play(emoteRecord(11, 0, EMOTE_SLOTS.field.f1, true), 1);
  for (let i = 0; i < 400 && !anim.ended; i++) anim.update(1 / 30);
  if (!anim.ended) fail('field emote F1 never reached its last frame (mode 3 holds)');
  console.log('emotes: 46 keys, town and field records in range, field F1 holds on the last frame');
}

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log('OK');

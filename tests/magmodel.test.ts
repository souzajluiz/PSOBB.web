// The field MAG (render/magmodel.ts, render/magmotion.ts, formats/itemmagmotion.ts,
// formats/itemmagedit.ts): the model's archive entries, the colour index, the hub gate, the
// tables of ItemMagEdit and the motion file (read from data.gsl when it is there), and the
// motion math: the anchor's damping, the orbit and extra sine terms, the spin and the
// transform's rotation, and the rig's tick clock.
// Run: node tests/magmodel.test.ts

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from '../client/node_modules/three/build/three.module.js';
import { GSLArchive } from '../client/src/formats/archives.ts';
import { parseMagEdit } from '../client/src/formats/itemmagedit.ts';
import { MAG_MOTION_RECORDS, parseMagMotion, type MagMotionRecord } from '../client/src/formats/itemmagmotion.ts';
import {
  bamsSin,
  bamsToRadians,
  magArchiveEntries,
  magColourIndex,
  magDrawsOn,
  magPartRotation,
  magPartTick,
  newMagPartState,
  MAG_MODEL_BASE,
  MAG_TEXTURE_BASE,
} from '../client/src/render/magmotion.ts';
import { magKey, setMagRigVisible, updateMagRig, type MagRig } from '../client/src/render/magmodel.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
};
const near = (a: number, b: number, what: string, eps = 1e-4) => {
  if (!(Math.abs(a - b) <= eps)) {
    failures++;
    console.log(`FAIL ${what}: ${a} != ${b}`);
  }
};

// A record with every term off, for the cases that set one term at a time.
function blankRecord(over: Partial<MagMotionRecord> = {}): MagMotionRecord {
  return {
    node: 63,
    factor: 1,
    spinBytes: [0, 0, 0],
    spinFlag: 0,
    tilt: [0, 0, 0],
    extra: [
      { amplitude: 0, phaseUnits: 0, speed: 0 },
      { amplitude: 0, phaseUnits: 0, speed: 0 },
      { amplitude: 0, phaseUnits: 0, speed: 0 },
    ],
    orbit: [
      { amplitude: 0, phase: 0, speed: 0 },
      { amplitude: 0, phase: 0, speed: 0 },
      { amplitude: 0, phase: 0, speed: 0 },
    ],
    ...over,
  };
}

// --- model choice and colour ---
eq(magArchiveEntries({ type: 3, skin: 2 }), { model: MAG_MODEL_BASE + 3, texture: MAG_TEXTURE_BASE + 2 }, 'archive entries of a PMT mag');
eq([MAG_MODEL_BASE, MAG_TEXTURE_BASE], [271, 295], 'the group 2 bases (0x0092c53c / 0x0092c534)');
eq(magColourIndex(0), 0, 'colour 0');
eq(magColourIndex(0x11), 0x11, 'colour 0x11 is the last table colour');
eq(magColourIndex(0x12), 0, 'colour past the table draws with colour 0 (ASSUMED)');
eq(magKey(null), '', 'no mag: empty key');
eq(magKey({ type: 3, skin: 2, colour: 5 }), '3:2:5', 'rig key');

// --- the hub gate: is_current_map_safe() == 0 on 0, 15, 18, 45 (table 0x0097f1c8) ---
for (const area of [0, 15, 18, 45]) eq(magDrawsOn(area), false, `hub ${area}: no MAG`);
for (const area of [1, 2, 14, 16, 100]) eq(magDrawsOn(area), true, `field ${area}: MAG drawn`);

// --- the bams sine ---
near(bamsSin(16384), 1, 'bams sin of a quarter turn');
near(bamsSin(-16384), -1, 'bams sin of minus a quarter turn');
near(bamsSin(65536 + 16384), 1, 'bams sin wraps at 65536');
near(bamsToRadians(32768), Math.PI, 'half a turn is pi');

// --- the anchor follows its target with the record's factor (FUN_005dc62c) ---
{
  const s = newMagPartState({ x: 100, y: 0, z: 0 });
  magPartTick(s, blankRecord({ factor: 0.9 }), { x: 0, y: 0, z: 0 }, false);
  near(s.anchor.x, 10, 'anchor: 100 + (0 - 100) * 0.9');
  magPartTick(s, blankRecord({ factor: 0.9 }), { x: 0, y: 0, z: 0 }, false);
  near(s.anchor.x, 1, 'anchor: second tick 10 * 0.1');
}

// --- the orbit terms (FUN_005dc600): acc += speed, then amp * sin(acc + phase) ---
{
  const s = newMagPartState({ x: 0, y: 0, z: 0 });
  const rec = blankRecord();
  rec.orbit[0] = { amplitude: 1, phase: 0, speed: 16384 };
  magPartTick(s, rec, { x: 0, y: 0, z: 0 }, false);
  near(s.offset.x, 1, 'orbit A: a quarter turn per tick, tick 1 at sin(90)');
  magPartTick(s, rec, { x: 0, y: 0, z: 0 }, false);
  near(s.offset.x, 0, 'orbit A: tick 2 at sin(180)');
  eq(s.orbitAcc[0], 32768, 'orbit A accumulator');
}
{
  // Zero speed: a constant offset from the phase, like record 0's orbit B (amp 10, phase -10 degrees).
  const s = newMagPartState({ x: 0, y: 0, z: 0 });
  const rec = blankRecord();
  rec.orbit[1] = { amplitude: 10, phase: -1820, speed: 0 };
  magPartTick(s, rec, { x: 0, y: 0, z: 0 }, false);
  magPartTick(s, rec, { x: 0, y: 0, z: 0 }, false);
  near(s.offset.y, 10 * Math.sin((-1820 / 65536) * 2 * Math.PI), 'orbit B: constant -10 degrees phase');
  near(s.offset.y, -1.7363, 'orbit B: value', 1e-3);
}

// --- the extra terms (FUN_005dc590): summed into +0xa8.. and added to the offset ---
{
  const s = newMagPartState({ x: 0, y: 0, z: 0 });
  const rec = blankRecord();
  rec.extra[0] = { amplitude: 2, phaseUnits: 90, speed: 0 }; // 90 degrees: round(90 * 182.04) = 16384 BAMS
  magPartTick(s, rec, { x: 0, y: 0, z: 0 }, false);
  near(s.extraSum[0], 2, 'extra term 4: amp * sin(90 degrees)', 1e-3);
  near(s.offset.x, 2, 'extra term 4 added to the offset', 1e-3);
  magPartTick(s, rec, { x: 0, y: 0, z: 0 }, false);
  near(s.extraSum[0], 4, 'extra terms accumulate (never reset)', 1e-3);
}

// --- the spin (FUN_005dc7c0's tail): X from the flag branch and byte +5; Y, Z accumulate ---
{
  const s = newMagPartState({ x: 0, y: 0, z: 0 });
  const rec = blankRecord({ spinBytes: [0, 1, 0] });
  magPartTick(s, rec, { x: 0, y: 0, z: 0 }, false);
  eq(s.spin, [0, 182, 0], 'spin after one tick, not standing');
  magPartTick(s, rec, { x: 0, y: 0, z: 0 }, false);
  eq(s.spin, [0, 364, 0], 'spin Y accumulates');
  const flagged = newMagPartState({ x: 0, y: 0, z: 0 });
  magPartTick(flagged, blankRecord({ spinFlag: 10 }), { x: 0, y: 0, z: 0 }, true);
  eq(flagged.spin[0], 1820, 'spin X from the standing flag: 10 * 182.04');
}

// --- the rotation: the tilt plus the spin (FUN_005dd0d8) ---
{
  const s = newMagPartState({ x: 0, y: 0, z: 0 });
  const rec = blankRecord({ tilt: [0, 16384, 0] });
  const [rx, ry, rz] = magPartRotation(s, rec);
  near(rx, 0, 'rotation X');
  near(ry, Math.PI / 2, 'rotation Y: a quarter turn of tilt');
  near(rz, 0, 'rotation Z');
}

// --- the file: 90 records, record 0 as the exe's fields read (data.gsl when present) ---
const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
const GSL = join(DATA, 'data.gsl');
if (existsSync(GSL)) {
  const gsl = new GSLArchive(new Uint8Array(readFileSync(GSL)));
  const motion = parseMagMotion(gsl.get('itemmagmotion.dat'));
  eq(motion.length, MAG_MOTION_RECORDS, 'itemmagmotion.dat: 90 records');
  const r0 = motion[0];
  eq(r0.node, 63, 'record 0: node 63 (the body node the MAG follows)');
  near(r0.factor, 0.9, 'record 0: follow factor 0.9');
  eq(r0.orbit[1].amplitude, 10, 'record 0: orbit B amplitude 10');
  eq(r0.orbit[1].phase, -1820, 'record 0: orbit B phase -1820 BAMS (-10 degrees)');
  eq(motion[1].node, 62, 'record 1: node 62');
  eq(motion[89].node, 63, 'record 89: node 63');
  eq(motion[79].node, -1, 'record 79: no node (the owner position)');

  const edit = parseMagEdit(gsl.get('itemmagedit.prs'));
  eq(edit.types, 72, 'ItemMagEdit: 72 MAG types in the part table');
  eq(edit.parts(0).map((p) => p?.record ?? null), [28, 0], 'type 0: parts on records 28 and 0');
  eq(edit.parts(1).map((p) => p?.record ?? null), [null, null], 'type 1: no part');
  eq(edit.parts(7).map((p) => p?.record ?? null), [12, 2], 'type 7: parts on records 12 and 2');
  eq(edit.parts(999).map((p) => p?.record ?? null), [null, null], 'type past the table: no part');
  const c0 = edit.colour(0)!;
  near(c0[0], 1, 'colour 0: a');
  near(c0[1], 1, 'colour 0: r');
  near(c0[2], 0.2, 'colour 0: g', 1e-6);
  near(c0[3], 0.1, 'colour 0: b', 1e-6);
  eq(edit.colour(17) !== null, true, 'colour 17 (the 18th) is in the table');
  eq(edit.colour(18), null, 'colour 18 is past the table');
} else {
  console.log(`SKIP data-file checks: ${GSL} not found (set PSOBB_DATA)`);
}

// --- the rig's clock and placement: game ticks from dt, groups in the marker's frame ---
{
  const root = new THREE.Group();
  const orbit = new THREE.Group();
  const spin = new THREE.Group();
  const state = newMagPartState({ x: 100, y: 0, z: 0 });
  const rig: MagRig = { key: 'test', parts: [{ record: blankRecord({ factor: 0.9 }), state, root, orbit, spin }], ticks: 0 };
  const owner = { x: 0, y: 0, z: 0 };
  const noNode = () => false;
  const identity = (w: { x: number; y: number; z: number }) => w;
  updateMagRig(rig, 0.4 / 30, owner, noNode, identity, false);
  near(state.anchor.x, 100, 'part of a tick: no step yet');
  updateMagRig(rig, 0.7 / 30, owner, noNode, identity, false);
  near(state.anchor.x, 10, 'a full tick (0.4 + 0.7 ticks): one damping step');
  near(root.position.x, 10, 'the root sits at the anchor (marker frame)');
  updateMagRig(rig, 0.1, owner, noNode, identity, false); // 3 ticks, 0.1 owed before
  near(state.anchor.x, 0.01, 'three more ticks from 10: 10 * 0.1^3', 1e-3);
  setMagRigVisible(rig, false);
  eq(root.visible, false, 'hidden in the hubs');
}

// --- the node anchor: the body node's point is the target, the owner's position is the fallback ---
{
  const root = new THREE.Group();
  const orbit = new THREE.Group();
  const spin = new THREE.Group();
  const state = newMagPartState({ x: 0, y: 0, z: 0 });
  const rig: MagRig = { key: 'test', parts: [{ record: blankRecord({ node: 62, factor: 1 }), state, root, orbit, spin }], ticks: 0 };
  updateMagRig(rig, 1, { x: 0, y: 0, z: 0 }, (node, out) => {
    if (node !== 62) return false;
    out.x = 3;
    out.y = 40;
    out.z = -2;
    return true;
  }, (w) => w, false);
  near(state.anchor.x, 3, 'anchor follows the node point (factor 1)');
  near(state.anchor.y, 40, 'anchor y is the node point');
  // Node -1 is the owner's position.
  const rig2: MagRig = { key: 'test', parts: [{ record: blankRecord({ node: -1, factor: 1 }), state: newMagPartState({ x: 9, y: 9, z: 9 }), root, orbit, spin }], ticks: 0 };
  updateMagRig(rig2, 1, { x: 1, y: 2, z: 3 }, () => true, (w) => w, false);
  eq([rig2.parts[0].state.anchor.x, rig2.parts[0].state.anchor.y, rig2.parts[0].state.anchor.z], [1, 2, 3], 'node -1 follows the owner');
}

if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
console.log('ALL PASS');

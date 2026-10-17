// Parses fogentry.dat / lightentry.bin from the client data (loose file first,
// then data.gsl, like the game) and checks the fog state machine.
// Run: node web/tests/fog.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GSLArchive } from '../client/src/formats/archives.ts';
import {
  DEFAULT_FOG_BY_AREA,
  evaluateFog,
  FogController,
  FogRegionManager,
  parseFogEntries,
  regionActive,
  fogRegionFromSet,
  OBJ_FOG_COLLISION_SWITCH,
} from '../client/src/formats/fogentry.ts';
import { lightForArea, parseLightEntries } from '../client/src/formats/lightentry.ts';

const DATA = process.env.PSOBB_DATA ?? join(process.env.HOME!, 'Downloads/psobb-client/data');
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

const gsl = new GSLArchive(new Uint8Array(readFileSync(join(DATA, 'data.gsl'))));
const read = (name: string) => (existsSync(join(DATA, name)) ? new Uint8Array(readFileSync(join(DATA, name))) : gsl.get(name));

// --- fogentry ---------------------------------------------------------------
const fog = parseFogEntries(read('fogentry.dat'));
check(fog.length === 256, `fogentry has 256 entries (${fog.length})`);
check(parseFogEntries(gsl.get('fogentry.dat')).length === 256, 'data.gsl fogentry.dat parses');
check(parseFogEntries(gsl.get('fogentry_a.dat')).length === 128, 'data.gsl fogentry_a.dat parses (128 entries)');
for (const e of fog) {
  check(e.flags === 0 || e.flags === 1 || e.flags === 2, `fog ${e.id} flags ${e.flags}`);
  if (e.flags) check(e.fadeStep > 0, `fog ${e.id} fade step ${e.fadeStep}`);
}
// Caves (area 3 -> entry 3): orange linear fog.
const cave = fog[DEFAULT_FOG_BY_AREA[3]];
check(cave.color === 0xff7000 && near(cave.start, 156.2, 0.01) && near(cave.end, 790.6, 0.01), `cave fog ${JSON.stringify(cave)}`);
// Forest 1 (area 1 -> entry 1).
const forest = fog[DEFAULT_FOG_BY_AREA[1]];
check(forest.color === 0x80ffaa && near(forest.start, 0) && near(forest.end, 2000, 0.01), `forest fog ${JSON.stringify(forest)}`);
// Dark rooms of the caves/mines switch regions use entry 0x11: black, ends at 70.
check(fog[0x11].color === 0 && near(fog[0x11].end, 70, 0.01), 'entry 0x11 is the dark-room fog');
// Wobbling entry: start/end move with sin(frame * speed + phase) and are clamped to >= 0.
const wob = fog[0x06];
check(wob.flags === 2 && wob.wobbleSpeed === 2 && wob.endAmplitude === 3000 && wob.startPhase === 50, 'entry 6 wobbles');
const s0 = evaluateFog(wob, 0);
check(near(s0.end, 4000) && near(s0.start, 300 * Math.sin((50 * Math.PI) / 180), 0.1), `entry 6 at frame 0 ${JSON.stringify(s0)}`);
const s45 = evaluateFog(wob, 45); // 90 degrees (start: 140)
check(near(s45.end, 7000, 0.5) && near(s45.start, 300 * Math.sin((140 * Math.PI) / 180), 0.5), `entry 6 at frame 45 ${JSON.stringify(s45)}`);
check(evaluateFog(fog[0x0b], 0).start === 0, 'negative start is clamped to 0');

// State machine: immediate base fog, then a fade to an override and back.
const ctl = new FogController(fog);
ctl.setBase(3, true);
ctl.tick(0);
check(ctl.currentId === 3 && ctl.state.color === 0xff7000, 'base fog applied immediately');
ctl.setOverride(0x11, false);
ctl.tick(1);
check(ctl.fading && ctl.currentId === 0x11, 'fade toward the override started');
let frames = 1;
while (ctl.fading && frames < 500) ctl.tick(++frames);
check(frames >= 100 && frames <= 103, `fade with step 0.01 takes ~100 frames (${frames})`);
check(ctl.currentId === 0x11 && ctl.state.color === 0 && near(ctl.state.end, 70, 0.01), 'override fog reached');
ctl.revert(true);
ctl.tick(++frames);
check(ctl.currentId === 3 && ctl.state.color === 0xff7000, 'immediate revert to the base fog');
// Halfway through a fade the color is blended per channel.
ctl.setOverride(0x0e, false);
for (let i = 0; i < 51; i++) ctl.tick(++frames);
const mid = ctl.state.color;
check(near((mid >>> 16) & 0xff, (0xff + 0xe1) / 2, 2) && near((mid >>> 8) & 0xff, (0x70 + 0xe2) / 2, 2), `mid-fade color ${mid.toString(16)}`);

// Region manager: entering registers an override, leaving reverts.
const ctl2 = new FogController(fog);
ctl2.setBase(3, true);
ctl2.tick(0);
const mgr = new FogRegionManager();
const region = fogRegionFromSet(OBJ_FOG_COLLISION_SWITCH, [0, 0, 0], [240, 1, 0], [0x11, 0, 0x5d])!;
check(region.radius === 240 && region.fogId === 0x11 && region.fade && regionActive(region, () => false) && !regionActive(region, () => true), 'switch region params');
for (let f = 1; f < 120; f++) {
  mgr.register(region.fogId, region.fade);
  mgr.update(ctl2);
  ctl2.tick(f);
}
check(ctl2.currentId === 0x11, `inside the region the override fog is chosen (${ctl2.currentId})`);
for (let f = 120; f < 240; f++) {
  mgr.update(ctl2);
  ctl2.tick(f);
}
check(ctl2.currentId === 3 && !ctl2.fading, 'outside the region the base fog comes back');

// --- lightentry -------------------------------------------------------------
const lights = parseLightEntries(read('lightentry.bin'));
check(lights.length === 96, `lightentry has 96 entries (${lights.length})`);
// D3D normalizes the direction; some entries are not unit length, none is zero.
for (const [i, l] of lights.entries()) check(Math.hypot(...l.direction) > 0.1, `light ${i} has a direction`);
const l1 = lightForArea(lights, 1)!;
check(near(l1.direction[0], 0.577) && near(l1.direction[1], 0.816) && near(l1.ambientLevel, 0.3) && l1.color.every((c) => c === 1), `forest light ${JSON.stringify(l1)}`);
check(lightForArea(lights, 0x0f, true) === lights[0x3f], 'alternate set is +0x30');

console.log(`fog entries ${fog.length}, light entries ${lights.length}`);
if (failures) {
  console.log(`${failures} failures`);
  process.exit(1);
}
console.log('ok');

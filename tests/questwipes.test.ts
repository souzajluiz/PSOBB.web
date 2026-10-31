// The quest loading screen's particles (classic/questloading.ts, the particle
// section): the mode 0 sweep's timer and windows (0x0040d234), the spawn layout of
// QuestLoadingScreenInitialize (0x0040cf30), the middle particle's emitters and
// spin (0x0040b990 / 0x0040bb70), and the screen's frame step.
// The particleentry.dat slots are synthetic, with the fields the exe's entries 0xf,
// 0x8 and 0x1b carry (kind, texture, size, rate, life, fade, colour, ring).
// Run: node tests/questwipes.test.ts

import {
  MIDDLE,
  middleAngles,
  middlePosition,
  QuestLoadingParticles,
  QuestLoadingScreen,
  WIPE_CYCLE,
  WIPE_SPEED,
  wipeSpawns,
  type QuestLoadingAssets,
} from '../client/src/classic/questloading.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const near = (a: number, b: number, what: string, tol = 1e-3) => check(Math.abs(a - b) <= tol, `${what}: ${a} != ${b}`);

// particleentry.dat slots 0xf, 0x8 and 0x1b (the decoded fields only).
const dat = new Uint8Array(0x200 * 0x98);
function slot(id: number, f: { kind?: number; gbix: number; size: [number, number]; rate: number; life: [number, number]; fade: [number, number]; base: [number, number, number]; slope?: [number, number, number]; radius?: [number, number]; omega?: [number, number] }) {
  const dv = new DataView(dat.buffer, id * 0x98, 0x98);
  dv.setInt32(0x10, f.kind ?? 0, true);
  dv.setUint32(0x14, f.gbix, true);
  dv.setFloat32(0x24, f.size[0], true);
  dv.setFloat32(0x28, f.size[1], true);
  dv.setFloat32(0x44, f.rate, true);
  dv.setInt32(0x48, f.life[0], true);
  dv.setInt32(0x4c, f.life[1], true);
  dv.setFloat32(0x58, f.fade[0], true);
  dv.setFloat32(0x5c, f.fade[1], true);
  dv.setFloat32(0x60, f.radius?.[0] ?? 0, true);
  dv.setFloat32(0x64, f.radius?.[1] ?? 0, true);
  dv.setFloat32(0x30, f.omega?.[0] ?? 0, true);
  dv.setFloat32(0x74, f.omega?.[1] ?? 0, true);
  dv.setFloat32(0x7c, f.base[0], true);
  dv.setFloat32(0x80, f.base[1], true);
  dv.setFloat32(0x84, f.base[2], true);
  const s = f.slope ?? [0, 0, 0];
  dv.setFloat32(0x6c, s[0], true);
  dv.setFloat32(0x70, s[1], true);
  dv.setFloat32(0x74, s[2], true);
}
slot(0xf, { gbix: 0xbfe01, size: [1, 0], rate: 1, life: [10, 20], fade: [0.1, 0.5], base: [0.5, 0.5, 0.5] });
slot(0x8, { gbix: 0xbfe01, size: [1, 0], rate: 0.1, life: [8, 32], fade: [0.1, 0.5], base: [0.7, 0.8, 1], slope: [-0.5, 0.2, -0.8] });
slot(0x1b, { kind: 1, gbix: 0xab02c, size: [0.0098, 0.1], rate: 20, life: [10, 10], fade: [0.1, 0.5], base: [0.5, 1, 0.25], radius: [20, 0], omega: [0, 1] });

const assets: QuestLoadingAssets = { particleEntries: dat, effect: new Map() };

// 1. The spawn layout (0x0040cf30).
const spawns = wipeSpawns();
eq(spawns.length, 22 + 19 + 32, 'spawn count');
eq(spawns.filter((s) => s.mode === 0).length, 22, 'mode 0 count');
eq(spawns.filter((s) => s.mode === 1).length, 19, 'mode 1 count');
eq(spawns.filter((s) => s.mode === 2).length, 32, 'mode 2 count');
const at = (mode: number, i: number) => spawns.filter((s) => s.mode === mode)[i];
eq([at(0, 0)!.x, at(0, 0)!.y], [8, 72], 'mode 0 first');
eq([at(0, 21)!.x, at(0, 21)!.y], [8, 72 + 16 * 21], 'mode 0 last');
eq([at(1, 0)!.x, at(1, 0)!.y], [50, 35], 'mode 1 first (top band)');
eq([at(1, 9)!.x, at(1, 9)!.y], [194, 35], 'mode 1 i=9');
eq([at(1, 10)!.x, at(1, 10)!.y], [478, 444], 'mode 1 i=10 (bottom band)');
eq([at(1, 18)!.x, at(1, 18)!.y], [606, 444], 'mode 1 last (462 + 16 x 9)');
eq([at(2, 0)!.x, at(2, 0)!.y], [555, 99], 'mode 2 first');
eq([at(2, 3)!.x, at(2, 3)!.y], [603, 99], 'mode 2 column 3');
eq([at(2, 4)!.x, at(2, 4)!.y], [555, 139], 'mode 2 second row');
eq([at(2, 31)!.x, at(2, 31)!.y], [603, 379], 'mode 2 last');
eq(
  spawns.filter((s) => s.mode === 0).map((s) => s.effect).every((e) => e === 0xf),
  true,
  'mode 0 effect 0xf',
);
eq(
  spawns.filter((s) => s.mode !== 0).map((s) => s.effect).every((e) => e === 0x8),
  true,
  'modes 1 and 2 effect 0x8',
);

// 2. The mode 0 timer and windows (0x0040d234).
check(WIPE_CYCLE === 0xf1, 'cycle 0xf1');
near(WIPE_SPEED, 15.6, 'wipe speed', 1e-6);
const q = new QuestLoadingParticles(assets);
const mode0 = () => q.wipes.filter((w) => w.spawn.mode === 0);
// Steps the system and records, per mode 0 particle, the frames it is shown.
const shownFrames = new Map<number, number[]>();
const xAt = new Map<number, number>();
for (let f = 1; f <= 2 * WIPE_CYCLE; f++) {
  q.step();
  mode0().forEach((w, i) => {
    if (w.active) shownFrames.set(i, [...(shownFrames.get(i) ?? []), f]);
    if (f === 1 || f === 2) xAt.set(f * 100 + i, w.x);
  });
}
// Particle 0 is shown for frames 1..39 (t = 1..39 < 40), particle 1 for 21..59.
eq(shownFrames.get(0)?.slice(0, 2), [1, 2], 'particle 0 shown from frame 1');
eq(shownFrames.get(0)?.filter((f) => f <= WIPE_CYCLE).length, 39, 'particle 0 shown 39 frames a cycle');
eq(shownFrames.get(0)?.includes(40), false, 'particle 0 hidden at t = 40');
eq(shownFrames.get(1)?.[0], 21, 'particle 1 starts at t = 21');
eq(shownFrames.get(1)?.at(-1), 59 + WIPE_CYCLE, 'particle 1 ends at t = 59 (next cycle)');
eq(shownFrames.get(11)?.filter((f) => f <= WIPE_CYCLE).length, 20, 'particle 11 window is t 221..240 (20 frames)');
eq(shownFrames.get(11)?.[0], 221, 'particle 11 starts at t = 221');
// Particles 12..21 never have a window in the cycle.
for (let i = 12; i < 22; i++) eq(shownFrames.get(i), undefined, `particle ${i} never shown`);
// The first frame's x: 8 + 15.6 for particle 0 (its start is 8), 15.6 for particle 1 (reset to 0 before its window).
near(xAt.get(100)!, 8 + 15.6, 'particle 0 x at frame 1');
near(xAt.get(101)!, 0, 'particle 1 x at frame 1 (hidden, reset)');
near(xAt.get(200)!, 8 + 2 * 15.6, 'particle 0 x at frame 2', 1e-3);

// 3. The screen projection of the wipes (pixels: the emitter position is [x, -y, -1]).
const q2 = new QuestLoadingParticles(assets);
for (let f = 0; f < 3; f++) q2.step();
const w0 = q2.wipes[0]!;
near(w0.sys.emitters[0]!.pos[0], 8 + 3 * 15.6, 'particle 0 x after 3 frames', 1e-3);
eq([w0.sys.emitters[0]!.pos[1], w0.sys.emitters[0]!.pos[2]], [-72, -1], 'emitter pixel y and depth');
eq(q2.wipes[1]!.active, false, 'mode 0 particle 1 hidden at t = 3 (window starts at 21)');
// A live sweep particle sits at the emitter position (its velocity is 0).
// A spawned particle keeps the x it was born at (23.6, 39.2 or 54.8 here).
for (const p of w0.sys.live) {
  check([23.6, 39.2, 54.8].some((x) => Math.abs(p.p[0] - x) < 1e-3), `sweep particle x ${p.p[0]} is a wipe position`);
  near(p.p[1], -72, 'sweep particle at its row', 1e-6);
}
// Modes 1 and 2 stand still and are shown from the first frame.
const fixed = q2.wipes.filter((w) => w.spawn.mode !== 0);
check(fixed.every((w) => w.active), 'modes 1 and 2 shown');
eq(fixed.map((w) => [w.sys.emitters[0]!.pos[0], -w.sys.emitters[0]!.pos[1]]).slice(0, 2), [[50, 35], [66, 35]], 'mode 1 positions unchanged');
for (let f = 0; f < 50; f++) q2.step();
eq(fixed.map((w) => [w.sys.emitters[0]!.pos[0], -w.sys.emitters[0]!.pos[1]]).slice(0, 2), [[50, 35], [66, 35]], 'mode 1 positions after 53 frames');

// 4. The middle particle (0x0040b990 / 0x0040bb70).
eq(middlePosition(), [-11, 0, -100], 'middle position (target 100 + offset -11)');
const m = new QuestLoadingParticles(assets);
eq(m.middle.emitters.length, 4, 'four middle emitters');
eq(m.middle.emitters.map((e) => e.entry.id), [0x1b, 0x1b, 0x1b, 0x1b], 'middle effect 0x1b');
eq(m.middle.emitters.map((e) => e.tint), [MIDDLE.colours[0], MIDDLE.colours[0], MIDDLE.colours[0], MIDDLE.colours[0]], 'middle colour 0');
// The start angles: X = Z = k * 0xaaa BAMS.
const r = (bams: number) => (bams / 0x10000) * Math.PI * 2;
near(m.middle.emitters[1]!.orient![0]!, r(0xaaa), 'emitter 1 start X');
near(m.middle.emitters[1]!.orient![2]!, r(0xaaa), 'emitter 1 start Z');
// Spin: Z turns by 91, -91, 182, -91 BAMS a frame.
for (let f = 0; f < 10; f++) m.step();
const z = (k: number) => m.middle.emitters[k]!.orient![2]!;
near(z(0), r((0x0 + 91 * 10) & 0xffff), 'emitter 0 Z after 10 frames', 1e-6);
near(z(1), r((0xaaa - 91 * 10) & 0xffff), 'emitter 1 Z after 10 frames', 1e-6);
near(z(2), r((2 * 0xaaa + 182 * 10) & 0xffff), 'emitter 2 Z after 10 frames', 1e-6);
near(z(3), r((3 * 0xaaa - 91 * 10) & 0xffff), 'emitter 3 Z after 10 frames', 1e-6);
near(m.middle.emitters[2]!.orient![0]!, r(2 * 0xaaa), 'emitter 2 X unchanged');
eq(middleAngles(0, 0), [0, 0, 0], 'angles at frame 0');
// The ring is spawned at rate 20 a frame for each of the four emitters.
check(m.middle.count > 0, 'middle particles exist');
check(m.middle.live.every((p) => p.ring !== undefined), 'middle particles are rings');

// 5. The screen steps the particles once per 1/30 s.
const screen = new QuestLoadingScreen(assets);
screen.update(1 / 30);
eq(screen.particles!.shownWipes(), 1 + 19 + 32, 'after one frame: particle 0 of mode 0 and every static one shown');
near(screen.particles!.wipes[0]!.x, 8 + 15.6, 'screen steps the sweep once (frame 1)', 1e-3);
screen.update(1 / 30 * 4);
near(screen.particles!.wipes[0]!.x, 8 + 5 * 15.6, 'screen steps 4 more frames', 1e-3);
const bare = new QuestLoadingScreen();
eq(bare.particles, null, 'no assets, no particles');
bare.update(1 / 30);

if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
} else console.log('ALL PASS');

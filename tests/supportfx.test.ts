// The enemy support hooks' particles (combat/buffs.ts SUPPORT_PARTICLE, the enemy vtable
// +0x11c .. +0x128 of entity_hit_by_tech): one emission each (create_particle_effect_3 /
// 13 leave +0x34 = 1), so the port's one-shot spawn (render/hitfx.ts spawn with no
// duration) makes the entry's particles once and stops the emitter. Checks the ids
// against particleentry.dat's entry layout (classic/particles.ts parseParticleEntry) and
// the single emission against ParticleSystem and the FxEmitter of combat/playerfx.ts.
// Run: node tests/supportfx.test.ts

import { ParticleSystem, parseParticleEntry } from '../client/src/classic/particles.ts';
import { FxEmitter } from '../client/src/combat/playerfx.ts';
import { GROUP, SUPPORT_PARTICLE } from '../client/src/combat/buffs.ts';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const eq = (a: unknown, b: unknown, what: string) => check(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// A particleentry.dat slice with entries 0x1fd and 0x1fe: rate 1 (one particle per step),
// life 10 frames, no spread, damping 1, size 1.
const dat = new Uint8Array((0x1fe + 1) * 0x98);
for (const id of [0x1fd, 0x1fe]) {
  const dv = new DataView(dat.buffer, id * 0x98, 0x98);
  dv.setFloat32(0x24, 1, true); // size base
  dv.setFloat32(0x2c, 1, true); // growth
  dv.setFloat32(0x44, 1, true); // rate
  dv.setInt32(0x48, 10, true); // life base
  dv.setFloat32(0x50, 1, true); // damping
}

// 1. The ids: Shifta / Jellen 0x1fd, Deband / Zalure 0x1fe.
eq([SUPPORT_PARTICLE[GROUP.shifta], SUPPORT_PARTICLE[GROUP.jellen], SUPPORT_PARTICLE[GROUP.deband], SUPPORT_PARTICLE[GROUP.zalure]], [0x1fd, 0x1fd, 0x1fe, 0x1fe], 'ids');
eq([parseParticleEntry(dat, 0x1fd).rate, parseParticleEntry(dat, 0x1fe).life[0]], [1, 10], 'the entries parse (rate 1, life 10)');

// 2. The one emission: one particle from the emitter that spawns once (hitfx.ts spawn with
// no duration sets acc = max(0, 1 - rate) and steps once, then drops the emitter).
for (const id of [0x1fd, 0x1fe]) {
  const sys = new ParticleSystem();
  const e = parseParticleEntry(dat, id);
  sys.add(e, [100, 0, 200], null);
  sys.emitters[0].acc = Math.max(0, 1 - e.rate);
  sys.step(true);
  sys.emitters.length = 0;
  eq(sys.count, 1, `0x${id.toString(16)} makes one particle`);
  for (let i = 0; i < 30; i++) sys.step(true);
  eq(sys.count, 0, `0x${id.toString(16)}: no further particles once the emitter is gone`);
}

// 3. FxEmitter of a single emission: one update emits, then the spec is done (the
// enemy's support spec has no frames: undefined = one emission).
{
  const fx = new FxEmitter({ id: 0x1fd });
  eq([fx.update(), fx.done, fx.update(), fx.done], [1, true, 0, true], 'FxEmitter: one emission, then done');
}

if (failures) {
  console.log(`supportfx: ${failures} failure(s)`);
  process.exit(1);
}
console.log('supportfx: all checks passed');

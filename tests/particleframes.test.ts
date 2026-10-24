// Multi-frame particle textures (effect_nt unk_count 16: slots 34, 40..50, e.g. the Gifoie
// spark 0x22 on slot 42 and the Gibarta / Barta dots 0x181 / 0x190 on slot 43). The exe's
// renderer takes the UV rect from unk_float_ptr[unk_index] (update_particle_effect_single_particle,
// dump 291718: unk_index + 1 each update, back to 0 past unk_count; flag 0x10 holds one random
// frame; ParticleEffectSingleParticle_Update_0050e698 at dump 291799: the rect's u, v, end-u, end-v).
// The 16-frame list is ASSUMED to be a 4 x 4 row-major grid (its floats are built at run time).
// Run: node tests/particleframes.test.ts

import { NT_FRAME_COUNT, ParticleSystem, frameUv, parseParticleEntry } from '../client/src/classic/particles.ts';

let failures = 0;
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.log(`FAIL ${what}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
  } else console.log(`ok   ${what}`);
};

// A type 0 entry with a given texture flag word and gbix.
function entry(gbix: number, flags: number, rate = 1, life = 4) {
  const dat = new Uint8Array(0x98);
  const dv = new DataView(dat.buffer);
  dv.setUint32(0x14, gbix, true);
  dv.setUint32(0x88, flags, true);
  dv.setFloat32(0x44, rate, true);
  dv.setInt32(0x48, life, true);
  dv.setInt32(0x4c, 0, true);
  dv.setFloat32(0x28, 0.5, true); // size[1]
  dv.setFloat32(0x2c, 1, true); // size[2]: no shrink
  dv.setFloat32(0x50, 1, true); // damping
  return parseParticleEntry(dat, 0);
}

// Slot 42 of effect_nt.xvm has gbix 750071 (16 frames), slot 5 has 700460 (1 frame).
const slots = new Map<number, number>([
  [750071, 42],
  [700460, 5],
]);

// The frame counts of the table.
eq(NT_FRAME_COUNT[42], 16, 'slot 42 has 16 frames');
eq(NT_FRAME_COUNT[43], 16, 'slot 43 has 16 frames');
eq(NT_FRAME_COUNT[5], undefined, 'slot 5 has one frame');

// The 4 x 4 grid: frame 0 top-left, frame 5 second row second column, frame 15 bottom-right.
eq(frameUv(16, 0), [0, 0, 0.25, 0.25], 'frame 0 is the top-left cell');
eq(frameUv(16, 5), [0.25, 0.25, 0.5, 0.5], 'frame 5 is row 1, column 1');
eq(frameUv(16, 15), [0.75, 0.75, 1, 1], 'frame 15 is the bottom-right cell');
eq(frameUv(1, 0), [0, 0, 1, 1], 'a single-frame texture shows the whole image');

// Free emission: the frame steps once per update and wraps past the last frame.
{
  const ps2 = new ParticleSystem();
  ps2.slots = slots;
  const seen: number[] = [];
  ps2.add(entry(750071, 0, 1, 40), [0, 0, 0], null);
  ps2.step(true); // one particle, updated once: frame 1
  const live = ps2.live as unknown as { frame: number }[];
  seen.push(live[0].frame);
  for (let i = 0; i < 15; i++) {
    ps2.step(false);
    seen.push((ps2.live as unknown as { frame: number }[])[0].frame);
  }
  eq(seen.slice(0, 3), [1, 2, 3], 'the frame steps once an update');
  eq(seen[14], 15, 'the frame reaches the last frame');
  eq(seen[15], 0, 'the frame wraps to 0 past the last frame (the 16th update)');
}

// A plain texture never changes frame.
{
  const ps = new ParticleSystem();
  ps.slots = slots;
  ps.add(entry(700460, 0, 1, 40), [0, 0, 0], null);
  ps.step(true);
  ps.step(false);
  eq((ps.live as unknown as { frame: number }[])[0].frame, 0, 'a one-frame texture stays on frame 0');
}

// Flag 0x10: one frame for the particle's life (the fraction is drawn once, then it holds).
{
  const ps = new ParticleSystem();
  ps.slots = slots;
  ps.add(entry(750071, 0x10, 1, 40), [0, 0, 0], null);
  ps.step(true);
  const f0 = (ps.live as unknown as { frame: number }[])[0].frame;
  for (let i = 0; i < 5; i++) ps.step(false);
  const f1 = (ps.live as unknown as { frame: number }[])[0].frame;
  eq(f0 >= 0 && f0 <= 15 && f0 === f1, true, 'flag 0x10 holds one frame for the life');
}

// The canvas draw path takes the frame's source rectangle (the same mapping as the 3D sprites).
{
  const ps = new ParticleSystem();
  ps.slots = slots;
  ps.add(entry(750071, 0, 1, 40), [0, 0, -100], null);
  ps.step(true);
  const calls: number[][] = [];
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    drawImage(...a: unknown[]) {
      calls.push(a.slice(1).map((v) => Number(v)));
    },
    set globalAlpha(_v: number) {},
    globalCompositeOperation: '',
  } as unknown as CanvasRenderingContext2D;
  const img = { width: 128, height: 128 } as unknown as CanvasImageSource;
  ps.draw(ctx, () => img, (i) => i);
  const frame = (ps.live as unknown as { frame: number }[])[0].frame;
  const [u0, v0] = frameUv(16, frame);
  eq(calls.length, 1, 'the canvas draws one particle');
  eq(calls[0].slice(0, 4), [u0 * 128, v0 * 128, 32, 32], 'the canvas draws the frame cell of the source');
}

console.log(failures === 0 ? 'all passed' : `${failures} failed`);
process.exit(failures === 0 ? 0 : 1);

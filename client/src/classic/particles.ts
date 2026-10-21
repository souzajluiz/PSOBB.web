// Particle effects of type 0 from particleentry.dat (data.gsl, 0x98 bytes per
// entry), as PsoBB.exe (Ephinea 1.25.13) runs them. Used by the "Connecting.."
// warp (entries 0x13 load_blue, 0x15 load_yellow, 0x17 loadhikari,
// 0x1d load_circle, 0x6e load_red, 0x16 load_carsol).
//
// Emitter FUN_0050a3a0(pos, rotation, id, 1) -> FUN_00508f58: acc += rate
// (+0x44) each frame, one particle per whole unit.
// Spawn FUN_0050ec4c:
//   pos = emitter + (rand - 0.5) * variation (+0x18..+0x20)
//   size = rand * (+0x28) + (+0x24)
//   life = round(rand * (+0x4c) + (+0x48)) frames
//   velocity (local) = (rand * (+0x38) + (+0x30), rand * (+0x3c) + (+0x34), 0)
//   rotated about Y by a random angle (FUN_007829f4).
// Update FUN_0050dbb8:
//   velocity x/z *= +0x50, velocity y += +0x54, size *= +0x2c, age += 1/life;
//   the local velocity is turned by the emitter rotation (FUN_0083a610 into
//   +0x118) and added to the position (FUN_0050e618).
//   fade = min(age / +0x58, (1 - age) / +0x5c) (1 outside those ranges);
//   RGB = clamp(age * (+0x6c..+0x74) + (+0x7c..+0x84)) * fade.
// Render ParticleEffectSingleParticle_Update_0050e698:
//   tex_flags (+0x88) & 4: width_scale = +0x64 (opt1) * |velocity|,
//   height_scale = +0x68 (opt2) * |velocity|, angle = the screen direction
//   of the step; otherwise width / height scale = size.
//   The particle goes to particle_renderers[slot] (slot + 0x36 with tex_flags
//   & 0x20), whose effect_nt_metadata entry (NT_LAYOUT) gives the half size
//   (width / height) and the renderer:
//   - renderer 3 (render_particle_renderer3): an axis-aligned quad of half
//     size proj * width * width_scale by proj * height * height_scale; the
//     angle is not used;
//   - renderer 4 (render_particle_renderer4): the same quad turned by the
//     angle, the width along the step.
//   Blend SRCALPHA/ONE (additive).
// Texture (+0x14) is a GBIX of effect_nt.xvm; its slot is its place in the
// file (find_effect_nt_index over effect_nt_texture_ids, which
// load_effect_nt_data fills from the xvm in order).

// Type 1 entries (particle_type = +0x10 = 1; the spawn code picks
// ParticleEffectInstanceFactory_00510534 -> ParticleEffectInstance_Constructor_005105bc
// for it; update ParticleEffectInstance_Update_0050f3fc): a particle that circles its
// spawn point. VERIFIED in the reference dump and the exe: the angle (BAMS)
// starts at round(rand * 65536) and grows by round(omega * 65536 / 360) per
// frame (constants 65536, 360 at 0x00920470 / 0x009204ac / 0x009204a8), omega
// = +0x30 + rand * +0x74; the radius = +0x60 + rand * +0x64; the rise per frame
// = +0x34 + rand * +0x68 (added to the height each update); the position is
// centre + (r cos, rise * n, r sin). The colour slopes are +0x50 / +0x38 /
// +0x3c (R / G / B) with bases +0x7c / +0x80 / +0x84: VERIFIED in the exe for
// instance flag 0x100 clear, whatever effect_nt flag 1 is (0x0050f8d6 ->
// 0x0050f9c9: fld [ecx+0x50] ... fadd [ecx+0x7c]; G at 0x0050f9f5 (+0x38 /
// +0x80); B at 0x0050fa1e (+0x3c / +0x84)). The emitter rotation (the
// renderer's three angles, pRendererData[0..2]) is not applied.
export interface RingParams {
  omega: [number, number]; // degrees per frame: +0x30 + rand * +0x74
  radius: [number, number]; // +0x60 + rand * +0x64
  rise: [number, number]; // y per frame: +0x34 + rand * +0x68
  colorSlope: [number, number, number]; // +0x50, +0x38, +0x3c
}

export interface ParticleEntry {
  id: number;
  kind: number; // +0x10: 0 = free flying, 1 = ring
  ring: RingParams;
  name: string;
  gbix: number;
  variation: [number, number, number];
  size: [number, number, number];
  vel0: [number, number]; // +0x30, +0x34
  velRand: [number, number]; // +0x38, +0x3c
  rate: number;
  life: [number, number];
  damping: number;
  gravity: number;
  fade: [number, number];
  /** +0x60: the bounce factor (texture flag 2) / the plain spin, in the exe's `radius`. */
  radius: number;
  streak: [number, number]; // +0x64, +0x68
  colorSlope: [number, number, number];
  colorBase: [number, number, number];
  flags: number;
}

// create_particle_effect (0x0050b7a4 / 0x0050981c, dump line 289655): an id
// below 0x200 is an entry of particleentry.dat; 0x200..0x23f are entries
// 0..0x3f of the current map's particleentrya%d.dat (0x0050d9a0 reads
// particleentrya0%d.dat for maps 0..9); any other id makes nothing. The map is
// taken to be the floor's area number (ASSUMED: the map number is the area).
export const MAP_PARTICLE_FIRST = 0x200;
export const MAP_PARTICLE_COUNT = 0x40;

export function particleMapFile(map: number): string {
  return map < 10 ? `particleentrya0${map}.dat` : `particleentrya${map}.dat`;
}

export function parseParticleEntry(dat: Uint8Array, id: number): ParticleEntry {
  const o = id * 0x98;
  const dv = new DataView(dat.buffer, dat.byteOffset + o, 0x98);
  const f = (k: number) => dv.getFloat32(k, true);
  let name = '';
  for (let i = 0; i < 16 && dat[o + i]; i++) name += String.fromCharCode(dat[o + i]);
  return {
    id,
    kind: dv.getInt32(0x10, true),
    ring: {
      omega: [f(0x30), f(0x74)],
      radius: [f(0x60), f(0x64)],
      rise: [f(0x34), f(0x68)],
      colorSlope: [f(0x50), f(0x38), f(0x3c)],
    },
    name,
    gbix: dv.getUint32(0x14, true),
    variation: [f(0x18), f(0x1c), f(0x20)],
    size: [f(0x24), f(0x28), f(0x2c)],
    vel0: [f(0x30), f(0x34)],
    velRand: [f(0x38), f(0x3c)],
    rate: f(0x44),
    life: [dv.getInt32(0x48, true), dv.getInt32(0x4c, true)],
    damping: f(0x50),
    gravity: f(0x54),
    fade: [f(0x58), f(0x5c)],
    radius: f(0x60),
    streak: [f(0x64), f(0x68)],
    colorSlope: [f(0x6c), f(0x70), f(0x74)],
    colorBase: [f(0x7c), f(0x80), f(0x84)],
    flags: dv.getUint32(0x88, true),
  };
}

export interface Emitter {
  entry: ParticleEntry;
  pos: [number, number, number];
  rotX: number; // radians (BAMS 0x4000 = 90 degrees)
  acc: number;
  // ParticleEffectSingleParticle_SetId_00508ee4: a colour override (RGB,
  // flag 0x100 of the effect). ASSUMED to scale the entry's colour.
  tint?: number | undefined;
}

export interface Particle {
  e: Emitter;
  p: [number, number, number];
  v: [number, number, number]; // local
  step: [number, number, number]; // world step of the last frame
  size: number;
  age: number;
  dt: number;
  /** The spin angle in BAMS (update_particle_effect_single_particle's `angle`); only kept by a `models` system. */
  angle: number;
  /** field47_0x6c = rand - 0.5: the spin goes one way when it is below 0, the other when not. */
  spinSign: number;
  // A type 1 particle: its centre, angle (BAMS), angular step (BAMS), radius,
  // rise per frame and the height gained so far.
  ring?: { c: [number, number, number]; ang: number; omega: number; r: number; rise: number; dy: number };
}

export const NT_SIZE = 16; // effect_nt metadata width (see title.ts)

// effect_nt_metadata (0x00a101c0, 0x28 bytes per effect_nt.xvm slot, 0x36
// slots; the next 0x36 are the tex_flags 0x20 copies): [half size (+0x14 =
// +0x18), renderer type (+0x24)] per slot.
export const NT_LAYOUT: readonly (readonly [number, 3 | 4])[] = [
  [4, 4], [16, 3], [16, 3], [16, 4], [16, 3], [16, 4], [16, 3], [16, 3], [16, 3], [16, 3],
  [16, 3], [16, 3], [16, 3], [16, 3], [16, 3], [16, 3], [16, 3], [16, 3], [16, 4], [16, 3],
  [16, 4], [16, 4], [16, 3], [16, 3], [16, 3], [32, 4], [32, 4], [32, 4], [32, 4], [32, 4],
  [32, 3], [32, 3], [32, 4], [32, 4], [8, 3], [32, 3], [32, 3], [32, 3], [32, 3], [32, 3],
  [16, 3], [16, 3], [16, 3], [16, 3], [16, 3], [16, 3], [16, 4], [16, 4], [16, 3], [16, 4],
  [32, 4], [8, 4], [16, 3], [32, 4],
];

// The quad of a particle in its renderer's terms: half width / height in
// world units at the particle (times the projection), and whether it turns
// with the step. A slot that is not known keeps the old guess (16, turned).
export function particleQuad(q: Particle, slot: number | undefined): { hw: number; hh: number; rotated: boolean } {
  const d = q.e.entry;
  const [half, renderer] = (slot !== undefined ? NT_LAYOUT[slot] : undefined) ?? [NT_SIZE, 4];
  if (d.flags & 4) {
    const L = Math.hypot(...q.step);
    return { hw: half * d.streak[0] * L, hh: half * d.streak[1] * L, rotated: renderer === 4 };
  }
  return { hw: half * q.size, hh: half * q.size, rotated: false };
}

// Projection with the fixed camera at the origin looking down -Z
// (FUN_004d31f4(9) + FUN_004d33c0(0, (0,0,-1)) in the connection loop) and
// the default perspective (D = 437.44, title.ts) around the screen centre.
export class ParticleSystem {
  emitters: Emitter[] = [];
  // effect_nt.xvm slot of each GBIX (the file's order), for NT_LAYOUT.
  slots = new Map<number, number>();
  private list: Particle[] = [];
  private seed = 1;
  /** Run the model particle extras (the spin angle, flag 2's floor): a system that draws models, not quads. */
  models = false;
  centre: [number, number] = [320, 240];
  D = 437.44;

  private rand(): number {
    this.seed = (Math.imul(this.seed, 214013) + 2531011) | 0;
    return ((this.seed >>> 16) & 0x7fff) / 32768;
  }

  add(entry: ParticleEntry, pos: [number, number, number], rotX: number, tint?: number): void {
    this.emitters.push({ entry, pos, rotX, acc: 0, tint });
  }

  // The live particles (render/telepipe.ts draws them in the world).
  get live(): readonly Particle[] {
    return this.list;
  }

  step(spawn = true): void {
    if (spawn) {
      for (const e of this.emitters) {
        e.acc += e.entry.rate;
        while (e.acc >= 1) {
          e.acc -= 1;
          this.list.push(this.spawn(e));
        }
      }
    }
    for (const q of this.list) this.update(q);
    this.list = this.list.filter((q) => q.age < 1);
  }

  get count(): number {
    return this.list.length;
  }

  private spawn(e: Emitter): Particle {
    const d = e.entry;
    const r = () => this.rand();
    // Texture flag 2 (a model particle's): the height is the fixed variation, not a random spread
    // (the constructor 0x0050ec4c: y = y_variation + y).
    const fixedY = this.models && (d.flags & 2) !== 0;
    const p: [number, number, number] = [
      e.pos[0] + (r() - 0.5) * d.variation[0],
      fixedY ? e.pos[1] + d.variation[1] : e.pos[1] + (r() - 0.5) * d.variation[1],
      e.pos[2] + (r() - 0.5) * d.variation[2],
    ];
    const size = r() * d.size[1] + d.size[0];
    const dt = 1 / Math.max(1, Math.round(r() * d.life[1] + d.life[0]));
    if (d.kind === 1) {
      // 0x00510238: the centre is the emitter position plus the variation.
      const c: [number, number, number] = p;
      const ring = {
        c,
        ang: Math.round(r() * 0x10000),
        omega: 0,
        r: r() * d.ring.radius[1] + d.ring.radius[0],
        rise: 0,
        dy: 0,
      };
      ring.omega = Math.round(((r() * d.ring.omega[1] + d.ring.omega[0]) * 0x10000) / 360);
      ring.rise = r() * d.ring.rise[1] + d.ring.rise[0];
      return { e, p: [...c], v: [0, 0, 0], step: [0, 0, 0], size, age: 0, dt, angle: 0, spinSign: 0, ring };
    }
    const vx = r() * d.velRand[0] + d.vel0[0];
    const vy = r() * d.velRand[1] + d.vel0[1];
    const a = r() * Math.PI * 2;
    // The spin angle starts at rand * 65536 and turns by the sign of rand - 0.5, unless the
    // friction, gravity and vacume fields are all 0.
    const spins = d.gravity !== 0 || d.vel0[0] !== 0 || d.vel0[1] !== 0;
    const angle = this.models && spins ? Math.round(r() * 65536) & 0xffff : 0;
    const spinSign = this.models && spins ? r() - 0.5 : 0;
    return { e, p, v: [vx * Math.cos(a), vy, -vx * Math.sin(a)], step: [0, 0, 0], size, age: 0, dt, angle, spinSign };
  }

  private update(q: Particle): void {
    const d = q.e.entry;
    const ring = q.ring;
    if (ring) {
      ring.ang = (ring.ang + ring.omega) & 0xffff;
      ring.dy += ring.rise;
      const a = (ring.ang / 0x10000) * Math.PI * 2;
      const next: [number, number, number] = [ring.c[0] + ring.r * Math.cos(a), ring.c[1] + ring.dy, ring.c[2] + ring.r * Math.sin(a)];
      q.step = [next[0] - q.p[0], next[1] - q.p[1], next[2] - q.p[2]];
      q.p = next;
      q.size *= d.size[2];
      q.age += q.dt;
      return;
    }
    q.v = [q.v[0] * d.damping, q.v[1] + d.gravity, q.v[2] * d.damping];
    q.size *= d.size[2];
    // Emitter rotation about X: y' = y cos - z sin, z' = y sin + z cos.
    const c = Math.cos(q.e.rotX), s = Math.sin(q.e.rotX);
    q.step = [q.v[0], q.v[1] * c - q.v[2] * s, q.v[1] * s + q.v[2] * c];
    q.p = [q.p[0] + q.step[0], q.p[1] + q.step[1], q.p[2] + q.step[2]];
    q.age += q.dt;
    if (this.models) this.modelStep(q);
  }

  // The parts of update_particle_effect_single_particle (0x0050dbb8) a model particle shows:
  // texture flag 2 makes a floor at the emitter's height, where the climb is drawn again as
  // (rand * +0x3c + +0x34) * radius (+0x60); the spin is +0x64 * vx * vy, held to 20 degrees, in
  // BAMS, added or taken by the sign of the particle's rand - 0.5 (0x0050e2a4..0x0050e370).
  private modelStep(q: Particle): void {
    const d = q.e.entry;
    if ((d.flags & 2) !== 0 && q.p[1] < q.e.pos[1]) q.v[1] = (this.rand() * d.velRand[1] + d.vel0[1]) * d.radius;
    if (d.gravity === 0 && d.vel0[0] === 0 && d.vel0[1] === 0) {
      q.angle = (q.angle + Math.trunc((d.radius * 65536) / 360)) & 0xffff;
    } else if ((d.flags & 4) === 0) {
      const v = Math.min(Math.abs(d.streak[0] * q.v[0] * q.v[1]), 20);
      const n = Math.trunc((v * 65536) / 360);
      q.angle = (q.spinSign < 0 ? q.angle + n : q.angle - n) & 0xffff;
    }
  }

  draw(ctx: CanvasRenderingContext2D, texture: (gbix: number) => CanvasImageSource | null, tint: (img: CanvasImageSource, key: string, r: number, g: number, b: number) => CanvasImageSource): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const q of this.list) {
      const d = q.e.entry;
      const z = -q.p[2];
      if (z < 1) continue;
      const img = texture(d.gbix);
      if (!img) continue;
      const { fade, rgb } = particleShade(q);
      if (fade <= 0) continue;
      const c = rgb.map((v) => v * 255);
      ctx.globalAlpha = fade;
      const tinted = tint(img, `g${d.gbix}`, c[0], c[1], c[2]);
      const k = this.D / z;
      const sx = this.centre[0] + q.p[0] * k;
      const sy = this.centre[1] - q.p[1] * k;
      const quad = particleQuad(q, this.slots.get(d.gbix));
      if (d.flags & 4 && quad.hw === 0 && quad.hh === 0) continue;
      const hw = k * quad.hw;
      const hh = k * quad.hh;
      if (quad.rotated) {
        const e = [q.p[0] + q.step[0], q.p[1] + q.step[1], q.p[2] + q.step[2]];
        if (-e[2] < 1) continue;
        const ke = this.D / -e[2];
        const ex = this.centre[0] + e[0] * ke;
        const ey = this.centre[1] - e[1] * ke;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.atan2(ey - sy, ex - sx));
        ctx.drawImage(tinted, -hw, -hh, hw * 2, hh * 2);
        ctx.restore();
      } else {
        ctx.drawImage(tinted, sx - hw, sy - hh, hw * 2, hh * 2);
      }
    }
    ctx.restore();
  }
}

// A particle's fade and colour (0..1) at its age, with the emitter's tint.
// The slope depends on the particle KIND, not on the effect flags:
//   type 0 (update_particle_effect_single_particle, 0x0050dbb8): slope
//     +0x6c / +0x70 / +0x74 (`fmul [ecx+0x6c]` at 0x0050df88, 0x0050dfbc, 0x0050dfeb);
//   type 1 ring (ParticleEffectInstance_Update_0050f3fc): slope +0x50 / +0x38 / +0x3c.
// Both use the bases +0x7c / +0x80 / +0x84 when instance flag 0x100 is clear
// (0x0050df86 and 0x0050f9c9), whatever effect_nt flag 1 is. The 0x100 path
// (the tint) takes the particle's own RGB as the base instead (type 0 `fadd
// [ebp+0x50]` at 0x0050def5, ring `fadd [esi+0x50]` at 0x0050f7b6); the port
// multiplies the tint in instead (ASSUMED, UNCLEAR, see the DEVLOG).
export function particleShade(q: Particle): { fade: number; rgb: [number, number, number] } {
  const d = q.e.entry;
  const t = Math.min(q.age, 1);
  const fade = Math.min(t < d.fade[0] ? t / d.fade[0] : 1, 1 - t < d.fade[1] ? (1 - t) / d.fade[1] : 1);
  const tint = q.e.tint;
  const slope = q.ring ? d.ring.colorSlope : d.colorSlope;
  const rgb = [0, 1, 2].map((i) => {
    const v = Math.max(0, Math.min(1, t * slope[i]! + d.colorBase[i]!));
    return tint ? v * (((tint >>> (16 - 8 * i)) & 0xff) / 255) : v;
  }) as [number, number, number];
  return { fade, rgb };
}

// Additive tint of a texture (vertex color x texel), cached per color step.
export function makeTinter(): (img: CanvasImageSource, key: string, r: number, g: number, b: number) => CanvasImageSource {
  const cache = new Map<string, OffscreenCanvas>();
  return (img, key, r, g, b) => {
    const q = (v: number) => Math.round(v / 8) * 8;
    const k = `${key}|${q(r)},${q(g)},${q(b)}`;
    let c = cache.get(k);
    if (!c) {
      const w = (img as { width: number }).width;
      const h = (img as { height: number }).height;
      c = new OffscreenCanvas(w, h);
      const g2 = c.getContext('2d')!;
      g2.drawImage(img, 0, 0);
      g2.globalCompositeOperation = 'multiply';
      g2.fillStyle = `rgb(${q(r)},${q(g)},${q(b)})`;
      g2.fillRect(0, 0, w, h);
      g2.globalCompositeOperation = 'destination-in';
      g2.drawImage(img, 0, 0);
      if (cache.size > 2000) cache.clear();
      cache.set(k, c);
    }
    return c;
  };
}

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

// The object angles of create_particle_effect2 (the particle effect's +0x78 / +0x7c /
// +0x80 = X, Y, Z: update_particle_effect hands them to the single particle, whose
// field49 is X, rot_y is Y and field51 is Z, see turnStep). Radians here; the exe
// keeps BAMS ints (0x10000 = a turn, orientOfDirection).
export type Orient = readonly [number, number, number];
export const NO_ORIENT: Orient = [0, 0, 0];

/**
 * The effect flags of a created particle effect, as the exe's particles carry them
 * (create_particle_effect2 / 4's flags word, copied into the particle's +0x24 at spawn,
 * update_particle_effect's single particle branch):
 * - flag2: particle flag 2. The velocity is turned Rx Ry Rz (Rz applied first) instead of
 *   Rz Rx Ry (update_particle_effect_single_particle, the `& 2` branch, 0x0050dbb8 area).
 *   No emitter the port makes passes it (the table flag 2 selects create_particle_effect2,
 *   it is not the effect's flag).
 * - noDraw: particle flag 0x2000. update_particle_effect spawns the particle already
 *   destroyed (ParticleEffectSingleParticle_Destroy_00508634 sets 0x2000 on it, dump line
 *   288330), and its single particle update returns before the renderer submission
 *   (dump line 291923). The particle still moves and fades; it is never drawn.
 * - matrix: particle flag 0x20 (the effect's +0x2e, set by ParticleEffectSingleParticle_
 *   SetTransform_00508dec). The effect's own matrix (+0x90, its 3x3 _11.._33 row-major here)
 *   is copied into the particle's +0xc0 at spawn (flag 0x200000) and multiplied in first.
 * - model: particle flag 0x200 (the effect's +0x2c, set by the technique loops for the table's
 *   flag 0x20: create_particle_effect3 / 5 then `+0x2c |= 0x200`, dump lines 640489 (Barta) and
 *   644166 (Gibarta)). The particle is drawn as that BML model, not a quad
 *   (update_particle_effect_single_particle, the else branch of `flags & 0x200`, dump 291966).
 *   chunk = the njcm chunk of the technique BML (the effect's +0x50); motion = the njm chunk
 *   (+0x58, Barta's 0, Gibarta's none: its loop sets +0x58 = 0.0, so the model is static);
 *   speed = the frames the motion advances per update (+0x60 = 1.0, the particle's +0x114).
 */
export interface EffectFx {
  flag2?: boolean;
  noDraw?: boolean;
  matrix?: readonly number[];
  model?: { chunk: number; motion: number | null; speed: number };
  /**
   * Particle flag 0x400 (the table's 0x400, Rafoie's ring 0x600 = model | cloak). The model branch
   * draws it only with the advanced effects setting (update_particle_effect_single_particle, dump
   * 291946: `(advanced || (flags & 0x400) == 0) && xvm && njcm`), through the cloak; without it the
   * particle is not drawn. render/hitfx.ts gates it on advancedEffectsOn().
   */
  cloak?: boolean;
}

export interface Emitter {
  entry: ParticleEntry;
  pos: [number, number, number];
  orient: Orient | null; // the emitter's object angles (null = none: the velocity is not turned)
  fx: EffectFx;
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
  /** njm_elapsed (the model's motion frame, not clamped here: the drawer clamps to the last frame). */
  anim: number;
  /** The particle's frame of a multi-frame texture (the exe's unk_particle_struct.unk_index, see NT_FRAME_COUNT). */
  frame: number;
  // A type 1 particle: its centre, angle (BAMS), angular step (BAMS), radius,
  // rise per frame and the height gained so far.
  ring?: { c: [number, number, number]; ang: number; omega: number; r: number; rise: number; dy: number };
}

export const NT_SIZE = 16; // effect_nt metadata width (see title.ts)

// effect_nt_metadata.unk_count (+0x0c of each record, 0x00a101c0; read from PsoBB.exe with
// tools/exedata.py): the number of frames of a texture's UV list (unk_float_ptr, +0x10). Slots
// 34, 40..50 have 16 frames, all sharing one list (0x00aaed20, built at run time); the others 1
// (their list is 0,0,1,1 at 0x00a112cc). Used by the particle's frame (unk_index, 0x0050e0xx area).
export const NT_FRAME_COUNT: Readonly<Record<number, number>> = Object.freeze(
  Object.fromEntries([34, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50].map((s) => [s, 16])),
);

// The UV rect (u0, v0, u1, v1, top-left origin) of a frame of a texture with `count` frames. ASSUMED:
// the 16-frame list is a uniform 4 x 4 grid in row-major order (the list's floats are not in the
// exe's data section; the sheets of effect_nt.xvm slots 42 and 43 are such grids of 32-pixel cells).
export function frameUv(count: number, frame: number): readonly [number, number, number, number] {
  if (count <= 1) return [0, 0, 1, 1];
  const cols = Math.max(1, Math.round(Math.sqrt(count)));
  const f = Math.max(0, Math.min(count - 1, frame));
  const c = f % cols;
  const r = Math.floor(f / cols);
  return [c / cols, r / cols, (c + 1) / cols, (r + 1) / cols];
}

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

// effect_nt_metadata.flags (+0x00 of each 0x28-byte record, 0x00a101c0; the table is 108 records,
// the second 0x36 are the tex_flags 0x20 copies). IsNTParticle (ParticleEffectSingleParticle_
// IsNTParticle_00508a30, dump 287725) is `particle_renderers[texture_index]->effect_nt->flags & 1`.
// Read from PsoBB.exe with tools/exedata.py (the copies' flags differ from the first 0x36).
// Only bit 0 is used here: 1 and 5 are NT, 2 and 6 are not.
export const NT_FLAGS: readonly number[] = [
  2, 1, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 2, 1, 2, 6, 5, 6, 5, 6, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 5, 6,
];

/** IsNTParticle for a renderer slot (the particle's texture_index; unknown slots are not NT). */
export function particleIsNt(slot: number | undefined): boolean {
  return slot !== undefined && ((NT_FLAGS[slot] ?? 0) & 1) !== 0;
}

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

const BAMS_TO_RAD = (Math.PI * 2) / 0x10000;

/**
 * Vector3f_GetAnglesZ_007a8d98 of a direction (x, y, z): X = round(atan2(z, hypot(x, y)))
 * and Z = -round(atan2(x, y)), in BAMS with the exe's 65536 / 6.2831840515 factor
 * (0x0097d8d8 / 0x0097d8d0). Y is not set by it, so it is 0 here. Radians out.
 * ASSUMED: ROUND is round-half-up.
 */
export function orientOfDirection(x: number, y: number, z: number): Orient {
  const k = 0x10000 / 6.283184051513672;
  const ax = Math.round(Math.atan2(z, Math.hypot(x, y)) * k);
  const az = -Math.round(Math.atan2(x, y) * k);
  return [ax * BAMS_TO_RAD, 0, az * BAMS_TO_RAD];
}

/**
 * The step a local velocity becomes under the object angles and the effect's flags
 * (update_particle_effect_single_particle, 0x0050dbb8 area). The exe pushes identity,
 * multiplies in the particle's own matrix first when flag 0x20 is set
 * (MultiplyMatricesInPlace_0083ba24, S := M S), then the three angle helpers, then
 * rotate_vec3f_using_matrix_transformation_stack, which reads the stack transposed
 * (out = S^T v, its 3x3 part). Each helper left-multiplies the stack, so for the
 * default branch (flag 2 clear) S = Ry Rx Rz M and out = M^T Pz Px Py v: Y first, then X,
 * then Z, the matrix last. The standard right-handed matrices P are the transposes of the
 * helpers (rotate_matrix_by_int_angle writes its rows as [c s; -s c], the transpose of P(a)).
 * With particle flag 2 the helpers run X, Y, Z, so out = M^T Px Py Pz v: Z first, X last.
 * ASSUMED: the angle helpers' sin is the standard one (see orientOfDirection).
 */
export function turnStep(o: Orient | null, v: readonly [number, number, number], fx: EffectFx = {}): [number, number, number] {
  const turned = !!o && (o[0] !== 0 || o[1] !== 0 || o[2] !== 0);
  if (!turned && !fx.matrix) return [v[0], v[1], v[2]];
  const [ax, ay, az] = o ?? NO_ORIENT;
  let x = v[0], y = v[1], z = v[2];
  const rotY = () => {
    const c = Math.cos(ay), s = Math.sin(ay);
    [x, z] = [c * x + s * z, -s * x + c * z];
  };
  const rotX = () => {
    const c = Math.cos(ax), s = Math.sin(ax);
    [y, z] = [c * y - s * z, s * y + c * z];
  };
  const rotZ = () => {
    const c = Math.cos(az), s = Math.sin(az);
    [x, y] = [c * x - s * y, s * x + c * y];
  };
  if (fx.flag2) {
    rotZ();
    rotY();
    rotX();
  } else {
    rotY();
    rotX();
    rotZ();
  }
  const m = fx.matrix;
  if (m) {
    // Mᵀ v on the 3x3 part: out_i = sum_j M[j][i] v_j (the exe's out.x = _11 x + _21 y + _31 z, ...).
    [x, y, z] = [m[0]! * x + m[3]! * y + m[6]! * z, m[1]! * x + m[4]! * y + m[7]! * z, m[2]! * x + m[5]! * y + m[8]! * z];
  }
  return [x, y, z];
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

  add(entry: ParticleEntry, pos: [number, number, number], orient: Orient | null, tint?: number, fx: EffectFx = {}): void {
    this.emitters.push({ entry, pos, orient, fx, acc: 0, tint });
  }

  // The drawn particles (render/telepipe.ts and render/hitfx.ts make a sprite each). A noDraw
  // emitter's particles are stepped but not in this list (EffectFx.noDraw).
  get live(): readonly Particle[] {
    return this.list.some((q) => q.e.fx.noDraw) ? this.list.filter((q) => !q.e.fx.noDraw) : this.list;
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
    // The exe draws x, then z, then y (FUN_0050ec4c, the first three _rand calls), so the
    // draws are sequenced in that order. The offset is rand / 32768 + g_ParticleRandomOffset
    // (0x00920410 = -0.5), i.e. rand - 0.5.
    const x = e.pos[0] + (r() - 0.5) * d.variation[0];
    const z = e.pos[2] + (r() - 0.5) * d.variation[2];
    const y = fixedY ? e.pos[1] + d.variation[1] : e.pos[1] + (r() - 0.5) * d.variation[1];
    const p: [number, number, number] = [x, y, z];
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
      return { e, p: [...c], v: [0, 0, 0], step: [0, 0, 0], size, age: 0, dt, angle: 0, spinSign: 0, anim: 0, frame: 0, ring };
    }
    const vx = r() * d.velRand[0] + d.vel0[0];
    const vy = r() * d.velRand[1] + d.vel0[1];
    // FUN_007829f4 turns (vx, vy, 0) about Y: x and z (indices 0 and 2) by the BAMS angle
    // 2 * rand, vy is kept (0x0050ec4c, the call at 0x0050ee9c).
    const a = r() * Math.PI * 2;
    // The spin angle starts at rand * 65536 and turns by the sign of rand - 0.5, unless the
    // friction, gravity and vacume fields are all 0.
    const spins = d.gravity !== 0 || d.vel0[0] !== 0 || d.vel0[1] !== 0;
    const angle = this.models && spins ? Math.round(r() * 65536) & 0xffff : 0;
    const spinSign = this.models && spins ? r() - 0.5 : 0;
    // The frame of a multi-frame texture: flag 0x10 draws one frame for the particle's life
    // (index = (count - 1) * the spawn's fraction, ASSUMED a random fraction); else it starts at 0.
    const count = this.frameCount(e);
    const frame = count > 1 && (d.flags & 0x10) !== 0 ? Math.trunc((count - 1) * r()) : 0;
    return { e, p, v: [vx * Math.cos(a), vy, -vx * Math.sin(a)], step: [0, 0, 0], size, age: 0, dt, angle, spinSign, anim: 0, frame };
  }

  /** The texture's frame count (NT_FRAME_COUNT of the emitter's slot; 1 for a plain texture). */
  frameCount(e: Emitter): number {
    const slot = this.slots.get(e.entry.gbix);
    return slot === undefined ? 1 : (NT_FRAME_COUNT[slot] ?? 1);
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
    // The emitter's object angles turn the local velocity (turnStep).
    q.step = turnStep(q.e.orient, q.v, q.e.fx);
    q.p = [q.p[0] + q.step[0], q.p[1] + q.step[1], q.p[2] + q.step[2]];
    q.age += q.dt;
    // update_particle_effect_single_particle: without texture flag 0x10 the frame steps once an update
    // (unk_index + 1, back to 0 past the last frame).
    const count = this.frameCount(q.e);
    if (count > 1 && (d.flags & 0x10) === 0) q.frame = q.frame + 1 < count ? q.frame + 1 : 0;
    if (this.models) this.modelStep(q);
    // njm_elapsed += +0x114 (the last statement of update_particle_effect_single_particle, dump 291756).
    if (q.e.fx.model) q.anim += q.e.fx.model.speed;
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

  // The source rectangle of a particle's frame in its texture image (the whole image for a plain texture).
  private frameRect(img: CanvasImageSource, q: Particle): [number, number, number, number] {
    const { width: w, height: h } = img as { width: number; height: number };
    const [u0, v0, u1, v1] = frameUv(this.frameCount(q.e), q.frame);
    return [u0 * w, v0 * h, (u1 - u0) * w, (v1 - v0) * h];
  }

  draw(ctx: CanvasRenderingContext2D, texture: (gbix: number) => CanvasImageSource | null, tint: (img: CanvasImageSource, key: string, r: number, g: number, b: number) => CanvasImageSource): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const q of this.list) {
      if (q.e.fx.noDraw) continue;
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
        ctx.drawImage(tinted, ...this.frameRect(tinted, q), -hw, -hh, hw * 2, hh * 2);
        ctx.restore();
      } else {
        ctx.drawImage(tinted, ...this.frameRect(tinted, q), sx - hw, sy - hh, hw * 2, hh * 2);
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
// multiplies the tint in instead (ASSUMED; the exe's instance +0x50..+0x58 is
// zeroed by its ctor 0x00508460 and no copy of the owner's dword into it was
// found, see the DEVLOG 2026-10-21 tint entry).
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

// The blend of a model particle (ParticleEffectSingleParticle_SetColor_00508958, dump 287693, run
// before the model's draw in the model branch of update_particle_effect_single_particle, dump 291966):
// d3d8Dev_SetRenderState_SrcDestBlend_Save(1, 4, dst) with dst 5 for a non-NT particle and 1 for an
// NT one (IsNTParticle: effect_nt flag 1 of the particle's renderer). The save helper (dump 852687)
// sets SRCBLEND = table[src], DESTBLEND = table[dst], and the table 0x00a219f8 holds 1..8, that is
// table[i] = D3DBLEND value i + 1. So non-NT is SRCALPHA / INVSRCALPHA and NT is SRCALPHA / ONE.
export const D3DBLEND = { ZERO: 1, ONE: 2, SRCALPHA: 5, INVSRCALPHA: 6 } as const;
export function modelParticleBlend(nt: boolean): { src: number; dst: number } {
  return { src: D3DBLEND.SRCALPHA, dst: nt ? D3DBLEND.ONE : D3DBLEND.INVSRCALPHA };
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

// ---- DerollePartObject: the debris emitter of the destructible rock 0x0303 and the stalactite 0x038b ----
// (PsoBB.exe: ctor 0x006441f4, InitSystem 0x00644cd0, update = vtable +0x1c 0x006443d0, the tick 0x00644390
// (update, then the inactive test of vtable +0x18 0x006443bc sets the dead flag), the draw dispatch 0x006446f4
// (vtable +0x28 0x00644718 or +0x2c 0x0064487c); object size 0x234; dump names are not trusted.) The object is
// not a particle effect: each of its particles is one chunk of an object model (the archive model config_5 of
// the object's own BML, texture list config_6, drawn at the particle with its three BAMS angles), so the
// emitter is the physics of those chunks. The parameter block is 0x4c bytes (19 dwords), copied to the
// object's +0x24..+0x6c. Object layout: +0x30 origin xyz, +0x3c velocity scale xyz, +0x48 spin xyz (int),
// +0x54 count, +0x58 delay, +0x5c floor, +0x60 scale, +0x64 model, +0x68 texture, +0x6c flags, +0x70 particles
// (8 x 0x38): +0 pos xyz, +0xc velocity xyz, +0x18 angles xyz (int), +0x24 steps xyz (int), +0x30 life
// (float, 1.0), +0x34 delay (int).

export const DEROLLE_BLOCK_WORDS = 19;
export const DEROLLE_OBJECT_SIZE = 0x234;
export const DEROLLE_MAX_PARTICLES = 8;
const DEROLLE_RAND_DIVISOR = 32768; // 0x009354f4: the rand values are 0..32767 (ASSUMED range of 0x008587a5)

// The block as the ctor reads it. [14] (the floor) and [16] / [17] are set by the callers from the object.
export interface DerolleBlock {
  restitution: number; // [0] float, obj+0x24: the vertical factor of a bounce (-restitution * vy)
  drag: number; // [1] float, obj+0x28: the x / z velocity loss per tick (v + -v * drag)
  gravity: number; // [2] float, obj+0x2c: subtracted from vy each tick (vy - gravity + -0.1 vy)
  origin: [number, number, number]; // [3..5] float: where the particles start (the object's place)
  velScale: [number, number, number]; // [6..8] float: vx = m * (rand/32768 - 0.5), vy = m * rand/32768, vz as vx
  spin: [number, number, number]; // [9..11] int: the spin steps start at trunc(spin * rand / 32768)
  count: number; // [12] int: particles (more than 8 and InitSystem fails)
  life: number; // [13] int: delay in ticks before a particle's own life counts
  floor: number; // [14] float: the bounce height (the object's y, 0x006759d4 / 0x00679b70)
  scale: number; // [15] float: obj+0x60 (ASSUMED: the chunk's tint, see drawList)
  model: number; // [16] int: archive model index (FUN_005b8610 of the object's archive)
  texture: number; // [17] int: texture list index (FUN_005b8624)
  flags: number; // [18] int: bit 2 runs the life counter, bit 1 bounces, bits 8 / 4 / 0x10 choose the draw
}

const f32 = Math.fround;
const floatOfBits = (u: number): number => {
  const v = new DataView(new ArrayBuffer(4));
  v.setUint32(0, u >>> 0);
  return v.getFloat32(0);
};

// Decodes the 19 dwords of a block (the words the ctor copies).
export function parseDerolleBlock(w: ArrayLike<number>): DerolleBlock {
  if (w.length < DEROLLE_BLOCK_WORDS) throw new Error('DerolleBlock: 19 words');
  const fl = (i: number) => floatOfBits(w[i]);
  const int = (i: number) => w[i] | 0;
  return {
    restitution: fl(0),
    drag: fl(1),
    gravity: fl(2),
    origin: [fl(3), fl(4), fl(5)],
    velScale: [fl(6), fl(7), fl(8)],
    spin: [int(9), int(10), int(11)],
    count: int(12),
    life: int(13),
    floor: fl(14),
    scale: fl(15),
    model: int(16),
    texture: int(17),
    flags: int(18),
  };
}

export interface DerolleParticle {
  pos: [number, number, number];
  vel: [number, number, number];
  ang: [number, number, number]; // BAMS, int adds (wraps at 2^32)
  step: [number, number, number];
  life: number; // +0x30, starts at 1.0
  delay: number; // +0x34
}

export interface DerolleChunk {
  pos: [number, number, number];
  ang: [number, number, number]; // radians
  model: number;
  texture: number;
  tint: number;
}

// One DerollePartObject. `rand` returns 0..32767; InitSystem draws it six times per particle, in the order
// x, y, z, then the three spins. `tick()` is one game tick (the update, then the dead test).
export class DerolleEmitter {
  readonly block: DerolleBlock;
  readonly particles: DerolleParticle[] = [];
  active = true; // +0x230: cleared when no particle is alive (the inactive test)
  readonly radius = 200; // +0x1c (ctor)
  readonly height = 40; // +0x20 (ctor)
  dead = false; // the +0x08 bit 0 of the object, set on the tick after it goes inactive

  constructor(block: DerolleBlock, rand: () => number) {
    this.block = block;
    if (block.count > DEROLLE_MAX_PARTICLES) {
      this.active = false; // InitSystem returns 0
      return;
    }
    const m = block.velScale;
    for (let i = 0; i < block.count; i++) {
      const vx = f32(f32(-0.5 * m[0]) + f32(f32(rand() / DEROLLE_RAND_DIVISOR) * m[0]));
      const vy = f32(f32(rand() / DEROLLE_RAND_DIVISOR) * m[1]);
      const vz = f32(f32(-0.5 * m[2]) + f32(f32(rand() / DEROLLE_RAND_DIVISOR) * m[2]));
      const s0 = Math.trunc(f32(block.spin[0] * (rand() / DEROLLE_RAND_DIVISOR)));
      const s1 = Math.trunc(f32(block.spin[1] * (rand() / DEROLLE_RAND_DIVISOR)));
      const s2 = Math.trunc(f32(block.spin[2] * (rand() / DEROLLE_RAND_DIVISOR)));
      this.particles.push({
        pos: [block.origin[0], block.origin[1], block.origin[2]],
        vel: [vx, vy, vz],
        ang: [0, 0, 0],
        step: [s0, s1, s2],
        life: 1,
        delay: block.life,
      });
    }
  }

  // The tick (0x00644390): the update, then the dead test. Returns true on the tick the object dies.
  tick(): boolean {
    this.update();
    if (!this.active && !this.dead) {
      this.dead = true;
      return true;
    }
    return false;
  }

  // The update (0x006443d0). A particle with no delay left counts its life down, only when flag 4 is set, and
  // is alive while the life is above 0; a particle with a delay counts the delay down and is alive. A particle
  // that is not skipped moves (motion). No alive particle clears `active`.
  update(): void {
    const b = this.block;
    let alive = 0;
    for (const p of this.particles) {
      if (p.delay === 0) {
        if (!(b.flags & 4)) continue;
        p.life = f32(p.life - 1);
        if (p.life > 0) alive++;
      } else {
        p.delay -= 1;
        alive++;
      }
      this.motion(p);
    }
    if (alive === 0) this.active = false;
  }

  private motion(p: DerolleParticle): void {
    const b = this.block;
    const d = f32(b.drag);
    const vx = p.vel[0];
    const vy = p.vel[1];
    const vz = p.vel[2];
    const qx = f32(vx + f32(-vx * d));
    const qz = f32(vz + f32(-vz * d));
    const qy = f32(f32(vy - f32(b.gravity)) + f32(-vy * f32(0.1)));
    p.vel[0] = qx;
    p.vel[1] = qy;
    p.vel[2] = qz;
    p.pos[0] = f32(p.pos[0] + qx);
    p.pos[1] = f32(p.pos[1] + qy);
    p.pos[2] = f32(p.pos[2] + qz);
    for (let k = 0; k < 3; k++) p.ang[k] = (p.ang[k] + p.step[k]) | 0;
    if (!(b.flags & 2)) return;
    // A bounce: below the floor and falling. The vertical speed flips by the restitution, the horizontal
    // speeds keep 0.9, the spins halve (truncated), and the particle sits on the floor.
    if (p.pos[1] < b.floor && qy < 0) {
      p.vel[0] = f32(qx * f32(0.9));
      p.vel[2] = f32(qz * f32(0.9));
      p.vel[1] = f32(f32(-b.restitution) * qy);
      p.step[0] = Math.trunc(p.step[0] / 2);
      p.step[1] = Math.trunc(p.step[1] / 2);
      p.step[2] = Math.trunc(p.step[2] / 2);
      p.pos[1] = b.floor;
    }
  }

  // The chunks drawn this frame: every particle of a live object (the draw loops over the count, not over
  // the alive ones). The draw's exact transform is not traced: the chunk is at its position with its three
  // angles (Euler XYZ, ASSUMED), unscaled, tinted by `scale` (ASSUMED from the 0.4 / 1.0 colour argument).
  drawList(): DerolleChunk[] {
    if (this.dead) return [];
    return this.particles.map((p) => ({
      pos: [p.pos[0], p.pos[1], p.pos[2]],
      ang: [bamsToRad(p.ang[0]), bamsToRad(p.ang[1]), bamsToRad(p.ang[2])],
      model: this.block.model,
      texture: this.block.texture,
      tint: this.block.scale,
    }));
  }
}

// BAMS (65536 = one turn) to radians, for any int (the spins wrap).
export function bamsToRad(a: number): number {
  return ((((a % 65536) + 65536) % 65536) / 65536) * Math.PI * 2;
}

// The rock 0x0303 break (0x006759d4): the block 0x0093aa40 (19 dwords, read with tools/exedata.py) and the six
// points at 0x009c9a00 (floats, stride 12, not ints). The points are offsets from the rock's place (ASSUMED: no
// yaw; the exe multiplies them by a matrix built from obj+0x60 through 0x0082d8bc, not traced). Chunk 1 is the
// rock's model 1 and texture list 1 (FUN_005b8610(1), FUN_005b8624(1)).
export const ROCK_DEBRIS_BLOCK: readonly number[] = [
  0x3f733333, 0x3d8f5c29, 0x3ecccccd, 0, 0, 0, 0x40a00000, 0x40f00000, 0x40a00000, 1024, 256, 1024, 1, 30, 0, 0x3ecccccd, 0, 0, 14,
];
export const ROCK_DEBRIS_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [12, 7, 12],
  [-14, 16, 13],
  [-3, 51, 11],
  [7, 49, -11],
  [-7, 38, -14],
  [8, 16, -16],
];
export const ROCK_DEBRIS_CHUNK = 1;

// The stalactite's template 0x0093b540 (0x17c bytes): five 0x4c blocks. Origin, floor, chunk and tint per part
// are set by the caller (0x00679b70). Part i's chunk is STALACTITE_DEBRIS_CHUNK[i]; its origin is the
// stalactite's x and z with y + STALACTITE_DEBRIS_RISE[i] (the float constants 0x0093b6ec = 25, 0x0093b6e8 = 10).
export const STALACTITE_DEBRIS_TEMPLATE: readonly number[] = [
  0x3f333333, 0x3d8f5c29, 0x3f000000, 0, 0, 0, 0x40400000, 0x40a00000, 0x40400000, 2048, 256, 2048, 1, 40, 0, 0x3f800000, 0, 0, 14,
  0x3f333333, 0x3d8f5c29, 0x3f19999a, 0, 0, 0, 0x40600000, 0x40a00000, 0x40600000, 1024, 256, 1024, 2, 40, 0, 0x3f800000, 0, 0, 14,
  0x3f333333, 0x3d8f5c29, 0x3ecccccd, 0, 0, 0, 0x40800000, 0x40a00000, 0x40800000, 512, 256, 512, 5, 40, 0, 0x3f800000, 0, 0, 14,
  0x3f333333, 0x3d8f5c29, 0x3f19999a, 0, 0, 0, 0x40600000, 0x40a00000, 0x40600000, 1024, 256, 1024, 2, 40, 0, 0x3f800000, 0, 0, 14,
  0x3f333333, 0x3d8f5c29, 0x3ecccccd, 0, 0, 0, 0x40800000, 0x40a00000, 0x40800000, 512, 256, 512, 5, 40, 0, 0x3f800000, 0, 0, 14,
];
export const STALACTITE_DEBRIS_CHUNK: readonly number[] = [0, 2, 1, 2, 1];
export const STALACTITE_DEBRIS_RISE: readonly number[] = [25, 25, 25, 10, 10];

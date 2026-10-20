// De Rol Le's two fin chains and its shell debris (PsoBB.exe, Ephinea 1.25.13,
// addresses are VAs). Pure logic, no three.js: render/combat.ts feeds it the
// body's captured node positions / matrix and draws what it returns.
//
// Sources (docs/adr/0001-client-reference-sources.md): the Ephinea Ghidra dump
// names these objects wrongly ("MovementTarget", "TeamFlagObject",
// "SinowbeatObject", "ParticleEffectInstance"), so everything below was
// matched by callees and constants, and the code that the dump does not
// decompile was read from the exe's disassembly. psobb-client-source (JP) has
// the same code as asm (FUN_00434e04 = 0x00434d00, FUN_00434e38 = 0x00434d34,
// FUN_00434d88 = 0x00434c84).
//
// --- The fin chains ----------------------------------------------------------
// The body ctor (0x0042ad4c) creates one chain object at +0x658 with
// "MovementTarget" 0x00434ba4: two chains of 6 points (table 0x00a43d40, set by
// 0x00434f54: count 6, step (0, 0, -5.0) each, a 0xff terminator), anchored at
// the body's captured nodes 1 and 10 of the draw-order table 0x008fcba0
// (body +0x40c and +0x478 = +0x400 + 12 * k), which are the model's locator
// nodes 26 and 96 (the draw index is the depth-first node index: the table's
// 0x4d..0x58 captures are exactly the 12 nodes under node 77). The ctor builds
// the rest pose with the chain builder 0x0078d9d0 (point j = anchor + j * step).
// Every tick (vtable +4, 0x00434d00) it refreshes the anchors and the two
// collision spheres (0x00434c84: radius 10.0 at the anchor + (0, -7.07, +7.07),
// 7.07 = 0x008fd480), then runs the solver 0x0078d130 with the delta
// (0, 0, -2.0). The solver is a follow-the-leader: each point is pulled by the
// delta, put back at the segment length (|step| = 5) from the point before it,
// pushed out of the spheres (radius + half a segment, up to 16 passes) and
// put back at the length again. The draw (vtable +8, 0x00434d34) lays a model
// on every segment: fin_a (model 1) on all but the last one, fin_b (model 0,
// the tip) on the last, at scale 2.0.
//
// --- The shell debris ----------------------------------------------------------
// Two objects share the piece physics (the vtable update 0x00429e60 for the
// 28-piece helm and 0x004299ec for the 19-piece shell are the same code with
// the same constants): the helm break (0x00429d00, models helm_break) that
// UpdateDerolle spawns when the shell pool breaks (flag 0x80 of +0x3c8 set by
// 0x00433fe4's 0x88; the handler clears it and sets 0x40, which cuts the helm
// nodes off the body's draw), and the shell break of a segment (0x00429834,
// shell_break, 19 pieces) that a segment creates when its own pool runs out
// (0x004354c4 -> vtable +0x1a8 = 0x004350d4). Both live 160 ticks.

export type Vec3 = [number, number, number];

const TAU = Math.PI * 2;
// 0x008fd460: the divisor of the exe's radian -> BAMS conversion, as stored.
const EXE_TAU = 6.283184051513672;

export const DRL_FIN = {
  chains: 2,
  points: 6, // table 0x00a43d40: count of each chain
  step: [0, 0, -5] as const, // +4, +8, +0xc of each record (0x00434f54)
  // Body nodes the anchors are captured from (draw indices 0x008fcba0[1], [10]).
  nodes: [26, 96] as const,
  radius: 10, // this+0x50 / +0x60
  offset: Math.fround(7.07), // 0x008fd480: sphere = anchor + (0, -offset, +offset)
  delta: [0, 0, -2] as const, // 0x00434d21
  passes: 16, // 0x0078d22c
  half: 0.5, // 0x0097aa90: the sphere radius grows by half a segment
  scale: 2, // 0x008fcc14
  quarter: 0x4000, // the last rotation of the draw, negated (0xffffc000)
} as const;

// BAMS (65536 = 360 degrees) as the exe converts a radian value:
// fistp with truncation of rad * 65536 / 6.283184051513672.
function bams(rad: number): number {
  return Math.trunc((rad * 65536) / EXE_TAU);
}

// The exe reads sin / cos from a 4096 entry table with a 16 step
// interpolation (0x008451f8); the exact value is within about 1e-7 of it.
export function bamsSin(a: number): number {
  return Math.sin(((a & 0xffff) * TAU) / 65536);
}
export function bamsCos(a: number): number {
  return Math.cos(((a & 0xffff) * TAU) / 65536);
}

// --- 4x4 matrices, column-major, post-multiplied like the exe's matrix stack ---
// (0x0082d8bc Y, 0x0082e9e4 X, 0x00830c04 Z, 0x008316b4 translate, 0x0082fa0c
// scale, 0x00831308 multiply; element e[12..14] is the translation, which is
// also three.js' layout).

export type Mat = Float64Array;
export const newMat = (): Mat => {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};
export function matIdentity(m: Mat): Mat {
  m.fill(0);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
export function matTranslate(m: Mat, x: number, y: number, z: number): Mat {
  m[12] += m[0] * x + m[4] * y + m[8] * z;
  m[13] += m[1] * x + m[5] * y + m[9] * z;
  m[14] += m[2] * x + m[6] * y + m[10] * z;
  return m;
}
export function matScale(m: Mat, x: number, y: number, z: number): Mat {
  for (let r = 0; r < 4; r++) {
    m[r] *= x;
    m[4 + r] *= y;
    m[8 + r] *= z;
  }
  return m;
}
// Column a' = c a + k b, column b' = -k a + c b (rotations about one axis).
function matTurn(m: Mat, a: number, b: number, c: number, k: number): Mat {
  for (let r = 0; r < 4; r++) {
    const ea = m[a + r];
    const eb = m[b + r];
    m[a + r] = c * ea + k * eb;
    m[b + r] = -k * ea + c * eb;
  }
  return m;
}
export const matRotX = (m: Mat, ang: number): Mat => matTurn(m, 4, 8, bamsCos(ang), bamsSin(ang));
export const matRotZ = (m: Mat, ang: number): Mat => matTurn(m, 0, 4, bamsCos(ang), bamsSin(ang));
// Y turns columns 2 and 0 the other way round: col0' = c col0 - s col2.
export const matRotY = (m: Mat, ang: number): Mat => matTurn(m, 8, 0, bamsCos(ang), bamsSin(ang));
// m = m * o.
export function matMul(m: Mat, o: ArrayLike<number>): Mat {
  const t = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      t[c * 4 + r] = m[r] * o[c * 4] + m[4 + r] * o[c * 4 + 1] + m[8 + r] * o[c * 4 + 2] + m[12 + r] * o[c * 4 + 3];
    }
  }
  m.set(t);
  return m;
}

// --- the fin chains ----------------------------------------------------------

function vlen(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

export class DrlFins {
  // chain c, point j at [(c * points + j) * 3 ..], stored as the exe's floats.
  readonly points = new Float32Array(DRL_FIN.chains * DRL_FIN.points * 3);
  // Whether a tick has seen real anchors (before it the chains rest at the
  // origin, as in the ctor).
  active = false;
  private readonly segLen = vlen(DRL_FIN.step[0], DRL_FIN.step[1], DRL_FIN.step[2]);
  private readonly sphere = new Float32Array(DRL_FIN.chains * 3);
  private readonly tmp = new Float64Array(3);
  private readonly hit = new Float64Array(3);

  constructor() {
    // 0x0078d9d0 at the ctor, with the anchors still at zero (ASSUMED: the
    // body's capture slots are zero until the first draw).
    this.rest([[0, 0, 0], [0, 0, 0]]);
  }

  // The chain builder 0x0078d9d0: point j = anchor + j * step.
  rest(anchors: readonly Vec3[]): void {
    const n = DRL_FIN.points;
    for (let c = 0; c < DRL_FIN.chains; c++) {
      const a = anchors[c] ?? [0, 0, 0];
      for (let j = 0; j < n; j++) {
        const o = (c * n + j) * 3;
        this.points[o] = a[0] + j * DRL_FIN.step[0];
        this.points[o + 1] = a[1] + j * DRL_FIN.step[1];
        this.points[o + 2] = a[2] + j * DRL_FIN.step[2];
      }
    }
  }

  point(c: number, j: number): Vec3 {
    const o = (c * DRL_FIN.points + j) * 3;
    return [this.points[o], this.points[o + 1], this.points[o + 2]];
  }

  // One update (vtable +4, 0x00434d00): anchors = the two captured positions
  // (null: not captured yet, zeros).
  tick(anchors: readonly Vec3[] | null): void {
    const n = DRL_FIN.points;
    const pts = this.points;
    if (anchors) this.active = true;
    // 0x00434c84: the anchors and the spheres.
    for (let c = 0; c < DRL_FIN.chains; c++) {
      const a = anchors?.[c] ?? [0, 0, 0];
      const o = c * n * 3;
      pts[o] = a[0];
      pts[o + 1] = a[1];
      pts[o + 2] = a[2];
      this.sphere[c * 3] = a[0];
      this.sphere[c * 3 + 1] = a[1] - DRL_FIN.offset;
      this.sphere[c * 3 + 2] = a[2] + DRL_FIN.offset;
    }
    const t = this.tmp;
    const seg = this.segLen;
    for (let c = 0; c < DRL_FIN.chains; c++) {
      for (let j = 1; j < n; j++) {
        const o = (c * n + j) * 3;
        const q = o - 3; // the point before
        // pulled by the delta, then back at the segment length from q
        t[0] = pts[o] + DRL_FIN.delta[0];
        t[1] = pts[o + 1] + DRL_FIN.delta[1];
        t[2] = pts[o + 2] + DRL_FIN.delta[2];
        this.toLength(t, pts, q, seg);
        let budget = DRL_FIN.passes;
        for (;;) {
          // the sphere that penetrates this point the deepest
          let best = 0;
          let bestRadius = 0;
          for (let s = 0; s < DRL_FIN.chains; s++) {
            const sx = this.sphere[s * 3];
            const sy = this.sphere[s * 3 + 1];
            const sz = this.sphere[s * 3 + 2];
            const radius = DRL_FIN.radius + DRL_FIN.half * seg;
            // 0x00836208: a squared distance under 0.025 reads as 0
            const sq = (t[0] - sx) ** 2 + (t[1] - sy) ** 2 + (t[2] - sz) ** 2;
            const d = sq < 0.025 ? 0 : Math.sqrt(sq);
            if (d < radius && radius - d > best) {
              best = radius - d;
              bestRadius = radius;
              this.hit[0] = sx;
              this.hit[1] = sy;
              this.hit[2] = sz;
            }
          }
          if (budget <= 0 || best === 0) break;
          // out of the sphere along the line from its centre, then back at the
          // segment length from the point before
          t[0] -= this.hit[0];
          t[1] -= this.hit[1];
          t[2] -= this.hit[2];
          this.unit(t);
          t[0] = t[0] * bestRadius + this.hit[0];
          t[1] = t[1] * bestRadius + this.hit[1];
          t[2] = t[2] * bestRadius + this.hit[2];
          this.toLength(t, pts, q, seg);
          budget--;
        }
        pts[o] = t[0];
        pts[o + 1] = t[1];
        pts[o + 2] = t[2];
      }
    }
  }

  // The exe's unit step: a zero vector becomes (0, -1, 0) (0x0097aa94), any
  // other is divided by its length.
  private unit(v: Float64Array): void {
    const len = vlen(v[0], v[1], v[2]);
    if (len === 0) {
      v[0] = 0;
      v[1] = -1;
      v[2] = 0;
      return;
    }
    const inv = 1 / len;
    v[0] *= inv;
    v[1] *= inv;
    v[2] *= inv;
  }

  // t = prev + unit(t - prev) * len.
  private toLength(t: Float64Array, pts: Float32Array, q: number, len: number): void {
    t[0] -= pts[q];
    t[1] -= pts[q + 1];
    t[2] -= pts[q + 2];
    this.unit(t);
    t[0] = Math.fround(Math.fround(t[0] * len) + pts[q]);
    t[1] = Math.fround(Math.fround(t[1] * len) + pts[q + 1]);
    t[2] = Math.fround(Math.fround(t[2] * len) + pts[q + 2]);
  }

  // The draw (0x00434d34) of segment j of chain c: the model on it is fin_a
  // (model 1) except on the last segment, fin_b (model 0, the tip).
  isTip(j: number): boolean {
    return j === DRL_FIN.points - 2;
  }

  // The pose angles of segment j: the direction to the next point gives a yaw
  // atan2(-x, -z) (0 when it is vertical) and a pitch asin(-y), both
  // truncated to BAMS.
  angles(c: number, j: number): { yaw: number; pitch: number } {
    const o = (c * DRL_FIN.points + j) * 3;
    let x = this.points[o + 3] - this.points[o];
    let y = this.points[o + 4] - this.points[o + 1];
    let z = this.points[o + 5] - this.points[o + 2];
    const len = vlen(x, y, z);
    if (len === 0) {
      x = 0;
      y = -1;
      z = 0;
    } else {
      const inv = 1 / len;
      x *= inv;
      y *= inv;
      z *= inv;
    }
    const yaw = Math.abs(x) + Math.abs(z) === 0 ? 0 : bams(Math.atan2(-x, -z));
    const pitch = bams(Math.asin(Math.max(-1, Math.min(1, -y))));
    return { yaw, pitch };
  }

  // The segment's matrix, as 0x00434d34 builds it:
  //   T(point j) * Ry(yaw) * Rx(pitch) * Ry(anchor yaw 0 - yaw) * S(2) * Rx(-0x4000)
  // (the anchor's +0 slot, this+0x30 / +0x40, is always 0). `out` is column-major.
  segmentMatrix(out: Mat, c: number, j: number): Mat {
    const { yaw, pitch } = this.angles(c, j);
    const o = (c * DRL_FIN.points + j) * 3;
    matIdentity(out);
    matTranslate(out, this.points[o], this.points[o + 1], this.points[o + 2]);
    matRotY(out, yaw);
    matRotX(out, pitch);
    matRotY(out, 0 - yaw);
    matScale(out, DRL_FIN.scale, DRL_FIN.scale, DRL_FIN.scale);
    matRotX(out, -DRL_FIN.quarter);
    return out;
  }
}

// --- the shell debris ---------------------------------------------------------

export const DRL_DEBRIS = {
  life: 160, // 0x00429a00 / 0x00429e6f: the object is deleted at the 160th tick
  gravity: 0.2, // 0x008fc740
  floor: 1.15, // 0x008fcc18: a piece lands under this height
  minX: -75, // 0x008fcc20
  maxX: 76, // 0x008fcc1c
  minZ: -75, // 0x008fcc28
  maxZ: 76, // 0x008fcc24
  sink: -10, // 0x008fcc10: off the floor, under this height it sinks (state 1)
  bounce: -0.8, // 0x008fc6ec / 0x008fc714: vertical speed on the floor
  fade: -0.05, // 0x008fc6f4 / 0x008fc71c: alpha per tick
  sinkScale: 0.2, // 0x008fc6f8 / 0x008fc720
  shellScale: 2, // 0x008fcc14, the shell pieces' draw and positions
  dirScale: 1.1, // 0x0042a2eb: the pieces' outward direction (xz)
  rand: 32768, // rand() / 0x008fc708 / 0x008fc738
  speedY: 4, // vy = rand * 4 + 2
  baseY: 2,
  speedZ: 4, // vz -= rand * 4 + 1
  baseZ: 1,
  spinBase: -0.5, // spin = (rand - 0.5) * 2 * 3400
  spinGain: 2,
  spinRange: 3400,
  angleRange: 65536, // the shell's start angles
} as const;

export const PIECE_FALL = 0;
export const PIECE_SINK = 1;
export const PIECE_FADE = 2;
export const PIECE_GONE = 3;

// What the model object (0x00512124) keeps for each piece (a node that is not
// hidden), with the one-time edits of the static init 0x0042a238 /
// 0x0042a19c: the direction is the outward xz unit of the node position
// scaled by 1.1 (y 0), the shell's position is scaled by 2.0.
export interface DrlPieceRecord {
  pos: Vec3;
  dir: Vec3;
}

export function drlPieceRecords(positions: readonly Vec3[], shell: boolean): DrlPieceRecord[] {
  return positions.map((p) => {
    const len = Math.hypot(p[0], p[2]);
    const dx = len === 0 ? 0 : p[0] / len;
    const dz = len === 0 ? 0 : p[2] / len;
    const k = shell ? DRL_DEBRIS.shellScale : 1;
    return { pos: [p[0] * k, p[1] * k, p[2] * k], dir: [dx * DRL_DEBRIS.dirScale, 0, dz * DRL_DEBRIS.dirScale] };
  });
}

export class DrlDebris {
  readonly kind: 'helm' | 'shell';
  readonly count: number;
  age = 0;
  done = false;
  // Pieces that went from falling to sinking this tick (the exe starts a
  // particle, 0x170 / 0x171, at every second one: the particles are not drawn).
  readonly sunk: number[] = [];
  // Per piece (the exe's 0x2c-byte records at +0x20).
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly ax: Int32Array; // +0x18
  readonly spin: Int32Array; // +0x1c
  readonly ay: Int32Array; // +0x20
  readonly alpha: Float32Array; // +0x24
  readonly state: Int32Array; // +0x28
  // The helm: the captured matrix and the position it puts the node origin at
  // (+0x4f0 / +0x4f4).
  readonly matrix: Mat = newMat();
  readonly origin: Vec3 = [0, 0, 0];

  private constructor(kind: 'helm' | 'shell', count: number) {
    this.kind = kind;
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.ax = new Int32Array(count);
    this.spin = new Int32Array(count);
    this.ay = new Int32Array(count);
    this.alpha = new Float32Array(count).fill(1);
    this.state = new Int32Array(count);
  }

  // The helm break (ctor 0x00429d00). `m` is the matrix the body's draw
  // captured at its node 77 (draw index 0x4d) on the frame the shell broke.
  static helm(records: readonly DrlPieceRecord[], m: ArrayLike<number>, rng: () => number): DrlDebris {
    const d = new DrlDebris('helm', records.length);
    d.matrix.set(m);
    d.origin[0] = d.matrix[12];
    d.origin[1] = d.matrix[13];
    d.origin[2] = d.matrix[14];
    const e = d.matrix;
    const k = DRL_DEBRIS;
    records.forEach((r, i) => {
      const [x, y, z] = r.pos;
      d.pos[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      d.pos[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      d.pos[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const [dx, dy, dz] = r.dir;
      d.vel[i * 3] = e[0] * dx + e[4] * dy + e[8] * dz;
      d.vel[i * 3 + 1] = e[1] * dx + e[5] * dy + e[9] * dz;
      d.vel[i * 3 + 2] = e[2] * dx + e[6] * dy + e[10] * dz;
      // The rand() calls come in this order: vy, vz, spin.
      d.vel[i * 3 + 1] = rng() * k.speedY + k.baseY;
      d.vel[i * 3 + 2] = d.vel[i * 3 + 2] - (rng() * k.speedZ + k.baseZ);
      d.spin[i] = Math.trunc((rng() + k.spinBase) * k.spinGain * k.spinRange);
    });
    return d;
  }

  // A segment's shell break (ctor 0x00429834) at the segment's position.
  static shell(records: readonly DrlPieceRecord[], origin: Vec3, rng: () => number): DrlDebris {
    const d = new DrlDebris('shell', records.length);
    const k = DRL_DEBRIS;
    records.forEach((r, i) => {
      d.pos[i * 3] = origin[0] + r.pos[0];
      d.pos[i * 3 + 1] = origin[1] + r.pos[1];
      d.pos[i * 3 + 2] = origin[2] + r.pos[2];
      d.vel[i * 3] = r.dir[0];
      d.vel[i * 3 + 1] = r.dir[1];
      d.vel[i * 3 + 2] = r.dir[2];
      // The rand() calls come in this order: vy, vz, ax, spin, ay.
      d.vel[i * 3 + 1] = rng() * k.speedY + k.baseY;
      d.vel[i * 3 + 2] = d.vel[i * 3 + 2] - (rng() * k.speedZ + k.baseZ);
      d.ax[i] = Math.trunc(rng() * k.angleRange);
      d.spin[i] = Math.trunc((rng() + k.spinBase) * k.spinGain * k.spinRange);
      d.ay[i] = Math.trunc(rng() * k.angleRange);
    });
    return d;
  }

  // One update (0x00429e60 / 0x004299ec).
  tick(): void {
    this.sunk.length = 0;
    if (this.done) return;
    if (++this.age >= DRL_DEBRIS.life) {
      this.done = true;
      return;
    }
    const k = DRL_DEBRIS;
    const { pos, vel } = this;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      const st = this.state[i];
      if (st === PIECE_FALL || st === PIECE_FADE) {
        vel[o + 1] -= k.gravity;
        pos[o] += vel[o];
        pos[o + 1] += vel[o + 1];
        pos[o + 2] += vel[o + 2];
        if (st === PIECE_FALL) {
          // on the way down and under the floor height: inside the arena it
          // bounces and starts to fade, outside it sinks once under -10
          if (vel[o + 1] < 0 && pos[o + 1] < k.floor) {
            const inside = pos[o] <= k.maxX && pos[o] >= k.minX && pos[o + 2] <= k.maxZ && pos[o + 2] >= k.minZ;
            if (inside) {
              vel[o + 1] *= k.bounce;
              this.state[i] = PIECE_FADE;
            } else if (pos[o + 1] < k.sink) {
              this.state[i] = PIECE_SINK;
              if ((i & 1) === 0) this.sunk.push(i);
            }
          }
        } else {
          const a = k.fade + this.alpha[i];
          if (a >= 0) this.alpha[i] = a;
          else {
            this.state[i] = PIECE_GONE;
            this.alpha[i] = 0;
          }
        }
        this.ax[i] = (this.ax[i] + this.spin[i]) | 0;
        this.ay[i] = (this.ay[i] + this.spin[i] * 2) | 0;
      } else if (st === PIECE_SINK) {
        pos[o + 1] = vel[o + 1] * k.sinkScale + pos[o + 1];
        pos[o + 2] += vel[o + 2];
      }
    }
  }

  // Whether piece i is drawn (states 0..2).
  visible(i: number): boolean {
    return this.state[i] >= 0 && this.state[i] <= PIECE_FADE;
  }

  // Piece i's matrix. The helm's (0x0042a034):
  //   T(pos) * Rz(ay) * Rx(ax) * T(-origin) * M
  // the shell's (0x00429bc0): T(pos) * Ry(spin) * Rx(ax) * Rz(ay) * S(2).
  // The model's node is local to its own origin, so the helm's M * T cancels
  // the node's translation and keeps its turn and scale.
  pieceMatrix(out: Mat, i: number): Mat {
    matIdentity(out);
    matTranslate(out, this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    if (this.kind === 'helm') {
      matRotZ(out, this.ay[i]);
      matRotX(out, this.ax[i]);
      matTranslate(out, -this.origin[0], -this.origin[1], -this.origin[2]);
      matMul(out, this.matrix);
    } else {
      matRotY(out, this.spin[i]);
      matRotX(out, this.ax[i]);
      matRotZ(out, this.ay[i]);
      matScale(out, DRL_DEBRIS.shellScale, DRL_DEBRIS.shellScale, DRL_DEBRIS.shellScale);
    }
    return out;
  }
}

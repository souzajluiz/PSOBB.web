// The model fragments of an exploding machine (PsoBB.exe, Ephinea 1.25.13 VAs):
// the object ParticleEffectInstance_Constructor_00578aa0 makes
// (ParticleEffectInstance_Initialize_00511c00, vtable 0x00aff718: update
// 0x00511e58, render 0x00511f1c) from a model object (ModelObjectConstructor:
// the rest pose of a model's node tree, one record per node that is not
// hidden: position, mesh, the xz unit of the position with y kept). The
// Canadine (g_pCanadineModelObject = its model entry 0, default parameters),
// the Dubchic / Gillchic (model entry 0, table 0x009bdd88) and the Epsilon
// (table 0x0092541c) end with one; the dump's "Mothmant" object of 0x00516ed8
// is the same class with 0x00920c58.
//
// The parameters (7 words, a table or the defaults 0x00511c60 uses when it is
// null): life steps n, fade step, speed, speed decay, gravity, climb base,
// climb range. Object alpha (+0x28) = n * fade + 1 (ParticleEffectInstance_
// SetScale_00512050); the speed (+0x30) = the speed word.
//
// Pieces (0x28 bytes): position = T(point) Ry(yaw) * the node position; the
// direction = Ry(yaw) * the node's xz unit, normalised on xz again; a climb
// A = rand * range + base replaces its y; the spin = round((rand - 0.5) * 2 *
// 5000) BAMS; angles (+0x18, +0x1c, +0x20) = (0, yaw, 0).
// Update (once a frame): alpha -= fade (the object ends at alpha <= 0); each
// piece: x += dir.x * speed; y += A; z += dir.z * speed; A -= gravity;
// angle x += spin; angle y += spin / 2 (truncated); then speed *= decay.
// Render: each piece's own mesh (node-local vertices) at T(position) with the
// three angles, no node scale or rotation; the whole object is drawn with
// alpha when it is below 1 (the last 1 / fade frames).
//
// Checked against the exe (the salvage pass): the defaults and the three
// tables (0x009bdd88, 0x0092541c, 0x00920c58), the constructor's constants
// (rand / 32768, spin 5000, the speed and climb words) and the update 0x00511e58
// (vtable slot 2). The render (0x00511f1c, vtable slot 3) is NOT checked: the
// opacity and the per-piece mesh are ASSUMED.

const f = Math.fround;

export interface FragmentParams {
  /** n: with the fade step it sets how long the object lives (alpha starts at n * fade + 1). */
  readonly life: number;
  readonly fade: number;
  readonly speed: number;
  readonly decay: number;
  readonly gravity: number;
  readonly climbBase: number;
  readonly climbRange: number;
}

const params = (life: number, fade: number, speed: number, decay: number, gravity: number, climbBase: number, climbRange: number): FragmentParams => ({
  life,
  fade: f(fade),
  speed: f(speed),
  decay: f(decay),
  gravity: f(gravity),
  climbBase: f(climbBase),
  climbRange: f(climbRange),
});

/** The defaults of Initialize_00511c00 (no table): 0xc, 0.07, 1.5, 0.9, 0.12, 0.5, 0.5. */
export const FRAGMENT_DEFAULT = params(12, 0.07, 1.5, 0.9, 0.12, 0.5, 0.5);

export const FRAGMENT_TABLES = {
  default: FRAGMENT_DEFAULT,
  /** 0x009bdd88 (Dubchic / Gillchic). */
  dubchic: params(20, 0.06, 1.5, 0.9, 0.12, 0.55, 0.5),
  /** 0x0092541c (Epsilon / Epsigard). */
  epsilon: params(20, 0.05, 1.2, 0.9, 0.12, 0.55, 0.5),
  /** 0x00920c58 (the object of 0x00516ed8). */
  mothmant: params(20, 0.05, 1.2, 0.9, 0.12, 0.55, 0.5),
} as const;

export type FragmentTable = keyof typeof FRAGMENT_TABLES;

export const FRAGMENT_SPIN = 5000; // DAT_00920554
export const FRAGMENT_BAMS = 0x10000;

/** A node of the model's rest pose: its position from the model origin. */
export interface FragmentNode {
  x: number;
  y: number;
  z: number;
}

export interface FragmentPiece {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  climb: number;
  /** BAMS angles (+0x18, +0x1c; +0x20 is 0). */
  ax: number;
  ay: number;
  spin: number;
}

const bamsRad = (a: number): number => (a * Math.PI * 2) / FRAGMENT_BAMS;

export class ShellFragments {
  readonly params: FragmentParams;
  readonly pieces: FragmentPiece[] = [];
  /** +0x28: the object's alpha (above 1 until the last frames). */
  alpha: number;
  /** +0x30: the current speed. */
  speed: number;
  done = false;

  /** `at` is the body point (+0x300), `yaw` the enemy's heading (BAMS); `rand` is rand() / 32768. */
  constructor(nodes: readonly FragmentNode[], table: FragmentParams, at: { x: number; y: number; z: number }, yaw: number, rand: () => number) {
    this.params = table;
    this.alpha = f(f(table.life * table.fade) + 1);
    this.speed = table.speed;
    const s = Math.sin(bamsRad(yaw)), c = Math.cos(bamsRad(yaw));
    for (const n of nodes) {
      // Ry: x' = x cos + z sin, z' = -x sin + z cos
      const px = n.x * c + n.z * s;
      const pz = -n.x * s + n.z * c;
      // The node's direction record: the xz unit of its position (y kept), turned and normalised on xz again.
      const len = Math.hypot(n.x, n.z);
      const ux = len > 0 ? n.x / len : 0, uz = len > 0 ? n.z / len : 0;
      let dx = ux * c + uz * s;
      let dz = -ux * s + uz * c;
      const dl = Math.hypot(dx, dz);
      if (dl > 0) {
        dx /= dl;
        dz /= dl;
      }
      this.pieces.push({
        x: at.x + px,
        y: at.y + n.y,
        z: at.z + pz,
        dx,
        dz,
        climb: f(f(rand() * table.climbRange) + table.climbBase),
        ax: 0,
        ay: yaw,
        spin: Math.round((rand() - 0.5) * 2 * FRAGMENT_SPIN),
      });
    }
  }

  /** One update (every game frame). */
  tick(): void {
    this.alpha = f(this.alpha - this.params.fade);
    if (this.alpha <= 0) this.done = true;
    const s = this.speed;
    for (const p of this.pieces) {
      p.x = f(p.dx * s + p.x);
      p.z = f(p.dz * s + p.z);
      p.y = f(p.y + p.climb);
      p.climb = f(p.climb - this.params.gravity);
      p.ax += p.spin;
      p.ay += Math.trunc(p.spin / 2);
    }
    this.speed = f(this.speed * this.params.decay);
  }

  /** The alpha the object is drawn with (1 until it falls below it). */
  get opacity(): number {
    return this.alpha < 1 ? Math.max(0, this.alpha) : 1;
  }

  /** Frames from the start to the end (alpha n * fade + 1 falling by fade each update). */
  static lifetime(table: FragmentParams): number {
    let a = f(f(table.life * table.fade) + 1);
    let n = 0;
    while (a > 0 && n < 1000) {
      a = f(a - table.fade);
      n++;
    }
    return n;
  }
}

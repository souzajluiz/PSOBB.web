// Draws and runs the technique objects of combat/techlightning.ts: the jagged
// lightning ribbons (Zonde, Gizonde, Razonde, the Shock / Storm specials), the
// Grants ring waves, the Burning explosion, the particles and the sounds, and
// the object runtime that decides what a cast makes and hits (the exe's
// unknown_cast_tech, see the header of combat/techlightning.ts). One shared
// geometry layout per bolt, one material per live effect; nothing is allocated
// per frame (the ribbons are laid out into fixed buffers).

import * as THREE from 'three';
import { textureBitmaps } from '../classic/stage.ts';
import type { ParticleSpawn } from '../combat/hitfx.ts';
import {
  aoeTargets,
  BOLT_POINTS,
  BOLT_VERTICAL,
  BOLT_PARTICLE,
  BURNING,
  CAST_HEIGHT,
  effectTier,
  GrantsTimeline,
  gizondeStrike,
  LightningBolt,
  MEGID_EMITTERS,
  megidSpeed,
  MegidFlight,
  RafoieBall,
  razondeStrike,
  RingWave,
  SE,
  shockBolt,
  stormBolts,
  supportCastFx,
  techSound,
  TARGET_PARTICLES,
  TARGET_SE,
  zondeStrike,
  type EmitterSpec,
  type FlightTarget,
  type FxParticle,
  type FxSound,
  type Rng,
  type SupportTech,
  type TechFxEvent,
  type TechShot,
  type Vec3,
  type WallHit,
} from '../combat/techlightning.ts';
import { TECH } from '../combat/techniques.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import { EnemyArchive } from './enemymodel.ts';
import { setModelOpacity } from './hitmodels.ts';
import type { FieldParticles } from './hitfx.ts';
import type { MapViewer } from './mapviewer.ts';
import { buildObjectTreeWithNodes, MaterialCache } from './njmesh.ts';

const FRAME = 1 / 30;
const MAX_BOLTS = 40;
const MAX_MODELS = 12;

// Shared by every ribbon: v counts the points (the texture repeats per segment),
// u is 0 on one edge and 1 on the other.
const RIBBON_UV = new THREE.Float32BufferAttribute(
  Float32Array.from({ length: BOLT_POINTS * 4 }, (_, k) => (k % 2 === 0 ? (k >> 1) % 2 : Math.floor(k / 4))),
  2,
);
const RIBBON_INDEX = new THREE.Uint16BufferAttribute(
  Uint16Array.from({ length: (BOLT_POINTS - 1) * 6 }, (_, k) => {
    const seg = Math.floor(k / 6);
    const a = seg * 2;
    return a + [0, 1, 2, 2, 1, 3][k % 6];
  }),
  1,
);

interface BoltView {
  bolt: LightningBolt;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  pos: THREE.BufferAttribute;
}

interface RingView {
  wave: RingWave;
  root: THREE.Object3D;
  mats: THREE.Material[];
  at: () => Vec3 | null;
  cache: MaterialCache;
}

interface BallView {
  ball: RafoieBall;
  root: THREE.Object3D;
  at: Vec3;
  cache: MaterialCache;
}

// Scratch for the ribbon layout (view space points and screen directions).
const VX = new Float32Array(BOLT_POINTS);
const VY = new Float32Array(BOLT_POINTS);
const VZ = new Float32Array(BOLT_POINTS);
const SX = new Float32Array(BOLT_POINTS);
const SY = new Float32Array(BOLT_POINTS);

export interface TechSink {
  /** play_directional_sound_effect + the tier's pitch command. */
  playSe(s: FxSound): void;
}

export class TechEffects {
  private viewer: MapViewer;
  private files: ClientFiles;
  private particles: FieldParticles;
  private sink: TechSink;
  private log: (msg: string) => void;
  private bolts: BoltView[] = [];
  private rings: RingView[] = [];
  private balls: BallView[] = [];
  private boltTexture: THREE.Texture | null = null;
  private ringTextures: THREE.Texture[] = [];
  private technicTextures: THREE.Texture[] = [];
  private archive: EnemyArchive | null = null;
  private loaded: Promise<void> | null = null;
  private acc = 0;
  private disposed = false;
  private hook = (dt: number) => this.frame(dt);

  constructor(viewer: MapViewer, files: ClientFiles, particles: FieldParticles, sink: TechSink, log: (msg: string) => void) {
    this.viewer = viewer;
    this.files = files;
    this.particles = particles;
    this.sink = sink;
    this.log = log;
    viewer.frameHooks.add(this.hook);
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const pt = await this.files.textures('technic_pt.xvm');
        const bitmaps = await textureBitmaps(pt);
        const make = (i: number, repeat: boolean): THREE.Texture => {
          const t = new THREE.Texture(bitmaps[i]);
          t.flipY = false;
          t.colorSpace = THREE.SRGBColorSpace;
          if (repeat) t.wrapT = THREE.RepeatWrapping;
          t.needsUpdate = true;
          return t;
        };
        // Entry 0 is the lightning strand, 1..7 the ring variations the critical flash also cycles.
        this.boltTexture = make(0, true);
        this.ringTextures = [1, 2, 3, 4, 5, 6, 7].map((i) => make(i, false));
        const tx = await this.files.textures('technic.xvm');
        const tb = await textureBitmaps(tx);
        this.technicTextures = tb.map((b) => {
          const t = new THREE.Texture(b);
          t.flipY = false;
          t.colorSpace = THREE.SRGBColorSpace;
          t.needsUpdate = true;
          return t;
        });
        this.archive = new EnemyArchive('bm_technic.bml', await this.files.read('bm_technic.bml'), 12);
      } catch (err) {
        this.log(`technique effects: data unavailable (${(err as Error).message})`);
      }
    })();
    return this.loaded;
  }

  preload(): void {
    void this.load();
  }

  // --- events ---------------------------------------------------------------

  /** One visual event of a technique object. `follow` is the object's position for 'follow' events. */
  play(e: TechFxEvent, follow?: () => Vec3 | null): void {
    switch (e.t) {
      case 'bolt':
        this.addBolt(e.bolt);
        break;
      case 'particle':
        this.particle(e.p);
        break;
      case 'se':
        this.sink.playSe(e.s);
        break;
      case 'ring':
        this.ring(() => e.at);
        break;
      case 'emitters':
        for (const id of e.ids) this.particle({ id, at: e.at, delay: 0, duration: e.frames });
        break;
      case 'follow':
        if (follow) this.follow(e.emitters, e.frames, follow);
        break;
    }
  }

  /** Drains an enemy technique shot's queued events (its position is the object's). */
  drainShot(shot: TechShot): void {
    const at = (): Vec3 | null => (shot.done ? null : shot);
    shot.drain((e) => this.play(e, at));
  }

  playSe(s: FxSound): void {
    this.sink.playSe(s);
  }

  particle(p: FxParticle, follow: (() => Vec3 | null) | null = null): void {
    const spawn: ParticleSpawn = { id: p.id };
    if (p.delay !== undefined) spawn.delay = p.delay;
    if (p.duration !== undefined) spawn.duration = p.duration;
    if (p.scale !== undefined) spawn.scale = [p.scale, p.scale];
    if (p.tint !== undefined) spawn.tint = p.tint;
    if (follow) void this.particles.spawn(spawn, this.pointGetter(follow), true);
    else void this.particles.spawn(spawn, new THREE.Vector3(p.at.x, p.at.y, p.at.z));
  }

  // A getter the particle system calls every frame: one vector, refilled.
  private pointGetter(f: () => Vec3 | null): () => THREE.Vector3 | null {
    const v = new THREE.Vector3();
    return () => {
      const p = f();
      return p ? v.set(p.x, p.y, p.z) : null;
    };
  }

  /** Continuous emitters that ride a moving point until it is gone (the Megid orb's). */
  follow(emitters: readonly EmitterSpec[], frames: number, at: () => Vec3 | null): void {
    for (const em of emitters) {
      const spawn: ParticleSpawn = { id: em.id, delay: 0, duration: frames };
      if (em.scale !== undefined) spawn.scale = [em.scale, em.scale];
      const start = at();
      if (!start) continue;
      void this.particles.spawn(spawn, this.pointGetter(at), false, true);
    }
  }

  // --- bolts ----------------------------------------------------------------

  addBolt(bolt: LightningBolt): void {
    void this.particles.spawnMany({ id: BOLT_PARTICLE }, bolt.particlePoints());
    void this.load().then(() => {
      if (this.disposed || !this.boltTexture || this.bolts.length >= MAX_BOLTS) return;
      const g = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(BOLT_POINTS * 6), 3);
      g.setAttribute('position', pos);
      g.setAttribute('uv', RIBBON_UV);
      g.setIndex(RIBBON_INDEX);
      const mat = new THREE.MeshBasicMaterial({
        map: this.boltTexture,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.viewer.scene.add(mesh);
      this.bolts.push({ bolt, mesh, mat, pos });
    });
  }

  /**
   * The ribbon of GizondeVisualEffect's render (0x006f4230): per point the
   * segment's screen direction n, and the two edge vertices at the point's view
   * position +- (thickness * n.y, 1.8 * thickness * n.x): the strip is
   * thickness wide in x and 1.8 times that in y at any depth.
   */
  private layout(v: BoltView): void {
    const b = v.bolt;
    const cam = this.viewer.camera;
    const M = cam.matrixWorldInverse.elements;
    const W = cam.matrixWorld.elements;
    let front = false;
    for (let i = 0; i < BOLT_POINTS; i++) {
      const x = b.points[i * 3];
      const y = b.points[i * 3 + 1];
      const z = b.points[i * 3 + 2];
      const vx = M[0] * x + M[4] * y + M[8] * z + M[12];
      const vy = M[1] * x + M[5] * y + M[9] * z + M[13];
      const vz = M[2] * x + M[6] * y + M[10] * z + M[14];
      VX[i] = vx;
      VY[i] = vy;
      VZ[i] = vz;
      // The exe clamps the depth to -1 (0x0096e078) before it projects.
      const d = vz < -1 ? -vz : 1;
      if (vz < 0) front = true;
      SX[i] = vx / d;
      SY[i] = -vy / d;
    }
    v.mesh.visible = front && b.alpha > 0;
    if (!v.mesh.visible) return;
    const a = v.pos.array as Float32Array;
    const T = b.thickness;
    let nx = 0;
    let ny = 1;
    for (let i = 0; i < BOLT_POINTS; i++) {
      const j = i < BOLT_POINTS - 1 ? i : i - 1;
      const dx = SX[j + 1] - SX[j];
      const dy = SY[j + 1] - SY[j];
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        nx = dx / len;
        ny = dy / len;
      }
      const ox = T * ny;
      const oy = BOLT_VERTICAL * T * nx;
      for (let s = 0; s < 2; s++) {
        const k = s === 0 ? 1 : -1;
        const px = VX[i] + ox * k;
        const py = VY[i] + oy * k;
        const pz = VZ[i];
        const o = (i * 2 + s) * 3;
        a[o] = W[0] * px + W[4] * py + W[8] * pz + W[12];
        a[o + 1] = W[1] * px + W[5] * py + W[9] * pz + W[13];
        a[o + 2] = W[2] * px + W[6] * py + W[10] * pz + W[14];
      }
    }
    v.pos.needsUpdate = true;
    v.mat.opacity = b.opacity;
  }

  // --- models: the Grants ring wave and the Burning explosion ----------------------

  private build(index: number, textureFor: (id: number) => THREE.Texture | null): { root: THREE.Object3D; cache: MaterialCache } | null {
    const archive = this.archive;
    if (!archive) return null;
    const m = archive.model(index);
    if (m.kind !== 'xj') return null;
    const cache = new MaterialCache(textureFor);
    return { root: buildObjectTreeWithNodes(m.object, cache).root, cache };
  }

  /** A Grants ring wave (model 10, eff_f_ringwave.xj) following `at`. */
  ring(at: () => Vec3 | null): void {
    void this.load().then(() => {
      if (this.disposed || this.rings.length >= MAX_MODELS || this.ringTextures.length < 7) return;
      const b = this.build(10, (id) => (id === 0 ? this.ringTextures[0] : (this.technicTextures[id] ?? null)));
      if (!b) return;
      b.root.visible = false;
      this.viewer.scene.add(b.root);
      const mats: THREE.Material[] = [];
      b.root.traverse((o) => {
        if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!mats.includes(m)) mats.push(m);
      });
      this.rings.push({ wave: new RingWave(), root: b.root, mats, at, cache: b.cache });
    });
  }

  /** The Burning special's ProjectileRafoie (CreateProjectileRafoieEffect_005ce054, type 1). */
  burning(at: Vec3): void {
    this.particle({ id: BURNING.particle, at: { x: at.x, y: at.y + BURNING.particleDy, z: at.z } });
    void this.load().then(() => {
      if (this.disposed || this.balls.length >= MAX_MODELS) return;
      const b = this.build(11, (id) => this.technicTextures[id] ?? null);
      if (!b) return;
      b.root.position.set(at.x, at.y + 5, at.z);
      this.viewer.scene.add(b.root);
      this.balls.push({ ball: new RafoieBall(), root: b.root, at, cache: b.cache });
    });
  }

  // --- the weapon specials (type 1) --------------------------------------------------------

  /** Shock / Thunder: one bolt straight down onto `at`. */
  shock(at: Vec3, rng: Rng): void {
    this.addBolt(shockBolt(at, rng));
  }

  /** Storm / Tempest: three random Zonde bolts onto `at`. */
  storm(at: Vec3, rng: Rng): void {
    for (const b of stormBolts(at, rng)) this.addBolt(b);
  }

  // --- the loop ----------------------------------------------------------------------------

  private frame(dt: number): void {
    if (this.disposed || (!this.bolts.length && !this.rings.length && !this.balls.length)) return;
    this.acc += dt;
    let ticks = 0;
    while (this.acc >= FRAME && ticks < 5) {
      this.acc -= FRAME;
      ticks++;
      this.tick();
    }
    if (this.acc >= FRAME) this.acc = 0;
    if (this.bolts.length) {
      this.viewer.camera.updateMatrixWorld();
      for (const v of this.bolts) if (v.bolt.visible) this.layout(v);
    }
    this.poseModels();
  }

  private tick(): void {
    this.bolts = this.bolts.filter((v) => {
      v.bolt.tick();
      if (!v.bolt.done) return true;
      this.viewer.scene.remove(v.mesh);
      v.mesh.geometry.dispose();
      v.mat.dispose();
      return false;
    });
    this.rings = this.rings.filter((r) => {
      r.wave.tick();
      if (!r.wave.done) return true;
      this.dropModel(r.root, r.cache);
      return false;
    });
    this.balls = this.balls.filter((b) => {
      b.ball.tick();
      if (!b.ball.done) return true;
      this.dropModel(b.root, b.cache);
      return false;
    });
  }

  private poseModels(): void {
    for (const r of this.rings) {
      const p = r.at();
      if (!p) {
        r.root.visible = false;
        continue;
      }
      r.root.visible = true;
      // matrix_translation(+0x20), scale, then (0, 10, 0); the model's own node sits 12 up.
      r.root.position.set(p.x, p.y + 10, p.z);
      r.root.scale.setScalar(r.wave.scale);
      const tex = this.ringTextures[r.wave.frame];
      for (const m of r.mats) if (tex && m instanceof THREE.MeshBasicMaterial && m.map !== tex && m.userData.textureId === 0) m.map = tex;
      setModelOpacity(r.root, r.wave.alpha);
    }
    if (this.balls.length) {
      const dir = this.viewer.camera.getWorldDirection(new THREE.Vector3());
      const yaw = Math.atan2(dir.x, dir.z);
      for (const b of this.balls) {
        b.root.scale.setScalar(b.ball.scale);
        b.root.rotation.y = yaw;
        setModelOpacity(b.root, b.ball.alpha);
      }
    }
  }

  private dropModel(root: THREE.Object3D, cache: MaterialCache): void {
    this.viewer.scene.remove(root);
    cache.dispose();
  }

  dispose(): void {
    this.disposed = true;
    this.viewer.frameHooks.delete(this.hook);
    for (const v of this.bolts) {
      this.viewer.scene.remove(v.mesh);
      v.mesh.geometry.dispose();
      v.mat.dispose();
    }
    this.bolts = [];
    for (const r of this.rings) this.dropModel(r.root, r.cache);
    for (const b of this.balls) this.dropModel(b.root, b.cache);
    this.rings = [];
    this.balls = [];
    this.boltTexture?.dispose();
    for (const t of this.ringTextures) t.dispose();
    for (const t of this.technicTextures) t.dispose();
    this.ringTextures = [];
    this.technicTextures = [];
    this.archive?.dispose();
    this.archive = null;
  }
}

// --- the object runtime -------------------------------------------------------------------------

/** What the runtime needs from the combat view. */
export interface TechWorld {
  /** The live enemies as sphere targets (list order is the exe's entity order); id is the 6x47 id (0x1000 | index). */
  enemies(): FlightTarget[];
  /** The origin (feet) of a 6x47 entity, null when it is missing or not targetable. */
  origin(id: number): Vec3 | null;
  /** The hit box position of a 6x47 entity (the exe's hitbox[+0x136]). */
  point(id: number): Vec3 | null;
  /** The map ray of a technique object (cast_ray_at_map_collision_geometry, mask 0x100): the hit point or null. */
  wall?: WallHit;
  /** entity_hit_by_tech of the local player's object on that entity. */
  hit(id: number, tech: number, level: number): void;
  rng: Rng;
}

export interface TechCaster {
  id: number;
  /** The caster's feet. */
  pos: Vec3;
  angle: number;
  /** The class boost of the technique (combat/techniques.ts techBoost): the ring tier and Megid's pierce read it. */
  boost: number;
  /** Apply damage (the local player's objects); the others only draw. */
  damage: boolean;
}

interface Pending {
  ticks: number;
  fn: () => void;
}

interface GrantsRun {
  timeline: GrantsTimeline;
  target: number;
  level: number;
  caster: TechCaster;
}

interface OrbRun {
  flight: MegidFlight;
  level: number;
  caster: TechCaster;
  pos: Vec3;
}

const SUPPORT_NAMES: Partial<Record<number, SupportTech>> = {
  [TECH.resta]: 'resta',
  [TECH.anti]: 'anti',
  [TECH.shifta]: 'shifta',
  [TECH.deband]: 'deband',
  [TECH.jellen]: 'jellen',
  [TECH.zalure]: 'zalure',
  [TECH.reverser]: 'reverser',
};

/** True when TechObjects draws and runs this technique (the others keep their own code). */
export function ownsTechnique(tech: number): boolean {
  return tech === TECH.zonde || tech === TECH.gizonde || tech === TECH.razonde || tech === TECH.grants || tech === TECH.megid || SUPPORT_NAMES[tech] !== undefined;
}

export class TechObjects {
  private fx: TechEffects;
  private world: TechWorld;
  private pending: Pending[] = [];
  private grants: GrantsRun[] = [];
  private orbs: OrbRun[] = [];

  constructor(fx: TechEffects, world: TechWorld) {
    this.fx = fx;
    this.world = world;
  }

  /**
   * unknown_cast_tech for a 6x48 (the local release and every remote cast):
   * `targets` are the 6x47 ids, `rangeH` the technique's range_h at `level`.
   */
  cast(tech: number, level: number, caster: TechCaster, targets: readonly number[], rangeH: number): void {
    const hand: Vec3 = { x: caster.pos.x, y: caster.pos.y + CAST_HEIGHT, z: caster.pos.z };
    const first = targets[0];
    const rng = this.world.rng;
    switch (tech) {
      case TECH.zonde: {
        const target = first === undefined ? null : this.world.origin(first);
        if (!target || first === undefined) return; // no target list: no object
        const plan = zondeStrike(level, target, rng);
        this.play(plan);
        if (caster.damage) this.later(0, () => this.world.hit(first, tech, level));
        return;
      }
      case TECH.gizonde: {
        // The list keeps its order: a missing entity is null, not dropped (the exe's chain).
        if (!targets.length) return;
        const points = targets.map((id) => this.world.point(id));
        const plan = gizondeStrike(level, hand, points, rng);
        this.play(plan);
        if (caster.damage && plan.hits) this.later(0, () => targets.forEach((id) => this.world.hit(id, tech, level)));
        return;
      }
      case TECH.razonde: {
        const plan = razondeStrike(level, hand, rng, caster.id < 12 ? { hand, weapon: caster.pos } : null);
        this.play(plan);
        if (caster.id < 12) this.later(0, () => plan.casterParticles.forEach((p) => this.fx.particle(p)));
        if (caster.damage) {
          this.later(0, () => {
            for (const t of aoeTargets(hand, rangeH, this.world.enemies())) this.world.hit(t.id, tech, level);
          });
        }
        return;
      }
      case TECH.grants: {
        if (first === undefined) return;
        this.grants.push({ timeline: new GrantsTimeline(level), target: first, level, caster });
        return;
      }
      case TECH.megid: {
        const speed = megidSpeed(level);
        const aim = first === undefined ? null : this.world.point(first);
        const pierce = this.megidPierces(caster);
        const flight = aim ? MegidFlight.at(hand, aim, speed, rangeH, pierce) : MegidFlight.along(hand, caster.angle, speed, rangeH, pierce);
        const tier = effectTier(level);
        const run: OrbRun = { flight, level, caster, pos: { x: flight.x, y: flight.y, z: flight.z } };
        this.orbs.push(run);
        this.fx.playSe(techSound(SE.megid, hand, tier));
        this.fx.follow(MEGID_EMITTERS[tier], Math.ceil(rangeH / speed) + 2, () => (flight.done ? null : run.pos));
        return;
      }
      default:
        break;
    }
    const support = SUPPORT_NAMES[tech];
    if (support) this.support(support, level, caster, targets, hand);
  }

  private megidPierces(caster: TechCaster): boolean {
    return caster.boost === 1;
  }

  private support(tech: SupportTech, level: number, caster: TechCaster, targets: readonly number[], hand: Vec3): void {
    // PlayTechniqueHitParticles: at the caster's position, players only (id < 4).
    const at = caster.id < 4 ? caster.pos : hand;
    const fx = supportCastFx(tech, level, caster.boost, caster.id < 4 ? at : hand);
    if (caster.id < 4) for (const p of fx.particles) this.fx.particle(p);
    for (const s of fx.sounds) this.fx.playSe({ ...s, at: hand });
    // The target's own body: the pair of particles on the other players it lands on.
    if (tech === 'resta' || tech === 'anti') {
      const ids = TARGET_PARTICLES[tech];
      const se = TARGET_SE[tech];
      for (const id of targets) {
        if (id >= 0x1000 || id === caster.id) continue;
        const where = (): Vec3 | null => {
          const p = this.world.origin(id);
          return p ? { x: p.x, y: p.y + CAST_HEIGHT, z: p.z } : null;
        };
        const start = where();
        if (!start) continue;
        for (const pid of ids) this.fx.particle({ id: pid, at: start }, where);
        this.later(se.frames, () => {
          const p = where();
          if (p) this.fx.playSe({ id: se.id, at: p, pitch: 0 });
        });
      }
    }
  }

  private play(plan: { bolts: LightningBolt[]; particles: FxParticle[]; sounds: FxSound[] }): void {
    for (const b of plan.bolts) this.fx.addBolt(b);
    for (const p of plan.particles) this.fx.particle(p);
    for (const s of plan.sounds) this.fx.playSe(s);
  }

  private later(ticks: number, fn: () => void): void {
    this.pending.push({ ticks, fn });
  }

  /** One game tick (30 Hz): the objects' updates. */
  tick(): void {
    if (this.pending.length) {
      const due = this.pending.filter((p) => --p.ticks < 0);
      this.pending = this.pending.filter((p) => p.ticks >= 0);
      for (const p of due) p.fn();
    }
    for (const g of this.grants) {
      const t = this.world.origin(g.target);
      g.timeline.update(t);
      for (const e of g.timeline.events) this.fx.play(e);
      g.timeline.events = [];
      if (g.timeline.hit && t && g.caster.damage) this.world.hit(g.target, TECH.grants, g.level);
    }
    this.grants = this.grants.filter((g) => !g.timeline.done);
    for (const o of this.orbs) {
      const hit = o.flight.tick(this.world.enemies(), this.world.wall);
      o.pos.x = o.flight.x;
      o.pos.y = o.flight.y;
      o.pos.z = o.flight.z;
      if (!hit) continue;
      this.fx.playSe({ id: SE.megidHit, at: { x: hit.x, y: hit.y, z: hit.z }, pitch: 0 });
      if (o.caster.damage) this.world.hit(hit.id, TECH.megid, o.level);
    }
    this.orbs = this.orbs.filter((o) => !o.flight.done);
  }

  clear(): void {
    this.pending = [];
    this.grants = [];
    this.orbs = [];
  }
}


// Particle effects of particleentry.dat in the field (hit sparks, status and
// death particles, the weapon specials' effects), as render/levelupfx.ts draws
// the level-up one: create_particle_effect / create_particle_effect_3 make an
// emitter that spawns its rate of particles once (at least one) and is gone;
// create_particle_effect_ex / 9 emit every frame for `duration` frames after
// `delay` frames (update_particle_effect 0x00509090: the delay counts down at
// +0x38, the duration at +0x3c). Flag 0x10 (create_particle_effect_3 with 0x50)
// makes the particles follow their entity. Type 1 entries (rings, e.g. the level-up
// 0x23 and the item pickup 0x9B) run the ring simulation of classic/particles.ts;
// type 0 runs the single-particle one (ASSUMED for the type 2 entries: the exe
// builds those through ParticleEffectInstanceFactory_00510534 and
// CreateParticleEffectInstance_0051163c).
// ASSUMED: the field +0x44 / +0x48 particle scale of a few special effects
// scales the drawn quad.

import * as THREE from 'three';
import { MAP_PARTICLE_COUNT, MAP_PARTICLE_FIRST, particleMapFile, parseParticleEntry, particleQuad, particleShade, ParticleSystem, type ParticleEntry } from '../classic/particles.ts';
import { textureBitmaps } from '../classic/stage.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import type { ParticleSpawn } from '../combat/hitfx.ts';
import { ICE_SHATTER_PIECES, velocityAngles } from '../combat/hitmodels.ts';
import { BloodDecals } from './blooddecals.ts';
import { FragmentEffects } from './fragments.ts';
import { HitModels, type IceHost } from './hitmodels.ts';
import type { MapViewer } from './mapviewer.ts';

const FRAME = 1 / 30;
const MAX_BURSTS = 80;
const BAMS_RAD = (Math.PI * 2) / 0x10000;

export type Anchor = THREE.Vector3 | (() => THREE.Vector3 | null);

interface Burst {
  particles: ParticleSystem;
  anchor: Anchor | null; // followed each frame (flag 0x10), null = fixed
  origin: THREE.Vector3; // the point the particles were made around (dy included)
  base: THREE.Vector3; // the anchor's position when spawned
  group: THREE.Group;
  sprites: THREE.Sprite[];
  delay: number; // frames before the first emission
  emit: number; // frames of emission left (0 = the one-shot already ran)
  scale: readonly [number, number];
  dy: number; // the spawn's raise
  track: (() => THREE.Vector3 | null) | null; // moves the emitter every emitting frame (create_particle_effect5: the owner sets the position)
  alive: (() => boolean) | null; // an emitter its owner kills (the destructor sets the effect's flag |= 1): stops emitting when this says false
  model: THREE.Mesh | null; // a model particle's template (flag 0x200): drawn as this model per particle, not as a quad
  pieces: THREE.Mesh[]; // the model particle's meshes, one per live particle
}

export class FieldParticles {
  private viewer: MapViewer;
  private files: ClientFiles;
  private log: (msg: string) => void;
  private dat: Uint8Array | null = null;
  // The current map's particleentrya%d.dat (ids 0x200..0x23f), see setMap.
  private mapFile: string | null = null;
  private map: Uint8Array | null = null;
  private mapLoaded: Promise<void> | null = null;
  private entries = new Map<number, ParticleEntry | null>();
  private bitmaps: ImageBitmap[] = [];
  private textures = new Map<number, THREE.Texture>();
  private slots = new Map<number, number>();
  private gbixOfSlot: number[] = [];
  private loaded: Promise<void> | null = null;
  private bursts: Burst[] = [];
  private acc = 0;
  private disposed = false;
  private hook = (dt: number) => this.frame(dt);
  // The model effects that go with the particles (critical flash, ice block).
  readonly models: HitModels;
  // The pools the dead leave on the floor (combat/blooddecals.ts).
  readonly decals: BloodDecals;
  // The model fragments of an exploding machine (combat/shellfragments.ts).
  readonly fragments: FragmentEffects;
  private pieceRotation = new THREE.Quaternion();
  private pieceTurn = new THREE.Quaternion();
  private pieceAxis = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

  constructor(viewer: MapViewer, files: ClientFiles, log: (msg: string) => void) {
    this.viewer = viewer;
    this.files = files;
    this.log = log;
    this.models = new HitModels(viewer, files, log);
    this.decals = new BloodDecals(viewer, files, log);
    this.fragments = new FragmentEffects(viewer, log);
    viewer.frameHooks.add(this.hook);
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        this.dat = await this.files.read('particleentry.dat');
        const nt = await this.files.textures('effect_nt.xvm');
        this.bitmaps = (await textureBitmaps(nt)) as ImageBitmap[];
        nt.forEach((t, i) => {
          if (t.gbix === undefined) return;
          this.slots.set(t.gbix, i);
          this.gbixOfSlot[i] = t.gbix;
        });
      } catch (err) {
        this.log(`hit effects: particles unavailable (${(err as Error).message})`);
      }
    })();
    return this.loaded;
  }

  /** Starts loading the data so the first hit does not wait for it. */
  preload(): void {
    void this.load();
    this.models.preload();
    this.decals.preload();
  }

  /**
   * The floor's map (its area number): ids 0x200..0x23f read that map's
   * particleentrya%d.dat (the exe's current map). A new map drops the entries
   * made from the old one.
   */
  setMap(map: number): void {
    const file = particleMapFile(map);
    if (file === this.mapFile) return;
    this.mapFile = file;
    this.map = null;
    this.mapLoaded = null;
    this.entries.clear();
  }

  private loadMap(): Promise<void> {
    this.mapLoaded ??= (async () => {
      if (!this.mapFile) return;
      try {
        this.map = await this.files.read(this.mapFile);
      } catch (err) {
        this.log(`hit effects: ${this.mapFile} unavailable (${(err as Error).message})`);
      }
    })();
    return this.mapLoaded;
  }

  private entry(id: number): ParticleEntry | null {
    if (this.entries.has(id)) return this.entries.get(id) ?? null;
    let e: ParticleEntry | null = null;
    if (id < MAP_PARTICLE_FIRST) {
      const ok = this.dat && (id + 1) * 0x98 <= this.dat.length;
      e = ok ? parseParticleEntry(this.dat!, id) : null;
    } else if (id < MAP_PARTICLE_FIRST + MAP_PARTICLE_COUNT) {
      const i = id - MAP_PARTICLE_FIRST;
      const ok = this.map && (i + 1) * 0x98 <= this.map.length;
      e = ok ? parseParticleEntry(this.map!, i) : null;
    }
    // A map entry is not cached before the map is read (spawn waits for it).
    if (id < MAP_PARTICLE_FIRST || this.map) this.entries.set(id, e);
    return e;
  }

  private texture(gbix: number): THREE.Texture | null {
    const have = this.textures.get(gbix);
    if (have) return have;
    const slot = this.slots.get(gbix);
    const bmp = slot === undefined ? undefined : this.bitmaps[slot];
    if (!bmp) return null;
    const tex = new THREE.Texture(bmp);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.textures.set(gbix, tex);
    return tex;
  }

  /**
   * One effect at `at` (a fixed point, or a getter followed every frame).
   * `dy` of the spawn raises the point. `follow`: the particles move with the
   * getter's point (flag 0x10); `track`: only the emitter does, the particles
   * stay where they were made. `alive` ends a long emission when its owner is
   * gone (the technique objects of render/techfire.ts).
   */
  async spawn(p: ParticleSpawn, at: Anchor, follow = false, track = false, alive: (() => boolean) | null = null): Promise<void> {
    await this.load();
    if (this.disposed || this.bursts.length >= MAX_BURSTS) return;
    if (p.id >= MAP_PARTICLE_FIRST) await this.loadMap();
    const e = this.entry(p.id);
    const pos = typeof at === 'function' ? at() : at;
    if (!e || !pos) return;
    const particles = new ParticleSystem();
    particles.slots = this.slots;
    const base = pos.clone();
    const origin = pos.clone();
    origin.y += p.dy ?? 0;
    particles.add(e, [origin.x, origin.y, origin.z], p.orient ?? null, p.tint, p.fx ?? {});
    const burst: Burst = {
      particles,
      anchor: follow ? at : null,
      origin,
      base,
      group: new THREE.Group(),
      sprites: [],
      delay: p.delay ?? 0,
      emit: p.duration ?? 0,
      scale: p.scale ?? [1, 1],
      dy: p.dy ?? 0,
      track: track && typeof at === 'function' ? at : null,
      alive,
      model: null,
      pieces: [],
    };
    if (p.duration === undefined) {
      // The one emission: at least one particle (the spawn loop runs while
      // max(rate, 1) >= 1).
      particles.emitters[0].acc = Math.max(0, 1 - e.rate);
      if (burst.delay === 0) {
        particles.step(true);
        particles.emitters.length = 0;
      } else {
        burst.emit = 1;
      }
    }
    this.viewer.scene.add(burst.group);
    this.bursts.push(burst);
  }

  /**
   * One one-shot effect made at several points at once (the Zonde bolt's 13
   * particles): the emitters share one burst, so a bolt costs one burst and
   * the 80 burst cap is not eaten by a tier 5 Zonde.
   */
  async spawnMany(p: ParticleSpawn, points: ReadonlyArray<{ x: number; y: number; z: number }>): Promise<void> {
    await this.load();
    if (this.disposed || this.bursts.length >= MAX_BURSTS || !points.length) return;
    const e = this.entry(p.id);
    if (!e) return;
    const particles = new ParticleSystem();
    particles.slots = this.slots;
    const dy = p.dy ?? 0;
    const first = new THREE.Vector3(points[0].x, points[0].y, points[0].z);
    for (const q of points) particles.add(e, [q.x, q.y + dy, q.z], null, p.tint);
    for (const em of particles.emitters) em.acc = Math.max(0, 1 - e.rate);
    particles.step(true);
    particles.emitters.length = 0;
    const origin = first.clone();
    origin.y += dy;
    const burst: Burst = {
      particles,
      anchor: null,
      origin,
      base: first,
      group: new THREE.Group(),
      sprites: [],
      delay: 0,
      emit: 0,
      scale: p.scale ?? [1, 1],
      dy,
      track: null,
      alive: null,
      model: null,
      pieces: [],
    };
    this.viewer.scene.add(burst.group);
    this.bursts.push(burst);
  }

  /**
   * The pieces of an ice block's shatter: the emitter 0x153 (b_eff_koori) at
   * `at`, one burst of its rate (20) whose particles are the ice piece model
   * instead of a quad (the emitter's flag 0x200, HandleFlameEnemyLogic_00500e08).
   */
  async shards(at: THREE.Vector3): Promise<void> {
    await this.load();
    const template = await this.models.shardTemplate();
    if (this.disposed || !template || this.bursts.length >= MAX_BURSTS) return;
    const e = this.entry(ICE_SHATTER_PIECES);
    if (!e) return;
    const particles = new ParticleSystem();
    particles.models = true;
    particles.slots = this.slots;
    particles.add(e, [at.x, at.y, at.z], null);
    particles.emitters[0].acc = Math.max(0, 1 - e.rate);
    particles.step(true);
    particles.emitters.length = 0;
    const burst: Burst = {
      particles,
      anchor: null,
      origin: at.clone(),
      base: at.clone(),
      group: new THREE.Group(),
      sprites: [],
      delay: 0,
      emit: 0,
      scale: [1, 1],
      dy: 0,
      track: null,
      alive: null,
      model: template,
      pieces: [],
    };
    this.viewer.scene.add(burst.group);
    this.bursts.push(burst);
  }

  /** The ice block of a freeze (render/hitmodels.ts), its ring particles and shatter pieces through this system. */
  ice(host: IceHost): void {
    void this.models.ice(
      host,
      (p, at) => void this.spawn(p, at),
      (at) => void this.shards(at),
    );
  }

  get active(): number {
    return this.bursts.length;
  }

  private frame(dt: number): void {
    if (this.disposed) return;
    this.acc += dt;
    let ticks = 0;
    while (this.acc >= FRAME && ticks < 5) {
      this.acc -= FRAME;
      ticks++;
      this.tick();
    }
    if (this.acc >= FRAME) this.acc = 0;
    for (const b of this.bursts) this.draw(b);
  }

  private tick(): void {
    this.bursts = this.bursts.filter((b) => {
      if (b.alive && b.emit > 0 && !b.alive()) {
        b.emit = 0;
        b.particles.emitters.length = 0;
      }
      if (b.delay > 0) {
        b.delay--;
      } else if (b.emit > 0) {
        b.emit--;
        const t = b.track?.();
        if (b.track && !t) {
          // A tracker that returns null has lost its owner: the emission stops.
          b.emit = 0;
          b.particles.emitters.length = 0;
        } else {
          const em = b.particles.emitters[0];
          if (t && em) em.pos = [t.x, t.y + b.dy, t.z];
          b.particles.step(true);
          if (b.emit === 0) b.particles.emitters.length = 0;
          return true;
        }
      }
      b.particles.step(false);
      if (b.delay > 0 || b.emit > 0 || b.particles.count > 0) return true;
      this.remove(b);
      return false;
    });
  }

  private remove(b: Burst): void {
    this.viewer.scene.remove(b.group);
    for (const s of b.sprites) s.material.dispose();
    // A model particle's meshes share the template's geometry; each owns its materials.
    for (const p of b.pieces) for (const m of Array.isArray(p.material) ? p.material : [p.material]) m.dispose();
  }

  // The particles of a model burst as the template mesh each: T(p) S(size) Rz(z) Rx(x) Ry(angle),
  // the colour and fade of the particle (combat/hitmodels.ts velocityAngles).
  private drawModels(b: Burst): void {
    const live = b.particles.live;
    const tpl = b.model!;
    while (b.pieces.length < live.length) {
      const m = tpl.clone();
      m.material = Array.isArray(tpl.material) ? tpl.material.map((x) => x.clone()) : tpl.material.clone();
      m.frustumCulled = false;
      b.group.add(m);
      b.pieces.push(m);
    }
    const axis = this.pieceAxis;
    b.pieces.forEach((m, i) => {
      const q = live[i];
      if (!q) {
        m.visible = false;
        return;
      }
      const { fade, rgb } = particleShade(q);
      m.visible = fade > 0;
      m.position.set(q.p[0], q.p[1], q.p[2]);
      m.scale.setScalar(Math.max(q.size, 0.001));
      const a = velocityAngles(q.step[0], q.step[1], q.step[2]);
      this.pieceRotation.setFromAxisAngle(axis.z, a.z);
      this.pieceTurn.setFromAxisAngle(axis.x, a.x);
      this.pieceRotation.multiply(this.pieceTurn);
      this.pieceTurn.setFromAxisAngle(axis.y, q.angle * BAMS_RAD);
      m.quaternion.copy(this.pieceRotation.multiply(this.pieceTurn));
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const mm = mat as THREE.MeshBasicMaterial;
        mm.opacity = fade;
        mm.transparent = true;
        mm.color?.setRGB(rgb[0], rgb[1], rgb[2]);
      }
    });
  }

  // Additive sprites like render/levelupfx.ts, moved with the entity (flag 0x10).
  private draw(b: Burst): void {
    if (b.model) {
      this.drawModels(b);
      return;
    }
    if (b.anchor) {
      const now = typeof b.anchor === 'function' ? b.anchor() : b.anchor;
      if (now) b.group.position.set(now.x - b.base.x, now.y - b.base.y, now.z - b.base.z);
    }
    const live = b.particles.live;
    while (b.sprites.length < live.length) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      b.group.add(s);
      b.sprites.push(s);
    }
    const cam = this.viewer.camera;
    b.sprites.forEach((s, i) => {
      const q = live[i];
      if (!q) {
        s.visible = false;
        return;
      }
      const d = q.e.entry;
      const mat = s.material;
      const tex = this.texture(d.gbix);
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      const { fade, rgb } = particleShade(q);
      s.visible = !!tex && fade > 0;
      mat.color.setRGB(rgb[0] * fade, rgb[1] * fade, rgb[2] * fade);
      s.position.set(q.p[0], q.p[1], q.p[2]);
      const quad = particleQuad(q, this.slots.get(d.gbix));
      if (d.flags & 4 && quad.hw === 0 && quad.hh === 0) {
        s.visible = false;
        return;
      }
      s.scale.set(2 * quad.hw * b.scale[0], 2 * quad.hh * b.scale[1], 1);
      if (quad.rotated) {
        const a = new THREE.Vector3(...q.p).project(cam);
        const c = new THREE.Vector3(q.p[0] + q.step[0], q.p[1] + q.step[1], q.p[2] + q.step[2]).project(cam);
        mat.rotation = Math.atan2(c.y - a.y, c.x - a.x);
      } else {
        mat.rotation = 0;
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.models.dispose();
    this.decals.dispose();
    this.fragments.dispose();
    this.viewer.frameHooks.delete(this.hook);
    for (const b of this.bursts) this.remove(b);
    this.bursts = [];
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
  }
}

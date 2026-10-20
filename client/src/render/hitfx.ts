// Particle effects of particleentry.dat in the field (hit sparks, status and
// death particles, the weapon specials' effects), as render/levelupfx.ts draws
// the level-up one: create_particle_effect / create_particle_effect_3 make an
// emitter that spawns its rate of particles once (at least one) and is gone;
// create_particle_effect_ex / 9 emit every frame for `duration` frames after
// `delay` frames (update_particle_effect 0x00509090: the delay counts down at
// +0x38, the duration at +0x3c). Flag 0x10 (create_particle_effect_3 with 0x50)
// makes the particles follow their entity. Every particle type is run with the
// type 0 simulation of classic/particles.ts, as the level-up effect (id 0x23,
// type 1 in the file) already is (ASSUMED for the types 1 and 2 entries: the
// exe builds those through ParticleEffectInstanceFactory_00510534 and
// CreateParticleEffectInstance_0051163c).
// ASSUMED: the field +0x44 / +0x48 particle scale of a few special effects
// scales the drawn quad.

import * as THREE from 'three';
import { parseParticleEntry, particleQuad, particleShade, ParticleSystem, type ParticleEntry } from '../classic/particles.ts';
import { textureBitmaps } from '../classic/stage.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import type { ParticleSpawn } from '../combat/hitfx.ts';
import type { MapViewer } from './mapviewer.ts';

const FRAME = 1 / 30;
const MAX_BURSTS = 80;

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
}

export class FieldParticles {
  private viewer: MapViewer;
  private files: ClientFiles;
  private log: (msg: string) => void;
  private dat: Uint8Array | null = null;
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

  constructor(viewer: MapViewer, files: ClientFiles, log: (msg: string) => void) {
    this.viewer = viewer;
    this.files = files;
    this.log = log;
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
  }

  private entry(id: number): ParticleEntry | null {
    if (this.entries.has(id)) return this.entries.get(id) ?? null;
    const ok = this.dat && (id + 1) * 0x98 <= this.dat.length;
    const e = ok ? parseParticleEntry(this.dat!, id) : null;
    this.entries.set(id, e);
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
   * `dy` of the spawn raises the point.
   */
  async spawn(p: ParticleSpawn, at: Anchor, follow = false): Promise<void> {
    await this.load();
    if (this.disposed || this.bursts.length >= MAX_BURSTS) return;
    const e = this.entry(p.id);
    const pos = typeof at === 'function' ? at() : at;
    if (!e || !pos) return;
    const particles = new ParticleSystem();
    particles.slots = this.slots;
    const base = pos.clone();
    const origin = pos.clone();
    origin.y += p.dy ?? 0;
    particles.add(e, [origin.x, origin.y, origin.z], 0);
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
      if (b.delay > 0) {
        b.delay--;
      } else if (b.emit > 0) {
        b.emit--;
        b.particles.step(true);
        if (b.emit === 0) b.particles.emitters.length = 0;
        return true;
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
  }

  // Additive sprites like render/levelupfx.ts, moved with the entity (flag 0x10).
  private draw(b: Burst): void {
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
    this.viewer.frameHooks.delete(this.hook);
    for (const b of this.bursts) this.remove(b);
    this.bursts = [];
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
  }
}

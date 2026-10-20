// The particles on a player (own or remote): hit sparks, the block flash, the
// status effects, the revive burst and the dead marker, run by the rules of
// combat/playerfx.ts (which documents where every id and timing comes from).
//
// Drawing follows render/levelupfx.ts / render/telepipe.ts: the emitters of
// classic/particles.ts step at 30 Hz, the live particles are additive sprites
// shaped as their effect_nt renderer draws them. A burst that follows its
// player (flag 0x10) moves its whole group with the player's displacement.

import * as THREE from 'three';
import { parseParticleEntry, particleQuad, particleShade, ParticleSystem, type Emitter, type ParticleEntry } from '../classic/particles.ts';
import { textureBitmaps } from '../classic/stage.ts';
import { FxEmitter, type FxSpec } from '../combat/playerfx.ts';
import type { ClientFiles } from '../data/clientfiles.ts';
import type { MapViewer } from './mapviewer.ts';

export interface PlayerFxHost {
  // A player's position (feet) in the world, null when it is not on this floor.
  position(clientId: number): THREE.Vector3 | null;
  log(msg: string): void;
}

export interface PlayFxOptions {
  // The particles follow the player's movement (flag 0x10).
  follow?: boolean;
  // Spawn here instead of at the player (the hit point, in world units).
  at?: THREE.Vector3;
}

interface Slot {
  fx: FxEmitter;
  // The live emitter of a continuous spec (removed when the spec is done).
  live: Emitter | null;
  entry: ParticleEntry;
}

interface Burst {
  clientId: number;
  follow: boolean;
  anchor: THREE.Vector3;
  particles: ParticleSystem;
  slots: Slot[];
  group: THREE.Group;
  sprites: THREE.Sprite[];
  // Set by the handle's stop(): an unbounded emitter (the soul marker) ends.
  stopped: boolean;
}

const FRAME = 1 / 30;

export class PlayerEffects {
  private viewer: MapViewer;
  private files: ClientFiles;
  private host: PlayerFxHost;
  private dat: Uint8Array | null = null;
  private entries = new Map<number, ParticleEntry>();
  private slotOf = new Map<number, number>(); // effect_nt.xvm GBIX -> slot
  private textures = new Map<number, THREE.Texture>();
  private bitmaps: ImageBitmap[] = [];
  private gbixIndex = new Map<number, number>();
  private loaded: Promise<void> | null = null;
  private bursts: Burst[] = [];
  private acc = 0;
  private disposed = false;
  private hook = (dt: number) => this.frame(dt);

  constructor(viewer: MapViewer, files: ClientFiles, host: PlayerFxHost) {
    this.viewer = viewer;
    this.files = files;
    this.host = host;
    viewer.frameHooks.add(this.hook);
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        this.dat = await this.files.read('particleentry.dat');
        const nt = await this.files.textures('effect_nt.xvm');
        this.bitmaps = await textureBitmaps(nt);
        nt.forEach((t, i) => {
          if (t.gbix === undefined) return;
          this.slotOf.set(t.gbix, i);
          this.gbixIndex.set(t.gbix, i);
        });
      } catch (err) {
        this.host.log(`player fx: particles unavailable (${(err as Error).message})`);
      }
    })();
    return this.loaded;
  }

  private entry(id: number): ParticleEntry | null {
    let e = this.entries.get(id) ?? null;
    if (!e && this.dat && (id + 1) * 0x98 <= this.dat.length) {
      e = parseParticleEntry(this.dat, id);
      this.entries.set(id, e);
    }
    return e;
  }

  // The sprite texture of a GBIX, made when first drawn.
  private texture(gbix: number): THREE.Texture | null {
    let t = this.textures.get(gbix);
    if (!t) {
      const i = this.gbixIndex.get(gbix);
      const bmp = i === undefined ? undefined : this.bitmaps[i];
      if (!bmp) return null;
      t = new THREE.Texture(bmp);
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      this.textures.set(gbix, t);
    }
    return t;
  }

  // The emitters of `specs` on a player (or at a point). A spec with
  // frames = Infinity runs until the handle's stop().
  async play(clientId: number, specs: readonly FxSpec[], opts: PlayFxOptions = {}): Promise<{ stop(): void }> {
    await this.load();
    const base = opts.at ?? this.host.position(clientId);
    const handle = { stop: () => {} };
    if (this.disposed || !base || !this.dat) return handle;
    const particles = new ParticleSystem();
    particles.slots = this.slotOf;
    const slots: Slot[] = [];
    for (const spec of specs) {
      const entry = this.entry(spec.id);
      if (entry) slots.push({ fx: new FxEmitter(spec), live: null, entry });
    }
    if (!slots.length) return handle;
    const group = new THREE.Group();
    this.viewer.scene.add(group);
    const burst: Burst = {
      clientId,
      follow: !!opts.follow && !opts.at,
      anchor: base.clone(),
      particles,
      slots,
      group,
      sprites: [],
      stopped: false,
    };
    this.bursts.push(burst);
    handle.stop = () => {
      burst.stopped = true;
    };
    return handle;
  }

  // One 30 Hz update of every burst (update_particle_effect per emitter).
  private tick(): void {
    for (const b of this.bursts) {
      for (const s of b.slots) {
        if (b.stopped) {
          this.release(b, s);
          continue;
        }
        if (!s.fx.update() || s.live) continue;
        const spec = s.fx.spec;
        b.particles.add(s.entry, [b.anchor.x, b.anchor.y + (spec.dy ?? 0), b.anchor.z], 0);
        s.live = b.particles.emitters[b.particles.emitters.length - 1];
        // A single emission spawns at least one particle (the spawn loop
        // runs while max(rate, 1) >= 1).
        if (spec.frames === undefined || spec.frames === 1) s.live.acc = Math.max(0, 1 - s.entry.rate);
      }
      b.particles.step(true);
      for (const s of b.slots) if (s.fx.done) this.release(b, s);
    }
    this.bursts = this.bursts.filter((b) => {
      const running = !b.stopped && b.slots.some((s) => !s.fx.done);
      if (running || b.particles.count > 0) return true;
      this.viewer.scene.remove(b.group);
      return false;
    });
  }

  // The slot's emitter stops emitting (its particles live on).
  private release(b: Burst, s: Slot): void {
    if (!s.live) return;
    const i = b.particles.emitters.indexOf(s.live);
    if (i >= 0) b.particles.emitters.splice(i, 1);
    s.live = null;
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

  // Additive sprites like render/telepipe.ts, moved with the player when the
  // burst follows it.
  private draw(b: Burst): void {
    if (b.follow) {
      const now = this.host.position(b.clientId);
      if (now) b.group.position.set(now.x - b.anchor.x, now.y - b.anchor.y, now.z - b.anchor.z);
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
      const quad = particleQuad(q, this.slotOf.get(d.gbix));
      if (d.flags & 4 && quad.hw === 0 && quad.hh === 0) {
        s.visible = false;
        return;
      }
      s.scale.set(2 * quad.hw, 2 * quad.hh, 1);
      if (quad.rotated) {
        const a = new THREE.Vector3(...q.p).project(cam);
        const c = new THREE.Vector3(q.p[0] + q.step[0], q.p[1] + q.step[1], q.p[2] + q.step[2]).project(cam);
        mat.rotation = Math.atan2(c.y - a.y, c.x - a.x);
      } else {
        mat.rotation = 0;
      }
    });
  }

  // Bursts alive (tests / debugging).
  get active(): number {
    return this.bursts.length;
  }

  dispose(): void {
    this.disposed = true;
    this.viewer.frameHooks.delete(this.hook);
    for (const b of this.bursts) this.viewer.scene.remove(b.group);
    this.bursts = [];
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
  }
}
